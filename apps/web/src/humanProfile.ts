import { isCommunicationAgent, type AgentRecord, type AgentStatus, type MachineRecord, type RuntimeId, type ServerInviteRecord, type ServerRecord, type UserRecord } from "@tyr-ai/contracts";

export type HumanProfileAgentSummary = {
  id: string;
  ownerUserId: string;
  machineId: string | null;
  name: string;
  displayName: string;
  avatarUrl: string | null;
  runtime: RuntimeId | null;
  status: AgentStatus;
};

export type HumanCreatedAgentGroup = {
  id: string;
  label: string;
  status: MachineRecord["status"] | "unknown";
  hostname?: string;
  agents: HumanProfileAgentSummary[];
};

export type HumanProfileRecord = {
  userId: string;
  name: string;
  displayName: string;
  description: string | null;
  avatarUrl: string | null;
  role: "owner" | "member" | "guest";
  joinedAt: string;
  email: string | null;
  gravatarHash: string | null;
  membershipStatus: "active" | "invited" | "removed";
  createdAgents: HumanProfileAgentSummary[];
};

export type HumanRoleActionState = {
  canManageMembers: boolean;
  canRemove: boolean;
  removeReason: string;
  plannedRoleAction: {
    label: string;
    disabledReason: string;
  };
};

export function fallbackHumanProfile(human: UserRecord, currentUser: UserRecord, currentUserServerRole: "owner" | "member" | "guest" = "member"): HumanProfileRecord {
  return {
    userId: human.id,
    name: human.name,
    displayName: human.displayName,
    description: human.description ?? null,
    avatarUrl: human.avatarUrl ?? null,
    email: human.email ?? null,
    gravatarHash: null,
    // Snapshot 兜底优先使用当前 server membership metadata；没有 metadata 的旧快照才退回历史默认值。
    role: humanServerRole(human, currentUser, currentUserServerRole),
    joinedAt: human.serverJoinedAt ?? human.createdAt,
    membershipStatus: "active",
    createdAgents: []
  };
}

export function humanServerRole(human: UserRecord, currentUser: UserRecord, currentUserServerRole: "owner" | "member" | "guest" = "member"): "owner" | "member" | "guest" {
  return human.serverRole ?? (human.id === currentUser.id ? currentUserServerRole : "member");
}

export function memberPanelHumans<TUser extends UserRecord>(humans: TUser[]): TUser[] {
  return humans.filter((human) => human.membershipVisible !== false);
}

export function humanCreatedAgentsForDisplay(profileAgents: HumanProfileAgentSummary[], snapshotAgents: AgentRecord[], ownerUserId: string): HumanProfileAgentSummary[] {
  const liveAgentsById = new Map(snapshotAgents.map((agent) => [agent.id, agent]));
  const seenAgentIds = new Set<string>();
  const baseAgents = profileAgents.length
    ? profileAgents
    : snapshotAgents.filter((agent) => agent.ownerUserId === ownerUserId && !isCommunicationAgent(agent)).map(humanProfileAgentSummaryFromRecord);
  const displayAgents = baseAgents.map((profileAgent) => {
    seenAgentIds.add(profileAgent.id);
    const liveAgent = liveAgentsById.get(profileAgent.id);
    if (!liveAgent) return profileAgent;
    // websocket-maintained snapshot agents are the current runtime truth; profile data only supplies initial identity metadata.
    return {
      ...profileAgent,
      ownerUserId: liveAgent.ownerUserId,
      machineId: liveAgent.machineId,
      name: liveAgent.name,
      displayName: liveAgent.displayName,
      avatarUrl: profileAgent.avatarUrl ?? liveAgent.avatarUrl ?? null,
      runtime: liveAgent.runtime,
      status: liveAgent.status
    };
  });
  if (profileAgents.length) {
    for (const liveAgent of snapshotAgents) {
      if (liveAgent.ownerUserId !== ownerUserId || seenAgentIds.has(liveAgent.id) || isCommunicationAgent(liveAgent)) continue;
      displayAgents.push(humanProfileAgentSummaryFromRecord(liveAgent));
    }
  }
  return displayAgents;
}

