import { randomUUID } from "node:crypto";
import type {
  CommunicationEvidenceFact,
  CommunicationEvidenceRecord,
  CommunicationEvidenceSelection
} from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import { sanitizeHumanVisibleText, sanitizeHumanVisibleValue } from "./output-disclosure";

export interface CommunicationEvidenceContext {
  serverId: string;
  sourceMessageId: string;
  channelId: string;
  conversationId: string | null;
}

export interface AvailableCommunicationEvidence extends CommunicationEvidenceRecord {
  /** Exact excerpts are permitted only from an already TYR-published peer reply. */
  sourceContent?: string;
}

export class CommunicationEvidenceError extends Error {
  constructor(readonly code: string) { super(code); }
}

const initialized = new WeakSet<object>();
const MAX_FACTS = 32;
const MAX_VALUE_LENGTH = 2_000;
const MAX_FACT_BYTES = 12_000;
const MAX_SELECTIONS = 16;
const MAX_EXCERPT_LENGTH = 2_000;

/** The server, rather than model-provided provenance, owns all private source references. */
export function ensureCommunicationEvidenceSchema(store: Pick<TyrDb, "db">): void {
  if (initialized.has(store.db)) return;
  // packages/db owns schema creation/migration; this guard also catches incomplete test adapters.
  const tables = store.db.prepare("select name from sqlite_master where type = 'table' and name in ('communication_evidence_sources', 'communication_evidence_publications', 'communication_evidence_receipts')")
    .all() as Array<{ name: string }>;
  const columns = store.db.prepare("pragma table_info(communication_return_events)").all() as Array<{ name: string }>;
  if (tables.length !== 3 || !columns.some((column) => column.name === "facts_json")) {
    throw new CommunicationEvidenceError("communication_evidence_schema_unavailable");
  }
  initialized.add(store.db);
}

export function validateCommunicationEvidenceFacts(value: unknown): CommunicationEvidenceFact[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_FACTS) return null;
  const keys = new Set<string>();
  const facts: CommunicationEvidenceFact[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const fact = entry as Record<string, unknown>;
    if (Object.keys(fact).some((key) => key !== "key" && key !== "value") ||
        typeof fact.key !== "string" || !/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(fact.key) ||
        ["__proto__", "prototype", "constructor"].includes(fact.key) || keys.has(fact.key)) return null;
    const scalar = fact.value;
    if (scalar !== null && typeof scalar !== "string" && typeof scalar !== "number" && typeof scalar !== "boolean") return null;
    if (typeof scalar === "string" && scalar.length > MAX_VALUE_LENGTH || typeof scalar === "number" && !Number.isFinite(scalar)) return null;
    // Reject credentials instead of rewriting them: a rewritten value is not original evidence.
    if (/^(?:device|agent|connector)[_.:-]?token$/i.test(fact.key) ||
        sanitizeHumanVisibleValue({ [fact.key]: scalar })[fact.key] !== scalar) return null;
    keys.add(fact.key);
    facts.push({ key: fact.key, value: scalar });
  }
  return Buffer.byteLength(JSON.stringify(facts), "utf8") <= MAX_FACT_BYTES ? facts : null;
}

export function validateCommunicationEvidenceSelections(value: unknown): CommunicationEvidenceSelection[] | null {
  if (!Array.isArray(value) || value.length > MAX_SELECTIONS) return null;
  const selections: CommunicationEvidenceSelection[] = [];
  const receipts = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const candidate = entry as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => !["receiptId", "keys", "excerpt"].includes(key)) ||
        typeof candidate.receiptId !== "string" || !/^evidence_[0-9a-f]{32}$/.test(candidate.receiptId) ||
        receipts.has(candidate.receiptId)) return null;
    const keys = candidate.keys;
    const excerpt = candidate.excerpt;
    if (keys !== undefined && (!Array.isArray(keys) || keys.length > MAX_FACTS ||
        keys.some((key) => typeof key !== "string" || !/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(key)) ||
        new Set(keys).size !== keys.length)) return null;
    if (excerpt !== undefined && (typeof excerpt !== "string" || !excerpt.trim() || excerpt.length > MAX_EXCERPT_LENGTH)) return null;
    if (!(Array.isArray(keys) && keys.length) && excerpt === undefined) return null;
    receipts.add(candidate.receiptId);
    selections.push({ receiptId: candidate.receiptId, ...(keys !== undefined ? { keys: keys as string[] } : {}),
      ...(excerpt !== undefined ? { excerpt: excerpt as string } : {}) });
  }
  return selections;
}

