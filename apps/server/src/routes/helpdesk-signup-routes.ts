import type express from "express";
import type { HelpdeskPasswordRecoveryPublicPayload, HelpdeskSignupPublicPayload, HelpdeskSignupRequestPublicPayload } from "@tyr-ai/contracts";
import {
  handleHelpdeskInboundEmail,
  handleHelpdeskWebSignupRequest,
  helpdeskMockInboundEnabled,
  helpdeskMockSecretMatches,
  helpdeskSignupConfigFromEnv,
  normalizePublicBaseUrl,
  type HelpdeskInboundEmailResult
} from "../helpdesk-signup";
import { HelpdeskRateLimiter, helpdeskRateLimitConfigFromEnv, type RateLimitDecision } from "../helpdesk-rate-limit";
import {
  handleResendHelpdeskWebhook,
  rawBodyString,
  ResendApiError,
  resendHeadersFromRequest,
  resendHelpdeskConfigFromEnv,
  resendHelpdeskConfigured,
  ResendWebhookPayloadError,
  ResendWebhookVerificationError
} from "../resend-helpdesk";
import type { ServerRouteContext } from "../server-context";

export function registerHelpdeskSignupRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const { store, publicServerUrl } = ctx;
  const rateLimiter = new HelpdeskRateLimiter(helpdeskRateLimitConfigFromEnv());

  app.post("/api/helpdesk/mock-inbound-email", (req, res) => {
    if (!helpdeskMockInboundEnabled()) {
      res.status(404).json({ error: "mock_inbound_disabled" });
      return;
    }
    if (!helpdeskMockSecretMatches(req.header("x-tyr-helpdesk-secret"))) {
      res.status(403).json({ error: "mock_inbound_forbidden" });
      return;
    }
    const inbound = {
      from: String(req.body?.from ?? ""),
      to: String(req.body?.to ?? ""),
      subject: typeof req.body?.subject === "string" ? req.body.subject : "",
      text: typeof req.body?.text === "string" ? req.body.text : ""
    };
    if (sendRateLimitedIfNeeded(res, rateLimiter.checkMockInbound(req, inbound.from))) return;

    const result = handleHelpdeskInboundEmail(store, inbound, helpdeskSignupConfigFromEnv(publicServerUrl));
    res.json(result);
  });

  app.post("/api/helpdesk/signup-requests", (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const message = typeof req.body?.message === "string" ? req.body.message : "";
    if (sendRateLimitedIfNeeded(res, rateLimiter.checkSignupRequest(req, email || message))) return;

    try {
      const result = handleHelpdeskWebSignupRequest(store, {
        email,
        message,
        returnPath: typeof req.body?.returnPath === "string" ? req.body.returnPath : undefined
      }, helpdeskSignupConfigForWebRequest(req, publicServerUrl));
      res.json(helpdeskSignupRequestPublicPayload(result));
    } catch (error) {
      const code = error instanceof Error ? error.message : "signup_request_failed";
      res.status(400).json({ error: code === "signup_invite_email_required" || code === "signup_invite_unavailable" ? code : "signup_request_failed" });
    }
  });

  app.post("/api/helpdesk/resend-webhook", async (req, res) => {
    const config = resendHelpdeskConfigFromEnv(publicServerUrl);
    if (!resendHelpdeskConfigured(config)) {
      res.status(503).json({ error: "resend_helpdesk_disabled" });
      return;
    }
    try {
      const result = await handleResendHelpdeskWebhook(ctx, rawBodyString(req.body), resendHeadersFromRequest(req), config);
      logResendHelpdeskWebhook({
        outcome: result.status,
        route: result.route,
        eventType: result.eventType,
        emailId: result.emailId,
        helpdeskStatus: result.helpdesk?.status,
        assistantStatus: result.assistant?.status,
        replyEmailId: result.replyEmailId
      });
      res.json(result);
    } catch (err) {
      if (err instanceof ResendWebhookVerificationError) {
        logResendHelpdeskWebhook({ outcome: "invalid_webhook" });
        res.status(400).json({ error: "invalid_webhook" });
        return;
      }
      if (err instanceof ResendWebhookPayloadError) {
        logResendHelpdeskWebhook({ outcome: "payload_error", error: err.message });
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof ResendApiError) {
        logResendHelpdeskWebhook({ outcome: "resend_api_failed", resendStatus: err.status });
        res.status(502).json({ error: "resend_api_failed", status: err.status });
        return;
      }
      logResendHelpdeskWebhook({ outcome: "unexpected_error", error: err instanceof Error ? err.message : String(err) });
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/helpdesk/signup-intents/:token", (req, res) => {
    if (sendRateLimitedIfNeeded(res, rateLimiter.checkSignupIntentMetadata(req))) return;

    const intent = store.getHelpdeskSignupIntentByToken(req.params.token);
    if (!intent) {
      res.status(404).json({ status: "invalid" } satisfies HelpdeskSignupPublicPayload);
      return;
    }
    res.json({
      status: intent.status,
      email: intent.email,
      expiresAt: intent.expiresAt,
      ...(intent.returnPath ? { returnPath: intent.returnPath } : {})
    } satisfies HelpdeskSignupPublicPayload);
  });

  app.get("/api/helpdesk/password-recovery-intents/:token", (req, res) => {
    if (sendRateLimitedIfNeeded(res, rateLimiter.checkSignupIntentMetadata(req))) return;

    const intent = store.getHelpdeskPasswordRecoveryIntentByToken(req.params.token);
    if (!intent) {
      res.status(404).json({ status: "invalid" } satisfies HelpdeskPasswordRecoveryPublicPayload);
      return;
    }
    res.json({
      status: intent.status,
      email: intent.email,
      expiresAt: intent.expiresAt
    } satisfies HelpdeskPasswordRecoveryPublicPayload);
  });

  app.post("/api/helpdesk/signup-intents/:token/complete", (req, res) => {
    if (sendRateLimitedIfNeeded(res, rateLimiter.checkSignupIntentComplete(req, req.params.token))) return;

    const completed = store.completeHelpdeskSignupIntent(req.params.token, {
      name: typeof req.body?.name === "string" ? req.body.name : undefined,
      password: typeof req.body?.password === "string" ? req.body.password : undefined,
      serverName: typeof req.body?.serverName === "string" ? req.body.serverName : undefined
    });
    if (!completed.ok) {
      const status = completed.reason === "invalid" ? 404 : completed.reason === "expired" ? 410 : completed.reason === "invalid_registration" ? 400 : 409;
      res.status(status).json({ error: `signup_${completed.reason}` });
      return;
    }
    res.json({
      user: completed.user,
      accessToken: completed.accessToken,
      refreshToken: completed.refreshToken,
      ...(completed.intent.returnPath ? { returnPath: completed.intent.returnPath } : {})
    });
  });

  app.post("/api/helpdesk/password-recovery-intents/:token/complete", (req, res) => {
    if (sendRateLimitedIfNeeded(res, rateLimiter.checkSignupIntentComplete(req, req.params.token))) return;

    const completed = store.completeHelpdeskPasswordRecoveryIntent(req.params.token, {
      password: typeof req.body?.password === "string" ? req.body.password : ""
    });
    if (!completed.ok) {
      const status = completed.reason === "invalid" ? 404 : completed.reason === "expired" ? 410 : completed.reason === "invalid_password" ? 400 : 409;
      res.status(status).json({ error: `recovery_${completed.reason}` });
      return;
    }
    res.json({
      user: completed.user,
      accessToken: completed.accessToken,
      refreshToken: completed.refreshToken
    });
  });
}

