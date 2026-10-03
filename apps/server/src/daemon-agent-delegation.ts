import type { AgentDelegateResultPayload, DaemonInbound, DaemonOutbound, MachineRecord } from "@tyr-ai/contracts";
import { delegateAgentExecution } from "./agent-delegation";
import type { ServerRouteContext } from "./server-context";

type DaemonAgentDelegateMessage = Extract<DaemonOutbound, { type: "agent:delegate" }>;

export function handleAgentDelegateFromDaemon(
  ctx: ServerRouteContext,
  machine: MachineRecord,
  msg: DaemonAgentDelegateMessage
): AgentDelegateResultPayload {
  const sourceAgent = ctx.store.getAgent(msg.request.sourceAgentId);
  const result: AgentDelegateResultPayload = !sourceAgent || sourceAgent.machineId !== machine.id
    ? { requestId: msg.request.requestId, ok: false, status: 404, error: "agent_not_found" }
    : serviceResultToDaemonResult(msg.request.requestId, delegateAgentExecution(ctx, {
      sourceAgent,
      targetAgent: msg.request.targetAgent,
      instruction: msg.request.instruction,
      attachmentIds: msg.request.attachmentIds,
      sourceExecutionId: msg.request.sourceExecutionId,
      sourceMessageId: msg.request.sourceMessageId,
      returnMode: msg.request.returnMode,
      expectReply: msg.request.expectReply,
      transport: "daemon_native"
    }));

  // The source daemon gets the outcome immediately; target wake delivery remains server-owned.
  ctx.sendToDaemon(machine.id, { type: "agent:delegate:result", agentId: msg.request.sourceAgentId, result } satisfies DaemonInbound);
  return result;
}

function serviceResultToDaemonResult(requestId: string, result: ReturnType<typeof delegateAgentExecution>): AgentDelegateResultPayload {
  if (!result.ok) {
    return {
      requestId,
      ok: false,
      status: result.status,
      error: result.error,
      detail: result.detail
    };
  }
  return {
    requestId,
    ok: true,
    delegation: result.delegation,
    execution: result.execution
  };
}
