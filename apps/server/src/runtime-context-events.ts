import type { DaemonAgentStateSnapshot, DaemonContextSessionEvent, DaemonInbound, RuntimeExecutionEventRecord, RuntimeExecutionRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";

type RuntimeContextEventStore = Pick<
  TyrDb,
  "appendRuntimeExecutionEvent" | "bindAgentRuntimeSession" | "bindRuntimeExecutionSession" | "getAgent" | "getAgentRuntimeSession" | "getRuntimeExecution" |
  "listRuntimeExecutionEvents" | "markAgentRuntimeSessionFailed" | "replaceAgentRuntimeSession" | "updateRuntimeExecutionStatus"
>;

export type RuntimeContextEventResult = {
  accepted: boolean;
  execution?: RuntimeExecutionRecord;
  event?: RuntimeExecutionEventRecord;
  replacement?: Extract<DaemonInbound, { type: "agent:context_session:replace" }>;
};

function diagnosticCode(event: RuntimeExecutionEventRecord): string | undefined {
  if (!event.payload || typeof event.payload !== "object") return undefined;
  const code = (event.payload as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

export function replacementForDaemonContextSnapshot(
  store: RuntimeContextEventStore,
  machineId: string,
  state: DaemonAgentStateSnapshot
): Extract<DaemonInbound, { type: "agent:context_session:replace" }> | null {
  if (!state.activeExecutionId || !state.activeContextKey || !state.activeSessionRecordId) return null;
  const agent = store.getAgent(state.agentId);
  const execution = store.getRuntimeExecution(state.activeExecutionId);
  const failed = store.getAgentRuntimeSession(state.activeSessionRecordId);
  const replacement = execution?.runtimeSessionRecordId ? store.getAgentRuntimeSession(execution.runtimeSessionRecordId) : null;
  // server 重启后仅重发已经原子落库、且 daemon 快照仍停在旧 generation 的 replacement。
  if (
    !agent || !execution || !failed || !replacement ||
    ["completed", "failed", "cancelled", "stalled"].includes(execution.status) ||
    agent.machineId !== machineId || agent.launchId !== state.launchId ||
    execution.agentId !== agent.id || execution.machineId !== machineId ||
    execution.runtimeContextKey !== state.activeContextKey ||
    failed.agentId !== agent.id || failed.machineId !== machineId || failed.runtime !== execution.runtime ||
    failed.status !== "failed" || failed.contextKey !== state.activeContextKey ||
    replacement.agentId !== agent.id || replacement.machineId !== machineId || replacement.runtime !== execution.runtime ||
    replacement.status !== "pending" || replacement.contextKey !== state.activeContextKey ||
    replacement.generation !== failed.generation + 1 ||
    replacement.firstExecutionId !== execution.id
  ) return null;
  return {
    type: "agent:context_session:replace",
    agentId: agent.id,
    executionId: execution.id,
    contextKey: failed.contextKey,
    failedSessionRecordId: failed.id,
    replacement: {
      sessionRecordId: replacement.id,
      generation: replacement.generation
    }
  };
}

export function applyDaemonContextSessionEvent(
  store: RuntimeContextEventStore,
  machineId: string,
  input: DaemonContextSessionEvent
): RuntimeContextEventResult {
  const agent = store.getAgent(input.agentId);
  const execution = store.getRuntimeExecution(input.executionId);
  const session = store.getAgentRuntimeSession(input.sessionRecordId);
  // Session 事件只接受当前 launch 下仍可推进的精确 execution/context generation；迟到终态事件不得回写映射。
  if (
    !agent || !execution || !session ||
    ["completed", "failed", "cancelled", "stalled"].includes(execution.status) ||
    agent.machineId !== machineId ||
    agent.launchId !== input.launchId ||
    execution.serverId !== session.serverId ||
    execution.agentId !== agent.id ||
    execution.machineId !== machineId ||
    execution.runtime !== session.runtime ||
    execution.runtimeContextKey !== input.contextKey ||
    execution.runtimeSessionRecordId !== session.id ||
    execution.runtimeSessionGeneration !== input.generation ||
    session.agentId !== agent.id ||
    session.machineId !== machineId ||
    session.contextKey !== input.contextKey ||
    session.generation !== input.generation ||
    session.lastLaunchId !== input.launchId
  ) {
    const observableRejection = agent && execution &&
      !["completed", "failed", "cancelled", "stalled"].includes(execution.status) &&
      agent.machineId === machineId && execution.machineId === machineId && execution.agentId === agent.id;
    const event = observableRejection
      ? store.appendRuntimeExecutionEvent({
          executionId: execution.id,
          agentId: agent.id,
          taskId: execution.taskId,
          kind: "diagnostic",
          title: "Runtime context Session binding rejected",
          detail: "Runtime context Session event did not match the active execution identity.",
          payload: {
            code: "runtime_context_session_bind_rejected",
            contextKey: execution.runtimeContextKey,
            sessionRecordId: execution.runtimeSessionRecordId,
            generation: execution.runtimeSessionGeneration
          }
        })
      : undefined;
    return { accepted: false, execution: observableRejection ? execution : undefined, event };
  }

  if (input.state === "ready") {
    const action = session.status === "ready" ? "resume" : "start";
    const ready = store.bindAgentRuntimeSession({
      serverId: session.serverId,
      agentId: session.agentId,
      machineId: session.machineId,
      runtime: session.runtime,
      contextKind: session.contextKind,
      contextId: session.contextId,
      contextKey: session.contextKey,
      sessionRecordId: session.id,
      generation: session.generation,
      runtimeSessionId: input.runtimeSessionId,
      executionId: execution.id,
      launchId: input.launchId
    });
    if (!ready) return { accepted: false };
    const boundExecution = store.bindRuntimeExecutionSession({
      executionId: execution.id,
      sessionRecordId: ready.id,
      contextKey: ready.contextKey,
      generation: ready.generation,
      runtimeSessionId: input.runtimeSessionId
    });
    if (!boundExecution) return { accepted: false };
    const event = store.appendRuntimeExecutionEvent({
      executionId: execution.id,
      agentId: agent.id,
      taskId: execution.taskId,
      kind: "diagnostic",
      title: action === "resume" ? "Runtime context resumed" : "Runtime context started",
      detail: action === "resume" ? "Runtime context Session resumed." : "Runtime context Session started.",
      payload: {
        code: action === "resume" ? "runtime_context_session_resumed" : "runtime_context_session_started",
        contextKey: ready.contextKey,
        sessionRecordId: ready.id,
        generation: ready.generation,
        action
      }
    });
    return { accepted: true, execution: boundExecution, event };
  }

  const failureInput = {
    serverId: session.serverId,
    agentId: session.agentId,
    machineId: session.machineId,
    runtime: session.runtime,
    contextKind: session.contextKind,
    contextId: session.contextId,
    contextKey: session.contextKey,
    sessionRecordId: session.id,
    generation: session.generation,
    error: input.reason,
    executionId: execution.id,
    launchId: input.launchId
  };
  const alreadyReplaced = store.listRuntimeExecutionEvents(execution.id)
    .some((event) => diagnosticCode(event) === "runtime_context_session_resume_failed");
  if (alreadyReplaced) {
    // 同一 execution 只允许一次自动换代；replacement 再失败必须收敛为终态，不能继续生成 generation。
    const failed = store.markAgentRuntimeSessionFailed(failureInput);
    if (!failed) return { accepted: false };
    const terminalExecution = store.updateRuntimeExecutionStatus(execution.id, "failed") ?? execution;
    const event = store.appendRuntimeExecutionEvent({
      executionId: execution.id,
      agentId: agent.id,
      taskId: execution.taskId,
      kind: "error",
      title: "Runtime context replacement failed",
      detail: "Runtime context replacement could not be started.",
      payload: {
        code: "runtime_context_session_replacement_failed",
        contextKey: failed.contextKey,
        sessionRecordId: failed.id,
        generation: failed.generation
      }
    });
    return { accepted: true, execution: terminalExecution, event };
  }

  const replacement = store.replaceAgentRuntimeSession(failureInput);
  if (!replacement) return { accepted: false };
  const reboundExecution = store.getRuntimeExecution(execution.id) ?? execution;
  const event = store.appendRuntimeExecutionEvent({
    executionId: execution.id,
    agentId: agent.id,
    taskId: execution.taskId,
    kind: "diagnostic",
    title: "Runtime context resume failed",
    detail: "Runtime context Session could not be resumed.",
    payload: {
      code: "runtime_context_session_resume_failed",
      contextKey: session.contextKey,
      sessionRecordId: session.id,
      generation: session.generation,
      replacementSessionRecordId: replacement.id,
      replacementGeneration: replacement.generation
    }
  });
  return {
    accepted: true,
    execution: reboundExecution,
    event,
    replacement: {
      type: "agent:context_session:replace",
      agentId: agent.id,
      executionId: execution.id,
      contextKey: session.contextKey,
      failedSessionRecordId: session.id,
      replacement: {
        sessionRecordId: replacement.id,
        generation: replacement.generation
      }
    }
  };
}
