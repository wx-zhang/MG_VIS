import {
  DEFAULT_RUNTIME_PERMISSION_MODE,
  isCommunicationAgent,
  runtimeAccessConfigurationError,
  slugifyName,
  type AgentEditableField,
  type AgentRecord,
  type DaemonInbound,
  type MachineRecord,
  type RuntimeId,
  type RuntimeModel,
  type RuntimeApprovalRecord,
  type RuntimeExecutionEventRecord,
  type RuntimeExecutionRecord,
  type RuntimePermissionMode,
  type RuntimeReport,
  type RuntimeResourceGrant
} from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import { canCreateAgentOnMachine, canManageAgentRuntime } from "./access-control";
import {
  settleAgentRuntimeLifecycle,
  type AgentRuntimeLifecycleReason,
  type AgentRuntimeLifecycleSettlement
} from "./agent-runtime-lifecycle";

export type AgentManagementAction = "create" | "delete" | "start" | "stop" | "restart" | "reset" | "update";
export type AgentManagementResultStatus = "completed" | "noop" | "partial" | "denied" | "failed";

export interface AgentManagementSourceContext {
  kind: "web_api" | "tyr_assistant" | "platform_operator";
  source: "web" | "telegram" | "email" | "mcp" | "ops";
  operatorId?: string;
  reason?: string;
  reference?: string;
  sourceMessageId?: string;
  assistantAgentId?: string;
  requestingUserId?: string;
  capabilityUserId?: string;
  bridgeRequestId?: string;
  bridgeTraceId?: string;
  bridgePath?: string[];
  sourceWorkspaceId?: string;
  targetWorkspaceId?: string;
  confirmation?: {
    required: boolean;
    confirmedAt?: string;
  };
}

interface AgentManagementActionRequest {
  operationId: string;
  actorUserId: string;
  serverId: string;
  source: AgentManagementSourceContext;
}

export interface AgentCreateRequest extends AgentManagementActionRequest {
  machineId: string;
  name: string;
  runtime: RuntimeId;
  model?: string;
  description?: string;
  reasoningEffort?: AgentRecord["reasoningEffort"];
  permissionMode?: RuntimePermissionMode;
  runtimeResourceGrants?: RuntimeResourceGrant[];
  envVars?: Record<string, string>;
}

export interface AgentTargetRequest extends AgentManagementActionRequest {
  agentId: string;
}

export interface AgentTargetValidationRequest extends AgentTargetRequest {
  action: Exclude<AgentManagementAction, "create" | "update">;
}

export interface AgentUpdateRequest extends AgentTargetRequest {
  name?: string;
  description?: string | null;
  model?: string | null;
  permissionMode?: RuntimePermissionMode;
}

export interface AgentManagementResult {
  action: AgentManagementAction;
  operationId: string;
  status: AgentManagementResultStatus;
  errorCode?: string;
  agent?: AgentRecord;
  machine?: MachineRecord;
  startSent?: boolean;
  stopSent?: boolean;
  changedFields?: AgentEditableField[];
  restartRequired?: boolean;
  profileApplyDeferred?: boolean;
  sessionCleared?: boolean;
}

export type AgentBatchAction = "start" | "stop" | "restart";

export interface AgentBatchByMachineRequest {
  operationId: string;
  actorUserId: string;
  serverId: string;
  source: AgentManagementSourceContext;
  machineId: string;
  action: AgentBatchAction;
  targetAgentIds?: string[];
}

export interface AgentBatchItemResult {
  agentId: string;
  agentName: string;
  operationId: string;
  status: AgentManagementResultStatus | "skipped";
  errorCode?: string;
  result?: AgentManagementResult;
}

export interface AgentBatchManagementResult {
  operationId: string;
  action: AgentBatchAction;
  status: AgentManagementResultStatus;
  machine?: MachineRecord;
  errorCode?: string;
  total: number;
  completed: number;
  noop: number;
  partial: number;
  denied: number;
  failed: number;
  skipped: number;
  results: AgentBatchItemResult[];
}

export interface AgentManagementAgentCandidate {
  agent: AgentRecord;
  machine: MachineRecord | null;
}

export interface AgentManagementCreationOptions {
  machines: MachineRecord[];
  runtimes: RuntimeReport[];
  models: RuntimeModel[];
  defaultModel?: string;
}

export interface AgentManagementDependencies {
  store: TyrDb;
  startAgent(agent: AgentRecord): boolean;
  sendToDaemon(machineId: string, message: DaemonInbound): boolean;
  emitRealtimeAgentStatus(agentId: string): void;
  emitRealtimeRuntimeExecution?(execution: RuntimeExecutionRecord | null, event?: RuntimeExecutionEventRecord): void;
  emitRealtimeRuntimeApproval?(approval: RuntimeApprovalRecord): void;
  publishTerminalCommunicationFailure?(execution: RuntimeExecutionRecord): void;
  broadcastRealtime(event: string, payload: unknown, options?: { serverId?: string }): void;
  publishWorkspaceSync(): void;
}

export type AgentNavigationRealtimeEvent = "agent:created" | "agent:updated" | "agent:deleted";

export interface AgentNavigationRealtimePayload {
  agentId: string;
  machineId?: string | null;
  serverId: string;
  changedFields?: AgentEditableField[];
}

export function emitAgentNavigationRealtimeEvent(
  broadcastRealtime: AgentManagementDependencies["broadcastRealtime"],
  event: AgentNavigationRealtimeEvent,
  payload: AgentNavigationRealtimePayload
): void {
  try {
    // 生命周期事件只发布导航失效信息，不能把 AgentRecord 中的 authToken 带到浏览器。
    broadcastRealtime(event, payload, { serverId: payload.serverId });
  } catch {
    // 数据库记录是 Agent 真源；实时传输故障不能把已经持久化的操作回滚成失败。
  }
}

export interface ListAgentCandidatesRequest {
  actorUserId: string;
  serverId: string;
  reference?: string;
  includeDeleted?: boolean;
}

export interface ListAgentCreationOptionsRequest {
  actorUserId: string;
  serverId: string;
  machineId?: string;
  runtime?: RuntimeId;
}

type ServerRole = "owner" | "member" | "guest";

interface ManagedAgent {
  agent: AgentRecord;
  machine: MachineRecord;
  role: ServerRole;
}

type InternalTargetRequest = AgentTargetRequest & { action: Exclude<AgentManagementAction, "create">; includeDeleted?: boolean };

