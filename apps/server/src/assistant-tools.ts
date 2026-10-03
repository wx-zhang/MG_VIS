import {
  AGENT_EDITABLE_FIELDS,
  TYR_ASSISTANT_AGENT_DETAILS_FIELDS,
  type AgentEditableField,
  type RuntimePermissionMode,
  type TyrAssistantAgentDetailsField
} from "@tyr-ai/contracts";

export const TYR_ASSISTANT_TOOL_NAMES = [
  "get_workspace_status",
  "list_workspace_inventory",
  "list_computers",
  "get_computer_details",
  "create_computer_onboarding",
  "rename_computer",
  "detect_runtime_models",
  "list_agents",
  "get_agent_details",
  "get_agent_capabilities",
  "get_agent_scopes",
  "create_agent",
  "update_agent",
  "start_agent",
  "stop_agent",
  "restart_agent",
  "reset_agent",
  "delete_agent",
  "start_agents_on_computer",
  "stop_agents_on_computer",
  "restart_agents_on_computer",
  "send_instruction_to_agent",
  "ask_workspace_bridge_requester",
  "react_to_message",
  "select_result_evidence",
  "list_heartbeats",
  "list_heartbeat_runs",
  "create_heartbeat",
  "update_heartbeat",
  "enable_heartbeat",
  "disable_heartbeat",
  "list_workspace_bridges",
  "create_workspace_bridge_invite",
  "list_workspace_bridge_invites",
  "confirm_workspace_bridge_invite",
  "send_workspace_bridge_message",
  "get_workspace_bridge_request"
] as const;

export type TyrAssistantToolName = (typeof TYR_ASSISTANT_TOOL_NAMES)[number];
export type TyrAssistantConfirmationToolName = "delete_agent" | "reset_agent" | "confirm_workspace_bridge_invite";

type NoToolArguments = Record<string, never>;
type AgentTargetArguments = { agentId: string };
type ComputerTargetArguments = { computerId: string };

/**
 * 模型工具只接收服务端上下文中已经提供的稳定 ID，避免在执行阶段重新进入名称匹配或编号选择流程。
 */
export interface TyrAssistantToolArgumentsByName {
  react_to_message: { emoji: string };
  get_workspace_status: NoToolArguments;
  list_workspace_inventory: NoToolArguments;
  list_computers: NoToolArguments;
  get_computer_details: ComputerTargetArguments;
  create_computer_onboarding: { name?: string };
  rename_computer: ComputerTargetArguments & { name: string };
  detect_runtime_models: ComputerTargetArguments & { runtime: string };
  list_agents: NoToolArguments;
  get_agent_details: AgentTargetArguments & { field: TyrAssistantAgentDetailsField };
  get_agent_capabilities: AgentTargetArguments;
  get_agent_scopes: AgentTargetArguments;
  create_agent: {
    name: string;
    computerId: string;
    runtime: string;
    model?: string;
    permissionMode?: RuntimePermissionMode;
  };
  update_agent: AgentTargetArguments & {
    field: AgentEditableField;
    value: string;
  };
  start_agent: AgentTargetArguments;
  stop_agent: AgentTargetArguments;
  restart_agent: AgentTargetArguments;
  reset_agent: AgentTargetArguments;
  delete_agent: AgentTargetArguments;
  start_agents_on_computer: ComputerTargetArguments;
  stop_agents_on_computer: ComputerTargetArguments;
  restart_agents_on_computer: ComputerTargetArguments;
  send_instruction_to_agent: AgentTargetArguments & { instruction: string; evidenceSelections?: string };
  ask_workspace_bridge_requester: { question: string };
  select_result_evidence: { evidenceSelections: string };
  list_heartbeats: NoToolArguments;
  list_heartbeat_runs: { heartbeatId?: string };
  create_heartbeat: {
    title: string;
    instruction: string;
    intervalUnit: "minute" | "hour";
    intervalValue: string;
  };
  update_heartbeat: {
    heartbeatId: string;
    title?: string;
    instruction?: string;
    intervalUnit?: "minute" | "hour";
    intervalValue?: string;
  };
  enable_heartbeat: { heartbeatId: string };
  disable_heartbeat: { heartbeatId: string };
  list_workspace_bridges: NoToolArguments;
  create_workspace_bridge_invite: { recipientEmail?: string };
  list_workspace_bridge_invites: NoToolArguments;
  confirm_workspace_bridge_invite: { intentId: string };
  send_workspace_bridge_message: { bridgeId: string; message: string; replyToRequestId?: string; followupKind?: "answer" | "instruction" | "continue"; executionOrder?: "after_agent_result" | "independent"; evidenceSelections?: string };
  get_workspace_bridge_request: { requestId: string };
}

