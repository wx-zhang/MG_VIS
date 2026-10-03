import { isCommunicationAgent, type MessageRecord } from "@tyr-ai/contracts";
import type { TelegramOutboundDeliveryRecord, TyrDb } from "@tyr-ai/db";
import { sanitizeHumanVisibleText } from "./output-disclosure";

export const TELEGRAM_TEXT_LIMIT = 4096;

export interface TyrAssistantTelegramSyncInput {
  userId: string;
  serverId: string;
  channelId: string;
  messages: MessageRecord[];
}

export interface TyrAssistantTelegramSyncResult {
  status: "enqueued" | "skipped";
  reason?: "telegram_not_bound" | "workspace_mismatch" | "not_tyr_assistant_dm" | "no_text_messages";
  deliveries: TelegramOutboundDeliveryRecord[];
}

export function enqueueTyrAssistantTelegramMessages(
  store: TyrDb,
  input: TyrAssistantTelegramSyncInput
): TyrAssistantTelegramSyncResult {
  const account = store.getTelegramAccountByUserId(input.userId);
  if (!account) return skipped("telegram_not_bound");
  // Telegram 绑定严格归属于一个 workspace，禁止活动 workspace 切换后把消息发到旧绑定。
  if (account.serverId !== input.serverId) return skipped("workspace_mismatch");

  const channel = store.resolveTarget(input.channelId, input.serverId);
  const assistant = channel?.dmPeerAgentId ? store.getAgent(channel.dmPeerAgentId) : null;
  if (
    !channel || channel.type !== "dm" ||
    !assistant || !isCommunicationAgent(assistant) ||
    (channel.serverId ?? "local") !== input.serverId ||
    (assistant.serverId ?? "local") !== input.serverId ||
    !store.canUserAccessChannel(input.userId, channel.id)
  ) return skipped("not_tyr_assistant_dm");
  const telegramConversation = store.getOrCreateCommunicationAgentExternalConversation({
    source: "telegram",
    serverId: input.serverId,
    userId: input.userId,
    assistantAgentId: assistant.id,
    sourceConversationKeys: [`telegram:${account.telegramChatId}`],
    title: "Telegram"
  });
  if (!telegramConversation) return skipped("not_tyr_assistant_dm");

  const deliveries = input.messages.flatMap((message) => {
    if (
      message.channelId !== channel.id ||
      message.conversationId !== telegramConversation.id ||
      message.deletedAt ||
      (message.kind && message.kind !== "chat")
    ) return [];

    const content = sanitizeHumanVisibleText(message.content.trim());
    if (!content) return [];

    let telegramText = "";
    if (message.senderType === "human" && message.senderId === input.userId) {
      // Bot API 会把 Web 用户消息作为 Bot 消息发送，因此保留紧凑来源标签避免误认成 Assistant 回复。
      telegramText = `🌐 You · Web\n${content}`;
    } else if (message.senderType === "agent" && message.senderId === assistant.id) {
      // 私聊本身已经标明 TYR 身份，回复只保留正文以贴近 Telegram 原生对话。
      telegramText = content;
    } else {
      return [];
    }

    const chunks = splitTelegramText(telegramText);
    return store.enqueueTelegramOutboundDeliveries({
      telegramAccountId: account.id,
      telegramChatId: account.telegramChatId,
      messageId: message.id,
      messageSeq: message.seq,
      chunks
    });
  });

  return deliveries.length > 0
    ? { status: "enqueued", deliveries }
    : skipped("no_text_messages");
}

export function splitTelegramText(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("telegram_text_limit_invalid");
  const characters = Array.from(text);
  if (characters.length === 0) return [];

  const chunks: string[] = [];
  let offset = 0;
  while (offset < characters.length) {
    let end = Math.min(offset + limit, characters.length);
    if (end < characters.length) {
      // 优先在后半段的换行或空格处分段，保留代码和自然语言的可读性。
      const minimumBreak = offset + Math.floor(limit / 2);
      for (let candidate = end; candidate > minimumBreak; candidate -= 1) {
        if (characters[candidate - 1] === "\n" || characters[candidate - 1] === " ") {
          end = candidate;
          break;
        }
      }
    }
    chunks.push(characters.slice(offset, end).join(""));
    offset = end;
  }
  return chunks;
}

function skipped(reason: NonNullable<TyrAssistantTelegramSyncResult["reason"]>): TyrAssistantTelegramSyncResult {
  return { status: "skipped", reason, deliveries: [] };
}
