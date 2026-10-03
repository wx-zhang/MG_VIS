import type { CrossWorkspaceMessageRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import { getCommunicationReturnEvent } from "./communication-return-ipc";

/** A business worker can report a server-issued source request, but never a destination TYR. */
export interface CommunicationOriginRoute {
  originRequestId: string;
  bridgeId: string;
  sourceWorkspaceId: string;
  peerWorkspaceName: string;
}

export interface VerifiedCommunicationOriginAction extends CommunicationOriginRoute {
  eventId: string;
  peerMessage: string;
}

export function resolveCommunicationOriginRoute(store: TyrDb, input: {
  serverId: string;
  requestingUserId: string;
  sourceMessageId: string;
  originRequestId: string;
}): CommunicationOriginRoute | null {
  const ownerRequest = store.getMessage(input.sourceMessageId);
  const ownerChannel = ownerRequest ? store.resolveTarget(ownerRequest.channelId, input.serverId) : null;
  if (!ownerRequest || ownerRequest.senderType !== "human" || ownerRequest.senderId !== input.requestingUserId ||
      ownerRequest.channelType !== "dm" || ownerChannel?.serverId !== input.serverId ||
      ownerChannel.dmIdentity?.kind !== "human_agent" ||
      ownerChannel.dmIdentity.humanUserId !== input.requestingUserId) return null;
  const member = store.listServersForUser(input.requestingUserId)
    .find((server) => server.id === input.serverId);
  if (!member || member.role === "guest") return null;

  const origin = store.getCrossWorkspaceMessage(input.originRequestId);
  if (!origin || origin.id !== input.originRequestId || origin.responseKind || origin.replyToMessageId ||
      origin.initiatedBy !== "human" || origin.targetWorkspaceId !== input.serverId ||
      origin.sourceWorkspaceId === input.serverId || origin.createdAt > ownerRequest.createdAt) return null;
  // A still-open request has its own return channel. A later owner request needs a new, traceable notice.
  const terminal = origin.conversationId && store.listCrossWorkspaceMessages(origin.bridgeId, {
    conversationId: origin.conversationId
  }).some((message) => message.terminalRequestId === origin.id &&
    (message.responseKind === "final" || message.responseKind === "error"));
  if (!terminal) return null;

  const routes = store.listWorkspaceBridges(input.serverId).filter((bridge) =>
    bridge.status === "active" && bridge.permissions.includes("chat") &&
    bridge.peerWorkspace?.id === origin.sourceWorkspaceId &&
    (bridge.direction === "bidirectional" || bridge.workspaceAId === input.serverId)
  );
  const selected = routes.find((bridge) => bridge.id === origin.bridgeId) ??
    (routes.length === 1 ? routes[0] : null);
  if (!selected?.peerWorkspace) return null;
  return {
    originRequestId: origin.id,
    bridgeId: selected.id,
    sourceWorkspaceId: origin.sourceWorkspaceId,
    peerWorkspaceName: selected.peerWorkspace.name
  };
}

export function verifiedCommunicationOriginAction(store: TyrDb, input: {
  eventId: string;
  serverId: string;
  requestingUserId: string;
  sourceMessageId: string;
}): VerifiedCommunicationOriginAction | null {
  const event = getCommunicationReturnEvent(store, input.eventId);
  if (!event || event.kind !== "action_request" || !event.originRequestId || !event.peerMessage ||
      event.sourceMessageId !== input.sourceMessageId || event.proposedBridgeId) return null;
  const execution = store.getRuntimeExecution(event.sourceExecutionId);
  if (!execution || execution.serverId !== input.serverId ||
      execution.communicationReturnSourceMessageId !== input.sourceMessageId ||
      execution.communicationReturnUserId !== input.requestingUserId) return null;
  const route = resolveCommunicationOriginRoute(store, {
    serverId: input.serverId,
    requestingUserId: input.requestingUserId,
    sourceMessageId: input.sourceMessageId,
    originRequestId: event.originRequestId
  });
  return route ? { ...route, eventId: event.id, peerMessage: event.peerMessage } : null;
}

/** Identify an already sent notice from its durable worker IPC and the exact outbound request. */
export function verifiedCommunicationOriginNoticeRequest(
  store: TyrDb,
  request: CrossWorkspaceMessageRecord
): VerifiedCommunicationOriginAction | null {
  if (request.responseKind || request.replyToMessageId || request.initiatedBy !== "human" ||
      !request.originMessageId || !request.sourceCapabilityUserId) return null;
  const rows = store.db.prepare(`select id from communication_return_events
    where source_message_id = ? and kind = 'action_request' and peer_message = ?
      and created_at <= ? order by created_at desc limit 32`
  ).all(request.originMessageId, request.content, request.createdAt) as Array<{ id: string }>;
  for (const row of rows) {
    const action = verifiedCommunicationOriginAction(store, {
      eventId: row.id,
      serverId: request.sourceWorkspaceId,
      requestingUserId: request.sourceCapabilityUserId,
      sourceMessageId: request.originMessageId
    });
    if (action?.bridgeId === request.bridgeId && action.sourceWorkspaceId === request.targetWorkspaceId) {
      return action;
    }
  }
  return null;
}
