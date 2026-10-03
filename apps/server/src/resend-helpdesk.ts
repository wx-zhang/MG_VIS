import { createHmac, timingSafeEqual } from "node:crypto";
import type { TyrDb } from "@tyr-ai/db";
import {
  handleHelpdeskInboundEmail,
  helpdeskSignupConfigFromEnv,
  type HelpdeskInboundEmailResult,
  type HelpdeskSignupConfig
} from "./helpdesk-signup";
import type { CommunicationAgentSourceContext } from "./communication-agent-source";
import { deliverExternalMessageToCommunicationAgent, markImmediateWorkspaceBridgeExternalReturn } from "./external-communication-agent";
import type { ServerRouteContext } from "./server-context";

export interface ResendHelpdeskConfig {
  enabled: boolean;
  apiKey: string;
  webhookSecret: string;
  replyFrom: string;
  apiBaseUrl: string;
  signup: HelpdeskSignupConfig;
}

export interface ResendHelpdeskHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}

export interface ResendHelpdeskWebhookResult {
  status: "ignored" | "processed" | "duplicate";
  route?: "helpdesk" | "assistant" | "ignored";
  eventType?: string;
  emailId?: string;
  helpdesk?: HelpdeskInboundEmailResult;
  assistant?: ResendCommunicationEmailResult;
  replyEmailId?: string;
}

export interface ResendCommunicationEmailInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  eventId?: string;
}

export interface ResendCommunicationEmailResult {
  status: "delivered" | "unknown_recipient" | "unknown_sender" | "workspace_unavailable" | "assistant_unavailable";
  replyTo?: string;
  replySubject?: string;
  replyText?: string;
  assistantAddress?: string;
  assistantName?: string;
  sourceContext?: CommunicationAgentSourceContext;
}

interface ResendCommunicationEmailDeliveryResult extends ResendCommunicationEmailResult {
  bridgeRequestIds?: string[];
  assistantOutcomeStatus?: "completed" | "partial" | "failed" | "running";
  assistantReplyMessageId?: string;
}

export interface ResendCommunicationReturnEmailRef {
  idempotencyKey?: string;
  replyTo?: string;
  replySubject?: string;
  inReplyTo?: string;
  references?: string;
  assistantAddress?: string;
  assistantName?: string;
}

export type ResendCommunicationReturnEmailSender = (
  config: ResendHelpdeskConfig,
  ref: ResendCommunicationReturnEmailRef,
  text: string,
  fetchFn?: ResendFetch
) => Promise<string | undefined>;

export interface ResendCommunicationNotificationEmailInput {
  subject: string;
  text: string;
}

export type ResendCommunicationNotificationEmailSender = (
  config: ResendHelpdeskConfig,
  ref: ResendCommunicationReturnEmailRef,
  input: ResendCommunicationNotificationEmailInput,
  fetchFn?: ResendFetch
) => Promise<string | undefined>;

interface ResendWebhookEvent {
  type?: string;
  data?: Record<string, unknown>;
}

interface ResendReceivedEmail {
  id?: string;
  from?: string;
  to?: string | string[];
  received_for?: string | string[];
  subject?: string;
  text?: string | null;
  html?: string | null;
  message_id?: string;
  headers?: Record<string, string>;
}

interface ResendSendEmailResponse {
  id?: string;
}

export class ResendWebhookVerificationError extends Error {
  constructor() {
    super("invalid_webhook");
  }
}

export class ResendWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class ResendApiError extends Error {
  constructor(readonly status: number, readonly payload: unknown) {
    super("resend_api_failed");
  }
}

type ResendFetch = typeof fetch;
type ResendHelpdeskWebhookContext = Pick<ServerRouteContext,
  "store" |
  "publicServerUrl" |
  "emitRealtimeMessage" |
  "emitRealtimeMachineUpdated"
>;

