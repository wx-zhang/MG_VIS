import type { MessageRecord, MessageResult, RuntimeExecutionRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import { continueCommunicationAgentRequest } from "./communication-agent";
import type { CommunicationReturnEvent } from "./communication-return-ipc";
import { selectCommunicationEvidenceForContext } from "./communication-evidence";
import { existingCommunicationNextStepReply, recordCommunicationNextStepReceipt } from "./communication-next-step-receipt";
import type { ServerRouteContext } from "./server-context";
import { publishWorkspaceBridgeWorkerEvent, workspaceBridgeRefForExecution } from "./workspace-bridge-delivery";

type PublishedWorkerQuestion = { eventId: string; replyId: string; questionId: string; workerContent: string; reviewedContent: string };

/** Identity comes exclusively from persisted local review and publication receipts. */
function publishedWorkerQuestion(store: TyrDb, execution: RuntimeExecutionRecord): PublishedWorkerQuestion | null {
  const current = store.getRuntimeExecution(execution.id);
  const ref = current ? workspaceBridgeRefForExecution(current) : null;
  const request = ref ? store.getCrossWorkspaceMessage(ref.requestMessageId) : null;
  if (!current || current.status !== "completed" || current.communicationReturnMessageId ||
      !ref || !request || request.bridgeId !== ref.bridgeId || request.conversationId !== ref.conversationId ||
      request.targetWorkspaceId !== current.serverId || current.communicationReturnUserId !== request.targetCapabilityUserId ||
      execution.communicationReturnUserId !== current.communicationReturnUserId) return null;
  const event = store.db.prepare(`select id, kind, state, reply_message_id, content from communication_return_events
    where source_execution_id = ? and source_message_id = ? order by rowid desc limit 1`)
    .get(current.id, current.communicationReturnSourceMessageId) as {
      id: string; kind: string; state: string; reply_message_id: string | null; content: string;
    } | undefined;
  if (event?.kind !== "question" || event.state !== "completed" || !event.reply_message_id) return null;
  const reply = store.getMessage(event.reply_message_id);
  if (!reply || reply.result?.status !== "partial" || reply.senderId !== request.receiverCommsAgentId ||
      reply.channelId !== current.communicationReturnChannelId || reply.conversationId !== current.communicationReturnConversationId) return null;
  const question = store.db.prepare(`select id, rowid from cross_workspace_messages
    where reply_to_message_id = ? and interaction_event_id = ? and response_kind = 'question'
      and local_message_id = ? and outcome = 'delivered' and bridge_id = ? and conversation_id = ?
      and source_workspace_id = ? and target_workspace_id = ?`)
    .get(request.id, event.id, reply.id, request.bridgeId, request.conversationId,
      request.targetWorkspaceId, request.sourceWorkspaceId) as { id: string; rowid: number } | undefined;
  if (!question) return null;
  // A concurrent answer or terminal takes precedence over acknowledging the old question.
  if (store.db.prepare(`select 1 from cross_workspace_messages where reply_to_message_id = ?
    and rowid > ? and response_kind in ('answer', 'instruction', 'continue', 'final', 'error') limit 1`)
    .get(request.id, question.rowid)) return null;
  return { eventId: event.id, replyId: reply.id, questionId: question.id,
    workerContent: event.content, reviewedContent: reply.content };
}

export function acknowledgePublishedBridgeWorkerQuestion(store: TyrDb, execution: RuntimeExecutionRecord,
  reviewedContent: string): RuntimeExecutionRecord | null {
  return store.db.transaction(() => {
    const prior = publishedWorkerQuestion(store, execution);
    if (!prior || prior.reviewedContent.trim() !== reviewedContent.trim()) return null;
    return store.markRuntimeExecutionCommunicationReturnDispatched(execution.id, { communicationReturnMessageId: prior.replyId });
  })();
}

/** Semantics are reviewed locally; the server rechecks all receipts after the await.
 * False/uncertain reviews use the ordinary continuation so no new requirement is lost.
 */
export async function acknowledgeRepeatedBridgeWorkerQuestion(store: TyrDb, execution: RuntimeExecutionRecord,
  review: (prior: { workerContent: string; reviewedContent: string }) => Promise<boolean>): Promise<RuntimeExecutionRecord | null> {
  const prior = publishedWorkerQuestion(store, execution);
  if (!prior) return null;
  let equivalent = false;
  try { equivalent = await review(prior); } catch { return null; }
  if (!equivalent) return null;
  return store.db.transaction(() => {
    const current = publishedWorkerQuestion(store, execution);
    if (!current || JSON.stringify(current) !== JSON.stringify(prior)) return null;
    return store.markRuntimeExecutionCommunicationReturnDispatched(execution.id, { communicationReturnMessageId: prior.replyId });
  })();
}

/** Actionable IPC is reviewed locally under reconstructed authority, before any peer publication. */
export async function reviewInboundBridgeWorkerEvent(ctx: ServerRouteContext, input: {
  execution: RuntimeExecutionRecord;
  event: CommunicationReturnEvent;
  safeContent: string;
  sourceAgentName: string;
}): Promise<MessageRecord | null> {
  const { event } = input;
  const execution = ctx.store.getRuntimeExecution(input.execution.id);
  if (!execution) return null;
  if (!workspaceBridgeRefForExecution(execution) ||
      (event.kind !== "question" && event.kind !== "action_request") ||
      execution.id !== event.sourceExecutionId ||
      execution.communicationReturnSourceMessageId !== event.sourceMessageId ||
      !execution.communicationReturnChannelId) return null;
  const priorReply = existingCommunicationNextStepReply(ctx.store, execution);
  if (priorReply) {
    // Facts in a late event are already recorded under the original request. The
    // next child result can consume them; they do not authorize replaying this action.
    for (const requestId of ctx.store.armCrossWorkspaceContinuationsForSourceMessage(event.sourceMessageId)) {
      ctx.scheduleAssistantBridgeContinuation?.(requestId);
    }
    return priorReply;
  }
  const draft = await continueCommunicationAgentRequest(ctx, {
    execution, workerResult: input.safeContent, sourceAgentName: input.sourceAgentName,
    ipcEvent: { id: event.id, kind: event.kind }
  });
  const hasNextStep = Boolean(draft?.executionIds?.length || draft?.bridgeRequestIds?.length);
  const content = draft?.content ?? "TYR could not verify the next action. The original request remains open; no further action was confirmed.";
  const assistant = ctx.store.ensureDefaultCommunicationAgent(execution.serverId ?? "local");
  const result: MessageResult = {
    ...draft?.result, version: 1, status: "partial",
    title: hasNextStep ? "TYR is continuing the request" : "TYR request needs attention",
    summary: content, body: content,
    communicationRequest: { sourceMessageId: event.sourceMessageId }
  };
  if (draft?.evidenceSelections?.length) result.evidence = selectCommunicationEvidenceForContext(ctx.store, {
    serverId: execution.serverId ?? "local", sourceMessageId: event.sourceMessageId,
    channelId: execution.communicationReturnChannelId,
    conversationId: execution.communicationReturnConversationId ?? null
  }, draft.evidenceSelections);
  const reply = ctx.store.sendMessage({
    target: execution.communicationReturnChannelId,
    ...(execution.communicationReturnConversationId ? {
      conversationId: execution.communicationReturnConversationId, allowClosedConversation: true
    } : {}),
    content, result, senderType: "agent", senderId: assistant.id,
    senderName: assistant.displayName, serverId: execution.serverId ?? assistant.serverId ?? "local"
  }).message;
  if (draft?.pendingActionId) ctx.store.attachCommunicationAgentPendingActionSuggestionMessage(draft.pendingActionId, reply.id);
  ctx.emitRealtimeMessage(reply);
  // A durable next-step receipt acknowledges this worker; final output must not repeat its action.
  // An unfulfilled action remains a reviewed, nonterminal interaction on the original request.
  if (hasNextStep) {
    const updated = ctx.store.db.transaction(() => {
      const recorded = recordCommunicationNextStepReceipt(ctx.store, execution, {
        reviewedReplyId: reply.id, executionIds: draft?.executionIds, bridgeRequestIds: draft?.bridgeRequestIds
      });
      if (!recorded) throw new Error("communication_next_step_receipt_not_verified");
      return ctx.store.markRuntimeExecutionCommunicationReturnDispatched(execution.id, { communicationReturnMessageId: reply.id });
    })();
    if (updated) ctx.broadcastRealtime("runtime_execution:updated", { execution: updated }, { serverId: updated.serverId });
  }
  const interaction = publishWorkspaceBridgeWorkerEvent(ctx, {
    execution, eventId: event.id, kind: hasNextStep ? "progress" : event.kind,
    reviewedReply: reply, evidenceSelections: draft?.evidenceSelections
  });
  if (!interaction) throw new Error("bridge_reviewed_worker_event_not_recorded");
  // A child may finish while the model is still running; only the durable local reply arms it.
  for (const requestId of ctx.store.armCrossWorkspaceContinuationsForSourceMessage(event.sourceMessageId)) {
    ctx.scheduleAssistantBridgeContinuation?.(requestId);
  }
  return reply;
}

/** Drain persisted worker actions before final output can claim the execution's return. */
export function pendingActionableWorkerEventIds(ctx: Pick<ServerRouteContext, "store">, executionId: string): string[] {
  return (ctx.store.db.prepare(`select id from communication_return_events
    where source_execution_id = ? and state = 'pending' and kind in ('question', 'action_request')
    order by created_at, id`).all(executionId) as Array<{ id: string }>).map((row) => row.id);
}
