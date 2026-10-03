import type { InboxItem } from "@tyr-ai/contracts";

export type InboxOpenTarget = {
  channelId: string;
  messageId: string;
  conversationId?: string;
};

export function inboxReadPath(item: InboxItem): string {
  // Thread 的未读状态挂在 thread channel 上，不能用父 channel 的 read 接口，否则 Inbox item 不会消失。
  const channelId = item.kind === "thread" ? item.threadChannelId : item.channelId;
  return `/api/channels/${encodeURIComponent(channelId)}/read`;
}

export function channelUnreadPath(channelId: string): string {
  // Unread 是当前用户的 Inbox 标记，不创建消息；频道页按钮只复用已有服务端状态转换。
  return `/api/channels/${encodeURIComponent(channelId)}/unread`;
}

export function channelReadPath(channelId: string): string {
  // Read 只清当前用户在这个 channel 上的未读标记，消息和其他成员状态都不受影响。
  return `/api/channels/${encodeURIComponent(channelId)}/read`;
}

export function inboxOpenTarget(item: InboxItem): InboxOpenTarget {
  const isThread = item.kind === "thread";
  const channelId = isThread ? item.threadChannelId : item.channelId;
  // Inbox 只保留未读视图，打开时始终聚焦第一条未读消息。
  const messageId = isThread
    ? item.firstUnreadMessageId ?? item.latestActivityMessageId
    : item.firstUnreadMessageId ?? item.lastMessageId;
  if (isThread) return { channelId, messageId };
  const conversationId = item.firstUnreadMessageId
    ? item.firstUnreadConversationId
    : item.lastMessageConversationId;
  return conversationId ? { channelId, messageId, conversationId } : { channelId, messageId };
}
