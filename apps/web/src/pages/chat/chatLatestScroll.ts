export type ChatWorkspaceTab = "chat" | "tasks" | "files";

export type ChatScrollMetrics = Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">;

export const CHAT_FOLLOW_LATEST_THRESHOLD_PX = 96;

export type ChatLatestScrollIntentInput = {
  activeTab: ChatWorkspaceTab;
  channelId?: string;
  focusMessageId?: string;
  /** 本人发送的新消息必须回到底部，不能套用远端消息的历史阅读保护。 */
  forceLatestForLocalSend?: boolean;
  followingLatest: boolean;
  hasMessageList: boolean;
  latestContentChanged: boolean;
  latestMessageId: string;
  messagesLoading: boolean;
  pendingLatestChannelId: string | null;
};

export type ChatLatestScrollIntent = {
  action: "none" | "focus" | "latest" | "notify";
  clearPendingLatest: boolean;
};

export function isChatScrollAtLatest(
  metrics: ChatScrollMetrics,
  thresholdPx = CHAT_FOLLOW_LATEST_THRESHOLD_PX
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= thresholdPx;
}

export function chatLatestScrollIntent(input: ChatLatestScrollIntentInput): ChatLatestScrollIntent {
  if (!input.channelId || input.activeTab !== "chat" || !input.hasMessageList) {
    return { action: "none", clearPendingLatest: false };
  }
  if (input.focusMessageId) {
    return { action: "focus", clearPendingLatest: true };
  }
  if (input.pendingLatestChannelId === input.channelId && !input.messagesLoading) {
    return { action: "latest", clearPendingLatest: true };
  }
  if (!input.pendingLatestChannelId && input.latestMessageId && input.latestContentChanged) {
    // 用户离开底部后，新内容只提示，不夺走正在阅读的历史位置。
    return {
      action: input.forceLatestForLocalSend || input.followingLatest ? "latest" : "notify",
      clearPendingLatest: false
    };
  }
  return { action: "none", clearPendingLatest: false };
}
