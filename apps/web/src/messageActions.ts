import type { AppSnapshot, MessageRecord } from "@tyr-ai/contracts";

export type MessageActionId = "reply-thread" | "quote" | "copy" | "save" | "mark-unread" | "stop-execution" | "delete-message";

export type MessageActionItem = {
  id: MessageActionId;
  label: string;
};

export type MessageActionMenuPlacement = "bottom" | "top";

export type MessageActionMenuAnchorRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type MessageActionMenuPosition = {
  left: number;
  top: number;
  placement: MessageActionMenuPlacement;
};

export type MessageActionMenuPositionInput = {
  buttonRect: MessageActionMenuAnchorRect;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  edgeGap?: number;
  menuGap?: number;
};

export type MessageActionOptions = {
  canReplyInThread: boolean;
  threadReplyCount?: number;
  canQuote: boolean;
  canCopy: boolean;
  canSave: boolean;
  saved: boolean;
  canMarkUnread: boolean;
  canStopExecution?: boolean;
  canDelete?: boolean;
};

export type MessageActionContext = Pick<MessageRecord, "channelType" | "senderType">;

export function messageActionItems(options: MessageActionOptions): MessageActionItem[] {
  const items: MessageActionItem[] = [];
  // 菜单顺序跟用户实际工作流一致：先沟通上下文，再处理消息状态。
  if (options.canReplyInThread) {
    const replyCount = options.threadReplyCount ?? 0;
    items.push({
      id: "reply-thread",
      label: replyCount > 0 ? `Open thread · ${replyCount} ${replyCount === 1 ? "reply" : "replies"}` : "Reply in thread"
    });
  }
  if (options.canQuote) items.push({ id: "quote", label: "Quote" });
  if (options.canCopy) items.push({ id: "copy", label: "Copy" });
  if (options.canSave) items.push({ id: "save", label: options.saved ? "Unsave" : "Save" });
  if (options.canMarkUnread) items.push({ id: "mark-unread", label: "Mark unread" });
  if (options.canStopExecution) items.push({ id: "stop-execution", label: "Stop execution" });
  if (options.canDelete) items.push({ id: "delete-message", label: "Delete message" });
  return items;
}

export function messageSupportsReactions(message: Pick<MessageRecord, "channelType" | "deletedAt">): boolean {
  // 普通群聊已下线；Reaction 只保留给仍可见的 DM thread。
  return !message.deletedAt && message.channelType === "thread";
}

export function messagePrimaryActionItems(items: MessageActionItem[], context: MessageActionContext): MessageActionItem[] {
  return items.filter((item) => (
    (context.channelType === "dm" && item.id === "reply-thread") ||
    // Agent DM 同时把 Agent 回复的 Copy 提升为快捷按钮。
    (context.channelType === "dm" && context.senderType === "agent" && item.id === "copy")
  ));
}

export function messageOverflowActionItems(items: MessageActionItem[], context: MessageActionContext): MessageActionItem[] {
  const primaryIds = new Set(messagePrimaryActionItems(items, context).map((item) => item.id));
  return items.filter((item) => !primaryIds.has(item.id));
}

export function messageUnreadPath(messageId: string): string {
  // 消息菜单上的 Mark unread 以具体消息为起点，和频道顶部“最新消息未读”的快捷入口区分开。
  return `/api/messages/${encodeURIComponent(messageId)}/unread`;
}

export function messageDeletePath(messageId: string): string {
  return `/api/messages/${encodeURIComponent(messageId)}`;
}

export function messageExecutionCancelPath(messageId: string): string {
  return `/api/messages/${encodeURIComponent(messageId)}/executions/cancel`;
}

export type MessageDeleteExecutionStatus = "pending_approval" | "running" | "failed" | "completed" | "partial";

