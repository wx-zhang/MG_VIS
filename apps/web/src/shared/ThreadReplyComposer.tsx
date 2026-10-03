import { type ReactNode, type RefObject } from "react";
import { Paperclip, Send } from "lucide-react";
import { ComposerAttachmentPreviewList, type ComposerAttachmentDraft } from "../composerAttachments";

type ThreadReplyAttachments = {
  fileRef: RefObject<HTMLInputElement | null>;
  uploading: boolean;
  blocked: boolean;
  attachmentIds: string[];
  drafts: ComposerAttachmentDraft[];
  uploadFile: (file: File) => Promise<void> | void;
  removeAttachment: (draftId: string) => void;
};

export function ThreadReplyComposer({ archived, disabled, readOnlyMessage, content, attachments, quoteCard, canSend, onContentChange, onSend }: {
  archived: boolean;
  disabled: boolean;
  readOnlyMessage?: string;
  content: string;
  attachments: ThreadReplyAttachments;
  quoteCard?: ReactNode;
  canSend: boolean;
  onContentChange: (value: string) => void;
  onSend: () => Promise<void> | void;
}) {
  return (
    <div className="thread-composer">
      {archived && <div className="archived-banner">{readOnlyMessage ?? "This conversation is archived. Restore it before replying in thread."}</div>}
      {quoteCard}
      <ComposerAttachmentPreviewList attachments={attachments.drafts} onRemove={attachments.removeAttachment} />
      <form className="composer-row thread-composer-row" onSubmit={(event) => {
        event.preventDefault();
        if (canSend) void onSend();
      }}>
        <input ref={attachments.fileRef} type="file" hidden onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void attachments.uploadFile(file);
          event.currentTarget.value = "";
        }} />
        <button className="icon-btn" type="button" disabled={disabled || attachments.uploading} onClick={() => attachments.fileRef.current?.click()} title="Attach" aria-label="Attach"><Paperclip size={16} /></button>
        <textarea
          rows={1}
          value={content}
          disabled={disabled}
          onChange={(event) => onContentChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSend) void onSend();
            }
          }}
          placeholder="Message thread"
          aria-label="Message thread"
        />
        <button className="btn primary" type="submit" disabled={!canSend} title="Send reply" aria-label="Send reply"><Send size={16} /></button>
      </form>
    </div>
  );
}
