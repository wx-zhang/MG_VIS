import { WorkspaceBridgeRail } from "./WorkspaceBridgeRail";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  Building2,
  CircleDot,
  Focus,
  Maximize,
  Maximize2,
  Minimize2,
  Minus,
  Network,
  Plus,
  RotateCcw,
  Route,
  Search
} from "lucide-react";
import type { AppSnapshot, TopologyLiveWorkPayload, WorkspaceBridgeRecord } from "@tyr-ai/contracts";
import { TopBar, type WorkspaceTopBarProps } from "../shared/ui";
import { buildWorkspaceSpatialScene } from "../workspaceSpatial";
import { workspaceSpatialFeaturedChain } from "../workspaceSpatialChoreography";
import {
  topologyGraphForSnapshot,
  topologyOperationalSnapshot,
  type ChannelMemberIndex,
  type TopologyGraphNode
} from "../topology";
import { topologyGraphWithLiveWork } from "../topologyLiveWork";
import {
  WORKSPACE_SPATIAL_REHEARSAL_CUES,
  workspaceSpatialDirectedSnapshot,
  workspaceSpatialDirectedLiveWork,
  workspaceSpatialNextRehearsalPlan,
  workspaceSpatialRehearsalAmbientAssignments,
  workspaceSpatialRehearsalPhaseLabel,
  workspaceSpatialRehearsalPlan,
  type WorkspaceSpatialRehearsalCue,
  type WorkspaceSpatialRehearsalPlan
} from "../workspaceSpatialMotionDirector";
import { workspaceSpatialNavigationItems, workspaceSpatialSelectionKey } from "../workspaceSpatialInteraction";
import {
  workspaceSpatialLiveOperations,
  type WorkspaceSpatialLiveOperationTarget
} from "../workspaceSpatialLiveOperations";
import { TopologyInspector } from "./TopologyInspector";
import type { TopologyOperatorContext } from "./TopologyInspectorDetails";
import type { WorkspaceSpatialSceneHandle, WorkspaceSpatialSelection } from "./WorkspaceSpatialScene";

type WorkspaceSpatialSceneModule = typeof import("./WorkspaceSpatialScene");
let workspaceSpatialScenePromise: Promise<WorkspaceSpatialSceneModule> | undefined;

function loadWorkspaceSpatialScene(): Promise<WorkspaceSpatialSceneModule> {
  if (!workspaceSpatialScenePromise) {
    // 页面壳与 Three Canvas 分开解析；预取失败时不把已拒绝 Promise 留给尚未开始的真实导航。
    workspaceSpatialScenePromise = import("./WorkspaceSpatialScene").catch((error) => {
      workspaceSpatialScenePromise = undefined;
      throw error;
    });
  }
  return workspaceSpatialScenePromise;
}

export function preloadWorkspaceSpatialScene(): Promise<WorkspaceSpatialSceneModule> {
  return loadWorkspaceSpatialScene();
}

const WorkspaceSpatialSceneCanvas = lazy(() => loadWorkspaceSpatialScene().then((module) => ({
  default: module.WorkspaceSpatialSceneCanvas
})));

type WorkspaceSpatialCameraMode = "overview" | "free" | "selection" | "chain" | "rehearsal";

type WorkspaceSpatialViewProps = {
  snapshot: AppSnapshot;
  liveWork: TopologyLiveWorkPayload;
  topbarProps: WorkspaceTopBarProps;
  channelMemberIndex: ChannelMemberIndex;
  onOpenTopology: () => void;
  onRefresh: () => Promise<void>;
  onCreateAgent: (machineId?: string) => void;
  onConnectComputer: () => void;
  onOpenAgentDm: (agentId: string) => Promise<void>;
  onOpenWorkspaceBridge: (bridge: WorkspaceBridgeRecord) => void;
  onOpenDmChannel: (channelId: string) => void;
  onOpenLiveExecution: (executionId: string) => void;
  topbarTitle?: ReactNode;
  contextBar?: ReactNode;
  workspaceViewOnly?: boolean;
  frontendReadOnly?: boolean;
  operatorContext?: TopologyOperatorContext;
};

