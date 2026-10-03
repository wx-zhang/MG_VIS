import type { OperationParamDefinition } from "./operation-registry.js";

export type AgentToolLifecycle = "core" | "advanced" | "debug" | "internal";
export type AgentToolPromptPolicy = "startup" | "contextual" | "help-only" | "hidden";
export type AgentToolEntryPreference = "mcp-first" | "cli-first" | "native-first" | "cli-only" | "mcp-only" | "internal-only";
export type AgentToolTransport = "mcp" | "cli" | "daemon-native" | "internal" | "final-response";
export type AgentToolObservedTransport = AgentToolTransport | "not-run";
export type AgentToolTransportStatus = "preferred" | "fallback" | "degraded";
export type AgentToolSurfaceStability = "stable" | "deprecated" | "debug" | "internal";

export interface AgentToolDegradedTransport {
  transport: AgentToolTransport;
  reason: string;
}

export interface AgentToolRuntimeTransportPolicy {
  operationId: string;
  runtimeId: string;
  preferred: AgentToolTransport;
  fallbacks: readonly AgentToolTransport[];
  degradedTransports: readonly AgentToolDegradedTransport[];
}

export interface AgentToolRuntimeTransportPolicyOverride {
  runtimeId: string;
  preferred: AgentToolTransport;
  fallbacks?: readonly AgentToolTransport[];
  degradedTransports?: readonly AgentToolDegradedTransport[];
}

export interface AgentToolOperationObservability {
  operationId: string;
  runtimeId: string;
  selectedTransport: AgentToolObservedTransport;
  actualTransport: AgentToolObservedTransport;
  preferredTransport: AgentToolTransport;
  fallbackTransports: readonly AgentToolTransport[];
  degradedTransports: readonly AgentToolDegradedTransport[];
  policyReason?: string;
  degradedReason?: string;
  fallbackFrom?: AgentToolTransport;
  fallbackTo?: AgentToolTransport;
  failureClassification?: string;
  helpRequested?: boolean;
}

export interface BuildAgentToolOperationObservabilityInput {
  operationId: string;
  runtimeId: string;
  actualTransport: AgentToolObservedTransport;
  policyReason?: string;
  failureClassification?: string;
  helpRequested?: boolean;
}

export interface AgentToolSurfacePolicy {
  visibility: AgentToolPromptPolicy;
  stability: AgentToolSurfaceStability;
  reason: string;
  replacementOperationIds?: readonly string[];
  removal?: "none" | "future-major";
}

export interface AgentToolParam extends OperationParamDefinition {
  cliName?: string;
  mcpName?: string;
}

export interface AgentToolOperation {
  id: string;
  purpose: string;
  description: string;
  lifecycle: AgentToolLifecycle;
  promptPolicy: AgentToolPromptPolicy;
  entryPreference: AgentToolEntryPreference;
  exposure: {
    cli?: {
      group: string;
      command: string;
      usage: string;
    };
    mcp?: {
      tool: string;
    };
    internal?: {
      protocol: string;
    };
  };
  transportPolicy?: readonly AgentToolRuntimeTransportPolicyOverride[];
  surfacePolicy: AgentToolSurfacePolicy;
  params: readonly AgentToolParam[];
  examples: readonly string[];
  sideEffects: readonly string[];
  errors: readonly string[];
}

type AgentToolOperationDefinition = Omit<AgentToolOperation, "surfacePolicy">;

export interface GeneratedAgentToolCliArtifacts {
  rootHelp: string;
  groupHelp: Record<string, string>;
  commandHelp: Record<string, string>;
}

export interface GeneratedAgentToolPromptArtifacts {
  startupCheatSheet: string;
}

export interface GeneratedAgentToolMcpParamSpec {
  name: string;
  operationParamName: string;
  type: string;
  required: boolean;
  description: string;
  zodSchemaPattern: string;
}

export interface GeneratedAgentToolMcpToolSpec {
  operationId: string;
  tool: string;
  description: string;
  params: readonly GeneratedAgentToolMcpParamSpec[];
}

export interface GeneratedAgentToolMcpArtifacts {
  tools: readonly GeneratedAgentToolMcpToolSpec[];
}

export interface GeneratedAgentToolConformanceArtifacts {
  behaviorCases: readonly string[];
}

export interface GeneratedAgentToolArtifacts {
  runtimeId: string;
  cli: GeneratedAgentToolCliArtifacts;
  prompt: GeneratedAgentToolPromptArtifacts;
  mcp: GeneratedAgentToolMcpArtifacts;
  conformance: GeneratedAgentToolConformanceArtifacts;
}

export interface AgentToolBehaviorCase {
  id: string;
  operationId?: string;
  scenario: string;
  expectedAgentAction: string;
  disallowedAgentAction: string;
  promptPolicy: AgentToolPromptPolicy;
  runtimeIds: readonly string[];
}

export const CODEX_MCP_CHAT_TRANSPORT_DEGRADED_REASON = "codex_app_server_mcp_transport_no_bridge_start";

const ALL_AGENT_TOOL_RUNTIME_IDS = ["codex", "claude", "cursor", "opencode", "kimi", "copilot", "gemini", "antigravity"] as const;

