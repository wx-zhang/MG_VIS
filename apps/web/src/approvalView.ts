import type { RuntimeApprovalRecord, RuntimeExecutionRecord, TaskRecord } from "@tyr-ai/contracts";

export type ExecutionActivityItem = {
  timestamp: number;
  entry: {
    kind: string;
    activity?: string;
    detail?: string;
    text?: string;
    toolName?: string;
    toolInput?: string;
  };
};

export function pendingApprovalCount(approvals: RuntimeApprovalRecord[]): number {
  return approvals.filter((approval) => approval.status === "pending").length;
}

export function pendingApprovalCountByAgentId(approvals: RuntimeApprovalRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const approval of approvals) {
    if (approval.status !== "pending") continue;
    counts.set(approval.agentId, (counts.get(approval.agentId) ?? 0) + 1);
  }
  return counts;
}

export function approvalTabLabel(approvals: RuntimeApprovalRecord[]): string {
  const count = pendingApprovalCount(approvals);
  return count > 0 ? `Execution ${count}` : "Execution";
}

export function taskExecutionApprovals(approvals: RuntimeApprovalRecord[], task: Pick<TaskRecord, "id" | "messageId" | "threadChannelId"> | string): RuntimeApprovalRecord[] {
  const taskId = typeof task === "string" ? task : task.id;
  const messageId = typeof task === "string" ? undefined : task.messageId;
  const threadChannelId = typeof task === "string" ? undefined : task.threadChannelId;
  return approvals.filter((approval) =>
    approval.taskId === taskId ||
    Boolean(messageId && approval.messageId === messageId) ||
    Boolean(threadChannelId && approval.threadChannelId === threadChannelId)
  );
}

export function threadExecutionApprovals(
  approvals: RuntimeApprovalRecord[],
  filter: { executionIds?: string[]; taskId?: string; messageId?: string; threadChannelId?: string }
): RuntimeApprovalRecord[] {
  const executionIds = new Set(filter.executionIds ?? []);
  return approvals.filter((approval) =>
    Boolean(approval.executionId && executionIds.has(approval.executionId)) ||
    Boolean(filter.taskId && approval.taskId === filter.taskId) ||
    Boolean(filter.messageId && approval.messageId === filter.messageId) ||
    Boolean(filter.threadChannelId && approval.threadChannelId === filter.threadChannelId)
  );
}

export type BlockingRuntimeApprovalReason = "same_execution" | "waiting_approval" | "agent_pending";

export type BlockingRuntimeApproval = {
  approval: RuntimeApprovalRecord;
  execution?: RuntimeExecutionRecord;
  currentExecution?: RuntimeExecutionRecord;
  sameThread: boolean;
  reason: BlockingRuntimeApprovalReason;
};

export function blockingRuntimeApprovalForExecutions(
  currentExecutions: RuntimeExecutionRecord[],
  allExecutions: RuntimeExecutionRecord[],
  approvals: RuntimeApprovalRecord[]
): BlockingRuntimeApproval | null {
  const pendingApprovals = approvals
    .filter((approval) => approval.status === "pending")
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  if (pendingApprovals.length === 0 || currentExecutions.length === 0) return null;

  const executionsById = new Map(allExecutions.map((execution) => [execution.id, execution]));
  const currentCandidates = currentExecutions
    .filter((execution) => !isTerminalExecutionStatus(execution.status))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  if (currentCandidates.length === 0) return null;

  for (const currentExecution of currentCandidates) {
    const currentApproval = pendingApprovals.find((approval) => approval.executionId === currentExecution.id);
    if (currentApproval) {
      return {
        approval: currentApproval,
        execution: currentExecution,
        currentExecution,
        sameThread: true,
        reason: "same_execution"
      };
    }
  }

  const queuedCandidates = currentCandidates.filter((execution) => execution.status === "queued" || execution.status === "delivered");

  for (const currentExecution of queuedCandidates) {
    const sameAgentApprovals = pendingApprovals.filter((approval) => approval.agentId === currentExecution.agentId && approval.executionId !== currentExecution.id);
    const waitingBlocker = sameAgentApprovals
      .map((approval) => ({ approval, execution: approval.executionId ? executionsById.get(approval.executionId) : undefined }))
      .filter((candidate) =>
        candidate.execution?.status === "waiting_approval" &&
        Date.parse(candidate.execution.createdAt) <= Date.parse(currentExecution.createdAt)
      )
      .sort((a, b) => Date.parse(a.execution?.createdAt ?? a.approval.requestedAt) - Date.parse(b.execution?.createdAt ?? b.approval.requestedAt))[0];
    if (waitingBlocker) {
      return {
        approval: waitingBlocker.approval,
        execution: waitingBlocker.execution,
        currentExecution,
        sameThread: approvalMatchesCurrentExecutions(waitingBlocker.approval, currentExecutions),
        reason: "waiting_approval"
      };
    }
  }

  for (const currentExecution of queuedCandidates) {
    const fallback = pendingApprovals.find((approval) => approval.agentId === currentExecution.agentId && approval.executionId !== currentExecution.id);
    if (fallback) {
      return {
        approval: fallback,
        execution: fallback.executionId ? executionsById.get(fallback.executionId) : undefined,
        currentExecution,
        sameThread: approvalMatchesCurrentExecutions(fallback, currentExecutions),
        reason: "agent_pending"
      };
    }
  }

  return null;
}

