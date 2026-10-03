import { createHash } from "node:crypto";
import type { TyrDb } from "@tyr-ai/db";
import { trustedLocalRouteSource } from "./communication-route-intent";

const digest = (content: string) => createHash("sha256").update(content).digest("hex");
interface Authority {
  event_id: string;
  root_event_id: string;
  root_request_id: string;
  source_message_id: string | null;
  question_event_id: string;
  content_hash: string;
}

/** Called only inside the authenticated follow-up acceptance transaction, never from model output. */
export function recordBridgeRouteClarification(store: TyrDb, eventId: string, sourceMessageId?: string): void {
  const event = store.getCrossWorkspaceMessage(eventId);
  const request = event?.replyToMessageId ? store.getCrossWorkspaceMessage(event.replyToMessageId) : null;
  if (!event || !request || !["answer", "instruction"].includes(event.responseKind ?? "")) return;
  const question = store.db.prepare(`select id from cross_workspace_messages where reply_to_message_id = ?
    and response_kind = 'question' and outcome = 'delivered' order by rowid desc limit 1`).get(request.id) as { id: string } | undefined;
  if (!question) return;
  let rootEventId = event.id;
  let rootRequestId = request.id;
  let sourceId: string | null = null;
  let content = event.content;
  if (request.parentBridgeRequestId) {
    // A relayed supplement inherits only an already authenticated root answer. Its rewritten
    // body is never the authority for a new destination.
    if (!sourceMessageId) return;
    const parent = store.getCrossWorkspaceMessage(request.parentBridgeRequestId);
    const prior = store.db.prepare(`select a.* from bridge_route_clarifications a
      join cross_workspace_messages e on e.id = a.event_id
      where e.peer_message_id = ? and e.reply_to_message_id = ?`).get(sourceMessageId, parent?.id ?? "") as Authority | undefined;
    if (!parent || !prior || request.sourceWorkspaceId !== parent.targetWorkspaceId ||
        request.traceId !== parent.traceId || request.sourceCapabilityUserId !== parent.targetCapabilityUserId) return;
    rootEventId = prior.root_event_id;
    rootRequestId = prior.root_request_id;
    const authority = readAuthority(store, prior);
    if (!authority) return;
    content = authority.content;
  } else {
    const userId = request.originalSenderUserId ?? request.senderUserId;
    if (!userId || request.sourceCapabilityUserId !== userId) return;
    if (request.originMessageId || request.awaitingAgentId) {
      const message = sourceMessageId ? store.getMessage(sourceMessageId) : null;
      const original = request.originMessageId ? store.getMessage(request.originMessageId) : null;
      const publishedQuestion = store.getCrossWorkspaceMessage(question.id)!;
      if (!message || !original || message.deletedAt || message.senderType !== "human" ||
          message.channelId !== request.originChannelId || message.conversationId !== request.originConversationId ||
          message.seq <= original.seq || message.createdAt < publishedQuestion.createdAt ||
          !trustedLocalRouteSource(store, { message, serverId: request.sourceWorkspaceId, requestingUserId: userId })) return;
      sourceId = message.id;
      content = message.content;
    } else if (sourceMessageId || request.originChannelId || request.originConversationId ||
        !["web", "mcp"].includes(request.originSource ?? "")) return;
  }
  store.db.prepare(`insert or ignore into bridge_route_clarifications
    (event_id, root_event_id, root_request_id, source_message_id, question_event_id, content_hash)
    values (?, ?, ?, ?, ?, ?)`).run(event.id, rootEventId, rootRequestId, sourceId, question.id, digest(content));
}

function readAuthority(store: TyrDb, row: Authority): { messageId: string; content: string } | null {
  const root = store.db.prepare("select * from bridge_route_clarifications where event_id = ?")
    .get(row.root_event_id) as Authority | undefined;
  const event = root ? store.getCrossWorkspaceMessage(root.event_id) : null;
  const request = event?.replyToMessageId ? store.getCrossWorkspaceMessage(event.replyToMessageId) : null;
  if (!root || root.root_event_id !== root.event_id || !event || !request || request.parentBridgeRequestId ||
      root.root_request_id !== request.id || row.root_request_id !== request.id ||
      request.sourceCapabilityUserId !== (request.originalSenderUserId ?? request.senderUserId)) return null;
  const source = root.source_message_id ? store.getMessage(root.source_message_id) : null;
  if (root.source_message_id && (!source || source.deletedAt || source.senderType !== "human" ||
      !trustedLocalRouteSource(store, { message: source, serverId: request.sourceWorkspaceId,
        requestingUserId: request.sourceCapabilityUserId! }))) return null;
  const content = source?.content ?? event.content;
  if (digest(content) !== root.content_hash || root.content_hash !== row.content_hash) return null;
  return { messageId: root.event_id, content };
}

export function bridgeRouteClarifications(store: TyrDb, requestId: string) {
  const rows = store.db.prepare(`select a.*, e.peer_message_id from bridge_route_clarifications a
    join cross_workspace_messages e on e.id = a.event_id where e.reply_to_message_id = ?
    order by e.rowid`).all(requestId) as Array<Authority & { peer_message_id: string | null }>;
  return rows.map(row => ({ row, authority: readAuthority(store, row) })).filter(item => item.authority !== null);
}
