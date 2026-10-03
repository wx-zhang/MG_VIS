import type { CrossWorkspaceMessageRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import { listBridgeContinuationAttempts, listBridgeContinuationSteps } from "./bridge-continuation-journal";
import { workspaceBridgeRefForExecution } from "./workspace-bridge-delivery";

export interface VisibleBridgeTraceHop {
  requestId: string;
  traceId: string;
  rootRequestId: string | null;
  parentRequestId: string | null;
  bridgeId: string;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  peerWorkspaceName: string;
  requestingUserId: string | null;
  requestingUserName: string | null;
  localCapabilityUserId: string | null;
  outcome: CrossWorkspaceMessageRecord["outcome"];
  continuationState: CrossWorkspaceMessageRecord["continuationState"];
  terminal: { id: string; kind: "final" | "error"; outcome: CrossWorkspaceMessageRecord["outcome"] } | null;
  interactions: Array<{ id: string; kind: string; direction: "outbound" | "inbound"; continuationState: CrossWorkspaceMessageRecord["continuationState"] }>;
  localExecutionIds: string[];
  localToolReceipts: Array<{
    attemptId: string;
    sequence: number;
    toolName: string;
    idempotencyKey: string;
    state: string;
    bridgeRequestIds: string[];
    executionIds: string[];
  }>;
  publicReplyMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

function requestRoot(store: TyrDb, request: CrossWorkspaceMessageRecord): CrossWorkspaceMessageRecord {
  let current = request;
  const visited = new Set<string>([current.id]);
  while (current.parentBridgeRequestId && !visited.has(current.parentBridgeRequestId)) {
    const parent = store.getCrossWorkspaceMessage(current.parentBridgeRequestId);
    if (!parent) break;
    visited.add(parent.id);
    current = parent;
  }
  return current;
}

/** Returns only hops on a Bridge directly attached to the requesting Workspace. */
export function visibleBridgeTrace(store: TyrDb, workspaceId: string, traceId: string): VisibleBridgeTraceHop[] {
  if (!traceId.trim()) return [];
  const ids = (store.db.prepare(`select id from cross_workspace_messages
    where trace_id = ? and response_kind is null and (source_workspace_id = ? or target_workspace_id = ?)
    order by created_at, id limit 100`).all(traceId, workspaceId, workspaceId) as Array<{ id: string }>).map((row) => row.id);
  const requests = ids.map((id) => store.getCrossWorkspaceMessage(id))
    .filter((request): request is CrossWorkspaceMessageRecord => Boolean(request));
  const visibleIds = new Set(requests.map((request) => request.id));
  const localExecutions = store.listRuntimeExecutions({ serverId: workspaceId, limit: 1000 });
  return requests.flatMap((request) => {
    const bridge = store.getWorkspaceBridgeForServer(request.bridgeId, workspaceId);
    if (!bridge) return [];
    const root = requestRoot(store, request);
    const terminal = (store.db.prepare(`select id from cross_workspace_messages
      where terminal_request_id = ? and response_kind in ('final', 'error') limit 1`)
      .get(request.id) as { id: string } | undefined)?.id;
    const terminalRecord = terminal ? store.getCrossWorkspaceMessage(terminal) : null;
    const interactions = store.listCrossWorkspaceMessages(request.bridgeId, { conversationId: request.conversationId ?? undefined })
      .filter((message) => message.replyToMessageId === request.id && Boolean(message.interactionEventId))
      .map((message) => ({
        id: message.id, kind: message.responseKind ?? "unknown",
        direction: (message.sourceWorkspaceId === workspaceId ? "outbound" : "inbound") as "outbound" | "inbound",
        continuationState: message.continuationState
      }));
    const localReplyId = request.sourceWorkspaceId === workspaceId
      ? request.continuationReplyMessageId ?? terminalRecord?.originMessageId ?? null
      : null;
    const localReply = localReplyId ? store.getMessage(localReplyId) : null;
    const publicReplyMessageId = localReply && store.resolveTarget(localReply.channelId)?.serverId === workspaceId
      ? localReply.id : null;
    const attempts = request.sourceWorkspaceId === workspaceId
      ? listBridgeContinuationAttempts(store, request.id) : [];
    const localToolReceipts = attempts.flatMap((attempt) => listBridgeContinuationSteps(store, attempt.id).map((step) => ({
      attemptId: attempt.id,
      sequence: step.sequence,
      toolName: step.toolName,
      idempotencyKey: step.idempotencyKey,
      state: step.state,
      bridgeRequestIds: step.receipt?.bridgeRequestIds ?? [],
      executionIds: step.receipt?.executionIds ?? []
    })));
    const localExecutionIds = localExecutions.filter((execution) =>
      workspaceBridgeRefForExecution(execution)?.requestMessageId === request.id
    ).map((execution) => execution.id);
    const requesterLocal = Boolean(request.senderUserId &&
      store.listServersForUser(request.senderUserId).some((server) => server.id === workspaceId));
    return [{
      requestId: request.id,
      traceId,
      rootRequestId: visibleIds.has(root.id) ? root.id : null,
      parentRequestId: request.parentBridgeRequestId && visibleIds.has(request.parentBridgeRequestId)
        ? request.parentBridgeRequestId : null,
      bridgeId: request.bridgeId,
      sourceWorkspaceId: request.sourceWorkspaceId,
      targetWorkspaceId: request.targetWorkspaceId,
      peerWorkspaceName: bridge.peerWorkspace?.name ?? "Connected workspace",
      requestingUserId: requesterLocal ? request.senderUserId ?? null : null,
      requestingUserName: request.senderUserDisplayName ?? request.senderUserName ?? null,
      localCapabilityUserId: request.sourceWorkspaceId === workspaceId
        ? request.sourceCapabilityUserId ?? null : request.targetCapabilityUserId ?? null,
      outcome: request.outcome,
      continuationState: request.continuationState,
      terminal: terminalRecord && (terminalRecord.responseKind === "final" || terminalRecord.responseKind === "error")
        ? { id: terminalRecord.id, kind: terminalRecord.responseKind, outcome: terminalRecord.outcome } : null,
      interactions,
      localExecutionIds,
      localToolReceipts,
      publicReplyMessageId,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt ?? request.createdAt
    }];
  });
}