export type TyrAssistantToolCall = {
  [Name in TyrAssistantToolName]: {
    id: string;
    name: Name;
    arguments: TyrAssistantToolArgumentsByName[Name];
  }
}[TyrAssistantToolName];

export type TyrAssistantToolResultStatus =
  | "completed"
  | "noop"
  | "partial"
  | "denied"
  | "failed"
  | "skipped"
  | "queued"
  | "running"
  | "blocked_on_peer_approval"
  | "confirmation_required";

export interface TyrAssistantToolConfirmation {
  toolName: TyrAssistantConfirmationToolName;
  targetId: string;
  prompt: string;
}

export type TyrAssistantToolPresentation = {
  kind: "agent_handoff";
  agentName: string;
  agentHandle: string;
  state: "routed" | "queued" | "unavailable" | "failed";
} | {
  kind: "workspace_bridge_list";
  currentWorkspaceName: string;
  bridges: Array<{
    peerWorkspaceName: string;
    status: "active";
    direction: "one_way" | "bidirectional";
    permissions: string[];
  }>;
};

/**
 * Tool Executor 返回统一状态和可读摘要；模型不根据异常文本猜测执行是否成功。
 * presentation 只保存可公开展示的字段，不能包含 Agent stable ID。
 */
export interface TyrAssistantToolResult {
  toolCallId: string;
  toolName: TyrAssistantToolName;
  status: TyrAssistantToolResultStatus;
  message: string;
  data?: unknown;
  confirmation?: TyrAssistantToolConfirmation;
  executionIds?: string[];
  bridgeRequestIds?: string[];
  presentation?: TyrAssistantToolPresentation;
}

export interface TyrAssistantToolJsonSchemaProperty {
  type: "string";
  description: string;
  enum?: readonly string[];
}

export interface TyrAssistantToolJsonSchema {
  type: "object";
  properties: Readonly<Record<string, TyrAssistantToolJsonSchemaProperty>>;
  required: readonly string[];
  additionalProperties: false;
}

export interface TyrAssistantModelToolDefinition {
  type: "function";
  function: {
    name: TyrAssistantToolName;
    description: string;
    parameters: TyrAssistantToolJsonSchema;
  };
}

export interface TyrAssistantToolCatalogEntry {
  name: TyrAssistantToolName;
  operationId: string;
  description: string;
  parameters: TyrAssistantToolJsonSchema;
  requiresConfirmation: boolean;
}

const NO_ARGUMENTS: TyrAssistantToolJsonSchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false
};

const AGENT_ID = {
  type: "string",
  description: "Exact Agent ID from the supplied workspace context."
} as const;

const COMPUTER_ID = {
  type: "string",
  description: "Exact Device ID from the supplied workspace context."
} as const;

const BRIDGE_ID = {
  type: "string",
  description: "Exact active Workspace Bridge ID from the supplied workspace context."
} as const;

const HEARTBEAT_ID = {
  type: "string",
  description: "Exact Heartbeat ID returned by list_heartbeats."
} as const;

const EVIDENCE_SELECTIONS = {
  type: "string",
  description: 'JSON array selecting server-supplied evidence receipts and their original fields: [{"receiptId":"...","keys":["field"]}]. Optional excerpt must exactly match sourceContent. Select only information needed by this request and permitted for its recipient; never provide replacement values.'
} as const;

function objectParameters(
  properties: TyrAssistantToolJsonSchema["properties"],
  required: readonly string[]
): TyrAssistantToolJsonSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

/**
 * 这是实际提供给 TYR 模型的能力目录，不包含 candidate、forbidden 或内部传输能力。
 * operationId 仅用于把工具连接到现有服务实现，不参与模型侧 allow/deny 判断。
 */
