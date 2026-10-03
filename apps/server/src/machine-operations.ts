import type { AgentRecord } from "@tyr-ai/contracts";

export type MachineBatchAction = "start" | "stop" | "restart" | "reset";

export type MachineAgentBatchResult = {
  agentId: string;
  ok: boolean;
  stopped: boolean;
  started: boolean;
};

export type MachineAgentBatchSummary = {
  ok: boolean;
  action: MachineBatchAction;
  total: number;
  stopped: number;
  started: number;
  results: MachineAgentBatchResult[];
};

type MachineAgentBatchCallbacks = {
  start(agent: AgentRecord): boolean;
  stop(agent: AgentRecord): boolean;
  markOffline(agent: AgentRecord): void;
};

export function runMachineAgentBatchAction(
  agents: AgentRecord[],
  action: MachineBatchAction,
  callbacks: MachineAgentBatchCallbacks
): MachineAgentBatchSummary {
  const results = agents.map((agent) => {
    let stopped = false;
    let started = false;

    if (action === "stop" || action === "restart" || action === "reset") {
      stopped = callbacks.stop(agent);
      // Stop All 是明确的人工下线动作；即使 daemon 当前离线，server 真源也应立即展示为 offline。
      if (action === "stop") callbacks.markOffline(agent);
    }

    if (action === "start" || action === "restart" || action === "reset") {
      started = callbacks.start(agent);
    }

    const ok = action === "start"
      ? started
      : action === "stop"
        ? stopped
        : stopped && started;

    return { agentId: agent.id, ok, stopped, started };
  });

  return {
    ok: results.every((item) => item.ok),
    action,
    total: results.length,
    stopped: results.filter((item) => item.stopped).length,
    started: results.filter((item) => item.started).length,
    results
  };
}
