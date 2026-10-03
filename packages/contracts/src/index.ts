import type { AgentToolOperationObservability } from "./agent-tools.js";
import {
  TYR_ASSISTANT_REGISTERED_MANAGEMENT_ACTIONS,
  type TyrAssistantManagementAction
} from "./tyr-assistant-operations.js";

export const RUNTIMES = [
  { id: "claude", displayName: "Claude Code", binary: "claude", supported: true },
  { id: "codex", displayName: "Codex CLI", binary: "codex", supported: true },
  { id: "kimi", displayName: "Kimi CLI", binary: "kimi", supported: true },
  { id: "copilot", displayName: "Copilot CLI", binary: "copilot", supported: true },
  { id: "cursor", displayName: "Cursor CLI", binary: "cursor-agent", supported: true },
  { id: "gemini", displayName: "Gemini CLI", binary: "gemini", supported: true },
  { id: "opencode", displayName: "OpenCode", binary: "opencode", supported: true },
  { id: "antigravity", displayName: "Google Antigravity CLI", binary: "agy", supported: true }
] as const;

export * from "./agent-tools.js";
export * from "./api-response.js";
export * from "./web-auth-storage.js";
export * from "./operation-registry.js";
export * from "./tyr-assistant-operations.js";

export const LATEST_DAEMON_VERSION = "0.1.0";

export type RuntimeId = (typeof RUNTIMES)[number]["id"];

export type AgentKind = "communication" | "on_device" | "off_device";
export const DEFAULT_AGENT_KIND: AgentKind = "on_device";
export const DEFAULT_COMMUNICATION_AGENT_NAME = "tyr-assistant";
export const DEFAULT_COMMUNICATION_AGENT_DISPLAY_NAME = "TYR";
export const COMMUNICATION_AGENT_DESCRIPTION = "Workspace message hub for routing requests and onboarding conversations.";

export function isCommunicationAgent(agent: Pick<AgentRecord, "kind"> | null | undefined): boolean {
  return agent?.kind === "communication";
}

export type RuntimeStatus = "available" | "unavailable";
export type RuntimeInstallStatus = "installed" | "missing";
export type RuntimeAuthStatus = "authenticated" | "login_required" | "unknown";
export type RuntimeCapabilityStatus = "available" | "unavailable" | "degraded" | "not_applicable" | "unknown";
export type RuntimeMcpToolSurface = "full-agent-tools" | "runtime-actions-only" | "none";
export type MachineStatus = "online" | "offline" | "degraded";
export type AgentStatus = "online" | "working" | "error" | "offline";
export type AgentDesiredRuntimeState = "running" | "stopped";
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done" | "closed";
export type SenderType = "human" | "agent" | "system";
export type ChannelType = "channel" | "dm" | "thread";
export type ChannelVisibility = "public" | "private";
export type DmIdentity =
  | { kind: "human_agent"; humanUserId: string; agentId: string }
  | { kind: "agent_pair"; agentIds: [string, string] }
  | { kind: "workspace_bridge"; bridgeId: string; workspaceId: string; agentId: string };
export type ConversationStatus = "active" | "closed";
export type ConversationResetStatus = "not_applicable" | "pending" | "completed" | "skipped" | "failed";
export type MessageKind = "chat" | "delegation";
export type MessageResultStatus = "completed" | "failed" | "partial";
export type RuntimePermissionMode = "dev-full-access" | "workspace-write" | "read-only";
export const DEFAULT_RUNTIME_PERMISSION_MODE: RuntimePermissionMode = "workspace-write";
export const RUNTIME_RESOURCE_GRANT_KINDS = ["directory", "network_domain", "service_account", "device", "mcp_server"] as const;
export type RuntimeResourceGrantKind = (typeof RUNTIME_RESOURCE_GRANT_KINDS)[number];
export const RUNTIME_RESOURCE_GRANT_SCOPES = ["read", "write", "connect", "use"] as const;
export type RuntimeResourceGrantScope = (typeof RUNTIME_RESOURCE_GRANT_SCOPES)[number];
export interface RuntimeResourceGrant {
  kind: RuntimeResourceGrantKind;
  label?: string;
  target: string;
  scopes: RuntimeResourceGrantScope[];
}
export type RuntimeReadOnlyEnforcement = "native-hard" | "os-sandbox" | "unsupported";
export interface EffectiveRuntimeAccessPolicy {
  mode: RuntimePermissionMode;
  workspace: "read" | "write" | "host";
  escalation: "deny" | "review" | "auto";
  readOnlyEnforcement: RuntimeReadOnlyEnforcement;
}

const RUNTIME_READ_ONLY_ENFORCEMENT: Readonly<Record<RuntimeId, RuntimeReadOnlyEnforcement>> = {
  claude: "unsupported",
  codex: "native-hard",
  kimi: "unsupported",
  copilot: "unsupported",
  cursor: "unsupported",
  gemini: "unsupported",
  opencode: "unsupported",
  antigravity: "unsupported"
};

export function runtimeReadOnlyEnforcement(runtime: RuntimeId): RuntimeReadOnlyEnforcement {
  return RUNTIME_READ_ONLY_ENFORCEMENT[runtime];
}

export function resolveRuntimeAccessPolicy(
  runtime: RuntimeId,
  mode: RuntimePermissionMode = DEFAULT_RUNTIME_PERMISSION_MODE
): EffectiveRuntimeAccessPolicy {
  if (mode === "read-only") {
    return { mode, workspace: "read", escalation: "deny", readOnlyEnforcement: runtimeReadOnlyEnforcement(runtime) };
  }
  if (mode === "dev-full-access") {
    return { mode, workspace: "host", escalation: "auto", readOnlyEnforcement: runtimeReadOnlyEnforcement(runtime) };
  }
  return { mode, workspace: "write", escalation: "review", readOnlyEnforcement: runtimeReadOnlyEnforcement(runtime) };
}

export function runtimePermissionModeSupported(runtime: RuntimeId, mode: RuntimePermissionMode): boolean {
  return mode !== "read-only" || runtimeReadOnlyEnforcement(runtime) !== "unsupported";
}

export function runtimeResourceGrantsConflictWithPermissionMode(
  mode: RuntimePermissionMode,
  grants: readonly RuntimeResourceGrant[] | null | undefined
): boolean {
  // Runtime Access governs local mutation; Tyr capability scopes remain an independent authorization plane.
  return mode === "read-only" && Boolean(grants?.some((grant) => grant.kind === "directory" && grant.scopes.includes("write")));
}
export type RuntimeApprovalKind = "command" | "file_change" | "permissions" | "mcp_tool" | "external_tool";
export type RuntimeApprovalStatus = "pending" | "approved" | "rejected" | "custom";
export type RuntimeApprovalDecision = "approve" | "reject" | "custom";
export type DeviceKind = "mobile" | "iot";
export type DevicePlatform = "android" | "ios" | "web" | "embedded";
export type DeviceStatus = "online" | "offline";
export type DeviceCapabilityId = string;
export type DeviceCapability = DeviceCapabilityId;
export type DeviceCapabilityRiskLevel = "low" | "medium" | "high";
export interface DeviceCapabilityDescriptor {
  id: DeviceCapabilityId;
  label: string;
  description?: string;
  riskLevel: DeviceCapabilityRiskLevel;
  inputSchema?: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
}
export type DevicePermissionState = "available" | "os_prompt" | "granted" | "denied" | "limited" | "unsupported";
export type DeviceGrantScope = "once" | "time_boxed" | "task";
export type DeviceGrantStatus = "active" | "revoked" | "expired";
export type DeviceCommandStatus = "queued" | "sent" | "running" | "succeeded" | "denied" | "failed" | "expired";
export type MobileAppBindingStatus = "active" | "revoked";

export const BUILT_IN_DEVICE_CAPABILITY_DESCRIPTORS: DeviceCapabilityDescriptor[] = [
  {
    id: "screen.capture_app_snapshot",
    label: "App screen",
    description: "Capture the current app viewport.",
    riskLevel: "medium"
  },
  {
    id: "location.get_coarse_once",
    label: "Coarse location",
    description: "Read one approximate location sample.",
    riskLevel: "medium"
  }
];

export const SUPPORTED_MESSAGE_REACTIONS = ["👍", "✅", "👀", "❤️", "😂", "🎉"] as const;
export type MessageReactionEmoji = (typeof SUPPORTED_MESSAGE_REACTIONS)[number];

export const AGENT_CAPABILITIES = [
  "inbox:receive",
  "server:read",
  "thread:unfollow",
  "message:read",
  "message:send",
  "attachment:upload",
  "attachment:view",
  "task:read",
  "task:write",
  "action:prepare"
] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export const AGENT_PLANNED_CAPABILITIES = [
  "action:prepare"
] as const satisfies readonly AgentCapability[];

export const AGENT_ACTIVE_CAPABILITIES = [
  "inbox:receive",
  "server:read",
  "thread:unfollow",
  "message:read",
  "message:send",
  "attachment:upload",
  "attachment:view"
] as const satisfies readonly AgentCapability[];

export interface AgentScopes {
  agentId: string;
  granted: AgentCapability[];
  mode: "default" | "custom";
  revision: number;
  updatedAt: string;
}

export interface RuntimeModel {
  id: string;
  label: string;
  provider?: string;
  verified?: boolean | string;
}

export interface RuntimeReport {
  runtime: RuntimeId;
  displayName: string;
  binary: string;
  version?: string;
  status: RuntimeStatus;
  models?: RuntimeModel[];
  defaultModel?: string;
  command?: string;
  reason?: string;
  checkedAt?: string;
  // Runtime health is diagnostic state from daemon probing; it must not create new Agent-facing operations.
  installStatus?: RuntimeInstallStatus;
  authStatus?: RuntimeAuthStatus;
  cliStatus?: RuntimeCapabilityStatus;
  mcpStatus?: RuntimeCapabilityStatus;
  mcpToolSurface?: RuntimeMcpToolSurface;
  readOnlyEnforcement?: RuntimeReadOnlyEnforcement;
  hiddenMcpTools?: string[];
  diagnostics?: Array<{
    code: string;
    message: string;
    severity: "info" | "warning" | "error";
  }>;
}

export type RuntimeAccessConfigurationError =
  | "runtime_read_only_enforcement_unavailable"
  | "runtime_read_only_unsupported"
  | "incompatible_runtime_resource_grant";

export function runtimeAccessConfigurationError(
  runtime: RuntimeId | null,
  permissionMode: RuntimePermissionMode | undefined,
  grants: readonly RuntimeResourceGrant[] | null | undefined,
  runtimeReport?: Pick<RuntimeReport, "runtime" | "status" | "readOnlyEnforcement"> | null
): RuntimeAccessConfigurationError | null {
  const mode = permissionMode ?? DEFAULT_RUNTIME_PERMISSION_MODE;
  if (runtime && !runtimePermissionModeSupported(runtime, mode)) return "runtime_read_only_unsupported";
  if (runtimeResourceGrantsConflictWithPermissionMode(mode, grants)) return "incompatible_runtime_resource_grant";
  if (mode !== "read-only" || !runtime) return null;
  if (!runtimeReport || runtimeReport.runtime !== runtime || runtimeReport.status !== "available" || !runtimeReport.readOnlyEnforcement) {
    return "runtime_read_only_enforcement_unavailable";
  }
  if (runtimeReport.readOnlyEnforcement === "unsupported") return "runtime_read_only_unsupported";
  return null;
}

export function runtimePermissionModeAvailable(
  runtime: RuntimeId,
  mode: RuntimePermissionMode,
  runtimeReport?: Pick<RuntimeReport, "runtime" | "status" | "readOnlyEnforcement"> | null
): boolean {
  return runtimeAccessConfigurationError(runtime, mode, [], runtimeReport) === null;
}

export interface UserRecord {
  id: string;
  name: string;
  displayName: string;
  email?: string;
  description?: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  passwordSetupRequired?: boolean;
  preferredLanguage?: string | null;
  serverRole?: "owner" | "member" | "guest";
  serverJoinedAt?: string;
  membershipVisible?: boolean;
  createdAt: string;
}

export type HelpdeskSignupIntentStatus = "pending" | "completed" | "expired";

