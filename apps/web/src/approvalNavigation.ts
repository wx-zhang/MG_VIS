import type { AppSnapshot, MessageRecord, RuntimeApprovalRecord, RuntimeExecutionRecord } from "@tyr-ai/contracts";

export type ApprovalDeepLinkTarget = {
  approval: RuntimeApprovalRecord;
  execution?: RuntimeExecutionRecord;
  channelId?: string;
  messageId?: string;
  conversationId?: string;
};

export function approvalDeepLinkTarget(snapshot: Pick<AppSnapshot, "channels" | "messages" | "runtimeApprovals" | "runtimeExecutions">, approvalId: string | undefined): ApprovalDeepLinkTarget | null {
  if (!approvalId) return null;
  const approval = (snapshot.runtimeApprovals ?? []).find((item) => item.id === approvalId);
  if (!approval) return null;
  const execution = approval.executionId
    ? (snapshot.runtimeExecutions ?? []).find((item) => item.id === approval.executionId)
    : undefined;
  // approval 可能来自多跳 handoff；优先打开根消息的 execution panel，用户才能在原始对话里看到完整链路。
  const candidateMessageIds = [execution?.rootMessageId, approval.messageId, execution?.messageId].filter(Boolean) as string[];
  for (const messageId of candidateMessageIds) {
    const message = (snapshot.messages ?? []).find((item) => item.id === messageId);
    if (message) return targetForMessage(approval, execution, message);
  }
  const threadChannelId = approval.threadChannelId ?? execution?.threadChannelId;
  if (threadChannelId) {
    const thread = (snapshot.channels ?? []).find((item) => item.id === threadChannelId);
    if (thread?.parentChannelId && thread.parentMessageId) {
      // thread 内审批没有直接消息时，退回父消息打开 execution panel。
      return {
        approval,
        execution,
        channelId: thread.parentChannelId,
        messageId: thread.parentMessageId
      };
    }
  }
  return {
    approval,
    execution,
    messageId: candidateMessageIds[0]
  };
}

function targetForMessage(
  approval: RuntimeApprovalRecord,
  execution: RuntimeExecutionRecord | undefined,
  message: MessageRecord
): ApprovalDeepLinkTarget {
  return {
    approval,
    execution,
    channelId: message.channelId,
    messageId: message.id,
    conversationId: message.conversationId
  };
}
