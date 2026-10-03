import {
  isCommunicationAgent,
  type DaemonInbound,
  type RuntimeApprovalRecord,
  type RuntimeExecutionEventRecord,
  type RuntimeExecutionRecord
} from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import type { PlatformOpsRequest, PlatformOpsResponse } from "./platform-ops";

export const PLATFORM_STALE_EXECUTION_MIN_AGE_MS = 24 * 60 * 60 * 1000;

type ClearStaleExecutionRequest = Extract<PlatformOpsRequest, { action: "clear_stale_execution" }>;

export interface PlatformStaleExecutionDependencies {
  store: TyrDb;
  sendToDaemon(machineId: string, message: DaemonInbound): boolean;
  emitRealtimeRuntimeApproval(approval: RuntimeApprovalRecord): void;
  emitRealtimeRuntimeExecution(execution: RuntimeExecutionRecord | null, event?: RuntimeExecutionEventRecord): void;
  now?: () => number;
}

function isAtLeastOneDayOld(value: string, now: number): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && now - timestamp >= PLATFORM_STALE_EXECUTION_MIN_AGE_MS;
}

export function clearStalePlatformExecution(
  deps: PlatformStaleExecutionDependencies,
  request: ClearStaleExecutionRequest
): PlatformOpsResponse {
  const { store } = deps;
  const agent = store.getAgent(request.agentId);
  const machine = agent?.machineId ? store.getMachine(agent.machineId) : null;
  const serverId = agent?.serverId ?? machine?.serverId ?? null;
  const audit = (status: "completed" | "noop" | "failed", errorCode: string | null, metadata: Record<string, unknown> = {}) => {
    store.recordAuditEvent({
      kind: "platform_operator_stale_execution_clear",
      actorType: "platform_operator",
      actorId: request.operatorId,
      resourceType: "agent",
      resourceId: request.agentId,
      serverId,
      metadata: {
        operationId: request.requestId,
        action: request.action,
        status,
        source: "ops",
        reason: request.reason,
        reference: request.reference,
        machineId: machine?.id ?? null,
        executionId: request.executionId,
        approvalId: request.approvalId ?? null,
        errorCode,
        ...metadata
      }
    });
  };
  const fail = (error: string, metadata: Record<string, unknown> = {}): PlatformOpsResponse => {
    audit("failed", error, metadata);
    return { ok: false, requestId: request.requestId, error };
  };

  // 历史 Agent 软删除后 execution/approval 仍作为审计记录保留；本入口只收敛精确旧记录，不恢复或管理该 Agent。
  if (!agent || !machine || machine.deletedAt || !serverId || isCommunicationAgent(agent)) {
    return fail("agent_not_found");
  }
  const execution = store.getRuntimeExecution(request.executionId);
  if (!execution || execution.agentId !== agent.id || (execution.serverId ?? serverId) !== serverId || execution.machineId !== machine.id) {
    return fail("execution_not_found");
  }
  const approval = request.approvalId ? store.getRuntimeApproval(request.approvalId) : null;
  if (request.approvalId && (
    !approval ||
    approval.agentId !== agent.id ||
    approval.executionId !== execution.id ||
    (approval.serverId ?? serverId) !== serverId ||
    approval.machineId !== machine.id
  )) {
    return fail("approval_not_found");
  }
  if (execution.status === "cancelled" && (!approval || approval.status === "rejected")) {
    audit("noop", null, {
      previousExecutionStatus: execution.status,
      finalExecutionStatus: execution.status,
      previousApprovalStatus: approval?.status ?? null,
      finalApprovalStatus: approval?.status ?? null
    });
    return {
      ok: true,
      requestId: request.requestId,
      result: {
        action: request.action,
        status: "noop",
        agentId: agent.id,
        machineId: machine.id,
        executionId: execution.id,
        executionStatus: execution.status,
        approvalId: approval?.id ?? null,
        approvalStatus: approval?.status ?? null
      }
    };
  }

  const now = deps.now?.() ?? Date.now();
  // 陈旧以最后状态更新时间为准；很早创建但近期仍有进展的执行不能被平台维护误取消。
  if (!isAtLeastOneDayOld(execution.updatedAt, now)) {
    return fail("execution_not_stale", { executionCreatedAt: execution.createdAt, executionUpdatedAt: execution.updatedAt });
  }
  if (approval && !isAtLeastOneDayOld(approval.requestedAt, now)) {
    return fail("approval_not_stale", { approvalRequestedAt: approval.requestedAt });
  }

  const pendingApprovals = store.listRuntimeApprovals({ executionId: execution.id, limit: 1000 })
    .filter((item) => item.status === "pending");
  const requestedPendingApproval = pendingApprovals.find((item) => item.id === request.approvalId);
  if (execution.status === "waiting_approval") {
    // Waiting execution 必须显式、唯一地绑定待拒绝审批，不能让 execution 终态迁移顺带拒绝未授权目标。
    if (!request.approvalId || pendingApprovals.length !== 1 || !requestedPendingApproval) {
      return fail("pending_approval_mismatch", { pendingApprovalIds: pendingApprovals.map((item) => item.id) });
    }
  } else if (execution.status === "queued") {
    if (request.approvalId || pendingApprovals.length > 0) {
      return fail("queued_execution_has_approval", { pendingApprovalIds: pendingApprovals.map((item) => item.id) });
    }
  } else {
    return fail("execution_not_clearable", { executionStatus: execution.status });
  }

  const previousExecutionStatus = execution.status;
  const previousApprovalStatus = approval?.status ?? null;
  const publicDetail = "Rejected during platform maintenance because the execution was stale.";
  const resolvedApproval = approval?.status === "pending"
    ? store.resolveRuntimeApproval(approval.id, "reject", `platform:${request.operatorId}`, publicDetail)
    : approval;
  if (approval && !resolvedApproval) return fail("approval_reject_failed");

  // 先收敛审批，再把 execution 写成终态；两步均同步完成后才通知 daemon，避免远端先恢复旧任务。
  const cancelled = store.updateRuntimeExecutionStatus(execution.id, "cancelled");
  if (!cancelled || cancelled.status !== "cancelled") {
    return fail("execution_cancel_failed", { executionStatus: cancelled?.status ?? execution.status });
  }
  store.ackAgentInbox(agent.id, [execution.messageId]);
  if (resolvedApproval && approval?.status === "pending") deps.emitRealtimeRuntimeApproval(resolvedApproval);
  if (resolvedApproval && approval?.status === "pending") {
    store.appendRuntimeExecutionEvent({
      executionId: execution.id,
      agentId: agent.id,
      taskId: execution.taskId,
      kind: "approval_resolved",
      title: "Approval resolved",
      detail: "Runtime approval rejected during platform maintenance.",
      payload: { approvalId: resolvedApproval.id, decision: "reject", source: "platform_maintenance" }
    });
  }
  const cancellationEvent = store.appendRuntimeExecutionEvent({
    executionId: execution.id,
    agentId: agent.id,
    taskId: execution.taskId,
    kind: "diagnostic",
    title: "Execution cancelled",
    detail: "Stale execution cancelled during platform maintenance.",
    payload: { source: "platform_maintenance" }
  });
  deps.emitRealtimeRuntimeExecution(cancelled, cancellationEvent);

  const daemonTargetActive = !agent.deletedAt;
  const approvalDelivered = Boolean(daemonTargetActive && resolvedApproval && approval?.status === "pending" && deps.sendToDaemon(machine.id, {
    type: "agent:runtime_approval:resolve",
    agentId: agent.id,
    approvalId: resolvedApproval.id,
    requestId: resolvedApproval.requestId,
    executionId: execution.id,
    ...(execution.runtimeContextKey && execution.runtimeSessionRecordId ? {
      contextKey: execution.runtimeContextKey,
      sessionRecordId: execution.runtimeSessionRecordId
    } : {}),
    decision: "reject",
    customResponse: publicDetail
  }));
  const cancellationSent = !daemonTargetActive
    ? false
    : execution.runtimeContextKey && execution.runtimeSessionRecordId
    ? deps.sendToDaemon(machine.id, {
      type: "agent:runtime_execution:cancel",
      agentId: agent.id,
      executionId: execution.id,
      contextKey: execution.runtimeContextKey,
      sessionRecordId: execution.runtimeSessionRecordId
    })
    : deps.sendToDaemon(machine.id, { type: "agent:stop", agentId: agent.id });

  const activityText = resolvedApproval
    ? "Platform maintenance rejected a stale approval and cancelled its execution. Completed."
    : "Platform maintenance cancelled a stale Agent execution. Completed.";
  // 客户 Activity 只展示维护事实；运维身份、工单、内部原因和目标 ID 仅写入内部审计。
  if (!agent.deletedAt) store.recordActivity(agent.id, "platform_maintenance", activityText);
  audit("completed", null, {
    agentDeletedAt: agent.deletedAt ?? null,
    previousExecutionStatus,
    finalExecutionStatus: cancelled.status,
    previousApprovalStatus,
    finalApprovalStatus: resolvedApproval?.status ?? null,
    approvalDelivered,
    cancellationSent
  });
  return {
    ok: true,
    requestId: request.requestId,
    result: {
      action: request.action,
      status: "completed",
      agentId: agent.id,
      agentDeleted: Boolean(agent.deletedAt),
      machineId: machine.id,
      executionId: execution.id,
      executionStatus: cancelled.status,
      approvalId: resolvedApproval?.id ?? null,
      approvalStatus: resolvedApproval?.status ?? null,
      approvalDelivered,
      cancellationSent
    }
  };
}
