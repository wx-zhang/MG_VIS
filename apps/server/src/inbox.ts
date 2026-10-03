import type { AppSnapshot, InboxItem, InboxResponse, MessageRecord, PublicSenderType } from "@tyr-ai/contracts";

function publicSenderType(type: MessageRecord["senderType"]): PublicSenderType {
  // Web API 对外沿用参考产品的 user 命名，避免把内部 human 枚举泄露到前台协议。
  return type === "human" ? "user" : type;
}

function inboxMessagePreview(message: Pick<MessageRecord, "content" | "deletedAt">): string {
  // 删除的消息仍可定位，但 Inbox 不再暴露原始正文。
  return message.deletedAt ? "Message deleted" : message.content;
}

function itemTimestamp(item: InboxItem): string {
  return item.kind === "thread" ? item.lastActivityAt : item.lastMessageAt;
}

function firstUnreadMessage(messages: MessageRecord[], unreadCount: number): MessageRecord | null {
  if (unreadCount <= 0 || messages.length === 0) return null;
  // unreadCount 表示从某条消息到最新消息的数量，因此可以从尾部反推第一条未读。
  return messages[Math.max(0, messages.length - unreadCount)] ?? null;
}

export interface ThreadInboxState {
  threadChannelId: string;
  parentChannelId: string;
  parentMessageId: string;
  itemKey: string;
  latestActivityMessageId: string;
  firstUnreadMessageId: string | null;
  unreadCount: number;
}

export function threadInboxStateFromSnapshot(snapshot: AppSnapshot, threadChannelId: string): ThreadInboxState | null {
  const thread = snapshot.channels.find((channel) => channel.id === threadChannelId && channel.type === "thread" && channel.parentChannelId && channel.parentMessageId);
  if (!thread) return null;
  const parentMessage = snapshot.messages.find((message) => message.id === thread.parentMessageId);
  if (!parentMessage) return null;
  const replies = snapshot.messages.filter((message) => message.channelId === thread.id);
  // Thread 以最新回复为定位 key，未读数仍挂在 thread channel 上。
  const latest = replies.at(-1) ?? parentMessage;
  const unreadCount = snapshot.unreadCounts?.[thread.id] ?? 0;
  const unread = firstUnreadMessage(replies.length ? replies : [parentMessage], unreadCount);
  return {
    threadChannelId: thread.id,
    parentChannelId: thread.parentChannelId!,
    parentMessageId: parentMessage.id,
    itemKey: latest.id,
    latestActivityMessageId: latest.id,
    firstUnreadMessageId: unread?.id ?? null,
    unreadCount
  };
}

export function listInboxItemsFromSnapshot(snapshot: AppSnapshot, options: {
  limit: number;
  offset: number;
}): InboxResponse {
  const unreadCounts = snapshot.unreadCounts ?? {};
  const channelById = new Map(snapshot.channels.map((channel) => [channel.id, channel]));
  const messagesByChannel = new Map<string, MessageRecord[]>();
  for (const message of snapshot.messages) {
    const messages = messagesByChannel.get(message.channelId) ?? [];
    messages.push(message);
    messagesByChannel.set(message.channelId, messages);
  }

  const channelItems = snapshot.channels
    // 历史群聊不得因 Inbox 聚合重新进入人类产品面。
    .filter((channel) => channel.type === "dm")
    .map((channel): InboxItem | null => {
      const messages = messagesByChannel.get(channel.id) ?? [];
      const last = messages.at(-1);
      const unreadCount = unreadCounts[channel.id] ?? 0;
      if (!last || unreadCount <= 0) return null;
      const unread = firstUnreadMessage(messages, unreadCount);
      return {
        kind: "channel",
        itemKey: last.id,
        channelId: channel.id,
        channelName: channel.name,
        channelDisplayName: channel.displayName,
        channelType: channel.type,
        lastMessageId: last.id,
        lastMessageConversationId: last.conversationId ?? null,
        firstUnreadMessageId: unread?.id ?? null,
        firstUnreadConversationId: unread?.conversationId ?? null,
        lastMessageAt: last.createdAt,
        lastMessagePreview: inboxMessagePreview(last),
        lastMessageSenderType: publicSenderType(last.senderType),
        lastMessageSenderId: last.senderId,
        lastMessageSenderName: last.senderName,
        unreadCount
      };
    })
    .filter((item): item is InboxItem => Boolean(item));

  const threadItems = snapshot.channels
    .filter((channel) => channel.type === "thread" && channel.parentChannelId && channel.parentMessageId)
    .map((thread): InboxItem | null => {
      const parentChannel = channelById.get(thread.parentChannelId!);
      const parentMessage = snapshot.messages.find((message) => message.id === thread.parentMessageId);
      const replies = messagesByChannel.get(thread.id) ?? [];
      const latest = replies.at(-1);
      if (!parentChannel || parentChannel.type !== "dm" || !parentMessage || !latest) return null;
      const state = threadInboxStateFromSnapshot(snapshot, thread.id);
      if (!state || state.unreadCount <= 0) return null;
      return {
        kind: "thread",
        itemKey: state.itemKey,
        threadChannelId: thread.id,
        parentMessageId: parentMessage.id,
        parentChannelId: parentChannel.id,
        parentChannelName: parentChannel.name,
        parentChannelDisplayName: parentChannel.displayName,
        parentChannelType: parentChannel.type,
        parentMessagePreview: inboxMessagePreview(parentMessage),
        parentMessageSenderType: publicSenderType(parentMessage.senderType),
        parentMessageSenderId: parentMessage.senderId,
        latestActivityPreview: inboxMessagePreview(latest),
        latestActivitySenderType: publicSenderType(latest.senderType),
        latestActivitySenderId: latest.senderId,
        latestActivityMessageId: state.latestActivityMessageId,
        firstUnreadMessageId: state.firstUnreadMessageId,
        lastActivityAt: latest.createdAt,
        lastReplyAt: latest.createdAt,
        replyCount: replies.length,
        unreadCount: state.unreadCount
      };
    })
    .filter((item): item is InboxItem => Boolean(item));

  const unreadItems = [...channelItems, ...threadItems].sort((a, b) => itemTimestamp(b).localeCompare(itemTimestamp(a)));
  const start = Math.max(0, options.offset);
  const max = Math.max(1, Math.min(options.limit, 100));

  return {
    items: unreadItems.slice(start, start + max),
    hasMore: start + max < unreadItems.length,
    nextCursor: null,
    totalCount: unreadItems.length,
    totalUnreadCount: unreadItems.reduce((sum, item) => sum + item.unreadCount, 0)
  };
}
