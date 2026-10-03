import { useState, type FormEvent } from "react";
import { Edit3, Plus, Trash2 } from "lucide-react";
import type { RuntimePermissionMode, RuntimeResourceGrant, RuntimeResourceGrantKind, RuntimeResourceGrantScope } from "@tyr-ai/contracts";
import { runtimeResourceGrantScopeOptions } from "./agentProfile";
import { Modal } from "./shared/ui";

type Props = {
  grants: RuntimeResourceGrant[];
  disabled?: boolean;
  controlClassName?: string;
  permissionMode?: RuntimePermissionMode;
  onChange: (grants: RuntimeResourceGrant[]) => void;
};

type PublicGrantKind = Extract<RuntimeResourceGrantKind, "directory" | "network_domain">;
type PublicRuntimeResourceGrant = Omit<RuntimeResourceGrant, "kind"> & { kind: PublicGrantKind };
type EditingGrant = { index: number | null; grant: PublicRuntimeResourceGrant };

function isPublicRuntimeResourceGrant(grant: RuntimeResourceGrant): grant is PublicRuntimeResourceGrant {
  return grant.kind === "directory" || grant.kind === "network_domain";
}

function defaultPublicGrant(kind: PublicGrantKind): PublicRuntimeResourceGrant {
  return {
    kind,
    target: "",
    scopes: kind === "directory" ? ["read"] : ["connect"]
  };
}

function normalizeGrantScopes(kind: PublicGrantKind, scopes: RuntimeResourceGrantScope[]): RuntimeResourceGrantScope[] {
  const options = runtimeResourceGrantScopeOptions(kind);
  const normalized = options.filter((scope) => scopes.includes(scope));
  return normalized.length > 0 ? normalized : options.slice(0, 1);
}

function grantKindLabel(kind: PublicGrantKind): string {
  return kind === "directory" ? "Folder" : "Website/API";
}

function grantModalTitle(kind: PublicGrantKind): string {
  return kind === "directory" ? "Folder access" : "Website/API access";
}

function grantTargetLabel(kind: PublicGrantKind): string {
  return kind === "directory" ? "Folder path" : "Domain or API host";
}

function grantTargetPlaceholder(kind: PublicGrantKind): string {
  return kind === "directory" ? "/Users/me/project-data" : "api.example.com";
}

function normalizedGrantForSave(grant: PublicRuntimeResourceGrant): PublicRuntimeResourceGrant {
  const next: PublicRuntimeResourceGrant = {
    kind: grant.kind,
    target: grant.target.trim(),
    scopes: normalizeGrantScopes(grant.kind, grant.scopes)
  };
  const label = grant.label?.trim();
  if (label) next.label = label;
  return next;
}

export function mergePublicRuntimeResourceGrants(grants: readonly RuntimeResourceGrant[], nextPublicGrants: readonly RuntimeResourceGrant[]): RuntimeResourceGrant[] {
  const publicReplacements = nextPublicGrants.filter(isPublicRuntimeResourceGrant);
  let nextPublicIndex = 0;
  const merged: RuntimeResourceGrant[] = grants.flatMap((grant): RuntimeResourceGrant[] => {
    if (!isPublicRuntimeResourceGrant(grant)) return [grant];
    const nextGrant = publicReplacements[nextPublicIndex];
    nextPublicIndex += 1;
    return nextGrant ? [nextGrant] : [];
  });
  return [...merged, ...publicReplacements.slice(nextPublicIndex)];
}

export function hasPublicRuntimeResourceGrants(grants: readonly RuntimeResourceGrant[]): boolean {
  return grants.some(isPublicRuntimeResourceGrant);
}