function receiptId(): string { return `evidence_${randomUUID().replaceAll("-", "")}`; }
function exactContext(store: TyrDb, scope: CommunicationEvidenceContext): boolean {
  const message = store.getMessage(scope.sourceMessageId);
  return Boolean(message && message.channelId === scope.channelId &&
    (message.conversationId ?? null) === scope.conversationId &&
    store.db.prepare("select id from channels where id = ? and server_id = ?").get(scope.channelId, scope.serverId));
}
function requireContext(store: TyrDb, scope: CommunicationEvidenceContext): void {
  if (!exactContext(store, scope)) throw new CommunicationEvidenceError("communication_evidence_context_invalid");
}

function isRequestReturnContext(store: TyrDb, requestId: string, scope: CommunicationEvidenceContext): boolean {
  const followup = store.db.prepare(`select id from cross_workspace_messages
    where reply_to_message_id = ? and target_workspace_id = ? and peer_message_id = ?
      and response_kind in ('answer', 'instruction', 'continue')`).get(requestId, scope.serverId, scope.sourceMessageId);
  if (followup) return true;
  const executions = store.db.prepare(`select communication_return_external_ref from runtime_executions
    where server_id = ? and communication_return_source_message_id = ? and communication_return_channel_id = ?
      and communication_return_conversation_id is ?`).all(scope.serverId, scope.sourceMessageId, scope.channelId, scope.conversationId) as
    Array<{ communication_return_external_ref: string | null }>;
  return executions.some((execution) => {
    try {
      const ref = JSON.parse(execution.communication_return_external_ref ?? "null");
      return ref?.kind === "workspace_bridge" && ref.requestMessageId === requestId && ref.targetWorkspaceId === scope.serverId;
    } catch { return false; }
  });
}

/** Called only after a server-authenticated IPC row was recorded; values cannot be replaced later. */
export function recordCommunicationReturnEvidence(store: TyrDb, eventId: string): void {
  ensureCommunicationEvidenceSchema(store);
  const event = store.db.prepare("select * from communication_return_events where id = ?").get(eventId) as Record<string, unknown> | undefined;
  if (!event) return;
  let rawFacts: unknown;
  try { rawFacts = event.facts_json ? JSON.parse(String(event.facts_json)) : []; } catch { return; }
  const facts = validateCommunicationEvidenceFacts(rawFacts);
  if (!facts?.length) return;
  const execution = store.getRuntimeExecution(String(event.source_execution_id));
  const source = store.getMessage(String(event.source_message_id));
  const worker = execution ? store.getAgent(execution.agentId) : null;
  if (!execution || !execution.serverId || !worker || !source || worker.serverId !== execution.serverId ||
      execution.communicationReturnSourceMessageId !== source.id ||
      execution.communicationReturnChannelId !== source.channelId ||
      (execution.communicationReturnConversationId ?? null) !== (source.conversationId ?? null) ||
      !execution.communicationReturnUserId || !execution.communicationReturnSource) return;
  const scope = { serverId: execution.serverId, sourceMessageId: source.id, channelId: source.channelId,
    conversationId: source.conversationId ?? null };
  if (!exactContext(store, scope)) return;
  store.db.prepare(`insert or ignore into communication_evidence_sources
    (receipt_id, source_key, server_id, source_message_id, channel_id, conversation_id, source_kind,
     facts_json, source_event_id, source_execution_id, created_at)
    values (?, ?, ?, ?, ?, ?, 'local_worker', ?, ?, ?, ?)`).run(
    receiptId(), `event:${eventId}`, scope.serverId, scope.sourceMessageId, scope.channelId,
    scope.conversationId, JSON.stringify(facts), eventId, execution.id, new Date().toISOString());
}

