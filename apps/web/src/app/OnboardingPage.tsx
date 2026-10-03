import { CheckCircle2, Copy, HardDrive, RefreshCw, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MachineOnboardingPublicPayload } from "@tyr-ai/contracts";
import { ApiError, api, apiErrorMessage } from "../lib/api";
import { TyrLogo } from "../shared/TyrLogo";

export function OnboardingPage({ code }: { code: string }) {
  const [payload, setPayload] = useState<MachineOnboardingPublicPayload | null>(null);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const platform = useMemo(() => currentPlatform(), []);
  const command = platform === "windows" ? payload?.windowsInstallCommand : payload?.installCommand;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError("");
      try {
        const data = await api<MachineOnboardingPublicPayload>(`/api/onboarding/machines/${encodeURIComponent(code)}`);
        if (cancelled) return;
        setPayload(data);
      } catch (err) {
        if (cancelled) return;
        const terminal = onboardingPayloadFromError(err);
        if (terminal) setPayload(terminal);
        else setError(apiErrorMessage(err, "Onboarding link failed."));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function copyCommand() {
    if (!command) return;
    await copyText(command);
    setCopyStatus("Install command copied.");
    window.setTimeout(() => setCopyStatus(""), 2200);
  }

  const status = payload?.status ?? (error ? "invalid" : "pending");
  const unavailable = status !== "pending";

  return (
    <div className="auth-page auth-loading-page onboarding-page">
      <section className="auth-card onboarding-card">
        <div className="auth-logo"><TyrLogo /></div>
        <p className="auth-tagline">CONNECT DEVICE</p>
        <h1>{payload?.machineName ?? "Device onboarding"}</h1>
        {payload?.serverName && <p className="auth-copy">Join {payload.serverName}.</p>}
        {payload?.expiresAt && <p className="auth-copy">This link expires {new Date(payload.expiresAt).toLocaleString()}.</p>}
        {unavailable ? (
          <div className="login-error">{statusMessage(status, error)}</div>
        ) : command ? (
          <div className="onboarding-command-panel">
            <div className="onboarding-command-head">
              {platform === "windows" ? <Terminal size={17} /> : <HardDrive size={17} />}
              <b>{platform === "windows" ? "Windows PowerShell" : "macOS / Linux"}</b>
            </div>
            <pre className="command-box onboarding-command-box">{command}</pre>
            <button className="btn primary" type="button" onClick={() => void copyCommand()}>
              {copyStatus ? <CheckCircle2 size={16} /> : <Copy size={16} />}
              {copyStatus || "Copy install command"}
            </button>
          </div>
        ) : (
          <div className="auth-loading-line" />
        )}
        <button className="btn auth-secondary" type="button" onClick={() => window.location.reload()}>
          <RefreshCw size={16} /> Refresh
        </button>
      </section>
    </div>
  );
}

function onboardingPayloadFromError(error: unknown): MachineOnboardingPublicPayload | null {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== "object") return null;
  const status = (error.details as { status?: unknown }).status;
  return status === "invalid" || status === "expired" || status === "consumed" || status === "revoked"
    ? { status }
    : null;
}

function currentPlatform(): "windows" | "unix" {
  if (typeof navigator === "undefined") return "unix";
  const raw = `${navigator.userAgent} ${navigator.platform}`;
  return /\bwin/i.test(raw) ? "windows" : "unix";
}

function statusMessage(status: MachineOnboardingPublicPayload["status"], fallback: string): string {
  if (status === "expired") return "This onboarding link has expired.";
  if (status === "consumed") return "This onboarding link has already been used.";
  if (status === "revoked") return "This onboarding link was revoked.";
  if (status === "invalid") return fallback || "This onboarding link is unavailable.";
  return "This onboarding link is unavailable.";
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
