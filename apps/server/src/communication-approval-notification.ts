import type { RuntimeApprovalRecord, RuntimeExecutionRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import {
  sendResendCommunicationNotificationEmail,
  resendHelpdeskConfigFromEnv,
  resendHelpdeskConfigured,
  type ResendCommunicationNotificationEmailSender,
  type ResendCommunicationReturnEmailRef,
  type ResendHelpdeskConfig
} from "./resend-helpdesk";
import {
  sendTelegramMessage,
  telegramConfigFromEnv,
  telegramConfigured,
  type TelegramConnectorConfig,
  type TelegramMessageSender
} from "./telegram-connector";
import { createTelegramApprovalInlineKeyboard } from "./telegram-approval-actions";

const COMMUNICATION_RETURN_LOOKUP_MAX_HOPS = 16;
const APPROVAL_NOTIFICATION_SUBJECT = "TYR approval required";
const APPROVAL_NOTIFICATION_PAYLOAD_KEY = "communicationApprovalNotification";

type ApprovalExternalNotificationState = {
  dispatchedAt: string;
  source: "telegram" | "email";
};

export type RuntimeApprovalExternalNotificationResult =
  | { status: "sent"; source: "telegram" | "email" }
  | { status: "skipped"; reason: string };

export interface RuntimeApprovalExternalNotificationInput {
  store: TyrDb;
  publicServerUrl: string;
  approval: RuntimeApprovalRecord;
  telegramConfig?: TelegramConnectorConfig;
  emailConfig?: ResendHelpdeskConfig;
  sendTelegram?: TelegramMessageSender;
  sendEmail?: ResendCommunicationNotificationEmailSender;
}

export async function notifyPendingRuntimeApprovalExternal(
  input: RuntimeApprovalExternalNotificationInput
): Promise<RuntimeApprovalExternalNotificationResult> {
  const approval = input.store.getRuntimeApproval(input.approval.id) ?? input.approval;
  if (approval.status !== "pending") return { status: "skipped", reason: "approval_not_pending" };
  if (runtimeApprovalExternalNotificationState(approval)) return { status: "skipped", reason: "already_sent" };
  const execution = communicationReturnExecutionForApproval(input.store, approval);
  if (!execution?.communicationReturnSource) return { status: "skipped", reason: "communication_return_missing" };
  if (execution.communicationReturnSource === "web") return { status: "skipped", reason: "communication_return_web" };
  if (!execution.communicationReturnUserId || !input.store.canUserResolveRuntimeApproval(execution.communicationReturnUserId, approval)) {
    // 外部请求者不能替目标 Workspace 的本地 Agent owner 批准 Bridge/delegation 命令，也不能收到命令详情。
    return { status: "skipped", reason: "approval_resolver_forbidden" };
  }

  const reviewUrl = runtimeApprovalNotificationReviewUrl(input.store, {
    publicServerUrl: input.publicServerUrl,
    approval,
    execution
  });
  const text = runtimeApprovalNotificationText(input.store, {
    approval,
    execution,
    reviewUrl
  });
  const externalRef = parseCommunicationReturnExternalRef(execution.communicationReturnExternalRef);

  if (execution.communicationReturnSource === "telegram") {
    const chatId = typeof externalRef.chatId === "string" ? externalRef.chatId : "";
    const telegramUserId = typeof externalRef.telegramUserId === "string" ? externalRef.telegramUserId : "";
    const config = input.telegramConfig ?? telegramConfigFromEnv();
    if (!chatId || !telegramConfigured(config)) return { status: "skipped", reason: "telegram_not_configured" };
    const replyMarkup = telegramUserId
      ? createTelegramApprovalInlineKeyboard({
        store: input.store,
        approval,
        execution,
        telegramUserId,
        reviewUrl
      })
      : undefined;
    await (input.sendTelegram ?? sendTelegramMessage)({
      method: "sendMessage",
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    }, config);
    markRuntimeApprovalExternalNotificationDispatched(input.store, approval, "telegram");
    return { status: "sent", source: "telegram" };
  }

  const ref: ResendCommunicationReturnEmailRef = {
    replyTo: typeof externalRef.replyTo === "string" ? externalRef.replyTo : undefined,
    replySubject: typeof externalRef.replySubject === "string" ? externalRef.replySubject : undefined,
    inReplyTo: typeof externalRef.inReplyTo === "string" ? externalRef.inReplyTo : undefined,
    assistantAddress: typeof externalRef.assistantAddress === "string" ? externalRef.assistantAddress : undefined,
    ...(typeof externalRef.assistantName === "string" ? { assistantName: externalRef.assistantName } : {})
  };
  const config = input.emailConfig ?? resendHelpdeskConfigFromEnv(input.publicServerUrl);
  if (!ref.replyTo || !resendHelpdeskConfigured(config)) return { status: "skipped", reason: "email_not_configured" };
  await (input.sendEmail ?? sendResendCommunicationNotificationEmail)(config, ref, {
    subject: APPROVAL_NOTIFICATION_SUBJECT,
    text
  });
  markRuntimeApprovalExternalNotificationDispatched(input.store, approval, "email");
  return { status: "sent", source: "email" };
}

export function runtimeApprovalWithExternalNotificationState(
  approval: RuntimeApprovalRecord,
  existing: RuntimeApprovalRecord | null | undefined
): RuntimeApprovalRecord {
  const state = existing ? runtimeApprovalExternalNotificationState(existing) : null;
  if (!state) return approval;
  return {
    ...approval,
    payload: {
      ...runtimeApprovalPayloadRecord(approval.payload),
      [APPROVAL_NOTIFICATION_PAYLOAD_KEY]: state
    }
  };
}

export function communicationReturnExecutionForApproval(
  store: TyrDb,
  approval: RuntimeApprovalRecord
): RuntimeExecutionRecord | null {
  let executionId = approval.executionId;
  const visited = new Set<string>();
  for (let hop = 0; executionId && hop < COMMUNICATION_RETURN_LOOKUP_MAX_HOPS; hop += 1) {
    if (visited.has(executionId)) return null;
    visited.add(executionId);
    const execution = store.getRuntimeExecution(executionId);
    if (!execution) return null;
    // 下游 agent 的审批通常没有外部来源；沿 sourceExecutionId 回到最初 TYR handoff 才能通知原始 Telegram/Email 用户。
    if (
      execution.communicationReturnChannelId &&
      execution.communicationReturnUserId &&
      execution.communicationReturnSource
    ) {
      return execution;
    }
    executionId = execution.sourceExecutionId;
  }
  return null;
}

export function runtimeApprovalReviewUrl(publicServerUrl: string, channelId: string | undefined, approvalId: string, options: { messageId?: string; conversationId?: string; channelType?: string } = {}): string {
  const base = publicServerUrl.replace(/\/+$/, "");
  const segment = options.channelType === "thread" ? "threads" : options.channelType === "channel" ? "channels" : "dms";
  const params = new URLSearchParams();
  if (options.messageId) params.set("message", options.messageId);
  if (options.conversationId && options.channelType === "dm") params.set("conversation", options.conversationId);
  params.set("approval", approvalId);
  const targetPath = channelId
    ? `/chat/${segment}/${encodeURIComponent(channelId)}`
    : "/topology";
  return `${base}${targetPath}?${params.toString()}`;
}

export function parseCommunicationReturnExternalRef(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function runtimeApprovalNotificationReviewUrl(
  store: TyrDb,
  input: {
    publicServerUrl: string;
    approval: RuntimeApprovalRecord;
    execution: RuntimeExecutionRecord;
  }
): string {
  // 外部渠道只负责提醒，实际审批仍回到 Web 的原始执行消息，避免在 Telegram/Email 内断链。
  const target = runtimeApprovalReviewTarget(store, input.approval, input.execution);
  return runtimeApprovalReviewUrl(
    input.publicServerUrl,
    target.channelId ?? input.execution.communicationReturnChannelId,
    input.approval.id,
    target
  );
}

function runtimeApprovalNotificationText(
  store: TyrDb,
  input: {
    approval: RuntimeApprovalRecord;
    execution: RuntimeExecutionRecord;
    reviewUrl: string;
  }
): string {
  const agent = store.getAgent(input.approval.agentId);
  const agentName = agent?.displayName || agent?.name || input.approval.agentId;
  return [
    "Approval required to continue.",
    "",
    `Agent: ${agentName}`,
    `Approval: ${input.approval.title}`,
    `Detail: ${compactApprovalDetail(input.approval.detail)}`,
    "",
    "Open Tyr to approve, reject, or provide a custom response:",
    input.reviewUrl
  ].join("\n");
}

function compactApprovalDetail(detail: string): string {
  const trimmed = detail.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 600) return trimmed || "No additional detail.";
  return `${trimmed.slice(0, 597)}...`;
}

function runtimeApprovalReviewTarget(
  store: TyrDb,
  approval: RuntimeApprovalRecord,
  execution: RuntimeExecutionRecord
): { channelId?: string; messageId?: string; conversationId?: string; channelType?: string } {
  const candidateMessageIds = [execution.rootMessageId, approval.messageId, execution.messageId].filter(Boolean) as string[];
  for (const messageId of candidateMessageIds) {
    const message = store.getMessage(messageId);
    if (!message) continue;
    const channel = store.resolveTarget(message.channelId, approval.serverId);
    return {
      channelId: message.channelId,
      messageId: message.id,
      conversationId: message.conversationId,
      channelType: channel?.type
    };
  }
  const threadChannelId = approval.threadChannelId ?? execution.threadChannelId;
  const thread = threadChannelId ? store.resolveTarget(threadChannelId, approval.serverId) : null;
  if (thread?.parentChannelId && thread.parentMessageId) {
    // thread-scoped approval 需要定位到父消息，否则用户从通知进入后看不到执行面板。
    const parentChannel = store.resolveTarget(thread.parentChannelId, approval.serverId);
    return {
      channelId: thread.parentChannelId,
      messageId: thread.parentMessageId,
      channelType: parentChannel?.type
    };
  }
  return {};
}

function markRuntimeApprovalExternalNotificationDispatched(
  store: TyrDb,
  approval: RuntimeApprovalRecord,
  source: "telegram" | "email"
): void {
  // 通知成功后才写入标记；发送失败保持未标记，后续 daemon 重试或人工重触发仍可再次通知。
  store.createRuntimeApproval({
    ...approval,
    payload: {
      ...runtimeApprovalPayloadRecord(approval.payload),
      [APPROVAL_NOTIFICATION_PAYLOAD_KEY]: {
        dispatchedAt: new Date().toISOString(),
        source
      } satisfies ApprovalExternalNotificationState
    }
  });
}

function runtimeApprovalExternalNotificationState(approval: RuntimeApprovalRecord): ApprovalExternalNotificationState | null {
  const state = runtimeApprovalPayloadRecord(approval.payload)[APPROVAL_NOTIFICATION_PAYLOAD_KEY];
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const item = state as { dispatchedAt?: unknown; source?: unknown };
  if (typeof item.dispatchedAt !== "string") return null;
  if (item.source !== "telegram" && item.source !== "email") return null;
  return { dispatchedAt: item.dispatchedAt, source: item.source };
}

function runtimeApprovalPayloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}
