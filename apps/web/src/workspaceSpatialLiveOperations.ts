import type {
  TopologyBridgeJourneyPhase,
  TopologyLiveActivityKind,
  TopologyLiveWorkPayload
} from "@tyr-ai/contracts";
import {
  primaryTopologyLiveActivity,
  topologyLiveActivityLabelForWorkspace,
  topologyLiveActivityTone,
  type LivingTopologyActivityTone
} from "./livingTopologyActivity";
import {
  topologyLiveExecutionLabel,
  topologyLiveExecutionTone
} from "./topologyLiveWork";
import { workspaceSpatialBridgeJourneyTone } from "./workspaceSpatialBridgeJourney";
import type {
  WorkspaceSpatialAgent,
  WorkspaceSpatialScene,
  WorkspaceSpatialWorkspace
} from "./workspaceSpatial";

export const MAX_VISIBLE_LIVE_OPERATIONS = 2;
export const WORKSPACE_SPATIAL_RECENT_OPERATION_MS = 4_000;

export type WorkspaceSpatialLiveOperationTone = LivingTopologyActivityTone | "request" | "response";

export type WorkspaceSpatialLiveOperationTarget =
  | { kind: "execution"; executionId: string }
  | { kind: "bridge"; bridgeId: string }
  | { kind: "agent"; workspaceId: string; agentId: string };

export type WorkspaceSpatialLiveOperation = {
  id: string;
  label: string;
  actorLabel: string;
  scopeLabel: string;
  tone: WorkspaceSpatialLiveOperationTone;
  continuous: boolean;
  updatedAt: string;
  target: WorkspaceSpatialLiveOperationTarget;
};

export type WorkspaceSpatialLiveOperations = {
  items: WorkspaceSpatialLiveOperation[];
  totalCount: number;
  liveCount: number;
  recentCount: number;
  hiddenCount: number;
  truncated: boolean;
  nextRecentExpiryAt: number | null;
};

type AgentLocation = {
  agent: WorkspaceSpatialAgent;
  workspaceName: string;
  stationName: string;
};

const ACTIVITY_PRIORITY: Record<TopologyLiveActivityKind, number> = {
  failed: 0,
  stalled: 0,
  waiting_approval: 1,
  tool_running: 2,
  thinking: 3,
  delivered: 5,
  queued: 5,
  completed: 6,
  cancelled: 7
};

const EXECUTION_PRIORITY: Record<TopologyLiveWorkPayload["executions"][number]["status"], number> = {
  waiting_approval: 1,
  running: 3,
  delivered: 5,
  queued: 5
};

const BRIDGE_JOURNEY_PRIORITY: Record<TopologyBridgeJourneyPhase, number> = {
  failed: 0,
  waiting_approval: 1,
  running: 2,
  returning: 3,
  dispatching: 4,
  received: 4,
  completed: 5,
  cancelled: 7
};

function locationKey(workspaceId: string, agentId: string): string {
  return `${workspaceId}:${agentId}`;
}

function indexWorkspaceAgents(index: Map<string, AgentLocation>, workspace: WorkspaceSpatialWorkspace): void {
  for (const agent of workspace.controllers) {
    index.set(locationKey(workspace.id, agent.id), {
      agent,
      workspaceName: workspace.name,
      stationName: "TYR"
    });
  }
  for (const room of workspace.rooms) {
    for (const agent of room.agents) {
      index.set(locationKey(workspace.id, agent.id), {
        agent,
        workspaceName: workspace.name,
        stationName: room.name
      });
    }
  }
}

function agentCanPresentActivity(location: AgentLocation, kind: TopologyLiveActivityKind): boolean {
  // Device / Agent resource state remains authoritative: late work cannot reappear in the global status rail.
  if (location.agent.state === "offline") return false;
  if (location.agent.state === "error") return kind === "failed" || kind === "stalled";
  return true;
}

function runtimeScopeLabel(location: AgentLocation): string {
  return `${location.workspaceName} · ${location.stationName}`;
}

