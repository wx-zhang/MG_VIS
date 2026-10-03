import {
  type AgentRecord,
  type AppSnapshot,
  type ConversationRecord,
  RUNTIMES,
  SUPPORTED_MESSAGE_REACTIONS,
  isCommunicationAgent,
  type ResourceGrantSummary,
  type RuntimeReport,
  type UserRecord,
  type WorkspaceAgentNavItem,
  type WorkspaceBootstrapPayload,
  type WorkspaceChannelNavItem,
  type WorkspaceHumanNavItem,
  type WorkspaceMachineNavItem,
  type WorkspaceNavigationPayload,
  type WorkspaceBridgeRequestState,
  type WorkspaceResourceGrantNavItem,
  type MessageDeviceRef,
  type MessageExecutionSummaryRecord,
  type MessageReactionEmoji,
  type MessageRecord,
  type MessageResult,
  type MachineListItem,
  type RuntimeApprovalRecord,
  type RuntimeExecutionRecord,
  type SidebarOrderSettings,
  type TaskRecord
} from "@tyr-ai/contracts";
import type { WorkspaceSettingsTab } from "../routing";
import { copyTextToClipboard } from "../clipboard";
import { api } from "../lib/api";
import type { ActivityLogItem } from "./workspaceTypes";
export { activeMentionToken } from "./mentionTokens";

export const emptyWorkspaceCache: AppSnapshot = {
  currentUser: { id: "loading", name: "loading", displayName: "loading", createdAt: "" },
  currentServer: null,
  machines: [],
  agents: [],
  humans: [],
  channels: [],
  conversations: [],
  messages: [],
  devices: [],
  deviceGrants: [],
  deviceAccessRules: [],
  deviceCommands: [],
  tasks: [],
  savedMessageIds: [],
  unreadCounts: {},
  reminders: [],
  runtimeApprovals: [],
  runtimeExecutions: [],
  runtimeExecutionEvents: [],
  executionGroups: [],
  agentRuns: [],
  executionBlocks: [],
  executionArtifacts: [],
  communicationAgentPendingActions: [],
  communicationAgentProgress: [],
  safetyAssessments: [],
  governanceDecisions: [],
  resourceGrantSummaries: [],
  incomingServerInvites: [],
  workspaceBridges: [],
  incomingWorkspaceBridges: [],
  crossWorkspaceMessages: [],
  peerWorkspaceTopologies: [],
  workspaceBridgeTopologyEdges: []
};

export function messagePreviewText(message: { content?: string | null; deletedAt?: string | null }): string {
  // Tombstone 文案在所有列表视图复用，保证 deleted message 不因空 content 看起来像渲染缺失。
  return message.deletedAt ? "Message deleted" : String(message.content ?? "");
}

export function workspaceBootstrapToWorkspaceCache(bootstrap: WorkspaceBootstrapPayload, partial: Partial<AppSnapshot> = {}): AppSnapshot {
  const dmChannels = (partial.channels ?? []).filter((channel) => channel.type === "dm");
  const dmChannelIds = new Set(dmChannels.map((channel) => channel.id));
  // Cold-retained group records must not reappear from a browser cache after the group feature is disabled.
  const visibleChannels = [
    ...dmChannels,
    ...(partial.channels ?? []).filter((channel) => channel.type === "thread" && Boolean(channel.parentChannelId) && dmChannelIds.has(channel.parentChannelId!))
  ];
  return {
    ...emptyWorkspaceCache,
    ...partial,
    currentUser: bootstrap.currentUser,
    currentServer: bootstrap.currentServer,
    machines: partial.machines ?? [],
    agents: partial.agents ?? [],
    humans: partial.humans ?? [],
    channels: visibleChannels,
    conversations: partial.conversations ?? [],
    unreadCounts: bootstrap.unreadCounts,
    sidebarOrder: bootstrap.sidebarOrder,
    resourceGrantSummaries: partial.resourceGrantSummaries ?? [],
    incomingServerInvites: bootstrap.incomingServerInvites,
    workspaceBridges: bootstrap.workspaceBridges ?? partial.workspaceBridges ?? [],
    incomingWorkspaceBridges: bootstrap.incomingWorkspaceBridges ?? partial.incomingWorkspaceBridges ?? [],
    // 精简 bootstrap 会返回空 Bridge history；同一 Workspace 下保留 realtime 已收到的明细。
    crossWorkspaceMessages: bootstrap.crossWorkspaceMessages?.length
      ? bootstrap.crossWorkspaceMessages
      : partial.crossWorkspaceMessages ?? [],
    peerWorkspaceTopologies: bootstrap.peerWorkspaceTopologies ?? partial.peerWorkspaceTopologies ?? [],
    workspaceBridgeTopologyEdges: bootstrap.workspaceBridgeTopologyEdges ?? partial.workspaceBridgeTopologyEdges ?? []
  };
}

