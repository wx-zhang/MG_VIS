import {
  workspaceSpatialSceneHasMessageAttention,
  workspaceSpatialSceneNeedsAnimation,
  type WorkspaceSpatialAgent,
  type WorkspaceSpatialRoom,
  type WorkspaceSpatialScene
} from "./workspaceSpatial";

export type WorkspaceSpatialAmbientKind = "stretch" | "status_check" | "refresh_break";

export type WorkspaceSpatialAmbientAssignment = {
  id: string;
  eligibilityKey: string;
  workspaceId: string;
  roomId: string;
  agentId: string;
  kind: WorkspaceSpatialAmbientKind;
  startedAtMs: number;
  returnAtMs: number;
  endsAtMs: number;
  cancelledAtMs?: number;
};

export type WorkspaceSpatialAmbientCadence = {
  eligibilityKey: string;
  cycle: number;
  phase: "opening" | "cooldown";
  waitMs: number;
  scheduledAtMs: number;
};

export const WORKSPACE_SPATIAL_AMBIENT_OPENING_MIN_MS = 4_000;
export const WORKSPACE_SPATIAL_AMBIENT_OPENING_MAX_MS = 8_000;
export const WORKSPACE_SPATIAL_AMBIENT_COOLDOWN_MIN_MS = 4 * 60_000;
export const WORKSPACE_SPATIAL_AMBIENT_COOLDOWN_MAX_MS = 6 * 60_000;
export const WORKSPACE_SPATIAL_MAX_AMBIENT_AGENTS = 2;

const STRETCH_DURATION_MS = 5_200;
const STATUS_CHECK_RETURN_MS = 6_400;
const STATUS_CHECK_DURATION_MS = 9_600;
const REFRESH_BREAK_RETURN_MS = 10_500;
const REFRESH_BREAK_DURATION_MS = 15_000;
const AMBIENT_STATION_CANCEL_RETURN_MS = 4_200;

const AMBIENT_KINDS: readonly WorkspaceSpatialAmbientKind[] = ["stretch", "status_check", "refresh_break"];

type AmbientRoomCandidate = {
  room: WorkspaceSpatialRoom;
  agents: WorkspaceSpatialAgent[];
};

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicDuration(key: string, minimumMs: number, maximumMs: number): number {
  return minimumMs + stableHash(key) % (maximumMs - minimumMs + 1);
}

function ambientRoomCandidates(scene: WorkspaceSpatialScene): AmbientRoomCandidate[] {
  return scene.current.rooms
    .filter((room) => room.status === "online")
    .map((room) => ({
      room,
      // ambient 只使用当前 Workspace 中明确 online、无 activity 的普通 Agent。
      agents: room.visibleAgents.filter((agent) => (
        agent.local
        && !agent.controller
        && agent.state === "online"
        && !agent.activity
      ))
    }))
    .filter((candidate) => candidate.agents.length > 0)
    .sort((left, right) => left.room.id.localeCompare(right.room.id));
}

export function workspaceSpatialAmbientEligibilityKey(scene: WorkspaceSpatialScene): string {
  if (workspaceSpatialSceneHasMessageAttention(scene)) return "blocked:message-attention";
  if (workspaceSpatialSceneNeedsAnimation(scene)) return "blocked:authoritative-work";
  const candidates = ambientRoomCandidates(scene);
  if (candidates.length === 0) return "idle:none";
  return [
    "idle",
    scene.current.id,
    ...candidates.map(({ room, agents }) => `${room.id}:${agents.map((agent) => agent.id).sort().join(",")}`)
  ].join("|");
}

export function workspaceSpatialAmbientCadence(
  eligibilityKey: string,
  anchorAtMs: number,
  cycle: number
): WorkspaceSpatialAmbientCadence | null {
  if (!eligibilityKey.startsWith("idle|")) return null;
  const boundedCycle = Math.max(0, Math.floor(cycle));
  const phase = boundedCycle === 0 ? "opening" : "cooldown";
  // 首轮用有限 Opening Shift 快速证明空间有人使用；后续仍保持数分钟冷却，不形成循环表演。
  const waitMs = phase === "opening"
    ? deterministicDuration(
        `${eligibilityKey}:${boundedCycle}:opening`,
        WORKSPACE_SPATIAL_AMBIENT_OPENING_MIN_MS,
        WORKSPACE_SPATIAL_AMBIENT_OPENING_MAX_MS
      )
    : deterministicDuration(
        `${eligibilityKey}:${boundedCycle}:cooldown`,
        WORKSPACE_SPATIAL_AMBIENT_COOLDOWN_MIN_MS,
        WORKSPACE_SPATIAL_AMBIENT_COOLDOWN_MAX_MS
      );
  return {
    eligibilityKey,
    cycle: boundedCycle,
    phase,
    waitMs,
    scheduledAtMs: anchorAtMs + waitMs
  };
}

