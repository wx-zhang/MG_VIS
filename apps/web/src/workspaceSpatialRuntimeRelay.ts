import type { TopologyLiveActivityKind } from "@tyr-ai/contracts";
import type { WorkspaceSpatialAgent, WorkspaceSpatialRoom } from "./workspaceSpatial";

export type WorkspaceSpatialRuntimeRelayStage =
  | "queued"
  | "thinking"
  | "tool"
  | "approval"
  | "success"
  | "error"
  | "cancelled";

export type WorkspaceSpatialRuntimeRelayStation =
  | "intake"
  | "workcell"
  | "tool"
  | "approval"
  | "receipt";

export type WorkspaceSpatialRuntimeRelay = {
  executionId: string;
  activityId: string;
  agentId: string;
  kind: TopologyLiveActivityKind;
  stage: WorkspaceSpatialRuntimeRelayStage;
  station: WorkspaceSpatialRuntimeRelayStation;
  color: string;
  continuous: boolean;
  terminal: boolean;
  createdAt: string;
  visibleAgent: boolean;
};

export const WORKSPACE_SPATIAL_RUNTIME_RELAY_TRANSFER_SECONDS = 0.92;
export const WORKSPACE_SPATIAL_RUNTIME_RELAY_TERMINAL_SECONDS = 1.45;

const ACTIVITY_PRIORITY: Record<TopologyLiveActivityKind, number> = {
  waiting_approval: 0,
  failed: 1,
  stalled: 1,
  tool_running: 2,
  thinking: 3,
  delivered: 4,
  queued: 5,
  completed: 6,
  cancelled: 7
};

const RELAY_SEMANTICS: Record<TopologyLiveActivityKind, {
  stage: WorkspaceSpatialRuntimeRelayStage;
  station: WorkspaceSpatialRuntimeRelayStation;
  color: string;
  terminal: boolean;
}> = {
  queued: { stage: "queued", station: "intake", color: "#6c9fd2", terminal: false },
  delivered: { stage: "queued", station: "intake", color: "#6c9fd2", terminal: false },
  thinking: { stage: "thinking", station: "workcell", color: "#3bace5", terminal: false },
  tool_running: { stage: "tool", station: "tool", color: "#8b7ee8", terminal: false },
  waiting_approval: { stage: "approval", station: "approval", color: "#efb44e", terminal: false },
  completed: { stage: "success", station: "receipt", color: "#42c694", terminal: true },
  failed: { stage: "error", station: "receipt", color: "#e16868", terminal: true },
  stalled: { stage: "error", station: "receipt", color: "#e16868", terminal: true },
  cancelled: { stage: "cancelled", station: "receipt", color: "#8b989f", terminal: true }
};

type RelayCandidate = {
  agent: WorkspaceSpatialAgent;
  visibleAgent: boolean;
};

export function workspaceSpatialRuntimeRelay(room: WorkspaceSpatialRoom): WorkspaceSpatialRuntimeRelay | null {
  // Device 离线时拒绝迟到 activity；Agent error 也只能保留明确的失败终态，不能继续演出旧工作。
  if (room.status === "offline") return null;
  const visibleAgentIds = new Set(room.visibleAgents.map((agent) => agent.id));
  const candidates = room.agents.flatMap((agent): RelayCandidate[] => {
    if (!agent.activity || agent.state === "offline") return [];
    if (agent.state === "error" && agent.activity.kind !== "failed" && agent.activity.kind !== "stalled") return [];
    return [{ agent, visibleAgent: visibleAgentIds.has(agent.id) }];
  }).sort((left, right) => {
    const leftActivity = left.agent.activity!;
    const rightActivity = right.agent.activity!;
    return ACTIVITY_PRIORITY[leftActivity.kind] - ACTIVITY_PRIORITY[rightActivity.kind]
      || rightActivity.updatedAt.localeCompare(leftActivity.updatedAt)
      || left.agent.id.localeCompare(right.agent.id);
  });
  const primary = candidates[0];
  const activity = primary?.agent.activity;
  if (!primary || !activity) return null;
  const semantics = RELAY_SEMANTICS[activity.kind];
  return {
    executionId: activity.executionId,
    activityId: activity.id,
    agentId: primary.agent.id,
    kind: activity.kind,
    ...semantics,
    continuous: activity.continuous,
    createdAt: activity.createdAt,
    visibleAgent: primary.visibleAgent
  };
}

export function workspaceSpatialRuntimeRelayCanHandoff(
  previous: WorkspaceSpatialRuntimeRelay | null,
  next: WorkspaceSpatialRuntimeRelay | null
): boolean {
  // 只有同一 execution 的权威阶段变化可以连续交接；新工作必须直接落到自己的当前 station。
  return Boolean(
    previous
    && next
    && previous.executionId === next.executionId
    && previous.activityId !== next.activityId
  );
}

export type WorkspaceSpatialRuntimeRelayFrame = {
  progress: number;
  easedProgress: number;
  trailStrength: number;
  terminalPulse: number;
  settled: boolean;
};

export function workspaceSpatialRuntimeRelayFrame(
  elapsedSeconds: number,
  terminal: boolean,
  reducedMotion = false
): WorkspaceSpatialRuntimeRelayFrame {
  if (reducedMotion) {
    return { progress: 1, easedProgress: 1, trailStrength: 0, terminalPulse: 0, settled: true };
  }
  const elapsed = Math.max(0, elapsedSeconds);
  const progress = Math.min(1, elapsed / WORKSPACE_SPATIAL_RUNTIME_RELAY_TRANSFER_SECONDS);
  const easedProgress = 1 - Math.pow(1 - progress, 3);
  const trailStrength = progress < 1 ? Math.sin(progress * Math.PI) : 0;
  const terminalProgress = Math.min(1, elapsed / WORKSPACE_SPATIAL_RUNTIME_RELAY_TERMINAL_SECONDS);
  const terminalPulse = terminal && terminalProgress < 1 ? Math.sin(terminalProgress * Math.PI) : 0;
  return {
    progress,
    easedProgress,
    trailStrength,
    terminalPulse,
    settled: progress >= 1 && (!terminal || terminalProgress >= 1)
  };
}
