import { isCommunicationAgent, type AgentRecord, type MachineRecord } from "@tyr-ai/contracts";

function machineServerId(machine: MachineRecord): string {
  return machine.serverId ?? "local";
}

export function canCreateAgentOnMachine(userId: string, machine: MachineRecord | null | undefined): boolean {
  // Computer 是本地执行边界；只有这台电脑的 owner 才能在上面创建 runtime agent。
  return Boolean(machine && !machine.deletedAt && machine.ownerUserId === userId);
}

export function canManageAgentRuntime(userId: string, agent: AgentRecord | null | undefined, machine: MachineRecord | null | undefined): boolean {
  if (isCommunicationAgent(agent)) return false;
  // Runtime 操作会影响本地进程、env 和 workspace，因此必须同时匹配 agent owner 与宿主 computer owner。
  return Boolean(agent && machine && !agent.deletedAt && !machine.deletedAt && agent.ownerUserId === userId && machine.ownerUserId === userId);
}

export function agentBelongsToServer(agent: AgentRecord | null | undefined, machine: MachineRecord | null | undefined, serverId: string | null | undefined): boolean {
  if (!agent || !serverId) return false;
  if (isCommunicationAgent(agent)) return (agent.serverId ?? "local") === serverId;
  if (!machine || agent.machineId !== machine.id) return false;
  return machineServerId(machine) === serverId;
}
