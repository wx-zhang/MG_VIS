import type { TopologyGraphEdge } from "./topology";

export type TopologyBridgeMarkerPlacement = "none" | "end" | "both";

export function topologyBridgeEdgeStatus(edge: TopologyGraphEdge): string | undefined {
  return edge.bridge?.status;
}

export function topologyBridgeEdgeLabel(edge: TopologyGraphEdge): string | undefined {
  if (!edge.bridge) return undefined;
  return undefined;
}

export function topologyBridgeMarkerPlacement(edge: TopologyGraphEdge): TopologyBridgeMarkerPlacement {
  if (!edge.bridge) return "none";
  return edge.bridge.direction === "bidirectional" ? "both" : "end";
}

export function topologyBridgeEdgeClassName(edge: TopologyGraphEdge): string {
  const base = `topology-flow-edge ${edge.kind}`;
  if (!edge.bridge) return base;
  return `${base} ${edge.bridge.status} ${edge.bridge.direction.replace("_", "-")}`;
}
