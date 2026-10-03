import React, { Children, type ReactElement, type ReactNode, isValidElement, useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, XCircle } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { copyTextToClipboard } from "../clipboard";
import { safeMessageMarkdownUrl, splitMessageMarkdown } from "./messageContent";

type CodeCopyState = "idle" | "success" | "error";

function reactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactNodeText).join("");
  if (!isValidElement(node)) return "";
  return reactNodeText((node.props as { children?: ReactNode }).children);
}

function codeLanguage(children: ReactNode): string | null {
  const child = Children.toArray(children).find(isValidElement) as ReactElement<{ className?: string }> | undefined;
  const languageClass = child?.props.className?.split(/\s+/).find((item) => item.startsWith("language-"));
  return languageClass ? languageClass.slice("language-".length) : null;
}

function MessageCodeBlock({ children }: { children?: ReactNode }) {
  const [copyState, setCopyState] = useState<CodeCopyState>("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = codeLanguage(children);
  const code = reactNodeText(children).replace(/\n$/, "");

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  async function copyCode() {
    try {
      await copyTextToClipboard(code);
      setCopyState("success");
    } catch {
      setCopyState("error");
    }
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopyState("idle"), 1800);
  }

  const copyLabel = copyState === "success" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy";
  const CopyIcon = copyState === "success" ? CheckCircle2 : copyState === "error" ? XCircle : Copy;

  return (
    <section className="message-code-block" aria-label={`${language || "Code"} code block`}>
      <header className="message-code-block-toolbar">
        <span className="message-code-block-language">{language || "Code"}</span>
        <button
          className={`message-code-copy ${copyState}`}
          type="button"
          aria-label={`Copy ${language || "code"} block`}
          onClick={() => void copyCode()}
        >
          <CopyIcon size={13} aria-hidden="true" />
          <span aria-live="polite">{copyLabel}</span>
        </button>
      </header>
      <pre className="message-content-code">{children}</pre>
    </section>
  );
}

const markdownComponents: Components = {
  a({ node: _node, href, children }) {
    if (!href) return <span className="message-markdown-unsafe-link">{children}</span>;
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
  code({ node: _node, className, children }) {
    return <code className={className || "message-inline-code"}>{children}</code>;
  },
  img({ node: _node, alt }) {
    // 消息中的远程图片不得绕过 attachment 权限与受控预览；只保留可读的替代文本。
    return <span className="message-markdown-image-alt">{alt || "Image omitted"}</span>;
  },
  input({ node: _node, ...props }) {
    return <input {...props} disabled tabIndex={-1} aria-hidden="true" />;
  },
  pre({ node: _node, children }) {
    return <MessageCodeBlock>{children}</MessageCodeBlock>;
  },
  table({ node: _node, children }) {
    return <div className="message-markdown-table-scroll"><table>{children}</table></div>;
  }
};

export function MessageMarkdown({ content }: { content: string }) {
  const parts = splitMessageMarkdown(content);

  return (
    <div className="message-content">
      {parts.map((part, index) => part.type === "attribution" ? (
        <p key={`attribution-${index}`} className="message-content-text message-result-attribution">
          <CheckCircle2 className="message-result-completed-check" size={13} role="img" aria-label="Completed" />
          <span>{part.text}</span>
        </p>
      ) : (
        <ReactMarkdown
          key={`markdown-${index}`}
          components={markdownComponents}
          remarkPlugins={[remarkGfm, remarkBreaks]}
          rehypePlugins={[[rehypeHighlight, { detect: false }]]}
          skipHtml
          urlTransform={(url) => safeMessageMarkdownUrl(url)}
        >
          {part.content}
        </ReactMarkdown>
      ))}
    </div>
  );
}