export function canDeleteMessageForViewer(
  snapshot: Pick<AppSnapshot, "currentUser" | "agents">,
  message: Pick<MessageRecord, "senderType" | "senderId" | "deletedAt">
): boolean {
  if (message.deletedAt) return false;
  if (message.senderType === "human") return message.senderId === snapshot.currentUser.id;
  if (message.senderType === "agent") {
    const agent = snapshot.agents.find((item) => item.id === message.senderId);
    // Agent 输出按 owner 归属处理；非本人 Agent 的消息不显示删除入口，避免误删协作审计。
    return agent?.ownerUserId === snapshot.currentUser.id;
  }
  return false;
}

export function messageDeleteConfirmationForMessage(
  snapshot: Pick<AppSnapshot, "channels">,
  message: Pick<MessageRecord, "id">,
  executionSummary?: { status: MessageDeleteExecutionStatus } | null
): string {
  return messageDeleteConfirmationText(messageDeleteConfirmationInputForMessage(snapshot, message, executionSummary));
}

export function messageDeleteConfirmationContentForMessage(
  snapshot: Pick<AppSnapshot, "channels">,
  message: Pick<MessageRecord, "id">,
  executionSummary?: { status: MessageDeleteExecutionStatus } | null
): { title: string; description?: string } {
  return messageDeleteConfirmationContent(messageDeleteConfirmationInputForMessage(snapshot, message, executionSummary));
}

function messageDeleteConfirmationInputForMessage(
  snapshot: Pick<AppSnapshot, "channels">,
  message: Pick<MessageRecord, "id">,
  executionSummary?: { status: MessageDeleteExecutionStatus } | null
): {
  executionStatus?: MessageDeleteExecutionStatus;
  startsThread: boolean;
} {
  return {
    executionStatus: executionSummary?.status,
    startsThread: snapshot.channels.some((channel) => channel.type === "thread" && channel.parentMessageId === message.id)
  };
}

export function messageDeleteConfirmationText(input: {
  executionStatus?: MessageDeleteExecutionStatus;
  startsThread?: boolean;
}): string {
  const content = messageDeleteConfirmationContent(input);
  return [content.title, content.description].filter(Boolean).join("\n\n");
}

export function messageDeleteConfirmationContent(input: {
  executionStatus?: MessageDeleteExecutionStatus;
  startsThread?: boolean;
}): { title: string; description?: string } {
  const activeExecution = input.executionStatus === "running" || input.executionStatus === "pending_approval";
  const terminalExecution = input.executionStatus === "completed" || input.executionStatus === "failed" || input.executionStatus === "partial";
  const title = activeExecution
    ? "This message is still running. Stop execution and delete?"
    : terminalExecution
      ? "This message is linked to execution history. Delete the message and keep the execution reference?"
      : input.startsThread
        ? "This message starts a thread. Delete it and keep the thread?"
        : "Delete this message?";
  const references = [
    activeExecution || terminalExecution ? "execution" : "",
    input.startsThread ? "thread" : ""
  ].filter(Boolean);
  if (references.length <= 1) return { title };
  return {
    title,
    description: `${capitalize(joinReferenceLabels(references))} references will be kept.`
  };
}

function joinReferenceLabels(labels: string[]): string {
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

export function messageActionMenuPosition(input: MessageActionMenuPositionInput): MessageActionMenuPosition {
  const edgeGap = input.edgeGap ?? 8;
  const menuGap = input.menuGap ?? 6;
  const maxLeft = Math.max(edgeGap, input.viewportWidth - input.menuWidth - edgeGap);
  const left = Math.min(Math.max(edgeGap, input.buttonRect.right - input.menuWidth), maxLeft);
  const canOpenBelow = input.buttonRect.bottom + menuGap + input.menuHeight <= input.viewportHeight - edgeGap;
  if (canOpenBelow) {
    return { left, top: input.buttonRect.bottom + menuGap, placement: "bottom" };
  }

  // 菜单使用 viewport 坐标，底部空间不足时向上展开，避免 thread/card 滚动容器裁剪选项。
  return {
    left,
    top: Math.max(edgeGap, input.buttonRect.top - menuGap - input.menuHeight),
    placement: "top"
  };
}
