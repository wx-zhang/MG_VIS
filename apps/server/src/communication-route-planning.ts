import { bridgeRouteClarifications } from "./bridge-route-clarifications";
import { requestAssistantRoutePlan } from "./assistant-route-planner";
import {
  ensureCommunicationRouteIntent,
  getCommunicationRouteIntent,
  getCommunicationRoutePlanningContext,
  type CommunicationRouteIntent,
  type RoutePlanProposal,
  type RoutePlanningContext
} from "./communication-route-intent";
import { ensureBridgeRouteIntent, reviseBridgeRouteIntent, getBridgeRouteIntent, getBridgeRoutePlanningContext, type BridgeRouteIntent } from "./bridge-route-intent";
import type { CommunicationAgentSourceContext } from "./communication-agent-source";
import type { ServerRouteContext } from "./server-context";

export class CommunicationRoutePlanningError extends Error {
  constructor(readonly code: string, readonly publicMessage: string) {
    super(code);
  }
}

type PlanningInput = {
  serverId: string;
  userId: string;
  channelId: string;
  conversationId?: string;
  sourceMessageId?: string;
  sourceContext?: CommunicationAgentSourceContext;
};

function verifiedIncomingBridgeRequest(ctx: ServerRouteContext, input: PlanningInput) {
  const parentId = input.sourceContext?.parentBridgeRequestId;
  const source = input.sourceMessageId ? ctx.store.getMessage(input.sourceMessageId) : null;
  const parent = parentId ? ctx.store.getCrossWorkspaceMessage(parentId) : null;
  const identity = source ? ctx.store.resolveTarget(source.channelId, input.serverId)?.dmIdentity : null;
  const sourceLinkedToRequest = Boolean(source && parent && (source.id === parent.peerMessageId ||
    ctx.store.db.prepare(`select 1 from cross_workspace_messages
      where peer_message_id = ? and reply_to_message_id = ? and bridge_id = ? and conversation_id = ?`)
      .get(source.id, parent.id, parent.bridgeId, parent.conversationId)));
  if (!source || !parent || parent.targetWorkspaceId !== input.serverId ||
      input.sourceContext?.accessMode !== "workspace_bridge" ||
      input.sourceContext.workspaceBridgeId !== parent.bridgeId ||
      identity?.kind !== "workspace_bridge" || identity.bridgeId !== parent.bridgeId ||
      identity.workspaceId !== input.serverId || source.conversationId !== parent.conversationId ||
      !sourceLinkedToRequest || parent.resolvedByTerminalId ||
      (parent.targetCapabilityUserId && input.userId !== parent.targetCapabilityUserId) ||
      !getBridgeRoutePlanningContext(ctx.store, parent.id, input.serverId)) {
    throw new CommunicationRoutePlanningError("route_context_mismatch", "The request route does not match this workspace conversation.");
  }
  if (ctx.store.db.prepare("select 1 from cross_workspace_messages where terminal_request_id = ?").get(parent.id)) {
    throw new CommunicationRoutePlanningError("workspace_bridge_request_completed", "This Bridge request already ended. Review its saved result; no new action was dispatched.");
  }
  return parent;
}

/** Local Agent work needs a verified inbound Bridge, never an outbound route plan. */
export function verifyIncomingBridgeLocalRequest(ctx: ServerRouteContext, input: PlanningInput): void {
  if (!input.sourceContext?.parentBridgeRequestId) {
    throw new CommunicationRoutePlanningError("route_context_mismatch", "The request is not an inbound Workspace Bridge request.");
  }
  verifiedIncomingBridgeRequest(ctx, input);
}

const localPlan = (): RoutePlanProposal => ({
  decision: "local", targetBridgeId: null, action: "Complete the work within the current workspace.",
  constraints: [], evidenceKind: "unresolved", evidenceMessageId: null, clarification: null
});

async function interpretRoute(ctx: ServerRouteContext, context: RoutePlanningContext): Promise<RoutePlanProposal> {
  // With no possible outgoing hop, a worker may only complete local work or ask its requester.
  if (context.bridges.length === 0) return localPlan();
  if (ctx.assistantRoutePlanner) return ctx.assistantRoutePlanner(context);
  const config = ctx.assistantLlmConfig;
  if (!config?.enabled) throw new CommunicationRoutePlanningError("route_planner_unavailable",
    "TYR cannot verify the next workspace step right now. No Agent or Bridge request was sent.");
  return requestAssistantRoutePlan(context, config);
}

