import type express from "express";
import { isCommunicationAgent, type AgentRecord, type GovernancePolicyConfigRecord, type GovernancePolicyConfigScope, type GovernancePolicyHistoryPayload, type GovernancePolicyRollbackPayload, type GovernancePolicyRules } from "@tyr-ai/contracts";
import { governanceEffectivePolicyPayload, governancePolicyPreviewPayload } from "../governance-policy";
import type { ServerRouteContext } from "../server-context";

export function registerGovernanceRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const { store, governanceConfig, requireAuthUser, isServerMember, isServerOwner, publishWorkspaceSync } = ctx;

  app.get("/api/servers/:serverId/governance/policy", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const serverId = req.params.serverId;
    if (!isServerMember(user.id, serverId)) {
      res.status(403).json({ error: "server_membership_required" });
      return;
    }
    const agentId = optionalString(req.query.agentId);
    if (agentId && !agentBelongsToServer(ctx, agentId, serverId)) {
      res.status(404).json({ error: "agent_not_found" });
      return;
    }
    res.json(governanceEffectivePolicyPayload({
      store,
      baseConfig: governanceConfig,
      serverId,
      agentId
    }));
  });

  app.get("/api/servers/:serverId/governance/policy/history", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const serverId = req.params.serverId;
    if (!isServerMember(user.id, serverId)) {
      res.status(403).json({ error: "server_membership_required" });
      return;
    }
    const agentId = optionalString(req.query.agentId);
    if (agentId && !agentBelongsToServer(ctx, agentId, serverId)) {
      res.status(404).json({ error: "agent_not_found" });
      return;
    }
    const limit = numericLimit(req.query.limit, 25, 100);
    const policy = governanceEffectivePolicyPayload({
      store,
      baseConfig: governanceConfig,
      serverId,
      agentId
    });
    const payload: GovernancePolicyHistoryPayload = {
      policy,
      audit: store.listGovernancePolicyConfigAudit({ serverId, limit }),
      auditEvents: store.listAuditEvents({ serverId, resourceType: "governance_policy_config", limit, order: "desc" })
    };
    res.json(payload);
  });

  app.post("/api/servers/:serverId/governance/policy/preview", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const serverId = req.params.serverId;
    if (!isServerOwner(user.id, serverId)) {
      res.status(403).json({ error: "server_owner_required" });
      return;
    }
    const scope = governancePolicyConfigScope(req.body?.scope);
    const agentId = scope === "agent" ? optionalString(req.body?.agentId) : undefined;
    if (scope === "agent" && (!agentId || !agentBelongsToServer(ctx, agentId, serverId))) {
      res.status(404).json({ error: "agent_not_found" });
      return;
    }
    const candidate = governancePolicyCandidateConfig(ctx, {
      serverId,
      scope,
      agentId,
      version: req.body?.version,
      rules: req.body?.rules,
      actorUserId: user.id
    });
    if (!candidate.ok) {
      res.status(400).json({ error: candidate.error });
      return;
    }
    res.json(governancePolicyPreviewPayload({
      store,
      baseConfig: governanceConfig,
      serverId,
      agentId,
      candidateConfig: candidate.config,
      agents: candidateAgentsForPreview(ctx, serverId, scope, agentId)
    }));
  });

  app.put("/api/servers/:serverId/governance/policy", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const serverId = req.params.serverId;
    if (!isServerOwner(user.id, serverId)) {
      res.status(403).json({ error: "server_owner_required" });
      return;
    }
    const scope = governancePolicyConfigScope(req.body?.scope);
    const agentId = scope === "agent" ? optionalString(req.body?.agentId) : undefined;
    if (scope === "agent" && (!agentId || !agentBelongsToServer(ctx, agentId, serverId))) {
      res.status(404).json({ error: "agent_not_found" });
      return;
    }
    const version = optionalString(req.body?.version);
    if (!version) {
      res.status(400).json({ error: "policy_version_required" });
      return;
    }
    const rules = governancePolicyRules(req.body?.rules);
    if (Object.keys(rules).length === 0) {
      res.status(400).json({ error: "policy_rules_required" });
      return;
    }
    store.upsertGovernancePolicyConfig({
      serverId,
      scope,
      agentId,
      version,
      rules,
      actorUserId: user.id
    });
    publishWorkspaceSync();
    res.json(governanceEffectivePolicyPayload({
      store,
      baseConfig: governanceConfig,
      serverId,
      agentId
    }));
  });

  app.post("/api/servers/:serverId/governance/policy/rollback", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const serverId = req.params.serverId;
    if (!isServerOwner(user.id, serverId)) {
      res.status(403).json({ error: "server_owner_required" });
      return;
    }
    const auditId = optionalString(req.body?.auditId);
    const audit = auditId ? store.getGovernancePolicyConfigAudit(auditId) : null;
    if (!audit || audit.serverId !== serverId) {
      res.status(404).json({ error: "policy_audit_not_found" });
      return;
    }
    if (audit.scope === "agent" && (!audit.agentId || !agentBelongsToServer(ctx, audit.agentId, serverId))) {
      res.status(404).json({ error: "agent_not_found" });
      return;
    }
    const restoredConfig = store.upsertGovernancePolicyConfig({
      serverId,
      scope: audit.scope,
      agentId: audit.agentId,
      version: audit.version,
      rules: audit.rules,
      actorUserId: user.id
    });
    publishWorkspaceSync();
    const payload: GovernancePolicyRollbackPayload = {
      restoredAudit: audit,
      restoredConfig,
      policy: governanceEffectivePolicyPayload({
        store,
        baseConfig: governanceConfig,
        serverId,
        agentId: audit.agentId
      })
    };
    res.json(payload);
  });
}

