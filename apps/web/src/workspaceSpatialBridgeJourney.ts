import type { TopologyBridgeJourneyPhase, TopologyBridgeJourneyRecord } from "@tyr-ai/contracts";
import type { WorkspaceSpatialBridgeTransitPoint } from "./workspaceSpatialBridgeTransit";

// Live Work 快照仍共用服务端的 30 秒终态展示窗口，人物回程由独立状态机收尾。
export const WORKSPACE_SPATIAL_BRIDGE_JOURNEY_TERMINAL_MS = 30_000;
export const WORKSPACE_SPATIAL_BRIDGE_JOURNEY_PEER_STANDOFF = 0.72;

export type WorkspaceSpatialBridgeCourierStage = "outbound" | "handoff" | "returning";
export type WorkspaceSpatialBridgeJourneyRouteSegment = "source_river" | "bridge" | "target_river";

export function workspaceSpatialBridgeJourneyRoutePoints(
  routePoints: readonly WorkspaceSpatialBridgeTransitPoint[]
): WorkspaceSpatialBridgeTransitPoint[] {
  const points = routePoints.map((point): WorkspaceSpatialBridgeTransitPoint => [...point]);
  const target = points.at(-1);
  const approach = points.at(-2);
  if (!target || !approach) return points;
  const deltaX = target[0] - approach[0];
  const deltaZ = target[2] - approach[2];
  const distance = Math.hypot(deltaX, deltaZ);
  if (distance <= 0.001) return points;
  // 终点落在对端 TYR 旁边，避免两个角色占用完全相同的坐标。
  points[points.length - 1] = [
    target[0] - deltaZ / distance * WORKSPACE_SPATIAL_BRIDGE_JOURNEY_PEER_STANDOFF,
    target[1],
    target[2] + deltaX / distance * WORKSPACE_SPATIAL_BRIDGE_JOURNEY_PEER_STANDOFF
  ];
  return points;
}

export function workspaceSpatialBridgeJourneyRouteSegment(input: {
  progress: number;
  sourceGatewayProgress: number;
  targetGatewayProgress: number;
  courierStage: WorkspaceSpatialBridgeCourierStage;
}): WorkspaceSpatialBridgeJourneyRouteSegment | null {
  const progress = clampProgress(input.progress);
  const sourceGatewayProgress = clampProgress(input.sourceGatewayProgress);
  const targetGatewayProgress = clampProgress(input.targetGatewayProgress);
  // 去程和返程共用人物进度；只在所在路段点亮对应河道或 Bridge。
  if (input.courierStage === "handoff") return "target_river";
  if (progress <= sourceGatewayProgress) return "source_river";
  if (progress <= targetGatewayProgress) return "bridge";
  return "target_river";
}

export function workspaceSpatialBridgeJourneyConsoleLabel(
  journey: Pick<TopologyBridgeJourneyRecord, "phase" | "actionKind">
): string {
  if (journey.phase === "waiting_approval") return "TYR · WAITING APPROVAL";
  if (journey.phase === "received") return "TYR · REQUEST RECEIVED";
  if (journey.phase === "returning") return "TYR · SENDING RESPONSE";
  if (journey.phase === "completed") return "TYR · RESPONSE SENT";
  if (journey.phase === "failed") return "TYR · FAILED";
  if (journey.phase === "cancelled") return "TYR · CANCELLED";
  if (journey.actionKind === "searching") return "TYR · SEARCHING";
  if (journey.actionKind === "editing_files") return "TYR · EDITING";
  if (journey.actionKind === "running_checks") return "TYR · RUNNING CHECKS";
  if (journey.actionKind === "using_tool") return "TYR · USING TOOL";
  return "TYR · THINKING";
}

export function workspaceSpatialBridgeJourneyIsTerminal(phase: TopologyBridgeJourneyPhase): boolean {
  return phase === "completed" || phase === "failed" || phase === "cancelled";
}

export function workspaceSpatialBridgeJourneyHasActiveConsoleStatus(
  phase: TopologyBridgeJourneyPhase
): boolean {
  // 完成结果属于短暂历史提示，不能继续把目标 TYR 标记为工作中。
  return !workspaceSpatialBridgeJourneyIsTerminal(phase);
}

export function workspaceSpatialBridgeJourneyTone(
  phase: TopologyBridgeJourneyPhase
): "request" | "response" | "error" {
  if (phase === "failed" || phase === "cancelled") return "error";
  if (phase === "returning" || phase === "completed") return "response";
  return "request";
}

function clampProgress(progress: number): number {
  return Math.min(1, Math.max(0, progress));
}
