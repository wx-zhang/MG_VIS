import type {
  RuntimeApprovalKind
} from "@tyr-ai/contracts";
import type { RuntimeApprovalClassification } from "./runtime-rules";

export type GovernanceTrigger = "approval_request" | "message_send" | "attachment_upload";
export type GovernanceActionKind = RuntimeApprovalKind | "message_send" | "attachment_upload";
export type GovernanceDecisionValue = "allow" | "require_human" | "deny" | "unknown";
export type GovernanceDecisionSource = "deterministic" | "model" | "model_unavailable";
export type GovernancePolicySource = "built_in" | "env_json" | "db_config";
export type GovernancePolicyScope = "built_in" | "default" | "workspace" | "agent";
export type GovernanceRiskType =
  | "side_effect"
  | "unknown_action"
  | "cross_context"
  | "external_send"
  | "permission_escalation"
  | "destructive_command"
  | "sensitive_content"
  | "network"
  | "untrusted_input";

export type GovernanceTrustLabel =
  | "user_task_context_untrusted"
  | "agent_action"
  | "agent_output"
  | "runtime_system"
  | "untrusted_runtime_input";

export type GovernanceSourceType =
  | "user_message"
  | "channel_message"
  | "attachment"
  | "tool_output"
  | "agent_action"
  | "runtime_event";

export type GovernanceSourceTrust =
  | "task_context"
  | "untrusted_external"
  | "runtime_observation"
  | "generated_artifact"
  | "agent_action";

export type GovernanceSourceTag = {
  sourceType: GovernanceSourceType;
  sourceTrust: GovernanceSourceTrust;
  sourceId?: string;
  channelId?: string;
  messageId?: string;
  attachmentId?: string;
  threadChannelId?: string;
  propagation?: string[];
};

export type GovernancePolicyRule =
  | "destructive_command"
  | "secret_external_send"
  | "cross_context"
  | "unknown_action"
  | "sensitive_upload";

export type GovernancePolicyRules = Partial<Record<GovernancePolicyRule, GovernanceDecisionValue>>;

export type GovernancePolicyConfig = {
  version?: string;
  source?: GovernancePolicySource;
  default?: GovernancePolicyRules;
  workspaces?: Record<string, GovernancePolicyRules>;
  agents?: Record<string, GovernancePolicyRules>;
};

export type GovernanceResolvedPolicy = Required<Record<GovernancePolicyRule, GovernanceDecisionValue>>;

export type GovernancePolicyAudit = {
  version: string;
  source: GovernancePolicySource;
  scope: GovernancePolicyScope;
  matchedOverrides: string[];
  resolvedPolicy: GovernanceResolvedPolicy;
};

export type GovernanceProposedAction = {
  kind: GovernanceActionKind;
  name: string;
  target?: string;
  detail: string;
  argsSummary?: string;
  riskClass: RuntimeApprovalClassification;
};

export type GovernanceTrajectoryEntry = {
  sequence: number;
  kind: string;
  title?: string | null;
  detailExcerpt?: string | null;
  payloadExcerpt?: string | null;
  trust: GovernanceTrustLabel;
  at?: string;
};

export type GovernanceCase = {
  caseId: string;
  trigger: GovernanceTrigger;
  proposedAction: GovernanceProposedAction;
  executionContext: {
    executionId?: string;
    approvalId?: string;
    agentId: string;
    runtime: string;
    taskId?: string;
    messageId?: string;
    threadChannelId?: string;
    sourceMessage?: {
      id: string;
      senderType: string;
      trust: GovernanceTrustLabel;
      contentExcerpt: string;
    };
    task?: {
      id: string;
      title: string;
      status: string;
    };
  };
  sourceTags: GovernanceSourceTag[];
  trajectory: GovernanceTrajectoryEntry[];
  deterministicSignals: GovernanceDecision;
};

export type GovernanceDecision = {
  decision: GovernanceDecisionValue;
  confidence: number;
  riskTypes: GovernanceRiskType[];
  reason: string;
  evidence: string[];
  shouldUseModel?: boolean;
};

export type BuildGovernanceCaseOptions = {
  maxEvents?: number;
  maxCaseChars?: number;
  maxEventDetailChars?: number;
  maxEventPayloadChars?: number;
  maxSourceMessageChars?: number;
};

export type JudgeGovernanceOptions = {
  mode?: "model" | "dry-run";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export type OutboundMessagePolicyInput = {
  target: string;
  targetChannelId?: string;
  sourceChannelId?: string;
  content: string;
  attachmentIds?: string[];
  executeMentions?: boolean;
  delegation?: {
    sameServer: boolean;
    sourceAgentId?: string;
    targetAgentId?: string;
  };
  sourceContexts?: GovernanceSourceTag[];
  policy?: GovernanceResolvedPolicy;
};

export type AttachmentUploadPolicyInput = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sourcePath?: string;
  contentPreview?: string;
  sourceContexts?: GovernanceSourceTag[];
  policy?: GovernanceResolvedPolicy;
};

export type GovernanceCustomerSummaryInput = {
  trigger: GovernanceTrigger;
  decision: GovernanceDecisionValue;
  model?: string;
  riskTypes: string[];
  reason: string;
  confidence?: number;
  evidence?: string[];
};

export type GovernanceCustomerSummary = {
  action: string;
  decision: string;
  judge: string;
  risks: string[];
  reason: string;
};

export function isGovernanceDecisionValue(value: unknown): value is GovernanceDecisionValue {
  return value === "allow" || value === "require_human" || value === "deny" || value === "unknown";
}

export function isGovernanceRiskType(value: string): value is GovernanceRiskType {
  return [
    "side_effect",
    "unknown_action",
    "cross_context",
    "external_send",
    "permission_escalation",
    "destructive_command",
    "sensitive_content",
    "network",
    "untrusted_input"
  ].includes(value);
}

export function isGovernanceSourceType(value: string): value is GovernanceSourceType {
  return ["user_message", "channel_message", "attachment", "tool_output", "agent_action", "runtime_event"].includes(value);
}

export function isGovernanceSourceTrust(value: string): value is GovernanceSourceTrust {
  return ["task_context", "untrusted_external", "runtime_observation", "generated_artifact", "agent_action"].includes(value);
}
