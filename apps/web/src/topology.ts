import { isCommunicationAgent, type AgentRecord, type AppSnapshot, type ChannelRecord, type DeviceGrantRecord, type DeviceRecord, type MachineRecord, type ResourceGrantSummary, type ServerRecord, type TopologyCommunicationFlowRecord, type TopologyLiveActivityRecord, type TopologyLiveExecutionRecord, type UserRecord, type WorkspaceBridgeDirection, type WorkspaceBridgeStatus, type WorkspaceBridgeTopologySnapshot } from "@tyr-ai/contracts";
import { agentIsChannelOnlyIdentity } from "./resourceAccess";
import { chatPathForChannel } from "./routing";
import { agentStatusLabel } from "./app/workspaceUtils";

export type ChannelMemberIndex = Record<string, { agentIds: string[]; humanIds: string[] }>;

export type TopologyRow =
  | { kind: "human"; id: string; human: UserRecord; parentId?: string; shared: boolean; placementId?: string; grantSummary?: ResourceGrantSummary }
  | { kind: "machine"; id: string; machine: MachineRecord; parentId?: string; shared: boolean }
  | { kind: "agent"; id: string; agent: AgentRecord; parentId?: string; shared: boolean }
  | { kind: "channel"; id: string; channel: ChannelRecord; parentId: string; shared?: boolean }
  | { kind: "device"; id: string; device: DeviceRecord; parentId?: string; shared?: boolean };

export type TopologyNodeSource = "canvas" | "tree";

export type TopologyInspectTarget =
  | { kind: "server"; id: string }
  | { kind: "human"; id: string }
  | { kind: "machine"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "channel"; id: string }
  | { kind: "device"; id: string }
  | { kind: "workspace-bridge"; id: string };

export type TopologyNodeAction =
  | { type: "inspect"; target: TopologyInspectTarget }
  | { type: "chat"; path: string }
  | { type: "agent-dm"; agentId: string }
  | { type: "workspace-bridge"; bridgeId: string };

type TopologySnapshotInput = Pick<AppSnapshot, "currentUser" | "humans" | "machines" | "agents" | "channels" | "resourceGrantSummaries"> & Partial<Pick<AppSnapshot, "devices" | "deviceGrants" | "deviceAccessRules">>;

type TopologyInspectSnapshotInput = Pick<AppSnapshot, "currentUser" | "currentServer" | "machines" | "agents" | "channels"> & Partial<Pick<AppSnapshot, "devices" | "peerWorkspaceTopologies" | "workspaceBridges">>;

export type TopologyGraphNodeKind = "server" | "human" | "machine" | "agent" | "channel" | "device" | "group-zone" | "shared-zone" | "peer-workspace" | "workspace-panel" | "workspace-bridge";

export type TopologyGraphEdgeKind =
  | "server-human"
  | "server-machine"
  | "server-agent"
  | "server-channel"
  | "server-group-zone"
  | "group-zone-channel"
  | "machine-human"
  | "machine-agent"
  | "agent-human"
  | "channel-agent"
  | "channel-human"
  | "server-device"
  | "agent-device"
  | "server-shared"
  | "shared-agent"
  | "shared-human"
  | "agent-delegation"
  | "workspace-bridge-corridor"
  | "peer-workspace-machine"
  | "peer-workspace-agent"
  | "peer-workspace-device";

export type TopologyAgentLiveWork = {
  executions: TopologyLiveExecutionRecord[];
  activities: TopologyLiveActivityRecord[];
  totalCount: number;
  hiddenCount: number;
  attentionCount: number;
  runningCount: number;
  waitingCount: number;
};

export type TopologyDelegationLiveWork = {
  executionId: string;
  status: TopologyLiveExecutionRecord["status"];
  count: number;
};

export type TopologyEdgeCommunicationFlow = Pick<
  TopologyCommunicationFlowRecord,
  "id" | "executionId" | "chainId" | "sourceExecutionId" | "hopCount" | "tone" | "continuous" | "status" | "createdAt"
> & {
  // existing Topology edges are stored TYR -> Device -> Agent; responses traverse the same geometry backwards.
  direction: "outbound" | "inbound";
};

export type TopologyGraphNode = {
  id: string;
  kind: TopologyGraphNodeKind;
  label: string;
  subtitle: string;
  position: { x: number; y: number };
  // 记录节点所属的视觉 Workspace，供边框在默认布局和手动布局下独立计算包裹范围。
  workspacePanelId?: string;
  status?: string;
  shared: boolean;
  row?: TopologyRow;
  liveWork?: TopologyAgentLiveWork;
  bridge?: TopologyGraphBridgeMetadata;
  frame?: TopologyGraphFrame;
};

export type TopologyGraphBridgeMetadata = {
  bridgeId: string;
  status: WorkspaceBridgeStatus;
  direction: WorkspaceBridgeDirection;
  scope: string;
  permissions: string[];
  peerWorkspaceName: string;
};

export type TopologyGraphFrame = {
  width: number;
  height: number;
  tone: "local" | "peer";
};

export type TopologyGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: TopologyGraphEdgeKind;
  liveWork?: TopologyDelegationLiveWork;
  communicationFlows?: TopologyEdgeCommunicationFlow[];
  bridge?: TopologyGraphBridgeMetadata;
  path?: "straight" | "orthogonal";
};

export type TopologyGraph = {
  serverNodeId: string;
  nodes: TopologyGraphNode[];
  edges: TopologyGraphEdge[];
};

type TopologyGraphSnapshotInput = TopologySnapshotInput & {
  currentServer?: Pick<ServerRecord, "id" | "name"> | null;
} & Partial<Pick<AppSnapshot, "workspaceBridges" | "peerWorkspaceTopologies" | "workspaceBridgeTopologyEdges">>;

type PeerWorkspaceResourceColumn =
  | { kind: "machine"; key: string; width: number; machine: MachineRecord; agents: AgentRecord[] }
  | { kind: "orphan-agents"; key: string; width: number; agents: AgentRecord[] }
  | { kind: "devices"; key: string; width: number; devices: DeviceRecord[] };

type PeerWorkspaceLayout = {
  peer: WorkspaceBridgeTopologySnapshot;
  distance: number;
  columns: PeerWorkspaceResourceColumn[];
  panelWidth: number;
  panelHeight: number;
  position: { x: number; y: number };
};

const TOPOLOGY_GRAPH_NODE_SIZE = {
  defaultWidth: 260,
  workspaceLabelWidth: 260,
  agentHeight: 62,
  workspaceBridgeHeight: 74,
  agentLiveWorkHeight: 176,
  machineWidth: 300,
  groupZoneWidth: 300,
  sharedZoneWidth: 340,
  workspacePanelWidth: 520,
  peerWorkspacePanelWidth: 520,
  workspaceBridgeWidth: 260,
  horizontalGap: 40,
  machineSubtreeGap: 80
};
const TOPOLOGY_GRAPH_NODE_STEP = TOPOLOGY_GRAPH_NODE_SIZE.defaultWidth + TOPOLOGY_GRAPH_NODE_SIZE.horizontalGap;

const TOPOLOGY_GRAPH_LAYOUT = {
  server: { x: 48, y: 30 },
  localHuman: { x: 70, y: 230, gapY: 92 },
  groupZone: { x: 390, y: 230 },
  serverChannel: { x: 390, y: 350, gapY: 88 },
  serverAgent: { x: 390, y: 96, gapY: 88 },
  machine: { x: 760, y: 230, gap: TOPOLOGY_GRAPH_NODE_SIZE.machineSubtreeGap },
  agent: { offsetY: 120, gapY: 88 },
  device: { minX: 1130, y: 230, gapY: 92, offsetFromLocalRight: 70 },
  resourceGrant: { offsetX: 300, offsetY: 220, minY: 820, gap: TOPOLOGY_GRAPH_NODE_STEP },
  sharedZone: { minX: 1130, y: 230, offsetFromLocalRight: 70 },
  sharedResourceChild: { offsetY: 120, gapY: 88 },
  workspacePanel: { paddingTop: 64, paddingRight: 40, paddingBottom: 40, paddingLeft: 40, labelOffsetY: -1, minHeight: 280 },
  peerWorkspace: { offsetFromLocalRight: 160, panelGapY: 80, assistantOffsetY: 64, resourceOffsetY: 120, gapY: 92 }
};