function result(
  action: AgentManagementAction,
  request: AgentManagementActionRequest,
  status: AgentManagementResultStatus,
  errorCode?: string,
  fields: Omit<AgentManagementResult, "action" | "operationId" | "status" | "errorCode"> = {}
): AgentManagementResult {
  return {
    action,
    operationId: request.operationId,
    status,
    ...(errorCode ? { errorCode } : {}),
    ...fields
  };
}

function serverRole(store: TyrDb, userId: string, serverId: string): ServerRole | null {
  return store.listServersForUser(userId).find((server) => server.id === serverId)?.role ?? null;
}

function canCreate(role: string | null, actorUserId: string, machine: MachineRecord): boolean {
  // Workspace Owner 管理 workspace 资源；Member 仍受既有 Computer owner 边界约束。
  if (role === "owner") return !machine.deletedAt;
  return role === "member" && canCreateAgentOnMachine(actorUserId, machine);
}

function canManage(role: string | null, actorUserId: string, agent: AgentRecord, machine: MachineRecord): boolean {
  // Owner 的授权只覆盖当前 Workspace；调用方必须先完成 Agent/Computer serverId 校验。
  if (role === "owner") return !agent.deletedAt && !machine.deletedAt && !isCommunicationAgent(agent);
  return role === "member" && canManageAgentRuntime(actorUserId, agent, machine);
}

function isPlatformOperator(request: Pick<AgentManagementActionRequest, "source">): boolean {
  return request.source.kind === "platform_operator";
}

function platformOperatorActionAllowed(action: AgentManagementAction): boolean {
  return action === "start" || action === "stop" || action === "restart" || action === "reset" || action === "update";
}

function resolveManagedAgent(store: TyrDb, request: InternalTargetRequest): ManagedAgent | AgentManagementResult {
  const platformOperator = isPlatformOperator(request);
  if (platformOperator && !platformOperatorActionAllowed(request.action)) {
    return result(request.action, request, "denied", "platform_operation_not_allowed");
  }
  const role = platformOperator ? "owner" : serverRole(store, request.actorUserId, request.serverId);
  if (!role || role === "guest") return result(request.action, request, "denied", "server_member_required");

  const agent = store.getAgent(request.agentId);
  if (!agent) return result(request.action, request, "failed", "agent_not_found");
  const machine = agent.machineId ? store.getMachine(agent.machineId) : null;
  const agentServerId = agent.serverId ?? machine?.serverId ?? "local";
  const machineServerId = machine?.serverId ?? "local";
  // 跨 Workspace 目标按不存在处理，避免通过管理接口探测其他 Workspace 资源。
  if (agentServerId !== request.serverId || (machine && machineServerId !== request.serverId)) {
    return result(request.action, request, "failed", "agent_not_found");
  }
  if (isCommunicationAgent(agent)) return result(request.action, request, "denied", "system_agent_protected");
  if (!machine || machine.deletedAt || (!request.includeDeleted && agent.deletedAt)) {
    return result(request.action, request, "failed", "agent_not_found");
  }

  if (request.includeDeleted && agent.deletedAt) {
    const mayRepeatDelete = role === "owner" || (
      role === "member" && agent.ownerUserId === request.actorUserId && machine.ownerUserId === request.actorUserId
    );
    if (!mayRepeatDelete) return result(request.action, request, "denied", "agent_owner_required");
  } else if (!platformOperator && !canManage(role, request.actorUserId, agent, machine)) {
    return result(request.action, request, "denied", "agent_owner_required");
  }

  return { agent, machine, role };
}

function resolveCreateModel(
  requested: string | undefined,
  report: RuntimeReport
): { ok: true; model?: string } | { ok: false; errorCode: "model_unavailable" } {
  const value = requested?.trim();
  const models = report.models ?? [];
  if (models.length === 0) {
    // daemon 未提供 Model 目录时只能让 runtime 自选默认值，不能透传未经报告的 Model。
    return !value || value === "default"
      ? { ok: true }
      : { ok: false, errorCode: "model_unavailable" };
  }
  if (!value || value === "default") return { ok: true, model: report.defaultModel };
  return models.some((model) => model.id === value)
    ? { ok: true, model: value }
    : { ok: false, errorCode: "model_unavailable" };
}

function availableRuntimeReport(store: TyrDb, agent: AgentRecord, machine: MachineRecord): RuntimeReport | null {
  if (!agent.runtime) return null;
  return store.listRuntimeReports(machine.id)
    .find((report) => report.runtime === agent.runtime && report.status === "available") ?? null;
}

function emptyBatch(
  request: AgentBatchByMachineRequest,
  status: AgentManagementResultStatus,
  errorCode: string,
  machine?: MachineRecord
): AgentBatchManagementResult {
  return {
    operationId: request.operationId,
    action: request.action,
    status,
    ...(machine ? { machine } : {}),
    errorCode,
    total: 0,
    completed: 0,
    noop: 0,
    partial: 0,
    denied: 0,
    failed: 0,
    skipped: 0,
    results: []
  };
}

function summarizeBatch(
  request: AgentBatchByMachineRequest,
  machine: MachineRecord,
  results: AgentBatchItemResult[]
): AgentBatchManagementResult {
  const count = (status: AgentBatchItemResult["status"]) => results.filter((item) => item.status === status).length;
  const completed = count("completed");
  const noop = count("noop");
  const partial = count("partial");
  const denied = count("denied");
  const failed = count("failed");
  const skipped = count("skipped");
  const success = completed + noop;
  const status: AgentManagementResultStatus = results.length === 0
    ? "failed"
    : denied === results.length
      ? "denied"
      : skipped === results.length
        ? "failed"
        : partial > 0 || (success > 0 && denied + failed + skipped > 0)
          ? "partial"
          : failed > 0 || denied > 0 || skipped > 0
            ? "failed"
            : "completed";
  const errorCode = results.length === 0
    ? "no_executable_agents"
    : skipped === results.length
      ? "batch_targets_unavailable"
      : undefined;
  return {
    operationId: request.operationId,
    action: request.action,
    status,
    machine,
    ...(errorCode ? { errorCode } : {}),
    total: results.length,
    completed,
    noop,
    partial,
    denied,
    failed,
    skipped,
    results
  };
}

