import type { AgentRunRecord, ExecutionBlockRecord, ExecutionGroupRecord } from "@tyr-ai/contracts";

export interface ExecutionContextFilter {
  taskId?: string;
  messageId?: string;
  threadChannelId?: string;
}

export function executionGroupsForContext(
  groups: ExecutionGroupRecord[],
  filter: ExecutionContextFilter
): ExecutionGroupRecord[] {
  if (!filter.taskId && !filter.messageId && !filter.threadChannelId) return [];
  return groups
    .filter((group) => {
      if (filter.taskId && group.taskId === filter.taskId) return true;
      if (filter.messageId && group.messageId === filter.messageId) return true;
      if (filter.threadChannelId && group.threadChannelId === filter.threadChannelId) return true;
      return false;
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function executionBlocksForGroup(
  blocks: ExecutionBlockRecord[],
  groupId: string,
  agentId?: string
): ExecutionBlockRecord[] {
  return blocks
    .filter((block) => block.groupId === groupId)
    .filter((block) => !agentId || block.agentId === agentId)
    .sort((left, right) => left.groupSequence - right.groupSequence);
}

export function agentRunsForGroup(runs: AgentRunRecord[], groupId: string): AgentRunRecord[] {
  return runs
    .filter((run) => run.groupId === groupId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function pinnedExecutionBlocks(blocks: ExecutionBlockRecord[]): ExecutionBlockRecord[] {
  return blocks
    .filter((block) => block.kind === "approval_gate" && block.status === "pending")
    .sort((left, right) => left.groupSequence - right.groupSequence);
}
