import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

type Preferences = { mode: "human" | "autonomous"; legacyDefault: boolean };
type PersonalRequest = { requestId: string; status: "waiting" | "answered" | "cancelled"; available: boolean;
  senderName: string; content: string; followups?: string[]; reply: string | null; createdAt: string; answeredAt: string | null; needsReview: boolean };

export function PersonalRepliesPanel({ serverId, owner }: { serverId: string; owner: boolean }) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [requests, setRequests] = useState<PersonalRequest[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const [nextPreferences, nextRequests] = await Promise.all([
          api<Preferences>("/api/personal-replies/preferences"),
          owner ? api<{ requests: PersonalRequest[] }>(`/api/servers/${encodeURIComponent(serverId)}/personal-replies`) : Promise.resolve({ requests: [] })
        ]);
        if (!cancelled) { setPreferences(nextPreferences); setRequests(nextRequests.requests); setError(""); }
      } catch { if (!cancelled) setError("Could not load personal replies. Please try again."); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [serverId, owner]);

  async function changeMode(mode: Preferences["mode"]) {
    setSaving(true);
    try { setPreferences(await api<Preferences>("/api/personal-replies/preferences", { method: "PATCH", body: JSON.stringify({ mode }) })); setError(""); }
    catch { setError("Could not save reply mode. Your previous setting is still active."); }
    finally { setSaving(false); }
  }
  return <section className="settings-card personal-replies-panel" id="personal-replies" aria-label="Personal replies">
    <header className="account-card-head"><span className="settings-card-title"><h3>Personal replies</h3><small>Choose who answers personal messages sent to you through a Workspace Bridge.</small></span></header>
    {preferences && <>
      <label className="personal-reply-field"><span className="field-label">Reply mode</span><select className="input" aria-label="Personal reply mode" value={preferences.mode} disabled={saving}
        onChange={(event) => void changeMode(event.target.value as Preferences["mode"])}>
        <option value="human">Human — I reply personally</option><option value="autonomous">Autonomous — TYR replies for me</option>
      </select></label>
    </>}
    <p className="personal-reply-help">Requests for your personal answer always come to you, even in Autonomous mode. Switching modes keeps your waiting messages. Agent tasks continue as usual.</p>
    {error && <p role="alert">{error}</p>}
    {owner && preferences && <PersonalReplyInbox requests={requests} onSent={(requestId, content) =>
      setRequests((current) => current.map((item) => item.requestId === requestId ? { ...item, status: "answered", reply: content } : item))} />}
  </section>;
}

export function PersonalReplyInbox({ requests, onSent }: { requests: PersonalRequest[]; onSent: (requestId: string, content: string) => void }) {
  const waiting = requests.filter((request) => request.status === "waiting");
  const history = requests.filter((request) => request.status !== "waiting");
  const card = (request: PersonalRequest) => <PersonalReplyCard key={request.requestId} request={request}
    onSent={(content) => onSent(request.requestId, content)} />;
  return <div className="personal-replies-list">
    <h4>Waiting for you ({waiting.length})</h4>
    {waiting.length ? waiting.map(card) : <p>No messages need your reply.</p>}
    {history.length > 0 && <details className="personal-replies-history">
      <summary>Reply history ({history.length})</summary>
      <div className="personal-replies-list">{history.map(card)}</div>
    </details>}
  </div>;
}

function PersonalReplyCard({ request, onSent }: { request: PersonalRequest; onSent: (content: string) => void }) {
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try {
      await api(`/api/personal-replies/${encodeURIComponent(request.requestId)}/reply`, { method: "POST", body: JSON.stringify({ content }) });
      onSent(content);
    } catch { setError("Could not send this reply. The request may already be answered or the Bridge may be unavailable."); }
    finally { setBusy(false); }
  }
  return <article className="personal-reply-card">
    <header><strong>From {request.senderName}</strong><span className={`settings-change-state ${request.status === "answered" ? "active" : "attention"}`}>{request.status === "answered" ? "Replied personally" : request.status === "cancelled" ? "Closed" : request.available ? "Waiting for you" : "Connection unavailable"}</span></header>
    <p className="personal-reply-content">{request.content}</p>
    {request.followups?.map((text, index) => <p key={index} className="personal-reply-content">Additional information: {text}</p>)}
    {request.needsReview && <p>TYR could not determine whether this needs your personal answer, so it has left it for your review.</p>}
    {request.status === "answered" ? <p className="personal-reply-content">Your reply: {request.reply}</p> : request.status === "waiting" && request.available && <>
      <label className="personal-reply-field"><span className="field-label">Your personal reply</span><textarea className="input" aria-label={`Your reply to ${request.senderName}`} rows={3} maxLength={12000}
        value={content} disabled={busy} onChange={(event) => setContent(event.target.value)} /></label>
      <p className="personal-reply-help">Your words will be sent directly to the original requester and labelled as your personal reply.</p>
      <button className="btn primary" type="button" disabled={busy || !content.trim()} onClick={() => void submit()}>{busy ? "Sending…" : "Send personal reply"}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </article>;
}
