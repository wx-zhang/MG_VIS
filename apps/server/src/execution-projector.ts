import type {
  AgentRunRecord,
  AgentRunStatus,
  ExecutionBlockRecord,
  ExecutionBlockStatus,
  ExecutionGroupRecord,
  ExecutionGroupStatus,
  GovernanceDecisionRecord,
  RuntimeApprovalRecord,
  RuntimeExecutionEventRecord,
  RuntimeExecutionRecord,
  RuntimeExecutionStatus
} from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";

const MAX_BLOCK_PREVIEW_CHARS = 8000;
const MAX_RAW_EVENT_IDS = 200;

export type ExecutionProjectorStore = Pick<
  TyrDb,
  | "ensureExecutionGroup"
  | "updateExecutionGroupStatus"
  | "ensureAgentRun"
  | "updateAgentRunStatus"
  | "upsertExecutionBlock"
  | "listExecutionBlocks"
>;

export function projectRuntimeExecutionEvent(
  store: ExecutionProjectorStore,
  execution: RuntimeExecutionRecord,
  event: RuntimeExecutionEventRecord
): ExecutionBlockRecord | null {
  const { group, run } = ensureExecutionContext(store, execution);
  if (event.kind === "assistant_output") {
    const output = event.detail ?? "";
    if (!output) return null;
    const blockId = assistantBlockIdFromPayload(event.payload) ?? latestRunningAssistantBlock(store, group.id, run.id)?.id ?? `assistant:${run.id}:${event.id}`;
    const existing = store.listExecutionBlocks(group.id).find((block) => block.id === blockId);
    return store.upsertExecutionBlock({
      id: blockId,
      groupId: group.id,
      runId: run.id,
      agentId: execution.agentId,
      kind: "assistant_message",
      title: event.title?.trim() || "Assistant output",
      bodyPreview: compactPreview(output),
      status: execution.status === "completed" ? "completed" : "running",
      rawEventIds: appendRawEventId(existing?.rawEventIds ?? [], event.id),
      updatedAt: event.at
    });
  }
  if (event.kind === "thinking") {
    const detail = visibleText(event.detail);
    if (!detail || detail === "Thinking...") return null;
    return store.upsertExecutionBlock({
      id: `thinking:${run.id}:${event.id}`,
      groupId: group.id,
      runId: run.id,
      agentId: execution.agentId,
      kind: "thinking_summary",
      title: event.title?.trim() || "Thinking",
      bodyPreview: compactPreview(detail),
      status: "running",
      rawEventIds: [event.id],
      updatedAt: event.at
    });
  }
  if (event.kind === "assistant_delta") {
    const delta = event.detail ?? "";
    if (!delta) return null;
    const existing = latestRunningAssistantBlock(store, group.id, run.id);
    const blockId = existing?.id ?? `assistant:${run.id}:${event.id}`;
    return store.upsertExecutionBlock({
      id: blockId,
      groupId: group.id,
      runId: run.id,
      agentId: execution.agentId,
      kind: "assistant_message",
      title: event.title?.trim() || "Assistant",
      bodyPreview: compactPreview((existing?.bodyPreview ?? "") + delta),
      status: execution.status === "completed" ? "completed" : "running",
      rawEventIds: appendRawEventId(existing?.rawEventIds ?? [], event.id),
      updatedAt: event.at
    });
  }
  if (event.kind === "tool_call") {
    closeRunningBlocks(store, group.id, run.id, event.at, "completed", ["assistant_message", "thinking_summary"]);
    const command = commandTextFromEvent(event);
    const kind = command ? "command" : "tool_call";
    return store.upsertExecutionBlock({
      id: `tool:${run.id}:${event.id}`,
      groupId: group.id,
      runId: run.id,
      agentId: execution.agentId,
      kind,
      title: event.title?.trim() || (command ? "Run command" : "Tool call"),
      bodyPreview: compactPreview(command ?? visibleText(event.detail) ?? ""),
      status: "running",
      rawEventIds: [event.id],
      updatedAt: event.at
    });
  }
  if (event.kind === "tool_output") {
    closeRunningBlocks(store, group.id, run.id, event.at, "completed", ["assistant_message", "thinking_summary"]);
    const foldedMcpBlock = foldMatchingRunningMcpToolOutputBlock(store, group.id, run.id, event);
    if (foldedMcpBlock) return foldedMcpBlock;
    completeLatestRunningActionBlock(store, group.id, run.id, event.at, event.id);
    return store.upsertExecutionBlock({
      id: `tool-output:${run.id}:${event.id}`,
      groupId: group.id,
      runId: run.id,
      agentId: execution.agentId,
      kind: "tool_output",
      title: event.title?.trim() || "Tool output",
      bodyPreview: compactPreview(visibleText(event.detail) ?? ""),
      status: "completed",
      rawEventIds: [event.id],
      updatedAt: event.at
    });
  }
  if (event.kind === "approval_request") {
    closeRunningBlocks(store, group.id, run.id, event.at, "completed", ["assistant_message", "thinking_summary"]);
    return null;
  }
  if (event.kind === "error") {
    closeRunningBlocks(store, group.id, run.id, event.at, "failed", ["assistant_message", "thinking_summary", "command", "tool_call"]);
    return store.upsertExecutionBlock({
      id: `error:${run.id}:${event.id}`,
      groupId: group.id,
      runId: run.id,
      agentId: execution.agentId,
      kind: "runtime_error",
      title: event.title?.trim() || "Runtime error",
      bodyPreview: compactPreview(visibleText(event.detail) ?? ""),
      status: "failed",
      rawEventIds: [event.id],
      updatedAt: event.at
    });
  }
  const detail = visibleText(event.detail);
  if (!detail && !event.title) return null;
  if (event.kind === "turn_completed") {
    closeRunningBlocks(store, group.id, run.id, event.at, "completed", ["assistant_message", "thinking_summary", "command", "tool_call"]);
  }
  return store.upsertExecutionBlock({
    id: `system:${run.id}:${event.id}`,
    groupId: group.id,
    runId: run.id,
    agentId: execution.agentId,
    kind: event.kind === "turn_completed" ? "final_result" : "system",
    title: event.title?.trim() || runtimeEventTitle(event.kind),
    bodyPreview: compactPreview(detail ?? ""),
    status: blockStatusFromRuntimeStatus(execution.status),
    rawEventIds: [event.id],
    updatedAt: event.at
  });
}

