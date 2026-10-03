import { type RefObject, useEffect, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import { uploadAttachment } from "./lib/api";
import { formatBytes } from "./app/workspaceUtils";

export type ComposerAttachmentDraft = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploading" | "ready" | "failed";
  attachmentId?: string;
  previewUrl?: string;
  error?: string;
};

export type ComposerAttachmentsState = {
  fileRef: RefObject<HTMLInputElement | null>;
  drafts: ComposerAttachmentDraft[];
  uploading: boolean;
  blocked: boolean;
  attachmentIds: string[];
  uploadFile: (file: File) => Promise<void>;
  removeAttachment: (draftId: string) => void;
  resetAttachments: () => void;
};

export function composerAttachmentDraftFromFile(file: File, id: string, previewUrl?: string): ComposerAttachmentDraft {
  return {
    id,
    filename: file.name || "attachment",
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    status: "uploading",
    ...(previewUrl ? { previewUrl } : {})
  };
}

export function readyComposerAttachmentIds(drafts: ComposerAttachmentDraft[]): string[] {
  return drafts
    .filter((draft) => draft.status === "ready" && Boolean(draft.attachmentId))
    .map((draft) => draft.attachmentId!);
}

export function composerAttachmentSendBlocked(drafts: ComposerAttachmentDraft[]): boolean {
  return drafts.some((draft) => draft.status === "uploading" || draft.status === "failed");
}

export function cleanupComposerAttachmentPreviews(drafts: ComposerAttachmentDraft[], revokeObjectUrl = defaultRevokeObjectUrl): void {
  for (const draft of drafts) {
    if (draft.previewUrl) revokeObjectUrl(draft.previewUrl);
  }
}

export function useComposerAttachments(channelId?: string): ComposerAttachmentsState {
  const [drafts, setDrafts] = useState<ComposerAttachmentDraft[]>([]);
  const draftsRef = useRef(drafts);
  const nextIdRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachmentIds = readyComposerAttachmentIds(drafts);
  const uploading = drafts.some((draft) => draft.status === "uploading");
  const blocked = composerAttachmentSendBlocked(drafts);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => () => {
    // Local preview URLs are browser resources; release any still-owned URLs if the composer unmounts.
    cleanupComposerAttachmentPreviews(draftsRef.current);
  }, []);

  async function uploadFile(file: File) {
    if (!channelId) throw new Error("Open a conversation before uploading a file.");
    const draftId = `draft_${Date.now()}_${nextIdRef.current++}`;
    const previewUrl = localPreviewUrl(file);
    setDrafts((current) => [...current, composerAttachmentDraftFromFile(file, draftId, previewUrl)]);
    try {
      const data = await uploadAttachment(file, channelId);
      setDrafts((current) => current.map((draft) => draft.id === draftId ? {
        ...draft,
        status: "ready",
        attachmentId: data.id,
        error: undefined
      } : draft));
    } catch (error) {
      setDrafts((current) => current.map((draft) => draft.id === draftId ? {
        ...draft,
        status: "failed",
        error: error instanceof Error ? error.message : "Upload failed"
      } : draft));
    }
  }

  function removeAttachment(draftId: string) {
    setDrafts((current) => {
      const removed = current.filter((draft) => draft.id === draftId);
      cleanupComposerAttachmentPreviews(removed);
      return current.filter((draft) => draft.id !== draftId);
    });
  }

  function resetAttachments() {
    setDrafts((current) => {
      cleanupComposerAttachmentPreviews(current);
      return [];
    });
  }

  return {
    fileRef,
    drafts,
    uploading,
    blocked,
    attachmentIds,
    uploadFile,
    removeAttachment,
    resetAttachments
  };
}

export function ComposerAttachmentPreviewList({ attachments, onRemove }: { attachments: ComposerAttachmentDraft[]; onRemove: (draftId: string) => void }) {
  if (attachments.length === 0) return null;

  return (
    <div className="composer-attachment-preview-list" aria-label="Attached files">
      {attachments.map((attachment) => (
        <div key={attachment.id} className={`composer-attachment-preview ${attachment.status}`}>
          <span className="composer-attachment-thumb" aria-hidden="true">
            {attachment.previewUrl ? <img src={attachment.previewUrl} alt="" /> : <FileText size={16} />}
          </span>
          <span className="composer-attachment-copy">
            <b className="composer-attachment-name">{attachment.filename}</b>
            <small>{composerAttachmentStatusText(attachment)}</small>
          </span>
          <button className="composer-attachment-remove" type="button" onClick={() => onRemove(attachment.id)} aria-label={`Remove ${attachment.filename}`} title="Remove attachment">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

function composerAttachmentStatusText(attachment: ComposerAttachmentDraft): string {
  if (attachment.status === "uploading") return "Uploading...";
  if (attachment.status === "failed") return attachment.error || "Upload failed";
  return formatBytes(attachment.sizeBytes);
}

function localPreviewUrl(file: File): string | undefined {
  if (!file.type.startsWith("image/")) return undefined;
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return undefined;
  return URL.createObjectURL(file);
}

function defaultRevokeObjectUrl(url: string): void {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}
