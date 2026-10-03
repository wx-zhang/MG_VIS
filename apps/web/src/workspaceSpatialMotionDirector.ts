import {
  isCommunicationAgent,
  type AppSnapshot,
  type CrossWorkspaceMessageRecord,
  type TopologyLiveActivityKind,
  type TopologyLiveWorkPayload
} from "@tyr-ai/contracts";
import type { WorkspaceSpatialScene } from "./workspaceSpatial";
import type { WorkspaceSpatialAmbientAssignment } from "./workspaceSpatialAmbient";

export type WorkspaceSpatialRehearsalCue =
  | "office_life"
  | "pair_handoff"
  | "parallel_dispatch"
  | "result_convergence"
  | "direct_result_receipt"
  | "cross_room_result_relay"
  | "runtime_relay"
  | "thinking"
  | "tool_running"
  | "waiting_approval"
  | "bridge_relay";

export type WorkspaceSpatialRehearsalPhase = "active" | "queued" | "thinking" | "tool_running" | "returning" | "bridge_accepted" | "bridge_result";

export type WorkspaceSpatialRehearsalTarget = {
  workspaceId: string;
  machineId: string;
  machineName: string;
  agentId: string;
  agentName: string;
};

export type WorkspaceSpatialRehearsalBridgeTarget = {
  bridgeId: string;
  peerWorkspaceId: string;
  peerWorkspaceName: string;
  sourceControllerAgentId?: string;
  targetControllerAgentId?: string;
};

export type WorkspaceSpatialRehearsalPlan = {
  id: string;
  cue: WorkspaceSpatialRehearsalCue;
  label: string;
  phase: WorkspaceSpatialRehearsalPhase;
  startedAtMs: number;
  phaseStartedAtMs: number;
  endsAtMs: number;
  targets: WorkspaceSpatialRehearsalTarget[];
  sourceControllerAgentId?: string;
  bridgeTarget?: WorkspaceSpatialRehearsalBridgeTarget;
};

export const WORKSPACE_SPATIAL_REHEARSAL_CUES: ReadonlyArray<{
  id: WorkspaceSpatialRehearsalCue;
  label: string;
  durationMs: number;
}> = [
  { id: "office_life", label: "Office life", durationMs: 16_000 },
  { id: "pair_handoff", label: "Pair handoff", durationMs: 12_400 },
  { id: "parallel_dispatch", label: "Parallel dispatch", durationMs: 9_600 },
  { id: "result_convergence", label: "Result convergence", durationMs: 9_800 },
  { id: "direct_result_receipt", label: "Direct receipt", durationMs: 9_800 },
  { id: "cross_room_result_relay", label: "Cross-room relay", durationMs: 13_200 },
  { id: "runtime_relay", label: "Runtime relay", durationMs: 3_200 },
  { id: "thinking", label: "Thinking", durationMs: 9_000 },
  { id: "tool_running", label: "Tool run", durationMs: 13_000 },
  { id: "waiting_approval", label: "Approval", durationMs: 10_000 },
  { id: "bridge_relay", label: "Bridge relay", durationMs: 7_000 }
];

const REHEARSAL_RETURN_DURATION_MS = 7_000;
const RUNTIME_RELAY_PHASE_DURATION_MS = {
  queued: 3_200,
  thinking: 5_200,
  tool_running: 13_000,
  returning: 5_000
} as const;
const BRIDGE_RELAY_PHASE_DURATION_MS = {
  active: 6_000,
  bridge_accepted: 24_000,
  bridge_result: 28_000
} as const;