const AGENT_TOOL_OPERATION_DEFINITIONS = [
  {
    id: "message.send",
    purpose: "Send an explicit progress, clarification, FYI, coordination, DM, or thread message.",
    description: "Send a message to an Agent-to-Agent DM or thread. In an active CLI turn, omit --target or use --target current to use that conversation. Ordinary chat replies should use final response instead. Mentions may execute target agents; use execute_mentions=false or --no-execute-mentions for FYI-only mentions.",
    lifecycle: "core",
    promptPolicy: "contextual",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "message", command: "send", usage: "tyr message send --target <target> --content <content>" },
      mcp: { tool: "send_message" }
    },
    params: [
      { name: "target", type: "string", required: true, description: "DM or thread target such as dm:@agent-name or dm:@agent-name:msgid. CLI may use current or omit this inside an active turn.", cliName: "target", mcpName: "target" },
      { name: "content", type: "string", required: true, description: "Message content. CLI also accepts positional text or stdin.", cliName: "content", mcpName: "content" },
      { name: "attachmentIds", type: "string[]", required: false, description: "Attachment ids to include with the message.", cliName: "attachment-id", mcpName: "attachment_ids" },
      { name: "executeMentions", type: "boolean", required: false, description: "Whether @mentions should wake target agents.", cliName: "execute-mentions/no-execute-mentions", mcpName: "execute_mentions" }
    ],
    examples: [
      "tyr message send --target \"dm:@agent-name\" --content \"Please check this\"",
      "tyr message send --target \"dm:@agent-name\" --no-execute-mentions --content \"FYI only\""
    ],
    sideEffects: ["Creates a message", "May wake mentioned agents unless disabled"],
    errors: ["INVALID_TARGET", "EMPTY_CONTENT", "INVALID_EXECUTE_MENTIONS_FLAGS", "REQUEST_FAILED"]
  },
  {
    id: "message.check",
    purpose: "Check for pending messages during recovery or debug.",
    description: "Check for new messages without waiting. Use this for recovery or debug; server wake delivery already includes the current message.",
    lifecycle: "advanced",
    promptPolicy: "help-only",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "message", command: "check", usage: "tyr message check" },
      mcp: { tool: "check_messages" }
    },
    params: [
      { name: "ackSeq", type: "number[]", required: false, description: "CLI-only sequence ids to acknowledge.", cliName: "ack-seq" }
    ],
    examples: ["tyr message check"],
    sideEffects: ["May acknowledge received messages"],
    errors: ["REQUEST_FAILED"]
  },
  {
    id: "message.read",
    purpose: "Read visible message history for context.",
    description: "Read message history for a DM or thread when more context is needed.",
    lifecycle: "core",
    promptPolicy: "startup",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "message", command: "read", usage: "tyr message read --target <dm-or-thread> [--limit <n>]" },
      mcp: { tool: "read_history" }
    },
    params: [
      { name: "target", type: "string", required: true, description: "DM or thread target. For DMs, the default scope is the active conversation.", cliName: "target", mcpName: "target" },
      { name: "scope", type: "\"conversation\" | \"dm_history\"", required: false, description: "Read scope. conversation is the default for DMs; dm_history reads all retained conversations in that DM.", cliName: "scope", mcpName: "scope" },
      { name: "conversationId", type: "string", required: false, description: "Explicit DM conversation id to read.", cliName: "conversation-id", mcpName: "conversation_id" },
      { name: "limit", type: "number", required: false, description: "Maximum number of messages.", cliName: "limit", mcpName: "limit" },
      { name: "around", type: "string | number", required: false, description: "Read messages around an id or sequence.", cliName: "around", mcpName: "around" },
      { name: "before", type: "number", required: false, description: "Read before a sequence.", cliName: "before", mcpName: "before" },
      { name: "after", type: "number", required: false, description: "Read after a sequence.", cliName: "after", mcpName: "after" }
    ],
    examples: ["tyr message read --target \"dm:@agent-name\" --limit 20"],
    sideEffects: [],
    errors: ["INVALID_TARGET", "REQUEST_FAILED"]
  },
  {
    id: "message.search",
    purpose: "Search visible message history.",
    description: "Search visible messages when context cannot be found in the current wake.",
    lifecycle: "core",
    promptPolicy: "startup",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "message", command: "search", usage: "tyr message search --query <query>" },
      mcp: { tool: "search_messages" }
    },
    params: [
      { name: "query", type: "string", required: true, description: "Search query.", cliName: "query", mcpName: "query" },
      { name: "target", type: "string", required: false, description: "Optional DM or thread target. For DMs, the default scope is the active conversation.", cliName: "target", mcpName: "target" },
      { name: "scope", type: "\"conversation\" | \"dm_history\" | \"all_accessible\"", required: false, description: "Search scope. conversation is the default for DMs; dm_history searches all retained conversations in that DM; all_accessible searches all conversations the Agent can access.", cliName: "scope", mcpName: "scope" },
      { name: "conversationId", type: "string", required: false, description: "Explicit DM conversation id to search.", cliName: "conversation-id", mcpName: "conversation_id" },
      { name: "senderId", type: "string", required: false, description: "Optional sender id.", cliName: "sender-id", mcpName: "sender_id" },
      { name: "limit", type: "number", required: false, description: "Maximum results.", cliName: "limit", mcpName: "limit" }
    ],
    examples: ["tyr message search --query \"deployment error\" --target \"dm:@agent-name\""],
    sideEffects: [],
    errors: ["INVALID_QUERY", "REQUEST_FAILED"]
  },
  {
    id: "task.list",
    purpose: "List tasks in a DM or thread.",
    description: "List tasks in a DM or thread for task context and recovery.",
    lifecycle: "core",
    promptPolicy: "startup",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "task", command: "list", usage: "tyr task list --target <dm-or-thread>" },
      mcp: { tool: "list_tasks" }
    },
    params: [
      { name: "target", type: "string", required: true, description: "DM or thread target.", cliName: "target", mcpName: "target" },
      { name: "status", type: "TaskStatus | all", required: false, description: "Optional task status filter.", cliName: "status", mcpName: "status" }
    ],
    examples: ["tyr task list --target \"dm:@agent-name\""],
    sideEffects: [],
    errors: ["REQUEST_FAILED"]
  },
  {
    id: "task.create",
    purpose: "Create one or more task messages.",
    description: "Create one or more task messages in a DM or thread when the human explicitly asks for task creation.",
    lifecycle: "advanced",
    promptPolicy: "help-only",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "task", command: "create", usage: "tyr task create --target <dm-or-thread> --title <title>" },
      mcp: { tool: "create_tasks" }
    },
    params: [
      { name: "target", type: "string", required: true, description: "DM or thread target.", cliName: "target", mcpName: "target" },
      { name: "title", type: "string", required: true, description: "Task title. MCP accepts tasks[].title.", cliName: "title", mcpName: "tasks" }
    ],
    examples: ["tyr task create --target \"dm:@agent-name\" --title \"Review deployment logs\""],
    sideEffects: ["Creates task messages"],
    errors: ["INVALID_TITLE", "REQUEST_FAILED"]
  },
  {
    id: "task.claim",
    purpose: "Claim existing tasks by number or message id.",
    description: "Claim tasks only when a Task line or workflow tells this agent to take ownership.",
    lifecycle: "core",
    promptPolicy: "contextual",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "task", command: "claim", usage: "tyr task claim --target <dm-or-thread> --number <n>" },
      mcp: { tool: "claim_tasks" }
    },
    params: [
      { name: "target", type: "string", required: true, description: "DM or thread target.", cliName: "target", mcpName: "target" },
      { name: "taskNumbers", type: "number[]", required: false, description: "Task numbers to claim.", cliName: "number", mcpName: "task_numbers" },
      { name: "messageIds", type: "string[]", required: false, description: "Message ids to claim.", cliName: "message-id", mcpName: "message_ids" }
    ],
    examples: ["tyr task claim --target \"dm:@agent-name\" --number 1"],
    sideEffects: ["Assigns matching tasks to the current agent"],
    errors: ["REQUEST_FAILED"]
  },
  {
    id: "task.claimMessage",
    purpose: "Convert one existing parent message into a task and claim it.",
    description: "Convert one existing parent message into a task and claim it only when the current Message workflow or human explicitly requests task tracking.",
    lifecycle: "core",
    promptPolicy: "contextual",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "task", command: "claim-message", usage: "tyr task claim-message --message-id <msgid>" },
      mcp: { tool: "claim_message_as_task" }
    },
    params: [
      { name: "messageId", type: "string", required: true, description: "Parent message id.", cliName: "message-id", mcpName: "message_id" },
      { name: "title", type: "string", required: false, description: "Optional task title override.", cliName: "title", mcpName: "title" }
    ],
    examples: ["tyr task claim-message --message-id \"msg_12345678\""],
    sideEffects: ["Creates or claims a task for the message"],
    errors: ["INVALID_MESSAGE_ID", "REQUEST_FAILED"]
  },
  {
    id: "task.unclaim",
    purpose: "Release a claimed task.",
    description: "Release a claimed task during recovery or explicit coordination.",
    lifecycle: "advanced",
    promptPolicy: "help-only",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "task", command: "unclaim", usage: "tyr task unclaim --target <dm-or-thread> --number <n>" },
      mcp: { tool: "unclaim_task" }
    },
    params: [
      { name: "target", type: "string", required: true, description: "DM or thread target.", cliName: "target", mcpName: "target" },
      { name: "taskNumber", type: "number", required: true, description: "Task number.", cliName: "number", mcpName: "task_number" }
    ],
    examples: ["tyr task unclaim --target \"dm:@agent-name\" --number 1"],
    sideEffects: ["Releases a task assignment"],
    errors: ["REQUEST_FAILED"]
  },
  {
    id: "task.updateStatus",
    purpose: "Update task progress status.",
    description: "Update a task's progress status, especially moving completed work to in_review.",
    lifecycle: "core",
    promptPolicy: "contextual",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "task", command: "update", usage: "tyr task update --target <dm-or-thread> --number <n> --status <status>" },
      mcp: { tool: "update_task_status" }
    },
    params: [
      { name: "target", type: "string", required: true, description: "DM or thread target.", cliName: "target", mcpName: "target" },
      { name: "taskNumber", type: "number", required: true, description: "Task number.", cliName: "number", mcpName: "task_number" },
      { name: "status", type: "TaskStatus", required: true, description: "Target task status.", cliName: "status", mcpName: "status" }
    ],
    examples: ["tyr task update --target \"dm:@agent-name\" --number 1 --status in_review"],
    sideEffects: ["Updates task status"],
    errors: ["INVALID_TASK_UPDATE", "REQUEST_FAILED"]
  },
  {
    id: "agent.delegate",
    purpose: "Delegate execution to a known same-workspace agent.",
    description: "Delegate work to another same-workspace agent. CLI/native first: use tyr agent delegate because it uses daemon native agent:delegate wake. MCP delegate_agent is fallback only when local daemon control is unavailable.",
    lifecycle: "core",
    promptPolicy: "startup",
    entryPreference: "native-first",
    exposure: {
      cli: { group: "agent", command: "delegate", usage: "tyr agent delegate --target <@agent> --instruction <instruction>" },
      mcp: { tool: "delegate_agent" },
      internal: { protocol: "agent:delegate" }
    },
    params: [
      { name: "targetAgent", type: "string", required: true, description: "Target agent handle.", cliName: "target", mcpName: "target_agent" },
      { name: "instruction", type: "string", required: true, description: "Specific work instruction.", cliName: "instruction", mcpName: "instruction" },
      { name: "attachmentIds", type: "string[]", required: false, description: "Attachment ids to include with the delegated execution.", cliName: "attachment-id", mcpName: "attachment_ids" },
      { name: "returnMode", type: "delegator | origin", required: false, description: "Where result should return.", cliName: "return-mode", mcpName: "return_mode" }
    ],
    examples: [
      "tyr agent delegate --target \"@agent-name\" --instruction \"specific work to do\"",
      "tyr agent delegate --target \"@agent-name\" --instruction \"review the attached screenshot\" --attachment-id att_123"
    ],
    sideEffects: ["Starts or queues a delegated execution"],
    errors: ["INVALID_TARGET", "EMPTY_INSTRUCTION", "LOCAL_DAEMON_UNAVAILABLE", "REQUEST_FAILED"]
  },
  {
    id: "device.requestAction",
    purpose: "Request a selected device method.",
    description: "Request a device method. For selected deviceRefs, use tyr device request-action first with the exact device_id, capability, message_id, and reason; fallback to MCP device_request_action only if CLI is unavailable. Do not call device_list first.",
    lifecycle: "core",
    promptPolicy: "contextual",
    entryPreference: "cli-first",
    exposure: {
      cli: { group: "device", command: "request-action", usage: "tyr device request-action --device-id <id> --capability <capability> --message-id <msgid> --reason <reason>" },
      mcp: { tool: "device_request_action" }
    },
    params: [
      { name: "deviceId", type: "string", required: true, description: "Selected device id.", cliName: "device-id", mcpName: "device_id" },
      { name: "capability", type: "string", required: true, description: "Selected capability id.", cliName: "capability", mcpName: "capability" },
      { name: "reason", type: "string", required: true, description: "Short reason for audit.", cliName: "reason", mcpName: "reason" },
      { name: "messageId", type: "string", required: true, description: "Current message id authorizing this selected action.", cliName: "message-id", mcpName: "message_id" }
    ],
    examples: ["tyr device request-action --device-id \"device_phone\" --capability \"screen.capture_app_snapshot\" --message-id \"msg_12345678\" --reason \"User requested app screenshot\""],
    sideEffects: ["Queues or sends a device command"],
    errors: ["INVALID_DEVICE_ACTION", "INVALID_PARAMS_JSON", "REQUEST_FAILED"]
  },
  {
    id: "device.commandStatus",
    purpose: "Read or wait for a device command result.",
    description: "Read a device command status. Use --wait or wait=true after device.requestAction when the user asks to obtain and interpret the returned device result, such as an app screenshot.",
    lifecycle: "core",
    promptPolicy: "contextual",
    entryPreference: "cli-first",
    exposure: {
      cli: { group: "device", command: "command-status", usage: "tyr device command-status --command-id <id> [--wait] [--timeout <seconds>]" },
      mcp: { tool: "device_command_status" }
    },
    params: [
      { name: "commandId", type: "string", required: true, description: "Device command id returned by device.requestAction.", cliName: "command-id", mcpName: "command_id" },
      { name: "wait", type: "boolean", required: false, description: "Poll until terminal status or timeout.", cliName: "wait", mcpName: "wait" },
      { name: "timeoutSeconds", type: "number", required: false, description: "Maximum wait time in seconds.", cliName: "timeout", mcpName: "timeout_seconds" }
    ],
    examples: ["tyr device command-status --command-id \"device_cmd_123\" --wait --timeout 30"],
    sideEffects: [],
    errors: ["INVALID_DEVICE_COMMAND", "DEVICE_COMMAND_TIMEOUT", "REQUEST_FAILED"]
  },
  {
    id: "device.list",
    purpose: "List accessible devices for background discovery.",
    description: "List mobile or IoT devices for separate background access discovery. Do not use this for selected message deviceRefs.",
    lifecycle: "advanced",
    promptPolicy: "help-only",
    entryPreference: "mcp-only",
    exposure: {
      mcp: { tool: "device_list" }
    },
    params: [],
    examples: [],
    sideEffects: [],
    errors: ["REQUEST_FAILED"]
  },
  {
    id: "attachment.upload",
    purpose: "Upload a local file as an attachment.",
    description: "Upload a local file and return its attachment id. In an active CLI turn, omit --target or use --target current to use that conversation. This does not send a chat message; pass the returned id to message.send attachmentIds or tyr message send --attachment-id.",
    lifecycle: "core",
    promptPolicy: "contextual",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "attachment", command: "upload", usage: "tyr attachment upload --path <file> --target <dm-or-thread>" },
      mcp: { tool: "upload_file" }
    },
    params: [
      { name: "filePath", type: "string", required: true, description: "Local file path.", cliName: "path", mcpName: "file_path" },
      { name: "target", type: "string", required: true, description: "DM or thread target used for attachment ownership. CLI may use current or omit this inside an active turn.", cliName: "target", mcpName: "target" }
    ],
    examples: [
      "tyr attachment upload --path ./report.txt --target \"dm:@agent-name\"",
      "tyr message send --target \"dm:@agent-name\" --content \"Report attached\" --attachment-id att_123"
    ],
    sideEffects: ["Uploads a file"],
    errors: ["INVALID_PATH", "REQUEST_FAILED"]
  },
  {
    id: "attachment.view",
    purpose: "Download an attachment for local inspection.",
    description: "Download an attached file by attachment ID and save it locally.",
    lifecycle: "core",
    promptPolicy: "contextual",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "attachment", command: "view", usage: "tyr attachment view --id <attachment-id> --output <path>" },
      mcp: { tool: "view_file" }
    },
    params: [
      { name: "attachmentId", type: "string", required: true, description: "Attachment id.", cliName: "id", mcpName: "attachment_id" },
      { name: "output", type: "string", required: true, description: "CLI output path.", cliName: "output" }
    ],
    examples: ["tyr attachment view --id \"att_123\" --output ./attachment.bin"],
    sideEffects: ["Writes an attachment file locally"],
    errors: ["INVALID_ATTACHMENT", "DOWNLOAD_FAILED"]
  },
  {
    id: "workspaceFile.list",
    purpose: "List Workspace shared files assigned to the current Agent.",
    description: "List current assigned shared-file metadata without returning file content. Includes exact filename, file id, permission, canonical version, and the fixed shared/ local path. Codex should use the Tyr CLI transport because its app-server MCP transport is degraded.",
    lifecycle: "core",
    promptPolicy: "contextual",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "workspace-file", command: "list", usage: "tyr workspace-file list" },
      mcp: { tool: "list_shared_files" }
    },
    params: [],
    examples: ["tyr workspace-file list", "list_shared_files({})"],
    sideEffects: [],
    errors: ["REQUEST_FAILED"]
  },
  {
    id: "workspaceFile.read",
    purpose: "Read one Workspace shared file assigned to the current Agent.",
    description: "Read an Owner-assigned Workspace shared text file by file id or exact filename. Returns the current canonical version, permission, and UTF-8 content. Codex should use the Tyr CLI transport because its app-server MCP transport is degraded.",
    lifecycle: "core",
    promptPolicy: "contextual",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "workspace-file", command: "read", usage: "tyr workspace-file read --file <file-id-or-name>" },
      mcp: { tool: "read_shared_file" }
    },
    params: [
      { name: "file", type: "string", required: true, description: "Workspace shared file id or exact filename.", mcpName: "file" }
    ],
    examples: ["tyr workspace-file read --file \"database.json\"", "read_shared_file({ file: \"database.json\" })"],
    sideEffects: [],
    errors: ["WORKSPACE_SHARED_FILE_NOT_FOUND", "WORKSPACE_SHARED_FILE_TEXT_REQUIRED", "WORKSPACE_SHARED_FILE_TOO_LARGE"]
  },
  {
    id: "workspaceFile.update",
    purpose: "Replace the content of one read-write Workspace shared file assigned to the current Agent.",
    description: "Replace the UTF-8 content of an existing Owner-assigned read-write Workspace shared file. Pass the version returned by the corresponding read operation; version conflicts fail instead of overwriting another Agent's work. This cannot create, rename, move, or delete files. Codex should use the Tyr CLI transport because its app-server MCP transport is degraded.",
    lifecycle: "core",
    promptPolicy: "contextual",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "workspace-file", command: "update", usage: "tyr workspace-file update --file <file-id-or-name> --expected-version <version> --content <utf8-content>" },
      mcp: { tool: "update_shared_file" }
    },
    params: [
      { name: "file", type: "string", required: true, description: "Workspace shared file id or exact filename.", mcpName: "file" },
      { name: "expectedVersion", type: "number", required: true, description: "Current canonical version returned by read_shared_file.", mcpName: "expected_version" },
      { name: "content", type: "string", required: true, description: "Complete replacement UTF-8 content.", mcpName: "content" }
    ],
    examples: [
      "tyr workspace-file update --file \"database.json\" --expected-version 4 --content '{\"count\":5}'",
      "update_shared_file({ file: \"database.json\", expected_version: 4, content: \"{\\\"count\\\":5}\" })"
    ],
    sideEffects: ["Replaces canonical shared-file content", "Synchronizes the new version to assigned Agents", "Creates an audit event"],
    errors: ["WORKSPACE_SHARED_FILE_NOT_FOUND", "WORKSPACE_SHARED_FILE_READ_ONLY", "WORKSPACE_SHARED_FILE_VERSION_CONFLICT", "WORKSPACE_SHARED_FILE_JSON_INVALID", "TRUSTED_EXECUTION_REQUIRED"]
  },
  {
    id: "server.roster",
    purpose: "List workspace agents and humans for roster discovery.",
    description: "List current workspace agents and humans for roster discovery. Use only when the target agent is unknown.",
    lifecycle: "advanced",
    promptPolicy: "help-only",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "server", command: "info", usage: "tyr server info" },
      mcp: { tool: "list_server" }
    },
    params: [],
    examples: ["tyr server info"],
    sideEffects: [],
    errors: ["REQUEST_FAILED"]
  },
  {
    id: "thread.unfollow",
    purpose: "Stop receiving ordinary delivery for a thread.",
    description: "Stop receiving ordinary delivery for a DM thread target.",
    lifecycle: "advanced",
    promptPolicy: "help-only",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "thread", command: "unfollow", usage: "tyr thread unfollow --target <thread>" },
      mcp: { tool: "unfollow_thread" }
    },
    params: [
      { name: "target", type: "string", required: true, description: "Thread target.", cliName: "target", mcpName: "target" }
    ],
    examples: ["tyr thread unfollow --target \"dm:@agent-name:msg_12345678\""],
    sideEffects: ["Changes thread delivery preference"],
    errors: ["INVALID_THREAD", "REQUEST_FAILED"]
  },
  {
    id: "profile.show",
    purpose: "Show an agent or human profile.",
    description: "Show an agent or human profile. Pass a target like @name or omit for own profile.",
    lifecycle: "advanced",
    promptPolicy: "help-only",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "profile", command: "show", usage: "tyr profile show [@name]" },
      mcp: { tool: "show_profile" }
    },
    params: [
      { name: "target", type: "string", required: false, description: "Profile target.", mcpName: "target" }
    ],
    examples: ["tyr profile show @agent-name"],
    sideEffects: [],
    errors: ["REQUEST_FAILED"]
  },
  {
    id: "profile.update",
    purpose: "Update own agent profile.",
    description: "Update own agent profile. Use only when explicitly asked.",
    lifecycle: "advanced",
    promptPolicy: "help-only",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "profile", command: "update", usage: "tyr profile update --display-name <name>" },
      mcp: { tool: "update_profile" }
    },
    params: [
      { name: "displayName", type: "string", required: false, description: "Display name.", cliName: "display-name", mcpName: "display_name" },
      { name: "description", type: "string", required: false, description: "Profile description.", cliName: "description", mcpName: "description" },
      { name: "permissionMode", type: "RuntimePermissionMode", required: false, description: "Permission mode.", cliName: "permission-mode", mcpName: "permission_mode" }
    ],
    examples: ["tyr profile update --display-name \"Build Agent\""],
    sideEffects: ["Updates own profile"],
    errors: ["REQUEST_FAILED"]
  },
  {
    id: "reminder.schedule",
    purpose: "Schedule a reminder.",
    description: "Schedule a reminder when explicitly requested by the human.",
    lifecycle: "advanced",
    promptPolicy: "help-only",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "reminder", command: "schedule", usage: "tyr reminder schedule --title <title> [--in 10m]" },
      mcp: { tool: "schedule_reminder" }
    },
    params: [
      { name: "title", type: "string", required: true, description: "Reminder title.", cliName: "title", mcpName: "title" },
      { name: "delaySeconds", type: "number", required: false, description: "Delay in seconds.", mcpName: "delay_seconds" },
      { name: "fireAt", type: "string", required: false, description: "Fire timestamp.", cliName: "fire-at", mcpName: "fire_at" },
      { name: "msgId", type: "string", required: false, description: "Related message id.", cliName: "msg-id", mcpName: "msg_id" }
    ],
    examples: ["tyr reminder schedule --title \"Check deployment\" --in 10m"],
    sideEffects: ["Creates a reminder"],
    errors: ["INVALID_TITLE", "REQUEST_FAILED"]
  },
  {
    id: "reminder.list",
    purpose: "List own reminders.",
    description: "List own reminders for reminder management.",
    lifecycle: "advanced",
    promptPolicy: "help-only",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "reminder", command: "list", usage: "tyr reminder list" },
      mcp: { tool: "list_reminders" }
    },
    params: [
      { name: "status", type: "string", required: false, description: "Reminder status filter.", cliName: "status", mcpName: "status" }
    ],
    examples: ["tyr reminder list"],
    sideEffects: [],
    errors: ["REQUEST_FAILED"]
  },
  {
    id: "reminder.cancel",
    purpose: "Cancel a scheduled reminder.",
    description: "Cancel a scheduled reminder by id.",
    lifecycle: "advanced",
    promptPolicy: "help-only",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "reminder", command: "cancel", usage: "tyr reminder cancel --id <id>" },
      mcp: { tool: "cancel_reminder" }
    },
    params: [
      { name: "reminderId", type: "string", required: true, description: "Reminder id.", cliName: "id", mcpName: "reminder_id" }
    ],
    examples: ["tyr reminder cancel --id \"rem_123\""],
    sideEffects: ["Cancels a reminder"],
    errors: ["INVALID_ID", "REQUEST_FAILED"]
  },
  {
    id: "reminder.snooze",
    purpose: "Snooze a scheduled or fired reminder.",
    description: "Snooze a scheduled or fired reminder.",
    lifecycle: "advanced",
    promptPolicy: "help-only",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "reminder", command: "snooze", usage: "tyr reminder snooze --id <id> --by <duration>" },
      mcp: { tool: "snooze_reminder" }
    },
    params: [
      { name: "reminderId", type: "string", required: true, description: "Reminder id.", cliName: "id", mcpName: "reminder_id" },
      { name: "delaySeconds", type: "number", required: true, description: "Snooze delay.", mcpName: "delay_seconds" }
    ],
    examples: ["tyr reminder snooze --id \"rem_123\" --by 10m"],
    sideEffects: ["Updates reminder fire time"],
    errors: ["INVALID_REMINDER_SNOOZE", "REQUEST_FAILED"]
  },
  {
    id: "reminder.update",
    purpose: "Update one field on a reminder.",
    description: "Update one field on a reminder: title, fire_at, delay_seconds, or repeat.",
    lifecycle: "advanced",
    promptPolicy: "help-only",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "reminder", command: "update", usage: "tyr reminder update --id <id> --title <title>" },
      mcp: { tool: "update_reminder" }
    },
    params: [
      { name: "reminderId", type: "string", required: true, description: "Reminder id.", cliName: "id", mcpName: "reminder_id" },
      { name: "title", type: "string", required: false, description: "Reminder title.", cliName: "title", mcpName: "title" },
      { name: "fireAt", type: "string", required: false, description: "Fire timestamp.", cliName: "fire-at", mcpName: "fire_at" },
      { name: "delaySeconds", type: "number", required: false, description: "Delay in seconds.", mcpName: "delay_seconds" },
      { name: "repeat", type: "string | null", required: false, description: "Repeat rule.", cliName: "repeat", mcpName: "repeat" }
    ],
    examples: ["tyr reminder update --id \"rem_123\" --title \"New title\""],
    sideEffects: ["Updates reminder"],
    errors: ["INVALID_REMINDER_UPDATE", "REQUEST_FAILED"]
  },
  {
    id: "reminder.log",
    purpose: "Show lifecycle events for one reminder.",
    description: "Show lifecycle events for one reminder.",
    lifecycle: "advanced",
    promptPolicy: "help-only",
    entryPreference: "mcp-first",
    exposure: {
      cli: { group: "reminder", command: "log", usage: "tyr reminder log --id <id>" },
      mcp: { tool: "reminder_log" }
    },
    params: [
      { name: "reminderId", type: "string", required: true, description: "Reminder id.", cliName: "id", mcpName: "reminder_id" }
    ],
    examples: ["tyr reminder log --id \"rem_123\""],
    sideEffects: [],
    errors: ["INVALID_ID", "REQUEST_FAILED"]
  },
  {
    id: "auth.whoami",
    purpose: "Show current CLI agent context for debug.",
    description: "Show current CLI agent context for debug. This is not a normal Agent workflow tool.",
    lifecycle: "debug",
    promptPolicy: "hidden",
    entryPreference: "cli-only",
    exposure: {
      cli: { group: "auth", command: "whoami", usage: "tyr auth whoami" }
    },
    params: [],
    examples: ["tyr auth whoami"],
    sideEffects: [],
    errors: ["MISSING_CONTEXT"]
  },
  {
    id: "runtime.profileMigrationDone",
    purpose: "Report runtime profile migration completion.",
    description: "Runtime-actions compatibility stub used by app-server integrations.",
    lifecycle: "internal",
    promptPolicy: "hidden",
    entryPreference: "internal-only",
    exposure: {
      mcp: { tool: "runtime_profile_migration_done" },
      internal: { protocol: "runtime_profile_migration_done" }
    },
    params: [
      { name: "migrationKey", type: "string", required: false, description: "Migration key.", mcpName: "migration_key" }
    ],
    examples: [],
    sideEffects: ["Reports a runtime migration marker"],
    errors: []
  }
] as const satisfies readonly AgentToolOperationDefinition[];

