import type {
  WorkspaceSpatialAgent,
  WorkspaceSpatialFlowSignal,
  WorkspaceSpatialRoom
} from "./workspaceSpatial";
import type { WorkspaceSpatialPoint } from "./workspaceSpatialLocomotion";

export const WORKSPACE_SPATIAL_PAIR_HANDOFF_EXCHANGE_START_MS = 4_400;
export const WORKSPACE_SPATIAL_PAIR_HANDOFF_EXCHANGE_END_MS = 5_800;
export const WORKSPACE_SPATIAL_PAIR_HANDOFF_SOURCE_RETURN_MS = 6_400;
export const WORKSPACE_SPATIAL_PAIR_HANDOFF_TARGET_RETURN_MS = 7_400;
export const WORKSPACE_SPATIAL_PAIR_HANDOFF_DURATION_MS = 12_400;

export type WorkspaceSpatialPairHandoffRole = "source" | "target";
export type WorkspaceSpatialPairHandoffPhase = "approach" | "exchange" | "source_return" | "returning";

export type WorkspaceSpatialPairHandoff = {
  flowId: string;
  executionId: string;
  sourceAgentId: string;
  targetAgentId: string;
  startedAtMs: number;
  sourceReturnAtMs: number;
  targetReturnAtMs: number;
  endsAtMs: number;
};

function agentCanJoinPairHandoff(agent: WorkspaceSpatialAgent): boolean {
  if (agent.state === "offline" || agent.state === "error") return false;
  // Tool Station、Human Gate 与 terminal 回执都是更高优先级的真实空间语义，不能被协作交接覆盖。
  return !agent.activity || agent.activity.kind === "queued"
    || agent.activity.kind === "delivered"
    || agent.activity.kind === "thinking";
}

export function workspaceSpatialPairHandoff(
  room: WorkspaceSpatialRoom,
  flows: WorkspaceSpatialFlowSignal[],
  nowMs: number
): WorkspaceSpatialPairHandoff | null {
  if (room.status !== "online") return null;
  const visibleAgentById = new Map(room.visibleAgents.map((agent) => [agent.id, agent]));
  const candidates = flows.flatMap((flow) => {
    if (flow.tone !== "request" || !flow.continuous || flow.sourceAgentId === flow.targetAgentId) return [];
    const source = flow.sourceAgentId ? visibleAgentById.get(flow.sourceAgentId) : undefined;
    const target = visibleAgentById.get(flow.targetAgentId);
    if (!source || !target || !agentCanJoinPairHandoff(source) || !agentCanJoinPairHandoff(target)) return [];
    const startedAtMs = Date.parse(flow.createdAt);
    const ageMs = nowMs - startedAtMs;
    // 时间线锚定服务端 createdAt；旧 Flow、未来时间和刷新后的 pending Flow 都不会重新播放。
    if (!Number.isFinite(startedAtMs) || ageMs < 0 || ageMs >= WORKSPACE_SPATIAL_PAIR_HANDOFF_DURATION_MS) return [];
    return [{ flow, startedAtMs }];
  });
  const selected = candidates.sort((left, right) => (
    right.startedAtMs - left.startedAtMs || left.flow.id.localeCompare(right.flow.id)
  ))[0];
  if (!selected?.flow.sourceAgentId) return null;
  return {
    flowId: selected.flow.id,
    executionId: selected.flow.executionId,
    sourceAgentId: selected.flow.sourceAgentId,
    targetAgentId: selected.flow.targetAgentId,
    startedAtMs: selected.startedAtMs,
    sourceReturnAtMs: selected.startedAtMs + WORKSPACE_SPATIAL_PAIR_HANDOFF_SOURCE_RETURN_MS,
    targetReturnAtMs: selected.startedAtMs + WORKSPACE_SPATIAL_PAIR_HANDOFF_TARGET_RETURN_MS,
    endsAtMs: selected.startedAtMs + WORKSPACE_SPATIAL_PAIR_HANDOFF_DURATION_MS
  };
}

export function workspaceSpatialPairHandoffPhase(
  handoff: WorkspaceSpatialPairHandoff,
  nowMs: number
): WorkspaceSpatialPairHandoffPhase | null {
  const elapsedMs = nowMs - handoff.startedAtMs;
  if (elapsedMs < 0 || nowMs >= handoff.endsAtMs) return null;
  if (elapsedMs < WORKSPACE_SPATIAL_PAIR_HANDOFF_EXCHANGE_START_MS) return "approach";
  if (elapsedMs < WORKSPACE_SPATIAL_PAIR_HANDOFF_EXCHANGE_END_MS) return "exchange";
  if (nowMs < handoff.sourceReturnAtMs) return "source_return";
  return "returning";
}

export function workspaceSpatialPairHandoffDock(
  role: WorkspaceSpatialPairHandoffRole,
  roomWidth: number,
  roomDepth: number
): WorkspaceSpatialPoint {
  // Handoff Bay 固定在中央短通道：左侧 Human Gate、右侧 gateway 与后墙 WorkDesk 都保留独立空间。
  const halfGap = Math.min(0.56, Math.max(0.46, roomWidth * 0.085));
  return {
    x: role === "source" ? -halfGap : halfGap,
    // 默认等距视角会被前墙遮住贴边 station；固定收回中央短通道，让人物全身与 baton 同时可读。
    z: Math.min(0.62, roomDepth / 2 - 1.5)
  };
}

export function workspaceSpatialPairHandoffRoleForAgent(
  handoff: WorkspaceSpatialPairHandoff | null,
  agentId: string
): WorkspaceSpatialPairHandoffRole | null {
  if (!handoff) return null;
  if (handoff.sourceAgentId === agentId) return "source";
  if (handoff.targetAgentId === agentId) return "target";
  return null;
}