function rehearsalTargets(snapshot: AppSnapshot, cue: WorkspaceSpatialRehearsalCue): WorkspaceSpatialRehearsalTarget[] {
  if (cue === "bridge_relay") return [];
  const workspaceId = snapshot.currentServer?.id ?? "current-workspace";
  const localMachines = new Map((snapshot.machines ?? [])
    .filter((machine) => !machine.deletedAt)
    .map((machine) => [machine.id, machine]));
  const candidates = (snapshot.agents ?? [])
    .filter((agent) => (
      !agent.deletedAt
      && !isCommunicationAgent(agent)
      && Boolean(agent.machineId && localMachines.has(agent.machineId))
      && agent.status !== "error"
    ))
    .map((agent): WorkspaceSpatialRehearsalTarget => {
      const machine = localMachines.get(agent.machineId!)!;
      return {
        workspaceId,
        machineId: machine.id,
        machineName: machine.name,
        agentId: agent.id,
        agentName: agent.displayName
      };
    })
    .sort((left, right) => (
      (localMachines.get(left.machineId)?.status === "online" ? 0 : 1)
      - (localMachines.get(right.machineId)?.status === "online" ? 0 : 1)
      || left.machineName.localeCompare(right.machineName)
      || left.agentName.localeCompare(right.agentName)
      || left.agentId.localeCompare(right.agentId)
    ));

  if (cue === "office_life") return candidates.slice(0, 2);
  if (cue === "cross_room_result_relay") {
    const machineOrderById = new Map((snapshot.machines ?? [])
      .filter((machine) => !machine.deletedAt)
      .map((machine, index) => [machine.id, index]));
    for (const candidate of candidates) {
      const contributors = candidates.filter((item) => item.machineId === candidate.machineId).slice(0, 2);
      const sourceOrder = machineOrderById.get(candidate.machineId) ?? 0;
      const requester = candidates
        .filter((item) => item.machineId !== candidate.machineId)
        .sort((left, right) => (
          Math.abs((machineOrderById.get(left.machineId) ?? 0) - sourceOrder)
          - Math.abs((machineOrderById.get(right.machineId) ?? 0) - sourceOrder)
          || left.agentId.localeCompare(right.agentId)
        ))[0];
      // requester 必须在另一台相邻 Device；两个 contributor 仍共享同一 parent 与源房间，保证 DEV 构图紧凑且事实不变。
      if (contributors.length === 2 && requester) return [requester, ...contributors];
    }
    return [];
  }
  if (cue === "direct_result_receipt") {
    for (const candidate of candidates) {
      const group = candidates.filter((item) => item.machineId === candidate.machineId).slice(0, 3);
      // requester + 两位 contributor 必须都来自同一 Device，DEV 才能忠实排练房内直达结果。
      if (group.length === 3) return group;
    }
    return [];
  }
  if (cue === "pair_handoff" || cue === "parallel_dispatch" || cue === "result_convergence") {
    // room collaboration rehearsal 必须选择同一 Device 的两个真实人物槽位，不能用跨房间目标伪造协作。
    for (const candidate of candidates) {
      const pair = candidates.filter((item) => item.machineId === candidate.machineId).slice(0, 2);
      if (pair.length === 2) return pair;
    }
    return [];
  }
  if (candidates.length === 0) return [];
  const cueOffset = cue === "thinking" || cue === "runtime_relay" ? 0 : cue === "tool_running" ? 1 : 2;
  return [candidates[cueOffset % candidates.length]];
}

function rehearsalBridgeTarget(snapshot: AppSnapshot): WorkspaceSpatialRehearsalBridgeTarget | undefined {
  const bridgeById = new Map([
    ...(snapshot.workspaceBridges ?? []),
    ...(snapshot.incomingWorkspaceBridges ?? [])
  ].map((bridge) => [bridge.id, bridge]));
  for (const topology of snapshot.peerWorkspaceTopologies ?? []) {
    const bridge = topology.bridge ?? bridgeById.get(topology.bridgeId);
    if (!bridge || bridge.status !== "active" || (topology.distance ?? 1) !== 1) continue;
    const sourceControllerAgentId = (snapshot.agents ?? [])
      .find((agent) => !agent.deletedAt && isCommunicationAgent(agent))?.id;
    const targetControllerAgentId = (topology.agents ?? [])
      .find((agent) => !agent.deletedAt && isCommunicationAgent(agent))?.id;
    return {
      bridgeId: bridge.id,
      peerWorkspaceId: topology.workspace.id,
      peerWorkspaceName: topology.workspace.name,
      // DEV 使用场景中真实存在的双方 TYR，发送与收件状态才能和同一条 Message Journey 对齐。
      ...(sourceControllerAgentId ? { sourceControllerAgentId } : {}),
      ...(targetControllerAgentId ? { targetControllerAgentId } : {})
    };
  }
  return undefined;
}

