import type { GovernanceSourceTag } from "./types";
import { isGovernanceSourceTrust, isGovernanceSourceType } from "./types";

export const DEFAULT_MAX_EVENT_DETAIL_CHARS = 800;

export function sanitizeGovernanceSourceTags(tags: GovernanceSourceTag[]): GovernanceSourceTag[] {
  return tags.map((tag) => ({
    sourceType: isGovernanceSourceType(tag.sourceType) ? tag.sourceType : "runtime_event",
    sourceTrust: isGovernanceSourceTrust(tag.sourceTrust) ? tag.sourceTrust : "runtime_observation",
    sourceId: tag.sourceId ? redactAndLimit(String(tag.sourceId), 180) : undefined,
    channelId: tag.channelId ? redactAndLimit(String(tag.channelId), 180) : undefined,
    messageId: tag.messageId ? redactAndLimit(String(tag.messageId), 180) : undefined,
    attachmentId: tag.attachmentId ? redactAndLimit(String(tag.attachmentId), 180) : undefined,
    threadChannelId: tag.threadChannelId ? redactAndLimit(String(tag.threadChannelId), 180) : undefined,
    propagation: Array.isArray(tag.propagation) ? tag.propagation.map((item) => redactAndLimit(String(item), 180)).slice(0, 5) : undefined
  }));
}

export function redactGovernanceText(input: string, maxChars = DEFAULT_MAX_EVENT_DETAIL_CHARS): string {
  return redactAndLimit(input, maxChars);
}

export function containsSensitiveContent(text: string): boolean {
  return /(Authorization:\s*Bearer\s+)[^\s"'}]+/i.test(text) ||
    /(Cookie:\s*)[^\r\n"'}]+/i.test(text) ||
    /\b[A-Z0-9_]*(?:API_)?(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE)[A-Z0-9_]*\s*=\s*[^\\\s"',}]+/i.test(text) ||
    /(^|[^A-Za-z0-9])(?:sk|tyr|tok)_[A-Za-z0-9_-]{8,}\b/.test(text) ||
    /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}\b/.test(text) ||
    /\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"'}]+/i.test(text) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text);
}

export function containsLocalPath(text: string): boolean {
  return /\/Users\/[^/\s"'}]+\/[^\s"'}]*/.test(text) ||
    /\/private\/(?:tmp|var)\/[^\s"'}]+/.test(text) ||
    /\/var\/folders\/[^\s"'}]+/.test(text);
}

export function sanitizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeUnknown);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (/reasoning|chain.?of.?thought|internal.?thought|thoughts?/i.test(key)) continue;
    output[key] = sanitizeUnknown(raw);
  }
  return output;
}

export function redactAndLimit(input: string, maxChars: number): string {
  let text = input;
  text = text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<redacted>");
  text = text.replace(/(Authorization:\s*Bearer\s+)[^\s"'}]+/gi, "$1<redacted>");
  text = text.replace(/(Cookie:\s*)[^\r\n"'}]+/gi, "$1<redacted>");
  text = text.replace(/\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"'}]+/gi, "<redacted>");
  text = text.replace(/\b([A-Z0-9_]*(?:API_)?(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|DATABASE_URL)[A-Z0-9_]*\s*=\s*)[^\\\s"',}]+/gi, "$1<redacted>");
  text = text.replace(/(^|[^A-Za-z0-9])(?:sk|tyr|tok)_[A-Za-z0-9_-]{8,}\b/g, "$1<redacted>");
  text = text.replace(/(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}\b/g, "$1<redacted>");
  text = text.replace(/\/Users\/[^/\s"'}]+(?:\/[^\s"'}]*)?/g, "<local-path>");
  text = text.replace(/\/private\/tmp\/[^\s"'}]+/g, "<local-path>");
  text = text.replace(/\/var\/folders\/[^\s"'}]+/g, "<local-path>");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated ${text.length - maxChars} chars]`;
}
