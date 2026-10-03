import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { WorkspaceBridgeConnectionIntent, WorkspaceBridgeConnectionLink, WorkspaceBridgeRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";

const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;

type IntentRow = {
  id: string;
  source_workspace_id: string;
  source_workspace_name: string;
  invited_by_user_id: string;
  invited_by_display_name: string;
  status: WorkspaceBridgeConnectionIntent["status"];
  target_workspace_id: string | null;
  target_workspace_name: string | null;
  target_owner_display_name: string | null;
  claimed_by_user_id: string | null;
  bridge_id: string | null;
  created_at: string;
  expires_at: string;
  claimed_at: string | null;
  confirmed_at: string | null;
  recipient_user_id: string | null;
  recipient_email: string | null;
  delivery_status: WorkspaceBridgeConnectionIntent["deliveryStatus"];
};

const intentSelect = `select intent.*, source.name as source_workspace_name,
  inviter.display_name as invited_by_display_name,
  target.name as target_workspace_name,
  target_owner.display_name as target_owner_display_name,
  email.recipient_user_id, email.recipient_email, email.delivery_status
  from workspace_bridge_connection_intents intent
  join servers source on source.id = intent.source_workspace_id
  join users inviter on inviter.id = intent.invited_by_user_id
  left join servers target on target.id = intent.target_workspace_id
  left join users target_owner on target_owner.id = target.owner_user_id
  left join workspace_bridge_email_invitations email on email.intent_id = intent.id`;

export class BridgeConnectionError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}

function view(row: IntentRow): WorkspaceBridgeConnectionIntent {
  return {
    id: row.id,
    status: row.status !== "active" && row.status !== "cancelled" && row.expires_at <= new Date().toISOString()
      ? "expired" : row.status,
    sourceWorkspaceId: row.source_workspace_id,
    sourceWorkspaceName: row.source_workspace_name,
    invitedByUserId: row.invited_by_user_id,
    invitedByDisplayName: row.invited_by_display_name,
    targetWorkspaceId: row.target_workspace_id,
    targetWorkspaceName: row.target_workspace_name,
    targetOwnerDisplayName: row.target_owner_display_name,
    bridgeId: row.bridge_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    claimedAt: row.claimed_at,
    confirmedAt: row.confirmed_at,
    ...(row.recipient_email ? { invitationKind: "email" as const, deliveryStatus: row.delivery_status } : {})
  };
}

function codeHash(code: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new BridgeConnectionError("workspace_bridge_invite_not_found", 404);
  return createHash("sha256").update(code).digest("hex");
}

export class WorkspaceBridgeConnectionService {
  constructor(private readonly store: TyrDb, private readonly publicServerUrl: string) {}

  private rowById(id: string): IntentRow | undefined {
    return this.store.db.prepare(`${intentSelect} where intent.id = ?`).get(id) as IntentRow | undefined;
  }

  private membership(userId: string, workspaceId: string) {
    return this.store.listServersForUser(userId).find((workspace) => workspace.id === workspaceId);
  }

