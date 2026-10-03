import type { WorkspaceSpatialAgentMotion } from "./workspaceSpatialMotion";

export type WorkspaceSpatialPoint = {
  x: number;
  z: number;
};

export type WorkspaceSpatialRoomWaypoints = {
  seat: WorkspaceSpatialPoint;
  toolConsole: WorkspaceSpatialPoint;
  approvalGate: WorkspaceSpatialPoint;
  roomGateway: WorkspaceSpatialPoint;
  utilityPoint: WorkspaceSpatialPoint;
  refreshPoint: WorkspaceSpatialPoint;
  aisleZ: number;
};

export type WorkspaceSpatialLocomotionTarget = {
  station: "seat" | "tool_console" | "approval_gate";
  point: WorkspaceSpatialPoint;
};

export type WorkspaceSpatialLocomotionStation = WorkspaceSpatialLocomotionTarget["station"]
  | "utility_point"
  | "refresh_point"
  | "handoff_source"
  | "handoff_target";

export const WORKSPACE_SPATIAL_TOOL_STATION_DELAY_MS = 4_000;
export const WORKSPACE_SPATIAL_STAND_TRANSITION_MS = 360;
export const WORKSPACE_SPATIAL_ARRIVAL_SETTLE_MS = 320;
export const WORKSPACE_SPATIAL_TURN_ALIGNMENT_RADIANS = Math.PI / 9;

const WORKSPACE_SPATIAL_WALK_SPEED = 1.28;
const WORKSPACE_SPATIAL_ARRIVAL_SPEED = 0.2;
const WORKSPACE_SPATIAL_ARRIVAL_DISTANCE = 0.52;

type RoomWaypointInput = {
  seat: WorkspaceSpatialPoint;
  agentIndex: number;
  roomWidth: number;
  roomDepth: number;
};

const POINT_EPSILON = 0.01;

function samePoint(left: WorkspaceSpatialPoint, right: WorkspaceSpatialPoint): boolean {
  return Math.abs(left.x - right.x) <= POINT_EPSILON && Math.abs(left.z - right.z) <= POINT_EPSILON;
}

export function workspaceSpatialRoomWaypoints({
  seat,
  agentIndex,
  roomWidth,
  roomDepth
}: RoomWaypointInput): WorkspaceSpatialRoomWaypoints {
  const approvalGate = {
    // Human Gate 旁保留两列等待位，多个 approval 不会叠在同一点。
    x: -roomWidth / 2 + 1.3 + agentIndex % 2 * 0.34,
    z: roomDepth / 2 - 0.8 - Math.floor(agentIndex / 2) * 0.34
  };
  return {
    seat: { ...seat },
    // 右后方 WorkDesk 是共享 Tool Station；两列等待位避免同一 console 的轻微视觉重叠。
    toolConsole: {
      x: roomWidth / 2 - 1.45 + (agentIndex % 2 === 0 ? -0.24 : 0.24),
      z: -roomDepth / 2 + 1.58
    },
    approvalGate,
    roomGateway: { x: roomWidth / 2 - 0.42, z: roomDepth / 2 - 0.52 },
    // ROOM OPS 固定在后墙中央，人物停在面板前的短通道，不与两侧 WorkDesk 重叠。
    utilityPoint: { x: 0, z: -roomDepth / 2 + 1.18 },
    // Refresh Point 位于左侧墙内缘，和后墙 WorkDesk、前侧 Human Gate 保持独立站位。
    refreshPoint: { x: -roomWidth / 2 + 0.88, z: -0.1 },
    aisleZ: roomDepth / 2 - 1.05
  };
}

export function workspaceSpatialLocomotionTarget(
  motion: WorkspaceSpatialAgentMotion,
  waypoints: WorkspaceSpatialRoomWaypoints,
  nowMs: number,
  allowToolStation = true
): WorkspaceSpatialLocomotionTarget {
  // approval 永远覆盖正在前往或使用 Tool Station 的路线。
  if (motion.mode === "approval") {
    return { station: "approval_gate", point: waypoints.approvalGate };
  }
  if (motion.mode === "tool" && allowToolStation) {
    const startedAtMs = Date.parse(motion.activityStartedAt ?? "");
    if (Number.isFinite(startedAtMs) && nowMs - startedAtMs >= WORKSPACE_SPATIAL_TOOL_STATION_DELAY_MS) {
      return { station: "tool_console", point: waypoints.toolConsole };
    }
  }
  return { station: "seat", point: waypoints.seat };
}

export function workspaceSpatialWaypointRoute(
  start: WorkspaceSpatialPoint,
  destination: WorkspaceSpatialPoint,
  aisleZ: number
): WorkspaceSpatialPoint[] {
  if (samePoint(start, destination)) return [{ ...destination }];

  // 房间内只走“接入通道 -> 横向通道 -> station”的有限折线路径，不做自由寻路。
  const candidates = [
    { ...start },
    { x: start.x, z: aisleZ },
    { x: destination.x, z: aisleZ },
    { ...destination }
  ];
  return candidates.filter((point, index, points) => index === 0 || !samePoint(point, points[index - 1]));
}

export function workspaceSpatialLocomotionSpeed(distance: number, finalLeg: boolean): number {
  if (!finalLeg) return WORKSPACE_SPATIAL_WALK_SPEED;
  // 只在 station 前的末段减速；通道和转角维持稳定速度，避免每个 waypoint 都产生停顿感。
  const arrivalProgress = Math.min(1, Math.max(0, distance) / WORKSPACE_SPATIAL_ARRIVAL_DISTANCE);
  const easedProgress = arrivalProgress * arrivalProgress * (3 - 2 * arrivalProgress);
  return WORKSPACE_SPATIAL_ARRIVAL_SPEED
    + (WORKSPACE_SPATIAL_WALK_SPEED - WORKSPACE_SPATIAL_ARRIVAL_SPEED) * easedProgress;
}

export function workspaceSpatialHeadingDelta(currentYaw: number, targetYaw: number): number {
  return Math.atan2(Math.sin(targetYaw - currentYaw), Math.cos(targetYaw - currentYaw));
}

export function workspaceSpatialStationYaw(station: WorkspaceSpatialLocomotionStation): number {
  if (station === "handoff_source") return Math.PI / 2;
  if (station === "handoff_target") return -Math.PI / 2;
  if (station === "seat") return 0;
  // Seat 面向房间；Refresh Point 与 Human Gate 位于左侧，Tool/Utility Station 才朝后墙完成交接。
  return station === "approval_gate" || station === "refresh_point" ? -Math.PI / 2 : Math.PI;
}
