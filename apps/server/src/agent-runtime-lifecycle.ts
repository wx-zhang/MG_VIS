import type {
  RuntimeApprovalRecord,
  RuntimeExecutionEventRecord,
  RuntimeExecutionRecord,
  RuntimeExecutionStatus
} from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";

export type AgentRuntimeLifecycleReason =
  | "agent_stopped"
  | "agent_restarted"
  | "agent_reset"
  | "agent_configuration_restarted"
  | "agent_deleted"
  | "runtime_launch_replaced";

const activeExecutionStatuses = new Set<RuntimeExecutionStatus>([
  "queued",
  "delivered",
  "running",
  "waiting_approval"
]);

const lifecycleCopy: Record<AgentRuntimeLifecycleReason, { execution: string; approval: string }> = {
  agent_stopped: {
    execution: "Execution cancelled because the Agent was stopped.",
    approval: "Rejected because the Agent was stopped before this approval was resolved."
  },
  agent_restarted: {
    execution: "Execution cancelled because the Agent was restarted.",
    approval: "Rejected because the Agent was restarted before this approval was resolved."
  },
  agent_reset: {
    execution: "Execution cancelled because the Agent was reset.",
    approval: "Rejected because the Agent was reset before this approval was resolved."
  },
  agent_configuration_restarted: {
    execution: "Execution cancelled because an Agent configuration change restarted the runtime.",
    approval: "Rejected because an Agent configuration change restarted the runtime before this approval was resolved."
  },
  agent_deleted: {
    execution: "Execution cancelled because the Agent was deleted.",
    approval: "Rejected because the Agent was deleted before this approval was resolved."
  },
  runtime_launch_replaced: {
    execution: "Execution cancelled because its runtime launch was replaced.",
    approval: "Rejected because the runtime launch was replaced before this approval was resolved."
  }
};

export interface AgentRuntimeLifecycleSettlement {
  cancelledExecutions: RuntimeExecutionRecord[];
  resolvedApprovals: RuntimeApprovalRecord[];
  events: RuntimeExecutionEventRecord[];
}

export interface SettleAgentRuntimeLifecycleInput {
  agentId: string;
  reason: AgentRuntimeLifecycleReason;
  executionIds?: string[];
}

export interface SupersededRuntimeLifecyclePlan {
  agentId: string;
  currentLaunchId: string;
  executionIds: string[];
  pendingApprovalIds: string[];
}

export interface ReconcileSupersededRuntimeLifecycleResult {
  dryRun: boolean;
  plans: SupersededRuntimeLifecyclePlan[];
  settlement: AgentRuntimeLifecycleSettlement;
}

function emptySettlement(): AgentRuntimeLifecycleSettlement {
  return { cancelledExecutions: [], resolvedApprovals: [], events: [] };
}

function isRuntimeBoundApproval(approval: RuntimeApprovalRecord): boolean {
  // outbound action 已由 server 持久化，可脱离原 turn 等待决定；这里只关闭依赖旧 runtime 进程的审批。
  return !approval.method.startsWith("governance/outbound/");
}

export function settleAgentRuntimeLifecycle(
  store: TyrDb,
  input: SettleAgentRuntimeLifecycleInput
): AgentRuntimeLifecycleSettlement {
  const requestedExecutionIds = input.executionIds ? new Set(input.executionIds) : null;
  const copy = lifecycleCopy[input.reason];
  const settle = store.db.transaction(() => {
    const result = emptySettlement();
    const executions = store.listRuntimeExecutions({ agentId: input.agentId, limit: 1000 })
      .filter((execution) => activeExecutionStatuses.has(execution.status))
      .filter((execution) => !requestedExecutionIds || requestedExecutionIds.has(execution.id));

    for (const execution of executions) {
      const pendingApprovals = store.listRuntimeApprovals({ executionId: execution.id, limit: 1000 })
        .filter((approval) => approval.status === "pending" && isRuntimeBoundApproval(approval));
      for (const approval of pendingApprovals) {
        const resolved = store.resolveRuntimeApproval(
          approval.id,
          "reject",
          "system_agent_lifecycle",
          copy.approval
        );
        if (!resolved) throw new Error(`runtime_approval_settlement_failed:${approval.id}`);
        result.resolvedApprovals.push(resolved);
        result.events.push(store.appendRuntimeExecutionEvent({
          executionId: execution.id,
          agentId: execution.agentId,
          taskId: execution.taskId,
          kind: "approval_resolved",
          title: "Approval resolved",
          detail: copy.approval,
          payload: {
            approvalId: resolved.id,
            decision: "reject",
            source: "agent_lifecycle",
            reason: input.reason
          }
        }));
      }

      // 先明确拒绝审批，再写 execution 终态；外层事务保证两者不会留下半收敛状态。
      const cancelled = store.updateRuntimeExecutionStatus(execution.id, "cancelled");
      if (!cancelled || cancelled.status !== "cancelled") {
        throw new Error(`runtime_execution_settlement_failed:${execution.id}`);
      }
      store.ackAgentInbox(execution.agentId, [execution.messageId]);
      result.cancelledExecutions.push(cancelled);
      result.events.push(store.appendRuntimeExecutionEvent({
        executionId: execution.id,
        agentId: execution.agentId,
        taskId: execution.taskId,
        kind: "diagnostic",
        title: "Execution cancelled",
        detail: copy.execution,
        payload: {
          source: "agent_lifecycle",
          reason: input.reason,
          previousStatus: execution.status,
          previousLaunchId: execution.launchId ?? null
        }
      }));
    }
    return result;
  });
  return settle();
}

