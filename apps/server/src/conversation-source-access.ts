import type {
  GovernanceDecisionRecord,
  RuntimeApprovalRecord,
  RuntimeExecutionRecord,
  SafetyAssessmentRecord
} from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";

export function runtimeExecutionSourceChannelId(
  store: Pick<TyrDb, "getMessage">,
  execution: RuntimeExecutionRecord
): string | null {
  // delegation 子执行的直接消息位于内部 Agent pair DM；Human 权限必须继承最初的 Human-Agent 根消息。
  const rootChannelId = execution.rootMessageId ? store.getMessage(execution.rootMessageId)?.channelId : null;
  return rootChannelId ?? store.getMessage(execution.messageId)?.channelId ?? execution.threadChannelId ?? null;
}

export function canUserAccessRuntimeExecutionSource(
  store: Pick<TyrDb, "getMessage" | "canUserAccessChannel">,
  userId: string,
  execution: RuntimeExecutionRecord
): boolean {
  const channelId = runtimeExecutionSourceChannelId(store, execution);
  return Boolean(channelId && store.canUserAccessChannel(userId, channelId));
}

export function runtimeApprovalSourceChannelId(
  store: Pick<TyrDb, "getMessage" | "getRuntimeExecution">,
  approval: RuntimeApprovalRecord
): string | null {
  // 审批跟随 execution 的根来源，不能被中间 Agent pair DM 误判为对 Human 不可见。
  const execution = approval.executionId ? store.getRuntimeExecution(approval.executionId) : null;
  if (execution) {
    const executionChannelId = runtimeExecutionSourceChannelId(store, execution);
    if (executionChannelId) return executionChannelId;
  }
  const directMessageChannelId = approval.messageId ? store.getMessage(approval.messageId)?.channelId : null;
  if (directMessageChannelId) return directMessageChannelId;
  if (approval.threadChannelId) return approval.threadChannelId;
  return null;
}

export function canUserAccessRuntimeApprovalSource(
  store: Pick<TyrDb, "getMessage" | "getRuntimeExecution" | "canUserAccessChannel">,
  userId: string,
  approval: RuntimeApprovalRecord
): boolean {
  const channelId = runtimeApprovalSourceChannelId(store, approval);
  // Approval 是可产生外部副作用的操作；来源缺失或已冷藏时必须 fail closed。
  return Boolean(channelId && store.canUserAccessChannel(userId, channelId));
}

export function canUserAccessSafetyAssessmentSource(
  store: Pick<TyrDb, "getMessage" | "getRuntimeExecution" | "getRuntimeApproval" | "canUserAccessChannel">,
  userId: string,
  assessment: SafetyAssessmentRecord
): boolean {
  const approval = assessment.approvalId ? store.getRuntimeApproval(assessment.approvalId) : null;
  if (approval) return canUserAccessRuntimeApprovalSource(store, userId, approval);
  const execution = assessment.executionId ? store.getRuntimeExecution(assessment.executionId) : null;
  if (execution) return canUserAccessRuntimeExecutionSource(store, userId, execution);
  if (assessment.messageId) {
    const channelId = store.getMessage(assessment.messageId)?.channelId;
    if (channelId) return store.canUserAccessChannel(userId, channelId);
  }
  return Boolean(assessment.threadChannelId && store.canUserAccessChannel(userId, assessment.threadChannelId));
}

export function canUserAccessGovernanceDecisionSource(
  store: Pick<TyrDb, "getMessage" | "getRuntimeExecution" | "getRuntimeApproval" | "canUserAccessChannel">,
  userId: string,
  decision: GovernanceDecisionRecord
): boolean {
  const approval = decision.approvalId ? store.getRuntimeApproval(decision.approvalId) : null;
  if (approval) return canUserAccessRuntimeApprovalSource(store, userId, approval);
  const execution = decision.executionId ? store.getRuntimeExecution(decision.executionId) : null;
  if (execution) return canUserAccessRuntimeExecutionSource(store, userId, execution);
  if (decision.messageId) {
    const channelId = store.getMessage(decision.messageId)?.channelId;
    if (channelId) return store.canUserAccessChannel(userId, channelId);
  }
  return Boolean(decision.threadChannelId && store.canUserAccessChannel(userId, decision.threadChannelId));
}
