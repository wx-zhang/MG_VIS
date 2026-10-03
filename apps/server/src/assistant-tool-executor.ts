import { createHash } from "node:crypto";
import {
  RUNTIMES,
  findTyrAssistantOperationById,
  isCommunicationAgent,
  type AgentRecord,
  type CommunicationEvidenceSelection,
  type MachineRecord,
  type RuntimeId,
  type RuntimePermissionMode,
  type TyrHeartbeatRecord,
  type TyrHeartbeatRunRecord
} from "@tyr-ai/contracts";

import { canManageAgentRuntime } from "./access-control";
import {
  createAgentManagementService,
  type AgentBatchManagementResult,
  type AgentManagementResult,
  type AgentManagementSourceContext
} from "./agent-management-service";
import { formatAgentDetailsReply } from "./agent-details-query";
import {
  findTyrAssistantTool,
  validateTyrAssistantToolCall,
  type TyrAssistantConfirmationToolName,
  type TyrAssistantToolCall,
  type TyrAssistantToolResult
} from "./assistant-tools";
import {
  dispatchCommunicationAgentHandoff
} from "./communication-agent-handoff";
import { getCommunicationRouteIntent } from "./communication-route-intent";
import { bridgeRouteIntentPredatesCutover, getBridgeRouteIntent } from "./bridge-route-intent";
import { CommunicationRoutePlanningError, prepareInitialCommunicationRoute, routeClarification, verifyIncomingBridgeLocalRequest } from "./communication-route-planning";
import { verifiedCommunicationOriginAction } from "./communication-origin-route";
import type { CommunicationAgentSourceContext } from "./communication-agent-source";
import { mcpAuthorizationFailureMessage, restoreMcpCommunicationAuthority } from "./mcp-communication-authority";
import { createMachineOnboardingLink } from "./machine-onboarding-service";
import { BridgeConnectionError, WorkspaceBridgeConnectionService } from "./workspace-bridge-connection-intent";
import { WorkspaceBridgeEmailInvitations } from "./workspace-bridge-email-invitations";
import { reactToTelegramMessage } from "./telegram-reactions";
import { requestRuntimeModelDetection } from "./runtime-model-detection";
import type { ServerRouteContext } from "./server-context";
import {
  WorkspaceBridgeRequestError,
  WorkspaceBridgeRequestService
} from "./workspace-bridge-request-service";
import { CommunicationEvidenceError, listCommunicationEvidenceForContext, selectCommunicationEvidenceForContext } from "./communication-evidence";

export interface TyrAssistantToolConfirmationReceipt {
  toolCallId: string;
  toolName: TyrAssistantConfirmationToolName;
  targetId: string;
  confirmedAt: string;
}

function exactWorkspaceBridgePayload(content: string | undefined): string | null {
  const source = content?.trim();
  if (!source) return null;
  const english = source.match(/^(?:please\s+)?send\s+(?:the\s+)?(?:following|this exact)(?:\s+(?:message|content))?\s+(?:through|via)\s+(?:the\s+)?(?:workspace\s+)?bridge(?:\s+to\s+[^:\n]+)?\s*[:：]\s*([\s\S]+)$/i);
  if (english?.[1]?.trim()) return english[1].trim();
  const chinese = source.match(/^(?:请)?(?:通过|使用)\s*(?:workspace\s+)?bridge\s*(?:向[^：:\n]+)?发送(?:以下|下面)(?:消息|内容)?\s*[:：]\s*([\s\S]+)$/i);
  return chinese?.[1]?.trim() || null;
}

// Compatibility for in-flight requests older than the existing persisted cutover only.
function legacyRequestNamesBridgeDestination(content: string, peerWorkspaceName: string, chained: boolean): boolean {
  const peer = peerWorkspaceName.trim();
  if (!peer) return false;
  const escapedPeer = peer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 下一跳必须能从真实请求中找到明确的收件方；worker 的“请转发”不产生新授权。
  const directedAction = chained
    ? /\b(?:ask|contact|send|forward|relay|route|consult|coordinate|check|arrange\s+with|book\s+with)\b|(?:联系|发送给|转发给|询问)/gi
    : /\b(?:ask|contact|send|forward|relay|route|consult|coordinate|check|book|reserve|arrange|with|via|through|at)\b|(?:联系|发送给|转发给|询问|通过|预订)/gi;
  for (const match of content.matchAll(directedAction)) {
    const following = content.slice(match.index! + match[0].length, match.index! + match[0].length + (chained ? 48 : 90));
    if (new RegExp(`(?:^|[^\\p{L}\\p{N}])@?${escapedPeer}(?![\\p{L}\\p{N}])`, "iu").test(following)) return true;
  }
  return false;
}

export interface TyrAssistantToolExecutionInput {
  call: unknown;
  serverId: string;
  userId: string;
  assistant: AgentRecord;
  channelId: string;
  conversationId?: string;
  sourceMessageId?: string;
  sourceContext: CommunicationAgentSourceContext;
  returnTarget?: {
    source: "web" | "email" | "telegram";
    externalRef?: string;
  };
  allowHandoff?: boolean;
  confirmation?: TyrAssistantToolConfirmationReceipt;
}

export type TyrAssistantToolExecutionOutcome =
  | { ok: true; result: TyrAssistantToolResult }
  | {
      ok: false;
      toolCallId?: string;
      errorCode: "invalid_tool_call" | "unknown_tool" | "invalid_tool_arguments" | "operation_not_allowed";
      message: string;
    };

function evidenceScope(input: TyrAssistantToolExecutionInput) {
  if (!input.sourceMessageId) throw new Error("communication_evidence_source_required");
  return {
    serverId: input.serverId,
    sourceMessageId: input.sourceMessageId,
    channelId: input.channelId,
    conversationId: input.conversationId ?? null
  };
}

function parseEvidenceSelections(value: string | undefined): CommunicationEvidenceSelection[] {
  if (value === undefined) return [];
  const selections: unknown = JSON.parse(value);
  if (!Array.isArray(selections) || selections.length > 32) throw new Error("communication_evidence_selection_invalid");
  return selections as CommunicationEvidenceSelection[];
}

function toolResult(
  call: TyrAssistantToolCall,
  status: TyrAssistantToolResult["status"],
  message: string,
  fields: Pick<TyrAssistantToolResult, "data" | "confirmation" | "executionIds" | "bridgeRequestIds" | "presentation"> = {}
): TyrAssistantToolResult {
  return {
    toolCallId: call.id,
    toolName: call.name,
    status,
    message,
    ...fields
  };
}

function safeMachine(ctx: ServerRouteContext, machine: MachineRecord) {
  return {
    id: machine.id,
    name: machine.name,
    hostname: machine.hostname,
    os: machine.os,
    status: machine.status,
    daemonVersion: machine.daemonVersion,
    runtimes: ctx.store.listRuntimeReports(machine.id).map((report) => ({
      id: report.runtime,
      displayName: report.displayName,
      status: report.status,
      defaultModel: report.defaultModel,
      models: report.models ?? []
    }))
  };
}

function safeAgent(ctx: ServerRouteContext, agent: AgentRecord) {
  const machine = agent.machineId ? ctx.store.getMachine(agent.machineId) : null;
  return {
    id: agent.id,
    handle: agent.name,
    name: agent.displayName,
    description: agent.description,
    status: agent.status,
    runtime: agent.runtime,
    model: agent.model,
    permissionMode: agent.permissionMode,
    computer: machine && !machine.deletedAt
      ? { id: machine.id, name: machine.name, status: machine.status }
      : null
  };
}

function safeHeartbeat(heartbeat: TyrHeartbeatRecord) {
  return {
    id: heartbeat.id,
    title: heartbeat.title,
    instruction: heartbeat.instruction,
    intervalUnit: heartbeat.intervalUnit,
    intervalValue: heartbeat.intervalValue,
    enabled: heartbeat.enabled,
    nextRunAt: heartbeat.nextRunAt,
    createdAt: heartbeat.createdAt,
    updatedAt: heartbeat.updatedAt
  };
}