export function sortChannelsByPinnedOrder<T extends { id: string }>(channels: T[], sidebarOrder?: Pick<SidebarOrderSettings, "pinnedChannelIds" | "pinnedOrder">): T[] {
  const pinnedChannelIds = new Set(sidebarOrder?.pinnedChannelIds ?? []);
  if (pinnedChannelIds.size === 0) return channels;

  const originalIndex = new Map(channels.map((channel, index) => [channel.id, index]));
  // pinnedOrder can contain non-channel resources; this legacy helper only orders conversation records.
  const pinnedOrderIndex = new Map((sidebarOrder?.pinnedOrder ?? [])
    .filter((id) => pinnedChannelIds.has(id))
    .map((id, index) => [id, index]));
  const pinned: T[] = [];
  const unpinned: T[] = [];
  for (const channel of channels) {
    if (pinnedChannelIds.has(channel.id)) pinned.push(channel);
    else unpinned.push(channel);
  }
  pinned.sort((left, right) => {
    const leftRank = pinnedOrderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = pinnedOrderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0);
  });
  return [...pinned, ...unpinned];
}

export function workspaceNavigationToWorkspaceCacheParts(payloads: WorkspaceNavigationPayload[]): Partial<AppSnapshot> {
  const channels: AppSnapshot["channels"] = [];
  const agents: AppSnapshot["agents"] = [];
  const machineItems: WorkspaceMachineNavItem[] = [];
  const humans: AppSnapshot["humans"] = [];
  const resourceGrantSummaries: AppSnapshot["resourceGrantSummaries"] = [];
  for (const payload of payloads) {
    if (payload.section === "dms") {
      channels.push(...(payload.items as WorkspaceChannelNavItem[]).map(channelNavItemToRecord));
      continue;
    }
    if (payload.section === "agents") {
      agents.push(...(payload.items as WorkspaceAgentNavItem[]).map(agentNavItemToRecord));
      continue;
    }
    if (payload.section === "machines") {
      machineItems.push(...(payload.items as WorkspaceMachineNavItem[]));
      continue;
    }
    if (payload.section === "humans") {
      humans.push(...(payload.items as WorkspaceHumanNavItem[]).map((human): UserRecord => human));
      continue;
    }
    resourceGrantSummaries.push(...(payload.items as WorkspaceResourceGrantNavItem[]).map((grant): ResourceGrantSummary => grant));
  }
  const agentsByMachineId = new Map<string, AgentRecord[]>();
  for (const agent of agents) {
    if (isCommunicationAgent(agent)) continue;
    const machineId = agent.machineId ?? "";
    const items = agentsByMachineId.get(machineId) ?? [];
    items.push(agent);
    agentsByMachineId.set(machineId, items);
  }
  // Navigation keeps machines and agents as separate paginated sections; the legacy AppSnapshot cache still needs
  // loaded machine children for topology tree/graph rendering.
  const machines = machineItems.map((machine) => machineNavItemToWorkspaceCacheRecord(machine, agentsByMachineId.get(machine.id) ?? []));
  return { channels, agents, machines, humans, resourceGrantSummaries };
}

export function applyWorkspaceNavigationPayload(current: AppSnapshot, payload: WorkspaceNavigationPayload): AppSnapshot {
  const partial = workspaceNavigationToWorkspaceCacheParts([payload]);
  if (payload.section === "dms") {
    const dms = partial.channels ?? [];
    const dmIds = new Set(dms.map((channel) => channel.id));
    // Thread 不属于 navigation 分页；只保留仍属于可见 DM 的按需缓存，避免历史群聊 thread 泄漏到页面。
    const threads = current.channels.filter((channel) => channel.type === "thread" && Boolean(channel.parentChannelId) && dmIds.has(channel.parentChannelId!));
    return { ...current, channels: [...dms, ...threads] };
  }
  if (payload.section === "agents") {
    const agents = mergeWorkspaceNavigationAgentsByFreshness(current, { agents: partial.agents }).agents ?? current.agents;
    return {
      ...current,
      agents,
      // Topology 同时读取顶层 Agent 与 Computer 子树，两处必须引用同一批最新状态。
      machines: current.machines.map((machine) => ({
        ...machine,
        agents: agents.filter((agent) => agent.machineId === machine.id)
      }))
    };
  }
  if (payload.section === "machines") {
    return {
      ...current,
      machines: (partial.machines ?? []).map((machine) => ({
        ...machine,
        // machines 和 agents 可独立返回，Computer 子树使用当前已加载的 Agent 缓存补齐。
        agents: current.agents.filter((agent) => agent.machineId === machine.id)
      }))
    };
  }
  if (payload.section === "humans") return { ...current, humans: partial.humans ?? [] };
  return { ...current, resourceGrantSummaries: partial.resourceGrantSummaries ?? [] };
}

function channelNavItemToRecord(channel: WorkspaceChannelNavItem): AppSnapshot["channels"][number] {
  const { unreadCount: _unreadCount, lastMessageAt: _lastMessageAt, ...record } = channel;
  return record;
}

function agentNavItemToRecord(agent: WorkspaceAgentNavItem): AgentRecord {
  // Navigation deliberately excludes authToken; the legacy AppSnapshot view model only receives a non-credential placeholder.
  return { ...agent, authToken: "" };
}

function machineNavItemToWorkspaceCacheRecord(machine: WorkspaceMachineNavItem, agents: AgentRecord[] = []): AppSnapshot["machines"][number] {
  const { agentCount: _agentCount, availableRuntimes, runtimeReports, ...record } = machine;
  return {
    ...record,
    latestDaemonVersion: record.latestDaemonVersion ?? record.daemonVersion,
    apiKey: "",
    runtimes: runtimeReports?.length ? runtimeReports : availableRuntimes.map(runtimeReportForNavigation),
    agents
  };
}

