import type { AgentRecord, MessageRecord, RuntimeApprovalRecord, RuntimeExecutionEventRecord, RuntimeExecutionRecord } from "@tyr-ai/contracts";

export type AgentActivityTimelineItemType =
  | "message"
  | "delegation_received"
  | "delegation_sent"
  | "execution"
  | "approval"
  | "runtime_event"
  | "runtime_activity";

export type AgentActivityTimelineItem = {
  id: string;
  type: AgentActivityTimelineItemType;
  typeLabel: string;
  title: string;
  preview: string;
  at: string;
  source?: string;
  channelId?: string;
  messageId?: string;
  executionId?: string;
  approvalId?: string;
  rootMessageId?: string;
  sourceExecutionId?: string;
  status?: string;
  statusLabel?: string;
  jumpTarget?: {
    type: "message" | "execution";
    channelId?: string;
    messageId?: string;
    executionId?: string;
  };
};

export type AgentActivityTimelineResponse = {
  agentId: string;
  items: AgentActivityTimelineItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

type ActivityTimelineStore = {
  getAgent(agentId: string): AgentRecord | null;
  getMessage(messageId: string): MessageRecord | null;
  listAgentActivityMessages(userId: string, agentId: string, limit?: number): MessageRecord[];
  listRuntimeExecutions(filter?: { agentId?: string; limit?: number }): RuntimeExecutionRecord[];
  listRuntimeApprovals(filter?: { agentId?: string; limit?: number }): RuntimeApprovalRecord[];
  listRuntimeExecutionEvents(executionId: string): RuntimeExecutionEventRecord[];
  listActivity(agentId: string): Array<{ at: string; kind: string; text: string }>;
};

export function formatAgentActivityTimelineResponse(
  store: ActivityTimelineStore,
  userId: string,
  agentId: string,
  input: { limit?: number; offset?: number; type?: string; q?: string } = {}
): AgentActivityTimelineResponse {
  const limit = clampInteger(input.limit ?? 50, 1, 100);
  const offset = Math.max(0, Math.trunc(Number.isFinite(input.offset) ? input.offset! : 0));
  const filterType = normalizeTimelineTypeFilter(input.type);
  const query = normalizeTimelineQuery(input.q);
  const agent = store.getAgent(agentId);
  const includePrivate = Boolean(agent && agent.ownerUserId === userId);
  const items = [
    ...messageTimelineItems(store.listAgentActivityMessages(userId, agentId, 500), agentId),
    ...(includePrivate ? privateExecutionTimelineItems(store, agentId) : []),
    ...(includePrivate ? runtimeActivityTimelineItems(store.listActivity(agentId)) : [])
  ]
    .filter((item) => timelineTypeMatches(item, filterType))
    .filter((item) => timelineQueryMatches(item, query))
    .sort((a, b) => b.at.localeCompare(a.at));
  const page = items.slice(offset, offset + limit);
  return {
    agentId,
    items: page,
    total: items.length,
    limit,
    offset,
    hasMore: offset + limit < items.length
  };
}

function messageTimelineItems(messages: MessageRecord[], agentId: string): AgentActivityTimelineItem[] {
  return messages.map((message) => {
    if (message.kind === "delegation") {
      const sent = message.senderId === agentId;
      return {
        id: `message:${message.id}`,
        type: sent ? "delegation_sent" : "delegation_received",
        typeLabel: "Delegation",
        title: sent ? "Delegation sent" : "Delegation received",
        preview: message.content,
        at: message.createdAt,
        source: messageSourceLabel(message),
        channelId: message.channelId,
        messageId: message.id,
        jumpTarget: { type: "message", channelId: message.channelId, messageId: message.id }
      };
    }
    return {
      id: `message:${message.id}`,
      type: "message",
      typeLabel: "Message",
      title: `Message in ${message.channelDisplayName || message.channelName || "chat"}`,
      preview: message.deletedAt ? "Message deleted" : message.content,
      at: message.createdAt,
      source: messageSourceLabel(message),
      channelId: message.channelId,
      messageId: message.id,
      jumpTarget: { type: "message", channelId: message.channelId, messageId: message.id }
    };
  });
}

function privateExecutionTimelineItems(store: ActivityTimelineStore, agentId: string): AgentActivityTimelineItem[] {
  const executions = store.listRuntimeExecutions({ agentId, limit: 500 });
  const approvals = store.listRuntimeApprovals({ agentId, limit: 500 });
  const executionItems = executions.map((execution) => {
    const sourceMessage = store.getMessage(execution.messageId);
    return {
      id: `execution:${execution.id}`,
      type: "execution" as const,
      typeLabel: "Execution",
      title: `Execution ${execution.status.replaceAll("_", " ")}`,
      preview: sourceMessage?.content ?? `${execution.runtime} execution`,
      at: execution.updatedAt || execution.createdAt,
      source: sourceMessage ? messageSourceLabel(sourceMessage) : `${execution.runtime} execution`,
      channelId: sourceMessage?.channelId,
      messageId: execution.messageId,
      executionId: execution.id,
      rootMessageId: execution.rootMessageId,
      sourceExecutionId: execution.sourceExecutionId,
      status: execution.status,
      statusLabel: statusLabel(execution.status),
      jumpTarget: { type: "execution" as const, channelId: sourceMessage?.channelId, messageId: execution.rootMessageId ?? execution.messageId, executionId: execution.id }
    };
  });
  const approvalItems = approvals.map((approval) => ({
    id: `approval:${approval.id}`,
    type: "approval" as const,
    typeLabel: "Approval",
    title: `Approval ${approval.status}`,
    preview: approval.detail || approval.title,
    at: approval.resolvedAt ?? approval.requestedAt,
    source: approval.kind === "command" ? "Command approval" : `${approval.kind} approval`,
    messageId: approval.messageId,
    executionId: approval.executionId,
    approvalId: approval.id,
    status: approval.status,
    statusLabel: statusLabel(approval.status),
    jumpTarget: approval.executionId ? { type: "execution" as const, messageId: approval.messageId, executionId: approval.executionId } : undefined
  }));
  const eventItems = executions.flatMap((execution) =>
    store.listRuntimeExecutionEvents(execution.id).slice(-20).map((event) => ({
      id: `event:${execution.id}:${event.sequence}`,
      type: "runtime_event" as const,
      typeLabel: "Runtime",
      title: event.title || event.kind.replaceAll("_", " "),
      preview: event.detail || event.kind,
      at: event.at,
      source: "Execution event",
      messageId: execution.messageId,
      executionId: execution.id,
      rootMessageId: execution.rootMessageId,
      status: event.kind,
      statusLabel: statusLabel(event.kind),
      jumpTarget: { type: "execution" as const, messageId: execution.rootMessageId ?? execution.messageId, executionId: execution.id }
    }))
  );
  return [...executionItems, ...approvalItems, ...eventItems];
}

function runtimeActivityTimelineItems(activity: Array<{ at: string; kind: string; text: string }>): AgentActivityTimelineItem[] {
  return activity.map((item, index) => ({
    id: `activity:${item.at}:${index}`,
    type: "runtime_activity",
    typeLabel: "Runtime",
    title: runtimeActivityTitle(item.kind),
    preview: item.text,
    at: item.at,
    source: "Runtime activity",
    status: item.kind,
    statusLabel: runtimeActivityTitle(item.kind)
  }));
}

function runtimeActivityTitle(kind: string): string {
  if (kind === "thinking") return "Thinking";
  if (kind === "working") return "Working";
  if (kind === "online") return "Online";
  if (kind === "offline") return "Offline";
  if (kind === "error") return "Error";
  return kind.replaceAll("_", " ");
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function messageSourceLabel(message: MessageRecord): string {
  if (message.kind === "delegation") return `${message.senderName || "Agent"} handoff`;
  const name = message.channelDisplayName || message.channelName || "chat";
  if (message.channelType === "dm") return "Agent DM";
  if (message.channelType === "thread") return "Thread";
  return name.startsWith("#") ? name : `#${name}`;
}

function statusLabel(status: string): string {
  return status
    .replaceAll("_", " ")
    .trim()
    .replace(/^./, (value) => value.toUpperCase());
}

function normalizeTimelineTypeFilter(value: string | undefined): string {
  const normalized = (value ?? "all").trim().toLowerCase();
  if (["messages", "delegations", "executions", "approvals", "runtime"].includes(normalized)) return normalized;
  return "all";
}

function normalizeTimelineQuery(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function timelineTypeMatches(item: AgentActivityTimelineItem, filter: string): boolean {
  if (filter === "messages") return item.type === "message";
  if (filter === "delegations") return item.type === "delegation_received" || item.type === "delegation_sent";
  if (filter === "executions") return item.type === "execution";
  if (filter === "approvals") return item.type === "approval";
  if (filter === "runtime") return item.type === "runtime_activity" || item.type === "runtime_event";
  return true;
}

function timelineQueryMatches(item: AgentActivityTimelineItem, query: string): boolean {
  if (!query) return true;
  return [
    item.id,
    item.type,
    item.typeLabel,
    item.title,
    item.preview,
    item.source,
    item.status,
    item.statusLabel,
    item.channelId,
    item.messageId,
    item.executionId,
    item.approvalId,
    item.rootMessageId,
    item.sourceExecutionId
  ].filter(Boolean).join(" ").toLowerCase().includes(query);
}