export type AgentToolOperationId = (typeof AGENT_TOOL_OPERATION_DEFINITIONS)[number]["id"];

const DEPRECATED_AGENT_TOOL_SURFACE_POLICIES: Record<string, AgentToolSurfacePolicy> = {
  "message.check": {
    visibility: "help-only",
    stability: "deprecated",
    reason: "Wake delivery, message.read, and message.search cover normal context recovery; message.check remains only for compatibility and debug recovery.",
    replacementOperationIds: ["message.read", "message.search"],
    removal: "none"
  },
  "device.list": {
    visibility: "help-only",
    stability: "deprecated",
    reason: "Selected deviceRefs already provide the device id and capability; device.list is retained only for background discovery and diagnostics.",
    replacementOperationIds: ["device.requestAction"],
    removal: "none"
  },
  ...Object.fromEntries([
    "task.list",
    "task.create",
    "task.claim",
    "task.claimMessage",
    "task.unclaim",
    "task.updateStatus"
  ].map((operationId) => [operationId, {
    visibility: "hidden" as const,
    stability: "deprecated" as const,
    reason: "Task workflows have exited the product surface. Historical rows remain storage-only and ordinary work is tracked through conversation threads and Runtime Execution state.",
    replacementOperationIds: ["message.read", "message.search"],
    removal: "future-major" as const
  }]))
};