function runtimeReportForNavigation(runtime: WorkspaceMachineNavItem["availableRuntimes"][number]): RuntimeReport {
  const definition = RUNTIMES.find((item) => item.id === runtime);
  return {
    runtime,
    displayName: definition?.displayName ?? runtime,
    binary: definition?.binary ?? runtime,
    status: "available"
  };
}

export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/topology";
  return value.startsWith("/login") ? "/topology" : value;
}

export function loginRedirectPath(location: Pick<Location, "pathname" | "search">): string {
  const next = safeNextPath(location.pathname + location.search);
  const params = new URLSearchParams({ next });
  return "/login?" + params.toString();
}

export function settingsPath(tab: WorkspaceSettingsTab): string {
  return "/settings/" + tab;
}

export async function toggleMessageReaction(messageId: string, emoji: MessageReactionEmoji): Promise<{ active: boolean; message: MessageRecord }> {
  const result = await api<{ active: boolean; message: unknown }>("/api/messages/" + encodeURIComponent(messageId) + "/reactions", {
    method: "POST",
    body: JSON.stringify({ emoji })
  });
  return {
    active: Boolean(result.active),
    message: publicMessageToRecord(result.message)
  };
}

export function messageWithOptimisticReaction(message: MessageRecord, emoji: MessageReactionEmoji, reactor: { id: string; name: string }): MessageRecord {
  // 点击后先更新本地反应摘要，服务端响应再校准；接口失败时调用方用原消息回滚。
  const reactions = [...(message.reactions ?? [])];
  const reactionIndex = reactions.findIndex((reaction) => reaction.emoji === emoji);
  const current = reactionIndex >= 0 ? reactions[reactionIndex] : null;
  if (current?.reactorIds.includes(reactor.id)) {
    const reactorIds = current.reactorIds.filter((id) => id !== reactor.id);
    const reactorNames = current.reactorNames.filter((_, index) => current.reactorIds[index] !== reactor.id);
    if (reactorIds.length === 0) reactions.splice(reactionIndex, 1);
    else reactions[reactionIndex] = { ...current, count: reactorIds.length, reactorIds, reactorNames };
  } else if (current) {
    reactions[reactionIndex] = {
      ...current,
      count: current.reactorIds.length + 1,
      reactorIds: [...current.reactorIds, reactor.id],
      reactorNames: [...current.reactorNames, reactor.name]
    };
  } else {
    reactions.push({ emoji, count: 1, reactorIds: [reactor.id], reactorNames: [reactor.name] });
  }
  const reactionOrder = new Map(SUPPORTED_MESSAGE_REACTIONS.map((supportedEmoji, index) => [supportedEmoji, index]));
  reactions.sort((left, right) => (reactionOrder.get(left.emoji) ?? Number.MAX_SAFE_INTEGER) - (reactionOrder.get(right.emoji) ?? Number.MAX_SAFE_INTEGER));
  return { ...message, reactions };
}

export async function copyMessageText(text: string): Promise<void> {
  await copyTextToClipboard(text);
}

