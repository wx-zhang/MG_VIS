import type { GovernanceDecisionRecord, RuntimeApprovalRecord, SafetyAssessmentRecord } from "@tyr-ai/contracts";

const COMPACT_TEXT_LIMIT = 500;
const COMPACT_ARRAY_LIMIT = 20;
const COMPACT_OBJECT_KEYS_LIMIT = 30;

export function compactRuntimeApprovalForSync(approval: RuntimeApprovalRecord): RuntimeApprovalRecord {
  const customResponse = compactOptionalString(approval.customResponse);
  return {
    ...approval,
    detail: compactString(approval.detail),
    customResponse,
    payload: compactSyncValue(approval.payload)
  };
}

export function compactSafetyAssessmentForSync(assessment: SafetyAssessmentRecord): SafetyAssessmentRecord {
  return {
    ...assessment,
    analysis: compactString(assessment.analysis),
    evidence: assessment.evidence.slice(0, COMPACT_ARRAY_LIMIT).map(compactString)
  };
}

export function compactGovernanceDecisionForSync(decision: GovernanceDecisionRecord): GovernanceDecisionRecord {
  const caseSummary = decision.caseSummary ? compactSyncValue(decision.caseSummary) : undefined;
  return {
    ...decision,
    reason: compactString(decision.reason),
    evidence: decision.evidence.slice(0, COMPACT_ARRAY_LIMIT).map(compactString),
    caseSummary: caseSummary && typeof caseSummary === "object" && !Array.isArray(caseSummary)
      ? caseSummary as Record<string, unknown>
      : undefined
  };
}

export function compactString(value: string): string {
  return value.length > COMPACT_TEXT_LIMIT ? `${value.slice(0, COMPACT_TEXT_LIMIT)}\n[truncated]` : value;
}

export function compactOptionalString(value: string | undefined): string | undefined {
  return value === undefined ? undefined : compactString(value);
}

export function compactSyncValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return compactString(value);
  if (!value || typeof value !== "object") return value;
  if (depth > 4) return "[Object depth limit]";
  if (Array.isArray(value)) return value.slice(0, COMPACT_ARRAY_LIMIT).map((item) => compactSyncValue(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value).slice(0, COMPACT_OBJECT_KEYS_LIMIT)) {
    result[key] = compactSyncValue(nested, depth + 1);
  }
  return result;
}
