import type { AgentRecord, AppSnapshot } from "@tyr-ai/contracts";

export const WORKSPACE_SPATIAL_HUMAN_MESSAGE_WINDOW_MS = 30_000;
export const WORKSPACE_SPATIAL_HUMAN_HANDOFF_MS = 650;
const WORKSPACE_SPATIAL_HUMAN_ARRIVAL_MS = 700;

export type WorkspaceSpatialHumanJourney = {
  id: string;
  messageId: string;
  workspaceId: string;
  humanId: string;
  humanDisplayName: string;
  targetAgentId: string;
  targetDisplayName: string;
  targetIsController: boolean;
  createdAt: string;
};

export type WorkspaceSpatialHumanJourneyStage = "outbound" | "handoff" | "returning" | "arrived" | "complete";
export type WorkspaceSpatialHumanJourneyState = {
  progress: number;
  stage: WorkspaceSpatialHumanJourneyStage;
  stageElapsedMs: number;
};

type HumanJourneySnapshot = Pick<AppSnapshot, "currentUser" | "channels" | "messages" | "agents">;

/** 仅由已经写入服务端真源的 Human DM 消息创建视觉交接，不读取或复制消息正文。 */
export function workspaceSpatialHumanJourneys(
  snapshot: HumanJourneySnapshot,
  workspaceId: string,
  nowMs = Date.now(),
  windowMs = WORKSPACE_SPATIAL_HUMAN_MESSAGE_WINDOW_MS
): WorkspaceSpatialHumanJourney[] {
  const channels = new Map((snapshot.channels ?? []).map((channel) => [channel.id, channel]));
  const agents = new Map((snapshot.agents ?? []).filter((agent) => !agent.deletedAt).map((agent) => [agent.id, agent]));
  return (snapshot.messages ?? []).flatMap((message): WorkspaceSpatialHumanJourney[] => {
    if (message.senderType !== "human" || message.senderId !== snapshot.currentUser.id || message.deletedAt) return [];
    const createdAtMs = Date.parse(message.createdAt);
    if (!Number.isFinite(createdAtMs) || createdAtMs > nowMs + 5_000 || nowMs - createdAtMs > windowMs) return [];
    const channel = channels.get(message.channelId);
    if (!channel || channel.type !== "dm" || !channel.dmPeerAgentId) return [];
    const target = agents.get(channel.dmPeerAgentId);
    if (!target) return [];
    return [{
      id: `human-message:${message.id}`,
      messageId: message.id,
      workspaceId,
      humanId: snapshot.currentUser.id,
      humanDisplayName: snapshot.currentUser.displayName || snapshot.currentUser.name,
      targetAgentId: target.id,
      targetDisplayName: target.displayName,
      targetIsController: target.kind === "communication",
      createdAt: message.createdAt
    }];
  }).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export function workspaceSpatialHumanJourneyInitialState(): WorkspaceSpatialHumanJourneyState {
  return { progress: 0, stage: "outbound", stageElapsedMs: 0 };
}

/** Human 只负责把已提交的消息交给目标角色；短暂交流后立即返回，不等待 Agent 执行结束。 */
export function workspaceSpatialHumanJourneyFrame(
  state: WorkspaceSpatialHumanJourneyState,
  input: { deltaSeconds: number; routeLength: number; reduceMotion?: boolean }
): WorkspaceSpatialHumanJourneyState {
  if (state.stage === "complete") return state;
  const next = { ...state };
  const elapsedMs = Math.min(Math.max(input.deltaSeconds, 0), 0.1) * 1_000;
  next.stageElapsedMs += elapsedMs;
  const moveTo = (stage: WorkspaceSpatialHumanJourneyStage) => {
    next.stage = stage;
    next.stageElapsedMs = 0;
  };
  if (next.stage === "handoff" && next.stageElapsedMs >= WORKSPACE_SPATIAL_HUMAN_HANDOFF_MS) moveTo("returning");
  if (next.stage === "arrived" && next.stageElapsedMs >= WORKSPACE_SPATIAL_HUMAN_ARRIVAL_MS) moveTo("complete");
  const target = next.stage === "outbound" ? 1 : next.stage === "returning" ? 0 : next.progress;
  if (target !== next.progress) {
    const step = input.routeLength > 0 ? 3.2 * elapsedMs / 1_000 / input.routeLength : 1;
    next.progress = input.reduceMotion || Math.abs(target - next.progress) <= step
      ? target
      : next.progress + Math.sign(target - next.progress) * step;
  }
  if (next.stage === "outbound" && next.progress >= 0.998) moveTo("handoff");
  if (next.stage === "returning" && next.progress <= 0.002) moveTo("arrived");
  return next;
}

export function workspaceSpatialHumanJourneyLabel(state: WorkspaceSpatialHumanJourneyState, target: string): string {
  if (state.stage === "outbound") return `Walking to ${target}`;
  if (state.stage === "handoff") return `Sending message to ${target}`;
  if (state.stage === "returning") return "Returning to your place";
  return state.stage === "arrived" ? "Message delivered" : "Ready";
}

export function readPlayedWorkspaceSpatialHumanJourneys(
  storage: Pick<Storage, "getItem">,
  workspaceId: string
): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`tyr:human-journeys:v1:${workspaceId}`) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(-256) : []);
  } catch {
    return new Set();
  }
}

export function savePlayedWorkspaceSpatialHumanJourneys(
  storage: Pick<Storage, "setItem">,
  workspaceId: string,
  ids: ReadonlySet<string>
): void {
  try {
    storage.setItem(`tyr:human-journeys:v1:${workspaceId}`, JSON.stringify([...ids].slice(-256)));
  } catch {
    // 隐私模式或存储配额不足时，只影响刷新后的视觉去重。
  }
}

export function readWorkspaceSpatialHumanJourneyCheckpoint(
  storage: Pick<Storage, "getItem">,
  workspaceId: string,
  journeyId: string
): WorkspaceSpatialHumanJourneyState | undefined {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`tyr:human-journey-state:v1:${workspaceId}`) ?? "{}");
    if (!parsed || typeof parsed !== "object") return undefined;
    const state = (parsed as Record<string, WorkspaceSpatialHumanJourneyState>)[journeyId];
    if (!state || !["outbound", "handoff", "returning", "arrived", "complete"].includes(state.stage)) return undefined;
    if (!Number.isFinite(state.progress) || state.progress < 0 || state.progress > 1 || !Number.isFinite(state.stageElapsedMs)) return undefined;
    return state;
  } catch {
    return undefined;
  }
}

export function saveWorkspaceSpatialHumanJourneyCheckpoint(
  storage: Pick<Storage, "getItem" | "setItem">,
  workspaceId: string,
  journeyId: string,
  state: WorkspaceSpatialHumanJourneyState
): void {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`tyr:human-journey-state:v1:${workspaceId}`) ?? "{}");
    const checkpoints = parsed && typeof parsed === "object"
      ? { ...(parsed as Record<string, WorkspaceSpatialHumanJourneyState>) }
      : {};
    checkpoints[journeyId] = state;
    const bounded = Object.fromEntries(Object.entries(checkpoints).slice(-32));
    storage.setItem(`tyr:human-journey-state:v1:${workspaceId}`, JSON.stringify(bounded));
  } catch {
    // 检查点不可用时，消息事实和真实执行不受影响。
  }
}

export function workspaceSpatialHumanTargetAgent(
  agents: readonly AgentRecord[],
  journey: WorkspaceSpatialHumanJourney
): AgentRecord | undefined {
  return agents.find((agent) => agent.id === journey.targetAgentId && !agent.deletedAt);
}
