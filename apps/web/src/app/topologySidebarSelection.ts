import type { AgentRecord, ChannelRecord } from "@tyr-ai/contracts";
import type { WorkspaceView } from "../routing";
import { dmPeerAgentForChannel } from "../resourceAccess";

export type ActiveTopologySidebarSelection = {
  selectedAgentId?: string;
  selectedHumanId?: string;
  selectedMachineId?: string;
  selectedDeviceId?: string;
};

export function activeTopologySidebarSelection(input: {
  selectedAgentId?: string;
  selectedHumanId?: string;
  selectedMachineId?: string;
  selectedDeviceId?: string;
  view: WorkspaceView;
  selectedChannelId: string;
  channels: ChannelRecord[];
  agents: AgentRecord[];
}): ActiveTopologySidebarSelection {
  if (input.view === "chat") {
    const selectedChannel = input.channels.find((channel) => channel.id === input.selectedChannelId);
    // Chat 视图只允许 DM 驱动 Agent 选中态；冷保留的旧群聊记录不能重新进入侧栏。
    const dmAgent = dmPeerAgentForChannel(selectedChannel, input.agents);
    // DM 选中 Agent 时也要带出父 Computer，否则拓扑树会回退展开第一台机器。
    if (dmAgent) return dmAgent.machineId ? { selectedAgentId: dmAgent.id, selectedMachineId: dmAgent.machineId } : { selectedAgentId: dmAgent.id };
    return {};
  }

  if (input.view !== "topology") return {};

  const selection: ActiveTopologySidebarSelection = {};
  if (input.selectedAgentId) {
    selection.selectedAgentId = input.selectedAgentId;
    const agent = input.agents.find((item) => item.id === input.selectedAgentId);
    if (agent?.machineId) selection.selectedMachineId = agent.machineId;
  }
  if (input.selectedHumanId) selection.selectedHumanId = input.selectedHumanId;
  if (input.selectedMachineId) selection.selectedMachineId = input.selectedMachineId;
  if (input.selectedDeviceId) selection.selectedDeviceId = input.selectedDeviceId;
  return selection;
}

export function activeTopologySidebarAgentId(input: Parameters<typeof activeTopologySidebarSelection>[0]): string | undefined {
  return activeTopologySidebarSelection(input).selectedAgentId;
}
