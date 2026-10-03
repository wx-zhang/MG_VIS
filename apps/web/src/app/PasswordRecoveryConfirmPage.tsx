import { ArrowRight, KeyRound, Mail, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { HelpdeskPasswordRecoveryPublicPayload } from "@tyr-ai/contracts";
import type { AuthResponse } from "./workspaceTypes";
import { ApiError, api, apiErrorMessage } from "../lib/api";
import { TyrLogo } from "../shared/TyrLogo";

export function PasswordRecoveryConfirmPage({ token, onAuthenticated }: { token: string; onAuthenticated: (result: AuthResponse) => Promise<void> }) {
  const [payload, setPayload] = useState<HelpdeskPasswordRecoveryPublicPayload | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError("");
      try {
        const data = await api<HelpdeskPasswordRecoveryPublicPayload>(`/api/helpdesk/password-recovery-intents/${encodeURIComponent(token)}`);
        if (cancelled) return;
        setPayload(data);
      } catch (err) {
        if (cancelled) return;
        const terminal = passwordRecoveryPayloadFromError(err);
        if (terminal) setPayload(terminal);
        else setError(apiErrorMessage(err, "Password reset link failed."));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function complete() {
    if (!payload?.email || payload.status !== "pending" || passwordValidationMessage) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<AuthResponse>(`/api/helpdesk/password-recovery-intents/${encodeURIComponent(token)}/complete`, {
        method: "POST",
        body: JSON.stringify({ password })
      });
      await onAuthenticated(data);
    } catch (err) {
      setError(apiErrorMessage(err, "Password reset failed."));
    } finally {
      setBusy(false);
    }
  }

  const unavailable = payload?.status && payload.status !== "pending";
  const passwordValidationMessage = passwordRecoveryValidationMessage(password, confirmPassword);
  const disabled = busy || !payload || payload.status !== "pending" || Boolean(passwordValidationMessage);

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
              <span className="auth-version">ACCOUNT</span>
            </div>
            <div className="auth-visual-copy">
              <p className="auth-visual-eyebrow"><Mail size={14} /> Secure email recovery</p>
              <h1>Reset your Tyr password.</h1>
              <p className="auth-visual-subhead">Use the email-confirmed link to set a new password and return to your workspace.</p>
            </div>
            <div className="auth-status-card" aria-hidden="true">
              <div className="auth-status-head">
                <span><KeyRound size={14} /> PASSWORD_RESET</span>
              </div>
              <div className="auth-status-row">
                <span><Mail size={14} /> Email</span>
                <b>{payload?.email ?? "Checking"}</b>
              </div>
            </div>
            <div className="auth-port-line">TYR HELPDESK</div>
          </section>
          <section className="auth-form-panel">
            <span className="auth-step-pill"><KeyRound size={14} /> Password Recovery</span>
            <h1>Set new password</h1>
            {payload?.email && <p className="auth-copy">Choose a new password for {payload.email}.</p>}
            {payload?.expiresAt && payload.status === "pending" && <p className="auth-copy">This link expires {new Date(payload.expiresAt).toLocaleString()}.</p>}
            {unavailable ? (
              <div className="login-error">{recoveryStatusMessage(payload.status)}</div>
            ) : (
              <>
                <label className="field-label">New password</label>
                <div className="auth-icon-field">
                  <KeyRound size={16} />
                  <input className="input auth-input" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" placeholder="Min 8 characters" />
                </div>
                <label className="field-label">Confirm password</label>
                <div className="auth-icon-field">
                  <KeyRound size={16} />
                  <input className="input auth-input" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" />
                </div>
                {passwordValidationMessage && (password || confirmPassword) && <p className="field-hint error">{passwordValidationMessage}</p>}
                <button className="btn primary auth-submit" disabled={disabled}>
                  {busy ? <RefreshCw size={16} /> : <ArrowRight size={16} />}
                  {busy ? "Setting password" : "Set new password"}
                </button>
              </>
            )}
            {error && <div className="login-error">{error}</div>}
          </section>
        </div>
      </form>
    </div>
  );
}

function passwordRecoveryPayloadFromError(error: unknown): HelpdeskPasswordRecoveryPublicPayload | null {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== "object") return null;
  const status = (error.details as { status?: unknown }).status;
  return status === "invalid" || status === "expired" || status === "completed"
    ? { status }
    : null;
}

function passwordRecoveryValidationMessage(password: string, confirmPassword: string): string {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password !== confirmPassword) return "Passwords do not match.";
  return "";
}

function recoveryStatusMessage(status: HelpdeskPasswordRecoveryPublicPayload["status"]): string {
  if (status === "expired") return "This password reset link has expired.";
  if (status === "completed") return "This password reset link has already been used.";
  if (status === "invalid") return "This password reset link is unavailable.";
  return "This password reset link is unavailable.";
}
