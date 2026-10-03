import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type express from "express";
import {
  isCommunicationAgent,
  MAX_WORKSPACE_ROUTING_INSTRUCTIONS_LENGTH,
  RUNTIMES,
  type PlatformOperatorCityOverviewPayload,
  type PlatformOperatorExecutionViewPayload,
  type PlatformOperatorRecord,
  type PlatformOperatorWorkspaceRecord,
  type PlatformOperatorWorkspaceViewPayload,
  type RuntimeApprovalDecision,
  type RuntimeApprovalRecord,
  type RuntimePermissionMode,
  type RuntimeId,
  type TyrHeartbeatIntervalUnit,
  type WorkspaceSharedFilePermission
} from "@tyr-ai/contracts";
import { WorkspaceRoutingInstructionsRevisionConflictError } from "@tyr-ai/db";

import { createAgentManagementService, type AgentManagementResult } from "../agent-management-service";
import type { ServerRouteContext } from "../server-context";
import { operatorCityMapSite } from "../operator-city-map-site";
import { operatorLiveWorkPayload } from "../operator-live-work";
import { resolveRuntimeApprovalDecision } from "../runtime-approval-resolve";
import { requestRuntimeModelDetection } from "../runtime-model-detection";
import { WorkspaceSharedFileError, type WorkspaceSharedFileAssignmentInput } from "../workspace-shared-files";

const OPERATOR_COOKIE = "tyr_platform_operator_session";
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map<string, { count: number; resetAt: number }>();

