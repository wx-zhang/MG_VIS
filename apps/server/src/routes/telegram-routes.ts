import type express from "express";
import {
  handleTelegramUpdate,
  sendTelegramMessage,
  telegramConfigFromEnv,
  telegramConfigured,
  telegramWebhookSecretMatches,
  type TelegramConnectorConfig,
  type TelegramMessageSender
} from "../telegram-connector";
import type { ServerRouteContext } from "../server-context";

export interface TelegramWebhookLogger {
  log(message: string): void;
  warn(message: string): void;
}

export function registerTelegramRoutes(
  app: express.Express,
  ctx: ServerRouteContext,
  configOverride?: TelegramConnectorConfig,
  messageSender: TelegramMessageSender = sendTelegramMessage,
  logger: TelegramWebhookLogger = console
): void {
  app.get("/api/integrations/telegram/account", (req, res) => {
    const user = ctx.requireAuthUser(req, res);
    if (!user) return;

    const config = configOverride ?? telegramConfigFromEnv();
    res.json({
      enabled: config.enabled,
      botUsername: config.botUsername || null,
      account: ctx.store.getTelegramAccountByUserId(user.id)
    });
  });

  app.post("/api/integrations/telegram/binding-codes", (req, res) => {
    const user = ctx.requireAuthUser(req, res);
    if (!user) return;

    const config = configOverride ?? telegramConfigFromEnv();
    if (!config.enabled) {
      res.status(503).json({ error: "telegram_disabled" });
      return;
    }

    const requestedServerId = typeof req.body?.serverId === "string" ? req.body.serverId.trim() : "";
    const serverId = requestedServerId || ctx.primaryServerIdForUser(user.id);
    const server = serverId ? ctx.store.listServersForUser(user.id).find((item) => item.id === serverId) : null;
    if (!server || server.role === "guest") {
      res.status(403).json({ error: "telegram_server_forbidden" });
      return;
    }

    const created = ctx.store.createTelegramBindingCode({ userId: user.id, serverId: server.id });
    res.json({
      id: created.id,
      code: created.code,
      userId: created.userId,
      serverId: created.serverId,
      status: created.status,
      expiresAt: created.expiresAt,
      deepLink: config.botUsername ? `https://t.me/${config.botUsername}?start=${encodeURIComponent(created.code)}` : null
    });
  });

  app.delete("/api/integrations/telegram/account", (req, res) => {
    const user = ctx.requireAuthUser(req, res);
    if (!user) return;

    ctx.store.revokeTelegramAccountForUser(user.id);
    res.json({ ok: true });
  });

  app.post("/api/connectors/telegram/webhook", async (req, res) => {
    const config = configOverride ?? telegramConfigFromEnv();
    if (!telegramConfigured(config)) {
      logTelegramWebhook(logger, req.body, "rejected", "telegram_disabled");
      res.status(503).json({ error: "telegram_disabled" });
      return;
    }
    if (!telegramWebhookSecretMatches(req.header("x-telegram-bot-api-secret-token"), config)) {
      logTelegramWebhook(logger, req.body, "rejected", "telegram_webhook_forbidden");
      res.status(403).json({ error: "telegram_webhook_forbidden" });
      return;
    }

    try {
      const result = await handleTelegramUpdate(ctx, req.body, config);
      logTelegramWebhook(logger, req.body, result.status);
      if (result.response) {
        await messageSender(result.response, config);
      }
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logTelegramWebhook(logger, req.body, "send_failed", message);
      res.status(message.startsWith("telegram_send_failed:") ? 502 : 400).json({ error: message });
    }
  });
}

function logTelegramWebhook(logger: TelegramWebhookLogger, update: any, status: string, detail?: string): void {
  const updateId = typeof update?.update_id === "number" || typeof update?.update_id === "string" ? String(update.update_id) : "";
  const chat = update?.message?.chat ?? update?.callback_query?.message?.chat;
  const from = update?.message?.from ?? update?.callback_query?.from;
  const chatId = typeof chat?.id === "number" || typeof chat?.id === "string" ? String(chat.id) : "";
  const userId = typeof from?.id === "number" || typeof from?.id === "string" ? String(from.id) : "";
  const suffix = detail ? ` detail=${detail.slice(0, 160)}` : "";
  const line = `[telegram] webhook status=${status} update_id=${updateId || "-"} chat=${chatId || "-"} user=${userId || "-"}${suffix}`;
  if (status === "rejected" || status === "send_failed") {
    logger.warn(line);
  } else {
    logger.log(line);
  }
}
