import type { RuntimeApprovalRecord, RuntimeExecutionEventRecord } from "@tyr-ai/contracts";
import { compactExecutionText } from "./executionView";

export const RUNTIME_EVENT_REALTIME_LIMIT = 100;
export const RUNTIME_APPROVAL_REALTIME_LIMIT = 200;

export function trimRuntimeEventsForRealtime(
  events: RuntimeExecutionEventRecord[],
  limit = RUNTIME_EVENT_REALTIME_LIMIT
): RuntimeExecutionEventRecord[] {
  if (events.length <= limit) return [...events].map(compactRuntimeExecutionEventForRealtime).sort(compareRuntimeEventsAscending);
  return [...events]
    .sort(compareRuntimeEventsDescending)
    .slice(0, limit)
    .map(compactRuntimeExecutionEventForRealtime)
    .sort(compareRuntimeEventsAscending);
}

export function trimRuntimeApprovalsForRealtime(
  approvals: RuntimeApprovalRecord[],
  limit = RUNTIME_APPROVAL_REALTIME_LIMIT
): RuntimeApprovalRecord[] {
  return [...approvals]
    .sort(compareRuntimeApprovalsDescending)
    .slice(0, limit)
    .map(compactRuntimeApprovalForRealtime);
}

export function compactRuntimeExecutionEventForRealtime(event: RuntimeExecutionEventRecord): RuntimeExecutionEventRecord {
  return {
    ...event,
    detail: compactRuntimeString(event.detail),
    payload: compactRuntimeValue(event.payload)
  };
}

export function compactRuntimeApprovalForRealtime(approval: RuntimeApprovalRecord): RuntimeApprovalRecord {
  const customResponse = compactRuntimeString(approval.customResponse);
  return {
    ...approval,
    detail: compactRuntimeString(approval.detail) ?? "",
    customResponse: customResponse ?? undefined,
    payload: compactRuntimeValue(approval.payload)
  };
}

function compareRuntimeEventsAscending(a: RuntimeExecutionEventRecord, b: RuntimeExecutionEventRecord): number {
  return a.at.localeCompare(b.at) || a.sequence - b.sequence || a.id.localeCompare(b.id);
}

function compareRuntimeEventsDescending(a: RuntimeExecutionEventRecord, b: RuntimeExecutionEventRecord): number {
  return -compareRuntimeEventsAscending(a, b);
}

function compareRuntimeApprovalsDescending(a: RuntimeApprovalRecord, b: RuntimeApprovalRecord): number {
  return b.requestedAt.localeCompare(a.requestedAt) || b.id.localeCompare(a.id);
}

function compactRuntimeString(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  return compactExecutionText(value).text;
}

function compactRuntimeValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return compactExecutionText(value).text;
  if (!value || typeof value !== "object") return value;
  if (depth > 6) return "[Object depth limit]";
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => compactRuntimeValue(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    result[key] = compactRuntimeValue(nested, depth + 1);
  }
  return result;
}
