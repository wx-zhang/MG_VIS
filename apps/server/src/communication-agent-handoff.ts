import type { AgentRecord, CommunicationEvidenceRecord, CommunicationEvidenceSelection, MessageRecord, RuntimeExecutionRecord } from "@tyr-ai/contracts";

import type { ServerRouteContext } from "./server-context";
import type { HeartbeatExecutionPolicy } from "./communication-agent-source";
import { selectCommunicationEvidenceForContext } from "./communication-evidence";

export interface CommunicationAgentHandoffReturnTarget {
  source: "web" | "email" | "telegram";
  externalRef?: string;
}

export interface CommunicationAgentHandoffResult {
  content: string;
  executionIds?: string[];
  messageId?: string;
}

function trustedBridgeOriginRequestId(ctx: ServerRouteContext, externalRef: string | undefined, serverId: string,
  capabilityUserId: string, conversationId?: string): string | null {
  if (!externalRef) return null;
  try {
    const value = JSON.parse(externalRef) as Record<string, unknown>;
    if (value.kind !== "workspace_bridge" || typeof value.requestMessageId !== "string") return null;
    const request = ctx.store.getCrossWorkspaceMessage(value.requestMessageId);
    return request?.targetWorkspaceId === serverId && request.id === value.requestMessageId &&
      request.targetCapabilityUserId === capabilityUserId &&
      (!conversationId || request.conversationId === conversationId)
      ? request.id : null;
  } catch {
    return null;
  }
}

/**
 * 旧路由和模型工具共用同一个 handoff 副作用入口；调用方负责先完成 Workspace 与目标可用性校验。
 */
