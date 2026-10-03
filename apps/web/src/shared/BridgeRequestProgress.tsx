import React, { useState } from "react";
import type { WorkspaceBridgeRequestStatusPayload } from "@tyr-ai/contracts";

export function BridgeRequestProgress({ status }: { status: WorkspaceBridgeRequestStatusPayload }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const progress = status.progress;
  if (!progress) return null;
  return <details className="workspace-bridge-progress" data-attention={status.state === "needs_attention"}>
    <summary>{status.state === "needs_attention" ? "Needs attention" : "View progress"}</summary>
    <p>{progress.summary}</p>
    <small>Last progress: <time dateTime={progress.lastEventAt}>{new Date(progress.lastEventAt).toLocaleString()}</time></small>
    <ol>{progress.events.map((event, index) => <li key={`${event.kind}:${event.at}:${index}`}>
      <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString()}</time> {event.label}
    </li>)}</ol>
    <small>Diagnostic ID: <code>{progress.diagnosticId}</code></small>
    <button className="btn" type="button" onClick={() => {
      if (!navigator.clipboard) { setCopyError(true); return; }
      void navigator.clipboard.writeText(`Bridge request: ${status.bridgeRequestId}\nDiagnostic ID: ${progress.diagnosticId}`)
        .then(() => { setCopied(true); setCopyError(false); }).catch(() => setCopyError(true));
    }}>{copied ? "Copied" : "Copy diagnostic ID"}</button>
    {copyError && <small role="alert">Could not copy. Select the diagnostic ID above to copy it.</small>}
  </details>;
}