export function resendHelpdeskConfigFromEnv(publicServerUrl: string, env: NodeJS.ProcessEnv = process.env): ResendHelpdeskConfig {
  const signup = helpdeskSignupConfigFromEnv(publicServerUrl, env);
  return {
    enabled: ["1", "true"].includes((env.TYR_HELPDESK_RESEND_INBOUND || "").toLowerCase()),
    apiKey: env.RESEND_API_KEY || "",
    webhookSecret: env.RESEND_WEBHOOK_SECRET || "",
    replyFrom: env.TYR_HELPDESK_RESEND_FROM || `Tyr Helpdesk <${signup.helpdeskEmail}>`,
    apiBaseUrl: (env.TYR_RESEND_API_BASE_URL || "https://api.resend.com").replace(/\/$/, ""),
    signup
  };
}

export function resendHelpdeskConfigured(config: ResendHelpdeskConfig): boolean {
  return Boolean(config.enabled && config.apiKey && config.webhookSecret);
}

export async function handleResendCommunicationEmail(
  ctx: Pick<ServerRouteContext, "store" | "publicServerUrl" | "emitRealtimeMessage" | "emitRealtimeMachineUpdated">,
  input: ResendCommunicationEmailInput
): Promise<ResendCommunicationEmailDeliveryResult> {
  const alias = ctx.store.getCommunicationAgentEmailAliasByAddress(input.to);
  if (!alias) return { status: "unknown_recipient" };
  const senderEmail = extractEmailAddress(input.from);
  if (!senderEmail) return { status: "unknown_sender" };
  const user = ctx.store.findUser(senderEmail);
  if (!user) return { status: "unknown_sender" };
  const server = ctx.store.listServersForUser(user.id).find((item) => item.id === alias.serverId);
  if (!server) return { status: "unknown_sender" };

  const content = input.text.trim() || input.subject.trim();
  const sourceEventId = input.eventId?.trim() || input.messageId?.trim();
  const aliases = ctx.store.listCommunicationAgentEmailAliases(alias.assistantAgentId);
  const primaryAddress = aliases.find((item) => item.isPrimary)?.address ?? alias.address;
  // Stable TYR identity plus legacy address keys keeps pre-rename threads reachable.
  const thread = communicationEmailConversationRouting(senderEmail,
    [alias.assistantAgentId, ...aliases.map((item) => item.address)], input);
  const delivery = await deliverExternalMessageToCommunicationAgent(ctx, {
    userId: user.id,
    serverId: alias.serverId,
    content,
    source: "email",
    sourceConversationKey: thread.keys[0],
    sourceConversationAliases: thread.keys.slice(1),
    conversationTitle: thread.title,
    ...(sourceEventId ? { sourceEventKey: `email:${sourceEventId}` } : {}),
    externalRef: JSON.stringify({
      replyTo: senderEmail,
      replySubject: input.subject,
      inReplyTo: input.messageId,
      references: thread.references,
      // 异步执行结果和审批通知必须继续从当前 Assistant alias 发出，避免回复串到 Helpdesk。
      assistantAddress: primaryAddress,
      assistantName: server.name
    })
  });
  if (delivery.status !== "delivered") return { status: delivery.status };

  return {
    status: "delivered",
    replyTo: senderEmail,
    replySubject: input.subject ? replySubject(input.subject, "TYR") : "TYR",
    replyText: delivery.assistantReply?.content || "Message delivered to TYR.",
    assistantAddress: primaryAddress,
    assistantName: server.name,
    sourceContext: delivery.sourceContext,
    bridgeRequestIds: delivery.assistantOutcome?.bridgeRequestIds,
    assistantOutcomeStatus: delivery.assistantOutcome?.status,
    assistantReplyMessageId: delivery.assistantReply?.id
  };
}