export function topologyConfigPath(row: TopologyRow): string {
  if (row.kind === "human") return `/topology/humans/${encodeURIComponent(row.human.id)}`;
  if (row.kind === "machine") return `/topology/computers/${encodeURIComponent(row.id)}`;
  if (row.kind === "agent") return `/topology/agents/${encodeURIComponent(row.id)}`;
  if (row.kind === "device") return `/topology/devices/${encodeURIComponent(row.id)}`;
  return chatPathForChannel(row.channel);
}

export function topologyInspectTarget(row: TopologyRow): TopologyInspectTarget {
  if (row.kind === "human") return { kind: "human", id: row.human.id };
  if (row.kind === "machine") return { kind: "machine", id: row.id };
  if (row.kind === "agent") return { kind: "agent", id: row.id };
  if (row.kind === "device") return { kind: "device", id: row.id };
  return { kind: "channel", id: row.id };
}

export function topologyNodeAction(source: TopologyNodeSource, row: TopologyRow): TopologyNodeAction {
  if (source === "canvas") return { type: "inspect", target: topologyInspectTarget(row) };
  if (row.kind === "agent") return { type: "agent-dm", agentId: row.id };
  if (row.kind === "channel") return { type: "chat", path: chatPathForChannel(row.channel) };
  return { type: "inspect", target: topologyInspectTarget(row) };
}

export function topologyInspectTargetAvailable(snapshot: TopologyInspectSnapshotInput, target: TopologyInspectTarget): boolean {
  const peerTopologies = snapshot.peerWorkspaceTopologies ?? [];
  if (target.kind === "server") return target.id === (snapshot.currentServer?.id ?? "current");
  if (target.kind === "machine") {
    return snapshot.machines.some((machine) => machine.id === target.id)
      || peerTopologies.some((peer) => peer.machines.some((machine) => machine.id === target.id));
  }
  if (target.kind === "agent") {
    const localAgentVisible = snapshot.agents.some((agent) => agent.id === target.id && agentVisibleInTopology(agent, snapshot.currentUser.id));
    // Bridge 拓扑已经由服务端按双方约定投影；其中的 TYR 和 Runtime Agent 不再套用本地 Owner 可见性规则。
    const bridgeAgentAvailable = peerTopologies.some((peer) => (
      peer.assistant?.id === target.id || peer.agents.some((agent) => agent.id === target.id)
    ));
    return localAgentVisible || bridgeAgentAvailable;
  }
  if (target.kind === "device") {
    return (snapshot.devices ?? []).some((device) => device.id === target.id)
      || peerTopologies.some((peer) => (peer.devices ?? []).some((device) => device.id === target.id));
  }
  if (target.kind === "channel") return snapshot.channels.some((channel) => channel.id === target.id && channel.type === "channel");
  if (target.kind === "workspace-bridge") return (snapshot.workspaceBridges ?? []).some((bridge) => bridge.id === target.id);
  return false;
}

export function topologyRowsForSnapshot(snapshot: TopologySnapshotInput, channelMemberIndex: ChannelMemberIndex = {}): TopologyRow[] {
  const rows: TopologyRow[] = [];
  const machines = snapshot.machines;
  const machinesById = new Map(machines.map((machine) => [machine.id, machine]));
  const latestAgentById = new Map(snapshot.agents.map((agent) => [agent.id, agent]));

  for (const machine of machines) {
    rows.push({ kind: "machine", id: machine.id, machine, shared: Boolean(machine.access?.shared) });
    for (const embeddedAgent of machine.agents ?? snapshot.agents.filter((item) => item.machineId === machine.id)) {
      // Realtime activity patches may update top-level agents before the next full machine snapshot arrives.
      const agent = latestAgentById.get(embeddedAgent.id) ?? embeddedAgent;
      // Topology 是当前用户的本地执行面，跨用户共享 Agent 不进入画布或左侧资源树。
      if (!agentVisibleInTopology(agent, snapshot.currentUser.id) || isCommunicationAgent(agent)) continue;
      rows.push({ kind: "agent", id: agent.id, agent, parentId: machine.id, shared: false });
    }
  }

  for (const agent of snapshot.agents) {
    if (!agentVisibleInTopology(agent, snapshot.currentUser.id)) continue;
    // Communication Agent is a server-hosted identity, not a runtime child of a Computer.
    if (isCommunicationAgent(agent)) {
      rows.push({ kind: "agent", id: agent.id, agent, parentId: "server", shared: false });
      continue;
    }
    if (agent.machineId && machinesById.has(agent.machineId)) continue;
    // 自有但暂时缺失 Computer 的 Agent 仍属于本地 Workspace，不应误入 Shared resources。
    rows.push({ kind: "agent", id: agent.id, agent, parentId: "server", shared: false });
  }

  for (const device of snapshot.devices ?? []) {
    rows.push({ kind: "device", id: device.id, device, parentId: "devices", shared: false });
  }

  return rows;
}

/** Adds Bridge resources only to the topology interaction surface. The regular
 * workspace sidebar remains scoped to the local Workspace. */
export function topologyOperationalSnapshot(snapshot: AppSnapshot): AppSnapshot {
  const machines = new Map(snapshot.machines.map((machine) => [machine.id, machine]));
  const agents = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const devices = new Map(snapshot.devices.map((device) => [device.id, device]));
  for (const peer of snapshot.peerWorkspaceTopologies ?? []) {
    for (const agent of [...peer.agents, ...(peer.assistant ? [peer.assistant] : [])]) agents.set(agent.id, agent);
    for (const machine of peer.machines) {
      const projected = machine as AppSnapshot["machines"][number];
      machines.set(machine.id, {
        ...projected,
        latestDaemonVersion: projected.latestDaemonVersion ?? machine.daemonVersion,
        runtimes: projected.runtimes ?? [],
        agents: projected.agents ?? peer.agents.filter((agent) => agent.machineId === machine.id)
      });
    }
    for (const device of peer.devices ?? []) devices.set(device.id, device);
  }
  return { ...snapshot, machines: [...machines.values()], agents: [...agents.values()], devices: [...devices.values()] };
}

export function agentVisibleInTopology(agent: AgentRecord, currentUserId: string): boolean {
  if (isCommunicationAgent(agent)) return true;
  if (agentIsChannelOnlyIdentity(agent) || agent.access?.shared) return false;
  return agent.ownerUserId === currentUserId;
}

function topologyAgentSubtitle(agent: AgentRecord, context: "status" | "shared"): string {
  if (isCommunicationAgent(agent)) return "Communication / server-hosted";
  const runtime = agent.runtime ?? "No runtime";
  return context === "shared" ? `${runtime} / shared` : `${runtime} / ${agentStatusLabel(agent.status)}`;
}

function topologyWorkspaceLabel(name: string | null | undefined): string {
  // Workspace 名称属于用户数据；拓扑原样展示，避免给历史名称再次拼接产品术语。
  return name?.trim() || "Current workspace";
}

