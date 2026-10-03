import type { RuntimeExecutionEventRecord, RuntimeExecutionRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";

export type StaleRuntimeExecutionStore = Pick<
  TyrDb,
  "listRuntimeExecutions" | "appendRuntimeExecutionEvent" | "updateRuntimeExecutionStatus" | "getRuntimeExecution"
>;

export type ReconcileStaleRuntimeExecutionsOptions = {
  timeoutMs: number;
  now?: Date;
  serverId?: string;
  onFailed?: (execution: RuntimeExecutionRecord, event: RuntimeExecutionEventRecord) => void;
};

export type ReconcileStaleRuntimeExecutionsResult = {
  failed: RuntimeExecutionRecord[];
  events: RuntimeExecutionEventRecord[];
};

function staleCutoffIso(now: Date, timeoutMs: number): string {
  return new Date(now.getTime() - timeoutMs).toISOString();
}

function isStaleRunningExecution(execution: RuntimeExecutionRecord, nowMs: number, timeoutMs: number): boolean {
  if (execution.status !== "running") return false;
  const updatedAtMs = Date.parse(execution.updatedAt || execution.createdAt);
  return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs > timeoutMs;
}

export function reconcileStaleRuntimeExecutions(
  store: StaleRuntimeExecutionStore,
  options: ReconcileStaleRuntimeExecutionsOptions
): ReconcileStaleRuntimeExecutionsResult {
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs));
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const failed: RuntimeExecutionRecord[] = [];
  const events: RuntimeExecutionEventRecord[] = [];
  for (const execution of store.listRuntimeExecutions({ serverId: options.serverId, limit: 1000 })) {
    if (!isStaleRunningExecution(execution, nowMs, timeoutMs)) continue;
    const event = store.appendRuntimeExecutionEvent({
      executionId: execution.id,
      agentId: execution.agentId,
      taskId: execution.taskId,
      kind: "error",
      title: "Stale runtime execution",
      detail: `Runtime execution exceeded turn timeout after ${Math.round(timeoutMs / 1000)}s without a terminal event.`,
      payload: {
        stale: true,
        timeoutMs,
        cutoffAt: staleCutoffIso(now, timeoutMs),
        previousStatus: execution.status
      },
      at: now.toISOString()
    });
    const updated = store.updateRuntimeExecutionStatus(execution.id, "failed") ?? store.getRuntimeExecution(execution.id);
    if (!updated) continue;
    failed.push(updated);
    events.push(event);
    options.onFailed?.(updated, event);
  }
  return { failed, events };
}
