import type { RuntimeApprovalRecord, RuntimeExecutionEventRecord, RuntimeExecutionRecord } from "@tyr-ai/contracts";
import type { BlockingRuntimeApproval } from "./approvalView";
import { governanceSourceSummaryLabels } from "./governanceView";

export type TaskExecutionTimeline = {
  execution: RuntimeExecutionRecord | null;
  events: RuntimeExecutionEventRecord[];
};

export type ExecutionConsoleBlockKind = "prompt" | "system" | "thinking" | "assistant" | "explored" | "tool" | "approval" | "governance" | "activity" | "error" | "stale" | "blocked";

export type ExecutionConsoleBlock = {
  id: string;
  kind: ExecutionConsoleBlockKind;
  at: string;
  title: string;
  detail?: string;
  fullDetail?: string;
  detailTruncated?: boolean;
  text?: string;
  fullText?: string;
  textTruncated?: boolean;
  items?: string[];
  command?: string;
  fullCommand?: string;
  commandTruncated?: boolean;
  payload?: string;
  fullPayload?: string;
  payloadTruncated?: boolean;
  reason?: string;
  governance?: ApprovalGovernanceSummary;
  output?: string;
  fullOutput?: string;
  outputTruncated?: boolean;
  status?: RuntimeApprovalRecord["status"] | "running" | "completed" | "blocked";
  interaction?: "inline";
  tone?: "muted";
  sourceTitle?: string;
  sourceLabel?: string;
  sourceExecutionId?: string;
  sourceOrder?: number;
  approvalId?: string;
  blockingApprovalId?: string;
  customResponse?: string;
  fullCustomResponse?: string;
  customResponseTruncated?: boolean;
};

export type ApprovalGovernanceSummary = {
  decision: string;
  mode?: string;
  model?: string;
  policyVersion?: string;
  policySource?: string;
  policyScope?: string;
  decisionSource?: string;
  confidence?: number;
  riskTypes: string[];
  reason?: string;
  evidence: string[];
  sourceSummaries?: string[];
};

export type ExecutionConsoleModel = {
  execution: RuntimeExecutionRecord | null;
  blocks: ExecutionConsoleBlock[];
};

export type ExecutionConsoleOptions = {
  prompt?: string;
};

export type ExecutionTranscriptModel = {
  blocks: ExecutionConsoleBlock[];
  executions: RuntimeExecutionRecord[];
  currentActivity?: ExecutionConsoleBlock;
  currentActivities?: ExecutionConsoleBlock[];
  hiddenBlockCount?: number;
};

export type ExecutionTranscriptOptions = ExecutionConsoleOptions & {
  agentsById?: Map<string, string>;
  maxBlocks?: number;
  blockingApproval?: BlockingRuntimeApproval | null;
};

export type ExecutionScrollMetrics = Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">;

export const DEFAULT_EXECUTION_TRANSCRIPT_BLOCK_LIMIT = 80;
export const EXPANDED_EXECUTION_TRANSCRIPT_BLOCK_LIMIT = 320;

export type ExecutionTextLimit = {
  maxChars: number;
  maxLines: number;
};

export const EXECUTION_COMMAND_PREVIEW_LIMIT: ExecutionTextLimit = { maxChars: 700, maxLines: 12 };
export const EXECUTION_TEXT_PREVIEW_LIMIT: ExecutionTextLimit = { maxChars: 1600, maxLines: 40 };
export const EXECUTION_TEXT_EXPANDED_LIMIT: ExecutionTextLimit = { maxChars: 20_000, maxLines: 400 };

export type CompactExecutionText = {
  text: string;
  fullText?: string;
  truncated: boolean;
};

export function compactExecutionText(
  value: string,
  previewLimit: ExecutionTextLimit = EXECUTION_TEXT_PREVIEW_LIMIT,
  expandedLimit: ExecutionTextLimit = EXECUTION_TEXT_EXPANDED_LIMIT
): CompactExecutionText {
  const expanded = limitExecutionText(value, expandedLimit);
  const preview = limitExecutionText(value, previewLimit);
  const truncated = preview.text !== value;
  return truncated ? { text: preview.text, fullText: expanded.text, truncated: true } : { text: value, truncated: false };
}

export function isExecutionScrollAtLatest(metrics: ExecutionScrollMetrics, thresholdPx = 28): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= thresholdPx;
}

export function taskExecutionTimeline(
  executions: RuntimeExecutionRecord[],
  events: RuntimeExecutionEventRecord[],
  taskId: string
): TaskExecutionTimeline {
  return taskExecutionTimelines(executions, events, { taskId }).at(-1) ?? { execution: null, events: [] };
}

