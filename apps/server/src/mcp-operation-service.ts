import { createHash } from "node:crypto";
import { isCommunicationAgent } from "@tyr-ai/contracts";
import type {
  ChannelRecord,
  CommunicationAgentManagementDraftRecord,
  ConversationRecord,
  RuntimeApprovalDecision,
  RuntimeApprovalRecord,
  RuntimeExecutionRecord,
  WorkspaceBridgeRequestStatusPayload
} from "@tyr-ai/contracts";
import { maybeReplyToCommunicationAgentDm, type CommunicationAgentReplyOutcome } from "./communication-agent";
import { McpSubmissionDispatcher, type McpSubmission } from "./mcp-operation-submissions";
import type {
  McpOperationErrorMetadata,
  McpOperationRecord,
  McpPersistence
} from "./mcp-persistence";
import { resolveRuntimeApprovalDecision } from "./runtime-approval-resolve";
import type { ServerRouteContext } from "./server-context";
import { sanitizeHumanVisibleText, sanitizeHumanVisibleValue } from "./output-disclosure";
import { WorkspaceBridgeRequestService } from "./workspace-bridge-request-service";

const PUBLIC_REPLY_TIMEOUT_MS = 30_000;
const PUBLIC_REPLY_UNAVAILABLE_TEXT = "The agent completed the work, but TYR could not publish its reply. Please retry the request.";

export interface McpActor {
  userId: string;
  serverId: string;
  clientId: string;
  grantId: string;
  scopes: string[];
}

export type McpOperationState =
  | "input_required"
  | "approval_required"
  | "queued"
  | "running"
  | "blocked_on_peer_approval"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export interface McpSubmitInput {
  kind: "query" | "request";
  message: string;
  operationId?: string;
  conversationId?: string;
  idempotencyKey: string;
}

export interface McpOperationStatusPayload {
  submission?: { idempotencyKey: string; turnSequence: number; messageId: string; state: McpSubmission["state"] };
  operationId: string;
  conversationId?: string;
  state: McpOperationState;
  message: string;
  response?: string;
  error?: McpOperationErrorMetadata;
  management?: {
    draftId: string;
    operationId: string;
    action: string;
    stage: string;
    status: string;
    choices: Array<{ id: string; label: string; value: string }>;
    approvalRequired: boolean;
  };
  executions: Array<{
    executionId: string;
    agentId: string;
    agentName?: string;
    status: string;
    hasFinalResult: boolean;
  }>;
  bridges: WorkspaceBridgeRequestStatusPayload[];
  pendingApprovals: Array<{
    approvalId: string;
    executionId?: string;
    kind: string;
    title: string;
    detail: string;
    payload?: unknown;
    requestedAt: string;
  }>;
  updatedAt: string;
}

export interface McpConversationStartPayload {
  conversationId: string;
  channelId: string;
  title: string;
  createdAt: string;
  active: boolean;
  created: boolean;
}

export interface McpConversationHistoryPayload {
  conversationId: string;
  messages: Array<{
    id: string;
    createdAt: string;
    role: "user" | "agent" | "system";
    author: { type: "user" | "agent" | "system"; id: string; name: string };
    content: string;
    operationIds?: string[];
    executionIds?: string[];
    bridgeRequestIds?: string[];
    attachments?: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }>;
    deletedAt?: string;
  }>;
  nextCursor: string;
  hasMore: boolean;
}

function operationError(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: message });
}

function isTerminal(status: RuntimeExecutionRecord["status"]): boolean {
  return ["completed", "failed", "stalled", "cancelled"].includes(status);
}

function managementState(draft: CommunicationAgentManagementDraftRecord): McpOperationState | null {
  if (draft.status === "pending") return draft.stage === "awaiting_confirmation" ? "approval_required" : "input_required";
  if (draft.status === "confirmed") return "running";
  if (draft.status === "failed") return "failed";
  if (draft.status === "cancelled" || draft.status === "expired" || draft.status === "superseded") return "cancelled";
  return null;
}

function stateMessage(state: McpOperationState): string {
  switch (state) {
    case "input_required": return "TYR needs another message to collect or disambiguate required input.";
    case "approval_required": return "The operation is paused for approval. Resolve the listed approval, then check this operation again.";
    case "queued": return "The operation is queued for delivery to a Tyr runtime.";
    case "running": return "The Tyr runtime is still working.";
    case "blocked_on_peer_approval": return "The peer workspace is waiting for its own owner to resolve an approval.";
    case "completed": return "The Tyr operation completed.";
    case "partial": return "The Tyr operation completed partially; inspect the execution statuses and TYR public reply.";
    case "failed": return "The Tyr operation failed.";
    case "cancelled": return "The Tyr operation was cancelled or expired.";
  }
}

function currentWorkState(
  executions: RuntimeExecutionRecord[],
  bridges: WorkspaceBridgeRequestStatusPayload[]
): McpOperationState | null {
  if (!executions.length && !bridges.length) return null;
  if (bridges.some((bridge) => bridge.state === "blocked_on_peer_approval")) return "blocked_on_peer_approval";
  if (bridges.some((bridge) => bridge.state === "needs_attention")) return "input_required";
  const unfinishedExecution = executions.some((execution) => !isTerminal(execution.status));
  const unfinishedBridge = bridges.some((bridge) => ["queued", "delivered", "running"].includes(bridge.state));
  if (unfinishedExecution || unfinishedBridge) {
    const activelyRunning = executions.some((execution) => execution.status === "running" || execution.status === "waiting_approval") ||
      bridges.some((bridge) => bridge.state === "running");
    return activelyRunning ? "running" : "queued";
  }

  const completedCount = executions.filter((execution) => execution.status === "completed").length +
    bridges.filter((bridge) => bridge.state === "completed").length;
  const failedCount = executions.filter((execution) => execution.status === "failed" || execution.status === "stalled").length +
    bridges.filter((bridge) => bridge.state === "failed").length;
  const cancelledCount = executions.filter((execution) => execution.status === "cancelled").length;
  // execution 与 Bridge 是同一 Assistant 输入下的并列分支，跨类型的一成一败同样属于 partial。
  if (completedCount > 0 && failedCount + cancelledCount > 0) return "partial";
  if (failedCount > 0) return "failed";
  if (cancelledCount > 0) return "cancelled";
  return "completed";
}

export class McpOperationService {
  private readonly dispatcher: McpSubmissionDispatcher;
  constructor(readonly ctx: ServerRouteContext, readonly persistence: McpPersistence) {
    this.dispatcher = new McpSubmissionDispatcher(ctx.store,
      submission => this.processSubmission(submission), submission => this.publishInterruption(submission));
  }

