import type { AppSnapshot } from "@tyr-ai/contracts";

export function channelUnreadCount(snapshot: Pick<AppSnapshot, "unreadCounts">, channelId: string): number {
  // unreadCounts 的 key 是实际 channel id；thread unread 不并入父 channel，避免父频道和 thread 提示互相污染。
  return snapshot.unreadCounts?.[channelId] ?? 0;
}

export function unreadBadgeLabel(count: number | null | undefined): string | null {
  // 0 代表当前用户已读，不渲染 badge；正数直接展示服务端真源里的未读数量。
  return count && count > 0 ? String(count) : null;
}
