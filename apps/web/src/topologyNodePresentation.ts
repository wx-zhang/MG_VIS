import {
  isCommunicationAgent,
  type CommunicationAgentProgressRecord,
  type CrossWorkspaceMessageRecord
} from "@tyr-ai/contracts";
import { bridgeCommunicationFlowSignals, type CommunicationFlowTone } from "./communicationFlow";
import {
  resolveLivingTopologyNodeState,
  type LivingTopologyFlowRole,
  type LivingTopologyNodeFlow,
  type LivingTopologyNodeKind,
  type LivingTopologyNodeState
} from "./livingTopologyNodeState";
import { primaryTopologyLiveActivity } from "./livingTopologyActivity";
import type { TopologyGraph, TopologyGraphEdge, TopologyGraphNode } from "./topology";

type TopologyNodePresentationInput = {
  graph: TopologyGraph;
  communicationAgentProgress?: readonly CommunicationAgentProgressRecord[];
  crossWorkspaceMessages?: readonly CrossWorkspaceMessageRecord[];
  currentWorkspaceId?: string;
  nowMs?: number;
};

type EdgeSignal = {
  id: string;
  direction: "outbound" | "inbound";
  tone: CommunicationFlowTone;
  continuous: boolean;
  createdAt?: string;
};

type NodeSignal = EdgeSignal & {
  roles: Set<"source" | "target">;
};

export type TopologyNodeSignalIndicator = "none" | "loading" | "terminal";
export type TopologyNodeSignalHalo = "none" | "primary" | "terminal";
export type TopologyNodeSignalPresentation = {
  halo: TopologyNodeSignalHalo;
  indicator: TopologyNodeSignalIndicator;
};

const TOPOLOGY_PRIMARY_EXECUTION_PHASES = new Set<LivingTopologyNodeState["phase"]>([
  "thinking",
  "tool"
]);

export function topologyNodeSignalPresentation(state: LivingTopologyNodeState): TopologyNodeSignalPresentation {
  // Flow 由河道与端口表达。只有真正承担 Runtime 工作的 TYR / Agent 才显示运算圆环，
  // 避免同一条消息在 Server、Device、Bridge 和所有端点上复制同一种指示器。
  if (state.kind !== "tyr" && state.kind !== "agent") return { halo: "none", indicator: "none" };
  if (state.source !== "activity" && state.source !== "progress") return { halo: "none", indicator: "none" };
  if (state.terminal && (state.phase === "success" || state.phase === "error")) {
    return { halo: "terminal", indicator: "terminal" };
  }
  if (state.continuous && TOPOLOGY_PRIMARY_EXECUTION_PHASES.has(state.phase)) {
    return { halo: "primary", indicator: "loading" };
  }
  if (state.continuous && state.phase === "approval") {
    return { halo: "primary", indicator: "none" };
  }
  return { halo: "none", indicator: "none" };
}

export function topologyNodeSignalIndicator(state: LivingTopologyNodeState): TopologyNodeSignalIndicator {
  return topologyNodeSignalPresentation(state).indicator;
}

function topologyNodeKind(node: TopologyGraphNode): LivingTopologyNodeKind {
  if (node.kind === "server" || node.kind === "peer-workspace") return "server";
  if (node.kind === "machine" || node.kind === "device") return "device";
  if (node.kind === "workspace-bridge") return "bridge";
  if (node.kind === "agent") {
    return node.row?.kind === "agent" && isCommunicationAgent(node.row.agent) ? "tyr" : "agent";
  }
  return "other";
}
function edgeSignals(
  edge: TopologyGraphEdge,
  messages: readonly CrossWorkspaceMessageRecord[],
  currentWorkspaceId: string | undefined,
  nowMs: number
): EdgeSignal[] {
  const signals: EdgeSignal[] = (edge.communicationFlows ?? []).map((flow) => ({
    id: flow.id,
    direction: flow.direction,
    tone: flow.tone,
    continuous: flow.continuous,
    createdAt: flow.createdAt
  }));
  if (edge.bridge && currentWorkspaceId) {
    signals.push(...bridgeCommunicationFlowSignals(
      messages.filter((message) => message.bridgeId === edge.bridge?.bridgeId),
      currentWorkspaceId,
      nowMs
    ));
  }
  if (edge.liveWork && !signals.some((signal) => signal.id === edge.liveWork?.executionId)) {
    signals.push({
      id: edge.liveWork.executionId,
      direction: "outbound",
      tone: "request",
      continuous: ["queued", "delivered", "running", "waiting_approval"].includes(edge.liveWork.status)
    });
  }
  return signals;
}

