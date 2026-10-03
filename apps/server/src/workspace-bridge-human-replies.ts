import { claimWorkspaceBridgeTerminal } from "./workspace-bridge-lifecycle";
import type { CrossWorkspaceMessageRecord, MessageRecord } from "@tyr-ai/contracts";
import type { ServerRouteContext } from "./server-context";
import { classifyHumanReply, type HumanReplyClassificationInput, type HumanReplyIntent } from "./human-reply-classifier";
import { getBridgeRoutePlanningContext } from "./bridge-route-intent";
import { createWorkspaceBridgeOriginMessage } from "./workspace-bridge-delivery";
import { splitTelegramText } from "./telegram-assistant-sync";

type Row = { request_id: string; owner_user_id: string; server_id: string; classification: string;
  status: "waiting" | "answered" | "cancelled"; notice_message_id: string; reply_content: string | null;
  reply_message_id: string | null; terminal_id: string | null; origin_message_id: string | null; created_at: string; answered_at: string | null };
export type PersonalReplyMode = "human" | "autonomous";
export class HumanReplyError extends Error {}
const now = () => new Date().toISOString();

/** The Owner's answer is data authored by that Owner, never an instruction to run a model or tools. */
export class WorkspaceBridgeHumanReplies {
  constructor(private readonly ctx: ServerRouteContext,
    private readonly classify?: (input: HumanReplyClassificationInput) => Promise<HumanReplyIntent>) {}
  private get store() { return this.ctx.store; }
  private row(id: string) { return this.store.db.prepare("select * from workspace_bridge_human_replies where request_id = ?").get(id) as Row | undefined; }

  preferences(userId: string): { mode: PersonalReplyMode; legacyDefault: boolean } {
    if (!this.store.getUser(userId)) throw new HumanReplyError("user_not_found");
    const saved = this.store.db.prepare("select mode, legacy_default from tyr_reply_preferences where user_id = ?")
      .get(userId) as { mode: PersonalReplyMode; legacy_default: number } | undefined;
    return { mode: saved?.mode ?? "human", legacyDefault: Boolean(saved?.legacy_default) };
  }
  setMode(userId: string, mode: string) {
    if (!["human", "autonomous"].includes(mode)) throw new HumanReplyError("invalid_reply_mode");
    this.preferences(userId);
    this.store.db.prepare(`insert into tyr_reply_preferences (user_id, mode, legacy_default, updated_at)
      values (?, ?, 0, ?) on conflict(user_id) do update set mode = excluded.mode, legacy_default = 0, updated_at = excluded.updated_at`)
      .run(userId, mode, now());
    this.store.recordAuditEvent({ kind: "personal_reply_mode_changed", actorType: "user", actorId: userId,
      resourceType: "user", resourceId: userId, metadata: { mode } });
    return this.preferences(userId);
  }
  isWaiting(requestId: string) { return this.row(requestId)?.status === "waiting"; }

  deliverFollowup(request: CrossWorkspaceMessageRecord, event: CrossWorkspaceMessageRecord): boolean {
    const row = this.row(request.id);
    if (row?.status !== "waiting") return false;
    this.validateRequest(request, row.owner_user_id);
    const notice = this.store.getMessage(row.notice_message_id);
    if (!notice) throw new HumanReplyError("personal_reply_unavailable");
    const message = this.store.db.transaction(() => {
      const receiver = this.store.ensureDefaultCommunicationAgent(row.server_id);
      const message = this.store.sendMessage({ target: notice.channelId, conversationId: notice.conversationId,
        allowClosedConversation: true, senderType: "agent", senderId: receiver.id, senderName: receiver.displayName,
        serverId: row.server_id, content: `Additional information for your personal reply:\n\n${event.content}\n\nReply to this notification in Telegram, or open Personal replies in Web.` }).message;
      this.enqueueOwnerNotification(row.owner_user_id, row.server_id, message);
      return message;
    })();
    this.ctx.emitRealtimeMessage(message);
    this.ctx.publishWorkspaceSync();
    return true;
  }

