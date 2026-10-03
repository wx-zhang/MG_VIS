import type {
  AgentDelegateRecord,
  AgentDelegateResultPayload,
  AgentDelegationReturnMode,
  AgentDelegationTransport,
  AgentRecord,
  MessageRecord,
  RuntimeExecutionRecord
} from "@tyr-ai/contracts";
import type { GovernanceSourceTag } from "@tyr-ai/governance";
import {
  blockedSubjectId,
  governanceBlockedResponse,
  prepareDelegationGovernance
} from "./governance-outbound";
import {
  delegationAttachmentsNeedPairGrant,
  governanceSourceForDelegationAttachment,
  prepareDelegationAttachmentIds,
  resolveDelegationAttachmentSources
} from "./agent-delegation-attachments";
import { resolveEffectiveGovernanceRuntimeConfig } from "./governance-policy";
import { outboundApprovalRequiredResponse, queueOutboundApproval, shouldAutoApproveOutboundApproval, shouldQueueOutboundApproval } from "./outbound-approval-queue";
import type { ServerRouteContext } from "./server-context";

const MAX_AGENT_RETURN_HOPS = 5;

export type AgentDelegationServiceInput = {
  sourceAgent: AgentRecord;
  targetAgent: unknown;
  instruction: string;
  attachmentIds?: string[];
  sourceExecutionId?: string;
  sourceMessageId?: string;
  returnMode?: AgentDelegationReturnMode;
  expectReply?: unknown;
  transport: AgentDelegationTransport;
  skipGovernance?: boolean;
};

export type AgentDelegationServiceSuccess = {
  ok: true;
  delegation: AgentDelegateRecord;
  execution: RuntimeExecutionRecord;
};

type AgentDelegationServiceError = Extract<AgentDelegateResultPayload, { ok: false }>["error"];

export type AgentDelegationServiceFailure = {
  ok: false;
  status: number;
  error: AgentDelegationServiceError;
  detail?: string;
  body?: unknown;
};

export type AgentDelegationServiceResult = AgentDelegationServiceSuccess | AgentDelegationServiceFailure;

