import { createHash } from "node:crypto";
import { effectiveAssistantToolSteps } from "./assistant-evidence-review";
import {
  buildTyrAssistantHelpEntries,
  findTyrAssistantOperationById,
  isCommunicationAgent,
  runtimeDisplayName,
  type AgentRecord,
  type CommunicationAgentProgressPhase,
  type CommunicationEvidenceSelection,
  type CrossWorkspaceMessageRecord,
  type DeviceRecord,
  type MachineRecord,
  type MessageResult,
  type MessageRecord,
  type RuntimeExecutionRecord,
  type RuntimeReport,
  type WorkspaceBridgeRequestStatusPayload
} from "@tyr-ai/contracts";
import {
  formatAgentDetailsAmbiguousReply,
  formatAgentDetailsReply,
  parseAgentDetailsQuery,
  resolveAgentDetailsCandidates,
  type AgentDetailsCandidate
} from "./agent-details-query";
import {
  ASSISTANT_LLM_REQUEST_TIMEOUT_MS,
  ASSISTANT_TOOL_LOOP_TOTAL_TIMEOUT_MS,
  assistantLlmFailureDiagnostics,
  requestAssistantLlmDecision,
  requestAssistantToolLoop,
  type AssistantDecision,
  type AssistantLlmContext,
  type AssistantToolLoopExecutionOutcome,
  type AssistantToolLoopResult
} from "./assistant-llm";
import {
  buildAssistantPublicReply,
  enforceAssistantPublicAgentIdVisibility,
  type AssistantPublicError
} from "./assistant-public-reply";
import { groundPresentedWeekdays } from "./assistant-presentation-calendar";
import { executeTyrAssistantTool } from "./assistant-tool-executor";
import { findTyrAssistantTool, type TyrAssistantToolResult } from "./assistant-tools";
import { beginCommunicationAgentAction, handleCommunicationAgentAction, type CommunicationAgentActionIntent } from "./communication-agent-actions";
import { beginBridgeContinuationWriteStep, finishBridgeContinuationWriteStep } from "./bridge-continuation-journal";
import { dispatchCommunicationAgentHandoff } from "./communication-agent-handoff";
import { completedFrozenBridgeStep, getCommunicationRouteIntent, restaurantClarificationForMessage, resumedRestaurantBookingContent } from "./communication-route-intent";
import { bridgeRouteIntentPredatesCutover, getBridgeRouteIntent } from "./bridge-route-intent";
import { CommunicationRoutePlanningError, prepareInitialCommunicationRoute, routeClarification, verifyIncomingBridgeLocalRequest } from "./communication-route-planning";
import { verifiedCommunicationOriginAction, verifiedCommunicationOriginNoticeRequest } from "./communication-origin-route";
import { answerCommunicationOriginConfirmation } from "./communication-origin-confirmation";
import { webCommunicationAgentSourceContext, type CommunicationAgentSourceContext } from "./communication-agent-source";
import { createMachineOnboardingLink } from "./machine-onboarding-service";
import type { ServerRouteContext } from "./server-context";
import { workspaceBridgeCommunicationReturnExternalRef, workspaceBridgeRefForExecution } from "./workspace-bridge-delivery";
import { markImmediateWorkspaceBridgeExternalReturn } from "./workspace-bridge-external-return";
import { mcpAuthorizationFailureMessage, restoreMcpCommunicationAuthority } from "./mcp-communication-authority";
import { allowedWorkerWorkspacePaths } from "./assistant-workspace-path-disclosure";
import { buildAssistantLlmContext } from "./assistant-llm-context";
import { recoverCompletedWorkerResults } from "./assistant-completed-worker-results";
import { communicationWorkerOutcome } from "./communication-worker-outcome";
import { listCommunicationEvidenceForContext, selectCommunicationEvidenceForContext } from "./communication-evidence";

const DEFAULT_ONBOARDING_MACHINE_NAME = "New Device";
const MAX_COMMUNICATION_AGENT_CONTINUATION_STEPS = 8;
type CommunicationAgentInventoryCommand = "help" | "status" | "list_computers" | "list_agents" | "list_inventory";
type CommunicationAgentPendingActionCommand = "confirm" | "cancel";
interface CommunicationAgentReplyDraft {
  content: string;
  replySuppressed?: boolean;
  messageId?: string;
  pendingActionId?: string;
  executionIds?: string[];
  bridgeRequestIds?: string[];
  bridgeRequestAttemptCount?: number;
  bridgeRequestPending?: boolean;
  result?: MessageResult;
  outcomeStatus?: "completed" | "partial" | "failed" | "running";
  allowedAgentIds?: string[];
  error?: AssistantPublicError;
  rejectedBridgeDestination?: boolean;
  evidenceSelections?: CommunicationEvidenceSelection[];
}
export type CommunicationAgentContinuationDraft = CommunicationAgentReplyDraft;

function blockedVisibilityDraft(draft: CommunicationAgentReplyDraft, content: string, sourceMessageId: string): CommunicationAgentReplyDraft {
  return {
    ...draft,
    content,
    outcomeStatus: "failed",
    result: {
      version: 1,
      status: "failed",
      title: "TYR could not present the response",
      summary: content,
      body: content,
      communicationRequest: { sourceMessageId }
    }
  };
}

function blockedMcpAuthorizationDraft(content: string, sourceMessageId: string): CommunicationAgentReplyDraft {
  return {
    content,
    outcomeStatus: "failed",
    result: {
      version: 1, status: "failed", title: "MCP authorization needs attention", summary: content, body: content,
      communicationRequest: { sourceMessageId }
    }
  };
}

function groundContinuationDraftWeekdays(draft: CommunicationAgentReplyDraft, returnedResult: string): CommunicationAgentReplyDraft {
  return {
    ...draft,
    content: groundPresentedWeekdays(draft.content, returnedResult),
    ...(draft.result ? { result: {
      ...draft.result,
      summary: groundPresentedWeekdays(draft.result.summary, returnedResult),
      ...(draft.result.body ? { body: groundPresentedWeekdays(draft.result.body, returnedResult) } : {})
    } } : {})
  };
}

export interface CommunicationAgentReplyOutcome {
  replySuppressed?: boolean;
  error?: AssistantPublicError;
  bridgeRequestIds?: string[];
  status?: "completed" | "partial" | "failed" | "running";
}
interface CommunicationAgentReturnTarget {
  source: "web" | "email" | "telegram";
  externalRef?: string;
}
interface RoutingCandidate {
  agent: AgentRecord;
  machine: MachineRecord | undefined;
  score: number;
  reasons: string[];
  statusLabel: string;
}

interface CommunicationAgentProgressContext {
  assistant: AgentRecord;
  channelId: string;
  conversationId?: string;
  sourceMessageId: string;
  sourceContext: CommunicationAgentSourceContext;
  progressStartedAt: string;
  progressState: {
    phase?: CommunicationAgentProgressPhase;
    label?: string;
  };
}

const COMMUNICATION_AGENT_TOOL_PROGRESS_LABELS: Record<string, string> = {
  get_workspace_status: "Checking workspace status...",
  list_workspace_inventory: "Checking workspace inventory...",
  list_computers: "Checking Devices...",
  get_computer_details: "Checking Device details...",
  create_computer_onboarding: "Preparing Device onboarding...",
  rename_computer: "Renaming the Device...",
  detect_runtime_models: "Checking runtime models...",
  list_agents: "Checking Agents...",
  get_agent_details: "Checking Agent details...",
  get_agent_capabilities: "Checking Agent capabilities...",
  get_agent_scopes: "Checking Agent scopes...",
  create_agent: "Creating the Agent...",
  update_agent: "Updating the Agent...",
  start_agent: "Starting the Agent...",
  stop_agent: "Stopping the Agent...",
  restart_agent: "Restarting the Agent...",
  reset_agent: "Resetting the Agent...",
  delete_agent: "Deleting the Agent...",
  start_agents_on_computer: "Starting the Agents...",
  stop_agents_on_computer: "Stopping the Agents...",
  restart_agents_on_computer: "Restarting the Agents...",
  send_instruction_to_agent: "Routing the request...",
  list_heartbeats: "Checking Heartbeats...",
  list_heartbeat_runs: "Checking Heartbeat runs...",
  create_heartbeat: "Creating the Heartbeat...",
  update_heartbeat: "Updating the Heartbeat...",
  enable_heartbeat: "Enabling the Heartbeat...",
  disable_heartbeat: "Pausing the Heartbeat...",
  list_workspace_bridges: "Checking connected workspaces...",
  send_workspace_bridge_message: "Contacting the connected workspace...",
  get_workspace_bridge_request: "Checking the Bridge request..."
};

export function communicationAgentProgressLabelForTool(call: unknown): string {
  const name = call && typeof call === "object" && typeof (call as { name?: unknown }).name === "string"
    ? (call as { name: string }).name
    : "";
  return COMMUNICATION_AGENT_TOOL_PROGRESS_LABELS[name] ?? "Running the requested action...";
}

function emitCommunicationAgentProgress(
  ctx: ServerRouteContext,
  input: CommunicationAgentProgressContext,
  phase: CommunicationAgentProgressPhase,
  label: string
): void {
  // 已认证外部入口已经映射到真实 Tyr conversation，可以共享同一进度；peer Bridge 隐藏会话不对 Human 广播。
  if (input.sourceContext.accessMode === "workspace_bridge") return;
  if (input.progressState.phase === phase && input.progressState.label === label) return;
  const updatedAt = new Date().toISOString();
  try {
    // 进度事件只暴露固定安全文案；广播故障不能影响 Agent 管理操作本身。
    ctx.broadcastRealtime("communication_agent:progress", {
      progress: {
        operationId: input.sourceMessageId,
        sourceMessageId: input.sourceMessageId,
        channelId: input.channelId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        assistantAgentId: input.assistant.id,
        source: input.sourceContext.source,
        phase,
        label,
        startedAt: input.progressStartedAt,
        updatedAt
      }
    }, { channelId: input.channelId });
    input.progressState.phase = phase;
    input.progressState.label = label;
  } catch {
    // 进度反馈是辅助信息，最终持久化消息仍是结果真源。
  }
}

function workspaceBridgeRequestStatusesFromResult(result: AssistantToolLoopResult): WorkspaceBridgeRequestStatusPayload[] {
  const candidates = result.steps.flatMap((step) => {
    const data = step.result?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    const request = (data as { request?: unknown }).request;
    if (!request || typeof request !== "object" || Array.isArray(request)) return [];
    const value = request as Record<string, unknown>;
    if (
      typeof value.bridgeRequestId !== "string" ||
      typeof value.bridgeId !== "string" ||
      typeof value.conversationId !== "string" ||
      typeof value.state !== "string" ||
      typeof value.peerWorkspaceName !== "string" ||
      typeof value.createdAt !== "string" ||
      typeof value.updatedAt !== "string"
    ) return [];
    return [request as WorkspaceBridgeRequestStatusPayload];
  });
  const latestByRequestId = new Map<string, WorkspaceBridgeRequestStatusPayload>();
  for (const candidate of candidates) latestByRequestId.set(candidate.bridgeRequestId, candidate);
  return [...latestByRequestId.values()];
}

function workspaceBridgeRequestAttemptCount(result: AssistantToolLoopResult): number {
  const requestKeys = new Set<string>();
  for (const step of result.steps) {
    const toolName = step.call?.name ?? step.rawCall.name;
    if (toolName !== "send_workspace_bridge_message" && toolName !== "get_workspace_bridge_request") continue;
    requestKeys.add(step.result?.bridgeRequestIds?.[0] ?? `tool-call:${step.rawCall.id}`);
  }
  return requestKeys.size;
}

function workspaceBridgeReplyText(status: WorkspaceBridgeRequestStatusPayload): {
  content: string;
  resultBody: string;
} {
  if (status.state === "needs_attention") {
    const content = status.progress?.summary ?? "The connected workspace request needs attention.";
    return { content, resultBody: content };
  }
  if (status.state === "blocked_on_peer_approval") {
    return {
      // 阻塞可能来自下游 Bridge，来源方不能断言是哪一位 Owner 在审批。
      content: "The request is waiting for approval in a connected workspace.",
      resultBody: "Waiting for approval in a connected workspace."
    };
  }
  if (status.state === "failed") {
    const resultBody = status.error?.message?.trim() || "The Workspace Bridge request failed.";
    return {
      content: `${status.peerWorkspaceName} TYR could not complete the request:\n${resultBody}`,
      resultBody
    };
  }
  const peerReply = status.response?.trim() || status.acknowledgement?.trim();
  if (peerReply) {
    return {
      content: `${status.peerWorkspaceName} TYR replied:\n${peerReply}`,
      resultBody: peerReply
    };
  }
  if (status.state === "completed") {
    return {
      content: `${status.peerWorkspaceName} TYR completed the request without a response.`,
      resultBody: "The request completed without a response."
    };
  }
  return {
    content: `Sent the request to ${status.peerWorkspaceName}. The peer TYR is still working.`,
    resultBody: "The request was sent. The peer TYR is still working."
  };
}

function workspaceBridgeMessageResult(
  status: WorkspaceBridgeRequestStatusPayload,
  resultBody: string,
  sentContent?: string
): MessageResult {
  const terminalStatus = status.state === "failed"
    ? "failed"
    : status.state === "completed"
      ? "completed"
      : "partial";
  return {
    version: 1,
    status: terminalStatus,
    title: terminalStatus === "partial"
      ? "Workspace Bridge request in progress"
      : terminalStatus === "failed"
        ? "Workspace Bridge request failed"
        : "Workspace Bridge response",
    summary: resultBody,
    body: resultBody,
    sourceAgentName: `${status.peerWorkspaceName} TYR`,
    ...(sentContent ? {
      workspaceBridge: {
        bridgeRequestId: status.bridgeRequestId,
        bridgeId: status.bridgeId,
        conversationId: status.conversationId,
        sentContent,
        state: status.state
      }
    } : {})
  };
}

function hasAvailableWorkerAgent(ctx: ServerRouteContext, serverId: string): boolean {
  return ctx.store.listAgents(serverId).some((agent) => {
    if (isCommunicationAgent(agent) || agent.deletedAt || !agent.machineId || !agent.runtime) return false;
    const machine = ctx.store.getMachine(agent.machineId);
    return Boolean(
      machine &&
      !machine.deletedAt &&
      machine.status === "online" &&
      (agent.status === "online" || agent.status === "working")
    );
  });
}

function assistantToolLoopOutcomeStatus(
  result: AssistantToolLoopResult,
  error: AssistantPublicError | undefined,
  bridgePending: boolean
): "completed" | "partial" | "failed" | "running" {
  if (error) return "failed";
  if (result.executionIds.length > 0) return "running";
  const steps = effectiveAssistantToolSteps(result);
  const statuses = steps.flatMap((step) => step.result ? [step.result.status] : []);
  if (statuses.some((status) => status === "confirmation_required" || status === "blocked_on_peer_approval")) return "partial";
  if (bridgePending) return statuses.includes("partial") ? "partial" : "running";
  const otherFailure = steps.some((step) => step.errorCode ||
    ((step.result?.status === "failed" || step.result?.status === "denied" || step.result?.status === "skipped") &&
      (step.result.data as { errorCode?: string } | undefined)?.errorCode !== "route_needs_clarification" &&
      !(result.recoveredInboundOutboundDenial &&
        ["bridge_destination_not_requested", "inbound_bridge_auto_return"].includes(
          (step.result.data as { errorCode?: string } | undefined)?.errorCode ?? ""))));
  if (otherFailure) return "failed";
  if (statuses.includes("partial") || result.steps.some((step) =>
    (step.result?.data as { errorCode?: string } | undefined)?.errorCode === "route_needs_clarification")) return "partial";
  return "completed";
}

function assistantToolCallName(call: unknown): string {
  if (!call || typeof call !== "object" || Array.isArray(call)) return "unknown";
  const name = (call as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : "unknown";
}

function assistantToolIsReadOnly(toolName: string): boolean {
  const tool = findTyrAssistantTool(toolName);
  const operation = tool ? findTyrAssistantOperationById(tool.operationId) : undefined;
  // 未登记工具按有副作用处理，避免异常路径提供可能重复写入的快捷重试。
  return operation?.risk === "read_only";
}

function canonicalAssistantToolValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalAssistantToolValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalAssistantToolValue(item)])
  );
}

function assistantSideEffectSignature(call: unknown): string | null {
  if (!call || typeof call !== "object" || Array.isArray(call)) return null;
  const toolName = assistantToolCallName(call);
  if (assistantToolIsReadOnly(toolName)) return null;
  const args = (call as { arguments?: unknown }).arguments;
  return `${toolName}:${JSON.stringify(canonicalAssistantToolValue(args ?? null))}`;
}