export function workspaceSpatialDirectedSnapshot(
  snapshot: AppSnapshot,
  plan: WorkspaceSpatialRehearsalPlan | null
): AppSnapshot {
  // 离线 smoke 数据也必须可排练；仅克隆 Three.js 场景投影，真实 Snapshot 与 Inspector 不变。
  if (!plan) return snapshot;
  if (plan.cue === "bridge_relay" && plan.bridgeTarget) {
    const workspaceId = snapshot.currentServer?.id ?? "current-workspace";
    const createdAt = new Date(plan.startedAtMs).toISOString();
    const updatedAt = new Date(plan.phaseStartedAtMs).toISOString();
    const accepted = plan.phase === "bridge_accepted" || plan.phase === "bridge_result";
    const relayMessage: CrossWorkspaceMessageRecord = {
      id: `${plan.id}:message`,
      bridgeId: plan.bridgeTarget.bridgeId,
      conversationId: null,
      clientRequestId: null,
      retryOfMessageId: null,
      responseKind: null,
      terminalRequestId: null,
      originConversationKey: null,
      originChannelId: null,
      originConversationId: null,
      originMessageId: null,
      sourceWorkspaceId: workspaceId,
      targetWorkspaceId: plan.bridgeTarget.peerWorkspaceId,
      senderCommsAgentId: plan.bridgeTarget.sourceControllerAgentId ?? `${plan.id}:source-tyr`,
      receiverCommsAgentId: plan.bridgeTarget.targetControllerAgentId ?? `${plan.id}:target-tyr`,
      initiatedBy: "human",
      content: "Local Bridge relay rehearsal",
      outcome: accepted ? "delivered" : "pending",
      localMessageId: null,
      peerMessageId: accepted ? `${plan.id}:peer-message` : null,
      replyToMessageId: null,
      createdAt,
      updatedAt
    };
    const resultMessage: CrossWorkspaceMessageRecord | null = plan.phase === "bridge_result" ? {
      ...relayMessage,
      id: `${plan.id}:result-message`,
      responseKind: "final",
      terminalRequestId: relayMessage.id,
      sourceWorkspaceId: plan.bridgeTarget.peerWorkspaceId,
      targetWorkspaceId: workspaceId,
      senderCommsAgentId: plan.bridgeTarget.targetControllerAgentId ?? `${plan.id}:target-tyr`,
      receiverCommsAgentId: plan.bridgeTarget.sourceControllerAgentId ?? `${plan.id}:source-tyr`,
      initiatedBy: "agent",
      content: "Local Bridge result rehearsal",
      localMessageId: `${plan.id}:peer-message`,
      peerMessageId: `${plan.id}:result-peer-message`,
      replyToMessageId: relayMessage.id,
      createdAt: updatedAt,
      updatedAt
    } : null;
    // DEV cue 只替换临时 Three.js 投影中的 Bridge message；真实 Snapshot 与 Inspector 继续使用原数据。
    return { ...snapshot, crossWorkspaceMessages: resultMessage ? [relayMessage, resultMessage] : [relayMessage] };
  }
  if (plan.cue === "runtime_relay" && plan.sourceControllerAgentId) {
    const phase = plan.phase === "tool_running"
      ? "running_action"
      : plan.phase === "returning"
        ? "preparing_response"
        : "understanding";
    const target = plan.targets[0];
    const label = phase === "running_action" && target
      ? `Routing to ${target.agentName}`
      : phase === "preparing_response"
        ? "Preparing response"
        : "Understanding request";
    const at = new Date(plan.phaseStartedAtMs).toISOString();
    // Runtime relay 复刻生产链路中的 TYR 权威进度；只改临时 Snapshot，服务端事实与 Inspector 保持不变。
    return {
      ...snapshot,
      communicationAgentProgress: [{
        operationId: `${plan.id}:operation`,
        sourceMessageId: `${plan.id}:message`,
        channelId: `${plan.id}:dm`,
        assistantAgentId: plan.sourceControllerAgentId,
        source: "web",
        phase,
        label,
        startedAt: new Date(plan.startedAtMs).toISOString(),
        updatedAt: at
      }]
    };
  }
  const targetAgentIds = new Set(plan.targets.map((target) => target.agentId));
  const targetMachineIds = new Set(plan.targets.map((target) => target.machineId));
  return {
    ...snapshot,
    machines: snapshot.machines.map((machine) => targetMachineIds.has(machine.id)
      ? { ...machine, status: "online" }
      : machine),
    agents: snapshot.agents.map((agent) => targetAgentIds.has(agent.id)
      ? { ...agent, status: "online" }
      : agent)
  };
}