function foldMatchingRunningMcpToolOutputBlock(
  store: ExecutionProjectorStore,
  groupId: string,
  runId: string,
  event: RuntimeExecutionEventRecord
): ExecutionBlockRecord | null {
  const title = event.title?.trim();
  if (!title?.startsWith("mcp_")) return null;
  const block = [...store.listExecutionBlocks(groupId)]
    .reverse()
    .find((item) =>
      item.runId === runId &&
      item.status === "running" &&
      item.kind === "tool_call" &&
      item.title === title
    );
  if (!block) return null;
  return upsertBlockStatus(store, block, "completed", event.at, event.id, appendBlockOutputPreview(block.bodyPreview, visibleText(event.detail)));
}

export function assistantOutputPreviewBlock(
  execution: RuntimeExecutionRecord,
  input: { assistantBlockId: string; bodyPreview: string; at: string; status?: ExecutionBlockStatus }
): ExecutionBlockRecord {
  return {
    id: input.assistantBlockId,
    groupId: executionGroupId(execution),
    runId: `run:${execution.id}`,
    agentId: execution.agentId,
    groupSequence: Number.MAX_SAFE_INTEGER - 1,
    runSequence: Number.MAX_SAFE_INTEGER - 1,
    kind: "assistant_message",
    title: "Assistant output",
    bodyPreview: compactPreview(input.bodyPreview),
    status: input.status ?? "running",
    rawEventIds: [],
    createdAt: input.at,
    updatedAt: input.at
  };
}

export function projectRuntimeApproval(
  store: ExecutionProjectorStore,
  execution: RuntimeExecutionRecord,
  approval: RuntimeApprovalRecord
): ExecutionBlockRecord {
  const { group, run } = ensureExecutionContext(store, execution);
  if (approval.status === "pending") {
    closeRunningBlocks(store, group.id, run.id, approval.requestedAt, "completed", ["assistant_message", "thinking_summary"]);
    store.updateExecutionGroupStatus(group.id, "waiting_approval");
    store.updateAgentRunStatus(run.id, "waiting_approval");
  }
  return store.upsertExecutionBlock({
    id: `approval:${approval.id}`,
    groupId: group.id,
    runId: run.id,
    agentId: approval.agentId,
    kind: "approval_gate",
    title: approval.title || "Approval requested",
    bodyPreview: compactPreview(approval.detail),
    status: approvalBlockStatus(approval.status),
    approvalId: approval.id,
    rawEventIds: [],
    updatedAt: approval.resolvedAt ?? approval.requestedAt
  });
}

