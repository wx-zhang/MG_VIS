import { lazy, Suspense, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import type {
  PlatformOperatorCityOverviewPayload,
  PlatformOperatorWorkspaceRecord,
  UserRecord,
} from "@tyr-ai/contracts";
import { TopBar, type WorkspaceTopBarProps } from "../shared/ui";
import type { CityCameraPose } from "../map/operatorCityMapModel";
import { cityLocations } from "../map/operatorCityMapModel";
import { operatorCityWorkspaceState } from "./operatorCityStatus";
import { FRONTEND_TOWN } from "../map/frontendTownDemo";
import { useNavigate } from "react-router-dom";
import "../styles/operator-map.css";
const OperatorCityMap = lazy(() =>
  import("./OperatorCityMap").then((module) => ({
    default: module.OperatorCityMap,
  })),
);
type Props = {
  demoOnly?: boolean;
  operatorUser: UserRecord;
  overview: PlatformOperatorCityOverviewPayload | null;
  workspaces: PlatformOperatorWorkspaceRecord[];
  returnFromWorkspaceId: string | null;
  search: string;
  onSearchChange: (search: string) => void;
  connections: boolean;
  onConnectionsChange: (visible: boolean) => void;
  cameraPose: CityCameraPose | null;
  onCameraPoseChange: (pose: CityCameraPose) => void;
  backLabel: string | null;
  loading: boolean;
  error: string;
  onOpenWorkspace: (serverId: string) => Promise<boolean>;
  onBack: () => void;
  onRefresh: () => void;
  onLogout: () => void;
};
export function OperatorCityOverview({
  demoOnly = false,
  operatorUser,
  overview: liveOverview,
  workspaces,
  search,
  onSearchChange,
  connections,
  onConnectionsChange,
  cameraPose,
  onCameraPoseChange,
  backLabel,
  loading,
  error,
  onOpenWorkspace,
  onBack,
  onRefresh,
  onLogout,
}: Props) {
  const navigate = useNavigate();
  const [frontendDemo, setFrontendDemo] = useState(true);
  const overview = frontendDemo ? FRONTEND_TOWN : liveOverview;
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const topbarProps: WorkspaceTopBarProps = {
    currentUser: operatorUser,
    unreadCount: 0,
    pendingApprovalCount: 0,
    activeUtility: null,
    onOpenSearch: () => undefined,
    onOpenInbox: () => undefined,
    onOpenSaved: () => undefined,
    onOpenApprovals: () => undefined,
    onOpenProfile: () => undefined,
    onLogoutRequest: onLogout,
    mode: "operator",
    contextLabel: "Marlow Green",
    hideAccountControls: demoOnly,
  };
  const summaries = overview?.workspaces ?? [];
  const rows = (overview?.workspaces ?? workspaces).filter((workspace) =>
    workspace.serverName.toLowerCase().includes(search.toLowerCase()),
  );
  const placed = useMemo(
    () => new Set(cityLocations(summaries).map((location) => location.id)),
    [overview],
  );
  const active = summaries.reduce((n, w) => n + w.activeExecutions, 0),
    online = summaries.reduce((n, w) => n + w.devicesOnline, 0),
    waiting = summaries.reduce((n, w) => n + w.waitingApprovals, 0);
  async function enter(id: string) {
    if (frontendDemo) { navigate(`/operator?workspace=${encodeURIComponent(id)}`); return; }
    if (enteringId) return;
    setEnteringId(id);
    try {
      if (!(await onOpenWorkspace(id))) setEnteringId(null);
    } catch {
      setEnteringId(null);
    }
  }
  return (
    <div className="operator-city-view operator-map-view">
      <TopBar
        title={
          <span className="operator-topbar-title">
            {backLabel && (
              <button
                className="operator-topbar-back"
                type="button"
                onClick={onBack}
              >
                <ArrowLeft size={16} />
                <span>Back to {backLabel}</span>
              </button>
            )}
            <ShieldCheck size={18} />
            <span>{demoOnly ? "Marlow Green" : "Global Operator"}</span>
          </span>
        }
        {...topbarProps}
      />
      <main className="city-workbench">
        <header className="city-workbench-header">
          <div>
            <h1>Marlow Green</h1>
            <p>{frontendDemo ? "Frontend replay · Six TYRs · Preset messages" : "A connected city of Workspaces"}</p>
          </div>
          <div className="city-metrics" aria-label="City status">
            {!demoOnly && <button className="town-demo-mode" type="button" aria-pressed={frontendDemo} onClick={() => setFrontendDemo(value => !value)}>{frontendDemo ? "Scripted town" : "Local server"}</button>}
            <span>
              <b>{overview ? overview.workspaces.length : workspaces.length}</b>{" "}
              Workspaces
            </span>
            <span>
              <b>{overview ? online : "—"}</b> {frontendDemo ? "Demo devices" : "Devices online"}
            </span>
            <span>
              <b>{frontendDemo ? 12 : overview ? active : "—"}</b> {frontendDemo ? "Bridges" : "Executions"}
            </span>
            {waiting > 0 && (
              <span className="city-attention">
                <Activity size={14} />
                {waiting} waiting for approval
              </span>
            )}
          </div>
        </header>
        <div className="city-workbench-body">
          <section className="city-map-stage" aria-label="City overview">
            {overview ? (
              <Suspense
                fallback={
                  <div className="city-map-message" role="status">
                    Preparing the map…
                  </div>
                }
              >
                <OperatorCityMap
                  overview={overview}
                  initialPose={cameraPose}
                  onPoseChange={onCameraPoseChange}
                  onSelect={(id) => void enter(id)}
                  enteringId={enteringId}
                  search={search}
                  connections={connections}
                  onConnectionsChange={onConnectionsChange}
                />
              </Suspense>
            ) : (
              <div className="city-map-message" role="status">
                {loading
                  ? "Loading city status…"
                  : "City status is unavailable. Use the Workspace list or retry."}
              </div>
            )}
          </section>
          <aside className="city-directory" aria-label="Workspace directory">
            <header>
              <h2>
                <Building2 size={17} />
                Workspaces
              </h2>
              <button
                type="button"
                onClick={onRefresh}
                disabled={loading}
                aria-label="Refresh city overview"
              >
                <RefreshCw size={15} />
              </button>
            </header>
            <label className="city-search">
              <Search size={16} />
              <input
                type="search"
                placeholder="Find a Workspace"
                aria-label="Find a Workspace"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </label>
            {error && (
              <div className="city-directory-error" role="alert">
                {error}
                <button type="button" onClick={onRefresh}>
                  Retry
                </button>
              </div>
            )}
            <nav aria-label="Select a Workspace">
              {rows.map((workspace) => {
                const summary = summaries.find(
                  (item) => item.serverId === workspace.serverId,
                );
                const state = summary
                  ? operatorCityWorkspaceState(summary)
                  : "unknown";
                return (
                  <button
                    className={`city-workspace-row state-${state}`}
                    key={workspace.serverId}
                    type="button"
                    disabled={Boolean(enteringId)}
                    onClick={() => void enter(workspace.serverId)}
                    aria-label={`Enter ${workspace.serverName}`}
                  >
                    <span className="city-row-name">
                      <i aria-hidden="true" />
                      <strong>{workspace.serverName}</strong>
                      <ArrowUpRight size={16} />
                    </span>
                    {summary ? (
                      <>
                        <span className="city-row-counts">
                          {summary.devicesOnline}/{summary.devicesTotal} Devices
                          · {summary.agentsOnline}/{summary.agentsTotal} Agents{" "}
                          {frontendDemo ? "in reference" : "online"}
                        </span>
                        <span className="city-row-status">
                          {enteringId === workspace.serverId
                            ? "Opening Workspace…"
                            : summary.waitingApprovals
                              ? `${summary.waitingApprovals} waiting for approval`
                              : summary.activeExecutions
                                ? `${summary.activeExecutions} active executions`
                                : state === "offline"
                                  ? "Offline"
                                  : frontendDemo ? "Scripted participant" : "Online"}
                        </span>
                        {!placed.has(workspace.serverId) && (
                          <small>Location not assigned</small>
                        )}
                      </>
                    ) : (
                      <small>Status unavailable</small>
                    )}
                  </button>
                );
              })}
              {rows.length === 0 && (
                <p className="city-directory-empty">
                  {search
                    ? "No matching Workspaces."
                    : "No Workspaces are available."}
                </p>
              )}
            </nav>
            <footer>
              <span className={error ? "is-stale" : ""}>
                {frontendDemo ? "Reference topology · Synthetic playback" : error
                  ? "Status may be out of date"
                  : overview
                    ? `Updated ${new Date(overview.observedAt).toLocaleTimeString()}`
                    : "Status unavailable"}
              </span>
              <p>
                {frontendDemo ? "Select a building to enter its 3D Workspace, TYR and subagents." : "Select a building or Workspace to see its Devices, Agents and live work."}
              </p>
            </footer>
          </aside>
        </div>
      </main>
    </div>
  );
}