export function avatarSeed(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export type LiveStatusTone = "online" | "working" | "error" | "offline" | "degraded";

export function liveStatusTone(status?: string): LiveStatusTone {
  // Agent、Computer、Device 共用这组视觉语义；未知值按 offline 展示，避免误报在线。
  if (status === "online" || status === "working" || status === "error" || status === "degraded") return status;
  return "offline";
}

export function statusDot(status?: string): string {
  const tone = liveStatusTone(status);
  if (tone === "online") return "dot green";
  if (tone === "working" || tone === "degraded") return "dot yellow";
  if (tone === "error") return "dot red";
  return "dot gray";
}

export function liveStatusLabel(status?: string): string {
  const tone = liveStatusTone(status);
  if (tone === "working") return "Working";
  if (tone === "online") return "Online";
  if (tone === "error") return "Error";
  if (tone === "degraded") return "Degraded";
  return "Offline";
}

export function agentStatusLabel(status?: string, waitingForApproval = false): string {
  if (waitingForApproval && status === "working") return "Waiting for approval";
  return liveStatusLabel(status);
}

export function topologyTreeStatusClass(status?: string): string {
  // 树与关系图复用同一个 tone 解析，避免新增状态时只更新其中一个视图。
  return liveStatusTone(status);
}

export function applyMachineUpdatedSnapshotPatch(
  current: AppSnapshot,
  payload: { machineId?: unknown; deleted?: unknown; machine?: MachineListItem }
): AppSnapshot {
  const machineId = typeof payload.machineId === "string" ? payload.machineId : "";
  if (!machineId) return current;
  if (payload.deleted === true) {
    return current.machines.some((machine) => machine.id === machineId)
      ? { ...current, machines: current.machines.filter((machine) => machine.id !== machineId) }
      : current;
  }
  const incoming = payload.machine;
  if (!incoming || incoming.id !== machineId) return current;
  let changed = false;
  const machines = current.machines.map((machine) => {
    if (machine.id !== machineId) return machine;
    // Realtime 列表事件不携带完整 runtime report 和 Agent 子树；这里只覆盖 Computer 主状态，保留已加载的详情缓存。
    const next = {
      ...machine,
      serverId: incoming.serverId,
      ownerUserId: incoming.userId,
      name: incoming.name,
      hostname: incoming.hostname,
      os: incoming.os,
      daemonVersion: incoming.daemonVersion,
      latestDaemonVersion: incoming.latestDaemonVersion,
      runtimeMarker: incoming.runtimeMarker,
      runtimeSha: incoming.runtimeSha,
      runtimeMarkerMtime: incoming.runtimeMarkerMtime,
      latestRuntimeSha: incoming.latestRuntimeSha,
      runtimeUpdateAvailable: incoming.runtimeUpdateAvailable,
      status: incoming.status,
      createdAt: incoming.createdAt,
      lastSeenAt: incoming.lastHeartbeat
    };
    const unchanged = machine.serverId === next.serverId
      && machine.ownerUserId === next.ownerUserId
      && machine.name === next.name
      && machine.hostname === next.hostname
      && machine.os === next.os
      && machine.daemonVersion === next.daemonVersion
      && machine.latestDaemonVersion === next.latestDaemonVersion
      && machine.runtimeMarker === next.runtimeMarker
      && machine.runtimeSha === next.runtimeSha
      && machine.runtimeMarkerMtime === next.runtimeMarkerMtime
      && machine.latestRuntimeSha === next.latestRuntimeSha
      && machine.runtimeUpdateAvailable === next.runtimeUpdateAvailable
      && machine.status === next.status
      && machine.createdAt === next.createdAt
      && machine.lastSeenAt === next.lastSeenAt;
    if (unchanged) return machine;
    changed = true;
    return next;
  });
  return changed ? { ...current, machines } : current;
}

export function applyAgentActivitySnapshotPatch(current: AppSnapshot, payload: { agentId?: unknown; activity?: unknown; status?: unknown; detail?: unknown; lastError?: unknown; timestamp?: unknown; statusUpdatedAt?: unknown; updatedAt?: unknown }): AppSnapshot {
  const agentId = String(payload.agentId ?? "");
  if (!agentId) return current;
  const activity = String(payload.activity ?? "");
  const canonicalStatus = String(payload.status ?? "");
  const lastError = typeof payload.lastError === "string" ? payload.lastError.trim() : "";
  const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
  const statusUpdatedAt = typeof payload.statusUpdatedAt === "string" && Number.isFinite(Date.parse(payload.statusUpdatedAt))
    ? payload.statusUpdatedAt
    : typeof payload.updatedAt === "string" && Number.isFinite(Date.parse(payload.updatedAt))
      ? payload.updatedAt
      : undefined;
  const statusFromActivity: AgentRecord["status"] | undefined =
    activity === "working" || activity === "thinking" ? "working"
      : activity === "online" || activity === "offline" || activity === "error" ? activity
        : undefined;
  const statusFromServer: AgentRecord["status"] | undefined =
    canonicalStatus === "working" || canonicalStatus === "online" || canonicalStatus === "offline" || canonicalStatus === "error"
      ? canonicalStatus
      : undefined;
  const patchAgent = (agent: AgentRecord): AgentRecord => {
    if (agent.id !== agentId) return agent;
    const status = statusFromServer ?? statusFromActivity ?? agent.status;
    const nextLastError = status === "error"
      ? activity === "error" ? detail || lastError || agent.lastError : lastError || agent.lastError
      : status === "online" || status === "working" ? undefined : lastError || agent.lastError;
    const nextUpdatedAt = statusUpdatedAt ?? agent.updatedAt;
    if (agent.status === status && agent.lastError === nextLastError && agent.updatedAt === nextUpdatedAt) return agent;
    return {
      ...agent,
      status,
      // 仅持久化 status 版本参与新鲜度比较；普通 activity timestamp 不能抬高 Agent 状态版本。
      updatedAt: nextUpdatedAt,
      // Runtime recovery clears stale errors in every snapshot copy; offline keeps the last diagnostic visible.
      lastError: nextLastError
    };
  };
  let changed = false;
  const agents = current.agents.map((agent) => {
    const next = patchAgent(agent);
    if (next !== agent) changed = true;
    return next;
  });
  const machines = current.machines.map((machine) => {
    let machineChanged = false;
    const agents = machine.agents.map((agent) => {
      const next = patchAgent(agent);
      if (next !== agent) machineChanged = true;
      return next;
    });
    if (!machineChanged) return machine;
    changed = true;
    return { ...machine, agents };
  });
  if (!changed) return current;
  return {
    ...current,
    agents,
    machines
  };
}

export function mergeWorkspaceNavigationAgentsByFreshness(current: AppSnapshot, incoming: Partial<AppSnapshot>): Partial<AppSnapshot> {
  if (!incoming.agents) return incoming;
  const currentById = new Map(current.agents.map((agent) => [agent.id, agent]));
  const agents = incoming.agents.map((incomingAgent) => {
    const currentAgent = currentById.get(incomingAgent.id);
    if (!currentAgent) return incomingAgent;
    const currentUpdatedAt = Date.parse(currentAgent.updatedAt);
    const incomingUpdatedAt = Date.parse(incomingAgent.updatedAt);
    // 相同版本时当前缓存可能已应用同毫秒内更晚的 websocket 事件，因此也由当前状态胜出。
    return Number.isFinite(currentUpdatedAt) && (!Number.isFinite(incomingUpdatedAt) || currentUpdatedAt >= incomingUpdatedAt)
      ? {
          // 权限、名称和 host metadata 仍以 navigation 为准，只保护实时维护的状态字段。
          ...incomingAgent,
          status: currentAgent.status,
          lastError: currentAgent.lastError,
          updatedAt: currentAgent.updatedAt
        }
      : incomingAgent;
  });
  if (!incoming.machines) return { ...incoming, agents };
  const agentsByMachineId = new Map<string, AgentRecord[]>();
  for (const agent of agents) {
    if (!agent.machineId) continue;
    const machineAgents = agentsByMachineId.get(agent.machineId) ?? [];
    machineAgents.push(agent);
    agentsByMachineId.set(agent.machineId, machineAgents);
  }
  return {
    ...incoming,
    agents,
    // Topology 使用 Computer 内嵌 Agent；必须与顶部 agents 使用同一批合并结果。
    machines: incoming.machines.map((machine) => ({
      ...machine,
      agents: agentsByMachineId.get(machine.id) ?? []
    }))
  };
}

export function shouldApplyAgentActivityRealtimeEvent(lastSeqByAgent: Map<string, number>, payload: { agentId?: unknown; serverSeq?: unknown }): boolean {
  const agentId = String(payload.agentId ?? "");
  if (!agentId) return false;
  const serverSeq = Number(payload.serverSeq);
  if (!Number.isFinite(serverSeq) || serverSeq <= 0) return true;
  const lastSeq = lastSeqByAgent.get(agentId) ?? 0;
  // reconnect replay 会分批执行；已应用的 live 新事件不能再被较旧 replay 状态覆盖。
  if (serverSeq <= lastSeq) return false;
  lastSeqByAgent.set(agentId, serverSeq);
  return true;
}

export function applyAgentDeletedSnapshotPatch(current: AppSnapshot, payload: { agentId?: unknown }): AppSnapshot {
  const agentId = String(payload.agentId ?? "");
  if (!agentId) return current;
  // 删除事件只维护 active roster 缓存；消息历史里的 senderName 保持原样，避免改写审计上下文。
  return {
    ...current,
    agents: current.agents.filter((agent) => agent.id !== agentId),
    // 该 DM 的可聊天对象已被删除；先从本地导航缓存移除，等待完整 refresh 回收其余派生状态。
    channels: current.channels.filter((channel) => channel.type !== "dm" || channel.dmPeerAgentId !== agentId),
    machines: current.machines.map((machine) => ({
      ...machine,
      agents: machine.agents.filter((agent) => agent.id !== agentId)
    }))
  };
}

export function workspaceCacheServerId(snapshot: AppSnapshot): string {
  return snapshot.currentServer?.id ?? snapshot.channels[0]?.serverId ?? snapshot.machines[0]?.serverId ?? "local";
}

export function dmAgentLiveStatus(agent?: AgentRecord, activity: ActivityLogItem[] = []): { dot: AgentRecord["status"]; label: string } {
  if (!agent) return { dot: "offline", label: "Offline" };
  const latest = activity[0];
  const isRecent = latest ? Date.now() - latest.timestamp < 30_000 : false;
  // 圆点始终以 websocket 维护的 AgentRecord 为真源；活动日志只细化 working 文案，不能把已恢复或已离线的状态改回旧颜色。
  if (agent.status === "working" && isRecent && latest?.entry.kind === "status") {
    if (latest.entry.activity === "thinking") return { dot: "working", label: "Thinking..." };
    if (latest.entry.activity === "working") return { dot: "working", label: "Running command..." };
  }
  return { dot: agent.status, label: agentStatusLabel(agent.status) };
}

export function socketEvent(event: string, payload?: unknown): string {
  return "42" + JSON.stringify(payload === undefined ? [event] : [event, payload]);
}

function senderTypeFromPublic(type: string): MessageRecord["senderType"] {
  return type === "user" || type === "human" ? "human" : type === "agent" ? "agent" : "system";
}

function messageResultFromPublic(value: unknown): MessageResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const status = raw.status;
  if (raw.version !== 1 || (status !== "completed" && status !== "failed" && status !== "partial")) return undefined;
  if (typeof raw.title !== "string" || typeof raw.summary !== "string") return undefined;
  const rawWorkspaceBridge = raw.workspaceBridge && typeof raw.workspaceBridge === "object" && !Array.isArray(raw.workspaceBridge)
    ? raw.workspaceBridge as Record<string, unknown>
    : null;
  const workspaceBridgeState = rawWorkspaceBridge?.state;
  const normalizedWorkspaceBridgeState: WorkspaceBridgeRequestState | undefined =
    workspaceBridgeState === "queued" || workspaceBridgeState === "delivered" || workspaceBridgeState === "running" || workspaceBridgeState === "blocked_on_peer_approval" || workspaceBridgeState === "needs_attention" || workspaceBridgeState === "completed" || workspaceBridgeState === "failed"
      ? workspaceBridgeState
      : undefined;
  const workspaceBridge = rawWorkspaceBridge &&
    typeof rawWorkspaceBridge.bridgeRequestId === "string" &&
    typeof rawWorkspaceBridge.bridgeId === "string" &&
    typeof rawWorkspaceBridge.conversationId === "string" &&
    typeof rawWorkspaceBridge.sentContent === "string" &&
    normalizedWorkspaceBridgeState
    ? {
      bridgeRequestId: rawWorkspaceBridge.bridgeRequestId,
      bridgeId: rawWorkspaceBridge.bridgeId,
      conversationId: rawWorkspaceBridge.conversationId,
      sentContent: rawWorkspaceBridge.sentContent,
      state: normalizedWorkspaceBridgeState
    }
    : undefined;
  const rawAssistantRetry = raw.assistantRetry && typeof raw.assistantRetry === "object" && !Array.isArray(raw.assistantRetry)
    ? raw.assistantRetry as Record<string, unknown>
    : null;
  const assistantRetry = rawAssistantRetry && typeof rawAssistantRetry.sourceMessageId === "string" && rawAssistantRetry.sourceMessageId
    ? { sourceMessageId: rawAssistantRetry.sourceMessageId }
    : undefined;
  const rawCommunicationRequest = raw.communicationRequest && typeof raw.communicationRequest === "object" && !Array.isArray(raw.communicationRequest)
    ? raw.communicationRequest as Record<string, unknown>
    : null;
  const communicationRequest = rawCommunicationRequest && typeof rawCommunicationRequest.sourceMessageId === "string" && rawCommunicationRequest.sourceMessageId
    ? { sourceMessageId: rawCommunicationRequest.sourceMessageId }
    : undefined;
  return {
    version: 1,
    status,
    title: raw.title,
    summary: raw.summary,
    body: typeof raw.body === "string" ? raw.body : undefined,
    sourceAgentId: typeof raw.sourceAgentId === "string" ? raw.sourceAgentId : undefined,
    sourceAgentName: typeof raw.sourceAgentName === "string" ? raw.sourceAgentName : undefined,
    sourceHumanName: typeof raw.sourceHumanName === "string" ? raw.sourceHumanName : undefined,
    truncated: raw.truncated === true || undefined,
    workspaceBridge,
    assistantRetry,
    communicationRequest
  };
}

