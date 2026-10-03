import { isCommunicationAgent, type AgentRecord, type AgentStatus, type MachineRecord, type RuntimeId, type UserRecord } from "@tyr-ai/contracts";

export type MemberAgentStatusFilter = "all" | "active" | "offline" | "error";

export type MemberAgentFilterState = {
  search: string;
  status: MemberAgentStatusFilter;
};

export type MemberAgentGroup<TAgent extends AgentRecord = AgentRecord> = {
  id: string;
  label: string;
  status: MachineRecord["status"] | "unknown";
  remote: boolean;
  hostname?: string;
  agents: TAgent[];
};

const RUNTIME_LABELS: Record<RuntimeId, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  kimi: "Kimi CLI",
  copilot: "Copilot CLI",
  cursor: "Cursor CLI",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  antigravity: "Google Antigravity CLI"
};

export function filterMemberAgents(agents: AgentRecord[], machines: MachineRecord[], filters: MemberAgentFilterState): AgentRecord[] {
  const query = normalizeSearch(filters.search);
  const machinesById = new Map(machines.map((machine) => [machine.id, machine]));
  return agents.filter((agent) => {
    if (!matchesAgentStatus(agent.status, filters.status)) return false;
    if (!query) return true;
    const machine = agent.machineId ? machinesById.get(agent.machineId) : undefined;
    return [
      agent.name,
      agent.displayName,
      agent.description,
      agent.runtime,
      agent.runtime ? runtimeLabel(agent.runtime) : "Communication",
      agent.model,
      machine?.name,
      machine?.hostname,
      machine?.os
    ].some((value) => normalizeSearch(value ?? "").includes(query));
  });
}

export function filterMemberHumans(humans: UserRecord[], search: string): UserRecord[] {
  const query = normalizeSearch(search);
  if (!query) return humans;
  return humans.filter((human) => [
    human.name,
    human.displayName,
    human.email,
    human.description
  ].some((value) => normalizeSearch(value ?? "").includes(query)));
}

export function filterCreatableMachines<TMachine extends MachineRecord>(machines: TMachine[], currentUserId: string): TMachine[] {
  return machines.filter((machine) => machine.ownerUserId === currentUserId);
}

export function canManageMachine(machine: MachineRecord | undefined | null, currentUserId: string): machine is MachineRecord {
  return Boolean(machine && machine.ownerUserId === currentUserId);
}

export function groupMemberAgentsByComputer<TAgent extends AgentRecord>(agents: TAgent[], machines: MachineRecord[], currentUserId?: string): Array<MemberAgentGroup<TAgent>> {
  const machineRank = new Map(machines.map((machine, index) => [machine.id, index]));
  const machinesById = new Map(machines.map((machine) => [machine.id, machine]));
  const communicationAgents = agents.filter(isCommunicationAgent);
  const runtimeAgents = agents.filter((agent) => !isCommunicationAgent(agent));
  const groups = new Map<string, TAgent[]>();
  for (const agent of runtimeAgents) {
    const machineId = agent.machineId ?? "";
    const group = groups.get(machineId) ?? [];
    group.push(agent);
    groups.set(machineId, group);
  }
  const machineGroups: Array<MemberAgentGroup<TAgent>> = [...groups.entries()]
    .sort(([left], [right]) => (machineRank.get(left) ?? Number.MAX_SAFE_INTEGER) - (machineRank.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right))
    .map(([machineId, groupAgents]) => {
      const machine = machinesById.get(machineId);
      const missingMachineIsRemote = Boolean(currentUserId && !machine && groupAgents.some((agent) => agent.ownerUserId !== currentUserId));
      return {
        id: machineId,
        label: machine?.name ?? "Missing device",
        status: machine?.status ?? "unknown",
        remote: Boolean(currentUserId && (machine ? machine.ownerUserId !== currentUserId : missingMachineIsRemote)),
        hostname: machine?.hostname,
        agents: groupAgents
      };
    });
  return communicationAgents.length
    ? [{ id: "communication", label: "Communication", status: "online" as const, remote: false, agents: communicationAgents }, ...machineGroups]
    : machineGroups;
}

export function memberAgentStatusFilterOptions(agents: AgentRecord[]): Array<{ id: MemberAgentStatusFilter; label: string; count: number }> {
  return [
    { id: "all", label: "All", count: agents.length },
    { id: "active", label: "Active", count: agents.filter((agent) => matchesAgentStatus(agent.status, "active")).length },
    { id: "offline", label: "Offline", count: agents.filter((agent) => matchesAgentStatus(agent.status, "offline")).length },
    { id: "error", label: "Error", count: agents.filter((agent) => matchesAgentStatus(agent.status, "error")).length }
  ];
}

export function memberAgentSubtitle(agent: AgentRecord, machine?: MachineRecord): string {
  if (isCommunicationAgent(agent)) return "Workspace message hub";
  const machineLabel = machine?.name ?? agent.hostMachine?.name ?? "Missing device";
  const model = agent.model && agent.model !== "default" ? ` · ${agent.model}` : "";
  const lastError = memberAgentLastErrorLabel(agent);
  return `${runtimeLabel(agent.runtime)}${model} · ${machineLabel}${lastError ? ` · ${lastError}` : ""}`;
}

export function memberAgentLastErrorLabel(agent: AgentRecord): string {
  const lastError = agent.lastError?.trim();
  return lastError ? `Last error: ${lastError}` : "";
}

export function memberHumanRoleLabel(humanId: string, currentUserId: string, role: "owner" | "member" | "guest" = "member"): string {
  const roleLabel = role === "owner" ? "Owner" : role === "guest" ? "Guest" : "Member";
  return humanId === currentUserId ? `${roleLabel} · You` : roleLabel;
}

export function memberOrdinaryDeliveryLabel(): string {
  return "Listen to normal messages";
}

export function runtimeLabel(runtime: RuntimeId | null | undefined): string {
  if (!runtime) return "No runtime";
  return RUNTIME_LABELS[runtime] ?? runtime;
}

function matchesAgentStatus(status: AgentStatus, filter: MemberAgentStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return status === "online" || status === "working";
  return status === filter;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}
