import { isCommunicationAgent, type AgentRecord, type ChannelRecord, type ChannelType, type MachineRecord, type ResourceGrantScope, type UserRecord } from "@tyr-ai/contracts";

export type AgentProfileTab = "profile" | "permissions" | "reminders" | "workspace" | "activity";

export type MemberHierarchyRow =
  | { kind: "human"; id: string; depth: 0; shared: false; human: UserRecord }
  | { kind: "machine"; id: string; depth: 1; shared: boolean; machine: MachineRecord }
  | { kind: "agent"; id: string; depth: 2; shared: boolean; agent: AgentRecord };

function hasScope(scopes: readonly string[] | undefined, scope: ResourceGrantScope): boolean {
  return Boolean(scopes?.includes(scope));
}

function hasAnyScope(scopes: readonly string[] | undefined, targets: ResourceGrantScope[]): boolean {
  return targets.some((scope) => hasScope(scopes, scope));
}

export function hasBridgeFullAccess(resource: { bridgeAccess?: { fullAccess: true }; access?: { bridge?: { fullAccess: true } } } | null | undefined): boolean {
  return Boolean(resource?.bridgeAccess?.fullAccess || resource?.access?.bridge?.fullAccess);
}

export function agentIsChannelOnlyIdentity(agent: AgentRecord): boolean {
  return Boolean(agent.access?.shared && !agent.access.scopes?.length);
}

export function agentCanParticipateInChannel(agent: AgentRecord, currentUserId: string): boolean {
  if (isCommunicationAgent(agent)) return false;
  if (agentIsChannelOnlyIdentity(agent)) return false;
  if (agent.ownerUserId === currentUserId && !agent.access?.shared) return true;
  if (!agent.access?.shared) return true;
  return hasAnyScope(agent.access.scopes, ["message", "task"]);
}

function isInternalPairDmName(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith("dm-user-"));
}

function displayNameWithoutDmPrefix(value: string | null | undefined): string {
  return (value ?? "").replace(/^DM\s*@?/, "").trim();
}

export function sharedResourceLabel(resource: { access?: { shared: boolean } }): string {
  return resource.access?.shared ? "Shared" : "";
}

export function agentProfileTabsForAccess(agent: AgentRecord): AgentProfileTab[] {
  if (isCommunicationAgent(agent)) return ["profile", "activity"];
  if (hasBridgeFullAccess(agent)) return ["profile", "permissions", "reminders", "workspace", "activity"];
  if (agent.access?.shared) return ["profile", "activity"];
  return ["profile", "permissions", "reminders", "workspace", "activity"];
}

export function agentCanOpenDm(agent: AgentRecord, currentUserId: string): boolean {
  if (agentIsChannelOnlyIdentity(agent)) return false;
  // Bridge conversations stay in the Bridge surface; full operational access must not merge private Human-Agent conversations.
  if (hasBridgeFullAccess(agent)) return false;
  if (isCommunicationAgent(agent)) return true;
  return agent.ownerUserId === currentUserId || hasScope(agent.access?.scopes, "message");
}

export function directMessageAgents(agents: AgentRecord[], currentUserId: string, channels: ChannelRecord[] = []): AgentRecord[] {
  return agents.filter((agent) => (
    !agentIsChannelOnlyIdentity(agent) &&
    (!agent.access?.shared || hasScope(agent.access.scopes, "message")) &&
    (agentCanOpenDm(agent, currentUserId) || Boolean(dmChannelForAgent(channels, agent)))
  ));
}

export function agentVisibleInResourcePanels(agent: AgentRecord, currentUserId: string): boolean {
  // A DM may expose a remote Agent as a chat identity; resource panels still require owner/full access/grant scopes.
  if (agentIsChannelOnlyIdentity(agent)) return false;
  return agent.ownerUserId === currentUserId || !agent.access?.shared || Boolean(agent.access.scopes?.length);
}

