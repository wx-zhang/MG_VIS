import { submitMessage } from '../../lib/messageSubmission';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Archive, ChevronDown, ChevronLeft, ChevronRight, Mail, MessageSquare, PanelRightOpen, Paperclip, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { isCommunicationAgent, type AgentRecord, type AppSnapshot, type ChannelRecord, type CommunicationAgentPendingActionRecord, type ConversationRecord, type MessageExecutionSummaryRecord, type MessageQuoteSummary, type MessageReactionEmoji, type MessageRecord, type RuntimeApprovalRecord, type RuntimeExecutionRecord } from '@tyr-ai/contracts';
import { TopologyInspectorDetails, type TopologyInspectorIntent } from '../../app/TopologyInspectorDetails';
import { approvalDeepLinkTarget } from '../../approvalNavigation';
import { api } from '../../lib/api';
import { channelReadPath } from '../../inboxActions';
import { messageDeleteConfirmationContentForMessage, messageDeletePath, messageExecutionCancelPath, messageUnreadPath } from '../../messageActions';
import { messageThreadSummaries } from '../../threadSummaries';
import type { MessageThreadRouteLoadState } from '../../threadRoute';
import type { TopologyGraphNode } from '../../topology';
import { useThreadPanelResize } from '../../threadPanelResize';
import { channelUnreadCount } from '../../unreadBadges';
import { dmComposerPlaceholder, dmPeerAgentForChannel, dmTitle } from '../../resourceAccess';
import { mergeRecordsByFreshness } from '../../executionContext';
import { agentStatusLabel, avatarSeed, copyMessageText, dmAgentLiveStatus, fetchChannelMessagesPage, fetchConversationMessagesPage, mergeMessages, messageWithOptimisticReaction, publicConversationToRecord, statusDot, toggleMessageReaction, type MessagePageInfo } from '../../app/workspaceUtils';
import { useAgentActivityLog, type AgentActivityTimelineItem } from '../../shared/activity';
import { AttachmentPreviewModal, ChannelFilesView, MessageItem, type CommunicationAgentRouteAction } from '../../shared/messages';
import { confirmDialog } from '../../shared/confirmDialog';
import { TopBar, type WorkspaceTopBarProps } from '../../shared/ui';
import { ChatComposer } from './ChatComposer';
import { useChatComposer } from './useChatComposer';
import { chatChannelAttachmentCount, chatMessageExecutionSummary } from './chatUtils';
import { chatLatestScrollIntent, isChatScrollAtLatest } from './chatLatestScroll';
import { MessageExecutionPanel } from './MessageExecutionPanel';
import { MessageThreadPanel } from './MessageThreadPanel';
import { canArchiveConversation, canPermanentlyDeleteConversation, CONVERSATION_TITLE_MAX_LENGTH, conversationListVisibility, conversationsForMenuView, conversationViewMode, currentConversationForChannel, currentConversationSyncAction, validateConversationRename, type ConversationMenuView, type ConversationTitleUpdate } from '../../conversationModel';
import { activeCommunicationAgentProgress, communicationAgentProgressDisplayLabel, communicationAgentProgressSourceLabel } from '../../communicationAgentProgress';

type ConversationArchiveNotice = {
  id: string;
  channelId: string;
  conversation: ConversationRecord;
  restoring: boolean;
};

type PendingCurrentConversation = {
  conversationId: string;
  switchAfterDraft: boolean;
};

const CONVERSATION_ARCHIVE_UNDO_MS = 8_000;