  /** Called once during startup of the single server process owning this instance DB. */
  recoverSubmissions(): void { this.dispatcher.recover(); }

  private submission(operationId: string, key?: string): McpSubmission | undefined {
    return (key === undefined ? this.ctx.store.db.prepare(`select * from mcp_operation_submissions
      where operation_id=? order by turn_sequence desc limit 1`).get(operationId)
      : this.ctx.store.db.prepare(`select * from mcp_operation_submissions
        where operation_id=? and idempotency_key=?`).get(operationId, key)) as McpSubmission | undefined;
  }

  private receipt(row: McpSubmission) {
    return { idempotencyKey: row.idempotency_key, turnSequence: row.turn_sequence,
      messageId: row.message_id, state: row.state };
  }

  private initialOperation(actor: McpActor, kind: McpSubmitInput["kind"], key: string) {
    const row = this.ctx.store.db.prepare(`select id from mcp_operations where user_id=? and server_id=?
      and client_id=? and grant_id=? and kind=? and initial_idempotency_key=?`)
      .get(actor.userId, actor.serverId, actor.clientId, actor.grantId, kind, key) as { id: string } | undefined;
    return row ? this.ownedOperation(actor, row.id) : null;
  }

  lookupReceipt(actor: McpActor, input: { kind: McpSubmitInput["kind"]; idempotencyKey: string; operationId?: string }): McpOperationStatusPayload {
    const key = input.idempotencyKey.trim();
    const operation = input.operationId ? this.ownedOperation(actor, input.operationId) : this.initialOperation(actor, input.kind, key);
    if (!operation || operation.kind !== input.kind) throw operationError("submission_not_found");
    const row = this.submission(operation.id, key);
    if (!row) throw operationError("submission_not_found");
    return { ...this.status(actor, operation.id), submission: this.receipt(row) };
  }

  private pendingWork(actor: McpActor, operation: McpOperationRecord) {
    // Include all immutable turn bindings: turn N+1 may have been accepted before N dispatched work.
    const sources = this.ctx.store.db.prepare(`select source_message_id from mcp_continuation_authorities
      where operation_id=?`).all(operation.id) as Array<{ source_message_id: string }>;
    const sourceIds = [...new Set([...sources.map(row => row.source_message_id), ...(operation.inboundMessageId ? [operation.inboundMessageId] : [])])];
    const executionIds = new Set(operation.executionIds);
    const bridgeIds = new Set(operation.bridgeRequestIds);
    for (const source of sourceIds) {
      const rows = this.ctx.store.db.prepare(`select id from runtime_executions where communication_return_source_message_id=?
        and communication_return_user_id=? and server_id=?`).all(source, actor.userId, actor.serverId) as Array<{ id: string }>;
      rows.forEach(row => executionIds.add(row.id));
      this.ctx.store.listCrossWorkspaceRequestsForSourceMessage(source)
        .filter(request => request.sourceWorkspaceId === actor.serverId).forEach(request => bridgeIds.add(request.id));
    }
    const bridgeService = new WorkspaceBridgeRequestService(this.ctx);
    return {
      executionIds: this.operationExecutions(operation, [...executionIds]).filter(execution => !isTerminal(execution.status)).map(execution => execution.id),
      bridgeRequestIds: [...bridgeIds].filter(id => {
        const state = bridgeService.status({ ...actor, source: "mcp" }, id).state;
        return state !== "completed" && state !== "failed";
      })
    };
  }

  /** Persistence only. A successful tool result acknowledges receipt, not execution. */
  accept(actor: McpActor, input: McpSubmitInput): McpOperationStatusPayload {
    const message = input.message.trim();
    const key = input.idempotencyKey.trim();
    if (!message) throw operationError("message_required");
    if (!key || key.length > 200) throw operationError("idempotency_key_required");
    const accepted = this.ctx.store.db.transaction(() => {
      let operation = input.operationId ? this.ownedOperation(actor, input.operationId) : this.initialOperation(actor, input.kind, key);
      if (operation && operation.kind !== input.kind) throw operationError("operation_kind_mismatch");
      if (operation?.conversationId && input.conversationId && operation.conversationId !== input.conversationId) {
        throw operationError("conversation_operation_mismatch");
      }
      const saved = operation ? this.submission(operation.id, key) : undefined;
      if (saved && operation?.conversationId) {
        const hash = createHash("sha256").update(JSON.stringify([input.kind, message, operation.conversationId])).digest("hex");
        if (saved.payload_hash !== hash) throw operationError("mcp_submission_conflict");
        return { operationId: operation.id, inbound: null };
      }
      // A retry resolves the saved conversation before consulting the user's current conversation.
      const target = this.assistantConversation(actor, operation?.conversationId ?? input.conversationId);
      operation ??= this.persistence.createOperation({ ...actor, kind: input.kind, prompt: message,
        idempotencyKey: key, conversationId: target.conversation.id });
      if (!operation.conversationId) operation = this.persistence.bindOperationConversation(operation.id, target.conversation.id)!;
      const hash = createHash("sha256").update(JSON.stringify([input.kind, message, target.conversation.id])).digest("hex");
      const existing = this.submission(operation.id, key);
      if (existing) {
        if (existing.payload_hash !== hash) throw operationError("mcp_submission_conflict");
        return { operationId: operation.id, inbound: null };
      }
      const pending = this.pendingWork(actor, operation);
      const claim = this.persistence.claimOperationEvent(operation.id, key, message, pending);
      // Legacy submissions have no durable queue receipt. Never redispatch their historical event.
      if (!claim.claimed) return { operationId: operation.id, inbound: null };
      const user = this.ctx.store.getUser(actor.userId)!;
      const inbound = this.ctx.store.sendMessage({ target: target.channel.id, conversationId: target.conversation.id,
        content: message, senderType: "human", senderId: actor.userId, senderName: user.displayName, serverId: actor.serverId }).message;
      this.persistence.recordContinuationAuthority({ operationId: operation.id, sourceMessageId: inbound.id,
        userId: actor.userId, serverId: actor.serverId, conversationId: target.conversation.id,
        clientId: actor.clientId, grantId: actor.grantId, grantedScopes: actor.scopes,
        accessMode: input.kind === "query" ? "read_only" : "manage", sourceConversationKey: operation.sourceConversationKey });
      this.persistence.updateOperation(operation.id, { turnSequence: claim.turnSequence, inboundMessageId: inbound.id });
      const now = new Date().toISOString();
      this.ctx.store.db.prepare(`insert into mcp_operation_submissions
        (operation_id,idempotency_key,turn_sequence,message_id,payload_hash,state,created_at,updated_at)
        values (?,?,?,?,?,'queued',?,?)`).run(operation.id, key, claim.turnSequence, inbound.id, hash, now, now);
      return { operationId: operation.id, inbound };
    })();
    if (accepted.inbound) {
      try { this.ctx.emitRealtimeMessage(accepted.inbound); } catch { console.error("[mcp-submission] realtime_unavailable"); }
    }
    this.dispatcher.schedule();
    const row = this.submission(accepted.operationId, key);
    return { ...this.status(actor, accepted.operationId), ...(row ? { submission: this.receipt(row) } : {}) };
  }