function safeHeartbeatRun(run: TyrHeartbeatRunRecord) {
  return {
    id: run.id,
    heartbeatId: run.heartbeatId,
    scheduledFor: run.scheduledFor,
    status: run.status,
    executionIds: run.executionIds,
    selectedAgentId: run.selectedAgentId ?? null,
    errorCode: run.errorCode ?? null,
    errorMessage: run.errorMessage ?? null,
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

function workspaceStatusText(ctx: ServerRouteContext, input: TyrAssistantToolExecutionInput): string {
  const server = ctx.store.listServersForUser(input.userId).find((item) => item.id === input.serverId);
  const machines = ctx.store.listMachines(input.serverId);
  const agents = ctx.store.listAgents(input.serverId).filter((agent) => !isCommunicationAgent(agent));
  const onlineAgents = agents.filter((agent) => agent.status === "online" || agent.status === "working");
  return [
    "Workspace status",
    `Workspace: ${server?.name ?? input.serverId}`,
    `TYR: ${input.assistant.status}`,
    `Devices: ${machines.length} total, ${machines.filter((machine) => machine.status === "online").length} online`,
    `Agents: ${agents.length} executable, ${onlineAgents.length} online`
  ].join("\n");
}

function computerListText(ctx: ServerRouteContext, serverId: string): string {
  const machines = ctx.store.listMachines(serverId);
  if (!machines.length) return "Devices\nNo devices are connected yet.";
  return [
    "Devices",
    ...machines.map((machine) => {
      const runtimes = ctx.store.listRuntimeReports(machine.id)
        .filter((runtime) => runtime.status === "available")
        .map((runtime) => runtime.displayName || runtime.runtime);
      return `- ${machine.name} (${machine.status}) - ${machine.os || "unknown OS"} - Runtimes: ${runtimes.join(", ") || "none available"}`;
    })
  ].join("\n");
}

function agentListText(ctx: ServerRouteContext, serverId: string): string {
  const machines = new Map(ctx.store.listMachines(serverId).map((machine) => [machine.id, machine]));
  const agents = ctx.store.listAgents(serverId).filter((agent) => !isCommunicationAgent(agent));
  if (!agents.length) return "Agents\nNo executable agents are available yet.";
  return [
    "Agents",
    ...agents.map((agent) => {
      const machine = agent.machineId ? machines.get(agent.machineId) : null;
      return `- ${agent.displayName} (${agent.status}) - Runtime: ${agent.runtime ?? "none"} - Device: ${machine?.name ?? "none"}`;
    })
  ].join("\n");
}

function inventoryListText(ctx: ServerRouteContext, serverId: string): string {
  return ["Workspace inventory", "", computerListText(ctx, serverId), "", agentListText(ctx, serverId)].join("\n");
}

function computerDetailsText(ctx: ServerRouteContext, machine: MachineRecord, agents: AgentRecord[]): string {
  const runtimes = ctx.store.listRuntimeReports(machine.id).filter((runtime) => runtime.status === "available");
  return [
    machine.name,
    `Status: ${machine.status}`,
    `OS: ${machine.os || "unknown"}`,
    `Available runtimes: ${runtimes.map((runtime) => runtime.displayName || runtime.runtime).join(", ") || "none"}`,
    `Agents: ${agents.map((agent) => agent.displayName).join(", ") || "none"}`
  ].join("\n");
}

function agentCapabilitiesText(ctx: ServerRouteContext, agent: AgentRecord, machine?: MachineRecord): string {
  const scopes = ctx.store.getAgentScopes(agent.id)?.granted ?? [];
  return [
    agent.displayName,
    `Status: ${agent.status}`,
    `Runtime: ${agent.runtime ?? "none"}`,
    `Device: ${machine?.name ?? "none"}`,
    `Agent Profile Prompt: ${agent.description?.trim() || "Not set"}`,
    `Capabilities: ${scopes.join(", ") || "none"}`
  ].join("\n");
}

function workspaceMachine(ctx: ServerRouteContext, serverId: string, machineId: string): MachineRecord | null {
  const machine = ctx.store.getMachine(machineId);
  return machine && !machine.deletedAt && (machine.serverId ?? "local") === serverId ? machine : null;
}

function workspaceAgent(ctx: ServerRouteContext, serverId: string, agentId: string): AgentRecord | null {
  const agent = ctx.store.getAgent(agentId);
  const machine = agent?.machineId ? ctx.store.getMachine(agent.machineId) : null;
  const agentServerId = agent?.serverId ?? machine?.serverId ?? "local";
  if (!agent || agent.deletedAt || isCommunicationAgent(agent) || agentServerId !== serverId) return null;
  if (machine && (machine.deletedAt || (machine.serverId ?? "local") !== serverId)) return null;
  return agent;
}

function runtimeId(value: string): RuntimeId | null {
  return RUNTIMES.some((runtime) => runtime.id === value) ? value as RuntimeId : null;
}

function managementSource(
  input: TyrAssistantToolExecutionInput,
  confirmationRequired: boolean
): AgentManagementSourceContext {
  return {
    kind: "tyr_assistant",
    source: input.sourceContext.source,
    ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
    assistantAgentId: input.assistant.id,
    requestingUserId: input.sourceContext.requestingUserId ?? input.userId,
    capabilityUserId: input.userId,
    bridgeRequestId: input.sourceContext.parentBridgeRequestId,
    bridgeTraceId: input.sourceContext.bridgeTraceId,
    confirmation: {
      required: confirmationRequired,
      ...(input.confirmation?.confirmedAt ? { confirmedAt: input.confirmation.confirmedAt } : {})
    }
  };
}

function managementResult(call: TyrAssistantToolCall, result: AgentManagementResult): TyrAssistantToolResult {
  const target = result.agent?.displayName ?? result.machine?.name ?? "target";
  const message = result.errorCode
    ? `${call.name} ${result.status} for ${target}: ${result.errorCode}.`
    : `${call.name} ${result.status} for ${target}.`;
  return toolResult(call, result.status, message, {
    data: {
      action: result.action,
      operationId: result.operationId,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      ...(result.agent ? { agent: safeAgentRecord(result.agent, result.machine) } : {}),
      ...(result.machine ? { computer: safeMachineRecord(result.machine) } : {}),
      ...(result.startSent === undefined ? {} : { startSent: result.startSent }),
      ...(result.stopSent === undefined ? {} : { stopSent: result.stopSent }),
      ...(result.changedFields ? { changedFields: result.changedFields } : {}),
      ...(result.restartRequired === undefined ? {} : { restartRequired: result.restartRequired }),
      ...(result.sessionCleared === undefined ? {} : { sessionCleared: result.sessionCleared })
    }
  });
}

function safeMachineRecord(machine: MachineRecord) {
  return {
    id: machine.id,
    name: machine.name,
    hostname: machine.hostname,
    os: machine.os,
    status: machine.status
  };
}

function safeAgentRecord(agent: AgentRecord, machine?: MachineRecord) {
  return {
    id: agent.id,
    handle: agent.name,
    name: agent.displayName,
    status: agent.status,
    runtime: agent.runtime,
    model: agent.model,
    permissionMode: agent.permissionMode,
    computer: machine ? { id: machine.id, name: machine.name, status: machine.status } : null
  };
}

function batchResult(call: TyrAssistantToolCall, result: AgentBatchManagementResult): TyrAssistantToolResult {
  const message = result.errorCode
    ? `${call.name} ${result.status}: ${result.errorCode}.`
    : `${call.name} ${result.status}: ${result.completed} completed, ${result.noop} unchanged, ${result.partial} partial, ${result.denied} denied, ${result.failed} failed, ${result.skipped} skipped.`;
  return toolResult(call, result.status, message, {
    data: {
      operationId: result.operationId,
      action: result.action,
      total: result.total,
      completed: result.completed,
      noop: result.noop,
      partial: result.partial,
      denied: result.denied,
      failed: result.failed,
      skipped: result.skipped,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      ...(result.machine ? { computer: safeMachineRecord(result.machine) } : {}),
      results: result.results.map((item) => ({
        agentId: item.agentId,
        agentName: item.agentName,
        status: item.status,
        ...(item.errorCode ? { errorCode: item.errorCode } : {})
      }))
    }
  });
}

function recordDirectAudit(
  ctx: ServerRouteContext,
  input: TyrAssistantToolExecutionInput,
  call: TyrAssistantToolCall,
  kind: string,
  resourceType: "agent" | "machine",
  resourceId: string,
  status: string,
  errorCode?: string
): void {
  try {
    // Audit 只记录已经得到的执行结果；记录失败不能改变工具本身的业务结果。
    ctx.store.recordAuditEvent({
      kind,
      actorType: "agent",
      actorId: input.assistant.id,
      resourceType,
      resourceId,
      serverId: input.serverId,
      metadata: {
        operationId: call.id,
        toolName: call.name,
        requestedByUserId: input.sourceContext.requestingUserId ?? input.userId,
        capabilityUserId: input.userId,
        bridgeRequestId: input.sourceContext.parentBridgeRequestId ?? null,
        bridgeTraceId: input.sourceContext.bridgeTraceId ?? null,
        source: input.sourceContext.source,
        sourceMessageId: input.sourceMessageId ?? null,
        status,
        errorCode: errorCode ?? null
      }
    });
  } catch {
    // 审计是旁路可观测性，不参与 Tool Executor 的 allow/deny 或成功判定。
  }
}

function recordHeartbeatAudit(
  ctx: ServerRouteContext,
  input: TyrAssistantToolExecutionInput,
  call: TyrAssistantToolCall,
  kind: string,
  heartbeatId: string,
  metadata: Record<string, unknown> = {}
): void {
  try {
    // 心跳指令正文不进入审计；真实请求用户和 MCP grant 只作为来源元数据保留。
    ctx.store.recordAuditEvent({
      kind,
      actorType: "agent",
      actorId: input.assistant.id,
      resourceType: "server",
      resourceId: input.serverId,
      serverId: input.serverId,
      metadata: {
        operationId: call.id,
        toolName: call.name,
        heartbeatId,
        requestedByUserId: input.sourceContext.requestingUserId ?? input.userId,
        capabilityUserId: input.userId,
        source: input.sourceContext.source,
        grantId: input.sourceContext.grantId ?? null,
        ...metadata
      }
    });
  } catch {
    // 与其他 Assistant 工具一致，审计旁路失败不改变已经得到的业务结果。
  }
}

function semanticArgumentError(call: TyrAssistantToolCall, errorCode: string): TyrAssistantToolResult {
  return toolResult(call, "failed", `${call.name} failed: ${errorCode}.`, { data: { errorCode } });
}

function confirmationPrompt(
  toolName: TyrAssistantConfirmationToolName,
  agent: AgentRecord,
  machine?: MachineRecord
): string {
  if (toolName === "delete_agent") {
    return `Confirm deleting ${agent.displayName}${machine ? ` from ${machine.name}` : ""}. This removes the Agent and cannot be undone from TYR. Reply confirm to continue or cancel to stop.`;
  }
  return `Confirm resetting ${agent.displayName}${machine ? ` on ${machine.name}` : ""}. This clears its saved runtime session and starts a fresh one. Reply confirm to continue or cancel to stop.`;
}

export async function executeTyrAssistantTool(
  ctx: ServerRouteContext,
  input: TyrAssistantToolExecutionInput
): Promise<TyrAssistantToolExecutionOutcome> {
  const validation = validateTyrAssistantToolCall(input.call);
  if (!validation.ok) {
    const raw = input.call && typeof input.call === "object" ? input.call as Record<string, unknown> : null;
    return {
      ok: false,
      ...(typeof raw?.id === "string" ? { toolCallId: raw.id } : {}),
      errorCode: validation.errorCode,
      message: `TYR tool call rejected: ${validation.errorCode}.`
    };
  }
  const registeredTool = findTyrAssistantTool(validation.call.name);
  const registeredOperation = registeredTool
    ? findTyrAssistantOperationById(registeredTool.operationId)
    : undefined;
  if (input.sourceMessageId || input.sourceContext.source === "mcp" || input.sourceContext.mcpAuthorityMessageId) {
    input = { ...input, sourceContext: restoreMcpCommunicationAuthority(ctx.store, {
      sourceMessageId: input.sourceMessageId ?? "",
      userId: input.userId,
      serverId: input.serverId,
      channelId: input.channelId,
      conversationId: input.conversationId,
      sourceContext: input.sourceContext
    }) };
  }
  if (input.sourceContext.mcpAuthorizationError) {
    return { ok: true, result: toolResult(validation.call, "denied",
      mcpAuthorizationFailureMessage(input.sourceContext.mcpAuthorizationError),
      { data: { errorCode: input.sourceContext.mcpAuthorizationError } }) };
  }
  if (input.sourceContext.accessMode === "read_only" && registeredOperation?.risk !== "read_only") {
    // MCP query 的只读声明必须由服务端强制执行；Action 只能由外层客户端确认后新建 request。
    return {
      ok: false,
      toolCallId: validation.call.id,
      errorCode: "operation_not_allowed",
      message: "This request was not executed because the current MCP call is Read-only. The caller must confirm Action mode and start a new tyr_assistant_request operation."
    };
  }
  if (input.sourceContext.mcpAuthorityMessageId && registeredOperation?.risk !== "read_only" &&
      validation.call.name !== "send_workspace_bridge_message" &&
      !input.sourceContext.grantedScopes?.includes("tyr:manage")) {
    return { ok: true, result: toolResult(validation.call, "denied", "This MCP connection is missing tyr:manage.", {
      data: { errorCode: "missing_scope", requiredScope: "tyr:manage" }
    }) };
  }
  const call = validation.call;
  const requiresConfirmation = call.name === "delete_agent" || call.name === "reset_agent" || call.name === "confirm_workspace_bridge_invite";
  const membership = ctx.store.listServersForUser(input.userId).find((server) => server.id === input.serverId);
  const assistantServerId = input.assistant.serverId ?? "local";
  if (!membership || !isCommunicationAgent(input.assistant) || assistantServerId !== input.serverId) {
    return { ok: true, result: toolResult(call, "denied", "Workspace access is required.", { data: { errorCode: "workspace_access_required" } }) };
  }

  const service = createAgentManagementService({
    store: ctx.store,
    startAgent: ctx.startAgent,
    sendToDaemon: ctx.sendToDaemon,
    emitRealtimeAgentStatus: ctx.emitRealtimeAgentStatus,
    emitRealtimeRuntimeExecution: ctx.emitRealtimeRuntimeExecution,
    emitRealtimeRuntimeApproval: ctx.emitRealtimeRuntimeApproval,
    publishTerminalCommunicationFailure: ctx.publishTerminalCommunicationFailure,
    broadcastRealtime: ctx.broadcastRealtime,
    publishWorkspaceSync: ctx.publishWorkspaceSync
  });
  const bridgeService = new WorkspaceBridgeRequestService(ctx);
  const connectionService = new WorkspaceBridgeConnectionService(ctx.store, ctx.publicServerUrl);

  if (requiresConfirmation) {
    if (call.name === "confirm_workspace_bridge_invite") {
      if (input.sourceContext.accessMode === "workspace_bridge" || input.sourceContext.source === "mcp" || input.sourceContext.parentBridgeRequestId) {
        return { ok: true, result: semanticArgumentError(call, "workspace_bridge_local_human_required") };
      }
      try {
        const intent = connectionService.getForSource(call.arguments.intentId, input.serverId, input.userId);
        if (intent.status !== "claimed" || !intent.targetWorkspaceName || !intent.targetOwnerDisplayName) {
          return { ok: true, result: semanticArgumentError(call, "workspace_bridge_invite_unavailable") };
        }
        if (!input.confirmation) {
          const prompt = `Confirm a two-way Workspace Bridge between ${intent.sourceWorkspaceName} and ${intent.targetWorkspaceName} (Owner: ${intent.targetOwnerDisplayName}). Both sides can ask the other's TYR to act with its Owner capabilities. Reply confirm to connect or cancel to stop.`;
          return { ok: true, result: toolResult(call, "confirmation_required", prompt, {
            confirmation: { toolName: "confirm_workspace_bridge_invite", targetId: intent.id, prompt }
          }) };
        }
        if (input.confirmation.toolCallId !== call.id || input.confirmation.toolName !== call.name ||
            input.confirmation.targetId !== intent.id || !input.confirmation.confirmedAt.trim()) {
          return { ok: true, result: semanticArgumentError(call, "invalid_confirmation") };
        }
      } catch (error) {
        return { ok: true, result: semanticArgumentError(call, error instanceof BridgeConnectionError ? error.code : "workspace_bridge_invite_failed") };
      }
    } else {
    const action = call.name === "delete_agent" ? "delete" : "reset";
    const target = service.validateAgentTarget({
      action,
      operationId: call.id,
      actorUserId: input.userId,
      serverId: input.serverId,
      source: managementSource(input, true),
      agentId: call.arguments.agentId
    });
    if (target.status !== "completed") return { ok: true, result: managementResult(call, target) };
    if (!input.confirmation) {
      const toolName = call.name as TyrAssistantConfirmationToolName;
      const prompt = confirmationPrompt(toolName, target.agent!, target.machine);
      return {
        ok: true,
        result: toolResult(call, "confirmation_required", prompt, {
          data: { agent: safeAgentRecord(target.agent!, target.machine) },
          confirmation: { toolName, targetId: target.agent!.id, prompt }
        })
      };
    }
    // 确认只能继续原始 Tool Call；不同 call id 不能借确认消息重新指定目标。
    if (
      input.confirmation.toolCallId !== call.id ||
      input.confirmation.toolName !== call.name ||
      input.confirmation.targetId !== call.arguments.agentId ||
      !input.confirmation.confirmedAt.trim()
    ) {
      return { ok: true, result: semanticArgumentError(call, "invalid_confirmation") };
    }
    }
  }

  const source = managementSource(input, requiresConfirmation);
  let result: TyrAssistantToolResult;

  switch (call.name) {
    case "react_to_message": {
      if (input.sourceContext.source !== "telegram" || input.sourceContext.parentBridgeRequestId || input.sourceContext.accessMode === "workspace_bridge" ||
          ("systemTrigger" in input.sourceContext && input.sourceContext.systemTrigger) || !input.sourceMessageId) {
        result = toolResult(call, "denied", "A native reaction requires the current authenticated Telegram message.");
        break;
      }
      try {
        await reactToTelegramMessage(ctx.store, { userId: input.userId, serverId: input.serverId,
          messageId: input.sourceMessageId, emoji: call.arguments.emoji });
        result = toolResult(call, "completed", call.arguments.emoji ? "TYR reacted to your message." : "TYR removed its reaction.");
      } catch {
        result = toolResult(call, "failed", "TYR could not update the reaction. The message is still available to reply to.");
      }
      break;
    }
    case "ask_workspace_bridge_requester": {
      if (!input.sourceContext.parentBridgeRequestId || input.sourceContext.accessMode !== "workspace_bridge") {
        result = toolResult(call, "denied", "There is no open inbound Bridge request to clarify.", {
          data: { errorCode: "bridge_request_not_open" }
        });
        break;
      }
      try {
        verifyIncomingBridgeLocalRequest(ctx, input);
      } catch {
        result = toolResult(call, "denied", "The inbound Bridge request could not be verified.", {
          data: { errorCode: "route_context_mismatch" }
        });
        break;
      }
      const question = call.arguments.question.trim();
      if (!question || question.length > 2_000) {
        result = semanticArgumentError(call, "question_invalid");
        break;
      }
      result = toolResult(call, "partial", question);
      break;
    }
    case "get_workspace_status": {
      result = toolResult(call, "completed", workspaceStatusText(ctx, input));
      break;
    }
    case "list_workspace_inventory": {
      result = toolResult(call, "completed", inventoryListText(ctx, input.serverId));
      break;
    }
    case "list_computers": {
      result = toolResult(call, "completed", computerListText(ctx, input.serverId), {
        data: ctx.store.listMachines(input.serverId).map((machine) => safeMachine(ctx, machine))
      });
      break;
    }
    case "get_computer_details": {
      const machine = workspaceMachine(ctx, input.serverId, call.arguments.computerId);
      if (!machine) {
        result = semanticArgumentError(call, "machine_not_found");
        break;
      }
      const agents = ctx.store.listAgents(input.serverId).filter((agent) => !isCommunicationAgent(agent) && agent.machineId === machine.id);
      result = toolResult(call, "completed", computerDetailsText(ctx, machine, agents), {
        data: { computer: safeMachine(ctx, machine), agents: agents.map((agent) => safeAgent(ctx, agent)) }
      });
      break;
    }
    case "create_computer_onboarding": {
      if (membership.role === "guest") {
        result = toolResult(call, "denied", "Workspace owners or members are required to add a Device.", { data: { errorCode: "server_member_required" } });
        break;
      }
      const requestedName = call.arguments.name?.trim();
      if (requestedName && requestedName.length > 80) {
        result = semanticArgumentError(call, "machine_name_too_long");
        break;
      }
      const link = createMachineOnboardingLink({
        store: ctx.store,
        publicServerUrl: ctx.publicServerUrl,
        serverId: input.serverId,
        requestedByUserId: input.userId,
        requestedByAgentId: input.assistant.id,
        ...(requestedName ? { name: requestedName } : {}),
        emitRealtimeMachineUpdated: ctx.emitRealtimeMachineUpdated
      });
      ctx.store.recordActivity(input.assistant.id, "onboarding", `Created device onboarding link for ${link.machine.name}.`);
      recordDirectAudit(ctx, input, call, "communication_agent_machine_onboarding_created", "machine", link.machine.id, "completed");
      result = toolResult(call, "completed", `Created an onboarding link for ${link.machine.name}. It expires in 15 minutes.\n${link.onboardingUrl}`, {
        data: {
          computer: { id: link.machine.id, name: link.machine.name },
          onboardingUrl: link.onboardingUrl,
          expiresInSeconds: link.expiresInSeconds
        }
      });
      break;
    }
    case "rename_computer": {
      const machine = workspaceMachine(ctx, input.serverId, call.arguments.computerId);
      const name = call.arguments.name.trim();
      if (!machine) {
        result = semanticArgumentError(call, "machine_not_found");
        break;
      }
      if (machine.ownerUserId !== input.userId) {
        result = toolResult(call, "denied", "You do not own that Device.", { data: { errorCode: "machine_owner_required" } });
        break;
      }
      if (!name) {
        result = semanticArgumentError(call, "machine_name_required");
        break;
      }
      if (name.length > 80) {
        result = semanticArgumentError(call, "machine_name_too_long");
        break;
      }
      if (machine.name === name) {
        result = toolResult(call, "noop", `${machine.name} already has that name.`, { data: { computer: safeMachineRecord(machine) } });
        break;
      }
      const updated = ctx.store.updateMachineName(machine.id, name);
      if (!updated) {
        result = semanticArgumentError(call, "machine_rename_failed");
        break;
      }
      ctx.emitRealtimeMachineUpdated(updated.id);
      recordDirectAudit(ctx, input, call, "communication_agent_computer_rename", "machine", updated.id, "completed");
      result = toolResult(call, "completed", `${machine.name} was renamed to ${updated.name}.`, { data: { computer: safeMachineRecord(updated) } });
      break;
    }
    case "detect_runtime_models": {
      const machine = workspaceMachine(ctx, input.serverId, call.arguments.computerId);
      const runtime = runtimeId(call.arguments.runtime);
      if (!machine) {
        result = semanticArgumentError(call, "machine_not_found");
        break;
      }
      if (machine.ownerUserId !== input.userId) {
        result = toolResult(call, "denied", "You do not own that Device.", { data: { errorCode: "machine_owner_required" } });
        break;
      }
      if (!runtime) {
        result = semanticArgumentError(call, "runtime_not_supported");
        break;
      }
      if (machine.status !== "online") {
        result = semanticArgumentError(call, "machine_offline");
        break;
      }
      const report = ctx.store.listRuntimeReports(machine.id).find((item) => item.runtime === runtime && item.status === "available");
      if (!report) {
        result = semanticArgumentError(call, "runtime_unavailable");
        break;
      }
      const detection = await requestRuntimeModelDetection({
        machineId: machine.id,
        runtime,
        pendingRequests: ctx.runtimeModelRequests,
        sendToDaemon: ctx.sendToDaemon
      });
      if (detection.status === "failed") {
        recordDirectAudit(ctx, input, call, "communication_agent_computer_runtime_models_detect", "machine", machine.id, "failed", detection.errorCode);
        result = semanticArgumentError(call, detection.errorCode);
        break;
      }
      recordDirectAudit(ctx, input, call, "communication_agent_computer_runtime_models_detect", "machine", machine.id, "completed");
      result = toolResult(call, "completed", `Detected ${detection.models.length} ${report.displayName || runtime} models on ${machine.name}.`, {
        data: { computer: safeMachineRecord(machine), runtime, models: detection.models, defaultModel: detection.defaultModel }
      });
      break;
    }
    case "list_agents": {
      result = toolResult(call, "completed", agentListText(ctx, input.serverId), {
        data: ctx.store.listAgents(input.serverId).filter((agent) => !isCommunicationAgent(agent)).map((agent) => safeAgent(ctx, agent))
      });
      break;
    }
    case "get_agent_details": {
      const agent = workspaceAgent(ctx, input.serverId, call.arguments.agentId);
      if (!agent) {
        result = semanticArgumentError(call, "agent_not_found");
        break;
      }
      const machine = agent.machineId ? workspaceMachine(ctx, input.serverId, agent.machineId) : null;
      result = toolResult(call, "completed", formatAgentDetailsReply({ agent, machine }, call.arguments.field), {
        data: { agent: safeAgent(ctx, agent), field: call.arguments.field }
      });
      break;
    }
    case "get_agent_capabilities": {
      const agent = workspaceAgent(ctx, input.serverId, call.arguments.agentId);
      if (!agent) {
        result = semanticArgumentError(call, "agent_not_found");
        break;
      }
      const machine = agent.machineId ? workspaceMachine(ctx, input.serverId, agent.machineId) ?? undefined : undefined;
      result = toolResult(call, "completed", agentCapabilitiesText(ctx, agent, machine), {
        data: { agent: safeAgent(ctx, agent), scopes: ctx.store.getAgentScopes(agent.id)?.granted ?? [] }
      });
      break;
    }
    case "get_agent_scopes": {
      const agent = workspaceAgent(ctx, input.serverId, call.arguments.agentId);
      const machine = agent?.machineId ? workspaceMachine(ctx, input.serverId, agent.machineId) : null;
      if (!agent || !machine) {
        result = semanticArgumentError(call, "agent_not_found");
        break;
      }
      if (!canManageAgentRuntime(input.userId, agent, machine)) {
        result = toolResult(call, "denied", "You do not own that Agent and its Device.", { data: { errorCode: "agent_owner_required" } });
        break;
      }
      const scopes = ctx.store.getAgentScopes(agent.id);
      if (!scopes) {
        result = semanticArgumentError(call, "agent_scopes_unavailable");
        break;
      }
      recordDirectAudit(ctx, input, call, "communication_agent_agent_scopes_read", "agent", agent.id, "completed");
      result = toolResult(call, "completed", `Read ${scopes.granted.length} capability scopes for ${agent.displayName}.`, {
        data: { agent: safeAgentRecord(agent, machine), scopes }
      });
      break;
    }
    case "create_agent": {
      const runtime = runtimeId(call.arguments.runtime);
      if (!runtime) {
        result = semanticArgumentError(call, "runtime_not_supported");
        break;
      }
      result = managementResult(call, service.createAgent({
        operationId: call.id,
        actorUserId: input.userId,
        serverId: input.serverId,
        source,
        machineId: call.arguments.computerId,
        name: call.arguments.name,
        runtime,
        ...(call.arguments.model ? { model: call.arguments.model } : {}),
        ...(call.arguments.permissionMode ? { permissionMode: call.arguments.permissionMode } : {})
      }));
      break;
    }
    case "update_agent": {
      const request = {
        operationId: call.id,
        actorUserId: input.userId,
        serverId: input.serverId,
        source,
        agentId: call.arguments.agentId
      };
      if (call.arguments.field === "permissionMode") {
        const value = call.arguments.value as RuntimePermissionMode;
        if (!["read-only", "workspace-write", "dev-full-access"].includes(value)) {
          result = semanticArgumentError(call, "invalid_permission_mode");
          break;
        }
        result = managementResult(call, service.updateAgent({ ...request, permissionMode: value }));
      } else if (call.arguments.field === "name") {
        result = managementResult(call, service.updateAgent({ ...request, name: call.arguments.value }));
      } else if (call.arguments.field === "model") {
        result = managementResult(call, service.updateAgent({ ...request, model: call.arguments.value === "default" ? null : call.arguments.value }));
      } else {
        result = managementResult(call, service.updateAgent({ ...request, description: call.arguments.value.trim() || null }));
      }
      break;
    }
    case "start_agent":
    case "stop_agent":
    case "restart_agent":
    case "reset_agent":
    case "delete_agent": {
      const request = {
        operationId: call.id,
        actorUserId: input.userId,
        serverId: input.serverId,
        source,
        agentId: call.arguments.agentId
      };
      const actionResult = call.name === "start_agent"
        ? service.startAgent(request)
        : call.name === "stop_agent"
          ? service.stopAgent(request)
          : call.name === "restart_agent"
            ? service.restartAgent(request)
            : call.name === "reset_agent"
              ? service.resetAgent(request)
              : service.deleteAgent(request);
      result = managementResult(call, actionResult);
      break;
    }
    case "start_agents_on_computer":
    case "stop_agents_on_computer":
    case "restart_agents_on_computer": {
      const action = call.name === "start_agents_on_computer"
        ? "start"
        : call.name === "stop_agents_on_computer"
          ? "stop"
          : "restart";
      result = batchResult(call, service.batchByMachine({
        operationId: call.id,
        actorUserId: input.userId,
        serverId: input.serverId,
        source,
        machineId: call.arguments.computerId,
        action
      }));
      break;
    }
    case "select_result_evidence": {
      let selections: CommunicationEvidenceSelection[] = [];
      let available: ReturnType<typeof listCommunicationEvidenceForContext> = [];
      let errorCode: string | null = null;
      try {
        available = listCommunicationEvidenceForContext(ctx.store, evidenceScope(input));
        selections = parseEvidenceSelections(call.arguments.evidenceSelections);
        if (!available.length) throw new CommunicationEvidenceError("communication_evidence_unavailable");
        if (!selections.length) throw new CommunicationEvidenceError("communication_evidence_selection_empty");
        const selectedEvidence = selectCommunicationEvidenceForContext(ctx.store, evidenceScope(input), selections);
        result = toolResult(call, "completed", "Selected the original evidence fields for TYR's reviewed reply.", {
          data: { evidenceSelections: selections, selectedEvidence }
        });
      } catch (error) {
        errorCode = error instanceof CommunicationEvidenceError ? error.code : error instanceof SyntaxError
          ? "communication_evidence_selection_json_invalid" : "communication_evidence_selection_invalid";
        const executions = ctx.store.db.prepare(`select status from runtime_executions where server_id = ?
          and communication_return_source_message_id = ? and communication_return_channel_id = ?
          and communication_return_conversation_id is ?`).all(input.serverId, input.sourceMessageId ?? "",
            input.channelId, input.conversationId ?? null) as Array<{ status: string }>;
        const executionCompleted = executions.length > 0 && executions.every((execution) => execution.status === "completed");
        result = toolResult(call, "failed", executionCompleted
          ? "Local execution finished, but TYR could not validate the return evidence. The completed work was not repeated."
          : "TYR could not validate the result evidence. Review the request diagnostics before retrying.", {
          data: { errorCode, executionCompleted, availableEvidence: available,
            recovery: available.length ? "Correct only receiptId and keys using availableEvidence. Do not rerun completed work."
              : "No authenticated evidence is registered. Do not invent receipts or rerun completed work." }
        });
      }
      // Persist references and validation outcomes, never replacement values, excerpts or raw model arguments.
      try {
        ctx.store.recordAuditEvent({ kind: "communication_evidence_selection", actorType: "agent", actorId: input.assistant.id,
          resourceType: "message", resourceId: input.sourceMessageId ?? input.channelId, serverId: input.serverId,
          metadata: { toolCallId: call.id, status: result.status, errorCode, availableEvidenceCount: available.length,
            executionIds: (ctx.store.db.prepare(`select id from runtime_executions where server_id = ?
              and communication_return_source_message_id = ? and communication_return_channel_id = ?
              and communication_return_conversation_id is ? order by created_at, id`).all(input.serverId,
                input.sourceMessageId ?? "", input.channelId, input.conversationId ?? null) as Array<{ id: string }>).map((row) => row.id),
            argumentSha256: createHash("sha256").update(call.arguments.evidenceSelections).digest("hex"),
            selections: selections.slice(0, 16).map((selection) => ({
              receiptId: typeof selection?.receiptId === "string" && /^evidence_[0-9a-f]{32}$/.test(selection.receiptId)
                ? selection.receiptId : "invalid",
              keys: Array.isArray(selection?.keys) ? selection.keys.filter((key) => typeof key === "string" &&
                /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(key)).slice(0, 32) : [],
              excerptLength: typeof selection?.excerpt === "string" ? selection.excerpt.length : 0
            })) }
        });
      } catch { /* Audit failures do not change the result of evidence validation. */ }
      break;
    }
    case "send_instruction_to_agent": {
      if (input.allowHandoff === false) {
        result = toolResult(call, "denied", "Agent handoff is disabled for this conversation.", { data: { errorCode: "handoff_disabled" } });
        break;
      }
      if (membership.role === "guest") {
        result = toolResult(call, "denied", "Workspace owners or members are required to route Agent work.", { data: { errorCode: "server_member_required" } });
        break;
      }
      const agent = workspaceAgent(ctx, input.serverId, call.arguments.agentId);
      if (agent && input.sourceContext.awaitingEvidenceFromAgentId === agent.id) {
        result = toolResult(call, "denied", "This Agent requested additional information. Provide new evidence or ask the requester before handing the same request back.", {
          data: { errorCode: "agent_waiting_for_new_evidence" }
        });
        break;
      }
      const machine = agent?.machineId ? workspaceMachine(ctx, input.serverId, agent.machineId) : null;
      const ready = agent && agent.runtime && (agent.status === "online" || agent.status === "working") && machine?.status === "online";
      if (!ready || !agent) {
        result = agent
          ? toolResult(call, "failed", "send_instruction_to_agent failed: agent_unavailable.", {
            data: { errorCode: "agent_unavailable" },
            presentation: {
              kind: "agent_handoff",
              agentName: agent.displayName,
              agentHandle: agent.name,
              state: "unavailable"
            }
          })
          : semanticArgumentError(call, "agent_unavailable");
        break;
      }
      const instruction = call.arguments.instruction.trim();
      if (!instruction) {
        result = semanticArgumentError(call, "instruction_required");
        break;
      }
      let evidenceSelections: CommunicationEvidenceSelection[];
      try {
        evidenceSelections = parseEvidenceSelections(call.arguments.evidenceSelections);
        if (evidenceSelections.length) selectCommunicationEvidenceForContext(ctx.store, evidenceScope(input), evidenceSelections);
      } catch {
        result = semanticArgumentError(call, "communication_evidence_selection_invalid");
        break;
      }
      try {
        if (input.sourceContext.parentBridgeRequestId) {
          verifyIncomingBridgeLocalRequest(ctx, input);
        } else {
          const route = await prepareInitialCommunicationRoute(ctx, input);
          const clarification = routeClarification(route);
          if (clarification) {
            result = toolResult(call, "denied", clarification, { data: { errorCode: "route_needs_clarification" } });
            break;
          }
          if (route.plan?.continuationRequestId) {
            result = toolResult(call, "partial",
              `This message continues Bridge request ${route.plan.continuationRequestId}. Use send_workspace_bridge_message with replyToRequestId to send the supplement; do not repeat the original Agent work.`,
              { data: { errorCode: "workspace_bridge_followup_required" }, bridgeRequestIds: [route.plan.continuationRequestId] });
            break;
          }
        }
      } catch (error) {
        const failure = error instanceof CommunicationRoutePlanningError ? error
          : new CommunicationRoutePlanningError("route_planning_failed", "TYR could not verify the request route. No Agent request was sent.");
        result = toolResult(call, "failed", failure.publicMessage, { data: { errorCode: failure.code } });
        break;
      }
      // Route planning can await another model. Recheck live authority at the dispatch boundary.
      input = { ...input, sourceContext: restoreMcpCommunicationAuthority(ctx.store, {
        sourceMessageId: input.sourceMessageId ?? "", userId: input.userId, serverId: input.serverId,
        channelId: input.channelId, conversationId: input.conversationId, sourceContext: input.sourceContext
      }) };
      if (input.sourceContext.mcpAuthorizationError) {
        result = toolResult(call, "denied", mcpAuthorizationFailureMessage(input.sourceContext.mcpAuthorizationError), {
          data: { errorCode: input.sourceContext.mcpAuthorizationError }
        });
        break;
      }
      if (input.sourceContext.source === "mcp" && input.sourceContext.accessMode === "read_only") {
        return { ok: false, toolCallId: call.id, errorCode: "operation_not_allowed",
          message: "This request was not executed because the current MCP call is Read-only. The caller must confirm Action mode and start a new tyr_assistant_request operation." };
      }
      if (input.sourceContext.source === "mcp" && !input.sourceContext.grantedScopes?.includes("tyr:manage")) {
        result = toolResult(call, "denied", "This MCP connection is missing tyr:manage.", {
          data: { errorCode: "missing_scope", requiredScope: "tyr:manage" }
        });
        break;
      }
      const reply = dispatchCommunicationAgentHandoff(ctx, {
        serverId: input.serverId,
        userId: input.userId,
        assistant: input.assistant,
        channelId: input.channelId,
        conversationId: input.conversationId,
        sourceMessageId: input.sourceMessageId,
        ...(evidenceSelections.length ? { evidenceSelections } : {}),
        returnTarget: input.returnTarget,
        publicReplyAudience: input.sourceContext.accessMode === "workspace_bridge" ? "workspace_bridge" : "local",
        ...(input.sourceContext.bridgeContinuationAttemptId && input.sourceContext.accessMode !== "workspace_bridge"
          ? { publicReplyPhase: "bridge_continuation" as const }
          : {}),
        ...(input.sourceContext.systemTrigger?.kind === "heartbeat"
          ? { executionPolicy: input.sourceContext.systemTrigger }
          : {})
      }, agent, instruction);
      const completed = Boolean(reply.executionIds?.length);
      result = toolResult(call, completed ? "completed" : "failed", reply.content, {
        data: { agent: safeAgent(ctx, agent), instruction },
        ...(reply.executionIds ? { executionIds: reply.executionIds } : {}),
        presentation: {
          kind: "agent_handoff",
          agentName: agent.displayName,
          agentHandle: agent.name,
          state: completed
            ? agent.status === "working"
              ? "queued"
              : "routed"
            : "failed"
        }
      });
      break;
    }
    case "list_heartbeats": {
      if (membership.role !== "owner") {
        result = toolResult(call, "denied", "Workspace Owner access is required to read Heartbeats.", {
          data: { errorCode: "server_owner_required" }
        });
        break;
      }
      const heartbeats = ctx.store.listTyrHeartbeats(input.serverId);
      result = toolResult(
        call,
        "completed",
        heartbeats.length
          ? `Found ${heartbeats.length} TYR Heartbeat${heartbeats.length === 1 ? "" : "s"}.`
          : "No TYR Heartbeats are configured.",
        { data: { heartbeats: heartbeats.map(safeHeartbeat) } }
      );
      break;
    }
    case "list_heartbeat_runs": {
      if (membership.role !== "owner") {
        result = toolResult(call, "denied", "Workspace Owner access is required to read Heartbeat runs.", {
          data: { errorCode: "server_owner_required" }
        });
        break;
      }
      const heartbeatId = call.arguments.heartbeatId?.trim();
      if (heartbeatId && !ctx.store.getTyrHeartbeat(heartbeatId, input.serverId)) {
        result = semanticArgumentError(call, "heartbeat_not_found");
        break;
      }
      const runs = ctx.store.listTyrHeartbeatRuns({
        serverId: input.serverId,
        ...(heartbeatId ? { heartbeatId } : {}),
        limit: 100
      });
      result = toolResult(
        call,
        "completed",
        runs.length
          ? `Found ${runs.length} recent Heartbeat run${runs.length === 1 ? "" : "s"}.`
          : "No Heartbeat runs were found.",
        { data: { runs: runs.map(safeHeartbeatRun) } }
      );
      break;
    }
    case "create_heartbeat": {
      if (membership.role !== "owner") {
        result = toolResult(call, "denied", "Workspace Owner access is required to create Heartbeats.", {
          data: { errorCode: "server_owner_required" }
        });
        break;
      }
      try {
        const heartbeat = ctx.store.createTyrHeartbeat({
          serverId: input.serverId,
          tyrAgentId: input.assistant.id,
          title: call.arguments.title,
          instruction: call.arguments.instruction,
          intervalUnit: call.arguments.intervalUnit,
          intervalValue: Number(call.arguments.intervalValue),
          createdByUserId: input.userId
        });
        recordHeartbeatAudit(ctx, input, call, "communication_agent_heartbeat_created", heartbeat.id, {
          intervalUnit: heartbeat.intervalUnit,
          intervalValue: heartbeat.intervalValue
        });
        ctx.publishWorkspaceSync();
        result = toolResult(call, "completed", `Created and enabled Heartbeat “${heartbeat.title}”.`, {
          data: { heartbeat: safeHeartbeat(heartbeat) }
        });
      } catch (error) {
        result = semanticArgumentError(call, error instanceof Error ? error.message : "heartbeat_create_failed");
      }
      break;
    }
    case "update_heartbeat": {
      if (membership.role !== "owner") {
        result = toolResult(call, "denied", "Workspace Owner access is required to update Heartbeats.", {
          data: { errorCode: "server_owner_required" }
        });
        break;
      }
      const heartbeatId = call.arguments.heartbeatId.trim();
      const current = ctx.store.getTyrHeartbeat(heartbeatId, input.serverId);
      if (!current) {
        result = semanticArgumentError(call, "heartbeat_not_found");
        break;
      }
      const hasUpdate = call.arguments.title !== undefined ||
        call.arguments.instruction !== undefined ||
        call.arguments.intervalUnit !== undefined ||
        call.arguments.intervalValue !== undefined;
      if (!hasUpdate) {
        result = semanticArgumentError(call, "heartbeat_update_required");
        break;
      }
      const update = {
        ...(call.arguments.title !== undefined ? { title: call.arguments.title } : {}),
        ...(call.arguments.instruction !== undefined ? { instruction: call.arguments.instruction } : {}),
        ...(call.arguments.intervalUnit !== undefined ? { intervalUnit: call.arguments.intervalUnit } : {}),
        ...(call.arguments.intervalValue !== undefined ? { intervalValue: Number(call.arguments.intervalValue) } : {})
      };
      const changed = (update.title !== undefined && update.title.trim() !== current.title) ||
        (update.instruction !== undefined && update.instruction.trim() !== current.instruction) ||
        (update.intervalUnit !== undefined && update.intervalUnit !== current.intervalUnit) ||
        (update.intervalValue !== undefined && update.intervalValue !== current.intervalValue);
      if (!changed) {
        result = toolResult(call, "noop", `Heartbeat “${current.title}” already has those settings.`, {
          data: { heartbeat: safeHeartbeat(current) }
        });
        break;
      }
      try {
        const heartbeat = ctx.store.updateTyrHeartbeat(heartbeatId, input.serverId, update)!;
        recordHeartbeatAudit(ctx, input, call, "communication_agent_heartbeat_updated", heartbeat.id, {
          intervalUnit: heartbeat.intervalUnit,
          intervalValue: heartbeat.intervalValue
        });
        ctx.publishWorkspaceSync();
        result = toolResult(call, "completed", `Updated Heartbeat “${heartbeat.title}”.`, {
          data: { heartbeat: safeHeartbeat(heartbeat) }
        });
      } catch (error) {
        result = semanticArgumentError(call, error instanceof Error ? error.message : "heartbeat_update_failed");
      }
      break;
    }
    case "enable_heartbeat":
    case "disable_heartbeat": {
      if (membership.role !== "owner") {
        result = toolResult(call, "denied", "Workspace Owner access is required to change Heartbeat state.", {
          data: { errorCode: "server_owner_required" }
        });
        break;
      }
      const heartbeatId = call.arguments.heartbeatId.trim();
      const current = ctx.store.getTyrHeartbeat(heartbeatId, input.serverId);
      if (!current) {
        result = semanticArgumentError(call, "heartbeat_not_found");
        break;
      }
      const enabled = call.name === "enable_heartbeat";
      if (current.enabled === enabled) {
        result = toolResult(call, "noop", `Heartbeat “${current.title}” is already ${enabled ? "enabled" : "paused"}.`, {
          data: { heartbeat: safeHeartbeat(current), cancelledQueuedRuns: 0 }
        });
        break;
      }
      try {
        const heartbeat = ctx.store.updateTyrHeartbeat(heartbeatId, input.serverId, { enabled })!;
        const cancelledRuns = enabled ? [] : ctx.store.cancelQueuedTyrHeartbeatRuns(heartbeat.id);
        recordHeartbeatAudit(
          ctx,
          input,
          call,
          enabled ? "communication_agent_heartbeat_enabled" : "communication_agent_heartbeat_disabled",
          heartbeat.id,
          { enabled, cancelledQueuedRuns: cancelledRuns.length }
        );
        ctx.publishWorkspaceSync();
        result = toolResult(
          call,
          "completed",
          enabled
            ? `Enabled Heartbeat “${heartbeat.title}”.`
            : `Paused Heartbeat “${heartbeat.title}” and cancelled ${cancelledRuns.length} queued run${cancelledRuns.length === 1 ? "" : "s"}. Active work was not interrupted.`,
          { data: { heartbeat: safeHeartbeat(heartbeat), cancelledQueuedRuns: cancelledRuns.length } }
        );
      } catch (error) {
        result = semanticArgumentError(call, error instanceof Error ? error.message : "heartbeat_update_failed");
      }
      break;
    }
    case "list_workspace_bridges": {
      if (
        input.sourceContext.source === "mcp" &&
        !input.sourceContext.grantedScopes?.includes("tyr:bridge:read")
      ) {
        result = toolResult(call, "denied", "This MCP connection is missing tyr:bridge:read.", {
          data: { errorCode: "missing_scope", requiredScope: "tyr:bridge:read" }
        });
        break;
      }
      try {
        const actor = {
          userId: input.userId,
          serverId: input.serverId,
          source: input.sourceContext.source
        } as const;
        const currentWorkspace = bridgeService.currentWorkspace(actor);
        const bridges = bridgeService.list(actor).filter((bridge) => (
          // 入站 Bridge 是当前会话的自动回传路径，不应被 list 工具重新暴露为可转发下一跳。
          input.sourceContext.accessMode !== "workspace_bridge" ||
          bridge.id !== input.sourceContext.workspaceBridgeId
        ));
        const bridgeNames = bridges.map((bridge) => bridge.peerWorkspaceName).join(", ");
        result = toolResult(
          call,
          "completed",
          bridges.length
            ? `Current workspace: ${currentWorkspace.name}. Found ${bridges.length} active Workspace Bridge${bridges.length === 1 ? "" : "s"}: ${bridgeNames}.`
            : `Current workspace: ${currentWorkspace.name}. No active Workspace Bridges are available.`,
          {
            data: { currentWorkspace, bridges },
            // 最终回复只使用可公开字段做上下文回答，不让模型转述 Bridge stable ID。
            presentation: {
              kind: "workspace_bridge_list",
              currentWorkspaceName: currentWorkspace.name,
              bridges: bridges.map((bridge) => ({
                peerWorkspaceName: bridge.peerWorkspaceName,
                status: "active",
                direction: bridge.direction,
                permissions: [...bridge.permissions]
              }))
            }
          }
        );
      } catch (error) {
        const code = error instanceof WorkspaceBridgeRequestError ? error.code : "workspace_bridge_list_failed";
        result = semanticArgumentError(call, code);
      }
      break;
    }
    case "create_workspace_bridge_invite": {
      if (input.sourceContext.accessMode === "workspace_bridge" || input.sourceContext.source === "mcp" || input.sourceContext.parentBridgeRequestId) {
        result = semanticArgumentError(call, "workspace_bridge_local_human_required");
        break;
      }
      try {
        if (call.arguments.recipientEmail !== undefined) {
          const source = input.sourceMessageId ? ctx.store.getMessage(input.sourceMessageId) : null;
          const email = call.arguments.recipientEmail.trim().toLowerCase();
          const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const emailInRequest = email && new RegExp(`(^|[^a-z0-9._%+@-])${escapedEmail}(?![a-z0-9_@+-]|\\.[a-z0-9])`, "i").test(source?.content ?? "");
          if (!source || !emailInRequest ||
              input.sourceContext.continuationStepCount || input.sourceContext.bridgeContinuationAttemptId || input.sourceContext.systemTrigger) {
            result = toolResult(call, "denied", "Please provide the recipient's exact email in your invitation request.", { data: { errorCode: "workspace_bridge_invite_email_required" } });
            break;
          }
          const mail = ctx.workspaceBridgeEmailInvitations ?? new WorkspaceBridgeEmailInvitations(ctx);
          const intent = await mail.invite({ serverId: input.serverId, userId: input.userId,
            sourceMessageId: source.id, channelId: input.channelId, conversationId: input.conversationId,
            source: input.sourceContext.source as "web" | "telegram" | "email",
            externalRef: input.returnTarget?.externalRef ?? input.sourceContext.externalRef }, email);
          const message = intent.status === "active" ? "This invitation has already been accepted and the Bridge is connected."
            : intent.status !== "pending" ? `This invitation is ${intent.status}. Please request a new invitation if needed.`
            : intent.deliveryStatus === "sent" ? `Bridge invitation sent to ${email}. It connects as soon as they accept; no further confirmation is needed from you.`
            : intent.deliveryStatus === "failed" || intent.deliveryStatus === "stopped" ? "Invitation email delivery could not be confirmed. Please check its status before requesting another invitation."
            : `Bridge invitation to ${email} is queued for email delivery. It has not been confirmed sent; TYR will notify this conversation when delivery succeeds or fails.`;
          result = toolResult(call, intent.deliveryStatus === "failed" || intent.deliveryStatus === "stopped" ? "failed"
            : intent.status === "pending" && intent.deliveryStatus !== "sent" ? "queued" : "completed", message,
            { data: { intentId: intent.id, status: intent.status, deliveryStatus: intent.deliveryStatus, expiresAt: intent.expiresAt } });
          ctx.publishWorkspaceSync();
          break;
        }
        const intent = connectionService.create(input.serverId, input.userId);
        result = toolResult(call, "completed", `Created a Workspace connection link. Share it with the other Workspace Owner. It expires in 24 hours.\n${intent.url}`, {
          data: { intentId: intent.id, url: intent.url, expiresAt: intent.expiresAt }
        });
      } catch (error) {
        const code = error instanceof BridgeConnectionError ? error.code : "workspace_bridge_invite_failed";
        const message = code === "workspace_bridge_existing_owner_required" ? "This existing TYR account must own a separate Workspace before it can accept a Bridge invitation. No invitation was sent."
          : code === "workspace_bridge_email_not_configured" ? "TYR email delivery is not configured. No invitation was sent."
          : undefined;
        result = message ? toolResult(call, "failed", message, { data: { errorCode: code } }) : semanticArgumentError(call, code);
      }
      break;
    }
    case "list_workspace_bridge_invites": {
      if (input.sourceContext.accessMode === "workspace_bridge" || input.sourceContext.source === "mcp" || input.sourceContext.parentBridgeRequestId) {
        result = semanticArgumentError(call, "workspace_bridge_local_human_required");
        break;
      }
      try {
        const intents = connectionService.list(input.serverId, input.userId);
        result = toolResult(call, "completed", intents.length
          ? intents.map((intent) => intent.invitationKind === "email"
            ? `Email invitation: ${intent.deliveryStatus}. The recipient can accept to connect directly. Expires ${intent.expiresAt}.`
            : intent.status === "claimed"
            ? `${intent.targetWorkspaceName} (Owner: ${intent.targetOwnerDisplayName}) is waiting for your confirmation.`
            : `A connection link for ${intent.sourceWorkspaceName} is waiting for someone to open it.`).join("\n")
          : "There are no pending Workspace connection invitations.", { data: { intents } });
      } catch (error) {
        result = semanticArgumentError(call, error instanceof BridgeConnectionError ? error.code : "workspace_bridge_invite_failed");
      }
      break;
    }
    case "confirm_workspace_bridge_invite": {
      try {
        const { intent } = connectionService.confirm(call.arguments.intentId, input.serverId, input.userId);
        ctx.publishWorkspaceSync();
        result = toolResult(call, "completed", `Connected ${intent.sourceWorkspaceName} and ${intent.targetWorkspaceName}. Both sides can now use the Workspace Bridge.`, {
          data: { intentId: intent.id, bridgeId: intent.bridgeId }
        });
      } catch (error) {
        result = semanticArgumentError(call, error instanceof BridgeConnectionError ? error.code : "workspace_bridge_invite_failed");
      }
      break;
    }
    case "send_workspace_bridge_message": {
      let evidenceSelections: CommunicationEvidenceSelection[];
      try {
        evidenceSelections = parseEvidenceSelections(call.arguments.evidenceSelections);
        if (evidenceSelections.length) selectCommunicationEvidenceForContext(ctx.store, evidenceScope(input), evidenceSelections);
      } catch {
        result = semanticArgumentError(call, "communication_evidence_selection_invalid");
        break;
      }
      const sourceMessage = input.sourceMessageId ? ctx.store.getMessage(input.sourceMessageId) : null;
      const continuation = Boolean(input.sourceContext.continuationStepCount || input.sourceContext.bridgeContinuationAttemptId);
      const originAction = continuation && !input.sourceContext.parentBridgeRequestId && sourceMessage
        ? verifiedCommunicationOriginAction(ctx.store, {
            eventId: input.sourceContext.sourceEventKey,
            serverId: input.serverId,
            requestingUserId: input.userId,
            sourceMessageId: sourceMessage.id
          })
        : null;
      // A verified origin reference identifies the old inbound request. A later customer
      // notification is a new outbound request, even when the model calls it a reply.
      const originNoticeReplyAlias = Boolean(originAction &&
        call.arguments.replyToRequestId === originAction.originRequestId &&
        call.arguments.bridgeId === originAction.bridgeId &&
        call.arguments.message.trim() === originAction.peerMessage);
      // An inbound Bridge reply is always returned by the server. The model may supply a
      // stale or invented reply ID after local work; never reinterpret that as a source-side
      // follow-up or permit it to escape the target Workspace's hidden conversation.
      const proposedReplyRequest = call.arguments.replyToRequestId
        ? ctx.store.getCrossWorkspaceMessage(call.arguments.replyToRequestId) : null;
      const ownChildReply = proposedReplyRequest?.sourceWorkspaceId === input.serverId &&
        proposedReplyRequest.parentBridgeRequestId === input.sourceContext.parentBridgeRequestId &&
        Boolean(input.sourceContext.parentBridgeRequestId);
      if (call.arguments.replyToRequestId && input.sourceContext.accessMode === "workspace_bridge" && !ownChildReply) {
        result = toolResult(call, "skipped",
          "This is the inbound Bridge request. Reply with the completed result here; TYR returns it to the requester automatically.",
          { data: { errorCode: "inbound_bridge_auto_return" } });
        break;
      }
      if (call.arguments.replyToRequestId && !originNoticeReplyAlias) {
        if (input.sourceContext.source === "mcp" && !input.sourceContext.grantedScopes?.includes("tyr:bridge:send")) {
          result = toolResult(call, "denied", "This MCP connection is missing tyr:bridge:send.", {
            data: { errorCode: "missing_scope", requiredScope: "tyr:bridge:send" }
          });
          break;
        }
        const request = ctx.store.getCrossWorkspaceMessage(call.arguments.replyToRequestId);
        const followupKind = call.arguments.followupKind ?? "answer";
        // Follow-ups are bound to the original TYR DM and request capability, not a newly inferred peer destination.
        if (!request || request.bridgeId !== call.arguments.bridgeId ||
            request.originChannelId !== input.channelId || request.originConversationId !== (input.conversationId ?? null) ||
            request.awaitingAgentId !== input.assistant.id) {
          result = semanticArgumentError(call, "workspace_bridge_request_not_found");
          break;
        }
        const eventId = createHash("sha256")
          .update(JSON.stringify([input.sourceContext.sourceEventKey, request.id, followupKind, call.arguments.message.trim(), evidenceSelections]))
          .digest("hex").slice(0, 64);
        try {
          const sent = await bridgeService.followup({
            userId: input.userId, serverId: input.serverId, source: input.sourceContext.source,
            requestingUserId: input.sourceContext.requestingUserId,
            requestingUserName: input.sourceContext.requestingUserName,
            bridgeTraceId: input.sourceContext.bridgeTraceId,
            parentBridgeRequestId: input.sourceContext.parentBridgeRequestId
          }, {
            requestId: request.id, bridgeId: call.arguments.bridgeId, eventId,
            authoritySourceMessageId: input.sourceMessageId,
            kind: followupKind, content: call.arguments.message,
            originChannelId: input.channelId, originConversationId: input.conversationId ?? null,
            awaitingAgentId: input.assistant.id,
            ...(evidenceSelections.length ? { evidenceSelections, evidenceScope: evidenceScope(input) } : {})
          });
          result = toolResult(call, sent.event.peerMessageId ? "running" : "queued",
            `${sent.event.peerMessageId ? "Delivered" : "Queued"} a ${followupKind} for the open peer request ${request.id}.`, {
            data: { request: sent.status, interactionEventId: sent.event.id },
            bridgeRequestIds: [request.id]
          });
        } catch (error) {
          if (error instanceof WorkspaceBridgeRequestError && error.code === "workspace_bridge_request_completed") {
            const status = bridgeService.status({ userId: input.userId, serverId: input.serverId,
              source: input.sourceContext.source }, request.id);
            result = toolResult(call, status.state === "failed" ? "failed" : "completed",
              `This request already ended. No follow-up was sent. ${status.response ?? status.error?.message ?? "Review its saved result."}`, {
                data: { request: status, errorCode: error.code }, bridgeRequestIds: [request.id]
              });
          } else {
            result = semanticArgumentError(call, error instanceof WorkspaceBridgeRequestError ? error.code : "workspace_bridge_followup_failed");
          }
        }
        break;
      }
      if (input.sourceContext.failedBridgeId === call.arguments.bridgeId) {
        result = toolResult(call, "denied", "The failed Workspace Bridge step cannot be retried automatically. Report its result and ask the user before trying this route again.", {
          data: { errorCode: "bridge_automatic_retry_disabled" }
        });
        break;
      }
      if (
        input.sourceContext.source === "mcp" &&
        !input.sourceContext.grantedScopes?.includes("tyr:bridge:send")
      ) {
        result = toolResult(call, "denied", "This MCP connection is missing tyr:bridge:send.", {
          data: { errorCode: "missing_scope", requiredScope: "tyr:bridge:send" }
        });
        break;
      }
      const selectedBridge = ctx.store.getWorkspaceBridgeForServer(call.arguments.bridgeId, input.serverId);
      const parentRequest = input.sourceContext.parentBridgeRequestId
        ? ctx.store.getCrossWorkspaceMessage(input.sourceContext.parentBridgeRequestId)
        : null;
      const needsPeerOutboundPlan = Boolean(parentRequest);
      if ((needsPeerOutboundPlan || (!continuation && !input.sourceContext.bridgeContinuationAttemptId)) && sourceMessage) {
        try {
          // A peer can do local work first; only an attempted additional Bridge hop needs
          // root-request planning. The planner never reads the worker result as authority.
          const route = await prepareInitialCommunicationRoute(ctx, input, parentRequest ? undefined : {
            id: call.arguments.bridgeId, message: call.arguments.message
          });
          const question = routeClarification(route, Boolean(parentRequest));
          if (question || route.plan?.decision === "local") {
            result = toolResult(call, "denied", question ??
              "The original request was planned as local work. Please ask the requester before adding a Workspace Bridge step.", {
              data: { errorCode: question ? "route_needs_clarification" : "bridge_destination_not_requested" }
            });
            break;
          }
        } catch (error) {
          const failure = error instanceof CommunicationRoutePlanningError ? error
            : new CommunicationRoutePlanningError("route_planning_failed", "TYR could not verify the request route. No Bridge request was sent.");
          result = toolResult(call, "failed", failure.publicMessage, { data: { errorCode: failure.code } });
          break;
        }
      }
      const plannedContinuationId = !parentRequest && sourceMessage
        ? getCommunicationRouteIntent(ctx.store, sourceMessage.id)?.plan?.continuationRequestId : null;
      if (plannedContinuationId) {
        // The persisted semantic plan binds this new Human turn to old work. The
        // model cannot discard that identity by selecting the new-send tool shape.
        return executeTyrAssistantTool(ctx, { ...input,
          call: { ...call, arguments: { ...call.arguments, replyToRequestId: plannedContinuationId,
            followupKind: "instruction", message: sourceMessage!.content } }
        });
      }
      const savedIntent = continuation || parentRequest
        ? parentRequest
          ? getBridgeRouteIntent(ctx.store, parentRequest.id)
          : sourceMessage
            ? getCommunicationRouteIntent(ctx.store, sourceMessage.id)
            : null
        : null;
      const originNoticeAllowed = Boolean(originAction && originAction.bridgeId === call.arguments.bridgeId &&
        originAction.peerMessage === call.arguments.message.trim());
      const legacyRequest = parentRequest ?? sourceMessage;
      const legacyAllowed = Boolean(legacyRequest && selectedBridge?.peerWorkspace &&
        bridgeRouteIntentPredatesCutover(ctx.store, legacyRequest.createdAt) &&
        legacyRequestNamesBridgeDestination(legacyRequest.content, selectedBridge.peerWorkspace.name, Boolean(parentRequest)));
      const frozenDestinationAllowed = savedIntent
        ? savedIntent.serverId === input.serverId &&
          savedIntent.targetBridgeId === call.arguments.bridgeId &&
          savedIntent.allowedActions.includes("bridge_send")
        : legacyAllowed;
      const destinationAllowed = frozenDestinationAllowed || originNoticeAllowed;
      if (call.arguments.bridgeId !== input.sourceContext.workspaceBridgeId &&
          (input.sourceContext.parentBridgeRequestId || continuation) &&
          !destinationAllowed) {
        result = toolResult(call, "denied", "TYR could not verify this connected workspace as an authorized next destination. Ask the requester to clarify before sending a new Bridge request.", {
          data: { errorCode: "bridge_destination_not_requested" }
        });
        break;
      }
      // 显式正文标记具有权威性：模型可以选择 Bridge，但不能改写用户指定的消息正文。
      const message = originNoticeAllowed ? originAction!.peerMessage
        : exactWorkspaceBridgePayload(sourceMessage?.content) ?? call.arguments.message.trim();
      if (!message) {
        result = semanticArgumentError(call, "content_required");
        break;
      }
      const idempotencyKey = createHash("sha256")
        // Callback and model call IDs identify delivery attempts, not independent work.
        // A root/hop plus destination and step payload survives a worker/Bridge continuation.
        .update(JSON.stringify([originNoticeAllowed ? input.sourceContext.sourceEventKey
          : input.sourceContext.parentBridgeRequestId ?? input.sourceMessageId ?? input.sourceContext.sourceEventKey,
          input.serverId, input.userId, input.channelId, input.conversationId,
          call.arguments.bridgeId, message, evidenceSelections]))
        .digest("hex")
        .slice(0, 64);
      // A prepared route is not a grant: refresh again before creating the peer request.
      input = { ...input, sourceContext: restoreMcpCommunicationAuthority(ctx.store, {
        sourceMessageId: input.sourceMessageId ?? "", userId: input.userId, serverId: input.serverId,
        channelId: input.channelId, conversationId: input.conversationId, sourceContext: input.sourceContext
      }) };
      if (input.sourceContext.mcpAuthorizationError) {
        result = toolResult(call, "denied", mcpAuthorizationFailureMessage(input.sourceContext.mcpAuthorizationError), {
          data: { errorCode: input.sourceContext.mcpAuthorizationError }
        });
        break;
      }
      if (input.sourceContext.source === "mcp" && input.sourceContext.accessMode === "read_only") {
        return { ok: false, toolCallId: call.id, errorCode: "operation_not_allowed",
          message: "This request was not executed because the current MCP call is Read-only. The caller must confirm Action mode and start a new tyr_assistant_request operation." };
      }
      const missingDispatchScope = input.sourceContext.source === "mcp"
        ? ["tyr:manage", "tyr:bridge:send"].find((scope) => !input.sourceContext.grantedScopes?.includes(scope))
        : undefined;
      if (missingDispatchScope) {
        result = toolResult(call, "denied", `This MCP connection is missing ${missingDispatchScope}.`, {
          data: { errorCode: "missing_scope", requiredScope: missingDispatchScope }
        });
        break;
      }
      try {
        const boundRequest = input.sourceContext.bridgeFollowupRequestId
          ? ctx.store.getCrossWorkspaceMessage(input.sourceContext.bridgeFollowupRequestId) : null;
        // Only the server-owned root/hop and original capability may reuse a request.
        // A separate Human message remains a separate root, even with identical text.
        const scopedRequests = originNoticeAllowed ? [] : (ctx.store.db.prepare(`select id from cross_workspace_messages
          where bridge_id = ? and source_workspace_id = ? and source_capability_user_id = ?
            and origin_channel_id = ? and origin_conversation_id is ? and awaiting_agent_id = ?
            and response_kind is null and reply_to_message_id is null
            and ((? is not null and parent_bridge_request_id = ?) or (? is null and origin_message_id = ?))
          order by created_at, id`).all(call.arguments.bridgeId, input.serverId, input.userId,
            input.channelId, input.conversationId ?? null, input.assistant.id,
            input.sourceContext.parentBridgeRequestId ?? null, input.sourceContext.parentBridgeRequestId ?? null,
            input.sourceContext.parentBridgeRequestId ?? null, input.sourceMessageId ?? null) as Array<{ id: string }>)
          .flatMap(({ id }) => ctx.store.getCrossWorkspaceMessage(id) ?? []);
        const reusable = boundRequest && boundRequest.bridgeId === call.arguments.bridgeId &&
          boundRequest.sourceWorkspaceId === input.serverId && boundRequest.sourceCapabilityUserId === input.userId &&
          boundRequest.originChannelId === input.channelId && boundRequest.originConversationId === (input.conversationId ?? null) &&
          boundRequest.awaitingAgentId === input.assistant.id ? boundRequest
          : scopedRequests.find((request) => request.content === message) ?? scopedRequests.find((request) =>
            !request.resolvedByTerminalId && !ctx.store.db.prepare(
              "select 1 from cross_workspace_messages where terminal_request_id = ?"
            ).get(request.id));
        const sent = reusable ? { status: bridgeService.status({ userId: input.userId, serverId: input.serverId,
          source: input.sourceContext.source }, reusable.id) } : await bridgeService.send({
          userId: input.userId,
          serverId: input.serverId,
          source: input.sourceContext.source,
          clientId: input.sourceContext.clientId,
          grantId: input.sourceContext.grantId,
          requestingUserId: input.sourceContext.requestingUserId,
          requestingUserName: input.sourceContext.requestingUserName,
          requestingUserDisplayName: input.sourceContext.requestingUserDisplayName,
          requestingUserAvatarUrl: input.sourceContext.requestingUserAvatarUrl,
          bridgeTraceId: input.sourceContext.bridgeTraceId,
          parentBridgeRequestId: input.sourceContext.parentBridgeRequestId
        }, {
          bridgeId: call.arguments.bridgeId,
          content: message,
          attachmentIds: sourceMessage?.attachmentIds ?? [],
          idempotencyKey,
          ...(evidenceSelections.length ? { evidenceSelections, evidenceScope: evidenceScope(input) } : {}),
          origin: {
            // Bridge 主题跟随真实 Tyr conversation；同一会话从 Web 或外部通道继续时不会分叉。
            conversationKey: input.conversationId ?? input.sourceContext.sourceConversationKey,
            channelId: input.channelId,
            conversationId: input.conversationId,
            messageId: input.sourceMessageId,
            // 每一跳都在源 TYR 留下 waiter；子结果先回中间 TYR 核对，再形成父请求终态。
            awaitingAgentId: input.assistant.id,
            source: input.sourceContext.source,
            externalRef: input.sourceContext.externalRef
          },
          // Direct peer answers return in the same Assistant turn; delegated work remains an asynchronous Bridge request.
          waitSeconds: 10
        });
        const status = sent.status;
        const resultStatus = status.state === "needs_attention"
          ? "partial"
          : status.state === "completed"
          ? "completed"
          : status.state === "blocked_on_peer_approval"
            ? "blocked_on_peer_approval"
            : status.state === "failed"
              ? "failed"
              : status.state === "queued" || status.state === "delivered"
                ? "queued"
                : "running";
        const response = status.state === "needs_attention" ? status.progress?.summary ?? "The connected workspace request needs attention." : status.response ?? status.acknowledgement;
        result = toolResult(
          call,
          resultStatus,
          reusable && reusable.content !== message
            ? `No new request was sent. Continue request ${reusable.id} with replyToRequestId, or report its saved result. ${response ?? "The original request is still open."}`
            : status.state === "blocked_on_peer_approval"
            ? "The connected workflow is waiting for approval in a peer workspace."
            : response
              ? `${status.peerWorkspaceName} TYR replied:\n${response}`
              : `Sent the request to ${status.peerWorkspaceName}. The peer TYR is still working.`,
          {
            data: { request: status },
            bridgeRequestIds: [status.bridgeRequestId]
          }
        );
      } catch (error) {
        const code = error instanceof WorkspaceBridgeRequestError ? error.code : "workspace_bridge_send_failed";
        result = code === "workspace_bridge_chain_cycle"
          ? toolResult(
              call,
              "failed",
              "This request was not sent because it would route back through the same Workspace Bridge. Reply directly, check the original Bridge request status, or choose a different active Bridge.",
              { data: { errorCode: code } }
            )
          : semanticArgumentError(call, code);
      }
      break;
    }
    case "get_workspace_bridge_request": {
      if (
        input.sourceContext.source === "mcp" &&
        !input.sourceContext.grantedScopes?.includes("tyr:bridge:read")
      ) {
        result = toolResult(call, "denied", "This MCP connection is missing tyr:bridge:read.", {
          data: { errorCode: "missing_scope", requiredScope: "tyr:bridge:read" }
        });
        break;
      }
      try {
        const status = bridgeService.status({
          userId: input.userId,
          serverId: input.serverId,
          source: input.sourceContext.source
        }, call.arguments.requestId);
        const resultStatus = status.state === "needs_attention"
          ? "partial"
          : status.state === "completed"
          ? "completed"
          : status.state === "blocked_on_peer_approval"
            ? "blocked_on_peer_approval"
            : status.state === "failed"
              ? "failed"
              : status.state === "queued" || status.state === "delivered"
                ? "queued"
                : "running";
        result = toolResult(
          call,
          resultStatus,
          status.state === "blocked_on_peer_approval"
            ? "The connected workflow is waiting for approval in a peer workspace."
            : (status.state === "needs_attention" ? status.progress?.summary ?? "The connected workspace request needs attention." : undefined) ?? status.response ??
              status.acknowledgement ??
              `${status.peerWorkspaceName} TYR is still working.`,
          {
            data: { request: status },
            bridgeRequestIds: [status.bridgeRequestId]
          }
        );
      } catch (error) {
        const code = error instanceof WorkspaceBridgeRequestError ? error.code : "workspace_bridge_status_failed";
        result = semanticArgumentError(call, code);
      }
      break;
    }
  }

  return { ok: true, result };
}