export function resourcePanelAgents<TAgent extends AgentRecord>(agents: TAgent[], currentUserId: string, machines?: MachineRecord[]): TAgent[] {
  const visibleMachineIds = machines ? new Set(machines.map((machine) => machine.id)) : null;
  return agents.filter((agent) => {
    if (agentIsChannelOnlyIdentity(agent)) return false;
    if (visibleMachineIds && (!agent.machineId || !visibleMachineIds.has(agent.machineId))) {
      if (agent.access?.shared && agent.access.scopes?.length) return true;
      return agent.ownerUserId === currentUserId;
    }
    if (agent.machineMissing && agent.ownerUserId !== currentUserId) return false;
    return agentVisibleInResourcePanels(agent, currentUserId);
  });
}

export function ownedServerAgents<TAgent extends AgentRecord>(agents: TAgent[], machines: MachineRecord[]): TAgent[] {
  const localMachineIds = new Set(machines.filter((machine) => !machine.access?.shared).map((machine) => machine.id));
  return agents.filter((agent) => !isCommunicationAgent(agent) && !agent.access?.shared && Boolean(agent.machineId && localMachineIds.has(agent.machineId)));
}

export function sharedResourceAgents<TAgent extends AgentRecord>(agents: TAgent[]): TAgent[] {
  return agents.filter((agent) => Boolean(agent.access?.shared && agent.access.scopes?.length));
}

export function channelOnlyAgents<TAgent extends AgentRecord>(agents: TAgent[]): TAgent[] {
  return agents.filter(agentIsChannelOnlyIdentity);
}

export function machineOwnerControlsVisible(machine: MachineRecord | null | undefined, currentUserId: string): machine is MachineRecord {
  return Boolean(machine && (hasBridgeFullAccess(machine) || (machine.ownerUserId === currentUserId && !machine.access?.shared)));
}

export function machineCredentialControlsVisible(machine: MachineRecord | null | undefined, currentUserId: string): machine is MachineRecord {
  return Boolean(machine && !hasBridgeFullAccess(machine) && machine.ownerUserId === currentUserId && !machine.access?.shared);
}

export function dmPeerAgentForChannel(channel: ChannelRecord | null | undefined, agents: AgentRecord[]): AgentRecord | undefined {
  if (!channel || channel.type !== "dm") return undefined;
  if (channel.dmPeerAgentId) return agents.find((agent) => agent.id === channel.dmPeerAgentId);
  const name = channel.name.toLowerCase();
  return agents.find((agent) => agent.name.toLowerCase() === name || agent.displayName.toLowerCase() === name);
}

export function isCommunicationAgentDmChannel(channel: ChannelRecord | null | undefined, agents: AgentRecord[]): boolean {
  // TYR 的执行与回流固定留在主 DM，不把它误当成可继续分叉的普通 Runtime Agent DM。
  return isCommunicationAgent(dmPeerAgentForChannel(channel, agents));
}

export function dmChannelForAgent(channels: ChannelRecord[], agent: AgentRecord): ChannelRecord | undefined {
  return channels.find((channel) => (
    channel.type === "dm" &&
    (channel.dmPeerAgentId === agent.id || (!channel.dmPeerAgentId && (channel.name === agent.name || channel.name === agent.displayName)))
  ));
}

export function dmTitle(channel: ChannelRecord | null | undefined, agents: AgentRecord[]): string {
  const peer = dmPeerAgentForChannel(channel, agents);
  if (peer) return peer.displayName || peer.name;
  if (!channel) return "DM";
  if (channel.dmPeerAgentDisplayName) return channel.dmPeerAgentDisplayName;
  if (channel.dmPeerAgentName) return channel.dmPeerAgentName;
  const displayName = displayNameWithoutDmPrefix(channel.displayName);
  if (displayName && !isInternalPairDmName(displayName)) return displayName;
  // Pair DM 的 name 是路由唯一值；没有可读 metadata 时宁可显示通用 DM，也不能泄露内部 slug。
  return isInternalPairDmName(channel.name) ? "DM" : channel.name;
}

