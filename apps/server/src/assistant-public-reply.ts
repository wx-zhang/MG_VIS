import type { AssistantToolLoopResult } from "./assistant-llm";
import { findTyrAssistantOperationById } from "@tyr-ai/contracts";
import { findTyrAssistantTool } from "./assistant-tools";
import { effectiveAssistantToolSteps } from "./assistant-evidence-review";
import { canFinishWithReaction, isReactionConfirmation, isSuccessfulReaction } from "./assistant-reaction-response";
import path from "node:path";
import { maskAllowedWorkspacePaths } from "./assistant-workspace-path-disclosure";

export interface AssistantPublicReply {
  content: string;
  replySuppressed?: boolean;
  allowedAgentIds: string[];
  error?: AssistantPublicError;
}

export interface AssistantPublicError {
  code:
    | "operation_not_allowed"
    | "assistant_model_timeout"
    | "assistant_provider_error"
    | "assistant_tool_loop_failed";
  requiredTool?: "tyr_assistant_request";
  requiredScope?: "tyr:manage";
  actionModeRequired?: boolean;
  newOperationRequired?: boolean;
  blockedTool?: string;
}

interface AssistantPublicReplyOptions {
  accessMode?: "read_only" | "manage" | "workspace_bridge";
  hasAvailableWorkerAgent?: boolean;
  userMessage?: string;
}

interface AssistantPublicAgentIdVisibilityInput {
  content: string;
  agentIds: string[];
  allowedAgentIds: string[];
  /** Exact server-verified path spans; this does not permit an embedded ID elsewhere. */
  allowedWorkspacePaths?: string[];
}

interface AssistantPublicAgentIdVisibilityResult {
  content: string;
  blockedAgentIds: string[];
}

function handoffStateLabel(state: "routed" | "queued" | "unavailable" | "failed"): string {
  if (state === "routed") return "Routed";
  if (state === "queued") return "Queued";
  if (state === "unavailable") return "Unavailable";
  return "Failed";
}

function workspaceBridgeListReply(
  presentation: Extract<NonNullable<AssistantToolLoopResult["steps"][number]["result"]>["presentation"], { kind: "workspace_bridge_list" }>,
  userMessage: string | undefined,
  fallback: string
): string {
  const bridges = presentation.bridges;
  if (bridges.length === 0) {
    return `Current workspace: ${presentation.currentWorkspaceName}. No active Workspace Bridges are available.`;
  }
  const normalized = userMessage?.trim().toLowerCase() ?? "";
  const asksPermissions = /\bpermissions?\b|\baccess\b|权限|授权/.test(normalized);
  const asksStatus = /\bstatus\b|\bstate\b|\bactive\b|状态|是否可用|连接/.test(normalized);
  const asksName = /\bnames?\b|what (?:is|are).*bridge|名称|名字|叫什么/.test(normalized);

  if (asksPermissions || asksStatus) {
    return [
      `Current workspace: ${presentation.currentWorkspaceName}. Active Workspace Bridge details:`,
      ...bridges.map((bridge) => (
        `- ${bridge.peerWorkspaceName}: ${bridge.status}, ${bridge.direction}, permissions ${bridge.permissions.join(", ") || "none"}.`
      ))
    ].join("\n");
  }
  if (asksName) {
    return bridges.length === 1
      ? `The first and only active Workspace Bridge is ${bridges[0]!.peerWorkspaceName}.`
      : `The active Workspace Bridges are: ${bridges.map((bridge) => bridge.peerWorkspaceName).join(", ")}.`;
  }
  return fallback;
}

/**
 * 工具已执行时，公开回复以服务端结果为真源，不能继续信任模型对内部 tool payload 的转述。
 */