export const TYR_ASSISTANT_TOOL_CATALOG = [
  {
    name: "get_workspace_status",
    operationId: "computerAgent.status",
    description: "Read a concise status summary for the current workspace, its Devices, and executable Agents.",
    parameters: NO_ARGUMENTS,
    requiresConfirmation: false
  },
  {
    name: "list_workspace_inventory",
    operationId: "computerAgent.inventory",
    description: "List the current workspace topology, including Devices and the executable Agents assigned to each Device.",
    parameters: NO_ARGUMENTS,
    requiresConfirmation: false
  },
  {
    name: "list_computers",
    operationId: "computer.list",
    description: "List Devices visible in the current workspace with their current runtime availability.",
    parameters: NO_ARGUMENTS,
    requiresConfirmation: false
  },
  {
    name: "get_computer_details",
    operationId: "computer.details",
    description: "Read current details and capabilities for one exact Device.",
    parameters: objectParameters({ computerId: COMPUTER_ID }, ["computerId"]),
    requiresConfirmation: false
  },
  {
    name: "create_computer_onboarding",
    operationId: "computer.onboard",
    description: "Create a short-lived onboarding link for adding one Device to the current workspace.",
    parameters: objectParameters({
      name: { type: "string", description: "Optional display name for the new Device." }
    }, []),
    requiresConfirmation: false
  },
  {
    name: "rename_computer",
    operationId: "computer.rename",
    description: "Rename one exact Device. Use only when the user asks to change the Device name.",
    parameters: objectParameters({
      computerId: COMPUTER_ID,
      name: { type: "string", description: "New Device display name." }
    }, ["computerId", "name"]),
    requiresConfirmation: false
  },
  {
    name: "detect_runtime_models",
    operationId: "computer.runtimeModels.detect",
    description: "Ask one exact Device to detect the models available for one installed runtime.",
    parameters: objectParameters({
      computerId: COMPUTER_ID,
      runtime: { type: "string", description: "Runtime ID to inspect, such as codex or claude." }
    }, ["computerId", "runtime"]),
    requiresConfirmation: false
  },
  {
    name: "list_agents",
    operationId: "agent.list",
    description: "List executable Agents visible in the current workspace and their current status.",
    parameters: NO_ARGUMENTS,
    requiresConfirmation: false
  },
  {
    name: "get_agent_details",
    operationId: "agent.details",
    description: "Read one current server-truth field for an exact executable Agent.",
    parameters: objectParameters({
      agentId: AGENT_ID,
      field: {
        type: "string",
        description: "Agent detail field to read.",
        enum: TYR_ASSISTANT_AGENT_DETAILS_FIELDS
      }
    }, ["agentId", "field"]),
    requiresConfirmation: false
  },
  {
    name: "get_agent_capabilities",
    operationId: "agent.capabilities",
    description: "Explain what one exact Agent is intended and currently able to do from its profile and runtime status.",
    parameters: objectParameters({ agentId: AGENT_ID }, ["agentId"]),
    requiresConfirmation: false
  },
  {
    name: "get_agent_scopes",
    operationId: "agent.scopes.read",
    description: "Read the granted Tyr capability scopes for one exact owned Agent.",
    parameters: objectParameters({ agentId: AGENT_ID }, ["agentId"]),
    requiresConfirmation: false
  },
  {
    name: "create_agent",
    operationId: "agent.create",
    description: "Create one executable Agent on one exact Device using an installed runtime and optional valid model.",
    parameters: objectParameters({
      name: { type: "string", description: "Display name for the new Agent." },
      computerId: COMPUTER_ID,
      runtime: { type: "string", description: "Installed runtime ID for the new Agent." },
      model: { type: "string", description: "Optional model ID supported by the selected runtime." },
      permissionMode: {
        type: "string",
        description: "Optional Runtime Access mode. Defaults to workspace-write.",
        enum: ["read-only", "workspace-write", "dev-full-access"]
      }
    }, ["name", "computerId", "runtime"]),
    requiresConfirmation: false
  },
  {
    name: "update_agent",
    operationId: "agent.update",
    description: "Update one supported field on one exact Agent: name, description, model, or permission mode.",
    parameters: objectParameters({
      agentId: AGENT_ID,
      field: {
        type: "string",
        description: "Supported Agent field to update.",
        enum: AGENT_EDITABLE_FIELDS
      },
      value: { type: "string", description: "Replacement value to validate and apply." }
    }, ["agentId", "field", "value"]),
    requiresConfirmation: false
  },
  {
    name: "start_agent",
    operationId: "agent.start",
    description: "Start one exact Agent. Use only for an explicit lifecycle request, not when the user asks a named Agent to perform work or run a command.",
    parameters: objectParameters({ agentId: AGENT_ID }, ["agentId"]),
    requiresConfirmation: false
  },
  {
    name: "stop_agent",
    operationId: "agent.stop",
    description: "Stop one exact Agent runtime. Use only when the user explicitly asks to change that Agent to the stopped or offline state.",
    parameters: objectParameters({ agentId: AGENT_ID }, ["agentId"]),
    requiresConfirmation: false
  },
  {
    name: "restart_agent",
    operationId: "agent.restart",
    description: "Restart one exact Agent runtime. Use only when the user explicitly requests a lifecycle restart.",
    parameters: objectParameters({ agentId: AGENT_ID }, ["agentId"]),
    requiresConfirmation: false
  },
  {
    name: "reset_agent",
    operationId: "agent.reset",
    description: "Clear one exact Agent's saved runtime session and start a fresh session. The user must confirm after this tool is selected.",
    parameters: objectParameters({ agentId: AGENT_ID }, ["agentId"]),
    requiresConfirmation: true
  },
  {
    name: "delete_agent",
    operationId: "agent.delete",
    description: "Delete one exact non-Communication Agent. The user must confirm after this tool is selected.",
    parameters: objectParameters({ agentId: AGENT_ID }, ["agentId"]),
    requiresConfirmation: true
  },
  {
    name: "start_agents_on_computer",
    operationId: "computer.agents.start",
    description: "Start all executable Agents currently assigned to one exact Device.",
    parameters: objectParameters({ computerId: COMPUTER_ID }, ["computerId"]),
    requiresConfirmation: false
  },
  {
    name: "stop_agents_on_computer",
    operationId: "computer.agents.stop",
    description: "Stop all executable Agents currently assigned to one exact Device when the user explicitly requests that batch lifecycle change.",
    parameters: objectParameters({ computerId: COMPUTER_ID }, ["computerId"]),
    requiresConfirmation: false
  },
  {
    name: "restart_agents_on_computer",
    operationId: "computer.agents.restart",
    description: "Restart all executable Agents currently assigned to one exact Device when the user explicitly requests that batch lifecycle change.",
    parameters: objectParameters({ computerId: COMPUTER_ID }, ["computerId"]),
    requiresConfirmation: false
  },
  {
    name: "send_instruction_to_agent",
    operationId: "communication.agent.handoff",
    description: "Send a work instruction or command to one exact Agent through the existing Tyr handoff. Use this when the user asks an Agent to do work or run a command, even if the Agent name contains words such as start or stop.",
    parameters: objectParameters({
      agentId: AGENT_ID,
      instruction: { type: "string", description: "Complete work instruction to forward to the Agent." },
      evidenceSelections: EVIDENCE_SELECTIONS
    }, ["agentId", "instruction"]),
    requiresConfirmation: false
  },
  {
    name: "ask_workspace_bridge_requester",
    operationId: "workspaceBridge.request.clarify",
    description: "Ask one necessary question on the current inbound Bridge request when information is missing. The request stays open; use only after applying this Workspace's Owner rules. Do not include secrets or private internal details.",
    parameters: objectParameters({ question: { type: "string", description: "Exact public question for the authenticated Bridge requester." } }, ["question"]),
    requiresConfirmation: false
  },
  {
    name: "react_to_message",
    operationId: "communication.message.react",
    description: "Set a native Telegram reaction on the current Human message, as TYR. Use sparingly when a brief acknowledgement or emotional response is appropriate. Never imply that the human Owner has read, approved or replied. Only available for an authenticated Telegram message; an empty emoji removes TYR's reaction.",
    parameters: objectParameters({ emoji: { type: "string", description: "One supported native reaction, or empty to remove TYR's reaction.", enum: ["", "👍", "❤", "🔥", "🎉", "🤔", "👀", "🙏", "😁"] } }, ["emoji"]),
    requiresConfirmation: false
  },
  {
    name: "select_result_evidence",
    operationId: "workspaceBridge.request.status",
    description: "Select authenticated evidence for the final TYR reply to this original request. The server preserves the selected original values and checks their source; selection does not establish business truth or authorize a new recipient. Use this before the final reply when another Agent needs to verify material facts.",
    parameters: objectParameters({ evidenceSelections: EVIDENCE_SELECTIONS }, ["evidenceSelections"]),
    requiresConfirmation: false
  },
  {
    name: "list_heartbeats",
    operationId: "heartbeat.list",
    description: "List TYR Heartbeats in the current workspace, including each stable ID, schedule, enabled state, and next run time.",
    parameters: NO_ARGUMENTS,
    requiresConfirmation: false
  },
  {
    name: "list_heartbeat_runs",
    operationId: "heartbeat.runs",
    description: "List recent TYR Heartbeat runs. Optionally limit the result to one exact Heartbeat ID returned by list_heartbeats.",
    parameters: objectParameters({ heartbeatId: HEARTBEAT_ID }, []),
    requiresConfirmation: false
  },
  {
    name: "create_heartbeat",
    operationId: "heartbeat.create",
    description: "Create an enabled TYR Heartbeat in the current workspace. Use only after the user confirms MCP Action mode.",
    parameters: objectParameters({
      title: { type: "string", description: "Short Heartbeat title." },
      instruction: { type: "string", description: "Complete work instruction TYR should run on schedule." },
      intervalUnit: { type: "string", description: "Schedule unit.", enum: ["minute", "hour"] },
      intervalValue: { type: "string", description: "Positive integer interval as a string." }
    }, ["title", "instruction", "intervalUnit", "intervalValue"]),
    requiresConfirmation: false
  },
  {
    name: "update_heartbeat",
    operationId: "heartbeat.update",
    description: "Update the title, instruction, or schedule of one exact TYR Heartbeat. First call list_heartbeats when its stable ID is not known. Use only after the user confirms MCP Action mode.",
    parameters: objectParameters({
      heartbeatId: HEARTBEAT_ID,
      title: { type: "string", description: "Optional replacement title." },
      instruction: { type: "string", description: "Optional replacement work instruction." },
      intervalUnit: { type: "string", description: "Optional schedule unit.", enum: ["minute", "hour"] },
      intervalValue: { type: "string", description: "Optional positive integer interval as a string." }
    }, ["heartbeatId"]),
    requiresConfirmation: false
  },
  {
    name: "enable_heartbeat",
    operationId: "heartbeat.enable",
    description: "Enable one exact paused TYR Heartbeat. First call list_heartbeats when its stable ID is not known. Use only after the user confirms MCP Action mode.",
    parameters: objectParameters({ heartbeatId: HEARTBEAT_ID }, ["heartbeatId"]),
    requiresConfirmation: false
  },
  {
    name: "disable_heartbeat",
    operationId: "heartbeat.disable",
    description: "Pause one exact TYR Heartbeat without deleting its history. Queued runs are cancelled, while active work continues. Use only after the user confirms MCP Action mode.",
    parameters: objectParameters({ heartbeatId: HEARTBEAT_ID }, ["heartbeatId"]),
    requiresConfirmation: false
  },
  {
    name: "list_workspace_bridges",
    operationId: "workspaceBridge.list",
    description: "List Workspace Bridges available to the current workspace. Use before asking a connected workspace when the target Bridge is not already unambiguous.",
    parameters: NO_ARGUMENTS,
    requiresConfirmation: false
  },
  {
    name: "create_workspace_bridge_invite",
    operationId: "workspaceBridge.invite.create",
    description: "Invite someone by email when the local human explicitly asks. New recipients verify their email and create a Workspace before accepting. With recipientEmail, send a bound invitation from TYR's email; the recipient's acceptance activates the Bridge without another inviter confirmation. Omit recipientEmail to create the existing shareable link, which still requires source confirmation. Never guess an email or create an account on the recipient's behalf.",
    parameters: objectParameters({ recipientEmail: { type: "string", description: "Exact email provided by the local human in this request. Omit for a shareable link." } }, []),
    requiresConfirmation: false
  },
  {
    name: "list_workspace_bridge_invites",
    operationId: "workspaceBridge.invite.list",
    description: "List this workspace's pending connection invitations and exact invite IDs, including the verified workspace waiting for the inviter's confirmation.",
    parameters: NO_ARGUMENTS,
    requiresConfirmation: false
  },
  {
    name: "confirm_workspace_bridge_invite",
    operationId: "workspaceBridge.invite.confirm",
    description: "Confirm one claimed connection invitation only after the local human explicitly approves the displayed peer workspace and owner.",
    parameters: objectParameters({ intentId: { type: "string", description: "Exact claimed invite ID returned by list_workspace_bridge_invites." } }, ["intentId"]),
    requiresConfirmation: true
  },
  {
    name: "send_workspace_bridge_message",
    operationId: "workspaceBridge.message.send",
    description: "Send the next authorized request to one active peer TYR; the server preserves its conversation. Use replyToRequestId only to answer or instruct an existing open request, never after its final reply. Never use a peer Agent ID as the target.",
    parameters: objectParameters({
      bridgeId: BRIDGE_ID,
      message: { type: "string", description: "Complete request for the peer TYR." },
      replyToRequestId: { type: "string", description: "Exact open Bridge request ID when answering a partial peer question or sending an instruction while it is still running. Omit after a final reply when sending the next authorized question in the same conversation." },
      followupKind: { type: "string", enum: ["answer", "instruction", "continue"], description: "For replyToRequestId: answer the peer's question, send an instruction, or request continued work." },
      executionOrder: { type: "string", enum: ["after_agent_result", "independent"], description: "When this call shares a response with an Agent handoff, set independent only if the Bridge request needs no result from that Agent. Otherwise send the Agent handoff first and let TYR resume before sending the Bridge request." },
      evidenceSelections: EVIDENCE_SELECTIONS
    }, ["bridgeId", "message"]),
    requiresConfirmation: false
  },
  {
    name: "get_workspace_bridge_request",
    operationId: "workspaceBridge.request.status",
    description: "Read the latest state and peer response for one Workspace Bridge request returned by send_workspace_bridge_message.",
    parameters: objectParameters({
      requestId: { type: "string", description: "Exact Bridge request ID returned by the send tool." }
    }, ["requestId"]),
    requiresConfirmation: false
  }
] as const satisfies readonly TyrAssistantToolCatalogEntry[];