function stableSurfaceReason(operation: AgentToolOperationDefinition): string {
  if (operation.promptPolicy === "startup") return "Stable startup operation; allowed in generated startup cheat sheets.";
  if (operation.promptPolicy === "contextual") return "Stable contextual operation; shown only when the current wake supplies matching context.";
  return "Stable advanced operation; available through help or explicit user intent, but excluded from startup prompts.";
}

function surfacePolicyForOperation(operation: AgentToolOperationDefinition): AgentToolSurfacePolicy {
  const deprecated = DEPRECATED_AGENT_TOOL_SURFACE_POLICIES[operation.id];
  if (deprecated) return deprecated;
  if (operation.lifecycle === "internal") {
    return {
      visibility: "hidden",
      stability: "internal",
      reason: "Internal runtime compatibility hook; never shown in Agent-facing startup or help surfaces.",
      removal: "none"
    };
  }
  if (operation.lifecycle === "debug") {
    return {
      visibility: "hidden",
      stability: "debug",
      reason: "Debug-only CLI surface for humans and diagnostics; hidden from normal Agent prompts.",
      removal: "none"
    };
  }
  return {
    visibility: operation.promptPolicy,
    stability: "stable",
    reason: stableSurfaceReason(operation),
    removal: "none"
  };
}

export const AGENT_TOOL_OPERATIONS: readonly AgentToolOperation[] = AGENT_TOOL_OPERATION_DEFINITIONS.map((operation) => ({
  ...operation,
  surfacePolicy: surfacePolicyForOperation(operation)
}));