export function taskExecutionTimelines(
  executions: RuntimeExecutionRecord[],
  events: RuntimeExecutionEventRecord[],
  filter: { taskId?: string; messageId?: string; threadChannelId?: string }
): TaskExecutionTimeline[] {
  const selected = executions
    .filter((execution) =>
      Boolean(filter.taskId && execution.taskId === filter.taskId) ||
      Boolean(filter.messageId && execution.messageId === filter.messageId) ||
      Boolean(filter.messageId && execution.rootMessageId === filter.messageId) ||
      Boolean(filter.threadChannelId && execution.threadChannelId === filter.threadChannelId)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return selected.map((execution) => ({
    execution,
    events: events
      .filter((event) => event.executionId === execution.id)
      .sort((a, b) => a.sequence - b.sequence || a.at.localeCompare(b.at))
  }));
}

export function executionStatusLabel(status: RuntimeExecutionRecord["status"]): string {
  if (status === "queued") return "Queued";
  if (status === "delivered") return "Delivered";
  if (status === "running") return "Running";
  if (status === "waiting_approval") return "Waiting for approval";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "stalled") return "No response";
  return "Cancelled";
}

export function buildExecutionConsole(timeline: TaskExecutionTimeline, approvals: RuntimeApprovalRecord[], options: ExecutionConsoleOptions = {}): ExecutionConsoleModel {
  const blocks: ExecutionConsoleBlock[] = [];
  const approvalsForExecution = approvals.filter((approval) => !timeline.execution || !approval.executionId || approval.executionId === timeline.execution.id);
  appendPromptBlock(blocks, timeline, options.prompt, promptBlockAt(timeline, approvalsForExecution));
  appendProcessSkeleton(blocks, timeline, approvalsForExecution.length > 0);
  for (const event of timeline.events) {
    if (event.kind !== "assistant_delta") closeOpenAssistantBlock(blocks);
    if (event.kind === "assistant_delta") {
      const text = event.detail ?? "";
      const last = blocks.at(-1);
      // CLI 的文本流会分多次到达，这里按连续 delta 合并成一段可读输出。
      if (last?.kind === "assistant") {
        last.text = `${last.text ?? ""}${text}`;
        // 保留第一段 token 的时间，避免流式追加时整段输出在时间排序里跳动。
      } else if (text) {
        blocks.push({ id: assistantBlockId(timeline.execution, event), kind: "assistant", at: event.at, title: "Assistant output", text, status: "running" });
      }
      continue;
    }
    if (event.kind === "thinking") {
      const last = blocks.at(-1);
      if (last?.kind === "thinking") {
        last.at = event.at;
        last.detail = appendThinkingDetail(last.detail, event.detail);
      } else {
        blocks.push({ id: event.id, kind: "thinking", at: event.at, title: event.title || "Thinking", detail: event.detail ?? "Thinking..." });
      }
      continue;
    }
    if (event.kind === "tool_call") {
      if (isExplorationTool(event.title || "")) {
        appendExploredBlock(blocks, event);
        continue;
      }
      const sourceTitle = event.title || "tool";
      const emptyPayload = isEmptyObjectPayload(event.payload);
      const detail = emptyPayload && event.detail?.trim() === "{}" ? undefined : event.detail;
      const command = commandFromPayload(event.payload) ?? detail ?? undefined;
      const commandView = command ? compactCommandForDisplay(command) : null;
      const payloadView = !command && event.payload !== undefined && !emptyPayload ? compactPayloadForDisplay(event.payload) : null;
      blocks.push({
        id: event.id,
        kind: "tool",
        at: event.at,
        title: toolBlockTitle(sourceTitle, command),
        sourceTitle,
        ...detailFields(!payloadView ? detail : undefined),
        command: commandView?.command ?? command,
        fullCommand: commandView?.fullCommand,
        commandTruncated: commandView?.truncated,
        payload: payloadView?.payload,
        fullPayload: payloadView?.fullPayload,
        payloadTruncated: payloadView?.truncated,
        status: "running"
      });
      continue;
    }
    if (event.kind === "tool_output") {
      // 大多数 CLI 没有稳定 tool_call_id；按同名最近未完成工具块配对输出。
      const sourceTitle = event.title || "tool";
      const tool = [...blocks].reverse().find((block) => block.kind === "tool" && (block.sourceTitle ?? block.title) === sourceTitle && !block.output);
      const outputView = outputFields(event.detail ?? "Completed.");
      if (tool) {
        Object.assign(tool, outputView);
        tool.status = "completed";
      } else {
        blocks.push({ id: event.id, kind: "tool", at: event.at, title: sourceTitle, sourceTitle, ...outputView, status: "completed" });
      }
      continue;
    }
    if (event.kind === "approval_request") {
      const matchedApproval = approvalForEvent(event, approvalsForExecution);
      if (matchedApproval) {
        continue;
      }
      const eventStatus = approvalStatusFromEvent(event);
      if (eventStatus && eventStatus !== "pending") {
        const command = approvalCommandFromEvent(event) ?? event.detail ?? "";
        blocks.push({
          id: event.id,
          kind: "system",
          at: event.at,
          title: "Execution workflow",
          ...detailFields(command || undefined),
          status: approvalEventIsNonBlocking(event) || isReadonlyWorkflowCommand(command) ? undefined : eventStatus,
          tone: "muted"
        });
        continue;
      }
      blocks.push({ id: event.id, kind: "approval", at: event.at, title: event.title || "Approval required", ...detailFields(event.detail), status: "pending" });
      continue;
    }
    if (event.kind === "error") {
      blocks.push({ id: event.id, kind: "error", at: event.at, title: event.title || "Runtime error", ...detailFields(event.detail) });
      continue;
    }
    if (event.title === "Delegated") {
      const transport = objectPayload(event.payload)?.transport;
      const detail = transport === "daemon_native"
        ? `${event.detail ?? "Delegated work."} Native wake via daemon.`
        : event.detail;
      blocks.push({
        id: event.id,
        kind: "activity",
        at: event.at,
        title: "Delegated",
        ...detailFields(detail),
        status: timeline.execution && isTerminalExecution(timeline.execution) ? "completed" : "running"
      });
      continue;
    }
    blocks.push({ id: event.id, kind: "system", at: event.at, title: event.title || executionEventTitle(event.kind), ...detailFields(event.detail) });
  }
  if (approvalsForExecution.length > 0) closeOpenAssistantBlock(blocks);
  for (const approval of approvalsForExecution) {
    const approvalCommand = commandFromPayload(approval.payload) ?? approval.detail;
    if (approval.status !== "pending" && (approvalIsNonBlocking(approval) || isCompactWorkflowCommand(approvalCommand))) {
      blocks.push({
        id: `approval:${approval.id}`,
        kind: "system",
        at: approval.requestedAt,
        title: "Execution workflow",
        ...detailFields(approvalCommand),
        status: workflowSummaryIsNonBlocking(approval, approvalCommand) ? undefined : approval.status,
        tone: "muted"
      });
      continue;
    }
    const commandView = approval.kind === "command" ? compactCommandForDisplay(approvalCommand) : null;
    const customResponseView = approval.customResponse ? customResponseFields(approval.customResponse) : {};
    blocks.push({
      id: `approval:${approval.id}`,
      kind: "approval",
      at: approval.requestedAt,
      title: approval.kind === "command" ? runningCommandTitle(approvalCommand) : approval.title,
      // Raw approval payloads are audit/debug material; the normal panel shows only the human-facing summary.
      ...detailFields(approval.detail),
      command: approval.kind === "command" ? commandView?.command ?? approvalCommand : undefined,
      fullCommand: commandView?.fullCommand,
      commandTruncated: commandView?.truncated,
      reason: approvalReason(approval),
      governance: approvalGovernanceSummary(approval),
      status: approval.status,
      interaction: approval.status === "pending" ? "inline" : undefined,
      approvalId: approval.id,
      ...customResponseView
    });
  }
  return {
    execution: timeline.execution,
    blocks: blocks
      .map((block) => stableExecutionBlock(block, timeline.execution))
      .filter((block): block is ExecutionConsoleBlock => Boolean(block))
      .sort((a, b) => a.at.localeCompare(b.at))
  };
}

