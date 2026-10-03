import type { MessageRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import type { CommunicationAgentSourceContext } from "./communication-agent-source";
import { deliverExternalMessageToCommunicationAgent, markImmediateWorkspaceBridgeExternalReturn } from "./external-communication-agent";
import { parseTelegramApprovalCallbackData } from "./telegram-approval-actions";
import { resolveRuntimeApprovalDecision } from "./runtime-approval-resolve";
import type { ServerRouteContext } from "./server-context";

export interface TelegramConnectorConfig {
  enabled: boolean;
  botToken: string;
  webhookSecret: string;
  botUsername: string;
  apiBaseUrl: string;
  dedupeTtlSeconds?: number;
  rateLimitMaxMessages?: number;
  rateLimitWindowSeconds?: number;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id?: number;
  reply_to_message?: { message_id?: number };
  date?: number;
  text?: string;
  from?: TelegramUser;
  chat?: TelegramChat;
}

export interface TelegramUser {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id?: number;
  type?: string;
}

export interface TelegramCallbackQuery {
  id?: string;
  from?: TelegramUser;
  data?: string;
  message?: {
    message_id?: number;
    chat?: TelegramChat;
  };
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramSendMessagePayload {
  method: "sendMessage";
  chat_id: string;
  text: string;
  parse_mode?: "HTML";
  disable_web_page_preview?: boolean;
  reply_markup?: TelegramInlineKeyboardMarkup;
}

export interface TelegramAnswerCallbackQueryPayload {
  method: "answerCallbackQuery";
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
}

export interface TelegramReactionPayload {
  method: "setMessageReaction";
  chat_id: string;
  message_id: number;
  reaction: Array<{ type: "emoji"; emoji: string }>;
}
export type TelegramApiPayload = TelegramSendMessagePayload | TelegramAnswerCallbackQueryPayload | TelegramReactionPayload;

export interface TelegramConnectorResult {
  status: "ignored" | "replied" | "duplicate" | "rate_limited";
  response?: TelegramApiPayload;
  inboundMessage?: MessageRecord;
  assistantReply?: MessageRecord;
  sourceContext?: CommunicationAgentSourceContext;
}

export interface TelegramSendReceipt {
  messageId?: string;
}

export class TelegramSendError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | undefined,
    detail = ""
  ) {
    super(`telegram_send_failed:${status}${detail ? `:${detail.slice(0, 300)}` : ""}`);
    this.name = "TelegramSendError";
  }
}

export type TelegramMessageSender = (
  payload: TelegramApiPayload,
  config: TelegramConnectorConfig
) => Promise<TelegramSendReceipt | void>;

type TelegramConnectorContext = Pick<ServerRouteContext,
  "store" |
  "publicServerUrl" |
  "emitRealtimeMessage" |
  "emitRealtimeMachineUpdated"
> & Pick<ServerRouteContext, "humanReplies">;

const DEFAULT_BIND_PROMPT = "Please sign in to Tyr and connect Telegram from your account settings.";
const DEFAULT_DEDUPE_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_RATE_LIMIT_MAX_MESSAGES = 30;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;

export function telegramConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TelegramConnectorConfig {
  return {
    enabled: ["1", "true"].includes((env.TYR_TELEGRAM_ENABLED || "").toLowerCase()),
    botToken: env.TYR_TELEGRAM_BOT_TOKEN || "",
    webhookSecret: env.TYR_TELEGRAM_WEBHOOK_SECRET || "",
    botUsername: env.TYR_TELEGRAM_BOT_USERNAME || "",
    apiBaseUrl: (env.TYR_TELEGRAM_API_BASE_URL || "https://api.telegram.org").replace(/\/$/, ""),
    dedupeTtlSeconds: positiveInteger(env.TYR_TELEGRAM_DEDUPE_TTL_SECONDS, DEFAULT_DEDUPE_TTL_SECONDS),
    rateLimitMaxMessages: positiveInteger(env.TYR_TELEGRAM_RATE_LIMIT_MAX_MESSAGES, DEFAULT_RATE_LIMIT_MAX_MESSAGES),
    rateLimitWindowSeconds: positiveInteger(env.TYR_TELEGRAM_RATE_LIMIT_WINDOW_SECONDS, DEFAULT_RATE_LIMIT_WINDOW_SECONDS)
  };
}

export function telegramConfigured(config: TelegramConnectorConfig): boolean {
  return Boolean(config.enabled && config.botToken && config.webhookSecret);
}

export function telegramWebhookSecretMatches(headerValue: string | undefined, config: TelegramConnectorConfig): boolean {
  return Boolean(config.webhookSecret && headerValue === config.webhookSecret);
}

