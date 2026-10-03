import type { SafetyAssessmentRecord } from "@tyr-ai/contracts";

export type SafetyReviewState = "safe" | "risk" | "needs_review";

export type SafetyAssessmentContext = {
  taskId?: string;
  messageId?: string;
  threadChannelId?: string;
  executionIds?: string[];
  approvalIds?: string[];
};

export type SafetyReview = {
  state: SafetyReviewState;
  assessments: SafetyAssessmentRecord[];
  riskTypes: string[];
  updatedAt: string;
};

export function safetyAssessmentsForContext(assessments: SafetyAssessmentRecord[], context: SafetyAssessmentContext): SafetyAssessmentRecord[] {
  const executionIds = new Set(context.executionIds ?? []);
  const approvalIds = new Set(context.approvalIds ?? []);
  const seen = new Set<string>();
  const matches: SafetyAssessmentRecord[] = [];
  for (const assessment of assessments) {
    if (!matchesContext(assessment, context, executionIds, approvalIds)) continue;
    // 一个 assessment 可能同时挂 task/message/execution，多路径命中时仍只展示一次。
    if (seen.has(assessment.id)) continue;
    seen.add(assessment.id);
    matches.push(assessment);
  }
  return matches;
}

export function safetyReviewForContext(assessments: SafetyAssessmentRecord[], context: SafetyAssessmentContext): SafetyReview | null {
  const matches = safetyAssessmentsForContext(assessments, context);
  if (matches.length === 0) return null;
  const sorted = [...matches].sort(compareSafetyAssessments);
  const state = safetyStateForAssessment(sorted[0]);
  return {
    state,
    assessments: sorted,
    riskTypes: uniqueRiskTypes(sorted),
    updatedAt: latestUpdatedAt(sorted)
  };
}

export function safetyStateForAssessment(assessment: SafetyAssessmentRecord): SafetyReviewState {
  if (assessment.label === "unsafe") return "risk";
  if (assessment.label === "unknown" || assessment.status === "queued" || assessment.status === "running" || assessment.status === "failed") return "needs_review";
  return "safe";
}

export function compareSafetyAssessments(a: SafetyAssessmentRecord, b: SafetyAssessmentRecord): number {
  return safetyStateRank(safetyStateForAssessment(a)) - safetyStateRank(safetyStateForAssessment(b)) ||
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
    a.id.localeCompare(b.id);
}

function matchesContext(
  assessment: SafetyAssessmentRecord,
  context: SafetyAssessmentContext,
  executionIds: Set<string>,
  approvalIds: Set<string>
): boolean {
  if (context.taskId && assessment.taskId === context.taskId) return true;
  if (context.messageId && assessment.messageId === context.messageId) return true;
  if (context.threadChannelId && assessment.threadChannelId === context.threadChannelId) return true;
  if (assessment.executionId && executionIds.has(assessment.executionId)) return true;
  if (assessment.approvalId && approvalIds.has(assessment.approvalId)) return true;
  return false;
}

function safetyStateRank(state: SafetyReviewState): number {
  if (state === "risk") return 0;
  if (state === "needs_review") return 1;
  return 2;
}

function uniqueRiskTypes(assessments: SafetyAssessmentRecord[]): string[] {
  const riskTypes = new Set<string>();
  for (const assessment of assessments) {
    for (const riskType of assessment.riskTypes) riskTypes.add(riskType);
  }
  return [...riskTypes];
}

function latestUpdatedAt(assessments: SafetyAssessmentRecord[]): string {
  return assessments
    .map((assessment) => assessment.updatedAt)
    .sort((a, b) => b.localeCompare(a))[0];
}