function cookieValue(req: express.Request, name: string): string | null {
  const cookie = req.header("cookie") ?? "";
  for (const item of cookie.split(";")) {
    const index = item.indexOf("=");
    if (index < 0 || item.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function operatorCookiePath(publicServerUrl: string): string {
  try {
    const pathname = new URL(publicServerUrl).pathname.replace(/\/$/, "");
    return `${pathname}/api/operator` || "/api/operator";
  } catch {
    return "/api/operator";
  }
}

function sessionCookie(publicServerUrl: string, value: string, maxAgeSeconds: number): string {
  const secure = publicServerUrl.startsWith("https://") ? "; Secure" : "";
  // Cookie 仅在 Operator API 路径发送，不会进入普通 Owner API 或 WebSocket 请求。
  return `${OPERATOR_COOKIE}=${encodeURIComponent(value)}; Path=${operatorCookiePath(publicServerUrl)}; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

function loginRateKey(req: express.Request, login: string): string {
  return `${req.ip}|${createHash("sha256").update(login.trim().toLowerCase()).digest("hex").slice(0, 16)}`;
}

function loginBlocked(key: string, now = Date.now()): boolean {
  const current = loginFailures.get(key);
  if (!current || current.resetAt <= now) {
    loginFailures.delete(key);
    return false;
  }
  return current.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(key: string, now = Date.now()): void {
  const current = loginFailures.get(key);
  loginFailures.set(key, current && current.resetAt > now
    ? { ...current, count: current.count + 1 }
    : { count: 1, resetAt: now + LOGIN_WINDOW_MS });
}

function operatorForRequest(req: express.Request, ctx: ServerRouteContext): PlatformOperatorRecord | null {
  const token = cookieValue(req, OPERATOR_COOKIE);
  return token ? ctx.store.getPlatformOperatorBySessionToken(token) : null;
}

function requireOperator(req: express.Request, res: express.Response, ctx: ServerRouteContext): PlatformOperatorRecord | null {
  const operator = operatorForRequest(req, ctx);
  if (!operator) res.status(401).json({ error: "operator_unauthorized" });
  return operator;
}

function requireOperatorWorkspace(
  req: express.Request,
  res: express.Response,
  ctx: ServerRouteContext,
  serverId: string
): { operator: PlatformOperatorRecord; workspace: PlatformOperatorWorkspaceRecord } | null {
  const operator = requireOperator(req, res, ctx);
  if (!operator) return null;
  const workspace = ctx.store.listPlatformOperatorWorkspaces(operator.id).find((item) => item.serverId === serverId);
  if (!workspace) {
    res.status(404).json({ error: "server_not_found" });
    return null;
  }
  // 唯一 Global Operator 对所有真实 Workspace 拥有现有 Operator 能力，不再依赖历史 scope grant。
  return { operator, workspace };
}

function managementHttpStatus(result: AgentManagementResult): number {
  if (result.status === "denied") return 403;
  if (result.errorCode === "agent_not_found" || result.errorCode === "machine_not_found") return 404;
  if (result.errorCode === "machine_offline") return 409;
  if (result.errorCode === "daemon_unavailable" && result.status === "failed") return 503;
  if (result.status === "failed") return 400;
  return 200;
}

function auditReason(body: unknown): { reason: string; reference: string } | null {
  if (!body || typeof body !== "object") return null;
  const input = body as Record<string, unknown>;
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  return reason.length >= 8 && reason.length <= 500 && reference.length >= 1 && reference.length <= 200
    ? { reason, reference }
    : null;
}

function safeAgent(agent: NonNullable<ReturnType<ServerRouteContext["store"]["getAgent"]>>) {
  const { authToken: _authToken, ...safe } = agent;
  return safe;
}

function safeMachine(machine: NonNullable<ReturnType<ServerRouteContext["store"]["getMachine"]>>) {
  const {
    apiKey: _apiKey,
    connectorToken: _connectorToken,
    pendingConnectorToken: _pendingConnectorToken,
    previousConnectorToken: _previousConnectorToken,
    ...safe
  } = machine as typeof machine & { pendingConnectorToken?: string; previousConnectorToken?: string };
  return safe;
}

function safeDevice(device: ReturnType<ServerRouteContext["store"]["listDevices"]>[number]) {
  const { deviceToken: _deviceToken, ...safe } = device;
  return safe;
}

function heartbeatIntervalUnit(value: unknown): TyrHeartbeatIntervalUnit | undefined {
  return value === "minute" || value === "hour" ? value : undefined;
}

function sharedFileAssignments(value: unknown): WorkspaceSharedFileAssignmentInput[] | undefined {
  if (value === undefined) return undefined;
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new WorkspaceSharedFileError("workspace_shared_file_assignments_invalid", 400);
    }
  }
  if (!Array.isArray(parsed)) throw new WorkspaceSharedFileError("workspace_shared_file_assignments_invalid", 400);
  return parsed.map((value) => {
    if (!value || typeof value !== "object") throw new WorkspaceSharedFileError("workspace_shared_file_assignments_invalid", 400);
    const item = value as Record<string, unknown>;
    const agentId = typeof item.agentId === "string" ? item.agentId.trim() : "";
    const permission: WorkspaceSharedFilePermission = item.permission === "read-only" ? "read-only" : "read-write";
    if (!agentId || (item.permission !== undefined && item.permission !== "read-only" && item.permission !== "read-write")) {
      throw new WorkspaceSharedFileError("workspace_shared_file_assignments_invalid", 400);
    }
    return { agentId, permission };
  });
}

function operatorSharedFileError(res: express.Response, error: unknown): void {
  if (error instanceof WorkspaceSharedFileError) {
    res.status(error.status).json({ error: error.code });
    return;
  }
  res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
}

function uniqueRecordsById<T extends { id: string }>(records: T[]): T[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
}

function runtimeApprovalServerId(ctx: ServerRouteContext, approval: RuntimeApprovalRecord): string {
  const agent = ctx.store.getAgent(approval.agentId);
  const machine = ctx.store.getMachine(approval.machineId);
  return approval.serverId ?? agent?.serverId ?? machine?.serverId ?? "local";
}

function recordSharedFileOperatorMutation(
  ctx: ServerRouteContext,
  operator: PlatformOperatorRecord,
  serverId: string,
  fileId: string,
  kind: string,
  audit: { reason: string; reference: string; previousVersion?: number },
  version: number
): void {
  ctx.store.recordAuditEvent({
    kind,
    actorType: "platform_operator",
    actorId: operator.id,
    resourceType: "workspace_shared_file",
    resourceId: fileId,
    serverId,
    metadata: { version, ...audit }
  });
  ctx.publishWorkspaceSync();
}

export function registerOperatorRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const agentManagement = createAgentManagementService({
    store: ctx.store,
    startAgent: ctx.startAgent,
    sendToDaemon: ctx.sendToDaemon,
    emitRealtimeAgentStatus: ctx.emitRealtimeAgentStatus,
    emitRealtimeRuntimeExecution: ctx.emitRealtimeRuntimeExecution,
    emitRealtimeRuntimeApproval: ctx.emitRealtimeRuntimeApproval,
    publishTerminalCommunicationFailure: ctx.publishTerminalCommunicationFailure,
    broadcastRealtime: ctx.broadcastRealtime,
    publishWorkspaceSync: ctx.publishWorkspaceSync
  });

  app.post("/api/operator/auth/login", (req, res) => {
    const login = String(req.body?.login ?? "");
    const key = loginRateKey(req, login);
    if (loginBlocked(key)) {
      res.status(429).json({ error: "operator_login_rate_limited" });
      return;
    }
    const result = ctx.store.loginPlatformOperator({ login, password: String(req.body?.password ?? "") });
    if (!result) {
      recordLoginFailure(key);
      ctx.store.recordAuditEvent({
        kind: "platform_operator_login_failed",
        actorType: "platform_operator",
        actorId: null,
        resourceType: "server",
        resourceId: null,
        metadata: { loginFingerprint: key.split("|").at(-1) ?? null, remoteAddress: req.ip ?? null }
      });
      res.status(401).json({ error: "invalid_operator_credentials" });
      return;
    }
    loginFailures.delete(key);
    const maxAgeSeconds = Math.max(0, Math.floor((Date.parse(result.expiresAt) - Date.now()) / 1000));
    res.setHeader("Set-Cookie", sessionCookie(ctx.publicServerUrl, result.sessionToken, maxAgeSeconds));
    ctx.store.recordAuditEvent({
      kind: "platform_operator_login",
      actorType: "platform_operator",
      actorId: result.operator.id,
      resourceType: "server",
      resourceId: null,
      metadata: { remoteAddress: req.ip ?? null }
    });
    res.json({ operator: result.operator, workspaces: ctx.store.listPlatformOperatorWorkspaces(result.operator.id), expiresAt: result.expiresAt });
  });

  app.get("/api/operator/auth/session", (req, res) => {
    const operator = requireOperator(req, res, ctx);
    if (!operator) return;
    res.json({ operator, workspaces: ctx.store.listPlatformOperatorWorkspaces(operator.id) });
  });

  app.get("/api/operator/auth/status", (req, res) => {
    const token = cookieValue(req, OPERATOR_COOKIE);
    const operator = token ? ctx.store.getPlatformOperatorBySessionToken(token) : null;
    // 登录页用非错误响应探测 HttpOnly session，避免未登录这一正常状态制造 401 控制台噪音。
    if (!operator) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      operator,
      workspaces: ctx.store.listPlatformOperatorWorkspaces(operator.id)
    });
  });

  app.post("/api/operator/auth/logout", (req, res) => {
    const token = cookieValue(req, OPERATOR_COOKIE);
    const operator = token ? ctx.store.getPlatformOperatorBySessionToken(token) : null;
    if (token) ctx.store.revokePlatformOperatorSession(token);
    res.setHeader("Set-Cookie", sessionCookie(ctx.publicServerUrl, "", 0));
    if (operator) {
      ctx.store.recordAuditEvent({
        kind: "platform_operator_logout",
        actorType: "platform_operator",
        actorId: operator.id,
        resourceType: "server",
        resourceId: null
      });
    }
    res.json({ ok: true });
  });

  app.get("/api/operator/workspaces", (req, res) => {
    const operator = requireOperator(req, res, ctx);
    if (!operator) return;
    res.json({ workspaces: ctx.store.listPlatformOperatorWorkspaces(operator.id) });
  });

  app.get("/api/operator/city/overview", (req, res) => {
    const operator = requireOperator(req, res, ctx);
    if (!operator) return;
    const observedAt = new Date().toISOString();
    const workspaces = ctx.store.listPlatformOperatorWorkspaces(operator.id);
    const visibleIds = new Set(workspaces.map((workspace) => workspace.serverId));
    const activeUpdatedAfter = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    const terminalUpdatedAfter = new Date(Date.now() - 15 * 60 * 1_000).toISOString();
    const bridgeById = new Map<string, PlatformOperatorCityOverviewPayload["bridges"][number]>();
    const summaries = workspaces.map((workspace) => {
      const agents = ctx.store.listAgents(workspace.serverId);
      const controller = agents.find(isCommunicationAgent);
      const mapSite = controller ? operatorCityMapSite(ctx.store.getUser(controller.ownerUserId)?.email) : undefined;
      const devices = ctx.store.listMachines(workspace.serverId);
      const executions = ctx.store.listTopologyRuntimeExecutions({
        serverId: workspace.serverId,
        activeUpdatedAfter,
        terminalUpdatedAfter,
        limit: 1_000
      });
      for (const bridge of ctx.store.listWorkspaceBridges(workspace.serverId)) {
        if (bridge.status !== "active" || !visibleIds.has(bridge.workspaceAId) || !visibleIds.has(bridge.workspaceBId)) continue;
        bridgeById.set(bridge.id, { id: bridge.id, workspaceAId: bridge.workspaceAId, workspaceBId: bridge.workspaceBId, direction: bridge.direction });
      }
      // 城市层只汇总在线与执行计数；不读取 DM、消息正文、附件或 Runtime 事件。
      const active = executions.filter((execution) => ["queued", "delivered", "running", "waiting_approval"].includes(execution.status));
      return {
        ...workspace,
        ...(mapSite ? { mapSite } : {}),
        devicesOnline: devices.filter((device) => device.status === "online").length,
        devicesTotal: devices.length,
        agentsOnline: agents.filter((agent) => agent.status === "online" || agent.status === "working").length,
        agentsTotal: agents.length,
        activeExecutions: active.length,
        waitingApprovals: active.filter((execution) => execution.status === "waiting_approval").length,
        lastActivityAt: executions[0]?.updatedAt ?? null
      };
    });
    const payload: PlatformOperatorCityOverviewPayload = {
      observedAt,
      workspaces: summaries,
      bridges: [...bridgeById.values()]
    };
    res.json(payload);
  });

  app.get("/api/operator/workspaces/:serverId/view", (req, res) => {
    const access = requireOperatorWorkspace(req, res, ctx, req.params.serverId);
    if (!access) return;
    const { operator, workspace } = access;
    // Operator 复用 Workspace View 的拓扑数据，但不获得 Agent、Device 或 connector 的执行凭据。
    const machines = ctx.store.listMachines(req.params.serverId).map((machine) => ({
      ...safeMachine(machine),
      runtimes: ctx.store.listRuntimeReports(machine.id)
    }));
    const bridges = ctx.store.listWorkspaceBridges(req.params.serverId);
    const interactions = bridges.flatMap((bridge) => ctx.store.listCrossWorkspaceMessages(bridge.id));
    const topology = ctx.store.workspaceBridgeTopology(req.params.serverId);
    ctx.store.recordAuditEvent({
      kind: "platform_operator_workspace_view",
      actorType: "platform_operator",
      actorId: operator.id,
      resourceType: "server",
      resourceId: req.params.serverId,
      serverId: req.params.serverId,
      metadata: { bridgeCount: bridges.length, interactionCount: interactions.length }
    });
    const payload: PlatformOperatorWorkspaceViewPayload = {
      workspace,
      agents: ctx.store.listAgents(req.params.serverId).map(safeAgent),
      machines,
      devices: ctx.store.listDevices(req.params.serverId).map(safeDevice),
      bridges,
      interactions,
      ...topology
    };
    res.json(payload);
  });

  app.get("/api/operator/workspaces/:serverId/live-work", (req, res) => {
    const serverId = String(req.params.serverId);
    if (!requireOperatorWorkspace(req, res, ctx, serverId)) return;
    // 只返回动画所需的脱敏状态；私人 DM 正文和定位 ID 由投影层主动移除。
    res.json(operatorLiveWorkPayload(ctx, serverId));
  });

  app.get("/api/operator/workspaces/:serverId/executions/:executionId", (req, res) => {
    const serverId = String(req.params.serverId);
    if (!requireOperatorWorkspace(req, res, ctx, serverId)) return;
    const execution = ctx.store.getRuntimeExecution(String(req.params.executionId));
    const agent = execution ? ctx.store.getAgent(execution.agentId) : null;
    const machine = execution ? ctx.store.getMachine(execution.machineId) : null;
    const executionServerId = execution?.serverId ?? agent?.serverId ?? machine?.serverId ?? "local";
    if (!execution || executionServerId !== serverId) {
      res.status(404).json({ error: "execution_not_found" });
      return;
    }
    const approvals = ctx.store.listRuntimeApprovals({ executionId: execution.id, limit: 1_000 });
    const approvalIds = approvals.map((approval) => approval.id);
    // Operator 是超管主体：显式打开执行后返回完整真源，不走 Owner Web 的脱敏或同步压缩链路。
    const payload: PlatformOperatorExecutionViewPayload = {
      execution,
      prompt: ctx.store.getMessage(execution.messageId)?.content ?? "",
      events: ctx.store.listRuntimeExecutionEvents(execution.id),
      approvals,
      safetyAssessments: uniqueRecordsById([
        ...ctx.store.listSafetyAssessments({ executionId: execution.id, limit: 1_000 }),
        ...approvalIds.flatMap((approvalId) => ctx.store.listSafetyAssessments({ approvalId, limit: 1_000 }))
      ]),
      governanceDecisions: uniqueRecordsById([
        ...ctx.store.listGovernanceDecisions({ executionId: execution.id, limit: 1_000 }),
        ...approvalIds.flatMap((approvalId) => ctx.store.listGovernanceDecisions({ approvalId, limit: 1_000 }))
      ])
    };
    res.json(payload);
  });

  app.post("/api/operator/workspaces/:serverId/runtime-approvals/:approvalId/resolve", (req, res) => {
    const serverId = String(req.params.serverId);
    const access = requireOperatorWorkspace(req, res, ctx, serverId);
    if (!access) return;
    const audit = auditReason(req.body);
    if (!audit) {
      res.status(400).json({ error: "operator_audit_metadata_required" });
      return;
    }
    let approval = ctx.store.getRuntimeApproval(String(req.params.approvalId));
    if (!approval || runtimeApprovalServerId(ctx, approval) !== serverId) {
      res.status(404).json({ error: "approval_not_found" });
      return;
    }
    approval = ctx.bindRuntimeApprovalToTaskExecution(approval);
    const execution = approval.executionId ? ctx.store.getRuntimeExecution(approval.executionId) : null;
    if (!execution || (execution.serverId ?? runtimeApprovalServerId(ctx, approval)) !== serverId) {
      // Bridge 场景只允许在当前所选 Workspace 处理本侧 execution，不能跨到对端审批面。
      res.status(404).json({ error: "approval_not_found" });
      return;
    }
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
    const wasPending = approval.status === "pending";
    const result = resolveRuntimeApprovalDecision(ctx, {
      approval,
      decision,
      resolvedByUserId: `platform:${access.operator.id}`,
      customResponse: customResponse || undefined
    });
    if ("blocked" in result) {
      res.status(result.status).json(result.body);
      return;
    }
    if (wasPending) {
      // 决策成功后才写 Operator 审计；幂等重放不会重复制造变更记录。
      ctx.store.recordAuditEvent({
        kind: "platform_operator_runtime_approval_resolved",
        actorType: "platform_operator",
        actorId: access.operator.id,
        resourceType: "server",
        resourceId: serverId,
        serverId,
        metadata: {
          ...audit,
          approvalId: result.approval.id,
          executionId: execution.id,
          decision,
          delivered: result.delivered
        }
      });
      ctx.publishWorkspaceSync();
    }
    res.json(result);
  });

  app.get("/api/operator/workspaces/:serverId/audit", (req, res) => {
    if (!requireOperatorWorkspace(req, res, ctx, req.params.serverId)) return;
    const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 100) || 100));
    res.json({ auditEvents: ctx.store.listAuditEvents({ serverId: req.params.serverId, limit, order: "desc" }) });
  });

  app.get("/api/operator/workspaces/:serverId/routing-instructions", (req, res) => {
    if (!requireOperatorWorkspace(req, res, ctx, req.params.serverId)) return;
    res.json(ctx.store.getWorkspaceRoutingInstructions(req.params.serverId));
  });

  app.patch("/api/operator/workspaces/:serverId/routing-instructions", (req, res) => {
    const access = requireOperatorWorkspace(req, res, ctx, req.params.serverId);
    if (!access) return;
    const { operator } = access;
    const audit = auditReason(req.body);
    if (!audit) {
      res.status(400).json({ error: "operator_audit_metadata_required" });
      return;
    }
    if (typeof req.body?.instructions !== "string") {
      res.status(400).json({ error: "routing_instructions_required" });
      return;
    }
    if (req.body.instructions.length > MAX_WORKSPACE_ROUTING_INSTRUCTIONS_LENGTH) {
      res.status(400).json({ error: "routing_instructions_too_long" });
      return;
    }
    if (!Number.isInteger(req.body?.expectedRevision) || req.body.expectedRevision < 0) {
      res.status(400).json({ error: "routing_instructions_revision_required" });
      return;
    }
    try {
      const updated = ctx.store.setWorkspaceRoutingInstructions(req.params.serverId, req.body.instructions, {
        actorType: "platform_operator",
        actorId: operator.id,
        expectedRevision: req.body.expectedRevision,
        auditMetadata: audit
      });
      if (!updated) {
        res.status(404).json({ error: "server_not_found" });
        return;
      }
      ctx.publishWorkspaceSync();
      res.json(updated);
    } catch (error) {
      if (error instanceof WorkspaceRoutingInstructionsRevisionConflictError) {
        res.status(409).json({ error: error.message, current: error.current });
        return;
      }
      throw error;
    }
  });

  app.get("/api/operator/workspaces/:serverId/heartbeats", (req, res) => {
    if (!requireOperatorWorkspace(req, res, ctx, req.params.serverId)) return;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 100) || 100));
    res.json({
      heartbeats: ctx.store.listTyrHeartbeats(req.params.serverId),
      runs: ctx.store.listTyrHeartbeatRuns({ serverId: req.params.serverId, limit })
    });
  });

  app.post("/api/operator/workspaces/:serverId/heartbeats", (req, res) => {
    const access = requireOperatorWorkspace(req, res, ctx, req.params.serverId);
    if (!access) return;
    const { operator } = access;
    const audit = auditReason(req.body);
    if (!audit) {
      res.status(400).json({ error: "operator_audit_metadata_required" });
      return;
    }
    try {
      const tyr = ctx.store.ensureDefaultCommunicationAgent(req.params.serverId);
      const heartbeat = ctx.store.createTyrHeartbeat({
        serverId: req.params.serverId,
        tyrAgentId: tyr.id,
        title: String(req.body?.title ?? ""),
        instruction: String(req.body?.instruction ?? ""),
        intervalUnit: heartbeatIntervalUnit(req.body?.intervalUnit) ?? req.body?.intervalUnit,
        intervalValue: Number(req.body?.intervalValue),
        createdByOperatorId: operator.id
      });
      ctx.store.recordAuditEvent({
        kind: "platform_operator_heartbeat_created",
        actorType: "platform_operator",
        actorId: operator.id,
        resourceType: "server",
        resourceId: req.params.serverId,
        serverId: req.params.serverId,
        metadata: { heartbeatId: heartbeat.id, ...audit }
      });
      ctx.publishWorkspaceSync();
      res.status(201).json({ heartbeat });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch("/api/operator/workspaces/:serverId/heartbeats/:heartbeatId", (req, res) => {
    const access = requireOperatorWorkspace(req, res, ctx, req.params.serverId);
    if (!access) return;
    const { operator } = access;
    const audit = auditReason(req.body);
    if (!audit) {
      res.status(400).json({ error: "operator_audit_metadata_required" });
      return;
    }
    try {
      const heartbeat = ctx.store.updateTyrHeartbeat(req.params.heartbeatId, req.params.serverId, {
        ...(Object.prototype.hasOwnProperty.call(req.body, "title") ? { title: String(req.body.title ?? "") } : {}),
        ...(Object.prototype.hasOwnProperty.call(req.body, "instruction") ? { instruction: String(req.body.instruction ?? "") } : {}),
        ...(Object.prototype.hasOwnProperty.call(req.body, "intervalUnit") ? { intervalUnit: heartbeatIntervalUnit(req.body.intervalUnit) ?? req.body.intervalUnit } : {}),
        ...(Object.prototype.hasOwnProperty.call(req.body, "intervalValue") ? { intervalValue: Number(req.body.intervalValue) } : {}),
        ...(Object.prototype.hasOwnProperty.call(req.body, "enabled") ? { enabled: req.body.enabled === true } : {})
      });
      if (!heartbeat) {
        res.status(404).json({ error: "heartbeat_not_found" });
        return;
      }
      // Operator 暂停与 Owner 语义一致，且审计记录精确包含被撤销的排队周期数量。
      const cancelledRuns = Object.prototype.hasOwnProperty.call(req.body, "enabled") && req.body.enabled !== true
        ? ctx.store.cancelQueuedTyrHeartbeatRuns(heartbeat.id)
        : [];
      ctx.store.recordAuditEvent({
        kind: "platform_operator_heartbeat_updated",
        actorType: "platform_operator",
        actorId: operator.id,
        resourceType: "server",
        resourceId: req.params.serverId,
        serverId: req.params.serverId,
        metadata: { heartbeatId: heartbeat.id, enabled: heartbeat.enabled, cancelledQueuedRuns: cancelledRuns.length, ...audit }
      });
      ctx.publishWorkspaceSync();
      res.json({ heartbeat, cancelledRuns });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/operator/workspaces/:serverId/shared-files", (req, res) => {
    const serverId = String(req.params.serverId);
    if (!requireOperatorWorkspace(req, res, ctx, serverId)) return;
    res.json({ files: ctx.workspaceSharedFiles.list(serverId) });
  });

  app.get("/api/operator/workspaces/:serverId/shared-files/:fileId/content", (req, res) => {
    const serverId = String(req.params.serverId);
    if (!requireOperatorWorkspace(req, res, ctx, serverId)) return;
    const variant = req.query.variant === undefined || req.query.variant === "working"
      ? "working"
      : req.query.variant === "original"
        ? "original"
        : null;
    if (!variant) {
      res.status(400).json({ error: "workspace_shared_file_variant_invalid" });
      return;
    }
    const result = ctx.workspaceSharedFiles.content(String(req.params.fileId), serverId, variant);
    if (!result) {
      res.status(404).json({ error: "workspace_shared_file_not_found" });
      return;
    }
    const disposition = req.query.disposition === "inline" ? "inline" : "attachment";
    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Length", String(result.contents.byteLength));
    res.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(result.name)}`);
    res.send(result.contents);
  });

  app.post("/api/operator/workspaces/:serverId/shared-files/:fileId/reset", (req, res) => {
    const serverId = String(req.params.serverId);
    const access = requireOperatorWorkspace(req, res, ctx, serverId);
    if (!access) return;
    const { operator } = access;
    const audit = auditReason(req.body);
    if (!audit) {
      res.status(400).json({ error: "operator_audit_metadata_required" });
      return;
    }
    try {
      const expectedVersion = Number(req.body?.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new WorkspaceSharedFileError("workspace_shared_file_version_invalid", 400);
      const file = ctx.workspaceSharedFiles.reset({
        fileId: String(req.params.fileId),
        serverId,
        expectedVersion
      });
      recordSharedFileOperatorMutation(ctx, operator, serverId, file.id, "platform_operator_workspace_shared_file_reset", {
        ...audit,
        previousVersion: expectedVersion
      }, file.version);
      res.json({ file });
    } catch (error) {
      operatorSharedFileError(res, error);
    }
  });

  app.post("/api/operator/workspaces/:serverId/shared-files", ctx.upload.single("file"), (req, res) => {
    const serverId = String(req.params.serverId);
    const access = requireOperatorWorkspace(req, res, ctx, serverId);
    if (!access) {
      ctx.cleanupUploadedFile(req.file);
      return;
    }
    const { operator } = access;
    const audit = auditReason(req.body);
    if (!audit || !req.file) {
      ctx.cleanupUploadedFile(req.file);
      res.status(400).json({ error: audit ? "workspace_shared_file_required" : "operator_audit_metadata_required" });
      return;
    }
    try {
      const name = ctx.uploadFilename(typeof req.body?.name === "string" ? req.body.name : req.file.originalname);
      const file = ctx.workspaceSharedFiles.create({
        serverId,
        name,
        mimeType: req.file.mimetype || "application/octet-stream",
        contents: readFileSync(req.file.path),
        assignments: sharedFileAssignments(req.body?.assignments) ?? [],
        actor: { operatorId: operator.id }
      });
      recordSharedFileOperatorMutation(ctx, operator, serverId, file.id, "platform_operator_workspace_shared_file_created", audit, file.version);
      res.status(201).json({ file });
    } catch (error) {
      operatorSharedFileError(res, error);
    } finally {
      ctx.cleanupUploadedFile(req.file);
    }
  });

  app.patch("/api/operator/workspaces/:serverId/shared-files/:fileId", (req, res) => {
    const serverId = String(req.params.serverId);
    const access = requireOperatorWorkspace(req, res, ctx, serverId);
    if (!access) return;
    const { operator } = access;
    const audit = auditReason(req.body);
    if (!audit) {
      res.status(400).json({ error: "operator_audit_metadata_required" });
      return;
    }
    try {
      const file = ctx.workspaceSharedFiles.updateMetadata({
        fileId: String(req.params.fileId),
        serverId,
        name: typeof req.body?.name === "string" ? req.body.name : undefined,
        assignments: sharedFileAssignments(req.body?.assignments),
        actor: { operatorId: operator.id }
      });
      recordSharedFileOperatorMutation(ctx, operator, serverId, file.id, "platform_operator_workspace_shared_file_updated", audit, file.version);
      res.json({ file });
    } catch (error) {
      operatorSharedFileError(res, error);
    }
  });

  app.put("/api/operator/workspaces/:serverId/shared-files/:fileId/content", ctx.upload.single("file"), (req, res) => {
    const serverId = String(req.params.serverId);
    const access = requireOperatorWorkspace(req, res, ctx, serverId);
    if (!access) {
      ctx.cleanupUploadedFile(req.file);
      return;
    }
    const { operator } = access;
    const audit = auditReason(req.body);
    if (!audit || !req.file) {
      ctx.cleanupUploadedFile(req.file);
      res.status(400).json({ error: audit ? "workspace_shared_file_required" : "operator_audit_metadata_required" });
      return;
    }
    try {
      const expectedVersion = Number(req.body?.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new WorkspaceSharedFileError("workspace_shared_file_version_invalid", 400);
      const file = ctx.workspaceSharedFiles.replace({
        fileId: String(req.params.fileId),
        serverId,
        expectedVersion,
        mimeType: req.file.mimetype || "application/octet-stream",
        contents: readFileSync(req.file.path)
      });
      recordSharedFileOperatorMutation(ctx, operator, serverId, file.id, "platform_operator_workspace_shared_file_replaced", audit, file.version);
      res.json({ file });
    } catch (error) {
      operatorSharedFileError(res, error);
    } finally {
      ctx.cleanupUploadedFile(req.file);
    }
  });

  app.put("/api/operator/workspaces/:serverId/shared-files/:fileId/original-content", ctx.upload.single("file"), (req, res) => {
    const serverId = String(req.params.serverId);
    const access = requireOperatorWorkspace(req, res, ctx, serverId);
    if (!access) {
      ctx.cleanupUploadedFile(req.file);
      return;
    }
    const { operator } = access;
    const audit = auditReason(req.body);
    if (!audit || !req.file) {
      ctx.cleanupUploadedFile(req.file);
      res.status(400).json({ error: audit ? "workspace_shared_file_required" : "operator_audit_metadata_required" });
      return;
    }
    try {
      const expectedVersion = Number(req.body?.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new WorkspaceSharedFileError("workspace_shared_file_version_invalid", 400);
      const file = ctx.workspaceSharedFiles.replaceOriginal({
        fileId: String(req.params.fileId),
        serverId,
        expectedVersion,
        originalName: ctx.uploadFilename(req.file.originalname),
        mimeType: req.file.mimetype || "application/octet-stream",
        contents: readFileSync(req.file.path)
      });
      recordSharedFileOperatorMutation(ctx, operator, serverId, file.id, "platform_operator_workspace_shared_file_original_replaced", audit, file.version);
      res.json({ file });
    } catch (error) {
      operatorSharedFileError(res, error);
    } finally {
      ctx.cleanupUploadedFile(req.file);
    }
  });

  app.delete("/api/operator/workspaces/:serverId/shared-files/:fileId", (req, res) => {
    const serverId = String(req.params.serverId);
    const access = requireOperatorWorkspace(req, res, ctx, serverId);
    if (!access) return;
    const { operator } = access;
    const audit = auditReason(req.body);
    if (!audit) {
      res.status(400).json({ error: "operator_audit_metadata_required" });
      return;
    }
    try {
      const file = ctx.workspaceSharedFiles.delete(String(req.params.fileId), serverId);
      recordSharedFileOperatorMutation(ctx, operator, serverId, file.id, "platform_operator_workspace_shared_file_deleted", audit, file.version);
      res.json({ ok: true, file });
    } catch (error) {
      operatorSharedFileError(res, error);
    }
  });

  app.post("/api/operator/workspaces/:serverId/machines/:machineId/runtimes/:runtime/models/detect", async (req, res) => {
    const access = requireOperatorWorkspace(req, res, ctx, req.params.serverId);
    if (!access) return;
    const machine = ctx.store.getMachine(req.params.machineId);
    if (!machine || machine.deletedAt || machine.serverId !== req.params.serverId) {
      res.status(404).json({ error: "machine_not_found" });
      return;
    }
    const runtime = req.params.runtime as RuntimeId;
    if (!RUNTIMES.some((item) => item.id === runtime)) {
      res.status(400).json({ error: "runtime_not_supported" });
      return;
    }
    // 检测只刷新运行时目录，不修改 Agent 配置或重启进程；沿用 Operator 身份和 Workspace 边界。
    const result = await requestRuntimeModelDetection({
      machineId: machine.id,
      runtime,
      pendingRequests: ctx.runtimeModelRequests,
      sendToDaemon: ctx.sendToDaemon
    });
    ctx.store.recordAuditEvent({
      kind: "platform_operator_runtime_models_detected",
      actorType: "platform_operator",
      actorId: access.operator.id,
      serverId: req.params.serverId,
      resourceType: "machine",
      resourceId: machine.id,
      metadata: { runtime, status: result.status, ...(result.status === "failed" ? { errorCode: result.errorCode } : { modelCount: result.models.length }) }
    });
    if (result.status === "completed") {
      res.json({ models: result.models, default: result.defaultModel });
      return;
    }
    res.status(result.errorCode === "daemon_offline" ? 503 : result.errorCode === "runtime_models_timeout" ? 504 : 502)
      .json({ error: result.errorCode });
  });

  app.patch("/api/operator/workspaces/:serverId/agents/:agentId", (req, res) => {
    const access = requireOperatorWorkspace(req, res, ctx, req.params.serverId);
    if (!access) return;
    const { operator } = access;
    const audit = auditReason(req.body);
    if (!audit) {
      res.status(400).json({ error: "operator_audit_metadata_required" });
      return;
    }
    const permissionMode = req.body?.permissionMode as RuntimePermissionMode | undefined;
    // Global Operator 是跨 Workspace 的最高权限主体，Runtime Access 与其他 Agent 配置使用同一审计更新链路。
    const result = agentManagement.updateAgent({
      operationId: `operator-${randomUUID()}`,
      actorUserId: `platform:${operator.id}`,
      serverId: req.params.serverId,
      agentId: req.params.agentId,
      source: { kind: "platform_operator", source: "ops", operatorId: operator.id, ...audit },
      ...(Object.prototype.hasOwnProperty.call(req.body, "displayName") ? { name: String(req.body.displayName ?? "") } : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body, "description") ? { description: req.body.description as string | null } : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body, "model") ? { model: req.body.model as string | null } : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body, "permissionMode") ? { permissionMode } : {})
    });
    res.status(managementHttpStatus(result)).json(result);
  });

  app.post("/api/operator/workspaces/:serverId/agents/:agentId/:action", (req, res) => {
    if (req.params.action !== "start" && req.params.action !== "stop" && req.params.action !== "restart") {
      res.status(404).json({ error: "operator_action_not_found" });
      return;
    }
    const access = requireOperatorWorkspace(req, res, ctx, req.params.serverId);
    if (!access) return;
    const { operator } = access;
    const audit = auditReason(req.body);
    if (!audit) {
      res.status(400).json({ error: "operator_audit_metadata_required" });
      return;
    }
    const request = {
      operationId: `operator-${randomUUID()}`,
      actorUserId: `platform:${operator.id}`,
      serverId: req.params.serverId,
      agentId: req.params.agentId,
      source: { kind: "platform_operator" as const, source: "ops" as const, operatorId: operator.id, ...audit }
    };
    const result = req.params.action === "start"
      ? agentManagement.startAgent(request)
      : req.params.action === "stop"
        ? agentManagement.stopAgent(request)
        : agentManagement.restartAgent(request);
    res.status(managementHttpStatus(result)).json(result);
  });
}
