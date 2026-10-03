import type { WorkspaceSpatialAgentState } from "./workspaceSpatial";
import type { WorkspaceSpatialMotionMarker, WorkspaceSpatialMotionMode } from "./workspaceSpatialMotion";

export type WorkspaceSpatialAgentTextMode = "none" | "name" | "status";

export type WorkspaceSpatialAgentTextCandidate = {
  id: string;
  state: WorkspaceSpatialAgentState;
  motionMode: WorkspaceSpatialMotionMode;
  marker: WorkspaceSpatialMotionMarker;
  roomKey: string;
  layoutIndex: number;
  selected: boolean;
  hovered: boolean;
};

export const WORKSPACE_SPATIAL_OVERVIEW_TEXT_BUDGET = 8;
export const WORKSPACE_SPATIAL_OVERVIEW_IDLE_TEXT_BUDGET = 3;

function candidateTextMode(candidate: WorkspaceSpatialAgentTextCandidate): WorkspaceSpatialAgentTextMode {
  return candidate.marker === "none" ? "name" : "status";
}

function candidateIsUrgent(candidate: WorkspaceSpatialAgentTextCandidate): boolean {
  // 思考摘要、审批、错误和显式交互是不可丢失信息，即使超出全景预算也必须保留文字。
  return candidate.selected
    || candidate.hovered
    || candidate.motionMode === "thinking"
    || candidate.state === "error"
    || candidate.motionMode === "approval"
    || candidate.motionMode === "error";
}

function candidateIsActive(candidate: WorkspaceSpatialAgentTextCandidate): boolean {
  // 普通工作状态优先于在线/空闲名称，但仍受密集全景的文字预算约束。
  return candidate.state === "working"
    || candidate.state === "communicating"
    || (candidate.motionMode !== "idle" && candidate.motionMode !== "offline");
}

function layoutSpaced(candidates: WorkspaceSpatialAgentTextCandidate[]): WorkspaceSpatialAgentTextCandidate[] {
  // 工位按 row-major 排列；先取棋盘格中的一半，避免有限预算再次集中到相邻人物头顶。
  return [...candidates].sort((left, right) => (
    left.layoutIndex % 2 - right.layoutIndex % 2
    || left.layoutIndex - right.layoutIndex
  ));
}

export function workspaceSpatialAgentTextModes(
  candidates: WorkspaceSpatialAgentTextCandidate[],
  focusedRoomKey: string | null
): Record<string, WorkspaceSpatialAgentTextMode> {
  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
  const modes: Record<string, WorkspaceSpatialAgentTextMode> = {};
  for (const candidate of uniqueCandidates) modes[candidate.id] = "none";

  const urgent = uniqueCandidates.filter(candidateIsUrgent);
  for (const candidate of urgent) modes[candidate.id] = candidateTextMode(candidate);

  if (focusedRoomKey) {
    // 房间聚焦只恢复目标房间的完整 roster；背景仍仅保留真实工作与交互对象。
    for (const candidate of uniqueCandidates) {
      if (candidate.roomKey === focusedRoomKey) modes[candidate.id] = candidateTextMode(candidate);
    }
    return modes;
  }

  let remainingText = Math.max(0, WORKSPACE_SPATIAL_OVERVIEW_TEXT_BUDGET - urgent.length);
  const active = layoutSpaced(uniqueCandidates.filter((candidate) => (
    !candidateIsUrgent(candidate) && candidateIsActive(candidate)
  )));
  for (const candidate of active.slice(0, remainingText)) modes[candidate.id] = candidateTextMode(candidate);
  remainingText = Math.max(0, remainingText - active.length);

  const ordinaryOnline = layoutSpaced(uniqueCandidates.filter((candidate) => (
    !candidateIsUrgent(candidate) && !candidateIsActive(candidate) && candidate.state !== "offline"
  )));
  // 全景只保留少量 Idle 名称；工作状态仍可占满总预算，聚焦房间则恢复完整 roster。
  for (const candidate of ordinaryOnline.slice(0, Math.min(remainingText, WORKSPACE_SPATIAL_OVERVIEW_IDLE_TEXT_BUDGET))) {
    modes[candidate.id] = candidateTextMode(candidate);
  }
  return modes;
}
