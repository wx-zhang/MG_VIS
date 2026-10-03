import type { AgentRunRecord, ExecutionGroupRecord, MessageExecutionSummaryItemRecord, MessageExecutionSummaryRecord, MessageExecutionSummaryStatus, MessageRecord, RuntimeApprovalRecord, RuntimeExecutionRecord } from "@tyr-ai/contracts";
import type { ServerRouteContext } from "./server-context";

export type MessageExecutionSummaryResult = {
  runtimeExecutions: RuntimeExecutionRecord[];
  runtimeApprovals: RuntimeApprovalRecord[];
  messageExecutionSummaries: Record<string, MessageExecutionSummaryRecord>;
};

export function buildMessageExecutionSummaries(
  store: ServerRouteContext["store"],
  userId: string,
  messages: MessageRecord[]
): MessageExecutionSummaryResult {
  if (messages.length === 0) return { runtimeExecutions: [], runtimeApprovals: [], messageExecutionSummaries: {} };
  const messageIdList = Array.from(new Set(messages.map((message) => message.id)));
  const messageIds = new Set(messageIdList);
  const directRuntimeExecutions = uniqueById(store.listRuntimeExecutionsForMessageIds(messageIdList, userId, 1000)
    .filter((execution) => messageIds.has(execution.messageId) || Boolean(execution.rootMessageId && messageIds.has(execution.rootMessageId))));
  const childRuntimeExecutions = uniqueById(store.listChildRuntimeExecutionsForSourceIds(directRuntimeExecutions.map((execution) => execution.id), 1000)
    .filter((execution) => Boolean(execution.rootMessageId && messageIds.has(execution.rootMessageId))));
  const directAndChildRuntimeExecutions = uniqueById([...directRuntimeExecutions, ...childRuntimeExecutions]);
  const blockerSummary = daemonQueueBlockerSummary(store, directAndChildRuntimeExecutions, messageIds);
  const runtimeExecutions = uniqueById([...directAndChildRuntimeExecutions, ...blockerSummary.executions]);
  const executionIds = new Set(runtimeExecutions.map((execution) => execution.id));
  const threadChannelIds = new Set(runtimeExecutions.map((execution) => execution.threadChannelId).filter(Boolean) as string[]);
  const runtimeApprovals = uniqueById(store.listRuntimeApprovalsForExecutionSummary({
    executionIds: Array.from(executionIds),
    messageIds: messageIdList,
    threadChannelIds: Array.from(threadChannelIds),
    ownerUserId: userId,
    limit: 1000
  })
    .filter((approval) => {
      if (approval.executionId) return executionIds.has(approval.executionId);
      if (approval.messageId) return messageIds.has(approval.messageId);
      if (approval.threadChannelId) return threadChannelIds.has(approval.threadChannelId);
      return false;
    }));
  const executionGroups = store.listExecutionGroupsForMessageIds(messageIdList, 1000)
    .filter((group) => group.messageId && messageIds.has(group.messageId));
  const groupIds = Array.from(new Set(executionGroups.map((group) => group.id)));
  const agentRuns = store.listAgentRunsForGroupIds(groupIds, 1000);
  const groupIdsWithBlocks = new Set<string>();
  if (groupIds.length > 0) {
    const placeholders = groupIds.map(() => "?").join(",");
    const rows = store.db.prepare(`select distinct group_id as groupId from execution_blocks where group_id in (${placeholders})`).all(...groupIds) as Array<{ groupId: string }>;
    for (const row of rows) groupIdsWithBlocks.add(row.groupId);
  }
  const executionsByMessageId = groupBy(runtimeExecutions, (execution) => executionSummaryMessageId(execution, messageIds));
  const blockerExecutionsByMessageId = groupBy(blockerSummary.executions, (execution) => blockerSummary.rootMessageIdByExecutionId.get(execution.id) ?? "");
  const groupsByMessageId = groupBy(executionGroups, (group) => group.messageId ?? "");
  const runsByGroupId = groupBy(agentRuns, (run) => run.groupId);
  const summaries: Record<string, MessageExecutionSummaryRecord> = {};

  for (const message of messages) {
    const messageExecutions = uniqueById([
      ...(executionsByMessageId.get(message.id) ?? []),
      ...(blockerExecutionsByMessageId.get(message.id) ?? [])
    ]);
    const messageExecutionIds = new Set(messageExecutions.map((execution) => execution.id));
    const messageThreadChannelIds = new Set(messageExecutions.map((execution) => execution.threadChannelId).filter(Boolean) as string[]);
    const messageApprovals = runtimeApprovals.filter((approval) => {
      if (approval.messageId === message.id) return true;
      if (approval.executionId && messageExecutionIds.has(approval.executionId)) return true;
      if (approval.threadChannelId && messageThreadChannelIds.has(approval.threadChannelId)) return true;
      return false;
    });
    const messageGroups = groupsByMessageId.get(message.id) ?? [];
    const messageGroupIds = new Set(messageGroups.map((group) => group.id));
    const messageRuns = messageGroups.flatMap((group) => runsByGroupId.get(group.id) ?? []);
    const groupsWithBlocks = messageGroups.filter((group) => groupIdsWithBlocks.has(group.id));
    if (messageExecutions.length === 0 && messageApprovals.length === 0 && groupsWithBlocks.length === 0) continue;

    const pendingApprovalCount = messageApprovals.filter((approval) => approval.status === "pending").length;
    const partialReason = summaryPartialReason(store, messageExecutions, messageRuns, groupsWithBlocks);
    const partial = partialReason === "missing_runtime_execution" || partialReason === "missing_agent_run";
    const status = summaryStatus(pendingApprovalCount, messageExecutions, messageRuns, messageGroups, partial);
    const actionLabel = pendingApprovalCount > 0 ? "Review approval" : "View execution";
    const agentNames = summaryAgentNames(store, messageExecutions, messageRuns);
    const pendingAgentNames = summaryApprovalAgentNames(store, messageApprovals.filter((approval) => approval.status === "pending"));
    const items = summaryItems(store, messageExecutions, messageApprovals, messageRuns, groupsWithBlocks);
    summaries[message.id] = {
      messageId: message.id,
      status,
      label: summaryLabel(status, pendingApprovalCount, agentNames, pendingAgentNames),
      actionLabel,
      agentNames,
      executionIds: messageExecutions.map((execution) => execution.id),
      approvalIds: messageApprovals.map((approval) => approval.id),
      groupIds: Array.from(messageGroupIds),
      pendingApprovalCount,
      partial,
      partialReason,
      updatedAt: latestTimestamp([
        message.createdAt,
        ...messageExecutions.map((execution) => execution.updatedAt),
        ...messageApprovals.map((approval) => approval.resolvedAt ?? approval.requestedAt),
        ...messageGroups.map((group) => group.updatedAt),
        ...messageRuns.map((run) => run.updatedAt)
      ]),
      items
    };
  }

  return { runtimeExecutions, runtimeApprovals, messageExecutionSummaries: summaries };
}