export function isAgentToolOperationHidden(operation: AgentToolOperation): boolean {
  return operation.surfacePolicy.visibility === "hidden" || operation.promptPolicy === "hidden" || operation.lifecycle === "internal";
}

export function isAgentToolOperationDeprecated(operation: AgentToolOperation): boolean {
  return operation.surfacePolicy.stability === "deprecated";
}

export function replacementAgentToolOperationIds(operation: AgentToolOperation): string[] {
  return [...(operation.surfacePolicy.replacementOperationIds ?? [])];
}

export const CORE_AGENT_TOOL_OPERATION_IDS = AGENT_TOOL_OPERATIONS
  // Retired operations may keep their historical lifecycle in the registry, but no longer belong to the active core set.
  .filter((operation) => operation.lifecycle === "core" && !isAgentToolOperationHidden(operation))
  .map((operation) => operation.id) as AgentToolOperationId[];

export const STARTUP_AGENT_TOOL_OPERATION_IDS = AGENT_TOOL_OPERATIONS
  .filter((operation) => operation.promptPolicy === "startup" && !isAgentToolOperationHidden(operation))
  .map((operation) => operation.id) as AgentToolOperationId[];

export const CONTEXTUAL_AGENT_TOOL_OPERATION_IDS = AGENT_TOOL_OPERATIONS
  .filter((operation) => operation.promptPolicy === "contextual" && !isAgentToolOperationHidden(operation))
  .map((operation) => operation.id) as AgentToolOperationId[];

