import type { AppSnapshot, ExecutionContextPayload, GovernanceDecisionRecord, RuntimeApprovalRecord, RuntimeExecutionRecord, SafetyAssessmentRecord } from "@tyr-ai/contracts";
import { upsertExecutionBlockGuarded } from "./executionBlockRealtime";

export type ExecutionContextResponse = Partial<ExecutionContextPayload>;

export function terminalExecutionContextRefreshKey(executions: RuntimeExecutionRecord[]): string {
  return executions
    .filter((execution) => ["completed", "failed", "stalled", "cancelled"].includes(execution.status))
    .map((execution) => `${execution.id}:${execution.status}:${execution.updatedAt}`)
    .sort()
    .join("|");
}

export function mergeExecutionContextSnapshot(snapshot: AppSnapshot, context: ExecutionContextResponse | null): AppSnapshot {
  const sanitized = sanitizeExecutionContextPayload(context);
  if (!sanitized) return snapshot;
  const contextExecutions = [
    ...(sanitized.runtimeExecutions ?? []),
    ...(sanitized.childRuntimeExecutions ?? [])
  ];
  return {
    ...snapshot,
    executionGroups: mergeRecordsByFreshness(snapshot.executionGroups ?? [], sanitized.executionGroups ?? []),
    agentRuns: mergeRecordsByFreshness(snapshot.agentRuns ?? [], sanitized.agentRuns ?? []),
    executionBlocks: (sanitized.executionBlocks ?? []).reduce((items, block) => upsertExecutionBlockGuarded(items, block), snapshot.executionBlocks ?? []),
    runtimeExecutions: mergeRecordsByFreshness(snapshot.runtimeExecutions ?? [], contextExecutions),
    runtimeApprovals: mergeRecordsByFreshness(snapshot.runtimeApprovals ?? [], sanitized.runtimeApprovals ?? []),
    safetyAssessments: mergeRecordsByFreshness(snapshot.safetyAssessments ?? [], sanitized.safetyAssessments ?? []),
    governanceDecisions: mergeRecordsByFreshness(snapshot.governanceDecisions ?? [], sanitized.governanceDecisions ?? []),
    executionArtifacts: mergeRecordsByFreshness(snapshot.executionArtifacts ?? [], sanitized.executionArtifacts ?? [])
  };
}

const CONTEXT_RESOLVED_APPROVAL_LIMIT = 12;
const CONTEXT_SAFETY_ASSESSMENT_LIMIT = 12;
const CONTEXT_GOVERNANCE_DECISION_LIMIT = 12;
const CONTEXT_TEXT_LIMIT = 500;
const CONTEXT_ARRAY_LIMIT = 20;
const CONTEXT_OBJECT_KEYS_LIMIT = 30;

export function sanitizeExecutionContextPayload(context: ExecutionContextResponse | null): ExecutionContextResponse | null {
  if (!context) return null;
  const runtimeApprovals = compactRuntimeApprovals(context.runtimeApprovals ?? []);
  const visibleApprovalIds = new Set(runtimeApprovals.map((approval) => approval.id));
  return {
    ...context,
    runtimeApprovals,
    safetyAssessments: compactSafetyAssessments(context.safetyAssessments ?? [], visibleApprovalIds),
    governanceDecisions: compactGovernanceDecisions(context.governanceDecisions ?? [], visibleApprovalIds)
  };
}

export function mergeRecordsByFreshness<T extends { id: string }>(items: T[], incoming: T[]): T[] {
  return incoming.reduce((next, item) => {
    const existing = next.find((current) => current.id === item.id);
    if (!existing) return [...next, item];
    // 多个接口会返回同 ID 的执行/审批摘要，必须按业务时间选新记录，避免旧分页状态覆盖实时状态。
    if (recordTimestamp(existing) > recordTimestamp(item)) return next;
    return next.map((current) => current.id === item.id ? item : current);
  }, items);
}

