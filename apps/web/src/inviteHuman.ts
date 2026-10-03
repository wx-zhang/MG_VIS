import type { IncomingServerInviteRecord, ServerInviteRecord, UserRecord } from "@tyr-ai/contracts";

export type InviteEmailValidation = {
  valid: boolean;
  email: string;
  error: string;
};

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function inviteEmailValidation(emailInput: string, humans: UserRecord[], pendingInvites: ServerInviteRecord[]): InviteEmailValidation {
  const email = normalizeInviteEmail(emailInput);
  if (!email) return { valid: false, email, error: "Enter an email address." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { valid: false, email, error: "Enter a valid email address." };
  if (humans.some((human) => normalizeInviteEmail(human.email ?? "") === email)) {
    return { valid: false, email, error: "This email is already a member." };
  }
  // 只拦截 pending 状态，revoked/accepted 历史记录不应该阻止 owner 重新邀请。
  if (pendingInvites.some((invite) => invite.status === "pending" && normalizeInviteEmail(invite.invitedEmail) === email)) {
    return { valid: false, email, error: "This email already has a pending invite." };
  }
  return { valid: true, email, error: "" };
}

export function inviteApiErrorMessage(error: string): string {
  if (error === "owner_required") return "Only owners can invite humans.";
  if (error === "invalid_email") return "Enter a valid email address.";
  if (error === "invite_failed") return "Invite failed. Check the email and try again.";
  return `Invite failed: ${error}`;
}

export function inviteCopyText(invite: ServerInviteRecord, serverName: string): string {
  const expires = new Date(invite.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `Invite ${invite.invitedEmail} to ${serverName}. Status: ${invite.status}. Expires ${expires}.`;
}

export function filterPendingInvites(invites: ServerInviteRecord[], search: string): ServerInviteRecord[] {
  const query = normalizeInviteEmail(search);
  const pending = invites.filter((invite) => invite.status === "pending");
  if (!query) return pending;
  return pending.filter((invite) => normalizeInviteEmail(invite.invitedEmail).includes(query));
}

export function incomingInviteBannerSummary(invites: IncomingServerInviteRecord[]): { title: string; detail: string } {
  const count = invites.length;
  const title = `${count} workspace invite${count === 1 ? "" : "s"} waiting`;
  const first = invites[0];
  if (!first) return { title: "No incoming invites", detail: "" };
  const detail = count === 1
    ? `${first.invitedByName} invited you to ${first.serverName}.`
    : `${first.invitedByName} invited you to ${first.serverName}, plus ${count - 1} more.`;
  return { title, detail };
}

export function incomingInviteSidebarLabel(invites: IncomingServerInviteRecord[]): string {
  if (invites.length === 0) return "";
  return `${invites.length} invite${invites.length === 1 ? "" : "s"} received`;
}

export function shouldRefreshForInviteRealtimeEvent(event: string): boolean {
  return event === "server_invite:created" || event === "server_invite:revoked";
}
