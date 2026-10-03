import type {
  AttachmentUploadPolicyInput,
  GovernanceCustomerSummary,
  GovernanceCustomerSummaryInput,
  GovernanceDecision,
  GovernanceDecisionValue,
  GovernanceRiskType,
  GovernanceSourceTag,
  GovernanceTrigger,
  OutboundMessagePolicyInput
} from "./types";
import { DEFAULT_GOVERNANCE_POLICY } from "./policy";
import { addRisk } from "./deterministic-policy";
import { containsLocalPath, containsSensitiveContent, sanitizeGovernanceSourceTags } from "./redaction";

export function evaluateOutboundMessagePolicy(input: OutboundMessagePolicyInput): GovernanceDecision {
  const policy = input.policy ?? DEFAULT_GOVERNANCE_POLICY;
  const target = input.target.trim();
  const content = input.content ?? "";
  const sourceContexts = sanitizeGovernanceSourceTags(input.sourceContexts ?? []);
  const risks: GovernanceRiskType[] = [];
  const evidence: string[] = [];
  const hasSecret = containsSensitiveContent(content);
  const hasLocalPath = containsLocalPath(content);
  const sourceCrossContext = hasCrossContextSource(input.targetChannelId, sourceContexts);
  const sameServerDelegation = Boolean(input.delegation?.sameServer);
  const sameSourceChannel = Boolean(input.sourceChannelId && input.targetChannelId && input.sourceChannelId === input.targetChannelId);
  const crossContext = !sameServerDelegation && (
    Boolean(input.executeMentions) ||
    (!sameSourceChannel && isCrossContextTarget(target)) ||
    sourceCrossContext
  );

  if (hasSecret || hasLocalPath || crossContext) {
    addRisk(risks, "external_send", evidence, "agent is sending content outside the runtime");
  }
  if (crossContext) addRisk(risks, "cross_context", evidence, crossContextEvidence(input));
  if (hasSecret) addRisk(risks, "sensitive_content", evidence, "message content contains secret-like material");
  if (hasLocalPath) addRisk(risks, "sensitive_content", evidence, "message content contains local path material");

  if (hasSecret) {
    return {
      decision: policy.secret_external_send,
      confidence: 0.95,
      riskTypes: risks,
      reason: "Outbound message contains secret-like content before sending.",
      evidence,
      shouldUseModel: false
    };
  }
  if (risks.length > 0) {
    return {
      decision: risks.includes("cross_context") ? policy.cross_context : "require_human",
      confidence: 0.74,
      riskTypes: risks,
      reason: "Outbound message crosses context or carries potentially sensitive metadata.",
      evidence,
      shouldUseModel: false
    };
  }
  return {
    decision: "allow",
    confidence: 0.85,
    riskTypes: [],
    reason: "Outbound message contains no deterministic governance risk signal.",
    evidence: [],
    shouldUseModel: false
  };
}

export function evaluateAttachmentUploadPolicy(input: AttachmentUploadPolicyInput): GovernanceDecision {
  const sourceContexts = sanitizeGovernanceSourceTags(input.sourceContexts ?? []);
  // generated_artifact 的 sourcePath 是本地生成物定位信息；治理只扫描文件内容和展示元数据。
  const sourcePathIsGeneratedArtifact = sourceContexts.some((source) => source.sourceTrust === "generated_artifact");
  const text = [
    input.filename,
    input.mimeType,
    sourcePathIsGeneratedArtifact ? "" : input.sourcePath ?? "",
    input.contentPreview ?? ""
  ].join("\n");
  const policy = input.policy ?? DEFAULT_GOVERNANCE_POLICY;
  const risks: GovernanceRiskType[] = [];
  const evidence: string[] = [];
  const textPreviewScanned = Boolean(input.contentPreview) && isTextLikeMime(input.mimeType, input.filename);
  const hasSecret = containsSensitiveContent(text);
  const hasLocalPath = containsLocalPath(text);

  if (hasSecret) addRisk(risks, "sensitive_content", evidence, "attachment upload contains secret-like material");
  if (hasLocalPath) addRisk(risks, "sensitive_content", evidence, "attachment upload contains local path material");
  if (!textPreviewScanned && !isTextLikeMime(input.mimeType, input.filename)) {
    evidence.push("binary attachment assessed by metadata only");
  }

  if (hasSecret) {
    return {
      decision: policy.sensitive_upload,
      confidence: 0.95,
      riskTypes: risks,
      reason: "Attachment upload contains secret-like content before sending.",
      evidence,
      shouldUseModel: false
    };
  }
  if (risks.length > 0) {
    return {
      decision: "require_human",
      confidence: 0.72,
      riskTypes: risks,
      reason: "Attachment upload contains potentially sensitive metadata.",
      evidence,
      shouldUseModel: false
    };
  }
  return {
    decision: "allow",
    confidence: 0.85,
    riskTypes: [],
    reason: "Attachment upload contains no deterministic governance risk signal.",
    evidence: [],
    shouldUseModel: false
  };
}

export function governanceCustomerSummary(input: GovernanceCustomerSummaryInput): GovernanceCustomerSummary {
  return {
    action: governanceActionLabel(input.trigger),
    decision: governanceDecisionLabel(input.decision),
    judge: input.model?.trim() || "deterministic",
    risks: input.riskTypes.map(governanceRiskLabel),
    reason: input.reason
  };
}

function crossContextEvidence(input: OutboundMessagePolicyInput): string {
  if (hasCrossContextSource(input.targetChannelId, input.sourceContexts ?? [])) return "source channel differs from target channel";
  if (input.executeMentions) return "send action can trigger mentioned agent execution";
  return "send action targets an explicit DM or thread context";
}

function hasCrossContextSource(targetChannelId: string | undefined, sourceContexts: GovernanceSourceTag[]): boolean {
  if (!targetChannelId) return false;
  return sourceContexts.some((source) => Boolean(source.channelId && source.channelId !== targetChannelId));
}

function isCrossContextTarget(target: string): boolean {
  const trimmed = target.trim();
  if (!trimmed) return false;
  if (/^dm:@/i.test(trimmed)) return true;
  return trimmed.includes(":");
}

function isTextLikeMime(mimeType: string, filename: string): boolean {
  const mime = mimeType.toLowerCase();
  const lowerName = filename.toLowerCase();
  return mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("yaml") ||
    /\.(?:txt|md|json|jsonl|yaml|yml|xml|csv|tsv|env|ini|conf|config|log|sh|bash|zsh|js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|sql)$/i.test(lowerName);
}

function governanceActionLabel(trigger: GovernanceTrigger): string {
  if (trigger === "message_send") return "Message send";
  if (trigger === "attachment_upload") return "Attachment upload";
  return "Command";
}

function governanceDecisionLabel(decision: GovernanceDecisionValue): string {
  if (decision === "allow") return "Allow";
  if (decision === "deny") return "Deny";
  if (decision === "require_human") return "Review";
  return "Unknown";
}

function governanceRiskLabel(riskType: string): string {
  return riskType.replaceAll("_", " ");
}
