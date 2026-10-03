export type MessageMarkdownPart =
  | { type: "markdown"; content: string }
  | { type: "attribution"; text: string };

const tyrCompletionAttributionPattern = /^✓ ([^\n]+ replied via TYR)$/;

export function normalizeMessageMarkdown(content: string): string {
  // 历史 Agent 输出可能把带语言代码围栏附着在说明文字后；只修正该精确边界，其他 Markdown 仍交给标准 parser。
  return content.replace(/([^\r\n`])```([A-Za-z0-9_-]+)([ \t]*\r?\n)/g, "$1\n```$2$3");
}

export function splitMessageMarkdown(content: string): MessageMarkdownPart[] {
  const normalizedContent = normalizeMessageMarkdown(content);
  const lines = normalizedContent.split("\n");
  const parts: MessageMarkdownPart[] = [];
  let markdownLines: string[] = [];

  function pushMarkdown() {
    if (markdownLines.length === 0) return;
    parts.push({ type: "markdown", content: markdownLines.join("\n") });
    markdownLines = [];
  }

  for (const line of lines) {
    const attribution = tyrCompletionAttributionPattern.exec(line);
    if (!attribution) {
      markdownLines.push(line);
      continue;
    }
    pushMarkdown();
    // 旧消息把结果来源保存为正文独立行；单独建模可保留成功图标而不污染 Markdown AST。
    parts.push({ type: "attribution", text: attribution[1] });
  }
  pushMarkdown();

  return parts.length > 0 ? parts : [{ type: "markdown", content: "" }];
}

export function safeMessageMarkdownUrl(value: string): string {
  return /^(?:https?:|mailto:)/i.test(value.trim()) ? value : "";
}