function topologyNodeForSpatialSelection(
  selection: WorkspaceSpatialSelection | null,
  graphNodes: TopologyGraphNode[],
  serverNodeId: string,
  currentWorkspaceId: string
): TopologyGraphNode | undefined {
  if (!selection) return undefined;
  if (selection.kind === "bridge") {
    return graphNodes.find((node) => node.kind === "workspace-bridge" && node.bridge?.bridgeId === selection.id);
  }
  if (selection.kind === "workspace") {
    return graphNodes.find((node) => node.id === `peer-workspace:${selection.workspaceId}`)
      ?? graphNodes.find((node) => node.id === serverNodeId);
  }
  if (selection.kind === "flow") return undefined;
  const rowKind = selection.kind === "room" ? undefined : "agent";
  const workspacePanelId = selection.workspaceId === currentWorkspaceId
    ? "workspace-panel:local"
    : `workspace-panel:${selection.workspaceId}`;
  return graphNodes.find((node) => {
    if (!node.row || node.row.id !== selection.id) return false;
    // 相同 runtime id 可能出现在不同 Bridge Workspace；Inspector 必须沿不可变 Workspace 边界解析。
    if (node.workspacePanelId !== workspacePanelId) return false;
    return rowKind ? node.row.kind === rowKind : node.row.kind === "machine" || node.row.kind === "device";
  });
}