function nodeFlowRole(roles: ReadonlySet<"source" | "target">): Exclude<LivingTopologyFlowRole, "none"> {
  if (roles.has("source") && roles.has("target")) return "relay";
  return roles.has("source") ? "source" : "target";
}

function dominantNodeFlow(signals: Map<string, NodeSignal>): LivingTopologyNodeFlow | undefined {
  const ranked = [...signals.values()].sort((left, right) => {
    if (left.continuous !== right.continuous) return left.continuous ? -1 : 1;
    const tonePriority: Record<CommunicationFlowTone, number> = { error: 0, response: 1, request: 2 };
    const toneOrder = tonePriority[left.tone] - tonePriority[right.tone];
    if (toneOrder !== 0) return toneOrder;
    return (right.createdAt ?? "").localeCompare(left.createdAt ?? "");
  });
  const primary = ranked[0];
  if (!primary) return undefined;
  return {
    id: primary.id,
    role: nodeFlowRole(primary.roles),
    tone: primary.tone,
    continuous: primary.continuous,
    activeCount: signals.size,
    createdAt: primary.createdAt
  };
}

function latestProgress(
  records: readonly CommunicationAgentProgressRecord[],
  agentId: string | undefined
): CommunicationAgentProgressRecord | undefined {
  if (!agentId) return undefined;
  return records
    .filter((progress) => progress.assistantAgentId === agentId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function topologyLivingNodeStates(input: TopologyNodePresentationInput): Map<string, LivingTopologyNodeState> {
  const nowMs = input.nowMs ?? Date.now();
  const messages = input.crossWorkspaceMessages ?? [];
  const progress = input.communicationAgentProgress ?? [];
  const signalsByNodeId = new Map<string, Map<string, NodeSignal>>();

  function addSignal(nodeId: string, signal: EdgeSignal, role: "source" | "target") {
    const nodeSignals = signalsByNodeId.get(nodeId) ?? new Map<string, NodeSignal>();
    const current = nodeSignals.get(signal.id);
    if (current) current.roles.add(role);
    else nodeSignals.set(signal.id, { ...signal, roles: new Set([role]) });
    signalsByNodeId.set(nodeId, nodeSignals);
  }

  for (const edge of input.graph.edges) {
    for (const signal of edgeSignals(edge, messages, input.currentWorkspaceId, nowMs)) {
      const sourceId = signal.direction === "outbound" ? edge.source : edge.target;
      const targetId = signal.direction === "outbound" ? edge.target : edge.source;
      addSignal(sourceId, signal, "source");
      addSignal(targetId, signal, "target");
    }
  }

  const result = new Map<string, LivingTopologyNodeState>();
  for (const node of input.graph.nodes) {
    if (node.kind === "workspace-panel") continue;
    result.set(node.id, resolveLivingTopologyNodeState({
      kind: topologyNodeKind(node),
      resourceStatus: node.bridge?.status ?? node.status,
      activity: primaryTopologyLiveActivity(node.liveWork?.activities ?? []),
      progress: latestProgress(progress, node.row?.kind === "agent" ? node.row.agent.id : undefined),
      flow: dominantNodeFlow(signalsByNodeId.get(node.id) ?? new Map())
    }));
  }

  // Server / Workspace 标签汇总本边界内的真实节点状态；边框本身仍保持静态，不制造假活动。
  for (const node of input.graph.nodes.filter((item) => item.kind === "server" || item.kind === "peer-workspace")) {
    const aggregateStates = input.graph.nodes
      .filter((member) => member.id !== node.id && member.workspacePanelId === node.workspacePanelId)
      .map((member) => result.get(member.id))
      .filter((state): state is LivingTopologyNodeState => Boolean(state));
    result.set(node.id, resolveLivingTopologyNodeState({
      kind: "server",
      resourceStatus: node.status,
      aggregateStates
    }));
  }

  return result;
}
