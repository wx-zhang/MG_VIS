import type { MessageRecord, RuntimeExecutionRecord, RuntimeExecutionStatus } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";

export const MESSAGE_EXECUTION_CANCEL_DETAIL = "Execution cancelled because the source message was deleted.";
export const MESSAGE_EXECUTION_STOP_DETAIL = "Execution cancelled by the message author.";

const cancellableExecutionStatuses = new Set<RuntimeExecutionStatus>([
  "queued",
  "delivered",
  "running",
  "waiting_approval",
  "stalled"
]);

type MessageExecutionCancellationStore = Pick<
  TyrDb,
  "listRuntimeExecutions" | "updateRuntimeExecutionStatus" | "appendRuntimeExecutionEvent" | "ackAgentInbox"
>;

export type MessageExecutionCancellationResult = {
  cancelledExecutions: RuntimeExecutionRecord[];
};

export function isCancellableRuntimeExecutionStatus(status: RuntimeExecutionStatus): boolean {
  return cancellableExecutionStatuses.has(status);
}

export function isTerminalRuntimeExecutionStatus(status: RuntimeExecutionStatus): boolean {
  return status === "completed" || status === "failed" || status === "stalled" || status === "cancelled";
}

export function shouldIgnoreRuntimeEventForExecution(execution: Pick<RuntimeExecutionRecord, "status">): boolean {
  // 终态 execution 已经由 server 真源收敛；迟到 runtime event 只能作为过期信号，不能重新打开或重复补块。
  return isTerminalRuntimeExecutionStatus(execution.status);
}

export function cancelMessageExecutions(
  store: MessageExecutionCancellationStore,
  message: Pick<MessageRecord, "id">,
  detail = MESSAGE_EXECUTION_CANCEL_DETAIL
): MessageExecutionCancellationResult {
  const executions = store
    .listRuntimeExecutions({ messageId: message.id, limit: 1000 })
    .filter((execution) => isCancellableRuntimeExecutionStatus(execution.status));
  const cancelledExecutions: RuntimeExecutionRecord[] = [];

  for (const execution of executions) {
    // 取消执行必须先写 server 真源，再清 agent inbox；daemon ack/late event 只能作为迟到信号处理。
    const updated = store.updateRuntimeExecutionStatus(execution.id, "cancelled");
    store.ackAgentInbox(execution.agentId, [message.id]);
    const event = store.appendRuntimeExecutionEvent({
      executionId: execution.id,
      agentId: execution.agentId,
      taskId: updated?.taskId ?? execution.taskId,
      kind: "diagnostic",
      title: "Execution cancelled",
      detail
    });
    cancelledExecutions.push(updated ?? { ...execution, status: "cancelled", updatedAt: event.at, completedAt: event.at });
  }

  return { cancelledExecutions };
}
