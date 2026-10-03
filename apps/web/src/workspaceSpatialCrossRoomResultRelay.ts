import type { WorkspaceSpatialRoom, WorkspaceSpatialWorkspace } from "./workspaceSpatial";
import {
  WORKSPACE_SPATIAL_RESULT_CONVERGENCE_RELAY_END_MS,
  workspaceSpatialResultConvergence,
  workspaceSpatialResultRequesterCanReceive,
  type WorkspaceSpatialResultConvergence
} from "./workspaceSpatialResultConvergence";

export const WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_START_MS = WORKSPACE_SPATIAL_RESULT_CONVERGENCE_RELAY_END_MS;
export const WORKSPACE_SPATIAL_CROSS_ROOM_RECEIPT_REACH_MS = 9_400;
export const WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_ARRIVAL_MS = 11_200;
export const WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_DURATION_MS = 13_200;

export type WorkspaceSpatialCrossRoomResultRelayPhase = "waiting" | "relaying" | "settling";

export type WorkspaceSpatialCrossRoomResultRelay = {
  id: string;
  convergence: WorkspaceSpatialResultConvergence;
  sourceRoomId: string;
  targetRoomId: string;
  requesterAgentId: string;
  startedAtMs: number;
  endsAtMs: number;
};

function roomWithVisibleRequester(
  rooms: WorkspaceSpatialRoom[],
  sourceRoomId: string,
  requesterAgentId: string
): WorkspaceSpatialRoom | null {
  const targetRoom = rooms.find((room) => (
    room.id !== sourceRoomId && room.agents.some((agent) => agent.id === requesterAgentId)
  ));
  if (!targetRoom || targetRoom.status !== "online") return null;
  const requester = targetRoom.visibleAgents.find((agent) => agent.id === requesterAgentId);
  // requester 已属于另一房间却未被渲染时，不能把结果册送到空座位或伪造跨房间目的地。
  return requester && workspaceSpatialResultRequesterCanReceive(requester) ? targetRoom : null;
}

export function workspaceSpatialCrossRoomResultRelay(
  workspace: WorkspaceSpatialWorkspace,
  nowMs: number
): WorkspaceSpatialCrossRoomResultRelay | null {
  // 跨房间结果必须经过当前 Workspace 的真实 TYR relay；没有 controller 时宁可不画，也不能瞬移。
  const controllerAvailable = workspace.controllers.some((controller) => (
    controller.state !== "offline" && controller.state !== "error"
  ));
  if (!workspace.current || !controllerAvailable || workspace.rooms.length < 2) return null;
  const candidates = workspace.rooms.flatMap((sourceRoom): WorkspaceSpatialCrossRoomResultRelay[] => {
    const convergence = workspaceSpatialResultConvergence(
      sourceRoom,
      workspace.flows,
      nowMs,
      WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_DURATION_MS
    );
    if (!convergence || convergence.deliveryKind !== "gateway") return [];
    const targetRoom = roomWithVisibleRequester(workspace.rooms, sourceRoom.id, convergence.targetAgentId);
    if (!targetRoom) return [];
    return [{
      id: `cross-room-result:${convergence.id}:${sourceRoom.id}:${targetRoom.id}`,
      convergence,
      sourceRoomId: sourceRoom.id,
      targetRoomId: targetRoom.id,
      requesterAgentId: convergence.targetAgentId,
      startedAtMs: convergence.startedAtMs,
      endsAtMs: convergence.startedAtMs + WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_DURATION_MS
    }];
  });
  return candidates.sort((left, right) => (
    right.startedAtMs - left.startedAtMs || left.id.localeCompare(right.id)
  ))[0] ?? null;
}

export function workspaceSpatialCrossRoomResultRelayPhase(
  relay: WorkspaceSpatialCrossRoomResultRelay,
  nowMs: number
): WorkspaceSpatialCrossRoomResultRelayPhase | null {
  const elapsedMs = nowMs - relay.startedAtMs;
  if (elapsedMs < 0 || nowMs >= relay.endsAtMs) return null;
  if (elapsedMs < WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_START_MS) return "waiting";
  if (elapsedMs < WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_ARRIVAL_MS) return "relaying";
  return "settling";
}
