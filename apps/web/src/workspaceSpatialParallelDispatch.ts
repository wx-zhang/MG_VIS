import type {
  WorkspaceSpatialAgent,
  WorkspaceSpatialFlowSignal,
  WorkspaceSpatialRoom
} from "./workspaceSpatial";

export const WORKSPACE_SPATIAL_PARALLEL_DISPATCH_SIBLING_WINDOW_MS = 1_800;
export const WORKSPACE_SPATIAL_PARALLEL_DISPATCH_FANOUT_START_MS = 1_800;
export const WORKSPACE_SPATIAL_PARALLEL_DISPATCH_FANOUT_END_MS = 4_300;
export const WORKSPACE_SPATIAL_PARALLEL_DISPATCH_RECEIPT_END_MS = 6_200;
export const WORKSPACE_SPATIAL_PARALLEL_DISPATCH_DURATION_MS = 9_600;
export const WORKSPACE_SPATIAL_PARALLEL_DISPATCH_TARGET_STAGGER_MS = 140;
export const WORKSPACE_SPATIAL_PARALLEL_DISPATCH_MAX_TARGETS = 3;

export type WorkspaceSpatialParallelDispatchPhase = "intake" | "fanout" | "receiving" | "settling";

export type WorkspaceSpatialParallelDispatchTarget = {
  flowId: string;
  executionId: string;
  targetAgentId: string;
  createdAtMs: number;
};

export type WorkspaceSpatialParallelDispatch = {
  id: string;
  chainId: string;
  sourceExecutionId: string;
  sourceAgentId: string;
  startedAtMs: number;
  endsAtMs: number;
  targets: WorkspaceSpatialParallelDispatchTarget[];
};

type CandidateGroup = {
  key: string;
  chainId: string;
  sourceExecutionId: string;
  sourceAgentId: string;
  targets: WorkspaceSpatialParallelDispatchTarget[];
};

function agentCanReceiveParallelDispatch(agent: WorkspaceSpatialAgent): boolean {
  if (agent.state === "offline" || agent.state === "error") return false;
  // Tool Station、Human Gate 与 terminal 回执具有更高空间优先级；fan-out 只叠加在轻量等待/思考姿态上。
  return !agent.activity || agent.activity.kind === "queued"
    || agent.activity.kind === "delivered"
    || agent.activity.kind === "thinking";
}

