import { randomUUID } from "node:crypto";
import { recordBridgeRouteClarification } from "./bridge-route-clarifications";
import { recordBridgeFollowupDependency } from "./bridge-followup-dependencies";
import { workspaceBridgeProgress } from "./workspace-bridge-progress";
import type {
  ChannelRecord,
  ConversationRecord,
  CommunicationEvidenceSelection,
  CrossWorkspaceMessageRecord,
  WorkspaceBridgeRecord,
  WorkspaceBridgeRequestState,
  WorkspaceBridgeRequestStatusPayload
} from "@tyr-ai/contracts";
import { enqueueCrossWorkspaceBridgeFollowupDelivery, enqueueCrossWorkspaceBridgeMessageDelivery } from "./workspace-bridge-delivery";
import type { ServerRouteContext } from "./server-context";
import { getCommunicationEvidenceForBridgeMessage, publishCommunicationEvidenceForBridgeMessage, selectCommunicationEvidenceForContext } from "./communication-evidence";

interface WorkspaceBridgeEvidenceInput {
  evidenceSelections?: CommunicationEvidenceSelection[];
  evidenceScope?: { serverId: string; sourceMessageId: string; channelId: string; conversationId: string | null };
}

export interface WorkspaceBridgeServiceActor {
  // userId 是当前 Workspace 的能力账号；Bridge 转发时它与真实发送者可以不同。
  userId: string;
  serverId: string;
  source: "web" | "telegram" | "email" | "mcp";
  clientId?: string;
  grantId?: string;
  requestingUserId?: string;
  requestingUserName?: string;
  requestingUserDisplayName?: string;
  requestingUserAvatarUrl?: string | null;
  bridgeTraceId?: string;
  parentBridgeRequestId?: string;
}

export interface WorkspaceBridgeRequestOrigin {
  conversationKey?: string;
  channelId?: string;
  conversationId?: string;
  messageId?: string;
  source?: "web" | "telegram" | "email" | "mcp";
  externalRef?: string;
  awaitingAgentId?: string;
}

export interface WorkspaceBridgeSummary {
  id: string;
  peerWorkspaceName: string;
  peerAssistantName: string;
  status: WorkspaceBridgeRecord["status"];
  direction: WorkspaceBridgeRecord["direction"];
  permissions: string[];
  connectedAt: string | null;
  lastActivityAt: string | null;
}

export interface WorkspaceBridgeCurrentWorkspace {
  id: string;
  name: string;
}

export interface WorkspaceBridgeHistoryItem {
  id: string;
  bridgeRequestId: string | null;
  direction: "outbound" | "inbound";
  kind: "request" | NonNullable<CrossWorkspaceMessageRecord["responseKind"]>;
  content: string;
  outcome: CrossWorkspaceMessageRecord["outcome"];
  createdAt: string;
}

export interface WorkspaceBridgeSendResult {
  request: CrossWorkspaceMessageRecord;
  conversation: ConversationRecord;
  status: WorkspaceBridgeRequestStatusPayload;
}

export class WorkspaceBridgeRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function messageTimestamp(message: CrossWorkspaceMessageRecord): number {
  const parsed = Date.parse(message.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requestTitle(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 72) || "New conversation";
}

function externalRefRequestId(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed.kind === "workspace_bridge" && typeof parsed.requestMessageId === "string"
      ? parsed.requestMessageId
      : null;
  } catch {
    return null;
  }
}

export class WorkspaceBridgeRequestService {
  constructor(readonly ctx: ServerRouteContext) {}

  private membership(actor: WorkspaceBridgeServiceActor) {
    return this.ctx.store.listServersForUser(actor.userId).find((server) => server.id === actor.serverId) ?? null;
  }

  private requireMember(actor: WorkspaceBridgeServiceActor) {
    const membership = this.membership(actor);
    // Cross-workspace MCP control is intentionally unavailable to guests even when they can see a shared local resource.
    if (!membership || membership.role === "guest") throw new WorkspaceBridgeRequestError("workspace_bridge_member_required");
    return membership;
  }

  private requireBridge(actor: WorkspaceBridgeServiceActor, bridgeId: string, active = false): WorkspaceBridgeRecord {
    this.requireMember(actor);
    const bridge = this.ctx.store.getWorkspaceBridgeForServer(bridgeId, actor.serverId);
    if (!bridge || (active && bridge.status !== "active")) {
      throw new WorkspaceBridgeRequestError(active ? "workspace_bridge_not_active" : "workspace_bridge_not_found");
    }
    return bridge;
  }

