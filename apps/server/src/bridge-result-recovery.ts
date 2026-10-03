import { createHash } from "node:crypto";
import type { TyrDb } from "@tyr-ai/db";
import { communicationWorkerOutcome } from "./communication-worker-outcome";
import { existingCommunicationNextStepReply } from "./communication-next-step-receipt";
import { workspaceBridgeRefForExecution } from "./workspace-bridge-delivery";
import { createCommunicationReturnMessageForFinalMessage } from "./taskRun";

export interface BridgeResultRecoveryTarget {
  executionId: string;
  agentId: string;
  expectedReturnMessageId: string;
  finalMessageId: string;
  finalContentSha256: string;
}

/** Explicit operator-selected recovery; never dispatches an Agent or a new Bridge request. */
export function inspectBridgeResultRecovery(store: TyrDb, target: BridgeResultRecoveryTarget) {
  const fail = (): never => { throw new Error("bridge_result_recovery_not_proven_safe"); };
  const execution = store.getRuntimeExecution(target.executionId);
  if (!execution || execution.agentId !== target.agentId || execution.status !== "completed" ||
      execution.communicationReturnMessageId !== target.expectedReturnMessageId) return fail();
  const ref = workspaceBridgeRefForExecution(execution);
  const request = ref ? store.getCrossWorkspaceMessage(ref.requestMessageId) : null;
  const bridge = request ? store.getWorkspaceBridgeForServer(request.bridgeId, request.targetWorkspaceId) : null;
  const prior = store.getMessage(target.expectedReturnMessageId);
  const final = store.findFinalMessageForExecution(execution.id);
  const source = execution.communicationReturnSourceMessageId ? store.getMessage(execution.communicationReturnSourceMessageId) : null;
  const worker = store.getAgent(execution.agentId);
  if (!ref || !request || !bridge || bridge.status !== "active" || !source || !worker || worker.deletedAt ||
      request.targetWorkspaceId !== execution.serverId || ref.targetWorkspaceId !== execution.serverId ||
      ref.bridgeId !== request.bridgeId || ref.conversationId !== request.conversationId ||
      request.peerMessageId !== source.id || source.channelId !== execution.communicationReturnChannelId ||
      source.conversationId !== request.conversationId || execution.communicationReturnConversationId !== request.conversationId ||
      request.targetCapabilityUserId !== execution.communicationReturnUserId ||
      !store.listServersForUser(execution.communicationReturnUserId!).some((s) => s.id === request.targetWorkspaceId && s.role === "owner") ||
      !request.senderUserId || !store.listServersForUser(request.senderUserId).some((s) => s.id === request.sourceWorkspaceId && s.role !== "guest") ||
      prior?.result?.status !== "partial" || prior.channelId !== source.channelId || prior.conversationId !== source.conversationId ||
      prior.senderId !== request.receiverCommsAgentId ||
      !final || final.id !== target.finalMessageId || final.senderId !== execution.agentId || final.deletedAt ||
      createHash("sha256").update(final.content).digest("hex") !== target.finalContentSha256 ||
      communicationWorkerOutcome(final.content).status !== "completed") return fail();
  const events = store.listRuntimeExecutionEvents(execution.id);
  const output = [...events].reverse().find((event) => event.kind === "assistant_output" &&
    event.detail?.trim() === final.content.trim() && (event.payload as { status?: string; truncated?: boolean } | undefined)?.status === "completed" &&
    (event.payload as { truncated?: boolean } | undefined)?.truncated !== true);
  const turn = output && events.find((event) => event.kind === "turn_completed" && event.sequence > output.sequence);
  const receipt = turn && events.find((event) => event.kind === "diagnostic" && event.title === "Final reply received" &&
    event.sequence > turn.sequence && (event.payload as { finalMessageId?: string } | undefined)?.finalMessageId === final.id);
  if (!output || !turn || !receipt || (final.sourceExecutionId && final.sourceExecutionId !== execution.id)) return fail();
  const ipc = store.db.prepare(`select id from communication_return_events where source_execution_id = ?
    and source_message_id = ? and reply_message_id = ? and state = 'completed' and kind in ('action_request', 'question')`).get(execution.id, source.id, prior.id);
  if (!ipc || existingCommunicationNextStepReply(store, execution) ||
      store.listCrossWorkspaceChildRequests(request.id).length || request.resolvedByTerminalId ||
      store.listCrossWorkspaceMessages(request.bridgeId, { conversationId: request.conversationId! }).some((m) =>
        m.replyToMessageId === request.id && (m.responseKind === "final" || m.responseKind === "error")) ||
      store.db.prepare("select id from runtime_executions where id != ? and communication_return_source_message_id = ? limit 1").get(execution.id, source.id) ||
      store.listRuntimeApprovals({ executionId: execution.id, limit: 1000 }).some((a) => a.status === "pending") ||
      store.db.prepare("select id from communication_return_events where source_execution_id = ? and state in ('pending', 'running', 'interrupted') limit 1").get(execution.id) ||
      store.db.prepare("select parent_request_id from bridge_route_intents where parent_request_id = ? and action_kind != 'none'").get(request.id)) return fail();
  return { execution, request, final, source, prior, worker };
}

export function commitBridgeResultRecovery(store: TyrDb, target: BridgeResultRecoveryTarget, input: {
  presentedContent: string; operatorId: string; operationId: string; reason: string; reference: string;
}) {
  return store.db.transaction(() => {
    // Recheck all receipts after asynchronous presentation; another callback may have won.
    const checked = inspectBridgeResultRecovery(store, target);
    const changed = store.db.prepare(`update runtime_executions set communication_return_message_id = null,
      communication_return_dispatched_at = null where id = ? and communication_return_message_id = ?`)
      .run(target.executionId, target.expectedReturnMessageId).changes;
    if (changed !== 1) throw new Error("bridge_result_recovery_conflict");
    const returned = createCommunicationReturnMessageForFinalMessage(store, {
      completedExecution: checked.execution, finalMessage: checked.final
    }, { presentedContent: input.presentedContent });
    if (!returned?.bridgeMessage || returned.bridgeMessage.responseKind !== "final") throw new Error("bridge_result_recovery_no_terminal");
    store.recordAuditEvent({ kind: "workspace_bridge_result_recovered", actorType: "system", actorId: `platform:${input.operatorId}`,
      resourceType: "workspace_bridge", resourceId: checked.request.bridgeId, serverId: checked.execution.serverId,
      metadata: { operationId: input.operationId, reason: input.reason, reference: input.reference,
        requestId: checked.request.id, executionId: target.executionId, traceId: checked.request.traceId ?? null, previousReplyId: checked.prior.id,
        finalMessageId: checked.final.id, recoveredReplyId: returned.message.id, terminalId: returned.bridgeMessage.id } });
    return returned;
  })();
}