function repeatedSideEffectOutcome(
  call: unknown,
  outcome: AssistantToolLoopExecutionOutcome
): AssistantToolLoopExecutionOutcome {
  if (!outcome.ok) return outcome;
  const callId = call && typeof call === "object" && !Array.isArray(call) && typeof (call as { id?: unknown }).id === "string"
    ? (call as { id: string }).id
    : outcome.result.toolCallId;
  return {
    ok: true,
    result: {
      toolCallId: callId,
      toolName: outcome.result.toolName,
      status: "noop",
      message: "This identical workspace action was already accepted during the current request. Reuse the existing result and do not send it again.",
      ...(outcome.result.executionIds ? { executionIds: outcome.result.executionIds } : {}),
      ...(outcome.result.bridgeRequestIds ? { bridgeRequestIds: outcome.result.bridgeRequestIds } : {})
    }
  };
}

function assistantFailureReply(input: {
  code: AssistantPublicError["code"];
  sourceMessageId: string;
  assistantName: string;
  readOnlyMessages: string[];
  sideEffectToolNames: string[];
}): CommunicationAgentReplyDraft {
  const hasPartialReadResult = input.readOnlyMessages.length > 0;
  const hasPossibleSideEffect = input.sideEffectToolNames.length > 0;
  const failureText = hasPossibleSideEffect
    ? "TYR lost the model response after a workspace action was accepted. I won’t retry it automatically; check the current workspace state before sending another instruction."
    : input.code === "assistant_model_timeout"
      ? "TYR timed out before any Workspace Bridge or Agent request was sent. No remote action was performed."
      : input.code === "assistant_provider_error"
        ? "TYR could not reach the model provider before any Workspace Bridge or Agent request was sent. No remote action was performed."
        : "TYR could not finish reasoning before any Workspace Bridge or Agent request was sent. No remote action was performed.";
  const body = [...input.readOnlyMessages, failureText].join("\n\n");
  const status = hasPartialReadResult || hasPossibleSideEffect ? "partial" : "failed";
  return {
    content: body,
    outcomeStatus: status,
    error: { code: input.code },
    result: {
      version: 1,
      status,
      title: status === "partial" ? "TYR request partially completed" : "TYR request failed",
      summary: failureText,
      body,
      sourceAgentName: input.assistantName,
      // 只有没有成功写工具时才允许重新提交原始 Assistant 消息。
      ...(!hasPossibleSideEffect ? { assistantRetry: { sourceMessageId: input.sourceMessageId } } : {})
    }
  };
}

function existingWorkspaceBridgeOriginMessage(
  ctx: ServerRouteContext,
  requestIds: string[] | undefined,
  requestAttemptCount: number | undefined,
  channelId: string,
  conversationId: string | undefined
): MessageRecord | null {
  // 多目标请求的终态各自回写；即使其中一项快速完成，也不能吞掉整批的初始派发回执。
  if ((requestAttemptCount ?? requestIds?.length) !== 1) return null;
  for (const requestId of requestIds ?? []) {
    const request = ctx.store.getCrossWorkspaceMessage(requestId);
    if (!request?.conversationId) continue;
    // A receipt before the latest accepted supplement describes an older turn.
    // Reusing that question after forwarding the answer asks the requester twice.
    // Use persisted event order (including equal timestamps), never text similarity.
    const row = ctx.store.db.prepare(`select id from cross_workspace_messages
      where reply_to_message_id = ? and origin_message_id is not null
        and response_kind in ('final', 'error', 'ack', 'progress', 'question', 'action_request')
        and (response_kind in ('final', 'error') or rowid > coalesce((
          select max(rowid) from cross_workspace_messages
          where reply_to_message_id = ? and response_kind in ('answer', 'instruction', 'continue')
            and outcome != 'failed'
        ), 0))
      order by (response_kind in ('final', 'error')) desc, rowid desc limit 1`)
      .get(request.id, request.id) as { id: string } | undefined;
    const originReply = row ? ctx.store.getCrossWorkspaceMessage(row.id) : null;
    const originMessage = originReply?.originMessageId ? ctx.store.getMessage(originReply.originMessageId) : null;
    if (
      originMessage?.channelId === channelId &&
      (!conversationId || originMessage.conversationId === conversationId)
    ) return originMessage;
  }
  return null;
}

export function parseCommunicationAgentMachineOnboardingIntent(content: string): { name: string } | null {
  const normalized = content.trim();
  if (!normalized) return null;
  const hasEnglishVerb = /\b(add|connect|onboard|pair|setup|set up|create|register)\b/i.test(normalized);
  const hasEnglishDevice = /\b(computer|device|laptop|machine|mac|pc)\b/i.test(normalized);
  const hasChineseIntent = /(添加|新增|连接|接入|绑定|创建).{0,16}(电脑|设备|笔记本|机器)|(电脑|设备|笔记本|机器).{0,16}(添加|新增|连接|接入|绑定|创建)/.test(normalized);
  if (!(hasChineseIntent || (hasEnglishVerb && hasEnglishDevice))) return null;
  return { name: extractRequestedMachineName(normalized) ?? DEFAULT_ONBOARDING_MACHINE_NAME };
}

export function communicationAgentReplyText(
  content: string,
  options: { interactionMode?: AssistantLlmContext["interactionMode"] } = {}
): string {
  const normalized = content.trim().toLowerCase();
  if (options.interactionMode === "workspace_bridge") {
    const greeting = normalized.replace(/[.!?。！？]+$/g, "").trim();
    if (/^(hi|hello|hey|你好|您好|嗨)$/i.test(greeting)) return "Hi! How can I help?";
    // Bridge 的无模型回退也保持普通对话口吻，不能主动暴露连接实现。
    return "I'm ready to help. What would you like me to do?";
  }
  if (normalized.includes("computer") || normalized.includes("device") || normalized.includes("电脑") || normalized.includes("设备")) {
    return "I can help route workspace requests. Ask me to add or onboard a device and I will create a short-lived onboarding link.";
  }
  return "I can route workspace requests from Web and Telegram. Ask me to add or onboard a device and I will create a short-lived onboarding link.";
}

export async function maybeReplyToCommunicationAgentDm(ctx: ServerRouteContext, input: {
  message: MessageRecord;
  agent: AgentRecord | null;
  sourceContext?: CommunicationAgentSourceContext;
  returnTarget?: CommunicationAgentReturnTarget;
  allowHandoff?: boolean;
  allowSystemTrigger?: boolean;
  onExecutionIds?: (executionIds: string[]) => void;
  onOutcome?: (outcome: CommunicationAgentReplyOutcome) => void;
}): Promise<MessageRecord | null> {
  const { store, emitRealtimeMessage } = ctx;
  const { message, agent } = input;
  const sourceContext = input.sourceContext ?? webCommunicationAgentSourceContext(message);
  const workspaceBridgeMessage = sourceContext.accessMode === "workspace_bridge";
  // Heartbeat 是服务端写入固定 TYR DM 的受控 system 消息；默认调用仍不能用 system 身份唤醒 TYR。
  const senderAllowed = message.senderType === "human" || (
    message.senderType === "system" && (workspaceBridgeMessage || input.allowSystemTrigger === true)
  );
  if (!senderAllowed || !agent || !isCommunicationAgent(agent) || message.channelType !== "dm") return null;

  const serverId = agent.serverId ?? store.listServersForUser(message.senderId)[0]?.id ?? "local";
  if (!workspaceBridgeMessage && message.senderType === "human") {
    const confirmedOrigin = await answerCommunicationOriginConfirmation(ctx, { message, assistant: agent, serverId });
    if (confirmedOrigin) {
      const sent = store.sendMessage({
        target: message.channelId,
        ...(message.conversationId ? { conversationId: message.conversationId, allowClosedConversation: true } : {}),
        content: confirmedOrigin.content,
        result: {
          version: 1,
          status: confirmedOrigin.status,
          title: confirmedOrigin.requestId ? "TYR is waiting for the connected workspace" : "TYR handled the notice",
          summary: confirmedOrigin.content,
          communicationRequest: { sourceMessageId: confirmedOrigin.sourceMessageId }
        },
        senderType: "agent", senderId: agent.id, senderName: agent.displayName, serverId
      }).message;
      emitRealtimeMessage(sent);
      for (const requestId of store.armCrossWorkspaceContinuationsForSourceMessage(confirmedOrigin.sourceMessageId)) {
        ctx.scheduleAssistantBridgeContinuation?.(requestId);
      }
      return sent;
    }
  }
  const clarification = !workspaceBridgeMessage && message.senderType === "human"
    ? restaurantClarificationForMessage(store, { message, serverId, assistantAgentId: agent.id })
    : null;
  if (workspaceBridgeMessage) {
    const bridgeChannel = store.resolveTarget(message.channelId, serverId);
    const identity = bridgeChannel?.dmIdentity;
    // 只有服务端创建的当前 Bridge 隐藏会话可以使用 system sender 唤起 TYR。
    if (
      identity?.kind !== "workspace_bridge" ||
      identity.bridgeId !== sourceContext.workspaceBridgeId ||
      identity.workspaceId !== serverId ||
      identity.agentId !== agent.id
    ) return null;
    // Freeze semantic routing immediately before an actual handoff or outgoing hop.
    // Inventory reads and local answers do not need a separate planning request.
  }
  // Phase A 的 Communication Agent 是 server-hosted identity，不走 daemon/runtime，避免被误当成设备代理执行。
  // MCP 通过 operation status 读取 runtime 结果，不创建 Telegram/Email/Web 外部回传任务。
  const returnTarget = input.returnTarget ?? (sourceContext.source === "mcp" ? undefined : {
    source: sourceContext.source,
    ...(sourceContext.externalRef ? { externalRef: sourceContext.externalRef } : {})
  });
  const progressStartedAt = new Date().toISOString();
  const progressState: CommunicationAgentProgressContext["progressState"] = {};
  const progressContext: CommunicationAgentProgressContext = {
    assistant: agent,
    channelId: message.channelId,
    ...(message.conversationId ? { conversationId: message.conversationId } : {}),
    sourceMessageId: message.id,
    sourceContext,
    progressStartedAt,
    progressState
  };
  emitCommunicationAgentProgress(ctx, progressContext, "understanding", "Understanding request...");
  try {
    let draft = await createCommunicationAgentInventoryReply(ctx, {
      // 把原订位内容连同本次 Human 选择交给 TYR；后续 execution 仍绑定本次确认消息，便于幂等回传。
      content: clarification ? resumedRestaurantBookingContent(clarification) : message.content,
      serverId,
      // Bridge 消息以目标 Workspace 对应账号执行，但消息身份仍取真实发送者。
      userId: sourceContext.capabilityUserId ?? message.senderId,
      assistant: agent,
      channelId: message.channelId,
      ...(message.conversationId ? { conversationId: message.conversationId } : {}),
      sourceMessageId: message.id,
      sourceContext,
      returnTarget,
      allowHandoff: input.allowHandoff ?? true,
      systemTrigger: input.allowSystemTrigger === true && message.senderType === "system",
      progressStartedAt,
      progressState
    });
    emitCommunicationAgentProgress(ctx, progressContext, "preparing_response", "Preparing response...");
    if (draft.replySuppressed && sourceContext.source === "telegram" && !draft.content.trim() && !draft.error) {
      input.onExecutionIds?.([]);
      input.onOutcome?.({ status: "completed", replySuppressed: true });
      emitCommunicationAgentProgress(ctx, progressContext, "completed", "Reaction updated.");
      return null;
    }
    const visibility = enforceAssistantPublicAgentIdVisibility({
      content: draft.content,
      // Communication Agent 的公开邮箱可能包含自身标识；这里只阻断 executable Agent stable ID。
      agentIds: store.listAgents(serverId).filter((item) => !isCommunicationAgent(item)).map((item) => item.id),
      allowedAgentIds: draft.allowedAgentIds ?? []
    });
    if (visibility.blockedAgentIds.length > 0) {
      draft = blockedVisibilityDraft(draft, visibility.content, message.id);
      try {
        // 只记录泄露数量与来源，避免把本应阻断的内部 ID 再写进审计 metadata。
        store.recordAuditEvent({
          kind: "communication_agent_public_agent_id_blocked",
          actorType: "agent",
          actorId: agent.id,
          resourceType: "agent",
          resourceId: agent.id,
          serverId,
          metadata: {
            sourceMessageId: message.id,
            blockedAgentCount: visibility.blockedAgentIds.length
          }
        });
      } catch {
        // 输出边界已经完成阻断；审计旁路故障不能让原始模型正文重新进入消息历史。
      }
    }
    const existingBridgeReply = existingWorkspaceBridgeOriginMessage(
      ctx,
      draft.bridgeRequestIds,
      draft.bridgeRequestAttemptCount,
      message.channelId,
      message.conversationId
    );
    if (existingBridgeReply) {
      // Reuse a persisted receipt without treating a personal-reply wait as completion.
      const existingOutcomeStatus = existingBridgeReply.result?.status === "partial" ? "running"
        : existingBridgeReply.result?.status === "failed" ? "failed" : "completed";
      if (sourceContext.source === "telegram" && existingOutcomeStatus !== "running") {
        // finally 会唤起 Bridge continuation；先登记此 Telegram webhook 将直接返回的结果。
        markImmediateWorkspaceBridgeExternalReturn(store, {
          assistantReply: existingBridgeReply,
          assistantOutcome: { status: existingOutcomeStatus, bridgeRequestIds: draft.bridgeRequestIds }
        });
      }
      input.onExecutionIds?.([]);
      input.onOutcome?.({
        ...(draft.error ? { error: draft.error } : {}),
        ...(draft.bridgeRequestIds?.length ? { bridgeRequestIds: draft.bridgeRequestIds } : {}),
        status: existingOutcomeStatus
      });
      emitCommunicationAgentProgress(
        ctx,
        progressContext,
        existingOutcomeStatus === "running" ? "running_action" : existingOutcomeStatus === "failed" ? "failed" : "completed",
        existingOutcomeStatus === "running" ? "Waiting for the connected workspace..." : existingOutcomeStatus === "failed" ? "Request failed." : "Response ready."
      );
      return existingBridgeReply;
    }
    const executionIds = [...new Set(draft.executionIds ?? [])];
    const existingHandoffReply = executionIds
      .map((executionId) => store.getRuntimeExecution(executionId)?.rootMessageId)
      .filter((rootMessageId): rootMessageId is string => Boolean(rootMessageId))
      .map((rootMessageId) => store.getMessage(rootMessageId))
      .find((candidate) => (
        candidate?.channelId === message.channelId &&
        candidate.conversationId === message.conversationId &&
        candidate.senderType === "agent" &&
        candidate.senderId === agent.id
      ));
    if (existingHandoffReply) {
      // handoff 在 worker 唤醒前已经发布可见回执；Tool Loop 的第二轮只负责收尾，不能再追加重复气泡。
      input.onExecutionIds?.(executionIds);
      input.onOutcome?.({
        ...(draft.error ? { error: draft.error } : {}),
        ...(draft.bridgeRequestIds?.length ? { bridgeRequestIds: draft.bridgeRequestIds } : {}),
        status: draft.outcomeStatus ?? "running"
      });
      const executions = executionIds
        .map((executionId) => store.getRuntimeExecution(executionId))
        .filter((execution): execution is NonNullable<typeof execution> => Boolean(execution));
      const failed = executions.some((execution) => execution.status === "failed" || execution.status === "cancelled");
      emitCommunicationAgentProgress(
        ctx,
        progressContext,
        failed ? "failed" : "running_action",
        failed ? "Request failed." : "TYR is processing the Agent response..."
      );
      return existingHandoffReply;
    }
    if (draft.evidenceSelections?.length) {
      const evidence = selectCommunicationEvidenceForContext(store, {
        serverId: agent.serverId ?? "local", sourceMessageId: message.id,
        channelId: message.channelId, conversationId: message.conversationId ?? null
      }, draft.evidenceSelections);
      draft.result = { ...draft.result, version: 1, status: draft.result?.status ??
        (draft.outcomeStatus === "failed" ? "failed" : draft.outcomeStatus === "completed" ? "completed" : "partial"),
        title: draft.result?.title ?? "TYR reviewed response", summary: visibility.content, evidence };
    }
    const reply = store.sendMessage({
      target: message.channelId,
      ...(message.conversationId ? {
        conversationId: message.conversationId,
        // LLM / handoff 可能在用户新建会话后才返回；结果必须完成到原会话，不能进入新的上下文。
        allowClosedConversation: true
      } : {}),
      content: visibility.content,
      result: draft.result,
      senderType: "agent",
      senderId: agent.id,
      senderName: agent.displayName,
      serverId: agent.serverId ?? "local"
    }).message;
    input.onExecutionIds?.(executionIds);
    input.onOutcome?.({
      ...(draft.error ? { error: draft.error } : {}),
      ...(draft.bridgeRequestIds?.length ? { bridgeRequestIds: draft.bridgeRequestIds } : {}),
      ...(draft.outcomeStatus ? { status: draft.outcomeStatus } : {})
    });
    for (const executionId of executionIds) {
      const updated = store.attachRuntimeExecutionRootMessage(executionId, reply.id);
      if (updated) ctx.emitRealtimeRuntimeExecution?.(updated);
    }
    if (draft.pendingActionId) {
      store.attachCommunicationAgentPendingActionSuggestionMessage(draft.pendingActionId, reply.id);
    }
    emitRealtimeMessage(reply);
    if (draft.outcomeStatus === "partial") {
      emitCommunicationAgentProgress(ctx, progressContext, "needs_input", "Needs your input.");
    } else if (draft.bridgeRequestPending) {
      // 本地确认消息不是 Bridge 终态；保持工作动画，直到跨 Workspace final/error 到达。
      emitCommunicationAgentProgress(ctx, progressContext, "running_action", "Waiting for the connected workspace...");
    } else if (draft.outcomeStatus === "failed") {
      emitCommunicationAgentProgress(ctx, progressContext, "failed", "Request failed.");
    } else if (draft.outcomeStatus === "running") {
      emitCommunicationAgentProgress(ctx, progressContext, "running_action", "TYR is continuing the request...");
    } else {
      emitCommunicationAgentProgress(ctx, progressContext, "completed", "Response ready.");
    }
    return reply;
  } catch (error) {
    emitCommunicationAgentProgress(ctx, progressContext, "failed", "Response unavailable.");
    throw error;
  } finally {
    // 初始可见回执已落盘，快于 Tool Loop 返回的 Bridge 终态现在才允许唤起续跑。
    for (const requestId of store.armCrossWorkspaceContinuationsForSourceMessage(message.id)) {
      ctx.scheduleAssistantBridgeContinuation?.(requestId);
    }
  }
}

