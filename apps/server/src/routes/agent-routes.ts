import { randomUUID } from "node:crypto";
import type express from "express";
import { DEFAULT_RUNTIME_PERMISSION_MODE, RUNTIMES, isCommunicationAgent, runtimeResourceGrantsConflictWithPermissionMode, type AgentRecord, type RuntimeApprovalDecision, type RuntimePermissionMode, type RuntimeResourceGrant, type WorkspaceAgentNavItem, type WorkspaceHumanNavItem, type WorkspaceMachineNavItem } from "@tyr-ai/contracts";
import { createAgentManagementService, emitAgentNavigationRealtimeEvent, type AgentManagementResult } from "../agent-management-service";
import { formatAgentActivityTimelineResponse } from "../agent-activity-timeline";
import { backfillSafetyAudits } from "../safety-audit";
import type { ServerRouteContext } from "../server-context";
import { resolveRuntimeApprovalDecision } from "../runtime-approval-resolve";
import { sanitizeHumanVisibleValue } from "../output-disclosure";
import {
  canUserAccessRuntimeExecutionSource,
  canUserAccessSafetyAssessmentSource
} from "../conversation-source-access";

function managementHttpStatus(result: AgentManagementResult): number {
  // Service errorCode 是跨 Web/Assistant 的业务真源；HTTP 层只负责稳定映射，不重复权限和资源判断。
  if (result.status === "denied") return 403;
  if (result.errorCode === "agent_not_found" || result.errorCode === "machine_not_found") return 404;
  if (result.errorCode === "machine_offline") return 409;
  if (result.errorCode === "daemon_unavailable" && result.status === "failed") return 503;
  if (result.status === "failed") return 400;
  return 200;
}