export function publicMessageToRecord(raw: any): MessageRecord {
  const rawDeviceRefs = Array.isArray(raw.deviceRefs) ? raw.deviceRefs : Array.isArray(raw.device_refs) ? raw.device_refs : [];
  return {
    id: String(raw.id),
    channelId: String(raw.channelId),
    conversationId: typeof raw.conversationId === "string" && raw.conversationId ? raw.conversationId : undefined,
    channelName: raw.channelName,
    channelDisplayName: raw.channelDisplayName,
    channelType: raw.channelType,
    threadId: raw.threadId ?? undefined,
    senderType: senderTypeFromPublic(String(raw.senderType ?? "system")),
    senderId: String(raw.senderId ?? ""),
    senderName: String(raw.senderName ?? raw.senderId ?? ""),
    content: String(raw.content ?? ""),
    result: messageResultFromPublic(raw.result),
    seq: Number(raw.seq ?? 0),
    attachmentIds: Array.isArray(raw.attachments) ? raw.attachments.map((item: any) => String(item.id)) : [],
    attachments: Array.isArray(raw.attachments) ? raw.attachments.map((item: any) => ({
      id: String(item.id),
      filename: String(item.filename ?? "attachment"),
      mimeType: String(item.mimeType ?? "application/octet-stream"),
      sizeBytes: Number(item.sizeBytes ?? 0)
    })) : undefined,
    deviceRefs: rawDeviceRefs.length ? rawDeviceRefs.map((item: any) => ({
      deviceId: String(item.deviceId ?? ""),
      capability: String(item.capability ?? "screen.capture_app_snapshot") as MessageDeviceRef["capability"]
    })).filter((item: MessageDeviceRef) => item.deviceId) : undefined,
    quote: raw.quote && typeof raw.quote === "object" ? {
      messageId: String(raw.quote.messageId ?? raw.quote.id ?? ""),
      channelId: String(raw.quote.channelId ?? ""),
      senderType: senderTypeFromPublic(String(raw.quote.senderType ?? "system")),
      senderId: String(raw.quote.senderId ?? ""),
      senderName: String(raw.quote.senderName ?? raw.quote.senderId ?? ""),
      content: String(raw.quote.content ?? ""),
      createdAt: String(raw.quote.createdAt ?? new Date().toISOString())
    } : undefined,
    reactions: Array.isArray(raw.reactions) ? raw.reactions.map((item: any) => ({
      emoji: String(item.emoji) as MessageReactionEmoji,
      count: Number(item.count ?? 0),
      reactorIds: Array.isArray(item.reactorIds) ? item.reactorIds.map(String) : [],
      reactorNames: Array.isArray(item.reactorNames) ? item.reactorNames.map(String) : []
    })) : [],
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    deletedAt: typeof raw.deletedAt === "string" && raw.deletedAt ? raw.deletedAt : undefined,
    deletedByUserId: typeof raw.deletedByUserId === "string" && raw.deletedByUserId ? raw.deletedByUserId : undefined,
    deletionReason: raw.deletionReason === "user_deleted" ? "user_deleted" : undefined
  };
}