function daemonQueueBlockerSummary(
  store: ServerRouteContext["store"],
  executions: RuntimeExecutionRecord[],
  visibleMessageIds: Set<string>
): { executions: RuntimeExecutionRecord[]; rootMessageIdByExecutionId: Map<string, string> } {
  const blockers: RuntimeExecutionRecord[] = [];
  const rootMessageIdByExecutionId = new Map<string, string>();
  const seen = new Set(executions.map((execution) => execution.id));
  for (const execution of executions) {
    const rootMessageId = executionSummaryMessageId(execution, visibleMessageIds);
    if (!visibleMessageIds.has(rootMessageId)) continue;
    for (const event of store.listRuntimeExecutionEvents(execution.id)) {
      const blockerExecutionId = blockerExecutionIdFromPayload(event.payload);
      if (!blockerExecutionId) continue;
      const blocker = store.getRuntimeExecution(blockerExecutionId);
      if (!blocker) continue;
      if (blocker.agentId !== execution.agentId || blocker.serverId !== execution.serverId) continue;
      rootMessageIdByExecutionId.set(blocker.id, rootMessageId);
      if (seen.has(blocker.id)) continue;
      seen.add(blocker.id);
      blockers.push(blocker);
    }
  }
  return { executions: blockers, rootMessageIdByExecutionId };
}

function blockerExecutionIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as { blockerExecutionId?: unknown }).blockerExecutionId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function summaryPartialReason(
  store: ServerRouteContext["store"],
  executions: RuntimeExecutionRecord[],
  runs: AgentRunRecord[],
  groupsWithBlocks: ExecutionGroupRecord[]
): MessageExecutionSummaryRecord["partialReason"] | undefined {
  if (groupsWithBlocks.length > 0 && runs.length === 0) return "missing_agent_run";
  if (groupsWithBlocks.length > 0 && executions.length === 0) return "missing_runtime_execution";
  if ([...executions.map((execution) => execution.agentId), ...runs.map((run) => run.agentId)].some((agentId) => store.getAgent(agentId)?.deletedAt)) return "deleted_actor";
  return undefined;
}

function executionSummaryMessageId(execution: RuntimeExecutionRecord, visibleMessageIds: Set<string>): string {
  if (visibleMessageIds.has(execution.messageId)) return execution.messageId;
  if (execution.rootMessageId && visibleMessageIds.has(execution.rootMessageId)) return execution.rootMessageId;
  return execution.messageId;
}

function summaryStatus(
  pendingApprovalCount: number,
  executions: RuntimeExecutionRecord[],
  runs: AgentRunRecord[],
  groups: ExecutionGroupRecord[],
  partial: boolean
): MessageExecutionSummaryStatus {
  if (pendingApprovalCount > 0) return "pending_approval";
  if (executions.some((execution) => ["queued", "delivered", "running", "waiting_approval"].includes(execution.status))) return "running";
  if (runs.some((run) => ["queued", "running", "waiting_dependency", "waiting_approval"].includes(run.status))) return "running";
  if (groups.some((group) => ["queued", "running", "waiting_approval"].includes(group.status))) return "running";
  if (executions.some((execution) => ["failed", "stalled", "cancelled"].includes(execution.status))) return "failed";
  if (runs.some((run) => ["failed", "cancelled"].includes(run.status))) return "failed";
  if (groups.some((group) => ["failed", "cancelled"].includes(group.status))) return "failed";
  if (partial) return "partial";
  return "completed";
}

function summaryAgentNames(store: ServerRouteContext["store"], executions: RuntimeExecutionRecord[], runs: AgentRunRecord[]): string[] {
  const names = new Set<string>();
  for (const execution of executions.slice().sort((a, b) => {
    const sourceOrder = Number(Boolean(a.sourceExecutionId)) - Number(Boolean(b.sourceExecutionId));
    return sourceOrder || a.createdAt.localeCompare(b.createdAt);
  })) {
    const agent = store.getAgent(execution.agentId);
    names.add(execution.agentDisplayName || execution.agentName || agent?.displayName || agent?.name || "Deleted agent");
  }
  for (const run of runs.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const agent = store.getAgent(run.agentId);
    names.add(run.agentDisplayName || run.agentName || agent?.displayName || agent?.name || "Deleted agent");
  }
  if (names.size === 0) names.add("Deleted agent");
  return Array.from(names);
}

function summaryApprovalAgentNames(store: ServerRouteContext["store"], approvals: RuntimeApprovalRecord[]): string[] {
  const names = new Set<string>();
  for (const approval of approvals) {
    const agent = store.getAgent(approval.agentId);
    names.add(agent?.name || agent?.displayName || "Deleted agent");
  }
  return Array.from(names);
}

