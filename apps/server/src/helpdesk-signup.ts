import type { HelpdeskSignupIntentRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";

export type HelpdeskSignupMode = "invite_only" | "open";

export interface HelpdeskSignupConfig {
  helpdeskEmail: string;
  signupMode: HelpdeskSignupMode;
  allowlist: Set<string>;
  publicBaseUrl: string;
}

export interface HelpdeskInboundEmailInput {
  from: string;
  to: string;
  subject?: string;
  text?: string;
  source?: HelpdeskSignupIntentRecord["source"];
  returnPath?: string;
}

export interface HelpdeskWebSignupRequestInput {
  email?: string;
  message?: string;
  returnPath?: string;
}

export interface HelpdeskInboundEmailResult {
  status: "sent" | "denied" | "ignored" | "existing_user";
  email?: string;
  confirmationUrl?: string;
  intent?: HelpdeskSignupIntentRecord;
  replyTo?: string;
  replySubject: string;
  replyText: string;
}

export function helpdeskSignupConfigFromEnv(publicServerUrl: string, env: NodeJS.ProcessEnv = process.env): HelpdeskSignupConfig {
  const helpdeskEmail = normalizeEmail(env.TYR_HELPDESK_EMAIL || "help@tyr.ai") || "help@tyr.ai";
  const signupMode: HelpdeskSignupMode = env.TYR_SIGNUP_MODE === "open" ? "open" : "invite_only";
  const allowlist = new Set((env.TYR_SIGNUP_ALLOWLIST || "").split(",").map((item) => normalizeEmail(item)).filter(Boolean) as string[]);
  return {
    helpdeskEmail,
    signupMode,
    allowlist,
    publicBaseUrl: normalizePublicBaseUrl(env.TYR_PUBLIC_WEB_URL || publicServerUrl) ?? publicServerUrl.replace(/\/$/, "")
  };
}

export function helpdeskMockInboundEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.TYR_HELPDESK_MOCK_INBOUND || "").toLowerCase();
  return value === "1" || value === "true" || env.NODE_ENV !== "production";
}

export function helpdeskMockSecretMatches(headerValue: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.TYR_HELPDESK_MOCK_SECRET;
  if (secret) return headerValue === secret;
  return env.NODE_ENV !== "production";
}

export function handleHelpdeskInboundEmail(store: TyrDb, input: HelpdeskInboundEmailInput, config: HelpdeskSignupConfig): HelpdeskInboundEmailResult {
  const email = extractEmailAddress(input.from);
  const to = normalizeEmail(input.to);
  const subject = input.subject?.trim() || "";
  const text = input.text?.trim() || "";
  const replySubject = "Tyr signup request";
  if (!email || to !== config.helpdeskEmail) {
    return {
      status: "ignored",
      replySubject,
      replyText: `Send signup requests to ${config.helpdeskEmail}.`
    };
  }
  const requestText = `${subject}\n${text}`;
  if (isRecoveryRequest(requestText)) {
    return handleHelpdeskPasswordRecoveryEmail(store, input, config, email, subject, text);
  }
  if (!isSignupRequest(requestText)) {
    return {
      status: "ignored",
      email,
      replyTo: email,
      replySubject,
      replyText: "I can help create a Tyr account. Reply with a signup request to continue."
    };
  }
  const existingUser = store.findUser(email);
  if (existingUser?.passwordSetupRequired && input.source === "email") {
    const created = store.createHelpdeskSignupIntent({
      email,
      source: "email",
      subject,
      message: text,
      returnPath: input.returnPath
    });
    const confirmationUrl = `${config.publicBaseUrl}/signup/confirm/${encodeURIComponent(created.token)}`;
    return {
      status: "sent",
      email,
      confirmationUrl,
      intent: created.intent,
      replyTo: email,
      replySubject,
      replyText: `Use this link to finish setting up your Tyr account:\n${confirmationUrl}\n\nYou can set a password after opening Tyr. This link expires in 24 hours.`
    };
  }
  if (existingUser?.passwordSetupRequired) {
    return {
      status: "existing_user",
      email,
      replyTo: email,
      replySubject,
      replyText: `This email already has a Tyr account that still needs password setup. Send an email from this address to ${config.helpdeskEmail} to receive a secure setup link.`
    };
  }
  if (existingUser) {
    return {
      status: "existing_user",
      email,
      replyTo: email,
      replySubject,
      replyText: "This email already has a Tyr account. Sign in with your existing password."
    };
  }
  if (!emailAllowedForSignup(email, config)) {
    return {
      status: "denied",
      email,
      replyTo: email,
      replySubject,
      replyText: "Tyr signup is currently invite-only. Ask the workspace owner to add this email to the signup allowlist."
    };
  }
  const created = store.createHelpdeskSignupIntent({
    email,
    source: input.source ?? "mock_email",
    subject,
    message: text,
    returnPath: input.returnPath
  });
  const confirmationUrl = `${config.publicBaseUrl}/signup/confirm/${encodeURIComponent(created.token)}`;
  return {
    status: "sent",
    email,
    confirmationUrl,
    intent: created.intent,
    replyTo: email,
    replySubject,
    replyText: `Use this link to create your Tyr workspace:\n${confirmationUrl}\n\nYou can set a password after opening the workspace. This link expires in 24 hours.`
  };
}