function publicReceipt(row: Record<string, unknown>): CommunicationEvidenceRecord {
  return { receiptId: String(row.receipt_id), facts: JSON.parse(String(row.facts_json)),
    ...(typeof row.excerpt === "string" ? { excerpt: row.excerpt } : {}),
    provenance: { kind: row.provenance_kind as CommunicationEvidenceRecord["provenance"]["kind"] } };
}

/** This is presentation data for an already authorized Bridge message, never a receipt lookup capability. */
export function getCommunicationEvidenceForBridgeMessage(store: Pick<TyrDb, "db">, messageId: string): CommunicationEvidenceRecord[] {
  ensureCommunicationEvidenceSchema(store);
  return (store.db.prepare("select * from communication_evidence_receipts where bridge_message_id = ? order by position")
    .all(messageId) as Array<Record<string, unknown>>).map(publicReceipt);
}

export function listCommunicationEvidenceForContext(store: TyrDb, scope: CommunicationEvidenceContext): AvailableCommunicationEvidence[] {
  ensureCommunicationEvidenceSchema(store);
  requireContext(store, scope);
  // Rehydrate only authenticated events for this exact request, including after a server restart.
  const events = store.db.prepare(`select e.id from communication_return_events e
    join runtime_executions r on r.id = e.source_execution_id
    where e.source_message_id = ? and r.server_id = ? and r.communication_return_channel_id = ?
      and r.communication_return_conversation_id is ? order by e.created_at, e.id`)
    .all(scope.sourceMessageId, scope.serverId, scope.channelId, scope.conversationId) as Array<{ id: string }>;
  for (const event of events) recordCommunicationReturnEvidence(store, event.id);
  const available = (store.db.prepare(`select * from communication_evidence_sources
    where server_id = ? and source_message_id = ? and channel_id = ? and conversation_id is ? order by created_at, receipt_id`)
    .all(scope.serverId, scope.sourceMessageId, scope.channelId, scope.conversationId) as Array<Record<string, unknown>>)
    .map((row): AvailableCommunicationEvidence => ({ receiptId: String(row.receipt_id),
      facts: JSON.parse(String(row.facts_json)),
      provenance: { kind: row.source_kind as CommunicationEvidenceRecord["provenance"]["kind"] },
      ...(row.source_kind === "peer_tyr" && typeof row.source_content === "string" ? { sourceContent: row.source_content } : {}) }));
  const inbound = store.db.prepare(`select id from cross_workspace_messages where target_workspace_id = ?
    and peer_message_id = ? and (response_kind is null or response_kind in ('answer', 'instruction', 'continue'))`)
    .all(scope.serverId, scope.sourceMessageId) as Array<{ id: string }>;
  for (const { id } of inbound) {
    const message = store.getCrossWorkspaceMessage(id);
    if (!message || message.senderCommsAgentId !== store.ensureDefaultCommunicationAgent(message.sourceWorkspaceId).id) continue;
    for (const record of getCommunicationEvidenceForBridgeMessage(store, id)) {
      available.push({ ...record, ...(record.excerpt ? { sourceContent: record.excerpt } : {}) });
    }
  }
  // Incoming child replies are usable only through their immutable origin, not a caller-supplied receipt ID.
  const replies = store.db.prepare(`select t.id from cross_workspace_messages t
    join cross_workspace_messages r on r.id = t.reply_to_message_id
    where r.source_workspace_id = ? and r.origin_message_id = ? and r.origin_channel_id = ?
      and r.origin_conversation_id is ? and t.source_workspace_id = r.target_workspace_id
      and t.target_workspace_id = r.source_workspace_id and t.response_kind in ('final', 'error', 'question', 'action_request')
    order by t.created_at, t.id`).all(scope.serverId, scope.sourceMessageId, scope.channelId, scope.conversationId) as Array<{ id: string }>;
  for (const { id } of replies) {
    const message = store.getCrossWorkspaceMessage(id);
    if (!message || message.senderCommsAgentId !== store.ensureDefaultCommunicationAgent(message.sourceWorkspaceId).id) continue;
    for (const record of getCommunicationEvidenceForBridgeMessage(store, id)) {
      available.push({ ...record, ...(record.excerpt ? { sourceContent: record.excerpt } : {}) });
    }
    // Legacy text can be quoted exactly, but does not become invented structured facts.
    const sourceKey = `peer:${id}`;
    store.db.prepare(`insert or ignore into communication_evidence_sources
      (receipt_id, source_key, server_id, source_message_id, channel_id, conversation_id, source_kind,
       facts_json, source_content, source_bridge_message_id, created_at)
      values (?, ?, ?, ?, ?, ?, 'peer_tyr', '[]', ?, ?, ?)`).run(
      receiptId(), sourceKey, scope.serverId, scope.sourceMessageId, scope.channelId, scope.conversationId,
      message.content, id, message.createdAt);
    const row = store.db.prepare("select * from communication_evidence_sources where source_key = ?").get(sourceKey) as Record<string, unknown>;
    if (!available.some((entry) => entry.receiptId === row.receipt_id)) available.push({
      receiptId: String(row.receipt_id), facts: [], sourceContent: message.content, provenance: { kind: "peer_tyr" }
    });
  }
  return available;
}