export function publicConversationToRecord(raw: any): ConversationRecord {
  return {
    id: String(raw.id),
    serverId: typeof raw.serverId === "string" && raw.serverId ? raw.serverId : undefined,
    channelId: String(raw.channelId),
    title: String(raw.title ?? "New conversation"),
    status: raw.status === "closed" ? "closed" : "active",
    startedByType: raw.startedByType === "agent" || raw.startedByType === "system" ? raw.startedByType : "human",
    startedById: String(raw.startedById ?? ""),
    startedAt: String(raw.startedAt ?? new Date().toISOString()),
    closedAt: typeof raw.closedAt === "string" ? raw.closedAt : null,
    archivedAt: typeof raw.archivedAt === "string" ? raw.archivedAt : null,
    archivedByUserId: typeof raw.archivedByUserId === "string" ? raw.archivedByUserId : null,
    lastMessageAt: typeof raw.lastMessageAt === "string" ? raw.lastMessageAt : null,
    summary: typeof raw.summary === "string" ? raw.summary : null,
    resetStatus: ["not_applicable", "pending", "completed", "skipped", "failed"].includes(String(raw.resetStatus)) ? raw.resetStatus : "not_applicable",
    resetAgentId: typeof raw.resetAgentId === "string" ? raw.resetAgentId : null,
    resetReason: typeof raw.resetReason === "string" ? raw.resetReason : null
  };
}