  private bridgeProvenance(actor: WorkspaceBridgeServiceActor, bridge: WorkspaceBridgeRecord) {
    const parent = actor.parentBridgeRequestId
      ? this.ctx.store.getCrossWorkspaceMessage(actor.parentBridgeRequestId)
      : null;
    if (actor.parentBridgeRequestId && (
      !parent ||
      parent.targetWorkspaceId !== actor.serverId ||
      parent.replyToMessageId
    )) {
      throw new WorkspaceBridgeRequestError("workspace_bridge_parent_request_not_found");
    }
    const visitedBridgeIds = new Set<string>();
    let cursor = parent;
    while (cursor) {
      if (visitedBridgeIds.has(cursor.bridgeId)) {
        throw new WorkspaceBridgeRequestError("workspace_bridge_chain_cycle");
      }
      visitedBridgeIds.add(cursor.bridgeId);
      cursor = cursor.parentBridgeRequestId
        ? this.ctx.store.getCrossWorkspaceMessage(cursor.parentBridgeRequestId)
        : null;
    }
    if (visitedBridgeIds.has(bridge.id)) {
      throw new WorkspaceBridgeRequestError("workspace_bridge_chain_cycle");
    }
    const hopCount = parent ? (parent.hopCount ?? 1) + 1 : 1;
    if (hopCount > 8) throw new WorkspaceBridgeRequestError("workspace_bridge_chain_limit_exceeded");
    return {
      parent,
      parentBridgeRequestId: parent?.id ?? null,
      traceId: actor.bridgeTraceId ?? parent?.traceId ?? randomUUID(),
      hopCount
    };
  }

  currentWorkspace(actor: WorkspaceBridgeServiceActor): WorkspaceBridgeCurrentWorkspace {
    const membership = this.requireMember(actor);
    return { id: membership.id, name: membership.name };
  }

  private sessionChannel(bridge: WorkspaceBridgeRecord, sourceWorkspaceId: string): ChannelRecord | null {
    const targetWorkspaceId = sourceWorkspaceId === bridge.workspaceAId ? bridge.workspaceBId : bridge.workspaceAId;
    return bridge.status === "active"
      ? this.ctx.store.getOrCreateWorkspaceBridgeDm(bridge.id, targetWorkspaceId)
      : this.ctx.store.getWorkspaceBridgeDm(bridge.id, targetWorkspaceId);
  }

  private explicitConversation(
    bridge: WorkspaceBridgeRecord,
    sourceWorkspaceId: string,
    conversationId: string
  ): { channel: ChannelRecord; conversation: ConversationRecord } | null {
    const channel = this.sessionChannel(bridge, sourceWorkspaceId);
    if (!channel) return null;
    const conversation = this.ctx.store.getConversation(conversationId);
    return conversation?.channelId === channel.id ? { channel, conversation } : null;
  }

  private conversationForSend(
    actor: WorkspaceBridgeServiceActor,
    bridge: WorkspaceBridgeRecord,
    input: { conversationId?: string; origin?: WorkspaceBridgeRequestOrigin }
  ): { channel: ChannelRecord; conversation: ConversationRecord } {
    const channel = this.sessionChannel(bridge, actor.serverId);
    if (!channel) throw new WorkspaceBridgeRequestError("workspace_bridge_session_unavailable");
    if (input.conversationId) {
      const explicit = this.explicitConversation(bridge, actor.serverId, input.conversationId);
      if (!explicit || explicit.conversation.status !== "active" || explicit.conversation.archivedAt) {
        throw new WorkspaceBridgeRequestError("workspace_bridge_conversation_not_active");
      }
      return explicit;
    }

    const originConversationKey = input.origin?.conversationKey?.trim();
    if (originConversationKey) {
      const prior = [...this.ctx.store.listCrossWorkspaceMessages(bridge.id)]
        .reverse()
        .find((message) => (
          message.sourceWorkspaceId === actor.serverId &&
          message.initiatedBy === "human" &&
          !message.replyToMessageId &&
          message.originConversationKey === originConversationKey &&
          Boolean(message.conversationId)
        ));
      if (prior?.conversationId) {
        const reused = this.explicitConversation(bridge, actor.serverId, prior.conversationId);
        if (reused && reused.conversation.status === "active" && !reused.conversation.archivedAt) return reused;
      }
    }

    // Every new caller conversation gets an isolated Bridge conversation instead of sharing the UI's active topic.
    const conversation = this.ctx.store.createConversation({
      channelId: channel.id,
      startedByType: "human",
      startedById: actor.requestingUserId ?? actor.userId,
      closeExisting: false,
      setActive: false,
      resetStatus: "not_applicable"
    });
    return { channel, conversation };
  }

  list(actor: WorkspaceBridgeServiceActor): WorkspaceBridgeSummary[] {
    this.requireMember(actor);
    return this.ctx.store.listWorkspaceBridges(actor.serverId)
      // Assistant 与 MCP 返回的是当前可发送路由；revoked 历史仍由 Web 管理面保留。
      .filter((bridge) => bridge.status === "active" && bridge.peerWorkspace)
      .map((bridge) => ({
        id: bridge.id,
        peerWorkspaceName: bridge.peerWorkspace!.name,
        peerAssistantName: bridge.peerWorkspace!.onboardingAgentId
          ? this.ctx.store.getAgent(bridge.peerWorkspace!.onboardingAgentId)?.displayName ?? "TYR"
          : "TYR",
        status: bridge.status,
        direction: bridge.direction,
        permissions: [...bridge.permissions],
        connectedAt: bridge.acceptedAt,
        lastActivityAt: bridge.lastActivityAt
      }));
  }