export function selectCommunicationEvidenceForContext(store: TyrDb, scope: CommunicationEvidenceContext,
  selections: CommunicationEvidenceSelection[]): CommunicationEvidenceRecord[] {
  const checked = validateCommunicationEvidenceSelections(selections);
  if (!checked) throw new CommunicationEvidenceError("communication_evidence_selection_invalid");
  const available = new Map(listCommunicationEvidenceForContext(store, scope).map((record) => [record.receiptId, record]));
  return checked.map((selection) => {
    const source = available.get(selection.receiptId);
    if (!source) throw new CommunicationEvidenceError("communication_evidence_receipt_not_available");
    const facts = (selection.keys ?? []).map((key) => {
      const fact = source.facts.find((candidate) => candidate.key === key);
      if (!fact) throw new CommunicationEvidenceError("communication_evidence_fact_not_available");
      return { ...fact };
    });
    if (selection.excerpt && (!source.sourceContent || !source.sourceContent.includes(selection.excerpt))) {
      throw new CommunicationEvidenceError("communication_evidence_excerpt_not_available");
    }
    if (selection.excerpt && sanitizeHumanVisibleText(selection.excerpt) !== selection.excerpt) {
      throw new CommunicationEvidenceError("communication_evidence_excerpt_not_available");
    }
    return { receiptId: source.receiptId, facts, ...(selection.excerpt ? { excerpt: selection.excerpt } : {}),
      provenance: { ...source.provenance } };
  });
}

