import type { MessageRecord, WorkspaceBridgeConnectionIntent } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import { BridgeConnectionError, WorkspaceBridgeConnectionService } from "./workspace-bridge-connection-intent";
import { sendCommunicationReturnExternal, type CommunicationReturnExternalInput } from "./communication-return-external";
import {
  resendHelpdeskConfigFromEnv, resendHelpdeskConfigured, sendWorkspaceBridgeInvitationEmail,
  type ResendHelpdeskConfig, type WorkspaceBridgeInvitationEmail
} from "./resend-helpdesk";

type Origin = {
  serverId: string; userId: string; sourceMessageId: string; channelId: string;
  conversationId?: string; source: "web" | "telegram" | "email"; externalRef?: string;
};
type EmailRow = {
  intent_id: string; recipient_user_id: string | null; recipient_email: string; sender_address: string; sender_name: string | null;
  origin_message_id: string; origin_channel_id: string; origin_conversation_id: string;
  origin_source: Origin["source"]; origin_external_ref: string | null;
  email_subject: string; email_text: string | null; delivery_status: string;
  delivery_attempts: number; next_attempt_at: string; lease_until: string | null;
  source_workspace_id: string; invited_by_user_id: string; expires_at: string;
};
type NoticeRow = { intent_id: string; kind: string; content: string; message_id: string | null; attempts: number };
type Dependencies = {
  store: TyrDb; publicServerUrl: string; emitRealtimeMessage: (message: MessageRecord) => void;
  emailConfig?: ResendHelpdeskConfig;
  sendEmail?: (config: ResendHelpdeskConfig, input: WorkspaceBridgeInvitationEmail) => Promise<string>;
  sendNotice?: (input: CommunicationReturnExternalInput) => ReturnType<typeof sendCommunicationReturnExternal>;
};
const emailSelect = `select email.*, intent.source_workspace_id, intent.invited_by_user_id, intent.expires_at
  from workspace_bridge_email_invitations email join workspace_bridge_connection_intents intent on intent.id = email.intent_id`;
const nowIso = () => new Date().toISOString();
const retryAt = (attempt: number) => new Date(Date.now() + Math.min(300_000, 5_000 * 2 ** attempt)).toISOString();

/** 持久化邀请投递和原会话通知；重启不改收件人、邮件正文或返回路线。 */
export class WorkspaceBridgeEmailInvitations {
  private readonly connections: WorkspaceBridgeConnectionService;
  private draining = false;
  constructor(private readonly deps: Dependencies) {
    this.connections = new WorkspaceBridgeConnectionService(deps.store, deps.publicServerUrl);
  }
  private get store() { return this.deps.store; }
  private config() { return this.deps.emailConfig ?? resendHelpdeskConfigFromEnv(this.deps.publicServerUrl); }
  private row(id: string) { return this.store.db.prepare(`${emailSelect} where email.intent_id = ?`).get(id) as EmailRow | undefined; }