function peerWorkspaceBaseLayout(peer: WorkspaceBridgeTopologySnapshot): PeerWorkspaceLayout {
  const runtimeAgents = peer.agents.filter((agent) => !isCommunicationAgent(agent));
  const renderedAgentIds = new Set<string>();
  const columns: PeerWorkspaceResourceColumn[] = peer.machines.map((machine) => {
    const agents = runtimeAgents.filter((agent) => agent.machineId === machine.id);
    agents.forEach((agent) => renderedAgentIds.add(agent.id));
    return {
      kind: "machine",
      key: `machine:${machine.id}`,
      width: TOPOLOGY_GRAPH_NODE_SIZE.machineWidth,
      machine,
      agents
    };
  });
  const orphanAgents = runtimeAgents.filter((agent) => !renderedAgentIds.has(agent.id));
  if (orphanAgents.length > 0) {
    columns.push({ kind: "orphan-agents", key: "orphan-agents", width: TOPOLOGY_GRAPH_NODE_SIZE.defaultWidth, agents: orphanAgents });
  }
  if ((peer.devices?.length ?? 0) > 0) {
    columns.push({ kind: "devices", key: "devices", width: TOPOLOGY_GRAPH_NODE_SIZE.defaultWidth, devices: peer.devices ?? [] });
  }

  const resourceWidth = columns.reduce((total, column) => total + column.width, 0)
    + Math.max(0, columns.length - 1) * TOPOLOGY_GRAPH_NODE_SIZE.machineSubtreeGap;
  const panelWidth = Math.max(
    TOPOLOGY_GRAPH_NODE_SIZE.peerWorkspacePanelWidth,
    resourceWidth + TOPOLOGY_GRAPH_LAYOUT.workspacePanel.paddingLeft + TOPOLOGY_GRAPH_LAYOUT.workspacePanel.paddingRight
  );
  const columnHeights = columns.map((column) => {
    if (column.kind === "machine") {
      const agentsHeight = column.agents.length > 0
        ? TOPOLOGY_GRAPH_LAYOUT.agent.offsetY + TOPOLOGY_GRAPH_NODE_SIZE.agentHeight + (column.agents.length - 1) * TOPOLOGY_GRAPH_LAYOUT.agent.gapY
        : 0;
      return Math.max(70, agentsHeight);
    }
    if (column.kind === "orphan-agents") {
      return TOPOLOGY_GRAPH_NODE_SIZE.agentHeight + (column.agents.length - 1) * TOPOLOGY_GRAPH_LAYOUT.agent.gapY;
    }
    return 70 + (column.devices.length - 1) * TOPOLOGY_GRAPH_LAYOUT.peerWorkspace.gapY;
  });
  const resourceHeight = columnHeights.length > 0 ? Math.max(...columnHeights) : 0;
  const resourceTopOffset = TOPOLOGY_GRAPH_LAYOUT.peerWorkspace.assistantOffsetY + TOPOLOGY_GRAPH_LAYOUT.peerWorkspace.resourceOffsetY;
  const panelHeight = Math.max(
    TOPOLOGY_GRAPH_LAYOUT.workspacePanel.minHeight,
    resourceTopOffset + resourceHeight + TOPOLOGY_GRAPH_LAYOUT.workspacePanel.paddingBottom
  );

  return {
    peer,
    distance: Math.max(1, peer.distance ?? 1),
    columns,
    panelWidth,
    panelHeight,
    position: { x: 0, y: 0 }
  };
}