export function buildExecutionTranscript(timelines: TaskExecutionTimeline[], approvals: RuntimeApprovalRecord[], options: ExecutionTranscriptOptions = {}): ExecutionTranscriptModel {
  const activeTimelines = timelines.length > 0 ? timelines : [{ execution: null, events: [] }];
  const executionNumbers = new Map<string, number>();
  for (const timeline of activeTimelines) {
    if (timeline.execution) executionNumbers.set(timeline.execution.id, executionNumbers.size + 1);
  }
  const blocks = activeTimelines.flatMap((timeline, index) => {
    const groupApprovals = approvals.filter((approval) => approval.executionId ? approval.executionId === timeline.execution?.id : true);
    const consoleModel = buildExecutionConsole(timeline, groupApprovals, { prompt: index === 0 ? options.prompt : undefined });
    const sourceLabel = executionSourceLabel(timeline.execution, executionNumbers, options.agentsById);
    return consoleModel.blocks.map((block) => ({
      ...block,
      sourceLabel,
      sourceExecutionId: timeline.execution?.id,
      sourceOrder: timeline.execution ? executionNumbers.get(timeline.execution.id) : undefined
    }));
  });
  const displayBlocks: ExecutionConsoleBlock[] = options.blockingApproval
    ? blocks.filter((block) => !(block.kind === "thinking" && block.detail?.includes("Waiting for the runtime to accept")))
    : blocks;
  if (options.blockingApproval) displayBlocks.push(blockingApprovalBlock(options.blockingApproval, activeTimelines, options.agentsById));
  const sortedBlocks = displayBlocks.sort((a, b) => compareTranscriptBlocks(a, b));
  const pendingFilteredBlocks = keepOnlyActivePendingApproval(sortedBlocks);
  const requestedMaxBlocks = options.maxBlocks ?? DEFAULT_EXECUTION_TRANSCRIPT_BLOCK_LIMIT;
  const maxBlocks = Math.max(1, Math.min(requestedMaxBlocks, EXPANDED_EXECUTION_TRANSCRIPT_BLOCK_LIMIT));
  const limited = limitTranscriptBlocks(pendingFilteredBlocks, maxBlocks);
  const visibleBlocks = addHiddenHistoryNotice(limited.blocks, limited.hiddenBlockCount, maxBlocks);
  const hasVisiblePendingApproval = visibleBlocks.some((block) => block.kind === "approval" && block.status === "pending");
  const currentActivities = hasVisiblePendingApproval
    ? []
    : options.blockingApproval
      ? [blockingApprovalActivity(options.blockingApproval, activeTimelines, executionNumbers, options.agentsById)]
      : activeExecutionStatusBlocks(activeTimelines, visibleBlocks, executionNumbers, options.agentsById);
  return {
    executions: activeTimelines.map((timeline) => timeline.execution).filter(Boolean) as RuntimeExecutionRecord[],
    blocks: visibleBlocks,
    currentActivity: currentActivities.at(-1),
    currentActivities: currentActivities.length > 0 ? currentActivities : undefined,
    hiddenBlockCount: limited.hiddenBlockCount || undefined
  };
}

