import type { AgentRecord, AgentWakeRuntimeContext, MessageRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import { runtimeContextRefForMessage } from "./runtime-context-session";

type RuntimeContextDispatchStore = Pick<
  TyrDb,
  "getConversation" | "getMessage" | "getRuntimeExecution" | "prepareRuntimeExecutionSession" | "resolveTarget"
>;

export function prepareRuntimeContextWake(
  store: RuntimeContextDispatchStore,
  input: {
    message: MessageRecord;
    agent: AgentRecord & { machineId: string; runtime: NonNullable<AgentRecord["runtime"]> };
    executionId: string;
    serverId: string;
    launchId?: string;
  }
): AgentWakeRuntimeContext | null {
  const context = runtimeContextRefForMessage(store, input.message);
  const execution = store.getRuntimeExecution(input.executionId);
  if (!context || !execution || execution.runtimeContextKey !== context.key) return null;

  const prepared = store.prepareRuntimeExecutionSession({
    serverId: input.serverId,
    agentId: input.agent.id,
    machineId: input.agent.machineId,
    runtime: input.agent.runtime,
    contextKind: context.kind,
    contextId: context.id,
    contextKey: context.key,
    executionId: execution.id,
    launchId: input.launchId
  });
  if (!prepared) return null;
  const action = prepared.session.status === "ready" && prepared.session.runtimeSessionId ? "resume" : "start";
  return {
    kind: context.kind,
    id: context.id,
    key: context.key,
    session_record_id: prepared.session.id,
    generation: prepared.session.generation,
    runtime_session_id: prepared.session.runtimeSessionId,
    action,
    // 新 Thread generation 需要 P0 快照播种；已恢复 Session 只接收当前消息。
    seed: context.kind === "thread" && action === "start" ? "thread_snapshot" : "current_message"
  };
}