export function dmComposerPlaceholder(channel: ChannelRecord | null | undefined, agents: AgentRecord[]): string {
  const peer = dmPeerAgentForChannel(channel, agents);
  if (isCommunicationAgent(peer)) return "Message TYR";
  const displayName = displayNameWithoutDmPrefix(channel?.displayName);
  const fallbackName = channel && !isInternalPairDmName(channel.name) ? channel.name : "";
  const handle = peer?.name ?? channel?.dmPeerAgentName ?? (displayName || fallbackName);
  return handle ? `Message @${handle}` : "Message DM";
}

export function channelDisplayName(channel: ChannelRecord | null | undefined, agents: AgentRecord[] = []): string {
  if (!channel) return "channel";
  if (channel.type === "dm") return dmTitle(channel, agents);
  if (channel.type === "thread") return channel.displayName || channel.name || "Thread";
  return channel.name || channel.displayName || "channel";
}

export function channelDisplayLabel(channel: ChannelRecord | null | undefined, agents: AgentRecord[] = []): string {
  if (!channel) return "channel";
  if (channel.type === "dm") {
    const peer = dmPeerAgentForChannel(channel, agents);
    if (isCommunicationAgent(peer) || channel.displayName === "TYR DM") return "TYR DM";
    const title = channelDisplayName(channel, agents);
    return title === "DM" ? "DM" : `DM @${title}`;
  }
  if (channel.type === "thread") return channelDisplayName(channel, agents);
  return `#${channelDisplayName(channel, agents)}`;
}

export function channelDisplayLabelFromFields(input: { type?: ChannelType | string | null; name?: string | null; displayName?: string | null }): string {
  if (input.type === "dm") {
    if (input.displayName === "TYR DM") return "TYR DM";
    const displayName = displayNameWithoutDmPrefix(input.displayName);
    const rawName = input.name ?? "";
    const title = displayName && !isInternalPairDmName(displayName)
      ? displayName
      : isInternalPairDmName(rawName)
        ? "DM"
        : rawName || "DM";
    return title === "DM" ? "DM" : `DM @${title}`;
  }
  if (input.type === "thread") return input.displayName || input.name || "Thread";
  return `#${input.name || input.displayName || "channel"}`;
}

export function channelMemberAgentCandidates<TAgent extends AgentRecord>(agents: TAgent[], currentUserId: string): TAgent[] {
  return agents.filter((agent) => agentCanParticipateInChannel(agent, currentUserId));
}

export function mentionableAgentsForChannel<TAgent extends AgentRecord>(agents: TAgent[], currentUserId: string): TAgent[] {
  return agents.filter((agent) => agentCanParticipateInChannel(agent, currentUserId));
}

export function memberHierarchyRows(humans: UserRecord[], machines: MachineRecord[], agents: AgentRecord[]): MemberHierarchyRow[] {
  const agentsByMachine = new Map<string, AgentRecord[]>();
  for (const agent of agents.filter((item) => !isCommunicationAgent(item))) {
    const machineId = agent.machineId ?? "";
    const items = agentsByMachine.get(machineId) ?? [];
    items.push(agent);
    agentsByMachine.set(machineId, items);
  }

  const rows: MemberHierarchyRow[] = [];
  for (const human of humans) {
    rows.push({ kind: "human", id: human.id, depth: 0, shared: false, human });
    for (const machine of machines.filter((item) => item.ownerUserId === human.id)) {
      rows.push({ kind: "machine", id: machine.id, depth: 1, shared: Boolean(machine.access?.shared), machine });
      for (const agent of agentsByMachine.get(machine.id) ?? []) {
        rows.push({ kind: "agent", id: agent.id, depth: 2, shared: Boolean(agent.access?.shared || machine.access?.shared), agent });
      }
    }
  }
  return rows;
}