/**
 * A worker completion resumes the original TYR request instead of being treated as a terminal
 * presentation-only event. The durable execution/message records reconstruct every trusted
 * identity and routing field; no value from the worker result is accepted as authorization.
 */
export async function continueCommunicationAgentRequest(ctx: ServerRouteContext, input: {
  execution: RuntimeExecutionRecord;
  workerResult: string;
  sourceAgentName: string;
  ipcEvent?: { id: string; kind: "progress" | "question" | "action_request" | "result" };
}): Promise<CommunicationAgentContinuationDraft | null> {
  const { execution } = input;
  if (
    !ctx.assistantLlmConfig?.enabled ||
    (input.ipcEvent ? execution.status === "failed" || execution.status === "cancelled" : execution.status !== "completed") ||
    (execution.communicationReturnMessageId && !(input.ipcEvent?.kind === "action_request" &&
      ctx.store.getMessage(execution.communicationReturnMessageId)?.result?.status === "partial")) ||
    !execution.communicationReturnChannelId ||
    !execution.communicationReturnSourceMessageId ||
    !execution.communicationReturnUserId ||
    !execution.communicationReturnSource
  ) return null;

  const serverId = execution.serverId ?? "local";
  const sourceMessage = ctx.store.getMessage(execution.communicationReturnSourceMessageId);
  if (!sourceMessage || sourceMessage.channelId !== execution.communicationReturnChannelId) return null;
  const completedStepCount = ctx.store.listRuntimeExecutions({ serverId, limit: 1_000 })
    .filter((candidate) => (
      candidate.communicationReturnSourceMessageId === execution.communicationReturnSourceMessageId &&
      candidate.communicationReturnChannelId === execution.communicationReturnChannelId
    )).length;
  // The count is reconstructed from durable executions, so a server restart cannot reset the loop budget.
  if (completedStepCount >= MAX_COMMUNICATION_AGENT_CONTINUATION_STEPS) return null;

  const assistant = ctx.store.ensureDefaultCommunicationAgent(serverId);
  const workerOutcome = communicationWorkerOutcome(input.workerResult, input.ipcEvent?.kind);
  const needsInformation = workerOutcome.needsInformation;
  const bridgeRef = workspaceBridgeRefForExecution(execution);
  const clarification = bridgeRef ? null : restaurantClarificationForMessage(ctx.store, {
    message: sourceMessage, serverId, assistantAgentId: assistant.id
  });
  const bridgeRequest = bridgeRef ? ctx.store.getCrossWorkspaceMessage(bridgeRef.requestMessageId) : null;
  if (bridgeRef && (
    !bridgeRequest ||
    bridgeRequest.bridgeId !== bridgeRef.bridgeId ||
    bridgeRequest.targetWorkspaceId !== serverId
  )) return null;

  const recoveredSourceContext: CommunicationAgentSourceContext = bridgeRef && bridgeRequest
    ? {
        source: "web",
        sourceConversationKey: `workspace_bridge:${bridgeRef.bridgeId}:${serverId}:${bridgeRef.conversationId}`,
        sourceEventKey: input.ipcEvent?.id ?? `${execution.communicationReturnSourceMessageId}:worker-return:${execution.id}`,
        accessMode: "workspace_bridge",
        workspaceBridgeId: bridgeRef.bridgeId,
        capabilityUserId: bridgeRequest.targetCapabilityUserId ?? assistant.ownerUserId,
        requestingUserId: bridgeRequest.senderUserId ?? bridgeRequest.originalSenderUserId ?? undefined,
        requestingUserName: bridgeRequest.senderUserName ?? undefined,
        requestingUserDisplayName: bridgeRequest.senderUserDisplayName ?? undefined,
        requestingUserAvatarUrl: bridgeRequest.senderUserAvatarUrl,
        bridgeTraceId: bridgeRequest.traceId ?? undefined,
        parentBridgeRequestId: bridgeRequest.id,
        bridgeHopCount: bridgeRequest.hopCount,
        continuationStepCount: completedStepCount,
        ...(workerOutcome.status === "partial" ? { awaitingEvidenceFromAgentId: execution.agentId } : {})
      }
    : {
        source: execution.communicationReturnSource,
        sourceConversationKey: execution.communicationReturnConversationId ?? execution.communicationReturnChannelId,
        sourceEventKey: input.ipcEvent?.id ?? `${execution.communicationReturnSourceMessageId}:worker-return:${execution.id}`,
        ...(execution.communicationReturnExternalRef ? { externalRef: execution.communicationReturnExternalRef } : {}),
        continuationStepCount: completedStepCount,
        ...(workerOutcome.status === "partial" ? { awaitingEvidenceFromAgentId: execution.agentId } : {})
      };
  const sourceContext = restoreMcpCommunicationAuthority(ctx.store, {
    sourceMessageId: sourceMessage.id,
    userId: bridgeRef && bridgeRequest ? bridgeRequest.targetCapabilityUserId ?? assistant.ownerUserId : execution.communicationReturnUserId,
    serverId,
    channelId: sourceMessage.channelId,
    conversationId: sourceMessage.conversationId,
    sourceContext: recoveredSourceContext
  });
  const currentInstructions = sourceContext.mcpAuthorizationError
    ? { instructions: "", revision: 0 }
    : ctx.store.getWorkspaceRoutingInstructions(serverId);
  const progressState: CommunicationAgentProgressContext["progressState"] = {};
  try {
    const draft = groundContinuationDraftWeekdays(await communicationAgentToolLoopReply(ctx, {
      // Worker 完成后仍使用原请求与 Human 的餐厅确认，避免把单词“Sable”当成完整预约内容。
      content: clarification ? resumedRestaurantBookingContent(clarification) : sourceMessage.content,
      serverId,
      userId: bridgeRef && bridgeRequest
        ? bridgeRequest.targetCapabilityUserId ?? assistant.ownerUserId
        : execution.communicationReturnUserId,
      assistant,
      channelId: execution.communicationReturnChannelId,
      ...(execution.communicationReturnConversationId ? { conversationId: execution.communicationReturnConversationId } : {}),
      sourceMessageId: execution.communicationReturnSourceMessageId,
      sourceContext,
      returnTarget: {
        source: execution.communicationReturnSource,
        ...(execution.communicationReturnExternalRef ? { externalRef: execution.communicationReturnExternalRef } : {})
      },
      allowHandoff: true,
      progressStartedAt: execution.createdAt,
      progressState,
      workerContinuation: {
        sourceAgentName: input.sourceAgentName,
        status: workerOutcome.status,
        result: input.workerResult,
        completedStepCount,
        ...(needsInformation ? { needsInformation: true } : {})
      },
      workspaceRoutingInstructions: {
        instructions: execution.communicationReturnInstructions ?? currentInstructions.instructions,
        revision: execution.communicationReturnInstructionsRevision ?? currentInstructions.revision
      }
    }), input.workerResult);
    // Provider/tool-loop failures must not replace a completed worker result; index.ts will use
    // the existing sanitized presentation fallback and preserve the work that already finished.
    const noNextStepDispatched = (draft.executionIds?.length ?? 0) === 0 &&
      (draft.bridgeRequestIds?.length ?? 0) === 0;
    if (noNextStepDispatched && workerOutcome.status !== "completed") {
      // Execution completion is transport state. Only a real next-step receipt can advance
      // a pending worker; model wording must not turn that step into a business terminal.
      const failed = workerOutcome.status === "failed";
      // Pending actions and failed tool attempts require a persisted dispatch receipt.
      // Preserve genuine clarification/confirmation text only for a nonfailed question.
      const content = input.ipcEvent?.kind !== "action_request" && !draft.error &&
        draft.outcomeStatus === "partial"
        ? draft.content
        : failed
          ? "The Agent could not complete its step. TYR has not confirmed completion of the original request."
          : "The Agent's step is still pending. TYR has not confirmed a further action or completion. The original request remains open.";
      return { ...draft, content, outcomeStatus: failed ? "failed" : "partial", result: {
        ...draft.result, version: 1, status: failed ? "failed" : "partial",
        title: failed ? "TYR request failed" : "TYR request needs attention", summary: content, body: content
      } };
    }
    const originAction = input.ipcEvent?.kind === "action_request" && !bridgeRef
      ? verifiedCommunicationOriginAction(ctx.store, {
          eventId: input.ipcEvent.id,
          serverId,
          requestingUserId: execution.communicationReturnUserId,
          sourceMessageId: sourceMessage.id
        })
      : null;
    if (input.ipcEvent?.kind === "action_request" && !bridgeRef && !originAction &&
        getCommunicationRouteIntent(ctx.store, sourceMessage.id)?.actionKind === "none" && noNextStepDispatched) {
      const summary = `TYR has not sent a Workspace Bridge request: the original request has no saved outgoing route. Please clarify which connected workspace to contact and what to request.\n\nAgent result: ${input.workerResult}`;
      return { content: summary, outcomeStatus: "partial", result: {
        version: 1, status: "partial", title: "TYR needs your input", summary
      } };
    }
    const routeIntent = bridgeRef && bridgeRequest
      ? getBridgeRouteIntent(ctx.store, bridgeRequest.id)
      : getCommunicationRouteIntent(ctx.store, sourceMessage.id);
    // A server-authored trigger may legitimately finish without an external step. A missing
    // route intent must still block requested/attempted Bridge actions, but must not replace
    // a no-action worker result with a misleading routing failure.
    const systemNoActionResult = !bridgeRef && sourceMessage.senderType === "system" &&
      input.ipcEvent?.kind !== "action_request" && noNextStepDispatched &&
      !draft.pendingActionId && !draft.rejectedBridgeDestination;
    let verifiedInboundLocalResult = false;
    if (bridgeRef && bridgeRequest && noNextStepDispatched &&
        (!input.ipcEvent || input.ipcEvent.kind === "result")) {
      try {
        verifyIncomingBridgeLocalRequest(ctx, {
          serverId, userId: bridgeRequest.targetCapabilityUserId ?? assistant.ownerUserId,
          channelId: sourceMessage.channelId, conversationId: sourceMessage.conversationId ?? undefined,
          sourceMessageId: sourceMessage.id, sourceContext
        });
        verifiedInboundLocalResult = true;
      } catch {
        // An invalid or closed Bridge request still needs the saved route check below.
      }
    }
    if (!routeIntent && !systemNoActionResult && !verifiedInboundLocalResult &&
        !bridgeRouteIntentPredatesCutover(ctx.store, bridgeRequest?.createdAt ?? sourceMessage.createdAt) && noNextStepDispatched) {
      const summary = "TYR could not verify the original request's saved routing intent. No new Workspace Bridge request was sent.";
      return { content: summary, outcomeStatus: "partial", result: {
        version: 1, status: "partial", title: "TYR request needs attention", summary
      } };
    }
    if (draft.rejectedBridgeDestination && noNextStepDispatched) {
      // worker 的新目标没有用户授权时，保持原请求为待澄清，不能用 completed worker 展示回退收口。
      return {
        content: "Which connected workspace should I contact for this request? I have not sent a Workspace Bridge request.",
        outcomeStatus: "partial",
        result: {
          version: 1,
          status: "partial",
          title: "TYR needs a destination",
          summary: "The next Workspace Bridge destination needs your confirmation. No request was sent."
        }
      };
    }
    // A semantic route permits a necessary/conditional step; a completed local result can
    // satisfy the request without sending. An action_request still needs a real delivery receipt.
    const sourceBridgeRequests = bridgeRequest
      ? ctx.store.listCrossWorkspaceChildRequests(bridgeRequest.id)
      : ctx.store.listCrossWorkspaceRequestsForSourceMessage(sourceMessage.id);
    const semanticLocalCompletion = routeIntent?.plan?.decision === "bridge" &&
      (!input.ipcEvent || input.ipcEvent.kind === "result") && draft.outcomeStatus === "completed" &&
      !draft.error && !draft.rejectedBridgeDestination && !draft.pendingActionId &&
      noNextStepDispatched && sourceBridgeRequests.length === 0;
    if (!systemNoActionResult && !semanticLocalCompletion && routeIntent?.actionKind !== "none" && routeIntent && !completedFrozenBridgeStep(ctx.store, routeIntent) &&
        noNextStepDispatched && !draft.pendingActionId &&
        (!input.ipcEvent || input.ipcEvent.kind === "action_request" || input.ipcEvent.kind === "result")) {
      // 既有任务仍要求下一步，但没有真实 Bridge request ID；模型文字不能充当已发送回执。
      const peer = routeIntent.targetBridgeId
        ? ctx.store.getWorkspaceBridgeForServer(routeIntent.targetBridgeId, serverId)?.peerWorkspace?.name
        : null;
      const summary = peer
        ? `I have not sent the request to ${peer}. The original request is still waiting for that step.`
        : "Which connected workspace or restaurant should I contact? I have not sent a Workspace Bridge request.";
      return {
        content: summary,
        outcomeStatus: "partial",
        result: { version: 1, status: "partial", title: "TYR request needs a next step", summary }
      };
    }
    if (draft.error) return null;
    const worker = ctx.store.getAgent(execution.agentId);
    const visibility = enforceAssistantPublicAgentIdVisibility({
      content: semanticLocalCompletion ? `No Workspace Bridge request was sent.\n\n${draft.content}` : draft.content,
      agentIds: ctx.store.listAgents(serverId).filter((agent) => !isCommunicationAgent(agent)).map((agent) => agent.id),
      allowedAgentIds: draft.allowedAgentIds ?? [],
      allowedWorkspacePaths: worker && worker.serverId === serverId ? allowedWorkerWorkspacePaths({
        sourceContent: sourceMessage.content,
        workerResult: input.workerResult,
        agent: worker,
        executionAgentId: execution.agentId,
        executionStatus: execution.status
      }) : []
    });
    if (visibility.blockedAgentIds.length) return blockedVisibilityDraft(draft, visibility.content, sourceMessage.id);
    return { ...draft, content: visibility.content };
  } catch {
    // Completion delivery remains available through the sanitized presentation fallback in index.ts.
    return null;
  }
}

