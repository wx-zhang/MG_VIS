import { ArrowRight, Edit3, Mail, RefreshCw, Server, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import type { HelpdeskSignupPublicPayload } from "@tyr-ai/contracts";
import type { AuthResponse } from "./workspaceTypes";
import { ApiError, api, apiErrorMessage } from "../lib/api";
import { TyrLogo } from "../shared/TyrLogo";
import { Link } from "react-router-dom";

export function SignupConfirmPage({ token, onAuthenticated }: { token: string; onAuthenticated: (result: AuthResponse) => Promise<void> }) {
  const [payload, setPayload] = useState<HelpdeskSignupPublicPayload | null>(null);
  const [name, setName] = useState("");
  const [serverName, setServerName] = useState("");
  const [editDetails, setEditDetails] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError("");
      try {
        const data = await api<HelpdeskSignupPublicPayload>(`/api/helpdesk/signup-intents/${encodeURIComponent(token)}`);
        if (cancelled) return;
        setPayload(data);
      } catch (err) {
        if (cancelled) return;
        const terminal = signupPayloadFromError(err);
        if (terminal) setPayload(terminal);
        else setError(apiErrorMessage(err, "Signup link failed."));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function complete() {
    if (!payload?.email || payload.status !== "pending") return;
    setBusy(true);
    setError("");
    try {
      const data = await api<AuthResponse>(`/api/helpdesk/signup-intents/${encodeURIComponent(token)}/complete`, {
        method: "POST",
        body: JSON.stringify({
          name: accountName,
          serverName: workspaceName
        })
      });
      await onAuthenticated(data);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "signup_user_exists"
        ? "This email now has an account. Sign in to continue with your invitation."
        : err instanceof ApiError && err.code === "signup_invite_unavailable"
          ? "This invitation is no longer available. Ask the sender for a new invitation."
          : apiErrorMessage(err, "Signup failed."));
    } finally {
      setBusy(false);
    }
  }

  const generated = signupPreviewFromEmail(payload?.email ?? "");
  const accountName = editDetails ? name.trim() || generated.name : generated.name;
  const workspaceName = editDetails ? serverName.trim() || `${accountName || generated.name}'s Workspace` : generated.serverName;
  const unavailable = payload?.status && payload.status !== "pending";
  const disabled = busy || !payload || payload.status !== "pending" || !accountName.trim() || !workspaceName.trim();

  function openEditDetails() {
    setName(name || generated.name);
    setServerName(serverName || generated.serverName);
    setEditDetails(true);
  }

  return (
    <div className="auth-page">
      <form className="auth-card auth-login-card" onSubmit={(event) => {
        event.preventDefault();
        void complete();
      }}>
        <div className="auth-split">
          <section className="auth-visual-panel">
            <div className="auth-brand-row">
              <div className="auth-logo"><TyrLogo color="white" /></div>
              <span className="auth-version">HELPDESK</span>
            </div>
            <div className="auth-visual-copy">
              <p className="auth-visual-eyebrow"><Mail size={14} /> help@agent.tyr.ai</p>
              <h1>Create your Tyr workspace from email.</h1>
              <p className="auth-visual-subhead">Confirm the magic link and launch a personal workspace with TYR ready.</p>
            </div>
            <div className="auth-status-card" aria-hidden="true">
              <div className="auth-status-head">
                <span><Mail size={14} /> SIGNUP_LINK</span>
              </div>
              <div className="auth-status-row">
                <span><UserRound size={14} /> Email</span>
                <b>{payload?.email ?? "Checking"}</b>
              </div>
              <div className="auth-status-row muted">
                <span><Server size={14} /> Workspace</span>
                <b>{workspaceName || "Personal"}</b>
              </div>
            </div>
            <div className="auth-port-line">TYR HELPDESK</div>
          </section>
          <section className="auth-form-panel">
            <span className="auth-step-pill"><Mail size={14} /> Email Confirmed Signup</span>
            <h1>Your workspace is ready</h1>
            {payload?.email && <p className="auth-copy">{payload.returnPath
              ? "Create your Workspace to return to the invitation. You will review the connection before accepting it."
              : "Review the generated account details and create your workspace."}</p>}
            {payload?.expiresAt && payload.status === "pending" && <p className="auth-copy">This link expires {new Date(payload.expiresAt).toLocaleString()}.</p>}
            {unavailable ? (
              <div className="login-error">{statusMessage(payload.status)}</div>
            ) : (
              <>
                <div className="auth-confirm-summary" aria-label="Account details">
                  <div className="auth-confirm-summary-head">
                    <span>Account details</span>
                    <small>Ready to create</small>
                  </div>
                  <div className="auth-confirm-row">
                    <span className="auth-confirm-icon"><Mail size={15} /></span>
                    <span className="auth-confirm-copy">
                      <small>Email</small>
                      <b>{payload?.email ?? "Checking"}</b>
                    </span>
                  </div>
                  <div className="auth-confirm-row">
                    <span className="auth-confirm-icon"><UserRound size={15} /></span>
                    <span className="auth-confirm-copy">
                      <small>Name</small>
                      <b>{accountName}</b>
                    </span>
                  </div>
                  <div className="auth-confirm-row">
                    <span className="auth-confirm-icon"><Server size={15} /></span>
                    <span className="auth-confirm-copy">
                      <small>Workspace</small>
                      <b>{workspaceName}</b>
                    </span>
                  </div>
                </div>
                {editDetails ? (
                  <>
                    <label className="field-label">Name</label>
                    <div className="auth-icon-field">
                      <UserRound size={16} />
                      <input className="input auth-input" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder={generated.name} />
                    </div>
                    <label className="field-label">Workspace name</label>
                    <div className="auth-icon-field">
                      <Server size={16} />
                      <input className="input auth-input" value={serverName} onChange={(event) => setServerName(event.target.value)} autoComplete="organization" placeholder={generated.serverName} />
                    </div>
                  </>
                ) : (
                  <button className="btn ghost" type="button" onClick={openEditDetails}><Edit3 size={15} /> Edit details</button>
                )}
                <button className="btn primary auth-submit" disabled={disabled}>
                  {busy ? <RefreshCw size={16} /> : <ArrowRight size={16} />}
                  {busy ? "Creating workspace" : "Create workspace"}
                </button>
              </>
            )}
            {error && <div className="login-error">{error}</div>}
            {payload?.returnPath && <Link className="btn auth-secondary" to={`/login?${new URLSearchParams({ next: payload.returnPath })}`}>
              Sign in and return to invitation
            </Link>}
          </section>
        </div>
      </form>
    </div>
  );
}

function signupPayloadFromError(error: unknown): HelpdeskSignupPublicPayload | null {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== "object") return null;
  const status = (error.details as { status?: unknown }).status;
  return status === "invalid" || status === "expired" || status === "completed"
    ? { status }
    : null;
}

function signupPreviewFromEmail(email: string): { name: string; serverName: string } {
  const localPart = email.split("@")[0]?.split("+")[0] ?? "";
  const words = localPart
    .replace(/[._-]+/g, " ")
    .replace(/[^a-z0-9 ]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const name = words.length > 0
    ? words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase()).join(" ")
    : "Tyr User";
  return {
    name,
    serverName: `${name}'s Workspace`
  };
}

function statusMessage(status: HelpdeskSignupPublicPayload["status"]): string {
  if (status === "expired") return "This signup link has expired.";
  if (status === "completed") return "This signup link has already been used.";
  if (status === "invalid") return "This signup link is unavailable.";
  return "This signup link is unavailable.";
}