export async function handleResendHelpdeskWebhook(
  ctxOrStore: TyrDb | ResendHelpdeskWebhookContext,
  rawPayload: string,
  headers: ResendHelpdeskHeaders,
  config: ResendHelpdeskConfig,
  fetchFn: ResendFetch = fetch
): Promise<ResendHelpdeskWebhookResult> {
  const ctx = resendWebhookContext(ctxOrStore, config);
  const { store } = ctx;
  if (!verifyResendWebhookSignature(rawPayload, headers, config.webhookSecret)) {
    throw new ResendWebhookVerificationError();
  }

  const event = parseResendWebhookEvent(rawPayload);
  if (event.type !== "email.received") {
    return { status: "ignored", eventType: event.type };
  }

  const emailId = stringValue(event.data?.email_id ?? event.data?.id);
  if (!emailId) throw new ResendWebhookPayloadError("resend_email_id_required");

  const claimed = store.claimHelpdeskResendEmailEvent(emailId, headers.id);
  if (!claimed.claimed) {
    return {
      status: "duplicate",
      eventType: event.type,
      emailId,
      replyEmailId: claimed.event.replyEmailId ?? undefined
    };
  }

  try {
    const received = await retrieveResendReceivedEmail(config, emailId, fetchFn);
    const helpdeskRecipient = selectHelpdeskRecipient(received, config.signup.helpdeskEmail);
    if (helpdeskRecipient) {
      const helpdesk = handleHelpdeskInboundEmail(store, {
        from: received.from ?? "",
        to: helpdeskRecipient,
        subject: received.subject ?? "",
        text: received.text || stripHtml(received.html || ""),
        source: "email"
      }, config.signup);
      const replyEmailId = helpdesk.replyTo
        ? await sendResendHelpdeskReply(config, received, helpdesk, fetchFn)
        : undefined;
      store.completeHelpdeskResendEmailEvent(emailId, {
        helpdeskStatus: helpdesk.status,
        replyEmailId
      });

      return {
        status: "processed",
        route: "helpdesk",
        eventType: event.type,
        emailId,
        helpdesk,
        replyEmailId
      };
    }

    const assistantRecipient = selectCommunicationAgentRecipient(store, received);
    const assistant = assistantRecipient
      ? await handleResendCommunicationEmail(ctx, {
        from: received.from ?? "",
        to: assistantRecipient,
        subject: received.subject ?? "",
        text: received.text || stripHtml(received.html || ""),
        messageId: received.message_id,
        inReplyTo: receivedEmailHeader(received, "in-reply-to"),
        references: receivedEmailHeader(received, "references"),
        eventId: emailId
      })
      : { status: "unknown_recipient" } satisfies ResendCommunicationEmailDeliveryResult;
    const replyEmailId = assistant.replyTo
      ? await sendResendCommunicationReply(config, received, assistant, fetchFn)
      : undefined;
    if (assistant.replyTo && assistant.bridgeRequestIds?.length) {
      markImmediateWorkspaceBridgeExternalReturn(store, {
        assistantReply: assistant.assistantReplyMessageId
          ? store.getMessage(assistant.assistantReplyMessageId) ?? undefined
          : undefined,
        assistantOutcome: {
          status: assistant.assistantOutcomeStatus ?? "running",
          bridgeRequestIds: assistant.bridgeRequestIds
        }
      });
    }
    const {
      bridgeRequestIds: _bridgeRequestIds,
      assistantOutcomeStatus: _assistantOutcomeStatus,
      assistantReplyMessageId: _assistantReplyMessageId,
      ...assistantResult
    } = assistant;
    store.completeHelpdeskResendEmailEvent(emailId, {
      helpdeskStatus: `assistant_${assistant.status}`,
      replyEmailId
    });
    return {
      status: "processed",
      route: assistantRecipient ? "assistant" : "ignored",
      eventType: event.type,
      emailId,
      assistant: assistantResult,
      replyEmailId
    };
  } catch (err) {
    store.failHelpdeskResendEmailEvent(emailId, resendHelpdeskErrorCode(err));
    throw err;
  }
}

