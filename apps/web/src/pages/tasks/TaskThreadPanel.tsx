import { submitMessage } from '../../lib/messageSubmission';
import { type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, MessageSquare, Terminal, UserRound, X } from 'lucide-react';
import { type AppSnapshot, type ExecutionBlockPagePayload, type MessageReactionEmoji, type MessageRecord, type RuntimeApprovalRecord, type RuntimeExecutionRecord, type TaskRecord } from '@tyr-ai/contracts';
import { api } from '../../lib/api';
import { canSendThreadReply, threadReplyPayload } from '../../threadComposer';
import { taskThreadActionGroups, type TaskThreadActionId } from '../../taskThreadPanel';
import { approvalTabLabel, blockingRuntimeApprovalForExecutions, taskExecutionActivity, threadExecutionApprovals, visibleRuntimeApprovals } from '../../approvalView';
import { taskExecutionTimelines } from '../../executionView';
import { agentRunsForGroup, executionBlocksForGroup, executionGroupsForContext } from '../../executionGroupView';
import { safetyReviewForContext } from '../../safetyView';
import { useComposerAttachments } from '../../composerAttachments';
import { AttachmentChips, MessageActionsMenu, MessageItem, MessageQuoteCard, MessageReactions, quoteSummaryFromMessage } from '../../shared/messages';
import { ThreadReplyComposer } from '../../shared/ThreadReplyComposer';
import { formatMessageTimestamp } from '../../shared/messageTime';
import { useAgentActivityLog } from '../../shared/activity';
import { confirmDialog } from '../../shared/confirmDialog';
import { copyMessageText, fetchChannelMessagesPage, mergeMessages, messageWithOptimisticReaction, toggleMessageReaction } from '../../app/workspaceUtils';
import { mergeExecutionContextSnapshot, terminalExecutionContextRefreshKey, type ExecutionContextResponse } from '../../executionContext';
import { upsertExecutionBlockGuarded } from '../../executionBlockRealtime';
import { canDeleteMessageForViewer, messageActionItems, messageDeleteConfirmationContentForMessage, messageDeletePath, messageExecutionCancelPath, messageSupportsReactions, messageUnreadPath, type MessageActionId } from '../../messageActions';
import { chatMessageExecutionSummary } from '../chat/chatUtils';
import { taskChannelLabel } from './taskFormatters';
import { useTaskMutations } from './useTaskMutations';
import { TaskExecutionPanel } from './TaskExecutionPanel';
import { TaskStatusMenu } from './TaskStatusMenu';

type PanelLoadStatus = "loading" | "ready" | "empty" | "error";