export function workspaceSpatialAmbientAssignments(
  scene: WorkspaceSpatialScene,
  startedAtMs: number,
  cadenceCycle = 0,
  previousAssignments: WorkspaceSpatialAmbientAssignment[] = []
): WorkspaceSpatialAmbientAssignment[] {
  const eligibilityKey = workspaceSpatialAmbientEligibilityKey(scene);
  if (!eligibilityKey.startsWith("idle|")) return [];

  const cycle = Math.max(0, Math.floor(cadenceCycle));
  const candidates = ambientRoomCandidates(scene)
    .map((candidate) => ({ candidate, rank: stableHash(`${eligibilityKey}:${cycle}:${candidate.room.id}`) }))
    .sort((left, right) => left.rank - right.rank || left.candidate.room.id.localeCompare(right.candidate.room.id))
    .slice(0, WORKSPACE_SPATIAL_MAX_AMBIENT_AGENTS);
  const firstKindOffset = stableHash(`${eligibilityKey}:${cycle}:kind`) % AMBIENT_KINDS.length;
  const previousKindByAgentId = new Map(previousAssignments.map((assignment) => [assignment.agentId, assignment.kind]));

  return candidates.map(({ candidate }, index) => {
    const agentIndex = stableHash(`${eligibilityKey}:${cycle}:${candidate.room.id}:agent`) % candidate.agents.length;
    const agent = candidate.agents[agentIndex];
    // 并发房间轮换三种日常行为，避免整个 Campus 同时执行同一种“编舞”。
    let kind = AMBIENT_KINDS[(index + firstKindOffset) % AMBIENT_KINDS.length]!;
    // 同一 Agent 连续被选中时必须换动作，防止长时间页面出现机械重复。
    if (previousKindByAgentId.get(agent.id) === kind) {
      kind = AMBIENT_KINDS[(AMBIENT_KINDS.indexOf(kind) + 1) % AMBIENT_KINDS.length]!;
    }
    const returnAtMs = kind === "status_check"
      ? startedAtMs + STATUS_CHECK_RETURN_MS
      : kind === "refresh_break"
        ? startedAtMs + REFRESH_BREAK_RETURN_MS
        : startedAtMs;
    const endsAtMs = startedAtMs + (kind === "status_check"
      ? STATUS_CHECK_DURATION_MS
      : kind === "refresh_break"
        ? REFRESH_BREAK_DURATION_MS
        : STRETCH_DURATION_MS);
    return {
      id: `ambient:${cycle}:${startedAtMs}:${candidate.room.id}:${agent.id}:${kind}`,
      eligibilityKey,
      workspaceId: scene.current.id,
      roomId: candidate.room.id,
      agentId: agent.id,
      kind,
      startedAtMs,
      returnAtMs,
      endsAtMs
    };
  });
}

export function workspaceSpatialCancelAmbientAssignments(
  assignments: WorkspaceSpatialAmbientAssignment[],
  cancelledAtMs: number
): WorkspaceSpatialAmbientAssignment[] {
  // stretch 可直接停止；离开 seat 的两种行为保留仅用于回座的有限驱动窗口，不继续显示 ambient 姿态或设备反馈。
  return assignments
    .filter((assignment) => assignment.kind !== "stretch" && assignment.endsAtMs > cancelledAtMs)
    .map((assignment) => assignment.cancelledAtMs === undefined
      ? {
          ...assignment,
          returnAtMs: cancelledAtMs,
          endsAtMs: cancelledAtMs + AMBIENT_STATION_CANCEL_RETURN_MS,
          cancelledAtMs
        }
      : assignment);
}

export function workspaceSpatialAmbientIsActive(
  assignment: WorkspaceSpatialAmbientAssignment | undefined,
  nowMs: number
): assignment is WorkspaceSpatialAmbientAssignment {
  return Boolean(
    assignment
    && assignment.cancelledAtMs === undefined
    && nowMs >= assignment.startedAtMs
    && nowMs < assignment.endsAtMs
  );
}

export function workspaceSpatialAmbientUsesUtilityPoint(
  assignment: WorkspaceSpatialAmbientAssignment | undefined,
  nowMs: number
): boolean {
  return workspaceSpatialAmbientIsActive(assignment, nowMs)
    && assignment.kind === "status_check"
    && nowMs < assignment.returnAtMs;
}

export function workspaceSpatialAmbientUsesRefreshPoint(
  assignment: WorkspaceSpatialAmbientAssignment | undefined,
  nowMs: number
): boolean {
  return workspaceSpatialAmbientIsActive(assignment, nowMs)
    && assignment.kind === "refresh_break"
    && nowMs < assignment.returnAtMs;
}