export function verifyResendWebhookSignature(
  rawPayload: string,
  headers: ResendHelpdeskHeaders,
  secret: string,
  options: { nowMs?: number; toleranceSeconds?: number } = {}
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature || !secret) return false;
  const timestampSeconds = Number.parseInt(headers.timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) return false;
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const toleranceSeconds = options.toleranceSeconds ?? 5 * 60;
  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) return false;

  const signedContent = `${headers.id}.${headers.timestamp}.${rawPayload}`;
  const expected = createHmac("sha256", svixSecretBytes(secret)).update(signedContent).digest();
  for (const signature of svixSignatureValues(headers.signature)) {
    const actual = Buffer.from(signature, "base64");
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
  }
  return false;
}

export function resendHeadersFromRequest(req: { header: (name: string) => string | undefined }): ResendHelpdeskHeaders {
  return {
    id: req.header("svix-id"),
    timestamp: req.header("svix-timestamp"),
    signature: req.header("svix-signature")
  };
}

export function rawBodyString(body: unknown): string {
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (typeof body === "string") return body;
  return JSON.stringify(body ?? {});
}

function parseResendWebhookEvent(rawPayload: string): ResendWebhookEvent {
  const parsed = JSON.parse(rawPayload);
  return typeof parsed === "object" && parsed ? parsed as ResendWebhookEvent : {};
}

async function retrieveResendReceivedEmail(config: ResendHelpdeskConfig, emailId: string, fetchFn: ResendFetch): Promise<ResendReceivedEmail> {
  return await resendJson<ResendReceivedEmail>(config, `/emails/receiving/${encodeURIComponent(emailId)}?html_format=cid`, {
    method: "GET"
  }, fetchFn);
}

async function sendResendHelpdeskReply(
  config: ResendHelpdeskConfig,
  received: ResendReceivedEmail,
  helpdesk: HelpdeskInboundEmailResult,
  fetchFn: ResendFetch
): Promise<string | undefined> {
  if (!helpdesk.replyTo) return undefined;
  const response = await resendJson<ResendSendEmailResponse>(config, "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: config.replyFrom,
      to: [helpdesk.replyTo],
      subject: replySubject(received.subject, helpdesk.replySubject),
      text: helpdesk.replyText,
      headers: received.message_id ? { "In-Reply-To": received.message_id } : undefined
    })
  }, fetchFn);
  return response.id;
}

async function sendResendCommunicationReply(
  config: ResendHelpdeskConfig,
  received: ResendReceivedEmail,
  assistant: ResendCommunicationEmailResult,
  fetchFn: ResendFetch
): Promise<string | undefined> {
  if (!assistant.replyTo) return undefined;
  const assistantAddress = normalizeCommunicationReplyAddress(assistant.assistantAddress);
  const response = await resendJson<ResendSendEmailResponse>(config, "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Assistant 与 Helpdesk 使用不同发件身份，保证用户点击回复后仍回到 workspace Assistant alias。
      from: assistantAddress ? formatTyrEmailSender(assistantAddress, assistant.assistantName) : config.replyFrom,
      reply_to: assistantAddress || undefined,
      to: [assistant.replyTo],
      subject: replySubject(received.subject, assistant.replySubject || "TYR"),
      text: assistant.replyText || "Message delivered to TYR.",
      headers: emailReplyHeaders(received.message_id, receivedEmailHeader(received, "references"))
    })
  }, fetchFn);
  return response.id;
}

export interface WorkspaceBridgeInvitationEmail {
  senderAddress: string;
  senderName?: string;
  recipientEmail: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}

export async function sendWorkspaceBridgeInvitationEmail(
  config: ResendHelpdeskConfig,
  input: WorkspaceBridgeInvitationEmail,
  fetchFn: ResendFetch = fetch
): Promise<string> {
  const response = await resendJson<ResendSendEmailResponse>(config, "/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({
      from: formatTyrEmailSender(input.senderAddress, input.senderName), reply_to: input.senderAddress,
      to: [input.recipientEmail], subject: input.subject, text: input.text
    })
  }, fetchFn);
  if (!response.id) throw new Error("bridge_invitation_email_receipt_missing");
  return response.id;
}

