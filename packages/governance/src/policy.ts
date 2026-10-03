import type {
  GovernancePolicyConfig,
  GovernancePolicyAudit,
  GovernancePolicyRule,
  GovernancePolicyRules,
  GovernancePolicyScope,
  GovernancePolicySource,
  GovernanceResolvedPolicy
} from "./types";
import { isGovernanceDecisionValue } from "./types";

export const DEFAULT_GOVERNANCE_POLICY: GovernanceResolvedPolicy = {
  destructive_command: "deny",
  secret_external_send: "deny",
  cross_context: "require_human",
  unknown_action: "require_human",
  sensitive_upload: "deny"
};

export function parseGovernancePolicyConfig(value: string | undefined): GovernancePolicyConfig {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return sanitizeGovernancePolicyConfig(parsed);
  } catch {
    return {};
  }
}

export function resolveGovernancePolicy(
  config: GovernancePolicyConfig | undefined,
  context: { serverId?: string; agentId?: string } = {}
): GovernanceResolvedPolicy {
  return resolveGovernancePolicyAudit(config, context).resolvedPolicy;
}

export function resolveGovernancePolicyAudit(
  config: GovernancePolicyConfig | undefined,
  context: { serverId?: string; agentId?: string } = {}
): GovernancePolicyAudit {
  // Governance policy precedence is intentionally narrow: agent overrides workspace, workspace overrides default, then built-in safety defaults.
  const defaultRules = sanitizeGovernancePolicyRules(config?.default);
  const workspaceRules = context.serverId ? sanitizeGovernancePolicyRules(config?.workspaces?.[context.serverId]) : {};
  const agentRules = context.agentId ? sanitizeGovernancePolicyRules(config?.agents?.[context.agentId]) : {};
  const matchedOverrides: string[] = [];
  let scope: GovernancePolicyScope = "built_in";
  if (hasRules(defaultRules)) {
    matchedOverrides.push("default");
    scope = "default";
  }
  if (hasRules(workspaceRules) && context.serverId) {
    matchedOverrides.push(`workspace:${context.serverId}`);
    scope = "workspace";
  }
  if (hasRules(agentRules) && context.agentId) {
    matchedOverrides.push(`agent:${context.agentId}`);
    scope = "agent";
  }
  const hasConfiguredPolicy = Boolean(hasRules(defaultRules) || hasRules(workspaceRules) || hasRules(agentRules) || hasRuleMap(config?.workspaces) || hasRuleMap(config?.agents));
  return {
    version: sanitizePolicyVersion(config?.version) ?? "builtin-v1",
    source: governancePolicySource(config?.source, hasConfiguredPolicy),
    scope,
    matchedOverrides,
    resolvedPolicy: {
      ...DEFAULT_GOVERNANCE_POLICY,
      ...defaultRules,
      ...workspaceRules,
      ...agentRules
    }
  };
}

function sanitizeGovernancePolicyConfig(value: unknown): GovernancePolicyConfig {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const output: GovernancePolicyConfig = {
    default: sanitizeGovernancePolicyRules(input.default),
    workspaces: sanitizeGovernancePolicyRuleMap(input.workspaces),
    agents: sanitizeGovernancePolicyRuleMap(input.agents)
  };
  const version = sanitizePolicyVersion(input.version ?? input.policyVersion);
  if (version) output.version = version;
  return output;
}

function governancePolicySource(source: GovernancePolicySource | undefined, hasConfiguredPolicy: boolean): GovernancePolicySource {
  if (hasConfiguredPolicy && (source === "db_config" || source === "env_json")) return source;
  return hasConfiguredPolicy ? "env_json" : "built_in";
}

function sanitizeGovernancePolicyRuleMap(value: unknown): Record<string, GovernancePolicyRules> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const output: Record<string, GovernancePolicyRules> = {};
  for (const [key, rules] of Object.entries(value as Record<string, unknown>)) {
    output[key] = sanitizeGovernancePolicyRules(rules);
  }
  return output;
}

export function sanitizeGovernancePolicyRules(value: unknown): GovernancePolicyRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: GovernancePolicyRules = {};
  for (const rule of governancePolicyRules()) {
    const decision = (value as Record<string, unknown>)[rule];
    if (isGovernanceDecisionValue(decision)) output[rule] = decision;
  }
  return output;
}

function governancePolicyRules(): GovernancePolicyRule[] {
  return ["destructive_command", "secret_external_send", "cross_context", "unknown_action", "sensitive_upload"];
}

function hasRules(value: GovernancePolicyRules | undefined): boolean {
  return Boolean(value && Object.keys(value).length > 0);
}

function hasRuleMap(value: Record<string, GovernancePolicyRules> | undefined): boolean {
  return Boolean(value && Object.values(value).some(hasRules));
}

function sanitizePolicyVersion(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 80) : undefined;
}