function agentBelongsToServer(ctx: ServerRouteContext, agentId: string, serverId: string): boolean {
  const agent = ctx.store.getAgent(agentId);
  if (!agent || isCommunicationAgent(agent) || !agent.machineId) return false;
  const machine = ctx.store.getMachine(agent.machineId);
  return machine?.serverId === serverId;
}

function governancePolicyConfigScope(value: unknown): GovernancePolicyConfigScope {
  return value === "agent" ? "agent" : "workspace";
}

function governancePolicyRules(value: unknown): GovernancePolicyRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: GovernancePolicyRules = {};
  for (const rule of ["destructive_command", "secret_external_send", "cross_context", "unknown_action", "sensitive_upload"] as const) {
    const decision = input[rule];
    if (decision === "allow" || decision === "require_human" || decision === "deny" || decision === "unknown") output[rule] = decision;
  }
  return output;
}

function governancePolicyCandidateConfig(ctx: ServerRouteContext, input: {
  serverId: string;
  scope: GovernancePolicyConfigScope;
  agentId?: string;
  version: unknown;
  rules: unknown;
  actorUserId: string;
}): { ok: true; config: GovernancePolicyConfigRecord } | { ok: false; error: string } {
  const version = optionalString(input.version);
  if (!version) return { ok: false, error: "policy_version_required" };
  const rules = governancePolicyRules(input.rules);
  if (Object.keys(rules).length === 0) return { ok: false, error: "policy_rules_required" };
  const existing = ctx.store.getGovernancePolicyConfig({ serverId: input.serverId, scope: input.scope, agentId: input.agentId });
  const now = new Date().toISOString();
  return {
    ok: true,
    config: {
      id: existing?.id ?? `preview:${input.scope}:${input.agentId ?? input.serverId}`,
      serverId: input.serverId,
      scope: input.scope,
      agentId: input.scope === "agent" ? input.agentId : undefined,
      policySource: "db_config",
      version,
      rules,
      createdByUserId: existing?.createdByUserId,
      updatedByUserId: input.actorUserId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
  };
}

function candidateAgentsForPreview(ctx: ServerRouteContext, serverId: string, scope: GovernancePolicyConfigScope, agentId?: string): AgentRecord[] {
  if (scope === "agent") {
    const agent = agentId ? ctx.store.getAgent(agentId) : null;
    return agent && !isCommunicationAgent(agent) && agent.machineId ? [agent] : [];
  }
  return ctx.store.listAgents(serverId).filter((agent) => {
    if (isCommunicationAgent(agent) || !agent.machineId) return false;
    const machine = ctx.store.getMachine(agent.machineId);
    return machine?.serverId === serverId;
  });
}

function numericLimit(value: unknown, fallback: number, max: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}

function optionalString(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}
