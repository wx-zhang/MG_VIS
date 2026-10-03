import type { AgentRecord, MessageResult } from "@tyr-ai/contracts";
import { evaluateOutputDisclosure } from "@tyr-ai/safety";

const MAX_STORED_RESULT_CHARS = 12_000;
const MAX_TELEGRAM_RESULT_HTML_CHARS = 3_600;

function resultStatusMark(status: MessageResult["status"]): string {
  if (status === "failed") return "✕";
  if (status === "partial") return "!";
  return "✓";
}

function resultAttribution(result: MessageResult): string {
  const source = result.sourceAgentName?.trim() || "Agent";
  if (result.status === "failed") return `${source} could not complete the request`;
  if (result.status === "partial") return `${source} returned a partial reply`;
  return `${source} replied`;
}

export function buildCompletedCommunicationResult(agent: AgentRecord, content: string): MessageResult {
  const redacted = evaluateOutputDisclosure({ content: content.trim(), authorized: true }).publicContent;
  const truncated = redacted.length > MAX_STORED_RESULT_CHARS;
  return {
    version: 1,
    status: "completed",
    title: "Agent reply",
    summary: `${agent.displayName || agent.name} replied.`,
    body: truncated ? redacted.slice(0, MAX_STORED_RESULT_CHARS).trimEnd() : redacted,
    sourceAgentId: agent.id,
    sourceAgentName: agent.displayName || agent.name,
    truncated: truncated || undefined
  };
}

export function communicationResultPlainText(result: MessageResult): string {
  // 外部渠道和旧客户端拿到纯文本时，也应先看到实际回复，而不是内部任务状态模板。
  const body = result.body?.trim() || result.summary.trim();
  const lines = body ? [body] : [];
  if (result.truncated) lines.push("", "Result shortened. Open Tyr to view the available result details.");
  lines.push("", `${resultStatusMark(result.status)} ${resultAttribution(result)} via TYR`);
  return lines.join("\n");
}

function escapeHtmlCharacter(character: string): string {
  if (character === "&") return "&amp;";
  if (character === "<") return "&lt;";
  if (character === ">") return "&gt;";
  if (character === '"') return "&quot;";
  return character;
}

function escapeHtmlWithinLimit(input: string, maxChars: number): { html: string; truncated: boolean } {
  let html = "";
  let truncated = false;
  for (const character of input) {
    const escaped = escapeHtmlCharacter(character);
    if (html.length + escaped.length > maxChars) {
      truncated = true;
      break;
    }
    html += escaped;
  }
  return { html, truncated };
}

function telegramResultBody(body: string): string {
  // Telegram gets channel-native formatting, so Markdown fence markers should not leak into the visible result.
  return body
    .replace(/^```[^\n]*\n?/gm, "")
    .replace(/^```\s*$/gm, "")
    .trim();
}

export function communicationResultTelegramHtml(result: MessageResult): string {
  // Telegram 保持聊天消息形态：回复正文在前，来源只作为轻量页脚。
  const attribution = escapeHtmlWithinLimit(`${resultStatusMark(result.status)} ${resultAttribution(result)} via TYR`, 600).html;
  const footer = `<i>${attribution}</i>`;
  const shortenedNotice = "\n\n<i>Result shortened. Open Tyr to view the available result details.</i>";
  const bodyBudget = Math.max(0, MAX_TELEGRAM_RESULT_HTML_CHARS - footer.length - shortenedNotice.length - 2);
  const body = escapeHtmlWithinLimit(telegramResultBody(result.body || result.summary), bodyBudget);
  const shortened = result.truncated || body.truncated;
  return `${body.html}${shortened ? shortenedNotice : ""}${body.html ? "\n\n" : ""}${footer}`;
}