export function projectGovernanceDecision(
  store: ExecutionProjectorStore,
  execution: RuntimeExecutionRecord,
  decision: GovernanceDecisionRecord
): ExecutionBlockRecord {
  const { group, run } = ensureExecutionContext(store, execution);
  closeRunningBlocks(store, group.id, run.id, decision.createdAt, "completed", ["assistant_message", "thinking_summary"]);
  return store.upsertExecutionBlock({
    id: `governance:${decision.id}`,
    groupId: group.id,
    runId: run.id,
    agentId: decision.agentId,
    kind: "governance_review",
    title: `Governance ${decision.decision}`,
    bodyPreview: compactPreview(decision.reason),
    status: governanceBlockStatus(decision.decision),
    governanceDecisionId: decision.id,
    rawEventIds: [],
    updatedAt: decision.createdAt
  });
}

function closeRunningBlocks(
  store: ExecutionProjectorStore,
  groupId: string,
  runId: string,
  updatedAt: string,
  status: ExecutionBlockStatus,
  kinds: ExecutionBlockRecord["kind"][]
): void {
  const closingKinds = new Set(kinds);
  for (const block of store.listExecutionBlocks(groupId)) {
    if (block.runId !== runId || block.status !== "running" || !closingKinds.has(block.kind)) continue;
    upsertBlockStatus(store, block, status, updatedAt);
  }
}

function completeLatestRunningActionBlock(
  store: ExecutionProjectorStore,
  groupId: string,
  runId: string,
  updatedAt: string,
  rawEventId: string
): void {
  const block = [...store.listExecutionBlocks(groupId)]
    .reverse()
    .find((item) =>
      item.runId === runId &&
      item.status === "running" &&
      (item.kind === "command" || item.kind === "tool_call")
    );
  if (!block) return;
  upsertBlockStatus(store, block, "completed", updatedAt, rawEventId);
}

function latestRunningAssistantBlock(
  store: ExecutionProjectorStore,
  groupId: string,
  runId: string
): ExecutionBlockRecord | undefined {
  return [...store.listExecutionBlocks(groupId)]
    .reverse()
    .find((block) => block.runId === runId && block.kind === "assistant_message" && block.status === "running");
}

function assistantBlockIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = (payload as Record<string, unknown>).assistantBlockId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function upsertBlockStatus(
  store: ExecutionProjectorStore,
  block: ExecutionBlockRecord,
  status: ExecutionBlockStatus,
  updatedAt: string,
  rawEventId?: string,
  bodyPreview?: string
): ExecutionBlockRecord {
  return store.upsertExecutionBlock({
    id: block.id,
    groupId: block.groupId,
    runId: block.runId,
    agentId: block.agentId,
    groupSequence: block.groupSequence,
    runSequence: block.runSequence,
    kind: block.kind,
    title: block.title,
    bodyPreview: bodyPreview === undefined ? block.bodyPreview : compactPreview(bodyPreview),
    bodyRef: block.bodyRef,
    status,
    approvalId: block.approvalId,
    governanceDecisionId: block.governanceDecisionId,
    artifactId: block.artifactId,
    rawEventIds: rawEventId ? appendRawEventId(block.rawEventIds ?? [], rawEventId) : block.rawEventIds,
    updatedAt
  });
}

function appendBlockOutputPreview(input: string | undefined, output: string | undefined): string | undefined {
  if (!output) return input;
  if (!input) return output;
  return `${input}\n\n${output}`;
}

function ensureExecutionContext(
  store: ExecutionProjectorStore,
  execution: RuntimeExecutionRecord
): { group: ExecutionGroupRecord; run: AgentRunRecord } {
  const groupStatus = executionGroupStatus(execution.status);
  const group = store.ensureExecutionGroup({
    id: executionGroupId(execution),
    serverId: execution.serverId ?? "local",
    taskId: execution.taskId,
    messageId: execution.messageId,
    threadChannelId: execution.threadChannelId,
    status: groupStatus,
    title: executionGroupTitle(execution),
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
    completedAt: execution.completedAt
  });
  store.updateExecutionGroupStatus(group.id, groupStatus);
  const runStatus = agentRunStatus(execution.status);
  const run = store.ensureAgentRun({
    id: `run:${execution.id}`,
    groupId: group.id,
    machineId: execution.machineId,
    agentId: execution.agentId,
    agentName: execution.agentName,
    agentDisplayName: execution.agentDisplayName,
    agentOwnerUserId: execution.agentOwnerUserId,
    machineName: execution.machineName,
    machineHostname: execution.machineHostname,
    machineOwnerUserId: execution.machineOwnerUserId,
    runtime: execution.runtime,
    launchId: execution.launchId,
    status: runStatus,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
    completedAt: execution.completedAt
  });
  store.updateAgentRunStatus(run.id, runStatus);
  return { group, run };
}

