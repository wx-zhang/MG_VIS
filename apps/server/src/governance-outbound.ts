import { randomUUID } from "node:crypto";
import type {
  AgentRecord,
  ChannelRecord,
  GovernanceDecisionRecord,
  GovernanceSubjectType,
  GovernanceTrigger
} from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import {
  evaluateAttachmentUploadPolicy,
  evaluateOutboundMessagePolicy,
  redactGovernanceText,
  resolveGovernancePolicyAudit,
  sanitizeGovernanceSourceTags,
  type AttachmentUploadPolicyInput,
  type GovernanceDecision,
  type GovernancePolicyAudit,
  type GovernanceSourceTag,
  type OutboundMessagePolicyInput
} from "@tyr-ai/governance";
import type { GovernanceRuntimeConfig } from "./governance-runtime";

type GovernanceStore = Pick<TyrDb, "createGovernanceDecision">;

export type PreparedOutboundGovernance = {
  decision: GovernanceDecision;
  blocked: boolean;
  caseSummary: Record<string, unknown>;
  mode?: GovernanceRuntimeConfig["mode"];
  record?: (subjectId: string, subjectContext?: GovernanceSubjectContext) => GovernanceDecisionRecord;
};

export type GovernanceSubjectContext = {
  executionId?: string;
  approvalId?: string;
  taskId?: string;
  messageId?: string;
  threadChannelId?: string;
};

export type GovernanceBlockedResponse = {
  error: "governance_blocked";
  decision: GovernanceDecisionRecord["decision"] | GovernanceDecision["decision"];
  reason: string;
  riskTypes: string[];
  model?: string;
  governanceDecisionId?: string;
  sourceTags?: GovernanceSourceTag[];
};

export function prepareOutboundMessageGovernance(input: {
  store: GovernanceStore;
  config?: GovernanceRuntimeConfig;
  agent: AgentRecord;
  channel: ChannelRecord;
  serverId: string;
  message: OutboundMessagePolicyInput;
  auditOnlyFinalReply?: boolean;
}): PreparedOutboundGovernance | null {
  const sourceTags = sanitizeGovernanceSourceTags(input.message.sourceContexts ?? []);
  const policyAudit = policyAuditForGovernance(input.config, input.serverId, input.agent.id);
  const evaluatedDecision = evaluateOutboundMessagePolicy({ ...input.message, policy: policyAudit.resolvedPolicy, sourceContexts: sourceTags });
  const decision: GovernanceDecision = input.auditOnlyFinalReply
    ? {
        decision: "allow",
        confidence: evaluatedDecision.confidence,
        riskTypes: evaluatedDecision.riskTypes.filter((risk) => risk !== "external_send" && risk !== "cross_context"),
        reason: "The execution final reply is retained in its source DM for downstream disclosure handling.",
        evidence: evaluatedDecision.evidence.filter((item) => !item.includes("outside the runtime")),
        shouldUseModel: false
      }
    : evaluatedDecision;
  return preparedGovernanceDecision({
    store: input.store,
    config: input.config,
    agent: input.agent,
    serverId: input.serverId,
    trigger: "message_send",
    subjectType: "message",
    decision,
    policyAudit,
    subjectContext: {
      threadChannelId: input.channel.type === "thread" ? input.channel.id : undefined
    },
    caseSummary: {
      action: "message send",
      target: input.message.target,
      contentChars: input.message.content.length,
      attachmentCount: input.message.attachmentIds?.length ?? 0,
      executeMentions: Boolean(input.message.executeMentions),
      targetChannelId: input.message.targetChannelId,
      sourceChannelId: input.message.sourceChannelId,
      sourceTags,
      transport: input.auditOnlyFinalReply ? "execution_final_reply" : "message_send",
      enforcement: input.auditOnlyFinalReply ? "audit_only" : "policy",
      deterministicDecision: decision.decision,
      deterministicRiskTypes: decision.riskTypes,
      ...(input.auditOnlyFinalReply ? {
        detectedDecision: evaluatedDecision.decision,
        detectedRiskTypes: evaluatedDecision.riskTypes
      } : {}),
      policy: policyAudit
    }
  });
}

export function prepareDelegationGovernance(input: {
  store: GovernanceStore;
  config?: GovernanceRuntimeConfig;
  agent: AgentRecord;
  targetAgent: AgentRecord;
  serverId: string;
  message: OutboundMessagePolicyInput;
}): PreparedOutboundGovernance | null {
  const sourceTags = sanitizeGovernanceSourceTags(input.message.sourceContexts ?? []);
  const policyAudit = policyAuditForGovernance(input.config, input.serverId, input.agent.id);
  const decision = evaluateOutboundMessagePolicy({ ...input.message, policy: policyAudit.resolvedPolicy, sourceContexts: sourceTags });
  return preparedGovernanceDecision({
    store: input.store,
    config: input.config,
    agent: input.agent,
    serverId: input.serverId,
    trigger: "message_send",
    subjectType: "runtime_execution",
    decision,
    policyAudit,
    caseSummary: {
      action: "agent delegation",
      target: input.message.target,
      targetAgentId: input.targetAgent.id,
      contentChars: input.message.content.length,
      sameServer: Boolean(input.message.delegation?.sameServer),
      sourceTags,
      deterministicDecision: decision.decision,
      deterministicRiskTypes: decision.riskTypes,
      policy: policyAudit
    }
  });
}

