import type {
  ChannelRecord,
  MessageRecord,
  RuntimeExecutionRecord,
  TopologyCommunicationFlowRecord
} from "@tyr-ai/contracts";

export const TOPOLOGY_TERMINAL_FLOW_WINDOW_MS = 30_000;
export const TOPOLOGY_ACTIVE_EXECUTION_WINDOW_MS = 24 * 60 * 60 * 1_000;

const ACTIVE_FLOW_STATUSES = new Set<RuntimeExecutionRecord["status"]>([
  "queued",
  "delivered",
  "running",
  "waiting_approval"
]);

const TOPOLOGY_CHAIN_MAX_DEPTH = 64;

export function topologyCommunicationChainIdForExecution(
  execution: RuntimeExecutionRecord,
  getExecution: (executionId: string) => RuntimeExecutionRecord | null | undefined
): string {
  let current = execution;
  const visited = new Set([execution.id]);

  for (let depth = 0; current.sourceExecutionId && depth < TOPOLOGY_CHAIN_MAX_DEPTH; depth += 1) {
    const source = getExecution(current.sourceExecutionId);
    if (!source) break;
    if (visited.has(source.id)) {
      // 损坏数据形成环时选取稳定的 opaque id，避免不同 Flow 被投影成互相矛盾的 chainId。
      return [...visited, source.id].sort()[0] ?? execution.id;
    }
    visited.add(source.id);
    current = source;
  }

  return current.id;
}

export function topologyExecutionIsLive(execution: RuntimeExecutionRecord, nowMs: number): boolean {
  if (!ACTIVE_FLOW_STATUSES.has(execution.status)) return false;
  const updatedAt = Date.parse(execution.updatedAt || execution.createdAt);
  // Topology 只投影实时工作：过期队列仍保留审计记录，但不能继续显示成当前任务。
  return Number.isFinite(updatedAt) && Math.max(0, nowMs - updatedAt) <= TOPOLOGY_ACTIVE_EXECUTION_WINDOW_MS;
}

export function topologyExecutionHasVisibleFlow(execution: RuntimeExecutionRecord, nowMs: number): boolean {
  if (ACTIVE_FLOW_STATUSES.has(execution.status)) return topologyExecutionIsLive(execution, nowMs);
  if (execution.status !== "completed" && execution.status !== "failed" && execution.status !== "stalled" && execution.status !== "cancelled") return false;
  const updatedAt = Date.parse(execution.updatedAt);
  return Number.isFinite(updatedAt) && Math.max(0, nowMs - updatedAt) <= TOPOLOGY_TERMINAL_FLOW_WINDOW_MS;
}

export function topologyDelegationSourceAgentIdForExecution(input: {
  execution: RuntimeExecutionRecord;
  message?: MessageRecord | null;
  channel?: ChannelRecord | null;
}): string | undefined {
  const { execution, message, channel } = input;
  if (
    !message
    || !channel
    || message.id !== execution.messageId
    || message.kind !== "delegation"
    || message.senderType !== "agent"
    || message.channelId !== channel.id
    || channel.type !== "dm"
    || channel.dmIdentity?.kind !== "agent_pair"
  ) return undefined;
  const [firstAgentId, secondAgentId] = channel.dmIdentity.agentIds;
  // 只有不可变 Agent Pair 同时证明发送者和执行目标时，才允许把内部 delegation 投影成可见 Flow。
  const pairMatches = (
    (firstAgentId === message.senderId && secondAgentId === execution.agentId)
    || (secondAgentId === message.senderId && firstAgentId === execution.agentId)
  );
  if (!pairMatches || message.senderId === execution.agentId) return undefined;
  if (execution.serverId && channel.serverId && execution.serverId !== channel.serverId) return undefined;
  return message.senderId;
}

export function topologyCommunicationFlowForExecution(input: {
  execution: RuntimeExecutionRecord;
  sourceExecution?: RuntimeExecutionRecord | null;
  chainId?: string;
  delegationSourceAgentId?: string;
  bridgeControllerAgentId?: string;
  bridgeRequestMessageId?: string;
  workspaceId: string;
  bridgePath?: string[];
}): TopologyCommunicationFlowRecord | null {
  const { execution, sourceExecution, delegationSourceAgentId, bridgeControllerAgentId, workspaceId, bridgePath } = input;
  const returning = Boolean(sourceExecution && (
    sourceExecution.returnExecutionId === execution.id
    || sourceExecution.status === "completed" && sourceExecution.returnToAgentId === execution.agentId
  ));

  let sourceAgentId: string | undefined;
  let targetAgentId: string | undefined;
  let tone: TopologyCommunicationFlowRecord["tone"];

  if (execution.status === "failed" || execution.status === "stalled" || execution.status === "cancelled") {
    sourceAgentId = sourceExecution?.agentId ?? delegationSourceAgentId ?? bridgeControllerAgentId;
    targetAgentId = execution.agentId;
    tone = "error";
  } else if (returning) {
    // return execution 完成后仍保持 worker -> requester；不能因 status=completed 翻转成第二条伪回传。
    sourceAgentId = sourceExecution?.agentId;
    targetAgentId = execution.agentId;
    tone = "response";
  } else if (execution.status === "completed") {
    sourceAgentId = execution.agentId;
    targetAgentId = execution.returnToAgentId ?? sourceExecution?.agentId ?? delegationSourceAgentId ?? bridgeControllerAgentId;
    tone = "response";
  } else {
    sourceAgentId = sourceExecution?.agentId ?? delegationSourceAgentId ?? bridgeControllerAgentId;
    targetAgentId = execution.agentId;
    tone = "request";
  }

  // 没有权威来源关系的普通 Human -> Agent execution 不应被伪装成 TYR 调度。
  if (!sourceAgentId || !targetAgentId || sourceAgentId === targetAgentId) return null;

  return {
    id: `${execution.id}:${execution.status}`,
    executionId: execution.id,
    chainId: input.chainId ?? execution.id,
    sourceExecutionId: execution.sourceExecutionId,
    // request 本身已转为 terminal response 时，Renderer 仍需服务端提供的直接 parent 才能安全汇合 sibling results。
    requestSourceExecutionId: returning ? sourceExecution?.sourceExecutionId : undefined,
    // Bridge message 与 worker execution 使用服务端已验证的 return ref 关联，Renderer 不解析聊天文案猜测路由。
    ...(input.bridgeRequestMessageId ? { bridgeRequestMessageId: input.bridgeRequestMessageId } : {}),
    // 目标 Workspace 的本地 TYR 行程沿用 execution 创建时的分配；旧记录按单路原身展示。
    ...(bridgeControllerAgentId ? { actorMode: execution.controllerActorMode ?? "direct" } : {}),
    // 回传消息持久化后才让本地拜访收尾；不把 worker 的 completed 当作 TYR 已收结果。
    ...(execution.communicationReturnMessageId && execution.communicationReturnDispatchedAt
      ? { resultReceivedAt: execution.communicationReturnDispatchedAt } : {}),
    hopCount: execution.hopCount,
    workspaceId,
    bridgePath,
    sourceAgentId,
    targetAgentId,
    machineId: execution.machineId,
    tone,
    continuous: ACTIVE_FLOW_STATUSES.has(execution.status),
    status: execution.status,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt
  };
}
