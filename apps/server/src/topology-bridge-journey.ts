import type {
  CrossWorkspaceMessageRecord,
  RuntimeExecutionEventRecord,
  RuntimeExecutionRecord,
  TopologyBridgeJourneyActionKind,
  TopologyBridgeJourneyPhase,
  TopologyBridgeJourneyRecord
} from "@tyr-ai/contracts";
import { TOPOLOGY_ACTIVE_EXECUTION_WINDOW_MS, TOPOLOGY_TERMINAL_FLOW_WINDOW_MS } from "./topology-communication-flow";

export type TopologyBridgeJourneyExecution = {
  execution: RuntimeExecutionRecord;
  bridgeRequestMessageId: string;
  events: readonly RuntimeExecutionEventRecord[];
  pendingApprovalId?: string;
};

type JourneyPhaseResult = {
  phase: TopologyBridgeJourneyPhase;
  phaseAt: string;
  continuous: boolean;
  execution?: RuntimeExecutionRecord;
  event?: RuntimeExecutionEventRecord;
  actionKind?: TopologyBridgeJourneyActionKind;
};

const ACTIVE_PHASES = new Set<TopologyBridgeJourneyPhase>([
  "dispatching",
  "received",
  "running",
  "waiting_approval",
  "returning"
]);

const BRIDGE_DISPATCH_GROUP_WINDOW_MS = 400;

type JourneyActorAssignment = Pick<TopologyBridgeJourneyRecord, "actorMode" | "dispatchGroupId"> & {
  readyAtMs: number;
};

/**
 * Bridge Journey 只组合已持久化事实。message 证明跨 Workspace 投递，execution/event
 * 证明对端实际工作；没有事实时不能用动画计时器补造阶段。
 */
