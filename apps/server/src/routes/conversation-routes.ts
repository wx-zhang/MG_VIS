import type express from "express";
import { isCommunicationAgent, type ChannelRecord, type ConversationResetStatus } from "@tyr-ai/contracts";
import { warnIfLargeSyncPayload } from "../sync-payload-diagnostics";
import type { ServerRouteContext } from "../server-context";
import { buildMessageExecutionSummaries } from "../message-execution-summary";
import { sanitizeHumanVisibleValue } from "../output-disclosure";

type ResetResult = {
  resetStatus: ConversationResetStatus;
  resetAgentId?: string | null;
  resetReason?: string | null;
};

export function registerConversationRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const {
    store,
    authUser,
    primaryServerIdForUser,
    sendToDaemon,
    startAgent,
    contextSessionsEnabledForAgent,
    broadcastRealtime,
    formatPublicMessage
  } = ctx;

  function visibleChannel(userId: string, channelId: string): ChannelRecord | null {
    const channel = store.resolveTarget(channelId, primaryServerIdForUser(userId) ?? undefined);
    return channel && store.canUserAccessChannel(userId, channel.id) ? channel : null;
  }

  function includeArchived(value: unknown): boolean {
    return value === "1";
  }

  function conversationTitle(value: unknown): string | undefined {
    const clean = typeof value === "string" ? value.trim() : "";
    return clean ? clean.slice(0, 120) : undefined;
  }

  function editableConversationTitle(value: unknown): { title?: string; error?: "conversation_title_required" | "conversation_title_too_long" } {
    const clean = typeof value === "string" ? value.trim() : "";
    if (!clean) return { error: "conversation_title_required" };
    if (Array.from(clean).length > 72) return { error: "conversation_title_too_long" };
    return { title: clean };
  }

  function resetOwnedRuntimeAgent(userId: string, channel: ChannelRecord): ResetResult {
    const agent = channel.dmPeerAgentId ? store.getAgent(channel.dmPeerAgentId) : null;
    if (!agent || isCommunicationAgent(agent)) {
      return { resetStatus: "not_applicable" };
    }
    const machine = agent.machineId ? store.getMachine(agent.machineId) : null;
    if (!agent.runtime || !machine || agent.ownerUserId !== userId || machine.ownerUserId !== userId) {
      return { resetStatus: "skipped", resetAgentId: agent.id, resetReason: "Agent runtime reset skipped because this is not an owner-managed runtime Agent." };
    }
    if (contextSessionsEnabledForAgent?.(agent, machine)) {
      // P1 的 conversation id 本身就是新 RuntimeContext；创建新会话不再停止 Agent 或清理其他 conversation/Thread Session。
      return { resetStatus: "not_applicable", resetAgentId: agent.id };
    }
    sendToDaemon(machine.id, { type: "agent:stop", agentId: agent.id });
    // New conversation is a deliberate context boundary; clearing session forces the next runtime start to create fresh Agent context.
    const freshAgent = store.clearAgentSession(agent.id, "New DM conversation requested; next runtime start should use a fresh context.") ?? agent;
    const started = startAgent(freshAgent);
    return {
      resetStatus: started ? "completed" : "failed",
      resetAgentId: agent.id,
      resetReason: started ? null : "Agent restart request was not accepted by the daemon."
    };
  }

  function createFreshConversation(userId: string, channel: ChannelRecord, title?: string) {
    // Start new conversation 永远建立新的 DM 上下文；runtime reset 是内部保障，不再由 Web 暴露为独立选项。
    const reset = resetOwnedRuntimeAgent(userId, channel);
    const peerAgent = channel.dmPeerAgentId ? store.getAgent(channel.dmPeerAgentId) : null;
    return store.createConversation({
      channelId: channel.id,
      title,
      startedByType: "human",
      startedById: userId,
      // TYR 可由 Web、Telegram 和 Email 同时维护独立上下文；普通 Runtime Agent 仍保持单一 session 边界。
      closeExisting: !peerAgent || !isCommunicationAgent(peerAgent),
      resetStatus: reset.resetStatus,
      resetAgentId: reset.resetAgentId ?? null,
      resetReason: reset.resetReason ?? null
    });
  }

  app.get("/api/channels/:channelId/conversations", (req, res) => {
    const user = authUser(req);
    const channel = visibleChannel(user.id, req.params.channelId);
    if (!channel) {
      res.status(404).json({ error: "channel_not_found" });
      return;
    }
    if (channel.type !== "dm") {
      res.status(400).json({ error: "conversation_not_dm" });
      return;
    }
    res.json({
      conversations: store.listConversations(channel.id, { includeArchived: includeArchived(req.query.includeArchived) }),
      activeConversationId: store.resolveTarget(channel.id, channel.serverId)?.activeConversationId ?? null
    });
  });

  app.post("/api/channels/:channelId/conversations", (req, res) => {
    const user = authUser(req);
    const channel = visibleChannel(user.id, req.params.channelId);
    if (!channel) {
      res.status(404).json({ error: "channel_not_found" });
      return;
    }
    if (channel.type !== "dm") {
      res.status(400).json({ error: "conversation_not_dm" });
      return;
    }
    const conversation = createFreshConversation(user.id, channel, conversationTitle(req.body?.title));
    const currentChannel = store.resolveTarget(channel.id, channel.serverId);
    broadcastRealtime("conversation:created", {
      conversation,
      channelId: channel.id,
      activeConversationId: currentChannel?.activeConversationId ?? conversation.id,
      source: "web"
    }, { channelId: channel.id, userId: user.id });
    res.json({ conversation, channel: currentChannel });
  });

  app.patch("/api/conversations/:conversationId", (req, res) => {
    const user = authUser(req);
    const conversation = store.getConversation(req.params.conversationId);
    if (!conversation || !store.canUserAccessChannel(user.id, conversation.channelId)) {
      res.status(404).json({ error: "conversation_not_found" });
      return;
    }
    const parsed = editableConversationTitle(req.body?.title);
    if (!parsed.title) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const renamed = store.renameConversation(conversation.id, parsed.title);
    if (!renamed) {
      res.status(400).json({ error: "conversation_rename_failed" });
      return;
    }
    res.json({ conversation: renamed });
  });

  app.post("/api/conversations/:conversationId/archive", (req, res) => {
    const user = authUser(req);
    const conversation = store.getConversation(req.params.conversationId);
    if (!conversation || !store.canUserAccessChannel(user.id, conversation.channelId)) {
      res.status(404).json({ error: "conversation_not_found" });
      return;
    }
    const channel = visibleChannel(user.id, conversation.channelId);
    if (!channel) {
      res.status(404).json({ error: "conversation_not_found" });
      return;
    }
    // 归档当前会话时先创建新的 active conversation，确保 DM 始终保留可发送的干净上下文。
    const replacementConversation = channel.activeConversationId === conversation.id
      ? createFreshConversation(user.id, channel)
      : null;
    const archived = store.archiveConversation(conversation.id, user.id);
    if (!archived) {
      res.status(400).json({ error: "conversation_archive_failed" });
      return;
    }
    res.json({
      conversation: archived,
      replacementConversation,
      channel: store.resolveTarget(channel.id, channel.serverId)
    });
  });

  app.post("/api/conversations/:conversationId/unarchive", (req, res) => {
    const user = authUser(req);
    const conversation = store.getConversation(req.params.conversationId);
    if (!conversation || !store.canUserAccessChannel(user.id, conversation.channelId)) {
      res.status(404).json({ error: "conversation_not_found" });
      return;
    }
    const unarchived = store.unarchiveConversation(conversation.id);
    if (!unarchived) {
      res.status(400).json({ error: "conversation_unarchive_failed" });
      return;
    }
    res.json({ conversation: unarchived });
  });

  app.delete("/api/conversations/:conversationId", (req, res) => {
    const user = authUser(req);
    const conversation = store.getConversation(req.params.conversationId);
    if (!conversation || !store.canUserAccessChannel(user.id, conversation.channelId)) {
      res.status(404).json({ error: "conversation_not_found" });
      return;
    }
    const deleted = store.deleteConversation(conversation.id);
    if (!deleted.success) {
      res.status(deleted.reason === "conversation_not_found" ? 404 : 400).json({ error: deleted.reason ?? "conversation_delete_failed" });
      return;
    }
    res.json({
      ok: true,
      conversation: deleted.conversation,
      deletedMessageIds: deleted.deletedMessageIds ?? [],
      deletedThreadChannelIds: deleted.deletedThreadChannelIds ?? []
    });
  });

  app.get("/api/conversations/:conversationId/messages", (req, res) => {
    const user = authUser(req);
    const conversation = store.getConversation(req.params.conversationId);
    if (!conversation || !store.canUserAccessChannel(user.id, conversation.channelId)) {
      res.status(404).json({ error: "conversation_not_found" });
      return;
    }
    const limit = pagedMessageLimit(req.query.limit);
    const beforeSeq = optionalPositiveInt(req.query.beforeSeq);
    const afterSeq = optionalPositiveInt(req.query.afterSeq);
    const aroundMessageId = typeof req.query.aroundMessageId === "string" && req.query.aroundMessageId.trim() ? req.query.aroundMessageId.trim() : undefined;
    const history = store.readConversationHistory(conversation.id, limit, aroundMessageId, beforeSeq, afterSeq);
    const messages = history?.messages ?? [];
    const oldestSeq = messages[0]?.seq ?? null;
    const newestSeq = messages.at(-1)?.seq ?? null;
    const executionSummaries = buildMessageExecutionSummaries(store, user.id, messages);
    const payload = {
      conversation,
      messages: messages.map(formatPublicMessage),
      historyLimited: false,
      runtimeExecutions: executionSummaries.runtimeExecutions,
      runtimeApprovals: executionSummaries.runtimeApprovals,
      messageExecutionSummaries: executionSummaries.messageExecutionSummaries,
      pageInfo: {
        hasMoreBefore: oldestSeq !== null ? countConversationMessagesBefore(store, conversation.id, oldestSeq) > 0 : false,
        hasMoreAfter: newestSeq !== null ? countConversationMessagesAfter(store, conversation.id, newestSeq) > 0 : false,
        oldestSeq,
        newestSeq
      }
    };
    const publicPayload = sanitizeHumanVisibleValue(payload);
    warnIfLargeSyncPayload("conversation-message-page", publicPayload, { userId: user.id });
    res.json(publicPayload);
  });
}

function optionalPositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function pagedMessageLimit(value: unknown): number {
  const parsed = Number(value);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.floor(parsed) : 50, 100));
}

function countConversationMessagesBefore(store: ServerRouteContext["store"], conversationId: string, seq: number): number {
  return Number(store.db.prepare("select count(*) from messages where conversation_id = ? and kind = 'chat' and seq < ?").pluck().get(conversationId, seq) ?? 0);
}

function countConversationMessagesAfter(store: ServerRouteContext["store"], conversationId: string, seq: number): number {
  return Number(store.db.prepare("select count(*) from messages where conversation_id = ? and kind = 'chat' and seq > ?").pluck().get(conversationId, seq) ?? 0);
}
