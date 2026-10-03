import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import type {
  AgentRecord,
  AttachmentRecord,
  ChannelRecord,
  GovernanceDecisionRecord,
  MessageRecord,
  RuntimeApprovalDecision,
  RuntimeApprovalRecord,
  RuntimeExecutionRecord
} from "@tyr-ai/contracts";
import type { GovernanceSourceTag } from "@tyr-ai/governance";
import type { PreparedOutboundGovernance, GovernanceSubjectContext } from "./governance-outbound";
import {
  prepareDelegationAttachmentIds,
  resolveDelegationAttachmentSources
} from "./agent-delegation-attachments";
import { isTerminalRuntimeExecutionStatus } from "./message-deletion";
import type { RuntimeApprovalResolveBlocked } from "./runtime-approval-resolve";
import type { ServerRouteContext } from "./server-context";

const OUTBOUND_APPROVAL_VERSION = 1;

type MessageSendOutboundAction = {
  kind: "message_send";
  serverId: string;
  target: string;
  targetChannelId: string;
  content: string;
  attachmentIds: string[];
  quoteMessageId?: string;
  executeMentions: boolean;
  sourceExecutionId?: string;
  finalExecutionId?: string;
};

type AttachmentUploadOutboundAction = {
  kind: "attachment_upload";
  serverId: string;
  channelId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  path: string;
  sourcePath?: string;
  sourceExecutionId?: string;
};

type AgentDelegationOutboundAction = {
  kind: "agent_delegation";
  serverId: string;
  targetAgentId: string;
  instruction: string;
  attachmentIds: string[];
  sourceExecutionId?: string;
  sourceMessageId?: string;
  returnMode?: "delegator" | "origin";
  expectReply?: boolean;
  transport: "daemon_native" | "internal_api" | "mcp_compat" | "cli_server_fallback";
};

export type QueuedOutboundAction = MessageSendOutboundAction | AttachmentUploadOutboundAction | AgentDelegationOutboundAction;

type QueuedOutboundApprovalPayload = {
  outboundApproval: {
    version: typeof OUTBOUND_APPROVAL_VERSION;
    action: QueuedOutboundAction;
  };
  governance?: Record<string, unknown>;
  approvalClassification: "side_effect";
  approvalNonBlocking: false;
};

export type OutboundApprovalRequiredResponse = {
  error: "outbound_approval_required";
  code: "OUTBOUND_APPROVAL_REQUIRED";
  approvalId: string;
  action: QueuedOutboundAction["kind"];
  decision: GovernanceDecisionRecord["decision"];
  reason: string;
  riskTypes: string[];
  governanceDecisionId?: string;
  sourceTags?: GovernanceSourceTag[];
};

export type QueuedOutboundApprovalResolveResult =
  | {
      handled: true;
      delivered: false;
      outboundResult?: unknown;
    }
  | RuntimeApprovalResolveBlocked;

export function shouldQueueOutboundApproval(governance: PreparedOutboundGovernance | null | undefined): boolean {
  return Boolean(governance?.blocked && governance.record && governance.decision.decision === "require_human");
}

export function shouldAutoApproveOutboundApproval(input: {
  agent: Pick<AgentRecord, "permissionMode">;
  governance: PreparedOutboundGovernance | null | undefined;
}): boolean {
  return input.agent.permissionMode === "dev-full-access"
    && Boolean(input.governance?.blocked && input.governance.decision.decision === "require_human");
}

export function hasPendingQueuedOutboundApproval(approvals: readonly RuntimeApprovalRecord[]): boolean {
  return approvals.some((approval) => approval.status === "pending" && queuedOutboundAction(approval) !== null);
}

