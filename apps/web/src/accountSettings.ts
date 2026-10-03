import type { UserRecord } from "@tyr-ai/contracts";

export type AccountProfileDraft = {
  displayName: string;
  description: string;
};

export type AccountProfilePayload = {
  displayName: string;
  description: string | null;
};

export function accountProfileDraft(user: UserRecord): AccountProfileDraft {
  return {
    displayName: user.displayName,
    description: user.description ?? ""
  };
}

export function accountProfilePayload(draft: AccountProfileDraft): AccountProfilePayload {
  // Account 保存只覆盖当前真实接口支持的 profile 字段，preferredLanguage/avatar 后续单独实现。
  return {
    displayName: draft.displayName.trim(),
    description: draft.description.trim() || null
  };
}

export function accountProfileDraftChanged(user: UserRecord, draft: AccountProfileDraft): boolean {
  const current = accountProfilePayload(accountProfileDraft(user));
  const next = accountProfilePayload(draft);
  return current.displayName !== next.displayName || current.description !== next.description;
}

export function accountPasswordValidationMessage(currentPassword: string, newPassword: string, confirmPassword: string, requireCurrentPassword = true): string {
  if (requireCurrentPassword && !currentPassword) return "Enter your current password.";
  if (newPassword.length < 8) return "New password must be at least 8 characters.";
  if (newPassword !== confirmPassword) return "New passwords do not match.";
  return "";
}
