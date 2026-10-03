import type { GovernanceDecisionRecord, GovernanceDecisionValue, GovernanceTrigger } from "@tyr-ai/contracts";

export type GovernanceDecisionContext = {
  taskId?: string;
  messageId?: string;
  threadChannelId?: string;
  executionIds?: string[];
  approvalIds?: string[];
};

export type PreActionGovernanceReview = {
  decisions: GovernanceDecisionRecord[];
  riskTypes: string[];
  updatedAt: string;
};

export type GovernanceSourceSummaryTag = {
  sourceType?: string;
  sourceTrust?: string;
  sourceId?: string;
  channelId?: string;
  messageId?: string;
  attachmentId?: string;
  threadChannelId?: string;
  propagation?: string[];
};

export function governanceDecisionsForContext(
  decisions: GovernanceDecisionRecord[],
  context: GovernanceDecisionContext,
  options: { limit?: number; includeAllow?: boolean } = {}
): GovernanceDecisionRecord[] {
  const executionIds = new Set(context.executionIds ?? []);
  const approvalIds = new Set(context.approvalIds ?? []);
  const includeAllow = options.includeAllow === true;
  const seen = new Set<string>();
  const matches: GovernanceDecisionRecord[] = [];
  for (const decision of decisions) {
    if (!includeAllow && decision.decision === "allow") continue;
    if (!matchesContext(decision, context, executionIds, approvalIds)) continue;
    if (seen.has(decision.id)) continue;
    seen.add(decision.id);
    matches.push(decision);
  }
  return matches
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, options.limit ?? 3);
}

export function preActionGovernanceReviewForContext(
  decisions: GovernanceDecisionRecord[],
  context: GovernanceDecisionContext
): PreActionGovernanceReview | null {
  const matches = governanceDecisionsForContext(decisions, context);
  if (matches.length === 0) return null;
  return {
    decisions: matches,
    riskTypes: uniqueRiskTypes(matches),
    updatedAt: matches.map((item) => item.createdAt).sort((a, b) => b.localeCompare(a))[0]
  };
}

export function governanceDecisionLabel(decision: GovernanceDecisionValue | string): string {
  if (decision === "allow") return "Allow";
  if (decision === "deny") return "Deny";
  if (decision === "require_human") return "Review";
  return "Unknown";
}

export function governanceDecisionActionLabel(trigger: GovernanceTrigger | string): string {
  if (trigger === "message_send") return "Message send";
  if (trigger === "attachment_upload") return "Attachment upload";
  return "Command";
}

export function governanceRiskLabel(riskType: string): string {
  return riskType.replaceAll("_", " ");
}

export function governanceSourceSummariesFromDecision(decision: Pick<GovernanceDecisionRecord, "caseSummary">, limit = 2): string[] {
  return governanceSourceSummaryLabels(sourceTagsFromCaseSummary(decision.caseSummary), limit);
}

export function governanceSourceSummaryLabels(tags: unknown, limit = 2): string[] {
  const summaries: string[] = [];
  const seen = new Set<string>();
  for (const tag of parseSourceTags(tags)) {
    const summary = governanceSourceSummaryLabel(tag);
    if (!summary || seen.has(summary)) continue;
    seen.add(summary);
    summaries.push(summary);
    if (summaries.length >= limit) break;
  }
  return summaries;
}

function governanceSourceSummaryLabel(tag: GovernanceSourceSummaryTag): string | null {
  const propagation = tag.propagation ?? [];
  const id = compactSourceId(tag.attachmentId ?? tag.messageId ?? tag.sourceId);
  if (tag.sourceType === "attachment") return `from attachment ${id ?? "source"}`;
  if (propagation.includes("quote_message")) return id ? `from quoted message ${id}` : "from quoted message";
  if (propagation.includes("delegation_source_message")) return id ? `from delegated source message ${id}` : "from delegated source message";
  if (tag.sourceTrust === "generated_artifact") return "from generated artifact";
  if (propagation.some((item) => item.startsWith("web:"))) return "from web input";
  if (propagation.some((item) => item.includes("untrusted_local_source") || item.startsWith("read:")) || tag.sourceId === "<local-path>") return "from local input";
  if (tag.sourceType === "channel_message" || tag.sourceType === "user_message") return id ? `from message ${id}` : "from message";
  if (tag.sourceType === "tool_output") return "from tool output";
  if (tag.sourceTrust === "untrusted_external") return "from untrusted input";
  return null;
}

function sourceTagsFromCaseSummary(caseSummary: Record<string, unknown> | undefined): unknown {
  return caseSummary?.sourceTags;
}

function parseSourceTags(value: unknown): GovernanceSourceSummaryTag[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((item) => ({
      sourceType: stringValue(item.sourceType),
      sourceTrust: stringValue(item.sourceTrust),
      sourceId: stringValue(item.sourceId),
      channelId: stringValue(item.channelId),
      messageId: stringValue(item.messageId),
      attachmentId: stringValue(item.attachmentId),
      threadChannelId: stringValue(item.threadChannelId),
      propagation: Array.isArray(item.propagation) ? item.propagation.map(String).filter(Boolean) : undefined
    }));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactSourceId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > 32 ? value.slice(0, 32) : value;
}

function matchesContext(
  decision: GovernanceDecisionRecord,
  context: GovernanceDecisionContext,
  executionIds: Set<string>,
  approvalIds: Set<string>
): boolean {
  if (context.taskId && decision.taskId === context.taskId) return true;
  if (context.messageId && decision.messageId === context.messageId) return true;
  if (context.threadChannelId && decision.threadChannelId === context.threadChannelId) return true;
  if (decision.executionId && executionIds.has(decision.executionId)) return true;
  if (decision.approvalId && approvalIds.has(decision.approvalId)) return true;
  return false;
}

function uniqueRiskTypes(decisions: GovernanceDecisionRecord[]): string[] {
  const riskTypes = new Set<string>();
  for (const decision of decisions) {
    for (const riskType of decision.riskTypes) riskTypes.add(riskType);
  }
  return [...riskTypes];
}
