import type { AgentWakeContextMessage, AgentWakeThreadContext, AttachmentRecord, ChannelRecord, MessageRecord } from "@tyr-ai/contracts";

export const THREAD_RUNTIME_ROOT_MESSAGE_LIMIT = 8;
export const THREAD_RUNTIME_REPLY_LIMIT = 20;

type ThreadRuntimeContextStore = {
  resolveTarget(target: string, serverId?: string): ChannelRecord | null;
  getMessage(messageId: string): MessageRecord | null;
  getAttachment(attachmentId: string): AttachmentRecord | null;
  readConversationHistory(conversationId: string, limit?: number, around?: string | number, before?: number, after?: number): { messages: MessageRecord[] } | null;
  readHistory(target: string, limit?: number, around?: string | number, before?: number, after?: number, serverId?: string): { messages: MessageRecord[] } | null;
};

function runtimeContextMessage(store: ThreadRuntimeContextStore, message: MessageRecord): AgentWakeContextMessage {
  const attachments = message.attachments?.length
    ? message.attachments
    : (message.attachmentIds ?? []).map((attachmentId) => store.getAttachment(attachmentId)).filter((item): item is AttachmentRecord => Boolean(item));
  // 软删除只保留会话位置，不允许已经删除的正文重新进入 Runtime 上下文。
  return {
    message_id: message.id,
    sender_id: message.senderId,
    sender_type: message.senderType,
    sender_name: message.senderName,
    content: message.deletedAt ? "[Message deleted]" : message.content,
    timestamp: message.createdAt,
    ...(message.deletedAt || !message.quote ? {} : { quote: message.quote }),
    ...(message.deletedAt || !attachments.length ? {} : {
      attachments: attachments.map(({ id, filename, mimeType, sizeBytes }) => ({ id, filename, mimeType, sizeBytes }))
    })
  };
}

export function threadRuntimeContextForMessage(
  store: ThreadRuntimeContextStore,
  message: MessageRecord
): AgentWakeThreadContext | undefined {
  if (message.channelType !== "thread") return undefined;
  const thread = store.resolveTarget(message.channelId);
  if (!thread || thread.type !== "thread" || !thread.parentChannelId || !thread.parentMessageId) return undefined;
  const parentMessage = store.getMessage(thread.parentMessageId);
  const parentChannel = store.resolveTarget(thread.parentChannelId, thread.serverId);
  if (!parentMessage || !parentChannel || parentMessage.channelId !== parentChannel.id) return undefined;

  const conversationId = parentMessage.conversationId;
  const rootHistory = conversationId
    ? store.readConversationHistory(
      conversationId,
      THREAD_RUNTIME_ROOT_MESSAGE_LIMIT + 1,
      undefined,
      parentMessage.seq + 1
    )?.messages ?? []
    : [];
  // 根上下文严格截止到父消息；父消息单独放入 anchor，避免重复占用 prompt。
  const rootMessages = rootHistory
    .filter((item) => item.seq < parentMessage.seq && item.id !== parentMessage.id)
    .slice(-THREAD_RUNTIME_ROOT_MESSAGE_LIMIT)
    .map((item) => runtimeContextMessage(store, item));

  const priorThreadMessages = store.readHistory(
    thread.id,
    THREAD_RUNTIME_REPLY_LIMIT + 1,
    undefined,
    message.seq,
    undefined,
    thread.serverId
  )?.messages ?? [];
  const threadHistoryTruncated = priorThreadMessages.length > THREAD_RUNTIME_REPLY_LIMIT;

  return {
    parent_channel_id: parentChannel.id,
    ...(conversationId ? { conversation_id: conversationId } : {}),
    root_messages: rootMessages,
    parent_message: runtimeContextMessage(store, parentMessage),
    thread_messages: priorThreadMessages.slice(-THREAD_RUNTIME_REPLY_LIMIT).map((item) => runtimeContextMessage(store, item)),
    thread_history_truncated: threadHistoryTruncated
  };
}
