import type { CommunicationAgentProgressRecord } from "@tyr-ai/contracts";

export const COMMUNICATION_AGENT_PROGRESS_DELAY_MS = 300;
export const COMMUNICATION_AGENT_PROGRESS_LONG_RUNNING_MS = 30_000;
// 这是请求理解阶段的临时反馈；Agent handoff 后由 Runtime Execution tracker 接管，避免异常断线留下半小时的陈旧状态。
export const COMMUNICATION_AGENT_PROGRESS_STALE_MS = 90_000;

const PROGRESS_PHASES = new Set<CommunicationAgentProgressRecord["phase"]>([
  "understanding",
  "running_action",
  "preparing_response",
  "completed",
  "needs_input",
  "failed"
]);
const PROGRESS_SOURCES = new Set<CommunicationAgentProgressRecord["source"]>([
  "web",
  "mcp",
  "telegram",
  "email"
]);

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function communicationAgentProgressFromPayload(payload: unknown): CommunicationAgentProgressRecord | null {
  const progress = payload && typeof payload === "object"
    ? (payload as { progress?: unknown }).progress
    : null;
  if (!progress || typeof progress !== "object") return null;
  const value = progress as Record<string, unknown>;
  // 旧服务端只会为 Web 发送无 source 事件；滚动升级期间按 Web 兼容，不接受未知显式来源。
  const source = value.source === undefined
    ? "web"
    : typeof value.source === "string" && PROGRESS_SOURCES.has(value.source as CommunicationAgentProgressRecord["source"])
      ? value.source as CommunicationAgentProgressRecord["source"]
      : null;
  if (
    typeof value.operationId !== "string" ||
    typeof value.sourceMessageId !== "string" ||
    typeof value.channelId !== "string" ||
    typeof value.assistantAgentId !== "string" ||
    !source ||
    typeof value.phase !== "string" ||
    !PROGRESS_PHASES.has(value.phase as CommunicationAgentProgressRecord["phase"]) ||
    typeof value.label !== "string" ||
    typeof value.startedAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    timestamp(value.startedAt) === 0 ||
    timestamp(value.updatedAt) === 0
  ) {
    return null;
  }
  return {
    operationId: value.operationId,
    sourceMessageId: value.sourceMessageId,
    channelId: value.channelId,
    ...(typeof value.conversationId === "string" && value.conversationId ? { conversationId: value.conversationId } : {}),
    assistantAgentId: value.assistantAgentId,
    source,
    phase: value.phase as CommunicationAgentProgressRecord["phase"],
    label: value.label,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt
  };
}

export function communicationAgentProgressSourceLabel(
  source: CommunicationAgentProgressRecord["source"]
): string | null {
  if (source === "mcp") return "via MCP";
  if (source === "telegram") return "via Telegram";
  if (source === "email") return "via Email";
  return null;
}

export function isCommunicationAgentProgressTerminal(progress: CommunicationAgentProgressRecord): boolean {
  return progress.phase === "completed" || progress.phase === "needs_input" || progress.phase === "failed";
}

export function pruneCommunicationAgentProgress(
  progress: CommunicationAgentProgressRecord[],
  now = Date.now()
): CommunicationAgentProgressRecord[] {
  return progress.filter((item) => now - timestamp(item.updatedAt) < COMMUNICATION_AGENT_PROGRESS_STALE_MS);
}

export function applyCommunicationAgentProgressEvent(
  current: CommunicationAgentProgressRecord[],
  payload: unknown,
  now = Date.now()
): CommunicationAgentProgressRecord[] {
  const progress = communicationAgentProgressFromPayload(payload);
  const active = pruneCommunicationAgentProgress(current, now);
  if (!progress) return active;
  const withoutOperation = active.filter((item) => item.operationId !== progress.operationId);
  // 终态只负责清理临时状态，正式结果仍由 message:new 进入聊天历史。
  if (isCommunicationAgentProgressTerminal(progress)) return withoutOperation;
  return [...withoutOperation, progress].sort((left, right) => timestamp(left.updatedAt) - timestamp(right.updatedAt));
}

export function clearCommunicationAgentProgressForSourceMessage(
  current: CommunicationAgentProgressRecord[],
  sourceMessageId: string,
  now = Date.now()
): CommunicationAgentProgressRecord[] {
  // 最终消息是持久化真源；即使终态 realtime 丢失，也只清理与其精确关联的临时进度。
  return pruneCommunicationAgentProgress(current, now)
    .filter((item) => item.sourceMessageId !== sourceMessageId);
}

export function activeCommunicationAgentProgress(
  progress: CommunicationAgentProgressRecord[],
  input: { channelId?: string; conversationId?: string; assistantAgentId?: string },
  now = Date.now()
): CommunicationAgentProgressRecord | null {
  const matches = pruneCommunicationAgentProgress(progress, now).filter((item) => (
    item.channelId === input.channelId &&
    item.assistantAgentId === input.assistantAgentId &&
    (!input.conversationId || item.conversationId === input.conversationId)
  ));
  return matches.sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))[0] ?? null;
}

export function communicationAgentProgressDisplayLabel(
  progress: CommunicationAgentProgressRecord,
  now = Date.now()
): string | null {
  const elapsed = now - timestamp(progress.startedAt);
  if (elapsed < COMMUNICATION_AGENT_PROGRESS_DELAY_MS) return null;
  if (elapsed >= COMMUNICATION_AGENT_PROGRESS_LONG_RUNNING_MS) return "Taking longer than expected...";
  return progress.label;
}
