import type { Edge, Node } from "@xyflow/react";
import type { LivingTopologyNodeState } from "./livingTopologyNodeState";
import type { TopologyGraphEdge, TopologyGraphNode } from "./topology";

export type StableTopologyFlowNodeData = {
  graphNode: TopologyGraphNode;
  visualState: LivingTopologyNodeState;
  visualKey: string;
} & Record<string, unknown>;

export type StableTopologyFlowEdgeData = {
  visualKey: string;
} & Record<string, unknown>;

function topologyBridgeVisualKey(node: TopologyGraphNode): string {
  const bridge = node.bridge;
  if (!bridge) return "";
  return [
    bridge.bridgeId,
    bridge.status,
    bridge.direction,
    bridge.scope,
    bridge.permissions.join(","),
    bridge.peerWorkspaceName
  ].join(":");
}

function topologyLiveWorkVisualKey(node: TopologyGraphNode): string {
  if (!node.liveWork) return "";
  return [
    ...node.liveWork.executions
      .map((execution) => [execution.id, execution.status, execution.title, execution.sourceLabel, execution.pendingApprovalId ?? ""].join(":")),
    ...node.liveWork.activities
      // activity ID 随语义阶段变化；忽略 updatedAt，避免 assistant delta 在轮询时替换整个节点。
      .map((activity) => [activity.id, activity.kind].join(":"))
  ].join(";");
}

export function topologyGraphNodeVisualKey(node: TopologyGraphNode): string {
  return [
    node.kind,
    node.label,
    node.subtitle,
    node.status ?? "",
    node.shared ? "shared" : "local",
    node.workspacePanelId ?? "",
    node.frame ? `${node.frame.width}:${node.frame.height}:${node.frame.tone}` : "",
    topologyBridgeVisualKey(node),
    topologyLiveWorkVisualKey(node)
  ].join("|");
}

export function topologyGraphEdgeVisualKey(edge: TopologyGraphEdge): string {
  const bridge = edge.bridge;
  return [
    edge.source,
    edge.target,
    edge.kind,
    edge.path ?? "",
    bridge?.bridgeId ?? "",
    bridge?.status ?? "",
    bridge?.direction ?? "",
    bridge?.scope ?? "",
    bridge?.permissions.join(",") ?? "",
    bridge?.peerWorkspaceName ?? "",
    edge.liveWork ? `${edge.liveWork.executionId}:${edge.liveWork.status}:${edge.liveWork.count}` : "",
    (edge.communicationFlows ?? [])
      .map((flow) => `${flow.id}:${flow.direction}:${flow.tone}:${flow.continuous}`)
      .join(",")
  ].join("|");
}

function topologyPositionLocked(node: TopologyGraphNode): boolean {
  return node.kind === "workspace-panel" || node.kind === "server" || node.kind === "peer-workspace";
}

export function reconcileTopologyFlowNodes<T extends StableTopologyFlowNodeData>(
  current: Node<T>[],
  incoming: Node<T>[],
  followIncomingPositionIds: ReadonlySet<string> = new Set()
): Node<T>[] {
  const currentById = new Map(current.map((node) => [node.id, node]));
  let changed = current.length !== incoming.length;
  const next = incoming.map((incomingNode, index) => {
    const currentNode = currentById.get(incomingNode.id);
    if (!currentNode) {
      changed = true;
      return incomingNode;
    }

    const locked = topologyPositionLocked(incomingNode.data.graphNode);
    // 自动布局节点跟随实时高度重新排布；用户拖动并保存过的节点继续保留自定义坐标。
    const followsIncomingPosition = locked || (followIncomingPositionIds.has(incomingNode.id) && !currentNode.dragging);
    const positionChanged = followsIncomingPosition
      && (currentNode.position.x !== incomingNode.position.x || currentNode.position.y !== incomingNode.position.y);
    const visualChanged = currentNode.data.visualKey !== incomingNode.data.visualKey;
    if (!positionChanged && !visualChanged) {
      if (current[index]?.id !== currentNode.id) changed = true;
      return currentNode;
    }

    changed = true;
    return {
      ...incomingNode,
      // 普通节点沿用用户当前坐标；边框和 Workspace 标签必须跟随增量结构重新包裹。
      position: followsIncomingPosition ? incomingNode.position : currentNode.position,
      selected: currentNode.selected,
      dragging: currentNode.dragging,
      measured: currentNode.measured,
      width: currentNode.width,
      height: currentNode.height
    };
  });

  return changed ? next : current;
}

export function reconcileTopologyFlowEdges<T extends StableTopologyFlowEdgeData>(
  current: Edge<T>[],
  incoming: Edge<T>[]
): Edge<T>[] {
  const currentById = new Map(current.map((edge) => [edge.id, edge]));
  let changed = current.length !== incoming.length;
  const next = incoming.map((incomingEdge, index) => {
    const currentEdge = currentById.get(incomingEdge.id);
    if (!currentEdge || currentEdge.data?.visualKey !== incomingEdge.data?.visualKey) {
      changed = true;
      return incomingEdge;
    }
    if (current[index]?.id !== currentEdge.id) changed = true;
    return currentEdge;
  });
  return changed ? next : current;
}
