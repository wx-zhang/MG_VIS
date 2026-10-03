import type { AgentRecord, ChannelRecord } from "@tyr-ai/contracts";
import { dmChannelForAgent } from "./resourceAccess";
import { chatPathForChannel } from "./routing";

type OpenAgentDmNavigationInput = {
  agentId: string;
  agent?: AgentRecord;
  agents: AgentRecord[];
  channels: ChannelRecord[];
  api: (path: string) => Promise<{ channel: ChannelRecord }>;
  refresh: () => Promise<void>;
  navigate: (path: string) => void;
  workspacePath: (path: string) => string;
};

export type OpenAgentDmNavigationResult =
  | { status: "opened" }
  | { status: "not_found" };

export async function openAgentDmNavigation(input: OpenAgentDmNavigationInput): Promise<OpenAgentDmNavigationResult> {
  const agent = input.agents.find((item) => item.id === input.agentId) ?? (input.agent?.id === input.agentId ? input.agent : undefined);
  if (!agent) return { status: "not_found" };
  const cachedDm = dmChannelForAgent(input.channels, agent);
  if (cachedDm) {
    input.navigate(input.workspacePath(chatPathForChannel(cachedDm)));
    return { status: "opened" };
  }
  const data = await input.api(`/api/agents/${input.agentId}/dm`);
  // 新建 DM 还不在当前 snapshot 时，如果先导航，route guard 会把未知 channel 回退到默认群聊。
  await input.refresh();
  input.navigate(input.workspacePath(chatPathForChannel(data.channel)));
  return { status: "opened" };
}