export async function sendTelegramMessage(payload: TelegramApiPayload, config: TelegramConnectorConfig): Promise<TelegramSendReceipt> {
  const { method, ...body } = payload;
  const response = await fetch(`${config.apiBaseUrl}/bot${config.botToken}/${method}`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const detail = await response.text().catch(() => "");
  const parsed = parseTelegramApiResponse(detail);
  if (!response.ok || (() => { try { return JSON.parse(detail)?.ok !== true; } catch { return true; } })()) {
    throw new TelegramSendError(response.status, parsed.retryAfterSeconds, detail);
  }
  return { messageId: parsed.messageId };
}

function parseTelegramApiResponse(detail: string): { messageId?: string; retryAfterSeconds?: number } {
  try {
    const payload = JSON.parse(detail) as any;
    const messageId = typeof payload?.result?.message_id === "number" || typeof payload?.result?.message_id === "string"
      ? String(payload.result.message_id)
      : undefined;
    const retryAfter = Number(payload?.parameters?.retry_after);
    return {
      messageId,
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined
    };
  } catch {
    return {};
  }
}

export async function handleTelegramUpdate(
  ctx: TelegramConnectorContext,
  update: TelegramUpdate,
  config: Partial<TelegramConnectorConfig> = {}
): Promise<TelegramConnectorResult> {
  const updateId = telegramUpdateId(update.update_id);
  if (updateId && !ctx.store.claimTelegramWebhookUpdate(updateId, config.dedupeTtlSeconds ?? DEFAULT_DEDUPE_TTL_SECONDS).claimed) {
    return { status: "duplicate" };
  }

  const callbackResult = handleTelegramCallback(ctx, update.callback_query);
  if (callbackResult) return callbackResult;

  const message = update.message;
  const text = message?.text?.trim() || "";
  const telegramUserId = telegramId(message?.from?.id);
  const chatId = telegramId(message?.chat?.id);
  if (!message || !text || !telegramUserId || !chatId || message.from?.is_bot) {
    return { status: "ignored" };
  }

  const startCode = parseTelegramStartCode(text);
  if (startCode !== null) {
    const account = ctx.store.consumeTelegramBindingCode(startCode, {
      telegramUserId,
      telegramChatId: chatId,
      username: message.from?.username,
      firstName: message.from?.first_name,
      lastName: message.from?.last_name
    });
    if (account) ensureTelegramConversation(ctx, account, false);
    return reply(chatId, account
      ? "Telegram is connected to Tyr. You can now message TYR from this chat."
      : "This Telegram binding link is invalid or expired. Please sign in to Tyr and connect Telegram again.");
  }

  const rateLimit = checkTelegramRateLimit(ctx, telegramUserId, config);
  if (!rateLimit.allowed) {
    return {
      status: "rate_limited",
      response: sendMessage(chatId, `Too many Telegram messages. Please wait ${rateLimit.retryAfterSeconds} seconds and try again.`)
    };
  }

  const account = ctx.store.getTelegramAccountByTelegramUserId(telegramUserId);
  if (message.reply_to_message?.message_id && ctx.humanReplies && account) {
    const user = ctx.store.getUser(account.userId);
    if (!user) return reply(chatId, DEFAULT_BIND_PROMPT);
    if (account.telegramChatId !== chatId || message.chat?.type !== "private") return reply(chatId, "This personal reply is not available in this chat.");
    try {
      if (ctx.humanReplies.telegramReply(account.id, user.id, chatId, message.reply_to_message.message_id, message.text ?? text)) {
        return reply(chatId, "Your personal reply was sent to the original requester.");
      }
    } catch {
      return reply(chatId, "Your personal reply could not be sent. Open Personal replies in TYR to check whether the request is still available.");
    }
  }
  const command = parseTelegramCommand(text);
  if (command) {
    if (command === "help") return reply(chatId, telegramHelpText(Boolean(account)));
    if (command === "status") return reply(chatId, telegramStatusText(ctx, account));
    if (command === "new") {
      if (!account) return reply(chatId, DEFAULT_BIND_PROMPT);
      const conversation = ensureTelegramConversation(ctx, account, true);
      return reply(chatId, conversation
        ? "Started a new TYR conversation. Your earlier conversations remain available in Tyr."
        : "TYR is not available for this workspace.");
    }
    if (command === "disconnect") return disconnectTelegram(ctx, chatId, account);
    return reply(chatId, `Unknown Telegram command: /${command}. Send /help to see available commands.`);
  }

  if (!account) return reply(chatId, DEFAULT_BIND_PROMPT);
  const user = ctx.store.getUser(account.userId);
  if (!user) return reply(chatId, DEFAULT_BIND_PROMPT);
  if (!ctx.store.listServersForUser(user.id).some((server) => server.id === account.serverId)) {
    return reply(chatId, "This Telegram connection is no longer active. Please reconnect Telegram from Tyr.");
  }

  ctx.store.touchTelegramAccount(account.id);
  if (isTelegramBindingCodeText(text)) {
    return reply(chatId, "Telegram is already connected to Tyr. The binding code is no longer needed. Send a message to TYR from this chat.");
  }

  const externalRef = JSON.stringify({ chatId, telegramUserId, telegramMessageId: message.message_id });
  const sourceEventId = updateId || telegramUpdateId(message.message_id);
  const delivery = await deliverExternalMessageToCommunicationAgent(ctx, {
    userId: user.id,
    serverId: account.serverId,
    content: text,
    source: "telegram",
    sourceConversationKey: `telegram:${chatId}`,
    conversationTitle: "Telegram",
    ...(sourceEventId ? { sourceEventKey: `telegram:${sourceEventId}` } : {}),
    externalRef
  });
  if (delivery.status !== "delivered") return reply(chatId, "TYR is not available for this workspace.");
  markImmediateWorkspaceBridgeExternalReturn(ctx.store, delivery);
  return {
    status: "replied",
    ...(delivery.assistantOutcome?.replySuppressed ? {} : {
      response: sendMessage(chatId, delivery.assistantReply?.content || "Message delivered to TYR.")
    }),
    inboundMessage: delivery.inboundMessage,
    assistantReply: delivery.assistantReply,
    sourceContext: delivery.sourceContext
  };
}

function handleTelegramCallback(ctx: TelegramConnectorContext, callback: TelegramCallbackQuery | undefined): TelegramConnectorResult | null {
  if (!callback) return null;
  const callbackQueryId = typeof callback.id === "string" ? callback.id.trim() : "";
  if (!callbackQueryId) return { status: "ignored" };
  if (callback.from?.is_bot) return answerCallback(callbackQueryId, "This Tyr action is not available.", true);
  const parsed = parseTelegramApprovalCallbackData(callback.data);
  if (!parsed) return answerCallback(callbackQueryId, "This Tyr action is invalid or expired.", true);

  const telegramUserId = telegramId(callback.from?.id);
  if (!telegramUserId) return answerCallback(callbackQueryId, "This Telegram account could not be verified.", true);

  const action = ctx.store.getTelegramApprovalAction(parsed.actionId);
  if (!action || action.status !== "pending") {
    return answerCallback(callbackQueryId, "This approval action is no longer available.", true);
  }
  if (action.decision !== parsed.decision) {
    return answerCallback(callbackQueryId, "This approval action is invalid.", true);
  }
  if (action.telegramUserId !== telegramUserId) {
    return answerCallback(callbackQueryId, "This approval action belongs to another Telegram account.", true);
  }
  if (telegramApprovalActionExpired(action.expiresAt)) {
    return answerCallback(callbackQueryId, "This approval action has expired. Open Tyr to review it.", true);
  }

  const account = ctx.store.getTelegramAccountByTelegramUserId(telegramUserId);
  if (!account || account.userId !== action.userId || account.serverId !== action.serverId) {
    return answerCallback(callbackQueryId, "This Telegram connection is no longer active. Open Tyr to review it.", true);
  }
  if (!ctx.store.listServersForUser(account.userId).some((server) => server.id === action.serverId && server.role !== "guest")) {
    return answerCallback(callbackQueryId, "You no longer have access to this Tyr workspace.", true);
  }

  const approval = ctx.store.getRuntimeApproval(action.approvalId);
  if (!approval || (approval.serverId ?? "local") !== action.serverId) {
    ctx.store.consumeTelegramApprovalAction(action.id);
    return answerCallback(callbackQueryId, "This approval action is no longer available.", true);
  }
  if (approval.status !== "pending") {
    ctx.store.consumeTelegramApprovalAction(action.id);
    return answerCallback(callbackQueryId, "This approval has already been handled.", true);
  }
  if (!ctx.store.canUserResolveRuntimeApproval(account.userId, approval)) {
    ctx.store.consumeTelegramApprovalAction(action.id);
    return answerCallback(callbackQueryId, "This approval action is no longer available.", true);
  }

  const consumed = ctx.store.consumeTelegramApprovalAction(action.id);
  if (!consumed) return answerCallback(callbackQueryId, "This approval action is no longer available.", true);
  const result = resolveRuntimeApprovalDecision(ctx as ServerRouteContext, {
    approval,
    decision: consumed.decision,
    resolvedByUserId: consumed.userId
  });
  if ("blocked" in result) {
    return answerCallback(callbackQueryId, `Approval blocked: ${result.body.reason}`, true);
  }
  return answerCallback(callbackQueryId, consumed.decision === "approve" ? "Approved in Tyr." : "Rejected in Tyr.");
}

function answerCallback(callbackQueryId: string, text: string, showAlert = false): TelegramConnectorResult {
  return {
    status: "replied",
    response: {
      method: "answerCallbackQuery",
      callback_query_id: callbackQueryId,
      text,
      ...(showAlert ? { show_alert: true } : {})
    }
  };
}

function telegramApprovalActionExpired(expiresAt: string): boolean {
  const timestamp = Date.parse(expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

function parseTelegramCommand(text: string): string | null {
  const match = text.match(/^\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s|$)/);
  return match?.[1]?.toLowerCase() ?? null;
}

function parseTelegramStartCode(text: string): string | null {
  const match = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  if (!match) return null;
  return (match[1] || "").trim();
}

function isTelegramBindingCodeText(text: string): boolean {
  return /^tyr_tg_[0-9a-f]{48}$/i.test(text.trim());
}

function telegramId(value: unknown): string {
  return typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
}

function telegramUpdateId(value: unknown): string {
  return typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function checkTelegramRateLimit(
  ctx: TelegramConnectorContext,
  telegramUserId: string,
  config: Partial<TelegramConnectorConfig>
): ReturnType<TyrDb["checkTelegramRateLimit"]> {
  return ctx.store.checkTelegramRateLimit({
    scopeKey: `telegram:${telegramUserId}`,
    limit: config.rateLimitMaxMessages ?? DEFAULT_RATE_LIMIT_MAX_MESSAGES,
    windowSeconds: config.rateLimitWindowSeconds ?? DEFAULT_RATE_LIMIT_WINDOW_SECONDS
  });
}

function telegramHelpText(isConnected: boolean): string {
  return [
    "Tyr Telegram commands:",
    "/status - Show your Tyr connection.",
    "/new - Start a new TYR conversation.",
    "/disconnect - Disconnect this Telegram chat from Tyr.",
    "Send any other message to talk to TYR.",
    "Try: add device named Office Mac",
    ...(isConnected ? [] : ["", DEFAULT_BIND_PROMPT])
  ].join("\n");
}

function ensureTelegramConversation(
  ctx: TelegramConnectorContext,
  account: NonNullable<ReturnType<TyrDb["getTelegramAccountByTelegramUserId"]>>,
  replace: boolean
) {
  const assistant = ctx.store.ensureDefaultCommunicationAgent(account.serverId);
  // 一个 Telegram chat 始终显式映射到一个 Tyr conversation；Web 切换不会改变该指针。
  return ctx.store.getOrCreateCommunicationAgentExternalConversation({
    source: "telegram",
    serverId: account.serverId,
    userId: account.userId,
    assistantAgentId: assistant.id,
    sourceConversationKeys: [`telegram:${account.telegramChatId}`],
    title: "Telegram",
    replace
  });
}

function telegramStatusText(ctx: TelegramConnectorContext, account: ReturnType<TyrDb["getTelegramAccountByTelegramUserId"]> | null): string {
  if (!account) return `Telegram is not connected to Tyr. ${DEFAULT_BIND_PROMPT}`;
  const user = ctx.store.getUser(account.userId);
  if (!user) return DEFAULT_BIND_PROMPT;
  const server = ctx.store.listServersForUser(user.id).find((item) => item.id === account.serverId);
  // Guest 的 Telegram 绑定仍可用于 TYR 只读查询；审批 mutation guard 保持不变。
  if (!server) return "This Telegram connection is no longer active. Please reconnect Telegram from Tyr.";
  const telegramName = account.username ? `@${account.username}` : [account.firstName, account.lastName].filter(Boolean).join(" ") || account.telegramUserId;
  return [
    "Telegram is connected to Tyr.",
    `Workspace: ${server.name}`,
    "Assistant: TYR",
    `Telegram: ${telegramName}`
  ].join("\n");
}

function disconnectTelegram(
  ctx: TelegramConnectorContext,
  chatId: string,
  account: ReturnType<TyrDb["getTelegramAccountByTelegramUserId"]> | null
): TelegramConnectorResult {
  if (!account) return reply(chatId, `Telegram is not connected to Tyr. ${DEFAULT_BIND_PROMPT}`);
  ctx.store.revokeTelegramAccountForUser(account.userId);
  return reply(chatId, "Telegram has been disconnected from Tyr. Sign in to Tyr to reconnect it from Account settings.");
}

function reply(chatId: string, text: string): TelegramConnectorResult {
  return { status: "replied", response: sendMessage(chatId, text) };
}

function sendMessage(chatId: string, text: string): TelegramSendMessagePayload {
  return {
    method: "sendMessage",
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  };
}
