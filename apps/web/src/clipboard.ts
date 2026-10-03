type ClipboardLike = {
  writeText: (text: string) => Promise<void> | void;
};

type TextareaLike = {
  value: string;
  style: {
    position: string;
    opacity: string;
  };
  select: () => void;
  remove: () => void;
};

type ClipboardDocumentLike = {
  body: {
    append: (node: TextareaLike) => void;
  };
  createElement: (tagName: "textarea") => TextareaLike;
  execCommand: (command: "copy") => boolean;
};

type CopyTextEnvironment = {
  clipboard?: ClipboardLike | null;
  document?: ClipboardDocumentLike | null;
};

export async function copyTextToClipboard(text: string, environment: CopyTextEnvironment = {}): Promise<void> {
  const clipboard = "clipboard" in environment
    ? environment.clipboard
    : typeof navigator === "undefined" ? undefined : navigator.clipboard;
  let clipboardError: unknown;

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  const clipboardDocument = "document" in environment
    ? environment.document
    : typeof document === "undefined" ? undefined : document as unknown as ClipboardDocumentLike;

  if (!clipboardDocument) {
    if (clipboardError instanceof Error) throw clipboardError;
    throw new Error("Clipboard API is not available.");
  }

  // 开发环境可能不是安全剪贴板上下文，或 writeText 被浏览器拒绝；textarea fallback 保证连接命令仍可复制。
  const textarea = clipboardDocument.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  clipboardDocument.body.append(textarea);
  textarea.select();
  try {
    if (!clipboardDocument.execCommand("copy")) throw new Error("Copy command was rejected.");
  } finally {
    textarea.remove();
  }
}