function addHiddenHistoryNotice(blocks: ExecutionConsoleBlock[], hiddenBlockCount: number, maxBlocks: number): ExecutionConsoleBlock[] {
  if (!hiddenBlockCount || blocks.some((block) => block.id === "history:hidden")) return blocks;
  const notice: ExecutionConsoleBlock = {
    id: "history:hidden",
    kind: "system",
    at: blocks[0]?.at ?? new Date(0).toISOString(),
    title: "Hidden earlier output",
    detail: `Show earlier output to view ${hiddenBlockCount} older execution block${hiddenBlockCount === 1 ? "" : "s"}.`,
    tone: "muted"
  };
  const insertIndex = blocks[0]?.kind === "prompt" ? 1 : 0;
  const next = [...blocks.slice(0, insertIndex), notice, ...blocks.slice(insertIndex)];
  while (next.length > maxBlocks) {
    // Keep prompts and active blockers pinned; trim the oldest unpinned row after the compaction notice.
    const removableIndex = next.findIndex((block, index) => (
      index > insertIndex &&
      block.id !== notice.id &&
      block.kind !== "prompt" &&
      !(block.kind === "approval" && block.status === "pending") &&
      block.kind !== "blocked"
    ));
    if (removableIndex < 0) break;
    next.splice(removableIndex, 1);
  }
  return next;
}

function executionSourceLabel(execution: RuntimeExecutionRecord | null, executionNumbers: Map<string, number>, agentsById?: Map<string, string>): string | undefined {
  if (!execution) return undefined;
  const agent = agentsById?.get(execution.agentId) ?? "Unknown agent";
  const number = executionNumbers.get(execution.id);
  return number ? `${agent} · Execution ${number}` : agent;
}

function compareTranscriptBlocks(a: ExecutionConsoleBlock, b: ExecutionConsoleBlock): number {
  return a.at.localeCompare(b.at) || (a.sourceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sourceOrder ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id);
}

function keepOnlyActivePendingApproval(blocks: ExecutionConsoleBlock[]): ExecutionConsoleBlock[] {
  const pendingApprovals = blocks.filter((block) => block.kind === "approval" && block.status === "pending");
  const activePending = pendingApprovals[0];
  if (!activePending) return blocks;
  // 同一任务的多个 runtime 可能并行请求审批；界面只展开最早一个，避免用户同时面对多张确认卡。
  return blocks.filter((block) => block.kind !== "approval" || block.status !== "pending" || block.approvalId === activePending.approvalId);
}

function limitTranscriptBlocks(blocks: ExecutionConsoleBlock[], maxBlocks: number): { blocks: ExecutionConsoleBlock[]; hiddenBlockCount: number } {
  if (blocks.length <= maxBlocks) return { blocks, hiddenBlockCount: 0 };
  const pinnedIds = new Set<string>();
  const prompt = blocks.find((block) => block.kind === "prompt");
  if (prompt) pinnedIds.add(prompt.id);
  for (const block of blocks) {
    if ((block.kind === "approval" && block.status === "pending") || block.kind === "blocked") pinnedIds.add(block.id);
  }
  const pinnedCount = pinnedIds.size;
  const tailBudget = Math.max(0, maxBlocks - pinnedCount);
  const tailIds = new Set(blocks.filter((block) => !pinnedIds.has(block.id)).slice(-tailBudget).map((block) => block.id));
  const visible = blocks.filter((block) => pinnedIds.has(block.id) || tailIds.has(block.id));
  return {
    blocks: visible,
    hiddenBlockCount: blocks.length - visible.length
  };
}

function closeOpenAssistantBlock(blocks: ExecutionConsoleBlock[]): void {
  const last = blocks.at(-1);
  if (last?.kind === "assistant") last.status = "completed";
}

function stableExecutionBlock(block: ExecutionConsoleBlock, execution: RuntimeExecutionRecord | null): ExecutionConsoleBlock | null {
  const assistantBlock = stableAssistantBlock(block, execution);
  if (!assistantBlock) return null;
  // 启动/投递/重连这些只驱动状态区，不作为主日志沉淀，避免开头多 agent 行上下跳动。
  if (assistantBlock.kind === "system" && ["Queued", "Delivered", "Turn started", "Execution started"].includes(assistantBlock.title)) return null;
  if (assistantBlock.kind === "thinking" && isBoilerplateThinking(assistantBlock.detail)) return null;
  return assistantBlock;
}

