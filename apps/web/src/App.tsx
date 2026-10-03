import { lazy, Suspense, type ReactNode, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Building2, ChevronRight, KeyRound, LogOut, Mail, Plus, RefreshCw, Server, UserRound } from "lucide-react";
import type { AppSnapshot, CrossWorkspaceMessageRecord, CursorPageInfo, DeviceListPayload, ExecutionBlockRecord, MessageRecord, ServerRecord, UserRecord, WorkspaceBootstrapPayload, WorkspaceNavigationPayload } from "@tyr-ai/contracts";
import { pathWithUiStyle, routeStateFromPath, uiStyleFromSearch } from "./routing";
import { loginBody, registerBody } from "./authPayload";
import { browserNotificationCapability, browserNotificationForMessage, browserNotificationStatus, loadBrowserNotificationSettings, sendBrowserNotification } from "./browserNotifications";
import { OnboardingPage } from "./app/OnboardingPage";
import { BridgeConnectionPage } from "./app/BridgeConnectionPage";
import { HelpdeskSignupAgentPanel } from "./app/HelpdeskSignupAgentPanel";
import { SignupConfirmPage } from "./app/SignupConfirmPage";
import { PasswordRecoveryConfirmPage } from "./app/PasswordRecoveryConfirmPage";
import { WorkspaceShell } from "./app/WorkspaceShell";
import { applyAgentActivitySnapshotPatch, applyAgentDeletedSnapshotPatch, applyMachineUpdatedSnapshotPatch, applyWorkspaceNavigationPayload, emptyWorkspaceCache, loginRedirectPath, mergeWorkspaceCachePreservingMessageCache, publicConversationToRecord, publicMessageToRecord, safeNextPath, shouldApplyAgentActivityRealtimeEvent, workspaceCacheServerId, socketEvent, upsertById, upsertMessage, workspaceBootstrapToWorkspaceCache, workspaceNavigationToWorkspaceCacheParts } from "./app/workspaceUtils";
import { shouldRefreshForInviteRealtimeEvent } from "./inviteHuman";
import type { AuthResponse, ServerAccess } from "./app/workspaceTypes";
import { ApiError, api, apiPath, isStaleAuthContextError, realtimeUrl } from "./lib/api";
import { clearAuthTokens, getAccessToken, invalidateAuthContext, isAuthStorageKey, setAuthTokens, subscribeAuthTokenChanges } from "./lib/authStorage";
import { mergeExecutionBlockRealtimePatches, mergeExecutionBlocksFromSnapshot } from "./executionBlockRealtime";
import { trimRuntimeApprovalsForRealtime, trimRuntimeEventsForRealtime } from "./runtimeRealtime";
import { notifyTopologyLiveWorkChanged } from "./topologyLiveWorkRealtime";
import { sanitizeWorkspaceSyncPayload } from "./workspaceSyncSanitizer";
import { emptyWorkspaceNavigationLoadState, emptyWorkspacePageDataError, emptyWorkspacePageDataLoaded, mergeWorkspacePageItems, workspaceDataRequirements, workspaceDevicePagePath, workspaceDeviceQueryKey, type WorkspaceNavigationLoadState, type WorkspacePageDataError, type WorkspacePageDataLoaded } from "./app/workspaceLoading";
import { createAgentNavigationRefreshCoordinator, type AgentNavigationRefreshCoordinator } from "./agentNavigationRealtime";
import { applyCommunicationAgentProgressEvent, clearCommunicationAgentProgressForSourceMessage, pruneCommunicationAgentProgress } from "./communicationAgentProgress";
import { TyrLogo } from "./shared/TyrLogo";
import { startDeploymentPresence } from "./deploymentPresence";