export function workspaceSpatialParallelDispatch(
  room: WorkspaceSpatialRoom,
  flows: WorkspaceSpatialFlowSignal[],
  nowMs: number
): WorkspaceSpatialParallelDispatch | null {
  if (room.status !== "online") return null;
  const visibleAgentById = new Map(room.visibleAgents.map((agent) => [agent.id, agent]));
  const groupByKey = new Map<string, CandidateGroup>();

  for (const flow of flows) {
    if (
      flow.tone !== "request"
      || !flow.continuous
      || !flow.sourceExecutionId
      || !flow.sourceAgentId
      || flow.sourceExecutionId === flow.executionId
      || flow.sourceAgentId === flow.targetAgentId
    ) continue;
    const target = visibleAgentById.get(flow.targetAgentId);
    if (!target || !agentCanReceiveParallelDispatch(target)) continue;
    const createdAtMs = Date.parse(flow.createdAt);
    if (!Number.isFinite(createdAtMs) || createdAtMs > nowMs) continue;
    const key = `${flow.chainId}\u0000${flow.sourceExecutionId}\u0000${flow.sourceAgentId}`;
    const group = groupByKey.get(key) ?? {
      key,
      chainId: flow.chainId,
      sourceExecutionId: flow.sourceExecutionId,
      sourceAgentId: flow.sourceAgentId,
      targets: []
    };
    group.targets.push({
      flowId: flow.id,
      executionId: flow.executionId,
      targetAgentId: flow.targetAgentId,
      createdAtMs
    });
    groupByKey.set(key, group);
  }

  const candidates = [...groupByKey.values()].flatMap((group) => {
    const chronological = [...group.targets].sort((left, right) => (
      left.createdAtMs - right.createdAtMs || left.flowId.localeCompare(right.flowId)
    ));
    const clusters: WorkspaceSpatialParallelDispatchTarget[][] = [];
    for (const target of chronological) {
      const current = clusters.at(-1);
      if (!current || target.createdAtMs - current[0].createdAtMs > WORKSPACE_SPATIAL_PARALLEL_DISPATCH_SIBLING_WINDOW_MS) {
        clusters.push([target]);
      } else {
        current.push(target);
      }
    }
    return clusters.flatMap((cluster) => {
      // 同一目标可能有重试 Flow；只保留本批次最新一条，不能把重复投递伪装成并行协作。
      const newestByTargetAgentId = new Map<string, WorkspaceSpatialParallelDispatchTarget>();
      for (const target of cluster) {
        const current = newestByTargetAgentId.get(target.targetAgentId);
        if (!current || target.createdAtMs > current.createdAtMs
          || (target.createdAtMs === current.createdAtMs && target.flowId.localeCompare(current.flowId) < 0)) {
          newestByTargetAgentId.set(target.targetAgentId, target);
        }
      }
      const targets = [...newestByTargetAgentId.values()].sort((left, right) => (
        left.createdAtMs - right.createdAtMs || left.flowId.localeCompare(right.flowId)
      ));
      if (targets.length < 2) return [];
      const startedAtMs = targets.at(-1)!.createdAtMs;
      const ageMs = nowMs - startedAtMs;
      if (ageMs < 0 || ageMs >= WORKSPACE_SPATIAL_PARALLEL_DISPATCH_DURATION_MS) return [];
      // sibling 关系来自服务端 direct parent；时间 cluster 只区分并发 fan-out 与同父 execution 的后续批次。
      return [{ group, targets, startedAtMs }];
    });
  });

  const selected = candidates.sort((left, right) => (
    right.startedAtMs - left.startedAtMs || left.group.key.localeCompare(right.group.key)
  ))[0];
  if (!selected) return null;
  return {
    id: `parallel:${selected.group.chainId}:${selected.group.sourceExecutionId}:${selected.startedAtMs}`,
    chainId: selected.group.chainId,
    sourceExecutionId: selected.group.sourceExecutionId,
    sourceAgentId: selected.group.sourceAgentId,
    startedAtMs: selected.startedAtMs,
    endsAtMs: selected.startedAtMs + WORKSPACE_SPATIAL_PARALLEL_DISPATCH_DURATION_MS,
    targets: selected.targets.slice(0, WORKSPACE_SPATIAL_PARALLEL_DISPATCH_MAX_TARGETS)
  };
}

export function workspaceSpatialParallelDispatchPhase(
  dispatch: WorkspaceSpatialParallelDispatch,
  nowMs: number
): WorkspaceSpatialParallelDispatchPhase | null {
  const elapsedMs = nowMs - dispatch.startedAtMs;
  if (elapsedMs < 0 || nowMs >= dispatch.endsAtMs) return null;
  if (elapsedMs < WORKSPACE_SPATIAL_PARALLEL_DISPATCH_FANOUT_START_MS) return "intake";
  if (elapsedMs < WORKSPACE_SPATIAL_PARALLEL_DISPATCH_FANOUT_END_MS) return "fanout";
  if (elapsedMs < WORKSPACE_SPATIAL_PARALLEL_DISPATCH_RECEIPT_END_MS) return "receiving";
  return "settling";
}

export function workspaceSpatialParallelDispatchTargetIndex(
  dispatch: WorkspaceSpatialParallelDispatch | null,
  agentId: string
): number | null {
  if (!dispatch) return null;
  const index = dispatch.targets.findIndex((target) => target.targetAgentId === agentId);
  return index >= 0 ? index : null;
}
