import type {
  CommunicationAgentProgressRecord,
  TopologyLiveActivityRecord
} from "@tyr-ai/contracts";
import { topologyLiveActivityLabel } from "./livingTopologyActivity";

export type LivingTopologyNodeKind = "server" | "device" | "bridge" | "tyr" | "agent" | "other";
export type LivingTopologyNodeHealth = "online" | "offline" | "degraded" | "error";
export type LivingTopologyNodePhase =
  | "idle"
  | "offline"
  | "waiting"
  | "receiving"
  | "thinking"
  | "tool"
  | "approval"
  | "communicating"
  | "sending"
  | "success"
  | "error"
  | "cancelled";
export type LivingTopologyFlowRole = "none" | "source" | "relay" | "target";
export type LivingTopologyNodeTone = "neutral" | "blue" | "violet" | "amber" | "green" | "red";
export type LivingTopologyNodeMotion = "none" | "breathe" | "rotate" | "flow" | "settle";
export type LivingTopologyNodeStateSource = "resource" | "activity" | "progress" | "flow" | "aggregate";

export const LIVING_TOPOLOGY_PALETTE: Record<LivingTopologyNodeTone, { accent: string; glow: string }> = {
  neutral: { accent: "#94a3b8", glow: "#d5e0e7" },
  blue: { accent: "#149cff", glow: "#55d4ff" },
  violet: { accent: "#8b7ee8", glow: "#c0b8ff" },
  amber: { accent: "#e7a52f", glow: "#ffd479" },
  green: { accent: "#32ad7f", glow: "#75efc1" },
  red: { accent: "#db595f", glow: "#ff9298" }
};

export type LivingTopologyNodeFlow = {
  id: string;
  role: Exclude<LivingTopologyFlowRole, "none">;
  tone: "request" | "response" | "error";
  continuous: boolean;
  activeCount?: number;
  createdAt?: string;
};

export type LivingTopologyNodeState = {
  kind: LivingTopologyNodeKind;
  health: LivingTopologyNodeHealth;
  phase: LivingTopologyNodePhase;
  flowRole: LivingTopologyFlowRole;
  tone: LivingTopologyNodeTone;
  motion: LivingTopologyNodeMotion;
  continuous: boolean;
  terminal: boolean;
  activeCount: number;
  primarySignalId?: string;
  startedAt?: string;
  label: string;
  source: LivingTopologyNodeStateSource;
};

export type LivingTopologyNodeStateInput = {
  kind: LivingTopologyNodeKind;
  resourceStatus?: string;
  activity?: TopologyLiveActivityRecord;
  progress?: CommunicationAgentProgressRecord;
  flow?: LivingTopologyNodeFlow;
  aggregateStates?: readonly LivingTopologyNodeState[];
};

const PHASE_PRIORITY: Record<LivingTopologyNodePhase, number> = {
  error: 0,
  approval: 1,
  tool: 2,
  sending: 3,
  receiving: 3,
  communicating: 3,
  thinking: 4,
  waiting: 5,
  success: 6,
  cancelled: 7,
  idle: 8,
  offline: 9
};

function resourceHealth(status?: string): LivingTopologyNodeHealth {
  if (status === "offline" || status === "revoked") return "offline";
  if (status === "error") return "error";
  if (status === "degraded" || status === "pending") return "degraded";
  return "online";
}

function state(
  input: LivingTopologyNodeStateInput,
  values: Omit<LivingTopologyNodeState, "kind" | "health">
): LivingTopologyNodeState {
  return {
    kind: input.kind,
    health: resourceHealth(input.resourceStatus),
    ...values
  };
}

function stateForActivity(input: LivingTopologyNodeStateInput, activity: TopologyLiveActivityRecord): LivingTopologyNodeState {
  const common = {
    flowRole: "none" as const,
    activeCount: 1,
    primarySignalId: activity.id,
    startedAt: activity.createdAt,
    label: topologyLiveActivityLabel(activity.kind),
    source: "activity" as const
  };
  if (activity.kind === "waiting_approval") return state(input, { ...common, phase: "approval", tone: "amber", motion: "breathe", continuous: true, terminal: false });
  if (activity.kind === "tool_running") return state(input, { ...common, phase: "tool", tone: "violet", motion: "rotate", continuous: true, terminal: false });
  if (activity.kind === "thinking") return state(input, { ...common, phase: "thinking", tone: "blue", motion: "breathe", continuous: true, terminal: false });
  if (activity.kind === "queued" || activity.kind === "delivered") return state(input, { ...common, phase: "waiting", tone: "blue", motion: "breathe", continuous: true, terminal: false });
  if (activity.kind === "completed") return state(input, { ...common, phase: "success", tone: "green", motion: "settle", continuous: false, terminal: true });
  if (activity.kind === "failed" || activity.kind === "stalled") return state(input, { ...common, phase: "error", tone: "red", motion: "settle", continuous: false, terminal: true });
  return state(input, { ...common, phase: "cancelled", tone: "neutral", motion: "none", continuous: false, terminal: true });
}