export function topologyGraphForSnapshot(snapshot: TopologyGraphSnapshotInput, channelMemberIndex: ChannelMemberIndex = {}): TopologyGraph {
  const rows = topologyRowsForSnapshot(snapshot, channelMemberIndex);
  const serverId = snapshot.currentServer?.id ?? "current";
  const serverNodeId = `server:${serverId}`;
  // Workspace 只标识浅绿色边界，不再把用户保存的名称改写成额外的拓扑节点名。
  const workspaceLabel = topologyWorkspaceLabel(snapshot.currentServer?.name);
  const workspaceOwner = snapshot.humans.find((human) => human.serverRole === "owner") ?? snapshot.currentUser;
  const nodes: TopologyGraphNode[] = [{
    id: serverNodeId,
    kind: "server",
    label: workspaceLabel,
    subtitle: "Workspace",
    position: TOPOLOGY_GRAPH_LAYOUT.server,
    workspacePanelId: "workspace-panel:local",
    shared: false
  }];
  const edges: TopologyGraphEdge[] = [];
  const humanRows = rows.filter((row): row is Extract<TopologyRow, { kind: "human" }> => row.kind === "human");
  const machineRows = rows.filter((row): row is Extract<TopologyRow, { kind: "machine" }> => row.kind === "machine");
  const agentRows = rows.filter((row): row is Extract<TopologyRow, { kind: "agent" }> => row.kind === "agent");
  const channelRows = rows.filter((row): row is Extract<TopologyRow, { kind: "channel" }> => row.kind === "channel");
  const deviceRows = rows.filter((row): row is Extract<TopologyRow, { kind: "device" }> => row.kind === "device");
  const sharedHumanRows = humanRows.filter((row) => row.shared && row.parentId === "shared");
  const resourceHumanRows = humanRows.filter((row) => row.shared && row.parentId && row.parentId !== "shared");
  // Workspace owner 是 workspace 的属性，收进主节点，避免主画布重复展示一个 owner box。
  const localHumanRows = humanRows.filter((row) => !row.shared && row.human.id !== workspaceOwner.id);
  const serverAgentRows = agentRows.filter((row) => row.parentId === "server");
  const sharedAgentRows = agentRows.filter((row) => row.parentId === "shared");
  const localAgentRows = agentRows.filter((row) => row.parentId && row.parentId !== "shared" && row.parentId !== "server");
  const serverChannelRows = channelRows.filter((row) => row.parentId === "server");
  const sharedZoneNeeded = sharedAgentRows.length > 0 || sharedHumanRows.length > 0;
  const seenNodeIds = new Set(nodes.map((node) => node.id));
  const seenEdgeIds = new Set<string>();
  const nodePositions = new Map(nodes.map((node) => [node.id, node.position]));
  const localAgentRowsByMachine = groupRowsByParent(localAgentRows);
  const resourceHumanRowsByParent = groupRowsByParent(resourceHumanRows);
  const channelNodeIdByChannelId = new Map<string, string>();
  const agentNodeIdByAgentId = new Map<string, string>();
  const deviceNodeIdByDeviceId = new Map<string, string>();
  const groupZoneNodeId = "group-zone:group-chats";
  const localAssistantRow = serverAgentRows.find((row) => isCommunicationAgent(row.agent));
  const localAssistantNodeId = localAssistantRow ? `agent:${localAssistantRow.id}` : undefined;
  const assistantChildNodeIds = new Set<string>();

  const machineSubtreeWidths = new Map(machineRows.map((row) => {
    return [row.id, TOPOLOGY_GRAPH_NODE_SIZE.machineWidth] as const;
  }));
  const machinePositions = anchoredSubtreePositions(
    machineRows,
    (row) => row.id,
    TOPOLOGY_GRAPH_LAYOUT.machine.x,
    TOPOLOGY_GRAPH_LAYOUT.machine.y,
    (row) => machineSubtreeWidths.get(row.id) ?? TOPOLOGY_GRAPH_NODE_SIZE.machineWidth,
    TOPOLOGY_GRAPH_NODE_SIZE.machineWidth,
    TOPOLOGY_GRAPH_LAYOUT.machine.gap
  );
  const nodeWidths = new Map(nodes.map((node) => [node.id, topologyGraphNodeWidth(node.kind)]));

  function addNode(node: TopologyGraphNode) {
    if (seenNodeIds.has(node.id)) return;
    seenNodeIds.add(node.id);
    // 普通本地资源默认属于本地 Workspace；Bridge 和边框自身必须留在 Workspace 外。
    const nextNode = node.kind === "workspace-panel" || node.kind === "workspace-bridge" || node.workspacePanelId
      ? node
      : { ...node, workspacePanelId: "workspace-panel:local" };
    nodes.push(nextNode);
    nodePositions.set(nextNode.id, nextNode.position);
    nodeWidths.set(nextNode.id, topologyGraphNodeWidth(nextNode.kind));
  }

  function addEdge(source: string, target: string, kind: TopologyGraphEdgeKind, bridge?: TopologyGraphBridgeMetadata, path?: TopologyGraphEdge["path"]) {
    const id = `${source}->${target}:${kind}`;
    if (seenEdgeIds.has(id)) return;
    seenEdgeIds.add(id);
    edges.push({ id, source, target, kind, bridge, path });
  }

  function addAssistantEdge(target: string, kind: TopologyGraphEdgeKind) {
    // TYR 是 workspace 内唯一一级通信入口；缺少该身份时不把 Workspace 伪装成路由节点。
    if (!localAssistantNodeId || target === localAssistantNodeId) return;
    assistantChildNodeIds.add(target);
    addEdge(localAssistantNodeId, target, kind);
  }

  function humanNodeId(row: Extract<TopologyRow, { kind: "human" }>): string {
    return `human:${row.placementId ?? row.id}`;
  }

  function channelNodeId(row: Extract<TopologyRow, { kind: "channel" }>): string {
    return `channel:${row.id}`;
  }

  function resourceParentNodeId(parentId: string): string {
    if (parentId.startsWith("agent:")) return parentId;
    if (parentId.startsWith("channel:")) {
      const channelId = parentId.slice("channel:".length);
      return channelNodeIdByChannelId.get(channelId) ?? parentId;
    }
    return `machine:${parentId}`;
  }

  if (serverChannelRows.length > 0) {
    addNode({
      id: groupZoneNodeId,
      kind: "group-zone",
      label: "Conversations",
      subtitle: `${serverChannelRows.length} conversation ${serverChannelRows.length === 1 ? "record" : "records"}`,
      position: TOPOLOGY_GRAPH_LAYOUT.groupZone,
      shared: false
    });
    addAssistantEdge(groupZoneNodeId, "server-group-zone");
  }

  serverChannelRows.forEach((row, index) => {
    const nodeId = channelNodeId(row);
    if (!channelNodeIdByChannelId.has(row.id)) channelNodeIdByChannelId.set(row.id, nodeId);
    addNode({
      id: nodeId,
      kind: "channel",
      label: row.channel.displayName || row.channel.name,
      subtitle: "Conversation",
      position: verticalStackPosition(index, TOPOLOGY_GRAPH_LAYOUT.serverChannel.x, TOPOLOGY_GRAPH_LAYOUT.serverChannel.y, TOPOLOGY_GRAPH_LAYOUT.serverChannel.gapY),
      shared: Boolean(row.shared),
      row
    });
    addEdge(groupZoneNodeId, nodeId, "group-zone-channel");
  });

  serverAgentRows.forEach((row, index) => {
    const nodeId = `agent:${row.id}`;
    addNode({
      id: nodeId,
      kind: "agent",
      label: row.agent.displayName,
      subtitle: topologyAgentSubtitle(row.agent, "status"),
      position: verticalStackPosition(index, TOPOLOGY_GRAPH_LAYOUT.serverAgent.x, TOPOLOGY_GRAPH_LAYOUT.serverAgent.y, TOPOLOGY_GRAPH_LAYOUT.serverAgent.gapY),
      status: row.agent.status,
      shared: false,
      row
    });
    agentNodeIdByAgentId.set(row.id, nodeId);
    addAssistantEdge(nodeId, "server-agent");
  });

  machineRows.forEach((row, index) => {
    const nodeId = `machine:${row.id}`;
    addNode({
      id: nodeId,
      kind: "machine",
      label: row.machine.name,
      subtitle: row.machine.hostname,
      position: machinePositions.get(row.id) ?? { x: TOPOLOGY_GRAPH_LAYOUT.machine.x + index * (TOPOLOGY_GRAPH_NODE_SIZE.machineWidth + TOPOLOGY_GRAPH_LAYOUT.machine.gap), y: TOPOLOGY_GRAPH_LAYOUT.machine.y },
      status: row.machine.status,
      shared: row.shared,
      row
    });
    addAssistantEdge(nodeId, "server-machine");
  });

  machineRows.forEach((machineRow) => {
    const parentPosition = nodePositions.get(`machine:${machineRow.id}`);
    if (!parentPosition) return;
    const rowsForMachine = localAgentRowsByMachine.get(machineRow.id) ?? [];
    rowsForMachine.forEach((row, index) => {
      const nodeId = `agent:${row.id}`;
      addNode({
        id: nodeId,
        kind: "agent",
        label: row.agent.displayName,
        subtitle: topologyAgentSubtitle(row.agent, "status"),
        // Agents stack below their Computer so adding runtimes grows downward instead of widening the whole topology.
        position: verticalChildPosition(parentPosition, TOPOLOGY_GRAPH_NODE_SIZE.machineWidth, TOPOLOGY_GRAPH_NODE_SIZE.defaultWidth, index, TOPOLOGY_GRAPH_LAYOUT.agent.offsetY, TOPOLOGY_GRAPH_LAYOUT.agent.gapY),
        status: row.agent.status,
        shared: row.shared,
        row
      });
      agentNodeIdByAgentId.set(row.id, nodeId);
      addEdge(`machine:${row.parentId}`, nodeId, "machine-agent");
    });
  });

  addChannelAgentMembershipEdges();

  for (const [parentId, rowsForParent] of resourceHumanRowsByParent) {
    const sourceNodeId = resourceParentNodeId(parentId);
    const sourcePosition = nodePositions.get(sourceNodeId);
    const sourceWidth = nodeWidths.get(sourceNodeId) ?? TOPOLOGY_GRAPH_NODE_SIZE.defaultWidth;
    const grantY = sourcePosition ? Math.max(sourcePosition.y + TOPOLOGY_GRAPH_LAYOUT.resourceGrant.offsetY, TOPOLOGY_GRAPH_LAYOUT.resourceGrant.minY) : TOPOLOGY_GRAPH_LAYOUT.resourceGrant.minY;
    const grantCenterX = sourcePosition ? sourcePosition.x + sourceWidth / 2 + TOPOLOGY_GRAPH_LAYOUT.resourceGrant.offsetX : TOPOLOGY_GRAPH_LAYOUT.sharedZone.minX;
    rowsForParent.forEach((row, index) => {
      const nodeId = humanNodeId(row);
      addNode({
        id: nodeId,
        kind: "human",
        label: row.human.displayName,
        subtitle: row.grantSummary ? `Shared: ${row.grantSummary.scopes.join(", ")}` : "Shared human",
        // Resource-level humans sit near their granted resource but below the shared zone branch to avoid crossing the primary tree.
        position: spreadFixedWidthPosition(index, rowsForParent.length, grantCenterX, grantY, TOPOLOGY_GRAPH_NODE_SIZE.defaultWidth, TOPOLOGY_GRAPH_LAYOUT.resourceGrant.gap),
        shared: true,
        row
      });
      if (parentId.startsWith("agent:")) addEdge(sourceNodeId, nodeId, "agent-human");
      else if (parentId.startsWith("channel:")) addEdge(sourceNodeId, nodeId, "channel-human");
      else addEdge(sourceNodeId, nodeId, "machine-human");
    });
  }

  if (sharedZoneNeeded) {
    const sharedNodeId = "shared-zone:shared-zone";
    const sharedZonePosition = {
      x: Math.max(TOPOLOGY_GRAPH_LAYOUT.sharedZone.minX, graphRightEdge(nodes) + TOPOLOGY_GRAPH_LAYOUT.sharedZone.offsetFromLocalRight),
      y: TOPOLOGY_GRAPH_LAYOUT.sharedZone.y
    };
    const sharedCenterX = sharedZonePosition.x + TOPOLOGY_GRAPH_NODE_SIZE.sharedZoneWidth / 2;
    addNode({
      id: sharedNodeId,
      kind: "shared-zone",
      label: "Resources shared with this workspace",
      subtitle: "Explicit grants only · Bridge workspaces stay separate",
      position: sharedZonePosition,
      shared: true
    });
    addAssistantEdge(sharedNodeId, "server-shared");
    const sharedChildX = sharedCenterX - TOPOLOGY_GRAPH_NODE_SIZE.defaultWidth / 2;
    const sharedChildStartY = sharedZonePosition.y + TOPOLOGY_GRAPH_LAYOUT.sharedResourceChild.offsetY;
    sharedHumanRows.forEach((row, index) => {
      const nodeId = humanNodeId(row);
      addNode({
        id: nodeId,
        kind: "human",
        label: row.human.displayName,
        subtitle: "Shared human",
        position: verticalStackPosition(index, sharedChildX, sharedChildStartY, TOPOLOGY_GRAPH_LAYOUT.sharedResourceChild.gapY),
        shared: true,
        row
      });
      addEdge(sharedNodeId, nodeId, "shared-human");
    });
    sharedAgentRows.forEach((row, index) => {
      const stackIndex = sharedHumanRows.length + index;
      const nodeId = `agent:${row.id}`;
      addNode({
        id: nodeId,
        kind: "agent",
        label: row.agent.displayName,
        subtitle: topologyAgentSubtitle(row.agent, "shared"),
        // Compatibility-only shared resources use one visual stack when a shared Computer requires the zone.
        position: verticalStackPosition(stackIndex, sharedChildX, sharedChildStartY, TOPOLOGY_GRAPH_LAYOUT.sharedResourceChild.gapY),
        status: row.agent.status,
        shared: true,
        row
      });
      agentNodeIdByAgentId.set(row.id, nodeId);
      addEdge(sharedNodeId, nodeId, "shared-agent");
    });
    addChannelAgentMembershipEdges();
  }

  if (deviceRows.length > 0) {
    const deviceX = Math.max(TOPOLOGY_GRAPH_LAYOUT.device.minX, graphRightEdge(nodes) + TOPOLOGY_GRAPH_LAYOUT.device.offsetFromLocalRight);
    deviceRows.forEach((row, index) => {
      const nodeId = `device:${row.id}`;
      deviceNodeIdByDeviceId.set(row.id, nodeId);
      addNode({
        id: nodeId,
        kind: "device",
        label: row.device.displayName,
        subtitle: `${row.device.platform} / ${row.device.status}`,
        position: verticalStackPosition(index, deviceX, TOPOLOGY_GRAPH_LAYOUT.device.y, TOPOLOGY_GRAPH_LAYOUT.device.gapY),
        status: row.device.status,
        shared: false,
        row
      });
      addAssistantEdge(nodeId, "server-device");
    });
    addAgentDeviceGrantEdges();
  }

  if (localAssistantNodeId) {
    const assistantNode = nodes.find((node) => node.id === localAssistantNodeId);
    const directChildren = [...assistantChildNodeIds]
      .map((nodeId) => nodes.find((node) => node.id === nodeId))
      .filter((node): node is TopologyGraphNode => Boolean(node));
    if (assistantNode && directChildren.length > 0) {
      const left = Math.min(...directChildren.map((node) => node.position.x));
      const right = Math.max(...directChildren.map((node) => node.position.x + topologyGraphNodeWidth(node.kind)));
      // 默认位置始终以一级资源的整体边界为准，数据增减后 TYR 仍保持视觉居中。
      assistantNode.position = {
        ...assistantNode.position,
        x: Math.round((left + right - TOPOLOGY_GRAPH_NODE_SIZE.defaultWidth) / 2)
      };
      nodePositions.set(assistantNode.id, assistantNode.position);
    }
  }

  const localWorkspacePanelNode = workspacePanelNode({
    id: "workspace-panel:local",
    label: "Local workspace",
    subtitle: "Workspace boundary",
    tone: "local",
    nodes
  });
  const peerWorkspacePanelNodes: TopologyGraphNode[] = [];
  const localWorkspacePanelRight = localWorkspacePanelNode.position.x + (localWorkspacePanelNode.frame?.width ?? TOPOLOGY_GRAPH_NODE_SIZE.workspacePanelWidth);
  const bridgePanelGap = TOPOLOGY_GRAPH_NODE_SIZE.workspaceBridgeWidth + 80;
  const peerStartX = Math.max(
    graphRightEdge(nodes) + TOPOLOGY_GRAPH_LAYOUT.peerWorkspace.offsetFromLocalRight,
    localWorkspacePanelRight + bridgePanelGap,
    1280
  );
  const directBridgeById = new Map((snapshot.workspaceBridges ?? []).map((bridge) => [bridge.id, bridge]));
  const peerLayouts = (snapshot.peerWorkspaceTopologies ?? [])
    .filter((peer) => {
      const bridge = directBridgeById.get(peer.bridgeId);
      // Bootstrap 是当前 Workspace 的连接真源；旧缓存中的递归节点不能重新进入画布。
      const directParent = !peer.parentWorkspaceId || peer.parentWorkspaceId === snapshot.currentServer?.id;
      const directDistance = peer.distance === undefined || peer.distance === 1;
      return Boolean(bridge && bridge.status === "active" && directParent && directDistance);
    })
    .map(peerWorkspaceBaseLayout)
    .sort((left, right) => left.distance - right.distance);
  const peerLayoutByWorkspaceId = new Map<string, PeerWorkspaceLayout>();
  let previousLayerRight = localWorkspacePanelRight;
  const maxPeerDistance = peerLayouts.reduce((maximum, layout) => Math.max(maximum, layout.distance), 0);

  for (let distance = 1; distance <= maxPeerDistance; distance += 1) {
    const layerLayouts = peerLayouts.filter((layout) => layout.distance === distance);
    if (layerLayouts.length === 0) continue;
    const layerX = distance === 1 ? peerStartX : previousLayerRight + bridgePanelGap;
    let layerY = localWorkspacePanelNode.position.y;
    for (const layout of layerLayouts) {
      const parentLayout = layout.peer.parentWorkspaceId ? peerLayoutByWorkspaceId.get(layout.peer.parentWorkspaceId) : undefined;
      // 同层 Workspace 纵向排列；有父 Workspace 时尽量保持首个子节点与父节点同高，再避让前一个面板。
      const preferredY = parentLayout?.position.y ?? localWorkspacePanelNode.position.y;
      layout.position = { x: layerX, y: Math.max(layerY, preferredY) };
      peerLayoutByWorkspaceId.set(layout.peer.workspace.id, layout);
      layerY = layout.position.y + layout.panelHeight + TOPOLOGY_GRAPH_LAYOUT.peerWorkspace.panelGapY;
    }
    previousLayerRight = layerX + Math.max(...layerLayouts.map((layout) => layout.panelWidth));
  }

  const assistantNodeIdByWorkspaceId = new Map<string, string>();
  if (snapshot.currentServer?.id && localAssistantNodeId) {
    assistantNodeIdByWorkspaceId.set(snapshot.currentServer.id, localAssistantNodeId);
  }
  peerLayouts.forEach((layout) => {
    const peer = layout.peer;
    const bridge = directBridgeById.get(peer.bridgeId);
    if (!bridge) return;
    const peerPanelId = `workspace-panel:${peer.workspace.id}`;
    const workspaceNodeId = `peer-workspace:${peer.workspace.id}`;
    const peerPanelPosition = layout.position;
    const assistantY = peerPanelPosition.y + TOPOLOGY_GRAPH_LAYOUT.peerWorkspace.assistantOffsetY;
    const bridgeMetadata: TopologyGraphBridgeMetadata = {
      bridgeId: bridge.id,
      status: bridge.status,
      direction: bridge.direction,
      scope: bridge.scope,
      permissions: [...bridge.permissions],
      peerWorkspaceName: bridge.peerWorkspace?.name ?? peer.workspace.name
    };
    peerWorkspacePanelNodes.push({
      id: peerPanelId,
      kind: "workspace-panel",
      label: peer.workspace.name,
      subtitle: "External workspace boundary",
      position: peerPanelPosition,
      shared: true,
      frame: {
        width: layout.panelWidth,
        height: layout.panelHeight,
        tone: "peer"
      }
    });
    addNode({
      id: workspaceNodeId,
      kind: "peer-workspace",
      label: topologyWorkspaceLabel(peer.workspace.name),
      subtitle: "Workspace",
      position: {
        x: peerPanelPosition.x + Math.round((layout.panelWidth - TOPOLOGY_GRAPH_NODE_SIZE.workspaceLabelWidth) / 2),
        y: peerPanelPosition.y + TOPOLOGY_GRAPH_LAYOUT.workspacePanel.labelOffsetY
      },
      workspacePanelId: peerPanelId,
      shared: true
    });
    if (peer.assistant) {
      const assistantNodeId = `peer-agent:${peer.assistant.id}`;
      assistantNodeIdByWorkspaceId.set(peer.workspace.id, assistantNodeId);
      const assistantPosition = {
        x: Math.round(peerPanelPosition.x + (layout.panelWidth - TOPOLOGY_GRAPH_NODE_SIZE.defaultWidth) / 2),
        y: assistantY
      };
      addNode({
        id: assistantNodeId,
        kind: "agent",
        label: peer.assistant.displayName,
        subtitle: "Communication / peer workspace",
        position: assistantPosition,
        workspacePanelId: peerPanelId,
        status: peer.assistant.status,
        shared: true,
        row: { kind: "agent", id: peer.assistant.id, agent: peer.assistant, parentId: "server", shared: true }
      });
      const sourceAssistantNodeId = assistantNodeIdByWorkspaceId.get(peer.parentWorkspaceId ?? snapshot.currentServer?.id ?? "") ?? localAssistantNodeId;
      if (sourceAssistantNodeId) {
        const sourceAssistantPosition = nodePositions.get(sourceAssistantNodeId);
        const sourcePeerLayout = peer.parentWorkspaceId ? peerLayoutByWorkspaceId.get(peer.parentWorkspaceId) : undefined;
        const sourcePanelRight = sourcePeerLayout
          ? sourcePeerLayout.position.x + sourcePeerLayout.panelWidth
          : localWorkspacePanelRight;
        const bridgeCenterX = Math.round((sourcePanelRight + peerPanelPosition.x) / 2);
        const peerAssistantCenterY = assistantPosition.y + TOPOLOGY_GRAPH_NODE_SIZE.agentHeight / 2;
        const sourceAssistantCenterY = sourceAssistantPosition
          ? sourceAssistantPosition.y + TOPOLOGY_GRAPH_NODE_SIZE.agentHeight / 2
          : peerAssistantCenterY;
        const bridgeNodeId = `workspace-bridge:${bridge.id}`;
        addNode({
          id: bridgeNodeId,
          kind: "workspace-bridge",
          label: "Workspace Bridge",
          subtitle: `${bridge.status} / ${bridge.scope}`,
          position: {
            x: bridgeCenterX - TOPOLOGY_GRAPH_NODE_SIZE.workspaceBridgeWidth / 2,
            y: peerAssistantCenterY - TOPOLOGY_GRAPH_NODE_SIZE.workspaceBridgeHeight / 2
          },
          status: bridge.status,
          shared: true,
          bridge: bridgeMetadata
        });
        // 首个 peer 保持水平通信脊线；后续 peer 在 panel 间隙内折线下行，避免对角线穿过 Workspace。
        const localBridgePath = sourceAssistantCenterY === peerAssistantCenterY ? "straight" : "orthogonal";
        addEdge(sourceAssistantNodeId, bridgeNodeId, "workspace-bridge-corridor", bridgeMetadata, localBridgePath);
        addEdge(bridgeNodeId, assistantNodeId, "workspace-bridge-corridor", bridgeMetadata, "straight");
      }
      const resourceY = assistantPosition.y + TOPOLOGY_GRAPH_LAYOUT.peerWorkspace.resourceOffsetY;
      const resourceWidth = layout.columns.reduce((total, column) => total + column.width, 0)
        + Math.max(0, layout.columns.length - 1) * TOPOLOGY_GRAPH_NODE_SIZE.machineSubtreeGap;
      let columnX = Math.round(peerPanelPosition.x + (layout.panelWidth - resourceWidth) / 2);

      for (const column of layout.columns) {
        if (column.kind === "machine") {
          const machine = column.machine;
          const machineNodeId = `peer-machine:${machine.id}`;
          const machinePosition = {
            x: Math.round(columnX + (column.width - TOPOLOGY_GRAPH_NODE_SIZE.machineWidth) / 2),
            y: resourceY
          };
          addNode({
            id: machineNodeId,
            kind: "machine",
            label: machine.name,
            subtitle: `${machine.hostname || "peer device"} / Bridge full access`,
            position: machinePosition,
            workspacePanelId: peerPanelId,
            status: machine.status,
            shared: true,
            row: { kind: "machine", id: machine.id, machine, shared: true }
          });
          addEdge(assistantNodeId, machineNodeId, "peer-workspace-machine");
          column.agents.forEach((agent, index) => {
            const agentNodeId = `agent:${agent.id}`;
            addNode({
              id: agentNodeId,
              kind: "agent",
              label: agent.displayName,
              subtitle: `${agent.runtime ?? "No runtime"} / ${agentStatusLabel(agent.status)}`,
              position: verticalChildPosition(machinePosition, TOPOLOGY_GRAPH_NODE_SIZE.machineWidth, TOPOLOGY_GRAPH_NODE_SIZE.defaultWidth, index, TOPOLOGY_GRAPH_LAYOUT.agent.offsetY, TOPOLOGY_GRAPH_LAYOUT.agent.gapY),
              workspacePanelId: peerPanelId,
              status: agent.status,
              shared: true,
              row: { kind: "agent", id: agent.id, agent, parentId: machine.id, shared: true }
            });
            agentNodeIdByAgentId.set(agent.id, agentNodeId);
            addEdge(machineNodeId, agentNodeId, "peer-workspace-agent");
          });
        } else if (column.kind === "orphan-agents") {
          column.agents.forEach((agent, index) => {
            const agentNodeId = `agent:${agent.id}`;
            addNode({
              id: agentNodeId,
              kind: "agent",
              label: agent.displayName,
              subtitle: `${agent.runtime ?? "No runtime"} / ${agentStatusLabel(agent.status)}`,
              position: verticalStackPosition(index, columnX, resourceY, TOPOLOGY_GRAPH_LAYOUT.agent.gapY),
              workspacePanelId: peerPanelId,
              status: agent.status,
              shared: true,
              row: { kind: "agent", id: agent.id, agent, parentId: "server", shared: true }
            });
            agentNodeIdByAgentId.set(agent.id, agentNodeId);
            addEdge(assistantNodeId, agentNodeId, "peer-workspace-agent");
          });
        } else {
          column.devices.forEach((device, index) => {
            const deviceNodeId = `device:${device.id}`;
            addNode({
              id: deviceNodeId,
              kind: "device",
              label: device.displayName,
              subtitle: `${device.platform} / ${device.status}`,
              position: verticalStackPosition(index, columnX, resourceY, TOPOLOGY_GRAPH_LAYOUT.peerWorkspace.gapY),
              workspacePanelId: peerPanelId,
              status: device.status,
              shared: true,
              row: { kind: "device", id: device.id, device, parentId: "devices", shared: true }
            });
            deviceNodeIdByDeviceId.set(device.id, deviceNodeId);
            addEdge(assistantNodeId, deviceNodeId, "peer-workspace-device");
          });
        }
        columnX += column.width + TOPOLOGY_GRAPH_NODE_SIZE.machineSubtreeGap;
      }
    }
  });

  addNode(localWorkspacePanelNode);
  peerWorkspacePanelNodes.forEach(addNode);

  return { serverNodeId, nodes: topologyGraphNodesWithWorkspaceFrames(nodes), edges };

  function addChannelAgentMembershipEdges() {
    for (const row of serverChannelRows) {
      const channelNode = channelNodeIdByChannelId.get(row.id);
      if (!channelNode) continue;
      for (const agentId of channelMemberIndex[row.id]?.agentIds ?? []) {
        const agentNode = agentNodeIdByAgentId.get(agentId);
        if (agentNode) addEdge(channelNode, agentNode, "channel-agent");
      }
    }
  }

  function addAgentDeviceGrantEdges() {
    for (const rule of snapshot.deviceAccessRules ?? snapshot.deviceGrants ?? []) {
      if (!activeDeviceGrant(rule)) continue;
      const sourceNodeId = agentNodeIdByAgentId.get(rule.agentId);
      const targetNodeId = deviceNodeIdByDeviceId.get(rule.deviceId);
      if (sourceNodeId && targetNodeId) addEdge(sourceNodeId, targetNodeId, "agent-device");
    }
  }
}

