import type {
  AgentRecord,
  CommunicationAgentProgressRecord,
  RuntimeExecutionRecord
} from "@tyr-ai/contracts";

/**
 * Runtime worker 完成后重建 TYR 请求的终态进度；operationId 必须沿用原始用户消息，
 * 才能只清理这一轮临时状态而不影响同一 conversation 中的并发请求。
 */
export function communicationAgentReturnTerminalProgress(
  execution: RuntimeExecutionRecord,
  assistant: AgentRecord,
  phase: Extract<CommunicationAgentProgressRecord["phase"], "completed" | "needs_input" | "failed">,
  label: string,
  updatedAt = new Date().toISOString()
): CommunicationAgentProgressRecord | null {
  if (
    !execution.communicationReturnChannelId ||
    !execution.communicationReturnSourceMessageId ||
    !execution.communicationReturnSource
  ) return null;
  return {
    operationId: execution.communicationReturnSourceMessageId,
    sourceMessageId: execution.communicationReturnSourceMessageId,
    channelId: execution.communicationReturnChannelId,
    ...(execution.communicationReturnConversationId ? {
      conversationId: execution.communicationReturnConversationId
    } : {}),
    assistantAgentId: assistant.id,
    source: execution.communicationReturnSource,
    phase,
    label,
    // 终态只用于删除同 operation 的临时记录；沿用 execution 时间仍保证 payload 可独立校验。
    startedAt: execution.createdAt,
    updatedAt
  };
}