export function findTyrAssistantTool(name: string): TyrAssistantToolCatalogEntry | undefined {
  return TYR_ASSISTANT_TOOL_CATALOG.find((tool) => tool.name === name);
}

export function buildTyrAssistantModelTools(): TyrAssistantModelToolDefinition[] {
  return TYR_ASSISTANT_TOOL_CATALOG.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

export function validateTyrAssistantToolCatalog(
  catalog: readonly TyrAssistantToolCatalogEntry[] = TYR_ASSISTANT_TOOL_CATALOG
): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  for (const tool of catalog) {
    if (names.has(tool.name)) errors.push(`duplicate_tool_name:${tool.name}`);
    names.add(tool.name);
    if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) errors.push(`invalid_tool_name:${tool.name}`);
    if (!tool.description.trim()) errors.push(`missing_description:${tool.name}`);
    if (tool.parameters.additionalProperties !== false) errors.push(`additional_properties_enabled:${tool.name}`);
    for (const required of tool.parameters.required) {
      if (!tool.parameters.properties[required]) errors.push(`missing_required_property:${tool.name}:${required}`);
    }
  }
  return errors;
}

export type TyrAssistantToolCallValidation =
  | { ok: true; call: TyrAssistantToolCall }
  | { ok: false; errorCode: "invalid_tool_call" | "unknown_tool" | "invalid_tool_arguments" };

