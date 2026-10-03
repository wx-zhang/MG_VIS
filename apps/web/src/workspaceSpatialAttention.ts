import type {
  WorkspaceSpatialAgent,
  WorkspaceSpatialFlowSignal
} from "./workspaceSpatial";
import type { CommunicationFlowTone } from "./communicationFlow";

export type WorkspaceSpatialAttentionRole = "source" | "target";

export type WorkspaceSpatialAgentAttention = {
  flowId: string;
  executionId: string;
  tone: CommunicationFlowTone;
  role: WorkspaceSpatialAttentionRole;
  counterpartyAgentId?: string;
  continuous: boolean;
};

const ATTENTION_TONE_PRIORITY: Record<CommunicationFlowTone, number> = {
  error: 0,
  response: 1,
  request: 2
};

export function workspaceSpatialAgentAttention(
  agent: WorkspaceSpatialAgent,
  flows: WorkspaceSpatialFlowSignal[]
): WorkspaceSpatialAgentAttention | null {
  // unavailable 资源不会因迟到 Flow 恢复人物动作；路径本身仍可保留用于解释服务端事实。
  if (agent.state === "offline" || agent.state === "error") return null;

  const candidates = flows.flatMap((flow): WorkspaceSpatialAgentAttention[] => {
    // 自指 Flow 只按 target 处理一次，避免同一事实同时争抢 source / target 角色。
    if (flow.targetAgentId === agent.id) {
      return [{
        flowId: flow.id,
        executionId: flow.executionId,
        tone: flow.tone,
        role: "target",
        counterpartyAgentId: flow.sourceAgentId,
        continuous: flow.continuous
      }];
    }
    if (flow.sourceAgentId === agent.id) {
      return [{
        flowId: flow.id,
        executionId: flow.executionId,
        tone: flow.tone,
        role: "source",
        counterpartyAgentId: flow.targetAgentId,
        continuous: flow.continuous
      }];
    }
    return [];
  });

  // 多条真实 Flow 同时存在时保持错误与返回优先，并以 id 固定重放结果；不依赖数组到达顺序猜测焦点。
  return candidates.sort((left, right) => (
    ATTENTION_TONE_PRIORITY[left.tone] - ATTENTION_TONE_PRIORITY[right.tone]
    || left.flowId.localeCompare(right.flowId)
  ))[0] ?? null;
}