export function visibleRuntimeApprovals(approvals: RuntimeApprovalRecord[]): RuntimeApprovalRecord[] {
  return [...approvals].sort((a, b) => {
    // 待人工确认的副作用动作必须固定在最前，避免被历史日志淹没。
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return b.requestedAt.localeCompare(a.requestedAt);
  });
}

export function approvalActionDisabled(approval: RuntimeApprovalRecord, submittingApprovalId: string): boolean {
  return approval.status !== "pending" || submittingApprovalId === approval.id;
}

const EXECUTION_ACTIVITY_PATTERNS = [
  "Delivered message",
  "Steered message",
  "Message queued",
  "Starting ",
  "Spawned ",
  "Runtime ",
  "Pending approval",
  "Runtime approval",
  "shell ",
  "tool_call",
  "tool_output"
];

export function taskExecutionActivity(activity: ExecutionActivityItem[], task: Pick<TaskRecord, "id" | "taskNumber" | "messageId" | "createdAt">): ExecutionActivityItem[] {
  const startedAt = Date.parse(task.createdAt);
  const candidates = activity.filter((item) => !Number.isFinite(startedAt) || item.timestamp >= startedAt);
  const marked = candidates.filter((item) => taskActivityMarkers(task).some((marker) => activityHaystack(item).includes(marker)));
  return (marked.length > 0 ? marked : candidates)
    .filter((item) => EXECUTION_ACTIVITY_PATTERNS.some((pattern) => activityHaystack(item).includes(pattern)))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function latestExecutionActivity(activity: ExecutionActivityItem[], task: Pick<TaskRecord, "id" | "taskNumber" | "messageId" | "createdAt">): ExecutionActivityItem | null {
  return taskExecutionActivity(activity, task).at(-1) ?? null;
}

function taskActivityMarkers(task: Pick<TaskRecord, "id" | "taskNumber" | "messageId">): string[] {
  return [`Task #${task.taskNumber}`, task.id, task.messageId].filter(Boolean);
}

function activityHaystack(item: ExecutionActivityItem): string {
  const detail = item.entry.detail ?? item.entry.text ?? item.entry.toolInput ?? "";
  return `${item.entry.kind} ${item.entry.activity ?? ""} ${detail}`;
}

function approvalMatchesCurrentExecutions(approval: RuntimeApprovalRecord, currentExecutions: RuntimeExecutionRecord[]): boolean {
  return currentExecutions.some((execution) =>
    approval.executionId === execution.id ||
    Boolean(approval.taskId && approval.taskId === execution.taskId) ||
    Boolean(approval.messageId && approval.messageId === execution.messageId) ||
    Boolean(approval.threadChannelId && approval.threadChannelId === execution.threadChannelId)
  );
}

function isTerminalExecutionStatus(status: RuntimeExecutionRecord["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