  private validateRequest(request: CrossWorkspaceMessageRecord, ownerId: string) {
    const bridge = this.store.getWorkspaceBridgeForServer(request.bridgeId, request.targetWorkspaceId);
    const workspace = this.store.listServersForUser(ownerId).find((item) => item.id === request.targetWorkspaceId && item.role === "owner");
    const sourceBridge = this.store.getWorkspaceBridgeForServer(request.bridgeId, request.sourceWorkspaceId);
    const sourceMember = request.sourceCapabilityUserId && this.store.listServersForUser(request.sourceCapabilityUserId)
      .find((item) => item.id === request.sourceWorkspaceId);
    if (!bridge || bridge.status !== "active" || !bridge.permissions.includes("chat") || !workspace || !request.conversationId || request.replyToMessageId ||
        !sourceMember || sourceMember.role === "guest" ||
        request.resolvedByTerminalId || (request.targetCapabilityUserId && request.targetCapabilityUserId !== ownerId) ||
        sourceBridge?.peerWorkspace?.ownerUserId !== ownerId ||
        (bridge.direction === "one_way" && bridge.workspaceAId !== request.sourceWorkspaceId)) {
      throw new HumanReplyError("human_reply_request_unavailable");
    }
    if (request.originChannelId && request.originMessageId && !request.parentBridgeRequestId) {
      const source = this.store.getMessage(request.originMessageId);
      if (!source || source.deletedAt || source.channelId !== request.originChannelId ||
          source.conversationId !== request.originConversationId || !request.senderUserId ||
          !this.store.canUserAccessChannel(request.senderUserId, request.originChannelId)) {
        throw new HumanReplyError("human_reply_request_unavailable");
      }
    }
    return workspace;
  }

  async holdIfNeeded(request: CrossWorkspaceMessageRecord): Promise<boolean> {
    if (this.row(request.id)) return true;
    const receiver = this.store.ensureDefaultCommunicationAgent(request.targetWorkspaceId);
    const ownerId = request.targetCapabilityUserId ?? receiver.ownerUserId;
    const owner = this.store.getUser(ownerId);
    if (!owner) throw new HumanReplyError("human_reply_owner_unavailable");
    this.validateRequest(request, owner.id);
    const root = getBridgeRoutePlanningContext(this.store, request.id, request.targetWorkspaceId);
    const input = { ownerName: owner.displayName, originalRequest: root?.request.content ?? request.content,
      inboundRequest: request.content, agents: this.store.listAgents(request.targetWorkspaceId).filter((agent) => agent.kind !== "communication")
        .map((agent) => agent.displayName) };
    let intent: HumanReplyIntent | "unclassified";
    try {
      intent = this.classify ? await this.classify(input) : this.ctx.assistantLlmConfig
        ? await classifyHumanReply(input, this.ctx.assistantLlmConfig) : "unclassified";
      if (!["personal", "explicit_human", "work", "unclassified"].includes(intent)) intent = "unclassified";
    } catch { intent = "unclassified"; }
    if (intent === "work" || (intent === "personal" && this.preferences(owner.id).mode === "autonomous")) return false;
    // Recheck after the classifier awaited: neither a revoked Bridge nor a concurrent terminal can be reopened.
    const current = this.store.getCrossWorkspaceMessage(request.id);
    if (!current) throw new HumanReplyError("human_reply_request_unavailable");
    this.validateRequest(current, owner.id);
    const saved = this.store.db.transaction(() => {
      if (this.row(request.id)) return null;
      if (this.store.db.prepare("select 1 from cross_workspace_messages where terminal_request_id = ?").get(request.id)) return null;
      const dm = this.store.getOrCreateAgentDm(receiver.id, owner.id);
      if (!dm) throw new HumanReplyError("human_reply_owner_dm_unavailable");
      const conversation = this.store.createConversation({ channelId: dm.id, title: "Personal reply requested",
        startedByType: "agent", startedById: receiver.id, closeExisting: false });
      const from = request.senderUserDisplayName ?? request.senderUserName ?? "A connected workspace user";
      const content = `Personal reply requested by ${from}\n\n${request.content.slice(0, 2600)}${request.content.length > 2600 ? "…" : ""}\n\n` +
        "Reply to this notification in Telegram, or open Settings → Channels → Personal replies in Web. Your words will be sent directly to the requester, labelled as your personal reply.";
      const notice = this.store.sendMessage({ target: dm.id, conversationId: conversation.id, senderType: "agent",
        senderId: receiver.id, senderName: receiver.displayName, serverId: request.targetWorkspaceId, content }).message;
      this.store.db.prepare(`insert into workspace_bridge_human_replies
        (request_id, owner_user_id, server_id, classification, status, notice_message_id, created_at)
        values (?, ?, ?, ?, 'waiting', ?, ?)`).run(request.id, owner.id, request.targetWorkspaceId, intent, notice.id, now());
      this.enqueueOwnerNotification(owner.id, request.targetWorkspaceId, notice);
      this.store.updateCrossWorkspaceMessage(request.id, { outcome: "delivered" });
      const waiting = `Sent to ${owner.displayName}'s personal reply inbox. Waiting for their own reply; this does not mean they have read it.`;
      const ack = this.store.createCrossWorkspaceMessage({ bridgeId: request.bridgeId, conversationId: request.conversationId!,
        responseKind: "ack", sourceWorkspaceId: request.targetWorkspaceId, targetWorkspaceId: request.sourceWorkspaceId,
        initiatedBy: "agent", content: waiting, outcome: "delivered", replyToMessageId: request.id });
      const origin = createWorkspaceBridgeOriginMessage(this.store, request, { content: waiting, status: "partial", peerWorkspaceName: "Connected workspace" });
      // Link the durable receipt to this request so the source TYR reuses it after its tool call.
      if (origin) this.store.updateCrossWorkspaceMessage(ack.id, { originMessageId: origin.id });
      this.store.recordAuditEvent({ kind: "workspace_bridge_human_reply_requested", actorType: "user", actorId: request.senderUserId ?? "",
        resourceType: "server", resourceId: request.targetWorkspaceId, serverId: request.targetWorkspaceId,
        metadata: { requestId: request.id, ownerUserId: owner.id, classification: intent, noticeMessageId: notice.id } });
      return { notice, origin, ack };
    })();
    if (saved) {
      this.ctx.emitRealtimeMessage(saved.notice);
      if (saved.origin) this.ctx.emitRealtimeMessage(saved.origin);
      this.ctx.emitRealtimeWorkspaceBridgeMessage(saved.ack);
      this.ctx.publishWorkspaceSync();
    }
    return true;
  }