function recordTimestamp(record: unknown): number {
  if (!record || typeof record !== "object") return 0;
  const item = record as Record<string, unknown>;
  for (const key of ["updatedAt", "resolvedAt", "requestedAt", "createdAt"]) {
    const value = item[key];
    if (typeof value !== "string") continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function compactRuntimeApprovals(approvals: RuntimeApprovalRecord[]): RuntimeApprovalRecord[] {
  const sorted = [...approvals].sort(compareRuntimeApprovalsDescending);
  const pending = sorted.filter((approval) => approval.status === "pending");
  const pendingIds = new Set(pending.map((approval) => approval.id));
  const resolved = sorted
    .filter((approval) => !pendingIds.has(approval.id))
    .slice(0, CONTEXT_RESOLVED_APPROVAL_LIMIT);
  return [...pending, ...resolved]
    .sort(compareRuntimeApprovalsDescending)
    .map(compactRuntimeApproval);
}

function compactSafetyAssessments(assessments: SafetyAssessmentRecord[], visibleApprovalIds: Set<string>): SafetyAssessmentRecord[] {
  return prioritizeApprovalLinkedRecords(
    assessments,
    visibleApprovalIds,
    CONTEXT_SAFETY_ASSESSMENT_LIMIT,
    (assessment) => assessment.approvalId,
    (assessment) => assessment.createdAt,
    (assessment) => ({
      ...assessment,
      analysis: compactString(assessment.analysis),
      evidence: assessment.evidence.slice(0, CONTEXT_ARRAY_LIMIT).map(compactString)
    })
  );
}

function compactGovernanceDecisions(decisions: GovernanceDecisionRecord[], visibleApprovalIds: Set<string>): GovernanceDecisionRecord[] {
  return prioritizeApprovalLinkedRecords(
    decisions,
    visibleApprovalIds,
    CONTEXT_GOVERNANCE_DECISION_LIMIT,
    (decision) => decision.approvalId,
    (decision) => decision.createdAt,
    (decision) => {
      const caseSummary = decision.caseSummary ? compactValue(decision.caseSummary) : undefined;
      return {
        ...decision,
        reason: compactString(decision.reason),
        evidence: decision.evidence.slice(0, CONTEXT_ARRAY_LIMIT).map(compactString),
        caseSummary: caseSummary && typeof caseSummary === "object" && !Array.isArray(caseSummary)
          ? caseSummary as Record<string, unknown>
          : undefined
      };
    }
  );
}

function prioritizeApprovalLinkedRecords<T extends { id: string }>(
  records: T[],
  visibleApprovalIds: Set<string>,
  limit: number,
  approvalId: (record: T) => string | undefined,
  createdAt: (record: T) => string,
  compact: (record: T) => T
): T[] {
  const sorted = [...records].sort((a, b) => createdAt(b).localeCompare(createdAt(a)) || b.id.localeCompare(a.id));
  const priority = sorted.filter((record) => {
    const id = approvalId(record);
    return Boolean(id && visibleApprovalIds.has(id));
  });
  const priorityIds = new Set(priority.map((record) => record.id));
  return [
    ...priority,
    ...sorted.filter((record) => !priorityIds.has(record.id)).slice(0, Math.max(0, limit - priority.length))
  ].slice(0, Math.max(limit, priority.length)).map(compact);
}

function compactRuntimeApproval(approval: RuntimeApprovalRecord): RuntimeApprovalRecord {
  const customResponse = approval.customResponse === undefined ? undefined : compactString(approval.customResponse);
  return {
    ...approval,
    detail: compactString(approval.detail),
    customResponse,
    payload: compactValue(approval.payload)
  };
}

function compareRuntimeApprovalsDescending(a: RuntimeApprovalRecord, b: RuntimeApprovalRecord): number {
  return b.requestedAt.localeCompare(a.requestedAt) || b.id.localeCompare(a.id);
}

function compactString(value: string): string {
  return value.length > CONTEXT_TEXT_LIMIT ? `${value.slice(0, CONTEXT_TEXT_LIMIT)}\n[truncated]` : value;
}

function compactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return compactString(value);
  if (!value || typeof value !== "object") return value;
  if (depth > 4) return "[Object depth limit]";
  if (Array.isArray(value)) return value.slice(0, CONTEXT_ARRAY_LIMIT).map((item) => compactValue(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value).slice(0, CONTEXT_OBJECT_KEYS_LIMIT)) {
    result[key] = compactValue(nested, depth + 1);
  }
  return result;
}
