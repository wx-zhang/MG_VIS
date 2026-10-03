import { Suspense, lazy, type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, getSmoothStepPath, getStraightPath, useNodesInitialized, useNodesState, useReactFlow, type Edge, type EdgeProps, type Node } from "@xyflow/react";
import QRCode from "qrcode";
import { BridgeRequestProgress } from "../shared/BridgeRequestProgress";
import { BridgeLocalExecutionLog } from "../shared/BridgeLocalExecutionLog";
import { PersonalRepliesPanel } from "../shared/PersonalRepliesPanel";
import {
  Activity,
  AlertTriangle,
  Archive,
  Bell,
  Bookmark,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  Folder,
  HardDrive,
  Hash,
  KeyRound,
  LogOut,
  Mail,
  MessageSquare,
  Monitor,
  Network,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  Smartphone,
  Square,
  Terminal,
  Trash2,
  UserRound,
  Users,
  X
} from "lucide-react";
import {
  DEFAULT_RUNTIME_PERMISSION_MODE,
  RUNTIMES,
  isCommunicationAgent,
  runtimePermissionModeAvailable,
  runtimePermissionModeSupported,
  type AgentRecord,
  type AppSnapshot,
  type ChannelType,
  type ConversationRecord,
  type CrossWorkspaceMessageRecord,
  type CursorPageInfo,
  type DevicePairingTokenRecord,
  type InboxItem,
  type InboxResponse,
  type MachineRecord,
  type MessageThreadContextPayload,
  type RuntimeApprovalRecord,
  type RuntimeExecutionRecord,
  type RuntimeId,
  type RuntimeModel,
  type RuntimePermissionMode,
  type RuntimeReport,
  type WorkspaceBridgeRequestStatusPayload,
  type ServerRecord,
  type SkillInfo,
  type TopologyExecutionOpenTarget,
  type TopologyLiveWorkPayload,
  type UserRecord,
  type WorkspaceBootstrapPayload,
  type WorkspaceBridgeConversationRecord,
  type WorkspaceBridgeMessagePageInfo,
  type WorkspaceBridgeMessagesPayload,
  type WorkspaceBridgeRecord,
  type WorkspaceFileNode,
  runtimeDisplayName
} from "@tyr-ai/contracts";
import { chatPathForChannel, pathWithUiStyle, routeStateFromPath, uiStyleFromSearch, type WorkspaceSettingsTab, type WorkspaceUiStyle, type WorkspaceView } from "../routing";
import { channelUnreadPath, inboxOpenTarget, inboxReadPath } from "../inboxActions";
import { messageResultOpenTarget } from "../messageNavigation";
import { unreadBadgeLabel } from "../unreadBadges";
import { filterCreatableMachines, memberAgentSubtitle } from "../membersPanel";
import { agentLastErrorSummary, agentLifecycleWarning, agentMachineSummary, agentOwnerLabel, agentProfileApplyState, agentProfileDraft, agentProfileDraftChanged, agentRuntimeSummary, canManageAgentRuntimeView, normalizeAgentProfileDraft, permissionModeTitle, type AgentProfileDraft } from "../agentProfile";
import { AgentRuntimeResourceGrantsEditor, hasPublicRuntimeResourceGrants } from "../AgentRuntimeResourceGrantsEditor";
import { AgentModelSelect } from "../shared/AgentModelSelect";
import { agentCanOpenDm, agentProfileTabsForAccess, channelDisplayLabel, channelDisplayLabelFromFields, dmChannelForAgent, dmPeerAgentForChannel, dmTitle, sharedResourceLabel, type AgentProfileTab } from "../resourceAccess";
import { fallbackHumanProfile, humanCreatedAgentsForDisplay, humanProfileApiAllowed, humanProfileFacts, humanRoleActionState, memberRoleLabel } from "../humanProfile";
import { browserNotificationCapability, browserNotificationStatus, loadBrowserNotificationSettings, saveBrowserNotificationSettings, sendBrowserNotification, type BrowserNotificationSettings } from "../browserNotifications";
import { approvalActionDisabled, pendingApprovalCountByAgentId, visibleRuntimeApprovals } from "../approvalView";
import { governanceApprovalReviewItemLabel, governanceApprovalReviewSummary } from "../approvalReview";
import { accountPasswordValidationMessage, accountProfileDraft, accountProfileDraftChanged, accountProfilePayload, type AccountProfileDraft } from "../accountSettings";
import { connectCommandPresentation, currentConnectPlatform } from "../connectCommand";
import { ApiError, api, apiErrorMessage, authenticatedApiUrl } from "../lib/api";
import { getRefreshToken } from "../lib/authStorage";
import { openAgentDmNavigation } from "../agentDmNavigation";
import { ChatView, ConversationMenuOption } from "../pages/ChatPage";
import { isChatScrollAtLatest } from "../pages/chat/chatLatestScroll";
import { InvitationsPage } from "../pages/invitations/InvitationsPage";
import { PaginatedAgentActivityTimeline, ReminderList } from "../shared/activity";
import { AgentPermissionsPanel } from "../shared/AgentPermissionsPanel";
import { AssistantContactMethodsPanel } from "../shared/AssistantContactMethodsPanel";
import { TyrRoutingInstructionsEditor } from "../shared/TyrRoutingInstructionsEditor";
import { DeveloperAccessPanel } from "../shared/DeveloperAccessPanel";
import { confirmDialog } from "../shared/confirmDialog";
import { formatMessageTimestamp } from "../shared/messageTime";
import { Modal, SelectControl, TopBar, type WorkspaceTopBarProps } from "../shared/ui";
import { TyrLogo, TyrMark } from "../shared/TyrLogo";
import { agentStatusLabel, avatarSeed, copyMessageText, memberProfileDate, messagePreviewText, publicConversationToRecord, relativeTime, settingsPath, workspaceCacheServerId, statusDot, topologyTreeStatusClass } from "./workspaceUtils";
import type { HumanMemberProfile, MachineConnectCommand, MachineOnboardingLink, SearchMessageResult } from "./workspaceTypes";
import { clampContextMenuPosition, shouldCloseContextMenuForKey, shouldCloseContextMenuForPointerTarget } from "../contextMenu";
import { channelUnreadCount } from "../unreadBadges";
import { primarySidebarItems, sidebarNavigationLayout, type PrimarySidebarItem } from "../sidebarNav";
import { mergeMessageThreadContexts, messageThreadContextFromPublic, shouldLoadMessageThreadContext, shouldRedirectMissingMessageThread, type MessageThreadRouteLoadState } from "../threadRoute";
import { topologyGraphForSnapshot, topologyGraphNodesWithWorkspaceFrames, topologyInspectTargetAvailable, topologyNodeAction, topologyOperationalSnapshot, topologyRowsForSnapshot, type ChannelMemberIndex, type TopologyGraphEdge, type TopologyGraphEdgeKind, type TopologyGraphNode, type TopologyInspectTarget, type TopologyRow } from "../topology";
import { topologyBridgeEdgeClassName, topologyBridgeEdgeLabel, topologyBridgeMarkerPlacement } from "../topologyBridgeEdges";
import { topologyGraphWithLiveWork, topologyLiveExecutionLabel, topologyLiveExecutionTone } from "../topologyLiveWork";
import { primaryTopologyLiveActivity, topologyLiveActivityLabel, topologyLiveActivityTone } from "../livingTopologyActivity";
import {
  LIVING_TOPOLOGY_PALETTE,
  livingTopologyNodeStateKey,
  resolveLivingTopologyNodeState,
  type LivingTopologyNodeState
} from "../livingTopologyNodeState";
import { topologyLivingNodeStates, topologyNodeSignalPresentation } from "../topologyNodePresentation";
import { topologyExecutionBridge, topologyExecutionConversationPath } from "../topologyExecutionNavigation";
import { topologyContextActionsForTarget, type TopologyContextMenuAction, type TopologyContextMenuActionId, type TopologyContextMenuTarget } from "../topologyContextActions";
import { reconcileTopologyFlowEdges, reconcileTopologyFlowNodes, topologyGraphEdgeVisualKey, topologyGraphNodeVisualKey, type StableTopologyFlowEdgeData, type StableTopologyFlowNodeData } from "../topologyFlowState";
import type { TopologyInspectorIntent } from "./TopologyInspectorDetails";
import { TopologyInspector } from "./TopologyInspector";
import { activeTopologySidebarSelection } from "./topologySidebarSelection";
import { openTopologyComputer, seedTopologyExpandedComputers, toggleTopologyComputerExpanded, topologyExpandedComputersEqual } from "./topologySidebarExpansion";
import { DeviceDetailPanel } from "./DeviceDetailPanel";
import { workspaceNavigationStatusForServer, type WorkspaceNavigationLoadState, type WorkspaceNavigationLoadStatus, type WorkspacePageDataError, type WorkspacePageDataLoaded } from "./workspaceLoading";
import { ConnectCommandPanel } from "./ConnectCommandPanel";
import { canArchiveConversation, canPermanentlyDeleteConversation, conversationsForMenuView, conversationViewMode, type ConversationMenuView } from "../conversationModel";
import { workspaceBridgeClientRequestId } from "../workspaceBridgeClientRequestId";
import { dominantBridgeCommunicationFlowSignal, type CommunicationFlowTone } from "../communicationFlow";
import { useTopologyLiveWork } from "../topologyLiveWorkRealtime";

type View = WorkspaceView;
type SettingsTab = WorkspaceSettingsTab;
const EMPTY_CHANNEL_MEMBER_INDEX: ChannelMemberIndex = {};
type WorkspaceSpatialViewModule = typeof import("./WorkspaceSpatialView");
let workspaceSpatialViewPromise: Promise<WorkspaceSpatialViewModule> | undefined;

function loadWorkspaceSpatialView(): Promise<WorkspaceSpatialViewModule> {
  if (!workspaceSpatialViewPromise) {
    // 入口预取与 React.lazy 共用同一 Promise；预取失败时不阻塞尚未开始的真实导航请求。
    workspaceSpatialViewPromise = import("./WorkspaceSpatialView").catch((error) => {
      workspaceSpatialViewPromise = undefined;
      throw error;
    });
  }
  return workspaceSpatialViewPromise;
}

function preloadWorkspaceSpatialView(): void {
  void loadWorkspaceSpatialView()
    .then((module) => module.preloadWorkspaceSpatialScene())
    // 预取属于非关键增强；真实导航仍会通过 lazy loader 显示加载态或重试。
    .catch(() => undefined);
}

// 3D 引擎只服务独立 Workspace View，按需加载可避免 Topology 与 DM 首屏承担 Three.js 包体。
const WorkspaceSpatialView = lazy(() => loadWorkspaceSpatialView().then((module) => ({ default: module.WorkspaceSpatialView })));

type TopologyContextMenuEvent = {
  preventDefault: () => void;
  stopPropagation: () => void;
  clientX: number;
  clientY: number;
};

type TopologyContextMenuController = {
  open: (event: TopologyContextMenuEvent, target: TopologyContextMenuTarget) => void;
};

