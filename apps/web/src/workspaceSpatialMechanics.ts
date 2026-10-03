import type { CommunicationFlowTone } from "./communicationFlow";
import type {
  WorkspaceSpatialAgent,
  WorkspaceSpatialBridge,
  WorkspaceSpatialFlowSignal,
  WorkspaceSpatialRoom
} from "./workspaceSpatial";

export type WorkspaceSpatialRoomMechanicMode =
  | "idle"
  | "thinking"
  | "tool"
  | "approval"
  | "communication"
  | "error";

export type WorkspaceSpatialRoomMechanic = {
  mode: WorkspaceSpatialRoomMechanicMode;
  sourceId?: string;
  continuous: boolean;
  activeAgentCount: number;
  hiddenActiveAgentCount: number;
};

export type WorkspaceSpatialRoomAccessMode = "ready" | "holding" | "blocked";

export type WorkspaceSpatialRoomScreenRhythm = "off" | "standby" | "breathe" | "scan" | "hold" | "alert";

export type WorkspaceSpatialRoomOperationalRhythm = {
  mode: WorkspaceSpatialRoomMechanicMode;
  color: string;
  access: WorkspaceSpatialRoomAccessMode;
  screen: WorkspaceSpatialRoomScreenRhythm;
  cadence: number;
  motionActive: boolean;
  lightBase: number;
  lightAmplitude: number;
  screenBase: number;
  screenAmplitude: number;
};

export type WorkspaceSpatialBridgeMechanic = {
  active: boolean;
  signalId?: string;
  direction: "outbound" | "inbound";
  tone: CommunicationFlowTone;
  continuous: boolean;
};

export const WORKSPACE_SPATIAL_BRIDGE_HANDOFF_DURATION_SECONDS = 1.85;

export const WORKSPACE_SPATIAL_BRIDGE_MESSAGE_TIMING = {
  sourceAccess: { delaySeconds: 0.05, durationSeconds: 0.86 },
  bridge: { delaySeconds: 0.96, durationSeconds: 1.46 },
  targetAccess: { delaySeconds: 2.5, durationSeconds: 0.92 },
  transferRelayDelaySeconds: 1.16,
  concurrentStaggerSeconds: 0.34
} as const;

export type WorkspaceSpatialBridgeHandoffFrame = {
  progress: number;
  directedProgress: number;
  envelope: number;
  sourceStrength: number;
  targetStrength: number;
  settled: boolean;
};

type RoomMechanicCandidate = {
  mode: Exclude<WorkspaceSpatialRoomMechanicMode, "idle">;
  sourceId: string;
  agentId: string;
  continuous: boolean;
  priority: number;
};

function agentMechanicCandidate(agent: WorkspaceSpatialAgent): RoomMechanicCandidate | null {
  // Device / Agent offline 是房间机械的硬边界；迟到 activity 只保留审计事实，不继续演出工作状态。
  if (agent.state === "offline") return null;
  if (agent.state === "error" || agent.activity?.kind === "failed" || agent.activity?.kind === "stalled") {
    return {
      mode: "error",
      sourceId: agent.activity?.id ?? `resource:${agent.id}:error`,
      agentId: agent.id,
      continuous: agent.activity?.continuous ?? false,
      priority: 1
    };
  }
  if (agent.activity?.kind === "waiting_approval") {
    return { mode: "approval", sourceId: agent.activity.id, agentId: agent.id, continuous: true, priority: 0 };
  }
  if (agent.activity?.kind === "tool_running") {
    return { mode: "tool", sourceId: agent.activity.id, agentId: agent.id, continuous: true, priority: 3 };
  }
  if (agent.activity?.kind === "thinking") {
    return { mode: "thinking", sourceId: agent.activity.id, agentId: agent.id, continuous: true, priority: 4 };
  }
  // queued、delivered 与正向 terminal 继续由人物 marker 表达，避免房间设备夸大尚未开始或已经结束的工作。
  return null;
}

export function workspaceSpatialRoomMechanic(
  room: WorkspaceSpatialRoom,
  flows: WorkspaceSpatialFlowSignal[]
): WorkspaceSpatialRoomMechanic {
  const roomAgentIds = new Set(room.agents.map((agent) => agent.id));
  const agentCandidates = room.agents.flatMap((agent) => {
    const candidate = agentMechanicCandidate(agent);
    return candidate ? [candidate] : [];
  });
  const flowCandidates: RoomMechanicCandidate[] = flows.flatMap((flow) => {
    const agentId = roomAgentIds.has(flow.targetAgentId)
      ? flow.targetAgentId
      : flow.sourceAgentId && roomAgentIds.has(flow.sourceAgentId)
        ? flow.sourceAgentId
        : null;
    if (!agentId) return [];
    return [{
      mode: "communication",
      sourceId: flow.id,
      agentId,
      continuous: flow.continuous,
      priority: 2
    }];
  });
  const candidates = [...agentCandidates, ...flowCandidates]
    .sort((left, right) => left.priority - right.priority || left.sourceId.localeCompare(right.sourceId));
  const primary = candidates[0];
  if (!primary) {
    return { mode: "idle", continuous: false, activeAgentCount: 0, hiddenActiveAgentCount: 0 };
  }

  const activeAgentIds = new Set(candidates.map((candidate) => candidate.agentId));
  const visibleAgentIds = new Set(room.visibleAgents.map((agent) => agent.id));
  return {
    mode: primary.mode,
    sourceId: primary.sourceId,
    continuous: primary.continuous,
    activeAgentCount: activeAgentIds.size,
    // 聚合房间只给出房间级机械反馈，不把隐藏 Agent 冒充成某个可见人物。
    hiddenActiveAgentCount: [...activeAgentIds].filter((agentId) => !visibleAgentIds.has(agentId)).length
  };
}

