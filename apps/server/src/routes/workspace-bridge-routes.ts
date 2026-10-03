import { randomUUID } from "node:crypto";
import type express from "express";
import type {
  ChannelRecord,
  ConversationRecord,
  WorkspaceBridgeConversationRecord,
  WorkspaceBridgeRecord
} from "@tyr-ai/contracts";
import { sanitizeHumanVisibleValue } from "../output-disclosure";
import { BridgeConnectionError, WorkspaceBridgeConnectionService } from "../workspace-bridge-connection-intent";
import { visibleBridgeTrace } from "../bridge-trace-audit";
import { workspaceBridgeLocalExecutionLog } from "../workspace-bridge-local-log";
import {
  listBridgeContinuationAttempts,
  listBridgeContinuationSteps,
  retryInterruptedBridgeContinuationWithoutWrites
} from "../bridge-continuation-journal";
import type { ServerRouteContext } from "../server-context";
import {
  WorkspaceBridgeRequestError,
  WorkspaceBridgeRequestService
} from "../workspace-bridge-request-service";

export function registerWorkspaceBridgeRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const { store, authUser, publishWorkspaceSync } = ctx;
  const bridgeService = new WorkspaceBridgeRequestService(ctx);
  const connectionService = new WorkspaceBridgeConnectionService(store, ctx.publicServerUrl);

  function connectionFailure(res: express.Response, error: unknown): void {
    const known = error instanceof BridgeConnectionError ? error : new BridgeConnectionError("workspace_bridge_invite_failed", 500);
    res.status(known.status).json({ error: known.code });
  }

  function requireWorkspaceUser(req: express.Request, res: express.Response): ReturnType<typeof authUser> | null {
    const user = authUser(req);
    const membership = store.listServersForUser(user.id).find((server) => server.id === String(req.params.serverId));
    if (!membership) {
      // Bridge 路由按 Workspace 成员关系 fail closed，避免只凭 serverId/bridgeId 读取连接历史。
      res.status(404).json({ error: "workspace_not_found" });
      return null;
    }
    if (membership.role === "guest") {
      // Guest 不进入 Bridge 控制面；共享本地资源不能被提升为跨 Workspace 路由权限。
      res.status(403).json({ error: "workspace_bridge_member_required" });
      return null;
    }
    return user;
  }

  function bridgeSessionChannel(bridge: WorkspaceBridgeRecord, sourceWorkspaceId: string): ChannelRecord | null {
    const targetWorkspaceId = sourceWorkspaceId === bridge.workspaceAId ? bridge.workspaceBId : bridge.workspaceAId;
    return bridge.status === "active"
      ? store.getOrCreateWorkspaceBridgeDm(bridge.id, targetWorkspaceId)
      : store.getWorkspaceBridgeDm(bridge.id, targetWorkspaceId);
  }

  function bridgeConversation(
    bridge: WorkspaceBridgeRecord,
    sourceWorkspaceId: string,
    conversationId?: string
  ): { channel: ChannelRecord; conversation: ConversationRecord } | null {
    const channel = bridgeSessionChannel(bridge, sourceWorkspaceId);
    if (!channel) return null;
    const conversation = conversationId ? store.getConversation(conversationId) : store.getActiveConversation(channel.id);
    return conversation?.channelId === channel.id ? { channel, conversation } : null;
  }

  function visibleBridgeConversation(
    bridge: WorkspaceBridgeRecord,
    workspaceId: string,
    conversationId?: string
  ): { channel: ChannelRecord; conversation: ConversationRecord; direction: "outgoing" | "incoming" } | null {
    const outgoing = bridgeSessionChannel(bridge, workspaceId);
    const incoming = bridge.status === "active"
      ? store.getOrCreateWorkspaceBridgeDm(bridge.id, workspaceId)
      : store.getWorkspaceBridgeDm(bridge.id, workspaceId);
    const conversation = conversationId ? store.getConversation(conversationId) : outgoing ? store.getActiveConversation(outgoing.id) : null;
    if (!conversation) return null;
    if (outgoing && conversation.channelId === outgoing.id) return { channel: outgoing, conversation, direction: "outgoing" };
    if (incoming && conversation.channelId === incoming.id) return { channel: incoming, conversation, direction: "incoming" };
    return null;
  }

  function bridgeConversationView(
    conversation: ConversationRecord,
    bridge: WorkspaceBridgeRecord,
    workspaceId: string,
    direction: "outgoing" | "incoming"
  ): WorkspaceBridgeConversationRecord {
    const peerWorkspaceId = workspaceId === bridge.workspaceAId ? bridge.workspaceBId : bridge.workspaceAId;
    return {
      ...conversation,
      sourceWorkspaceId: direction === "outgoing" ? workspaceId : peerWorkspaceId,
      targetWorkspaceId: direction === "outgoing" ? peerWorkspaceId : workspaceId,
      direction,
      writable: direction === "outgoing" && bridge.status === "active"
    };
  }

  function bridgeConversationTitle(value: unknown): { title?: string; error?: string } {
    const title = typeof value === "string" ? value.trim() : "";
    if (!title) return { error: "conversation_title_required" };
    if (Array.from(title).length > 72) return { error: "conversation_title_too_long" };
    return { title };
  }

  app.get("/api/workspace-bridges/incoming", (req, res) => {
    const user = authUser(req);
    res.json({ bridges: store.listIncomingWorkspaceBridges(user.id) });
  });

  app.get("/api/workspace-bridge-invites/:code", (req, res) => {
    const user = authUser(req);
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json({ intent: connectionService.getByCode(req.params.code, user.id) });
    } catch (error) { connectionFailure(res, error); }
  });

  app.post("/api/workspace-bridge-invites/:code/claim", (req, res) => {
    const user = authUser(req);
    const targetWorkspaceId = typeof req.body?.targetWorkspaceId === "string" ? req.body.targetWorkspaceId.trim() : "";
    if (!targetWorkspaceId) return void res.status(400).json({ error: "target_workspace_required" });
    try {
      const intent = connectionService.claim(req.params.code, targetWorkspaceId, user.id);
      publishWorkspaceSync();
      res.json({ ok: true, intent });
      if (intent.invitationKind === "email") void ctx.workspaceBridgeEmailInvitations?.notifyAcceptance(intent.id).catch(() => undefined);
    } catch (error) { connectionFailure(res, error); }
  });

  app.get("/api/servers/:serverId/workspace-bridge-invites", (req, res) => {
    const user = requireWorkspaceUser(req, res);
    if (!user) return;
    try { res.json({ intents: connectionService.list(req.params.serverId, user.id) }); }
    catch (error) { connectionFailure(res, error); }
  });

  app.post("/api/servers/:serverId/workspace-bridge-invites", (req, res) => {
    const user = requireWorkspaceUser(req, res);
    if (!user) return;
    res.setHeader("Cache-Control", "no-store");
    try { res.json({ intent: connectionService.create(req.params.serverId, user.id) }); }
    catch (error) { connectionFailure(res, error); }
  });

  app.post("/api/servers/:serverId/workspace-bridge-invites/:intentId/confirm", (req, res) => {
    const user = requireWorkspaceUser(req, res);
    if (!user) return;
    try {
      const result = connectionService.confirm(req.params.intentId, req.params.serverId, user.id);
      publishWorkspaceSync();
      res.json({ ok: true, ...result });
    } catch (error) { connectionFailure(res, error); }
  });

  app.post("/api/servers/:serverId/workspace-bridge-invites/:intentId/cancel", (req, res) => {
    const user = requireWorkspaceUser(req, res);
    if (!user) return;
    try {
      const intent = connectionService.cancel(req.params.intentId, req.params.serverId, user.id);
      publishWorkspaceSync();
      res.json({ ok: true, intent });
    } catch (error) { connectionFailure(res, error); }
  });

  app.post("/api/workspace-bridges/:bridgeId/accept", (req, res) => {
    const user = authUser(req);
    const bridge = store.acceptWorkspaceBridge(req.params.bridgeId, user.id);
    if (!bridge) {
      res.status(404).json({ error: "workspace_bridge_not_found" });
      return;
    }
    publishWorkspaceSync();
    res.json({ ok: true, bridge, bootstrap: store.workspaceBootstrap(user.id) });
  });

  app.get("/api/servers/:serverId/workspace-bridges", (req, res) => {
    if (!requireWorkspaceUser(req, res)) return;
    res.json({ bridges: store.listWorkspaceBridges(req.params.serverId) });
  });

  app.get("/api/servers/:serverId/workspace-bridge-traces/:traceId", (req, res) => {
    const user = requireWorkspaceUser(req, res);
    if (!user) return;
    const traceId = String(req.params.traceId || "").trim();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(traceId)) {
      res.status(400).json({ error: "workspace_bridge_trace_id_invalid" });
      return;
    }
    const hops = visibleBridgeTrace(store, req.params.serverId, traceId);
    if (!hops.length) {
      res.status(404).json({ error: "workspace_bridge_trace_not_found" });
      return;
    }
    res.json({ traceId, hops });
  });

  app.post("/api/servers/:serverId/workspace-bridges", (req, res) => {
    const user = requireWorkspaceUser(req, res);
    if (!user) return;
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    if (!email) {
      res.status(400).json({ error: "email_required" });
      return;
    }
    try {
      const bridge = store.createWorkspaceBridge({
        sourceWorkspaceId: req.params.serverId,
        invitedByUserId: user.id,
        targetUserEmail: email
      });
      publishWorkspaceSync();
      res.json({ ok: true, bridge, bootstrap: store.workspaceBootstrap(user.id) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "workspace_bridge_create_failed" });
    }
  });

  app.post("/api/servers/:serverId/workspace-bridges/:bridgeId/revoke", (req, res) => {
    const user = authUser(req);
    const membership = store.listServersForUser(user.id).find((server) => server.id === req.params.serverId);
    const audit = {
      actorType: "user" as const,
      actorId: user.id,
      resourceType: "workspace_bridge" as const,
      resourceId: req.params.bridgeId,
      serverId: membership?.id ?? null
    };
    const requestId = res.getHeader("x-request-id") ?? null;
    // 必须是 URL 对应 Workspace 的 Owner；不能借用同一账号在其他 Workspace 的 Owner 身份。
    const permissionError = !membership ? "workspace_not_found"
      : membership.role === "guest" ? "workspace_bridge_member_required"
      : membership.role !== "owner" ? "workspace_bridge_owner_required"
      : null;
    if (permissionError) {
      store.recordAuditEvent({ ...audit, kind: "workspace_bridge_revoke_denied", metadata: { reason: permissionError, requestId } });
      res.status(membership ? 403 : 404).json({ error: permissionError });
      return;
    }
    const existing = store.getWorkspaceBridgeForServer(req.params.bridgeId, req.params.serverId);
    if (!existing) {
      store.recordAuditEvent({ ...audit, kind: "workspace_bridge_revoke_denied", metadata: { reason: "workspace_bridge_not_found", requestId } });
      res.status(404).json({ error: "workspace_bridge_not_found" });
      return;
    }
    // 状态与成功审计原子提交；仅记录身份、连接和状态，不写入会话正文或凭据。
    const bridge = store.db.transaction(() => {
      const revoked = store.revokeWorkspaceBridge(existing.id, user.id);
      if (!revoked) throw new Error("workspace_bridge_revoke_failed");
      store.recordAuditEvent({
        ...audit,
        kind: "workspace_bridge_revoked",
        metadata: { requestId, workspaceAId: existing.workspaceAId, workspaceBId: existing.workspaceBId, previousStatus: existing.status, status: revoked.status }
      });
      return revoked;
    })();
    publishWorkspaceSync();
    res.json({ ok: true, bridge, bootstrap: store.workspaceBootstrap(user.id) });
  });

  app.get("/api/servers/:serverId/workspace-bridges/:bridgeId/continuations/:requestId", (req, res) => {
    const user = requireWorkspaceUser(req, res);
    if (!user) return;
    const bridge = store.getWorkspaceBridgeForServer(req.params.bridgeId, req.params.serverId);
    const request = store.getCrossWorkspaceMessage(req.params.requestId);
    if (!bridge || !request || request.bridgeId !== bridge.id || request.sourceWorkspaceId !== req.params.serverId) {
      res.status(404).json({ error: "workspace_bridge_request_not_found" });
      return;
    }
    const attempts = listBridgeContinuationAttempts(store, request.id).map((attempt) => ({
      ...attempt,
      steps: listBridgeContinuationSteps(store, attempt.id).map((step) => ({
        sequence: step.sequence,
        toolName: step.toolName,
        state: step.state,
        receipt: step.receipt,
        startedAt: step.startedAt,
        completedAt: step.completedAt
      }))
    }));
    res.json({ requestId: request.id, traceId: request.traceId, continuationState: request.continuationState, attempts });
  });

  app.post("/api/servers/:serverId/workspace-bridges/:bridgeId/continuations/:requestId/retry", (req, res) => {
    const user = requireWorkspaceUser(req, res);
    if (!user) return;
    const membership = store.listServersForUser(user.id).find((server) => server.id === req.params.serverId);
    if (membership?.role !== "owner") {
      res.status(403).json({ error: "workspace_bridge_owner_required" });
      return;
    }
    const bridge = store.getWorkspaceBridgeForServer(req.params.bridgeId, req.params.serverId);
    const request = store.getCrossWorkspaceMessage(req.params.requestId);
    if (!bridge || bridge.status !== "active" || !request || request.bridgeId !== bridge.id ||
        request.sourceWorkspaceId !== req.params.serverId) {
      res.status(404).json({ error: "workspace_bridge_request_not_found" });
      return;
    }
    // A started write may have reached an external system. This endpoint only retries attempts
    // whose journal proves no write step was dispatched; other cases need a new Human request.
    if (!retryInterruptedBridgeContinuationWithoutWrites(store, request.id)) {
      res.status(409).json({ error: "bridge_continuation_retry_not_proven_safe" });
      return;
    }
    store.recordAuditEvent({
      kind: "workspace_bridge_continuation_manual_retry",
      actorType: "user", actorId: user.id,
      resourceType: "workspace_bridge", resourceId: bridge.id, serverId: req.params.serverId,
      metadata: { requestId: request.id, traceId: request.traceId ?? null }
    });
    ctx.scheduleAssistantBridgeContinuation?.(request.id);
    res.json({ ok: true, requestId: request.id, continuationState: "pending" });
  });

  app.get("/api/servers/:serverId/workspace-bridges/:bridgeId/conversations", (req, res) => {
    if (!requireWorkspaceUser(req, res)) return;
    const bridge = store.getWorkspaceBridgeForServer(req.params.bridgeId, req.params.serverId);
    const session = bridge ? bridgeSessionChannel(bridge, req.params.serverId) : null;
    if (!bridge || !session) {
      res.status(404).json({ error: "workspace_bridge_not_found" });
      return;
    }
    const incomingSession = bridge.status === "active"
      ? store.getOrCreateWorkspaceBridgeDm(bridge.id, req.params.serverId)
      : store.getWorkspaceBridgeDm(bridge.id, req.params.serverId);
    const includeArchived = req.query.includeArchived === "1";
    const conversations = [
      ...store.listConversations(session.id, { includeArchived }).map((conversation) => (
        bridgeConversationView(conversation, bridge, req.params.serverId, "outgoing")
      )),
      ...(incomingSession && incomingSession.id !== session.id
        ? store.listConversations(incomingSession.id, { includeArchived })
          // Endpoint DMs are provisioned at acceptance; an empty peer-owned seed conversation is not yet Incoming activity.
          .filter((conversation) => store.listCrossWorkspaceMessages(bridge.id, { conversationId: conversation.id }).length > 0)
          .map((conversation) => bridgeConversationView(conversation, bridge, req.params.serverId, "incoming"))
        : [])
    ].sort((left, right) => (
      (right.lastMessageAt ?? right.startedAt).localeCompare(left.lastMessageAt ?? left.startedAt)
    ));
    res.json({
      conversations,
      activeConversationId: store.getActiveConversation(session.id)?.id ?? null
    });
  });

  app.post("/api/servers/:serverId/workspace-bridges/:bridgeId/conversations", (req, res) => {
    const user = requireWorkspaceUser(req, res);
    if (!user) return;
    const bridge = store.getWorkspaceBridgeForServer(req.params.bridgeId, req.params.serverId);
    const session = bridge?.status === "active" ? bridgeSessionChannel(bridge, req.params.serverId) : null;
    if (!bridge || !session) {
      res.status(404).json({ error: "workspace_bridge_not_active" });
      return;
    }
    const title = typeof req.body?.title === "string" && req.body.title.trim()
      ? req.body.title.trim().slice(0, 72)
      : undefined;
    const conversation = store.createConversation({
      channelId: session.id,
      title,
      startedByType: "human",
      startedById: user.id,
      resetStatus: "not_applicable"
    });
    res.json({ conversation, activeConversationId: conversation.id });
  });

  app.patch("/api/servers/:serverId/workspace-bridges/:bridgeId/conversations/:conversationId", (req, res) => {
    if (!requireWorkspaceUser(req, res)) return;
    const bridge = store.getWorkspaceBridgeForServer(req.params.bridgeId, req.params.serverId);
    const scoped = bridge ? bridgeConversation(bridge, req.params.serverId, req.params.conversationId) : null;
    if (!bridge || !scoped) {
      res.status(404).json({ error: "conversation_not_found" });
      return;
    }
    const parsed = bridgeConversationTitle(req.body?.title);
    if (!parsed.title) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const conversation = store.renameConversation(scoped.conversation.id, parsed.title);
    if (!conversation) {
      res.status(400).json({ error: "conversation_rename_failed" });
      return;
    }
    res.json({ conversation });
  });

  app.post("/api/servers/:serverId/workspace-bridges/:bridgeId/conversations/:conversationId/archive", (req, res) => {
    const user = requireWorkspaceUser(req, res);
    if (!user) return;
    const bridge = store.getWorkspaceBridgeForServer(req.params.bridgeId, req.params.serverId);
    const scoped = bridge ? bridgeConversation(bridge, req.params.serverId, req.params.conversationId) : null;
    if (!bridge || !scoped) {
      res.status(404).json({ error: "conversation_not_found" });
      return;
    }
    if (scoped.conversation.status === "active" && bridge.status !== "active") {
      res.status(400).json({ error: "workspace_bridge_not_active" });
      return;
    }
    // 与 Agent DM 一致：归档当前会话时先建立替代 active 会话，保持 Bridge 有且只有一个可发送上下文。
    const replacementConversation = scoped.conversation.status === "active"
      ? store.createConversation({
        channelId: scoped.channel.id,
        startedByType: "human",
        startedById: user.id,
        resetStatus: "not_applicable"
      })
      : null;
    const conversation = store.archiveConversation(scoped.conversation.id, user.id);
    if (!conversation) {
      res.status(400).json({ error: "conversation_archive_failed" });
      return;
    }
    res.json({ conversation, replacementConversation, activeConversationId: replacementConversation?.id ?? store.getActiveConversation(scoped.channel.id)?.id ?? null });
  });

  app.post("/api/servers/:serverId/workspace-bridges/:bridgeId/conversations/:conversationId/unarchive", (req, res) => {
    if (!requireWorkspaceUser(req, res)) return;
    const bridge = store.getWorkspaceBridgeForServer(req.params.bridgeId, req.params.serverId);
    const scoped = bridge ? bridgeConversation(bridge, req.params.serverId, req.params.conversationId) : null;
    if (!bridge || !scoped) {
      res.status(404).json({ error: "conversation_not_found" });
      return;
    }
    const conversation = store.unarchiveConversation(scoped.conversation.id);
    if (!conversation) {
      res.status(400).json({ error: "conversation_unarchive_failed" });
      return;
    }
    res.json({ conversation });
  });

  app.delete("/api/servers/:serverId/workspace-bridges/:bridgeId/conversations/:conversationId", (req, res) => {
    if (!requireWorkspaceUser(req, res)) return;
    const bridge = store.getWorkspaceBridgeForServer(req.params.bridgeId, req.params.serverId);
    const scoped = bridge ? bridgeConversation(bridge, req.params.serverId, req.params.conversationId) : null;
    if (!bridge || !scoped) {
      res.status(404).json({ error: "conversation_not_found" });
      return;
    }
    const deleted = store.deleteConversation(scoped.conversation.id);
    if (!deleted.success) {
      res.status(400).json({ error: deleted.reason ?? "conversation_delete_failed" });
      return;
    }
    res.json({ ok: true, conversation: deleted.conversation });
  });

  app.get("/api/servers/:serverId/workspace-bridges/:bridgeId/messages", (req, res) => {
    if (!requireWorkspaceUser(req, res)) return;
    const bridge = store.getWorkspaceBridgeForServer(req.params.bridgeId, req.params.serverId);
    const conversationId = typeof req.query.conversationId === "string" ? req.query.conversationId.trim() : "";
    const scoped = bridge ? visibleBridgeConversation(bridge, req.params.serverId, conversationId || undefined) : null;
    if (!bridge || !scoped) {
      res.status(404).json({ error: "workspace_bridge_conversation_not_found" });
      return;
    }
    res.json(sanitizeHumanVisibleValue(store.listCrossWorkspaceMessagesPage(bridge.id, {
      limit: workspaceBridgeMessageLimit(req.query.limit),
      beforeCreatedAt: workspaceBridgeBeforeCursor(req.query.before),
      conversationId: scoped.conversation.id
    })));
  });

  app.get("/api/servers/:serverId/workspace-bridges/:bridgeId/requests/:requestId/status", (req, res) => {
    const user = requireWorkspaceUser(req, res);
    if (!user) return;
    const request = store.getCrossWorkspaceMessage(req.params.requestId);
    const bridge = store.getWorkspaceBridgeForServer(req.params.bridgeId, req.params.serverId);
    const scoped = bridge && request?.conversationId
      ? visibleBridgeConversation(bridge, req.params.serverId, request.conversationId)
      : null;
    if (request?.bridgeId !== req.params.bridgeId || !scoped) {
      res.status(404).json({ error: "workspace_bridge_request_not_found" });
      return;
    }
    try {
      const actor = { userId: user.id, serverId: req.params.serverId, source: "web" as const };
      const status = scoped.direction === "incoming"
        ? bridgeService.statusForIncomingWeb(actor, request.id)
        : bridgeService.status(actor, request.id);
      res.json(sanitizeHumanVisibleValue(status));
    } catch (error) {
      res.status(404).json({ error: error instanceof WorkspaceBridgeRequestError ? error.code : "workspace_bridge_request_not_found" });
    }
  });

  app.get("/api/servers/:serverId/workspace-bridges/:bridgeId/requests/:requestId/local-execution-log", (req, res) => {
    const user = authUser(req);
    res.setHeader("Cache-Control", "no-store");
    const log = workspaceBridgeLocalExecutionLog(store, {
      userId: user.id, serverId: req.params.serverId, bridgeId: req.params.bridgeId, requestId: req.params.requestId,
      limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
      offset: req.query.offset === undefined ? undefined : Number(req.query.offset)
    });
    if (!log) return void res.status(404).json({ error: "workspace_bridge_local_log_not_found" });
    res.json(log);
  });

  app.post("/api/servers/:serverId/workspace-bridges/:bridgeId/requests/:requestId/resolve", (req, res) => {
    const user = requireWorkspaceUser(req, res);
    if (!user) return;
    const terminalId = typeof req.body?.terminalId === "string" ? req.body.terminalId.trim() : "";
    if (!terminalId) {
      res.status(400).json({ error: "workspace_bridge_resolution_invalid" });
      return;
    }
    try {
      const status = bridgeService.resolveWithFollowup({
        userId: user.id, serverId: req.params.serverId, source: "web"
      }, {
        bridgeId: req.params.bridgeId,
        requestId: req.params.requestId,
        terminalId
      });
      res.json(sanitizeHumanVisibleValue(status));
    } catch (error) {
      const code = error instanceof WorkspaceBridgeRequestError ? error.code : "workspace_bridge_resolution_invalid";
      res.status(code === "workspace_bridge_request_still_running" || code === "workspace_bridge_resolution_conflict" ? 409 : 400)
        .json({ error: code });
    }
  });

  app.post("/api/servers/:serverId/workspace-bridges/:bridgeId/messages", async (req, res) => {
    const user = requireWorkspaceUser(req, res);
    if (!user) return;
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    const clientRequestId = typeof req.body?.clientRequestId === "string" ? req.body.clientRequestId.trim() : "";
    const retryOfMessageId = typeof req.body?.retryOfMessageId === "string" ? req.body.retryOfMessageId.trim() : "";
    const replyToRequestId = typeof req.body?.replyToRequestId === "string" ? req.body.replyToRequestId.trim() : "";
    const attachmentIds = Array.isArray(req.body?.attachmentIds)
      ? req.body.attachmentIds.map(String).filter((attachmentId: string) => {
        const attachment = store.getAttachment(attachmentId);
        return Boolean(attachment && store.canUserAccessChannel(user.id, attachment.channelId));
      })
      : [];
    const conversationId = typeof req.body?.conversationId === "string" ? req.body.conversationId.trim() : "";
    const bridge = store.getWorkspaceBridgeForServer(req.params.bridgeId, req.params.serverId);
    const active = bridge ? bridgeConversation(bridge, req.params.serverId, conversationId || undefined) : null;
    if (bridge?.status === "active" && !active) {
      res.status(400).json({ error: "workspace_bridge_conversation_not_active" });
      return;
    }
    try {
      if (replyToRequestId) {
        const original = store.getCrossWorkspaceMessage(replyToRequestId);
        if (!original || original.responseKind || original.bridgeId !== req.params.bridgeId ||
            original.conversationId !== active?.conversation.id || original.sourceWorkspaceId !== req.params.serverId ||
            original.sourceCapabilityUserId !== user.id || retryOfMessageId || attachmentIds.length || req.body?.newRequest === true) {
          res.status(400).json({ error: "invalid_workspace_bridge_followup" });
          return;
        }
        const current = bridgeService.status({ userId: user.id, serverId: req.params.serverId, source: "web" }, original.id);
        const existing = store.listCrossWorkspaceMessages(original.bridgeId, { conversationId: original.conversationId! })
          .find((message) => message.replyToMessageId === original.id && message.interactionEventId === clientRequestId);
        if (existing && ["answer", "instruction"].includes(existing.responseKind ?? "") && existing.content === content.trim()) {
          // A lost receipt remains recoverable even if the request completed before the retry.
          res.status(202).json(sanitizeHumanVisibleValue({ ok: true, message: existing, status: current }));
          return;
        }
        if (current.state === "completed" || current.state === "failed") {
          res.status(409).json({ error: "workspace_bridge_request_completed", status: current });
          return;
        }
        const kind = existing?.responseKind === "answer" || existing?.responseKind === "instruction"
          ? existing.responseKind : current.interactions?.at(-1)?.kind === "question" ? "answer" : "instruction";
        const result = await bridgeService.followup({ userId: user.id, serverId: req.params.serverId, source: "web" }, {
          requestId: original.id, bridgeId: original.bridgeId, eventId: clientRequestId, kind, content,
          originChannelId: original.originChannelId, originConversationId: original.originConversationId,
          awaitingAgentId: original.awaitingAgentId ?? null
        });
        res.status(202).json(sanitizeHumanVisibleValue({ ok: true, message: result.event, status: result.status }));
        return;
      }
      if (!retryOfMessageId && req.body?.newRequest !== true && active &&
          store.listCrossWorkspaceMessages(req.params.bridgeId, { conversationId: active.conversation.id })
            .some((message) => !message.responseKind && message.sourceWorkspaceId === req.params.serverId) &&
          !store.getCrossWorkspaceMessageByClientRequest({ bridgeId: req.params.bridgeId, conversationId: active.conversation.id,
            sourceWorkspaceId: req.params.serverId, clientRequestId })) {
        res.status(409).json({ error: "workspace_bridge_request_selection_required" });
        return;
      }
      const result = await bridgeService.send({
        userId: user.id,
        serverId: req.params.serverId,
        source: "web"
      }, {
        bridgeId: req.params.bridgeId,
        content,
        attachmentIds,
        // The Bridge UI owns its selected active conversation; MCP/Assistant callers get isolated conversations.
        ...(active?.conversation.id ? { conversationId: active.conversation.id } : {}),
        ...(retryOfMessageId ? { retryOfMessageId } : {}),
        idempotencyKey: clientRequestId || `web_${randomUUID().replaceAll("-", "")}`
      });
      // HTTP only confirms persistence; peer processing continues through Bridge realtime/status.
      res.status(202).json(sanitizeHumanVisibleValue({
        ok: true,
        message: result.request,
        conversation: result.conversation
      }));
    } catch (error) {
      const code = error instanceof WorkspaceBridgeRequestError
        ? error.code
        : "workspace_bridge_send_failed";
      const status = code === "workspace_bridge_member_required"
        ? 403
        : code === "workspace_bridge_not_active" || code === "workspace_bridge_not_found"
          ? 404
          : 400;
      res.status(status).json({ error: code });
    }
  });
}

function workspaceBridgeMessageLimit(value: unknown): number {
  if (typeof value !== "string") return 30;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.min(Math.floor(parsed), 100)) : 30;
}

function workspaceBridgeBeforeCursor(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
