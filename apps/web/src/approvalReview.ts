import type { GovernanceDecisionRecord, RuntimeApprovalRecord } from "@tyr-ai/contracts";

export type GovernanceApprovalReviewQueueKind = "outbound" | "runtime";

export interface GovernanceApprovalReviewItem {
  approval: RuntimeApprovalRecord;
  queueKind: GovernanceApprovalReviewQueueKind;
  riskTypes: string[];
  reason?: string;
  decision?: GovernanceDecisionRecord;
}

export interface GovernanceApprovalReviewSummary {
  pendingCount: number;
  outboundPendingCount: number;
  runtimePendingCount: number;
  blockedDecisionCount: number;
  requireHumanDecisionCount: number;
  riskTypes: string[];
  items: GovernanceApprovalReviewItem[];
  blockedDecisions: GovernanceDecisionRecord[];
  requireHumanDecisions: GovernanceDecisionRecord[];
}

export function governanceApprovalReviewSummary(input: {
  approvals: RuntimeApprovalRecord[];
  decisions: GovernanceDecisionRecord[];
}): GovernanceApprovalReviewSummary {
  const decisionsByApprovalId = latestDecisionByApprovalId(input.decisions);
  const pendingApprovals = input.approvals
    .filter((approval) => approval.status === "pending")
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const pendingApprovalIds = new Set(pendingApprovals.map((approval) => approval.id));
  const items = pendingApprovals.map((approval): GovernanceApprovalReviewItem => {
    const decision = decisionsByApprovalId.get(approval.id);
    const payloadGovernance = approvalPayloadGovernance(approval);
    const riskTypes = uniqueStrings([
      ...(decision?.riskTypes ?? []),
      ...arrayOfStrings(payloadGovernance?.riskTypes)
    ]);
    return {
      approval,
      queueKind: isOutboundApproval(approval) ? "outbound" : "runtime",
      riskTypes,
      reason: decision?.reason ?? stringValue(payloadGovernance?.reason),
      decision
    };
  });
  const blockedDecisions = input.decisions
    .filter((decision) => decision.decision === "deny")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const requireHumanDecisions = input.decisions
    // Resolved approval decisions are history, not entries in the current human-review queue.
    .filter((decision) => decision.decision === "require_human" && Boolean(decision.approvalId && pendingApprovalIds.has(decision.approvalId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    pendingCount: pendingApprovals.length,
    outboundPendingCount: items.filter((item) => item.queueKind === "outbound").length,
    runtimePendingCount: items.filter((item) => item.queueKind === "runtime").length,
    blockedDecisionCount: blockedDecisions.length,
    requireHumanDecisionCount: requireHumanDecisions.length,
    riskTypes: uniqueStrings([
      ...items.flatMap((item) => item.riskTypes),
      ...blockedDecisions.flatMap((decision) => decision.riskTypes),
      ...requireHumanDecisions.flatMap((decision) => decision.riskTypes)
    ]).sort(),
    items,
    blockedDecisions,
    requireHumanDecisions
  };
}

export function governanceApprovalReviewItemLabel(item: GovernanceApprovalReviewItem): string {
  const queue = item.queueKind === "outbound" ? "Outbound queue" : "Runtime approval";
  return item.riskTypes.length ? `${queue} · ${item.riskTypes.join(", ")}` : queue;
}

function isOutboundApproval(approval: RuntimeApprovalRecord): boolean {
  return approval.method.startsWith("governance/outbound/");
}

function latestDecisionByApprovalId(decisions: GovernanceDecisionRecord[]): Map<string, GovernanceDecisionRecord> {
  const out = new Map<string, GovernanceDecisionRecord>();
  for (const decision of [...decisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (!decision.approvalId || out.has(decision.approvalId)) continue;
    out.set(decision.approvalId, decision);
  }
  return out;
}

function approvalPayloadGovernance(approval: RuntimeApprovalRecord): Record<string, unknown> | null {
  const payload = approval.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const governance = (payload as { governance?: unknown }).governance;
  return governance && typeof governance === "object" && !Array.isArray(governance) ? governance as Record<string, unknown> : null;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}
