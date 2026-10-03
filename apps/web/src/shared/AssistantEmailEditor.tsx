import { useEffect, useId, useState } from "react";
import { normalizeTyrEmailLocalPart, tyrEmailLocalPartError, type TyrEmailSettings } from "@tyr-ai/contracts";
import { api, apiErrorMessage } from "../lib/api";

const candidateMessages = {
  invalid_email_alias: "Use 3–32 lowercase letters, numbers, or hyphens. Start and end with a letter or number.",
  reserved_email_alias: "This name is reserved. Choose another name.",
  email_alias_taken: "This address is already taken. Choose another name."
};

export function AssistantEmailEditor({ agentId, settings, onSaved }: {
  agentId: string; settings: TyrEmailSettings; onSaved: (settings: TyrEmailSettings) => void;
}) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [localPart, setLocalPart] = useState("");
  const [expectedAddress, setExpectedAddress] = useState("");
  const [checked, setChecked] = useState<TyrEmailSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const normalized = normalizeTyrEmailLocalPart(localPart);
  const validationError = tyrEmailLocalPartError(normalized);
  const candidate = checked?.candidate?.localPart === normalized ? checked.candidate : undefined;

  useEffect(() => {
    setChecked(null);
    setError("");
    if (!editing || validationError) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<TyrEmailSettings>(`/api/agents/${encodeURIComponent(agentId)}/email?localPart=${encodeURIComponent(normalized)}`,
        { signal: controller.signal }).then((payload) => { if (active) setChecked(payload); })
        .catch((cause) => { if (active) setError(apiErrorMessage(cause)); });
    }, 250);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [agentId, editing, normalized, validationError]);

  async function save() {
    if (!candidate?.available || validationError || saving) return;
    setSaving(true);
    setError("");
    try {
      const payload = await api<TyrEmailSettings>(`/api/agents/${encodeURIComponent(agentId)}/email`, {
        method: "PATCH", body: JSON.stringify({ localPart: normalized, expectedAddress })
      });
      onSaved(payload);
      setEditing(false);
    } catch (cause) { setError(apiErrorMessage(cause)); }
    finally { setSaving(false); }
  }

  if (!settings.canCustomize) return null;
  if (!editing) return <button type="button" className="assistant-contact-copy-button" onClick={() => {
    const current = settings.address.split("@")[0] ?? "";
    setLocalPart(tyrEmailLocalPartError(current) ? "" : current);
    setExpectedAddress(settings.address);
    setError("");
    setEditing(true);
  }}>Customize email</button>;

  const suggestions = checked?.suggestions ?? settings.suggestions;
  const message = validationError ? candidateMessages[validationError]
    : candidate?.reason ? candidateMessages[candidate.reason]
    : candidate?.available ? (candidate.address === settings.address ? "This is your current address." : "Address available.")
    : "Checking availability…";

  return <form className="assistant-email-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <label className="field-label" htmlFor={inputId}>TYR email address</label>
    <div className="assistant-email-input">
      <input id={inputId} className="input" value={localPart} maxLength={32} autoFocus autoComplete="off"
        autoCapitalize="none" spellCheck={false} disabled={saving} placeholder="acme-assistant"
        aria-describedby={`${inputId}-status`} aria-invalid={Boolean(validationError || candidate?.reason)}
        onChange={(event) => { setLocalPart(event.target.value.toLowerCase()); setError(""); }} />
      <span>@{settings.domain}</span>
    </div>
    <p id={`${inputId}-status`} role="status">{error || message}</p>
    {suggestions.length > 0 && (!candidate?.available || candidate.address === settings.address) && <div className="assistant-email-suggestions" aria-label="Suggested email names">
      <span>Suggestions</span>
      {suggestions.map((suggestion) => <button type="button" className="assistant-contact-copy-button" key={suggestion}
        disabled={saving} onClick={() => setLocalPart(suggestion)}>{suggestion}</button>)}
    </div>}
    <p>Your previous addresses will keep receiving email. Existing conversations stay connected.</p>
    {settings.previousAddresses.length > 0 && <details><summary>Previous addresses</summary>
      <ul>{settings.previousAddresses.map((address) => <li key={address}>{address}</li>)}</ul>
    </details>}
    <div className="assistant-email-buttons">
      <button className="assistant-contact-copy-button" type="submit"
        disabled={saving || Boolean(validationError) || !candidate?.available || candidate.address === settings.address}>
        {saving ? "Saving…" : "Save address"}
      </button>
      <button className="assistant-contact-copy-button" type="button" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
    </div>
  </form>;
}
