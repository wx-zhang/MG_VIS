import { useEffect, useState } from "react";
import {
  MAX_WORKSPACE_ROUTING_INSTRUCTIONS_LENGTH,
  type WorkspaceRoutingInstructionsRecord
} from "@tyr-ai/contracts";

import { api, apiErrorMessage } from "../lib/api";
import { isOperatorAuditCancelled } from "../operatorAudit";

type Props = {
  serverId: string;
  canEdit: boolean;
  controlClassName?: string;
  compact?: boolean;
  dataSource?: {
    load: () => Promise<WorkspaceRoutingInstructionsRecord>;
    save: (input: { instructions: string; expectedRevision: number }) => Promise<WorkspaceRoutingInstructionsRecord>;
  };
};

export function TyrRoutingInstructionsEditor({ serverId, canEdit, controlClassName = "", compact = false, dataSource }: Props) {
  const [record, setRecord] = useState<WorkspaceRoutingInstructionsRecord | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage("");
    const request = dataSource
      ? dataSource.load()
      : api<WorkspaceRoutingInstructionsRecord>(`/api/servers/${encodeURIComponent(serverId)}/routing-instructions`);
    void request
      .then((next) => {
        if (!active) return;
        setRecord(next);
        setDraft(next.instructions);
      })
      .catch((error) => {
        if (active) setMessage(apiErrorMessage(error, "Routing instructions could not be loaded."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [serverId, dataSource]);

  const changed = record !== null && draft !== record.instructions;

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const next = dataSource
        ? await dataSource.save({ instructions: draft, expectedRevision: record?.revision ?? 0 })
        : await api<WorkspaceRoutingInstructionsRecord>(`/api/servers/${encodeURIComponent(serverId)}/routing-instructions`, {
            method: "PATCH",
            body: JSON.stringify({ instructions: draft })
          });
      setRecord(next);
      setDraft(next.instructions);
      // TYR 在服务端执行，因此保存成功就是所有入口的生效边界，不显示 daemon Pending。
      setMessage(`Saved. TYR is using revision ${next.revision} for all message sources.`);
    } catch (error) {
      if (isOperatorAuditCancelled(error)) return;
      setMessage(apiErrorMessage(error, "Routing instructions could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agent-profile-field wide tyr-routing-instructions-editor">
      <span>Workspace Routing Instructions</span>
      <p className="field-hint">Owner-defined routing and response preferences for TYR, including how it presents Agent results across Web, Email, Telegram, MCP, and connected workspaces. Platform safety and permissions remain authoritative.</p>
      {record && <div className="profile-apply-status applied" aria-live="polite">
        <span><i aria-hidden="true" />Active</span>
        <small>Server revision {record.revision}{record.updatedAt ? ` · ${new Date(record.updatedAt).toLocaleString()}` : ""}</small>
      </div>}
      <textarea
        className={controlClassName}
        disabled={loading || saving || !canEdit}
        rows={compact ? 4 : 5}
        maxLength={MAX_WORKSPACE_ROUTING_INSTRUCTIONS_LENGTH}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Example: Route reservation requests to Sable. Ask for clarification when no matching Agent is available."
      />
      {canEdit && <div className="inline-actions agent-profile-actions">
        <button className={compact ? "inspector-action-button primary" : "btn primary small"} disabled={!changed || loading || saving} onClick={() => void save()}>{saving ? "Saving" : "Save Routing Instructions"}</button>
        <button className={compact ? "inspector-action-button" : "btn small"} disabled={!changed || saving} onClick={() => {
          setDraft(record?.instructions ?? "");
          setMessage("");
        }}>Discard</button>
      </div>}
      {message && <span className={message.startsWith("Saved.") ? "profile-save-message" : "profile-save-message error"}>{message}</span>}
    </div>
  );
}
