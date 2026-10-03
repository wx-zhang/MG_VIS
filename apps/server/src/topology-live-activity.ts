import type {
  RuntimeExecutionEventKind,
  RuntimeExecutionEventRecord,
  RuntimeExecutionRecord,
  TopologyLiveActivityKind,
  TopologyLiveActivityRecord
} from "@tyr-ai/contracts";
import {
  TOPOLOGY_TERMINAL_FLOW_WINDOW_MS,
  topologyExecutionIsLive
} from "./topology-communication-flow";
import { sanitizeHumanVisibleText } from "./output-disclosure";

export const TOPOLOGY_TERMINAL_ACTIVITY_WINDOW_MS = TOPOLOGY_TERMINAL_FLOW_WINDOW_MS;

const TERMINAL_ACTIVITY_KIND_BY_STATUS = new Map<RuntimeExecutionRecord["status"], TopologyLiveActivityKind>([
  ["completed", "completed"],
  ["failed", "failed"],
  ["stalled", "stalled"],
  ["cancelled", "cancelled"]
]);

const PHASE_EVENT_KINDS = new Set<RuntimeExecutionEventKind>([
  "queued",
  "delivered",
  "delivery_acknowledged",
  "turn_started",
  "thinking",
  "tool_call",
  "tool_output",
  "approval_request",
  "approval_resolved",
  "turn_completed",
  "error"
]);

export function topologyExecutionHasVisibleActivity(execution: RuntimeExecutionRecord, nowMs: number): boolean {
  if (topologyExecutionIsLive(execution, nowMs)) return true;
  if (!TERMINAL_ACTIVITY_KIND_BY_STATUS.has(execution.status)) return false;
  const updatedAt = Date.parse(execution.updatedAt);
  // 终态只为一次性反馈保留短窗口；历史执行继续留在审计与 Execution 详情，不常驻场景。
  return Number.isFinite(updatedAt) && Math.max(0, nowMs - updatedAt) <= TOPOLOGY_TERMINAL_ACTIVITY_WINDOW_MS;
}

export function topologyLiveActivityForExecution(input: {
  execution: RuntimeExecutionRecord;
  events: readonly RuntimeExecutionEventRecord[];
  pendingApprovalId?: string;
  workspaceId: string;
  nowMs: number;
}): TopologyLiveActivityRecord | null {
  const { execution, events, pendingApprovalId, workspaceId, nowMs } = input;
  if (!topologyExecutionHasVisibleActivity(execution, nowMs)) return null;

  const terminalKind = TERMINAL_ACTIVITY_KIND_BY_STATUS.get(execution.status);
  if (terminalKind) {
    const terminalEvent = latestTerminalEvent(events, terminalKind);
    return {
      id: terminalEvent
        ? `${execution.id}:${terminalKind}:${terminalEvent.id}`
        : `${execution.id}:${terminalKind}:${execution.updatedAt}`,
      executionId: execution.id,
      workspaceId,
      agentId: execution.agentId,
      machineId: execution.machineId,
      kind: terminalKind,
      status: execution.status,
      continuous: false,
      eventId: terminalEvent?.id,
      createdAt: terminalEvent?.at ?? execution.updatedAt,
      updatedAt: execution.updatedAt
    };
  }

  const phaseEvent = latestPhaseEvent(events);
  const kind = continuousActivityKind(execution, phaseEvent, pendingApprovalId);
  return {
    // Continuous ID 只随语义阶段变化，assistant delta 不会制造新的活动或重复动画。
    id: `${execution.id}:${kind}`,
    executionId: execution.id,
    workspaceId,
    agentId: execution.agentId,
    machineId: execution.machineId,
    kind,
    status: execution.status,
    continuous: true,
    eventId: phaseEvent?.id,
    ...(kind === "thinking" ? { summary: topologyActivitySummary(events) } : {}),
    createdAt: activityStartedAt(execution, events, phaseEvent, kind),
    updatedAt: execution.updatedAt
  };
}