  /** Internal synchronous compatibility helper; HTTP/MCP handlers must use accept(). */
  async submit(actor: McpActor, input: McpSubmitInput): Promise<McpOperationStatusPayload> {
    const accepted = this.accept(actor, input);
    while (true) {
      const row = this.submission(accepted.operationId, input.idempotencyKey.trim());
      if (!row || row.state === "dispatched" || row.state === "interrupted") return this.status(actor, accepted.operationId);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }

  private publishInterruption(submission: McpSubmission): void {
    const { store } = this.ctx;
    const notice = store.db.transaction(() => {
      const row = this.submission(submission.operation_id, submission.idempotency_key);
      const operation = this.persistence.getOperation(submission.operation_id);
      const source = store.getMessage(submission.message_id);
      if (!row || row.state !== "interrupted" || row.notice_message_id || !operation || !source || source.deletedAt ||
          !store.canUserAccessChannel(operation.userId, source.channelId)) return null;
      const assistant = store.ensureDefaultCommunicationAgent(operation.serverId);
      const content = "Your message was saved, but TYR processing was interrupted. Some actions may already have started. Review this operation before requesting further work; this submission will not be replayed automatically.";
      const reply = store.sendMessage({ target: source.channelId, conversationId: source.conversationId,
        allowClosedConversation: true, senderType: "agent", senderId: assistant.id, senderName: assistant.displayName,
        serverId: operation.serverId, content, result: { version: 1, status: "partial", title: "TYR processing was interrupted",
          summary: content, communicationRequest: { sourceMessageId: source.id } } }).message;
      store.db.prepare(`update mcp_operation_submissions set notice_message_id=? where operation_id=? and idempotency_key=?`)
        .run(reply.id, operation.id, row.idempotency_key);
      this.persistence.updateOperation(operation.id, { turnSequence: row.turn_sequence, assistantReplyMessageId: reply.id,
        responseText: content, resultMetadata: { assistantOutcomeStatus: "partial", error: { code: row.error_code ?? "processing_interrupted" } } });
      return reply;
    })();
    if (notice) { try { this.ctx.emitRealtimeMessage(notice); } catch { console.error("[mcp-submission] realtime_unavailable"); } }
  }

  readConversationHistory(actor: McpActor, input: { conversationId: string; after?: string; limit?: number }): McpConversationHistoryPayload {
    const { store } = this.ctx;
    const conversation = store.getConversation(input.conversationId);
    const channel = conversation ? store.resolveTarget(conversation.channelId, actor.serverId) : null;
    const identity = channel?.dmIdentity;
    // 只读历史必须定位已存在的 Human-TYR DM；不能调用会创建 Agent、DM 或当前会话的 ensure 路径。
    if (
      !conversation || conversation.id !== input.conversationId || (conversation.serverId ?? "local") !== actor.serverId ||
      !channel || channel.id !== conversation.channelId || (channel.serverId ?? "local") !== actor.serverId ||
      channel.type !== "dm" || identity?.kind !== "human_agent" || identity.humanUserId !== actor.userId ||
      !isCommunicationAgent(store.getAgent(identity.agentId)) || !store.canUserAccessChannel(actor.userId, channel.id)
    ) throw operationError("conversation_not_found");

    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw operationError("conversation_history_limit_invalid");
    let afterSeq = 0;
    if (input.after !== undefined) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(input.after)) throw new Error("invalid_cursor");
        const cursor = JSON.parse(Buffer.from(input.after, "base64url").toString("utf8")) as { v?: unknown; c?: unknown; s?: unknown };
        if (cursor.v !== 1 || cursor.c !== conversation.id || !Number.isSafeInteger(cursor.s) || (cursor.s as number) < 0) {
          throw new Error("invalid_cursor");
        }
        afterSeq = cursor.s as number;
      } catch {
        throw operationError("conversation_history_cursor_invalid");
      }
    }

    const history = store.readConversationHistory(conversation.id, limit, undefined, undefined, afterSeq);
    const messages = history?.messages ?? [];
    const lastSeq = messages.at(-1)?.seq ?? afterSeq;
    const nextCursor = Buffer.from(JSON.stringify({ v: 1, c: conversation.id, s: lastSeq })).toString("base64url");
    const hasMore = Boolean(store.db.prepare(
      "select 1 from messages where conversation_id = ? and channel_id = ? and kind = 'chat' and seq > ? limit 1"
    ).get(conversation.id, channel.id, lastSeq));
    if (!messages.length) return { conversationId: conversation.id, messages: [], nextCursor, hasMore };

    const ids = messages.map((message) => message.id);
    const idSet = new Set(ids);
    const placeholders = ids.map(() => "?").join(", ");
    const operationIdsByMessage = new Map<string, Set<string>>();
    const executionIdsByMessage = new Map<string, Set<string>>();
    const bridgeRequestIdsByMessage = new Map<string, Set<string>>();
    const addId = (map: Map<string, Set<string>>, messageId: string | null, id: string) => {
      if (!messageId || !idSet.has(messageId)) return;
      const linked = map.get(messageId) ?? new Set<string>();
      linked.add(id);
      map.set(messageId, linked);
    };

    // 关联只使用已落库的精确 message ID；同会话或时间相近本身不代表属于同一次 operation。
    const operationRows = store.db.prepare(
      `select id, inbound_message_id, assistant_reply_message_id from mcp_operations
       where user_id = ? and server_id = ? and conversation_id = ?
       and (inbound_message_id in (${placeholders}) or assistant_reply_message_id in (${placeholders}))`
    ).all(actor.userId, actor.serverId, conversation.id, ...ids, ...ids) as Array<{
      id: string; inbound_message_id: string | null; assistant_reply_message_id: string | null;
    }>;
    for (const row of operationRows) {
      addId(operationIdsByMessage, row.inbound_message_id, row.id);
      addId(operationIdsByMessage, row.assistant_reply_message_id, row.id);
    }

    const executionRows = store.db.prepare(
      `select id, communication_return_message_id, communication_return_source_message_id
       from runtime_executions where server_id = ? and communication_return_message_id in (${placeholders})`
    ).all(actor.serverId, ...ids) as Array<{
      id: string; communication_return_message_id: string | null; communication_return_source_message_id: string | null;
    }>;
    for (const row of executionRows) addId(executionIdsByMessage, row.communication_return_message_id, row.id);
    const sourceIds = [...new Set(executionRows.map((row) => row.communication_return_source_message_id).filter((id): id is string => Boolean(id)))];
    if (sourceIds.length) {
      const sourcePlaceholders = sourceIds.map(() => "?").join(", ");
      const returnOperationRows = store.db.prepare(
        `select id, inbound_message_id from mcp_operations
         where user_id = ? and server_id = ? and conversation_id = ? and inbound_message_id in (${sourcePlaceholders})`
      ).all(actor.userId, actor.serverId, conversation.id, ...sourceIds) as Array<{ id: string; inbound_message_id: string }>;
      for (const execution of executionRows) {
        for (const operation of returnOperationRows) {
          if (execution.communication_return_source_message_id === operation.inbound_message_id) {
            addId(operationIdsByMessage, execution.communication_return_message_id, operation.id);
          }
        }
      }
    }

    const bridgeRows = store.db.prepare(
      `select case when response_kind is null then id else terminal_request_id end as request_id,
         origin_message_id, local_message_id, continuation_reply_message_id
       from cross_workspace_messages
       where ((response_kind is null and source_workspace_id = ?)
         or (response_kind is not null and target_workspace_id = ? and terminal_request_id is not null))
       and (origin_message_id in (${placeholders}) or local_message_id in (${placeholders})
         or continuation_reply_message_id in (${placeholders}))`
    ).all(actor.serverId, actor.serverId, ...ids, ...ids, ...ids) as Array<{
      request_id: string; origin_message_id: string | null; local_message_id: string | null; continuation_reply_message_id: string | null;
    }>;
    for (const row of bridgeRows) {
      addId(bridgeRequestIdsByMessage, row.origin_message_id, row.request_id);
      addId(bridgeRequestIdsByMessage, row.local_message_id, row.request_id);
      addId(bridgeRequestIdsByMessage, row.continuation_reply_message_id, row.request_id);
    }

    return {
      conversationId: conversation.id,
      messages: messages.map((message) => {
        const role = message.senderType === "human" ? "user" : message.senderType;
        return sanitizeHumanVisibleValue({
          id: message.id,
          createdAt: message.createdAt,
          role,
          author: { type: role, id: message.senderId, name: message.senderName },
          content: message.deletedAt ? "" : sanitizeHumanVisibleText(message.content),
          ...(operationIdsByMessage.has(message.id) ? { operationIds: [...operationIdsByMessage.get(message.id)!].sort() } : {}),
          ...(message.sourceExecutionId || executionIdsByMessage.has(message.id)
            ? { executionIds: [...new Set([message.sourceExecutionId, ...(executionIdsByMessage.get(message.id) ?? [])].filter((id): id is string => Boolean(id)))].sort() }
            : {}),
          ...(bridgeRequestIdsByMessage.has(message.id) ? { bridgeRequestIds: [...bridgeRequestIdsByMessage.get(message.id)!].sort() } : {}),
          ...(message.attachments?.length ? { attachments: message.attachments } : {}),
          ...(message.deletedAt ? { deletedAt: message.deletedAt } : {})
        });
      }),
      nextCursor,
      hasMore
    };
  }

  private assistantConversation(actor: McpActor, requestedConversationId?: string): {
    channel: ChannelRecord;
    conversation: ConversationRecord;
  } {
    // MCP 只能进入当前授权用户与 TYR 的固定 pair DM，不能借 conversationId 越权到其他 DM。
    const assistant = this.ctx.store.ensureDefaultCommunicationAgent(actor.serverId);
    const channel = this.ctx.store.getOrCreateAgentDm(assistant.id, actor.userId);
    if (!channel || (channel.serverId ?? "local") !== actor.serverId || !this.ctx.store.canUserAccessChannel(actor.userId, channel.id)) {
      throw operationError("conversation_not_found");
    }
    const conversation = requestedConversationId
      ? this.ctx.store.getConversation(requestedConversationId)
      : this.ctx.store.getActiveConversation(channel.id) ?? this.ctx.store.ensureActiveConversation(channel.id, { type: "human", id: actor.userId });
    if (!conversation || conversation.channelId !== channel.id) throw operationError("conversation_not_found");
    // 历史 TYR 会话仍可写，但归档或关闭后的会话不能再接收 MCP continuation。
    if (conversation.status !== "active" || conversation.archivedAt) throw operationError("conversation_closed");
    return { channel, conversation };
  }

  private ownedOperation(actor: McpActor, operationId: string): McpOperationRecord {
    const operation = this.persistence.getOperation(operationId);
    if (!operation || operation.userId !== actor.userId || operation.serverId !== actor.serverId || operation.clientId !== actor.clientId || operation.grantId !== actor.grantId) {
      throw operationError("operation_not_found");
    }
    return operation;
  }

  startConversation(actor: McpActor, input: { title?: string; idempotencyKey: string }): McpConversationStartPayload {
    const idempotencyKey = input.idempotencyKey.trim().slice(0, 200);
    if (!idempotencyKey) throw operationError("idempotency_key_required");
    const title = input.title?.trim();
    if (title && Array.from(title).length > 72) throw operationError("conversation_title_too_long");
    const assistant = this.ctx.store.ensureDefaultCommunicationAgent(actor.serverId);
    const channel = this.ctx.store.getOrCreateAgentDm(assistant.id, actor.userId);
    if (!channel || (channel.serverId ?? "local") !== actor.serverId || !this.ctx.store.canUserAccessChannel(actor.userId, channel.id)) {
      throw operationError("conversation_not_found");
    }
    const result = this.persistence.getOrCreateConversationStart({
      userId: actor.userId,
      serverId: actor.serverId,
      clientId: actor.clientId,
      grantId: actor.grantId,
      idempotencyKey
    }, () => this.ctx.store.createConversation({
      channelId: channel.id,
      title,
      startedByType: "human",
      startedById: actor.userId,
      // TYR 的旧会话保持可写；MCP 与 Web 只共享 current pointer，不关闭 Telegram/Email 等兄弟会话。
      closeExisting: false,
      setActive: true,
      resetStatus: "not_applicable"
    }));
    const currentChannel = this.ctx.store.resolveTarget(channel.id, actor.serverId) ?? channel;
    if (result.created) {
      this.ctx.broadcastRealtime("conversation:created", {
        conversation: result.conversation,
        channelId: channel.id,
        activeConversationId: result.conversation.id,
        source: "mcp"
      }, { channelId: channel.id, userId: actor.userId });
      this.ctx.store.recordAuditEvent({
        kind: "mcp_tyr_assistant_conversation_started",
        actorType: "user",
        actorId: actor.userId,
        resourceType: "channel",
        resourceId: channel.id,
        serverId: actor.serverId,
        metadata: {
          clientId: actor.clientId,
          grantId: actor.grantId,
          channelId: channel.id,
          conversationId: result.conversation.id,
          activeConversationId: currentChannel.activeConversationId ?? result.conversation.id
        }
      });
    }
    return {
      conversationId: result.conversation.id,
      channelId: channel.id,
      title: result.conversation.title,
      createdAt: result.conversation.startedAt,
      active: currentChannel.activeConversationId === result.conversation.id,
      created: result.created
    };
  }

  private async processSubmission(submission: McpSubmission): Promise<void> {
    const operation = this.persistence.getOperation(submission.operation_id)!;
    const inbound = this.ctx.store.getMessage(submission.message_id);
    if (!inbound || inbound.deletedAt || !operation.conversationId) throw operationError("mcp_submission_access_changed");
    const restored = this.persistence.resolveContinuationAuthority({ sourceMessageId: inbound.id,
      userId: operation.userId, serverId: operation.serverId, channelId: inbound.channelId,
      conversationId: operation.conversationId, operationId: operation.id });
    if (restored.status !== "restored") throw operationError(restored.errorCode);
    const actor: McpActor = { userId: operation.userId, serverId: operation.serverId, clientId: operation.clientId,
      grantId: operation.grantId, scopes: restored.sourceContext.grantedScopes };
    const target = this.assistantConversation(actor, operation.conversationId);
    const pending = this.pendingWork(actor, operation);
    this.persistence.updateOperation(operation.id, { turnSequence: submission.turn_sequence, ...pending });
    const sourceEventKey = `mcp:${operation.id}:${submission.idempotency_key}`;
    const normalizedMessage = inbound.content;
    const input = { kind: operation.kind };
    const eventClaim = { turnSequence: submission.turn_sequence };
    let executionIds: string[] = [];
    let assistantOutcome: CommunicationAgentReplyOutcome | undefined;
    const assistantReply = await maybeReplyToCommunicationAgentDm(this.ctx, {
      message: inbound, agent: this.ctx.store.ensureDefaultCommunicationAgent(actor.serverId),
      sourceContext: { ...restored.sourceContext, sourceEventKey, mcpAuthorityMessageId: inbound.id },
      allowHandoff: operation.kind === "request",
      onExecutionIds: ids => { executionIds = ids; }, onOutcome: outcome => { assistantOutcome = outcome; }
    });
    const delivery = { inboundMessage: inbound, assistantReply, executionIds, assistantOutcome };
    // A stale completion must not overwrite a recovered interrupted receipt or the current turn.
    if (this.submission(operation.id, submission.idempotency_key)?.state !== "running") return;
    this.ctx.store.db.transaction(() => {
      const assistant = this.ctx.store.ensureDefaultCommunicationAgent(actor.serverId);
      const draft = this.ctx.store.getCommunicationAgentManagementDraftBySourceEvent({
        serverId: actor.serverId,
        userId: actor.userId,
        assistantAgentId: assistant.id,
        source: "mcp",
        sourceConversationKey: operation.sourceConversationKey,
        sourceEventKey
      }) ?? this.ctx.store.getLatestCommunicationAgentManagementDraft({
        serverId: actor.serverId,
        userId: actor.userId,
        assistantAgentId: assistant.id,
        source: "mcp",
        sourceConversationKey: operation.sourceConversationKey
      });
      const executionIds = [...new Set([...pending.executionIds, ...(delivery.executionIds ?? [])])];
      const bridgeRequestIds = [...new Set([...pending.bridgeRequestIds, ...(delivery.assistantOutcome?.bridgeRequestIds ?? [])])];
      const assistantOutcomeStatus = delivery.assistantOutcome?.error
        ? delivery.assistantOutcome.status
        : undefined;
      const resultMetadata = delivery.assistantOutcome?.error
        ? {
            error: {
              code: delivery.assistantOutcome.error.code,
              requiredTool: delivery.assistantOutcome.error.requiredTool,
              requiredScope: delivery.assistantOutcome.error.requiredScope,
              actionModeRequired: delivery.assistantOutcome.error.actionModeRequired,
              newOperationRequired: delivery.assistantOutcome.error.newOperationRequired,
              ...(delivery.assistantOutcome.error.blockedTool
                ? { blockedTool: delivery.assistantOutcome.error.blockedTool }
                : {})
            },
            ...(assistantOutcomeStatus ? { assistantOutcomeStatus } : {})
          }
        : undefined;
      this.persistence.updateOperation(operation.id, {
        turnSequence: eventClaim.turnSequence,
        prompt: normalizedMessage,
        inboundMessageId: delivery.inboundMessage.id,
        assistantReplyMessageId: delivery.assistantReply?.id ?? null,
        managementDraftId: draft?.id ?? null,
        executionIds,
        bridgeRequestIds,
        responseText: delivery.assistantReply?.content ?? null,
        resultMetadata: resultMetadata ?? null
      });
      this.ctx.store.recordAuditEvent({
        kind: "mcp_tyr_assistant_request",
        actorType: "user",
        actorId: actor.userId,
        resourceType: "server",
        resourceId: actor.serverId,
        serverId: actor.serverId,
        metadata: {
          operationId: operation.id,
          conversationId: target.conversation.id,
          kind: input.kind,
          clientId: actor.clientId,
          grantId: actor.grantId,
          inboundMessageId: delivery.inboundMessage.id,
          assistantReplyMessageId: delivery.assistantReply?.id ?? null,
          managementDraftId: draft?.id ?? null,
          executionIds,
          bridgeRequestIds,
          errorCode: resultMetadata?.error?.code ?? null
        }
      });
      if (input.kind === "query" && resultMetadata?.error?.code === "operation_not_allowed") {
        this.ctx.store.recordAuditEvent({
          kind: "mcp_query_management_blocked",
          actorType: "user",
          actorId: actor.userId,
          resourceType: "server",
          resourceId: actor.serverId,
          serverId: actor.serverId,
          metadata: {
            operationId: operation.id,
            clientId: actor.clientId,
            grantId: actor.grantId,
            requiredTool: resultMetadata.error.requiredTool ?? "tyr_assistant_request",
            requiredScope: resultMetadata.error.requiredScope ?? "tyr:manage",
            actionModeRequired: resultMetadata.error.actionModeRequired === true,
            newOperationRequired: resultMetadata.error.newOperationRequired === true,
            blockedTool: resultMetadata.error.blockedTool ?? null
          }
        });
      }
      this.ctx.store.db.prepare(`update mcp_operation_submissions set state='dispatched',updated_at=?
        where operation_id=? and idempotency_key=? and state='running'`)
        .run(new Date().toISOString(), operation.id, submission.idempotency_key);
    })();
  }

  status(actor: McpActor, operationId: string): McpOperationStatusPayload {
    const operation = this.ownedOperation(actor, operationId);
    const submission = this.submission(operationId);
    const draft = operation.managementDraftId
      ? this.ctx.store.getCommunicationAgentManagementDraft(operation.managementDraftId)
      : null;
    const lateExecutionIds = operation.inboundMessageId
      ? this.ctx.store.listRuntimeExecutions({ serverId: actor.serverId, limit: 1_000 })
        .filter((execution) => execution.communicationReturnSourceMessageId === operation.inboundMessageId &&
          execution.communicationReturnUserId === actor.userId)
        .map((execution) => execution.id)
      : [];
    const executions = this.operationExecutions(operation, [...new Set([...operation.executionIds, ...lateExecutionIds])]);
    const currentExecutions = this.operationExecutions(operation, [...new Set([...operation.currentExecutionIds, ...lateExecutionIds])]);
    const bridgeService = new WorkspaceBridgeRequestService(this.ctx);
    // A TYR worker may create the Bridge request only after the initial MCP turn finished.
    // Reconstruct late dependencies from the bound inbound message, not the stale initial snapshot.
    const lateBridgeRequests = operation.inboundMessageId
      ? this.ctx.store.listCrossWorkspaceRequestsForSourceMessage(operation.inboundMessageId)
        .filter((request) => request.sourceWorkspaceId === actor.serverId)
      : [];
    const bridgeRequestIds = [...new Set([...operation.bridgeRequestIds, ...lateBridgeRequests.map((request) => request.id)])];
    const bridges = bridgeRequestIds.flatMap((requestId) => {
      try {
        return [bridgeService.status({
          userId: actor.userId,
          serverId: actor.serverId,
          source: "mcp",
          clientId: actor.clientId,
          grantId: actor.grantId
        }, requestId)];
      } catch {
        return [];
      }
    });
    const bridgeByRequestId = new Map(bridges.map((bridge) => [bridge.bridgeRequestId, bridge]));
    const currentBridgeRequestIds = [...new Set([...operation.currentBridgeRequestIds, ...lateBridgeRequests.map((request) => request.id)])];
    const currentBridges = currentBridgeRequestIds.flatMap((requestId) => {
      const bridge = bridgeByRequestId.get(requestId);
      return bridge ? [bridge] : [];
    });
    const pendingApprovals = this.pendingApprovals(currentExecutions);
    const structuredError = operation.resultMetadata?.error;
    const assistantOutcomeStatus = operation.resultMetadata?.assistantOutcomeStatus;
    const workState = currentWorkState(currentExecutions, currentBridges);
    const bridgeContinuationPending = lateBridgeRequests.some((request) =>
      request.continuationState === "registered" || request.continuationState === "pending" || request.continuationState === "running"
    );
    const bridgeContinuationInterrupted = lateBridgeRequests.some((request) => request.continuationState === "interrupted");
    const managementDraftState = draft ? managementState(draft) : null;
    let state: McpOperationState;
    if (submission?.state === "queued" || submission?.state === "running") {
      state = submission.state;
    } else if (submission?.state === "interrupted") {
      state = "input_required";
    } else if (managementDraftState) {
      state = managementDraftState;
    } else if (workState === "blocked_on_peer_approval" || workState === "input_required") {
      state = workState;
    } else if (pendingApprovals.length) {
      state = "approval_required";
    } else if (workState === "queued" || workState === "running") {
      state = workState;
    } else if (bridgeContinuationPending || (assistantOutcomeStatus === "running" && workState !== "completed" && workState !== "partial")) {
      state = "running";
    } else if (bridgeContinuationInterrupted) {
      state = "partial";
    } else if (assistantOutcomeStatus === "partial") {
      state = "partial";
    } else if (structuredError || assistantOutcomeStatus === "failed") {
      // Assistant 自身失败但已有分支完成时仍有可交付结果，当前轮应明确标记 partial。
      state = workState === "completed" || workState === "partial" ? "partial" : "failed";
    } else {
      state = workState ?? "completed";
    }

    const finalMessageByExecutionId = new Map(executions.map((execution) => [
      execution.id,
      isTerminal(execution.status) ? this.ctx.store.findFinalMessageForExecution(execution.id) : null
    ]));
    const executionPayloads = executions.map((execution) => ({
      executionId: execution.id,
      agentId: execution.agentId,
      agentName: execution.agentDisplayName ?? execution.agentName,
      status: execution.status,
      hasFinalResult: Boolean(finalMessageByExecutionId.get(execution.id))
    }));
    const assistant = this.ctx.store.ensureDefaultCommunicationAgent(actor.serverId);
    const validatedPublicReturns = currentExecutions
      .map((execution) => {
        if (
          !execution.communicationReturnMessageId ||
          !execution.communicationReturnChannelId ||
          execution.communicationReturnUserId !== actor.userId
        ) return null;
        const message = this.ctx.store.getMessage(execution.communicationReturnMessageId);
        if (
          !message ||
          message.channelId !== execution.communicationReturnChannelId ||
          (operation.conversationId && message.conversationId !== operation.conversationId) ||
          message.senderType !== "agent" ||
          message.senderId !== assistant.id ||
          !this.ctx.store.canUserAccessChannel(actor.userId, message.channelId)
        ) return null;
        return { execution, message };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const bridgeContinuationMessages = lateBridgeRequests.flatMap((request) => {
      const message = request.continuationReplyMessageId
        ? this.ctx.store.getMessage(request.continuationReplyMessageId)
        : null;
      return message && message.senderType === "agent" && message.senderId === assistant.id &&
        message.channelId === request.originChannelId &&
        (!operation.conversationId || message.conversationId === operation.conversationId) &&
        this.ctx.store.canUserAccessChannel(actor.userId, message.channelId)
        ? [message] : [];
    });
    // Bridge 续接汇总此前结果；它派发的新 worker 公开回复仍须推进同一请求。
    const latestBridgeContinuation = bridgeContinuationMessages.sort((left, right) => left.seq - right.seq).at(-1);
    const validatedPublicReturnMessages = [...new Map(validatedPublicReturns.map(({ message }) => [message.id, message])).values()];
    const laterPublicReturnMessages = latestBridgeContinuation
      ? validatedPublicReturnMessages.filter((message) => message.channelId === latestBridgeContinuation.channelId &&
        message.seq > latestBridgeContinuation.seq)
      : [];
    const publicReturnMessages = latestBridgeContinuation
      ? laterPublicReturnMessages.length ? laterPublicReturnMessages : [latestBridgeContinuation]
      : validatedPublicReturnMessages;
    const publicResponse = publicReturnMessages.length > 0
      ? publicReturnMessages.map((message) => message.content).join("\n\n")
      : undefined;
    const bridgeResponse = currentBridges
      .filter((bridge) => bridge.response)
      .map((bridge) => bridge.response)
      .join("\n\n") || undefined;
    const initialAssistantReply = operation.assistantReplyMessageId
      ? this.ctx.store.getMessage(operation.assistantReplyMessageId)
      : null;
    const validatedInitialResponse = initialAssistantReply &&
      initialAssistantReply.senderType === "agent" &&
      initialAssistantReply.senderId === assistant.id &&
      this.ctx.store.canUserAccessChannel(actor.userId, initialAssistantReply.channelId)
      ? initialAssistantReply.content
      : undefined;
    // 下游 Agent final message 只用于内部执行状态；MCP 只能读取 TYR 明确发布到用户可见 DM 的消息。
    const executionById = new Map(currentExecutions.map((execution) => [execution.id, execution]));
    const operationRootIds = new Set(operation.currentExecutionIds);
    const rootIdForExecution = (execution: RuntimeExecutionRecord): string => {
      let current = execution;
      const visited = new Set<string>();
      while (current.sourceExecutionId && !visited.has(current.id)) {
        if (operationRootIds.has(current.id)) return current.id;
        visited.add(current.id);
        const parent = executionById.get(current.sourceExecutionId);
        if (!parent) break;
        current = parent;
      }
      return operationRootIds.has(current.id) ? current.id : execution.id;
    };
    const expectedPublicReplyRootIds = new Set(currentExecutions
      .filter((execution) => (
        execution.status === "completed" &&
        Boolean(execution.communicationReturnChannelId) &&
        execution.communicationReturnUserId === actor.userId
      ))
      .map(rootIdForExecution));
    const publishedPublicReplyRootIds = new Set(validatedPublicReturns
      .map(({ execution }) => rootIdForExecution(execution)));
    // communication return 会沿多跳 execution 继承；每个 operation 根链只需最终发布一次。
    const pendingPublicReplyRootIds = [...expectedPublicReplyRootIds]
      .filter((rootId) => !publishedPublicReplyRootIds.has(rootId));
    const publicReplyPending = pendingPublicReplyRootIds.length > 0;
    const publicReplyFailed = validatedPublicReturns
      .some(({ message }) => message.result?.status === "failed");
    // A worker can finish before its TYR callback/Bridge continuation. Active current
    // work and input/approval waits take precedence over the old worker reply deadline.
    const hasActiveCurrentState = ["input_required", "approval_required", "queued", "running", "blocked_on_peer_approval"].includes(state);
    const publicReplyTimedOut = !hasActiveCurrentState && pendingPublicReplyRootIds.some((rootId) => {
      const rootExecutions = currentExecutions.filter((execution) => rootIdForExecution(execution) === rootId);
      if (rootExecutions.some((execution) => !isTerminal(execution.status))) return false;
      const completionTimes = rootExecutions
        .filter((execution) => (
          execution.status === "completed" &&
          Boolean(execution.communicationReturnChannelId) &&
          execution.communicationReturnUserId === actor.userId
        ))
        .map((execution) => Date.parse(execution.completedAt ?? execution.updatedAt))
        .filter(Number.isFinite);
      return completionTimes.length > 0 && Date.now() - Math.max(...completionTimes) >= PUBLIC_REPLY_TIMEOUT_MS;
    });
    const publicReplyUnavailable = !hasActiveCurrentState && (publicReplyFailed || publicReplyTimedOut);
    const effectiveError = structuredError ?? (submission?.state === "interrupted"
      ? { code: submission.error_code ?? "processing_interrupted" }
      : bridgeContinuationInterrupted
      ? { code: "assistant_continuation_interrupted" }
      : publicReplyUnavailable ? { code: "public_reply_unavailable" } : undefined);
    if (publicReplyUnavailable) {
      const successfulPublicReplyCount = validatedPublicReturns
        .filter(({ message }) => message.result?.status !== "failed").length;
      // 部分 Agent 已由 TYR 成功公开时保留可交付结果，其他分支发布失败只把当前轮降为 partial。
      state = state === "partial" || successfulPublicReplyCount > 0 ? "partial" : "failed";
    } else if (publicReplyPending && (state === "completed" || state === "partial")) {
      state = "running";
    }
    const latestPublicReturn = [...publicReturnMessages]
      .sort((left, right) => left.channelId === right.channelId
        ? left.seq - right.seq : left.createdAt.localeCompare(right.createdAt)).at(-1);
    // Completed downstream steps do not complete an original request whose latest
    // validated TYR reply explicitly reports a partial outcome.
    if (state === "completed" && latestPublicReturn?.result?.status === "partial") state = "partial";
    const responseCandidates = [
      ...(validatedInitialResponse && initialAssistantReply
        ? [{ response: validatedInitialResponse, updatedAt: initialAssistantReply.createdAt }]
        : []),
      ...(publicResponse
        ? [{ response: publicResponse, updatedAt: publicReturnMessages.map((message) => message.createdAt).sort().at(-1) ?? operation.updatedAt }]
        : []),
      ...(!latestBridgeContinuation && bridgeResponse
        ? [{ response: bridgeResponse, updatedAt: currentBridges.filter((bridge) => bridge.response).map((bridge) => bridge.updatedAt).sort().at(-1) ?? operation.updatedAt }]
        : [])
    ];
    // 当前轮可能先发布 TYR 进度、再收到异步结果；只在本轮候选中按公开时间选择最新回复。
    const latestPublishedResponse = responseCandidates
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .at(-1)?.response;
    const observedTimestamps = [
      operation.updatedAt,
      draft?.resolvedAt,
      draft?.confirmedAt,
      ...currentExecutions.map((execution) => execution.updatedAt),
      ...pendingApprovals.map((approval) => approval.requestedAt),
      ...currentBridges.map((bridge) => bridge.updatedAt)
    ].filter((value): value is string => Boolean(value));
    const updatedAt = observedTimestamps.sort().at(-1) ?? operation.updatedAt;
    return sanitizeHumanVisibleValue({
      operationId: operation.id,
      ...(submission ? { submission: this.receipt(submission) } : {}),
      ...(operation.conversationId ? { conversationId: operation.conversationId } : {}),
      state,
      message: stateMessage(state),
      response: latestPublishedResponse ?? (publicReplyTimedOut ? PUBLIC_REPLY_UNAVAILABLE_TEXT : undefined) ?? draft?.replyText ?? operation.responseText,
      ...(effectiveError ? { error: effectiveError } : {}),
      management: draft ? {
        draftId: draft.id,
        operationId: draft.operationId,
        action: draft.action,
        stage: draft.stage,
        status: draft.status,
        choices: draft.choices,
        approvalRequired: draft.status === "pending" && draft.stage === "awaiting_confirmation"
      } : undefined,
      executions: executionPayloads,
      bridges,
      pendingApprovals: pendingApprovals.map((approval) => ({
        approvalId: approval.id,
        executionId: approval.executionId,
        kind: approval.kind,
        title: approval.title,
        detail: approval.detail,
        payload: approval.payload,
        requestedAt: approval.requestedAt
      })),
      updatedAt
    });
  }

  async waitForStatus(actor: McpActor, operationId: string, waitSeconds: number): Promise<McpOperationStatusPayload> {
    const initial = this.status(actor, operationId);
    const boundedMs = Math.max(0, Math.min(waitSeconds, 30)) * 1000;
    if (!boundedMs || ["completed", "partial", "failed", "cancelled"].includes(initial.state)) return initial;
    const initialSignature = this.statusSignature(initial);
    const deadline = Date.now() + boundedMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(350, Math.max(1, deadline - Date.now()))));
      const current = this.status(actor, operationId);
      if (this.statusSignature(current) !== initialSignature) return current;
    }
    return this.status(actor, operationId);
  }

  async resolveApproval(actor: McpActor, input: {
    operationId: string;
    approvalId: string;
    approvalType: "management" | "runtime";
    decision: RuntimeApprovalDecision;
    customResponse?: string;
  }): Promise<McpOperationStatusPayload> {
    const operation = this.ownedOperation(actor, input.operationId);
    if (input.approvalType === "management") {
      const existing = this.submission(operation.id, `management:${input.approvalId}:${input.decision}`);
      if (existing) return this.status(actor, operation.id);
      if (!operation.managementDraftId || operation.managementDraftId !== input.approvalId) throw operationError("approval_not_linked_to_operation");
      const draft = this.ctx.store.getCommunicationAgentManagementDraft(input.approvalId);
      if (!draft || draft.status !== "pending" || draft.stage !== "awaiting_confirmation") {
        return this.status(actor, operation.id);
      }
      if (input.decision === "custom") throw operationError("management_custom_decision_not_supported");
      return this.accept(actor, {
        kind: operation.kind,
        operationId: operation.id,
        message: input.decision === "approve" ? "confirm" : "cancel",
        idempotencyKey: `management:${input.approvalId}:${input.decision}`
      });
    }

    const executions = this.operationExecutions(operation, operation.executionIds);
    const approval = this.ctx.store.getRuntimeApproval(input.approvalId);
    if (!approval || !approval.executionId || !executions.some((execution) => execution.id === approval.executionId)) {
      throw operationError("approval_not_linked_to_operation");
    }
    if (!this.ctx.store.canUserResolveRuntimeApproval(actor.userId, approval)) {
      throw operationError("approval_resolver_forbidden");
    }
    if (input.decision === "custom" && !input.customResponse?.trim()) throw operationError("custom_response_required");
    const result = resolveRuntimeApprovalDecision(this.ctx, {
      approval,
      decision: input.decision,
      resolvedByUserId: actor.userId,
      customResponse: input.customResponse?.trim()
    });
    if ("blocked" in result) throw operationError(`${result.body.error}:${result.body.reason}`);
    this.ctx.store.recordAuditEvent({
      kind: "mcp_runtime_approval_resolved",
      actorType: "user",
      actorId: actor.userId,
      resourceType: "agent",
      resourceId: approval.agentId,
      serverId: actor.serverId,
      metadata: {
        operationId: operation.id,
        executionId: approval.executionId,
        decision: input.decision,
        clientId: actor.clientId,
        delivered: result.delivered
      }
    });
    return this.status(actor, operation.id);
  }

  private operationExecutions(operation: McpOperationRecord, rootExecutionIds: string[]): RuntimeExecutionRecord[] {
    const byId = new Map<string, RuntimeExecutionRecord>();
    const queue = [...rootExecutionIds];
    while (queue.length) {
      const executionId = queue.shift()!;
      if (byId.has(executionId)) continue;
      const execution = this.ctx.store.getRuntimeExecution(executionId);
      if (!execution || execution.serverId !== operation.serverId) continue;
      byId.set(execution.id, execution);
      for (const child of this.ctx.store.listChildRuntimeExecutionsForSourceIds([execution.id], 1000)) {
        if (!byId.has(child.id)) queue.push(child.id);
      }
    }
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private pendingApprovals(executions: RuntimeExecutionRecord[]): RuntimeApprovalRecord[] {
    const approvals: RuntimeApprovalRecord[] = [];
    for (const execution of executions) {
      approvals.push(...this.ctx.store.listRuntimeApprovals({ executionId: execution.id, limit: 1000 }).filter((approval) => approval.status === "pending"));
    }
    return [...new Map(approvals.map((approval) => [approval.id, approval])).values()];
  }

  private statusSignature(status: McpOperationStatusPayload): string {
    return createHash("sha256").update(JSON.stringify({
      state: status.state,
      submission: status.submission,
      management: status.management,
      pendingApprovals: status.pendingApprovals,
      response: status.response,
      error: status.error,
      // updatedAt 只聚合当前轮资源；历史诊断迟到更新不能提前结束当前轮长轮询。
      updatedAt: status.updatedAt
    })).digest("hex");
  }
}
