import { isCommunicationAgent } from "@tyr-ai/contracts";
import type { AssistantLlmContext } from "./assistant-llm";
import type { CommunicationAgentSourceContext } from "./communication-agent-source";
import type { ServerRouteContext } from "./server-context";
import { getCommunicationRouteIntent } from "./communication-route-intent";
import { getBridgeRouteIntent } from "./bridge-route-intent";
import { verifiedCommunicationOriginAction } from "./communication-origin-route";
import { restoreMcpCommunicationAuthority } from "./mcp-communication-authority";

export function buildAssistantLlmContext(ctx: ServerRouteContext, serverId: string, userMessage: string, input: {
  userId: string;
  channelId: string;
  conversationId?: string;
  sourceMessageId?: string;
  sourceContext: CommunicationAgentSourceContext;
  workerContinuation?: NonNullable<AssistantLlmContext["workerContinuation"]>;
  bridgeContinuation?: NonNullable<AssistantLlmContext["bridgeContinuation"]>;
  workspaceRoutingInstructions?: AssistantLlmContext["workspaceRoutingInstructions"];
}): AssistantLlmContext {
  const sourceContext = input.sourceMessageId || input.sourceContext.source === "mcp" || input.sourceContext.mcpAuthorityMessageId
    ? restoreMcpCommunicationAuthority(ctx.store, {
    sourceMessageId: input.sourceMessageId ?? "",
    userId: input.userId, serverId, channelId: input.channelId, conversationId: input.conversationId,
    sourceContext: input.sourceContext
  }) : input.sourceContext;
  const mcpOrigin = sourceContext.accessMode !== "workspace_bridge" &&
    (sourceContext.source === "mcp" || Boolean(sourceContext.mcpAuthorityMessageId));
  const presentationOnly = mcpOrigin && Boolean(sourceContext.mcpAuthorizationError);
  const canReadBridgeMetadata = !mcpOrigin || (!presentationOnly && sourceContext.grantedScopes?.includes("tyr:bridge:read"));
  // An invalid grant may present previously authorized work; it cannot inspect fresh workspace inventory.
  const machines = presentationOnly ? [] : ctx.store.listMachines(serverId);
  const machinesById = new Map(machines.map((machine) => [machine.id, machine]));
  // DM history must follow the exact active conversation; channel-wide reads can mix closed sessions.
  const originalMessage = presentationOnly ? ctx.store.db.prepare(
    `select messages.seq from messages join channels on channels.id = messages.channel_id
     where messages.id = ? and messages.sender_type = 'human' and messages.sender_id = ?
       and messages.channel_id = ? and messages.conversation_id = ? and channels.server_id = ?`
  ).get(input.sourceMessageId ?? "", input.userId,
    input.channelId, input.conversationId ?? "", serverId) as { seq: number } | undefined : undefined;
  const historyMessages = presentationOnly
    ? originalMessage && input.conversationId
      ? ctx.store.readConversationHistory(input.conversationId, 8, undefined, originalMessage.seq + 1)?.messages ?? []
      : []
    : input.conversationId
      ? ctx.store.readConversationHistory(input.conversationId, 8)?.messages ?? []
      : ctx.store.listMessages(input.channelId, 8);
  const history = historyMessages.map((message) => ({
    senderType: message.senderType,
    senderName: message.senderName,
    content: message.content,
    attachments: (message.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes
    })),
    ...(message.result?.sourceAgentName ? {
      executionResult: {
        status: message.result.status,
        title: message.result.title,
        sourceAgentName: message.result.sourceAgentName
      }
    } : {}),
    // Bridge 结果只向模型提供精确回查凭据，避免状态追问被误判为一条新的跨 Workspace 请求。
    ...(canReadBridgeMetadata && message.result?.workspaceBridge ? {
      workspaceBridge: {
        bridgeRequestId: message.result.workspaceBridge.bridgeRequestId,
        bridgeId: message.result.workspaceBridge.bridgeId,
        state: message.result.workspaceBridge.state,
        sentContent: message.result.workspaceBridge.sentContent
      }
    } : {}),
    createdAt: message.createdAt
  }));
  const agents = (presentationOnly ? [] : ctx.store.listAgents(serverId))
    .filter((agent) => !isCommunicationAgent(agent))
    .map((agent) => {
      const machine = agent.machineId ? machinesById.get(agent.machineId) : undefined;
      return {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName,
        status: agent.status,
        runtime: agent.runtime ?? null,
        profilePrompt: agent.description?.trim() || "Not set",
        computer: machine ? {
          id: machine.id,
          name: machine.name,
          status: machine.status
        } : null
      };
    });
  // Guest 连 Bridge metadata 也不进入模型上下文，避免模型在执行层拒绝前泄露对端 Workspace 信息。
  const bridgeMembership = canReadBridgeMetadata ? ctx.store.listServersForUser(input.userId).find((server) => server.id === serverId) : undefined;
  const inboundBridgeId = input.sourceContext.accessMode === "workspace_bridge"
    ? input.sourceContext.workspaceBridgeId
    : undefined;
  const inboundRequest = canReadBridgeMetadata && input.sourceContext.parentBridgeRequestId
    ? ctx.store.getCrossWorkspaceMessage(input.sourceContext.parentBridgeRequestId)
    : null;
  const candidateFollowup = inboundRequest ? ctx.store.getCrossWorkspaceMessage(sourceContext.sourceEventKey) : null;
  const inboundFollowup = candidateFollowup && candidateFollowup.replyToMessageId === inboundRequest?.id &&
    candidateFollowup.peerMessageId === input.sourceMessageId && candidateFollowup.bridgeId === inboundRequest.bridgeId &&
    candidateFollowup.sourceWorkspaceId === inboundRequest.sourceWorkspaceId &&
    candidateFollowup.targetWorkspaceId === serverId &&
    ["answer", "instruction", "continue"].includes(candidateFollowup.responseKind ?? "") ? candidateFollowup : null;
  const inboundPeer = canReadBridgeMetadata && inboundBridgeId
    ? ctx.store.getWorkspaceBridgeForServer(inboundBridgeId, serverId)?.peerWorkspace
    : null;
  const workspaceBridges = (bridgeMembership && bridgeMembership.role !== "guest"
    ? ctx.store.listWorkspaceBridges(serverId)
    : [])
    .filter((bridge) => (
      bridge.status === "active" &&
      bridge.peerWorkspace &&
      // 当前入站 Bridge 负责自动回传，不能再作为下一跳；其他 active Bridge 仍允许正常 chaining。
      bridge.id !== inboundBridgeId
    ))
    .map((bridge) => {
      const peerAssistant = bridge.peerWorkspace?.onboardingAgentId
        ? ctx.store.getAgent(bridge.peerWorkspace.onboardingAgentId)
        : null;
      return {
        id: bridge.id,
        peerWorkspaceName: bridge.peerWorkspace!.name,
        peerAssistantName: peerAssistant?.displayName ?? "TYR",
        status: "active" as const,
        direction: bridge.direction,
        permissions: [...bridge.permissions],
        connectedAt: bridge.acceptedAt
      };
    });
  // 原请求的实际发送记录独立于最近八条展示消息，避免进度回执挤掉已经完成的步骤。
  const visibleBridgeIds = new Set(workspaceBridges.map((bridge) => bridge.id));
  const bridgeRequests = canReadBridgeMetadata && (inboundRequest || input.sourceMessageId &&
    (input.workerContinuation || input.bridgeContinuation))
    ? (inboundRequest ? ctx.store.listCrossWorkspaceChildRequests(inboundRequest.id)
      : ctx.store.listCrossWorkspaceRequestsForSourceMessage(input.sourceMessageId!)).filter((request) => (
        request.sourceWorkspaceId === serverId &&
        request.originChannelId === input.channelId &&
        request.originConversationId === (input.conversationId ?? null) &&
        request.sourceCapabilityUserId === input.userId &&
        visibleBridgeIds.has(request.bridgeId) && !request.replyToMessageId && !request.responseKind
      ))
    : [];
  const bridgeMessages = new Map<string, ReturnType<typeof ctx.store.listCrossWorkspaceMessages>>();
  const bridgeSteps: NonNullable<AssistantLlmContext["bridgeSteps"]> = bridgeRequests.slice(-32).map((request) => {
    let messages = bridgeMessages.get(request.bridgeId);
    if (!messages) {
      messages = ctx.store.listCrossWorkspaceMessages(request.bridgeId);
      bridgeMessages.set(request.bridgeId, messages);
    }
    const terminal = messages.find((message) => (
      message.replyToMessageId === request.id &&
      message.conversationId === request.conversationId &&
      message.sourceWorkspaceId === request.targetWorkspaceId &&
      message.targetWorkspaceId === request.sourceWorkspaceId &&
      (message.responseKind === "final" || message.responseKind === "error")
    ));
    const question = !terminal ? messages.filter((message) => message.replyToMessageId === request.id &&
      message.sourceWorkspaceId === request.targetWorkspaceId && message.targetWorkspaceId === serverId &&
      message.responseKind === "question").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : null;
    return {
      requestId: request.id,
      bridgeId: request.bridgeId,
      ...(request.conversationId ? { conversationId: request.conversationId } : {}),
      sentContent: request.content,
      status: request.outcome === "failed" || terminal?.responseKind === "error" ? "failed"
        : terminal?.responseKind === "final" ? "completed" : "pending",
      ...(terminal ? { result: terminal.content } : {}),
      ...(question ? { pendingQuestion: question.content } : {}),
      createdAt: request.createdAt
    };
  });
  // Continuations must use the routing revision captured when the request began.
  const routingInstructions = input.workspaceRoutingInstructions
    ?? (presentationOnly ? { instructions: "", revision: 0 } : ctx.store.getWorkspaceRoutingInstructions(serverId));
  const savedRoute = canReadBridgeMetadata && (inboundFollowup || input.workerContinuation || input.bridgeContinuation)
    ? input.sourceContext.parentBridgeRequestId
      ? getBridgeRouteIntent(ctx.store, input.sourceContext.parentBridgeRequestId)
      : input.sourceMessageId
        ? getCommunicationRouteIntent(ctx.store, input.sourceMessageId)
        : null
    : null;
  const authorizedPeer = savedRoute?.targetBridgeId && savedRoute.allowedActions.includes("bridge_send")
    ? ctx.store.getWorkspaceBridgeForServer(savedRoute.targetBridgeId, serverId)
    : null;
  const originAction = canReadBridgeMetadata && input.workerContinuation && input.sourceMessageId && !input.sourceContext.parentBridgeRequestId
    ? verifiedCommunicationOriginAction(ctx.store, {
        eventId: input.sourceContext.sourceEventKey,
        serverId,
        requestingUserId: input.userId,
        sourceMessageId: input.sourceMessageId
      })
    : null;
  return {
    // interactionMode 只约束回复表达；Bridge 的身份、会话和权限仍由服务端边界校验。
    interactionMode: input.sourceContext.accessMode === "workspace_bridge" ? "workspace_bridge" : "workspace",
    nativeReactionsAvailable: input.sourceContext.source === "telegram" && !input.sourceContext.parentBridgeRequestId &&
      !("systemTrigger" in input.sourceContext && input.sourceContext.systemTrigger) && input.sourceContext.accessMode !== "workspace_bridge" &&
      Boolean(ctx.store.db.prepare("select 1 from telegram_message_origins where message_id = ?").get(input.sourceMessageId ?? "")),
    serverId,
    userMessage,
    history,
    ...(bridgeSteps.length ? { bridgeSteps, bridgeStepsTruncated: bridgeRequests.length > bridgeSteps.length } : {}),
    ...(inboundRequest && inboundPeer ? { inboundBridge: {
      requestId: inboundRequest.id,
      sourceWorkspaceName: inboundPeer.name,
      requestingUserName: inboundRequest.senderUserDisplayName ?? inboundRequest.senderUserName ?? "Bridge user",
      originalRequest: inboundRequest.content,
      replyMode: "automatic" as const
    } } : {}),
    ...(inboundFollowup ? { inboundBridgeFollowup: { eventId: inboundFollowup.id,
      kind: inboundFollowup.responseKind as "answer" | "instruction" | "continue", content: inboundFollowup.content } } : {}),
    // 该服务端配置在所有 TYR 入口构造相同上下文，不依赖 daemon 或本地 MEMORY.md。
    workspaceRoutingInstructions: {
      instructions: routingInstructions.instructions,
      revision: routingInstructions.revision
    },
    ...(input.workerContinuation ? { workerContinuation: input.workerContinuation } : {}),
    ...(savedRoute && authorizedPeer?.status === "active" && authorizedPeer.peerWorkspace && savedRoute.evidenceKind !== "unresolved"
      ? { authorizedContinuationRoute: {
          bridgeId: authorizedPeer.id,
          peerWorkspaceName: authorizedPeer.peerWorkspace.name,
          evidenceKind: savedRoute.evidenceKind,
          // Root private request details stay inside the server-only planner on a peer hop.
          ...(!input.sourceContext.parentBridgeRequestId && savedRoute.plan ? {
            action: savedRoute.plan.action, constraints: savedRoute.plan.constraints
          } : {})
        } }
      : {}),
    ...(originAction ? { authorizedOriginNotice: {
      originRequestId: originAction.originRequestId,
      bridgeId: originAction.bridgeId,
      peerWorkspaceName: originAction.peerWorkspaceName,
      message: originAction.peerMessage
    } } : {}),
    ...(input.bridgeContinuation ? { bridgeContinuation: input.bridgeContinuation } : {}),
    // machines 是独立库存真源；不能只依赖 agents[].computer，否则空 Computer 会对模型不可见。
    machines: machines.map((machine) => ({
      id: machine.id,
      name: machine.name,
      hostname: machine.hostname,
      status: machine.status,
      os: machine.os
    })),
    agents,
    workspaceBridges
  };
}
