import type {
  WorkspaceSpatialAgent,
  WorkspaceSpatialFlowSignal,
  WorkspaceSpatialRoom
} from "./workspaceSpatial";

export const WORKSPACE_SPATIAL_RESULT_CONVERGENCE_WINDOW_MS = 2_200;
export const WORKSPACE_SPATIAL_RESULT_CONVERGENCE_COLLECT_START_MS = 1_200;
export const WORKSPACE_SPATIAL_RESULT_CONVERGENCE_COLLECT_END_MS = 4_200;
export const WORKSPACE_SPATIAL_RESULT_CONVERGENCE_MERGE_END_MS = 5_800;
export const WORKSPACE_SPATIAL_RESULT_CONVERGENCE_RELAY_END_MS = 7_800;
export const WORKSPACE_SPATIAL_RESULT_CONVERGENCE_DURATION_MS = 9_800;
export const WORKSPACE_SPATIAL_RESULT_CONVERGENCE_STAGGER_MS = 120;
export const WORKSPACE_SPATIAL_RESULT_CONVERGENCE_MAX_SOURCES = 3;

export type WorkspaceSpatialResultConvergencePhase = "staging" | "collecting" | "merging" | "relaying" | "settling";

export type WorkspaceSpatialResultContribution = {
  requestFlowId: string;
  responseFlowId: string;
  childExecutionId: string;
  responseExecutionId: string;
  sourceAgentId: string;
  createdAtMs: number;
};

export type WorkspaceSpatialResultConvergence = {
  id: string;
  chainId: string;
  parentExecutionId: string;
  targetAgentId: string;
  deliveryKind: "gateway" | "agent";
  startedAtMs: number;
  endsAtMs: number;
  contributions: WorkspaceSpatialResultContribution[];
};

type CandidateGroup = {
  key: string;
  chainId: string;
  parentExecutionId: string;
  targetAgentId: string;
  deliveryKind: WorkspaceSpatialResultConvergence["deliveryKind"];
  contributions: WorkspaceSpatialResultContribution[];
};

function agentCanContributeResult(agent: WorkspaceSpatialAgent): boolean {
  if (agent.state === "offline" || agent.state === "error") return false;
  if (!agent.activity) return true;
  // Tool 与 Approval 是当前更高优先级的真实空间语义；成功 terminal 可以和结果卡回收并存，但人物手势会让位。
  return agent.activity.kind !== "tool_running"
    && agent.activity.kind !== "waiting_approval"
    && agent.activity.kind !== "failed"
    && agent.activity.kind !== "stalled"
    && agent.activity.kind !== "cancelled";
}

export function workspaceSpatialResultRequesterCanReceive(agent: WorkspaceSpatialAgent): boolean {
  if (agent.state === "offline" || agent.state === "error") return false;
  if (!agent.activity) return true;
  // requester 只有在等待或思考时接收结果册；Tool、Approval 与 terminal 都不能被收件手势覆盖。
  return agent.activity.kind === "queued"
    || agent.activity.kind === "delivered"
    || agent.activity.kind === "thinking";
}

