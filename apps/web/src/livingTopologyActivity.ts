import type { TopologyLiveActivityKind, TopologyLiveActivityRecord } from "@tyr-ai/contracts";

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

export type LivingTopologyActivityTone = "attention" | "running" | "waiting" | "success" | "error" | "muted";

export function primaryTopologyLiveActivity(
  activities: readonly TopologyLiveActivityRecord[]
): TopologyLiveActivityRecord | undefined {
  return [...activities].sort((left, right) => {
    const priority = ACTIVITY_PRIORITY[left.kind] - ACTIVITY_PRIORITY[right.kind];
    return priority || right.updatedAt.localeCompare(left.updatedAt);
  })[0];
}

export function topologyLiveActivityLabel(kind: TopologyLiveActivityKind): string {
  if (kind === "tool_running") return "Using tool";
  if (kind === "waiting_approval") return "Needs approval";
  if (kind === "delivered") return "Waiting";
  if (kind === "stalled") return "Stalled";
  return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`;
}

export function topologyLiveActivityLabelForWorkspace(
  kind: TopologyLiveActivityKind,
  peerWorkspace: boolean
): string {
  // 对端审批只能由对端 Owner 处理；Source 侧文案必须表达等待关系，不能暗示本地存在审批入口。
  if (kind === "waiting_approval" && peerWorkspace) return "Waiting on peer approval";
  return topologyLiveActivityLabel(kind);
}

export function topologyLiveActivityTone(kind: TopologyLiveActivityKind): LivingTopologyActivityTone {
  if (kind === "waiting_approval") return "attention";
  if (kind === "failed" || kind === "stalled") return "error";
  if (kind === "thinking" || kind === "tool_running") return "running";
  if (kind === "completed") return "success";
  if (kind === "cancelled") return "muted";
  return "waiting";
}

export function topologyLiveActivityIndicatesWork(kind: TopologyLiveActivityKind): boolean {
  return kind === "queued"
    || kind === "delivered"
    || kind === "thinking"
    || kind === "tool_running"
    || kind === "waiting_approval";
}