export function planSupersededRuntimeLifecycle(
  store: TyrDb,
  options: { serverId?: string; agentId?: string; activeExecutionIds?: Set<string> } = {}
): SupersededRuntimeLifecyclePlan[] {
  const plans: SupersededRuntimeLifecyclePlan[] = [];
  for (const agent of store.listAgents(options.serverId)) {
    if (options.agentId && agent.id !== options.agentId) continue;
    if (!agent.launchId) continue;
    const pendingApprovals = store.listRuntimeApprovals({ agentId: agent.id, limit: 1000 })
      .filter((approval) => approval.status === "pending" && isRuntimeBoundApproval(approval));
    const approvalsByExecution = new Map<string, RuntimeApprovalRecord[]>();
    for (const approval of pendingApprovals) {
      if (!approval.executionId) continue;
      const grouped = approvalsByExecution.get(approval.executionId) ?? [];
      grouped.push(approval);
      approvalsByExecution.set(approval.executionId, grouped);
    }
    const supersededApprovalExecutionIds = new Set(Array.from(approvalsByExecution.entries())
      // 所有未决 runtime 审批都必须明确属于旧 launch；混合或缺失 launch 的歧义记录留给人工维护。
      .filter(([, approvals]) => approvals.every((approval) => Boolean(approval.launchId && approval.launchId !== agent.launchId)))
      .map(([executionId]) => executionId));
    const executions = store.listRuntimeExecutions({ agentId: agent.id, limit: 1000 })
      .filter((execution) => execution.status === "waiting_approval")
      .filter((execution) => supersededApprovalExecutionIds.has(execution.id))
      // daemon 快照显式声明的 active execution 优先于旧数据库 launch 快照，不能被兜底清理误杀。
      .filter((execution) => !options.activeExecutionIds?.has(execution.id));
    if (executions.length === 0) continue;
    const executionIds = executions.map((execution) => execution.id);
    const executionIdSet = new Set(executionIds);
    const pendingApprovalIds = pendingApprovals
      .filter((approval) => Boolean(approval.executionId && executionIdSet.has(approval.executionId)))
      .map((approval) => approval.id);
    plans.push({ agentId: agent.id, currentLaunchId: agent.launchId, executionIds, pendingApprovalIds });
  }
  return plans;
}

export function reconcileSupersededRuntimeLifecycle(
  store: TyrDb,
  options: {
    serverId?: string;
    agentId?: string;
    activeExecutionIds?: Set<string>;
    dryRun?: boolean;
    onSettled?: (settlement: AgentRuntimeLifecycleSettlement) => void;
  } = {}
): ReconcileSupersededRuntimeLifecycleResult {
  const plans = planSupersededRuntimeLifecycle(store, options);
  const settlement = emptySettlement();
  if (options.dryRun) return { dryRun: true, plans, settlement };

  for (const plan of plans) {
    const settled = settleAgentRuntimeLifecycle(store, {
      agentId: plan.agentId,
      reason: "runtime_launch_replaced",
      executionIds: plan.executionIds
    });
    settlement.cancelledExecutions.push(...settled.cancelledExecutions);
    settlement.resolvedApprovals.push(...settled.resolvedApprovals);
    settlement.events.push(...settled.events);
    if (settled.cancelledExecutions.length || settled.resolvedApprovals.length) options.onSettled?.(settled);
  }
  return { dryRun: false, plans, settlement };
}
