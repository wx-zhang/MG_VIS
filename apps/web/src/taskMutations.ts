import type { TaskRecord } from "@tyr-ai/contracts";

export type TaskMutation = {
  path: string;
  init: RequestInit;
};

export function taskStatusMutation(taskId: string, status: TaskRecord["status"]): TaskMutation {
  return {
    path: `/api/tasks/${encodeURIComponent(taskId)}/status`,
    init: { method: "POST", body: JSON.stringify({ status }) }
  };
}

export function taskDeleteMutation(taskId: string): TaskMutation {
  return {
    path: `/api/tasks/${encodeURIComponent(taskId)}`,
    init: { method: "DELETE" }
  };
}

export function taskMutationFailureMessage(action: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error || "unknown_error");
  return `${action} failed: ${detail}`;
}
