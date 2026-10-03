import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Activity, Check, ChevronDown, Download, Edit3, ExternalLink, Shield, Terminal, X } from 'lucide-react';
import { runtimeDisplayName, type AgentRecord, type AgentRunRecord, type ExecutionArtifactRecord, type ExecutionBlockPageInfo, type ExecutionBlockRecord, type GovernanceDecisionRecord, type MachineRecord, type RuntimeApprovalRecord, type RuntimeExecutionDebugExport, type RuntimeReport } from '@tyr-ai/contracts';
import { activityText, activityTitle } from '../../shared/activity';
import { formatTime } from '../../app/workspaceUtils';
import type { ActivityLogItem } from '../../app/workspaceTypes';
import { approvalActionDisabled } from '../../approvalView';
import type { BlockingRuntimeApproval } from '../../approvalView';
import { approvalGovernanceSummary, buildExecutionTranscript, compactExecutionText, executionSilenceNotice, executionStatusLabel, EXPANDED_EXECUTION_TRANSCRIPT_BLOCK_LIMIT, isExecutionScrollAtLatest, type ApprovalGovernanceSummary, type ExecutionConsoleBlock, type TaskExecutionTimeline } from '../../executionView';
import { buildClientExecutionDebugExport, buildRuntimeDebugEnvironment, downloadJsonFile, executionDebugExportFilename } from '../../executionDebugExport';
import { executionContentVersion as executionBlockContentVersion } from '../../executionBlockRealtime';
import { governanceSourceSummariesFromDecision } from '../../governanceView';
import { api } from '../../lib/api';
import type { SafetyReview } from '../../safetyView';
import { SafetyReviewPanel } from './SafetyReviewPanel';

type RuntimeApprovalItem = RuntimeApprovalRecord;
const EXECUTION_FOLLOW_LATEST_THRESHOLD_PX = 80;

type ExecutionContextStatus = "loading" | "ready" | "empty" | "error";

type TaskExecutionPanelProps = {
  prompt: string;
  timelines: TaskExecutionTimeline[];
  approvals: RuntimeApprovalItem[];
  activity: ActivityLogItem[];
  agents: AgentRecord[];
  machines?: Array<MachineRecord & { runtimes?: RuntimeReport[] }>;
  safetyReview?: SafetyReview | null;
  governanceDecisions?: GovernanceDecisionRecord[];
  executionBlocks?: ExecutionBlockRecord[];
  agentRuns?: AgentRunRecord[];
  executionArtifacts?: ExecutionArtifactRecord[];
  blockingApproval?: BlockingRuntimeApproval | null;
  contextStatus?: ExecutionContextStatus;
  blockPageInfo?: ExecutionBlockPageInfo | null;
  onLoadEarlierBlocks?: () => Promise<void>;
  onRetryExecutionContext?: () => void;
  onResolveApproval: (approvalId: string, decision: "approve" | "reject" | "custom", customResponse?: string) => Promise<void>;
  onViewBlockingApproval?: (approval: RuntimeApprovalRecord) => void;
  focusApprovalId?: string;
  debugExportSource?: "server" | "client";
};

function isExecutionAttentionBlock(block: ExecutionConsoleBlock): boolean {
  return (block.kind === "approval" && block.status === "pending") || block.kind === "blocked";
}

function executionAttentionTitle(block: ExecutionConsoleBlock): string {
  const agent = block.sourceLabel?.split("·")[0]?.trim();
  const tag = agent && agent !== "Unknown agent" ? agent.startsWith("@") ? agent : `@${agent}` : "Agent";
  return `${tag} · Needs approval`;
}