export const sendResendCommunicationReturnEmail: ResendCommunicationReturnEmailSender = async (
  config: ResendHelpdeskConfig,
  ref: ResendCommunicationReturnEmailRef,
  text: string,
  fetchFn: ResendFetch = fetch
): Promise<string | undefined> => {
  if (!ref.replyTo) return undefined;
  const assistantAddress = normalizeCommunicationReplyAddress(ref.assistantAddress);
  const response = await resendJson<ResendSendEmailResponse>(config, "/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", ...(ref.idempotencyKey ? { "Idempotency-Key": ref.idempotencyKey } : {}) },
    body: JSON.stringify({
      from: assistantAddress ? formatTyrEmailSender(assistantAddress, ref.assistantName) : config.replyFrom,
      reply_to: assistantAddress || undefined,
      to: [ref.replyTo],
      subject: replySubject(ref.replySubject, "TYR result"),
      text,
      headers: emailReplyHeaders(ref.inReplyTo, ref.references)
    })
  }, fetchFn);
  return response.id;
};

export const sendResendCommunicationNotificationEmail: ResendCommunicationNotificationEmailSender = async (
  config,
  ref,
  input,
  fetchFn = fetch
) => {
  if (!ref.replyTo) return undefined;
  const assistantAddress = normalizeCommunicationReplyAddress(ref.assistantAddress);
  const response = await resendJson<ResendSendEmailResponse>(config, "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: assistantAddress ? formatTyrEmailSender(assistantAddress, ref.assistantName) : config.replyFrom,
      reply_to: assistantAddress || undefined,
      to: [ref.replyTo],
      subject: replySubject(ref.replySubject, input.subject),
      text: input.text,
      headers: emailReplyHeaders(ref.inReplyTo, ref.references)
    })
  }, fetchFn);
  return response.id;
};