export function queueOutboundApproval(
  ctx: ServerRouteContext,
  input: {
    agent: AgentRecord;
    governance: PreparedOutboundGovernance;
    action: QueuedOutboundAction;
    context?: GovernanceSubjectContext;
  }
): { approval: RuntimeApprovalRecord; decision?: GovernanceDecisionRecord } {
  if (!input.agent.machineId || !input.agent.runtime) throw new Error("agent_runtime_required");
  const approvalId = `approval_outbound_${randomUUID().replaceAll("-", "")}`;
  const payload = outboundApprovalPayload(input.governance, input.action);
  const approval = ctx.store.createRuntimeApproval({
    id: approvalId,
    serverId: input.action.serverId,
    machineId: input.agent.machineId,
    agentId: input.agent.id,
    executionId: input.context?.executionId,
    taskId: input.context?.taskId,
    messageId: input.context?.messageId,
    threadChannelId: input.context?.threadChannelId,
    runtime: input.agent.runtime,
    requestId: approvalId,
    method: `governance/outbound/${input.action.kind}/requestApproval`,
    kind: "external_tool",
    title: outboundApprovalTitle(input.action),
    detail: outboundApprovalDetail(input.action),
    payload,
    status: "pending",
    requestedAt: new Date().toISOString()
  });
  const decision = input.governance.record?.(approval.id, {
    ...input.context,
    approvalId: approval.id
  });
  if (approval.executionId) {
    // Outbound action 已由 server 持久化，等待的是人工决定而不是仍在运行的 CLI 进程。
    const waiting = ctx.store.updateRuntimeExecutionStatus(approval.executionId, "waiting_approval");
    if (waiting) ctx.emitRealtimeRuntimeExecution?.(waiting);
  }
  ctx.emitRealtimeRuntimeApproval?.(approval);
  ctx.notifyPendingRuntimeApprovalExternal?.(approval);
  if (decision) ctx.emitRealtimeGovernanceDecision?.(decision);
  return { approval, decision };
}

export function outboundApprovalRequiredResponse(
  approval: RuntimeApprovalRecord,
  governance: PreparedOutboundGovernance,
  decision?: GovernanceDecisionRecord
): OutboundApprovalRequiredResponse {
  const action = queuedOutboundAction(approval);
  const sourceTags = sourceTagsFromCaseSummary(governance.caseSummary);
  return {
    error: "outbound_approval_required",
    code: "OUTBOUND_APPROVAL_REQUIRED",
    approvalId: approval.id,
    action: action?.kind ?? "message_send",
    decision: governance.decision.decision,
    reason: governance.decision.reason,
    riskTypes: governance.decision.riskTypes,
    ...(decision ? { governanceDecisionId: decision.id } : {}),
    ...(sourceTags.length ? { sourceTags } : {})
  };
}

export function resolveQueuedOutboundApproval(
  ctx: ServerRouteContext,
  approval: RuntimeApprovalRecord,
  decision: RuntimeApprovalDecision,
  customResponse?: string
): QueuedOutboundApprovalResolveResult | null {
  const action = queuedOutboundAction(approval);
  if (!action) return null;
  if (decision !== "approve") {
    cleanupRejectedOutboundAction(action);
    return {
      handled: true,
      delivered: false,
      outboundResult: { action: action.kind, status: decision === "custom" ? "custom" : "rejected", customResponse }
    };
  }
  try {
    return {
      handled: true,
      delivered: false,
      outboundResult: replayQueuedOutboundAction(ctx, approval, action)
    };
  } catch (err) {
    return {
      blocked: true,
      status: 409,
      body: {
        error: "approval_outbound_replay_failed",
        reason: err instanceof Error ? err.message : "Queued outbound action could not be replayed."
      }
    };
  }
}

export function queuedOutboundAction(approval: RuntimeApprovalRecord): QueuedOutboundAction | null {
  const payload = approval.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const outboundApproval = (payload as { outboundApproval?: unknown }).outboundApproval;
  if (!outboundApproval || typeof outboundApproval !== "object" || Array.isArray(outboundApproval)) return null;
  const item = outboundApproval as { version?: unknown; action?: unknown };
  if (item.version !== OUTBOUND_APPROVAL_VERSION) return null;
  return isQueuedOutboundAction(item.action) ? item.action : null;
}

function replayQueuedOutboundAction(ctx: ServerRouteContext, approval: RuntimeApprovalRecord, action: QueuedOutboundAction): unknown {
  if (action.kind === "message_send") return replayQueuedMessageSend(ctx, approval, action);
  if (action.kind === "attachment_upload") return replayQueuedAttachmentUpload(ctx, approval, action);
  return replayQueuedAgentDelegation(ctx, approval, action);
}

