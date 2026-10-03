import { randomUUID } from "node:crypto";
import type {
  GovernanceDecisionRecord,
  GovernanceDecisionValue,
  GovernanceMode,
  MessageRecord,
  RuntimeApprovalRecord,
  RuntimeExecutionRecord,
  RuntimePermissionMode,
  TaskRecord
} from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import {
  buildGovernanceCase,
  evaluateDeterministicPolicy,
  judgeGovernanceCase,
  parseGovernancePolicyConfig,
  resolveGovernancePolicyAudit,
  type GovernanceCase,
  type GovernanceDecision,
  type GovernanceDecisionSource,
  type GovernancePolicyAudit,
  type GovernancePolicyConfig,
  type RuntimeApprovalClassification
} from "@tyr-ai/governance";
import { firstEnv, modelEndpointConfigFromEnv } from "./model-config";
import { normalizeServerRuntimeApproval, type ServerRuntimeApprovalNormalization } from "./runtime-approval-policy";

export type GovernanceRuntimeMode = GovernanceMode;

export interface GovernanceRuntimeConfig {
  enabled: boolean;
  mode: GovernanceRuntimeMode;
  model: string;
  policyVersion?: string;
  apiKey?: string;
  baseUrl?: string;
  maxEvents: number;
  maxCaseChars: number;
  policyConfig: GovernancePolicyConfig;
}

export type GovernanceRuntimeHealth = {
  enabled: boolean;
  mode: GovernanceRuntimeMode;
  model: string;
  policyVersion: string;
  hasApiKey: boolean;
  maxEvents: number;
  maxCaseChars: number;
};

export type GovernanceApprovalNormalization = ServerRuntimeApprovalNormalization & {
  governanceCase?: GovernanceCase;
  governanceDecision?: GovernanceDecisionRecord;
  autoRejected: boolean;
};

type GovernanceStore = Pick<
  TyrDb,
  | "getRuntimeExecution"
  | "listRuntimeExecutionEvents"
  | "listMessages"
  | "listTasks"
  | "taskForMessage"
  | "createGovernanceDecision"
>;

export type GovernanceJudge = (input: GovernanceCase) => Promise<GovernanceDecision>;

export function governanceConfigFromEnv(env: NodeJS.ProcessEnv): GovernanceRuntimeConfig {
  const policyConfig = parseGovernancePolicyConfig(env.TYR_GOVERNANCE_POLICY_JSON);
  const modelEndpoint = modelEndpointConfigFromEnv(env, { prefix: "TYR_GOVERNANCE", defaultModel: "qwen3.7-plus" });
  return {
    enabled: env.TYR_GOVERNANCE_ENABLED === "1",
    mode: governanceModeFromEnv(env.TYR_GOVERNANCE_MODE),
    model: modelEndpoint.model,
    policyVersion: firstEnv(env.TYR_GOVERNANCE_POLICY_VERSION, policyConfig.version) ?? "builtin-v1",
    maxEvents: intFromEnv(env.TYR_GOVERNANCE_MAX_EVENTS, 30, 1, 100),
    maxCaseChars: intFromEnv(env.TYR_GOVERNANCE_MAX_CASE_CHARS, 24_000, 4_000, 80_000),
    policyConfig,
    apiKey: modelEndpoint.apiKey,
    baseUrl: modelEndpoint.baseUrl
  };
}

export function governanceRuntimeHealth(config: GovernanceRuntimeConfig): GovernanceRuntimeHealth {
  return {
    enabled: config.enabled,
    mode: config.mode,
    model: config.model,
    policyVersion: resolvedPolicyVersion(config),
    hasApiKey: Boolean(config.apiKey),
    maxEvents: config.maxEvents,
    maxCaseChars: config.maxCaseChars
  };
}