function activeDeviceGrant(grant: DeviceGrantRecord): boolean {
  if (grant.status !== "active") return false;
  return !grant.expiresAt || new Date(grant.expiresAt).getTime() > Date.now();
}

function rowWidth(total: number, nodeWidth: number, gap: number): number {
  if (total <= 0) return 0;
  return nodeWidth + (total - 1) * gap;
}

function spreadFixedWidthPosition(index: number, total: number, centerX: number, y: number, nodeWidth: number, gap: number): { x: number; y: number } {
  const left = centerX - rowWidth(total, nodeWidth, gap) / 2 + index * gap;
  return { x: Math.round(left), y };
}

function anchoredSubtreePositions<T>(items: T[], idForItem: (item: T) => string, leftX: number, y: number, subtreeWidthForItem: (item: T) => number, nodeWidth: number, gap: number): Map<string, { x: number; y: number }> {
  const widths = items.map((item) => Math.max(nodeWidth, subtreeWidthForItem(item)));
  let cursor = leftX;
  const positions = new Map<string, { x: number; y: number }>();

  items.forEach((item, index) => {
    const width = widths[index];
    positions.set(idForItem(item), { x: Math.round(cursor + (width - nodeWidth) / 2), y });
    cursor += width + gap;
  });

  return positions;
}