export function topologyBridgeJourneys(input: {
  messages: readonly CrossWorkspaceMessageRecord[];
  executions: readonly TopologyBridgeJourneyExecution[];
  nowMs: number;
}): TopologyBridgeJourneyRecord[] {
  const repliesByRequestId = new Map<string, CrossWorkspaceMessageRecord[]>();
  for (const message of input.messages) {
    if (!message.replyToMessageId) continue;
    const replies = repliesByRequestId.get(message.replyToMessageId) ?? [];
    replies.push(message);
    repliesByRequestId.set(message.replyToMessageId, replies);
  }
  const executionsByRequestId = new Map<string, TopologyBridgeJourneyExecution[]>();
  for (const entry of input.executions) {
    const current = executionsByRequestId.get(entry.bridgeRequestMessageId) ?? [];
    current.push(entry);
    executionsByRequestId.set(entry.bridgeRequestMessageId, current);
  }

  const requests = input.messages.filter((message) => !message.replyToMessageId && message.responseKind === null);
  const actorAssignments = bridgeJourneyActorAssignments(requests, repliesByRequestId);

  return requests
    .flatMap((request): TopologyBridgeJourneyRecord[] => {
      const actor = actorAssignments.get(request.id);
      if (!actor) return [];
      const replies = repliesByRequestId.get(request.id) ?? [];
      const executions = executionsByRequestId.get(request.id) ?? [];
      const result = bridgeJourneyPhase(request, replies, executions);
      if (!journeyIsVisible(result, input.nowMs)) return [];
      const targetDisplayName = "TYR";
      return [{
        id: `bridge-journey:${request.id}`,
        bridgeId: request.bridgeId,
        requestMessageId: request.id,
        dispatchGroupId: actor.dispatchGroupId,
        dispatchReadyAt: Number.isFinite(actor.readyAtMs) ? new Date(actor.readyAtMs).toISOString() : request.createdAt,
        actorMode: actor.actorMode,
        sourceWorkspaceId: request.sourceWorkspaceId,
        targetWorkspaceId: request.targetWorkspaceId,
        sourceAgentId: request.senderCommsAgentId,
        targetAgentId: request.receiverCommsAgentId,
        targetDisplayName,
        phase: result.phase,
        label: bridgeJourneyLabel(result.phase, result.actionKind),
        phaseAt: result.phaseAt,
        continuous: result.continuous,
        ...(result.execution ? { executionId: result.execution.id } : {}),
        ...(result.event ? { eventSequence: result.event.sequence } : {}),
        ...(result.actionKind ? { actionKind: result.actionKind } : {}),
        createdAt: request.createdAt,
        updatedAt: latestTimestamp([request.updatedAt ?? request.createdAt, result.phaseAt])
      }];
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

/**
 * 分身只表达真实并行：同一 400ms 派发批次有多个目标时全部使用分身；单路请求在原身空闲时直接出发。
 * 分配只依赖持久化消息与终态时间，因此轮询和刷新不会改变已经开始的角色身份。
 */
function bridgeJourneyActorAssignments(
  requests: readonly CrossWorkspaceMessageRecord[],
  repliesByRequestId: ReadonlyMap<string, readonly CrossWorkspaceMessageRecord[]>
): Map<string, JourneyActorAssignment> {
  const assignments = new Map<string, JourneyActorAssignment>();
  const bySource = new Map<string, CrossWorkspaceMessageRecord[]>();
  for (const request of requests) {
    const sourceKey = `${request.sourceWorkspaceId}:${request.senderCommsAgentId}`;
    const sourceRequests = bySource.get(sourceKey) ?? [];
    sourceRequests.push(request);
    bySource.set(sourceKey, sourceRequests);
  }

  for (const sourceRequests of bySource.values()) {
    const ordered = [...sourceRequests].sort((left, right) => (
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    ));
    const groups: CrossWorkspaceMessageRecord[][] = [];
    for (const request of ordered) {
      const current = groups.at(-1);
      const first = current?.[0];
      const requestAtMs = Date.parse(request.createdAt);
      const firstAtMs = first ? Date.parse(first.createdAt) : Number.NaN;
      const sameExplicitOrigin = first && bridgeJourneyDispatchOrigin(first) !== null
        && bridgeJourneyDispatchOrigin(first) === bridgeJourneyDispatchOrigin(request);
      const legacyTimeGroup = first && bridgeJourneyDispatchOrigin(first) === null
        && bridgeJourneyDispatchOrigin(request) === null;
      if (current && Number.isFinite(requestAtMs) && Number.isFinite(firstAtMs)
        && requestAtMs - firstAtMs <= BRIDGE_DISPATCH_GROUP_WINDOW_MS
        && (sameExplicitOrigin || legacyTimeGroup)) {
        current.push(request);
      } else {
        groups.push([request]);
      }
    }

    let directBusyUntilMs = Number.NEGATIVE_INFINITY;
    for (const group of groups) {
      const first = group[0]!;
      const groupStartedAtMs = Date.parse(first.createdAt);
      const readyAtMs = Number.isFinite(groupStartedAtMs)
        ? groupStartedAtMs + BRIDGE_DISPATCH_GROUP_WINDOW_MS
        : Number.NEGATIVE_INFINITY;
      const useClone = group.length > 1 || groupStartedAtMs < directBusyUntilMs;
      const dispatchGroupId = `bridge-dispatch:${first.id}`;
      for (const request of group) {
        assignments.set(request.id, { actorMode: useClone ? "clone" : "direct", dispatchGroupId, readyAtMs });
      }
      if (!useClone) {
        directBusyUntilMs = bridgeJourneyFinishedAtMs(first, repliesByRequestId.get(first.id) ?? []);
      }
    }
  }
  return assignments;
}

function bridgeJourneyDispatchOrigin(request: CrossWorkspaceMessageRecord): string | null {
  if (request.originMessageId) return `message:${request.originMessageId}`;
  if (request.traceId) return `trace:${request.traceId}`;
  return null;
}

function bridgeJourneyFinishedAtMs(
  request: CrossWorkspaceMessageRecord,
  replies: readonly CrossWorkspaceMessageRecord[]
): number {
  const terminal = latestMessage(replies.filter((reply) => (
    (reply.responseKind === "final" || reply.responseKind === "error")
    && (reply.outcome === "delivered" || reply.outcome === "failed")
  )));
  if (terminal) return Date.parse(terminal.updatedAt ?? terminal.createdAt);
  if (request.outcome === "failed") return Date.parse(request.updatedAt ?? request.createdAt);
  return Number.POSITIVE_INFINITY;
}

function bridgeJourneyPhase(
  request: CrossWorkspaceMessageRecord,
  replies: readonly CrossWorkspaceMessageRecord[],
  executions: readonly TopologyBridgeJourneyExecution[]
): JourneyPhaseResult {
  const finalReply = latestMessage(replies.filter((message) => message.responseKind === "final"));
  const errorReply = latestMessage(replies.filter((message) => message.responseKind === "error" && message.outcome === "delivered" || message.outcome === "failed"));
  if (request.outcome === "failed" || errorReply) {
    return { phase: "failed", phaseAt: errorReply?.updatedAt ?? errorReply?.createdAt ?? request.updatedAt ?? request.createdAt, continuous: false };
  }
  if (finalReply) {
    // final 已创建但尚未投递时仍在回传；只有发起方已收到结果才能让拜访角色返程。
    const delivered = finalReply.outcome === "delivered";
    return { phase: delivered ? "completed" : "returning", phaseAt: finalReply.updatedAt ?? finalReply.createdAt, continuous: !delivered };
  }

  const ranked = [...executions].sort((left, right) => (
    executionPriority(left) - executionPriority(right)
    || right.execution.updatedAt.localeCompare(left.execution.updatedAt)
    || left.execution.id.localeCompare(right.execution.id)
  ));
  const selected = ranked[0];
  if (selected) {
    const latestEvent = selected.events.at(-1);
    const acknowledgement = latestEventOfKind(selected.events, "delivery_acknowledged");
    if (selected.pendingApprovalId || selected.execution.status === "waiting_approval") {
      const approvalEvent = latestEventOfKind(selected.events, "approval_request");
      return {
        phase: "waiting_approval",
        phaseAt: approvalEvent?.at ?? selected.execution.updatedAt,
        continuous: true,
        execution: selected.execution,
        event: approvalEvent ?? latestEvent
      };
    }
    if (selected.execution.status === "running") {
      const actionKind = bridgeJourneyActionKind(latestEvent);
      return {
        phase: "running",
        phaseAt: latestEvent?.at ?? selected.execution.updatedAt,
        continuous: true,
        execution: selected.execution,
        event: latestEvent,
        actionKind
      };
    }
    if (selected.execution.status === "completed") {
      return {
        phase: "returning",
        phaseAt: selected.execution.completedAt ?? selected.execution.updatedAt,
        continuous: true,
        execution: selected.execution,
        event: latestEvent
      };
    }
    if (selected.execution.status === "cancelled") {
      return { phase: "cancelled", phaseAt: selected.execution.updatedAt, continuous: false, execution: selected.execution, event: latestEvent };
    }
    if (selected.execution.status === "failed" || selected.execution.status === "stalled") {
      return { phase: "failed", phaseAt: selected.execution.updatedAt, continuous: false, execution: selected.execution, event: latestEvent };
    }
    return {
      phase: "received",
      phaseAt: acknowledgement?.at ?? latestTimestamp([
        request.updatedAt ?? request.createdAt,
        selected.execution.updatedAt
      ]),
      continuous: true,
      execution: selected.execution,
      event: acknowledgement ?? latestEvent
    };
  }

  if (request.peerMessageId || request.outcome === "delivered") {
    return { phase: "received", phaseAt: request.updatedAt ?? request.createdAt, continuous: true };
  }
  return { phase: "dispatching", phaseAt: request.updatedAt ?? request.createdAt, continuous: true };
}

function executionPriority(entry: TopologyBridgeJourneyExecution): number {
  if (entry.pendingApprovalId || entry.execution.status === "waiting_approval") return 0;
  if (entry.execution.status === "running") return 1;
  if (entry.execution.status === "queued" || entry.execution.status === "delivered") return 2;
  if (entry.execution.status === "completed") return 3;
  if (entry.execution.status === "failed" || entry.execution.status === "stalled") return 4;
  return 5;
}

function bridgeJourneyActionKind(event: RuntimeExecutionEventRecord | undefined): TopologyBridgeJourneyActionKind {
  if (!event || event.kind !== "tool_call") return "thinking";
  const searchable = `${event.title ?? ""} ${toolPayloadText(event.payload)}`.toLowerCase();
  if (/web[_ -]?search|search|browser|browse/.test(searchable)) return "searching";
  if (/file[_ -]?change|apply[_ -]?patch|edit|write/.test(searchable)) return "editing_files";
  if (/(?:\btest\b|\btypecheck\b|\blint\b|\bbuild\b|\bcheck\b)/.test(searchable)) return "running_checks";
  return "using_tool";
}

function toolPayloadText(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const record = payload as Record<string, unknown>;
  return [record.toolName, record.name, record.command]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function bridgeJourneyLabel(
  phase: TopologyBridgeJourneyPhase,
  actionKind?: TopologyBridgeJourneyActionKind
): string {
  if (phase === "dispatching") return "Sending request to TYR";
  if (phase === "received") return "TYR received the request";
  if (phase === "waiting_approval") return "Waiting on TYR approval";
  if (phase === "returning") return "Bringing TYR's response back";
  if (phase === "completed") return "TYR's response delivered";
  if (phase === "failed") return "Communication with TYR failed";
  if (phase === "cancelled") return "Request to TYR was cancelled";
  if (actionKind === "searching") return "TYR is searching";
  if (actionKind === "editing_files") return "TYR is editing files";
  if (actionKind === "running_checks") return "TYR is running checks";
  if (actionKind === "using_tool") return "TYR is using a tool";
  return "TYR is thinking";
}

function journeyIsVisible(result: JourneyPhaseResult, nowMs: number): boolean {
  const phaseAt = Date.parse(result.phaseAt);
  if (!Number.isFinite(phaseAt)) return false;
  const ageMs = Math.max(0, nowMs - phaseAt);
  return result.continuous
    ? ACTIVE_PHASES.has(result.phase) && ageMs <= TOPOLOGY_ACTIVE_EXECUTION_WINDOW_MS
    : ageMs <= TOPOLOGY_TERMINAL_FLOW_WINDOW_MS;
}

function latestMessage(messages: readonly CrossWorkspaceMessageRecord[]): CrossWorkspaceMessageRecord | undefined {
  return [...messages].sort((left, right) => (
    (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt)
    || left.id.localeCompare(right.id)
  ))[0];
}

function latestEventOfKind(
  events: readonly RuntimeExecutionEventRecord[],
  kind: RuntimeExecutionEventRecord["kind"]
): RuntimeExecutionEventRecord | undefined {
  return [...events].reverse().find((event) => event.kind === kind);
}

function latestTimestamp(values: string[]): string {
  return [...values].sort().at(-1) ?? values[0] ?? new Date(0).toISOString();
}
