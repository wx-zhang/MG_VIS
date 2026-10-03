import type { CrossWorkspaceMessageRecord, TopologyCommunicationFlowRecord } from "@tyr-ai/contracts";

export type BridgeCommunicationMessage = Pick<
  CrossWorkspaceMessageRecord,
  "id" | "sourceWorkspaceId" | "targetWorkspaceId" | "outcome" | "responseKind" | "replyToMessageId" | "createdAt" | "updatedAt"
>;

export type CommunicationFlowTone = "request" | "response" | "error";
export type CommunicationFlowDirection = "outbound" | "inbound";

export type BridgeCommunicationFlowSignal = {
  id: string;
  messageId: string;
  direction: CommunicationFlowDirection;
  tone: CommunicationFlowTone;
  continuous: boolean;
  createdAt: string;
};

type BridgeLinkedExecutionFlow = Pick<
  TopologyCommunicationFlowRecord,
  "id" | "bridgeRequestMessageId" | "tone" | "continuous" | "updatedAt"
>;

export const TRANSIENT_COMMUNICATION_WINDOW_MS = 8_000;

function bridgeMessageTone(message: BridgeCommunicationMessage): CommunicationFlowTone {
  if (message.outcome === "failed" || message.responseKind === "error") return "error";
  // responseKind / replyToMessageId 由服务端写入，不能仅凭 initiatedBy 推测 Agent 消息一定是回复。
  if (message.responseKind === "ack" || message.responseKind === "final" || message.replyToMessageId) return "response";
  return "request";
}

function messageAgeMs(message: BridgeCommunicationMessage, nowMs: number): number {
  const activityAt = Date.parse(message.updatedAt ?? message.createdAt);
  return Number.isFinite(activityAt) ? Math.max(0, nowMs - activityAt) : Number.POSITIVE_INFINITY;
}

function flowAgeMs(flow: BridgeLinkedExecutionFlow, nowMs: number): number {
  const activityAt = Date.parse(flow.updatedAt);
  return Number.isFinite(activityAt) ? Math.max(0, nowMs - activityAt) : Number.POSITIVE_INFINITY;
}

function bridgeMessageDirection(
  message: BridgeCommunicationMessage,
  currentWorkspaceId: string
): CommunicationFlowDirection | null {
  if (message.sourceWorkspaceId === currentWorkspaceId) return "outbound";
  if (message.targetWorkspaceId === currentWorkspaceId) return "inbound";
  return null;
}

function preferredBridgeSignal(
  current: BridgeCommunicationFlowSignal | undefined,
  candidate: BridgeCommunicationFlowSignal
): BridgeCommunicationFlowSignal {
  if (!current) return candidate;
  // 同一 Bridge 请求有多个 worker 时，只要仍有一个执行中，就继续表达请求正在对端处理。
  if (current.continuous !== candidate.continuous) return candidate.continuous ? candidate : current;
  const priority: Record<CommunicationFlowTone, number> = { error: 0, response: 1, request: 2 };
  if (priority[current.tone] !== priority[candidate.tone]) {
    return priority[candidate.tone] < priority[current.tone] ? candidate : current;
  }
  return candidate.createdAt > current.createdAt ? candidate : current;
}

export function bridgeCommunicationFlowSignals(
  messages: readonly BridgeCommunicationMessage[],
  currentWorkspaceId: string,
  nowMs = Date.now(),
  linkedFlows: readonly BridgeLinkedExecutionFlow[] = []
): BridgeCommunicationFlowSignal[] {
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const linkedRequestIds = new Set<string>();
  const signalByLifecycleId = new Map<string, BridgeCommunicationFlowSignal>();

  for (const flow of linkedFlows) {
    if (!flow.bridgeRequestMessageId) continue;
    // 服务端为短时回放保留 completed Flow；窗口结束后不能继续把 Bridge 标成 live。
    if (!flow.continuous && flowAgeMs(flow, nowMs) > TRANSIENT_COMMUNICATION_WINDOW_MS) continue;
    const request = messagesById.get(flow.bridgeRequestMessageId);
    if (!request) continue;
    const requestDirection = bridgeMessageDirection(request, currentWorkspaceId);
    if (!requestDirection) continue;
    linkedRequestIds.add(request.id);
    // worker Agent -> 目标 TYR 的本地回传还不是跨 Workspace response。
    // 只有持久化的 final/error Bridge message 才能反向点亮 Bridge，避免提前消费正式响应的播放键。
    if (flow.tone !== "request") continue;
    const candidate: BridgeCommunicationFlowSignal = {
      id: `bridge-transit:${request.id}`,
      messageId: request.id,
      direction: requestDirection,
      tone: "request",
      continuous: flow.continuous,
      createdAt: flow.updatedAt
    };
    signalByLifecycleId.set(request.id, preferredBridgeSignal(signalByLifecycleId.get(request.id), candidate));
  }

  for (const message of messages) {
    // ack 只确认远端已接收；它不产生一条反向传输，避免同一请求被画成两份载荷。
    if (message.responseKind === "ack") continue;
    const lifecycleId = message.replyToMessageId ?? message.id;
    // linked Flow 只覆盖原始 request 的执行阶段；final/error reply 必须继续进入 Bridge response 投影。
    if (linkedRequestIds.has(lifecycleId) && !message.replyToMessageId) continue;
    const direction = bridgeMessageDirection(message, currentWorkspaceId);
    if (!direction) continue;
    const continuous = message.outcome === "pending";
    // 已完成或失败的事件只播放有限次；旧历史不能在进入页面时重新开始流动。
    if (!continuous && messageAgeMs(message, nowMs) > TRANSIENT_COMMUNICATION_WINDOW_MS) continue;
    const candidate: BridgeCommunicationFlowSignal = {
      id: `bridge-transit:${lifecycleId}`,
      messageId: lifecycleId,
      direction,
      tone: bridgeMessageTone(message),
      continuous,
      // A persisted state transition starts a fresh finite visual phase without changing message chronology.
      createdAt: message.updatedAt ?? message.createdAt
    };
    // Bridge final/error 是整个请求生命周期的权威回程，必须覆盖仍保留为 pending 的原始请求记录。
    signalByLifecycleId.set(
      lifecycleId,
      message.replyToMessageId
        ? candidate
        : preferredBridgeSignal(signalByLifecycleId.get(lifecycleId), candidate)
    );
  }

  return [...signalByLifecycleId.values()]
    .sort((left, right) => {
      const createdOrder = right.createdAt.localeCompare(left.createdAt);
      if (createdOrder !== 0) return createdOrder;
      const priority: Record<CommunicationFlowTone, number> = { error: 0, response: 1, request: 2 };
      return priority[left.tone] - priority[right.tone];
    });
}

export function dominantBridgeCommunicationFlowSignal(
  messages: CrossWorkspaceMessageRecord[],
  currentWorkspaceId: string,
  nowMs = Date.now()
): BridgeCommunicationFlowSignal | undefined {
  return bridgeCommunicationFlowSignals(messages, currentWorkspaceId, nowMs)[0];
}