export function TaskThreadPanel({ snapshot, task, focusMessageId, onClose, onRefresh, onViewInChannel, onOpenThread, onViewMessageInChannel, onPreviewAttachment, onMessageUpdated, onBeginResize }: { snapshot: AppSnapshot; task: TaskRecord; focusMessageId?: string; onClose: () => void; onRefresh: () => Promise<void>; onViewInChannel: () => void; onOpenThread?: (threadChannelId: string) => void; onViewMessageInChannel: (channelId: string, messageId: string) => void; onPreviewAttachment: (attachmentId: string) => void; onMessageUpdated?: (message: MessageRecord) => void; onBeginResize?: (event: ReactPointerEvent<HTMLDivElement>) => void }) {
  type TaskDetailTab = "execution" | "comments";
  const [tab, setTab] = useState<TaskDetailTab>("execution");
  const [content, setContent] = useState("");
  const [quoteTarget, setQuoteTarget] = useState<MessageRecord | null>(null);
  const [loadedMessages, setLoadedMessages] = useState<MessageRecord[]>([]);
  const [executionContext, setExecutionContext] = useState<ExecutionContextResponse | null>(null);
  const [executionContextStatus, setExecutionContextStatus] = useState<PanelLoadStatus>("loading");
  const refreshedTerminalExecutionKeyRef = useRef("");
  const [threadMessagesStatus, setThreadMessagesStatus] = useState<PanelLoadStatus>("loading");
  const attachments = useComposerAttachments(task.threadChannelId);
  const threadBodyRef = useRef<HTMLDivElement>(null);
  const pendingReactionMessageIdsRef = useRef(new Set<string>());
  const applyMessageUpdate = useCallback((message: MessageRecord) => {
    setLoadedMessages((current) => mergeMessages(current, [message]));
    onMessageUpdated?.(message);
  }, [onMessageUpdated]);
  const messageSnapshot = useMemo(
    () => ({ ...snapshot, messages: mergeMessages(snapshot.messages ?? [], loadedMessages) }),
    [snapshot, loadedMessages]
  );
  const viewSnapshot = useMemo(
    () => mergeExecutionContextSnapshot(messageSnapshot, executionContext),
    [messageSnapshot, executionContext]
  );
  const parentMessage = viewSnapshot.messages.find((message) => message.id === task.messageId);
  const savedSet = useMemo(() => new Set(viewSnapshot.savedMessageIds ?? []), [viewSnapshot.savedMessageIds]);
  const parentDeleted = Boolean(parentMessage?.deletedAt);
  const parentExecutionSummary = parentMessage ? chatMessageExecutionSummary(viewSnapshot, parentMessage.id) : null;
  const parentChannel = viewSnapshot.channels.find((channel) => channel.id === task.channelId);
  const archived = Boolean(parentChannel?.archivedAt);
  const replies = viewSnapshot.messages.filter((message) => message.channelId === task.threadChannelId);
  const assignedAgentActivity = useAgentActivityLog(task.assigneeAgentId);
  const executionActivity = useMemo(() => taskExecutionActivity(assignedAgentActivity, task), [assignedAgentActivity, task]);
  const executionGroup = useMemo(
    () => executionGroupsForContext(viewSnapshot.executionGroups ?? [], {
      taskId: task.id,
      messageId: task.messageId,
      threadChannelId: task.threadChannelId
    }).at(-1) ?? null,
    [viewSnapshot.executionGroups, task.id, task.messageId, task.threadChannelId]
  );
  const executionBlocks = useMemo(
    () => executionGroup ? executionBlocksForGroup(viewSnapshot.executionBlocks ?? [], executionGroup.id) : [],
    [viewSnapshot.executionBlocks, executionGroup]
  );
  const executionTimelines = useMemo(
    () => taskExecutionTimelines(viewSnapshot.runtimeExecutions ?? [], executionBlocks.length > 0 ? [] : viewSnapshot.runtimeExecutionEvents ?? [], {
      taskId: task.id,
      messageId: task.messageId,
      threadChannelId: task.threadChannelId
    }),
    [viewSnapshot.runtimeExecutions, viewSnapshot.runtimeExecutionEvents, executionBlocks.length, task.id, task.messageId, task.threadChannelId]
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
  const runtimeApprovals = useMemo(
    () => visibleRuntimeApprovals(threadExecutionApprovals(viewSnapshot.runtimeApprovals ?? [], {
      executionIds,
      taskId: task.id,
      messageId: task.messageId,
      threadChannelId: task.threadChannelId
    })),
    [viewSnapshot.runtimeApprovals, executionIds, task.id, task.messageId, task.threadChannelId]
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
    taskId: task.id,
    messageId: task.messageId,
    threadChannelId: task.threadChannelId,
    executionIds,
    approvalIds: runtimeApprovals.map((approval) => approval.id)
  }), [viewSnapshot.safetyAssessments, task.id, task.messageId, task.threadChannelId, executionIds, runtimeApprovals]);

  const fetchThreadMessagePages = useCallback(() => {
    const requests: Array<Promise<MessageRecord[]>> = [
      fetchChannelMessagesPage(task.channelId, { limit: 10, aroundMessageId: task.messageId }).then((page) => page.messages)
    ];
    if (task.threadChannelId) {
      requests.push(fetchChannelMessagesPage(task.threadChannelId, { limit: 50 }).then((page) => page.messages));
    }
    return Promise.allSettled(requests);
  }, [task.channelId, task.messageId, task.threadChannelId]);

  const applyThreadMessageResults = useCallback((results: PromiseSettledResult<MessageRecord[]>[]) => {
    const fulfilled = results
      .filter((result): result is PromiseFulfilledResult<MessageRecord[]> => result.status === "fulfilled")
      .flatMap((result) => result.value);
    if (fulfilled.length > 0) {
      setLoadedMessages((current) => fulfilled.reduce((items, message) => mergeMessages(items, [message]), current));
    }
    const failed = results.some((result) => result.status === "rejected");
    setThreadMessagesStatus(failed ? "error" : fulfilled.length > 0 ? "ready" : "empty");
  }, []);

  const loadThreadMessages = useCallback(async () => {
    setThreadMessagesStatus("loading");
    applyThreadMessageResults(await fetchThreadMessagePages());
  }, [applyThreadMessageResults, fetchThreadMessagePages]);

  useEffect(() => {
    let cancelled = false;
    setThreadMessagesStatus("loading");
    fetchThreadMessagePages()
      .then((results) => {
        if (!cancelled) applyThreadMessageResults(results);
      })
      .catch(() => {
        if (!cancelled) setThreadMessagesStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [applyThreadMessageResults, fetchThreadMessagePages]);

  useEffect(() => {
    if (snapshot.messages.length === 0) return;
    setLoadedMessages((current) => {
      const loadedIds = new Set(current.map((message) => message.id));
      const updates = snapshot.messages.filter((message) => loadedIds.has(message.id) && !pendingReactionMessageIdsRef.current.has(message.id));
      return updates.length > 0 ? mergeMessages(current, updates) : current;
    });
  }, [snapshot.messages]);

  const fetchExecutionContext = useCallback((signal?: AbortSignal) => {
    const query = new URLSearchParams();
    query.set("taskId", task.id);
    query.set("messageId", task.messageId);
    query.set("blockLimit", "30");
    query.set("blockTail", "1");
    if (task.threadChannelId) query.set("threadChannelId", task.threadChannelId);
    return api<ExecutionContextResponse>("/api/execution-context?" + query.toString(), { signal });
  }, [task.id, task.messageId, task.threadChannelId]);

  const loadExecutionContext = useCallback(async () => {
    setExecutionContextStatus("loading");
    try {
      const data = await fetchExecutionContext();
      setExecutionContext(data);
      setExecutionContextStatus("ready");
    } catch (error) {
      if (isAbortError(error)) return;
      setExecutionContext(null);
      setExecutionContextStatus(panelStatusFromExecutionContextError(error));
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
        setExecutionContextStatus(panelStatusFromExecutionContextError(error));
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
  useEffect(() => {
    setQuoteTarget(null);
  }, [task.threadChannelId]);
  useEffect(() => {
    setTab("execution");
  }, [task.id]);
  useEffect(() => {
    if (!focusMessageId) return;
    window.requestAnimationFrame(() => {
      threadBodyRef.current?.querySelector(`[data-message-id="${focusMessageId}"]`)?.scrollIntoView({ block: "center" });
    });
  }, [focusMessageId, replies.length, task.threadChannelId]);
  async function sendReply() {
    if (!canSendThreadReply(content, attachments.attachmentIds, archived, task.threadChannelId) || attachments.blocked) return;
    await submitMessage(snapshot.currentUser.id, threadReplyPayload(task.threadChannelId!, content, attachments.attachmentIds, quoteTarget?.id));
    setContent("");
    setQuoteTarget(null);
    attachments.resetAttachments();
    await onRefresh();
  }
  async function toggleReaction(message: MessageRecord, emoji: MessageReactionEmoji) {
    if (pendingReactionMessageIdsRef.current.has(message.id)) return;
    pendingReactionMessageIdsRef.current.add(message.id);
    applyMessageUpdate(messageWithOptimisticReaction(message, emoji, {
      id: viewSnapshot.currentUser.id,
      name: viewSnapshot.currentUser.displayName || viewSnapshot.currentUser.name
    }));
    try {
      const result = await toggleMessageReaction(message.id, emoji);
      applyMessageUpdate(result.message);
    } catch (error) {
      applyMessageUpdate(message);
      throw error;
    } finally {
      pendingReactionMessageIdsRef.current.delete(message.id);
    }
  }
  async function toggleSavedMessage(message: MessageRecord) {
    const saved = savedSet.has(message.id);
    await api(`/api/messages/${message.id}/save`, { method: saved ? "DELETE" : "POST", body: "{}" });
    await onRefresh();
  }
  async function markMessageUnreadAction(message: MessageRecord) {
    await api(messageUnreadPath(message.id), { method: "POST", body: "{}" });
    await onRefresh();
  }
  async function stopMessageExecution(message: MessageRecord) {
    // 服务端是执行取消真源；这里不直接操作 daemon，只刷新本地快照。
    await api(messageExecutionCancelPath(message.id), { method: "POST", body: "{}" });
    await onRefresh();
  }
  async function deleteMessage(message: MessageRecord) {
    const summary = chatMessageExecutionSummary(viewSnapshot, message.id);
    const confirmation = messageDeleteConfirmationContentForMessage(viewSnapshot, message, summary);
    if (!(await confirmDialog({
      ...confirmation,
      confirmText: "Delete message",
      tone: "danger"
    }))) return;
    // 删除 API 会保留 task/thread/execution 引用，只把消息正文替换为 tombstone。
    await api(messageDeletePath(message.id), { method: "DELETE" });
    await onRefresh();
  }
  const taskMutations = useTaskMutations(onRefresh);
  const parentActionItems = parentMessage ? messageActionItems({
    canReplyInThread: false,
    canQuote: !parentDeleted && parentMessage.senderType !== "system",
    canCopy: !parentDeleted,
    canSave: !parentDeleted,
    saved: savedSet.has(parentMessage.id),
    canMarkUnread: !parentDeleted && parentMessage.senderType !== "system",
    canStopExecution: !parentDeleted && Boolean(parentExecutionSummary && parentExecutionSummary.status !== "completed" && parentExecutionSummary.status !== "failed" && parentExecutionSummary.status !== "partial"),
    canDelete: canDeleteMessageForViewer(viewSnapshot, parentMessage)
  }) : [];
  const parentSupportsReactions = Boolean(parentMessage && messageSupportsReactions(parentMessage));
  const threadActions = taskThreadActionGroups({
    assigned: Boolean(task.assigneeAgentId)
  });
  function runParentAction(action: MessageActionId) {
    if (!parentMessage) return;
    if (action === "quote") setQuoteTarget(parentMessage);
    else if (action === "copy") void copyMessageText(parentMessage.content);
    else if (action === "save") void toggleSavedMessage(parentMessage);
    else if (action === "mark-unread") void markMessageUnreadAction(parentMessage);
    else if (action === "stop-execution") void stopMessageExecution(parentMessage);
    else if (action === "delete-message") void deleteMessage(parentMessage);
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
    const blockerMessage = approval.messageId ? viewSnapshot.messages.find((message) => message.id === approval.messageId) : null;
    if (blockerMessage) onViewMessageInChannel(blockerMessage.channelId, blockerMessage.id);
  }
  function renderThreadAction(action: TaskThreadActionId): ReactNode {
    if (action === "claim") return <button key={action} className="btn small" onClick={() => void taskMutations.claimTask(task)}><UserRound size={15} /> Claim</button>;
    return <button key={action} className="btn small" onClick={onViewInChannel}><ExternalLink size={15} /> View conversation</button>;
  }
  const tabItems: Array<{ id: TaskDetailTab; label: string; Icon: typeof Terminal }> = [
    { id: "execution", label: blockingApproval ? "Execution !" : approvalTabLabel(runtimeApprovals), Icon: Terminal },
    { id: "comments", label: `Discussion ${replies.length}`, Icon: MessageSquare }
  ];
  return (
    <aside className="thread-panel">
      {onBeginResize && <div className="thread-panel-resizer" onPointerDown={onBeginResize} aria-hidden="true" />}
      <div className="thread-head">
        <div className="thread-titlebar">
          <h2>Thread <span>- {taskChannelLabel(viewSnapshot, task)}</span></h2>
          <div className="thread-nav-actions">
            {threadActions.secondary.map(renderThreadAction)}
            <button className="icon-btn" onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        <section className="thread-task-summary">
          <div className="thread-task-kicker">
            <TaskStatusMenu value={task.status} prefix={`#${task.taskNumber}`} variant="summary" onChange={(status) => void taskMutations.updateStatus(task, status)} />
          </div>
          <div className="thread-task-primary-actions">
            {threadActions.primary.map(renderThreadAction)}
          </div>
          <div className="thread-task-title-row">
            <h3>{task.title}</h3>
          </div>
          <div className="thread-task-chips">
            <span>@{task.assigneeName || task.assigneeAgentId || "Unassigned"}</span>
          </div>
        </section>
        {taskMutations.errorMessage && <p className="task-mutation-error detail" role="status">{taskMutations.errorMessage}</p>}
        <div className="task-detail-tabs" role="tablist" aria-label="Task detail tabs">
          {tabItems.map(({ id, label, Icon }) => (
            <button key={id} className={tab === id ? "active" : ""} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "execution" && (
        <TaskExecutionPanel
          prompt={task.title}
          timelines={executionTimelines}
          approvals={runtimeApprovals}
          activity={executionActivity}
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
          onResolveApproval={taskMutations.resolveApproval}
          onViewBlockingApproval={viewBlockingApproval}
        />
      )}
      {tab === "comments" && (
        <>
      <div className="thread-body" ref={threadBodyRef}>
        {threadMessagesStatus === "loading" && loadedMessages.length === 0 ? (
          <div className="empty-box">Loading discussion...</div>
        ) : null}
        {threadMessagesStatus === "error" ? (
          <div className="empty-box">
            Discussion could not be loaded.
            <button className="btn small" type="button" onClick={() => void loadThreadMessages()}>Retry</button>
          </div>
        ) : null}
        <div className={[focusMessageId === parentMessage?.id ? "thread-parent focused" : "thread-parent", parentDeleted ? "deleted" : ""].filter(Boolean).join(" ")} data-message-id={parentMessage?.id ?? task.messageId}>
          <span className="avatar human"><UserRound size={16} /></span>
          <div className="thread-parent-content">
            <div className="thread-parent-head">
              <div className="message-meta"><b>{task.createdByName || parentMessage?.senderName || "user"}</b><small>owner</small><time>{formatMessageTimestamp(parentMessage?.createdAt ?? task.createdAt)}</time></div>
              {parentMessage && !parentDeleted && (
                <div className="thread-parent-tools">
                  <MessageActionsMenu
                    items={parentActionItems}
                    saved={savedSet.has(parentMessage.id)}
                    onToggleReaction={parentSupportsReactions ? (emoji) => toggleReaction(parentMessage, emoji) : undefined}
                    onAction={runParentAction}
                  />
                </div>
              )}
            </div>
            {parentDeleted ? (
              <p className="message-tombstone">Message deleted</p>
            ) : (
              <>
                {parentMessage?.quote && <MessageQuoteCard quote={parentMessage.quote} onOpen={() => onViewMessageInChannel(parentMessage.quote!.channelId, parentMessage.quote!.messageId)} />}
                <p>{task.title}</p>
                <AttachmentChips attachments={parentMessage?.attachments} onPreviewAttachment={onPreviewAttachment} />
                {parentMessage && parentSupportsReactions && <MessageReactions message={parentMessage} currentUserId={viewSnapshot.currentUser.id} onToggleReaction={(emoji) => toggleReaction(parentMessage, emoji)} />}
              </>
            )}
            <span className={`task-tag ${task.status}`}># {task.taskNumber} @{task.assigneeName || task.assigneeAgentId || "open"}</span>
          </div>
        </div>
        <div className="reply-divider">
          <span>Beginning of replies</span>
          <span>{replies.length} {replies.length === 1 ? "reply" : "replies"}</span>
        </div>
        {replies.map((message) => {
          const executionSummary = chatMessageExecutionSummary(viewSnapshot, message.id);
          return (
            <MessageItem key={message.id} snapshot={viewSnapshot} message={message} focused={message.id === focusMessageId} saved={savedSet.has(message.id)} executionSummary={executionSummary} onToggleSaved={() => void toggleSavedMessage(message)} onPreviewAttachment={onPreviewAttachment} onToggleReaction={(emoji) => toggleReaction(message, emoji)} onQuoteMessage={() => setQuoteTarget(message)} onCopyMessage={() => copyMessageText(message.content)} onMarkUnread={() => void markMessageUnreadAction(message)} onOpenQuote={(quote) => onViewMessageInChannel(quote.channelId, quote.messageId)} onStopExecution={() => void stopMessageExecution(message)} onDeleteMessage={() => void deleteMessage(message)} />
          );
        })}
      </div>
      <ThreadReplyComposer
        archived={archived}
        disabled={archived || !task.threadChannelId}
        content={content}
        attachments={attachments}
        quoteCard={quoteTarget ? <MessageQuoteCard quote={quoteSummaryFromMessage(quoteTarget)} onOpen={() => onViewMessageInChannel(quoteTarget.channelId, quoteTarget.id)} onClear={() => setQuoteTarget(null)} /> : null}
        canSend={canSendThreadReply(content, attachments.attachmentIds, archived, task.threadChannelId) && !attachments.blocked}
        onContentChange={setContent}
        onSend={sendReply}
      />
        </>
      )}
    </aside>
  );
}

function panelStatusFromExecutionContextError(error: unknown): PanelLoadStatus {
  const message = error instanceof Error ? error.message : "";
  return message === "execution_context_not_found" ? "empty" : "error";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