export function buildAssistantPublicReply(
  result: AssistantToolLoopResult,
  options: AssistantPublicReplyOptions = {}
): AssistantPublicReply {
  // A recovered inbound Bridge tool call produced no outbound side effect. Its diagnostic
  // receipt must not replace the model's subsequent reviewed answer or question.
  const publicSteps = effectiveAssistantToolSteps(result).filter((step) => !(
    // Local discovery is context for the destination TYR, not a peer disclosure.
    // Its receipt must never override the reviewed answer or explicit question.
    (options.accessMode === "workspace_bridge" && step.result?.status === "completed" &&
      (step.call?.name ?? step.rawCall.name) !== "get_workspace_bridge_request" &&
      findTyrAssistantOperationById(findTyrAssistantTool(step.call?.name ?? step.rawCall.name)?.operationId ?? "")?.risk === "read_only") ||
    // Evidence selection is an internal disclosure receipt, not the reviewed answer.
    // Keep failures visible; successful selections are attached separately by the caller.
    ((step.call?.name ?? step.rawCall.name) === "select_result_evidence" && step.result?.status === "completed") ||
    isSuccessfulReaction(step) ||
    (
      result.recoveredInboundOutboundDenial &&
      (step.call?.name ?? step.rawCall.name) === "send_workspace_bridge_message" &&
      ["bridge_destination_not_requested", "inbound_bridge_auto_return"].includes(
        (step.result?.data as { errorCode?: string } | undefined)?.errorCode ?? "")
    )
  ));
  const bridgeSteps = publicSteps.filter((step) => {
    const toolName = step.call?.name ?? step.rawCall.name;
    return toolName === "send_workspace_bridge_message" || toolName === "get_workspace_bridge_request";
  });
  const latestBridgeStepByRequest = new Map<string, (typeof bridgeSteps)[number]>();
  for (const step of bridgeSteps) {
    const requestKey = step.result?.bridgeRequestIds?.[0] ?? `tool-call:${step.rawCall.id}`;
    latestBridgeStepByRequest.set(requestKey, step);
  }

  const blockedStep = publicSteps.find((step) => step.errorCode === "operation_not_allowed");
  if (blockedStep) {
    const blockedTool = blockedStep.call?.name ?? blockedStep.rawCall.name;
    if (options.accessMode === "workspace_bridge") {
      const workerTool = blockedTool === "send_instruction_to_agent" || [
        "start_agent",
        "stop_agent",
        "restart_agent",
        "reset_agent",
        "delete_agent",
        "start_agents_on_computer",
        "stop_agents_on_computer",
        "restart_agents_on_computer"
      ].includes(blockedTool);
      return {
        content: workerTool && options.hasAvailableWorkerAgent === false
          ? "No online worker Agent is available in the connected workspace. Its owner needs to start an Agent before this request can run."
          : "The destination workspace could not authorize this operation.",
        allowedAgentIds: [],
        error: { code: "operation_not_allowed", ...(blockedTool ? { blockedTool } : {}) }
      };
    }
    // MCP 只读边界命中时明确要求外层客户端确认 Action 并新建 operation；服务端不能静默升级只读调用。
    return {
      content: "This request was not executed because the current MCP call is Read-only. After the user confirms Action mode, call tyr_assistant_request as a new operation without reusing this query's operationId.",
      allowedAgentIds: [],
      error: {
        code: "operation_not_allowed",
        requiredTool: "tyr_assistant_request",
        requiredScope: "tyr:manage",
        actionModeRequired: true,
        newOperationRequired: true,
        ...(blockedTool ? { blockedTool } : {})
      }
    };
  }

  if (latestBridgeStepByRequest.size > 1) {
    const messages = [...latestBridgeStepByRequest.values()].flatMap((step) => {
      const message = step.result?.message.trim() || step.errorMessage?.trim();
      return message ? [message] : [];
    });
    // 多目标派发是一条用户意图的独立结果集合；任一失败不能覆盖已经接受的其他请求。
    return {
      content: messages.join("\n\n") || result.content,
      allowedAgentIds: []
    };
  }

  const handoffs = publicSteps.flatMap((step) => {
    const presentation = step.result?.presentation;
    return presentation?.kind === "agent_handoff" ? [presentation] : [];
  });
  if (
    handoffs.length > 0 &&
    options.accessMode === "workspace_bridge" &&
    options.hasAvailableWorkerAgent === false &&
    handoffs.every((handoff) => handoff.state !== "routed" && handoff.state !== "queued")
  ) {
    return {
      content: "No online worker Agent is available in the connected workspace. Its owner needs to start an Agent before this request can run.",
      allowedAgentIds: []
    };
  }
  if (handoffs.length > 0 && options.accessMode === "workspace_bridge") {
    const allRouted = handoffs.every((handoff) => handoff.state === "routed");
    const allAccepted = handoffs.every(
      (handoff) => handoff.state === "routed" || handoff.state === "queued"
    );
    const anyAccepted = handoffs.some(
      (handoff) => handoff.state === "routed" || handoff.state === "queued"
    );
    // Bridge 对端只需要知道请求生命周期，不应从成功或异常文案推断目标 Workspace 的内部执行 Agent。
    const content = handoffs.length === 1
      ? handoffs[0]!.state === "routed"
        ? "The request was accepted by the connected workspace. I’ll report back here when it completes."
        : handoffs[0]!.state === "queued"
          ? "The request was queued in the connected workspace. I’ll report back here when it completes."
          : handoffs[0]!.state === "unavailable"
            ? "No online worker Agent is available in the connected workspace. Its owner needs to start an Agent before this request can run."
            : "The connected workspace could not route the request."
      : allRouted
        ? "The requests were accepted by the connected workspace. I’ll report each result here when it completes."
        : allAccepted
          ? "The requests were accepted by the connected workspace; some were queued. I’ll report each result here when it completes."
          : anyAccepted
            ? "Some requests were accepted by the connected workspace. I’ll report their results here when they complete."
            : "The connected workspace could not route the requests.";
    return { content, allowedAgentIds: [] };
  }
  if (handoffs.length === 1) {
    const handoff = handoffs[0]!;
    const content = handoff.state === "routed"
      ? `Routed to ${handoff.agentName}. I will report back here when it responds.`
      : handoff.state === "queued"
        ? `${handoff.agentName} is busy, so the instruction was queued. I will report back here when it responds.`
        : handoff.state === "unavailable"
          ? `${handoff.agentName} is unavailable, so the instruction was not routed.`
          : `I couldn't route the instruction to ${handoff.agentName}.`;
    return { content, allowedAgentIds: [] };
  }
  if (handoffs.length > 1) {
    const allRouted = handoffs.every((handoff) => handoff.state === "routed");
    const allAccepted = handoffs.every(
      (handoff) => handoff.state === "routed" || handoff.state === "queued"
    );
    const anyAccepted = handoffs.some(
      (handoff) => handoff.state === "routed" || handoff.state === "queued"
    );
    return {
      content: [
        allRouted
          ? `Instructions sent to ${handoffs.length} Agents:`
          : allAccepted
            ? `Instructions accepted by ${handoffs.length} Agents:`
            : `Agent routing results for ${handoffs.length} Agents:`,
        "",
        ...handoffs.map((handoff) => `- ${handoff.agentName} — ${handoffStateLabel(handoff.state)}`),
        ...(anyAccepted
          ? ["", allRouted
            ? "I’ll report each routed result here when it replies."
            : "I’ll report each accepted result here when it replies."]
          : [])
      ].join("\n"),
      allowedAgentIds: []
    };
  }

  const latestBridgeResult = [...latestBridgeStepByRequest.values()][0]?.result;
  if (latestBridgeResult) {
    // 同一 Bridge 请求可能产生 send 与 status 两个步骤；公开回复只采用最新的服务端状态。
    return {
      content: latestBridgeResult.message.trim() || result.content,
      allowedAgentIds: []
    };
  }

  const completedResults = publicSteps.flatMap((step) => step.result ? [step.result] : []);
  if (completedResults.length > 0) {
    const workspaceBridgeList = [...completedResults]
      .reverse()
      .map((item) => item.presentation)
      .find((presentation) => presentation?.kind === "workspace_bridge_list");
    if (workspaceBridgeList?.kind === "workspace_bridge_list") {
      const fallback = completedResults.map((item) => item.message.trim()).filter(Boolean).at(-1) ?? result.content;
      return {
        // Bridge 列表追问只使用服务端公开投影和当前问题，原始 ID 不进入回复。
        content: workspaceBridgeListReply(workspaceBridgeList, options.userMessage, fallback),
        allowedAgentIds: []
      };
    }
    // Stable ID 只有经过明确的 get_agent_details(field=id) 调用才可进入公开正文。
    const allowedAgentIds = publicSteps.flatMap((step) => (
      step.call?.name === "get_agent_details" &&
      step.call.arguments.field === "id" &&
      step.result?.status === "completed"
        ? [step.call.arguments.agentId]
        : []
    ));
    return {
      content: [...new Set(completedResults.map((item) => item.message.trim()).filter(Boolean))].join("\n\n"),
      allowedAgentIds: [...new Set(allowedAgentIds)]
    };
  }

  if (canFinishWithReaction(result.steps)) {
    // Do not turn the server's tool receipt back into a second confirmation bubble.
    // Any substantive model answer is preserved; failures remain in publicSteps above.
    const content = isReactionConfirmation(result.content, result.steps)
      ? "" : result.content;
    return { content, allowedAgentIds: [], ...(!content.trim() ? { replySuppressed: true } : {}) };
  }
  return { content: result.content, allowedAgentIds: [] };
}

/**
 * 最终出口只检查当前 Workspace 的真实 Agent ID，避免用宽泛正则误伤普通文本、代码或 handle。
 */
export function enforceAssistantPublicAgentIdVisibility(
  input: AssistantPublicAgentIdVisibilityInput
): AssistantPublicAgentIdVisibilityResult {
  const allowed = new Set(input.allowedAgentIds);
  const blockedAgentIds = [...new Set(input.agentIds)]
    .filter((agentId) => {
      if (!agentId || allowed.has(agentId)) return false;
      // Only the workspace owner's terminal directory ID may occur in an approved path.
      // Another Agent ID in an ancestor directory must still be caught by its own scan.
      const ownWorkspacePaths = (input.allowedWorkspacePaths ?? []).filter((workspacePath) => (
        path.posix.basename(workspacePath) === agentId || path.win32.basename(workspacePath) === agentId
      ));
      return maskAllowedWorkspacePaths(input.content, ownWorkspacePaths).includes(agentId);
    });
  if (blockedAgentIds.length === 0) {
    return { content: input.content, blockedAgentIds: [] };
  }
  return {
    content: "I couldn't safely format that response. Please try again.",
    blockedAgentIds
  };
}