  async send(actor: WorkspaceBridgeServiceActor, input: {
    bridgeId: string;
    content: string;
    conversationId?: string;
    idempotencyKey: string;
    retryOfMessageId?: string;
    attachmentIds?: string[];
    origin?: WorkspaceBridgeRequestOrigin;
    waitSeconds?: number;
  } & WorkspaceBridgeEvidenceInput): Promise<WorkspaceBridgeSendResult> {
    const bridge = this.requireBridge(actor, input.bridgeId, true);
    if (!bridge.permissions.includes("chat")) throw new WorkspaceBridgeRequestError("workspace_bridge_chat_not_allowed");
    // one_way is defined as workspace A -> workspace B; bidirectional permits either side.
    if (bridge.direction === "one_way" && actor.serverId !== bridge.workspaceAId) {
      throw new WorkspaceBridgeRequestError("workspace_bridge_direction_not_allowed");
    }
    const requestedRetry = input.retryOfMessageId?.trim()
      ? this.ctx.store.getCrossWorkspaceMessage(input.retryOfMessageId.trim())
      : null;
    const retryOf = requestedRetry?.retryOfMessageId
      ? this.ctx.store.getCrossWorkspaceMessage(requestedRetry.retryOfMessageId)
      : requestedRetry;
    if (input.retryOfMessageId && (
      !retryOf ||
      retryOf.bridgeId !== bridge.id ||
      retryOf.sourceWorkspaceId !== actor.serverId ||
      retryOf.initiatedBy !== "human" ||
      retryOf.replyToMessageId ||
      !retryOf.conversationId ||
      (input.conversationId && input.conversationId !== retryOf.conversationId)
    )) {
      throw new WorkspaceBridgeRequestError("workspace_bridge_request_not_found");
    }
    // Retry 始终复用不可变的原始正文，模型和浏览器都不能重建或改写它。
    const content = retryOf?.content ?? input.content.trim();
    if (!content) throw new WorkspaceBridgeRequestError("content_required");
    if (content.length > 20_000) throw new WorkspaceBridgeRequestError("content_too_long");
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) throw new WorkspaceBridgeRequestError("idempotency_key_required");
    if (idempotencyKey.length > 128) throw new WorkspaceBridgeRequestError("client_request_id_too_long");

    const provenance = this.bridgeProvenance(actor, bridge);
    const capabilityUser = this.ctx.store.getUser(actor.userId);
    if (!capabilityUser) throw new WorkspaceBridgeRequestError("workspace_bridge_member_required");
    const requestingUserId = actor.requestingUserId ?? actor.userId;
    const requestingUser = this.ctx.store.getUser(requestingUserId);
    const targetCapabilityUserId = bridge.peerWorkspace?.ownerUserId ?? null;
    if (!targetCapabilityUserId) throw new WorkspaceBridgeRequestError("workspace_bridge_peer_owner_not_found");