function stableAssistantBlock(block: ExecutionConsoleBlock, execution: RuntimeExecutionRecord | null): ExecutionConsoleBlock | null {
  if (block.kind !== "assistant") return block;
  const text = block.text?.trim() ?? "";
  if (!text) return null;
  if (block.status !== "running" || !execution || isTerminalExecution(execution)) return block;
  const stableText = stableAssistantText(text);
  if (!stableText) return null;
  return stableText === block.text ? block : { ...block, text: stableText };
}

function stableAssistantText(text: string): string | null {
  const matches = [...text.matchAll(/[\n。！？.!?]/g)];
  const lastBoundary = matches.at(-1);
  // 运行中的 CLI 文本按 token 到达；没有句子/换行边界时先不展示，避免单字在 Execution 面板闪烁。
  if (!lastBoundary || lastBoundary.index === undefined) return null;
  return text.slice(0, lastBoundary.index + 1).trimEnd();
}

function assistantBlockId(execution: RuntimeExecutionRecord | null, event: RuntimeExecutionEventRecord): string {
  // Assistant deltas reuse the first event id so streaming appends do not remount the row and lose visible text.
  return `assistant:${execution?.id ?? event.executionId}:${event.id}`;
}

function activeExecutionStatusBlocks(
  timelines: TaskExecutionTimeline[],
  blocks: ExecutionConsoleBlock[],
  executionNumbers: Map<string, number>,
  agentsById?: Map<string, string>
): ExecutionConsoleBlock[] {
  return timelines
    .filter((timeline): timeline is TaskExecutionTimeline & { execution: RuntimeExecutionRecord } => Boolean(timeline.execution && !isTerminalExecution(timeline.execution)))
    .sort((a, b) => (executionNumbers.get(a.execution.id) ?? Number.MAX_SAFE_INTEGER) - (executionNumbers.get(b.execution.id) ?? Number.MAX_SAFE_INTEGER))
    .map((timeline) => activeExecutionStatusBlock(timeline, blocks, executionNumbers, agentsById));
}

function activeExecutionStatusBlock(
  timeline: TaskExecutionTimeline & { execution: RuntimeExecutionRecord },
  blocks: ExecutionConsoleBlock[],
  executionNumbers: Map<string, number>,
  agentsById?: Map<string, string>
): ExecutionConsoleBlock {
  const execution = timeline.execution;
  const at = new Date(Math.max(timelineActivityMs(timeline), ...blocks.map((block) => Date.parse(block.at)).filter(Number.isFinite))).toISOString();
  return {
    id: `active:${execution.id}`,
    kind: "activity",
    at,
    title: activeExecutionTitle(execution.status),
    detail: activeExecutionDetail(execution),
    status: "running",
    sourceLabel: executionSourceLabel(execution, executionNumbers, agentsById),
    sourceExecutionId: execution.id,
    sourceOrder: executionNumbers.get(execution.id)
  };
}

function activeExecutionTitle(status: RuntimeExecutionRecord["status"]): string {
  if (status === "queued") return "Queued";
  if (status === "delivered") return "Delivered";
  if (status === "waiting_approval") return "Waiting approval";
  if (status === "stalled") return "No runtime output";
  return "Current activity";
}

function activeExecutionDetail(execution: RuntimeExecutionRecord): string {
  if (execution.status === "queued") return "Queued";
  if (execution.status === "delivered") return "Delivered";
  if (execution.status === "waiting_approval") return "Waiting for approval";
  if (execution.status === "stalled") return "No runtime output";
  return "Running";
}

function timelineActivityMs(timeline: TaskExecutionTimeline & { execution?: RuntimeExecutionRecord | null }): number {
  const timestamps = [
    timeline.execution?.updatedAt,
    timeline.execution?.createdAt,
    ...timeline.events.map((event) => event.at)
  ];
  const latest = timestamps
    .map((value) => value ? Date.parse(value) : NaN)
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  return latest ?? 0;
}

function isTerminalExecution(execution: RuntimeExecutionRecord): boolean {
  return execution.status === "completed" || execution.status === "failed" || execution.status === "cancelled";
}

function appendPromptBlock(blocks: ExecutionConsoleBlock[], timeline: TaskExecutionTimeline, prompt?: string, at?: string): void {
  const text = prompt?.trim();
  if (!text) return;
  blocks.push({
    id: `prompt:${timeline.execution?.id ?? "legacy"}`,
    kind: "prompt",
    at: at ?? timeline.execution?.createdAt ?? new Date(0).toISOString(),
    title: "Prompt",
    text
  });
}

function blockingApprovalBlock(blocker: BlockingRuntimeApproval, timelines: TaskExecutionTimeline[], agentsById?: Map<string, string>): ExecutionConsoleBlock {
  const currentExecution = blocker.currentExecution ?? timelines.find((timeline) => timeline.execution)?.execution ?? null;
  const at = currentExecution?.updatedAt ?? currentExecution?.createdAt ?? blocker.approval.requestedAt;
  return {
    id: `blocked:${blocker.approval.id}`,
    kind: "blocked",
    at,
    title: "Blocked by pending approval",
    detail: blockingApprovalDetail(blocker),
    status: "blocked",
    blockingApprovalId: blocker.approval.id,
    sourceLabel: blockingApprovalSourceLabel(blocker, agentsById)
  };
}

