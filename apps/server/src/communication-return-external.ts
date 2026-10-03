import type { MessageRecord, RuntimeExecutionRecord } from "@tyr-ai/contracts";
import { parseCommunicationReturnExternalRef } from "./communication-approval-notification";
import { communicationResultTelegramHtml } from "./communication-result";
import {
  resendHelpdeskConfigFromEnv,
  resendHelpdeskConfigured,
  sendResendCommunicationReturnEmail,
  type ResendCommunicationReturnEmailRef,
  type ResendCommunicationReturnEmailSender,
  type ResendHelpdeskConfig
} from "./resend-helpdesk";
import {
  sendTelegramMessage,
  telegramConfigFromEnv,
  telegramConfigured,
  type TelegramConnectorConfig,
  type TelegramMessageSender
} from "./telegram-connector";
import { sanitizeHumanVisibleText, sanitizeHumanVisibleValue } from "./output-disclosure";

type CommunicationReturnExternalExecution = Pick<RuntimeExecutionRecord, "id" | "communicationReturnSource" | "communicationReturnExternalRef">;
type CommunicationReturnExternalMessage = Pick<MessageRecord, "content" | "result">;

export type CommunicationReturnExternalResult =
  | { status: "sent"; source: "telegram" | "email" }
  | { status: "skipped"; reason: string };

export interface CommunicationReturnExternalInput {
  execution: CommunicationReturnExternalExecution;
  message: CommunicationReturnExternalMessage;
  publicServerUrl?: string;
  telegramConfig?: TelegramConnectorConfig;
  emailConfig?: ResendHelpdeskConfig;
  sendTelegram?: TelegramMessageSender;
  sendEmail?: ResendCommunicationReturnEmailSender;
}

export async function sendCommunicationReturnExternal(input: CommunicationReturnExternalInput): Promise<CommunicationReturnExternalResult> {
  const source = input.execution.communicationReturnSource;
  if (!source) return { status: "skipped", reason: "communication_return_missing" };
  if (source === "web") return { status: "skipped", reason: "communication_return_web" };

  const externalRef = parseCommunicationReturnExternalRef(input.execution.communicationReturnExternalRef);
  if (source === "telegram") {
    const chatId = typeof externalRef.chatId === "string" ? externalRef.chatId : "";
    const config = input.telegramConfig ?? telegramConfigFromEnv();
    if (!chatId || !telegramConfigured(config)) return { status: "skipped", reason: "telegram_not_configured" };
    await (input.sendTelegram ?? sendTelegramMessage)({
      method: "sendMessage",
      chat_id: chatId,
      text: input.message.result
        ? communicationResultTelegramHtml(sanitizeHumanVisibleValue(input.message.result))
        : sanitizeHumanVisibleText(input.message.content),
      ...(input.message.result ? { parse_mode: "HTML" as const } : {})
    }, config);
    return { status: "sent", source: "telegram" };
  }

  const ref: ResendCommunicationReturnEmailRef = {
    ...(typeof externalRef.idempotencyKey === "string" ? { idempotencyKey: externalRef.idempotencyKey } : {}),
    replyTo: typeof externalRef.replyTo === "string" ? externalRef.replyTo : undefined,
    replySubject: typeof externalRef.replySubject === "string" ? externalRef.replySubject : undefined,
    inReplyTo: typeof externalRef.inReplyTo === "string" ? externalRef.inReplyTo : undefined,
    references: typeof externalRef.references === "string" ? externalRef.references : undefined,
    assistantAddress: typeof externalRef.assistantAddress === "string" ? externalRef.assistantAddress : undefined,
    ...(typeof externalRef.assistantName === "string" ? { assistantName: externalRef.assistantName } : {})
  };
  const config = input.emailConfig ?? resendHelpdeskConfigFromEnv(input.publicServerUrl ?? "");
  if (!ref.replyTo || !resendHelpdeskConfigured(config)) return { status: "skipped", reason: "email_not_configured" };
  await (input.sendEmail ?? sendResendCommunicationReturnEmail)(config, ref, sanitizeHumanVisibleText(input.message.content));
  return { status: "sent", source: "email" };
}
