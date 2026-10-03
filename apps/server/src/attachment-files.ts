import type {
  AttachmentPreviewResponse,
  AttachmentPreviewType,
  AttachmentRecord,
  ChannelFileItem,
  MessageRecord
} from "@tyr-ai/contracts";
import { sanitizeHumanVisibleText, sanitizeHumanVisibleValue } from "./output-disclosure";

const PREVIEW_TEXT_LIMIT_BYTES = 64 * 1024;

type AttachmentPreviewInput = Pick<AttachmentRecord, "filename" | "mimeType">;
type UploadedAttachmentInput = {
  size: number;
  mimetype?: string;
  originalname?: string;
};

const ARCHIVE_EXTENSIONS = [
  ".tar.bz2",
  ".tar.lz4",
  ".tar.lzma",
  ".tar.zst",
  ".tar.gz",
  ".tar.xz",
  ".tar.br",
  ".tbz2",
  ".sitx",
  ".tzst",
  ".zipx",
  ".cpio",
  ".lzma",
  ".tgz",
  ".tbz",
  ".txz",
  ".taz",
  ".jar",
  ".war",
  ".ear",
  ".ace",
  ".arc",
  ".arj",
  ".bz2",
  ".cab",
  ".lha",
  ".lzh",
  ".lz4",
  ".rar",
  ".sit",
  ".tar",
  ".zst",
  ".zoo",
  ".zip",
  ".7z",
  ".br",
  ".gz",
  ".lz",
  ".xz",
  ".z"
] as const;

const ARCHIVE_MIME_TYPES = new Set([
  "application/br",
  "application/gzip",
  "application/java-archive",
  "application/vnd.ms-cab-compressed",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "application/x-ace-compressed",
  "application/x-arj",
  "application/x-brotli",
  "application/x-bzip",
  "application/x-bzip2",
  "application/x-cab-compressed",
  "application/x-compress",
  "application/x-cpio",
  "application/x-freearc",
  "application/x-gtar",
  "application/x-gzip",
  "application/x-lha",
  "application/x-lharc",
  "application/x-lzip",
  "application/x-lz4",
  "application/x-lzma",
  "application/x-rar",
  "application/x-rar-compressed",
  "application/x-stuffit",
  "application/x-stuffitx",
  "application/x-tar",
  "application/x-xz",
  "application/x-zip",
  "application/x-zip-compressed",
  "application/x-zoo",
  "application/x-zstd",
  "application/zip",
  "application/zstd",
  "multipart/x-zip"
]);

const GENERAL_ATTACHMENT_MIME_PATTERNS = [
  /^image\//,
  /^video\//,
  /^text\//,
  /^application\/(pdf|json|octet-stream)$/
];

const RASTER_IMAGE_MIME_BY_EXTENSION: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.png$/i, "image/png"],
  [/\.jpe?g$/i, "image/jpeg"],
  [/\.gif$/i, "image/gif"],
  [/\.webp$/i, "image/webp"]
];

export function archiveExtensionForFilename(filename: string): string | undefined {
  const normalized = filename.trim().toLowerCase();
  // 复合后缀必须先于单后缀匹配，避免把 .tar.gz 仅识别成 .gz。
  return ARCHIVE_EXTENSIONS.find((extension) => normalized.endsWith(extension));
}

export function isArchiveAttachment(attachment: AttachmentPreviewInput): boolean {
  const mimeType = attachment.mimeType.split(";", 1)[0].trim().toLowerCase();
  return Boolean(archiveExtensionForFilename(attachment.filename)) || ARCHIVE_MIME_TYPES.has(mimeType);
}