export function topologyLiveActivityStateKey(input: {
  execution: RuntimeExecutionRecord;
  events: readonly RuntimeExecutionEventRecord[];
  pendingApprovalId?: string;
  nowMs: number;
}): string {
  const activity = topologyLiveActivityForExecution({
    ...input,
    workspaceId: input.execution.serverId ?? ""
  });
  return [
    input.execution.status,
    input.execution.returnExecutionId ?? "",
    input.pendingApprovalId ?? "",
    activity?.id ?? "hidden",
    activity?.eventId ?? "",
    activity?.summary ?? "",
    topologyJourneyEventKey(input.events)
  ].join(":");
}

function topologyActivitySummary(events: readonly RuntimeExecutionEventRecord[]): string | undefined {
  const latestBoundarySequence = events.reduce((latest, event) => (
    event.kind !== "thinking" && PHASE_EVENT_KINDS.has(event.kind)
      ? Math.max(latest, event.sequence)
      : latest
  ), -1);
  const detail = [...events]
    .filter((event) => (
      event.kind === "thinking"
      && event.sequence > latestBoundarySequence
      && typeof event.detail === "string"
      && event.detail.trim()
      && event.detail.trim() !== "Thinking..."
    ))
    .sort((left, right) => left.sequence - right.sequence)
    .map((event) => event.detail)
    .join("");
  // 部分 runtime 不产生 public thinking，而是先用 assistant_output 说明下一步；该内容比 Bridge 路由回执更接近 Agent 的真实思考。
  const fallback = [...events].reverse().find((event) => (
    event.kind === "assistant_output"
    && typeof event.detail === "string"
    && event.detail.trim()
  ))?.detail;
  const visible = detail || fallback;
  if (!visible) return undefined;
  // public thinking 是流式 delta；当前语义阶段内聚合后再做显示层清洗，完整记录仍留在 Execution 详情中。
  const compact = sanitizeHumanVisibleText(visible).replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > 96 ? `${compact.slice(0, 93)}…` : compact;
}

function topologyJourneyEventKey(events: readonly RuntimeExecutionEventRecord[]): string {
  // ACK 与每次 tool_call 都会改变 Bridge Journey 的真实文案，即使 Activity 大类没有变化也要通知画布重取。
  return [...events].reverse().find((event) => (
    event.kind === "delivery_acknowledged" || event.kind === "tool_call"
  ))?.id ?? "";
}

function continuousActivityKind(
  execution: RuntimeExecutionRecord,
  phaseEvent: RuntimeExecutionEventRecord | undefined,
  pendingApprovalId: string | undefined
): TopologyLiveActivityKind {
  // Approval 是明确的人类阻塞点，必须覆盖此前的 thinking/tool 阶段。
  if (pendingApprovalId || execution.status === "waiting_approval") return "waiting_approval";
  if (execution.status === "queued") return "queued";
  if (execution.status === "delivered") return "delivered";
  return phaseEvent?.kind === "tool_call" ? "tool_running" : "thinking";
}

function latestPhaseEvent(events: readonly RuntimeExecutionEventRecord[]): RuntimeExecutionEventRecord | undefined {
  // 流式 assistant delta 和 diagnostic 不改变主要阶段，避免每个 token 都触发 Living Topology 刷新。
  return [...events].reverse().find((event) => PHASE_EVENT_KINDS.has(event.kind));
}

function latestTerminalEvent(
  events: readonly RuntimeExecutionEventRecord[],
  kind: TopologyLiveActivityKind
): RuntimeExecutionEventRecord | undefined {
  const expectedKind: RuntimeExecutionEventKind | undefined = kind === "completed"
    ? "turn_completed"
    : kind === "failed" || kind === "stalled"
      ? "error"
      : undefined;
  if (!expectedKind) return undefined;
  return [...events].reverse().find((event) => event.kind === expectedKind);
}

function activityStartedAt(
  execution: RuntimeExecutionRecord,
  events: readonly RuntimeExecutionEventRecord[],
  phaseEvent: RuntimeExecutionEventRecord | undefined,
  kind: TopologyLiveActivityKind
): string {
  if (kind === "waiting_approval") {
    return [...events].reverse().find((event) => event.kind === "approval_request")?.at ?? execution.updatedAt;
  }
  if (kind === "queued" || kind === "delivered") {
    return [...events].reverse().find((event) => event.kind === kind)?.at ?? execution.updatedAt;
  }
  return phaseEvent?.at ?? execution.updatedAt;
}
