import { CheckCircle2, Copy, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import {
  connectCommandCredentialKind,
  connectCommandCredentialSummary,
  connectCommandSegments,
  type ConnectCommandCredentialKind
} from "../connectCommand";
import { SectionLabel } from "../shared/ui";

type ConnectCommandPanelProps = {
  title?: string;
  headerExtra?: ReactNode;
  help?: ReactNode;
  note?: ReactNode;
  command?: string;
  statusText: string;
  credentialKind?: ConnectCommandCredentialKind;
  credentialUnavailable?: boolean;
  copyStatus?: string;
  highlightCredential?: boolean;
  hideCredentialBadge?: boolean;
  onCopy?: () => void;
  onRegenerate?: () => void;
  className?: string;
};

export function ConnectCommandPanel({
  title,
  headerExtra,
  help,
  note,
  command,
  statusText,
  credentialKind,
  credentialUnavailable,
  copyStatus,
  highlightCredential,
  hideCredentialBadge,
  onCopy,
  onRegenerate,
  className
}: ConnectCommandPanelProps) {
  const detectedCredentialKind = credentialKind ?? connectCommandCredentialKind(command);
  const credential = hideCredentialBadge
    ? null
    : command
    ? connectCommandCredentialSummary(detectedCredentialKind)
    : credentialUnavailable
      ? connectCommandCredentialSummary(undefined)
      : null;
  const segments = command ? connectCommandSegments(command) : [{ text: statusText, highlight: false }];
  // copyStatus also carries regeneration guidance; only the successful copy state changes the button affordance.
  const copyFeedbackActive = copyStatus === "Connect command copied.";
  const copyButtonLabel = copyFeedbackActive ? "Copied" : "Copy connect command";
  const copyButtonClassName = ["command-copy inspector-action-button", copyFeedbackActive ? "copy-success" : ""].filter(Boolean).join(" ");
  return (
    <div className={["connect-command-panel", className, highlightCredential ? "highlight-credential" : ""].filter(Boolean).join(" ")}>
      <div className="connect-command-panel-head">
        {title && <SectionLabel label={title} />}
      </div>
      {help && <div className="connect-command-help">{help}</div>}
      <div className="connect-command-panel-meta">
        {headerExtra}
        {credential && <span className={`connect-command-badge ${credential.tone}`}>{credential.label}</span>}
        <div className="inspector-command-actions" aria-label="Connect command actions">
          <button className={copyButtonClassName} type="button" title={copyButtonLabel} aria-label={copyButtonLabel} disabled={!command || !onCopy} onClick={() => onCopy?.()}>{copyFeedbackActive ? <CheckCircle2 size={15} /> : <Copy size={15} />}</button>
          {onRegenerate && <button className="inspector-action-button" type="button" title="Regenerate connect command" aria-label="Regenerate connect command" onClick={() => onRegenerate()}><RefreshCw size={14} /></button>}
        </div>
      </div>
      <div className="command-line inspector-command-line">
        <pre className="command-box connect-command-box">{segments.map((segment, index) => segment.highlight
            ? <mark key={`${index}:${segment.text}`} className="connect-command-part">{segment.text}</mark>
            : <span key={`${index}:${segment.text}`}>{segment.text}</span>)}</pre>
      </div>
      {copyStatus && <p className="copy-feedback" role="status">{copyStatus}</p>}
      {note && <div className="connect-command-note">{note}</div>}
    </div>
  );
}
