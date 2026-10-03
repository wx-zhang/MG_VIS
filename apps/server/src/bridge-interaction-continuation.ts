import type { CrossWorkspaceMessageRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";

const interactionQueues = new Map<string, Promise<void>>();
const queuedInteractionIds = new Set<string>();

/** Questions for one original request run in arrival order; independent requests can continue concurrently. */
export function enqueueBridgeInteractionContinuation(
  store: TyrDb,
  eventMessageId: string,
  run: (eventMessageId: string) => Promise<void>
): void {
  const requestId = store.getCrossWorkspaceMessage(eventMessageId)?.replyToMessageId;
  if (!requestId || queuedInteractionIds.has(eventMessageId)) return;
  queuedInteractionIds.add(eventMessageId);
  const previous = interactionQueues.get(requestId) ?? Promise.resolve();
  const next = previous.catch(() => undefined)
    .then(() => run(eventMessageId))
    .catch((error) => console.warn(`[server] Bridge interaction queue interrupted event=${eventMessageId}: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      queuedInteractionIds.delete(eventMessageId);
      if (interactionQueues.get(requestId) === next) interactionQueues.delete(requestId);
    });
  interactionQueues.set(requestId, next);
}

/** A nonterminal peer question/action request has its own claim, separate from final/error continuation. */
export function claimBridgeInteractionContinuation(store: TyrDb, eventMessageId: string): {
  event: CrossWorkspaceMessageRecord;
  request: CrossWorkspaceMessageRecord;
} | null {
  const changed = store.db.prepare(`update cross_workspace_messages set continuation_state = 'running', updated_at = ?
    where id = ? and continuation_state = 'pending' and response_kind in ('question', 'action_request')
      and local_message_id is not null
      and origin_message_id is not null and exists (
        select 1 from cross_workspace_messages request
        where request.id = cross_workspace_messages.reply_to_message_id
          and request.awaiting_agent_id is not null and request.continuation_state != 'registered'
      ) and not exists (
        select 1 from cross_workspace_messages terminal
        where terminal.terminal_request_id = cross_workspace_messages.reply_to_message_id
      )`).run(new Date().toISOString(), eventMessageId).changes;
  if (!changed) return null;
  const event = store.getCrossWorkspaceMessage(eventMessageId);
  const request = event?.replyToMessageId ? store.getCrossWorkspaceMessage(event.replyToMessageId) : null;
  return event && request ? { event, request } : null;
}

export function finishBridgeInteractionContinuation(store: TyrDb, eventMessageId: string, replyMessageId: string | null, interrupted = false): void {
  store.db.prepare(`update cross_workspace_messages set continuation_state = ?, continuation_reply_message_id = ?, updated_at = ?
    where id = ? and continuation_state = 'running'`)
    .run(interrupted ? "interrupted" : "completed", replyMessageId, new Date().toISOString(), eventMessageId);
}

export function recoverBridgeInteractionContinuations(store: TyrDb): string[] {
  // A model may have issued an external instruction before a crash; running work is never replayed blindly.
  store.db.prepare("update cross_workspace_messages set continuation_state = 'interrupted', updated_at = ? where continuation_state = 'running' and response_kind in ('question', 'action_request')")
    .run(new Date().toISOString());
  // Older releases published raw worker IPC. Preserve it for audit, but never
  // resume those peer-visible events as if TYR had reviewed them.
  store.db.prepare(`update cross_workspace_messages set continuation_state = 'completed', updated_at = ?
    where continuation_state = 'pending' and response_kind in ('question', 'action_request')
      and interaction_event_id is not null and local_message_id is null`)
    .run(new Date().toISOString());
  store.db.prepare(`update cross_workspace_messages set continuation_state = 'completed', updated_at = ?
    where continuation_state = 'pending' and response_kind in ('question', 'action_request') and exists (
      select 1 from cross_workspace_messages terminal where terminal.terminal_request_id = cross_workspace_messages.reply_to_message_id
    )`).run(new Date().toISOString());
  return (store.db.prepare(`select id from cross_workspace_messages
    where continuation_state = 'pending' and response_kind in ('question', 'action_request')
      and origin_message_id is not null and local_message_id is not null order by created_at, id`).all() as Array<{ id: string }>).map((row) => row.id);
}

export function pendingBridgeInteractionEventsForRequest(store: TyrDb, requestId: string): string[] {
  return (store.db.prepare(`select id from cross_workspace_messages
    where reply_to_message_id = ? and continuation_state = 'pending'
      and response_kind in ('question', 'action_request') and origin_message_id is not null
      and local_message_id is not null
    order by created_at, id`).all(requestId) as Array<{ id: string }>).map((row) => row.id);
}