export function workspaceSpatialResultConvergence(
  room: WorkspaceSpatialRoom,
  flows: WorkspaceSpatialFlowSignal[],
  nowMs: number,
  eligibilityDurationMs = WORKSPACE_SPATIAL_RESULT_CONVERGENCE_DURATION_MS
): WorkspaceSpatialResultConvergence | null {
  if (room.status !== "online") return null;
  const roomAgentById = new Map(room.agents.map((agent) => [agent.id, agent]));
  const visibleAgentById = new Map(room.visibleAgents.map((agent) => [agent.id, agent]));
  const requestByExecutionId = new Map(flows.flatMap((flow) => (
    flow.tone === "request"
    && flow.sourceExecutionId
    && flow.sourceAgentId
    && flow.sourceExecutionId !== flow.executionId
      ? [[flow.executionId, flow] as const]
      : []
  )));
  const groupByKey = new Map<string, CandidateGroup>();

  for (const response of flows) {
    if (response.tone !== "response" || !response.sourceExecutionId || !response.sourceAgentId) continue;
    const request = requestByExecutionId.get(response.sourceExecutionId);
    const hasVisibleRequest = Boolean(request
      && request.chainId === response.chainId
      && request.targetAgentId === response.sourceAgentId
      && request.sourceAgentId === response.targetAgentId
      && request.sourceExecutionId);
    // 真实 child execution 进入 terminal 后原 request Flow 不再同时存在；此时只接受服务端明确投影的 request direct parent。
    const parentExecutionId = hasVisibleRequest
      ? request!.sourceExecutionId
      : response.requestSourceExecutionId;
    if (!parentExecutionId || parentExecutionId === response.sourceExecutionId) continue;
    const roomRequester = roomAgentById.get(response.targetAgentId);
    // 房内 requester 只有实际可见且能接收时才走直达；隐藏目标不能被误画成 gateway 外部 controller。
    if (roomRequester && (!visibleAgentById.has(roomRequester.id) || !workspaceSpatialResultRequesterCanReceive(roomRequester))) continue;
    const sourceAgent = visibleAgentById.get(response.sourceAgentId);
    if (!sourceAgent || !agentCanContributeResult(sourceAgent)) continue;
    const createdAtMs = Date.parse(response.createdAt);
    if (!Number.isFinite(createdAtMs) || createdAtMs > nowMs) continue;
    const key = `${response.chainId}\u0000${parentExecutionId}\u0000${response.targetAgentId}`;
    const group = groupByKey.get(key) ?? {
      key,
      chainId: response.chainId,
      parentExecutionId,
      targetAgentId: response.targetAgentId,
      deliveryKind: roomRequester ? "agent" : "gateway",
      contributions: []
    };
    group.contributions.push({
      requestFlowId: request?.id ?? `request-lineage:${response.sourceExecutionId}`,
      responseFlowId: response.id,
      childExecutionId: response.sourceExecutionId,
      responseExecutionId: response.executionId,
      sourceAgentId: response.sourceAgentId,
      createdAtMs
    });
    groupByKey.set(key, group);
  }

  const candidates = [...groupByKey.values()].flatMap((group) => {
    const chronological = [...group.contributions].sort((left, right) => (
      left.createdAtMs - right.createdAtMs || left.responseFlowId.localeCompare(right.responseFlowId)
    ));
    const clusters: WorkspaceSpatialResultContribution[][] = [];
    for (const contribution of chronological) {
      const current = clusters.at(-1);
      if (!current || contribution.createdAtMs - current[0].createdAtMs > WORKSPACE_SPATIAL_RESULT_CONVERGENCE_WINDOW_MS) {
        clusters.push([contribution]);
      } else {
        current.push(contribution);
      }
    }
    return clusters.flatMap((cluster) => {
      // 同一 child execution 的重试 response 只保留本批次最新事实，不能伪造多个结果来源。
      const newestByChildExecutionId = new Map<string, WorkspaceSpatialResultContribution>();
      for (const contribution of cluster) {
        const current = newestByChildExecutionId.get(contribution.childExecutionId);
        if (!current || contribution.createdAtMs > current.createdAtMs
          || (contribution.createdAtMs === current.createdAtMs
            && contribution.responseFlowId.localeCompare(current.responseFlowId) < 0)) {
          newestByChildExecutionId.set(contribution.childExecutionId, contribution);
        }
      }
      const contributions = [...newestByChildExecutionId.values()].sort((left, right) => (
        left.createdAtMs - right.createdAtMs || left.responseFlowId.localeCompare(right.responseFlowId)
      ));
      if (contributions.length < 2 || new Set(contributions.map((item) => item.sourceAgentId)).size < 2) return [];
      const startedAtMs = contributions.at(-1)!.createdAtMs;
      const ageMs = nowMs - startedAtMs;
      // 跨房间接力比房内汇合窗口更长；调用方可只延长事实的可选期，房内 phase 与 endsAt 仍保持原时长。
      if (ageMs < 0 || ageMs >= eligibilityDurationMs) return [];
      return [{ group, contributions, startedAtMs }];
    });
  });

  const selected = candidates.sort((left, right) => (
    right.startedAtMs - left.startedAtMs || left.group.key.localeCompare(right.group.key)
  ))[0];
  if (!selected) return null;
  return {
    id: `convergence:${selected.group.chainId}:${selected.group.parentExecutionId}:${selected.startedAtMs}`,
    chainId: selected.group.chainId,
    parentExecutionId: selected.group.parentExecutionId,
    targetAgentId: selected.group.targetAgentId,
    deliveryKind: selected.group.deliveryKind,
    startedAtMs: selected.startedAtMs,
    endsAtMs: selected.startedAtMs + WORKSPACE_SPATIAL_RESULT_CONVERGENCE_DURATION_MS,
    contributions: selected.contributions.slice(0, WORKSPACE_SPATIAL_RESULT_CONVERGENCE_MAX_SOURCES)
  };
}

export function workspaceSpatialResultConvergencePhase(
  convergence: WorkspaceSpatialResultConvergence,
  nowMs: number
): WorkspaceSpatialResultConvergencePhase | null {
  const elapsedMs = nowMs - convergence.startedAtMs;
  if (elapsedMs < 0 || nowMs >= convergence.endsAtMs) return null;
  if (elapsedMs < WORKSPACE_SPATIAL_RESULT_CONVERGENCE_COLLECT_START_MS) return "staging";
  if (elapsedMs < WORKSPACE_SPATIAL_RESULT_CONVERGENCE_COLLECT_END_MS) return "collecting";
  if (elapsedMs < WORKSPACE_SPATIAL_RESULT_CONVERGENCE_MERGE_END_MS) return "merging";
  if (elapsedMs < WORKSPACE_SPATIAL_RESULT_CONVERGENCE_RELAY_END_MS) return "relaying";
  return "settling";
}

export function workspaceSpatialResultContributionIndex(
  convergence: WorkspaceSpatialResultConvergence | null,
  agentId: string
): number | null {
  if (!convergence) return null;
  const index = convergence.contributions.findIndex((contribution) => contribution.sourceAgentId === agentId);
  return index >= 0 ? index : null;
}

export function workspaceSpatialResultRecipient(
  convergence: WorkspaceSpatialResultConvergence | null,
  agentId: string
): boolean {
  return convergence?.deliveryKind === "agent" && convergence.targetAgentId === agentId;
}
