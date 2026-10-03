import type { AgentRecord, AppSnapshot, PlatformOperatorWorkspaceViewPayload, UserRecord } from "@tyr-ai/contracts";

import { emptyWorkspaceCache } from "./app/workspaceUtils";

export function operatorWorkspaceSnapshot(payload: PlatformOperatorWorkspaceViewPayload): AppSnapshot {
  const ownerId = payload.machines[0]?.ownerUserId
    ?? payload.agents[0]?.ownerUserId
    ?? payload.devices[0]?.ownerUserId
    ?? `operator-projection:${payload.workspace.serverId}`;
  const owner: UserRecord = {
    id: ownerId,
    name: `${payload.workspace.serverName} owner`,
    displayName: `${payload.workspace.serverName} Owner`,
    serverRole: "owner",
    createdAt: payload.workspace.createdAt
  };
  // 现有 Workspace View 以 Owner id 投影本地资源；这里只构造展示上下文，不产生 Owner session。
  const agents: AgentRecord[] = payload.agents.map((agent) => ({ ...agent, authToken: "" }));
  const machines: AppSnapshot["machines"] = payload.machines.map((machine) => ({
    ...machine,
    apiKey: "",
    latestDaemonVersion: machine.latestDaemonVersion ?? machine.daemonVersion,
    agents: agents.filter((agent) => agent.machineId === machine.id)
  }));
  return {
    ...emptyWorkspaceCache,
    currentUser: owner,
    currentServer: {
      id: payload.workspace.serverId,
      name: payload.workspace.serverName,
      slug: payload.workspace.serverName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace",
      ownerId,
      onboardingAgentId: null,
      plan: "enterprise",
      planDowngradedAt: null,
      role: "owner",
      createdAt: payload.workspace.createdAt
    },
    machines,
    agents,
    humans: [owner],
    devices: payload.devices,
    workspaceBridges: payload.bridges,
    crossWorkspaceMessages: payload.interactions,
    peerWorkspaceTopologies: payload.peerWorkspaceTopologies,
    workspaceBridgeTopologyEdges: payload.workspaceBridgeTopologyEdges
  };
}