function handleHelpdeskPasswordRecoveryEmail(store: TyrDb, input: HelpdeskInboundEmailInput, config: HelpdeskSignupConfig, email: string, subject: string, text: string): HelpdeskInboundEmailResult {
  const replySubject = "Tyr password reset";
  const existingUser = store.findUser(email);
  if (!existingUser) {
    // recover 只恢复已有账号；未知邮箱不给 signup link，避免“找回密码”误创建账号。
    return {
      status: "ignored",
      email,
      replyTo: email,
      replySubject,
      replyText: `If this email has a Tyr account, you will receive a password reset link. To create a new account, send a signup request to ${config.helpdeskEmail}.`
    };
  }

  const created = store.createHelpdeskPasswordRecoveryIntent({
    email,
    userId: existingUser.id,
    source: input.source === "email" ? "email" : "mock_email",
    subject,
    message: text
  });
  const confirmationUrl = `${config.publicBaseUrl}/recover/confirm/${encodeURIComponent(created.token)}`;
  return {
    status: "sent",
    email,
    confirmationUrl,
    replyTo: email,
    replySubject,
    replyText: `Use this link to reset your Tyr password:\n${confirmationUrl}\n\nThis link expires in 24 hours.`
  };
}

export function handleHelpdeskWebSignupRequest(store: TyrDb, input: HelpdeskWebSignupRequestInput, config: HelpdeskSignupConfig): HelpdeskInboundEmailResult {
  const explicitEmail = normalizeEmail(input.email ?? "");
  const message = input.message?.trim() || "";
  const bareMessageEmail = normalizeEmail(message);
  const requestText = message || explicitEmail || "";
  const email = explicitEmail ?? bareMessageEmail ?? extractEmailAddress(requestText);

  if (!email) {
    return {
      status: "ignored",
      replySubject: "Tyr signup request",
      replyText: "Send the email you want to use for Tyr and I will prepare the next step."
    };
  }
  if (isRecoveryRequest(requestText)) {
    return {
      status: "ignored",
      email,
      replyTo: email,
      replySubject: "Tyr password reset",
      replyText: `Send an email from this address to ${config.helpdeskEmail} with subject "recover" to receive a secure password reset link.`
    };
  }

  const hasSignupIntent = Boolean(bareMessageEmail) || isSignupRequest(requestText);
  if (!hasSignupIntent && !explicitEmail) {
    return {
      status: "ignored",
      email,
      replyTo: email,
      replySubject: "Tyr signup request",
      replyText: "I can help create a Tyr account. Ask me to create an account and include the email you want to use."
    };
  }

  return handleHelpdeskInboundEmail(store, {
    from: email,
    to: config.helpdeskEmail,
    subject: "signup",
    text: requestText || "signup",
    returnPath: input.returnPath
  }, config);
}

export function emailAllowedForSignup(email: string, config: HelpdeskSignupConfig): boolean {
  return config.signupMode === "open" || config.allowlist.has(normalizeEmail(email) ?? "");
}

export function extractEmailAddress(value: string): string | null {
  const bracketed = value.match(/<([^>]+)>/)?.[1];
  return normalizeEmail(bracketed ?? value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "");
}

export function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

export function normalizePublicBaseUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isRecoveryRequest(value: string): boolean {
  return /\b(recover|reset\s+password|forgot\s+password|password\s+reset|account\s+recovery)\b/i.test(value) || /(找回密码|恢复账号|重置密码)/.test(value);
}

function isSignupRequest(value: string): boolean {
  return /\b(sign\s*up|signup|register|password\s+setup|finish\s+setup|create\s+(?:(?:a|an|my|new|tyr)\s+){0,4}account|join)\b/i.test(value) || /(注册|开户|创建账号|加入)/.test(value);
}