    // 幂等键先在当前 Workspace + Bridge 范围内解析，重试不能因为省略 conversationId 而创建新会话。
    const priorRequest = this.ctx.store.listCrossWorkspaceMessages(bridge.id).find((message) => (
      message.sourceWorkspaceId === actor.serverId &&
      message.initiatedBy === "human" &&
      !message.replyToMessageId &&
      message.clientRequestId === idempotencyKey
    ));
    const priorConversation = priorRequest?.conversationId
      ? this.explicitConversation(bridge, actor.serverId, priorRequest.conversationId)
      : null;
    if (priorRequest && !priorConversation) {
      throw new WorkspaceBridgeRequestError("workspace_bridge_request_not_found");
    }
    const retryConversation = retryOf?.conversationId
      ? this.explicitConversation(bridge, actor.serverId, retryOf.conversationId)
      : null;
    if (retryOf && !retryConversation) throw new WorkspaceBridgeRequestError("workspace_bridge_request_not_found");
    const scoped = priorConversation ?? retryConversation ?? this.conversationForSend(actor, bridge, input);
    const attachmentIds = retryOf?.attachmentIds ?? [...new Set(input.attachmentIds ?? [])].flatMap((attachmentId) => {
      const attachment = this.ctx.store.getAttachment(attachmentId);
      if (!attachment) return [];
      return [this.ctx.store.createAttachment({
        channelId: scoped.channel.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        path: attachment.path
      }).id];
    });
    const existing = priorRequest ?? this.ctx.store.getCrossWorkspaceMessageByClientRequest({
      bridgeId: bridge.id,
      conversationId: scoped.conversation.id,
      sourceWorkspaceId: actor.serverId,
      clientRequestId: idempotencyKey
    });
    const targetWorkspaceId = actor.serverId === bridge.workspaceAId ? bridge.workspaceBId : bridge.workspaceAId;
    if (input.evidenceSelections?.length) {
      if (!input.evidenceScope || input.evidenceScope.serverId !== actor.serverId ||
          input.evidenceScope.sourceMessageId !== input.origin?.messageId ||
          input.evidenceScope.channelId !== input.origin?.channelId ||
          input.evidenceScope.conversationId !== (input.origin?.conversationId ?? null)) {
        throw new WorkspaceBridgeRequestError("communication_evidence_scope_invalid");
      }
      selectCommunicationEvidenceForContext(this.ctx.store, input.evidenceScope, input.evidenceSelections);
    }
    const request = this.ctx.store.db.transaction(() => {
      if (!existing && provenance.parent && (provenance.parent.resolvedByTerminalId || this.ctx.store.db.prepare(
        "select 1 from cross_workspace_messages where terminal_request_id = ?"
      ).get(provenance.parent.id))) {
        throw new WorkspaceBridgeRequestError("workspace_bridge_parent_request_completed");
      }
      const saved = existing ?? this.ctx.store.createCrossWorkspaceMessage({
      bridgeId: bridge.id,
      conversationId: scoped.conversation.id,
      clientRequestId: idempotencyKey,
      retryOfMessageId: retryOf?.id ?? null,
      originConversationKey: input.origin?.conversationKey?.trim() || null,
      originChannelId: input.origin?.channelId ?? null,
      originConversationId: input.origin?.conversationId ?? null,
      originMessageId: input.origin?.messageId ?? null,
      // TYR 的显式工具调用登记等待方；普通 Bridge API 仅回写结果，不自动继续 Agent。
      awaitingAgentId: input.origin?.awaitingAgentId ?? null,
      originSource: input.origin?.source ?? actor.source,
      originExternalRef: input.origin?.externalRef ?? null,
      sourceWorkspaceId: actor.serverId,
      targetWorkspaceId,
      senderUserId: requestingUserId,
      senderUserName: actor.requestingUserName ?? requestingUser?.name ?? capabilityUser.name,
      senderUserDisplayName: actor.requestingUserDisplayName ?? requestingUser?.displayName ?? capabilityUser.displayName,
      senderUserAvatarUrl: actor.requestingUserAvatarUrl ?? requestingUser?.avatarUrl ?? capabilityUser.avatarUrl,
      sourceCapabilityUserId: actor.userId,
      targetCapabilityUserId,
      originalSenderUserId: provenance.parent?.originalSenderUserId ?? requestingUserId,
      traceId: provenance.traceId,
      parentBridgeRequestId: provenance.parentBridgeRequestId,
      hopCount: provenance.hopCount,
      attachmentIds,
      initiatedBy: "human",
      content,
      outcome: "pending"
      });
      if (!existing && input.evidenceSelections?.length && input.evidenceScope) {
        publishCommunicationEvidenceForBridgeMessage(this.ctx.store, {
          messageId: saved.id, scope: input.evidenceScope, selections: input.evidenceSelections
        });
      }
      const evidence = getCommunicationEvidenceForBridgeMessage(this.ctx.store, saved.id);
      return evidence.length ? { ...saved, evidence } : saved;
    })();

