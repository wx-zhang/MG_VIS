import { bridgeRouteClarifications } from "./bridge-route-clarifications";
import { createHash } from "node:crypto";
import type { CrossWorkspaceMessageRecord, MessageRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import {
  routeIntentAuthorityForPlan, routePlanningBridges, routePlanningLocalAgents, routePlanningWorkspaceName, storedRouteIntentAuthority,
  trustedLocalRouteSource, validateRoutePlanProposal,
  type CommunicationRouteIntent, type RoutePlanProposal, type RoutePlanningContext
} from "./communication-route-intent";

export interface BridgeRouteIntent extends Omit<CommunicationRouteIntent, "sourceMessageId" | "conversationId" | "requestingUserId"> {
  revision?: number;
  parentRequestId: string;
  rootMessageId: string | null;
  traceId: string | null;
  requestingUserId: string | null;
}

function rowIntent(row: Record<string, unknown>): BridgeRouteIntent {
  return {
    parentRequestId: String(row.parent_request_id), rootMessageId: row.root_message_id ? String(row.root_message_id) : null,
    serverId: String(row.server_id), requestingUserId: row.requesting_user_id ? String(row.requesting_user_id) : null,
    traceId: row.trace_id ? String(row.trace_id) : null,
    ...storedRouteIntentAuthority(row),
    requestHash: String(row.request_hash), routingRevision: Number(row.routing_revision), createdAt: String(row.created_at)
  };
}

export function getBridgeRouteIntent(store: TyrDb, parentRequestId: string): BridgeRouteIntent | null {
  const row = store.db.prepare("select * from bridge_route_intents where parent_request_id = ?")
    .get(parentRequestId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const revision = store.db.prepare("select intent_json from bridge_route_intent_revisions where request_id = ? order by revision desc limit 1")
    .get(parentRequestId) as { intent_json: string } | undefined;
  return revision ? JSON.parse(revision.intent_json) as BridgeRouteIntent : { ...rowIntent(row), revision: 0 };
}

interface TrustedRootRequest {
  rootRequestId: string;
  request: { messageId: string; content: string };
  originMessage: MessageRecord | null;
}

function rootTrustedRequest(store: TyrDb, parentRequest: CrossWorkspaceMessageRecord): TrustedRootRequest | null {
  let request = parentRequest;
  const visited = new Set<string>();
  const rootUserId = parentRequest.originalSenderUserId ?? parentRequest.senderUserId;
  if (!rootUserId) return null;
  while (true) {
    if (visited.has(request.id) || request.initiatedBy !== "human" || request.responseKind || request.replyToMessageId ||
        request.senderUserId !== rootUserId || (request.originalSenderUserId ?? request.senderUserId) !== rootUserId) return null;
    visited.add(request.id);
    const bridge = store.getWorkspaceBridgeForServer(request.bridgeId, request.sourceWorkspaceId);
    const capabilityMember = request.sourceCapabilityUserId
      ? store.listServersForUser(request.sourceCapabilityUserId).find((server) => server.id === request.sourceWorkspaceId)
      : null;
    if (!bridge || bridge.status !== "active" || !bridge.permissions.includes("chat") ||
        (bridge.direction === "one_way" && bridge.workspaceAId !== request.sourceWorkspaceId) ||
        bridge.peerWorkspace?.id !== request.targetWorkspaceId || !capabilityMember || capabilityMember.role === "guest" ||
        request.targetCapabilityUserId !== bridge.peerWorkspace.ownerUserId) return null;
    if (!request.parentBridgeRequestId) break;
    const parent = store.getCrossWorkspaceMessage(request.parentBridgeRequestId);
    if (!parent || parent.targetWorkspaceId !== request.sourceWorkspaceId || parent.traceId !== request.traceId ||
        parent.targetCapabilityUserId !== request.sourceCapabilityUserId) return null;
    request = parent;
  }
  // Direct API/MCP requests and Human DM requests both originate from the authenticated source member.
  if (request.sourceCapabilityUserId !== rootUserId) return null;
  const hasOriginDm = Boolean(request.originMessageId || request.originChannelId || request.originConversationId);
  if (hasOriginDm) {
    const message = request.originMessageId ? store.getMessage(request.originMessageId) : null;
    if (!message || message.channelId !== request.originChannelId ||
        (message.conversationId ?? null) !== (request.originConversationId ?? null) ||
        !trustedLocalRouteSource(store, { message, serverId: request.sourceWorkspaceId, requestingUserId: rootUserId })) return null;
    return { rootRequestId: request.id, request: { messageId: message.id, content: message.content }, originMessage: message };
  }
  // No visible DM is expected for an authenticated direct Bridge API/MCP send. The delivery-created
  // system message is a durable messages FK; its body never substitutes for the canonical request.
  if (request.awaitingAgentId || request.originExternalRef || !request.peerMessageId || !request.conversationId ||
      (request.originSource !== "web" && request.originSource !== "mcp")) return null;
  const peerMessage = store.getMessage(request.peerMessageId);
  const channel = peerMessage ? store.resolveTarget(peerMessage.channelId, request.targetWorkspaceId) : null;
  const identity = channel?.dmIdentity;
  if (!peerMessage || peerMessage.senderType !== "system" || peerMessage.senderId !== rootUserId ||
      peerMessage.channelType !== "dm" || peerMessage.conversationId !== request.conversationId ||
      channel?.serverId !== request.targetWorkspaceId || identity?.kind !== "workspace_bridge" ||
      identity.bridgeId !== request.bridgeId || identity.workspaceId !== request.targetWorkspaceId ||
      identity.agentId !== request.receiverCommsAgentId) return null;
  return { rootRequestId: request.id, request: { messageId: peerMessage.id, content: request.content }, originMessage: null };
}

/** Private root history is used only by the server's read-only parser, never by the peer TYR tool loop. */
export function getBridgeRoutePlanningContext(store: TyrDb, parentRequestId: string, serverId: string): RoutePlanningContext | null {
  const parent = store.getCrossWorkspaceMessage(parentRequestId);
  if (!parent || parent.targetWorkspaceId !== serverId || parent.responseKind) return null;
  const root = rootTrustedRequest(store, parent);
  if (!root) return null;
  return {
    currentWorkspaceName: routePlanningWorkspaceName(store, serverId),
    requesterRole: "bridge",
    inboundSourceWorkspaceName: routePlanningWorkspaceName(store, parent.sourceWorkspaceId),
    request: root.request,
    requesterClarifications: [...new Map(bridgeRouteClarifications(store, parent.id)
      .filter(item => item.row.root_request_id === root.rootRequestId)
      .map(item => [item.authority!.messageId, item.authority!])).values()],
    inboundRequest: { messageId: parent.id, content: parent.content },
    priorHumanMessages: root.originMessage?.senderType === "human" ? store.listMessages(root.originMessage.channelId, 100)
      .filter((message) => message.conversationId === root.originMessage!.conversationId && message.senderType === "human" &&
        message.senderId === root.originMessage!.senderId && message.seq < root.originMessage!.seq)
      .map((message) => ({ messageId: message.id, content: message.content })) : [],
    workspaceRoutingInstructions: store.getWorkspaceRoutingInstructions(serverId),
    localAgents: routePlanningLocalAgents(store, serverId),
    bridges: routePlanningBridges(store, serverId, parent.bridgeId)
  };
}

/** Freeze one verified direct next hop before the peer TYR can delegate or send. */
export function ensureBridgeRouteIntent(store: TyrDb, parentRequestId: string, serverId: string, proposal?: RoutePlanProposal): BridgeRouteIntent | null {
  const existing = getBridgeRouteIntent(store, parentRequestId);
  if (existing) return existing.serverId === serverId ? existing : null;
  const context = getBridgeRoutePlanningContext(store, parentRequestId, serverId);
  const parent = store.getCrossWorkspaceMessage(parentRequestId);
  if (!context || !parent) return null;
  const plan = validateRoutePlanProposal(context, proposal);
  const intent: BridgeRouteIntent = {
    parentRequestId, rootMessageId: context.request.messageId, serverId,
    requestingUserId: parent.originalSenderUserId ?? parent.senderUserId ?? null, traceId: parent.traceId ?? null,
    ...routeIntentAuthorityForPlan(plan),
    requestHash: createHash("sha256").update(JSON.stringify([
      context.request.content.trim(), context.inboundRequest?.content.trim() ?? ""
    ])).digest("hex"),
    routingRevision: context.workspaceRoutingInstructions.revision, createdAt: new Date().toISOString(), plan
  };
  store.db.prepare(`insert or ignore into bridge_route_intents
    (parent_request_id, root_message_id, server_id, requesting_user_id, trace_id,
     action_kind, allowed_actions_json, target_bridge_id, evidence_kind, evidence_message_id,
     request_hash, routing_revision, created_at, plan_json)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      intent.parentRequestId, intent.rootMessageId, intent.serverId, intent.requestingUserId, intent.traceId,
      intent.actionKind, JSON.stringify(intent.allowedActions), intent.targetBridgeId, intent.evidenceKind,
      intent.evidenceMessageId, intent.requestHash, intent.routingRevision, intent.createdAt, JSON.stringify(plan)
    );
  return getBridgeRouteIntent(store, parentRequestId);
}

export function bridgeRouteIntentPredatesCutover(store: TyrDb, createdAt: string): boolean {
  const row = store.db.prepare("select cutoff_at from bridge_route_intent_cutover where id = 1")
    .get() as { cutoff_at: string } | undefined;
  return Boolean(row?.cutoff_at && createdAt < row.cutoff_at);
}

/** Append a revision only before an outbound step exists; the original frozen row is never rewritten. */
export function reviseBridgeRouteIntent(store: TyrDb, input: {
  requestId: string; serverId: string; answerEventId: string; sourceMessageId: string;
  expectedRevision: number; context: RoutePlanningContext; proposal: RoutePlanProposal;
}): BridgeRouteIntent {
  return store.db.transaction(() => {
    const current = getBridgeRouteIntent(store, input.requestId);
    const existing = store.db.prepare("select intent_json from bridge_route_intent_revisions where request_id = ? and answer_event_id = ?")
      .get(input.requestId, input.answerEventId) as { intent_json: string } | undefined;
    const latest = bridgeRouteClarifications(store, input.requestId).at(-1);
    if (!current || current.serverId !== input.serverId || latest?.row.event_id !== input.answerEventId ||
        latest.row.peer_message_id !== input.sourceMessageId) throw new Error("route_clarification_superseded");
    if (existing) return JSON.parse(existing.intent_json) as BridgeRouteIntent;
    if ((current.revision ?? 0) !== input.expectedRevision ||
        JSON.stringify(getBridgeRoutePlanningContext(store, input.requestId, input.serverId)) !== JSON.stringify(input.context)) {
      throw new Error("route_context_changed");
    }
    if (current.allowedActions.includes("bridge_send") ||
        store.db.prepare("select 1 from cross_workspace_messages where parent_bridge_request_id = ? or terminal_request_id = ?")
          .get(input.requestId, input.requestId) ||
        store.getCrossWorkspaceMessage(input.requestId)?.resolvedByTerminalId ||
        store.db.prepare(`select 1 from runtime_executions where json_valid(communication_return_external_ref)
          and json_extract(communication_return_external_ref, '$.requestMessageId') = ?
          and status not in ('completed','cancelled')`).get(input.requestId) ||
        store.db.prepare(`select 1 from bridge_continuation_steps s join bridge_continuation_attempts a on a.id = s.attempt_id
          where a.request_id = ? and s.state != 'completed'`).get(input.requestId)) {
      throw new Error("route_revision_has_existing_work");
    }
    const plan = validateRoutePlanProposal(input.context, input.proposal);
    const next: BridgeRouteIntent = { ...current, ...routeIntentAuthorityForPlan(plan), plan,
      revision: input.expectedRevision + 1, routingRevision: input.context.workspaceRoutingInstructions.revision,
      requestHash: createHash("sha256").update(JSON.stringify(input.context)).digest("hex"), createdAt: new Date().toISOString() };
    store.db.prepare(`insert into bridge_route_intent_revisions (request_id, revision, answer_event_id, intent_json, created_at)
      values (?, ?, ?, ?, ?)`).run(input.requestId, next.revision, input.answerEventId, JSON.stringify(next), next.createdAt);
    store.recordAuditEvent({ kind: "bridge_route_intent_revised", actorType: "user", actorId: current.requestingUserId!,
      resourceType: "workspace_bridge", resourceId: input.requestId, serverId: input.serverId,
      metadata: { requestId: input.requestId, answerEventId: input.answerEventId,
        previousRevision: input.expectedRevision, revision: next.revision!, requestHash: next.requestHash } });
    return next;
  })();
}