export function AgentRuntimeResourceGrantsEditor({ grants, disabled = false, controlClassName = "", permissionMode = "workspace-write", onChange }: Props) {
  const [editing, setEditing] = useState<EditingGrant | null>(null);
  const publicGrants = grants.filter(isPublicRuntimeResourceGrant);

  function emitPublicGrants(nextPublicGrants: PublicRuntimeResourceGrant[]) {
    onChange(mergePublicRuntimeResourceGrants(grants, nextPublicGrants));
  }

  function openAdd(kind: PublicGrantKind) {
    if (disabled) return;
    setEditing({ index: null, grant: defaultPublicGrant(kind) });
  }

  function openEdit(index: number) {
    if (disabled) return;
    const grant = publicGrants[index];
    if (!grant) return;
    setEditing({ index, grant: { ...grant, scopes: normalizeGrantScopes(grant.kind, grant.scopes) } });
  }

  function removeGrant(index: number) {
    emitPublicGrants(publicGrants.filter((_, currentIndex) => currentIndex !== index));
  }

  function updateEditingGrant(updater: (grant: PublicRuntimeResourceGrant) => PublicRuntimeResourceGrant) {
    setEditing((current) => current ? { ...current, grant: updater(current.grant) } : current);
  }

  function toggleEditingScope(scope: RuntimeResourceGrantScope, checked: boolean) {
    updateEditingGrant((grant) => {
      const selected = new Set(grant.scopes);
      if (checked) selected.add(scope);
      else selected.delete(scope);
      const nextScopes = runtimeResourceGrantScopeOptions(grant.kind).filter((item) => selected.has(item));
      return nextScopes.length > 0 ? { ...grant, scopes: nextScopes } : grant;
    });
  }

  function saveEditing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !editing.grant.target.trim()) return;
    const savedGrant = normalizedGrantForSave(editing.grant);
    const nextPublicGrants = editing.index === null
      ? [...publicGrants, savedGrant]
      : publicGrants.map((grant, index) => index === editing.index ? savedGrant : grant);
    emitPublicGrants(nextPublicGrants);
    setEditing(null);
  }

  return (
    <div className="runtime-resource-grants-editor">
      <div className="runtime-resource-grants-list">
        {publicGrants.length === 0 && <p className="muted-text runtime-resource-grants-empty">No allowed access yet.</p>}
        {publicGrants.map((grant, index) => {
          const title = grant.label?.trim() || grant.target;
          return (
            <div className="runtime-resource-grant-row" key={`${grant.kind}:${grant.target}:${index}`}>
              <div className="runtime-resource-grant-main">
                <span className="runtime-resource-grant-kind">{grantKindLabel(grant.kind)}</span>
                <b title={title}>{title}</b>
                <small title={grant.target}>{grant.target}</small>
              </div>
              <span className="runtime-resource-grant-scope-chip" title={grant.scopes.join(", ")}>{grant.scopes.join(", ")}</span>
              {!disabled && (
                <div className="runtime-resource-grant-row-actions">
                  <button className="icon-btn" type="button" aria-label={`Edit ${grantKindLabel(grant.kind)} resource`} title={`Edit ${grantKindLabel(grant.kind)} resource`} onClick={() => openEdit(index)}>
                    <Edit3 size={14} />
                  </button>
                  <button className="icon-btn danger" type="button" aria-label="Remove resource" title="Remove resource" onClick={() => removeGrant(index)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!disabled && (
        <div className="runtime-resource-grant-actions">
          <button className="btn small" type="button" onClick={() => openAdd("directory")}><Plus size={14} /> Add folder</button>
          <button className="btn small" type="button" onClick={() => openAdd("network_domain")}><Plus size={14} /> Add website/API</button>
        </div>
      )}
      {editing && (
        <Modal title={grantModalTitle(editing.grant.kind)} onClose={() => setEditing(null)}>
          <form className="runtime-resource-grant-form" onSubmit={saveEditing}>
            <label className="agent-profile-field">
              <span>Name</span>
              <input className={controlClassName} value={editing.grant.label ?? ""} onChange={(event) => updateEditingGrant((grant) => ({ ...grant, label: event.target.value }))} placeholder="Optional display name" />
            </label>
            <label className="agent-profile-field">
              <span>{grantTargetLabel(editing.grant.kind)}</span>
              <input className={controlClassName} required value={editing.grant.target} onChange={(event) => updateEditingGrant((grant) => ({ ...grant, target: event.target.value }))} placeholder={grantTargetPlaceholder(editing.grant.kind)} />
            </label>
            <div className="agent-profile-field">
              <span>Access</span>
              <div className="runtime-resource-grant-scopes">
                {runtimeResourceGrantScopeOptions(editing.grant.kind).filter((scope) => permissionMode !== "read-only" || scope !== "write").map((scope) => (
                  <label key={scope} className="member-toggle compact">
                    <input type="checkbox" checked={editing.grant.scopes.includes(scope)} onChange={(event) => toggleEditingScope(scope, event.target.checked)} />
                    <span>{scope}</span>
                  </label>
                ))}
              </div>
              {permissionMode === "read-only" && editing.grant.kind === "directory" && <small>Read-only Runtime Access cannot grant folder writes.</small>}
            </div>
            <div className="modal-actions runtime-resource-grant-form-actions">
              <button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" type="submit" disabled={!editing.grant.target.trim()}>Save access</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
