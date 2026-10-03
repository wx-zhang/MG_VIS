import {
  LATEST_DAEMON_VERSION,
  isCommunicationAgent,
  type AgentCreatorSummary,
  type AgentListItem,
  type AgentRecord,
  type MachineListItem,
  type MachineListResponse,
  type MachineRecord,
  type MessageRecord,
  type RuntimeReport
} from "@tyr-ai/contracts";
import { runtimeUpdateAvailable } from "./runtime-release";

export function formatMachineListItem(machine: MachineRecord, runtimes: RuntimeReport[], latestRuntimeSha?: string): MachineListItem {
  return {
    id: machine.id,
    serverId: machine.serverId ?? "local",
    userId: machine.ownerUserId,
    name: machine.name,
    // Computer 列表只需要展示密钥前缀用于识别，不能把可连接凭证下发给普通列表接口。
    apiKeyPrefix: machine.apiKey.slice(0, 22),
    runtimes: runtimes.filter((runtime) => runtime.status === "available").map((runtime) => runtime.runtime),
    hostname: machine.hostname,
    os: machine.os,
    daemonVersion: machine.daemonVersion,
    latestDaemonVersion: LATEST_DAEMON_VERSION,
    runtimeMarker: machine.runtimeMarker,
    runtimeSha: machine.runtimeSha,
    runtimeMarkerMtime: machine.runtimeMarkerMtime,
    latestRuntimeSha,
    runtimeUpdateAvailable: runtimeUpdateAvailable(machine.runtimeSha, latestRuntimeSha),
    lastHeartbeat: machine.lastSeenAt,
    createdAt: machine.createdAt,
    status: machine.status
  };
}

export function formatMachineListResponse(machines: Array<{ machine: MachineRecord; runtimes: RuntimeReport[] }>, latestRuntimeSha?: string): MachineListResponse {
  return {
    latestDaemonVersion: LATEST_DAEMON_VERSION,
    latestRuntimeSha,
    machines: machines.map(({ machine, runtimes }) => formatMachineListItem(machine, runtimes, latestRuntimeSha))
  };
}

export function formatAgentListItem(agent: AgentRecord, context: {
  serverId: string;
  creator?: AgentCreatorSummary | null;
  activityDetail?: string;
}): AgentListItem {
  const communication = isCommunicationAgent(agent);
  // 网站层区分“可操作状态”和“活动状态”：online/working 都代表进程有效，其余状态在列表里视为 inactive。
  const active = communication || agent.status === "online" || agent.status === "working";
  const activity = agent.status === "working"
    ? "thinking"
    : agent.status === "online"
      ? "online"
      : agent.status === "error"
        ? "error"
        : "offline";

  return {
    id: agent.id,
    serverId: agent.serverId ?? context.serverId,
    kind: agent.kind ?? "on_device",
    name: agent.name,
    displayName: agent.displayName,
    avatarUrl: agent.avatarUrl ?? null,
    description: agent.description ?? null,
    status: active ? "active" : "inactive",
    sessionId: agent.sessionId ?? null,
    model: agent.model ?? null,
    runtime: agent.runtime,
    reasoningEffort: agent.reasoningEffort ?? null,
    executionMode: communication ? "server-hosted" : "byoc",
    creatorType: communication ? "system" : "user",
    creatorId: agent.ownerUserId,
    machineId: agent.machineId ?? null,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    activity: communication ? "online" : activity,
    activityDetail: context.activityDetail ?? agent.lastError ?? (communication ? "Workspace message hub" : ""),
    creator: context.creator ?? null
  };
}

export function lastMessageAt(channelId: string, messages: MessageRecord[]): string | null {
  let latest: string | null = null;
  for (const message of messages) {
    if (message.channelId !== channelId) continue;
    if (!latest || message.createdAt > latest) latest = message.createdAt;
  }
  return latest;
}