/** A Bridge terminal resumes the registered TYR waiter with the original user authority. */
export async function continueCommunicationAgentAfterBridge(ctx: ServerRouteContext, input: {
  request: CrossWorkspaceMessageRecord;
  terminal: CrossWorkspaceMessageRecord;
  attemptId?: string;
}): Promise<CommunicationAgentContinuationDraft | null> {
  const { request, terminal } = input;
  if (!request.awaitingAgentId || !request.originMessageId ||
      !request.originChannelId || !request.sourceCapabilityUserId || !request.originSource ||
      terminal.replyToMessageId !== request.id || !["final", "error", "question", "action_request"].includes(terminal.responseKind ?? "")) return null;
  const sourceMessage = ctx.store.getMessage(request.originMessageId);
  const assistant = ctx.store.ensureDefaultCommunicationAgent(request.sourceWorkspaceId);
  if (!sourceMessage || sourceMessage.channelId !== request.originChannelId || assistant.id !== request.awaitingAgentId) return null;
  const parent = request.parentBridgeRequestId
    ? ctx.store.getCrossWorkspaceMessage(request.parentBridgeRequestId)
    : null;
  if (request.parentBridgeRequestId && (!parent?.conversationId || parent.targetWorkspaceId !== request.sourceWorkspaceId)) return null;
  if (!parent && (terminal.responseKind === "final" || terminal.responseKind === "error")) {
    const notice = verifiedCommunicationOriginNoticeRequest(ctx.store, request);
    if (notice) {
      // The owner action and exact notice were checked before sending. Its terminal peer reply
      // closes that same request; there is no remaining worker action to delegate again.
      const completed = terminal.responseKind === "final";
      const content = completed
        ? `The notice was delivered to ${notice.peerWorkspaceName}. ${notice.peerWorkspaceName} TYR replied:\n${terminal.content}`
        : `The notice to ${notice.peerWorkspaceName} did not complete. ${terminal.content}`;
      return { content, outcomeStatus: completed ? "completed" : "failed", result: {
        version: 1, status: completed ? "completed" : "failed",
        title: completed ? "Workspace Bridge response" : "Workspace Bridge request failed",
        summary: content, body: content, sourceAgentName: `${notice.peerWorkspaceName} TYR`,
        workspaceBridge: {
          bridgeRequestId: request.id, bridgeId: request.bridgeId,
          conversationId: request.conversationId!, sentContent: request.content,
          state: completed ? "completed" : "failed"
        }
      } };
    }
  }
  if (!ctx.assistantLlmConfig?.enabled) return null;
  const completedStepCount = ctx.store.countCrossWorkspaceContinuationsForSourceMessage(sourceMessage.id) +
    ctx.store.listRuntimeExecutions({ serverId: request.sourceWorkspaceId, limit: 1_000 })
      .filter((execution) => execution.communicationReturnSourceMessageId === sourceMessage.id).length;
  if (completedStepCount >= MAX_COMMUNICATION_AGENT_CONTINUATION_STEPS) return null;
  const recoveredSourceContext: CommunicationAgentSourceContext = {
    source: request.originSource,
    sourceConversationKey: request.originConversationKey ?? request.originConversationId ?? request.originChannelId,
    sourceEventKey: `${sourceMessage.id}:bridge-return:${terminal.id}`,
    ...(request.originExternalRef ? { externalRef: request.originExternalRef } : {}),
    ...(parent ? {
      accessMode: "workspace_bridge" as const,
      workspaceBridgeId: parent.bridgeId,
      capabilityUserId: parent.targetCapabilityUserId ?? assistant.ownerUserId,
      requestingUserId: parent.senderUserId ?? parent.originalSenderUserId ?? undefined,
      requestingUserName: parent.senderUserName ?? undefined,
      requestingUserDisplayName: parent.senderUserDisplayName ?? undefined,
      requestingUserAvatarUrl: parent.senderUserAvatarUrl,
      bridgeTraceId: parent.traceId ?? undefined,
      parentBridgeRequestId: parent.id,
      bridgeHopCount: parent.hopCount
    } : {}),
    ...(input.attemptId ? { bridgeContinuationAttemptId: input.attemptId } : {}),
    ...(["question", "action_request"].includes(terminal.responseKind ?? "")
      ? { bridgeFollowupRequestId: request.id } : {}),
    ...(terminal.responseKind === "error" ? { failedBridgeId: request.bridgeId } : {}),
    continuationStepCount: completedStepCount
  };
  const sourceContext = restoreMcpCommunicationAuthority(ctx.store, {
    sourceMessageId: sourceMessage.id,
    userId: request.sourceCapabilityUserId,
    serverId: request.sourceWorkspaceId,
    channelId: sourceMessage.channelId,
    conversationId: sourceMessage.conversationId,
    sourceContext: recoveredSourceContext
  });
  const bridge = ctx.store.getWorkspaceBridgeForServer(request.bridgeId, request.sourceWorkspaceId);
  const completedWorkers = request.originConversationId === sourceMessage.conversationId && request.originConversationId
    ? recoverCompletedWorkerResults(ctx.store, {
        serverId: request.sourceWorkspaceId, userId: request.sourceCapabilityUserId,
        sourceMessageId: sourceMessage.id, channelId: request.originChannelId,
        conversationId: request.originConversationId, assistantAgentId: assistant.id
      })
    : { results: [], allowedWorkspacePaths: [] };
  const progressState: CommunicationAgentProgressContext["progressState"] = {};
  try {
    const draft = groundContinuationDraftWeekdays(await communicationAgentToolLoopReply(ctx, {
      content: sourceMessage.content,
      serverId: request.sourceWorkspaceId,
      userId: request.sourceCapabilityUserId,
      assistant,
      channelId: request.originChannelId,
      ...(request.originConversationId ? { conversationId: request.originConversationId } : {}),
      sourceMessageId: sourceMessage.id,
      sourceContext,
      ...(request.originSource === "mcp" ? {} : { returnTarget: {
        source: request.originSource,
        ...(parent ? { externalRef: workspaceBridgeCommunicationReturnExternalRef({
          bridgeId: parent.bridgeId,
          conversationId: parent.conversationId!,
          sourceWorkspaceId: parent.sourceWorkspaceId,
          targetWorkspaceId: parent.targetWorkspaceId,
          requestMessageId: parent.id
        }) } : request.originExternalRef ? { externalRef: request.originExternalRef } : {})
      } }),
      allowHandoff: true,
      progressStartedAt: request.createdAt,
      progressState,
      bridgeContinuation: {
        requestId: request.id,
        bridgeId: request.bridgeId,
        ...(request.conversationId ? { conversationId: request.conversationId } : {}),
        sentContent: request.content,
        peerWorkspaceName: bridge?.peerWorkspace?.name ?? "Connected workspace",
        status: terminal.responseKind === "error" ? "failed" : terminal.responseKind === "final" ? "completed" : "partial",
        ...(terminal.responseKind === "question" || terminal.responseKind === "action_request" ? { eventKind: terminal.responseKind } : {}),
        result: terminal.content,
        completedStepCount,
        ...(ctx.store.hasReviewedDownstreamResult(terminal.id) ? { reviewedDownstreamResult: true } : {})
      },
      completedWorkerResults: completedWorkers.results
    }), terminal.content);
    if (draft.error) return null;
    const visibility = enforceAssistantPublicAgentIdVisibility({
      content: draft.content,
      agentIds: ctx.store.listAgents(request.sourceWorkspaceId).filter((agent) => !isCommunicationAgent(agent)).map((agent) => agent.id),
      allowedAgentIds: draft.allowedAgentIds ?? [],
      allowedWorkspacePaths: completedWorkers.allowedWorkspacePaths
    });
    if (visibility.blockedAgentIds.length) return blockedVisibilityDraft(draft, visibility.content, sourceMessage.id);
    if (terminal.responseKind === "question" || terminal.responseKind === "action_request") {
      // 中途回调即使模型给出完整措辞，也不能占用原请求的完成态。
      return { ...draft, content: visibility.content, outcomeStatus: "partial", result: {
        version: 1, status: "partial", title: "TYR is continuing the workspace request", summary: visibility.content,
        communicationRequest: { sourceMessageId: sourceMessage.id }
      } };
    }
    const routeIntent = parent
      ? getBridgeRouteIntent(ctx.store, parent.id)
      : getCommunicationRouteIntent(ctx.store, sourceMessage.id);
    const hasNextStep = Boolean(draft.executionIds?.length || draft.bridgeRequestIds?.length || draft.pendingActionId);
    if (!routeIntent && !bridgeRouteIntentPredatesCutover(ctx.store, parent?.createdAt ?? sourceMessage.createdAt) && !hasNextStep) {
      const summary = "TYR could not verify the original request's saved routing intent. The connected workspace result needs review.";
      return { content: summary, outcomeStatus: "partial", result: {
        version: 1, status: "partial", title: "TYR request needs attention", summary
      } };
    }
    const priorRouteSent = routeIntent?.targetBridgeId
      ? ctx.store.listCrossWorkspaceRequestsForSourceMessage(sourceMessage.id)
          .some((candidate) => candidate.bridgeId === routeIntent.targetBridgeId)
      : ctx.store.listCrossWorkspaceRequestsForSourceMessage(sourceMessage.id).length > 0;
    if (routeIntent && routeIntent.actionKind !== "none" && !hasNextStep && !priorRouteSent) {
      const summary = routeIntent.targetBridgeId
        ? "The connected workspace replied, but the authorized next Bridge step has no request ID. The original request still needs attention."
        : "Which connected workspace or restaurant should I contact next? No new Bridge request was sent.";
      return {
        content: summary,
        outcomeStatus: "partial",
        result: { version: 1, status: "partial", title: "TYR needs your input", summary }
      };
    }
    return { ...draft, content: visibility.content };
  } catch {
    // Bridge 终态已在原 DM 可见；模型故障不能重放跨 Workspace 副作用。
    return null;
  }
}

async function createCommunicationAgentInventoryReply(ctx: ServerRouteContext, input: {
  content: string;
  serverId: string;
  userId: string;
  assistant: AgentRecord;
  channelId: string;
  conversationId?: string;
  sourceMessageId: string;
  sourceContext: CommunicationAgentSourceContext;
  returnTarget?: CommunicationAgentReturnTarget;
  allowHandoff: boolean;
  systemTrigger?: boolean;
  progressStartedAt: string;
  progressState: CommunicationAgentProgressContext["progressState"];
}): Promise<CommunicationAgentReplyDraft> {
  input = { ...input, sourceContext: restoreMcpCommunicationAuthority(ctx.store, {
    sourceMessageId: input.sourceMessageId, userId: input.userId, serverId: input.serverId,
    channelId: input.channelId, conversationId: input.conversationId, sourceContext: input.sourceContext
  }) };
  if (input.sourceContext.mcpAuthorizationError) {
    return blockedMcpAuthorizationDraft(mcpAuthorizationFailureMessage(input.sourceContext.mcpAuthorizationError), input.sourceMessageId);
  }
  const ambiguousRetryReply = ambiguousWorkspaceBridgeRetryReply(ctx, input);
  if (ambiguousRetryReply) return ambiguousRetryReply;
  const attributionReply = communicationAgentResultAttributionReply(ctx, input);
  if (attributionReply) return attributionReply;
  if (input.systemTrigger && input.content.startsWith("[Scheduled Heartbeat]")) {
    return communicationAgentHeartbeatHandoffReply(ctx, input);
  }
  // 生产入口在模型可用时始终先让模型理解意图；旧 decision hook 仅保留给现有兼容测试与回滚路径。
  if (ctx.assistantLlmConfig?.enabled && (ctx.assistantToolLoop || !ctx.assistantLlmDecide)) {
    return communicationAgentToolLoopReply(ctx, input);
  }
  // Compatibility paths share the same effective authority as the native tool executor.
  if (input.sourceContext.source === "mcp" && !input.sourceContext.grantedScopes?.includes("tyr:manage")) {
    input = { ...input, sourceContext: { ...input.sourceContext, accessMode: "read_only" } };
  }
  if (input.sourceContext.accessMode === "read_only") input = { ...input, allowHandoff: false };
  if (input.sourceContext.accessMode !== "read_only") {
    const managementReply = await handleCommunicationAgentAction(ctx, {
      content: input.content,
      serverId: input.serverId,
      userId: input.userId,
      assistant: input.assistant,
      channelId: input.channelId,
      sourceMessageId: input.sourceMessageId,
      sourceContext: input.sourceContext
    });
    // Agent management drafts own short selections and confirmations before legacy routing or LLM fallback.
    if (managementReply.handled) return { content: managementReply.content };
    const onboardingIntent = parseCommunicationAgentMachineOnboardingIntent(input.content);
    if (onboardingIntent) {
      const serverRecord = ctx.store.listServersForUser(input.userId).find((item) => item.id === input.serverId);
      return {
        content: serverRecord && serverRecord.role !== "guest"
          ? createCommunicationAgentOnboardingReply(ctx, {
            serverId: input.serverId,
            requestedByUserId: input.userId,
            requestedByAgentId: input.assistant.id,
            machineName: onboardingIntent.name
          })
          : "I can create device onboarding links for workspace owners and members only."
      };
    }
  }
  const pendingActionCommand = parseCommunicationAgentPendingActionCommand(input.content);
  if (pendingActionCommand && !input.allowHandoff) return { content: communicationAgentHandoffDisabledText(null, "Route confirmations are disabled for workspace bridge messages.") };
  if (pendingActionCommand) return communicationAgentPendingActionCommandReply(ctx, input, pendingActionCommand);
  const command = parseCommunicationAgentInventoryCommand(input.content);
  if (command === "help") return { content: communicationAgentHelpText() };
  if (command === "status") return { content: communicationAgentWorkspaceStatusText(ctx, input) };
  if (command === "list_computers") return { content: communicationAgentComputerListText(ctx, input.serverId) };
  if (command === "list_agents") return { content: communicationAgentAgentListText(ctx, input.serverId) };
  if (command === "list_inventory") return { content: communicationAgentInventoryListText(ctx, input.serverId) };
  // 常见只读查询直接读取当前 Workspace 真值，避免模型猜测权限、模型或名称含义。
  const agentDetailsReply = communicationAgentDetailsReply(ctx, input.serverId, input.content);
  if (agentDetailsReply) return agentDetailsReply;
  const routingSuggestion = await communicationAgentRoutingSuggestionText(ctx, input);
  if (routingSuggestion) return routingSuggestion;
  const capabilityText = communicationAgentCapabilityText(ctx, input.serverId, input.content);
  if (capabilityText) return { content: capabilityText };
  const llmReply = await communicationAgentLlmReply(ctx, input);
  if (llmReply) return llmReply;
  return {
    content: communicationAgentReplyText(input.content, {
      interactionMode: input.sourceContext.accessMode === "workspace_bridge" ? "workspace_bridge" : "workspace"
    })
  };
}

function communicationAgentResultAttributionReply(ctx: ServerRouteContext, input: {
  content: string;
  channelId: string;
  conversationId?: string;
  sourceMessageId: string;
  assistant: AgentRecord;
}): CommunicationAgentReplyDraft | null {
  const normalized = input.content.trim().replace(/\s+/g, " ");
  const standaloneQuestion = normalized.replace(/[?？!！。]+$/g, "").trim();
  // 归属捷径只能处理完整、独立的追问，不能因长指令里出现 “who executed” 而截断 Bridge 或 Agent 操作。
  const asksInChinese = standaloneQuestion.length <= 120 && (
    /^(?:(?:这|那|这个|那个|它|该(?:结果|回复|内容)|上(?:述|一条)(?:结果|回复|内容)?)(?:是|由)?)?(?:谁|哪个|哪位).{0,16}(?:做|生成|执行|完成)(?:的)?$/.test(standaloneQuestion) ||
    /^(?:(?:这|那|这个|那个|它|该(?:结果|回复|内容)|上(?:述|一条)(?:结果|回复|内容)?)(?:是|由)?|是|由)?你.{0,16}(?:还是|或).{0,20}(?:做|生成|执行|完成)(?:的)?$/.test(standaloneQuestion)
  );
  const asksInEnglish = standaloneQuestion.length <= 120 && (
    /^who\s+(?:did|made|generated|executed|completed)(?:\s+(?:this|that|it|the\s+(?:work|task|request|operation|result|response)))?$/i.test(standaloneQuestion) ||
    /^was\s+(?:this|that|it|the\s+(?:work|task|request|operation|result|response)).{0,30}\b(?:you|tyr|an?\s+agent|the\s+agent)\b$/i.test(standaloneQuestion)
  );
  if (!asksInChinese && !asksInEnglish) return null;

  const history = input.conversationId
    ? ctx.store.readConversationHistory(input.conversationId, 20)?.messages ?? []
    : ctx.store.listMessages(input.channelId, 20);
  const sourceIndex = history.findIndex((message) => message.id === input.sourceMessageId);
  const priorMessages = sourceIndex >= 0 ? history.slice(0, sourceIndex) : history;
  const attributedResult = [...priorMessages].reverse().find((message) => (
    message.result?.status === "completed" && Boolean(message.result.sourceHumanName?.trim() || message.result.sourceAgentName?.trim())
  ))?.result;
  if (attributedResult?.sourceHumanName) return {
    content: asksInChinese
      ? `这是 ${attributedResult.sourceHumanName} 本人的回复，TYR 只负责转发原文。`
      : `${attributedResult.sourceHumanName} replied personally; TYR only relayed their original words.`
  };
  const sourceAgentName = attributedResult?.sourceAgentName?.trim();
  if (!sourceAgentName) return null;

  const relayerName = input.assistant.displayName || input.assistant.name || "TYR";
  return {
    // “谁完成”属于持久化 provenance 查询；不能让模型根据 TYR 气泡署名猜测内容作者。
    content: asksInChinese
      ? `这是 ${sourceAgentName} 生成的；${relayerName} 只负责路由、等待并转发结果。`
      : `${sourceAgentName} generated it; ${relayerName} only routed the request, waited, and relayed the result.`
  };
}

type ModelConfirmationCommand = "confirm" | "cancel";