export function TaskExecutionPanel({ prompt, timelines, approvals, activity, agents, machines = [], safetyReview, governanceDecisions = [], executionBlocks = [], agentRuns = [], executionArtifacts = [], blockingApproval, contextStatus = "ready", blockPageInfo, onLoadEarlierBlocks, onRetryExecutionContext, onResolveApproval, onViewBlockingApproval, focusApprovalId, debugExportSource = "server" }: TaskExecutionPanelProps) {
  const [followingLatest, setFollowingLatest] = useState(true);
  const [showScrollLatest, setShowScrollLatest] = useState(false);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [debugExportStatus, setDebugExportStatus] = useState("");
  const [loadingEarlierBlocks, setLoadingEarlierBlocks] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const activeTimelines = timelines.length > 0 ? timelines : [{ execution: null, events: [] }];
  const agentsById = useMemo(() => {
    const names = new Map(agents.map((agent) => [agent.id, agent.displayName || agent.name]));
    for (const run of agentRuns) {
      if (names.has(run.agentId)) continue;
      names.set(run.agentId, run.agentDisplayName || run.agentName || "Deleted agent");
    }
    for (const execution of activeTimelines.map((timeline) => timeline.execution).filter(Boolean) as NonNullable<TaskExecutionTimeline["execution"]>[]) {
      if (names.has(execution.agentId)) continue;
      names.set(execution.agentId, execution.agentDisplayName || execution.agentName || "Deleted agent");
    }
    return names;
  }, [agents, agentRuns, activeTimelines]);
  const hasExecutionBlockRecords = executionBlocks.length > 0;
  const transcript = useMemo(() => {
    return buildExecutionTranscript(activeTimelines, approvals, { prompt, agentsById, maxBlocks: showFullHistory ? EXPANDED_EXECUTION_TRANSCRIPT_BLOCK_LIMIT : undefined, blockingApproval });
  }, [activeTimelines, approvals, prompt, agentsById, showFullHistory, blockingApproval]);
  const blockDrivenBlocks = useMemo(() => limitBlockDrivenConsoleBlocks(executionRecordsToConsoleBlocks(executionBlocks, { agentsById, approvals, governanceDecisions })), [executionBlocks, agentsById, approvals, governanceDecisions]);
  const hasExecutionBlocks = blockDrivenBlocks.length > 0;
  const runtimeOverlayBlocks = useMemo(() => {
    if (!hasExecutionBlocks) return [];
    const blockApprovalIds = new Set(executionBlocks.map((block) => block.approvalId).filter(Boolean) as string[]);
    return transcript.blocks.filter((block) =>
      (block.kind === "blocked" && block.blockingApprovalId) ||
      (
        block.kind === "approval" &&
        block.status === "pending" &&
        (!block.approvalId || !blockApprovalIds.has(block.approvalId))
      )
    );
  }, [executionBlocks, hasExecutionBlocks, transcript.blocks]);
  const governanceBlocks = useMemo(() => governanceDecisionBlocks(governanceDecisions, activeTimelines, approvals), [governanceDecisions, activeTimelines, approvals]);
  const hasBlockingApproval = Boolean(blockingApproval);
  const hasPendingApproval = hasBlockingApproval || approvals.some((approval) => approval.status === "pending") || executionBlocks.some((block) => block.kind === "approval_gate" && block.status === "pending");
  const staleBlocks = useMemo(
    () => activeTimelines.map((timeline) => executionSilenceNotice(timeline, hasPendingApproval, Date.now())).filter(Boolean) as ExecutionConsoleBlock[],
    [activeTimelines, hasPendingApproval, transcript.hiddenBlockCount]
  );
  const rawBlocks = hasExecutionBlocks
    ? [...blockDrivenBlocks, ...runtimeOverlayBlocks].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    : [...transcript.blocks, ...governanceBlocks, ...staleBlocks].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const attentionBlocks = useMemo(() => rawBlocks.filter(isExecutionAttentionBlock), [rawBlocks]);
  const attentionBlockIds = useMemo(() => new Set(attentionBlocks.map((block) => block.id)), [attentionBlocks]);
  const blocks = useMemo(() => settleSupersededRunningAssistantBlocks(rawBlocks.filter((block) => !attentionBlockIds.has(block.id))), [rawBlocks, attentionBlockIds]);
  const currentActivities = hasExecutionBlocks ? [] : transcript.currentActivities ?? (transcript.currentActivity ? [transcript.currentActivity] : []);
  const executions = transcript.executions;
  const totalBlockCount = blocks.length + currentActivities.length;
  const executionContentVersion = useMemo(
    () => hasExecutionBlocks
      ? executionBlockContentVersion(executionBlocks)
      : blocks.map((block) => [
        block.id,
        block.status ?? "",
        block.text?.length ?? 0,
        block.detail?.length ?? 0,
        block.command?.length ?? 0,
        block.output?.length ?? 0
      ].join(":")).join("|"),
    [hasExecutionBlocks, executionBlocks, blocks]
  );
  const executionIds = executions.map((execution) => execution.id);
  const scrollToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    const stream = streamRef.current;
    if (!stream) return;
    stream.scrollTo({ top: stream.scrollHeight, behavior });
    setFollowingLatest(true);
    setShowScrollLatest(false);
  }, []);
  const handleExecutionScroll = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const atLatest = isExecutionScrollAtLatest(stream, EXECUTION_FOLLOW_LATEST_THRESHOLD_PX);
    setFollowingLatest(atLatest);
    setShowScrollLatest(!atLatest && stream.scrollHeight > stream.clientHeight);
  }, []);
  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    if (document.visibilityState !== "visible") return;
    if (!followingLatest) {
      setShowScrollLatest(!isExecutionScrollAtLatest(stream, EXECUTION_FOLLOW_LATEST_THRESHOLD_PX) && stream.scrollHeight > stream.clientHeight);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      stream.scrollTop = stream.scrollHeight;
      setShowScrollLatest(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activity.length, totalBlockCount, executionContentVersion, followingLatest]);
  async function exportDebugData() {
    setDebugExportStatus("");
    try {
      const debugData = debugExportSource === "server" && executionIds.length > 0
        ? await api<RuntimeExecutionDebugExport>("/api/runtime-executions/debug-export", {
          method: "POST",
          body: JSON.stringify({ executionIds })
        })
        : buildClientExecutionDebugExport({
          prompt,
          timelines: activeTimelines,
          approvals,
          executionBlocks,
          safetyAssessments: safetyReview?.assessments ?? [],
          governanceDecisions,
          environment: buildRuntimeDebugEnvironment(machines)
        });
      downloadJsonFile(executionDebugExportFilename(debugData), debugData);
      setDebugExportStatus("Debug data exported.");
    } catch (error) {
      setDebugExportStatus(error instanceof Error ? error.message : "Debug export failed.");
    }
  }
  async function loadEarlierBlocks() {
    if (!onLoadEarlierBlocks || loadingEarlierBlocks) return;
    setLoadingEarlierBlocks(true);
    try {
      await onLoadEarlierBlocks();
    } finally {
      setLoadingEarlierBlocks(false);
    }
  }
  if (timelines.length === 0 && approvals.length === 0 && activity.length === 0 && governanceBlocks.length === 0 && executionBlocks.length === 0 && executionArtifacts.length === 0 && !safetyReview && !blockingApproval) {
    const emptyTitle = contextStatus === "loading"
      ? "Loading execution..."
      : contextStatus === "error"
        ? "Execution details unavailable"
        : contextStatus === "empty"
          ? "No execution details recorded yet"
          : "Waiting for CLI execution details";
    const emptyDetail = contextStatus === "loading"
      ? "Loading commands, runtime output, and approvals."
      : contextStatus === "error"
        ? "Execution details could not be loaded."
        : contextStatus === "empty"
          ? "This message has no recorded execution output."
          : "Agent commands, file changes, and approval requests will appear here.";
    return (
      <div className="thread-body execution-body">
        <div className="execution-empty">
          <Activity size={18} />
          <b>{emptyTitle}</b>
          <span>{emptyDetail}</span>
          {contextStatus === "error" && onRetryExecutionContext ? <button className="btn small" type="button" onClick={onRetryExecutionContext}>Retry</button> : null}
        </div>
      </div>
    );
  }
  const primaryExecution = executions
    .filter((execution) => execution.status !== "completed" && execution.status !== "failed" && execution.status !== "cancelled")
    // 多 agent 协作时可能有旧 execution 未结束；标题栏展示最近有活动的那个。
    .sort((a, b) => Date.parse(a.updatedAt || a.createdAt) - Date.parse(b.updatedAt || b.createdAt))
    .at(-1) ?? executions.at(-1) ?? null;
  const primaryRun = agentRuns
    .filter((run) => run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled")
    .sort((a, b) => Date.parse(a.updatedAt || a.createdAt) - Date.parse(b.updatedAt || b.createdAt))
    .at(-1) ?? agentRuns.at(-1) ?? null;
  const primaryStatus = hasBlockingApproval ? "blocked" : primaryExecution?.status ?? primaryRun?.status ?? "idle";
  const primaryStatusLabel = hasBlockingApproval ? "Blocked" : primaryExecution ? executionStatusLabel(primaryExecution.status) : primaryRun ? agentRunStatusLabel(primaryRun.status) : "";
  return (
    <div className="thread-body execution-body">
      <section className={`execution-console ${primaryStatus}`}>
        <div className="execution-console-head">
          <div>
            <span className="execution-console-icon"><Terminal size={16} /></span>
            <b>Execution</b>
          </div>
          <div className="execution-console-meta">
            <button className="execution-debug-export" type="button" onClick={() => void exportDebugData()} title="Export debug data">
              <Download size={13} /> Export debug data
            </button>
            {executions.length > 1 && <span>{executions.length} executions</span>}
            {executions.length === 0 && agentRuns.length > 1 && <span>{agentRuns.length} runs</span>}
            {primaryExecution && executions.length === 1 && <span>{runtimeDisplayName(primaryExecution.runtime)}</span>}
            {!primaryExecution && primaryRun && <span>{runtimeDisplayName(primaryRun.runtime)}</span>}
            {primaryExecution && <time>{formatTime(primaryExecution.createdAt)}</time>}
            {!primaryExecution && primaryRun && <time>{formatTime(primaryRun.createdAt)}</time>}
            {primaryExecution && <span className={`execution-status ${primaryStatus}`}>{primaryStatusLabel}</span>}
            {!primaryExecution && primaryRun && <span className={`execution-status ${primaryStatus}`}>{primaryStatusLabel}</span>}
          </div>
        </div>
        <SafetyReviewPanel key={safetyReview?.assessments.map((assessment) => assessment.id).join("|") ?? "empty"} review={safetyReview} />
        {attentionBlocks.length > 0 && (
          <div className="execution-attention" aria-label="Execution needs approval">
            {attentionBlocks.map((block) => (
              <div key={block.id} className="execution-attention-item">
                <div className="execution-attention-title">
                  <Shield size={14} />
                  <b>{executionAttentionTitle(block)}</b>
                </div>
                <ExecutionConsoleBlockView block={{ ...block, sourceLabel: undefined }} approvals={approvals} blockingApproval={blockingApproval ?? null} onResolveApproval={onResolveApproval} onViewBlockingApproval={onViewBlockingApproval} focusApprovalId={focusApprovalId} />
              </div>
            ))}
          </div>
        )}
        <div ref={streamRef} className="execution-console-stream" onScroll={handleExecutionScroll}>
          {hasExecutionBlocks && blockPageInfo?.hasMoreBefore && onLoadEarlierBlocks ? (
            <button className="execution-history-toggle" type="button" onClick={() => void loadEarlierBlocks()} disabled={loadingEarlierBlocks}>
              {loadingEarlierBlocks ? "Loading earlier execution output..." : "Load earlier execution output"}
            </button>
          ) : null}
          {!hasExecutionBlocks && transcript.hiddenBlockCount && !showFullHistory ? (
            <button className="execution-history-toggle" type="button" onClick={() => setShowFullHistory(true)}>
              Show earlier output ({transcript.hiddenBlockCount})
            </button>
          ) : null}
          {!hasExecutionBlocks && transcript.hiddenBlockCount && showFullHistory ? (
            <div className="execution-console-line muted">
              <span className="execution-line-prefix">·</span>
              <span>{transcript.hiddenBlockCount} earlier blocks hidden.</span>
            </div>
          ) : null}
          {debugExportStatus && (
            <div className="execution-console-line muted" role="status">
              <span className="execution-line-prefix">·</span>
              <span>{debugExportStatus}</span>
            </div>
          )}
          {blocks.length === 0 && activity.length === 0 && currentActivities.length === 0 && (
            <div className="execution-console-line muted">
              <span className="execution-line-prefix">·</span>
              <span>Waiting for runtime output...</span>
            </div>
          )}
          {blocks.map((block) => (
            <ExecutionConsoleBlockView key={block.id} block={block} approvals={approvals} blockingApproval={blockingApproval ?? null} onResolveApproval={onResolveApproval} onViewBlockingApproval={onViewBlockingApproval} focusApprovalId={focusApprovalId} />
          ))}
          {/* execution events 是执行面板真源；旧 activity 只在没有绑定 execution 时兜底展示。 */}
          {activity.length > 0 && blocks.length === 0 && activity.map((item, activityIndex) => (
            <div key={`${item.timestamp}-${activityIndex}`} className="execution-console-line legacy">
              <span className="execution-line-prefix">›</span>
              <div className="execution-line-main">
                <div className="execution-line-title"><b>{activityTitle(item.entry)}</b><time>{formatTime(item.timestamp)}</time></div>
                <pre>{activityText(item.entry)}</pre>
              </div>
            </div>
          ))}
        </div>
        {currentActivities.length > 0 && (
          <div className="execution-console-activity">
            {currentActivities.map((currentActivity) => (
              <ExecutionConsoleBlockView key={currentActivity.id} block={currentActivity} approvals={approvals} blockingApproval={blockingApproval ?? null} onResolveApproval={onResolveApproval} onViewBlockingApproval={onViewBlockingApproval} focusApprovalId={focusApprovalId} />
            ))}
          </div>
        )}
        {showScrollLatest && (
          <button className="execution-scroll-latest" type="button" aria-label="Back to latest" title="Back to latest" onClick={() => scrollToLatest()}>
            <ChevronDown size={18} />
          </button>
        )}
      </section>
    </div>
  );
}

