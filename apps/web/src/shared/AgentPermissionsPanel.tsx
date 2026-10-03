import { useEffect, useState } from "react";
import {
  AGENT_ACTIVE_CAPABILITIES,
  AGENT_PLANNED_CAPABILITIES,
  type AgentCapability,
  type AgentScopes
} from "@tyr-ai/contracts";
import {
  AGENT_PERMISSION_PRESETS,
  agentCapabilityPlanningState,
  agentPermissionDraftChanged,
  agentPermissionPresetCapabilities,
  agentPermissionPresetForCapabilities,
  type AgentPermissionPresetId
} from "../agentProfile";
import { api } from "../lib/api";

export function AgentPermissionsPanel({ agentId, variant, onDirtyChange }: { agentId: string; variant: "full" | "compact"; onDirtyChange?: (dirty: boolean) => void }) {
  const [scopes, setScopes] = useState<AgentScopes | null>(null);
  const [draft, setDraft] = useState<Set<AgentCapability>>(new Set());
  const [selectedPreset, setSelectedPreset] = useState<AgentPermissionPresetId | "custom">("default");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await api<AgentScopes>(`/api/agents/${agentId}/scopes`);
        if (!active) return;
        setScopes(data);
        setDraft(new Set(data.granted));
        setSelectedPreset(agentPermissionPresetForCapabilities(data.granted, data.mode));
        setStatus("");
      } catch (err) {
        if (active) setStatus(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [agentId]);

  const draftCapabilities = [...draft];
  const changed = scopes ? agentPermissionDraftChanged(scopes, draftCapabilities, selectedPreset) : false;
  const activePreset = selectedPreset === "custom" ? null : AGENT_PERMISSION_PRESETS.find((preset) => preset.id === selectedPreset) ?? null;
  const capabilities = [...AGENT_ACTIVE_CAPABILITIES, ...AGENT_PLANNED_CAPABILITIES];

  useEffect(() => {
    onDirtyChange?.(changed);
  }, [changed, onDirtyChange]);

  useEffect(() => {
    if (!changed) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [changed]);

  function toggleCapability(capability: AgentCapability) {
    if (agentCapabilityPlanningState(capability)) return;
    setDraft((current) => {
      const next = new Set(current);
      if (next.has(capability)) next.delete(capability);
      else next.add(capability);
      setSelectedPreset(agentPermissionPresetForCapabilities([...next], "custom"));
      return next;
    });
  }

  function applyPreset(presetId: AgentPermissionPresetId) {
    setDraft(new Set(agentPermissionPresetCapabilities(presetId)));
    setSelectedPreset(presetId);
    setStatus("");
  }

  async function save() {
    if (!scopes) return;
    setBusy(true);
    try {
      const data = selectedPreset === "default"
        ? await api<AgentScopes>(`/api/agents/${agentId}/scopes`, { method: "DELETE" })
        : await api<AgentScopes>(`/api/agents/${agentId}/scopes`, {
          method: "PATCH",
          // Capability grants are enforcement input for internal APIs and inbox delivery, not just display metadata.
          body: JSON.stringify(draftCapabilities)
        });
      setScopes(data);
      setDraft(new Set(data.granted));
      setSelectedPreset(agentPermissionPresetForCapabilities(data.granted, data.mode));
      setStatus(`Saved permissions · rev ${data.revision}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`permissions-view agent-permissions-panel ${variant === "compact" ? "inspector-permissions-view compact" : "full"}`}>
      <div className="permission-column">
        <div className="permission-summary">
          <span className="permission-summary-copy">
            <b>{selectedPreset === "custom" ? "Custom permissions" : `${activePreset?.label ?? "Default"} permissions`}</b>
            <small>{selectedPreset === "custom" ? "This agent uses a manually edited capability set." : activePreset?.text}</small>
          </span>
          <button className="btn small" disabled={busy || !scopes || (selectedPreset === "default" && !changed)} onClick={() => applyPreset("default")}>Use default</button>
        </div>
        <div className="permission-presets" aria-label="Agent permission presets">
          {AGENT_PERMISSION_PRESETS.map((preset) => (
            <button key={preset.id} className={selectedPreset === preset.id ? "active" : ""} disabled={busy || !scopes} onClick={() => applyPreset(preset.id)}>
              <b>{preset.label}</b>
              <small>{preset.text}</small>
            </button>
          ))}
        </div>
        <div className="permission-block">
          <div className="permission-block-head">
            <b>Tyr capabilities</b>
            <small>Service API and inbox permissions are enforced independently from local Runtime Access.</small>
          </div>
          <div className="permission-capability-grid">
            {capabilities.map((capability) => {
              const planning = agentCapabilityPlanningState(capability);
              return (
                <label key={capability} className={`permission-row${planning ? " planned disabled" : ""}`} title={planning?.reason}>
                  <input type="checkbox" disabled={Boolean(planning) || busy || !scopes} checked={!planning && draft.has(capability)} onChange={() => toggleCapability(capability)} />
                  <span>
                    <b>{capability}</b>
                    {planning && <em>{planning.badge}</em>}
                    <small>{planning?.reason ?? "Granted capability"}</small>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="permission-actions">
          <button className={variant === "compact" ? "btn primary small" : "btn primary"} disabled={!changed || busy || !scopes} onClick={() => void save()}>Save permissions</button>
          <button className={variant === "compact" ? "btn small" : "btn"} disabled={!changed || busy || !scopes} onClick={() => {
            if (!scopes) return;
            setDraft(new Set(scopes.granted));
            setSelectedPreset(agentPermissionPresetForCapabilities(scopes.granted, scopes.mode));
            setStatus("");
          }}>Discard</button>
          <span className="permission-revision">rev {scopes?.revision ?? 0}</span>
          {status && <span>{status}</span>}
        </div>
      </div>
    </div>
  );
}