export function prepareAttachmentUploadGovernance(input: {
  store: GovernanceStore;
  config?: GovernanceRuntimeConfig;
  agent: AgentRecord;
  channel: ChannelRecord;
  serverId: string;
  upload: AttachmentUploadPolicyInput;
}): PreparedOutboundGovernance | null {
  const sourceTags = sanitizeGovernanceSourceTags(input.upload.sourceContexts ?? []);
  const policyAudit = policyAuditForGovernance(input.config, input.serverId, input.agent.id);
  const decision = evaluateAttachmentUploadPolicy({ ...input.upload, policy: policyAudit.resolvedPolicy, sourceContexts: sourceTags });
  return preparedGovernanceDecision({
    store: input.store,
    config: input.config,
    agent: input.agent,
    serverId: input.serverId,
    trigger: "attachment_upload",
    subjectType: "attachment",
    decision,
    policyAudit,
    subjectContext: {
      threadChannelId: input.channel.type === "thread" ? input.channel.id : undefined
    },
    caseSummary: {
      action: "attachment upload",
      filename: redactGovernanceText(input.upload.filename, 160),
      mimeType: input.upload.mimeType,
      sizeBytes: input.upload.sizeBytes,
      contentPreviewScanned: Boolean(input.upload.contentPreview),
      sourcePath: input.upload.sourcePath ? redactGovernanceText(input.upload.sourcePath, 160) : undefined,
      sourceTags,
      deterministicDecision: decision.decision,
      deterministicRiskTypes: decision.riskTypes,
      policy: policyAudit
    }
  });
}

export function governanceBlockedResponse(record: GovernanceDecisionRecord | GovernanceDecision, caseSummary?: Record<string, unknown>): GovernanceBlockedResponse {
  const governanceDecisionId = governanceDecisionRecordId(record);
  const model = governanceDecisionRecordModel(record);
  const sourceTags = sourceTagsForBlockedResponse(record, caseSummary);
  return {
    error: "governance_blocked",
    decision: record.decision,
    reason: record.reason,
    riskTypes: record.riskTypes,
    ...(model ? { model } : {}),
    ...(governanceDecisionId ? { governanceDecisionId } : {}),
    ...(sourceTags.length ? { sourceTags } : {})
  };
}

export function blockedSubjectId(trigger: GovernanceTrigger): string {
  return `blocked:${trigger}:${randomUUID().replaceAll("-", "")}`;
}

function preparedGovernanceDecision(input: {
  store: GovernanceStore;
  config?: GovernanceRuntimeConfig;
  agent: AgentRecord;
  serverId: string;
  trigger: GovernanceTrigger;
  subjectType: GovernanceSubjectType;
  decision: GovernanceDecision;
  policyAudit: GovernancePolicyAudit;
  subjectContext?: GovernanceSubjectContext;
  caseSummary: Record<string, unknown>;
}): PreparedOutboundGovernance | null {
  const config = input.config?.enabled ? input.config : null;
  const blocked = shouldBlock(config?.mode, input.decision);
  if (!config) return blocked ? { decision: input.decision, blocked, caseSummary: input.caseSummary } : null;
  if (!input.agent.machineId || !input.agent.runtime) return blocked ? { decision: input.decision, blocked, caseSummary: input.caseSummary } : null;
  const machineId = input.agent.machineId;
  const runtime = input.agent.runtime;
  return {
    decision: input.decision,
    blocked,
    caseSummary: input.caseSummary,
    mode: config.mode,
    record: (subjectId, subjectContext = {}) => input.store.createGovernanceDecision({
      id: `gov_${randomUUID().replaceAll("-", "")}`,
      serverId: input.serverId,
      machineId,
      agentId: input.agent.id,
      runtime,
      trigger: input.trigger,
      subjectType: input.subjectType,
      subjectId,
      mode: config.mode,
      decision: input.decision.decision,
      confidence: input.decision.confidence,
      riskTypes: input.decision.riskTypes,
      reason: input.decision.reason,
      evidence: input.decision.evidence.slice(0, 5),
      policyVersion: input.policyAudit.version,
      policySource: input.policyAudit.source,
      policyScope: input.policyAudit.scope,
      decisionSource: "deterministic",
      executionId: subjectContext.executionId,
      approvalId: subjectContext.approvalId,
      taskId: subjectContext.taskId,
      messageId: subjectContext.messageId,
      threadChannelId: subjectContext.threadChannelId ?? input.subjectContext?.threadChannelId,
      model: "deterministic",
      caseSummary: input.caseSummary
    })
  };
}

function policyAuditForGovernance(config: GovernanceRuntimeConfig | undefined, serverId: string, agentId: string): GovernancePolicyAudit {
  const policyConfig = config?.policyConfig ?? {};
  const version = config?.policyVersion ?? policyConfig.version ?? "builtin-v1";
  return resolveGovernancePolicyAudit(config ? { ...policyConfig, version } : undefined, { serverId, agentId });
}

function shouldBlock(mode: GovernanceRuntimeConfig["mode"] | undefined, decision: GovernanceDecision): boolean {
  if (!mode) return decision.decision === "deny" || decision.decision === "require_human" || decision.decision === "unknown";
  if (mode === "shadow") return false;
  return decision.decision === "deny" || decision.decision === "require_human" || decision.decision === "unknown";
}

function governanceDecisionRecordId(record: GovernanceDecisionRecord | GovernanceDecision): string | undefined {
  return "id" in record ? record.id : undefined;
}

function governanceDecisionRecordModel(record: GovernanceDecisionRecord | GovernanceDecision): string | undefined {
  return "model" in record ? record.model : undefined;
}

function sourceTagsForBlockedResponse(record: GovernanceDecisionRecord | GovernanceDecision, fallbackCaseSummary?: Record<string, unknown>): GovernanceSourceTag[] {
  const caseSummary = "caseSummary" in record ? record.caseSummary ?? fallbackCaseSummary : fallbackCaseSummary;
  const rawSourceTags = caseSummary?.sourceTags;
  return Array.isArray(rawSourceTags) ? sanitizeGovernanceSourceTags(rawSourceTags as GovernanceSourceTag[]) : [];
}