export function findAgentToolOperationById(id: string): AgentToolOperation | undefined {
  return AGENT_TOOL_OPERATIONS.find((operation) => operation.id === id);
}

export function findAgentToolOperationByCliCommand(group: string, command: string): AgentToolOperation | undefined {
  return AGENT_TOOL_OPERATIONS.find((operation) => operation.exposure.cli?.group === group && operation.exposure.cli.command === command);
}

export function findAgentToolOperationByMcpTool(tool: string): AgentToolOperation | undefined {
  return AGENT_TOOL_OPERATIONS.find((operation) => operation.exposure.mcp?.tool === tool);
}

export const AGENT_TOOL_BEHAVIOR_CASES = [
  {
    id: "ordinary-chat:final-response-no-tool",
    scenario: "Ordinary human chat reply with no explicit tool request.",
    expectedAgentAction: "Answer in the final response; daemon publishes it back to chat.",
    disallowedAgentAction: "Do not call message.send, check_messages, or list_server first, and do not create task records.",
    promptPolicy: "startup",
    runtimeIds: ALL_AGENT_TOOL_RUNTIME_IDS
  },
  {
    id: "message.send:contextual-extra-visible-message-only",
    operationId: "message.send",
    scenario: "Agent needs an extra progress, clarification, FYI, coordination, DM, or thread message.",
    expectedAgentAction: "Use message.send only for the extra visible message.",
    disallowedAgentAction: "Do not replace an ordinary final reply with message.send.",
    promptPolicy: "contextual",
    runtimeIds: ALL_AGENT_TOOL_RUNTIME_IDS
  },
  {
    id: "agent.delegate:known-target-no-roster-lookup",
    operationId: "agent.delegate",
    scenario: "User names a known same-workspace target agent such as @agent2.",
    expectedAgentAction: "Delegate directly with daemon-native/CLI first, MCP delegate_agent fallback only.",
    disallowedAgentAction: "Do not call list_server or send a visible @mention message before delegation.",
    promptPolicy: "startup",
    runtimeIds: ALL_AGENT_TOOL_RUNTIME_IDS
  },
  {
    id: "agent.delegate:wait-return-wake-after-dispatch",
    operationId: "agent.delegate",
    scenario: "Delegation request returns an execution id.",
    expectedAgentAction: "Finish the current turn and wait for the automatic return wake.",
    disallowedAgentAction: "Do not poll check_messages or MCP chat for the delegated result.",
    promptPolicy: "startup",
    runtimeIds: ALL_AGENT_TOOL_RUNTIME_IDS
  },
  {
    id: "device.requestAction:selected-device-no-list",
    operationId: "device.requestAction",
    scenario: "Delivered message contains selected deviceRefs with exact device id, capability, message id, and reason.",
    expectedAgentAction: "Call device.requestAction directly with the selected values.",
    disallowedAgentAction: "Do not call device.list first.",
    promptPolicy: "contextual",
    runtimeIds: ALL_AGENT_TOOL_RUNTIME_IDS
  }
] as const satisfies readonly AgentToolBehaviorCase[];

export function findAgentToolBehaviorCaseById(id: string): AgentToolBehaviorCase | undefined {
  return AGENT_TOOL_BEHAVIOR_CASES.find((behavior) => behavior.id === id);
}

function defaultTransportPolicyForOperation(operation: AgentToolOperation, runtimeId: string): AgentToolRuntimeTransportPolicy {
  const hasMcp = Boolean(operation.exposure.mcp);
  const hasCli = Boolean(operation.exposure.cli);
  const hasInternal = Boolean(operation.exposure.internal);
  const mcpFallback = hasMcp ? ["mcp" as const] : [];
  const cliFallback = hasCli ? ["cli" as const] : [];
  switch (operation.entryPreference) {
    case "native-first":
      return {
        operationId: operation.id,
        runtimeId,
        preferred: hasInternal ? "daemon-native" : hasCli ? "cli" : hasMcp ? "mcp" : "internal",
        fallbacks: [...cliFallback, ...mcpFallback],
        degradedTransports: []
      };
    case "cli-first":
      return {
        operationId: operation.id,
        runtimeId,
        preferred: hasCli ? "cli" : hasMcp ? "mcp" : "internal",
        fallbacks: mcpFallback,
        degradedTransports: []
      };
    case "cli-only":
      return { operationId: operation.id, runtimeId, preferred: "cli", fallbacks: [], degradedTransports: [] };
    case "mcp-only":
      return { operationId: operation.id, runtimeId, preferred: "mcp", fallbacks: [], degradedTransports: [] };
    case "internal-only":
      return { operationId: operation.id, runtimeId, preferred: hasInternal ? "internal" : "mcp", fallbacks: [], degradedTransports: [] };
    case "mcp-first":
    default:
      return {
        operationId: operation.id,
        runtimeId,
        preferred: hasMcp ? "mcp" : hasCli ? "cli" : "internal",
        fallbacks: cliFallback,
        degradedTransports: []
      };
  }
}