export async function normalizeServerRuntimeApprovalWithGovernance(input: {
  approval: RuntimeApprovalRecord;
  store: GovernanceStore;
  config: GovernanceRuntimeConfig;
  now?: string;
  judge?: GovernanceJudge;
  permissionMode?: RuntimePermissionMode;
}): Promise<GovernanceApprovalNormalization> {
  const now = input.now ?? new Date().toISOString();
  const base = normalizeServerRuntimeApproval(input.approval, now, input.permissionMode);
  if (base.runtimeAccessBlocked) return { ...base, autoRejected: base.approval.status === "rejected" };
  if (!input.config.enabled) {
    const decision = evaluateDeterministicPolicy({
      approval: base.approval,
      classification: base.classification
    });
    return applyDeterministicBaselineToApproval(base, decision, now);
  }
  const execution = base.approval.executionId ? input.store.getRuntimeExecution(base.approval.executionId) : null;
  const fallbackExecution = execution ?? executionFromApproval(base.approval);
  const policyAudit = resolveGovernancePolicyAudit({
    ...input.config.policyConfig,
    version: resolvedPolicyVersion(input.config)
  }, {
    serverId: base.approval.serverId ?? fallbackExecution.serverId,
    agentId: base.approval.agentId
  });
  const policy = policyAudit.resolvedPolicy;
  const governanceCase = buildGovernanceCase({
    trigger: "approval_request",
    execution: fallbackExecution,
    approval: base.approval,
    events: execution ? input.store.listRuntimeExecutionEvents(execution.id) : [],
    message: messageForGovernance(input.store, base.approval, fallbackExecution),
    task: taskForGovernance(input.store, base.approval, fallbackExecution),
    policy,
    options: {
      maxEvents: input.config.maxEvents,
      maxCaseChars: input.config.maxCaseChars
    }
  });
  const judged = await decisionForCase(governanceCase, base.classification, input.config, input.judge);
  const record = input.store.createGovernanceDecision(governanceDecisionInput({
    approval: base.approval,
    execution: fallbackExecution,
    config: input.config,
    policyAudit,
    decision: judged.decision,
    decisionSource: judged.source,
    caseSummary: caseSummary(governanceCase, policyAudit),
    now
  }));
  const approvalWithGovernance = {
    ...base.approval,
    payload: approvalPayloadWithGovernance(base.approval, record)
  };
  const applied = applyGovernanceDecisionToApproval({
    approval: approvalWithGovernance,
    classification: base.classification,
    autoResolved: base.autoResolved,
    decision: record,
    mode: input.config.mode,
    now
  });
  return {
    ...applied,
    governanceCase,
    governanceDecision: record
  };
}

function applyDeterministicBaselineToApproval(
  base: ServerRuntimeApprovalNormalization,
  decision: GovernanceDecision,
  now: string
): GovernanceApprovalNormalization {
  // Governance 关闭时仍保留规则审批基线，但不写 governance_decisions、不调用模型。
  if (decision.decision === "deny") {
    return {
      approval: {
        ...base.approval,
        status: "rejected",
        decision: "reject",
        resolvedAt: base.approval.resolvedAt ?? now
      },
      classification: base.classification,
      autoResolved: false,
      runtimeAccessBlocked: false,
      autoRejected: true
    };
  }
  if (decision.decision === "require_human" || decision.decision === "unknown") {
    return {
      approval: {
        ...base.approval,
        status: "pending",
        decision: undefined,
        resolvedAt: undefined,
        resolvedByUserId: undefined
      },
      classification: base.classification,
      autoResolved: false,
      runtimeAccessBlocked: false,
      autoRejected: false
    };
  }
  return { ...base, autoRejected: false };
}

async function decisionForCase(
  governanceCase: GovernanceCase,
  classification: RuntimeApprovalClassification,
  config: GovernanceRuntimeConfig,
  judge?: GovernanceJudge
): Promise<{ decision: GovernanceDecision; source: GovernanceDecisionSource }> {
  const deterministic = governanceCase.deterministicSignals;
  if (!deterministic.shouldUseModel || classification === "readonly" || classification === "low_risk_workflow") {
    return { decision: deterministic, source: "deterministic" };
  }
  if (judge) return { decision: await judge(governanceCase), source: "model" };
  const decision = await judgeGovernanceCase(governanceCase, {
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl
  });
  return { decision, source: config.apiKey ? "model" : "model_unavailable" };
}

function applyGovernanceDecisionToApproval(input: {
  approval: RuntimeApprovalRecord;
  classification: RuntimeApprovalClassification;
  autoResolved: boolean;
  decision: GovernanceDecisionRecord;
  mode: GovernanceRuntimeMode;
  now: string;
}): GovernanceApprovalNormalization {
  if (input.mode === "enforce" && input.decision.decision === "deny") {
    return {
      approval: {
        ...input.approval,
        status: "rejected",
        decision: "reject",
        resolvedAt: input.approval.resolvedAt ?? input.now
      },
      classification: input.classification,
      autoResolved: false,
      runtimeAccessBlocked: false,
      autoRejected: true
    };
  }
  if (input.mode === "assist" && (input.decision.decision === "deny" || input.decision.decision === "require_human" || input.decision.decision === "unknown")) {
    return {
      approval: {
        ...input.approval,
        status: "pending",
        decision: undefined,
        resolvedAt: undefined,
        resolvedByUserId: undefined
      },
      classification: input.classification,
      autoResolved: false,
      runtimeAccessBlocked: false,
      autoRejected: false
    };
  }
  return {
    approval: input.approval,
    classification: input.classification,
    autoResolved: input.autoResolved,
    runtimeAccessBlocked: false,
    autoRejected: false
  };
}