export function workspaceSpatialLiveOperations(
  scene: WorkspaceSpatialScene,
  liveWork: TopologyLiveWorkPayload,
  nowMs = Date.now()
): WorkspaceSpatialLiveOperations {
  const locations = new Map<string, AgentLocation>();
  indexWorkspaceAgents(locations, scene.current);
  scene.peers.forEach((workspace) => indexWorkspaceAgents(locations, workspace));

  const activitiesByExecutionId = new Map<string, typeof liveWork.activities>();
  for (const activity of liveWork.activities) {
    const current = activitiesByExecutionId.get(activity.executionId) ?? [];
    current.push(activity);
    activitiesByExecutionId.set(activity.executionId, current);
  }
  const bridgeJourneys = liveWork.bridgeJourneys ?? [];
  const bridgeJourneyExecutionIds = new Set(
    bridgeJourneys.flatMap((journey) => journey.executionId ? [journey.executionId] : [])
  );

  const rankedOperations: Array<{ operation: WorkspaceSpatialLiveOperation; priority: number }> = [];
  for (const journey of bridgeJourneys) {
    const source = locations.get(locationKey(journey.sourceWorkspaceId, journey.sourceAgentId));
    const sourceWorkspaceName = source?.workspaceName
      ?? (journey.sourceWorkspaceId === scene.current.id
        ? scene.current.name
        : scene.peers.find((workspace) => workspace.id === journey.sourceWorkspaceId)?.name)
      ?? "Workspace";
    const targetWorkspaceName = journey.targetWorkspaceId === scene.current.id
      ? scene.current.name
      : scene.peers.find((workspace) => workspace.id === journey.targetWorkspaceId)?.name ?? "peer Workspace";
    rankedOperations.push({
      priority: BRIDGE_JOURNEY_PRIORITY[journey.phase],
      operation: {
        id: `bridge-journey:${journey.id}`,
        label: journey.label,
        actorLabel: "TYR",
        scopeLabel: `${sourceWorkspaceName} → ${targetWorkspaceName}`,
        tone: workspaceSpatialBridgeJourneyTone(journey.phase),
        continuous: journey.continuous,
        updatedAt: journey.updatedAt,
        target: { kind: "bridge", bridgeId: journey.bridgeId }
      }
    });
  }
  for (const controller of scene.current.controllers) {
    const progress = controller.communicationProgress;
    if (!progress || controller.state === "offline" || controller.state === "error") continue;
    rankedOperations.push({
      priority: progress.phase === "running_action" ? 2 : progress.phase === "preparing_response" ? 3 : 4,
      operation: {
        id: `communication-progress:${progress.operationId}`,
        label: progress.label,
        actorLabel: controller.displayName,
        scopeLabel: `${scene.current.name} · TYR`,
        tone: progress.phase === "running_action"
          ? "request"
          : progress.phase === "preparing_response"
            ? "response"
            : "running",
        continuous: true,
        updatedAt: progress.updatedAt,
        target: { kind: "agent", workspaceId: scene.current.id, agentId: controller.id }
      }
    });
  }
  for (const [executionId, activities] of activitiesByExecutionId) {
    if (bridgeJourneyExecutionIds.has(executionId)) continue;
    const activity = primaryTopologyLiveActivity(activities);
    if (!activity) continue;
    const location = locations.get(locationKey(activity.workspaceId, activity.agentId));
    if (!location || !agentCanPresentActivity(location, activity.kind)) continue;
    const peerWorkspace = activity.workspaceId !== scene.current.id;
    rankedOperations.push({
      priority: ACTIVITY_PRIORITY[activity.kind],
      operation: {
        id: `activity:${activity.id}`,
        label: topologyLiveActivityLabelForWorkspace(activity.kind, peerWorkspace),
        actorLabel: location.agent.displayName,
        scopeLabel: runtimeScopeLabel(location),
        tone: topologyLiveActivityTone(activity.kind),
        continuous: activity.continuous,
        updatedAt: activity.updatedAt,
        target: { kind: "execution", executionId }
      }
    });
  }

  for (const execution of liveWork.executions) {
    if (bridgeJourneyExecutionIds.has(execution.id)) continue;
    if (activitiesByExecutionId.has(execution.id)) continue;
    const workspaceId = execution.workspaceId ?? scene.current.id;
    const location = locations.get(locationKey(workspaceId, execution.agentId));
    // Execution fallback supports rolling Web/server deployments, but never overrides an unavailable resource.
    if (!location || location.agent.state === "offline" || location.agent.state === "error") continue;
    // Fallback 没有 activity 时仍需保持同一审批权限语义，避免滚动发布期间把对端审批写成本地动作。
    rankedOperations.push({
      priority: EXECUTION_PRIORITY[execution.status],
      operation: {
        id: `execution:${execution.id}`,
        label: execution.status === "waiting_approval" && workspaceId !== scene.current.id
          ? "Waiting on peer approval"
          : topologyLiveExecutionLabel(execution.status),
        actorLabel: location.agent.displayName,
        scopeLabel: runtimeScopeLabel(location),
        tone: topologyLiveExecutionTone(execution.status),
        continuous: true,
        updatedAt: execution.updatedAt,
        target: { kind: "execution", executionId: execution.id }
      }
    });
  }

  for (const bridge of scene.bridges) {
    if ((bridge.journeys ?? []).length > 0) continue;
    const signal = bridge.signals[0];
    if (!signal) continue;
    rankedOperations.push({
      priority: signal.tone === "error" ? 0 : signal.tone === "request" ? 4 : 5,
      operation: {
        id: `bridge:${bridge.id}:${signal.id}`,
        label: signal.tone === "error" ? "Bridge failed" : signal.tone === "response" ? "Bridge return" : "Bridge request",
        actorLabel: "Workspace Bridge",
        scopeLabel: `${signal.direction === "outbound" ? "Outbound to" : "Inbound from"} ${bridge.peerWorkspaceName}`,
        tone: signal.tone,
        continuous: signal.continuous,
        updatedAt: signal.createdAt,
        target: { kind: "bridge", bridgeId: bridge.id }
      }
    });
  }

  rankedOperations.sort((left, right) => (
    left.priority - right.priority
    || right.operation.updatedAt.localeCompare(left.operation.updatedAt)
    || left.operation.id.localeCompare(right.operation.id)
  ));
  const operations = rankedOperations
    .map(({ operation }) => operation)
    .filter((operation) => {
      if (operation.continuous) return true;
      const updatedAtMs = Date.parse(operation.updatedAt);
      // 终态只作为短暂结果保留，不能继续冒充正在执行的 Live operation。
      return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs <= WORKSPACE_SPATIAL_RECENT_OPERATION_MS;
    });
  const items = operations.slice(0, MAX_VISIBLE_LIVE_OPERATIONS);
  const liveCount = operations.filter((operation) => operation.continuous).length;
  const recentExpiries = operations.flatMap((operation) => {
    if (operation.continuous) return [];
    const updatedAtMs = Date.parse(operation.updatedAt);
    return Number.isFinite(updatedAtMs) ? [updatedAtMs + WORKSPACE_SPATIAL_RECENT_OPERATION_MS] : [];
  });
  return {
    items,
    totalCount: operations.length,
    liveCount,
    recentCount: operations.length - liveCount,
    hiddenCount: Math.max(0, operations.length - items.length),
    truncated: liveWork.truncated,
    nextRecentExpiryAt: recentExpiries.length > 0 ? Math.min(...recentExpiries) : null
  };
}