function codexTransportPolicyForOperation(operation: AgentToolOperation, runtimeId: string): AgentToolRuntimeTransportPolicy | undefined {
  if (runtimeId !== "codex") return undefined;

  const hasMcp = Boolean(operation.exposure.mcp);
  const hasCli = Boolean(operation.exposure.cli);
  const hasInternal = Boolean(operation.exposure.internal);
  if (!hasMcp || operation.entryPreference === "mcp-only" || operation.entryPreference === "internal-only") return undefined;

  const degradedMcp = [{
    transport: "mcp" as const,
    reason: CODEX_MCP_CHAT_TRANSPORT_DEGRADED_REASON
  }];

  // Codex app-server can start chat MCP calls without starting chat-bridge, so CLI/native is the stable transport when one exists.
  if (operation.entryPreference === "native-first" && (hasInternal || hasCli)) {
    const preferred = hasInternal ? "daemon-native" as const : "cli" as const;
    return {
      operationId: operation.id,
      runtimeId,
      preferred,
      fallbacks: preferred === "daemon-native" && hasCli ? ["cli"] : [],
      degradedTransports: degradedMcp
    };
  }

  if (hasCli) {
    return {
      operationId: operation.id,
      runtimeId,
      preferred: "cli",
      fallbacks: [],
      degradedTransports: degradedMcp
    };
  }

  return undefined;
}

export function resolveAgentToolTransportPolicy(operationId: string, runtimeId = "default"): AgentToolRuntimeTransportPolicy {
  const operation = findAgentToolOperationById(operationId);
  if (!operation) {
    return {
      operationId,
      runtimeId,
      preferred: "internal",
      fallbacks: [],
      degradedTransports: []
    };
  }
  const explicitOverride = operation.transportPolicy?.find((item) => item.runtimeId === runtimeId);
  if (explicitOverride) {
    return {
      operationId: operation.id,
      runtimeId,
      preferred: explicitOverride.preferred,
      fallbacks: explicitOverride.fallbacks ?? [],
      degradedTransports: explicitOverride.degradedTransports ?? []
    };
  }
  const runtimePolicy = codexTransportPolicyForOperation(operation, runtimeId);
  if (runtimePolicy) return runtimePolicy;

  return defaultTransportPolicyForOperation(operation, runtimeId);
}

export function buildAgentToolOperationObservability(input: BuildAgentToolOperationObservabilityInput): AgentToolOperationObservability {
  const policy = resolveAgentToolTransportPolicy(input.operationId, input.runtimeId);
  const degradedReason = policy.degradedTransports.find((item) => item.transport === input.actualTransport)?.reason;
  const actualTransport = input.actualTransport === "not-run" ? undefined : input.actualTransport;
  const isFallback = actualTransport !== undefined && policy.preferred !== actualTransport && policy.fallbacks.includes(actualTransport);
  const policyReason = input.policyReason
    ?? degradedReason
    ?? (policy.preferred !== input.actualTransport ? `preferred_transport:${policy.preferred}` : undefined);
  return {
    operationId: input.operationId,
    runtimeId: input.runtimeId,
    selectedTransport: input.actualTransport,
    actualTransport: input.actualTransport,
    preferredTransport: policy.preferred,
    fallbackTransports: [...policy.fallbacks],
    degradedTransports: [...policy.degradedTransports],
    ...(policyReason ? { policyReason } : {}),
    ...(degradedReason ? { degradedReason } : {}),
    ...(isFallback && actualTransport ? { fallbackFrom: policy.preferred, fallbackTo: actualTransport } : {}),
    ...(input.failureClassification ? { failureClassification: input.failureClassification } : {}),
    ...(input.helpRequested ? { helpRequested: true } : {})
  };
}

export function agentToolCliGroups(): string[] {
  return [...new Set(AGENT_TOOL_OPERATIONS.flatMap((operation) => operation.exposure.cli && !isAgentToolOperationHidden(operation) ? [operation.exposure.cli.group] : []))];
}

export function agentToolCliOperationsForGroup(group: string): AgentToolOperation[] {
  return AGENT_TOOL_OPERATIONS.filter((operation) => operation.exposure.cli?.group === group && !isAgentToolOperationHidden(operation));
}

const AGENT_TOOL_CLI_GROUP_DESCRIPTIONS: Record<string, string> = {
  message: "Send, read, and search chat messages.",
  task: "Inspect, claim, create, and update task board items.",
  agent: "Delegate execution to another same-workspace agent.",
  device: "Request selected device methods and read command results.",
  attachment: "Upload local files and download visible attachments.",
  server: "Inspect visible agents and humans.",
  thread: "Manage thread delivery attention.",
  profile: "Show or update agent and human profiles.",
  reminder: "Schedule and manage reminders."
};

export function agentToolCliGroupDescription(group: string): string {
  return AGENT_TOOL_CLI_GROUP_DESCRIPTIONS[group] ?? "Agent tool commands.";
}

export function agentToolCliSuggestionForGroup(group: string): string | undefined {
  const operations = agentToolCliOperationsForGroup(group);
  return operations.find((operation) => operation.examples.length > 0)?.examples[0]
    ?? operations[0]?.exposure.cli?.usage;
}

function cliFlag(param: AgentToolParam): string {
  return param.cliName ? param.cliName.split("/").map((name) => `--${name}`).join("/") : param.name;
}

export function formatAgentToolCommandHelp(operation: AgentToolOperation): string {
  const lines = [
    `Usage: ${operation.exposure.cli?.usage ?? operation.id}`,
    "",
    operation.purpose,
    "",
    "Params:"
  ];
  const cliParams = operation.params.filter((param) => param.cliName);
  if (cliParams.length) {
    lines.push(...cliParams.map((param) => {
      const requirement = param.required ? "required" : "optional";
      return `- ${cliFlag(param)} (${requirement}): ${param.description}`;
    }));
  } else {
    lines.push("- none");
  }
  if (operation.examples.length) {
    lines.push("", "Examples:", ...operation.examples.map((example) => `- ${example}`));
  }
  return `${lines.join("\n")}\n`;
}

export function formatAgentToolGroupHelp(group: string): string {
  const operations = agentToolCliOperationsForGroup(group);
  if (!operations.length) return `Unknown command group: ${group}\n`;
  const examples = operations.flatMap((operation) => operation.examples.slice(0, 1));
  const lines = [
    `Usage: tyr ${group} <command>`,
    "",
    agentToolCliGroupDescription(group),
    "",
    "Commands:",
    ...operations.map((operation) => `- ${operation.exposure.cli!.command}: ${operation.purpose}`),
    ""
  ];
  if (examples.length) {
    lines.push("Examples:", ...examples.map((example) => `- ${example}`), "");
  }
  lines.push(`Use "tyr ${group} <command> --help" or "tyr help ${group} <command>" for command examples.`);
  return lines.join("\n") + "\n";
}

