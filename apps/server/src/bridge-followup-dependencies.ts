import type { TyrDb } from "@tyr-ai/db";
import type { RuntimeExecutionRecord } from "@tyr-ai/contracts";
import { verifiedCommunicationNextStepReceipts } from "./communication-next-step-receipt";
import { workspaceBridgeRefForExecution } from "./workspace-bridge-delivery";

type Store = Pick<TyrDb, "db" | "getCrossWorkspaceMessage" | "getMessage">;
type ExecutionDependencyStore = Store & Pick<TyrDb, "ensureDefaultCommunicationAgent" |
  "getRuntimeExecution" | "listRuntimeExecutionEvents">;

/** Bind an answer to its sole published worker question before delivery. Ambiguity stays open.
 * Explicit historical recovery may call this without dispatching work. No time/Agent-based replacement.
 */
export function recordBridgeFollowupDependency(store: Store, eventId: string): void {
  const answer = store.getCrossWorkspaceMessage(eventId);
  const request = answer?.replyToMessageId ? store.getCrossWorkspaceMessage(answer.replyToMessageId) : null;
  if (!answer || answer.responseKind !== "answer" || !request || answer.bridgeId !== request.bridgeId ||
      answer.sourceWorkspaceId !== request.sourceWorkspaceId || answer.targetWorkspaceId !== request.targetWorkspaceId) return;
  const candidates = store.db.prepare(`select q.id as questionId, e.id as executionId
    from cross_workspace_messages q
    join runtime_executions e on e.communication_return_message_id = q.local_message_id
    join messages m on m.id = q.local_message_id
    where q.reply_to_message_id = ? and q.response_kind = 'question'
      and q.bridge_id = ? and q.conversation_id = ? and q.created_at <= ?
      and q.source_workspace_id = ? and q.target_workspace_id = ?
      and e.server_id = ? and e.communication_return_conversation_id = ?
      and json_valid(e.communication_return_external_ref)
      and json_extract(e.communication_return_external_ref, '$.requestMessageId') = ?
      and json_valid(m.result_payload) and json_extract(m.result_payload, '$.status') = 'partial'
      and m.sender_id = ? and m.channel_id = e.communication_return_channel_id
      and not exists (
        select 1 from bridge_followup_dependencies d
        join cross_workspace_messages a on a.id = d.answer_event_id
        join runtime_executions successor on successor.communication_return_source_message_id = a.peer_message_id
        where d.prior_execution_id = e.id and a.id != ? and successor.server_id = e.server_id
          and json_valid(successor.communication_return_external_ref)
          and json_extract(successor.communication_return_external_ref, '$.requestMessageId') = ?
      )`).all(request.id, request.bridgeId, request.conversationId, answer.createdAt,
        request.targetWorkspaceId, request.sourceWorkspaceId, request.targetWorkspaceId, request.conversationId,
        request.id, request.receiverCommsAgentId, answer.id, request.id) as Array<{ questionId: string; executionId: string }>;
  if (new Set(candidates.map((c) => c.executionId)).size !== 1) return;
  const candidate = candidates[0]!;
  store.db.prepare(`insert or ignore into bridge_followup_dependencies
    (answer_event_id, request_id, question_event_id, prior_execution_id, created_at) values (?, ?, ?, ?, ?)`)
    .run(answer.id, request.id, candidate.questionId, candidate.executionId, new Date().toISOString());
}

/** Only persisted answer successors or verified local dispatch receipts replace a prior step. */
export function supersededBridgeExecutionIds(store: ExecutionDependencyStore, requestId: string, executions: RuntimeExecutionRecord[]): Set<string> {
  const request = store.getCrossWorkspaceMessage(requestId);
  if (!request) return new Set();
  const rows = store.db.prepare(`select d.prior_execution_id as priorId, q.local_message_id as priorReplyId,
      a.peer_message_id as answerMessageId
    from bridge_followup_dependencies d
    join cross_workspace_messages a on a.id = d.answer_event_id
    join cross_workspace_messages q on q.id = d.question_event_id
    where d.request_id = ? and a.reply_to_message_id = d.request_id and q.reply_to_message_id = d.request_id
      and a.response_kind = 'answer' and q.response_kind = 'question'
      and a.bridge_id = ? and q.bridge_id = ? and a.conversation_id = ? and q.conversation_id = ?
      and a.source_workspace_id = ? and a.target_workspace_id = ?
      and q.source_workspace_id = ? and q.target_workspace_id = ? and a.outcome = 'delivered'`)
    .all(requestId, request.bridgeId, request.bridgeId, request.conversationId, request.conversationId,
      request.sourceWorkspaceId, request.targetWorkspaceId, request.targetWorkspaceId, request.sourceWorkspaceId) as Array<{
        priorId: string; priorReplyId: string; answerMessageId: string;
      }>;
  const superseded = new Set(rows.filter((row) => {
    const prior = executions.find((e) => e.id === row.priorId);
    const source = row.answerMessageId ? store.getMessage(row.answerMessageId) : null;
    return prior?.communicationReturnMessageId === row.priorReplyId && source?.senderType === "system" &&
      source.channelId === prior.communicationReturnChannelId && source.conversationId === request.conversationId &&
      executions.some((successor) => successor.id !== prior.id && successor.serverId === request.targetWorkspaceId &&
        successor.communicationReturnSourceMessageId === source.id &&
        successor.communicationReturnChannelId === prior.communicationReturnChannelId &&
        successor.communicationReturnConversationId === request.conversationId &&
        successor.communicationReturnUserId === request.targetCapabilityUserId);
  }).map((row) => row.priorId));

  // IPC review and delegation may save distinct ACK/root messages. Their IDs need
  // not match; the server receipt binds the actual successor to the reviewed step.
  const scoped = new Map(executions.filter((execution) => {
    const ref = workspaceBridgeRefForExecution(execution);
    return ref?.requestMessageId === request.id && ref.bridgeId === request.bridgeId &&
      ref.conversationId === request.conversationId && ref.sourceWorkspaceId === request.sourceWorkspaceId &&
      ref.targetWorkspaceId === request.targetWorkspaceId && execution.serverId === request.targetWorkspaceId &&
      execution.communicationReturnUserId === request.targetCapabilityUserId;
  }).map((execution) => [execution.id, execution]));
  const successors = new Map<string, Set<string>>();
  for (const execution of scoped.values()) {
    if (execution.status !== "completed" || !execution.communicationReturnMessageId) continue;
    for (const receipt of verifiedCommunicationNextStepReceipts(store, execution)) {
      // Cross-Bridge handoffs retain their existing continuation/review path. This
      // only resolves local chains whose successors participate in this aggregate.
      if (receipt.reviewedReplyId !== execution.communicationReturnMessageId || receipt.bridgeRequestIds.length ||
          !receipt.executionIds.length || receipt.executionIds.some((id) => !scoped.has(id))) continue;
      const ids = successors.get(execution.id) ?? new Set<string>();
      for (const id of receipt.executionIds) ids.add(id);
      successors.set(execution.id, ids);
    }
  }
  const reachesLeaves = (id: string, path: Set<string>): boolean => {
    if (path.has(id)) return false;
    const next = successors.get(id);
    if (!next) return true;
    const visited = new Set(path).add(id);
    return [...next].every((successor) => reachesLeaves(successor, visited));
  };
  for (const id of successors.keys()) {
    if (reachesLeaves(id, new Set())) superseded.add(id);
  }
  return superseded;
}