export function workspaceSpatialRehearsalPlan(
  snapshot: AppSnapshot,
  cue: WorkspaceSpatialRehearsalCue,
  startedAtMs: number
): WorkspaceSpatialRehearsalPlan | null {
  const cueDefinition = WORKSPACE_SPATIAL_REHEARSAL_CUES.find((item) => item.id === cue);
  const targets = rehearsalTargets(snapshot, cue);
  const sourceControllerAgentId = cue === "parallel_dispatch" || cue === "result_convergence" || cue === "runtime_relay"
    ? snapshot.agents.find((agent) => !agent.deletedAt && isCommunicationAgent(agent) && agent.status !== "error")?.id
    : undefined;
  const bridgeTarget = cue === "bridge_relay" ? rehearsalBridgeTarget(snapshot) : undefined;
  if (!cueDefinition || (cue === "bridge_relay" ? !bridgeTarget : targets.length === 0)) return null;
  return {
    id: `rehearsal:${cue}:${startedAtMs}`,
    cue,
    label: cueDefinition.label,
    phase: cue === "runtime_relay" ? "queued" : "active",
    startedAtMs,
    phaseStartedAtMs: startedAtMs,
    endsAtMs: startedAtMs + (cue === "bridge_relay"
      ? BRIDGE_RELAY_PHASE_DURATION_MS.active
      : cueDefinition.durationMs),
    targets,
    sourceControllerAgentId,
    bridgeTarget
  };
}

export function workspaceSpatialNextRehearsalPlan(
  plan: WorkspaceSpatialRehearsalPlan,
  nowMs: number
): WorkspaceSpatialRehearsalPlan | null {
  if (nowMs < plan.endsAtMs) return plan;
  if (plan.cue === "bridge_relay") {
    const nextPhase = plan.phase === "active"
      ? "bridge_accepted"
      : plan.phase === "bridge_accepted"
        ? "bridge_result"
        : null;
    if (!nextPhase) return null;
    return {
      ...plan,
      phase: nextPhase,
      phaseStartedAtMs: nowMs,
      endsAtMs: nowMs + BRIDGE_RELAY_PHASE_DURATION_MS[nextPhase]
    };
  }
  if (plan.cue === "runtime_relay") {
    const nextPhase = plan.phase === "queued"
      ? "thinking"
      : plan.phase === "thinking"
        ? "tool_running"
        : plan.phase === "tool_running"
          ? "returning"
          : null;
    if (!nextPhase) return null;
    return {
      ...plan,
      phase: nextPhase,
      phaseStartedAtMs: nowMs,
      endsAtMs: nowMs + RUNTIME_RELAY_PHASE_DURATION_MS[nextPhase]
    };
  }
  if (plan.phase === "active" && (plan.cue === "tool_running" || plan.cue === "waiting_approval")) {
    return {
      ...plan,
      phase: "returning",
      phaseStartedAtMs: nowMs,
      endsAtMs: nowMs + REHEARSAL_RETURN_DURATION_MS
    };
  }
  return null;
}