export function createAgentManagementService(deps: AgentManagementDependencies) {
  const { store } = deps;

  function publishRuntimeSettlement(settlement: AgentRuntimeLifecycleSettlement): void {
    for (const approval of settlement.resolvedApprovals) {
      try {
        deps.emitRealtimeRuntimeApproval?.(approval);
      } catch {
        // DB 已是审批真源；实时更新失败不能回滚已经完成的生命周期收敛。
      }
    }
    for (const event of settlement.events) {
      try {
        deps.emitRealtimeRuntimeExecution?.(store.getRuntimeExecution(event.executionId), event);
      } catch {
        // 页面可由 bootstrap 重建；这里不能因单个实时连接失败重新打开 execution。
      }
    }
    for (const execution of settlement.cancelledExecutions) {
      try {
        // Runtime 终态事务已提交后再生成客户回传，避免 Bridge/MCP 永久停在 running。
        deps.publishTerminalCommunicationFailure?.(execution);
      } catch {
        // execution 仍是 cancelled 真源；回传失败不能反向恢复已经终止的 execution。
      }
    }
  }

  function settleRuntime(agentId: string, reason: AgentRuntimeLifecycleReason): AgentRuntimeLifecycleSettlement | null {
    try {
      const settlement = settleAgentRuntimeLifecycle(store, { agentId, reason });
      publishRuntimeSettlement(settlement);
      return settlement;
    } catch {
      return null;
    }
  }

  function finish(
    action: AgentManagementAction,
    request: AgentCreateRequest | AgentTargetRequest | AgentUpdateRequest,
    actionResult: AgentManagementResult,
    context: {
      agent?: AgentRecord | null;
      machine?: MachineRecord | null;
      model?: string | null;
      previousSessionId?: string | null;
      invalidatedSessionCount?: number;
    } = {}
  ): AgentManagementResult {
    if (request.source.kind === "platform_operator") {
      const requestAgentId = "agentId" in request ? request.agentId : undefined;
      const candidateAgent = context.agent ?? actionResult.agent ?? (requestAgentId ? store.getAgent(requestAgentId) : null);
      const candidateMachine = context.machine ?? actionResult.machine ?? (
        candidateAgent?.machineId ? store.getMachine(candidateAgent.machineId) : null
      );
      const machine = candidateMachine && (candidateMachine.serverId ?? "local") === request.serverId
        ? candidateMachine
        : null;
      const agent = candidateAgent && (candidateAgent.serverId ?? candidateMachine?.serverId ?? "local") === request.serverId
        ? candidateAgent
        : null;
      store.recordAuditEvent({
        kind: `platform_operator_agent_${action}`,
        actorType: "platform_operator",
        actorId: request.source.operatorId ?? request.actorUserId,
        resourceType: "agent",
        resourceId: agent?.id ?? null,
        serverId: request.serverId,
        metadata: {
          operationId: request.operationId,
          action,
          status: actionResult.status,
          source: "ops",
          reason: request.source.reason ?? null,
          reference: request.source.reference ?? null,
          machineId: machine?.id ?? null,
          errorCode: actionResult.errorCode ?? null,
          previousSessionId: context.previousSessionId ?? null,
          invalidatedSessionCount: context.invalidatedSessionCount ?? 0,
          stopSent: actionResult.stopSent ?? null,
          sessionCleared: actionResult.sessionCleared ?? false,
          startSent: actionResult.startSent ?? null
        }
      });
      if (agent && (actionResult.status === "completed" || actionResult.status === "partial")) {
        // 客户侧只展示维护事实和结果；运维身份、原因、工单、IP 与 Session 仅留在内部审计。
        const outcome = actionResult.status === "completed" ? "Completed." : "Runtime recovery is pending.";
        const maintenanceAction = action === "reset"
          ? "reset"
          : action === "restart"
            ? "restarted"
            : action === "stop"
              ? "stopped"
              : action === "update"
                ? "configured"
                : "started";
        store.recordActivity(agent.id, "platform_maintenance", `Platform maintenance ${maintenanceAction} this Agent runtime. ${outcome}`);
      }
      return actionResult;
    }
    if (request.source.kind !== "tyr_assistant") {
      const agent = actionResult.agent && (actionResult.agent.serverId ?? actionResult.machine?.serverId ?? "local") === request.serverId
        ? actionResult.agent
        : null;
      const machine = actionResult.machine && (actionResult.machine.serverId ?? "local") === request.serverId
        ? actionResult.machine
        : null;
      store.recordAuditEvent({
        kind: `agent_management_${action}`,
        actorType: "user",
        actorId: request.source.requestingUserId ?? request.actorUserId,
        resourceType: "agent",
        resourceId: agent?.id ?? null,
        serverId: request.serverId,
        metadata: {
          operationId: request.operationId,
          action,
          status: actionResult.status,
          source: request.source.source,
          capabilityUserId: request.source.capabilityUserId ?? request.actorUserId,
          bridgeTraceId: request.source.bridgeTraceId ?? null,
          bridgePath: request.source.bridgePath ?? [],
          sourceWorkspaceId: request.source.sourceWorkspaceId ?? null,
          targetWorkspaceId: request.source.targetWorkspaceId ?? null,
          machineId: machine?.id ?? null,
          errorCode: actionResult.errorCode ?? null
        }
      });
      return actionResult;
    }
    const requestAgentId = "agentId" in request ? request.agentId : undefined;
    const requestMachineId = "machineId" in request ? request.machineId : undefined;
    const candidateAgent = context.agent ?? actionResult.agent ?? (requestAgentId ? store.getAgent(requestAgentId) : null);
    const candidateMachine = context.machine ?? actionResult.machine ?? (
      requestMachineId
        ? store.getMachine(requestMachineId)
        : candidateAgent?.machineId
          ? store.getMachine(candidateAgent.machineId)
          : null
    );
    const machine = candidateMachine && (candidateMachine.serverId ?? "local") === request.serverId
      ? candidateMachine
      : null;
    const candidateAgentServerId = candidateAgent?.serverId ?? (
      candidateAgent?.machineId === candidateMachine?.id ? candidateMachine?.serverId : undefined
    ) ?? "local";
    // 业务层按 not found 隐藏跨 Workspace 资源后，审计也不能通过 fallback 再读出外部资源元数据。
    const agent = candidateAgent && candidateAgentServerId === request.serverId ? candidateAgent : null;
    const runtime = agent?.runtime ?? ("runtime" in request ? request.runtime : null);
    const model = context.model !== undefined
      ? context.model
      : agent?.model ?? ("model" in request ? request.model ?? null : null);
    // 最终审计只由 Assistant source 写入；Web API 不伪装成 Communication Agent 事件。
    store.recordAuditEvent({
      kind: `communication_agent_agent_${action}`,
      actorType: "agent",
      actorId: request.source.assistantAgentId ?? null,
      resourceType: "agent",
      resourceId: agent?.id ?? null,
      serverId: request.serverId,
      metadata: {
        operationId: request.operationId,
        action,
        requestedByUserId: request.actorUserId,
        originalRequestingUserId: request.source.requestingUserId ?? request.actorUserId,
        capabilityUserId: request.source.capabilityUserId ?? request.actorUserId,
        bridgeRequestId: request.source.bridgeRequestId ?? null,
        bridgeTraceId: request.source.bridgeTraceId ?? null,
        status: actionResult.status,
        source: request.source.source,
        sourceMessageId: request.source.sourceMessageId ?? null,
        assistantAgentId: request.source.assistantAgentId ?? null,
        machineId: machine?.id ?? null,
        runtime: runtime ?? null,
        model: model ?? null,
        confirmationRequired: request.source.confirmation?.required ?? false,
        confirmedAt: request.source.confirmation?.confirmedAt ?? null,
        errorCode: actionResult.errorCode ?? null,
        ...(action === "update" ? {
          changedFields: actionResult.changedFields ?? [],
          restartRequired: actionResult.restartRequired ?? false,
          profileApplyDeferred: actionResult.profileApplyDeferred ?? false
        } : {}),
        ...(action === "reset" ? {
          stopSent: actionResult.stopSent ?? null,
          sessionCleared: actionResult.sessionCleared ?? false,
          startSent: actionResult.startSent ?? null
        } : {})
      }
    });
    return actionResult;
  }

  function finishResolution(
    action: Exclude<AgentManagementAction, "create">,
    request: AgentTargetRequest,
    resolved: ManagedAgent | AgentManagementResult
  ): ManagedAgent | AgentManagementResult {
    if ("status" in resolved) return finish(action, request, resolved);
    return resolved;
  }

  function listAgentCandidates(request: ListAgentCandidatesRequest): AgentManagementAgentCandidate[] {
    if (!serverRole(store, request.actorUserId, request.serverId)) return [];
    const reference = request.reference?.trim().toLowerCase();
    return store.listAgents(request.serverId, { includeDeleted: request.includeDeleted })
      .filter((agent) => !isCommunicationAgent(agent))
      .map((agent) => ({ agent, machine: agent.machineId ? store.getMachine(agent.machineId) : null }))
      .filter(({ agent, machine }) => {
        const agentServerId = agent.serverId ?? machine?.serverId ?? "local";
        return agentServerId === request.serverId && (!machine || (machine.serverId ?? "local") === request.serverId);
      })
      .filter(({ agent }) => !reference || (
        agent.id.toLowerCase() === reference ||
        agent.name.toLowerCase().includes(reference) ||
        agent.displayName.toLowerCase().includes(reference)
      ));
  }

  function validateAgentTarget(request: AgentTargetValidationRequest): AgentManagementResult {
    const resolution = resolveManagedAgent(store, {
      ...request,
      includeDeleted: request.action === "delete"
    });
    if ("status" in resolution) return resolution;
    const { agent, machine } = resolution;
    // Reset 会清除可恢复 session，预检必须与真正执行保持相同的 Agent + Computer owner 边界。
    if (request.action === "reset" && !isPlatformOperator(request) && !canManageAgentRuntime(request.actorUserId, agent, machine)) {
      return result(request.action, request, "denied", "agent_owner_required", { agent, machine });
    }
    return result(request.action, request, "completed", undefined, { agent, machine });
  }

  function isProtectedAgentReference(request: {
    actorUserId: string;
    serverId: string;
    reference: string;
  }): boolean {
    if (!serverRole(store, request.actorUserId, request.serverId)) return false;
    const reference = request.reference.trim().toLowerCase();
    if (!reference) return false;
    return store.listAgents(request.serverId, { includeDeleted: false })
      .filter((agent) => isCommunicationAgent(agent) && (agent.serverId ?? "local") === request.serverId)
      .some((agent) => (
        agent.id.toLowerCase() === reference ||
        agent.name.toLowerCase() === reference ||
        agent.displayName.toLowerCase() === reference
      ));
  }

  function listCreationOptions(request: ListAgentCreationOptionsRequest): AgentManagementCreationOptions {
    const role = serverRole(store, request.actorUserId, request.serverId);
    const machines = !role || role === "guest"
      ? []
      : store.listMachines(request.serverId)
        .filter((machine) => machine.status === "online" && canCreate(role, request.actorUserId, machine));
    const selectedMachine = request.machineId ? machines.find((machine) => machine.id === request.machineId) : undefined;
    const runtimes = selectedMachine
      ? store.listRuntimeReports(selectedMachine.id).filter((report) => report.status === "available")
      : [];
    const selectedRuntime = request.runtime ? runtimes.find((report) => report.runtime === request.runtime) : undefined;
    return {
      machines,
      runtimes,
      models: selectedRuntime?.models ?? [],
      ...(selectedRuntime?.defaultModel ? { defaultModel: selectedRuntime.defaultModel } : {})
    };
  }

  function listManageableMachines(request: { actorUserId: string; serverId: string }): MachineRecord[] {
    const role = serverRole(store, request.actorUserId, request.serverId);
    if (!role || role === "guest") return [];
    // Offline Computer 仍是可选择目标，Assistant 需要明确回复 offline，而不是误报不存在。
    return store.listMachines(request.serverId)
      .filter((machine) => !machine.deletedAt && canCreate(role, request.actorUserId, machine));
  }

  function batchByMachine(request: AgentBatchByMachineRequest): AgentBatchManagementResult {
    const role = serverRole(store, request.actorUserId, request.serverId);
    const machine = store.getMachine(request.machineId);
    if (!role || role === "guest") return emptyBatch(request, "denied", "server_member_required");
    if (!machine || machine.deletedAt || (machine.serverId ?? "local") !== request.serverId) {
      return emptyBatch(request, "failed", "machine_not_found");
    }
    if (!canCreate(role, request.actorUserId, machine)) {
      return emptyBatch(request, "denied", "agent_owner_required", machine);
    }
    if (machine.status !== "online") return emptyBatch(request, "failed", "machine_offline", machine);

    // 未提供快照时读取当前 Computer 下的 executable Agent；确认后的请求只消费已保存的稳定 ID 集合。
    const selectedIds = request.targetAgentIds ?? store.listAgents(request.serverId)
      .filter((agent) => (
        agent.machineId === machine.id &&
        !agent.deletedAt &&
        !isCommunicationAgent(agent) &&
        Boolean(agent.runtime)
      ))
      .map((agent) => agent.id);

    const results = selectedIds.map((agentId): AgentBatchItemResult => {
      const agent = store.getAgent(agentId);
      const childOperationId = `${request.operationId}:${agentId}`;
      const agentServerId = agent?.serverId ?? (
        agent?.machineId ? store.getMachine(agent.machineId)?.serverId : undefined
      ) ?? "local";
      const sameWorkspace = agentServerId === request.serverId;
      if (
        !agent ||
        !sameWorkspace ||
        agent.deletedAt ||
        agent.machineId !== machine.id ||
        isCommunicationAgent(agent) ||
        !agent.runtime
      ) {
        return {
          agentId,
          // 跨 Workspace 快照按不可用处理，不能把外部 Agent 名称带回当前 Workspace。
          agentName: agent && sameWorkspace ? agent.displayName : agentId,
          operationId: childOperationId,
          status: "skipped",
          errorCode: "batch_target_unavailable"
        };
      }

      const childRequest: AgentTargetRequest = {
        operationId: childOperationId,
        actorUserId: request.actorUserId,
        serverId: request.serverId,
        source: request.source,
        agentId
      };
      let childResult: AgentManagementResult;
      try {
        childResult = request.action === "start"
          ? startAgent(childRequest)
          : request.action === "stop"
            ? stopAgent(childRequest)
            : restartAgent(childRequest);
      } catch {
        // 单个 runtime callback 异常只终止该子操作，不能阻断同一批次中的其他 Agent。
        const deliveryFields = request.action === "start"
          ? { startSent: false }
          : request.action === "stop"
            ? { stopSent: false }
            : { startSent: false, stopSent: false };
        childResult = finish(
          request.action,
          childRequest,
          result(request.action, childRequest, "failed", "daemon_unavailable", { agent, machine, ...deliveryFields }),
          { agent, machine }
        );
      }
      return {
        agentId,
        agentName: agent.displayName,
        operationId: childOperationId,
        status: childResult.status,
        ...(childResult.errorCode ? { errorCode: childResult.errorCode } : {}),
        result: childResult
      };
    });

    return summarizeBatch(request, machine, results);
  }

  function createAgent(request: AgentCreateRequest): AgentManagementResult {
    const role = serverRole(store, request.actorUserId, request.serverId);
    if (!role || role === "guest") {
      return finish("create", request, result("create", request, "denied", "server_member_required"));
    }
    const machine = store.getMachine(request.machineId);
    if (!machine || machine.deletedAt || (machine.serverId ?? "local") !== request.serverId) {
      return finish("create", request, result("create", request, "failed", "machine_not_found"), { machine });
    }
    if (!canCreate(role, request.actorUserId, machine)) {
      return finish("create", request, result("create", request, "denied", "machine_owner_required", { machine }), { machine });
    }
    if (machine.status !== "online") {
      return finish("create", request, result("create", request, "failed", "machine_offline", { machine }), { machine });
    }
    const name = request.name.trim();
    if (!name) return finish("create", request, result("create", request, "failed", "agent_name_required", { machine }), { machine });
    if (store.listAgents(request.serverId).some((agent) => agent.displayName === name)) {
      return finish("create", request, result("create", request, "failed", "duplicate_agent_name", { machine }), { machine });
    }
    const runtimeReport = store.listRuntimeReports(machine.id)
      .find((report) => report.runtime === request.runtime && report.status === "available");
    if (!runtimeReport) {
      return finish("create", request, result("create", request, "failed", "runtime_unavailable", { machine }), { machine });
    }
    const runtimeAccessError = runtimeAccessConfigurationError(request.runtime, request.permissionMode, request.runtimeResourceGrants, runtimeReport);
    if (runtimeAccessError) {
      return finish("create", request, result("create", request, "failed", runtimeAccessError, { machine }), { machine });
    }
    const resolvedModel = resolveCreateModel(request.model, runtimeReport);
    if (!resolvedModel.ok) {
      return finish("create", request, result("create", request, "failed", resolvedModel.errorCode, { machine }), { machine });
    }

    let agent: AgentRecord;
    try {
      agent = store.createAgent({
        machineId: machine.id,
        name,
        runtime: request.runtime,
        model: resolvedModel.model,
        description: request.description,
        reasoningEffort: request.reasoningEffort,
        permissionMode: request.permissionMode,
        runtimeResourceGrants: request.runtimeResourceGrants,
        envVars: request.envVars,
        createdByUserId: request.source.requestingUserId ?? request.actorUserId,
        creationBridgeRequestId: request.source.bridgeRequestId,
        creationTraceId: request.source.bridgeTraceId
      }, request.actorUserId);
    } catch {
      // 只有持久化失败才属于创建失败；内部异常文本不能成为公开 errorCode。
      return finish("create", request, result("create", request, "failed", "agent_create_failed", { machine }), { machine, model: resolvedModel.model ?? null });
    }

    emitAgentNavigationRealtimeEvent(deps.broadcastRealtime, "agent:created", {
      agentId: agent.id,
      machineId: agent.machineId,
      serverId: request.serverId
    });

    let startSent = false;
    try {
      startSent = deps.startAgent(agent);
    } catch {
      // 启动 callback 的异常与未送达等价，Agent 真源记录仍保留并继续发布 workspace 状态。
      startSent = false;
    }
    try {
      deps.publishWorkspaceSync();
    } catch {
      return finish("create", request, result(
        "create",
        request,
        "partial",
        "workspace_sync_failed",
        { agent, machine, startSent }
      ), { agent, machine, model: resolvedModel.model ?? null });
    }
    // Agent 记录是服务端真源；启动未送达时仍保留 Offline 记录供后续重试。
    const actionResult = result(
      "create",
      request,
      startSent ? "completed" : "partial",
      startSent ? undefined : "daemon_unavailable",
      { agent, machine, startSent }
    );
    return finish("create", request, actionResult, { agent, machine, model: resolvedModel.model ?? null });
  }

  function updateAgent(request: AgentUpdateRequest): AgentManagementResult {
    const resolution = finishResolution("update", request, resolveManagedAgent(store, { ...request, action: "update" }));
    if ("status" in resolution) return resolution;
    const { agent, machine } = resolution;
    const hasName = Object.prototype.hasOwnProperty.call(request, "name");
    const hasDescription = Object.prototype.hasOwnProperty.call(request, "description");
    const hasModel = Object.prototype.hasOwnProperty.call(request, "model");
    const hasPermission = Object.prototype.hasOwnProperty.call(request, "permissionMode");
    if (!hasName && !hasDescription && !hasModel && !hasPermission) {
      return finish("update", request, result("update", request, "failed", "agent_update_empty", { agent, machine }), { agent, machine });
    }

    const displayName = hasName ? request.name?.trim() ?? "" : agent.displayName;
    const name = hasName ? slugifyName(displayName) : agent.name;
    if (hasName && !displayName) {
      return finish("update", request, result("update", request, "failed", "invalid_agent_name", { agent, machine }), { agent, machine });
    }
    if (hasName && store.listAgents(request.serverId).some((candidate) => (
      candidate.id !== agent.id && (
        candidate.name.toLowerCase() === name.toLowerCase() ||
        candidate.displayName.toLowerCase() === displayName.toLowerCase()
      )
    ))) {
      return finish("update", request, result("update", request, "failed", "agent_name_conflict", { agent, machine }), { agent, machine });
    }

    const description = hasDescription ? request.description?.trim() || null : agent.description ?? null;
    let model = agent.model ?? null;
    if (hasModel) {
      const requestedModel = request.model?.trim() || "default";
      const requestedValue = requestedModel === "default" ? null : requestedModel;
      if (requestedValue !== (agent.model ?? null)) {
        const runtimeReport = availableRuntimeReport(store, agent, machine);
        if (!runtimeReport) {
          return finish("update", request, result("update", request, "failed", "model_not_available", { agent, machine }), { agent, machine });
        }
        const models = runtimeReport.models ?? [];
        if (requestedValue && !models.some((candidate) => candidate.id === requestedValue)) {
          return finish("update", request, result("update", request, "failed", "model_not_available", { agent, machine }), { agent, machine });
        }
      }
      // 未变的已保存 Model 不重新校验，避免离线或目录更新阻塞名称/描述等无关编辑。
      model = requestedValue;
    }

    const permissionMode = hasPermission ? request.permissionMode : agent.permissionMode;
    if (hasPermission && permissionMode !== "read-only" && permissionMode !== "workspace-write" && permissionMode !== "dev-full-access") {
      return finish("update", request, result("update", request, "failed", "invalid_permission_mode", { agent, machine }), { agent, machine });
    }
    if (hasPermission) {
      const runtimeAccessError = runtimeAccessConfigurationError(
        agent.runtime,
        permissionMode,
        agent.runtimeResourceGrants,
        availableRuntimeReport(store, agent, machine)
      );
      if (runtimeAccessError) {
        return finish("update", request, result("update", request, "failed", runtimeAccessError, { agent, machine }), { agent, machine });
      }
    }

    const changedFields: AgentEditableField[] = [];
    if (hasName && (displayName !== agent.displayName || name !== agent.name)) changedFields.push("name");
    if (hasDescription && description !== (agent.description ?? null)) changedFields.push("description");
    if (hasModel && model !== (agent.model ?? null)) changedFields.push("model");
    if (hasPermission && permissionMode !== agent.permissionMode) changedFields.push("permissionMode");
    if (changedFields.length === 0) {
      return finish("update", request, result("update", request, "noop", undefined, {
        agent,
        machine,
        changedFields,
        restartRequired: false
      }), { agent, machine });
    }

    const updated = store.updateAgentConfiguration(agent.id, {
      ...(changedFields.includes("name") ? { name, displayName } : {}),
      ...(changedFields.includes("description") ? { description } : {}),
      ...(changedFields.includes("model") ? { model } : {}),
      ...(changedFields.includes("permissionMode") && permissionMode ? { permissionMode } : {})
    });
    if (!updated) {
      return finish("update", request, result("update", request, "failed", "agent_update_failed", { agent, machine }), { agent, machine });
    }

    emitAgentNavigationRealtimeEvent(deps.broadcastRealtime, "agent:updated", {
      agentId: updated.id,
      machineId: updated.machineId,
      serverId: request.serverId,
      changedFields
    });

    const runtimeChanged = changedFields.includes("model") || changedFields.includes("permissionMode");
    const profileChanged = changedFields.includes("name") || changedFields.includes("description");
    // 纯 Profile 修改不打断正在执行的 turn；Online 空闲立即换代，Working 在回到 Online 后由 server 调度。
    const profileApplyDeferred = profileChanged && agent.status === "working" && !runtimeChanged;
    const restartRequired = (runtimeChanged && (agent.status === "online" || agent.status === "working"))
      || (profileChanged && agent.status === "online");
    let stopSent: boolean | undefined;
    let startSent: boolean | undefined;
    let runtimeSettlementFailed = false;
    if (restartRequired) {
      try {
        stopSent = deps.sendToDaemon(machine.id, { type: "agent:stop", agentId: agent.id });
      } catch {
        stopSent = false;
      }
      // 配置重启必须先关闭旧 execution/approval，再允许新 runtime 读取新配置启动。
      runtimeSettlementFailed = settleRuntime(agent.id, "agent_configuration_restarted") === null;
      if (!runtimeSettlementFailed) {
        try {
          // 新进程必须读取已经持久化的新权限和 Model，不能继续使用旧 Agent 快照。
          startSent = deps.startAgent(updated);
        } catch {
          startSent = false;
        }
      } else {
        startSent = false;
      }
    }

    const restartDelivered = !restartRequired || (stopSent === true && startSent === true);

    try {
      deps.publishWorkspaceSync();
    } catch {
      // 同时失败时优先暴露需要人工处理的 restart，workspace sync 延迟不应掩盖运行态风险。
      return finish("update", request, result("update", request, "partial", runtimeSettlementFailed ? "runtime_lifecycle_settlement_failed" : restartDelivered ? "workspace_sync_failed" : "agent_restart_not_delivered", {
        agent: updated,
        machine,
        changedFields,
        restartRequired,
        profileApplyDeferred,
        ...(stopSent === undefined ? {} : { stopSent }),
        ...(startSent === undefined ? {} : { startSent })
      }), { agent: updated, machine });
    }

    return finish("update", request, result(
      "update",
      request,
      restartDelivered ? "completed" : "partial",
      restartDelivered ? undefined : runtimeSettlementFailed ? "runtime_lifecycle_settlement_failed" : "agent_restart_not_delivered",
      {
        agent: updated,
        machine,
        changedFields,
        restartRequired,
        profileApplyDeferred,
        ...(stopSent === undefined ? {} : { stopSent }),
        ...(startSent === undefined ? {} : { startSent })
      }
    ), { agent: updated, machine });
  }

  function startAgent(request: AgentTargetRequest): AgentManagementResult {
    const resolution = finishResolution("start", request, resolveManagedAgent(store, { ...request, action: "start" }));
    if ("status" in resolution) return resolution;
    const { agent, machine } = resolution;
    const runtimeReport = availableRuntimeReport(store, agent, machine);
    const runtimeAccessError = runtimeAccessConfigurationError(agent.runtime, agent.permissionMode, agent.runtimeResourceGrants, runtimeReport);
    if (runtimeAccessError) {
      return finish("start", request, result("start", request, "failed", runtimeAccessError, { agent, machine, startSent: false }), { agent, machine });
    }
    if (agent.status === "online" || agent.status === "working") {
      const desired = store.setAgentDesiredRuntimeState(agent.id, "running") ?? agent;
      return finish("start", request, result("start", request, "noop", undefined, { agent: desired, machine, startSent: false }), { agent: desired, machine });
    }
    if (machine.status !== "online") {
      return finish("start", request, result("start", request, "failed", "machine_offline", { agent, machine, startSent: false }), { agent, machine });
    }
    if (!runtimeReport) {
      return finish("start", request, result("start", request, "failed", "runtime_unavailable", { agent, machine, startSent: false }), { agent, machine });
    }
    // 每次下发 start 前都按目标 Computer 最新目录复核已保存 Model，避免启动已失效配置。
    if (!resolveCreateModel(agent.model, runtimeReport).ok) {
      return finish("start", request, result("start", request, "failed", "model_unavailable", { agent, machine, startSent: false }), { agent, machine });
    }
    const desired = store.setAgentDesiredRuntimeState(agent.id, "running") ?? agent;
    const startSent = deps.startAgent(desired);
    return finish("start", request, result(
      "start",
      request,
      startSent ? "completed" : "failed",
      startSent ? undefined : "daemon_unavailable",
      { agent: desired, machine, startSent }
    ), { agent: desired, machine });
  }

  function stopAgent(request: AgentTargetRequest): AgentManagementResult {
    const resolution = finishResolution("stop", request, resolveManagedAgent(store, { ...request, action: "stop" }));
    if ("status" in resolution) return resolution;
    const { agent, machine } = resolution;
    const desired = store.setAgentDesiredRuntimeState(agent.id, "stopped") ?? agent;
    const settlement = settleRuntime(agent.id, "agent_stopped");
    if (!settlement) {
      return finish("stop", request, result("stop", request, "partial", "runtime_lifecycle_settlement_failed", {
        agent: desired,
        machine,
        stopSent: false
      }), { agent: desired, machine });
    }
    if (agent.status === "offline") {
      const changed = settlement.cancelledExecutions.length > 0 || settlement.resolvedApprovals.length > 0;
      return finish("stop", request, result("stop", request, changed ? "completed" : "noop", undefined, { agent: desired, machine, stopSent: false }), { agent: desired, machine });
    }
    const stopSent = deps.sendToDaemon(machine.id, { type: "agent:stop", agentId: agent.id });
    // stop 请求一旦确认，server 真源先进入 Offline；daemon 未收到时以 partial 明确保留不确定性。
    store.updateAgentStatus(agent.id, "offline", "Stop requested.");
    deps.emitRealtimeAgentStatus(agent.id);
    const updated = store.getAgent(agent.id) ?? agent;
    return finish("stop", request, result(
      "stop",
      request,
      stopSent ? "completed" : "partial",
      stopSent ? undefined : "daemon_unavailable",
      { agent: updated, machine, stopSent }
    ), { agent: updated, machine });
  }

  function restartAgent(request: AgentTargetRequest): AgentManagementResult {
    const resolution = finishResolution("restart", request, resolveManagedAgent(store, { ...request, action: "restart" }));
    if ("status" in resolution) return resolution;
    const { agent, machine } = resolution;
    const runtimeReport = availableRuntimeReport(store, agent, machine);
    const runtimeAccessError = runtimeAccessConfigurationError(agent.runtime, agent.permissionMode, agent.runtimeResourceGrants, runtimeReport);
    if (runtimeAccessError) {
      return finish("restart", request, result("restart", request, "failed", runtimeAccessError, { agent, machine, startSent: false, stopSent: false }), { agent, machine });
    }
    if (machine.status !== "online") {
      return finish("restart", request, result("restart", request, "failed", "machine_offline", { agent, machine, startSent: false, stopSent: false }), { agent, machine });
    }
    if (!runtimeReport) {
      return finish("restart", request, result("restart", request, "failed", "runtime_unavailable", { agent, machine, startSent: false, stopSent: false }), { agent, machine });
    }
    // Model 校验必须发生在 stop 之前，拒绝时不能产生任一 daemon 副作用。
    if (!resolveCreateModel(agent.model, runtimeReport).ok) {
      return finish("restart", request, result("restart", request, "failed", "model_unavailable", { agent, machine, startSent: false, stopSent: false }), { agent, machine });
    }
    const desired = store.setAgentDesiredRuntimeState(agent.id, "running") ?? agent;
    const stopSent = deps.sendToDaemon(machine.id, { type: "agent:stop", agentId: agent.id });
    const settlement = settleRuntime(agent.id, "agent_restarted");
    if (!settlement) {
      return finish("restart", request, result("restart", request, "partial", "runtime_lifecycle_settlement_failed", {
        agent: desired,
        machine,
        startSent: false,
        stopSent
      }), { agent: desired, machine });
    }
    // restart 只复用原 session 发 stop + start，不能清理 RuntimeSession。
    const startSent = deps.startAgent(desired);
    const deliveredCount = Number(stopSent) + Number(startSent);
    const status: AgentManagementResultStatus = deliveredCount === 2 ? "completed" : deliveredCount === 0 ? "failed" : "partial";
    return finish("restart", request, result(
      "restart",
      request,
      status,
      status === "completed" ? undefined : "daemon_unavailable",
      { agent: desired, machine, startSent, stopSent }
    ), { agent: desired, machine });
  }

  function resetAgent(request: AgentTargetRequest): AgentManagementResult {
    const resolution = finishResolution("reset", request, resolveManagedAgent(store, { ...request, action: "reset" }));
    if ("status" in resolution) return resolution;
    const { agent, machine } = resolution;
    // Reset 会销毁可恢复 session，因此保持 Web 原有的 Agent + Computer 双 owner 边界，不继承 Workspace Owner 的宽授权。
    if (!isPlatformOperator(request) && !canManageAgentRuntime(request.actorUserId, agent, machine)) {
      return finish("reset", request, result("reset", request, "denied", "agent_owner_required", { agent, machine }), { agent, machine });
    }
    const runtimeReport = availableRuntimeReport(store, agent, machine);
    const runtimeAccessError = runtimeAccessConfigurationError(agent.runtime, agent.permissionMode, agent.runtimeResourceGrants, runtimeReport);
    if (runtimeAccessError) {
      return finish("reset", request, result("reset", request, "failed", runtimeAccessError, {
        agent,
        machine,
        startSent: false,
        stopSent: false,
        sessionCleared: false
      }), { agent, machine });
    }
    if (machine.status !== "online") {
      return finish("reset", request, result("reset", request, "failed", "machine_offline", {
        agent,
        machine,
        startSent: false,
        stopSent: false,
        sessionCleared: false
      }), { agent, machine });
    }
    if (!runtimeReport) {
      return finish("reset", request, result("reset", request, "failed", "runtime_unavailable", {
        agent,
        machine,
        startSent: false,
        stopSent: false,
        sessionCleared: false
      }), { agent, machine });
    }
    // 与 restart 一样，必须在停止旧进程和清理 session 前验证保存的 Model。
    if (!resolveCreateModel(agent.model, runtimeReport).ok) {
      return finish("reset", request, result("reset", request, "failed", "model_unavailable", {
        agent,
        machine,
        startSent: false,
        stopSent: false,
        sessionCleared: false
      }), { agent, machine });
    }

    const desired = store.setAgentDesiredRuntimeState(agent.id, "running") ?? agent;

    let stopSent = false;
    try {
      // 即使服务端记录为 Offline，也发送 stop 来收敛可能迟到或漂移的 daemon 进程。
      stopSent = deps.sendToDaemon(machine.id, { type: "agent:stop", agentId: agent.id });
    } catch {
      stopSent = false;
    }
    // 旧 runtime 仍可能持有原 session 时不能先清服务端指针，否则可能出现两个并行会话。
    if (!stopSent) {
      return finish("reset", request, result("reset", request, "failed", "daemon_unavailable", {
        agent,
        machine,
        stopSent,
        startSent: false,
        sessionCleared: false
      }), { agent, machine });
    }

    const settlement = settleRuntime(agent.id, "agent_reset");
    if (!settlement) {
      return finish("reset", request, result("reset", request, "partial", "runtime_lifecycle_settlement_failed", {
        agent,
        machine,
        stopSent,
        startSent: false,
        sessionCleared: false
      }), { agent, machine });
    }

    let resetRuntime: ReturnType<TyrDb["resetAgentRuntimeSessions"]> = null;
    try {
      resetRuntime = store.resetAgentRuntimeSessions(desired.id, "Agent reset requested; next runtime start will create a fresh session.");
    } catch {
      resetRuntime = null;
    }
    if (!resetRuntime) {
      return finish("reset", request, result(
        "reset",
        request,
        stopSent ? "partial" : "failed",
        "session_clear_failed",
        {
          agent,
          machine,
          stopSent,
          startSent: false,
          sessionCleared: false
        }
      ), { agent: desired, machine, previousSessionId: agent.sessionId ?? null });
    }

    let startSent = false;
    try {
      // start 必须读取清理后的 Agent 真源记录，确保不携带旧 sessionId/launchId。
      startSent = deps.startAgent(resetRuntime.agent);
    } catch {
      startSent = false;
    }
    return finish("reset", request, result(
      "reset",
      request,
      startSent ? "completed" : "partial",
      startSent ? undefined : "agent_reset_start_not_delivered",
      {
        agent: resetRuntime.agent,
        machine,
        stopSent,
        startSent,
        sessionCleared: true
      }
    ), {
      agent: resetRuntime.agent,
      machine,
      previousSessionId: agent.sessionId ?? null,
      invalidatedSessionCount: resetRuntime.invalidatedSessions.length
    });
  }

  function deleteAgent(request: AgentTargetRequest): AgentManagementResult {
    const resolution = finishResolution("delete", request, resolveManagedAgent(store, { ...request, action: "delete", includeDeleted: true }));
    if ("status" in resolution) return resolution;
    const { agent, machine } = resolution;
    const alreadyDeleted = Boolean(agent.deletedAt);
    store.setAgentDesiredRuntimeState(agent.id, "stopped");
    const stopSent = alreadyDeleted
      ? undefined
      : deps.sendToDaemon(machine.id, { type: "agent:stop", agentId: agent.id });
    const settlement = settleRuntime(agent.id, "agent_deleted");
    if (!settlement) {
      return finish("delete", request, result("delete", request, "partial", "runtime_lifecycle_settlement_failed", {
        agent,
        machine,
        stopSent
      }), { agent, machine });
    }
    const deleted = store.deleteAgent(agent.id);
    if (!deleted) {
      return finish("delete", request, result("delete", request, "failed", "agent_not_found", { agent, machine, stopSent }), { agent, machine });
    }
    const updated = store.getAgent(agent.id) ?? agent;
    // 重复删除也执行 cleanup、广播和 workspace sync，用于修复旧版本遗留 membership。
    emitAgentNavigationRealtimeEvent(deps.broadcastRealtime, "agent:deleted", {
      agentId: agent.id,
      machineId: agent.machineId,
      serverId: request.serverId
    });
    let workspaceSyncFailed = false;
    try {
      deps.publishWorkspaceSync();
    } catch {
      workspaceSyncFailed = true;
    }
    const daemonDeliveryFailed = !alreadyDeleted && stopSent === false;
    const partial = daemonDeliveryFailed || workspaceSyncFailed;
    return finish("delete", request, result(
      "delete",
      request,
      partial ? "partial" : "completed",
      daemonDeliveryFailed ? "daemon_unavailable" : workspaceSyncFailed ? "workspace_sync_failed" : undefined,
      { agent: updated, machine, ...(stopSent === undefined ? {} : { stopSent }) }
    ), { agent: updated, machine });
  }

  return {
    listAgentCandidates,
    validateAgentTarget,
    isProtectedAgentReference,
    listCreationOptions,
    listManageableMachines,
    batchByMachine,
    createAgent,
    updateAgent,
    startAgent,
    stopAgent,
    restartAgent,
    resetAgent,
    deleteAgent
  };
}
