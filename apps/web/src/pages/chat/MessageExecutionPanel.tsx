import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import { type AppSnapshot, type ExecutionBlockPagePayload, type MessageRecord, type RuntimeApprovalRecord, type RuntimeExecutionRecord } from "@tyr-ai/contracts";
import { api } from "../../lib/api";
import { blockingRuntimeApprovalForExecutions, visibleRuntimeApprovals } from "../../approvalView";
import { taskExecutionTimelines } from "../../executionView";
import { agentRunsForGroup, executionBlocksForGroup, executionGroupsForContext } from "../../executionGroupView";
import { safetyReviewForContext } from "../../safetyView";
import { mergeExecutionContextSnapshot, terminalExecutionContextRefreshKey, type ExecutionContextResponse } from "../../executionContext";
import { upsertExecutionBlockGuarded } from "../../executionBlockRealtime";
import { TaskExecutionPanel } from "../tasks/TaskExecutionPanel";

type ExecutionContextStatus = "loading" | "ready" | "empty" | "error";

export function MessageExecutionPanel({ snapshot, message, onClose, closeLabel, onRefresh, onOpenThread, onViewMessageInChannel, onBeginResize, focusApprovalId }: {
  snapshot: AppSnapshot;
  message: MessageRecord;
  onClose: () => void;
  closeLabel?: string;
  onRefresh: () => Promise<void>;
  onOpenThread?: (threadChannelId: string) => void;
  onViewMessageInChannel: (channelId: string, messageId: string) => void;
  onBeginResize?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  focusApprovalId?: string;
}) {
  const [executionContext, setExecutionContext] = useState<ExecutionContextResponse | null>(null);
  const [executionContextStatus, setExecutionContextStatus] = useState<ExecutionContextStatus>("loading");
  const refreshedTerminalExecutionKeyRef = useRef("");
  const viewSnapshot = useMemo(
    () => mergeExecutionContextSnapshot(snapshot, executionContext),
    [snapshot, executionContext]
  );
  const executionGroup = useMemo(
    () => executionGroupsForContext(viewSnapshot.executionGroups ?? [], { messageId: message.id }).at(-1) ?? null,
    [viewSnapshot.executionGroups, message.id]
  );
  const executionBlocks = useMemo(
    () => executionGroup ? executionBlocksForGroup(viewSnapshot.executionBlocks ?? [], executionGroup.id) : [],
    [viewSnapshot.executionBlocks, executionGroup]
  );
  const executionTimelines = useMemo(
    () => taskExecutionTimelines(viewSnapshot.runtimeExecutions ?? [], executionBlocks.length > 0 ? [] : viewSnapshot.runtimeExecutionEvents ?? [], { messageId: message.id }),
    [viewSnapshot.runtimeExecutions, viewSnapshot.runtimeExecutionEvents, executionBlocks.length, message.id]
  );
  const agentRuns = useMemo(
    () => executionGroup ? agentRunsForGroup(viewSnapshot.agentRuns ?? [], executionGroup.id) : [],
    [viewSnapshot.agentRuns, executionGroup]
  );
  const executionArtifacts = useMemo(
    () => executionGroup ? (viewSnapshot.executionArtifacts ?? []).filter((artifact) => artifact.groupId === executionGroup.id) : [],
    [viewSnapshot.executionArtifacts, executionGroup]
  );
  const blockPageInfo = executionGroup ? executionContext?.executionBlockPageInfo?.[executionGroup.id] ?? null : null;
  const executionIds = useMemo(() => executionTimelines.map((timeline) => timeline.execution?.id).filter(Boolean) as string[], [executionTimelines]);
  const terminalExecutionRefreshKey = useMemo(
    () => terminalExecutionContextRefreshKey(
      executionTimelines.map((timeline) => timeline.execution).filter((execution): execution is RuntimeExecutionRecord => Boolean(execution))
    ),
    [executionTimelines]
  );
  const threadChannelIds = useMemo(
    () => [...new Set(executionTimelines.map((timeline) => timeline.execution?.threadChannelId).filter(Boolean) as string[])],
    [executionTimelines]
  );
  const runtimeApprovals = useMemo(
    () => {
      const executionIdSet = new Set(executionIds);
      const threadIdSet = new Set(threadChannelIds);
      return visibleRuntimeApprovals((viewSnapshot.runtimeApprovals ?? []).filter((approval) =>
        Boolean(approval.executionId && executionIdSet.has(approval.executionId)) ||
        approval.messageId === message.id ||
        Boolean(approval.threadChannelId && threadIdSet.has(approval.threadChannelId))
      ));
    },
    [viewSnapshot.runtimeApprovals, executionIds, message.id, threadChannelIds]
  );
  const blockingApproval = useMemo(() => {
    const blocker = blockingRuntimeApprovalForExecutions(
      executionTimelines.map((timeline) => timeline.execution).filter((execution): execution is RuntimeExecutionRecord => Boolean(execution)),
      viewSnapshot.runtimeExecutions ?? [],
      viewSnapshot.runtimeApprovals ?? []
    );
    return blocker && !blocker.sameThread ? blocker : null;
  }, [executionTimelines, viewSnapshot.runtimeExecutions, viewSnapshot.runtimeApprovals]);
  const safetyReview = useMemo(() => safetyReviewForContext(viewSnapshot.safetyAssessments ?? [], {
    messageId: message.id,
    executionIds,
    approvalIds: runtimeApprovals.map((approval) => approval.id)
  }), [viewSnapshot.safetyAssessments, message.id, executionIds, runtimeApprovals]);

  const fetchExecutionContext = useCallback((signal?: AbortSignal) => {
    const query = new URLSearchParams({
      messageId: message.id,
      blockLimit: "30",
      blockTail: "1"
    });
    return api<ExecutionContextResponse>("/api/execution-context?" + query.toString(), { signal });
  }, [message.id]);

  const loadExecutionContext = useCallback(async () => {
    setExecutionContextStatus("loading");
    try {
      const data = await fetchExecutionContext();
      setExecutionContext(data);
      setExecutionContextStatus("ready");
    } catch (error) {
      if (isAbortError(error)) return;
      setExecutionContext(null);
      setExecutionContextStatus(executionContextStatusFromError(error));
    }
  }, [fetchExecutionContext]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    refreshedTerminalExecutionKeyRef.current = "";
    setExecutionContext(null);
    setExecutionContextStatus("loading");
    fetchExecutionContext(controller.signal)
      .then((data) => {
        if (cancelled) return;
        setExecutionContext(data);
        setExecutionContextStatus("ready");
      })
      .catch((error) => {
        if (cancelled || isAbortError(error)) return;
        setExecutionContext(null);
        setExecutionContextStatus(executionContextStatusFromError(error));
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fetchExecutionContext]);

  useEffect(() => {
    if (
      executionContextStatus !== "ready" ||
      !terminalExecutionRefreshKey ||
      refreshedTerminalExecutionKeyRef.current === terminalExecutionRefreshKey
    ) return;
    refreshedTerminalExecutionKeyRef.current = terminalExecutionRefreshKey;
    let cancelled = false;
    const controller = new AbortController();
    // 终态后重新取得完整持久化记录；服务端仍只返回 Web 可见的脱敏安全投影。
    fetchExecutionContext(controller.signal)
      .then((data) => {
        if (!cancelled) setExecutionContext(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [executionContextStatus, fetchExecutionContext, terminalExecutionRefreshKey]);

  const loadEarlierBlocks = useCallback(async () => {
    if (!executionGroup || !blockPageInfo?.hasMoreBefore || blockPageInfo.oldestSequence === null) return;
    const query = new URLSearchParams({
      limit: "30",
      tail: "1",
      beforeSequence: String(blockPageInfo.oldestSequence)
    });
    const page = await api<ExecutionBlockPagePayload>(`/api/execution-groups/${encodeURIComponent(executionGroup.id)}/blocks?${query.toString()}`);
    setExecutionContext((current) => ({
      ...(current ?? {}),
      executionBlocks: page.blocks.reduce((items, block) => upsertExecutionBlockGuarded(items, block), current?.executionBlocks ?? []),
      executionBlockPageInfo: {
        ...(current?.executionBlockPageInfo ?? {}),
        [executionGroup.id]: page.pageInfo
      }
    }));
  }, [blockPageInfo?.hasMoreBefore, blockPageInfo?.oldestSequence, executionGroup]);

  async function resolveApproval(approvalId: string, decision: "approve" | "reject" | "custom", customResponse?: string) {
    await api(`/api/runtime-approvals/${approvalId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision, customResponse })
    }).finally(() => onRefresh());
  }

  function viewBlockingApproval(approval: RuntimeApprovalRecord) {
    if (approval.threadChannelId && onOpenThread) {
      onOpenThread(approval.threadChannelId);
      return;
    }
    const blockerThread = approval.threadChannelId ? viewSnapshot.channels.find((channel) => channel.id === approval.threadChannelId) : null;
    if (blockerThread?.parentChannelId && blockerThread.parentMessageId) {
      onViewMessageInChannel(blockerThread.parentChannelId, blockerThread.parentMessageId);
      return;
    }
    const blockerMessage = approval.messageId ? viewSnapshot.messages.find((item) => item.id === approval.messageId) : null;
    if (blockerMessage) onViewMessageInChannel(blockerMessage.channelId, blockerMessage.id);
  }

  return (
    <aside className="thread-panel execution-detail-panel">
      {onBeginResize && <div className="thread-panel-resizer" onPointerDown={onBeginResize} aria-hidden="true" />}
      <div className="thread-head no-tabs">
        <div className="thread-titlebar">
          <h2>Execution <span>- message</span></h2>
          <div className="thread-nav-actions">
            {closeLabel ? (
              <button className="btn small" type="button" onClick={onClose}><ArrowLeft size={15} /> {closeLabel}</button>
            ) : (
              <button className="icon-btn" type="button" title="Close execution" aria-label="Close execution" onClick={onClose}><X size={18} /></button>
            )}
          </div>
        </div>
      </div>
      <TaskExecutionPanel
        prompt={message.content}
        timelines={executionTimelines}
        approvals={runtimeApprovals}
        activity={[]}
        agents={viewSnapshot.agents}
        machines={viewSnapshot.machines}
        safetyReview={safetyReview}
        governanceDecisions={viewSnapshot.governanceDecisions ?? []}
        executionBlocks={executionBlocks}
        agentRuns={agentRuns}
        executionArtifacts={executionArtifacts}
        blockingApproval={blockingApproval}
        contextStatus={executionContextStatus}
        blockPageInfo={blockPageInfo}
        onLoadEarlierBlocks={loadEarlierBlocks}
        onRetryExecutionContext={() => void loadExecutionContext()}
        onResolveApproval={resolveApproval}
        onViewBlockingApproval={viewBlockingApproval}
        focusApprovalId={focusApprovalId}
      />
    </aside>
  );
}

function executionContextStatusFromError(error: unknown): ExecutionContextStatus {
  const message = error instanceof Error ? error.message : "";
  return message === "execution_context_not_found" ? "empty" : "error";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