function parseModelConfirmationCommand(content: string): ModelConfirmationCommand | null {
  const normalized = content.trim().toLowerCase().replace(/[.!?。！？]+$/g, "").trim();
  if (/^(?:\/?confirm|yes|yes[, ]+(?:confirm|continue|do it)|确认|确认执行|是的|好的[,， ]*(?:确认|执行))$/i.test(normalized)) {
    return "confirm";
  }
  if (/^(?:\/?cancel|no|no[, ]+(?:cancel|stop)|取消|不要|停止)$/i.test(normalized)) return "cancel";
  return null;
}

function modelConfirmationScope(input: {
  serverId: string;
  userId: string;
  assistant: AgentRecord;
  sourceContext: CommunicationAgentSourceContext;
}) {
  return {
    serverId: input.serverId,
    userId: input.userId,
    assistantAgentId: input.assistant.id,
    source: input.sourceContext.source,
    sourceConversationKey: input.sourceContext.sourceConversationKey
  } as const;
}

function isModelConfirmationDraft(value: {
  action: string;
  stage: string;
  params: { toolCallId?: string; targetAgentId?: string; targetBridgeIntentId?: string };
} | null | undefined): value is {
  action: "delete" | "reset" | "confirm_workspace_bridge";
  stage: "awaiting_confirmation";
  params: { toolCallId: string; targetAgentId?: string; targetBridgeIntentId?: string };
} {
  return Boolean(
    value &&
    (value.action === "delete" || value.action === "reset" || value.action === "confirm_workspace_bridge") &&
    value.stage === "awaiting_confirmation" &&
    value.params.toolCallId?.trim() &&
    (value.action === "confirm_workspace_bridge" ? value.params.targetBridgeIntentId?.trim() : value.params.targetAgentId?.trim())
  );
}

function persistModelConfirmation(
  ctx: ServerRouteContext,
  input: {
    content: string;
    serverId: string;
    userId: string;
    assistant: AgentRecord;
    channelId: string;
    sourceMessageId: string;
    sourceContext: CommunicationAgentSourceContext;
  },
  result: AssistantToolLoopResult
): CommunicationAgentReplyDraft {
  const pending = result.pendingConfirmation;
  if (!pending || (pending.call.name !== "delete_agent" && pending.call.name !== "reset_agent" && pending.call.name !== "confirm_workspace_bridge_invite")) {
    const publicReply = buildAssistantPublicReply(result, {
      accessMode: input.sourceContext.accessMode,
      userMessage: input.content,
      ...(input.sourceContext.accessMode === "workspace_bridge"
        ? { hasAvailableWorkerAgent: hasAvailableWorkerAgent(ctx, input.serverId) }
        : {})
    });
    const bridgeStatuses = workspaceBridgeRequestStatusesFromResult(result);
    const bridgeRequestAttemptCount = workspaceBridgeRequestAttemptCount(result);
    const bridgeStatus = bridgeRequestAttemptCount === 1 && bridgeStatuses.length === 1
      ? bridgeStatuses[0]!
      : null;
    const bridgeReply = bridgeStatus ? workspaceBridgeReplyText(bridgeStatus) : null;
    const bridgeRequest = bridgeStatus ? ctx.store.getCrossWorkspaceMessage(bridgeStatus.bridgeRequestId) : null;
    const bridgeRequestPending = bridgeStatuses.some((status) => (
      status.state !== "completed" && status.state !== "failed"
    ));
    return {
      content: bridgeReply?.content ?? publicReply.content,
      ...(publicReply.replySuppressed ? { replySuppressed: true } : {}),
      executionIds: result.executionIds,
      bridgeRequestIds: result.bridgeRequestIds,
      bridgeRequestAttemptCount,
      ...(bridgeStatus && bridgeReply
        ? { result: workspaceBridgeMessageResult(bridgeStatus, bridgeReply.resultBody, bridgeRequest?.content) }
        : {}),
      ...(bridgeRequestPending ? { bridgeRequestPending: true } : {}),
      outcomeStatus: assistantToolLoopOutcomeStatus(result, publicReply.error, bridgeRequestPending),
      allowedAgentIds: publicReply.allowedAgentIds,
      ...(publicReply.error ? { error: publicReply.error } : {})
    };
  }
  const confirmation = pending.result.confirmation;
  const targetId = pending.call.name === "confirm_workspace_bridge_invite" ? pending.call.arguments.intentId : pending.call.arguments.agentId;
  if (!confirmation || confirmation.toolName !== pending.call.name || confirmation.targetId !== targetId) {
    return { content: "I couldn't prepare that confirmation. Please try the request again." };
  }
  const created = ctx.store.createCommunicationAgentManagementDraft({
    ...modelConfirmationScope(input),
    channelId: input.channelId,
    sourceMessageId: input.sourceMessageId,
    sourceEventKey: input.sourceContext.sourceEventKey,
    action: pending.call.name === "delete_agent" ? "delete" : pending.call.name === "reset_agent" ? "reset" : "confirm_workspace_bridge",
    stage: "awaiting_confirmation",
    params: {
      toolCallId: pending.call.id,
      ...(pending.call.name === "confirm_workspace_bridge_invite" ? { targetBridgeIntentId: targetId } : { targetAgentId: targetId })
    },
    replyText: confirmation.prompt
  });
  return {
    content: created.record.replyText || confirmation.prompt,
    executionIds: result.executionIds,
    bridgeRequestIds: result.bridgeRequestIds,
    outcomeStatus: "partial",
    result: {
      version: 1,
      status: "partial",
      title: "TYR needs confirmation",
      summary: created.record.replyText || confirmation.prompt
    }
  };
}

async function modelConfirmationReply(ctx: ServerRouteContext, input: {
  content: string;
  serverId: string;
  userId: string;
  assistant: AgentRecord;
  channelId: string;
  conversationId?: string;
  sourceMessageId: string;
  sourceContext: CommunicationAgentSourceContext;
  returnTarget?: CommunicationAgentReturnTarget;
  allowHandoff: boolean;
  progressStartedAt: string;
  progressState: CommunicationAgentProgressContext["progressState"];
}): Promise<CommunicationAgentReplyDraft | null> {
  const scope = modelConfirmationScope(input);
  const replay = ctx.store.getCommunicationAgentManagementDraftBySourceEvent({
    ...scope,
    sourceEventKey: input.sourceContext.sourceEventKey
  });
  if (isModelConfirmationDraft(replay)) {
    return { content: replay.replyText || "That confirmation request is already being processed." };
  }

  const command = parseModelConfirmationCommand(input.content);
  if (!command) return null;
  const pending = ctx.store.getLatestCommunicationAgentManagementDraft(scope);
  if (!isModelConfirmationDraft(pending)) return null;
  if (pending.status === "expired") {
    return { content: "That confirmation expired. Please make the request again." };
  }
  const attached = ctx.store.attachCommunicationAgentManagementDraftSourceEvent(pending.id, {
    ...scope,
    sourceEventKey: input.sourceContext.sourceEventKey
  });
  if (!attached) {
    const existing = ctx.store.getCommunicationAgentManagementDraftBySourceEvent({
      ...scope,
      sourceEventKey: input.sourceContext.sourceEventKey
    });
    return { content: existing?.replyText || "That confirmation is already being processed." };
  }

  if (command === "cancel") {
    const content = pending.action === "confirm_workspace_bridge" ? "Cancelled the Workspace connection confirmation." : `Cancelled the pending Agent ${pending.action}.`;
    ctx.store.resolveCommunicationAgentManagementDraft(pending.id, "cancelled", { replyText: content });
    return { content };
  }

  const claimed = ctx.store.claimCommunicationAgentManagementDraft(pending.id);
  if (!claimed?.confirmedAt || !isModelConfirmationDraft(claimed)) {
    return { content: "That confirmation is no longer available. Please make the request again." };
  }
  const toolName = claimed.action === "delete" ? "delete_agent" : claimed.action === "reset" ? "reset_agent" : "confirm_workspace_bridge_invite";
  emitCommunicationAgentProgress(ctx, input, "running_action", communicationAgentProgressLabelForTool({ name: toolName }));
  const outcome = await executeTyrAssistantTool(ctx, {
    call: {
      id: claimed.params.toolCallId,
      name: toolName,
      arguments: toolName === "confirm_workspace_bridge_invite"
        ? { intentId: claimed.params.targetBridgeIntentId! }
        : { agentId: claimed.params.targetAgentId! }
    },
    serverId: input.serverId,
    userId: input.userId,
    assistant: input.assistant,
    channelId: input.channelId,
    conversationId: input.conversationId,
    sourceMessageId: input.sourceMessageId,
    sourceContext: input.sourceContext,
    returnTarget: input.returnTarget,
    allowHandoff: input.allowHandoff,
    confirmation: {
      toolCallId: claimed.params.toolCallId,
      toolName,
      targetId: toolName === "confirm_workspace_bridge_invite" ? claimed.params.targetBridgeIntentId! : claimed.params.targetAgentId!,
      confirmedAt: claimed.confirmedAt
    }
  });
  emitCommunicationAgentProgress(ctx, input, "preparing_response", "Preparing response...");
  const content = outcome.ok ? outcome.result.message : outcome.message;
  const succeeded = outcome.ok && ["completed", "noop", "partial"].includes(outcome.result.status);
  ctx.store.resolveCommunicationAgentManagementDraft(claimed.id, succeeded ? "completed" : "failed", {
    replyText: content,
    ...(!succeeded ? { errorCode: outcome.ok ? outcome.result.status : outcome.errorCode } : {})
  });
  return {
    content,
    ...(outcome.ok && outcome.result.executionIds ? { executionIds: outcome.result.executionIds } : {})
  };
}

