import { isCommunicationAgent, type TopologyCommunicationFlowRecord, type TopologyLiveActivityKind, type TopologyLiveActivityRecord, type TopologyLiveExecutionRecord, type TopologyLiveWorkPayload } from "@tyr-ai/contracts";
import { topologyLiveActivityLabel, topologyLiveActivityTone, type LivingTopologyActivityTone } from "./livingTopologyActivity";
import { topologyGraphWithAdaptiveAgentSpacing, type TopologyAgentLiveWork, type TopologyEdgeCommunicationFlow, type TopologyGraph, type TopologyGraphEdge, type TopologyGraphNode } from "./topology";

const STATUS_PRIORITY: Record<TopologyLiveExecutionRecord["status"], number> = {
  waiting_approval: 0,
  running: 1,
  delivered: 2,
  queued: 3
};

export function topologyLiveExecutionLabel(status: TopologyLiveExecutionRecord["status"], activityKind?: TopologyLiveActivityKind): string {
  if (activityKind) return topologyLiveActivityLabel(activityKind);
  if (status === "waiting_approval") return "Approval";
  if (status === "delivered") return "Waiting";
  return `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`;
}

export function topologyLiveExecutionTone(status: TopologyLiveExecutionRecord["status"], activityKind?: TopologyLiveActivityKind): LivingTopologyActivityTone {
  if (activityKind) return topologyLiveActivityTone(activityKind);
  if (status === "waiting_approval") return "attention";
  if (status === "running") return "running";
  return "waiting";
}

export function topologyLiveWorkRefreshKey(payload: Pick<TopologyLiveWorkPayload, "executions" | "activities">): string {
  return [
    ...payload.executions.map((execution) => `${execution.id}:${execution.status}:${execution.pendingApprovalId ?? ""}`),
    ...payload.activities.map((activity) => `${activity.id}:${activity.kind}`)
  ]
    .sort()
    .join("|");
}