  private enqueueOwnerNotification(userId: string, serverId: string, message: MessageRecord) {
    const account = this.store.getTelegramAccountByUserId(userId);
    if (account?.serverId !== serverId || account.status !== "active" || account.revokedAt) return;
    this.store.enqueueTelegramOutboundDeliveries({ telegramAccountId: account.id, telegramChatId: account.telegramChatId,
      messageId: message.id, messageSeq: message.seq, chunks: splitTelegramText(message.content) });
  }

  list(userId: string, serverId: string) {
    if (!this.store.listServersForUser(userId).some((server) => server.id === serverId && server.role === "owner")) {
      throw new HumanReplyError("workspace_owner_required");
    }
    const rows = this.store.db.prepare(`select * from workspace_bridge_human_replies where owner_user_id = ? and server_id = ?
      order by case when status = 'waiting' then 0 else 1 end, created_at desc limit 100`).all(userId, serverId) as Row[];
    return rows.map((row) => {
      const request = this.store.getCrossWorkspaceMessage(row.request_id)!;
      let available = true;
      try { this.validateRequest(request, userId); } catch { available = false; }
      const followups = this.store.db.prepare(`select content from cross_workspace_messages where reply_to_message_id = ?
        and response_kind in ('answer', 'instruction', 'continue') order by created_at`).all(request.id) as { content: string }[];
      return { requestId: row.request_id, status: row.status, available,
        senderName: request.senderUserDisplayName ?? request.senderUserName ?? "Bridge user", content: request.content,
        followups: followups.map((event) => event.content),
        reply: row.reply_content, createdAt: row.created_at, answeredAt: row.answered_at,
        needsReview: row.classification === "unclassified" };
    });
  }