function blockingApprovalActivity(
  blocker: BlockingRuntimeApproval,
  timelines: TaskExecutionTimeline[],
  executionNumbers: Map<string, number>,
  agentsById?: Map<string, string>
): ExecutionConsoleBlock {
  const currentExecution = blocker.currentExecution ?? timelines.find((timeline) => timeline.execution)?.execution ?? null;
  return {
    id: `active:blocking:${blocker.approval.id}`,
    kind: "activity",
    at: currentExecution?.updatedAt ?? blocker.approval.requestedAt,
    title: "Blocked",
    detail: "Pending approval in another thread is blocking this agent's runtime queue.",
    status: "blocked",
    sourceLabel: currentExecution ? executionSourceLabel(currentExecution, executionNumbers, agentsById) : blockingApprovalSourceLabel(blocker, agentsById),
    sourceExecutionId: currentExecution?.id,
    sourceOrder: currentExecution ? executionNumbers.get(currentExecution.id) : undefined
  };
}

function blockingApprovalDetail(blocker: BlockingRuntimeApproval): string {
  const context = blocker.sameThread ? "this thread" : "another thread";
  const title = blocker.approval.title?.trim() || "Approval required";
  const detail = blocker.approval.detail?.trim();
  return detail ? `${title} in ${context}: ${detail}` : `${title} in ${context}.`;
}

function blockingApprovalSourceLabel(blocker: BlockingRuntimeApproval, agentsById?: Map<string, string>): string | undefined {
  const agent = agentsById?.get(blocker.approval.agentId) ?? "Unknown agent";
  return `${agent} · blocked`;
}

function promptBlockAt(timeline: TaskExecutionTimeline, approvals: RuntimeApprovalRecord[]): string | undefined {
  const timestamps = [
    timeline.execution?.createdAt,
    ...timeline.events.map((event) => event.at),
    ...approvals.map((approval) => approval.requestedAt)
  ];
  const earliest = timestamps
    .map((value) => value ? Date.parse(value) : NaN)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  return earliest === undefined ? undefined : new Date(Math.max(0, earliest - 1)).toISOString();
}

function appendProcessSkeleton(blocks: ExecutionConsoleBlock[], timeline: TaskExecutionTimeline, hasApprovals = false): void {
  const execution = timeline.execution;
  if (!execution && hasApprovals) {
    blocks.push({
      id: "execution:legacy-approval-only",
      kind: "thinking",
      at: blocks[0]?.at ?? new Date(0).toISOString(),
      title: "Working",
      detail: "This agent run is missing an execution binding, so only approvals and command records can be shown."
    });
    return;
  }
  if (!execution) return;
  const hasLifecycle = timeline.events.some((event) => event.kind === "queued" || event.kind === "delivered" || event.kind === "turn_started");
  if (!hasLifecycle && hasApprovals) {
    blocks.push({
      id: `execution:${execution.id}`,
      kind: "system",
      at: execution.createdAt,
      title: "Execution started",
      detail: "The runtime execution session has been created. Task delivery and output will continue updating here.",
      tone: "muted"
    });
  }
  const hasVisibleAgentProcess = timeline.events.some((event) => !isStartupLifecycleEvent(event) && (event.kind === "thinking" || event.kind === "assistant_delta"));
  if (!hasVisibleAgentProcess && !hasApprovals) {
    blocks.push({
      id: `thinking:${execution.id}`,
      kind: "thinking",
      at: execution.updatedAt || execution.createdAt,
      title: "Thinking",
      detail: execution.status === "queued" || execution.status === "delivered"
        ? "Waiting for the runtime to accept the task and start output."
        : "The agent is analyzing the task and preparing to run."
    });
  }
}

function isStartupLifecycleEvent(event: RuntimeExecutionEventRecord): boolean {
  return event.kind === "queued" || event.kind === "delivered" || event.kind === "turn_started";
}

function isBoilerplateThinking(detail: string | undefined): boolean {
  const text = detail?.trim() ?? "";
  return !text || text === "Thinking..." || /^Reconnecting\.\.\. \d+\/\d+$/.test(text);
}

function appendExploredBlock(blocks: ExecutionConsoleBlock[], event: RuntimeExecutionEventRecord): void {
  const item = `${explorationLabel(event.title || "Read")} ${explorationTarget(event)}`.trim();
  const last = blocks.at(-1);
  if (last?.kind === "explored") {
    last.items = [...(last.items ?? []), item];
    last.at = event.at;
    return;
  }
  blocks.push({
    id: event.id,
    kind: "explored",
    at: event.at,
    title: "Explored",
    items: [item]
  });
}

function appendThinkingDetail(current: string | undefined, next: string | null | undefined): string {
  const incoming = next?.trim() ? next : "Thinking...";
  if (!current || current === "Thinking...") return incoming;
  if (incoming === "Thinking...") return current;
  return `${current}${incoming}`;
}

