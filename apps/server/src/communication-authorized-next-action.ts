import type { RuntimeExecutionRecord } from "@tyr-ai/contracts";
import { executeTyrAssistantTool } from "./assistant-tool-executor";
import { getCommunicationRouteIntent, restaurantClarificationForMessage, resumedRestaurantBookingContent } from "./communication-route-intent";
import { getBridgeRouteIntent } from "./bridge-route-intent";
import { workspaceBridgeRefForExecution } from "./workspace-bridge-delivery";
import type { ServerRouteContext } from "./server-context";

/** A worker can request an already authorized next step, but cannot choose or authorize its destination. */
export async function sendAuthorizedCommunicationNextAction(ctx: ServerRouteContext, input: {
  execution: RuntimeExecutionRecord;
  eventId: string;
  proposedBridgeId: string | null;
}): Promise<{ requestId: string | null; content: string }> {
  const execution = input.execution;
  const source = execution.communicationReturnSourceMessageId
    ? ctx.store.getMessage(execution.communicationReturnSourceMessageId)
    : null;
  const bridgeRef = workspaceBridgeRefForExecution(execution);
  const parent = bridgeRef ? ctx.store.getCrossWorkspaceMessage(bridgeRef.requestMessageId) : null;
  const intent = parent ? getBridgeRouteIntent(ctx.store, parent.id)
    : source ? getCommunicationRouteIntent(ctx.store, source.id) : null;
  if (!source || !intent ||
      (parent ? intent.requestingUserId !== (parent.originalSenderUserId ?? parent.senderUserId) ||
        parent.targetWorkspaceId !== execution.serverId || parent.bridgeId !== bridgeRef?.bridgeId
        : "sourceMessageId" in intent && (intent.sourceMessageId !== source.id ||
          intent.requestingUserId !== execution.communicationReturnUserId)) ||
      intent.serverId !== execution.serverId ||
      !intent.targetBridgeId || !intent.allowedActions.includes("bridge_send") ||
      (input.proposedBridgeId && input.proposedBridgeId !== intent.targetBridgeId)) {
    return { requestId: null, content: "Please confirm the connected workspace. I have not sent a Workspace Bridge request." };
  }
  const bridge = ctx.store.getWorkspaceBridgeForServer(intent.targetBridgeId, intent.serverId);
  if (!bridge || bridge.status !== "active") {
    return { requestId: null, content: "The previously selected Workspace Bridge is no longer active. Please choose how to continue; no new request was sent." };
  }
  const existing = ctx.store.listCrossWorkspaceRequestsForSourceMessage(source.id)
    .find((request) => request.bridgeId === intent.targetBridgeId);
  if (existing) return { requestId: existing.id, content: `The request to ${bridge.peerWorkspace?.name ?? "the connected workspace"} is already in progress.` };
  const assistant = ctx.store.ensureDefaultCommunicationAgent(intent.serverId);
  const clarification = parent ? null : restaurantClarificationForMessage(ctx.store, {
    message: source, serverId: intent.serverId, assistantAgentId: assistant.id
  });
  // A clarification such as "Bank" is only the destination, not the complete request.
  // Forward the frozen bounded action, never worker text or the original private history.
  const requestContent = intent.plan?.decision === "bridge"
    ? [intent.plan.action, ...intent.plan.constraints.map((constraint) => `Constraint: ${constraint}`)].join("\n")
    : clarification ? resumedRestaurantBookingContent(clarification) : source.content;
  const sourceContext = parent && bridgeRef ? {
    source: "web" as const,
    sourceConversationKey: `workspace_bridge:${bridgeRef.bridgeId}:${intent.serverId}:${bridgeRef.conversationId}`,
    sourceEventKey: `${source.id}:authorized-next-action:${intent.targetBridgeId}`,
    accessMode: "workspace_bridge" as const,
    workspaceBridgeId: bridgeRef.bridgeId,
    capabilityUserId: parent.targetCapabilityUserId ?? assistant.ownerUserId,
    requestingUserId: parent.senderUserId ?? parent.originalSenderUserId ?? undefined,
    requestingUserName: parent.senderUserName ?? undefined,
    requestingUserDisplayName: parent.senderUserDisplayName ?? undefined,
    bridgeTraceId: parent.traceId ?? undefined,
    parentBridgeRequestId: parent.id,
    bridgeHopCount: parent.hopCount,
    continuationStepCount: 1
  } : {
    source: execution.communicationReturnSource!,
    sourceConversationKey: execution.communicationReturnConversationId ?? execution.communicationReturnChannelId!,
    sourceEventKey: `${source.id}:authorized-next-action:${intent.targetBridgeId}`,
    ...(execution.communicationReturnExternalRef ? { externalRef: execution.communicationReturnExternalRef } : {}),
    continuationStepCount: 1
  };
  const outcome = await executeTyrAssistantTool(ctx, {
    call: {
      id: "frozen-route",
      name: "send_workspace_bridge_message",
      arguments: { bridgeId: intent.targetBridgeId, message: requestContent }
    },
    serverId: intent.serverId,
    userId: parent ? parent.targetCapabilityUserId ?? assistant.ownerUserId : execution.communicationReturnUserId!,
    assistant,
    channelId: execution.communicationReturnChannelId!,
    ...(execution.communicationReturnConversationId ? { conversationId: execution.communicationReturnConversationId } : {}),
    sourceMessageId: source.id,
    sourceContext,
    returnTarget: {
      source: execution.communicationReturnSource!,
      ...(execution.communicationReturnExternalRef ? { externalRef: execution.communicationReturnExternalRef } : {})
    },
    allowHandoff: true
  });
  if (!outcome.ok) {
    return { requestId: null, content: "TYR could not verify that the authorized Workspace Bridge request was sent. Please review the connection or clarify the next step." };
  }
  const requestId = outcome.result.bridgeRequestIds?.[0] ?? null;
  if (!requestId || !ctx.store.getCrossWorkspaceMessage(requestId)) {
    return { requestId: null, content: "TYR could not verify that the authorized Workspace Bridge request was sent. Please review the connection or clarify the next step." };
  }
  return { requestId, content: outcome.result.message };
}
