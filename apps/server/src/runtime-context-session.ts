import type { ChannelRecord, ConversationRecord, MessageRecord, RuntimeContextRef, RuntimeId } from "@tyr-ai/contracts";

type RuntimeContextStore = {
  resolveTarget(target: string, serverId?: string): ChannelRecord | null;
  getConversation(conversationId: string): ConversationRecord | null;
  getMessage(messageId: string): MessageRecord | null;
};

export type RuntimeContextSessionRollout = "off" | "codex";

export interface RuntimeContextSessionRolloutStatus {
  mode: RuntimeContextSessionRollout;
  scoped: boolean;
}

export function runtimeContextSessionRollout(value = process.env.TYR_RUNTIME_CONTEXT_SESSIONS): RuntimeContextSessionRollout {
  // P1 首期只允许显式 codex；未知值保持关闭，避免配置拼写错误意外改变 Runtime 生命周期。
  return value === "codex" ? "codex" : "off";
}

export function runtimeContextSessionAgentAllowlist(value = process.env.TYR_RUNTIME_CONTEXT_SESSION_AGENT_IDS): ReadonlySet<string> {
  return new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean));
}

export function runtimeContextSessionRolloutStatus(
  value = process.env.TYR_RUNTIME_CONTEXT_SESSIONS,
  agentIdsValue = process.env.TYR_RUNTIME_CONTEXT_SESSION_AGENT_IDS
): RuntimeContextSessionRolloutStatus {
  return {
    mode: runtimeContextSessionRollout(value),
    scoped: runtimeContextSessionAgentAllowlist(agentIdsValue).size > 0
  };
}

export function runtimeContextSessionsEnabled(
  runtime: RuntimeId,
  value = process.env.TYR_RUNTIME_CONTEXT_SESSIONS,
  agentId?: string,
  agentIdsValue = process.env.TYR_RUNTIME_CONTEXT_SESSION_AGENT_IDS
): boolean {
  if (runtime !== "codex" || runtimeContextSessionRollout(value) !== "codex") return false;
  const allowlist = runtimeContextSessionAgentAllowlist(agentIdsValue);
  // 未配置 allowlist 时保持测试环境全量 Codex 语义；一旦配置则必须显式命中 Agent，支持生产小范围灰度。
  return allowlist.size === 0 || Boolean(agentId && allowlist.has(agentId));
}

export function runtimeContextRefForMessage(store: RuntimeContextStore, message: MessageRecord): RuntimeContextRef | null {
  const channel = store.resolveTarget(message.channelId);
  if (!channel || channel.id !== message.channelId) return null;

  if (channel.type === "thread") {
    if (!channel.parentChannelId || !channel.parentMessageId) return null;
    const parentChannel = store.resolveTarget(channel.parentChannelId, channel.serverId);
    const parentMessage = store.getMessage(channel.parentMessageId);
    if (!parentChannel || parentChannel.type !== "dm" || !parentMessage || parentMessage.channelId !== parentChannel.id) return null;
    // Thread 必须锚定一个真实 DM conversation；损坏的父关系不能降级成可恢复 Session。
    if (!parentMessage.conversationId) return null;
    const conversation = store.getConversation(parentMessage.conversationId);
    if (!conversation || conversation.channelId !== parentChannel.id) return null;
    return { kind: "thread", id: channel.id, key: `thread:${channel.id}` };
  }

  if (channel.type !== "dm") return null;
  if (!message.conversationId) {
    // 只为升级前缺少 conversation_id 的 DM 消息提供稳定兼容边界。
    return { kind: "legacy_channel", id: channel.id, key: `legacy-channel:${channel.id}` };
  }
  const conversation = store.getConversation(message.conversationId);
  if (!conversation || conversation.channelId !== channel.id) return null;
  return { kind: "conversation", id: conversation.id, key: `conversation:${conversation.id}` };
}