  async invite(origin: Origin, address: string): Promise<WorkspaceBridgeConnectionIntent> {
    if (!resendHelpdeskConfigured(this.config())) throw new BridgeConnectionError("workspace_bridge_email_not_configured", 503);
    const email = address.trim().toLowerCase();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.length > 254) throw new BridgeConnectionError("invalid_email");
    const source = this.store.getMessage(origin.sourceMessageId);
    const assistant = this.store.ensureDefaultCommunicationAgent(origin.serverId);
    const dm = this.store.getOrCreateAgentDm(assistant.id, origin.userId);
    if (!source || source.deletedAt || source.senderType !== "human" || source.senderId !== origin.userId ||
        source.channelId !== origin.channelId || dm?.id !== origin.channelId || !source.conversationId ||
        (origin.conversationId && origin.conversationId !== source.conversationId) ||
        !this.store.canUserAccessChannel(origin.userId, origin.channelId)) {
      throw new BridgeConnectionError("workspace_bridge_local_human_required", 403);
    }
    const recipient = this.store.findUser(email);
    if (recipient && (recipient.email?.trim().toLowerCase() !== email ||
        !this.store.listServersForUser(recipient.id).some((server) => server.role === "owner" && server.id !== origin.serverId))) {
      throw new BridgeConnectionError("workspace_bridge_existing_owner_required");
    }
    if (recipient?.id === origin.userId) throw new BridgeConnectionError("workspace_bridge_self_invite");
    const id = this.store.db.transaction(() => {
      const previous = this.store.db.prepare(`select intent_id from workspace_bridge_email_invitations
        where origin_message_id = ? and recipient_email = ?`).get(source.id, email) as { intent_id: string } | undefined;
      if (previous) return previous.intent_id;
      const link = this.connections.create(origin.serverId, origin.userId);
      const alias = this.store.ensureCommunicationAgentEmailAlias({ serverId: origin.serverId, userId: origin.userId,
        assistantAgentId: assistant.id, domain: "agent.tyr.ai" });
      const subject = "Workspace Bridge invitation";
      this.store.db.prepare(`insert into workspace_bridge_email_invitations
        (intent_id, recipient_user_id, recipient_email, sender_address, origin_message_id, origin_channel_id,
         origin_conversation_id, origin_source, origin_external_ref, email_subject, next_attempt_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(link.id, recipient?.id ?? null, email, alias.address,
          source.id, source.channelId, source.conversationId, origin.source, origin.externalRef ?? null, subject, nowIso());
      const returnPath = `/bridge/connect/${link.url.split("/").at(-1)!}`;
      const signup = recipient ? null : this.store.createHelpdeskSignupIntent({ email, source: "email",
        subject, returnPath, expiresAt: link.expiresAt });
      // Only the recipient receives the signup bearer link; tool output never exposes it.
      const invitationUrl = signup
        ? `${this.deps.publicServerUrl.replace(/\/$/, "")}/signup/confirm/${encodeURIComponent(signup.token)}` : link.url;
      const text = `${link.invitedByDisplayName} invited you to connect with ${link.sourceWorkspaceName}.\n\n` +
        (signup ? `Verify ${email} and create your TYR Workspace, then review and accept the invitation:\n${invitationUrl}\n\n`
          : `Sign in with ${email}, choose a Workspace you own, and accept:\n${invitationUrl}\n\n`) +
        "Accepting creates a two-way Bridge immediately. Both sides can ask the other's TYR to act with that Workspace Owner's capabilities. Private DMs and membership remain separate.\n\n" +
        `This invitation is only for ${email} and expires at ${link.expiresAt}. Creating a Workspace does not accept the Bridge. If you do not want to connect, ignore this email.`;
      this.store.db.prepare("update workspace_bridge_email_invitations set email_text = ?, sender_name = ? where intent_id = ?").run(text, link.sourceWorkspaceName, link.id);
      this.store.recordAuditEvent({ kind: "workspace_bridge_email_invite_created", actorType: "user", actorId: origin.userId,
        resourceType: "server", resourceId: origin.serverId, serverId: origin.serverId,
        metadata: { intentId: link.id, recipientUserId: recipient?.id ?? null, sourceMessageId: source.id, source: origin.source } });
      return link.id;
    })();
    await this.deliver(id, false);
    return this.connections.getForSource(id, origin.serverId, origin.userId);
  }

  private originAvailable(row: EmailRow): boolean {
    const source = this.store.getMessage(row.origin_message_id);
    const conversation = this.store.getConversation(row.origin_conversation_id);
    const member = this.store.listServersForUser(row.invited_by_user_id).find((item) => item.id === row.source_workspace_id);
    return Boolean(member && member.role !== "guest" && source && !source.deletedAt && source.senderType === "human" &&
      source.senderId === row.invited_by_user_id && source.channelId === row.origin_channel_id &&
      source.conversationId === row.origin_conversation_id && conversation?.channelId === row.origin_channel_id &&
      this.store.canUserAccessChannel(row.invited_by_user_id, row.origin_channel_id));
  }

  private queueNotice(row: EmailRow, kind: string, content: string) {
    this.store.db.prepare(`insert or ignore into workspace_bridge_invite_notices (intent_id, kind, content, next_attempt_at)
      values (?, ?, ?, ?)`).run(row.intent_id, kind, content, nowIso());
  }

  async notifyAcceptance(id: string): Promise<void> {
    const row = this.row(id);
    if (!row) return;
    const intent = this.connections.getForSource(id, row.source_workspace_id, row.invited_by_user_id);
    if (intent.status !== "active") return;
    this.queueNotice(row, "active", `Bridge connected: ${intent.sourceWorkspaceName} and ${intent.targetWorkspaceName}.`);
    this.store.db.prepare(`update workspace_bridge_invite_notices set status = 'sent' where intent_id = ?
      and kind in ('sent', 'failed') and status = 'pending'`).run(id);
    const notice = this.store.db.prepare(`select * from workspace_bridge_invite_notices where intent_id = ? and kind = 'active'`).get(id) as NoticeRow;
    // 接受事件独立于邮件发送队列，避免其他收件人的投递超时拖延本次连接回执。
    await this.flushNotice(notice);
  }

  private async deliver(id: string, notifySent: boolean): Promise<void> {
    const row = this.row(id);
    if (!row || !row.email_text || !["pending", "sending"].includes(row.delivery_status)) return;
    const intent = this.connections.getForSource(id, row.source_workspace_id, row.invited_by_user_id);
    if (intent.status !== "pending" || !this.originAvailable(row) ||
        (row.recipient_user_id && this.store.getUser(row.recipient_user_id)?.email?.trim().toLowerCase() !== row.recipient_email)) {
      this.store.db.prepare(`update workspace_bridge_email_invitations set delivery_status = 'stopped', email_text = null where intent_id = ?`).run(id);
      return;
    }
    const now = nowIso();
    if (row.delivery_attempts >= 5 && (!row.lease_until || row.lease_until <= now)) {
      this.store.db.prepare(`update workspace_bridge_email_invitations set delivery_status = 'failed', email_text = null, lease_until = null where intent_id = ?`).run(id);
      this.queueNotice(row, "failed", `Email delivery for the Bridge invitation to ${row.recipient_email} could not be confirmed. Please check its status before requesting another invitation.`);
      return;
    }
    const lease = new Date(Date.now() + 60_000).toISOString();
    const claimed = this.store.db.prepare(`update workspace_bridge_email_invitations
      set delivery_status = 'sending', delivery_attempts = delivery_attempts + 1, lease_until = ?
      where intent_id = ? and delivery_status in ('pending', 'sending') and next_attempt_at <= ?
        and (lease_until is null or lease_until <= ?) and delivery_attempts < 5`).run(lease, id, now, now);
    if (!claimed.changes) return;
    try {
      if (!resendHelpdeskConfigured(this.config())) throw new Error("email_not_configured");
      const receipt = await (this.deps.sendEmail ?? sendWorkspaceBridgeInvitationEmail)(this.config(), {
        senderAddress: row.sender_address, ...(row.sender_name ? { senderName: row.sender_name } : {}), recipientEmail: row.recipient_email, subject: row.email_subject,
        text: row.email_text, idempotencyKey: `workspace-bridge-invite/${id}`
      });
      if (!receipt) throw new Error("email_receipt_missing");
      this.store.db.transaction(() => {
        this.store.db.prepare(`update workspace_bridge_email_invitations set delivery_status = 'sent', sent_at = ?,
          provider_message_id = ?, email_text = null, lease_until = null where intent_id = ?`).run(nowIso(), receipt, id);
        if (notifySent) this.queueNotice(row, "sent", `Bridge invitation sent to ${row.recipient_email}. Waiting for them to accept.`);
      })();
    } catch {
      const attempts = row.delivery_attempts + 1;
      this.store.db.transaction(() => {
        this.store.db.prepare(`update workspace_bridge_email_invitations set delivery_status = ?, lease_until = null,
          next_attempt_at = ?, email_text = case when ? then null else email_text end where intent_id = ?`)
          .run(attempts >= 5 ? "failed" : "pending", retryAt(attempts), attempts >= 5 ? 1 : 0, id);
        if (attempts >= 5) this.queueNotice(row, "failed", `Email delivery for the Bridge invitation to ${row.recipient_email} could not be confirmed. Please check its status before requesting another invitation.`);
      })();
    }
  }

  private async flushNotice(notice: NoticeRow): Promise<void> {
    const row = this.row(notice.intent_id);
    if (!row) return;
    const now = nowIso();
    const claimed = this.store.db.prepare(`update workspace_bridge_invite_notices set status = 'sending', attempts = attempts + 1, lease_until = ?
      where intent_id = ? and kind = ? and status in ('pending', 'sending') and next_attempt_at <= ?
      and (lease_until is null or lease_until <= ?) and attempts < 5`)
      .run(new Date(Date.now() + 60_000).toISOString(), row.intent_id, notice.kind, now, now);
    if (!claimed.changes) {
      if (notice.attempts >= 5) this.store.db.prepare(`update workspace_bridge_invite_notices set status = 'failed', lease_until = null
        where intent_id = ? and kind = ? and (lease_until is null or lease_until <= ?)`)
        .run(row.intent_id, notice.kind, now);
      return;
    }
    if (!this.originAvailable(row)) {
      this.store.db.prepare(`update workspace_bridge_invite_notices set status = 'failed', lease_until = null where intent_id = ? and kind = ?`)
        .run(row.intent_id, notice.kind);
      return;
    }
    try {
      const message = this.store.db.transaction(() => {
        const existing = notice.message_id ? this.store.getMessage(notice.message_id) : null;
        if (notice.message_id && (!existing || existing.deletedAt)) throw new Error("invitation_notice_deleted");
        if (existing) return existing;
        const assistant = this.store.ensureDefaultCommunicationAgent(row.source_workspace_id);
        const created = this.store.sendMessage({ target: row.origin_channel_id, conversationId: row.origin_conversation_id,
          allowClosedConversation: true, content: notice.content, senderType: "agent", senderId: assistant.id,
          senderName: assistant.displayName, serverId: row.source_workspace_id }).message;
        this.store.db.prepare(`update workspace_bridge_invite_notices set message_id = ? where intent_id = ? and kind = ?`)
          .run(created.id, row.intent_id, notice.kind);
        return created;
      })();
      if (!notice.message_id) this.deps.emitRealtimeMessage(message);
      if (row.origin_source !== "web") {
        const ref = JSON.parse(row.origin_external_ref ?? "{}") as Record<string, unknown>;
        if (row.origin_source === "telegram") {
          const account = this.store.getTelegramAccountByUserId(row.invited_by_user_id);
          if (!account || account.telegramChatId !== ref.chatId || account.telegramUserId !== ref.telegramUserId) throw new Error("telegram_binding_changed");
        } else if (this.store.getUser(row.invited_by_user_id)?.email?.toLowerCase() !== String(ref.replyTo).toLowerCase()) {
          throw new Error("email_binding_changed");
        }
        const sent = await (this.deps.sendNotice ?? sendCommunicationReturnExternal)({
          execution: { id: `bridge-invite:${row.intent_id}:${notice.kind}`, communicationReturnSource: row.origin_source,
            communicationReturnExternalRef: JSON.stringify({ ...ref, idempotencyKey: `bridge-invite-notice/${row.intent_id}/${notice.kind}` }) },
          message, publicServerUrl: this.deps.publicServerUrl, emailConfig: this.config()
        });
        if (sent.status !== "sent") throw new Error("invitation_notice_not_sent");
      }
      this.store.db.prepare(`update workspace_bridge_invite_notices set status = 'sent', lease_until = null where intent_id = ? and kind = ?`)
        .run(row.intent_id, notice.kind);
    } catch {
      this.store.db.prepare(`update workspace_bridge_invite_notices set status = ?, next_attempt_at = ?, lease_until = null where intent_id = ? and kind = ?`)
        .run(notice.attempts + 1 >= 5 ? "failed" : "pending", retryAt(notice.attempts + 1), row.intent_id, notice.kind);
    }
  }

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const now = nowIso();
      const rows = this.store.db.prepare(`${emailSelect} where
        (email.delivery_status in ('pending', 'sending') and email.next_attempt_at <= ? and (email.lease_until is null or email.lease_until <= ?))
        or ((intent.status in ('active', 'cancelled') or intent.expires_at <= ?) and
          not exists (select 1 from workspace_bridge_invite_notices n where n.intent_id = email.intent_id and n.kind in ('active', 'expired', 'cancelled', 'unavailable')))
        order by intent.created_at limit 100`).all(now, now, now) as EmailRow[];
      for (const row of rows) {
        try {
          const intent = this.connections.getForSource(row.intent_id, row.source_workspace_id, row.invited_by_user_id);
          if (["active", "expired", "cancelled"].includes(intent.status)) {
            const content = intent.status === "active"
              ? `Bridge connected: ${intent.sourceWorkspaceName} and ${intent.targetWorkspaceName}.`
              : `The Bridge invitation to ${row.recipient_email} ${intent.status === "expired" ? "expired" : "was cancelled"}.`;
            this.queueNotice(row, intent.status, content);
            this.store.db.prepare(`update workspace_bridge_invite_notices set status = 'sent' where intent_id = ?
              and kind in ('sent', 'failed') and status = 'pending'`).run(row.intent_id);
            if (row.email_text) this.store.db.prepare(`update workspace_bridge_email_invitations set email_text = null,
              delivery_status = case when delivery_status = 'sent' then delivery_status else 'stopped' end where intent_id = ?`).run(row.intent_id);
          } else await this.deliver(row.intent_id, true);
        } catch {
          // 撤销成员资格后不能继续投递；单条失效不阻塞其他邀请。
          this.store.db.prepare(`update workspace_bridge_email_invitations set delivery_status = 'stopped', email_text = null where intent_id = ?`).run(row.intent_id);
          this.store.db.prepare(`insert or ignore into workspace_bridge_invite_notices (intent_id, kind, content, status, next_attempt_at)
            values (?, 'unavailable', '', 'failed', ?)`).run(row.intent_id, nowIso());
        }
      }
      const notices = this.store.db.prepare(`select * from workspace_bridge_invite_notices where status in ('pending', 'sending')
        and next_attempt_at <= ? and (lease_until is null or lease_until <= ?) order by next_attempt_at limit 100`).all(nowIso(), nowIso()) as NoticeRow[];
      for (const notice of notices) await this.flushNotice(notice);
    } finally { this.draining = false; }
  }
}