  reply(requestId: string, userId: string, content: string) {
    if (typeof content !== "string" || !content.trim() || content.length > 12000) throw new HumanReplyError("invalid_personal_reply");
    const saved = this.store.db.transaction(() => {
      const row = this.row(requestId);
      if (!row || row.owner_user_id !== userId) throw new HumanReplyError("personal_reply_not_found");
      if (row.status === "answered") {
        if (row.reply_content !== content) throw new HumanReplyError("personal_reply_already_sent");
        return row;
      }
      if (row.status !== "waiting") throw new HumanReplyError("personal_reply_unavailable");
      const request = this.store.getCrossWorkspaceMessage(requestId)!;
      this.validateRequest(request, userId);
      if (this.store.db.prepare("select 1 from cross_workspace_messages where terminal_request_id = ?").get(requestId)) {
        throw new HumanReplyError("personal_reply_already_resolved");
      }
      const owner = this.store.getUser(userId)!;
      const notice = this.store.getMessage(row.notice_message_id);
      if (!notice || notice.deletedAt || !this.store.canUserAccessChannel(userId, notice.channelId)) throw new HumanReplyError("personal_reply_unavailable");
      const personal = this.store.sendMessage({ target: notice.channelId, conversationId: notice.conversationId, allowClosedConversation: true,
        personalReplyRequestId: requestId,
        senderType: "human", senderId: owner.id, senderName: owner.displayName, serverId: row.server_id, content }).message;
      const returnedText = `${owner.displayName} — personal reply, relayed by TYR:\n\n${content}`;
      const terminal = claimWorkspaceBridgeTerminal(this.store, { bridgeId: request.bridgeId, conversationId: request.conversationId!,
        sourceWorkspaceId: request.targetWorkspaceId, targetWorkspaceId: request.sourceWorkspaceId,
        responseKind: "final", initiatedBy: "agent", content: returnedText, outcome: "delivered", replyToMessageId: request.id });
      if (!terminal) throw new HumanReplyError("personal_reply_work_pending");
      if (!terminal.created) throw new HumanReplyError("personal_reply_already_resolved");
      // Direct personal communication is final without another model pass. Nested work still belongs
      // to its parent workflow; keep that continuation so answering a subquestion cannot terminate it.
      if (!request.parentBridgeRequestId) this.store.db.prepare("update cross_workspace_messages set continuation_state = 'completed' where id = ?").run(request.id);
      const origin = createWorkspaceBridgeOriginMessage(this.store, this.store.getCrossWorkspaceMessage(request.id)!, {
        content: returnedText, status: "completed", peerWorkspaceName: "Connected workspace", sourceHumanName: owner.displayName });
      if (origin) this.store.updateCrossWorkspaceMessage(terminal.message.id, { originMessageId: origin.id });
      this.store.db.prepare(`update workspace_bridge_human_replies set status = 'answered', reply_content = ?, reply_message_id = ?,
        terminal_id = ?, origin_message_id = ?, answered_at = ? where request_id = ?`)
        .run(content, personal.id, terminal.message.id, origin?.id ?? null, now(), requestId);
      this.store.recordAuditEvent({ kind: "workspace_bridge_personal_reply_sent", actorType: "user", actorId: owner.id,
        resourceType: "server", resourceId: row.server_id, serverId: row.server_id,
        metadata: { requestId, replyMessageId: personal.id, terminalId: terminal.message.id } });
      return this.row(requestId)!;
    })();
    this.publishAnswer(saved);
    return { status: "answered" as const, requestId };
  }

  private publishAnswer(row: Row) {
    const personal = row.reply_message_id ? this.store.getMessage(row.reply_message_id) : null;
    const origin = row.origin_message_id ? this.store.getMessage(row.origin_message_id) : null;
    const terminal = row.terminal_id ? this.store.getCrossWorkspaceMessage(row.terminal_id) : null;
    const request = this.store.getCrossWorkspaceMessage(row.request_id);
    if (personal) this.ctx.emitRealtimeMessage(personal);
    if (terminal) this.ctx.emitRealtimeWorkspaceBridgeMessage(terminal);
    if (origin && request) {
      this.ctx.emitRealtimeMessage(origin);
      this.ctx.scheduleWorkspaceBridgeExternalReturn?.(request, origin);
    }
    this.ctx.publishWorkspaceSync();
  }

  telegramReply(accountId: string, userId: string, chatId: string, replyToMessageId: number, text: string): boolean {
    const account = this.store.getTelegramAccount(accountId);
    if (!account || account.status !== "active" || account.revokedAt || account.userId !== userId || account.telegramChatId !== chatId) return false;
    const row = this.store.db.prepare(`select h.request_id from telegram_outbound_deliveries d
      join messages sent on sent.id = d.message_id
      join messages notice on notice.channel_id = sent.channel_id and notice.conversation_id = sent.conversation_id
      join workspace_bridge_human_replies h on h.notice_message_id = notice.id
      where d.telegram_account_id = ? and d.telegram_chat_id = ? and d.telegram_message_id = ? and h.owner_user_id = ? and h.server_id = ?`)
      .get(accountId, chatId, String(replyToMessageId), userId, account.serverId) as { request_id: string } | undefined;
    if (!row) return false;
    this.reply(row.request_id, userId, text);
    return true;
  }

  recover() {
    // Exact original conversation and external return are persisted, even when the UI has switched topics.
    const rows = this.store.db.prepare(`select h.* from workspace_bridge_human_replies h
      join cross_workspace_messages r on r.id = h.request_id where h.status = 'answered'
      and r.origin_source in ('telegram', 'email') and r.origin_external_delivered_at is null`).all() as Row[];
    for (const row of rows) this.publishAnswer(row);
  }
}