export function ChatView({ snapshot, selectedChannelId, focusMessageId, approvalId, routeConversationId, threadChannelId, threadRouteLoadState, threadRouteError, topbarProps, onRefresh, onCloseThread, onCloseApprovalDeepLink, onRetryThread, onOpenThread, onViewMessageInChannel, onOpenInbox, onOpenAgentDm, onOpenDmChannel }: {
  snapshot: AppSnapshot;
  selectedChannelId: string;
  focusMessageId?: string;
  approvalId?: string;
  routeConversationId?: string;
  threadChannelId?: string;
  threadRouteLoadState?: MessageThreadRouteLoadState;
  threadRouteError?: string;
  topbarProps: WorkspaceTopBarProps;
  onRefresh: () => Promise<void>;
  onCloseThread: () => void;
  onCloseApprovalDeepLink: () => void;
  onRetryThread: () => void;
  onOpenThread: (threadChannelId: string, conversationId?: string) => void;
  onViewMessageInChannel: (channelId: string, messageId: string, conversationId?: string) => void;
  onOpenInbox: () => void;
  onOpenAgentDm: (agentId: string) => Promise<void>;
  onOpenDmChannel: (channelId: string) => void;
}) {
  const [pagedMessagesByChannel, setPagedMessagesByChannel] = useState<Record<string, MessageRecord[]>>({});
  const [pagedRuntimeExecutionsByChannel, setPagedRuntimeExecutionsByChannel] = useState<Record<string, RuntimeExecutionRecord[]>>({});
  const [pagedRuntimeApprovalsByChannel, setPagedRuntimeApprovalsByChannel] = useState<Record<string, RuntimeApprovalRecord[]>>({});
  const [pagedMessageExecutionSummariesByChannel, setPagedMessageExecutionSummariesByChannel] = useState<Record<string, Record<string, MessageExecutionSummaryRecord>>>({});
  const [messagePageInfoByChannel, setMessagePageInfoByChannel] = useState<Record<string, MessagePageInfo>>({});
  const [messageLoadingByChannel, setMessageLoadingByChannel] = useState<Record<string, boolean>>({});
  const [messageErrorByChannel, setMessageErrorByChannel] = useState<Record<string, string>>({});
  const [conversationsByChannel, setConversationsByChannel] = useState<Record<string, ConversationRecord[]>>({});
  const [selectedConversationIdByChannel, setSelectedConversationIdByChannel] = useState<Record<string, string>>({});
  const [conversationMenuViewByChannel, setConversationMenuViewByChannel] = useState<Record<string, ConversationMenuView>>({});
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [conversationArchiveNotices, setConversationArchiveNotices] = useState<ConversationArchiveNotice[]>([]);
  const [pendingCurrentConversationByChannel, setPendingCurrentConversationByChannel] = useState<Record<string, PendingCurrentConversation>>({});
  const conversationArchiveTimersRef = useRef(new Map<string, number>());
  const previousActiveConversationIdByChannelRef = useRef<Record<string, string>>({});
  const pendingReactionMessageIdsRef = useRef(new Set<string>());
  const applyMessageUpdate = useCallback((message: MessageRecord) => {
    setPagedMessagesByChannel((current) => {
      let matchedExistingPage = false;
      const next = Object.fromEntries(Object.entries(current).map(([pageKey, pageMessages]) => {
        if (!pageMessages.some((item) => item.id === message.id)) return [pageKey, pageMessages];
        matchedExistingPage = true;
        return [pageKey, mergeMessages(pageMessages, [message])];
      }));
      if (!matchedExistingPage) {
        const pageKey = message.conversationId ?? message.channelId;
        next[pageKey] = mergeMessages(next[pageKey] ?? [], [message]);
      }
      return next;
    });
  }, []);
  const pagedMessages = useMemo(() => Object.values(pagedMessagesByChannel).flat(), [pagedMessagesByChannel]);
  const pagedRuntimeExecutions = useMemo(() => Object.values(pagedRuntimeExecutionsByChannel).flat(), [pagedRuntimeExecutionsByChannel]);
  const pagedRuntimeApprovals = useMemo(() => Object.values(pagedRuntimeApprovalsByChannel).flat(), [pagedRuntimeApprovalsByChannel]);
  const pagedMessageExecutionSummaries = useMemo(
    () => Object.assign({}, ...Object.values(pagedMessageExecutionSummariesByChannel)),
    [pagedMessageExecutionSummariesByChannel]
  );
  const loadedConversations = useMemo(() => Object.values(conversationsByChannel).flat(), [conversationsByChannel]);
  const viewSnapshot = useMemo<AppSnapshot>(
    () => ({
      ...snapshot,
      conversations: mergeRecordsByFreshness(snapshot.conversations ?? [], loadedConversations),
      messages: mergeMessages(snapshot.messages ?? [], pagedMessages),
      runtimeExecutions: mergeRecordsByFreshness(snapshot.runtimeExecutions ?? [], pagedRuntimeExecutions),
      runtimeApprovals: mergeRecordsByFreshness(snapshot.runtimeApprovals ?? [], pagedRuntimeApprovals),
      messageExecutionSummaries: {
        ...(snapshot.messageExecutionSummaries ?? {}),
        ...pagedMessageExecutionSummaries
      }
    }),
    [snapshot, loadedConversations, pagedMessages, pagedRuntimeExecutions, pagedRuntimeApprovals, pagedMessageExecutionSummaries]
  );
  const channel = viewSnapshot.channels.find((item) => item.id === selectedChannelId && item.type === 'dm') ?? viewSnapshot.channels.find((item) => item.type === 'dm');
  const channelConversations = channel?.id
    ? mergeRecordsByFreshness(
      conversationsByChannel[channel.id] ?? [],
      viewSnapshot.conversations.filter((conversation) => conversation.channelId === channel.id)
    )
    : [];
  const activeConversation = channel?.type === 'dm'
    ? currentConversationForChannel(channelConversations, channel.id, channel.activeConversationId ?? undefined)
    : undefined;
  const conversationMenuView = channel?.id ? conversationMenuViewByChannel[channel.id] ?? 'active' : 'active';
  const conversationListVisibilityState = conversationListVisibility(conversationMenuView, routeConversationId);
  const visibleConversationMenuItems = conversationsForMenuView(channelConversations, conversationMenuView);
  const selectedConversationId = channel?.id ? selectedConversationIdByChannel[channel.id] : undefined;
  const selectedConversation = channel?.type === 'dm'
    ? channelConversations.find((conversation) => conversation.id === selectedConversationId) ?? activeConversation
    : undefined;
  const selectedConversationMode = conversationViewMode(selectedConversation);
  const currentConversationMenuItems = visibleConversationMenuItems.filter((conversation) => conversation.status === 'active');
  const recentConversationMenuItems = visibleConversationMenuItems.filter((conversation) => conversation.status !== 'active');
  const messagePageKey = channel?.type === 'dm' ? selectedConversation?.id : channel?.id;
  const messages = viewSnapshot.messages.filter((message) => (
    message.channelId === channel?.id &&
    (channel?.type !== 'dm' || !selectedConversation?.id || message.conversationId === selectedConversation.id)
  ));
  const routedThread = threadChannelId ? viewSnapshot.channels.find((item) => item.id === threadChannelId && item.type === 'thread') : undefined;
  const routedThreadParent = routedThread?.parentMessageId ? viewSnapshot.messages.find((message) => message.id === routedThread.parentMessageId) ?? null : null;
  const threadSummaries = useMemo(() => channel ? messageThreadSummaries(viewSnapshot, channel.id) : {}, [channel?.id, viewSnapshot]);
  const dmAgent = channel?.type === 'dm' ? dmPeerAgentForChannel(channel, viewSnapshot.agents) : undefined;
  // TYR 是服务端通信身份，没有本地 Runtime Activity Log；其进度来自 communicationAgentProgress。
  const dmActivity = useAgentActivityLog(dmAgent && !isCommunicationAgent(dmAgent) ? dmAgent.id : undefined);
  const dmStatus = dmAgentLiveStatus(dmAgent, dmActivity);
  const dmStatusLabel = dmAgent && dmStatus.dot === "working" && (viewSnapshot.runtimeApprovals ?? []).some((approval) => approval.agentId === dmAgent.id && approval.status === "pending")
    ? "Waiting for approval"
    : dmStatus.label;
  const dmLabel = channel?.type === 'dm' ? dmTitle(channel, viewSnapshot.agents) : '';
  const composerPlaceholder = channel?.type === 'dm' ? dmComposerPlaceholder(channel, viewSnapshot.agents) : undefined;
  const [activeTab, setActiveTab] = useState<'chat' | 'files'>('chat');
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const [executionDetailMessageId, setExecutionDetailMessageId] = useState<string | null>(null);
  const [agentDetailOpen, setAgentDetailOpen] = useState(false);
  const [activityAgentId, setActivityAgentId] = useState<string | null>(null);
  const [pendingLatestChannelId, setPendingLatestChannelId] = useState<string | null>(null);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [routeActionBusyId, setRouteActionBusyId] = useState<string | null>(null);
  const [assistantRetryingMessageId, setAssistantRetryingMessageId] = useState<string | null>(null);
  const [assistantRetryError, setAssistantRetryError] = useState("");
  const [progressNow, setProgressNow] = useState(() => Date.now());
  const messageListRef = useRef<HTMLDivElement>(null);
  const followingLatestRef = useRef(true);
  const localSendLatestPageKeyRef = useRef<string | null>(null);
  const lastLatestContentKeyRef = useRef("");
  const handledFocusMessageKeyRef = useRef("");
  const appliedRouteConversationByChannelRef = useRef<Record<string, string>>({});
  const appliedApprovalDeepLinkRef = useRef("");
  const refreshedMissingApprovalRef = useRef("");
  const latestMessage = messages.at(-1);
  const latestMessageId = latestMessage?.id ?? '';
  const currentChannelUnreadCount = channel ? channelUnreadCount(viewSnapshot, channel.id) : 0;
  const savedSet = useMemo(() => new Set(viewSnapshot.savedMessageIds ?? []), [viewSnapshot.savedMessageIds]);
  const channelKindLabel = 'Private Agent DM';
  const channelAttachmentCount = channel ? chatChannelAttachmentCount(viewSnapshot, channel.id) : 0;
  const assistantProgress = activeCommunicationAgentProgress(
    viewSnapshot.communicationAgentProgress ?? [],
    {
      channelId: channel?.id,
      conversationId: selectedConversation?.id,
      assistantAgentId: dmAgent && isCommunicationAgent(dmAgent) ? dmAgent.id : undefined
    },
    progressNow
  );
  const assistantProgressLabel = assistantProgress
    ? communicationAgentProgressDisplayLabel(assistantProgress, progressNow)
    : null;
  const assistantProgressSourceLabel = assistantProgress
    ? communicationAgentProgressSourceLabel(assistantProgress.source)
    : null;
  const assistantProgressScrollKey = assistantProgress && assistantProgressLabel
    ? `${assistantProgress.operationId}:${assistantProgress.phase}:${assistantProgressLabel}`
    : "";
  const latestContentKey = [
    messagePageKey ?? channel?.id ?? "",
    latestMessageId,
    latestMessage?.content.length ?? 0,
    latestMessage?.deletedAt ?? "",
    assistantProgressScrollKey
  ].join(":");
  const updateConversationTitle = useCallback((update: ConversationTitleUpdate) => {
    setConversationsByChannel((current) => {
      const conversations = current[update.channelId];
      if (!conversations?.some((conversation) => conversation.id === update.conversationId && conversation.title !== update.title)) return current;
      // 消息接口已返回服务端最终标题，立即覆盖当前列表缓存，避免等待重新进入 DM 才看到名称。
      return {
        ...current,
        [update.channelId]: conversations.map((conversation) => (
          conversation.id === update.conversationId ? { ...conversation, title: update.title } : conversation
        ))
      };
    });
  }, []);
  const composer = useChatComposer({
    snapshot: viewSnapshot,
    channel,
    conversationId: selectedConversation?.id,
    readOnly: selectedConversationMode === 'history',
    responding: Boolean(assistantProgress),
    onRefresh,
    onConversationTitleChange: updateConversationTitle,
    onLocalSendStart: () => {
      // 本人发送与远端入站使用不同滚动策略；按 conversation 固化，避免切换会话后误滚动。
      localSendLatestPageKeyRef.current = messagePageKey ?? channel?.id ?? null;
      setShowNewMessages(false);
    },
    onLocalSendFailure: () => {
      localSendLatestPageKeyRef.current = null;
    }
  });
  const pendingCurrentConversation = channel?.id ? pendingCurrentConversationByChannel[channel.id] : undefined;

  useEffect(() => {
    if (!channel?.id || !activeConversation?.id) return;
    const previousActiveId = previousActiveConversationIdByChannelRef.current[channel.id];
    previousActiveConversationIdByChannelRef.current[channel.id] = activeConversation.id;
    const selectedId = selectedConversationIdByChannel[channel.id] ?? previousActiveId;
    const action = currentConversationSyncAction({
      previousActiveId,
      nextActiveId: activeConversation.id,
      selectedId,
      hasDraft: composer.hasDraft
    });
    if (action === 'none') {
      if (selectedId !== activeConversation.id) return;
      setPendingCurrentConversationByChannel((current) => {
        if (!current[channel.id]) return current;
        const next = { ...current };
        delete next[channel.id];
        return next;
      });
      return;
    }
    if (action === 'follow') {
      // 用户仍在跟随旧 current 且没有草稿时，MCP/Web 的新 current 直接同步到页面。
      setSelectedConversationIdByChannel((current) => ({ ...current, [channel.id]: activeConversation.id }));
      return;
    }
    setPendingCurrentConversationByChannel((current) => ({
      ...current,
      [channel.id]: {
        conversationId: activeConversation.id,
        switchAfterDraft: action === 'wait_for_draft'
      }
    }));
  }, [activeConversation?.id, channel?.id, composer.hasDraft, selectedConversationIdByChannel]);

  useEffect(() => {
    if (!channel?.id || !pendingCurrentConversation?.switchAfterDraft || composer.hasDraft) return;
    // 草稿发送或清空后再跟随新的 current，避免外部 MCP 调用清掉用户正在编辑的内容。
    setSelectedConversationIdByChannel((current) => ({ ...current, [channel.id]: pendingCurrentConversation.conversationId }));
    setPendingCurrentConversationByChannel((current) => {
      const next = { ...current };
      delete next[channel.id];
      return next;
    });
  }, [channel?.id, composer.hasDraft, pendingCurrentConversation?.conversationId, pendingCurrentConversation?.switchAfterDraft]);

  async function retryAssistantRequest(resultMessageId: string, sourceMessageId: string) {
    if (assistantRetryingMessageId || assistantProgress) return;
    const source = viewSnapshot.messages.find((message) => message.id === sourceMessageId);
    if (
      !source ||
      source.senderType !== "human" ||
      source.senderId !== viewSnapshot.currentUser.id ||
      source.channelId !== channel?.id ||
      source.conversationId !== selectedConversation?.id
    ) {
      setAssistantRetryError("The original Assistant request is no longer available in this conversation.");
      return;
    }
    setAssistantRetryError("");
    setAssistantRetryingMessageId(resultMessageId);
    try {
      // Assistant 重试重新创建 Human 消息，但复用原正文、附件、设备引用和引用消息；它不调用 Bridge retry。
      await submitMessage(snapshot.currentUser.id, {
          channelId: source.channelId,
          conversationId: source.conversationId,
          content: source.content,
          attachmentIds: source.attachmentIds ?? [],
          deviceRefs: source.deviceRefs ?? [],
          quoteMessageId: source.quote?.messageId
      });
      await onRefresh();
    } catch (error) {
      setAssistantRetryError(error instanceof Error ? error.message : "The Assistant request could not be retried.");
    } finally {
      setAssistantRetryingMessageId(null);
    }
  }
  const threadPanelResize = useThreadPanelResize();
  const subjectTitle = dmLabel;
  const subjectSubtitle = channel
    ? `Direct message with @${dmAgent?.name ?? channel.dmPeerAgentName ?? subjectTitle}${dmStatus.label ? ` · ${dmStatus.label}` : ''}`
    : '';

  useEffect(() => () => {
    for (const timeoutId of conversationArchiveTimersRef.current.values()) window.clearTimeout(timeoutId);
    conversationArchiveTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!assistantProgress) return;
    // 活跃时钟负责 300ms 防闪烁、30s 长耗时提示和 90s 超时释放。
    setProgressNow(Date.now());
    const timer = window.setInterval(() => setProgressNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [assistantProgress?.operationId]);

  useEffect(() => {
    if (snapshot.messages.length === 0) return;
    // 分页历史保留在页面本地，但实时消息更新必须同步覆盖其中对应的缓存行。
    setPagedMessagesByChannel((current) => {
      const snapshotById = new Map(snapshot.messages.map((message) => [message.id, message]));
      let changed = false;
      const next = Object.fromEntries(Object.entries(current).map(([pageKey, pageMessages]) => {
        const updates = pageMessages
          .map((message) => snapshotById.get(message.id))
          .filter((message): message is MessageRecord => message !== undefined)
          .filter((message) => !pendingReactionMessageIdsRef.current.has(message.id));
        if (updates.length === 0) return [pageKey, pageMessages];
        changed = true;
        return [pageKey, mergeMessages(pageMessages, updates)];
      }));
      return changed ? next : current;
    });
  }, [snapshot.messages]);
  const chatTopbarProps = { ...topbarProps, onOpenInbox };
  const channelPageInfo = messagePageKey ? messagePageInfoByChannel[messagePageKey] : undefined;
  const channelMessagesLoading = messagePageKey ? Boolean(messageLoadingByChannel[messagePageKey]) : false;
  const channelMessagesError = messagePageKey ? messageErrorByChannel[messagePageKey] : "";
  const canOpenAgentDetails = Boolean(channel?.type === 'dm' && dmAgent);
  const agentDetailNode = useMemo<TopologyGraphNode | undefined>(() => {
    if (!dmAgent) return undefined;
    return agentDetailNodeFor(dmAgent, viewSnapshot);
  }, [dmAgent, viewSnapshot]);
  const activityAgent = activityAgentId ? viewSnapshot.agents.find((item) => item.id === activityAgentId) : undefined;
  const activityAgentNode = useMemo<TopologyGraphNode | undefined>(() => {
    if (!activityAgent) return undefined;
    return agentDetailNodeFor(activityAgent, viewSnapshot);
  }, [activityAgent, viewSnapshot]);

  useEffect(() => {
    setConversationMenuOpen(false);
  }, [channel?.id, selectedConversation?.id]);

  const loadChannelMessages = useCallback(async (channelId: string, options: { beforeSeq?: number | null; afterSeq?: number | null; aroundMessageId?: string; limit?: number; conversationId?: string } = {}) => {
    const pageKey = options.conversationId ?? channelId;
    setMessageLoadingByChannel((current) => ({ ...current, [pageKey]: true }));
    setMessageErrorByChannel((current) => ({ ...current, [pageKey]: "" }));
    try {
      const page = options.conversationId
        ? await fetchConversationMessagesPage(options.conversationId, options)
        : await fetchChannelMessagesPage(channelId, options);
      const mode = options.beforeSeq ? "before" : options.afterSeq ? "after" : options.aroundMessageId ? "merge" : "replace";
      const pageConversation = ("conversation" in page ? page.conversation : undefined) as ConversationRecord | undefined;
      if (pageConversation) {
        setConversationsByChannel((current) => ({
          ...current,
          [pageConversation.channelId]: mergeRecordsByFreshness(current[pageConversation.channelId] ?? [], [pageConversation])
        }));
      }
      setPagedMessagesByChannel((current) => ({
        ...current,
        [pageKey]: mergeMessages(mode === "replace" ? [] : current[pageKey] ?? [], page.messages)
      }));
      setPagedRuntimeExecutionsByChannel((current) => ({
        ...current,
        [pageKey]: mergeRecordsByFreshness(mode === "replace" ? [] : current[pageKey] ?? [], page.runtimeExecutions ?? [])
      }));
      setPagedRuntimeApprovalsByChannel((current) => ({
        ...current,
        [pageKey]: mergeRecordsByFreshness(mode === "replace" ? [] : current[pageKey] ?? [], page.runtimeApprovals ?? [])
      }));
      setPagedMessageExecutionSummariesByChannel((current) => ({
        ...current,
        [pageKey]: mode === "replace"
          ? page.messageExecutionSummaries ?? {}
          : { ...(current[pageKey] ?? {}), ...(page.messageExecutionSummaries ?? {}) }
      }));
      setMessagePageInfoByChannel((current) => {
        if (mode === "merge" && current[pageKey]) return current;
        return { ...current, [pageKey]: mergeMessagePageInfo(current[pageKey], page.pageInfo, mode) };
      });
      return page;
    } catch (error) {
      setMessageErrorByChannel((current) => ({ ...current, [pageKey]: error instanceof Error ? error.message : "Messages unavailable." }));
      throw error;
    } finally {
      setMessageLoadingByChannel((current) => ({ ...current, [pageKey]: false }));
    }
  }, []);

  async function loadEarlierMessages() {
    if (!channel?.id || !channelPageInfo?.hasMoreBefore || !channelPageInfo.oldestSeq || channelMessagesLoading) return;
    const list = messageListRef.current;
    const previousHeight = list?.scrollHeight ?? 0;
    try {
      await loadChannelMessages(channel.id, { beforeSeq: channelPageInfo.oldestSeq, limit: 50, conversationId: selectedConversation?.id });
    } catch {
      return;
    }
    window.requestAnimationFrame(() => {
      if (!list) return;
      list.scrollTop += list.scrollHeight - previousHeight;
    });
  }

  function handleMessageListScroll() {
    const list = messageListRef.current;
    if (!list) return;
    const atLatest = isChatScrollAtLatest(list);
    const completingLocalSend = localSendLatestPageKeyRef.current === (messagePageKey ?? channel?.id);
    // 平滑滚动尚未抵达底部时仍保持 follow，避免动画途中到达的进度/回复被降级成新消息提示。
    followingLatestRef.current = atLatest || completingLocalSend;
    if (atLatest) {
      if (completingLocalSend) localSendLatestPageKeyRef.current = null;
      setShowNewMessages(false);
    }
    if (list.scrollTop <= 80) void loadEarlierMessages();
  }

  useEffect(() => {
    setActiveTab('chat');
    setExecutionDetailMessageId(null);
    setAgentDetailOpen(false);
    setActivityAgentId(null);
  }, [channel?.id, selectedConversation?.id]);

  useEffect(() => {
    if (activeTab !== "chat") return;
    // 进入新的 DM、conversation 或重新打开 Chat Stream 时，首次定位仍应展示最新消息。
    followingLatestRef.current = true;
    lastLatestContentKeyRef.current = "";
    handledFocusMessageKeyRef.current = "";
    setShowNewMessages(false);
    setPendingLatestChannelId(channel?.id ?? null);
  }, [activeTab, channel?.id, selectedConversation?.id]);

  useEffect(() => {
    if (agentDetailOpen && !canOpenAgentDetails) setAgentDetailOpen(false);
  }, [agentDetailOpen, canOpenAgentDetails]);

  useEffect(() => {
    setPagedMessagesByChannel({});
    setPagedRuntimeExecutionsByChannel({});
    setPagedRuntimeApprovalsByChannel({});
    setPagedMessageExecutionSummariesByChannel({});
    setMessagePageInfoByChannel({});
    setMessageLoadingByChannel({});
    setMessageErrorByChannel({});
    setConversationsByChannel({});
    setSelectedConversationIdByChannel({});
    setConversationMenuViewByChannel({});
    setPendingCurrentConversationByChannel({});
    previousActiveConversationIdByChannelRef.current = {};
    appliedRouteConversationByChannelRef.current = {};
  }, [viewSnapshot.currentServer?.id]);

  useEffect(() => {
    if (!channel?.id) return;
    if (channel.type === 'dm') {
      if (!selectedConversation?.id) return;
      void loadChannelMessages(channel.id, { limit: 50, conversationId: selectedConversation.id }).catch(() => undefined);
      return;
    }
    void loadChannelMessages(channel.id, { limit: 50 }).catch(() => undefined);
  }, [channel?.id, channel?.type, selectedConversation?.id, loadChannelMessages]);

  useEffect(() => {
    let cancelled = false;
    if (!channel?.id || channel.type !== 'dm') return () => {
      cancelled = true;
    };
    const query = new URLSearchParams();
    if (conversationListVisibilityState.includeArchived) query.set('includeArchived', '1');
    const queryString = query.size ? `?${query.toString()}` : '';
    api<{ conversations: unknown[]; activeConversationId?: string | null }>(`/api/channels/${encodeURIComponent(channel.id)}/conversations${queryString}`)
      .then((data) => {
        if (cancelled) return;
        const conversations = Array.isArray(data.conversations) ? data.conversations.map(publicConversationToRecord) : [];
        const routedConversation = routeConversationId ? conversations.find((conversation) => conversation.id === routeConversationId) : undefined;
        const shouldApplyRouteConversation = Boolean(routedConversation && routeConversationId && appliedRouteConversationByChannelRef.current[channel.id] !== routeConversationId);
        setConversationsByChannel((current) => ({ ...current, [channel.id]: conversations }));
        if (routedConversation?.archivedAt) {
          setConversationMenuViewByChannel((current) => (
            current[channel.id] === 'archived' ? current : { ...current, [channel.id]: 'archived' }
          ));
        }
        const activeId = data.activeConversationId ?? conversations.find((conversation) => conversation.status === 'active')?.id;
        const nextSelectedId = shouldApplyRouteConversation ? routedConversation?.id : activeId;
        if (nextSelectedId) {
          if (shouldApplyRouteConversation && routeConversationId) appliedRouteConversationByChannelRef.current[channel.id] = routeConversationId;
          setSelectedConversationIdByChannel((current) => {
            // 普通刷新保留用户手动选择；只有显式 conversation 深链首次进入时覆盖选中项。
            if (!shouldApplyRouteConversation && current[channel.id]) return current;
            return current[channel.id] === nextSelectedId ? current : { ...current, [channel.id]: nextSelectedId };
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [channel?.id, channel?.type, conversationListVisibilityState.includeArchived, routeConversationId]);

  useEffect(() => {
    if (!routedThread?.id) return;
    void loadChannelMessages(routedThread.id, { limit: 50 }).catch(() => undefined);
    if (routedThread.parentChannelId && routedThread.parentMessageId) {
      void loadChannelMessages(routedThread.parentChannelId, { limit: 10, aroundMessageId: routedThread.parentMessageId }).catch(() => undefined);
    }
  }, [routedThread?.id, routedThread?.parentChannelId, routedThread?.parentMessageId, loadChannelMessages]);

  useEffect(() => {
    if (threadChannelId) setExecutionDetailMessageId(null);
  }, [threadChannelId]);

  useEffect(() => {
    if (!approvalId) {
      appliedApprovalDeepLinkRef.current = "";
      refreshedMissingApprovalRef.current = "";
      return;
    }
    const target = approvalDeepLinkTarget(viewSnapshot, approvalId);
    if (!target) {
      if (refreshedMissingApprovalRef.current !== approvalId) {
        refreshedMissingApprovalRef.current = approvalId;
        void onRefresh().catch(() => undefined);
      }
      return;
    }
    refreshedMissingApprovalRef.current = "";
    if (!target.messageId) return;
    const targetLoaded = viewSnapshot.messages.some((message) => message.id === target.messageId);
    if (!targetLoaded) {
      // approval 深链可能先命中频道但目标消息尚未分页加载；围绕目标消息加载后再打开 execution panel。
      if (channel?.id) void loadChannelMessages(channel.id, { aroundMessageId: target.messageId, conversationId: selectedConversation?.id }).catch(() => undefined);
      return;
    }
    // 同一审批深链只负责首次打开；用户关闭面板后，本地状态变化不应再次触发打开。
    if (appliedApprovalDeepLinkRef.current === approvalId) return;
    setActiveTab('chat');
    if (threadChannelId) onCloseThread();
    setExecutionDetailMessageId(target.messageId);
    appliedApprovalDeepLinkRef.current = approvalId;
  }, [approvalId, channel?.id, loadChannelMessages, onCloseThread, onRefresh, selectedConversation?.id, threadChannelId, viewSnapshot]);

  function closeExecutionDetail() {
    setExecutionDetailMessageId(null);
    if (approvalId) onCloseApprovalDeepLink();
  }

  useEffect(() => {
    const list = messageListRef.current;
    const latestContentChanged = lastLatestContentKeyRef.current !== latestContentKey;
    lastLatestContentKeyRef.current = latestContentKey;
    const focusMessageKey = focusMessageId
      ? `${messagePageKey ?? channel?.id ?? ""}:${focusMessageId}`
      : "";
    if (!focusMessageId) handledFocusMessageKeyRef.current = "";
    const pendingFocusMessageId = focusMessageKey && handledFocusMessageKeyRef.current !== focusMessageKey
      ? focusMessageId
      : undefined;
    const intent = chatLatestScrollIntent({
      activeTab,
      channelId: channel?.id,
      focusMessageId: pendingFocusMessageId,
      forceLatestForLocalSend: localSendLatestPageKeyRef.current === (messagePageKey ?? channel?.id),
      followingLatest: followingLatestRef.current,
      hasMessageList: Boolean(list),
      latestContentChanged,
      latestMessageId,
      messagesLoading: channelMessagesLoading,
      pendingLatestChannelId
    });
    if (intent.action === "none") return;
    if (intent.action === "notify") {
      setShowNewMessages(true);
      return;
    }
    window.requestAnimationFrame(() => {
      const currentList = messageListRef.current;
      if (!currentList) return;
      if (intent.action === "focus") {
        const target = currentList.querySelector(`[data-message-id="${pendingFocusMessageId}"]`);
        if (!target) return;
        target.scrollIntoView({ block: 'center' });
        handledFocusMessageKeyRef.current = focusMessageKey;
        followingLatestRef.current = isChatScrollAtLatest(currentList);
      } else {
        if (localSendLatestPageKeyRef.current === (messagePageKey ?? channel?.id)) {
          currentList.scrollTo({ top: currentList.scrollHeight, behavior: 'smooth' });
        } else {
          currentList.scrollTop = currentList.scrollHeight;
        }
        followingLatestRef.current = true;
        if (
          localSendLatestPageKeyRef.current === (messagePageKey ?? channel?.id) &&
          isChatScrollAtLatest(currentList)
        ) {
          localSendLatestPageKeyRef.current = null;
        }
      }
      setShowNewMessages(false);
      if (intent.clearPendingLatest) {
        // 首次定位完成后，后续新消息是否跟随由用户当前的阅读位置决定。
        setPendingLatestChannelId((current) => current === channel?.id ? null : current);
      }
    });
  }, [activeTab, channel?.id, focusMessageId, latestContentKey, latestMessageId, messagePageKey, channelMessagesLoading, pendingLatestChannelId]);

  async function onCommunicationAgentRouteAction(action: CommunicationAgentPendingActionRecord, command: "confirm" | "cancel") {
    if (routeActionBusyId) return;
    setRouteActionBusyId(action.id);
    try {
      await composer.sendText(command);
    } finally {
      setRouteActionBusyId(null);
    }
  }

  function communicationAgentRouteActionForMessage(message: MessageRecord): CommunicationAgentRouteAction | undefined {
    if (channel?.type !== "dm" || !dmAgent || !isCommunicationAgent(dmAgent) || message.senderId !== dmAgent.id) return undefined;
    const action = (viewSnapshot.communicationAgentPendingActions ?? [])
      .find((item) => item.channelId === channel.id && item.suggestionMessageId === message.id && item.status === "pending");
    if (!action) return undefined;
    const targetAgent = viewSnapshot.agents.find((agent) => agent.id === action.targetAgentId);
    return {
      targetAgentName: targetAgent?.displayName ?? "target agent",
      instruction: action.instruction,
      busy: routeActionBusyId === action.id,
      onConfirm: () => onCommunicationAgentRouteAction(action, "confirm"),
      onCancel: () => onCommunicationAgentRouteAction(action, "cancel")
    };
  }

  async function toggleSaved(message: MessageRecord) {
    const saved = savedSet.has(message.id);
    await api(`/api/messages/${message.id}/save`, { method: saved ? 'DELETE' : 'POST', body: '{}' });
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

  function openQuote(quote: MessageQuoteSummary) {
    onViewMessageInChannel(quote.channelId, quote.messageId);
  }

  async function openMessageThread(message: MessageRecord) {
    setExecutionDetailMessageId(null);
    const existingThreadId = threadSummaries[message.id]?.threadChannelId ?? message.threadId;
    if (existingThreadId) {
      onOpenThread(existingThreadId, message.conversationId);
      return;
    }
    const result = await api<{ channel: ChannelRecord; created: boolean }>(`/api/messages/${encodeURIComponent(message.id)}/thread`, {
      method: 'POST',
      body: '{}'
    });
    onOpenThread(result.channel.id, message.conversationId);
  }

  async function markCurrentChannelRead() {
    if (!channel) return;
    await api(channelReadPath(channel.id), { method: 'POST', body: '{}' });
    await onRefresh();
  }

  function dismissConversationArchiveNotice(noticeId: string) {
    const timeoutId = conversationArchiveTimersRef.current.get(noticeId);
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    conversationArchiveTimersRef.current.delete(noticeId);
    setConversationArchiveNotices((current) => current.filter((notice) => notice.id !== noticeId));
  }

  function showConversationArchiveNotice(archived: ConversationRecord) {
    const noticeId = `${archived.id}:${Date.now()}`;
    setConversationArchiveNotices((current) => [
      ...current.filter((notice) => notice.conversation.id !== archived.id),
      { id: noticeId, channelId: archived.channelId, conversation: archived, restoring: false }
    ]);
    const timeoutId = window.setTimeout(
      () => dismissConversationArchiveNotice(noticeId),
      CONVERSATION_ARCHIVE_UNDO_MS
    );
    conversationArchiveTimersRef.current.set(noticeId, timeoutId);
  }

  async function renameConversation(targetConversation: ConversationRecord, title: string) {
    const data = await api<{ conversation: unknown }>(`/api/conversations/${encodeURIComponent(targetConversation.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title })
    });
    const renamed = publicConversationToRecord(data.conversation);
    setConversationsByChannel((current) => ({
      ...current,
      [renamed.channelId]: (current[renamed.channelId] ?? channelConversations).map((conversation) => (
        conversation.id === renamed.id ? renamed : conversation
      ))
    }));
  }

  async function newConversation() {
    if (!channel?.id || channel.type !== 'dm') return;
    const data = await api<{ conversation: unknown; channel?: ChannelRecord }>(`/api/channels/${encodeURIComponent(channel.id)}/conversations`, {
      method: 'POST',
      body: '{}'
    });
    const conversation = publicConversationToRecord(data.conversation);
    setConversationsByChannel((current) => ({
      ...current,
      [channel.id]: [
        conversation,
        ...(current[channel.id] ?? channelConversations)
          .filter((item) => item.id !== conversation.id)
          .map((item) => item.status === 'active' ? { ...item, status: 'closed' as const, closedAt: item.closedAt ?? new Date().toISOString() } : item)
      ]
    }));
    setSelectedConversationIdByChannel((current) => ({ ...current, [channel.id]: conversation.id }));
    setConversationMenuViewByChannel((current) => ({ ...current, [channel.id]: 'active' }));
    setPagedMessagesByChannel((current) => ({ ...current, [conversation.id]: [] }));
    setMessagePageInfoByChannel((current) => ({ ...current, [conversation.id]: { hasMoreBefore: false, hasMoreAfter: false, oldestSeq: null, newestSeq: null } }));
    setConversationMenuOpen(false);
    await onRefresh();
  }

  async function archiveConversation(targetConversation: ConversationRecord) {
    if (!channel?.id || channel.type !== 'dm' || !canArchiveConversation(targetConversation)) return;
    const data = await api<{ conversation: unknown; replacementConversation?: unknown }>(`/api/conversations/${encodeURIComponent(targetConversation.id)}/archive`, {
      method: 'POST',
      body: '{}'
    });
    const archived = publicConversationToRecord(data.conversation);
    const replacement = data.replacementConversation ? publicConversationToRecord(data.replacementConversation) : undefined;
    setConversationsByChannel((current) => ({
      ...current,
      [channel.id]: [
        ...(replacement ? [replacement] : []),
        archived,
        ...(current[channel.id] ?? channelConversations).filter((conversation) => (
          conversation.id !== archived.id && conversation.id !== replacement?.id
        ))
      ]
    }));
    if (selectedConversation?.id === targetConversation.id) {
      const nextConversationId = replacement?.id ?? activeConversation?.id;
      if (nextConversationId) setSelectedConversationIdByChannel((current) => ({ ...current, [channel.id]: nextConversationId }));
    }
    showConversationArchiveNotice(archived);
    await onRefresh();
  }

  async function restoreConversation(targetConversation: ConversationRecord, options: { select?: boolean } = {}) {
    if (!targetConversation.archivedAt) return;
    const data = await api<{ conversation: unknown }>(`/api/conversations/${encodeURIComponent(targetConversation.id)}/unarchive`, {
      method: 'POST',
      body: '{}'
    });
    const restored = publicConversationToRecord(data.conversation);
    setConversationsByChannel((current) => ({
      ...current,
      [restored.channelId]: (current[restored.channelId] ?? channelConversations).some((conversation) => conversation.id === restored.id)
        ? (current[restored.channelId] ?? channelConversations).map((conversation) => conversation.id === restored.id ? restored : conversation)
        : [restored, ...(current[restored.channelId] ?? [])]
    }));
    for (const notice of conversationArchiveNotices) {
      if (notice.conversation.id === restored.id) dismissConversationArchiveNotice(notice.id);
    }
    if (options.select && channel?.id === restored.channelId) {
      // 撤销当前会话的归档只恢复历史可见性；新建的 active conversation 和干净 runtime context 保持不变。
      setSelectedConversationIdByChannel((current) => ({ ...current, [restored.channelId]: restored.id }));
      setConversationMenuViewByChannel((current) => ({ ...current, [restored.channelId]: 'active' }));
      setConversationMenuOpen(false);
    }
    await onRefresh();
  }

  async function undoConversationArchive(notice: ConversationArchiveNotice) {
    const timeoutId = conversationArchiveTimersRef.current.get(notice.id);
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    conversationArchiveTimersRef.current.delete(notice.id);
    setConversationArchiveNotices((current) => current.map((item) => (
      item.id === notice.id ? { ...item, restoring: true } : item
    )));
    try {
      await restoreConversation(notice.conversation, { select: channel?.id === notice.channelId });
    } catch (error) {
      setConversationArchiveNotices((current) => current.map((item) => (
        item.id === notice.id ? { ...item, restoring: false } : item
      )));
      throw error;
    }
  }

  async function deleteConversationPermanently(targetConversation: ConversationRecord) {
    if (!channel?.id || channel.type !== 'dm' || !canPermanentlyDeleteConversation(targetConversation)) return;
    const confirmed = await confirmDialog({
      title: "Delete conversation permanently?",
      description: "This permanently deletes the conversation, messages, tasks, threads, and attachments. Agent workspace files are not deleted. This cannot be undone.",
      confirmText: "Delete permanently",
      tone: "danger"
    });
    if (!confirmed) return;
    const data = await api<{ conversation?: unknown; deletedMessageIds?: string[]; deletedThreadChannelIds?: string[] }>(`/api/conversations/${encodeURIComponent(targetConversation.id)}`, {
      method: 'DELETE'
    });
    const deletedConversation = data.conversation ? publicConversationToRecord(data.conversation) : targetConversation;
    const removedMessageIds = new Set(data.deletedMessageIds ?? []);
    const removedThreadChannelIds = data.deletedThreadChannelIds ?? [];
    setConversationsByChannel((current) => ({
      ...current,
      [channel.id]: (current[channel.id] ?? channelConversations).filter((conversation) => conversation.id !== deletedConversation.id)
    }));
    setPagedMessagesByChannel((current) => {
      const next = { ...current };
      delete next[deletedConversation.id];
      for (const threadChannelId of removedThreadChannelIds) delete next[threadChannelId];
      for (const [pageKey, pageMessages] of Object.entries(next)) {
        next[pageKey] = pageMessages.filter((message) => !removedMessageIds.has(message.id));
      }
      return next;
    });
    setMessagePageInfoByChannel((current) => {
      const next = { ...current };
      delete next[deletedConversation.id];
      for (const threadChannelId of removedThreadChannelIds) delete next[threadChannelId];
      return next;
    });
    setPagedRuntimeExecutionsByChannel((current) => {
      const next = { ...current };
      delete next[deletedConversation.id];
      for (const threadChannelId of removedThreadChannelIds) delete next[threadChannelId];
      return next;
    });
    setPagedRuntimeApprovalsByChannel((current) => {
      const next = { ...current };
      delete next[deletedConversation.id];
      for (const threadChannelId of removedThreadChannelIds) delete next[threadChannelId];
      return next;
    });
    setPagedMessageExecutionSummariesByChannel((current) => {
      const next = { ...current };
      delete next[deletedConversation.id];
      for (const threadChannelId of removedThreadChannelIds) delete next[threadChannelId];
      return next;
    });
    if (selectedConversation?.id === targetConversation.id && activeConversation?.id) {
      setSelectedConversationIdByChannel((current) => ({ ...current, [channel.id]: activeConversation.id }));
    }
    await onRefresh();
  }

  async function markMessageUnread(message: MessageRecord) {
    await api(messageUnreadPath(message.id), { method: 'POST', body: '{}' });
    await onRefresh();
  }

  async function stopMessageExecution(message: MessageRecord) {
    await api(messageExecutionCancelPath(message.id), { method: 'POST', body: '{}' });
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
    await api(messageDeletePath(message.id), { method: 'DELETE' });
    await onRefresh();
  }

  function openMessageExecution(message: MessageRecord) {
    setExecutionDetailMessageId(message.id);
    if (threadChannelId) onCloseThread();
  }

  function openAgentHistoryItem(item: AgentActivityTimelineItem) {
    const target = item.jumpTarget;
    if (!target) return;
    setActivityAgentId(null);
    if (target.type === "message" && target.channelId && target.messageId) {
      onViewMessageInChannel(target.channelId, target.messageId);
      return;
    }
    if (target.type === "execution") {
      const messageId = target.messageId ?? item.rootMessageId ?? item.messageId;
      const message = messageId ? viewSnapshot.messages.find((candidate) => candidate.id === messageId) : undefined;
      if (message) {
        openMessageExecution(message);
        return;
      }
      if (target.channelId && messageId) {
        onViewMessageInChannel(target.channelId, messageId);
      }
    }
  }

  const executionDetailMessage = executionDetailMessageId ? viewSnapshot.messages.find((message) => message.id === executionDetailMessageId) ?? null : null;
  const threadRoutePending = Boolean(threadChannelId && !(routedThread && routedThreadParent));
  const rightPanelOpen = Boolean(routedThread || threadRoutePending || executionDetailMessage);

  return (
    <div className="view chat-view">
      <TopBar title="Interactive Agent Workspace" {...chatTopbarProps} />
      <div className="chat-session-header">
        <div className="chat-subject">
          <span className="chat-subject-icon">
            {channel && <span className="avatar agent large">{avatarSeed(dmAgent?.name ?? channel.dmPeerAgentName ?? dmLabel)}</span>}
          </span>
          <div className="chat-subject-copy">
            <div className="chat-title-stack">
              <h2>{subjectTitle}</h2>
              <span className="chat-subject-badge">{channelKindLabel}</span>
              {channel?.type === 'dm' && <span className={statusDot(dmStatus.dot)} title={dmStatusLabel} aria-label={dmStatusLabel} />}
            </div>
            {channel?.type === 'dm' ? (
              <div className="chat-subtitle-row">
                {subjectSubtitle && <span className="chat-subtitle-text">{subjectSubtitle}</span>}
                {selectedConversation && (
                  <>
                    <span className="chat-subtitle-separator">·</span>
                    <div
                      className="dm-conversation-switcher"
                      onBlur={(event) => {
                        const nextFocus = event.relatedTarget;
                        if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) setConversationMenuOpen(false);
                      }}
                    >
                      <button
                        className="dm-conversation-trigger"
                        type="button"
                        aria-haspopup="dialog"
                        aria-expanded={conversationMenuOpen}
                        onClick={() => setConversationMenuOpen((open) => !open)}
                      >
                        <span>{selectedConversation.title}</span>
                        <ChevronDown size={13} />
                      </button>
                      {conversationMenuOpen && (
                        <div className="dm-conversation-menu" aria-label="Conversations">
                          {conversationMenuView === 'active' ? (
                            <button className="dm-conversation-new" type="button" onClick={() => void newConversation()}>
                              <Plus size={15} />
                              <span>Start new conversation</span>
                            </button>
                          ) : (
                            <div className="dm-conversation-menu-header">
                              <button
                                type="button"
                                aria-label="Back to conversations"
                                onClick={() => setConversationMenuViewByChannel((current) => ({ ...current, [channel.id]: 'active' }))}
                              >
                                <ChevronLeft size={16} />
                              </button>
                              <strong>Archived conversations</strong>
                            </div>
                          )}
                          <div className="dm-conversation-menu-list">
                            {conversationMenuView === 'active' && currentConversationMenuItems.length > 0 && (
                              <div className="dm-conversation-menu-section">
                                <p>Current</p>
                                {currentConversationMenuItems.map((conversation) => (
                                  <ConversationMenuOption
                                    key={conversation.id}
                                    conversation={conversation}
                                    selected={conversation.id === selectedConversation.id}
                                    current={conversation.id === channel.activeConversationId}
                                    onSelect={() => {
                                      setSelectedConversationIdByChannel((current) => ({ ...current, [channel.id]: conversation.id }));
                                      setConversationMenuOpen(false);
                                    }}
                                    onRename={(title) => renameConversation(conversation, title)}
                                    onArchive={() => void archiveConversation(conversation)}
                                  />
                                ))}
                              </div>
                            )}
                            {conversationMenuView === 'active' && recentConversationMenuItems.length > 0 && (
                              <div className="dm-conversation-menu-section">
                                <p>Recent</p>
                                {recentConversationMenuItems.map((conversation) => (
                                  <ConversationMenuOption
                                    key={conversation.id}
                                    conversation={conversation}
                                    selected={conversation.id === selectedConversation.id}
                                    onSelect={() => {
                                      setSelectedConversationIdByChannel((current) => ({ ...current, [channel.id]: conversation.id }));
                                      setConversationMenuOpen(false);
                                    }}
                                    onRename={(title) => renameConversation(conversation, title)}
                                    onArchive={() => void archiveConversation(conversation)}
                                  />
                                ))}
                              </div>
                            )}
                            {conversationMenuView === 'archived' && visibleConversationMenuItems.length > 0 && (
                              <div className="dm-conversation-menu-section">
                                <p>Archived</p>
                                {visibleConversationMenuItems.map((conversation) => (
                                  <ConversationMenuOption
                                    key={conversation.id}
                                    conversation={conversation}
                                    selected={conversation.id === selectedConversation.id}
                                    onSelect={() => {
                                      setSelectedConversationIdByChannel((current) => ({ ...current, [channel.id]: conversation.id }));
                                      setConversationMenuOpen(false);
                                    }}
                                    onRename={(title) => renameConversation(conversation, title)}
                                    onRestore={() => void restoreConversation(conversation)}
                                    onDelete={() => void deleteConversationPermanently(conversation)}
                                  />
                                ))}
                              </div>
                            )}
                            {visibleConversationMenuItems.length === 0 && (
                              <div className="dm-conversation-menu-empty">
                                {conversationMenuView === 'active'
                                  ? 'No conversations yet.'
                                  : 'No archived conversations.'}
                              </div>
                            )}
                          </div>
                          {conversationMenuView === 'active' && (
                            <button
                              className="dm-conversation-archive-link"
                              type="button"
                              onClick={() => setConversationMenuViewByChannel((current) => ({ ...current, [channel.id]: 'archived' }))}
                            >
                              <Archive size={14} />
                              <span>Archived conversations</span>
                              <ChevronRight size={14} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : subjectSubtitle && <p>{subjectSubtitle}</p>}
          </div>
        </div>
        <div className="chat-session-tools">
          <div className="chat-session-actions">
            {currentChannelUnreadCount > 0 && (
              <button className="btn small" disabled={!channel} title="Mark this conversation read" onClick={() => void markCurrentChannelRead()}><Mail size={15} /> Mark read</button>
            )}
          </div>
          <div className="chat-tabs-group">
            <div className="chat-workspace-tabs" role="tablist" aria-label="Chat workspace tabs">
              <button className={activeTab === 'chat' ? 'active' : ''} role="tab" aria-selected={activeTab === 'chat'} onClick={() => setActiveTab('chat')}><MessageSquare size={14} /> Chat Stream</button>
              <button className={activeTab === 'files' ? 'active' : ''} role="tab" aria-selected={activeTab === 'files'} onClick={() => setActiveTab('files')}><Paperclip size={14} /> Attachments <small className="tab-count">({channelAttachmentCount})</small></button>
            </div>
            {canOpenAgentDetails && (
              <button
                className="icon-btn tooltip-trigger chat-agent-detail-button"
                title="Agent details"
                aria-label="Agent details"
                data-tooltip="Agent details"
                onClick={() => setAgentDetailOpen(true)}
              >
                <PanelRightOpen size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      {activeTab === 'chat' ? (
        <div className={rightPanelOpen ? 'chat-workspace with-thread' : 'chat-workspace'} style={rightPanelOpen ? threadPanelResize.workspaceStyle : undefined}>
          <div className="chat-column">
            {pendingCurrentConversation && (
              <div className="conversation-current-notice" role="status">
                <span>
                  {pendingCurrentConversation.switchAfterDraft
                    ? 'A new current conversation was started. Finish or clear your draft to switch.'
                    : 'A new current conversation was started.'}
                </span>
                {!pendingCurrentConversation.switchAfterDraft && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!channel?.id) return;
                      setSelectedConversationIdByChannel((current) => ({ ...current, [channel.id]: pendingCurrentConversation.conversationId }));
                      setPendingCurrentConversationByChannel((current) => {
                        const next = { ...current };
                        delete next[channel.id];
                        return next;
                      });
                    }}
                  >
                    Open current conversation
                  </button>
                )}
              </div>
            )}
            <div className="message-list-shell">
              <div className="message-list" ref={messageListRef} onScroll={handleMessageListScroll}>
                {channelPageInfo?.hasMoreBefore && (
                  <div className="message-page-control">
                    <button className="btn small" disabled={channelMessagesLoading} onClick={() => void loadEarlierMessages()}>
                      {channelMessagesLoading ? 'Loading...' : 'Load earlier'}
                    </button>
                  </div>
                )}
                {channelMessagesError && (
                  <div className="empty-box message-page-error">
                    Messages unavailable.
                    {channel?.id && <button className="btn small" type="button" disabled={channelMessagesLoading} onClick={() => void loadChannelMessages(channel.id, { limit: 50, conversationId: selectedConversation?.id }).catch(() => undefined)}>Retry</button>}
                  </div>
                )}
                {assistantRetryError && <div className="empty-box message-page-error">{assistantRetryError}</div>}
                {messages.map((message) => {
                  const executionSummary = chatMessageExecutionSummary(viewSnapshot, message.id);
                  const hasExistingThread = Boolean(threadSummaries[message.id]?.threadChannelId ?? message.threadId);
                  // 历史会话只允许查看已经存在的 Thread，不能从旧消息创建新的分支。
                  const canOpenMessageThread = hasExistingThread || (selectedConversationMode !== 'history' && !channel?.archivedAt);
                  return (
                    <MessageItem
                      key={message.id}
                      snapshot={viewSnapshot}
                      message={message}
                      focused={message.id === focusMessageId || message.id === routedThread?.parentMessageId || message.id === executionDetailMessageId}
                      saved={savedSet.has(message.id)}
                      threadSummary={threadSummaries[message.id]}
                      executionSummary={executionSummary}
                      communicationAgentRouteAction={communicationAgentRouteActionForMessage(message)}
                      assistantRetrying={assistantRetryingMessageId === message.id || Boolean(assistantProgress)}
                      onToggleSaved={() => void toggleSaved(message)}
                      onOpenThread={canOpenMessageThread ? () => void openMessageThread(message) : undefined}
                      onOpenExecution={() => openMessageExecution(message)}
                      onOpenAgentActivity={(agentId) => setActivityAgentId(agentId)}
                      onOpenAgentDm={onOpenAgentDm}
                      onRetryAssistantRequest={(sourceMessageId) => retryAssistantRequest(message.id, sourceMessageId)}
                      onPreviewAttachment={setPreviewAttachmentId}
                      onToggleReaction={(emoji) => toggleReaction(message, emoji)}
                      onQuoteMessage={() => composer.setQuoteTarget(message)}
                      onCopyMessage={() => copyMessageText(message.content)}
                      onMarkUnread={() => void markMessageUnread(message)}
                      onOpenQuote={openQuote}
                      onStopExecution={() => void stopMessageExecution(message)}
                      onDeleteMessage={() => void deleteMessage(message)}
                    />
                  );
                })}
                {assistantProgressLabel && dmAgent && (
                  <CommunicationAgentProgressMessage agent={dmAgent} label={assistantProgressLabel} sourceLabel={assistantProgressSourceLabel} />
                )}
              </div>
              {showNewMessages && (
                <button
                  className="new-messages-button"
                  type="button"
                  aria-label="Jump to new messages"
                  onClick={() => {
                    const list = messageListRef.current;
                    if (!list) return;
                    followingLatestRef.current = true;
                    setShowNewMessages(false);
                    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
                  }}
                >
                  <ChevronDown size={15} />
                  <span>New messages</span>
                </button>
              )}
            </div>
            <ChatComposer channel={channel} composer={composer} placeholder={composerPlaceholder} readOnly={selectedConversationMode === 'history'} onViewMessageInChannel={onViewMessageInChannel} />
          </div>
          {routedThread && routedThreadParent && (
            <MessageThreadPanel
              snapshot={viewSnapshot}
              thread={routedThread}
              parentMessage={routedThreadParent}
              focusMessageId={focusMessageId}
              onClose={onCloseThread}
              onRefresh={onRefresh}
              onViewInChannel={() => onViewMessageInChannel(routedThreadParent.channelId, routedThreadParent.id, routedThreadParent.conversationId)}
              onOpenThread={onOpenThread}
              onViewMessageInChannel={onViewMessageInChannel}
              onPreviewAttachment={setPreviewAttachmentId}
              onMessageUpdated={applyMessageUpdate}
              onBeginResize={threadPanelResize.beginResize}
            />
          )}
          {threadRoutePending && (
            <ChatDetailDrawer variant="inline" style={threadPanelResize.workspaceStyle} onClose={onCloseThread}>
              <MessageThreadRouteStatusPanel
                status={threadRouteLoadState}
                error={threadRouteError}
                onClose={onCloseThread}
                onRetry={onRetryThread}
              />
            </ChatDetailDrawer>
          )}
          {!threadChannelId && executionDetailMessage && (
            <ChatDetailDrawer variant="inline" style={threadPanelResize.workspaceStyle} onClose={closeExecutionDetail}>
              <MessageExecutionPanel
                snapshot={viewSnapshot}
                message={executionDetailMessage}
                onClose={closeExecutionDetail}
                onRefresh={onRefresh}
                onOpenThread={onOpenThread}
                onViewMessageInChannel={onViewMessageInChannel}
                onBeginResize={threadPanelResize.beginResize}
                focusApprovalId={approvalId}
              />
            </ChatDetailDrawer>
          )}
        </div>
      ) : activeTab === 'files' && channel ? (
        <ChannelFilesView channel={channel} onPreviewAttachment={setPreviewAttachmentId} />
      ) : null}
      {conversationArchiveNotices.length > 0 && (
        <div className="conversation-archive-notice-stack" aria-live="polite" aria-atomic="false">
          {conversationArchiveNotices.map((notice) => (
            <div className="conversation-archive-notice" role="status" key={notice.id}>
              <span className="conversation-archive-notice-icon" aria-hidden="true"><Archive size={15} /></span>
              <span className="conversation-archive-notice-copy">
                <strong>Conversation archived</strong>
                <small>{notice.conversation.title}</small>
              </span>
              <button
                className="conversation-archive-undo"
                type="button"
                disabled={notice.restoring}
                onClick={() => void undoConversationArchive(notice)}
              >
                {notice.restoring ? 'Restoring…' : 'Undo'}
              </button>
              <button
                className="conversation-archive-dismiss"
                type="button"
                aria-label={`Dismiss archive notice for ${notice.conversation.title}`}
                onClick={() => dismissConversationArchiveNotice(notice.id)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {agentDetailOpen && dmAgent && agentDetailNode && (
        <AgentDetailDrawer
          agent={dmAgent}
          node={agentDetailNode}
          snapshot={viewSnapshot}
          onClose={() => setAgentDetailOpen(false)}
          onRefresh={onRefresh}
          onOpenAgentDm={onOpenAgentDm}
          onOpenDmChannel={onOpenDmChannel}
          onOpenAgentHistoryItem={openAgentHistoryItem}
        />
      )}
      {activityAgent && activityAgentNode && (
        <AgentDetailDrawer
          agent={activityAgent}
          node={activityAgentNode}
          snapshot={viewSnapshot}
          intent={{ key: 0, kind: "agent", id: activityAgent.id, action: "activity" }}
          onClose={() => setActivityAgentId(null)}
          onRefresh={onRefresh}
          onOpenAgentDm={onOpenAgentDm}
          onOpenDmChannel={onOpenDmChannel}
          onOpenAgentHistoryItem={openAgentHistoryItem}
        />
      )}
      {previewAttachmentId && <AttachmentPreviewModal attachmentId={previewAttachmentId} onClose={() => setPreviewAttachmentId(null)} />}
    </div>
  );
}

export function ConversationMenuOption({ conversation, selected, current = false, contextLabel, onSelect, onRename, onArchive, onRestore, onDelete }: {
  conversation: ConversationRecord;
  selected: boolean;
  current?: boolean;
  contextLabel?: string;
  onSelect: () => void;
  onRename?: (title: string) => Promise<void>;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);
  const [renameError, setRenameError] = useState('');
  const [saving, setSaving] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameSubmittingRef = useRef(false);
  const activityAt = conversation.archivedAt ?? conversation.lastMessageAt ?? conversation.startedAt;
  const dateLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(activityAt));
  const state = conversation.archivedAt
    ? `Archived ${dateLabel}`
    : current
      ? 'Current conversation'
      : conversation.status === 'active'
        ? 'Open conversation'
        : dateLabel;
  const stateLabel = contextLabel ? `${contextLabel} · ${state}` : state;

  useEffect(() => {
    if (!editing) setDraftTitle(conversation.title);
  }, [conversation.title, editing]);

  useEffect(() => {
    if (!editing) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [editing]);

  function beginRename() {
    if (!onRename) return;
    setDraftTitle(conversation.title);
    setRenameError('');
    setEditing(true);
  }

  function cancelRename() {
    if (saving) return;
    setDraftTitle(conversation.title);
    setRenameError('');
    setEditing(false);
  }

  async function commitRename() {
    if (renameSubmittingRef.current || !onRename) return;
    const validation = validateConversationRename(draftTitle);
    if (validation.error === 'required') {
      setRenameError('Enter a conversation name.');
      return;
    }
    if (validation.error === 'too_long') {
      setRenameError(`Use ${CONVERSATION_TITLE_MAX_LENGTH} characters or fewer.`);
      return;
    }
    if (validation.title === conversation.title) {
      setRenameError('');
      setEditing(false);
      return;
    }
    renameSubmittingRef.current = true;
    setSaving(true);
    setRenameError('');
    try {
      await onRename(validation.title);
      setEditing(false);
    } catch (error) {
      setRenameError("Couldn't rename conversation.");
      renameInputRef.current?.focus();
      throw error;
    } finally {
      renameSubmittingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className={`${selected ? 'dm-conversation-option-row active' : 'dm-conversation-option-row'}${conversation.archivedAt ? ' archived' : ''}${editing ? ' editing' : ''}`}>
      {editing ? (
        <form
          className="dm-conversation-rename"
          onSubmit={(event) => {
            event.preventDefault();
            void commitRename();
          }}
        >
          <input
            ref={renameInputRef}
            type="text"
            value={draftTitle}
            maxLength={CONVERSATION_TITLE_MAX_LENGTH}
            disabled={saving}
            aria-label={`Rename ${conversation.title}`}
            aria-invalid={Boolean(renameError)}
            onChange={(event) => {
              setDraftTitle(event.target.value);
              if (renameError) setRenameError('');
            }}
            onBlur={() => void commitRename()}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              cancelRename();
            }}
          />
          <small className={renameError ? 'dm-conversation-rename-error' : ''} role={renameError ? 'status' : undefined}>
            {renameError || `${draftTitle.length}/${CONVERSATION_TITLE_MAX_LENGTH}`}
          </small>
        </form>
      ) : (
        <button
          className="dm-conversation-option"
          type="button"
          aria-current={selected ? 'page' : undefined}
          onClick={onSelect}
        >
          <span className="dm-conversation-option-copy">
            <strong>{conversation.title}</strong>
            <small>{stateLabel}</small>
          </span>
          {current && <span className="dm-conversation-current-dot" aria-hidden="true" />}
        </button>
      )}
      {!editing && (
        <span className="dm-conversation-option-actions">
          {onRename && (
            <button className="rename" type="button" title="Rename conversation" aria-label={`Rename ${conversation.title}`} onClick={beginRename}>
              <Pencil size={13} />
            </button>
          )}
          {onArchive && (
            <button type="button" title="Archive conversation" aria-label={`Archive ${conversation.title}`} onClick={onArchive}>
              <Archive size={14} />
            </button>
          )}
          {onRestore && (
            <button type="button" title="Restore conversation" aria-label={`Restore ${conversation.title}`} onClick={onRestore}>
              <RotateCcw size={14} />
            </button>
          )}
          {onDelete && (
            <button className="danger" type="button" title="Delete permanently" aria-label={`Delete ${conversation.title} permanently`} onClick={onDelete}>
              <Trash2 size={14} />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function CommunicationAgentProgressMessage({ agent, label, sourceLabel }: { agent: AgentRecord; label: string; sourceLabel: string | null }) {
  const accessibleLabel = sourceLabel ? `${label}, ${sourceLabel}` : label;
  return (
    <div className="message assistant-progress-message" role="status" aria-live="polite" aria-label={`TYR status: ${accessibleLabel}`}>
      <div className="avatar agent">{avatarSeed(agent.displayName)}</div>
      <div className="message-body">
        <div className="message-meta">
          <b>{agent.displayName}</b>
          <small>agent</small>
          {sourceLabel && <small className="assistant-progress-source">{sourceLabel}</small>}
        </div>
        <div className="message-bubble assistant-progress-bubble">
          <span className="assistant-progress-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}

function AgentDetailDrawer({ agent, node, snapshot, intent, onClose, onRefresh, onOpenAgentDm, onOpenDmChannel, onOpenAgentHistoryItem }: {
  agent: AgentRecord;
  node: TopologyGraphNode;
  snapshot: AppSnapshot;
  intent?: TopologyInspectorIntent;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onOpenAgentDm: (agentId: string) => Promise<void>;
  onOpenDmChannel: (channelId: string) => void;
  onOpenAgentHistoryItem?: (item: AgentActivityTimelineItem) => void;
}) {
  return (
    <ChatDetailDrawer variant="overlay" style={{}} onClose={onClose}>
      <div className="topology-inspector chat-agent-detail-inspector" aria-label={`${agent.displayName} details`}>
        <button className="topology-inspector-close chat-agent-detail-close" aria-label="Close agent details" title="Close agent details" onClick={onClose}>
          <X size={16} />
        </button>
        <TopologyInspectorDetails
          node={node}
          snapshot={snapshot}
          intent={intent}
          channelMemberIndex={{}}
          onRefresh={onRefresh}
          onCreateAgent={() => undefined}
          onConnectComputer={() => undefined}
          onOpenAgentDm={async (agentId) => {
            await onOpenAgentDm(agentId);
            onClose();
          }}
          onOpenDmChannel={(channelId) => {
            onOpenDmChannel(channelId);
            onClose();
          }}
          onOpenLiveExecution={() => undefined}
          onOpenAgentHistoryItem={onOpenAgentHistoryItem}
        />
      </div>
    </ChatDetailDrawer>
  );
}

function ChatDetailDrawer({ variant = "overlay", style, onClose, children }: { variant?: "overlay" | "inline"; style: CSSProperties; onClose: () => void; children: ReactNode }) {
  const className = variant === "inline" ? "task-thread-drawer-shell inline" : "task-thread-drawer-shell";
  return (
    <div className={className} style={style}>
      <button className="task-thread-drawer-backdrop" type="button" aria-label="Close details" onClick={onClose} />
      <div className="task-thread-drawer">{children}</div>
    </div>
  );
}

function MessageThreadRouteStatusPanel({ status, error, onClose, onRetry }: {
  status?: MessageThreadRouteLoadState;
  error?: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  const failed = status === "error" || status === "not_found";
  return (
    <section className="thread-panel thread-route-status-panel" aria-live="polite">
      <header className="thread-head no-tabs">
        <h2>Thread</h2>
        <button className="icon-btn" type="button" title="Close thread" aria-label="Close thread" onClick={onClose}><X size={17} /></button>
      </header>
      <div className="thread-route-status-body">
        {failed ? (
          <>
            <MessageSquare size={24} aria-hidden="true" />
            <strong>Thread unavailable</strong>
            <p>{error || (status === "not_found" ? "This thread is no longer available." : "The thread could not be loaded.")}</p>
            {status === "error" && <button className="btn small" type="button" onClick={onRetry}><RotateCcw size={14} /> Retry</button>}
          </>
        ) : (
          <>
            <RotateCcw className="thread-route-status-spinner" size={22} aria-hidden="true" />
            <strong>Loading thread…</strong>
          </>
        )}
      </div>
    </section>
  );
}

function agentDetailNodeFor(agent: AgentRecord, snapshot: AppSnapshot): TopologyGraphNode {
  const machine = agent.machineId ? snapshot.machines.find((item) => item.id === agent.machineId) : undefined;
  const shared = Boolean(!isCommunicationAgent(agent) && (agent.access?.shared || machine?.access?.shared || (!machine && agent.ownerUserId !== snapshot.currentUser.id)));
  return {
    id: `agent:${agent.id}`,
    kind: "agent",
    label: agent.displayName,
    subtitle: isCommunicationAgent(agent) ? "Communication / server-hosted" : `${agent.runtime ?? "No runtime"} / ${shared && !machine ? "shared" : agentStatusLabel(agent.status)}`,
    position: { x: 0, y: 0 },
    status: agent.status,
    shared,
    row: {
      kind: "agent",
      id: agent.id,
      agent,
      parentId: machine?.id ?? (shared ? "shared" : agent.machineId ?? "server"),
      shared
    }
  };
}

function mergeMessagePageInfo(current: MessagePageInfo | undefined, incoming: MessagePageInfo, mode: "replace" | "before" | "after" | "merge"): MessagePageInfo {
  if (!current || mode === "replace") return incoming;
  return {
    hasMoreBefore: mode === "before" ? incoming.hasMoreBefore : current.hasMoreBefore,
    hasMoreAfter: mode === "after" ? incoming.hasMoreAfter : current.hasMoreAfter,
    oldestSeq: minSeq(current.oldestSeq, incoming.oldestSeq),
    newestSeq: maxSeq(current.newestSeq, incoming.newestSeq)
  };
}

function minSeq(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

function maxSeq(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}
