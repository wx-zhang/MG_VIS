import type { GovernanceDecisionRecord, RuntimeApprovalDecision, RuntimeApprovalRecord } from "@tyr-ai/contracts";
import { classifyRuntimeApproval, evaluateDeterministicPolicy, type RuntimeApprovalClassification } from "@tyr-ai/governance";
import { isTerminalRuntimeExecutionStatus } from "./message-deletion";
import { queuedOutboundAction, resolveQueuedOutboundApproval } from "./outbound-approval-queue";
import { runtimeApprovalConflictsWithReadOnly } from "./runtime-approval-policy";
import type { ServerRouteContext } from "./server-context";

const APPROVAL_FINAL_GUARD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type RuntimeApprovalResolveSuccess = {
  approval: RuntimeApprovalRecord;
  delivered: boolean;
  outboundResult?: unknown;
};

export type RuntimeApprovalResolveBlocked = {
  blocked: true;
  status: 409;
  body: {
    error: "approval_governance_blocked" | "approval_expired" | "approval_execution_terminal" | "approval_governance_required" | "approval_outbound_replay_failed" | "runtime_access_read_only";
    reason: string;
    riskTypes?: string[];
    governanceDecisionId?: string;
    executionStatus?: string;
  };
};

export type RuntimeApprovalResolveResult = RuntimeApprovalResolveSuccess | RuntimeApprovalResolveBlocked;

export function resolveRuntimeApprovalDecision(
  ctx: ServerRouteContext,
  input: {
    approval: RuntimeApprovalRecord;
    decision: RuntimeApprovalDecision;
    resolvedByUserId: string;
    customResponse?: string;
  }
): RuntimeApprovalResolveResult {
  const { store } = ctx;
  const approval = ctx.bindRuntimeApprovalToTaskExecution(input.approval);
  const execution = approval.executionId ? store.getRuntimeExecution(approval.executionId) : null;
  const queuedOutbound = queuedOutboundAction(approval);
  if (execution && isTerminalRuntimeExecutionStatus(execution.status) && !queuedOutbound) {
    // DB 会在 execution 进入终态时失效 pending approval；这里阻止旧页面继续触发 daemon 和 Working 广播。
    if (approval.status === "pending") {
      const invalidated = store.resolveRuntimeApproval(
        approval.id,
        "reject",
        "system_execution_terminal",
        "Execution ended before this approval was resolved."
      );
      if (invalidated) ctx.emitRealtimeRuntimeApproval(invalidated);
    }
    return {
      blocked: true,
      status: 409,
      body: {
        error: "approval_execution_terminal",
        reason: `Execution already ended with status ${execution.status}; request a new run instead.`,
        executionStatus: execution.status
      }
    };
  }
  if (approval.status !== "pending") {
    // 重复点击或慢刷新会再次命中同一审批；这里保持幂等，不再重复唤醒 daemon。
    return { approval, delivered: false };
  }
  if (input.decision === "approve" && approvalIsExpired(approval.requestedAt)) {
    // 过期审批不能继续占据 Pending；按系统拒绝走完整投递与 execution 收口，让 daemon 退出等待态。
    resolveRuntimeApprovalDecision(ctx, {
      approval,
      decision: "reject",
      resolvedByUserId: "system_approval_expired",
      customResponse: "Approval expired before it was resolved."
    });
    return {
      blocked: true,
      status: 409,
      body: {
        error: "approval_expired",
        reason: "Approval is older than 24 hours; ask the agent to request a fresh approval."
      }
    };
  }
  const agent = store.getAgent(approval.agentId);
  if (input.decision === "approve") {
    const classification = classifyRuntimeApproval({
      actionKind: approval.kind,
      payload: approvalPayloadForClassification(approval)
    });
    if (runtimeApprovalConflictsWithReadOnly(agent?.permissionMode, approval.kind, classification)) {
      return {
        blocked: true,
        status: 409,
        body: {
          error: "runtime_access_read_only",
          reason: "Read-only Runtime Access cannot be elevated by approval. Change Runtime Access and restart the Agent."
        }
      };
    }
  }
  const guard = runtimeApprovalFinalGuard(ctx, approval, input.decision);
  if (guard) return guard;
  const outbound = resolveQueuedOutboundApproval(ctx, approval, input.decision, input.customResponse);
  if (outbound && "blocked" in outbound) return outbound;

  const resolved = store.resolveRuntimeApproval(approval.id, input.decision, input.resolvedByUserId, input.customResponse);
  if (resolved) ctx.emitRealtimeRuntimeApproval(resolved);
  const machine = agent?.machineId ? store.getMachine(agent.machineId) : null;
  const delivered = outbound?.handled ? false : Boolean(agent && machine && ctx.sendToDaemon(machine.id, {
    type: "agent:runtime_approval:resolve",
    agentId: agent.id,
    approvalId: approval.id,
    requestId: approval.requestId,
    ...(execution ? {
      executionId: execution.id,
      ...(execution.runtimeContextKey && execution.runtimeSessionRecordId ? {
        contextKey: execution.runtimeContextKey,
        sessionRecordId: execution.runtimeSessionRecordId
      } : {})
    } : {}),
    decision: input.decision,
    customResponse: input.customResponse
  }));
  if (agent) {
    store.recordActivity(agent.id, "approval", `Runtime approval ${input.decision}: ${approval.title} ${approval.detail}`.trim());
    ctx.emitRealtimeAgentActivity(agent.id, "working", `Runtime approval ${input.decision}: ${approval.title}`, [{ kind: "approval", decision: input.decision, detail: approval.detail }]);
  }
  if (approval.executionId) {
    const event = store.appendRuntimeExecutionEvent({
      executionId: approval.executionId,
      agentId: approval.agentId,
      taskId: approval.taskId,
      kind: "approval_resolved",
      title: "Approval resolved",
      detail: `Runtime approval ${input.decision}: ${approval.title}`,
      payload: { approvalId: approval.id, decision: input.decision, customResponse: input.customResponse }
    });
    const outboundTurnCompleted = Boolean(
      outbound?.handled &&
      store.listRuntimeExecutionEvents(approval.executionId).some((item) => item.kind === "turn_completed")
    );
    // Queued outbound 不依赖仍在运行的 runtime：拒绝即失败；批准后若 turn 已结束则正式完成，否则恢复运行等待后续 runtime event。
    const nextStatus = input.decision === "reject" || (outbound?.handled && input.decision !== "approve")
      ? "failed"
      : outboundTurnCompleted
        ? "completed"
        : "running";
    const updated = store.updateRuntimeExecutionStatus(approval.executionId, nextStatus);
    ctx.emitRealtimeRuntimeExecution(updated, event);
  }
  return {
    approval: resolved ?? approval,
    delivered,
    ...(outbound?.handled && outbound.outboundResult !== undefined ? { outboundResult: outbound.outboundResult } : {})
  };
}

