import type { OperationParamDefinition } from "./operation-registry.js";

export type TyrAssistantOperationDisposition =
  | "allowed"
  | "candidate"
  | "forbidden"
  | "internal"
  | "out_of_scope";

export type TyrAssistantOperationRisk =
  | "read_only"
  | "low"
  | "medium"
  | "high"
  | "critical";

export type TyrAssistantOperationTarget =
  | "message"
  | "workspace_inventory"
  | "computer"
  | "agent"
  | "computer_agents"
  | "workspace_heartbeat"
  | "workspace_bridge"
  | "workspace_bridge_request";

export type TyrAssistantConfirmationPolicy = "none" | "always" | "conditional";

export type TyrAssistantResultSensitivity =
  | "public"
  | "ephemeral_onboarding_link"
  | "credential"
  | "internal";

export interface TyrAssistantResultPolicy {
  sensitivity: TyrAssistantResultSensitivity;
  mayReturnToConversation: boolean;
  mayPersistInAudit: boolean;
}

export interface TyrAssistantRouteSource {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  requestFields?: readonly string[];
}

export interface TyrAssistantHelpEntry {
  key: string;
  order: number;
  text: string;
  example: string;
  relatedOperationIds?: readonly string[];
}

export interface TyrAssistantOperation {
  id: string;
  domain: "computer" | "agent" | "computer_agent" | "heartbeat" | "workspace_bridge" | "communication";
  purpose: string;
  disposition: TyrAssistantOperationDisposition;
  rationale: string;
  risk: TyrAssistantOperationRisk;
  target: TyrAssistantOperationTarget;
  params: readonly OperationParamDefinition[];
  sources: {
    routes: readonly TyrAssistantRouteSource[];
    modules: readonly string[];
  };
  exposure: {
    deterministic: boolean;
    llm: boolean;
    help: boolean;
  };
  confirmation: TyrAssistantConfirmationPolicy;
  authorization: {
    policy: string;
    roles: readonly ("owner" | "member" | "guest")[];
  };
  implementationRef: readonly string[];
  managementAction?: string;
  queryFields?: readonly string[];
  resultStatuses: readonly string[];
  resultPolicy: TyrAssistantResultPolicy;
  sideEffects: readonly string[];
  audit: {
    eventKinds: readonly string[];
    forbiddenMetadata: readonly string[];
  };
  help?: readonly TyrAssistantHelpEntry[];
}

export interface TyrAssistantSurfaceExclusion {
  id: string;
  disposition: "out_of_scope";
  rationale: string;
  routes: readonly TyrAssistantRouteSource[];
}

const NO_EXPOSURE = {
  deterministic: false,
  llm: false,
  help: false
} as const;

const PUBLIC_RESULT = {
  sensitivity: "public",
  mayReturnToConversation: true,
  mayPersistInAudit: true
} as const;

const CREDENTIAL_RESULT = {
  sensitivity: "credential",
  mayReturnToConversation: false,
  mayPersistInAudit: false
} as const;

const INTERNAL_RESULT = {
  sensitivity: "internal",
  mayReturnToConversation: false,
  mayPersistInAudit: false
} as const;

const READ_ROLES = ["owner", "member", "guest"] as const;
const MANAGE_ROLES = ["owner", "member"] as const;
const OWNER_ROLES = ["owner"] as const;
const QUERY_STATUSES = ["completed", "denied", "failed"] as const;
const MANAGEMENT_STATUSES = ["completed", "noop", "partial", "denied", "failed"] as const;
const BATCH_STATUSES = ["completed", "noop", "partial", "denied", "failed", "skipped"] as const;
const NO_AUDIT = {
  eventKinds: [] as const,
  forbiddenMetadata: [] as const
};

const AGENT_REFERENCE_PARAM = {
  name: "agentReference",
  type: "string",
  required: true,
  description: "Exact Agent handle, display name, or stable ID."
} as const;

const COMPUTER_REFERENCE_PARAM = {
  name: "computerReference",
  type: "string",
  required: true,
  description: "Exact Device name or stable ID."
} as const;

const HEARTBEAT_ID_PARAM = {
  name: "heartbeatId",
  type: "string",
  required: true,
  description: "Exact Heartbeat ID returned by the Heartbeat list operation."
} as const;

export const TYR_ASSISTANT_AGENT_DETAILS_FIELDS = [
  "summary",
  "name",
  "description",
  "permissionMode",
  "model",
  "runtime",
  "status",
  "computer",
  "id"
] as const;

export type TyrAssistantAgentDetailsField =
  (typeof TYR_ASSISTANT_AGENT_DETAILS_FIELDS)[number];