export function topologyGraphWithLiveWork(graph: TopologyGraph, payload: TopologyLiveWorkPayload): TopologyGraph {
  const executionsByAgentId = new Map<string, TopologyLiveExecutionRecord[]>();
  for (const execution of payload.executions) {
    const current = executionsByAgentId.get(execution.agentId) ?? [];
    current.push(execution);
    executionsByAgentId.set(execution.agentId, current);
  }
  const activitiesByAgentId = new Map<string, TopologyLiveActivityRecord[]>();
  for (const activity of payload.activities) {
    const current = activitiesByAgentId.get(activity.agentId) ?? [];
    current.push(activity);
    activitiesByAgentId.set(activity.agentId, current);
  }

  const agentNodeByAgentId = new Map<string, TopologyGraphNode>();
  const machineNodeByMachineId = new Map<string, TopologyGraphNode>();
  const nodes = graph.nodes.map((node) => {
    if (node.row?.kind === "machine") machineNodeByMachineId.set(node.row.machine.id, node);
    if (node.row?.kind !== "agent") return node;
    agentNodeByAgentId.set(node.row.agent.id, node);
    const executions = sortTopologyLiveExecutions(executionsByAgentId.get(node.row.agent.id) ?? []);
    const activities = activitiesByAgentId.get(node.row.agent.id) ?? [];
    if (executions.length === 0 && activities.length === 0) return { ...node, liveWork: undefined };
    return {
      ...node,
      liveWork: topologyAgentLiveWork(executions, activities)
    };
  });

  const edges: TopologyGraphEdge[] = graph.edges.map((edge) => ({ ...edge, communicationFlows: undefined }));
  const edgeByRoute = new Map<string, { edge: TopologyGraphEdge; direction: TopologyEdgeCommunicationFlow["direction"] }>();
  const activeExecutionById = new Map(payload.executions.map((execution) => [execution.id, execution]));
  for (const edge of edges) {
    edgeByRoute.set(`${edge.source}->${edge.target}`, { edge, direction: "outbound" });
    edgeByRoute.set(`${edge.target}->${edge.source}`, { edge, direction: "inbound" });
  }

  function attachCommunicationFlow(
    edge: TopologyGraphEdge,
    flow: TopologyCommunicationFlowRecord,
    direction: TopologyEdgeCommunicationFlow["direction"]
  ) {
    if (edge.communicationFlows?.some((item) => item.id === flow.id && item.direction === direction)) return;
    edge.communicationFlows = [...(edge.communicationFlows ?? []), {
      id: flow.id,
      executionId: flow.executionId,
      chainId: flow.chainId,
      sourceExecutionId: flow.sourceExecutionId,
      hopCount: flow.hopCount,
      tone: flow.tone,
      continuous: flow.continuous,
      status: flow.status,
      createdAt: flow.createdAt,
      direction
    }];
  }

  for (const flow of payload.flows) {
    const sourceNode = agentNodeByAgentId.get(flow.sourceAgentId);
    const targetNode = agentNodeByAgentId.get(flow.targetAgentId);
    if (!sourceNode || !targetNode) continue;

    const sourceIsController = sourceNode.row?.kind === "agent" && isCommunicationAgent(sourceNode.row.agent);
    const targetIsController = targetNode.row?.kind === "agent" && isCommunicationAgent(targetNode.row.agent);
    const controllerNode = sourceIsController && !targetIsController
      ? sourceNode
      : targetIsController && !sourceIsController
        ? targetNode
        : undefined;
    const workerNode = controllerNode === sourceNode ? targetNode : controllerNode === targetNode ? sourceNode : undefined;
    const machineNode = machineNodeByMachineId.get(flow.machineId);

    if (controllerNode && workerNode && machineNode) {
      const controllerToMachine = edgeByRoute.get(`${controllerNode.id}->${machineNode.id}`);
      const machineToWorker = edgeByRoute.get(`${machineNode.id}->${workerNode.id}`);
      if (controllerToMachine && machineToWorker) {
        // 请求按 TYR -> Device -> Agent 前进，返回沿同一权威路径反向播放，避免额外画一条穿越房间的直线。
        const direction = controllerNode === sourceNode ? "outbound" : "inbound";
        attachCommunicationFlow(controllerToMachine.edge, flow, direction);
        attachCommunicationFlow(machineToWorker.edge, flow, direction);
        continue;
      }
    }

    const existingRoute = edgeByRoute.get(`${sourceNode.id}->${targetNode.id}`);
    if (existingRoute) {
      attachCommunicationFlow(existingRoute.edge, flow, existingRoute.direction);
      continue;
    }

    // 非 TYR delegation 没有静态关系线，只为服务端确认的 source/target execution 新建临时边。
    const activeExecution = activeExecutionById.get(flow.executionId);
    const edge: TopologyGraphEdge = {
      id: `live-communication:${sourceNode.id}:${targetNode.id}`,
      source: sourceNode.id,
      target: targetNode.id,
      kind: "agent-delegation",
      liveWork: activeExecution ? {
        executionId: activeExecution.id,
        status: activeExecution.status,
        count: 1
      } : undefined
    };
    attachCommunicationFlow(edge, flow, "outbound");
    edges.push(edge);
    edgeByRoute.set(`${edge.source}->${edge.target}`, { edge, direction: "outbound" });
    edgeByRoute.set(`${edge.target}->${edge.source}`, { edge, direction: "inbound" });
  }

  return topologyGraphWithAdaptiveAgentSpacing({ ...graph, nodes, edges });
}

export function sortTopologyLiveExecutions(executions: TopologyLiveExecutionRecord[]): TopologyLiveExecutionRecord[] {
  return [...executions].sort((left, right) => {
    const priority = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
    if (priority !== 0) return priority;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function topologyAgentLiveWork(executions: TopologyLiveExecutionRecord[], activities: TopologyLiveActivityRecord[]): TopologyAgentLiveWork {
  const activityKindByExecutionId = new Map(activities.map((activity) => [activity.executionId, activity.kind]));
  const executionIds = new Set(executions.map((execution) => execution.id));
  const totalCount = new Set([
    ...executionIds,
    ...activities.map((activity) => activity.executionId)
  ]).size;
  return {
    executions,
    activities,
    totalCount,
    hiddenCount: Math.max(0, totalCount - 2),
    attentionCount: executions.filter((execution) => topologyLiveExecutionTone(execution.status, activityKindByExecutionId.get(execution.id)) === "attention").length,
    runningCount: executions.filter((execution) => topologyLiveExecutionTone(execution.status, activityKindByExecutionId.get(execution.id)) === "running").length,
    waitingCount: executions.filter((execution) => topologyLiveExecutionTone(execution.status, activityKindByExecutionId.get(execution.id)) === "waiting").length
  };
}
