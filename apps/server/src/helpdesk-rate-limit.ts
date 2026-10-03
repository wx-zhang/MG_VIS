import { createHash } from "node:crypto";
import type express from "express";
import { extractEmailAddress } from "./helpdesk-signup";

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export interface HelpdeskRateLimitConfig {
  mockIp: RateLimitRule;
  mockEmail: RateLimitRule;
  metadataIp: RateLimitRule;
  completeIp: RateLimitRule;
  completeToken: RateLimitRule;
}

export interface RateLimitDecision {
  ok: boolean;
  retryAfterSeconds?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const DEFAULT_CONFIG: HelpdeskRateLimitConfig = {
  mockIp: { limit: 10, windowSeconds: 10 * 60 },
  mockEmail: { limit: 5, windowSeconds: 60 * 60 },
  metadataIp: { limit: 60, windowSeconds: 10 * 60 },
  completeIp: { limit: 20, windowSeconds: 10 * 60 },
  completeToken: { limit: 5, windowSeconds: 10 * 60 }
};

export function helpdeskRateLimitConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HelpdeskRateLimitConfig {
  return {
    mockIp: {
      limit: positiveIntFromEnv(env.TYR_HELPDESK_RATE_LIMIT_MOCK_IP_LIMIT, DEFAULT_CONFIG.mockIp.limit),
      windowSeconds: positiveIntFromEnv(env.TYR_HELPDESK_RATE_LIMIT_MOCK_IP_WINDOW_SECONDS, DEFAULT_CONFIG.mockIp.windowSeconds)
    },
    mockEmail: {
      limit: positiveIntFromEnv(env.TYR_HELPDESK_RATE_LIMIT_MOCK_EMAIL_LIMIT, DEFAULT_CONFIG.mockEmail.limit),
      windowSeconds: positiveIntFromEnv(env.TYR_HELPDESK_RATE_LIMIT_MOCK_EMAIL_WINDOW_SECONDS, DEFAULT_CONFIG.mockEmail.windowSeconds)
    },
    metadataIp: {
      limit: positiveIntFromEnv(env.TYR_HELPDESK_RATE_LIMIT_META_IP_LIMIT, DEFAULT_CONFIG.metadataIp.limit),
      windowSeconds: positiveIntFromEnv(env.TYR_HELPDESK_RATE_LIMIT_META_IP_WINDOW_SECONDS, DEFAULT_CONFIG.metadataIp.windowSeconds)
    },
    completeIp: {
      limit: positiveIntFromEnv(env.TYR_HELPDESK_RATE_LIMIT_COMPLETE_IP_LIMIT, DEFAULT_CONFIG.completeIp.limit),
      windowSeconds: positiveIntFromEnv(env.TYR_HELPDESK_RATE_LIMIT_COMPLETE_IP_WINDOW_SECONDS, DEFAULT_CONFIG.completeIp.windowSeconds)
    },
    completeToken: {
      limit: positiveIntFromEnv(env.TYR_HELPDESK_RATE_LIMIT_COMPLETE_TOKEN_LIMIT, DEFAULT_CONFIG.completeToken.limit),
      windowSeconds: positiveIntFromEnv(env.TYR_HELPDESK_RATE_LIMIT_COMPLETE_TOKEN_WINDOW_SECONDS, DEFAULT_CONFIG.completeToken.windowSeconds)
    }
  };
}

export class MemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private checks = 0;

  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  check(key: string, rule: RateLimitRule): RateLimitDecision {
    const now = this.nowMs();
    this.checks += 1;
    if (this.checks % 1000 === 0) this.sweep(now);

    const windowMs = rule.windowSeconds * 1000;
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }

    if (bucket.count >= rule.limit) {
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      };
    }

    bucket.count += 1;
    return { ok: true };
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

export class HelpdeskRateLimiter {
  constructor(
    private readonly config: HelpdeskRateLimitConfig = helpdeskRateLimitConfigFromEnv(),
    private readonly limiter = new MemoryRateLimiter()
  ) {}

  checkMockInbound(req: express.Request, from: string): RateLimitDecision {
    const ipDecision = this.limiter.check(`helpdesk:mock:ip:${clientIp(req)}`, this.config.mockIp);
    if (!ipDecision.ok) return ipDecision;

    const email = extractEmailAddress(from);
    if (!email) return { ok: true };
    return this.limiter.check(`helpdesk:mock:email:${email}`, this.config.mockEmail);
  }

  checkSignupRequest(req: express.Request, emailInput: string): RateLimitDecision {
    const ipDecision = this.limiter.check(`helpdesk:web-request:ip:${clientIp(req)}`, this.config.mockIp);
    if (!ipDecision.ok) return ipDecision;

    const email = extractEmailAddress(emailInput);
    if (!email) return { ok: true };
    return this.limiter.check(`helpdesk:web-request:email:${email}`, this.config.mockEmail);
  }

  checkSignupIntentMetadata(req: express.Request): RateLimitDecision {
    return this.limiter.check(`helpdesk:metadata:ip:${clientIp(req)}`, this.config.metadataIp);
  }

  checkSignupIntentComplete(req: express.Request, token: string): RateLimitDecision {
    const ipDecision = this.limiter.check(`helpdesk:complete:ip:${clientIp(req)}`, this.config.completeIp);
    if (!ipDecision.ok) return ipDecision;
    return this.limiter.check(`helpdesk:complete:token:${hashRateKey(token)}`, this.config.completeToken);
  }
}

function clientIp(req: express.Request): string {
  const forwarded = req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "unknown";
}

function hashRateKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