export const TYR_ASSISTANT_OPERATIONS = [
  {
    id: "communication.message.react", domain: "communication", purpose: "React to the current authenticated Telegram message as TYR.",
    disposition: "allowed", rationale: "The destination is bound to a persisted Human message and active Telegram account.",
    risk: "low", target: "message", params: [{ name: "emoji", type: "string", required: true, description: "Supported reaction, or empty to remove." }],
    sources: { routes: [], modules: ["apps/server/src/telegram-reactions.ts"] },
    exposure: { deterministic: false, llm: true, help: false }, confirmation: "none",
    authorization: { policy: "authenticated_telegram_message", roles: MANAGE_ROLES },
    implementationRef: ["executeTyrAssistantTool.react_to_message"], resultStatuses: ["completed", "denied", "failed"],
    resultPolicy: PUBLIC_RESULT, sideEffects: ["Sets or removes TYR's native reaction on the current Telegram message."],
    audit: { eventKinds: ["tyr_message_reaction_set"], forbiddenMetadata: ["credential"] }
  },
  {
    id: "computerAgent.status",
    domain: "computer_agent",
    purpose: "Summarize current Workspace, Device, and Agent status.",
    disposition: "allowed",
    rationale: "Status is a read-only server-truth query already supported by TYR.",
    risk: "read_only",
    target: "workspace_inventory",
    params: [],
    sources: {
      routes: [
        { method: "GET", path: "/api/servers/:serverId/machines" },
        { method: "GET", path: "/api/agents" }
      ],
      modules: ["apps/server/src/communication-agent.ts"]
    },
    exposure: { deterministic: true, llm: false, help: true },
    confirmation: "none",
    authorization: { policy: "workspace_visible_inventory", roles: READ_ROLES },
    implementationRef: ["communicationAgentWorkspaceStatusText"],
    resultStatuses: QUERY_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: [],
    audit: NO_AUDIT,
    help: [{
      key: "workspace-status",
      order: 180,
      text: "Show workspace status",
      example: "status"
    }]
  },
  {
    id: "computerAgent.inventory",
    domain: "computer_agent",
    purpose: "List the combined Device-to-Agent inventory topology.",
    disposition: "allowed",
    rationale: "The combined inventory is a deterministic read-only command that includes empty Devices.",
    risk: "read_only",
    target: "workspace_inventory",
    params: [],
    sources: {
      routes: [
        { method: "GET", path: "/api/servers/:serverId/machines" },
        { method: "GET", path: "/api/agents" }
      ],
      modules: ["apps/server/src/communication-agent.ts"]
    },
    exposure: { deterministic: true, llm: false, help: false },
    confirmation: "none",
    authorization: { policy: "workspace_visible_inventory", roles: READ_ROLES },
    implementationRef: ["communicationAgentInventoryListText"],
    resultStatuses: QUERY_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: [],
    audit: NO_AUDIT
  },
  {
    id: "computer.list",
    domain: "computer",
    purpose: "List Devices visible in the current Workspace.",
    disposition: "allowed",
    rationale: "Device inventory is required for explicit target selection.",
    risk: "read_only",
    target: "workspace_inventory",
    params: [],
    sources: {
      routes: [{ method: "GET", path: "/api/servers/:serverId/machines" }],
      modules: ["apps/server/src/communication-agent.ts"]
    },
    exposure: { deterministic: true, llm: false, help: true },
    confirmation: "none",
    authorization: { policy: "workspace_visible_inventory", roles: READ_ROLES },
    implementationRef: ["communicationAgentComputerListText"],
    resultStatuses: QUERY_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: [],
    audit: NO_AUDIT,
    help: [{
      key: "computer-list",
      order: 20,
      text: "List devices",
      example: "list devices"
    }]
  },
  {
    id: "computer.details",
    domain: "computer",
    purpose: "Explain a known Device and its current capabilities.",
    disposition: "allowed",
    rationale: "Capability explanation reads the current Workspace inventory without mutation.",
    risk: "read_only",
    target: "computer",
    params: [COMPUTER_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "GET", path: "/api/servers/:serverId/machines" }],
      modules: ["apps/server/src/communication-agent.ts"]
    },
    exposure: { deterministic: true, llm: false, help: true },
    confirmation: "none",
    authorization: { policy: "workspace_visible_inventory", roles: READ_ROLES },
    implementationRef: ["communicationAgentCapabilityText"],
    resultStatuses: QUERY_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: [],
    audit: NO_AUDIT,
    help: [{
      key: "computer-agent-capabilities",
      order: 190,
      text: "Explain a known device or agent",
      example: "what can Build Bot do?",
      relatedOperationIds: ["agent.details", "agent.capabilities"]
    }]
  },
  {
    id: "computer.onboard",
    domain: "computer",
    purpose: "Create a short-lived Device onboarding link.",
    disposition: "allowed",
    rationale: "The existing onboarding intent is the safe Assistant alternative to returning long-lived connector credentials.",
    risk: "medium",
    target: "computer",
    params: [{
      name: "name",
      type: "string",
      required: false,
      description: "Optional Device display name."
    }],
    sources: {
      routes: [{
        method: "POST",
        path: "/api/machines/onboarding-intents",
        requestFields: ["serverId", "name"]
      }],
      modules: [
        "apps/server/src/communication-agent.ts",
        "apps/server/src/machine-onboarding-service.ts"
      ]
    },
    exposure: { deterministic: true, llm: false, help: true },
    confirmation: "none",
    authorization: { policy: "workspace_member_onboarding", roles: MANAGE_ROLES },
    implementationRef: ["createCommunicationAgentOnboardingReply", "createMachineOnboardingLink"],
    resultStatuses: ["completed", "denied", "failed"],
    resultPolicy: {
      sensitivity: "ephemeral_onboarding_link",
      mayReturnToConversation: true,
      mayPersistInAudit: false
    },
    sideEffects: ["Creates a pending Machine onboarding intent and placeholder Device record."],
    audit: {
      eventKinds: ["communication_agent_machine_onboarding_created"],
      forbiddenMetadata: ["onboardingUrl", "code", "credential", "apiKey", "connectorToken"]
    },
    help: [{
      key: "computer-onboard",
      order: 10,
      text: "Add device",
      example: "add device named Office Mac"
    }]
  },
  {
    id: "agent.list",
    domain: "agent",
    purpose: "List Agents visible in the current Workspace.",
    disposition: "allowed",
    rationale: "Agent inventory is required for exact target selection and is already deterministic.",
    risk: "read_only",
    target: "workspace_inventory",
    params: [],
    sources: {
      routes: [{ method: "GET", path: "/api/agents" }],
      modules: ["apps/server/src/communication-agent.ts"]
    },
    exposure: { deterministic: true, llm: false, help: true },
    confirmation: "none",
    authorization: { policy: "workspace_visible_inventory", roles: READ_ROLES },
    implementationRef: ["communicationAgentAgentListText"],
    resultStatuses: QUERY_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: [],
    audit: NO_AUDIT,
    help: [{
      key: "agent-list",
      order: 30,
      text: "List agents",
      example: "list agents"
    }]
  },
  {
    id: "agent.details",
    domain: "agent",
    purpose: "Read whitelisted current Agent details from server truth.",
    disposition: "allowed",
    rationale: "The LLM may select a target and field, but values remain deterministic and Workspace-scoped.",
    risk: "read_only",
    target: "agent",
    params: [
      AGENT_REFERENCE_PARAM,
      {
        name: "field",
        type: "TyrAssistantAgentDetailsField",
        required: true,
        description: "Whitelisted Agent details field."
      }
    ],
    sources: {
      routes: [{ method: "GET", path: "/api/agents" }],
      modules: [
        "apps/server/src/agent-details-query.ts",
        "apps/server/src/assistant-llm.ts"
      ]
    },
    exposure: { deterministic: true, llm: true, help: true },
    confirmation: "none",
    authorization: { policy: "workspace_visible_inventory", roles: READ_ROLES },
    implementationRef: ["parseAgentDetailsQuery", "formatAgentDetailsReply"],
    queryFields: TYR_ASSISTANT_AGENT_DETAILS_FIELDS,
    resultStatuses: QUERY_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: [],
    audit: NO_AUDIT,
    help: [
      {
        key: "agent-details",
        order: 90,
        text: "Show agent details",
        example: "show Build Bot details"
      },
      {
        key: "agent-permissions",
        order: 100,
        text: "Check permissions",
        example: "what permissions does Build Bot have?"
      }
    ]
  },
  {
    id: "agent.capabilities",
    domain: "agent",
    purpose: "Explain a known Agent using its profile and current runtime status.",
    disposition: "allowed",
    rationale: "Capability explanation is a deterministic read-only query used before routing.",
    risk: "read_only",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "GET", path: "/api/agents" }],
      modules: ["apps/server/src/communication-agent.ts"]
    },
    exposure: { deterministic: true, llm: false, help: false },
    confirmation: "none",
    authorization: { policy: "workspace_visible_inventory", roles: READ_ROLES },
    implementationRef: ["communicationAgentCapabilityText"],
    resultStatuses: QUERY_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: [],
    audit: NO_AUDIT
  },
  {
    id: "agent.create",
    domain: "agent",
    purpose: "Create one executable Agent on an exact Device.",
    disposition: "allowed",
    rationale: "The existing management draft collects safe fields and delegates authorization to AgentManagementService.",
    risk: "medium",
    target: "agent",
    params: [
      { name: "name", type: "string", required: true, description: "Agent display name." },
      { ...COMPUTER_REFERENCE_PARAM, name: "machineReference" },
      { name: "runtimeReference", type: "string", required: true, description: "Supported runtime name." },
      { name: "modelReference", type: "string", required: false, description: "Optional model from the runtime catalog." },
      { name: "permissionMode", type: "RuntimePermissionMode", required: false, description: "Runtime Access mode; defaults to workspace-write." }
    ],
    sources: {
      routes: [{
        method: "POST",
        path: "/api/agents",
        requestFields: ["machineId", "name", "runtime", "model", "description", "permissionMode"]
      }],
      modules: [
        "apps/server/src/communication-agent-actions.ts",
        "apps/server/src/agent-management-service.ts"
      ]
    },
    exposure: { deterministic: true, llm: true, help: true },
    confirmation: "none",
    authorization: { policy: "agent_management_service", roles: MANAGE_ROLES },
    implementationRef: ["beginCommunicationAgentAction", "createAgent"],
    managementAction: "create",
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Creates an Agent record and may request runtime start."],
    audit: {
      eventKinds: ["communication_agent_agent_create", "agent_management_create"],
      forbiddenMetadata: ["envVars", "runtimeResourceGrants", "credential"]
    },
    help: [{
      key: "agent-create",
      order: 40,
      text: "Create agent",
      example: "create an agent named Code Reviewer"
    }]
  },
  {
    id: "agent.delete",
    domain: "agent",
    purpose: "Delete one exact non-Communication Agent.",
    disposition: "allowed",
    rationale: "Single-Agent delete already uses explicit target selection, confirmation, and AgentManagementService.",
    risk: "high",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "DELETE", path: "/api/agents/:agentId" }],
      modules: [
        "apps/server/src/communication-agent-actions.ts",
        "apps/server/src/agent-management-service.ts"
      ]
    },
    exposure: { deterministic: true, llm: true, help: true },
    confirmation: "always",
    authorization: { policy: "agent_management_service", roles: MANAGE_ROLES },
    implementationRef: ["beginCommunicationAgentAction", "deleteAgent"],
    managementAction: "delete",
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Stops and archives the selected Agent and cleans related resources."],
    audit: {
      eventKinds: ["communication_agent_agent_delete", "agent_management_delete"],
      forbiddenMetadata: ["credential", "envVars"]
    },
    help: [{
      key: "agent-delete",
      order: 170,
      text: "Delete agent",
      example: "delete Build Bot"
    }]
  },
  {
    id: "agent.start",
    domain: "agent",
    purpose: "Start one exact executable Agent.",
    disposition: "allowed",
    rationale: "Single-Agent start already uses deterministic target resolution and the shared management service.",
    risk: "low",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "POST", path: "/api/agents/:agentId/start" }],
      modules: [
        "apps/server/src/communication-agent-actions.ts",
        "apps/server/src/agent-management-service.ts"
      ]
    },
    exposure: { deterministic: true, llm: true, help: true },
    confirmation: "none",
    authorization: { policy: "agent_management_service", roles: MANAGE_ROLES },
    implementationRef: ["beginCommunicationAgentAction", "startAgent"],
    managementAction: "start",
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Requests runtime start through the target Device daemon."],
    audit: {
      eventKinds: ["communication_agent_agent_start", "agent_management_start"],
      forbiddenMetadata: ["credential", "envVars"]
    },
    help: [{
      key: "agent-start",
      order: 110,
      text: "Start agent",
      example: "start Build Bot"
    }]
  },
  {
    id: "agent.stop",
    domain: "agent",
    purpose: "Stop one exact executable Agent.",
    disposition: "allowed",
    rationale: "Single-Agent stop already requires confirmation and uses the shared management service.",
    risk: "medium",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "POST", path: "/api/agents/:agentId/stop" }],
      modules: [
        "apps/server/src/communication-agent-actions.ts",
        "apps/server/src/agent-management-service.ts"
      ]
    },
    exposure: { deterministic: true, llm: true, help: true },
    confirmation: "always",
    authorization: { policy: "agent_management_service", roles: MANAGE_ROLES },
    implementationRef: ["beginCommunicationAgentAction", "stopAgent"],
    managementAction: "stop",
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Requests runtime stop and updates Agent status."],
    audit: {
      eventKinds: ["communication_agent_agent_stop", "agent_management_stop"],
      forbiddenMetadata: ["credential", "envVars"]
    },
    help: [{
      key: "agent-stop",
      order: 120,
      text: "Stop agent",
      example: "stop Build Bot"
    }]
  },
  {
    id: "agent.restart",
    domain: "agent",
    purpose: "Restart one exact executable Agent.",
    disposition: "allowed",
    rationale: "Single-Agent restart already requires confirmation and composes shared stop/start behavior.",
    risk: "medium",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "POST", path: "/api/agents/:agentId/restart" }],
      modules: [
        "apps/server/src/communication-agent-actions.ts",
        "apps/server/src/agent-management-service.ts"
      ]
    },
    exposure: { deterministic: true, llm: true, help: true },
    confirmation: "always",
    authorization: { policy: "agent_management_service", roles: MANAGE_ROLES },
    implementationRef: ["beginCommunicationAgentAction", "restartAgent"],
    managementAction: "restart",
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Requests runtime stop followed by start."],
    audit: {
      eventKinds: ["communication_agent_agent_restart", "agent_management_restart"],
      forbiddenMetadata: ["credential", "envVars"]
    },
    help: [{
      key: "agent-restart",
      order: 130,
      text: "Restart agent",
      example: "restart Build Bot"
    }]
  },
  {
    id: "agent.update",
    domain: "agent",
    purpose: "Update whitelisted fields on one exact Agent.",
    disposition: "allowed",
    rationale: "The existing draft limits updates to name, description, model, and permission mode with field-level confirmation.",
    risk: "medium",
    target: "agent",
    params: [
      AGENT_REFERENCE_PARAM,
      {
        name: "field",
        type: "AgentEditableField",
        required: true,
        description: "One of name, description, model, or permissionMode."
      },
      {
        name: "value",
        type: "string",
        required: true,
        description: "Validated replacement value."
      }
    ],
    sources: {
      routes: [{
        method: "PATCH",
        path: "/api/agents/:agentId",
        requestFields: ["name", "displayName", "description", "model", "permissionMode"]
      }],
      modules: [
        "apps/server/src/communication-agent-actions.ts",
        "apps/server/src/agent-management-service.ts"
      ]
    },
    exposure: { deterministic: true, llm: true, help: true },
    confirmation: "conditional",
    authorization: { policy: "agent_management_service", roles: MANAGE_ROLES },
    implementationRef: ["beginCommunicationAgentAction", "updateAgent"],
    managementAction: "update",
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Updates safe Agent configuration and may restart the runtime."],
    audit: {
      eventKinds: ["communication_agent_agent_update", "agent_management_update"],
      forbiddenMetadata: ["envVars", "runtimeResourceGrants", "credential"]
    },
    help: [
      {
        key: "agent-rename",
        order: 50,
        text: "Rename agent",
        example: "rename Build Bot to Review Bot"
      },
      {
        key: "agent-permission-update",
        order: 60,
        text: "Change permissions",
        example: "give Review Bot full dev access"
      },
      {
        key: "agent-model-update",
        order: 70,
        text: "Change model",
        example: "change Review Bot's model to codex-fast"
      },
      {
        key: "agent-description-update",
        order: 80,
        text: "Change description",
        example: "update Review Bot's description to review backend code"
      }
    ]
  },
  {
    id: "computer.agents.start",
    domain: "computer_agent",
    purpose: "Start executable Agents assigned to one exact Device.",
    disposition: "allowed",
    rationale: "Device-scoped batch start reuses AgentManagementService per Agent and has bounded blast radius.",
    risk: "medium",
    target: "computer_agents",
    params: [COMPUTER_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "POST", path: "/api/machines/:machineId/start-all" }],
      modules: [
        "apps/server/src/communication-agent-actions.ts",
        "apps/server/src/agent-management-service.ts"
      ]
    },
    exposure: { deterministic: true, llm: true, help: true },
    confirmation: "none",
    authorization: { policy: "agent_management_service_batch", roles: MANAGE_ROLES },
    implementationRef: ["beginCommunicationAgentAction", "batchByMachine"],
    managementAction: "batch_start",
    resultStatuses: BATCH_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Requests start for the confirmation-snapshot Agents on one Device."],
    audit: {
      eventKinds: ["communication_agent_agent_batch_start"],
      forbiddenMetadata: ["credential", "envVars"]
    },
    help: [{
      key: "computer-agents-start",
      order: 140,
      text: "Start all agents on a device",
      example: "start all agents on Linux"
    }]
  },
  {
    id: "computer.agents.stop",
    domain: "computer_agent",
    purpose: "Stop executable Agents assigned to one exact Device.",
    disposition: "allowed",
    rationale: "Device-scoped batch stop is confirmation-gated and reuses AgentManagementService per Agent.",
    risk: "high",
    target: "computer_agents",
    params: [COMPUTER_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "POST", path: "/api/machines/:machineId/stop-all" }],
      modules: [
        "apps/server/src/communication-agent-actions.ts",
        "apps/server/src/agent-management-service.ts"
      ]
    },
    exposure: { deterministic: true, llm: true, help: true },
    confirmation: "always",
    authorization: { policy: "agent_management_service_batch", roles: MANAGE_ROLES },
    implementationRef: ["beginCommunicationAgentAction", "batchByMachine"],
    managementAction: "batch_stop",
    resultStatuses: BATCH_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Requests stop for the confirmation-snapshot Agents on one Device."],
    audit: {
      eventKinds: ["communication_agent_agent_batch_stop"],
      forbiddenMetadata: ["credential", "envVars"]
    },
    help: [{
      key: "computer-agents-stop",
      order: 150,
      text: "Stop all agents on a device",
      example: "stop all agents on Linux"
    }]
  },
  {
    id: "computer.agents.restart",
    domain: "computer_agent",
    purpose: "Restart executable Agents assigned to one exact Device.",
    disposition: "allowed",
    rationale: "Device-scoped batch restart is confirmation-gated and reuses AgentManagementService per Agent.",
    risk: "high",
    target: "computer_agents",
    params: [COMPUTER_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "POST", path: "/api/machines/:machineId/restart-all" }],
      modules: [
        "apps/server/src/communication-agent-actions.ts",
        "apps/server/src/agent-management-service.ts"
      ]
    },
    exposure: { deterministic: true, llm: true, help: true },
    confirmation: "always",
    authorization: { policy: "agent_management_service_batch", roles: MANAGE_ROLES },
    implementationRef: ["beginCommunicationAgentAction", "batchByMachine"],
    managementAction: "batch_restart",
    resultStatuses: BATCH_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Requests stop and start for the confirmation-snapshot Agents on one Device."],
    audit: {
      eventKinds: ["communication_agent_agent_batch_restart"],
      forbiddenMetadata: ["credential", "envVars"]
    },
    help: [{
      key: "computer-agents-restart",
      order: 160,
      text: "Restart all agents on a device",
      example: "restart all agents on Linux"
    }]
  },
  {
    id: "computer.rename",
    domain: "computer",
    purpose: "Rename one Device.",
    disposition: "allowed",
    rationale: "Exact Device resolution, conditional confirmation, owner authorization, and audit semantics are enforced by the Assistant workflow.",
    risk: "medium",
    target: "computer",
    params: [COMPUTER_REFERENCE_PARAM, { name: "name", type: "string", required: true, description: "New Device name." }],
    sources: {
      routes: [{ method: "PATCH", path: "/api/machines/:machineId", requestFields: ["name"] }],
      modules: [
        "apps/server/src/routes/machine-routes.ts",
        "apps/server/src/communication-agent-actions.ts"
      ]
    },
    exposure: { deterministic: true, llm: true, help: true },
    confirmation: "conditional",
    authorization: { policy: "owned_machine_required", roles: MANAGE_ROLES },
    implementationRef: ["progressComputerRename", "executeComputerRename", "store.updateMachineName"],
    managementAction: "computer_rename",
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Renames a Device."],
    audit: {
      eventKinds: ["communication_agent_computer_rename"],
      forbiddenMetadata: ["credential", "apiKey", "connectorToken"]
    },
    help: [{
      key: "computer-rename",
      order: 25,
      text: "Rename device",
      example: "rename device Office Mac to Build Mac"
    }]
  },
  {
    id: "computer.delete",
    domain: "computer",
    purpose: "Delete one Device.",
    disposition: "candidate",
    rationale: "Device deletion needs explicit handling for attached Agents and daemon disconnection before Assistant exposure.",
    risk: "high",
    target: "computer",
    params: [COMPUTER_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "DELETE", path: "/api/machines/:machineId" }],
      modules: ["apps/server/src/routes/machine-routes.ts"]
    },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "owned_machine_required", roles: MANAGE_ROLES },
    implementationRef: ["store.deleteMachine"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Archives a Device and closes its daemon connection."],
    audit: NO_AUDIT
  },
  {
    id: "computer.runtimeModels.detect",
    domain: "computer",
    purpose: "Detect models available to one runtime on a Device.",
    disposition: "allowed",
    rationale: "The bounded daemon request now has stable offline, timeout, unavailable, and completed result semantics.",
    risk: "medium",
    target: "computer",
    params: [COMPUTER_REFERENCE_PARAM, { name: "runtime", type: "RuntimeId", required: true, description: "Runtime to inspect." }],
    sources: {
      routes: [{ method: "POST", path: "/api/machines/:machineId/runtimes/:runtime/models/detect" }],
      modules: [
        "apps/server/src/routes/machine-routes.ts",
        "apps/server/src/runtime-model-detection.ts",
        "apps/server/src/communication-agent-actions.ts"
      ]
    },
    exposure: { deterministic: true, llm: true, help: true },
    confirmation: "none",
    authorization: { policy: "owned_machine_required", roles: MANAGE_ROLES },
    implementationRef: ["progressRuntimeModelDetection", "requestRuntimeModelDetection", "machine:runtime_models:detect"],
    managementAction: "runtime_models_detect",
    resultStatuses: QUERY_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Requests runtime model detection from the daemon."],
    audit: {
      eventKinds: ["communication_agent_computer_runtime_models_detect"],
      forbiddenMetadata: ["credential", "envVars"]
    },
    help: [{
      key: "computer-runtime-models-detect",
      order: 35,
      text: "Detect runtime models",
      example: "detect Codex models on Office Mac"
    }]
  },
  {
    id: "agent.reset",
    domain: "agent",
    purpose: "Clear one Agent runtime session and restart it.",
    disposition: "allowed",
    rationale: "Reset is limited to one exact owned Agent, always confirmed, and reports stop, session-clear, and restart delivery separately.",
    risk: "high",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "POST", path: "/api/agents/:agentId/reset", requestFields: ["mode"] }],
      modules: [
        "apps/server/src/routes/agent-routes.ts",
        "apps/server/src/agent-management-service.ts",
        "apps/server/src/communication-agent-actions.ts"
      ]
    },
    exposure: { deterministic: true, llm: true, help: true },
    confirmation: "always",
    authorization: { policy: "agent_runtime_owner_required", roles: MANAGE_ROLES },
    implementationRef: ["resetAgent", "store.clearAgentSession"],
    managementAction: "reset",
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Clears runtime session state and requests restart."],
    audit: {
      eventKinds: ["communication_agent_agent_reset"],
      forbiddenMetadata: ["credential", "envVars", "sessionId"]
    },
    help: [{
      key: "agent-reset",
      order: 135,
      text: "Reset agent session",
      example: "reset Build Bot"
    }]
  },
  {
    id: "agent.runtime.update",
    domain: "agent",
    purpose: "Change an Agent runtime.",
    disposition: "candidate",
    rationale: "Runtime migration requires session compatibility and daemon lifecycle design.",
    risk: "high",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM, { name: "runtime", type: "RuntimeId", required: true, description: "Replacement runtime." }],
    sources: { routes: [], modules: ["apps/server/src/agent-management-service.ts"] },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "agent_management_service", roles: MANAGE_ROLES },
    implementationRef: ["candidate_only:agent.runtime.update"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Would migrate runtime configuration and session state."],
    audit: NO_AUDIT
  },
  {
    id: "agent.computer.reassign",
    domain: "agent",
    purpose: "Move an Agent to another Device.",
    disposition: "candidate",
    rationale: "Reassignment changes ownership and runtime placement and needs a separate migration design.",
    risk: "high",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM, COMPUTER_REFERENCE_PARAM],
    sources: { routes: [], modules: ["apps/server/src/agent-management-service.ts"] },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "agent_management_service", roles: MANAGE_ROLES },
    implementationRef: ["candidate_only:agent.computer.reassign"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Would change Agent placement and runtime ownership."],
    audit: NO_AUDIT
  },
  {
    id: "agent.reasoningEffort.update",
    domain: "agent",
    purpose: "Set Agent reasoning effort.",
    disposition: "candidate",
    rationale: "The Web create API accepts the field, but Assistant model/runtime validation is not designed.",
    risk: "medium",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM, { name: "reasoningEffort", type: "string", required: true, description: "Runtime-specific reasoning effort." }],
    sources: {
      routes: [{ method: "POST", path: "/api/agents", requestFields: ["reasoningEffort"] }],
      modules: ["apps/server/src/routes/agent-routes.ts"]
    },
    exposure: NO_EXPOSURE,
    confirmation: "conditional",
    authorization: { policy: "agent_management_service", roles: MANAGE_ROLES },
    implementationRef: ["createAgent.reasoningEffort"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Changes runtime reasoning configuration."],
    audit: NO_AUDIT
  },
  {
    id: "agent.avatar.update",
    domain: "agent",
    purpose: "Set Agent avatar metadata.",
    disposition: "candidate",
    rationale: "Avatar editing is a UI profile concern and has no approved Assistant language or validation.",
    risk: "low",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM, { name: "avatarUrl", type: "string", required: true, description: "Avatar URL or supported avatar value." }],
    sources: {
      routes: [{ method: "PATCH", path: "/api/agents/:agentId", requestFields: ["avatarUrl"] }],
      modules: ["apps/server/src/routes/agent-routes.ts"]
    },
    exposure: NO_EXPOSURE,
    confirmation: "conditional",
    authorization: { policy: "agent_runtime_owner_required", roles: MANAGE_ROLES },
    implementationRef: ["store.updateAgentProfile"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Updates Agent avatar metadata."],
    audit: NO_AUDIT
  },
  {
    id: "agent.scopes.read",
    domain: "agent",
    purpose: "Read Agent capability scopes.",
    disposition: "allowed",
    rationale: "The owner-only read returns a stable, human-readable capability list without changing execution permissions.",
    risk: "read_only",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "GET", path: "/api/agents/:agentId/scopes" }],
      modules: [
        "apps/server/src/routes/agent-routes.ts",
        "apps/server/src/communication-agent-actions.ts"
      ]
    },
    exposure: { deterministic: true, llm: true, help: true },
    confirmation: "none",
    authorization: { policy: "agent_runtime_owner_required", roles: MANAGE_ROLES },
    implementationRef: ["executeAgentScopesRead", "store.getAgentScopes"],
    managementAction: "scopes_read",
    resultStatuses: QUERY_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: [],
    audit: {
      eventKinds: ["communication_agent_agent_scopes_read"],
      forbiddenMetadata: ["credential", "envVars", "runtimeResourceGrants"]
    },
    help: [{
      key: "agent-scopes-read",
      order: 105,
      text: "Show agent capability scopes",
      example: "show Build Bot scopes"
    }]
  },
  {
    id: "agent.scopes.update",
    domain: "agent",
    purpose: "Update Agent capability scopes.",
    disposition: "candidate",
    rationale: "Scope mutation changes execution permissions and needs dedicated confirmation and policy review.",
    risk: "critical",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM, { name: "granted", type: "AgentCapability[]", required: true, description: "Requested capability grants." }],
    sources: {
      routes: [{ method: "PATCH", path: "/api/agents/:agentId/scopes" }],
      modules: ["apps/server/src/routes/agent-routes.ts"]
    },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "agent_runtime_owner_required", roles: MANAGE_ROLES },
    implementationRef: ["store.setAgentScopes"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Changes Agent execution capability grants."],
    audit: NO_AUDIT
  },
  {
    id: "agent.scopes.reset",
    domain: "agent",
    purpose: "Reset Agent capability scopes.",
    disposition: "candidate",
    rationale: "Scope reset changes execution permissions and needs dedicated confirmation and policy review.",
    risk: "critical",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "DELETE", path: "/api/agents/:agentId/scopes" }],
      modules: ["apps/server/src/routes/agent-routes.ts"]
    },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "agent_runtime_owner_required", roles: MANAGE_ROLES },
    implementationRef: ["store.resetAgentScopes"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Resets Agent execution capability grants."],
    audit: NO_AUDIT
  },
  {
    id: "agent.runtimeResourceGrants.update",
    domain: "agent",
    purpose: "Update Agent runtime resource grants.",
    disposition: "candidate",
    rationale: "Resource grants can expose directories, networks, accounts, devices, or MCP servers and need dedicated governance.",
    risk: "critical",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM, { name: "runtimeResourceGrants", type: "RuntimeResourceGrant[]", required: true, description: "Requested runtime resource grants." }],
    sources: {
      routes: [
        { method: "POST", path: "/api/agents", requestFields: ["runtimeResourceGrants"] },
        { method: "PATCH", path: "/api/agents/:agentId", requestFields: ["runtimeResourceGrants"] }
      ],
      modules: ["apps/server/src/routes/agent-routes.ts"]
    },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "agent_runtime_owner_required", roles: MANAGE_ROLES },
    implementationRef: ["store.updateAgentRuntimeResourceGrants"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Changes runtime resource access."],
    audit: {
      eventKinds: [],
      forbiddenMetadata: ["runtimeResourceGrants"]
    }
  },
  {
    id: "computer.connectCommand.read",
    domain: "computer",
    purpose: "Read executable Device connection commands.",
    disposition: "forbidden",
    rationale: "Connection commands contain long-lived bootstrap or connector credentials and must never enter Assistant conversation.",
    risk: "critical",
    target: "computer",
    params: [COMPUTER_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "GET", path: "/api/machines/:machineId/connect-command" }],
      modules: ["apps/server/src/routes/machine-routes.ts"]
    },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "owned_machine_required", roles: MANAGE_ROLES },
    implementationRef: ["machineConnectCommands"],
    resultStatuses: QUERY_STATUSES,
    resultPolicy: CREDENTIAL_RESULT,
    sideEffects: [],
    audit: {
      eventKinds: [],
      forbiddenMetadata: ["connectCommand", "credential", "apiKey", "connectorToken"]
    }
  },
  {
    id: "computer.connectorToken.rotate",
    domain: "computer",
    purpose: "Rotate a Device connector token.",
    disposition: "forbidden",
    rationale: "Token rotation creates and transmits a long-lived credential and is not safe for Assistant conversation.",
    risk: "critical",
    target: "computer",
    params: [COMPUTER_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "POST", path: "/api/machines/:machineId/connector-token/rotate" }],
      modules: ["apps/server/src/routes/machine-routes.ts"]
    },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "owned_machine_required", roles: MANAGE_ROLES },
    implementationRef: ["store.rotateMachineConnectorToken"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: CREDENTIAL_RESULT,
    sideEffects: ["Rotates and delivers a connector credential."],
    audit: {
      eventKinds: [],
      forbiddenMetadata: ["connectorToken", "credential"]
    }
  },
  {
    id: "computer.connectorToken.revoke",
    domain: "computer",
    purpose: "Revoke a Device connector token.",
    disposition: "forbidden",
    rationale: "Credential revocation disconnects a Device and requires a dedicated recovery flow outside Assistant.",
    risk: "critical",
    target: "computer",
    params: [COMPUTER_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "POST", path: "/api/machines/:machineId/connector-token/revoke" }],
      modules: ["apps/server/src/routes/machine-routes.ts"]
    },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "owned_machine_required", roles: MANAGE_ROLES },
    implementationRef: ["store.revokeMachineConnectorToken"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: CREDENTIAL_RESULT,
    sideEffects: ["Revokes connector access and closes the daemon socket."],
    audit: {
      eventKinds: [],
      forbiddenMetadata: ["connectorToken", "credential"]
    }
  },
  {
    id: "agent.envVars.update",
    domain: "agent",
    purpose: "Create or update Agent environment variables.",
    disposition: "forbidden",
    rationale: "Environment variables can contain provider credentials and secrets and must not enter LLM or conversation artifacts.",
    risk: "critical",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM, { name: "envVars", type: "Record<string, string>", required: true, description: "Secret environment variables." }],
    sources: {
      routes: [{ method: "POST", path: "/api/agents", requestFields: ["envVars"] }],
      modules: ["apps/server/src/routes/agent-routes.ts"]
    },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "agent_runtime_owner_required", roles: MANAGE_ROLES },
    implementationRef: ["createAgent.envVars"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: CREDENTIAL_RESULT,
    sideEffects: ["Stores secret runtime environment configuration."],
    audit: {
      eventKinds: [],
      forbiddenMetadata: ["envVars"]
    }
  },
  {
    id: "computer.agents.delete",
    domain: "computer_agent",
    purpose: "Delete all Agents on a Device.",
    disposition: "forbidden",
    rationale: "Batch delete has an unacceptable destructive blast radius for conversational control.",
    risk: "critical",
    target: "computer_agents",
    params: [COMPUTER_REFERENCE_PARAM],
    sources: { routes: [], modules: ["policy_only:computer.agents.delete"] },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "forbidden", roles: [] },
    implementationRef: ["policy_only:computer.agents.delete"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Would delete multiple Agents."],
    audit: NO_AUDIT
  },
  {
    id: "computer.agents.update",
    domain: "computer_agent",
    purpose: "Update all Agents on a Device.",
    disposition: "forbidden",
    rationale: "Batch configuration mutation has an unacceptable permission and configuration blast radius.",
    risk: "critical",
    target: "computer_agents",
    params: [COMPUTER_REFERENCE_PARAM],
    sources: { routes: [], modules: ["policy_only:computer.agents.update"] },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "forbidden", roles: [] },
    implementationRef: ["policy_only:computer.agents.update"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Would update multiple Agents."],
    audit: NO_AUDIT
  },
  {
    id: "computer.agents.reset",
    domain: "computer_agent",
    purpose: "Reset all Agents on a Device.",
    disposition: "forbidden",
    rationale: "Batch session reset is destructive and intentionally excluded from Assistant.",
    risk: "critical",
    target: "computer_agents",
    params: [COMPUTER_REFERENCE_PARAM],
    sources: {
      routes: [{ method: "POST", path: "/api/machines/:machineId/reset-all", requestFields: ["mode"] }],
      modules: ["apps/server/src/routes/machine-routes.ts"]
    },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "forbidden", roles: [] },
    implementationRef: ["runMachineBatchEndpoint"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Clears and restarts multiple Agent sessions."],
    audit: NO_AUDIT
  },
  {
    id: "workspace.agents.lifecycle",
    domain: "computer_agent",
    purpose: "Control Agent lifecycle across an entire Workspace.",
    disposition: "forbidden",
    rationale: "Workspace-wide lifecycle has an unbounded multi-Device blast radius.",
    risk: "critical",
    target: "workspace_inventory",
    params: [],
    sources: { routes: [], modules: ["policy_only:workspace.agents.lifecycle"] },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "forbidden", roles: [] },
    implementationRef: ["policy_only:workspace.agents.lifecycle"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Would control Agents across multiple Devices."],
    audit: NO_AUDIT
  },
  {
    id: "communicationAgent.lifecycle",
    domain: "agent",
    purpose: "Start, stop, restart, or delete a Communication Agent.",
    disposition: "forbidden",
    rationale: "TYR must not self-manage its runtime lifecycle or delete itself.",
    risk: "critical",
    target: "agent",
    params: [AGENT_REFERENCE_PARAM],
    sources: {
      routes: [
        { method: "POST", path: "/api/agents/:agentId/start" },
        { method: "POST", path: "/api/agents/:agentId/stop" },
        { method: "POST", path: "/api/agents/:agentId/restart" },
        { method: "DELETE", path: "/api/agents/:agentId" }
      ],
      modules: ["apps/server/src/routes/agent-routes.ts"]
    },
    exposure: NO_EXPOSURE,
    confirmation: "always",
    authorization: { policy: "forbidden", roles: [] },
    implementationRef: ["rejectCommunicationAgentRuntimeAction", "isCommunicationAgent"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Would alter the Communication Agent itself."],
    audit: NO_AUDIT
  },
  {
    id: "computer.bootstrap.create",
    domain: "computer",
    purpose: "Create a raw Machine key and executable connection commands.",
    disposition: "internal",
    rationale: "Raw bootstrap credentials are an internal/Web flow; Assistant must use computer.onboard instead.",
    risk: "critical",
    target: "computer",
    params: [{ name: "name", type: "string", required: false, description: "Device name." }],
    sources: {
      routes: [{ method: "POST", path: "/api/machines", requestFields: ["serverId", "name"] }],
      modules: ["apps/server/src/routes/machine-routes.ts"]
    },
    exposure: NO_EXPOSURE,
    confirmation: "none",
    authorization: { policy: "workspace_member_required", roles: MANAGE_ROLES },
    implementationRef: ["store.createMachineKey", "machineConnectCommands"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: CREDENTIAL_RESULT,
    sideEffects: ["Creates a Machine API key and connect commands."],
    audit: {
      eventKinds: [],
      forbiddenMetadata: ["apiKey", "connectorToken", "connectCommand", "credential"]
    }
  },
  {
    id: "computer.onboarding.consume",
    domain: "computer",
    purpose: "View and consume a short-lived Device onboarding intent.",
    disposition: "internal",
    rationale: "The public onboarding page and one-time credential delivery belong to the connector bootstrap flow, not Assistant tools.",
    risk: "critical",
    target: "computer",
    params: [{ name: "code", type: "string", required: true, description: "Short-lived onboarding code." }],
    sources: {
      routes: [
        { method: "GET", path: "/api/onboarding/machines/:code" },
        { method: "POST", path: "/api/onboarding/machines/:code/consume" }
      ],
      modules: ["apps/server/src/routes/machine-onboarding-routes.ts"]
    },
    exposure: NO_EXPOSURE,
    confirmation: "none",
    authorization: { policy: "onboarding_intent", roles: [] },
    implementationRef: ["store.consumeMachineOnboardingIntent"],
    resultStatuses: ["completed", "expired", "failed"],
    resultPolicy: CREDENTIAL_RESULT,
    sideEffects: ["Consumes an onboarding intent and returns a one-time Machine credential."],
    audit: {
      eventKinds: [],
      forbiddenMetadata: ["code", "credentialValue", "apiKey"]
    }
  },
  {
    id: "heartbeat.list",
    domain: "heartbeat",
    purpose: "List the current Workspace Heartbeats and their enabled state.",
    disposition: "allowed",
    rationale: "Heartbeat configuration is server truth and can be returned without exposing credentials or private message content.",
    risk: "read_only",
    target: "workspace_heartbeat",
    params: [],
    sources: {
      routes: [{ method: "GET", path: "/api/servers/:serverId/heartbeats" }],
      modules: ["apps/server/src/assistant-tool-executor.ts"]
    },
    exposure: { deterministic: false, llm: true, help: false },
    confirmation: "none",
    authorization: { policy: "workspace_owner_required", roles: OWNER_ROLES },
    implementationRef: ["store.listTyrHeartbeats"],
    resultStatuses: QUERY_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: [],
    audit: NO_AUDIT
  },
  {
    id: "heartbeat.runs",
    domain: "heartbeat",
    purpose: "List recent runs for all Workspace Heartbeats or one exact Heartbeat.",
    disposition: "allowed",
    rationale: "Bounded Heartbeat run history provides status diagnostics without returning private DM content.",
    risk: "read_only",
    target: "workspace_heartbeat",
    params: [{ ...HEARTBEAT_ID_PARAM, required: false }],
    sources: {
      routes: [{ method: "GET", path: "/api/servers/:serverId/heartbeats" }],
      modules: ["apps/server/src/assistant-tool-executor.ts"]
    },
    exposure: { deterministic: false, llm: true, help: false },
    confirmation: "none",
    authorization: { policy: "workspace_owner_required", roles: OWNER_ROLES },
    implementationRef: ["store.listTyrHeartbeatRuns"],
    resultStatuses: QUERY_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: [],
    audit: NO_AUDIT
  },
  {
    id: "heartbeat.create",
    domain: "heartbeat",
    purpose: "Create one scheduled TYR Heartbeat for the current Workspace.",
    disposition: "allowed",
    rationale: "The MCP Action surface can reuse the validated owner Heartbeat model with bounded intervals and server-side scheduling.",
    risk: "medium",
    target: "workspace_heartbeat",
    params: [
      { name: "title", type: "string", required: true, description: "Heartbeat title." },
      { name: "instruction", type: "string", required: true, description: "Work instruction TYR should run." },
      { name: "intervalUnit", type: "TyrHeartbeatIntervalUnit", required: true, description: "minute or hour." },
      { name: "intervalValue", type: "integer", required: true, description: "Positive interval value." }
    ],
    sources: {
      routes: [{ method: "POST", path: "/api/servers/:serverId/heartbeats", requestFields: ["title", "instruction", "intervalUnit", "intervalValue"] }],
      modules: ["apps/server/src/assistant-tool-executor.ts"]
    },
    exposure: { deterministic: false, llm: true, help: false },
    confirmation: "always",
    authorization: { policy: "workspace_owner_required", roles: OWNER_ROLES },
    implementationRef: ["store.createTyrHeartbeat"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Creates an enabled schedule and its next run time."],
    audit: {
      eventKinds: ["communication_agent_heartbeat_created"],
      forbiddenMetadata: ["instruction"]
    }
  },
  {
    id: "heartbeat.update",
    domain: "heartbeat",
    purpose: "Update the title, instruction, or interval for one exact Workspace Heartbeat.",
    disposition: "allowed",
    rationale: "The update is owner-only, targets a stable Heartbeat ID, and reuses validated server scheduling semantics.",
    risk: "medium",
    target: "workspace_heartbeat",
    params: [
      HEARTBEAT_ID_PARAM,
      { name: "title", type: "string", required: false, description: "Replacement title." },
      { name: "instruction", type: "string", required: false, description: "Replacement work instruction." },
      { name: "intervalUnit", type: "TyrHeartbeatIntervalUnit", required: false, description: "minute or hour." },
      { name: "intervalValue", type: "integer", required: false, description: "Positive interval value." }
    ],
    sources: {
      routes: [{ method: "PATCH", path: "/api/servers/:serverId/heartbeats/:heartbeatId", requestFields: ["title", "instruction", "intervalUnit", "intervalValue"] }],
      modules: ["apps/server/src/assistant-tool-executor.ts"]
    },
    exposure: { deterministic: false, llm: true, help: false },
    confirmation: "always",
    authorization: { policy: "workspace_owner_required", roles: OWNER_ROLES },
    implementationRef: ["store.updateTyrHeartbeat"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Updates the schedule and recalculates its next run when the interval changes."],
    audit: {
      eventKinds: ["communication_agent_heartbeat_updated"],
      forbiddenMetadata: ["instruction"]
    }
  },
  {
    id: "heartbeat.enable",
    domain: "heartbeat",
    purpose: "Enable one exact Workspace Heartbeat.",
    disposition: "allowed",
    rationale: "Enablement is an owner-confirmed, reversible schedule state change on a stable Heartbeat ID.",
    risk: "low",
    target: "workspace_heartbeat",
    params: [HEARTBEAT_ID_PARAM],
    sources: {
      routes: [{ method: "PATCH", path: "/api/servers/:serverId/heartbeats/:heartbeatId", requestFields: ["enabled"] }],
      modules: ["apps/server/src/assistant-tool-executor.ts"]
    },
    exposure: { deterministic: false, llm: true, help: false },
    confirmation: "always",
    authorization: { policy: "workspace_owner_required", roles: OWNER_ROLES },
    implementationRef: ["store.updateTyrHeartbeat"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Enables future runs and schedules the next run."],
    audit: {
      eventKinds: ["communication_agent_heartbeat_enabled"],
      forbiddenMetadata: ["instruction"]
    }
  },
  {
    id: "heartbeat.disable",
    domain: "heartbeat",
    purpose: "Disable one exact Workspace Heartbeat without deleting its history.",
    disposition: "allowed",
    rationale: "Pause is reversible and cancels only queued runs while preserving active work and history.",
    risk: "medium",
    target: "workspace_heartbeat",
    params: [HEARTBEAT_ID_PARAM],
    sources: {
      routes: [{ method: "PATCH", path: "/api/servers/:serverId/heartbeats/:heartbeatId", requestFields: ["enabled"] }],
      modules: ["apps/server/src/assistant-tool-executor.ts"]
    },
    exposure: { deterministic: false, llm: true, help: false },
    confirmation: "always",
    authorization: { policy: "workspace_owner_required", roles: OWNER_ROLES },
    implementationRef: ["store.updateTyrHeartbeat", "store.cancelQueuedTyrHeartbeatRuns"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Disables future runs and cancels queued runs; an active run is not interrupted."],
    audit: {
      eventKinds: ["communication_agent_heartbeat_disabled"],
      forbiddenMetadata: ["instruction"]
    }
  },
  {
    id: "workspaceBridge.list",
    domain: "workspace_bridge",
    purpose: "List active Workspace Bridges available from the current workspace to an owner or member.",
    disposition: "allowed",
    rationale: "Bridge selection must use current server truth before a cross-workspace request is sent.",
    risk: "read_only",
    target: "workspace_bridge",
    params: [],
    sources: {
      routes: [{ method: "GET", path: "/api/servers/:serverId/workspace-bridges" }],
      modules: [
        "apps/server/src/workspace-bridge-request-service.ts",
        "apps/server/src/assistant-tool-executor.ts"
      ]
    },
    exposure: { deterministic: false, llm: true, help: true },
    confirmation: "none",
    authorization: { policy: "workspace_bridge_member_read", roles: MANAGE_ROLES },
    implementationRef: ["WorkspaceBridgeRequestService.list"],
    resultStatuses: QUERY_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: [],
    audit: NO_AUDIT,
    help: [{
      key: "workspace-bridge-list",
      order: 200,
      text: "List connected workspaces",
      example: "which workspaces are connected?"
    }]
  },
  {
    id: "workspaceBridge.invite.create",
    domain: "workspace_bridge",
    purpose: "Create a shareable connection link or send a directed email invitation for the authenticated local human.",
    disposition: "allowed",
    rationale: "Share links retain source confirmation. Directed email invitations bind the recipient email, support verified signup, and activate on that Owner's acceptance.",
    risk: "medium",
    target: "workspace_bridge",
    params: [{ name: "recipientEmail", type: "string", required: false, description: "Exact recipient email from the local human; omit to create a shareable link." }],
    sources: {
      routes: [{ method: "POST", path: "/api/servers/:serverId/workspace-bridge-invites" }],
      modules: ["apps/server/src/workspace-bridge-connection-intent.ts", "apps/server/src/assistant-tool-executor.ts"]
    },
    exposure: { deterministic: false, llm: true, help: true },
    confirmation: "none",
    authorization: { policy: "workspace_bridge_local_member", roles: MANAGE_ROLES },
    implementationRef: ["WorkspaceBridgeConnectionService.create"],
    resultStatuses: [...QUERY_STATUSES, "queued"],
    resultPolicy: { sensitivity: "ephemeral_onboarding_link", mayReturnToConversation: true, mayPersistInAudit: false },
    sideEffects: ["Creates an expiring connection intent; recipientEmail also sends a bound email invitation and records the original conversation for status notifications."],
    audit: { eventKinds: ["workspace_bridge_email_invite_created"], forbiddenMetadata: ["code", "url", "email_text", "origin_external_ref"] },
    help: [{ key: "workspace-bridge-invite", order: 205, text: "Create a workspace connection link", example: "create a workspace connection invite" }]
  },
  {
    id: "workspaceBridge.invite.list",
    domain: "workspace_bridge",
    purpose: "List pending and claimed local Workspace connection invitations.",
    disposition: "allowed",
    rationale: "The inviter reviews the authenticated peer before activation.",
    risk: "read_only",
    target: "workspace_bridge",
    params: [],
    sources: {
      routes: [{ method: "GET", path: "/api/servers/:serverId/workspace-bridge-invites" }],
      modules: ["apps/server/src/workspace-bridge-connection-intent.ts", "apps/server/src/assistant-tool-executor.ts"]
    },
    exposure: { deterministic: false, llm: true, help: false },
    confirmation: "none",
    authorization: { policy: "workspace_bridge_local_member", roles: MANAGE_ROLES },
    implementationRef: ["WorkspaceBridgeConnectionService.list"],
    resultStatuses: QUERY_STATUSES,
    resultPolicy: PUBLIC_RESULT,
    sideEffects: [],
    audit: NO_AUDIT
  },
  {
    id: "workspaceBridge.invite.confirm",
    domain: "workspace_bridge",
    purpose: "Activate a claimed Bridge after the local human explicitly confirms the displayed peer Workspace and Owner.",
    disposition: "allowed",
    rationale: "A bearer link can be forwarded; a persisted, conversation-bound confirmation binds consent to the authenticated recipient.",
    risk: "high",
    target: "workspace_bridge",
    params: [{ name: "intentId", type: "string", required: true, description: "Exact claimed invitation ID." }],
    sources: {
      routes: [{ method: "POST", path: "/api/servers/:serverId/workspace-bridge-invites/:intentId/confirm" }],
      modules: ["apps/server/src/workspace-bridge-connection-intent.ts", "apps/server/src/assistant-tool-executor.ts", "apps/server/src/communication-agent.ts"]
    },
    exposure: { deterministic: false, llm: true, help: false },
    confirmation: "always",
    authorization: { policy: "workspace_bridge_local_inviter_or_owner", roles: MANAGE_ROLES },
    implementationRef: ["WorkspaceBridgeConnectionService.confirm"],
    resultStatuses: ["confirmation_required", "completed", "denied", "failed"],
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Activates one bidirectional Workspace Bridge after a separate human confirmation turn."],
    audit: { eventKinds: ["workspace_bridge_connection_confirmed"], forbiddenMetadata: ["code", "url", "privateDmHistory", "credential"] }
  },
  {
    id: "workspaceBridge.request.clarify",
    domain: "workspace_bridge",
    purpose: "Ask the authenticated Bridge requester for information needed before the destination TYR can finish the open request.",
    disposition: "allowed",
    rationale: "A peer clarification is an open interaction, not a terminal delivery failure.",
    risk: "low",
    target: "workspace_bridge_request",
    params: [{ name: "question", type: "string", required: true, description: "The necessary question to show to the Bridge requester." }],
    sources: { routes: [], modules: ["apps/server/src/assistant-tool-executor.ts", "apps/server/src/workspace-bridge-delivery.ts"] },
    exposure: { deterministic: false, llm: true, help: false },
    confirmation: "none",
    authorization: { policy: "workspace_bridge_target_tyr", roles: MANAGE_ROLES },
    implementationRef: ["executeTyrAssistantTool.ask_workspace_bridge_requester"],
    resultStatuses: ["partial", "denied", "failed"],
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Keeps the current Bridge request open while its reviewed question is delivered to the requester."],
    audit: NO_AUDIT
  },
  {
    id: "workspaceBridge.message.send",
    domain: "workspace_bridge",
    purpose: "Send a request to the peer TYR through one active authorized Workspace Bridge.",
    disposition: "allowed",
    rationale: "Cross-workspace communication remains constrained to the two Communication Agents and the Bridge permission set.",
    risk: "medium",
    target: "workspace_bridge",
    params: [
      { name: "bridgeId", type: "string", required: true, description: "Exact active Workspace Bridge ID from supplied context." },
      { name: "message", type: "string", required: true, description: "Request for the peer TYR." }
    ],
    sources: {
      routes: [{ method: "POST", path: "/api/servers/:serverId/workspace-bridges/:bridgeId/messages", requestFields: ["content", "conversationId", "clientRequestId"] }],
      modules: [
        "apps/server/src/workspace-bridge-request-service.ts",
        "apps/server/src/workspace-bridge-delivery.ts",
        "apps/server/src/assistant-tool-executor.ts"
      ]
    },
    exposure: { deterministic: false, llm: true, help: true },
    confirmation: "none",
    authorization: { policy: "workspace_bridge_member_chat", roles: MANAGE_ROLES },
    implementationRef: ["WorkspaceBridgeRequestService.send"],
    resultStatuses: ["queued", "delivered", "running", "blocked_on_peer_approval", "needs_attention", "completed", "failed"],
    resultPolicy: PUBLIC_RESULT,
    sideEffects: ["Creates an isolated Bridge conversation and sends one request to the peer TYR."],
    audit: {
      eventKinds: [
        "workspace_bridge_request_submitted",
        "workspace_bridge_request_running",
        "workspace_bridge_request_completed",
        "workspace_bridge_request_failed"
      ],
      forbiddenMetadata: ["content", "credential", "privateDmHistory"]
    },
    help: [{
      key: "workspace-bridge-send",
      order: 210,
      text: "Ask a connected workspace",
      example: "ask Mike what agents are connected"
    }]
  },
  {
    id: "workspaceBridge.request.status",
    domain: "workspace_bridge",
    purpose: "Read the delivery and response state of one Workspace Bridge request.",
    disposition: "allowed",
    rationale: "Bridge delivery and peer execution are asynchronous and need a stable caller-visible status.",
    risk: "read_only",
    target: "workspace_bridge_request",
    params: [{ name: "requestId", type: "string", required: true, description: "Bridge request ID returned by send." }],
    sources: {
      routes: [{ method: "GET", path: "/api/servers/:serverId/workspace-bridges/:bridgeId/messages" }],
      modules: [
        "apps/server/src/workspace-bridge-request-service.ts",
        "apps/server/src/assistant-tool-executor.ts"
      ]
    },
    exposure: { deterministic: false, llm: true, help: false },
    confirmation: "none",
    authorization: { policy: "workspace_bridge_member_read", roles: MANAGE_ROLES },
    implementationRef: ["WorkspaceBridgeRequestService.status"],
    resultStatuses: ["queued", "delivered", "running", "blocked_on_peer_approval", "needs_attention", "completed", "failed"],
    resultPolicy: PUBLIC_RESULT,
    sideEffects: [],
    audit: NO_AUDIT
  },
  {
    id: "daemon.agent.lifecycle",
    domain: "agent",
    purpose: "Send raw Agent lifecycle protocol messages and apply status reports.",
    disposition: "internal",
    rationale: "Daemon messages are execution transport details and must remain behind AgentManagementService.",
    risk: "critical",
    target: "agent",
    params: [],
    sources: {
      routes: [],
      modules: [
        "apps/server/src/daemon-connections.ts",
        "apps/server/src/agent-management-service.ts"
      ]
    },
    exposure: NO_EXPOSURE,
    confirmation: "none",
    authorization: { policy: "internal_daemon_transport", roles: [] },
    implementationRef: ["agent:start", "agent:stop", "agent:status"],
    resultStatuses: MANAGEMENT_STATUSES,
    resultPolicy: INTERNAL_RESULT,
    sideEffects: ["Controls runtime processes and applies daemon status."],
    audit: {
      eventKinds: [],
      forbiddenMetadata: ["credential", "envVars"]
    }
  }
] as const satisfies readonly TyrAssistantOperation[];

export const TYR_ASSISTANT_SURFACE_EXCLUSIONS = [
  {
    id: "agent.dm",
    disposition: "out_of_scope",
    rationale: "Human-Agent DM opening belongs to Chat; Agent-to-Agent pair DMs are internal delegation transport and have no Human listing.",
    routes: [
      { method: "GET", path: "/api/agents/:agentId/dm" },
      { method: "GET", path: "/api/agents/:agentId/agent-dms" }
    ]
  },
  {
    id: "agent.workspace",
    disposition: "out_of_scope",
    rationale: "Workspace browsing and file access are outside P1 Device and Agent management.",
    routes: [
      { method: "GET", path: "/api/agents/:agentId/workspace" },
      { method: "GET", path: "/api/agents/:agentId/workspace-files" },
      { method: "GET", path: "/api/agents/:agentId/workspace-file" }
    ]
  },
  {
    id: "agent.skills",
    disposition: "out_of_scope",
    rationale: "Skill inventory is a later Agent capability surface.",
    routes: [{ method: "GET", path: "/api/agents/:agentId/skills" }]
  },
  {
    id: "agent.activity",
    disposition: "out_of_scope",
    rationale: "Activity and timelines are observability surfaces outside this Registry phase.",
    routes: [
      { method: "GET", path: "/api/agents/:agentId/activity" },
      { method: "GET", path: "/api/agents/:agentId/activity-timeline" },
      { method: "GET", path: "/api/agents/:agentId/activity-log" }
    ]
  }
] as const satisfies readonly TyrAssistantSurfaceExclusion[];

type ManagementActionOf<T> =
  T extends { managementAction: infer Action extends string } ? Action : never;

export type TyrAssistantManagementAction =
  ManagementActionOf<(typeof TYR_ASSISTANT_OPERATIONS)[number]>;

export const TYR_ASSISTANT_REGISTERED_MANAGEMENT_ACTIONS =
  TYR_ASSISTANT_OPERATIONS.flatMap((operation) =>
    "managementAction" in operation && operation.managementAction
      ? [operation.managementAction]
      : []
  ) as readonly TyrAssistantManagementAction[];

export const TYR_ASSISTANT_EXPOSED_MANAGEMENT_ACTIONS =
  TYR_ASSISTANT_OPERATIONS.flatMap((operation) =>
    operation.disposition === "allowed" &&
    "managementAction" in operation &&
    operation.managementAction &&
    (operation.exposure.deterministic || operation.exposure.llm)
      ? [operation.managementAction]
      : []
  ) as readonly TyrAssistantManagementAction[];

export function findTyrAssistantOperationById(id: string): TyrAssistantOperation | undefined {
  return TYR_ASSISTANT_OPERATIONS.find((operation) => operation.id === id);
}

export function findTyrAssistantOperationByManagementAction(
  action: string
): TyrAssistantOperation | undefined {
  return TYR_ASSISTANT_OPERATIONS.find((operation) =>
    "managementAction" in operation && operation.managementAction === action
  );
}

export function isTyrAssistantManagementActionExposed(
  action: string
): action is TyrAssistantManagementAction {
  const operation = findTyrAssistantOperationByManagementAction(action);
  return Boolean(
    operation &&
    operation.disposition === "allowed" &&
    (operation.exposure.deterministic || operation.exposure.llm)
  );
}

export function buildTyrAssistantLlmPromptFragment(): string {
  return [
    "Only Registry-exposed explicit Agent or Device requests may use agent_action_suggestion, including bounded read operations and Start, Stop, or Restart for all executable Agents on one exact Device.",
    "Authorized cross-workspace requests use the dedicated Workspace Bridge tools and can address only the peer TYR.",
    "Tyr resolves targets, collects missing fields, enforces confirmation, re-checks permissions, and executes outside the model.",
    "Runtime changes, Workspace-wide lifecycle, batch Delete, batch Update, batch Reset, environment variables, connector credentials, and runtime resource grants are unavailable."
  ].join(" ");
}

export function buildTyrAssistantHelpEntries(): TyrAssistantHelpEntry[] {
  const operations: readonly TyrAssistantOperation[] = TYR_ASSISTANT_OPERATIONS;
  return operations
    .filter((operation) => operation.disposition === "allowed" && operation.exposure.help)
    .flatMap((operation) => operation.help ?? [])
    .map((entry) => ({ ...entry }))
    .sort((left, right) => left.order - right.order);
}

export function buildTyrAssistantConformanceManifest() {
  const operationRoutes = TYR_ASSISTANT_OPERATIONS.flatMap((operation) =>
    operation.sources.routes.map((route) => ({
      operationId: operation.id,
      disposition: operation.disposition,
      ...route
    }))
  );
  const excludedRoutes = TYR_ASSISTANT_SURFACE_EXCLUSIONS.flatMap((exclusion) =>
    exclusion.routes.map((route) => ({
      operationId: exclusion.id,
      disposition: exclusion.disposition,
      ...route
    }))
  );
  return {
    operationIds: TYR_ASSISTANT_OPERATIONS.map((operation) => operation.id),
    allowedOperationIds: TYR_ASSISTANT_OPERATIONS
      .filter((operation) => operation.disposition === "allowed")
      .map((operation) => operation.id),
    registeredManagementActions: [...TYR_ASSISTANT_REGISTERED_MANAGEMENT_ACTIONS],
    exposedManagementActions: [...TYR_ASSISTANT_EXPOSED_MANAGEMENT_ACTIONS],
    routes: [...operationRoutes, ...excludedRoutes]
  };
}