const emptyWorkspaceSummary: WorkspaceBootstrapPayload["summary"] = {
  dms: 0,
  agents: 0,
  machines: 0,
  humans: 0,
  devices: 0,
  openTasks: 0,
  incomingInvites: 0,
  unreadTotal: 0,
  resourceGrants: 0,
  workspaceBridges: 0,
  incomingWorkspaceBridges: 0
};
const emptyCursorPageInfo: CursorPageInfo = { limit: 50, nextCursor: null, hasMore: false };
const BOOTSTRAP_REFRESH_TIMEOUT_MS = 10_000;
const REALTIME_REPLAY_CHUNK_SIZE = 50;
const REALTIME_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;
const WORKSPACE_NAVIGATION_SECTIONS: WorkspaceNavigationPayload["section"][] = ["dms", "agents", "machines", "humans", "resource-grants"];
const OperatorApp = lazy(() => import("./app/OperatorApp").then((module) => ({ default: module.OperatorApp })));

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = routeStateFromPath(location.pathname, location.search);
  const uiStyle = uiStyleFromSearch(location.search);
  const realtimeChannelId = routeState.selectedChannelId ?? routeState.threadChannelId ?? "";
  const [workspaceCache, setWorkspaceCache] = useState<AppSnapshot>(emptyWorkspaceCache);
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [authToken, setAuthToken] = useState(() => getAccessToken() ?? "");
  const [loggedIn, setLoggedIn] = useState(() => Boolean(getAccessToken()));
  const [serverAccess, setServerAccess] = useState<ServerAccess>(() => Boolean(getAccessToken()) ? "loading" : "none");
  const [error, setError] = useState<string>("");
  const [workspaceSummary, setWorkspaceSummary] = useState<WorkspaceBootstrapPayload["summary"]>(emptyWorkspaceSummary);
  const [workspaceNavigationLoadState, setWorkspaceNavigationLoadState] = useState<WorkspaceNavigationLoadState>(emptyWorkspaceNavigationLoadState);
  const [pageDataLoaded, setPageDataLoaded] = useState<WorkspacePageDataLoaded>(emptyWorkspacePageDataLoaded);
  const [pageDataError, setPageDataError] = useState<WorkspacePageDataError>(emptyWorkspacePageDataError);
  const [devicePageInfo, setDevicePageInfo] = useState<CursorPageInfo>(emptyCursorPageInfo);
  const [pageDataLoading, setPageDataLoading] = useState({ devices: false });
  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const realtimeChannelIdRef = useRef(realtimeChannelId);
  const lastRealtimeSeqRef = useRef(0);
  const agentActivityRealtimeSeqRef = useRef(new Map<string, number>());
  const workspaceCacheRef = useRef(workspaceCache);
  const workspaceNavigationLoadStateRef = useRef(workspaceNavigationLoadState);
  const pendingDeviceDetailRef = useRef("");
  const pendingRuntimeExecutionsRef = useRef<any[]>([]);
  const pendingRuntimeEventsRef = useRef<any[]>([]);
  const runtimeRealtimeFrameRef = useRef<number | null>(null);
  const pendingExecutionBlocksRef = useRef<ExecutionBlockRecord[]>([]);
  const executionBlockRealtimeFrameRef = useRef<number | null>(null);
  const bootstrapRefreshAbortRef = useRef<AbortController | null>(null);
  const bootstrapRefreshGenerationRef = useRef(0);
  const machineNavigationRefreshGenerationRef = useRef(0);
  const agentNavigationRefreshCoordinatorRef = useRef<AgentNavigationRefreshCoordinator | null>(null);
  const realtimeReplayGenerationRef = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const syncViewportHeight = () => {
      const height = viewport?.height ?? window.innerHeight;
      if (height > 0) root.style.setProperty("--app-viewport-height", `${height}px`);
    };

    // Android WebView 软键盘会改变 visual viewport，但 CSS vh 可能仍停在旧高度。
    syncViewportHeight();
    viewport?.addEventListener("resize", syncViewportHeight);
    viewport?.addEventListener("scroll", syncViewportHeight);
    window.addEventListener("resize", syncViewportHeight);
    return () => {
      viewport?.removeEventListener("resize", syncViewportHeight);
      viewport?.removeEventListener("scroll", syncViewportHeight);
      window.removeEventListener("resize", syncViewportHeight);
      root.style.removeProperty("--app-viewport-height");
    };
  }, []);

  useEffect(() => {
    return subscribeAuthTokenChanges((nextAccessToken) => {
      // REST 自动续签发生在当前页面时，同步重建 SSE/WebSocket，避免它们继续携带已经失效的旧 token。
      setAuthToken(nextAccessToken ?? "");
      setLoggedIn(Boolean(nextAccessToken));
    });
  }, []);

  useEffect(() => {
    const handleAuthStorageChange = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (!isAuthStorageKey(event.key)) return;
      // storage 事件来自其他窗口；先推进认证代次，让所有旧身份的在途请求立即失效。
      invalidateAuthContext();
      const nextAccessToken = getAccessToken() ?? "";
      if (nextAccessToken === authToken) return;
      // 同源窗口共享 localStorage；账号切换后必须重载全部内存快照，不能让旧 Workspace 继续使用新身份请求。
      window.location.reload();
    };
    window.addEventListener("storage", handleAuthStorageChange);
    return () => window.removeEventListener("storage", handleAuthStorageChange);
  }, [authToken]);

  useEffect(() => {
    if (!(workspaceCache.communicationAgentProgress?.length)) return;
    const timer = window.setInterval(() => {
      updateWorkspaceCache((current) => {
        // 断线遗漏终态时主动释放临时进度和发送锁，避免页面永久卡在 responding。
        const active = pruneCommunicationAgentProgress(current.communicationAgentProgress ?? []);
        return active.length === (current.communicationAgentProgress?.length ?? 0)
          ? current
          : { ...current, communicationAgentProgress: active };
      });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [workspaceCache.communicationAgentProgress?.length]);

  function updateWorkspaceCache(updater: AppSnapshot | ((current: AppSnapshot) => AppSnapshot)) {
    const next = typeof updater === "function" ? updater(workspaceCacheRef.current) : updater;
    workspaceCacheRef.current = next;
    setWorkspaceCache(next);
  }

  function applyWorkspaceCache(next: AppSnapshot) {
    const sanitized = sanitizeWorkspaceSyncPayload(next);
    const normalized = {
      ...sanitized,
      runtimeApprovals: trimRuntimeApprovalsForRealtime(sanitized.runtimeApprovals ?? []),
      runtimeExecutionEvents: trimRuntimeEventsForRealtime(sanitized.runtimeExecutionEvents ?? []),
      executionGroups: sanitized.executionGroups ?? [],
      agentRuns: sanitized.agentRuns ?? [],
      executionBlocks: sanitized.executionBlocks ?? [],
      executionArtifacts: sanitized.executionArtifacts ?? [],
      governanceDecisions: sanitized.governanceDecisions ?? []
    };
    updateWorkspaceCache((current) => {
      const merged = mergeWorkspaceCachePreservingMessageCache(current, normalized);
      return {
        ...merged,
        executionBlocks: mergeExecutionBlocksFromSnapshot(current.executionBlocks ?? [], normalized.executionBlocks ?? [], normalized.runtimeExecutions ?? [])
      };
    });
  }

  function updateWorkspaceNavigationLoadState(next: WorkspaceNavigationLoadState) {
    workspaceNavigationLoadStateRef.current = next;
    setWorkspaceNavigationLoadState(next);
  }

  function cachedWorkspaceCachePartsForBootstrap(bootstrap: WorkspaceBootstrapPayload): Partial<AppSnapshot> {
    const current = workspaceCacheRef.current;
    if (current.currentUser.id !== "loading" && current.currentUser.id !== bootstrap.currentUser.id) return {};
    if ((current.currentServer?.id ?? null) !== (bootstrap.currentServer?.id ?? null)) return {};
    return {
      machines: current.machines,
      agents: current.agents,
      humans: current.humans,
      channels: current.channels,
      messages: current.messages,
      devices: current.devices,
      deviceGrants: current.deviceGrants,
      deviceAccessRules: current.deviceAccessRules,
      deviceCommands: current.deviceCommands,
      tasks: [],
      savedMessageIds: current.savedMessageIds,
      reminders: current.reminders,
      runtimeApprovals: current.runtimeApprovals,
      runtimeExecutions: current.runtimeExecutions,
      runtimeExecutionEvents: current.runtimeExecutionEvents,
      executionGroups: current.executionGroups,
      agentRuns: current.agentRuns,
      executionBlocks: current.executionBlocks,
      executionArtifacts: current.executionArtifacts,
      communicationAgentProgress: current.communicationAgentProgress,
      safetyAssessments: current.safetyAssessments,
      governanceDecisions: current.governanceDecisions,
      resourceGrantSummaries: current.resourceGrantSummaries,
      crossWorkspaceMessages: current.crossWorkspaceMessages
    };
  }

  function applyBootstrap(bootstrap: WorkspaceBootstrapPayload, partial: Partial<AppSnapshot> = {}) {
    const currentServerId = workspaceCacheRef.current.currentServer?.id ?? null;
    const nextServerId = bootstrap.currentServer?.id ?? null;
    setWorkspaceSummary(bootstrap.summary);
    if (currentServerId !== nextServerId) {
      agentActivityRealtimeSeqRef.current.clear();
      lastRealtimeSeqRef.current = 0;
      machineNavigationRefreshGenerationRef.current += 1;
      agentNavigationRefreshCoordinatorRef.current?.reset();
      setPageDataLoaded({ ...emptyWorkspacePageDataLoaded, serverId: nextServerId });
      setPageDataError(emptyWorkspacePageDataError);
      setDevicePageInfo(emptyCursorPageInfo);
    }
    if (workspaceNavigationLoadStateRef.current.serverId !== nextServerId) {
      // Server 切换后先进入导航加载态，避免把 bootstrap 中的空列表渲染成真实空拓扑。
      updateWorkspaceNavigationLoadState(nextServerId
        ? { serverId: nextServerId, status: "loading" }
        : emptyWorkspaceNavigationLoadState);
    }
    applyWorkspaceCache(workspaceBootstrapToWorkspaceCache(bootstrap, {
      ...cachedWorkspaceCachePartsForBootstrap(bootstrap),
      ...partial
    }));
  }

  function noteRealtimeSeq(value: unknown) {
    const seq = Number(value);
    if (Number.isFinite(seq) && seq > lastRealtimeSeqRef.current) lastRealtimeSeqRef.current = seq;
  }

  function queueRuntimeRealtimePatch(input: { execution?: any; event?: any }) {
    if (input.execution?.id) pendingRuntimeExecutionsRef.current.push(input.execution);
    if (input.event?.id) pendingRuntimeEventsRef.current.push(input.event);
    if (runtimeRealtimeFrameRef.current !== null) return;
    runtimeRealtimeFrameRef.current = window.requestAnimationFrame(() => {
      runtimeRealtimeFrameRef.current = null;
      const executions = pendingRuntimeExecutionsRef.current.splice(0);
      const events = pendingRuntimeEventsRef.current.splice(0);
      if (executions.length === 0 && events.length === 0) return;
      updateWorkspaceCache((current) => ({
        ...current,
        runtimeExecutions: executions.reduce((items, execution) => upsertById(items, execution), current.runtimeExecutions ?? []),
        runtimeExecutionEvents: trimRuntimeEventsForRealtime(events.reduce((items, runtimeEvent) => upsertById(items, runtimeEvent), current.runtimeExecutionEvents ?? []))
      }));
    });
  }

  function queueExecutionBlockRealtimePatch(block: ExecutionBlockRecord) {
    pendingExecutionBlocksRef.current.push(block);
    if (executionBlockRealtimeFrameRef.current !== null) return;
    executionBlockRealtimeFrameRef.current = window.requestAnimationFrame(() => {
      executionBlockRealtimeFrameRef.current = null;
      const blocks = pendingExecutionBlocksRef.current.splice(0);
      if (blocks.length === 0) return;
      updateWorkspaceCache((current) => ({
        ...current,
        executionBlocks: mergeExecutionBlockRealtimePatches(current.executionBlocks ?? [], blocks)
      }));
    });
  }

  function replayRealtimeMessagesInChunks(messages: any[], payload: any) {
    const currentSeq = Number(payload?.currentSeq);
    if (Number.isFinite(currentSeq) && currentSeq >= 0 && currentSeq < lastRealtimeSeqRef.current) {
      // Server 重启会重置内存事件序号；旧游标无法补齐时直接恢复一次服务端快照。
      lastRealtimeSeqRef.current = currentSeq;
      void refresh();
      return;
    }
    const replayGeneration = ++realtimeReplayGenerationRef.current;
    let index = 0;
    const processChunk = () => {
      if (replayGeneration !== realtimeReplayGenerationRef.current) return;
      const nextIndex = Math.min(index + REALTIME_REPLAY_CHUNK_SIZE, messages.length);
      for (; index < nextIndex; index += 1) {
        const item = messages[index];
        if (!item || typeof item.event !== "string") continue;
        applyRealtimeEvent(item.event, item.payload);
        noteRealtimeSeq(item.seq);
      }
      if (index < messages.length) {
        window.setTimeout(processChunk, 0);
        return;
      }
      noteRealtimeSeq(payload?.currentSeq);
      // 缓冲窗口外的事件无法精确补齐，用 workspace bootstrap 兜底恢复一致性。
      if (payload?.hasMore) void refresh();
    };
    processChunk();
  }

  function applyRealtimeEvent(event: string, payload: any) {
    if (event === "sync:resume:response") {
      const messages = Array.isArray(payload?.messages) ? payload.messages : [];
      replayRealtimeMessagesInChunks(messages, payload);
      return;
    }
    if (event === "heartbeat") {
      noteRealtimeSeq(payload?.seq);
      return;
    }
    noteRealtimeSeq(payload?.serverSeq);
    if (event === "workspace:bootstrap") {
      applyBootstrap(payload as WorkspaceBootstrapPayload);
      return;
    }
    if (event === "rooms:joined" || event === "channel:joined" || event === "channel:left") return;
    if (event === "communication_agent:progress") {
      // 进度只驻留在客户端快照，不写入正式消息历史。
      updateWorkspaceCache((current) => ({
        ...current,
        communicationAgentProgress: applyCommunicationAgentProgressEvent(current.communicationAgentProgress ?? [], payload)
      }));
      // running_action 可能刚刚创建 TYR -> worker handoff；即时重取 Flow，不能等十五秒兜底轮询。
      if (payload?.progress?.phase === "running_action") notifyTopologyLiveWorkChanged();
      return;
    }
    if (event === "machine:updated") {
      updateWorkspaceCache((current) => applyMachineUpdatedSnapshotPatch(current, payload));
      if (payload?.deleted !== true) void refreshMachineNavigation();
      return;
    }
    // machine:updated 是同一轮广播中的完整主事件；其余两个兼容事件不能再次触发刷新。
    if (event === "machine:status" || event === "machine:capabilities") return;
    if (event === "conversation:created") {
      if (!payload?.conversation || typeof payload?.channelId !== "string" || typeof payload?.activeConversationId !== "string") return;
      const conversation = publicConversationToRecord(payload.conversation);
      updateWorkspaceCache((current) => ({
        ...current,
        // MCP 与 Web 共用 DM current pointer；会话级事件直接更新页面，避免等待下一轮 workspace bootstrap。
        channels: current.channels.map((channel) => channel.id === payload.channelId
          ? { ...channel, activeConversationId: payload.activeConversationId }
          : channel),
        conversations: upsertById(current.conversations ?? [], conversation)
      }));
      return;
    }
    if (event === "channel:updated" || event === "channel:deleted" || event === "channel:members-updated" || event === "thread:updated" || shouldRefreshForInviteRealtimeEvent(event)) {
      void refresh();
      return;
    }
    if (event === "message:new" || event === "message:updated") {
      const message = publicMessageToRecord(payload);
      const shouldNotify = event === "message:new" && !workspaceCacheRef.current.messages.some((item) => item.id === message.id);
      // 消息状态先进入页面；通知是可失败的浏览器副作用，不能阻断实时消息更新。
      updateWorkspaceCache((current) => ({
        ...current,
        messages: upsertMessage(current.messages, message),
        ...(message.result?.communicationRequest?.sourceMessageId ? {
          // 最终结果自身也是终态证据，作为 progress websocket 事件丢失时的精确兜底。
          communicationAgentProgress: clearCommunicationAgentProgressForSourceMessage(
            current.communicationAgentProgress ?? [],
            message.result.communicationRequest.sourceMessageId
          )
        } : {})
      }));
      if (shouldNotify) maybeSendBrowserNotification(workspaceCacheRef.current, message);
      return;
    }
    if (event === "workspace_bridge:message") {
      const message = payload?.message as CrossWorkspaceMessageRecord | undefined;
      if (!message?.id) return;
      // Bridge 明细不进入普通 DM 消息缓存，按独立记录实时合并。
      updateWorkspaceCache((current) => ({
        ...current,
        crossWorkspaceMessages: upsertById(current.crossWorkspaceMessages ?? [], message)
      }));
      // Journey phase is a server-side join across Bridge messages and Runtime events; refetch it on every persisted Bridge transition.
      notifyTopologyLiveWorkChanged();
      return;
    }
    if (event === "topology_live_work:changed") {
      // payload 仅作为 Bridge 范围失效通知；真实可见流统一从权限过滤后的 endpoint 重取。
      notifyTopologyLiveWorkChanged();
      return;
    }
    if (event === "runtime_execution:updated") {
      const execution = payload?.execution;
      if (!execution?.id) return;
      queueRuntimeRealtimePatch({ execution });
      return;
    }
    if (event === "runtime_execution:event") {
      const runtimeEvent = payload?.event;
      if (!runtimeEvent?.id) return;
      queueRuntimeRealtimePatch({ event: runtimeEvent });
      return;
    }
    if (event === "runtime_approval:updated") {
      const approval = payload?.approval;
      if (!approval?.id) return;
      updateWorkspaceCache((current) => ({
        ...current,
        runtimeApprovals: trimRuntimeApprovalsForRealtime(upsertById(current.runtimeApprovals ?? [], approval))
      }));
      return;
    }
    if (event === "execution_group:updated") {
      const group = payload?.group;
      if (!group?.id) return;
      updateWorkspaceCache((current) => ({
        ...current,
        executionGroups: upsertById(current.executionGroups ?? [], group)
      }));
      return;
    }
    if (event === "agent_run:updated") {
      const run = payload?.run;
      if (!run?.id) return;
      updateWorkspaceCache((current) => ({
        ...current,
        agentRuns: upsertById(current.agentRuns ?? [], run)
      }));
      return;
    }
    if (event === "execution_block:upserted" || event === "execution_block:preview") {
      const block = payload?.block;
      if (!block?.id) return;
      queueExecutionBlockRealtimePatch(block);
      return;
    }
    if (event === "execution_artifact:created") {
      const artifact = payload?.artifact;
      if (!artifact?.id) return;
      updateWorkspaceCache((current) => ({
        ...current,
        executionArtifacts: upsertById(current.executionArtifacts ?? [], artifact)
      }));
      return;
    }
    if (event === "safety_assessment:updated") {
      const assessment = payload?.assessment;
      if (!assessment?.id) return;
      updateWorkspaceCache((current) => ({
        ...current,
        safetyAssessments: upsertById(current.safetyAssessments ?? [], assessment)
      }));
      return;
    }
    if (event === "governance_decision:created") {
      const decision = payload?.decision;
      if (!decision?.id) return;
      updateWorkspaceCache((current) => ({
        ...current,
        governanceDecisions: upsertById(current.governanceDecisions ?? [], decision)
      }));
      return;
    }
    if (event === "agent:activity") {
      if (!shouldApplyAgentActivityRealtimeEvent(agentActivityRealtimeSeqRef.current, payload)) return;
      updateWorkspaceCache((current) => applyAgentActivitySnapshotPatch(current, payload));
      return;
    }
    if (event === "agent:created" || event === "agent:updated") {
      agentNavigationRefreshCoordinatorRef.current?.invalidate();
      return;
    }
    if (event === "agent:deleted") {
      updateWorkspaceCache((current) => applyAgentDeletedSnapshotPatch(current, payload));
      agentNavigationRefreshCoordinatorRef.current?.invalidate();
      return;
    }
    if (event === "dm:new") {
      void refresh();
    }
  }

  async function refresh() {
    bootstrapRefreshAbortRef.current?.abort();
    const refreshGeneration = bootstrapRefreshGenerationRef.current + 1;
    bootstrapRefreshGenerationRef.current = refreshGeneration;
    const controller = new AbortController();
    bootstrapRefreshAbortRef.current = controller;
    const bootstrapApiInit = (label: string) => ({
      signal: controller.signal,
      timeoutMs: BOOTSTRAP_REFRESH_TIMEOUT_MS,
      label
    });
    try {
      const [me, servers] = await Promise.all([
        api<UserRecord>("/api/auth/me", bootstrapApiInit("bootstrap.auth.me")),
        api<ServerRecord[]>("/api/servers", bootstrapApiInit("bootstrap.servers"))
      ]);
      if (controller.signal.aborted || refreshGeneration !== bootstrapRefreshGenerationRef.current) return;
      setServers(servers);
      if (servers.length === 0) {
        applyWorkspaceCache({ ...emptyWorkspaceCache, currentUser: me });
        setWorkspaceSummary(emptyWorkspaceSummary);
        updateWorkspaceNavigationLoadState(emptyWorkspaceNavigationLoadState);
        setPageDataLoaded(emptyWorkspacePageDataLoaded);
        setPageDataError(emptyWorkspacePageDataError);
        setDevicePageInfo(emptyCursorPageInfo);
        setServerAccess("none");
        setError("");
        return;
      }
      // 登录门槛只依赖轻量 bootstrap；导航分页随后独立填充，单个慢列表不能把用户挡在 Loading workspace。
      const bootstrap = await api<WorkspaceBootstrapPayload>("/api/workspace/bootstrap", bootstrapApiInit("bootstrap.workspace"));
      if (controller.signal.aborted || refreshGeneration !== bootstrapRefreshGenerationRef.current) return;
      applyBootstrap(bootstrap);
      const bootstrapServerId = bootstrap.currentServer?.id ?? null;
      const navigationWasReady = workspaceNavigationLoadStateRef.current.serverId === bootstrapServerId
        && workspaceNavigationLoadStateRef.current.status === "ready";
      if (bootstrapServerId && !navigationWasReady) {
        updateWorkspaceNavigationLoadState({ serverId: bootstrapServerId, status: "loading" });
      }
      setServerAccess("ready");
      setError("");

      const navigationResults = await Promise.allSettled(
        WORKSPACE_NAVIGATION_SECTIONS.map((section) => fetchWorkspaceNavigation(section, controller.signal))
      );
      if (controller.signal.aborted || refreshGeneration !== bootstrapRefreshGenerationRef.current) return;
      const navigationPayloads = navigationResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      if (navigationPayloads.length > 0) {
        updateWorkspaceCache((current) => navigationPayloads.reduce(applyWorkspaceNavigationPayload, current));
      }
      const navigationFailures = navigationResults.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      if (navigationFailures.some((failure) => failure instanceof ApiError && failure.code === "unauthorized")) {
        finishLogout();
        return;
      }
      if (navigationFailures.length > 0) {
        // 已有完整数据的后台刷新失败时继续展示旧拓扑；冷启动失败则显式提供重试，不能误报为空。
        if (!navigationWasReady && bootstrapServerId) {
          updateWorkspaceNavigationLoadState({ serverId: bootstrapServerId, status: "error" });
        }
        console.warn("[web] workspace navigation loaded partially", navigationFailures);
      } else if (bootstrapServerId) {
        updateWorkspaceNavigationLoadState({ serverId: bootstrapServerId, status: "ready" });
      }
    } catch (err) {
      if (isStaleAuthContextError(err)) return;
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof ApiError ? err.code : message;
      if (code === "unauthorized") {
        finishLogout();
        setError("");
        return;
      }
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (code === "server_membership_required") {
        setServerAccess("none");
        setError("");
        return;
      }
      if (refreshGeneration !== bootstrapRefreshGenerationRef.current) return;
      setError(code === "api_timeout" ? "Workspace bootstrap timed out. Please try again." : message);
    } finally {
      if (bootstrapRefreshAbortRef.current === controller) bootstrapRefreshAbortRef.current = null;
    }
  }

  function maybeSendBrowserNotification(current: AppSnapshot, message: MessageRecord) {
    const settings = loadBrowserNotificationSettings();
    const status = browserNotificationStatus(settings, browserNotificationCapability());
    if (!status.active) return;
    const notification = browserNotificationForMessage(current, message, {
      activeChannelId: realtimeChannelIdRef.current,
      documentVisible: document.visibilityState === "visible",
      windowFocused: document.hasFocus()
    });
    if (notification) sendBrowserNotification(notification);
  }

  function fetchWorkspaceNavigation(section: WorkspaceNavigationPayload["section"], signal?: AbortSignal): Promise<WorkspaceNavigationPayload> {
    return api<WorkspaceNavigationPayload>(`/api/workspace/navigation?section=${encodeURIComponent(section)}&limit=100`, {
      signal,
      timeoutMs: BOOTSTRAP_REFRESH_TIMEOUT_MS,
      label: `bootstrap.navigation.${section}`
    });
  }

  async function refreshMachineNavigation() {
    const generation = machineNavigationRefreshGenerationRef.current + 1;
    machineNavigationRefreshGenerationRef.current = generation;
    const serverId = workspaceCacheRef.current.currentServer?.id ?? null;
    if (!serverId) return;
    try {
      const machineNav = await fetchWorkspaceNavigation("machines");
      if (generation !== machineNavigationRefreshGenerationRef.current || workspaceCacheRef.current.currentServer?.id !== serverId) return;
      const machines = workspaceNavigationToWorkspaceCacheParts([machineNav]).machines ?? [];
      updateWorkspaceCache((current) => ({
        ...current,
        // Navigation 才携带完整 runtime reports；Agent 子树继续使用当前 realtime 缓存。
        machines: machines.map((machine) => ({
          ...machine,
          agents: current.agents.filter((agent) => agent.machineId === machine.id)
        }))
      }));
    } catch (err) {
      if (isStaleAuthContextError(err)) return;
      if (generation === machineNavigationRefreshGenerationRef.current) {
        console.warn("[web] failed to refresh Device navigation after realtime update", err);
      }
    }
  }

  async function refreshAgentNavigation() {
    const serverId = workspaceCacheRef.current.currentServer?.id ?? null;
    if (!serverId) return;
    const sections: WorkspaceNavigationPayload["section"][] = ["agents", "dms"];
    const navigationPayloads = await Promise.all(sections.map((section) => fetchWorkspaceNavigation(section)));
    if (workspaceCacheRef.current.currentServer?.id !== serverId) return;
    updateWorkspaceCache((current) => (
      current.currentServer?.id === serverId
        ? navigationPayloads.reduce(applyWorkspaceNavigationPayload, current)
        : current
    ));
  }

  async function refreshRoutePageData(force = false, options: { appendDevices?: boolean } = {}) {
    const requirements = workspaceDataRequirements(routeState);
    const serverId = workspaceCacheRef.current.currentServer?.id ?? null;
    if (!serverId) return;
    const deviceQueryKey = workspaceDeviceQueryKey();
    const loadedForServer = pageDataLoaded.serverId === serverId;
    const shouldLoadDevices = requirements.devices && (options.appendDevices ? Boolean(devicePageInfo.nextCursor) : force || !loadedForServer || !pageDataLoaded.devices || pageDataLoaded.deviceQueryKey !== deviceQueryKey);
    if (!shouldLoadDevices) return;
    setPageDataLoading((current) => ({
      devices: current.devices || shouldLoadDevices
    }));
    setPageDataError((current) => ({
      devices: shouldLoadDevices ? "" : current.devices
    }));
    try {
      const devicePayload = await api<DeviceListPayload>(workspaceDevicePagePath({ cursor: options.appendDevices ? devicePageInfo.nextCursor : null }));
      if ((workspaceCacheRef.current.currentServer?.id ?? null) !== serverId) return;
      updateWorkspaceCache((current) => ({
        ...current,
        tasks: [],
        devices: options.appendDevices ? mergeWorkspacePageItems(current.devices ?? [], devicePayload.devices) : devicePayload.devices
      }));
      setDevicePageInfo(devicePayload.pageInfo);
      setPageDataLoaded(() => {
        return {
          serverId,
          devices: true,
          deviceQueryKey
        };
      });
      setPageDataError((current) => ({
        devices: shouldLoadDevices ? "" : current.devices
      }));
      setError("");
    } catch (err) {
      if (isStaleAuthContextError(err)) return;
      const message = err instanceof Error ? err.message : String(err);
      if (message === "unauthorized") {
        finishLogout();
        return;
      }
      setPageDataError((current) => ({
        devices: shouldLoadDevices ? message : current.devices
      }));
      setError(message);
    } finally {
      setPageDataLoading((current) => ({
        devices: shouldLoadDevices ? false : current.devices
      }));
    }
  }

  async function refreshWorkspaceAndRouteData() {
    await refresh();
    await refreshRoutePageData(true);
  }

  async function loadMoreRouteDevices() {
    await refreshRoutePageData(true, { appendDevices: true });
  }

  useEffect(() => {
    if (!loggedIn) return;
    setServerAccess("loading");
    void refresh();
  }, [loggedIn, authToken]);

  useEffect(() => {
    if (!loggedIn || serverAccess !== "ready") return;
    void refreshRoutePageData();
  }, [loggedIn, serverAccess, routeState.view, workspaceCache.currentServer?.id, pageDataLoaded.serverId, pageDataLoaded.devices, pageDataLoaded.deviceQueryKey]);

  useEffect(() => {
    if (!loggedIn || serverAccess !== "ready" || !routeState.selectedDeviceId) return;
    if ((workspaceCache.devices ?? []).some((device) => device.id === routeState.selectedDeviceId)) return;
    if (pendingDeviceDetailRef.current === routeState.selectedDeviceId) return;
    pendingDeviceDetailRef.current = routeState.selectedDeviceId;
    let active = true;
    async function loadSelectedDevice() {
      try {
        const data = await api<Pick<AppSnapshot, "deviceGrants" | "deviceAccessRules" | "deviceCommands"> & { device: AppSnapshot["devices"][number] }>(`/api/devices/${encodeURIComponent(routeState.selectedDeviceId!)}`);
        if (!active) return;
        updateWorkspaceCache((current) => ({
          ...current,
          devices: mergeWorkspacePageItems(current.devices ?? [], [data.device]),
          deviceGrants: data.deviceGrants ?? current.deviceGrants,
          deviceAccessRules: data.deviceAccessRules ?? current.deviceAccessRules,
          deviceCommands: data.deviceCommands ?? current.deviceCommands
        }));
        setError("");
      } catch (err) {
        if (isStaleAuthContextError(err)) return;
        const message = err instanceof Error ? err.message : String(err);
        if (!active) return;
        if (message === "unauthorized") {
          finishLogout();
          return;
        }
        if (message === "device_not_found") {
          navigate(pathWithUiStyle("/topology", uiStyle), { replace: true });
          return;
        }
        setError(message);
      } finally {
        if (pendingDeviceDetailRef.current === routeState.selectedDeviceId) pendingDeviceDetailRef.current = "";
      }
    }
    void loadSelectedDevice();
    return () => {
      active = false;
    };
  }, [loggedIn, serverAccess, routeState.selectedDeviceId, workspaceCache.currentServer?.id, workspaceCache.devices, navigate, uiStyle]);

  useEffect(() => {
    const coordinator = createAgentNavigationRefreshCoordinator(refreshAgentNavigation, {
      onError: (err) => console.warn("[web] failed to refresh Agent navigation after realtime update", err)
    });
    agentNavigationRefreshCoordinatorRef.current = coordinator;
    return () => {
      coordinator.dispose();
      if (agentNavigationRefreshCoordinatorRef.current === coordinator) agentNavigationRefreshCoordinatorRef.current = null;
      if (runtimeRealtimeFrameRef.current !== null) window.cancelAnimationFrame(runtimeRealtimeFrameRef.current);
      if (executionBlockRealtimeFrameRef.current !== null) window.cancelAnimationFrame(executionBlockRealtimeFrameRef.current);
      realtimeReplayGenerationRef.current += 1;
      bootstrapRefreshAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!loggedIn || serverAccess !== "ready") return;
    let syncInterrupted = false;
    const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : "";
    const events = new EventSource(apiPath(`/api/sync?stream=1${tokenParam}`));

    events.onopen = () => {
      const recovered = syncInterrupted;
      syncInterrupted = false;
      // SSE bootstrap 不包含导航列表；连接恢复后主动校准，覆盖断线期间遗漏的 Agent 变更。
      if (recovered) agentNavigationRefreshCoordinatorRef.current?.invalidate();
    };
    events.addEventListener("workspace:bootstrap", (event) => {
      try {
        applyBootstrap(JSON.parse((event as MessageEvent<string>).data) as WorkspaceBootstrapPayload);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
    // EventSource 在后台自动重连；短暂网络抖动不打断用户，恢复后再校准导航状态。
    events.onerror = () => {
      syncInterrupted = true;
    };
    return () => {
      events.close();
    };
  }, [loggedIn, authToken, serverAccess]);

  useEffect(() => {
    if (!loggedIn || serverAccess !== "ready" || !authToken) return;
    let disposed = false;
    let retryAttempt = 0;
    let reconnectTimer: number | null = null;
    let activeSocket: WebSocket | null = null;
    let stopDeploymentPresence: (() => void) | null = null;

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      const delay = REALTIME_RECONNECT_DELAYS_MS[Math.min(retryAttempt, REALTIME_RECONNECT_DELAYS_MS.length - 1)];
      retryAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(realtimeUrl());
      activeSocket = ws;
      realtimeSocketRef.current = ws;
      ws.onmessage = (event) => {
        if (activeSocket !== ws) return;
        const text = String(event.data);
        if (text.startsWith("0")) {
          ws.send(`40${JSON.stringify({ token: authToken, serverId: workspaceCacheServerId(workspaceCache) })}`);
          return;
        }
        if (text === "2") {
          ws.send("3");
          return;
        }
        if (text.startsWith("40")) {
          // 完成鉴权才代表连接真正恢复，避免失败握手把退避次数提前清零。
          retryAttempt = 0;
          stopDeploymentPresence?.();
          stopDeploymentPresence = startDeploymentPresence(ws);
          ws.send(socketEvent("sync:resume", { lastSeq: lastRealtimeSeqRef.current }));
          const activeChannelId = realtimeChannelIdRef.current;
          if (activeChannelId) ws.send(socketEvent("join:channel", activeChannelId));
          return;
        }
        if (!text.startsWith("42")) return;
        try {
          const packet = JSON.parse(text.slice(2)) as [string, any];
          if (Array.isArray(packet) && typeof packet[0] === "string") applyRealtimeEvent(packet[0], packet[1]);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      };
      ws.onerror = () => {
        if (!disposed && ws.readyState !== WebSocket.CLOSED) ws.close();
      };
      ws.onclose = () => {
        if (activeSocket !== ws) return;
        stopDeploymentPresence?.();
        stopDeploymentPresence = null;
        activeSocket = null;
        if (realtimeSocketRef.current === ws) realtimeSocketRef.current = null;
        scheduleReconnect();
      };
    };

    connect();
    return () => {
      disposed = true;
      stopDeploymentPresence?.();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (activeSocket && realtimeSocketRef.current === activeSocket) realtimeSocketRef.current = null;
      activeSocket?.close();
      activeSocket = null;
    };
  }, [loggedIn, authToken, serverAccess, workspaceCache.currentServer?.id]);

  useEffect(() => {
    realtimeChannelIdRef.current = realtimeChannelId;
    const ws = realtimeSocketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !realtimeChannelId) return;
    ws.send(socketEvent("join:channel", realtimeChannelId));
  }, [realtimeChannelId]);

  async function authenticate(result: AuthResponse) {
    setAuthTokens(result.accessToken, result.refreshToken);
    setAuthToken(result.accessToken);
    setServerAccess("loading");
    setLoggedIn(true);
    // loggedIn/authToken effect 是登录后初始化的唯一入口，避免这里再发一轮并互相 abort。
    const params = new URLSearchParams(location.search);
    navigate(pathWithUiStyle(safeNextPath(result.returnPath ?? params.get("next")), uiStyle), { replace: true });
  }

  function finishLogout() {
    clearAuthTokens();
    setAuthToken("");
    setLoggedIn(false);
    setServerAccess("none");
    setServers([]);
    updateWorkspaceNavigationLoadState(emptyWorkspaceNavigationLoadState);
    setPageDataError(emptyWorkspacePageDataError);
    updateWorkspaceCache(emptyWorkspaceCache);
    navigate(pathWithUiStyle("/login", uiStyle), { replace: true });
  }

  async function createOwnServer(name: string) {
    const serverName = name.trim() || `${workspaceCache.currentUser.displayName || workspaceCache.currentUser.name}'s Workspace`;
    await api<ServerRecord>("/api/servers", {
      method: "POST",
      body: JSON.stringify({ name: serverName })
    });
    await refresh();
  }

  async function activateServer(serverId: string) {
    const data = await api<{ server: ServerRecord; bootstrap: WorkspaceBootstrapPayload }>(`/api/servers/${serverId}/activate`, {
      method: "POST",
      body: "{}"
    });
    applyBootstrap(data.bootstrap);
    await refresh();
    setError("");
  }

  if (location.pathname.startsWith("/onboard/")) {
    const code = decodeURIComponent(location.pathname.replace(/^\/onboard\//, "").split("/")[0] ?? "");
    return <OnboardingPage code={code} />;
  }
  if (location.pathname.startsWith("/signup/confirm/")) {
    const token = decodeURIComponent(location.pathname.replace(/^\/signup\/confirm\//, "").split("/")[0] ?? "");
    return <SignupConfirmPage token={token} onAuthenticated={authenticate} />;
  }
  if (location.pathname.startsWith("/recover/confirm/")) {
    const token = decodeURIComponent(location.pathname.replace(/^\/recover\/confirm\//, "").split("/")[0] ?? "");
    return <PasswordRecoveryConfirmPage token={token} onAuthenticated={authenticate} />;
  }
  // Global Operator 使用独立 HttpOnly session，不读取或覆盖普通 Owner 的浏览器 token。
  if (location.pathname === "/operator" || location.pathname.startsWith("/operator/")) {
    return <Suspense fallback={<div className="auth-page"><p className="auth-loading-copy">Loading Operator View.</p></div>}><OperatorApp /></Suspense>;
  }

  if (!loggedIn) {
    if (location.pathname !== "/login") return <Navigate to={loginRedirectPath(location)} replace />;
    return <Login onAuthenticated={authenticate} error={error} />;
  }
  // Token updates can render this guard before authenticate's navigation commits.
  // Both paths must preserve the same destination, including Bridge invitation links.
  if (location.pathname === "/login") return <Navigate to={pathWithUiStyle(safeNextPath(new URLSearchParams(location.search).get("next")), uiStyle)} replace />;
  if (serverAccess === "loading") return <LoadingWorkspace error={error} onRetry={refresh} onLogout={finishLogout} />;
  if (serverAccess === "none") return <NoServerAccess user={workspaceCache.currentUser} error={error} onRefresh={refresh} onLogout={finishLogout} onCreateServer={createOwnServer} />;

  if (location.pathname.startsWith("/bridge/connect/")) {
    const code = decodeURIComponent(location.pathname.replace(/^\/bridge\/connect\//, "").split("/")[0] ?? "");
    return <BridgeConnectionPage code={code} servers={servers} onOpenWorkspace={async (workspaceId) => {
      // 先激活邀请中选定的 Workspace，避免多 Workspace 账号进入旧的首页快照。
      if (workspaceId) await activateServer(workspaceId);
      else await refresh();
      navigate(pathWithUiStyle("/topology", uiStyle), { replace: true });
    }} />;
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to={pathWithUiStyle("/topology", uiStyle)} replace />} />
      <Route
        path="*"
        element={<WorkspaceShell snapshot={workspaceCache} servers={servers} error={error} workspaceSummary={workspaceSummary} workspaceNavigationLoadState={workspaceNavigationLoadState} pageDataLoaded={pageDataLoaded} pageDataError={pageDataError} pageDataLoading={pageDataLoading} devicePageInfo={devicePageInfo} onRefresh={refreshWorkspaceAndRouteData} onLoadMoreDevices={loadMoreRouteDevices} onActivateServer={activateServer} onLoggedOut={finishLogout} />}
      />
    </Routes>
  );
}


function AuthPage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={className ? `auth-page ${className}` : "auth-page"}>
      {children}
    </div>
  );
}

function Login({ onAuthenticated, error }: { onAuthenticated: (result: AuthResponse) => Promise<void>; error: string }) {
  const [mode, setMode] = useState<"login" | "register" | "server">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [serverName, setServerName] = useState("");
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setLocalError("");
    try {
      const result = await api<AuthResponse>(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        body: JSON.stringify(mode === "login" ? loginBody(email, password) : registerBody(name, email, password, serverName))
      });
      await onAuthenticated(result);
    } catch (err) {
      if (isStaleAuthContextError(err)) return;
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPage>
      <>
        <form className="auth-card auth-login-card" onSubmit={(event) => {
          event.preventDefault();
          if (mode === "register") {
            setLocalError("");
            const displayName = name.trim();
            setServerName((current) => current.trim() || (displayName ? `${displayName}'s Workspace` : "My Workspace"));
            setMode("server");
            return;
          }
          void submit();
        }}>
          <div className="auth-split">
            <section className="auth-visual-panel">
              <div className="auth-brand-row">
                <div className="auth-logo"><TyrLogo color="white" /></div>
                <span className="auth-version">V1.4</span>
              </div>
              <div className="auth-visual-copy">
                <p className="auth-visual-eyebrow"><RefreshCw size={14} /> Trust infrastructure for the agent economy</p>
                <h1>Every agent action, verified, bounded, and audited.</h1>
                <p className="auth-visual-subhead">Tyr governs how agents and people collaborate, so autonomous work stays safe enough to deploy.</p>
              </div>
              <div className="auth-status-card" aria-hidden="true">
                <div className="auth-status-head">
                  <span><Server size={14} /> SYS_STATUS</span>
                </div>
                <div className="auth-status-row">
                  <span><Server size={14} /> MacBook Pro Node</span>
                  <b><i /> Connected</b>
                </div>
                <div className="auth-status-row">
                  <span><Server size={14} /> Work Linux Node</span>
                  <b><i /> Connected</b>
                </div>
                <div className="auth-status-row muted">
                  <span><Mail size={14} /> TYR DM</span>
                  <b>Ready</b>
                </div>
              </div>
              <div className="auth-port-line">TYR SYSTEMS</div>
            </section>
            <section className="auth-form-panel">
              {mode !== "server" && (
                <>
                  <h1>{mode === "login" ? "Sign In" : "Register"}</h1>
                  <p className="auth-copy">{mode === "login" ? "Sign in to your Tyr workspace." : "Create your account first, then name your personal workspace."}</p>
                  {mode === "register" && (
                    <>
                      <label className="field-label">Username</label>
                      <div className="auth-icon-field">
                        <UserRound size={16} />
                        <input className="input auth-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Young" autoComplete="name" />
                      </div>
                    </>
                  )}
                  <label className="field-label">Email Address</label>
                  <div className="auth-icon-field">
                    <Mail size={16} />
                    <input className="input auth-input" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" type="email" />
                  </div>
                  <label className="field-label">Password</label>
                  <div className="auth-icon-field">
                    <KeyRound size={16} />
                    <input className="input auth-input" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "register" ? "Min 8 characters" : ""} />
                  </div>
                </>
              )}
              {mode === "server" && (
                <>
                  <span className="auth-step-pill"><Building2 size={14} /> Workspace Onboarding</span>
                  <h1>Name Your Workspace</h1>
                  <p className="auth-copy">This personal workspace groups your Devices, Agents, DM conversations, and daemon connections. If this email has a pending invite, TYR will still switch you into that invited workspace after registration.</p>
                  <label className="field-label">Workspace name</label>
                  <div className="auth-icon-field">
                    <Building2 size={16} />
                    <input className="input auth-input" value={serverName} onChange={(event) => setServerName(event.target.value)} autoComplete="organization" />
                  </div>
                </>
              )}
              <button className="btn primary auth-submit" disabled={busy || (mode === "register" && (!name.trim() || !email.trim() || !password)) || (mode === "server" && !serverName.trim())}>
                {mode === "login" ? <>Sign in <ArrowRight size={16} /></> : mode === "register" ? <>Continue to Workspace <ChevronRight size={16} /></> : "Create Workspace & Launch Panel"}
              </button>
              {mode === "server" && <button className="btn auth-secondary" type="button" disabled={busy} onClick={() => setMode("register")}>Back to account</button>}
              {(localError || error) && <div className="login-error">{localError || error}</div>}
              <p className="auth-switch">
                {mode === "login" ? "Need an account?" : "Already have an account?"}
                <button type="button" onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  setLocalError("");
                }}>{mode === "login" ? "Register" : "Sign in"}</button>
              </p>
            </section>
          </div>
        </form>
        {mode !== "server" && <HelpdeskSignupAgentPanel />}
      </>
    </AuthPage>
  );
}

function LoadingWorkspace({ error, onRetry, onLogout }: { error: string; onRetry: () => Promise<void>; onLogout: () => void }) {
  const [retrying, setRetrying] = useState(false);
  async function retry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }
  return (
    <AuthPage className="auth-loading-page">
      <section className="auth-loading-card" aria-live="polite" aria-busy={!error}>
        <div className="auth-loading-head">
          <TyrLogo adaptive className="auth-loading-logo" />
          <div>
            <h1>Loading workspace</h1>
          </div>
        </div>
        <div className="auth-loading-line" />
        <p className="auth-loading-copy">Checking account access.</p>
        {error && <div className="login-error">{error}</div>}
        {error && (
          <div className="no-server-actions">
            <button className="btn" disabled={retrying} onClick={() => void retry()}><RefreshCw size={16} /> Retry</button>
            <button className="btn orange" disabled={retrying} onClick={onLogout}><LogOut size={16} /> Log out</button>
          </div>
        )}
      </section>
    </AuthPage>
  );
}

function NoServerAccess({ user, error, onRefresh, onLogout, onCreateServer }: {
  user: UserRecord;
  error: string;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
  onCreateServer: (name: string) => Promise<void>;
}) {
  const [serverName, setServerName] = useState(`${user.displayName || user.name}'s Workspace`);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  async function submit() {
    setBusy(true);
    setLocalError("");
    try {
      await onCreateServer(serverName);
    } catch (err) {
      if (isStaleAuthContextError(err)) return;
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthPage>
      <section className="auth-card no-server-card">
        <div className="auth-logo"><TyrLogo /></div>
        <p className="auth-tagline">WHERE HUMANS AND AI AGENTS COLLABORATE</p>
        <h1>No workspace access</h1>
        <div className="no-server-user">
          <span className="avatar human large"><UserRound size={22} /></span>
          <span>
            <b>{user.displayName || user.name}</b>
            <small>{user.email ?? user.name}</small>
          </span>
        </div>
        <p className="no-server-copy">
          This account does not currently belong to a workspace. Ask a workspace Owner to invite this email, or create a separate workspace.
        </p>
        <div className="no-server-create">
          <label className="field-label">Workspace name</label>
          <input className="input auth-input" value={serverName} onChange={(event) => setServerName(event.target.value)} />
          <button className="btn primary auth-submit" disabled={busy} onClick={() => void submit()}>
            <Plus size={16} /> Create Workspace
          </button>
        </div>
        {(localError || error) && <div className="login-error">{localError || error}</div>}
        <div className="no-server-actions">
          <button className="btn" onClick={() => void onRefresh()}><RefreshCw size={16} /> Refresh</button>
          <button className="btn orange" onClick={onLogout}><LogOut size={16} /> Log out</button>
        </div>
      </section>
    </AuthPage>
  );
}
