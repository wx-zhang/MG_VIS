import type { WorkspaceSpatialAgent } from "./workspaceSpatial";
import {
  resolveLivingTopologyNodeState,
  type LivingTopologyNodeState
} from "./livingTopologyNodeState";

export type WorkspaceSpatialMotionMode =
  | "offline"
  | "idle"
  | "queued"
  | "thinking"
  | "tool"
  | "approval"
  | "success"
  | "error"
  | "cancelled"
  | "communicating";

export type WorkspaceSpatialMotionMarker =
  | "none"
  | "waiting"
  | "thinking"
  | "tool"
  | "approval"
  | "success"
  | "error";

export type WorkspaceSpatialTerminalMotion = "success" | "error" | "cancelled";

export type WorkspaceSpatialAgentMotion = {
  mode: WorkspaceSpatialMotionMode;
  seated: boolean;
  marker: WorkspaceSpatialMotionMarker;
  continuous: boolean;
  terminal: WorkspaceSpatialTerminalMotion | null;
  activityId?: string;
  activityStartedAt?: string;
};

export function workspaceSpatialAgentNodeState(agent: WorkspaceSpatialAgent): LivingTopologyNodeState {
  return resolveLivingTopologyNodeState({
    kind: agent.controller ? "tyr" : "agent",
    resourceStatus: agent.state,
    activity: agent.activity,
    progress: agent.communicationProgress
  });
}

export function workspaceSpatialAgentMotion(agent: WorkspaceSpatialAgent): WorkspaceSpatialAgentMotion {
  const visual = workspaceSpatialAgentNodeState(agent);
  const mode: WorkspaceSpatialMotionMode = visual.phase === "offline"
    ? "offline"
    : visual.phase === "waiting"
      ? "queued"
      : visual.phase === "receiving" || visual.phase === "sending"
        ? "communicating"
        : visual.phase;
  const marker: WorkspaceSpatialMotionMarker = visual.phase === "waiting"
    ? "waiting"
    : visual.phase === "thinking" || visual.phase === "tool" || visual.phase === "approval" || visual.phase === "success" || visual.phase === "error"
      ? visual.phase
      : "none";
  const terminal: WorkspaceSpatialTerminalMotion | null = visual.terminal && (visual.phase === "success" || visual.phase === "error" || visual.phase === "cancelled")
    ? visual.phase
    : null;
  return {
    mode,
    // runtime 中断后 resource status 可能暂留 working；保留座位语义，但不能因此让 WebGL 永久跑帧。
    seated: visual.phase === "thinking" || visual.phase === "tool" || visual.phase === "idle" && agent.state === "working",
    marker,
    continuous: visual.continuous,
    terminal,
    ...(visual.source === "activity" ? {
      activityId: visual.primarySignalId,
      activityStartedAt: visual.startedAt
    } : {})
  };
}

export function workspaceSpatialTerminalDurationMs(terminal: WorkspaceSpatialTerminalMotion | null): number {
  if (terminal === "success") return 1_250;
  if (terminal === "error") return 1_050;
  return 0;
}