  create(sourceWorkspaceId: string, userId: string): WorkspaceBridgeConnectionLink {
    const membership = this.membership(userId, sourceWorkspaceId);
    if (!membership || membership.role === "guest") throw new BridgeConnectionError("workspace_bridge_member_required", 403);
    const openCount = this.store.db.prepare(`select count(*) as count from workspace_bridge_connection_intents
      where source_workspace_id = ? and invited_by_user_id = ? and status in ('pending', 'claimed') and expires_at > ?`)
      .get(sourceWorkspaceId, userId, new Date().toISOString()) as { count: number };
    if (openCount.count >= 5) throw new BridgeConnectionError("workspace_bridge_invite_limit", 429);
    const code = randomBytes(32).toString("base64url");
    const id = `bridge_invite_${randomUUID()}`;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + INVITE_LIFETIME_MS).toISOString();
    this.store.db.prepare(`insert into workspace_bridge_connection_intents
      (id, source_workspace_id, invited_by_user_id, code_hash, status, created_at, expires_at)
      values (?, ?, ?, ?, 'pending', ?, ?)`).run(id, sourceWorkspaceId, userId, codeHash(code), createdAt.toISOString(), expiresAt);
    return { ...view(this.rowById(id)!), url: `${this.publicServerUrl.replace(/\/$/, "")}/bridge/connect/${code}` };
  }

  getByCode(code: string, viewerUserId?: string): WorkspaceBridgeConnectionIntent {
    const row = this.store.db.prepare(`${intentSelect} where intent.code_hash = ?`).get(codeHash(code)) as IntentRow | undefined;
    if (!row) throw new BridgeConnectionError("workspace_bridge_invite_not_found", 404);
    if (row.recipient_email && viewerUserId !== row.recipient_user_id && viewerUserId !== row.invited_by_user_id) {
      throw new BridgeConnectionError("workspace_bridge_invite_recipient_required", 403);
    }
    const intent = view(row);
    if (!viewerUserId || !intent.targetWorkspaceId) return intent;
    const sourceMember = this.membership(viewerUserId, intent.sourceWorkspaceId);
    const targetMember = this.membership(viewerUserId, intent.targetWorkspaceId);
    return (sourceMember && sourceMember.role !== "guest") || targetMember?.role === "owner"
      ? intent
      : { ...intent, targetWorkspaceId: null, targetWorkspaceName: null, targetOwnerDisplayName: null, bridgeId: null };
  }

  list(sourceWorkspaceId: string, userId: string): WorkspaceBridgeConnectionIntent[] {
    const membership = this.membership(userId, sourceWorkspaceId);
    if (!membership || membership.role === "guest") throw new BridgeConnectionError("workspace_bridge_member_required", 403);
    return (this.store.db.prepare(`${intentSelect} where intent.source_workspace_id = ? and intent.status in ('pending', 'claimed') order by intent.created_at desc`)
      .all(sourceWorkspaceId) as IntentRow[]).map(view).filter((intent) => intent.status !== "expired");
  }

  getForSource(intentId: string, sourceWorkspaceId: string, userId: string): WorkspaceBridgeConnectionIntent {
    const membership = this.membership(userId, sourceWorkspaceId);
    if (!membership || membership.role === "guest") throw new BridgeConnectionError("workspace_bridge_member_required", 403);
    const row = this.rowById(intentId);
    if (!row || row.source_workspace_id !== sourceWorkspaceId) throw new BridgeConnectionError("workspace_bridge_invite_not_found", 404);
    if (row.invited_by_user_id !== userId && membership.role !== "owner") throw new BridgeConnectionError("workspace_bridge_invite_confirm_forbidden", 403);
    return view(row);
  }

  claim(code: string, targetWorkspaceId: string, userId: string): WorkspaceBridgeConnectionIntent {
    const target = this.membership(userId, targetWorkspaceId);
    if (!target || target.role !== "owner") throw new BridgeConnectionError("workspace_bridge_owner_required", 403);
    const hash = codeHash(code);
    const now = new Date().toISOString();
    const tx = this.store.db.transaction(() => {
      const row = this.store.db.prepare(`${intentSelect} where intent.code_hash = ?`).get(hash) as IntentRow | undefined;
      if (!row) throw new BridgeConnectionError("workspace_bridge_invite_not_found", 404);
      if (row.recipient_email && (row.recipient_user_id !== userId ||
          this.store.getUser(userId)?.email?.trim().toLowerCase() !== row.recipient_email)) {
        throw new BridgeConnectionError("workspace_bridge_invite_recipient_required", 403);
      }
      if (row.source_workspace_id === targetWorkspaceId) throw new BridgeConnectionError("cannot_bridge_same_workspace");
      if (row.recipient_user_id && row.status === "active" && row.target_workspace_id === targetWorkspaceId) return view(row);
      if (row.expires_at <= now) throw new BridgeConnectionError("workspace_bridge_invite_unavailable", 409);
      if (row.status === "claimed" && row.target_workspace_id === targetWorkspaceId) return view(row);
      if (row.status !== "pending") throw new BridgeConnectionError("workspace_bridge_invite_unavailable", 409);
      const updated = this.store.db.prepare(`update workspace_bridge_connection_intents
        set status = 'claimed', target_workspace_id = ?, claimed_by_user_id = ?, claimed_at = ?
        where id = ? and status = 'pending' and expires_at > ? and target_workspace_id is null`)
        .run(targetWorkspaceId, userId, now, row.id, now);
      if (updated.changes !== 1) throw new BridgeConnectionError("workspace_bridge_invite_unavailable", 409);
      // 定向邀请在创建时已记录发起人同意；只由绑定收件人接受，不再要求发起人确认。
      if (row.recipient_user_id) return this.confirm(row.id, row.source_workspace_id, row.invited_by_user_id).intent;
      return view(this.rowById(row.id)!);
    });
    return tx();
  }

  confirm(intentId: string, sourceWorkspaceId: string, userId: string): { intent: WorkspaceBridgeConnectionIntent; bridge: WorkspaceBridgeRecord } {
    const membership = this.membership(userId, sourceWorkspaceId);
    if (!membership || membership.role === "guest") throw new BridgeConnectionError("workspace_bridge_member_required", 403);
    const now = new Date().toISOString();
    const tx = this.store.db.transaction(() => {
      const row = this.rowById(intentId);
      if (!row || row.source_workspace_id !== sourceWorkspaceId) throw new BridgeConnectionError("workspace_bridge_invite_not_found", 404);
      if (row.invited_by_user_id !== userId && membership.role !== "owner") throw new BridgeConnectionError("workspace_bridge_invite_confirm_forbidden", 403);
      if (row.status === "active" && row.bridge_id) {
        const bridge = this.store.getWorkspaceBridgeForServer(row.bridge_id, sourceWorkspaceId);
        if (bridge) return { intent: view(row), bridge };
      }
      if (row.status !== "claimed" || !row.target_workspace_id || row.expires_at <= now) {
        throw new BridgeConnectionError("workspace_bridge_invite_unavailable", 409);
      }
      const targetOwner = this.store.db.prepare(`select owner_user_id as id from servers where id = ?`).get(row.target_workspace_id) as { id: string } | undefined;
      if (!targetOwner || targetOwner.id !== row.claimed_by_user_id) throw new BridgeConnectionError("workspace_bridge_owner_required", 403);
      if (row.recipient_user_id && targetOwner.id !== row.recipient_user_id) throw new BridgeConnectionError("workspace_bridge_invite_recipient_required", 403);
      const existing = this.store.listWorkspaceBridges(sourceWorkspaceId).find((bridge) => bridge.status === "active" &&
        (bridge.workspaceAId === row.target_workspace_id || bridge.workspaceBId === row.target_workspace_id));
      if (existing) {
        if (!row.recipient_user_id) throw new BridgeConnectionError("workspace_bridge_already_connected", 409);
        this.store.db.prepare(`update workspace_bridge_connection_intents set status = 'active', bridge_id = ?, confirmed_at = ? where id = ?`)
          .run(existing.id, now, row.id);
        return { intent: view(this.rowById(row.id)!), bridge: existing };
      }
      const bridgeId = `bridge_${randomUUID()}`;
      this.store.ensureDefaultCommunicationAgent(sourceWorkspaceId);
      this.store.ensureDefaultCommunicationAgent(row.target_workspace_id);
      this.store.db.prepare(`insert into workspace_bridges
        (id, workspace_a_id, workspace_b_id, status, direction, scope, permissions_json,
         invited_by_user_id, approved_by_a_user_id, approved_by_b_user_id, created_at, accepted_at, last_activity_at)
        values (?, ?, ?, 'active', 'bidirectional', 'workspace_topology', ?, ?, ?, ?, ?, ?, ?)`)
        .run(bridgeId, sourceWorkspaceId, row.target_workspace_id,
          JSON.stringify(["chat", "task_delegation", "topology_read"]), row.invited_by_user_id, userId, targetOwner.id, now, now, now);
      this.store.getOrCreateWorkspaceBridgeDm(bridgeId, sourceWorkspaceId);
      this.store.getOrCreateWorkspaceBridgeDm(bridgeId, row.target_workspace_id);
      this.store.db.prepare(`update workspace_bridge_connection_intents set status = 'active', bridge_id = ?, confirmed_at = ? where id = ?`)
        .run(bridgeId, now, row.id);
      this.store.recordAuditEvent({
        kind: "workspace_bridge_connection_confirmed",
        actorType: "user",
        actorId: row.recipient_user_id ?? userId,
        resourceType: "workspace_bridge",
        resourceId: bridgeId,
        serverId: sourceWorkspaceId,
        metadata: { intentId: row.id, sourceWorkspaceId, targetWorkspaceId: row.target_workspace_id, claimedByUserId: row.claimed_by_user_id, invitedByUserId: row.invited_by_user_id }
      });
      return { intent: view(this.rowById(row.id)!), bridge: this.store.getWorkspaceBridgeForServer(bridgeId, sourceWorkspaceId)! };
    });
    return tx();
  }

  cancel(intentId: string, sourceWorkspaceId: string, userId: string): WorkspaceBridgeConnectionIntent {
    const membership = this.membership(userId, sourceWorkspaceId);
    if (!membership || membership.role === "guest") throw new BridgeConnectionError("workspace_bridge_member_required", 403);
    const row = this.rowById(intentId);
    if (!row || row.source_workspace_id !== sourceWorkspaceId) throw new BridgeConnectionError("workspace_bridge_invite_not_found", 404);
    if (row.invited_by_user_id !== userId && membership.role !== "owner") throw new BridgeConnectionError("workspace_bridge_invite_confirm_forbidden", 403);
    if (row.status !== "pending" && row.status !== "claimed") throw new BridgeConnectionError("workspace_bridge_invite_unavailable", 409);
    this.store.db.prepare(`update workspace_bridge_connection_intents set status = 'cancelled', cancelled_at = ? where id = ?`).run(new Date().toISOString(), intentId);
    return view(this.rowById(intentId)!);
  }
}
