export type WorkspaceSpatialBridgeTransitPoint = [number, number, number];

export type WorkspaceSpatialBridgeTransitRoute = {
  points: WorkspaceSpatialBridgeTransitPoint[];
  sourceGatewayIndex: number;
  targetGatewayIndex: number;
};

export type WorkspaceSpatialBridgeTransitPhase =
  | "waiting"
  | "source_river"
  | "bridge"
  | "target_river"
  | "complete";

export type WorkspaceSpatialBridgeTransitTone = "request" | "response" | "error";

export const WORKSPACE_SPATIAL_BRIDGE_RIVER_TRAVEL_SECONDS = 2.2;
export const WORKSPACE_SPATIAL_BRIDGE_RIVER_PHASE_SECONDS = 2.5;
export const WORKSPACE_SPATIAL_BRIDGE_EFFECT_PHASE_SECONDS = 2.5;
export const WORKSPACE_SPATIAL_BRIDGE_WORKER_HANDOFF_SECONDS = 2.4;
export const WORKSPACE_SPATIAL_BRIDGE_WORKER_RIVER_SECONDS = 3.2;

export function workspaceSpatialBridgeTransitDurationSeconds(
  tone: WorkspaceSpatialBridgeTransitTone
): number {
  return (tone === "request" ? 0 : WORKSPACE_SPATIAL_BRIDGE_WORKER_HANDOFF_SECONDS)
    + WORKSPACE_SPATIAL_BRIDGE_RIVER_PHASE_SECONDS * 2
    + WORKSPACE_SPATIAL_BRIDGE_EFFECT_PHASE_SECONDS;
}

export function workspaceSpatialBridgeWorkerDelaySeconds(
  tone: WorkspaceSpatialBridgeTransitTone,
  bridgeCreatedAt: string | undefined,
  workerCreatedAt: string
): number {
  if (tone !== "request") return 0;
  const bridgeStartedAtMs = bridgeCreatedAt ? Date.parse(bridgeCreatedAt) : Number.NaN;
  const workerStartedAtMs = Date.parse(workerCreatedAt);
  if (!Number.isFinite(bridgeStartedAtMs) || !Number.isFinite(workerStartedAtMs)) {
    return workspaceSpatialBridgeTransitDurationSeconds("request");
  }
  const elapsedBeforeWorkerSeconds = Math.max(0, (workerStartedAtMs - bridgeStartedAtMs) / 1_000);
  // worker Flow 若在跨 Workspace 动画之后才出现，立即交给 Agent；不能从 Flow 出现时再完整等待一遍。
  return Math.max(0, workspaceSpatialBridgeTransitDurationSeconds("request") - elapsedBeforeWorkerSeconds);
}

export function workspaceSpatialBridgeTransitPhaseAt(
  elapsedSeconds: number,
  tone: WorkspaceSpatialBridgeTransitTone
): WorkspaceSpatialBridgeTransitPhase {
  const workerHandoffEndsAt = tone === "request" ? 0 : WORKSPACE_SPATIAL_BRIDGE_WORKER_HANDOFF_SECONDS;
  const sourceRiverEndsAt = workerHandoffEndsAt + WORKSPACE_SPATIAL_BRIDGE_RIVER_PHASE_SECONDS;
  const bridgeEndsAt = sourceRiverEndsAt + WORKSPACE_SPATIAL_BRIDGE_EFFECT_PHASE_SECONDS;
  const targetRiverEndsAt = bridgeEndsAt + WORKSPACE_SPATIAL_BRIDGE_RIVER_PHASE_SECONDS;
  if (elapsedSeconds < workerHandoffEndsAt) return "waiting";
  if (elapsedSeconds < sourceRiverEndsAt) return "source_river";
  if (elapsedSeconds < bridgeEndsAt) return "bridge";
  if (elapsedSeconds < targetRiverEndsAt) return "target_river";
  return "complete";
}

export function workspaceSpatialBridgeTransitSegments(
  route: WorkspaceSpatialBridgeTransitRoute
): {
  sourceRiver: WorkspaceSpatialBridgeTransitPoint[];
  bridge: WorkspaceSpatialBridgeTransitPoint[];
  targetRiver: WorkspaceSpatialBridgeTransitPoint[];
} {
  return {
    sourceRiver: route.points.slice(0, route.sourceGatewayIndex + 1),
    bridge: route.points.slice(route.sourceGatewayIndex, route.targetGatewayIndex + 1),
    targetRiver: route.points.slice(route.targetGatewayIndex)
  };
}

type WorkspaceSpatialBridgeTransitEndpoint = {
  center: WorkspaceSpatialBridgeTransitPoint;
  radius: number;
  console: WorkspaceSpatialBridgeTransitPoint;
  gateway: WorkspaceSpatialBridgeTransitPoint;
};

function appendPoint(
  points: WorkspaceSpatialBridgeTransitPoint[],
  point: WorkspaceSpatialBridgeTransitPoint
): void {
  const previous = points.at(-1);
  if (previous && Math.hypot(
    previous[0] - point[0],
    previous[1] - point[1],
    previous[2] - point[2]
  ) < 0.02) return;
  points.push(point);
}

function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function consoleToGatewayPath(
  endpoint: WorkspaceSpatialBridgeTransitEndpoint
): WorkspaceSpatialBridgeTransitPoint[] {
  const [centerX, , centerZ] = endpoint.center;
  const consoleAngle = Math.atan2(endpoint.console[2] - centerZ, endpoint.console[0] - centerX);
  const gatewayAngle = Math.atan2(endpoint.gateway[2] - centerZ, endpoint.gateway[0] - centerX);
  // 通信河道贴近 Workspace 外圈绕开 Device Room，不能用穿过建筑的直线缩短路径。
  const laneRadius = Math.max(0.8, endpoint.radius - 0.58);
  const egress: WorkspaceSpatialBridgeTransitPoint = [
    centerX + Math.cos(consoleAngle) * laneRadius,
    0.16,
    centerZ + Math.sin(consoleAngle) * laneRadius
  ];
  const points: WorkspaceSpatialBridgeTransitPoint[] = [endpoint.console, egress];
  const delta = shortestAngleDelta(consoleAngle, gatewayAngle);
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.34));
  for (let index = 1; index <= steps; index += 1) {
    const angle = consoleAngle + delta * index / steps;
    appendPoint(points, [
      centerX + Math.cos(angle) * laneRadius,
      0.16,
      centerZ + Math.sin(angle) * laneRadius
    ]);
  }
  appendPoint(points, endpoint.gateway);
  return points;
}

export function workspaceSpatialBridgeTransitRoute(input: {
  source: WorkspaceSpatialBridgeTransitEndpoint;
  target: WorkspaceSpatialBridgeTransitEndpoint;
}): WorkspaceSpatialBridgeTransitRoute {
  const sourceLeg = consoleToGatewayPath(input.source);
  const targetLeg = consoleToGatewayPath(input.target);
  const points: WorkspaceSpatialBridgeTransitPoint[] = [];
  sourceLeg.forEach((point) => appendPoint(points, point));
  const sourceGatewayIndex = points.length - 1;
  appendPoint(points, input.target.gateway);
  const targetGatewayIndex = points.length - 1;
  // 接收端沿同一外圈河道进入 TYR 控制台；Bridge 光路与 Workspace 光河保持一条连续载荷。
  targetLeg.slice(0, -1).reverse().forEach((point) => appendPoint(points, point));
  return { points, sourceGatewayIndex, targetGatewayIndex };
}