export function publicTaskToRecord(raw: any): TaskRecord {
  const status = String(raw.status ?? raw.taskStatus ?? "todo") as TaskRecord["status"];
  return {
    id: String(raw.messageId ?? raw.id),
    channelId: String(raw.channelId),
    conversationId: typeof raw.conversationId === "string" && raw.conversationId ? raw.conversationId : undefined,
    channelName: raw.channelName,
    channelDisplayName: raw.channelDisplayName,
    channelType: raw.channelType,
    threadChannelId: raw.threadId ?? undefined,
    messageId: String(raw.messageId ?? raw.id),
    taskNumber: Number(raw.taskNumber ?? 0),
    title: String(raw.title ?? raw.content ?? ""),
    status,
    assigneeAgentId: raw.claimedById ?? raw.taskAssigneeId ?? undefined,
    assigneeName: raw.claimedByName ?? undefined,
    createdByType: senderTypeFromPublic(String(raw.createdByType ?? raw.senderType ?? "human")),
    createdById: String(raw.createdById ?? raw.senderId ?? ""),
    createdByName: raw.createdByName ?? raw.senderName,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? raw.createdAt ?? new Date().toISOString())
  };
}

export type MessagePageInfo = {
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  oldestSeq: number | null;
  newestSeq: number | null;
};

export type ChannelMessagesPage = {
  messages: MessageRecord[];
  pageInfo: MessagePageInfo;
  runtimeExecutions?: RuntimeExecutionRecord[];
  runtimeApprovals?: RuntimeApprovalRecord[];
  messageExecutionSummaries?: Record<string, MessageExecutionSummaryRecord>;
};

export async function fetchChannelMessagesPage(channelId: string, params: { limit?: number; beforeSeq?: number | null; afterSeq?: number | null; aroundMessageId?: string } = {}): Promise<ChannelMessagesPage> {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 50));
  if (params.beforeSeq) query.set("beforeSeq", String(params.beforeSeq));
  if (params.afterSeq) query.set("afterSeq", String(params.afterSeq));
  if (params.aroundMessageId) query.set("aroundMessageId", params.aroundMessageId);
  const data = await api<{ messages?: unknown[]; pageInfo?: Partial<MessagePageInfo>; runtimeExecutions?: unknown[]; runtimeApprovals?: unknown[]; messageExecutionSummaries?: Record<string, MessageExecutionSummaryRecord> }>(
    "/api/channels/" + encodeURIComponent(channelId) + "/messages?" + query.toString()
  );
  const messages = Array.isArray(data.messages) ? data.messages.map(publicMessageToRecord) : [];
  const pageInfo = data.pageInfo ?? {};
  return {
    messages,
    runtimeExecutions: Array.isArray(data.runtimeExecutions) ? data.runtimeExecutions as RuntimeExecutionRecord[] : [],
    runtimeApprovals: Array.isArray(data.runtimeApprovals) ? data.runtimeApprovals as RuntimeApprovalRecord[] : [],
    messageExecutionSummaries: data.messageExecutionSummaries ?? {},
    pageInfo: {
      hasMoreBefore: Boolean(pageInfo.hasMoreBefore),
      hasMoreAfter: Boolean(pageInfo.hasMoreAfter),
      oldestSeq: typeof pageInfo.oldestSeq === "number" ? pageInfo.oldestSeq : null,
      newestSeq: typeof pageInfo.newestSeq === "number" ? pageInfo.newestSeq : null
    }
  };
}

