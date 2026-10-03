import type { MessageRecord } from "@tyr-ai/contracts";
import {
  maybeReplyToCommunicationAgentDm,
  type CommunicationAgentReplyOutcome
} from "./communication-agent";
import type { CommunicationAgentSourceContext } from "./communication-agent-source";
import type { ServerRouteContext } from "./server-context";
import { getMcpPersistence } from "./mcp-persistence";
export { markImmediateWorkspaceBridgeExternalReturn } from "./workspace-bridge-external-return";

export interface ExternalCommunicationAgentDeliveryInput {
  userId: string;
  serverId: string;
  content: string;
  source: "telegram" | "email" | "mcp";
  sourceConversationKey: string;
  sourceConversationAliases?: string[];
  /** 已由服务端鉴权并解析出的真实 TYR conversation；MCP 用它固定 Operation 上下文。 */
  conversationId?: string;
  conversationTitle?: string;
  sourceEventKey?: string;
  externalRef?: string;
  clientId?: string;
  grantId?: string;
  grantedScopes?: string[];
  accessMode?: "read_only" | "manage";
  allowHandoff?: boolean;
}

export interface ExternalCommunicationAgentDeliveryResult {
  status: "delivered" | "assistant_unavailable" | "workspace_unavailable";
  inboundMessage?: MessageRecord;
  assistantReply?: MessageRecord;
  sourceContext?: CommunicationAgentSourceContext;
  executionIds?: string[];
  assistantOutcome?: CommunicationAgentReplyOutcome;
}

type ExternalCommunicationAgentContext = Pick<ServerRouteContext,
  "store" |
  "publicServerUrl" |
  "emitRealtimeMessage" |
  "emitRealtimeMachineUpdated"
> & Partial<Pick<ServerRouteContext,
  "broadcastRealtime" |
  "assistantLlmConfig" |
  "assistantLlmDecide" |
  "assistantToolLoop"
>>;

export async function deliverExternalMessageToCommunicationAgent(
  ctx: ExternalCommunicationAgentContext,
  input: ExternalCommunicationAgentDeliveryInput
): Promise<ExternalCommunicationAgentDeliveryResult> {
  const user = ctx.store.getUser(input.userId);
  if (!user) return { status: "workspace_unavailable" };
  const server = ctx.store.listServersForUser(user.id).find((item) => item.id === input.serverId);
  if (!server) return { status: "workspace_unavailable" };

  const assistant = ctx.store.ensureDefaultCommunicationAgent(input.serverId);
  const dm = ctx.store.getOrCreateAgentDm(assistant.id, user.id);
  if (!dm) return { status: "assistant_unavailable" };
  const externalConversation = input.source === "telegram" || input.source === "email"
    ? ctx.store.getOrCreateCommunicationAgentExternalConversation({
      source: input.source,
      serverId: input.serverId,
      userId: user.id,
      assistantAgentId: assistant.id,
      sourceConversationKeys: [input.sourceConversationKey, ...(input.sourceConversationAliases ?? [])],
      title: input.conversationTitle ?? (input.source === "telegram" ? "Telegram" : "Email")
    })
    : null;
  if ((input.source === "telegram" || input.source === "email") && !externalConversation) {
    return { status: "assistant_unavailable" };
  }

  const inbound = ctx.store.sendMessage({
    target: dm.id,
    ...((externalConversation?.id ?? input.conversationId) ? { conversationId: externalConversation?.id ?? input.conversationId } : {}),
    content: input.content,
    senderType: "human",
    senderId: user.id,
    senderName: user.displayName,
    serverId: input.serverId
  }).message;
  ctx.emitRealtimeMessage(inbound);

  if (input.source === "telegram" && input.externalRef) {
    const ref = JSON.parse(input.externalRef);
    const account = ctx.store.getTelegramAccountByUserId(user.id);
    if (account?.serverId === input.serverId && account.telegramChatId === ref.chatId &&
        account.telegramUserId === ref.telegramUserId && Number.isSafeInteger(ref.telegramMessageId) && ref.telegramMessageId > 0) {
      ctx.store.db.prepare(`insert or ignore into telegram_message_origins
        (message_id, user_id, server_id, telegram_account_id, chat_id, telegram_message_id, updated_at)
        values (?, ?, ?, ?, ?, ?, ?)`).run(inbound.id, user.id, input.serverId, account.id, ref.chatId, ref.telegramMessageId, new Date().toISOString());
    }
  }

  if (input.source === "mcp") {
    if (!input.externalRef || !input.clientId || !input.grantId || !input.grantedScopes ||
        !input.accessMode || !inbound.conversationId) throw new Error("mcp_authorization_context_missing");
    getMcpPersistence(ctx.store).recordContinuationAuthority({
      operationId: input.externalRef,
      sourceMessageId: inbound.id,
      userId: input.userId,
      serverId: input.serverId,
      conversationId: inbound.conversationId,
      clientId: input.clientId,
      grantId: input.grantId,
      grantedScopes: input.grantedScopes,
      accessMode: input.accessMode,
      sourceConversationKey: input.sourceConversationKey
    });
  }

  const sourceContext: CommunicationAgentSourceContext = {
    source: input.source,
    // 认证后的外部通道统一绑定真实 Tyr conversation，不能继续依赖易变化的主题或 chat 提示值。
    sourceConversationKey: externalConversation?.id ?? input.sourceConversationKey,
    // 外部系统没有稳定事件 ID 时，复用刚创建的 Tyr message ID，禁止随机 fallback。
    sourceEventKey: input.sourceEventKey || inbound.id,
    ...(input.externalRef ? { externalRef: input.externalRef } : {}),
    ...(input.clientId ? { clientId: input.clientId } : {}),
    ...(input.grantId ? { grantId: input.grantId } : {}),
    ...(input.grantedScopes ? { grantedScopes: [...input.grantedScopes] } : {}),
    ...(input.accessMode ? { accessMode: input.accessMode } : {}),
    ...(input.source === "mcp" ? { mcpAuthorityMessageId: inbound.id } : {})
  };

  let executionIds: string[] = [];
  let assistantOutcome: CommunicationAgentReplyOutcome | undefined;
  const assistantReply = await maybeReplyToCommunicationAgentDm({
    ...ctx,
    // 独立邮件处理和测试上下文可能没有 realtime broadcaster；此时只跳过进度广播，不影响消息交付。
    broadcastRealtime: ctx.broadcastRealtime ?? (() => undefined)
  } as ServerRouteContext, {
    message: inbound,
    agent: assistant,
    sourceContext,
    allowHandoff: input.allowHandoff,
    onExecutionIds: (ids) => { executionIds = ids; },
    onOutcome: (outcome) => { assistantOutcome = outcome; }
  });

  return {
    status: "delivered",
    inboundMessage: inbound,
    assistantReply: assistantReply ?? undefined,
    sourceContext,
    executionIds,
    ...(assistantOutcome ? { assistantOutcome } : {})
  };
}