function verticalStackPosition(index: number, x: number, y: number, gapY: number): { x: number; y: number } {
  return { x, y: y + index * gapY };
}

function verticalChildPosition(parentPosition: { x: number; y: number }, parentWidth: number, childWidth: number, index: number, offsetY: number, gapY: number): { x: number; y: number } {
  return verticalStackPosition(index, Math.round(parentPosition.x + (parentWidth - childWidth) / 2), parentPosition.y + offsetY, gapY);
}

function topologyGraphNodeWidth(kind: TopologyGraphNodeKind): number {
  if (kind === "server") return TOPOLOGY_GRAPH_NODE_SIZE.workspaceLabelWidth;
  if (kind === "peer-workspace") return TOPOLOGY_GRAPH_NODE_SIZE.workspaceLabelWidth;
  if (kind === "machine") return TOPOLOGY_GRAPH_NODE_SIZE.machineWidth;
  if (kind === "group-zone") return TOPOLOGY_GRAPH_NODE_SIZE.groupZoneWidth;
  if (kind === "shared-zone") return TOPOLOGY_GRAPH_NODE_SIZE.sharedZoneWidth;
  if (kind === "workspace-panel") return TOPOLOGY_GRAPH_NODE_SIZE.workspacePanelWidth;
  if (kind === "workspace-bridge") return TOPOLOGY_GRAPH_NODE_SIZE.workspaceBridgeWidth;
  return TOPOLOGY_GRAPH_NODE_SIZE.defaultWidth;
}