export function workspaceSpatialRoomOperationalRhythm(
  mechanic: WorkspaceSpatialRoomMechanic,
  roomStatus: WorkspaceSpatialRoom["status"]
): WorkspaceSpatialRoomOperationalRhythm {
  // Device 状态先于 activity：offline / degraded 不能被迟到工作重新演成正常运转的房间。
  if (roomStatus === "offline") {
    return {
      mode: "idle",
      color: "#8b989f",
      access: "blocked",
      screen: "off",
      cadence: 0,
      motionActive: false,
      lightBase: 0.08,
      lightAmplitude: 0,
      screenBase: 0.02,
      screenAmplitude: 0
    };
  }
  if (roomStatus === "degraded") {
    return {
      mode: "idle",
      color: "#efb44e",
      access: "holding",
      screen: "hold",
      cadence: 0,
      motionActive: false,
      lightBase: 0.28,
      lightAmplitude: 0,
      screenBase: 0.16,
      screenAmplitude: 0
    };
  }

  const motionActive = mechanic.mode !== "idle" && mechanic.continuous;
  if (mechanic.mode === "thinking") {
    return {
      mode: mechanic.mode,
      color: "#3bace5",
      access: "ready",
      screen: "breathe",
      cadence: 1.45,
      motionActive,
      lightBase: 0.22,
      lightAmplitude: 0.14,
      screenBase: 0.14,
      screenAmplitude: 0.14
    };
  }
  if (mechanic.mode === "tool") {
    return {
      mode: mechanic.mode,
      color: "#8b7ee8",
      access: "ready",
      screen: "scan",
      cadence: 4.8,
      motionActive,
      lightBase: 0.24,
      lightAmplitude: 0.17,
      screenBase: 0.16,
      screenAmplitude: 0.18
    };
  }
  if (mechanic.mode === "approval") {
    return {
      mode: mechanic.mode,
      color: "#efb44e",
      access: "holding",
      screen: "hold",
      cadence: 1.8,
      motionActive,
      lightBase: 0.3,
      lightAmplitude: 0.12,
      screenBase: 0.21,
      screenAmplitude: 0.07
    };
  }
  if (mechanic.mode === "communication") {
    return {
      mode: mechanic.mode,
      color: "#2fcab4",
      access: "ready",
      screen: "scan",
      cadence: 3.6,
      motionActive,
      lightBase: 0.24,
      lightAmplitude: 0.16,
      screenBase: 0.16,
      screenAmplitude: 0.16
    };
  }
  if (mechanic.mode === "error") {
    return {
      mode: mechanic.mode,
      color: "#e16868",
      access: "blocked",
      screen: "alert",
      cadence: 0,
      motionActive: false,
      lightBase: 0.34,
      lightAmplitude: 0,
      screenBase: 0.2,
      screenAmplitude: 0
    };
  }
  return {
    mode: "idle",
    color: "#2fcab4",
    access: "ready",
    screen: "standby",
    cadence: 0,
    motionActive: false,
    lightBase: 0.13,
    lightAmplitude: 0,
    screenBase: 0.045,
    screenAmplitude: 0
  };
}

export function workspaceSpatialBridgeMechanic(bridge: WorkspaceSpatialBridge): WorkspaceSpatialBridgeMechanic {
  const priority: Record<CommunicationFlowTone, number> = { error: 0, response: 1, request: 2 };
  const signal = [...bridge.signals].sort((left, right) => (
    priority[left.tone] - priority[right.tone] || right.createdAt.localeCompare(left.createdAt)
  ))[0];
  if (!signal) {
    return { active: false, direction: "outbound", tone: "request", continuous: false };
  }
  return {
    active: true,
    signalId: signal.id,
    direction: signal.direction,
    tone: signal.tone,
    continuous: signal.continuous
  };
}

export function workspaceSpatialBridgeHandoffFrame(
  mechanic: WorkspaceSpatialBridgeMechanic,
  elapsedSeconds: number,
  reduceMotion = false
): WorkspaceSpatialBridgeHandoffFrame {
  if (!mechanic.active) {
    return {
      progress: 0,
      directedProgress: mechanic.direction === "outbound" ? 0 : 1,
      envelope: 0,
      sourceStrength: 0,
      targetStrength: 0,
      settled: true
    };
  }

  const progress = Math.min(1, Math.max(0, elapsedSeconds / WORKSPACE_SPATIAL_BRIDGE_HANDOFF_DURATION_SECONDS));
  const directedProgress = mechanic.direction === "outbound" ? progress : 1 - progress;
  const settled = reduceMotion || progress >= 1;
  if (settled) {
    return {
      progress,
      directedProgress: mechanic.direction === "outbound" ? 1 : 0,
      envelope: 0,
      sourceStrength: 0.16,
      targetStrength: 0.46,
      settled: true
    };
  }

  const envelope = Math.sin(progress * Math.PI);
  return {
    progress,
    directedProgress,
    envelope,
    sourceStrength: Math.max(0, 1 - progress * 1.9) * (0.7 + envelope * 0.3),
    targetStrength: Math.max(0, Math.min(1, (progress - 0.38) / 0.62)) * (0.66 + envelope * 0.34),
    settled: false
  };
}
