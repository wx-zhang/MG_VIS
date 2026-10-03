import { isCommunicationAgent, type RuntimeExecutionEventRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import type { AssistantLlmContext } from "./assistant-llm";
import { allowedWorkerWorkspacePaths } from "./assistant-workspace-path-disclosure";
import { buildCompletedCommunicationResult } from "./communication-result";
import { communicationReturnFinalContent } from "./taskRun";
import { communicationWorkerOutcome } from "./communication-worker-outcome";

type CompletedWorkerResultStore = TyrDb;

function receivedFinalMessageId(event: RuntimeExecutionEventRecord): string | null {
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown> : null;
  if (typeof payload?.finalMessageId !== "string" || !payload.finalMessageId.trim()) return null;
  // These receipts are written by the server's final-message callback/recovery paths.
  // A daemon progress/tool event containing a similarly named field is not a final receipt.
  const received = event.kind === "diagnostic" && event.title === "Final reply received";
  const recovered = event.kind === "diagnostic" && event.title === "Final reply recovered" &&
    payload.recoveredFromRuntimeAssistantOutput === true && payload.workspaceBridgeFinalReplyRecovery === true;
  const finalMessageRecovery = payload.recoveredFromFinalMessage === true &&
    (event.kind === "turn_completed" || event.kind === "assistant_output" && payload.status === "completed");
  return received || recovered || finalMessageRecovery ? payload.finalMessageId : null;
}

/** Restore only local, completed worker facts bound to the exact original TYR request. */
export function recoverCompletedWorkerResults(store: CompletedWorkerResultStore, input: {
  serverId: string;
  userId: string;
  sourceMessageId: string;
  channelId: string;
  conversationId: string;
  assistantAgentId: string;
}): { results: NonNullable<AssistantLlmContext["completedWorkerResults"]>; allowedWorkspacePaths: string[] } {
  const empty = { results: [], allowedWorkspacePaths: [] };
  const source = store.getMessage(input.sourceMessageId);
  const original = store.db.prepare(
    `select messages.id from messages join channels on channels.id = messages.channel_id
     where messages.id = ? and messages.channel_id = ? and messages.conversation_id = ? and channels.server_id = ?`
  ).get(input.sourceMessageId, input.channelId, input.conversationId, input.serverId);
  if (!source || !original) return empty;

  // Query this request directly: a workspace-wide recent-execution limit can omit an older
  // completed worker when unrelated turns have since produced more than 1,000 executions.
  const rows = store.db.prepare(
    `select id from runtime_executions where server_id = ? and status = 'completed'
       and communication_return_source_message_id = ? and communication_return_user_id = ?
       and communication_return_channel_id = ? and communication_return_conversation_id = ?
     order by created_at, id`
  ).all(input.serverId, input.sourceMessageId, input.userId, input.channelId, input.conversationId) as Array<{ id: string }>;
  const results: NonNullable<AssistantLlmContext["completedWorkerResults"]> = [];
  const workspacePaths = new Set<string>();
  for (const row of rows) {
    const execution = store.getRuntimeExecution(row.id);
    const worker = execution ? store.getAgent(execution.agentId) : null;
    const handoff = execution ? store.getMessage(execution.messageId) : null;
    const handoffChannel = handoff?.channelName
      ? store.getChannelByName(handoff.channelName, "dm", input.serverId) : null;
    const pair = handoffChannel?.dmIdentity;
    if (!execution || !worker || worker.serverId !== input.serverId || isCommunicationAgent(worker) ||
        !handoff || handoff.senderType !== "agent" || handoff.senderId !== input.assistantAgentId ||
        !handoff.conversationId || handoffChannel?.id !== handoff.channelId || pair?.kind !== "agent_pair" ||
        !pair.agentIds.includes(input.assistantAgentId) || !pair.agentIds.includes(worker.id)) continue;

    const events = store.listRuntimeExecutionEvents(execution.id);
    const finalReceipt = [...events].reverse().find((event) =>
      event.executionId === execution.id && event.agentId === worker.id && receivedFinalMessageId(event));
    const finalId = finalReceipt ? receivedFinalMessageId(finalReceipt) : null;
    const finalMessage = finalId ? store.getMessage(finalId) : null;
    if (!finalMessage || finalMessage.senderType !== "agent" || finalMessage.senderId !== worker.id ||
        finalMessage.channelId !== handoff.channelId ||
        finalMessage.seq <= handoff.seq ||
        finalMessage.sourceExecutionId && finalMessage.sourceExecutionId !== execution.id) continue;

    const finalContent = communicationReturnFinalContent(store, execution.id, finalMessage).trim();
    if (!finalContent) continue;
    let verifiedContent = finalContent;
    if (finalMessage.sourceExecutionId) {
      if (finalMessage.conversationId !== handoff.conversationId) continue;
    } else {
      // Older daemon final callbacks can post to the pair's current conversation instead
      // of the execution conversation. Its message alone cannot establish turn ownership.
      const prefix = `assistant:${execution.id}:segment_`;
      const completedBlock = [...events].reverse().find((event) => {
        const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
          ? event.payload as Record<string, unknown> : null;
        const blockId = typeof payload?.assistantBlockId === "string" ? payload.assistantBlockId : "";
        return event.executionId === execution.id && event.agentId === worker.id &&
          event.kind === "assistant_output" && payload?.status === "completed" && payload.truncated !== true &&
          blockId.startsWith(prefix) && /^[1-9][0-9]*$/.test(blockId.slice(prefix.length));
      });
      const blockContent = completedBlock?.detail?.trim();
      const completedTurn = completedBlock && finalReceipt && events.some((event) =>
        event.executionId === execution.id && event.agentId === worker.id && event.kind === "turn_completed" &&
        event.sequence > completedBlock.sequence && event.sequence < finalReceipt.sequence);
      if (!blockContent || !completedTurn || finalContent !== blockContent ||
          finalMessage.content.trim() !== blockContent) continue;
      if (finalMessage.conversationId !== handoff.conversationId &&
          execution.runtimeContextKey !== `conversation:${handoff.conversationId}`) continue;
      verifiedContent = blockContent;
    }
    // Runtime completion authenticates the receipt, not the business outcome. Keep the
    // worker's explicit protocol state before presentation redacts or truncates its text.
    const outcome = communicationWorkerOutcome(verifiedContent);
    const result = buildCompletedCommunicationResult(worker, verifiedContent);
    const content = result.body?.trim() || result.summary.trim();
    if (!content) continue;
    results.push({ sourceAgentName: worker.displayName || worker.name, status: outcome.status, result: content,
      ...(outcome.needsInformation ? { needsInformation: true } : {}) });
    for (const workspacePath of allowedWorkerWorkspacePaths({
      sourceContent: source.content, workerResult: content, agent: worker,
      executionAgentId: execution.agentId, executionStatus: execution.status
    })) workspacePaths.add(workspacePath);
  }
  return { results, allowedWorkspacePaths: [...workspacePaths] };
}
