import type {
  AgentRecord,
  AuditEventRecord,
  GovernanceEffectivePolicyPayload,
  GovernanceDecisionValue,
  GovernancePolicyDiffEntry,
  GovernancePolicyConfigAuditRecord,
  GovernancePolicyConfigRecord,
  GovernancePolicyEffectiveSummary,
  GovernancePolicyImpactedAgent,
  GovernancePolicyPreviewPayload,
  GovernancePolicyRule,
  GovernancePolicyRules
} from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import {
  resolveGovernancePolicyAudit,
  type GovernancePolicyConfig,
  type GovernancePolicyAudit
} from "@tyr-ai/governance";
import type { GovernanceRuntimeConfig } from "./governance-runtime";

type GovernancePolicyStore = Pick<TyrDb, "listGovernancePolicyConfigs" | "listGovernancePolicyConfigAudit" | "listAuditEvents">;

const GOVERNANCE_POLICY_RULES: GovernancePolicyRule[] = [
  "destructive_command",
  "secret_external_send",
  "cross_context",
  "unknown_action",
  "sensitive_upload"
];

export type EffectiveGovernanceRuntimeConfig = {
  config: GovernanceRuntimeConfig;
  policyAudit: GovernancePolicyAudit;
  configs: {
    workspace?: GovernancePolicyConfigRecord;
    agent?: GovernancePolicyConfigRecord;
  };
  audit: GovernancePolicyConfigAuditRecord[];
  auditEvents: AuditEventRecord[];
};

export function resolveEffectiveGovernanceRuntimeConfig(input: {
  store: GovernancePolicyStore;
  baseConfig: GovernanceRuntimeConfig;
  serverId?: string;
  agentId?: string;
  includeAudit?: boolean;
  candidateConfig?: GovernancePolicyConfigRecord;
}): EffectiveGovernanceRuntimeConfig {
  const serverId = input.serverId?.trim();
  const agentId = input.agentId?.trim();
  const persisted = serverId ? input.store.listGovernancePolicyConfigs({ serverId, agentId }) : [];
  const candidate = input.candidateConfig;
  const workspace = candidate?.scope === "workspace"
    ? candidate
    : serverId ? persisted.find((item) => item.scope === "workspace" && item.serverId === serverId) : undefined;
  const agent = candidate?.scope === "agent"
    ? candidate
    : agentId ? persisted.find((item) => item.scope === "agent" && item.agentId === agentId) : undefined;
  const basePolicyConfig = input.baseConfig.policyConfig ?? {};
  const policyConfig = effectivePolicyConfig(basePolicyConfig, {
    serverId,
    agentId,
    workspace,
    agent,
    fallbackVersion: input.baseConfig.policyVersion ?? basePolicyConfig.version ?? "builtin-v1"
  });
  const config: GovernanceRuntimeConfig = {
    ...input.baseConfig,
    policyVersion: policyConfig.version,
    policyConfig
  };
  const policyAudit = resolveGovernancePolicyAudit(policyConfig, { serverId, agentId });
  return {
    config,
    policyAudit,
    configs: {
      ...(workspace ? { workspace } : {}),
      ...(agent ? { agent } : {})
    },
    audit: input.includeAudit && serverId ? input.store.listGovernancePolicyConfigAudit({ serverId, limit: 25 }) : [],
    auditEvents: input.includeAudit && serverId ? input.store.listAuditEvents({ serverId, resourceType: "governance_policy_config", limit: 25, order: "desc" }) : []
  };
}

export function governanceEffectivePolicyPayload(input: {
  store: GovernancePolicyStore;
  baseConfig: GovernanceRuntimeConfig;
  serverId: string;
  agentId?: string;
}): GovernanceEffectivePolicyPayload {
  const effective = resolveEffectiveGovernanceRuntimeConfig({
    store: input.store,
    baseConfig: input.baseConfig,
    serverId: input.serverId,
    agentId: input.agentId,
    includeAudit: true
  });
  return {
    enabled: effective.config.enabled,
    mode: effective.config.mode,
    model: effective.config.model,
    policyVersion: effective.policyAudit.version,
    policySource: effective.policyAudit.source,
    policyScope: effective.policyAudit.scope,
    decisionSource: "deterministic",
    matchedOverrides: effective.policyAudit.matchedOverrides,
    resolvedPolicy: effective.policyAudit.resolvedPolicy,
    configs: effective.configs,
    audit: effective.audit,
    auditEvents: effective.auditEvents
  };
}

export function governancePolicyPreviewPayload(input: {
  store: GovernancePolicyStore;
  baseConfig: GovernanceRuntimeConfig;
  serverId: string;
  agentId?: string;
  candidateConfig: GovernancePolicyConfigRecord;
  agents: AgentRecord[];
}): GovernancePolicyPreviewPayload {
  const currentEffective = resolveEffectiveGovernanceRuntimeConfig({
    store: input.store,
    baseConfig: input.baseConfig,
    serverId: input.serverId,
    agentId: input.agentId
  });
  const candidateEffective = resolveEffectiveGovernanceRuntimeConfig({
    store: input.store,
    baseConfig: input.baseConfig,
    serverId: input.serverId,
    agentId: input.agentId,
    candidateConfig: input.candidateConfig
  });
  const current = governanceEffectivePolicySummary(currentEffective);
  const candidate = governanceEffectivePolicySummary(candidateEffective);
  return {
    current,
    candidate,
    diff: governancePolicyDiff(current.resolvedPolicy, candidate.resolvedPolicy),
    impactedAgents: governancePolicyImpactedAgents({
      store: input.store,
      baseConfig: input.baseConfig,
      serverId: input.serverId,
      candidateConfig: input.candidateConfig,
      agents: input.agents
    })
  };
}

