export type MessageResultOpenSource = {
  id: string;
  channelId: string;
  conversationId?: string | null;
  threadId?: string | null;
  parentChannelId?: string | null;
  parentMessageId?: string | null;
};

export function messageResultOpenTarget(item: MessageResultOpenSource): { channelId: string; messageId: string; conversationId?: string } {
  // Search/Saved 命中 thread reply 时，目标是 reply 本身；回父消息会丢失用户点击的具体结果。
  if (item.threadId) return { channelId: item.threadId, messageId: item.id };
  const target = {
    channelId: item.parentChannelId ?? item.channelId,
    messageId: item.id
  };
  // Search/Saved 的普通 DM 命中必须带回原 conversation，否则会落到当前 active DM。
  if (item.conversationId) return { ...target, conversationId: item.conversationId };
  return target;
}
