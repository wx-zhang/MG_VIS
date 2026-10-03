import type { RuntimeApprovalRecord, RuntimeExecutionRecord } from "@tyr-ai/contracts";
import type { TelegramApprovalActionDecision, TyrDb } from "@tyr-ai/db";
import type { TelegramInlineKeyboardMarkup } from "./telegram-connector";

const TELEGRAM_APPROVAL_CALLBACK_PREFIX = "tyr_appr";

export const TELEGRAM_APPROVAL_ACTION_TTL_MS = 15 * 60 * 1000;

export interface ParsedTelegramApprovalCallbackData {
  actionId: string;
  decision: TelegramApprovalActionDecision;
}

export function createTelegramApprovalInlineKeyboard(input: {
  store: TyrDb;
  approval: RuntimeApprovalRecord;
  execution: RuntimeExecutionRecord;
  telegramUserId: string;
  reviewUrl: string;
  now?: Date;
}): TelegramInlineKeyboardMarkup | undefined {
  const telegramUserId = input.telegramUserId.trim();
  const userId = input.execution.communicationReturnUserId;
  if (!telegramUserId || !userId) return undefined;

  const expiresAt = new Date((input.now ?? new Date()).getTime() + TELEGRAM_APPROVAL_ACTION_TTL_MS).toISOString();
  const common = {
    approvalId: input.approval.id,
    serverId: input.approval.serverId ?? input.execution.serverId ?? "local",
    userId,
    telegramUserId,
    expiresAt
  };
  const approve = input.store.createTelegramApprovalAction({ ...common, decision: "approve" });
  const reject = input.store.createTelegramApprovalAction({ ...common, decision: "reject" });

  return {
    inline_keyboard: [
      [
        { text: "Approve", callback_data: telegramApprovalCallbackData(approve.id, "approve") },
        { text: "Reject", callback_data: telegramApprovalCallbackData(reject.id, "reject") }
      ],
      [{ text: "Open Web", url: input.reviewUrl }]
    ]
  };
}

export function telegramApprovalCallbackData(actionId: string, decision: TelegramApprovalActionDecision): string {
  // Telegram callback_data is limited to 64 bytes, so callbacks carry only a short server-side action id.
  return `${TELEGRAM_APPROVAL_CALLBACK_PREFIX}:${actionId}:${decision}`;
}

export function parseTelegramApprovalCallbackData(value: string | undefined): ParsedTelegramApprovalCallbackData | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 3 || parts[0] !== TELEGRAM_APPROVAL_CALLBACK_PREFIX) return null;
  const decision = parts[2];
  if (decision !== "approve" && decision !== "reject") return null;
  const actionId = parts[1]?.trim() ?? "";
  if (!/^tgappr_[a-f0-9]+$/.test(actionId)) return null;
  return { actionId, decision };
}
