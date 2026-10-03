import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { ResourceGrantRecord, ResourceGrantScope, ResourceType } from "@tyr-ai/contracts";
import { api } from "./lib/api";

type GrantItem = ResourceGrantRecord & {
  grantee: { id: string; name: string; displayName: string; email: string | null } | null;
};

type Props = {
  resourceType: ResourceType;
  resourceId: string;
  allowedScopes: ResourceGrantScope[];
  defaultScopes?: ResourceGrantScope[];
  onChanged?: () => void | Promise<void>;
  variant?: "card" | "plain";
  showHeading?: boolean;
};

export function ResourceSharingPanel({ resourceType, resourceId, allowedScopes, defaultScopes, onChanged, variant = "card", showHeading = true }: Props) {
  const allowedScopeKey = allowedScopes.join("|");
  const defaultScopeKey = defaultScopes?.join("|") ?? "";
  const initialScopes = useMemo(() => defaultScopes?.length ? defaultScopes : allowedScopes.slice(0, 1), [allowedScopeKey, defaultScopeKey]);
  const [grants, setGrants] = useState<GrantItem[]>([]);
  const [granteeId, setGranteeId] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<ResourceGrantScope[]>(initialScopes);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    if (!resourceId) return;
    try {
      const data = await api<{ grants: GrantItem[] }>(`/api/resource-grants?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}`);
      setGrants(data.grants);
      setMessage("");
    } catch (error) {
      setGrants([]);
      setMessage(error instanceof Error ? error.message : "Sharing load failed.");
    }
  }

  useEffect(() => {
    setSelectedScopes(initialScopes);
  }, [initialScopes]);

  useEffect(() => {
    void load();
  }, [resourceType, resourceId]);

  function toggleScope(scope: ResourceGrantScope, checked: boolean) {
    setSelectedScopes((current) => checked
      ? [...new Set([...current, scope])]
      : current.filter((item) => item !== scope));
  }

  async function createGrant() {
    const target = granteeId.trim();
    if (!target || selectedScopes.length === 0) return;
    setBusy(true);
    setMessage("");
    try {
      await api("/api/resource-grants", {
        method: "POST",
        body: JSON.stringify({
          resourceType,
          resourceId,
          granteeId: target,
          scopes: selectedScopes
        })
      });
      setGranteeId("");
      await load();
      await onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Grant creation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeGrant(grantId: string) {
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/resource-grants/${encodeURIComponent(grantId)}`, { method: "DELETE" });
      await load();
      await onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Grant revoke failed.");
    } finally {
      setBusy(false);
    }
  }

  const activeGrants = grants.filter((grant) => !grant.revokedAt);
  const revokedGrants = grants.filter((grant) => grant.revokedAt);
  const panelClassName = variant === "card" ? "info-block sharing-panel" : "sharing-panel sharing-panel-plain";

  return (
    <div className={panelClassName}>
      {showHeading && <h3>SHARING</h3>}
      <p className="muted-text">Grant resource-level access. Management actions stay owner-only.</p>
      <form className="sharing-form" onSubmit={(event) => {
        event.preventDefault();
        void createGrant();
      }}>
        <label className="agent-profile-field">
          <span>Share with user</span>
          <input className="input" value={granteeId} onChange={(event) => setGranteeId(event.target.value)} placeholder="Email or name" />
        </label>
        <div className="inline-actions grant-scope-list">
          {allowedScopes.map((scope) => (
            <label key={scope} className="member-toggle">
              <input type="checkbox" checked={selectedScopes.includes(scope)} onChange={(event) => toggleScope(scope, event.target.checked)} />
              <span>{scope}</span>
            </label>
          ))}
          <button className="btn primary small" type="submit" disabled={busy || !granteeId.trim() || selectedScopes.length === 0}>
            Grant Access
          </button>
        </div>
      </form>
      {message && <p className={message.includes("failed") || message.includes("required") || message.includes("not_found") ? "profile-save-message error" : "profile-save-message"}>{message}</p>}
      <div className="grant-list">
        {activeGrants.length === 0 && <p className="muted-text">No active grants.</p>}
        {activeGrants.map((grant) => (
          <div key={grant.id} className="inspector-grant-row">
            <span>
              <b>{grant.grantee?.displayName ?? "Unknown user"}</b>
              <small>{grant.grantee?.email ?? "No email"} · {grant.scopes.join(", ")}</small>
            </span>
            <button className="icon-btn danger" type="button" aria-label={`Revoke grant for ${grant.grantee?.displayName ?? "Unknown user"}`} title="Revoke grant" disabled={busy} onClick={() => void revokeGrant(grant.id)}><X size={15} /></button>
          </div>
        ))}
        {revokedGrants.length > 0 && <div className="section-label inline">REVOKED</div>}
        {revokedGrants.map((grant) => (
          <div key={grant.id} className="inspector-grant-row revoked">
            <span>
              <b>{grant.grantee?.displayName ?? "Unknown user"}</b>
              <small>{grant.grantee?.email ?? "No email"} · revoked {new Date(grant.revokedAt ?? grant.createdAt).toLocaleDateString()}</small>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
