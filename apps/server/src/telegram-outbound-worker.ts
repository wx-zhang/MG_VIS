import type { TelegramOutboundDeliveryRecord, TyrDb } from "@tyr-ai/db";
import {
  sendTelegramMessage,
  TelegramSendError,
  type TelegramConnectorConfig,
  type TelegramMessageSender
} from "./telegram-connector";

export interface TelegramOutboundWorkerLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface TelegramOutboundWorker {
  start(): void;
  stop(): void;
  wake(): void;
  processNext(): Promise<boolean>;
}

export function createTelegramOutboundWorker(input: {
  store: TyrDb;
  config: TelegramConnectorConfig;
  sender?: TelegramMessageSender;
  logger?: TelegramOutboundWorkerLogger;
  pollIntervalMs?: number;
  maxAttempts?: number;
}): TelegramOutboundWorker {
  const sender = input.sender ?? sendTelegramMessage;
  const logger = input.logger ?? console;
  const pollIntervalMs = Math.max(50, input.pollIntervalMs ?? 1_000);
  const maxAttempts = Math.max(1, input.maxAttempts ?? 6);
  let timer: NodeJS.Timeout | undefined;
  let started = false;
  let draining = false;
  let wakeRequested = false;

  async function processNext(): Promise<boolean> {
    const delivery = input.store.claimNextTelegramOutboundDelivery();
    if (!delivery) return false;

    const account = input.store.getTelegramAccount(delivery.telegramAccountId);
    if (!account || account.status !== "active" || account.revokedAt || account.telegramChatId !== delivery.telegramChatId) {
      input.store.cancelTelegramOutboundDelivery(delivery.id);
      return true;
    }

    try {
      const receipt = await sender({
        method: "sendMessage",
        chat_id: delivery.telegramChatId,
        text: delivery.text
      }, input.config);
      input.store.markTelegramOutboundDeliverySent(delivery.id, receipt?.messageId);
      logger.log(`[telegram] outbound status=sent delivery=${delivery.id} message=${delivery.messageId} chat=${delivery.telegramChatId}`);
    } catch (error) {
      handleDeliveryError(input.store, delivery, error, maxAttempts, logger);
    }
    return true;
  }

  function schedule(delayMs: number): void {
    if (!started) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void drain(), delayMs);
    timer.unref?.();
  }

  async function drain(): Promise<void> {
    if (!started) return;
    if (draining) {
      wakeRequested = true;
      return;
    }
    draining = true;
    try {
      do {
        wakeRequested = false;
        while (await processNext()) {
          // Drain every delivery currently due; a retry scheduled in the future remains queued.
        }
      } while (wakeRequested);
    } finally {
      draining = false;
      schedule(pollIntervalMs);
    }
  }

  return {
    start() {
      if (started) return;
      started = true;
      // A process crash can leave a claimed row in sending; startup makes it retryable again.
      input.store.resetSendingTelegramOutboundDeliveries();
      schedule(0);
    },
    stop() {
      started = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    wake() {
      if (!started) return;
      if (draining) {
        wakeRequested = true;
        return;
      }
      schedule(0);
    },
    processNext
  };
}

function handleDeliveryError(
  store: TyrDb,
  delivery: TelegramOutboundDeliveryRecord,
  error: unknown,
  maxAttempts: number,
  logger: TelegramOutboundWorkerLogger
): void {
  const detail = error instanceof Error ? error.message : String(error);
  const retryable = !(error instanceof TelegramSendError) || error.status === 429 || error.status >= 500;
  if (retryable && delivery.attempts < maxAttempts) {
    const retryAfterSeconds = error instanceof TelegramSendError && error.retryAfterSeconds
      ? error.retryAfterSeconds
      : Math.min(300, 2 ** Math.max(1, delivery.attempts));
    const nextAttemptAt = new Date(Date.now() + retryAfterSeconds * 1_000).toISOString();
    store.retryTelegramOutboundDelivery(delivery.id, nextAttemptAt, detail);
    logger.warn(`[telegram] outbound status=retry delivery=${delivery.id} attempt=${delivery.attempts} retry_after=${retryAfterSeconds}s error=${detail.slice(0, 300)}`);
    return;
  }

  // 401/403 等永久错误或超过最大次数后终止，避免同一个 Chat 永久阻塞后续消息。
  store.failTelegramOutboundDelivery(delivery.id, detail);
  logger.warn(`[telegram] outbound status=failed delivery=${delivery.id} attempt=${delivery.attempts} error=${detail.slice(0, 300)}`);
}