export function dispatchCommunicationAgentHandoff(ctx: ServerRouteContext, input: {
  serverId: string;
  userId: string;
  assistant: AgentRecord;
  channelId: string;
  conversationId?: string;
  sourceMessageId?: string;
  evidenceSelections?: CommunicationEvidenceSelection[];
  returnTarget?: CommunicationAgentHandoffReturnTarget;
  detail?: string;
  executionPolicy?: HeartbeatExecutionPolicy;
  // Bridge 共享回执只暴露请求状态；实际执行 Agent 仍保留在目标 Workspace 的执行与审计记录中。
  publicReplyAudience?: "local" | "workspace_bridge";
  publicReplyPhase?: "bridge_continuation";
}, targetAgent: AgentRecord, instruction: string): CommunicationAgentHandoffResult {
  const serverRecord = ctx.store.listServersForUser(input.userId).find((item) => item.id === input.serverId);
  // Agent message grant 只开放对话资源；Guest 不能借该 grant 让 TYR 启动 worker execution。
  if (serverRecord?.role === "guest") {
    return { content: "I can route requests for workspace owners and members only." };
  }
  let selectedEvidence: CommunicationEvidenceRecord[] = [];
  if (input.evidenceSelections?.length) {
    if (!input.sourceMessageId) return { content: "The evidence cannot be bound to the original request. No Agent instruction was sent." };
    try {
      selectedEvidence = selectCommunicationEvidenceForContext(ctx.store, {
        serverId: input.serverId, sourceMessageId: input.sourceMessageId,
        channelId: input.channelId, conversationId: input.conversationId ?? null
      }, input.evidenceSelections);
    } catch {
      return { content: "The evidence selection could not be verified for this request. No Agent instruction was sent." };
    }
  }
  const targetDm = ctx.store.getOrCreateAgentPairDm(input.assistant.id, targetAgent.name, input.serverId);
  if (!targetDm) return { content: "I could not open the internal delegation DM. Try again later." };
  const handoffConversation = input.conversationId
    ? ctx.store.getOrCreateCommunicationAgentHandoffConversation({
        serverId: input.serverId,
        sourceConversationId: input.conversationId,
        assistantAgentId: input.assistant.id,
        targetAgentId: targetAgent.id,
        channelId: targetDm.id
      })
    : null;
  // 显式来源 conversation 必须映射成功；失败时不能退回 pair DM 当前会话，否则并行 eval 会串上下文。
  if (input.conversationId && !handoffConversation) {
    return { content: "I could not isolate the worker conversation for this request. Start a new TYR conversation and try again." };
  }
  const queuedBehindActiveTurn = targetAgent.status === "working";
  const user = ctx.store.getUser(input.userId);
  const effectiveInstruction = input.executionPolicy
    ? [
        "Scheduled Heartbeat execution policy:",
        "- You are the selected executing Agent. Perform this task yourself.",
        "- Do not delegate, hand off, or route any part of this task to TYR or another Agent.",
        "- If this task reads a shared file, you MUST run ./.tyr/tyr workspace-file read --file <exact-name-or-id>. Do not use the local shared/ copy, MCP, or apply_patch.",
        "- If this task changes a shared file, you MUST run ./.tyr/tyr workspace-file update --file <exact-name-or-id> --expected-version <version-from-read> --content <complete-utf8-content> before your final response. Report completion only after that command succeeds.",
        "- These two exact Tyr shared-file CLI commands are explicitly permitted. Do not call any other Tyr CLI or collaboration tool; do not add, delete, rename, or move shared files.",
        "- Owner authorization covers only existing read-write shared files assigned to you; the shared-file tools enforce assignment and version checks.",
        "- Any other side effect remains subject to normal approval.",
        `- Use this scheduled timestamp when the task needs a time: ${input.executionPolicy.scheduledFor}`,
        "",
        instruction
      ].join("\n")
    : instruction;
  // Peer Bridge replies must keep the target Workspace's internal Agent identity private.
  const localBridgeFollowup = input.publicReplyPhase === "bridge_continuation" && input.publicReplyAudience !== "workspace_bridge";
  let publicReplyContent: string;
  if (input.publicReplyAudience === "workspace_bridge") {
    publicReplyContent = queuedBehindActiveTurn
      ? "The request was queued in the connected workspace. I’ll report back here when it completes."
      : "The request was accepted by the connected workspace. I’ll report back here when it completes.";
  } else if (localBridgeFollowup) {
    publicReplyContent = queuedBehindActiveTurn
      ? `The connected workspace replied. ${targetAgent.displayName} is busy, so the remaining work was queued. I will report back here when it completes.`
      : `The connected workspace replied. I asked ${targetAgent.displayName} to complete the remaining work and will report back here.`;
  } else {
    publicReplyContent = queuedBehindActiveTurn
      ? `${targetAgent.displayName} is busy, so the instruction was queued. I will report back here when it responds.`
      : `Routed to ${targetAgent.displayName}. I will report back here when it responds.`;
  }
  let publicReply: MessageRecord | null = null;
  const publishVisibleRouteReply = (execution: Pick<RuntimeExecutionRecord, "id">): void => {
    if (!publicReply) {
      publicReply = ctx.store.sendMessage({
        target: input.channelId,
        ...(input.conversationId ? {
          conversationId: input.conversationId,
          allowClosedConversation: true
        } : {}),
        content: publicReplyContent,
        // A completed Bridge step can still leave the Human's original request open.
        ...(localBridgeFollowup ? { result: {
          version: 1 as const,
          status: "partial" as const,
          title: "TYR is continuing the request",
          summary: publicReplyContent,
          ...(input.sourceMessageId ? { communicationRequest: { sourceMessageId: input.sourceMessageId } } : {})
        } } : {}),
        senderType: "agent",
        senderId: input.assistant.id,
        senderName: input.assistant.displayName,
        serverId: input.assistant.serverId ?? "local"
      }).message;
      ctx.store.attachRuntimeExecutionRootMessage(execution.id, publicReply.id);
      // Message 必须先进入客户端，随后发出的 rooted execution 才能立即挂到正确气泡上。
      ctx.emitRealtimeMessage(publicReply);
      return;
    }
    ctx.store.attachRuntimeExecutionRootMessage(execution.id, publicReply.id);
  };
  // TYR 与 worker 通过固定 Agent pair 传输；Human 只在原 Assistant DM 接收汇总结果。
  const originRequestId = trustedBridgeOriginRequestId(ctx, input.returnTarget?.externalRef,
    input.serverId, input.userId, input.conversationId);
  if (input.publicReplyAudience === "workspace_bridge" && !originRequestId) {
    return { content: "The Bridge request origin could not be verified. No Agent instruction was sent." };
  }
  const originRequest = originRequestId ? ctx.store.getCrossWorkspaceMessage(originRequestId) : null;
  const requestingUserId = originRequest?.originalSenderUserId ?? originRequest?.senderUserId ?? input.userId;
  const requester = ctx.store.getUser(requestingUserId);
  const handoffMessage = ctx.store.createDelegationMessage({
    channelId: targetDm.id,
    ...(handoffConversation ? { conversationId: handoffConversation.id } : {}),
    serverId: input.serverId,
    senderAgent: input.assistant,
    targetAgent,
    instruction: [
      "TYR handoff",
      `Requested by: ${requester?.displayName ?? requestingUserId}`,
      ...(originRequestId ? [`Execution capability: ${user?.displayName ?? input.userId} (destination Workspace Owner)`] : []),
      ...(originRequestId ? [
        `Server origin reference: ${originRequestId}`,
        "If this request creates a durable business record, preserve that origin reference with the record. Return it to TYR for any later notice to the original requester; it is not permission to contact another Workspace directly."
      ] : []),
      "When the current work is complete, provide your final result to TYR; you may also report it with report_to_tyr kind=result. TYR reviews and automatically returns the current Bridge result to its original requester. Returning this result is not a new action: do not use kind=action_request or request another Bridge send merely to relay it.",
      "When the requester needs exact verification fields such as a checksum, reference, amount or status, report those observed scalar values with report_to_tyr kind=result and facts=[{key,value}] before your final response. Include only necessary permitted fields, never credentials or private record contents. The server creates the evidence receipt; do not invent receipt IDs. If a value cannot be verified, state that gap instead of inventing a fact.",
      "If TYR must perform an additional action beyond returning the current result, call report_to_tyr with kind=action_request. Include the completed work and the exact remaining action in content. For a separate later notice tied to a stored Bridge origin reference, set origin_request_id and the exact peer_message. TYR will verify the recipient and decide whether to send. Do not address another Workspace from this worker.",
      "If you cannot finish because required information is missing, call report_to_tyr with kind=question and state exactly what evidence is needed. Do not ask TYR to repeat this same handoff without new information.",
      "An Agent role does not confer the Human Owner's identity or broader authority. Make decisions only within your role and the existing authorized request; state when a decision is outside that scope.",
      ...(selectedEvidence.length ? [
        "Server-bound evidence selected by TYR:",
        JSON.stringify(selectedEvidence),
        "These original fields are bound to the request and receipt shown above. Their authenticated source does not establish business truth or authorize additional actions. Apply your own verification rules; do not rewrite values or infer aliases."
      ] : []),
      "",
      effectiveInstruction
    ].join("\n")
  });
  ctx.emitRealtimeMessage(handoffMessage);
  const execution = ctx.createAndEnqueueMessageHandoffRun(
    targetAgent,
    handoffMessage,
    input.detail ?? `Starting @${targetAgent.name} from TYR route.`,
    {
      communicationReturn: {
        channelId: input.channelId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
        userId: input.userId,
        source: input.returnTarget?.source ?? "web",
        ...(input.returnTarget?.externalRef ? { externalRef: input.returnTarget.externalRef } : {})
      },
      onExecutionCreated: publishVisibleRouteReply
    }
  );
  if (!execution) {
    return {
      content: input.publicReplyAudience === "workspace_bridge"
        ? "The connected workspace could not route the request."
        : `${targetAgent.displayName} is not ready to run right now. Ask me who can handle it again.`
    };
  }

  ctx.store.recordAuditEvent({
    kind: "communication_agent_route_dispatched",
    actorType: "agent",
    actorId: input.assistant.id,
    resourceType: "agent",
    resourceId: targetAgent.id,
    serverId: input.serverId,
    metadata: {
      requestedByUserId: requestingUserId,
      executionCapabilityUserId: input.userId,
      ...(input.conversationId ? { sourceConversationId: input.conversationId } : {}),
      ...(handoffConversation ? { handoffConversationId: handoffConversation.id } : {}),
      handoffMessageId: handoffMessage.id,
      instruction,
      ...(input.executionPolicy ? {
        heartbeatExecutionPolicy: {
          heartbeatId: input.executionPolicy.heartbeatId,
          runId: input.executionPolicy.runId,
          scheduledFor: input.executionPolicy.scheduledFor
        }
      } : {})
    }
  });
  ctx.store.recordActivity(
    input.assistant.id,
    "routing",
    queuedBehindActiveTurn
      ? `Queued request for ${targetAgent.displayName}.`
      : `Routed request to ${targetAgent.displayName}.`
  );
  return {
    content: input.publicReplyAudience === "workspace_bridge"
      ? publicReplyContent
      : queuedBehindActiveTurn
        ? `Queued for ${targetAgent.displayName}. It is finishing its current work, and I will report back here when this request completes.\n${instruction}`
        : `Routed to ${targetAgent.displayName}. I will report back here when it responds.\n${instruction}`,
    executionIds: [execution.id],
    messageId: handoffMessage.id
  };
}
