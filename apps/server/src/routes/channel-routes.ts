import type express from "express";
import { isCommunicationAgent, type ChannelRecord, type MessageRecord, type RuntimeExecutionRecord } from "@tyr-ai/contracts";
import { warnIfLargeSyncPayload } from "../sync-payload-diagnostics";
import type { ServerRouteContext } from "../server-context";
import { MESSAGE_EXECUTION_STOP_DETAIL, cancelMessageExecutions } from "../message-deletion";
import { buildMessageExecutionSummaries } from "../message-execution-summary";
import { sanitizeHumanVisibleValue } from "../output-disclosure";

export function registerChannelRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const {
    store,
    authUser,
    primaryServerIdForUser,
    isServerOwner,
    publishWorkspaceSync,
    broadcastRealtime,
    emitRealtimeThreadUpdate,
    emitRealtimeRuntimeExecution,
    formatPublicMessage,
    formatSearchMessage,
    formatChannel,
    gravatarHash,
    listInboxItems,
    sendToDaemon,
    contextSessionsEnabledForAgent,
    listChannelFileItems,
    formatMachineListResponse
  } = ctx;

  function recordDeniedChannelAccess(userId: string, channelId: string): void {
    const channel = store.resolveTarget(channelId, primaryServerIdForUser(userId) ?? undefined);
    if (!channel || (channel.type !== "dm" && channel.visibility !== "private")) return;
    store.recordAuditEvent({
      kind: "denied_private_channel_or_dm_access",
      actorType: "user",
      actorId: userId,
      resourceType: "channel",
      resourceId: channel.id,
      serverId: channel.serverId ?? "local",
      metadata: { channelType: channel.type, visibility: channel.visibility }
    });
  }

  function hasWorkspaceServerAccess(userId: string, serverId?: string): boolean {
    if (!serverId) return false;
    return store.listServersForUser(userId).some((serverRecord) => (
      serverRecord.id === serverId &&
      (serverRecord.role === "owner" || serverRecord.role === "member")
    ));
  }

  function requireWorkspaceServerAccess(userId: string, serverId: string, res: express.Response): boolean {
    if (hasWorkspaceServerAccess(userId, serverId)) return true;
    res.status(403).json({ error: "workspace_member_required" });
    return false;
  }

  function messageDeleteForbidden(userId: string, message: MessageRecord): boolean {
    if (message.senderType === "human") return message.senderId !== userId;
    if (message.senderType === "agent") {
      const agent = store.getAgent(message.senderId);
      // Agent 输出代表其 owner 的工作产物；阶段 2 只允许 owner 删除，避免跨用户协作审计被改写。
      return agent?.ownerUserId !== userId;
    }
    // System 消息属于系统审计流，不开放删除。
    return true;
  }

  function stopAgentsForExecutions(executions: RuntimeExecutionRecord[]): string[] {
    const stoppedAgents: string[] = [];
    const stoppedAgentIds = new Set<string>();
    for (const execution of executions) {
      const agent = store.getAgent(execution.agentId);
      if (!agent) continue;
      const machine = agent.machineId ? store.getMachine(agent.machineId) : null;
      if (contextSessionsEnabledForAgent?.(agent, machine)) {
        // P1 取消只命中该 execution/context；排队项已由 server inbox ack 收口，不能 stop 整个 Agent 影响其他 Thread。
        if (execution.runtimeContextKey && execution.runtimeSessionRecordId) {
          sendToDaemon(agent.machineId, {
            type: "agent:runtime_execution:cancel",
            agentId: agent.id,
            executionId: execution.id,
            contextKey: execution.runtimeContextKey,
            sessionRecordId: execution.runtimeSessionRecordId
          });
        }
        continue;
      }
      if (stoppedAgentIds.has(agent.id)) continue;
      stoppedAgentIds.add(agent.id);
      if (sendToDaemon(agent.machineId, { type: "agent:stop", agentId: agent.id })) stoppedAgents.push(agent.id);
    }
    return stoppedAgents;
  }

  function cancelMessageExecutionFlow(message: MessageRecord, detail?: string): { cancelledExecutions: RuntimeExecutionRecord[]; stoppedAgents: string[] } {
    const { cancelledExecutions } = cancelMessageExecutions(store, message, detail);
    for (const execution of cancelledExecutions) emitRealtimeRuntimeExecution(execution);
    return {
      cancelledExecutions,
      stoppedAgents: stopAgentsForExecutions(cancelledExecutions)
    };
  }

  app.post("/api/channels", (req, res) => {
    authUser(req);
    // 返回统一的不存在语义，避免已下线的群聊能力继续作为可探测 API 暴露。
    res.status(404).json({ error: "not_found" });
  });

  app.get("/api/channels", (req, res) => {
    authUser(req);
    res.status(404).json({ error: "not_found" });
  });

  app.get("/api/channels/dm", (req, res) => {
    const user = authUser(req);
    const serverId = primaryServerIdForUser(user.id) ?? undefined;
    const dms = store.listVisibleChannelIds(user.id)
      .map((channelId) => store.resolveTarget(channelId, serverId))
      .filter((channel): channel is ChannelRecord => Boolean(channel))
      .filter((channel) => channel.type === "dm")
      .map((channel) => {
        const peer = channel.dmPeerAgentId
          ? store.getAgent(channel.dmPeerAgentId)
          : store.listAgents(channel.serverId).find((agent) => agent.name === channel.name || agent.displayName === channel.name);
        return {
          id: channel.id,
          name: peer?.name ?? (channel.displayName.replace(/^DM\s*@?/, "") || channel.name),
          type: channel.type,
          description: channel.description ?? null,
          createdAt: channel.createdAt,
          peerId: peer?.id ?? null,
          peerName: peer?.name ?? null,
          peerDisplayName: peer?.displayName ?? null,
          peerDescription: peer?.description ?? null,
          peerGravatarHash: null,
          peerAvatarUrl: peer?.avatarUrl ?? null,
          peerType: peer ? "agent" : null,
          lastMessageAt: store.listMessages(channel.id, 1)[0]?.createdAt ?? null
        };
      });
    res.json(dms);
  });

  app.get("/api/channels/unread", (req, res) => {
    const user = authUser(req);
    const visibleChannelIds = store.listVisibleChannelIds(user.id);
    res.json(Object.fromEntries(Object.entries(store.listUnreadCounts(user.id)).filter(([channelId]) => visibleChannelIds.includes(channelId))));
  });

  app.get("/api/channels/member-index", (req, res) => {
    authUser(req);
    res.status(404).json({ error: "not_found" });
  });

  app.get("/api/channels/:channelId/messages", (req, res) => {
    const user = authUser(req);
    if (!store.canUserAccessChannel(user.id, req.params.channelId)) {
      recordDeniedChannelAccess(user.id, req.params.channelId);
      res.status(404).json({ error: "channel_not_found" });
      return;
    }
    const limit = pagedMessageLimit(req.query.limit);
    const beforeSeq = optionalPositiveInt(req.query.beforeSeq);
    const afterSeq = optionalPositiveInt(req.query.afterSeq);
    const aroundMessageId = typeof req.query.aroundMessageId === "string" && req.query.aroundMessageId.trim() ? req.query.aroundMessageId.trim() : undefined;
    const conversationId = typeof req.query.conversationId === "string" && req.query.conversationId.trim() ? req.query.conversationId.trim() : undefined;
    const conversation = conversationId ? store.getConversation(conversationId) : null;
    if (conversationId && conversation?.channelId !== req.params.channelId) {
      res.status(404).json({ error: "conversation_not_found" });
      return;
    }
    if (aroundMessageId && store.getMessage(aroundMessageId)?.channelId !== req.params.channelId) {
      res.status(404).json({ error: "message_not_found" });
      return;
    }
    const history = store.readHistory(
      req.params.channelId,
      limit,
      aroundMessageId,
      beforeSeq,
      afterSeq,
      primaryServerIdForUser(user.id) ?? undefined,
      conversationId ? { conversationId } : undefined
    );
    const messages = history?.messages ?? [];
    const oldestSeq = messages[0]?.seq ?? null;
    const newestSeq = messages.at(-1)?.seq ?? null;
    const executionSummaries = buildMessageExecutionSummaries(store, user.id, messages);
    const payload = {
      messages: messages.map(formatPublicMessage),
      historyLimited: false,
      runtimeExecutions: executionSummaries.runtimeExecutions,
      runtimeApprovals: executionSummaries.runtimeApprovals,
      messageExecutionSummaries: executionSummaries.messageExecutionSummaries,
      pageInfo: {
        hasMoreBefore: oldestSeq !== null ? countChannelMessagesBefore(store, req.params.channelId, oldestSeq, conversationId) > 0 : false,
        hasMoreAfter: newestSeq !== null ? countChannelMessagesAfter(store, req.params.channelId, newestSeq, conversationId) > 0 : false,
        oldestSeq,
        newestSeq
      }
    };
    const publicPayload = sanitizeHumanVisibleValue(payload);
    warnIfLargeSyncPayload("message-page", publicPayload, { userId: user.id });
    res.json(publicPayload);
  });

  app.get("/api/threads/:threadChannelId", (req, res) => {
    const user = authUser(req);
    const serverId = primaryServerIdForUser(user.id) ?? undefined;
    const thread = store.resolveTarget(req.params.threadChannelId, serverId);
    if (!thread || thread.type !== "thread" || !store.canUserAccessChannel(user.id, thread.id)) {
      recordDeniedChannelAccess(user.id, req.params.threadChannelId);
      res.status(404).json({ error: "thread_not_found" });
      return;
    }
    const parentChannel = thread.parentChannelId ? store.resolveTarget(thread.parentChannelId, serverId) : null;
    const parentMessage = thread.parentMessageId ? store.getMessage(thread.parentMessageId) : null;
    if (!parentChannel || parentChannel.type !== "dm" || !parentMessage || parentMessage.channelId !== parentChannel.id) {
      res.status(404).json({ error: "thread_not_found" });
      return;
    }
    const conversation = parentMessage.conversationId ? store.getConversation(parentMessage.conversationId) : null;
    res.json(sanitizeHumanVisibleValue({
      channel: {
        ...formatChannel(thread),
        parentChannelId: thread.parentChannelId
      },
      parentChannel: {
        ...formatChannel(parentChannel),
        activeConversationId: parentChannel.activeConversationId ?? null,
        dmPeerAgentId: parentChannel.dmPeerAgentId,
        dmPeerAgentName: parentChannel.dmPeerAgentName,
        dmPeerAgentDisplayName: parentChannel.dmPeerAgentDisplayName
      },
      parentMessage: formatPublicMessage(parentMessage),
      conversation
    }));
  });

  app.get("/api/channels/:channelId/files", (req, res) => {
    const user = authUser(req);
    if (!store.canUserAccessChannel(user.id, req.params.channelId)) {
      recordDeniedChannelAccess(user.id, req.params.channelId);
      res.status(404).json({ error: "channel_not_found" });
      return;
    }
    const messages = store.listMessages(req.params.channelId, 500);
    res.json(sanitizeHumanVisibleValue({ files: listChannelFileItems(messages, (attachmentId) => store.getAttachment(attachmentId)) }));
  });

  app.get("/api/channels/:channelId/threads", (req, res) => {
    const user = authUser(req);
    if (!store.canUserAccessChannel(user.id, req.params.channelId)) {
      recordDeniedChannelAccess(user.id, req.params.channelId);
      res.status(404).json({ error: "channel_not_found" });
      return;
    }
    const serverId = primaryServerIdForUser(user.id) ?? undefined;
    const result: Record<string, { threadChannelId: string; replyCount: number; lastReplyAt: string | null; participantIds: string[] }> = {};
    for (const thread of store.listVisibleChannelIds(user.id)
      .map((channelId) => store.resolveTarget(channelId, serverId))
      .filter((channel): channel is ChannelRecord => Boolean(channel))
      .filter((channel) => channel.type === "thread" && channel.parentChannelId === req.params.channelId && channel.parentMessageId)) {
      const replies = store.listMessages(thread.id, 1000);
      result[thread.parentMessageId!] = {
        threadChannelId: thread.id,
        replyCount: replies.length,
        lastReplyAt: replies.at(-1)?.createdAt ?? null,
        participantIds: [...new Set(replies.map((message) => message.senderId))]
      };
    }
    res.json(result);
  });

  app.post("/api/channels/:channelId/read", (_req, res) => {
    const user = authUser(_req);
    if (!store.canUserAccessChannel(user.id, _req.params.channelId)) {
      recordDeniedChannelAccess(user.id, _req.params.channelId);
      res.status(404).json({ error: "channel_not_found" });
      return;
    }
    store.markChannelRead(user.id, _req.params.channelId);
    res.json({ ok: true });
  });

  app.post("/api/channels/:channelId/unread", (_req, res) => {
    const user = authUser(_req);
    if (!store.canUserAccessChannel(user.id, _req.params.channelId)) {
      recordDeniedChannelAccess(user.id, _req.params.channelId);
      res.status(404).json({ error: "channel_not_found" });
      return;
    }
    const result = store.markChannelUnread(user.id, _req.params.channelId);
    res.json({ ok: true, unreadCount: result.unreadCount, firstUnreadMessageId: result.firstUnreadMessageId ?? null });
  });

  const groupChannelApiUnavailable = (req: express.Request, res: express.Response) => {
    authUser(req);
    res.status(404).json({ error: "not_found" });
  };

  app.patch("/api/channels/:channelId", groupChannelApiUnavailable);
  app.delete("/api/channels/:channelId", groupChannelApiUnavailable);
  app.post("/api/channels/:channelId/archive", groupChannelApiUnavailable);
  app.post("/api/channels/:channelId/unarchive", groupChannelApiUnavailable);
  app.get("/api/channels/:channelId/member-candidates", groupChannelApiUnavailable);
  app.get("/api/channels/:channelId/members", groupChannelApiUnavailable);
  app.put("/api/channels/:channelId/members/agents/:agentId", groupChannelApiUnavailable);
  app.put("/api/channels/:channelId/members/humans/:userId", groupChannelApiUnavailable);

  app.get("/api/messages/search", (req, res) => {
    const user = authUser(req);
    const query = String(req.query.q ?? "").trim().toLowerCase();
    const senderId = req.query.senderId ? String(req.query.senderId) : "";
    const after = typeof req.query.after === "string" && !Number.isNaN(Date.parse(req.query.after))
      ? new Date(req.query.after).toISOString()
      : undefined;
    // Relevant 与 Recent 是稳定的产品语义；未知值按时间倒序处理，避免产生隐式排序模式。
    const sort = req.query.sort === "relevance" ? "relevance" : "recent";
    const limit = Math.max(1, Math.min(req.query.limit ? Number(req.query.limit) : 20, 100));
    const offset = Math.max(0, req.query.offset ? Number(req.query.offset) : 0);
    const filtered = store.searchMessages(query, { userId: user.id, senderId, after, sort, limit: offset + limit + 1 });
    res.json({
      hasMore: offset + limit < filtered.length,
      results: filtered.slice(offset, offset + limit).map(formatSearchMessage)
    });
  });

  app.get("/api/channels/inbox", (req, res) => {
    const user = authUser(req);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    res.json(listInboxItems(req.query.limit ? Number(req.query.limit) : 30, req.query.offset ? Number(req.query.offset) : 0, user.id, cursor));
  });

  app.post("/api/channels/inbox/read-all", (req, res) => {
    const user = authUser(req);
    for (const channelId of store.listVisibleChannelIds(user.id)) {
      store.markChannelRead(user.id, channelId);
    }
    publishWorkspaceSync();
    res.json({ ok: true });
  });

  app.get("/api/channels/saved", (req, res) => {
    const user = authUser(req);
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const saved = store.listSavedMessages(user.id, limit, offset).filter((message) => store.canUserAccessChannel(user.id, message.channelId)).map(formatSearchMessage);
    res.json({ saved, hasMore: saved.length >= limit });
  });

  app.post("/api/messages/:messageId/save", (req, res) => {
    const user = authUser(req);
    const message = store.getMessage(req.params.messageId);
    if (!message || !store.canUserAccessChannel(user.id, message.channelId)) {
      res.status(404).json({ error: "message_not_found" });
      return;
    }
    if (message.deletedAt) {
      res.status(400).json({ error: "message_deleted" });
      return;
    }
    store.saveMessage(user.id, message.id);
    res.json({ ok: true, saved: true });
  });

  app.post("/api/messages/:messageId/unread", (req, res) => {
    const user = authUser(req);
    const result = store.markMessageUnread(user.id, req.params.messageId);
    if (!result.success) {
      res.status(result.reason === "message_not_found" ? 404 : 400).json({ error: result.reason ?? "mark_unread_failed" });
      return;
    }
    res.json({ ok: true, channelId: result.channelId, unreadCount: result.unreadCount, firstUnreadMessageId: result.firstUnreadMessageId ?? null });
  });

  app.post("/api/messages/:messageId/reactions", (req, res) => {
    const user = authUser(req);
    const message = store.getMessage(req.params.messageId);
    if (!message || !store.canUserAccessChannel(user.id, message.channelId)) {
      res.status(404).json({ error: "message_not_found" });
      return;
    }
    if (message.deletedAt) {
      res.status(400).json({ error: "message_deleted" });
      return;
    }
    if (message.channelType !== "channel" && message.channelType !== "thread") {
      res.status(400).json({ error: "reactions_channel_only" });
      return;
    }
    const result = store.toggleMessageReaction(user.id, message.id, String(req.body?.emoji ?? ""));
    if (!result.success || !result.message) {
      res.status(result.reason === "message_not_found" ? 404 : 400).json({ error: result.reason ?? "reaction_failed" });
      return;
    }
    // Reaction 只更新协作元数据和界面，不入队 agent inbox，也不触发 daemon wake。
    broadcastRealtime("message:updated", formatPublicMessage(result.message), { channelId: result.message.channelId });
    res.json({ active: result.active, message: formatPublicMessage(result.message) });
  });

  app.post("/api/messages/:messageId/executions/cancel", (req, res) => {
    const user = authUser(req);
    const message = store.getMessage(req.params.messageId);
    if (!message || !store.canUserAccessChannel(user.id, message.channelId)) {
      res.status(404).json({ error: "message_not_found" });
      return;
    }
    if (messageDeleteForbidden(user.id, message)) {
      res.status(403).json({ error: "message_delete_forbidden" });
      return;
    }
    const result = cancelMessageExecutionFlow(message, MESSAGE_EXECUTION_STOP_DETAIL);
    res.json({
      ok: true,
      message: formatPublicMessage(store.getMessage(message.id) ?? message),
      cancelledExecutions: result.cancelledExecutions,
      stoppedAgents: result.stoppedAgents
    });
  });

  app.delete("/api/messages/:messageId", (req, res) => {
    const user = authUser(req);
    const message = store.getMessage(req.params.messageId);
    if (!message || !store.canUserAccessChannel(user.id, message.channelId)) {
      res.status(404).json({ error: "message_not_found" });
      return;
    }
    if (messageDeleteForbidden(user.id, message)) {
      res.status(403).json({ error: "message_delete_forbidden" });
      return;
    }
    const result = cancelMessageExecutionFlow(message);
    const deleted = store.softDeleteMessage(message.id, user.id);
    if (!deleted) {
      res.status(404).json({ error: "message_not_found" });
      return;
    }
    broadcastRealtime("message:updated", formatPublicMessage(deleted), { channelId: deleted.channelId });
    res.json({
      ok: true,
      message: formatPublicMessage(deleted),
      cancelledExecutions: result.cancelledExecutions,
      stoppedAgents: result.stoppedAgents
    });
  });

  app.post("/api/messages/:messageId/thread", (req, res) => {
    const user = authUser(req);
    const message = store.getMessage(req.params.messageId);
    if (!message || !store.canUserAccessChannel(user.id, message.channelId)) {
      res.status(404).json({ error: "message_not_found" });
      return;
    }
    if (message.channelType !== "dm") {
      res.status(400).json({ error: "thread_dm_only" });
      return;
    }
    const parentDm = store.resolveTarget(message.channelId, primaryServerIdForUser(user.id) ?? undefined);
    const dmPeerAgent = parentDm?.type === "dm" && parentDm.dmPeerAgentId
      ? store.getAgent(parentDm.dmPeerAgentId)
      : null;
    if (!dmPeerAgent) {
      res.status(400).json({ error: "thread_dm_only" });
      return;
    }
    if (isCommunicationAgent(dmPeerAgent)) {
      // TYR 的执行链和结果固定回写主 DM，不能再创建一个不会进入 Assistant 路由的旁支 thread。
      res.status(400).json({ error: "thread_not_supported_for_assistant_dm" });
      return;
    }
    const result = store.ensureMessageThread(message.id);
    if (!result.success || !result.channel) {
      res.status(result.reason === "message_not_found" ? 404 : 400).json({ error: result.reason ?? "thread_create_failed" });
      return;
    }
    const sourceMessage = store.listMessages(message.channelId).find((item) => item.id === message.id);
    // 创建 thread 不改写源消息，只让源消息获得 thread 入口，因此推 message:updated 刷新操作区。
    if (sourceMessage) broadcastRealtime("message:updated", formatPublicMessage(sourceMessage), { channelId: message.channelId });
    emitRealtimeThreadUpdate(result.channel.id);
    res.json({ channel: formatChannel(result.channel), created: Boolean(result.created) });
  });

  app.delete("/api/messages/:messageId/save", (req, res) => {
    store.unsaveMessage(authUser(req).id, req.params.messageId);
    res.json({ ok: true, saved: false });
  });

  app.get("/api/servers/:serverId/sidebar-order", (req, res) => {
    res.json(store.getServerSidebarOrder(req.params.serverId));
  });

  app.post("/api/servers/:serverId/sidebar-order", (req, res) => {
    res.json(store.setServerSidebarOrder(req.params.serverId, req.body ?? {}));
  });

  app.post("/api/servers/:serverId/invites", (req, res) => {
    try {
      const user = authUser(req);
      if (!isServerOwner(user.id, req.params.serverId)) {
        res.status(403).json({ error: "owner_required" });
        return;
      }
      const invite = store.createServerInvite(String(req.body?.email ?? ""), user.id, req.params.serverId);
      const invitedUser = store.findUser(invite.invitedEmail);
      if (invitedUser) {
        // 已登录/已存在用户不会重新走登录自动接受路径，需要定向通知其前端刷新 incoming invite。
        broadcastRealtime("server_invite:created", { inviteId: invite.id, serverId: req.params.serverId }, { userId: invitedUser.id });
      }
      res.json({
        id: invite.id,
        invitedEmail: invite.invitedEmail,
        expiresAt: invite.expiresAt
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invite_failed" });
    }
  });

  app.get("/api/servers/:serverId/invites", (_req, res) => {
    const user = authUser(_req);
    if (!isServerOwner(user.id, _req.params.serverId)) {
      res.status(403).json({ error: "owner_required" });
      return;
    }
    res.json(store.listServerInvites("pending", _req.params.serverId));
  });

  app.delete("/api/servers/:serverId/invites/:inviteId", (req, res) => {
    const user = authUser(req);
    if (!isServerOwner(user.id, req.params.serverId)) {
      res.status(403).json({ error: "owner_required" });
      return;
    }
    const invite = store.revokeServerInvite(req.params.inviteId);
    if (!invite) {
      res.status(404).json({ error: "invite_not_found" });
      return;
    }
    const invitedUser = store.findUser(invite.invitedEmail);
    if (invitedUser) {
      // 撤销也必须定向通知受邀账号，否则全局 invite badge 会停留到下一次手动刷新。
      broadcastRealtime("server_invite:revoked", { inviteId: invite.id, serverId: req.params.serverId }, { userId: invitedUser.id });
    }
    res.json({ ok: true, invite });
  });

  app.get("/api/servers/:serverId/usage", (_req, res) => {
    if (!requireWorkspaceServerAccess(authUser(_req).id, _req.params.serverId, res)) return;
    res.json(store.serverUsage(_req.params.serverId));
  });

  app.get("/api/servers/:serverId/members", (_req, res) => {
    if (!requireWorkspaceServerAccess(authUser(_req).id, _req.params.serverId, res)) return;
    res.json(store.listServerMembers(_req.params.serverId).map((member) => ({
      userId: member.id,
      name: member.name,
      displayName: member.displayName,
      description: member.description ?? null,
      avatarUrl: member.avatarUrl ?? null,
      role: member.role,
      joinedAt: member.joinedAt,
      email: member.email ?? null,
      gravatarHash: member.gravatarHash ?? null
    })));
  });

  app.get("/api/servers/:serverId/machines", (req, res) => {
    if (!requireWorkspaceServerAccess(authUser(req).id, req.params.serverId, res)) return;
    const machines = store.listMachines(req.params.serverId).map((machine) => ({
      machine,
      runtimes: store.listRuntimeReports(machine.id)
    }));
    res.json(formatMachineListResponse(machines));
  });

  app.get("/api/servers/:serverId/members/:userId/profile", (req, res) => {
    const actor = authUser(req);
    const actorServer = store.listServersForUser(actor.id).find((serverRecord) => serverRecord.id === req.params.serverId);
    if (!actorServer) {
      res.status(403).json({ error: "server_membership_required" });
      return;
    }
    const member = store.listServerMembers(req.params.serverId).find((item) => item.id === req.params.userId || item.id.startsWith(req.params.userId));
    const hasWorkspaceAccess = actorServer.role === "owner" || actorServer.role === "member";
    const canReadBasicProfile = hasWorkspaceAccess || member?.id === actor.id || member?.role === "owner";
    if (!member || !canReadBasicProfile) {
      res.status(404).json({ error: "member_not_found" });
      return;
    }
    const createdAgents = hasWorkspaceAccess ? store.listAgents(req.params.serverId)
      .filter((agent) => agent.ownerUserId === member.id && !isCommunicationAgent(agent))
      .map((agent) => ({
        id: agent.id,
        ownerUserId: agent.ownerUserId,
        machineId: agent.machineId,
        name: agent.name,
        displayName: agent.displayName,
        avatarUrl: agent.name.toLowerCase().includes("cursor") ? "pixel:cat" : agent.name.toLowerCase().includes("2") ? "pixel:crown" : "pixel:heart",
        runtime: agent.runtime,
        status: agent.status
      })) : [];
    res.json({
      userId: member.id,
      name: member.name,
      displayName: member.displayName,
      description: member.description ?? null,
      avatarUrl: member.avatarUrl ?? null,
      email: member.email ?? null,
      gravatarHash: member.gravatarHash ?? gravatarHash(member.email),
      role: member.role,
      joinedAt: member.joinedAt,
      membershipStatus: "active",
      createdAgents
    });
  });

  app.delete("/api/servers/:serverId/members/:userId", (req, res) => {
    const actor = authUser(req);
    if (!isServerOwner(actor.id, req.params.serverId)) {
      res.status(403).json({ error: "owner_required" });
      return;
    }
    if (req.params.userId === actor.id) {
      res.status(400).json({ error: "cannot_remove_self" });
      return;
    }
    const result = store.removeServerMember(req.params.userId, req.params.serverId);
    if (!result.ok) {
      res.status(result.error === "member_not_found" ? 404 : 400).json({ error: result.error ?? "remove_failed" });
      return;
    }
    publishWorkspaceSync();
    res.json({ ok: true });
  });

  app.get("/api/servers/:serverId/join-links", (_req, res) => {
    res.json([]);
  });

  app.get("/api/messages", (req, res) => {
    const user = authUser(req);
    const channelId = req.query.channel_id as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    if (channelId && !store.canUserAccessChannel(user.id, channelId)) {
      recordDeniedChannelAccess(user.id, channelId);
      res.status(404).json({ error: "channel_not_found" });
      return;
    }
    res.json({ messages: store.listMessages(channelId, limit).filter((message) => store.canUserAccessChannel(user.id, message.channelId)).map(formatPublicMessage) });
  });

  app.get("/api/unread-summary", (req, res) => {
    const user = authUser(req);
    const visibleChannelIds = store.listVisibleChannelIds(user.id);
    const unreadCount = Object.entries(store.listUnreadCounts(user.id))
      .filter(([channelId]) => visibleChannelIds.includes(channelId))
      .reduce((sum, [, count]) => sum + count, 0);
    res.json([{ serverId: "local", unreadCount }]);
  });

  app.get("/api/servers/unread-summary", (req, res) => {
    const user = authUser(req);
    const visibleChannelIds = store.listVisibleChannelIds(user.id);
    const unreadCount = Object.entries(store.listUnreadCounts(user.id))
      .filter(([channelId]) => visibleChannelIds.includes(channelId))
      .reduce((sum, [, count]) => sum + count, 0);
    res.json([{ serverId: "local", unreadCount }]);
  });

  app.get("/api/threads", (_req, res) => {
    res.json({ threads: [] });
  });

  app.get("/api/tasks/server", (_req, res) => {
    res.status(410).json({ error: "task_workflow_retired" });
  });

  app.get("/api/tasks/channel/:channelId", (_req, res) => {
    res.status(410).json({ error: "task_workflow_retired" });
  });

  app.get("/api/inbox", (req, res) => {
    res.json(listInboxItems(30, 0, authUser(req).id));
  });

  app.post("/api/read", (_req, res) => {
    res.json({ ok: true });
  });
}

function pagedMessageLimit(value: unknown): number {
  const parsed = optionalPositiveInt(value);
  return Math.max(1, Math.min(parsed ?? 50, 100));
}

function optionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function countChannelMessagesBefore(store: ServerRouteContext["store"], channelId: string, seq: number, conversationId?: string): number {
  if (conversationId) {
    return Number(store.db.prepare("select count(*) from messages where channel_id = ? and conversation_id = ? and kind = 'chat' and seq < ?").pluck().get(channelId, conversationId, seq) ?? 0);
  }
  return Number(store.db.prepare("select count(*) from messages where channel_id = ? and kind = 'chat' and seq < ?").pluck().get(channelId, seq) ?? 0);
}

function countChannelMessagesAfter(store: ServerRouteContext["store"], channelId: string, seq: number, conversationId?: string): number {
  if (conversationId) {
    return Number(store.db.prepare("select count(*) from messages where channel_id = ? and conversation_id = ? and kind = 'chat' and seq > ?").pluck().get(channelId, conversationId, seq) ?? 0);
  }
  return Number(store.db.prepare("select count(*) from messages where channel_id = ? and kind = 'chat' and seq > ?").pluck().get(channelId, seq) ?? 0);
}
