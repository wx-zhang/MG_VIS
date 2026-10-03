import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import type { OperatorAuditMetadata } from "../operatorAudit";

export function OperatorAuditDialog({ action, onConfirm, onCancel }: {
  action: string;
  onConfirm: (metadata: OperatorAuditMetadata) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState(`${action} for the Marlow Green demo`);
  const [reference, setReference] = useState("MARLOW-GREEN-DEMO");
  const valid = reason.trim().length >= 8 && reference.trim().length > 0;

  return (
    <div className="operator-audit-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form className="operator-audit-dialog" role="dialog" aria-modal="true" aria-labelledby="operator-audit-title" onSubmit={(event) => {
        event.preventDefault();
        if (valid) onConfirm({ reason: reason.trim(), reference: reference.trim() });
      }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}>
        <header><span><ShieldCheck size={17} /> Record this action</span><button className="icon-btn" type="button" aria-label="Cancel action" onClick={onCancel}><X size={17} /></button></header>
        <h2 id="operator-audit-title">{action}</h2>
        <p>Operator changes are recorded with your identity, reason, and reference.</p>
        <label>Reason<input autoFocus value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>
        <label>Reference<input value={reference} maxLength={200} onChange={(event) => setReference(event.target.value)} /></label>
        <div className="operator-audit-actions"><button type="button" onClick={onCancel}>Cancel</button><button className="primary" type="submit" disabled={!valid}>Continue</button></div>
      </form>
    </div>
  );
}
