import type { TopologyCommunicationFlowRecord, TopologyLiveWorkPayload } from "@tyr-ai/contracts";
import { WORKSPACE_SPATIAL_BRIDGE_JOURNEY_TERMINAL_MS } from "./workspaceSpatialBridgeJourney";

/** 客户端保留未经过光效去重的拜访事实；不改变服务端 payload 或历史光效播放规则。 */
export type TopologyLiveWorkPlaybackPayload = TopologyLiveWorkPayload & {
  visitFlows?: TopologyCommunicationFlowRecord[];
};

// 终态只在当前页面已观察到对应执行过程时播放；刷新后只恢复事实，不能重演已经完成的河道。
export const TRANSIENT_FLOW_PLAYBACK_MS = 8_000;
// 人工审批会把用户带到 Execution 详情；活动终态需覆盖自然返回 Workspace View 的耗时，
// 否则真实 Completed / Failed 可能在用户回到场景前已经消失。通信流仍保持更短的拖尾。
export const TRANSIENT_ACTIVITY_PLAYBACK_MS = 10_000;
// Server 终态只可见 30 秒且单次最多 500 条；保留最近 5,000 个 ID 足以覆盖相关重连，同时让常驻页面内存有硬上限。
export const MAX_PLAYED_TRANSIENT_IDS = 5_000;

export type TopologyLiveWorkPlaybackState = {
  observedContinuousFlowExecutionIds: Set<string>;
  playedFlowIds: Set<string>;
  flowPlaybackUntil: Map<string, number>;
  playedActivityIds: Set<string>;
  activityPlaybackUntil: Map<string, number>;
  playedJourneyIds: Set<string>;
  journeyPlaybackUntil: Map<string, number>;
};

export function createTopologyLiveWorkPlaybackState(): TopologyLiveWorkPlaybackState {
  return {
    observedContinuousFlowExecutionIds: new Set(),
    playedFlowIds: new Set(),
    flowPlaybackUntil: new Map(),
    playedActivityIds: new Set(),
    activityPlaybackUntil: new Map(),
    playedJourneyIds: new Set(),
    journeyPlaybackUntil: new Map()
  };
}

export function resetTopologyLiveWorkPlaybackState(state: TopologyLiveWorkPlaybackState): void {
  state.observedContinuousFlowExecutionIds.clear();
  state.playedFlowIds.clear();
  state.flowPlaybackUntil.clear();
  state.playedActivityIds.clear();
  state.activityPlaybackUntil.clear();
  state.playedJourneyIds.clear();
  state.journeyPlaybackUntil.clear();
}

function rememberBounded(set: Set<string>, id: string): void {
  set.delete(id);
  set.add(id);
  while (set.size > MAX_PLAYED_TRANSIENT_IDS) {
    const oldestId = set.values().next().value;
    if (typeof oldestId !== "string") break;
    set.delete(oldestId);
  }
}

function rememberPlaybackUntil(map: Map<string, number>, id: string, expiry: number): void {
  map.delete(id);
  map.set(id, expiry);
  while (map.size > MAX_PLAYED_TRANSIENT_IDS) {
    const oldestId = map.keys().next().value;
    if (typeof oldestId !== "string") break;
    map.delete(oldestId);
  }
}

function pruneExpiredPlaybackMaps(state: TopologyLiveWorkPlaybackState, nowMs: number): void {
  for (const [flowId, expiry] of state.flowPlaybackUntil) {
    if (expiry <= nowMs) state.flowPlaybackUntil.delete(flowId);
  }
  for (const [activityId, expiry] of state.activityPlaybackUntil) {
    if (expiry <= nowMs) state.activityPlaybackUntil.delete(activityId);
  }
  for (const [journeyId, expiry] of state.journeyPlaybackUntil) {
    if (expiry <= nowMs) state.journeyPlaybackUntil.delete(journeyId);
  }
}

function normalizeTopologyLiveWorkPayload(payload: TopologyLiveWorkPayload): TopologyLiveWorkPayload {
  return {
    executions: Array.isArray(payload.executions) ? payload.executions : [],
    flows: Array.isArray(payload.flows) ? payload.flows : [],
    // 兼容滚动发布期间仍返回旧 payload 的 server；Renderer 不自行补造 activity。
    activities: Array.isArray(payload.activities) ? payload.activities : [],
    // Bridge 消息只提供无正文的 route 元数据；Journey 终态在本层统一做单次播放。
    bridgeMessages: Array.isArray(payload.bridgeMessages) ? payload.bridgeMessages : [],
    bridgeJourneys: Array.isArray(payload.bridgeJourneys) ? payload.bridgeJourneys : [],
    truncated: Boolean(payload.truncated)
  };
}

function topologyLiveWorkRecordEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => {
    const leftValue = left[key];
    const rightValue = right[key];
    if (!Array.isArray(leftValue) || !Array.isArray(rightValue)) return leftValue === rightValue;
    return leftValue.length === rightValue.length && leftValue.every((value, index) => value === rightValue[index]);
  });
}