function runtimeApprovalFinalGuard(
  ctx: ServerRouteContext,
  approval: RuntimeApprovalRecord,
  decision: RuntimeApprovalDecision
): RuntimeApprovalResolveBlocked | null {
  if (decision !== "approve") return null;
  const classification = classifyRuntimeApproval({
    actionKind: approval.kind,
    payload: approvalPayloadForClassification(approval)
  });
  const deterministic = evaluateDeterministicPolicy({ approval, classification });
  if (deterministic.decision === "deny") {
    return {
      blocked: true,
      status: 409,
      body: {
        error: "approval_governance_blocked",
        reason: deterministic.reason || "Current deterministic governance policy denies this approval.",
        riskTypes: deterministic.riskTypes
      }
    };
  }

  const decisions = ctx.store.listGovernanceDecisions({ approvalId: approval.id, limit: 1 });
  const latestDecision = decisions[0];
  const governanceMode = ctx.governanceConfig?.mode ?? "shadow";
  const governanceEnabled = Boolean(ctx.governanceConfig?.enabled);
  if (latestDecision?.decision === "deny" && (governanceMode === "enforce" || latestDecision.mode === "enforce")) {
    return governanceDecisionBlocked(latestDecision);
  }

  if (governanceEnabled && decisions.length === 0 && requiresRecordedGovernanceDecision(classification)) {
    return {
      blocked: true,
      status: 409,
      body: {
        error: "approval_governance_required",
        reason: "This risky approval has no recorded governance decision; ask the agent to request a fresh approval."
      }
    };
  }

  return null;
}

function governanceDecisionBlocked(decision: GovernanceDecisionRecord): RuntimeApprovalResolveBlocked {
  return {
    blocked: true,
    status: 409,
    body: {
      error: "approval_governance_blocked",
      reason: decision.reason || "Governance denied this approval.",
      riskTypes: decision.riskTypes,
      governanceDecisionId: decision.id
    }
  };
}

function requiresRecordedGovernanceDecision(classification: RuntimeApprovalClassification): boolean {
  return classification !== "readonly" && classification !== "low_risk_workflow";
}

function approvalIsExpired(requestedAt: string): boolean {
  const requestedMs = Date.parse(requestedAt);
  if (!Number.isFinite(requestedMs)) return false;
  return Date.now() - requestedMs > APPROVAL_FINAL_GUARD_MAX_AGE_MS;
}

function approvalPayloadForClassification(approval: RuntimeApprovalRecord): unknown {
  const payload = approval.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  if (approval.kind === "command") return { command: approval.detail };
  return payload;
}