export function governancePolicyDiff(
  current: Required<Record<GovernancePolicyRule, GovernanceDecisionValue>>,
  candidate: Required<Record<GovernancePolicyRule, GovernanceDecisionValue>>
): GovernancePolicyDiffEntry[] {
  return GOVERNANCE_POLICY_RULES
    .filter((rule) => current[rule] !== candidate[rule])
    .map((rule) => ({
      rule,
      from: current[rule],
      to: candidate[rule]
    }));
}

function governancePolicyImpactedAgents(input: {
  store: GovernancePolicyStore;
  baseConfig: GovernanceRuntimeConfig;
  serverId: string;
  candidateConfig: GovernancePolicyConfigRecord;
  agents: AgentRecord[];
}): GovernancePolicyImpactedAgent[] {
  const impacted: GovernancePolicyImpactedAgent[] = [];
  for (const agent of input.agents) {
    if (!agent.runtime) continue;
    const currentEffective = resolveEffectiveGovernanceRuntimeConfig({
      store: input.store,
      baseConfig: input.baseConfig,
      serverId: input.serverId,
      agentId: agent.id
    });
    const candidateEffective = resolveEffectiveGovernanceRuntimeConfig({
      store: input.store,
      baseConfig: input.baseConfig,
      serverId: input.serverId,
      agentId: agent.id,
      candidateConfig: input.candidateConfig
    });
    const diff = governancePolicyDiff(currentEffective.policyAudit.resolvedPolicy, candidateEffective.policyAudit.resolvedPolicy);
    if (!diff.length) continue;
    impacted.push({
      id: agent.id,
      name: agent.name,
      displayName: agent.displayName,
      runtime: agent.runtime,
      policyScope: candidateEffective.policyAudit.scope,
      currentPolicyVersion: currentEffective.policyAudit.version,
      candidatePolicyVersion: candidateEffective.policyAudit.version,
      changedRules: diff.map((entry) => entry.rule)
    });
  }
  return impacted;
}

function governanceEffectivePolicySummary(effective: EffectiveGovernanceRuntimeConfig): GovernancePolicyEffectiveSummary {
  return {
    enabled: effective.config.enabled,
    mode: effective.config.mode,
    model: effective.config.model,
    policyVersion: effective.policyAudit.version,
    policySource: effective.policyAudit.source,
    policyScope: effective.policyAudit.scope,
    decisionSource: "deterministic",
    matchedOverrides: effective.policyAudit.matchedOverrides,
    resolvedPolicy: effective.policyAudit.resolvedPolicy,
    configs: effective.configs
  };
}

function effectivePolicyConfig(
  base: GovernancePolicyConfig,
  input: {
    serverId?: string;
    agentId?: string;
    workspace?: GovernancePolicyConfigRecord;
    agent?: GovernancePolicyConfigRecord;
    fallbackVersion: string;
  }
): GovernancePolicyConfig {
  const workspaceRules = input.workspace ? sanitizeRules(input.workspace.rules) : undefined;
  const agentRules = input.agent ? sanitizeRules(input.agent.rules) : undefined;
  const hasDbPolicy = hasRules(workspaceRules) || hasRules(agentRules);
  const version = policyVersionForOverrides({
    fallbackVersion: input.fallbackVersion,
    workspace: input.workspace,
    workspaceRules,
    agent: input.agent,
    agentRules
  });
  return {
    ...base,
    version,
    ...(hasDbPolicy ? { source: "db_config" as const } : {}),
    workspaces: {
      ...(base.workspaces ?? {}),
      ...(input.serverId && workspaceRules ? { [input.serverId]: workspaceRules } : {})
    },
    agents: {
      ...(base.agents ?? {}),
      ...(input.agentId && agentRules ? { [input.agentId]: agentRules } : {})
    }
  };
}

function policyVersionForOverrides(input: {
  fallbackVersion: string;
  workspace?: GovernancePolicyConfigRecord;
  workspaceRules?: GovernancePolicyRules;
  agent?: GovernancePolicyConfigRecord;
  agentRules?: GovernancePolicyRules;
}): string {
  if (input.agent && hasRules(input.agentRules)) return input.agent.version;
  if (input.workspace && hasRules(input.workspaceRules)) return input.workspace.version;
  return input.fallbackVersion;
}

function sanitizeRules(rules: GovernancePolicyRules): GovernancePolicyRules {
  const output: GovernancePolicyRules = {};
  for (const rule of GOVERNANCE_POLICY_RULES) {
    const decision = rules[rule];
    if (decision === "allow" || decision === "require_human" || decision === "deny" || decision === "unknown") output[rule] = decision;
  }
  return output;
}

function hasRules(rules: GovernancePolicyRules | undefined): boolean {
  return Boolean(rules && Object.keys(rules).length > 0);
}
