import type { TopologyLiveWorkPlaybackPayload } from "./topologyLiveWorkPlayback";
import {
  isCommunicationAgent,
  runtimeDisplayName,
  type AgentRecord,
  type AgentStatus,
  type AppSnapshot,
  type CommunicationAgentProgressRecord,
  type DeviceRecord,
  type MachineRecord,
  type RuntimeExecutionStatus,
  type TopologyBridgeJourneyActorMode,
  type TopologyBridgeJourneyRecord,
  type TopologyLiveActivityRecord,
  type TopologyLiveExecutionRecord,
  type TopologyLiveWorkPayload,
  type TopologyWorkspaceBridgeMessageRecord,
  type WorkspaceBridgeRecord,
  type WorkspaceBridgeTopologySnapshot
} from "@tyr-ai/contracts";
import { primaryTopologyLiveActivity, topologyLiveActivityIndicatesWork } from "./livingTopologyActivity";
import {
  bridgeCommunicationFlowSignals,
  type BridgeCommunicationFlowSignal,
  type CommunicationFlowTone
} from "./communicationFlow";
import { workspaceSpatialHumanJourneys, type WorkspaceSpatialHumanJourney } from "./workspaceSpatialHumanJourney";

export type WorkspaceSpatialAgentState = AgentStatus | "communicating";
export type WorkspaceSpatialRoomKind = "machine" | "mobile";
export type WorkspaceSpatialDensity = "standard" | "expanded" | "compact" | "cluster";