function replayQueuedMessageSend(ctx: ServerRouteContext, approval: RuntimeApprovalRecord, action: MessageSendOutboundAction): unknown {
  const agent = requiredAgent(ctx, approval.agentId);
  const channel = requiredChannel(ctx, action.targetChannelId, action.serverId);
  if (!ctx.store.canAgentSendToChannel(agent.id, channel.id)) throw new Error("Agent can no longer send to the target channel.");
  const attachments = action.attachmentIds.map((attachmentId) => requiredAttachment(ctx, agent, attachmentId));
  const result = ctx.store.sendMessage({
    target: channel.id,
    content: action.content,
    senderType: "agent",
    senderId: agent.id,
    senderName: agent.name,
    attachmentIds: attachments.map((attachment) => attachment.id),
    sourceExecutionId: action.sourceExecutionId,
    quoteMessageId: action.quoteMessageId,
    serverId: action.serverId
  });
  ctx.emitRealtimeMessage(result.message);
  const handoffCount = replayMentionHandoffs(ctx, agent, channel, result.message, action);
  const finalExecution = action.finalExecutionId ? ctx.store.getRuntimeExecution(action.finalExecutionId) : null;
  if (finalExecution && !isTerminalRuntimeExecutionStatus(finalExecution.status)) {
    ctx.completeRuntimeExecutionFromFinalMessage?.(finalExecution, result.message);
  }
  const returned = finalExecution
    ? ctx.dispatchReturnToAgentForFinalMessage(finalExecution.id, result.message, { deferCommunicationReturn: handoffCount > 0 })
    : null;
  ctx.deliverPendingToOnlineAgents();
  return {
    action: action.kind,
    messageId: result.message.id,
    executions: [],
    returnExecution: returned?.execution ?? null
  };
}

function replayQueuedAttachmentUpload(ctx: ServerRouteContext, approval: RuntimeApprovalRecord, action: AttachmentUploadOutboundAction): unknown {
  const agent = requiredAgent(ctx, approval.agentId);
  const channel = requiredChannel(ctx, action.channelId, action.serverId);
  if (!ctx.store.canAgentSendToChannel(agent.id, channel.id)) throw new Error("Agent can no longer upload to the target channel.");
  if (!existsSync(action.path)) throw new Error("Queued upload file is no longer available.");
  const attachment = ctx.store.createAttachment({
    channelId: channel.id,
    filename: action.filename,
    mimeType: action.mimeType,
    sizeBytes: action.sizeBytes,
    path: action.path
  });
  return {
    action: action.kind,
    attachmentId: attachment.id,
    filename: attachment.filename,
    sizeBytes: attachment.sizeBytes
  };
}

function replayQueuedAgentDelegation(ctx: ServerRouteContext, approval: RuntimeApprovalRecord, action: AgentDelegationOutboundAction): unknown {
  const sourceAgent = requiredAgent(ctx, approval.agentId);
  const targetAgent = requiredAgent(ctx, action.targetAgentId);
  if (targetAgent.id === sourceAgent.id) throw new Error("Delegation target is invalid.");
  const attachments = resolveDelegationAttachmentSources(ctx, sourceAgent, action.attachmentIds);
  if (!attachments) throw new Error("Delegation attachment no longer exists or is inaccessible.");
  const pair = ctx.store.getOrCreateAgentPairDm(sourceAgent.id, targetAgent.name, action.serverId);
  if (!pair || !ctx.store.canAgentAccessChannel(targetAgent.id, pair.id)) throw new Error("Target agent is no longer reachable.");
  const attachmentIds = prepareDelegationAttachmentIds(ctx, targetAgent, pair.id, attachments);
  const message = ctx.store.createDelegationMessage({
    channelId: pair.id,
    serverId: action.serverId,
    senderAgent: sourceAgent,
    targetAgent,
    instruction: action.instruction,
    attachmentIds
  });
  const sourceExecution = action.sourceExecutionId ? ctx.store.getRuntimeExecution(action.sourceExecutionId) : null;
  const hopCount = (sourceExecution?.hopCount ?? 0) + 1;
  const expectReply = action.expectReply !== false && hopCount <= 5;
  const execution = ctx.createAndEnqueueDelegationRun(sourceAgent, targetAgent, message, `Starting @${targetAgent.name} from explicit delegation.`, {
    orchestration: {
      sourceExecutionId: sourceExecution?.id,
      returnToAgentId: expectReply ? sourceAgent.id : undefined,
      rootMessageId: sourceExecution?.rootMessageId ?? sourceExecution?.messageId ?? action.sourceMessageId ?? message.id,
      hopCount,
      expectReply
    }
  }) as RuntimeExecutionRecord | null;
  if (!execution) throw new Error("Target agent is not ready.");
  if (action.returnMode === "origin") {
    ctx.store.appendRuntimeExecutionEvent({
      executionId: execution.id,
      agentId: targetAgent.id,
      kind: "diagnostic",
      title: "Return mode",
      detail: "Delegation return mode: origin.",
      payload: { returnMode: action.returnMode }
    });
  }
  ctx.store.appendRuntimeExecutionEvent({
    executionId: execution.id,
    agentId: targetAgent.id,
    kind: "diagnostic",
    title: "Delegation transport",
    detail: `Delegation transport: ${action.transport}.`,
    payload: { transport: action.transport }
  });
  ctx.deliverPendingToOnlineAgents();
  return {
    action: action.kind,
    executionId: execution.id,
    messageId: message.id,
    channelId: message.channelId,
    targetAgentId: targetAgent.id
  };
}