function stateForProgress(input: LivingTopologyNodeStateInput, progress: CommunicationAgentProgressRecord): LivingTopologyNodeState {
  const common = {
    flowRole: "none" as const,
    activeCount: 1,
    primarySignalId: progress.operationId,
    startedAt: progress.startedAt,
    label: progress.label,
    source: "progress" as const
  };
  if (progress.phase === "understanding") return state(input, { ...common, phase: "thinking", tone: "blue", motion: "breathe", continuous: true, terminal: false });
  if (progress.phase === "running_action") return state(input, { ...common, phase: "communicating", tone: "blue", motion: "rotate", continuous: true, terminal: false });
  if (progress.phase === "preparing_response") return state(input, { ...common, phase: "sending", tone: "blue", motion: "rotate", continuous: true, terminal: false });
  if (progress.phase === "completed") return state(input, { ...common, phase: "success", tone: "green", motion: "settle", continuous: false, terminal: true });
  if (progress.phase === "needs_input") return state(input, { ...common, phase: "waiting", tone: "amber", motion: "settle", continuous: false, terminal: true });
  return state(input, { ...common, phase: "error", tone: "red", motion: "settle", continuous: false, terminal: true });
}

function primaryAggregateState(states: readonly LivingTopologyNodeState[]): LivingTopologyNodeState | undefined {
  return states
    // Server 只汇总真实活动；子资源自身的静态 error / pending 仍由各卡片状态点表达。
    .filter((item) => item.activeCount > 0 && item.phase !== "idle" && item.phase !== "offline" && item.phase !== "cancelled")
    .sort((left, right) => {
      const priority = PHASE_PRIORITY[left.phase] - PHASE_PRIORITY[right.phase];
      if (priority !== 0) return priority;
      return (right.startedAt ?? "").localeCompare(left.startedAt ?? "");
    })[0];
}

function aggregateActiveCount(states: readonly LivingTopologyNodeState[]): number {
  const identified = new Map<string, number>();
  let unidentified = 0;
  for (const item of states) {
    if (item.activeCount <= 0) continue;
    if (!item.primarySignalId) {
      unidentified += item.activeCount;
      continue;
    }
    // 同一条消息会同时点亮 TYR、Device 与 Agent；Server 汇总时按 signal 去重，不能按节点重复计数。
    identified.set(item.primarySignalId, Math.max(identified.get(item.primarySignalId) ?? 0, item.activeCount));
  }
  return [...identified.values()].reduce((count, value) => count + value, unidentified);
}

export function resolveLivingTopologyNodeState(input: LivingTopologyNodeStateInput): LivingTopologyNodeState {
  const health = resourceHealth(input.resourceStatus);
  // 资源可用性是硬边界：迟到的 activity 或 Flow 不能重新点亮离线节点。
  if (health === "offline") {
    return state(input, { phase: "offline", flowRole: "none", tone: "neutral", motion: "none", continuous: false, terminal: false, activeCount: 0, label: "Offline", source: "resource" });
  }
  if (health === "error") {
    return state(input, { phase: "error", flowRole: "none", tone: "red", motion: "none", continuous: false, terminal: false, activeCount: 0, label: "Error", source: "resource" });
  }

  // Runtime activity 比途经 Flow 更具体，因此存在时由它决定节点主状态。
  if (input.activity) return stateForActivity(input, input.activity);
  if (input.progress) return stateForProgress(input, input.progress);
  if (input.flow) {
    const phase = input.flow.tone === "error"
      ? "error"
      : input.flow.role === "source"
        ? "sending"
        : input.flow.role === "target"
          ? "receiving"
          : "communicating";
    return state(input, {
      phase,
      flowRole: input.flow.role,
      tone: input.flow.tone === "error" ? "red" : "blue",
      motion: input.flow.tone === "error" ? "settle" : "flow",
      continuous: input.flow.continuous,
      terminal: input.flow.tone === "error" && !input.flow.continuous,
      activeCount: input.flow.activeCount ?? 1,
      primarySignalId: input.flow.id,
      startedAt: input.flow.createdAt,
      label: input.flow.tone === "error"
        ? "Message failed"
        : input.flow.role === "source"
          ? "Sending"
          : input.flow.role === "target"
            ? "Receiving"
            : "Relaying",
      source: "flow"
    });
  }

  const aggregate = input.aggregateStates ? primaryAggregateState(input.aggregateStates) : undefined;
  if (aggregate) {
    return state(input, {
      phase: aggregate.phase,
      flowRole: aggregate.flowRole,
      tone: aggregate.tone,
      motion: aggregate.motion,
      continuous: aggregate.continuous,
      terminal: aggregate.terminal,
      activeCount: aggregateActiveCount(input.aggregateStates ?? [aggregate]),
      primarySignalId: aggregate.primarySignalId,
      startedAt: aggregate.startedAt,
      label: aggregate.label,
      source: "aggregate"
    });
  }

  if (input.resourceStatus === "pending") {
    return state(input, { phase: "waiting", flowRole: "none", tone: "amber", motion: "none", continuous: false, terminal: false, activeCount: 0, label: "Pending", source: "resource" });
  }
  if (input.resourceStatus === "communicating") {
    return state(input, { phase: "communicating", flowRole: "relay", tone: "blue", motion: "flow", continuous: true, terminal: false, activeCount: 1, label: "Communicating", source: "resource" });
  }
  return state(input, { phase: "idle", flowRole: "none", tone: "green", motion: "none", continuous: false, terminal: false, activeCount: 0, label: "Online", source: "resource" });
}

export function livingTopologyNodeStateKey(value: LivingTopologyNodeState): string {
  return [
    value.kind,
    value.health,
    value.phase,
    value.flowRole,
    value.tone,
    value.motion,
    value.continuous ? "continuous" : "finite",
    value.terminal ? "terminal" : "active",
    value.activeCount,
    value.primarySignalId ?? "",
    value.startedAt ?? "",
    value.label,
    value.source
  ].join(":");
}