export interface HelpdeskSignupIntentRecord {
  id: string;
  email: string;
  source: "email" | "mock_email";
  subject?: string | null;
  status: HelpdeskSignupIntentStatus;
  expiresAt: string;
  completedAt?: string | null;
  createdUserId?: string | null;
  createdAt: string;
  /** Validated local invitation destination, retained across email/browser changes. */
  returnPath?: string | null;
}

export interface HelpdeskSignupPublicPayload {
  status: HelpdeskSignupIntentStatus | "invalid";
  email?: string;
  expiresAt?: string;
  returnPath?: string;
}

export type HelpdeskPasswordRecoveryIntentStatus = "pending" | "completed" | "expired";

export interface HelpdeskPasswordRecoveryIntentRecord {
  id: string;
  email: string;
  userId: string;
  source: "email" | "mock_email";
  subject?: string | null;
  status: HelpdeskPasswordRecoveryIntentStatus;
  expiresAt: string;
  completedAt?: string | null;
  createdAt: string;
}

export interface HelpdeskPasswordRecoveryPublicPayload {
  status: HelpdeskPasswordRecoveryIntentStatus | "invalid";
  email?: string;
  expiresAt?: string;
}

export interface HelpdeskSignupRequestPublicPayload {
  status: "sent" | "denied" | "ignored" | "existing_user";
  email?: string;
  confirmationUrl?: string;
  replySubject: string;
  replyText: string;
}

export type CommunicationAgentPendingActionStatus = "pending" | "confirmed" | "cancelled" | "expired" | "superseded";

export interface CommunicationAgentPendingActionRecord {
  id: string;
  serverId: string;
  userId: string;
  assistantAgentId: string;
  channelId: string;
  sourceMessageId?: string | null;
  suggestionMessageId?: string | null;
  targetAgentId: string;
  instruction: string;
  status: CommunicationAgentPendingActionStatus;
  expiresAt: string;
  createdAt: string;
  resolvedAt?: string | null;
}

export type CommunicationAgentManagementSource = "web" | "telegram" | "email" | "mcp";

export type CommunicationAgentProgressPhase =
  | "understanding"
  | "running_action"
  | "preparing_response"
  | "completed"
  | "needs_input"
  | "failed";

export interface CommunicationAgentProgressRecord {
  operationId: string;
  sourceMessageId: string;
  channelId: string;
  conversationId?: string;
  assistantAgentId: string;
  /** 仅公开稳定入口类型，不携带 MCP client、grant 或外部账号标识。 */
  source: CommunicationAgentManagementSource;
  phase: CommunicationAgentProgressPhase;
  label: string;
  startedAt: string;
  updatedAt: string;
}

export const COMMUNICATION_AGENT_MANAGEMENT_ACTIONS = [...TYR_ASSISTANT_REGISTERED_MANAGEMENT_ACTIONS, "confirm_workspace_bridge"] as const;
export type CommunicationAgentManagementAction = TyrAssistantManagementAction | "confirm_workspace_bridge";
export const AGENT_EDITABLE_FIELDS = ["name", "description", "model", "permissionMode"] as const;
export type AgentEditableField = (typeof AGENT_EDITABLE_FIELDS)[number];
export type CommunicationAgentManagementDraftStage =
  | "collecting_name"
  | "collecting_computer_name"
  | "collecting_machine"
  | "collecting_runtime"
  | "collecting_model"
  | "collecting_agent"
  | "collecting_update_field"
  | "collecting_update_value"
  | "awaiting_confirmation";
export type CommunicationAgentManagementDraftStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "superseded"
  | "completed"
  | "failed";

export interface CommunicationAgentManagementChoice {
  id: string;
  label: string;
  value: string;
}

export interface CommunicationAgentManagementParams {
  toolCallId?: string;
  name?: string;
  machineReference?: string;
  runtimeReference?: string;
  modelReference?: string;
  machineId?: string;
  machineName?: string;
  runtime?: RuntimeId;
  model?: string;
  targetAgentId?: string;
  targetBridgeIntentId?: string;
  targetAgentIds?: string[];
  targetSelectedFromChoice?: boolean;
  updateField?: AgentEditableField;
  updateValue?: string;
  foreignRuntimeReference?: string;
  description?: string | null;
  permissionMode?: RuntimePermissionMode;
}

export interface CommunicationAgentManagementDraftRecord {
  id: string;
  operationId: string;
  serverId: string;
  userId: string;
  assistantAgentId: string;
  channelId: string;
  source: CommunicationAgentManagementSource;
  sourceConversationKey: string;
  sourceMessageId: string;
  sourceEventKey: string;
  action: CommunicationAgentManagementAction;
  stage: CommunicationAgentManagementDraftStage;
  params: CommunicationAgentManagementParams;
  choices: CommunicationAgentManagementChoice[];
  status: CommunicationAgentManagementDraftStatus;
  replyText?: string | null;
  errorCode?: string | null;
  expiresAt: string;
  createdAt: string;
  confirmedAt?: string | null;
  resolvedAt?: string | null;
}

export interface ServerInviteRecord {
  id: string;
  invitedEmail: string;
  invitedByUserId: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
}

export interface IncomingServerInviteRecord extends ServerInviteRecord {
  serverId: string;
  serverName: string;
  invitedByName: string;
}

export type WorkspaceBridgeStatus = "pending" | "active" | "revoked";
export type WorkspaceBridgeDirection = "one_way" | "bidirectional";
export type CrossWorkspaceMessageInitiator = "human" | "agent";
export type CrossWorkspaceMessageOutcome = "pending" | "delivered" | "failed";
export type CrossWorkspaceMessageResponseKind = "ack" | "progress" | "question" | "action_request" | "answer" | "instruction" | "continue" | "final" | "error";
export type CommunicationEvidenceValue = string | number | boolean | null;

/** Business-neutral facts. Authentication proves their publisher, not their business truth. */
export interface CommunicationEvidenceFact {
  key: string;
  value: CommunicationEvidenceValue;
}

/** A selection names existing server evidence; it cannot supply replacement values. */
export interface CommunicationEvidenceSelection {
  receiptId: string;
  keys?: string[];
  excerpt?: string;
}

export interface CommunicationEvidenceRecord {
  /** Opaque, hop-scoped receipt. It never grants access to an underlying private record. */
  receiptId: string;
  facts: CommunicationEvidenceFact[];
  excerpt?: string;
  provenance: {
    /** local_worker is private TYR context only; Bridge publication uses the other two kinds. */
    kind: "local_worker" | "peer_tyr" | "reviewed_downstream";
  };
}
export type WorkspaceBridgeRequestState =
  | "queued"
  | "delivered"
  | "running"
  | "blocked_on_peer_approval"
  | "needs_attention"
  | "completed"
  | "failed";

export interface WorkspaceBridgePeerSummary {
  id: string;
  name: string;
  ownerUserId: string;
  ownerDisplayName: string;
  onboardingAgentId: string | null;
}

export interface WorkspaceBridgeRecord {
  id: string;
  workspaceAId: string;
  workspaceBId: string;
  status: WorkspaceBridgeStatus;
  direction: WorkspaceBridgeDirection;
  scope: string;
  permissions: string[];
  invitedByUserId: string;
  invitedByDisplayName: string;
  approvedByAUserId: string | null;
  approvedByBUserId: string | null;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  lastActivityAt: string | null;
  peerWorkspace?: WorkspaceBridgePeerSummary;
}

export interface WorkspaceBridgeConnectionIntent {
  id: string;
  status: "pending" | "claimed" | "active" | "cancelled" | "expired";
  sourceWorkspaceId: string;
  sourceWorkspaceName: string;
  invitedByUserId: string;
  invitedByDisplayName: string;
  targetWorkspaceId: string | null;
  targetWorkspaceName: string | null;
  targetOwnerDisplayName: string | null;
  bridgeId: string | null;
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
  confirmedAt: string | null;
  /** Directed email invitations activate on recipient acceptance. Absent for legacy share links. */
  invitationKind?: "email";
  deliveryStatus?: "pending" | "sending" | "sent" | "failed" | "stopped";
}

export interface WorkspaceBridgeConnectionLink extends WorkspaceBridgeConnectionIntent {
  url: string;
}

export interface CrossWorkspaceMessageRecord {
  id: string;
  bridgeId: string;
  conversationId: string | null;
  /** Client-generated idempotency key for a human Bridge request. */
  clientRequestId: string | null;
  /** Retry 是关联原始 Human 请求的一次新且不可变的尝试。 */
  retryOfMessageId: string | null;
  /** Reply phase separates receipt/routing acknowledgements from a terminal answer. */
  responseKind: CrossWorkspaceMessageResponseKind | null;
  /** Stable IPC/tool event ID, unique within the original Bridge request; intermediate replies never claim its terminal slot. */
  interactionEventId?: string | null;
  /** 每个请求只能由一条 final/error 回复占用终态槽位。 */
  terminalRequestId: string | null;
  /** Explicitly closed by a later final response on this same Bridge and for the same requester. */
  resolvedByTerminalId?: string | null;
  /** Stable source conversation key lets one MCP operation reuse its isolated Bridge conversation. */
  originConversationKey: string | null;
  /** Optional visible TYR source used to publish a deferred peer result back to the caller. */
  originChannelId: string | null;
  originConversationId: string | null;
  originMessageId: string | null;
  /** 服务端认证的调用入口，仅用于把延迟终态返回原通道。 */
  originSource?: CommunicationAgentManagementSource | null;
  /** 服务端生成的 Telegram/Email 不透明回传地址，模型与对端 Workspace 均不可控制。 */
  originExternalRef?: string | null;
  originExternalDeliveredAt?: string | null;
  /** Explicit TYR waiter; null means the Bridge result is presentation only. */
  awaitingAgentId?: string | null;
  continuationState?: "registered" | "pending" | "running" | "completed" | "interrupted" | null;
  continuationReplyMessageId?: string | null;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  /** Bridge 消息始终保留真实 Human 发起者，不能用目标 Workspace Owner 冒充发送者。 */
  senderUserId?: string | null;
  senderUserName?: string | null;
  senderUserDisplayName?: string | null;
  senderUserAvatarUrl?: string | null;
  /** 来源/目标 TYR 分别使用哪个账号的完整能力执行这一跳。 */
  sourceCapabilityUserId?: string | null;
  targetCapabilityUserId?: string | null;
  /** Chaining 全程保留同一原始 Human，并显式记录父请求和跳数。 */
  originalSenderUserId?: string | null;
  traceId?: string | null;
  parentBridgeRequestId?: string | null;
  hopCount?: number;
  /** Bridge-scoped copies only; these IDs never grant access to the source channel's private library. */
  attachmentIds?: string[];
  attachments?: Array<Pick<AttachmentRecord, "id" | "filename" | "mimeType" | "sizeBytes">>;
  /** 实际产出终态内容的目标 Workspace Agent；TYR 只负责跨 Workspace 转发。 */
  sourceAgentNames?: string[];
  senderCommsAgentId: string;
  receiverCommsAgentId: string;
  initiatedBy: CrossWorkspaceMessageInitiator;
  content: string;
  /** Only explicitly selected facts/excerpts published by the sending TYR. */
  evidence?: CommunicationEvidenceRecord[];
  outcome: CrossWorkspaceMessageOutcome;
  localMessageId: string | null;
  peerMessageId: string | null;
  replyToMessageId: string | null;
  createdAt: string;
  /** Latest lifecycle transition; visual playback must not age a delivered state from the original submit time. */
  updatedAt?: string;
}

