import type { TyrDb } from "@tyr-ai/db";

type LifecycleStore = Pick<TyrDb, "db">;

export function workspaceBridgeResponseKind(store: LifecycleStore, input: {
  requestId: string;
  replyStatus?: string;
  outcomeStatus?: string;
  hasExecution: boolean;
  hasReply: boolean;
  error?: boolean;
}): "ack" | "question" | "final" | "error" {
  if (input.outcomeStatus === "partial" || (input.replyStatus === "partial" && input.outcomeStatus !== "running")) return "question";
  if (input.hasExecution || input.outcomeStatus === "running" || workspaceBridgeHasUnfinishedWork(store, input.requestId)) return "ack";
  return !input.hasReply || input.error || input.replyStatus === "failed" || input.outcomeStatus === "failed" ? "error" : "final";
}

/** Persisted work, not model wording or process exit, determines whether a hop can close. */
export function workspaceBridgeHasUnfinishedWork(store: LifecycleStore, requestId: string): boolean {
  if (store.db.prepare(`select 1 from cross_workspace_messages child
    where child.parent_bridge_request_id = ? and child.response_kind is null
      and child.resolved_by_terminal_id is null
      and not exists (select 1 from cross_workspace_messages terminal where terminal.terminal_request_id = child.id)
    limit 1`).get(requestId)) return true;
  if (store.db.prepare(`select 1 from runtime_executions
    where server_id = (select target_workspace_id from cross_workspace_messages where id = ?)
      and status not in ('completed', 'failed', 'stalled', 'cancelled')
      and case when json_valid(communication_return_external_ref) then
        json_extract(communication_return_external_ref, '$.kind') = 'workspace_bridge'
        and json_extract(communication_return_external_ref, '$.requestMessageId') = ? else 0 end
    limit 1`).get(requestId, requestId)) return true;
  // A continuation of a child may already have dispatched a write without a receipt.
  // Do not close the parent or automatically replay that uncertain operation.
  return Boolean(store.db.prepare(`select 1 from bridge_continuation_steps step
    join bridge_continuation_attempts attempt on attempt.id = step.attempt_id
    join cross_workspace_messages child on child.id = attempt.request_id
    where child.parent_bridge_request_id = ? and step.state in ('running', 'uncertain') limit 1`).get(requestId));
}

/** All server terminal publishers share the same check and atomic terminal claim. */
export function claimWorkspaceBridgeTerminal(
  store: LifecycleStore & Pick<TyrDb, "createCrossWorkspaceTerminalMessage">,
  input: Parameters<TyrDb["createCrossWorkspaceTerminalMessage"]>[0]
): ReturnType<TyrDb["createCrossWorkspaceTerminalMessage"]> | null {
  return store.db.transaction(() => {
    if (workspaceBridgeHasUnfinishedWork(store, input.replyToMessageId)) return null;
    return store.createCrossWorkspaceTerminalMessage(input);
  })();
}