export function validateUploadedFile(file: UploadedAttachmentInput | undefined): { ok: true } | { ok: false; status: number; error: string } {
  if (!file) return { ok: false, status: 400, error: "file_required" };
  if (file.size <= 0) return { ok: false, status: 400, error: "empty_file_not_allowed" };
  const mimeType = (file.mimetype || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
  const allowedByMime = GENERAL_ATTACHMENT_MIME_PATTERNS.some((pattern) => pattern.test(mimeType)) || ARCHIVE_MIME_TYPES.has(mimeType);
  // 不同浏览器和 CLI 对同一归档格式会发送不同 MIME；已知归档后缀作为附件下载场景的兼容判断。
  if (!allowedByMime && !archiveExtensionForFilename(file.originalname || "")) {
    return { ok: false, status: 415, error: "unsupported_attachment_type" };
  }
  return { ok: true };
}

export function effectiveAttachmentMimeType(attachment: AttachmentPreviewInput): string {
  const declared = attachment.mimeType.trim().toLowerCase() || "application/octet-stream";
  if (declared !== "application/octet-stream") return declared;
  // 旧版 Agent 上传没有携带 Blob type；仅为安全的栅格图片扩展名恢复预览 MIME，不推断 SVG/HTML。
  return RASTER_IMAGE_MIME_BY_EXTENSION.find(([pattern]) => pattern.test(attachment.filename))?.[1] ?? declared;
}

export function attachmentPreviewType(attachment: AttachmentPreviewInput): AttachmentPreviewType {
  const mime = effectiveAttachmentMimeType(attachment);
  const filename = attachment.filename.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "text/markdown" || filename.endsWith(".md") || filename.endsWith(".markdown")) return "markdown";
  if (mime === "application/json" || filename.endsWith(".json")) return "json";
  if (mime === "text/csv" || filename.endsWith(".csv")) return "csv";
  if (mime.startsWith("text/")) return "text";
  return "download";
}

export function listChannelFileItems(
  messages: MessageRecord[],
  getAttachment: (attachmentId: string) => AttachmentRecord | null
): ChannelFileItem[] {
  const files: ChannelFileItem[] = [];
  for (const message of messages) {
    for (const attachmentId of message.attachmentIds ?? []) {
      const attachment = getAttachment(attachmentId);
      if (!attachment) continue;
      files.push({
        id: attachment.id,
        attachmentId: attachment.id,
        channelId: attachment.channelId,
        messageId: message.id,
        filename: attachment.filename,
        mimeType: effectiveAttachmentMimeType(attachment),
        sizeBytes: attachment.sizeBytes,
        senderType: message.senderType,
        senderId: message.senderId,
        senderName: message.senderName,
        createdAt: attachment.createdAt,
        messageCreatedAt: message.createdAt,
        previewType: attachmentPreviewType(attachment)
      });
    }
  }
  // Files tab 以最近上传优先，符合协作工具里回溯最新产物的阅读习惯。
  return files.sort((a, b) => b.messageCreatedAt.localeCompare(a.messageCreatedAt));
}

export function buildAttachmentPreview(
  attachment: AttachmentRecord,
  content: Buffer,
  urls: { inlineUrl: string; downloadUrl: string }
): AttachmentPreviewResponse {
  const previewType = attachmentPreviewType(attachment);
  const mimeType = effectiveAttachmentMimeType(attachment);
  const base = {
    attachmentId: attachment.id,
    filename: attachment.filename,
    mimeType,
    sizeBytes: attachment.sizeBytes,
    previewType,
    inlineUrl: urls.inlineUrl,
    downloadUrl: urls.downloadUrl
  };

  if (previewType === "image" || previewType === "download") return base;

  const truncated = content.length > PREVIEW_TEXT_LIMIT_BYTES;
  const previewBuffer = truncated ? content.subarray(0, PREVIEW_TEXT_LIMIT_BYTES) : content;
  let text = previewBuffer.toString("utf8");

  // 文本附件预览属于人类可见出口，必须与消息和 execution 使用同一凭据披露规则。
  return {
    ...base,
    content: sanitizeAttachmentText(attachment, text),
    truncated
  };
}

export function sanitizeAttachmentText(attachment: AttachmentPreviewInput, text: string): string {
  if (attachmentPreviewType(attachment) === "json") {
    try {
      // JSON 凭据常以字段和值分开存放，必须先按字段语义脱敏，再格式化给用户。
      return JSON.stringify(sanitizeHumanVisibleValue(JSON.parse(text)), null, 2);
    } catch {
      // 非标准 JSON 仍按普通文本执行凭据扫描，避免预览或下载失败。
    }
  }
  return sanitizeHumanVisibleText(text);
}