export function executionSilenceNotice(timeline: TaskExecutionTimeline, hasPendingApproval: boolean, nowMs: number, thresholdMs = 60_000): ExecutionConsoleBlock | null {
  const execution = timeline.execution;
  if (!execution || hasPendingApproval || execution.status === "completed" || execution.status === "failed" || execution.status === "cancelled") return null;
  if (execution.status === "queued") return null;
  const latestAt = timeline.events.at(-1)?.at ?? execution.updatedAt ?? execution.createdAt;
  const elapsedMs = nowMs - Date.parse(latestAt);
  if (elapsedMs < thresholdMs) return null;
  const seconds = Math.floor(elapsedMs / 1000);
  const detail = execution.status === "delivered"
      ? `The task was delivered, but the runtime has not produced output for ${seconds} seconds.`
      : `The runtime is running, but there has been no new output for ${seconds} seconds.`;
  return {
    id: `stale:${execution.id}`,
    kind: "stale",
    at: latestAt,
    title: execution.status === "delivered" ? "No daemon progress" : "No runtime output",
    detail,
    status: "running"
  };
}

function commandFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const command = (payload as { command?: unknown }).command;
  if (typeof command === "string") return command;
  if (Array.isArray(command)) return command.map(String).join(" ");
  return null;
}

function isEmptyObjectPayload(payload: unknown): boolean {
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload) && Object.keys(payload).length === 0);
}

function approvalForEvent(event: RuntimeExecutionEventRecord, approvals: RuntimeApprovalRecord[]): RuntimeApprovalRecord | null {
  const payload = objectPayload(event.payload);
  const approvalId = typeof payload?.approvalId === "string" ? payload.approvalId : "";
  if (approvalId) {
    const match = approvals.find((approval) => approval.id === approvalId);
    if (match) return match;
  }
  const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
  if (requestId) {
    const match = approvals.find((approval) => approval.requestId === requestId);
    if (match) return match;
  }
  const eventCommand = normalizeApprovalCommand(approvalCommandFromEvent(event) ?? event.detail ?? "");
  if (!eventCommand) return null;
  return approvals.find((approval) => normalizeApprovalCommand(commandFromPayload(approval.payload) ?? approval.detail) === eventCommand) ?? null;
}

function approvalStatusFromEvent(event: RuntimeExecutionEventRecord): RuntimeApprovalRecord["status"] | null {
  const status = objectPayload(event.payload)?.approvalStatus;
  return status === "approved" || status === "rejected" || status === "custom" || status === "pending" ? status : null;
}

function approvalEventIsNonBlocking(event: RuntimeExecutionEventRecord): boolean {
  return objectPayload(event.payload)?.approvalNonBlocking === true;
}

function approvalCommandFromEvent(event: RuntimeExecutionEventRecord): string | null {
  return commandFromPayload(event.payload) ?? event.detail ?? null;
}

function normalizeApprovalCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function objectPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function approvalReason(approval: RuntimeApprovalRecord): string {
  const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { reason?: unknown; explanation?: unknown } : null;
  if (typeof payload?.reason === "string" && payload.reason.trim()) return payload.reason.trim();
  if (typeof payload?.explanation === "string" && payload.explanation.trim()) return payload.explanation.trim();
  if (approval.kind === "command") return "The runtime wants to run this command and needs your approval.";
  return approval.detail;
}

export function approvalGovernanceSummary(approval: RuntimeApprovalRecord): ApprovalGovernanceSummary | undefined {
  const payload = objectPayload(approval.payload);
  const governance = objectPayload(payload?.governance);
  if (!governance) return undefined;
  const decision = typeof governance.decision === "string" ? governance.decision : "";
  if (!decision) return undefined;
  const sourceSummaries = governanceSourceSummaryLabels(governance.sourceTags ?? payload?.sourceTags);
  return {
    decision,
    mode: typeof governance.mode === "string" ? governance.mode : undefined,
    model: typeof governance.model === "string" && governance.model.trim() ? governance.model.trim() : undefined,
    policyVersion: typeof governance.policyVersion === "string" && governance.policyVersion.trim() ? governance.policyVersion.trim() : undefined,
    policySource: typeof governance.policySource === "string" && governance.policySource.trim() ? governance.policySource.trim() : undefined,
    policyScope: typeof governance.policyScope === "string" && governance.policyScope.trim() ? governance.policyScope.trim() : undefined,
    decisionSource: typeof governance.decisionSource === "string" && governance.decisionSource.trim() ? governance.decisionSource.trim() : undefined,
    confidence: typeof governance.confidence === "number" && Number.isFinite(governance.confidence) ? governance.confidence : undefined,
    riskTypes: Array.isArray(governance.riskTypes) ? governance.riskTypes.map(String) : [],
    reason: typeof governance.reason === "string" && governance.reason.trim() ? governance.reason.trim() : undefined,
    evidence: Array.isArray(governance.evidence) ? governance.evidence.map(String).filter((item) => item.trim()).slice(0, 2) : [],
    ...(sourceSummaries.length ? { sourceSummaries } : {})
  };
}