export function formatAgentToolRootHelp(): string {
  const groups = agentToolCliGroups();
  const rootExampleIds: AgentToolOperationId[] = ["message.send", "agent.delegate", "device.requestAction", "attachment.upload"];
  const exampleOperations = rootExampleIds
    .map((id) => findAgentToolOperationById(id))
    .filter((operation): operation is AgentToolOperation => Boolean(operation?.examples.length && operation.exposure.cli));
  return [
    "Usage: tyr <command>",
    "",
    "Command groups:",
    ...groups.map((group) => `- ${group}: ${agentToolCliGroupDescription(group)}`),
    "",
    "Core examples:",
    ...exampleOperations.flatMap((operation) => operation.examples.slice(0, 1).map((example) => `- ${example}`)),
    "",
    "Agent workflow notes:",
    "- Ordinary chat replies use final response; use message.send only for extra visible messages.",
    "",
    'Use "tyr help <group>", "tyr <group> --help", or "tyr <group> <command> --help" for details.'
  ].join("\n") + "\n";
}

function transportLabel(operation: AgentToolOperation, transport: AgentToolTransport, status?: AgentToolTransportStatus): string {
  const suffix = status === "fallback" ? " fallback" : status === "degraded" ? " degraded" : "";
  if (transport === "mcp") return operation.exposure.mcp?.tool ? `MCP ${operation.exposure.mcp.tool}${suffix}` : "";
  if (transport === "cli") return operation.exposure.cli?.usage ? `CLI ${operation.exposure.cli.usage}${suffix}` : "";
  if (transport === "daemon-native") return operation.exposure.internal?.protocol ? `Native daemon ${operation.exposure.internal.protocol}${suffix}` : "";
  if (transport === "internal") return operation.exposure.internal?.protocol ? `Internal ${operation.exposure.internal.protocol}${suffix}` : "";
  return `Final response${suffix}`;
}

function buildStartupAgentToolCheatSheet(runtimeId = "default"): string {
  const startupOperations = STARTUP_AGENT_TOOL_OPERATION_IDS
    .map((id) => findAgentToolOperationById(id))
    .filter((operation): operation is AgentToolOperation => Boolean(operation));
  return [
    "Startup tool cheat sheet:",
    ...startupOperations.map((operation) => {
      const policy = resolveAgentToolTransportPolicy(operation.id, runtimeId);
      const entries = [
        transportLabel(operation, policy.preferred, "preferred"),
        ...policy.fallbacks.map((transport) => transportLabel(operation, transport, "fallback")),
        ...policy.degradedTransports.map((item) => transportLabel(operation, item.transport, "degraded"))
      ];
      return `- ${operation.id}: ${entries.filter(Boolean).join("; ")}. ${operation.purpose}`;
    })
  ].join("\n");
}

export function formatStartupAgentToolCheatSheet(runtimeId = "default"): string {
  return buildStartupAgentToolCheatSheet(runtimeId);
}

export function agentToolMcpDescription(tool: string, fallback: string): string {
  return findAgentToolOperationByMcpTool(tool)?.description ?? fallback;
}

export function generateAgentToolCliArtifacts(): GeneratedAgentToolCliArtifacts {
  return {
    rootHelp: formatAgentToolRootHelp(),
    groupHelp: Object.fromEntries(agentToolCliGroups().map((group) => [group, formatAgentToolGroupHelp(group)])),
    commandHelp: Object.fromEntries(AGENT_TOOL_OPERATIONS
      .filter((operation) => operation.exposure.cli && !isAgentToolOperationHidden(operation))
      .map((operation) => [operation.id, formatAgentToolCommandHelp(operation)]))
  };
}

export function generateAgentToolPromptArtifacts(runtimeId = "default"): GeneratedAgentToolPromptArtifacts {
  return {
    startupCheatSheet: buildStartupAgentToolCheatSheet(runtimeId)
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function generatedMcpParamZodBasePattern(operation: AgentToolOperation, param: AgentToolParam): string {
  if (operation.id === "task.create" && param.mcpName === "tasks") return "z\\.array\\(z\\.object\\(\\{\\s*title:\\s*z\\.string\\(\\)\\s*\\}\\)\\)";
  if (param.type === "string") return "z\\.string\\(\\)";
  if (param.type === "number") return "z\\.number\\(\\)";
  if (param.type === "boolean") return "z\\.boolean\\(\\)";
  if (param.type === "string[]") return "z\\.array\\(z\\.string\\(\\)\\)";
  if (param.type === "number[]") return "z\\.array\\(z\\.number\\(\\)\\)";
  if (param.type === "string | number") return "z\\.union\\(\\[z\\.string\\(\\),\\s*z\\.number\\(\\)\\]\\)";
  if (param.type === "string | null") return "z\\.string\\(\\)\\.nullable\\(\\)";
  if (param.type.includes("|") || param.type === "TaskStatus" || param.type === "RuntimePermissionMode") return "z\\.enum\\(";
  return "z\\.";
}

function generatedMcpParamZodSchemaPattern(operation: AgentToolOperation, param: AgentToolParam): string {
  const field = escapeRegExp(param.mcpName ?? param.name);
  return `${field}:\\s*${generatedMcpParamZodBasePattern(operation, param)}`;
}

export function generateAgentToolMcpArtifacts(): GeneratedAgentToolMcpArtifacts {
  return {
    tools: AGENT_TOOL_OPERATIONS
      .filter((operation) => operation.exposure.mcp && !isAgentToolOperationHidden(operation))
      .map((operation) => ({
        operationId: operation.id,
        tool: operation.exposure.mcp!.tool,
        description: operation.description,
        params: operation.params
          .filter((param) => param.mcpName)
          .map((param) => ({
            name: param.mcpName!,
            operationParamName: param.name,
            type: param.type,
            required: param.required,
            description: param.description,
            zodSchemaPattern: generatedMcpParamZodSchemaPattern(operation, param)
          }))
      }))
  };
}

export function generateAgentToolConformanceArtifacts(runtimeId = "default"): GeneratedAgentToolConformanceArtifacts {
  const cases = new Set<string>();
  for (const operation of AGENT_TOOL_OPERATIONS) {
    if (operation.lifecycle === "core" && operation.exposure.cli && operation.exposure.mcp && !isAgentToolOperationHidden(operation)) {
      cases.add(`${operation.id}:cli-mcp-parity`);
    }
  }
  // Behavior cases capture agent decision boundaries that are too important to live only in prompt text.
  for (const behavior of AGENT_TOOL_BEHAVIOR_CASES) {
    const runtimeIds: readonly string[] = behavior.runtimeIds;
    if (runtimeIds.includes(runtimeId)) cases.add(behavior.id);
  }
  cases.add("agent.delegate:runtime-policy");
  cases.add("message.send:not-agent-delegate");
  return { behaviorCases: [...cases].sort() };
}

export function generateAgentToolArtifacts(runtimeId = "default"): GeneratedAgentToolArtifacts {
  return {
    runtimeId,
    cli: generateAgentToolCliArtifacts(),
    prompt: generateAgentToolPromptArtifacts(runtimeId),
    mcp: generateAgentToolMcpArtifacts(),
    conformance: generateAgentToolConformanceArtifacts(runtimeId)
  };
}