function executionGroupId(execution: RuntimeExecutionRecord): string {
  if (execution.taskId) return stableId("execution_group_task", execution.taskId);
  if (execution.messageId) return stableId("execution_group_message", execution.messageId);
  if (execution.threadChannelId) return stableId("execution_group_thread", execution.threadChannelId);
  return stableId("execution_group_execution", execution.id);
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${value.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function executionGroupTitle(execution: RuntimeExecutionRecord): string {
  if (execution.taskId) return `Task execution ${execution.taskId}`;
  if (execution.messageId) return `Message execution ${execution.messageId}`;
  if (execution.threadChannelId) return `Thread execution ${execution.threadChannelId}`;
  return `Runtime execution ${execution.id}`;
}

function executionGroupStatus(status: RuntimeExecutionStatus): ExecutionGroupStatus {
  if (status === "queued" || status === "delivered") return "queued";
  if (status === "waiting_approval") return "waiting_approval";
  if (status === "completed") return "completed";
  if (status === "failed" || status === "stalled") return "failed";
  if (status === "cancelled") return "cancelled";
  return "running";
}

function agentRunStatus(status: RuntimeExecutionStatus): AgentRunStatus {
  if (status === "queued" || status === "delivered") return "queued";
  if (status === "waiting_approval") return "waiting_approval";
  if (status === "completed") return "completed";
  if (status === "failed" || status === "stalled") return "failed";
  if (status === "cancelled") return "cancelled";
  return "running";
}

function blockStatusFromRuntimeStatus(status: RuntimeExecutionStatus): ExecutionBlockStatus {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "stalled") return "failed";
  if (status === "cancelled") return "blocked";
  if (status === "waiting_approval") return "pending";
  return "running";
}

function approvalBlockStatus(status: RuntimeApprovalRecord["status"]): ExecutionBlockStatus {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "custom") return "completed";
  return "pending";
}

function governanceBlockStatus(decision: GovernanceDecisionRecord["decision"]): ExecutionBlockStatus {
  if (decision === "allow") return "approved";
  if (decision === "deny") return "rejected";
  if (decision === "require_human") return "pending";
  return "blocked";
}

function runtimeEventTitle(kind: RuntimeExecutionEventRecord["kind"]): string {
  switch (kind) {
    case "queued":
      return "Queued";
    case "delivered":
      return "Delivered";
    case "delivery_acknowledged":
      return "Delivery acknowledged";
    case "turn_started":
      return "Started";
    case "turn_completed":
      return "Completed";
    case "approval_resolved":
      return "Approval resolved";
    case "diagnostic":
      return "Diagnostic";
    default:
      return "Runtime event";
  }
}

function visibleText(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function compactPreview(value: string): string {
  return value.length > MAX_BLOCK_PREVIEW_CHARS ? value.slice(0, MAX_BLOCK_PREVIEW_CHARS) : value;
}

function appendRawEventId(rawEventIds: string[], eventId: string): string[] {
  if (rawEventIds.includes(eventId)) return rawEventIds;
  if (rawEventIds.length >= MAX_RAW_EVENT_IDS) return rawEventIds;
  return [...rawEventIds, eventId];
}

function commandTextFromEvent(event: RuntimeExecutionEventRecord): string | undefined {
  const payloadCommand = commandTextFromPayload(event.payload);
  if (payloadCommand) return payloadCommand;
  const title = event.title?.trim().toLowerCase();
  return title === "shell" || title === "run command" ? visibleText(event.detail) : undefined;
}

function commandTextFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.command === "string" && record.command.trim()) return record.command.trim();
  if (Array.isArray(record.args) && record.args.every((item) => typeof item === "string")) return record.args.join(" ").trim() || undefined;
  return undefined;
}
