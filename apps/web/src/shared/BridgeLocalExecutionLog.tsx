import React, { useEffect, useRef, useState } from "react";
import type { WorkspaceBridgeLocalExecutionLog } from "@tyr-ai/contracts";
import { api } from "../lib/api";

export function BridgeLocalExecutionLog({ serverId, bridgeId, requestId }: {
  serverId: string; bridgeId: string; requestId: string;
}) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<WorkspaceBridgeLocalExecutionLog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const endpoint = `/api/servers/${encodeURIComponent(serverId)}/workspace-bridges/${encodeURIComponent(bridgeId)}/requests/${encodeURIComponent(requestId)}/local-execution-log`;
  useEffect(() => () => controller.current?.abort(), [endpoint]);

  async function load(append = false) {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true); setError("");
    try {
      const offset = append && log ? log.pageInfo.offset + log.entries.length : 0;
      const next = await api<WorkspaceBridgeLocalExecutionLog>(`${endpoint}?offset=${offset}&limit=100`, { signal: pending.signal });
      if (pending.signal.aborted) return;
      setLog((previous) => append && previous ? {
        ...next, entries: [...previous.entries, ...next.entries], pageInfo: { ...next.pageInfo, offset: 0 }
      } : next);
    } catch {
      if (!pending.signal.aborted) { setLog(null); setError("Could not load local logs. Access is limited to this workspace's Owner."); }
    } finally { if (!pending.signal.aborted) setBusy(false); }
  }

  async function download() {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true); setError("");
    try {
      const exported = await api<WorkspaceBridgeLocalExecutionLog>(`${endpoint}?limit=200`, { signal: pending.signal });
      let page = exported;
      const entryCount = exported.pageInfo.total;
      while (exported.entries.length < entryCount) {
        if (!page.entries.length) throw new Error("incomplete_log_export");
        page = await api<WorkspaceBridgeLocalExecutionLog>(`${endpoint}?offset=${exported.entries.length}&limit=${Math.min(200, entryCount - exported.entries.length)}`, { signal: pending.signal });
        exported.entries.push(...page.entries);
      }
      if (pending.signal.aborted) return;
      exported.pageInfo = { offset: 0, limit: exported.entries.length, total: exported.entries.length, hasMore: false };
      const url = URL.createObjectURL(new Blob([JSON.stringify({ ...exported, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `bridge-local-log-${requestId}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (!pending.signal.aborted) { setLog(null); setError("Could not export the complete local log. Refresh and try again."); }
    } finally { if (!pending.signal.aborted) setBusy(false); }
  }

  return <section className="bridge-local-log">
    <button type="button" className="btn small" aria-expanded={open} onClick={() => {
      if (open) { controller.current?.abort(); setBusy(false); setLog(null); setError(""); }
      else void load();
      setOpen(!open);
    }}>{open ? "Hide local execution logs" : "View local execution logs"}</button>
    {open && <div>
      <p><strong>Owner only · Local workspace</strong><br />These logs are not shared in the Bridge conversation. Credentials are redacted.</p>
      <div className="bridge-local-log-actions">
        <button type="button" className="btn small" disabled={busy} onClick={() => void load()}>Refresh</button>
        <button type="button" className="btn small" disabled={busy || !log} onClick={() => void download()}>Export local logs</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {log && <>
        <p>Diagnostic ID: <code>{log.diagnosticId}</code></p>
        {log.executions.length === 0 && <p>No local Agent execution has been recorded for this request.</p>}
        {log.executions.map((execution) => <p key={execution.id}>
          <strong>{execution.agentName}</strong> · {execution.status}<br /><code>{execution.id}</code>
          {execution.instructionsRevision !== undefined && <small> · Owner instructions revision {execution.instructionsRevision}</small>}
        </p>)}
        <ol className="bridge-local-log-entries">{log.entries.map((entry) => <li key={entry.id}>
          <details><summary><time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time> · {entry.title}</summary>
            {entry.executionId && <small>Execution: <code>{entry.executionId}</code></small>}
            {entry.content && <pre>{entry.content}</pre>}
            {entry.data !== undefined && <pre>{JSON.stringify(entry.data, null, 2)}</pre>}
          </details>
        </li>)}</ol>
        <small>{log.entries.length} of {log.pageInfo.total} recorded entries</small>
        {log.pageInfo.hasMore && <button type="button" className="btn small" disabled={busy} onClick={() => void load(true)}>Load more logs</button>}
      </>}
      {busy && <p role="status">Loading local logs…</p>}
    </div>}
  </section>;
}