export async function fetchConversationMessagesPage(conversationId: string, params: { limit?: number; beforeSeq?: number | null; afterSeq?: number | null; aroundMessageId?: string } = {}): Promise<ChannelMessagesPage & { conversation?: ConversationRecord }> {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 50));
  if (params.beforeSeq) query.set("beforeSeq", String(params.beforeSeq));
  if (params.afterSeq) query.set("afterSeq", String(params.afterSeq));
  if (params.aroundMessageId) query.set("aroundMessageId", params.aroundMessageId);
  const data = await api<{ conversation?: unknown; messages?: unknown[]; pageInfo?: Partial<MessagePageInfo>; runtimeExecutions?: unknown[]; runtimeApprovals?: unknown[]; messageExecutionSummaries?: Record<string, MessageExecutionSummaryRecord> }>(
    "/api/conversations/" + encodeURIComponent(conversationId) + "/messages?" + query.toString()
  );
  const messages = Array.isArray(data.messages) ? data.messages.map(publicMessageToRecord) : [];
  const pageInfo = data.pageInfo ?? {};
  return {
    conversation: data.conversation ? publicConversationToRecord(data.conversation) : undefined,
    messages,
    runtimeExecutions: Array.isArray(data.runtimeExecutions) ? data.runtimeExecutions as RuntimeExecutionRecord[] : [],
    runtimeApprovals: Array.isArray(data.runtimeApprovals) ? data.runtimeApprovals as RuntimeApprovalRecord[] : [],
    messageExecutionSummaries: data.messageExecutionSummaries ?? {},
    pageInfo: {
      hasMoreBefore: Boolean(pageInfo.hasMoreBefore),
      hasMoreAfter: Boolean(pageInfo.hasMoreAfter),
      oldestSeq: typeof pageInfo.oldestSeq === "number" ? pageInfo.oldestSeq : null,
      newestSeq: typeof pageInfo.newestSeq === "number" ? pageInfo.newestSeq : null
    }
  };
}

function mergeMessageRecord(current: MessageRecord, incoming: MessageRecord): MessageRecord {
  const merged = { ...current, ...incoming };
  const deletedAt = incoming.deletedAt ?? current.deletedAt;
  if (!deletedAt) return merged;

  // 软删除是单向状态；分页缓存或旧 realtime 不能把 tombstone 还原成原文。
  return {
    ...merged,
    content: "",
    attachmentIds: [],
    attachments: [],
    deviceRefs: [],
    quote: undefined,
    reactions: [],
    deletedAt,
    deletedByUserId: incoming.deletedByUserId ?? current.deletedByUserId,
    deletionReason: incoming.deletionReason ?? current.deletionReason
  };
}

export function upsertMessage(messages: MessageRecord[], message: MessageRecord): MessageRecord[] {
  const next = messages.some((item) => item.id === message.id)
    ? messages.map((item) => item.id === message.id ? mergeMessageRecord(item, message) : item)
    : [...messages, message];
  return next.sort((a, b) => a.channelId === b.channelId ? a.seq - b.seq : a.createdAt.localeCompare(b.createdAt));
}

export function mergeMessages(messages: MessageRecord[], incoming: MessageRecord[]): MessageRecord[] {
  return incoming.reduce((items, message) => upsertMessage(items, message), messages);
}

export function mergeWorkspaceCachePreservingMessageCache(current: AppSnapshot, incoming: AppSnapshot): AppSnapshot {
  if (workspaceCacheServerId(current) !== workspaceCacheServerId(incoming)) return incoming;
  // Workspace sync intentionally omits paged message history; same-server bootstrap updates must not clear the local cache.
  return {
    ...incoming,
    messages: incoming.messages.length === 0 ? current.messages : mergeMessages(current.messages, incoming.messages),
    crossWorkspaceMessages: incoming.crossWorkspaceMessages.length === 0
      ? current.crossWorkspaceMessages
      : upsertRecordsById(current.crossWorkspaceMessages, incoming.crossWorkspaceMessages),
    communicationAgentProgress: incoming.communicationAgentProgress?.length
      ? incoming.communicationAgentProgress
      : current.communicationAgentProgress ?? []
  };
}

function upsertRecordsById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  return incoming.reduce((items, item) => upsertById(items, item), current);
}

export function upsertTask(tasks: TaskRecord[], task: TaskRecord): TaskRecord[] {
  const next = tasks.some((item) => item.messageId === task.messageId || item.id === task.id)
    ? tasks.map((item) => item.messageId === task.messageId || item.id === task.id ? { ...item, ...task, id: item.id || task.id } : item)
    : [...tasks, task];
  return next.sort((a, b) => a.channelId === b.channelId ? a.taskNumber - b.taskNumber : a.createdAt.localeCompare(b.createdAt));
}

export function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some((current) => current.id === item.id)
    ? items.map((current) => current.id === item.id ? { ...current, ...item } : current)
    : [...items, item];
}

export function relativeTime(date: string): string {
  const diff = Math.max(0, Date.now() - new Date(date).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + " min ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " hour" + (hours === 1 ? "" : "s") + " ago";
  const days = Math.floor(hours / 24);
  return days + " day" + (days === 1 ? "" : "s") + " ago";
}

export function formatBytes(value: number): string {
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(value < 10 * 1024 ? 1 : 0) + " KB";
  return (value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0) + " MB";
}

export function formatTime(date: string | number): string {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function memberProfileDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