    if (scoped.conversation.title === "New conversation") {
      this.ctx.store.renameConversation(scoped.conversation.id, requestTitle(content));
    }
    this.ctx.emitRealtimeWorkspaceBridgeMessage(request);
    if (!existing && request.outcome === "pending") {
      enqueueCrossWorkspaceBridgeMessageDelivery(this.ctx, {
        bridge,
        requestMessage: request,
        initiatedByUserId: actor.userId
      });
      this.recordAudit(actor, "workspace_bridge_request_submitted", request, {
        clientId: actor.clientId ?? null,
        grantId: actor.grantId ?? null,
        retryOfMessageId: retryOf?.id ?? null,
        traceId: request.traceId,
        parentBridgeRequestId: request.parentBridgeRequestId,
        hopCount: request.hopCount
      });
    }
    this.ctx.publishWorkspaceSync();
    const waitSeconds = Math.max(0, Math.min(input.waitSeconds ?? 0, 30));
    const status = waitSeconds
      ? await this.waitForStatus(actor, request.id, waitSeconds, true)
      : this.status(actor, request.id);
    return {
      request,
      conversation: this.ctx.store.getConversation(scoped.conversation.id) ?? scoped.conversation,
      status
    };
  }

  /** An authenticated requester may close an unanswered request with a later TYR-reviewed
   * final on the same Bridge. This records lineage; it never replays the original work. */
  resolveWithFollowup(actor: WorkspaceBridgeServiceActor, input: {
    bridgeId: string;
    requestId: string;
    terminalId: string;
  }): WorkspaceBridgeRequestStatusPayload {
    const bridge = this.requireBridge(actor, input.bridgeId);
    const request = this.ctx.store.getCrossWorkspaceMessage(input.requestId);
    const terminal = this.ctx.store.getCrossWorkspaceMessage(input.terminalId);
    const followup = terminal?.replyToMessageId
      ? this.ctx.store.getCrossWorkspaceMessage(terminal.replyToMessageId)
      : null;
    const requestingUserId = actor.requestingUserId ?? actor.userId;
    if (!request || !terminal || !followup ||
        request.bridgeId !== bridge.id || request.sourceWorkspaceId !== actor.serverId ||
        request.senderUserId !== requestingUserId || request.responseKind || request.replyToMessageId ||
        request.outcome === "failed" ||
        terminal.responseKind !== "final" || terminal.terminalRequestId !== followup.id ||
        followup.bridgeId !== bridge.id || followup.sourceWorkspaceId !== request.sourceWorkspaceId ||
        followup.targetWorkspaceId !== request.targetWorkspaceId ||
        followup.senderUserId !== request.senderUserId || followup.responseKind || followup.replyToMessageId ||
        followup.id === request.id || followup.createdAt < request.createdAt) {
      throw new WorkspaceBridgeRequestError("workspace_bridge_resolution_invalid");
    }
    const activePeerExecution = this.ctx.store.listRuntimeExecutions({
      serverId: request.targetWorkspaceId, limit: 1_000
    }).some((execution) => externalRefRequestId(execution.communicationReturnExternalRef) === request.id &&
      ["queued", "running", "waiting_approval"].includes(execution.status));
    if (activePeerExecution || request.continuationState === "running") {
      throw new WorkspaceBridgeRequestError("workspace_bridge_request_still_running");
    }
    if (request.resolvedByTerminalId === terminal.id) {
      return this.statusForRequest(request, bridge.peerWorkspace?.name ?? "Connected workspace", new Set());
    }
    const now = new Date().toISOString();
    this.ctx.store.db.transaction(() => {
      const updated = this.ctx.store.db.prepare(`update cross_workspace_messages
        set resolved_by_terminal_id = ?, updated_at = ?,
            continuation_state = case when continuation_state in ('registered', 'pending', 'interrupted')
              then 'completed' else continuation_state end
        where id = ? and resolved_by_terminal_id is null
          and not exists (select 1 from cross_workspace_messages where terminal_request_id = ?)`)
        .run(terminal.id, now, request.id, request.id);
      if (updated.changes === 0) throw new WorkspaceBridgeRequestError("workspace_bridge_resolution_conflict");
      this.ctx.store.db.prepare(`update cross_workspace_messages
        set continuation_state = 'completed', updated_at = ?
        where reply_to_message_id = ? and response_kind in ('question', 'action_request')
          and continuation_state in ('registered', 'pending', 'interrupted')`).run(now, request.id);
    })();
    const resolved = this.ctx.store.getCrossWorkspaceMessage(request.id)!;
    this.recordAudit(actor, "workspace_bridge_request_resolved_by_followup", resolved, {
      followupRequestId: followup.id,
      terminalMessageId: terminal.id
    });
    this.ctx.emitRealtimeWorkspaceBridgeMessage(resolved);
    this.ctx.publishWorkspaceSync();
    return this.statusForRequest(resolved, bridge.peerWorkspace?.name ?? "Connected workspace", new Set());
  }

  async followup(actor: WorkspaceBridgeServiceActor, input: {
    authoritySourceMessageId?: string;
    requestId: string;
    bridgeId: string;
    eventId: string;
    kind: "answer" | "instruction" | "continue";
    content: string;
    originChannelId: string | null;
    originConversationId: string | null;
    awaitingAgentId: string | null;
  } & WorkspaceBridgeEvidenceInput): Promise<{ event: CrossWorkspaceMessageRecord; status: WorkspaceBridgeRequestStatusPayload }> {
    const bridge = this.requireBridge(actor, input.bridgeId, true);
    if (!bridge.permissions.includes("chat")) throw new WorkspaceBridgeRequestError("workspace_bridge_chat_not_allowed");
    if (bridge.direction === "one_way" && actor.serverId !== bridge.workspaceAId) {
      throw new WorkspaceBridgeRequestError("workspace_bridge_direction_not_allowed");
    }
    const request = this.ctx.store.getCrossWorkspaceMessage(input.requestId);
    if (!request || request.responseKind || request.bridgeId !== bridge.id ||
        request.sourceWorkspaceId !== actor.serverId || request.sourceCapabilityUserId !== actor.userId ||
        request.originChannelId !== input.originChannelId || request.originConversationId !== input.originConversationId ||
        request.awaitingAgentId !== input.awaitingAgentId ||
        (actor.requestingUserId && request.senderUserId !== actor.requestingUserId)) {
      throw new WorkspaceBridgeRequestError("workspace_bridge_request_not_found");
    }
    const content = input.content.trim();
    if (!content || content.length > 12_000 || !/^[A-Za-z0-9_-]{8,128}$/.test(input.eventId)) {
      throw new WorkspaceBridgeRequestError("invalid_workspace_bridge_followup");
    }
    if (input.evidenceSelections?.length) {
      if (!input.evidenceScope || input.evidenceScope.serverId !== actor.serverId ||
          input.evidenceScope.sourceMessageId !== request.originMessageId ||
          input.evidenceScope.channelId !== input.originChannelId ||
          input.evidenceScope.conversationId !== input.originConversationId) {
        throw new WorkspaceBridgeRequestError("communication_evidence_scope_invalid");
      }
      selectCommunicationEvidenceForContext(this.ctx.store, input.evidenceScope, input.evidenceSelections);
    }
    const recorded = this.ctx.store.db.transaction(() => {
      const saved = this.ctx.store.createCrossWorkspaceInteractionMessage({
        requestId: request.id, eventId: input.eventId, kind: input.kind, content
      });
      if (!saved) return null;
      if (saved.created) {
        recordBridgeFollowupDependency(this.ctx.store, saved.message.id);
        recordBridgeRouteClarification(this.ctx.store, saved.message.id, input.authoritySourceMessageId);
      }
      if (saved.created && input.evidenceSelections?.length && input.evidenceScope) {
        publishCommunicationEvidenceForBridgeMessage(this.ctx.store, {
          messageId: saved.message.id, scope: input.evidenceScope, selections: input.evidenceSelections
        });
      }
      const evidence = getCommunicationEvidenceForBridgeMessage(this.ctx.store, saved.message.id);
      return { ...saved, message: evidence.length ? { ...saved.message, evidence } : saved.message };
    })();
    if (!recorded) {
      const completed = request.resolvedByTerminalId || this.ctx.store.db.prepare(
        "select 1 from cross_workspace_messages where terminal_request_id = ?"
      ).get(request.id);
      throw new WorkspaceBridgeRequestError(completed
        ? "workspace_bridge_request_completed" : "workspace_bridge_followup_event_conflict");
    }
    if (recorded.created) {
      this.ctx.emitRealtimeWorkspaceBridgeMessage(recorded.message);
      enqueueCrossWorkspaceBridgeFollowupDelivery(this.ctx, recorded.message.id);
      this.recordAudit(actor, "workspace_bridge_followup_submitted", request, {
        eventMessageId: recorded.message.id, eventId: input.eventId,
        responseKind: input.kind, traceId: request.traceId
      });
      this.ctx.publishWorkspaceSync();
    }
    return { event: recorded.message, status: this.status(actor, request.id) };
  }

  status(actor: WorkspaceBridgeServiceActor, requestId: string): WorkspaceBridgeRequestStatusPayload {
    this.requireMember(actor);
    const request = this.ctx.store.getCrossWorkspaceMessage(requestId);
    if (
      !request ||
      request.initiatedBy !== "human" ||
      request.replyToMessageId ||
      request.sourceWorkspaceId !== actor.serverId ||
      !request.conversationId
    ) throw new WorkspaceBridgeRequestError("workspace_bridge_request_not_found");
    const bridge = this.ctx.store.getWorkspaceBridgeForServer(request.bridgeId, actor.serverId);
    if (!bridge?.peerWorkspace) throw new WorkspaceBridgeRequestError("workspace_bridge_request_not_found");
    return this.statusForRequest(request, bridge.peerWorkspace.name, new Set());
  }

  statusForIncomingWeb(actor: WorkspaceBridgeServiceActor, requestId: string): WorkspaceBridgeRequestStatusPayload {
    this.requireMember(actor);
    const request = this.ctx.store.getCrossWorkspaceMessage(requestId);
    // 目标 Workspace 的 Owner/Member 只能查看直接收到的请求；MCP 的来源方查询边界保持不变。
    if (
      actor.source !== "web" ||
      !request ||
      request.initiatedBy !== "human" ||
      request.replyToMessageId ||
      request.targetWorkspaceId !== actor.serverId ||
      !request.conversationId
    ) throw new WorkspaceBridgeRequestError("workspace_bridge_request_not_found");
    const bridge = this.ctx.store.getWorkspaceBridgeForServer(request.bridgeId, actor.serverId);
    if (!bridge?.peerWorkspace) throw new WorkspaceBridgeRequestError("workspace_bridge_request_not_found");
    return this.statusForRequest(request, bridge.peerWorkspace.name, new Set());
  }

  private statusForRequest(
    request: CrossWorkspaceMessageRecord,
    peerWorkspaceName: string,
    visited: Set<string>
  ): WorkspaceBridgeRequestStatusPayload {
    // A chained request can be observed through its parent without granting access to the next Bridge.
    visited.add(request.id);
    const replies = this.ctx.store.listCrossWorkspaceMessages(request.bridgeId, { conversationId: request.conversationId ?? undefined })
      .filter((message) => message.replyToMessageId === request.id)
      .sort((left, right) => messageTimestamp(left) - messageTimestamp(right));
    const finalReply = [...replies].reverse().find((message) => message.responseKind === "final");
    const errorReply = [...replies].reverse().find((message) => message.responseKind === "error" ||
      (message.outcome === "failed" && !message.interactionEventId));
    const acknowledgement = [...replies].reverse().find((message) => message.responseKind === "ack");
    const resolvingTerminal = request.resolvedByTerminalId
      ? this.ctx.store.getCrossWorkspaceMessage(request.resolvedByTerminalId)
      : null;
    const resolvingRequest = resolvingTerminal?.replyToMessageId
      ? this.ctx.store.getCrossWorkspaceMessage(resolvingTerminal.replyToMessageId)
      : null;
    const resolution = resolvingTerminal?.responseKind === "final" &&
      resolvingRequest?.bridgeId === request.bridgeId &&
      resolvingRequest.sourceWorkspaceId === request.sourceWorkspaceId &&
      resolvingRequest.targetWorkspaceId === request.targetWorkspaceId &&
      resolvingRequest.senderUserId === request.senderUserId
      ? { kind: "followup" as const, requestId: resolvingRequest.id, terminalId: resolvingTerminal.id }
      : null;
    const interactions = replies.filter((message): message is CrossWorkspaceMessageRecord & {
      responseKind: "progress" | "question" | "action_request" | "answer" | "instruction" | "continue"
    } => ["progress", "question", "action_request", "answer", "instruction", "continue"].includes(message.responseKind ?? ""));
    const peerExecutions = (this.ctx.store.db.prepare(`select id from runtime_executions where server_id = ?
      and case when json_valid(communication_return_external_ref) then
        json_extract(communication_return_external_ref, '$.requestMessageId') = ? else 0 end`)
      .all(request.targetWorkspaceId, request.id) as Array<{ id: string }>).flatMap(({ id }) => {
        const execution = this.ctx.store.getRuntimeExecution(id); return execution ? [execution] : [];
      });
    const peerApprovalPending = peerExecutions.some((execution) => (
      execution.status === "waiting_approval" ||
      this.ctx.store.listRuntimeApprovals({ executionId: execution.id, limit: 100 })
        .some((approval) => approval.status === "pending")
    ));
    const peerQueueBlockedByApproval = peerExecutions.some((execution) => (
      execution.status === "queued" &&
      this.ctx.store.listRuntimeApprovals({ agentId: execution.agentId, limit: 1000 })
        .some((approval) => approval.status === "pending" && approval.requestedAt <= execution.createdAt)
    ));
    const peerExecutionsEndedWithoutResult = peerExecutions.length > 0 && peerExecutions.every((execution) => (
      execution.status === "failed" || execution.status === "stalled" || execution.status === "cancelled"
    ));

    let state: WorkspaceBridgeRequestState;
    if (request.outcome === "failed" || errorReply) state = "failed";
    else if (finalReply || resolution) state = "completed";
    else if (peerExecutionsEndedWithoutResult) state = "failed";
    else if (peerApprovalPending || peerQueueBlockedByApproval) state = "blocked_on_peer_approval";
    else if (peerExecutions.length || acknowledgement || interactions.length) state = "running";
    else if (request.peerMessageId || request.outcome === "delivered") state = "delivered";
    else state = "queued";

    let updatedAt = [
      request.createdAt,
      ...replies.map((message) => message.createdAt),
      ...peerExecutions.map((execution) => execution.updatedAt)
    ].sort().at(-1) ?? request.createdAt;
    let hasOpenChild = false;
    let childNeedsAttention = false;
    if (state !== "completed" && state !== "failed" && visited.size < 8) {
      for (const child of this.ctx.store.listCrossWorkspaceChildRequests(request.id)) {
        if (visited.has(child.id)) continue;
        const childStatus = this.statusForRequest(child, peerWorkspaceName, visited);
        if (childStatus.state !== "completed" && childStatus.state !== "failed") hasOpenChild = true;
        if (childStatus.state === "needs_attention" || childStatus.state === "failed") childNeedsAttention = true;
        // Only propagate a blocking condition. The peer TYR still owns the final result of its child work.
        if (childStatus.state === "blocked_on_peer_approval") state = "blocked_on_peer_approval";
        if (childStatus.updatedAt > updatedAt) updatedAt = childStatus.updatedAt;
      }
    }
    const progress = workspaceBridgeProgress({ request, state, updatedAt, executions: peerExecutions,
      events: peerExecutions.flatMap((execution) => this.ctx.store.listRuntimeExecutionEvents(execution.id)),
      replies, hasOpenChild, childNeedsAttention });
    updatedAt = progress.lastEventAt;
    if (state !== "completed" && state !== "failed" && this.ctx.humanReplies?.isWaiting(request.id)) {
      state = "running";
      progress.stage = "running";
      progress.summary = "Waiting for the Workspace Owner's personal reply.";
    }
    if (progress.stage === "needs_attention") state = "needs_attention";
    const payload: WorkspaceBridgeRequestStatusPayload = {
      bridgeRequestId: request.id,
      bridgeId: request.bridgeId,
      conversationId: request.conversationId!,
      state,
      peerWorkspaceName,
      progress,
      ...(acknowledgement ? { acknowledgement: acknowledgement.content } : {}),
      ...(interactions.length ? { interactions: interactions.map((message) => ({
        id: message.id, kind: message.responseKind, content: message.content, createdAt: message.createdAt,
        evidence: getCommunicationEvidenceForBridgeMessage(this.ctx.store, message.id)
      })) } : {}),
      ...(finalReply ? { response: finalReply.content,
        responseEvidence: getCommunicationEvidenceForBridgeMessage(this.ctx.store, finalReply.id) } : {}),
      ...(resolution ? {
        resolution,
        ...(!finalReply ? { response: "Resolved by a later TYR-reviewed response in this Workspace Bridge." } : {})
      } : {}),
      ...((request.outcome === "failed" || errorReply || peerExecutionsEndedWithoutResult) ? {
        error: {
          code: request.outcome === "failed"
            ? "workspace_bridge_delivery_failed"
            : "workspace_bridge_peer_response_failed",
          message: errorReply?.content ?? (peerExecutionsEndedWithoutResult
            ? "The peer Agent did not complete the request."
            : "The Workspace Bridge request could not be delivered.")
        }
      } : {}),
      createdAt: request.createdAt,
      updatedAt
    };
    return payload;
  }

  async waitForStatus(
    actor: WorkspaceBridgeServiceActor,
    requestId: string,
    waitSeconds: number,
    returnOnAcknowledgement = false
  ): Promise<WorkspaceBridgeRequestStatusPayload> {
    const boundedMs = Math.max(0, Math.min(waitSeconds, 30)) * 1000;
    let current = this.status(actor, requestId);
    if (!boundedMs || this.isTerminal(current.state) || (returnOnAcknowledgement && current.acknowledgement)) return current;
    const deadline = Date.now() + boundedMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))));
      current = this.status(actor, requestId);
      if (this.isTerminal(current.state) || (returnOnAcknowledgement && current.acknowledgement)) return current;
    }
    return current;
  }

  history(actor: WorkspaceBridgeServiceActor, input: {
    bridgeId: string;
    conversationId: string;
    limit?: number;
    before?: string | null;
  }): { messages: WorkspaceBridgeHistoryItem[]; pageInfo: ReturnType<ServerRouteContext["store"]["listCrossWorkspaceMessagesPage"]>["pageInfo"] } {
    const bridge = this.requireBridge(actor, input.bridgeId);
    const scoped = this.explicitConversation(bridge, actor.serverId, input.conversationId);
    if (!scoped) throw new WorkspaceBridgeRequestError("workspace_bridge_conversation_not_found");
    const page = this.ctx.store.listCrossWorkspaceMessagesPage(bridge.id, {
      conversationId: scoped.conversation.id,
      limit: input.limit,
      beforeCreatedAt: input.before
    });
    return {
      messages: page.messages.map((message) => ({
        id: message.id,
        bridgeRequestId: message.replyToMessageId ?? (message.initiatedBy === "human" ? message.id : null),
        direction: message.sourceWorkspaceId === actor.serverId ? "outbound" : "inbound",
        kind: message.initiatedBy === "human"
          ? "request"
          : message.responseKind ?? (message.outcome === "failed" ? "error" : "final"),
        content: message.content,
        outcome: message.outcome,
        createdAt: message.createdAt
      })),
      pageInfo: page.pageInfo
    };
  }

  private isTerminal(state: WorkspaceBridgeRequestState): boolean {
    return state === "completed" || state === "failed";
  }

  private recordAudit(
    actor: WorkspaceBridgeServiceActor,
    kind: string,
    request: CrossWorkspaceMessageRecord,
    metadata: Record<string, unknown> = {}
  ): void {
    this.ctx.store.recordAuditEvent({
      kind,
      actorType: "user",
      actorId: actor.userId,
      resourceType: "workspace_bridge",
      resourceId: request.bridgeId,
      serverId: actor.serverId,
      // Message content is intentionally excluded; audit stores routing identity and outcome only.
      metadata: {
        requestMessageId: request.id,
        conversationId: request.conversationId,
        sourceWorkspaceId: request.sourceWorkspaceId,
        targetWorkspaceId: request.targetWorkspaceId,
        requestingUserId: request.senderUserId ?? actor.requestingUserId ?? actor.userId,
        sourceCapabilityUserId: request.sourceCapabilityUserId ?? actor.userId,
        targetCapabilityUserId: request.targetCapabilityUserId ?? null,
        traceId: request.traceId ?? null,
        parentBridgeRequestId: request.parentBridgeRequestId ?? null,
        hopCount: request.hopCount ?? 0,
        source: actor.source,
        ...metadata
      }
    });
  }
}