export function registerAgentRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const {
    store,
    workspaceTreeRequests,
    workspaceReadRequests,
    skillRequests,
    requireAuthUser,
    authUser,
    primaryServerIdForUser,
    resolveWorkspaceBridgeCapability,
    isServerMember,
    isServerOwner,
    requireAgentRuntimeOwner,
    emitRealtimeRuntimeExecution,
    emitRealtimeRuntimeApproval,
    publishTerminalCommunicationFailure,
    emitRealtimeAgentActivity,
    emitRealtimeAgentStatus,
    parseAgentCapabilityList,
    formatChannel,
    formatSkill,
    formatActivityLog,
    gravatarHash,
    bindRuntimeApprovalToTaskExecution,
    publishWorkspaceSync,
    broadcastRealtime,
    safetyAuditConfig,
    startAgent,
    sendToDaemon,
    formatAgentListItem
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

  function managementServerId(userId: string): string {
    // Route 测试和最小嵌入场景可能不注入 helper；active Workspace 仍由同一个 store 真源解析。
    return primaryServerIdForUser?.(userId) ?? store.getActiveServerIdForUser(userId) ?? "local";
  }

  function targetServerIdForAgent(agentId: string, fallbackUserId: string): string {
    const agent = store.getAgent(agentId);
    const machine = agent?.machineId ? store.getMachine(agent.machineId) : null;
    return agent?.serverId ?? machine?.serverId ?? managementServerId(fallbackUserId);
  }

  function webManagementContext(userId: string, targetServerId: string) {
    const bridge = resolveWorkspaceBridgeCapability?.(userId, targetServerId) ?? null;
    return {
      actorUserId: bridge?.capabilityUserId ?? userId,
      serverId: targetServerId,
      source: {
        kind: "web_api" as const,
        source: "web" as const,
        requestingUserId: userId,
        capabilityUserId: bridge?.capabilityUserId ?? userId,
        bridgeTraceId: bridge ? randomUUID() : undefined,
        bridgePath: bridge?.bridgePath,
        sourceWorkspaceId: bridge?.sourceWorkspaceId,
        targetWorkspaceId: bridge?.targetWorkspaceId
      }
    };
  }

  function rejectCommunicationAgentRuntimeAction(agent: AgentRecord | null | undefined, res: express.Response): boolean {
    if (!isCommunicationAgent(agent)) return false;
    res.status(400).json({ error: "communication_agent_has_no_runtime" });
    return true;
  }

  function canViewAgentActivity(userId: string, agent: AgentRecord | null): agent is AgentRecord {
    return Boolean(agent && !agent.deletedAt && (
      agent.ownerUserId === userId ||
      store.canUserAccessResource(userId, "agent", agent.id, "view") ||
      store.canUserAccessResource(userId, "agent", agent.id, "message")
    ));
  }

  app.get("/api/agents", (req, res) => {
    const user = authUser(req);
    const bootstrap = store.workspaceBootstrap(user.id);
    const agentsPage = store.workspaceNavigation(user.id, { section: "agents", limit: 100 });
    const machinesPage = store.workspaceNavigation(user.id, { section: "machines", limit: 100 });
    const humansPage = store.workspaceNavigation(user.id, { section: "humans", limit: 100 });
    const machinesById = new Map((machinesPage.items as WorkspaceMachineNavItem[]).map((machine) => [machine.id, machine]));
    const humansById = new Map((humansPage.items as WorkspaceHumanNavItem[]).map((human) => [human.id, human]));
    const agents = (agentsPage.items as WorkspaceAgentNavItem[]).map((item) => {
      const agent = navAgentToRecord(item);
      const machine = agent.machineId ? machinesById.get(agent.machineId) : undefined;
      const creator = humansById.get(agent.ownerUserId) ?? (bootstrap.currentUser.id === agent.ownerUserId ? bootstrap.currentUser : null);
      return formatAgentListItem(agent, {
        serverId: agent.serverId ?? machine?.serverId ?? bootstrap.currentServer?.id ?? "local",
        creator: creator ? {
          type: "human",
          id: creator.id,
          name: creator.name,
          displayName: creator.displayName,
          avatarUrl: creator.avatarUrl ?? null,
          gravatarHash: gravatarHash(creator.email)
        } : null
      });
    });
    res.json(agents);
  });

  app.post("/api/agents", (req, res) => {
    const user = authUser(req);
    const body = req.body ?? {};
    if (!body.machineId || !body.name || !body.runtime) {
      res.status(400).json({
        code: "agent_create_fields_required",
        message: "Device, name, and CLI runtime are required."
      });
      return;
    }
    const runtimeDefinition = RUNTIMES.find((item) => item.id === String(body.runtime));
    if (!runtimeDefinition) {
      res.status(400).json({ error: "runtime_not_supported" });
      return;
    }
    const targetMachine = store.getMachine(String(body.machineId));
    const targetServerId = targetMachine?.serverId ?? managementServerId(user.id);
    const result = agentManagement.createAgent({
      operationId: `web-${randomUUID()}`,
      ...webManagementContext(user.id, targetServerId),
      machineId: String(body.machineId),
      name: String(body.name),
      runtime: runtimeDefinition.id,
      model: typeof body.model === "string" ? body.model : undefined,
      description: body.description,
      reasoningEffort: body.reasoningEffort,
      permissionMode: body.permissionMode,
      runtimeResourceGrants: Array.isArray(body.runtimeResourceGrants) ? body.runtimeResourceGrants as RuntimeResourceGrant[] : undefined,
      envVars: body.envVars
    });
    const status = managementHttpStatus(result);
    if (result.status === "denied" || result.status === "failed" || !result.agent) {
      res.status(status).json({ error: result.errorCode });
      return;
    }
    res.status(status).json({ agent: result.agent, started: Boolean(result.startSent) });
  });

  app.patch("/api/agents/:agentId", (req, res) => {
    const user = authUser(req);
    const body = req.body ?? {};
    const has = (field: string) => Object.prototype.hasOwnProperty.call(body, field);
    if (has("runtimeResourceGrants") && !Array.isArray(body.runtimeResourceGrants)) {
      res.status(400).json({ error: "invalid_runtime_resource_grants" });
      return;
    }
    if (has("displayName") && typeof body.displayName !== "string") {
      res.status(400).json({ error: "invalid_agent_name" });
      return;
    }
    if (has("name") && typeof body.name !== "string") {
      res.status(400).json({ error: "invalid_agent_name" });
      return;
    }
    if (has("name") && has("displayName") && body.name.trim() !== body.displayName.trim()) {
      res.status(400).json({ error: "conflicting_agent_name_fields" });
      return;
    }
    if (has("description") && body.description !== null && typeof body.description !== "string") {
      res.status(400).json({ error: "invalid_agent_description" });
      return;
    }
    if (has("model") && body.model !== null && typeof body.model !== "string") {
      res.status(400).json({ error: "model_not_available" });
      return;
    }
    let legacyAuthorizedAgent: AgentRecord | null = null;
    if (has("avatarUrl") || has("runtimeResourceGrants")) {
      // 混合 PATCH 必须先完成旧字段授权，不能先写新配置再因 resource grant 权限失败而留下部分更新。
      const owned = requireAgentRuntimeOwner(req, res);
      if (!owned) return;
      legacyAuthorizedAgent = owned.agent;
    }
    if (has("runtimeResourceGrants")) {
      const current = legacyAuthorizedAgent ?? store.getAgent(req.params.agentId);
      const permissionMode = (has("permissionMode") ? body.permissionMode : current?.permissionMode ?? DEFAULT_RUNTIME_PERMISSION_MODE) as RuntimePermissionMode;
      if (runtimeResourceGrantsConflictWithPermissionMode(permissionMode, body.runtimeResourceGrants as RuntimeResourceGrant[])) {
        res.status(400).json({ error: "incompatible_runtime_resource_grant" });
        return;
      }
    }

    const hasConfigurationUpdate = has("name") || has("displayName") || has("description") || has("model") || has("permissionMode");
    let result: AgentManagementResult | null = null;
    let updated: AgentRecord | null = null;
    if (hasConfigurationUpdate) {
      const targetServerId = targetServerIdForAgent(req.params.agentId, user.id);
      result = agentManagement.updateAgent({
        operationId: `web-${randomUUID()}`,
        ...webManagementContext(user.id, targetServerId),
        agentId: req.params.agentId,
        ...(has("displayName") || has("name") ? { name: (body.displayName ?? body.name) as string } : {}),
        ...(has("description") ? { description: body.description as string | null } : {}),
        ...(has("model") ? { model: body.model as string | null } : {}),
        ...(has("permissionMode") ? { permissionMode: body.permissionMode } : {})
      });
      const status = managementHttpStatus(result);
      if (result.status === "denied" || result.status === "failed" || !result.agent) {
        res.status(status).json({ error: result.errorCode });
        return;
      }
      updated = result.agent;
    } else {
      // 旧版 Allowed access / avatar PATCH 仍沿用原 owner helper；本次更新能力不扩大它们的授权范围。
      if (legacyAuthorizedAgent) updated = legacyAuthorizedAgent;
      else {
        const owned = requireAgentRuntimeOwner(req, res);
        if (!owned) return;
        updated = owned.agent;
      }
    }
    if (!updated) {
      res.status(404).json({ error: "agent_not_found" });
      return;
    }

    if (has("avatarUrl") && typeof body.avatarUrl === "string") {
      updated = store.updateAgentProfile(updated.id, { avatarUrl: body.avatarUrl }) ?? updated;
    }
    if (has("runtimeResourceGrants")) {
      updated = store.updateAgentRuntimeResourceGrants(updated.id, body.runtimeResourceGrants as RuntimeResourceGrant[]) ?? updated;
    }
    if (has("avatarUrl") || has("runtimeResourceGrants")) {
      // 旧版 profile/access 字段绕过 management service，仍需使其他标签页的 Agent 导航失效。
      emitAgentNavigationRealtimeEvent(broadcastRealtime, "agent:updated", {
        agentId: updated.id,
        machineId: updated.machineId,
        serverId: updated.serverId ?? targetServerIdForAgent(updated.id, user.id)
      });
    }
    res.json({
      agent: updated,
      changedFields: result?.changedFields ?? [],
      restartRequired: result?.restartRequired ?? false,
      profileApplyDeferred: result?.profileApplyDeferred ?? false,
      restarted: Boolean(result?.restartRequired && result.stopSent && result.startSent),
      partial: result?.status === "partial",
      errorCode: result?.errorCode ?? null
    });
  });

  app.post("/api/agents/:agentId/start", (req, res) => {
    const user = authUser(req);
    const targetServerId = targetServerIdForAgent(req.params.agentId, user.id);
    const result = agentManagement.startAgent({
      operationId: `web-${randomUUID()}`,
      ...webManagementContext(user.id, targetServerId),
      agentId: req.params.agentId
    });
    const status = managementHttpStatus(result);
    if (result.status === "denied" || result.status === "failed") {
      res.status(status).json({ error: result.errorCode });
      return;
    }
    // noop 表示 Agent 已在运行；公开响应保持成功，同时明确没有重复下发 start。
    res.status(status).json({
      ok: true,
      started: Boolean(result.startSent),
      ...(result.status === "noop" ? { alreadyRunning: true } : {})
    });
  });

  app.post("/api/agents/:agentId/stop", (req, res) => {
    const user = authUser(req);
    const targetServerId = targetServerIdForAgent(req.params.agentId, user.id);
    const result = agentManagement.stopAgent({
      operationId: `web-${randomUUID()}`,
      ...webManagementContext(user.id, targetServerId),
      agentId: req.params.agentId
    });
    const status = managementHttpStatus(result);
    if (result.status === "denied" || result.status === "failed") {
      res.status(status).json({ error: result.errorCode });
      return;
    }
    res.status(status).json({ ok: true, stopped: result.status === "noop" || Boolean(result.stopSent) });
  });

  app.post("/api/agents/:agentId/restart", (req, res) => {
    const user = authUser(req);
    const targetServerId = targetServerIdForAgent(req.params.agentId, user.id);
    const result = agentManagement.restartAgent({
      operationId: `web-${randomUUID()}`,
      ...webManagementContext(user.id, targetServerId),
      agentId: req.params.agentId
    });
    const status = managementHttpStatus(result);
    if (result.status === "denied" || result.status === "failed") {
      res.status(status).json({ error: result.errorCode });
      return;
    }
    const restarted = Boolean(result.startSent);
    res.status(status).json({ ok: restarted, restarted });
  });

  app.post("/api/agents/:agentId/reset", (req, res) => {
    if (req.body?.mode !== "restart") {
      res.status(400).json({ error: "reset_mode_not_supported" });
      return;
    }
    const user = authUser(req);
    const targetServerId = targetServerIdForAgent(req.params.agentId, user.id);
    const result = agentManagement.resetAgent({
      operationId: `web-${randomUUID()}`,
      ...webManagementContext(user.id, targetServerId),
      agentId: req.params.agentId
    });
    const status = managementHttpStatus(result);
    if (result.status === "denied" || result.status === "failed") {
      res.status(status).json({ error: result.errorCode });
      return;
    }
    res.status(status).json({
      ok: result.status === "completed",
      reset: Boolean(result.sessionCleared),
      restarted: Boolean(result.startSent),
      partial: result.status === "partial",
      errorCode: result.errorCode ?? null
    });
  });

  app.get("/api/agents/:agentId/scopes", (req, res) => {
    if (rejectCommunicationAgentRuntimeAction(store.getAgent(req.params.agentId), res)) return;
    const owned = requireAgentRuntimeOwner(req, res);
    if (!owned) return;
    const { agent } = owned;
    res.json(store.getAgentScopes(agent.id));
  });

  app.patch("/api/agents/:agentId/scopes", (req, res) => {
    if (rejectCommunicationAgentRuntimeAction(store.getAgent(req.params.agentId), res)) return;
    const owned = requireAgentRuntimeOwner(req, res);
    if (!owned) return;
    const { agent } = owned;
    const granted = parseAgentCapabilityList(req.body);
    if (!granted) {
      res.status(400).json({ error: "invalid_capabilities" });
      return;
    }
    // Agent capabilities are execution permissions, so the response includes revision metadata for UI conflict visibility.
    res.json(store.setAgentScopes(agent.id, granted));
  });

  app.delete("/api/agents/:agentId/scopes", (req, res) => {
    if (rejectCommunicationAgentRuntimeAction(store.getAgent(req.params.agentId), res)) return;
    const owned = requireAgentRuntimeOwner(req, res);
    if (!owned) return;
    const { agent } = owned;
    res.json(store.resetAgentScopes(agent.id));
  });

  app.get("/api/agents/:agentId/dm", (req, res) => {
    const user = authUser(req);
    const agent = store.getAgent(req.params.agentId);
    if (!agent) {
      res.status(404).json({ error: "agent_not_found" });
      return;
    }
    if (!store.canUserAccessResource(user.id, "agent", agent.id, "message")) {
      res.status(403).json({ error: "agent_grant_required" });
      return;
    }
    const channel = store.getOrCreateAgentDm(req.params.agentId, user.id);
    if (!channel) {
      res.status(403).json({ error: "agent_grant_required" });
      return;
    }
    res.json({ channel: formatChannel(channel) });
  });

  app.get("/api/agents/:agentId/agent-dms", (req, res) => {
    authUser(req);
    // Agent-Agent pair DM 是 delegation 内部传输层，不向 Human 提供列表或 Web 打开入口。
    res.status(404).json({ error: "not_found" });
  });

  app.delete("/api/agents/:agentId", (req, res) => {
    const user = authUser(req);
    const targetServerId = targetServerIdForAgent(req.params.agentId, user.id);
    const result = agentManagement.deleteAgent({
      operationId: `web-${randomUUID()}`,
      ...webManagementContext(user.id, targetServerId),
      agentId: req.params.agentId
    });
    const status = managementHttpStatus(result);
    if (result.status === "denied" || result.status === "failed" || !result.agent) {
      res.status(status).json({ error: result.errorCode });
      return;
    }
    // delete 的持久化语义由 service 统一处理；HTTP 仅保留既有 archived 别名。
    const deleted = Boolean(result.agent.deletedAt);
    res.status(status).json({ deleted, archived: deleted });
  });

  app.get("/api/agents/:agentId/workspace", (req, res) => {
    if (rejectCommunicationAgentRuntimeAction(store.getAgent(req.params.agentId), res)) return;
    const owned = requireAgentRuntimeOwner(req, res);
    if (!owned) return;
    const { agent, machine } = owned;
    const requestId = `workspace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const sent = sendToDaemon(machine.id, {
      type: "agent:workspace:list",
      agentId: agent.id,
      dirPath: String(req.query.dir || "."),
      requestId
    });
    if (!sent) {
      res.status(503).json({ error: "daemon_offline", workspacePath: agent.workspacePath });
      return;
    }
    const timer = setTimeout(() => {
      workspaceTreeRequests.delete(requestId);
      if (!res.headersSent) res.status(504).json({ error: "workspace_scan_timeout", workspacePath: agent.workspacePath });
    }, 2500);
    workspaceTreeRequests.set(requestId, {
      timer,
      resolve: (payload) => {
        clearTimeout(timer);
        if (!res.headersSent) res.json(sanitizeHumanVisibleValue({ ...payload, workspacePath: store.getAgent(agent.id)?.workspacePath }));
      }
    });
  });

  app.get("/api/agents/:agentId/workspace-files", (req, res) => {
    if (rejectCommunicationAgentRuntimeAction(store.getAgent(req.params.agentId), res)) return;
    const owned = requireAgentRuntimeOwner(req, res);
    if (!owned) return;
    const { agent, machine } = owned;
    const dirPath = String(req.query.dirPath || ".");
    const requestId = `workspace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const sent = sendToDaemon(machine.id, {
      type: "agent:workspace:list",
      agentId: agent.id,
      dirPath,
      requestId
    });
    if (!sent) {
      res.status(503).json({ error: "daemon_offline", workspacePath: agent.workspacePath });
      return;
    }
    const timer = setTimeout(() => {
      workspaceTreeRequests.delete(requestId);
      if (!res.headersSent) res.status(504).json({ error: "workspace_scan_timeout", workspacePath: agent.workspacePath });
    }, 2500);
    workspaceTreeRequests.set(requestId, {
      timer,
      resolve: (payload) => {
        clearTimeout(timer);
        if (res.headersSent) return;
        const body = { ...payload, workspacePath: store.getAgent(agent.id)?.workspacePath };
        if (req.query.dirPath) res.json(sanitizeHumanVisibleValue({ files: payload.files, dirPath: payload.dirPath, workspacePath: body.workspacePath }));
        else res.json(sanitizeHumanVisibleValue(payload.files));
      }
    });
  });

  app.get("/api/agents/:agentId/workspace-file", (req, res) => {
    if (rejectCommunicationAgentRuntimeAction(store.getAgent(req.params.agentId), res)) return;
    const owned = requireAgentRuntimeOwner(req, res);
    if (!owned) return;
    const { agent, machine } = owned;
    const filePath = String(req.query.path || "");
    if (!filePath) {
      res.status(400).json({ error: "path_required" });
      return;
    }
    const requestId = `workspace-read-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const sent = sendToDaemon(machine.id, { type: "agent:workspace:read", agentId: agent.id, path: filePath, requestId });
    if (!sent) {
      res.status(503).json({ error: "daemon_offline", workspacePath: agent.workspacePath });
      return;
    }
    const timer = setTimeout(() => {
      workspaceReadRequests.delete(requestId);
      if (!res.headersSent) res.status(504).json({ error: "workspace_read_timeout", workspacePath: agent.workspacePath });
    }, 2500);
    workspaceReadRequests.set(requestId, {
      timer,
      resolve: (payload) => {
        clearTimeout(timer);
        // Workspace 文件内容是 Agent 下游数据的人类出口，不能绕过统一凭据披露规则。
        if (!res.headersSent) res.json(sanitizeHumanVisibleValue(payload));
      }
    });
  });

  app.get("/api/agents/:agentId/skills", (req, res) => {
    if (rejectCommunicationAgentRuntimeAction(store.getAgent(req.params.agentId), res)) return;
    const owned = requireAgentRuntimeOwner(req, res);
    if (!owned) return;
    const { agent, machine } = owned;
    if (!agent.runtime) {
      res.status(400).json({ error: "agent_runtime_required" });
      return;
    }
    const requestId = `skills-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const sent = sendToDaemon(machine.id, { type: "agent:skills:list", agentId: agent.id, runtime: agent.runtime, requestId });
    if (!sent) {
      res.status(503).json({ error: "daemon_offline" });
      return;
    }
    const timer = setTimeout(() => {
      skillRequests.delete(requestId);
      if (!res.headersSent) res.status(504).json({ error: "skills_scan_timeout" });
    }, 2500);
    skillRequests.set(requestId, {
      timer,
      resolve: (payload) => {
        clearTimeout(timer);
        if (!res.headersSent) res.json({ global: payload.global.map(formatSkill), runtime: (payload.runtime ?? []).map(formatSkill), workspace: payload.workspace.map(formatSkill) });
      }
    });
  });

  app.get("/api/agents/:agentId/activity", (req, res) => {
    const user = authUser(req);
    res.setHeader("Cache-Control", "no-store");
    const agent = store.getAgent(req.params.agentId);
    if (!canViewAgentActivity(user.id, agent) || agent.ownerUserId !== user.id) {
      res.status(agent ? 403 : 404).json({ error: agent ? "agent_grant_required" : "agent_not_found" });
      return;
    }
    res.json(sanitizeHumanVisibleValue({ activity: store.listActivity(agent.id) }));
  });

  app.get("/api/agents/:agentId/activity-timeline", (req, res) => {
    const user = authUser(req);
    const agent = store.getAgent(req.params.agentId);
    if (!agent || agent.deletedAt) {
      res.status(404).json({ error: "agent_not_found" });
      return;
    }
    if (!canViewAgentActivity(user.id, agent)) {
      res.status(403).json({ error: "agent_grant_required" });
      return;
    }
    // Execution capability is not permission to inspect another Owner's private history.
    res.setHeader("Cache-Control", "no-store");
    res.json(sanitizeHumanVisibleValue(formatAgentActivityTimelineResponse(store, user.id, agent.id, {
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
      type: typeof req.query.type === "string" ? req.query.type : undefined,
      q: typeof req.query.q === "string" ? req.query.q : undefined
    })));
  });

  app.get("/api/agents/:agentId/activity-log", (req, res) => {
    const user = authUser(req);
    res.setHeader("Cache-Control", "no-store");
    const agent = store.getAgent(req.params.agentId);
    if (!canViewAgentActivity(user.id, agent) || agent.ownerUserId !== user.id) {
      res.status(agent ? 403 : 404).json({ error: agent ? "agent_grant_required" : "agent_not_found" });
      return;
    }
    res.json(formatActivityLog(agent.id, {
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0
    }));
  });

  app.post("/api/runtime-approvals/:approvalId/resolve", (req, res) => {
    const user = authUser(req);
    let approval = store.getRuntimeApproval(req.params.approvalId);
    const approvalAgent = approval ? store.getAgent(approval.agentId) : null;
    const approvalMachine = approvalAgent?.machineId ? store.getMachine(approvalAgent.machineId) : null;
    const approvalServerId = approval?.serverId ?? approvalAgent?.serverId ?? approvalMachine?.serverId ?? "local";
    const bridgeCapability = approval
      ? resolveWorkspaceBridgeCapability?.(user.id, approvalServerId) ?? null
      : null;
    const capabilityUserId = bridgeCapability?.capabilityUserId ?? user.id;
    if (
      !approval ||
      !isServerMember(capabilityUserId, approvalServerId) ||
      !store.canUserResolveRuntimeApproval(capabilityUserId, approval)
    ) {
      res.status(404).json({ error: "approval_not_found" });
      return;
    }
    approval = bindRuntimeApprovalToTaskExecution(approval);
    const decision = req.body?.decision as RuntimeApprovalDecision | undefined;
    if (decision !== "approve" && decision !== "reject" && decision !== "custom") {
      res.status(400).json({ error: "decision_required" });
      return;
    }
    const customResponse = typeof req.body?.customResponse === "string" ? req.body.customResponse.trim() : "";
    if (decision === "custom" && !customResponse) {
      res.status(400).json({ error: "custom_response_required" });
      return;
    }
    const result = resolveRuntimeApprovalDecision(ctx, {
      approval,
      decision,
      resolvedByUserId: user.id,
      customResponse: customResponse || undefined
    });
    if ("blocked" in result) {
      res.status(result.status).json(result.body);
      return;
    }
    res.json(sanitizeHumanVisibleValue(result));
  });

  app.get("/api/safety-assessments", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const serverId = typeof req.query.serverId === "string" ? req.query.serverId : primaryServerIdForUser(user.id);
    if (!serverId || !isServerMember(user.id, serverId)) {
      res.status(403).json({ error: "server_membership_required" });
      return;
    }
    res.json(sanitizeHumanVisibleValue({
      safetyAssessments: store.listSafetyAssessments({
        serverId,
        executionId: typeof req.query.executionId === "string" ? req.query.executionId : undefined,
        approvalId: typeof req.query.approvalId === "string" ? req.query.approvalId : undefined,
        taskId: typeof req.query.taskId === "string" ? req.query.taskId : undefined
      }).filter((assessment) => canUserAccessSafetyAssessmentSource(store, user.id, assessment))
    }));
  });

  app.post("/api/safety-assessments/backfill", async (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const serverId = typeof req.body?.serverId === "string" ? req.body.serverId : primaryServerIdForUser(user.id);
    if (!serverId || !isServerOwner(user.id, serverId)) {
      res.status(403).json({ error: "server_owner_required" });
      return;
    }
    const filter = {
      serverId,
      executionId: typeof req.body?.executionId === "string" ? req.body.executionId : undefined,
      messageId: typeof req.body?.messageId === "string" ? req.body.messageId : undefined,
      threadChannelId: typeof req.body?.threadChannelId === "string" ? req.body.threadChannelId : undefined
    };
    if (!filter.executionId && !filter.messageId && !filter.threadChannelId) {
      res.status(400).json({ error: "safety_backfill_target_required" });
      return;
    }
    const execution = filter.executionId ? store.getRuntimeExecution(filter.executionId) : null;
    const message = filter.messageId ? store.getMessage(filter.messageId) : null;
    const sourceVisible = (
      (!filter.executionId || Boolean(execution && canUserAccessRuntimeExecutionSource(store, user.id, execution))) &&
      (!filter.messageId || Boolean(message && store.canUserAccessChannel(user.id, message.channelId))) &&
      (!filter.threadChannelId || store.canUserAccessChannel(user.id, filter.threadChannelId))
    );
    // Safety backfill may call an external judge, so cold or inaccessible source context must never leave the server.
    if (!sourceVisible) {
      res.status(404).json({ error: "safety_backfill_target_not_found" });
      return;
    }
    const result = await backfillSafetyAudits({ store, config: safetyAuditConfig, filter });
    publishWorkspaceSync();
    res.json(sanitizeHumanVisibleValue(result));
  });
}

function navAgentToRecord(agent: WorkspaceAgentNavItem): AgentRecord {
  return {
    ...agent,
    authToken: ""
  };
}