async function resendJson<T>(config: ResendHelpdeskConfig, path: string, init: RequestInit, fetchFn: ResendFetch): Promise<T> {
  const response = await fetchFn(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  const payload = parseJsonOrText(text);
  if (!response.ok) throw new ResendApiError(response.status, payload);
  return payload as T;
}

function selectHelpdeskRecipient(received: ResendReceivedEmail, helpdeskEmail: string): string {
  const recipients = [...stringList(received.to), ...stringList(received.received_for)];
  const normalizedHelpdeskEmail = helpdeskEmail.trim().toLowerCase();
  return recipients.find((item) => item.trim().toLowerCase() === normalizedHelpdeskEmail) ?? "";
}

function selectCommunicationAgentRecipient(store: TyrDb, received: ResendReceivedEmail): string {
  const recipients = [...stringList(received.to), ...stringList(received.received_for)];
  return recipients.find((item) => Boolean(store.getCommunicationAgentEmailAliasByAddress(item))) ?? "";
}

function resendWebhookContext(ctxOrStore: TyrDb | ResendHelpdeskWebhookContext, config: ResendHelpdeskConfig): ResendHelpdeskWebhookContext {
  if ("store" in ctxOrStore) return ctxOrStore;
  return {
    store: ctxOrStore,
    publicServerUrl: config.signup.publicBaseUrl,
    emitRealtimeMessage: () => undefined,
    emitRealtimeMachineUpdated: () => undefined
  };
}

function replySubject(originalSubject: string | undefined, fallback: string): string {
  const subject = originalSubject?.trim() || fallback;
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

function communicationEmailSubjectKey(from: string, to: string, subject: string): string {
  // 邮件头缺失时主题是最后兜底；多个 Re: 必须先归一化。
  const baseSubject = subject.replace(/^(\s*re:\s*)+/i, "").trim().toLowerCase() || "no-subject";
  return `email:${from.toLowerCase()}:${to.toLowerCase()}:${baseSubject}`;
}

function communicationEmailConversationRouting(
  from: string,
  recipients: string[],
  input: Pick<ResendCommunicationEmailInput, "subject" | "messageId" | "inReplyTo" | "references">
): { keys: string[]; title: string; references?: string } {
  const referenceIds = emailMessageIds(input.references);
  const replyIds = emailMessageIds(input.inReplyTo);
  const currentIds = emailMessageIds(input.messageId);
  const messageKeys = (ids: string[]) => ids.flatMap((messageId) => recipients.map((to) => (
    `email:${from.toLowerCase()}:${to.toLowerCase()}:message:${messageId.toLowerCase()}`
  )));
  const keys = Array.from(new Set([
    ...messageKeys(referenceIds),
    ...messageKeys(replyIds),
    ...messageKeys(currentIds),
    ...recipients.map((to) => communicationEmailSubjectKey(from, to, input.subject))
  ]));
  const title = input.subject.replace(/^(\s*re:\s*)+/i, "").trim().slice(0, 72) || "Email";
  const references = Array.from(new Set([...referenceIds, ...replyIds, ...currentIds])).join(" ") || undefined;
  return { keys, title, references };
}

function emailMessageIds(value: string | undefined): string[] {
  if (!value) return [];
  const bracketed = value.match(/<[^<>\s]+>/g);
  if (bracketed?.length) return bracketed;
  return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function receivedEmailHeader(received: ResendReceivedEmail, name: string): string | undefined {
  const target = name.toLowerCase();
  const entry = Object.entries(received.headers ?? {}).find(([key]) => key.toLowerCase() === target);
  return entry?.[1]?.trim() || undefined;
}

function emailReplyHeaders(inReplyTo: string | undefined, references: string | undefined): Record<string, string> | undefined {
  const replyId = inReplyTo?.trim();
  const mergedReferences = Array.from(new Set([...emailMessageIds(references), ...emailMessageIds(replyId)])).join(" ");
  if (!replyId && !mergedReferences) return undefined;
  return {
    ...(replyId ? { "In-Reply-To": replyId } : {}),
    ...(mergedReferences ? { References: mergedReferences } : {})
  };
}

function normalizeCommunicationReplyAddress(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() || "";
  // 只接受服务端保存的纯邮箱 alias，禁止把可注入邮件头的任意 externalRef 内容写入 From/Reply-To。
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(normalized) ? normalized : "";
}

function extractEmailAddress(value: string): string {
  const trimmed = value.trim();
  const angleMatch = trimmed.match(/<([^<>@\s]+@[^<>\s]+)>/);
  const candidate = angleMatch?.[1] ?? trimmed.match(/[^<>\s]+@[^<>\s]+/)?.[0] ?? "";
  return candidate.trim().replace(/[.,;:]+$/g, "").toLowerCase();
}

function stripHtml(value: string): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseJsonOrText(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function resendHelpdeskErrorCode(err: unknown): string {
  if (err instanceof ResendApiError) return `resend_api_${err.status}`;
  if (err instanceof Error && err.message) return err.message;
  return "resend_helpdesk_failed";
}

function stringList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function svixSignatureValues(value: string): string[] {
  return value.split(" ").flatMap((part) => {
    const [version, signature] = part.split(",", 2);
    return version === "v1" && signature ? [signature] : [];
  });
}

function svixSecretBytes(secret: string): Buffer {
  const normalized = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const decoded = Buffer.from(normalized, "base64");
  return decoded.length > 0 ? decoded : Buffer.from(secret);
}

function formatTyrEmailSender(address: string, workspaceName?: string): string {
  const name = workspaceName?.replace(/[\u0000-\u001f\u007f<>"\\]/g, "").trim().slice(0, 120);
  return name ? `${JSON.stringify(`${name} · TYR`)} <${address}>` : `TYR <${address}>`;
}