export function WorkspaceShell({ snapshot, servers, error, workspaceSummary, workspaceNavigationLoadState, pageDataLoaded, pageDataError, pageDataLoading, devicePageInfo, onRefresh, onLoadMoreDevices, onActivateServer, onLoggedOut }: { snapshot: AppSnapshot; servers: ServerRecord[]; error: string; workspaceSummary: WorkspaceBootstrapPayload["summary"]; workspaceNavigationLoadState: WorkspaceNavigationLoadState; pageDataLoaded: WorkspacePageDataLoaded; pageDataError: WorkspacePageDataError; pageDataLoading: { devices: boolean }; devicePageInfo: CursorPageInfo; onRefresh: () => Promise<void>; onLoadMoreDevices: () => Promise<void>; onActivateServer: (serverId: string) => Promise<void>; onLoggedOut: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = routeStateFromPath(location.pathname, location.search);
  const uiStyle = uiStyleFromSearch(location.search);
  const view = routeState.view;
  const [computerModal, setComputerModal] = useState(false);
  const [agentModal, setAgentModal] = useState(false);
  const [agentModalMachineId, setAgentModalMachineId] = useState<string | undefined>();
  const [selectedWorkspaceBridge, setSelectedWorkspaceBridge] = useState<WorkspaceBridgeRecord | null>(null);
  const [workspaceBridgeConversations, setWorkspaceBridgeConversations] = useState<WorkspaceBridgeConversationRecord[]>([]);
  const [selectedWorkspaceBridgeConversationId, setSelectedWorkspaceBridgeConversationId] = useState("");
  const [workspaceBridgeConversationMenuView, setWorkspaceBridgeConversationMenuView] = useState<ConversationMenuView>("active");
  const [workspaceBridgeConversationMenuOpen, setWorkspaceBridgeConversationMenuOpen] = useState(false);
  const [workspaceBridgeConversationBusy, setWorkspaceBridgeConversationBusy] = useState(false);
  const [workspaceBridgeConversationError, setWorkspaceBridgeConversationError] = useState("");
  const [workspaceBridgeMessages, setWorkspaceBridgeMessages] = useState<CrossWorkspaceMessageRecord[]>([]);
  const [workspaceBridgeRequestStatuses, setWorkspaceBridgeRequestStatuses] = useState<Record<string, WorkspaceBridgeRequestStatusPayload>>({});
  const [workspaceBridgeStatusError, setWorkspaceBridgeStatusError] = useState("");
  const [workspaceBridgeMessagePageInfo, setWorkspaceBridgeMessagePageInfo] = useState<WorkspaceBridgeMessagePageInfo | null>(null);
  const [workspaceBridgeMessagesLoading, setWorkspaceBridgeMessagesLoading] = useState(false);
  const [workspaceBridgeEarlierMessagesLoading, setWorkspaceBridgeEarlierMessagesLoading] = useState(false);
  const [workspaceBridgeMessagesError, setWorkspaceBridgeMessagesError] = useState("");
  const [workspaceBridgeMessageDraft, setWorkspaceBridgeMessageDraft] = useState("");
  const [workspaceBridgeReplyTarget, setWorkspaceBridgeReplyTarget] = useState({ conversationId: "", requestId: "" });
  const [workspaceBridgeRetryingMessageIds, setWorkspaceBridgeRetryingMessageIds] = useState<Set<string>>(() => new Set());
  const [showWorkspaceBridgeNewMessages, setShowWorkspaceBridgeNewMessages] = useState(false);
  const workspaceBridgeLogRef = useRef<HTMLDivElement>(null);
  const workspaceBridgeScrollModeRef = useRef<"latest" | "preserve">("latest");
  const [machineOnboarding, setMachineOnboarding] = useState<MachineOnboardingLink | null>(null);
  const [sidebarLogoutOpen, setSidebarLogoutOpen] = useState(false);
  const [sidebarLogoutBusy, setSidebarLogoutBusy] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [agentDmError, setAgentDmError] = useState("");
  const [topologyExecutionError, setTopologyExecutionError] = useState("");
  const [messageThreadContextsByRouteId, setMessageThreadContextsByRouteId] = useState<Record<string, MessageThreadContextPayload>>({});
  const [messageThreadRouteLoadStates, setMessageThreadRouteLoadStates] = useState<Record<string, MessageThreadRouteLoadState>>({});
  const [messageThreadRouteError, setMessageThreadRouteError] = useState("");
  const [messageThreadRouteRequestVersion, setMessageThreadRouteRequestVersion] = useState(0);
  const messageThreadContextScopeRef = useRef("");
  const [pendingApprovalsOpen, setPendingApprovalsOpen] = useState(false);
  const [pendingApprovalsAgentId, setPendingApprovalsAgentId] = useState<string | null>(null);

  const serverId = workspaceCacheServerId(snapshot);
  const topologyLoadStatus = workspaceNavigationStatusForServer(workspaceNavigationLoadState, snapshot.currentServer?.id ?? null);
  const currentServerId = snapshot.currentServer?.id ?? null;
  const topologyDevicesReady = pageDataLoaded.serverId === currentServerId && pageDataLoaded.devices;
  // 首次拓扑必须同时拥有导航和 Devices；后台刷新失败时保留已经展示的稳定画布。
  const topologyCanvasLoadStatus: Exclude<WorkspaceNavigationLoadStatus, "idle"> = topologyLoadStatus === "error"
    ? "error"
    : topologyLoadStatus === "ready" && topologyDevicesReady
      ? "ready"
      : pageDataError.devices
        ? "error"
        : "loading";
  const topologyLiveWorkRefreshKey = useMemo(
    () => topologySnapshotLiveWorkRefreshKey(snapshot),
    [snapshot.runtimeApprovals, snapshot.runtimeExecutions]
  );
  const topologyLiveWork = useTopologyLiveWork({
    // 权威 endpoint 会补回仍在可见窗口内的 Flow；非拓扑页面不应常驻承担轮询和投影查询。
    enabled: Boolean(snapshot.currentServer?.id)
      && topologyCanvasLoadStatus === "ready"
      && (view === "topology" || view === "workspace"),
    serverId: snapshot.currentServer?.id,
    refreshKey: topologyLiveWorkRefreshKey
  });
  const messageThreadContextScopeKey = `${snapshot.currentUser.id}:${snapshot.currentServer?.id ?? ""}`;
  const activeMessageThreadContextsByRouteId = messageThreadContextScopeRef.current === messageThreadContextScopeKey
    ? messageThreadContextsByRouteId
    : {};
  const routedSnapshot = useMemo(
    () => mergeMessageThreadContexts(snapshot, Object.values(activeMessageThreadContextsByRouteId)),
    [snapshot, activeMessageThreadContextsByRouteId]
  );
  const routeThreadContext = routeState.threadChannelId ? activeMessageThreadContextsByRouteId[routeState.threadChannelId] : undefined;

  useEffect(() => {
    if (view !== "topology" || topologyCanvasLoadStatus !== "ready") return;
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    // 空闲预取不消耗用户明确要求节省的流量；入口 hover/focus 仍会表达更强的导航意图。
    if (connection?.saveData || connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g") return;

    const browserWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let timer: number | undefined;
    let idleCallback: number | undefined;
    const prefetchWhenVisible = () => {
      if (document.visibilityState === "visible") preloadWorkspaceSpatialView();
    };
    if (browserWindow.requestIdleCallback) {
      idleCallback = browserWindow.requestIdleCallback(prefetchWhenVisible, { timeout: 4_000 });
    } else {
      timer = window.setTimeout(prefetchWhenVisible, 1_500);
    }
    return () => {
      if (idleCallback !== undefined) browserWindow.cancelIdleCallback?.(idleCallback);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [topologyCanvasLoadStatus, view, snapshot.currentServer?.id]);

  const defaultChannel = routedSnapshot.channels.find((channel) => channel.type === "dm");
  const routeThread = routeState.threadChannelId
    ? routedSnapshot.channels.find((channel) => channel.id === routeState.threadChannelId && channel.type === "thread") ?? routeThreadContext?.channel
    : undefined;
  const selectedChannelId = routeState.selectedChannelId ?? routeThreadContext?.parentChannel.id ?? routeThread?.parentChannelId ?? defaultChannel?.id ?? "";
  const channelMemberIndex = EMPTY_CHANNEL_MEMBER_INDEX;
  const pendingRuntimeApprovals = useMemo(
    () => visibleRuntimeApprovals(snapshot.runtimeApprovals ?? []).filter((approval) => approval.status === "pending"),
    [snapshot.runtimeApprovals]
  );
  const activeSelectedWorkspaceBridge = selectedWorkspaceBridge
    ? (snapshot.workspaceBridges ?? []).find((bridge) => bridge.id === selectedWorkspaceBridge.id) ?? selectedWorkspaceBridge
    : null;
  const activeSelectedWorkspaceBridgeTopology = activeSelectedWorkspaceBridge
    ? (snapshot.peerWorkspaceTopologies ?? []).find((topology) => topology.bridgeId === activeSelectedWorkspaceBridge.id)
    : undefined;

  useEffect(() => {
    if (messageThreadContextScopeRef.current === messageThreadContextScopeKey) return;
    messageThreadContextScopeRef.current = messageThreadContextScopeKey;
    setMessageThreadContextsByRouteId({});
    setMessageThreadRouteLoadStates({});
    setMessageThreadRouteError("");
  }, [messageThreadContextScopeKey]);

  useEffect(() => {
    const threadChannelId = routeState.threadChannelId;
    // Always hydrate a routed thread through its scoped context endpoint. A compact
    // workspace snapshot may contain the thread row without its parent DM/message.
    if (!threadChannelId || !shouldLoadMessageThreadContext({ threadChannelId, hasContext: Boolean(routeThreadContext) })) return;
    const controller = new AbortController();
    setMessageThreadRouteLoadStates((current) => ({ ...current, [threadChannelId]: "loading" }));
    setMessageThreadRouteError("");
    void api<unknown>(`/api/threads/${encodeURIComponent(threadChannelId)}`, {
      label: "chat.thread-context",
      signal: controller.signal
    })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const context = messageThreadContextFromPublic(payload);
        setMessageThreadContextsByRouteId((current) => ({ ...current, [threadChannelId]: context }));
        setMessageThreadRouteLoadStates((current) => ({ ...current, [threadChannelId]: "resolved" }));
      })
      .catch((threadError) => {
        if (controller.signal.aborted) return;
        const missing = threadError instanceof ApiError && (threadError.status === 404 || threadError.code === "thread_not_found");
        setMessageThreadRouteLoadStates((current) => ({ ...current, [threadChannelId]: missing ? "not_found" : "error" }));
        if (!missing) setMessageThreadRouteError(apiErrorMessage(threadError, "Thread unavailable. Please refresh and try again."));
      });
    return () => {
      controller.abort();
    };
  }, [messageThreadContextScopeKey, messageThreadRouteRequestVersion, routeState.threadChannelId, routeThreadContext]);
  const localTyrAssistant = snapshot.currentServer?.onboardingAgentId
    ? snapshot.agents.find((agent) => agent.id === snapshot.currentServer?.onboardingAgentId)
    : snapshot.agents.find((agent) => isCommunicationAgent(agent));
  const localWorkspaceBridgeAssistantLabel = workspaceBridgeAssistantLabel(
    localTyrAssistant?.displayName,
    snapshot.currentServer?.name ?? "Current workspace"
  );
  const localWorkspaceBridgeUserLabel = workspaceBridgeParticipantLabel(
    snapshot.currentUser.displayName,
    snapshot.currentServer?.name ?? "Current workspace"
  );
  const peerWorkspaceBridgeAssistantLabel = workspaceBridgeAssistantLabel(
    activeSelectedWorkspaceBridgeTopology?.assistant?.displayName,
    activeSelectedWorkspaceBridge?.peerWorkspace?.name ?? "Peer workspace"
  );
  const peerWorkspaceBridgeUserLabel = workspaceBridgeParticipantLabel(
    activeSelectedWorkspaceBridge?.peerWorkspace?.ownerDisplayName,
    activeSelectedWorkspaceBridge?.peerWorkspace?.name ?? "Peer workspace",
    "Peer user"
  );
  const workspaceBridgePermissionSummary = "Destination account capabilities";
  const activeWorkspaceBridgeConversation = workspaceBridgeConversations.find((conversation) => conversation.status === "active" && conversation.direction === "outgoing");
  const selectedWorkspaceBridgeConversation = workspaceBridgeConversations.find((conversation) => conversation.id === selectedWorkspaceBridgeConversationId)
    ?? activeWorkspaceBridgeConversation;
  const visibleWorkspaceBridgeConversations = conversationsForMenuView(workspaceBridgeConversations, workspaceBridgeConversationMenuView);
  const currentWorkspaceBridgeConversations = visibleWorkspaceBridgeConversations.filter((conversation) => conversation.status === "active");
  const recentWorkspaceBridgeConversations = visibleWorkspaceBridgeConversations.filter((conversation) => conversation.status !== "active");
  const selectedWorkspaceBridgeConversationMode = conversationViewMode(selectedWorkspaceBridgeConversation);
  const selectedWorkspaceBridgeConversationIncoming = selectedWorkspaceBridgeConversation?.direction === "incoming";
  const selectedWorkspaceBridgeMessages = workspaceBridgeMessages.filter((message) => (
    message.bridgeId === activeSelectedWorkspaceBridge?.id &&
    message.conversationId === selectedWorkspaceBridgeConversation?.id
  ));
  const pendingWorkspaceBridgeRequests = selectedWorkspaceBridgeMessages.filter((message) => (
    message.initiatedBy === "human" &&
    // Bridge 两端都可见同一请求；incoming Owner 也需要看到目标侧的处理状态。
    (message.sourceWorkspaceId === snapshot.currentServer?.id || message.targetWorkspaceId === snapshot.currentServer?.id) &&
    message.outcome !== "failed" &&
    !message.id.startsWith("optimistic:") &&
    !selectedWorkspaceBridgeMessages.some((reply) => reply.replyToMessageId === message.id && (
      reply.responseKind === "final" || reply.responseKind === "error" || reply.outcome === "failed"
    )) &&
    workspaceBridgeRequestStatuses[message.id]?.state !== "completed" &&
    workspaceBridgeRequestStatuses[message.id]?.state !== "failed"
  ));
  const visibleWorkspaceBridgeRequestIds = selectedWorkspaceBridgeMessages.filter((message) =>
    message.initiatedBy === "human" && !message.replyToMessageId && !message.id.startsWith("optimistic:")
  ).map((message) => message.id).join(",");
  const ownWorkspaceBridgeRequests = selectedWorkspaceBridgeMessages.filter((message) => !message.responseKind &&
    !message.replyToMessageId && !message.id.startsWith("optimistic:") &&
    message.sourceWorkspaceId === snapshot.currentServer?.id && message.sourceCapabilityUserId === snapshot.currentUser.id);
  const openOwnWorkspaceBridgeRequests = ownWorkspaceBridgeRequests.filter((message) =>
    pendingWorkspaceBridgeRequests.some((pending) => pending.id === message.id));
  const defaultWorkspaceBridgeReplyTarget = openOwnWorkspaceBridgeRequests.length === 1 ? openOwnWorkspaceBridgeRequests[0]!.id
    : ownWorkspaceBridgeRequests.length === 1 ? ownWorkspaceBridgeRequests[0]!.id
      : ownWorkspaceBridgeRequests.length === 0 && !workspaceBridgeMessagePageInfo?.hasMoreBefore ? "new" : "";
  const workspaceBridgeReplyTargetId = workspaceBridgeReplyTarget.conversationId === selectedWorkspaceBridgeConversation?.id
    ? workspaceBridgeReplyTarget.requestId : defaultWorkspaceBridgeReplyTarget;
  const workspaceBridgeAttention = pendingWorkspaceBridgeRequests.map((message) => workspaceBridgeRequestStatuses[message.id])
    .find((status) => status?.state === "needs_attention");
  const workspaceBridgeReviewing = pendingWorkspaceBridgeRequests.some((message) =>
    workspaceBridgeRequestStatuses[message.id]?.progress?.stage === "reviewing_result");
  const workspaceBridgeWaitingForApproval = pendingWorkspaceBridgeRequests.some((message) => (
    workspaceBridgeRequestStatuses[message.id]?.state === "blocked_on_peer_approval"
  ));
  const workspaceBridgePeerRunning = pendingWorkspaceBridgeRequests.some((message) => (
    workspaceBridgeRequestStatuses[message.id]?.state === "running"
  ));
  const workingWorkspaceBridgeAssistantLabel = selectedWorkspaceBridgeConversationIncoming
    ? localWorkspaceBridgeAssistantLabel
    : peerWorkspaceBridgeAssistantLabel;
  const latestWorkspaceBridgeMessage = selectedWorkspaceBridgeMessages.at(-1);
  const latestWorkspaceBridgeMessageKey = latestWorkspaceBridgeMessage
    ? `${latestWorkspaceBridgeMessage.id}:${latestWorkspaceBridgeMessage.outcome}:${latestWorkspaceBridgeMessage.content.length}`
    : "";
  const routeTopologyInspectTarget = useMemo<TopologyInspectTarget | null>(() => {
    if (routeState.selectedServerId) return { kind: "server", id: routeState.selectedServerId };
    if (routeState.selectedMachineId) return { kind: "machine", id: routeState.selectedMachineId };
    if (routeState.selectedAgentId) return { kind: "agent", id: routeState.selectedAgentId };
    if (routeState.selectedDeviceId) return { kind: "device", id: routeState.selectedDeviceId };
    return null;
  }, [routeState.selectedAgentId, routeState.selectedDeviceId, routeState.selectedMachineId, routeState.selectedServerId]);
  const [topologyInspectTarget, setTopologyInspectTarget] = useState<TopologyInspectTarget | null>(routeTopologyInspectTarget);
  const [topologyInspectorOpen, setTopologyInspectorOpen] = useState(Boolean(routeTopologyInspectTarget));
  const activeTopologyInspectTarget = topologyInspectTarget;
  const selectedTopologyAgentId = activeTopologyInspectTarget?.kind === "agent" ? activeTopologyInspectTarget.id : undefined;
  const selectedTopologyMachineId = activeTopologyInspectTarget?.kind === "machine" ? activeTopologyInspectTarget.id : undefined;
  const selectedTopologyDeviceId = activeTopologyInspectTarget?.kind === "device" ? activeTopologyInspectTarget.id : undefined;
  const [topologyContextMenu, setTopologyContextMenu] = useState<TopologyContextMenuState | null>(null);
  const [topologyContextMenuNotice, setTopologyContextMenuNotice] = useState("");
  const [topologyInspectorIntent, setTopologyInspectorIntent] = useState<TopologyInspectorIntent | null>(null);
  const topologyContextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 路由负责恢复具体选中对象；拓扑首页没有目标时必须同时关闭详情，不能回退到第一台 Computer。
    setTopologyInspectTarget(routeTopologyInspectTarget);
    setTopologyInspectorOpen(Boolean(routeTopologyInspectTarget));
    if (!routeTopologyInspectTarget) setTopologyInspectorIntent(null);
  }, [routeTopologyInspectTarget]);

  useEffect(() => {
    const bridgeId = activeSelectedWorkspaceBridge?.id;
    const currentServerId = snapshot.currentServer?.id;
    if (!bridgeId || !currentServerId) {
      setWorkspaceBridgeConversations([]);
      setSelectedWorkspaceBridgeConversationId("");
      setWorkspaceBridgeConversationMenuView("active");
      setWorkspaceBridgeConversationMenuOpen(false);
      setWorkspaceBridgeConversationBusy(false);
      setWorkspaceBridgeConversationError("");
      setWorkspaceBridgeMessages([]);
      setWorkspaceBridgeRequestStatuses({});
      setWorkspaceBridgeMessagePageInfo(null);
      setWorkspaceBridgeMessagesError("");
      setWorkspaceBridgeMessagesLoading(false);
      setWorkspaceBridgeEarlierMessagesLoading(false);
      setShowWorkspaceBridgeNewMessages(false);
      return;
    }
    let cancelled = false;
    workspaceBridgeScrollModeRef.current = "latest";
    setShowWorkspaceBridgeNewMessages(false);
    setWorkspaceBridgeConversations([]);
    setSelectedWorkspaceBridgeConversationId("");
    setWorkspaceBridgeConversationMenuView("active");
    setWorkspaceBridgeConversationMenuOpen(false);
    setWorkspaceBridgeConversationBusy(false);
    setWorkspaceBridgeConversationError("");
    setWorkspaceBridgeMessages([]);
    setWorkspaceBridgeRequestStatuses({});
    setWorkspaceBridgeMessagePageInfo(null);
    setWorkspaceBridgeMessagesLoading(true);
    setWorkspaceBridgeMessagesError("");
    void fetchWorkspaceBridgeConversations(currentServerId, bridgeId).then(async (payload) => {
      if (cancelled) return;
      setWorkspaceBridgeConversations(payload.conversations);
      const conversationId = payload.activeConversationId
        ?? payload.conversations.find((conversation) => conversation.status === "active")?.id
        ?? payload.conversations[0]?.id;
      if (!conversationId) return;
      setSelectedWorkspaceBridgeConversationId(conversationId);
      const page = await fetchWorkspaceBridgeMessagesPage(currentServerId, bridgeId, { conversationId });
      if (cancelled) return;
      setWorkspaceBridgeMessages((current) => mergeWorkspaceBridgeMessages(page.messages, current));
      setWorkspaceBridgeMessagePageInfo(page.pageInfo);
    }).catch((error) => {
      if (cancelled) return;
      setWorkspaceBridgeMessagesError(workspaceBridgeRequestErrorMessage(error, "Bridge conversations could not be loaded."));
      if (workspaceBridgeRequestNeedsWorkspaceRefresh(error)) {
        void onRefresh().catch(() => undefined);
      }
    }).finally(() => {
      if (!cancelled) setWorkspaceBridgeMessagesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSelectedWorkspaceBridge?.id, snapshot.currentServer?.id]);

  useEffect(() => {
    const bridgeId = activeSelectedWorkspaceBridge?.id;
    const serverId = snapshot.currentServer?.id;
    if (!bridgeId || !serverId || !workspaceBridgeConversationMenuOpen) return;
    let cancelled = false;
    let loading = false;
    // Realtime messages do not carry the conversation index. Refresh while it is
    // visible so incoming conversations appear without closing Bridge Details.
    const refreshConversations = async () => {
      if (loading) return;
      loading = true;
      try {
        const payload = await fetchWorkspaceBridgeConversations(serverId, bridgeId);
        if (!cancelled) {
          setWorkspaceBridgeConversations(payload.conversations);
          setWorkspaceBridgeConversationError("");
        }
      } catch (error) {
        if (!cancelled) setWorkspaceBridgeConversationError(
          workspaceBridgeRequestErrorMessage(error, "Bridge conversations could not be refreshed.")
        );
      } finally {
        loading = false;
      }
    };
    void refreshConversations();
    const timer = window.setInterval(() => void refreshConversations(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSelectedWorkspaceBridge?.id, snapshot.currentServer?.id, workspaceBridgeConversationMenuOpen]);

  useEffect(() => {
    const bridgeId = activeSelectedWorkspaceBridge?.id;
    if (!bridgeId) return;
    const realtimeMessages = (snapshot.crossWorkspaceMessages ?? []).filter((message) => message.bridgeId === bridgeId);
    if (realtimeMessages.length === 0) return;
    setWorkspaceBridgeMessages((current) => mergeWorkspaceBridgeMessages(current, realtimeMessages));
  }, [activeSelectedWorkspaceBridge?.id, snapshot.crossWorkspaceMessages]);

  useEffect(() => {
    const serverId = snapshot.currentServer?.id;
    const bridgeId = activeSelectedWorkspaceBridge?.id;
    const conversationId = selectedWorkspaceBridgeConversation?.id;
    setWorkspaceBridgeStatusError("");
    if (!serverId || !bridgeId || !conversationId || !visibleWorkspaceBridgeRequestIds) return;
    let cancelled = false;
    const loadedTerminalIds = new Set<string>();
    const requestIds = visibleWorkspaceBridgeRequestIds.split(",");
    const refreshStatuses = async () => {
      const results = await Promise.allSettled(requestIds.map((requestId) => (
        api<WorkspaceBridgeRequestStatusPayload>(
          `/api/servers/${encodeURIComponent(serverId)}/workspace-bridges/${encodeURIComponent(bridgeId)}/requests/${encodeURIComponent(requestId)}/status`
        )
      )));
      if (cancelled) return;
      setWorkspaceBridgeStatusError(results.some((result) => result.status === "rejected")
        ? "Live request status is unavailable. Displayed progress may be out of date; retrying automatically." : "");
      const statuses = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      if (!statuses.length) return;
      setWorkspaceBridgeRequestStatuses((current) => {
        const next = { ...current };
        for (const status of statuses) next[status.bridgeRequestId] = status;
        return next;
      });
      const newTerminals = statuses.filter((status) => (status.state === "completed" || status.state === "failed") && !loadedTerminalIds.has(status.bridgeRequestId));
      if (newTerminals.length) {
        try {
          const page = await fetchWorkspaceBridgeMessagesPage(serverId, bridgeId, { conversationId });
          if (!cancelled) setWorkspaceBridgeMessages((current) => mergeWorkspaceBridgeMessages(current, page.messages));
          for (const status of newTerminals) loadedTerminalIds.add(status.bridgeRequestId);
        } catch {
          // The terminal status already stops the waiting indicator; realtime or the next load can fill the history.
        }
      }
      if (statuses.length === requestIds.length && statuses.every((status) => status.state === "completed" || status.state === "failed")) window.clearInterval(timer);
    };
    void refreshStatuses();
    const timer = window.setInterval(() => void refreshStatuses(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeSelectedWorkspaceBridge?.id, visibleWorkspaceBridgeRequestIds, selectedWorkspaceBridgeConversation?.id, snapshot.currentServer?.id]);

  useEffect(() => {
    if (!activeSelectedWorkspaceBridge || !workspaceBridgeLogRef.current) return;
    if (workspaceBridgeScrollModeRef.current !== "latest") {
      setShowWorkspaceBridgeNewMessages(true);
      return;
    }
    const log = workspaceBridgeLogRef.current;
    requestAnimationFrame(() => {
      log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
      setShowWorkspaceBridgeNewMessages(false);
    });
  }, [activeSelectedWorkspaceBridge?.id, latestWorkspaceBridgeMessageKey]);

  function handleWorkspaceBridgeLogScroll() {
    const log = workspaceBridgeLogRef.current;
    if (!log) return;
    const atLatest = isChatScrollAtLatest(log);
    workspaceBridgeScrollModeRef.current = atLatest ? "latest" : "preserve";
    if (atLatest) setShowWorkspaceBridgeNewMessages(false);
  }

  function scrollWorkspaceBridgeToLatest() {
    const log = workspaceBridgeLogRef.current;
    if (!log) return;
    workspaceBridgeScrollModeRef.current = "latest";
    setShowWorkspaceBridgeNewMessages(false);
    log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  }

  async function switchServer(serverId: string) {
    if (!serverId || serverId === snapshot.currentServer?.id) return;
    await onActivateServer(serverId);
    navigate(workspacePath("/topology"), { replace: true });
  }
  useEffect(() => {
    setMobileNavOpen(false);
    if (view !== "topology") setTopologyInspectorOpen(false);
  }, [location.pathname, location.search, view]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    function handleMobileNavKeyDown(event: globalThis.KeyboardEvent) {
      // 手机端抽屉是临时导航面板，Esc 需要和遮罩点击一样恢复主工作区。
      if (event.key === "Escape") setMobileNavOpen(false);
    }
    document.addEventListener("keydown", handleMobileNavKeyDown);
    return () => {
      document.removeEventListener("keydown", handleMobileNavKeyDown);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!topologyInspectorOpen || view !== "topology") return;
    function handleTopologyInspectorKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // 编辑字段自己的 Esc 用于取消编辑，不能同时把整个详情面板收起。
      if (target?.matches("input, textarea, select") || target?.isContentEditable) return;
      // URL 是详情选择的真源；关闭时一并清除路由，避免刷新后重新打开已关闭的对象。
      selectTopologyHome();
    }
    document.addEventListener("keydown", handleTopologyInspectorKeyDown);
    return () => {
      document.removeEventListener("keydown", handleTopologyInspectorKeyDown);
    };
  }, [topologyInspectorOpen, view]);

  useEffect(() => {
    if (!topologyContextMenu) return;
    function handlePointerDown(event: PointerEvent) {
      if (shouldCloseContextMenuForPointerTarget(topologyContextMenuRef.current, event.target)) setTopologyContextMenu(null);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (shouldCloseContextMenuForKey(event.key)) setTopologyContextMenu(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [topologyContextMenu]);

  async function onInviteWorkspace(email: string) {
    if (!snapshot.currentServer) return;
    await api<{ ok: true; bridge: WorkspaceBridgeRecord; bootstrap: WorkspaceBootstrapPayload }>(`/api/servers/${encodeURIComponent(snapshot.currentServer.id)}/workspace-bridges`, {
      method: "POST",
      body: JSON.stringify({ email })
    });
    await onRefresh();
  }

  async function onAcceptWorkspaceBridge(bridge: WorkspaceBridgeRecord) {
    await api<{ ok: true; bridge: WorkspaceBridgeRecord; bootstrap: WorkspaceBootstrapPayload }>(`/api/workspace-bridges/${encodeURIComponent(bridge.id)}/accept`, { method: "POST" });
    await onRefresh();
  }

  async function onRevokeWorkspaceBridge(bridge: WorkspaceBridgeRecord) {
    if (!snapshot.currentServer) return;
    await api<{ ok: true; bridge: WorkspaceBridgeRecord; bootstrap: WorkspaceBootstrapPayload }>(`/api/servers/${encodeURIComponent(snapshot.currentServer.id)}/workspace-bridges/${encodeURIComponent(bridge.id)}/revoke`, { method: "POST" });
    await onRefresh();
  }

  async function onSendWorkspaceBridgeMessage(
    bridge: WorkspaceBridgeRecord,
    conversationId: string,
    content: string,
    clientRequestId: string,
    retryOfMessageId?: string,
    replyToRequestId?: string
  ): Promise<CrossWorkspaceMessageRecord | null> {
    if (!snapshot.currentServer) return null;
    const response = await api<{ ok: true; message: CrossWorkspaceMessageRecord; conversation?: unknown }>(`/api/servers/${encodeURIComponent(snapshot.currentServer.id)}/workspace-bridges/${encodeURIComponent(bridge.id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ conversationId, content, clientRequestId, retryOfMessageId, replyToRequestId,
        newRequest: !replyToRequestId && !retryOfMessageId })
    });
    if (response.conversation) {
      const updatedConversation = publicConversationToRecord(response.conversation);
      setWorkspaceBridgeConversations((current) => current.map((conversation) => (
        conversation.id === updatedConversation.id ? { ...conversation, ...updatedConversation } : conversation
      )));
    }
    return response.message;
  }

  async function loadEarlierWorkspaceBridgeMessages(bridge: WorkspaceBridgeRecord) {
    if (!snapshot.currentServer || !workspaceBridgeMessagePageInfo?.hasMoreBefore || !workspaceBridgeMessagePageInfo.oldestCreatedAt || workspaceBridgeEarlierMessagesLoading) return;
    const log = workspaceBridgeLogRef.current;
    const previousHeight = log?.scrollHeight ?? 0;
    setWorkspaceBridgeEarlierMessagesLoading(true);
    setWorkspaceBridgeMessagesError("");
    try {
      const page = await fetchWorkspaceBridgeMessagesPage(snapshot.currentServer.id, bridge.id, {
        limit: workspaceBridgeMessagePageInfo.limit,
        before: workspaceBridgeMessagePageInfo.oldestCreatedAt,
        conversationId: selectedWorkspaceBridgeConversation?.id
      });
      workspaceBridgeScrollModeRef.current = "preserve";
      setWorkspaceBridgeMessages((current) => mergeWorkspaceBridgeMessages(page.messages, current));
      setWorkspaceBridgeMessagePageInfo((current) => ({
        limit: page.pageInfo.limit,
        hasMoreBefore: page.pageInfo.hasMoreBefore,
        oldestCreatedAt: page.pageInfo.oldestCreatedAt,
        newestCreatedAt: current?.newestCreatedAt ?? page.pageInfo.newestCreatedAt
      }));
      requestAnimationFrame(() => {
        if (!log) return;
        // 历史消息插入顶部后补偿新增高度，避免正在阅读的消息突然移位。
        log.scrollTop += log.scrollHeight - previousHeight;
      });
    } catch (error) {
      setWorkspaceBridgeMessagesError(workspaceBridgeRequestErrorMessage(error, "Bridge messages could not be loaded."));
      if (workspaceBridgeRequestNeedsWorkspaceRefresh(error)) {
        void onRefresh().catch(() => undefined);
      }
    } finally {
      setWorkspaceBridgeEarlierMessagesLoading(false);
    }
  }

  async function submitWorkspaceBridgeMessage(bridge: WorkspaceBridgeRecord) {
    const content = workspaceBridgeMessageDraft.trim();
    const conversationId = selectedWorkspaceBridgeConversation?.id;
    if (
      !content ||
      !workspaceBridgeReplyTargetId ||
      workspaceBridgeConversationBusy ||
      workspaceBridgeMessagesLoading ||
      !conversationId ||
      !selectedWorkspaceBridgeConversation?.writable ||
      selectedWorkspaceBridgeConversationMode === "history" ||
      bridge.status !== "active"
    ) return;
    setWorkspaceBridgeMessageDraft("");
    const clientRequestId = workspaceBridgeClientRequestId();
    void sendWorkspaceBridgeMessage(bridge, conversationId, content, clientRequestId, undefined,
      workspaceBridgeReplyTargetId === "new" ? undefined : workspaceBridgeReplyTargetId).catch(() => undefined);
  }

  async function sendWorkspaceBridgeMessage(
    bridge: WorkspaceBridgeRecord,
    conversationId: string,
    content: string,
    clientRequestId: string,
    retryOfMessageId?: string,
    replyToRequestId?: string
  ) {
    const optimisticMessage: CrossWorkspaceMessageRecord = {
        id: `optimistic:${clientRequestId}`,
        bridgeId: bridge.id,
        conversationId,
        clientRequestId,
        retryOfMessageId: retryOfMessageId ?? null,
        responseKind: replyToRequestId ? "instruction" : null,
        terminalRequestId: null,
        originConversationKey: null,
        originChannelId: null,
        originConversationId: null,
        originMessageId: null,
        sourceWorkspaceId: snapshot.currentServer?.id ?? "",
        targetWorkspaceId: bridge.peerWorkspace?.id ?? "",
        senderUserId: snapshot.currentUser.id,
        senderUserName: snapshot.currentUser.name,
        senderUserDisplayName: snapshot.currentUser.displayName,
        senderUserAvatarUrl: snapshot.currentUser.avatarUrl ?? null,
        sourceCapabilityUserId: snapshot.currentUser.id,
        targetCapabilityUserId: bridge.peerWorkspace?.ownerUserId ?? null,
        originalSenderUserId: snapshot.currentUser.id,
        traceId: null,
        parentBridgeRequestId: null,
        hopCount: 1,
        senderCommsAgentId: localTyrAssistant?.id ?? "",
        receiverCommsAgentId: activeSelectedWorkspaceBridgeTopology?.assistant?.id ?? "",
        initiatedBy: "human",
        content,
        outcome: "pending",
        localMessageId: null,
        peerMessageId: null,
        replyToMessageId: replyToRequestId ?? null,
        createdAt: new Date().toISOString()
      };
    // 乐观消息先进入当前 conversation；HTTP 和 realtime 后续用 clientRequestId 替换同一条记录。
    setWorkspaceBridgeMessages((current) => mergeWorkspaceBridgeMessages(current, [optimisticMessage]));
    try {
      const accepted = await onSendWorkspaceBridgeMessage(bridge, conversationId, content, clientRequestId, retryOfMessageId, replyToRequestId);
      if (accepted) {
        setWorkspaceBridgeMessages((current) => mergeWorkspaceBridgeMessages(
          current.filter((message) => message.id !== optimisticMessage.id), [accepted]));
      }
    } catch (error) {
      setWorkspaceBridgeMessagesError(workspaceBridgeRequestErrorMessage(error, "The message could not be confirmed. Retry this message or review the request status."));
      setWorkspaceBridgeMessages((current) => current.map((message) => (
        workspaceBridgeMessageClientKey(message) === workspaceBridgeMessageClientKey(optimisticMessage) &&
        message.outcome === "pending"
          ? { ...message, outcome: "failed" }
          : message
      )));
      throw new Error("workspace_bridge_message_failed");
    }
  }

  async function retryWorkspaceBridgeMessage(bridge: WorkspaceBridgeRecord, message: CrossWorkspaceMessageRecord) {
    const conversationId = message.conversationId;
    if (!conversationId || workspaceBridgeRetryingMessageIds.has(message.id)) return;
    if (message.id.startsWith("optimistic:") && message.clientRequestId) {
      // A lost HTTP response is not permission to create a new attempt or replay the original request.
      await sendWorkspaceBridgeMessage(bridge, conversationId, message.content, message.clientRequestId,
        message.retryOfMessageId ?? undefined, message.replyToMessageId ?? undefined).catch(() => undefined);
      return;
    }
    // A persisted supplement must never retry the original business request.
    if (message.interactionEventId || message.replyToMessageId || message.responseKind ||
        selectedWorkspaceBridgeConversationMode === "history") return;
    const originalRequest = message.initiatedBy === "human"
      ? message
      : workspaceBridgeMessages.find((candidate) => candidate.id === message.replyToMessageId);
    if (!originalRequest) return;
    const originalAttempt = originalRequest.retryOfMessageId
      ? workspaceBridgeMessages.find((candidate) => candidate.id === originalRequest.retryOfMessageId) ?? originalRequest
      : originalRequest;
    // 每次点击都创建新的不可变尝试；已持久化的原请求由服务端复制正文并建立关联。
    const clientRequestId = workspaceBridgeClientRequestId();
    const retryOfMessageId = originalAttempt.id.startsWith("optimistic:") ? undefined : originalAttempt.id;
    setWorkspaceBridgeRetryingMessageIds((current) => new Set(current).add(message.id));
    try {
      await sendWorkspaceBridgeMessage(
        bridge,
        conversationId,
        originalAttempt.content,
        clientRequestId,
        retryOfMessageId
      );
    } catch {
      // 对应消息已切换为失败态，保留在原位置供用户再次重试。
    } finally {
      setWorkspaceBridgeRetryingMessageIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    }
  }

  async function selectWorkspaceBridgeConversation(bridge: WorkspaceBridgeRecord, conversation: WorkspaceBridgeConversationRecord) {
    if (!snapshot.currentServer) return;
    setSelectedWorkspaceBridgeConversationId(conversation.id);
    setWorkspaceBridgeConversationMenuOpen(false);
    setWorkspaceBridgeMessages([]);
    setWorkspaceBridgeMessagePageInfo(null);
    setWorkspaceBridgeMessagesLoading(true);
    setWorkspaceBridgeMessagesError("");
    workspaceBridgeScrollModeRef.current = "latest";
    try {
      const page = await fetchWorkspaceBridgeMessagesPage(snapshot.currentServer.id, bridge.id, {
        conversationId: conversation.id
      });
      setWorkspaceBridgeMessages((current) => mergeWorkspaceBridgeMessages(page.messages, current));
      setWorkspaceBridgeMessagePageInfo(page.pageInfo);
    } catch (error) {
      setWorkspaceBridgeMessagesError(workspaceBridgeRequestErrorMessage(error, "Bridge messages could not be loaded."));
      if (workspaceBridgeRequestNeedsWorkspaceRefresh(error)) {
        void onRefresh().catch(() => undefined);
      }
    } finally {
      setWorkspaceBridgeMessagesLoading(false);
    }
  }

  async function createWorkspaceBridgeConversation(bridge: WorkspaceBridgeRecord) {
    if (!snapshot.currentServer || bridge.status !== "active" || workspaceBridgeConversationBusy) return;
    setWorkspaceBridgeConversationBusy(true);
    setWorkspaceBridgeConversationError("");
    try {
      const data = await api<{ conversation: unknown }>(
        workspaceBridgeConversationPath(snapshot.currentServer.id, bridge.id),
        { method: "POST", body: "{}" }
      );
      const conversation = workspaceBridgeConversationToRecord({
        ...(data.conversation as Record<string, unknown>),
        sourceWorkspaceId: snapshot.currentServer.id,
        targetWorkspaceId: bridge.peerWorkspace?.id ?? "",
        direction: "outgoing",
        writable: true
      });
      setWorkspaceBridgeConversations((current) => [
        conversation,
        ...current
          .filter((item) => item.id !== conversation.id)
          .map((item) => item.status === "active"
            ? { ...item, status: "closed" as const, closedAt: item.closedAt ?? new Date().toISOString() }
            : item)
      ]);
      setWorkspaceBridgeConversationMenuView("active");
      setWorkspaceBridgeMessages([]);
      setWorkspaceBridgeMessagePageInfo(null);
      setSelectedWorkspaceBridgeConversationId(conversation.id);
      setWorkspaceBridgeConversationMenuOpen(false);
      workspaceBridgeScrollModeRef.current = "latest";
    } catch (error) {
      setWorkspaceBridgeConversationError(workspaceBridgeRequestErrorMessage(error, "A new conversation could not be started."));
    } finally {
      setWorkspaceBridgeConversationBusy(false);
    }
  }

  async function renameWorkspaceBridgeConversation(bridge: WorkspaceBridgeRecord, conversation: WorkspaceBridgeConversationRecord, title: string) {
    if (!snapshot.currentServer || !conversation.writable) return;
    const data = await api<{ conversation: unknown }>(
      workspaceBridgeConversationPath(snapshot.currentServer.id, bridge.id, conversation.id),
      { method: "PATCH", body: JSON.stringify({ title }) }
    );
    const renamed = publicConversationToRecord(data.conversation);
    setWorkspaceBridgeConversations((current) => current.map((item) => item.id === renamed.id ? { ...item, ...renamed } : item));
  }

  async function archiveWorkspaceBridgeConversation(bridge: WorkspaceBridgeRecord, conversation: WorkspaceBridgeConversationRecord) {
    if (!snapshot.currentServer || !conversation.writable || !canArchiveConversation(conversation) || workspaceBridgeConversationBusy) return;
    setWorkspaceBridgeConversationBusy(true);
    setWorkspaceBridgeConversationError("");
    try {
      const data = await api<{ conversation: unknown; replacementConversation?: unknown }>(
        `${workspaceBridgeConversationPath(snapshot.currentServer.id, bridge.id, conversation.id)}/archive`,
        { method: "POST", body: "{}" }
      );
      const archived = { ...conversation, ...publicConversationToRecord(data.conversation) };
      const replacement = data.replacementConversation ? workspaceBridgeConversationToRecord({
        ...(data.replacementConversation as Record<string, unknown>),
        sourceWorkspaceId: conversation.sourceWorkspaceId,
        targetWorkspaceId: conversation.targetWorkspaceId,
        direction: "outgoing",
        writable: true
      }) : undefined;
      setWorkspaceBridgeConversations((current) => [
        ...(replacement ? [replacement] : []),
        archived,
        ...current.filter((item) => item.id !== archived.id && item.id !== replacement?.id)
      ]);
      if (selectedWorkspaceBridgeConversation?.id === archived.id && replacement) {
        setSelectedWorkspaceBridgeConversationId(replacement.id);
        setWorkspaceBridgeMessages([]);
        setWorkspaceBridgeMessagePageInfo(null);
      }
      setWorkspaceBridgeConversationMenuView("active");
    } catch (error) {
      setWorkspaceBridgeConversationError(workspaceBridgeRequestErrorMessage(error, "Conversation could not be archived."));
    } finally {
      setWorkspaceBridgeConversationBusy(false);
    }
  }

  async function restoreWorkspaceBridgeConversation(bridge: WorkspaceBridgeRecord, conversation: WorkspaceBridgeConversationRecord) {
    if (!snapshot.currentServer || !conversation.writable || !conversation.archivedAt || workspaceBridgeConversationBusy) return;
    setWorkspaceBridgeConversationBusy(true);
    setWorkspaceBridgeConversationError("");
    try {
      const data = await api<{ conversation: unknown }>(
        `${workspaceBridgeConversationPath(snapshot.currentServer.id, bridge.id, conversation.id)}/unarchive`,
        { method: "POST", body: "{}" }
      );
      const restored = publicConversationToRecord(data.conversation);
      setWorkspaceBridgeConversations((current) => current.map((item) => item.id === restored.id ? { ...item, ...restored } : item));
    } catch (error) {
      setWorkspaceBridgeConversationError(workspaceBridgeRequestErrorMessage(error, "Conversation could not be restored."));
    } finally {
      setWorkspaceBridgeConversationBusy(false);
    }
  }

  async function deleteWorkspaceBridgeConversation(bridge: WorkspaceBridgeRecord, conversation: WorkspaceBridgeConversationRecord) {
    if (!snapshot.currentServer || !conversation.writable || !canPermanentlyDeleteConversation(conversation) || workspaceBridgeConversationBusy) return;
    const confirmed = await confirmDialog({
      title: "Delete bridge conversation permanently?",
      description: "This permanently deletes this Bridge conversation and its messages. This cannot be undone.",
      confirmText: "Delete permanently",
      tone: "danger"
    });
    if (!confirmed) return;
    setWorkspaceBridgeConversationBusy(true);
    setWorkspaceBridgeConversationError("");
    try {
      await api(workspaceBridgeConversationPath(snapshot.currentServer.id, bridge.id, conversation.id), { method: "DELETE" });
      setWorkspaceBridgeConversations((current) => current.filter((item) => item.id !== conversation.id));
      if (selectedWorkspaceBridgeConversation?.id === conversation.id && activeWorkspaceBridgeConversation) {
        await selectWorkspaceBridgeConversation(bridge, activeWorkspaceBridgeConversation);
      }
    } catch (error) {
      setWorkspaceBridgeConversationError(workspaceBridgeRequestErrorMessage(error, "Conversation could not be deleted."));
    } finally {
      setWorkspaceBridgeConversationBusy(false);
    }
  }

  function workspacePath(path: string, style: WorkspaceUiStyle = uiStyle): string {
    return pathWithUiStyle(path, style);
  }

  function requestLogout() {
    if (snapshot.currentUser.passwordSetupRequired) {
      setSidebarLogoutOpen(false);
      setMobileNavOpen(false);
      navigate(workspacePath(settingsPath("security")));
      return;
    }
    setSidebarLogoutOpen(true);
  }

  function openAgentModal(machineId?: string) {
    setAgentModalMachineId(machineId);
    setAgentModal(true);
  }

  function closeAgentModal() {
    setAgentModal(false);
    setAgentModalMachineId(undefined);
  }

  function topologyPathForInspectTarget(target: TopologyInspectTarget): string {
    if (target.kind === "server") return `/topology/workspaces/${encodeURIComponent(target.id)}`;
    if (target.kind === "machine") return `/topology/computers/${encodeURIComponent(target.id)}`;
    if (target.kind === "agent") return `/topology/agents/${encodeURIComponent(target.id)}`;
    if (target.kind === "human") return `/topology/humans/${encodeURIComponent(target.id)}`;
    if (target.kind === "channel") return `/topology/channels/${encodeURIComponent(target.id)}`;
    return `/topology/devices/${encodeURIComponent(target.id)}`;
  }

  const topologyContextMenuController = useMemo<TopologyContextMenuController>(() => ({
    open: (event, target) => {
      event.preventDefault();
      event.stopPropagation();
      setTopologyContextMenuNotice("");
      const actions = topologyContextActionsForTarget({ target, snapshot });
      if (actions.length === 0) {
        setTopologyContextMenu(null);
        return;
      }
      const menuHeight = Math.min(420, actions.length * 34 + 12);
      const position = clampContextMenuPosition({
        x: event.clientX,
        y: event.clientY,
        menuWidth: 250,
        menuHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        padding: 8
      });
      setTopologyContextMenu({ ...position, target, actions });
    }
  }), [snapshot]);

  const topbarProps: WorkspaceTopBarProps = {
    currentUser: snapshot.currentUser,
    unreadCount: Object.values(snapshot.unreadCounts ?? {}).reduce((sum, count) => sum + count, 0),
    pendingApprovalCount: pendingRuntimeApprovals.length,
    activeUtility: view === "search" || view === "inbox" || view === "saved" ? view : null,
    onOpenSearch: () => navigate(workspacePath("/chat/search")),
    onOpenInbox: () => navigate(workspacePath("/chat/inbox")),
    onOpenSaved: () => navigate(workspacePath("/chat/saved")),
    onOpenApprovals: () => {
      setPendingApprovalsAgentId(null);
      setPendingApprovalsOpen(true);
    },
    onOpenProfile: () => navigate(workspacePath(settingsPath("profile"))),
    onLogoutRequest: requestLogout,
    onOpenMobileNav: () => setMobileNavOpen(true),
    mobileNavOpen
  };

  useEffect(() => {
    if (routeState.legacyRedirectPath) {
      navigate(workspacePath(routeState.legacyRedirectPath), { replace: true });
      return;
    }
    if (location.pathname === "/chat") {
      navigate(workspacePath(defaultChannel ? chatPathForChannel(defaultChannel) : "/topology"), { replace: true });
      return;
    }
    // 导航数据完整加载后才能判定 DM 不存在；冷启动时的空列表不代表深链无效。
    if (topologyLoadStatus === "ready" && (location.pathname.startsWith("/chat/channels/") || location.pathname.startsWith("/chat/dms/")) && routeState.selectedChannelId && !snapshot.channels.some((channel) => channel.id === routeState.selectedChannelId)) {
      navigate(workspacePath(defaultChannel ? chatPathForChannel(defaultChannel) : "/chat"), { replace: true });
      return;
    }
    if (location.pathname.startsWith("/chat/threads/") && shouldRedirectMissingMessageThread({
      threadChannelId: routeState.threadChannelId,
      threadResolved: Boolean(routeThread),
      loadState: routeState.threadChannelId ? messageThreadRouteLoadStates[routeState.threadChannelId] : undefined
    })) {
      navigate(workspacePath(defaultChannel ? chatPathForChannel(defaultChannel) : "/chat"), { replace: true });
      return;
    }
    if (location.pathname.startsWith("/topology/workspaces/") && routeState.selectedServerId && routeState.selectedServerId !== snapshot.currentServer?.id) {
      navigate(workspacePath("/topology"), { replace: true });
      return;
    }
    if (location.pathname.startsWith("/topology/agents/") && routeState.selectedAgentId && !topologyInspectTargetAvailable(snapshot, { kind: "agent", id: routeState.selectedAgentId })) {
      navigate(workspacePath("/topology"), { replace: true });
      return;
    }
    if (location.pathname.startsWith("/topology/humans/")) {
      // Human collaboration is retained only as backend compatibility data and cannot be reopened through stale Topology URLs.
      navigate(workspacePath("/topology"), { replace: true });
      return;
    }
    if (location.pathname.startsWith("/topology/computers/") && routeState.selectedMachineId && !topologyInspectTargetAvailable(snapshot, { kind: "machine", id: routeState.selectedMachineId })) {
      navigate(workspacePath("/topology"), { replace: true });
      return;
    }
    if (location.pathname.startsWith("/topology/devices/") && routeState.selectedDeviceId && !topologyInspectTargetAvailable(snapshot, { kind: "device", id: routeState.selectedDeviceId })) {
      navigate(workspacePath("/topology"), { replace: true });
      return;
    }
    if (location.pathname.startsWith("/topology/channels/") && routeState.selectedChannelId && !snapshot.channels.some((channel) => channel.id === routeState.selectedChannelId && channel.type === "channel")) {
      navigate(workspacePath("/topology"), { replace: true });
      return;
    }
    if (location.pathname === "/settings" || location.pathname !== settingsPath(routeState.settingsTab) && location.pathname.startsWith("/settings/")) {
      navigate(workspacePath(settingsPath(routeState.settingsTab)), { replace: true });
    }
  }, [
    defaultChannel?.id,
    location.pathname,
    navigate,
    routeState.legacyRedirectPath,
    routeState.selectedAgentId,
    routeState.selectedChannelId,
    routeState.selectedHumanId,
    routeState.selectedMachineId,
    routeState.selectedDeviceId,
    routeState.selectedServerId,
    routeState.settingsTab,
    routeState.threadChannelId,
    routeThread?.id,
    messageThreadRouteLoadStates,
    snapshot.channels,
    snapshot.currentServer?.id,
    snapshot.currentUser.id,
    snapshot.devices,
    snapshot.agents,
    snapshot.machines,
    snapshot.peerWorkspaceTopologies,
    topologyLoadStatus,
    uiStyle
  ]);

  function channelPath(channelId: string, messageId?: string, conversationId?: string): string {
    const channel = routedSnapshot.channels.find((item) => item.id === channelId);
    if (channel?.type === "thread") {
      return chatPathForChannel(channel, messageId, conversationId);
    }
    if (channel) return chatPathForChannel(channel, messageId, conversationId);
    const search = messageId ? `?message=${encodeURIComponent(messageId)}` : "";
    return `/chat/channels/${encodeURIComponent(channelId)}${search}`;
  }

  function retryMessageThreadRoute(threadChannelId = routeState.threadChannelId) {
    if (!threadChannelId) return;
    setMessageThreadContextsByRouteId((current) => {
      if (!current[threadChannelId]) return current;
      const next = { ...current };
      delete next[threadChannelId];
      return next;
    });
    setMessageThreadRouteLoadStates((current) => {
      if (!(threadChannelId in current)) return current;
      const next = { ...current };
      delete next[threadChannelId];
      return next;
    });
    setMessageThreadRouteError("");
    setMessageThreadRouteRequestVersion((current) => current + 1);
  }

  function openMessageThreadRoute(threadChannelId: string, conversationId?: string) {
    const target = workspacePath(chatPathForChannel({ id: threadChannelId, type: "thread" }, undefined, conversationId));
    if (`${location.pathname}${location.search}` === target) {
      if (!routeThreadContext) retryMessageThreadRoute(threadChannelId);
      return;
    }
    navigate(target);
  }

  function openAgentPendingApprovals(agentId: string) {
    setPendingApprovalsAgentId(agentId);
    setPendingApprovalsOpen(true);
  }

  async function resolvePendingApproval(approvalId: string, decision: "approve" | "reject") {
    await api(`/api/runtime-approvals/${approvalId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision })
    }).finally(() => onRefresh());
  }

  function approvalExecutionPath(approval: RuntimeApprovalRecord): string | null {
    const execution = approval.executionId ? snapshot.runtimeExecutions.find((item) => item.id === approval.executionId) : undefined;
    const candidateMessageIds = [execution?.rootMessageId, approval.messageId, execution?.messageId].filter(Boolean) as string[];
    for (const messageId of candidateMessageIds) {
      const message = snapshot.messages.find((item) => item.id === messageId);
      if (message) return channelPath(message.channelId, message.id);
    }
    const threadChannelId = approval.threadChannelId ?? execution?.threadChannelId;
    if (threadChannelId) {
      const thread = snapshot.channels.find((item) => item.id === threadChannelId);
      if (thread?.type === "thread") return channelPath(thread.id);
      if (thread?.parentChannelId && thread.parentMessageId) return channelPath(thread.parentChannelId, thread.parentMessageId);
    }
    return null;
  }

  function openPendingApprovalExecution(approval: RuntimeApprovalRecord) {
    const path = approvalExecutionPath(approval);
    if (!path) return;
    setPendingApprovalsOpen(false);
    navigate(workspacePath(path));
  }

  function navigateView(nextView: View) {
    if (nextView === "topology") selectTopologyHome();
    else if (nextView === "workspace") navigate(workspacePath("/workspace"));
    else if (nextView === "search") navigate(workspacePath("/chat/search"));
    else if (nextView === "inbox") navigate(workspacePath("/chat/inbox"));
    else if (nextView === "saved") navigate(workspacePath("/chat/saved"));
    else if (nextView === "settings") navigate(workspacePath(settingsPath("profile")));
    else if (nextView === "invitations") navigate(workspacePath("/invitations"));
    else if (nextView === "devices") navigate(workspacePath("/devices"));
    else navigate(workspacePath(`/${nextView}`));
  }

  useEffect(() => {
    function openSearchFromKeyboard(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      // 输入、编辑和弹窗场景保留原生快捷键，避免打断用户当前操作。
      if (target?.closest("input, textarea, select, [contenteditable='true']") || document.querySelector("[role='dialog']")) return;
      event.preventDefault();
      navigate(pathWithUiStyle("/chat/search", uiStyle));
    }
    window.addEventListener("keydown", openSearchFromKeyboard);
    return () => window.removeEventListener("keydown", openSearchFromKeyboard);
  }, [navigate, uiStyle]);

  function selectTopologyHome() {
    // GRID 代表无具体对象的拓扑总览，因此要同时清除详情目标、临时动作和展开状态。
    setTopologyInspectTarget(null);
    setTopologyInspectorIntent(null);
    setTopologyInspectorOpen(false);
    setMobileNavOpen(false);
    if (location.pathname !== "/topology") navigate(workspacePath("/topology"));
  }

  function inspectTopologyTarget(target: TopologyInspectTarget) {
    setTopologyInspectTarget(target);
    setMobileNavOpen(false);
    setTopologyInspectorOpen(true);
    const nextPath = topologyPathForInspectTarget(target);
    // 拓扑检查目标写入 URL，避免侧栏高亮、右侧详情和浏览器路由各自保留一份状态。
    if (location.pathname !== nextPath) navigate(workspacePath(nextPath));
  }

  async function openAgentDm(agentId: string, agent?: AgentRecord) {
    setAgentDmError("");
    try {
      const result = await openAgentDmNavigation({
        agentId,
        agent,
        agents: snapshot.agents,
        channels: snapshot.channels,
        api,
        refresh: onRefresh,
        navigate,
        workspacePath
      });
      if (result.status === "not_found") setAgentDmError("Agent is no longer available.");
    } catch (err) {
      setAgentDmError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openTopologyExecution(executionId: string) {
    setTopologyExecutionError("");
    try {
      const target = await api<TopologyExecutionOpenTarget>(
        `/api/topology/live-work/executions/${encodeURIComponent(executionId)}/target`,
        { label: "Topology execution target" }
      );
      if (target.kind === "conversation") {
        const path = topologyExecutionConversationPath(target);
        if (path) navigate(workspacePath(path));
        return;
      }
      const bridge = topologyExecutionBridge(snapshot, target.bridgeId);
      if (!bridge) throw new Error("Workspace Bridge is no longer available.");
      setSelectedWorkspaceBridge(bridge);
    } catch (error) {
      setTopologyExecutionError(error instanceof Error ? error.message : "Execution is no longer available.");
    }
  }

  function inspectTopologyNodeWithIntent(node: TopologyGraphNode | undefined, intent?: TopologyInspectorIntent) {
    if (!node) return;
    if (node.row) {
      const action = topologyNodeAction("canvas", node.row);
      if (action.type === "inspect") inspectTopologyTarget(action.target);
      else if (action.type === "chat") navigate(workspacePath(action.path));
      else if (action.type === "agent-dm") void openAgentDm(action.agentId);
    } else if (node.kind === "server") {
      inspectTopologyTarget({ kind: "server", id: snapshot.currentServer?.id ?? "current" });
    }
    if (intent) setTopologyInspectorIntent(intent);
  }

  async function executeShellTopologyContextAction(action: TopologyContextMenuAction) {
    const menu = topologyContextMenu;
    if (!menu || action.disabledReason) return;
    setTopologyContextMenu(null);
    const target = menu.target;
    const node = target.kind === "node" ? target.node : undefined;
    const row = node?.row;

    if (action.id === "refresh-topology") {
      await onRefresh();
      return;
    }
    if (action.id === "connect-computer") {
      setMachineOnboarding(null);
      setComputerModal(true);
      return;
    }
    if (action.id === "create-agent") {
      openAgentModal(row?.kind === "machine" ? row.machine.id : undefined);
      return;
    }
    if (action.id === "inspect") {
      inspectTopologyNodeWithIntent(node);
      return;
    }

    if (row?.kind === "machine") {
      await executeShellMachineContextAction(action.id, row.machine);
      return;
    }
    if (row?.kind === "agent") {
      await executeShellAgentContextAction(action.id, row.agent, node);
      return;
    }
    if (row?.kind === "human") {
      await executeShellHumanContextAction(action.id, row.human, node);
      return;
    }
    if (row?.kind === "device") {
      await executeShellDeviceContextAction(action.id, row.device, node);
    }
  }

  async function executeShellMachineContextAction(actionId: TopologyContextMenuActionId, machine: MachineRecord) {
    if (actionId === "start-all-agents" || actionId === "stop-all-agents" || actionId === "restart-all-agents") {
      const operation = actionId === "start-all-agents" ? "start-all" : actionId === "stop-all-agents" ? "stop-all" : "restart-all";
      await api(`/api/machines/${encodeURIComponent(machine.id)}/${operation}`, { method: "POST", body: "{}" });
      await onRefresh();
      return;
    }
    if (actionId === "copy-connect-command") {
      const command = await api<MachineConnectCommand>(`/api/machines/${encodeURIComponent(machine.id)}/connect-command`);
      const commandText = connectCommandPresentation(command, import.meta.env.DEV, currentConnectPlatform(), "INSTALL").command;
      if (commandText) await copyMessageText(commandText);
      return;
    }
    if (actionId === "reset-all-agents") {
      if (!(await confirmDialog({
        title: `Reset all agents on ${machine.name}?`,
        description: "This restarts their runtime sessions.",
        confirmText: "Reset all agents",
        tone: "danger"
      }))) return;
      await api(`/api/machines/${encodeURIComponent(machine.id)}/reset-all`, { method: "POST", body: JSON.stringify({ mode: "restart" }) });
      await onRefresh();
      return;
    }
    if (actionId === "delete-computer") {
      const agents = snapshot.agents.filter((agent) => agent.machineId === machine.id);
      if (agents.length > 0) {
        // Computer 删除前要求先移除 Agent，避免侧栏右键绕过关系图里的资源保护提示。
        setTopologyContextMenuNotice("Remove agents before deleting this Device.");
        return;
      }
      if (!(await confirmDialog({
        title: `Delete device ${machine.name}?`,
        description: "Existing chat history stays.",
        confirmText: "Delete device",
        tone: "danger"
      }))) return;
      await api(`/api/machines/${encodeURIComponent(machine.id)}`, { method: "DELETE" });
      await onRefresh();
    }
  }

  async function executeShellAgentContextAction(actionId: TopologyContextMenuActionId, agent: AgentRecord, node: TopologyGraphNode | undefined) {
    if (actionId === "message-agent") {
      await openAgentDm(agent.id, agent);
      return;
    }
    if (actionId === "start-agent" || actionId === "stop-agent" || actionId === "restart-agent") {
      const operation = actionId === "start-agent" ? "start" : actionId === "stop-agent" ? "stop" : "restart";
      await api(`/api/agents/${encodeURIComponent(agent.id)}/${operation}`, { method: "POST", body: "{}" });
      await onRefresh();
      return;
    }
    if (actionId === "view-agent-activity") {
      inspectTopologyNodeWithIntent(node, { key: Date.now(), kind: "agent", id: agent.id, action: "activity" });
      return;
    }
    if (actionId === "open-agent-workspace") {
      inspectTopologyNodeWithIntent(node, { key: Date.now(), kind: "agent", id: agent.id, action: "workspace" });
      return;
    }
    if (actionId === "reset-agent") {
      if (!(await confirmDialog({
        title: `Reset ${agent.displayName}?`,
        description: "This clears the saved runtime session and starts fresh.",
        confirmText: "Reset session",
        tone: "danger"
      }))) return;
      await api(`/api/agents/${encodeURIComponent(agent.id)}/reset`, { method: "POST", body: JSON.stringify({ mode: "restart" }) });
      await onRefresh();
      return;
    }
    if (actionId === "delete-agent") {
      if (!(await confirmDialog({
        title: `Delete ${agent.displayName}?`,
        description: "Existing chat history stays.",
        confirmText: "Delete agent",
        tone: "danger"
      }))) return;
      await api(`/api/agents/${encodeURIComponent(agent.id)}`, { method: "DELETE" });
      await onRefresh();
    }
  }

  async function executeShellHumanContextAction(actionId: TopologyContextMenuActionId, human: UserRecord, node: TopologyGraphNode | undefined) {
    if (actionId === "copy-human-email") {
      if (human.email) await copyMessageText(human.email);
      return;
    }
    if (actionId === "view-human-resource-access") {
      inspectTopologyNodeWithIntent(node, { key: Date.now(), kind: "human", id: human.id, action: "resource-access" });
      return;
    }
    if (actionId === "remove-human") {
      if (!(await confirmDialog({
        title: `Remove ${human.displayName} from this workspace?`,
        description: "Their account will not be deleted.",
        confirmText: "Remove member",
        tone: "danger"
      }))) return;
      await api(`/api/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(human.id)}`, { method: "DELETE" });
      await onRefresh();
    }
  }

  async function executeShellDeviceContextAction(actionId: TopologyContextMenuActionId, device: NonNullable<AppSnapshot["devices"]>[number], node: TopologyGraphNode | undefined) {
    if (actionId === "open-pinned-agent-dm") {
      const grant = (snapshot.deviceGrants ?? []).find((item) => item.deviceId === device.id && item.status === "active");
      const agent = grant ? snapshot.agents.find((item) => item.id === grant.agentId) : undefined;
      if (agent) await openAgentDm(agent.id, agent);
      return;
    }
    if (actionId === "view-device-grants") {
      inspectTopologyNodeWithIntent(node, { key: Date.now(), kind: "device", id: device.id, action: "grants" });
      return;
    }
    if (actionId === "delete-device") {
      if (!(await confirmDialog({
        title: `Delete mobile device ${device.displayName}?`,
        confirmText: "Delete mobile device",
        tone: "danger"
      }))) return;
      await api(`/api/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
      await onRefresh();
    }
  }

  async function logoutFromSidebar() {
    setSidebarLogoutBusy(true);
    try {
      // 侧栏登出复用服务端 session 注销，避免只清本地状态造成 refresh token 残留。
      await api<{ ok: true }>("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken: getRefreshToken() ?? "" })
      });
    } finally {
      setSidebarLogoutBusy(false);
      onLoggedOut();
    }
  }

  return (
    <div className={mobileNavOpen ? "shell mobile-nav-open" : "shell"}>
      <SidePanel
        view={view}
        snapshot={snapshot}
        workspaceSummary={workspaceSummary}
        topologyLoadStatus={topologyLoadStatus}
        pageDataLoaded={pageDataLoaded}
        servers={servers}
        topologyContextMenuController={topologyContextMenuController}
        selectedAgentId={selectedTopologyAgentId}
        selectedMachineId={selectedTopologyMachineId}
        selectedDeviceId={selectedTopologyDeviceId}
        selectedChannelId={view === "topology" || view === "workspace" ? "" : selectedChannelId}
        channelMemberIndex={channelMemberIndex}
        onSelectTopologyHome={selectTopologyHome}
        onSelectWorkspaceView={() => navigate(workspacePath("/workspace"))}
        onSelectAgent={(id) => {
          inspectTopologyTarget({ kind: "agent", id });
        }}
        onSelectMachine={(id) => {
          inspectTopologyTarget({ kind: "machine", id });
        }}
        onSelectDevice={(id) => {
          inspectTopologyTarget({ kind: "device", id });
        }}
        onSelectChannel={(id) => {
          navigate(workspacePath(channelPath(id)));
        }}
        onOpenInvitations={() => navigate(workspacePath("/invitations"))}
        onOpenDevices={() => navigate(workspacePath("/devices"))}
        onOpenProfile={() => navigate(workspacePath("/settings/profile"))}
        onLogoutRequest={requestLogout}
        onOpenAgentApprovals={openAgentPendingApprovals}
        onOpenAgentDm={openAgentDm}
        onRefresh={onRefresh}
        onActivateServer={switchServer}
        onAddComputer={() => {
          setMachineOnboarding(null);
          setComputerModal(true);
        }}
        onAddAgent={(machineId) => openAgentModal(machineId)}
      />
      <main className="main">
        {(error || agentDmError || topologyExecutionError) && <div className="error-strip">{error || agentDmError || topologyExecutionError}</div>}
        {snapshot.currentUser.passwordSetupRequired && (
          <div className="password-setup-strip">
            <span><KeyRound size={15} /> Set a password to sign in later.</span>
            <button className="btn small" type="button" onClick={() => navigate(workspacePath(settingsPath("security")))}>Set password</button>
          </div>
        )}
        {view === "chat" && <ChatView snapshot={routedSnapshot} selectedChannelId={selectedChannelId} focusMessageId={routeState.focusMessageId} approvalId={routeState.approvalId} routeConversationId={routeState.conversationId ?? routeThreadContext?.conversation?.id} threadChannelId={routeThread?.id ?? routeState.threadChannelId} threadRouteLoadState={routeState.threadChannelId ? messageThreadRouteLoadStates[routeState.threadChannelId] : undefined} threadRouteError={messageThreadRouteError} topbarProps={topbarProps} onRefresh={onRefresh} onCloseThread={() => navigate(workspacePath(channelPath(selectedChannelId, undefined, routeState.conversationId ?? routeThreadContext?.conversation?.id)))} onCloseApprovalDeepLink={() => {
          // 关闭执行面板只撤销审批定位，保留消息和 conversation，避免深链立即重新打开面板。
          const params = new URLSearchParams(location.search);
          params.delete("approval");
          navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "", hash: location.hash }, { replace: true });
        }} onRetryThread={() => retryMessageThreadRoute()} onOpenThread={openMessageThreadRoute} onViewMessageInChannel={(channelId, messageId, conversationId) => navigate(workspacePath(channelPath(channelId, messageId, conversationId)))} onOpenInbox={() => navigate(workspacePath("/chat/inbox"))} onOpenAgentDm={openAgentDm} onOpenDmChannel={(channelId) => navigate(workspacePath(channelPath(channelId)))} />}
        {view === "search" && <SearchView snapshot={snapshot} topbarProps={topbarProps} onSelectChannel={(id) => navigate(workspacePath(channelPath(id)))} onOpenAgentDm={openAgentDm} onSelectMessage={(channelId, messageId, conversationId) => navigate(workspacePath(channelPath(channelId, messageId, conversationId)))} />}
        {view === "inbox" && <InboxView
          snapshot={snapshot}
          topbarProps={topbarProps}
          onRefresh={onRefresh}
          onSelectItem={(channelId, messageId, conversationId) => navigate(workspacePath(channelPath(channelId, messageId, conversationId)))}
        />}
        {view === "saved" && <SavedView snapshot={snapshot} topbarProps={topbarProps} onRefresh={onRefresh} onSelectMessage={(channelId, messageId, conversationId) => navigate(workspacePath(channelPath(channelId, messageId, conversationId)))} />}
        {view === "devices" && <DevicesView snapshot={snapshot} topbarProps={topbarProps} devicePageInfo={devicePageInfo} deviceLoading={pageDataLoading.devices} onLoadMoreDevices={onLoadMoreDevices} onRefresh={onRefresh} />}
        {view === "topology" && <TopologyView
          snapshot={snapshot}
          liveWork={topologyLiveWork}
          topologyLoadStatus={topologyCanvasLoadStatus}
          topbarProps={topbarProps}
          channelMemberIndex={channelMemberIndex}
          inspectTarget={activeTopologyInspectTarget}
          topologyInspectorIntent={topologyInspectorIntent}
          onTopologyInspectorIntent={setTopologyInspectorIntent}
          inspectorOpen={topologyInspectorOpen}
          onInspectTarget={(target) => {
            inspectTopologyTarget(target);
          }}
          onCollapseInspector={selectTopologyHome}
          onRefresh={onRefresh}
          onCreateAgent={(machineId) => openAgentModal(machineId)}
          onConnectComputer={() => {
            setMachineOnboarding(null);
            setComputerModal(true);
          }}
          onOpenAgentDm={openAgentDm}
          onOpenDmChannel={(channelId) => navigate(workspacePath(channelPath(channelId)))}
          onOpenLiveExecution={(executionId) => void openTopologyExecution(executionId)}
          onOpenWorkspaceBridge={setSelectedWorkspaceBridge}
          onOpenWorkspaceView={() => navigate(workspacePath("/workspace"))}
        />}
        {view === "workspace" && (
          <Suspense fallback={<div className="workspace-spatial-lazy-loading" role="status">Loading spatial model…</div>}>
            <WorkspaceSpatialView
              snapshot={snapshot}
              liveWork={topologyLiveWork}
              topbarProps={topbarProps}
              channelMemberIndex={channelMemberIndex}
              onOpenTopology={selectTopologyHome}
              onRefresh={onRefresh}
              onCreateAgent={(machineId) => openAgentModal(machineId)}
              onConnectComputer={() => {
                setMachineOnboarding(null);
                setComputerModal(true);
              }}
              onOpenAgentDm={openAgentDm}
              onOpenWorkspaceBridge={setSelectedWorkspaceBridge}
              onOpenDmChannel={(channelId) => navigate(workspacePath(channelPath(channelId)))}
              onOpenLiveExecution={(executionId) => void openTopologyExecution(executionId)}
            />
          </Suspense>
        )}
        {view === "invitations" && <InvitationsPage
          snapshot={snapshot}
          topbarProps={topbarProps}
          workspaceBridges={snapshot.workspaceBridges ?? []}
          incomingWorkspaceBridges={snapshot.incomingWorkspaceBridges ?? []}
          onInviteWorkspace={onInviteWorkspace}
          onAcceptWorkspaceBridge={onAcceptWorkspaceBridge}
          onRevokeWorkspaceBridge={onRevokeWorkspaceBridge}
          onOpenWorkspaceBridge={setSelectedWorkspaceBridge}
          onRefresh={onRefresh}
        />}
        {view === "settings" && <SettingsView snapshot={snapshot} topbarProps={topbarProps} tab={routeState.settingsTab} onTabChange={(tab) => navigate(workspacePath(settingsPath(tab)))} onRefresh={onRefresh} onLoggedOut={onLoggedOut} />}
      </main>
      {activeSelectedWorkspaceBridge && (
        <Modal title="Bridge Details" onClose={() => {
          setSelectedWorkspaceBridge(null);
          setWorkspaceBridgeConversations([]);
          setSelectedWorkspaceBridgeConversationId("");
          setWorkspaceBridgeConversationMenuView("active");
          setWorkspaceBridgeConversationMenuOpen(false);
          setWorkspaceBridgeConversationBusy(false);
          setWorkspaceBridgeConversationError("");
          setWorkspaceBridgeMessages([]);
          setWorkspaceBridgeMessagePageInfo(null);
          setWorkspaceBridgeMessagesError("");
          setWorkspaceBridgeMessagesLoading(false);
          setWorkspaceBridgeEarlierMessagesLoading(false);
          setWorkspaceBridgeMessageDraft("");
          setWorkspaceBridgeRetryingMessageIds(new Set());
          setShowWorkspaceBridgeNewMessages(false);
        }} className="template-form-modal template-form-modal-lg workspace-bridge-details" backdropClassName="template-form-modal-backdrop" titleIcon={<Building2 size={18} />}>
          <div className="workspace-bridge-details-body">
            <div className="workspace-bridge-summary">
              <div className="workspace-bridge-title-block">
                <div className="workspace-bridge-title-row">
                  <b>{activeSelectedWorkspaceBridge.peerWorkspace?.name ?? "Peer workspace"}</b>
                  <span className={`workspace-bridge-status ${activeSelectedWorkspaceBridge.status}`}>
                    <i aria-hidden="true" />
                    {activeSelectedWorkspaceBridge.status}
                  </span>
                </div>
                <p>
                  <span>{workspaceBridgeDirectionLabel(activeSelectedWorkspaceBridge.direction)}</span>
                  <span className="workspace-bridge-meta-separator" aria-hidden="true">·</span>
                  <span>Last activity {activeSelectedWorkspaceBridge.lastActivityAt ? formatMessageTimestamp(activeSelectedWorkspaceBridge.lastActivityAt) : "none yet"}</span>
                  <span className="workspace-bridge-meta-separator workspace-bridge-connected-separator" aria-hidden="true">·</span>
                  <span className="workspace-bridge-connected-at">Connected {memberProfileDate(activeSelectedWorkspaceBridge.acceptedAt ?? activeSelectedWorkspaceBridge.createdAt)}</span>
                </p>
              </div>
              <details className="workspace-bridge-permissions">
                <summary aria-label={workspaceBridgePermissionSummary}>
                  <Shield size={13} aria-hidden="true" />
                  <span>{workspaceBridgePermissionSummary}</span>
                  <ChevronRight size={13} aria-hidden="true" />
                </summary>
                <div className="workspace-bridge-permissions-popover">
                  <strong>Bridge execution model</strong>
                  <ul>
                    <li>Sender identity stays with the source account</li>
                    <li>Execution capabilities match the destination account</li>
                    <li>Existing destination runtime behavior remains unchanged</li>
                  </ul>
                </div>
              </details>
            </div>
            <div className="workspace-bridge-conversation-bar">
              <div
                className="dm-conversation-switcher"
                onBlur={(event) => {
                  const nextFocus = event.relatedTarget;
                  if (!(nextFocus instanceof globalThis.Node) || !event.currentTarget.contains(nextFocus)) {
                    setWorkspaceBridgeConversationMenuOpen(false);
                  }
                }}
              >
                <span className="workspace-bridge-conversation-label">Conversation</span>
                <button
                  className="dm-conversation-trigger workspace-bridge-conversation-trigger"
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={workspaceBridgeConversationMenuOpen}
                  disabled={!selectedWorkspaceBridgeConversation}
                  onClick={() => setWorkspaceBridgeConversationMenuOpen((open) => !open)}
                >
                  <span>{selectedWorkspaceBridgeConversation
                    ? `${selectedWorkspaceBridgeConversation.direction === "incoming" ? "Incoming" : "Outgoing"} · ${selectedWorkspaceBridgeConversation.title}`
                    : "No conversation"}</span>
                  <ChevronDown size={13} />
                </button>
                {workspaceBridgeConversationMenuOpen && (
                  <div className="dm-conversation-menu workspace-bridge-conversation-menu" aria-label="Bridge conversations">
                    {workspaceBridgeConversationMenuView === "archived" && (
                      <div className="dm-conversation-menu-header">
                        <button type="button" aria-label="Back to conversations" onClick={() => setWorkspaceBridgeConversationMenuView("active")}>
                          <ChevronLeft size={16} />
                        </button>
                        <strong>Archived conversations</strong>
                      </div>
                    )}
                    <div className="dm-conversation-menu-list">
                      {workspaceBridgeConversationMenuView === "active" && currentWorkspaceBridgeConversations.length > 0 && (
                        <div className="dm-conversation-menu-section">
                          <p>Current</p>
                          {currentWorkspaceBridgeConversations.map((conversation) => (
                            <ConversationMenuOption
                              key={conversation.id}
                              conversation={conversation}
                              contextLabel={conversation.direction === "incoming" ? "Incoming" : "Outgoing"}
                              selected={conversation.id === selectedWorkspaceBridgeConversation?.id}
                              onSelect={() => void selectWorkspaceBridgeConversation(activeSelectedWorkspaceBridge, conversation)}
                              onRename={conversation.writable
                                ? (title) => renameWorkspaceBridgeConversation(activeSelectedWorkspaceBridge, conversation, title)
                                : undefined}
                              onArchive={activeSelectedWorkspaceBridge.status === "active" && conversation.writable
                                ? () => void archiveWorkspaceBridgeConversation(activeSelectedWorkspaceBridge, conversation)
                                : undefined}
                            />
                          ))}
                        </div>
                      )}
                      {workspaceBridgeConversationMenuView === "active" && recentWorkspaceBridgeConversations.length > 0 && (
                        <div className="dm-conversation-menu-section">
                          <p>Recent</p>
                          {recentWorkspaceBridgeConversations.map((conversation) => (
                            <ConversationMenuOption
                              key={conversation.id}
                              conversation={conversation}
                              contextLabel={conversation.direction === "incoming" ? "Incoming" : "Outgoing"}
                              selected={conversation.id === selectedWorkspaceBridgeConversation?.id}
                              onSelect={() => void selectWorkspaceBridgeConversation(activeSelectedWorkspaceBridge, conversation)}
                              onRename={conversation.writable
                                ? (title) => renameWorkspaceBridgeConversation(activeSelectedWorkspaceBridge, conversation, title)
                                : undefined}
                              onArchive={conversation.writable ? () => void archiveWorkspaceBridgeConversation(activeSelectedWorkspaceBridge, conversation) : undefined}
                            />
                          ))}
                        </div>
                      )}
                      {workspaceBridgeConversationMenuView === "archived" && visibleWorkspaceBridgeConversations.length > 0 && (
                        <div className="dm-conversation-menu-section">
                          <p>Archived</p>
                          {visibleWorkspaceBridgeConversations.map((conversation) => (
                            <ConversationMenuOption
                              key={conversation.id}
                              conversation={conversation}
                              contextLabel={conversation.direction === "incoming" ? "Incoming" : "Outgoing"}
                              selected={conversation.id === selectedWorkspaceBridgeConversation?.id}
                              onSelect={() => void selectWorkspaceBridgeConversation(activeSelectedWorkspaceBridge, conversation)}
                              onRename={conversation.writable
                                ? (title) => renameWorkspaceBridgeConversation(activeSelectedWorkspaceBridge, conversation, title)
                                : undefined}
                              onRestore={conversation.writable ? () => void restoreWorkspaceBridgeConversation(activeSelectedWorkspaceBridge, conversation) : undefined}
                              onDelete={conversation.writable ? () => void deleteWorkspaceBridgeConversation(activeSelectedWorkspaceBridge, conversation) : undefined}
                            />
                          ))}
                        </div>
                      )}
                      {visibleWorkspaceBridgeConversations.length === 0 && (
                        <div className="dm-conversation-menu-empty">
                          {workspaceBridgeConversationMenuView === "active" ? "No conversations yet." : "No archived conversations."}
                        </div>
                      )}
                    </div>
                    {workspaceBridgeConversationMenuView === "active" && (
                      <button className="dm-conversation-archive-link" type="button" onClick={() => setWorkspaceBridgeConversationMenuView("archived")}>
                        <Archive size={14} />
                        <span>Archived conversations</span>
                        <ChevronRight size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>
              {(selectedWorkspaceBridgeConversationMode === "history" || selectedWorkspaceBridgeConversationIncoming) && (
                <span className="workspace-bridge-history-label">
                  {selectedWorkspaceBridgeConversationIncoming ? "Incoming · visible to both sides" : "Read-only history"}
                </span>
              )}
              <button
                className="workspace-bridge-new-conversation"
                type="button"
                disabled={activeSelectedWorkspaceBridge.status !== "active" || workspaceBridgeConversationBusy}
                onClick={() => void createWorkspaceBridgeConversation(activeSelectedWorkspaceBridge)}
              >
                <Plus size={14} />
                <span>New</span>
              </button>
              {workspaceBridgeConversationError && <p className="workspace-bridge-conversation-error">{workspaceBridgeConversationError}</p>}
            </div>
            <div className="workspace-bridge-message-log-shell">
              <div className="workspace-bridge-message-log" ref={workspaceBridgeLogRef} onScroll={handleWorkspaceBridgeLogScroll}>
                {workspaceBridgeMessagePageInfo?.hasMoreBefore && (
                  <button
                    className="btn small workspace-bridge-load-earlier"
                    type="button"
                    disabled={workspaceBridgeEarlierMessagesLoading}
                    onClick={() => void loadEarlierWorkspaceBridgeMessages(activeSelectedWorkspaceBridge)}
                  >
                    {workspaceBridgeEarlierMessagesLoading ? "Loading" : "Load earlier"}
                  </button>
                )}
                {workspaceBridgeMessagesError && <p className="workspace-bridge-log-error">{workspaceBridgeMessagesError}</p>}
                {workspaceBridgeMessagesLoading && selectedWorkspaceBridgeMessages.length === 0 ? (
                  <div className="empty-action-state centered compact">
                    <MessageSquare size={24} />
                    <b>Loading bridge messages.</b>
                  </div>
                ) : selectedWorkspaceBridgeMessages.length === 0 ? (
                  <div className="empty-action-state centered compact">
                    <MessageSquare size={24} />
                    <b>No bridge messages yet.</b>
                    <p>Send a request to {peerWorkspaceBridgeAssistantLabel}.</p>
                  </div>
                ) : selectedWorkspaceBridgeMessages.map((message) => {
                  const tone = workspaceBridgeMessageTone(message, snapshot.currentServer?.id);
                  const outcomeLabel = workspaceBridgeOutcomeLabel(message);
                  const attributionLabel = workspaceBridgeResultAttribution(message);
                  // 服务端 pending 表示请求已经送达、Assistant 仍在处理；只有乐观消息仍显示 Sending。
                  const outcomeTone = message.outcome === "pending" && !message.id.startsWith("optimistic:")
                    ? "delivered"
                    : message.outcome;
                  return (
                    <article key={message.id} className={`workspace-bridge-message ${tone} ${message.outcome}`}>
                      <header>
                        <b>{workspaceBridgeMessageTitle(message, tone, {
                          localUserLabel: localWorkspaceBridgeUserLabel,
                          peerUserLabel: peerWorkspaceBridgeUserLabel,
                          localAssistantLabel: localWorkspaceBridgeAssistantLabel,
                          peerAssistantLabel: peerWorkspaceBridgeAssistantLabel,
                          localWorkspaceName: snapshot.currentServer?.name ?? "Current workspace",
                          peerWorkspaceName: activeSelectedWorkspaceBridge.peerWorkspace?.name ?? "Peer workspace"
                        })}</b>
                        <time dateTime={message.createdAt}>{formatMessageTimestamp(message.createdAt)}</time>
                      </header>
                      <p>{message.content}</p>
                      {!message.replyToMessageId && workspaceBridgeRequestStatuses[message.id] && (
                        <BridgeRequestProgress status={workspaceBridgeRequestStatuses[message.id]!} />
                      )}
                      {!message.replyToMessageId && !message.responseKind && !message.id.startsWith("optimistic:") &&
                        snapshot.currentServer?.role === "owner" && snapshot.currentServer.ownerId === snapshot.currentUser.id &&
                        message.targetWorkspaceId === snapshot.currentServer.id && message.targetCapabilityUserId === snapshot.currentUser.id && (
                        <BridgeLocalExecutionLog key={`${snapshot.currentServer.id}:${snapshot.currentUser.id}:${message.id}`}
                          serverId={snapshot.currentServer.id} bridgeId={activeSelectedWorkspaceBridge.id} requestId={message.id} />
                      )}
                      {attributionLabel && (
                        <div className="workspace-bridge-message-attribution">{attributionLabel}</div>
                      )}
                      {Boolean(message.attachments?.length) && (
                        <div className="workspace-bridge-message-attachments">
                          {message.attachments!.map((attachment) => (
                            <a
                              key={attachment.id}
                              href={authenticatedApiUrl(`/api/attachments/${encodeURIComponent(attachment.id)}`)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <FileText size={13} />
                              <span>{attachment.filename}</span>
                            </a>
                          ))}
                        </div>
                      )}
                      {outcomeLabel && (
                        <footer>
                          {message.retryOfMessageId && (
                            <span className="workspace-bridge-message-retry-label">Retry attempt</span>
                          )}
                          <span className={`workspace-bridge-message-status ${outcomeTone}`}>
                            {message.initiatedBy === "human" && outcomeLabel === "Delivered" && <Check size={11} />}
                            {outcomeLabel}
                          </span>
                          {message.outcome === "failed" && !message.interactionEventId &&
                            (message.id.startsWith("optimistic:") || (!message.replyToMessageId && !message.responseKind)) &&
                            selectedWorkspaceBridgeConversationMode !== "history" && selectedWorkspaceBridgeConversation?.writable && (
                            <button
                              className="workspace-bridge-message-retry"
                              type="button"
                              disabled={workspaceBridgeRetryingMessageIds.has(message.id)}
                              onClick={() => void retryWorkspaceBridgeMessage(activeSelectedWorkspaceBridge, message)}
                            >
                              <RefreshCw size={11} />
                              {workspaceBridgeRetryingMessageIds.has(message.id) ? "Retrying…" : "Try again"}
                            </button>
                          )}
                        </footer>
                      )}
                    </article>
                  );
                })}
                {workspaceBridgeStatusError && <p className="workspace-bridge-log-error" role="alert">{workspaceBridgeStatusError}</p>}
                {!workspaceBridgeStatusError && pendingWorkspaceBridgeRequests.length > 0 && (
                  <div className="workspace-bridge-working" role="status">
                    {!workspaceBridgeAttention && <span aria-hidden="true"><i /><i /><i /></span>}
                    <p>
                      {workspaceBridgeAttention
                        ? workspaceBridgeAttention.progress?.summary ?? "This Bridge request needs attention."
                        : workspaceBridgeReviewing
                          ? "Execution finished; TYR is reviewing the result."
                        : workspaceBridgeWaitingForApproval
                        ? "Waiting for approval in a connected workspace."
                        : workspaceBridgePeerRunning
                          ? `${workingWorkspaceBridgeAssistantLabel} is working on ${pendingWorkspaceBridgeRequests.length === 1 ? "the request" : `${pendingWorkspaceBridgeRequests.length} requests`}…`
                          : "Request delivered; waiting for a response…"}
                    </p>
                  </div>
                )}
              </div>
              {showWorkspaceBridgeNewMessages && (
                <button className="new-messages-button" type="button" aria-label="Jump to new bridge messages" onClick={scrollWorkspaceBridgeToLatest}>
                  <ChevronDown size={15} />
                  <span>New messages</span>
                </button>
              )}
            </div>
            <div className="workspace-bridge-composer">
              {(ownWorkspaceBridgeRequests.length > 0 || workspaceBridgeMessagePageInfo?.hasMoreBefore) && (
                <select className="input" aria-label="Reply to Bridge request" value={workspaceBridgeReplyTargetId}
                  onChange={(event) => setWorkspaceBridgeReplyTarget({
                    conversationId: selectedWorkspaceBridgeConversation!.id, requestId: event.target.value
                  })}>
                  <option value="" disabled>Choose the request to continue</option>
                  {ownWorkspaceBridgeRequests.map((request) => (
                    <option key={request.id} value={request.id}>{request.content.slice(0, 100)}</option>
                  ))}
                  <option value="new">Start an independent request</option>
                </select>
              )}
              <textarea
                className="input"
                value={workspaceBridgeMessageDraft}
                disabled={workspaceBridgeConversationBusy || workspaceBridgeMessagesLoading || !selectedWorkspaceBridgeConversation?.writable || selectedWorkspaceBridgeConversationMode === "history" || activeSelectedWorkspaceBridge.status !== "active"}
                onChange={(event) => setWorkspaceBridgeMessageDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey) return;
                  event.preventDefault();
                  void submitWorkspaceBridgeMessage(activeSelectedWorkspaceBridge);
                }}
                aria-label={`Message ${peerWorkspaceBridgeAssistantLabel}`}
                placeholder={selectedWorkspaceBridgeConversationIncoming
                  ? "Incoming Bridge conversations are read-only here"
                  : selectedWorkspaceBridgeConversationMode === "history"
                    ? "Conversation history is read-only"
                  : `Message ${peerWorkspaceBridgeAssistantLabel}`}
              />
              <button
                className="btn primary"
                disabled={workspaceBridgeConversationBusy || workspaceBridgeMessagesLoading || !workspaceBridgeReplyTargetId || !workspaceBridgeMessageDraft.trim() || !selectedWorkspaceBridgeConversation?.writable || selectedWorkspaceBridgeConversationMode === "history" || activeSelectedWorkspaceBridge.status !== "active"}
                onClick={() => void submitWorkspaceBridgeMessage(activeSelectedWorkspaceBridge)}
              >
                <Send size={16} />
                Send
              </button>
            </div>
          </div>
        </Modal>
      )}
      {mobileNavOpen && <button className="mobile-sidebar-backdrop" type="button" aria-label="Close workspace navigation" onClick={() => setMobileNavOpen(false)} />}
      {computerModal && <ConnectComputerModal onboarding={machineOnboarding} serverName={snapshot.currentServer?.name ?? snapshot.currentUser.displayName} onCreate={async (name) => {
        const data = await api<MachineOnboardingLink>("/api/machines/onboarding-intents", {
          method: "POST",
          body: JSON.stringify({ serverId, name })
        });
        setMachineOnboarding(data);
        await onRefresh();
        return data;
      }} onClose={() => setComputerModal(false)} />}
      {agentModal && <CreateAgentModal snapshot={agentModalMachineId && (snapshot.peerWorkspaceTopologies ?? []).some((peer) => peer.machines.some((machine) => machine.id === agentModalMachineId)) ? topologyOperationalSnapshot(snapshot) : snapshot} initialMachineId={agentModalMachineId} onRefresh={onRefresh} onClose={closeAgentModal} onCreated={async (agent) => {
        closeAgentModal();
        await openAgentDm(agent.id, agent);
      }} />}
      {pendingApprovalsOpen && (
        <PendingApprovalsModal
          snapshot={snapshot}
          agentId={pendingApprovalsAgentId}
          approvalExecutionPath={approvalExecutionPath}
          onClose={() => setPendingApprovalsOpen(false)}
          onOpenExecution={openPendingApprovalExecution}
          onResolve={resolvePendingApproval}
        />
      )}
      {topologyContextMenu && (
        <TopologyContextMenu
          refElement={topologyContextMenuRef}
          menu={topologyContextMenu}
          onAction={(action) => void executeShellTopologyContextAction(action)}
        />
      )}
      {topologyContextMenuNotice && <p className="topology-action-notice topology-action-notice-global" role="status">{topologyContextMenuNotice}</p>}
      {sidebarLogoutOpen && <LogoutModal busy={sidebarLogoutBusy} onClose={() => setSidebarLogoutOpen(false)} onConfirm={() => void logoutFromSidebar()} />}
    </div>
  );
}

function workspaceBridgeConversationPath(serverId: string, bridgeId: string, conversationId?: string): string {
  const base = `/api/servers/${encodeURIComponent(serverId)}/workspace-bridges/${encodeURIComponent(bridgeId)}/conversations`;
  return conversationId ? `${base}/${encodeURIComponent(conversationId)}` : base;
}

function workspaceBridgeRequestNeedsWorkspaceRefresh(error: unknown): boolean {
  return error instanceof ApiError && (
    error.code === "unauthorized" ||
    error.code === "workspace_not_found" ||
    error.code === "workspace_bridge_member_required"
  );
}

function workspaceBridgeRequestErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return apiErrorMessage(error, fallback);
  if (error.code === "stale_auth_context") return "";
  if (error.code === "unauthorized") {
    return "Your session changed. Sign in again to load this Bridge.";
  }
  if (error.code === "workspace_not_found" || error.code === "workspace_bridge_member_required") {
    return "This window is showing a workspace that is not available to the current account. Refresh to load your active workspace.";
  }
  if (error.code === "workspace_bridge_not_found") {
    return "This Workspace Bridge is no longer available. Refresh to see the current connections.";
  }
  if (error.code === "conversation_not_found") {
    return "This Bridge conversation is no longer available. Select another conversation.";
  }
  if (error.code === "workspace_bridge_request_completed") {
    return "This request has ended. Review its saved result, or explicitly start an independent request.";
  }
  if (error.code === "workspace_bridge_request_selection_required") {
    return "Choose the request to continue, or explicitly start an independent request.";
  }
  if (error.code === "network_error" || error.code === "api_timeout" || error.status >= 500) {
    return apiErrorMessage(error, fallback);
  }
  return fallback;
}

async function fetchWorkspaceBridgeConversations(serverId: string, bridgeId: string): Promise<{
  conversations: WorkspaceBridgeConversationRecord[];
  activeConversationId: string | null;
}> {
  const data = await api<{ conversations?: unknown[]; activeConversationId?: string | null }>(
    `${workspaceBridgeConversationPath(serverId, bridgeId)}?includeArchived=1`
  );
  return {
    conversations: Array.isArray(data.conversations) ? data.conversations.map(workspaceBridgeConversationToRecord) : [],
    activeConversationId: typeof data.activeConversationId === "string" ? data.activeConversationId : null
  };
}

function workspaceBridgeConversationToRecord(raw: any): WorkspaceBridgeConversationRecord {
  return {
    ...publicConversationToRecord(raw),
    sourceWorkspaceId: String(raw?.sourceWorkspaceId ?? ""),
    targetWorkspaceId: String(raw?.targetWorkspaceId ?? ""),
    direction: raw?.direction === "incoming" ? "incoming" : "outgoing",
    writable: raw?.direction !== "incoming" && raw?.writable !== false
  };
}

async function fetchWorkspaceBridgeMessagesPage(serverId: string, bridgeId: string, params: { limit?: number; before?: string | null; conversationId?: string } = {}): Promise<WorkspaceBridgeMessagesPayload> {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 30));
  if (params.before) query.set("before", params.before);
  if (params.conversationId) query.set("conversationId", params.conversationId);
  const data = await api<WorkspaceBridgeMessagesPayload>(`/api/servers/${encodeURIComponent(serverId)}/workspace-bridges/${encodeURIComponent(bridgeId)}/messages?${query.toString()}`);
  return {
    messages: Array.isArray(data.messages) ? data.messages : [],
    pageInfo: {
      limit: typeof data.pageInfo?.limit === "number" ? data.pageInfo.limit : 30,
      hasMoreBefore: Boolean(data.pageInfo?.hasMoreBefore),
      oldestCreatedAt: typeof data.pageInfo?.oldestCreatedAt === "string" ? data.pageInfo.oldestCreatedAt : null,
      newestCreatedAt: typeof data.pageInfo?.newestCreatedAt === "string" ? data.pageInfo.newestCreatedAt : null
    }
  };
}

function mergeWorkspaceBridgeMessages(...groups: CrossWorkspaceMessageRecord[][]): CrossWorkspaceMessageRecord[] {
  const byKey = new Map<string, CrossWorkspaceMessageRecord>();
  for (const group of groups) {
    for (const message of group) {
      const key = workspaceBridgeMessageClientKey(message) ?? message.id;
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, message);
        continue;
      }
      const currentOptimistic = current.id.startsWith("optimistic:");
      const incomingOptimistic = message.id.startsWith("optimistic:");
      if (!currentOptimistic && incomingOptimistic) continue;
      if (currentOptimistic && !incomingOptimistic) {
        byKey.set(key, message);
        continue;
      }
      // realtime 可能早于 HTTP 202 到达，迟到的 pending 确认不能把 delivered 状态倒退。
      if (current.outcome === "delivered" && message.outcome === "pending") continue;
      byKey.set(key, message);
    }
  }
  return [...byKey.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function workspaceBridgeMessageClientKey(message: CrossWorkspaceMessageRecord): string | null {
  return message.clientRequestId
    ? `${message.bridgeId}:${message.conversationId ?? ""}:${message.sourceWorkspaceId}:${message.clientRequestId}`
    : null;
}

function workspaceBridgeDirectionLabel(direction: WorkspaceBridgeRecord["direction"]): string {
  return direction === "bidirectional" ? "Two-way assistant bridge" : "One-way assistant bridge";
}

function workspaceBridgeOutcomeLabel(message: CrossWorkspaceMessageRecord): string | null {
  // Assistant 回复不显示投递回执；消息位置和参与方名称已经说明来源。
  if (message.initiatedBy === "agent" && message.outcome !== "failed") return null;
  if (message.initiatedBy === "human" && message.resolvedByTerminalId) return "Resolved by follow-up";
  if (message.outcome === "pending") return message.id.startsWith("optimistic:") ? "Sending…" : "Delivered";
  if (message.outcome === "failed") return message.initiatedBy === "human" ? "Failed" : "Response failed";
  return "Delivered";
}

function workspaceBridgeMessageTone(message: CrossWorkspaceMessageRecord, currentServerId?: string): "outbound" | "inbound" | "neutral" {
  if (currentServerId && message.sourceWorkspaceId === currentServerId) return "outbound";
  if (currentServerId && message.targetWorkspaceId === currentServerId) return "inbound";
  return message.initiatedBy === "human" ? "outbound" : "inbound";
}

function workspaceBridgeResultAttribution(message: CrossWorkspaceMessageRecord): string | null {
  if (message.initiatedBy !== "agent" || message.responseKind !== "final") return null;
  return "Reviewed by TYR";
}

function workspaceBridgeAssistantLabel(assistantName: string | null | undefined, workspaceName: string): string {
  return workspaceBridgeParticipantLabel(assistantName, workspaceName, "TYR");
}

function workspaceBridgeParticipantLabel(
  participantName: string | null | undefined,
  workspaceName: string,
  fallbackName = "User"
): string {
  return `${participantName?.trim() || fallbackName} · ${workspaceName}`;
}

function workspaceBridgeMessageTitle(message: CrossWorkspaceMessageRecord, tone: ReturnType<typeof workspaceBridgeMessageTone>, labels: {
  localUserLabel: string;
  peerUserLabel: string;
  localAssistantLabel: string;
  peerAssistantLabel: string;
  localWorkspaceName: string;
  peerWorkspaceName: string;
}): string {
  if (message.initiatedBy === "human") {
    const senderName = message.senderUserDisplayName ?? message.senderUserName;
    return senderName
      ? workspaceBridgeParticipantLabel(senderName, tone === "outbound" ? labels.localWorkspaceName : labels.peerWorkspaceName)
      : tone === "outbound" ? labels.localUserLabel : labels.peerUserLabel;
  }
  return tone === "inbound" ? labels.peerAssistantLabel : labels.localAssistantLabel;
}

function PendingApprovalsModal({
  snapshot,
  agentId,
  approvalExecutionPath,
  onClose,
  onOpenExecution,
  onResolve
}: {
  snapshot: AppSnapshot;
  agentId: string | null;
  approvalExecutionPath: (approval: RuntimeApprovalRecord) => string | null;
  onClose: () => void;
  onOpenExecution: (approval: RuntimeApprovalRecord) => void;
  onResolve: (approvalId: string, decision: "approve" | "reject") => Promise<void>;
}) {
  const [submittingApprovalId, setSubmittingApprovalId] = useState("");
  const [error, setError] = useState("");
  const agentsById = useMemo(() => new Map(snapshot.agents.map((agent) => [agent.id, agent])), [snapshot.agents]);
  const executionsById = useMemo<Map<string, RuntimeExecutionRecord>>(
    () => new Map(snapshot.runtimeExecutions.map((execution) => [execution.id, execution])),
    [snapshot.runtimeExecutions]
  );
  const pendingApprovals = useMemo(
    () => visibleRuntimeApprovals(snapshot.runtimeApprovals ?? [])
      .filter((approval) => approval.status === "pending")
      .filter((approval) => !agentId || approval.agentId === agentId),
    [agentId, snapshot.runtimeApprovals]
  );
  const governanceDecisions = useMemo(
    () => (snapshot.governanceDecisions ?? []).filter((decision) => !agentId || decision.agentId === agentId),
    [agentId, snapshot.governanceDecisions]
  );
  const governanceReview = useMemo(
    () => governanceApprovalReviewSummary({ approvals: pendingApprovals, decisions: governanceDecisions }),
    [governanceDecisions, pendingApprovals]
  );
  const reviewItemsByApprovalId = useMemo(
    () => new Map(governanceReview.items.map((item) => [item.approval.id, item])),
    [governanceReview]
  );
  const titleAgent = agentId ? agentsById.get(agentId)?.displayName ?? agentsById.get(agentId)?.name ?? "Agent" : null;
  const title = titleAgent ? `PENDING APPROVALS · ${titleAgent}` : `PENDING APPROVALS (${pendingApprovals.length})`;

  async function submitApproval(approval: RuntimeApprovalRecord, decision: "approve" | "reject") {
    if (approvalActionDisabled(approval, submittingApprovalId)) return;
    setSubmittingApprovalId(approval.id);
    setError("");
    try {
      await onResolve(approval.id, decision);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval update failed.");
    } finally {
      setSubmittingApprovalId("");
    }
  }

  return (
    <Modal title={title} onClose={onClose} className="template-form-modal template-form-modal-lg pending-approvals-modal" backdropClassName="template-form-modal-backdrop" titleIcon={<Shield size={18} />}>
      <div className="pending-approvals-list">
        {error && <div className="form-error">{error}</div>}
        {(governanceReview.pendingCount > 0 || governanceReview.blockedDecisionCount > 0 || governanceReview.requireHumanDecisionCount > 0) && (
          <section className="governance-approval-review" aria-label="Governance Review">
            <div className="governance-approval-review-head">
              <strong>Governance Review</strong>
              <span>{governanceReview.requireHumanDecisionCount} human review{governanceReview.requireHumanDecisionCount === 1 ? "" : "s"}</span>
            </div>
            <div className="governance-approval-review-metrics">
              <span><b>{governanceReview.pendingCount}</b> Pending approvals</span>
              <span><b>{governanceReview.outboundPendingCount}</b> Outbound queue</span>
              <span><b>{governanceReview.runtimePendingCount}</b> Runtime approval</span>
              <span><b>{governanceReview.blockedDecisionCount}</b> Blocked decisions</span>
            </div>
            {governanceReview.riskTypes.length > 0 && (
              <div className="governance-approval-review-risks">
                {governanceReview.riskTypes.slice(0, 6).map((riskType) => <span key={riskType}>{riskType}</span>)}
              </div>
            )}
            {governanceReview.blockedDecisions.length > 0 && (
              <div className="governance-approval-review-blocked">
                <b>Blocked decisions</b>
                {governanceReview.blockedDecisions.slice(0, 2).map((decision) => (
                  <small key={decision.id}>{decision.reason || decision.riskTypes.join(", ") || decision.decision}</small>
                ))}
              </div>
            )}
          </section>
        )}
        {pendingApprovals.length === 0 && <div className="member-empty pending-approvals-empty">No pending approvals.</div>}
        {pendingApprovals.map((approval) => {
          const agent = agentsById.get(approval.agentId);
          const execution = approval.executionId ? executionsById.get(approval.executionId) : undefined;
          const command = approval.detail || approval.title || "Approval requested";
          const runtime = approval.runtime ?? execution?.runtime;
          const executionPath = approvalExecutionPath(approval);
          const disabled = approvalActionDisabled(approval, submittingApprovalId);
          const reviewItem = reviewItemsByApprovalId.get(approval.id);
          return (
            <div key={approval.id} className="pending-approval-row">
              <div className="pending-approval-main">
                <div className="pending-approval-head">
                  <strong>{agent?.displayName ?? agent?.name ?? "Agent"}</strong>
                  <span>{runtime ? runtimeDisplayName(runtime) : "Runtime"}</span>
                </div>
                <code>{command}</code>
                {reviewItem && <small className="pending-approval-review-kind">{governanceApprovalReviewItemLabel(reviewItem)}</small>}
                {reviewItem?.reason && <small className="pending-approval-governance-reason">{reviewItem.reason}</small>}
                <small>{approval.title || "Approval required"} · Requested {relativeTime(approval.requestedAt)}</small>
              </div>
              <div className="pending-approval-actions">
                <button type="button" className="btn" disabled={!executionPath} onClick={() => onOpenExecution(approval)}>Open execution</button>
                <button type="button" className="btn" disabled={disabled} onClick={() => void submitApproval(approval, "reject")}>Reject</button>
                <button type="button" className="btn primary" disabled={disabled} onClick={() => void submitApproval(approval, "approve")}>Approve</button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function Rail({ view, setView }: { view: View; setView: (view: View) => void }) {
  const items: Array<[View, typeof MessageSquare, string]> = [
    ["topology", Network, "Topology Routing"],
    ["invitations", Mail, "Workspace Connections"]
  ];
  const topologyActive = view === "topology" || view === "workspace" || view === "chat" || view === "search" || view === "inbox" || view === "saved";
  return (
    <nav className="rail">
      <button className="brand" type="button" aria-label="Open topology" onClick={() => setView("topology")}><TyrMark adaptive /></button>
      {items.map(([id, Icon, label]) => (
        <button key={id} className={(view === id || (id === "topology" && topologyActive)) ? "rail-btn active" : "rail-btn"} title={label} onClick={() => setView(id)}>
          <Icon size={20} />
        </button>
      ))}
      <div className="rail-spacer" />
      <button className={view === "settings" ? "rail-btn active" : "rail-btn"} onClick={() => setView("settings")}><Settings size={19} /></button>
    </nav>
  );
}

function SidePanel(props: {
  view: View;
  snapshot: AppSnapshot;
  workspaceSummary: WorkspaceBootstrapPayload["summary"];
  topologyLoadStatus: Exclude<WorkspaceNavigationLoadStatus, "idle">;
  pageDataLoaded: WorkspacePageDataLoaded;
  servers: ServerRecord[];
  topologyContextMenuController: TopologyContextMenuController;
  selectedAgentId?: string;
  selectedMachineId?: string;
  selectedDeviceId?: string;
  selectedChannelId: string;
  channelMemberIndex: ChannelMemberIndex;
  onSelectTopologyHome: () => void;
  onSelectWorkspaceView: () => void;
  onSelectAgent: (id: string) => void;
  onSelectMachine: (id: string) => void;
  onSelectDevice: (id: string) => void;
  onSelectChannel: (id: string) => void;
  onOpenInvitations: () => void;
  onOpenDevices: () => void;
  onOpenProfile: () => void;
  onLogoutRequest: () => void;
  onOpenAgentApprovals: (agentId: string) => void;
  onOpenAgentDm: (agentId: string, agent?: AgentRecord) => Promise<void>;
  onAddComputer: () => void;
  onAddAgent: (machineId?: string) => void;
  onRefresh: () => Promise<void>;
  onActivateServer: (serverId: string) => Promise<void>;
}) {
  const [expandedComputers, setExpandedComputers] = useState<Record<string, boolean>>({});
  const serverSwitcher = props.servers.length > 1 ? (
    <ServerSwitcher
      snapshot={props.snapshot}
      servers={props.servers}
      onActivateServer={props.onActivateServer}
    />
  ) : null;
  const topologyRows = topologyRowsForSnapshot(props.snapshot, props.channelMemberIndex);
  const topologyContextMenuController = props.topologyContextMenuController;
  const sidebarCounts = {
    topologyCount: props.topologyLoadStatus === "ready" ? topologyRows.length : undefined,
    deviceCount: props.pageDataLoaded.devices ? (props.snapshot.devices ?? []).length : props.workspaceSummary.devices,
    // Workspace Connections only surfaces Bridge handshakes; human invites and Agent grants never affect navigation badges.
    invitationCount: (props.snapshot.incomingWorkspaceBridges ?? []).filter((bridge) => bridge.status === "pending").length
  };
  const primaryItems = primarySidebarItems(props.view, sidebarCounts);
  const primaryLayout = sidebarNavigationLayout(props.view, sidebarCounts);
  const activeSidebarSelection = activeTopologySidebarSelection({
    selectedAgentId: props.selectedAgentId,
    selectedMachineId: props.selectedMachineId,
    selectedDeviceId: props.selectedDeviceId,
    view: props.view,
    selectedChannelId: props.selectedChannelId,
    channels: props.snapshot.channels,
    agents: props.snapshot.agents
  });
  const activeSidebarAgentId = activeSidebarSelection.selectedAgentId;
  const topologyMachineIds = topologyRows.flatMap((row) => row.kind === "machine" ? [row.id] : []);
  const topologyMachineKey = topologyMachineIds.join("\0");
  const activeSidebarMachineId = activeSidebarSelection.selectedMachineId && topologyMachineIds.includes(activeSidebarSelection.selectedMachineId)
    ? activeSidebarSelection.selectedMachineId
    : undefined;
  const expandedComputerView = seedTopologyExpandedComputers(expandedComputers, topologyMachineIds, activeSidebarMachineId);
  const pendingApprovalCounts = useMemo(
    () => pendingApprovalCountByAgentId(props.snapshot.runtimeApprovals ?? []),
    [props.snapshot.runtimeApprovals]
  );
  useEffect(() => {
    setExpandedComputers((current) => {
      const next = openTopologyComputer(current, topologyMachineIds, activeSidebarMachineId);
      return topologyExpandedComputersEqual(current, next) ? current : next;
    });
  }, [topologyMachineKey, activeSidebarMachineId]);
  function openPrimarySidebarItem(item: PrimarySidebarItem) {
    if (item.id === "topology") props.onSelectTopologyHome();
    else if (item.id === "workspace") props.onSelectWorkspaceView();
    else if (item.id === "devices") props.onOpenDevices();
    else if (item.id === "invitations") props.onOpenInvitations();
    else props.onOpenProfile();
  }
  {
    const rows = topologyRows;
    const creatableMachineIds = new Set(filterCreatableMachines(props.snapshot.machines, props.snapshot.currentUser.id).map((machine) => machine.id));
    const machineRows = rows.filter((row): row is Extract<TopologyRow, { kind: "machine" }> => row.kind === "machine");
    const deviceRows = rows.filter((row): row is Extract<TopologyRow, { kind: "device" }> => row.kind === "device");
    const agentsByMachine = new Map<string, Array<Extract<TopologyRow, { kind: "agent" }>>>();
    const communicationAgentRows: Array<Extract<TopologyRow, { kind: "agent" }>> = [];
    const standaloneAgentRows: Array<Extract<TopologyRow, { kind: "agent" }>> = [];
    for (const row of rows) {
      if (row.kind === "agent" && row.parentId === "server") {
        if (isCommunicationAgent(row.agent)) communicationAgentRows.push(row);
        else standaloneAgentRows.push(row);
      } else if (row.kind === "agent" && row.parentId) {
        const items = agentsByMachine.get(row.parentId) ?? [];
        items.push(row);
        agentsByMachine.set(row.parentId, items);
      }
    }
    function toggleComputer(machineId: string) {
      setExpandedComputers((current) => {
        const expanded = isComputerExpanded(machineId);
        return toggleTopologyComputerExpanded(current, machineId, expanded);
      });
    }
    function isComputerExpanded(machineId: string) {
      return expandedComputerView[machineId] === true;
    }
    function agentDmUnread(agent: AgentRecord): string | null {
      const dm = dmChannelForAgent(props.snapshot.channels, agent);
      return dm ? unreadBadgeLabel(channelUnreadCount(props.snapshot, dm.id)) : null;
    }
    function renderAgentRow(row: Extract<TopologyRow, { kind: "agent" }>, machine?: MachineRecord) {
      const agent = row.agent;
      const unreadLabel = agentDmUnread(agent);
      const pendingAgentApprovalCount = pendingApprovalCounts.get(agent.id) ?? 0;
      const agentTitle = isCommunicationAgent(agent)
        ? `${agent.displayName} · ${memberAgentSubtitle(agent, machine)}`
        : `${agent.displayName} · @${agent.name} · ${memberAgentSubtitle(agent, machine)}`;
      return (
        <div key={agent.id} className="topology-agent-branch">
          <div className="topology-agent-row-wrap">
            <button title={agentTitle} className={activeSidebarAgentId === agent.id ? "topology-tree-row selected" : "topology-tree-row"} onContextMenu={(event) => topologyContextMenuController.open(event, { kind: "node", node: topologySidebarNodeForRow(row) })} onClick={() => {
              if (agentCanOpenDm(agent, props.snapshot.currentUser.id)) void props.onOpenAgentDm(agent.id, agent);
              else props.onSelectAgent(agent.id);
            }}>
              <span className="topology-tree-icon agent">{avatarSeed(agent.name)}</span>
              <span className="topology-tree-row-label">{agent.displayName}</span>
              {unreadLabel && <span className="pill notice sidebar-unread">{unreadLabel}</span>}
              {/* 状态圆点只表达 Agent 当前状态；待审批由旁边的独立按钮提示，避免离线 Agent 被显示成黄色。 */}
              <span className={`topology-tree-status ${topologyTreeStatusClass(agent.status)}`} />
            </button>
            {pendingAgentApprovalCount > 0 && (
              <button
                type="button"
                className="topology-approval-chip"
                title={`@${agent.name} has ${pendingAgentApprovalCount} pending approval${pendingAgentApprovalCount === 1 ? "" : "s"}`}
                aria-label={`@${agent.name} has ${pendingAgentApprovalCount} pending approval${pendingAgentApprovalCount === 1 ? "" : "s"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpenAgentApprovals(agent.id);
                }}
              >
                <Shield size={12} />
              </button>
            )}
          </div>
        </div>
      );
    }
    function renderDeviceRow(row: Extract<TopologyRow, { kind: "device" }>) {
      const activeGrantCount = (props.snapshot.deviceGrants ?? []).filter((grant) => grant.deviceId === row.device.id && grant.status === "active").length;
      return (
        <button key={row.device.id} title={`${row.device.displayName} · ${row.device.platform}`} className={activeSidebarSelection.selectedDeviceId === row.device.id ? "topology-tree-row selected" : "topology-tree-row"} onContextMenu={(event) => topologyContextMenuController.open(event, { kind: "node", node: topologySidebarNodeForRow(row) })} onClick={() => props.onSelectDevice(row.device.id)}>
          <span className="topology-tree-icon device"><Smartphone size={13} /></span>
          <span className="topology-tree-row-label">{row.device.displayName}</span>
          {activeGrantCount > 0 && <span className="pill notice sidebar-unread">{activeGrantCount}</span>}
          <span className={`topology-tree-status ${row.device.status === "online" ? "online" : "offline"}`} />
        </button>
      );
    }
    const readyTopologyTree = (
      <div className="topology-tree-slot">
        <div className="topology-tree-label"><span>Devices</span><small>{machineRows.length}</small></div>
        {machineRows.length === 0 && <div className="member-empty">No devices connected.</div>}
        {machineRows.map((row) => {
          const machine = row.machine;
          const expanded = isComputerExpanded(machine.id);
          const agentRows = agentsByMachine.get(machine.id) ?? [];
          const canCreateAgent = creatableMachineIds.has(machine.id);
          const machineTitle = `${machine.name} · ${machine.hostname}${sharedResourceLabel(machine) ? " · Shared" : ""}`;
          return (
            <div key={machine.id} className="topology-tree-group">
              <button title={machineTitle} className={activeSidebarSelection.selectedMachineId === machine.id ? "topology-tree-row topology-tree-row-machine selected" : "topology-tree-row topology-tree-row-machine"} onContextMenu={(event) => topologyContextMenuController.open(event, { kind: "node", node: topologySidebarNodeForRow(row) })} onClick={() => props.onSelectMachine(machine.id)}>
                <span className="topology-tree-expand" role="button" tabIndex={0} onClick={(event) => {
                  event.stopPropagation();
                  toggleComputer(machine.id);
                }} onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  toggleComputer(machine.id);
                }}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
                <span className="topology-tree-icon machine"><Monitor size={13} /></span>
                <span className="topology-tree-row-label">{machine.name}</span>
                <span className={`topology-tree-status ${topologyTreeStatusClass(machine.status)}`} />
              </button>
              {expanded && (
                <div className="topology-tree-children">
                  {agentRows.length === 0 && !canCreateAgent && <div className="member-empty compact">No agents.</div>}
                  {agentRows.map((agentRow) => renderAgentRow(agentRow, machine))}
                  {canCreateAgent && (
                    <button type="button" title={`Add agent to ${machine.name}`} className="topology-tree-row topology-tree-add-agent" onClick={(event) => {
                      event.stopPropagation();
                      props.onAddAgent(machine.id);
                    }}>
                      <span className="topology-tree-add-icon"><Plus size={13} /></span>
                      <span className="topology-tree-row-label">Add agent</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {communicationAgentRows.length > 0 && (
          <>
            <div className="topology-tree-label"><span>Communication</span><small>{communicationAgentRows.length}</small></div>
            {communicationAgentRows.map((agentRow) => renderAgentRow(agentRow))}
          </>
        )}
        {standaloneAgentRows.length > 0 && (
          <>
            <div className="topology-tree-label"><span>Agents</span><small>{standaloneAgentRows.length}</small></div>
            {standaloneAgentRows.map((agentRow) => renderAgentRow(agentRow))}
          </>
        )}
        {deviceRows.length > 0 && (
          <>
            <div className="topology-tree-label"><span>Mobile Devices</span><small>{deviceRows.length}</small></div>
            {deviceRows.map(renderDeviceRow)}
          </>
        )}
      </div>
    );
    const topologyTree = props.topologyLoadStatus === "ready" ? readyTopologyTree : (
      <div className="topology-tree-slot" aria-busy={props.topologyLoadStatus === "loading"}>
        <div className="topology-tree-label"><span>Devices</span><small>…</small></div>
        {props.topologyLoadStatus === "loading" ? (
          <div className="topology-tree-loading" role="status" aria-label="Loading topology">
            <span /><span /><span />
          </div>
        ) : (
          <div className="topology-tree-load-error" role="alert">
            <span>Topology unavailable.</span>
            <button type="button" onClick={() => void props.onRefresh()}>Retry</button>
          </div>
        )}
      </div>
    );
    return (
      <aside className="side">
        <SidebarBrand snapshot={props.snapshot} onLogoutRequest={props.onLogoutRequest} />
        <button className="sidebar-connect-button" onClick={props.onAddComputer}><Plus size={15} /> Add Devices</button>
        {serverSwitcher}
        <div className="sidebar-main-nav">
          <PrimarySidebarLayout layout={primaryLayout} onSelect={openPrimarySidebarItem} topologyTree={topologyTree} />
        </div>
        <SidebarFooter />
      </aside>
    );
  }
}

function topologySidebarNodeForRow(row: TopologyRow): TopologyGraphNode {
  // 左侧树没有 canvas 坐标，但右键菜单只依赖节点类型和 row 数据；id 仍保持与拓扑图一致。
  if (row.kind === "machine") {
    return {
      id: `machine:${row.id}`,
      kind: "machine",
      label: row.machine.name,
      subtitle: row.machine.hostname,
      position: { x: 0, y: 0 },
      status: row.machine.status,
      shared: row.shared,
      row
    };
  }
  if (row.kind === "agent") {
    return {
      id: `agent:${row.id}`,
      kind: "agent",
      label: row.agent.displayName,
      subtitle: isCommunicationAgent(row.agent) ? "Communication / server-hosted" : `${row.agent.runtime ?? "No runtime"} / ${agentStatusLabel(row.agent.status)}`,
      position: { x: 0, y: 0 },
      status: row.agent.status,
      shared: row.shared,
      row
    };
  }
  if (row.kind === "channel") {
    return {
      id: `channel:${row.id}`,
      kind: "channel",
      label: row.channel.displayName || row.channel.name,
      subtitle: "Conversation",
      position: { x: 0, y: 0 },
      shared: Boolean(row.shared),
      row
    };
  }
  if (row.kind === "device") {
    return {
      id: `device:${row.id}`,
      kind: "device",
      label: row.device.displayName,
      subtitle: `${row.device.platform} / ${row.device.status}`,
      position: { x: 0, y: 0 },
      status: row.device.status,
      shared: false,
      row
    };
  }
  return {
    id: `human:${row.placementId ?? row.id}`,
    kind: "human",
    label: row.human.displayName,
    subtitle: row.grantSummary ? `Shared ${row.grantSummary.scopes.join(", ")}` : row.shared ? "Shared human" : "Human member",
    position: { x: 0, y: 0 },
    shared: row.shared,
    row
  };
}

function PrimarySidebarButton({ item, onSelect }: { item: PrimarySidebarItem; onSelect: (item: PrimarySidebarItem) => void }) {
  const iconById = {
    topology: Network,
    workspace: Building2,
    devices: Smartphone,
    invitations: Mail,
    settings: Settings
  } as const;
  const Icon = iconById[item.id];

  return (
    <button className={item.active ? "utility primary selected" : "utility primary"} onClick={() => onSelect(item)}>
      <Icon size={15} />
      <span>{item.label}</span>
      {typeof item.count === "number" && <em>{item.count}</em>}
    </button>
  );
}

function PrimarySidebarLayout({ layout, onSelect, topologyTree }: { layout: ReturnType<typeof sidebarNavigationLayout>; onSelect: (item: PrimarySidebarItem) => void; topologyTree: ReactElement }) {
  return (
    <nav className="primary-sidebar-nav topology-sidebar-nav" aria-label="Workspace navigation">
      {layout.map((entry) => {
        if (entry.kind === "topology-tree") return <div key="topology-tree" className="primary-sidebar-tree">{topologyTree}</div>;
        return <PrimarySidebarButton key={entry.item.id} item={entry.item} onSelect={onSelect} />;
      })}
    </nav>
  );
}

function ServerSwitcher({ snapshot, servers, onActivateServer }: { snapshot: AppSnapshot; servers: ServerRecord[]; onActivateServer: (serverId: string) => Promise<void> }) {
  const activeServerId = snapshot.currentServer?.id ?? "";
  if (!activeServerId && servers.length === 0) return null;
  return (
    <label className="server-switcher">
      <Building2 size={15} />
      <select
        aria-label="Current workspace"
        title="Current workspace"
        value={activeServerId}
        disabled={servers.length <= 1}
        onChange={(event) => void onActivateServer(event.target.value)}
      >
        {servers.map((server) => (
          <option key={server.id} value={server.id}>
            {server.name}
          </option>
        ))}
      </select>
      <ChevronDown size={14} />
    </label>
  );
}

function SidebarFooter() {
  return (
    <div className="sidebar-footer">
      <span><Activity size={14} /> Control Diagnostics v1.4</span>
    </div>
  );
}

function SidebarBrand({ snapshot, onLogoutRequest }: { snapshot: AppSnapshot; onLogoutRequest: () => void }) {
  const user = snapshot.currentUser;
  return (
    <div className="sidebar-brand-block">
      <div className="sidebar-brand-mark">
        <TyrLogo adaptive className="sidebar-brand-logo" />
        <small>{snapshot.currentServer?.name ?? "TYR-HQ"}</small>
      </div>
      <div className="sidebar-user-card">
        <span className="avatar human large">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <UserRound size={22} />}</span>
        <span>
          <b>{user.displayName || user.name}</b>
          <small>{memberRoleLabel(snapshot.currentServer?.role ?? "member")}</small>
        </span>
        <button className="sidebar-user-logout" type="button" aria-label="Log out" title="Log out" onClick={onLogoutRequest}>
          <LogOut size={15} />
        </button>
      </div>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <div className="section-label">{label}</div>;
}

function snapshotChannelDisplayLabel(snapshot: AppSnapshot, channelId: string, fallback: { type?: ChannelType | string | null; name?: string | null; displayName?: string | null }): string {
  const channel = snapshot.channels.find((item) => item.id === channelId);
  if (channel) return channelDisplayLabel(channel, snapshot.agents);
  return channelDisplayLabelFromFields(fallback);
}

function searchResultParentChannelLabel(snapshot: AppSnapshot, item: SearchMessageResult): string {
  return snapshotChannelDisplayLabel(snapshot, item.parentChannelId, {
    type: item.parentChannelType,
    name: item.parentChannelName,
    displayName: item.parentChannelDisplayName
  });
}

function inboxItemChannelLabel(snapshot: AppSnapshot, item: InboxItem): string {
  if (item.kind === "thread") {
    return snapshotChannelDisplayLabel(snapshot, item.parentChannelId, {
      type: item.parentChannelType,
      name: item.parentChannelName,
      displayName: item.parentChannelDisplayName
    });
  }
  return snapshotChannelDisplayLabel(snapshot, item.channelId, {
    type: item.channelType,
    name: item.channelName,
    displayName: item.channelDisplayName
  });
}


function UtilityEmptyState({ icon, title, description, actionLabel, onAction }: { icon: ReactElement; title: string; description: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <section className="utility-empty-panel">
      <span className="utility-empty-icon">{icon}</span>
      <b>{title}</b>
      <p>{description}</p>
      {actionLabel && onAction && <button className="btn" type="button" onClick={onAction}>{actionLabel}</button>}
    </section>
  );
}

function UtilityMessageResultRow({ item, channelLabel, onOpen, onRemoveSaved, removing = false }: { item: SearchMessageResult; channelLabel: string; onOpen: () => void; onRemoveSaved?: () => void; removing?: boolean }) {
  return (
    <div className="utility-message-row">
      <button className="utility-message-open" type="button" onClick={onOpen}>
        <span className={item.senderType === "agent" ? "avatar agent" : "avatar human"}>{avatarSeed(item.senderName)}</span>
        <span className="utility-message-copy">
          <span className="utility-message-heading"><b>{item.senderName}</b><small>{channelLabel}</small></span>
          <p>{messagePreviewText({ content: item.snippet || item.content, deletedAt: item.deletedAt })}</p>
        </span>
        <time>{relativeTime(item.createdAt)}</time>
      </button>
      {onRemoveSaved && (
        <button className="utility-row-action saved" type="button" disabled={removing} onClick={onRemoveSaved} title="Remove from Saved" aria-label="Remove from Saved">
          <Bookmark size={16} fill="currentColor" />
        </button>
      )}
    </div>
  );
}

function SearchView({ snapshot, topbarProps, onSelectChannel, onOpenAgentDm, onSelectMessage }: { snapshot: AppSnapshot; topbarProps: WorkspaceTopBarProps; onSelectChannel: (channelId: string) => void; onOpenAgentDm: (agentId: string) => Promise<void>; onSelectMessage: (channelId: string, messageId: string, conversationId?: string) => void }) {
  const [query, setQuery] = useState("");
  const [myOnly, setMyOnly] = useState(false);
  const [timeFilter, setTimeFilter] = useState<"any" | "today" | "7" | "30">("any");
  const [timeOpen, setTimeOpen] = useState(false);
  const [sort, setSort] = useState<"relevant" | "recent">("relevant");
  const [results, setResults] = useState<SearchMessageResult[]>([]);
  const [searching, setSearching] = useState(false);
  const trimmed = query.trim();
  const directoryResults = useMemo(() => {
    if (!trimmed) return [];
    const lower = trimmed.toLowerCase();
    const channels = snapshot.channels
      .filter((channel) => channel.type === "dm")
      .filter((channel) => {
        const title = dmTitle(channel, snapshot.agents);
        return title.toLowerCase().includes(lower) ||
          channel.displayName.toLowerCase().includes(lower) ||
          (channel.description ?? "").toLowerCase().includes(lower);
      })
      .map((channel) => {
        const title = dmTitle(channel, snapshot.agents);
        const peer = dmPeerAgentForChannel(channel, snapshot.agents);
        return {
          kind: "DM" as const,
          id: channel.id,
          title,
          subtitle: isCommunicationAgent(peer) ? "TYR DM" : `@${channel.dmPeerAgentName ?? title}`,
          channelId: channel.id
        };
      });
    const agents = snapshot.agents
      .filter((agent) => agent.name.toLowerCase().includes(lower) || agent.displayName.toLowerCase().includes(lower))
      .map((agent) => ({
        kind: "AGENT" as const,
        id: agent.id,
        title: agent.displayName,
        subtitle: isCommunicationAgent(agent) ? "Communication / server-hosted" : `@${agent.name}`
      }));
    return [...agents, ...channels].slice(0, 8);
  }, [snapshot.agents, snapshot.channels, trimmed]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!trimmed) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const params = new URLSearchParams({ q: trimmed, limit: "50", offset: "0", sort: sort === "relevant" ? "relevance" : "recent" });
        if (myOnly) params.set("senderId", snapshot.currentUser.id);
        if (timeFilter !== "any") {
          const now = Date.now();
          // Today 按用户本地午夜计算；滚动时间范围按完整的 24 小时天数计算。
          const after = timeFilter === "today"
            ? new Date(new Date().toDateString())
            : new Date(now - Number(timeFilter) * 24 * 60 * 60 * 1000);
          params.set("after", after.toISOString());
        }
        const data = await api<{ hasMore: boolean; results: SearchMessageResult[] }>(`/api/messages/search?${params.toString()}`);
        if (!active) return;
        setResults(data.results);
      } finally {
        if (active) setSearching(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [myOnly, snapshot.currentUser.id, sort, timeFilter, trimmed]);

  function clearFilters() {
    setMyOnly(false);
    setTimeFilter("any");
    setSort("relevant");
  }
  function resetSearch() {
    setQuery("");
    clearFilters();
  }

  const filtersActive = myOnly || timeFilter !== "any" || sort !== "relevant";
  const totalResults = directoryResults.length + results.length;
  const timeFilterLabel = timeFilter === "any" ? "Any time" : timeFilter === "today" ? "Today" : timeFilter === "7" ? "Last 7 days" : "Last 30 days";

  return (
    <div className="view search-view">
      <TopBar title="Search" {...topbarProps} />
      <div className="utility-page-scroll">
        <div className="utility-page-inner">
          <section className="utility-control-panel">
            <div className="utility-command-row">
              <span className="utility-command-icon"><Search size={20} /></span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") resetSearch(); }} autoFocus placeholder="Search agents, DMs, and messages" aria-label="Search agents, DMs, and messages" />
              {query && <button className="utility-command-clear" type="button" onClick={() => setQuery("")} title="Clear search" aria-label="Clear search"><X size={17} /></button>}
              <kbd>ESC</kbd>
            </div>
            <div className="utility-filter-row" aria-label="Message filters">
              <span className="utility-filter-label">Messages</span>
              <button className={myOnly ? "btn small active" : "btn small"} type="button" onClick={() => setMyOnly((current) => !current)}>Sent by me</button>
              <div className="filter-pop">
                <button className="btn small" type="button" aria-expanded={timeOpen} onClick={() => setTimeOpen((current) => !current)}><Calendar size={15} /> {timeFilterLabel} <ChevronDown size={14} /></button>
                {timeOpen && (
                  <div className="filter-menu">
                    {[["any", "Any time"], ["today", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"]].map(([value, label]) => (
                      <button key={value} className={timeFilter === value ? "active" : ""} onClick={() => {
                        setTimeFilter(value as typeof timeFilter);
                        setTimeOpen(false);
                      }}>{label}</button>
                    ))}
                  </div>
                )}
              </div>
              {filtersActive && <button className="btn small utility-clear-filters" type="button" onClick={clearFilters}>Clear filters</button>}
              <div className="segmented utility-sort" aria-label="Sort message results">
                <button className={sort === "relevant" ? "active" : ""} onClick={() => setSort("relevant")}>Relevant</button>
                <button className={sort === "recent" ? "active" : ""} onClick={() => setSort("recent")}>Recent</button>
              </div>
            </div>
          </section>

          {!trimmed && <UtilityEmptyState icon={<Search size={24} />} title="Search your workspace" description="Find agents, DMs, and message history from one place." />}
          {trimmed && searching && totalResults === 0 && <UtilityEmptyState icon={<Search size={24} />} title="Searching messages…" description="Matching people and conversations will appear here." />}
          {trimmed && !searching && totalResults === 0 && <UtilityEmptyState icon={<Search size={24} />} title="No matches found" description={`No results for “${trimmed}”. Try a different term or fewer filters.`} actionLabel={filtersActive ? "Clear filters" : "Clear search"} onAction={filtersActive ? clearFilters : () => setQuery("")} />}
          {trimmed && totalResults > 0 && (
            <div className="utility-result-stack">
              <div className="utility-result-summary"><b>{searching ? "Searching messages…" : `${totalResults} ${totalResults === 1 ? "result" : "results"}`}</b><span>Agents, DMs, and message history</span></div>
              {directoryResults.length > 0 && (
                <section className="utility-section">
                  <header className="utility-section-head"><span>Agents &amp; DMs</span><em>{directoryResults.length}</em></header>
                  <div className="utility-list-panel">
                    {directoryResults.map((item) => (
                      <button key={`${item.kind}-${item.id}`} className="utility-directory-row" type="button" onClick={() => item.kind === "AGENT" ? void onOpenAgentDm(item.id) : onSelectChannel(item.channelId)}>
                        <span className="avatar agent">{avatarSeed(item.title)}</span>
                        <span><b>{item.title}</b><small>{item.subtitle}</small></span>
                        <span className="badge">{item.kind}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {results.length > 0 && (
                <section className="utility-section">
                  <header className="utility-section-head"><span>Messages</span><em>{results.length}</em></header>
                  <div className="utility-list-panel">
                    {results.map((item) => {
                      const target = messageResultOpenTarget(item);
                      return <UtilityMessageResultRow key={item.id} item={item} channelLabel={searchResultParentChannelLabel(snapshot, item)} onOpen={() => onSelectMessage(target.channelId, target.messageId, target.conversationId)} />;
                    })}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InboxView({ snapshot, topbarProps, onRefresh, onSelectItem }: { snapshot: AppSnapshot; topbarProps: WorkspaceTopBarProps; onRefresh: () => Promise<void>; onSelectItem: (channelId: string, messageId?: string, conversationId?: string) => void }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [inbox, setInbox] = useState<InboxResponse>({
    items: [],
    hasMore: false,
    nextCursor: null,
    totalCount: 0,
    totalUnreadCount: 0
  });
  const unreadSignature = useMemo(
    () => Object.entries(snapshot.unreadCounts ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([channelId, count]) => `${channelId}:${count}`).join("|"),
    [snapshot.unreadCounts]
  );
  const loadInboxPage = useCallback(async (cursor?: string) => {
    setLoadingInbox(true);
    try {
      const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const data = await api<InboxResponse>(`/api/channels/inbox?limit=30${cursorQuery}`);
      setInbox((current) => cursor ? { ...data, items: [...current.items, ...data.items] } : data);
    } finally {
      setLoadingInbox(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    async function load() {
      setLoadingInbox(true);
      try {
        const data = await api<InboxResponse>("/api/channels/inbox?limit=30");
        if (active) setInbox(data);
      } finally {
        if (active) setLoadingInbox(false);
      }
    }
    setInbox({ items: [], hasMore: false, nextCursor: null, totalCount: 0, totalUnreadCount: 0 });
    void load();
    return () => {
      active = false;
    };
  }, [reloadKey, snapshot.messages.length, unreadSignature]);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !inbox.nextCursor || loadingInbox || typeof IntersectionObserver === "undefined") return;
    const cursor = inbox.nextCursor;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadInboxPage(cursor);
    }, { rootMargin: "160px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [inbox.nextCursor, loadingInbox, loadInboxPage]);
  async function markAllRead() {
    await api<{ ok: boolean }>("/api/channels/inbox/read-all", { method: "POST", body: "{}" });
    await onRefresh();
    setReloadKey((value) => value + 1);
  }
  async function markItemRead(item: InboxItem) {
    await api<{ ok: boolean }>(inboxReadPath(item), { method: "POST", body: "{}" });
    await onRefresh();
    setReloadKey((value) => value + 1);
  }
  const items = inbox.items;
  return (
    <div className="view inbox-view">
      <TopBar title="Inbox" {...topbarProps} />
      <div className="utility-page-scroll">
        <div className="utility-page-inner">
          {loadingInbox && items.length === 0 && <UtilityEmptyState icon={<Mail size={24} />} title="Loading inbox…" description="Unread conversations will appear here." />}
          {!loadingInbox && items.length === 0 && <UtilityEmptyState icon={<Mail size={24} />} title="You're all caught up" description="Unread DMs and thread replies will appear here." actionLabel="Search messages" onAction={topbarProps.onOpenSearch} />}
          {items.length > 0 && (
            <>
              <div className="utility-page-summary">
                <span><b>{inbox.totalUnreadCount} unread</b><small>across {inbox.totalCount} {inbox.totalCount === 1 ? "conversation" : "conversations"}</small></span>
                <button className="btn small" type="button" onClick={() => void markAllRead()}><Mail size={15} /> Mark all read</button>
              </div>
              <div className="utility-list-panel inbox-list">
                {items.map((item) => {
                  const isThread = item.kind === "thread";
                  const channelLabel = inboxItemChannelLabel(snapshot, item);
                  const when = isThread ? item.lastActivityAt : item.lastMessageAt;
                  const target = inboxOpenTarget(item);
                  return (
                    <div key={item.itemKey} className="inbox-row unread">
                      <button className="inbox-row-main" type="button" onClick={() => onSelectItem(target.channelId, target.messageId, target.conversationId)}>
                        <span className="inbox-row-meta">
                          <span className="inbox-source"><MessageSquare size={14} /> {channelLabel}</span>
                          {isThread && <span className="inbox-kind">Thread</span>}
                          {isThread && <span className="inbox-thread-meta">{item.replyCount} {item.replyCount === 1 ? "reply" : "replies"}</span>}
                          <time>{relativeTime(when)}</time>
                        </span>
                        {isThread ? (
                          <>
                            <span className="inbox-row-title">{item.parentMessagePreview}</span>
                            {item.latestActivityPreview !== item.parentMessagePreview && <span className="inbox-row-preview">Latest reply: {item.latestActivityPreview}</span>}
                          </>
                        ) : (
                          <span className="inbox-row-preview"><b>{item.lastMessageSenderName}:</b> {item.lastMessagePreview}</span>
                        )}
                      </button>
                      <div className="inbox-row-side">
                        <span className="inbox-unread-count">{item.unreadCount} unread</span>
                        <button className="inbox-action" type="button" aria-label="Mark inbox item read" onClick={() => void markItemRead(item)}><Mail size={15} /> Mark read</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <div ref={loadMoreRef} className="utility-pagination">
            {inbox.nextCursor && <button className="btn small" type="button" disabled={loadingInbox} onClick={() => void loadInboxPage(inbox.nextCursor ?? undefined)}>{loadingInbox ? "Loading…" : "Load more"}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function SavedView({ snapshot, topbarProps, onRefresh, onSelectMessage }: { snapshot: AppSnapshot; topbarProps: WorkspaceTopBarProps; onRefresh: () => Promise<void>; onSelectMessage: (channelId: string, messageId: string, conversationId?: string) => void }) {
  const [saved, setSaved] = useState<SearchMessageResult[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [removingSavedMessageId, setRemovingSavedMessageId] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      setLoadingSaved(true);
      try {
        const data = await api<{ saved: SearchMessageResult[]; hasMore: boolean }>("/api/channels/saved?limit=50&offset=0");
        if (active) setSaved(data.saved);
      } finally {
        if (active) setLoadingSaved(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [snapshot.savedMessageIds]);
  async function removeSavedMessage(messageId: string) {
    setRemovingSavedMessageId(messageId);
    try {
      await api(`/api/messages/${messageId}/save`, { method: "DELETE", body: "{}" });
      setSaved((current) => current.filter((item) => item.id !== messageId));
      await onRefresh();
    } finally {
      setRemovingSavedMessageId("");
    }
  }
  return (
    <div className="view saved-view">
      <TopBar title="Saved" {...topbarProps} />
      <div className="utility-page-scroll">
        <div className="utility-page-inner">
          {loadingSaved && saved.length === 0 && <UtilityEmptyState icon={<Bookmark size={24} />} title="Loading saved messages…" description="Your saved message history will appear here." />}
          {!loadingSaved && saved.length === 0 && <UtilityEmptyState icon={<Bookmark size={24} />} title="Nothing saved yet" description="Open a message menu and choose Save to keep it here." actionLabel="Search messages" onAction={topbarProps.onOpenSearch} />}
          {saved.length > 0 && (
            <>
              <div className="utility-page-summary"><span><b>{saved.length} saved</b><small>{saved.length === 1 ? "message" : "messages"}</small></span></div>
              <div className="utility-list-panel">
                {saved.map((item) => {
                  const target = messageResultOpenTarget(item);
                  return <UtilityMessageResultRow key={item.id} item={item} channelLabel={searchResultParentChannelLabel(snapshot, item)} onOpen={() => onSelectMessage(target.channelId, target.messageId, target.conversationId)} onRemoveSaved={() => void removeSavedMessage(item.id)} removing={removingSavedMessageId === item.id} />;
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DevicesView({ snapshot, topbarProps, devicePageInfo, deviceLoading, onLoadMoreDevices, onRefresh }: { snapshot: AppSnapshot; topbarProps: WorkspaceTopBarProps; devicePageInfo: CursorPageInfo; deviceLoading: boolean; onLoadMoreDevices: () => Promise<void>; onRefresh: () => Promise<void> }) {
  const devices = snapshot.devices ?? [];
  const [pairingOpen, setPairingOpen] = useState(false);
  const [displayName, setDisplayName] = useState("TYR Android App");
  const [selectedPairingAgentId, setSelectedPairingAgentId] = useState(snapshot.agents[0]?.id ?? "");
  const [selectedDetailDeviceId, setSelectedDetailDeviceId] = useState("");
  const [pairing, setPairing] = useState<DevicePairingTokenRecord | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState("");
  const [pairingCopyStatus, setPairingCopyStatus] = useState("");
  const [pairingQrDataUrl, setPairingQrDataUrl] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const selectedDetailDevice = devices.find((device) => device.id === selectedDetailDeviceId);
  const mobilePairingCode = pairing?.pairingToken ?? "";

  useEffect(() => {
    if (selectedDetailDeviceId && !devices.some((device) => device.id === selectedDetailDeviceId)) setSelectedDetailDeviceId("");
  }, [devices, selectedDetailDeviceId]);

  useEffect(() => {
    if (selectedPairingAgentId && snapshot.agents.some((agent) => agent.id === selectedPairingAgentId)) return;
    setSelectedPairingAgentId(snapshot.agents[0]?.id ?? "");
  }, [selectedPairingAgentId, snapshot.agents]);

  useEffect(() => {
    if (!mobilePairingCode) {
      setPairingQrDataUrl("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(mobilePairingCode, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 6
    }).then((dataUrl) => {
      if (!cancelled) setPairingQrDataUrl(dataUrl);
    }).catch(() => {
      if (!cancelled) setPairingQrDataUrl("");
    });
    return () => {
      cancelled = true;
    };
  }, [mobilePairingCode]);

  async function createPairingToken() {
    if (!selectedPairingAgentId) {
      setPairingError("Choose an Assistant for this mobile device.");
      return;
    }
    setPairingBusy(true);
    setPairing(null);
    setPairingError("");
    try {
      const token = await api<DevicePairingTokenRecord>("/api/devices/mobile-pairing", {
        method: "POST",
        body: JSON.stringify({
          displayName: displayName.trim() || "Android Device",
          pinnedAgentId: selectedPairingAgentId
        })
      });
      setPairing(token);
      setPairingCopyStatus("");
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : "Pairing code failed.");
    } finally {
      setPairingBusy(false);
    }
  }

  async function copyMobilePairingCode() {
    if (!mobilePairingCode) return;
    await copyMessageText(mobilePairingCode);
    setPairingCopyStatus("Pairing code copied.");
  }

  async function deleteDevice(device: NonNullable<typeof selectedDetailDevice>) {
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await api(`/api/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
      setSelectedDetailDeviceId("");
      await onRefresh();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Delete mobile device failed.");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="view devices-view">
      <TopBar title="Mobile Devices" {...topbarProps} />
      <div className="devices-layout">
        <section className="devices-page-head">
          <div>
            <h2>Mobile Devices</h2>
            <p>Pair Android devices and review live connection status. Use chat to request the device screen when the Agent needs it.</p>
          </div>
          <button className="btn primary small" type="button" onClick={() => {
            setPairingOpen(true);
            setPairing(null);
            setPairingCopyStatus("");
          }}><Plus size={16} /> Add Mobile Device</button>
        </section>

        <section className="devices-card-list">
          {devices.length === 0 && (
            <div className="empty-box devices-empty">
              <Smartphone size={28} />
              <b>No mobile devices paired</b>
              <button className="btn primary small" onClick={() => setPairingOpen(true)}><Plus size={14} /> Add Mobile Device</button>
            </div>
          )}
          {devices.map((device) => (
            <button
              key={device.id}
              className="device-card-row"
              type="button"
              onClick={() => setSelectedDetailDeviceId(device.id)}
            >
              <span className="device-card-icon"><Smartphone size={18} /></span>
              <span>
                <b>{device.displayName}</b>
                <small>{device.platform} · {device.status} · {device.capabilities.length} {device.capabilities.length === 1 ? "method" : "methods"}</small>
              </span>
              <i className={statusDot(device.status)} />
            </button>
          ))}
          {devicePageInfo.hasMore && (
            <div className="inbox-pagination">
              <button className="btn small" disabled={deviceLoading} onClick={() => void onLoadMoreDevices()}>
                {deviceLoading ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </section>
      </div>
          {selectedDetailDevice && (
        <Modal title="MOBILE DEVICE DETAILS" onClose={() => setSelectedDetailDeviceId("")} className="template-form-modal template-form-modal-lg" backdropClassName="template-form-modal-backdrop" titleIcon={<Smartphone size={18} />}>
          <div className="template-dialog-content">
            <div className="template-dialog-body">
              <DeviceDetailPanel device={selectedDetailDevice} snapshot={snapshot} />
              {deleteError && <p className="devices-message error">{deleteError}</p>}
            </div>
            <div className="modal-actions template-dialog-actions">
              <button className="btn danger" type="button" disabled={deleteBusy} onClick={() => void deleteDevice(selectedDetailDevice)}><Trash2 size={15} /> Delete mobile device</button>
              <button className="btn" type="button" onClick={() => setSelectedDetailDeviceId("")}>Close</button>
            </div>
          </div>
        </Modal>
      )}
      {pairingOpen && (
        <Modal title="Add Mobile Device" onClose={() => setPairingOpen(false)} className="template-form-modal template-form-modal-md" backdropClassName="template-form-modal-backdrop" titleIcon={<Smartphone size={18} />}>
          <div className="template-dialog-content">
            <div className="template-dialog-body">
              <label className="field-label">Mobile device name</label>
              <input className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              <label className="field-label">Assistant</label>
              <SelectControl className="input" value={selectedPairingAgentId} onChange={(event) => {
                setSelectedPairingAgentId(event.target.value);
                setPairingError("");
              }}>
                {snapshot.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}
              </SelectControl>
              <p className="muted-text">This Assistant becomes the default chat partner on this mobile device.</p>
              <button className="btn primary" type="button" disabled={pairingBusy} onClick={() => void createPairingToken()}><KeyRound size={15} /> Generate pairing code</button>
              {pairingError && <p className="devices-message error">{pairingError}</p>}
              {pairing && (
                <div className="pairing-token-box">
                  <small>Scan this QR code on the TYR Android device.</small>
                  {pairingQrDataUrl ? <img className="mobile-pairing-qr" src={pairingQrDataUrl} alt="Mobile device pairing QR code" /> : <div className="mobile-pairing-qr loading">QR loading</div>}
                  <small>Or enter this pairing code manually.</small>
                  <code>{mobilePairingCode}</code>
                  <button className="copy" type="button" onClick={() => void copyMobilePairingCode()}><Copy size={15} /> Copy code</button>
                  {pairingCopyStatus && <p className="copy-feedback" role="status">{pairingCopyStatus}</p>}
                </div>
              )}
            </div>
            <div className="modal-actions template-dialog-actions">
              <button className="btn" type="button" onClick={() => setPairingOpen(false)}>Close</button>
              <button className="btn primary" type="button" onClick={() => void onRefresh()}>Refresh</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TopologyView({ snapshot, liveWork, topologyLoadStatus, topbarProps, channelMemberIndex, inspectTarget, topologyInspectorIntent, onTopologyInspectorIntent, inspectorOpen, onInspectTarget, onCollapseInspector, onRefresh, onCreateAgent, onConnectComputer, onOpenAgentDm, onOpenDmChannel, onOpenLiveExecution, onOpenWorkspaceBridge, onOpenWorkspaceView }: {
  snapshot: AppSnapshot;
  liveWork: TopologyLiveWorkPayload;
  topologyLoadStatus: Exclude<WorkspaceNavigationLoadStatus, "idle">;
  topbarProps: WorkspaceTopBarProps;
  channelMemberIndex: ChannelMemberIndex;
  inspectTarget: TopologyInspectTarget | null;
  topologyInspectorIntent: TopologyInspectorIntent | null;
  onTopologyInspectorIntent: (intent: TopologyInspectorIntent | null) => void;
  inspectorOpen: boolean;
  onInspectTarget: (target: TopologyInspectTarget) => void;
  onCollapseInspector: () => void;
  onRefresh: () => Promise<void>;
  onCreateAgent: (machineId?: string) => void;
  onConnectComputer: () => void;
  onOpenAgentDm: (agentId: string) => Promise<void>;
  onOpenDmChannel: (channelId: string) => void;
  onOpenLiveExecution: (executionId: string) => void;
  onOpenWorkspaceBridge: (bridge: WorkspaceBridgeRecord) => void;
  onOpenWorkspaceView: () => void;
}) {
  // ready 使用独立 key 重新挂载，确保 React Flow 首次 state 就来自完整节点，不经历 partial graph 的二次布局。
  const topologyMountKey = `${snapshot.currentServer?.id ?? "server"}:${topologyLoadStatus}`;
  return <TopologyGridView key={topologyMountKey} snapshot={snapshot} liveWork={liveWork} topologyLoadStatus={topologyLoadStatus} topbarProps={topbarProps} channelMemberIndex={channelMemberIndex} inspectTarget={inspectTarget} topologyInspectorIntent={topologyInspectorIntent} onTopologyInspectorIntent={onTopologyInspectorIntent} inspectorOpen={inspectorOpen} onInspectTarget={onInspectTarget} onCollapseInspector={onCollapseInspector} onRefresh={onRefresh} onCreateAgent={onCreateAgent} onConnectComputer={onConnectComputer} onOpenAgentDm={onOpenAgentDm} onOpenDmChannel={onOpenDmChannel} onOpenLiveExecution={onOpenLiveExecution} onOpenWorkspaceBridge={onOpenWorkspaceBridge} onOpenWorkspaceView={onOpenWorkspaceView} />;
}

type TopologyContextMenuState = {
  x: number;
  y: number;
  target: TopologyContextMenuTarget;
  actions: TopologyContextMenuAction[];
};

type TopologyNodePositionMap = Record<string, { x: number; y: number }>;

function topologySnapshotLiveWorkRefreshKey(snapshot: Pick<AppSnapshot, "runtimeExecutions" | "runtimeApprovals">): string {
  const activeStatuses = new Set<RuntimeExecutionRecord["status"]>(["queued", "delivered", "running", "waiting_approval"]);
  const executions = snapshot.runtimeExecutions
    .filter((execution) => activeStatuses.has(execution.status))
    .map((execution) => `${execution.id}:${execution.status}`);
  const approvals = snapshot.runtimeApprovals
    .filter((approval) => approval.status === "pending")
    .map((approval) => `${approval.id}:${approval.executionId ?? ""}`);
  // 只在执行进入、离开或切换关键状态时重取投影，避免流式输出事件持续刷新整个画布。
  return [...executions, ...approvals].sort().join("|");
}

function topologyLayoutStorageKey(userId: string, serverId: string): string {
  // 布局语义变化时升级版本，避免旧的手动坐标覆盖新的多 Workspace 默认规则。
  return `tyr-topology-layout:v3:${userId}:${serverId}`;
}

function readStoredTopologyNodePositions(storageKey: string): TopologyNodePositionMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const positions: TopologyNodePositionMap = {};
    for (const [nodeId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const x = (value as { x?: unknown }).x;
      const y = (value as { y?: unknown }).y;
      if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) positions[nodeId] = { x, y };
    }
    return positions;
  } catch {
    return {};
  }
}

function writeStoredTopologyNodePositions(storageKey: string, positions: TopologyNodePositionMap) {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(positions).length === 0) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, JSON.stringify(positions));
  } catch {
    // Layout persistence is a convenience; storage failures must not break topology controls.
  }
}

function clearStoredTopologyNodePositions(storageKey: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore unavailable localStorage so Organize still resets the in-memory layout.
  }
}

function topologyFlowNodesForGraph(
  graphNodes: TopologyGraphNode[],
  storedPositions: TopologyNodePositionMap,
  visualStates: ReadonlyMap<string, LivingTopologyNodeState>
): Node<TopologyFlowNodeData>[] {
  // 边框以最终展示坐标为准；拖动结束写入坐标后才重新计算，拖动过程中不会抖动。
  return topologyGraphNodesWithWorkspaceFrames(graphNodes, storedPositions).map((node) => {
    const visualState = visualStates.get(node.id) ?? resolveLivingTopologyNodeState({ kind: "other", resourceStatus: node.status });
    return {
      id: node.id,
      type: "topology",
      position: node.position,
      data: {
        graphNode: node,
        visualState,
        visualKey: `${topologyGraphNodeVisualKey(node)}|state:${livingTopologyNodeStateKey(visualState)}`
      },
      selectable: node.kind !== "workspace-panel" && node.kind !== "peer-workspace",
      draggable: node.kind !== "workspace-panel" && node.kind !== "server" && node.kind !== "peer-workspace",
      zIndex: node.kind === "workspace-panel" ? 0 : node.kind === "workspace-bridge" ? 18 : 10
    };
  });
}

function TopologyGridView({ snapshot, liveWork, topologyLoadStatus, topbarProps, channelMemberIndex, inspectTarget, topologyInspectorIntent, onTopologyInspectorIntent, inspectorOpen, onInspectTarget, onCollapseInspector, onRefresh, onCreateAgent, onConnectComputer, onOpenAgentDm, onOpenDmChannel, onOpenLiveExecution, onOpenWorkspaceBridge, onOpenWorkspaceView }: { snapshot: AppSnapshot; liveWork: TopologyLiveWorkPayload; topologyLoadStatus: Exclude<WorkspaceNavigationLoadStatus, "idle">; topbarProps: WorkspaceTopBarProps; channelMemberIndex: ChannelMemberIndex; inspectTarget: TopologyInspectTarget | null; topologyInspectorIntent: TopologyInspectorIntent | null; onTopologyInspectorIntent: (intent: TopologyInspectorIntent | null) => void; inspectorOpen: boolean; onInspectTarget: (target: TopologyInspectTarget) => void; onCollapseInspector: () => void; onRefresh: () => Promise<void>; onCreateAgent: (machineId?: string) => void; onConnectComputer: () => void; onOpenAgentDm: (agentId: string) => Promise<void>; onOpenDmChannel: (channelId: string) => void; onOpenLiveExecution: (executionId: string) => void; onOpenWorkspaceBridge: (bridge: WorkspaceBridgeRecord) => void; onOpenWorkspaceView: () => void }) {
  const operationalSnapshot = useMemo(() => topologyOperationalSnapshot(snapshot), [snapshot]);

  useEffect(() => {
    if (topologyLoadStatus !== "ready" || !(snapshot.peerWorkspaceTopologies ?? []).length) return;
    let refreshing = false;
    const refreshBridgeStructure = () => {
      if (refreshing) return;
      refreshing = true;
      void onRefresh().finally(() => {
        refreshing = false;
      });
    };
    // 目标 Workspace 的变更只推送给自身 realtime audience；短轮询只刷新直接 Bridge 资源，
    // 不扩大普通 Workspace 事件的投递范围。
    const timer = window.setInterval(refreshBridgeStructure, 10_000);
    return () => window.clearInterval(timer);
  }, [onRefresh, snapshot.currentServer?.id, snapshot.peerWorkspaceTopologies?.length, topologyLoadStatus]);

  const baseGraph = useMemo(() => topologyGraphForSnapshot(snapshot, channelMemberIndex), [
    channelMemberIndex,
    snapshot.currentServer?.id,
    snapshot.currentServer?.name,
    snapshot.currentUser,
    snapshot.humans,
    snapshot.machines,
    snapshot.agents,
    snapshot.channels,
    snapshot.resourceGrantSummaries,
    snapshot.devices,
    snapshot.deviceGrants,
    snapshot.workspaceBridges,
    snapshot.peerWorkspaceTopologies,
    snapshot.workspaceBridgeTopologyEdges
  ]);
  const graph = useMemo(() => topologyGraphWithLiveWork(baseGraph, liveWork), [baseGraph, liveWork]);
  const nodeVisualStates = useMemo(() => topologyLivingNodeStates({
    graph,
    communicationAgentProgress: snapshot.communicationAgentProgress,
    crossWorkspaceMessages: snapshot.crossWorkspaceMessages,
    currentWorkspaceId: snapshot.currentServer?.id
  }), [graph, snapshot.communicationAgentProgress, snapshot.crossWorkspaceMessages, snapshot.currentServer?.id]);
  const inspectorNodeId = useMemo(() => topologyNodeIdForInspectTarget(graph.nodes, graph.serverNodeId, inspectTarget), [graph.nodes, graph.serverNodeId, inspectTarget]);
  const inspectedNode = inspectorNodeId ? graph.nodes.find((node) => node.id === inspectorNodeId) : undefined;
  const inspectorVisible = topologyLoadStatus === "ready" && Boolean(inspectorOpen && inspectedNode);
  const topologyShellClassName = inspectorVisible ? "topology-routing-shell topology-inspector-open" : "topology-routing-shell";
  const topologyStorageKey = useMemo(() => topologyLayoutStorageKey(snapshot.currentUser.id, snapshot.currentServer?.id ?? "server"), [snapshot.currentServer?.id, snapshot.currentUser.id]);
  const [storedTopologyNodePositions, setStoredTopologyNodePositions] = useState<TopologyNodePositionMap>(() => readStoredTopologyNodePositions(topologyStorageKey));

  useEffect(() => {
    setStoredTopologyNodePositions(readStoredTopologyNodePositions(topologyStorageKey));
  }, [topologyStorageKey]);

  const automaticFlowNodes = useMemo<Node<TopologyFlowNodeData>[]>(() => topologyFlowNodesForGraph(graph.nodes, {}, nodeVisualStates), [graph.nodes, nodeVisualStates]);
  const initialFlowNodes = useMemo<Node<TopologyFlowNodeData>[]>(() => topologyFlowNodesForGraph(graph.nodes, storedTopologyNodePositions, nodeVisualStates), [graph.nodes, nodeVisualStates, storedTopologyNodePositions]);
  const automaticPositionNodeIds = useMemo(() => new Set(
    graph.nodes.filter((node) => !storedTopologyNodePositions[node.id]).map((node) => node.id)
  ), [graph.nodes, storedTopologyNodePositions]);
  const [flowNodes, setFlowNodes, handleFlowNodesChange] = useNodesState<Node<TopologyFlowNodeData>>(initialFlowNodes);
  const layoutCustomized = Object.keys(storedTopologyNodePositions).length > 0;

  const incomingFlowEdges = useMemo<Edge<StableTopologyFlowEdgeData>[]>(() => {
    const edges = graph.edges.map((edge) => {
      const markerPlacement = topologyBridgeMarkerPlacement(edge);
      const bridgeMarkerColor = edge.bridge?.status === "pending" ? "#f59e0b" : edge.bridge?.status === "revoked" ? "#94a3b8" : "#2563eb";
      const liveTone = edge.liveWork ? topologyLiveExecutionTone(edge.liveWork.status) : undefined;
      const bridgeFlowSignal = edge.bridge && snapshot.currentServer?.id
        ? dominantBridgeCommunicationFlowSignal(
            (snapshot.crossWorkspaceMessages ?? []).filter((message) => message.bridgeId === edge.bridge?.bridgeId),
            snapshot.currentServer.id
          )
        : undefined;
      const communicationFlow = [...(edge.communicationFlows ?? [])].sort((left, right) => {
        const priority: Record<CommunicationFlowTone, number> = { error: 0, response: 1, request: 2 };
        if (left.continuous !== right.continuous) return left.continuous ? -1 : 1;
        return priority[left.tone] - priority[right.tone];
      })[0];
      const flowDirection = communicationFlow?.direction ?? bridgeFlowSignal?.direction ?? "outbound";
      const flowTone: CommunicationFlowTone = communicationFlow?.tone ?? bridgeFlowSignal?.tone ?? "request";
      // 能量河道只跟随服务端确认的通信流、Bridge 消息或真实 delegation；静态关系不常驻流光。
      const messageFlowActive = Boolean(communicationFlow || bridgeFlowSignal || edge.liveWork && ["queued", "delivered", "running"].includes(edge.liveWork.status));
      const continuousFlow = communicationFlow?.continuous ?? bridgeFlowSignal?.continuous ?? Boolean(edge.liveWork);
      const liveMarkerColor = liveTone === "attention" ? "#f59e0b" : liveTone === "running" ? "#06b6d4" : "#64748b";
      const bridgeMarker = edge.bridge ? { type: MarkerType.ArrowClosed, width: 18, height: 18, color: bridgeMarkerColor } : undefined;
      const liveMarker = edge.liveWork ? { type: MarkerType.ArrowClosed, width: 16, height: 16, color: liveMarkerColor } : undefined;
      const edgeLabel = topologyBridgeEdgeLabel(edge);
      const bridgeCorridorHandles = edge.kind === "workspace-bridge-corridor" ? {
        sourceHandle: "right-source",
        targetHandle: "left-target"
      } : {};
      const bridgeCorridor = edge.kind === "workspace-bridge-corridor";
      const messageChannel = topologyEdgeUsesMessageChannel(edge);
      const pathOptions = topologyPathOptionsForEdge(edge.kind);
      const flowCreatedAt = communicationFlow?.createdAt ?? bridgeFlowSignal?.createdAt;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        data: {
          visualKey: `${topologyGraphEdgeVisualKey(edge)}|flow:${communicationFlow?.id ?? bridgeFlowSignal?.id ?? ""}:${flowDirection}:${flowTone}:${continuousFlow}`,
          fiberPath: edge.path === "straight" ? "straight" : "smoothstep",
          fiberPathOptions: pathOptions,
          fiberBridge: bridgeCorridor,
          fiberStatus: edge.bridge?.status ?? "active",
          fiberFlowing: messageFlowActive,
          fiberFlowDirection: flowDirection,
          fiberFlowTone: flowTone,
          fiberFlowContinuous: continuousFlow,
          fiberFlowStatus: communicationFlow?.status ?? edge.liveWork?.status,
          fiberFlowPhaseSeconds: topologyFlowPhaseSeconds(flowCreatedAt)
        },
        ...bridgeCorridorHandles,
        type: messageChannel
          ? "fiber"
          : "smoothstep",
        // 活动消息必须压住所有静态河道，但仍低于 zIndex=10 的资源卡片，避免光河穿过节点内容。
        zIndex: messageFlowActive ? 8 : 0,
        pathOptions,
        animated: !messageChannel && messageFlowActive,
        className: `${topologyBridgeEdgeClassName(edge)}${liveTone ? ` live-work tone-${liveTone}` : ""}${messageFlowActive ? ` live-message-flow flow-${flowTone} direction-${flowDirection} ${continuousFlow ? "flow-continuous" : "flow-transient"}` : ""}`,
        // 消息方向由河道内能量球表达；静态能力线和活动河道都不再添加箭头。
        markerStart: messageChannel ? undefined : markerPlacement === "both" ? bridgeMarker : undefined,
        markerEnd: messageChannel ? undefined : liveMarker ?? (markerPlacement === "both" || markerPlacement === "end" ? bridgeMarker : undefined),
        label: messageChannel ? undefined : edgeLabel,
        labelShowBg: !messageChannel && Boolean(edgeLabel),
        labelBgPadding: [8, 5] as [number, number],
        labelBgBorderRadius: 8,
        labelStyle: edgeLabel ? { fill: bridgeMarkerColor, fontSize: 11, fontWeight: 850 } : undefined,
        labelBgStyle: edgeLabel ? { fill: "#ffffff", fillOpacity: 0.94 } : undefined,
        style: { strokeWidth: communicationFlow || edge.liveWork ? 2.5 : edge.kind.includes("shared") ? 1.5 : edge.bridge ? 3 : 2 }
      };
    });
    // SVG 按 DOM 顺序绘制；活动河道必须最后绘制，避免共用路径上的静态灰线覆盖蓝色能量河。
    return edges.sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0));
  }, [graph.edges, snapshot.crossWorkspaceMessages, snapshot.currentServer?.id]);
  const [flowEdges, setFlowEdges] = useState<Edge<StableTopologyFlowEdgeData>[]>(incomingFlowEdges);
  const [flowBoundsKey, setFlowBoundsKey] = useState("initial");
  const [flowFitRequestKey, setFlowFitRequestKey] = useState(0);
  const [flowViewportReady, setFlowViewportReady] = useState(false);
  const revealFlowViewport = useCallback(() => setFlowViewportReady(true), []);
  const [topologyContextMenu, setTopologyContextMenu] = useState<TopologyContextMenuState | null>(null);
  const [topologyActionNotice, setTopologyActionNotice] = useState("");
  const flowCardRef = useRef<HTMLDivElement>(null);
  const topologyContextMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 实时状态只替换真正发生变化的节点，保留其余节点引用、坐标、选中状态和当前视口。
    setFlowNodes((current) => reconcileTopologyFlowNodes(current, initialFlowNodes, automaticPositionNodeIds));
  }, [automaticPositionNodeIds, initialFlowNodes, setFlowNodes]);

  useEffect(() => {
    // Agent 状态变化不会改变连线，保留边引用以避免无关 SVG 重新渲染。
    setFlowEdges((current) => reconcileTopologyFlowEdges(current, incomingFlowEdges));
  }, [incomingFlowEdges]);

  useEffect(() => {
    if (inspectTarget) return;
    // GRID 总览没有具体目标，React Flow 的内部 selected 标记也必须同步清空。
    setFlowNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
  }, [inspectTarget, setFlowNodes]);

  useEffect(() => {
    const element = flowCardRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setFlowBoundsKey(`${width}x${height}`));
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!topologyContextMenu) return;
    function handlePointerDown(event: PointerEvent) {
      if (shouldCloseContextMenuForPointerTarget(topologyContextMenuRef.current, event.target)) setTopologyContextMenu(null);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (shouldCloseContextMenuForKey(event.key)) setTopologyContextMenu(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [topologyContextMenu]);

  function inspectGraphNode(node: TopologyGraphNode) {
    // Bridge metadata marks how a remote resource is reachable; it must not replace
    // the Computer / Agent / Device's own operational inspector.
    if (node.row) {
      const action = topologyNodeAction("canvas", node.row);
      if (action.type === "inspect") onInspectTarget(action.target);
      return;
    }
    if (node.bridge?.bridgeId) {
      const bridge = (snapshot.workspaceBridges ?? []).find((item) => item.id === node.bridge?.bridgeId)
        ?? (snapshot.workspaceBridgeTopologyEdges ?? []).find((item) => item.bridgeId === node.bridge?.bridgeId)?.bridge;
      if (bridge) onOpenWorkspaceBridge(bridge);
      return;
    }
    if (node.kind === "server") onInspectTarget({ kind: "server", id: snapshot.currentServer?.id ?? "current" });
  }

  function currentGraphNode(node: TopologyGraphNode): TopologyGraphNode {
    // 未变化节点会保留 React Flow 数据引用；交互时按 id 读取最新业务对象，避免菜单或详情使用旧快照。
    return graph.nodes.find((item) => item.id === node.id) ?? node;
  }

  function openTopologyContextMenu(event: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number }, target: TopologyContextMenuTarget) {
    event.preventDefault();
    event.stopPropagation();
    setTopologyActionNotice("");
    const actions = topologyContextActionsForTarget({ target, snapshot: operationalSnapshot });
    if (actions.length === 0) {
      setTopologyContextMenu(null);
      return;
    }
    const menuHeight = Math.min(420, actions.length * 34 + 12);
    const position = clampContextMenuPosition({
      x: event.clientX,
      y: event.clientY,
      menuWidth: 250,
      menuHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      padding: 8
    });
    setTopologyContextMenu({ ...position, target, actions });
  }

  function selectedTopologyContextNodes(): TopologyGraphNode[] {
    return flowNodes
      .filter((node) => node.selected)
      .map((node) => currentGraphNode(node.data.graphNode));
  }

  function inspectNodeWithIntent(node: TopologyGraphNode | undefined, intent?: TopologyInspectorIntent) {
    if (!node) return;
    inspectGraphNode(node);
    if (intent) onTopologyInspectorIntent(intent);
  }

  function edgeEndpointNode(edge: TopologyGraphEdge, endpoint: "source" | "target"): TopologyGraphNode | undefined {
    const nodeId = endpoint === "source" ? edge.source : edge.target;
    return graph.nodes.find((node) => node.id === nodeId);
  }

  function agentNodeForDevice(deviceId: string): TopologyGraphNode | undefined {
    const grant = (snapshot.deviceGrants ?? []).find((item) => item.deviceId === deviceId && item.status === "active");
    return grant ? graph.nodes.find((node) => node.row?.kind === "agent" && node.row.id === grant.agentId) : undefined;
  }

  async function executeTopologyContextAction(action: TopologyContextMenuAction) {
    const menu = topologyContextMenu;
    if (!menu || action.disabledReason) return;
    setTopologyContextMenu(null);
    const target = menu.target;
    const node = target.kind === "node" ? target.node : undefined;
    const row = node?.row;

    if (action.id === "refresh-topology") {
      await onRefresh();
      return;
    }
    if (action.id === "fit-view") {
      setFlowFitRequestKey((key) => key + 1);
      return;
    }
    if (action.id === "connect-computer") {
      onConnectComputer();
      return;
    }
    if (action.id === "create-agent") {
      onCreateAgent(row?.kind === "machine" ? row.machine.id : undefined);
      return;
    }
    if (action.id === "inspect") {
      inspectNodeWithIntent(node);
      return;
    }

    if (row?.kind === "machine") {
      await executeMachineContextAction(action.id, row.machine);
      return;
    }
    if (row?.kind === "agent") {
      await executeAgentContextAction(action.id, row.agent, node);
      return;
    }
    if (row?.kind === "human") {
      await executeHumanContextAction(action.id, row.human, node);
      return;
    }
    if (row?.kind === "device") {
      await executeDeviceContextAction(action.id, row.device, node);
      return;
    }
    if (target.kind === "edge") {
      await executeEdgeContextAction(action.id, target.edge);
      return;
    }
    if (target.kind === "selection") {
      await executeSelectionContextAction(action.id, target.nodes);
    }
  }

  async function executeMachineContextAction(actionId: TopologyContextMenuActionId, machine: MachineRecord) {
    if (actionId === "start-all-agents" || actionId === "stop-all-agents" || actionId === "restart-all-agents") {
      const operation = actionId === "start-all-agents" ? "start-all" : actionId === "stop-all-agents" ? "stop-all" : "restart-all";
      await api(`/api/machines/${encodeURIComponent(machine.id)}/${operation}`, { method: "POST", body: "{}" });
      await onRefresh();
      return;
    }
    if (actionId === "copy-connect-command") {
      const command = await api<MachineConnectCommand>(`/api/machines/${encodeURIComponent(machine.id)}/connect-command`);
      const commandText = connectCommandPresentation(command, import.meta.env.DEV, currentConnectPlatform(), "INSTALL").command;
      if (commandText) await copyMessageText(commandText);
      return;
    }
    if (actionId === "reset-all-agents") {
      if (!(await confirmDialog({
        title: `Reset all agents on ${machine.name}?`,
        description: "This restarts their runtime sessions.",
        confirmText: "Reset all agents",
        tone: "danger"
      }))) return;
      await api(`/api/machines/${encodeURIComponent(machine.id)}/reset-all`, { method: "POST", body: JSON.stringify({ mode: "restart" }) });
      await onRefresh();
      return;
    }
    if (actionId === "delete-computer") {
      const agents = operationalSnapshot.agents.filter((agent) => agent.machineId === machine.id);
      if (agents.length > 0) {
        setTopologyActionNotice("Remove agents before deleting this Device.");
        return;
      }
      if (!(await confirmDialog({
        title: `Delete device ${machine.name}?`,
        description: "Existing chat history stays.",
        confirmText: "Delete device",
        tone: "danger"
      }))) return;
      await api(`/api/machines/${encodeURIComponent(machine.id)}`, { method: "DELETE" });
      await onRefresh();
    }
  }

  async function executeAgentContextAction(actionId: TopologyContextMenuActionId, agent: AgentRecord, node: TopologyGraphNode | undefined) {
    if (actionId === "message-agent") {
      await onOpenAgentDm(agent.id);
      return;
    }
    if (actionId === "start-agent" || actionId === "stop-agent" || actionId === "restart-agent") {
      const operation = actionId === "start-agent" ? "start" : actionId === "stop-agent" ? "stop" : "restart";
      await api(`/api/agents/${encodeURIComponent(agent.id)}/${operation}`, { method: "POST", body: "{}" });
      await onRefresh();
      return;
    }
    if (actionId === "view-agent-activity") {
      inspectNodeWithIntent(node, { key: Date.now(), kind: "agent", id: agent.id, action: "activity" });
      return;
    }
    if (actionId === "open-agent-workspace") {
      inspectNodeWithIntent(node, { key: Date.now(), kind: "agent", id: agent.id, action: "workspace" });
      return;
    }
    if (actionId === "reset-agent") {
      if (!(await confirmDialog({
        title: `Reset ${agent.displayName}?`,
        description: "This clears the saved runtime session and starts fresh.",
        confirmText: "Reset session",
        tone: "danger"
      }))) return;
      await api(`/api/agents/${encodeURIComponent(agent.id)}/reset`, { method: "POST", body: JSON.stringify({ mode: "restart" }) });
      await onRefresh();
      return;
    }
    if (actionId === "delete-agent") {
      if (!(await confirmDialog({
        title: `Delete ${agent.displayName}?`,
        description: "Existing chat history stays.",
        confirmText: "Delete agent",
        tone: "danger"
      }))) return;
      await api(`/api/agents/${encodeURIComponent(agent.id)}`, { method: "DELETE" });
      await onRefresh();
    }
  }

  async function executeHumanContextAction(actionId: TopologyContextMenuActionId, human: UserRecord, node: TopologyGraphNode | undefined) {
    if (actionId === "copy-human-email") {
      if (human.email) await copyMessageText(human.email);
      return;
    }
    if (actionId === "view-human-resource-access") {
      inspectNodeWithIntent(node, { key: Date.now(), kind: "human", id: human.id, action: "resource-access" });
      return;
    }
    if (actionId === "remove-human") {
      const serverId = workspaceCacheServerId(snapshot);
      if (!(await confirmDialog({
        title: `Remove ${human.displayName} from this workspace?`,
        description: "Their account will not be deleted.",
        confirmText: "Remove member",
        tone: "danger"
      }))) return;
      await api(`/api/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(human.id)}`, { method: "DELETE" });
      await onRefresh();
    }
  }

  async function executeDeviceContextAction(actionId: TopologyContextMenuActionId, device: NonNullable<AppSnapshot["devices"]>[number], node: TopologyGraphNode | undefined) {
    if (actionId === "open-pinned-agent-dm") {
      const agentNode = agentNodeForDevice(device.id);
      if (agentNode?.row?.kind === "agent") await onOpenAgentDm(agentNode.row.agent.id);
      return;
    }
    if (actionId === "view-device-grants") {
      inspectNodeWithIntent(node, { key: Date.now(), kind: "device", id: device.id, action: "grants" });
      return;
    }
    if (actionId === "delete-device") {
      if (!(await confirmDialog({
        title: `Delete mobile device ${device.displayName}?`,
        confirmText: "Delete mobile device",
        tone: "danger"
      }))) return;
      await api(`/api/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
      await onRefresh();
    }
  }

  async function executeEdgeContextAction(actionId: TopologyContextMenuActionId, edge: TopologyGraphEdge) {
    if (actionId === "inspect-relation-source") {
      inspectNodeWithIntent(edgeEndpointNode(edge, "source"));
      return;
    }
    if (actionId === "inspect-relation-target") {
      inspectNodeWithIntent(edgeEndpointNode(edge, "target"));
      return;
    }
    if (actionId === "view-relation-grant") {
      inspectNodeWithIntent(edgeEndpointNode(edge, "target") ?? edgeEndpointNode(edge, "source"));
    }
  }

  async function executeSelectionContextAction(actionId: TopologyContextMenuActionId, nodes: TopologyGraphNode[]) {
    const agentRows = nodes.map((node) => node.row).filter((row): row is Extract<TopologyRow, { kind: "agent" }> => row?.kind === "agent");
    const machineRows = nodes.map((node) => node.row).filter((row): row is Extract<TopologyRow, { kind: "machine" }> => row?.kind === "machine");
    if (actionId === "clear-selection") {
      clearTopologySelection();
      return;
    }
    if (actionId === "bulk-message-first-agent") {
      if (agentRows[0]) await onOpenAgentDm(agentRows[0].agent.id);
      return;
    }
    if (actionId === "bulk-start-agents" || actionId === "bulk-stop-agents" || actionId === "bulk-restart-agents") {
      const operation = actionId === "bulk-start-agents" ? "start" : actionId === "bulk-stop-agents" ? "stop" : "restart";
      for (const row of agentRows) {
        await api(`/api/agents/${encodeURIComponent(row.agent.id)}/${operation}`, { method: "POST", body: "{}" });
      }
      clearTopologySelection();
      await onRefresh();
      return;
    }
    if (actionId === "bulk-start-computers" || actionId === "bulk-stop-computers" || actionId === "bulk-restart-computers") {
      const operation = actionId === "bulk-start-computers" ? "start-all" : actionId === "bulk-stop-computers" ? "stop-all" : "restart-all";
      for (const row of machineRows) {
        await api(`/api/machines/${encodeURIComponent(row.machine.id)}/${operation}`, { method: "POST", body: "{}" });
      }
      clearTopologySelection();
      await onRefresh();
    }
  }

  function clearTopologySelection() {
    setFlowNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
  }

  function persistTopologyNodePosition(node: Node<TopologyFlowNodeData>) {
    if (currentGraphNode(node.data.graphNode).kind === "workspace-panel") return;
    const position = { x: Math.round(node.position.x), y: Math.round(node.position.y) };
    setStoredTopologyNodePositions((current) => {
      const next = { ...current, [node.id]: position };
      writeStoredTopologyNodePositions(topologyStorageKey, next);
      return next;
    });
  }

  function organizeTopologyLayout() {
    clearStoredTopologyNodePositions(topologyStorageKey);
    setStoredTopologyNodePositions({});
    setFlowNodes(automaticFlowNodes);
    setFlowFitRequestKey((key) => key + 1);
  }

  return (
    <div className="view topology-view topology-routing-view">
      <TopBar title="Platform Topology" {...topbarProps} />
      <div className={topologyShellClassName}>
        <section className="topology-routing-main">
          <div className="topology-routing-head">
            <div>
              <h1>Active Topology Routing</h1>
              <p>Active mapped systems, software processes, humans, shared agents, and local routing.</p>
            </div>
            <div className="topology-routing-actions">
              <div className="workspace-view-switch" role="group" aria-label="Workspace visualization">
                <button type="button" className="active" aria-pressed="true"><Network size={14} /> Topology</button>
                <button type="button" onPointerEnter={preloadWorkspaceSpatialView} onFocus={preloadWorkspaceSpatialView} onClick={onOpenWorkspaceView}><Building2 size={14} /> Workspace View</button>
              </div>
              <button className={`btn small topology-organize${layoutCustomized ? " active" : ""}`} type="button" disabled={topologyLoadStatus !== "ready"} title={layoutCustomized ? "Restore organized layout" : "Organize layout"} data-layout-customized={layoutCustomized} onClick={organizeTopologyLayout}>
                <Network size={14} /> Organize
              </button>
            </div>
          </div>

          <div className="topology-flow-card" ref={flowCardRef} aria-busy={topologyLoadStatus === "loading"}>
            {topologyLoadStatus === "loading" ? (
              <div className="topology-load-state" role="status">
                <div className="topology-load-state-card">
                  <span className="topology-load-state-icon"><Network size={22} /></span>
                  <b>Loading topology</b>
                  <small>Mapping workspace connections…</small>
                </div>
              </div>
            ) : topologyLoadStatus === "error" ? (
              <div className="topology-load-state error" role="alert">
                <div className="topology-load-state-card">
                  <span className="topology-load-state-icon"><AlertTriangle size={22} /></span>
                  <b>Topology could not be loaded</b>
                  <small>Refresh the workspace to try again.</small>
                  <button className="btn small" type="button" onClick={() => void onRefresh()}><RefreshCw size={14} /> Retry</button>
                </div>
              </div>
            ) : flowNodes.length === 1 ? (
              <div className="topology-empty-panel flow-empty">
                <Monitor size={34} />
                <b>No devices connected</b>
                <button className="btn primary small" onClick={onConnectComputer}><Plus size={14} /> Add Device</button>
              </div>
            ) : (
              <ReactFlow
                className={flowViewportReady ? "topology-flow-ready" : "topology-flow-initializing"}
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={topologyFlowNodeTypes}
                edgeTypes={topologyFlowEdgeTypes}
                onNodeClick={(event, node) => {
                  const graphNode = currentGraphNode(node.data.graphNode);
                  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-live-execution-id]") : null;
                  const executionId = target?.dataset.liveExecutionId;
                  const executionAvailable = Boolean(
                    graphNode.liveWork?.executions.some((item) => item.id === executionId)
                    || graphNode.liveWork?.activities.some((item) => item.executionId === executionId)
                  );
                  if (executionId && executionAvailable) {
                    onTopologyInspectorIntent(null);
                    onOpenLiveExecution(executionId);
                    return;
                  }
                  inspectGraphNode(graphNode);
                  onTopologyInspectorIntent(null);
                }}
                onNodeContextMenu={(event, node) => openTopologyContextMenu(event, { kind: "node", node: currentGraphNode(node.data.graphNode) })}
                onEdgeContextMenu={(event, edge) => {
                  const graphEdge = graph.edges.find((item) => item.id === edge.id);
                  if (graphEdge) openTopologyContextMenu(event, { kind: "edge", edge: graphEdge, nodes: graph.nodes });
                }}
                onEdgeClick={(_, edge) => {
                  const graphEdge = graph.edges.find((item) => item.id === edge.id);
                  const executionId = graphEdge?.communicationFlows?.[0]?.executionId;
                  if (executionId) {
                    onOpenLiveExecution(executionId);
                    return;
                  }
                  const bridgeId = graphEdge?.bridge?.bridgeId;
                  if (!bridgeId) return;
                  const bridge = (snapshot.workspaceBridges ?? []).find((item) => item.id === bridgeId)
                    ?? (snapshot.workspaceBridgeTopologyEdges ?? []).find((item) => item.bridgeId === bridgeId)?.bridge;
                  if (bridge) onOpenWorkspaceBridge(bridge);
                }}
                onPaneContextMenu={(event) => {
                  const selectedNodes = selectedTopologyContextNodes();
                  openTopologyContextMenu(event, selectedNodes.length > 0 ? { kind: "selection", nodes: selectedNodes } : { kind: "pane" });
                }}
                onNodesChange={handleFlowNodesChange}
                onNodeDragStop={(_, node) => persistTopologyNodePosition(node)}
                minZoom={0.45}
                maxZoom={1.4}
                nodesDraggable
                nodesConnectable={false}
                elementsSelectable
                proOptions={topologyFlowProOptions}
              >
                <TopologyFlowAutoFit boundsKey={flowBoundsKey} onReady={revealFlowViewport} />
                <TopologyFlowFitRequest requestKey={flowFitRequestKey} />
                <Background color="#d8dee8" gap={34} size={1} />
                <Controls showInteractive={false} position="bottom-left" />
              </ReactFlow>
            )}
            {topologyLoadStatus === "ready" && topologyContextMenu && (
              <TopologyContextMenu
                refElement={topologyContextMenuRef}
                menu={topologyContextMenu}
                onAction={(action) => void executeTopologyContextAction(action)}
              />
            )}
            {topologyActionNotice && <p className="topology-action-notice" role="status">{topologyActionNotice}</p>}
          </div>
        </section>
        {inspectorVisible && <button className="topology-inspector-backdrop" type="button" aria-label="Close topology details" onClick={onCollapseInspector} />}
        {topologyLoadStatus === "ready" && inspectedNode && <TopologyInspector
          node={inspectedNode}
          open={inspectorVisible}
          snapshot={operationalSnapshot}
          channelMemberIndex={channelMemberIndex}
          onRefresh={onRefresh}
          onCreateAgent={onCreateAgent}
          onConnectComputer={onConnectComputer}
          onOpenAgentDm={onOpenAgentDm}
          onOpenDmChannel={onOpenDmChannel}
          onOpenLiveExecution={onOpenLiveExecution}
          onOpenWorkspaceBridge={(bridgeId) => {
            const bridge = (snapshot.workspaceBridges ?? []).find((item) => item.id === bridgeId)
              ?? (snapshot.incomingWorkspaceBridges ?? []).find((item) => item.id === bridgeId)
              ?? (snapshot.workspaceBridgeTopologyEdges ?? []).find((item) => item.bridgeId === bridgeId)?.bridge;
            if (bridge) onOpenWorkspaceBridge(bridge);
          }}
          intent={topologyInspectorIntent}
          onCollapse={onCollapseInspector}
        />}
      </div>
    </div>
  );
}

function topologyNodeIdForInspectTarget(nodes: TopologyGraphNode[], serverNodeId: string, target: TopologyInspectTarget | null): string | null {
  if (!target) return null;
  if (target.kind === "server") return serverNodeId;
  const exactId = `${target.kind === "machine" ? "machine" : target.kind}:${target.id}`;
  if (nodes.some((node) => node.id === exactId)) return exactId;
  const matched = nodes.find((node) => {
    const row = node.row;
    if (!row) return false;
    if (target.kind === "human" && row.kind === "human") return row.human.id === target.id;
    return row.kind === target.kind && row.id === target.id;
  });
  return matched?.id ?? null;
}

type TopologyFlowNodeData = StableTopologyFlowNodeData;

const TOPOLOGY_MESSAGE_CHANNEL_EDGE_KINDS = new Set<TopologyGraphEdgeKind>([
  "server-machine",
  "server-agent",
  "machine-agent",
  "agent-delegation",
  "workspace-bridge-corridor",
  "peer-workspace-machine",
  "peer-workspace-agent"
]);

function topologyEdgeUsesMessageChannel(edge: TopologyGraphEdge): boolean {
  // 这些结构边可能承载真实消息；空闲和活动阶段必须使用同一个 renderer，避免切换时线路跳位。
  return TOPOLOGY_MESSAGE_CHANNEL_EDGE_KINDS.has(edge.kind) || Boolean(edge.communicationFlows?.length || edge.liveWork);
}

function topologyFlowPhaseSeconds(createdAt?: string): number {
  const createdAtMs = Date.parse(createdAt ?? "");
  if (!Number.isFinite(createdAtMs)) return 0;
  // 所有分段从同一个权威时间戳取相位，保证 TYR -> Device -> Agent 与 Bridge 两侧同步流动。
  return -((createdAtMs / 1_000) % 1.35);
}

const topologyFlowNodeTypes = {
  topology: TopologyFlowNode
};
const topologyFlowEdgeTypes = {
  fiber: TopologyFiberEdge
};
const topologyFlowProOptions = { hideAttribution: true };

type TopologyFiberEdgeData = StableTopologyFlowEdgeData & {
  fiberPath?: "straight" | "smoothstep";
  fiberPathOptions?: { borderRadius: number; offset: number; stepPosition: number };
  fiberBridge?: boolean;
  fiberStatus?: "active" | "pending" | "revoked";
  fiberFlowing?: boolean;
  fiberFlowDirection?: "inbound" | "outbound";
  fiberFlowTone?: CommunicationFlowTone;
  fiberFlowContinuous?: boolean;
  fiberFlowStatus?: TopologyLiveWorkPayload["flows"][number]["status"];
  fiberFlowPhaseSeconds?: number;
};

function TopologyFiberEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<Edge<TopologyFiberEdgeData>>) {
  const pathOptions = data?.fiberPathOptions ?? { borderRadius: 16, offset: 22, stepPosition: 0.42 };
  const centerPath = data?.fiberPath === "straight"
    ? getStraightPath({ sourceX, sourceY, targetX, targetY })[0]
    : getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, ...pathOptions })[0];
  const status = data?.fiberStatus ?? "active";
  const flowDirection = data?.fiberFlowDirection ?? "outbound";
  const flowTone = data?.fiberFlowTone ?? "request";
  const flowHolding = flowTone === "request" && data?.fiberFlowStatus === "running";
  const fiberStyle = {
    "--topology-flow-phase": `${data?.fiberFlowPhaseSeconds ?? 0}s`
  } as CSSProperties;
  const sourcePortState = data?.fiberFlowing
    ? flowDirection === "outbound" ? " sending" : " receiving"
    : "";
  const targetPortState = data?.fiberFlowing
    ? flowDirection === "outbound" ? " receiving" : " sending"
    : "";
  return (
    <g className={`topology-fiber-edge status-${status}${data?.fiberBridge ? " bridge-channel" : " relation-channel"}${data?.fiberFlowing ? ` flowing flow-${flowTone} direction-${flowDirection} ${data.fiberFlowContinuous ? "flow-continuous" : "flow-transient"}${flowHolding ? " flow-holding" : ""}` : ""}${selected ? " selected" : ""}`} data-edge-id={id} style={fiberStyle}>
      <path className="topology-fiber-hit" d={centerPath} fill="none" />
      <path className="topology-fiber-bed" d={centerPath} fill="none" />
      <path className="topology-fiber-base" d={centerPath} fill="none" />
      {data?.fiberFlowing && (
        <>
          <path className="topology-fiber-flow-glow" d={centerPath} fill="none" />
          <path className="topology-fiber-flow-river" d={centerPath} fill="none" />
          <path className="topology-fiber-energy large" d={centerPath} fill="none" pathLength="100" />
          <path className="topology-fiber-energy small" d={centerPath} fill="none" pathLength="100" />
        </>
      )}
      {(data?.fiberBridge || data?.fiberFlowing) && (
        <>
          <g className={`topology-fiber-port source${sourcePortState}`} transform={`translate(${sourceX} ${sourceY})`}>
            <circle r="8" /><circle r="4.5" /><circle r="2" />
          </g>
          <g className={`topology-fiber-port target${targetPortState}`} transform={`translate(${targetX} ${targetY})`}>
            <circle r="8" /><circle r="4.5" /><circle r="2" />
          </g>
        </>
      )}
    </g>
  );
}

function topologyPathOptionsForEdge(kind: TopologyGraphEdgeKind) {
  // Top-level links bend earlier from the source; child links bend closer to the midpoint for a calmer tree shape.
  if (kind === "server-human" || kind === "server-machine" || kind === "server-channel" || kind === "server-group-zone" || kind === "server-shared" || kind === "server-device") {
    return { borderRadius: 10, offset: 18, stepPosition: 0.35 };
  }
  if (kind === "group-zone-channel") {
    return { borderRadius: 10, offset: 18, stepPosition: 0.42 };
  }
  // Membership links connect legacy conversation records to visible Agent nodes without implying Computer ownership.
  if (kind === "channel-agent") {
    return { borderRadius: 10, offset: 18, stepPosition: 0.64 };
  }
  if (kind === "agent-device") {
    return { borderRadius: 10, offset: 18, stepPosition: 0.58 };
  }
  if (kind === "agent-delegation") {
    return { borderRadius: 12, offset: 20, stepPosition: 0.5 };
  }
  return { borderRadius: 10, offset: 18, stepPosition: 0.42 };
}

function workspaceBridgeCardSummary(bridge: TopologyGraphNode["bridge"]): string {
  const status = titleCase(bridge?.status ?? "active");
  const direction = bridge?.direction === "bidirectional" ? "Two-way" : "One-way";
  return `${status} · ${direction}`;
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function TopologyFlowAutoFit({ boundsKey, onReady }: { boundsKey: string; onReady: () => void }) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (fittedRef.current || !nodesInitialized || boundsKey === "initial") return;
    // 首次画布在隐藏状态完成一次无动画定位，后续节点或容器变化都不再改写用户视口。
    let cancelled = false;
    const fitFrame = requestAnimationFrame(() => {
      if (cancelled || fittedRef.current) return;
      fittedRef.current = true;
      // fitView 完成后再显示画布，确保用户看不到定位前的默认 transform。
      void fitView({ padding: 0.14, duration: 0 }).then(onReady, onReady);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(fitFrame);
    };
  }, [boundsKey, fitView, nodesInitialized, onReady]);

  return null;
}

function TopologyFlowFitRequest({ requestKey }: { requestKey: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (requestKey <= 0) return;
    void fitView({ padding: 0.14, duration: 220 });
  }, [fitView, requestKey]);
  return null;
}

function TopologyContextMenu({ refElement, menu, onAction }: { refElement: { current: HTMLDivElement | null }; menu: TopologyContextMenuState; onAction: (action: TopologyContextMenuAction) => void }) {
  let previousGroup: TopologyContextMenuAction["group"] | undefined;
  return (
    <div ref={refElement} className="topology-context-menu" style={{ left: menu.x, top: menu.y }} role="menu" aria-label="Topology context menu">
      {menu.actions.map((action) => {
        const separated = Boolean(previousGroup && previousGroup !== action.group);
        previousGroup = action.group;
        const Icon = topologyContextMenuIcon(action.id);
        const className = [
          "topology-context-menu-button",
          action.danger ? "danger" : "",
          separated ? "separated" : ""
        ].filter(Boolean).join(" ");
        return (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            className={className}
            disabled={Boolean(action.disabledReason)}
            title={action.disabledReason ?? action.label}
            onClick={() => onAction(action)}
          >
            <Icon size={15} />
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function topologyContextMenuIcon(actionId: TopologyContextMenuActionId) {
  if (actionId.includes("delete") || actionId === "remove-human") return Trash2;
  if (actionId.includes("reset") || actionId.includes("archive")) return AlertTriangle;
  if (actionId.includes("start")) return Play;
  if (actionId.includes("stop")) return Square;
  if (actionId.includes("restart") || actionId === "refresh-topology") return RefreshCw;
  if (actionId.includes("message") || actionId.includes("channel") || actionId.includes("members")) return MessageSquare;
  if (actionId.includes("computer") || actionId.includes("connect")) return Monitor;
  if (actionId.includes("agent")) return Terminal;
  if (actionId.includes("human") || actionId.includes("invite")) return UserRound;
  if (actionId.includes("device")) return Smartphone;
  if (actionId.includes("copy")) return Copy;
  if (actionId.includes("pin")) return Pin;
  if (actionId.includes("workspace")) return Folder;
  if (actionId.includes("activity")) return Activity;
  if (actionId === "fit-view") return Network;
  return ExternalLink;
}

function TopologyFlowNode({ data, selected }: { data: TopologyFlowNodeData; selected?: boolean }) {
  const node = data.graphNode;
  const visualState = data.visualState;
  const visualActive = (visualState.activeCount > 0 || visualState.terminal)
    && visualState.phase !== "idle"
    && visualState.phase !== "offline";
  const signalPresentation = topologyNodeSignalPresentation(visualState);
  const signalClassName = visualActive
    ? ` signal-active${signalPresentation.halo !== "none" ? ` signal-halo halo-${signalPresentation.halo}` : ""} phase-${visualState.phase} tone-${visualState.tone} motion-${visualState.motion} role-${visualState.flowRole}`
    : "";
  const palette = LIVING_TOPOLOGY_PALETTE[visualState.tone];
  const signalStyle = {
    "--topology-node-signal": palette.accent,
    "--topology-node-glow": palette.glow
  } as CSSProperties;
  const signalIndicator = visualActive ? signalPresentation.indicator : "none";
  const signalBeacon = signalIndicator !== "none" ? (
    <span className={`topology-node-signal-beacon indicator-${signalIndicator}`} aria-label={visualState.label} title={visualState.label}>
      <span className="topology-node-signal-ring" aria-hidden="true" />
      <span className="topology-node-signal-core" aria-hidden="true" />
    </span>
  ) : null;
  if (node.kind === "workspace-panel") {
    const frameStyle = {
      width: node.frame?.width ?? 520,
      height: node.frame?.height ?? 280
    } as CSSProperties;
    return (
      <div
        className={`topology-flow-panel ${node.frame?.tone ?? "local"}`}
        style={frameStyle}
        data-topology-kind={node.kind}
        data-topology-node-id={node.id}
        aria-hidden="true"
      />
    );
  }

  if (node.kind === "server" || node.kind === "peer-workspace") {
    const isPeerWorkspace = node.kind === "peer-workspace";
    return (
      <div
        className={`topology-workspace-label${isPeerWorkspace ? " peer" : ""}${selected ? " selected" : ""}${signalClassName}`}
        style={signalStyle}
        data-topology-kind={node.kind}
        data-topology-node-id={node.id}
        data-topology-node-phase={visualState.phase}
        title={isPeerWorkspace ? "Connected workspace" : `Open ${node.label} settings`}
      >
        <b>{node.label}</b>
      </div>
    );
  }

  if (node.kind === "workspace-bridge") {
    const bridge = node.bridge;
    const summaryLabel = workspaceBridgeCardSummary(bridge);
    const permissionsLabel = bridge?.permissions.length ? bridge.permissions.join(", ") : "No shared permissions";
    const statusLabel = bridge?.status ?? "active";
    return (
      <div
        className={`topology-flow-node workspace-bridge ${statusLabel}${selected ? " selected" : ""}${signalClassName}`}
        style={signalStyle}
        data-topology-kind={node.kind}
        data-topology-node-id={node.id}
        data-topology-node-phase={visualState.phase}
        data-workspace-bridge-id={bridge?.bridgeId}
      >
        <Handle id="left-target" type="target" position={Position.Left} className="topology-flow-handle" />
        <div className="workspace-bridge-card" title={permissionsLabel}>
          <span className="workspace-bridge-icon"><Network size={18} /></span>
          <span className="workspace-bridge-copy">
            <b>{node.label}</b>
            <small>{summaryLabel}</small>
          </span>
          <span className="workspace-bridge-state">{statusLabel}</span>
        </div>
        <Handle id="right-source" type="source" position={Position.Right} className="topology-flow-handle" />
      </div>
    );
  }

  const Icon = node.kind === "human" ? UserRound
      : node.kind === "machine" ? Monitor
        : node.kind === "device" ? Smartphone
        : node.kind === "channel" ? Hash
          : node.kind === "group-zone" ? MessageSquare
          : node.kind === "shared-zone" ? Users
            : Terminal;
  const tyrOrchestrator = node.kind === "agent" && node.row?.kind === "agent" && isCommunicationAgent(node.row.agent);
  const NodeIcon = tyrOrchestrator ? Network : Icon;
  const liveExecutions = node.kind === "agent" ? node.liveWork?.executions.slice(0, 2) ?? [] : [];
  const liveExecutionIds = new Set(node.liveWork?.executions.map((execution) => execution.id) ?? []);
  const recentActivity = node.kind === "agent"
    ? primaryTopologyLiveActivity(node.liveWork?.activities.filter((activity) => !liveExecutionIds.has(activity.executionId)) ?? [])
    : undefined;
  const hasLiveWork = liveExecutions.length > 0 || Boolean(recentActivity);
  return (
    <div
      className={`topology-flow-node ${node.kind}${tyrOrchestrator ? " tyr-orchestrator" : ""}${selected ? " selected" : ""}${node.shared ? " shared" : ""}${hasLiveWork ? " has-live-work" : ""}${signalClassName}`}
      style={signalStyle}
      data-topology-kind={node.kind}
      data-topology-node-id={node.id}
      data-topology-node-phase={visualState.phase}
      data-topology-row-id={node.row?.id}
    >
      <Handle type="target" position={Position.Top} className="topology-flow-handle" />
      <Handle id="left-target" type="target" position={Position.Left} className="topology-flow-handle" />
      <span className="topology-flow-icon"><NodeIcon size={18} /></span>
      <span className="topology-flow-copy">
        <b>{node.label}{tyrOrchestrator && <em>Orchestrator</em>}</b>
        <small>{node.subtitle}</small>
      </span>
      {(node.status || signalBeacon) && (
        <span className="topology-node-state-anchor">
          {node.status && <span className={statusDot(node.status)} />}
          {signalBeacon}
        </span>
      )}
      {hasLiveWork && <div className="topology-live-work-strip" aria-label={`${node.liveWork?.totalCount ?? 0} live or recent executions`}>
        <div className="topology-live-work-summary">
          <span>{liveExecutions.length ? "Live queue" : "Recent activity"}</span>
          <small>
            {node.liveWork?.attentionCount ? `${node.liveWork.attentionCount} attention` : ""}
            {node.liveWork?.attentionCount && (node.liveWork.runningCount || node.liveWork.waitingCount) ? " · " : ""}
            {node.liveWork?.runningCount ? `${node.liveWork.runningCount} running` : ""}
            {node.liveWork?.runningCount && node.liveWork.waitingCount ? " · " : ""}
            {node.liveWork?.waitingCount ? `${node.liveWork.waitingCount} queued` : ""}
          </small>
        </div>
        {liveExecutions.map((execution) => {
          const activityKind = node.liveWork?.activities.find((activity) => activity.executionId === execution.id)?.kind;
          const tone = topologyLiveExecutionTone(execution.status, activityKind);
          const label = topologyLiveExecutionLabel(execution.status, activityKind);
          return (
            <button
              key={execution.id}
              className={`topology-live-work-row nodrag nopan tone-${tone}`}
              type="button"
              data-live-execution-id={execution.id}
              title={`${label} · ${execution.title}`}
            >
              <span className="topology-live-work-pulse" aria-hidden="true" />
              <span className="topology-live-work-title">{execution.title}</span>
              <small>{label}</small>
            </button>
          );
        })}
        {liveExecutions.length === 0 && recentActivity && (
          <button
            type="button"
            className={`topology-live-work-row tone-${topologyLiveActivityTone(recentActivity.kind)}`}
            data-live-execution-id={recentActivity.executionId}
            title={`${topologyLiveActivityLabel(recentActivity.kind)} · recent execution`}
          >
            <span className="topology-live-work-pulse" aria-hidden="true" />
            <span className="topology-live-work-title">Recent execution</span>
            <small>{topologyLiveActivityLabel(recentActivity.kind)}</small>
          </button>
        )}
        {Boolean(node.liveWork?.hiddenCount) && <span className="topology-live-work-more">+{node.liveWork?.hiddenCount} more</span>}
      </div>}
      <Handle type="source" position={Position.Bottom} className="topology-flow-handle" />
      <Handle id="right-source" type="source" position={Position.Right} className="topology-flow-handle" />
    </div>
  );
}

function groupTopologyAgentsByParent(rows: Array<Extract<TopologyRow, { kind: "agent" }>>): Map<string, Array<Extract<TopologyRow, { kind: "agent" }>>> {
  const groups = new Map<string, Array<Extract<TopologyRow, { kind: "agent" }>>>();
  for (const row of rows) {
    if (!row.parentId || row.parentId === "shared") continue;
    const items = groups.get(row.parentId) ?? [];
    items.push(row);
    groups.set(row.parentId, items);
  }
  return groups;
}

function HumanProfileView({ snapshot, topbarProps, human, onRefresh }: { snapshot: AppSnapshot; topbarProps: WorkspaceTopBarProps; human: UserRecord; onRefresh: () => Promise<void> }) {
  const [profile, setProfile] = useState<HumanMemberProfile | null>(null);
  const [error, setError] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);
  const isSelf = human.id === snapshot.currentUser.id;
  const serverId = workspaceCacheServerId(snapshot);
  const currentUserServerRole = snapshot.currentServer?.role ?? "member";
  const canManageServerMembers = snapshot.currentServer?.role === "owner";

  useEffect(() => {
    let active = true;
    async function load() {
      setProfile(null);
      setError("");
      if (!humanProfileApiAllowed(human, snapshot.currentUser, currentUserServerRole)) return;
      try {
        const data = await api<HumanMemberProfile>(`/api/servers/${serverId}/members/${human.id}/profile`);
        if (active) {
          setProfile(data);
          setError("");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [currentUserServerRole, human.id, human.membershipVisible, human.serverRole, serverId, snapshot.currentUser.id]);

  async function editDescription() {
    if (!profile || !isSelf) return;
    const next = window.prompt("Update your description", profile.description ?? "");
    if (next === null) return;
    const updated = await api<UserRecord>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ description: next.trim() || null })
    });
    setProfile({ ...profile, description: updated.description ?? null });
    await onRefresh();
  }

  const activeProfile: HumanMemberProfile = profile ?? fallbackHumanProfile(human, snapshot.currentUser, currentUserServerRole);
  const roleActions = humanRoleActionState(activeProfile, snapshot.currentUser, snapshot.currentServer);
  const profileFacts = humanProfileFacts(activeProfile);
  const createdAgents = humanCreatedAgentsForDisplay(activeProfile.createdAgents, snapshot.agents, human.id);

  async function removeMember() {
    if (!roleActions.canRemove || removeBusy) return;
    if (!(await confirmDialog({
      title: `Remove ${activeProfile.displayName} from this workspace?`,
      description: "Their account will not be deleted.",
      confirmText: "Remove member",
      tone: "danger"
    }))) return;
    setRemoveBusy(true);
    try {
      await api(`/api/servers/${serverId}/members/${activeProfile.userId}`, { method: "DELETE" });
      await onRefresh();
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div className="view">
      <TopBar title={activeProfile.displayName} {...topbarProps} />
      <div className="profile human-profile">
        {error && <div className="error-strip">{error}</div>}
        <div className="human-hero">
          <span className="avatar human jumbo">{activeProfile.avatarUrl ? <img src={activeProfile.avatarUrl} alt="" /> : <UserRound size={44} />}</span>
          <div className="human-hero-copy">
            <h2>{activeProfile.displayName} {isSelf && <small>(you)</small>}</h2>
            <div className="human-hero-meta">
              <span className={`member-role-pill ${activeProfile.role}`}>{memberRoleLabel(activeProfile.role)}</span>
              <span>{activeProfile.email ?? "No email"}</span>
              <span>Joined {memberProfileDate(activeProfile.joinedAt)}</span>
            </div>
          </div>
        </div>
        <div className="info-block">
          <h3 className="inline-heading">DESCRIPTION {isSelf && <button className="icon-link" onClick={() => void editDescription()}><Edit3 size={15} /></button>}</h3>
          <p className={!activeProfile.description ? "muted-text" : ""}>{activeProfile.description || "No description"}</p>
        </div>
        <div className="human-profile-grid">
          <div className="info-block human-info">
            <h3>PROFILE DETAILS</h3>
            <div className="human-fact-grid">
              {profileFacts.map(([label, value]) => (
                <div key={label} className="profile-field">
                  <small>{label}</small>
                  <p>{value}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="info-block human-role-card">
            <h3>ROLE & ACCESS</h3>
            <div className="role-action-head">
              <span className={`member-role-pill ${activeProfile.role}`}>{memberRoleLabel(activeProfile.role)}</span>
              <small>{activeProfile.membershipStatus}</small>
            </div>
            {canManageServerMembers ? (
              <div className="role-actions">
                <button className="btn small" disabled title={roleActions.plannedRoleAction.disabledReason}><Shield size={14} /> {roleActions.plannedRoleAction.label}</button>
                <button className="btn danger small" disabled={!roleActions.canRemove || removeBusy} title={roleActions.canRemove ? "Remove this member" : roleActions.removeReason} onClick={() => void removeMember()}><Trash2 size={14} /> {removeBusy ? "Removing" : "Remove member"}</button>
              </div>
            ) : (
              <p className="muted-text">Only owners can manage roles or remove members.</p>
            )}
            {canManageServerMembers && !roleActions.canRemove && <p className="muted-text">{roleActions.removeReason}</p>}
          </div>
        </div>
        <div className="info-block">
          <h3>CREATED AGENTS ({createdAgents.length})</h3>
          {createdAgents.length === 0 && <p className="muted-text">No agents created by this member.</p>}
          {createdAgents.map((createdAgent) => (
            <div key={createdAgent.id} className="created-agent-row">
              <span className="avatar agent">{avatarSeed(createdAgent.name)}</span>
              <b>{createdAgent.displayName}</b>
              <small>{createdAgent.runtime ? runtimeDisplayName(createdAgent.runtime) : "No runtime"} · {createdAgent.status}</small>
              <span className={statusDot(createdAgent.status)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MembersView({ snapshot, topbarProps, agent, human, onCreate, onRefresh, onAgentPermissionsDirtyChange, onOpenAgentDm, onOpenDmChannel }: { snapshot: AppSnapshot; topbarProps: WorkspaceTopBarProps; agent?: AgentRecord; human?: UserRecord; onCreate: () => void; onRefresh: () => Promise<void>; onAgentPermissionsDirtyChange: (dirty: boolean) => void; onOpenAgentDm: (agentId: string) => Promise<void>; onOpenDmChannel: (channelId: string) => void }) {
  const [tab, setTab] = useState<AgentProfileTab>("profile");
  const [stopModal, setStopModal] = useState(false);
  const [profileDraft, setProfileDraft] = useState<AgentProfileDraft>(() => agent ? agentProfileDraft(agent) : { displayName: "", description: "", model: "", permissionMode: DEFAULT_RUNTIME_PERMISSION_MODE, runtimeResourceGrants: [] });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [agentActionMessage, setAgentActionMessage] = useState("");
  const [agentPermissionsDirty, setAgentPermissionsDirty] = useState(false);
  const machine = agent?.machineId ? snapshot.machines.find((item) => item.id === agent.machineId) : undefined;
  const runtimeReport = agent?.runtime ? machine?.runtimes.find((item) => item.runtime === agent.runtime && item.status === "available") : undefined;
  const readOnlyRuntimeSupported = Boolean(agent?.runtime && runtimePermissionModeSupported(agent.runtime, "read-only"));
  const readOnlyAvailable = Boolean(agent?.runtime && runtimePermissionModeAvailable(agent.runtime, "read-only", runtimeReport));
  const readOnlyAvailabilityLabel = readOnlyAvailable
    ? ""
    : readOnlyRuntimeSupported
      ? " (update daemon to use Read Only)"
      : " (unsupported by this runtime)";
  const profileApply = agent ? agentProfileApplyState(agent) : null;
  const availableAgentTabs = useMemo(() => agent ? agentProfileTabsForAccess(agent) : ["profile"] as AgentProfileTab[], [agent]);
  useEffect(() => {
    if (!agent) return;
    setProfileDraft(agentProfileDraft(agent));
    setProfileMessage("");
    setAgentActionMessage("");
    setAgentPermissionsDirty(false);
    onAgentPermissionsDirtyChange(false);
  }, [agent?.id]);
  useEffect(() => {
    if (!agent || availableAgentTabs.includes(tab)) return;
    setTab(availableAgentTabs[0]);
  }, [agent?.id, availableAgentTabs, tab]);
  function handleAgentPermissionsDirtyChange(dirty: boolean) {
    setAgentPermissionsDirty(dirty);
    onAgentPermissionsDirtyChange(dirty);
  }
  async function selectAgentTab(nextTab: AgentProfileTab) {
    if (tab === "permissions" && nextTab !== tab && agentPermissionsDirty && !(await confirmDialog({
      title: "Discard unsaved agent permission changes?",
      description: "Changes on this tab will be lost.",
      confirmText: "Discard changes",
      tone: "danger"
    }))) return;
    if (tab === "permissions" && nextTab !== tab) handleAgentPermissionsDirtyChange(false);
    setTab(nextTab);
  }
  async function agentAction(path: string, init: RequestInit | string = "POST") {
    const requestInit = typeof init === "string" ? { method: init } : init;
    await api(path, requestInit);
    await onRefresh();
  }
  async function saveAgentProfile() {
    if (!agent) return;
    const payload = normalizeAgentProfileDraft(profileDraft);
    if (!payload.displayName) {
      setProfileMessage("Display name is required.");
      return;
    }
    setProfileSaving(true);
    setProfileMessage("");
    try {
      const response = await api<{ restartRequired: boolean; profileApplyDeferred: boolean; restarted: boolean; partial: boolean; errorCode: string | null }>(`/api/agents/${agent.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      setProfileDraft(payload);
      setProfileMessage(response.errorCode === "agent_restart_not_delivered"
        ? "Profile saved, but the Agent needs a manual restart."
        : response.errorCode === "workspace_sync_failed"
          ? response.restarted
            ? "Profile saved. Restart requests were sent, but workspace refresh may be delayed."
            : "Profile saved. Workspace refresh may be delayed."
          : response.profileApplyDeferred
            ? "Profile saved. It will apply after current work completes."
          : response.restarted
            ? "Profile saved. Restart requested; waiting for Runtime confirmation."
            : "Profile saved.");
      await onRefresh();
    } catch (error) {
      setProfileMessage(error instanceof Error ? `Error: ${error.message}` : "Error: Profile save failed.");
    } finally {
      setProfileSaving(false);
    }
  }
  async function runAgentLifecycleAction(action: "start" | "stop" | "restart") {
    if (!agent) return;
    if (!machine) {
      setAgentActionMessage("No linked device found.");
      return;
    }
    setAgentActionMessage("");
    await agentAction(`/api/agents/${agent.id}/${action}`);
  }

  async function resetAgentSession() {
    if (!agent) return;
    if (!machine) {
      setAgentActionMessage("No linked device found.");
      return;
    }
    setAgentActionMessage("");
    if (!(await confirmDialog({
      title: `Reset ${agent.displayName}?`,
      description: "This clears the saved Codex session and starts a fresh thread.",
      confirmText: "Reset session",
      tone: "danger"
    }))) return;
    await agentAction(`/api/agents/${agent.id}/reset`, {
      method: "POST",
      body: JSON.stringify({ mode: "restart" })
    });
  }
  if (human) {
    return <HumanProfileView snapshot={snapshot} topbarProps={topbarProps} human={human} onRefresh={onRefresh} />;
  }
  if (!agent) {
    return <EmptyState title="No agents yet" action="Create Agent" onAction={onCreate} />;
  }
  const communicationAgent = isCommunicationAgent(agent);
  const routingServer = communicationAgent && snapshot.currentServer?.id === agent.serverId ? snapshot.currentServer : null;
  const canManageAgent = !communicationAgent && canManageAgentRuntimeView(agent, machine, snapshot.currentUser.id);
  const profileChanged = agentProfileDraftChanged(agent, profileDraft);
  const profileValid = profileDraft.displayName.trim().length > 0;
  const machineSummary = agentMachineSummary(machine, agent);
  const ownerLabel = agentOwnerLabel(agent, snapshot.humans, snapshot.currentUser);
  const lifecycleWarning = agentLifecycleWarning(agent, machine);
  const statusLabel = agentStatusLabel(agent.status, (snapshot.runtimeApprovals ?? []).some((approval) => approval.agentId === agent.id && approval.status === "pending"));
  const lastErrorSummary = agentLastErrorSummary(agent);
  const createdAt = new Date(agent.createdAt).toLocaleString();
  const sharedLabel = sharedResourceLabel(agent);
  const tabDefinitions: Array<{ id: AgentProfileTab; label: string; Icon: typeof UserRound }> = [
    { id: "profile", label: "PROFILE", Icon: UserRound },
    { id: "permissions", label: "PERMISSIONS", Icon: Shield },
    { id: "reminders", label: "REMINDERS", Icon: Bell },
    { id: "workspace", label: "WORKSPACE", Icon: Folder },
    { id: "activity", label: "HISTORY", Icon: Activity }
  ];
  return (
    <div className="view">
      <TopBar title={agent.displayName} {...topbarProps} />
      <div className="page-action-bar">
        {sharedLabel && <span className="task-tag todo">{sharedLabel}</span>}
        {agentCanOpenDm(agent, snapshot.currentUser.id) && <button className="btn small" onClick={() => void onOpenAgentDm(agent.id)}><MessageSquare size={15} /> Message</button>}
        {canManageAgent ? <button className="icon-btn" title={agent.status === "offline" ? "Start agent" : "Stop agent"} onClick={() => {
          if (agent.status === "offline") void runAgentLifecycleAction("start");
          else setStopModal(true);
        }}>{agent.status === "offline" ? <Play size={16} /> : <Square size={16} />}</button> : <span className="task-tag todo">Read only</span>}
        {canManageAgent && <button className="icon-btn" title="Restart agent" onClick={() => void runAgentLifecycleAction("restart")}><RefreshCw size={15} /></button>}
        {canManageAgent && <button className="icon-btn danger" title="Reset Agent" onClick={() => void resetAgentSession()}><AlertTriangle size={15} /></button>}
      </div>
      {agentActionMessage && <p className="settings-status inline-status action-feedback" role="status">{agentActionMessage}</p>}
      <div className="tabs">
        {tabDefinitions.filter((item) => availableAgentTabs.includes(item.id)).map(({ id, label, Icon }) => (
          <button key={id} className={tab === id ? "tab active" : "tab"} onClick={() => void selectAgentTab(id)}><Icon size={14} /> {label}</button>
        ))}
      </div>
      {tab === "profile" && (
        <div className="profile agent-profile">
          <div className="profile-head agent-profile-head">
            <span className="avatar agent jumbo">{avatarSeed(agent.name)}</span>
            <div>
              <h2>{agent.displayName} <span className={statusDot(agent.status)} title={statusLabel} aria-label={statusLabel} /></h2>
              <small>{communicationAgent ? "Communication / server-hosted" : `@${agent.name}`} · {statusLabel}</small>
            </div>
          </div>
          {lifecycleWarning && (
            <div className="agent-profile-warning">
              <AlertTriangle size={16} />
              <span>{lifecycleWarning}</span>
            </div>
          )}
          {lastErrorSummary && (
            <div className="agent-profile-warning error">
              <AlertTriangle size={16} />
              <span>{lastErrorSummary}</span>
            </div>
          )}
          <div className="info-block agent-profile-form">
            <h3>PROFILE</h3>
            {communicationAgent ? (
              <p className="muted-text">This server-hosted Communication Agent can receive DMs, but it has no device runtime.</p>
            ) : !canManageAgent && <p className="muted-text">This Agent belongs to {ownerLabel}. You can message it, but profile and runtime controls are owner-only.</p>}
            <div className="agent-profile-grid">
              <label className="agent-profile-field">
                <span>Display name</span>
                <input disabled={!canManageAgent} value={profileDraft.displayName} onChange={(event) => setProfileDraft((draft) => ({ ...draft, displayName: event.target.value }))} />
              </label>
              {!communicationAgent && <label className="agent-profile-field">
                <span>Runtime access</span>
                <p className="field-hint">Controls local files and commands. Tyr capabilities are managed separately.</p>
                <SelectControl disabled={!canManageAgent} value={profileDraft.permissionMode} onChange={(event) => setProfileDraft((draft) => ({ ...draft, permissionMode: event.target.value as AgentProfileDraft["permissionMode"] }))}>
                  <option value="workspace-write">{permissionModeTitle("workspace-write")}</option>
                  <option value="read-only" disabled={Boolean(agent.runtime && !readOnlyAvailable)}>{permissionModeTitle("read-only")}{agent.runtime ? readOnlyAvailabilityLabel : ""}</option>
                  <option value="dev-full-access">{permissionModeTitle("dev-full-access")}</option>
                </SelectControl>
              </label>}
              {!communicationAgent && <AgentModelSelect key={agent.id} machine={machine} runtime={agent.runtime}
                report={runtimeReport} canManage={canManageAgent} value={profileDraft.model}
                onChange={(model) => setProfileDraft((draft) => ({ ...draft, model }))} />}
              <label className="agent-profile-field wide">
                {communicationAgent ? <span>TYR Core Policy</span> : <span>Agent Profile Prompt</span>}
                <p className="field-hint">{communicationAgent ? "Platform-maintained identity and safety policy. Workspace routing preferences are configured separately below." : "Server-authoritative role and persona instructions, applied to the Runtime under TYR platform policy."}</p>
                {profileApply && !communicationAgent && <div className={`profile-apply-status ${profileApply.status}`} aria-live="polite">
                  <span><i aria-hidden="true" />{profileApply.label}</span>
                  <small>{profileApply.detail}</small>
                </div>}
                <textarea disabled={!canManageAgent} rows={3} value={profileDraft.description} onChange={(event) => setProfileDraft((draft) => ({ ...draft, description: event.target.value }))} placeholder="Describe responsibilities, strengths, routing cues, and boundaries." />
              </label>
              {routingServer && <TyrRoutingInstructionsEditor
                serverId={routingServer.id}
                canEdit={routingServer.role === "owner"}
              />}
              {!communicationAgent && (canManageAgent || hasPublicRuntimeResourceGrants(profileDraft.runtimeResourceGrants)) && <div className="agent-profile-field wide">
                <span>Allowed access</span>
                <AgentRuntimeResourceGrantsEditor disabled={!canManageAgent} permissionMode={profileDraft.permissionMode} grants={profileDraft.runtimeResourceGrants} onChange={(runtimeResourceGrants) => setProfileDraft((draft) => ({ ...draft, runtimeResourceGrants }))} />
              </div>}
            </div>
            {canManageAgent && <div className="inline-actions agent-profile-actions">
              <button className="btn primary small" disabled={!profileChanged || !profileValid || profileSaving} onClick={() => void saveAgentProfile()}><Check size={14} /> {profileSaving ? "Saving" : "Save Profile"}</button>
              <button className="btn small" disabled={!profileChanged || profileSaving} onClick={() => {
                setProfileDraft(agentProfileDraft(agent));
                setProfileMessage("");
              }}>Discard</button>
              {profileMessage && <span className={profileMessage.includes("required") || profileMessage.startsWith("Error:") ? "profile-save-message error" : "profile-save-message"}>{profileMessage}</span>}
            </div>}
          </div>
          {communicationAgent && <AssistantContactMethodsPanel agent={agent} variant="workspace" />}
          <div className="agent-detail-grid">
            <div className="info-block agent-detail-card">
              <h3>COMPUTER</h3>
              <p><b>{machineSummary.title}</b></p>
              <p className={machineSummary.warning ? "muted-text" : ""}>{machineSummary.detail}</p>
              {machineSummary.warning && <small>{machineSummary.warning}</small>}
            </div>
            <div className="info-block agent-detail-card">
              <h3>{communicationAgent ? "COMMUNICATION" : "RUNTIME"}</h3>
              <p><b>{agentRuntimeSummary(agent)}</b></p>
              <p>{communicationAgent ? "Server-hosted message hub" : `runtime ${agent.runtime ? runtimeDisplayName(agent.runtime) : "No runtime"} · model ${agent.model || "Default"}`}</p>
            </div>
            <div className="info-block agent-detail-card">
              <h3>OWNER / CREATED</h3>
              <p><b>{ownerLabel}</b></p>
              <p>Created {createdAt}</p>
            </div>
            <div className="info-block agent-detail-card">
              <h3>WORKSPACE</h3>
              <p className={agent.workspacePath ? "" : "muted-text"}>{agent.workspacePath || "No workspace attached"}</p>
              <small>Environment variables are stored privately on the server and injected at runtime.</small>
            </div>
          </div>
          {canManageAgent && <SkillsBlock agentId={agent.id} />}
          {canManageAgent ? <ActionsBlock
            primary={agent.status === "offline" ? "Start Agent" : "Stop Agent"}
            secondary="Restart Agent"
            reset="Reset Agent"
            report="Report Issue"
            danger="Delete Agent"
            onPrimary={() => agent.status === "offline" ? runAgentLifecycleAction("start") : setStopModal(true)}
            onSecondary={() => runAgentLifecycleAction("restart")}
            onReset={() => resetAgentSession()}
            onReport={() => setAgentActionMessage("Report issue entry is reserved for the next pass.")}
            onDanger={async () => {
              if (!(await confirmDialog({
                title: `Delete ${agent.displayName}?`,
                description: "This keeps existing chat history but removes the agent record.",
                confirmText: "Delete agent",
                tone: "danger"
              }))) return;
              await agentAction(`/api/agents/${agent.id}`, "DELETE");
            }}
          /> : <div className="info-block"><h3>Read only agent</h3><p className="muted-text">This Agent belongs to {ownerLabel}. Start, stop, restart, reset, permissions, workspace, and deletion are owner-only.</p></div>}
        </div>
      )}
      {tab === "permissions" && (canManageAgent ? <AgentPermissionsPanel agentId={agent.id} variant="full" onDirtyChange={handleAgentPermissionsDirtyChange} /> : <Placeholder title="Permissions are owner-only" text={`${ownerLabel} owns this Agent. You can view its profile and message it, but cannot change permissions.`} />)}
      {tab === "activity" && <PaginatedAgentActivityTimeline agentId={agent.id} />}
      {tab === "workspace" && (canManageAgent ? <AgentWorkspace agent={agent} /> : <Placeholder title="Workspace is owner-only" text={`${ownerLabel} owns this Agent. Workspace file browsing is limited to the owner.`} />)}
      {tab === "reminders" && <ReminderList snapshot={snapshot} agentId={agent.id} />}
      {canManageAgent && stopModal && <StopAgentModal agent={agent} onClose={() => setStopModal(false)} onDone={async () => {
        setStopModal(false);
        await onRefresh();
      }} />}
    </div>
  );
}

type TelegramAccountSummary = {
  id: string;
  userId: string;
  serverId: string;
  telegramUserId: string;
  telegramChatId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
};

type TelegramAccountStatus = {
  enabled: boolean;
  botUsername: string | null;
  account: TelegramAccountSummary | null;
};

type TelegramBindingCodeResponse = {
  id: string;
  code: string;
  userId: string;
  serverId: string;
  status: "pending" | "consumed" | "expired";
  expiresAt: string;
  deepLink: string | null;
};

type AccountSettingsTab = Extract<SettingsTab, "profile" | "security" | "channels" | "developer">;

function AccountSettingsSection({ snapshot, tab, onRefresh, onLoggedOut }: { snapshot: AppSnapshot; tab: AccountSettingsTab; onRefresh: () => Promise<void>; onLoggedOut: () => void }) {
  const [me, setMe] = useState<UserRecord>(snapshot.currentUser);
  const [draft, setDraft] = useState<AccountProfileDraft>(() => accountProfileDraft(snapshot.currentUser));
  const [status, setStatus] = useState("");
  const [telegramStatus, setTelegramStatus] = useState<TelegramAccountStatus | null>(null);
  const [telegramBinding, setTelegramBinding] = useState<TelegramBindingCodeResponse | null>(null);
  const [telegramMessage, setTelegramMessage] = useState("");
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(() => Boolean(snapshot.currentUser.passwordSetupRequired));
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const TELEGRAM_BINDING_POLL_INTERVAL_MS = 2000;
  const TELEGRAM_BINDING_POLL_MAX_ATTEMPTS = 15;

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const user = await api<UserRecord>("/api/auth/me");
        if (!active) return;
        setMe(user);
        setDraft(accountProfileDraft(user));
      } catch (err) {
        if (active) setStatus(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [snapshot.currentUser.id]);

  useEffect(() => {
    if (me.passwordSetupRequired) setPasswordOpen(true);
  }, [me.passwordSetupRequired]);

  useEffect(() => {
    if (tab !== "channels") return;
    let active = true;
    async function loadTelegramStatus() {
      try {
        const payload = await api<TelegramAccountStatus>("/api/integrations/telegram/account");
        if (!active) return;
        setTelegramStatus(payload);
        setTelegramMessage("");
      } catch (err) {
        if (active) setTelegramMessage(err instanceof Error ? err.message : String(err));
      }
    }
    void loadTelegramStatus();
    return () => {
      active = false;
    };
  }, [snapshot.currentUser.id, tab]);

  useEffect(() => {
    if (!telegramBinding || telegramStatus?.account || !telegramStatus?.enabled) return;
    let active = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function pollTelegramBindingStatus() {
      attempts += 1;
      try {
        const payload = await api<TelegramAccountStatus>("/api/integrations/telegram/account");
        if (!active) return;
        setTelegramStatus(payload);
        if (payload.account) {
          setTelegramBinding(null);
          setTelegramMessage("Telegram connected.");
          return;
        }
      } catch (err) {
        if (!active) return;
        if (attempts >= TELEGRAM_BINDING_POLL_MAX_ATTEMPTS) {
          setTelegramMessage(err instanceof Error ? err.message : String(err));
        }
      }

      if (!active) return;
      if (attempts < TELEGRAM_BINDING_POLL_MAX_ATTEMPTS) {
        timer = setTimeout(pollTelegramBindingStatus, TELEGRAM_BINDING_POLL_INTERVAL_MS);
      } else {
        setTelegramMessage("Telegram binding link created. Refresh if the connection status does not update.");
      }
    }

    timer = setTimeout(pollTelegramBindingStatus, TELEGRAM_BINDING_POLL_INTERVAL_MS);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [telegramBinding, telegramStatus?.account, telegramStatus?.enabled]);

  async function saveProfile() {
    setBusy(true);
    setStatus("");
    try {
      const payload = accountProfilePayload(draft);
      const updated = await api<UserRecord>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      setMe(updated);
      setDraft(accountProfileDraft(updated));
      setStatus("Profile saved.");
      await onRefresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    const firstPasswordSetup = Boolean(me.passwordSetupRequired);
    const validationMessage = accountPasswordValidationMessage(currentPassword, newPassword, confirmPassword, !firstPasswordSetup);
    if (validationMessage) {
      setStatus(validationMessage);
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const result = await api<{ ok: true; user?: UserRecord }>(firstPasswordSetup ? "/api/auth/password/setup" : "/api/auth/password", {
        method: "POST",
        body: JSON.stringify(firstPasswordSetup ? { newPassword } : { currentPassword, newPassword })
      });
      if (result.user) setMe(result.user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordOpen(false);
      setStatus(firstPasswordSetup ? "Password set." : "Password updated.");
      await onRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message === "invalid_current_password" ? "Current password is incorrect." : message);
    } finally {
      setBusy(false);
    }
  }

  function requestAccountLogout() {
    if (me.passwordSetupRequired) {
      setPasswordOpen(true);
      setStatus("Set a password before logging out so you can sign in again.");
      return;
    }
    setLogoutOpen(true);
  }

  async function logout() {
    setBusy(true);
    try {
      await api<{ ok: true }>("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken: getRefreshToken() ?? "" })
      });
    } finally {
      setBusy(false);
      onLoggedOut();
    }
  }

  async function createTelegramBinding() {
    setTelegramBusy(true);
    setTelegramMessage("");
    const telegramServerId = workspaceCacheServerId(snapshot);
    try {
      const payload = await api<TelegramBindingCodeResponse>("/api/integrations/telegram/binding-codes", {
        method: "POST",
        body: JSON.stringify({ serverId: telegramServerId })
      });
      setTelegramBinding(payload);
      setTelegramMessage("Telegram binding link created. Waiting for Telegram confirmation.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTelegramMessage(message === "telegram_disabled" ? "Telegram is not enabled for this workspace yet." : message);
    } finally {
      setTelegramBusy(false);
    }
  }

  async function copyTelegramCode() {
    if (!telegramBinding) return;
    try {
      await copyMessageText(telegramBinding.code);
      setTelegramMessage("Telegram code copied.");
    } catch (err) {
      setTelegramMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function disconnectTelegram() {
    setTelegramBusy(true);
    setTelegramMessage("");
    try {
      await api<{ ok: true }>("/api/integrations/telegram/account", { method: "DELETE" });
      const payload = await api<TelegramAccountStatus>("/api/integrations/telegram/account");
      setTelegramStatus(payload);
      setTelegramBinding(null);
      setTelegramMessage("Telegram disconnected.");
    } catch (err) {
      setTelegramMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setTelegramBusy(false);
    }
  }

  const profilePayload = accountProfilePayload(draft);
  const profileChanged = accountProfileDraftChanged(me, draft);
  const firstPasswordSetup = Boolean(me.passwordSetupRequired);
  const passwordValidationMessage = accountPasswordValidationMessage(currentPassword, newPassword, confirmPassword, !firstPasswordSetup);
  const currentServerRole = snapshot.currentServer?.role ?? "member";
  const currentServerName = snapshot.currentServer?.name ?? "No workspace";
  const telegramAccount = telegramStatus?.account ?? null;
  const telegramEnabled = Boolean(telegramStatus?.enabled);
  const telegramStateLabel = !telegramStatus ? "Checking" : telegramEnabled ? telegramAccount ? "Connected" : "Not connected" : "Unavailable";
  const telegramDisplayName = telegramAccount
    ? telegramAccount.username ? `@${telegramAccount.username}` : [telegramAccount.firstName, telegramAccount.lastName].filter(Boolean).join(" ") || telegramAccount.telegramUserId
    : "";
  const telegramExpiresAt = telegramBinding ? new Date(telegramBinding.expiresAt).toLocaleString() : "";
  const telegramDescription = telegramAccount
    ? `Connected as ${telegramDisplayName}`
    : telegramEnabled
      ? telegramStatus?.botUsername
        ? `Connect a private chat through @${telegramStatus.botUsername.replace(/^@/, "")}.`
        : "Bind a private Telegram chat to TYR."
      : "Telegram is not configured for this workspace yet.";

  return (
    <>
      {tab === "profile" && (
        <div className="settings-panel-stack settings-profile-panel">
          {status && <p className="settings-status account-status" role="status">{status}</p>}
          <section className="settings-identity-summary" aria-label="Account identity">
            <span className="avatar human account-avatar">
              {me.avatarUrl ? <img src={me.avatarUrl} alt="" /> : <UserRound size={30} />}
            </span>
            <span className="account-identity-copy">
              <small>Signed in account</small>
              <h3>{me.displayName}</h3>
              <p>@{me.name} · {me.email ?? "No email set"}</p>
            </span>
            <span className="account-identity-context">
              <span className={me.emailVerified ? "account-verification-state verified" : "account-verification-state"}>
                {me.emailVerified ? "Verified email" : "Unverified email"}
              </span>
              <span className="account-server-context-pill"><Building2 size={13} /> {currentServerName}</span>
              <span className={`account-role-pill ${currentServerRole}`}><Shield size={14} /> {memberRoleLabel(currentServerRole)}</span>
            </span>
          </section>

          <section className="settings-card account-form-card">
            <div className="account-card-head">
              <span className="settings-card-title">
                <h3>Public profile</h3>
                <small>How you appear to people and Agents in this workspace.</small>
              </span>
              <span className={profileChanged ? "settings-change-state unsaved" : "settings-change-state"}>{profileChanged ? "Unsaved changes" : "Up to date"}</span>
            </div>
            <label className="field-label" htmlFor="account-display-name">Display name</label>
            <input id="account-display-name" className="input" value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} />
            <label className="field-label" htmlFor="account-bio">Bio</label>
            <textarea id="account-bio" className="input textarea account-description" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Describe your role or working preferences." />
            <div className="account-readonly-grid" aria-label="Account details">
              <span>
                <small>Username</small>
                <b>@{me.name}</b>
              </span>
              <span>
                <small>Email</small>
                <b>{me.email ?? "No email set"}</b>
              </span>
            </div>
            <div className="settings-form-actions">
              <button className="btn primary" disabled={busy || !profilePayload.displayName || !profileChanged} onClick={() => void saveProfile()}><Check size={15} /> Save changes</button>
            </div>
          </section>
        </div>
      )}

      {tab === "security" && (
        <div className="settings-panel-stack">
          {status && <p className="settings-status account-status" role="status">{status}</p>}
          <section className="settings-card account-security-card">
            <div className="account-card-head">
              <span className="settings-card-title">
                <h3>Password</h3>
                <small>{firstPasswordSetup ? "Create a password before ending this session." : "Use a unique password to protect your account."}</small>
              </span>
              <span className={firstPasswordSetup ? "settings-change-state attention" : "settings-change-state"}>{firstPasswordSetup ? "Action needed" : "Configured"}</span>
            </div>
            <button className="password-toggle" type="button" aria-expanded={passwordOpen} onClick={() => setPasswordOpen((open) => !open)}>
              <span className="settings-row-icon"><KeyRound size={17} /></span>
              <span><b>{firstPasswordSetup ? "Set password" : "Change password"}</b><small>{firstPasswordSetup ? "Required before you can safely log out." : "Update the password used to sign in to TYR."}</small></span>
              <ChevronDown className={passwordOpen ? "rotated" : ""} size={17} />
            </button>
            {passwordOpen && (
              <div className="password-panel">
                {!firstPasswordSetup && (
                  <>
                    <label className="field-label" htmlFor="account-current-password">Current password</label>
                    <input id="account-current-password" className="input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" />
                  </>
                )}
                <label className="field-label" htmlFor="account-new-password">New password</label>
                <input id="account-new-password" className="input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" placeholder="Minimum 8 characters" />
                <label className="field-label" htmlFor="account-confirm-password">Confirm new password</label>
                <input id="account-confirm-password" className="input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" placeholder="Repeat the new password" />
                {passwordValidationMessage && (currentPassword || newPassword || confirmPassword) && <p className="field-hint error">{passwordValidationMessage}</p>}
                <div className="settings-form-actions">
                  <button className="btn primary" disabled={busy || Boolean(passwordValidationMessage)} onClick={() => void changePassword()}><KeyRound size={15} /> {firstPasswordSetup ? "Set password" : "Update password"}</button>
                </div>
              </div>
            )}
          </section>

          <section className="settings-card account-sessions-card">
            <div className="account-card-head">
              <span className="settings-card-title">
                <h3>Sessions</h3>
                <small>Review and end access to your account.</small>
              </span>
              <span className="settings-change-state active">Active</span>
            </div>
            <div className="account-logout-row">
              <span className="settings-row-icon"><Monitor size={17} /></span>
              <span><b>This browser</b><small>Your current TYR session on this device.</small></span>
              <button className="btn" type="button" onClick={requestAccountLogout}><LogOut size={15} /> Log out</button>
            </div>
          </section>
        </div>
      )}

      {tab === "developer" && (
        <div className="settings-panel-stack settings-developer-panel">
          <DeveloperAccessPanel
            serverId={workspaceCacheServerId(snapshot)}
            serverName={currentServerName}
            role={currentServerRole}
            passwordSetupRequired={firstPasswordSetup}
          />
        </div>
      )}

      {tab === "channels" && (
        <div className="settings-panel-stack">
          <section className="settings-card communication-channel-card">
            <div className="account-card-head">
              <span className="settings-card-title">
                <h3>Telegram</h3>
                <small>Connect a private Telegram chat directly to TYR.</small>
              </span>
              <span className={`settings-change-state telegram-${telegramStateLabel.toLowerCase().replace(/\s+/g, "-")}`}>{telegramStateLabel}</span>
            </div>
            <div className="telegram-channel-row">
              <span className="oauth-mark telegram-mark">TG</span>
              <span>
                <b>{telegramAccount ? "Telegram connected" : "Private chat connection"}</b>
                <small>{telegramDescription}</small>
              </span>
              <div className="telegram-channel-actions">
                {telegramAccount ? (
                  <>
                    <button className="btn small" type="button" disabled={telegramBusy || !telegramEnabled} onClick={() => void createTelegramBinding()}><RefreshCw size={14} /> Reconnect</button>
                    <button className="btn small" type="button" disabled={telegramBusy} onClick={() => void disconnectTelegram()}><X size={14} /> Disconnect</button>
                  </>
                ) : (
                  <button className="btn primary small" type="button" disabled={telegramBusy || !telegramEnabled} onClick={() => void createTelegramBinding()}><ExternalLink size={14} /> Connect Telegram</button>
                )}
              </div>
            </div>
            {telegramStatus && !telegramEnabled && (
              <div className="channel-availability-note">
                <AlertTriangle size={16} />
                <span><b>Workspace configuration required</b><small>Configure the Telegram bot on the TYR server, then return here to connect your private chat.</small></span>
              </div>
            )}
            {telegramBinding && (
              <div className="telegram-binding-code">
                <span>
                  <b>{telegramBinding.code}</b>
                  <small>{telegramExpiresAt ? `Expires ${telegramExpiresAt}` : "Short-lived binding code"}</small>
                </span>
                <div className="telegram-channel-actions">
                  {telegramBinding.deepLink && <a className="btn primary small" href={telegramBinding.deepLink} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open Telegram</a>}
                  <button className="btn small" type="button" onClick={() => void copyTelegramCode()}><Copy size={14} /> Copy code</button>
                </div>
              </div>
            )}
            {telegramMessage && <p className="settings-status inline-status" role="status">{telegramMessage}</p>}
          </section>
        </div>
      )}
      {logoutOpen && <LogoutModal busy={busy} onClose={() => setLogoutOpen(false)} onConfirm={() => void logout()} />}
    </>
  );
}

function BrowserSettingsSection({ snapshot }: { snapshot: AppSnapshot }) {
  const serverId = workspaceCacheServerId(snapshot);
  const serverName = snapshot.currentServer?.name ?? "this workspace";
  const [settings, setSettings] = useState<BrowserNotificationSettings>(() => loadBrowserNotificationSettings());
  const [capability, setCapability] = useState(() => browserNotificationCapability());
  const [message, setMessage] = useState("");
  const status = browserNotificationStatus(settings, capability);

  useEffect(() => {
    function refreshCapability() {
      setCapability(browserNotificationCapability());
    }
    // 用户可能在浏览器站点设置里改通知权限，页面回到前台时同步一次状态。
    window.addEventListener("focus", refreshCapability);
    document.addEventListener("visibilitychange", refreshCapability);
    return () => {
      window.removeEventListener("focus", refreshCapability);
      document.removeEventListener("visibilitychange", refreshCapability);
    };
  }, []);

  function persist(next: BrowserNotificationSettings) {
    const saved = saveBrowserNotificationSettings(next);
    setSettings(saved);
    return saved;
  }

  async function enableBrowserNotifications() {
    setMessage("");
    const notificationApi = typeof Notification === "undefined" ? undefined : Notification;
    if (!notificationApi) {
      setCapability(browserNotificationCapability(notificationApi));
      setMessage("Browser notifications are not supported.");
      return;
    }
    let permission = notificationApi.permission;
    if (permission === "default") permission = await notificationApi.requestPermission();
    setCapability(browserNotificationCapability(notificationApi));
    if (permission !== "granted") {
      setMessage(permission === "denied" ? "Notifications are blocked in browser site settings." : "Notification permission was not granted.");
      return;
    }
    persist({ ...settings, enabled: true });
    setMessage("Browser notifications enabled.");
  }

  function disableBrowserNotifications() {
    persist({ ...settings, enabled: false });
    setMessage("Browser notifications disabled.");
  }

  function refreshBrowserPermission() {
    setCapability(browserNotificationCapability());
    setMessage("Notification permission refreshed.");
  }

  function sendTestNotification() {
    const sent = sendBrowserNotification({
      title: "TYR",
      body: `Test notification from ${serverName}.`,
      tag: `tyr-test-${serverId}`
    });
    setCapability(browserNotificationCapability());
    setMessage(sent ? "Test notification sent." : "This browser could not deliver the test notification.");
  }

  return (
    <div className="settings-panel-stack">
      <section className="settings-card notification-card">
        <div className="account-card-head">
          <span className="settings-card-title">
            <h3>Browser delivery</h3>
            <small>DMs, direct mentions, DM thread replies, and Reminder DMs.</small>
          </span>
          <span className={`settings-change-state notification-${status.label.toLowerCase().replace(/\s+/g, "-")}`}>{status.label}</span>
        </div>
        <p className="notification-reason">{status.reason}</p>
        <div className="notification-delivery-note">
          <Bell size={16} />
          <span><b>Delivered by this browser</b><small>Keep TYR open on this device, including in a background tab. This is not offline Web Push.</small></span>
        </div>
        <div className="browser-notification-actions">
          {status.active && <button className="btn" onClick={disableBrowserNotifications}>Disable browser notifications</button>}
          {!status.active && status.canEnable && <button className="btn primary" onClick={() => void enableBrowserNotifications()}>Enable browser notifications</button>}
          {capability.permission === "denied" && <button className="btn primary" onClick={refreshBrowserPermission}>Check permission again</button>}
          {status.canSendTest && <button className="btn" onClick={sendTestNotification}>Send test notification</button>}
        </div>
        {message && <p className="settings-status inline-status" role="status">{message}</p>}
      </section>
    </div>
  );
}

function LogoutModal({ busy, onClose, onConfirm }: { busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal title="LOG OUT" onClose={onClose} className="template-form-modal template-form-modal-sm" backdropClassName="template-form-modal-backdrop" titleIcon={<LogOut size={18} />}>
      <div className="template-dialog-content">
        <div className="template-dialog-body">
          <div className="warning-box">
            <AlertTriangle size={26} />
            <p>Sign out of this browser? Your account and data are kept; you can log back in any time.</p>
          </div>
        </div>
        <div className="modal-actions template-dialog-actions">
          <button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn orange" disabled={busy} onClick={onConfirm}>Log out</button>
        </div>
      </div>
    </Modal>
  );
}

const SETTINGS_NAV_GROUPS: Array<{ label: string; items: Array<{ id: SettingsTab; label: string }> }> = [
  { label: "Personal", items: [{ id: "profile", label: "Profile" }, { id: "security", label: "Security & sessions" }] },
  { label: "Communication", items: [{ id: "channels", label: "Channels" }, { id: "notifications", label: "Notifications" }] },
  { label: "Developer", items: [{ id: "developer", label: "MCP & access tokens" }] },
  { label: "Workspace", items: [{ id: "workspace", label: "General" }] }
];

const SETTINGS_PAGE_META: Record<SettingsTab, { scope: string; title: string; description: string }> = {
  profile: { scope: "Personal", title: "Profile", description: "Manage the identity other people and Agents see in TYR." },
  security: { scope: "Personal", title: "Security & sessions", description: "Protect your account and control the current browser session." },
  channels: { scope: "Communication", title: "Channels", description: "Connect external conversations to TYR." },
  notifications: { scope: "Communication", title: "Notifications", description: "Choose how this browser alerts you about important activity." },
  developer: { scope: "Developer", title: "MCP & access tokens", description: "Connect clients and manage workspace-scoped developer credentials." },
  workspace: { scope: "Workspace", title: "General", description: "Manage identity and ownership-scoped settings for the current workspace." }
};

function settingsTabIcon(tab: SettingsTab): ReactElement {
  if (tab === "profile") return <UserRound size={16} />;
  if (tab === "security") return <KeyRound size={16} />;
  if (tab === "channels") return <MessageSquare size={16} />;
  if (tab === "notifications") return <Bell size={16} />;
  if (tab === "developer") return <Terminal size={16} />;
  return <Building2 size={16} />;
}

function SettingsView({ snapshot, topbarProps, tab, onTabChange, onRefresh, onLoggedOut }: { snapshot: AppSnapshot; topbarProps: WorkspaceTopBarProps; tab: SettingsTab; onTabChange: (tab: SettingsTab) => void; onRefresh: () => Promise<void>; onLoggedOut: () => void }) {
  const pageMeta = SETTINGS_PAGE_META[tab];
  const currentServerName = snapshot.currentServer?.name ?? "No workspace";
  const currentServerRole = memberRoleLabel(snapshot.currentServer?.role ?? "member");

  return (
    <div className="view user-profile-stack">
      <TopBar title="Settings" {...topbarProps} />
      <div className="settings-page">
        <div className="settings-shell">
          <nav className="settings-local-nav" aria-label="Settings sections">
            <div className="settings-local-nav-head">
              <span className="settings-local-nav-mark"><Settings size={17} /></span>
              <span><b>Control center</b><small>Account and workspace</small></span>
            </div>
            <div className="settings-local-nav-groups">
              {SETTINGS_NAV_GROUPS.map((group) => (
                <div className="settings-local-nav-group" key={group.label}>
                  <span className="settings-local-nav-label">{group.label}</span>
                  {group.items.map((item) => (
                    <button key={item.id} type="button" className={tab === item.id ? "settings-local-nav-item selected" : "settings-local-nav-item"} aria-current={tab === item.id ? "page" : undefined} onClick={() => onTabChange(item.id)}>
                      {settingsTabIcon(item.id)}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="settings-workspace-context">
              <Building2 size={15} />
              <span><small>Current workspace</small><b>{currentServerName}</b><em>{currentServerRole}</em></span>
            </div>
          </nav>

          <section className={tab === "developer" ? "settings-content developer" : "settings-content"} aria-labelledby="settings-page-title">
            <header className="settings-content-header">
              <span className={`settings-scope-badge scope-${pageMeta.scope.toLowerCase()}`}>{pageMeta.scope}</span>
              <h2 id="settings-page-title">{pageMeta.title}</h2>
              <p>{pageMeta.description}</p>
            </header>
            {(tab === "profile" || tab === "security" || tab === "channels" || tab === "developer") && <AccountSettingsSection snapshot={snapshot} tab={tab} onRefresh={onRefresh} onLoggedOut={onLoggedOut} />}
            {tab === "channels" && snapshot.currentServer && <PersonalRepliesPanel serverId={snapshot.currentServer.id} owner={snapshot.currentServer.role === "owner"} />}
            {tab === "notifications" && <BrowserSettingsSection snapshot={snapshot} />}
            {tab === "workspace" && <ServerSettingsSection snapshot={snapshot} onRefresh={onRefresh} />}
          </section>
        </div>
      </div>
    </div>
  );
}

function ServerSettingsSection({ snapshot, onRefresh }: { snapshot: AppSnapshot; onRefresh: () => Promise<void> }) {
  const serverId = workspaceCacheServerId(snapshot);
  const [serverName, setServerName] = useState(snapshot.currentServer?.name ?? (snapshot.currentUser.name.replace(/^user-/, "") || "young"));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setServerName(snapshot.currentServer?.name ?? "");
    setStatus("");
  }, [snapshot.currentServer?.id, snapshot.currentServer?.name]);

  async function saveServerProfile() {
    const name = serverName.trim();
    if (!name) {
      setStatus("Workspace name is required.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      // Workspace Management 目前只有 name 是真实可保存字段；slug/admin/join link/onboarding 不在本轮能力内。
      await api<{ server: ServerRecord; bootstrap: WorkspaceBootstrapPayload }>(`/api/servers/${serverId}`, {
        method: "PATCH",
        body: JSON.stringify({ name })
      });
      setStatus("Workspace profile saved.");
      await onRefresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const serverChanged = serverName.trim() !== (snapshot.currentServer?.name ?? "");
  const canSaveServer = snapshot.currentServer?.role === "owner" && Boolean(serverName.trim()) && serverChanged && !busy;
  const currentServerDisplayName = snapshot.currentServer?.name ?? "Current workspace";
  const owner = snapshot.currentServer?.role === "owner";

  return (
    <div className="settings-panel-stack">
      <section className="settings-card server-profile-card">
        <div className="account-card-head">
          <span className="settings-card-title server-profile-copy">
            <h3>Workspace identity</h3>
            <small>Changes apply anywhere this workspace name appears.</small>
          </span>
          <span className="settings-change-state workspace">{owner ? "Owner access" : "Read only"}</span>
        </div>
        <div className="workspace-identity-preview">
          <span className="settings-row-icon"><Building2 size={17} /></span>
          <span><small>Current workspace</small><b>{currentServerDisplayName}</b></span>
        </div>
        <label className="field-label" htmlFor="workspace-name">Workspace name</label>
        <input id="workspace-name" className="input" value={serverName} disabled={!owner} onChange={(event) => setServerName(event.target.value)} />
        {!owner && <p className="field-hint">Only workspace Owners can change this name.</p>}
        <div className="settings-form-actions">
          <button className="btn primary" disabled={!canSaveServer} onClick={() => void saveServerProfile()}>Save changes</button>
        </div>
        {status && <p className="settings-status inline-status" role="status">{status}</p>}
      </section>
    </div>
  );
}

function SkillsBlock({ agentId }: { agentId: string }) {
  const detectedSkills = useAgentSkills(agentId);
  const fallbackSkills = [
    ["imagegen", "Generate or edit raster images when the task benefits from AI-created bitmap visuals such as photos, illustrations, textures, sprites, mockups, or transparent-background cutouts."],
    ["openai-docs", "Use when the user asks how to build with OpenAI products or APIs and needs up-to-date official documentation with citations."],
    ["plugin-creator", "Create and scaffold plugin directories for Codex with required plugin metadata and baseline placeholders."],
    ["skill-creator", "Guide for creating effective skills that extend Codex with specialized knowledge, workflows, or tool integrations."],
    ["skill-installer", "Install Codex skills into $CODEX_HOME/skills from a curated list or a GitHub repo path."]
  ];
  const skills = detectedSkills.global.length > 0
    ? detectedSkills.global.map((skill) => [skill.displayName ?? skill.name, skill.description ?? skill.path])
    : fallbackSkills;
  return (
    <div className="info-block">
      <h3>SKILLS ({skills.length})</h3>
      <div className="skill-list">
        {skills.map(([name, description], index) => (
          <div key={name} className={index === 3 ? "skill-row focused" : "skill-row"}>
            <b>"{name}"</b>
            <p>{description}</p>
          </div>
        ))}
      </div>
      <h3 className="workspace-label"><Folder size={14} /> Workspace (0)</h3>
      {detectedSkills.workspace.length === 0 && <p className="muted-text">No skills in this agent's workspace</p>}
      {detectedSkills.workspace.map((skill) => (
        <div key={skill.path} className="workspace-row compact">
          <Folder size={14} />
          <b>{skill.name}</b>
          <small>{skill.path}</small>
        </div>
      ))}
    </div>
  );
}

function AgentWorkspace({ agent }: { agent: AgentRecord }) {
  const [dir, setDir] = useState(".");
  const [files, setFiles] = useState<WorkspaceFileNode[]>([]);
  const [workspacePath, setWorkspacePath] = useState(agent.workspacePath || "");
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileNode | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [state, setState] = useState("idle");

  async function load(nextDir = dir) {
    setState("loading");
    try {
      const pathParam = nextDir === "." ? "" : `?dirPath=${encodeURIComponent(nextDir)}`;
      const data = await api<WorkspaceFileNode[] | { workspacePath?: string; dirPath?: string; files: WorkspaceFileNode[] }>(`/api/agents/${agent.id}/workspace-files${pathParam}`);
      const nextFiles = Array.isArray(data) ? data : data.files;
      setDir(Array.isArray(data) ? nextDir : data.dirPath || nextDir);
      setFiles(nextFiles);
      if (!Array.isArray(data)) setWorkspacePath(data.workspacePath || agent.workspacePath || "");
      setSelectedFile(null);
      setFileContent("");
      setState("idle");
    } catch (err) {
      setState(err instanceof Error ? err.message : String(err));
    }
  }

  async function openFile(file: WorkspaceFileNode) {
    if (file.isDirectory) {
      await load(file.path);
      return;
    }
    setSelectedFile(file);
    setFileContent("Loading...");
    try {
      const data = await api<{ content: string | null; binary: boolean; size: number }>(`/api/agents/${agent.id}/workspace-file?path=${encodeURIComponent(file.path)}`);
      setFileContent(data.binary ? `Binary file (${data.size} bytes)` : data.content ?? "");
    } catch (err) {
      setFileContent(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load(".");
  }, [agent.id]);

  return (
    <div className="workspace-view agent-workspace">
      <div className="workspace-pathbar">
        <span>{workspacePath || agent.workspacePath || "~/.tyr-ai/agents"}/{dir !== "." ? dir : ""}</span>
        <button className="icon-btn" onClick={() => navigator.clipboard.writeText(workspacePath || agent.workspacePath || "")}><Copy size={15} /></button>
      </div>
      <div className="workspace-split">
        <aside className="workspace-tree">
          <div className="workspace-tree-head">
            <SectionLabel label="WORKSPACE" />
            {dir !== "." && <button className="icon-link" onClick={() => load(".")}>Root</button>}
            <button className="icon-link" onClick={() => load(dir)}><RefreshCw size={15} /></button>
          </div>
          {state !== "idle" && state !== "loading" && <div className="empty-box">{state}</div>}
          {state === "loading" && <div className="empty-box">Scanning...</div>}
          {state === "idle" && files.length === 0 && <div className="empty-box">No files in this workspace.</div>}
          {files.map((file) => (
            <button key={file.path} className={selectedFile?.path === file.path ? "tree-file selected" : "tree-file"} onClick={() => void openFile(file)}>
              {file.isDirectory ? <Folder size={18} /> : <FileText size={18} />}
              <span>{file.name}</span>
            </button>
          ))}
        </aside>
        <main className="workspace-preview">
          {!selectedFile && <div className="workspace-empty"><FileText size={44} /><p>Select a file to view</p></div>}
          {selectedFile && (
            <div className="file-preview">
              <div className="file-preview-head">
                <b>{selectedFile.path}</b>
                <small>{selectedFile.size} bytes · {new Date(selectedFile.modifiedAt).toLocaleString()}</small>
              </div>
              <pre>{fileContent}</pre>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function useAgentSkills(agentId: string) {
  const [skills, setSkills] = useState<{ global: SkillInfo[]; workspace: SkillInfo[] }>({ global: [], workspace: [] });
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await api<{ global: SkillInfo[]; workspace: SkillInfo[] }>(`/api/agents/${agentId}/skills`);
        if (active) setSkills(data);
      } catch {
        if (active) setSkills({ global: [], workspace: [] });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [agentId]);
  return skills;
}

function ActionsBlock({ primary, secondary, reset, report, danger, dangerText, onPrimary, onSecondary, onReset, onReport, onDanger }: { primary?: string; secondary?: string; reset?: string; report?: string; danger?: string; dangerText?: string; onPrimary?: () => void; onSecondary?: () => void; onReset?: () => void; onReport?: () => void; onDanger?: () => void }) {
  return (
    <div className="info-block actions-section">
      <h3>ACTIONS</h3>
      {primary && <button className="action-line" onClick={onPrimary}>{primary.toLowerCase().startsWith("start") ? <Play size={14} /> : <Square size={14} />} {primary}</button>}
      {secondary && <button className="action-line" onClick={onSecondary}><RefreshCw size={14} /> {secondary}</button>}
      {reset && <button className="action-line danger" onClick={onReset}><AlertTriangle size={14} /> {reset}</button>}
      {report && <button className="action-line report" onClick={onReport}><Bell size={14} /> {report}</button>}
      {danger && (
        <div className="danger-row">
          <div>{dangerText && <p>{dangerText}</p>}</div>
          <button className="action-line danger" onClick={onDanger}><X size={14} /> {danger}</button>
        </div>
      )}
    </div>
  );
}

function StopAgentModal({ agent, onClose, onDone }: { agent: AgentRecord; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function stop() {
    setBusy(true);
    await api(`/api/agents/${agent.id}/stop`, { method: "POST", body: "{}" });
    setBusy(false);
    onDone();
  }
  return (
    <Modal title="STOP AGENT" onClose={onClose} className="template-form-modal template-form-modal-sm" backdropClassName="template-form-modal-backdrop" titleIcon={<Square size={18} />}>
      <div className="template-dialog-content">
        <div className="template-dialog-body">
          <div className="warning-box">
            <AlertTriangle size={26} />
            <p>Are you sure you want to stop "{agent.displayName}"? The agent will stop processing messages.</p>
          </div>
        </div>
        <div className="modal-actions template-dialog-actions">
          <button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn orange" disabled={busy} onClick={() => void stop()}>Stop Agent</button>
        </div>
      </div>
    </Modal>
  );
}

function Placeholder({ title, text }: { title: string; text: string }) {
  return <div className="placeholder"><h2>{title}</h2><p>{text}</p></div>;
}

function EmptyState({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return (
    <div className="empty-state">
      <h1>{title}</h1>
      <button className="btn primary" onClick={onAction}><Plus size={16} /> {action}</button>
    </div>
  );
}

type OnboardingInstallPlatform = "unix" | "windows";

function ConnectComputerModal({ onboarding, serverName, onCreate, onClose }: { onboarding: MachineOnboardingLink | null; serverName: string; onCreate: (name: string) => Promise<MachineOnboardingLink>; onClose: () => void }) {
  const [copyStatus, setCopyStatus] = useState("");
  const [linkCopyStatus, setLinkCopyStatus] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const copyTimerRef = useRef<number | null>(null);
  const linkCopyTimerRef = useRef<number | null>(null);
  const [activeInstallPlatform, setActiveInstallPlatform] = useState<OnboardingInstallPlatform>(() => defaultOnboardingInstallPlatform());
  const [name, setName] = useState("New Device");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activeInstallCommand = activeInstallPlatform === "windows" ? onboarding?.windowsInstallCommand : onboarding?.installCommand;
  useEffect(() => () => {
    clearCopyTimer();
    clearLinkCopyTimer();
  }, []);
  useEffect(() => {
    clearCopyTimer();
    setCopyStatus("");
  }, [activeInstallCommand]);
  useEffect(() => {
    if (!onboarding?.onboardingUrl) {
      setQrDataUrl("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(onboarding.onboardingUrl, { margin: 1, width: 220 })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [onboarding?.onboardingUrl]);
  async function create() {
    const machineName = name.trim();
    if (!machineName) {
      setError("Device name is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onCreate(machineName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  async function copyActiveCommand() {
    if (!activeInstallCommand) return;
    await copyMessageText(activeInstallCommand);
    clearCopyTimer();
    setCopyStatus("Connect command copied.");
    // Match message copy feedback: show success briefly, then restore the copy affordance.
    copyTimerRef.current = window.setTimeout(() => setCopyStatus(""), 2200);
  }
  async function copyOnboardingUrl() {
    if (!onboarding?.onboardingUrl) return;
    await copyMessageText(onboarding.onboardingUrl);
    clearLinkCopyTimer();
    setLinkCopyStatus("Link copied.");
    linkCopyTimerRef.current = window.setTimeout(() => setLinkCopyStatus(""), 2200);
  }
  function clearCopyTimer() {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = null;
  }
  function clearLinkCopyTimer() {
    if (linkCopyTimerRef.current !== null) window.clearTimeout(linkCopyTimerRef.current);
    linkCopyTimerRef.current = null;
  }
  const expiresAt = onboarding?.intent.expiresAt ? new Date(onboarding.intent.expiresAt).toLocaleString() : "";
  return (
    <Modal title="CONNECT DEVICE" onClose={onClose} className="template-form-modal template-form-modal-md" backdropClassName="template-form-modal-backdrop" titleIcon={<HardDrive size={18} />}>
      {!onboarding && (
        <form className="template-form-content" onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}>
          <div className="template-form-grid">
            <div className="template-form-field full">
              <label className="field-label">Device name</label>
              <input
                className="input"
                value={name}
                maxLength={80}
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                }}
                autoFocus
              />
              <p className="field-help">Use a name you can recognize across shared workspaces. Hostname and IP stay in the device details.</p>
            </div>
            {error && <div className="login-error template-form-field full">{error}</div>}
          </div>
          <div className="modal-actions template-form-actions">
            <button className="btn" type="button" disabled={busy} onClick={onClose}>Cancel</button>
            <button className="btn primary" type="submit" disabled={busy || !name.trim()}><Plus size={16} /> Create link</button>
          </div>
        </form>
      )}
      {onboarding && (
        <div className="template-form-content">
          <div className="template-form-grid">
            <div className="template-form-field full">
              <p className="muted-text">This Device will join {serverName}.</p>
              <p className="muted-text">Open the short link on the target device, or run the install command there. The link expires in 15 minutes and can be used once.</p>
              {expiresAt && <p className="muted-text">Expires {expiresAt}.</p>}
              {import.meta.env.DEV && <p className="muted-text">For LAN demos, start the host with HOST=0.0.0.0 TYR_SERVER_URL=http://LAN_IP:5178 pnpm dev.</p>}
            </div>
            <div className="template-form-field full">
              <div className="pairing-token-box machine-onboarding-box">
                <b>{onboarding.machine.name}</b>
                {qrDataUrl
                  ? <img className="mobile-pairing-qr" src={qrDataUrl} alt="Device onboarding QR code" />
                  : <div className="mobile-pairing-qr loading">QR loading</div>}
                <small>Open this link on the target device.</small>
                <code>{onboarding.onboardingUrl}</code>
                <button className="copy" type="button" onClick={() => void copyOnboardingUrl()}><Copy size={15} /> Copy link</button>
                {linkCopyStatus && <p className="copy-feedback" role="status">{linkCopyStatus}</p>}
              </div>
            </div>
            <div className="template-form-field full">
              <div className="template-form-field full modal-choice">
                <button className={activeInstallPlatform === "unix" ? "choice active" : "choice"} type="button" onClick={() => setActiveInstallPlatform("unix")}>
                  <HardDrive size={18} />
                  <b>macOS / Linux</b>
                  <small>Shell installer for Unix-like target devices.</small>
                </button>
                <button className={activeInstallPlatform === "windows" ? "choice active" : "choice"} type="button" onClick={() => setActiveInstallPlatform("windows")}>
                  <Terminal size={18} />
                  <b>Windows</b>
                  <small>PowerShell installer for Windows target devices.</small>
                </button>
              </div>
            </div>
            <div className="template-form-field full">
              <ConnectCommandPanel
                title="INSTALL COMMAND"
                help={<p className="muted-text">Run this command on the target device if opening the link there is not convenient.</p>}
                command={activeInstallCommand}
                statusText="Loading install command..."
                copyStatus={copyStatus}
                hideCredentialBadge
                onCopy={() => void copyActiveCommand()}
              />
            </div>
            <div className="template-form-field full">
              <div className="waiting"><span className="dot yellow" /> Waiting for device to connect...</div>
            </div>
          </div>
          <div className="modal-actions template-form-actions">
            <button className="btn" type="button" onClick={onClose}>Cancel</button>
            <button className="btn green" type="button" onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function defaultOnboardingInstallPlatform(): OnboardingInstallPlatform {
  return /\bwin/i.test(currentConnectPlatform()) ? "windows" : "unix";
}

function CreateAgentModal({ snapshot, initialMachineId, onClose, onCreated, onRefresh }: { snapshot: AppSnapshot; initialMachineId?: string; onClose: () => void; onCreated: (agent: AgentRecord) => void; onRefresh: () => Promise<void> }) {
  const creatableMachines = filterCreatableMachines(snapshot.machines, snapshot.currentUser.id);
  const initialMachine = creatableMachines.find((machine) => machine.id === initialMachineId);
  const availableMachine = initialMachine ?? creatableMachines[0];
  const [machineId, setMachineId] = useState(availableMachine?.id ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [runtime, setRuntime] = useState<RuntimeId | "">("");
  const [model, setModel] = useState("default");
  const [reasoningEffort, setReasoningEffort] = useState("medium");
  const [permissionMode, setPermissionMode] = useState<RuntimePermissionMode>("dev-full-access");
  const [envText, setEnvText] = useState("");
  const [detectingModels, setDetectingModels] = useState(false);
  const [modelError, setModelError] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [autoDetectKey, setAutoDetectKey] = useState("");
  const advancedRef = useRef<HTMLDetailsElement | null>(null);
  const runtimeMachineIdRef = useRef(machineId);
  const selectedMachine = useMemo(() => creatableMachines.find((item) => item.id === machineId), [creatableMachines, machineId]);
  const selectedRuntimeReport = runtime ? selectedMachine?.runtimes?.find((item) => item.runtime === runtime) : undefined;
  const modelOptions = selectedRuntimeReport?.models ?? [];
  const availableRuntimes = useMemo<RuntimeId[]>(() => {
    const machine = creatableMachines.find((item) => item.id === machineId);
    return machine?.runtimes?.filter((item) => item.status === "available").map((item) => item.runtime) ?? [];
  }, [creatableMachines, machineId]);
  const runtimeIsAvailable = runtime !== "" && availableRuntimes.includes(runtime);
  const readOnlyRuntimeSupported = runtime !== "" && runtimePermissionModeSupported(runtime, "read-only");
  const readOnlySupported = runtime !== "" && runtimePermissionModeAvailable(runtime, "read-only", selectedRuntimeReport);
  const readOnlyAvailabilityLabel = readOnlySupported
    ? ""
    : readOnlyRuntimeSupported
      ? " (update daemon to use Read Only)"
      : " (unsupported by this runtime)";

  useEffect(() => {
    if (creatableMachines.some((machine) => machine.id === machineId)) return;
    const fallbackMachine = creatableMachines.find((machine) => machine.id === initialMachineId) ?? creatableMachines[0];
    setMachineId(fallbackMachine?.id ?? "");
  }, [snapshot.machines, snapshot.currentUser.id, initialMachineId, machineId]);

  async function refreshModels(manual = true) {
    if (!machineId || !runtime) return;
    setDetectingModels(true);
    setModelError("");
    try {
      const data = await api<{ models: RuntimeModel[]; default?: string }>(`/api/machines/${machineId}/runtimes/${runtime}/models/detect`, { method: "POST" });
      const nextModel = data.default || data.models[0]?.id || "default";
      setModel(nextModel);
      await onRefresh();
    } catch (err) {
      if (manual) setModelError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetectingModels(false);
    }
  }

  useEffect(() => {
    const machineChanged = runtimeMachineIdRef.current !== machineId;
    runtimeMachineIdRef.current = machineId;
    if (availableRuntimes.length === 1) {
      if (runtime !== availableRuntimes[0]) setRuntime(availableRuntimes[0]);
      return;
    }
    if (availableRuntimes.length > 1) {
      // 多 runtime 机器必须由用户显式选择，避免静默绑定到错误的本地 CLI。
      if (machineChanged || !runtimeIsAvailable) setRuntime("");
      return;
    }
    if (runtime !== "") setRuntime("");
  }, [availableRuntimes, machineId, runtime, runtimeIsAvailable]);

  useEffect(() => {
    if (permissionMode === "read-only" && runtime && !readOnlySupported) setPermissionMode(DEFAULT_RUNTIME_PERMISSION_MODE);
  }, [permissionMode, runtime, readOnlySupported]);

  useEffect(() => {
    const defaultModel = selectedRuntimeReport?.defaultModel;
    if (modelOptions.length === 0) {
      if (model !== "default") setModel("default");
      return;
    }
    if (!modelOptions.some((item) => item.id === model)) {
      setModel(defaultModel && modelOptions.some((item) => item.id === defaultModel) ? defaultModel : modelOptions[0].id);
    }
  }, [modelOptions, model, selectedRuntimeReport?.defaultModel]);

  useEffect(() => {
    const key = `${machineId}:${runtime}`;
    if (!machineId || !runtimeIsAvailable || selectedRuntimeReport?.status !== "available" || modelOptions.length > 0 || autoDetectKey === key || detectingModels) return;
    setAutoDetectKey(key);
    void refreshModels(false);
  }, [machineId, runtime, runtimeIsAvailable, selectedRuntimeReport?.status, modelOptions.length, autoDetectKey, detectingModels]);

  async function create() {
    if (!runtimeIsAvailable || creating) return;
    setCreateError("");
    setCreating(true);
    const envVars = Object.fromEntries(envText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const index = line.indexOf("=");
      return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1)] : ["", ""];
    }).filter(([key]) => key));
    try {
      const selectedRuntime = runtime;
      const data = await api<{ agent: AgentRecord }>("/api/agents", {
        method: "POST",
        body: JSON.stringify({ machineId, name, description, runtime: selectedRuntime, model, reasoningEffort, permissionMode, envVars })
      });
      onCreated(data.agent);
    } catch (error) {
      setCreateError(apiErrorMessage(error, "Agent creation failed. Please try again."));
    } finally {
      setCreating(false);
    }
  }

  function revealAdvancedWhenOpened() {
    const advanced = advancedRef.current;
    if (!advanced?.open) return;

    // Advanced lives at the bottom of the modal scroll region; reveal its fields after the open layout settles.
    requestAnimationFrame(() => {
      advanced.scrollIntoView({ block: "end", inline: "nearest" });
    });
  }

  return (
    <Modal title="CREATE AGENT" onClose={onClose} className="create-agent-modal" backdropClassName="create-agent-modal-backdrop" titleIcon={<Plus size={18} />}>
      <form className="create-agent-form" onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}>
        <div className="create-agent-form-grid">
          <div className="create-agent-field full">
            <label className="field-label">DEVICE *</label>
            <SelectControl className="input" value={machineId} onChange={(event) => setMachineId(event.target.value)} required>
              {creatableMachines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name} ({machine.hostname})</option>)}
            </SelectControl>
          </div>

          <div className="create-agent-field">
            <label className="field-label">NAME *</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Alice" required />
          </div>

          <div className="create-agent-field">
            <label className="field-label">CLI RUNTIME *</label>
            <SelectControl className="input" value={runtime} onChange={(event) => setRuntime(event.target.value as RuntimeId | "")}>
              {availableRuntimes.length > 1 && <option value="" disabled>Select a CLI runtime</option>}
              {availableRuntimes.length === 0 && <option value="" disabled>No CLI runtime available</option>}
              {RUNTIMES.map((item) => <option key={item.id} value={item.id} disabled={!availableRuntimes.includes(item.id)}>{item.displayName}{availableRuntimes.includes(item.id) ? "" : " (not installed)"}</option>)}
            </SelectControl>
          </div>

          <div className="create-agent-field">
            <label className="field-label">MODEL</label>
            <div className="create-agent-model-control">
              <SelectControl className="input" value={model} onChange={(event) => setModel(event.target.value)}>
                {modelOptions.length > 0
                  ? modelOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)
                  : <option value="default">Default</option>}
              </SelectControl>
              <button className="icon-btn subtle create-agent-refresh" type="button" disabled={!machineId || !runtimeIsAvailable || detectingModels} onClick={() => void refreshModels(true)} title="Refresh models" aria-label="Refresh models">
                <RefreshCw size={16} className={detectingModels ? "spin" : ""} />
              </button>
            </div>
            {!modelError && modelOptions.length === 0 && <p className="field-hint">No model list detected; the runtime default will be used.</p>}
            {modelError && <p className="field-hint error">{modelError}</p>}
          </div>

          <div className="create-agent-field">
            <label className="field-label">REASONING</label>
            <SelectControl className="input" value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value)}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">XHigh</option>
            </SelectControl>
          </div>

          <div className="create-agent-field full">
            <label className="field-label">AGENT PROFILE PROMPT <span>(optional)</span></label>
            <p className="field-hint">Server-authoritative role and persona instructions, applied to the Runtime under TYR platform policy.</p>
            <textarea className="input textarea" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe responsibilities, strengths, routing cues, and boundaries." />
          </div>

          <details ref={advancedRef} className="advanced create-agent-advanced" open onToggle={revealAdvancedWhenOpened}>
            <summary>ADVANCED</summary>
            <div className="create-agent-advanced-grid">
              <div className="create-agent-field">
                <label className="field-label">RUNTIME ACCESS</label>
                <p className="field-hint">Controls local files and commands. Tyr capabilities are configured separately.</p>
                <SelectControl className="input" value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as RuntimePermissionMode)}>
                  <option value="workspace-write">{permissionModeTitle("workspace-write")}</option>
                  <option value="read-only" disabled={!readOnlySupported}>Read Only{runtime ? readOnlyAvailabilityLabel : ""}</option>
                  <option value="dev-full-access">{permissionModeTitle("dev-full-access")}</option>
                </SelectControl>
              </div>
              <div className="create-agent-field">
                <label className="field-label">ENVIRONMENT VARIABLES</label>
                <textarea className="input textarea" value={envText} onChange={(event) => setEnvText(event.target.value)} placeholder="FOO=bar&#10;TOKEN=..." />
              </div>
            </div>
          </details>
          {createError && <div className="create-agent-error" role="alert">{createError}</div>}
        </div>

        <div className="modal-actions create-agent-actions">
          <button className="btn create-agent-cancel" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary create-agent-submit" type="submit" disabled={!machineId || !name.trim() || !runtimeIsAvailable || creating}>{creating ? "Creating..." : "Create Agent"}</button>
        </div>
      </form>
    </Modal>
  );
}
