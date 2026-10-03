import { evaluateOutputDisclosure, type OutputDisclosureResult } from "@tyr-ai/safety";

const SENSITIVE_VALUE_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "passwd",
  "passphrase",
  "secret",
  "clientsecret",
  "token",
  "authtoken",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "apikey",
  "privatekey",
  "recoverycode",
  "databaseurl",
  "connectorsecret",
  "connectortoken"
]);

export function discloseHumanVisibleText(content: string, authorized = true): OutputDisclosureResult {
  return evaluateOutputDisclosure({ content, authorized });
}

export function sanitizeHumanVisibleText(content: string): string {
  return discloseHumanVisibleText(content).publicContent;
}

/**
 * Runtime payload 常把凭据拆成结构化字段；除了扫描字符串，也必须按字段语义清除值。
 */
export function sanitizeHumanVisibleValue<T>(value: T): T {
  return sanitizeValue(value) as T;
}

function sanitizeValue(value: unknown, key?: string): unknown {
  if (key && sensitiveValueKey(key) && value !== null && value !== undefined) return "<redacted>";
  if (typeof value === "string") return sanitizeHumanVisibleText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (value instanceof Uint8Array) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([nestedKey, nested]) => [
      nestedKey,
      sanitizeValue(nested, nestedKey)
    ])
  );
}

function sensitiveValueKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (SENSITIVE_VALUE_KEYS.has(normalized)) return true;
  return normalized.endsWith("apikey") ||
    normalized.endsWith("authtoken") ||
    normalized.endsWith("accesstoken") ||
    normalized.endsWith("refreshtoken") ||
    normalized.endsWith("clientsecret") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("recoverycode");
}
