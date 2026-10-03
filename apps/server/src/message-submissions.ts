import { createHash } from "node:crypto";
import { isCommunicationAgent, type MessageRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import type { ServerRouteContext } from "./server-context";
import { maybeReplyToCommunicationAgentDm } from "./communication-agent";

export interface MessageSubmission {
  user_id: string;
  client_request_id: string;
  payload_hash: string;
  message_id: string;
  channel_id: string;
  conversation_id: string | null;
  assistant_agent_id: string | null;
  state: "queued" | "running" | "dispatched" | "interrupted";
  notice_message_id: string | null;
  created_at: string;
}

export function messageSubmissionHash(payload: unknown): string {
  // The route supplies an ordered, normalized envelope, independent of mutable permissions/current conversation.
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function getMessageSubmission(store: TyrDb, userId: string, clientRequestId: string): MessageSubmission | null {
  return store.db.prepare("select * from message_submissions where user_id = ? and client_request_id = ?")
    .get(userId, clientRequestId) as MessageSubmission | undefined ?? null;
}

export function recordMessageSubmission(store: TyrDb, input: {
  userId: string; clientRequestId: string; payloadHash: string; message: MessageRecord; assistantAgentId: string | null;
}): MessageSubmission {
  const at = new Date().toISOString();
  store.db.prepare(`insert into message_submissions
    (user_id, client_request_id, payload_hash, message_id, channel_id, conversation_id, assistant_agent_id, state, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.userId, input.clientRequestId, input.payloadHash,
      input.message.id, input.message.channelId, input.message.conversationId ?? null, input.assistantAgentId,
      input.assistantAgentId ? "queued" : "dispatched", at, at);
  return getMessageSubmission(store, input.userId, input.clientRequestId)!;
}

const dispatchers = new WeakMap<ServerRouteContext, MessageSubmissionDispatcher>();
export function messageSubmissionDispatcher(ctx: ServerRouteContext): MessageSubmissionDispatcher {
  let dispatcher = dispatchers.get(ctx);
  if (!dispatcher) {
    dispatcher = new MessageSubmissionDispatcher(ctx);
    dispatchers.set(ctx, dispatcher);
  }
  return dispatcher;
}

/** HTTP acceptance is durable before any model/tool work. This is not a business-completion status. */
class MessageSubmissionDispatcher {
  private scheduled = false;
  private active = 0;
  constructor(private readonly ctx: ServerRouteContext) {}

  recover(): void {
    const db = this.ctx.store.db;
    // Never replay a turn that might already have performed a write or created a Bridge request.
    db.prepare(`update message_submissions set state = 'interrupted', error_code = 'server_restarted', updated_at = ?
      where state = 'running'`).run(new Date().toISOString());
    const interrupted = db.prepare("select * from message_submissions where state = 'interrupted' and notice_message_id is null")
      .all() as MessageSubmission[];
    for (const submission of interrupted) this.publishInterruption(submission);
    this.schedule();
  }

  schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      if (!this.ctx.store.db.open) return;
      try { this.drain(); } catch {
        // A database/queue fault must not become an unhandled rejection or a false HTTP send failure.
        console.error("[message-submission] queue_unavailable");
      }
    });
  }

  private drain(): void {
    const db = this.ctx.store.db;
    while (this.active < 4) {
      const submission = db.transaction(() => {
        // Preserve acceptance order within a conversation; unrelated conversations can progress independently.
        const row = db.prepare(`select q.* from message_submissions q where q.state = 'queued' and not exists (
          select 1 from message_submissions r where r.state = 'running' and r.channel_id = q.channel_id
            and r.conversation_id is q.conversation_id
        ) order by q.created_at, q.rowid limit 1`).get() as MessageSubmission | undefined;
        if (!row) return null;
        return db.prepare("update message_submissions set state = 'running', updated_at = ? where message_id = ? and state = 'queued'")
          .run(new Date().toISOString(), row.message_id).changes ? row : null;
      })();
      if (!submission) return;
      this.active++;
      void this.process(submission).finally(() => { this.active--; this.schedule(); });
    }
  }

  private async process(submission: MessageSubmission): Promise<void> {
    const { store } = this.ctx;
    const started = Date.now();
    try {
      const message = store.getMessage(submission.message_id);
      const channel = store.resolveTarget(submission.channel_id);
      const agent = submission.assistant_agent_id ? store.getAgent(submission.assistant_agent_id) : null;
      const conversation = submission.conversation_id ? store.getConversation(submission.conversation_id) : null;
      if (!message || message.deletedAt || !channel || channel.archivedAt ||
          !store.canUserAccessChannel(submission.user_id, channel.id) || channel.dmPeerAgentId !== agent?.id ||
          !isCommunicationAgent(agent) || conversation?.archivedAt || conversation?.status === "closed") {
        throw new Error("message_submission_access_changed");
      }
      const reply = await maybeReplyToCommunicationAgentDm(this.ctx, { message, agent });
      store.db.prepare(`update message_submissions set state = 'dispatched', reply_message_id = ?, updated_at = ?
        where message_id = ? and state = 'running'`).run(reply?.id ?? null, new Date().toISOString(), message.id);
      if (reply) {
        try {
          this.ctx.mirrorTyrAssistantMessagesToTelegram?.({ userId: submission.user_id,
            serverId: agent!.serverId ?? channel.serverId ?? "local", channelId: reply.channelId, messages: [reply] });
        } catch { console.error("[message-submission] reply_mirror_unavailable"); }
      }
      console.info("[message-submission]", JSON.stringify({ event: "dispatched", clientRequestId: submission.client_request_id,
        messageId: submission.message_id, elapsedMs: Date.now() - started }));
    } catch {
      if (!store.db.open) return;
      try {
        store.db.prepare(`update message_submissions set state = 'interrupted', error_code = 'processing_interrupted', updated_at = ?
          where message_id = ? and state = 'running'`).run(new Date().toISOString(), submission.message_id);
        this.publishInterruption(submission);
        console.error("[message-submission]", JSON.stringify({ event: "interrupted",
          clientRequestId: submission.client_request_id, messageId: submission.message_id }));
      } catch { console.error("[message-submission] interruption_record_unavailable"); }
    }
  }

  private publishInterruption(submission: MessageSubmission): void {
    const { store } = this.ctx;
    try {
      const notice = store.db.transaction(() => {
        const current = getMessageSubmission(store, submission.user_id, submission.client_request_id);
        const source = store.getMessage(submission.message_id);
        const agent = submission.assistant_agent_id ? store.getAgent(submission.assistant_agent_id) : null;
        if (!current || current.notice_message_id || !source || source.deletedAt || !agent ||
            !store.canUserAccessChannel(submission.user_id, submission.channel_id)) return null;
        const content = "Your message was saved, but TYR processing was interrupted. Some actions may already have started. Review this conversation before requesting further work; this message will not be replayed automatically.";
        const message = store.sendMessage({ target: source.channelId, conversationId: source.conversationId,
          allowClosedConversation: true, senderType: "agent", senderId: agent.id, senderName: agent.displayName,
          serverId: agent.serverId, content, result: { version: 1, status: "partial", title: "TYR processing was interrupted",
            summary: content, communicationRequest: { sourceMessageId: source.id } } }).message;
        store.db.prepare("update message_submissions set notice_message_id = ? where message_id = ?").run(message.id, source.id);
        return message;
      })();
      if (notice) this.ctx.emitRealtimeMessage(notice);
    } catch { console.error("[message-submission] interruption_notice_unavailable"); }
  }
}