export function workspaceSpatialDirectedLiveWork(
  liveWork: TopologyLiveWorkPayload,
  plan: WorkspaceSpatialRehearsalPlan | null
): TopologyLiveWorkPayload {
  // Rehearsal 隔离真实投影，只在 DEV 控件显式启动后进入；null 必须保持原 payload 引用与产品路径。
  if (!plan) return liveWork;
  if (plan.cue === "office_life" || plan.cue === "bridge_relay") {
    return { executions: [], flows: [], activities: [], truncated: false };
  }
  if (plan.cue === "runtime_relay") {
    const target = plan.targets[0];
    const sourceAgentId = plan.sourceControllerAgentId;
    if (!target || !sourceAgentId) return { executions: [], flows: [], activities: [], truncated: false };
    const at = new Date(plan.phaseStartedAtMs).toISOString();
    if (plan.phase === "queued" || plan.phase === "thinking") {
      return { executions: [], flows: [], activities: [], truncated: false };
    }
    const returning = plan.phase === "returning";
    return {
      executions: [],
      flows: [{
        id: `${plan.id}:flow:${returning ? "response" : "request"}`,
        executionId: `${plan.id}:execution`,
        chainId: `${plan.id}:chain`,
        workspaceId: target.workspaceId,
        sourceAgentId: returning ? target.agentId : sourceAgentId,
        targetAgentId: returning ? sourceAgentId : target.agentId,
        machineId: target.machineId,
        tone: returning ? "response" : "request",
        continuous: !returning,
        status: returning ? "completed" : "running",
        createdAt: at,
        updatedAt: at
      }],
      activities: [{
        id: `${plan.id}:activity:${returning ? "completed" : "tool_running"}`,
        executionId: `${plan.id}:execution`,
        workspaceId: target.workspaceId,
        agentId: target.agentId,
        machineId: target.machineId,
        kind: returning ? "completed" : "tool_running",
        status: returning ? "completed" : "running",
        continuous: !returning,
        createdAt: at,
        updatedAt: at
      }],
      truncated: false
    };
  }
  if (plan.cue === "pair_handoff") {
    const [source, target] = plan.targets;
    if (!source || !target || source.machineId !== target.machineId) {
      return { executions: [], flows: [], activities: [], truncated: false };
    }
    const at = new Date(plan.startedAtMs).toISOString();
    // DEV 只投影一条同房间 request Flow；不生成 activity、消息、审批或服务端写入。
    return {
      executions: [],
      flows: [{
        id: `${plan.id}:flow`,
        executionId: `${plan.id}:execution`,
        chainId: `${plan.id}:execution`,
        workspaceId: source.workspaceId,
        sourceAgentId: source.agentId,
        targetAgentId: target.agentId,
        machineId: source.machineId,
        tone: "request",
        continuous: true,
        status: "running",
        createdAt: at,
        updatedAt: at
      }],
      activities: [],
      truncated: false
    };
  }
  if (plan.cue === "parallel_dispatch") {
    const targets = plan.targets.slice(0, 3);
    if (targets.length < 2 || new Set(targets.map((target) => target.machineId)).size !== 1) {
      return { executions: [], flows: [], activities: [], truncated: false };
    }
    const at = new Date(plan.startedAtMs).toISOString();
    const chainId = `${plan.id}:chain`;
    const sourceExecutionId = `${plan.id}:parent`;
    // DEV 只投影同一 direct parent 的并行 request siblings；不生成 activity、消息、审批或服务端写入。
    return {
      executions: [],
      flows: targets.map((target, index) => ({
        id: `${plan.id}:flow:${index}`,
        executionId: `${plan.id}:execution:${index}`,
        chainId,
        sourceExecutionId,
        workspaceId: target.workspaceId,
        sourceAgentId: plan.sourceControllerAgentId ?? `${plan.id}:source-tyr`,
        targetAgentId: target.agentId,
        machineId: target.machineId,
        tone: "request",
        continuous: true,
        status: "running",
        createdAt: at,
        updatedAt: at
      })),
      activities: [],
      truncated: false
    };
  }
  if (
    plan.cue === "result_convergence"
    || plan.cue === "direct_result_receipt"
    || plan.cue === "cross_room_result_relay"
  ) {
    const directReceipt = plan.cue === "direct_result_receipt";
    const crossRoomRelay = plan.cue === "cross_room_result_relay";
    const requester = directReceipt || crossRoomRelay ? plan.targets[0] : undefined;
    const targets = directReceipt || crossRoomRelay ? plan.targets.slice(1, 4) : plan.targets.slice(0, 3);
    const roomTargets = requester ? [requester, ...targets] : targets;
    const sourceRoomCount = new Set(targets.map((target) => target.machineId)).size;
    const destinationMatches = crossRoomRelay
      ? Boolean(requester && sourceRoomCount === 1 && requester.machineId !== targets[0]?.machineId)
      : new Set(roomTargets.map((target) => target.machineId)).size === 1;
    if (targets.length < 2 || !destinationMatches) {
      return { executions: [], flows: [], activities: [], truncated: false };
    }
    const responseAt = new Date(plan.startedAtMs).toISOString();
    const requestAt = new Date(plan.startedAtMs - 500).toISOString();
    const parentExecutionId = `${plan.id}:parent`;
    const sourceAgentId = requester?.agentId ?? plan.sourceControllerAgentId ?? `${plan.id}:source-tyr`;
    // 三种结果 cue 都投影精确 request-response lineage；Renderer 必须完成 lineage join，不能只凭 completed 猜测汇合。
    return {
      executions: [],
      flows: targets.flatMap((target, index) => {
        const childExecutionId = `${plan.id}:child:${index}`;
        return [{
          id: `${plan.id}:request:${index}`,
          executionId: childExecutionId,
          chainId: parentExecutionId,
          sourceExecutionId: parentExecutionId,
          workspaceId: target.workspaceId,
          sourceAgentId,
          targetAgentId: target.agentId,
          machineId: target.machineId,
          tone: "request" as const,
          continuous: false,
          status: "completed" as const,
          createdAt: requestAt,
          updatedAt: responseAt
        }, {
          id: `${plan.id}:response:${index}`,
          executionId: `${plan.id}:return:${index}`,
          chainId: parentExecutionId,
          sourceExecutionId: childExecutionId,
          requestSourceExecutionId: parentExecutionId,
          workspaceId: target.workspaceId,
          sourceAgentId: target.agentId,
          targetAgentId: sourceAgentId,
          machineId: target.machineId,
          tone: "response" as const,
          continuous: false,
          status: "completed" as const,
          createdAt: responseAt,
          updatedAt: responseAt
        }];
      }),
      activities: [],
      truncated: false
    };
  }
  const target = plan.targets[0];
  const kind: TopologyLiveActivityKind = plan.phase === "returning"
    ? "completed"
    : plan.cue;
  const at = new Date(plan.phaseStartedAtMs).toISOString();
  return {
    executions: [],
    flows: [],
    activities: [{
      id: `${plan.id}:activity:${kind}`,
      executionId: `${plan.id}:execution`,
      workspaceId: target.workspaceId,
      agentId: target.agentId,
      machineId: target.machineId,
      kind,
      status: kind === "waiting_approval" ? "waiting_approval" : kind === "completed" ? "completed" : "running",
      continuous: kind !== "completed",
      createdAt: at,
      updatedAt: at
    }],
    truncated: false
  };
}