/** Publication is explicit, immutable, and creates fresh receipts without exposing the source reference. */
export function publishCommunicationEvidenceForBridgeMessage(store: TyrDb, input: {
  messageId: string;
  scope: CommunicationEvidenceContext;
  selections: CommunicationEvidenceSelection[];
} | {
  messageId: string;
  contextSelections: Array<{ scope: CommunicationEvidenceContext; selections: CommunicationEvidenceSelection[] }>;
}): CommunicationEvidenceRecord[] {
  ensureCommunicationEvidenceSchema(store);
  const contexts = "contextSelections" in input ? input.contextSelections : [{ scope: input.scope, selections: input.selections }];
  if (!contexts.length || contexts.length > MAX_SELECTIONS) throw new CommunicationEvidenceError("communication_evidence_selection_invalid");
  const message = store.getCrossWorkspaceMessage(input.messageId);
  const request = message?.replyToMessageId ? store.getCrossWorkspaceMessage(message.replyToMessageId) : null;
  const localReply = message?.localMessageId ? store.getMessage(message.localMessageId) : null;
  const selected: CommunicationEvidenceRecord[] = [];
  const selectionReceipts = new Set<string>();
  for (const { scope, selections } of contexts) {
    const records = selectCommunicationEvidenceForContext(store, scope, selections);
    const publisher = store.ensureDefaultCommunicationAgent(scope.serverId);
    const exactOrigin = (candidate: NonNullable<typeof message>) => candidate.sourceWorkspaceId === scope.serverId &&
      candidate.originMessageId === scope.sourceMessageId && candidate.originChannelId === scope.channelId &&
      candidate.originConversationId === scope.conversationId;
    const outwardRequest = Boolean(message && !message.replyToMessageId && !message.responseKind && exactOrigin(message));
    const outwardFollowup = Boolean(message && request && ["answer", "instruction", "continue"].includes(message.responseKind ?? "") &&
      message.sourceWorkspaceId === request.sourceWorkspaceId && message.targetWorkspaceId === request.targetWorkspaceId && exactOrigin(request));
    const aggregateReview = "contextSelections" in input && message && request &&
      (store.db.prepare(`select communication_return_message_id from runtime_executions
        where server_id = ? and communication_return_source_message_id = ? and communication_return_channel_id = ?
          and communication_return_conversation_id is ?`).all(scope.serverId, scope.sourceMessageId, scope.channelId, scope.conversationId) as
        Array<{ communication_return_message_id: string | null }>).some((execution) => {
          const review = execution.communication_return_message_id ? store.getMessage(execution.communication_return_message_id) : null;
          return Boolean(review && review.senderType === "agent" && review.senderId === publisher.id &&
            review.channelId === scope.channelId && (review.conversationId ?? null) === scope.conversationId &&
            message.content.includes(review.content));
        });
    const reviewedReturn = Boolean(message && request && message.sourceWorkspaceId === scope.serverId &&
      request.targetWorkspaceId === scope.serverId && message.targetWorkspaceId === request.sourceWorkspaceId &&
      (request.peerMessageId === scope.sourceMessageId || isRequestReturnContext(store, request.id, scope)) &&
      ["final", "error", "progress", "question", "action_request"].includes(message.responseKind ?? "") &&
      (aggregateReview || localReply?.senderType === "agent" && localReply.senderId === publisher.id && localReply.content === message.content &&
      localReply.channelId === scope.channelId && (localReply.conversationId ?? null) === scope.conversationId));
    if (!message || message.sourceWorkspaceId !== scope.serverId || message.senderCommsAgentId !== publisher.id ||
        !(outwardRequest || outwardFollowup || reviewedReturn)) {
      throw new CommunicationEvidenceError("communication_evidence_publication_context_invalid");
    }
    for (const record of records) {
      if (selectionReceipts.has(record.receiptId)) throw new CommunicationEvidenceError("communication_evidence_selection_invalid");
      selectionReceipts.add(record.receiptId);
      selected.push(record);
    }
  }
  if (!message || selected.length > MAX_SELECTIONS) throw new CommunicationEvidenceError("communication_evidence_selection_invalid");
  const canonicalContexts = contexts.map(({ scope, selections }) => ({ scope,
    selections: selections.map((selection) => ({ receiptId: selection.receiptId,
      keys: [...(selection.keys ?? [])].sort(), excerpt: selection.excerpt ?? null })) }));
  const selectionJson = JSON.stringify(canonicalContexts);
  return store.db.transaction(() => {
    const existing = store.db.prepare("select selections_json from communication_evidence_publications where bridge_message_id = ?")
      .get(message.id) as { selections_json: string } | undefined;
    if (existing) {
      if (existing.selections_json !== selectionJson) throw new CommunicationEvidenceError("communication_evidence_publication_conflict");
      return getCommunicationEvidenceForBridgeMessage(store, message.id);
    }
    store.db.prepare("insert into communication_evidence_publications (bridge_message_id, selections_json, created_at) values (?, ?, ?)")
      .run(message.id, selectionJson, new Date().toISOString());
    selected.forEach((record, position) => {
      const inherited = store.db.prepare("select receipt_id from communication_evidence_receipts where receipt_id = ?").get(record.receiptId);
      store.db.prepare(`insert into communication_evidence_receipts
        (receipt_id, bridge_message_id, source_receipt_id, position, facts_json, excerpt, provenance_kind)
        values (?, ?, ?, ?, ?, ?, ?)`).run(receiptId(), message.id, record.receiptId, position,
        JSON.stringify(record.facts), record.excerpt ?? null, inherited ? "reviewed_downstream" : "peer_tyr");
    });
    return getCommunicationEvidenceForBridgeMessage(store, message.id);
  })();
}