type ExecutionBlockConversionContext = {
  agentsById: Map<string, string>;
  approvals: RuntimeApprovalItem[];
  governanceDecisions: GovernanceDecisionRecord[];
};

function executionRecordsToConsoleBlocks(blocks: ExecutionBlockRecord[], context: ExecutionBlockConversionContext): ExecutionConsoleBlock[] {
  const sortedBlocks = [...blocks]
    .sort((a, b) => a.groupSequence - b.groupSequence || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const consoleBlocks: ExecutionConsoleBlock[] = [];
  for (let index = 0; index < sortedBlocks.length; index += 1) {
    const block = sortedBlocks[index];
    const nextBlock = sortedBlocks[index + 1];
    if (nextBlock && executionBlocksAreMergeableShellPair(block, nextBlock)) {
      // 这里只做 UI 级分组；server/debug 真源仍保留 command 与 output 两个 block。
      consoleBlocks.push(mergedShellConsoleBlock(block, nextBlock, context));
      index += 1;
      continue;
    }
    const consoleBlock = executionRecordToConsoleBlock(block, context);
    if (consoleBlock) consoleBlocks.push(consoleBlock);
  }
  return consoleBlocks;
}

function executionBlocksAreMergeableShellPair(commandBlock: ExecutionBlockRecord, outputBlock: ExecutionBlockRecord): boolean {
  return commandBlock.kind === "command" &&
    outputBlock.kind === "tool_output" &&
    commandBlock.groupId === outputBlock.groupId &&
    commandBlock.title === outputBlock.title &&
    commandBlock.agentId === outputBlock.agentId &&
    commandBlock.runId === outputBlock.runId;
}

function mergedShellConsoleBlock(commandBlock: ExecutionBlockRecord, outputBlock: ExecutionBlockRecord, context: ExecutionBlockConversionContext): ExecutionConsoleBlock {
  const command = executionRecordToConsoleBlock(commandBlock, context);
  if (!command) return executionRecordToConsoleBlock(outputBlock, context) ?? { id: outputBlock.id, kind: "tool", at: outputBlock.createdAt, title: outputBlock.title, output: outputBlock.bodyPreview ?? "", status: consoleStatusFromExecutionBlock(outputBlock.status) ?? "completed" };
  const outputText = outputBlock.bodyPreview ?? "";
  const outputStatus = consoleStatusFromExecutionBlock(outputBlock.status) ?? "completed";
  if (isTrivialCompletedOutput(outputText)) {
    return { ...command, status: outputStatus };
  }
  const outputView = compactExecutionText(outputText);
  return {
    ...command,
    output: outputView.text,
    fullOutput: outputView.fullText,
    outputTruncated: outputView.truncated,
    status: outputStatus
  };
}

function isTrivialCompletedOutput(value: string): boolean {
  const output = value.trim();
  return output === "Completed." || output === "Completed";
}

function limitBlockDrivenConsoleBlocks(blocks: ExecutionConsoleBlock[], maxBlocks = 30): ExecutionConsoleBlock[] {
  if (blocks.length <= maxBlocks) return blocks;
  const pinnedIds = new Set(blocks
    .filter((block) =>
      block.kind === "blocked" ||
      block.kind === "governance" ||
      (block.kind === "approval" && block.status === "pending") ||
      block.kind === "system" && block.title === "Completed"
    )
    .map((block) => block.id));
  const tailBudget = Math.max(0, maxBlocks - pinnedIds.size);
  const tailIds = new Set(blocks.filter((block) => !pinnedIds.has(block.id)).slice(-tailBudget).map((block) => block.id));
  const visible = blocks.filter((block) => pinnedIds.has(block.id) || tailIds.has(block.id));
  const firstVisibleAt = visible[0]?.at ?? blocks[0]?.at ?? new Date(0).toISOString();
  return [{
    id: "block-history:hidden",
    kind: "system",
    at: firstVisibleAt,
    title: "Hidden earlier output",
    detail: `${blocks.length - visible.length} earlier execution blocks hidden.`,
    tone: "muted"
  }, ...visible];
}

function settleSupersededRunningAssistantBlocks(blocks: ExecutionConsoleBlock[]): ExecutionConsoleBlock[] {
  // 后续动作已经出现时，前一段 assistant 输出在视觉上应收尾，避免边流式边执行的错觉。
  const latestBlockIndex = blocks.length - 1;
  return blocks.map((block, index) =>
    block.kind === "assistant" && block.status === "running" && index < latestBlockIndex
      ? { ...block, status: "completed" as const }
      : block
  );
}

function executionRecordToConsoleBlock(block: ExecutionBlockRecord, context: ExecutionBlockConversionContext): ExecutionConsoleBlock | null {
  const approval = block.approvalId ? context.approvals.find((item) => item.id === block.approvalId) ?? null : null;
  const governanceDecision = governanceDecisionForExecutionBlock(block, context.governanceDecisions);
  const governance = approval
    ? approvalGovernanceSummary(approval) ?? (governanceDecision ? governanceSummaryFromDecision(governanceDecision) : undefined)
    : governanceDecision ? governanceSummaryFromDecision(governanceDecision) : undefined;
  const base = {
    id: block.id,
    at: block.createdAt,
    title: block.title,
    sourceLabel: block.agentId ? context.agentsById.get(block.agentId) ?? "Unknown agent" : undefined,
    status: consoleStatusFromExecutionBlock(block.status)
  };
  const bodyPreview = block.bodyPreview ?? "";
  if (block.kind === "prompt") {
    return { ...base, kind: "prompt", text: bodyPreview || block.title };
  }
  if (block.kind === "assistant_message") {
    const view = compactExecutionText(bodyPreview);
    return { ...base, kind: "assistant", text: view.text, fullText: view.fullText, textTruncated: view.truncated, status: consoleStatusFromExecutionBlock(block.status) ?? "completed" };
  }
  if (block.kind === "thinking_summary") {
    return { ...base, kind: "thinking", detail: bodyPreview };
  }
  if (block.kind === "command") {
    return { ...base, kind: "tool", command: bodyPreview, status: consoleStatusFromExecutionBlock(block.status) ?? "running" };
  }
  if (block.kind === "tool_call" && block.title === "mcp_chat_claim_message_as_task") {
    return {
      ...base,
      title: "Claim message as task",
      kind: "tool",
      detail: claimMessageToolDetail(bodyPreview),
      status: consoleStatusFromExecutionBlock(block.status) ?? "running"
    };
  }
  if (block.kind === "tool_call" || block.kind === "file_change" || block.kind === "artifact") {
    return { ...base, kind: "tool", detail: bodyPreview, status: consoleStatusFromExecutionBlock(block.status) ?? "running" };
  }
  if (block.kind === "tool_output") {
    return { ...base, kind: "tool", output: bodyPreview, status: consoleStatusFromExecutionBlock(block.status) ?? "completed" };
  }
  if (block.kind === "approval_gate") {
    // Approval 记录是审批状态真源；block 可能因旧 realtime 丢失仍停留在 pending。
    const approvalStatus = approval?.status ?? approvalStatusFromExecutionBlock(block.status);
    const approvalCommand = approval?.kind === "command" ? approvalCommandText(approval) ?? bodyPreview : undefined;
    const commandView = approvalCommand ? compactExecutionText(approvalCommand) : null;
    return {
      ...base,
      kind: "approval",
      approvalId: block.approvalId,
      title: approval?.title ?? base.title,
      detail: approvalCommand ? undefined : bodyPreview,
      command: commandView?.text ?? approvalCommand,
      fullCommand: commandView?.fullText,
      commandTruncated: commandView?.truncated,
      governance,
      status: approvalStatus,
      interaction: approvalStatus === "pending" ? "inline" : undefined
    };
  }
  if (block.kind === "governance_review") {
    const foldedApprovalId = block.approvalId ?? governanceDecision?.approvalId;
    // Approval-scoped governance is shown inside the approval card so users do not see the same decision twice.
    if (foldedApprovalId && context.approvals.some((item) => item.id === foldedApprovalId)) return null;
    return {
      ...base,
      kind: "governance",
      governance: governance ?? {
        decision: governanceDecisionFromExecutionBlock(block.status),
        reason: bodyPreview,
        riskTypes: [],
        evidence: []
      }
    };
  }
  if (block.kind === "runtime_error") {
    return { ...base, kind: "error", detail: bodyPreview, status: "blocked" };
  }
  return { ...base, kind: "system", detail: bodyPreview };
}

function claimMessageToolDetail(bodyPreview: string): string {
  const payload = parseJsonObject(bodyPreview);
  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  const messageId = typeof payload?.message_id === "string"
    ? payload.message_id
    : typeof payload?.messageId === "string" ? payload.messageId : "";
  const shortId = shortMessageId(messageId);
  return [title, shortId].filter(Boolean).join(" · ") || "Message claimed as task";
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function shortMessageId(messageId: string): string {
  const trimmed = messageId.trim();
  return trimmed.length > 12 ? trimmed.slice(0, 12) : trimmed;
}

function consoleStatusFromExecutionBlock(status: ExecutionBlockRecord["status"]): ExecutionConsoleBlock["status"] | undefined {
  if (status === "pending" || status === "approved" || status === "rejected" || status === "running" || status === "completed" || status === "blocked") return status;
  if (status === "failed") return "blocked";
  return undefined;
}

function approvalStatusFromExecutionBlock(status: ExecutionBlockRecord["status"]): RuntimeApprovalItem["status"] {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "completed") return "custom";
  return "pending";
}

function governanceDecisionFromExecutionBlock(status: ExecutionBlockRecord["status"]): string {
  if (status === "approved") return "allow";
  if (status === "rejected") return "deny";
  if (status === "pending") return "require_human";
  return "unknown";
}

function governanceDecisionForExecutionBlock(block: ExecutionBlockRecord, decisions: GovernanceDecisionRecord[]): GovernanceDecisionRecord | undefined {
  if (block.governanceDecisionId) {
    const direct = decisions.find((decision) => decision.id === block.governanceDecisionId);
    if (direct) return direct;
  }
  if (block.approvalId) {
    return decisions.find((decision) => decision.approvalId === block.approvalId);
  }
  return undefined;
}

function governanceSummaryFromDecision(decision: GovernanceDecisionRecord): ApprovalGovernanceSummary {
  const sourceSummaries = governanceSourceSummariesFromDecision(decision);
  return {
    decision: decision.decision,
    mode: decision.mode,
    model: decision.model || "deterministic",
    policyVersion: decision.policyVersion,
    policySource: decision.policySource,
    policyScope: decision.policyScope,
    decisionSource: decision.decisionSource,
    confidence: decision.confidence,
    riskTypes: decision.riskTypes,
    reason: decision.reason,
    evidence: decision.evidence.slice(0, 2),
    ...(sourceSummaries.length ? { sourceSummaries } : {})
  };
}

function approvalCommandText(approval: RuntimeApprovalItem): string | undefined {
  const payload = approval.payload && typeof approval.payload === "object" && !Array.isArray(approval.payload) ? approval.payload as { command?: unknown } : null;
  if (typeof payload?.command === "string" && payload.command.trim()) return payload.command.trim();
  if (Array.isArray(payload?.command)) return payload.command.map(String).join(" ").trim();
  return approval.detail.trim() || undefined;
}

function governanceAuthorityLabel(governance: ApprovalGovernanceSummary): string | undefined {
  const model = governance.model?.trim();
  if (!model) return undefined;
  return model === "deterministic" ? "Policy rule" : `Judge: ${model}`;
}

function ExecutionConsoleBlockView({ block, approvals, blockingApproval, onResolveApproval, onViewBlockingApproval, focusApprovalId }: { block: ExecutionConsoleBlock; approvals: RuntimeApprovalItem[]; blockingApproval?: BlockingRuntimeApproval | null; onResolveApproval: (approvalId: string, decision: "approve" | "reject" | "custom", customResponse?: string) => Promise<void>; onViewBlockingApproval?: (approval: RuntimeApprovalRecord) => void; focusApprovalId?: string }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customResponse, setCustomResponse] = useState("");
  const [submittingApprovalId, setSubmittingApprovalId] = useState("");
  const approval = block.approvalId ? approvals.find((item) => item.id === block.approvalId) ?? null : null;
  const blocker = block.blockingApprovalId && blockingApproval && blockingApproval.approval.id === block.blockingApprovalId ? blockingApproval.approval : null;
  const approvalActionsDisabled = approval ? approvalActionDisabled(approval, submittingApprovalId) : true;
  const blockerActionsDisabled = blocker ? approvalActionDisabled(blocker, submittingApprovalId) : true;
  async function submitRuntimeApproval(target: RuntimeApprovalItem | null, decision: "approve" | "reject" | "custom", response?: string) {
    if (!target || approvalActionDisabled(target, submittingApprovalId)) return;
    setSubmittingApprovalId(target.id);
    try {
      await onResolveApproval(target.id, decision, response);
    } finally {
      setSubmittingApprovalId("");
    }
  }
  async function submitApproval(decision: "approve" | "reject" | "custom", response?: string) {
    await submitRuntimeApproval(approval, decision, response);
  }
  async function submitBlocker(decision: "approve" | "reject") {
    await submitRuntimeApproval(blocker, decision);
  }
  if (block.kind === "prompt") {
    return (
      <div className="execution-console-line prompt">
        <span className="execution-line-prefix">›</span>
        <div className="execution-line-main"><p>{block.text}</p></div>
      </div>
    );
  }
  if (block.kind === "explored") {
    return (
      <div className="execution-console-line explored">
        <span className="execution-line-prefix">•</span>
        <div className="execution-line-main">
          <div className="execution-line-title"><b>{block.title}</b>{block.sourceLabel && <span className="execution-source">{block.sourceLabel}</span>}<time>{formatTime(block.at)}</time></div>
          <ul>
            {(block.items ?? []).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </div>
    );
  }
  if (block.kind === "assistant") {
    return (
      <div className={`execution-console-line assistant ${block.status === "running" ? "streaming" : ""}`}>
        <span className="execution-line-prefix">AI</span>
        <div className="execution-line-main">
          <div className="execution-line-title"><b>{block.title}</b>{block.sourceLabel && <span className="execution-source">{block.sourceLabel}</span>}<time>{formatTime(block.at)}</time></div>
          {block.text && <FoldedExecutionText className="assistant-output" preview={block.text} full={block.fullText} truncated={block.textTruncated} showMoreLabel="Show full output" />}
        </div>
      </div>
    );
  }
  if (block.kind === "tool") {
    return (
      <div className="execution-console-line tool">
        <span className="execution-line-prefix">$</span>
        <div className="execution-line-main">
          <div className="execution-line-title"><b>{block.title}</b>{block.sourceLabel && <span className="execution-source">{block.sourceLabel}</span>}<time>{formatTime(block.at)}</time>{block.status && <span className={`execution-mini-status ${block.status}`}>{executionBlockStatusLabel(block.status)}</span>}</div>
          {block.command && <FoldedExecutionText className="command" prefix="$ " preview={block.command} full={block.fullCommand} truncated={block.commandTruncated} showMoreLabel="Show full command" />}
          {block.payload && <FoldedExecutionText className="payload" preview={block.payload} full={block.fullPayload} truncated={block.payloadTruncated} showMoreLabel="Show full payload" />}
          {!block.command && !block.payload && block.detail && <FoldedExecutionText preview={block.detail} full={block.fullDetail} truncated={block.detailTruncated} showMoreLabel="Show full detail" />}
          {block.output && <FoldedExecutionText className="output" preview={block.output} full={block.fullOutput} truncated={block.outputTruncated} showMoreLabel="Show full output" />}
        </div>
      </div>
    );
  }
  if (block.kind === "approval") {
    const approvalQuestion = block.command ? "Would you like to run the following command?" : "Would you like to allow this action?";
    const focusedApproval = Boolean(block.approvalId && block.approvalId === focusApprovalId);
    return (
      <div className={`execution-console-line approval ${block.status ?? "pending"}${focusedApproval ? " focused-approval" : ""}`} aria-current={focusedApproval ? "true" : undefined}>
        <span className="execution-line-prefix"><Shield size={14} /></span>
        <div className="execution-line-main">
          <div className="execution-line-title"><b>{block.title}</b>{block.sourceLabel && <span className="execution-source">{block.sourceLabel}</span>}<time>{formatTime(block.at)}</time>{block.status && <span className={`approval-status ${block.status}`}>{approvalStatusLabel(block.status as RuntimeApprovalItem["status"])}</span>}</div>
          {block.status === "pending" && <strong className="approval-question">{approvalQuestion}</strong>}
          {block.reason && <p className="approval-reason"><b>Reason:</b> {block.reason}</p>}
          {block.governance && <GovernanceSummaryView governance={block.governance} />}
          {block.command ? <FoldedExecutionText className="command" prefix="$ " preview={block.command} full={block.fullCommand} truncated={block.commandTruncated} showMoreLabel="Show full command" /> : block.payload ? <FoldedExecutionText className="payload" preview={block.payload} full={block.fullPayload} truncated={block.payloadTruncated} showMoreLabel="Show full payload" /> : block.detail && <FoldedExecutionText preview={block.detail} full={block.fullDetail} truncated={block.detailTruncated} showMoreLabel="Show full detail" />}
          {block.customResponse && <FoldedExecutionText className="custom-response" preview={block.customResponse} full={block.fullCustomResponse} truncated={block.customResponseTruncated} showMoreLabel="Show full response" />}
          {approval?.status === "pending" && block.interaction === "inline" && (
            <div className="approval-actions">
              <button className="btn small primary" disabled={approvalActionsDisabled} onClick={() => void submitApproval("approve")}><Check size={14} /> Approve</button>
              <button className="btn small" disabled={approvalActionsDisabled} onClick={() => setCustomOpen((value) => !value)}><Edit3 size={14} /> Custom response</button>
              <button className="btn small danger" disabled={approvalActionsDisabled} onClick={() => void submitApproval("reject")}><X size={14} /> Reject</button>
            </div>
          )}
          {approval?.status === "pending" && customOpen && (
            <div className="approval-inline-custom">
              <textarea value={customResponse} disabled={approvalActionsDisabled} onChange={(event) => setCustomResponse(event.target.value)} placeholder="Custom response: for example, do not run this command; explain why or use another approach." />
              <div className="approval-actions">
                <button className="btn small primary" disabled={!customResponse.trim() || approvalActionsDisabled} onClick={() => void submitApproval("custom", customResponse.trim())}><Check size={14} /> Submit custom response</button>
                <button className="btn small" onClick={() => {
                  setCustomOpen(false);
                  setCustomResponse("");
                }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
  if (block.kind === "governance") {
    return (
      <div className={`execution-console-line governance ${block.governance?.decision ?? ""}`}>
        <span className="execution-line-prefix"><Shield size={14} /></span>
        <div className="execution-line-main">
          <div className="execution-line-title"><b>{block.title}</b>{block.sourceLabel && <span className="execution-source">{block.sourceLabel}</span>}<time>{formatTime(block.at)}</time></div>
          {block.governance && <GovernanceSummaryView governance={block.governance} />}
        </div>
      </div>
    );
  }
  if (block.kind === "blocked") {
    return (
      <div className="execution-console-line blocked">
        <span className="execution-line-prefix"><Shield size={14} /></span>
        <div className="execution-line-main">
          <div className="execution-line-title"><b>{block.title}</b>{block.sourceLabel && <span className="execution-source">{block.sourceLabel}</span>}<time>{formatTime(block.at)}</time>{block.status && <span className={`execution-mini-status ${block.status}`}>{executionBlockStatusLabel(block.status)}</span>}</div>
          {block.detail && <p>{block.detail}</p>}
          {blocker?.status === "pending" && (
            <div className="approval-actions">
              <button className="btn small primary" disabled={blockerActionsDisabled} onClick={() => void submitBlocker("approve")}><Check size={14} /> Approve</button>
              <button className="btn small danger" disabled={blockerActionsDisabled} onClick={() => void submitBlocker("reject")}><X size={14} /> Reject</button>
            </div>
          )}
          {blocker && onViewBlockingApproval && (
            <div className="approval-actions">
              <button className="btn small" onClick={() => onViewBlockingApproval(blocker)}><ExternalLink size={14} /> View approval</button>
            </div>
          )}
        </div>
      </div>
    );
  }
  if (block.kind === "thinking") {
    return (
      <div className="execution-console-line thinking">
        <span className="execution-line-prefix">…</span>
        <div className="execution-line-main">
          <div className="execution-line-title"><b>{block.title}</b>{block.sourceLabel && <span className="execution-source">{block.sourceLabel}</span>}<time>{formatTime(block.at)}</time>{block.status && <span className={`execution-mini-status ${block.status}`}>{executionBlockStatusLabel(block.status)}</span>}</div>
          <ExecutionDetail block={block} />
        </div>
      </div>
    );
  }
  if (block.kind === "activity") {
    return (
      <div className="execution-console-line activity">
        <span className="execution-line-prefix">•</span>
        <div className="execution-line-main">
          <div className="execution-line-title"><b>{block.title}</b>{block.sourceLabel && <span className="execution-source">{block.sourceLabel}</span>}<time>{formatTime(block.at)}</time>{block.status && <span className={`execution-mini-status ${block.status}`}>{executionBlockStatusLabel(block.status)}</span>}</div>
          <ExecutionDetail block={block} />
        </div>
      </div>
    );
  }
  return (
    <div className={`execution-console-line ${block.kind} ${block.tone ?? ""}`}>
      <span className="execution-line-prefix">{block.kind === "error" ? "!" : block.kind === "stale" ? "?" : "›"}</span>
      <div className="execution-line-main">
        <div className="execution-line-title"><b>{block.title}</b>{block.sourceLabel && <span className="execution-source">{block.sourceLabel}</span>}<time>{formatTime(block.at)}</time>{block.status && <span className={`execution-mini-status ${block.status}`}>{executionBlockStatusLabel(block.status)}</span>}</div>
        <ExecutionDetail block={block} />
      </div>
    </div>
  );
}

function GovernanceSummaryView({ governance }: { governance: ApprovalGovernanceSummary }) {
  return (
    <div className={`governance-review ${governance.decision}`}>
      <span className="governance-inline">
        <b>Governance</b>
        <span>·</span>
        <span className="governance-decision">{governanceDecisionLabel(governance.decision)}</span>
        {governanceAuthorityLabel(governance) && (
          <>
            <span>·</span>
            <span>{governanceAuthorityLabel(governance)}</span>
          </>
        )}
        {governance.riskTypes.map((riskType) => (
          <span key={riskType} className="governance-risk-inline">· {governanceRiskLabel(riskType)}</span>
        ))}
      </span>
      {governance.reason && <span className="governance-reason" title={governance.reason}>{governance.reason}</span>}
      {governancePolicyLabel(governance) && <span className="governance-policy">{governancePolicyLabel(governance)}</span>}
      {governance.sourceSummaries && governance.sourceSummaries.length > 0 && <span className="governance-sources">Sources: {governance.sourceSummaries.join("; ")}</span>}
      {governance.evidence.length > 0 && <span className="governance-evidence">Evidence: {governance.evidence.join("; ")}</span>}
    </div>
  );
}

function governanceDecisionBlocks(
  decisions: GovernanceDecisionRecord[],
  timelines: TaskExecutionTimeline[],
  approvals: RuntimeApprovalItem[]
): ExecutionConsoleBlock[] {
  const executions = timelines.map((timeline) => timeline.execution).filter((execution): execution is NonNullable<TaskExecutionTimeline["execution"]> => Boolean(execution));
  const executionIds = new Set(executions.map((execution) => execution.id));
  const approvalIds = new Set(approvals.map((approval) => approval.id));
  const taskIds = new Set([...executions.map((execution) => execution.taskId), ...approvals.map((approval) => approval.taskId)].filter(Boolean) as string[]);
  const messageIds = new Set([...executions.map((execution) => execution.messageId), ...approvals.map((approval) => approval.messageId)].filter(Boolean) as string[]);
  const threadChannelIds = new Set([...executions.map((execution) => execution.threadChannelId), ...approvals.map((approval) => approval.threadChannelId)].filter(Boolean) as string[]);
  const agentIds = new Set([...executions.map((execution) => execution.agentId), ...approvals.map((approval) => approval.agentId)].filter(Boolean));
  const earliestExecutionAt = executions.map((execution) => Date.parse(execution.createdAt)).filter(Number.isFinite).sort((a, b) => a - b)[0];

  return decisions
    .filter((decision) => decision.decision !== "allow")
    .filter((decision) => decision.trigger === "message_send" || decision.trigger === "attachment_upload")
    .filter((decision) => governanceDecisionMatchesExecutionContext(decision, { executionIds, approvalIds, taskIds, messageIds, threadChannelIds, agentIds, earliestExecutionAt }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .slice(-5)
    .map((decision) => ({
      id: `governance-${decision.id}`,
      kind: "governance" as const,
      at: decision.createdAt,
      title: `${governanceActionLabel(decision.trigger)} governance`,
      governance: {
        decision: decision.decision,
        mode: decision.mode,
        model: decision.model || "deterministic",
        policyVersion: decision.policyVersion,
        policySource: decision.policySource,
        policyScope: decision.policyScope,
        decisionSource: decision.decisionSource,
        confidence: decision.confidence,
        riskTypes: decision.riskTypes,
        reason: decision.reason,
        evidence: decision.evidence.slice(0, 2),
        sourceSummaries: governanceSourceSummariesFromDecision(decision)
      }
    }));
}

function governanceDecisionMatchesExecutionContext(
  decision: GovernanceDecisionRecord,
  context: {
    executionIds: Set<string>;
    approvalIds: Set<string>;
    taskIds: Set<string>;
    messageIds: Set<string>;
    threadChannelIds: Set<string>;
    agentIds: Set<string>;
    earliestExecutionAt?: number;
  }
): boolean {
  if (decision.executionId && context.executionIds.has(decision.executionId)) return true;
  if (decision.approvalId && context.approvalIds.has(decision.approvalId)) return true;
  if (decision.taskId && context.taskIds.has(decision.taskId)) return true;
  if (decision.messageId && context.messageIds.has(decision.messageId)) return true;
  if (decision.threadChannelId && context.threadChannelIds.has(decision.threadChannelId)) return true;
  // send/upload decisions currently do not always carry execution ids; agent + time keeps them attached without a top-level panel.
  return context.agentIds.has(decision.agentId) &&
    typeof context.earliestExecutionAt === "number" &&
    Date.parse(decision.createdAt) >= context.earliestExecutionAt - 60_000;
}

function governanceActionLabel(trigger: GovernanceDecisionRecord["trigger"]): string {
  if (trigger === "message_send") return "Message send";
  if (trigger === "attachment_upload") return "Attachment upload";
  return "Command";
}

function ExecutionDetail({ block }: { block: ExecutionConsoleBlock }) {
  if (!block.detail) return null;
  if (block.detailTruncated && block.fullDetail) {
    return <FoldedExecutionText preview={block.detail} full={block.fullDetail} truncated showMoreLabel="Show full detail" />;
  }
  return <span>{block.detail}</span>;
}

function FoldedExecutionText({ preview, full, truncated, className, prefix = "", showMoreLabel }: { preview: string; full?: string; truncated?: boolean; className?: string; prefix?: string; showMoreLabel: string }) {
  const [expanded, setExpanded] = useState(false);
  const text = expanded && full ? full : preview;
  return (
    <>
      <pre className={className}>{prefix}{text}</pre>
      {truncated && full && (
        <button className="execution-command-toggle execution-text-toggle" type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show less" : showMoreLabel}
        </button>
      )}
    </>
  );
}

function approvalStatusLabel(status: RuntimeApprovalItem["status"]): string {
  if (status === "pending") return "Pending";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Custom";
}

function governanceDecisionLabel(decision: string): string {
  if (decision === "allow") return "Allow";
  if (decision === "deny") return "Deny";
  if (decision === "require_human") return "Review";
  return "Unknown";
}

function governanceRiskLabel(riskType: string): string {
  return riskType.replaceAll("_", " ");
}

function governancePolicyLabel(governance: ApprovalGovernanceSummary): string | undefined {
  if (!governance.policyVersion && !governance.policySource && !governance.policyScope) return undefined;
  return [
    `Policy: ${governance.policyVersion ?? "unknown"}`,
    governancePolicySourceLabel(governance.policySource),
    governance.policyScope
  ].filter(Boolean).join(" · ");
}

function governancePolicySourceLabel(source: string | undefined): string | undefined {
  if (source === "db_config") return "DB config";
  if (source === "env_json") return "env JSON";
  if (source === "built_in") return "built-in";
  return source;
}

function executionBlockStatusLabel(status: NonNullable<ExecutionConsoleBlock["status"]>): string {
  if (status === "blocked") return "blocked";
  if (status === "completed") return "done";
  if (status === "running") return "running";
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "pending") return "pending";
  return "custom";
}

function agentRunStatusLabel(status: AgentRunRecord["status"]): string {
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "waiting_dependency") return "Waiting for dependency";
  if (status === "waiting_approval") return "Waiting for approval";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return "Cancelled";
}