function runningCommandTitle(command: string): string {
  const tokens = command.replace(/^\/(?:usr\/)?bin\/(?:zsh|bash|sh)\s+-lc\s+/, "").replace(/^['"]|['"]$/g, "").trim().split(/\s+/);
  return `Running ${tokens.slice(0, 2).join(" ") || "command"}`;
}

function compactCommandForDisplay(command: string): { command: string; fullCommand?: string; truncated?: boolean } {
  const view = compactExecutionText(command, EXECUTION_COMMAND_PREVIEW_LIMIT);
  return view.truncated ? { command: view.text, fullCommand: view.fullText, truncated: true } : { command };
}

function compactPayloadForDisplay(payload: unknown): { payload: string; fullPayload?: string; truncated?: boolean } | null {
  const text = payloadText(payload);
  if (!text) return null;
  const view = compactExecutionText(text);
  return view.truncated ? { payload: view.text, fullPayload: view.fullText, truncated: true } : { payload: view.text };
}

function detailFields(detail: string | null | undefined): Pick<ExecutionConsoleBlock, "detail" | "fullDetail" | "detailTruncated"> {
  if (!detail) return {};
  const view = compactExecutionText(detail);
  return view.truncated ? { detail: view.text, fullDetail: view.fullText, detailTruncated: true } : { detail: view.text };
}

function outputFields(output: string): Pick<ExecutionConsoleBlock, "output" | "fullOutput" | "outputTruncated"> {
  const view = compactExecutionText(output);
  return view.truncated ? { output: view.text, fullOutput: view.fullText, outputTruncated: true } : { output: view.text };
}

function customResponseFields(customResponse: string): Pick<ExecutionConsoleBlock, "customResponse" | "fullCustomResponse" | "customResponseTruncated"> {
  const view = compactExecutionText(customResponse);
  return view.truncated ? { customResponse: view.text, fullCustomResponse: view.fullText, customResponseTruncated: true } : { customResponse: view.text };
}

function payloadText(payload: unknown): string {
  if (payload === undefined || payload === null) return "";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function limitExecutionText(value: string, limit: ExecutionTextLimit): { text: string; truncated: boolean } {
  const lines = value.split(/\r?\n/);
  const lineLimited = lines.length > limit.maxLines ? `${lines.slice(0, limit.maxLines).join("\n")}\n...` : value;
  const charLimited = lineLimited.length > limit.maxChars ? `${lineLimited.slice(0, limit.maxChars).trimEnd()}\n...` : lineLimited;
  return { text: charLimited, truncated: charLimited !== value };
}

function toolBlockTitle(name: string, command?: string): string {
  if (command && /^(shell|sh|bash|zsh|command|run command)$/i.test(name.trim())) return runningCommandTitle(command);
  return name;
}

function isExplorationTool(name: string): boolean {
  return /^(read|view|cat|rg|grep|search|find|list|ls|web_search|mcp_chat_read_history|mcp_chat_search_messages|mcp_chat_read_file|mcp_chat_list_files)$/i.test(name.trim());
}

function explorationTarget(event: RuntimeExecutionEventRecord): string {
  if (event.detail?.trim() && !looksLikeJson(event.detail)) return event.detail.trim();
  const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : null;
  const direct = payload?.path ?? payload?.file_path ?? payload?.file ?? payload?.query ?? payload?.pattern ?? payload?.channel;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  // daemon 旧事件的 detail 可能是 JSON 字符串；没有 payload 可拆时才留空，避免展示原始 JSON。
  return "";
}

function explorationLabel(name: string): string {
  if (name === "mcp_chat_read_history") return "Read history";
  if (name === "mcp_chat_search_messages") return "Search messages";
  if (name === "mcp_chat_read_file") return "Read file";
  if (name === "mcp_chat_list_files") return "List files";
  if (name === "web_search") return "Web search";
  return name;
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function isCompactWorkflowCommand(command: string): boolean {
  if (!/\btyr(?:cli)?\s+(?:task|message|channel|thread|profile|attachment|reminder)\b/.test(command)) return false;
  if (/\btyr(?:cli)?\s+message\s+send\b/.test(command)) return false;
  if (/\btyr(?:cli)?\s+(?:attachment\s+upload|profile\s+update|reminder\s+(?:schedule|update|cancel|snooze)|channel\s+(?:join|leave))\b/.test(command)) return false;
  return true;
}

function workflowSummaryIsNonBlocking(approval: RuntimeApprovalRecord, command: string): boolean {
  return approvalIsNonBlocking(approval) || isReadonlyWorkflowCommand(command);
}

function isReadonlyWorkflowCommand(command: string): boolean {
  const text = command.trim();
  if (/\b--help\b/.test(text)) return true;
  return /\btyr(?:cli)?\s+message\s+read\b/.test(text) || /\btyr(?:cli)?\s+task\s+list\b/.test(text);
}

function approvalIsNonBlocking(approval: RuntimeApprovalRecord): boolean {
  const payload = objectPayload(approval.payload);
  return payload?.approvalNonBlocking === true;
}

function executionEventTitle(kind: RuntimeExecutionEventRecord["kind"]): string {
  if (kind === "queued") return "Queued";
  if (kind === "delivered") return "Delivered";
  if (kind === "delivery_acknowledged") return "Delivery acknowledged";
  if (kind === "turn_started") return "Turn started";
  if (kind === "approval_resolved") return "Approval resolved";
  if (kind === "turn_completed") return "Turn completed";
  return "Runtime event";
}
