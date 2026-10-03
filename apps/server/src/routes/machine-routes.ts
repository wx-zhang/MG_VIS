import { randomUUID } from "node:crypto";
import type express from "express";
import { RUNTIMES, type MachineRecord, type RuntimeId } from "@tyr-ai/contracts";
import { createAgentManagementService } from "../agent-management-service";
import type { MachineBatchAction } from "../machine-operations";
import { requestRuntimeModelDetection } from "../runtime-model-detection";
import type { ServerRouteContext } from "../server-context";

export function registerMachineRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const {
    store,
    publicServerUrl,
    daemonSockets,
    runtimeModelRequests,
    authUser,
    primaryServerIdForUser,
    isServerMember,
    requireOwnedMachine,
    emitRealtimeAgentStatus,
    emitRealtimeRuntimeExecution,
    emitRealtimeRuntimeApproval,
    publishTerminalCommunicationFailure,
    emitRealtimeMachineUpdated,
    emitRealtimeMachineDeleted,
    broadcastRealtime,
    publishWorkspaceSync,
    startAgent,
    sendToDaemon,
    daemonSupports,
    recordConnectorRotationState,
    machineConnectCommandSet,
    runMachineAgentBatchAction
  } = ctx;
  const agentManagement = createAgentManagementService({
    store,
    startAgent,
    sendToDaemon,
    emitRealtimeAgentStatus,
    emitRealtimeRuntimeExecution,
    emitRealtimeRuntimeApproval,
    publishTerminalCommunicationFailure,
    broadcastRealtime,
    publishWorkspaceSync
  });

  app.post("/api/machines", (req, res) => {
    const user = authUser(req);
    const requestedServerId = typeof req.body?.serverId === "string" ? req.body.serverId.trim() : "";
    const serverId = requestedServerId || primaryServerIdForUser(user.id);
    if (!serverId) {
      res.status(403).json({ error: "server_membership_required" });
      return;
    }
    if (!isServerMember(user.id, serverId)) {
      res.status(403).json({ error: "server_membership_required" });
      return;
    }
    const serverRecord = store.listServersForUser(user.id).find((item) => item.id === serverId);
    if (serverRecord?.role === "guest") {
      res.status(403).json({ error: "workspace_member_required" });
      return;
    }
    const requestedName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const machine = store.createMachineKey(requestedName || undefined, user.id, serverId);
    emitRealtimeMachineUpdated(machine.id);
    res.json({ machine, ...machineConnectCommands(machine) });
  });

  function machineConnectCommands(machine: MachineRecord) {
    const serverUrl = publicServerUrl.replace(/\/$/, "");
    const credential = store.getMachineConnectCredential(machine.id);
    if (!credential) return null;
    // machine apiKey 只用于首次 bootstrap；已签发 token 的机器必须用 connector token 生成可执行重连命令。
    return machineConnectCommandSet({
      serverUrl,
      machineId: machine.id,
      machineName: machine.name,
      apiKey: machine.apiKey,
      credentialKind: credential.kind,
      credentialFlag: credential.flag,
      credentialValue: credential.value
    });
  }

  app.get("/api/machines/:machineId/connect-command", (req, res) => {
    const owned = requireOwnedMachine(req, res, req.params.machineId);
    if (!owned) return;
    if (owned.bridgeCapability) {
      res.status(403).json({ error: "machine_credential_owner_required" });
      return;
    }
    const { machine } = owned;
    const commands = machineConnectCommands(machine);
    if (!commands) {
      res.status(409).json({ error: "connector_token_required" });
      return;
    }
    res.json(commands);
  });

  app.patch("/api/machines/:machineId", (req, res) => {
    const owned = requireOwnedMachine(req, res, req.params.machineId);
    if (!owned) return;
    const requestedName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!requestedName) {
      res.status(400).json({ error: "machine_name_required" });
      return;
    }
    if (requestedName.length > 80) {
      res.status(400).json({ error: "machine_name_too_long" });
      return;
    }
    const machine = store.updateMachineName(owned.machine.id, requestedName);
    if (!machine) {
      res.status(404).json({ error: "machine_not_found" });
      return;
    }
    emitRealtimeMachineUpdated(machine.id);
    res.json({ machine });
  });

  app.post("/api/machines/:machineId/connector-token/rotate", (req, res) => {
    const owned = requireOwnedMachine(req, res, req.params.machineId);
    if (!owned) return;
    if (owned.bridgeCapability) {
      res.status(403).json({ error: "machine_credential_owner_required" });
      return;
    }
    const { machine } = owned;
    if (!daemonSupports(machine.id, "machine:connector-token-ack")) {
      // 旧 daemon 会保存 token 但不会 ACK；禁止轮换可避免 pending 过期后把它锁在账号外。
      res.status(409).json({ error: "daemon_update_required_for_safe_rotation" });
      return;
    }
    const rotated = store.rotateMachineConnectorToken(machine.id);
    if (!rotated) {
      res.status(404).json({ error: "machine_not_found" });
      return;
    }
    const sent = sendToDaemon(machine.id, {
      type: "machine:connector_token",
      machineId: machine.id,
      connectorToken: rotated.connectorToken,
      rotationId: rotated.rotationId,
      ackRequired: true
    });
    if (!sent) {
      res.status(503).json({ error: "daemon_unavailable_for_safe_rotation" });
      return;
    }
    recordConnectorRotationState("pending", machine.id);
    emitRealtimeMachineUpdated(machine.id);
    res.status(202).json({
      machine: { ...rotated.machine, connectorToken: undefined },
      rotation: {
        rotationId: rotated.rotationId,
        state: "pending",
        expiresAt: rotated.expiresAt,
        reused: rotated.reused
      }
    });
  });

  app.post("/api/machines/:machineId/connector-token/revoke", (req, res) => {
    const owned = requireOwnedMachine(req, res, req.params.machineId);
    if (!owned) return;
    if (owned.bridgeCapability) {
      res.status(403).json({ error: "machine_credential_owner_required" });
      return;
    }
    const { machine } = owned;
    const revoked = store.revokeMachineConnectorToken(machine.id);
    daemonSockets.get(machine.id)?.close();
    if (revoked) {
      recordConnectorRotationState("cancelled", machine.id);
      emitRealtimeMachineUpdated(machine.id);
    }
    res.json({ machine: revoked ? { ...revoked, connectorToken: undefined } : null, revoked: Boolean(revoked) });
  });

  function runMachineBatchEndpoint(req: express.Request, res: express.Response, action: MachineBatchAction): void {
    const machineId = typeof req.params.machineId === "string" ? req.params.machineId : "";
    const owned = requireOwnedMachine(req, res, machineId);
    if (!owned) return;
    const { machine } = owned;
    const agents = store.listAgents(machine.serverId).filter((agent) => agent.machineId === machine.id);
    const summary = runMachineAgentBatchAction(agents, action, {
      start: (agent) => startAgent(agent),
      stop: (agent) => sendToDaemon(machine.id, { type: "agent:stop", agentId: agent.id }),
      markOffline: (agent) => store.updateAgentStatus(agent.id, "offline", "Stop requested from device.")
    });
    emitRealtimeMachineUpdated(machine.id);
    res.json(summary);
  }

  function runManagedMachineBatch(
    req: express.Request,
    res: express.Response,
    action: "start" | "stop" | "restart"
  ): void {
    const machineId = typeof req.params.machineId === "string" ? req.params.machineId : "";
    const owned = requireOwnedMachine(req, res, machineId);
    if (!owned) return;
    const { user, capabilityUser, bridgeCapability, machine } = owned;
    const serverId = machine.serverId ?? "local";
    const result = agentManagement.batchByMachine({
      operationId: `web-${randomUUID()}`,
      actorUserId: capabilityUser.id,
      serverId,
      source: {
        kind: "web_api",
        source: "web",
        requestingUserId: user.id,
        capabilityUserId: capabilityUser.id,
        bridgeTraceId: bridgeCapability ? randomUUID() : undefined,
        bridgePath: bridgeCapability?.bridgePath,
        sourceWorkspaceId: bridgeCapability?.sourceWorkspaceId,
        targetWorkspaceId: bridgeCapability?.targetWorkspaceId
      },
      machineId,
      action
    });
    const status = result.status === "denied"
      ? 403
      : result.errorCode === "machine_not_found"
        ? 404
        : result.errorCode === "machine_offline"
          ? 409
          : 200;
    if (status !== 200) {
      res.status(status).json({ error: result.errorCode });
      return;
    }

    emitRealtimeMachineUpdated(machineId);
    // 内部结果带 Agent/Computer 真源记录；公开 API 只返回操作字段，禁止泄露 runtime credential。
    const results = result.results.map((item) => ({
      agentId: item.agentId,
      agentName: item.agentName,
      operationId: item.operationId,
      status: item.status,
      ...(item.errorCode ? { errorCode: item.errorCode } : {}),
      ...(item.result?.startSent === undefined ? {} : { startSent: item.result.startSent }),
      ...(item.result?.stopSent === undefined ? {} : { stopSent: item.result.stopSent })
    }));
    res.json({
      ok: result.status === "completed",
      operationId: result.operationId,
      action: result.action,
      status: result.status,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      machineId: result.machine?.id ?? machineId,
      machineName: result.machine?.name,
      total: result.total,
      completed: result.completed,
      noop: result.noop,
      partial: result.partial,
      denied: result.denied,
      failed: result.failed,
      skipped: result.skipped,
      started: result.results.filter((item) => item.result?.startSent).length,
      stopped: result.results.filter((item) => item.result?.stopSent).length,
      results
    });
  }

  app.post("/api/machines/:machineId/start-all", (req, res) => {
    runManagedMachineBatch(req, res, "start");
  });

  app.post("/api/machines/:machineId/stop-all", (req, res) => {
    runManagedMachineBatch(req, res, "stop");
  });

  app.post("/api/machines/:machineId/restart-all", (req, res) => {
    runManagedMachineBatch(req, res, "restart");
  });

  app.post("/api/machines/:machineId/reset-all", (req, res) => {
    if (req.body?.mode !== "restart") {
      res.status(400).json({ error: "reset_mode_not_supported" });
      return;
    }
    // Reset All 复用当前 runtime 支持的 stop+start 语义，先不引入清理会话等破坏性动作。
    runMachineBatchEndpoint(req, res, "reset");
  });

  app.post("/api/machines/:machineId/runtimes/:runtime/models/detect", async (req, res) => {
    const owned = requireOwnedMachine(req, res, req.params.machineId);
    if (!owned) return;
    const { machine } = owned;
    const runtime = req.params.runtime as RuntimeId;
    if (!RUNTIMES.some((item) => item.id === runtime)) {
      res.status(400).json({ error: "runtime_not_supported" });
      return;
    }
    const result = await requestRuntimeModelDetection({
      machineId: machine.id,
      runtime,
      pendingRequests: runtimeModelRequests,
      sendToDaemon
    });
    if (result.status === "completed") {
      res.json({ models: result.models, default: result.defaultModel });
      return;
    }
    const status = result.errorCode === "daemon_offline"
      ? 503
      : result.errorCode === "runtime_models_timeout"
        ? 504
        : 502;
    res.status(status).json({ error: result.errorCode });
  });

  app.delete("/api/machines/:machineId", (req, res) => {
    const owned = requireOwnedMachine(req, res, req.params.machineId);
    if (!owned) return;
    const { machine } = owned;
    const result = store.deleteMachine(machine.id);
    if (!result.success) {
      const status = result.reason === "machine_has_agents" ? 409 : 400;
      res.status(status).json({ error: result.reason, agentCount: result.deletedAgents ?? 0 });
      return;
    }
    daemonSockets.get(machine.id)?.close();
    emitRealtimeMachineDeleted(machine);
    res.json({ deleted: true, archived: true });
  });
}
