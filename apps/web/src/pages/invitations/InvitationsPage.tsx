import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeftRight, ArrowRight, Building2, Check, Copy, MoreHorizontal, Network, Plus, QrCode, Trash2 } from "lucide-react";
import type { AppSnapshot, WorkspaceBridgeConnectionIntent, WorkspaceBridgeConnectionLink, WorkspaceBridgeRecord } from "@tyr-ai/contracts";
import { api, apiErrorMessage } from "../../lib/api";
import { TopBar, type WorkspaceTopBarProps } from "../../shared/ui";

type WorkspaceActionKind = "workspace-invite" | "workspace-accept" | "workspace-revoke";
type BusyWorkspaceAction = "" | `${WorkspaceActionKind}:${string}`;

export function InvitationsPage({
  snapshot,
  topbarProps,
  workspaceBridges,
  incomingWorkspaceBridges: incomingBridgeRequests,
  onInviteWorkspace,
  onAcceptWorkspaceBridge,
  onRevokeWorkspaceBridge,
  onOpenWorkspaceBridge,
  onRefresh
}: {
  snapshot: AppSnapshot;
  topbarProps: WorkspaceTopBarProps;
  workspaceBridges: WorkspaceBridgeRecord[];
  incomingWorkspaceBridges: WorkspaceBridgeRecord[];
  onInviteWorkspace: (email: string) => Promise<void>;
  onAcceptWorkspaceBridge: (bridge: WorkspaceBridgeRecord) => Promise<void>;
  onRevokeWorkspaceBridge: (bridge: WorkspaceBridgeRecord) => Promise<void>;
  onOpenWorkspaceBridge: (bridge: WorkspaceBridgeRecord) => void;
  onRefresh: () => Promise<void>;
}) {
  const [busyAction, setBusyAction] = useState<BusyWorkspaceAction>("");
  const [actionError, setActionError] = useState("");
  const [workspaceInviteEmail, setWorkspaceInviteEmail] = useState("");
  const [connectionLink, setConnectionLink] = useState<WorkspaceBridgeConnectionLink | null>(null);
  const [connectionQr, setConnectionQr] = useState("");
  const [connectionIntents, setConnectionIntents] = useState<WorkspaceBridgeConnectionIntent[]>([]);
  const [linkCopied, setLinkCopied] = useState(false);
  const busy = Boolean(busyAction);
  const currentWorkspaceName = snapshot.currentServer?.name ?? "Current workspace";
  const canRevokeWorkspaceBridge = snapshot.currentServer?.role === "owner";
  const canUseWorkspaceBridges = canRevokeWorkspaceBridge || snapshot.currentServer?.role === "member";
  // 角色切换期间也不能用旧快照向 Guest 展示 Bridge 数据和操作入口。
  const incomingWorkspaceBridges = canUseWorkspaceBridges ? incomingBridgeRequests : [];
  // Revoked Bridge 仅保留历史关联，不能继续作为客户可见的 Workspace 连接展示。
  const visibleWorkspaceBridges = canUseWorkspaceBridges ? workspaceBridges.filter((bridge) => bridge.status !== "revoked") : [];
  const activeWorkspaceBridgeCount = visibleWorkspaceBridges.filter((bridge) => bridge.status === "active").length;
  const serverId = snapshot.currentServer?.id;

  useEffect(() => {
    if (!serverId || !canUseWorkspaceBridges) return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api<{ intents: WorkspaceBridgeConnectionIntent[] }>(`/api/servers/${encodeURIComponent(serverId)}/workspace-bridge-invites`);
        if (!cancelled) setConnectionIntents(data.intents);
      } catch { if (!cancelled) setConnectionIntents([]); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [serverId, canUseWorkspaceBridges]);

  useEffect(() => {
    if (!connectionLink?.url) { setConnectionQr(""); return; }
    let cancelled = false;
    void QRCode.toDataURL(connectionLink.url, { margin: 1, width: 220 }).then((url) => {
      if (!cancelled) setConnectionQr(url);
    });
    return () => { cancelled = true; };
  }, [connectionLink?.url]);

  async function reloadIntents() {
    if (!serverId) return;
    const data = await api<{ intents: WorkspaceBridgeConnectionIntent[] }>(`/api/servers/${encodeURIComponent(serverId)}/workspace-bridge-invites`);
    setConnectionIntents(data.intents);
  }

  async function runWorkspaceAction(kind: WorkspaceActionKind, actionId: string, action: () => Promise<void>) {
    setBusyAction(`${kind}:${actionId}`);
    setActionError("");
    try {
      await action();
    } catch (err) {
      // ApiError 已按稳定 code 映射文案，不再把翻译后的 message 当作错误码判断。
      setActionError(`Workspace connection failed: ${apiErrorMessage(err)}`);
    } finally {
      setBusyAction("");
    }
  }

  function actionBusy(kind: WorkspaceActionKind, actionId: string): boolean {
    return busyAction === `${kind}:${actionId}`;
  }

  return (
    <div className="view invitations-view">
      <TopBar title="Workspace Connections" {...topbarProps} />
      <div className="settings-page invitations-page">
        <div className="invitations-page-head">
          <div>
            <h2>Workspace Bridges</h2>
            <p>Connect TYR to another workspace without sharing members, private conversations, or Agents.</p>
          </div>
          <div className="workspace-bridges-page-stats" aria-label={`${activeWorkspaceBridgeCount} connected workspaces, ${incomingWorkspaceBridges.length} pending requests`}>
            <span className="active"><b>{activeWorkspaceBridgeCount}</b><small>connected</small></span>
            <span className={incomingWorkspaceBridges.length > 0 ? "pending attention" : "pending"}><b>{incomingWorkspaceBridges.length}</b><small>pending</small></span>
          </div>
        </div>

        {actionError && <div className="invite-action-feedback" role="status">{actionError}</div>}

        <div className="workspace-connections-layout">
          {canUseWorkspaceBridges && <section className="settings-card workspace-bridge-create-panel">
            <div className="workspace-bridge-section-head">
              <span className="workspace-bridge-section-icon"><Plus size={16} /></span>
              <span>
                <b>Create a bridge</b>
                <small>Connect to another workspace through TYR.</small>
              </span>
            </div>
            <div className="workspace-bridge-create-flow">
              <div className="workspace-bridge-endpoint current">
                <span className="workspace-bridge-endpoint-icon"><Building2 size={17} /></span>
                <span>
                  <small>Current workspace</small>
                  <b>{currentWorkspaceName}</b>
                </span>
              </div>
              <div className="workspace-bridge-rail" aria-hidden="true">
                <span className="workspace-bridge-rail-line" />
                <span className="workspace-bridge-rail-label">TYR</span>
                <span className="workspace-bridge-rail-line target"><ArrowRight size={13} /></span>
              </div>
              <div className="workspace-bridge-link-actions">
                <button className="btn primary" type="button" disabled={busy || !serverId} onClick={() => void runWorkspaceAction("workspace-invite", "link", async () => {
                  const data = await api<{ intent: WorkspaceBridgeConnectionLink }>(`/api/servers/${encodeURIComponent(serverId!)}/workspace-bridge-invites`, { method: "POST" });
                  setConnectionLink(data.intent);
                  setLinkCopied(false);
                  await reloadIntents();
                })}><QrCode size={16} /> Create connection link</button>
                <small>Share the link or QR with the other Workspace Owner. No email needed.</small>
              </div>
              {connectionLink && <div className="workspace-bridge-share-card">
                {connectionQr && <img src={connectionQr} alt="Scan to review this Workspace connection" width={190} height={190} />}
                <div>
                  <b>Connection link ready</b>
                  <p>Expires {new Date(connectionLink.expiresAt).toLocaleString()}. You will confirm the recipient before this Bridge becomes active.</p>
                  <a href={connectionLink.url} target="_blank" rel="noreferrer">{connectionLink.url}</a>
                  <button className="btn small" type="button" onClick={() => void navigator.clipboard.writeText(connectionLink.url).then(() => setLinkCopied(true)).catch(() => setActionError("Copy failed. Select the link above to share it."))}>
                    <Copy size={14} /> {linkCopied ? "Copied" : "Copy link"}
                  </button>
                </div>
              </div>}
              <details className="workspace-bridge-email-fallback"><summary>Invite by owner email instead</summary>
              <form className="workspace-bridge-target-form" onSubmit={(event) => {
                event.preventDefault();
                if (busy || !workspaceInviteEmail.trim()) return;
                void runWorkspaceAction("workspace-invite", workspaceInviteEmail, async () => {
                  await onInviteWorkspace(workspaceInviteEmail);
                  setWorkspaceInviteEmail("");
                });
              }}>
                <label htmlFor="workspace-bridge-peer-email">Workspace owner email</label>
                <div>
                  <input
                    id="workspace-bridge-peer-email"
                    className="input"
                    type="email"
                    autoComplete="email"
                    value={workspaceInviteEmail}
                    onChange={(event) => setWorkspaceInviteEmail(event.target.value)}
                    placeholder="peer@example.com"
                  />
                  <button className="btn primary" type="submit" disabled={busy || !workspaceInviteEmail.trim()}>
                    <Plus size={15} /> Connect workspace
                  </button>
                </div>
              </form>
              </details>
            </div>
          </section>}

          {canUseWorkspaceBridges && connectionIntents.length > 0 && <section className="settings-card workspace-bridge-list-panel pending">
            <div className="workspace-bridge-list-head"><span><b>Connection links</b><small>Email invitations connect on acceptance. Shared links need your review.</small></span><em>{connectionIntents.length}</em></div>
            <div className="workspace-bridge-list">{connectionIntents.map((intent) => <div className="workspace-bridge-list-row pending" key={intent.id}>
              <span className="workspace-bridge-row-icon"><QrCode size={17} /></span>
              <span className="workspace-bridge-row-copy"><b>{intent.status === "claimed" ? intent.targetWorkspaceName : "Waiting for recipient"}</b>
                <small>{intent.invitationKind === "email" ? `Email ${intent.deliveryStatus}. Connects when the recipient accepts. Expires ${new Date(intent.expiresAt).toLocaleString()}` : intent.status === "claimed" ? `Owner: ${intent.targetOwnerDisplayName}. Confirm only if this is the Workspace you intended.` : `Expires ${new Date(intent.expiresAt).toLocaleString()}`}</small>
              </span>
              <span className="workspace-bridge-row-actions">
                {intent.status === "claimed" && <button className="btn primary small" type="button" disabled={busy} onClick={() => void runWorkspaceAction("workspace-accept", intent.id, async () => {
                  await api(`/api/servers/${encodeURIComponent(serverId!)}/workspace-bridge-invites/${encodeURIComponent(intent.id)}/confirm`, { method: "POST" });
                  await reloadIntents();
                  await onRefresh();
                })}><Check size={14} /> Confirm connection</button>}
                <button className="btn small" type="button" disabled={busy} onClick={() => void runWorkspaceAction("workspace-revoke", intent.id, async () => {
                  await api(`/api/servers/${encodeURIComponent(serverId!)}/workspace-bridge-invites/${encodeURIComponent(intent.id)}/cancel`, { method: "POST" });
                  await reloadIntents();
                })}>Cancel</button>
              </span>
            </div>)}</div>
          </section>}

          {incomingWorkspaceBridges.length > 0 && (
            <section className="settings-card workspace-bridge-list-panel pending">
              <div className="workspace-bridge-list-head">
                <span>
                  <b>Pending requests</b>
                  <small>Review workspace connections waiting for you.</small>
                </span>
                <em>{incomingWorkspaceBridges.length}</em>
              </div>
              <div className="workspace-bridge-list">
                {incomingWorkspaceBridges.map((bridge) => (
                  <div key={bridge.id} className="workspace-bridge-list-row pending">
                    <span className="workspace-bridge-row-icon"><Building2 size={17} /></span>
                    <span className="workspace-bridge-row-copy">
                      <b>{bridge.peerWorkspace?.name ?? "Peer workspace"}</b>
                      <small>Invited by {bridge.invitedByDisplayName}</small>
                    </span>
                    <span className="workspace-bridge-row-actions">
                      <button
                        className="btn primary small"
                        disabled={busy}
                        onClick={() => void runWorkspaceAction("workspace-accept", bridge.id, () => onAcceptWorkspaceBridge(bridge))}
                      >
                        <Check size={14} /> {actionBusy("workspace-accept", bridge.id) ? "Accepting" : "Accept"}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="settings-card workspace-bridge-list-panel connected">
            <div className="workspace-bridge-list-head">
              <span>
                <b>Connected workspaces</b>
                <small>Manage the workspaces connected through TYR.</small>
              </span>
              <em>{activeWorkspaceBridgeCount}</em>
            </div>
            {visibleWorkspaceBridges.length === 0 ? (
              <div className="workspace-bridge-empty-row">
                <span><Network size={19} /></span>
                <div>
                  <b>No connected workspaces yet.</b>
                  {canUseWorkspaceBridges && <p>Create a bridge above to connect TYR to another workspace.</p>}
                </div>
              </div>
            ) : (
              <div className="workspace-bridge-list">
                {visibleWorkspaceBridges.map((bridge) => {
                  const peerWorkspaceName = bridge.peerWorkspace?.name ?? "Peer workspace";
                  return (
                    <div key={bridge.id} className="workspace-bridge-list-row connected">
                      <span className="workspace-bridge-row-icon"><Network size={17} /></span>
                      <span className="workspace-bridge-row-copy">
                        <b className="workspace-bridge-route">
                          <span>{currentWorkspaceName}</span>
                          {bridge.direction === "bidirectional" ? <ArrowLeftRight size={14} /> : <ArrowRight size={14} />}
                          <span>{peerWorkspaceName}</span>
                        </b>
                        <small className="workspace-bridge-route-meta">
                          <span className={`workspace-bridge-row-state ${bridge.status}`}>{bridge.status}</span>
                          <span>{bridge.direction === "bidirectional" ? "Two-way" : "One-way"}</span>
                          <span>TYR bridge</span>
                        </small>
                      </span>
                      <span className="workspace-bridge-row-actions">
                        <button className="btn small" disabled={busy} onClick={() => onOpenWorkspaceBridge(bridge)}>View details</button>
                        {canRevokeWorkspaceBridge && bridge.status !== "revoked" && (
                          <details className="workspace-bridge-action-menu">
                            <summary aria-label={`Actions for ${peerWorkspaceName}`} title="More actions"><MoreHorizontal size={17} /></summary>
                            <div>
                              <button
                                className="danger"
                                type="button"
                                disabled={busy}
                                onClick={(event) => {
                                  event.currentTarget.closest("details")?.removeAttribute("open");
                                  void runWorkspaceAction("workspace-revoke", bridge.id, () => onRevokeWorkspaceBridge(bridge));
                                }}
                              >
                                <Trash2 size={14} /> {actionBusy("workspace-revoke", bridge.id) ? "Revoking" : "Revoke connection"}
                              </button>
                            </div>
                          </details>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