function summaryItems(
  store: ServerRouteContext["store"],
  executions: RuntimeExecutionRecord[],
  approvals: RuntimeApprovalRecord[],
  runs: AgentRunRecord[],
  groupsWithBlocks: ExecutionGroupRecord[]
): MessageExecutionSummaryItemRecord[] {
  const sourceExecutionIds = new Set(executions.map((execution) => execution.sourceExecutionId).filter(Boolean) as string[]);
  // Delegation visibility is about the actual workers. When child executions exist, hide coordinator parents from row-level UI.
  const leafExecutions = executions.filter((execution) => !sourceExecutionIds.has(execution.id));
  const executionItems = leafExecutions.length > 0 ? leafExecutions : executions;
  const items = executionItems
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((execution) => {
      const executionApprovals = approvals.filter((approval) => approval.executionId === execution.id);
      const pendingApproval = executionApprovals.some((approval) => approval.status === "pending");
      const status = summaryItemExecutionStatus(execution, pendingApproval);
      return {
        executionId: execution.id,
        agentId: execution.agentId,
        agentName: summaryActorName(store, execution),
        status,
        actionLabel: summaryItemActionLabel(status),
        updatedAt: latestTimestamp([
          execution.updatedAt,
          ...executionApprovals.map((approval) => approval.resolvedAt ?? approval.requestedAt)
        ])
      };
    });

  if (items.length > 0) return items;

  if (runs.length > 0) {
    return runs
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((run) => {
        const status = summaryItemRunStatus(run);
        return {
          groupId: run.groupId,
          agentId: run.agentId,
          agentName: summaryActorName(store, run),
          status,
          actionLabel: summaryItemActionLabel(status),
          updatedAt: run.updatedAt,
          partial: groupsWithBlocks.some((group) => group.id === run.groupId)
        };
      });
  }

  return groupsWithBlocks
    .slice()
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .map((group) => ({
      groupId: group.id,
      agentName: "Deleted agent",
      status: "partial",
      actionLabel: "View result",
      updatedAt: group.updatedAt,
      partial: true
    }));
}

function summaryActorName(
  store: ServerRouteContext["store"],
  actor: Pick<RuntimeExecutionRecord | AgentRunRecord, "agentId" | "agentName" | "agentDisplayName">
): string {
  const agent = store.getAgent(actor.agentId);
  return actor.agentDisplayName || actor.agentName || agent?.displayName || agent?.name || "Deleted agent";
}

function summaryItemExecutionStatus(execution: RuntimeExecutionRecord, pendingApproval: boolean): MessageExecutionSummaryItemRecord["status"] {
  if (pendingApproval || execution.status === "waiting_approval") return "pending_approval";
  if (execution.status === "queued") return "queued";
  if (execution.status === "delivered") return "delivered";
  if (execution.status === "running") return "running";
  if (execution.status === "failed" || execution.status === "stalled" || execution.status === "cancelled") return "failed";
  return "completed";
}

function summaryItemRunStatus(run: AgentRunRecord): MessageExecutionSummaryItemRecord["status"] {
  if (run.status === "queued") return "queued";
  if (run.status === "running") return "running";
  if (run.status === "waiting_dependency") return "waiting";
  if (run.status === "waiting_approval") return "pending_approval";
  if (run.status === "failed" || run.status === "cancelled") return "failed";
  return "completed";
}

function summaryItemActionLabel(status: MessageExecutionSummaryItemRecord["status"]): MessageExecutionSummaryItemRecord["actionLabel"] {
  if (status === "pending_approval") return "Review approval";
  if (status === "completed" || status === "partial") return "View result";
  return "View progress";
}

function summaryLabel(status: MessageExecutionSummaryStatus, pendingApprovalCount: number, agentNames: string[], pendingAgentNames: string[] = []): string {
  const subject = agentNames.length === 1 ? agentNames[0] : `${agentNames.length} agents`;
  if (status === "pending_approval") {
    const pendingSubject = pendingAgentNames.length === 1 ? agentTag(pendingAgentNames[0]) : `${pendingAgentNames.length || pendingApprovalCount} agents`;
    return pendingApprovalCount === 1 ? `${pendingSubject} approval pending` : `${pendingSubject} approvals pending`;
  }
  if (status === "running") return `${subject} running`;
  if (status === "failed") return `${subject} failed`;
  if (status === "partial") return "Historical execution available";
  return `${subject} replied`;
}

function agentTag(name: string): string {
  if (!name || name === "Deleted agent" || name.startsWith("@")) return name;
  return `@${name}`;
}

function latestTimestamp(values: Array<string | undefined | null>): string {
  return values.filter(Boolean).sort().at(-1) ?? new Date(0).toISOString();
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
}