function replayMentionHandoffs(
  ctx: ServerRouteContext,
  agent: AgentRecord,
  channel: ChannelRecord,
  message: MessageRecord,
  action: MessageSendOutboundAction
): number {
  if (!action.executeMentions) return 0;
  const sourceExecution = action.sourceExecutionId ? ctx.store.getRuntimeExecution(action.sourceExecutionId) : null;
  const dmPeerAgent = pairDmPeerForChannel(ctx, agent, channel);
  const mentionedAgents = dmPeerAgent
    ? [dmPeerAgent]
    : ctx.mentionedAgentsForContent(action.content, action.serverId)
      .filter((item) => item.id !== agent.id && ctx.store.canAgentAccessChannel(item.id, channel.id));
  const threadTask = channel.type === "thread" && channel.parentChannelId && channel.parentMessageId
    ? ctx.store.listTasks(channel.parentChannelId).find((item) => item.messageId === channel.parentMessageId)
    : undefined;
  const canExecuteMentionInTarget = channel.type === "dm" ? Boolean(dmPeerAgent) : channel.type !== "thread" || Boolean(threadTask);
  if (!canExecuteMentionInTarget) return 0;
  const task = ctx.taskForWakeMessage(message);
  let handoffCount = 0;
  for (const mentionedAgent of mentionedAgents) {
    const orchestration = handoffOrchestration(agent, sourceExecution, message);
    let execution = null;
    if (task) {
      execution = ctx.createAndEnqueueThreadHandoffRun(mentionedAgent, task, message, `Starting @${mentionedAgent.name} from thread handoff.`, orchestration);
    } else if (message.channelType !== "thread") {
      const detail = message.channelType === "dm"
        ? `Starting @${mentionedAgent.name} from agent DM handoff.`
        : `Starting @${mentionedAgent.name} from visible message handoff.`;
      execution = ctx.createAndEnqueueMessageHandoffRun(mentionedAgent, message, detail, orchestration);
    }
    if (execution) handoffCount += 1;
  }
  return handoffCount;
}

function outboundApprovalPayload(governance: PreparedOutboundGovernance, action: QueuedOutboundAction): QueuedOutboundApprovalPayload {
  const policy = governance.caseSummary?.policy && typeof governance.caseSummary.policy === "object"
    ? governance.caseSummary.policy as { version?: unknown; source?: unknown; scope?: unknown }
    : {};
  return {
    outboundApproval: {
      version: OUTBOUND_APPROVAL_VERSION,
      action
    },
    governance: {
      decision: governance.decision.decision,
      mode: governance.mode,
      model: "deterministic",
      policyVersion: typeof policy.version === "string" ? policy.version : undefined,
      policySource: typeof policy.source === "string" ? policy.source : undefined,
      policyScope: typeof policy.scope === "string" ? policy.scope : undefined,
      decisionSource: "deterministic",
      confidence: governance.decision.confidence,
      riskTypes: governance.decision.riskTypes,
      reason: governance.decision.reason,
      evidence: governance.decision.evidence,
      sourceTags: sourceTagsFromCaseSummary(governance.caseSummary)
    },
    approvalClassification: "side_effect",
    approvalNonBlocking: false
  };
}

