import type { TyrDb } from "@tyr-ai/db";
import type { CommunicationEvidenceFact } from "@tyr-ai/contracts";
import { ensureCommunicationEvidenceSchema, recordCommunicationReturnEvidence, validateCommunicationEvidenceFacts } from "./communication-evidence";

export type CommunicationReturnEventKind = "progress" | "question" | "action_request" | "result";

export interface CommunicationReturnEvent {
  id: string;
  sourceExecutionId: string;
  sourceMessageId: string;
  kind: CommunicationReturnEventKind;
  content: string;
  proposedBridgeId: string | null;
  originRequestId: string | null;
  peerMessage: string | null;
  facts: CommunicationEvidenceFact[];
  state: "pending" | "running" | "completed" | "interrupted";
  replyMessageId: string | null;
}

function fromRow(row: Record<string, unknown>): CommunicationReturnEvent {
  return {
    id: String(row.id),
    sourceExecutionId: String(row.source_execution_id),
    sourceMessageId: String(row.source_message_id),
    kind: row.kind as CommunicationReturnEventKind,
    content: String(row.content),
    proposedBridgeId: row.proposed_bridge_id ? String(row.proposed_bridge_id) : null,
    originRequestId: row.origin_request_id ? String(row.origin_request_id) : null,
    peerMessage: row.peer_message ? String(row.peer_message) : null,
    facts: validateCommunicationEvidenceFacts(row.facts_json ? JSON.parse(String(row.facts_json)) : []) ?? [],
    state: row.state as CommunicationReturnEvent["state"],
    replyMessageId: row.reply_message_id ? String(row.reply_message_id) : null
  };
}

export function getCommunicationReturnEvent(store: TyrDb, id: string): CommunicationReturnEvent | null {
  ensureCommunicationEvidenceSchema(store);
  const row = store.db.prepare("select * from communication_return_events where id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? fromRow(row) : null;
}

export function recordCommunicationReturnEvent(store: TyrDb, input:
  Omit<CommunicationReturnEvent, "state" | "replyMessageId" | "originRequestId" | "peerMessage" | "facts"> &
  Partial<Pick<CommunicationReturnEvent, "originRequestId" | "peerMessage" | "facts">>
): CommunicationReturnEvent | null {
  ensureCommunicationEvidenceSchema(store);
  const facts = validateCommunicationEvidenceFacts(input.facts);
  if (!facts) return null;
  const at = new Date().toISOString();
  store.db.prepare(`insert or ignore into communication_return_events
    (id, source_execution_id, source_message_id, kind, content, proposed_bridge_id,
     origin_request_id, peer_message, facts_json, state, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).run(
    input.id, input.sourceExecutionId, input.sourceMessageId, input.kind, input.content,
    input.proposedBridgeId, input.originRequestId ?? null, input.peerMessage ?? null, JSON.stringify(facts), at, at
  );
  const event = getCommunicationReturnEvent(store, input.id);
  // A client ID cannot be reused to overwrite another execution's return event.
  return event?.sourceExecutionId === input.sourceExecutionId && event.sourceMessageId === input.sourceMessageId &&
    event.kind === input.kind && event.content === input.content && event.proposedBridgeId === input.proposedBridgeId &&
    event.originRequestId === (input.originRequestId ?? null) && event.peerMessage === (input.peerMessage ?? null) &&
    JSON.stringify(event.facts) === JSON.stringify(facts)
    ? (recordCommunicationReturnEvidence(store, event.id), event) : null;
}

export function claimCommunicationReturnEvent(store: TyrDb, id: string): CommunicationReturnEvent | null {
  const changed = store.db.prepare("update communication_return_events set state = 'running', updated_at = ? where id = ? and state = 'pending'")
    .run(new Date().toISOString(), id).changes;
  return changed ? getCommunicationReturnEvent(store, id) : null;
}

export function completeCommunicationReturnEvent(store: TyrDb, id: string, replyMessageId: string | null): void {
  store.db.prepare("update communication_return_events set state = 'completed', reply_message_id = ?, updated_at = ? where id = ? and state = 'running'")
    .run(replyMessageId, new Date().toISOString(), id);
}

export function interruptCommunicationReturnEvent(store: TyrDb, id: string): void {
  store.db.prepare("update communication_return_events set state = 'interrupted', updated_at = ? where id = ? and state = 'running'")
    .run(new Date().toISOString(), id);
}

export function interruptRunningCommunicationReturnEvents(store: TyrDb): void {
  store.db.prepare("update communication_return_events set state = 'interrupted', updated_at = ? where state = 'running'")
    .run(new Date().toISOString());
}

export function listPendingCommunicationReturnEventIds(store: TyrDb): string[] {
  return (store.db.prepare("select id from communication_return_events where state = 'pending' order by created_at, id").all() as Array<{ id: string }>).map((row) => row.id);
}