export function validateTyrAssistantToolCall(value: unknown): TyrAssistantToolCallValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errorCode: "invalid_tool_call" };
  }
  const input = value as Record<string, unknown>;
  if (typeof input.id !== "string" || !input.id.trim() || typeof input.name !== "string") {
    return { ok: false, errorCode: "invalid_tool_call" };
  }
  const tool = findTyrAssistantTool(input.name);
  if (!tool) return { ok: false, errorCode: "unknown_tool" };
  if (!input.arguments || typeof input.arguments !== "object" || Array.isArray(input.arguments)) {
    return { ok: false, errorCode: "invalid_tool_arguments" };
  }

  const args = input.arguments as Record<string, unknown>;
  const allowedKeys = new Set(Object.keys(tool.parameters.properties));
  if (Object.keys(args).some((key) => !allowedKeys.has(key))) {
    return { ok: false, errorCode: "invalid_tool_arguments" };
  }
  for (const required of tool.parameters.required) {
    if (!(required in args)) return { ok: false, errorCode: "invalid_tool_arguments" };
  }
  for (const [key, raw] of Object.entries(args)) {
    const property = tool.parameters.properties[key];
    if (!property || typeof raw !== "string") {
      return { ok: false, errorCode: "invalid_tool_arguments" };
    }
    if (property.enum && !property.enum.includes(raw)) {
      return { ok: false, errorCode: "invalid_tool_arguments" };
    }
  }
  return { ok: true, call: value as TyrAssistantToolCall };
}