export interface WorkspaceBridgeRequestStatusPayload {
  bridgeRequestId: string;
  bridgeId: string;
  conversationId: string;
  state: WorkspaceBridgeRequestState;
  peerWorkspaceName: string;
  /** Request-scoped operational facts only; never raw worker output or peer topology. */
  progress?: {
    stage: "queued" | "delivered" | "running" | "waiting_approval" | "reviewing_result" | "needs_attention" | "completed" | "failed";
    summary: string;
    diagnosticId: string;
    lastEventAt: string;
    events: Array<{ kind: string; label: string; at: string }>;
  };
  acknowledgement?: string;
  /** Nonterminal events remain attached to this request and never replace final/error. */
  interactions?: Array<{
    id: string;
    kind: Extract<CrossWorkspaceMessageResponseKind, "progress" | "question" | "action_request" | "answer" | "instruction" | "continue">;
    content: string;
    createdAt: string;
    evidence?: CommunicationEvidenceRecord[];
  }>;
  response?: string;
  responseEvidence?: CommunicationEvidenceRecord[];
  resolution?: { kind: "followup"; requestId: string; terminalId: string };
  error?: {
    code: string;
    message: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceBridgeMessagePageInfo {
  limit: number;
  hasMoreBefore: boolean;
  oldestCreatedAt: string | null;
  newestCreatedAt: string | null;
}

/** Owner-only local audit projection; never part of the shared Bridge transcript. */
export interface WorkspaceBridgeLocalExecutionLog {
  requestId: string;
  diagnosticId: string;
  executions: Array<{
    id: string;
    agentName: string;
    status: RuntimeExecutionRecord["status"];
    createdAt: string;
    completedAt?: string;
    instructionsRevision?: number;
  }>;
  entries: Array<{
    id: string;
    kind: string;
    title: string;
    at: string;
    executionId?: string;
    content?: string;
    data?: unknown;
  }>;
  pageInfo: { offset: number; limit: number; total: number; hasMore: boolean };
}

export interface WorkspaceBridgeMessagesPayload {
  messages: CrossWorkspaceMessageRecord[];
  pageInfo: WorkspaceBridgeMessagePageInfo;
}

export interface WorkspaceBridgeConversationRecord extends ConversationRecord {
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  direction: "outgoing" | "incoming";
  // Incoming conversations are shared for transparency, but only their source side can continue or manage them.
  writable: boolean;
}

export interface WorkspaceBridgeTopologySnapshot {
  // bridgeId/bridge 描述当前 Workspace 与该对端共同拥有的直接连接。
  bridgeId: string;
  bridge?: WorkspaceBridgeRecord;
  parentWorkspaceId?: string;
  distance?: number;
  bridgePath?: string[];
  workspace: WorkspaceBridgePeerSummary;
  assistant: AgentRecord | null;
  machines: MachineRecord[];
  agents: AgentRecord[];
  devices?: DeviceRecord[];
}

export interface WorkspaceBridgeTopologyEdge {
  bridgeId: string;
  bridge: WorkspaceBridgeRecord;
  workspaceAId: string;
  workspaceBId: string;
}

export interface ServerRecord {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  onboardingAgentId: string | null;
  plan: "free" | "hobby" | "pro" | "enterprise";
  planDowngradedAt: string | null;
  role: "owner" | "member" | "guest";
  createdAt: string;
}

/** Workspace Owner 维护的 TYR 路由规则；所有消息入口共用同一份服务端版本。 */
export interface WorkspaceRoutingInstructionsRecord {
  serverId: string;
  instructions: string;
  revision: number;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export const MAX_WORKSPACE_ROUTING_INSTRUCTIONS_LENGTH = 20_000;

export type McpPersonalAccessTokenScope =
  | "tyr:read"
  | "tyr:manage"
  | "tyr:bridge:read"
  | "tyr:bridge:send";
export type McpPersonalAccessTokenExpirationDays = 30 | 90 | 365;

export interface McpPersonalAccessTokenRecord {
  id: string;
  name: string;
  userId: string;
  serverId: string;
  tokenPrefix: string;
  scopes: McpPersonalAccessTokenScope[];
  resource: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface McpPersonalAccessTokenSecret {
  token: string;
  record: McpPersonalAccessTokenRecord;
}

export interface SidebarOrderSettings {
  channelOrder: string[];
  agentOrder: string[];
  dmOrder: string[];
  channelSortMode: "manual";
  dmSortMode: "manual";
  pinnedSortMode: "manual";
  pinnedChannelIds: string[];
  pinnedAgentIds: string[];
  pinnedOrder: string[];
  hiddenDmIds: string[];
  channelPanelTabOrder: string[];
  agentPanelTabOrder: string[];
}

export interface AgentCreatorSummary {
  type: "human" | "agent";
  id: string;
  name: string;
  displayName: string;
  avatarUrl: string | null;
  gravatarHash: string | null;
}

export interface AgentListItem {
  id: string;
  serverId: string;
  kind: AgentKind;
  name: string;
  displayName: string;
  avatarUrl: string | null;
  description: string | null;
  status: "active" | "inactive";
  sessionId: string | null;
  model: string | null;
  runtime: RuntimeId | null;
  reasoningEffort: AgentRecord["reasoningEffort"] | null;
  executionMode: "byoc" | "server-hosted";
  creatorType: "user" | "agent" | "system";
  creatorId: string;
  machineId: string | null;
  createdAt: string;
  updatedAt: string;
  activity: "online" | "thinking" | "offline" | "error";
  activityDetail: string;
  creator: AgentCreatorSummary | null;
}

export interface MachineListItem {
  id: string;
  serverId: string;
  userId: string;
  name: string;
  apiKeyPrefix: string;
  runtimes: RuntimeId[];
  hostname: string;
  os: string;
  daemonVersion: string;
  latestDaemonVersion: string;
  runtimeMarker?: string;
  runtimeSha?: string;
  runtimeMarkerMtime?: string;
  latestRuntimeSha?: string;
  // True only when server can prove the connected daemon bundle differs from the current release bundle.
  runtimeUpdateAvailable?: boolean;
  lastHeartbeat: string;
  createdAt: string;
  status: MachineStatus;
}

export interface MachineListResponse {
  latestDaemonVersion: string;
  latestRuntimeSha?: string;
  machines: MachineListItem[];
}

export const RESOURCE_GRANT_SCOPES = ["view", "message", "task"] as const;
export type ResourceGrantScope = (typeof RESOURCE_GRANT_SCOPES)[number];
export type ResourceType = "machine" | "agent";

export interface ResourceAccessSummary {
  shared: boolean;
  scopes: string[];
  /**
   * An active Workspace Bridge grants the source Workspace the same operational
   * surface as the destination TYR Owner. The real Human identity is
   * still carried separately for provenance and audit.
   */
  bridge?: WorkspaceBridgeOperationalAccess;
}

export interface WorkspaceBridgeOperationalAccess {
  fullAccess: true;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  capabilityUserId: string;
  /** Topology 资源访问只允许直接连接，因此这里只包含当前可见的 Bridge。 */
  bridgePath: string[];
  /** Topology 资源访问固定为一跳直接 Bridge。 */
  distance: number;
}

export interface ResourceGrantRecord {
  id: string;
  resourceType: ResourceType;
  resourceId: string;
  granteeUserId: string;
  scopes: ResourceGrantScope[];
  createdByUserId: string;
  createdAt: string;
  revokedAt: string | null;
  revokedByUserId?: string | null;
}

export interface ResourceGrantSummary {
  id: string;
  resourceType: ResourceType;
  resourceId: string;
  granteeUserId: string;
  granteeName: string;
  granteeDisplayName: string;
  granteeEmail: string | null;
  scopes: ResourceGrantScope[];
  createdByUserId: string;
  createdAt: string;
}

export interface AuditEventRecord {
  id: string;
  kind: string;
  actorType: "user" | "agent" | "system" | "platform_operator";
  actorId: string | null;
  resourceType: ResourceType | "user" | "channel" | "message" | "task" | "server" | "workspace_bridge" | "workspace_shared_file" | "device" | "device_grant" | "device_command" | "mobile_app_binding" | "governance_policy_config" | "mcp_personal_access_token" | "deployment";
  resourceId: string | null;
  serverId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export const PLATFORM_OPERATOR_SCOPES = [
  "workspace:view",
  "agent:manage",
  "heartbeat:manage",
  "routing_instructions:manage",
  "shared_files:manage",
  "audit:read"
] as const;

export type PlatformOperatorScope = typeof PLATFORM_OPERATOR_SCOPES[number];

export interface PlatformOperatorRecord {
  id: string;
  login: string;
  displayName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformOperatorWorkspaceRecord {
  serverId: string;
  serverName: string;
  createdAt: string;
}

/** Legacy persisted scope row; Global Operator authorization no longer depends on these grants. */
export interface PlatformOperatorWorkspaceGrantRecord {
  operatorId: string;
  serverId: string;
  serverName: string;
  scopes: PlatformOperatorScope[];
  createdAt: string;
  updatedAt: string;
}

export interface PlatformOperatorSessionPayload {
  operator: PlatformOperatorRecord;
  workspaces: PlatformOperatorWorkspaceRecord[];
  expiresAt?: string;
}

export type PlatformOperatorSessionStatusPayload =
  | { authenticated: false }
  | ({ authenticated: true } & PlatformOperatorSessionPayload);

export type PlatformOperatorAgentView = Omit<AgentRecord, "authToken">;
export type PlatformOperatorMachineView = Omit<MachineRecord, "apiKey" | "connectorToken"> & {
  runtimes: RuntimeReport[];
};
export type PlatformOperatorDeviceView = Omit<DeviceRecord, "deviceToken">;

export interface PlatformOperatorWorkspaceViewPayload {
  workspace: PlatformOperatorWorkspaceRecord;
  agents: PlatformOperatorAgentView[];
  machines: PlatformOperatorMachineView[];
  devices: PlatformOperatorDeviceView[];
  bridges: WorkspaceBridgeRecord[];
  interactions: CrossWorkspaceMessageRecord[];
  peerWorkspaceTopologies: WorkspaceBridgeTopologySnapshot[];
  workspaceBridgeTopologyEdges: WorkspaceBridgeTopologyEdge[];
}

export type MarlowGreenMapSite = "dorian" | "mira" | "tomas" | "marketplace" | "sable" | "bank";

/** City overview exposes operational counts only; it never carries conversation content or credentials. */
export interface PlatformOperatorCityOverviewPayload {
  observedAt: string;
  workspaces: Array<PlatformOperatorWorkspaceRecord & {
    /** Display-only site binding, resolved from the provisioned owner, never Workspace names. */
    mapSite?: MarlowGreenMapSite;
    devicesOnline: number;
    devicesTotal: number;
    agentsOnline: number;
    agentsTotal: number;
    activeExecutions: number;
    waitingApprovals: number;
    lastActivityAt: string | null;
  }>;
  bridges: Array<{ id: string; workspaceAId: string; workspaceBId: string; direction: WorkspaceBridgeDirection }>;
}

export type TyrHeartbeatIntervalUnit = "minute" | "hour";
export type TyrHeartbeatRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface TyrHeartbeatRecord {
  id: string;
  serverId: string;
  tyrAgentId: string;
  title: string;
  instruction: string;
  intervalUnit: TyrHeartbeatIntervalUnit;
  intervalValue: number;
  enabled: boolean;
  nextRunAt: string;
  createdByUserId?: string | null;
  createdByOperatorId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TyrHeartbeatRunRecord {
  id: string;
  heartbeatId: string;
  serverId: string;
  scheduledFor: string;
  status: TyrHeartbeatRunStatus;
  sourceMessageId?: string | null;
  executionIds: string[];
  selectedAgentId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TyrHeartbeatListPayload {
  heartbeats: TyrHeartbeatRecord[];
  runs: TyrHeartbeatRunRecord[];
}

export type WorkspaceSharedFilePermission = "read-only" | "read-write";

export interface WorkspaceSharedFileAssignmentRecord {
  fileId: string;
  agentId: string;
  permission: WorkspaceSharedFilePermission;
  createdByUserId?: string | null;
  createdByOperatorId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSharedFileRecord {
  id: string;
  serverId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  /** Immutable upload baseline. Agents only ever receive and modify the working fields above. */
  originalName: string;
  originalMimeType: string;
  originalSizeBytes: number;
  originalSha256: string;
  hasChanges: boolean;
  version: number;
  createdByUserId?: string | null;
  createdByOperatorId?: string | null;
  createdAt: string;
  updatedAt: string;
  assignments: WorkspaceSharedFileAssignmentRecord[];
}

export interface WorkspaceSharedFileListPayload {
  files: WorkspaceSharedFileRecord[];
}

/** Server-to-daemon canonical file snapshot; content is base64 so JSON and binary files share one protocol. */
export interface AgentSharedFileSnapshot {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  version: number;
  permission: WorkspaceSharedFilePermission;
  contentBase64: string;
}

export interface DeviceRecord {
  id: string;
  serverId: string;
  ownerUserId: string;
  displayName: string;
  deviceKind: DeviceKind;
  platform: DevicePlatform;
  appVersion: string;
  status: DeviceStatus;
  capabilities: DeviceCapability[];
  capabilityDescriptors: DeviceCapabilityDescriptor[];
  permissionStates: Partial<Record<DeviceCapability, DevicePermissionState>>;
  deviceToken?: string;
  createdAt: string;
  lastSeenAt: string;
  deletedAt?: string;
  bridgeAccess?: WorkspaceBridgeOperationalAccess;
}

export function isLegacyMockDevice(device: Pick<DeviceRecord, "appVersion">): boolean {
  // 旧 mock phone 只用于早期演示；客户可见和 Agent 可选设备列表必须只暴露真实设备。
  return device.appVersion === "0.1.0-mock";
}

export interface DevicePairingTokenRecord {
  id: string;
  serverId: string;
  createdByUserId: string;
  displayName?: string;
  pinnedAgentId?: string;
  pairingToken: string;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
}

export interface DeviceGrantRecord {
  id: string;
  serverId: string;
  agentId: string;
  deviceId: string;
  capabilities: DeviceCapability[];
  scope: DeviceGrantScope;
  expiresAt?: string;
  status: DeviceGrantStatus;
  createdByUserId: string;
  createdAt: string;
  revokedAt?: string;
}

export interface DeviceCommandRecord {
  id: string;
  serverId: string;
  agentId: string;
  deviceId: string;
  grantId?: string;
  capability: DeviceCapability;
  params: Record<string, unknown>;
  status: DeviceCommandStatus;
  requestedByMessageId?: string;
  channelId?: string;
  taskId?: string;
  reason?: string;
  artifactIds?: string[];
  data?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  expiresAt: string;
  createdAt: string;
  completedAt?: string;
}

export interface DeviceCommandResult {
  status: Extract<DeviceCommandStatus, "succeeded" | "denied" | "failed" | "expired">;
  artifactIds?: string[];
  data?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface MobileAppBindingRecord {
  id: string;
  serverId: string;
  userId: string;
  deviceId: string;
  pinnedAgentId?: string;
  pinnedChannelId?: string;
  status: MobileAppBindingStatus;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
}

export interface MessageDeviceRef {
  deviceId: string;
  capability: DeviceCapability;
}

export type MachineOnboardingIntentStatus = "pending" | "consumed" | "revoked" | "expired";

export interface MachineOnboardingIntentRecord {
  id: string;
  serverId: string;
  machineId: string;
  requestedByUserId: string;
  requestedByAgentId?: string | null;
  status: MachineOnboardingIntentStatus;
  expiresAt: string;
  consumedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface MachineOnboardingLinkResponse {
  machine: MachineRecord;
  intent: MachineOnboardingIntentRecord;
  onboardingUrl: string;
  installCommand: string;
  windowsInstallCommand: string;
  expiresInSeconds: number;
}

export interface MachineOnboardingPublicPayload {
  status: MachineOnboardingIntentStatus | "invalid";
  serverName?: string;
  machineName?: string;
  expiresAt?: string;
  installCommand?: string;
  windowsInstallCommand?: string;
}

export interface MachineOnboardingConsumePayload {
  machineId: string;
  machineName: string;
  serverUrl: string;
  credentialKind: "apiKey";
  credentialFlag: "--api-key";
  credentialValue: string;
}

export interface MachineRecord {
  id: string;
  serverId?: string;
  ownerUserId: string;
  name: string;
  hostname: string;
  os: string;
  daemonVersion: string;
  latestDaemonVersion?: string;
  runtimeMarker?: string;
  runtimeSha?: string;
  runtimeMarkerMtime?: string;
  latestRuntimeSha?: string;
  // True only when server can prove the connected daemon bundle differs from the current release bundle.
  runtimeUpdateAvailable?: boolean;
  status: MachineStatus;
  apiKey: string;
  connectorToken?: string;
  connectorTokenIssuedAt?: string;
  connectorTokenRevokedAt?: string | null;
  apiKeyUsedAt?: string | null;
  installationId?: string;
  hostFingerprint?: string;
  deletedAt?: string | null;
  createdAt: string;
  lastSeenAt: string;
  access?: ResourceAccessSummary;
  bridgeAccess?: WorkspaceBridgeOperationalAccess;
}

export interface AgentHostMachineSummary {
  id: string;
  ownerUserId: string;
  name: string;
  hostname: string;
  os: string;
  daemonVersion: string;
  runtimeMarker?: string;
  runtimeSha?: string;
  runtimeMarkerMtime?: string;
  status: MachineStatus;
  lastSeenAt: string;
}

export interface UpdateAgentConfigurationInput {
  name?: string;
  displayName?: string;
  description?: string | null;
  model?: string | null;
  permissionMode?: RuntimePermissionMode;
}

export interface AgentRecord {
  id: string;
  serverId?: string;
  kind?: AgentKind;
  ownerUserId: string;
  /** Ownership remains local; creation provenance can point to the original user behind a Bridge request. */
  createdByUserId?: string | null;
  creationBridgeRequestId?: string | null;
  creationTraceId?: string | null;
  machineId: string | null;
  name: string;
  displayName: string;
  description?: string;
  /** 服务端 Agent Profile Prompt/身份配置的当前版本；名称或描述变更时递增。 */
  profileRevision?: number;
  /** daemon 已确认装载进 Runtime Developer Instructions 的最新 Profile 版本。 */
  profileAppliedRevision?: number;
  /** 仅记录当前 Profile 版本应用失败；旧版本迟到失败不得覆盖新状态。 */
  profileApplyError?: string;
  avatarUrl?: string;
  runtime: RuntimeId | null;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  permissionMode?: RuntimePermissionMode;
  runtimeResourceGrants?: RuntimeResourceGrant[];
  status: AgentStatus;
  /** Persistent operator/user intent; observed status may temporarily be offline during reconnects. */
  desiredRuntimeState?: AgentDesiredRuntimeState;
  lastError?: string;
  workspacePath?: string;
  sessionId?: string;
  launchId?: string;
  authToken: string;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  access?: ResourceAccessSummary;
  machineMissing?: boolean;
  hostMachine?: AgentHostMachineSummary;
  communicationEmailAddress?: string | null;
  bridgeAccess?: WorkspaceBridgeOperationalAccess;
}

export interface ChannelRecord {
  id: string;
  serverId?: string;
  type: ChannelType;
  name: string;
  displayName: string;
  activeConversationId?: string | null;
  dmIdentity?: DmIdentity | null;
  dmPeerAgentId?: string;
  dmPeerAgentName?: string;
  dmPeerAgentDisplayName?: string;
  visibility: ChannelVisibility;
  description?: string;
  parentChannelId?: string;
  parentMessageId?: string;
  archivedAt?: string | null;
  archivedByUserId?: string | null;
  createdAt: string;
  access?: ResourceAccessSummary;
}

export interface ConversationRecord {
  id: string;
  serverId?: string;
  channelId: string;
  title: string;
  status: ConversationStatus;
  startedByType: SenderType;
  startedById: string;
  startedAt: string;
  closedAt?: string | null;
  archivedAt?: string | null;
  archivedByUserId?: string | null;
  lastMessageAt?: string | null;
  summary?: string | null;
  resetStatus: ConversationResetStatus;
  resetAgentId?: string | null;
  resetReason?: string | null;
}

export interface AgentDmRecord {
  id: string;
  channelId: string;
  channelName: string;
  peerAgentId: string;
  peerAgentName: string;
  peerAgentDisplayName: string;
  peerAgentAvatarUrl?: string | null;
  title: string;
  lastMessageId: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageSenderType: SenderType | null;
  lastMessageSenderId: string | null;
  lastMessageSenderName: string | null;
  unreadCount: number;
}

export interface ChannelMemberRecord {
  channelId: string;
  subjectType: "agent" | "human";
  subjectId: string;
  role: "owner" | "member";
  joinedAt: string;
  leftAt?: string | null;
  ordinaryDeliveryEnabled?: boolean;
}

export interface ThreadFollowRecord {
  threadChannelId: string;
  subjectType: "agent" | "human";
  subjectId: string;
  followedAt: string;
  unfollowedAt?: string | null;
}

export interface AttachmentRecord {
  id: string;
  channelId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  path: string;
  createdAt: string;
}

export type AttachmentPreviewType = "image" | "text" | "markdown" | "json" | "csv" | "download";

export interface ChannelFileItem {
  id: string;
  attachmentId: string;
  channelId: string;
  messageId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  senderType: SenderType;
  senderId: string;
  senderName: string;
  createdAt: string;
  messageCreatedAt: string;
  previewType: AttachmentPreviewType;
}

export interface AttachmentPreviewResponse {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  previewType: AttachmentPreviewType;
  inlineUrl: string;
  downloadUrl: string;
  content?: string;
  truncated?: boolean;
}

export type PublicSenderType = "user" | "agent" | "system";

export interface InboxItemBase {
  itemKey: string;
  firstUnreadMessageId: string | null;
  unreadCount: number;
}

export interface InboxChannelItem extends InboxItemBase {
  kind: "channel";
  channelId: string;
  channelName: string;
  channelDisplayName?: string;
  channelType: ChannelType;
  lastMessageId: string;
  // Inbox 只展示未读项，conversation id 必须跟随第一条未读消息。
  lastMessageConversationId?: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastMessageSenderType: PublicSenderType;
  lastMessageSenderId: string;
  lastMessageSenderName: string;
  firstUnreadConversationId?: string | null;
}

export interface InboxThreadItem extends InboxItemBase {
  kind: "thread";
  threadChannelId: string;
  parentMessageId: string;
  parentChannelId: string;
  parentChannelName: string;
  parentChannelDisplayName?: string;
  parentChannelType: ChannelType;
  parentMessagePreview: string;
  parentMessageSenderType: PublicSenderType;
  parentMessageSenderId: string;
  latestActivityPreview: string;
  latestActivitySenderType: PublicSenderType;
  latestActivitySenderId: string;
  latestActivityMessageId: string;
  lastActivityAt: string;
  lastReplyAt: string;
  replyCount: number;
}

export type InboxItem = InboxChannelItem | InboxThreadItem;

export interface InboxResponse {
  items: InboxItem[];
  hasMore: boolean;
  nextCursor: string | null;
  totalCount: number;
  totalUnreadCount: number;
}

export interface MessageResult {
  version: 1;
  status: MessageResultStatus;
  title: string;
  summary: string;
  body?: string;
  /** Exact server-selected evidence for this request; narrative summaries are separate. */
  evidence?: CommunicationEvidenceRecord[];
  sourceAgentId?: string;
  sourceAgentName?: string;
  /** Authenticated human-authored answer, relayed verbatim by TYR. */
  sourceHumanName?: string;
  truncated?: boolean;
  /** TYR 中可验证的 Bridge 投递关联与原始正文。 */
  workspaceBridge?: {
    bridgeRequestId: string;
    bridgeId: string;
    conversationId: string;
    sentContent: string;
    state: WorkspaceBridgeRequestState;
  };
  /** 仅在确认尚未产生写操作时，允许 Web 重新提交原始 TYR 消息。 */
  assistantRetry?: {
    sourceMessageId: string;
  };
  /** TYR 异步回传关联的原始请求，用于最终消息到达时收口临时进度。 */
  communicationRequest?: {
    sourceMessageId: string;
  };
}

export interface MessageRecord {
  id: string;
  channelId: string;
  conversationId?: string;
  channelName?: string;
  channelDisplayName?: string;
  channelType?: ChannelType;
  threadId?: string;
  kind?: MessageKind;
  senderType: SenderType;
  senderId: string;
  senderName: string;
  content: string;
  result?: MessageResult;
  sourceExecutionId?: string;
  seq: number;
  attachmentIds?: string[];
  attachments?: Array<Pick<AttachmentRecord, "id" | "filename" | "mimeType" | "sizeBytes">>;
  deviceRefs?: MessageDeviceRef[];
  quote?: MessageQuoteSummary;
  reactions?: MessageReactionSummary[];
  createdAt: string;
  deletedAt?: string;
  deletedByUserId?: string;
  deletionReason?: "user_deleted";
}

export interface MessageThreadContextPayload {
  channel: ChannelRecord;
  parentChannel: ChannelRecord;
  parentMessage: MessageRecord;
  conversation?: ConversationRecord | null;
}

export interface MessageQuoteSummary {
  messageId: string;
  channelId: string;
  senderType: SenderType;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
}

export interface MessageReactionSummary {
  emoji: MessageReactionEmoji;
  count: number;
  reactorIds: string[];
  reactorNames: string[];
}

export interface TaskRecord {
  id: string;
  channelId: string;
  conversationId?: string;
  channelName?: string;
  channelDisplayName?: string;
  channelType?: ChannelType;
  threadChannelId?: string;
  messageId: string;
  taskNumber: number;
  title: string;
  status: TaskStatus;
  assigneeAgentId?: string;
  assigneeName?: string;
  createdByType: SenderType;
  createdById: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeApprovalRecord {
  id: string;
  serverId?: string;
  machineId: string;
  agentId: string;
  executionId?: string;
  taskId?: string;
  messageId?: string;
  threadChannelId?: string;
  runtime: RuntimeId;
  launchId?: string;
  requestId: string;
  method: string;
  kind: RuntimeApprovalKind;
  title: string;
  detail: string;
  payload?: unknown;
  status: RuntimeApprovalStatus;
  decision?: RuntimeApprovalDecision;
  customResponse?: string;
  requestedAt: string;
  resolvedAt?: string;
  resolvedByUserId?: string;
}

export type MobileExecutionStatus =
  | "idle"
  | "queued"
  | "running"
  | "waiting_approval"
  | "blocked_by_approval"
  | "failed"
  | "completed"
  | "assistant_unavailable";

export interface MobileApprovalSummary {
  id: string;
  executionId?: string;
  agentId: string;
  agentName: string;
  title: string;
  detail: string;
  kind: RuntimeApprovalKind;
  method: string;
  status: RuntimeApprovalStatus;
  requestedAt: string;
  classification?: string;
  nonBlocking?: boolean;
}

export interface MobileExecutionSummary {
  status: MobileExecutionStatus;
  label: string;
  detail: string;
  executionIds: string[];
  approvalIds: string[];
  messageId?: string;
  approval?: MobileApprovalSummary;
  updatedAt?: string;
}

export type RuntimeExecutionStatus = "queued" | "delivered" | "running" | "waiting_approval" | "completed" | "failed" | "stalled" | "cancelled";
export type CommunicationReturnSource = "web" | "email" | "telegram";

export interface ExecutionActorSnapshot {
  agentName?: string;
  agentDisplayName?: string;
  agentOwnerUserId?: string;
  machineName?: string;
  machineHostname?: string;
  machineOwnerUserId?: string;
}

export type RuntimeExecutionEventKind =
  | "queued"
  | "delivered"
  | "delivery_acknowledged"
  | "turn_started"
  | "thinking"
  | "assistant_delta"
  | "assistant_output"
  | "tool_call"
  | "tool_output"
  | "approval_request"
  | "approval_resolved"
  | "turn_completed"
  | "diagnostic"
  | "error";

export type RuntimeContextKind = "conversation" | "thread" | "legacy_channel";

/**
 * RuntimeContext 由 server 根据 Message 与会话关系生成，不能接受客户端自报 key。
 * key 是 execution、Session 映射和 daemon 调度共同使用的稳定边界。
 */
export interface RuntimeContextRef {
  kind: RuntimeContextKind;
  id: string;
  key: string;
}

export type AgentRuntimeSessionStatus = "pending" | "ready" | "invalidated" | "failed";

/** 服务端持久化的逻辑上下文到 vendor RuntimeSession 的映射。 */
export interface AgentRuntimeSessionRecord {
  id: string;
  serverId: string;
  agentId: string;
  machineId: string;
  runtime: RuntimeId;
  contextKind: RuntimeContextKind;
  contextId: string;
  contextKey: string;
  /** 创建该 Runtime Session 时实际绑定的服务端 Agent Profile 版本。 */
  profileRevision: number;
  generation: number;
  runtimeSessionId?: string;
  status: AgentRuntimeSessionStatus;
  lastLaunchId?: string;
  firstExecutionId?: string;
  lastExecutionId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  invalidatedAt?: string;
}

export interface RuntimeExecutionRecord extends ExecutionActorSnapshot {
  id: string;
  serverId?: string;
  machineId: string;
  agentId: string;
  taskId?: string;
  messageId: string;
  threadChannelId?: string;
  runtime: RuntimeId;
  launchId?: string;
  /** execution 创建时固化，后续不得根据页面或 active Agent 状态重新推断。 */
  runtimeContextKey?: string;
  runtimeSessionRecordId?: string;
  runtimeSessionId?: string;
  runtimeSessionGeneration?: number;
  sourceExecutionId?: string;
  returnToAgentId?: string;
  rootMessageId?: string;
  hopCount?: number;
  expectReply?: boolean;
  returnMessageId?: string;
  returnExecutionId?: string;
  returnDispatchedAt?: string;
  communicationReturnChannelId?: string;
  /** TYR 异步回传必须固定到请求来源 conversation，不能跟随 DM 的 current pointer 漂移。 */
  communicationReturnConversationId?: string;
  /** Communication Agent 原始请求 ID，也是临时进度的稳定 operation id。 */
  communicationReturnSourceMessageId?: string;
  communicationReturnUserId?: string;
  communicationReturnSource?: CommunicationReturnSource;
  communicationReturnExternalRef?: string;
  /** 创建 handoff 时固化；最终回复不能读取可能已经变更的 Workspace 配置。 */
  communicationReturnInstructions?: string;
  communicationReturnInstructionsRevision?: number;
  communicationReturnMessageId?: string;
  communicationReturnDispatchedAt?: string;
  /** TYR 派往本 Workspace Agent 时使用原身还是分身；创建 execution 时固化，刷新后不得重算。 */
  controllerActorMode?: TopologyBridgeJourneyActorMode;
  status: RuntimeExecutionStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/**
 * Topology 画布使用的只读执行投影。RuntimeExecutionRecord 仍是唯一真源，
 * 这里只携带可视化所需、且已按当前用户权限过滤的最小字段。
 */
export interface TopologyLiveExecutionRecord {
  id: string;
  agentId: string;
  machineId: string;
  runtime: RuntimeId;
  status: Extract<RuntimeExecutionStatus, "queued" | "delivered" | "running" | "waiting_approval">;
  taskId?: string;
  sourceExecutionId?: string;
  sourceAgentId?: string;
  sourceAgentName?: string;
  sourceChannelId: string;
  sourceChannelType: ChannelType;
  sourceConversationId?: string;
  sourceMessageId: string;
  title: string;
  /** Full sanitized source request and latest execution detail for Bridge observability. */
  sourceContent?: string;
  latestDetail?: string;
  workspaceId?: string;
  bridgePath?: string[];
  sourceLabel: string;
  pendingApprovalId?: string;
  createdAt: string;
  updatedAt: string;
}

export type TopologyCommunicationFlowTone = "request" | "response" | "error";

/**
 * Topology 与 Workspace View 共用的最小通信流投影。
 * 它只描述已授权可见节点之间的方向和状态，不携带对端私人消息或 runtime 输出。
 */
export interface TopologyCommunicationFlowRecord {
  id: string;
  executionId: string;
  /** 服务端沿 sourceExecutionId 追溯得到的稳定链路标识；客户端不得自行重建。 */
  chainId: string;
  /** 当前执行的直接父执行，用于恢复真实相邻关系，而不是按 Agent 或时间猜测。 */
  sourceExecutionId?: string;
  /** return Flow 对应 request execution 的直接父执行；request 进入终态后仍可严格恢复 sibling 关系。 */
  requestSourceExecutionId?: string;
  /** Bridge worker 对应的原始跨 Workspace 请求；用于把桥上光路与对端 TYR → Agent Flow 绑定成同一旅程。 */
  bridgeRequestMessageId?: string;
  /** TYR 已收到持久化结果的时间；execution completed 本身不证明结果回传。 */
  resultReceivedAt?: string;
  /** TYR → Agent 本地拜访的稳定角色身份；旧服务端缺失时客户端按单路原身处理。 */
  actorMode?: TopologyBridgeJourneyActorMode;
  /** delegation 深度，仅用于展示辅助；return execution 可能沿用相同深度。 */
  hopCount?: number;
  workspaceId: string;
  bridgePath?: string[];
  sourceAgentId: string;
  targetAgentId: string;
  machineId: string;
  tone: TopologyCommunicationFlowTone;
  continuous: boolean;
  status: RuntimeExecutionStatus;
  createdAt: string;
  updatedAt: string;
}

export type TopologyLiveActivityKind =
  | "queued"
  | "delivered"
  | "thinking"
  | "tool_running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "stalled"
  | "cancelled";

/**
 * Living Topology 的 renderer-neutral 活动语义。服务端只投影动画选择需要的最小字段，
 * React Flow、Three.js 与后期 Renderer 都不能从原始 runtime payload 自行猜测阶段。
 */
export interface TopologyLiveActivityRecord {
  id: string;
  executionId: string;
  workspaceId: string;
  agentId: string;
  machineId: string;
  kind: TopologyLiveActivityKind;
  status: RuntimeExecutionStatus;
  continuous: boolean;
  eventId?: string;
  /** Runtime 主动提供并经服务端脱敏、截断的思考摘要；不包含原始 payload 或工具输出。 */
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Workspace View 恢复 Bridge 动画所需的无正文投影。
 * 这里只保留方向、TYR 身份和投递阶段，不能携带消息、附件或私人会话内容。
 */
export interface TopologyWorkspaceBridgeMessageRecord {
  id: string;
  bridgeId: string;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  senderCommsAgentId: string;
  receiverCommsAgentId: string;
  outcome: CrossWorkspaceMessageOutcome;
  responseKind: CrossWorkspaceMessageResponseKind | null;
  peerMessageId: string | null;
  replyToMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TopologyBridgeJourneyPhase =
  | "dispatching"
  | "received"
  | "running"
  | "waiting_approval"
  | "returning"
  | "completed"
  | "failed"
  | "cancelled";

export type TopologyBridgeJourneyActionKind =
  | "thinking"
  | "searching"
  | "editing_files"
  | "running_checks"
  | "using_tool";

export type TopologyBridgeJourneyActorMode = "direct" | "clone";

/**
 * 服务端合并 Bridge 消息、worker execution 与回传关系后的权威旅程。
 * Renderer 只根据 phase 移动物体，不能用固定时长猜测消息是否已经抵达。
 */
export interface TopologyBridgeJourneyRecord {
  id: string;
  bridgeId: string;
  requestMessageId: string;
  /** 同一批并发请求共享此 ID，刷新后仍保持相同的原身/分身分配。 */
  dispatchGroupId: string;
  /** Renderer 到此时刻才展示人物，给同批目标留下有限归组窗口。 */
  dispatchReadyAt: string;
  /** 单路空闲 TYR 使用原身；同批并行或原身已在途中时使用分身。 */
  actorMode: TopologyBridgeJourneyActorMode;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  sourceAgentId: string;
  targetAgentId: string;
  targetDisplayName: string;
  phase: TopologyBridgeJourneyPhase;
  label: string;
  phaseAt: string;
  continuous: boolean;
  executionId?: string;
  eventSequence?: number;
  actionKind?: TopologyBridgeJourneyActionKind;
  createdAt: string;
  updatedAt: string;
}

export interface TopologyLiveWorkPayload {
  executions: TopologyLiveExecutionRecord[];
  flows: TopologyCommunicationFlowRecord[];
  activities: TopologyLiveActivityRecord[];
  /** Optional during rolling deploys; current servers always return the bounded direct-Bridge projection. */
  bridgeMessages?: TopologyWorkspaceBridgeMessageRecord[];
  /** Optional during rolling deploys; current servers derive this from persisted Bridge/runtime facts. */
  bridgeJourneys?: TopologyBridgeJourneyRecord[];
  truncated: boolean;
}

/** Living Topology 点击 execution/activity/flow 后的权限安全落点。 */
export type TopologyExecutionOpenTarget =
  | {
      kind: "conversation";
      executionId: string;
      channelId: string;
      channelType: ChannelType;
      messageId: string;
      conversationId?: string;
      approvalId?: string;
    }
  | {
      kind: "workspace_bridge";
      executionId: string;
      bridgeId: string;
    };

export type AgentDelegationReturnMode = "delegator" | "origin";
export type AgentDelegationTransport = "daemon_native" | "internal_api" | "mcp_compat" | "cli_server_fallback";

export interface AgentDelegateRequestPayload {
  requestId: string;
  sourceAgentId: string;
  targetAgent: string;
  instruction: string;
  attachmentIds?: string[];
  sourceExecutionId?: string;
  sourceMessageId?: string;
  returnMode?: AgentDelegationReturnMode;
  expectReply?: boolean;
  transport?: AgentDelegationTransport;
  traceparent?: string;
}

export interface AgentDelegateRecord {
  executionId: string;
  messageId: string;
  channelId: string;
  targetAgentId: string;
  sourceExecutionId?: string;
  returnToAgentId?: string;
  rootMessageId: string;
  hopCount: number;
  expectReply: boolean;
}

export type AgentDelegateResultPayload =
  | {
      requestId: string;
      ok: true;
      delegation: AgentDelegateRecord;
      execution: RuntimeExecutionRecord;
    }
  | {
      requestId: string;
      ok: false;
      error:
        | "agent_not_found"
        | "delegation_target_invalid"
        | "instruction_required"
        | "attachment_not_found"
        | "source_execution_not_found"
        | "source_message_not_found"
        | "target_agent_not_reachable"
        | "target_agent_not_ready"
        | "delegation_governance_blocked"
        | "delegation_failed";
      status: number;
      detail?: string;
    };

export interface RuntimeExecutionEventRecord {
  id: string;
  executionId: string;
  agentId: string;
  taskId?: string;
  kind: RuntimeExecutionEventKind;
  sequence: number;
  title?: string | null;
  detail?: string | null;
  payload?: unknown;
  at: string;
}

export type SafetyLabel = "safe" | "unsafe" | "unknown";
export type SafetyAuditStatus = "queued" | "running" | "completed" | "failed";
export type SafetyAuditTrigger = "approval_request" | "turn_completed";
export type SafetyAssessmentSubjectType = "runtime_execution" | "runtime_approval";

export interface SafetyAssessmentRecord {
  id: string;
  serverId: string;
  machineId: string;
  agentId: string;
  runtime: RuntimeId;
  trigger: SafetyAuditTrigger;
  subjectType: SafetyAssessmentSubjectType;
  subjectId: string;
  status: SafetyAuditStatus;
  label: SafetyLabel;
  riskTypes: string[];
  analysis: string;
  evidence: string[];
  executionId?: string;
  approvalId?: string;
  taskId?: string;
  messageId?: string;
  threadChannelId?: string;
  model?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type GovernanceMode = "shadow" | "assist" | "enforce";
export type GovernanceDecisionValue = "allow" | "require_human" | "deny" | "unknown";
export type GovernanceDecisionSource = "deterministic" | "model" | "model_unavailable";
export type GovernancePolicySource = "built_in" | "env_json" | "db_config";
export type GovernancePolicyScope = "built_in" | "default" | "workspace" | "agent";
export type GovernanceTrigger = "approval_request" | "message_send" | "attachment_upload";
export type GovernanceSubjectType = "runtime_approval" | "message" | "attachment" | "runtime_execution";
export type GovernancePolicyRule =
  | "destructive_command"
  | "secret_external_send"
  | "cross_context"
  | "unknown_action"
  | "sensitive_upload";
export type GovernancePolicyRules = Partial<Record<GovernancePolicyRule, GovernanceDecisionValue>>;
export type GovernancePolicyConfigScope = "workspace" | "agent";

export interface GovernancePolicyConfigRecord {
  id: string;
  serverId: string;
  scope: GovernancePolicyConfigScope;
  agentId?: string;
  policySource: "db_config";
  version: string;
  rules: GovernancePolicyRules;
  createdByUserId?: string;
  updatedByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export type GovernancePolicyConfigAuditAction = "upsert";

export interface GovernancePolicyConfigAuditRecord {
  id: string;
  configId: string;
  serverId: string;
  scope: GovernancePolicyConfigScope;
  agentId?: string;
  action: GovernancePolicyConfigAuditAction;
  policySource: "db_config";
  version: string;
  rules: GovernancePolicyRules;
  actorUserId?: string;
  createdAt: string;
}

export interface GovernanceEffectivePolicyPayload {
  enabled: boolean;
  mode: GovernanceMode;
  model: string;
  policyVersion: string;
  policySource: GovernancePolicySource;
  policyScope: GovernancePolicyScope;
  decisionSource: GovernanceDecisionSource;
  matchedOverrides: string[];
  resolvedPolicy: Required<Record<GovernancePolicyRule, GovernanceDecisionValue>>;
  configs: {
    workspace?: GovernancePolicyConfigRecord;
    agent?: GovernancePolicyConfigRecord;
  };
  audit: GovernancePolicyConfigAuditRecord[];
  auditEvents: AuditEventRecord[];
}

export type GovernancePolicyEffectiveSummary = Omit<GovernanceEffectivePolicyPayload, "audit" | "auditEvents">;

export interface GovernancePolicyDiffEntry {
  rule: GovernancePolicyRule;
  from: GovernanceDecisionValue;
  to: GovernanceDecisionValue;
}

export interface GovernancePolicyImpactedAgent {
  id: string;
  name: string;
  displayName: string;
  runtime: RuntimeId;
  policyScope: GovernancePolicyScope;
  currentPolicyVersion: string;
  candidatePolicyVersion: string;
  changedRules: GovernancePolicyRule[];
}

export interface GovernancePolicyPreviewPayload {
  current: GovernancePolicyEffectiveSummary;
  candidate: GovernancePolicyEffectiveSummary;
  diff: GovernancePolicyDiffEntry[];
  impactedAgents: GovernancePolicyImpactedAgent[];
}

export interface GovernancePolicyHistoryPayload {
  policy: GovernanceEffectivePolicyPayload;
  audit: GovernancePolicyConfigAuditRecord[];
  auditEvents: AuditEventRecord[];
}

export interface GovernancePolicyRollbackPayload {
  policy: GovernanceEffectivePolicyPayload;
  restoredAudit: GovernancePolicyConfigAuditRecord;
  restoredConfig: GovernancePolicyConfigRecord;
}

export interface GovernanceDecisionRecord {
  id: string;
  serverId: string;
  machineId: string;
  agentId: string;
  runtime: RuntimeId;
  trigger: GovernanceTrigger;
  subjectType: GovernanceSubjectType;
  subjectId: string;
  mode: GovernanceMode;
  decision: GovernanceDecisionValue;
  confidence: number;
  riskTypes: string[];
  reason: string;
  evidence: string[];
  policyVersion?: string;
  policySource?: GovernancePolicySource;
  policyScope?: GovernancePolicyScope;
  decisionSource?: GovernanceDecisionSource;
  executionId?: string;
  approvalId?: string;
  taskId?: string;
  messageId?: string;
  threadChannelId?: string;
  model?: string;
  caseSummary?: Record<string, unknown>;
  createdAt: string;
}

/**
 * Global Operator 打开单条执行时读取的服务端真源记录。
 * 该载荷不经过 Owner/Web 的内容脱敏与同步压缩，权限边界由 Operator session 与 Workspace scope 保证。
 */
export interface PlatformOperatorExecutionViewPayload {
  execution: RuntimeExecutionRecord;
  prompt: string;
  events: RuntimeExecutionEventRecord[];
  approvals: RuntimeApprovalRecord[];
  safetyAssessments: SafetyAssessmentRecord[];
  governanceDecisions: GovernanceDecisionRecord[];
}

export interface RuntimeExecutionDebugExportRequest {
  executionIds: string[];
}

export type RuntimeExecutionDebugExportSource = "server-persisted" | "client-visible";

export interface RuntimeExecutionDebugExportStats {
  source: RuntimeExecutionDebugExportSource;
  executionCount: number;
  eventCount: number;
  blockCount?: number;
  approvalCount: number;
  safetyAssessmentCount: number;
  governanceDecisionCount?: number;
  governancePolicySnapshotCount?: number;
  governancePolicyConfigAuditCount?: number;
  governanceExplanationCount?: number;
  auditEventCount?: number;
  runtimeSessionCount?: number;
  requestedExecutionIds?: string[];
}

export interface RuntimeContextDebugMetrics {
  runtime_context_session_started_total: number;
  runtime_context_session_resumed_total: number;
  runtime_context_switch_total: number;
  runtime_context_resume_failed_total: number;
  runtime_context_binding_rejected_total: number;
  runtime_context_queue_wait_ms: {
    count: number;
    total: number;
    average: number;
    max: number;
  };
}

export interface RuntimeExecutionGovernancePolicySnapshot {
  serverId: string;
  agentId?: string;
  enabled: boolean;
  mode: GovernanceMode;
  model: string;
  policyVersion: string;
  policySource: GovernancePolicySource;
  policyScope: GovernancePolicyScope;
  decisionSource: GovernanceDecisionSource;
  matchedOverrides: string[];
  resolvedPolicy: Required<Record<GovernancePolicyRule, GovernanceDecisionValue>>;
  configs: {
    workspace?: GovernancePolicyConfigRecord;
    agent?: GovernancePolicyConfigRecord;
  };
}

export interface GovernanceDecisionExplanation {
  decisionId: string;
  trigger: GovernanceTrigger;
  subjectType: GovernanceSubjectType;
  subjectId: string;
  decision: GovernanceDecisionValue;
  reason: string;
  riskTypes: string[];
  policyVersion?: string;
  policySource?: GovernancePolicySource;
  policyScope?: GovernancePolicyScope;
  decisionSource?: GovernanceDecisionSource;
  matchedOverrides?: string[];
  sourceTags?: Record<string, unknown>[];
  executionId?: string;
  approvalId?: string;
  taskId?: string;
  messageId?: string;
  threadChannelId?: string;
  createdAt: string;
}

export interface RuntimeExecutionDebugExport {
  schemaVersion: 1;
  exportedAt: string;
  executions: RuntimeExecutionRecord[];
  events: RuntimeExecutionEventRecord[];
  operationObservability?: AgentToolOperationObservability[];
  executionBlocks?: ExecutionBlockRecord[];
  approvals: RuntimeApprovalRecord[];
  safetyAssessments: SafetyAssessmentRecord[];
  governanceDecisions: GovernanceDecisionRecord[];
  governancePolicySnapshots?: RuntimeExecutionGovernancePolicySnapshot[];
  governancePolicyConfigAudit?: GovernancePolicyConfigAuditRecord[];
  governanceExplanations?: GovernanceDecisionExplanation[];
  auditEvents?: AuditEventRecord[];
  /** 仅受 owner 权限保护的 debug export 暴露 vendor Session 映射；普通 execution API 不返回。 */
  runtimeSessions?: AgentRuntimeSessionRecord[];
  runtimeContextMetrics?: RuntimeContextDebugMetrics;
  stats: RuntimeExecutionDebugExportStats;
  environment?: {
    latestRuntimeSha?: string;
    machines: Array<{
      id: string;
      name: string;
      runtimeSha?: string;
      runtimeMarker?: string;
      runtimeMarkerMtime?: string;
      daemonVersion: string;
      status: MachineStatus;
      runtimeReports?: RuntimeReport[];
    }>;
    runtimeContextSessionRollout?: {
      mode: "off" | "codex";
      scoped: boolean;
      agents: Array<{
        id: string;
        enabled: boolean;
      }>;
    };
  };
  clientContext?: {
    prompt?: string;
    hiddenBlockCount?: number;
  };
}

export function governanceDecisionExplanation(decision: GovernanceDecisionRecord): GovernanceDecisionExplanation {
  const policy = decision.caseSummary?.policy;
  const matchedOverrides = policy && typeof policy === "object" && Array.isArray((policy as { matchedOverrides?: unknown }).matchedOverrides)
    ? (policy as { matchedOverrides: unknown[] }).matchedOverrides.filter((item): item is string => typeof item === "string")
    : undefined;
  return {
    decisionId: decision.id,
    trigger: decision.trigger,
    subjectType: decision.subjectType,
    subjectId: decision.subjectId,
    decision: decision.decision,
    reason: decision.reason,
    riskTypes: decision.riskTypes,
    policyVersion: decision.policyVersion,
    policySource: decision.policySource,
    policyScope: decision.policyScope,
    decisionSource: decision.decisionSource,
    ...(matchedOverrides ? { matchedOverrides } : {}),
    sourceTags: governanceSourceTagsFromCaseSummary(decision.caseSummary),
    executionId: decision.executionId,
    approvalId: decision.approvalId,
    taskId: decision.taskId,
    messageId: decision.messageId,
    threadChannelId: decision.threadChannelId,
    createdAt: decision.createdAt
  };
}

function governanceSourceTagsFromCaseSummary(caseSummary: Record<string, unknown> | undefined): Record<string, unknown>[] {
  const sourceTags = caseSummary?.sourceTags;
  if (!Array.isArray(sourceTags)) return [];
  return sourceTags.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

export type RuntimeExecutionEventPayload = {
  executionId: string;
  agentId: string;
  taskId?: string;
  kind: RuntimeExecutionEventKind;
  title?: string | null;
  detail?: string | null;
  payload?: unknown;
  at?: string;
};

export type ExecutionGroupStatus = "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
export type AgentRunStatus = "queued" | "running" | "waiting_dependency" | "waiting_approval" | "completed" | "failed" | "cancelled";
export type ExecutionBlockStatus = "pending" | "running" | "completed" | "failed" | "approved" | "rejected" | "blocked";

export type ExecutionBlockKind =
  | "prompt"
  | "assistant_message"
  | "thinking_summary"
  | "tool_call"
  | "tool_output"
  | "command"
  | "file_change"
  | "approval_gate"
  | "governance_review"
  | "artifact"
  | "runtime_error"
  | "final_result"
  | "system";

export type ExecutionArtifactKind = "message" | "file" | "image" | "attachment" | "prompt" | "task_update" | "other";
export type ExecutionArtifactRefType = "message" | "attachment" | "workspace_file" | "blob" | "external";

export interface ExecutionGroupRecord {
  id: string;
  serverId: string;
  taskId?: string;
  messageId?: string;
  threadChannelId?: string;
  status: ExecutionGroupStatus;
  title: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface AgentRunRecord extends ExecutionActorSnapshot {
  id: string;
  groupId: string;
  machineId: string;
  agentId: string;
  runtime: RuntimeId;
  launchId?: string;
  status: AgentRunStatus;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ExecutionBlockRecord {
  id: string;
  groupId: string;
  runId?: string;
  agentId?: string;
  groupSequence: number;
  runSequence?: number;
  kind: ExecutionBlockKind;
  title: string;
  bodyPreview?: string;
  bodyRef?: string;
  status?: ExecutionBlockStatus;
  approvalId?: string;
  governanceDecisionId?: string;
  artifactId?: string;
  rawEventIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionArtifactRecord {
  id: string;
  groupId: string;
  runId?: string;
  agentId?: string;
  kind: ExecutionArtifactKind;
  title: string;
  preview?: string;
  refType: ExecutionArtifactRefType;
  refId?: string;
  createdAt: string;
}

export interface ExecutionBlockPageInfo {
  hasMoreBefore: boolean;
  oldestSequence: number | null;
  newestSequence: number | null;
}

export interface ExecutionBlockPagePayload {
  blocks: ExecutionBlockRecord[];
  pageInfo: ExecutionBlockPageInfo;
}

export interface ExecutionContextPayload {
  executionGroups: ExecutionGroupRecord[];
  agentRuns: AgentRunRecord[];
  executionBlocks: ExecutionBlockRecord[];
  executionBlockPageInfo: Record<string, ExecutionBlockPageInfo>;
  runtimeExecutions: RuntimeExecutionRecord[];
  childRuntimeExecutions?: RuntimeExecutionRecord[];
  runtimeApprovals: RuntimeApprovalRecord[];
  safetyAssessments: SafetyAssessmentRecord[];
  governanceDecisions: GovernanceDecisionRecord[];
  executionArtifacts: ExecutionArtifactRecord[];
}

export type MessageExecutionSummaryStatus = "pending_approval" | "running" | "failed" | "completed" | "partial";

export type MessageExecutionSummaryItemStatus =
  | "queued"
  | "delivered"
  | "running"
  | "waiting"
  | "pending_approval"
  | "completed"
  | "failed"
  | "partial";

export type MessageExecutionSummaryItemActionLabel = "Review approval" | "View progress" | "View result";

export interface MessageExecutionSummaryItemRecord {
  executionId?: string;
  groupId?: string;
  agentId?: string;
  agentName: string;
  status: MessageExecutionSummaryItemStatus;
  actionLabel: MessageExecutionSummaryItemActionLabel;
  updatedAt: string;
  partial?: boolean;
}

export interface MessageExecutionSummaryRecord {
  messageId: string;
  status: MessageExecutionSummaryStatus;
  label: string;
  actionLabel: "Review approval" | "View execution";
  agentNames: string[];
  executionIds: string[];
  approvalIds: string[];
  groupIds: string[];
  pendingApprovalCount: number;
  partial: boolean;
  partialReason?: "missing_runtime_execution" | "missing_agent_run" | "deleted_actor";
  updatedAt: string;
  items?: MessageExecutionSummaryItemRecord[];
}

export interface ReminderRecord {
  id: string;
  ownerAgentId: string;
  title: string;
  status: "scheduled" | "fired" | "canceled";
  fireAt: string;
  version: number;
  repeat?: string;
  fireCount?: number;
  messageId?: string;
  channelId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderJob {
  reminderId: string;
  ownerAgentId: string;
  title: string;
  fireAt: string;
  version: number;
  repeat?: string;
  messageId?: string;
  channelId?: string;
}

export interface AgentRuntimeConfig {
  agentId: string;
  name: string;
  displayName: string;
  description?: string;
  /** 用于 daemon/server 确认当前 Runtime 实际装载了哪一版 Agent Profile Prompt。 */
  profileRevision?: number;
  runtime: RuntimeId;
  model?: string;
  reasoningEffort?: AgentRecord["reasoningEffort"];
  serverUrl: string;
  authToken: string;
  machineId: string;
  machineName: string;
  machineHostname?: string;
  machineOs?: string;
  daemonVersion?: string;
  serverId?: string;
  /** 当前 Agent 所属 Workspace 的服务端权威标识。 */
  workspaceId?: string;
  /** 当前 Agent 所属 Workspace 的服务端权威名称，不得从历史消息或本地目录推断。 */
  workspaceName?: string;
  workspacePath?: string;
  launchId?: string;
  permissionMode?: RuntimePermissionMode;
  runtimeResourceGrants?: RuntimeResourceGrant[];
  envVars?: Record<string, string>;
  sessionId?: string;
  /** 仅由 server 在 capability、灰度和 Runtime 支持同时满足时开启。 */
  contextSessionEnabled?: boolean;
  /** enabled 保持既有 MEMORY.md 行为；disabled 禁止 runtime 生成、读取或维护自动长期记忆。 */
  longTermMemory?: "enabled" | "disabled";
  /** Owner 分配给本 Agent 的 Workspace canonical files；daemon materialize 到 shared/。 */
  sharedFiles?: AgentSharedFileSnapshot[];
}

export interface AgentWakeRuntimeContext {
  kind: RuntimeContextKind;
  id: string;
  key: string;
  session_record_id: string;
  generation: number;
  runtime_session_id?: string;
  action: "start" | "resume";
  seed: "current_message" | "thread_snapshot";
}

export interface AgentWakeMessage {
  message_id: string;
  channel_id: string;
  conversation_id?: string;
  conversation_title?: string;
  thread_channel_id?: string;
  channel_name: string;
  channel_type: ChannelType;
  dm_peer_agent_id?: string;
  dm_peer_agent_name?: string;
  dm_peer_agent_display_name?: string;
  sender_id: string;
  sender_type: SenderType;
  sender_name: string;
  content: string;
  seq: number;
  timestamp: string;
  execution_id?: string;
  /** 仅由 server 根据 execution 编排关系签发；Runtime 不从消息正文猜测自动回传路径。 */
  handoff?: {
    source_execution_id?: string;
    return_to_agent_id: string;
    expect_reply: true;
  };
  /** P1 server 签发的 RuntimeSession 指令；daemon 不从页面 route 或消息正文推断。 */
  runtime_context?: AgentWakeRuntimeContext;
  /** Thread 唤醒由服务端按父消息边界裁剪，避免 RuntimeSession 把其他分支误当作当前上下文。 */
  thread_context?: AgentWakeThreadContext;
  /** 发送者显式选择的引用快照，只提供本轮上下文，不授予原会话访问权。 */
  quote?: MessageQuoteSummary;
  attachments?: Array<Pick<AttachmentRecord, "id" | "filename" | "mimeType" | "sizeBytes">>;
  deviceRefs?: MessageDeviceRef[];
  device_refs?: MessageDeviceRef[];
  task?: Pick<TaskRecord, "id" | "taskNumber" | "title" | "status" | "assigneeAgentId" | "threadChannelId" | "channelName" | "channelDisplayName" | "channelType">;
  traceparent?: string;
}

export interface AgentWakeContextMessage {
  message_id: string;
  sender_id: string;
  sender_type: SenderType;
  sender_name: string;
  content: string;
  timestamp: string;
  quote?: MessageQuoteSummary;
  attachments?: Array<Pick<AttachmentRecord, "id" | "filename" | "mimeType" | "sizeBytes">>;
}

export interface AgentWakeThreadContext {
  parent_channel_id: string;
  conversation_id?: string;
  /** 父消息之前的有限 DM 背景，不包含父消息之后继续发生的主会话内容。 */
  root_messages: AgentWakeContextMessage[];
  parent_message: AgentWakeContextMessage;
  /** 当前消息之前的 Thread 回复，按时间正序排列。 */
  thread_messages: AgentWakeContextMessage[];
  thread_history_truncated: boolean;
}

export type DaemonInbound =
  | {
      type: "agent:start";
      agentId: string;
      config: AgentRuntimeConfig;
      wakeMessage?: AgentWakeMessage;
      unreadSummary?: Record<string, number>;
      resumePrompt?: string;
      launchId?: string;
    }
  | {
      type: "machine:connector_token";
      machineId: string;
      connectorToken: string;
      /** Rotation tokens are promoted only after the daemon confirms durable local persistence. */
      rotationId?: string;
      ackRequired?: boolean;
    }
  | { type: "agent:stop"; agentId: string }
  | { type: "agent:deliver"; agentId: string; seq: number; message: AgentWakeMessage; deliveryId?: string }
  | { type: "agent:delegate:result"; agentId: string; result: AgentDelegateResultPayload }
  | { type: "agent:runtime_execution:bind"; agentId: string; messageId: string; executionId: string; task?: AgentWakeMessage["task"] }
  | {
      type: "agent:runtime_execution:cancel";
      agentId: string;
      executionId: string;
      contextKey?: string;
      sessionRecordId?: string;
    }
  | {
      type: "agent:context_session:replace";
      agentId: string;
      executionId: string;
      contextKey: string;
      failedSessionRecordId: string;
      replacement: {
        sessionRecordId: string;
        generation: number;
      };
    }
  | {
      type: "agent:runtime_approval:resolve";
      agentId: string;
      approvalId: string;
      requestId: string;
      executionId?: string;
      contextKey?: string;
      sessionRecordId?: string;
      decision: RuntimeApprovalDecision;
      customResponse?: string;
    }
  | { type: "agent:workspace:list"; agentId: string; dirPath?: string; requestId: string }
  | { type: "agent:workspace:read"; agentId: string; path: string; requestId: string }
  | { type: "agent:shared_files:sync"; agentId: string; files: AgentSharedFileSnapshot[] }
  | { type: "agent:skills:list"; agentId: string; runtime?: RuntimeId; requestId: string }
  | { type: "machine:runtime_models:detect"; runtime: RuntimeId; requestId: string }
  | { type: "reminder.upsert"; reminder: ReminderJob; traceparent?: string }
  | { type: "reminder.cancel"; reminderId: string; version: number; traceparent?: string }
  | { type: "reminder.snapshot"; agentId: string; reminders: ReminderJob[]; traceparent?: string }
  | { type: "ping" };

export type DaemonReadyCapability =
  | "agent:start"
  | "agent:stop"
  | "agent:deliver"
  | "agent:delegate"
  | "agent:context-session"
  | "workspace:files"
  | "workspace:shared-files"
  | "machine:connector-token-ack";

export type DaemonContextSessionEvent =
  | {
      type: "agent:context_session";
      state: "ready";
      agentId: string;
      executionId: string;
      contextKey: string;
      sessionRecordId: string;
      generation: number;
      runtimeSessionId: string;
      launchId: string;
    }
  | {
      type: "agent:context_session";
      state: "resume_failed";
      agentId: string;
      executionId: string;
      contextKey: string;
      sessionRecordId: string;
      generation: number;
      runtimeSessionId?: string;
      launchId: string;
      reason: string;
    };

export type DaemonOutbound =
  | {
      type: "ready";
      capabilities: DaemonReadyCapability[];
      runtimes: RuntimeId[];
      runtimeVersions?: Record<string, string>;
      runtimeReports?: RuntimeReport[];
      runningAgents: string[];
      hostname: string;
      os: string;
      daemonVersion: string;
      runtimeMarker?: string;
      runtimeSha?: string;
      runtimeMarkerMtime?: string;
      installationId?: string;
      hostFingerprint?: string;
      agentStates?: DaemonAgentStateSnapshot[];
    }
  | { type: "machine:connector_token_ack"; machineId: string; rotationId: string; persistedAt: string }
  | { type: "agent:profile_applied"; agentId: string; profileRevision: number; launchId?: string }
  | { type: "agent:profile_apply_failed"; agentId: string; profileRevision: number; error: string; launchId?: string }
  | { type: "agent:status"; agentId: string; status: "active" | "inactive"; launchId?: string; activitySeq?: number }
  | { type: "agent:delegate"; request: AgentDelegateRequestPayload }
  | {
      type: "agent:activity";
      agentId: string;
      activity: AgentStatus | "thinking";
      detail?: string;
      entries?: AgentActivityEntry[];
      launchId?: string;
      activitySeq?: number;
    }
  | { type: "agent:state_snapshot"; agents: DaemonAgentStateSnapshot[] }
  | { type: "agent:session"; agentId: string; sessionId: string; launchId?: string; workspacePath?: string }
  | DaemonContextSessionEvent
  | { type: "agent:deliver:ack"; agentId: string; seq: number; deliveryId?: string }
  | { type: "agent:runtime_event"; event: RuntimeExecutionEventPayload; launchId?: string }
  | { type: "agent:runtime_approval:requested"; approval: RuntimeApprovalRecord }
  | { type: "agent:runtime_approval:resolved"; agentId: string; approvalId: string; requestId: string; decision: RuntimeApprovalDecision; customResponse?: string }
  | { type: "agent:workspace:file_tree"; agentId: string; requestId?: string; dirPath?: string; files: WorkspaceFileNode[] }
  | {
      type: "agent:workspace:file_content";
      agentId: string;
      requestId: string;
      content: string | null;
      binary: boolean;
      size: number;
      mimeType?: string;
      encoding?: string;
    }
  | {
      type: "agent:shared_file:update";
      agentId: string;
      fileId: string;
      baseVersion: number;
      name: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      contentBase64: string;
      executionId?: string;
    }
  | { type: "agent:skills:list_result"; agentId: string; requestId?: string; global: SkillInfo[]; runtime?: SkillInfo[]; workspace: SkillInfo[] }
  | { type: "machine:runtime_models:result"; requestId: string; models?: RuntimeModel[]; default?: string; error?: string }
  | { type: "reminder.fire_attempt"; agentId: string; reminderId: string; version: number; firedAtClient: string; traceparent?: string }
  | { type: "pong" };

export interface DaemonAgentStateSnapshot {
  agentId: string;
  launchId: string;
  /** reconnect 时上报当前进程已装载的 Profile 版本，供 server 检测并替换陈旧进程。 */
  profileRevision?: number;
  activitySeq: number;
  activity: AgentStatus;
  detail: string;
  activeContextKey?: string;
  activeSessionRecordId?: string;
  activeExecutionId?: string;
}

export interface AgentActivityEntry {
  at: string;
  kind: string;
  text: string;
}

export interface WorkspaceFileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

export interface SkillInfo {
  name: string;
  path: string;
  scope: "global" | "runtime" | "workspace";
  displayName?: string;
  description?: string;
  userInvocable?: boolean;
  sourcePath?: string;
}

export interface CursorPageInfo {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PaginatedList<T> {
  items: T[];
  pageInfo: CursorPageInfo;
}

export interface WorkspaceCapabilities {
  canCreateMachine: boolean;
  canInviteHuman: boolean;
  canManageServer: boolean;
}

export interface WorkspaceSummary {
  dms: number;
  agents: number;
  machines: number;
  humans: number;
  devices: number;
  openTasks: number;
  incomingInvites: number;
  workspaceBridges: number;
  incomingWorkspaceBridges: number;
  unreadTotal: number;
  resourceGrants: number;
}

export interface WorkspaceDefaults {
  defaultDmChannelId: string | null;
}

export interface WorkspaceBootstrapPayload {
  currentUser: UserRecord;
  currentServer: ServerRecord | null;
  capabilities: WorkspaceCapabilities;
  summary: WorkspaceSummary;
  defaults: WorkspaceDefaults;
  unreadCounts: Record<string, number>;
  incomingServerInvites: IncomingServerInviteRecord[];
  workspaceBridges: WorkspaceBridgeRecord[];
  incomingWorkspaceBridges: WorkspaceBridgeRecord[];
  crossWorkspaceMessages: CrossWorkspaceMessageRecord[];
  peerWorkspaceTopologies: WorkspaceBridgeTopologySnapshot[];
  workspaceBridgeTopologyEdges?: WorkspaceBridgeTopologyEdge[];
  sidebarOrder?: SidebarOrderSettings;
}

export type WorkspaceNavigationSection = "dms" | "agents" | "machines" | "humans" | "resource-grants";

export type WorkspaceChannelNavItem = Pick<
  ChannelRecord,
  "id" | "serverId" | "type" | "name" | "displayName" | "visibility" | "description" | "parentChannelId" | "parentMessageId" | "archivedAt" | "archivedByUserId" | "createdAt" | "access"
> & {
  unreadCount: number;
  lastMessageAt: string | null;
};

export type WorkspaceAgentNavItem = Pick<
  AgentRecord,
  "id" | "serverId" | "kind" | "ownerUserId" | "machineId" | "name" | "displayName" | "description" | "avatarUrl" | "runtime" | "model" | "reasoningEffort" | "permissionMode" | "runtimeResourceGrants" | "status" | "lastError" | "workspacePath" | "sessionId" | "launchId" | "createdAt" | "updatedAt" | "access" | "machineMissing" | "hostMachine"
>;

export type WorkspaceMachineNavItem = Pick<
  MachineRecord,
  "id" | "serverId" | "ownerUserId" | "name" | "hostname" | "os" | "daemonVersion" | "latestDaemonVersion" | "runtimeMarker" | "runtimeSha" | "runtimeMarkerMtime" | "latestRuntimeSha" | "runtimeUpdateAvailable" | "status" | "createdAt" | "lastSeenAt" | "access" | "connectorTokenIssuedAt" | "connectorTokenRevokedAt" | "apiKeyUsedAt"
> & {
  agentCount: number;
  availableRuntimes: RuntimeId[];
  runtimeReports?: RuntimeReport[];
};

export type WorkspaceHumanNavItem = UserRecord;

export type WorkspaceResourceGrantNavItem = ResourceGrantSummary;

export type WorkspaceNavigationItem =
  | WorkspaceChannelNavItem
  | WorkspaceAgentNavItem
  | WorkspaceMachineNavItem
  | WorkspaceHumanNavItem
  | WorkspaceResourceGrantNavItem;

export interface WorkspaceNavigationPayload<T extends WorkspaceNavigationItem = WorkspaceNavigationItem> {
  section: WorkspaceNavigationSection;
  items: T[];
  pageInfo: CursorPageInfo;
}

export interface TaskListPayload {
  tasks: TaskRecord[];
  pageInfo: CursorPageInfo;
}

export interface DeviceListPayload {
  devices: DeviceRecord[];
  pageInfo: CursorPageInfo;
}

export interface AppSnapshot {
  currentUser: UserRecord;
  currentServer: ServerRecord | null;
  sidebarOrder?: SidebarOrderSettings;
  machines: Array<MachineRecord & { latestDaemonVersion: string; latestRuntimeSha?: string; runtimeUpdateAvailable?: boolean; runtimes: RuntimeReport[]; agents: AgentRecord[] }>;
  agents: AgentRecord[];
  humans: UserRecord[];
  channels: ChannelRecord[];
  conversations: ConversationRecord[];
  messages: MessageRecord[];
  devices: DeviceRecord[];
  deviceGrants: DeviceGrantRecord[];
  deviceAccessRules: DeviceGrantRecord[];
  deviceCommands: DeviceCommandRecord[];
  tasks: TaskRecord[];
  savedMessageIds: string[];
  unreadCounts: Record<string, number>;
  reminders: ReminderRecord[];
  runtimeApprovals: RuntimeApprovalRecord[];
  runtimeExecutions: RuntimeExecutionRecord[];
  messageExecutionSummaries?: Record<string, MessageExecutionSummaryRecord>;
  runtimeExecutionEvents: RuntimeExecutionEventRecord[];
  executionGroups: ExecutionGroupRecord[];
  agentRuns: AgentRunRecord[];
  executionBlocks: ExecutionBlockRecord[];
  executionArtifacts: ExecutionArtifactRecord[];
  communicationAgentPendingActions?: CommunicationAgentPendingActionRecord[];
  communicationAgentProgress?: CommunicationAgentProgressRecord[];
  safetyAssessments: SafetyAssessmentRecord[];
  governanceDecisions: GovernanceDecisionRecord[];
  resourceGrantSummaries: ResourceGrantSummary[];
  incomingServerInvites: IncomingServerInviteRecord[];
  workspaceBridges: WorkspaceBridgeRecord[];
  incomingWorkspaceBridges: WorkspaceBridgeRecord[];
  crossWorkspaceMessages: CrossWorkspaceMessageRecord[];
  peerWorkspaceTopologies: WorkspaceBridgeTopologySnapshot[];
  workspaceBridgeTopologyEdges?: WorkspaceBridgeTopologyEdge[];
}

export function runtimeDisplayName(runtime: RuntimeId | string): string {
  return RUNTIMES.find((item) => item.id === runtime)?.displayName ?? runtime;
}

export function defaultSidebarOrderSettings(input: Partial<SidebarOrderSettings> = {}): SidebarOrderSettings {
  return {
    channelOrder: input.channelOrder ?? [],
    agentOrder: input.agentOrder ?? [],
    dmOrder: input.dmOrder ?? [],
    channelSortMode: "manual",
    dmSortMode: "manual",
    pinnedSortMode: "manual",
    pinnedChannelIds: input.pinnedChannelIds ?? [],
    pinnedAgentIds: input.pinnedAgentIds ?? [],
    pinnedOrder: input.pinnedOrder ?? [],
    hiddenDmIds: input.hiddenDmIds ?? [],
    channelPanelTabOrder: input.channelPanelTabOrder ?? [],
    agentPanelTabOrder: input.agentPanelTabOrder ?? []
  };
}

export function slugifyName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || "agent";
}

export * from "./communication-email";
/** Instance-wide operational notice; carries no workspace or customer data. */
export interface DeploymentNotice {
  id: string;
  phase: "scheduled" | "updating" | "completed" | "postponed";
  updatedAt: string;
  expiresAt: string;
}