export function humanCreatedAgentGroupsForDisplay(createdAgents: HumanProfileAgentSummary[], machines: MachineRecord[]): HumanCreatedAgentGroup[] {
  const machineRank = new Map(machines.map((machine, index) => [machine.id, index]));
  const machinesById = new Map(machines.map((machine) => [machine.id, machine]));
  const groups = new Map<string, HumanProfileAgentSummary[]>();
  for (const agent of createdAgents) {
    const machineId = agent.machineId ?? "";
    const group = groups.get(machineId) ?? [];
    group.push(agent);
    groups.set(machineId, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (machineRank.get(left) ?? Number.MAX_SAFE_INTEGER) - (machineRank.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right))
    .map(([machineId, agents]) => {
      const machine = machinesById.get(machineId);
      return {
        id: machineId,
        label: machine?.name ?? "Missing device",
        status: machine?.status ?? "unknown",
        hostname: machine?.hostname,
        agents
      };
    });
}

function humanProfileAgentSummaryFromRecord(agent: AgentRecord): HumanProfileAgentSummary {
  return {
    id: agent.id,
    ownerUserId: agent.ownerUserId,
    machineId: agent.machineId,
    name: agent.name,
    displayName: agent.displayName,
    avatarUrl: agent.avatarUrl ?? null,
    runtime: agent.runtime,
    status: agent.status
  };
}

export function humanProfileApiAllowed(human: UserRecord, currentUser: UserRecord, currentUserServerRole: "owner" | "member" | "guest" = "member"): boolean {
  if (human.membershipVisible === false) return false;
  if (currentUserServerRole === "owner" || currentUserServerRole === "member") return true;
  return human.serverRole === "owner" && human.id !== currentUser.id;
}

export function humanRoleActionState(profile: Pick<HumanProfileRecord, "userId" | "role" | "membershipStatus">, currentUser: UserRecord, currentServer?: Pick<ServerRecord, "role"> | null): HumanRoleActionState {
  const canManageMembers = currentServer?.role === "owner";
  const isSelf = profile.userId === currentUser.id;
  const canRemove = canManageMembers && !isSelf && profile.role !== "owner" && profile.membershipStatus === "active";
  const removeReason = !canManageMembers
    ? "Only owners can remove members."
    : isSelf
      ? "You cannot remove yourself."
      : profile.role === "owner"
        ? "Owners cannot be removed from this entry."
        : profile.membershipStatus !== "active"
          ? "Only active members can be removed."
          : "";
  return {
    canManageMembers,
    canRemove,
    removeReason,
    plannedRoleAction: {
      label: profile.role === "owner" ? "Demote to member" : "Promote to owner",
      disabledReason: profile.role === "owner" ? "Role demotion is planned for a later pass." : "Role promotion is planned for a later pass."
    }
  };
}

export function memberRoleLabel(role: "owner" | "member" | "guest"): string {
  if (role === "owner") return "Owner";
  if (role === "guest") return "Guest";
  return "Member";
}

export function humanProfileFacts(profile: Pick<HumanProfileRecord, "role" | "email" | "joinedAt" | "createdAgents">): Array<[string, string]> {
  return [
    ["Role", memberRoleLabel(profile.role)],
    ["Email", profile.email ?? "No email"],
    ["Joined", new Date(profile.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })],
    ["Created agents", String(profile.createdAgents.length)]
  ];
}

export function humanInviteSummary(invites: ServerInviteRecord[]): { countLabel: string; latestEmail: string } {
  const countLabel = invites.length === 1 ? "1 pending invite" : `${invites.length} pending invites`;
  return {
    countLabel,
    latestEmail: invites[0]?.invitedEmail ?? "No pending invites"
  };
}
