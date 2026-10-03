import { useEffect, useState } from "react";
import { ArrowRight, Building2, Check, RefreshCw } from "lucide-react";
import type { ServerRecord, WorkspaceBridgeConnectionIntent } from "@tyr-ai/contracts";
import { api, apiErrorMessage, ApiError } from "../lib/api";
import { TyrLogo } from "../shared/TyrLogo";

export function BridgeConnectionPage({ code, servers, onOpenWorkspace }: {
  code: string;
  servers: ServerRecord[];
  onOpenWorkspace: (workspaceId?: string) => Promise<void>;
}) {
  const [intent, setIntent] = useState<WorkspaceBridgeConnectionIntent | null>(null);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const choices = servers.filter((server) => server.role === "owner" && server.id !== intent?.sourceWorkspaceId);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api<{ intent: WorkspaceBridgeConnectionIntent }>(`/api/workspace-bridge-invites/${encodeURIComponent(code)}`);
        if (!cancelled) { setIntent(data.intent); setError(""); }
      } catch (err) { if (!cancelled) setError(err instanceof ApiError && err.code === "workspace_bridge_invite_recipient_required"
        ? "This invitation is for a different account. Sign in with the email that received it."
        : apiErrorMessage(err, "This connection link is unavailable.")); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [code]);

  async function claim() {
    if (!targetWorkspaceId || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ intent: WorkspaceBridgeConnectionIntent }>(`/api/workspace-bridge-invites/${encodeURIComponent(code)}/claim`, {
        method: "POST",
        body: JSON.stringify({ targetWorkspaceId })
      });
      setIntent(data.intent);
      if (data.intent.status === "active") {
        try {
          await onOpenWorkspace(data.intent.targetWorkspaceId ?? targetWorkspaceId);
        } catch (err) {
          setError(apiErrorMessage(err, "The Bridge is connected, but the Workspace could not be opened. Try Open workspace again."));
        }
      }
    } catch (err) { setError(apiErrorMessage(err, "Could not claim this connection link.")); }
    finally { setBusy(false); }
  }

  const unavailable = intent && intent.status !== "pending" && intent.status !== "claimed" && intent.status !== "active";
  const claimedByThisAccount = intent?.targetWorkspaceId && choices.some((workspace) => workspace.id === intent.targetWorkspaceId);
  const connectedWorkspaceId = servers.find((workspace) => workspace.id === intent?.targetWorkspaceId)?.id
    ?? servers.find((workspace) => workspace.id === intent?.sourceWorkspaceId)?.id;

  async function openWorkspace() {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await onOpenWorkspace(connectedWorkspaceId); }
    catch (err) { setError(apiErrorMessage(err, "Could not open the Workspace. Please try again.")); }
    finally { setBusy(false); }
  }

  return <div className="auth-page auth-loading-page onboarding-page">
    <section className="auth-card onboarding-card bridge-connection-card">
      <div className="auth-logo"><TyrLogo /></div>
      <p className="auth-tagline">WORKSPACE CONNECTION</p>
      <h1>Connect workspaces</h1>
      {intent && <p className="auth-copy">{intent.invitedByDisplayName} invited {intent.invitationKind === "email" ? "you" : "a Workspace Owner"} to connect with <b>{intent.sourceWorkspaceName}</b>.</p>}
      {intent && <p className="auth-copy">This creates a two-way Bridge. Both sides can ask the other's TYR to work with that Workspace Owner's capabilities. Private DMs and membership remain separate.</p>}
      {intent?.invitationKind === "email" && <p className="auth-copy">Accepting connects the Workspaces immediately. The inviter has already agreed.</p>}
      {intent?.expiresAt && <p className="auth-copy">Link expires {new Date(intent.expiresAt).toLocaleString()}.</p>}
      {error && <div className="login-error" role="status">{error}</div>}
      {!intent && !error && <div className="auth-loading-line" />}
      {unavailable && <div className="login-error">This connection link is {intent.status}.</div>}
      {intent?.status === "pending" && <div className="bridge-connection-choice">
        <label htmlFor="bridge-target-workspace">Choose the Workspace you own</label>
        {choices.length ? <>
          <select id="bridge-target-workspace" className="input" value={targetWorkspaceId} onChange={(event) => setTargetWorkspaceId(event.target.value)}>
            <option value="">Select a Workspace</option>
            {choices.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
          <button className="btn primary" type="button" disabled={!targetWorkspaceId || busy} onClick={() => void claim()}><Building2 size={16} /> {busy ? "Submitting…" : intent.invitationKind === "email" ? "Accept and connect" : "Request connection"}</button>
        </> : <p>You need to own a Workspace before you can accept this link.</p>}
      </div>}
      {intent?.status === "claimed" && <div className="bridge-connection-status"><Check size={18} /> {claimedByThisAccount ? "Request sent. The inviter will review your Workspace and confirm the connection." : "This link has already been claimed."}</div>}
      {intent?.status === "active" && <div className="bridge-connection-status"><Check size={18} /> Workspace Bridge connected.</div>}
      <button className={`btn ${intent?.status === "active" || intent?.status === "claimed" ? "primary" : "auth-secondary"}`} type="button" disabled={busy} onClick={() => void openWorkspace()}>
        <ArrowRight size={16} /> {busy ? "Opening…" : intent?.status === "active" || intent?.status === "claimed" ? "Open workspace" : "Back to workspace"}
      </button>
      <button className="btn auth-secondary" type="button" disabled={busy} onClick={() => window.location.reload()}><RefreshCw size={16} /> Refresh</button>
    </section>
  </div>;
}