function helpdeskSignupRequestPublicPayload(result: HelpdeskInboundEmailResult): HelpdeskSignupRequestPublicPayload {
  return {
    status: result.status,
    email: result.email,
    confirmationUrl: result.confirmationUrl,
    replySubject: result.replySubject,
    replyText: result.replyText
  };
}

function helpdeskSignupConfigForWebRequest(req: express.Request, publicServerUrl: string) {
  const config = helpdeskSignupConfigFromEnv(publicServerUrl);
  if (normalizePublicBaseUrl(process.env.TYR_PUBLIC_WEB_URL ?? "")) return config;

  const requestWebBaseUrl = publicWebBaseUrlFromRequest(req);
  if (!requestWebBaseUrl) return config;

  // 同源生产部署必须保留 publicServerUrl 的挂载路径（如 /tyrcli）；Origin 只包含协议和域名。
  if (new URL(requestWebBaseUrl).origin === new URL(config.publicBaseUrl).origin) return config;
  return { ...config, publicBaseUrl: requestWebBaseUrl };
}

function publicWebBaseUrlFromRequest(req: express.Request): string | null {
  const origin = normalizePublicBaseUrl(req.header("origin") ?? "");
  if (origin) return origin;

  const referer = normalizePublicBaseUrl(req.header("referer") ?? "");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function sendRateLimitedIfNeeded(res: express.Response, decision: RateLimitDecision): boolean {
  if (decision.ok) return false;
  res.setHeader("Retry-After", String(decision.retryAfterSeconds ?? 1));
  res.status(429).json({ error: "rate_limited" });
  return true;
}

function logResendHelpdeskWebhook(fields: Record<string, unknown>): void {
  // Production diagnostics must identify routing failures without exposing webhook secrets or email bodies.
  console.info("[helpdesk-resend]", JSON.stringify(fields));
}