/** Interprets trusted request material only, before dispatch. Continuations never run this parser. */
export async function prepareInitialCommunicationRoute(
  ctx: ServerRouteContext,
  input: PlanningInput,
  directBridge?: { id: string; message: string }
): Promise<CommunicationRouteIntent | BridgeRouteIntent> {
  const parentId = input.sourceContext?.parentBridgeRequestId;
  const source = input.sourceMessageId ? ctx.store.getMessage(input.sourceMessageId) : null;
  if (!source || source.channelId !== input.channelId ||
      (input.conversationId && source.conversationId !== input.conversationId)) {
    throw new CommunicationRoutePlanningError("route_source_missing", "TYR could not verify the original request. No Agent or Bridge request was sent.");
  }
  if (parentId) {
    verifiedIncomingBridgeRequest(ctx, input);
  }
  const existing = parentId ? getBridgeRouteIntent(ctx.store, parentId)
    : getCommunicationRouteIntent(ctx.store, source.id);
  const clarification = parentId ? bridgeRouteClarifications(ctx.store, parentId).at(-1) : undefined;
  const canRevise = Boolean(existing && parentId && clarification && !existing.allowedActions.includes("bridge_send"));
  if (canRevise && clarification!.row.peer_message_id !== source.id) {
    throw new CommunicationRoutePlanningError("route_clarification_superseded",
      "A newer requester clarification is pending. This older turn cannot send another workspace request.");
  }
  const revisionAlreadySaved = parentId && clarification && ctx.store.db.prepare(
    "select 1 from bridge_route_intent_revisions where request_id = ? and answer_event_id = ?"
  ).get(parentId, clarification.row.event_id);
  if (existing) {
    const parent = parentId ? ctx.store.getCrossWorkspaceMessage(parentId) : null;
    if (existing.serverId !== input.serverId ||
        (!parentId && existing.requestingUserId !== input.userId) ||
        (parentId && (!parent || parent.targetWorkspaceId !== input.serverId ||
          existing.requestingUserId !== (parent.originalSenderUserId ?? parent.senderUserId)))) {
      throw new CommunicationRoutePlanningError("route_context_mismatch", "The saved request route does not match this workspace or requester.");
    }
    if (!canRevise || revisionAlreadySaved) return existing;
  }
  // A peer may first do local work without planning an outbound hop. If it later tries an
  // additional Bridge, classify that hop from the immutable root and current inbound request,
  // never from the worker result. Local Human continuations still require their frozen route.
  if (!parentId && (input.sourceContext?.continuationStepCount || input.sourceContext?.bridgeContinuationAttemptId)) {
    throw new CommunicationRoutePlanningError("route_intent_missing", "TYR could not verify the original request's saved route. No new workspace request was sent.");
  }
  const routeInput = {
    message: source, serverId: input.serverId, requestingUserId: input.userId
  };
  const context = parentId
    ? getBridgeRoutePlanningContext(ctx.store, parentId, input.serverId)
    : getCommunicationRoutePlanningContext(ctx.store, routeInput);
  if (!context) throw new CommunicationRoutePlanningError("route_source_unverified", "TYR could not verify the original requester. No Agent or Bridge request was sent.");
  try {
    // A direct first-turn send already supplies a model-selected destination. Recording it
    // does not authorize other destinations after an asynchronous result or limit parallel initial sends.
    const proposal: RoutePlanProposal = directBridge && !parentId && !context.existingBridgeRequests?.length ? {
      decision: "bridge", targetBridgeId: directBridge.id, action: directBridge.message,
      constraints: [], evidenceKind: "current_request", evidenceMessageId: source.id, clarification: null
    } : await interpretRoute(ctx, context);
    const currentContext = parentId
      ? getBridgeRoutePlanningContext(ctx.store, parentId, input.serverId)
      : getCommunicationRoutePlanningContext(ctx.store, routeInput);
    if (JSON.stringify(currentContext) !== JSON.stringify(context)) {
      throw new CommunicationRoutePlanningError("route_context_changed",
        "The request or available workspace routes changed while TYR was preparing it. No Agent or Bridge request was sent. Please try again.");
    }
    const intent = parentId
      ? canRevise ? reviseBridgeRouteIntent(ctx.store, { requestId: parentId, serverId: input.serverId,
          answerEventId: clarification!.row.event_id, sourceMessageId: source.id,
          expectedRevision: (existing as BridgeRouteIntent).revision ?? 0, context, proposal })
        : ensureBridgeRouteIntent(ctx.store, parentId, input.serverId, proposal)
      : ensureCommunicationRouteIntent(ctx.store, { ...routeInput, proposal });
    if (!intent) throw new Error("route_context_mismatch");
    return intent;
  } catch (error) {
    if (error instanceof CommunicationRoutePlanningError) throw error;
    if (error instanceof Error && ["route_revision_has_existing_work", "route_context_changed", "route_clarification_superseded"].includes(error.message)) {
      throw new CommunicationRoutePlanningError(error.message,
        "The saved route cannot be revised while an earlier step or a newer clarification needs review. No new Bridge request was sent; review the original request diagnostics.");
    }
    // Never expose root DM content, provider bodies, or the private planning response to a peer.
    throw new CommunicationRoutePlanningError("route_planning_failed",
      "TYR could not verify the next workspace step. No Agent or Bridge request was sent. Please try again.");
  }
}

export function routeClarification(intent: CommunicationRouteIntent | BridgeRouteIntent, peerRequest = false): string | null {
  if (intent.plan?.decision !== "clarify") return null;
  return peerRequest
    ? "The requested next workspace step needs clarification from the original requester. No new request was sent."
    : intent.plan.clarification || "Which connected workspace should I contact for this request? No Agent or Bridge request was sent.";
}