function topologyGraphNodeHeight(node: TopologyGraphNode): number {
  if (node.kind === "workspace-panel") return 520;
  if (node.kind === "workspace-bridge") return TOPOLOGY_GRAPH_NODE_SIZE.workspaceBridgeHeight;
  if (node.kind === "server") return 32;
  if (node.kind === "peer-workspace") return 32;
  if (node.kind === "agent") return node.liveWork?.totalCount ? TOPOLOGY_GRAPH_NODE_SIZE.agentLiveWorkHeight : TOPOLOGY_GRAPH_NODE_SIZE.agentHeight;
  return 70;
}

export function topologyGraphWithAdaptiveAgentSpacing(graph: TopologyGraph): TopologyGraph {
  const stackIndexesByParent = new Map<string, number[]>();
  graph.nodes.forEach((node, index) => {
    if (node.row?.kind !== "agent" || !node.row.parentId) return;
    // TYR 是每个 Workspace 的布局锚点，不参与 Runtime Agent 列压缩；其余 Agent 也必须按 Workspace 隔离分组。
    if (isCommunicationAgent(node.row.agent)) return;
    const stackKey = `${node.workspacePanelId ?? "unscoped"}:${node.row.parentId}`;
    const indexes = stackIndexesByParent.get(stackKey) ?? [];
    indexes.push(index);
    stackIndexesByParent.set(stackKey, indexes);
  });

  let nodes = graph.nodes;
  let changed = false;
  for (const stackIndexes of stackIndexesByParent.values()) {
    const sortedIndexes = [...stackIndexes].sort((left, right) => graph.nodes[left].position.y - graph.nodes[right].position.y);
    const firstNode = graph.nodes[sortedIndexes[0]];
    if (!firstNode) continue;
    let nextY = firstNode.position.y;

    for (const nodeIndex of sortedIndexes) {
      const node = graph.nodes[nodeIndex];
      if (node.position.y !== nextY) {
        if (!changed) nodes = [...graph.nodes];
        nodes[nodeIndex] = { ...node, position: { ...node.position, y: nextY } };
        changed = true;
      }
      // Agent 列只为真实展示高度留空间：空闲节点保持紧凑，执行卡展开时再把后续节点下移。
      nextY += topologyGraphNodeHeight(node) + 26;
    }
  }

  return topologyGraphWithPeerWorkspacePanelSpacing(changed ? { ...graph, nodes } : graph);
}