export function workspaceSpatialRehearsalPhaseLabel(plan: WorkspaceSpatialRehearsalPlan): string {
  if (plan.cue === "bridge_relay") {
    if (plan.phase === "bridge_accepted") return "Peer received";
    if (plan.phase === "bridge_result") return "Returning result";
    return "Sending request";
  }
  if (plan.cue !== "runtime_relay") return plan.phase === "returning" ? "Returning" : "Playing";
  if (plan.phase === "queued") return "Queued";
  if (plan.phase === "thinking") return "Thinking";
  if (plan.phase === "tool_running") return "Tool running";
  return "Completed";
}

export function workspaceSpatialRehearsalAmbientAssignments(
  scene: WorkspaceSpatialScene,
  plan: WorkspaceSpatialRehearsalPlan | null
): WorkspaceSpatialAmbientAssignment[] | undefined {
  if (!plan || plan.cue !== "office_life" || plan.phase !== "active") return undefined;
  const targetsByAgentId = new Map(plan.targets.map((target) => [target.agentId, target]));
  const visibleTargets = scene.current.rooms.flatMap((room) => room.visibleAgents
    .filter((agent) => targetsByAgentId.has(agent.id) && agent.local && agent.state === "online" && !agent.activity)
    .map((agent) => ({ room, agent })));
  return visibleTargets.slice(0, 2).map(({ room, agent }, index) => {
    const startedAtMs = plan.startedAtMs + index * 600;
    // M12 rehearsal 固定覆盖两个可离座 station，便于一次人工复测同时看清状态屏与 Refresh Point。
    const kind = index === 0 ? "status_check" : "refresh_break";
    return {
      id: `${plan.id}:${room.id}:${agent.id}:${kind}`,
      eligibilityKey: plan.id,
      workspaceId: scene.current.id,
      roomId: room.id,
      agentId: agent.id,
      kind,
      startedAtMs,
      returnAtMs: startedAtMs + (kind === "status_check" ? 7_000 : 10_500),
      endsAtMs: startedAtMs + (kind === "status_check" ? 10_400 : 15_000)
    };
  });
}