export function topologyLiveWorkPayloadEqual(
  left: TopologyLiveWorkPlaybackPayload,
  right: TopologyLiveWorkPlaybackPayload
): boolean {
  if (left.truncated !== right.truncated) return false;
  const arrays = ["executions", "flows", "activities", "bridgeMessages", "bridgeJourneys", "visitFlows"] as const;
  return arrays.every((key) => {
    const leftItems = left[key] ?? [];
    const rightItems = right[key] ?? [];
    return leftItems.length === rightItems.length && leftItems.every((item, index) => (
      topologyLiveWorkRecordEqual(
        item as unknown as Record<string, unknown>,
        rightItems[index] as unknown as Record<string, unknown>
      )
    ));
  });
}

export function topologyLiveWorkPayloadForPlayback(
  state: TopologyLiveWorkPlaybackState,
  payload: TopologyLiveWorkPayload,
  nowMs: number
): TopologyLiveWorkPlaybackPayload {
  pruneExpiredPlaybackMaps(state, nowMs);
  const normalized = normalizeTopologyLiveWorkPayload(payload);
  const flows = normalized.flows.filter((flow) => {
    if (flow.continuous) {
      rememberBounded(state.observedContinuousFlowExecutionIds, flow.executionId);
      return true;
    }
    const existingExpiry = state.flowPlaybackUntil.get(flow.id);
    if (existingExpiry && existingExpiry > nowMs) return true;
    if (state.playedFlowIds.has(flow.id)) return false;
    rememberBounded(state.playedFlowIds, flow.id);
    // completed Flow 是服务端保留的短时审计事实。只有本次页面会话看过同一 execution 的 live 阶段，
    // 才允许它继续播放返回动画；刷新后首次读到终态时直接消费，避免凭历史状态补造一条河道。
    if (!state.observedContinuousFlowExecutionIds.has(flow.executionId)) return false;
    rememberPlaybackUntil(state.flowPlaybackUntil, flow.id, nowMs + TRANSIENT_FLOW_PLAYBACK_MS);
    return true;
  });
  const activities = normalized.activities.filter((activity) => {
    if (activity.continuous) return true;
    const existingExpiry = state.activityPlaybackUntil.get(activity.id);
    if (existingExpiry && existingExpiry > nowMs) return true;
    if (state.playedActivityIds.has(activity.id)) return false;
    rememberBounded(state.playedActivityIds, activity.id);
    rememberPlaybackUntil(state.activityPlaybackUntil, activity.id, nowMs + TRANSIENT_ACTIVITY_PLAYBACK_MS);
    return true;
  });
  const bridgeJourneys = (normalized.bridgeJourneys ?? []).filter((journey) => {
    if (journey.continuous) return true;
    const existingExpiry = state.journeyPlaybackUntil.get(journey.id);
    if (existingExpiry && existingExpiry > nowMs) return true;
    if (state.playedJourneyIds.has(journey.id)) return false;
    rememberBounded(state.playedJourneyIds, journey.id);
    const phaseAtMs = Date.parse(journey.phaseAt);
    const authoritativeExpiry = Number.isFinite(phaseAtMs)
      ? phaseAtMs + WORKSPACE_SPATIAL_BRIDGE_JOURNEY_TERMINAL_MS
      : nowMs + WORKSPACE_SPATIAL_BRIDGE_JOURNEY_TERMINAL_MS;
    // Hard refresh never restarts an old walk. A fresh terminal transition only owns the remainder of its real wall-clock window.
    if (authoritativeExpiry <= nowMs) return false;
    rememberPlaybackUntil(
      state.journeyPlaybackUntil,
      journey.id,
      Math.min(authoritativeExpiry, nowMs + WORKSPACE_SPATIAL_BRIDGE_JOURNEY_TERMINAL_MS)
    );
    return true;
  });
  return { ...normalized, flows, activities, bridgeJourneys, visitFlows: normalized.flows };
}

export function pruneTopologyLiveWorkPlayback(
  state: TopologyLiveWorkPlaybackState,
  payload: TopologyLiveWorkPlaybackPayload,
  nowMs: number
): TopologyLiveWorkPlaybackPayload {
  pruneExpiredPlaybackMaps(state, nowMs);
  return {
    ...payload,
    flows: payload.flows.filter((flow) => flow.continuous || state.flowPlaybackUntil.has(flow.id)),
    activities: payload.activities.filter((activity) => activity.continuous || state.activityPlaybackUntil.has(activity.id)),
    bridgeJourneys: (payload.bridgeJourneys ?? []).filter((journey) => (
      journey.continuous || state.journeyPlaybackUntil.has(journey.id)
    ))
  };
}

export function nextTopologyLiveWorkPlaybackExpiry(
  state: TopologyLiveWorkPlaybackState,
  nowMs: number
): number | null {
  const expiry = Math.min(...[
    ...state.flowPlaybackUntil.values(),
    ...state.activityPlaybackUntil.values(),
    ...state.journeyPlaybackUntil.values()
  ].filter((value) => value > nowMs));
  return Number.isFinite(expiry) ? expiry : null;
}
