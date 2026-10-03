import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Building2, Check, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import type {
  PlatformOperatorCityOverviewPayload,
  PlatformOperatorRecord,
  PlatformOperatorSessionPayload,
  PlatformOperatorSessionStatusPayload,
  PlatformOperatorWorkspaceRecord,
  PlatformOperatorWorkspaceViewPayload,
  TopologyLiveWorkPayload,
  TyrHeartbeatListPayload,
  TyrHeartbeatRecord,
  TyrHeartbeatIntervalUnit,
  UserRecord,
  WorkspaceRoutingInstructionsRecord,
  WorkspaceSharedFileListPayload,
  WorkspaceSharedFileRecord
} from "@tyr-ai/contracts";

import { api, apiForm, apiPath, ApiError, apiErrorMessage } from "../lib/api";
import { TyrLogo } from "../shared/TyrLogo";
import type { RuntimeModelCatalog } from "../shared/AgentModelSelect";
import { operatorWorkspaceSnapshot } from "../operatorWorkspace";
import { OperatorAuditCancelledError, type OperatorAuditMetadata } from "../operatorAudit";
import { OperatorAuditDialog } from "./OperatorAuditDialog";
import { OperatorCityOverview } from "./OperatorCityOverview";
import type { CityCameraPose } from "../map/operatorCityMapModel";
import { OperatorExecutionPanel } from "./OperatorExecutionPanel";
import { WorkspaceSpatialView } from "./WorkspaceSpatialView";
import { FrontendWorkspaceApp } from "./FrontendWorkspaceApp";
import type { TopologyOperatorContext } from "./TopologyInspectorDetails";

const EMPTY_LIVE_WORK: TopologyLiveWorkPayload = {
  executions: [],
  flows: [],
  activities: [],
  bridgeMessages: [],
  bridgeJourneys: [],
  truncated: false
};

type OperatorState = "checking" | "login" | "ready";

export function OperatorApp() {
  const location = useLocation();
  const workspace = new URLSearchParams(location.search).get("workspace");
  return workspace?.startsWith("demo-") ? <FrontendWorkspaceApp /> : <LiveOperatorApp />;
}

function LiveOperatorApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedServerId = new URLSearchParams(location.search).get("workspace") ?? "";
  const [state, setState] = useState<OperatorState>("checking");
  const [operator, setOperator] = useState<PlatformOperatorRecord | null>(null);
  const [workspaces, setWorkspaces] = useState<PlatformOperatorWorkspaceRecord[]>([]);
  const [lastCityWorkspaceId, setLastCityWorkspaceId] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [cityConnections, setCityConnections] = useState(true);
  const [cityCameraPose, setCityCameraPose] = useState<CityCameraPose | null>(null);
  const [workspaceView, setWorkspaceView] = useState<PlatformOperatorWorkspaceViewPayload | null>(null);
  const [liveWork, setLiveWork] = useState<TopologyLiveWorkPayload>(EMPTY_LIVE_WORK);
  const [heartbeatPayload, setHeartbeatPayload] = useState<TyrHeartbeatListPayload>({ heartbeats: [], runs: [] });
  const [sharedFilePayload, setSharedFilePayload] = useState<WorkspaceSharedFileListPayload>({ files: [] });
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const [cityOverview, setCityOverview] = useState<PlatformOperatorCityOverviewPayload | null>(null);
  const [cityError, setCityError] = useState("");
  const [cityLoading, setCityLoading] = useState(false);
  const [auditDialog, setAuditDialog] = useState<{ action: string; resolve: (metadata: OperatorAuditMetadata) => void; reject: (error: Error) => void } | null>(null);
  const [login, setLogin] = useState("operator-mg@tyr.ai");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const liveWorkRequestRef = useRef<AbortController | null>(null);
  const cityRequestRef = useRef<AbortController | null>(null);
  const workspaceLoadSequenceRef = useRef(0);
  const pendingNavigationRef = useRef<string | null>(null);

  const previousWorkspaceId = (location.state as { operatorPreviousWorkspaceId?: unknown } | null)?.operatorPreviousWorkspaceId;
  const hasPreviousView = typeof previousWorkspaceId === "string" && (previousWorkspaceId === "" || workspaces.some((workspace) => workspace.serverId === previousWorkspaceId));
  const previousViewLabel = previousWorkspaceId === "" ? "Marlow Green" : workspaces.find((workspace) => workspace.serverId === previousWorkspaceId)?.serverName;

  async function navigateToView(serverId: string): Promise<boolean> {
    if (serverId === selectedServerId) return true;
    if (serverId && !workspaces.some((workspace) => workspace.serverId === serverId)) return false;
    if (serverId) {
      // 先加载目标数据，再将其写入视图历史；失败时停留在原视图。
      pendingNavigationRef.current = serverId;
      const loaded = await loadWorkspace(serverId);
      if (pendingNavigationRef.current !== serverId) return false;
      pendingNavigationRef.current = null;
      if (!loaded) return false;
    }
    if (!serverId && selectedServerId) {
      setSelectedExecutionId("");
      setLastCityWorkspaceId(selectedServerId);
    }
    // URL 是当前视图真源；每次成功选择产生一条可由浏览器后退恢复的历史记录。
    navigate(serverId ? `/operator?workspace=${encodeURIComponent(serverId)}` : "/operator", {
      state: { operatorPreviousWorkspaceId: selectedServerId }
    });
    return true;
  }

  function returnToPreviousView() {
    if (hasPreviousView) navigate(-1);
    else navigate("/operator", { replace: true });
  }

  // 审计信息按写操作收集，避免把固定理由长期挂在只读总览上。
  const requestAudit = useCallback((action: string): Promise<OperatorAuditMetadata> => new Promise((resolve, reject) => {
    setAuditDialog({ action, resolve, reject });
  }), []);

  function closeAuditDialog(metadata?: OperatorAuditMetadata) {
    if (!auditDialog) return;
    if (metadata) auditDialog.resolve(metadata);
    else auditDialog.reject(new OperatorAuditCancelledError());
    setAuditDialog(null);
  }

  useEffect(() => {
    let cancelled = false;
    void api<PlatformOperatorSessionStatusPayload>("/api/operator/auth/status", { label: "operator.session-status" })
      .then(async (session) => {
        if (cancelled) return;
        if (!session.authenticated) {
          setState("login");
          return;
        }
        await acceptSession(session);
      })
      .catch((sessionError) => {
        if (cancelled) return;
        if (sessionError instanceof ApiError && sessionError.status === 401) {
          setState("login");
          return;
        }
        setError(apiErrorMessage(sessionError));
        setState("login");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state !== "ready" || !selectedServerId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const controller = new AbortController();
      liveWorkRequestRef.current = controller;
      try {
        const payload = await api<TopologyLiveWorkPayload>(
          `/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/live-work`,
          { label: "operator.live-work", signal: controller.signal }
        );
        if (!cancelled) setLiveWork(payload);
      } catch {
        // Workspace configuration remains usable during a transient live-work polling failure.
      } finally {
        if (liveWorkRequestRef.current === controller) liveWorkRequestRef.current = null;
        if (!cancelled) timer = setTimeout(refresh, 2_000);
      }
    };
    timer = setTimeout(refresh, 2_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      liveWorkRequestRef.current?.abort();
      liveWorkRequestRef.current = null;
    };
  }, [selectedServerId, state]);

  useEffect(() => {
    // 浏览器后退/前进可能发生在异步详情加载期间；旧请求不能覆盖新视图。
    pendingNavigationRef.current = null;
    workspaceLoadSequenceRef.current += 1;
    setBusy(false);
  }, [selectedServerId]);

  useEffect(() => {
    if (state !== "ready" || selectedServerId) return;
    setSelectedExecutionId("");
    // 只有全城视角轮询脱敏聚合状态；进入 Workspace 后改用现有详情轮询。
    let cancelled = false;
    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      await refreshCity(first);
      first = false;
      if (!cancelled) timer = setTimeout(refresh, 3_000);
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      cityRequestRef.current?.abort();
      cityRequestRef.current = null;
    };
  }, [selectedServerId, state]);

  useEffect(() => {
    if (state !== "ready" || !selectedServerId) return;
    if (pendingNavigationRef.current) return;
    if (!workspaces.some((workspace) => workspace.serverId === selectedServerId)) {
      setError("This Workspace is no longer available.");
      navigate("/operator", { replace: true });
      return;
    }
    if (workspaceView?.workspace.serverId === selectedServerId) return;
    let cancelled = false;
    void loadWorkspace(selectedServerId).then((loaded) => {
      if (loaded || cancelled) return;
      // 无效或加载失败的深链接退回城市，避免停留在空白详情页。
      navigate("/operator", { replace: true });
    });
    return () => { cancelled = true; };
  }, [state, selectedServerId, workspaceView?.workspace.serverId, workspaces, navigate]);

  async function refreshCity(showLoading: boolean) {
    cityRequestRef.current?.abort();
    const controller = new AbortController();
    cityRequestRef.current = controller;
    if (showLoading) setCityLoading(true);
    try {
      const overview = await api<PlatformOperatorCityOverviewPayload>("/api/operator/city/overview", {
        label: "operator.city-overview",
        signal: controller.signal
      });
      if (controller.signal.aborted) return;
      setCityOverview(overview);
      setCityError("");
    } catch (cityRequestError) {
      if (!controller.signal.aborted) setCityError(apiErrorMessage(cityRequestError, "City status could not be loaded."));
    } finally {
      if (cityRequestRef.current === controller) cityRequestRef.current = null;
      if (showLoading && !controller.signal.aborted) setCityLoading(false);
    }
  }

  async function acceptSession(session: PlatformOperatorSessionPayload) {
    setOperator(session.operator);
    setWorkspaces(session.workspaces);
    // 登录后按 URL 恢复视图；无 Workspace 参数时显示全城。
    setState("ready");
  }

  async function loadWorkspace(serverId = selectedServerId) {
    if (!serverId) return false;
    const loadSequence = ++workspaceLoadSequenceRef.current;
    if (serverId !== workspaceView?.workspace.serverId) {
      setLiveWork(EMPTY_LIVE_WORK);
      setSelectedExecutionId("");
    }
    setBusy(true);
    setError("");
    try {
      const [payload, nextLiveWork, heartbeats, sharedFiles] = await Promise.all([
        api<PlatformOperatorWorkspaceViewPayload>(
          `/api/operator/workspaces/${encodeURIComponent(serverId)}/view`,
          { label: "operator.workspace-view" }
        ),
        api<TopologyLiveWorkPayload>(
          `/api/operator/workspaces/${encodeURIComponent(serverId)}/live-work`,
          { label: "operator.live-work" }
        ),
        api<TyrHeartbeatListPayload>(
          `/api/operator/workspaces/${encodeURIComponent(serverId)}/heartbeats`,
          { label: "operator.heartbeats" }
        ),
        api<WorkspaceSharedFileListPayload>(
          `/api/operator/workspaces/${encodeURIComponent(serverId)}/shared-files`,
          { label: "operator.shared-files" }
        )
      ]);
      if (loadSequence !== workspaceLoadSequenceRef.current) return false;
      setWorkspaceView(payload);
      setLiveWork(nextLiveWork);
      setHeartbeatPayload(heartbeats);
      setSharedFilePayload(sharedFiles);
      setLastCityWorkspaceId(serverId);
      return true;
    } catch (workspaceError) {
      if (loadSequence === workspaceLoadSequenceRef.current) setError(apiErrorMessage(workspaceError));
      return false;
    } finally {
      if (loadSequence === workspaceLoadSequenceRef.current) setBusy(false);
    }
  }

  async function submitLogin() {
    setBusy(true);
    setError("");
    try {
      const session = await api<PlatformOperatorSessionPayload>("/api/operator/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password }),
        label: "operator.login"
      });
      setPassword("");
      await acceptSession(session);
    } catch (loginError) {
      setError(apiErrorMessage(loginError, "Sign-in failed."));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    // Stop the authenticated poll before invalidating its HttpOnly session so logout stays quiet.
    liveWorkRequestRef.current?.abort();
    liveWorkRequestRef.current = null;
    cityRequestRef.current?.abort();
    cityRequestRef.current = null;
    if (auditDialog) closeAuditDialog();
    setState("login");
    try {
      await api<{ ok: true }>("/api/operator/auth/logout", { method: "POST", body: "{}", label: "operator.logout" });
    } finally {
      setOperator(null);
      setWorkspaces([]);
      setWorkspaceView(null);
      setLiveWork(EMPTY_LIVE_WORK);
      setHeartbeatPayload({ heartbeats: [], runs: [] });
      setSharedFilePayload({ files: [] });
      navigate("/operator", { replace: true });
      setLastCityWorkspaceId("");
      setCityCameraPose(null);
      setSelectedExecutionId("");
      setCityOverview(null);
      setCityError("");
      setState("login");
      setBusy(false);
    }
  }

  const operatorContext = useMemo<TopologyOperatorContext>(() => ({
    detectRuntimeModels: (machineId, runtime, signal) => api<RuntimeModelCatalog>(
      `/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/machines/${encodeURIComponent(machineId)}/runtimes/${runtime}/models/detect`,
      { method: "POST", signal, label: "operator.runtime-models" }
    ),
    updateAgent: async (agentId, input) => {
      const audit = await requestAudit("Update Agent profile");
      return api<Awaited<ReturnType<TopologyOperatorContext["updateAgent"]>>>(`/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/agents/${encodeURIComponent(agentId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...audit,
          displayName: input.displayName,
          description: input.description,
          model: input.model || null,
          permissionMode: input.permissionMode
        }),
        label: "operator.agent-update"
      });
    },
    runAgentAction: async (agentId, action) => {
      const audit = await requestAudit(`${action[0].toUpperCase()}${action.slice(1)} Agent`);
      await api(`/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/agents/${encodeURIComponent(agentId)}/${action}`, {
        method: "POST",
        body: JSON.stringify(audit),
        label: `operator.agent-${action}`
      });
    },
    routingInstructions: {
      load: () => api<WorkspaceRoutingInstructionsRecord>(
        `/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/routing-instructions`,
        { label: "operator.routing-instructions" }
      ),
      save: async (input: { instructions: string; expectedRevision: number }) => {
        const audit = await requestAudit("Save Workspace routing instructions");
        return api<WorkspaceRoutingInstructionsRecord>(
          `/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/routing-instructions`,
          {
            method: "PATCH",
            body: JSON.stringify({ ...audit, ...input }),
            label: "operator.routing-instructions-update"
          }
        );
      }
    },
    heartbeats: {
      records: heartbeatPayload.heartbeats,
      runs: heartbeatPayload.runs,
      create: async (input: { title: string; instruction: string; intervalUnit: TyrHeartbeatIntervalUnit; intervalValue: number }) => {
        const audit = await requestAudit("Create Heartbeat");
        await api(`/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/heartbeats`, {
          method: "POST",
          body: JSON.stringify({ ...audit, ...input }),
          label: "operator.heartbeat-create"
        });
        await loadHeartbeats(selectedServerId);
      },
      update: async (heartbeatId: string, input: Partial<Pick<TyrHeartbeatRecord, "title" | "instruction" | "intervalUnit" | "intervalValue" | "enabled">>) => {
        const audit = await requestAudit("Update Heartbeat");
        await api(`/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/heartbeats/${encodeURIComponent(heartbeatId)}`, {
          method: "PATCH",
          body: JSON.stringify({ ...audit, ...input }),
          label: "operator.heartbeat-update"
        });
        await loadHeartbeats(selectedServerId);
      },
      refresh: () => loadHeartbeats(selectedServerId)
    },
    sharedFiles: {
      records: sharedFilePayload.files,
      create: async (file, assignments) => {
        const audit = await requestAudit("Upload shared file");
        const form = new FormData();
        form.append("file", file);
        form.append("assignments", JSON.stringify(assignments));
        form.append("reason", audit.reason);
        form.append("reference", audit.reference);
        await apiForm(`/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/shared-files`, form, { label: "operator.shared-file-create" });
        await loadSharedFiles(selectedServerId);
      },
      update: async (fileId, input) => {
        const audit = await requestAudit("Update shared file");
        await api(`/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/shared-files/${encodeURIComponent(fileId)}`, {
          method: "PATCH",
          body: JSON.stringify({ ...audit, ...input }),
          label: "operator.shared-file-update"
        });
        await loadSharedFiles(selectedServerId);
      },
      replace: async (fileId, expectedVersion, file) => {
        const audit = await requestAudit("Replace working copy");
        const form = new FormData();
        form.append("file", file);
        form.append("expectedVersion", String(expectedVersion));
        form.append("reason", audit.reason);
        form.append("reference", audit.reference);
        await apiForm(`/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/shared-files/${encodeURIComponent(fileId)}/content`, form, { method: "PUT", label: "operator.shared-file-replace" });
        await loadSharedFiles(selectedServerId);
      },
      replaceOriginal: async (fileId, expectedVersion, file) => {
        const audit = await requestAudit("Replace original file");
        const form = new FormData();
        form.append("file", file);
        form.append("expectedVersion", String(expectedVersion));
        form.append("reason", audit.reason);
        form.append("reference", audit.reference);
        await apiForm(`/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/shared-files/${encodeURIComponent(fileId)}/original-content`, form, { method: "PUT", label: "operator.shared-file-replace-original" });
        await loadSharedFiles(selectedServerId);
      },
      reset: async (fileId, expectedVersion) => {
        const audit = await requestAudit("Reset shared file");
        await api(`/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/shared-files/${encodeURIComponent(fileId)}/reset`, {
          method: "POST",
          body: JSON.stringify({ ...audit, expectedVersion }),
          label: "operator.shared-file-reset"
        });
        await loadSharedFiles(selectedServerId);
      },
      remove: async (fileId) => {
        const audit = await requestAudit("Delete shared file");
        await api(`/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/shared-files/${encodeURIComponent(fileId)}`, {
          method: "DELETE",
          body: JSON.stringify(audit),
          label: "operator.shared-file-delete"
        });
        await loadSharedFiles(selectedServerId);
      },
      contentUrl: (fileId, inline, variant = "working") => apiPath(`/api/operator/workspaces/${encodeURIComponent(selectedServerId)}/shared-files/${encodeURIComponent(fileId)}/content?variant=${variant}${inline ? "&disposition=inline" : ""}`),
      refresh: () => loadSharedFiles(selectedServerId)
    }
  }), [heartbeatPayload, sharedFilePayload, requestAudit, selectedServerId]);

  async function loadHeartbeats(serverId: string) {
    if (!serverId) return;
    const payload = await api<TyrHeartbeatListPayload>(
      `/api/operator/workspaces/${encodeURIComponent(serverId)}/heartbeats`,
      { label: "operator.heartbeats" }
    );
    setHeartbeatPayload(payload);
  }

  async function loadSharedFiles(serverId: string) {
    if (!serverId) return;
    const payload = await api<WorkspaceSharedFileListPayload>(
      `/api/operator/workspaces/${encodeURIComponent(serverId)}/shared-files`,
      { label: "operator.shared-files" }
    );
    setSharedFilePayload(payload);
  }

  const snapshot = useMemo(
    () => workspaceView ? operatorWorkspaceSnapshot(workspaceView) : null,
    [workspaceView]
  );

  if (state === "checking") {
    return <OperatorStatus text="Checking Operator access…" />;
  }

  if (state === "login") {
    return (
      <div className="auth-page operator-auth-page">
        <main className="operator-auth-shell">
          <section className="operator-auth-visual">
            <div className="operator-auth-brand">
              <div className="auth-logo"><TyrLogo color="white" /></div>
              <span><ShieldCheck size={14} /> Operator access</span>
            </div>

            <div className="operator-auth-story">
              <p className="operator-auth-kicker">One control plane. Six workspaces.</p>
              <h1>Move between workspaces without crossing trust boundaries.</h1>
              <p>Inspect granted environments, coordinate Agents, and keep every operator action inside an auditable session.</p>
            </div>

            <div className="operator-auth-map" aria-hidden="true">
              <span className="operator-auth-orbit orbit-one" />
              <span className="operator-auth-orbit orbit-two" />
              <span className="operator-auth-link link-one" />
              <span className="operator-auth-link link-two" />
              <span className="operator-auth-link link-three" />
              <span className="operator-auth-node node-central"><ShieldCheck size={22} /></span>
              <span className="operator-auth-node node-one">01</span>
              <span className="operator-auth-node node-two">02</span>
              <span className="operator-auth-node node-three">03</span>
              <span className="operator-auth-node node-four">04</span>
              <span className="operator-auth-node node-five">05</span>
              <span className="operator-auth-node node-six">06</span>
            </div>

            <div className="operator-auth-proof">
              <span><Check size={14} /> Global Workspace access</span>
              <span><Check size={14} /> Owner sessions stay private</span>
              <span><Check size={14} /> Actions remain attributable</span>
            </div>
          </section>

          <section className="operator-auth-entry">
            <form className="auth-card operator-auth-card" onSubmit={(event) => {
              event.preventDefault();
              void submitLogin();
            }}>
              <div className="operator-auth-mobile-logo auth-logo"><TyrLogo /></div>
              <span className="operator-auth-mark"><ShieldCheck size={15} /> Global Operator</span>
              <h2>Open the operator view</h2>
              <p className="auth-copy">Use your operator credentials to manage every Workspace.</p>

              <label className="field-label" htmlFor="operator-login">Operator login</label>
              <div className="auth-icon-field">
                <Building2 size={16} />
                <input id="operator-login" className="input auth-input" value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" spellCheck={false} />
              </div>
              <label className="field-label" htmlFor="operator-password">Password</label>
              <div className="auth-icon-field">
                <KeyRound size={16} />
                <input id="operator-password" className="input auth-input" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
              </div>
              <button className="btn primary auth-submit" disabled={busy || !login.trim() || !password}>
                <span>{busy ? "Signing in…" : "Open Operator View"}</span>
                {!busy && <ArrowRight size={17} />}
              </button>
              {error && <div className="login-error" role="alert">{error}</div>}
              <p className="operator-auth-note"><ShieldCheck size={14} /> This sign-in does not open a resident Owner session.</p>
            </form>
          </section>
        </main>
      </div>
    );
  }

  if (!operator) {
    return <OperatorStatus text="Operator session unavailable." error={error} />;
  }

  const operatorUser: UserRecord = {
    id: operator.id,
    name: operator.login,
    displayName: operator.displayName,
    email: operator.login,
    createdAt: operator.createdAt
  };

  const auditOverlay = auditDialog && <OperatorAuditDialog
    action={auditDialog.action}
    onConfirm={(metadata) => closeAuditDialog(metadata)}
    onCancel={() => closeAuditDialog()}
  />;

  if (!selectedServerId) {
    return <div className="operator-console">
      <OperatorCityOverview
        operatorUser={operatorUser}
        overview={cityOverview}
        workspaces={workspaces}
        returnFromWorkspaceId={lastCityWorkspaceId || null}
        search={citySearch}
        onSearchChange={setCitySearch}
        connections={cityConnections}
        onConnectionsChange={setCityConnections}
        cameraPose={cityCameraPose}
        onCameraPoseChange={setCityCameraPose}
        backLabel={hasPreviousView ? previousViewLabel ?? null : null}
        loading={cityLoading || busy}
        error={cityError || error}
        onOpenWorkspace={navigateToView}
        onBack={returnToPreviousView}
        onRefresh={() => { setError(""); void refreshCity(true); }}
        onLogout={() => void logout()}
      />
      {auditOverlay}
    </div>;
  }

  if (!snapshot || !workspaceView || workspaceView.workspace.serverId !== selectedServerId) {
    return <OperatorStatus text={busy ? "Loading the Workspace…" : "No Workspace is available."} error={error} />;
  }

  return (
    <div className="operator-console">
      <WorkspaceSpatialView
        snapshot={snapshot}
        liveWork={liveWork}
        channelMemberIndex={{}}
        topbarTitle={(
          <span className="operator-topbar-title">
            <button className="operator-topbar-back" type="button" disabled={busy} onClick={returnToPreviousView} aria-label={`Back to ${hasPreviousView ? previousViewLabel : "Marlow Green"}`} title={`Back to ${hasPreviousView ? previousViewLabel : "Marlow Green"}`}><ArrowLeft size={16} /><span>Back to {hasPreviousView ? previousViewLabel : "Marlow Green"}</span></button>
            <ShieldCheck size={18} />
            <span>Global Operator</span>
            <label>
              <span className="sr-only">Current Workspace</span>
              <select value={selectedServerId} disabled={busy} onChange={(event) => {
                void navigateToView(event.target.value);
              }}>
                <option value="">Marlow Green overview</option>
                {workspaces.map((workspace) => <option key={workspace.serverId} value={workspace.serverId}>{workspace.serverName}</option>)}
              </select>
            </label>
            <button className="operator-topbar-refresh" type="button" title="Refresh Workspace View" aria-label="Refresh Workspace View" disabled={busy} onClick={() => void loadWorkspace()}><RefreshCw size={15} /></button>
          </span>
        )}
        topbarProps={{
          currentUser: operatorUser,
          unreadCount: 0,
          pendingApprovalCount: 0,
          activeUtility: null,
          onOpenSearch: () => undefined,
          onOpenInbox: () => undefined,
          onOpenSaved: () => undefined,
          onOpenApprovals: () => undefined,
          onOpenProfile: () => undefined,
          onLogoutRequest: () => void logout(),
          mode: "operator",
          contextLabel: workspaceView.workspace.serverName
        }}
        workspaceViewOnly
        operatorContext={operatorContext}
        onOpenTopology={() => undefined}
        onRefresh={async () => { await loadWorkspace(); }}
        onCreateAgent={() => undefined}
        onConnectComputer={() => undefined}
        onOpenAgentDm={async () => undefined}
        onOpenWorkspaceBridge={() => undefined}
        onOpenDmChannel={() => undefined}
        onOpenLiveExecution={setSelectedExecutionId}
      />
      {selectedExecutionId && (
        <div className="operator-execution-drawer">
          <OperatorExecutionPanel
            snapshot={snapshot}
            serverId={selectedServerId}
            executionId={selectedExecutionId}
            requestAudit={requestAudit}
            onClose={() => setSelectedExecutionId("")}
            onRefresh={async () => { await loadWorkspace(selectedServerId); }}
          />
        </div>
      )}
      {error && <div className="operator-workspace-error" role="alert">{error}</div>}
      {auditOverlay}
    </div>
  );
}

function OperatorStatus({ text, error }: { text: string; error?: string }) {
  return (
    <div className="auth-page operator-auth-page operator-status-page">
      <section className="auth-card operator-status-card" role="status">
        <div className="auth-logo"><TyrLogo /></div>
        <ShieldCheck size={24} />
        <h1>{text}</h1>
        {error && <div className="login-error">{error}</div>}
      </section>
    </div>
  );
}