function outboundApprovalTitle(action: QueuedOutboundAction): string {
  if (action.kind === "message_send") return "Send message";
  if (action.kind === "attachment_upload") return "Upload attachment";
  return "Delegate agent";
}

function outboundApprovalDetail(action: QueuedOutboundAction): string {
  if (action.kind === "message_send") return `Send message to ${action.target}`;
  if (action.kind === "attachment_upload") return `Upload ${action.filename}`;
  return `Delegate to ${action.targetAgentId}`;
}

function sourceTagsFromCaseSummary(caseSummary: Record<string, unknown>): GovernanceSourceTag[] {
  const sourceTags = caseSummary.sourceTags;
  return Array.isArray(sourceTags) ? sourceTags as GovernanceSourceTag[] : [];
}

function cleanupRejectedOutboundAction(action: QueuedOutboundAction): void {
  if (action.kind !== "attachment_upload") return;
  try {
    unlinkSync(action.path);
  } catch {
    // The temp file may already be gone; rejection cleanup is best effort.
  }
}

function requiredAgent(ctx: ServerRouteContext, agentId: string): AgentRecord {
  const agent = ctx.store.getAgent(agentId);
  if (!agent) throw new Error("Agent no longer exists.");
  return agent;
}

function requiredChannel(ctx: ServerRouteContext, channelId: string, serverId: string): ChannelRecord {
  const channel = ctx.store.resolveTarget(channelId, serverId);
  if (!channel) throw new Error("Target channel no longer exists.");
  return channel;
}

function requiredAttachment(ctx: ServerRouteContext, agent: AgentRecord, attachmentId: string): AttachmentRecord {
  const attachment = ctx.store.getAttachment(attachmentId);
  if (!attachment || !ctx.store.canAgentAccessChannel(agent.id, attachment.channelId)) throw new Error("Attachment no longer exists or is inaccessible.");
  return attachment;
}

function pairDmPeerForChannel(ctx: ServerRouteContext, agent: AgentRecord, channel: ChannelRecord): AgentRecord | null {
  if (channel.type !== "dm") return null;
  const members = ctx.store.listChannelMembers(channel.id, channel.serverId ?? String(ctx.serverIdForAgent(agent)))?.agents.filter((member) => member.joined) ?? [];
  if (!members.some((member) => member.id === agent.id)) return null;
  return members.find((member) => member.id !== agent.id) ?? null;
}

function handoffOrchestration(agent: AgentRecord, sourceExecution: RuntimeExecutionRecord | null, handoffMessage: MessageRecord) {
  const hopCount = (sourceExecution?.hopCount ?? 0) + 1;
  const canReturn = hopCount <= 5;
  return {
    orchestration: {
      sourceExecutionId: sourceExecution?.id,
      returnToAgentId: canReturn ? agent.id : undefined,
      rootMessageId: sourceExecution?.rootMessageId ?? sourceExecution?.messageId ?? handoffMessage.id,
      hopCount,
      expectReply: canReturn
    }
  };
}

function isQueuedOutboundAction(value: unknown): value is QueuedOutboundAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.kind === "message_send") {
    return typeof item.serverId === "string"
      && typeof item.target === "string"
      && typeof item.targetChannelId === "string"
      && typeof item.content === "string"
      && Array.isArray(item.attachmentIds)
      && typeof item.executeMentions === "boolean";
  }
  if (item.kind === "attachment_upload") {
    return typeof item.serverId === "string"
      && typeof item.channelId === "string"
      && typeof item.filename === "string"
      && typeof item.mimeType === "string"
      && typeof item.sizeBytes === "number"
      && typeof item.path === "string";
  }
  if (item.kind === "agent_delegation") {
    return typeof item.serverId === "string"
      && typeof item.targetAgentId === "string"
      && typeof item.instruction === "string"
      && Array.isArray(item.attachmentIds)
      && typeof item.transport === "string";
  }
  return false;
}