function governanceDecisionInput(input: {
  approval: RuntimeApprovalRecord;
  execution: RuntimeExecutionRecord;
  config: GovernanceRuntimeConfig;
  policyAudit: GovernancePolicyAudit;
  decision: GovernanceDecision;
  decisionSource: GovernanceDecisionSource;
  caseSummary: Record<string, unknown>;
  now: string;
}): Omit<GovernanceDecisionRecord, "createdAt"> & { createdAt?: string } {
  return {
    id: `gov_${randomUUID().replaceAll("-", "")}`,
    serverId: input.approval.serverId ?? input.execution.serverId ?? "local",
    machineId: input.approval.machineId,
    agentId: input.approval.agentId,
    runtime: input.approval.runtime,
    trigger: "approval_request",
    subjectType: "runtime_approval",
    subjectId: input.approval.id,
    mode: input.config.mode,
    decision: normalizeGovernanceDecisionValue(input.decision.decision),
    confidence: input.decision.confidence,
    riskTypes: input.decision.riskTypes,
    reason: input.decision.reason,
    evidence: input.decision.evidence,
    policyVersion: input.policyAudit.version,
    policySource: input.policyAudit.source,
    policyScope: input.policyAudit.scope,
    decisionSource: input.decisionSource,
    executionId: input.approval.executionId ?? input.execution.id,
    approvalId: input.approval.id,
    taskId: input.approval.taskId ?? input.execution.taskId,
    messageId: input.approval.messageId ?? input.execution.messageId,
    threadChannelId: input.approval.threadChannelId ?? input.execution.threadChannelId,
    model: input.decisionSource === "model" ? input.config.model : input.decisionSource,
    caseSummary: input.caseSummary,
    createdAt: input.now
  };
}

function approvalPayloadWithGovernance(approval: RuntimeApprovalRecord, decision: GovernanceDecisionRecord): Record<string, unknown> {
  const payload = approval.payload && typeof approval.payload === "object" && !Array.isArray(approval.payload) ? approval.payload as Record<string, unknown> : { value: approval.payload };
  const sourceTags = Array.isArray(decision.caseSummary?.sourceTags) ? decision.caseSummary.sourceTags : undefined;
  return {
    ...payload,
    governance: {
      decisionId: decision.id,
      mode: decision.mode,
      model: decision.model,
      policyVersion: decision.policyVersion,
      policySource: decision.policySource,
      policyScope: decision.policyScope,
      decisionSource: decision.decisionSource,
      decision: decision.decision,
      confidence: decision.confidence,
      riskTypes: decision.riskTypes,
      reason: decision.reason,
      evidence: decision.evidence.slice(0, 3),
      ...(sourceTags ? { sourceTags } : {})
    }
  };
}

function executionFromApproval(approval: RuntimeApprovalRecord): RuntimeExecutionRecord {
  const now = approval.requestedAt;
  return {
    id: approval.executionId ?? `approval:${approval.id}`,
    serverId: approval.serverId,
    machineId: approval.machineId,
    agentId: approval.agentId,
    taskId: approval.taskId,
    messageId: approval.messageId ?? approval.id,
    threadChannelId: approval.threadChannelId,
    runtime: approval.runtime,
    launchId: approval.launchId,
    status: "waiting_approval",
    createdAt: now,
    updatedAt: now
  };
}

function messageForGovernance(store: GovernanceStore, approval: RuntimeApprovalRecord, execution: RuntimeExecutionRecord): MessageRecord | null {
  const messageId = approval.messageId ?? execution.messageId;
  const threadChannelId = approval.threadChannelId ?? execution.threadChannelId;
  if (!messageId && !threadChannelId) return null;
  if (threadChannelId) {
    const match = store.listMessages(threadChannelId).find((item) => item.id === messageId);
    if (match) return match;
  }
  const executionMessage = store.listMessages(undefined, 500).find((item) => item.id === messageId || item.id === execution.messageId);
  return executionMessage ?? null;
}

function taskForGovernance(store: GovernanceStore, approval: RuntimeApprovalRecord, execution: RuntimeExecutionRecord): TaskRecord | null {
  if (approval.taskId || execution.taskId) {
    const taskId = approval.taskId ?? execution.taskId;
    const task = store.listTasks().find((item) => item.id === taskId || item.messageId === taskId);
    if (task) return task;
  }
  return store.taskForMessage(approval.messageId ?? execution.messageId);
}

function caseSummary(input: GovernanceCase, policyAudit: GovernancePolicyAudit): Record<string, unknown> {
  return {
    proposedAction: input.proposedAction.name,
    actionKind: input.proposedAction.kind,
    riskClass: input.proposedAction.riskClass,
    trajectoryEvents: input.trajectory.length,
    deterministicDecision: input.deterministicSignals.decision,
    deterministicRiskTypes: input.deterministicSignals.riskTypes,
    // 完整脱敏 sourceTags 留在审计/debug export；客户 UI 只取前几条摘要展示。
    sourceTags: input.sourceTags,
    policy: policyAudit
  };
}

function normalizeGovernanceDecisionValue(value: GovernanceDecisionValue): GovernanceDecisionValue {
  return value === "allow" || value === "require_human" || value === "deny" || value === "unknown" ? value : "unknown";
}

function governanceModeFromEnv(value: string | undefined): GovernanceRuntimeMode {
  if (value === "assist" || value === "enforce") return value;
  return "shadow";
}

export function resolvedPolicyVersion(config: Pick<GovernanceRuntimeConfig, "policyVersion" | "policyConfig">): string {
  return firstEnv(config.policyVersion, config.policyConfig.version) ?? "builtin-v1";
}

function intFromEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}