export type WorkspaceSpatialFlowSignal = {
  id: string;
  executionId: string;
  chainId: string;
  sourceExecutionId?: string;
  requestSourceExecutionId?: string;
  /** Bridge 请求与对端 worker 的权威关联；用于连续绘制 TYR → Bridge → TYR → Agent。 */
  bridgeRequestMessageId?: string;
  resultReceivedAt?: string;
  actorMode?: TopologyBridgeJourneyActorMode;
  bridgePath?: string[];
  hopCount?: number;
  tone: CommunicationFlowTone;
  sourceAgentId?: string;
  targetAgentId: string;
  continuous: boolean;
  /** 服务端 execution 状态用于区分发送、等待执行和终态回传，不由视觉层猜测。 */
  status?: RuntimeExecutionStatus;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceSpatialFlowChain = {
  id: string;
  flows: WorkspaceSpatialFlowSignal[];
  /** true 表示授权后的 payload 缺少中间 execution，Renderer 必须保留断点而不能自行补线。 */
  hasGap: boolean;
};

export type WorkspaceSpatialAgent = {
  id: string;
  name: string;
  displayName: string;
  runtime: string;
  state: WorkspaceSpatialAgentState;
  local: boolean;
  workspaceId: string;
  controller: boolean;
  activity?: TopologyLiveActivityRecord;
  /** 当前思考的短摘要；完整 Execution 内容不进入场景模型。 */
  activitySummary?: string;
  communicationProgress?: CommunicationAgentProgressRecord;
};

export type WorkspaceSpatialRoom = {
  id: string;
  workspaceId: string;
  kind: WorkspaceSpatialRoomKind;
  name: string;
  subtitle: string;
  status: "online" | "offline" | "degraded";
  agents: WorkspaceSpatialAgent[];
  visibleAgents: WorkspaceSpatialAgent[];
  hiddenAgentCount: number;
  density: WorkspaceSpatialDensity;
  linkedAgentCount: number;
  local: boolean;
};

export type WorkspaceSpatialWorkspace = {
  /** 拜访恢复消费原始事实，光效去重不能丢掉结果送达信息。 */
  visitFlows?: WorkspaceSpatialFlowSignal[];
  id: string;
  name: string;
  ownerName: string;
  current: boolean;
  bridgeId?: string;
  status: "online" | "offline" | "degraded";
  rooms: WorkspaceSpatialRoom[];
  controllers: WorkspaceSpatialAgent[];
  flows: WorkspaceSpatialFlowSignal[];
  flowChains: WorkspaceSpatialFlowChain[];
  agentCount: number;
  deviceCount: number;
};

export type WorkspaceSpatialBridge = {
  id: string;
  peerWorkspaceId: string;
  peerWorkspaceName: string;
  direction: WorkspaceBridgeRecord["direction"];
  flowing: boolean;
  flowDirection: "outbound" | "inbound" | "bidirectional";
  signals: BridgeCommunicationFlowSignal[];
  /** Bridge 光路只消费无正文生命周期字段；完整消息继续留在独立 Bridge 会话。 */
  messages?: TopologyWorkspaceBridgeMessageRecord[];
  /** 人物移动只消费服务端合并后的真实 Journey 阶段。 */
  journeys?: TopologyBridgeJourneyRecord[];
  lastActivityAt: string | null;
  record: WorkspaceBridgeRecord;
};

export type WorkspaceSpatialScene = {
  human: {
    id: string;
    displayName: string;
  };
  humanJourneys: WorkspaceSpatialHumanJourney[];
  current: WorkspaceSpatialWorkspace;
  peers: WorkspaceSpatialWorkspace[];
  bridges: WorkspaceSpatialBridge[];
  hiddenPeerCount: number;
  totals: {
    workspaces: number;
    devices: number;
    agents: number;
    activeBridges: number;
  };
};

export function workspaceSpatialSceneNeedsAnimation(scene: WorkspaceSpatialScene): boolean {
  if (scene.bridges.some((bridge) => (bridge.journeys ?? []).some((journey) => journey.continuous))) return true;
  // Bridge 只播放一次有限三段接力并自行续帧；等待对端期间不能让整座桥保持 always 动画。
  if (scene.current.flows.some((flow) => flow.continuous)
    || scene.peers.some((workspace) => workspace.flows.some((flow) => flow.continuous))) return true;
  const currentAgents = [
    ...scene.current.controllers,
    ...scene.current.rooms.flatMap((room) => room.agents)
  ];
  // 当前 Workspace 的聚合房间也必须感知被折叠 Agent 的权威 activity，才能驱动 ROOM OPS；
  // peer Agent 仅由已投影的 Bridge Flow 获得动画资格，不开放无关的对端 ambient 动画。
  return currentAgents.some((agent) => (
    agent.state !== "offline"
    && agent.state !== "error"
    && (Boolean(agent.activity?.continuous) || Boolean(agent.communicationProgress))
  ));
}

export function workspaceSpatialAgentHasBridgeActivity(
  agentId: string,
  flows: readonly WorkspaceSpatialFlowSignal[]
): boolean {
  // bridgeRequestMessageId 由服务端校验并投影；只有这条直接 Bridge 生命周期中的 Agent 才能在对端视图持续工作。
  return flows.some((flow) => Boolean(flow.bridgeRequestMessageId) && (
    flow.sourceAgentId === agentId || flow.targetAgentId === agentId
  ));
}

export function workspaceSpatialSceneHasMessageAttention(scene: WorkspaceSpatialScene): boolean {
  const workspaces = [scene.current, ...scene.peers];
  // progress、Flow 和 Bridge signal 都属于同一条权威消息窗口；窗口退出前不得让无关 Ambient 抢走注意力。
  return workspaces.some((workspace) => (
    workspace.flows.length > 0
    || workspace.controllers.some((agent) => Boolean(agent.communicationProgress))
  )) || scene.bridges.some((bridge) => bridge.signals.length > 0 || (bridge.journeys?.length ?? 0) > 0);
}

const MAX_VISIBLE_PEERS = 6;

function workspaceCommunicationFlowSignals(liveWork: TopologyLiveWorkPayload, workspaceId: string): WorkspaceSpatialFlowSignal[] {
  // 路径来源统一由服务端投影；场景层只消费直接可见 Workspace 的显式通信关系，不再按 Agent 状态猜测调度来源。
  return liveWork.flows
    .filter((flow) => flow.workspaceId === workspaceId)
    .map((flow) => ({
      id: flow.id,
      executionId: flow.executionId,
      chainId: flow.chainId,
      sourceExecutionId: flow.sourceExecutionId,
      requestSourceExecutionId: flow.requestSourceExecutionId,
      ...(flow.bridgeRequestMessageId ? { bridgeRequestMessageId: flow.bridgeRequestMessageId } : {}),
      ...(flow.resultReceivedAt ? { resultReceivedAt: flow.resultReceivedAt } : {}),
      ...(flow.actorMode ? { actorMode: flow.actorMode } : {}),
      ...(flow.bridgePath ? { bridgePath: flow.bridgePath } : {}),
      hopCount: flow.hopCount,
      tone: flow.tone,
      sourceAgentId: flow.sourceAgentId,
      targetAgentId: flow.targetAgentId,
      continuous: flow.continuous,
      status: flow.status,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt
    }));
}

export function workspaceSpatialFlowChains(flows: WorkspaceSpatialFlowSignal[]): WorkspaceSpatialFlowChain[] {
  const flowsByChainId = new Map<string, WorkspaceSpatialFlowSignal[]>();
  for (const flow of flows) {
    const chain = flowsByChainId.get(flow.chainId) ?? [];
    chain.push(flow);
    flowsByChainId.set(flow.chainId, chain);
  }

  const chains = [...flowsByChainId].map(([chainId, chainFlows]): WorkspaceSpatialFlowChain => {
    const byExecutionId = new Map(chainFlows.map((flow) => [flow.executionId, flow]));
    const ordered: WorkspaceSpatialFlowSignal[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    let hasGap = false;

    const visit = (flow: WorkspaceSpatialFlowSignal) => {
      if (visited.has(flow.id)) return;
      if (visiting.has(flow.id)) {
        hasGap = true;
        return;
      }
      visiting.add(flow.id);
      if (flow.sourceExecutionId) {
        const source = byExecutionId.get(flow.sourceExecutionId);
        if (source) {
          visit(source);
        } else if (flow.sourceExecutionId !== chainId) {
          // 根 execution 可能是不可投影的 Human 请求；只有缺失的中间 hop 才是链路断点。
          hasGap = true;
        }
      }
      visiting.delete(flow.id);
      visited.add(flow.id);
      ordered.push(flow);
    };

    [...chainFlows]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .forEach(visit);
    return { id: chainId, flows: ordered, hasGap };
  });

  // 最近更新的真实链路优先，后续 M8-B 可以直接选择 attention chain，而无需重新推断。
  return chains.sort((left, right) => {
    const leftUpdatedAt = left.flows.reduce((latest, flow) => latest > flow.updatedAt ? latest : flow.updatedAt, "");
    const rightUpdatedAt = right.flows.reduce((latest, flow) => latest > flow.updatedAt ? latest : flow.updatedAt, "");
    return rightUpdatedAt.localeCompare(leftUpdatedAt) || left.id.localeCompare(right.id);
  });
}

export function workspaceSpatialDensity(agentCount: number): WorkspaceSpatialDensity {
  if (agentCount <= 4) return "standard";
  if (agentCount <= 8) return "expanded";
  if (agentCount <= 16) return "compact";
  return "cluster";
}

export function workspaceSpatialAgentNameSegments(displayName: string): string[] {
  const segments: string[] = [];
  let current = "";
  for (const character of displayName) {
    current += character;
    if (/[\s\-_]/u.test(character)) {
      segments.push(current);
      current = "";
    }
  }
  if (current || segments.length === 0) segments.push(current);
  // 分段只增加可换行位置，重新拼接后必须仍是服务端保存的完整名称。
  return segments;
}

function visibleAgentsForDensity(agents: WorkspaceSpatialAgent[], density: WorkspaceSpatialDensity): WorkspaceSpatialAgent[] {
  // 17+ 人时保留真实总数，但只绘制稳定数量的 Humanoid，避免大量 DOM 让实时场景抖动或掉帧。
  return density === "cluster" ? agents.slice(0, 8) : agents;
}

function spatialAgentState(
  agent: AgentRecord,
  workingAgentIds: Set<string>,
  communicatingAgentIds: Set<string>,
  communicationProgress?: CommunicationAgentProgressRecord
): WorkspaceSpatialAgentState {
  // 资源离线是硬边界；迟到的 execution/activity 不能把不可执行 Agent 重新显示为 working。
  if (agent.status === "offline") return "offline";
  if (agent.status === "error") return "error";
  if (communicationProgress) return communicationProgress.phase === "running_action" ? "communicating" : "working";
  if (communicatingAgentIds.has(agent.id)) return "communicating";
  if (agent.status === "working" || workingAgentIds.has(agent.id)) return "working";
  return agent.status;
}

function spatialAgents(
  agents: AgentRecord[],
  workspaceId: string,
  local: boolean,
  workingAgentIds: Set<string>,
  communicatingAgentIds: Set<string>,
  activityByAgentId: Map<string, TopologyLiveActivityRecord>,
  activitySummaryByExecutionId: Map<string, string>,
  communicationProgressByAgentId: Map<string, CommunicationAgentProgressRecord>
): WorkspaceSpatialAgent[] {
  return agents
    .filter((agent) => !agent.deletedAt)
    .map((agent) => {
      const communicationProgress = communicationProgressByAgentId.get(agent.id);
      const activity = activityByAgentId.get(agent.id);
      return {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName,
        runtime: agent.runtime ? runtimeDisplayName(agent.runtime) : "No runtime",
        state: spatialAgentState(agent, workingAgentIds, communicatingAgentIds, communicationProgress),
        local,
        workspaceId,
        controller: isCommunicationAgent(agent),
        activity,
        ...(activity ? { activitySummary: activitySummaryByExecutionId.get(activity.executionId) } : {}),
        communicationProgress
      };
    });
}

function spatialRoom(input: {
  id: string;
  workspaceId: string;
  kind: WorkspaceSpatialRoomKind;
  name: string;
  subtitle: string;
  status: WorkspaceSpatialRoom["status"];
  agents: WorkspaceSpatialAgent[];
  linkedAgentCount?: number;
  local: boolean;
}): WorkspaceSpatialRoom {
  const density = workspaceSpatialDensity(input.agents.length);
  const visibleAgents = visibleAgentsForDensity(input.agents, density);
  return {
    ...input,
    visibleAgents,
    hiddenAgentCount: Math.max(0, input.agents.length - visibleAgents.length),
    density,
    linkedAgentCount: input.linkedAgentCount ?? 0
  };
}

function machineRooms(input: {
  workspaceId: string;
  machines: MachineRecord[];
  agents: AgentRecord[];
  spatialAgentsById: Map<string, WorkspaceSpatialAgent>;
  local: boolean;
}): WorkspaceSpatialRoom[] {
  return input.machines
    .filter((machine) => !machine.deletedAt)
    .map((machine) => {
      const agents = input.agents
        // TYR belongs to the Workspace orchestration layer even when a compatibility record carries a machine id.
        .filter((agent) => agent.machineId === machine.id && !agent.deletedAt && !isCommunicationAgent(agent))
        .map((agent) => input.spatialAgentsById.get(agent.id))
        .filter((agent): agent is WorkspaceSpatialAgent => Boolean(agent));
      return spatialRoom({
        id: machine.id,
        workspaceId: input.workspaceId,
        kind: "machine",
        name: machine.name,
        subtitle: machine.hostname || machine.os || "Device",
        status: machine.status,
        // Device 离线时保留人物身份与详情入口，但不能继续显示工作或通信姿态。
        agents: machine.status === "offline" ? agents.map((agent) => ({ ...agent, state: "offline" })) : agents,
        local: input.local
      });
    });
}

function mobileRooms(input: {
  workspaceId: string;
  devices: DeviceRecord[];
  linkedAgentCountByDeviceId?: Map<string, number>;
  local: boolean;
}): WorkspaceSpatialRoom[] {
  return input.devices
    .filter((device) => !device.deletedAt)
    .map((device) => spatialRoom({
      id: device.id,
      workspaceId: input.workspaceId,
      kind: "mobile",
      name: device.displayName,
      subtitle: `${device.platform} · Mobile Device`,
      status: device.status,
      // Device grants are capability associations, not Agent hosting. Duplicating those Agents here
      // would falsely imply they moved off their real runtime Device.
      agents: [],
      linkedAgentCount: input.linkedAgentCountByDeviceId?.get(device.id) ?? 0,
      local: input.local
    }));
}

function workspaceStatus(rooms: WorkspaceSpatialRoom[]): WorkspaceSpatialWorkspace["status"] {
  if (rooms.some((room) => room.status === "degraded" || room.agents.some((agent) => agent.state === "error"))) return "degraded";
  if (rooms.some((room) => room.status === "online" || room.agents.some((agent) => agent.state !== "offline"))) return "online";
  return "offline";
}

function buildSpatialWorkspace(input: {
  id: string;
  name: string;
  ownerName: string;
  current: boolean;
  bridgeId?: string;
  machines: MachineRecord[];
  agents: AgentRecord[];
  devices: DeviceRecord[];
  workingAgentIds: Set<string>;
  communicatingAgentIds: Set<string>;
  activityByAgentId: Map<string, TopologyLiveActivityRecord>;
  activitySummaryByExecutionId: Map<string, string>;
  communicationProgressByAgentId?: Map<string, CommunicationAgentProgressRecord>;
  flows?: WorkspaceSpatialFlowSignal[];
  linkedAgentCountByDeviceId?: Map<string, number>;
}): WorkspaceSpatialWorkspace {
  const agents = spatialAgents(
    input.agents,
    input.id,
    input.current,
    input.workingAgentIds,
    input.communicatingAgentIds,
    input.activityByAgentId,
    input.activitySummaryByExecutionId,
    input.communicationProgressByAgentId ?? new Map()
  );
  const spatialAgentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const controllers = agents.filter((agent) => agent.controller);
  const rooms = machineRooms({
    workspaceId: input.id,
    machines: input.machines,
    agents: input.agents,
    spatialAgentsById,
    local: input.current
  });
  rooms.push(...mobileRooms({
    workspaceId: input.id,
    devices: input.devices,
    linkedAgentCountByDeviceId: input.linkedAgentCountByDeviceId,
    local: input.current
  }));
  const flows = input.flows ?? [];

  return {
    id: input.id,
    name: input.name,
    ownerName: input.ownerName,
    current: input.current,
    bridgeId: input.bridgeId,
    status: controllers.some((agent) => agent.state === "error")
      ? "degraded"
      : controllers.some((agent) => agent.state !== "offline") || workspaceStatus(rooms) === "online"
        ? "online"
        : workspaceStatus(rooms),
    rooms,
    controllers,
    flows,
    flowChains: workspaceSpatialFlowChains(flows),
    agentCount: agents.length,
    deviceCount: rooms.length
  };
}

function bridgeRecordById(snapshot: AppSnapshot): Map<string, WorkspaceBridgeRecord> {
  const records = [...(snapshot.workspaceBridges ?? []), ...(snapshot.incomingWorkspaceBridges ?? [])];
  return new Map(records.map((bridge) => [bridge.id, bridge]));
}

function directActiveTopology(
  topology: WorkspaceBridgeTopologySnapshot,
  bridgesById: Map<string, WorkspaceBridgeRecord>
): { topology: WorkspaceBridgeTopologySnapshot; bridge: WorkspaceBridgeRecord } | null {
  const bridge = topology.bridge ?? bridgesById.get(topology.bridgeId);
  // Scene follows the same disclosure boundary as Topology: only direct, active Bridges are rendered.
  if (!bridge || bridge.status !== "active" || (topology.distance ?? 1) !== 1) return null;
  return { topology, bridge };
}

function workspaceActivityByAgentId(liveWork: TopologyLiveWorkPayload, workspaceId: string): Map<string, TopologyLiveActivityRecord> {
  const grouped = new Map<string, TopologyLiveActivityRecord[]>();
  for (const activity of liveWork.activities) {
    if (activity.workspaceId !== workspaceId) continue;
    const current = grouped.get(activity.agentId) ?? [];
    current.push(activity);
    grouped.set(activity.agentId, current);
  }
  return new Map([...grouped].flatMap(([agentId, activities]) => {
    const primary = primaryTopologyLiveActivity(activities);
    return primary ? [[agentId, primary] as const] : [];
  }));
}

export function workspaceSpatialThinkingSummary(
  execution: Pick<TopologyLiveExecutionRecord, "title" | "latestDetail">,
  activity: Pick<TopologyLiveActivityRecord, "kind" | "summary">
): string | undefined {
  if (activity.kind !== "thinking") return undefined;
  const source = activity.summary?.trim() || (execution.title.trim() ? `Considering: ${execution.title.trim()}` : "");
  if (!source) return undefined;
  const compact = source.replace(/\s+/g, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}…` : compact;
}

function workspaceActivitySummaryByExecutionId(liveWork: TopologyLiveWorkPayload): Map<string, string> {
  const activityByExecutionId = new Map(liveWork.activities.map((activity) => [activity.executionId, activity]));
  return new Map(liveWork.executions.flatMap((execution) => {
    const activity = activityByExecutionId.get(execution.id);
    if (!activity) return [];
    const summary = workspaceSpatialThinkingSummary(execution, activity);
    return summary ? [[execution.id, summary] as const] : [];
  }));
}

function workspaceWorkingAgentIds(
  liveWork: TopologyLiveWorkPayload,
  workspaceId: string,
  currentWorkspaceId: string
): Set<string> {
  const fromActivities = liveWork.activities
    .filter((activity) => activity.workspaceId === workspaceId && topologyLiveActivityIndicatesWork(activity.kind))
    .map((activity) => activity.agentId);
  // executions fallback 只用于 Web/server 滚动发布；它表达真实工作，但不生成任何通信 Flow。
  const fromExecutions = liveWork.executions
    .filter((execution) => (execution.workspaceId ?? currentWorkspaceId) === workspaceId)
    .map((execution) => execution.agentId);
  return new Set([...fromActivities, ...fromExecutions]);
}

export function buildWorkspaceSpatialScene(
  snapshot: AppSnapshot,
  liveWork: TopologyLiveWorkPlaybackPayload = { executions: [], flows: [], activities: [], truncated: false },
  nowMs = Date.now()
): WorkspaceSpatialScene {
  const currentWorkspaceId = snapshot.currentServer?.id ?? "current-workspace";
  const communicationProgressByAgentId = new Map<string, CommunicationAgentProgressRecord>();
  for (const progress of snapshot.communicationAgentProgress ?? []) {
    const current = communicationProgressByAgentId.get(progress.assistantAgentId);
    if (!current || current.updatedAt.localeCompare(progress.updatedAt) < 0) {
      communicationProgressByAgentId.set(progress.assistantAgentId, progress);
    }
  }
  const bridgeMessagesById = new Map<string, TopologyWorkspaceBridgeMessageRecord>();
  for (const message of liveWork.bridgeMessages ?? []) bridgeMessagesById.set(message.id, message);
  for (const message of snapshot.crossWorkspaceMessages ?? []) {
    // Realtime 完整记录比轮询投影更新更快；只复制动画需要的字段，正文不会进入场景模型。
    bridgeMessagesById.set(message.id, {
      id: message.id,
      bridgeId: message.bridgeId,
      sourceWorkspaceId: message.sourceWorkspaceId,
      targetWorkspaceId: message.targetWorkspaceId,
      senderCommsAgentId: message.senderCommsAgentId,
      receiverCommsAgentId: message.receiverCommsAgentId,
      outcome: message.outcome,
      responseKind: message.responseKind,
      peerMessageId: message.peerMessageId,
      replyToMessageId: message.replyToMessageId,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt ?? message.createdAt
    });
  }
  const bridgeMessages = [...bridgeMessagesById.values()];
  const pendingBridgeMessages = bridgeMessages.filter((message) => message.outcome === "pending");
  const communicatingAgentIds = new Set([
    ...pendingBridgeMessages.flatMap((message) => [message.senderCommsAgentId, message.receiverCommsAgentId]),
    ...(liveWork.bridgeJourneys ?? []).flatMap((journey) => [journey.sourceAgentId, journey.targetAgentId]),
    ...liveWork.flows.flatMap((flow) => [flow.sourceAgentId, flow.targetAgentId]),
    ...communicationProgressByAgentId.keys()
  ]);
  const workingAgentIds = workspaceWorkingAgentIds(liveWork, currentWorkspaceId, currentWorkspaceId);
  const activitySummaryByExecutionId = workspaceActivitySummaryByExecutionId(liveWork);
  const currentActivityByAgentId = workspaceActivityByAgentId(liveWork, currentWorkspaceId);
  const linkedAgentCountByDeviceId = new Map<string, number>();
  for (const grant of snapshot.deviceGrants ?? []) {
    if (grant.status !== "active") continue;
    linkedAgentCountByDeviceId.set(grant.deviceId, (linkedAgentCountByDeviceId.get(grant.deviceId) ?? 0) + 1);
  }

  const current = buildSpatialWorkspace({
    id: currentWorkspaceId,
    name: snapshot.currentServer?.name ?? "Current Workspace",
    ownerName: snapshot.currentUser.displayName || snapshot.currentUser.name,
    current: true,
    machines: snapshot.machines ?? [],
    agents: snapshot.agents ?? [],
    devices: snapshot.devices ?? [],
    workingAgentIds,
    communicatingAgentIds,
    activityByAgentId: currentActivityByAgentId,
    activitySummaryByExecutionId,
    communicationProgressByAgentId,
    flows: workspaceCommunicationFlowSignals(liveWork, currentWorkspaceId),
    linkedAgentCountByDeviceId
  });

  const bridgesById = bridgeRecordById(snapshot);
  const directTopologies = (snapshot.peerWorkspaceTopologies ?? [])
    .map((topology) => directActiveTopology(topology, bridgesById))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const visibleTopologies = directTopologies.slice(0, MAX_VISIBLE_PEERS);
  const peers = visibleTopologies.map(({ topology, bridge }) => {
    const workspaceId = topology.workspace.id;
    return buildSpatialWorkspace({
      id: workspaceId,
      name: topology.workspace.name,
      ownerName: topology.workspace.ownerDisplayName,
      current: false,
      bridgeId: bridge.id,
      machines: topology.machines ?? [],
      agents: topology.agents ?? [],
      devices: topology.devices ?? [],
      workingAgentIds: workspaceWorkingAgentIds(liveWork, workspaceId, currentWorkspaceId),
      communicatingAgentIds,
      activityByAgentId: workspaceActivityByAgentId(liveWork, workspaceId),
      activitySummaryByExecutionId,
      flows: workspaceCommunicationFlowSignals(liveWork, workspaceId)
    });
  });

  const visitFacts = { ...liveWork, flows: liveWork.visitFlows ?? liveWork.flows };
  for (const workspace of [current, ...peers]) {
    workspace.visitFlows = workspaceCommunicationFlowSignals(visitFacts, workspace.id);
  }

  const bridges = visibleTopologies.map(({ topology, bridge }): WorkspaceSpatialBridge => {
    const messages = bridgeMessages.filter((message) => message.bridgeId === bridge.id);
    const linkedFlows = liveWork.flows.filter((flow) => (
      flow.bridgeRequestMessageId
      && flow.bridgePath?.includes(bridge.id)
    ));
    const signals = bridgeCommunicationFlowSignals(
      messages,
      currentWorkspaceId,
      nowMs,
      linkedFlows
    );
    const dominantSignal = signals[0];
    return {
      id: bridge.id,
      peerWorkspaceId: topology.workspace.id,
      peerWorkspaceName: topology.workspace.name,
      direction: bridge.direction,
      flowing: signals.length > 0,
      // Request and response windows can overlap; direction follows the newest authoritative phase like Topology.
      flowDirection: dominantSignal?.direction ?? "outbound",
      signals,
      messages,
      journeys: (liveWork.bridgeJourneys ?? [])
        .filter((journey) => journey.bridgeId === bridge.id)
        .sort((left, right) => (
          Number(right.continuous) - Number(left.continuous)
          || right.updatedAt.localeCompare(left.updatedAt)
          || left.id.localeCompare(right.id)
        )),
      lastActivityAt: bridge.lastActivityAt,
      record: bridge
    };
  });

  return {
    human: {
      id: snapshot.currentUser.id,
      displayName: snapshot.currentUser.displayName || snapshot.currentUser.name
    },
    humanJourneys: workspaceSpatialHumanJourneys(snapshot, currentWorkspaceId, nowMs),
    current,
    peers,
    bridges,
    hiddenPeerCount: Math.max(0, directTopologies.length - visibleTopologies.length),
    totals: {
      workspaces: 1 + directTopologies.length,
      devices: current.deviceCount + peers.reduce((sum, workspace) => sum + workspace.deviceCount, 0),
      agents: current.agentCount + peers.reduce((sum, workspace) => sum + workspace.agentCount, 0),
      activeBridges: directTopologies.length
    }
  };
}