async function communicationAgentToolLoopReply(ctx: ServerRouteContext, input: {
  content: string;
  serverId: string;
  userId: string;
  assistant: AgentRecord;
  channelId: string;
  conversationId?: string;
  sourceMessageId: string;
  sourceContext: CommunicationAgentSourceContext;
  returnTarget?: CommunicationAgentReturnTarget;
  allowHandoff: boolean;
  progressStartedAt: string;
  progressState: CommunicationAgentProgressContext["progressState"];
  workerContinuation?: NonNullable<AssistantLlmContext["workerContinuation"]>;
  bridgeContinuation?: NonNullable<AssistantLlmContext["bridgeContinuation"]>;
  completedWorkerResults?: NonNullable<AssistantLlmContext["completedWorkerResults"]>;
  workspaceRoutingInstructions?: AssistantLlmContext["workspaceRoutingInstructions"];
}): Promise<CommunicationAgentReplyDraft> {
  const observedBridgeRequestIds = new Set<string>();
  const observedExecutionIds = new Set<string>();
  const observedCompletedToolNames = new Set<string>();
  const observedSideEffectToolNames = new Set<string>();
  const observedUncertainSideEffectToolNames = new Set<string>();
  const observedReadOnlyMessages: string[] = [];
  const observedBridgeStatuses = new Map<string, WorkspaceBridgeRequestStatusPayload>();
  let rejectedBridgeDestination = false;
  const acceptedSideEffects = new Map<string, AssistantToolLoopExecutionOutcome>();
  const followupRequests = new Map<string, string>();
  const toolLoopStartedAt = Date.now();
  const modelAttemptElapsedMs: number[] = [];
  const modelAttemptErrorCodes: string[] = [];
  let assistantToolLoopAttempts = 0;
  try {
    const confirmation = await modelConfirmationReply(ctx, input);
    if (confirmation) return confirmation;

    const config = ctx.assistantLlmConfig!;
    const context = buildAssistantLlmContext(ctx, input.serverId, input.content, {
      userId: input.userId,
      channelId: input.channelId,
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      sourceContext: input.sourceContext,
      workerContinuation: input.workerContinuation,
      bridgeContinuation: input.bridgeContinuation,
      workspaceRoutingInstructions: input.workspaceRoutingInstructions
    });
    if (input.completedWorkerResults?.length) context.completedWorkerResults = input.completedWorkerResults;
    context.availableEvidence = listCommunicationEvidenceForContext(ctx.store, {
      serverId: input.serverId, sourceMessageId: input.sourceMessageId,
      channelId: input.channelId, conversationId: input.conversationId ?? null
    });
    const executeTool = async (call: unknown) => {
      if (context.inboundBridgeFollowup && call && typeof call === "object" && "name" in call &&
          call.name === "send_workspace_bridge_message" && "arguments" in call && call.arguments &&
          typeof call.arguments === "object" && "bridgeId" in call.arguments && !("replyToRequestId" in call.arguments)) {
        const children = context.bridgeSteps?.filter((step) => step.status === "pending" &&
          step.bridgeId === (call as { arguments: { bridgeId: unknown } }).arguments.bridgeId) ?? [];
        if (children.length === 1) call = { ...call, arguments: { ...call.arguments,
          replyToRequestId: children[0]!.requestId, followupKind: context.inboundBridgeFollowup.kind } };
      }
      const toolName = assistantToolCallName(call);
      const sideEffectSignature = assistantSideEffectSignature(call);
      const acceptedSideEffect = sideEffectSignature ? acceptedSideEffects.get(sideEffectSignature) : undefined;
      if (acceptedSideEffect) {
        // 同一模型回合可能重复生成语义完全相同的写工具；复用首次回执，避免重复创建 execution 或 Bridge 请求。
        return repeatedSideEffectOutcome(call, acceptedSideEffect);
      }
      const journalStep = input.sourceContext.bridgeContinuationAttemptId && !assistantToolIsReadOnly(toolName)
        ? beginBridgeContinuationWriteStep(ctx.store, {
            attemptId: input.sourceContext.bridgeContinuationAttemptId,
            toolName,
            toolCallId: call && typeof call === "object" && "id" in call ? String(call.id) : "missing-call-id",
            ...(toolName === "send_workspace_bridge_message" && call && typeof call === "object" && "id" in call &&
                "arguments" in call && call.arguments && typeof call.arguments === "object" &&
                "bridgeId" in call.arguments && typeof call.arguments.bridgeId === "string"
              ? { externalIdempotencyKey: createHash("sha256")
                  .update(`${input.sourceMessageId}:${sideEffectSignature}`)
                  .digest("hex").slice(0, 64) }
              : {})
          })
        : null;
      if (journalStep?.reused) {
        const receipt = journalStep.state === "completed" ? journalStep.receipt : null;
        const outcome: AssistantToolLoopExecutionOutcome = { ok: true, result: {
          toolCallId: call && typeof call === "object" && "id" in call ? String(call.id) : "missing-call-id",
          toolName: toolName as TyrAssistantToolResult["toolName"],
          status: receipt ? "noop" : "partial",
          message: receipt ? "This step already has a saved receipt. No action was repeated."
            : "This step may already have been dispatched. Its receipt is unresolved; no action was repeated.",
          ...(receipt ? { bridgeRequestIds: receipt.bridgeRequestIds, executionIds: receipt.executionIds }
            : { data: { errorCode: "bridge_continuation_step_uncertain" } })
        } };
        for (const id of receipt?.bridgeRequestIds ?? []) observedBridgeRequestIds.add(id);
        for (const id of receipt?.executionIds ?? []) observedExecutionIds.add(id);
        if (!receipt) observedUncertainSideEffectToolNames.add(toolName);
        return outcome;
      }
      emitCommunicationAgentProgress(ctx, input, "running_action", communicationAgentProgressLabelForTool(call));
      let outcome;
      try {
        outcome = await executeTyrAssistantTool(ctx, {
          call,
          serverId: input.serverId,
          userId: input.userId,
          assistant: input.assistant,
          channelId: input.channelId,
          conversationId: input.conversationId,
          sourceMessageId: input.sourceMessageId,
          sourceContext: {
            ...input.sourceContext,
            ...(call && typeof call === "object" && "arguments" in call && call.arguments &&
              typeof call.arguments === "object" && "bridgeId" in call.arguments &&
              typeof call.arguments.bridgeId === "string" && followupRequests.has(call.arguments.bridgeId)
              ? { bridgeFollowupRequestId: followupRequests.get(call.arguments.bridgeId) } : {})
          },
          returnTarget: input.returnTarget,
          allowHandoff: input.allowHandoff
        });
      } catch (error) {
        if (journalStep) finishBridgeContinuationWriteStep(ctx.store, journalStep, { state: "uncertain" });
        // 写工具异常可能发生在副作用之后；没有确定回执时也必须禁止自动重放。
        if (!assistantToolIsReadOnly(toolName)) observedUncertainSideEffectToolNames.add(toolName);
        throw error;
      }
      if (journalStep) finishBridgeContinuationWriteStep(ctx.store, journalStep, {
        state: "completed",
        receipt: outcome.ok ? {
          bridgeRequestIds: outcome.result.bridgeRequestIds ?? [],
          executionIds: outcome.result.executionIds ?? [],
          status: outcome.result.status
        } : { bridgeRequestIds: [], executionIds: [], status: outcome.errorCode }
      });
      if (outcome.ok) {
        if (toolName === "send_workspace_bridge_message" && call && typeof call === "object" &&
            "arguments" in call && call.arguments && typeof call.arguments === "object" &&
            "replyToRequestId" in call.arguments && "bridgeId" in call.arguments &&
            typeof call.arguments.replyToRequestId === "string" && typeof call.arguments.bridgeId === "string" &&
            outcome.result.bridgeRequestIds?.includes(call.arguments.replyToRequestId)) {
          followupRequests.set(call.arguments.bridgeId, call.arguments.replyToRequestId);
        }
        if (toolName === "send_workspace_bridge_message" &&
            (outcome.result.data as { errorCode?: string } | undefined)?.errorCode === "bridge_destination_not_requested") {
          rejectedBridgeDestination = true;
        }
        const accepted = !["failed", "denied", "skipped", "confirmation_required"].includes(outcome.result.status);
        if (accepted) {
          observedCompletedToolNames.add(toolName);
          if (assistantToolIsReadOnly(toolName)) {
            const message = outcome.result.message.trim();
            if (message && !observedReadOnlyMessages.includes(message)) observedReadOnlyMessages.push(message);
          } else {
            // 已成功接受的写工具不能由 Assistant 超时恢复路径再次执行。
            observedSideEffectToolNames.add(toolName);
            if (sideEffectSignature) acceptedSideEffects.set(sideEffectSignature, outcome);
          }
        }
        for (const requestId of outcome.result.bridgeRequestIds ?? []) observedBridgeRequestIds.add(requestId);
        // execution id 是已发生副作用的回执；即使模型生成最终文案时失败也必须保留。
        for (const executionId of outcome.result.executionIds ?? []) observedExecutionIds.add(executionId);
        const data = outcome.result.data;
        const request = data && typeof data === "object" && !Array.isArray(data)
          ? (data as { request?: unknown }).request
          : null;
        if (request && typeof request === "object" && !Array.isArray(request)) {
          const value = request as Record<string, unknown>;
          if (
            typeof value.bridgeRequestId === "string" &&
            typeof value.state === "string" &&
            typeof value.peerWorkspaceName === "string"
          ) {
            const status = request as WorkspaceBridgeRequestStatusPayload;
            observedBridgeStatuses.set(status.bridgeRequestId, status);
          }
        }
      }
      emitCommunicationAgentProgress(ctx, input, "preparing_response", "Preparing response...");
      return outcome;
    };
    let result: AssistantToolLoopResult;
    while (true) {
      const totalTimeoutMs = config.totalTimeoutMs ?? ASSISTANT_TOOL_LOOP_TOTAL_TIMEOUT_MS;
      const remainingTotalMs = totalTimeoutMs - (Date.now() - toolLoopStartedAt);
      if (remainingTotalMs <= 0) {
        throw Object.assign(new Error("assistant_model_timeout"), { name: "TimeoutError" });
      }
      assistantToolLoopAttempts += 1;
      const attemptStartedAt = Date.now();
      try {
        result = ctx.assistantToolLoop
          ? await ctx.assistantToolLoop(context, executeTool)
          : await requestAssistantToolLoop(context, {
              ...config,
              executeTool,
              onRequestMetrics: (metrics) => {
                // Record transport metadata only; prompts, replies, reasoning and credentials stay out of audit.
                ctx.store.recordAuditEvent({
                  kind: "communication_agent_model_request",
                  actorType: "agent",
                  actorId: input.assistant.id,
                  resourceType: "message",
                  resourceId: input.sourceMessageId,
                  serverId: input.serverId,
                  metadata: {
                    source: input.sourceContext.source,
                    continuationKind: input.bridgeContinuation ? "bridge" : input.workerContinuation ? "worker" : "initial",
                    inboundBridgeContext: Boolean(context.inboundBridge),
                    ...metrics
                  }
                });
              },
              timeoutMs: Math.min(
                config.timeoutMs ?? ASSISTANT_LLM_REQUEST_TIMEOUT_MS,
                remainingTotalMs
              ),
              totalTimeoutMs: remainingTotalMs
            });
        modelAttemptElapsedMs.push(Date.now() - attemptStartedAt);
        if (assistantToolLoopAttempts > 1) {
          try {
            ctx.store.recordAuditEvent({
              kind: "communication_agent_tool_loop_retry_succeeded",
              actorType: "agent",
              actorId: input.assistant.id,
              resourceType: "message",
              resourceId: input.sourceMessageId,
              serverId: input.serverId,
              metadata: {
                source: input.sourceContext.source,
                model: config.model,
                modelAttempts: assistantToolLoopAttempts,
                modelAttemptElapsedMs,
                modelAttemptErrorCodes,
                totalElapsedMs: Date.now() - toolLoopStartedAt,
                hasSideEffects: false
              }
            });
          } catch {
            // 可观测性旁路故障不能覆盖已经恢复的 Assistant 回复。
          }
        }
        break;
      } catch (error) {
        const failure = assistantLlmFailureDiagnostics(error);
        modelAttemptElapsedMs.push(Date.now() - attemptStartedAt);
        modelAttemptErrorCodes.push(failure.code);
        // 只有首轮模型超时且服务端没有任何派发/写入回执时才可安全重试，避免重复执行外部副作用。
        const canRetryWithoutReplay = assistantToolLoopAttempts === 1 &&
          failure.code === "assistant_model_timeout" &&
          observedCompletedToolNames.size === 0 &&
          observedSideEffectToolNames.size === 0 &&
          observedUncertainSideEffectToolNames.size === 0 &&
          observedBridgeRequestIds.size === 0 &&
          observedExecutionIds.size === 0 &&
          Date.now() - toolLoopStartedAt < totalTimeoutMs;
        if (!canRetryWithoutReplay) throw error;
      }
    }
    if (result.recoveredInboundOutboundDenial) {
      try {
        ctx.store.recordAuditEvent({
          kind: "communication_agent_peer_outbound_recovered",
          actorType: "agent", actorId: input.assistant.id,
          resourceType: "message", resourceId: input.sourceMessageId,
          serverId: input.serverId,
          metadata: { source: input.sourceContext.source, parentBridgeRequestId: input.sourceContext.parentBridgeRequestId ?? null }
        });
      } catch {
        // Diagnostics cannot replace TYR's recovered business reply.
      }
    }
    const draft = persistModelConfirmation(ctx, input, result);
    // The last successful explicit selection defines the reply's disclosure set.
    const selectionStep = [...result.steps].reverse().find((step) =>
      assistantToolCallName(step.rawCall) === "select_result_evidence");
    const selections = selectionStep?.result?.status === "completed"
      ? (selectionStep.result.data as { evidenceSelections?: CommunicationEvidenceSelection[] } | undefined)?.evidenceSelections : undefined;
    if (Array.isArray(selections) && selections.length) draft.evidenceSelections = selections;
    return rejectedBridgeDestination ? { ...draft, rejectedBridgeDestination: true } : draft;
  } catch (error) {
    const failure = assistantLlmFailureDiagnostics(error);
    const errorCode = failure.code;
    try {
      // Tool Loop 异常必须留下稳定诊断，同时不能把 provider 原文或用户内容写入审计。
      ctx.store.recordAuditEvent({
        kind: "communication_agent_tool_loop_failed",
        actorType: "agent",
        actorId: input.assistant.id,
        resourceType: "message",
        resourceId: input.sourceMessageId,
        serverId: input.serverId,
        metadata: {
          errorCode,
          source: input.sourceContext.source,
          model: ctx.assistantLlmConfig?.model ?? null,
          modelAttempts: assistantToolLoopAttempts,
          modelTurn: failure.modelTurn ?? null,
          elapsedMs: Date.now() - toolLoopStartedAt,
          lastAttemptElapsedMs: failure.elapsedMs ?? modelAttemptElapsedMs.at(-1) ?? null,
          modelAttemptElapsedMs,
          modelAttemptErrorCodes,
          totalElapsedMs: Date.now() - toolLoopStartedAt,
          ...(failure.requestMetrics ? { requestMetrics: failure.requestMetrics } : {}),
          hasSideEffects: observedSideEffectToolNames.size > 0 ||
            observedUncertainSideEffectToolNames.size > 0 ||
            observedBridgeRequestIds.size > 0 ||
            observedExecutionIds.size > 0,
          completedToolNames: [...observedCompletedToolNames],
          sideEffectToolNames: [...observedSideEffectToolNames],
          uncertainSideEffectToolNames: [...observedUncertainSideEffectToolNames],
          bridgeRequestIds: [...observedBridgeRequestIds],
          executionIds: [...observedExecutionIds]
        }
      });
    } catch {
      // 审计旁路故障不能覆盖下面的确定性用户回复。
    }
    if (observedBridgeRequestIds.size > 0) {
      const statuses = [...observedBridgeStatuses.values()];
      const terminal = statuses.length > 0 && statuses.every((status) => (
        status.state === "completed" || status.state === "failed"
      ));
      const bridgeReplies = statuses.map((status) => ({
        status,
        reply: workspaceBridgeReplyText(status)
      }));
      const singleBridge = bridgeReplies.length === 1 ? bridgeReplies[0]! : null;
      const bridgeRequest = singleBridge
        ? ctx.store.getCrossWorkspaceMessage(singleBridge.status.bridgeRequestId)
        : null;
      const content = bridgeReplies.length > 0
        ? bridgeReplies.map(({ reply }) => reply.content).join("\n\n")
        : "The Workspace Bridge requests were sent. Their responses will be posted in this conversation.";
      return {
        content,
        bridgeRequestIds: [...observedBridgeRequestIds],
        ...(!terminal ? { bridgeRequestPending: true } : {}),
        outcomeStatus: statuses.some((status) => status.state !== "completed" && status.state !== "failed")
          ? "running"
          : statuses.some((status) => status.state === "failed")
            ? "failed"
            : statuses.length > 0
              ? "completed"
              : "running",
        ...(singleBridge
          ? { result: workspaceBridgeMessageResult(singleBridge.status, singleBridge.reply.resultBody, bridgeRequest?.content) }
          : {})
      };
    }
    if (observedExecutionIds.size > 0) {
      return {
        content: "The request was sent to the Agent. I’ll report back here when it responds.",
        executionIds: [...observedExecutionIds],
        outcomeStatus: "running"
      };
    }
    return assistantFailureReply({
      code: errorCode,
      sourceMessageId: input.sourceMessageId,
      assistantName: input.assistant.displayName,
      readOnlyMessages: input.sourceContext.accessMode === "workspace_bridge" ? [] : observedReadOnlyMessages,
      sideEffectToolNames: [...observedSideEffectToolNames]
    });
  }
}

function ambiguousWorkspaceBridgeRetryReply(ctx: ServerRouteContext, input: {
  content: string;
  channelId: string;
  conversationId?: string;
  sourceMessageId: string;
  sourceContext: CommunicationAgentSourceContext;
}): CommunicationAgentReplyDraft | null {
  if (input.sourceContext.accessMode === "workspace_bridge") return null;
  const normalized = input.content.trim().replace(/\s+/g, " ").toLowerCase();
  const copiedGenericFailure = normalized === `the request repeatedly failed to go through -- "i couldn't complete that request automatically. please try again."`
    || normalized === `i couldn't complete that request automatically. please try again.`;
  const bridgeRetryWithoutPayload = /^(?:please )?(?:retry|try again|resend)(?: (?:that|it|the failed))? (?:workspace )?bridge (?:message|request)[.!]?$/.test(normalized);
  if (!copiedGenericFailure && !bridgeRetryWithoutPayload) return null;
  const messages = input.conversationId
    ? ctx.store.readConversationHistory(input.conversationId, 20)?.messages ?? []
    : ctx.store.listMessages(input.channelId, 20);
  const sourceIndex = messages.findIndex((message) => message.id === input.sourceMessageId);
  const priorMessage = (sourceIndex >= 0 ? messages.slice(0, sourceIndex) : messages)
    .reverse()
    .find((message) => message.senderType !== "system");
  const priorBridgeResult = priorMessage?.result?.workspaceBridge;
  const persistedBridgeRequest = priorBridgeResult?.bridgeRequestId
    ? ctx.store.getCrossWorkspaceMessage(priorBridgeResult.bridgeRequestId)
    : null;
  const persistedBridgeFailure = persistedBridgeRequest
    ? ctx.store.listCrossWorkspaceMessages(persistedBridgeRequest.bridgeId, {
        conversationId: persistedBridgeRequest.conversationId ?? undefined
      }).some((message) => (
        message.replyToMessageId === persistedBridgeRequest.id &&
        message.responseKind === "error" &&
        message.outcome === "failed"
      ))
    : false;
  const hasPersistedFailedBridge = Boolean(
    priorMessage?.senderType === "agent" &&
    priorBridgeResult?.state === "failed" &&
    persistedBridgeRequest?.bridgeId === priorBridgeResult.bridgeId &&
    persistedBridgeFailure
  );
  return {
    // 只有持久化 Bridge request 才能进入不可变重试；通用 Assistant 错误不能伪造 Bridge 卡片。
    content: hasPersistedFailedBridge
      ? "I won’t guess which Bridge payload to resend. Open the failed Bridge message and choose Try again, or paste the exact message you want sent."
      : "No Workspace Bridge request was created for that failed Assistant response. Retry the original Assistant request, or paste the exact message you want sent."
  };
}

function parseCommunicationAgentPendingActionCommand(content: string): CommunicationAgentPendingActionCommand | null {
  const normalized = content.trim().toLowerCase();
  if (/^\/?confirm$/.test(normalized)) return "confirm";
  if (/^\/?cancel$/.test(normalized)) return "cancel";
  return null;
}

async function communicationAgentPendingActionCommandReply(ctx: ServerRouteContext, input: {
  serverId: string;
  userId: string;
  assistant: AgentRecord;
  channelId: string;
  conversationId?: string;
  sourceMessageId?: string;
  returnTarget?: CommunicationAgentReturnTarget;
}, command: CommunicationAgentPendingActionCommand): Promise<CommunicationAgentReplyDraft> {
  const pending = ctx.store.getLatestCommunicationAgentPendingAction({
    serverId: input.serverId,
    userId: input.userId,
    assistantAgentId: input.assistant.id,
    channelId: input.channelId
  });
  if (!pending) return { content: "No pending route suggestion to confirm. Ask me who can handle it first." };
  if (pending.status === "expired") return { content: "The pending route suggestion expired. Ask me who can handle it again." };

  if (command === "cancel") {
    ctx.store.resolveCommunicationAgentPendingAction(pending.id, "cancelled");
    return { content: "Cancelled the pending route suggestion." };
  }

  const serverRecord = ctx.store.listServersForUser(input.userId).find((item) => item.id === input.serverId);
  if (!serverRecord || serverRecord.role === "guest") {
    return { content: "I can confirm route suggestions for workspace owners and members only." };
  }

  const targetAgent = ctx.store.getAgent(pending.targetAgentId);
  const targetMachine = targetAgent?.machineId ? ctx.store.getMachine(targetAgent.machineId) : null;
  const targetAgentReady = targetAgent?.status === "online" || targetAgent?.status === "working";
  if (!targetAgent || isCommunicationAgent(targetAgent) || !targetAgent.runtime || !targetAgentReady || !targetMachine || targetMachine.status !== "online") {
    // 推荐结果是可过期的库存快照；确认时目标不可执行，就废弃旧建议，要求用户重新询问。
    ctx.store.resolveCommunicationAgentPendingAction(pending.id, "cancelled");
    return { content: "That route is no longer available. Ask me who can handle it again." };
  }

  // 确认后的执行与直接路由共用固定 Agent pair DM；不能把 TYR 注入目标的 Human-Agent DM。
  const dispatched = await communicationAgentDirectHandoffReply(ctx, {
    ...input, detail: `Starting @${targetAgent.name} from TYR confirmation.`
  }, targetAgent, pending.instruction);
  if (!dispatched.executionIds?.length) return dispatched;

  ctx.store.resolveCommunicationAgentPendingAction(pending.id, "confirmed");
  ctx.store.recordAuditEvent({
    kind: "communication_agent_route_confirmed",
    actorType: "user",
    actorId: input.userId,
    resourceType: "agent",
    resourceId: targetAgent.id,
    serverId: input.serverId,
    metadata: {
      pendingActionId: pending.id,
      ...(dispatched.messageId ? { handoffMessageId: dispatched.messageId } : {}),
      instruction: pending.instruction
    }
  });
  ctx.store.recordActivity(input.assistant.id, "routing", `Confirmed route to ${targetAgent.displayName}.`);
  return {
    content: `Confirmed. I asked ${targetAgent.displayName}:\n${pending.instruction}`,
    executionIds: dispatched.executionIds
  };
}

