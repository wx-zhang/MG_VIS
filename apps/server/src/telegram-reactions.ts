import type { TyrDb } from "@tyr-ai/db";
import { sendTelegramMessage, telegramConfigFromEnv, telegramConfigured, type TelegramConnectorConfig } from "./telegram-connector";

// A small Bot API-supported palette; a reaction never asserts that the human Owner has read or agreed.
export const TYR_TELEGRAM_REACTIONS = ["👍", "❤", "🔥", "🎉", "🤔", "👀", "🙏", "😁"] as const;

export async function reactToTelegramMessage(store: TyrDb, input: {
  userId: string; serverId: string; messageId: string; emoji: string;
}, options: { config?: TelegramConnectorConfig; send?: typeof sendTelegramMessage } = {}): Promise<void> {
  if (input.emoji !== "" && !(TYR_TELEGRAM_REACTIONS as readonly string[]).includes(input.emoji)) throw new Error("reaction_not_supported");
  const origin = store.db.prepare("select * from telegram_message_origins where message_id = ?")
    .get(input.messageId) as { user_id: string; server_id: string; telegram_account_id: string; chat_id: string; telegram_message_id: number; reaction: string | null } | undefined;
  const message = store.getMessage(input.messageId);
  const account = origin ? store.getTelegramAccount(origin.telegram_account_id) : null;
  if (!origin || origin.user_id !== input.userId || origin.server_id !== input.serverId ||
      !message || message.deletedAt || message.senderType !== "human" || message.senderId !== input.userId ||
      !store.canUserAccessChannel(input.userId, message.channelId) ||
      !account || account.status !== "active" || account.revokedAt || account.userId !== input.userId ||
      account.serverId !== input.serverId || account.telegramChatId !== origin.chat_id) throw new Error("reaction_source_unavailable");
  if (origin.reaction === input.emoji) return;
  const config = options.config ?? telegramConfigFromEnv();
  if (!telegramConfigured(config)) throw new Error("telegram_not_configured");
  await (options.send ?? sendTelegramMessage)({ method: "setMessageReaction", chat_id: origin.chat_id,
    message_id: origin.telegram_message_id, reaction: input.emoji ? [{ type: "emoji", emoji: input.emoji }] : [] }, config);
  store.db.prepare("update telegram_message_origins set reaction = ?, updated_at = ? where message_id = ?")
    .run(input.emoji, new Date().toISOString(), input.messageId);
  store.recordAuditEvent({ kind: "tyr_message_reaction_set", actorType: "agent", actorId: store.ensureDefaultCommunicationAgent(input.serverId).id,
    resourceType: "message", resourceId: input.messageId, serverId: input.serverId, metadata: { emoji: input.emoji } });
}
