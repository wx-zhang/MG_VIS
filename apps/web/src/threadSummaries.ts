import type { AppSnapshot } from "@tyr-ai/contracts";

export type MessageThreadSummary = {
  threadChannelId: string;
  replyCount: number;
  unreadCount: number;
  lastReplyAt: string | null;
  participantIds: string[];
};

export function messageThreadSummaries(snapshot: AppSnapshot, channelId: string): Record<string, MessageThreadSummary> {
  const result: Record<string, MessageThreadSummary> = {};
  for (const thread of snapshot.channels.filter((item) => item.type === "thread" && item.parentChannelId === channelId && item.parentMessageId)) {
    const replies = snapshot.messages.filter((message) => message.channelId === thread.id);
    // parentMessageId 对应源消息 id，消息行可用它稳定挂载 reply count 和打开 thread。
    result[thread.parentMessageId!] = {
      threadChannelId: thread.id,
      replyCount: replies.length,
      // Thread 未读独立挂在 thread channel 上，父消息只展示提示，不吞并父频道 unread。
      unreadCount: snapshot.unreadCounts?.[thread.id] ?? 0,
      lastReplyAt: replies.at(-1)?.createdAt ?? null,
      participantIds: [...new Set(replies.map((message) => message.senderId))]
    };
  }
  return result;
}