async function communicationAgentDirectHandoffReply(ctx: ServerRouteContext, input: {
  serverId: string;
  userId: string;
  assistant: AgentRecord;
  channelId: string;
  conversationId?: string;
  sourceMessageId?: string;
  returnTarget?: CommunicationAgentReturnTarget;
  sourceContext?: CommunicationAgentSourceContext;
  detail?: string;
}, targetAgent: AgentRecord, instruction: string): Promise<CommunicationAgentReplyDraft> {
  const member = ctx.store.listServersForUser(input.userId).find((server) => server.id === input.serverId);
  if (!member || member.role === "guest") return { content: "I can route requests for workspace owners and members only." };
  try {
    if (input.sourceContext?.parentBridgeRequestId) {
      verifyIncomingBridgeLocalRequest(ctx, { ...input, sourceContext: input.sourceContext });
    } else {
      const route = await prepareInitialCommunicationRoute(ctx, input);
      const question = routeClarification(route);
      if (question) return { content: question, outcomeStatus: "partial", result: {
        version: 1, status: "partial", title: "TYR needs your input", summary: question,
        ...(input.sourceMessageId ? { communicationRequest: { sourceMessageId: input.sourceMessageId } } : {})
      } };
      if (route.plan?.continuationRequestId && route.targetBridgeId && input.sourceMessageId) {
        const source = ctx.store.getMessage(input.sourceMessageId)!;
        const outcome = await executeTyrAssistantTool(ctx, { ...input,
          sourceContext: input.sourceContext ?? webCommunicationAgentSourceContext(source),
          allowHandoff: true,
          call: { id: `followup_${source.id}`, name: "send_workspace_bridge_message", arguments: {
            bridgeId: route.targetBridgeId, replyToRequestId: route.plan.continuationRequestId,
            followupKind: "instruction", message: source.content
          } }
        });
        return { content: outcome.ok ? outcome.result.message : outcome.message,
          outcomeStatus: !outcome.ok || outcome.result.status === "failed" || outcome.result.status === "denied" ? "failed"
            : outcome.result.status === "completed" ? "completed"
              : outcome.result.status === "queued" || outcome.result.status === "running" ? "running" : "partial",
          ...(outcome.ok ? { bridgeRequestIds: outcome.result.bridgeRequestIds } : {}) };
      }
    }
  } catch (error) {
    const content = error instanceof CommunicationRoutePlanningError ? error.publicMessage
      : "TYR could not verify the request route. No Agent request was sent.";
    return { content, outcomeStatus: "failed", result: {
      version: 1, status: "failed", title: "TYR could not prepare the request", summary: content
    } };
  }
  // Legacy routes also await planning; accepting the request is not authorization for a later dispatch.
  const sourceContext = restoreMcpCommunicationAuthority(ctx.store, {
    sourceMessageId: input.sourceMessageId ?? "", userId: input.userId, serverId: input.serverId,
    channelId: input.channelId, conversationId: input.conversationId,
    sourceContext: input.sourceContext ?? {
      source: input.returnTarget?.source ?? "web",
      sourceConversationKey: input.conversationId ?? input.channelId,
      sourceEventKey: input.sourceMessageId ?? input.channelId,
      ...(input.returnTarget?.externalRef ? { externalRef: input.returnTarget.externalRef } : {})
    }
  });
  if (sourceContext.mcpAuthorizationError) {
    return blockedMcpAuthorizationDraft(mcpAuthorizationFailureMessage(sourceContext.mcpAuthorizationError), input.sourceMessageId ?? "");
  }
  if (sourceContext.source === "mcp" && (sourceContext.accessMode === "read_only" || !sourceContext.grantedScopes?.includes("tyr:manage"))) {
    return blockedMcpAuthorizationDraft("This request is Read-only. Start a new authorized Action request to execute it.", input.sourceMessageId ?? "");
  }
  input = { ...input, sourceContext };
  return dispatchCommunicationAgentHandoff(ctx, {
    ...input,
    publicReplyAudience: input.sourceContext?.accessMode === "workspace_bridge" ? "workspace_bridge" : "local",
    ...(input.sourceContext?.systemTrigger?.kind === "heartbeat"
      ? { executionPolicy: input.sourceContext.systemTrigger }
      : {})
  }, targetAgent, instruction);
}

function parseCommunicationAgentInventoryCommand(content: string): CommunicationAgentInventoryCommand | null {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^\/?help$/.test(normalized)) return "help";
  if (/^\/?(status|show status|workspace status|show workspace status)$/.test(normalized)) return "status";
  if (/^(list|show) (my )?(computers|machines|devices)$/.test(normalized)) return "list_computers";
  if (/^(list|show) (my )?agents$/.test(normalized)) return "list_agents";
  // 客户把 Computer 称为 device；组合库存查询必须绕过 LLM，避免从 Agent 反向推导时漏掉空 Computer。
  const combinedInventory = /^(?:list|show)(?: all)? (?:(?:agents? and (?:computers?|machines?|devices?))|(?:(?:computers?|machines?|devices?) and agents?))(?: connected)?$/.test(normalized)
    || /^what (?:(?:agents? and (?:computers?|machines?|devices?))|(?:(?:computers?|machines?|devices?) and agents?)) are connected$/.test(normalized);
  if (combinedInventory) return "list_inventory";
  return null;
}

function communicationAgentHelpText(): string {
  // Computer / Agent 能力行由 Registry 决定；路由能力不属于本期 Operation scope，继续保留在本地。
  const operationLines = buildTyrAssistantHelpEntries()
    .map((entry) => `- ${entry.text}: ${entry.example}`);
  return [
    "TYR can:",
    ...operationLines,
    "- Suggest route: who can review code?",
    "",
    "I am the workspace Communication Agent. I can read workspace inventory, suggest routing, and route clear requests directly."
  ].join("\n");
}

function communicationAgentWorkspaceStatusText(ctx: ServerRouteContext, input: {
  serverId: string;
  userId: string;
  assistant: AgentRecord;
}): string {
  const server = ctx.store.listServersForUser(input.userId).find((item) => item.id === input.serverId);
  const machines = ctx.store.listMachines(input.serverId);
  // Communication Agent 是消息中枢，不是可执行 worker；状态统计只计算真正绑定设备/runtime 的 agent。
  const executableAgents = ctx.store.listAgents(input.serverId).filter((agent) => !isCommunicationAgent(agent));
  const onlineAgents = executableAgents.filter((agent) => agent.status === "online" || agent.status === "working");
  return [
    "Workspace status",
    `Workspace: ${server?.name ?? input.serverId}`,
    `TYR: ${input.assistant.status}`,
    `Devices: ${machines.length} total, ${machines.filter((machine) => machine.status === "online").length} online`,
    `Agents: ${executableAgents.length} executable, ${onlineAgents.length} online`,
    "Try: list devices, list agents, add device named Office Mac"
  ].join("\n");
}

function communicationAgentComputerListText(ctx: ServerRouteContext, serverId: string): string {
  const machines = ctx.store.listMachines(serverId);
  if (!machines.length) {
    return [
      "Devices",
      "No devices are connected yet.",
      "Ask me to add device named Office Mac and I will create a short-lived onboarding link."
    ].join("\n");
  }
  const lines = machines.map((machine) => {
    const availableRuntimes = ctx.store.listRuntimeReports(machine.id)
      .filter((runtime) => runtime.status === "available")
      .map(formatRuntimeAvailability);
    return `- ${machine.name} (${machine.status}) - ${machine.os || "unknown OS"} - Runtimes: ${availableRuntimes.join(", ") || "none available"}`;
  });
  return ["Devices", ...lines].join("\n");
}

function communicationAgentAgentListText(ctx: ServerRouteContext, serverId: string): string {
  const machinesById = new Map(ctx.store.listMachines(serverId).map((machine) => [machine.id, machine]));
  const agents = ctx.store.listAgents(serverId).filter((agent) => !isCommunicationAgent(agent));
  if (!agents.length) {
    return [
      "Agents",
      "No executable agents are available yet.",
      "Create an agent on a connected device before asking me to route work."
    ].join("\n");
  }
  const lines = agents.map((agent) => {
    const machine = agent.machineId ? machinesById.get(agent.machineId) : undefined;
    return [
      `- ${agent.displayName} (${agent.status}) - Runtime: ${agent.runtime ?? "none"} - Device: ${machine?.name ?? "none"}`,
      `  Agent Profile Prompt: ${agentProfilePromptText(agent)}`
    ].join("\n");
  });
  return ["Agents", ...lines].join("\n");
}

function communicationAgentInventoryListText(ctx: ServerRouteContext, serverId: string): string {
  // Computer 与 Agent 分别读取服务端真源，确保没有绑定 Agent 的 Computer 仍出现在库存中。
  return [
    "Workspace inventory",
    "",
    communicationAgentComputerListText(ctx, serverId),
    "",
    communicationAgentAgentListText(ctx, serverId)
  ].join("\n");
}

function agentDetailsCandidates(ctx: ServerRouteContext, serverId: string): AgentDetailsCandidate[] {
  const machinesById = new Map(ctx.store.listMachines(serverId).map((machine) => [machine.id, machine]));
  // TYR 是通信中枢而非可执行 Agent，不能通过 worker 详情查询暴露其内部配置。
  return ctx.store.listAgents(serverId)
    .filter((agent) => !isCommunicationAgent(agent))
    .map((agent) => ({
      agent,
      machine: agent.machineId ? machinesById.get(agent.machineId) ?? null : null
    }));
}

function communicationAgentDetailsReply(ctx: ServerRouteContext, serverId: string, content: string): CommunicationAgentReplyDraft | null {
  const candidates = agentDetailsCandidates(ctx, serverId);
  const match = parseAgentDetailsQuery({ content, candidates });
  if (match.kind === "not_query") return null;
  if (match.kind === "ambiguous") {
    const matchingIds = new Set(match.agentReferences);
    return { content: formatAgentDetailsAmbiguousReply(candidates.filter((candidate) => matchingIds.has(candidate.agent.id))) };
  }
  const candidate = candidates.find((item) => item.agent.id === match.intent.agentReference);
  if (!candidate) return null;
  return {
    content: formatAgentDetailsReply(candidate, match.intent.field),
    ...(match.intent.field === "id" ? { allowedAgentIds: [candidate.agent.id] } : {})
  };
}

function communicationAgentCapabilityText(ctx: ServerRouteContext, serverId: string, content: string): string | null {
  if (!/(what can|capabilit|can .* do)/i.test(content)) return null;
  const machines = ctx.store.listMachines(serverId);
  const machinesById = new Map(machines.map((machine) => [machine.id, machine]));
  const agents = ctx.store.listAgents(serverId).filter((agent) => !isCommunicationAgent(agent));
  const matchedAgent = findMentionedAgent(agents, content);
  if (matchedAgent) return describeExecutableAgent(ctx, matchedAgent, matchedAgent.machineId ? machinesById.get(matchedAgent.machineId) : undefined);
  const matchedMachine = findMentionedMachine(machines, content);
  if (matchedMachine) return describeComputer(ctx, matchedMachine, agents.filter((agent) => agent.machineId === matchedMachine.id));
  return null;
}

function findMentionedAgent(agents: AgentRecord[], content: string): AgentRecord | null {
  const normalized = content.toLowerCase();
  return [...agents]
    .sort((a, b) => b.displayName.length - a.displayName.length)
    .find((agent) => normalized.includes(agent.displayName.toLowerCase()) || normalized.includes(agent.name.toLowerCase())) ?? null;
}

function findMentionedMachine(machines: MachineRecord[], content: string): MachineRecord | null {
  const normalized = content.toLowerCase();
  return [...machines]
    .sort((a, b) => b.name.length - a.name.length)
    .find((machine) => normalized.includes(machine.name.toLowerCase()) || normalized.includes(machine.hostname.toLowerCase())) ?? null;
}

function describeExecutableAgent(ctx: ServerRouteContext, agent: AgentRecord, machine: MachineRecord | undefined): string {
  const scopes = ctx.store.getAgentScopes(agent.id)?.granted ?? [];
  return [
    `${agent.displayName}`,
    `Status: ${agent.status}`,
    `Runtime: ${agent.runtime ?? "none"}`,
    `Device: ${machine?.name ?? "none"}`,
    `Agent Profile Prompt: ${agentProfilePromptText(agent)}`,
    `Capabilities: ${scopes.join(", ") || "none"}`,
    "Ask me to route a clear request to this agent when you want me to start a handoff."
  ].join("\n");
}

function describeComputer(ctx: ServerRouteContext, machine: MachineRecord, agents: AgentRecord[]): string {
  const availableRuntimes = ctx.store.listRuntimeReports(machine.id).filter((runtime) => runtime.status === "available");
  return [
    `${machine.name}`,
    `Status: ${machine.status}`,
    `OS: ${machine.os || "unknown"}`,
    `Available runtimes: ${availableRuntimes.map((runtime) => runtimeDisplayName(runtime.runtime)).join(", ") || "none"}`,
    `Agents: ${agents.map((agent) => agent.displayName).join(", ") || "none"}`,
    "Ask me to route a clear request to one of these agents when you want me to start a handoff."
  ].join("\n");
}

function formatRuntimeAvailability(runtime: RuntimeReport): string {
  const name = runtime.displayName || runtimeDisplayName(runtime.runtime);
  return `${name} ${runtime.status}`;
}

async function communicationAgentRoutingSuggestionText(ctx: ServerRouteContext, input: {
  content: string;
  serverId: string;
  userId: string;
  assistant: AgentRecord;
  channelId: string;
  conversationId?: string;
  sourceMessageId: string;
  allowHandoff: boolean;
}): Promise<CommunicationAgentReplyDraft | null> {
  if (!isRoutingQuestion(input.content)) return null;
  const machinesById = new Map(ctx.store.listMachines(input.serverId).map((machine) => [machine.id, machine]));
  const requestTokens = routingTokens(input.content);
  const agents = ctx.store.listAgents(input.serverId).filter((agent) => !isCommunicationAgent(agent));
  const candidates = agents
    .map((agent) => scoreRoutingCandidate(agent, agent.machineId ? machinesById.get(agent.machineId) : undefined, requestTokens, input.content))
    .sort((a, b) => b.score - a.score || a.agent.displayName.localeCompare(b.agent.displayName));
  const supportingTargets = routingSupportingDevices(ctx.store.listDevices(input.serverId), requestTokens, input.content);
  const recommended = candidates.find((candidate) => candidate.score >= 40);
  if (!recommended) return { content: noRoutingCandidateText(supportingTargets) };
  const instruction = routingInstructionText(input.content);
  if (isRouteExecutionRequest(input.content)) {
    if (!input.allowHandoff) return { content: communicationAgentHandoffDisabledText(recommended.agent, instruction) };
    const targetMachine = recommended.agent.machineId ? ctx.store.getMachine(recommended.agent.machineId) : null;
    const targetAgentReady = recommended.agent.status === "online" || recommended.agent.status === "working";
    if (!recommended.agent.runtime || !targetAgentReady || !targetMachine || targetMachine.status !== "online") {
      return { content: "That route is not available right now. Ask me who can handle it again." };
    }
    return communicationAgentDirectHandoffReply(ctx, input, recommended.agent, instruction);
  }
  const otherCandidates = candidates
    .filter((candidate) => candidate.agent.id !== recommended.agent.id)
    .slice(0, 3)
    .map(formatRoutingOtherCandidate);
  const content = [
    `Recommended route: ${recommended.agent.displayName}`,
    "",
    "Why:",
    ...recommended.reasons.map((reason) => `- ${reason}`),
    ...(otherCandidates.length ? ["", "Other candidates:", ...otherCandidates] : []),
    ...(supportingTargets.length ? ["", "Supporting targets:", ...supportingTargets] : []),
    "",
    `Ask me to route this to ${recommended.agent.displayName} when you want me to start the handoff.`,
    `Suggested instruction: ${instruction}`
  ].join("\n");
  return { content };
}

async function communicationAgentHeartbeatHandoffReply(ctx: ServerRouteContext, input: {
  content: string;
  serverId: string;
  userId: string;
  assistant: AgentRecord;
  channelId: string;
  conversationId?: string;
  sourceMessageId: string;
  sourceContext: CommunicationAgentSourceContext;
  returnTarget?: CommunicationAgentReturnTarget;
  allowHandoff: boolean;
}): Promise<CommunicationAgentReplyDraft> {
  const instruction = input.content
    .replace(/^\[Scheduled Heartbeat\][^\n]*\n*/i, "")
    .replace(/\n+Scheduled for:[^\n]*/i, "")
    .replace(/\n+Choose the most appropriate currently online child Agent,[\s\S]*$/i, "")
    .replace(/\n+Choose exactly one most appropriate currently online child Agent,[\s\S]*$/i, "")
    .trim();
  const machinesById = new Map(ctx.store.listMachines(input.serverId).map((machine) => [machine.id, machine]));
  const candidates = ctx.store.listAgents(input.serverId)
    .filter((agent) => !isCommunicationAgent(agent) && Boolean(agent.runtime) && (agent.status === "online" || agent.status === "working"))
    .map((agent) => ({ agent, machine: agent.machineId ? machinesById.get(agent.machineId) : undefined }))
    .filter((candidate) => candidate.machine?.status === "online")
    .map(({ agent, machine }) => scoreRoutingCandidate(agent, machine, routingTokens(instruction), instruction))
    .sort((left, right) => right.score - left.score || left.agent.displayName.localeCompare(right.agent.displayName));
  const selected = candidates[0];
  if (!selected || !instruction) {
    return { content: "This Heartbeat could not be delegated because no suitable online child Agent was available.", outcomeStatus: "failed" };
  }
  // Heartbeat 的目标由 TYR 路由评分在触发时选择，不把定时任务永久绑定到某个子 Agent。
  ctx.store.recordActivity(input.assistant.id, "heartbeat", `Routed scheduled work to ${selected.agent.displayName}.`);
  return communicationAgentDirectHandoffReply(ctx, input, selected.agent, instruction);
}

