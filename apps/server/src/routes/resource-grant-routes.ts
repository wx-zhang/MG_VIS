import type express from "express";
import {
  RESOURCE_GRANT_SCOPES,
  type ResourceGrantRecord,
  type ResourceGrantScope,
  type ResourceType
} from "@tyr-ai/contracts";
import type { ServerRouteContext } from "../server-context";

type ResourceGrantRouteContext = Pick<ServerRouteContext, "store" | "authUser" | "publishWorkspaceSync">;

const resourceTypes = new Set<ResourceType>(["machine", "agent"]);
const grantScopeSet = new Set<ResourceGrantScope>(RESOURCE_GRANT_SCOPES);

const scopesByResourceType: Record<ResourceType, ResourceGrantScope[]> = {
  machine: ["view"],
  agent: ["view", "message", "task"]
};

function resourceType(value: unknown): ResourceType | null {
  return typeof value === "string" && resourceTypes.has(value as ResourceType) ? value as ResourceType : null;
}

function parseScopes(value: unknown, type: ResourceType): { ok: true; scopes: ResourceGrantScope[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "resource_grant_scope_required" };
  const allowed = new Set(scopesByResourceType[type]);
  const requested = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (requested.length === 0) return { ok: false, error: "resource_grant_scope_required" };
  if (requested.some((scope) => !grantScopeSet.has(scope as ResourceGrantScope) || !allowed.has(scope as ResourceGrantScope))) {
    return { ok: false, error: "invalid_resource_grant_scope" };
  }
  return { ok: true, scopes: scopesByResourceType[type].filter((scope) => requested.includes(scope)) };
}

export function registerResourceGrantRoutes(app: express.Express, ctx: ResourceGrantRouteContext): void {
  const { store, authUser, publishWorkspaceSync } = ctx;

  function requireOwner(userId: string, type: ResourceType, resourceId: string, res: express.Response): boolean {
    const ownerUserId = store.resourceOwnerUserId(type, resourceId);
    if (!ownerUserId) {
      res.status(404).json({ error: "resource_not_found" });
      return false;
    }
    if (ownerUserId !== userId) {
      res.status(403).json({ error: "resource_owner_required" });
      return false;
    }
    return true;
  }

  function formatGrant(grant: ResourceGrantRecord) {
    const grantee = store.getUser(grant.granteeUserId);
    return {
      ...grant,
      grantee: grantee ? {
        id: grantee.id,
        name: grantee.name,
        displayName: grantee.displayName,
        email: grantee.email ?? null
      } : null
    };
  }

  app.get("/api/resource-grants", (req, res) => {
    const user = authUser(req);
    const type = resourceType(req.query.resourceType);
    const resourceId = typeof req.query.resourceId === "string" ? req.query.resourceId.trim() : "";
    if (!type || !resourceId) {
      res.status(404).json({ error: "resource_not_found" });
      return;
    }
    if (!requireOwner(user.id, type, resourceId, res)) return;
    res.json({ grants: store.listResourceGrants({ resourceType: type, resourceId }).map(formatGrant) });
  });

  app.post("/api/resource-grants", (req, res) => {
    const user = authUser(req);
    const type = resourceType(req.body?.resourceType);
    const resourceId = typeof req.body?.resourceId === "string" ? req.body.resourceId.trim() : "";
    if (!type || !resourceId) {
      res.status(404).json({ error: "resource_not_found" });
      return;
    }
    if (!requireOwner(user.id, type, resourceId, res)) return;
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "granteeType")) {
      res.status(400).json({ error: "invalid_resource_grantee" });
      return;
    }
    const parsedScopes = parseScopes(req.body?.scopes, type);
    if (!parsedScopes.ok) {
      res.status(400).json({ error: parsedScopes.error });
      return;
    }
    const granteeIdentifier = typeof req.body?.granteeId === "string" ? req.body.granteeId.trim() : "";
    if (!granteeIdentifier) {
      res.status(404).json({ error: "grantee_not_found" });
      return;
    }
    const grantee = store.findUser(granteeIdentifier);
    if (!grantee) {
      res.status(404).json({ error: "grantee_not_found" });
      return;
    }
    try {
      const grant = store.createResourceGrant({
        resourceType: type,
        resourceId,
        granteeUserId: grantee.id,
        scopes: parsedScopes.scopes,
        createdByUserId: user.id
      });
      publishWorkspaceSync();
      res.json({ grant: formatGrant(grant) });
    } catch (err) {
      const error = err instanceof Error ? err.message : "resource_grant_failed";
      if (error === "resource_owner_required") res.status(403).json({ error });
      else if (error === "resource_grant_scope_required" || error === "invalid_resource_grant_scope") res.status(400).json({ error });
      else if (error === "grantee_not_found") res.status(404).json({ error });
      else res.status(400).json({ error });
    }
  });

  app.delete("/api/resource-grants/:grantId", (req, res) => {
    const user = authUser(req);
    const grant = store.listResourceGrants().find((item) => item.id === req.params.grantId || item.id.startsWith(req.params.grantId));
    if (!grant) {
      res.status(404).json({ error: "resource_not_found" });
      return;
    }
    if (!requireOwner(user.id, grant.resourceType, grant.resourceId, res)) return;
    try {
      const revoked = store.revokeResourceGrant(grant.id, user.id);
      publishWorkspaceSync();
      res.json({ grant: revoked ? formatGrant(revoked) : null });
    } catch (err) {
      const error = err instanceof Error ? err.message : "resource_grant_revoke_failed";
      res.status(error === "resource_owner_required" ? 403 : 400).json({ error });
    }
  });
}