function topologyGraphWithPeerWorkspacePanelSpacing(graph: TopologyGraph): TopologyGraph {
  const framedNodes = topologyGraphNodesWithWorkspaceFrames(graph.nodes);
  const peerPanels = framedNodes.filter((node) => node.kind === "workspace-panel" && node.frame?.tone === "peer");
  if (peerPanels.length === 0) return framedNodes === graph.nodes ? graph : { ...graph, nodes: framedNodes };

  const updatedNodes = new Map(framedNodes.map((node) => [node.id, node]));
  const panelsByLayer = new Map<number, TopologyGraphNode[]>();
  for (const panel of peerPanels) {
    // 同一 Bridge 深度的面板共享左边界；按层内纵向顺序重新避让动态展开的 Live Queue。
    const layerPanels = panelsByLayer.get(panel.position.x) ?? [];
    layerPanels.push(panel);
    panelsByLayer.set(panel.position.x, layerPanels);
  }

  for (const [, layerPanels] of [...panelsByLayer.entries()].sort(([leftX], [rightX]) => leftX - rightX)) {
    const orderedPanels = [...layerPanels].sort((left, right) => left.position.y - right.position.y);
    let nextY = orderedPanels[0]?.position.y ?? 0;
    for (const panel of orderedPanels) {
      const panelAssistant = framedNodes.find((node) => node.workspacePanelId === panel.id && node.row?.kind === "agent" && isCommunicationAgent(node.row.agent));
      const targetBridgeEdge = panelAssistant
        ? graph.edges.find((edge) => edge.target === panelAssistant.id && edge.kind === "workspace-bridge-corridor")
        : undefined;
      const sourceBridgeEdge = targetBridgeEdge
        ? graph.edges.find((edge) => edge.target === targetBridgeEdge.source && edge.kind === "workspace-bridge-corridor")
        : undefined;
      const sourceAssistant = sourceBridgeEdge ? updatedNodes.get(sourceBridgeEdge.source) : undefined;
      const assistantOffsetY = panelAssistant ? panelAssistant.position.y - panel.position.y : TOPOLOGY_GRAPH_LAYOUT.peerWorkspace.assistantOffsetY;
      const preferredY = sourceAssistant ? sourceAssistant.position.y - assistantOffsetY : panel.position.y;
      const targetY = Math.max(panel.position.y, preferredY, nextY);
      const deltaY = targetY - panel.position.y;
      if (deltaY > 0) {
        updatedNodes.set(panel.id, { ...panel, position: { ...panel.position, y: targetY } });
        for (const node of framedNodes) {
          if (node.workspacePanelId !== panel.id) continue;
          updatedNodes.set(node.id, { ...node, position: { ...node.position, y: node.position.y + deltaY } });
        }
      }
      nextY = targetY + (panel.frame?.height ?? TOPOLOGY_GRAPH_LAYOUT.workspacePanel.minHeight) + TOPOLOGY_GRAPH_LAYOUT.peerWorkspace.panelGapY;
    }
  }

  let edges = graph.edges;
  for (const bridgeNode of framedNodes.filter((node) => node.kind === "workspace-bridge")) {
    const targetEdge = graph.edges.find((edge) => edge.source === bridgeNode.id && edge.kind === "workspace-bridge-corridor" && edge.path === "straight");
    if (!targetEdge) continue;
    const targetAssistant = updatedNodes.get(targetEdge.target);
    if (!targetAssistant) continue;
    const bridgeY = targetAssistant.position.y + TOPOLOGY_GRAPH_NODE_SIZE.agentHeight / 2 - TOPOLOGY_GRAPH_NODE_SIZE.workspaceBridgeHeight / 2;
    updatedNodes.set(bridgeNode.id, { ...bridgeNode, position: { ...bridgeNode.position, y: bridgeY } });
    const sourceEdge = graph.edges.find((edge) => edge.target === bridgeNode.id && edge.kind === "workspace-bridge-corridor");
    const sourceAssistant = sourceEdge ? updatedNodes.get(sourceEdge.source) : undefined;
    if (!sourceEdge || !sourceAssistant) continue;
    const nextPath = sourceAssistant.position.y === targetAssistant.position.y ? "straight" : "orthogonal";
    if (sourceEdge.path !== nextPath) {
      edges = edges.map((edge) => edge.id === sourceEdge.id ? { ...edge, path: nextPath } : edge);
    }
  }

  return {
    ...graph,
    nodes: framedNodes.map((node) => updatedNodes.get(node.id) ?? node),
    edges
  };
}

function graphRightEdge(nodes: TopologyGraphNode[]): number {
  return nodes.reduce((right, node) => Math.max(right, node.position.x + topologyGraphNodeWidth(node.kind)), -Infinity);
}

function workspacePanelContentNode(node: TopologyGraphNode): boolean {
  return node.kind !== "workspace-panel"
    && node.kind !== "workspace-bridge"
    && node.kind !== "server"
    && node.kind !== "peer-workspace";
}

function workspacePanelNode(input: {
  id: string;
  label: string;
  subtitle: string;
  tone: "local" | "peer";
  nodes: TopologyGraphNode[];
  fallbackPosition?: { x: number; y: number };
}): TopologyGraphNode {
  const contentNodes = input.nodes.filter(workspacePanelContentNode);
  const minWidth = input.tone === "peer" ? TOPOLOGY_GRAPH_NODE_SIZE.peerWorkspacePanelWidth : TOPOLOGY_GRAPH_NODE_SIZE.workspacePanelWidth;
  const fallbackPosition = input.fallbackPosition ?? { x: 24, y: 16 };
  let position = fallbackPosition;
  let width = minWidth;
  let height = TOPOLOGY_GRAPH_LAYOUT.workspacePanel.minHeight;

  if (contentNodes.length > 0) {
    const contentLeft = Math.min(...contentNodes.map((node) => node.position.x));
    const contentTop = Math.min(...contentNodes.map((node) => node.position.y));
    const contentRight = graphRightEdge(contentNodes);
    const contentBottom = Math.max(...contentNodes.map((node) => node.position.y + topologyGraphNodeHeight(node)));
    const naturalWidth = contentRight - contentLeft + TOPOLOGY_GRAPH_LAYOUT.workspacePanel.paddingLeft + TOPOLOGY_GRAPH_LAYOUT.workspacePanel.paddingRight;
    width = Math.max(minWidth, naturalWidth);
    // 节点较少时把最小宽度产生的余量均分到两侧，避免内容贴在边框一边。
    const horizontalRemainder = Math.max(0, width - naturalWidth) / 2;
    position = {
      x: Math.round(contentLeft - TOPOLOGY_GRAPH_LAYOUT.workspacePanel.paddingLeft - horizontalRemainder),
      y: Math.round(contentTop - TOPOLOGY_GRAPH_LAYOUT.workspacePanel.paddingTop)
    };
    height = Math.max(
      TOPOLOGY_GRAPH_LAYOUT.workspacePanel.minHeight,
      contentBottom - position.y + TOPOLOGY_GRAPH_LAYOUT.workspacePanel.paddingBottom
    );
  }

  return {
    id: input.id,
    kind: "workspace-panel",
    label: input.label,
    subtitle: input.subtitle,
    position,
    shared: input.tone === "peer",
    frame: {
      width,
      height,
      tone: input.tone
    }
  };
}

export function topologyGraphNodesWithWorkspaceFrames(
  graphNodes: TopologyGraphNode[],
  storedPositions: Record<string, { x: number; y: number }> = {}
): TopologyGraphNode[] {
  const positionedNodes = graphNodes.map((node) => {
    const storedPosition = storedPositions[node.id];
    const positionLocked = node.kind === "workspace-panel" || node.kind === "server" || node.kind === "peer-workspace";
    return storedPosition && !positionLocked ? { ...node, position: storedPosition } : node;
  });
  const updatedNodes = new Map(positionedNodes.map((node) => [node.id, node]));

  for (const panel of positionedNodes.filter((node) => node.kind === "workspace-panel" && node.frame)) {
    const panelMembers = positionedNodes.filter((node) => node.workspacePanelId === panel.id);
    const fittedPanel = workspacePanelNode({
      id: panel.id,
      label: panel.label,
      subtitle: panel.subtitle,
      tone: panel.frame?.tone ?? "local",
      nodes: panelMembers,
      fallbackPosition: panel.position
    });
    updatedNodes.set(panel.id, fittedPanel);

    for (const labelNode of panelMembers.filter((node) => node.kind === "server" || node.kind === "peer-workspace")) {
      // Workspace 标题属于边框的交互标签，不参与内容尺寸计算，避免标题把边框向左撑开。
      updatedNodes.set(labelNode.id, {
        ...labelNode,
        position: {
          x: fittedPanel.position.x + Math.round(((fittedPanel.frame?.width ?? TOPOLOGY_GRAPH_LAYOUT.workspacePanel.minHeight) - TOPOLOGY_GRAPH_NODE_SIZE.workspaceLabelWidth) / 2),
          y: fittedPanel.position.y + TOPOLOGY_GRAPH_LAYOUT.workspacePanel.labelOffsetY
        }
      });
    }
  }

  return positionedNodes.map((node) => updatedNodes.get(node.id) ?? node);
}

function groupRowsByParent<T extends { parentId?: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const group = grouped.get(row.parentId) ?? [];
    group.push(row);
    grouped.set(row.parentId, group);
  }
  return grouped;
}