function routingInstructionText(content: string): string {
  const normalized = content.trim().replace(/[?？!！。]+$/g, "").replace(/\s+/g, " ");
  const patterns = [
    /^who can\s+(.+)$/i,
    /^which agent can\s+(.+)$/i,
    /^who should\s+(.+)$/i,
    /^which agent is available for\s+(.+)$/i,
    /^can handle\s+(.+)$/i,
    /^route this\s*:?\s*(.+)$/i,
    /^(?:please\s+)?ask\s+@?\s*(?:[a-z][a-z0-9_-]{1,40}|agent\s+[a-z0-9_-]+)\s+to\s+(.+)$/i
  ];
  const matched = patterns
    .map((pattern) => normalized.match(pattern)?.[1]?.trim())
    .find((item): item is string => Boolean(item));
  const instruction = matched || normalized;
  // 这里把路由问题转换为目标 agent 能直接执行的命令，避免把“谁能做”原句交给 worker。
  return `${instruction.charAt(0).toUpperCase()}${instruction.slice(1)}${/[.!?]$/.test(instruction) ? "" : "."}`;
}

function isRoutingQuestion(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  return /\bwho can\b/.test(normalized) ||
    /\bwhich agent\b/.test(normalized) ||
    /\bwho should\b/.test(normalized) ||
    /\bwho can handle\b/.test(normalized) ||
    /\bcan handle\b/.test(normalized) ||
    /\brecommend(?:ed)? route\b/.test(normalized) ||
    /\broute this\b/.test(normalized) ||
    isEnglishDirectAgentRequest(normalized) ||
    isChineseRouteExecutionRequest(normalized);
}

function isRouteExecutionRequest(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  return /\broute this\b/.test(normalized) ||
    /\bplease route\b/.test(normalized) ||
    /\bstart (?:the )?handoff\b/.test(normalized) ||
    isEnglishDirectAgentRequest(normalized) ||
    isChineseRouteExecutionRequest(normalized);
}

function isEnglishDirectAgentRequest(content: string): boolean {
  // English Telegram/Web users often say "ask agent1 to ..."; treat that as an explicit target-agent handoff, not a generic help prompt.
  return /^(?:please\s+)?ask\s+@?\s*(?:[a-z][a-z0-9_-]{1,40}|agent\s+[a-z0-9_-]+)\s+to\s+.+/i.test(content.trim());
}

function isChineseRouteExecutionRequest(content: string): boolean {
  return /(?:让|请|交给|发给|发送给|转给|派给)\s*@?\s*[a-z][a-z0-9 _-]{1,40}/i.test(content);
}

function routingTokens(content: string): string[] {
  const stopWords = new Set(["who", "can", "which", "agent", "handle", "this", "that", "the", "for", "with", "should", "available"]);
  return Array.from(new Set(content.toLowerCase().match(/[a-z0-9]+/g) ?? []))
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

function scoreRoutingCandidate(agent: AgentRecord, machine: MachineRecord | undefined, tokens: string[], content: string): RoutingCandidate {
  const nameSearchable = `${agent.displayName} ${agent.name}`.toLowerCase();
  const profilePrompt = agent.description?.trim() ?? "";
  const profileSearchable = profilePrompt.toLowerCase();
  const runtimeSearchable = `${agent.runtime ?? ""}`.toLowerCase();
  const normalizedAgentReferenceText = normalizeAgentReferenceText(content);
  const matchedAgentReference = agentReferenceAliases(agent).find((alias) => normalizedAgentReferenceText.includes(alias));
  const matchedNameTokens = tokens.filter((token) => nameSearchable.includes(token)).sort();
  const matchedProfilePromptTokens = tokens.filter((token) => profileSearchable.includes(token)).sort();
  const matchedRuntimeTokens = tokens.filter((token) => runtimeSearchable.includes(token)).sort();
  const reasons: string[] = [];
  let score = 0;
  if (matchedProfilePromptTokens.length) {
    // The user-facing description is the Agent Profile Prompt: it is the primary routing signal in v1.
    score += Math.min(42, matchedProfilePromptTokens.length * 14);
    reasons.push(`Matched profile prompt terms: ${matchedProfilePromptTokens.join(", ")}`);
  }
  if (matchedNameTokens.length) {
    score += Math.min(18, matchedNameTokens.length * 8);
    reasons.push(`Matched agent name terms: ${matchedNameTokens.join(", ")}`);
  }
  if (matchedAgentReference) {
    score += 32;
    reasons.push(`Matched agent reference: ${agent.displayName}`);
  }
  if (matchedRuntimeTokens.length) score += Math.min(8, matchedRuntimeTokens.length * 4);
  reasons.push(`Agent Profile Prompt: ${agentProfilePromptText(agent)}`);
  if (isCodingRequest(content) && (agent.runtime === "codex" || agent.runtime === "claude")) {
    score += 12;
    reasons.push(`Runtime: ${agent.runtime}`);
  } else {
    reasons.push(`Runtime: ${agent.runtime ?? "none"}`);
  }

  // Routing v1 只建议，不唤醒 agent；因此在线和宿主在线性是最重要的排序信号。
  if (agent.status === "online") score += 30;
  else if (agent.status === "working") score += 10;
  else if (agent.status === "offline") score -= 25;
  else score -= 35;
  if (machine?.status === "online") score += 20;
  else if (machine) score -= 45;
  else score -= 20;

  reasons.push(`Status: ${agent.status}`);
  reasons.push(`Device: ${machine?.name ?? "none"}`);
  return {
    agent,
    machine,
    score,
    reasons,
    statusLabel: routingCandidateStatusLabel(agent, machine)
  };
}

function normalizeAgentReferenceText(value: string): string {
  return value.toLowerCase().replace(/[@\s_-]+/g, "");
}

function agentReferenceAliases(agent: AgentRecord): string[] {
  return Array.from(new Set([agent.name, agent.displayName]
    .map(normalizeAgentReferenceText)
    .filter((alias) => alias.length >= 3)));
}

function agentProfilePromptText(agent: AgentRecord): string {
  return agent.description?.trim() || "Not set";
}

function isCodingRequest(content: string): boolean {
  return /\b(code|coding|repo|repository|review|changes|bug|fix|program|develop)\b/i.test(content);
}

function routingCandidateStatusLabel(agent: AgentRecord, machine: MachineRecord | undefined): string {
  if (machine && machine.status !== "online") return `${agent.status}, device ${machine.status}`;
  if (agent.status === "working") return "working, busy";
  return agent.status;
}

function formatRoutingOtherCandidate(candidate: RoutingCandidate): string {
  return `- ${candidate.agent.displayName} (${candidate.statusLabel})`;
}

function routingSupportingDevices(devices: DeviceRecord[], tokens: string[], content: string): string[] {
  const normalized = content.toLowerCase();
  return devices
    .map((device) => {
      const matched = device.capabilityDescriptors.filter((descriptor) => {
        const searchable = `${descriptor.id} ${descriptor.label} ${descriptor.description ?? ""} ${device.displayName} ${device.platform}`.toLowerCase();
        return tokens.some((token) => searchable.includes(token)) || normalized.includes(device.platform);
      });
      if (!matched.length) return null;
      const labels = matched.map((descriptor) => descriptor.label).join(", ");
      return `- ${device.displayName} (${device.status}) - ${labels}; device target, not an executable agent`;
    })
    .filter((item): item is string => Boolean(item));
}

function noRoutingCandidateText(supportingTargets: string[]): string {
  return [
    "No executable agent route found.",
    ...(supportingTargets.length ? ["", "Supporting targets:", ...supportingTargets] : []),
    "",
    "Try list agents or add device named Office Mac.",
    "I need a clear executable agent before I can start a handoff."
  ].join("\n");
}

async function communicationAgentLlmReply(ctx: ServerRouteContext, input: {
  content: string;
  serverId: string;
  userId: string;
  assistant: AgentRecord;
  channelId: string;
  conversationId?: string;
  sourceMessageId: string;
  sourceContext: CommunicationAgentSourceContext;
  allowHandoff: boolean;
}): Promise<CommunicationAgentReplyDraft | null> {
  const config = ctx.assistantLlmConfig;
  if (!config?.enabled) return null;
  try {
    const context = buildAssistantLlmContext(ctx, input.serverId, input.content, {
      userId: input.userId,
      channelId: input.channelId,
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      sourceContext: input.sourceContext
    });
    const decide = ctx.assistantLlmDecide ?? ((llmContext: AssistantLlmContext) => requestAssistantLlmDecision(llmContext, config));
    const decision = await decide(context);
    return await assistantDecisionReply(ctx, input, decision);
  } catch {
    return { content: "I couldn't interpret that request automatically. Try again, or type help to see available actions." };
  }
}

async function assistantDecisionReply(ctx: ServerRouteContext, input: {
  content: string;
  serverId: string;
  userId: string;
  assistant: AgentRecord;
  channelId: string;
  conversationId?: string;
  sourceMessageId: string;
  sourceContext: CommunicationAgentSourceContext;
  allowHandoff: boolean;
}, decision: AssistantDecision): Promise<CommunicationAgentReplyDraft> {
  if (decision.kind === "answer") return { content: decision.content };
  if (decision.kind === "needs_clarification") return { content: decision.question };
  if (decision.kind === "unsupported") return { content: decision.reason };
  input = { ...input, sourceContext: restoreMcpCommunicationAuthority(ctx.store, {
    sourceMessageId: input.sourceMessageId, userId: input.userId, serverId: input.serverId,
    channelId: input.channelId, conversationId: input.conversationId, sourceContext: input.sourceContext
  }) };
  if (input.sourceContext.mcpAuthorizationError) {
    return blockedMcpAuthorizationDraft(mcpAuthorizationFailureMessage(input.sourceContext.mcpAuthorizationError), input.sourceMessageId);
  }
  if (input.sourceContext.source === "mcp" && decision.kind !== "agent_query_suggestion" &&
      (input.sourceContext.accessMode === "read_only" || !input.sourceContext.grantedScopes?.includes("tyr:manage"))) {
    return blockedMcpAuthorizationDraft("This request is Read-only. Start a new authorized Action request to execute it.", input.sourceMessageId);
  }
  if (decision.kind === "agent_query_suggestion") {
    // 模型只负责识别只读目标与字段；配置事实此刻从当前 Workspace 服务端记录重新读取。
    const matches = resolveAgentDetailsCandidates(decision.agentReference, agentDetailsCandidates(ctx, input.serverId));
    if (matches.length === 0) return { content: "I could not find that Agent. Try list agents." };
    if (matches.length > 1) return { content: formatAgentDetailsAmbiguousReply(matches) };
    return { content: formatAgentDetailsReply(matches[0]!, decision.field) };
  }
  if (decision.kind === "agent_action_suggestion") {
    const intent: Exclude<CommunicationAgentActionIntent, { action: "unsupported_batch" }> = decision.action === "batch_start"
      || decision.action === "batch_stop"
      || decision.action === "batch_restart"
      ? {
          action: decision.action,
          ...(decision.computerReference ? { computerReference: decision.computerReference } : {})
        }
      : decision.action === "create"
      ? {
          action: "create",
          ...(decision.name ? { name: decision.name } : {}),
          ...(decision.machineReference ? { machineReference: decision.machineReference } : {}),
          ...(decision.runtimeReference ? { runtimeReference: decision.runtimeReference } : {}),
          ...(decision.modelReference ? { modelReference: decision.modelReference } : {})
        }
      : decision.action === "computer_rename"
        ? {
            action: "computer_rename",
            ...(decision.computerReference ? { computerReference: decision.computerReference } : {}),
            ...(decision.name ? { name: decision.name } : {})
          }
      : decision.action === "runtime_models_detect"
        ? {
            action: "runtime_models_detect",
            ...(decision.computerReference ? { computerReference: decision.computerReference } : {}),
            ...(decision.runtimeReference ? { runtimeReference: decision.runtimeReference } : {})
          }
      : decision.action === "update"
        ? {
            action: "update",
            ...(decision.agentReference ? { agentReference: decision.agentReference } : {}),
            ...(decision.field ? { field: decision.field } : {}),
            ...(decision.value !== undefined ? { value: decision.value } : {})
          }
        : {
            action: decision.action,
            ...(decision.agentReference ? { agentReference: decision.agentReference } : {})
          };
    const management = await beginCommunicationAgentAction(ctx, {
      content: input.content,
      serverId: input.serverId,
      userId: input.userId,
      assistant: input.assistant,
      channelId: input.channelId,
      sourceMessageId: input.sourceMessageId,
      sourceContext: input.sourceContext
    }, intent);
    return { content: management.content };
  }
  return assistantRouteDecisionReply(ctx, input, decision);
}

async function assistantRouteDecisionReply(ctx: ServerRouteContext, input: {
  serverId: string;
  userId: string;
  assistant: AgentRecord;
  channelId: string;
  conversationId?: string;
  sourceMessageId: string;
  sourceContext: CommunicationAgentSourceContext;
  allowHandoff: boolean;
}, decision: Extract<AssistantDecision, { kind: "route_suggestion" }>): Promise<CommunicationAgentReplyDraft> {
  const targetAgent = ctx.store.getAgent(decision.targetAgentId);
  const targetMachine = targetAgent?.machineId ? ctx.store.getMachine(targetAgent.machineId) : null;
  const ready = targetAgent && !isCommunicationAgent(targetAgent) && targetAgent.runtime && (targetAgent.status === "online" || targetAgent.status === "working") && targetMachine?.status === "online";
  if (!ready || !targetAgent) {
    return {
      content: "The model suggested an unavailable agent. Ask me who can handle it again, or try list agents."
    };
  }
  const instruction = cleanLlmInstruction(decision.instruction);
  if (!instruction) {
    return {
      content: "The model did not provide a clear instruction for the target agent. Please rephrase the request."
    };
  }
  if (!input.allowHandoff) return { content: communicationAgentHandoffDisabledText(targetAgent, instruction) };
  return communicationAgentDirectHandoffReply(ctx, input, targetAgent, instruction);
}

function communicationAgentHandoffDisabledText(targetAgent: AgentRecord | null, instruction: string): string {
  return [
    targetAgent ? `Peer route available: ${targetAgent.displayName}` : "Peer route handoff disabled.",
    "Workspace bridge mode does not start peer worker agents automatically.",
    `Suggested instruction: ${instruction}`
  ].join("\n");
}

function cleanLlmInstruction(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? "" : "."}`;
}

function createCommunicationAgentOnboardingReply(ctx: ServerRouteContext, input: {
  serverId: string;
  requestedByUserId: string;
  requestedByAgentId: string;
  machineName: string;
}): string {
  const link = createMachineOnboardingLink({
    store: ctx.store,
    publicServerUrl: ctx.publicServerUrl,
    serverId: input.serverId,
    requestedByUserId: input.requestedByUserId,
    requestedByAgentId: input.requestedByAgentId,
    name: input.machineName,
    emitRealtimeMachineUpdated: ctx.emitRealtimeMachineUpdated
  });
  ctx.store.recordActivity(input.requestedByAgentId, "onboarding", `Created device onboarding link for ${link.machine.name}.`);
  ctx.store.recordAuditEvent({
    kind: "communication_agent_machine_onboarding_created",
    actorType: "agent",
    actorId: input.requestedByAgentId,
    resourceType: "machine",
    resourceId: link.machine.id,
    serverId: input.serverId,
    metadata: {
      requestedByUserId: input.requestedByUserId,
      intentId: link.intent.id
    }
  });
  return `Created an onboarding link for ${link.machine.name}.\n${link.onboardingUrl}\n\nThis link expires in 15 minutes.`;
}

function extractRequestedMachineName(content: string): string | null {
  const patterns = [
    /\b(?:named|called|name is)\s+(.+)$/i,
    /(?:叫|命名为|名字(?:是|为)?|名称(?:是|为)?)\s*([^，。；;!?！？\n]+)/
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    const name = cleanRequestedMachineName(match?.[1] ?? "");
    if (name) return name;
  }
  return null;
}

function cleanRequestedMachineName(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/\s+(please|pls)$/i, "")
    .replace(/[.。!！?？]+$/g, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim()
    .slice(0, 80);
  return cleaned || null;
}