export function WorkspaceSpatialView({
  snapshot,
  liveWork,
  topbarProps,
  channelMemberIndex,
  onOpenTopology,
  onRefresh,
  onCreateAgent,
  onConnectComputer,
  onOpenAgentDm,
  onOpenWorkspaceBridge,
  onOpenDmChannel,
  onOpenLiveExecution,
  topbarTitle,
  contextBar,
  workspaceViewOnly = false,
  operatorContext,
  frontendReadOnly = false
}: WorkspaceSpatialViewProps) {
  const rehearsalEnabled = import.meta.env.DEV;
  const [rehearsal, setRehearsal] = useState<WorkspaceSpatialRehearsalPlan | null>(null);
  const directedLiveWork = useMemo(
    () => workspaceSpatialDirectedLiveWork(liveWork, rehearsalEnabled ? rehearsal : null),
    [liveWork, rehearsal, rehearsalEnabled]
  );
  const directedSnapshot = useMemo(
    () => workspaceSpatialDirectedSnapshot(snapshot, rehearsalEnabled ? rehearsal : null),
    [rehearsal, rehearsalEnabled, snapshot]
  );
  const authoritativeScene = useMemo(() => buildWorkspaceSpatialScene(snapshot, liveWork), [
    liveWork,
    snapshot.agents,
    snapshot.communicationAgentProgress,
    snapshot.crossWorkspaceMessages,
    snapshot.currentServer,
    snapshot.currentUser,
    snapshot.deviceGrants,
    snapshot.devices,
    snapshot.incomingWorkspaceBridges,
    snapshot.machines,
    snapshot.channels,
    snapshot.messages,
    snapshot.peerWorkspaceTopologies,
    snapshot.workspaceBridges
  ]);
  const fullScene = useMemo(
    () => rehearsalEnabled && rehearsal
      ? buildWorkspaceSpatialScene(directedSnapshot, { ...directedLiveWork, visitFlows: directedLiveWork.flows })
      : authoritativeScene,
    [authoritativeScene, directedLiveWork, directedSnapshot, rehearsal, rehearsalEnabled]
  );
  const [detailView, setDetailView] = useState<"workspace" | "connections">(frontendReadOnly ? "workspace" : "connections");
  const buildingView = Boolean(operatorContext) && detailView === "workspace";
  const scene = useMemo(() => buildingView ? {
    ...fullScene, peers: [], bridges: [], hiddenPeerCount: 0,
    totals: { workspaces: 1, devices: fullScene.current.deviceCount, agents: fullScene.current.agentCount, activeBridges: fullScene.totals.activeBridges }
  } : fullScene, [fullScene, buildingView]);
  const [liveOperationsNowMs, setLiveOperationsNowMs] = useState(() => Date.now());
  const liveOperations = useMemo(
    () => workspaceSpatialLiveOperations(authoritativeScene, liveWork, liveOperationsNowMs),
    [authoritativeScene, liveOperationsNowMs, liveWork]
  );
  useEffect(() => {
    if (liveOperations.nextRecentExpiryAt === null) return;
    const delayMs = Math.max(0, liveOperations.nextRecentExpiryAt - Date.now()) + 25;
    // Recent 结果拥有独立短窗口；到期后仅刷新状态栏，不影响人物回程动画。
    const timer = window.setTimeout(() => setLiveOperationsNowMs(Date.now()), delayMs);
    return () => window.clearTimeout(timer);
  }, [liveOperations.nextRecentExpiryAt]);
  const graph = useMemo(
    () => topologyGraphWithLiveWork(topologyGraphForSnapshot(snapshot, channelMemberIndex), liveWork),
    [channelMemberIndex, liveWork, snapshot]
  );
  const operationalSnapshot = useMemo(() => topologyOperationalSnapshot(snapshot), [snapshot]);
  const featuredChain = useMemo(() => workspaceSpatialFeaturedChain(scene), [scene]);
  const sceneTargets = useMemo(() => workspaceSpatialNavigationItems(fullScene), [fullScene]);
  const rehearsalAvailability = useMemo(() => new Map(
    WORKSPACE_SPATIAL_REHEARSAL_CUES.map((cue) => [cue.id, Boolean(workspaceSpatialRehearsalPlan(snapshot, cue.id, 0))])
  ), [snapshot]);
  const rehearsalTargetLabel = rehearsal?.bridgeTarget?.peerWorkspaceName
    ?? rehearsal?.targets.map((target) => rehearsal.cue === "cross_room_result_relay"
      ? `${target.agentName} @ ${target.machineName}`
      : target.agentName).join(", ");
  const rehearsalAmbientAssignments = useMemo(
    () => rehearsalEnabled ? workspaceSpatialRehearsalAmbientAssignments(scene, rehearsal) : undefined,
    [rehearsal, rehearsalEnabled, scene]
  );
  const [selection, setSelection] = useState<WorkspaceSpatialSelection | null>(null);
  const [cameraMode, setCameraMode] = useState<WorkspaceSpatialCameraMode>("overview");
  const [targetSearchOpen, setTargetSearchOpen] = useState(false);
  const [targetSearchQuery, setTargetSearchQuery] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenSupported] = useState(() => typeof document !== "undefined" && document.fullscreenEnabled);
  const shellRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<WorkspaceSpatialSceneHandle>(null);
  const openLiveExecutionRef = useRef(onOpenLiveExecution);
  const targetSearchRef = useRef<HTMLDivElement>(null);
  const targetSearchInputRef = useRef<HTMLInputElement>(null);
  openLiveExecutionRef.current = onOpenLiveExecution;
  const inspectedNode = topologyNodeForSpatialSelection(selection, graph.nodes, graph.serverNodeId, scene.current.id);
  const selectedTargetKey = workspaceSpatialSelectionKey(selection);
  const selectedTarget = sceneTargets.find((target) => target.key === selectedTargetKey);
  const normalizedTargetSearchQuery = targetSearchQuery.trim().toLocaleLowerCase();
  // 高密度场景只在用户输入后返回有限结果，避免按需搜索再次退化成长列表。
  const matchingSceneTargets = normalizedTargetSearchQuery
    ? sceneTargets.filter((target) => `${target.group} ${target.label} ${target.searchText ?? ""}`.toLocaleLowerCase().includes(normalizedTargetSearchQuery))
    : [];
  const visibleTargetMatches = matchingSceneTargets.slice(0, 12);
  const cameraStatus = cameraMode === "selection"
    ? `Selection focus${selectedTarget ? ` · ${selectedTarget.label}` : ""}`
    : cameraMode === "chain"
      ? "Collaboration chain focus"
      : cameraMode === "overview"
        ? "Overview"
        : cameraMode === "rehearsal"
          ? `Rehearsal focus${rehearsal ? ` · ${rehearsal.label}` : ""}`
          : "Free camera";

  function clearSelection() {
    setSelection(null);
    // 关闭 Inspector 只解除 Selection focus；Fit / chain 的相机语义不应被误报为手动相机。
    setCameraMode((current) => current === "selection" ? "free" : current);
  }

  const handleSceneSelection = useCallback((nextSelection: WorkspaceSpatialSelection | null) => {
    // Selection 只更新检查对象；相机仍由显式 Focus / Focus chain / Fit 控件驱动。
    setCameraMode("free");
    if (nextSelection?.kind === "flow") {
      setSelection(null);
      openLiveExecutionRef.current(nextSelection.executionId);
      return;
    }
    // Agent（包括 TYR）先进入统一 Inspector；聊天只能通过明确的 Message action 打开。
    setSelection(nextSelection);
  }, []);

  const handleSceneInteract = useCallback(() => setCameraMode("free"), []);

  function fitScene() {
    sceneRef.current?.fit();
    setCameraMode("overview");
  }

  const pendingConnectionFocus = useRef(false);
  useEffect(() => {
    if (buildingView || !pendingConnectionFocus.current) return;
    const frame = requestAnimationFrame(() => {
      pendingConnectionFocus.current = false;
      sceneRef.current?.focus();
      setCameraMode("selection");
    });
    return () => cancelAnimationFrame(frame);
  }, [buildingView]);

  function focusSelection() {
    if (!selection) return;
    const connectionTarget = selection.kind === "bridge" || ("workspaceId" in selection && selection.workspaceId !== scene.current.id);
    if (buildingView && connectionTarget) {
      pendingConnectionFocus.current = true;
      setDetailView("connections");
      return;
    }
    sceneRef.current?.focus();
    setCameraMode("selection");
  }

  function focusFeaturedChain() {
    if (!featuredChain) return;
    sceneRef.current?.focusChain(featuredChain.chainId);
    setCameraMode("chain");
  }

  function openLiveOperation(target: WorkspaceSpatialLiveOperationTarget) {
    if (target.kind === "agent") {
      handleSceneSelection({ kind: "agent", workspaceId: target.workspaceId, id: target.agentId });
      return;
    }
    if (target.kind === "execution") {
      onOpenLiveExecution(target.executionId);
      return;
    }
    const bridge = authoritativeScene.bridges.find((item) => item.id === target.bridgeId);
    if (bridge) onOpenWorkspaceBridge(bridge.record);
  }

  function startRehearsal(cue: WorkspaceSpatialRehearsalCue) {
    if (!rehearsalEnabled) return;
    const next = workspaceSpatialRehearsalPlan(snapshot, cue, Date.now());
    if (!next) return;
    setRehearsal(next);
    setSelection(null);
    setCameraMode(cue === "office_life" ? "overview" : "rehearsal");
    // 点击 cue 本身就是显式的导演动作；群体动作 Fit，单目标动作自动构图但不打开 Inspector。
    window.requestAnimationFrame(() => {
      if (cue === "office_life") sceneRef.current?.fit();
      else if (cue === "bridge_relay" && next.bridgeTarget) {
        sceneRef.current?.focusBridgeMessage(next.bridgeTarget.bridgeId);
      }
      else if (cue === "cross_room_result_relay") {
        sceneRef.current?.focusChain(`${next.id}:parent`);
      }
      else if (cue === "pair_handoff" || cue === "parallel_dispatch" || cue === "result_convergence" || cue === "direct_result_receipt") {
        sceneRef.current?.focusTarget({
          kind: "room",
          workspaceId: next.targets[0].workspaceId,
          id: next.targets[0].machineId
        });
      }
      else sceneRef.current?.focusTarget({
        kind: "agent",
        workspaceId: next.targets[0].workspaceId,
        id: next.targets[0].agentId
      });
    });
  }

  function stopRehearsal() {
    setRehearsal(null);
    setCameraMode((current) => current === "rehearsal" ? "free" : current);
  }

  async function toggleWorkspaceFullscreen() {
    const shell = shellRef.current;
    if (!shell || !fullscreenSupported) return;
    if (document.fullscreenElement === shell) {
      await document.exitFullscreen();
      return;
    }
    if (document.fullscreenElement) await document.exitFullscreen();
    await shell.requestFullscreen();
  }

  function handleSceneKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    // 控件保留浏览器原生键盘语义；快捷键只响应场景容器或 Canvas 自身。
    if (target?.closest("button, input, select, textarea, [contenteditable='true']")) return;
    const key = event.key.toLowerCase();
    if (key === "0") fitScene();
    else if (key === "f" && selection) focusSelection();
    else if (key === "c" && featuredChain) focusFeaturedChain();
    else if (key === "r") sceneRef.current?.resetAngle();
    else if (key === "+" || key === "=") sceneRef.current?.zoomIn();
    else if (key === "-") sceneRef.current?.zoomOut();
    else return;
    event.preventDefault();
  }

  useEffect(() => {
    function syncFullscreenState() {
      const active = document.fullscreenElement === shellRef.current;
      setIsFullscreen(active);
      // Fullscreen 会改变 Canvas 尺寸；等待浏览器完成两次布局后再重新适配整个场景。
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        sceneRef.current?.fit();
        setCameraMode("overview");
      }));
    }
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    if (!targetSearchOpen) return;
    const frame = window.requestAnimationFrame(() => targetSearchInputRef.current?.focus());
    function closeTargetSearch(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || targetSearchRef.current?.contains(target)) return;
      setTargetSearchOpen(false);
      setTargetSearchQuery("");
    }
    document.addEventListener("pointerdown", closeTargetSearch);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeTargetSearch);
    };
  }, [targetSearchOpen]);

  useEffect(() => {
    if (!inspectedNode) return;
    function closeInspector(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // 表单字段内部的 Esc 先保留给配置面板自己处理，避免误关整个抽屉。
      if (target?.matches("input, textarea, select") || target?.isContentEditable) return;
      clearSelection();
    }
    document.addEventListener("keydown", closeInspector);
    return () => document.removeEventListener("keydown", closeInspector);
  }, [inspectedNode]);

  useEffect(() => {
    if (!selection || selection.kind === "flow") return;
    if (sceneTargets.some((target) => target.key === workspaceSpatialSelectionKey(selection))) return;
    // realtime roster 变化后，已经不可见的对象不能继续留在 Inspector 或相机状态中。
    setSelection(null);
    setCameraMode("overview");
  }, [sceneTargets, selection]);

  useEffect(() => {
    if (!rehearsalEnabled || !rehearsal) return;
    const timer = window.setTimeout(() => {
      const next = workspaceSpatialNextRehearsalPlan(rehearsal, Math.max(Date.now(), rehearsal.endsAtMs));
      setRehearsal((current) => current?.id === rehearsal.id ? next : current);
      if (!next) setCameraMode((current) => current === "rehearsal" ? "free" : current);
    }, Math.max(0, rehearsal.endsAtMs - Date.now()) + 25);
    return () => window.clearTimeout(timer);
  }, [rehearsal, rehearsalEnabled]);

  return (
    <div className={`view workspace-spatial-view${operatorContext ? " operator-workspace-detail" : ""}`}>
      <TopBar title={topbarTitle ?? "Workspace View"} {...topbarProps} />
      {contextBar}
      <div ref={shellRef} className={`topology-routing-shell workspace-spatial-shell${inspectedNode ? " topology-inspector-open" : ""}`}>
        <div className="workspace-spatial-main">
          <header className="workspace-spatial-heading">
            <div>
              <div className="workspace-spatial-eyebrow"><CircleDot size={12} /> {frontendReadOnly ? "Frontend spatial demo" : "Live spatial model"}</div>
              <h1>{operatorContext ? scene.current.name : "Workspace View"}</h1>
              <p>{frontendReadOnly ? "Explore this Workspace's TYR, subagents and Bridge connections." : operatorContext ? "Devices, Agents and live work inside this Workspace." : "Devices become rooms, Agents become occupants, and direct Workspace Bridges become glass corridors."}</p>
            </div>
            {operatorContext && <div className="workspace-view-switch" role="group" aria-label="Workspace detail view">
              <button type="button" className={buildingView ? "active" : ""} aria-pressed={buildingView} onClick={() => { setDetailView("workspace"); clearSelection(); }}><Building2 size={14} />Workspace</button>
              <button type="button" className={!buildingView ? "active" : ""} aria-pressed={!buildingView} onClick={() => { setDetailView("connections"); clearSelection(); }}><Network size={14} />Connections ({authoritativeScene.bridges.length})</button>
            </div>}
            {!workspaceViewOnly && <div className="workspace-view-switch" role="group" aria-label="Workspace visualization">
              <button type="button" onClick={onOpenTopology}><Network size={14} /> Topology</button>
              <button type="button" className="active" aria-pressed="true"><Building2 size={14} /> Workspace View</button>
            </div>}
          </header>

          {operatorContext && <WorkspaceBridgeRail scene={authoritativeScene} selectedId={selection?.kind === "bridge" ? selection.id : null} onInspect={(id) => handleSceneSelection({ kind: "bridge", id })} onConnections={() => { setDetailView("connections"); clearSelection(); }} />}
          <section
            className={`workspace-spatial-stage${rehearsalEnabled ? " has-motion-rehearsal" : ""}`}
            aria-label="Three-dimensional Workspace scene"
            aria-describedby="workspace-spatial-keyboard-instructions"
            tabIndex={0}
            onKeyDown={handleSceneKeyDown}
          >
            <Suspense fallback={<div className="workspace-spatial-lazy-loading" role="status">Preparing 3D scene…</div>}>
              <WorkspaceSpatialSceneCanvas
                ref={sceneRef}
                scene={scene}
                presentation={buildingView ? "building" : operatorContext ? "connections" : "campus"}
                selection={selection}
                focusedRoomKey={cameraMode === "selection" && selection?.kind === "room"
                  ? workspaceSpatialSelectionKey(selection)
                  : null}
                ambientAssignmentsOverride={rehearsal?.cue === "office_life" ? rehearsalAmbientAssignments ?? [] : undefined}
                onSelect={handleSceneSelection}
                onInteract={handleSceneInteract}
              />
            </Suspense>

            <div className="workspace-spatial-summary" aria-label="Workspace scene summary">
              <span className="summary-title"><Building2 size={14} /> Spatial overview</span>
              <span><b>{scene.totals.workspaces}</b><small>{scene.totals.workspaces === 1 ? "Workspace" : "Workspaces"}</small></span>
              <span><b>{scene.totals.devices}</b><small>{scene.totals.devices === 1 ? "Device" : "Devices"}</small></span>
              <span><b>{scene.totals.agents}</b><small>{scene.totals.agents === 1 ? "Agent" : "Agents"}</small></span>
              <span><b>{scene.totals.activeBridges}</b><small>{scene.totals.activeBridges === 1 ? "Bridge" : "Bridges"}</small></span>
              <div className={`workspace-spatial-live-operations${liveOperations.liveCount > 0 ? " active" : liveOperations.recentCount > 0 ? " recent" : " idle"}`} aria-label="Live operations">
                <div className="live-operations-heading">
                  <span><Activity size={11} /> Live operations</span>
                  <b role="status" aria-live="polite">
                    {liveOperations.liveCount}{liveOperations.truncated ? "+" : ""} live
                    {liveOperations.recentCount > 0 ? ` · ${liveOperations.recentCount} recent` : ""}
                  </b>
                </div>
                {liveOperations.items.length > 0 ? (
                  <div className="live-operations-list">
                    {liveOperations.items.map((operation) => (
                      <button
                        key={operation.id}
                        type="button"
                        className={`tone-${operation.tone}${operation.continuous ? " is-live" : " is-recent"}`}
                        title={`Open ${operation.label.toLowerCase()}`}
                        aria-label={`${operation.label}, ${operation.actorLabel}, ${operation.scopeLabel}`}
                        onClick={() => openLiveOperation(operation.target)}
                      >
                        <i aria-hidden="true" />
                        <span>
                          <strong>{operation.label}</strong>
                          <small>{operation.actorLabel} · {operation.scopeLabel}</small>
                        </span>
                        <ArrowUpRight size={11} aria-hidden="true" />
                      </button>
                    ))}
                    {liveOperations.hiddenCount > 0 && (
                      <small className="live-operations-overflow">+{liveOperations.hiddenCount} more operations</small>
                    )}
                  </div>
                ) : (
                  <div className="live-operations-idle">
                    <i aria-hidden="true" />
                    <span><strong>Operational idle</strong><small>No live Runtime or Bridge work</small></span>
                  </div>
                )}
              </div>
            </div>

            <div className="workspace-spatial-controls" aria-label="Scene controls">
              <div ref={targetSearchRef} className="workspace-spatial-target-search">
                <button
                  type="button"
                  className="workspace-spatial-target-search-trigger"
                  aria-label="Search scene targets"
                  aria-haspopup="dialog"
                  aria-expanded={targetSearchOpen}
                  aria-controls="workspace-spatial-target-search-panel"
                  title="Search scene targets"
                  onClick={() => {
                    setTargetSearchOpen((current) => !current);
                    if (targetSearchOpen) setTargetSearchQuery("");
                  }}
                ><Search size={14} /><span className="workspace-spatial-control-label">Search targets</span></button>
                {targetSearchOpen && (
                  <div id="workspace-spatial-target-search-panel" className="workspace-spatial-target-search-panel" role="dialog" aria-label="Search scene targets">
                    <div className="workspace-spatial-target-search-field">
                      <Search size={13} aria-hidden="true" />
                      <input
                        ref={targetSearchInputRef}
                        type="search"
                        value={targetSearchQuery}
                        aria-label="Find a Workspace, Device, Agent, or Bridge"
                        placeholder="Find a target..."
                        onChange={(event) => setTargetSearchQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") return;
                          event.stopPropagation();
                          setTargetSearchOpen(false);
                          setTargetSearchQuery("");
                        }}
                      />
                    </div>
                    <div className="workspace-spatial-target-search-results" role="listbox" aria-label="Matching scene targets">
                      {!normalizedTargetSearchQuery && <p>Type to find a scene target.</p>}
                      {normalizedTargetSearchQuery && visibleTargetMatches.length === 0 && <p>No matching targets.</p>}
                      {visibleTargetMatches.map((target) => (
                        <button
                          key={target.key}
                          type="button"
                          className="workspace-spatial-target-result"
                          role="option"
                          aria-selected={target.key === selectedTargetKey}
                          onClick={() => {
                            handleSceneSelection(target.selection);
                            setTargetSearchOpen(false);
                            setTargetSearchQuery("");
                          }}
                        >
                          <span>{target.label}</span>
                          <small>{target.group}</small>
                        </button>
                      ))}
                      {matchingSceneTargets.length > visibleTargetMatches.length && (
                        <p>Refine your search to see {matchingSceneTargets.length - visibleTargetMatches.length} more.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <button type="button" title="Zoom out (-)" aria-label="Zoom out" onClick={() => sceneRef.current?.zoomOut()}><Minus size={15} /></button>
              <button type="button" title="Zoom in (+)" aria-label="Zoom in" onClick={() => sceneRef.current?.zoomIn()}><Plus size={15} /></button>
              <button
                type="button"
                aria-label="Fit scene"
                aria-pressed={cameraMode === "overview"}
                aria-keyshortcuts="0"
                title="Fit scene (0)"
                onClick={fitScene}
              ><Maximize2 size={14} /><span className="workspace-spatial-control-label">Fit</span></button>
              <button
                type="button"
                disabled={!selection}
                aria-label="Focus selection"
                aria-pressed={cameraMode === "selection"}
                aria-keyshortcuts="F"
                title={selection ? "Focus selection" : "Select a Device, Agent, or Bridge first"}
                onClick={focusSelection}
              ><Focus size={14} /><span className="workspace-spatial-control-label">Focus</span></button>
              <button
                type="button"
                disabled={!featuredChain}
                aria-label="Focus active collaboration chain"
                aria-pressed={cameraMode === "chain"}
                aria-keyshortcuts="C"
                title={featuredChain ? "Focus active collaboration chain" : "No active collaboration chain"}
                onClick={focusFeaturedChain}
              ><Route size={14} /><span className="workspace-spatial-control-label">Focus chain</span></button>
              <button
                type="button"
                aria-label="Reset angle"
                aria-keyshortcuts="R"
                title="Reset angle (R)"
                onClick={() => sceneRef.current?.resetAngle()}
              ><RotateCcw size={14} /><span className="workspace-spatial-control-label">Reset angle</span></button>
              <button
                type="button"
                className="workspace-spatial-fullscreen-button"
                disabled={!fullscreenSupported}
                aria-label={isFullscreen ? "Exit fullscreen Workspace View" : "Enter fullscreen Workspace View"}
                aria-pressed={isFullscreen}
                title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                onClick={() => void toggleWorkspaceFullscreen()}
              >{isFullscreen ? <Minimize2 size={15} /> : <Maximize size={15} />}</button>
              <span className={`workspace-spatial-camera-state mode-${cameraMode}`} role="status" aria-live="polite">{cameraStatus}</span>
            </div>

            <div className="workspace-spatial-legend" aria-label="Scene legend">
              <span><i className="online" /> Online</span>
              <span><i className="working" /> Working</span>
              <span><i className="communicating" /> Communicating</span>
              <span><i className="offline" /> Offline</span>
              <span className="flow-key flow-key-first"><i className="flow-request" /> Request</span>
              <span className="flow-key"><i className="flow-response" /> Return</span>
              <span className="flow-key"><i className="flow-error" /> Error</span>
            </div>

            {rehearsalEnabled && (
              <div className={`workspace-spatial-motion-rehearsal${rehearsal ? ` cue-${rehearsal.cue}` : ""}`} role="group" aria-label="Motion rehearsal controls">
                <div className="motion-rehearsal-heading">
                  <span>Motion rehearsal</span>
                  <b>DEV</b>
                </div>
                <p>Local preview · server state is unchanged</p>
                <div className="motion-rehearsal-cues">
                  {WORKSPACE_SPATIAL_REHEARSAL_CUES.map((cue) => (
                    <button
                      key={cue.id}
                      type="button"
                      className={`cue-${cue.id}`}
                      disabled={!rehearsalAvailability.get(cue.id)}
                      aria-pressed={rehearsal?.cue === cue.id}
                      onClick={() => startRehearsal(cue.id)}
                    >{cue.label}</button>
                  ))}
                </div>
                <div className="motion-rehearsal-status" role="status" aria-live="polite">
                  <span>
                    {rehearsal
                      ? `${workspaceSpatialRehearsalPhaseLabel(rehearsal)} · ${rehearsal.label} · ${rehearsalTargetLabel}`
                      : "Ready · choose a finite cue"}
                  </span>
                  {rehearsal && <button type="button" onClick={stopRehearsal}>Stop</button>}
                </div>
              </div>
            )}

            <div className="workspace-spatial-hint">Drag to orbit · Right-drag to pan · 0 Fit · F Focus · C Chain</div>
            <p id="workspace-spatial-keyboard-instructions" className="workspace-spatial-a11y-instructions">
              Drag to orbit, right-drag to pan, and scroll to zoom. Select a visible object or use Search targets to find a Workspace, Device, Agent, or Bridge. Press 0 to fit, F to focus the selection, C to focus the active chain, R to reset the angle, and plus or minus to zoom.
            </p>
          </section>
        </div>

        {inspectedNode && <button className="topology-inspector-backdrop" type="button" aria-label="Close topology details" onClick={clearSelection} />}
        {inspectedNode && frontendReadOnly && <aside className="frontend-scene-inspector" aria-label="Demo scene details"><button type="button" onClick={clearSelection}>Close</button><h2>{inspectedNode.label}</h2><p>{inspectedNode.subtitle}</p><p>Read-only frontend participant. No runtime commands are sent.</p>{inspectedNode.bridge && <button type="button" onClick={() => { const bridge = scene.bridges.find(item => item.id === inspectedNode.bridge?.bridgeId); if (bridge) onOpenWorkspaceBridge(bridge.record); }}>Visit {inspectedNode.bridge.peerWorkspaceName} →</button>}</aside>}
        {inspectedNode && !frontendReadOnly && <TopologyInspector
          node={inspectedNode}
          open
          snapshot={operationalSnapshot}
          channelMemberIndex={channelMemberIndex}
          onRefresh={onRefresh}
          onCreateAgent={onCreateAgent}
          onConnectComputer={onConnectComputer}
          onOpenAgentDm={onOpenAgentDm}
          onOpenDmChannel={onOpenDmChannel}
          onOpenLiveExecution={onOpenLiveExecution}
          onOpenWorkspaceBridge={operatorContext ? undefined : (bridgeId) => {
            const bridge = scene.bridges.find((item) => item.id === bridgeId);
            if (bridge) onOpenWorkspaceBridge(bridge.record);
          }}
          onCollapse={clearSelection}
          operatorContext={operatorContext}
        />
        }
      </div>
    </div>
  );
}
