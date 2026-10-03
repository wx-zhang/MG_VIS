import type { AppSnapshot } from "@tyr-ai/contracts";

export type ChannelThreadSummary = {
  threadChannelId: string;
  replyCount: number;
  lastReplyAt: string | null;
  participantIds: string[];
};

export function listChannelThreadSummariesFromSnapshot(snapshot: AppSnapshot, channelId: string): Record<string, ChannelThreadSummary> {
  const result: Record<string, ChannelThreadSummary> = {};
  for (const thread of snapshot.channels.filter((item) => item.type === "thread" && item.parentChannelId === channelId && item.parentMessageId)) {
    const replies = snapshot.messages.filter((message) => message.channelId === thread.id);
    // parentMessageId 是 message -> thread 的稳定 key，前端可直接挂到源消息上展示 reply count。
    result[thread.parentMessageId!] = {
      threadChannelId: thread.id,
      replyCount: replies.length,
      lastReplyAt: replies.at(-1)?.createdAt ?? null,
      participantIds: [...new Set(replies.map((message) => message.senderId))]
    };
  }
  return result;
}