export function delegateAgentExecution(ctx: ServerRouteContext, input: AgentDelegationServiceInput): AgentDelegationServiceResult {
  const { store } = ctx;
  const targetAgent = resolveDelegationTarget(ctx, input.sourceAgent, input.targetAgent);
  if (!targetAgent) return { ok: false, status: 404, error: "agent_not_found" };
  if (targetAgent.id === input.sourceAgent.id) return { ok: false, status: 400, error: "delegation_target_invalid" };

  const instruction = String(input.instruction || "").trim();
  if (!instruction) return { ok: false, status: 400, error: "instruction_required" };

  const sourceExecutionId = normalizedOptionalString(input.sourceExecutionId);
  const sourceExecution = sourceExecutionId ? trustedExecutionForAgent(ctx, input.sourceAgent, sourceExecutionId) : null;
  if (sourceExecutionId && !sourceExecution) return { ok: false, status: 404, error: "source_execution_not_found" };

  const sourceMessageId = normalizedOptionalString(input.sourceMessageId);
  let sourceMessage: MessageRecord | null = null;
  if (sourceMessageId) {
    sourceMessage = store.getMessage(sourceMessageId);
    if (!sourceMessage || !store.canAgentAccessChannel(input.sourceAgent.id, sourceMessage.channelId)) {
      return { ok: false, status: 404, error: "source_message_not_found" };
    }
  }
  const attachmentSources = resolveDelegationAttachmentSources(ctx, input.sourceAgent, input.attachmentIds);
  if (!attachmentSources) return { ok: false, status: 404, error: "attachment_not_found" };
  const attachmentNeedsPairGrant = delegationAttachmentsNeedPairGrant(ctx, targetAgent, attachmentSources);

  const serverId = agentServerId(ctx, input.sourceAgent);
  const governance = input.skipGovernance ? null : prepareDelegationGovernance({
    store,
    config: resolveEffectiveGovernanceRuntimeConfig({
      store,
      baseConfig: ctx.governanceConfig,
      serverId,
      agentId: input.sourceAgent.id
    }).config,
    agent: input.sourceAgent,
    targetAgent,
    serverId,
    message: {
      target: `delegate:@${targetAgent.name}`,
      targetChannelId: `agent:${targetAgent.id}`,
      content: instruction,
      executeMentions: false,
      // A same-server delegation can still move source-only attachments into a pair DM, so governance treats that as cross-context.
      delegation: { sameServer: !attachmentNeedsPairGrant, sourceAgentId: input.sourceAgent.id, targetAgentId: targetAgent.id },
      sourceContexts: [
        ...(sourceMessage ? [governanceSourceForDelegationMessage(sourceMessage)] : []),
        ...attachmentSources.map(governanceSourceForDelegationAttachment)
      ]
    }
  });
  if (governance?.blocked && !shouldAutoApproveOutboundApproval({ agent: input.sourceAgent, governance })) {
    if (shouldQueueOutboundApproval(governance)) {
      const { approval, decision } = queueOutboundApproval(ctx, {
        agent: input.sourceAgent,
        governance,
        action: {
          kind: "agent_delegation",
          serverId,
          targetAgentId: targetAgent.id,
          instruction,
          sourceExecutionId: sourceExecution?.id,
          sourceMessageId: sourceMessage?.id,
          attachmentIds: attachmentSources.map((attachment) => attachment.id),
          returnMode: input.returnMode,
          expectReply: input.expectReply !== false,
          transport: input.transport
        },
        context: {
          executionId: sourceExecution?.id,
          taskId: sourceExecution?.taskId,
          messageId: sourceExecution?.messageId ?? sourceMessage?.id,
          threadChannelId: sourceExecution?.threadChannelId
        }
      });
      return { ok: false, status: 409, error: "delegation_governance_blocked", body: outboundApprovalRequiredResponse(approval, governance, decision) };
    }
    const decision = governance.record?.(blockedSubjectId("message_send"));
    if (decision) ctx.emitRealtimeGovernanceDecision?.(decision);
    return { ok: false, status: 403, error: "delegation_governance_blocked", body: governanceBlockedResponse(decision ?? governance.decision, governance.caseSummary) };
  }

  const pair = store.getOrCreateAgentPairDm(input.sourceAgent.id, targetAgent.name, serverId);
  if (!pair || !store.canAgentAccessChannel(targetAgent.id, pair.id)) {
    return { ok: false, status: 403, error: "target_agent_not_reachable" };
  }
  const delegatedAttachmentIds = prepareDelegationAttachmentIds(ctx, targetAgent, pair.id, attachmentSources);

  const message = store.createDelegationMessage({
    channelId: pair.id,
    serverId,
    senderAgent: input.sourceAgent,
    targetAgent,
    instruction,
    attachmentIds: delegatedAttachmentIds
  });
  const hopCount = (sourceExecution?.hopCount ?? 0) + 1;
  // expectReply controls the automatic return wake chain; keep the hop cap server-side so daemon/CLI cannot create loops.
  const expectReply = input.expectReply !== false && hopCount <= MAX_AGENT_RETURN_HOPS;
  const execution = ctx.createAndEnqueueDelegationRun(input.sourceAgent, targetAgent, message, `Starting @${targetAgent.name} from explicit delegation.`, {
    orchestration: {
      sourceExecutionId: sourceExecution?.id,
      returnToAgentId: expectReply ? input.sourceAgent.id : undefined,
      rootMessageId: sourceExecution?.rootMessageId ?? sourceExecution?.messageId ?? sourceMessageId ?? message.id,
      hopCount,
      expectReply
    }
  }) as RuntimeExecutionRecord | null;
  if (!execution) return { ok: false, status: 409, error: "target_agent_not_ready" };

  if (input.returnMode === "origin") {
    store.appendRuntimeExecutionEvent({
      executionId: execution.id,
      agentId: targetAgent.id,
      kind: "diagnostic",
      title: "Return mode",
      detail: "Delegation return mode: origin.",
      payload: { returnMode: input.returnMode }
    });
  }
  store.appendRuntimeExecutionEvent({
    executionId: execution.id,
    agentId: targetAgent.id,
    kind: "diagnostic",
    title: "Delegation transport",
    detail: `Delegation transport: ${input.transport}.`,
    payload: { transport: input.transport }
  });
  if (governance?.record) {
    const decision = governance.record(execution.id, {
      executionId: execution.id,
      messageId: message.id
    });
    ctx.emitRealtimeGovernanceDecision?.(decision);
  }
  ctx.deliverPendingToOnlineAgents();
  return {
    ok: true,
    delegation: {
      executionId: execution.id,
      messageId: message.id,
      channelId: message.channelId,
      targetAgentId: targetAgent.id,
      sourceExecutionId: execution.sourceExecutionId,
      rootMessageId: execution.rootMessageId ?? message.id,
      returnToAgentId: execution.returnToAgentId,
      hopCount: execution.hopCount ?? hopCount,
      expectReply: Boolean(execution.expectReply)
    },
    execution
  };
}

function normalizedOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function agentServerId(ctx: ServerRouteContext, agent: AgentRecord): string {
  return String(ctx.serverIdForAgent(agent));
}

function trustedExecutionForAgent(ctx: ServerRouteContext, agent: AgentRecord, executionId: string): RuntimeExecutionRecord | null {
  const execution = ctx.store.getRuntimeExecution(executionId);
  return execution?.agentId === agent.id ? execution : null;
}

function governanceSourceForDelegationMessage(message: MessageRecord): GovernanceSourceTag {
  return {
    sourceType: message.senderType === "agent" ? "agent_action" : "channel_message",
    sourceTrust: message.senderType === "agent" ? "agent_action" : "untrusted_external",
    sourceId: message.id,
    channelId: message.channelId,
    messageId: message.id,
    threadChannelId: message.threadId,
    propagation: ["delegation_source_message"]
  };
}

function resolveDelegationTarget(ctx: ServerRouteContext, agent: AgentRecord, value: unknown): AgentRecord | null {
  const raw = typeof value === "string" ? value.trim().replace(/^@/, "") : "";
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  return ctx.store.listAgents(agentServerId(ctx, agent)).find((candidate) => (
    candidate.id === raw ||
    candidate.name.toLowerCase() === normalized ||
    candidate.displayName.toLowerCase() === normalized
  )) ?? null;
}
