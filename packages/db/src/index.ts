import { createCommunicationEmailStore, migrateCommunicationEmailAliases } from "./communication-email";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import {
  AGENT_ACTIVE_CAPABILITIES,
  AGENT_CAPABILITIES,
  BUILT_IN_DEVICE_CAPABILITY_DESCRIPTORS,
  COMMUNICATION_AGENT_MANAGEMENT_ACTIONS,
  COMMUNICATION_AGENT_DESCRIPTION,
  DEFAULT_COMMUNICATION_AGENT_DISPLAY_NAME,
  DEFAULT_COMMUNICATION_AGENT_NAME,
  DEFAULT_RUNTIME_PERMISSION_MODE,
  LATEST_DAEMON_VERSION,
  PLATFORM_OPERATOR_SCOPES,
  RESOURCE_GRANT_SCOPES,
  type TyrEmailSettings,
  type AgentCapability,
  type AgentHostMachineSummary,
  type AgentRecord,
  type AgentRuntimeSessionRecord,
  type AgentRuntimeSessionStatus,
  type AgentScopes,
  type AppSnapshot,
  type AuditEventRecord,
  type AttachmentRecord,
  type ChannelMemberRecord,
  type ChannelRecord,
  type ChannelType,
  type ChannelVisibility,
  type ConversationRecord,
  type ConversationResetStatus,
  type ConversationStatus,
  type CommunicationAgentManagementAction,
  type CommunicationAgentManagementChoice,
  type CommunicationAgentManagementDraftRecord,
  type CommunicationAgentManagementDraftStage,
  type CommunicationAgentManagementDraftStatus,
  type CommunicationAgentManagementParams,
  type CommunicationAgentManagementSource,
  type CommunicationAgentPendingActionRecord,
  type CommunicationAgentPendingActionStatus,
  type DeviceCapability,
  type DeviceCapabilityDescriptor,
  type DeviceCommandRecord,
  type DeviceCommandResult,
  type DeviceGrantRecord,
  type DeviceGrantScope,
  type DeviceKind,
  type DeviceListPayload,
  type DevicePairingTokenRecord,
  type DevicePermissionState,
  type DevicePlatform,
  type DeviceRecord,
  type DeviceStatus,
  type DmIdentity,
  type AgentRunRecord,
  type AgentRunStatus,
  type ExecutionActorSnapshot,
  type ExecutionArtifactRecord,
  type ExecutionBlockRecord,
  type ExecutionGroupRecord,
  type ExecutionGroupStatus,
  type GovernanceDecisionRecord,
  type GovernanceDecisionValue,
  type GovernancePolicyConfigAuditAction,
  type GovernancePolicyConfigAuditRecord,
  type GovernancePolicyConfigRecord,
  type GovernancePolicyConfigScope,
  type GovernancePolicyRule,
  type GovernancePolicyRules,
  type HelpdeskSignupIntentRecord,
  type HelpdeskPasswordRecoveryIntentRecord,
  type InboxItem,
  type InboxResponse,
  type IncomingServerInviteRecord,
  type CrossWorkspaceMessageInitiator,
  type CrossWorkspaceMessageOutcome,
  type CrossWorkspaceMessageResponseKind,
  type CrossWorkspaceMessageRecord,
  type MachineRecord,
  type MachineOnboardingIntentRecord,
  type MessageDeviceRef,
  type MessageKind,
  type MessageReactionEmoji,
  type MessageReactionSummary,
  type MessageRecord,
  type MessageResult,
  type MobileAppBindingRecord,
  type PublicSenderType,
  RUNTIMES,
  SUPPORTED_MESSAGE_REACTIONS,
  defaultSidebarOrderSettings,
  type ReminderJob,
  type ReminderRecord,
  type ResourceGrantRecord,
  type ResourceGrantScope,
  type ResourceGrantSummary,
  type ResourceType,
  type RuntimeApprovalDecision,
  type RuntimeApprovalRecord,
  type RuntimeAuthStatus,
  type RuntimeExecutionEventKind,
  type RuntimeExecutionEventRecord,
  type RuntimeExecutionRecord,
  type RuntimeExecutionStatus,
  type RuntimeContextKind,
  type RuntimePermissionMode,
  RUNTIME_RESOURCE_GRANT_KINDS,
  RUNTIME_RESOURCE_GRANT_SCOPES,
  type RuntimeResourceGrant,
  type RuntimeResourceGrantKind,
  type RuntimeResourceGrantScope,
  type UpdateAgentConfigurationInput,
  type SafetyAssessmentRecord,
  type SafetyAssessmentSubjectType,
  type SafetyAuditTrigger,
  type SafetyAuditStatus,
  type SafetyLabel,
  type RuntimeId,
  type RuntimeModel,
  type RuntimeReport,
  type SenderType,
  type SidebarOrderSettings,
  type ServerInviteRecord,
  type ServerRecord,
  type TaskRecord,
  type TaskListPayload,
  type ThreadFollowRecord,
  type TaskStatus,
  type UserRecord,
  type PaginatedList,
  type PlatformOperatorRecord,
  type PlatformOperatorScope,
  type PlatformOperatorWorkspaceRecord,
  type PlatformOperatorWorkspaceGrantRecord,
  type TyrHeartbeatIntervalUnit,
  type TyrHeartbeatRecord,
  type TyrHeartbeatRunRecord,
  type TyrHeartbeatRunStatus,
  type WorkspaceBootstrapPayload,
  type WorkspaceBridgeMessagesPayload,
  type WorkspaceBridgePeerSummary,
  type WorkspaceBridgeRecord,
  type WorkspaceBridgeTopologyEdge,
  type WorkspaceBridgeTopologySnapshot,
  type WorkspaceRoutingInstructionsRecord,
  type WorkspaceNavigationPayload,
  type WorkspaceNavigationSection,
  type WorkspaceNavigationItem,
  type WorkspaceSharedFileAssignmentRecord,
  type WorkspaceSharedFilePermission,
  type WorkspaceSharedFileRecord,
  type WorkspaceAgentNavItem,
  type WorkspaceChannelNavItem,
  type WorkspaceMachineNavItem,
  isLegacyMockDevice,
  isCommunicationAgent,
  slugifyName
} from "@tyr-ai/contracts";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type ServerMemberRole = "owner" | "member" | "guest";
type ChannelHumanRole = "owner" | "member";
export type WorkspaceRoutingInstructionsUpdater =
  | string
  | {
      actorType: "user" | "platform_operator";
      actorId: string;
      expectedRevision?: number;
      auditMetadata?: Record<string, string>;
    };

export class WorkspaceRoutingInstructionsRevisionConflictError extends Error {
  readonly current: WorkspaceRoutingInstructionsRecord;

  constructor(current: WorkspaceRoutingInstructionsRecord) {
    super("routing_instructions_revision_conflict");
    this.name = "WorkspaceRoutingInstructionsRevisionConflictError";
    this.current = current;
  }
}

type MachineConnectCredential = {
  kind: "apiKey" | "connectorToken";
  flag: "--api-key" | "--connector-token";
  value: string;
};
export type MachineConnectorTokenRotation = {
  machine: MachineRecord;
  connectorToken: string;
  rotationId: string;
  expiresAt: string;
  reused: boolean;
};

export type WorkspaceSharedFileStoredRecord = WorkspaceSharedFileRecord & {
  storagePath: string;
  originalStoragePath: string;
};
export type MachineConnectorTokenRotationAck = {
  machine: MachineRecord;
  rotationId: string;
  state: "promoted" | "already_promoted";
};
type MachineInstallationBindingResult =
  | { success: true; machine: MachineRecord }
  | { success: false; reason: "installation_mismatch"; machine: MachineRecord; currentInstallationId: string; receivedInstallationId: string };
type UnreadMarkRecord = {
  unreadCount: number;
  firstUnreadMessageId: string | null;
};
type InboxListOptions = {
  limit?: number;
  offset?: number;
  cursor?: string;
};
type WorkspaceNavigationOptions = {
  section: WorkspaceNavigationSection;
  limit?: number;
  cursor?: string;
};
type WorkspaceMachine = MachineRecord & { latestDaemonVersion: string; runtimes: RuntimeReport[]; agents: AgentRecord[] };
type WorkspaceScope = {
  viewer: UserRecord;
  serverId: string | null;
  currentServer: ServerRecord | null;
  machines: WorkspaceMachine[];
  agents: AgentRecord[];
  humans: UserRecord[];
  channels: ChannelRecord[];
  channelIds: string[];
  devices: DeviceRecord[];
  deviceGrants: DeviceGrantRecord[];
  deviceCommands: DeviceCommandRecord[];
  ownerVisibleAgentIds: string[];
  resourceGrantSummaries: ResourceGrantSummary[];
  incomingServerInvites: IncomingServerInviteRecord[];
};

export type AgentRuntimeSessionIdentity = {
  serverId: string;
  agentId: string;
  machineId: string;
  runtime: RuntimeId;
  contextKind: RuntimeContextKind;
  contextId: string;
  contextKey: string;
};

export type AgentRuntimeSessionCas = AgentRuntimeSessionIdentity & {
  sessionRecordId: string;
  generation: number;
};

const SYSTEM_SENDER_NAME = "TYR";
const LEGACY_SYSTEM_SENDER_NAME = "tyr-ai";
const LEGACY_COMMUNICATION_AGENT_DISPLAY_NAME = ["Tyr", "Assistant"].join(" ");
const COMMUNICATION_AGENT_EMAIL_DOMAIN = "agent.tyr.ai";
const LEGACY_SYSTEM_WELCOME_MESSAGE =
  "Welcome to tyr-ai. Messages, tasks, attachments, runtime context, and agent activity live on the server. Agents receive compact wake messages and use tyr message read/search and tyr task list for context.";
const SYSTEM_WELCOME_MESSAGE =
  "Welcome to TYR. Messages, tasks, attachments, runtime context, and agent activity live on the server. Agents receive compact wake messages and use tyr message read/search and tyr task list for context.";
const WEB_ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const WEB_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const WEB_REFRESH_TOKEN_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WEB_REFRESH_ROTATION_GRACE_MS = 30_000;

function nowIso(): string {
  return new Date().toISOString();
}

function conversationTitleFromContent(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 72);
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function apiKey(): string {
  return `tyr_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function token(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}${randomBytes(12).toString("hex")}`;
}

function temporarySignupPassword(): string {
  return randomBytes(24).toString("base64url");
}

function helpdeskSignupRegistrationDefaults(email: string): { name: string; serverName: string } {
  const localPart = email.split("@")[0]?.split("+")[0] ?? "";
  const words = localPart
    .replace(/[._-]+/g, " ")
    .replace(/[^a-z0-9 ]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const name = words.length > 0
    ? words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase()).join(" ")
    : "Tyr User";
  return {
    name,
    serverName: `${name}'s Workspace`
  };
}

function telegramBindingToken(): string {
  return `tyr_tg_${randomBytes(24).toString("hex")}`;
}

function onboardingCodeHash(code: string): string {
  return bearerTokenHash(code);
}

function bearerTokenHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function serverMemberRole(value: unknown): ServerMemberRole {
  return value === "owner" ? "owner" : value === "guest" ? "guest" : "member";
}

function channelHumanRoleForServerRole(role: ServerMemberRole): ChannelHumanRole {
  return role === "owner" ? "owner" : "member";
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseDmIdentity(value: unknown): DmIdentity | null {
  const parsed = typeof value === "string" ? parseJson<unknown>(value, null) : value;
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.kind === "human_agent" &&
    typeof candidate.humanUserId === "string" &&
    candidate.humanUserId.length > 0 &&
    typeof candidate.agentId === "string" &&
    candidate.agentId.length > 0
  ) {
    return { kind: "human_agent", humanUserId: candidate.humanUserId, agentId: candidate.agentId };
  }
  if (
    candidate.kind === "agent_pair" &&
    Array.isArray(candidate.agentIds) &&
    candidate.agentIds.length === 2 &&
    candidate.agentIds.every((agentId) => typeof agentId === "string" && agentId.length > 0) &&
    candidate.agentIds[0] !== candidate.agentIds[1]
  ) {
    // Agent pair 的顺序不表达角色，持久化和读取时统一排序，确保身份比较稳定。
    const agentIds = [...candidate.agentIds].sort() as [string, string];
    return { kind: "agent_pair", agentIds };
  }
  if (
    candidate.kind === "workspace_bridge" &&
    typeof candidate.bridgeId === "string" &&
    candidate.bridgeId.length > 0 &&
    typeof candidate.workspaceId === "string" &&
    candidate.workspaceId.length > 0 &&
    typeof candidate.agentId === "string" &&
    candidate.agentId.length > 0
  ) {
    // Workspace Bridge DM 只承载单条连接在本 Workspace 一侧的独立 Assistant 会话。
    return {
      kind: "workspace_bridge",
      bridgeId: candidate.bridgeId,
      workspaceId: candidate.workspaceId,
      agentId: candidate.agentId
    };
  }
  return null;
}

function serializeDmIdentity(identity: DmIdentity): string {
  return JSON.stringify(identity);
}

function parsePermissionsJson(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function stringify(value: JsonValue | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function auditMetadata(input: Record<string, JsonValue | undefined>): Record<string, JsonValue> {
  const metadata: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) metadata[key] = value;
  }
  return metadata;
}

function terminalDeviceCommandAuditKind(status: DeviceCommandResult["status"]): string {
  switch (status) {
    case "succeeded":
      return "device_command_succeeded";
    case "denied":
      return "device_command_denied";
    case "expired":
      return "device_command_expired";
    default:
      return "device_command_failed";
  }
}

function stringifyRuntimeModels(models: RuntimeModel[] | undefined): string | null {
  return models === undefined ? null : JSON.stringify(models);
}

function maybeString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function governancePolicyConfigScope(value: unknown): GovernancePolicyConfigScope {
  return value === "agent" ? "agent" : "workspace";
}

function governancePolicyConfigAuditAction(_value: unknown): GovernancePolicyConfigAuditAction {
  return "upsert";
}

function governancePolicyRules(): GovernancePolicyRule[] {
  return ["destructive_command", "secret_external_send", "cross_context", "unknown_action", "sensitive_upload"];
}

function isGovernanceDecisionValue(value: unknown): value is GovernanceDecisionValue {
  return value === "allow" || value === "require_human" || value === "deny" || value === "unknown";
}

function sanitizeGovernancePolicyRules(value: unknown): GovernancePolicyRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: GovernancePolicyRules = {};
  const input = value as Record<string, unknown>;
  for (const rule of governancePolicyRules()) {
    const decision = input[rule];
    if (isGovernanceDecisionValue(decision)) output[rule] = decision;
  }
  return output;
}

function sanitizeGovernancePolicyVersion(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return (trimmed || "policy-db-v1").slice(0, 80);
}

function sortedGovernancePolicyRuleKeys(rules: GovernancePolicyRules): GovernancePolicyRule[] {
  return governancePolicyRules().filter((rule) => rules[rule] !== undefined);
}

function changedGovernancePolicyRuleKeys(previous: GovernancePolicyRules, next: GovernancePolicyRules): GovernancePolicyRule[] {
  return governancePolicyRules().filter((rule) => previous[rule] !== next[rule]);
}

const builtInDeviceCapabilityDescriptors = new Map(BUILT_IN_DEVICE_CAPABILITY_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]));

function normalizeDeviceCapabilities(capabilities: DeviceCapability[]): DeviceCapability[] {
  const seen = new Set<string>();
  const normalized: DeviceCapability[] = [];
  for (const capability of capabilities) {
    if (typeof capability !== "string" || !capability.trim() || seen.has(capability)) continue;
    seen.add(capability);
    normalized.push(capability);
  }
  return normalized;
}

function normalizeDeviceCapabilityDescriptors(capabilities: DeviceCapability[], descriptors: DeviceCapabilityDescriptor[] = []): DeviceCapabilityDescriptor[] {
  const capabilityIds = normalizeDeviceCapabilities(capabilities);
  const declared = new Set(capabilityIds);
  const byId = new Map<DeviceCapability, DeviceCapabilityDescriptor>();
  for (const descriptor of descriptors) {
    if (!descriptor || !declared.has(descriptor.id) || !descriptor.label || !["low", "medium", "high"].includes(descriptor.riskLevel)) continue;
    byId.set(descriptor.id, {
      id: descriptor.id,
      label: descriptor.label,
      description: descriptor.description,
      riskLevel: descriptor.riskLevel,
      inputSchema: descriptor.inputSchema,
      resultSchema: descriptor.resultSchema
    });
  }
  return capabilityIds.map((capability) => {
    // 旧客户端只会上报 capability id；内置能力需要生成可读描述，非内置能力至少保留 id 供 Agent 调用。
    return byId.get(capability) ?? builtInDeviceCapabilityDescriptors.get(capability) ?? {
      id: capability,
      label: capability,
      riskLevel: "medium"
    };
  });
}

function defaultMachineName(): string {
  return "New Computer";
}

export interface CreateAgentInput {
  machineId: string;
  name: string;
  description?: string;
  runtime: RuntimeId;
  model?: string;
  reasoningEffort?: AgentRecord["reasoningEffort"];
  permissionMode?: RuntimePermissionMode;
  runtimeResourceGrants?: RuntimeResourceGrant[];
  envVars?: Record<string, string>;
  createdByUserId?: string;
  creationBridgeRequestId?: string;
  creationTraceId?: string;
}

export interface SendMessageInput {
  /** Internal authenticated personal-reply path; never forwarded from arbitrary message API input. */
  personalReplyRequestId?: string;
  target: string;
  conversationId?: string;
  allowClosedConversation?: boolean;
  content: string;
  kind?: MessageKind;
  senderType: SenderType;
  senderId: string;
  senderName: string;
  result?: MessageResult;
  sourceExecutionId?: string;
  asTask?: boolean;
  task?: TaskCreateDetails;
  attachmentIds?: string[];
  deviceRefs?: MessageDeviceRef[];
  quoteMessageId?: string;
  serverId?: string;
}

type TaskCreateDetails = {
  title?: string;
};

export interface CreateConversationInput {
  channelId: string;
  title?: string;
  startedByType: SenderType;
  startedById: string;
  /** TYR 通道保留独立可写会话，不关闭兄弟上下文。 */
  closeExisting?: boolean;
  /** 外部通道不得静默替换 Web 当前选中的会话。 */
  setActive?: boolean;
  resetStatus?: ConversationResetStatus;
  resetAgentId?: string | null;
  resetReason?: string | null;
}

export type MessageHistoryScope = "conversation" | "dm_history" | "all_accessible";

export interface AgentChannelMembership {
  agentId: string;
  channelId: string;
  joined: boolean;
  ordinaryDeliveryEnabled: boolean;
  updatedAt: string;
}

export interface ReadHistoryResult {
  channel: ChannelRecord;
  messages: MessageRecord[];
  has_more: boolean;
  has_older?: boolean;
  has_newer?: boolean;
  last_read_seq?: number;
}

export interface CreateChannelInput {
  serverId?: string;
  name: string;
  displayName?: string;
  description?: string;
  visibility?: ChannelVisibility;
  createdByUserId?: string;
  memberAgentIds?: string[];
}

export interface CreateResourceGrantInput {
  resourceType: ResourceType;
  resourceId: string;
  granteeUserId: string;
  scopes: ResourceGrantScope[];
  createdByUserId: string;
}

export interface CreateDevicePairingTokenInput {
  serverId: string;
  createdByUserId: string;
  displayName?: string;
  pinnedAgentId?: string;
  expiresAt?: string;
}

export interface ConnectDeviceWithPairingTokenInput {
  pairingToken: string;
  displayName: string;
  deviceKind: DeviceKind;
  platform: DevicePlatform;
  appVersion: string;
  capabilities: DeviceCapability[];
  capabilityDescriptors?: DeviceCapabilityDescriptor[];
  permissionStates: Partial<Record<DeviceCapability, DevicePermissionState>>;
}

export interface CreateOrUpdateMobileAppBindingInput {
  serverId: string;
  userId: string;
  deviceId: string;
}

export type TelegramBindingCodeStatus = "pending" | "consumed" | "expired";
export type TelegramAccountStatus = "active" | "revoked";
export type TelegramApprovalActionDecision = "approve" | "reject";
export type TelegramApprovalActionStatus = "pending" | "consumed";

export interface TelegramBindingCodeRecord {
  id: string;
  userId: string;
  serverId: string;
  status: TelegramBindingCodeStatus;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
}

export interface TelegramBindingCodeCreated extends TelegramBindingCodeRecord {
  code: string;
}

export interface CreateTelegramBindingCodeInput {
  userId: string;
  serverId: string;
  expiresAt?: string;
}

export interface TelegramAccountRecord {
  id: string;
  userId: string;
  serverId: string;
  telegramUserId: string;
  telegramChatId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  status: TelegramAccountStatus;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
}

export interface ConsumeTelegramBindingCodeInput {
  telegramUserId: string;
  telegramChatId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export type TelegramOutboundDeliveryStatus = "pending" | "sending" | "retry" | "sent" | "failed" | "cancelled";

export interface TelegramOutboundDeliveryRecord {
  id: string;
  telegramAccountId: string;
  telegramChatId: string;
  messageId: string;
  messageSeq: number;
  chunkIndex: number;
  text: string;
  status: TelegramOutboundDeliveryStatus;
  attempts: number;
  nextAttemptAt: string;
  telegramMessageId?: string;
  lastError?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueTelegramOutboundDeliveriesInput {
  telegramAccountId: string;
  telegramChatId: string;
  messageId: string;
  messageSeq: number;
  chunks: string[];
}

export interface TelegramApprovalActionRecord {
  id: string;
  approvalId: string;
  serverId: string;
  userId: string;
  telegramUserId: string;
  decision: TelegramApprovalActionDecision;
  status: TelegramApprovalActionStatus;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTelegramApprovalActionInput {
  approvalId: string;
  serverId: string;
  userId: string;
  telegramUserId: string;
  decision: TelegramApprovalActionDecision;
  expiresAt: string;
}

export interface TelegramRateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
  resetAt: string;
}

export interface CreateDeviceGrantInput {
  serverId: string;
  agentId: string;
  deviceId: string;
  capabilities: DeviceCapability[];
  scope: DeviceGrantScope;
  expiresAt?: string;
  createdByUserId: string;
}

export interface CreateDeviceCommandInput {
  serverId: string;
  agentId: string;
  deviceId: string;
  grantId?: string;
  capability: DeviceCapability;
  params?: Record<string, unknown>;
  requestedByMessageId?: string;
  channelId?: string;
  taskId?: string;
  reason?: string;
  expiresAt: string;
}

export interface ResourceGrantFilter {
  resourceType?: ResourceType;
  resourceId?: string;
  granteeUserId?: string;
  activeOnly?: boolean;
}

export interface AuditEventInput {
  kind: string;
  actorType: AuditEventRecord["actorType"];
  actorId?: string | null;
  resourceType: AuditEventRecord["resourceType"];
  resourceId?: string | null;
  serverId?: string | null;
  metadata?: Record<string, JsonValue>;
}

export interface AuditEventFilter {
  serverId?: string;
  resourceType?: AuditEventRecord["resourceType"];
  resourceId?: string;
  resourceIds?: string[];
  limit?: number;
  order?: "asc" | "desc";
}

export interface ReminderEventRecord {
  reminderId: string;
  at: string;
  type: string;
  detail?: string;
}

export type HelpdeskSignupCompleteResult =
  | { ok: true; intent: HelpdeskSignupIntentRecord; user: UserRecord; accessToken: string; refreshToken: string }
  | { ok: false; reason: "invalid" | "expired" | "completed" | "user_exists" | "invalid_registration" | "invite_unavailable"; intent?: HelpdeskSignupIntentRecord };

export type HelpdeskPasswordRecoveryCompleteResult =
  | { ok: true; intent: HelpdeskPasswordRecoveryIntentRecord; user: UserRecord; accessToken: string; refreshToken: string }
  | { ok: false; reason: "invalid" | "expired" | "completed" | "invalid_password"; intent?: HelpdeskPasswordRecoveryIntentRecord };

export type HelpdeskResendEmailEventStatus = "processing" | "processed" | "failed";

export interface HelpdeskResendEmailEventRecord {
  emailId: string;
  svixId?: string | null;
  status: HelpdeskResendEmailEventStatus;
  helpdeskStatus?: string | null;
  replyEmailId?: string | null;
  errorCode?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommunicationAgentEmailAliasRecord {
  isPrimary: boolean;
  id: string;
  serverId: string;
  userId: string;
  assistantAgentId: string;
  address: string;
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
}

export type DeleteConversationResult = {
  success: boolean;
  conversation?: ConversationRecord;
  reason?: "conversation_not_found" | "conversation_active" | "conversation_not_archived";
  deletedMessageIds?: string[];
  deletedThreadChannelIds?: string[];
};

type CommunicationAgentManagementDraftScope = Pick<
  CommunicationAgentManagementDraftRecord,
  "serverId" | "userId" | "assistantAgentId" | "source" | "sourceConversationKey"
>;

type CommunicationAgentManagementDraftSourceEventScope = CommunicationAgentManagementDraftScope & {
  sourceEventKey: string;
};

interface CreateCommunicationAgentManagementDraftInput extends CommunicationAgentManagementDraftScope {
  channelId: string;
  sourceMessageId: string;
  sourceEventKey: string;
  action: CommunicationAgentManagementAction;
  stage: CommunicationAgentManagementDraftStage;
  params?: CommunicationAgentManagementParams;
  choices?: CommunicationAgentManagementChoice[];
  replyText?: string | null;
  expiresAt?: string;
}

interface UpdateCommunicationAgentManagementDraftInput {
  stage?: CommunicationAgentManagementDraftStage;
  params?: CommunicationAgentManagementParams;
  choices?: CommunicationAgentManagementChoice[];
  replyText?: string | null;
  expiresAt?: string;
}

interface ResolveCommunicationAgentManagementDraftInput {
  replyText?: string | null;
  errorCode?: string | null;
}

export interface TyrDb {
  db: Database.Database;
  currentUser(userId?: string): UserRecord;
  getUser(userId: string): UserRecord | null;
  findUser(identifier: string): UserRecord | null;
  snapshot(userId?: string): AppSnapshot;
  workspaceBootstrap(userId?: string): WorkspaceBootstrapPayload;
  workspaceNavigation(userId: string, options: WorkspaceNavigationOptions): WorkspaceNavigationPayload;
  registerUser(input: { email: string; password: string; name: string; serverName?: string; passwordSetupRequired?: boolean }): { user: UserRecord; accessToken: string; refreshToken: string };
  loginUser(input: { email: string; password: string }): { user: UserRecord; accessToken: string; refreshToken: string } | null;
  createPlatformOperator(input: { login: string; password: string; displayName: string }): PlatformOperatorRecord;
  findPlatformOperator(login: string): PlatformOperatorRecord | null;
  verifyPlatformOperatorPassword(operatorId: string, password: string): boolean;
  loginPlatformOperator(input: { login: string; password: string }): { operator: PlatformOperatorRecord; sessionToken: string; expiresAt: string } | null;
  getPlatformOperatorBySessionToken(sessionToken: string): PlatformOperatorRecord | null;
  revokePlatformOperatorSession(sessionToken: string): void;
  upsertPlatformOperatorWorkspaceGrant(input: { operatorId: string; serverId: string; scopes: PlatformOperatorScope[] }): PlatformOperatorWorkspaceGrantRecord;
  listPlatformOperatorWorkspaceGrants(operatorId: string): PlatformOperatorWorkspaceGrantRecord[];
  hasPlatformOperatorScope(operatorId: string, serverId: string, scope: PlatformOperatorScope): boolean;
  listPlatformOperatorWorkspaces(operatorId: string): PlatformOperatorWorkspaceRecord[];
  createTyrHeartbeat(input: { serverId: string; tyrAgentId: string; title: string; instruction: string; intervalUnit: TyrHeartbeatIntervalUnit; intervalValue: number; createdByUserId?: string; createdByOperatorId?: string }): TyrHeartbeatRecord;
  updateTyrHeartbeat(heartbeatId: string, serverId: string, input: { title?: string; instruction?: string; intervalUnit?: TyrHeartbeatIntervalUnit; intervalValue?: number; enabled?: boolean }): TyrHeartbeatRecord | null;
  getTyrHeartbeat(heartbeatId: string, serverId?: string): TyrHeartbeatRecord | null;
  listTyrHeartbeats(serverId?: string): TyrHeartbeatRecord[];
  enqueueDueTyrHeartbeatRuns(now?: string): TyrHeartbeatRunRecord[];
  claimNextTyrHeartbeatRun(heartbeatId: string, now?: string): TyrHeartbeatRunRecord | null;
  updateTyrHeartbeatRun(runId: string, input: { status?: TyrHeartbeatRunStatus; sourceMessageId?: string | null; executionIds?: string[]; selectedAgentId?: string | null; errorCode?: string | null; errorMessage?: string | null; completedAt?: string | null }): TyrHeartbeatRunRecord | null;
  cancelQueuedTyrHeartbeatRuns(heartbeatId: string, input?: { errorCode?: string; errorMessage?: string }): TyrHeartbeatRunRecord[];
  listTyrHeartbeatRuns(input?: { serverId?: string; heartbeatId?: string; status?: TyrHeartbeatRunStatus; limit?: number }): TyrHeartbeatRunRecord[];
  createWorkspaceSharedFile(input: { id?: string; serverId: string; name: string; mimeType: string; sizeBytes: number; sha256: string; storagePath: string; originalName?: string; originalMimeType?: string; originalSizeBytes?: number; originalSha256?: string; originalStoragePath?: string; createdByUserId?: string; createdByOperatorId?: string }): WorkspaceSharedFileStoredRecord;
  getWorkspaceSharedFile(fileId: string, serverId?: string): WorkspaceSharedFileStoredRecord | null;
  listWorkspaceSharedFiles(serverId: string): WorkspaceSharedFileRecord[];
  listAgentSharedFiles(agentId: string): Array<{ file: WorkspaceSharedFileStoredRecord; permission: WorkspaceSharedFilePermission }>;
  replaceWorkspaceSharedFile(input: { fileId: string; serverId: string; expectedVersion: number; name?: string; mimeType: string; sizeBytes: number; sha256: string; storagePath: string }): WorkspaceSharedFileStoredRecord | null;
  replaceWorkspaceSharedFileOriginal(input: { fileId: string; serverId: string; expectedVersion: number; originalName: string; mimeType: string; sizeBytes: number; sha256: string; storagePath: string }): WorkspaceSharedFileStoredRecord | null;
  renameWorkspaceSharedFile(fileId: string, serverId: string, name: string): WorkspaceSharedFileStoredRecord | null;
  setWorkspaceSharedFileAssignments(input: { fileId: string; serverId: string; assignments: Array<{ agentId: string; permission: WorkspaceSharedFilePermission }>; createdByUserId?: string; createdByOperatorId?: string }): WorkspaceSharedFileRecord | null;
  deleteWorkspaceSharedFile(fileId: string, serverId: string): WorkspaceSharedFileStoredRecord | null;
  refreshSession(refreshToken: string): { user: UserRecord; accessToken: string; refreshToken: string } | null;
  createHelpdeskSignupIntent(input: { email: string; source: HelpdeskSignupIntentRecord["source"]; subject?: string | null; message?: string | null; expiresAt?: string; returnPath?: string }): { intent: HelpdeskSignupIntentRecord; token: string };
  getHelpdeskSignupIntentByToken(token: string): HelpdeskSignupIntentRecord | null;
  completeHelpdeskSignupIntent(token: string, input: { name?: string; password?: string; serverName?: string }): HelpdeskSignupCompleteResult;
  createHelpdeskPasswordRecoveryIntent(input: { email: string; userId: string; source: HelpdeskPasswordRecoveryIntentRecord["source"]; subject?: string | null; message?: string | null; expiresAt?: string }): { intent: HelpdeskPasswordRecoveryIntentRecord; token: string };
  getHelpdeskPasswordRecoveryIntentByToken(token: string): HelpdeskPasswordRecoveryIntentRecord | null;
  completeHelpdeskPasswordRecoveryIntent(token: string, input: { password: string }): HelpdeskPasswordRecoveryCompleteResult;
  claimHelpdeskResendEmailEvent(emailId: string, svixId?: string): { claimed: true; event: HelpdeskResendEmailEventRecord } | { claimed: false; event: HelpdeskResendEmailEventRecord };
  completeHelpdeskResendEmailEvent(emailId: string, input: { helpdeskStatus?: string; replyEmailId?: string }): HelpdeskResendEmailEventRecord | null;
  failHelpdeskResendEmailEvent(emailId: string, errorCode: string): HelpdeskResendEmailEventRecord | null;
  ensureCommunicationAgentEmailAlias(input: {
    serverId: string;
    userId: string;
    assistantAgentId: string;
    domain: string;
  }): CommunicationAgentEmailAliasRecord;
  getCommunicationAgentEmailAliasByAddress(address: string): CommunicationAgentEmailAliasRecord | null;
  listCommunicationAgentEmailAliases(assistantAgentId: string): CommunicationAgentEmailAliasRecord[];
  getCommunicationAgentEmailSettings(input: { agentId: string; userId: string; localPart?: string }): TyrEmailSettings;
  updateCommunicationAgentEmailAlias(input: { agentId: string; userId: string; localPart: string; expectedAddress: string }): TyrEmailSettings;
  getOrCreateCommunicationAgentExternalConversation(input: {
    source: "telegram" | "email";
    serverId: string;
    userId: string;
    assistantAgentId: string;
    sourceConversationKeys: string[];
    title: string;
    replace?: boolean;
  }): ConversationRecord | null;
  getOrCreateCommunicationAgentHandoffConversation(input: {
    serverId: string;
    sourceConversationId: string;
    assistantAgentId: string;
    targetAgentId: string;
    channelId: string;
  }): ConversationRecord | null;
  createCommunicationAgentPendingAction(input: {
    serverId: string;
    userId: string;
    assistantAgentId: string;
    channelId: string;
    targetAgentId: string;
    instruction: string;
    sourceMessageId?: string | null;
    suggestionMessageId?: string | null;
    expiresAt?: string;
  }): CommunicationAgentPendingActionRecord;
  getCommunicationAgentPendingAction(actionId: string): CommunicationAgentPendingActionRecord | null;
  getLatestCommunicationAgentPendingAction(input: { serverId: string; userId: string; assistantAgentId: string; channelId: string }): CommunicationAgentPendingActionRecord | null;
  hasUnresolvedCommunicationAgentPendingAction(input: { serverId: string; userId: string; assistantAgentId: string; channelId: string }): boolean;
  attachCommunicationAgentPendingActionSuggestionMessage(actionId: string, suggestionMessageId: string): CommunicationAgentPendingActionRecord | null;
  resolveCommunicationAgentPendingAction(actionId: string, status: Exclude<CommunicationAgentPendingActionStatus, "pending">): CommunicationAgentPendingActionRecord | null;
  createCommunicationAgentManagementDraft(input: CreateCommunicationAgentManagementDraftInput): { created: boolean; record: CommunicationAgentManagementDraftRecord };
  getCommunicationAgentManagementDraft(draftId: string): CommunicationAgentManagementDraftRecord | null;
  getLatestCommunicationAgentManagementDraft(input: CommunicationAgentManagementDraftScope): CommunicationAgentManagementDraftRecord | null;
  getLatestResolvedCommunicationAgentManagementDraft(input: CommunicationAgentManagementDraftScope): CommunicationAgentManagementDraftRecord | null;
  attachCommunicationAgentManagementDraftSourceEvent(
    draftId: string,
    input: CommunicationAgentManagementDraftSourceEventScope
  ): CommunicationAgentManagementDraftRecord | null;
  getCommunicationAgentManagementDraftBySourceEvent(
    input: CommunicationAgentManagementDraftSourceEventScope
  ): CommunicationAgentManagementDraftRecord | null;
  updateCommunicationAgentManagementDraft(draftId: string, input: UpdateCommunicationAgentManagementDraftInput): CommunicationAgentManagementDraftRecord | null;
  claimCommunicationAgentManagementDraft(draftId: string): CommunicationAgentManagementDraftRecord | null;
  resolveCommunicationAgentManagementDraft(
    draftId: string,
    status: Extract<CommunicationAgentManagementDraftStatus, "completed" | "failed" | "cancelled">,
    input?: ResolveCommunicationAgentManagementDraftInput
  ): CommunicationAgentManagementDraftRecord | null;
  getUserByAccessToken(accessToken: string): UserRecord | null;
  logoutSession(refreshToken: string): void;
  updateUserProfile(userId: string, input: { displayName?: string; description?: string | null; preferredLanguage?: string | null }): UserRecord;
  verifyUserPassword(userId: string, password: string): boolean;
  changeUserPassword(userId: string, currentPassword: string, nextPassword: string): boolean;
  setupUserPassword(userId: string, nextPassword: string): UserRecord;
  listServersForUser(userId: string): ServerRecord[];
  getActiveServerIdForUser(userId: string): string | null;
  setActiveServerForUser(userId: string, serverId: string): ServerRecord | null;
  ensurePersonalServerForUser(userId: string): ServerRecord;
  createServer(input: { name: string; ownerUserId: string }): ServerRecord;
  updateServerName(serverId: string, name: string): ServerRecord | null;
  createServerInvite(email: string, invitedByUserId: string, serverId?: string): ServerInviteRecord;
  listServerInvites(status?: string, serverId?: string): ServerInviteRecord[];
  listIncomingServerInvites(email: string): IncomingServerInviteRecord[];
  acceptServerInviteForUser(inviteId: string, userId: string): ServerInviteRecord | null;
  revokeServerInvite(inviteId: string): ServerInviteRecord | null;
  createWorkspaceBridge(input: { sourceWorkspaceId: string; invitedByUserId: string; targetUserEmail: string }): WorkspaceBridgeRecord;
  listWorkspaceBridges(serverId: string): WorkspaceBridgeRecord[];
  listIncomingWorkspaceBridges(userId: string): WorkspaceBridgeRecord[];
  getWorkspaceBridgeForServer(bridgeId: string, serverId: string): WorkspaceBridgeRecord | null;
  acceptWorkspaceBridge(bridgeId: string, userId: string): WorkspaceBridgeRecord | null;
  revokeWorkspaceBridge(bridgeId: string, userId: string): WorkspaceBridgeRecord | null;
  workspaceBridgeTopology(serverId: string): {
    peerWorkspaceTopologies: WorkspaceBridgeTopologySnapshot[];
    workspaceBridgeTopologyEdges: WorkspaceBridgeTopologyEdge[];
  };
  createCrossWorkspaceMessage(input: {
    bridgeId: string;
    conversationId?: string | null;
    clientRequestId?: string | null;
    retryOfMessageId?: string | null;
    responseKind?: CrossWorkspaceMessageResponseKind | null;
    originConversationKey?: string | null;
    originChannelId?: string | null;
    originConversationId?: string | null;
    originMessageId?: string | null;
    originSource?: CommunicationAgentManagementSource | null;
    originExternalRef?: string | null;
    /** Explicit TYR wait target; ordinary Bridge sends do not create a continuation. */
    awaitingAgentId?: string | null;
    sourceWorkspaceId: string;
    targetWorkspaceId: string;
    senderUserId?: string | null;
    senderUserName?: string | null;
    senderUserDisplayName?: string | null;
    senderUserAvatarUrl?: string | null;
    sourceCapabilityUserId?: string | null;
    targetCapabilityUserId?: string | null;
    originalSenderUserId?: string | null;
    traceId?: string | null;
    parentBridgeRequestId?: string | null;
    hopCount?: number;
    attachmentIds?: string[];
    sourceAgentNames?: string[];
    initiatedBy: CrossWorkspaceMessageInitiator;
    content: string;
    outcome?: CrossWorkspaceMessageOutcome;
    localMessageId?: string | null;
    peerMessageId?: string | null;
    replyToMessageId?: string | null;
  }): CrossWorkspaceMessageRecord;
  createCrossWorkspaceTerminalMessage(input: {
    bridgeId: string;
    conversationId: string;
    responseKind: Extract<CrossWorkspaceMessageResponseKind, "final" | "error">;
    sourceWorkspaceId: string;
    targetWorkspaceId: string;
    initiatedBy: "agent";
    content: string;
    outcome: CrossWorkspaceMessageOutcome;
    localMessageId?: string | null;
    peerMessageId?: string | null;
    replyToMessageId: string;
    attachmentIds?: string[];
    sourceAgentNames?: string[];
    reviewedChildTerminalId?: string;
  }): { message: CrossWorkspaceMessageRecord; created: boolean };
  createCrossWorkspaceInteractionMessage(input: {
    requestId: string;
    eventId: string;
    kind: Extract<CrossWorkspaceMessageResponseKind, "progress" | "question" | "action_request" | "answer" | "instruction" | "continue">;
    content: string;
    localMessageId?: string | null;
  }): { message: CrossWorkspaceMessageRecord; created: boolean } | null;
  getCrossWorkspaceMessage(messageId: string): CrossWorkspaceMessageRecord | null;
  hasReviewedDownstreamResult(messageId: string): boolean;
  listCrossWorkspaceRequestsForSourceMessage(sourceMessageId: string): CrossWorkspaceMessageRecord[];
  armCrossWorkspaceContinuationsForSourceMessage(sourceMessageId: string): string[];
  recoverReadyCrossWorkspaceContinuations(): string[];
  claimCrossWorkspaceContinuation(requestId: string): { request: CrossWorkspaceMessageRecord; terminal: CrossWorkspaceMessageRecord } | null;
  completeCrossWorkspaceContinuation(requestId: string, replyMessageId: string | null): void;
  countCrossWorkspaceContinuationsForSourceMessage(sourceMessageId: string): number;
  getCrossWorkspaceMessageByClientRequest(input: {
    bridgeId: string;
    conversationId: string;
    sourceWorkspaceId: string;
    clientRequestId: string;
  }): CrossWorkspaceMessageRecord | null;
  updateCrossWorkspaceMessage(messageId: string, input: {
    outcome?: CrossWorkspaceMessageOutcome;
    localMessageId?: string | null;
    peerMessageId?: string | null;
    originMessageId?: string | null;
    originExternalDeliveredAt?: string | null;
  }): CrossWorkspaceMessageRecord | null;
  listCrossWorkspaceMessages(bridgeId: string, options?: { conversationId?: string }): CrossWorkspaceMessageRecord[];
  listCrossWorkspaceChildRequests(parentRequestId: string): CrossWorkspaceMessageRecord[];
  listCrossWorkspaceMessagesPage(bridgeId: string, options?: { limit?: number; beforeCreatedAt?: string | null; conversationId?: string }): WorkspaceBridgeMessagesPayload;
  listServerMembers(serverId?: string): Array<UserRecord & { role: ServerMemberRole; joinedAt: string; gravatarHash?: string | null }>;
  removeServerMember(userId: string, serverId?: string): { ok: boolean; error?: string };
  serverUsage(serverId?: string): { agents: number; machines: number };
  getServerSidebarOrder(serverId: string): SidebarOrderSettings;
  setServerSidebarOrder(serverId: string, input: Partial<SidebarOrderSettings>): SidebarOrderSettings;
  getWorkspaceRoutingInstructions(serverId: string): WorkspaceRoutingInstructionsRecord;
  setWorkspaceRoutingInstructions(serverId: string, instructions: string, updater: WorkspaceRoutingInstructionsUpdater): WorkspaceRoutingInstructionsRecord | null;
  createMachineKey(name?: string, ownerUserId?: string, serverId?: string): MachineRecord;
  getMachineByKey(key: string): MachineRecord | null;
  getMachineConnectCredential(machineId: string): MachineConnectCredential | null;
  createMachineOnboardingIntent(input: {
    serverId: string;
    machineId: string;
    requestedByUserId: string;
    requestedByAgentId?: string | null;
    expiresAt?: string;
  }): { intent: MachineOnboardingIntentRecord; code: string };
  getMachineOnboardingIntentByCode(code: string): MachineOnboardingIntentRecord | null;
  consumeMachineOnboardingIntent(code: string): { intent: MachineOnboardingIntentRecord; machine: MachineRecord; credential: MachineConnectCredential } | null;
  revokeMachineOnboardingIntent(intentId: string, revokedByUserId: string): MachineOnboardingIntentRecord | null;
  getMachine(id: string): MachineRecord | null;
  listMachines(serverId?: string, options?: { includeDeleted?: boolean }): MachineRecord[];
  issueMachineConnectorToken(machineId: string): { machine: MachineRecord; connectorToken: string } | null;
  rotateMachineConnectorToken(machineId: string): MachineConnectorTokenRotation | null;
  hasPendingMachineWork(machineId: string): boolean;
  getPendingMachineConnectorTokenRotation(machineId: string): MachineConnectorTokenRotation | null;
  acknowledgeMachineConnectorTokenRotation(machineId: string, rotationId: string): MachineConnectorTokenRotationAck | null;
  revokeMachineConnectorToken(machineId: string): MachineRecord | null;
  updateMachineName(machineId: string, name: string): MachineRecord | null;
  bindMachineInstallation(machineId: string, input: { installationId?: string; hostFingerprint?: string }): MachineInstallationBindingResult | null;
  updateMachineReady(machineId: string, ready: {
    hostname: string;
    os: string;
    daemonVersion: string;
    runtimes: RuntimeId[];
    runtimeVersions?: Record<string, string>;
    runtimeReports?: RuntimeReport[];
    runtimeMarker?: string;
    runtimeSha?: string;
    runtimeMarkerMtime?: string;
  }): MachineRecord;
  updateRuntimeModels(machineId: string, runtime: RuntimeId, models: RuntimeModel[], defaultModel?: string): RuntimeReport | null;
  updateRuntimeAuthStatus(machineId: string, runtime: RuntimeId, authStatus: RuntimeAuthStatus, reason?: string): RuntimeReport | null;
  touchMachineLastSeen(machineId: string): MachineRecord | null;
  markMachineOffline(machineId: string): void;
  listRuntimeReports(machineId: string): RuntimeReport[];
  createAgent(input: CreateAgentInput, ownerUserId?: string): AgentRecord;
  createCommunicationAgent(serverId?: string, ownerUserId?: string): AgentRecord;
  ensureDefaultCommunicationAgent(serverId?: string): AgentRecord;
  getAgent(id: string): AgentRecord | null;
  getAgentByToken(token: string): AgentRecord | null;
  listAgents(serverId?: string, options?: { includeDeleted?: boolean }): AgentRecord[];
  updateAgentStatus(agentId: string, status: AgentRecord["status"], detail?: string): void;
  setAgentDesiredRuntimeState(agentId: string, state: NonNullable<AgentRecord["desiredRuntimeState"]>): AgentRecord | null;
  updateAgentLaunch(agentId: string, launchId: string): void;
  updateAgentSession(agentId: string, sessionId: string, launchId?: string, workspacePath?: string): void;
  clearAgentSession(agentId: string, detail?: string): AgentRecord | null;
  resetAgentRuntimeSessions(agentId: string, detail?: string): { agent: AgentRecord; invalidatedSessions: AgentRuntimeSessionRecord[] } | null;
  updateAgentProfile(agentId: string, input: { displayName?: string; description?: string; avatarUrl?: string }): AgentRecord | null;
  updateAgentConfiguration(agentId: string, input: UpdateAgentConfigurationInput): AgentRecord | null;
  updateAgentProfileApplication(agentId: string, input: { profileRevision: number; error?: string | null }): AgentRecord | null;
  updateAgentPermissionMode(agentId: string, permissionMode: RuntimePermissionMode): AgentRecord | null;
  updateAgentRuntimeResourceGrants(agentId: string, grants: RuntimeResourceGrant[]): AgentRecord | null;
  getAgentScopes(agentId: string): AgentScopes | null;
  setAgentScopes(agentId: string, granted: AgentCapability[]): AgentScopes | null;
  resetAgentScopes(agentId: string): AgentScopes | null;
  hasAgentCapability(agentId: string, capability: AgentCapability): boolean;
  getAgentRuntimeEnvVars(agentId: string): Record<string, string>;
  deleteAgent(agentId: string): boolean;
  deleteMachine(machineId: string): { success: boolean; reason?: string; deletedAgents?: number };
  createResourceGrant(input: CreateResourceGrantInput): ResourceGrantRecord;
  revokeResourceGrant(grantId: string, revokedByUserId?: string): ResourceGrantRecord | null;
  listResourceGrants(filter?: ResourceGrantFilter): ResourceGrantRecord[];
  resourceOwnerUserId(resourceType: ResourceType, resourceId: string): string | null;
  resourceGrantScopesForUser(userId: string, resourceType: ResourceType, resourceId: string): ResourceGrantScope[];
  canUserAccessResource(userId: string, resourceType: ResourceType, resourceId: string, scope: ResourceGrantScope): boolean;
  createDevicePairingToken(input: CreateDevicePairingTokenInput): DevicePairingTokenRecord;
  connectDeviceWithPairingToken(input: ConnectDeviceWithPairingTokenInput): { device: DeviceRecord; deviceToken: string; pairing: DevicePairingTokenRecord } | null;
  getDevice(deviceId: string): DeviceRecord | null;
  getDeviceByToken(deviceToken: string): DeviceRecord | null;
  listDevices(serverId?: string): DeviceRecord[];
  listVisibleDevices(userId: string, options?: { limit?: number; cursor?: string }): DeviceListPayload;
  deleteDevice(deviceId: string, deletedByUserId?: string): DeviceRecord | null;
  createOrUpdateMobileAppBinding(input: CreateOrUpdateMobileAppBindingInput): MobileAppBindingRecord | null;
  getMobileAppBinding(bindingId: string): MobileAppBindingRecord | null;
  getMobileAppBindingByDevice(deviceId: string): MobileAppBindingRecord | null;
  setMobileAppPinnedAgent(bindingId: string, agentId: string, channelId: string): MobileAppBindingRecord | null;
  revokeMobileAppBinding(bindingId: string): MobileAppBindingRecord | null;
  touchMobileAppBinding(bindingId: string): MobileAppBindingRecord | null;
  createTelegramBindingCode(input: CreateTelegramBindingCodeInput): TelegramBindingCodeCreated;
  getTelegramBindingCode(code: string): TelegramBindingCodeRecord | null;
  consumeTelegramBindingCode(code: string, input: ConsumeTelegramBindingCodeInput): TelegramAccountRecord | null;
  getTelegramAccount(accountId: string): TelegramAccountRecord | null;
  getTelegramAccountByTelegramUserId(telegramUserId: string): TelegramAccountRecord | null;
  getTelegramAccountByUserId(userId: string): TelegramAccountRecord | null;
  revokeTelegramAccountForUser(userId: string): TelegramAccountRecord | null;
  touchTelegramAccount(accountId: string): TelegramAccountRecord | null;
  enqueueTelegramOutboundDeliveries(input: EnqueueTelegramOutboundDeliveriesInput): TelegramOutboundDeliveryRecord[];
  listTelegramOutboundDeliveries(filter?: { telegramAccountId?: string; messageId?: string; status?: TelegramOutboundDeliveryStatus }): TelegramOutboundDeliveryRecord[];
  claimNextTelegramOutboundDelivery(at?: string): TelegramOutboundDeliveryRecord | null;
  markTelegramOutboundDeliverySent(deliveryId: string, telegramMessageId?: string): TelegramOutboundDeliveryRecord | null;
  retryTelegramOutboundDelivery(deliveryId: string, nextAttemptAt: string, error: string): TelegramOutboundDeliveryRecord | null;
  failTelegramOutboundDelivery(deliveryId: string, error: string): TelegramOutboundDeliveryRecord | null;
  cancelTelegramOutboundDelivery(deliveryId: string): TelegramOutboundDeliveryRecord | null;
  resetSendingTelegramOutboundDeliveries(): number;
  createTelegramApprovalAction(input: CreateTelegramApprovalActionInput): TelegramApprovalActionRecord;
  getTelegramApprovalAction(actionId: string): TelegramApprovalActionRecord | null;
  consumeTelegramApprovalAction(actionId: string, consumedAt?: string): TelegramApprovalActionRecord | null;
  claimTelegramWebhookUpdate(updateId: string, ttlSeconds?: number): { claimed: boolean };
  checkTelegramRateLimit(input: { scopeKey: string; limit: number; windowSeconds: number }): TelegramRateLimitResult;
  updateDeviceConnectionStatus(deviceId: string, status: DeviceStatus): DeviceRecord | null;
  createDeviceGrant(input: CreateDeviceGrantInput): DeviceGrantRecord;
  revokeDeviceGrant(grantId: string): DeviceGrantRecord | null;
  listDeviceGrants(filter?: { serverId?: string; deviceId?: string; agentId?: string; activeOnly?: boolean }): DeviceGrantRecord[];
  findActiveDeviceGrant(agentId: string, deviceId: string, capability: DeviceCapability, serverId: string, at?: string): DeviceGrantRecord | null;
  createDeviceCommand(input: CreateDeviceCommandInput): DeviceCommandRecord;
  getDeviceCommand(commandId: string): DeviceCommandRecord | null;
  markDeviceCommandSent(commandId: string): DeviceCommandRecord | null;
  markDeviceCommandRunning(commandId: string): DeviceCommandRecord | null;
  completeDeviceCommand(commandId: string, result: DeviceCommandResult): DeviceCommandRecord | null;
  listDeviceCommands(deviceId?: string): DeviceCommandRecord[];
  recordAuditEvent(input: AuditEventInput): AuditEventRecord;
  listAuditEvents(input?: number | AuditEventFilter): AuditEventRecord[];
  recordActivity(agentId: string, kind: string, text: string): void;
  listActivity(agentId: string): Array<{ at: string; kind: string; text: string }>;
  listAgentActivityMessages(userId: string, agentId: string, limit?: number): MessageRecord[];
  createRuntimeApproval(input: RuntimeApprovalRecord): RuntimeApprovalRecord;
  getRuntimeApproval(id: string): RuntimeApprovalRecord | null;
  listRuntimeApprovals(filter?: { executionId?: string; messageId?: string; threadChannelId?: string; serverId?: string; agentId?: string; limit?: number }): RuntimeApprovalRecord[];
  listExpiredPendingRuntimeApprovals(cutoffAt: string, limit?: number): RuntimeApprovalRecord[];
  listRuntimeApprovalsForExecutionSummary(input: { executionIds: string[]; messageIds: string[]; threadChannelIds: string[]; ownerUserId: string; limit?: number }): RuntimeApprovalRecord[];
  canUserResolveRuntimeApproval(userId: string, approval: RuntimeApprovalRecord): boolean;
  resolveRuntimeApproval(id: string, decision: RuntimeApprovalDecision, resolvedByUserId: string, customResponse?: string): RuntimeApprovalRecord | null;
  getAgentRuntimeSession(id: string): AgentRuntimeSessionRecord | null;
  listAgentRuntimeSessions(filter?: { agentId?: string; machineId?: string; runtime?: RuntimeId; contextKey?: string; status?: AgentRuntimeSessionStatus }): AgentRuntimeSessionRecord[];
  getCurrentAgentRuntimeSession(input: AgentRuntimeSessionIdentity): AgentRuntimeSessionRecord | null;
  getOrCreateAgentRuntimeSession(input: AgentRuntimeSessionIdentity & { executionId?: string; launchId?: string }): AgentRuntimeSessionRecord;
  prepareRuntimeExecutionSession(input: AgentRuntimeSessionIdentity & { executionId: string; launchId?: string }): { session: AgentRuntimeSessionRecord; execution: RuntimeExecutionRecord } | null;
  bindAgentRuntimeSession(input: AgentRuntimeSessionCas & { runtimeSessionId: string; executionId?: string; launchId?: string }): AgentRuntimeSessionRecord | null;
  markAgentRuntimeSessionFailed(input: AgentRuntimeSessionCas & { error: string; executionId?: string; launchId?: string }): AgentRuntimeSessionRecord | null;
  replaceAgentRuntimeSession(input: AgentRuntimeSessionCas & { error: string; executionId: string; launchId?: string }): AgentRuntimeSessionRecord | null;
  touchAgentRuntimeSession(input: AgentRuntimeSessionCas & { executionId?: string; launchId?: string }): AgentRuntimeSessionRecord | null;
  invalidateAgentRuntimeSessions(input: { agentId: string; machineId?: string; runtime?: RuntimeId; contextKey?: string; detail?: string }): AgentRuntimeSessionRecord[];
  createRuntimeExecution(input: Omit<RuntimeExecutionRecord, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): RuntimeExecutionRecord;
  getRuntimeExecution(id: string): RuntimeExecutionRecord | null;
  listRuntimeExecutions(filter?: { executionId?: string; sourceExecutionId?: string; taskId?: string; messageId?: string; threadChannelId?: string; serverId?: string; agentId?: string; limit?: number }): RuntimeExecutionRecord[];
  listTopologyRuntimeExecutions(input: { serverId: string; activeUpdatedAfter: string; terminalUpdatedAfter: string; limit?: number }): RuntimeExecutionRecord[];
  listTopologyRuntimeExecutionEvents(executionIds: string[]): RuntimeExecutionEventRecord[];
  listRuntimeExecutionsForMessageIds(messageIds: string[], ownerUserId: string, limit?: number): RuntimeExecutionRecord[];
  listChildRuntimeExecutionsForSourceIds(sourceExecutionIds: string[], limit?: number): RuntimeExecutionRecord[];
  latestRuntimeExecutionForTask(taskId: string): RuntimeExecutionRecord | null;
  latestRuntimeExecutionForMessage(agentId: string, messageId: string): RuntimeExecutionRecord | null;
  attachRuntimeExecutionToTask(executionId: string, taskId: string): RuntimeExecutionRecord | null;
  attachRuntimeExecutionRootMessage(executionId: string, rootMessageId: string): RuntimeExecutionRecord | null;
  bindRuntimeExecutionSession(input: { executionId: string; sessionRecordId: string; contextKey: string; generation: number; runtimeSessionId?: string }): RuntimeExecutionRecord | null;
  updateRuntimeExecutionStatus(id: string, status: RuntimeExecutionStatus, options?: { launchId?: string }): RuntimeExecutionRecord | null;
  markRuntimeExecutionReturnDispatched(executionId: string, input: { returnMessageId: string; returnExecutionId: string }): RuntimeExecutionRecord | null;
  markRuntimeExecutionCommunicationReturnDispatched(executionId: string, input: { communicationReturnMessageId: string }): RuntimeExecutionRecord | null;
  appendRuntimeExecutionEvent(input: Omit<RuntimeExecutionEventRecord, "id" | "sequence" | "at"> & { id?: string; sequence?: number; at?: string }): RuntimeExecutionEventRecord;
  listRuntimeExecutionEvents(executionId: string): RuntimeExecutionEventRecord[];
  findFinalMessageForExecution(executionId: string): MessageRecord | null;
  ensureExecutionGroup(input: Omit<ExecutionGroupRecord, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): ExecutionGroupRecord;
  getExecutionGroup(id: string): ExecutionGroupRecord | null;
  listExecutionGroups(filter?: { serverId?: string; taskId?: string; messageId?: string; threadChannelId?: string; limit?: number }): ExecutionGroupRecord[];
  listExecutionGroupsForMessageIds(messageIds: string[], limit?: number): ExecutionGroupRecord[];
  updateExecutionGroupStatus(id: string, status: ExecutionGroupStatus): ExecutionGroupRecord | null;
  ensureAgentRun(input: Omit<AgentRunRecord, "createdAt" | "updatedAt" | "inputArtifactIds" | "outputArtifactIds"> & { inputArtifactIds?: string[]; outputArtifactIds?: string[]; createdAt?: string; updatedAt?: string }): AgentRunRecord;
  getAgentRun(id: string): AgentRunRecord | null;
  listAgentRuns(filter?: { groupId?: string; agentId?: string; limit?: number }): AgentRunRecord[];
  listAgentRunsForGroupIds(groupIds: string[], limit?: number): AgentRunRecord[];
  updateAgentRunStatus(id: string, status: AgentRunStatus): AgentRunRecord | null;
  upsertExecutionBlock(input: Omit<ExecutionBlockRecord, "groupSequence" | "runSequence" | "createdAt" | "updatedAt"> & { groupSequence?: number; runSequence?: number; createdAt?: string; updatedAt?: string }): ExecutionBlockRecord;
  hasExecutionBlocks(groupId: string): boolean;
  listExecutionBlocks(groupId: string, options?: { limit?: number; beforeSequence?: number; agentId?: string; tail?: boolean }): ExecutionBlockRecord[];
  createExecutionArtifact(input: Omit<ExecutionArtifactRecord, "createdAt"> & { createdAt?: string }): ExecutionArtifactRecord;
  listExecutionArtifacts(groupId: string): ExecutionArtifactRecord[];
  ensureSafetyAssessment(input: Omit<SafetyAssessmentRecord, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): SafetyAssessmentRecord;
  updateSafetyAssessment(id: string, patch: Partial<Pick<SafetyAssessmentRecord, "status" | "label" | "riskTypes" | "analysis" | "evidence" | "model" | "error" | "completedAt">>): SafetyAssessmentRecord | null;
  findSafetyAssessmentBySubject(subjectType: SafetyAssessmentSubjectType, subjectId: string, trigger: SafetyAuditTrigger): SafetyAssessmentRecord | null;
  listSafetyAssessments(filter?: { serverId?: string; executionId?: string; approvalId?: string; taskId?: string; limit?: number }): SafetyAssessmentRecord[];
  upsertGovernancePolicyConfig(input: { serverId: string; scope: GovernancePolicyConfigScope; agentId?: string; version: string; rules: GovernancePolicyRules; actorUserId?: string }): GovernancePolicyConfigRecord;
  getGovernancePolicyConfig(input: { serverId: string; scope: GovernancePolicyConfigScope; agentId?: string }): GovernancePolicyConfigRecord | null;
  listGovernancePolicyConfigs(filter?: { serverId?: string; agentId?: string }): GovernancePolicyConfigRecord[];
  getGovernancePolicyConfigAudit(auditId: string): GovernancePolicyConfigAuditRecord | null;
  listGovernancePolicyConfigAudit(filter?: { serverId?: string; configId?: string; limit?: number }): GovernancePolicyConfigAuditRecord[];
  createGovernanceDecision(input: Omit<GovernanceDecisionRecord, "createdAt"> & { createdAt?: string }): GovernanceDecisionRecord;
  listGovernanceDecisions(filter?: { serverId?: string; executionId?: string; approvalId?: string; taskId?: string; limit?: number }): GovernanceDecisionRecord[];
  createChannel(input: CreateChannelInput): ChannelRecord;
  getChannelByName(name: string, type?: ChannelType, serverId?: string): ChannelRecord | null;
  getOrCreateAgentDm(agentId: string, requesterUserId?: string): ChannelRecord | null;
  getOrCreateAgentPairDm(senderAgentId: string, peerAgentHandle: string, serverId?: string): ChannelRecord | null;
  getWorkspaceBridgeDm(bridgeId: string, workspaceId: string): ChannelRecord | null;
  getOrCreateWorkspaceBridgeDm(bridgeId: string, workspaceId: string): ChannelRecord | null;
  getConversation(conversationId: string): ConversationRecord | null;
  listConversations(channelId: string, options?: { includeArchived?: boolean }): ConversationRecord[];
  getActiveConversation(channelId: string): ConversationRecord | null;
  ensureActiveConversation(channelId: string, actor?: { type: SenderType; id: string }): ConversationRecord | null;
  createConversation(input: CreateConversationInput): ConversationRecord;
  renameConversation(conversationId: string, title: string): ConversationRecord | null;
  archiveConversation(conversationId: string, archivedByUserId: string): ConversationRecord | null;
  unarchiveConversation(conversationId: string): ConversationRecord | null;
  deleteConversation(conversationId: string): DeleteConversationResult;
  updateConversationResetStatus(conversationId: string, patch: { resetStatus: ConversationResetStatus; resetReason?: string | null }): ConversationRecord | null;
  readConversationHistory(conversationId: string, limit?: number, around?: string | number, before?: number, after?: number): ReadHistoryResult | null;
  updateChannelDescription(channelId: string, description: string, visibility?: ChannelVisibility): ChannelRecord | null;
  updateChannelLifecycle(channelId: string, patch: { description?: string; visibility?: ChannelVisibility }): { success: boolean; channel?: ChannelRecord; reason?: string };
  archiveChannel(channelId: string, archivedByUserId: string): { success: boolean; channel?: ChannelRecord; reason?: string };
  unarchiveChannel(channelId: string): { success: boolean; channel?: ChannelRecord; reason?: string };
  resolveTarget(target: string, serverId?: string): ChannelRecord | null;
  canUserAccessChannel(userId: string, channelId: string): boolean;
  canAgentAccessChannel(agentId: string, channelId: string): boolean;
  canAgentSendToChannel(agentId: string, channelId: string): boolean;
  listMessages(channelId?: string, limit?: number, options?: { includeExecutionMessages?: boolean }): MessageRecord[];
  listRuntimeExecutionOutputMessages(executionId: string): MessageRecord[];
  listVisibleChannelIds(userId: string): string[];
  listVisibleAgents(userId: string): AgentRecord[];
  listVisibleMessages(userId: string, options?: { channelId?: string; sinceSeq?: number; limit?: number }): MessageRecord[];
  latestVisibleMessageSeq(userId: string, channelId?: string): number;
  getMessage(messageId: string): MessageRecord | null;
  softDeleteMessage(messageId: string, deletedByUserId: string, reason?: NonNullable<MessageRecord["deletionReason"]>): MessageRecord | null;
  listChannelsForAgent(agentId: string): ChannelRecord[];
  readHistory(target: string, limit?: number, around?: string | number, before?: number, after?: number, serverId?: string, options?: { scope?: MessageHistoryScope; conversationId?: string }): ReadHistoryResult | null;
  readHistoryForAgent(agentId: string, target: string, limit?: number, around?: string | number, before?: number, after?: number, serverId?: string, options?: { scope?: MessageHistoryScope; conversationId?: string }): ReadHistoryResult | null;
  searchMessages(query: string, opts?: { channel?: string; conversationId?: string; scope?: MessageHistoryScope; limit?: number; serverId?: string; senderId?: string; before?: string; after?: string; sort?: "recent" | "relevance"; agentId?: string; userId?: string }): Array<MessageRecord & { snippet: string }>;
  saveMessage(userId: string, messageId: string): void;
  unsaveMessage(userId: string, messageId: string): void;
  toggleMessageReaction(userId: string, messageId: string, emoji: string): { success: boolean; active?: boolean; message?: MessageRecord; reason?: string };
  listSavedMessages(userId: string, limit?: number, offset?: number): MessageRecord[];
  markChannelUnread(userId: string, channelId: string): { unreadCount: number; firstUnreadMessageId?: string };
  markMessageUnread(userId: string, messageId: string): { success: boolean; channelId?: string; unreadCount?: number; firstUnreadMessageId?: string; reason?: string };
  markChannelRead(userId: string, channelId: string): void;
  listUnreadCounts(userId: string): Record<string, number>;
  listUnreadMarks(userId: string): Record<string, UnreadMarkRecord>;
  listInboxItemsForUser(userId: string, options?: InboxListOptions): InboxResponse;
  sendMessage(input: SendMessageInput): { message: MessageRecord; task?: TaskRecord; recentUnread: MessageRecord[] };
  createDelegationMessage(input: { channelId: string; conversationId?: string; serverId: string; senderAgent: AgentRecord; targetAgent: AgentRecord; instruction: string; attachmentIds?: string[] }): MessageRecord;
  selectWakeTargets(message: MessageRecord): AgentRecord[];
  enqueueForAgents(message: MessageRecord): void;
  enqueueForAgent(agentId: string, messageId: string, executionId?: string): void;
  hasPendingAgentInbox(agentId: string): boolean;
  takeAgentInbox(agentId: string): Array<MessageRecord & { runtimeExecutionId?: string }>;
  ackAgentInbox(agentId: string, messageIds: string[], seqs?: number[]): void;
  listChannelMembers(channelTarget: string, serverId?: string, opts?: { includeAll?: boolean; viewerUserId?: string }): { channel: ChannelRecord; agents: Array<AgentRecord & { joined: boolean; ordinaryDeliveryEnabled: boolean; role?: string; joinedAt?: string | null; leftAt?: string | null }>; humans: Array<UserRecord & { joined: boolean; role?: string; joinedAt?: string | null; leftAt?: string | null }>; memberships: ChannelMemberRecord[] } | null;
  setAgentChannelMembership(agentId: string, channelId: string, joined: boolean, ordinaryDeliveryEnabled?: boolean): AgentChannelMembership;
  setHumanChannelMembership(userId: string, channelId: string, joined: boolean, role?: ChannelHumanRole): ChannelMemberRecord;
  deleteChannel(channelId: string): { success: boolean; channel?: ChannelRecord; reason?: string };
  joinChannel(agentId: string, channelTarget: string, serverId?: string): { success: boolean; channel?: ChannelRecord; reason?: string };
  leaveChannel(agentId: string, channelTarget: string, serverId?: string): { success: boolean; channel?: ChannelRecord; reason?: string };
  unfollowThread(agentId: string, threadTarget: string, serverId?: string): { success: boolean; channel?: ChannelRecord; reason?: string };
  followThread(agentId: string, threadChannelId: string): void;
  listThreadFollows(threadChannelId: string): ThreadFollowRecord[];
  ensureMessageThread(messageId: string): { success: boolean; channel?: ChannelRecord; created?: boolean; reason?: string };
  getMessageThread(messageId: string): ChannelRecord | null;
  taskForMessage(messageId: string): TaskRecord | null;
  createTasks(channelTarget: string, titles: string[], createdBy: { type: SenderType; id: string; name: string }, details?: TaskCreateDetails): TaskRecord[];
  listTasks(channelTarget?: string, status?: TaskStatus | "all", serverId?: string): TaskRecord[];
  listVisibleTasks(userId: string, options?: { channelId?: string; statuses?: TaskStatus[]; assigneeAgentId?: string; limit?: number; cursor?: string }): TaskListPayload;
  visibleTaskByIdOrMessageId(userId: string, taskIdOrMessageId: string): TaskRecord | null;
  convertMessageToTask(messageId: string, createdBy: { type: SenderType; id: string; name: string }, title?: string, details?: TaskCreateDetails): { success: boolean; task?: TaskRecord; created?: boolean; reason?: string };
  claimMessageAsTask(messageId: string, agentId: string, title?: string): { success: boolean; task?: TaskRecord; created?: boolean; reason?: string };
  claimTask(taskIdOrMessageId: string, agentId: string): { success: boolean; task?: TaskRecord; reason?: string };
  unclaimTaskById(taskIdOrMessageId: string): { success: boolean; task?: TaskRecord; reason?: string };
  patchTask(taskIdOrMessageId: string, patch: { title?: string; status?: TaskStatus; assigneeAgentId?: string | null }): { success: boolean; task?: TaskRecord; reason?: string };
  deleteTask(taskIdOrMessageId: string): { success: boolean; task?: TaskRecord; reason?: string };
  claimTasks(agentId: string, channelTarget: string, taskNumbers?: number[], messageIds?: string[], serverId?: string): Array<{ success: boolean; taskNumber?: number; messageId?: string; reason?: string }>;
  unclaimTask(agentId: string, channelTarget: string, taskNumber: number, serverId?: string): { success: boolean; reason?: string };
  updateTaskStatus(agentId: string, channelTarget: string, taskNumber: number, status: TaskStatus, serverId?: string): { success: boolean; task?: TaskRecord; reason?: string };
  createAttachment(input: Omit<AttachmentRecord, "id" | "createdAt">): AttachmentRecord;
  getAttachment(id: string): AttachmentRecord | null;
  listReminders(agentId: string, status?: string): ReminderRecord[];
  createReminder(agentId: string, title: string, fireAt: string, messageId?: string, channelId?: string, repeat?: string): ReminderRecord;
  updateReminder(agentId: string, reminderId: string, input: { title?: string; fireAt?: string; delaySeconds?: number; repeat?: string | null }): ReminderRecord | null;
  snoozeReminder(agentId: string, reminderId: string, delaySeconds: number): ReminderRecord | null;
  cancelReminder(agentId: string, reminderId: string): ReminderRecord | null;
  fireReminder(agentId: string, reminderId: string, version: number, firedAtClient: string): { reminder: ReminderRecord | null; fired: boolean; rescheduled: boolean; reason?: string };
  listReminderEvents(agentId: string, reminderId: string): ReminderEventRecord[] | null;
  reminderJobsForAgent(agentId: string): ReminderJob[];
}

export type TyrDbSeedMode = "default" | "none";

export function openTyrDb(filePath: string, options: { seed?: TyrDbSeedMode } = {}): TyrDb {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  // Existing installations keep their historical bootstrap data. Named isolated
  // instances can explicitly start empty so provisioning is the sole data source.
  if ((options.seed ?? "default") === "default") seed(db);
  ensureFixedDmIdentities(db);
  retireColdGroupActivity(db);
  ensureExistingTaskThreads(db);

  const rowUser = (row: any): UserRecord => ({
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    email: maybeString(row.email),
    description: maybeString(row.description) ?? null,
    avatarUrl: maybeString(row.avatar_url) ?? null,
    emailVerified: Boolean(row.email_verified),
    passwordSetupRequired: Boolean(row.password_setup_required),
    preferredLanguage: maybeString(row.preferred_language) ?? null,
    createdAt: row.created_at
  });

  const rowPlatformOperator = (row: any): PlatformOperatorRecord => ({
    id: row.id,
    login: row.login,
    displayName: row.display_name,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const rowPlatformOperatorWorkspaceGrant = (row: any): PlatformOperatorWorkspaceGrantRecord => ({
    operatorId: row.operator_id,
    serverId: row.server_id,
    serverName: row.server_name,
    scopes: parseJson<PlatformOperatorScope[]>(row.scopes, []).filter((scope) => PLATFORM_OPERATOR_SCOPES.includes(scope)),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const rowTyrHeartbeat = (row: any): TyrHeartbeatRecord => ({
    id: row.id,
    serverId: row.server_id,
    tyrAgentId: row.tyr_agent_id,
    title: row.title,
    instruction: row.instruction,
    intervalUnit: row.interval_unit,
    intervalValue: Number(row.interval_value),
    enabled: Boolean(row.enabled),
    nextRunAt: row.next_run_at,
    createdByUserId: maybeString(row.created_by_user_id),
    createdByOperatorId: maybeString(row.created_by_operator_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const rowTyrHeartbeatRun = (row: any): TyrHeartbeatRunRecord => ({
    id: row.id,
    heartbeatId: row.heartbeat_id,
    serverId: row.server_id,
    scheduledFor: row.scheduled_for,
    status: row.status,
    sourceMessageId: maybeString(row.source_message_id),
    executionIds: parseJson<string[]>(row.execution_ids, []),
    selectedAgentId: maybeString(row.selected_agent_id),
    errorCode: maybeString(row.error_code),
    errorMessage: maybeString(row.error_message),
    startedAt: maybeString(row.started_at),
    completedAt: maybeString(row.completed_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const rowWorkspaceSharedFileAssignment = (row: any): WorkspaceSharedFileAssignmentRecord => ({
    fileId: row.file_id,
    agentId: row.agent_id,
    permission: row.permission,
    createdByUserId: maybeString(row.created_by_user_id),
    createdByOperatorId: maybeString(row.created_by_operator_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const rowWorkspaceSharedFile = (row: any): WorkspaceSharedFileStoredRecord => ({
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    originalName: row.original_name ?? row.name,
    originalMimeType: row.original_mime_type ?? row.mime_type,
    originalSizeBytes: Number(row.original_size_bytes ?? row.size_bytes),
    originalSha256: row.original_sha256 ?? row.sha256,
    hasChanges: (row.original_sha256 ?? row.sha256) !== row.sha256,
    version: Number(row.version),
    createdByUserId: maybeString(row.created_by_user_id),
    createdByOperatorId: maybeString(row.created_by_operator_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    storagePath: row.storage_path,
    originalStoragePath: row.original_storage_path ?? row.storage_path,
    assignments: []
  });

  const rowInvite = (row: any): ServerInviteRecord => ({
    id: row.id,
    invitedEmail: row.invited_email,
    invitedByUserId: row.invited_by_user_id,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  });

  const rowIncomingInvite = (row: any): IncomingServerInviteRecord => ({
    ...rowInvite(row),
    serverId: row.server_id,
    serverName: row.server_name,
    invitedByName: row.invited_by_name
  });

  const rowWorkspaceBridge = (row: any): WorkspaceBridgeRecord => {
    const peerWorkspace: WorkspaceBridgePeerSummary | undefined = row.peer_workspace_id ? {
      id: row.peer_workspace_id,
      name: row.peer_workspace_name,
      ownerUserId: row.peer_owner_user_id,
      ownerDisplayName: row.peer_owner_display_name,
      onboardingAgentId: maybeString(row.peer_onboarding_agent_id) ?? null
    } : undefined;
    return {
      id: row.id,
      workspaceAId: row.workspace_a_id,
      workspaceBId: row.workspace_b_id,
      status: row.status === "active" || row.status === "revoked" ? row.status : "pending",
      direction: row.direction === "one_way" ? "one_way" : "bidirectional",
      scope: row.scope,
      permissions: parsePermissionsJson(row.permissions_json),
      invitedByUserId: row.invited_by_user_id,
      invitedByDisplayName: row.invited_by_display_name ?? row.invited_by_user_id,
      approvedByAUserId: maybeString(row.approved_by_a_user_id) ?? null,
      approvedByBUserId: maybeString(row.approved_by_b_user_id) ?? null,
      createdAt: row.created_at,
      acceptedAt: maybeString(row.accepted_at) ?? null,
      revokedAt: maybeString(row.revoked_at) ?? null,
      lastActivityAt: maybeString(row.last_activity_at) ?? null,
      peerWorkspace
    };
  };

  const rowCrossWorkspaceMessage = (row: any): CrossWorkspaceMessageRecord => {
    const attachmentIds = parseJson<string[]>(row.attachment_ids, []);
    const attachments = attachmentIds.length
      ? db.prepare(`select id, filename, mime_type as mimeType, size_bytes as sizeBytes from attachments where id in (${attachmentIds.map(() => "?").join(",")})`).all(...attachmentIds) as CrossWorkspaceMessageRecord["attachments"]
      : [];
    // Bridge participants see the peer TYR, never its internal Agent provenance.
    // Keep the original source_agent_names column for server-side audit only.
    const sourceAgentNames: string[] = [];
    const legacyWorkerEvent = Boolean(row.interaction_event_id && !row.local_message_id &&
      ["progress", "question", "action_request"].includes(row.response_kind));
    // Expose selected hop receipts only. Private source IDs stay in the evidence tables.
    const evidence = (db.prepare(`select receipt_id, facts_json, excerpt, provenance_kind
      from communication_evidence_receipts where bridge_message_id = ? order by position`).all(row.id) as any[])
      .map((receipt) => ({ receiptId: String(receipt.receipt_id),
        facts: parseJson(receipt.facts_json, []),
        ...(typeof receipt.excerpt === "string" ? { excerpt: receipt.excerpt } : {}),
        provenance: { kind: receipt.provenance_kind as "peer_tyr" | "reviewed_downstream" }
      }));
    return ({
    id: row.id,
    bridgeId: row.bridge_id,
    conversationId: maybeString(row.conversation_id) ?? null,
    clientRequestId: maybeString(row.client_request_id) ?? null,
    retryOfMessageId: maybeString(row.retry_of_message_id) ?? null,
    responseKind: ["ack", "progress", "question", "action_request", "answer", "instruction", "continue", "final", "error"].includes(row.response_kind)
      ? row.response_kind
      : null,
    interactionEventId: maybeString(row.interaction_event_id) ?? null,
    terminalRequestId: maybeString(row.terminal_request_id) ?? null,
    resolvedByTerminalId: maybeString(row.resolved_by_terminal_id) ?? null,
    originConversationKey: maybeString(row.origin_conversation_key) ?? null,
    originChannelId: maybeString(row.origin_channel_id) ?? null,
    originConversationId: maybeString(row.origin_conversation_id) ?? null,
    originMessageId: maybeString(row.origin_message_id) ?? null,
    originSource: row.origin_source === "telegram" || row.origin_source === "email" || row.origin_source === "mcp"
      ? row.origin_source
      : row.origin_source === "web"
        ? "web"
        : null,
    originExternalRef: maybeString(row.origin_external_ref) ?? null,
    originExternalDeliveredAt: maybeString(row.origin_external_delivered_at) ?? null,
    awaitingAgentId: maybeString(row.awaiting_agent_id) ?? null,
    continuationState: row.continuation_state === "registered" || row.continuation_state === "pending" || row.continuation_state === "running" || row.continuation_state === "completed" || row.continuation_state === "interrupted" ? row.continuation_state : null,
    continuationReplyMessageId: maybeString(row.continuation_reply_message_id) ?? null,
    sourceWorkspaceId: row.source_workspace_id,
    targetWorkspaceId: row.target_workspace_id,
    senderUserId: maybeString(row.sender_user_id) ?? null,
    senderUserName: maybeString(row.sender_user_name) ?? null,
    senderUserDisplayName: maybeString(row.sender_user_display_name) ?? null,
    senderUserAvatarUrl: maybeString(row.sender_user_avatar_url) ?? null,
    sourceCapabilityUserId: maybeString(row.source_capability_user_id) ?? null,
    targetCapabilityUserId: maybeString(row.target_capability_user_id) ?? null,
    originalSenderUserId: maybeString(row.original_sender_user_id) ?? null,
    traceId: maybeString(row.trace_id) ?? null,
    parentBridgeRequestId: maybeString(row.parent_bridge_request_id) ?? null,
    hopCount: typeof row.hop_count === "number" && Number.isFinite(row.hop_count) ? row.hop_count : 0,
    attachmentIds,
    attachments,
    sourceAgentNames,
    ...(evidence.length ? { evidence } : {}),
    senderCommsAgentId: row.sender_comms_agent_id,
    receiverCommsAgentId: row.receiver_comms_agent_id,
    initiatedBy: row.initiated_by === "agent" ? "agent" : "human",
    content: legacyWorkerEvent ? "The connected workspace is reviewing this request." : row.content,
    outcome: row.outcome === "delivered" || row.outcome === "failed" ? row.outcome : "pending",
    localMessageId: maybeString(row.local_message_id) ?? null,
    peerMessageId: maybeString(row.peer_message_id) ?? null,
    replyToMessageId: maybeString(row.reply_to_message_id) ?? null,
    createdAt: row.created_at,
    updatedAt: maybeString(row.updated_at) ?? row.created_at
    });
  };

  const rowHelpdeskSignupIntent = (row: any): HelpdeskSignupIntentRecord => ({
    id: row.id,
    email: row.email,
    source: row.source === "mock_email" ? "mock_email" : "email",
    subject: maybeString(row.subject),
    ...(row.return_path ? { returnPath: row.return_path } : {}),
    status: row.status === "completed" || row.status === "expired" ? row.status : "pending",
    expiresAt: row.expires_at,
    completedAt: maybeString(row.completed_at),
    createdUserId: maybeString(row.created_user_id),
    createdAt: row.created_at
  });

  const rowHelpdeskPasswordRecoveryIntent = (row: any): HelpdeskPasswordRecoveryIntentRecord => ({
    id: row.id,
    email: row.email,
    userId: row.user_id,
    source: row.source === "mock_email" ? "mock_email" : "email",
    subject: maybeString(row.subject),
    status: row.status === "completed" || row.status === "expired" ? row.status : "pending",
    expiresAt: row.expires_at,
    completedAt: maybeString(row.completed_at),
    createdAt: row.created_at
  });

  const rowHelpdeskResendEmailEvent = (row: any): HelpdeskResendEmailEventRecord => ({
    emailId: row.email_id,
    svixId: maybeString(row.svix_id),
    status: row.status === "processed" || row.status === "failed" ? row.status : "processing",
    helpdeskStatus: maybeString(row.helpdesk_status),
    replyEmailId: maybeString(row.reply_email_id),
    errorCode: maybeString(row.error_code),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const rowCommunicationAgentPendingAction = (row: any): CommunicationAgentPendingActionRecord => {
    const allowedStatuses = new Set<CommunicationAgentPendingActionStatus>(["pending", "confirmed", "cancelled", "expired", "superseded"]);
    return {
      id: row.id,
      serverId: row.server_id,
      userId: row.user_id,
      assistantAgentId: row.assistant_agent_id,
      channelId: row.channel_id,
      sourceMessageId: maybeString(row.source_message_id),
      suggestionMessageId: maybeString(row.suggestion_message_id),
      targetAgentId: row.target_agent_id,
      instruction: row.instruction,
      status: allowedStatuses.has(row.status) ? row.status : "pending",
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      resolvedAt: maybeString(row.resolved_at)
    };
  };

  const rowCommunicationAgentManagementDraft = (row: any): CommunicationAgentManagementDraftRecord => {
    const allowedActions = new Set<CommunicationAgentManagementAction>(COMMUNICATION_AGENT_MANAGEMENT_ACTIONS);
    const allowedStages = new Set<CommunicationAgentManagementDraftStage>([
      "collecting_name",
      "collecting_machine",
      "collecting_runtime",
      "collecting_model",
      "collecting_agent",
      "collecting_update_field",
      "collecting_update_value",
      "awaiting_confirmation"
    ]);
    const allowedStatuses = new Set<CommunicationAgentManagementDraftStatus>([
      "pending",
      "confirmed",
      "cancelled",
      "expired",
      "superseded",
      "completed",
      "failed"
    ]);
    const source: CommunicationAgentManagementSource = row.source === "telegram" || row.source === "email" || row.source === "mcp"
      ? row.source
      : "web";
    return {
      id: row.id,
      operationId: row.operation_id,
      serverId: row.server_id,
      userId: row.user_id,
      assistantAgentId: row.assistant_agent_id,
      channelId: row.channel_id,
      source,
      sourceConversationKey: row.source_conversation_key,
      sourceMessageId: row.source_message_id,
      sourceEventKey: row.source_event_key,
      // 数据库存量值只允许映射为稳定 contract，避免异常值进入后续执行分支。
      action: allowedActions.has(row.action) ? row.action : "create",
      stage: allowedStages.has(row.stage) ? row.stage : "collecting_name",
      params: parseJson<CommunicationAgentManagementParams>(row.params_json, {}),
      choices: parseJson<CommunicationAgentManagementChoice[]>(row.choices_json, []),
      status: allowedStatuses.has(row.status) ? row.status : "pending",
      replyText: maybeString(row.reply_text),
      errorCode: maybeString(row.error_code),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      confirmedAt: maybeString(row.confirmed_at),
      resolvedAt: maybeString(row.resolved_at)
    };
  };

  const rowServer = (row: any): ServerRecord => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerId: row.owner_user_id,
    onboardingAgentId: maybeString(row.onboarding_agent_id) ?? null,
    plan: row.plan ?? "free",
    planDowngradedAt: maybeString(row.plan_downgraded_at) ?? null,
    role: serverMemberRole(row.member_role),
    createdAt: row.created_at
  });

  const rowMachine = (row: any): MachineRecord => ({
    id: row.id,
    serverId: maybeString(row.server_id) ?? "local",
    ownerUserId: row.owner_user_id,
    name: row.name,
    hostname: row.hostname,
    os: row.os,
    daemonVersion: row.daemon_version,
    runtimeMarker: maybeString(row.runtime_marker),
    runtimeSha: maybeString(row.runtime_sha),
    runtimeMarkerMtime: maybeString(row.runtime_marker_mtime),
    status: row.status,
    apiKey: row.api_key,
    connectorToken: maybeString(row.connector_token),
    connectorTokenIssuedAt: maybeString(row.connector_token_issued_at),
    connectorTokenRevokedAt: maybeString(row.connector_token_revoked_at) ?? null,
    apiKeyUsedAt: maybeString(row.api_key_used_at) ?? null,
    installationId: maybeString(row.installation_id),
    hostFingerprint: maybeString(row.host_fingerprint),
    deletedAt: maybeString(row.deleted_at) ?? null,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at
  });

  const rowRuntime = (row: any): RuntimeReport => ({
    runtime: row.runtime,
    displayName: row.display_name,
    binary: row.binary,
    command: maybeString(row.command),
    version: maybeString(row.version),
    status: row.status,
    reason: maybeString(row.reason),
    checkedAt: maybeString(row.checked_at),
    installStatus: maybeString(row.install_status) as RuntimeReport["installStatus"],
    authStatus: maybeString(row.auth_status) as RuntimeReport["authStatus"],
    cliStatus: maybeString(row.cli_status) as RuntimeReport["cliStatus"],
    mcpStatus: maybeString(row.mcp_status) as RuntimeReport["mcpStatus"],
    mcpToolSurface: maybeString(row.mcp_tool_surface) as RuntimeReport["mcpToolSurface"],
    readOnlyEnforcement: maybeString(row.read_only_enforcement) as RuntimeReport["readOnlyEnforcement"],
    hiddenMcpTools: parseJson(row.hidden_mcp_tools, undefined),
    diagnostics: parseJson(row.diagnostics, undefined),
    models: parseJson(row.models, undefined),
    defaultModel: maybeString(row.default_model)
  });

  const rowAgent = (row: any): AgentRecord => {
    const runtimeResourceGrants = normalizeRuntimeResourceGrants(parseJson<unknown>(row.runtime_resource_grants, []));
    const kind = row.kind === "communication" || row.kind === "off_device" ? row.kind : "on_device";
    const agent: AgentRecord = {
      id: row.id,
      serverId: maybeString(row.server_id) ?? "local",
      kind,
      ownerUserId: row.owner_user_id,
      createdByUserId: maybeString(row.created_by_user_id) ?? row.owner_user_id,
      creationBridgeRequestId: maybeString(row.creation_bridge_request_id) ?? null,
      creationTraceId: maybeString(row.creation_trace_id) ?? null,
      machineId: maybeString(row.machine_id) ?? null,
      name: row.name,
      displayName: row.display_name,
      description: maybeString(row.description),
      profileRevision: Number(row.profile_revision ?? 1),
      profileAppliedRevision: Number(row.profile_applied_revision ?? 0),
      profileApplyError: maybeString(row.profile_apply_error),
      avatarUrl: maybeString(row.avatar_url),
      runtime: (maybeString(row.runtime) as RuntimeId | undefined) ?? null,
      model: maybeString(row.model),
      reasoningEffort: row.reasoning_effort,
      permissionMode: (maybeString(row.permission_mode) as RuntimePermissionMode | undefined) ?? DEFAULT_RUNTIME_PERMISSION_MODE,
      status: row.status,
      desiredRuntimeState: row.desired_runtime_state === "running" ? "running" : "stopped",
      lastError: maybeString(row.last_error),
      workspacePath: maybeString(row.workspace_path),
      sessionId: maybeString(row.session_id),
      launchId: maybeString(row.launch_id),
      authToken: row.auth_token,
      deletedAt: maybeString(row.deleted_at) ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
    if (runtimeResourceGrants.length) agent.runtimeResourceGrants = runtimeResourceGrants;
    return agent;
  };

  const agentHostMachineSummary = (machine: MachineRecord): AgentHostMachineSummary => ({
    id: machine.id,
    ownerUserId: machine.ownerUserId,
    name: machine.name,
    hostname: machine.hostname,
    os: machine.os,
    daemonVersion: machine.daemonVersion,
    status: machine.status,
    lastSeenAt: machine.lastSeenAt
  });

  const defaultAgentScopes = (agentId: string): AgentScopes => ({
    agentId,
    granted: [...AGENT_ACTIVE_CAPABILITIES],
    mode: "default",
    revision: 0,
    updatedAt: "1970-01-01T00:00:00.000Z"
  });

  const rowAgentScopes = (row: any): AgentScopes => ({
    agentId: row.agent_id,
    granted: parseJson<AgentCapability[]>(row.granted, []).filter((capability): capability is AgentCapability => AGENT_ACTIVE_CAPABILITIES.includes(capability as (typeof AGENT_ACTIVE_CAPABILITIES)[number])),
    mode: row.mode === "custom" ? "custom" : "default",
    revision: Number(row.revision ?? 0),
    updatedAt: row.updated_at
  });

  function dmPeerAgentForChannelRow(row: any): AgentRecord | null {
    if (row.type !== "dm") return null;
    const identity = parseDmIdentity(row.dm_identity);
    if (identity?.kind !== "human_agent") return null;
    const agent = db.prepare("select * from agents where id = ?").get(identity.agentId);
    return agent ? rowAgent(agent) : null;
  }

  const rowChannel = (row: any): ChannelRecord => {
    const dmPeer = dmPeerAgentForChannelRow(row);
    return {
      id: row.id,
      serverId: maybeString(row.server_id) ?? "local",
      type: row.type,
      name: row.name,
      displayName: row.display_name,
      activeConversationId: maybeString(row.active_conversation_id) ?? null,
      dmIdentity: parseDmIdentity(row.dm_identity),
      dmPeerAgentId: dmPeer?.id,
      dmPeerAgentName: dmPeer?.name,
      dmPeerAgentDisplayName: dmPeer?.displayName,
      visibility: (maybeString(row.visibility) as ChannelVisibility | undefined) ?? "public",
      description: maybeString(row.description),
      parentChannelId: maybeString(row.parent_channel_id),
      parentMessageId: maybeString(row.parent_message_id),
      archivedAt: maybeString(row.archived_at) ?? null,
      archivedByUserId: maybeString(row.archived_by_user_id) ?? null,
      createdAt: row.created_at
    };
  };

  const rowConversation = (row: any): ConversationRecord => ({
    id: row.id,
    serverId: maybeString(row.server_id) ?? "local",
    channelId: row.channel_id,
    title: row.title,
    status: row.status as ConversationStatus,
    startedByType: row.started_by_type as SenderType,
    startedById: row.started_by_id,
    startedAt: row.started_at,
    closedAt: maybeString(row.closed_at) ?? null,
    archivedAt: maybeString(row.archived_at) ?? null,
    archivedByUserId: maybeString(row.archived_by_user_id) ?? null,
    lastMessageAt: maybeString(row.last_message_at) ?? null,
    summary: maybeString(row.summary) ?? null,
    resetStatus: (maybeString(row.reset_status) ?? "not_applicable") as ConversationResetStatus,
    resetAgentId: maybeString(row.reset_agent_id) ?? null,
    resetReason: maybeString(row.reset_reason) ?? null
  });

  function normalizeGrantScopes(scopes: ResourceGrantScope[]): ResourceGrantScope[] {
    const allowed = new Set<ResourceGrantScope>(RESOURCE_GRANT_SCOPES);
    const requested = new Set(scopes.filter((scope): scope is ResourceGrantScope => allowed.has(scope)));
    return RESOURCE_GRANT_SCOPES.filter((scope) => requested.has(scope));
  }

  function normalizeRuntimeResourceGrants(value: unknown): RuntimeResourceGrant[] {
    if (!Array.isArray(value)) return [];
    const allowedKinds = new Set<RuntimeResourceGrantKind>(RUNTIME_RESOURCE_GRANT_KINDS);
    const scopesByKind: Record<RuntimeResourceGrantKind, RuntimeResourceGrantScope[]> = {
      directory: ["read", "write"],
      network_domain: ["connect"],
      service_account: ["use"],
      device: ["use"],
      mcp_server: ["use"]
    };
    const normalized: RuntimeResourceGrant[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const input = item as Record<string, unknown>;
      const kind = input.kind;
      const target = typeof input.target === "string" ? input.target.trim() : "";
      if (typeof kind !== "string" || !allowedKinds.has(kind as RuntimeResourceGrantKind) || !target) continue;
      const allowedScopes = scopesByKind[kind as RuntimeResourceGrantKind];
      const requested = Array.isArray(input.scopes) ? input.scopes.map((scope) => String(scope).trim()).filter(Boolean) : [];
      const scopeSet = new Set(requested.filter((scope): scope is RuntimeResourceGrantScope => RUNTIME_RESOURCE_GRANT_SCOPES.includes(scope as RuntimeResourceGrantScope) && allowedScopes.includes(scope as RuntimeResourceGrantScope)));
      if (scopeSet.size === 0) continue;
      const label = typeof input.label === "string" ? input.label.trim() : "";
      // Runtime resource grants are owner-approved access hints; the daemon/runtime still applies normal approval rules for unlisted resources.
      normalized.push({
        kind: kind as RuntimeResourceGrantKind,
        ...(label ? { label } : {}),
        target,
        scopes: allowedScopes.filter((scope) => scopeSet.has(scope))
      });
    }
    return normalized;
  }

  const rowResourceGrant = (row: any): ResourceGrantRecord => ({
    id: row.id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    granteeUserId: row.grantee_user_id,
    scopes: normalizeGrantScopes(parseJson<ResourceGrantScope[]>(row.scopes, [])),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    revokedAt: maybeString(row.revoked_at) ?? null,
    revokedByUserId: maybeString(row.revoked_by_user_id) ?? null
  });

  const rowResourceGrantSummary = (grant: ResourceGrantRecord): ResourceGrantSummary | null => {
    const granteeRow = db.prepare("select * from users where id = ?").get(grant.granteeUserId);
    if (!granteeRow) return null;
    const grantee = rowUser(granteeRow);
    return {
      id: grant.id,
      resourceType: grant.resourceType,
      resourceId: grant.resourceId,
      granteeUserId: grant.granteeUserId,
      granteeName: grantee.name,
      granteeDisplayName: grantee.displayName,
      granteeEmail: grantee.email ?? null,
      scopes: grant.scopes,
      createdByUserId: grant.createdByUserId,
      createdAt: grant.createdAt
    };
  };

  const rowAuditEvent = (row: any): AuditEventRecord => ({
    id: row.id,
    kind: row.kind,
    actorType: row.actor_type,
    actorId: maybeString(row.actor_id) ?? null,
    resourceType: row.resource_type,
    resourceId: maybeString(row.resource_id) ?? null,
    serverId: maybeString(row.server_id) ?? null,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.created_at
  });

  function listMessageReactionSummaries(messageId: string): MessageReactionSummary[] {
    const rows = db.prepare(
      `select message_reactions.emoji,
              message_reactions.user_id,
              coalesce(users.display_name, message_reactions.user_id) as user_name,
              message_reactions.created_at
       from message_reactions
       left join users on users.id = message_reactions.user_id
       where message_reactions.message_id = ?
       order by (
         select min(first_reaction.rowid)
         from message_reactions first_reaction
         where first_reaction.message_id = message_reactions.message_id
         and first_reaction.emoji = message_reactions.emoji
       ), message_reactions.rowid`
    ).all(messageId) as Array<{ emoji: MessageReactionEmoji; user_id: string; user_name: string; created_at: string }>;
    const summaries = new Map<string, MessageReactionSummary>();
    for (const row of rows) {
      const current = summaries.get(row.emoji) ?? { emoji: row.emoji, count: 0, reactorIds: [], reactorNames: [] };
      current.count += 1;
      current.reactorIds.push(row.user_id);
      current.reactorNames.push(row.user_name);
      summaries.set(row.emoji, current);
    }
    return [...summaries.values()];
  }

  function messageQuoteSummary(messageId: string | null | undefined): MessageRecord["quote"] {
    if (!messageId) return undefined;
    const row = db.prepare(
      `select id, channel_id, sender_type, sender_id, sender_name, content, created_at, deleted_at
       from messages
       where id = ?`
    ).get(messageId) as {
      id: string;
      channel_id: string;
      sender_type: SenderType;
      sender_id: string;
      sender_name: string;
      content: string;
      created_at: string;
      deleted_at?: string | null;
    } | undefined;
    if (!row) return undefined;
    return {
      messageId: row.id,
      channelId: row.channel_id,
      senderType: row.sender_type,
      senderId: row.sender_id,
      senderName: row.sender_name,
      content: maybeString(row.deleted_at) ? "" : row.content,
      createdAt: row.created_at
    };
  }

  function messageDeviceRefs(messageId: string): MessageDeviceRef[] {
    return db.prepare(
      `select device_id as deviceId, capability
       from message_device_refs
       where message_id = ?
       order by rowid`
    ).all(messageId) as MessageDeviceRef[];
  }

  const rowMessage = (row: any): MessageRecord => {
    const deletedAt = maybeString(row.deleted_at);
    const isDeleted = Boolean(deletedAt);
    const attachmentIds = isDeleted ? [] : parseJson<string[]>(row.attachment_ids, []);
    const attachments = attachmentIds.length
      ? db.prepare(`select id, filename, mime_type as mimeType, size_bytes as sizeBytes from attachments where id in (${attachmentIds.map(() => "?").join(",")})`).all(...attachmentIds) as MessageRecord["attachments"]
      : undefined;
    const reactions = isDeleted ? [] : listMessageReactionSummaries(row.id);
    const quote = isDeleted ? undefined : messageQuoteSummary(maybeString(row.quote_message_id));
    const deviceRefs = isDeleted ? [] : messageDeviceRefs(row.id);
    const storedResult = isDeleted ? undefined : parseJson<MessageResult | undefined>(row.result_payload, undefined);
    // Personal authorship is server-owned provenance. A runtime-supplied result field cannot
    // impersonate a Human; only an answered, authenticated handoff can label a relayed result.
    const personalReply = storedResult?.sourceHumanName ? db.prepare(`select reply_content from workspace_bridge_human_replies
      where origin_message_id = ? and status = 'answered' and reply_message_id is not null`).get(row.id) as { reply_content: string } | undefined : undefined;
    if (storedResult?.sourceHumanName && !personalReply) {
      delete storedResult.sourceHumanName;
    }
    const legacyWorkerBridgeEvent = Boolean(storedResult?.workspaceBridge && db.prepare(`select 1 from cross_workspace_messages
      where origin_message_id = ? and interaction_event_id is not null and local_message_id is null
      and response_kind in ('progress', 'question', 'action_request') limit 1`).get(row.id));
    const result = storedResult?.workspaceBridge ? {
      ...storedResult,
      sourceAgentName: storedResult.sourceHumanName ? undefined : "Connected workspace TYR",
      // Keep attributed text for external delivery; Web renders the authenticated Owner's exact words.
      ...(personalReply ? { body: personalReply.reply_content, summary: personalReply.reply_content } : {}),
      ...(legacyWorkerBridgeEvent ? {
        summary: "The connected workspace is reviewing this request.",
        body: "The connected workspace is reviewing this request."
      } : {})
    } : storedResult;
    return {
      id: row.id,
      channelId: row.channel_id,
      conversationId: maybeString(row.conversation_id),
      channelName: row.channel_name,
      channelDisplayName: maybeString(row.channel_display_name),
      channelType: row.channel_type,
      threadId: maybeString(row.thread_id),
      kind: row.kind === "delegation" ? "delegation" : "chat",
      senderType: row.sender_type,
      senderId: row.sender_id,
      senderName: row.sender_name,
      content: isDeleted ? "" : legacyWorkerBridgeEvent
        ? "The connected workspace is reviewing this request." : row.content,
      result,
      sourceExecutionId: maybeString(row.source_execution_id),
      seq: row.seq,
      attachmentIds,
      attachments,
      deviceRefs,
      quote,
      reactions,
      createdAt: row.created_at,
      deletedAt,
      deletedByUserId: maybeString(row.deleted_by_user_id),
      deletionReason: maybeString(row.deletion_reason) as MessageRecord["deletionReason"]
    };
  };

  const rowTask = (row: any): TaskRecord => ({
    id: row.id,
    channelId: row.channel_id,
    conversationId: maybeString(row.conversation_id),
    channelName: maybeString(row.channel_name),
    channelDisplayName: maybeString(row.channel_display_name),
    channelType: maybeString(row.channel_type) as ChannelType | undefined,
    threadChannelId: maybeString(row.thread_channel_id),
    messageId: row.message_id,
    taskNumber: row.task_number,
    title: row.title,
    status: row.status,
    assigneeAgentId: maybeString(row.assignee_agent_id),
    assigneeName: maybeString(row.assignee_name),
    createdByType: row.created_by_type,
    createdById: row.created_by_id,
    createdByName: maybeString(row.created_by_name),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const rowAttachment = (row: any): AttachmentRecord => ({
    id: row.id,
    channelId: row.channel_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    path: row.path,
    createdAt: row.created_at
  });

  const rowDevice = (row: any): DeviceRecord => {
    const capabilities = normalizeDeviceCapabilities(parseJson<DeviceCapability[]>(row.capabilities, []));
    return {
      id: row.id,
      serverId: row.server_id,
      ownerUserId: row.owner_user_id,
      displayName: row.display_name,
      deviceKind: row.device_kind,
      platform: row.platform,
      appVersion: row.app_version,
      status: row.status,
      capabilities,
      capabilityDescriptors: normalizeDeviceCapabilityDescriptors(capabilities, parseJson<DeviceCapabilityDescriptor[]>(row.capability_descriptors, [])),
      permissionStates: parseJson<Partial<Record<DeviceCapability, DevicePermissionState>>>(row.permission_states, {}),
      deviceToken: maybeString(row.device_token),
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      deletedAt: maybeString(row.deleted_at)
    };
  };

  const rowDevicePairingToken = (row: any): DevicePairingTokenRecord => ({
    id: row.id,
    serverId: row.server_id,
    createdByUserId: row.created_by_user_id,
    displayName: maybeString(row.display_name),
    pinnedAgentId: maybeString(row.pinned_agent_id),
    pairingToken: row.pairing_token,
    expiresAt: row.expires_at,
    consumedAt: maybeString(row.consumed_at),
    createdAt: row.created_at
  });

  const rowMachineOnboardingIntent = (row: any): MachineOnboardingIntentRecord => {
    const expired = row.status === "pending" && Date.parse(row.expires_at) <= Date.now();
    return {
      id: row.id,
      serverId: row.server_id,
      machineId: row.machine_id,
      requestedByUserId: row.requested_by_user_id,
      requestedByAgentId: maybeString(row.requested_by_agent_id),
      status: expired ? "expired" : row.status,
      expiresAt: row.expires_at,
      consumedAt: maybeString(row.consumed_at),
      revokedAt: maybeString(row.revoked_at),
      createdAt: row.created_at
    };
  };

  const rowDeviceGrant = (row: any): DeviceGrantRecord => ({
    id: row.id,
    serverId: row.server_id,
    agentId: row.agent_id,
    deviceId: row.device_id,
    capabilities: parseJson<DeviceCapability[]>(row.capabilities, []),
    scope: row.scope,
    expiresAt: maybeString(row.expires_at),
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    revokedAt: maybeString(row.revoked_at)
  });

  const rowDeviceCommand = (row: any): DeviceCommandRecord => ({
    id: row.id,
    serverId: row.server_id,
    agentId: row.agent_id,
    deviceId: row.device_id,
    grantId: maybeString(row.grant_id),
    capability: row.capability,
    params: parseJson<Record<string, unknown>>(row.params, {}),
    status: row.status,
    requestedByMessageId: maybeString(row.requested_by_message_id),
    channelId: maybeString(row.channel_id),
    taskId: maybeString(row.task_id),
    reason: maybeString(row.reason),
    artifactIds: parseJson<string[] | undefined>(row.artifact_ids, undefined),
    data: parseJson<Record<string, unknown> | undefined>(row.result_data, undefined),
    errorCode: maybeString(row.error_code),
    errorMessage: maybeString(row.error_message),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    completedAt: maybeString(row.completed_at)
  });

  const rowMobileAppBinding = (row: any): MobileAppBindingRecord => ({
    id: row.id,
    serverId: row.server_id,
    userId: row.user_id,
    deviceId: row.device_id,
    pinnedAgentId: maybeString(row.pinned_agent_id),
    pinnedChannelId: maybeString(row.pinned_channel_id),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: maybeString(row.revoked_at),
    lastSeenAt: maybeString(row.last_seen_at)
  });

  const rowTelegramBindingCode = (row: any): TelegramBindingCodeRecord => ({
    id: row.id,
    userId: row.user_id,
    serverId: row.server_id,
    status: row.status === "consumed" ? "consumed" : row.status === "expired" ? "expired" : "pending",
    expiresAt: row.expires_at,
    consumedAt: maybeString(row.consumed_at),
    createdAt: row.created_at
  });

  const rowTelegramAccount = (row: any): TelegramAccountRecord => ({
    id: row.id,
    userId: row.user_id,
    serverId: row.server_id,
    telegramUserId: row.telegram_user_id,
    telegramChatId: row.telegram_chat_id,
    username: maybeString(row.username),
    firstName: maybeString(row.first_name),
    lastName: maybeString(row.last_name),
    status: row.status === "revoked" ? "revoked" : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: maybeString(row.revoked_at),
    lastSeenAt: maybeString(row.last_seen_at)
  });

  const rowTelegramOutboundDelivery = (row: any): TelegramOutboundDeliveryRecord => ({
    id: row.id,
    telegramAccountId: row.telegram_account_id,
    telegramChatId: row.telegram_chat_id,
    messageId: row.message_id,
    messageSeq: Number(row.message_seq),
    chunkIndex: Number(row.chunk_index),
    text: row.text,
    status: row.status,
    attempts: Number(row.attempts),
    nextAttemptAt: row.next_attempt_at,
    telegramMessageId: maybeString(row.telegram_message_id),
    lastError: maybeString(row.last_error),
    sentAt: maybeString(row.sent_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const rowTelegramApprovalAction = (row: any): TelegramApprovalActionRecord => ({
    id: row.id,
    approvalId: row.approval_id,
    serverId: row.server_id,
    userId: row.user_id,
    telegramUserId: row.telegram_user_id,
    decision: row.decision,
    status: row.status === "consumed" ? "consumed" : "pending",
    expiresAt: row.expires_at,
    consumedAt: maybeString(row.consumed_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const rowReminder = (row: any): ReminderRecord => ({
    id: row.id,
    ownerAgentId: row.owner_agent_id,
    title: row.title,
    status: row.status,
    fireAt: row.fire_at,
    version: Number(row.version ?? 1),
    repeat: maybeString(row.repeat),
    fireCount: Number(row.fire_count ?? 0),
    messageId: maybeString(row.message_id),
    channelId: maybeString(row.channel_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const rowRuntimeApproval = (row: any): RuntimeApprovalRecord => ({
    id: row.id,
    serverId: maybeString(row.server_id),
    machineId: row.machine_id,
    agentId: row.agent_id,
    executionId: maybeString(row.execution_id),
    taskId: maybeString(row.task_id),
    messageId: maybeString(row.message_id),
    threadChannelId: maybeString(row.thread_channel_id),
    runtime: row.runtime,
    launchId: maybeString(row.launch_id),
    requestId: row.request_id,
    method: row.method,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    payload: parseJson(row.payload, undefined),
    status: row.status,
    decision: maybeString(row.decision) as RuntimeApprovalDecision | undefined,
    customResponse: maybeString(row.custom_response),
    requestedAt: row.requested_at,
    resolvedAt: maybeString(row.resolved_at),
    resolvedByUserId: maybeString(row.resolved_by_user_id)
  });

  const rowAgentRuntimeSession = (row: any): AgentRuntimeSessionRecord => ({
    id: row.id,
    serverId: row.server_id,
    agentId: row.agent_id,
    machineId: row.machine_id,
    runtime: row.runtime,
    contextKind: row.context_kind,
    contextId: row.context_id,
    contextKey: row.context_key,
    profileRevision: Number(row.profile_revision ?? 1),
    generation: Number(row.generation),
    runtimeSessionId: maybeString(row.runtime_session_id),
    status: row.status,
    lastLaunchId: maybeString(row.last_launch_id),
    firstExecutionId: maybeString(row.first_execution_id),
    lastExecutionId: maybeString(row.last_execution_id),
    lastError: maybeString(row.last_error),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    invalidatedAt: maybeString(row.invalidated_at)
  });

  const rowRuntimeExecution = (row: any): RuntimeExecutionRecord => ({
    id: row.id,
    serverId: maybeString(row.server_id),
    machineId: row.machine_id,
    agentId: row.agent_id,
    agentName: maybeString(row.agent_name),
    agentDisplayName: maybeString(row.agent_display_name),
    agentOwnerUserId: maybeString(row.agent_owner_user_id),
    machineName: maybeString(row.machine_name),
    machineHostname: maybeString(row.machine_hostname),
    machineOwnerUserId: maybeString(row.machine_owner_user_id),
    taskId: maybeString(row.task_id),
    messageId: row.message_id,
    threadChannelId: maybeString(row.thread_channel_id),
    runtime: row.runtime,
    launchId: maybeString(row.launch_id),
    runtimeContextKey: maybeString(row.runtime_context_key),
    runtimeSessionRecordId: maybeString(row.runtime_session_record_id),
    runtimeSessionId: maybeString(row.runtime_session_id),
    runtimeSessionGeneration: row.runtime_session_generation === null || row.runtime_session_generation === undefined
      ? undefined
      : Number(row.runtime_session_generation),
    sourceExecutionId: maybeString(row.source_execution_id),
    returnToAgentId: maybeString(row.return_to_agent_id),
    rootMessageId: maybeString(row.root_message_id),
    hopCount: row.hop_count === null || row.hop_count === undefined ? undefined : Number(row.hop_count),
    expectReply: row.expect_reply === null || row.expect_reply === undefined ? undefined : Boolean(Number(row.expect_reply)),
    returnMessageId: maybeString(row.return_message_id),
    returnExecutionId: maybeString(row.return_execution_id),
    returnDispatchedAt: maybeString(row.return_dispatched_at),
    communicationReturnChannelId: maybeString(row.communication_return_channel_id),
    communicationReturnConversationId: maybeString(row.communication_return_conversation_id),
    communicationReturnSourceMessageId: maybeString(row.communication_return_source_message_id),
    communicationReturnUserId: maybeString(row.communication_return_user_id),
    communicationReturnSource: maybeString(row.communication_return_source) as RuntimeExecutionRecord["communicationReturnSource"],
    communicationReturnExternalRef: maybeString(row.communication_return_external_ref),
    communicationReturnInstructions: maybeString(row.communication_return_instructions),
    communicationReturnInstructionsRevision: row.communication_return_instructions_revision === null || row.communication_return_instructions_revision === undefined
      ? undefined
      : Number(row.communication_return_instructions_revision),
    communicationReturnMessageId: maybeString(row.communication_return_message_id),
    communicationReturnDispatchedAt: maybeString(row.communication_return_dispatched_at),
    controllerActorMode: maybeString(row.controller_actor_mode) as RuntimeExecutionRecord["controllerActorMode"],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: maybeString(row.completed_at)
  });

  const rowRuntimeExecutionEvent = (row: any): RuntimeExecutionEventRecord => ({
    id: row.id,
    executionId: row.execution_id,
    agentId: row.agent_id,
    taskId: maybeString(row.task_id),
    kind: row.kind,
    sequence: Number(row.sequence),
    title: maybeString(row.title) ?? null,
    detail: maybeString(row.detail) ?? null,
    payload: parseJson(row.payload, undefined),
    at: row.at
  });

  const rowExecutionGroup = (row: any): ExecutionGroupRecord => ({
    id: row.id,
    serverId: row.server_id,
    taskId: maybeString(row.task_id),
    messageId: maybeString(row.message_id),
    threadChannelId: maybeString(row.thread_channel_id),
    status: row.status,
    title: row.title,
    createdByUserId: maybeString(row.created_by_user_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: maybeString(row.completed_at)
  });

  const rowAgentRun = (row: any): AgentRunRecord => ({
    id: row.id,
    groupId: row.group_id,
    machineId: row.machine_id,
    agentId: row.agent_id,
    agentName: maybeString(row.agent_name),
    agentDisplayName: maybeString(row.agent_display_name),
    agentOwnerUserId: maybeString(row.agent_owner_user_id),
    machineName: maybeString(row.machine_name),
    machineHostname: maybeString(row.machine_hostname),
    machineOwnerUserId: maybeString(row.machine_owner_user_id),
    runtime: row.runtime,
    launchId: maybeString(row.launch_id),
    status: row.status,
    inputArtifactIds: parseJson(row.input_artifact_ids, []),
    outputArtifactIds: parseJson(row.output_artifact_ids, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: maybeString(row.completed_at)
  });

  const rowExecutionBlock = (row: any): ExecutionBlockRecord => ({
    id: row.id,
    groupId: row.group_id,
    runId: maybeString(row.run_id),
    agentId: maybeString(row.agent_id),
    groupSequence: Number(row.group_sequence),
    runSequence: row.run_sequence === null || row.run_sequence === undefined ? undefined : Number(row.run_sequence),
    kind: row.kind,
    title: row.title,
    bodyPreview: maybeString(row.body_preview),
    bodyRef: maybeString(row.body_ref),
    status: maybeString(row.status) as ExecutionBlockRecord["status"],
    approvalId: maybeString(row.approval_id),
    governanceDecisionId: maybeString(row.governance_decision_id),
    artifactId: maybeString(row.artifact_id),
    rawEventIds: parseJson(row.raw_event_ids, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const rowExecutionArtifact = (row: any): ExecutionArtifactRecord => ({
    id: row.id,
    groupId: row.group_id,
    runId: maybeString(row.run_id),
    agentId: maybeString(row.agent_id),
    kind: row.kind,
    title: row.title,
    preview: maybeString(row.preview),
    refType: row.ref_type,
    refId: maybeString(row.ref_id),
    createdAt: row.created_at
  });

  const rowSafetyAssessment = (row: any): SafetyAssessmentRecord => ({
    id: row.id,
    serverId: row.server_id,
    machineId: row.machine_id,
    agentId: row.agent_id,
    runtime: row.runtime,
    trigger: row.trigger,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    status: row.status as SafetyAuditStatus,
    label: row.label as SafetyLabel,
    riskTypes: parseJson(row.risk_types, []),
    analysis: row.analysis,
    evidence: parseJson(row.evidence, []),
    executionId: maybeString(row.execution_id),
    approvalId: maybeString(row.approval_id),
    taskId: maybeString(row.task_id),
    messageId: maybeString(row.message_id),
    threadChannelId: maybeString(row.thread_channel_id),
    model: maybeString(row.model),
    error: maybeString(row.error),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: maybeString(row.completed_at)
  });

  const rowGovernanceDecision = (row: any): GovernanceDecisionRecord => ({
    id: row.id,
    serverId: row.server_id,
    machineId: row.machine_id,
    agentId: row.agent_id,
    runtime: row.runtime,
    trigger: row.trigger,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    mode: row.mode,
    decision: row.decision,
    confidence: Number(row.confidence ?? 0),
    riskTypes: parseJson(row.risk_types, []),
    reason: row.reason,
    evidence: parseJson(row.evidence, []),
    policyVersion: maybeString(row.policy_version),
    policySource: maybeString(row.policy_source) as GovernanceDecisionRecord["policySource"],
    policyScope: maybeString(row.policy_scope) as GovernanceDecisionRecord["policyScope"],
    decisionSource: maybeString(row.decision_source) as GovernanceDecisionRecord["decisionSource"],
    executionId: maybeString(row.execution_id),
    approvalId: maybeString(row.approval_id),
    taskId: maybeString(row.task_id),
    messageId: maybeString(row.message_id),
    threadChannelId: maybeString(row.thread_channel_id),
    model: maybeString(row.model),
    caseSummary: parseJson<Record<string, unknown> | undefined>(row.case_summary, undefined),
    createdAt: row.created_at
  });

  const rowGovernancePolicyConfig = (row: any): GovernancePolicyConfigRecord => ({
    id: row.id,
    serverId: row.server_id,
    scope: governancePolicyConfigScope(row.scope),
    agentId: maybeString(row.agent_id),
    policySource: "db_config",
    version: row.version,
    rules: sanitizeGovernancePolicyRules(parseJson(row.rules, {})),
    createdByUserId: maybeString(row.created_by_user_id),
    updatedByUserId: maybeString(row.updated_by_user_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const rowGovernancePolicyConfigAudit = (row: any): GovernancePolicyConfigAuditRecord => ({
    id: row.id,
    configId: row.config_id,
    serverId: row.server_id,
    scope: governancePolicyConfigScope(row.scope),
    agentId: maybeString(row.agent_id),
    action: governancePolicyConfigAuditAction(row.action),
    policySource: "db_config",
    version: row.version,
    rules: sanitizeGovernancePolicyRules(parseJson(row.rules, {})),
    actorUserId: maybeString(row.actor_user_id),
    createdAt: row.created_at
  });

  const rowChannelMember = (row: any): ChannelMemberRecord => ({
    channelId: row.channel_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    role: row.role === "owner" ? "owner" : "member",
    joinedAt: row.joined_at,
    leftAt: maybeString(row.left_at) ?? null,
    ordinaryDeliveryEnabled: Boolean(row.ordinary_delivery_enabled)
  });

  const rowThreadFollow = (row: any): ThreadFollowRecord => ({
    threadChannelId: row.thread_channel_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    followedAt: row.followed_at,
    unfollowedAt: maybeString(row.unfollowed_at) ?? null
  });

  const getDefaultUserId = () => db.prepare("select id from users order by created_at limit 1").pluck().get() as string;

  function currentUser(userId?: string): UserRecord {
    const row = userId
      ? db.prepare("select * from users where id = ?").get(userId)
      : db.prepare("select * from users order by created_at limit 1").get();
    return rowUser(row);
  }

  function getUser(userId: string): UserRecord | null {
    const row = db.prepare("select * from users where id = ?").get(userId);
    return row ? rowUser(row) : null;
  }

  function findUser(identifier: string): UserRecord | null {
    const value = identifier.trim();
    if (!value) return null;
    const row = db.prepare(
      `select * from users
       where id = ? or lower(email) = lower(?) or lower(name) = lower(?)
       order by created_at
       limit 1`
    ).get(value, value, value);
    return row ? rowUser(row) : null;
  }

  function primaryServerIdForUser(userId: string): string | null {
    const row = db.prepare(
      `select servers.id
       from server_members
       join servers on servers.id = server_members.server_id
       where server_members.user_id = ?
       order by server_members.joined_at desc
       limit 1`
    ).get(userId) as { id?: string } | undefined;
    return row?.id ?? null;
  }

  function isServerMemberInternal(userId: string, serverId: string): boolean {
    return Boolean(db.prepare("select 1 from server_members where user_id = ? and server_id = ?").get(userId, serverId));
  }

  function serverMemberRoleInternal(userId: string, serverId: string): ServerMemberRole | null {
    const role = db.prepare("select role from server_members where user_id = ? and server_id = ?").pluck().get(userId, serverId);
    return role ? serverMemberRole(role) : null;
  }

  function hasWorkspaceServerAccess(userId: string, serverId: string): boolean {
    const role = serverMemberRoleInternal(userId, serverId);
    return role === "owner" || role === "member";
  }

  function upsertActiveServerForUser(userId: string, serverId: string): void {
    // active server 是 Web 和 Add Computer 的当前工作区真源，不能继续依赖 joined_at 的隐式排序。
    db.prepare(
      `insert into user_server_preferences (user_id, active_server_id, updated_at)
       values (?, ?, ?)
       on conflict(user_id) do update set
         active_server_id = excluded.active_server_id,
         updated_at = excluded.updated_at`
    ).run(userId, serverId, nowIso());
  }

  function getActiveServerIdForUser(userId: string): string | null {
    const row = db.prepare(
      `select user_server_preferences.active_server_id as id
       from user_server_preferences
       join server_members
         on server_members.user_id = user_server_preferences.user_id
        and server_members.server_id = user_server_preferences.active_server_id
       where user_server_preferences.user_id = ?
       limit 1`
    ).get(userId) as { id?: string } | undefined;
    if (row?.id) return row.id;
    const fallback = primaryServerIdForUser(userId);
    if (fallback) upsertActiveServerForUser(userId, fallback);
    return fallback;
  }

  function setActiveServerForUser(userId: string, serverId: string): ServerRecord | null {
    if (!isServerMemberInternal(userId, serverId)) return null;
    upsertActiveServerForUser(userId, serverId);
    return listServersForUser(userId).find((server) => server.id === serverId) ?? null;
  }

  function uniqueServerSlug(name: string): string {
    const base = slugifyName(name || "workspace") || "workspace";
    let slug = base;
    let index = 2;
    while (db.prepare("select 1 from servers where slug = ?").get(slug)) {
      slug = `${base}-${index}`;
      index += 1;
    }
    return slug;
  }

  function createSession(userId: string): { accessToken: string; refreshToken: string } {
    const accessToken = token("tyr_access");
    const refreshToken = token("tyr_refresh");
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + WEB_ACCESS_TOKEN_TTL_MS).toISOString();
    const refreshExpiresAt = new Date(Date.now() + WEB_REFRESH_TOKEN_TTL_MS).toISOString();
    db.prepare(
      `insert into auth_sessions
        (access_token, refresh_token, user_id, created_at, expires_at, refresh_expires_at, last_refreshed_at)
       values (?, ?, ?, ?, ?, ?, ?)`
    ).run(accessToken, refreshToken, userId, createdAt, expiresAt, refreshExpiresAt, createdAt);
    return { accessToken, refreshToken };
  }

  function acceptPendingInvitesForUser(userId: string, email: string): string[] {
    const now = nowIso();
    const invites = db.prepare(
      `select * from server_invites
       where lower(invited_email) = ? and status = 'pending' and expires_at > ?`
    ).all(email.trim().toLowerCase(), now) as Array<{ id: string; server_id: string }>;
    if (invites.length === 0) return [];
    const acceptedServerIds: string[] = [];
    const tx = db.transaction(() => {
      const joinedAt = nowIso();
      const addMember = db.prepare(
        `insert into server_members (server_id, user_id, role, joined_at)
         values (?, ?, 'guest', ?)
         on conflict(server_id, user_id) do update set role = 'guest', joined_at = excluded.joined_at`
      );
      const acceptInvite = db.prepare("update server_invites set status = 'accepted' where id = ?");
      for (const invite of invites) {
        const serverId = invite.server_id ?? "local";
        addMember.run(serverId, userId, joinedAt);
        acceptInvite.run(invite.id);
        acceptedServerIds.push(serverId);
      }
    });
    tx();
    return acceptedServerIds;
  }

  function registerUser(input: { email: string; password: string; name: string; serverName?: string; passwordSetupRequired?: boolean }) {
    const email = input.email.trim().toLowerCase();
    const displayName = input.name.trim();
    const name = slugifyName(displayName);
    if (!email || !displayName || input.password.length < 8) throw new Error("invalid_registration");
    const existing = db.prepare("select id from users where lower(email) = ? or name = ?").get(email, name);
    if (existing) throw new Error("user_exists");
    const createdAt = nowIso();
    const user = {
      id: id("user"),
      name,
      displayName,
      email,
      description: null,
      avatarUrl: null,
      emailVerified: false,
      passwordSetupRequired: Boolean(input.passwordSetupRequired),
      preferredLanguage: null,
      createdAt
    } satisfies UserRecord;
    db.prepare(
      `insert into users (id, name, display_name, email, password_hash, description, avatar_url, email_verified, password_setup_required, preferred_language, created_at)
       values (@id, @name, @displayName, @email, @passwordHash, null, null, 0, @passwordSetupRequired, null, @createdAt)`
    ).run({ ...user, passwordHash: hashPassword(input.password), passwordSetupRequired: user.passwordSetupRequired ? 1 : 0 });
    const personalServer = ensurePersonalServerForUser(user.id, input.serverName);
    const acceptedServerIds = acceptPendingInvitesForUser(user.id, email);
    setActiveServerForUser(user.id, acceptedServerIds[acceptedServerIds.length - 1] ?? personalServer.id);
    const session = createSession(user.id);
    return { user, ...session };
  }

  function loginUser(input: { email: string; password: string }) {
    const row = db.prepare("select * from users where lower(email) = ?").get(input.email.trim().toLowerCase()) as any;
    if (!row || !verifyPassword(input.password, row.password_hash)) return null;
    const acceptedServerIds = acceptPendingInvitesForUser(row.id, row.email);
    if (acceptedServerIds.length > 0) setActiveServerForUser(row.id, acceptedServerIds[acceptedServerIds.length - 1]);
    if (!getActiveServerIdForUser(row.id)) ensurePersonalServerForUser(row.id);
    const session = createSession(row.id);
    return { user: rowUser(row), ...session };
  }

  function createPlatformOperator(input: { login: string; password: string; displayName: string }): PlatformOperatorRecord {
    const login = input.login.trim().toLowerCase();
    const displayName = input.displayName.trim();
    if (!login || !displayName || input.password.length < 12) throw new Error("invalid_platform_operator");
    if (db.prepare("select 1 from platform_operators where lower(login) = ?").get(login)) {
      throw new Error("platform_operator_exists");
    }
    const createdAt = nowIso();
    const record = {
      id: id("platform_operator"),
      login,
      displayName,
      passwordHash: hashPassword(input.password),
      enabled: 1,
      createdAt,
      updatedAt: createdAt
    };
    db.prepare(
      `insert into platform_operators (id, login, display_name, password_hash, enabled, created_at, updated_at)
       values (@id, @login, @displayName, @passwordHash, @enabled, @createdAt, @updatedAt)`
    ).run(record);
    return rowPlatformOperator(db.prepare("select * from platform_operators where id = ?").get(record.id));
  }

  function findPlatformOperator(login: string): PlatformOperatorRecord | null {
    const row = db.prepare("select * from platform_operators where lower(login) = lower(?) limit 1").get(login.trim());
    return row ? rowPlatformOperator(row) : null;
  }

  function verifyPlatformOperatorPassword(operatorId: string, password: string): boolean {
    const row = db.prepare("select password_hash from platform_operators where id = ? and enabled = 1").get(operatorId) as { password_hash?: string } | undefined;
    return verifyPassword(password, row?.password_hash);
  }

  function loginPlatformOperator(input: { login: string; password: string }): { operator: PlatformOperatorRecord; sessionToken: string; expiresAt: string } | null {
    const row = db.prepare("select * from platform_operators where lower(login) = lower(?) and enabled = 1 limit 1").get(input.login.trim()) as any;
    if (!row || !verifyPassword(input.password, row.password_hash)) return null;
    const sessionToken = `tyr_operator_${randomBytes(32).toString("hex")}`;
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    // Operator session 只保存摘要；数据库泄露时不能直接拿 session 值访问所有演示 Workspace。
    db.prepare(
      `insert into platform_operator_sessions
       (id, operator_id, token_hash, expires_at, last_seen_at, revoked_at, created_at)
       values (?, ?, ?, ?, ?, null, ?)`
    ).run(id("platform_operator_session"), row.id, bearerTokenHash(sessionToken), expiresAt, createdAt, createdAt);
    return { operator: rowPlatformOperator(row), sessionToken, expiresAt };
  }

  function getPlatformOperatorBySessionToken(sessionToken: string): PlatformOperatorRecord | null {
    if (!sessionToken) return null;
    const now = nowIso();
    const row = db.prepare(
      `select platform_operators.*
       from platform_operator_sessions
       join platform_operators on platform_operators.id = platform_operator_sessions.operator_id
       where platform_operator_sessions.token_hash = ?
         and platform_operator_sessions.revoked_at is null
         and platform_operator_sessions.expires_at > ?
         and platform_operators.enabled = 1
       limit 1`
    ).get(bearerTokenHash(sessionToken), now) as any;
    if (!row) return null;
    db.prepare("update platform_operator_sessions set last_seen_at = ? where token_hash = ?")
      .run(now, bearerTokenHash(sessionToken));
    return rowPlatformOperator(row);
  }

  function revokePlatformOperatorSession(sessionToken: string): void {
    if (!sessionToken) return;
    db.prepare("update platform_operator_sessions set revoked_at = ? where token_hash = ? and revoked_at is null")
      .run(nowIso(), bearerTokenHash(sessionToken));
  }

  function normalizePlatformOperatorScopes(scopes: PlatformOperatorScope[]): PlatformOperatorScope[] {
    return [...new Set(scopes)].filter((scope) => PLATFORM_OPERATOR_SCOPES.includes(scope)).sort();
  }

  function upsertPlatformOperatorWorkspaceGrant(input: {
    operatorId: string;
    serverId: string;
    scopes: PlatformOperatorScope[];
  }): PlatformOperatorWorkspaceGrantRecord {
    if (!db.prepare("select 1 from platform_operators where id = ? and enabled = 1").get(input.operatorId)) {
      throw new Error("platform_operator_not_found");
    }
    if (!db.prepare("select 1 from servers where id = ?").get(input.serverId)) throw new Error("server_not_found");
    // 仅供历史数据兼容；Global Operator 的实时授权不再依赖该 scope 记录。
    const scopes = normalizePlatformOperatorScopes(input.scopes);
    if (scopes.length === 0) throw new Error("platform_operator_scope_required");
    const now = nowIso();
    db.prepare(
      `insert into platform_operator_workspace_grants
       (operator_id, server_id, scopes, created_at, updated_at)
       values (?, ?, ?, ?, ?)
       on conflict(operator_id, server_id) do update set scopes = excluded.scopes, updated_at = excluded.updated_at`
    ).run(input.operatorId, input.serverId, stringify(scopes as JsonValue), now, now);
    return listPlatformOperatorWorkspaceGrants(input.operatorId).find((grant) => grant.serverId === input.serverId)!;
  }

  function listPlatformOperatorWorkspaceGrants(operatorId: string): PlatformOperatorWorkspaceGrantRecord[] {
    return db.prepare(
      `select grants.*, servers.name as server_name
       from platform_operator_workspace_grants grants
       join servers on servers.id = grants.server_id
       where grants.operator_id = ?
       order by servers.name`
    ).all(operatorId).map(rowPlatformOperatorWorkspaceGrant);
  }

  function hasPlatformOperatorScope(operatorId: string, serverId: string, scope: PlatformOperatorScope): boolean {
    return listPlatformOperatorWorkspaceGrants(operatorId)
      .some((grant) => grant.serverId === serverId && grant.scopes.includes(scope));
  }

  function listPlatformOperatorWorkspaces(operatorId: string): PlatformOperatorWorkspaceRecord[] {
    const operator = db.prepare("select created_at, updated_at from platform_operators where id = ? and enabled = 1")
      .get(operatorId) as { created_at: string; updated_at: string } | undefined;
    if (!operator) return [];
    // Global Operator 天然覆盖全部 Workspace；历史 grant 表只保留兼容，不再决定可见性或权限。
    return (db.prepare("select id, name, created_at from servers order by name, id").all() as Array<{
      id: string;
      name: string;
      created_at: string;
    }>).map((server) => ({
      serverId: server.id,
      serverName: server.name,
      createdAt: server.created_at
    }));
  }

  function tyrHeartbeatIntervalMs(unit: TyrHeartbeatIntervalUnit, value: number): number {
    if ((unit !== "minute" && unit !== "hour") || !Number.isInteger(value) || value < 1 || value > 10_080) {
      throw new Error("heartbeat_interval_invalid");
    }
    return value * (unit === "minute" ? 60_000 : 3_600_000);
  }

  function validateTyrHeartbeatText(title: string, instruction: string): void {
    if (!title.trim() || title.trim().length > 120) throw new Error("heartbeat_title_invalid");
    if (!instruction.trim() || instruction.trim().length > 20_000) throw new Error("heartbeat_instruction_invalid");
  }

  function createTyrHeartbeat(input: {
    serverId: string;
    tyrAgentId: string;
    title: string;
    instruction: string;
    intervalUnit: TyrHeartbeatIntervalUnit;
    intervalValue: number;
    createdByUserId?: string;
    createdByOperatorId?: string;
  }): TyrHeartbeatRecord {
    validateTyrHeartbeatText(input.title, input.instruction);
    const intervalMs = tyrHeartbeatIntervalMs(input.intervalUnit, input.intervalValue);
    const tyrAgent = getAgent(input.tyrAgentId);
    if (!tyrAgent || !isCommunicationAgent(tyrAgent) || (tyrAgent.serverId ?? "local") !== input.serverId) {
      throw new Error("heartbeat_tyr_agent_required");
    }
    const now = nowIso();
    const heartbeatId = id("tyr_heartbeat");
    db.prepare(
      `insert into tyr_heartbeats
       (id, server_id, tyr_agent_id, title, instruction, interval_unit, interval_value, enabled, next_run_at, created_by_user_id, created_by_operator_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
    ).run(
      heartbeatId,
      input.serverId,
      input.tyrAgentId,
      input.title.trim(),
      input.instruction.trim(),
      input.intervalUnit,
      input.intervalValue,
      new Date(Date.parse(now) + intervalMs).toISOString(),
      input.createdByUserId ?? null,
      input.createdByOperatorId ?? null,
      now,
      now
    );
    return getTyrHeartbeat(heartbeatId)!;
  }

  function getTyrHeartbeat(heartbeatId: string, serverId?: string): TyrHeartbeatRecord | null {
    const row = serverId
      ? db.prepare("select * from tyr_heartbeats where id = ? and server_id = ?").get(heartbeatId, serverId)
      : db.prepare("select * from tyr_heartbeats where id = ?").get(heartbeatId);
    return row ? rowTyrHeartbeat(row) : null;
  }

  function listTyrHeartbeats(serverId?: string): TyrHeartbeatRecord[] {
    const rows = serverId
      ? db.prepare("select * from tyr_heartbeats where server_id = ? order by created_at").all(serverId)
      : db.prepare("select * from tyr_heartbeats order by server_id, created_at").all();
    return rows.map(rowTyrHeartbeat);
  }

  function updateTyrHeartbeat(
    heartbeatId: string,
    serverId: string,
    input: { title?: string; instruction?: string; intervalUnit?: TyrHeartbeatIntervalUnit; intervalValue?: number; enabled?: boolean }
  ): TyrHeartbeatRecord | null {
    const current = getTyrHeartbeat(heartbeatId, serverId);
    if (!current) return null;
    const title = input.title === undefined ? current.title : input.title.trim();
    const instruction = input.instruction === undefined ? current.instruction : input.instruction.trim();
    const intervalUnit = input.intervalUnit ?? current.intervalUnit;
    const intervalValue = input.intervalValue ?? current.intervalValue;
    validateTyrHeartbeatText(title, instruction);
    const intervalMs = tyrHeartbeatIntervalMs(intervalUnit, intervalValue);
    const enabled = input.enabled ?? current.enabled;
    const scheduleChanged = intervalUnit !== current.intervalUnit || intervalValue !== current.intervalValue || (enabled && !current.enabled);
    const now = nowIso();
    // 手动重新启用或修改周期时从当前时间重新计时，避免立即补跑旧周期。
    const nextRunAt = scheduleChanged ? new Date(Date.parse(now) + intervalMs).toISOString() : current.nextRunAt;
    db.prepare(
      `update tyr_heartbeats
       set title = ?, instruction = ?, interval_unit = ?, interval_value = ?, enabled = ?, next_run_at = ?, updated_at = ?
       where id = ? and server_id = ?`
    ).run(title, instruction, intervalUnit, intervalValue, enabled ? 1 : 0, nextRunAt, now, heartbeatId, serverId);
    return getTyrHeartbeat(heartbeatId, serverId);
  }

  function enqueueDueTyrHeartbeatRuns(now = nowIso()): TyrHeartbeatRunRecord[] {
    const enqueue = db.transaction(() => {
      const due = db.prepare(
        "select * from tyr_heartbeats where enabled = 1 and next_run_at <= ? order by next_run_at limit 100"
      ).all(now).map(rowTyrHeartbeat);
      const created: TyrHeartbeatRunRecord[] = [];
      for (const heartbeat of due) {
        const runId = id("tyr_heartbeat_run");
        const createdAt = nowIso();
        const inserted = db.prepare(
          `insert or ignore into tyr_heartbeat_runs
           (id, heartbeat_id, server_id, scheduled_for, status, execution_ids, created_at, updated_at)
           values (?, ?, ?, ?, 'queued', '[]', ?, ?)`
        ).run(runId, heartbeat.id, heartbeat.serverId, heartbeat.nextRunAt, createdAt, createdAt);
        // 每次 tick 最多补一个逾期周期；重启后不会制造历史 run 风暴。
        const nextRunAt = new Date(Date.parse(now) + tyrHeartbeatIntervalMs(heartbeat.intervalUnit, heartbeat.intervalValue)).toISOString();
        db.prepare("update tyr_heartbeats set next_run_at = ?, updated_at = ? where id = ?")
          .run(nextRunAt, createdAt, heartbeat.id);
        if (inserted.changes > 0) {
          created.push(rowTyrHeartbeatRun(db.prepare("select * from tyr_heartbeat_runs where id = ?").get(runId)));
        }
      }
      return created;
    });
    return enqueue();
  }

  function claimNextTyrHeartbeatRun(heartbeatId: string, now = nowIso()): TyrHeartbeatRunRecord | null {
    const claim = db.transaction(() => {
      if (db.prepare("select 1 from tyr_heartbeat_runs where heartbeat_id = ? and status = 'running' limit 1").get(heartbeatId)) return null;
      const row = db.prepare(
        "select * from tyr_heartbeat_runs where heartbeat_id = ? and status = 'queued' order by scheduled_for, created_at limit 1"
      ).get(heartbeatId) as any;
      if (!row) return null;
      const updated = db.prepare(
        "update tyr_heartbeat_runs set status = 'running', started_at = ?, updated_at = ? where id = ? and status = 'queued'"
      ).run(now, now, row.id);
      return updated.changes > 0
        ? rowTyrHeartbeatRun(db.prepare("select * from tyr_heartbeat_runs where id = ?").get(row.id))
        : null;
    });
    return claim();
  }

  function updateTyrHeartbeatRun(runId: string, input: {
    status?: TyrHeartbeatRunStatus;
    sourceMessageId?: string | null;
    executionIds?: string[];
    selectedAgentId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    completedAt?: string | null;
  }): TyrHeartbeatRunRecord | null {
    const row = db.prepare("select * from tyr_heartbeat_runs where id = ?").get(runId);
    if (!row) return null;
    const current = rowTyrHeartbeatRun(row);
    const status = input.status ?? current.status;
    const now = nowIso();
    const terminal = status === "succeeded" || status === "failed" || status === "cancelled";
    db.prepare(
      `update tyr_heartbeat_runs
       set status = ?, source_message_id = ?, execution_ids = ?, selected_agent_id = ?, error_code = ?, error_message = ?, completed_at = ?, updated_at = ?
       where id = ?`
    ).run(
      status,
      input.sourceMessageId === undefined ? current.sourceMessageId ?? null : input.sourceMessageId,
      stringify((input.executionIds ?? current.executionIds) as JsonValue),
      input.selectedAgentId === undefined ? current.selectedAgentId ?? null : input.selectedAgentId,
      input.errorCode === undefined ? current.errorCode ?? null : input.errorCode,
      input.errorMessage === undefined ? current.errorMessage ?? null : input.errorMessage,
      input.completedAt === undefined ? (terminal ? current.completedAt ?? now : current.completedAt ?? null) : input.completedAt,
      now,
      runId
    );
    return rowTyrHeartbeatRun(db.prepare("select * from tyr_heartbeat_runs where id = ?").get(runId));
  }

  function cancelQueuedTyrHeartbeatRuns(
    heartbeatId: string,
    input: { errorCode?: string; errorMessage?: string } = {}
  ): TyrHeartbeatRunRecord[] {
    const now = nowIso();
    // 暂停只撤销尚未开始的周期；正在执行的 run 保留到真实终态，避免半途丢失文件写入结果。
    const queuedIds = db.prepare(
      "select id from tyr_heartbeat_runs where heartbeat_id = ? and status = 'queued' order by scheduled_for, created_at"
    ).all(heartbeatId).map((row: any) => String(row.id));
    if (queuedIds.length === 0) return [];
    const cancel = db.prepare(
      `update tyr_heartbeat_runs
       set status = 'cancelled', error_code = ?, error_message = ?, completed_at = ?, updated_at = ?
       where id = ? and status = 'queued'`
    );
    const transaction = db.transaction(() => {
      for (const runId of queuedIds) {
        cancel.run(
          input.errorCode ?? "heartbeat_paused",
          input.errorMessage ?? "Cancelled because the Heartbeat was paused.",
          now,
          now,
          runId
        );
      }
      return queuedIds
        .map((runId) => db.prepare("select * from tyr_heartbeat_runs where id = ?").get(runId))
        .filter(Boolean)
        .map(rowTyrHeartbeatRun);
    });
    return transaction();
  }

  function listTyrHeartbeatRuns(input: { serverId?: string; heartbeatId?: string; status?: TyrHeartbeatRunStatus; limit?: number } = {}): TyrHeartbeatRunRecord[] {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (input.serverId) { clauses.push("server_id = ?"); args.push(input.serverId); }
    if (input.heartbeatId) { clauses.push("heartbeat_id = ?"); args.push(input.heartbeatId); }
    if (input.status) { clauses.push("status = ?"); args.push(input.status); }
    const limit = Math.max(1, Math.min(1_000, input.limit ?? 100));
    return db.prepare(
      `select * from tyr_heartbeat_runs${clauses.length ? ` where ${clauses.join(" and ")}` : ""} order by scheduled_for desc limit ?`
    ).all(...args, limit).map(rowTyrHeartbeatRun);
  }

  function validateWorkspaceSharedFileName(value: string): string {
    const name = value.trim();
    if (!name || name.length > 255 || name === "." || name === ".." || path.basename(name) !== name || /[\\/\0]/.test(name)) {
      throw new Error("workspace_shared_file_name_invalid");
    }
    return name;
  }

  function validateWorkspaceSharedFileContent(input: { mimeType: string; sizeBytes: number; sha256: string; storagePath: string }): void {
    if (!input.mimeType.trim() || input.mimeType.length > 255) throw new Error("workspace_shared_file_mime_invalid");
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0 || input.sizeBytes > 50 * 1024 * 1024) throw new Error("workspace_shared_file_size_invalid");
    if (!/^[a-f0-9]{64}$/i.test(input.sha256)) throw new Error("workspace_shared_file_sha256_invalid");
    if (!input.storagePath.trim()) throw new Error("workspace_shared_file_storage_invalid");
  }

  function workspaceSharedFileAssignments(fileId: string): WorkspaceSharedFileAssignmentRecord[] {
    return db.prepare(
      "select * from workspace_shared_file_assignments where file_id = ? order by agent_id"
    ).all(fileId).map(rowWorkspaceSharedFileAssignment);
  }

  function getWorkspaceSharedFile(fileId: string, serverId?: string): WorkspaceSharedFileStoredRecord | null {
    const row = serverId
      ? db.prepare("select * from workspace_shared_files where id = ? and server_id = ?").get(fileId, serverId)
      : db.prepare("select * from workspace_shared_files where id = ?").get(fileId);
    if (!row) return null;
    const file = rowWorkspaceSharedFile(row);
    file.assignments = workspaceSharedFileAssignments(file.id);
    return file;
  }

  function listWorkspaceSharedFiles(serverId: string): WorkspaceSharedFileRecord[] {
    return db.prepare(
      "select * from workspace_shared_files where server_id = ? order by name collate nocase"
    ).all(serverId).map((row) => {
      const { storagePath: _storagePath, originalStoragePath: _originalStoragePath, ...file } = rowWorkspaceSharedFile(row);
      file.assignments = workspaceSharedFileAssignments(file.id);
      return file;
    });
  }

  function createWorkspaceSharedFile(input: {
    id?: string;
    serverId: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    storagePath: string;
    originalName?: string;
    originalMimeType?: string;
    originalSizeBytes?: number;
    originalSha256?: string;
    originalStoragePath?: string;
    createdByUserId?: string;
    createdByOperatorId?: string;
  }): WorkspaceSharedFileStoredRecord {
    const name = validateWorkspaceSharedFileName(input.name);
    validateWorkspaceSharedFileContent(input);
    const original = {
      name: validateWorkspaceSharedFileName(input.originalName ?? name),
      mimeType: input.originalMimeType ?? input.mimeType,
      sizeBytes: input.originalSizeBytes ?? input.sizeBytes,
      sha256: input.originalSha256 ?? input.sha256,
      storagePath: input.originalStoragePath ?? input.storagePath
    };
    validateWorkspaceSharedFileContent(original);
    if (!db.prepare("select 1 from servers where id = ?").get(input.serverId)) throw new Error("server_not_found");
    const fileId = input.id?.trim() || id("workspace_file");
    const now = nowIso();
    try {
      db.prepare(
        `insert into workspace_shared_files
         (id, server_id, name, mime_type, size_bytes, sha256, storage_path,
          original_name, original_mime_type, original_size_bytes, original_sha256, original_storage_path,
          version, created_by_user_id, created_by_operator_id, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
      ).run(
        fileId,
        input.serverId,
        name,
        input.mimeType.trim(),
        input.sizeBytes,
        input.sha256.toLowerCase(),
        input.storagePath,
        original.name,
        original.mimeType.trim(),
        original.sizeBytes,
        original.sha256.toLowerCase(),
        original.storagePath,
        input.createdByUserId ?? null,
        input.createdByOperatorId ?? null,
        now,
        now
      );
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) throw new Error("workspace_shared_file_name_exists");
      throw error;
    }
    return getWorkspaceSharedFile(fileId, input.serverId)!;
  }

  function replaceWorkspaceSharedFile(input: {
    fileId: string;
    serverId: string;
    expectedVersion: number;
    name?: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    storagePath: string;
  }): WorkspaceSharedFileStoredRecord | null {
    const current = getWorkspaceSharedFile(input.fileId, input.serverId);
    if (!current) return null;
    const name = input.name === undefined ? current.name : validateWorkspaceSharedFileName(input.name);
    validateWorkspaceSharedFileContent(input);
    const now = nowIso();
    let result;
    try {
      // version 条件与内容元数据同一条 SQL 提交，多个 Agent 同时写同一文件时只有一个可胜出。
      result = db.prepare(
        `update workspace_shared_files
         set name = ?, mime_type = ?, size_bytes = ?, sha256 = ?, storage_path = ?, version = version + 1, updated_at = ?
         where id = ? and server_id = ? and version = ?`
      ).run(name, input.mimeType.trim(), input.sizeBytes, input.sha256.toLowerCase(), input.storagePath, now, input.fileId, input.serverId, input.expectedVersion);
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) throw new Error("workspace_shared_file_name_exists");
      throw error;
    }
    return result.changes > 0 ? getWorkspaceSharedFile(input.fileId, input.serverId) : null;
  }

  function replaceWorkspaceSharedFileOriginal(input: {
    fileId: string;
    serverId: string;
    expectedVersion: number;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    storagePath: string;
  }): WorkspaceSharedFileStoredRecord | null {
    const originalName = validateWorkspaceSharedFileName(input.originalName);
    validateWorkspaceSharedFileContent(input);
    const result = db.prepare(
      `update workspace_shared_files
       set original_name = ?, original_mime_type = ?, original_size_bytes = ?, original_sha256 = ?,
           original_storage_path = ?, version = version + 1, updated_at = ?
       where id = ? and server_id = ? and version = ?`
    ).run(originalName, input.mimeType.trim(), input.sizeBytes, input.sha256.toLowerCase(), input.storagePath,
      nowIso(), input.fileId, input.serverId, input.expectedVersion);
    return result.changes > 0 ? getWorkspaceSharedFile(input.fileId, input.serverId) : null;
  }

  function renameWorkspaceSharedFile(fileId: string, serverId: string, value: string): WorkspaceSharedFileStoredRecord | null {
    const current = getWorkspaceSharedFile(fileId, serverId);
    if (!current) return null;
    const name = validateWorkspaceSharedFileName(value);
    if (name === current.name) return current;
    try {
      db.prepare(
        "update workspace_shared_files set name = ?, version = version + 1, updated_at = ? where id = ? and server_id = ?"
      ).run(name, nowIso(), fileId, serverId);
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) throw new Error("workspace_shared_file_name_exists");
      throw error;
    }
    return getWorkspaceSharedFile(fileId, serverId);
  }

  function setWorkspaceSharedFileAssignments(input: {
    fileId: string;
    serverId: string;
    assignments: Array<{ agentId: string; permission: WorkspaceSharedFilePermission }>;
    createdByUserId?: string;
    createdByOperatorId?: string;
  }): WorkspaceSharedFileRecord | null {
    const file = getWorkspaceSharedFile(input.fileId, input.serverId);
    if (!file) return null;
    const normalized = input.assignments.map((assignment) => ({
      agentId: assignment.agentId.trim(),
      permission: assignment.permission
    }));
    if (new Set(normalized.map((assignment) => assignment.agentId)).size !== normalized.length) {
      throw new Error("workspace_shared_file_assignment_duplicate");
    }
    for (const assignment of normalized) {
      if (assignment.permission !== "read-only" && assignment.permission !== "read-write") {
        throw new Error("workspace_shared_file_permission_invalid");
      }
      const agent = getAgent(assignment.agentId);
      if (!agent || agent.deletedAt || isCommunicationAgent(agent) || (agent.serverId ?? "local") !== input.serverId) {
        throw new Error("workspace_shared_file_agent_invalid");
      }
    }
    db.transaction(() => {
      db.prepare("delete from workspace_shared_file_assignments where file_id = ?").run(input.fileId);
      const statement = db.prepare(
        `insert into workspace_shared_file_assignments
         (file_id, agent_id, permission, created_by_user_id, created_by_operator_id, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?)`
      );
      const now = nowIso();
      for (const assignment of normalized) {
        statement.run(input.fileId, assignment.agentId, assignment.permission, input.createdByUserId ?? null, input.createdByOperatorId ?? null, now, now);
      }
      db.prepare("update workspace_shared_files set updated_at = ? where id = ?").run(now, input.fileId);
    })();
    const { storagePath: _storagePath, originalStoragePath: _originalStoragePath, ...publicFile } = getWorkspaceSharedFile(input.fileId, input.serverId)!;
    return publicFile;
  }

  function listAgentSharedFiles(agentId: string): Array<{ file: WorkspaceSharedFileStoredRecord; permission: WorkspaceSharedFilePermission }> {
    return db.prepare(
      `select files.*, assignments.permission
       from workspace_shared_file_assignments assignments
       join workspace_shared_files files on files.id = assignments.file_id
       where assignments.agent_id = ?
       order by files.name collate nocase`
    ).all(agentId).map((row: any) => ({ file: rowWorkspaceSharedFile(row), permission: row.permission }));
  }

  function deleteWorkspaceSharedFile(fileId: string, serverId: string): WorkspaceSharedFileStoredRecord | null {
    const file = getWorkspaceSharedFile(fileId, serverId);
    if (!file) return null;
    db.prepare("delete from workspace_shared_files where id = ? and server_id = ?").run(fileId, serverId);
    return file;
  }

  function refreshSession(refreshToken: string): { user: UserRecord; accessToken: string; refreshToken: string } | null {
    if (!refreshToken) return null;
    const refreshedAt = nowIso();
    const idleCutoff = new Date(Date.now() - WEB_REFRESH_TOKEN_IDLE_TTL_MS).toISOString();
    return db.transaction(() => {
      const row = db.prepare(
        `select users.*,
                auth_sessions.access_token as session_access_token,
                auth_sessions.refresh_token as session_refresh_token
         from auth_sessions
         join users on users.id = auth_sessions.user_id
         where (
             auth_sessions.refresh_token = ?
             or (
               auth_sessions.previous_refresh_token = ?
               and auth_sessions.previous_refresh_expires_at > ?
             )
           )
           and auth_sessions.refresh_expires_at > ?
           and auth_sessions.last_refreshed_at > ?`
      ).get(refreshToken, refreshToken, refreshedAt, refreshedAt, idleCutoff) as any;
      if (!row) return null;
      if (row.session_refresh_token !== refreshToken) {
        return {
          user: rowUser(row),
          accessToken: row.session_access_token,
          refreshToken: row.session_refresh_token
        };
      }

      const nextAccessToken = token("tyr_access");
      const nextRefreshToken = token("tyr_refresh");
      const accessExpiresAt = new Date(Date.now() + WEB_ACCESS_TOKEN_TTL_MS).toISOString();
      const previousRefreshExpiresAt = new Date(Date.now() + WEB_REFRESH_ROTATION_GRACE_MS).toISOString();
      const rotated = db.prepare(
        `update auth_sessions
         set access_token = ?,
             refresh_token = ?,
             previous_refresh_token = ?,
             previous_refresh_expires_at = ?,
             expires_at = ?,
             last_refreshed_at = ?
         where refresh_token = ?
           and refresh_expires_at > ?
           and last_refreshed_at > ?`
      ).run(
        nextAccessToken,
        nextRefreshToken,
        refreshToken,
        previousRefreshExpiresAt,
        accessExpiresAt,
        refreshedAt,
        refreshToken,
        refreshedAt,
        idleCutoff
      );
      if (rotated.changes !== 1) return null;
      return { user: rowUser(row), accessToken: nextAccessToken, refreshToken: nextRefreshToken };
    })();
  }

  // Invitation return destinations are exact local routes, never arbitrary redirects.
  function signupBridgeInvitation(returnPath: string, email: string) {
    const code = /^\/bridge\/connect\/([A-Za-z0-9_-]{43})$/.exec(returnPath)?.[1];
    if (!code) return null;
    const row = db.prepare(`select i.id, i.status, i.expires_at, e.recipient_email, e.recipient_user_id,
      m.role as inviter_role from workspace_bridge_connection_intents i
      left join workspace_bridge_email_invitations e on e.intent_id = i.id
      left join server_members m on m.server_id = i.source_workspace_id and m.user_id = i.invited_by_user_id
      where i.code_hash = ?`).get(bearerTokenHash(code)) as {
        id: string; status: string; expires_at: string; recipient_email: string | null;
        recipient_user_id: string | null; inviter_role: string | null;
      } | undefined;
    return row && row.status === "pending" && row.expires_at > nowIso() && row.inviter_role && row.inviter_role !== "guest"
      && (!row.recipient_email || row.recipient_email === email) ? row : null;
  }

  function bindSignupBridgeRecipient(intent: HelpdeskSignupIntentRecord, userId: string) {
    if (!intent.returnPath || intent.source !== "email") return;
    const invite = signupBridgeInvitation(intent.returnPath, intent.email);
    if (invite?.recipient_email) db.prepare(`update workspace_bridge_email_invitations set recipient_user_id = ?
      where intent_id = ? and recipient_user_id is null`).run(userId, invite.id);
  }

  function createHelpdeskSignupIntent(input: { email: string; source: HelpdeskSignupIntentRecord["source"]; subject?: string | null; message?: string | null; expiresAt?: string; returnPath?: string }): { intent: HelpdeskSignupIntentRecord; token: string } {
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("invalid_email");
    const createdAt = nowIso();
    const rawToken = token("tyr_signup");
    const bridge = input.returnPath ? signupBridgeInvitation(input.returnPath, email) : null;
    if (input.returnPath && !bridge) throw new Error("signup_invite_unavailable");
    // Public web signup must not turn a directed email link into proof of mailbox ownership.
    if (bridge?.recipient_email && input.source !== "email") throw new Error("signup_invite_email_required");
    const intent = {
      id: id("helpdesk_signup"),
      email,
      source: input.source === "mock_email" ? "mock_email" : "email",
      subject: input.subject?.trim() || null,
      message: input.message?.trim() || null,
      confirmationTokenHash: bearerTokenHash(rawToken),
      returnPath: input.returnPath ?? null,
      status: "pending",
      expiresAt: input.expiresAt ?? bridge?.expires_at ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      completedAt: null,
      createdUserId: null,
      createdAt
    };
    db.prepare(
      `insert into helpdesk_signup_intents
        (id, email, source, subject, message, confirmation_token_hash, return_path, status, expires_at, completed_at, created_user_id, created_at)
       values (@id, @email, @source, @subject, @message, @confirmationTokenHash, @returnPath, @status, @expiresAt, null, null, @createdAt)`
    ).run(intent);
    return { intent: rowHelpdeskSignupIntent({
      id: intent.id,
      email: intent.email,
      source: intent.source,
      subject: intent.subject,
      return_path: intent.returnPath,
      status: intent.status,
      expires_at: intent.expiresAt,
      completed_at: null,
      created_user_id: null,
      created_at: intent.createdAt
    }), token: rawToken };
  }

  function getHelpdeskSignupIntentByToken(rawToken: string): HelpdeskSignupIntentRecord | null {
    const normalized = rawToken.trim();
    if (!normalized) return null;
    const row = db.prepare("select * from helpdesk_signup_intents where confirmation_token_hash = ?").get(bearerTokenHash(normalized)) as any;
    return row ? materializeHelpdeskSignupIntent(row) : null;
  }

  function materializeHelpdeskSignupIntent(row: any): HelpdeskSignupIntentRecord {
    if (row.status === "pending" && row.expires_at <= nowIso()) {
      db.prepare("update helpdesk_signup_intents set status = 'expired' where id = ? and status = 'pending'").run(row.id);
      row.status = "expired";
    }
    return rowHelpdeskSignupIntent(row);
  }

  function helpdeskSignupIntentById(intentId: string): HelpdeskSignupIntentRecord {
    return rowHelpdeskSignupIntent(db.prepare("select * from helpdesk_signup_intents where id = ?").get(intentId));
  }

  function completeHelpdeskSignupIntent(rawToken: string, input: { name?: string; password?: string; serverName?: string }): HelpdeskSignupCompleteResult {
    const intent = getHelpdeskSignupIntentByToken(rawToken);
    if (!intent) return { ok: false, reason: "invalid" };
    if (intent.status === "expired") return { ok: false, reason: "expired", intent };
    if (intent.status === "completed") return { ok: false, reason: "completed", intent };
    const tx = db.transaction((): HelpdeskSignupCompleteResult => {
      const current = getHelpdeskSignupIntentByToken(rawToken);
      if (!current || current.status !== "pending") return { ok: false,
        reason: !current ? "invalid" : current.status === "expired" ? "expired" : "completed", intent: current ?? undefined };
      if (intent.returnPath && !signupBridgeInvitation(intent.returnPath, intent.email)) {
        return { ok: false, reason: "invite_unavailable", intent };
      }
      try {
        const existingUser = findUser(intent.email);
        if (existingUser) {
          if (intent.source !== "email" || !existingUser.passwordSetupRequired) {
            // The account may have been created after the email was sent. Verify the
            // recipient binding, but require normal login instead of taking over its session.
            bindSignupBridgeRecipient(intent, existingUser.id);
            return { ok: false, reason: "user_exists", intent };
          }
          bindSignupBridgeRecipient(intent, existingUser.id);
          const acceptedServerIds = acceptPendingInvitesForUser(existingUser.id, existingUser.email ?? intent.email);
          if (acceptedServerIds.length > 0) setActiveServerForUser(existingUser.id, acceptedServerIds[acceptedServerIds.length - 1]);
          if (!getActiveServerIdForUser(existingUser.id)) ensurePersonalServerForUser(existingUser.id);
          db.prepare("update users set email_verified = 1 where id = ?").run(existingUser.id);
          const serverId = getActiveServerIdForUser(existingUser.id);
          if (serverId) ensureDefaultCommunicationAgent(serverId);
          const session = createSession(existingUser.id);
          const completedAt = nowIso();
          db.prepare(
            `update helpdesk_signup_intents
             set status = 'completed', completed_at = ?, created_user_id = ?
             where id = ? and status = 'pending'`
          ).run(completedAt, existingUser.id, intent.id);
          return {
            ok: true,
            intent: helpdeskSignupIntentById(intent.id),
            user: currentUser(existingUser.id),
            accessToken: session.accessToken,
            refreshToken: session.refreshToken
          };
        }
        const defaults = helpdeskSignupRegistrationDefaults(intent.email);
        const displayName = input.name?.trim() || defaults.name;
        const password = input.password || temporarySignupPassword();
        const passwordSetupRequired = !input.password;
        const registered = registerUser({
          email: intent.email,
          password,
          name: displayName,
          serverName: input.serverName?.trim() || defaults.serverName,
          passwordSetupRequired
        });
        db.prepare("update users set email_verified = 1 where id = ?").run(registered.user.id);
        bindSignupBridgeRecipient(intent, registered.user.id);
        const user = currentUser(registered.user.id);
        const serverId = getActiveServerIdForUser(user.id);
        if (serverId) ensureDefaultCommunicationAgent(serverId);
        const completedAt = nowIso();
        db.prepare(
          `update helpdesk_signup_intents
           set status = 'completed', completed_at = ?, created_user_id = ?
           where id = ? and status = 'pending'`
        ).run(completedAt, user.id, intent.id);
        return {
          ok: true,
          intent: helpdeskSignupIntentById(intent.id),
          user,
          accessToken: registered.accessToken,
          refreshToken: registered.refreshToken
        };
      } catch (err) {
        const reason = err instanceof Error && err.message === "user_exists" ? "user_exists" : "invalid_registration";
        return { ok: false, reason, intent };
      }
    });
    return tx();
  }

  function createHelpdeskPasswordRecoveryIntent(input: { email: string; userId: string; source: HelpdeskPasswordRecoveryIntentRecord["source"]; subject?: string | null; message?: string | null; expiresAt?: string }): { intent: HelpdeskPasswordRecoveryIntentRecord; token: string } {
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("invalid_email");
    const user = getUser(input.userId);
    if (!user || (user.email ?? "").toLowerCase() !== email) throw new Error("invalid_user");
    const createdAt = nowIso();
    const rawToken = token("tyr_recovery");
    const intent = {
      id: id("helpdesk_recovery"),
      email,
      userId: user.id,
      source: input.source === "mock_email" ? "mock_email" : "email",
      subject: input.subject?.trim() || null,
      message: input.message?.trim() || null,
      recoveryTokenHash: bearerTokenHash(rawToken),
      status: "pending",
      expiresAt: input.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      completedAt: null,
      createdAt
    };
    db.prepare(
      `insert into helpdesk_password_recovery_intents
        (id, email, user_id, source, subject, message, recovery_token_hash, status, expires_at, completed_at, created_at)
       values (@id, @email, @userId, @source, @subject, @message, @recoveryTokenHash, @status, @expiresAt, null, @createdAt)`
    ).run(intent);
    return { intent: rowHelpdeskPasswordRecoveryIntent({
      id: intent.id,
      email: intent.email,
      user_id: intent.userId,
      source: intent.source,
      subject: intent.subject,
      status: intent.status,
      expires_at: intent.expiresAt,
      completed_at: null,
      created_at: intent.createdAt
    }), token: rawToken };
  }

  function getHelpdeskPasswordRecoveryIntentByToken(rawToken: string): HelpdeskPasswordRecoveryIntentRecord | null {
    const normalized = rawToken.trim();
    if (!normalized) return null;
    const row = db.prepare("select * from helpdesk_password_recovery_intents where recovery_token_hash = ?").get(bearerTokenHash(normalized)) as any;
    return row ? materializeHelpdeskPasswordRecoveryIntent(row) : null;
  }

  function materializeHelpdeskPasswordRecoveryIntent(row: any): HelpdeskPasswordRecoveryIntentRecord {
    if (row.status === "pending" && row.expires_at <= nowIso()) {
      db.prepare("update helpdesk_password_recovery_intents set status = 'expired' where id = ? and status = 'pending'").run(row.id);
      row.status = "expired";
    }
    return rowHelpdeskPasswordRecoveryIntent(row);
  }

  function helpdeskPasswordRecoveryIntentById(intentId: string): HelpdeskPasswordRecoveryIntentRecord {
    return rowHelpdeskPasswordRecoveryIntent(db.prepare("select * from helpdesk_password_recovery_intents where id = ?").get(intentId));
  }

  function completeHelpdeskPasswordRecoveryIntent(rawToken: string, input: { password: string }): HelpdeskPasswordRecoveryCompleteResult {
    const intent = getHelpdeskPasswordRecoveryIntentByToken(rawToken);
    if (!intent) return { ok: false, reason: "invalid" };
    if (intent.status === "expired") return { ok: false, reason: "expired", intent };
    if (intent.status === "completed") return { ok: false, reason: "completed", intent };
    if (input.password.length < 8) return { ok: false, reason: "invalid_password", intent };
    const tx = db.transaction((): HelpdeskPasswordRecoveryCompleteResult => {
      db.prepare(
        "update users set password_hash = ?, password_setup_required = 0, email_verified = 1 where id = ?"
      ).run(hashPassword(input.password), intent.userId);
      // 密码恢复代表旧凭据失效；清掉旧 session 后只返回本次邮箱验证产生的新 session。
      db.prepare("delete from auth_sessions where user_id = ?").run(intent.userId);
      const session = createSession(intent.userId);
      const completedAt = nowIso();
      db.prepare(
        `update helpdesk_password_recovery_intents
         set status = 'completed', completed_at = ?
         where id = ? and status = 'pending'`
      ).run(completedAt, intent.id);
      return {
        ok: true,
        intent: helpdeskPasswordRecoveryIntentById(intent.id),
        user: currentUser(intent.userId),
        accessToken: session.accessToken,
        refreshToken: session.refreshToken
      };
    });
    return tx();
  }

  function claimHelpdeskResendEmailEvent(emailId: string, svixId?: string): { claimed: true; event: HelpdeskResendEmailEventRecord } | { claimed: false; event: HelpdeskResendEmailEventRecord } {
    const normalizedEmailId = emailId.trim();
    if (!normalizedEmailId) throw new Error("resend_email_id_required");
    const existing = db.prepare("select * from helpdesk_resend_email_events where email_id = ?").get(normalizedEmailId) as any;
    if (existing && existing.status !== "failed") {
      return { claimed: false, event: rowHelpdeskResendEmailEvent(existing) };
    }

    const now = nowIso();
    if (existing) {
      db.prepare(
        `update helpdesk_resend_email_events
         set svix_id = ?, status = 'processing', helpdesk_status = null, reply_email_id = null, error_code = null, updated_at = ?
         where email_id = ?`
      ).run(svixId?.trim() || null, now, normalizedEmailId);
    } else {
      db.prepare(
        `insert into helpdesk_resend_email_events
          (email_id, svix_id, status, helpdesk_status, reply_email_id, error_code, created_at, updated_at)
         values (?, ?, 'processing', null, null, null, ?, ?)`
      ).run(normalizedEmailId, svixId?.trim() || null, now, now);
    }
    return {
      claimed: true,
      event: rowHelpdeskResendEmailEvent(db.prepare("select * from helpdesk_resend_email_events where email_id = ?").get(normalizedEmailId))
    };
  }

  function completeHelpdeskResendEmailEvent(emailId: string, input: { helpdeskStatus?: string; replyEmailId?: string }): HelpdeskResendEmailEventRecord | null {
    const normalizedEmailId = emailId.trim();
    if (!normalizedEmailId) return null;
    const now = nowIso();
    db.prepare(
      `update helpdesk_resend_email_events
       set status = 'processed', helpdesk_status = ?, reply_email_id = ?, error_code = null, updated_at = ?
       where email_id = ?`
    ).run(input.helpdeskStatus?.trim() || null, input.replyEmailId?.trim() || null, now, normalizedEmailId);
    const row = db.prepare("select * from helpdesk_resend_email_events where email_id = ?").get(normalizedEmailId) as any;
    return row ? rowHelpdeskResendEmailEvent(row) : null;
  }

  function failHelpdeskResendEmailEvent(emailId: string, errorCode: string): HelpdeskResendEmailEventRecord | null {
    const normalizedEmailId = emailId.trim();
    if (!normalizedEmailId) return null;
    const now = nowIso();
    db.prepare(
      `update helpdesk_resend_email_events
       set status = 'failed', error_code = ?, updated_at = ?
       where email_id = ?`
    ).run(errorCode.trim() || "resend_helpdesk_failed", now, normalizedEmailId);
    const row = db.prepare("select * from helpdesk_resend_email_events where email_id = ?").get(normalizedEmailId) as any;
    return row ? rowHelpdeskResendEmailEvent(row) : null;
  }

  const { ensureCommunicationAgentEmailAlias, getCommunicationAgentEmailAliasByAddress,
    listCommunicationAgentEmailAliases, getCommunicationAgentEmailSettings, updateCommunicationAgentEmailAlias
  } = createCommunicationEmailStore(db, { getAgent, listServersForUser, recordAuditEvent });

  function getOrCreateCommunicationAgentExternalConversation(input: {
    source: "telegram" | "email";
    serverId: string;
    userId: string;
    assistantAgentId: string;
    sourceConversationKeys: string[];
    title: string;
    replace?: boolean;
  }): ConversationRecord | null {
    const membership = listServersForUser(input.userId).find((server) => server.id === input.serverId);
    const assistant = getAgent(input.assistantAgentId);
    if (!membership || !assistant || !isCommunicationAgent(assistant) || (assistant.serverId ?? "local") !== input.serverId) return null;
    const channel = getOrCreateAgentDm(assistant.id, input.userId);
    if (!channel) return null;
    const keys = Array.from(new Set(input.sourceConversationKeys.map((key) => key.trim()).filter(Boolean)));
    if (keys.length === 0) return null;

    let existingConversation: ConversationRecord | null = null;
    if (!input.replace) {
      for (const key of keys) {
        const row = db.prepare(
          `select conversation_id from communication_agent_external_conversations
           where source = ? and server_id = ? and user_id = ? and assistant_agent_id = ? and source_conversation_key = ?`
        ).get(input.source, input.serverId, input.userId, assistant.id, key) as { conversation_id?: string } | undefined;
        const candidate = row?.conversation_id ? getConversation(row.conversation_id) : null;
        if (candidate?.channelId === channel.id && candidate.status === "active" && !candidate.archivedAt) {
          existingConversation = candidate;
          break;
        }
      }
    }

    // 外部 chat/thread 各自拥有稳定可写上下文；创建或轮换它们不能关闭兄弟会话，也不能切走 Web 当前选择。
    const conversation = existingConversation ?? createConversation({
      channelId: channel.id,
      title: input.title.trim().slice(0, 72) || (input.source === "telegram" ? "Telegram" : "Email"),
      startedByType: "human",
      startedById: input.userId,
      closeExisting: false,
      setActive: false,
      resetStatus: "not_applicable"
    });
    const at = nowIso();
    const upsert = db.prepare(
      `insert into communication_agent_external_conversations
        (id, source, server_id, user_id, assistant_agent_id, channel_id, source_conversation_key, conversation_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(source, server_id, user_id, assistant_agent_id, source_conversation_key)
       do update set channel_id = excluded.channel_id, conversation_id = excluded.conversation_id, updated_at = excluded.updated_at`
    );
    db.transaction(() => {
      for (const key of keys) {
        upsert.run(
          id("external_conv"),
          input.source,
          input.serverId,
          input.userId,
          assistant.id,
          channel.id,
          key,
          conversation.id,
          at,
          at
        );
      }
    })();
    return conversation;
  }

  function getOrCreateCommunicationAgentHandoffConversation(input: {
    serverId: string;
    sourceConversationId: string;
    assistantAgentId: string;
    targetAgentId: string;
    channelId: string;
  }): ConversationRecord | null {
    const sourceRow = db.prepare("select * from conversations where id = ? and server_id = ?").get(input.sourceConversationId, input.serverId);
    const sourceConversation = sourceRow ? rowConversation(sourceRow) : null;
    const sourceChannel = sourceConversation ? resolveTarget(sourceConversation.channelId, input.serverId) : null;
    const targetChannel = resolveTarget(input.channelId, input.serverId);
    const targetPair = [input.assistantAgentId, input.targetAgentId].sort();
    const sourceAgentId = sourceChannel?.dmIdentity?.kind === "human_agent"
      ? sourceChannel.dmIdentity.agentId
      : sourceChannel?.dmIdentity?.kind === "workspace_bridge"
        ? sourceChannel.dmIdentity.agentId
        : null;
    const targetAgentIds = targetChannel?.dmIdentity?.kind === "agent_pair"
      ? [...targetChannel.dmIdentity.agentIds].sort()
      : [];
    // 只有 TYR 自己的来源 DM 能创建内部映射，且目标必须是同一 TYR 与 worker 的固定 Agent-pair DM。
    if (
      !sourceConversation ||
      sourceConversation.status !== "active" ||
      sourceConversation.archivedAt ||
      !sourceChannel ||
      sourceChannel.type !== "dm" ||
      sourceAgentId !== input.assistantAgentId ||
      !targetChannel ||
      targetChannel.type !== "dm" ||
      targetAgentIds.length !== targetPair.length ||
      targetAgentIds.some((agentId, index) => agentId !== targetPair[index])
    ) return null;

    const row = db.prepare(
      `select conversation_id from communication_agent_handoff_conversations
       where server_id = ? and source_conversation_id = ? and assistant_agent_id = ? and target_agent_id = ?`
    ).get(input.serverId, sourceConversation.id, input.assistantAgentId, input.targetAgentId) as { conversation_id?: string } | undefined;
    const existing = row?.conversation_id ? getConversation(row.conversation_id) : null;
    if (existing?.channelId === targetChannel.id && existing.status === "active" && !existing.archivedAt) return existing;

    // 每个来源 conversation 在 worker DM 中拥有稳定的隐藏 conversation；兄弟 eval 不共享 RuntimeContext。
    const conversation = createConversation({
      channelId: targetChannel.id,
      title: `TYR · ${sourceConversation.title}`,
      startedByType: "agent",
      startedById: input.assistantAgentId,
      closeExisting: false,
      setActive: false,
      resetStatus: "not_applicable"
    });
    const at = nowIso();
    db.prepare(
      `insert into communication_agent_handoff_conversations
        (id, server_id, source_conversation_id, assistant_agent_id, target_agent_id, channel_id, conversation_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(server_id, source_conversation_id, assistant_agent_id, target_agent_id)
       do update set channel_id = excluded.channel_id, conversation_id = excluded.conversation_id, updated_at = excluded.updated_at`
    ).run(
      id("handoff_conv"),
      input.serverId,
      sourceConversation.id,
      input.assistantAgentId,
      input.targetAgentId,
      targetChannel.id,
      conversation.id,
      at,
      at
    );
    return conversation;
  }

  function materializeCommunicationAgentPendingAction(row: any): CommunicationAgentPendingActionRecord {
    if (row.status === "pending" && row.expires_at <= nowIso()) {
      const resolvedAt = nowIso();
      db.prepare("update communication_agent_pending_actions set status = 'expired', resolved_at = ? where id = ? and status = 'pending'").run(resolvedAt, row.id);
      row.status = "expired";
      row.resolved_at = resolvedAt;
    }
    return rowCommunicationAgentPendingAction(row);
  }

  function createCommunicationAgentPendingAction(input: {
    serverId: string;
    userId: string;
    assistantAgentId: string;
    channelId: string;
    targetAgentId: string;
    instruction: string;
    sourceMessageId?: string | null;
    suggestionMessageId?: string | null;
    expiresAt?: string;
  }): CommunicationAgentPendingActionRecord {
    const instruction = input.instruction.trim();
    if (!instruction) throw new Error("communication_agent_pending_action_instruction_required");
    const createdAt = nowIso();
    const expiresAt = input.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const action = {
      id: id("comm_action"),
      serverId: input.serverId,
      userId: input.userId,
      assistantAgentId: input.assistantAgentId,
      channelId: input.channelId,
      sourceMessageId: input.sourceMessageId?.trim() || null,
      suggestionMessageId: input.suggestionMessageId?.trim() || null,
      targetAgentId: input.targetAgentId,
      instruction,
      status: "pending" as const,
      expiresAt,
      createdAt,
      resolvedAt: null
    };
    const tx = db.transaction(() => {
      const supersededAt = nowIso();
      // 同一条 TYR DM 里只允许最后一次建议可确认，避免用户 confirm 时执行旧建议。
      db.prepare(
        `update communication_agent_pending_actions
         set status = 'superseded', resolved_at = ?
         where server_id = ? and user_id = ? and assistant_agent_id = ? and channel_id = ? and status = 'pending'`
      ).run(supersededAt, input.serverId, input.userId, input.assistantAgentId, input.channelId);
      db.prepare(
        `insert into communication_agent_pending_actions
          (id, server_id, user_id, assistant_agent_id, channel_id, source_message_id, suggestion_message_id, target_agent_id, instruction, status, expires_at, created_at, resolved_at)
         values (@id, @serverId, @userId, @assistantAgentId, @channelId, @sourceMessageId, @suggestionMessageId, @targetAgentId, @instruction, @status, @expiresAt, @createdAt, null)`
      ).run(action);
      return action;
    });
    tx();
    return rowCommunicationAgentPendingAction({
      id: action.id,
      server_id: action.serverId,
      user_id: action.userId,
      assistant_agent_id: action.assistantAgentId,
      channel_id: action.channelId,
      source_message_id: action.sourceMessageId,
      suggestion_message_id: action.suggestionMessageId,
      target_agent_id: action.targetAgentId,
      instruction: action.instruction,
      status: action.status,
      expires_at: action.expiresAt,
      created_at: action.createdAt,
      resolved_at: null
    });
  }

  function getCommunicationAgentPendingAction(actionId: string): CommunicationAgentPendingActionRecord | null {
    const row = db.prepare("select * from communication_agent_pending_actions where id = ?").get(actionId.trim()) as any;
    return row ? materializeCommunicationAgentPendingAction(row) : null;
  }

  function getLatestCommunicationAgentPendingAction(input: { serverId: string; userId: string; assistantAgentId: string; channelId: string }): CommunicationAgentPendingActionRecord | null {
    const row = db.prepare(
      `select * from communication_agent_pending_actions
       where server_id = ? and user_id = ? and assistant_agent_id = ? and channel_id = ? and status = 'pending'
       order by created_at desc, id desc
       limit 1`
    ).get(input.serverId, input.userId, input.assistantAgentId, input.channelId) as any;
    return row ? materializeCommunicationAgentPendingAction(row) : null;
  }

  function hasUnresolvedCommunicationAgentPendingAction(input: { serverId: string; userId: string; assistantAgentId: string; channelId: string }): boolean {
    return Boolean(db.prepare(
      `select 1 from communication_agent_pending_actions
       where server_id = ? and user_id = ? and assistant_agent_id = ? and channel_id = ? and status = 'pending'
       limit 1`
    ).get(input.serverId, input.userId, input.assistantAgentId, input.channelId));
  }

  function attachCommunicationAgentPendingActionSuggestionMessage(actionId: string, suggestionMessageId: string): CommunicationAgentPendingActionRecord | null {
    const normalizedActionId = actionId.trim();
    const normalizedMessageId = suggestionMessageId.trim();
    if (!normalizedActionId || !normalizedMessageId) return null;
    db.prepare(
      `update communication_agent_pending_actions
       set suggestion_message_id = ?
       where id = ? and status = 'pending'`
    ).run(normalizedMessageId, normalizedActionId);
    const row = db.prepare("select * from communication_agent_pending_actions where id = ?").get(normalizedActionId) as any;
    return row ? materializeCommunicationAgentPendingAction(row) : null;
  }

  function resolveCommunicationAgentPendingAction(actionId: string, status: Exclude<CommunicationAgentPendingActionStatus, "pending">): CommunicationAgentPendingActionRecord | null {
    if (!["confirmed", "cancelled", "expired", "superseded"].includes(status)) return null;
    const current = getCommunicationAgentPendingAction(actionId);
    if (!current || current.status !== "pending") return null;
    const resolvedAt = nowIso();
    // 只允许 pending 进入终态；重复 confirm/cancel 直接返回 null，避免重复执行目标 agent。
    db.prepare("update communication_agent_pending_actions set status = ?, resolved_at = ? where id = ? and status = 'pending'").run(status, resolvedAt, actionId);
    const row = db.prepare("select * from communication_agent_pending_actions where id = ?").get(actionId) as any;
    return row ? rowCommunicationAgentPendingAction(row) : null;
  }

  function materializeCommunicationAgentManagementDraft(row: any): CommunicationAgentManagementDraftRecord {
    if (row.status === "pending" && row.expires_at <= nowIso()) {
      const resolvedAt = nowIso();
      // 草稿仅在读取时物化过期，避免后台定时任务与来源会话状态产生竞态。
      db.prepare(
        "update communication_agent_management_drafts set status = 'expired', resolved_at = ? where id = ? and status = 'pending'"
      ).run(resolvedAt, row.id);
      row.status = "expired";
      row.resolved_at = resolvedAt;
    }
    return rowCommunicationAgentManagementDraft(row);
  }

  function createCommunicationAgentManagementDraft(
    input: CreateCommunicationAgentManagementDraftInput
  ): { created: boolean; record: CommunicationAgentManagementDraftRecord } {
    const createdAt = nowIso();
    const draft = {
      id: id("comm_agent_draft"),
      operationId: id("comm_agent_operation"),
      serverId: input.serverId,
      userId: input.userId,
      assistantAgentId: input.assistantAgentId,
      channelId: input.channelId,
      source: input.source,
      sourceConversationKey: input.sourceConversationKey,
      sourceMessageId: input.sourceMessageId,
      sourceEventKey: input.sourceEventKey,
      action: input.action,
      stage: input.stage,
      paramsJson: JSON.stringify(input.params ?? {}),
      choicesJson: JSON.stringify(input.choices ?? []),
      status: "pending" as const,
      replyText: input.replyText ?? null,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      createdAt
    };
    const tx = db.transaction((): { created: boolean; record: CommunicationAgentManagementDraftRecord } => {
      const existing = db.prepare(
        `select * from communication_agent_management_drafts
         where server_id = ? and user_id = ? and assistant_agent_id = ? and source = ?
           and source_conversation_key = ? and source_event_key = ?`
      ).get(
        input.serverId,
        input.userId,
        input.assistantAgentId,
        input.source,
        input.sourceConversationKey,
        input.sourceEventKey
      ) as any;
      if (existing) return { created: false, record: materializeCommunicationAgentManagementDraft(existing) };

      // Web、Telegram、Email 共用流程，但只有同一来源会话中的 pending 草稿会被新请求取代。
      db.prepare(
        `update communication_agent_management_drafts
         set status = 'superseded', resolved_at = ?
         where server_id = ?
           and user_id = ?
           and assistant_agent_id = ?
           and source = ?
           and source_conversation_key = ?
           and status = 'pending'`
      ).run(
        createdAt,
        input.serverId,
        input.userId,
        input.assistantAgentId,
        input.source,
        input.sourceConversationKey
      );
      db.prepare(
        `insert into communication_agent_management_drafts
          (id, operation_id, server_id, user_id, assistant_agent_id, channel_id, source,
           source_conversation_key, source_message_id, source_event_key, action, stage,
           params_json, choices_json, status, reply_text, error_code, expires_at, created_at,
           confirmed_at, resolved_at)
         values (@id, @operationId, @serverId, @userId, @assistantAgentId, @channelId, @source,
           @sourceConversationKey, @sourceMessageId, @sourceEventKey, @action, @stage,
           @paramsJson, @choicesJson, @status, @replyText, null, @expiresAt, @createdAt, null, null)`
      ).run(draft);
      const row = db.prepare("select * from communication_agent_management_drafts where id = ?").get(draft.id) as any;
      return { created: true, record: rowCommunicationAgentManagementDraft(row) };
    });
    // 首次幂等读取前先取得写锁，确保并发连接串行观察同一 source event。
    return tx.immediate();
  }

  function getCommunicationAgentManagementDraft(draftId: string): CommunicationAgentManagementDraftRecord | null {
    const row = db.prepare("select * from communication_agent_management_drafts where id = ?").get(draftId.trim()) as any;
    return row ? materializeCommunicationAgentManagementDraft(row) : null;
  }

  function getLatestCommunicationAgentManagementDraft(
    input: CommunicationAgentManagementDraftScope
  ): CommunicationAgentManagementDraftRecord | null {
    const row = db.prepare(
      `select * from communication_agent_management_drafts
       where server_id = ?
         and user_id = ?
         and assistant_agent_id = ?
         and source = ?
         and source_conversation_key = ?
         and status = 'pending'
       order by created_at desc, id desc
       limit 1`
    ).get(
      input.serverId,
      input.userId,
      input.assistantAgentId,
      input.source,
      input.sourceConversationKey
    ) as any;
    return row ? materializeCommunicationAgentManagementDraft(row) : null;
  }

  function getLatestResolvedCommunicationAgentManagementDraft(
    input: CommunicationAgentManagementDraftScope
  ): CommunicationAgentManagementDraftRecord | null {
    const row = db.prepare(
      `select * from communication_agent_management_drafts
       where server_id = ?
         and user_id = ?
         and assistant_agent_id = ?
         and source = ?
         and source_conversation_key = ?
         and status in ('completed', 'failed', 'cancelled', 'expired')
       order by coalesce(resolved_at, created_at) desc, id desc
       limit 1`
    ).get(
      input.serverId,
      input.userId,
      input.assistantAgentId,
      input.source,
      input.sourceConversationKey
    ) as any;
    return row ? materializeCommunicationAgentManagementDraft(row) : null;
  }

  function attachCommunicationAgentManagementDraftSourceEvent(
    draftId: string,
    input: CommunicationAgentManagementDraftSourceEventScope
  ): CommunicationAgentManagementDraftRecord | null {
    const draft = getCommunicationAgentManagementDraft(draftId);
    if (!draft ||
      draft.serverId !== input.serverId ||
      draft.userId !== input.userId ||
      draft.assistantAgentId !== input.assistantAgentId ||
      draft.source !== input.source ||
      draft.sourceConversationKey !== input.sourceConversationKey ||
      !input.sourceEventKey.trim()) {
      return null;
    }
    const existing = getCommunicationAgentManagementDraftBySourceEvent(input);
    if (existing) return null;
    // Follow-up selection/confirm events bind to the original draft without replacing its operationId.
    const inserted = db.prepare(
      `insert or ignore into communication_agent_management_draft_source_events
        (draft_id, server_id, user_id, assistant_agent_id, source, source_conversation_key, source_event_key, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      draft.id,
      input.serverId,
      input.userId,
      input.assistantAgentId,
      input.source,
      input.sourceConversationKey,
      input.sourceEventKey.trim(),
      nowIso()
    );
    if (inserted.changes !== 1) {
      return null;
    }
    return getCommunicationAgentManagementDraft(draft.id);
  }

  function getCommunicationAgentManagementDraftBySourceEvent(
    input: CommunicationAgentManagementDraftSourceEventScope
  ): CommunicationAgentManagementDraftRecord | null {
    const sourceEventKey = input.sourceEventKey.trim();
    if (!sourceEventKey) return null;
    const direct = db.prepare(
      `select * from communication_agent_management_drafts
       where server_id = ? and user_id = ? and assistant_agent_id = ? and source = ?
         and source_conversation_key = ? and source_event_key = ?`
    ).get(
      input.serverId,
      input.userId,
      input.assistantAgentId,
      input.source,
      input.sourceConversationKey,
      sourceEventKey
    ) as any;
    if (direct) return materializeCommunicationAgentManagementDraft(direct);
    const replay = db.prepare(
      `select drafts.*
       from communication_agent_management_draft_source_events events
       join communication_agent_management_drafts drafts on drafts.id = events.draft_id
       where events.server_id = ? and events.user_id = ? and events.assistant_agent_id = ?
         and events.source = ? and events.source_conversation_key = ? and events.source_event_key = ?`
    ).get(
      input.serverId,
      input.userId,
      input.assistantAgentId,
      input.source,
      input.sourceConversationKey,
      sourceEventKey
    ) as any;
    return replay ? materializeCommunicationAgentManagementDraft(replay) : null;
  }

  function updateCommunicationAgentManagementDraft(
    draftId: string,
    input: UpdateCommunicationAgentManagementDraftInput
  ): CommunicationAgentManagementDraftRecord | null {
    const current = getCommunicationAgentManagementDraft(draftId);
    if (!current || current.status !== "pending") return null;
    const assignments: string[] = [];
    const values: unknown[] = [];
    // 只写调用方明确提供的列，避免并发连接用旧快照覆盖另一方已更新的工作流字段。
    if (input.stage !== undefined) {
      assignments.push("stage = ?");
      values.push(input.stage);
    }
    if (input.params !== undefined) {
      assignments.push("params_json = ?");
      values.push(JSON.stringify(input.params));
    }
    if (input.choices !== undefined) {
      assignments.push("choices_json = ?");
      values.push(JSON.stringify(input.choices));
    }
    if (input.replyText !== undefined) {
      assignments.push("reply_text = ?");
      values.push(input.replyText);
    }
    if (input.expiresAt !== undefined) {
      assignments.push("expires_at = ?");
      values.push(input.expiresAt);
    }
    if (assignments.length === 0) return current;
    const result = db.prepare(
      `update communication_agent_management_drafts
       set ${assignments.join(", ")}
       where id = ? and status = 'pending'`
    ).run(...values, current.id);
    if (result.changes !== 1) return null;
    const row = db.prepare("select * from communication_agent_management_drafts where id = ?").get(current.id) as any;
    return row ? materializeCommunicationAgentManagementDraft(row) : null;
  }

  function claimCommunicationAgentManagementDraft(draftId: string): CommunicationAgentManagementDraftRecord | null {
    const confirmedAt = nowIso();
    // SQL 条件同时承担确认幂等和过期保护；只有待确认的 pending 草稿能被 claim 一次。
    const result = db.prepare(
      `update communication_agent_management_drafts
       set status = 'confirmed', confirmed_at = ?
       where id = ?
         and status = 'pending'
         and stage = 'awaiting_confirmation'
         and expires_at > ?`
    ).run(confirmedAt, draftId.trim(), confirmedAt);
    if (result.changes !== 1) {
      getCommunicationAgentManagementDraft(draftId);
      return null;
    }
    const row = db.prepare("select * from communication_agent_management_drafts where id = ?").get(draftId.trim()) as any;
    return row ? rowCommunicationAgentManagementDraft(row) : null;
  }

  function resolveCommunicationAgentManagementDraft(
    draftId: string,
    status: Extract<CommunicationAgentManagementDraftStatus, "completed" | "failed" | "cancelled">,
    input: ResolveCommunicationAgentManagementDraftInput = {}
  ): CommunicationAgentManagementDraftRecord | null {
    if (status !== "completed" && status !== "failed" && status !== "cancelled") return null;
    const current = getCommunicationAgentManagementDraft(draftId);
    if (!current) return null;
    const transitionAllowed = current.status === "pending"
      ? status === "completed" || status === "failed" || status === "cancelled"
      : current.status === "confirmed" && (status === "completed" || status === "failed");
    if (!transitionAllowed) return null;

    const resolvedAt = nowIso();
    // confirmed 不允许取消；pending 则必须仍未过期，最终状态写入由同一条条件更新保证。
    const statusPredicate = status === "cancelled"
      ? "status = 'pending' and expires_at > @resolvedAt"
      : "((status = 'pending' and expires_at > @resolvedAt) or status = 'confirmed')";
    const assignments = ["status = @status", "resolved_at = @resolvedAt"];
    const parameters: Record<string, string | null> = {
      id: current.id,
      status,
      resolvedAt
    };
    // resolve 总会原子写入终态；回复字段只有调用方明确提供时才参与 SQL，避免旧快照覆盖并发更新。
    if (input.replyText !== undefined) {
      assignments.push("reply_text = @replyText");
      parameters.replyText = input.replyText;
    }
    if (input.errorCode !== undefined) {
      assignments.push("error_code = @errorCode");
      parameters.errorCode = input.errorCode;
    }
    const result = db.prepare(
      `update communication_agent_management_drafts
       set ${assignments.join(", ")}
       where id = @id and ${statusPredicate}`
    ).run(parameters);
    if (result.changes !== 1) {
      getCommunicationAgentManagementDraft(current.id);
      return null;
    }
    const row = db.prepare("select * from communication_agent_management_drafts where id = ?").get(current.id) as any;
    return row ? rowCommunicationAgentManagementDraft(row) : null;
  }

  function getUserByAccessToken(accessToken: string): UserRecord | null {
    const row = db.prepare(
      `select users.* from auth_sessions
       join users on users.id = auth_sessions.user_id
       where auth_sessions.access_token = ? and auth_sessions.expires_at > ?`
    ).get(accessToken, nowIso());
    return row ? rowUser(row) : null;
  }

  function logoutSession(refreshToken: string): void {
    if (!refreshToken) return;
    db.prepare("delete from auth_sessions where refresh_token = ? or previous_refresh_token = ?").run(refreshToken, refreshToken);
  }

  function updateUserProfile(userId: string, input: { displayName?: string; description?: string | null; preferredLanguage?: string | null }): UserRecord {
    const existing = currentUser(userId);
    const displayName = typeof input.displayName === "string" && input.displayName.trim()
      ? input.displayName.trim()
      : existing.displayName;
    const description = input.description === undefined ? existing.description ?? null : input.description;
    const preferredLanguage = input.preferredLanguage === undefined ? existing.preferredLanguage ?? null : input.preferredLanguage;
    db.prepare(
      `update users
       set display_name = ?, description = ?, preferred_language = ?
       where id = ?`
    ).run(displayName, description, preferredLanguage, userId);
    return currentUser(userId);
  }

  function changeUserPassword(userId: string, currentPassword: string, nextPassword: string): boolean {
    if (nextPassword.length < 8) throw new Error("invalid_password");
    const row = db.prepare("select password_hash from users where id = ?").get(userId) as { password_hash?: string } | undefined;
    if (!row?.password_hash || !verifyPassword(currentPassword, row.password_hash)) return false;
    db.prepare("update users set password_hash = ? where id = ?").run(hashPassword(nextPassword), userId);
    return true;
  }

  function verifyUserPassword(userId: string, password: string): boolean {
    const row = db.prepare("select password_hash from users where id = ?").get(userId) as { password_hash?: string } | undefined;
    return Boolean(row?.password_hash && verifyPassword(password, row.password_hash));
  }

  function setupUserPassword(userId: string, nextPassword: string): UserRecord {
    const user = currentUser(userId);
    if (!user.passwordSetupRequired) return user;
    if (nextPassword.length < 8) throw new Error("invalid_password");
    db.prepare(
      "update users set password_hash = ?, password_setup_required = 0 where id = ?"
    ).run(hashPassword(nextPassword), userId);
    return currentUser(userId);
  }

  function listServersForUser(userId: string): ServerRecord[] {
    return db.prepare(
      `select servers.*, server_members.role as member_role
       from server_members
       join servers on servers.id = server_members.server_id
       where server_members.user_id = ?
       order by server_members.joined_at desc`
    ).all(userId).map(rowServer);
  }

  function createServer(input: { name: string; ownerUserId: string }): ServerRecord {
    const owner = currentUser(input.ownerUserId);
    const createdAt = nowIso();
    // 新记录使用 Workspace 产品术语；已有 servers.name 数据保持原样，不做迁移。
    const displayName = input.name.trim() || `${owner.displayName || owner.name}'s Workspace`;
    const slug = uniqueServerSlug(displayName);
    const server = {
      id: id("server"),
      name: displayName,
      slug,
      ownerUserId: owner.id,
      onboardingAgentId: null,
      plan: "free",
      planDowngradedAt: null,
      createdAt
    };
    const tx = db.transaction(() => {
      db.prepare(
        `insert into servers (id, name, slug, owner_user_id, onboarding_agent_id, plan, plan_downgraded_at, created_at)
         values (@id, @name, @slug, @ownerUserId, @onboardingAgentId, @plan, @planDowngradedAt, @createdAt)`
      ).run(server);
      db.prepare(
        `insert into server_members (server_id, user_id, role, joined_at)
         values (?, ?, 'owner', ?)`
      ).run(server.id, owner.id, createdAt);
    });
    tx();
    upsertActiveServerForUser(owner.id, server.id);
    return {
      id: server.id,
      name: server.name,
      slug: server.slug,
      ownerId: server.ownerUserId,
      onboardingAgentId: null,
      plan: "free",
      planDowngradedAt: null,
      role: "owner",
      createdAt
    };
  }

  function updateServerName(serverId: string, name: string): ServerRecord | null {
    const displayName = name.trim();
    if (!displayName) return null;
    // Server slug is a stable identifier used by routing/switching; this edit is display-name only.
    db.prepare("update servers set name = ? where id = ?").run(displayName, serverId);
    const row = db.prepare("select servers.*, 'owner' as member_role from servers where id = ?").get(serverId);
    return row ? rowServer(row) : null;
  }

  function ensurePersonalServerForUser(userId: string, serverName?: string): ServerRecord {
    const existing = listServersForUser(userId).find((server) => server.ownerId === userId);
    if (existing) {
      if (!getActiveServerIdForUser(userId)) setActiveServerForUser(userId, existing.id);
      return existing;
    }
    const user = currentUser(userId);
    // 注册页允许用户命名自己的 Workspace；缺省时只影响新记录，不改写历史名称。
    return createServer({ name: serverName?.trim() || `${user.displayName || user.name}'s Workspace`, ownerUserId: user.id });
  }

  function createServerInvite(emailInput: string, invitedByUserId: string, serverId = getActiveServerIdForUser(invitedByUserId) ?? "local"): ServerInviteRecord {
    const email = emailInput.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("invalid_email");
    const createdAt = nowIso();
    const invite = {
      id: id("invite"),
      invitedEmail: email,
      invitedByUserId,
      status: "pending" as const,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt
    };
    db.prepare(
      `insert into server_invites (id, server_id, invited_email, invited_by_user_id, status, expires_at, created_at)
       values (@id, @serverId, @invitedEmail, @invitedByUserId, @status, @expiresAt, @createdAt)`
    ).run({ ...invite, serverId });
    return invite;
  }

  function listServerInvites(status = "pending", serverId = "local"): ServerInviteRecord[] {
    return db.prepare("select * from server_invites where status = ? and server_id = ? order by created_at desc").all(status, serverId).map(rowInvite);
  }

  function listIncomingServerInvites(emailInput: string): IncomingServerInviteRecord[] {
    const email = emailInput.trim().toLowerCase();
    if (!email) return [];
    return db.prepare(
      `select server_invites.*, servers.name as server_name, users.display_name as invited_by_name
       from server_invites
       join servers on servers.id = server_invites.server_id
       join users on users.id = server_invites.invited_by_user_id
       where lower(server_invites.invited_email) = ?
         and server_invites.status = 'pending'
         and server_invites.expires_at > ?
       order by server_invites.created_at desc`
    ).all(email, nowIso()).map(rowIncomingInvite);
  }

  function acceptServerInviteForUser(inviteId: string, userId: string): ServerInviteRecord | null {
    const user = currentUser(userId);
    const row = db.prepare(
      `select *
       from server_invites
       where (id = ? or id like ?)
         and lower(invited_email) = ?
         and status = 'pending'
         and expires_at > ?`
    ).get(inviteId, `${inviteId}%`, (user.email ?? "").trim().toLowerCase(), nowIso()) as any;
    if (!row) return null;
    const tx = db.transaction(() => {
      const joinedAt = nowIso();
      // 接受 invite 后显式切换 active server，Add Computer 会进入刚加入的协作空间。
      db.prepare(
        `insert into server_members (server_id, user_id, role, joined_at)
         values (?, ?, 'guest', ?)
         on conflict(server_id, user_id) do update set role = 'guest', joined_at = excluded.joined_at`
      ).run(row.server_id ?? "local", userId, joinedAt);
      db.prepare("update server_invites set status = 'accepted' where id = ?").run(row.id);
    });
    tx();
    setActiveServerForUser(userId, row.server_id ?? "local");
    return rowInvite(db.prepare("select * from server_invites where id = ?").get(row.id));
  }

  function revokeServerInvite(inviteId: string): ServerInviteRecord | null {
    const row = db.prepare("select * from server_invites where id = ? or id like ?").get(inviteId, `${inviteId}%`) as any;
    if (!row) return null;
    db.prepare("update server_invites set status = 'revoked' where id = ?").run(row.id);
    return rowInvite(db.prepare("select * from server_invites where id = ?").get(row.id));
  }

  function workspaceBridgeRows(serverId: string): any[] {
    return db.prepare(
      `select workspace_bridges.*,
              invited_by.display_name as invited_by_display_name,
              peer.id as peer_workspace_id,
              peer.name as peer_workspace_name,
              peer.owner_user_id as peer_owner_user_id,
              peer.onboarding_agent_id as peer_onboarding_agent_id,
              peer_owner.display_name as peer_owner_display_name
       from workspace_bridges
       join users invited_by on invited_by.id = workspace_bridges.invited_by_user_id
       join servers peer on peer.id = case
         when workspace_bridges.workspace_a_id = ? then workspace_bridges.workspace_b_id
         else workspace_bridges.workspace_a_id
       end
       join users peer_owner on peer_owner.id = peer.owner_user_id
       where workspace_bridges.workspace_a_id = ? or workspace_bridges.workspace_b_id = ?
       order by workspace_bridges.created_at desc`
    ).all(serverId, serverId, serverId) as any[];
  }

  function listWorkspaceBridges(serverId: string): WorkspaceBridgeRecord[] {
    return workspaceBridgeRows(serverId).map(rowWorkspaceBridge);
  }

  function listIncomingWorkspaceBridges(userId: string): WorkspaceBridgeRecord[] {
    const personal = ensurePersonalServerForUser(userId);
    return listWorkspaceBridges(personal.id).filter((bridge) => bridge.workspaceBId === personal.id && bridge.status === "pending");
  }

  function getWorkspaceBridgeForServer(bridgeId: string, serverId: string): WorkspaceBridgeRecord | null {
    return listWorkspaceBridges(serverId).find((bridge) => bridge.id === bridgeId) ?? null;
  }

  function createWorkspaceBridge(input: { sourceWorkspaceId: string; invitedByUserId: string; targetUserEmail: string }): WorkspaceBridgeRecord {
    const targetUser = findUser(input.targetUserEmail);
    if (!targetUser?.email) throw new Error("target_user_not_found");
    const targetServer = ensurePersonalServerForUser(targetUser.id);
    if (targetServer.id === input.sourceWorkspaceId) throw new Error("cannot_bridge_same_workspace");
    ensureDefaultCommunicationAgent(input.sourceWorkspaceId);
    ensureDefaultCommunicationAgent(targetServer.id);
    const createdAt = nowIso();
    const bridge = {
      id: id("bridge"),
      workspaceAId: input.sourceWorkspaceId,
      workspaceBId: targetServer.id,
      status: "pending",
      direction: "bidirectional",
      scope: "workspace_topology",
      permissionsJson: JSON.stringify(["chat", "task_delegation", "topology_read"]),
      invitedByUserId: input.invitedByUserId,
      approvedByAUserId: input.invitedByUserId,
      approvedByBUserId: null,
      createdAt
    };
    db.prepare(
      `insert into workspace_bridges (id, workspace_a_id, workspace_b_id, status, direction, scope, permissions_json, invited_by_user_id, approved_by_a_user_id, approved_by_b_user_id, created_at)
       values (@id, @workspaceAId, @workspaceBId, @status, @direction, @scope, @permissionsJson, @invitedByUserId, @approvedByAUserId, @approvedByBUserId, @createdAt)`
    ).run(bridge);
    return getWorkspaceBridgeForServer(bridge.id, input.sourceWorkspaceId)!;
  }

  function acceptWorkspaceBridge(bridgeId: string, userId: string): WorkspaceBridgeRecord | null {
    const personal = ensurePersonalServerForUser(userId);
    const bridge = getWorkspaceBridgeForServer(bridgeId, personal.id);
    if (!bridge || bridge.workspaceBId !== personal.id || bridge.status !== "pending") return null;
    const acceptedAt = nowIso();
    db.prepare(
      `update workspace_bridges
       set status = 'active', approved_by_b_user_id = ?, accepted_at = ?, last_activity_at = ?
       where id = ?`
    ).run(userId, acceptedAt, acceptedAt, bridge.id);
    // 两侧各自拥有独立的隐藏 Bridge 会话；它们不能复用任何 Human-TYR DM。
    getOrCreateWorkspaceBridgeDm(bridge.id, bridge.workspaceAId);
    getOrCreateWorkspaceBridgeDm(bridge.id, bridge.workspaceBId);
    return getWorkspaceBridgeForServer(bridge.id, personal.id);
  }

  function revokeWorkspaceBridge(bridgeId: string, userId: string): WorkspaceBridgeRecord | null {
    const ownerServers = listServersForUser(userId).filter((server) => server.role === "owner");
    for (const server of ownerServers) {
      const bridge = getWorkspaceBridgeForServer(bridgeId, server.id);
      if (!bridge) continue;
      const revokedAt = nowIso();
      db.prepare("update workspace_bridges set status = 'revoked', revoked_at = ?, last_activity_at = ? where id = ?").run(revokedAt, revokedAt, bridge.id);
      return getWorkspaceBridgeForServer(bridge.id, server.id);
    }
    return null;
  }

  function createCrossWorkspaceMessage(input: {
    bridgeId: string;
    conversationId?: string | null;
    clientRequestId?: string | null;
    retryOfMessageId?: string | null;
    responseKind?: CrossWorkspaceMessageResponseKind | null;
    originConversationKey?: string | null;
    originChannelId?: string | null;
    originConversationId?: string | null;
    originMessageId?: string | null;
    originSource?: CommunicationAgentManagementSource | null;
    originExternalRef?: string | null;
    awaitingAgentId?: string | null;
    sourceWorkspaceId: string;
    targetWorkspaceId: string;
    senderUserId?: string | null;
    senderUserName?: string | null;
    senderUserDisplayName?: string | null;
    senderUserAvatarUrl?: string | null;
    sourceCapabilityUserId?: string | null;
    targetCapabilityUserId?: string | null;
    originalSenderUserId?: string | null;
    traceId?: string | null;
    parentBridgeRequestId?: string | null;
    hopCount?: number;
    attachmentIds?: string[];
    sourceAgentNames?: string[];
    initiatedBy: CrossWorkspaceMessageInitiator;
    content: string;
    outcome?: CrossWorkspaceMessageOutcome;
    localMessageId?: string | null;
    peerMessageId?: string | null;
    replyToMessageId?: string | null;
  }): CrossWorkspaceMessageRecord {
    if (input.clientRequestId && input.conversationId) {
      const existing = getCrossWorkspaceMessageByClientRequest({
        bridgeId: input.bridgeId,
        conversationId: input.conversationId,
        sourceWorkspaceId: input.sourceWorkspaceId,
        clientRequestId: input.clientRequestId
      });
      // 浏览器重试同一请求时返回原记录，幂等键不能产生第二条 Bridge 消息。
      if (existing) return existing;
    }
    const sender = ensureDefaultCommunicationAgent(input.sourceWorkspaceId);
    const receiver = ensureDefaultCommunicationAgent(input.targetWorkspaceId);
    const createdAt = nowIso();
    const message = {
      id: id("xmsg"),
      bridgeId: input.bridgeId,
      conversationId: input.conversationId ?? null,
      // 仅 Human 请求携带此键，用于把乐观消息、HTTP 确认和实时事件合并为同一条记录。
      clientRequestId: input.clientRequestId ?? null,
      // Retry 保留原始尝试，同时使用新的客户端幂等键。
      retryOfMessageId: input.retryOfMessageId ?? null,
      // reply phase is explicit because a delegated peer can acknowledge before publishing its final result.
      responseKind: input.responseKind ?? null,
      terminalRequestId: null,
      originConversationKey: input.originConversationKey ?? null,
      originChannelId: input.originChannelId ?? null,
      originConversationId: input.originConversationId ?? null,
      originMessageId: input.originMessageId ?? null,
      originSource: input.originSource ?? null,
      originExternalRef: input.originExternalRef ?? null,
      awaitingAgentId: input.awaitingAgentId ?? null,
      continuationState: input.awaitingAgentId ? "registered" : null,
      originExternalDeliveredAt: null,
      sourceWorkspaceId: input.sourceWorkspaceId,
      targetWorkspaceId: input.targetWorkspaceId,
      senderUserId: input.senderUserId ?? null,
      senderUserName: input.senderUserName ?? null,
      senderUserDisplayName: input.senderUserDisplayName ?? null,
      senderUserAvatarUrl: input.senderUserAvatarUrl ?? null,
      sourceCapabilityUserId: input.sourceCapabilityUserId ?? null,
      targetCapabilityUserId: input.targetCapabilityUserId ?? null,
      originalSenderUserId: input.originalSenderUserId ?? input.senderUserId ?? null,
      traceId: input.traceId ?? null,
      parentBridgeRequestId: input.parentBridgeRequestId ?? null,
      hopCount: Math.max(0, Math.floor(input.hopCount ?? 0)),
      attachmentIds: [...new Set(input.attachmentIds ?? [])],
      sourceAgentNames: [...new Set((input.sourceAgentNames ?? []).map((name) => name.trim()).filter(Boolean))],
      senderCommsAgentId: sender.id,
      receiverCommsAgentId: receiver.id,
      initiatedBy: input.initiatedBy,
      content: input.content,
      outcome: input.outcome ?? "pending",
      localMessageId: input.localMessageId ?? null,
      peerMessageId: input.peerMessageId ?? null,
      replyToMessageId: input.replyToMessageId ?? null,
      createdAt,
      updatedAt: createdAt
    };
    db.prepare(
      `insert into cross_workspace_messages (
         id, bridge_id, conversation_id, client_request_id, retry_of_message_id, response_kind, terminal_request_id,
         origin_conversation_key, origin_channel_id, origin_conversation_id, origin_message_id,
         origin_source, origin_external_ref, origin_external_delivered_at, awaiting_agent_id, continuation_state,
         source_workspace_id, target_workspace_id,
         sender_user_id, sender_user_name, sender_user_display_name, sender_user_avatar_url,
         source_capability_user_id, target_capability_user_id, original_sender_user_id,
         trace_id, parent_bridge_request_id, hop_count, attachment_ids, source_agent_names,
         sender_comms_agent_id, receiver_comms_agent_id,
         initiated_by, content, outcome, local_message_id, peer_message_id, reply_to_message_id, created_at, updated_at
       )
       values (
         @id, @bridgeId, @conversationId, @clientRequestId, @retryOfMessageId, @responseKind, @terminalRequestId,
         @originConversationKey, @originChannelId, @originConversationId, @originMessageId,
         @originSource, @originExternalRef, @originExternalDeliveredAt, @awaitingAgentId, @continuationState,
         @sourceWorkspaceId, @targetWorkspaceId,
         @senderUserId, @senderUserName, @senderUserDisplayName, @senderUserAvatarUrl,
         @sourceCapabilityUserId, @targetCapabilityUserId, @originalSenderUserId,
         @traceId, @parentBridgeRequestId, @hopCount, @attachmentIds, @sourceAgentNames,
         @senderCommsAgentId, @receiverCommsAgentId,
         @initiatedBy, @content, @outcome, @localMessageId, @peerMessageId, @replyToMessageId, @createdAt, @updatedAt
       )`
    ).run({
      ...message,
      attachmentIds: stringify(message.attachmentIds as JsonValue[]),
      sourceAgentNames: stringify(message.sourceAgentNames as JsonValue[])
    });
    db.prepare("update workspace_bridges set last_activity_at = ? where id = ?").run(createdAt, input.bridgeId);
    return getCrossWorkspaceMessage(message.id)!;
  }

  function createCrossWorkspaceTerminalMessage(input: {
    bridgeId: string;
    conversationId: string;
    responseKind: Extract<CrossWorkspaceMessageResponseKind, "final" | "error">;
    sourceWorkspaceId: string;
    targetWorkspaceId: string;
    initiatedBy: "agent";
    content: string;
    outcome: CrossWorkspaceMessageOutcome;
    localMessageId?: string | null;
    peerMessageId?: string | null;
    replyToMessageId: string;
    attachmentIds?: string[];
    sourceAgentNames?: string[];
    reviewedChildTerminalId?: string;
  }): { message: CrossWorkspaceMessageRecord; created: boolean } {
    const sender = ensureDefaultCommunicationAgent(input.sourceWorkspaceId);
    const receiver = ensureDefaultCommunicationAgent(input.targetWorkspaceId);
    const request = getCrossWorkspaceMessage(input.replyToMessageId);
    if (request?.resolvedByTerminalId) throw new Error("workspace_bridge_request_resolved");
    if (input.reviewedChildTerminalId) {
      const childTerminal = getCrossWorkspaceMessage(input.reviewedChildTerminalId);
      const childRequest = childTerminal?.replyToMessageId
        ? getCrossWorkspaceMessage(childTerminal.replyToMessageId)
        : null;
      const reviewedMessage = input.localMessageId ? getMessage(input.localMessageId) : null;
      if (!request || !childTerminal || !childRequest ||
          !reviewedMessage || reviewedMessage.senderType !== "agent" || reviewedMessage.senderId !== sender.id ||
          reviewedMessage.channelId !== childRequest.originChannelId ||
          reviewedMessage.conversationId !== childRequest.originConversationId ||
          !["final", "error"].includes(childTerminal.responseKind ?? "") ||
          childRequest.parentBridgeRequestId !== request.id ||
          childRequest.sourceWorkspaceId !== request.targetWorkspaceId ||
          childTerminal.sourceWorkspaceId !== childRequest.targetWorkspaceId ||
          childTerminal.targetWorkspaceId !== request.targetWorkspaceId ||
          childTerminal.terminalRequestId !== childRequest.id ||
          childTerminal.traceId !== request.traceId ||
          input.sourceWorkspaceId !== request.targetWorkspaceId ||
          input.targetWorkspaceId !== request.sourceWorkspaceId) {
        throw new Error("workspace_bridge_reviewed_child_terminal_invalid");
      }
    }
    const createdAt = nowIso();
    const messageId = id("xmsg");
    // terminal_request_id 是数据库级终态占位，并发的成功与失败写入不能同时获胜。
    const inserted = db.prepare(
      `insert or ignore into cross_workspace_messages (
         id, bridge_id, conversation_id, client_request_id, retry_of_message_id, response_kind, terminal_request_id, reviewed_child_terminal_id,
         origin_conversation_key, origin_channel_id, origin_conversation_id, origin_message_id,
         origin_source, origin_external_ref, origin_external_delivered_at,
         source_workspace_id, target_workspace_id,
         sender_user_id, sender_user_name, sender_user_display_name, sender_user_avatar_url,
         source_capability_user_id, target_capability_user_id, original_sender_user_id,
         trace_id, parent_bridge_request_id, hop_count, attachment_ids, source_agent_names,
         sender_comms_agent_id, receiver_comms_agent_id,
         initiated_by, content, outcome, local_message_id, peer_message_id, reply_to_message_id, created_at, updated_at
       ) values (
         @id, @bridgeId, @conversationId, null, null, @responseKind, @terminalRequestId, @reviewedChildTerminalId,
         null, null, null, null,
         null, null, null,
         @sourceWorkspaceId, @targetWorkspaceId,
         @senderUserId, @senderUserName, @senderUserDisplayName, @senderUserAvatarUrl,
         @sourceCapabilityUserId, @targetCapabilityUserId, @originalSenderUserId,
         @traceId, @parentBridgeRequestId, @hopCount, @attachmentIds, @sourceAgentNames,
         @senderCommsAgentId, @receiverCommsAgentId,
         @initiatedBy, @content, @outcome, @localMessageId, @peerMessageId, @replyToMessageId, @createdAt, @updatedAt
       )`
    ).run({
      id: messageId,
      ...input,
      terminalRequestId: input.replyToMessageId,
      reviewedChildTerminalId: input.reviewedChildTerminalId ?? null,
      // Terminal 消息继承原请求的 Human 与 chaining provenance，回复不能改写调用者身份。
      senderUserId: request?.senderUserId ?? null,
      senderUserName: request?.senderUserName ?? null,
      senderUserDisplayName: request?.senderUserDisplayName ?? null,
      senderUserAvatarUrl: request?.senderUserAvatarUrl ?? null,
      sourceCapabilityUserId: request?.targetCapabilityUserId ?? null,
      targetCapabilityUserId: request?.sourceCapabilityUserId ?? null,
      originalSenderUserId: request?.originalSenderUserId ?? request?.senderUserId ?? null,
      traceId: request?.traceId ?? null,
      parentBridgeRequestId: request?.parentBridgeRequestId ?? null,
      hopCount: request?.hopCount ?? 0,
      attachmentIds: stringify([...new Set(input.attachmentIds ?? [])] as JsonValue[]),
      sourceAgentNames: stringify(
        [...new Set((input.sourceAgentNames ?? []).map((name) => name.trim()).filter(Boolean))] as JsonValue[]
      ),
      senderCommsAgentId: sender.id,
      receiverCommsAgentId: receiver.id,
      localMessageId: input.localMessageId ?? null,
      peerMessageId: input.peerMessageId ?? null,
      createdAt,
      updatedAt: createdAt
    });
    const record = inserted.changes > 0
      ? getCrossWorkspaceMessage(messageId)
      : (() => {
        const row = db.prepare("select * from cross_workspace_messages where terminal_request_id = ?").get(input.replyToMessageId);
        return row ? rowCrossWorkspaceMessage(row) : null;
      })();
    if (!record) throw new Error("workspace_bridge_terminal_claim_failed");
    if (inserted.changes > 0) {
      db.prepare("update workspace_bridges set last_activity_at = ? where id = ?").run(createdAt, input.bridgeId);
      // Once final/error wins, unscheduled peer questions cannot wake TYR after the completed result.
      db.prepare(`update cross_workspace_messages set continuation_state = 'completed', updated_at = ?
        where reply_to_message_id = ? and response_kind in ('question', 'action_request')
          and continuation_state = 'pending'`).run(createdAt, input.replyToMessageId);
    }
    return { message: record, created: inserted.changes > 0 };
  }

  function createCrossWorkspaceInteractionMessage(input: {
    requestId: string;
    eventId: string;
    kind: Extract<CrossWorkspaceMessageResponseKind, "progress" | "question" | "action_request" | "answer" | "instruction" | "continue">;
    content: string;
    localMessageId?: string | null;
  }): { message: CrossWorkspaceMessageRecord; created: boolean } | null {
    const request = getCrossWorkspaceMessage(input.requestId);
    if (!request?.conversationId || request.responseKind || request.resolvedByTerminalId || !input.content.trim() || !input.eventId.trim()) return null;
    const fromPeer = input.kind === "progress" || input.kind === "question" || input.kind === "action_request";
    const sourceWorkspaceId = fromPeer ? request.targetWorkspaceId : request.sourceWorkspaceId;
    const targetWorkspaceId = fromPeer ? request.sourceWorkspaceId : request.targetWorkspaceId;
    const sender = ensureDefaultCommunicationAgent(sourceWorkspaceId);
    const receiver = ensureDefaultCommunicationAgent(targetWorkspaceId);
    const createdAt = nowIso();
    const messageId = id("xmsg");
    // 原请求的唯一终态独立于中途事件；同一事件键只能写一次，晚到终态后的中途回调直接拒绝。
    const inserted = db.prepare(`insert or ignore into cross_workspace_messages (
      id, bridge_id, conversation_id, response_kind, interaction_event_id,
      source_workspace_id, target_workspace_id, sender_user_id, sender_user_name, sender_user_display_name,
      source_capability_user_id, target_capability_user_id, original_sender_user_id, trace_id,
      parent_bridge_request_id, hop_count, attachment_ids, source_agent_names,
      sender_comms_agent_id, receiver_comms_agent_id, initiated_by, content, outcome,
      local_message_id, reply_to_message_id, created_at, updated_at
    ) select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, 'agent', ?, ?, ?, ?, ?, ?
      where not exists (select 1 from cross_workspace_messages where terminal_request_id = ?)`)
      .run(messageId, request.bridgeId, request.conversationId, input.kind, input.eventId,
        sourceWorkspaceId, targetWorkspaceId, request.senderUserId, request.senderUserName, request.senderUserDisplayName,
        fromPeer ? request.targetCapabilityUserId : request.sourceCapabilityUserId,
        fromPeer ? request.sourceCapabilityUserId : request.targetCapabilityUserId,
        request.originalSenderUserId, request.traceId, request.parentBridgeRequestId, request.hopCount,
        sender.id, receiver.id, input.content.trim(), fromPeer ? "delivered" : "pending",
        input.localMessageId ?? null, request.id, createdAt, createdAt, request.id);
    const existingRow = inserted.changes > 0 ? null
      : db.prepare("select * from cross_workspace_messages where reply_to_message_id = ? and interaction_event_id = ?")
          .get(request.id, input.eventId);
    const message = inserted.changes > 0 ? getCrossWorkspaceMessage(messageId)
      : existingRow ? rowCrossWorkspaceMessage(existingRow) : null;
    const storedContent = message
      ? (db.prepare("select content from cross_workspace_messages where id = ?").get(message.id) as { content: string } | undefined)?.content
      : null;
    if (!message || message.responseKind !== input.kind || storedContent !== input.content.trim()) return null;
    return { message, created: inserted.changes > 0 };
  }

  function getCrossWorkspaceMessage(messageId: string): CrossWorkspaceMessageRecord | null {
    const row = db.prepare("select * from cross_workspace_messages where id = ?").get(messageId);
    return row ? rowCrossWorkspaceMessage(row) : null;
  }

  function hasReviewedDownstreamResult(messageId: string): boolean {
    const row = db.prepare("select reviewed_child_terminal_id as terminalId from cross_workspace_messages where id = ?")
      .get(messageId) as { terminalId: string | null } | undefined;
    return Boolean(row?.terminalId);
  }

  function listCrossWorkspaceRequestsForSourceMessage(sourceMessageId: string): CrossWorkspaceMessageRecord[] {
    return db.prepare("select * from cross_workspace_messages where origin_message_id = ? and response_kind is null order by created_at, id")
      .all(sourceMessageId).map(rowCrossWorkspaceMessage);
  }

  function armCrossWorkspaceContinuationsForSourceMessage(sourceMessageId: string): string[] {
    // 初始 TYR 回执发布后才允许续跑，防止快 Bridge 结果与初始 Tool Loop 并发执行。
    db.prepare("update cross_workspace_messages set continuation_state = 'pending', updated_at = ? where origin_message_id = ? and continuation_state = 'registered'")
      .run(nowIso(), sourceMessageId);
    return (db.prepare("select id from cross_workspace_messages where origin_message_id = ? and continuation_state = 'pending'")
      .all(sourceMessageId) as Array<{ id: string }>).map((row) => row.id);
  }

  function recoverReadyCrossWorkspaceContinuations(): string[] {
    // 重启后旧 Tool Loop 已不存在；未 arm 的等待可安全进入 pending。
    db.prepare("update cross_workspace_messages set continuation_state = 'pending', updated_at = ? where continuation_state = 'registered'")
      .run(nowIso());
    // 已 claim 的续跑可能执行过副作用；恢复时只标记中断，不自动重放。
    db.prepare("update cross_workspace_messages set continuation_state = 'interrupted', updated_at = ? where continuation_state = 'running'")
      .run(nowIso());
    return (db.prepare(`select request.id from cross_workspace_messages request
      where request.continuation_state = 'pending' and exists (
        select 1 from cross_workspace_messages terminal
        where terminal.terminal_request_id = request.id and terminal.origin_message_id is not null
      ) order by request.created_at, request.id`).all() as Array<{ id: string }>).map((row) => row.id);
  }

  function claimCrossWorkspaceContinuation(requestId: string): { request: CrossWorkspaceMessageRecord; terminal: CrossWorkspaceMessageRecord } | null {
    // 终态必须已回写原 DM；同一请求只有一个进程能把 pending 原子变为 running。
    const claimed = db.prepare(`update cross_workspace_messages set continuation_state = 'running', updated_at = ?
      where id = ? and continuation_state = 'pending' and exists (
        select 1 from cross_workspace_messages terminal
        where terminal.terminal_request_id = cross_workspace_messages.id
          and terminal.response_kind in ('final', 'error') and terminal.origin_message_id is not null
      )`).run(nowIso(), requestId);
    if (claimed.changes === 0) return null;
    const request = getCrossWorkspaceMessage(requestId)!;
    const row = db.prepare("select * from cross_workspace_messages where terminal_request_id = ?").get(requestId);
    return { request, terminal: rowCrossWorkspaceMessage(row) };
  }

  function completeCrossWorkspaceContinuation(requestId: string, replyMessageId: string | null): void {
    db.prepare("update cross_workspace_messages set continuation_state = 'completed', continuation_reply_message_id = ?, updated_at = ? where id = ? and continuation_state = 'running'")
      .run(replyMessageId, nowIso(), requestId);
  }

  function countCrossWorkspaceContinuationsForSourceMessage(sourceMessageId: string): number {
    return (db.prepare("select count(*) as count from cross_workspace_messages where origin_message_id = ? and awaiting_agent_id is not null")
      .get(sourceMessageId) as { count: number }).count;
  }

  function getCrossWorkspaceMessageByClientRequest(input: {
    bridgeId: string;
    conversationId: string;
    sourceWorkspaceId: string;
    clientRequestId: string;
  }): CrossWorkspaceMessageRecord | null {
    const row = db.prepare(
      `select * from cross_workspace_messages
       where bridge_id = ? and conversation_id = ? and source_workspace_id = ? and client_request_id = ?`
    ).get(input.bridgeId, input.conversationId, input.sourceWorkspaceId, input.clientRequestId);
    return row ? rowCrossWorkspaceMessage(row) : null;
  }

  function updateCrossWorkspaceMessage(messageId: string, input: {
    outcome?: CrossWorkspaceMessageOutcome;
    localMessageId?: string | null;
    peerMessageId?: string | null;
    originMessageId?: string | null;
    originExternalDeliveredAt?: string | null;
  }): CrossWorkspaceMessageRecord | null {
    const current = getCrossWorkspaceMessage(messageId);
    if (!current) return null;
    // 异步 worker 只能推进状态和补全关联消息，不能改写请求归属、方向或正文。
    db.prepare(
      `update cross_workspace_messages
       set outcome = ?, local_message_id = ?, peer_message_id = ?, origin_message_id = ?, origin_external_delivered_at = ?, updated_at = ?
       where id = ?`
    ).run(
      input.outcome ?? current.outcome,
      input.localMessageId === undefined ? current.localMessageId : input.localMessageId,
      input.peerMessageId === undefined ? current.peerMessageId : input.peerMessageId,
      input.originMessageId === undefined ? current.originMessageId : input.originMessageId,
      input.originExternalDeliveredAt === undefined ? current.originExternalDeliveredAt : input.originExternalDeliveredAt,
      nowIso(),
      messageId
    );
    return getCrossWorkspaceMessage(messageId);
  }

  function listCrossWorkspaceMessages(bridgeId: string, options: { conversationId?: string } = {}): CrossWorkspaceMessageRecord[] {
    // 历史重复终态继续留表审计，但产品读模型只展示已占位的唯一终态。
    const visibleTerminal = `(
      response_kind not in ('final', 'error')
      or reply_to_message_id is null
      or terminal_request_id is not null
      or not exists (
        select 1 from cross_workspace_messages claimed
        where claimed.terminal_request_id = cross_workspace_messages.reply_to_message_id
      )
    )`;
    if (options.conversationId) {
      return db.prepare(`select * from cross_workspace_messages where bridge_id = ? and conversation_id = ? and ${visibleTerminal} order by created_at asc`)
        .all(bridgeId, options.conversationId)
        .map(rowCrossWorkspaceMessage);
    }
    return db.prepare(`select * from cross_workspace_messages where bridge_id = ? and ${visibleTerminal} order by created_at asc`).all(bridgeId).map(rowCrossWorkspaceMessage);
  }

  function listCrossWorkspaceChildRequests(parentRequestId: string): CrossWorkspaceMessageRecord[] {
    return db.prepare(
      `select * from cross_workspace_messages
       where parent_bridge_request_id = ? and initiated_by = 'human' and reply_to_message_id is null
       order by created_at asc`
    ).all(parentRequestId).map(rowCrossWorkspaceMessage);
  }

  function listCrossWorkspaceMessagesPage(bridgeId: string, options: { limit?: number; beforeCreatedAt?: string | null; conversationId?: string } = {}): WorkspaceBridgeMessagesPayload {
    const requestedLimit = typeof options.limit === "number" && Number.isFinite(options.limit) ? Math.floor(options.limit) : 30;
    // Bridge Details loads older history upward; keep the page bounded so workspace history cannot bloat startup or modal payloads.
    const limit = Math.max(1, Math.min(requestedLimit, 100));
    const beforeCreatedAt = typeof options.beforeCreatedAt === "string" && options.beforeCreatedAt.trim() ? options.beforeCreatedAt.trim() : null;
    const where = [
      "bridge_id = ?",
      `(response_kind not in ('final', 'error') or reply_to_message_id is null or terminal_request_id is not null or not exists (
        select 1 from cross_workspace_messages claimed
        where claimed.terminal_request_id = cross_workspace_messages.reply_to_message_id
      ))`
    ];
    const params: unknown[] = [bridgeId];
    if (options.conversationId) {
      where.push("conversation_id = ?");
      params.push(options.conversationId);
    }
    if (beforeCreatedAt) {
      where.push("created_at < ?");
      params.push(beforeCreatedAt);
    }
    const rows = db.prepare(
      `select * from cross_workspace_messages
       where ${where.join(" and ")}
       order by created_at desc, id desc
       limit ?`
    ).all(...params, limit + 1).map(rowCrossWorkspaceMessage);
    const messages = rows.slice(0, limit).reverse();
    return {
      messages,
      pageInfo: {
        limit,
        hasMoreBefore: rows.length > limit,
        oldestCreatedAt: messages[0]?.createdAt ?? null,
        newestCreatedAt: messages.at(-1)?.createdAt ?? null
      }
    };
  }

  function workspaceBridgeTopology(serverId: string): {
    peerWorkspaceTopologies: WorkspaceBridgeTopologySnapshot[];
    workspaceBridgeTopologyEdges: WorkspaceBridgeTopologyEdge[];
  } {
    const snapshots: WorkspaceBridgeTopologySnapshot[] = [];
    const edges: WorkspaceBridgeTopologyEdge[] = [];
    for (const bridge of listWorkspaceBridges(serverId)) {
      if (bridge.status !== "active" || !bridge.peerWorkspace) continue;
      const peerId = bridge.workspaceAId === serverId ? bridge.workspaceBId : bridge.workspaceAId;
      const bridgePath = [bridge.id];
      // 每条 Bridge 的关系只属于它的两端；对端的其他 Bridge 不因图连通而进入当前快照。
      const bridgeAccess = {
        fullAccess: true as const,
        sourceWorkspaceId: serverId,
        targetWorkspaceId: peerId,
        capabilityUserId: bridge.peerWorkspace.ownerUserId,
        bridgePath,
        distance: 1
      };
      const peerAgents = listAgents(peerId).map((agent) => ({
        ...agent,
        authToken: "",
        access: { shared: true, scopes: ["view"], bridge: bridgeAccess },
        bridgeAccess
      }));
      const assistant = ensureDefaultCommunicationAgent(peerId);
      edges.push({
        bridgeId: bridge.id,
        bridge,
        workspaceAId: bridge.workspaceAId,
        workspaceBId: bridge.workspaceBId
      });
      snapshots.push({
        bridgeId: bridge.id,
        bridge,
        parentWorkspaceId: serverId,
        distance: 1,
        bridgePath,
        workspace: bridge.peerWorkspace,
        assistant: assistant ? {
          ...assistant,
          authToken: "",
          access: { shared: true, scopes: ["view"], bridge: bridgeAccess },
          bridgeAccess
        } : null,
        machines: listMachines(peerId).map((machine) => ({
          ...machine,
          apiKey: "",
          connectorToken: undefined,
          access: { shared: true, scopes: ["view"], bridge: bridgeAccess },
          bridgeAccess,
          latestDaemonVersion: LATEST_DAEMON_VERSION,
          runtimes: listRuntimeReports(machine.id),
          agents: peerAgents.filter((agent) => agent.machineId === machine.id)
        })),
        agents: peerAgents,
        devices: listDevices(peerId)
          .filter((device) => !isLegacyMockDevice(device))
          .map((device) => ({ ...device, deviceToken: undefined, bridgeAccess }))
      });
    }
    return {
      peerWorkspaceTopologies: snapshots,
      workspaceBridgeTopologyEdges: edges
    };
  }

  function listServerMembers(serverId = "local"): Array<UserRecord & { role: ServerMemberRole; joinedAt: string; gravatarHash?: string | null }> {
    const rows = db.prepare(
      `select users.*, server_members.role as member_role, server_members.joined_at as member_joined_at
       from server_members
       join users on users.id = server_members.user_id
       where server_members.server_id = ?
       order by server_members.joined_at`
    ).all(serverId) as any[];
    return rows.map((row) => ({
      ...rowUser(row),
      role: serverMemberRole(row.member_role),
      joinedAt: row.member_joined_at,
      gravatarHash: null
    }));
  }

  function removeServerMember(userId: string, serverId = "local"): { ok: boolean; error?: string } {
    const row = db.prepare(
      `select user_id, role from server_members
       where server_id = ? and (user_id = ? or user_id like ?)`
    ).get(serverId, userId, `${userId}%`) as { user_id: string; role: string } | undefined;
    if (!row) return { ok: false, error: "member_not_found" };
    if (row.role === "owner") return { ok: false, error: "owner_cannot_be_removed" };
    db.prepare("delete from server_members where server_id = ? and user_id = ?").run(serverId, row.user_id);
    db.prepare("delete from user_server_preferences where user_id = ? and active_server_id = ?").run(row.user_id, serverId);
    return { ok: true };
  }

  function serverUsage(serverId = "local"): { agents: number; machines: number } {
    return {
      agents: db.prepare("select count(*) from agents where server_id = ? and deleted_at is null").pluck().get(serverId) as number,
      machines: db.prepare("select count(*) from machines where server_id = ? and deleted_at is null").pluck().get(serverId) as number
    };
  }

  function getServerSidebarOrder(serverId: string): SidebarOrderSettings {
    const row = db.prepare("select sidebar_order_json from server_settings where server_id = ?").get(serverId) as { sidebar_order_json?: string | null } | undefined;
    // 侧边栏偏好是完整 UI 配置对象，读取时补全新增字段，避免前端处理稀疏 patch。
    return defaultSidebarOrderSettings(parseJson<Partial<SidebarOrderSettings>>(row?.sidebar_order_json, {}));
  }

  function setServerSidebarOrder(serverId: string, input: Partial<SidebarOrderSettings>): SidebarOrderSettings {
    // 当前 Web 会按操作提交局部字段，保存时必须合并已有偏好，避免一次置顶清空频道排序或隐藏 DM。
    const sidebarOrder = defaultSidebarOrderSettings({ ...getServerSidebarOrder(serverId), ...input });
    db.prepare(
      `insert into server_settings (server_id, sidebar_order_json, updated_at)
       values (?, ?, ?)
       on conflict(server_id) do update set
         sidebar_order_json = excluded.sidebar_order_json,
         updated_at = excluded.updated_at`
    ).run(serverId, JSON.stringify(sidebarOrder), nowIso());
    return sidebarOrder;
  }

  function getWorkspaceRoutingInstructions(serverId: string): WorkspaceRoutingInstructionsRecord {
    const row = db.prepare(
      `select tyr_routing_instructions, tyr_routing_revision,
              tyr_routing_updated_by_user_id, tyr_routing_updated_at
       from server_settings where server_id = ?`
    ).get(serverId) as {
      tyr_routing_instructions?: string | null;
      tyr_routing_revision?: number | null;
      tyr_routing_updated_by_user_id?: string | null;
      tyr_routing_updated_at?: string | null;
    } | undefined;
    return {
      serverId,
      instructions: row?.tyr_routing_instructions ?? "",
      revision: row?.tyr_routing_revision ?? 0,
      updatedByUserId: row?.tyr_routing_updated_by_user_id ?? null,
      updatedAt: row?.tyr_routing_updated_at ?? null
    };
  }

  function setWorkspaceRoutingInstructions(serverId: string, instructions: string, updater: WorkspaceRoutingInstructionsUpdater): WorkspaceRoutingInstructionsRecord | null {
    if (!db.prepare("select 1 from servers where id = ?").get(serverId)) return null;
    const actor = typeof updater === "string"
      ? { actorType: "user" as const, actorId: updater }
      : updater;
    const save = db.transaction((): WorkspaceRoutingInstructionsRecord => {
      const current = getWorkspaceRoutingInstructions(serverId);
      // Operator 写入使用显式 CAS，防止页面停留期间覆盖 Owner 或另一位 Operator 的更新。
      if (actor.expectedRevision !== undefined && actor.expectedRevision !== current.revision) {
        throw new WorkspaceRoutingInstructionsRevisionConflictError(current);
      }
      // 内容未变更时不生成虚假版本，便于审计与故障排查。
      if (current.instructions === instructions) return current;
      const updatedAt = nowIso();
      const revision = current.revision + 1;
      db.prepare(
        `insert into server_settings (
           server_id, sidebar_order_json, updated_at,
           tyr_routing_instructions, tyr_routing_revision,
           tyr_routing_updated_by_user_id, tyr_routing_updated_by_actor_type,
           tyr_routing_updated_by_actor_id, tyr_routing_updated_at
         ) values (?, null, ?, ?, ?, ?, ?, ?, ?)
         on conflict(server_id) do update set
           tyr_routing_instructions = excluded.tyr_routing_instructions,
           tyr_routing_revision = excluded.tyr_routing_revision,
           tyr_routing_updated_by_user_id = excluded.tyr_routing_updated_by_user_id,
           tyr_routing_updated_by_actor_type = excluded.tyr_routing_updated_by_actor_type,
           tyr_routing_updated_by_actor_id = excluded.tyr_routing_updated_by_actor_id,
           tyr_routing_updated_at = excluded.tyr_routing_updated_at,
           updated_at = excluded.updated_at`
      ).run(
        serverId,
        updatedAt,
        instructions,
        revision,
        actor.actorType === "user" ? actor.actorId : null,
        actor.actorType,
        actor.actorId,
        updatedAt
      );
      // 审计只记录版本和长度，避免在日志中复制 Workspace 的私有路由规则。
      recordAuditEvent({
        kind: "workspace_routing_instructions_updated",
        actorType: actor.actorType,
        actorId: actor.actorId,
        resourceType: "server",
        resourceId: serverId,
        serverId,
        metadata: {
          revision,
          characterCount: instructions.length,
          ...(actor.auditMetadata ?? {})
        }
      });
      return getWorkspaceRoutingInstructions(serverId);
    });
    return save();
  }

  function getMachine(machineId: string): MachineRecord | null {
    const row = db.prepare("select * from machines where id = ?").get(machineId);
    return row ? rowMachine(row) : null;
  }

  function listMachines(serverId?: string, options: { includeDeleted?: boolean } = {}): MachineRecord[] {
    const deletedClause = options.includeDeleted ? "" : " and deleted_at is null";
    if (serverId) return db.prepare(`select * from machines where server_id = ?${deletedClause} order by created_at`).all(serverId).map(rowMachine);
    return db.prepare(`select * from machines where 1 = 1${deletedClause} order by created_at`).all().map(rowMachine);
  }

  function listRuntimeReports(machineId: string): RuntimeReport[] {
    return db.prepare("select * from machine_runtime_reports where machine_id = ? order by display_name").all(machineId).map(rowRuntime);
  }

  function listAgents(serverId?: string, options: { includeDeleted?: boolean } = {}): AgentRecord[] {
    const deletedClause = options.includeDeleted ? "" : " and deleted_at is null";
    if (serverId) {
      return db.prepare(
        `select *
         from agents
         where server_id = ?
         ${deletedClause}
         order by created_at`
      ).all(serverId).map(rowAgent);
    }
    return db.prepare(
      `select *
       from agents
       where 1 = 1${deletedClause}
       order by created_at`
    ).all().map(rowAgent);
  }

  function getResourceOwnerUserId(resourceType: ResourceType, resourceId: string): string | null {
    if (resourceType === "machine") return getMachine(resourceId)?.ownerUserId ?? null;
    return getAgent(resourceId)?.ownerUserId ?? null;
  }

  function resourceOwnerUserId(resourceType: ResourceType, resourceId: string): string | null {
    return getResourceOwnerUserId(resourceType, resourceId);
  }

  function listResourceGrants(filter: ResourceGrantFilter = {}): ResourceGrantRecord[] {
    // 历史 channel grant 仅在数据库中冷保留，不再进入任何公开列表或权限计算。
    const clauses: string[] = ["resource_type in ('machine', 'agent')"];
    const params: Array<string> = [];
    if (filter.resourceType) {
      clauses.push("resource_type = ?");
      params.push(filter.resourceType);
    }
    if (filter.resourceId) {
      clauses.push("resource_id = ?");
      params.push(filter.resourceId);
    }
    if (filter.granteeUserId) {
      clauses.push("grantee_user_id = ?");
      params.push(filter.granteeUserId);
    }
    if (filter.activeOnly) clauses.push("revoked_at is null");
    const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
    return db.prepare(`select * from resource_grants ${where} order by created_at`).all(...params).map(rowResourceGrant);
  }

  function resourceGrantScopesForUser(userId: string, resourceType: ResourceType, resourceId: string): ResourceGrantScope[] {
    const requested = new Set<ResourceGrantScope>();
    for (const grant of listResourceGrants({ granteeUserId: userId, resourceType, resourceId, activeOnly: true })) {
      for (const scope of grant.scopes) requested.add(scope);
    }
    return RESOURCE_GRANT_SCOPES.filter((scope) => requested.has(scope));
  }

  function canUserAccessResource(userId: string, resourceType: ResourceType, resourceId: string, scope: ResourceGrantScope): boolean {
    const ownerUserId = getResourceOwnerUserId(resourceType, resourceId);
    if (ownerUserId === userId) return true;
    return resourceGrantScopesForUser(userId, resourceType, resourceId).includes(scope);
  }

  function createDevicePairingToken(input: CreateDevicePairingTokenInput): DevicePairingTokenRecord {
    const createdAt = nowIso();
    const expiresAt = input.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const record = {
      id: id("device_pair"),
      serverId: input.serverId,
      createdByUserId: input.createdByUserId,
      displayName: input.displayName,
      pinnedAgentId: input.pinnedAgentId,
      pairingToken: token("tyr_pair"),
      expiresAt,
      consumedAt: undefined,
      createdAt
    };
    db.prepare(
      `insert into device_pairing_tokens
        (id, server_id, created_by_user_id, display_name, pinned_agent_id, pairing_token, expires_at, consumed_at, created_at)
       values (@id, @serverId, @createdByUserId, @displayName, @pinnedAgentId, @pairingToken, @expiresAt, null, @createdAt)`
    ).run(record);
    return record;
  }

  function connectDeviceWithPairingToken(input: ConnectDeviceWithPairingTokenInput): { device: DeviceRecord; deviceToken: string; pairing: DevicePairingTokenRecord } | null {
    const pairingRow = db.prepare(
      `select * from device_pairing_tokens
       where pairing_token = ? and consumed_at is null and expires_at > ?`
    ).get(input.pairingToken, nowIso()) as any;
    if (!pairingRow) return null;
    const createdAt = nowIso();
    const deviceToken = token("tyr_device");
    const capabilities = normalizeDeviceCapabilities(input.capabilities);
    const device = {
      id: id("device"),
      serverId: pairingRow.server_id,
      ownerUserId: pairingRow.created_by_user_id,
      // Web Add Device owns the customer-visible name; app defaults such as "TYR Android App" are only a fallback.
      displayName: pairingRow.display_name || input.displayName || "Mobile Device",
      deviceKind: input.deviceKind,
      platform: input.platform,
      appVersion: input.appVersion,
      status: "online",
      capabilities,
      capabilityDescriptors: normalizeDeviceCapabilityDescriptors(capabilities, input.capabilityDescriptors),
      permissionStates: input.permissionStates,
      deviceToken,
      createdAt,
      lastSeenAt: createdAt,
      deletedAt: undefined
    } satisfies DeviceRecord;
    const tx = db.transaction(() => {
      db.prepare(
        `insert into devices
          (id, server_id, owner_user_id, display_name, device_kind, platform, app_version, status, capabilities, capability_descriptors, permission_states, device_token, created_at, last_seen_at)
         values (@id, @serverId, @ownerUserId, @displayName, @deviceKind, @platform, @appVersion, @status, @capabilities, @capabilityDescriptors, @permissionStates, @deviceToken, @createdAt, @lastSeenAt)`
      ).run({
        ...device,
        capabilities: stringify(device.capabilities as JsonValue[]),
        capabilityDescriptors: stringify(device.capabilityDescriptors as unknown as JsonValue[]),
        permissionStates: stringify(device.permissionStates as JsonValue)
      });
      db.prepare("update device_pairing_tokens set consumed_at = ? where id = ?").run(createdAt, pairingRow.id);
    });
    tx();
    recordAuditEvent({
      kind: "device_connected",
      actorType: "system",
      resourceType: "device",
      resourceId: device.id,
      serverId: device.serverId,
      metadata: auditMetadata({
        deviceId: device.id,
        displayName: device.displayName,
        platform: device.platform,
        appVersion: device.appVersion
      })
    });
    return { device, deviceToken, pairing: rowDevicePairingToken({ ...pairingRow, consumed_at: createdAt }) };
  }

  function getDevice(deviceId: string): DeviceRecord | null {
    const row = db.prepare("select * from devices where (id = ? or id like ?) and deleted_at is null").get(deviceId, `${deviceId}%`);
    return row ? rowDevice(row) : null;
  }

  function getDeviceByToken(deviceToken: string): DeviceRecord | null {
    const row = db.prepare("select * from devices where device_token = ? and deleted_at is null").get(deviceToken);
    return row ? rowDevice(row) : null;
  }

  function listDevices(serverId?: string): DeviceRecord[] {
    if (serverId) return db.prepare("select * from devices where server_id = ? and deleted_at is null order by created_at").all(serverId).map(rowDevice);
    return db.prepare("select * from devices where deleted_at is null order by created_at").all().map(rowDevice);
  }

  function listVisibleDevices(userId: string, options: { limit?: number; cursor?: string } = {}): DeviceListPayload {
    const page = paginateByCreatedAt(workspaceScope(userId).devices, options.limit, options.cursor, 50, 100);
    return { devices: page.items, pageInfo: page.pageInfo };
  }

  function deleteDevice(deviceId: string, deletedByUserId?: string): DeviceRecord | null {
    const row = db.prepare("select * from devices where (id = ? or id like ?) and deleted_at is null").get(deviceId, `${deviceId}%`) as any;
    if (!row) return null;
    const device = rowDevice(row);
    if (deletedByUserId && device.ownerUserId !== deletedByUserId) return null;
    const deletedAt = nowIso();
    const activeBinding = getMobileAppBindingByDevice(device.id);
    const tx = db.transaction(() => {
      db.prepare("update devices set status = 'offline', deleted_at = ? where id = ?").run(deletedAt, device.id);
      if (activeBinding) {
        db.prepare(
          `update mobile_app_bindings
           set status = 'revoked', revoked_at = ?, updated_at = ?
           where id = ?`
        ).run(deletedAt, deletedAt, activeBinding.id);
      }
    });
    tx();
    recordAuditEvent({
      kind: "device_deleted",
      actorType: deletedByUserId ? "user" : "system",
      actorId: deletedByUserId ?? null,
      resourceType: "device",
      resourceId: device.id,
      serverId: device.serverId,
      metadata: auditMetadata({ deviceId: device.id, displayName: device.displayName })
    });
    if (activeBinding) {
      recordAuditEvent({
        kind: "mobile_app_unbound",
        actorType: deletedByUserId ? "user" : "system",
        actorId: deletedByUserId ?? null,
        resourceType: "mobile_app_binding",
        resourceId: activeBinding.id,
        serverId: activeBinding.serverId,
        metadata: auditMetadata({ deviceId: device.id, reason: "device_deleted" })
      });
    }
    const deletedRow = db.prepare("select * from devices where id = ?").get(device.id) as any;
    return deletedRow ? rowDevice(deletedRow) : null;
  }

  function createOrUpdateMobileAppBinding(input: CreateOrUpdateMobileAppBindingInput): MobileAppBindingRecord | null {
    const device = getDevice(input.deviceId);
    // MobileAppBinding 只表示真实手机 APP 客户端会话；IoT 等设备不能伪装成 APP。
    if (!device || device.deviceKind !== "mobile" || device.serverId !== input.serverId || device.ownerUserId !== input.userId) return null;
    const existing = db.prepare("select * from mobile_app_bindings where device_id = ? order by created_at desc limit 1").get(device.id) as any;
    const updatedAt = nowIso();
    if (existing) {
      db.prepare(
        `update mobile_app_bindings
         set server_id = ?, user_id = ?, status = 'active', revoked_at = null, updated_at = ?
         where id = ?`
      ).run(input.serverId, input.userId, updatedAt, existing.id);
      return getMobileAppBinding(existing.id);
    }
    const binding: MobileAppBindingRecord = {
      id: id("mobile_app_binding"),
      serverId: input.serverId,
      userId: input.userId,
      deviceId: device.id,
      status: "active",
      createdAt: updatedAt,
      updatedAt
    };
    db.prepare(
      `insert into mobile_app_bindings
        (id, server_id, user_id, device_id, pinned_agent_id, pinned_channel_id, status, created_at, updated_at, revoked_at, last_seen_at)
       values (@id, @serverId, @userId, @deviceId, null, null, @status, @createdAt, @updatedAt, null, null)`
    ).run(binding);
    return getMobileAppBinding(binding.id);
  }

  function getMobileAppBinding(bindingId: string): MobileAppBindingRecord | null {
    const row = db.prepare("select * from mobile_app_bindings where id = ? or id like ?").get(bindingId, `${bindingId}%`);
    return row ? rowMobileAppBinding(row) : null;
  }

  function getMobileAppBindingByDevice(deviceId: string): MobileAppBindingRecord | null {
    const row = db.prepare(
      `select * from mobile_app_bindings
       where device_id = ? and status = 'active' and revoked_at is null
       order by created_at desc limit 1`
    ).get(deviceId);
    return row ? rowMobileAppBinding(row) : null;
  }

  function setMobileAppPinnedAgent(bindingId: string, agentId: string, channelId: string): MobileAppBindingRecord | null {
    const binding = getMobileAppBinding(bindingId);
    const agent = getAgent(agentId);
    const machine = agent?.machineId ? getMachine(agent.machineId) : null;
    const channelRow = db.prepare("select * from channels where id = ?").get(channelId) as any;
    const channel = channelRow ? rowChannel(channelRow) : null;
    if (!binding || binding.status !== "active" || binding.revokedAt || !agent || isCommunicationAgent(agent) || !machine || !channel) return null;
    // Pinned Agent 是 APP 内默认聊天对象，必须严格落在同一个 server 的人类-Agent DM 中。
    const sameServer = binding.serverId === (machine.serverId ?? "local") && binding.serverId === (channel.serverId ?? "local");
    const dmPeerAgent = channel.type === "dm" ? dmPeerAgentForChannel(channel) : null;
    if (!sameServer || channel.type !== "dm" || dmPeerAgent?.id !== agent.id) return null;
    if (!canAgentAccessChannel(agent.id, channel.id) || !canUserAccessChannel(binding.userId, channel.id)) return null;
    db.prepare(
      `update mobile_app_bindings
       set pinned_agent_id = ?, pinned_channel_id = ?, updated_at = ?
       where id = ?`
    ).run(agent.id, channel.id, nowIso(), binding.id);
    return getMobileAppBinding(binding.id);
  }

  function revokeMobileAppBinding(bindingId: string): MobileAppBindingRecord | null {
    const binding = getMobileAppBinding(bindingId);
    if (!binding) return null;
    const revokedAt = binding.revokedAt ?? nowIso();
    db.prepare(
      `update mobile_app_bindings
       set status = 'revoked', revoked_at = ?, updated_at = ?
       where id = ?`
    ).run(revokedAt, nowIso(), binding.id);
    return getMobileAppBinding(binding.id);
  }

  function touchMobileAppBinding(bindingId: string): MobileAppBindingRecord | null {
    const binding = getMobileAppBinding(bindingId);
    // 心跳只刷新 active APP 绑定；撤销后的客户端不能靠重连心跳恢复权限。
    if (!binding || binding.status !== "active" || binding.revokedAt) return null;
    const lastSeenAt = nowIso();
    db.prepare("update mobile_app_bindings set last_seen_at = ?, updated_at = ? where id = ?").run(lastSeenAt, lastSeenAt, binding.id);
    return getMobileAppBinding(binding.id);
  }

  function createTelegramBindingCode(input: CreateTelegramBindingCodeInput): TelegramBindingCodeCreated {
    if (!getUser(input.userId) || !isServerMemberInternal(input.userId, input.serverId)) throw new Error("telegram_binding_user_not_member");
    const createdAt = nowIso();
    const code = telegramBindingToken();
    const record: TelegramBindingCodeRecord = {
      id: id("telegram_bind"),
      userId: input.userId,
      serverId: input.serverId,
      status: "pending",
      expiresAt: input.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      createdAt
    };
    db.prepare(
      `insert into telegram_binding_codes
        (id, user_id, server_id, binding_code_hash, status, expires_at, consumed_at, created_at)
       values (@id, @userId, @serverId, @bindingCodeHash, @status, @expiresAt, null, @createdAt)`
    ).run({ ...record, bindingCodeHash: bearerTokenHash(code) });
    return { ...record, code };
  }

  function getTelegramBindingCode(code: string): TelegramBindingCodeRecord | null {
    const normalized = code.trim();
    if (!normalized) return null;
    const row = db.prepare("select * from telegram_binding_codes where binding_code_hash = ?").get(bearerTokenHash(normalized)) as any;
    return row ? materializeTelegramBindingCode(row) : null;
  }

  function materializeTelegramBindingCode(row: any): TelegramBindingCodeRecord {
    if (row.status === "pending" && row.expires_at <= nowIso()) {
      db.prepare("update telegram_binding_codes set status = 'expired' where id = ? and status = 'pending'").run(row.id);
      row.status = "expired";
    }
    return rowTelegramBindingCode(row);
  }

  function consumeTelegramBindingCode(code: string, input: ConsumeTelegramBindingCodeInput): TelegramAccountRecord | null {
    const normalized = code.trim();
    const telegramUserId = input.telegramUserId.trim();
    const telegramChatId = input.telegramChatId.trim();
    if (!normalized || !telegramUserId || !telegramChatId) return null;
    const bindingCodeHash = bearerTokenHash(normalized);
    const tx = db.transaction(() => {
      const row = db.prepare(
        `select * from telegram_binding_codes
         where binding_code_hash = ? and status = 'pending' and consumed_at is null
         limit 1`
      ).get(bindingCodeHash) as any;
      if (!row) return null;
      if (row.expires_at <= nowIso()) {
        db.prepare("update telegram_binding_codes set status = 'expired' where id = ? and status = 'pending'").run(row.id);
        return null;
      }
      const at = nowIso();
      db.prepare(
        `update telegram_accounts
         set status = 'revoked', revoked_at = coalesce(revoked_at, ?), updated_at = ?
         where status = 'active' and revoked_at is null and (telegram_user_id = ? or user_id = ?)`
      ).run(at, at, telegramUserId, row.user_id);
      // 重新绑定后旧 Chat 不再是合法投递目标，未完成消息必须和旧绑定一起失效。
      db.prepare(
        `update telegram_outbound_deliveries
         set status = 'cancelled', updated_at = ?
         where status in ('pending', 'sending', 'retry')
           and telegram_account_id in (
             select id from telegram_accounts
             where status = 'revoked' and (telegram_user_id = ? or user_id = ?)
           )`
      ).run(at, telegramUserId, row.user_id);
      const account: TelegramAccountRecord = {
        id: id("telegram_account"),
        userId: row.user_id,
        serverId: row.server_id,
        telegramUserId,
        telegramChatId,
        username: input.username?.trim() || undefined,
        firstName: input.firstName?.trim() || undefined,
        lastName: input.lastName?.trim() || undefined,
        status: "active",
        createdAt: at,
        updatedAt: at,
        lastSeenAt: at
      };
      db.prepare(
        `insert into telegram_accounts
          (id, user_id, server_id, telegram_user_id, telegram_chat_id, username, first_name, last_name, status, created_at, updated_at, revoked_at, last_seen_at)
         values (@id, @userId, @serverId, @telegramUserId, @telegramChatId, @username, @firstName, @lastName, @status, @createdAt, @updatedAt, null, @lastSeenAt)`
      ).run(account);
      db.prepare("update telegram_binding_codes set status = 'consumed', consumed_at = ? where id = ? and status = 'pending'").run(at, row.id);
      return getTelegramAccount(account.id);
    });
    return tx();
  }

  function getTelegramAccount(accountId: string): TelegramAccountRecord | null {
    const row = db.prepare("select * from telegram_accounts where id = ? or id like ?").get(accountId, `${accountId}%`) as any;
    return row ? rowTelegramAccount(row) : null;
  }

  function getTelegramAccountByTelegramUserId(telegramUserId: string): TelegramAccountRecord | null {
    const normalized = telegramUserId.trim();
    if (!normalized) return null;
    const row = db.prepare(
      `select * from telegram_accounts
       where telegram_user_id = ? and status = 'active' and revoked_at is null
       order by created_at desc limit 1`
    ).get(normalized) as any;
    return row ? rowTelegramAccount(row) : null;
  }

  function getTelegramAccountByUserId(userId: string): TelegramAccountRecord | null {
    const normalized = userId.trim();
    if (!normalized) return null;
    const row = db.prepare(
      `select * from telegram_accounts
       where user_id = ? and status = 'active' and revoked_at is null
       order by created_at desc limit 1`
    ).get(normalized) as any;
    return row ? rowTelegramAccount(row) : null;
  }

  function revokeTelegramAccountForUser(userId: string): TelegramAccountRecord | null {
    const account = getTelegramAccountByUserId(userId);
    if (!account) return null;
    const revokedAt = nowIso();
    db.prepare(
      `update telegram_accounts
       set status = 'revoked', revoked_at = ?, updated_at = ?
       where id = ? and status = 'active' and revoked_at is null`
    ).run(revokedAt, revokedAt, account.id);
    // Disconnect 是同步开关；已排队但尚未送达的内容不得在解绑后继续外发。
    db.prepare(
      `update telegram_outbound_deliveries
       set status = 'cancelled', updated_at = ?
       where telegram_account_id = ? and status in ('pending', 'sending', 'retry')`
    ).run(revokedAt, account.id);
    return getTelegramAccount(account.id);
  }

  function touchTelegramAccount(accountId: string): TelegramAccountRecord | null {
    const account = getTelegramAccount(accountId);
    if (!account || account.status !== "active" || account.revokedAt) return null;
    const lastSeenAt = nowIso();
    db.prepare("update telegram_accounts set last_seen_at = ?, updated_at = ? where id = ?").run(lastSeenAt, lastSeenAt, account.id);
    return getTelegramAccount(account.id);
  }

  function getTelegramOutboundDelivery(deliveryId: string): TelegramOutboundDeliveryRecord | null {
    const row = db.prepare("select * from telegram_outbound_deliveries where id = ?").get(deliveryId);
    return row ? rowTelegramOutboundDelivery(row) : null;
  }

  function enqueueTelegramOutboundDeliveries(input: EnqueueTelegramOutboundDeliveriesInput): TelegramOutboundDeliveryRecord[] {
    const account = getTelegramAccount(input.telegramAccountId);
    const message = getMessage(input.messageId);
    const chunks = input.chunks.filter((chunk) => chunk.length > 0);
    if (
      !account || account.status !== "active" || account.revokedAt ||
      account.telegramChatId !== input.telegramChatId ||
      !message || message.seq !== input.messageSeq ||
      chunks.length === 0
    ) return [];

    const tx = db.transaction(() => {
      const createdAt = nowIso();
      const insert = db.prepare(
        `insert into telegram_outbound_deliveries
          (id, telegram_account_id, telegram_chat_id, message_id, message_seq, chunk_index, text,
           status, attempts, next_attempt_at, telegram_message_id, last_error, sent_at, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, null, null, null, ?, ?)
         on conflict(telegram_account_id, message_id, chunk_index) do nothing`
      );
      chunks.forEach((chunk, chunkIndex) => {
        insert.run(
          id("tgout"),
          account.id,
          account.telegramChatId,
          message.id,
          message.seq,
          chunkIndex,
          chunk,
          createdAt,
          createdAt,
          createdAt
        );
      });
      return listTelegramOutboundDeliveries({ telegramAccountId: account.id, messageId: message.id });
    });
    return tx();
  }

  function listTelegramOutboundDeliveries(filter: { telegramAccountId?: string; messageId?: string; status?: TelegramOutboundDeliveryStatus } = {}): TelegramOutboundDeliveryRecord[] {
    const where: string[] = [];
    const args: string[] = [];
    if (filter.telegramAccountId) {
      where.push("telegram_account_id = ?");
      args.push(filter.telegramAccountId);
    }
    if (filter.messageId) {
      where.push("message_id = ?");
      args.push(filter.messageId);
    }
    if (filter.status) {
      where.push("status = ?");
      args.push(filter.status);
    }
    const rows = db.prepare(
      `select * from telegram_outbound_deliveries${where.length ? ` where ${where.join(" and ")}` : ""}
       order by created_at, message_seq, chunk_index, id`
    ).all(...args);
    return rows.map(rowTelegramOutboundDelivery);
  }

  function claimNextTelegramOutboundDelivery(at = nowIso()): TelegramOutboundDeliveryRecord | null {
    const tx = db.transaction(() => {
      const row = db.prepare(
        `select candidate.*
         from telegram_outbound_deliveries candidate
         join telegram_accounts account on account.id = candidate.telegram_account_id
         where candidate.status in ('pending', 'retry')
           and candidate.next_attempt_at <= ?
           and account.status = 'active' and account.revoked_at is null
           and not exists (
             select 1 from telegram_outbound_deliveries earlier
             where earlier.telegram_chat_id = candidate.telegram_chat_id
               and earlier.status in ('pending', 'sending', 'retry')
               and (
                 earlier.message_seq < candidate.message_seq or
                 (earlier.message_seq = candidate.message_seq and earlier.chunk_index < candidate.chunk_index) or
                 (earlier.message_seq = candidate.message_seq and earlier.chunk_index = candidate.chunk_index and earlier.created_at < candidate.created_at)
               )
           )
         order by candidate.created_at, candidate.message_seq, candidate.chunk_index, candidate.id
         limit 1`
      ).get(at) as any;
      if (!row) return null;
      const updatedAt = nowIso();
      const changed = db.prepare(
        `update telegram_outbound_deliveries
         set status = 'sending', attempts = attempts + 1, updated_at = ?
         where id = ? and status in ('pending', 'retry')`
      ).run(updatedAt, row.id);
      return changed.changes === 1 ? getTelegramOutboundDelivery(row.id) : null;
    });
    return tx();
  }

  function markTelegramOutboundDeliverySent(deliveryId: string, telegramMessageId?: string): TelegramOutboundDeliveryRecord | null {
    const sentAt = nowIso();
    db.prepare(
      `update telegram_outbound_deliveries
       set status = 'sent', telegram_message_id = ?, last_error = null, sent_at = ?, updated_at = ?
       where id = ? and status = 'sending'`
    ).run(telegramMessageId?.trim() || null, sentAt, sentAt, deliveryId);
    return getTelegramOutboundDelivery(deliveryId);
  }

  function retryTelegramOutboundDelivery(deliveryId: string, nextAttemptAt: string, error: string): TelegramOutboundDeliveryRecord | null {
    db.prepare(
      `update telegram_outbound_deliveries
       set status = 'retry', next_attempt_at = ?, last_error = ?, updated_at = ?
       where id = ? and status = 'sending'`
    ).run(nextAttemptAt, error.slice(0, 1000), nowIso(), deliveryId);
    return getTelegramOutboundDelivery(deliveryId);
  }

  function failTelegramOutboundDelivery(deliveryId: string, error: string): TelegramOutboundDeliveryRecord | null {
    db.prepare(
      `update telegram_outbound_deliveries
       set status = 'failed', last_error = ?, updated_at = ?
       where id = ? and status = 'sending'`
    ).run(error.slice(0, 1000), nowIso(), deliveryId);
    return getTelegramOutboundDelivery(deliveryId);
  }

  function cancelTelegramOutboundDelivery(deliveryId: string): TelegramOutboundDeliveryRecord | null {
    db.prepare(
      `update telegram_outbound_deliveries
       set status = 'cancelled', updated_at = ?
       where id = ? and status in ('pending', 'sending', 'retry')`
    ).run(nowIso(), deliveryId);
    return getTelegramOutboundDelivery(deliveryId);
  }

  function resetSendingTelegramOutboundDeliveries(): number {
    const at = nowIso();
    const result = db.prepare(
      `update telegram_outbound_deliveries
       set status = 'retry', next_attempt_at = ?, updated_at = ?
       where status = 'sending'`
    ).run(at, at);
    return result.changes;
  }

  function createTelegramApprovalAction(input: CreateTelegramApprovalActionInput): TelegramApprovalActionRecord {
    const now = nowIso();
    const record: TelegramApprovalActionRecord = {
      id: id("tgappr"),
      approvalId: input.approvalId,
      serverId: input.serverId,
      userId: input.userId,
      telegramUserId: input.telegramUserId,
      decision: input.decision,
      status: "pending",
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now
    };
    db.prepare(
      `insert into telegram_approval_actions
        (id, approval_id, server_id, user_id, telegram_user_id, decision, status, expires_at, consumed_at, created_at, updated_at)
       values (@id, @approvalId, @serverId, @userId, @telegramUserId, @decision, @status, @expiresAt, null, @createdAt, @updatedAt)`
    ).run(record);
    return getTelegramApprovalAction(record.id)!;
  }

  function getTelegramApprovalAction(actionId: string): TelegramApprovalActionRecord | null {
    const row = db.prepare("select * from telegram_approval_actions where id = ?").get(actionId.trim()) as any;
    return row ? rowTelegramApprovalAction(row) : null;
  }

  function consumeTelegramApprovalAction(actionId: string, consumedAt = nowIso()): TelegramApprovalActionRecord | null {
    const normalized = actionId.trim();
    if (!normalized) return null;
    const current = getTelegramApprovalAction(normalized);
    if (!current || current.status !== "pending") return null;
    db.prepare(
      `update telegram_approval_actions
       set status = 'consumed', consumed_at = ?, updated_at = ?
       where id = ? and status = 'pending'`
    ).run(consumedAt, consumedAt, normalized);
    const updated = getTelegramApprovalAction(normalized);
    return updated?.status === "consumed" && updated.consumedAt === consumedAt ? updated : null;
  }

  function claimTelegramWebhookUpdate(updateId: string, ttlSeconds = 24 * 60 * 60): { claimed: boolean } {
    const normalized = updateId.trim();
    if (!normalized) return { claimed: true };
    const now = nowIso();
    db.prepare("delete from telegram_webhook_updates where expires_at <= ?").run(now);
    const expiresAt = new Date(Date.now() + Math.max(60, ttlSeconds) * 1000).toISOString();
    const result = db.prepare(
      `insert or ignore into telegram_webhook_updates
        (update_id, created_at, expires_at)
       values (?, ?, ?)`
    ).run(normalized, now, expiresAt);
    return { claimed: result.changes > 0 };
  }

  function checkTelegramRateLimit(input: { scopeKey: string; limit: number; windowSeconds: number }): TelegramRateLimitResult {
    const scopeKey = input.scopeKey.trim();
    const limit = Math.max(1, Math.floor(input.limit));
    const windowSeconds = Math.max(1, Math.floor(input.windowSeconds));
    const now = nowIso();
    const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();
    db.prepare("delete from telegram_rate_limit_events where created_at <= ?").run(windowStart);
    if (!scopeKey) {
      return { allowed: true, count: 0, limit, retryAfterSeconds: 0, resetAt: now };
    }

    const count = Number((db.prepare(
      `select count(*) as count
       from telegram_rate_limit_events
       where scope_key = ? and created_at > ?`
    ).get(scopeKey, windowStart) as any)?.count ?? 0);

    if (count >= limit) {
      const oldest = db.prepare(
        `select created_at
         from telegram_rate_limit_events
         where scope_key = ? and created_at > ?
         order by created_at asc
         limit 1`
      ).get(scopeKey, windowStart) as any;
      const resetAt = oldest?.created_at
        ? new Date(Date.parse(oldest.created_at) + windowSeconds * 1000).toISOString()
        : new Date(Date.now() + windowSeconds * 1000).toISOString();
      return {
        allowed: false,
        count,
        limit,
        retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(resetAt) - Date.now()) / 1000)),
        resetAt
      };
    }

    db.prepare(
      `insert into telegram_rate_limit_events
        (id, scope_key, created_at)
       values (?, ?, ?)`
    ).run(id("telegram_rate"), scopeKey, now);
    return {
      allowed: true,
      count: count + 1,
      limit,
      retryAfterSeconds: 0,
      resetAt: new Date(Date.now() + windowSeconds * 1000).toISOString()
    };
  }

  function updateDeviceConnectionStatus(deviceId: string, status: DeviceStatus): DeviceRecord | null {
    const device = getDevice(deviceId);
    if (!device) return null;
    const lastSeenAt = nowIso();
    db.prepare("update devices set status = ?, last_seen_at = ? where id = ?").run(status, lastSeenAt, device.id);
    if (device.status !== status) {
      // 连接状态是设备可调用性的真源，状态变更必须进入审计供用户事后追踪。
      recordAuditEvent({
        kind: status === "online" ? "device_connected" : "device_disconnected",
        actorType: "system",
        resourceType: "device",
        resourceId: device.id,
        serverId: device.serverId,
        metadata: auditMetadata({
          deviceId: device.id,
          displayName: device.displayName,
          previousStatus: device.status,
          status
        })
      });
    }
    return getDevice(device.id);
  }

  function createDeviceGrant(input: CreateDeviceGrantInput): DeviceGrantRecord {
    const createdAt = nowIso();
    const grant = {
      id: id("device_grant"),
      serverId: input.serverId,
      agentId: input.agentId,
      deviceId: input.deviceId,
      capabilities: input.capabilities,
      scope: input.scope,
      expiresAt: input.expiresAt,
      status: "active",
      createdByUserId: input.createdByUserId,
      createdAt,
      revokedAt: undefined
    } satisfies DeviceGrantRecord;
    db.prepare(
      `insert into device_grants
        (id, server_id, agent_id, device_id, capabilities, scope, expires_at, status, created_by_user_id, created_at, revoked_at)
       values (@id, @serverId, @agentId, @deviceId, @capabilities, @scope, @expiresAt, @status, @createdByUserId, @createdAt, null)`
    ).run({ ...grant, capabilities: stringify(grant.capabilities as JsonValue[]) });
    recordAuditEvent({
      kind: "device_access_rule_created",
      actorType: "user",
      actorId: grant.createdByUserId,
      resourceType: "device_grant",
      resourceId: grant.id,
      serverId: grant.serverId,
      metadata: auditMetadata({
        deviceId: grant.deviceId,
        agentId: grant.agentId,
        capabilities: grant.capabilities as JsonValue[],
        scope: grant.scope,
        expiresAt: grant.expiresAt
      })
    });
    return grant;
  }

  function revokeDeviceGrant(grantId: string): DeviceGrantRecord | null {
    const row = db.prepare("select * from device_grants where id = ? or id like ?").get(grantId, `${grantId}%`) as any;
    if (!row) return null;
    db.prepare("update device_grants set status = 'revoked', revoked_at = ? where id = ?").run(nowIso(), row.id);
    const grant = rowDeviceGrant(db.prepare("select * from device_grants where id = ?").get(row.id));
    recordAuditEvent({
      kind: "device_access_rule_revoked",
      actorType: "system",
      resourceType: "device_grant",
      resourceId: grant.id,
      serverId: grant.serverId,
      metadata: auditMetadata({
        deviceId: grant.deviceId,
        agentId: grant.agentId,
        capabilities: grant.capabilities as JsonValue[]
      })
    });
    return grant;
  }

  function listDeviceGrants(filter: { serverId?: string; deviceId?: string; agentId?: string; activeOnly?: boolean } = {}): DeviceGrantRecord[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.serverId) {
      clauses.push("server_id = ?");
      params.push(filter.serverId);
    }
    if (filter.deviceId) {
      clauses.push("device_id = ?");
      params.push(filter.deviceId);
    }
    if (filter.agentId) {
      clauses.push("agent_id = ?");
      params.push(filter.agentId);
    }
    if (filter.activeOnly) clauses.push("status = 'active' and revoked_at is null and (expires_at is null or expires_at > ?)");
    if (filter.activeOnly) params.push(nowIso());
    const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
    return db.prepare(`select * from device_grants ${where} order by created_at`).all(...params).map(rowDeviceGrant);
  }

  function findActiveDeviceGrant(agentId: string, deviceId: string, capability: DeviceCapability, serverId: string, at = nowIso()): DeviceGrantRecord | null {
    const grants = db.prepare(
      `select * from device_grants
       where agent_id = ? and device_id = ? and server_id = ?
         and status = 'active'
         and revoked_at is null
         and (expires_at is null or expires_at > ?)
       order by created_at desc`
    ).all(agentId, deviceId, serverId, at).map(rowDeviceGrant);
    return grants.find((grant) => grant.capabilities.includes(capability)) ?? null;
  }

  function createDeviceCommand(input: CreateDeviceCommandInput): DeviceCommandRecord {
    const createdAt = nowIso();
    const command = {
      id: id("device_cmd"),
      serverId: input.serverId,
      agentId: input.agentId,
      deviceId: input.deviceId,
      grantId: input.grantId,
      capability: input.capability,
      params: input.params ?? {},
      status: "queued",
      requestedByMessageId: input.requestedByMessageId,
      channelId: input.channelId,
      taskId: input.taskId,
      reason: input.reason,
      expiresAt: input.expiresAt,
      createdAt
    } satisfies DeviceCommandRecord;
    db.prepare(
      `insert into device_commands
        (id, server_id, agent_id, device_id, grant_id, capability, params, status, requested_by_message_id, channel_id, task_id, reason, artifact_ids, result_data, error_code, error_message, expires_at, created_at, completed_at)
       values (@id, @serverId, @agentId, @deviceId, @grantId, @capability, @params, @status, @requestedByMessageId, @channelId, @taskId, @reason, null, null, null, null, @expiresAt, @createdAt, null)`
    ).run({ ...command, params: stringify(command.params as JsonValue) });
    recordAuditEvent({
      kind: "device_command_requested",
      actorType: "agent",
      actorId: command.agentId,
      resourceType: "device_command",
      resourceId: command.id,
      serverId: command.serverId,
      metadata: auditMetadata({
        deviceId: command.deviceId,
        capability: command.capability,
        grantId: command.grantId,
        requestedByMessageId: command.requestedByMessageId,
        channelId: command.channelId,
        reason: command.reason,
        expiresAt: command.expiresAt
      })
    });
    return command;
  }

  function getDeviceCommand(commandId: string): DeviceCommandRecord | null {
    const row = db.prepare("select * from device_commands where id = ? or id like ?").get(commandId, `${commandId}%`);
    return row ? rowDeviceCommand(row) : null;
  }

  function markDeviceCommandSent(commandId: string): DeviceCommandRecord | null {
    const command = getDeviceCommand(commandId);
    if (!command) return null;
    db.prepare("update device_commands set status = 'sent' where id = ?").run(command.id);
    const next = getDeviceCommand(command.id);
    if (next) {
      recordAuditEvent({
        kind: "device_command_sent",
        actorType: "system",
        resourceType: "device_command",
        resourceId: next.id,
        serverId: next.serverId,
        metadata: auditMetadata({
          deviceId: next.deviceId,
          capability: next.capability
        })
      });
    }
    return next;
  }

  function markDeviceCommandRunning(commandId: string): DeviceCommandRecord | null {
    const command = getDeviceCommand(commandId);
    if (!command) return null;
    db.prepare("update device_commands set status = 'running' where id = ?").run(command.id);
    const next = getDeviceCommand(command.id);
    if (next) {
      recordAuditEvent({
        kind: "device_command_running",
        actorType: "system",
        resourceType: "device_command",
        resourceId: next.id,
        serverId: next.serverId,
        metadata: auditMetadata({
          deviceId: next.deviceId,
          capability: next.capability
        })
      });
    }
    return next;
  }

  function completeDeviceCommand(commandId: string, result: DeviceCommandResult): DeviceCommandRecord | null {
    const command = getDeviceCommand(commandId);
    if (!command) return null;
    db.prepare(
      `update device_commands
       set status = ?, artifact_ids = ?, result_data = ?, error_code = ?, error_message = ?, completed_at = ?
       where id = ?`
    ).run(
      result.status,
      result.artifactIds ? stringify(result.artifactIds as JsonValue[]) : null,
      result.data ? stringify(result.data as JsonValue) : null,
      result.errorCode ?? null,
      result.errorMessage ?? null,
      nowIso(),
      command.id
    );
    const next = getDeviceCommand(command.id);
    if (next) {
      recordAuditEvent({
        kind: terminalDeviceCommandAuditKind(result.status),
        actorType: "system",
        resourceType: "device_command",
        resourceId: next.id,
        serverId: next.serverId,
        metadata: auditMetadata({
          deviceId: next.deviceId,
          capability: next.capability,
          status: next.status,
          errorCode: next.errorCode,
          errorMessage: next.errorMessage,
          artifactIds: next.artifactIds as JsonValue[] | undefined
        })
      });
    }
    return next;
  }

  function listDeviceCommands(deviceId?: string): DeviceCommandRecord[] {
    if (deviceId) return db.prepare("select * from device_commands where device_id = ? order by created_at").all(deviceId).map(rowDeviceCommand);
    return db.prepare("select * from device_commands order by created_at").all().map(rowDeviceCommand);
  }

  function grantScopesAllowAgentDmParticipation(scopes: ResourceGrantScope[]): boolean {
    return scopes.includes("message");
  }

  function agentHasParticipatingGrantForChannel(agentId: string, channel: ChannelRecord): boolean {
    const identity = channel.dmIdentity;
    return identity?.kind === "human_agent" &&
      identity.agentId === agentId &&
      grantScopesAllowAgentDmParticipation(resourceGrantScopesForUser(identity.humanUserId, "agent", agentId));
  }

  function pruneRevokedAgentGrantChannelMemberships(agentId: string): void {
    const rows = db.prepare(
      `select channels.*
       from channels
       join channel_members on channel_members.channel_id = channels.id
       where channel_members.subject_type = 'agent'
         and channel_members.subject_id = ?
         and channel_members.left_at is null`
    ).all(agentId).map(rowChannel);
    for (const channel of rows) {
      if (!canAgentAccessChannel(agentId, channel.id)) {
        setAgentChannelMembership(agentId, channel.id, false, false);
      }
    }
  }

  function removeHumanAgentPairDmMemberships(userId: string, agentId: string): void {
    const rows = db.prepare(
      `select distinct channels.id
       from channels
       join channel_members humans on humans.channel_id = channels.id
        and humans.subject_type = 'human'
        and humans.subject_id = ?
        and humans.left_at is null
       join channel_members agents on agents.channel_id = channels.id
        and agents.subject_type = 'agent'
        and agents.subject_id = ?
        and agents.left_at is null
       where channels.type = 'dm'`
    ).all(userId, agentId) as Array<{ id: string }>;
    for (const row of rows) {
      setHumanChannelMembership(userId, row.id, false, "owner");
      setAgentChannelMembership(agentId, row.id, false, false);
    }
  }

  function recordAuditEvent(input: AuditEventInput): AuditEventRecord {
    const event: AuditEventRecord = {
      id: id("audit"),
      kind: input.kind,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      serverId: input.serverId ?? null,
      metadata: input.metadata ?? {},
      createdAt: nowIso()
    };
    db.prepare(
      `insert into audit_events (id, kind, actor_type, actor_id, resource_type, resource_id, server_id, metadata, created_at)
       values (@id, @kind, @actorType, @actorId, @resourceType, @resourceId, @serverId, @metadata, @createdAt)`
    ).run({ ...event, metadata: stringify(event.metadata as JsonValue) });
    return event;
  }

  function listAuditEvents(input: number | AuditEventFilter = 200): AuditEventRecord[] {
    if (typeof input === "number") {
      const max = Math.max(1, Math.min(input, 1000));
      return db.prepare("select * from audit_events order by created_at desc, rowid desc limit ?").all(max).map(rowAuditEvent);
    }
    const clauses: string[] = [];
    const params: string[] = [];
    if (input.serverId) {
      clauses.push("server_id = ?");
      params.push(input.serverId);
    }
    if (input.resourceType) {
      clauses.push("resource_type = ?");
      params.push(input.resourceType);
    }
    if (input.resourceId) {
      clauses.push("resource_id = ?");
      params.push(input.resourceId);
    } else if (input.resourceIds?.length) {
      clauses.push(`resource_id in (${input.resourceIds.map(() => "?").join(", ")})`);
      params.push(...input.resourceIds);
    }
    const max = Math.max(1, Math.min(input.limit ?? 200, 1000));
    const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const direction = input.order === "desc" ? "desc" : "asc";
    return db.prepare(`select * from audit_events ${where} order by created_at ${direction}, rowid ${direction} limit ?`).all(...params, max).map(rowAuditEvent);
  }

  function createResourceGrant(input: CreateResourceGrantInput): ResourceGrantRecord {
    const scopes = normalizeGrantScopes(input.scopes);
    if (scopes.length === 0) throw new Error("resource_grant_scope_required");
    if (getResourceOwnerUserId(input.resourceType, input.resourceId) !== input.createdByUserId) {
      throw new Error("resource_owner_required");
    }
    if (!db.prepare("select 1 from users where id = ?").get(input.granteeUserId)) throw new Error("grantee_not_found");
    const grant = {
      id: id("grant"),
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      granteeUserId: input.granteeUserId,
      scopes,
      createdByUserId: input.createdByUserId,
      createdAt: nowIso(),
      revokedAt: null,
      revokedByUserId: null
    } satisfies ResourceGrantRecord;
    db.prepare(
      `insert into resource_grants
        (id, resource_type, resource_id, grantee_user_id, scopes, created_by_user_id, created_at, revoked_at, revoked_by_user_id)
       values (?, ?, ?, ?, ?, ?, ?, null, null)`
    ).run(grant.id, grant.resourceType, grant.resourceId, grant.granteeUserId, JSON.stringify(grant.scopes), grant.createdByUserId, grant.createdAt);
    recordAuditEvent({
      kind: "grant_created",
      actorType: "user",
      actorId: input.createdByUserId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: { grantId: grant.id, granteeUserId: input.granteeUserId, scopes: grant.scopes }
    });
    return grant;
  }

  function revokeResourceGrant(grantId: string, revokedByUserId?: string): ResourceGrantRecord | null {
    const row = db.prepare("select * from resource_grants where id = ? or id like ?").get(grantId, `${grantId}%`) as any;
    if (!row) return null;
    const grant = rowResourceGrant(row);
    if (grant.revokedAt) return grant;
    if (revokedByUserId && getResourceOwnerUserId(grant.resourceType, grant.resourceId) !== revokedByUserId) {
      throw new Error("resource_owner_required");
    }
    db.prepare("update resource_grants set revoked_at = ?, revoked_by_user_id = ? where id = ?").run(nowIso(), revokedByUserId ?? null, grant.id);
    if (grant.resourceType === "agent") {
      removeHumanAgentPairDmMemberships(grant.granteeUserId, grant.resourceId);
      pruneRevokedAgentGrantChannelMemberships(grant.resourceId);
    }
    const updated = db.prepare("select * from resource_grants where id = ?").get(grant.id);
    const revoked = updated ? rowResourceGrant(updated) : null;
    if (revoked) {
      recordAuditEvent({
        kind: "grant_revoked",
        actorType: revokedByUserId ? "user" : "system",
        actorId: revokedByUserId ?? null,
        resourceType: revoked.resourceType,
        resourceId: revoked.resourceId,
        metadata: { grantId: revoked.id, granteeUserId: revoked.granteeUserId }
      });
    }
    return revoked;
  }

  function emptyWorkspaceScope(viewer: UserRecord): WorkspaceScope {
    return {
      viewer,
      serverId: null,
      currentServer: null,
      machines: [],
      agents: [],
      humans: [],
      channels: [],
      channelIds: [],
      devices: [],
      deviceGrants: [],
      deviceCommands: [],
      ownerVisibleAgentIds: [],
      resourceGrantSummaries: [],
      incomingServerInvites: listIncomingServerInvites(viewer.email ?? "")
    };
  }

  function paginateByCreatedAt<T extends { id: string; createdAt: string }>(
    items: T[],
    limitInput: number | undefined,
    cursor: string | undefined,
    fallbackLimit: number,
    maxLimit: number
  ): PaginatedList<T> {
    const limit = Math.max(1, Math.min(typeof limitInput === "number" && Number.isFinite(limitInput) ? Math.floor(limitInput) : fallbackLimit, maxLimit));
    const start = cursor ? Math.max(0, items.findIndex((item) => `${item.createdAt}:${item.id}` === cursor) + 1) : 0;
    const pageItems = items.slice(start, start + limit);
    const last = pageItems.at(-1);
    const nextCursor = start + pageItems.length < items.length && last ? `${last.createdAt}:${last.id}` : null;
    return { items: pageItems, pageInfo: { limit, nextCursor, hasMore: Boolean(nextCursor) } };
  }

  function workspaceScope(userId?: string): WorkspaceScope {
    const viewer = currentUser(userId);
    const serverId = getActiveServerIdForUser(viewer.id);
    if (!serverId) return emptyWorkspaceScope(viewer);
    ensureDefaultCommunicationAgent(serverId);
    const grants = listResourceGrants({ granteeUserId: viewer.id, activeOnly: true });
    const scopesByResource = new Map<string, ResourceGrantScope[]>();
    for (const grant of grants) {
      scopesByResource.set(`${grant.resourceType}:${grant.resourceId}`, normalizeGrantScopes([...(scopesByResource.get(`${grant.resourceType}:${grant.resourceId}`) ?? []), ...grant.scopes]));
    }
    const currentServer = listServersForUser(viewer.id).find((server) => server.id === serverId) ?? null;
    const hasWorkspaceAccess = currentServer?.role === "owner" || currentServer?.role === "member";
    const accessFor = (resourceType: ResourceType, resourceId: string) => {
      const scopes = scopesByResource.get(`${resourceType}:${resourceId}`);
      return scopes?.length ? { shared: true, scopes } : undefined;
    };
    const sanitizeSharedAgent = (agent: AgentRecord): AgentRecord => {
      if (!agent.access?.shared) return agent;
      const { runtimeResourceGrants: _runtimeResourceGrants, ...sharedAgent } = agent;
      return { ...sharedAgent, authToken: "" };
    };
    const sanitizeSharedMachine = (machine: MachineRecord): MachineRecord => machine.access?.shared ? { ...machine, apiKey: "", connectorToken: undefined } : machine;
    const allMachineRows = listMachines();
    const machineById = new Map(allMachineRows.map((machine) => [machine.id, machine]));
    const machineStatusById = new Map(allMachineRows.map((machine) => [machine.id, machine.status]));
    const agentMachine = (agent: AgentRecord): MachineRecord | undefined => agent.machineId ? machineById.get(agent.machineId) : undefined;
    const agentHasMachine = (agent: AgentRecord): boolean => Boolean(agent.machineId && machineById.has(agent.machineId));
    const machineBelongsToCurrentServer = (agent: AgentRecord): boolean => agentMachine(agent)?.serverId === serverId;
    const normalizeAgentStatus = (agent: AgentRecord): AgentRecord => {
      if (isCommunicationAgent(agent)) return agent;
      const machineStatus = agent.machineId ? machineStatusById.get(agent.machineId) : undefined;
      // Computer 离线时本机 runtime 不可达，快照层不能继续把运行态 Agent 展示为在线或工作中。
      if (machineStatus && machineStatus !== "online" && (agent.status === "online" || agent.status === "working")) {
        return { ...agent, status: "offline" as const };
      }
      return agent;
    };
    const attachCommunicationAgentEmailAlias = (agent: AgentRecord): AgentRecord => {
      if (!isCommunicationAgent(agent) || agent.access?.shared) return agent;
      const alias = ensureCommunicationAgentEmailAlias({
        serverId: agent.serverId ?? serverId,
        userId: viewer.id,
        assistantAgentId: agent.id,
        domain: COMMUNICATION_AGENT_EMAIL_DOMAIN
      });
      return { ...agent, communicationEmailAddress: alias.address };
    };
    const agentRows = new Map<string, AgentRecord>();
    if (hasWorkspaceAccess) {
      for (const agent of listAgents(serverId).map(normalizeAgentStatus)) agentRows.set(agent.id, agent);
    }
    for (const grant of grants.filter((item) => item.resourceType === "agent" && item.scopes.some((scope) => scope === "view" || scope === "message" || scope === "task"))) {
      const agent = getAgent(grant.resourceId);
      const machine = agent ? agentMachine(agent) : undefined;
      if (agent && (machine || isCommunicationAgent(agent))) {
        // Agent grants are the resource boundary; expose only safe host metadata, not the Computer as a managed resource.
        agentRows.set(agent.id, { ...normalizeAgentStatus(agent), access: accessFor("agent", agent.id), hostMachine: machine ? agentHostMachineSummary(machine) : undefined });
      }
    }
    const allChannels = db.prepare("select * from channels order by server_id, type, name").all().map(rowChannel);
    const baseChannelInSnapshotScope = (channel: ChannelRecord): boolean => {
      if (channel.type === "thread") return false;
      // Channel grants are no longer part of the public sharing model; conversations stay inside the active workspace.
      return (channel.serverId ?? "local") === serverId;
    };
    const baseChannels = allChannels.filter((channel) => baseChannelInSnapshotScope(channel) && canUserAccessChannel(viewer.id, channel.id));
    const baseChannelIds = new Set(baseChannels.map((channel) => channel.id));
    const channels = allChannels
      .filter((channel) => {
        if (channel.type === "thread" && channel.parentChannelId) {
          // Thread 可见性跟随 parent channel，避免跨 server 的个人 Agent membership 把历史 thread 带入当前工作区。
          return baseChannelIds.has(channel.parentChannelId) && canUserAccessChannel(viewer.id, channel.id);
        }
        return baseChannelIds.has(channel.id);
      });
    const channelIds = channels.map((channel) => channel.id);
    if (channelIds.length) {
      const placeholders = channelIds.map(() => "?").join(",");
      const remoteMemberAgentIds = db.prepare(
        `select distinct subject_id from channel_members
         where subject_type = 'agent' and left_at is null and channel_id in (${placeholders})`
      ).pluck().all(...channelIds) as string[];
      for (const agentId of remoteMemberAgentIds) {
        const agent = getAgent(agentId);
        if (!agent || agent.deletedAt) continue;
        const grantedAccess = accessFor("agent", agent.id);
        const belongsToCurrentServer = machineBelongsToCurrentServer(agent);
        // active server 是资源边界；跨 server 的自有 Agent 只能作为频道身份出现，不能恢复 owner 级资源权限。
        if (grantedAccess || ((agent.ownerUserId === viewer.id || hasWorkspaceAccess) && belongsToCurrentServer)) {
          const machine = agentMachine(agent);
          const hostMachine = grantedAccess && machine ? agentHostMachineSummary(machine) : undefined;
          agentRows.set(agent.id, agentRows.get(agent.id) ?? { ...normalizeAgentStatus(agent), access: grantedAccess, hostMachine });
        } else {
          agentRows.set(agent.id, agentRows.get(agent.id) ?? { ...normalizeAgentStatus(agent), access: { shared: true, scopes: [] } });
        }
      }
    }
    for (const agent of listAgents().filter((agent) => !isCommunicationAgent(agent) && currentServer?.ownerId === viewer.id && agent.ownerUserId === viewer.id && !agentHasMachine(agent))) {
      agentRows.set(agent.id, agentRows.get(agent.id) ?? { ...normalizeAgentStatus(agent), machineMissing: true });
    }
    const agents = Array.from(agentRows.values())
      .filter((agent) => isCommunicationAgent(agent) || agentHasMachine(agent) || agent.ownerUserId === viewer.id)
      .map((agent) => isCommunicationAgent(agent) || agentHasMachine(agent) ? { ...agent, machineMissing: undefined } : { ...agent, machineMissing: true })
      .map((agent) => sanitizeSharedAgent(agent))
      .map((agent) => attachCommunicationAgentEmailAlias(agent))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const machineRowsById = new Map<string, MachineRecord>();
    if (hasWorkspaceAccess) {
      for (const machine of allMachineRows.filter((machine) => machine.serverId === serverId)) machineRowsById.set(machine.id, machine);
    }
    for (const grant of grants.filter((item) => item.resourceType === "machine" && item.scopes.includes("view"))) {
      const machine = getMachine(grant.resourceId);
      if (machine) machineRowsById.set(machine.id, { ...machine, access: accessFor("machine", machine.id) });
    }
    for (const agent of agents) {
      const machine = agentMachine(agent);
      const machineAccess = machine ? accessFor("machine", machine.id) : undefined;
      const machineBelongsToActiveServer = machine?.serverId === serverId;
      // Agent 可能只是当前频道里的身份对象；只有当前 server 内的 owner 资源或明确授权资源能带出 Computer 卡片。
      const shouldExposeMachine = Boolean(machine && ((machineBelongsToActiveServer && (machine.ownerUserId === viewer.id || agent.ownerUserId === viewer.id)) || machineAccess));
      if (machine && shouldExposeMachine && !machineRowsById.has(machine.id)) {
        const access = machine.ownerUserId === viewer.id && machineBelongsToActiveServer ? undefined : machineAccess ?? { shared: true, scopes: ["view"] as ResourceGrantScope[] };
        machineRowsById.set(machine.id, { ...machine, access });
      }
    }
    const machineRows = Array.from(machineRowsById.values()).map(sanitizeSharedMachine).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const machines = machineRows.map((machine) => {
      return {
        ...machine,
        connectorToken: undefined,
        latestDaemonVersion: LATEST_DAEMON_VERSION,
        runtimes: listRuntimeReports(machine.id),
        agents: agents.filter((agent) => agent.machineId === machine.id)
      };
    });
    const devices = listDevices(serverId)
      .filter((device) => !isLegacyMockDevice(device))
      .map((device) => ({ ...device, deviceToken: undefined }));
    const deviceGrants = listDeviceGrants({ serverId, activeOnly: true });
    const visibleDeviceIds = new Set(devices.map((device) => device.id));
    const deviceCommands = listDeviceCommands().filter((command) => visibleDeviceIds.has(command.deviceId)).slice(-200);
    const ownerVisibleAgentIds = agents.filter((agent) => !agent.access?.shared).map((agent) => agent.id);
    const serverMembers = listServerMembers(serverId);
    const serverMemberById = new Map(serverMembers.map((human) => [human.id, human]));
    const visibleMemberHumanIds = new Set<string>();
    if (hasWorkspaceAccess) {
      for (const human of serverMembers) visibleMemberHumanIds.add(human.id);
    } else {
      // Guest 的 Members 面板只展示自己和 workspace owner；频道里的其他 human 仍作为聊天 identity 保留。
      visibleMemberHumanIds.add(viewer.id);
      for (const human of serverMembers.filter((item) => item.role === "owner")) visibleMemberHumanIds.add(human.id);
    }
    const humanIds = new Set<string>(visibleMemberHumanIds);
    for (const agent of agents) humanIds.add(agent.ownerUserId);
    for (const machine of machineRows) humanIds.add(machine.ownerUserId);
    if (channelIds.length) {
      const channelPlaceholders = channelIds.map(() => "?").join(",");
      for (const humanId of db.prepare(
        `select distinct subject_id from channel_members
         where subject_type = 'human' and left_at is null and channel_id in (${channelPlaceholders})`
      ).pluck().all(...channelIds) as string[]) {
        humanIds.add(humanId);
      }
    }
    const humans = Array.from(humanIds)
      .map((humanId) => db.prepare("select * from users where id = ?").get(humanId))
      .filter(Boolean)
      .map(rowUser)
      .map(({ id, name, displayName, email, description, avatarUrl, emailVerified, preferredLanguage, createdAt }) => ({
        id,
        name,
        displayName,
        email,
        description,
        avatarUrl,
        emailVerified,
        preferredLanguage,
        serverRole: serverMemberById.get(id)?.role,
        serverJoinedAt: serverMemberById.get(id)?.joinedAt,
        membershipVisible: visibleMemberHumanIds.has(id),
        createdAt
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const visibleResourceKeys = new Set<string>([
      ...machines.map((machine) => `machine:${machine.id}`),
      ...agents.map((agent) => `agent:${agent.id}`)
    ]);
    const resourceGrantSummaries = listResourceGrants({ activeOnly: true })
      .filter((grant) => visibleResourceKeys.has(`${grant.resourceType}:${grant.resourceId}`))
      .filter((grant) => {
        // Snapshot summaries are UI placement hints; only the owner/creator or the grantee may learn a grant exists.
        return grant.granteeUserId === viewer.id || grant.createdByUserId === viewer.id || getResourceOwnerUserId(grant.resourceType, grant.resourceId) === viewer.id;
      })
      .map(rowResourceGrantSummary)
      .filter((summary): summary is ResourceGrantSummary => Boolean(summary))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // Workspace scope is the shared visibility boundary for bootstrap and page APIs; heavy history stays out of this structure.
    return {
      viewer,
      serverId,
      currentServer,
      machines,
      agents,
      humans,
      channels,
      channelIds,
      devices,
      deviceGrants,
      deviceCommands,
      ownerVisibleAgentIds,
      resourceGrantSummaries,
      incomingServerInvites: listIncomingServerInvites(viewer.email ?? "")
    };
  }

  function workspaceBootstrap(userId?: string): WorkspaceBootstrapPayload {
    const scope = workspaceScope(userId);
    const unreadCounts = Object.fromEntries(Object.entries(listUnreadCounts(scope.viewer.id)).filter(([channelId]) => scope.channelIds.includes(channelId)));
    const serverRole = scope.currentServer?.role;
    const canManageServer = serverRole === "owner";
    const canUseWorkspaceResources = serverRole === "owner" || serverRole === "member";
    // Bridge 与其对端拓扑只对 Owner/Member 可见，bootstrap 不能绕过 Bridge 路由的 Guest 边界。
    const workspaceBridges = canUseWorkspaceResources && scope.currentServer ? listWorkspaceBridges(scope.currentServer.id) : [];
    const bridgeTopology = canUseWorkspaceResources && scope.currentServer
      ? workspaceBridgeTopology(scope.currentServer.id)
      : { peerWorkspaceTopologies: [], workspaceBridgeTopologyEdges: [] };
    const incomingWorkspaceBridges = canUseWorkspaceResources ? listIncomingWorkspaceBridges(scope.viewer.id) : [];
    // Bootstrap 只暴露工作区入口状态；导航列表交给 workspaceNavigation 分页加载，避免响应随资源数线性增长。
    return {
      currentUser: scope.viewer,
      currentServer: scope.currentServer,
      capabilities: {
        canCreateMachine: canUseWorkspaceResources,
        canInviteHuman: canManageServer,
        canManageServer
      },
      summary: {
        dms: scope.channels.filter((channel) => channel.type === "dm").length,
        agents: scope.agents.length,
        machines: scope.machines.length,
        humans: scope.humans.length,
        devices: scope.devices.length,
        openTasks: 0,
        incomingInvites: scope.incomingServerInvites.length,
        unreadTotal: Object.values(unreadCounts).reduce((sum, count) => sum + count, 0),
        resourceGrants: scope.resourceGrantSummaries.length,
        workspaceBridges: workspaceBridges.filter((bridge) => bridge.status === "active").length,
        incomingWorkspaceBridges: incomingWorkspaceBridges.length
      },
      defaults: {
        defaultDmChannelId: scope.channels.find((channel) => channel.type === "dm" && !channel.archivedAt)?.id ?? null
      },
      unreadCounts,
      incomingServerInvites: scope.incomingServerInvites,
      workspaceBridges,
      incomingWorkspaceBridges,
      crossWorkspaceMessages: [],
      peerWorkspaceTopologies: bridgeTopology.peerWorkspaceTopologies,
      workspaceBridgeTopologyEdges: bridgeTopology.workspaceBridgeTopologyEdges,
      sidebarOrder: scope.currentServer ? getServerSidebarOrder(scope.currentServer.id) : undefined
    };
  }

  function workspaceNavigation(userId: string, options: WorkspaceNavigationOptions): WorkspaceNavigationPayload {
    const scope = workspaceScope(userId);
    const unreadCounts = listUnreadCounts(scope.viewer.id);
    const channelNavItem = (channel: ChannelRecord): WorkspaceChannelNavItem => ({
      ...channel,
      unreadCount: unreadCounts[channel.id] ?? 0,
      lastMessageAt: listMessages(channel.id, 1).at(-1)?.createdAt ?? null
    });
    const agentNavItem = (agent: AgentRecord): WorkspaceAgentNavItem => {
      const { authToken: _authToken, ...safeAgent } = agent;
      return safeAgent;
    };
    const machineNavItem = (machine: WorkspaceMachine): WorkspaceMachineNavItem => {
      const { apiKey: _apiKey, connectorToken: _connectorToken, agents, runtimes, ...safeMachine } = machine;
      return {
        ...safeMachine,
        agentCount: agents.length,
        availableRuntimes: runtimes.filter((report) => report.status === "available").map((report) => report.runtime),
        runtimeReports: runtimes
      };
    };
    const items: WorkspaceNavigationItem[] = options.section === "dms"
        ? scope.channels.filter((channel) => channel.type === "dm").map(channelNavItem)
        : options.section === "agents"
          ? scope.agents.map(agentNavItem)
          : options.section === "machines"
            ? scope.machines.map(machineNavItem)
            : options.section === "humans"
              ? scope.humans
              : scope.resourceGrantSummaries;
    return { section: options.section, ...paginateByCreatedAt(items, options.limit, options.cursor, 50, 100) };
  }

  function snapshot(userId?: string): AppSnapshot {
    const viewer = currentUser(userId);
    const serverId = getActiveServerIdForUser(viewer.id);
    if (!serverId) {
      return {
        currentUser: viewer,
        currentServer: null,
        machines: [],
        agents: [],
        humans: [],
        channels: [],
        conversations: [],
        messages: [],
        devices: [],
        deviceGrants: [],
        deviceAccessRules: [],
        deviceCommands: [],
        tasks: [],
        savedMessageIds: [],
        unreadCounts: {},
        reminders: [],
        runtimeApprovals: [],
        runtimeExecutions: [],
        runtimeExecutionEvents: [],
        executionGroups: [],
        agentRuns: [],
        executionBlocks: [],
        executionArtifacts: [],
        communicationAgentPendingActions: [],
        safetyAssessments: [],
        governanceDecisions: [],
        resourceGrantSummaries: [],
        incomingServerInvites: listIncomingServerInvites(viewer.email ?? ""),
        workspaceBridges: [],
        incomingWorkspaceBridges: [],
        crossWorkspaceMessages: [],
        peerWorkspaceTopologies: [],
        workspaceBridgeTopologyEdges: []
      };
    }
    ensureDefaultCommunicationAgent(serverId);
    const grants = listResourceGrants({ granteeUserId: viewer.id, activeOnly: true });
    const scopesByResource = new Map<string, ResourceGrantScope[]>();
    for (const grant of grants) {
      scopesByResource.set(`${grant.resourceType}:${grant.resourceId}`, normalizeGrantScopes([...(scopesByResource.get(`${grant.resourceType}:${grant.resourceId}`) ?? []), ...grant.scopes]));
    }
    const currentServer = listServersForUser(viewer.id).find((server) => server.id === serverId) ?? null;
    const hasWorkspaceAccess = currentServer?.role === "owner" || currentServer?.role === "member";
    // 兼容 snapshot 与轻量 bootstrap 使用相同的 Bridge 可见性，避免实时同步重新带回 Guest 数据。
    const workspaceBridges = hasWorkspaceAccess ? listWorkspaceBridges(serverId) : [];
    const incomingWorkspaceBridges = hasWorkspaceAccess ? listIncomingWorkspaceBridges(viewer.id) : [];
    const accessFor = (resourceType: ResourceType, resourceId: string) => {
      const scopes = scopesByResource.get(`${resourceType}:${resourceId}`);
      return scopes?.length ? { shared: true, scopes } : undefined;
    };
    const sanitizeSharedAgent = (agent: AgentRecord): AgentRecord => agent.access?.shared ? { ...agent, authToken: "" } : agent;
    const sanitizeSharedMachine = (machine: MachineRecord): MachineRecord => machine.access?.shared ? { ...machine, apiKey: "", connectorToken: undefined } : machine;
    const allMachineRows = listMachines();
    const machineById = new Map(allMachineRows.map((machine) => [machine.id, machine]));
    const machineStatusById = new Map(allMachineRows.map((machine) => [machine.id, machine.status]));
    const agentMachine = (agent: AgentRecord): MachineRecord | undefined => agent.machineId ? machineById.get(agent.machineId) : undefined;
    const agentHasMachine = (agent: AgentRecord): boolean => Boolean(agent.machineId && machineById.has(agent.machineId));
    const machineBelongsToCurrentServer = (agent: AgentRecord): boolean => agentMachine(agent)?.serverId === serverId;
    const normalizeAgentStatus = (agent: AgentRecord): AgentRecord => {
      if (isCommunicationAgent(agent)) return agent;
      const machineStatus = agent.machineId ? machineStatusById.get(agent.machineId) : undefined;
      // Computer 离线时本机 runtime 不可达，快照层不能继续把运行态 Agent 展示为在线或工作中。
      if (machineStatus && machineStatus !== "online" && (agent.status === "online" || agent.status === "working")) {
        return { ...agent, status: "offline" as const };
      }
      return agent;
    };
    const agentRows = new Map<string, AgentRecord>();
    if (hasWorkspaceAccess) {
      for (const agent of listAgents(serverId).map(normalizeAgentStatus)) agentRows.set(agent.id, agent);
    }
    for (const grant of grants.filter((item) => item.resourceType === "agent" && item.scopes.some((scope) => scope === "view" || scope === "message" || scope === "task"))) {
      const agent = getAgent(grant.resourceId);
      const machine = agent ? agentMachine(agent) : undefined;
      if (agent && (machine || isCommunicationAgent(agent))) {
        // Agent grants are the resource boundary; expose only safe host metadata, not the Computer as a managed resource.
        agentRows.set(agent.id, { ...normalizeAgentStatus(agent), access: accessFor("agent", agent.id), hostMachine: machine ? agentHostMachineSummary(machine) : undefined });
      }
    }
    const allChannels = db.prepare("select * from channels order by server_id, type, name").all().map(rowChannel);
    const baseChannelInSnapshotScope = (channel: ChannelRecord): boolean => {
      if (channel.type === "thread") return false;
      // Channel grants are no longer part of the public sharing model; conversations stay inside the active workspace.
      return (channel.serverId ?? "local") === serverId;
    };
    const baseChannels = allChannels.filter((channel) => baseChannelInSnapshotScope(channel) && canUserAccessChannel(viewer.id, channel.id));
    const baseChannelIds = new Set(baseChannels.map((channel) => channel.id));
    const channels = allChannels
      .filter((channel) => {
        if (channel.type === "thread" && channel.parentChannelId) {
          // Thread 可见性跟随 parent channel，避免跨 server 的个人 Agent membership 把历史 thread 带入当前工作区。
          return baseChannelIds.has(channel.parentChannelId) && canUserAccessChannel(viewer.id, channel.id);
        }
        return baseChannelIds.has(channel.id);
      });
    const channelIds = channels.map((channel) => channel.id);
    if (channelIds.length) {
      const placeholders = channelIds.map(() => "?").join(",");
      const remoteMemberAgentIds = db.prepare(
        `select distinct subject_id from channel_members
         where subject_type = 'agent' and left_at is null and channel_id in (${placeholders})`
      ).pluck().all(...channelIds) as string[];
      for (const agentId of remoteMemberAgentIds) {
        const agent = getAgent(agentId);
        if (!agent || agent.deletedAt) continue;
        const grantedAccess = accessFor("agent", agent.id);
        const belongsToCurrentServer = machineBelongsToCurrentServer(agent);
        // active server 是资源边界；跨 server 的自有 Agent 只能作为频道身份出现，不能恢复 owner 级资源权限。
        if (grantedAccess || ((agent.ownerUserId === viewer.id || hasWorkspaceAccess) && belongsToCurrentServer)) {
          const machine = agentMachine(agent);
          const hostMachine = grantedAccess && machine ? agentHostMachineSummary(machine) : undefined;
          agentRows.set(agent.id, agentRows.get(agent.id) ?? { ...normalizeAgentStatus(agent), access: grantedAccess, hostMachine });
        } else {
          agentRows.set(agent.id, agentRows.get(agent.id) ?? { ...normalizeAgentStatus(agent), access: { shared: true, scopes: [] } });
        }
      }
    }
    for (const agent of listAgents().filter((agent) => !isCommunicationAgent(agent) && currentServer?.ownerId === viewer.id && agent.ownerUserId === viewer.id && !agentHasMachine(agent))) {
      agentRows.set(agent.id, agentRows.get(agent.id) ?? { ...normalizeAgentStatus(agent), machineMissing: true });
    }
    const agents = Array.from(agentRows.values())
      .filter((agent) => isCommunicationAgent(agent) || agentHasMachine(agent) || agent.ownerUserId === viewer.id)
      .map((agent) => isCommunicationAgent(agent) || agentHasMachine(agent) ? { ...agent, machineMissing: undefined } : { ...agent, machineMissing: true })
      .map((agent) => sanitizeSharedAgent(agent))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const machineRowsById = new Map<string, MachineRecord>();
    if (hasWorkspaceAccess) {
      for (const machine of allMachineRows.filter((machine) => machine.serverId === serverId)) machineRowsById.set(machine.id, machine);
    }
    for (const grant of grants.filter((item) => item.resourceType === "machine" && item.scopes.includes("view"))) {
      const machine = getMachine(grant.resourceId);
      if (machine) machineRowsById.set(machine.id, { ...machine, access: accessFor("machine", machine.id) });
    }
    for (const agent of agents) {
      const machine = agentMachine(agent);
      const machineAccess = machine ? accessFor("machine", machine.id) : undefined;
      const machineBelongsToActiveServer = machine?.serverId === serverId;
      // Agent 可能只是当前频道里的身份对象；只有当前 server 内的 owner 资源或明确授权资源能带出 Computer 卡片。
      const shouldExposeMachine = Boolean(machine && ((machineBelongsToActiveServer && (machine.ownerUserId === viewer.id || agent.ownerUserId === viewer.id)) || machineAccess));
      if (machine && shouldExposeMachine && !machineRowsById.has(machine.id)) {
        const access = machine.ownerUserId === viewer.id && machineBelongsToActiveServer ? undefined : machineAccess ?? { shared: true, scopes: ["view"] as ResourceGrantScope[] };
        machineRowsById.set(machine.id, { ...machine, access });
      }
    }
    const machineRows = Array.from(machineRowsById.values()).map(sanitizeSharedMachine).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const placeholders = channelIds.map(() => "?").join(",");
    const machines = machineRows.map((machine) => {
      return {
        ...machine,
        connectorToken: undefined,
        latestDaemonVersion: LATEST_DAEMON_VERSION,
        runtimes: listRuntimeReports(machine.id),
        agents: agents.filter((agent) => agent.machineId === machine.id)
      };
    });
    const devices = listDevices(serverId)
      .filter((device) => !isLegacyMockDevice(device))
      .map((device) => ({ ...device, deviceToken: undefined }));
    const deviceGrants = listDeviceGrants({ serverId, activeOnly: true });
    const visibleDeviceIds = new Set(devices.map((device) => device.id));
    const deviceCommands = listDeviceCommands().filter((command) => visibleDeviceIds.has(command.deviceId)).slice(-200);
    const ownerVisibleAgentIds = agents.filter((agent) => !agent.access?.shared).map((agent) => agent.id);
    const runtimeApprovals = ownerVisibleAgentIds.length
      ? db.prepare(`select * from runtime_approvals where agent_id in (${ownerVisibleAgentIds.map(() => "?").join(",")}) order by requested_at desc limit 200`)
        .all(...ownerVisibleAgentIds)
        .map(rowRuntimeApproval)
        // Approval 卡片与 resolve API 共用同一个授权真源，避免展示 Human 永远无法处理的内部审批。
        .filter((approval) => canUserResolveRuntimeApproval(viewer.id, approval))
      : [];
    const runtimeExecutions = ownerVisibleAgentIds.length
      ? db.prepare(`select * from runtime_executions where agent_id in (${ownerVisibleAgentIds.map(() => "?").join(",")}) order by created_at desc limit 200`).all(...ownerVisibleAgentIds).map(rowRuntimeExecution)
      : [];
    const runtimeExecutionEvents = runtimeExecutions.length
      ? db.prepare(`select * from runtime_execution_events where execution_id in (${runtimeExecutions.map(() => "?").join(",")}) order by at asc, sequence asc limit 1000`).all(...runtimeExecutions.map((execution) => execution.id)).map(rowRuntimeExecutionEvent)
      : [];
    const agentRuns = ownerVisibleAgentIds.length
      ? db.prepare(`select * from agent_runs where agent_id in (${ownerVisibleAgentIds.map(() => "?").join(",")}) order by created_at desc limit 200`).all(...ownerVisibleAgentIds).map(rowAgentRun)
      : [];
    const executionGroupIds = [...new Set(agentRuns.map((run) => run.groupId))];
    const executionGroups = executionGroupIds.length
      ? db.prepare(`select * from execution_groups where id in (${executionGroupIds.map(() => "?").join(",")}) order by created_at desc limit 200`).all(...executionGroupIds).map(rowExecutionGroup)
      : [];
    const executionBlocks = executionGroupIds.length
      ? db.prepare(`select * from execution_blocks where group_id in (${executionGroupIds.map(() => "?").join(",")}) order by group_sequence asc limit 1000`).all(...executionGroupIds).map(rowExecutionBlock)
      : [];
    const executionArtifacts = executionGroupIds.length
      ? db.prepare(`select * from execution_artifacts where group_id in (${executionGroupIds.map(() => "?").join(",")}) order by created_at desc limit 200`).all(...executionGroupIds).map(rowExecutionArtifact)
      : [];
    const safetyAssessments = db.prepare("select * from safety_assessments where server_id = ? order by created_at desc limit 200").all(serverId).map(rowSafetyAssessment);
    const governanceDecisions = db.prepare("select * from governance_decisions where server_id = ? order by created_at desc limit 200").all(serverId).map(rowGovernanceDecision);
    const serverMembers = listServerMembers(serverId);
    const serverMemberById = new Map(serverMembers.map((human) => [human.id, human]));
    const visibleMemberHumanIds = new Set<string>();
    if (hasWorkspaceAccess) {
      for (const human of serverMembers) visibleMemberHumanIds.add(human.id);
    } else {
      // Guest 的 Members 面板只展示自己和 workspace owner；频道里的其他 human 仍作为聊天 identity 保留。
      visibleMemberHumanIds.add(viewer.id);
      for (const human of serverMembers.filter((item) => item.role === "owner")) visibleMemberHumanIds.add(human.id);
    }
    const humanIds = new Set<string>(visibleMemberHumanIds);
    for (const agent of agents) humanIds.add(agent.ownerUserId);
    for (const machine of machineRows) humanIds.add(machine.ownerUserId);
    if (channelIds.length) {
      const channelPlaceholders = channelIds.map(() => "?").join(",");
      for (const humanId of db.prepare(
        `select distinct subject_id from channel_members
         where subject_type = 'human' and left_at is null and channel_id in (${channelPlaceholders})`
      ).pluck().all(...channelIds) as string[]) {
        humanIds.add(humanId);
      }
    }
    const humans = Array.from(humanIds)
      .map((humanId) => db.prepare("select * from users where id = ?").get(humanId))
      .filter(Boolean)
      .map(rowUser)
      .map(({ id, name, displayName, email, description, avatarUrl, emailVerified, preferredLanguage, createdAt }) => ({
        id,
        name,
        displayName,
        email,
        description,
        avatarUrl,
        emailVerified,
        preferredLanguage,
        serverRole: serverMemberById.get(id)?.role,
        serverJoinedAt: serverMemberById.get(id)?.joinedAt,
        membershipVisible: visibleMemberHumanIds.has(id),
        createdAt
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const visibleResourceKeys = new Set<string>([
      ...machines.map((machine) => `machine:${machine.id}`),
      ...agents.map((agent) => `agent:${agent.id}`)
    ]);
    const resourceGrantSummaries = listResourceGrants({ activeOnly: true })
      .filter((grant) => visibleResourceKeys.has(`${grant.resourceType}:${grant.resourceId}`))
      .filter((grant) => {
        // Snapshot summaries are UI placement hints; only the owner/creator or the grantee may learn a grant exists.
        return grant.granteeUserId === viewer.id || grant.createdByUserId === viewer.id || getResourceOwnerUserId(grant.resourceType, grant.resourceId) === viewer.id;
      })
      .map(rowResourceGrantSummary)
      .filter((summary): summary is ResourceGrantSummary => Boolean(summary))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const communicationAgentPendingActions = channelIds.length
      ? (db.prepare(
        `select * from communication_agent_pending_actions
         where server_id = ? and user_id = ? and status = 'pending' and channel_id in (${placeholders})
         order by created_at`
      ).all(serverId, viewer.id, ...channelIds) as any[])
        .map(materializeCommunicationAgentPendingAction)
        .filter((action) => action.status === "pending")
      : [];
    return {
      currentUser: viewer,
      currentServer,
      machines,
      agents,
      humans,
      channels,
      conversations: channelIds.length
        ? db.prepare(`select * from conversations where channel_id in (${placeholders}) and archived_at is null order by coalesce(last_message_at, started_at) desc, started_at desc`).all(...channelIds).map(rowConversation)
        : [],
      messages: channelIds.length
        ? db.prepare(
          `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
           from messages join channels on channels.id = messages.channel_id
           where messages.channel_id in (${placeholders}) and messages.kind = 'chat'
           order by messages.created_at`
        ).all(...channelIds).map(rowMessage)
        : [],
      devices,
      deviceGrants,
      deviceAccessRules: deviceGrants,
      deviceCommands,
      tasks: channelIds.length
        ? db.prepare(
          `select tasks.*, agents.name as assignee_name, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type, thread.id as thread_channel_id
           from tasks
           left join agents on agents.id = tasks.assignee_agent_id
           join channels on channels.id = tasks.channel_id
           left join channels thread on thread.type = 'thread' and thread.parent_message_id = tasks.message_id
           where tasks.channel_id in (${placeholders})
           order by tasks.task_number`
        ).all(...channelIds).map(rowTask)
        : [],
      savedMessageIds: channelIds.length
        ? db.prepare(
          `select saved_messages.message_id
           from saved_messages
           join messages on messages.id = saved_messages.message_id
           where saved_messages.user_id = ? and messages.channel_id in (${placeholders})
           order by saved_messages.created_at desc`
        ).pluck().all(viewer.id, ...channelIds) as string[]
        : [],
      unreadCounts: Object.fromEntries(Object.entries(listUnreadCounts(viewer.id)).filter(([channelId]) => channelIds.includes(channelId))),
      reminders: ownerVisibleAgentIds.length
        ? db.prepare(`select * from reminders where owner_agent_id in (${ownerVisibleAgentIds.map(() => "?").join(",")}) order by fire_at`).all(...ownerVisibleAgentIds).map(rowReminder)
        : [],
      runtimeApprovals,
      runtimeExecutions,
      runtimeExecutionEvents,
      executionGroups,
      agentRuns,
      executionBlocks,
      executionArtifacts,
      communicationAgentPendingActions,
      safetyAssessments,
      governanceDecisions,
      resourceGrantSummaries,
      incomingServerInvites: listIncomingServerInvites(viewer.email ?? ""),
      workspaceBridges,
      incomingWorkspaceBridges,
      crossWorkspaceMessages: [],
      ...(hasWorkspaceAccess ? workspaceBridgeTopology(serverId) : { peerWorkspaceTopologies: [], workspaceBridgeTopologyEdges: [] })
    };
  }

  function createMachineKey(name = defaultMachineName(), ownerUserId = getDefaultUserId(), serverId = getActiveServerIdForUser(ownerUserId) ?? "local"): MachineRecord {
    const createdAt = nowIso();
    const machine: MachineRecord = {
      id: id("machine"),
      serverId,
      ownerUserId,
      name,
      hostname: "pending",
      os: "pending",
      daemonVersion: "pending",
      status: "offline",
      apiKey: apiKey(),
      createdAt,
      lastSeenAt: createdAt
    };
    db.prepare(
      `insert into machines (id, server_id, owner_user_id, name, hostname, os, daemon_version, status, api_key, created_at, last_seen_at)
       values (@id, @serverId, @ownerUserId, @name, @hostname, @os, @daemonVersion, @status, @apiKey, @createdAt, @lastSeenAt)`
    ).run(machine);
    return machine;
  }

  function getMachineByKey(key: string): MachineRecord | null {
    const now = nowIso();
    const row = db.prepare(
      `select * from machines
       where deleted_at is null
       and (
         (connector_token = ? and connector_token_revoked_at is null)
         or (pending_connector_token = ? and pending_connector_token_expires_at > ? and connector_token_revoked_at is null)
         or (previous_connector_token = ? and previous_connector_token_expires_at > ? and connector_token_revoked_at is null)
         or (api_key = ? and api_key_used_at is null and connector_token is null)
       )`
    ).get(key, key, now, key, now, key);
    return row ? rowMachine(row) : null;
  }

  function getMachineConnectCredential(machineId: string): MachineConnectCredential | null {
    const machine = getMachine(machineId);
    if (!isActiveMachine(machine)) return null;
    // apiKey 是一次性 bootstrap 凭证；签发 connector token 后，重连命令必须改用 connector token。
    if (machine.connectorToken && !machine.connectorTokenRevokedAt) {
      return { kind: "connectorToken", flag: "--connector-token", value: machine.connectorToken };
    }
    if (!machine.connectorToken && !machine.apiKeyUsedAt) {
      return { kind: "apiKey", flag: "--api-key", value: machine.apiKey };
    }
    return null;
  }

  function createMachineOnboardingIntent(input: {
    serverId: string;
    machineId: string;
    requestedByUserId: string;
    requestedByAgentId?: string | null;
    expiresAt?: string;
  }): { intent: MachineOnboardingIntentRecord; code: string } {
    const createdAt = nowIso();
    const code = token("tyr_onboard");
    const intent = {
      id: id("machine_onboard"),
      serverId: input.serverId,
      machineId: input.machineId,
      requestedByUserId: input.requestedByUserId,
      requestedByAgentId: input.requestedByAgentId ?? null,
      status: "pending" as const,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      consumedAt: null,
      revokedAt: null,
      createdAt
    };
    // Short-link tokens are bearer credentials, so only the hash is persisted.
    db.prepare(
      `insert into machine_onboarding_intents
        (id, server_id, machine_id, requested_by_user_id, requested_by_agent_id, onboarding_code_hash, status, expires_at, consumed_at, revoked_at, created_at)
       values (@id, @serverId, @machineId, @requestedByUserId, @requestedByAgentId, @onboardingCodeHash, @status, @expiresAt, null, null, @createdAt)`
    ).run({ ...intent, onboardingCodeHash: onboardingCodeHash(code) });
    return { intent, code };
  }

  function getMachineOnboardingIntentByCode(code: string): MachineOnboardingIntentRecord | null {
    const normalized = code.trim();
    if (!normalized) return null;
    const row = db.prepare("select * from machine_onboarding_intents where onboarding_code_hash = ?").get(onboardingCodeHash(normalized));
    return row ? rowMachineOnboardingIntent(row) : null;
  }

  function consumeMachineOnboardingIntent(code: string): { intent: MachineOnboardingIntentRecord; machine: MachineRecord; credential: MachineConnectCredential } | null {
    const normalized = code.trim();
    if (!normalized) return null;
    const hash = onboardingCodeHash(normalized);
    const tx = db.transaction(() => {
      const row = db.prepare(
        `select * from machine_onboarding_intents
         where onboarding_code_hash = ? and status = 'pending' and consumed_at is null and revoked_at is null and expires_at > ?`
      ).get(hash, nowIso()) as any;
      if (!row) return null;
      const machine = getMachine(row.machine_id);
      if (!isActiveMachine(machine) || machine.connectorToken || machine.apiKeyUsedAt) return null;
      const consumedAt = nowIso();
      db.prepare("update machine_onboarding_intents set status = 'consumed', consumed_at = ? where id = ? and status = 'pending'").run(consumedAt, row.id);
      const consumed = db.prepare("select * from machine_onboarding_intents where id = ?").get(row.id);
      return {
        intent: rowMachineOnboardingIntent(consumed),
        machine,
        credential: { kind: "apiKey" as const, flag: "--api-key" as const, value: machine.apiKey }
      };
    });
    return tx();
  }

  function revokeMachineOnboardingIntent(intentId: string, revokedByUserId: string): MachineOnboardingIntentRecord | null {
    const row = db.prepare("select * from machine_onboarding_intents where id = ? and requested_by_user_id = ?").get(intentId, revokedByUserId) as any;
    if (!row) return null;
    if (row.status !== "pending") return rowMachineOnboardingIntent(row);
    db.prepare("update machine_onboarding_intents set status = 'revoked', revoked_at = ? where id = ?").run(nowIso(), intentId);
    const updated = db.prepare("select * from machine_onboarding_intents where id = ?").get(intentId);
    return rowMachineOnboardingIntent(updated);
  }

  function setMachineConnectorToken(machineId: string, rotate = false): { machine: MachineRecord; connectorToken: string } | null {
    const current = getMachine(machineId);
    if (!isActiveMachine(current)) return null;
    const existing = !rotate && current.connectorToken && !current.connectorTokenRevokedAt ? current.connectorToken : null;
    const connectorToken = existing ?? token("tyr_connector");
    const issuedAt = current.connectorTokenIssuedAt && existing ? current.connectorTokenIssuedAt : nowIso();
    db.prepare(
      `update machines
       set connector_token = ?,
           connector_token_issued_at = ?,
           connector_token_revoked_at = null,
           api_key_used_at = coalesce(api_key_used_at, ?),
           last_seen_at = ?
       where id = ?`
    ).run(connectorToken, issuedAt, nowIso(), nowIso(), machineId);
    return { machine: getMachine(machineId)!, connectorToken };
  }

  function issueMachineConnectorToken(machineId: string): { machine: MachineRecord; connectorToken: string } | null {
    return setMachineConnectorToken(machineId, false);
  }

  function getPendingMachineConnectorTokenRotation(machineId: string): MachineConnectorTokenRotation | null {
    const row = db.prepare(
      `select pending_connector_token, pending_connector_token_rotation_id, pending_connector_token_expires_at
       from machines
       where id = ? and deleted_at is null and pending_connector_token is not null
         and pending_connector_token_rotation_id is not null and pending_connector_token_expires_at > ?`
    ).get(machineId, nowIso()) as any;
    const machine = row ? getMachine(machineId) : null;
    if (!row || !machine) return null;
    return {
      machine,
      connectorToken: row.pending_connector_token,
      rotationId: row.pending_connector_token_rotation_id,
      expiresAt: row.pending_connector_token_expires_at,
      reused: true
    };
  }

  function hasPendingMachineWork(machineId: string): boolean {
    // 运维门禁直接查存在性，不按历史分页截断，避免漏掉很早创建但仍活跃的执行或投递。
    const row = db.prepare(`select
      exists(select 1 from runtime_executions where machine_id = ? and status not in ('completed', 'failed', 'stalled', 'cancelled'))
      or exists(select 1 from runtime_approvals where machine_id = ? and status = 'pending')
      or exists(select 1 from agent_inbox i join agents a on a.id = i.agent_id where a.machine_id = ? and i.acked_at is null)
      as busy`).get(machineId, machineId, machineId) as { busy: number };
    return Boolean(row.busy);
  }

  function rotateMachineConnectorToken(machineId: string): MachineConnectorTokenRotation | null {
    const current = getMachine(machineId);
    if (!isActiveMachine(current)) return null;
    // 未过期的 pending rotation 必须复用，避免连续点击产生第三把并行凭据。
    const pending = getPendingMachineConnectorTokenRotation(machineId);
    if (pending) return pending;
    const issuedAt = nowIso();
    const expiresAt = new Date(Date.parse(issuedAt) + 24 * 60 * 60 * 1000).toISOString();
    const connectorToken = token("tyr_connector");
    const rotationId = id("connector_rotation");
    db.prepare(
      `update machines
       set pending_connector_token = ?,
           pending_connector_token_issued_at = ?,
           pending_connector_token_expires_at = ?,
           pending_connector_token_rotation_id = ?,
           connector_token_rotation_ack_at = null
       where id = ?`
    ).run(connectorToken, issuedAt, expiresAt, rotationId, machineId);
    return { machine: getMachine(machineId)!, connectorToken, rotationId, expiresAt, reused: false };
  }

  function acknowledgeMachineConnectorTokenRotation(machineId: string, rotationId: string): MachineConnectorTokenRotationAck | null {
    const normalizedRotationId = rotationId.trim();
    if (!normalizedRotationId) return null;
    const tx = db.transaction(() => {
      const row = db.prepare("select * from machines where id = ? and deleted_at is null").get(machineId) as any;
      if (!row || row.pending_connector_token_rotation_id !== normalizedRotationId) return null;
      if (row.connector_token_rotation_ack_at && !row.pending_connector_token) {
        return { machine: rowMachine(row), rotationId: normalizedRotationId, state: "already_promoted" as const };
      }
      const acknowledgedAt = nowIso();
      if (!row.pending_connector_token || !row.pending_connector_token_expires_at || row.pending_connector_token_expires_at <= acknowledgedAt) {
        return null;
      }
      const previousExpiresAt = row.connector_token
        ? new Date(Date.parse(acknowledgedAt) + 24 * 60 * 60 * 1000).toISOString()
        : null;
      // ACK 之后才原子提升 pending；旧 current 进入 24 小时宽限，避免短暂断线或并发重连造成掉线。
      db.prepare(
        `update machines
         set previous_connector_token = connector_token,
             previous_connector_token_expires_at = ?,
             connector_token = pending_connector_token,
             connector_token_issued_at = pending_connector_token_issued_at,
             connector_token_revoked_at = null,
             pending_connector_token = null,
             pending_connector_token_issued_at = null,
             pending_connector_token_expires_at = null,
             connector_token_rotation_ack_at = ?,
             api_key_used_at = coalesce(api_key_used_at, ?)
         where id = ?`
      ).run(previousExpiresAt, acknowledgedAt, acknowledgedAt, machineId);
      return { machine: getMachine(machineId)!, rotationId: normalizedRotationId, state: "promoted" as const };
    });
    return tx();
  }

  function revokeMachineConnectorToken(machineId: string): MachineRecord | null {
    if (!isActiveMachine(getMachine(machineId))) return null;
    // 撤销必须同时清掉 pending/previous，保证不存在仍可认证的旁路凭据。
    db.prepare(
      `update machines
       set connector_token_revoked_at = ?,
           pending_connector_token = null,
           pending_connector_token_issued_at = null,
           pending_connector_token_expires_at = null,
           pending_connector_token_rotation_id = null,
           previous_connector_token = null,
           previous_connector_token_expires_at = null,
           connector_token_rotation_ack_at = null,
           last_seen_at = ?
       where id = ?`
    ).run(nowIso(), nowIso(), machineId);
    return getMachine(machineId);
  }

  function updateMachineName(machineId: string, name: string): MachineRecord | null {
    const trimmed = name.trim();
    if (!trimmed || !isActiveMachine(getMachine(machineId))) return null;
    db.prepare("update machines set name = ? where id = ?").run(trimmed, machineId);
    return getMachine(machineId);
  }

  function bindMachineInstallation(machineId: string, input: { installationId?: string; hostFingerprint?: string }): MachineInstallationBindingResult | null {
    const current = getMachine(machineId);
    if (!isActiveMachine(current)) return null;
    const installationId = input.installationId?.trim() || undefined;
    const hostFingerprint = input.hostFingerprint?.trim() || undefined;
    if (current.installationId && installationId && current.installationId !== installationId) {
      // installationId 来自 daemon data-dir；不同值说明 connector token 被复制到另一个安装实例。
      return {
        success: false,
        reason: "installation_mismatch",
        machine: current,
        currentInstallationId: current.installationId,
        receivedInstallationId: installationId
      };
    }
    const nextInstallationId = current.installationId ?? installationId ?? null;
    const nextHostFingerprint = hostFingerprint ?? current.hostFingerprint ?? null;
    db.prepare(
      `update machines
       set installation_id = ?,
           host_fingerprint = ?,
           last_seen_at = ?
       where id = ?`
    ).run(nextInstallationId, nextHostFingerprint, nowIso(), machineId);
    const machine = getMachine(machineId);
    return machine ? { success: true, machine } : null;
  }

  function updateMachineReady(machineId: string, ready: {
    hostname: string;
    os: string;
    daemonVersion: string;
    runtimes: RuntimeId[];
    runtimeVersions?: Record<string, string>;
    runtimeReports?: RuntimeReport[];
    runtimeMarker?: string;
    runtimeSha?: string;
    runtimeMarkerMtime?: string;
  }): MachineRecord {
    if (!isActiveMachine(getMachine(machineId))) throw new Error("machine_not_found");
    const lastSeenAt = nowIso();
    const existingReports = new Map(listRuntimeReports(machineId).map((report) => [report.runtime, report]));
    db.prepare(
      `update machines
       set hostname = ?,
           os = ?,
           daemon_version = ?,
           runtime_marker = ?,
           runtime_sha = ?,
           runtime_marker_mtime = ?,
           status = 'online',
           last_seen_at = ?
       where id = ?`
    ).run(
      ready.hostname,
      ready.os,
      ready.daemonVersion,
      ready.runtimeMarker ?? null,
      ready.runtimeSha ?? null,
      ready.runtimeMarkerMtime ?? null,
      lastSeenAt,
      machineId
    );
    db.prepare("delete from machine_runtime_reports where machine_id = ?").run(machineId);
    const incomingReports = new Map((ready.runtimeReports ?? []).map((report) => [report.runtime, report]));
    const insert = db.prepare(
      `insert into machine_runtime_reports (
         machine_id, runtime, display_name, binary, command, version, status, reason, checked_at,
         install_status, auth_status, cli_status, mcp_status, mcp_tool_surface, read_only_enforcement,
         hidden_mcp_tools, diagnostics, models, default_model, updated_at
       )
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const runtime of RUNTIMES) {
      const incoming = incomingReports.get(runtime.id);
      const status = incoming?.status ?? (ready.runtimes.includes(runtime.id) ? "available" : "unavailable");
      const existing = existingReports.get(runtime.id);
      // Preserve cached model choices for installed runtimes while letting daemon own health diagnostics.
      const models = status === "available" ? incoming?.models ?? existing?.models : null;
      const defaultModel = status === "available" ? incoming?.defaultModel ?? existing?.defaultModel : null;
      insert.run(
        machineId,
        runtime.id,
        incoming?.displayName ?? runtime.displayName,
        incoming?.binary ?? runtime.binary,
        incoming?.command ?? null,
        incoming?.version ?? ready.runtimeVersions?.[runtime.id],
        status,
        incoming?.reason ?? null,
        incoming?.checkedAt ?? lastSeenAt,
        incoming?.installStatus ?? (status === "available" ? "installed" : "missing"),
        incoming?.authStatus ?? "unknown",
        incoming?.cliStatus ?? (status === "available" ? "available" : "unavailable"),
        incoming?.mcpStatus ?? "unknown",
        incoming?.mcpToolSurface ?? null,
        incoming?.readOnlyEnforcement ?? null,
        stringify((incoming?.hiddenMcpTools ?? []) as JsonValue),
        stringify((incoming?.diagnostics ?? []) as JsonValue),
        stringifyRuntimeModels(models ?? undefined),
        defaultModel,
        lastSeenAt
      );
    }
    return getMachine(machineId)!;
  }

  function updateRuntimeModels(machineId: string, runtime: RuntimeId, models: RuntimeModel[], defaultModel?: string): RuntimeReport | null {
    if (!isActiveMachine(getMachine(machineId))) return null;
    const definition = RUNTIMES.find((item) => item.id === runtime);
    if (!definition) return null;
    const previous = listRuntimeReports(machineId).find((report) => report.runtime === runtime);
    const updatedAt = nowIso();
    db.prepare(
      `insert into machine_runtime_reports (machine_id, runtime, display_name, binary, version, status, models, default_model, updated_at)
       values (?, ?, ?, ?, ?, 'available', ?, ?, ?)
       on conflict(machine_id, runtime) do update set
         display_name = excluded.display_name,
         binary = excluded.binary,
         status = 'available',
         models = excluded.models,
         default_model = excluded.default_model,
         updated_at = excluded.updated_at`
    ).run(machineId, runtime, definition.displayName, definition.binary, previous?.version, stringifyRuntimeModels(models), defaultModel ?? null, updatedAt);
    return listRuntimeReports(machineId).find((report) => report.runtime === runtime) ?? null;
  }

  function updateRuntimeAuthStatus(machineId: string, runtime: RuntimeId, authStatus: RuntimeAuthStatus, reason?: string): RuntimeReport | null {
    if (!isActiveMachine(getMachine(machineId))) return null;
    const updatedAt = nowIso();
    const normalizedReason = reason?.trim() || null;
    db.prepare(
      `update machine_runtime_reports
       set auth_status = ?,
           reason = coalesce(?, reason),
           checked_at = ?,
           updated_at = ?
       where machine_id = ? and runtime = ?`
    ).run(authStatus, normalizedReason, updatedAt, updatedAt, machineId, runtime);
    return listRuntimeReports(machineId).find((report) => report.runtime === runtime) ?? null;
  }

  function touchMachineLastSeen(machineId: string): MachineRecord | null {
    if (!isActiveMachine(getMachine(machineId))) return null;
    // 心跳只证明当前 daemon socket 仍活着，不改变业务在线状态，避免旧连接把离线机器重新点亮。
    db.prepare("update machines set last_seen_at = ? where id = ?").run(nowIso(), machineId);
    return getMachine(machineId);
  }

  function markMachineOffline(machineId: string): void {
    const updatedAt = nowIso();
    db.prepare("update machines set status = 'offline', last_seen_at = ? where id = ? and deleted_at is null").run(updatedAt, machineId);
    // daemon 断开后，本机 runtime 已不可调度，运行态 Agent 需要同步降级，避免前台误判仍在线。
    db.prepare("update agents set status = 'offline', updated_at = ? where machine_id = ? and deleted_at is null and status in ('online', 'working')").run(updatedAt, machineId);
  }

  function createAgent(input: CreateAgentInput, ownerUserId = getDefaultUserId()): AgentRecord {
    const machine = getMachine(input.machineId);
    if (!machine) throw new Error("machine_not_found");
    if (machine.deletedAt) throw new Error("machine_deleted");
    const serverRole = listServersForUser(ownerUserId).find((item) => item.id === (machine.serverId ?? "local"))?.role;
    // Workspace Owner 可在同 Workspace 的共享 Computer 上创建 Agent；Member 仍必须是 Computer owner。
    if (machine.ownerUserId !== ownerUserId && serverRole !== "owner") throw new Error("machine_owner_required");
    const createdAt = nowIso();
    const displayName = input.name.trim();
    const runtimeResourceGrants = normalizeRuntimeResourceGrants(input.runtimeResourceGrants ?? []);
    const agent: AgentRecord = {
      id: id("agent"),
      serverId: machine.serverId ?? "local",
      kind: "on_device",
      ownerUserId,
      createdByUserId: input.createdByUserId ?? ownerUserId,
      creationBridgeRequestId: input.creationBridgeRequestId ?? null,
      creationTraceId: input.creationTraceId ?? null,
      machineId: input.machineId,
      name: slugifyName(displayName),
      displayName,
      description: input.description?.trim() || undefined,
      profileRevision: 1,
      profileAppliedRevision: 0,
      runtime: input.runtime,
      model: input.model || undefined,
      reasoningEffort: input.reasoningEffort ?? "medium",
      permissionMode: input.permissionMode ?? DEFAULT_RUNTIME_PERMISSION_MODE,
      ...(runtimeResourceGrants.length ? { runtimeResourceGrants } : {}),
      status: "offline",
      desiredRuntimeState: "running",
      authToken: apiKey(),
      createdAt,
      updatedAt: createdAt
    };
    db.prepare(
      `insert into agents
       (id, server_id, kind, owner_user_id, created_by_user_id, creation_bridge_request_id, creation_trace_id, machine_id, name, display_name, description, profile_revision, profile_applied_revision, runtime, model, reasoning_effort, permission_mode, runtime_resource_grants, env_vars, status, desired_runtime_state, auth_token, created_at, updated_at)
       values (@id, @serverId, @kind, @ownerUserId, @createdByUserId, @creationBridgeRequestId, @creationTraceId, @machineId, @name, @displayName, @description, @profileRevision, @profileAppliedRevision, @runtime, @model, @reasoningEffort, @permissionMode, @runtimeResourceGrants, @envVars, @status, @desiredRuntimeState, @authToken, @createdAt, @updatedAt)`
    ).run({ ...agent, runtimeResourceGrants: stringify(runtimeResourceGrants as unknown as JsonValue[]), envVars: stringify((input.envVars ?? {}) as JsonValue) });
    recordActivity(agent.id, "created", `Agent ${agent.displayName} created with ${agent.runtime}.`);
    return agent;
  }

  function createCommunicationAgent(serverId = "local", ownerUserId?: string): AgentRecord {
    const server = db.prepare("select owner_user_id from servers where id = ?").get(serverId) as { owner_user_id?: string } | undefined;
    const createdAt = nowIso();
    const agent: AgentRecord = {
      id: id("agent"),
      serverId,
      kind: "communication",
      ownerUserId: ownerUserId ?? server?.owner_user_id ?? getDefaultUserId(),
      machineId: null,
      name: DEFAULT_COMMUNICATION_AGENT_NAME,
      displayName: DEFAULT_COMMUNICATION_AGENT_DISPLAY_NAME,
      description: COMMUNICATION_AGENT_DESCRIPTION,
      profileRevision: 1,
      profileAppliedRevision: 1,
      runtime: null,
      permissionMode: DEFAULT_RUNTIME_PERMISSION_MODE,
      status: "online",
      desiredRuntimeState: "running",
      authToken: apiKey(),
      createdAt,
      updatedAt: createdAt
    };
    db.prepare(
      `insert into agents
       (id, server_id, kind, owner_user_id, machine_id, name, display_name, description, profile_revision, profile_applied_revision, runtime, model, reasoning_effort, permission_mode, runtime_resource_grants, env_vars, status, desired_runtime_state, auth_token, created_at, updated_at)
       values (@id, @serverId, @kind, @ownerUserId, @machineId, @name, @displayName, @description, @profileRevision, @profileAppliedRevision, @runtime, null, null, @permissionMode, '[]', '{}', @status, @desiredRuntimeState, @authToken, @createdAt, @updatedAt)`
    ).run(agent);
    db.prepare("update servers set onboarding_agent_id = ? where id = ?").run(agent.id, serverId);
    // Communication Agent 是 workspace 的 server-hosted 身份，不创建 channel membership，也不绑定任何 daemon。
    recordActivity(agent.id, "created", "Communication Agent created as workspace message hub.");
    return agent;
  }

  function ensureDefaultCommunicationAgent(serverId = "local"): AgentRecord {
    const server = db.prepare("select owner_user_id, onboarding_agent_id from servers where id = ?").get(serverId) as { owner_user_id?: string; onboarding_agent_id?: string | null } | undefined;
    const existingByPointer = server?.onboarding_agent_id ? getAgent(server.onboarding_agent_id) : null;
    if (existingByPointer && isCommunicationAgent(existingByPointer) && !existingByPointer.deletedAt) return existingByPointer;

    const existing = listAgents(serverId, { includeDeleted: false }).find((agent) => isCommunicationAgent(agent));
    if (existing) {
      db.prepare("update servers set onboarding_agent_id = ? where id = ?").run(existing.id, serverId);
      return existing;
    }
    return createCommunicationAgent(serverId, server?.owner_user_id ?? getDefaultUserId());
  }

  function getAgent(agentId: string): AgentRecord | null {
    const row = db.prepare("select * from agents where id = ?").get(agentId);
    return row ? rowAgent(row) : null;
  }

  function isActiveAgent(agent: AgentRecord | null | undefined): agent is AgentRecord {
    return Boolean(agent && !agent.deletedAt);
  }

  function isActiveMachine(machine: MachineRecord | null | undefined): machine is MachineRecord {
    return Boolean(machine && !machine.deletedAt);
  }

  function getAgentByToken(token: string): AgentRecord | null {
    const row = db.prepare(
      `select agents.*
       from agents
       join machines on machines.id = agents.machine_id
       where agents.auth_token = ?
         and agents.deleted_at is null
         and machines.deleted_at is null`
    ).get(token);
    return row ? rowAgent(row) : null;
  }

  function updateAgentStatus(agentId: string, status: AgentRecord["status"], detail?: string): void {
    if (!isActiveAgent(getAgent(agentId))) return;
    const updatedAt = nowIso();
    const lastError = detail?.trim() || null;
    if (status === "error") {
      // Error detail 是 daemon/runtime 给人的诊断文本，需要随 agent 状态持久化，刷新后仍能看到原因。
      db.prepare("update agents set status = ?, last_error = ?, updated_at = ? where id = ?").run(status, lastError, updatedAt, agentId);
    } else if (status === "online" || status === "working") {
      // 成功恢复后清掉旧错误，避免历史失败继续污染当前健康状态。
      db.prepare("update agents set status = ?, last_error = null, updated_at = ? where id = ?").run(status, updatedAt, agentId);
    } else {
      db.prepare("update agents set status = ?, updated_at = ? where id = ?").run(status, updatedAt, agentId);
    }
    recordActivity(agentId, status, detail ?? `Status changed to ${status}.`);
  }

  function setAgentDesiredRuntimeState(agentId: string, state: NonNullable<AgentRecord["desiredRuntimeState"]>): AgentRecord | null {
    const current = getAgent(agentId);
    if (!isActiveAgent(current)) return null;
    // desired state 只表达用户/运维意图；daemon 心跳和断线只能改 observed status，不能覆盖它。
    db.prepare("update agents set desired_runtime_state = ?, updated_at = ? where id = ?")
      .run(state, nowIso(), agentId);
    return getAgent(agentId);
  }

  function updateAgentLaunch(agentId: string, launchId: string): void {
    if (!isActiveAgent(getAgent(agentId))) return;
    // launchId 是 runtime 状态事件的代际边界，start 下发后立即持久化才能拒绝旧进程迟到事件。
    db.prepare("update agents set launch_id = ?, updated_at = ? where id = ?").run(launchId, nowIso(), agentId);
  }

  function updateAgentSession(agentId: string, sessionId: string, launchId?: string, workspacePath?: string): void {
    if (!isActiveAgent(getAgent(agentId))) return;
    if (workspacePath !== undefined) {
      db.prepare("update agents set session_id = ?, launch_id = ?, workspace_path = ?, updated_at = ? where id = ?").run(sessionId, launchId ?? null, workspacePath, nowIso(), agentId);
    } else {
      db.prepare("update agents set session_id = ?, launch_id = ?, updated_at = ? where id = ?").run(sessionId, launchId ?? null, nowIso(), agentId);
    }
    recordActivity(agentId, "session", `Runtime session ${sessionId} attached${workspacePath ? ` at ${workspacePath}` : ""}.`);
  }

  function clearAgentSession(agentId: string, detail = "Runtime session cleared."): AgentRecord | null {
    const current = getAgent(agentId);
    if (!isActiveAgent(current)) return null;
    db.prepare("update agents set session_id = null, launch_id = null, updated_at = ? where id = ?").run(nowIso(), agentId);
    recordActivity(agentId, "session", detail);
    return getAgent(agentId);
  }

  function resetAgentRuntimeSessions(agentId: string, detail = "Agent reset requested; next runtime start will create a fresh session."): { agent: AgentRecord; invalidatedSessions: AgentRuntimeSessionRecord[] } | null {
    return db.transaction(() => {
      // Agent Reset 同时清理 P0 全局指针并使全部 P1 current generation 失效，调用方不会看到半套 reset 状态。
      const agent = clearAgentSession(agentId, detail);
      if (!agent) return null;
      const invalidatedSessions = invalidateAgentRuntimeSessions({ agentId, detail });
      return { agent, invalidatedSessions };
    })();
  }

  function updateAgentProfile(agentId: string, input: { displayName?: string; description?: string; avatarUrl?: string }): AgentRecord | null {
    return db.transaction(() => {
      const current = getAgent(agentId);
      if (!isActiveAgent(current)) return null;
      const displayName = input.displayName?.trim() || current.displayName;
      const name = input.displayName ? slugifyName(displayName) : current.name;
      const hasDescription = Object.prototype.hasOwnProperty.call(input, "description");
      const description = hasDescription ? input.description ?? null : current.description ?? null;
      // Agent 自身更新名称或描述同样会改变服务端 Profile 真源，必须产生新版本等待 Runtime 应用。
      const profileChanged = name !== current.name || displayName !== current.displayName || description !== (current.description ?? null);
      db.prepare(
        `update agents
         set name = ?, display_name = ?, description = ?, avatar_url = ?,
             profile_revision = profile_revision + ?,
             profile_apply_error = case when ? = 1 then null else profile_apply_error end,
             updated_at = ?
         where id = ?`
      ).run(name, displayName, description, input.avatarUrl ?? current.avatarUrl ?? null, Number(profileChanged), Number(profileChanged), nowIso(), agentId);
      if (profileChanged) {
        // Developer Instructions 属于 vendor Session 的创建配置；旧 Session 不能通过 resume 获得新身份。
        invalidateAgentRuntimeSessions({ agentId, detail: "Agent Profile Prompt changed; the next Runtime context must start a fresh Session." });
      }
      return getAgent(agentId);
    })();
  }

  function updateAgentConfiguration(agentId: string, input: UpdateAgentConfigurationInput): AgentRecord | null {
    return db.transaction(() => {
      const current = getAgent(agentId);
      if (!isActiveAgent(current)) return null;
      const hasDescription = Object.prototype.hasOwnProperty.call(input, "description");
      const hasModel = Object.prototype.hasOwnProperty.call(input, "model");
      const nextName = input.name ?? current.name;
      const nextDisplayName = input.displayName ?? current.displayName;
      const nextDescription = hasDescription ? input.description ?? null : current.description ?? null;
      // Profile revision 只跟身份/职责真源变化；Model 和 Runtime Access 仍使用既有运行时重启语义。
      const profileChanged = nextName !== current.name || nextDisplayName !== current.displayName || nextDescription !== (current.description ?? null);
      // 单条 UPDATE 保证多个已校验配置同时生效，避免调用方看到半套新配置。
      db.prepare(
        `update agents
         set name = ?, display_name = ?, description = ?, model = ?, permission_mode = ?,
             profile_revision = profile_revision + ?,
             profile_apply_error = case when ? = 1 then null else profile_apply_error end,
             updated_at = ?
         where id = ?`
      ).run(
        nextName,
        nextDisplayName,
        nextDescription,
        hasModel ? input.model ?? null : current.model ?? null,
        input.permissionMode ?? current.permissionMode ?? DEFAULT_RUNTIME_PERMISSION_MODE,
        Number(profileChanged),
        Number(profileChanged),
        nowIso(),
        agentId
      );
      if (profileChanged) {
        // Profile 与上下文 Session 在同一事务换代，不能让下一条消息再次拿到旧 Developer Instructions。
        invalidateAgentRuntimeSessions({ agentId, detail: "Agent Profile Prompt changed; the next Runtime context must start a fresh Session." });
      }
      return getAgent(agentId);
    })();
  }

  function updateAgentProfileApplication(agentId: string, input: { profileRevision: number; error?: string | null }): AgentRecord | null {
    const current = getAgent(agentId);
    if (!isActiveAgent(current)) return null;
    const currentRevision = current.profileRevision ?? 1;
    const appliedRevision = current.profileAppliedRevision ?? 0;
    const reportedRevision = Math.max(0, Math.floor(input.profileRevision));
    if (!Number.isFinite(reportedRevision) || reportedRevision > currentRevision) return current;
    if (input.error) {
      // 迟到的旧版本失败不能把已经保存的新版本标成 Failed。
      if (reportedRevision !== currentRevision) return current;
      db.prepare("update agents set profile_apply_error = ?, updated_at = ? where id = ?")
        .run(input.error.slice(0, 4000), nowIso(), agentId);
      return getAgent(agentId);
    }
    // ACK 可推进已应用版本，但只有当前版本 ACK 才能清除当前失败信息。
    db.prepare(
      `update agents
       set profile_applied_revision = ?,
           profile_apply_error = case when ? = profile_revision then null else profile_apply_error end,
           updated_at = ?
       where id = ?`
    ).run(Math.max(appliedRevision, reportedRevision), reportedRevision, nowIso(), agentId);
    return getAgent(agentId);
  }

  function updateAgentPermissionMode(agentId: string, permissionMode: RuntimePermissionMode): AgentRecord | null {
    if (!isActiveAgent(getAgent(agentId))) return null;
    db.prepare("update agents set permission_mode = ?, updated_at = ? where id = ?").run(permissionMode, nowIso(), agentId);
    recordActivity(agentId, "permission", `Runtime permission mode set to ${permissionMode}.`);
    return getAgent(agentId);
  }

  function updateAgentRuntimeResourceGrants(agentId: string, grants: RuntimeResourceGrant[]): AgentRecord | null {
    if (!isActiveAgent(getAgent(agentId))) return null;
    const normalized = normalizeRuntimeResourceGrants(grants);
    db.prepare("update agents set runtime_resource_grants = ?, updated_at = ? where id = ?").run(stringify(normalized as unknown as JsonValue[]), nowIso(), agentId);
    recordActivity(agentId, "permission", `Runtime resource grants set to ${normalized.length} item(s).`);
    return getAgent(agentId);
  }

  function getAgentScopes(agentId: string): AgentScopes | null {
    if (!getAgent(agentId)) return null;
    const row = db.prepare("select * from agent_scopes where agent_id = ?").get(agentId);
    return row ? rowAgentScopes(row) : defaultAgentScopes(agentId);
  }

  function setAgentScopes(agentId: string, granted: AgentCapability[]): AgentScopes | null {
    if (!isActiveAgent(getAgent(agentId))) return null;
    const ordered = AGENT_ACTIVE_CAPABILITIES.filter((capability) => granted.includes(capability));
    const existing = db.prepare("select revision from agent_scopes where agent_id = ?").get(agentId) as { revision?: number } | undefined;
    const revision = Number(existing?.revision ?? 0) + 1;
    const updatedAt = nowIso();
    // 保存后变成 custom，表示该 agent 不再自动继承后续新增的默认 capability。
    db.prepare(
      `insert into agent_scopes (agent_id, granted, mode, revision, updated_at)
       values (?, ?, 'custom', ?, ?)
       on conflict(agent_id) do update set
         granted = excluded.granted,
         mode = 'custom',
         revision = excluded.revision,
         updated_at = excluded.updated_at`
    ).run(agentId, stringify(ordered as JsonValue[]), revision, updatedAt);
    recordActivity(agentId, "permission", `Agent capabilities updated to revision ${revision}.`);
    return getAgentScopes(agentId);
  }

  function resetAgentScopes(agentId: string): AgentScopes | null {
    if (!isActiveAgent(getAgent(agentId))) return null;
    // 删除 custom 记录后回到 default 模式，后续新增默认 capability 会自动对该 agent 生效。
    db.prepare("delete from agent_scopes where agent_id = ?").run(agentId);
    recordActivity(agentId, "permission", "Agent capabilities reset to default.");
    return getAgentScopes(agentId);
  }

  function hasAgentCapability(agentId: string, capability: AgentCapability): boolean {
    if (!isActiveAgent(getAgent(agentId))) return false;
    return Boolean(getAgentScopes(agentId)?.granted.includes(capability));
  }

  function getAgentRuntimeEnvVars(agentId: string): Record<string, string> {
    if (!isActiveAgent(getAgent(agentId))) return {};
    const row = db.prepare("select env_vars from agents where id = ?").get(agentId) as { env_vars?: string | null } | undefined;
    const parsed = parseJson<Record<string, unknown>>(row?.env_vars, {});
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string")) as Record<string, string>;
  }

  function deleteAgent(agentId: string): boolean {
    const agent = getAgent(agentId);
    if (!agent) return false;
    const tx = db.transaction(() => {
      deleteAgentRows(agentId);
    });
    tx();
    return true;
  }

  function deleteAgentRows(agentId: string): void {
    // Product delete removes the Agent from active collaboration surfaces.
    // The row remains as a historical actor so messages and execution audit remain readable.
    const deletedAt = nowIso();
    const singleAgentDmIds = (db.prepare(
      `select channels.id
       from channels
       join channel_members deleted_member on deleted_member.channel_id = channels.id
       where channels.type = 'dm'
       and deleted_member.subject_type = 'agent'
       and deleted_member.subject_id = ?
       and deleted_member.left_at is null
       and (
         select count(*)
         from channel_members active_agents
         where active_agents.channel_id = channels.id
         and active_agents.subject_type = 'agent'
         and active_agents.left_at is null
       ) = 1`
    ).all(agentId) as Array<{ id: string }>).map((row) => row.id);
    if (singleAgentDmIds.length > 0) {
      const placeholders = singleAgentDmIds.map(() => "?").join(",");
      // 单 Agent DM 的 peer 被删除后不再是可进入的聊天对象；只关闭 membership，保留 channel/message 历史用于审计。
      db.prepare(`update channel_members set left_at = coalesce(left_at, ?) where channel_id in (${placeholders}) and left_at is null`).run(deletedAt, ...singleAgentDmIds);
    }
    db.prepare("update tasks set assignee_agent_id = null where assignee_agent_id = ?").run(agentId);
    db.prepare("update servers set onboarding_agent_id = null where onboarding_agent_id = ?").run(agentId);
    db.prepare("delete from resource_grants where resource_type = 'agent' and resource_id = ?").run(agentId);
    for (const row of db.prepare("select server_id, sidebar_order_json from server_settings where sidebar_order_json is not null").all() as Array<{ server_id: string; sidebar_order_json?: string | null }>) {
      const current = defaultSidebarOrderSettings(parseJson<Partial<SidebarOrderSettings>>(row.sidebar_order_json, {}));
      const next = defaultSidebarOrderSettings({
        ...current,
        agentOrder: current.agentOrder.filter((id) => id !== agentId),
        pinnedAgentIds: current.pinnedAgentIds.filter((id) => id !== agentId),
        pinnedOrder: current.pinnedOrder.filter((id) => id !== agentId)
      });
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        db.prepare("update server_settings set sidebar_order_json = ?, updated_at = ? where server_id = ?").run(JSON.stringify(next), nowIso(), row.server_id);
      }
    }
    db.prepare("delete from channel_members where subject_type = 'agent' and subject_id = ?").run(agentId);
    db.prepare("delete from thread_follows where subject_type = 'agent' and subject_id = ?").run(agentId);
    db.prepare(
      `update agents
       set deleted_at = coalesce(deleted_at, ?),
           status = 'offline',
           updated_at = ?
       where id = ?`
    ).run(deletedAt, deletedAt, agentId);
  }

  function deleteMachine(machineId: string): { success: boolean; reason?: string; deletedAgents?: number } {
    const machine = getMachine(machineId);
    if (!machine) return { success: false, reason: "machine_not_found" };
    const agentCount = (db.prepare("select count(*) from agents where machine_id = ? and deleted_at is null").pluck().get(machineId) as number | bigint | undefined) ?? 0;
    // Computer 是 Agent 的执行宿主；删除宿主前必须显式处理 Agent，避免误删长期身份和权限配置。
    if (Number(agentCount) > 0) return { success: false, reason: "machine_has_agents", deletedAgents: Number(agentCount) };
    const tx = db.transaction(() => {
      const deletedAt = nowIso();
      db.prepare("update machines set deleted_at = coalesce(deleted_at, ?), status = 'offline', last_seen_at = ? where id = ?").run(deletedAt, deletedAt, machineId);
      return 0;
    });
    const deletedAgents = tx();
    return { success: true, deletedAgents };
  }

  function recordActivity(agentId: string, kind: string, text: string): void {
    db.prepare("insert into agent_activity (agent_id, at, kind, text) values (?, ?, ?, ?)").run(agentId, nowIso(), kind, text);
  }

  function listActivity(agentId: string): Array<{ at: string; kind: string; text: string }> {
    return db.prepare("select at, kind, text from agent_activity where agent_id = ? order by at desc limit 100").all(agentId) as Array<{ at: string; kind: string; text: string }>;
  }

  function listAgentActivityMessages(userId: string, agentId: string, limit = 500): MessageRecord[] {
    const agent = getAgent(agentId);
    if (!agent) return [];
    const visibleChannelIds = listVisibleChannelIds(userId);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (visibleChannelIds.length > 0) {
      clauses.push(`(messages.kind = 'chat' and messages.sender_type = 'agent' and messages.sender_id = ? and messages.channel_id in (${visibleChannelIds.map(() => "?").join(",")}))`);
      params.push(agentId, ...visibleChannelIds);
    }
    if (agent.ownerUserId === userId) {
      clauses.push("(messages.kind = 'delegation' and messages.sender_type = 'agent' and messages.sender_id = ?)");
      params.push(agentId);
      clauses.push("(messages.kind = 'delegation' and runtime_executions.agent_id = ?)");
      params.push(agentId);
    }
    if (clauses.length === 0) return [];
    const max = Math.max(1, Math.min(limit, 1000));
    const rows = db.prepare(
      `select distinct messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
       from messages
       join channels on channels.id = messages.channel_id
       left join runtime_executions on runtime_executions.message_id = messages.id
       where ${clauses.join(" or ")}
       order by messages.created_at desc, messages.seq desc
       limit ?`
    ).all(...params, max);
    return rows.map(rowMessage);
  }

  function createRuntimeApproval(input: RuntimeApprovalRecord): RuntimeApprovalRecord {
    // 审批记录归 server 真源；daemon 只暂停 runtime 并等待这里的决策结果。
    db.prepare(
      `insert or replace into runtime_approvals
       (id, server_id, machine_id, agent_id, execution_id, task_id, message_id, thread_channel_id, runtime, launch_id, request_id, method, kind, title, detail, payload, status, decision, custom_response, requested_at, resolved_at, resolved_by_user_id)
       values (@id, @serverId, @machineId, @agentId, @executionId, @taskId, @messageId, @threadChannelId, @runtime, @launchId, @requestId, @method, @kind, @title, @detail, @payload, @status, @decision, @customResponse, @requestedAt, @resolvedAt, @resolvedByUserId)`
    ).run({
      ...input,
      serverId: input.serverId ?? null,
      executionId: input.executionId ?? null,
      taskId: input.taskId ?? null,
      messageId: input.messageId ?? null,
      threadChannelId: input.threadChannelId ?? null,
      launchId: input.launchId ?? null,
      payload: stringify(input.payload as JsonValue | undefined),
      decision: input.decision ?? null,
      customResponse: input.customResponse ?? null,
      resolvedAt: input.resolvedAt ?? null,
      resolvedByUserId: input.resolvedByUserId ?? null
    });
    return getRuntimeApproval(input.id)!;
  }

  function executionActorSnapshot(agentId: string, machineId: string): ExecutionActorSnapshot {
    const agent = getAgent(agentId);
    const machine = getMachine(machineId);
    return {
      agentName: agent?.name,
      agentDisplayName: agent?.displayName,
      agentOwnerUserId: agent?.ownerUserId,
      machineName: machine?.name,
      machineHostname: machine?.hostname,
      machineOwnerUserId: machine?.ownerUserId
    };
  }

  function getAgentRuntimeSession(sessionRecordId: string): AgentRuntimeSessionRecord | null {
    const row = db.prepare("select * from agent_runtime_sessions where id = ?").get(sessionRecordId);
    return row ? rowAgentRuntimeSession(row) : null;
  }

  function listAgentRuntimeSessions(filter: { agentId?: string; machineId?: string; runtime?: RuntimeId; contextKey?: string; status?: AgentRuntimeSessionStatus } = {}): AgentRuntimeSessionRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.agentId) {
      clauses.push("agent_id = ?");
      params.push(filter.agentId);
    }
    if (filter.machineId) {
      clauses.push("machine_id = ?");
      params.push(filter.machineId);
    }
    if (filter.runtime) {
      clauses.push("runtime = ?");
      params.push(filter.runtime);
    }
    if (filter.contextKey) {
      clauses.push("context_key = ?");
      params.push(filter.contextKey);
    }
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    const where = clauses.length ? ` where ${clauses.join(" and ")}` : "";
    return db.prepare(`select * from agent_runtime_sessions${where} order by last_used_at desc, generation desc`).all(...params).map(rowAgentRuntimeSession);
  }

  function getCurrentAgentRuntimeSession(input: AgentRuntimeSessionIdentity): AgentRuntimeSessionRecord | null {
    const profileRevision = getAgent(input.agentId)?.profileRevision ?? 1;
    const row = db.prepare(
      `select * from agent_runtime_sessions
       where server_id = ? and agent_id = ? and machine_id = ? and runtime = ?
         and context_kind = ? and context_id = ? and context_key = ?
         and profile_revision = ?
         and status in ('pending', 'ready')
       order by generation desc
       limit 1`
    ).get(input.serverId, input.agentId, input.machineId, input.runtime, input.contextKind, input.contextId, input.contextKey, profileRevision);
    return row ? rowAgentRuntimeSession(row) : null;
  }

  function getOrCreateAgentRuntimeSession(input: AgentRuntimeSessionIdentity & { executionId?: string; launchId?: string }): AgentRuntimeSessionRecord {
    return db.transaction(() => {
      const current = getCurrentAgentRuntimeSession(input);
      const usedAt = nowIso();
      if (current) {
        // dispatch 重试必须复用 current generation，不能为同一 context 制造并行 Session。
        db.prepare(
          `update agent_runtime_sessions
           set first_execution_id = coalesce(first_execution_id, ?),
               last_execution_id = coalesce(?, last_execution_id),
               last_launch_id = coalesce(?, last_launch_id),
               last_used_at = ?, updated_at = ?
           where id = ?`
        ).run(input.executionId ?? null, input.executionId ?? null, input.launchId ?? null, usedAt, usedAt, current.id);
        return getAgentRuntimeSession(current.id)!;
      }
      const profileRevision = getAgent(input.agentId)?.profileRevision ?? 1;
      // 升级前或异常路径留下的旧 Profile Session 要在创建新 generation 前释放 current 唯一槽位。
      db.prepare(
        `update agent_runtime_sessions
         set status = 'invalidated',
             last_error = coalesce(last_error, ?), invalidated_at = ?, updated_at = ?
         where agent_id = ? and machine_id = ? and runtime = ? and context_key = ?
           and status in ('pending', 'ready') and profile_revision <> ?`
      ).run(
        `Superseded by Agent Profile Prompt revision ${profileRevision}.`,
        usedAt,
        usedAt,
        input.agentId,
        input.machineId,
        input.runtime,
        input.contextKey,
        profileRevision
      );
      const generation = Number(db.prepare(
        `select coalesce(max(generation), 0) from agent_runtime_sessions
         where agent_id = ? and machine_id = ? and runtime = ? and context_key = ?`
      ).pluck().get(input.agentId, input.machineId, input.runtime, input.contextKey) ?? 0) + 1;
      const recordId = id("ars");
      db.prepare(
        `insert into agent_runtime_sessions
         (id, server_id, agent_id, machine_id, runtime, context_kind, context_id, context_key, profile_revision, generation,
          runtime_session_id, status, last_launch_id, first_execution_id, last_execution_id, last_error,
          created_at, updated_at, last_used_at, invalidated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, 'pending', ?, ?, ?, null, ?, ?, ?, null)`
      ).run(
        recordId,
        input.serverId,
        input.agentId,
        input.machineId,
        input.runtime,
        input.contextKind,
        input.contextId,
        input.contextKey,
        profileRevision,
        generation,
        input.launchId ?? null,
        input.executionId ?? null,
        input.executionId ?? null,
        usedAt,
        usedAt,
        usedAt
      );
      return getAgentRuntimeSession(recordId)!;
    })();
  }

  function prepareRuntimeExecutionSession(input: AgentRuntimeSessionIdentity & { executionId: string; launchId?: string }): { session: AgentRuntimeSessionRecord; execution: RuntimeExecutionRecord } | null {
    return db.transaction(() => {
      const execution = getRuntimeExecution(input.executionId);
      // dispatch 只允许给创建时已固化同一 actor/context 的 execution 分配 Session。
      if (
        !execution ||
        ["completed", "failed", "cancelled", "stalled"].includes(execution.status) ||
        execution.serverId !== input.serverId ||
        execution.agentId !== input.agentId ||
        execution.machineId !== input.machineId ||
        execution.runtime !== input.runtime ||
        execution.runtimeContextKey !== input.contextKey
      ) return null;
      const session = getOrCreateAgentRuntimeSession(input);
      const boundExecution = bindRuntimeExecutionSession({
        executionId: execution.id,
        sessionRecordId: session.id,
        contextKey: session.contextKey,
        generation: session.generation,
        runtimeSessionId: session.runtimeSessionId
      });
      return boundExecution ? { session, execution: boundExecution } : null;
    })();
  }

  function bindAgentRuntimeSession(input: AgentRuntimeSessionCas & { runtimeSessionId: string; executionId?: string; launchId?: string }): AgentRuntimeSessionRecord | null {
    const runtimeSessionId = input.runtimeSessionId.trim();
    if (!runtimeSessionId) return null;
    return db.transaction(() => {
      const conflict = db.prepare(
        `select id from agent_runtime_sessions
         where machine_id = ? and runtime = ? and runtime_session_id = ? and status = 'ready' and id <> ?`
      ).get(input.machineId, input.runtime, runtimeSessionId, input.sessionRecordId);
      if (conflict) return null;
      const usedAt = nowIso();
      const result = db.prepare(
        `update agent_runtime_sessions
         set runtime_session_id = ?, status = 'ready', last_launch_id = coalesce(?, last_launch_id),
             first_execution_id = coalesce(first_execution_id, ?), last_execution_id = coalesce(?, last_execution_id),
             last_error = null, invalidated_at = null, last_used_at = ?, updated_at = ?
         where id = ? and server_id = ? and agent_id = ? and machine_id = ? and runtime = ?
           and context_kind = ? and context_id = ? and context_key = ? and generation = ?
           and status in ('pending', 'ready') and (runtime_session_id is null or runtime_session_id = ?)`
      ).run(
        runtimeSessionId,
        input.launchId ?? null,
        input.executionId ?? null,
        input.executionId ?? null,
        usedAt,
        usedAt,
        input.sessionRecordId,
        input.serverId,
        input.agentId,
        input.machineId,
        input.runtime,
        input.contextKind,
        input.contextId,
        input.contextKey,
        input.generation,
        runtimeSessionId
      );
      return result.changes === 1 ? getAgentRuntimeSession(input.sessionRecordId) : null;
    })();
  }

  function markAgentRuntimeSessionFailed(input: AgentRuntimeSessionCas & { error: string; executionId?: string; launchId?: string }): AgentRuntimeSessionRecord | null {
    const failedAt = nowIso();
    const result = db.prepare(
      `update agent_runtime_sessions
       set status = 'failed', last_error = ?, last_launch_id = coalesce(?, last_launch_id),
           last_execution_id = coalesce(?, last_execution_id), invalidated_at = ?, last_used_at = ?, updated_at = ?
       where id = ? and server_id = ? and agent_id = ? and machine_id = ? and runtime = ?
         and context_kind = ? and context_id = ? and context_key = ? and generation = ?
         and status in ('pending', 'ready')`
    ).run(
      input.error.slice(0, 4000),
      input.launchId ?? null,
      input.executionId ?? null,
      failedAt,
      failedAt,
      failedAt,
      input.sessionRecordId,
      input.serverId,
      input.agentId,
      input.machineId,
      input.runtime,
      input.contextKind,
      input.contextId,
      input.contextKey,
      input.generation
    );
    return result.changes === 1 ? getAgentRuntimeSession(input.sessionRecordId) : null;
  }

  function replaceAgentRuntimeSession(input: AgentRuntimeSessionCas & { error: string; executionId: string; launchId?: string }): AgentRuntimeSessionRecord | null {
    return db.transaction(() => {
      const execution = getRuntimeExecution(input.executionId);
      // replacement 会终止旧 generation；必须先证明目标 execution 属于同一 actor/context，避免失败请求留下半完成状态。
      if (
        !execution ||
        execution.serverId !== input.serverId ||
        execution.agentId !== input.agentId ||
        execution.machineId !== input.machineId ||
        execution.runtime !== input.runtime ||
        execution.runtimeContextKey !== input.contextKey
      ) return null;
      const alreadyReplaced = getCurrentAgentRuntimeSession(input);
      if (
        alreadyReplaced &&
        alreadyReplaced.generation === input.generation + 1 &&
        alreadyReplaced.firstExecutionId === input.executionId
      ) return alreadyReplaced;
      const failed = markAgentRuntimeSessionFailed(input);
      if (!failed) return null;
      const replacement = getOrCreateAgentRuntimeSession({
        serverId: input.serverId,
        agentId: input.agentId,
        machineId: input.machineId,
        runtime: input.runtime,
        contextKind: input.contextKind,
        contextId: input.contextId,
        contextKey: input.contextKey,
        executionId: input.executionId,
        launchId: input.launchId
      });
      if (replacement.generation !== input.generation + 1) return null;
      const rebound = bindRuntimeExecutionSession({
        executionId: input.executionId,
        sessionRecordId: replacement.id,
        contextKey: input.contextKey,
        generation: replacement.generation
      });
      return rebound ? replacement : null;
    })();
  }

  function touchAgentRuntimeSession(input: AgentRuntimeSessionCas & { executionId?: string; launchId?: string }): AgentRuntimeSessionRecord | null {
    const usedAt = nowIso();
    const result = db.prepare(
      `update agent_runtime_sessions
       set last_launch_id = coalesce(?, last_launch_id), last_execution_id = coalesce(?, last_execution_id),
           last_used_at = ?, updated_at = ?
       where id = ? and server_id = ? and agent_id = ? and machine_id = ? and runtime = ?
         and context_kind = ? and context_id = ? and context_key = ? and generation = ?
         and status in ('pending', 'ready')`
    ).run(
      input.launchId ?? null,
      input.executionId ?? null,
      usedAt,
      usedAt,
      input.sessionRecordId,
      input.serverId,
      input.agentId,
      input.machineId,
      input.runtime,
      input.contextKind,
      input.contextId,
      input.contextKey,
      input.generation
    );
    return result.changes === 1 ? getAgentRuntimeSession(input.sessionRecordId) : null;
  }

  function invalidateAgentRuntimeSessions(input: { agentId: string; machineId?: string; runtime?: RuntimeId; contextKey?: string; detail?: string }): AgentRuntimeSessionRecord[] {
    const clauses = ["agent_id = ?", "status in ('pending', 'ready')"];
    const params: unknown[] = [input.agentId];
    if (input.machineId) {
      clauses.push("machine_id = ?");
      params.push(input.machineId);
    }
    if (input.runtime) {
      clauses.push("runtime = ?");
      params.push(input.runtime);
    }
    if (input.contextKey) {
      clauses.push("context_key = ?");
      params.push(input.contextKey);
    }
    const rows = db.prepare(`select id from agent_runtime_sessions where ${clauses.join(" and ")}`).all(...params) as Array<{ id: string }>;
    if (rows.length === 0) return [];
    const invalidatedAt = nowIso();
    const ids = rows.map((row) => row.id);
    db.prepare(
      `update agent_runtime_sessions
       set status = 'invalidated', last_error = coalesce(?, last_error), invalidated_at = ?, updated_at = ?
       where id in (${ids.map(() => "?").join(",")})`
    ).run(input.detail?.slice(0, 4000) ?? null, invalidatedAt, invalidatedAt, ...ids);
    return ids.map((sessionId) => getAgentRuntimeSession(sessionId)).filter((session): session is AgentRuntimeSessionRecord => Boolean(session));
  }

  function createRuntimeExecution(input: Omit<RuntimeExecutionRecord, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): RuntimeExecutionRecord {
    const existing = getRuntimeExecution(input.id);
    // context 是 execution 的审计快照；同一 execution id 的兼容重放不得把它改到另一个 DM/Thread。
    if (existing && existing.runtimeContextKey !== input.runtimeContextKey) {
      throw new Error("runtime_execution_context_immutable");
    }
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? createdAt;
    const actorSnapshot = executionActorSnapshot(input.agentId, input.machineId);
    db.prepare(
      `insert or replace into runtime_executions
       (id, server_id, machine_id, agent_id, agent_name, agent_display_name, agent_owner_user_id, machine_name, machine_hostname, machine_owner_user_id, task_id, message_id, thread_channel_id, runtime, launch_id, runtime_context_key, runtime_session_record_id, runtime_session_id, runtime_session_generation, source_execution_id, return_to_agent_id, root_message_id, hop_count, expect_reply, return_message_id, return_execution_id, return_dispatched_at, communication_return_channel_id, communication_return_conversation_id, communication_return_source_message_id, communication_return_user_id, communication_return_source, communication_return_external_ref, communication_return_instructions, communication_return_instructions_revision, communication_return_message_id, communication_return_dispatched_at, controller_actor_mode, status, created_at, updated_at, completed_at)
       values (@id, @serverId, @machineId, @agentId, @agentName, @agentDisplayName, @agentOwnerUserId, @machineName, @machineHostname, @machineOwnerUserId, @taskId, @messageId, @threadChannelId, @runtime, @launchId, @runtimeContextKey, @runtimeSessionRecordId, @runtimeSessionId, @runtimeSessionGeneration, @sourceExecutionId, @returnToAgentId, @rootMessageId, @hopCount, @expectReply, @returnMessageId, @returnExecutionId, @returnDispatchedAt, @communicationReturnChannelId, @communicationReturnConversationId, @communicationReturnSourceMessageId, @communicationReturnUserId, @communicationReturnSource, @communicationReturnExternalRef, @communicationReturnInstructions, @communicationReturnInstructionsRevision, @communicationReturnMessageId, @communicationReturnDispatchedAt, @controllerActorMode, @status, @createdAt, @updatedAt, @completedAt)`
    ).run({
      ...input,
      serverId: input.serverId ?? null,
      agentName: input.agentName ?? actorSnapshot.agentName ?? null,
      agentDisplayName: input.agentDisplayName ?? actorSnapshot.agentDisplayName ?? null,
      agentOwnerUserId: input.agentOwnerUserId ?? actorSnapshot.agentOwnerUserId ?? null,
      machineName: input.machineName ?? actorSnapshot.machineName ?? null,
      machineHostname: input.machineHostname ?? actorSnapshot.machineHostname ?? null,
      machineOwnerUserId: input.machineOwnerUserId ?? actorSnapshot.machineOwnerUserId ?? null,
      taskId: input.taskId ?? null,
      threadChannelId: input.threadChannelId ?? null,
      launchId: input.launchId ?? null,
      runtimeContextKey: input.runtimeContextKey ?? null,
      runtimeSessionRecordId: input.runtimeSessionRecordId ?? null,
      runtimeSessionId: input.runtimeSessionId ?? null,
      runtimeSessionGeneration: input.runtimeSessionGeneration ?? null,
      sourceExecutionId: input.sourceExecutionId ?? null,
      returnToAgentId: input.returnToAgentId ?? null,
      rootMessageId: input.rootMessageId ?? null,
      hopCount: input.hopCount ?? null,
      expectReply: input.expectReply === undefined ? null : input.expectReply ? 1 : 0,
      returnMessageId: input.returnMessageId ?? null,
      returnExecutionId: input.returnExecutionId ?? null,
      returnDispatchedAt: input.returnDispatchedAt ?? null,
      communicationReturnChannelId: input.communicationReturnChannelId ?? null,
      communicationReturnConversationId: input.communicationReturnConversationId ?? null,
      communicationReturnSourceMessageId: input.communicationReturnSourceMessageId ?? null,
      communicationReturnUserId: input.communicationReturnUserId ?? null,
      communicationReturnSource: input.communicationReturnSource ?? null,
      communicationReturnExternalRef: input.communicationReturnExternalRef ?? null,
      communicationReturnInstructions: input.communicationReturnInstructions ?? null,
      communicationReturnInstructionsRevision: input.communicationReturnInstructionsRevision ?? null,
      communicationReturnMessageId: input.communicationReturnMessageId ?? null,
      communicationReturnDispatchedAt: input.communicationReturnDispatchedAt ?? null,
      // 同一 execution 的兼容重放不能清除已经分配的原身/分身身份。
      controllerActorMode: input.controllerActorMode ?? existing?.controllerActorMode ?? null,
      createdAt,
      updatedAt,
      completedAt: input.completedAt ?? null
    });
    return getRuntimeExecution(input.id)!;
  }

  function getRuntimeExecution(executionId: string): RuntimeExecutionRecord | null {
    const row = db.prepare("select * from runtime_executions where id = ?").get(executionId);
    return row ? rowRuntimeExecution(row) : null;
  }

  function listRuntimeExecutions(filter: { executionId?: string; sourceExecutionId?: string; taskId?: string; messageId?: string; threadChannelId?: string; serverId?: string; agentId?: string; limit?: number } = {}): RuntimeExecutionRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.executionId) {
      clauses.push("id = ?");
      params.push(filter.executionId);
    }
    if (filter.sourceExecutionId) {
      clauses.push("source_execution_id = ?");
      params.push(filter.sourceExecutionId);
    }
    if (filter.messageId) {
      clauses.push("message_id = ?");
      params.push(filter.messageId);
    }
    if (filter.taskId) {
      clauses.push("task_id = ?");
      params.push(filter.taskId);
    }
    if (filter.threadChannelId) {
      clauses.push("thread_channel_id = ?");
      params.push(filter.threadChannelId);
    }
    if (filter.serverId) {
      clauses.push("server_id = ?");
      params.push(filter.serverId);
    }
    if (filter.agentId) {
      clauses.push("agent_id = ?");
      params.push(filter.agentId);
    }
    const where = clauses.length ? ` where ${clauses.join(" and ")}` : "";
    const limit = Math.max(1, Math.min(filter.limit ?? 200, 1000));
    return db.prepare(`select * from runtime_executions${where} order by created_at desc limit ?`).all(...params, limit).map(rowRuntimeExecution);
  }

  function listTopologyRuntimeExecutions(input: { serverId: string; activeUpdatedAfter: string; terminalUpdatedAfter: string; limit?: number }): RuntimeExecutionRecord[] {
    const limit = Math.max(1, Math.min(input.limit ?? 1000, 1000));
    return db.prepare(
      `select *
       from runtime_executions
       where server_id = ?
         and (
           (status in ('queued', 'delivered', 'running', 'waiting_approval') and updated_at >= ?)
           or
           (status in ('completed', 'failed', 'stalled', 'cancelled') and updated_at >= ?)
         )
       order by updated_at desc
       limit ?`
    ).all(input.serverId, input.activeUpdatedAfter, input.terminalUpdatedAfter, limit).map(rowRuntimeExecution);
  }

  function listTopologyRuntimeExecutionEvents(executionIds: string[]): RuntimeExecutionEventRecord[] {
    const scopedExecutionIds = Array.from(new Set(executionIds.filter(Boolean))).slice(0, 1_000);
    if (scopedExecutionIds.length === 0) return [];
    const phaseKinds: RuntimeExecutionEventKind[] = [
      "queued",
      "delivered",
      "delivery_acknowledged",
      "turn_started",
      "thinking",
      "assistant_output",
      "tool_call",
      "tool_output",
      "approval_request",
      "approval_resolved",
      "turn_completed",
      "error"
    ];
    const executionPlaceholders = scopedExecutionIds.map(() => "?").join(",");
    const kindPlaceholders = phaseKinds.map(() => "?").join(",");
    // Topology 需要每种可见阶段的最新事件，以及当前 public thinking 的有限 delta 窗口；不会读取完整 execution 历史。
    return db.prepare(
      `with ranked_events as (
         select runtime_execution_events.*,
                row_number() over (partition by execution_id order by sequence desc) as execution_rank,
                row_number() over (partition by execution_id, kind order by sequence desc) as kind_rank
         from runtime_execution_events
         where execution_id in (${executionPlaceholders})
       )
       select *
       from ranked_events
       where execution_rank = 1
          or (kind_rank = 1 and kind in (${kindPlaceholders}))
          or (kind = 'thinking' and kind_rank <= 24)
       order by execution_id, sequence`
    ).all(...scopedExecutionIds, ...phaseKinds).map(rowRuntimeExecutionEvent);
  }

  function listRuntimeExecutionsForMessageIds(messageIds: string[], ownerUserId: string, limit = 1000): RuntimeExecutionRecord[] {
    const scopedMessageIds = Array.from(new Set(messageIds.filter(Boolean)));
    if (scopedMessageIds.length === 0 || !ownerUserId) return [];
    const placeholders = scopedMessageIds.map(() => "?").join(",");
    const max = Math.max(1, Math.min(limit, 1000));
    // 消息页 summary 只暴露当前用户拥有的 Agent execution，权限过滤下推到 SQL，避免 route 层逐条查 Agent。
    return db.prepare(
      `select runtime_executions.*
       from runtime_executions
       join agents on agents.id = runtime_executions.agent_id
       where (runtime_executions.message_id in (${placeholders}) or runtime_executions.root_message_id in (${placeholders}))
         and agents.owner_user_id = ?
       order by runtime_executions.created_at desc limit ?`
    ).all(...scopedMessageIds, ...scopedMessageIds, ownerUserId, max).map(rowRuntimeExecution);
  }

  function listChildRuntimeExecutionsForSourceIds(sourceExecutionIds: string[], limit = 1000): RuntimeExecutionRecord[] {
    const scopedSourceExecutionIds = Array.from(new Set(sourceExecutionIds.filter(Boolean)));
    if (scopedSourceExecutionIds.length === 0) return [];
    const placeholders = scopedSourceExecutionIds.map(() => "?").join(",");
    const max = Math.max(1, Math.min(limit, 1000));
    return db.prepare(
      `select runtime_executions.*
       from runtime_executions
       where runtime_executions.source_execution_id in (${placeholders})
       order by runtime_executions.created_at desc limit ?`
    ).all(...scopedSourceExecutionIds, max).map(rowRuntimeExecution);
  }

  function latestRuntimeExecutionForTask(taskId: string): RuntimeExecutionRecord | null {
    const row = db.prepare("select * from runtime_executions where task_id = ? order by created_at desc limit 1").get(taskId);
    return row ? rowRuntimeExecution(row) : null;
  }

  function latestRuntimeExecutionForMessage(agentId: string, messageId: string): RuntimeExecutionRecord | null {
    const row = db.prepare("select * from runtime_executions where agent_id = ? and message_id = ? order by created_at desc limit 1").get(agentId, messageId);
    return row ? rowRuntimeExecution(row) : null;
  }

  function attachRuntimeExecutionToTask(executionId: string, taskId: string): RuntimeExecutionRecord | null {
    const task = taskByIdOrMessageId(taskId);
    if (!task) return null;
    db.prepare(
      `update runtime_executions
       set task_id = ?, thread_channel_id = coalesce(thread_channel_id, ?), updated_at = ?
       where id = ?`
    ).run(task.id, task.threadChannelId ?? null, nowIso(), executionId);
    db.prepare(
      `update runtime_execution_events
       set task_id = ?
       where execution_id = ? and task_id is null`
    ).run(task.id, executionId);
    return getRuntimeExecution(executionId);
  }

  function bindRuntimeExecutionSession(input: { executionId: string; sessionRecordId: string; contextKey: string; generation: number; runtimeSessionId?: string }): RuntimeExecutionRecord | null {
    const execution = getRuntimeExecution(input.executionId);
    const session = getAgentRuntimeSession(input.sessionRecordId);
    if (!execution || !session || !execution.runtimeContextKey) return null;
    // execution 与 Session 的 actor/context 快照必须完全一致，避免仅凭可猜测的记录 ID 越界绑定。
    if (
      execution.serverId !== session.serverId ||
      execution.agentId !== session.agentId ||
      execution.machineId !== session.machineId ||
      execution.runtime !== session.runtime ||
      execution.runtimeContextKey !== input.contextKey ||
      session.contextKey !== input.contextKey ||
      session.generation !== input.generation ||
      !["pending", "ready"].includes(session.status) ||
      (input.runtimeSessionId !== undefined && session.runtimeSessionId !== input.runtimeSessionId)
    ) return null;
    const updatedAt = nowIso();
    const result = db.prepare(
      `update runtime_executions
       set runtime_session_record_id = ?, runtime_session_id = ?, runtime_session_generation = ?, updated_at = ?
       where id = ? and runtime_context_key = ?`
    ).run(
      session.id,
      input.runtimeSessionId ?? session.runtimeSessionId ?? null,
      session.generation,
      updatedAt,
      execution.id,
      input.contextKey
    );
    return result.changes === 1 ? getRuntimeExecution(execution.id) : null;
  }

  function updateRuntimeExecutionStatus(executionId: string, status: RuntimeExecutionStatus, options: { launchId?: string } = {}): RuntimeExecutionRecord | null {
    const terminalStatuses = new Set<RuntimeExecutionStatus>(["completed", "failed", "cancelled", "stalled"]);
    const update = db.transaction(() => {
      const current = getRuntimeExecution(executionId);
      if (!current) return null;

      // Execution 终态不可逆。迟到 runtime event、审批结果或重放只能读取终态，不能重新打开执行。
      if (!terminalStatuses.has(current.status)) {
        const updatedAt = nowIso();
        const completedAt = terminalStatuses.has(status) ? updatedAt : null;
        db.prepare(
          `update runtime_executions
           set status = ?, launch_id = coalesce(?, launch_id), updated_at = ?, completed_at = ?
           where id = ?`
        ).run(status, options.launchId ?? null, updatedAt, completedAt, executionId);
      }

      const settled = getRuntimeExecution(executionId);
      if (settled && terminalStatuses.has(settled.status)) {
        const resolvedAt = nowIso();
        // 只有依赖活跃 runtime 的审批随 execution 终态失效；server 持久化的 outbound action 可在 turn 结束后独立重放。
        db.prepare(
          `update runtime_approvals
           set status = 'rejected',
               decision = 'reject',
               custom_response = 'Execution ended before this approval was resolved.',
               resolved_at = ?,
               resolved_by_user_id = 'system_execution_terminal'
           where execution_id = ?
             and status = 'pending'
             and method not like 'governance/outbound/%'`
        ).run(resolvedAt, executionId);
      }
      return settled;
    });
    return update();
  }

  function attachRuntimeExecutionRootMessage(executionId: string, rootMessageId: string): RuntimeExecutionRecord | null {
    const updatedAt = nowIso();
    db.prepare(
      `update runtime_executions
       set root_message_id = coalesce(root_message_id, ?),
           updated_at = ?
       where id = ?`
    ).run(rootMessageId, updatedAt, executionId);
    return getRuntimeExecution(executionId);
  }

  function markRuntimeExecutionReturnDispatched(executionId: string, input: { returnMessageId: string; returnExecutionId: string }): RuntimeExecutionRecord | null {
    const dispatchedAt = nowIso();
    db.prepare(
      `update runtime_executions
       set return_message_id = ?,
           return_execution_id = ?,
           return_dispatched_at = ?,
           updated_at = ?
       where id = ?`
    ).run(input.returnMessageId, input.returnExecutionId, dispatchedAt, dispatchedAt, executionId);
    return getRuntimeExecution(executionId);
  }

  function markRuntimeExecutionCommunicationReturnDispatched(executionId: string, input: { communicationReturnMessageId: string }): RuntimeExecutionRecord | null {
    const dispatchedAt = nowIso();
    db.prepare(
      `update runtime_executions
       set communication_return_message_id = ?,
           communication_return_dispatched_at = ?,
           updated_at = ?
       where id = ?
         and communication_return_message_id is null`
    ).run(input.communicationReturnMessageId, dispatchedAt, dispatchedAt, executionId);
    return getRuntimeExecution(executionId);
  }

  function appendRuntimeExecutionEvent(input: Omit<RuntimeExecutionEventRecord, "id" | "sequence" | "at"> & { id?: string; sequence?: number; at?: string }): RuntimeExecutionEventRecord {
    const sequence = input.sequence ?? Number((db.prepare("select coalesce(max(sequence), 0) + 1 from runtime_execution_events where execution_id = ?").pluck().get(input.executionId) as number | bigint | undefined) ?? 1);
    const event = {
      id: input.id ?? id("exec_event"),
      executionId: input.executionId,
      agentId: input.agentId,
      taskId: input.taskId ?? null,
      kind: input.kind,
      sequence,
      title: input.title ?? null,
      detail: input.detail ?? null,
      payload: stringify(input.payload as JsonValue | undefined),
      at: input.at ?? nowIso()
    };
    db.prepare(
      `insert into runtime_execution_events
       (id, execution_id, agent_id, task_id, kind, sequence, title, detail, payload, at)
       values (@id, @executionId, @agentId, @taskId, @kind, @sequence, @title, @detail, @payload, @at)`
    ).run(event);
    db.prepare("update runtime_executions set updated_at = ? where id = ?").run(event.at, input.executionId);
    return rowRuntimeExecutionEvent({
      id: event.id,
      execution_id: event.executionId,
      agent_id: event.agentId,
      task_id: event.taskId,
      kind: event.kind,
      sequence: event.sequence,
      title: event.title,
      detail: event.detail,
      payload: event.payload,
      at: event.at
    });
  }

  function listRuntimeExecutionEvents(executionId: string): RuntimeExecutionEventRecord[] {
    return db.prepare("select * from runtime_execution_events where execution_id = ? order by sequence").all(executionId).map(rowRuntimeExecutionEvent);
  }

  function findFinalMessageForExecution(executionId: string): MessageRecord | null {
    const events = db.prepare(
      `select * from runtime_execution_events
       where execution_id = ?
       order by sequence desc`
    ).all(executionId).map(rowRuntimeExecutionEvent);
    for (const event of events) {
      const payload = event.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
      const finalMessageId = (payload as Record<string, unknown>).finalMessageId;
      if (typeof finalMessageId !== "string" || !finalMessageId.trim()) continue;
      const message = getMessage(finalMessageId);
      if (message) return message;
    }
    return null;
  }

  function executionGroupCompletedAt(status: ExecutionGroupStatus, fallback: string): string | null {
    return status === "completed" || status === "failed" || status === "cancelled" ? fallback : null;
  }

  function agentRunCompletedAt(status: AgentRunStatus, fallback: string): string | null {
    return status === "completed" || status === "failed" || status === "cancelled" ? fallback : null;
  }

  function nextExecutionGroupSequence(groupId: string): number {
    return Number((db.prepare("select coalesce(max(group_sequence), 0) + 1 from execution_blocks where group_id = ?").pluck().get(groupId) as number | bigint | undefined) ?? 1);
  }

  function nextAgentRunSequence(runId: string): number {
    return Number((db.prepare("select coalesce(max(run_sequence), 0) + 1 from execution_blocks where run_id = ?").pluck().get(runId) as number | bigint | undefined) ?? 1);
  }

  function ensureExecutionGroup(input: Omit<ExecutionGroupRecord, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): ExecutionGroupRecord {
    const existing = getExecutionGroup(input.id);
    if (existing) return existing;
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? createdAt;
    db.prepare(
      `insert into execution_groups
       (id, server_id, task_id, message_id, thread_channel_id, status, title, created_by_user_id, created_at, updated_at, completed_at)
       values (@id, @serverId, @taskId, @messageId, @threadChannelId, @status, @title, @createdByUserId, @createdAt, @updatedAt, @completedAt)`
    ).run({
      ...input,
      taskId: input.taskId ?? null,
      messageId: input.messageId ?? null,
      threadChannelId: input.threadChannelId ?? null,
      createdByUserId: input.createdByUserId ?? null,
      createdAt,
      updatedAt,
      completedAt: input.completedAt ?? executionGroupCompletedAt(input.status, updatedAt)
    });
    return getExecutionGroup(input.id)!;
  }

  function getExecutionGroup(id: string): ExecutionGroupRecord | null {
    const row = db.prepare("select * from execution_groups where id = ?").get(id);
    return row ? rowExecutionGroup(row) : null;
  }

  function listExecutionGroups(filter: { serverId?: string; taskId?: string; messageId?: string; threadChannelId?: string; limit?: number } = {}): ExecutionGroupRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.serverId) {
      clauses.push("server_id = ?");
      params.push(filter.serverId);
    }
    if (filter.taskId) {
      clauses.push("task_id = ?");
      params.push(filter.taskId);
    }
    if (filter.messageId) {
      clauses.push("message_id = ?");
      params.push(filter.messageId);
    }
    if (filter.threadChannelId) {
      clauses.push("thread_channel_id = ?");
      params.push(filter.threadChannelId);
    }
    const where = clauses.length ? ` where ${clauses.join(" and ")}` : "";
    const limit = Math.max(1, Math.min(filter.limit ?? 200, 1000));
    return db.prepare(`select * from execution_groups${where} order by created_at desc limit ?`).all(...params, limit).map(rowExecutionGroup);
  }

  function listExecutionGroupsForMessageIds(messageIds: string[], limit = 1000): ExecutionGroupRecord[] {
    const scopedMessageIds = Array.from(new Set(messageIds.filter(Boolean)));
    if (scopedMessageIds.length === 0) return [];
    const placeholders = scopedMessageIds.map(() => "?").join(",");
    const max = Math.max(1, Math.min(limit, 1000));
    return db.prepare(
      `select * from execution_groups
       where message_id in (${placeholders})
       order by updated_at desc, created_at desc
       limit ?`
    ).all(...scopedMessageIds, max).map(rowExecutionGroup);
  }

  function updateExecutionGroupStatus(id: string, status: ExecutionGroupStatus): ExecutionGroupRecord | null {
    const updatedAt = nowIso();
    db.prepare(
      `update execution_groups
       set status = ?, updated_at = ?, completed_at = ?
       where id = ?`
    ).run(status, updatedAt, executionGroupCompletedAt(status, updatedAt), id);
    return getExecutionGroup(id);
  }

  function ensureAgentRun(input: Omit<AgentRunRecord, "createdAt" | "updatedAt" | "inputArtifactIds" | "outputArtifactIds"> & { inputArtifactIds?: string[]; outputArtifactIds?: string[]; createdAt?: string; updatedAt?: string }): AgentRunRecord {
    const existing = getAgentRun(input.id);
    if (existing) return existing;
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? createdAt;
    const actorSnapshot = executionActorSnapshot(input.agentId, input.machineId);
    db.prepare(
      `insert into agent_runs
       (id, group_id, machine_id, agent_id, agent_name, agent_display_name, agent_owner_user_id, machine_name, machine_hostname, machine_owner_user_id, runtime, launch_id, status, input_artifact_ids, output_artifact_ids, created_at, updated_at, completed_at)
       values (@id, @groupId, @machineId, @agentId, @agentName, @agentDisplayName, @agentOwnerUserId, @machineName, @machineHostname, @machineOwnerUserId, @runtime, @launchId, @status, @inputArtifactIds, @outputArtifactIds, @createdAt, @updatedAt, @completedAt)`
    ).run({
      ...input,
      agentName: input.agentName ?? actorSnapshot.agentName ?? null,
      agentDisplayName: input.agentDisplayName ?? actorSnapshot.agentDisplayName ?? null,
      agentOwnerUserId: input.agentOwnerUserId ?? actorSnapshot.agentOwnerUserId ?? null,
      machineName: input.machineName ?? actorSnapshot.machineName ?? null,
      machineHostname: input.machineHostname ?? actorSnapshot.machineHostname ?? null,
      machineOwnerUserId: input.machineOwnerUserId ?? actorSnapshot.machineOwnerUserId ?? null,
      launchId: input.launchId ?? null,
      inputArtifactIds: stringify((input.inputArtifactIds ?? []) as JsonValue),
      outputArtifactIds: stringify((input.outputArtifactIds ?? []) as JsonValue),
      createdAt,
      updatedAt,
      completedAt: input.completedAt ?? agentRunCompletedAt(input.status, updatedAt)
    });
    db.prepare("update execution_groups set updated_at = ? where id = ?").run(updatedAt, input.groupId);
    return getAgentRun(input.id)!;
  }

  function getAgentRun(id: string): AgentRunRecord | null {
    const row = db.prepare("select * from agent_runs where id = ?").get(id);
    return row ? rowAgentRun(row) : null;
  }

  function listAgentRuns(filter: { groupId?: string; agentId?: string; limit?: number } = {}): AgentRunRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.groupId) {
      clauses.push("group_id = ?");
      params.push(filter.groupId);
    }
    if (filter.agentId) {
      clauses.push("agent_id = ?");
      params.push(filter.agentId);
    }
    const where = clauses.length ? ` where ${clauses.join(" and ")}` : "";
    const limit = Math.max(1, Math.min(filter.limit ?? 200, 1000));
    return db.prepare(`select * from agent_runs${where} order by created_at asc limit ?`).all(...params, limit).map(rowAgentRun);
  }

  function listAgentRunsForGroupIds(groupIds: string[], limit = 1000): AgentRunRecord[] {
    const scopedGroupIds = Array.from(new Set(groupIds.filter(Boolean)));
    if (scopedGroupIds.length === 0) return [];
    const placeholders = scopedGroupIds.map(() => "?").join(",");
    const max = Math.max(1, Math.min(limit, 1000));
    return db.prepare(
      `select * from agent_runs
       where group_id in (${placeholders})
       order by created_at asc
       limit ?`
    ).all(...scopedGroupIds, max).map(rowAgentRun);
  }

  function updateAgentRunStatus(id: string, status: AgentRunStatus): AgentRunRecord | null {
    const updatedAt = nowIso();
    db.prepare(
      `update agent_runs
       set status = ?, updated_at = ?, completed_at = ?
       where id = ?`
    ).run(status, updatedAt, agentRunCompletedAt(status, updatedAt), id);
    const run = getAgentRun(id);
    if (run) db.prepare("update execution_groups set updated_at = ? where id = ?").run(updatedAt, run.groupId);
    return run;
  }

  function upsertExecutionBlock(input: Omit<ExecutionBlockRecord, "groupSequence" | "runSequence" | "createdAt" | "updatedAt"> & { groupSequence?: number; runSequence?: number; createdAt?: string; updatedAt?: string }): ExecutionBlockRecord {
    const existing = db.prepare("select * from execution_blocks where id = ?").get(input.id);
    const existingBlock = existing ? rowExecutionBlock(existing) : null;
    const createdAt = existingBlock?.createdAt ?? input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? nowIso();
    const groupSequence = input.groupSequence ?? (existingBlock?.groupId === input.groupId ? existingBlock.groupSequence : nextExecutionGroupSequence(input.groupId));
    const runSequence = input.runSequence ?? (input.runId ? existingBlock?.runId === input.runId ? existingBlock.runSequence ?? nextAgentRunSequence(input.runId) : nextAgentRunSequence(input.runId) : null);
    db.prepare(
      `insert or replace into execution_blocks
       (id, group_id, run_id, agent_id, group_sequence, run_sequence, kind, title, body_preview, body_ref, status, approval_id, governance_decision_id, artifact_id, raw_event_ids, created_at, updated_at)
       values (@id, @groupId, @runId, @agentId, @groupSequence, @runSequence, @kind, @title, @bodyPreview, @bodyRef, @status, @approvalId, @governanceDecisionId, @artifactId, @rawEventIds, @createdAt, @updatedAt)`
    ).run({
      ...input,
      runId: input.runId ?? null,
      agentId: input.agentId ?? null,
      groupSequence,
      runSequence,
      bodyPreview: input.bodyPreview ?? null,
      bodyRef: input.bodyRef ?? null,
      status: input.status ?? null,
      approvalId: input.approvalId ?? null,
      governanceDecisionId: input.governanceDecisionId ?? null,
      artifactId: input.artifactId ?? null,
      rawEventIds: stringify((input.rawEventIds ?? []) as JsonValue),
      createdAt,
      updatedAt
    });
    db.prepare("update execution_groups set updated_at = ? where id = ?").run(updatedAt, input.groupId);
    if (input.runId) db.prepare("update agent_runs set updated_at = ? where id = ?").run(updatedAt, input.runId);
    return rowExecutionBlock(db.prepare("select * from execution_blocks where id = ?").get(input.id)!);
  }

  function hasExecutionBlocks(groupId: string): boolean {
    return Number(db.prepare("select count(*) from execution_blocks where group_id = ? limit 1").pluck().get(groupId) ?? 0) > 0;
  }

  function listExecutionBlocks(groupId: string, options: { limit?: number; beforeSequence?: number; agentId?: string; tail?: boolean } = {}): ExecutionBlockRecord[] {
    const clauses = ["group_id = ?"];
    const params: unknown[] = [groupId];
    if (options.beforeSequence !== undefined) {
      clauses.push("group_sequence < ?");
      params.push(options.beforeSequence);
    }
    if (options.agentId) {
      clauses.push("agent_id = ?");
      params.push(options.agentId);
    }
    const limit = Math.max(1, Math.min(options.limit ?? 500, 1000));
    const order = options.tail ? "desc" : "asc";
    const rows = db.prepare(`select * from execution_blocks where ${clauses.join(" and ")} order by group_sequence ${order} limit ?`).all(...params, limit).map(rowExecutionBlock);
    return options.tail ? rows.reverse() : rows;
  }

  function createExecutionArtifact(input: Omit<ExecutionArtifactRecord, "createdAt"> & { createdAt?: string }): ExecutionArtifactRecord {
    const createdAt = input.createdAt ?? nowIso();
    db.prepare(
      `insert or replace into execution_artifacts
       (id, group_id, run_id, agent_id, kind, title, preview, ref_type, ref_id, created_at)
       values (@id, @groupId, @runId, @agentId, @kind, @title, @preview, @refType, @refId, @createdAt)`
    ).run({
      ...input,
      runId: input.runId ?? null,
      agentId: input.agentId ?? null,
      preview: input.preview ?? null,
      refId: input.refId ?? null,
      createdAt
    });
    db.prepare("update execution_groups set updated_at = ? where id = ?").run(createdAt, input.groupId);
    if (input.runId) db.prepare("update agent_runs set updated_at = ? where id = ?").run(createdAt, input.runId);
    return rowExecutionArtifact(db.prepare("select * from execution_artifacts where id = ?").get(input.id)!);
  }

  function listExecutionArtifacts(groupId: string): ExecutionArtifactRecord[] {
    return db.prepare("select * from execution_artifacts where group_id = ? order by created_at desc").all(groupId).map(rowExecutionArtifact);
  }

  function ensureSafetyAssessment(input: Omit<SafetyAssessmentRecord, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): SafetyAssessmentRecord {
    const existing = findSafetyAssessmentBySubject(input.subjectType, input.subjectId, input.trigger);
    if (existing) return existing;
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? createdAt;
    db.prepare(
      `insert into safety_assessments
       (id, server_id, machine_id, agent_id, runtime, trigger, subject_type, subject_id, status, label, risk_types, analysis, evidence,
        execution_id, approval_id, task_id, message_id, thread_channel_id, model, error, created_at, updated_at, completed_at)
       values (@id, @serverId, @machineId, @agentId, @runtime, @trigger, @subjectType, @subjectId, @status, @label, @riskTypes, @analysis, @evidence,
        @executionId, @approvalId, @taskId, @messageId, @threadChannelId, @model, @error, @createdAt, @updatedAt, @completedAt)`
    ).run({
      id: input.id,
      serverId: input.serverId,
      machineId: input.machineId,
      agentId: input.agentId,
      runtime: input.runtime,
      trigger: input.trigger,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: input.status,
      label: input.label,
      riskTypes: stringify(input.riskTypes),
      analysis: input.analysis,
      evidence: stringify(input.evidence),
      executionId: input.executionId ?? null,
      approvalId: input.approvalId ?? null,
      taskId: input.taskId ?? null,
      messageId: input.messageId ?? null,
      threadChannelId: input.threadChannelId ?? null,
      model: input.model ?? null,
      error: input.error ?? null,
      createdAt,
      updatedAt,
      completedAt: input.completedAt ?? null
    });
    return findSafetyAssessmentBySubject(input.subjectType, input.subjectId, input.trigger)!;
  }

  function updateSafetyAssessment(assessmentId: string, patch: Partial<Pick<SafetyAssessmentRecord, "status" | "label" | "riskTypes" | "analysis" | "evidence" | "model" | "error" | "completedAt">>): SafetyAssessmentRecord | null {
    const current = db.prepare("select * from safety_assessments where id = ?").get(assessmentId);
    if (!current) return null;
    db.prepare(
      `update safety_assessments
       set status = coalesce(@status, status),
           label = coalesce(@label, label),
           risk_types = coalesce(@riskTypes, risk_types),
           analysis = coalesce(@analysis, analysis),
           evidence = coalesce(@evidence, evidence),
           model = coalesce(@model, model),
           error = @error,
           completed_at = coalesce(@completedAt, completed_at),
           updated_at = @updatedAt
       where id = @id`
    ).run({
      id: assessmentId,
      status: patch.status ?? null,
      label: patch.label ?? null,
      riskTypes: patch.riskTypes ? stringify(patch.riskTypes) : null,
      analysis: patch.analysis ?? null,
      evidence: patch.evidence ? stringify(patch.evidence) : null,
      model: patch.model ?? null,
      error: patch.error ?? null,
      completedAt: patch.completedAt ?? null,
      updatedAt: nowIso()
    });
    const row = db.prepare("select * from safety_assessments where id = ?").get(assessmentId);
    return row ? rowSafetyAssessment(row) : null;
  }

  function findSafetyAssessmentBySubject(subjectType: SafetyAssessmentSubjectType, subjectId: string, trigger: SafetyAuditTrigger): SafetyAssessmentRecord | null {
    const row = db.prepare("select * from safety_assessments where subject_type = ? and subject_id = ? and trigger = ?").get(subjectType, subjectId, trigger);
    return row ? rowSafetyAssessment(row) : null;
  }

  function listSafetyAssessments(filter: { serverId?: string; executionId?: string; approvalId?: string; taskId?: string; limit?: number } = {}): SafetyAssessmentRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.serverId) {
      clauses.push("server_id = ?");
      params.push(filter.serverId);
    }
    if (filter.executionId) {
      clauses.push("execution_id = ?");
      params.push(filter.executionId);
    }
    if (filter.approvalId) {
      clauses.push("approval_id = ?");
      params.push(filter.approvalId);
    }
    if (filter.taskId) {
      clauses.push("task_id = ?");
      params.push(filter.taskId);
    }
    const where = clauses.length ? ` where ${clauses.join(" and ")}` : "";
    const limit = Math.max(1, Math.min(filter.limit ?? 200, 500));
    return db.prepare(`select * from safety_assessments${where} order by created_at desc limit ?`).all(...params, limit).map(rowSafetyAssessment);
  }

  function upsertGovernancePolicyConfig(input: { serverId: string; scope: GovernancePolicyConfigScope; agentId?: string; version: string; rules: GovernancePolicyRules; actorUserId?: string }): GovernancePolicyConfigRecord {
    const scope = governancePolicyConfigScope(input.scope);
    const agentId = scope === "agent" ? maybeString(input.agentId) : undefined;
    if (scope === "agent" && !agentId) throw new Error("agent_id_required");
    const version = sanitizeGovernancePolicyVersion(input.version);
    const rules = sanitizeGovernancePolicyRules(input.rules);
    const now = nowIso();
    const existing = getGovernancePolicyConfig({ serverId: input.serverId, scope, agentId });
    const configId = existing?.id ?? id("govpol");
    const previousRules = existing?.rules ?? {};
    const previousVersion = existing?.version;
    if (existing) {
      db.prepare(
        `update governance_policy_configs
         set version = ?, rules = ?, updated_by_user_id = ?, updated_at = ?
         where id = ?`
      ).run(version, stringify(rules as JsonValue), input.actorUserId ?? null, now, configId);
    } else {
      db.prepare(
        `insert into governance_policy_configs
         (id, server_id, scope, agent_id, version, rules, created_by_user_id, updated_by_user_id, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(configId, input.serverId, scope, agentId ?? null, version, stringify(rules as JsonValue), input.actorUserId ?? null, input.actorUserId ?? null, now, now);
    }
    db.prepare(
      `insert into governance_policy_config_audit
       (id, config_id, server_id, scope, agent_id, action, version, rules, actor_user_id, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id("govpolaudit"), configId, input.serverId, scope, agentId ?? null, "upsert", version, stringify(rules as JsonValue), input.actorUserId ?? null, now);
    recordAuditEvent({
      kind: "governance_policy_config_upserted",
      actorType: input.actorUserId ? "user" : "system",
      actorId: input.actorUserId ?? null,
      resourceType: "governance_policy_config",
      resourceId: configId,
      serverId: input.serverId,
      metadata: auditMetadata({
        scope,
        agentId,
        policySource: "db_config",
        policyVersion: version,
        previousPolicyVersion: previousVersion,
        ruleKeys: sortedGovernancePolicyRuleKeys(rules),
        previousRuleKeys: sortedGovernancePolicyRuleKeys(previousRules),
        changedRuleKeys: changedGovernancePolicyRuleKeys(previousRules, rules),
        ruleCount: sortedGovernancePolicyRuleKeys(rules).length
      })
    });
    const row = db.prepare("select * from governance_policy_configs where id = ?").get(configId);
    return rowGovernancePolicyConfig(row);
  }

  function getGovernancePolicyConfig(input: { serverId: string; scope: GovernancePolicyConfigScope; agentId?: string }): GovernancePolicyConfigRecord | null {
    const scope = governancePolicyConfigScope(input.scope);
    const row = scope === "agent"
      ? db.prepare("select * from governance_policy_configs where server_id = ? and scope = 'agent' and agent_id = ?").get(input.serverId, input.agentId ?? "")
      : db.prepare("select * from governance_policy_configs where server_id = ? and scope = 'workspace' and agent_id is null").get(input.serverId);
    return row ? rowGovernancePolicyConfig(row) : null;
  }

  function listGovernancePolicyConfigs(filter: { serverId?: string; agentId?: string } = {}): GovernancePolicyConfigRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.serverId) {
      clauses.push("server_id = ?");
      params.push(filter.serverId);
    }
    if (filter.agentId) {
      clauses.push("(agent_id = ? or scope = 'workspace')");
      params.push(filter.agentId);
    }
    const where = clauses.length ? ` where ${clauses.join(" and ")}` : "";
    return db.prepare(`select * from governance_policy_configs${where} order by scope asc, updated_at desc`).all(...params).map(rowGovernancePolicyConfig);
  }

  function getGovernancePolicyConfigAudit(auditId: string): GovernancePolicyConfigAuditRecord | null {
    const row = db.prepare("select * from governance_policy_config_audit where id = ?").get(auditId);
    return row ? rowGovernancePolicyConfigAudit(row) : null;
  }

  function listGovernancePolicyConfigAudit(filter: { serverId?: string; configId?: string; limit?: number } = {}): GovernancePolicyConfigAuditRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.serverId) {
      clauses.push("server_id = ?");
      params.push(filter.serverId);
    }
    if (filter.configId) {
      clauses.push("config_id = ?");
      params.push(filter.configId);
    }
    const where = clauses.length ? ` where ${clauses.join(" and ")}` : "";
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 200));
    return db.prepare(`select * from governance_policy_config_audit${where} order by created_at desc, rowid desc limit ?`).all(...params, limit).map(rowGovernancePolicyConfigAudit);
  }

  function createGovernanceDecision(input: Omit<GovernanceDecisionRecord, "createdAt"> & { createdAt?: string }): GovernanceDecisionRecord {
    const createdAt = input.createdAt ?? nowIso();
    db.prepare(
      `insert into governance_decisions
       (id, server_id, machine_id, agent_id, runtime, trigger, subject_type, subject_id, mode, decision, confidence, risk_types, reason, evidence,
        policy_version, policy_source, policy_scope, decision_source, execution_id, approval_id, task_id, message_id, thread_channel_id, model, case_summary, created_at)
       values (@id, @serverId, @machineId, @agentId, @runtime, @trigger, @subjectType, @subjectId, @mode, @decision, @confidence, @riskTypes, @reason, @evidence,
        @policyVersion, @policySource, @policyScope, @decisionSource, @executionId, @approvalId, @taskId, @messageId, @threadChannelId, @model, @caseSummary, @createdAt)`
    ).run({
      id: input.id,
      serverId: input.serverId,
      machineId: input.machineId,
      agentId: input.agentId,
      runtime: input.runtime,
      trigger: input.trigger,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      mode: input.mode,
      decision: input.decision,
      confidence: input.confidence,
      riskTypes: stringify(input.riskTypes),
      reason: input.reason,
      evidence: stringify(input.evidence),
      policyVersion: input.policyVersion ?? null,
      policySource: input.policySource ?? null,
      policyScope: input.policyScope ?? null,
      decisionSource: input.decisionSource ?? null,
      executionId: input.executionId ?? null,
      approvalId: input.approvalId ?? null,
      taskId: input.taskId ?? null,
      messageId: input.messageId ?? null,
      threadChannelId: input.threadChannelId ?? null,
      model: input.model ?? null,
      caseSummary: stringify(input.caseSummary as JsonValue | undefined),
      createdAt
    });
    const row = db.prepare("select * from governance_decisions where id = ?").get(input.id);
    return rowGovernanceDecision(row);
  }

  function listGovernanceDecisions(filter: { serverId?: string; executionId?: string; approvalId?: string; taskId?: string; limit?: number } = {}): GovernanceDecisionRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.serverId) {
      clauses.push("server_id = ?");
      params.push(filter.serverId);
    }
    if (filter.executionId) {
      clauses.push("execution_id = ?");
      params.push(filter.executionId);
    }
    if (filter.approvalId) {
      clauses.push("approval_id = ?");
      params.push(filter.approvalId);
    }
    if (filter.taskId) {
      clauses.push("task_id = ?");
      params.push(filter.taskId);
    }
    const where = clauses.length ? ` where ${clauses.join(" and ")}` : "";
    const limit = Math.max(1, Math.min(filter.limit ?? 200, 500));
    return db.prepare(`select * from governance_decisions${where} order by created_at desc limit ?`).all(...params, limit).map(rowGovernanceDecision);
  }

  function getRuntimeApproval(approvalId: string): RuntimeApprovalRecord | null {
    const row = db.prepare("select * from runtime_approvals where id = ?").get(approvalId);
    return row ? rowRuntimeApproval(row) : null;
  }

  function listRuntimeApprovals(filter: { executionId?: string; messageId?: string; threadChannelId?: string; serverId?: string; agentId?: string; limit?: number } = {}): RuntimeApprovalRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.executionId) {
      clauses.push("execution_id = ?");
      params.push(filter.executionId);
    }
    if (filter.messageId) {
      clauses.push("message_id = ?");
      params.push(filter.messageId);
    }
    if (filter.threadChannelId) {
      clauses.push("thread_channel_id = ?");
      params.push(filter.threadChannelId);
    }
    if (filter.serverId) {
      clauses.push("server_id = ?");
      params.push(filter.serverId);
    }
    if (filter.agentId) {
      clauses.push("agent_id = ?");
      params.push(filter.agentId);
    }
    const where = clauses.length ? ` where ${clauses.join(" and ")}` : "";
    const limit = Math.max(1, Math.min(filter.limit ?? 200, 1000));
    return db.prepare(`select * from runtime_approvals${where} order by requested_at desc limit ?`).all(...params, limit).map(rowRuntimeApproval);
  }

  function listExpiredPendingRuntimeApprovals(cutoffAt: string, limit = 100): RuntimeApprovalRecord[] {
    return db.prepare(
      `select * from runtime_approvals
       where status = 'pending' and requested_at < ?
       order by requested_at asc limit ?`
    ).all(cutoffAt, Math.max(1, Math.min(limit, 1000))).map(rowRuntimeApproval);
  }

  function listRuntimeApprovalsForExecutionSummary(input: { executionIds: string[]; messageIds: string[]; threadChannelIds: string[]; ownerUserId: string; limit?: number }): RuntimeApprovalRecord[] {
    const executionIds = Array.from(new Set(input.executionIds.filter(Boolean)));
    const messageIds = Array.from(new Set(input.messageIds.filter(Boolean)));
    const threadChannelIds = Array.from(new Set(input.threadChannelIds.filter(Boolean)));
    if (!executionIds.length && (!input.ownerUserId || (!messageIds.length && !threadChannelIds.length))) return [];
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (executionIds.length) {
      clauses.push(`runtime_approvals.execution_id in (${executionIds.map(() => "?").join(",")})`);
      params.push(...executionIds);
    }
    const ownerScopedClauses: string[] = [];
    const ownerScopedParams: unknown[] = [];
    if (messageIds.length) {
      ownerScopedClauses.push(`runtime_approvals.message_id in (${messageIds.map(() => "?").join(",")})`);
      ownerScopedParams.push(...messageIds);
    }
    if (threadChannelIds.length) {
      ownerScopedClauses.push(`runtime_approvals.thread_channel_id in (${threadChannelIds.map(() => "?").join(",")})`);
      ownerScopedParams.push(...threadChannelIds);
    }
    if (ownerScopedClauses.length && input.ownerUserId) {
      clauses.push(`(agents.owner_user_id = ? and (${ownerScopedClauses.join(" or ")}))`);
      params.push(input.ownerUserId, ...ownerScopedParams);
    }
    const max = Math.max(1, Math.min(input.limit ?? 1000, 1000));
    // Approval 可能挂在 execution、原消息或 thread 上。executionId 已由 route 选为可见 execution；
    // 直接按 message/thread 兜底时仍限制当前用户拥有的 Agent，避免暴露无关命令详情。
    return db.prepare(
      `select runtime_approvals.*
       from runtime_approvals
       left join agents on agents.id = runtime_approvals.agent_id
       where ${clauses.join(" or ")}
       order by runtime_approvals.requested_at desc limit ?`
    ).all(...params, max).map(rowRuntimeApproval);
  }

  function runtimeApprovalSourceChannel(approval: RuntimeApprovalRecord): {
    channel: ChannelRecord;
    execution: RuntimeExecutionRecord | null;
  } | null {
    const execution = approval.executionId ? getRuntimeExecution(approval.executionId) : null;
    const messageIds = [
      execution?.rootMessageId,
      approval.messageId,
      execution?.messageId
    ].filter(Boolean) as string[];
    for (const messageId of messageIds) {
      const message = getMessage(messageId);
      const channel = message ? resolveTarget(message.channelId, approval.serverId ?? "local") : null;
      if (channel) return { channel, execution };
    }
    const threadId = approval.threadChannelId ?? execution?.threadChannelId;
    const thread = threadId ? resolveTarget(threadId, approval.serverId ?? "local") : null;
    return thread ? { channel: thread, execution } : null;
  }

  function baseDmChannel(channel: ChannelRecord, serverId: string): ChannelRecord | null {
    if (channel.type === "dm") return channel;
    if (channel.type !== "thread" || !channel.parentChannelId) return null;
    const parent = resolveTarget(channel.parentChannelId, serverId);
    return parent?.type === "dm" ? parent : null;
  }

  function internalApprovalSourceMatchesTargetAgent(
    approval: RuntimeApprovalRecord,
    source: ChannelRecord,
    execution: RuntimeExecutionRecord | null
  ): boolean | null {
    const identity = source.dmIdentity;
    if (!identity) return null;
    if (identity.kind === "agent_pair") {
      // Agent-pair 审批只能回到 pair 中实际执行命令的目标 Agent owner。
      return identity.agentIds.includes(approval.agentId);
    }
    const directMessage = execution ? getMessage(execution.messageId) : null;
    const directSource = directMessage ? resolveTarget(directMessage.channelId, approval.serverId ?? "local") : null;
    const directChannel = directSource ? baseDmChannel(directSource, approval.serverId ?? "local") : null;
    const directIdentity = directChannel?.dmIdentity;
    if (identity.kind !== "workspace_bridge") {
      // Human 可见根消息一旦 handoff 到 Agent pair，审批权随实际执行 Agent，而不随最初请求者。
      return directIdentity?.kind === "agent_pair"
        ? directIdentity.agentIds.includes(approval.agentId)
        : null;
    }
    if (!execution) return false;
    const bridge = getWorkspaceBridgeForServer(identity.bridgeId, identity.workspaceId);
    // 撤销只阻止新请求；已经创建 execution 的目标 Owner 仍可完成既有 Runtime 流程。
    if (!bridge) return false;
    // Bridge 本身不直接包含目标 runtime Agent；必须证明执行确实经 TYR 的内部 pair handoff 到达该 Agent。
    return directIdentity?.kind === "agent_pair" &&
      directIdentity.agentIds.includes(identity.agentId) &&
      directIdentity.agentIds.includes(approval.agentId);
  }

  function canUserResolveRuntimeApproval(userId: string, approval: RuntimeApprovalRecord): boolean {
    const source = runtimeApprovalSourceChannel(approval);
    if (!source) return false;
    const serverId = approval.serverId ?? "local";
    const sourceDm = baseDmChannel(source.channel, serverId);
    if (!sourceDm) return false;
    const internalTargetMatches = internalApprovalSourceMatchesTargetAgent(approval, sourceDm, source.execution);
    if (internalTargetMatches === null) return canUserAccessChannel(userId, source.channel.id);
    if (!internalTargetMatches) return false;

    const agent = getAgent(approval.agentId);
    if (!isActiveAgent(agent) || agent.ownerUserId !== userId) return false;
    const agentServerId = agent.serverId ?? (agent.machineId ? getMachine(agent.machineId)?.serverId : undefined) ?? "local";
    if ((sourceDm.serverId ?? "local") !== serverId || agentServerId !== serverId) return false;
    // Human 不获得内部 DM 读取权；这里只为本地 Agent owner 建立最小、动作级的审批授权。
    return true;
  }

  function resolveRuntimeApproval(approvalId: string, decision: RuntimeApprovalDecision, resolvedByUserId: string, customResponse?: string): RuntimeApprovalRecord | null {
    const current = getRuntimeApproval(approvalId);
    if (!current) return null;
    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "custom";
    db.prepare(
      `update runtime_approvals
       set status = ?, decision = ?, custom_response = ?, resolved_at = ?, resolved_by_user_id = ?
       where id = ?`
    ).run(status, decision, customResponse ?? null, nowIso(), resolvedByUserId, approvalId);
    return getRuntimeApproval(approvalId);
  }

  function normalizeChannelName(value: string): string {
    return slugifyName(value.replace(/^#/, "")) || "channel";
  }

  function createChannel(input: CreateChannelInput): ChannelRecord {
    // 仅为历史数据迁移和测试夹具保留；生产应用没有调用方，普通群聊产品入口已下线。
    const serverId = input.serverId ?? (input.createdByUserId ? getActiveServerIdForUser(input.createdByUserId) ?? "local" : "local");
    const name = normalizeChannelName(input.name);
    const existing = getChannelByName(name, "channel", serverId);
    if (existing) return existing;
    const createdAt = nowIso();
    const channel: ChannelRecord = {
      id: id("channel"),
      serverId,
      type: "channel",
      name,
      displayName: input.displayName?.trim() || name,
      visibility: input.visibility ?? "public",
      description: input.description?.trim() || undefined,
      createdAt
    };
    db.prepare(
      `insert into channels (id, server_id, type, name, display_name, visibility, description, created_at)
       values (@id, @serverId, @type, @name, @displayName, @visibility, @description, @createdAt)`
    ).run(channel);
    if (input.createdByUserId) setHumanChannelMembership(input.createdByUserId, channel.id, true, "owner");
    if (channel.visibility === "public") {
      for (const human of listServerMembers(serverId)) {
        if (human.role === "guest" && channel.name !== "all") continue;
        setHumanChannelMembership(human.id, channel.id, true, channelHumanRoleForServerRole(human.role));
      }
      for (const agent of listAgents(serverId).filter((item) => !isCommunicationAgent(item))) setAgentChannelMembership(agent.id, channel.id, true, false);
    }
    for (const agentId of input.memberAgentIds ?? []) setAgentChannelMembership(agentId, channel.id, true, false);
    return channel;
  }

  function deleteChannel(channelId: string): { success: boolean; channel?: ChannelRecord; reason?: string } {
    const row = db.prepare("select * from channels where id = ?").get(channelId);
    if (!row) return { success: false, reason: "channel_not_found" };
    const channel = rowChannel(row);
    if (channel.type !== "channel") return { success: false, channel, reason: "regular_channel_required" };
    // 冷保留要求原始频道、消息及审计链不做物理删除。
    return { success: false, channel, reason: "group_channel_retired" };
  }

  function getChannelByName(name: string, type?: ChannelType, serverId = "local"): ChannelRecord | null {
    const clean = name.replace(/^#/, "");
    const row = type
      ? db.prepare("select * from channels where name = ? and type = ? and server_id = ?").get(clean, type, serverId)
      : db.prepare("select * from channels where name = ? and server_id = ? order by type = 'channel' desc limit 1").get(clean, serverId);
    return row ? rowChannel(row) : null;
  }

  function getConversation(conversationId: string): ConversationRecord | null {
    const row = db.prepare("select * from conversations where id = ? or id like ?").get(conversationId, `${conversationId}%`);
    return row ? rowConversation(row) : null;
  }

  function listConversations(channelId: string, options: { includeArchived?: boolean } = {}): ConversationRecord[] {
    const archivedClause = options.includeArchived ? "" : " and archived_at is null";
    return db.prepare(`select * from conversations where channel_id = ?${archivedClause} order by coalesce(last_message_at, started_at) desc, started_at desc`).all(channelId).map(rowConversation);
  }

  function getActiveConversation(channelId: string): ConversationRecord | null {
    const channel = db.prepare("select active_conversation_id from channels where id = ?").get(channelId) as { active_conversation_id?: string | null } | undefined;
    const selected = channel?.active_conversation_id
      ? db.prepare("select * from conversations where id = ? and channel_id = ? and status = 'active' and archived_at is null").get(channel.active_conversation_id, channelId)
      : undefined;
    // 旧数据库可能还没有有效 pointer；仅在兼容恢复时选择最新可写会话。
    const row = selected ?? db.prepare("select * from conversations where channel_id = ? and status = 'active' and archived_at is null order by started_at desc limit 1").get(channelId);
    return row ? rowConversation(row) : null;
  }

  function defaultConversationTitle(channel: ChannelRecord, title?: string): string {
    const clean = title?.trim();
    if (clean) return clean.slice(0, 120);
    return channel.type === "dm" ? "New conversation" : channel.displayName;
  }

  function ensureActiveConversation(channelId: string, actor: { type: SenderType; id: string } = { type: "system", id: "system" }): ConversationRecord | null {
    const channelRow = db.prepare("select * from channels where id = ?").get(channelId);
    if (!channelRow) return null;
    const channel = rowChannel(channelRow);
    if (channel.type !== "dm") return null;
    const existing = getActiveConversation(channel.id);
    if (existing) return existing;
    return createConversation({
      channelId: channel.id,
      title: defaultConversationTitle(channel),
      startedByType: actor.type,
      startedById: actor.id,
      resetStatus: "not_applicable"
    });
  }

  function createConversation(input: CreateConversationInput): ConversationRecord {
    const channelRow = db.prepare("select * from channels where id = ?").get(input.channelId);
    if (!channelRow) throw new Error("channel_not_found");
    const channel = rowChannel(channelRow);
    if (channel.type !== "dm") throw new Error("conversation_not_dm");
    const createdAt = nowIso();
    const conversationId = id("conv");
    db.transaction(() => {
      // Runtime Agent 默认仍使用单一当前上下文；TYR 的 Web/Telegram/Email 会显式关闭此行为以支持并行会话。
      if (input.closeExisting !== false) {
        db.prepare("update conversations set status = 'closed', closed_at = coalesce(closed_at, ?) where channel_id = ? and status = 'active'").run(createdAt, channel.id);
      }
      db.prepare(
        `insert into conversations
         (id, server_id, channel_id, title, status, started_by_type, started_by_id, started_at, closed_at, last_message_at, summary, reset_status, reset_agent_id, reset_reason)
         values (?, ?, ?, ?, 'active', ?, ?, ?, null, null, null, ?, ?, ?)`
      ).run(
        conversationId,
        channel.serverId ?? "local",
        channel.id,
        defaultConversationTitle(channel, input.title),
        input.startedByType,
        input.startedById,
        createdAt,
        input.resetStatus ?? "not_applicable",
        input.resetAgentId ?? null,
        input.resetReason ?? null
      );
      if (input.setActive !== false || !channel.activeConversationId) {
        db.prepare("update channels set active_conversation_id = ? where id = ?").run(conversationId, channel.id);
      }
    })();
    const created = getConversation(conversationId);
    if (!created) throw new Error("conversation_create_failed");
    return created;
  }

  function updateConversationResetStatus(conversationId: string, patch: { resetStatus: ConversationResetStatus; resetReason?: string | null }): ConversationRecord | null {
    db.prepare("update conversations set reset_status = ?, reset_reason = ? where id = ?").run(patch.resetStatus, patch.resetReason ?? null, conversationId);
    return getConversation(conversationId);
  }

  function renameConversation(conversationId: string, title: string): ConversationRecord | null {
    const clean = title.trim();
    if (!clean || Array.from(clean).length > 72 || !getConversation(conversationId)) return null;
    // 手动名称直接写入服务端真源；首条消息命名只会更新 New conversation，因此之后不会覆盖它。
    db.prepare("update conversations set title = ? where id = ?").run(clean, conversationId);
    return getConversation(conversationId);
  }

  function archiveConversation(conversationId: string, archivedByUserId: string): ConversationRecord | null {
    const conversation = getConversation(conversationId);
    if (!conversation) return null;
    const channel = db.prepare("select active_conversation_id from channels where id = ?").get(conversation.channelId) as { active_conversation_id?: string | null } | undefined;
    // Web 当前指针必须先由 route 创建替代会话；非当前的 Telegram/Email 并行会话可以直接归档。
    if (channel?.active_conversation_id === conversation.id) return null;
    const archivedAt = nowIso();
    // 归档会话立即停止接收新用户输入；已运行的内部返回仍可通过 allowClosedConversation 完成到这里。
    db.prepare(
      `update conversations
       set status = 'closed', closed_at = coalesce(closed_at, ?), archived_at = coalesce(archived_at, ?), archived_by_user_id = coalesce(archived_by_user_id, ?)
       where id = ?`
    ).run(archivedAt, archivedAt, archivedByUserId, conversation.id);
    return getConversation(conversation.id);
  }

  function unarchiveConversation(conversationId: string): ConversationRecord | null {
    const conversation = getConversation(conversationId);
    if (!conversation) return null;
    db.prepare("update conversations set archived_at = null, archived_by_user_id = null where id = ?").run(conversation.id);
    return getConversation(conversation.id);
  }

  function deleteConversation(conversationId: string): DeleteConversationResult {
    const conversation = getConversation(conversationId);
    if (!conversation) return { success: false, reason: "conversation_not_found" };
    if (conversation.status === "active") return { success: false, conversation, reason: "conversation_active" };
    // 永久删除只从归档列表进入，避免普通历史会话被误删。
    if (!conversation.archivedAt) return { success: false, conversation, reason: "conversation_not_archived" };

    const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
    const placeholders = (values: string[]) => values.map(() => "?").join(",");
    const selectIds = (sql: string, values: unknown[]) => values.length ? db.prepare(sql).pluck().all(...values) as string[] : [];
    const deleteByIds = (table: string, column: string, values: string[]) => {
      if (values.length === 0) return;
      db.prepare(`delete from ${table} where ${column} in (${placeholders(values)})`).run(...values);
    };
    const deleteLinkedRows = (table: string, column: "approval_id" | "execution_id" | "task_id" | "message_id" | "thread_channel_id", values: string[]) => {
      if (values.length === 0) return;
      db.prepare(`delete from ${table} where ${column} in (${placeholders(values)})`).run(...values);
    };

    const rootMessageIds = selectIds("select id from messages where conversation_id = ?", [conversation.id]);
    const rootMessagePlaceholders = placeholders(rootMessageIds);
    const threadChannelIds = rootMessageIds.length
      ? selectIds(`select id from channels where type = 'thread' and parent_message_id in (${rootMessagePlaceholders})`, rootMessageIds)
      : [];
    const threadPlaceholders = placeholders(threadChannelIds);
    const threadMessageIds = threadChannelIds.length
      ? selectIds(`select id from messages where channel_id in (${threadPlaceholders})`, threadChannelIds)
      : [];
    const messageIds = unique([...rootMessageIds, ...threadMessageIds]);
    const messagePlaceholders = placeholders(messageIds);
    const crossWorkspaceMessageClauses = ["conversation_id = ?"];
    const crossWorkspaceMessageArgs: unknown[] = [conversation.id];
    if (messageIds.length) {
      crossWorkspaceMessageClauses.push(`local_message_id in (${messagePlaceholders})`, `peer_message_id in (${messagePlaceholders})`);
      crossWorkspaceMessageArgs.push(...messageIds, ...messageIds);
    }
    const crossWorkspaceMessageIds = unique(
      db.prepare(`select id from cross_workspace_messages where ${crossWorkspaceMessageClauses.join(" or ")}`)
        .pluck()
        .all(...crossWorkspaceMessageArgs) as string[]
    );
    const crossWorkspaceMessagePlaceholders = placeholders(crossWorkspaceMessageIds);

    const attachmentIds = messageIds.length
      ? unique((db.prepare(`select attachment_ids from messages where id in (${messagePlaceholders})`).all(...messageIds) as Array<{ attachment_ids?: string | null }>)
        .flatMap((row) => parseJson<string[]>(row.attachment_ids, [])))
      : [];

    const taskClauses = ["conversation_id = ?"];
    const taskArgs: unknown[] = [conversation.id];
    if (messageIds.length) {
      taskClauses.push(`message_id in (${messagePlaceholders})`);
      taskArgs.push(...messageIds);
    }
    if (threadChannelIds.length) {
      taskClauses.push(`channel_id in (${threadPlaceholders})`);
      taskArgs.push(...threadChannelIds);
    }
    const taskIds = unique(db.prepare(`select id from tasks where ${taskClauses.join(" or ")}`).pluck().all(...taskArgs) as string[]);
    const taskPlaceholders = placeholders(taskIds);

    const executionClauses: string[] = [];
    const executionArgs: unknown[] = [];
    if (messageIds.length) {
      executionClauses.push(`message_id in (${messagePlaceholders})`, `root_message_id in (${messagePlaceholders})`, `return_message_id in (${messagePlaceholders})`);
      executionArgs.push(...messageIds, ...messageIds, ...messageIds);
    }
    if (threadChannelIds.length) {
      executionClauses.push(`thread_channel_id in (${threadPlaceholders})`);
      executionArgs.push(...threadChannelIds);
    }
    if (taskIds.length) {
      executionClauses.push(`task_id in (${taskPlaceholders})`);
      executionArgs.push(...taskIds);
    }
    const executionIds = unique(executionClauses.length ? db.prepare(`select id from runtime_executions where ${executionClauses.join(" or ")}`).pluck().all(...executionArgs) as string[] : []);
    const executionPlaceholders = placeholders(executionIds);

    const approvalClauses: string[] = [];
    const approvalArgs: unknown[] = [];
    if (executionIds.length) {
      approvalClauses.push(`execution_id in (${executionPlaceholders})`);
      approvalArgs.push(...executionIds);
    }
    if (messageIds.length) {
      approvalClauses.push(`message_id in (${messagePlaceholders})`);
      approvalArgs.push(...messageIds);
    }
    if (threadChannelIds.length) {
      approvalClauses.push(`thread_channel_id in (${threadPlaceholders})`);
      approvalArgs.push(...threadChannelIds);
    }
    if (taskIds.length) {
      approvalClauses.push(`task_id in (${taskPlaceholders})`);
      approvalArgs.push(...taskIds);
    }
    const approvalIds = unique(approvalClauses.length ? db.prepare(`select id from runtime_approvals where ${approvalClauses.join(" or ")}`).pluck().all(...approvalArgs) as string[] : []);
    const approvalPlaceholders = placeholders(approvalIds);

    const groupClauses: string[] = [];
    const groupArgs: unknown[] = [];
    if (messageIds.length) {
      groupClauses.push(`message_id in (${messagePlaceholders})`);
      groupArgs.push(...messageIds);
    }
    if (threadChannelIds.length) {
      groupClauses.push(`thread_channel_id in (${threadPlaceholders})`);
      groupArgs.push(...threadChannelIds);
    }
    if (taskIds.length) {
      groupClauses.push(`task_id in (${taskPlaceholders})`);
      groupArgs.push(...taskIds);
    }
    const executionGroupIds = unique(groupClauses.length ? db.prepare(`select id from execution_groups where ${groupClauses.join(" or ")}`).pluck().all(...groupArgs) as string[] : []);

    const reminderClauses: string[] = [];
    const reminderArgs: unknown[] = [];
    if (messageIds.length) {
      reminderClauses.push(`message_id in (${messagePlaceholders})`);
      reminderArgs.push(...messageIds);
    }
    if (threadChannelIds.length) {
      reminderClauses.push(`channel_id in (${threadPlaceholders})`);
      reminderArgs.push(...threadChannelIds);
    }
    const reminderIds = unique(reminderClauses.length ? db.prepare(`select id from reminders where ${reminderClauses.join(" or ")}`).pluck().all(...reminderArgs) as string[] : []);

    db.transaction(() => {
      // 永久删除归档会话时同步清理消息、任务、thread、附件和执行元数据。
      if (crossWorkspaceMessageIds.length) {
        db.prepare(`update cross_workspace_messages set reply_to_message_id = null where reply_to_message_id in (${crossWorkspaceMessagePlaceholders})`)
          .run(...crossWorkspaceMessageIds);
        deleteByIds("cross_workspace_messages", "id", crossWorkspaceMessageIds);
      }
      deleteLinkedRows("governance_decisions", "approval_id", approvalIds);
      deleteLinkedRows("safety_assessments", "approval_id", approvalIds);
      deleteLinkedRows("governance_decisions", "execution_id", executionIds);
      deleteLinkedRows("safety_assessments", "execution_id", executionIds);
      deleteLinkedRows("governance_decisions", "task_id", taskIds);
      deleteLinkedRows("safety_assessments", "task_id", taskIds);
      deleteLinkedRows("governance_decisions", "message_id", messageIds);
      deleteLinkedRows("safety_assessments", "message_id", messageIds);
      deleteLinkedRows("governance_decisions", "thread_channel_id", threadChannelIds);
      deleteLinkedRows("safety_assessments", "thread_channel_id", threadChannelIds);
      deleteByIds("runtime_approvals", "id", approvalIds);
      deleteByIds("runtime_execution_events", "execution_id", executionIds);
      deleteByIds("runtime_executions", "id", executionIds);
      deleteByIds("execution_artifacts", "group_id", executionGroupIds);
      deleteByIds("execution_blocks", "group_id", executionGroupIds);
      deleteByIds("agent_runs", "group_id", executionGroupIds);
      deleteByIds("execution_groups", "id", executionGroupIds);
      deleteByIds("reminder_events", "reminder_id", reminderIds);
      deleteByIds("reminders", "id", reminderIds);
      deleteByIds("agent_inbox", "message_id", messageIds);
      deleteByIds("saved_messages", "message_id", messageIds);
      deleteByIds("inbox_done_marks", "message_id", messageIds);
      deleteByIds("message_reactions", "message_id", messageIds);
      deleteByIds("message_device_refs", "message_id", messageIds);
      deleteByIds("tasks", "id", taskIds);
      deleteByIds("attachments", "id", attachmentIds);
      if (messageIds.length) {
        db.prepare(`update messages set quote_message_id = null where quote_message_id in (${messagePlaceholders})`).run(...messageIds);
        db.prepare(`update communication_agent_pending_actions set source_message_id = null where source_message_id in (${messagePlaceholders})`).run(...messageIds);
        db.prepare(`update communication_agent_pending_actions set suggestion_message_id = null where suggestion_message_id in (${messagePlaceholders})`).run(...messageIds);
        db.prepare(`update device_commands set requested_by_message_id = null where requested_by_message_id in (${messagePlaceholders})`).run(...messageIds);
        db.prepare(`delete from channel_unread_marks where first_message_id in (${messagePlaceholders})`).run(...messageIds);
        db.prepare(`delete from messages where id in (${messagePlaceholders})`).run(...messageIds);
      }
      deleteByIds("channel_unread_marks", "channel_id", threadChannelIds);
      deleteByIds("agent_channel_memberships", "channel_id", threadChannelIds);
      deleteByIds("agent_thread_follows", "thread_channel_id", threadChannelIds);
      deleteByIds("channel_members", "channel_id", threadChannelIds);
      deleteByIds("thread_follows", "thread_channel_id", threadChannelIds);
      deleteByIds("channels", "id", threadChannelIds);
      db.prepare("delete from conversations where id = ?").run(conversation.id);
    })();

    return {
      success: true,
      conversation,
      deletedMessageIds: messageIds,
      deletedThreadChannelIds: threadChannelIds
    };
  }

  function refreshedChannel(channelId: string): ChannelRecord {
    return rowChannel(db.prepare("select * from channels where id = ?").get(channelId));
  }

  function getOrCreateAgentDm(agentId: string, requesterUserId?: string): ChannelRecord | null {
    const agent = getAgent(agentId);
    const machine = agent?.machineId ? getMachine(agent.machineId) : null;
    if (!isActiveAgent(agent) || (!isCommunicationAgent(agent) && !isActiveMachine(machine))) return null;
    const agentServerId = agent.serverId ?? machine?.serverId ?? "local";
    // 无 requester 的内部调用归一到 owner 的 Human-Agent DM，不再制造无 Human 身份的伪 DM。
    const effectiveRequesterUserId = requesterUserId ?? agent.ownerUserId;
    // TYR 的 DM 是 workspace 只读查询入口；任意成员可打开，普通 Agent 仍走 resource access 校验。
    if (isCommunicationAgent(agent) && listServersForUser(effectiveRequesterUserId).some((server) => server.id === agentServerId)) {
      return ensureHumanAgentDm(agent, effectiveRequesterUserId);
    }
    if (!canUserAccessResource(effectiveRequesterUserId, "agent", agent.id, "message")) return null;
    const activeServerId = getActiveServerIdForUser(effectiveRequesterUserId);
    if (agent.ownerUserId === effectiveRequesterUserId && agentServerId !== (activeServerId ?? "local")) return null;
    return ensureHumanAgentDm(agent, effectiveRequesterUserId);
  }

  function synchronizeFixedDmCompatibilityMemberships(channelId: string, identity: DmIdentity): void {
    const updatedAt = nowIso();
    const humanUserId = identity.kind === "human_agent" ? identity.humanUserId : "";
    const agentIds = identity.kind === "agent_pair" ? identity.agentIds : [identity.agentId];
    // 兼容表只镜像固定身份；额外行会被关闭，且永远不参与 ACL 判断。
    db.prepare(
      `update channel_members
       set left_at = coalesce(left_at, ?), ordinary_delivery_enabled = 0
       where channel_id = ? and not (
         (subject_type = 'human' and subject_id = ?) or
         (subject_type = 'agent' and subject_id in (?, ?))
       )`
    ).run(updatedAt, channelId, humanUserId, agentIds[0], agentIds[1] ?? agentIds[0]);
    db.prepare(
      `update agent_channel_memberships
       set joined = 0, ordinary_delivery_enabled = 0, updated_at = ?
       where channel_id = ? and agent_id not in (?, ?)`
    ).run(updatedAt, channelId, agentIds[0], agentIds[1] ?? agentIds[0]);
    if (identity.kind === "human_agent") setHumanChannelMembership(identity.humanUserId, channelId, true, "owner");
    for (const agentId of agentIds) setAgentChannelMembership(agentId, channelId, true, true);
  }

  function getWorkspaceBridgeDm(bridgeId: string, workspaceId: string): ChannelRecord | null {
    const bridge = getWorkspaceBridgeForServer(bridgeId, workspaceId);
    if (!bridge) return null;
    const assistant = ensureDefaultCommunicationAgent(workspaceId);
    const name = slugifyName(`dm-workspace-bridge-${bridge.id}-${workspaceId}`) || `dm-workspace-bridge-${bridge.id}`;
    const existing = db.prepare("select * from channels where type = 'dm' and name = ? and server_id = ?").get(name, workspaceId);
    if (!existing) return null;
    const channel = rowChannel(existing);
    const existingIdentity = channel.dmIdentity;
    if (
      !existingIdentity ||
      existingIdentity.kind !== "workspace_bridge" ||
      existingIdentity.bridgeId !== bridge.id ||
      existingIdentity.workspaceId !== workspaceId ||
      existingIdentity.agentId !== assistant.id
    ) return null;
    return channel;
  }

  function getOrCreateWorkspaceBridgeDm(bridgeId: string, workspaceId: string): ChannelRecord | null {
    const bridge = getWorkspaceBridgeForServer(bridgeId, workspaceId);
    if (!bridge || bridge.status !== "active") return null;
    const assistant = ensureDefaultCommunicationAgent(workspaceId);
    const identity: DmIdentity = {
      kind: "workspace_bridge",
      bridgeId: bridge.id,
      workspaceId,
      agentId: assistant.id
    };
    const existing = getWorkspaceBridgeDm(bridgeId, workspaceId);
    if (existing) {
      synchronizeFixedDmCompatibilityMemberships(existing.id, identity);
      ensureActiveConversation(existing.id, { type: "system", id: "workspace_bridge" });
      return refreshedChannel(existing.id);
    }
    const name = slugifyName(`dm-workspace-bridge-${bridge.id}-${workspaceId}`) || `dm-workspace-bridge-${bridge.id}`;
    const createdAt = nowIso();
    const channel: ChannelRecord = {
      id: id("dm"),
      serverId: workspaceId,
      type: "dm",
      name,
      displayName: `${assistant.displayName} · ${bridge.peerWorkspace?.name ?? "Connected workspace"}`,
      dmIdentity: identity,
      visibility: "private",
      description: `Isolated TYR session for Workspace Bridge ${bridge.id}`,
      createdAt
    };
    db.prepare(
      `insert into channels (id, server_id, type, name, display_name, dm_identity, visibility, description, created_at)
       values (@id, @serverId, @type, @name, @displayName, @dmIdentity, @visibility, @description, @createdAt)`
    ).run({ ...channel, dmIdentity: serializeDmIdentity(identity) });
    // Bridge DM 没有 Human participant，因此不会出现在任意用户的普通 DM 或 Inbox 中。
    synchronizeFixedDmCompatibilityMemberships(channel.id, identity);
    ensureActiveConversation(channel.id, { type: "system", id: "workspace_bridge" });
    return refreshedChannel(channel.id);
  }

  function getOrCreateAgentPairDm(senderAgentId: string, peerAgentHandle: string, serverId?: string): ChannelRecord | null {
    const sender = getAgent(senderAgentId);
    const senderMachine = sender?.machineId ? getMachine(sender.machineId) : null;
    if (!isActiveAgent(sender)) return null;
    const senderServerId = sender.serverId ?? senderMachine?.serverId ?? "local";
    const effectiveServerId = serverId ?? senderServerId;
    // TYR 是 server-hosted Agent，可以作为 delegation 发起方；普通 runtime Agent 仍必须有在线 Computer。
    if (isCommunicationAgent(sender)) {
      if (senderServerId !== effectiveServerId) return null;
    } else if (!isActiveMachine(senderMachine) || (senderMachine.serverId ?? "local") !== effectiveServerId) {
      return null;
    }
    const handle = peerAgentHandle.trim().replace(/^@/, "").toLowerCase();
    if (!handle) return null;
    const peer = listAgents(effectiveServerId).find((agent) => (
      agent.name.toLowerCase() === handle ||
      agent.displayName.toLowerCase() === handle
    ));
    if (!isActiveAgent(peer) || isCommunicationAgent(peer) || peer.id === sender.id) return null;
    const peerMachine = peer.machineId ? getMachine(peer.machineId) : null;
    if (!isActiveMachine(peerMachine) || (peerMachine.serverId ?? "local") !== effectiveServerId) return null;
    const pairIds = [sender.id, peer.id].sort() as [string, string];
    const identity: DmIdentity = { kind: "agent_pair", agentIds: pairIds };
    const name = slugifyName(`dm-agent-pair-${pairIds[0]}-${pairIds[1]}`) || `dm-agent-pair-${pairIds.join("-")}`;
    const existing = db.prepare("select * from channels where type = 'dm' and name = ? and server_id = ?").get(name, effectiveServerId);
    if (existing) {
      const channel = rowChannel(existing);
      const existingIdentity = channel.dmIdentity;
      if (
        existingIdentity &&
        (existingIdentity.kind !== "agent_pair" || existingIdentity.agentIds.some((agentId, index) => agentId !== pairIds[index]))
      ) return null;
      // 名称已唯一证明 pair 时同时修复空值和损坏 JSON，避免损坏字段永久让该 DM fail closed。
      if (!existingIdentity) db.prepare("update channels set dm_identity = ? where id = ?").run(serializeDmIdentity(identity), channel.id);
      synchronizeFixedDmCompatibilityMemberships(channel.id, identity);
      ensureActiveConversation(channel.id, { type: "agent", id: sender.id });
      return refreshedChannel(channel.id);
    }
    const createdAt = nowIso();
    const channel: ChannelRecord = {
      id: id("dm"),
      serverId: effectiveServerId,
      type: "dm",
      name,
      displayName: `DM @${sender.name} & @${peer.name}`,
      dmIdentity: identity,
      visibility: "private",
      description: `Direct message between @${sender.name} and @${peer.name}`,
      createdAt
    };
    db.prepare(
      `insert into channels (id, server_id, type, name, display_name, dm_identity, visibility, description, created_at)
       values (@id, @serverId, @type, @name, @displayName, @dmIdentity, @visibility, @description, @createdAt)`
    ).run({ ...channel, dmIdentity: serializeDmIdentity(identity) });
    // Agent-Agent pair DM 只承载内部 delegation；Human 不写入参与者兼容表。
    synchronizeFixedDmCompatibilityMemberships(channel.id, identity);
    ensureActiveConversation(channel.id, { type: "agent", id: sender.id });
    return refreshedChannel(channel.id);
  }

  function updateChannelDescription(channelId: string, description: string, visibility?: ChannelVisibility): ChannelRecord | null {
    const updated = updateChannelLifecycle(channelId, { description, visibility });
    return updated.channel ?? null;
  }

  function updateChannelLifecycle(channelId: string, patch: { description?: string; visibility?: ChannelVisibility }): { success: boolean; channel?: ChannelRecord; reason?: string } {
    const row = db.prepare("select * from channels where id = ?").get(channelId);
    if (!row) return { success: false, reason: "channel_not_found" };
    const channel = rowChannel(row);
    if (channel.type !== "channel") return { success: false, channel, reason: "regular_channel_required" };
    void patch;
    // 历史群聊是只读冷数据，不再允许通过 Store 恢复生命周期或成员扩散。
    return { success: false, channel, reason: "group_channel_retired" };
  }

  function archiveChannel(channelId: string, archivedByUserId: string): { success: boolean; channel?: ChannelRecord; reason?: string } {
    const row = db.prepare("select * from channels where id = ?").get(channelId);
    if (!row) return { success: false, reason: "channel_not_found" };
    const channel = rowChannel(row);
    if (channel.type !== "channel") return { success: false, channel, reason: "regular_channel_required" };
    void archivedByUserId;
    return { success: false, channel, reason: "group_channel_retired" };
  }

  function unarchiveChannel(channelId: string): { success: boolean; channel?: ChannelRecord; reason?: string } {
    const row = db.prepare("select * from channels where id = ?").get(channelId);
    if (!row) return { success: false, reason: "channel_not_found" };
    const channel = rowChannel(row);
    if (channel.type !== "channel") return { success: false, channel, reason: "regular_channel_required" };
    return { success: false, channel, reason: "group_channel_retired" };
  }

  function activeChannelMember(channelId: string, subjectType: "agent" | "human", subjectId: string): ChannelMemberRecord | null {
    const row = db.prepare(
      `select * from channel_members
       where channel_id = ? and subject_type = ? and subject_id = ? and left_at is null`
    ).get(channelId, subjectType, subjectId);
    return row ? rowChannelMember(row) : null;
  }

  function dmPeerAgentForChannel(channel: ChannelRecord): AgentRecord | null {
    if (channel.type !== "dm" || channel.dmIdentity?.kind !== "human_agent") return null;
    return getAgent(channel.dmIdentity.agentId);
  }

  function agentBelongsToChannelServer(agent: AgentRecord, channel: ChannelRecord): boolean {
    const agentServerId = agent.serverId ?? (agent.machineId ? getMachine(agent.machineId)?.serverId : undefined) ?? "local";
    return agentServerId === (channel.serverId ?? "local");
  }

  function canUserAccessDmChannel(userId: string, channel: ChannelRecord): boolean {
    const identity = channel.dmIdentity;
    // Human 永远不能进入内部 Agent pair；无可证明固定身份的 legacy DM 同样 fail closed。
    if (identity?.kind !== "human_agent" || identity.humanUserId !== userId) return false;
    const peerAgent = dmPeerAgentForChannel(channel);
    if (!isActiveAgent(peerAgent)) return false;
    if (isCommunicationAgent(peerAgent)) {
      return agentBelongsToChannelServer(peerAgent, channel) &&
        listServersForUser(userId).some((server) => server.id === (channel.serverId ?? "local"));
    }
    if (peerAgent.ownerUserId === userId) {
      // 自有 Agent 的 DM 只能留在 Agent 所属 server；历史错误跨 server DM 不再可见。
      return agentBelongsToChannelServer(peerAgent, channel);
    }
    return resourceGrantScopesForUser(userId, "agent", peerAgent.id).includes("message");
  }

  function canUserAccessChannel(userId: string, channelId: string): boolean {
    const row = db.prepare("select * from channels where id = ?").get(channelId) as any;
    if (!row) return false;
    const channel = rowChannel(row);
    if (channel.type === "thread" && channel.parentChannelId) return canUserAccessChannel(userId, channel.parentChannelId);
    // 历史普通群聊只作为冷数据保留；所有用户访问面只允许 DM 及其 thread。
    if (channel.type !== "dm") return false;
    return canUserAccessDmChannel(userId, channel);
  }

  function canAgentAccessChannel(agentId: string, channelId: string): boolean {
    const row = db.prepare("select * from channels where id = ?").get(channelId) as any;
    if (!row) return false;
    const channel = rowChannel(row);
    const agent = getAgent(agentId);
    if (!isActiveAgent(agent)) return false;
    if (channel.type === "thread" && channel.parentChannelId) return canAgentAccessChannel(agentId, channel.parentChannelId);
    // Agent 协作改由 DM 内 delegation 承载，不能再通过历史普通群聊继续收发。
    if (channel.type !== "dm") return false;
    const identity = channel.dmIdentity;
    if (!identity) return false;
    if (identity.kind === "agent_pair") {
      if (isCommunicationAgent(agent)) {
        return identity.agentIds.includes(agentId) && agentBelongsToChannelServer(agent, channel);
      }
      const machine = agent.machineId ? getMachine(agent.machineId) : null;
      return identity.agentIds.includes(agentId) &&
        isActiveMachine(machine) &&
        (machine.serverId ?? "local") === (channel.serverId ?? "local");
    }
    if (identity.kind === "workspace_bridge") {
      const bridge = getWorkspaceBridgeForServer(identity.bridgeId, identity.workspaceId);
      return identity.agentId === agentId &&
        identity.workspaceId === (channel.serverId ?? "local") &&
        bridge?.status === "active" &&
        agentBelongsToChannelServer(agent, channel);
    }
    if (identity.agentId !== agentId) return false;
    if (isCommunicationAgent(agent)) {
      return agentBelongsToChannelServer(agent, channel) &&
        listServersForUser(identity.humanUserId).some((server) => server.id === (channel.serverId ?? "local"));
    }
    const machine = agent.machineId ? getMachine(agent.machineId) : null;
    if (!isActiveMachine(machine)) return false;
    const sameServer = (machine.serverId ?? "local") === (channel.serverId ?? "local");
    if (identity.humanUserId === agent.ownerUserId) return sameServer;
    return agentHasParticipatingGrantForChannel(agentId, channel);
  }

  function canAgentSendToChannel(agentId: string, channelId: string): boolean {
    return canAgentAccessChannel(agentId, channelId);
  }

  function listChannelsForAgent(agentId: string): ChannelRecord[] {
    return db.prepare("select * from channels order by created_at, name").all()
      .map(rowChannel)
      .filter((channel) => canAgentAccessChannel(agentId, channel.id));
  }

  function resolveTarget(target: string, serverId = "local"): ChannelRecord | null {
    const trimmed = target.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("#")) {
      const [channelName, threadShort] = trimmed.slice(1).split(":");
      const channel = getChannelByName(channelName, "channel", serverId);
      if (!channel || !threadShort) return channel;
      const normalizedThreadShort = threadShort.replace(/^msg_/, "");
      const thread = db.prepare(
        `select * from channels
         where type = 'thread' and parent_channel_id = ?
         and (name = ? or name = ? or id like ? or parent_message_id = ? or parent_message_id like ?)`
      ).get(channel.id, `thread-${threadShort}`, `thread-${normalizedThreadShort}`, `${threadShort}%`, threadShort, `${threadShort}%`);
      return thread ? rowChannel(thread) : null;
    }
    if (trimmed.startsWith("dm:@")) {
      const [peer, threadShort] = trimmed.slice(4).split(":");
      const handle = peer.trim().toLowerCase();
      const matches = db.prepare("select * from channels where type = 'dm' and server_id = ?").all(serverId)
        .map(rowChannel)
        .filter((channel) => {
          const agent = dmPeerAgentForChannel(channel);
          return agent && (agent.name.toLowerCase() === handle || agent.displayName.toLowerCase() === handle);
        });
      // 缺少 Human/Agent 调用方时不能创建或猜测 DM；同名多 pair 也必须显式使用 channel id。
      const dm = matches.length === 1 ? matches[0] : null;
      if (!dm) return null;
      if (!threadShort) return dm;
      const normalizedThreadShort = threadShort.replace(/^msg_/, "");
      const thread = db.prepare(
        `select * from channels
         where type = 'thread' and parent_channel_id = ?
         and (name = ? or name = ? or id like ? or parent_message_id = ? or parent_message_id like ?)`
      ).get(dm.id, `thread-${threadShort}`, `thread-${normalizedThreadShort}`, `${threadShort}%`, threadShort, `${threadShort}%`);
      return thread ? rowChannel(thread) : null;
    }
    const byId = db.prepare("select * from channels where id = ?").get(trimmed);
    return byId ? rowChannel(byId) : null;
  }

  function ensureHumanAgentDm(agent: AgentRecord, requesterUserId: string): ChannelRecord | null {
    const serverId = getActiveServerIdForUser(requesterUserId) ?? agent.serverId ?? (agent.machineId ? getMachine(agent.machineId)?.serverId : undefined) ?? "local";
    const name = slugifyName(`dm-${requesterUserId}-${agent.id}`) || `dm-${agent.id}`;
    const identity: DmIdentity = { kind: "human_agent", humanUserId: requesterUserId, agentId: agent.id };
    const existing = db.prepare("select * from channels where type = 'dm' and name = ? and server_id = ?").get(name, serverId);
    if (existing) {
      const channel = rowChannel(existing);
      const existingIdentity = channel.dmIdentity;
      if (
        existingIdentity &&
        (existingIdentity.kind !== "human_agent" ||
          existingIdentity.humanUserId !== requesterUserId ||
          existingIdentity.agentId !== agent.id)
      ) return null;
      // 稳定名称已唯一证明 pair 时可以安全覆盖损坏的身份序列化值。
      if (!existingIdentity) db.prepare("update channels set dm_identity = ? where id = ?").run(serializeDmIdentity(identity), channel.id);
      synchronizeFixedDmCompatibilityMemberships(channel.id, identity);
      ensureActiveConversation(channel.id, { type: "human", id: requesterUserId });
      return refreshedChannel(channel.id);
    }
    const createdAt = nowIso();
    const communicationAgent = isCommunicationAgent(agent);
    const channel: ChannelRecord = {
      id: id("dm"),
      serverId,
      type: "dm",
      name,
      displayName: communicationAgent ? "TYR DM" : `DM @${agent.name}`,
      dmIdentity: identity,
      visibility: "private",
      description: communicationAgent ? "Direct message with TYR" : `Direct message with @${agent.name}`,
      createdAt
    };
    db.prepare(
      `insert into channels (id, server_id, type, name, display_name, dm_identity, visibility, description, created_at)
       values (@id, @serverId, @type, @name, @displayName, @dmIdentity, @visibility, @description, @createdAt)`
    ).run({ ...channel, dmIdentity: serializeDmIdentity(identity) });
    // P0 DM 是人类和单个 Agent 的 pair channel，不能沿用 server member 可见的 legacy agent-name DM。
    synchronizeFixedDmCompatibilityMemberships(channel.id, identity);
    ensureActiveConversation(channel.id, { type: "human", id: requesterUserId });
    return refreshedChannel(channel.id);
  }

  function listMessages(channelId?: string, limit = 200, options: { includeExecutionMessages?: boolean } = {}): MessageRecord[] {
    const kindFilter = options.includeExecutionMessages ? "" : " and messages.kind = 'chat'";
    const rows = channelId
      ? db.prepare(
        `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
         from messages join channels on channels.id = messages.channel_id
         where messages.channel_id = ?${kindFilter}
         order by messages.seq desc limit ?`
      ).all(channelId, limit)
      : db.prepare(
        `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
         from messages join channels on channels.id = messages.channel_id
         where 1 = 1${kindFilter}
         order by messages.created_at desc limit ?`
      ).all(limit);
    return rows.reverse().map(rowMessage);
  }

  function listRuntimeExecutionOutputMessages(executionId: string): MessageRecord[] {
    return db.prepare(
      `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
       from messages join channels on channels.id = messages.channel_id
       where messages.source_execution_id = ?
       order by messages.created_at, messages.seq`
    ).all(executionId).map(rowMessage);
  }

  function listVisibleChannelIds(userId: string): string[] {
    return workspaceScope(userId).channelIds;
  }

  function listVisibleAgents(userId: string): AgentRecord[] {
    return workspaceScope(userId).agents;
  }

  function listVisibleMessages(userId: string, options: { channelId?: string; sinceSeq?: number; limit?: number } = {}): MessageRecord[] {
    const visibleChannelIds = listVisibleChannelIds(userId);
    const requestedChannelId = options.channelId?.trim();
    const channelIds = requestedChannelId
      ? visibleChannelIds.includes(requestedChannelId) ? [requestedChannelId] : []
      : visibleChannelIds;
    if (channelIds.length === 0) return [];
    const limit = Math.max(1, Math.min(typeof options.limit === "number" && Number.isFinite(options.limit) ? Math.floor(options.limit) : 200, 500));
    const placeholders = channelIds.map(() => "?").join(",");
    const where = [`messages.channel_id in (${placeholders})`, "messages.kind = 'chat'"];
    const args: unknown[] = [...channelIds];
    const sinceSeq = typeof options.sinceSeq === "number" && Number.isFinite(options.sinceSeq) ? Math.floor(options.sinceSeq) : undefined;
    if (sinceSeq !== undefined) {
      where.push("messages.seq > ?");
      args.push(sinceSeq);
    }
    const order = sinceSeq !== undefined ? "messages.seq asc" : "messages.created_at desc, messages.seq desc";
    const rows = db.prepare(
      `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
       from messages join channels on channels.id = messages.channel_id
       where ${where.join(" and ")}
       order by ${order} limit ?`
    ).all(...args, limit);
    const messages = rows.map(rowMessage);
    return sinceSeq !== undefined ? messages : messages.reverse();
  }

  function latestVisibleMessageSeq(userId: string, channelId?: string): number {
    const visibleChannelIds = listVisibleChannelIds(userId);
    const channelIds = channelId
      ? visibleChannelIds.includes(channelId) ? [channelId] : []
      : visibleChannelIds;
    if (channelIds.length === 0) return 0;
    const row = db.prepare(`select max(seq) as seq from messages where channel_id in (${channelIds.map(() => "?").join(",")}) and kind = 'chat'`).get(...channelIds) as { seq?: number } | undefined;
    return Number(row?.seq ?? 0);
  }

  function getMessage(messageId: string): MessageRecord | null {
    const row = db.prepare(
      `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
       from messages join channels on channels.id = messages.channel_id
       where messages.id = ? or messages.id like ?
       order by messages.created_at desc
       limit 1`
    ).get(messageId, `${messageId}%`);
    return row ? rowMessage(row) : null;
  }

  function softDeleteMessage(messageId: string, deletedByUserId: string, reason: NonNullable<MessageRecord["deletionReason"]> = "user_deleted"): MessageRecord | null {
    const message = getMessage(messageId);
    if (!message) return null;
    const deletedAt = message.deletedAt ?? nowIso();
    db.prepare(
      `update messages
       set deleted_at = coalesce(deleted_at, ?),
           deleted_by_user_id = coalesce(deleted_by_user_id, ?),
           deletion_reason = coalesce(deletion_reason, ?)
       where id = ?`
    ).run(deletedAt, deletedByUserId, reason, message.id);
    return getMessage(message.id);
  }

  function conversationFilterForChannel(channel: ChannelRecord, options: { scope?: MessageHistoryScope; conversationId?: string } = {}): string | null {
    if (channel.type !== "dm") return null;
    if (options.scope === "dm_history") return null;
    if (options.conversationId) return options.conversationId;
    return channel.activeConversationId ?? getActiveConversation(channel.id)?.id ?? null;
  }

  function readHistory(target: string, limit = 50, around?: string | number, before?: number, after?: number, serverId = "local", options: { scope?: MessageHistoryScope; conversationId?: string } = {}) {
    const channel = resolveTarget(target, serverId);
    if (!channel) return null;
    const max = Math.max(1, Math.min(limit, 100));
    const scopedConversationId = conversationFilterForChannel(channel, options);
    const conversationWhere = scopedConversationId ? " and messages.conversation_id = ?" : "";
    const conversationArgs = scopedConversationId ? [scopedConversationId] : [];
    let rows: any[];
    if (around !== undefined) {
      const center = typeof around === "number" ? around : Number(around);
      let seq = Number.isFinite(center) ? center : null;
      if (!seq) {
        const hit = db.prepare(`select seq from messages where channel_id = ?${conversationWhere} and (id = ? or id like ?) and kind = 'chat'`).get(channel.id, ...conversationArgs, String(around), `${String(around)}%`) as { seq?: number } | undefined;
        seq = hit?.seq ?? null;
      }
      rows = db.prepare(
        `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
         from messages join channels on channels.id = messages.channel_id
         where messages.channel_id = ?${conversationWhere} and messages.kind = 'chat' and messages.seq between ? and ?
         order by messages.seq asc`
      ).all(channel.id, ...conversationArgs, Math.max(0, (seq ?? 0) - Math.floor(max / 2)), (seq ?? 0) + Math.floor(max / 2));
    } else if (after !== undefined) {
      rows = db.prepare(
        `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
         from messages join channels on channels.id = messages.channel_id
         where messages.channel_id = ?${conversationWhere} and messages.kind = 'chat' and messages.seq > ?
         order by messages.seq asc limit ?`
      ).all(channel.id, ...conversationArgs, after, max);
    } else if (before !== undefined) {
      rows = db.prepare(
        `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
         from messages join channels on channels.id = messages.channel_id
         where messages.channel_id = ?${conversationWhere} and messages.kind = 'chat' and messages.seq < ?
         order by messages.seq desc limit ?`
      ).all(channel.id, ...conversationArgs, before, max).reverse();
    } else {
      rows = db.prepare(
        `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
         from messages join channels on channels.id = messages.channel_id
         where messages.channel_id = ?${conversationWhere} and messages.kind = 'chat'
         order by messages.seq desc limit ?`
      ).all(channel.id, ...conversationArgs, max).reverse();
    }
    return {
      channel,
      messages: rows.map(rowMessage),
      has_more: rows.length >= max,
      has_older: rows.length >= max,
      has_newer: false,
      last_read_seq: 0
    };
  }

  function readConversationHistory(conversationId: string, limit = 50, around?: string | number, before?: number, after?: number): ReadHistoryResult | null {
    const conversation = getConversation(conversationId);
    if (!conversation) return null;
    return readHistory(conversation.channelId, limit, around, before, after, conversation.serverId ?? "local", { conversationId: conversation.id });
  }

  function readHistoryForAgent(agentId: string, target: string, limit = 50, around?: string | number, before?: number, after?: number, serverId = "local", options: { scope?: MessageHistoryScope; conversationId?: string } = {}): ReadHistoryResult | null {
    const channel = resolveTarget(target, serverId);
    if (!channel || !canAgentAccessChannel(agentId, channel.id)) return null;
    return readHistory(channel.id, limit, around, before, after, serverId, options);
  }

  function searchMessages(query: string, opts: { channel?: string; conversationId?: string; scope?: MessageHistoryScope; limit?: number; serverId?: string; senderId?: string; before?: string; after?: string; sort?: "recent" | "relevance"; agentId?: string; userId?: string } = {}): Array<MessageRecord & { snippet: string }> {
    const like = `%${query}%`;
    const max = Math.max(1, Math.min(opts.limit ?? 10, 200));
    const channel = opts.channel ? resolveTarget(opts.channel, opts.serverId) : null;
    const scope = opts.scope ?? "conversation";
    const where = ["messages.content like ?", "messages.deleted_at is null", "messages.kind = 'chat'"];
    const args: unknown[] = [like];
    if (channel) {
      if (opts.agentId && !canAgentAccessChannel(opts.agentId, channel.id)) return [];
      if (opts.userId && !canUserAccessChannel(opts.userId, channel.id)) return [];
      where.push("messages.channel_id = ?");
      args.push(channel.id);
      const scopedConversationId = conversationFilterForChannel(channel, { scope, conversationId: opts.conversationId });
      if (scopedConversationId) {
        where.push("messages.conversation_id = ?");
        args.push(scopedConversationId);
      }
    } else if (opts.serverId) {
      where.push("channels.server_id = ?");
      args.push(opts.serverId);
    }
    if (opts.senderId) {
      where.push("(messages.sender_id = ? or messages.sender_name = ?)");
      args.push(opts.senderId, opts.senderId.replace(/^@/, ""));
    }
    if (opts.after) {
      where.push("messages.created_at >= ?");
      args.push(opts.after);
    }
    if (opts.before) {
      where.push("messages.created_at <= ?");
      args.push(opts.before);
    }
    const order = opts.sort === "relevance"
      ? "case when lower(messages.content) = lower(?) then 0 else 1 end, messages.created_at desc"
      : "messages.created_at desc";
    if (opts.sort === "relevance") args.push(query);
    args.push(max);
    const rows = db.prepare(
      `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
       from messages join channels on channels.id = messages.channel_id
       where ${where.join(" and ")}
       order by ${order} limit ?`
    ).all(...args);
    return rows
      .map((row: any) => ({ ...rowMessage(row), snippet: row.deleted_at ? "" : row.content }))
      .filter((message) => !opts.agentId || canAgentAccessChannel(opts.agentId, message.channelId))
      .filter((message) => !opts.userId || canUserAccessChannel(opts.userId, message.channelId));
  }

  function saveMessage(userId: string, messageId: string): void {
    db.prepare("insert or ignore into saved_messages (user_id, message_id, created_at) values (?, ?, ?)").run(userId, messageId, nowIso());
  }

  function unsaveMessage(userId: string, messageId: string): void {
    db.prepare("delete from saved_messages where user_id = ? and message_id = ?").run(userId, messageId);
  }

  function toggleMessageReaction(userId: string, messageId: string, emoji: string): { success: boolean; active?: boolean; message?: MessageRecord; reason?: string } {
    const normalizedEmoji = emoji.trim() as MessageReactionEmoji;
    if (!SUPPORTED_MESSAGE_REACTIONS.includes(normalizedEmoji)) return { success: false, reason: "unsupported_reaction" };
    const row = db.prepare(
      `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
       from messages
       join channels on channels.id = messages.channel_id
       where messages.id = ?`
    ).get(messageId);
    if (!row) return { success: false, reason: "message_not_found" };
    const existing = db.prepare("select 1 from message_reactions where message_id = ? and user_id = ? and emoji = ?").get(messageId, userId, normalizedEmoji);
    if (existing) {
      // Reaction 是用户对单条消息的私有 toggle，再次点击同一 emoji 表示撤回。
      db.prepare("delete from message_reactions where message_id = ? and user_id = ? and emoji = ?").run(messageId, userId, normalizedEmoji);
    } else {
      db.prepare("insert into message_reactions (message_id, user_id, emoji, created_at) values (?, ?, ?, ?)").run(messageId, userId, normalizedEmoji, nowIso());
    }
    const updated = db.prepare(
      `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
       from messages
       join channels on channels.id = messages.channel_id
       where messages.id = ?`
    ).get(messageId);
    return { success: true, active: !existing, message: rowMessage(updated) };
  }

  function listSavedMessages(userId: string, limit = 20, offset = 0): MessageRecord[] {
    const rows = db.prepare(
      `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
       from saved_messages
       join messages on messages.id = saved_messages.message_id
       join channels on channels.id = messages.channel_id
       where saved_messages.user_id = ?
       order by saved_messages.created_at desc
       limit ? offset ?`
    ).all(userId, Math.max(1, Math.min(limit, 100)), Math.max(0, offset));
    return rows.map(rowMessage);
  }

  function markChannelUnread(userId: string, channelId: string): { unreadCount: number; firstUnreadMessageId?: string } {
    const message = db.prepare("select id from messages where channel_id = ? and kind = 'chat' order by seq desc limit 1").get(channelId) as { id?: string } | undefined;
    if (!message?.id) return { unreadCount: 0 };
    db.prepare(
      `insert into channel_unread_marks (user_id, channel_id, first_message_id, unread_count, updated_at)
       values (?, ?, ?, 1, ?)
       on conflict(user_id, channel_id) do update set first_message_id = excluded.first_message_id, unread_count = 1, updated_at = excluded.updated_at`
    ).run(userId, channelId, message.id, nowIso());
    return { unreadCount: 1, firstUnreadMessageId: message.id };
  }

  function markMessageUnread(userId: string, messageId: string): { success: boolean; channelId?: string; unreadCount?: number; firstUnreadMessageId?: string; reason?: string } {
    const message = db.prepare("select id, channel_id, seq from messages where id = ? and kind = 'chat'").get(messageId) as { id: string; channel_id: string; seq: number } | undefined;
    if (!message) return { success: false, reason: "message_not_found" };
    if (!canUserAccessChannel(userId, message.channel_id)) return { success: false, reason: "message_not_found" };
    const unreadCount = Number(db.prepare("select count(*) from messages where channel_id = ? and kind = 'chat' and seq >= ?").pluck().get(message.channel_id, message.seq) ?? 0);
    db.prepare(
      `insert into channel_unread_marks (user_id, channel_id, first_message_id, unread_count, updated_at)
       values (?, ?, ?, ?, ?)
       on conflict(user_id, channel_id) do update set first_message_id = excluded.first_message_id, unread_count = excluded.unread_count, updated_at = excluded.updated_at`
    ).run(userId, message.channel_id, message.id, unreadCount, nowIso());
    return { success: true, channelId: message.channel_id, unreadCount, firstUnreadMessageId: message.id };
  }

  function markChannelRead(userId: string, channelId: string): void {
    db.prepare("delete from channel_unread_marks where user_id = ? and channel_id = ?").run(userId, channelId);
  }

  function listUnreadCounts(userId: string): Record<string, number> {
    const rows = db.prepare("select channel_id, unread_count from channel_unread_marks where user_id = ?").all(userId) as Array<{ channel_id: string; unread_count: number }>;
    return Object.fromEntries(rows.map((row) => [row.channel_id, row.unread_count]));
  }

  function listUnreadMarks(userId: string): Record<string, UnreadMarkRecord> {
    const rows = db.prepare("select channel_id, first_message_id, unread_count from channel_unread_marks where user_id = ?").all(userId) as Array<{ channel_id: string; first_message_id: string | null; unread_count: number }>;
    return Object.fromEntries(rows.map((row) => [row.channel_id, {
      unreadCount: row.unread_count,
      firstUnreadMessageId: maybeString(row.first_message_id) ?? null
    }]));
  }

  function publicSenderType(type: MessageRecord["senderType"]): PublicSenderType {
    return type === "human" ? "user" : type;
  }

  function inboxMessagePreview(message: Pick<MessageRecord, "content" | "deletedAt">): string {
    // Inbox 仍保留 deleted message 作为 activity key，但 preview 不能泄露原正文。
    return message.deletedAt ? "Message deleted" : message.content;
  }

  function messageById(messageId: string): MessageRecord | null {
    const row = db.prepare(
      `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
       from messages join channels on channels.id = messages.channel_id
       where messages.id = ?`
    ).get(messageId);
    return row ? rowMessage(row) : null;
  }

  function latestMessageForChannel(channelId: string): MessageRecord | null {
    const row = db.prepare(
      `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
       from messages join channels on channels.id = messages.channel_id
       where messages.channel_id = ? and messages.kind = 'chat'
       order by messages.seq desc limit 1`
    ).get(channelId);
    return row ? rowMessage(row) : null;
  }

  function visibleInboxChannelsForUser(userId: string): ChannelRecord[] {
    const activeServerId = getActiveServerIdForUser(userId) ?? "local";
    const allChannels = db.prepare("select * from channels order by server_id, type, name").all().map(rowChannel);
    const baseChannels = allChannels.filter((channel) => {
      // 当前 Inbox 只聚合 Human-Agent DM；历史群聊不能通过未读页重新暴露。
      if (channel.type !== "dm") return false;
      const sameServer = (channel.serverId ?? "local") === activeServerId;
      // Historical channel grants stay cold and must not make conversations visible across workspaces.
      return sameServer && canUserAccessChannel(userId, channel.id);
    });
    const baseIds = new Set(baseChannels.map((channel) => channel.id));
    const threadChannels = allChannels.filter((channel) => (
      channel.type === "thread" &&
      Boolean(channel.parentChannelId) &&
      baseIds.has(channel.parentChannelId!) &&
      canUserAccessChannel(userId, channel.id)
    ));
    return [...baseChannels, ...threadChannels];
  }

  function inboxItemTimestamp(item: InboxItem): string {
    return item.kind === "thread" ? item.lastActivityAt : item.lastMessageAt;
  }

  function compareInboxItems(left: InboxItem, right: InboxItem): number {
    const byTime = inboxItemTimestamp(right).localeCompare(inboxItemTimestamp(left));
    if (byTime !== 0) return byTime;
    return right.itemKey.localeCompare(left.itemKey);
  }

  function encodeInboxCursor(item: InboxItem): string {
    return Buffer.from(JSON.stringify({ at: inboxItemTimestamp(item), key: item.itemKey }), "utf8").toString("base64url");
  }

  function decodeInboxCursor(cursor: string | undefined): { at: string; key: string } | null {
    if (!cursor) return null;
    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { at?: unknown; key?: unknown };
      if (typeof parsed.at !== "string" || typeof parsed.key !== "string") return null;
      return { at: parsed.at, key: parsed.key };
    } catch {
      return null;
    }
  }

  function isAfterInboxCursor(item: InboxItem, cursor: { at: string; key: string }): boolean {
    const at = inboxItemTimestamp(item);
    return at < cursor.at || (at === cursor.at && item.itemKey < cursor.key);
  }

  function listInboxItemsForUser(userId: string, options: InboxListOptions = {}): InboxResponse {
    const max = Math.max(1, Math.min(options.limit ?? 30, 50));
    const offset = Math.max(0, options.offset ?? 0);
    const cursor = decodeInboxCursor(options.cursor);
    const unreadMarks = listUnreadMarks(userId);
    const channels = visibleInboxChannelsForUser(userId);
    const channelById = new Map(channels.map((channel) => [channel.id, channel]));

    const items = channels.map((channel): InboxItem | null => {
      if (channel.type === "channel" || channel.type === "dm") {
        const last = latestMessageForChannel(channel.id);
        if (!last) return null;
        const unread = unreadMarks[channel.id];
        if (!unread || unread.unreadCount <= 0) return null;
        const firstUnreadMessage = unread?.firstUnreadMessageId ? messageById(unread.firstUnreadMessageId) : null;
        return {
          kind: "channel",
          itemKey: last.id,
          channelId: channel.id,
          channelName: channel.name,
          channelDisplayName: channel.displayName,
          channelType: channel.type,
          lastMessageId: last.id,
          lastMessageConversationId: last.conversationId ?? null,
          firstUnreadMessageId: unread?.firstUnreadMessageId ?? null,
          firstUnreadConversationId: firstUnreadMessage?.conversationId ?? null,
          lastMessageAt: last.createdAt,
          lastMessagePreview: inboxMessagePreview(last),
          lastMessageSenderType: publicSenderType(last.senderType),
          lastMessageSenderId: last.senderId,
          lastMessageSenderName: last.senderName,
          unreadCount: unread?.unreadCount ?? 0,
        };
      }

      if (!channel.parentChannelId || !channel.parentMessageId) return null;
      const parentChannel = channelById.get(channel.parentChannelId);
      const parentMessage = messageById(channel.parentMessageId);
      const latest = latestMessageForChannel(channel.id);
      if (!parentChannel || !parentMessage || !latest) return null;
      const unread = unreadMarks[channel.id];
      if (!unread || unread.unreadCount <= 0) return null;
      const replyCount = Number(db.prepare("select count(*) from messages where channel_id = ? and kind = 'chat'").pluck().get(channel.id) ?? 0);
      return {
        kind: "thread",
        itemKey: latest.id,
        threadChannelId: channel.id,
        parentMessageId: parentMessage.id,
        parentChannelId: parentChannel.id,
        parentChannelName: parentChannel.name,
        parentChannelDisplayName: parentChannel.displayName,
        parentChannelType: parentChannel.type,
        parentMessagePreview: inboxMessagePreview(parentMessage),
        parentMessageSenderType: publicSenderType(parentMessage.senderType),
        parentMessageSenderId: parentMessage.senderId,
        latestActivityPreview: inboxMessagePreview(latest),
        latestActivitySenderType: publicSenderType(latest.senderType),
        latestActivitySenderId: latest.senderId,
        latestActivityMessageId: latest.id,
        firstUnreadMessageId: unread?.firstUnreadMessageId ?? null,
        lastActivityAt: latest.createdAt,
        lastReplyAt: latest.createdAt,
        replyCount,
        unreadCount: unread?.unreadCount ?? 0
      };
    }).filter((item): item is InboxItem => Boolean(item)).sort(compareInboxItems);

    const cursorItems = cursor ? items.filter((item) => isAfterInboxCursor(item, cursor)) : items.slice(offset);
    const pageItems = cursorItems.slice(0, max);
    const hasMore = cursorItems.length > max;

    return {
      items: pageItems,
      hasMore,
      nextCursor: hasMore && pageItems.length > 0 ? encodeInboxCursor(pageItems[pageItems.length - 1]) : null,
      totalCount: items.length,
      totalUnreadCount: items.reduce((sum, item) => sum + item.unreadCount, 0)
    };
  }

  function sendMessage(input: SendMessageInput): { message: MessageRecord; task?: TaskRecord; recentUnread: MessageRecord[] } {
    const channel = resolveTarget(input.target, input.serverId);
    if (!channel) throw new Error(`Unknown target: ${input.target}`);
    const parent = channel.type === "thread" && channel.parentChannelId
      ? resolveTarget(channel.parentChannelId, channel.serverId ?? input.serverId)
      : null;
    // 普通群聊及其 thread 只做冷数据保留，任何内部调用也不能继续追加消息。
    if (channel.type === "channel" || (channel.type === "thread" && parent?.type !== "dm")) {
      throw new Error("group_channel_unavailable");
    }
    if (input.senderType === "human" && !canUserAccessChannel(input.senderId, channel.id)) {
      throw new Error("dm_sender_forbidden");
    }
    if (input.senderType === "agent" && !canAgentSendToChannel(input.senderId, channel.id)) {
      throw new Error("dm_sender_forbidden");
    }
    // System 事件可以写固定 DM，但异常无身份 DM 仍必须封闭，不能成为绕过 sender ACL 的入口。
    if (input.senderType === "system" && !((channel.type === "dm" ? channel : parent)?.dmIdentity)) {
      throw new Error("dm_identity_required");
    }
    if (channel.archivedAt) throw new Error("channel_archived");
    const quoteMessageId = input.quoteMessageId?.trim() || null;
    if (quoteMessageId) {
      const quote = db.prepare(
        `select messages.id, channels.server_id
         from messages
         join channels on channels.id = messages.channel_id
         where messages.id = ?`
      ).get(quoteMessageId) as { id: string; server_id: string } | undefined;
      if (!quote || quote.server_id !== (channel.serverId ?? "local")) throw new Error("quote_not_found");
    }
    const createdAt = nowIso();
    const seq = ((db.prepare("select max(seq) from messages where channel_id = ?").pluck().get(channel.id) as number | null) ?? 0) + 1;
    const messageKind: MessageKind = input.kind === "delegation" ? "delegation" : "chat";
    let conversationId: string | undefined;
    if (channel.type === "dm") {
      const requestedConversation = input.conversationId ? getConversation(input.conversationId) : null;
      if (input.conversationId && !requestedConversation) throw new Error("conversation_not_found");
      if (requestedConversation && requestedConversation.channelId !== channel.id) throw new Error("conversation_channel_mismatch");
      const personalReplyAllowed = input.personalReplyRequestId && input.senderType === "human" && requestedConversation &&
        db.prepare(`select 1 from workspace_bridge_human_replies h join messages notice on notice.id = h.notice_message_id
          where h.request_id = ? and h.owner_user_id = ? and h.status = 'waiting'
          and notice.channel_id = ? and notice.conversation_id = ?`)
          .get(input.personalReplyRequestId, input.senderId, channel.id, requestedConversation.id);
      if (
        requestedConversation &&
        requestedConversation.status !== "active" &&
        !(input.allowClosedConversation && (input.senderType !== "human" || personalReplyAllowed))
      ) throw new Error("conversation_closed");
      // 用户输入只进入唯一 active conversation；已在运行的内部 Agent 回传可完成到原会话，不能污染后来新建的上下文。
      const activeConversation = requestedConversation ?? ensureActiveConversation(channel.id, { type: input.senderType, id: input.senderId });
      if (!activeConversation) throw new Error("conversation_not_found");
      conversationId = activeConversation.id;
    }
    const message: MessageRecord = {
      id: id("msg"),
      channelId: channel.id,
      conversationId,
      channelName: channel.name,
      channelDisplayName: channel.displayName,
      channelType: channel.type,
      kind: messageKind,
      senderType: input.senderType,
      senderId: input.senderId,
      senderName: input.senderName,
      content: input.content,
      result: input.result,
      sourceExecutionId: input.sourceExecutionId,
      seq,
      attachmentIds: input.attachmentIds ?? [],
      quote: messageQuoteSummary(quoteMessageId),
      createdAt
    };
    db.prepare(
      `insert into messages (id, channel_id, conversation_id, kind, sender_type, sender_id, sender_name, content, result_payload, source_execution_id, seq, attachment_ids, quote_message_id, created_at)
       values (@id, @channelId, @conversationId, @kind, @senderType, @senderId, @senderName, @content, @resultPayload, @sourceExecutionId, @seq, @attachmentIds, @quoteMessageId, @createdAt)`
    ).run({
      ...message,
      resultPayload: message.result ? stringify(message.result as unknown as JsonValue) : null,
      sourceExecutionId: message.sourceExecutionId ?? null,
      attachmentIds: stringify(message.attachmentIds as JsonValue[]),
      quoteMessageId
    });
    if (conversationId) {
      db.prepare("update conversations set last_message_at = ? where id = ?").run(createdAt, conversationId);
      if (input.senderType === "human" && messageKind === "chat") {
        const humanMessageCount = Number(db.prepare(
          "select count(*) from messages where conversation_id = ? and sender_type = 'human' and kind = 'chat'"
        ).pluck().get(conversationId) ?? 0);
        if (humanMessageCount === 1) {
          const conversation = getConversation(conversationId);
          const generatedTitle = conversation?.startedByType === "human"
            ? conversationTitleFromContent(input.content)
            : conversation?.startedByType === "system"
              ? "Conversation history"
              : "";
          // 只有用户创建的新会话按首条消息命名；系统迁移出的旧容器可能混有多个主题，不能猜测标题。
          if (generatedTitle) {
            db.prepare("update conversations set title = ? where id = ? and title = 'New conversation'").run(generatedTitle, conversationId);
          }
        }
      }
    }
    for (const ref of input.deviceRefs ?? []) {
      db.prepare(
        `insert or ignore into message_device_refs (message_id, device_id, capability, created_at)
         values (?, ?, ?, ?)`
      ).run(message.id, ref.deviceId, ref.capability, createdAt);
    }
    message.deviceRefs = input.deviceRefs ?? [];
    if (input.senderType === "agent") {
      const senderAgent = getAgent(input.senderId);
      const senderMachine = senderAgent?.machineId ? getMachine(senderAgent.machineId) : null;
      if (senderAgent && senderMachine && (senderMachine.serverId ?? "local") !== (channel.serverId ?? "local")) {
        recordAuditEvent({
          kind: "shared_channel_message_sent_by_remote_agent",
          actorType: "agent",
          actorId: senderAgent.id,
          resourceType: "message",
          resourceId: message.id,
          serverId: channel.serverId ?? "local",
          metadata: { channelId: channel.id, agentServerId: senderMachine.serverId ?? "local" }
        });
      }
    }
    let task: TaskRecord | undefined;
    if (input.asTask) {
      task = createTaskForMessage(channel, message, input.task?.title || message.content, input.senderType, input.senderId, input.senderName, input.task);
    }
    // Delegation messages are execution payloads; P0-B will enqueue them explicitly with an execution id.
    if (message.result?.sourceHumanName) {
      // The trusted handoff attaches provenance after this insert, in the same transaction. Its
      // publisher reloads that verified record; generic callers cannot fan out a forged badge.
      message.result = { ...message.result };
      delete message.result.sourceHumanName;
    }
    if (message.kind === "chat") enqueueForAgents(message);
    return { message, task, recentUnread: [] };
  }

  function createDelegationMessage(input: { channelId: string; conversationId?: string; serverId: string; senderAgent: AgentRecord; targetAgent: AgentRecord; instruction: string; attachmentIds?: string[] }): MessageRecord {
    const channel = resolveTarget(input.channelId, input.serverId);
    if (!channel || (channel.serverId ?? "local") !== input.serverId) throw new Error("delegation_channel_not_found");
    if (!canAgentSendToChannel(input.senderAgent.id, channel.id)) throw new Error("delegation_sender_forbidden");
    if (!canAgentAccessChannel(input.targetAgent.id, channel.id)) throw new Error("delegation_target_forbidden");
    return sendMessage({
      target: channel.id,
      conversationId: input.conversationId,
      content: input.instruction,
      kind: "delegation",
      senderType: "agent",
      senderId: input.senderAgent.id,
      senderName: input.senderAgent.name,
      attachmentIds: input.attachmentIds ?? [],
      serverId: input.serverId
    }).message;
  }

  function mentionedAgents(content: string, agents: AgentRecord[]): AgentRecord[] {
    const lowerContent = content.toLowerCase();
    const mentionTokens = [...lowerContent.matchAll(/@([^\s，,。；;：:]+)/g)];
    return agents
      .map((agent) => {
        const aliases = new Set([agent.name.toLowerCase(), agent.displayName.toLowerCase()]);
        const mention = mentionTokens.find((item) => aliases.has(item[1]));
        return mention ? { agent, mentionIndex: mention.index ?? 0 } : null;
      })
      .filter((item): item is { agent: AgentRecord; mentionIndex: number } => Boolean(item))
      // 协调类消息以第一个 @ 作为主执行者，后续 @ 是参与者或被委派对象。
      .sort((a, b) => a.mentionIndex - b.mentionIndex)
      .map((item) => item.agent);
  }

  function uniqueAgents(agents: Array<AgentRecord | null | undefined>): AgentRecord[] {
    const seen = new Set<string>();
    const out: AgentRecord[] = [];
    for (const agent of agents) {
      if (!agent || seen.has(agent.id)) continue;
      seen.add(agent.id);
      out.push(agent);
    }
    return out;
  }

  function runtimeWakeAgents(agents: AgentRecord[]): AgentRecord[] {
    return agents.filter((agent) => !isCommunicationAgent(agent) && Boolean(agent.machineId && agent.runtime));
  }

  function preferredAgentForMessageTask(task: TaskRecord | null, channel: ChannelRecord, agents: AgentRecord[], mentions: AgentRecord[]): AgentRecord | null {
    if (task?.assigneeAgentId) return agents.find((agent) => agent.id === task.assigneeAgentId) ?? null;
    if (channel.type === "dm") {
      if (channel.dmPeerAgentId) return agents.find((agent) => agent.id === channel.dmPeerAgentId) ?? null;
      const dmName = channel.name.toLowerCase();
      const dmAgent = agents.find((agent) => agent.name.toLowerCase() === dmName || agent.displayName.toLowerCase() === dmName);
      if (dmAgent) return dmAgent;
    }
    return mentions[0] ?? agents.find((agent) => agent.status === "online") ?? agents[0] ?? null;
  }

  function taskForMessage(messageId: string): TaskRecord | null {
    const row = db.prepare(
      `select tasks.*, agents.name as assignee_name, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type, thread.id as thread_channel_id
       from tasks
       left join agents on agents.id = tasks.assignee_agent_id
       join channels on channels.id = tasks.channel_id
       left join channels thread on thread.type = 'thread' and thread.parent_message_id = tasks.message_id
       where tasks.message_id = ?`
    ).get(messageId);
    return row ? rowTask(row) : null;
  }

  function selectWakeTargets(message: MessageRecord): AgentRecord[] {
    if (message.senderType !== "human") return [];
    const channel = db.prepare("select * from channels where id = ?").get(message.channelId) as any;
    if (!channel) return [];
    const channelRecord = rowChannel(channel);
    if (channelRecord.type === "channel") return [];
    const memberAgentRows = db.prepare(
      `select agents.*
       from channel_members
       join agents on agents.id = channel_members.subject_id
       where channel_members.channel_id = ?
       and channel_members.subject_type = 'agent'
       and channel_members.left_at is null
       and agents.deleted_at is null
       order by agents.created_at`
    ).all(channelRecord.id).map(rowAgent);
    const agents = runtimeWakeAgents(uniqueAgents([...listAgents(channelRecord.serverId ?? "local"), ...memberAgentRows]));
    const mentions = mentionedAgents(message.content, agents).filter((agent) => canAgentAccessChannel(agent.id, channelRecord.id));
    if (channelRecord.type === "dm") {
      return runtimeWakeAgents(uniqueAgents(memberAgentRows.filter((agent) => canAgentAccessChannel(agent.id, channelRecord.id))));
    }
    const task = taskForMessage(message.id);
    if (task) {
      const candidate = preferredAgentForMessageTask(task, channelRecord, agents.filter((agent) => canAgentAccessChannel(agent.id, channelRecord.id)), mentions);
      return uniqueAgents([candidate]);
    }
    if (channelRecord.type === "thread") {
      const parentDm = channelRecord.parentChannelId
        ? resolveTarget(channelRecord.parentChannelId, channelRecord.serverId ?? "local")
        : null;
      const peerAgent = parentDm?.type === "dm" && parentDm.dmPeerAgentId
        ? agents.find((agent) => agent.id === parentDm.dmPeerAgentId)
        : null;
      // 可见 thread 继承固定 Human-Agent DM identity；普通回复默认交给该 DM 的唯一 Runtime Agent。
      if (peerAgent && canAgentAccessChannel(peerAgent.id, channelRecord.id)) return [peerAgent];
      const parentTask = channelRecord.parentMessageId ? taskForMessage(channelRecord.parentMessageId) : null;
      const assignee = parentTask?.assigneeAgentId ? agents.find((agent) => agent.id === parentTask.assigneeAgentId) : null;
      const followerRows = db.prepare("select subject_id from thread_follows where thread_channel_id = ? and subject_type = 'agent' and unfollowed_at is null").all(channelRecord.id) as Array<{ subject_id: string }>;
      const followers = followerRows.map((row) => agents.find((agent) => agent.id === row.subject_id));
      return uniqueAgents([...mentions, assignee, ...followers].filter((agent) => !agent || canAgentAccessChannel(agent.id, channelRecord.id)));
    }
    if (mentions.length > 0) return uniqueAgents(mentions);
    const rows = db.prepare(
      `select agents.*
       from channel_members
       join agents on agents.id = channel_members.subject_id
       where channel_members.channel_id = ?
       and channel_members.subject_type = 'agent'
       and channel_members.left_at is null
       and channel_members.ordinary_delivery_enabled = 1
       and agents.deleted_at is null
       order by agents.created_at`
    ).all(channelRecord.id) as any[];
    return runtimeWakeAgents(rows.map(rowAgent));
  }

  function enqueueForAgents(message: MessageRecord): void {
    const insert = db.prepare("insert or ignore into agent_inbox (agent_id, message_id, seq, created_at, acked_at, execution_id) values (?, ?, ?, ?, null, null)");
    for (const agent of selectWakeTargets(message)) {
      if (!hasAgentCapability(agent.id, "inbox:receive")) continue;
      insert.run(agent.id, message.id, message.seq, nowIso());
    }
  }

  function enqueueForAgent(agentId: string, messageId: string, executionId?: string): void {
    if (!hasAgentCapability(agentId, "inbox:receive")) return;
    const message = db.prepare("select id, seq, channel_id from messages where id = ?").get(messageId) as { id: string; seq: number; channel_id: string } | undefined;
    // 显式 enqueue 也必须服从根 DM identity，防止旧 execution 或内部调用重新唤醒群聊 Agent。
    if (!message || !canAgentAccessChannel(agentId, message.channel_id)) return;
    db.prepare(
      `insert into agent_inbox (agent_id, message_id, seq, created_at, acked_at, execution_id)
       values (?, ?, ?, ?, null, ?)
       on conflict(agent_id, message_id) do update set
         seq = excluded.seq,
         created_at = excluded.created_at,
         acked_at = null,
         execution_id = excluded.execution_id`
    ).run(agentId, message.id, message.seq, nowIso(), executionId ?? null);
  }

  function hasPendingAgentInbox(agentId: string): boolean {
    const rows = db.prepare(
      `select messages.channel_id
       from agent_inbox
       join messages on messages.id = agent_inbox.message_id
       join channels on channels.id = messages.channel_id
       left join channels parent_channels on parent_channels.id = channels.parent_channel_id
       where agent_inbox.agent_id = ?
         and agent_inbox.acked_at is null
         and (messages.sender_type != 'agent' or agent_inbox.execution_id is not null)
         and (channels.type = 'dm' or (channels.type = 'thread' and parent_channels.type = 'dm'))`
    ).all(agentId) as Array<{ channel_id: string }>;
    return rows.some((row) => canAgentAccessChannel(agentId, row.channel_id));
  }

  function takeAgentInbox(agentId: string): MessageRecord[] {
    const rows = db.prepare(
      `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type, agent_inbox.execution_id as runtime_execution_id
       from agent_inbox
       join messages on messages.id = agent_inbox.message_id
       join channels on channels.id = messages.channel_id
       left join channels parent_channels on parent_channels.id = channels.parent_channel_id
       where agent_inbox.agent_id = ? and agent_inbox.acked_at is null
       and (messages.sender_type != 'agent' or agent_inbox.execution_id is not null)
       and (channels.type = 'dm' or (channels.type = 'thread' and parent_channels.type = 'dm'))
       order by agent_inbox.seq asc`
    ).all(agentId);
    return rows
      .filter((row: any) => canAgentAccessChannel(agentId, row.channel_id))
      .map((row: any) => ({ ...rowMessage(row), runtimeExecutionId: maybeString(row.runtime_execution_id) }));
  }

  function ackAgentInbox(agentId: string, messageIds: string[], seqs: number[] = []): void {
    const stmt = db.prepare("update agent_inbox set acked_at = ? where agent_id = ? and message_id = ?");
    const seqStmt = db.prepare("update agent_inbox set acked_at = ? where agent_id = ? and seq = ?");
    const at = nowIso();
    for (const messageId of messageIds) stmt.run(at, agentId, messageId);
    for (const seq of seqs) seqStmt.run(at, agentId, seq);
  }

  function setAgentChannelMembership(agentId: string, channelId: string, joined: boolean, ordinaryDeliveryEnabled = false): AgentChannelMembership {
    const agent = getAgent(agentId);
    const channelRow = db.prepare("select * from channels where id = ?").get(channelId);
    if (!isActiveAgent(agent)) throw new Error("agent_not_found");
    if (!channelRow) throw new Error("channel_not_found");
    const channel = rowChannel(channelRow);
    const machine = agent.machineId ? getMachine(agent.machineId) : null;
    if (isCommunicationAgent(agent) && channel.type !== "dm") throw new Error("communication_agent_channel_membership_not_supported");
    if (!isCommunicationAgent(agent) && !isActiveMachine(machine)) throw new Error("agent_not_found");
    const wasJoined = Boolean(activeChannelMember(channelId, "agent", agentId));
    const updatedAt = nowIso();
    db.prepare(
      `insert into agent_channel_memberships (agent_id, channel_id, joined, ordinary_delivery_enabled, updated_at)
       values (?, ?, ?, ?, ?)
       on conflict(agent_id, channel_id) do update set
         joined = excluded.joined,
         ordinary_delivery_enabled = excluded.ordinary_delivery_enabled,
         updated_at = excluded.updated_at`
    ).run(agentId, channelId, joined ? 1 : 0, ordinaryDeliveryEnabled ? 1 : 0, updatedAt);
    if (joined) {
      db.prepare(
        `insert into channel_members (channel_id, subject_type, subject_id, role, joined_at, left_at, ordinary_delivery_enabled)
         values (?, 'agent', ?, 'member', ?, null, ?)
         on conflict(channel_id, subject_type, subject_id) do update set
           left_at = null,
           ordinary_delivery_enabled = excluded.ordinary_delivery_enabled`
      ).run(channelId, agentId, updatedAt, ordinaryDeliveryEnabled ? 1 : 0);
    } else {
      db.prepare(
        `insert into channel_members (channel_id, subject_type, subject_id, role, joined_at, left_at, ordinary_delivery_enabled)
         values (?, 'agent', ?, 'member', ?, ?, 0)
         on conflict(channel_id, subject_type, subject_id) do update set
           left_at = excluded.left_at,
           ordinary_delivery_enabled = 0`
      ).run(channelId, agentId, updatedAt, updatedAt);
    }
    if (joined && !wasJoined && machine && (machine.serverId ?? "local") !== (channel.serverId ?? "local")) {
      recordAuditEvent({
        kind: "remote_agent_added_to_shared_channel",
        actorType: "system",
        actorId: null,
        resourceType: "channel",
        resourceId: channel.id,
        serverId: channel.serverId ?? "local",
        metadata: { agentId, agentServerId: machine.serverId ?? "local", ordinaryDeliveryEnabled }
      });
    }
    return { agentId, channelId, joined, ordinaryDeliveryEnabled, updatedAt };
  }

  function setHumanChannelMembership(userId: string, channelId: string, joined: boolean, role: ChannelHumanRole = "member"): ChannelMemberRecord {
    const updatedAt = nowIso();
    if (joined) {
      db.prepare(
        `insert into channel_members (channel_id, subject_type, subject_id, role, joined_at, left_at, ordinary_delivery_enabled)
         values (?, 'human', ?, ?, ?, null, 0)
         on conflict(channel_id, subject_type, subject_id) do update set
           role = excluded.role,
           left_at = null`
      ).run(channelId, userId, role, updatedAt);
    } else {
      db.prepare(
        `insert into channel_members (channel_id, subject_type, subject_id, role, joined_at, left_at, ordinary_delivery_enabled)
         values (?, 'human', ?, ?, ?, ?, 0)
         on conflict(channel_id, subject_type, subject_id) do update set left_at = excluded.left_at`
      ).run(channelId, userId, role, updatedAt, updatedAt);
    }
    return activeChannelMember(channelId, "human", userId) ?? {
      channelId,
      subjectType: "human",
      subjectId: userId,
      role,
      joinedAt: updatedAt,
      leftAt: joined ? null : updatedAt,
      ordinaryDeliveryEnabled: false
    };
  }

  function listChannelMembers(channelTarget: string, serverId = "local", opts: { includeAll?: boolean; viewerUserId?: string } = {}) {
    const channel = resolveTarget(channelTarget, serverId);
    if (!channel) return null;
    const membershipRows = db.prepare("select * from channel_members where channel_id = ? order by subject_type, joined_at").all(channel.id).map(rowChannelMember);
    const membershipBySubject = new Map(membershipRows.map((item) => [`${item.subjectType}:${item.subjectId}`, item]));
    const agentById = new Map<string, AgentRecord>();
    for (const agent of listAgents(channel.serverId ?? serverId)) agentById.set(agent.id, agent);
    for (const membership of membershipRows.filter((item) => item.subjectType === "agent")) {
      const agent = getAgent(membership.subjectId);
      if (isActiveAgent(agent)) agentById.set(agent.id, agent);
    }
    if (opts.viewerUserId) {
      for (const grant of listResourceGrants({ granteeUserId: opts.viewerUserId, resourceType: "agent", activeOnly: true })) {
        if (!grant.scopes.includes("message") && !grant.scopes.includes("task")) continue;
        const agent = getAgent(grant.resourceId);
        if (isActiveAgent(agent)) agentById.set(agent.id, { ...agent, access: { shared: true, scopes: grant.scopes } });
      }
    }
    const agents = Array.from(agentById.values()).map((agent) => {
      const membership = membershipBySubject.get(`agent:${agent.id}`);
      const joined = Boolean(membership && !membership.leftAt) && canAgentAccessChannel(agent.id, channel.id);
      return { ...agent, joined, ordinaryDeliveryEnabled: joined && Boolean(membership?.ordinaryDeliveryEnabled), role: membership?.role, joinedAt: membership?.joinedAt ?? null, leftAt: membership?.leftAt ?? null };
    }).filter((agent) => {
      if (isCommunicationAgent(agent)) return channel.type === "dm" && agent.joined;
      if (!opts.viewerUserId) return opts.includeAll || channel.visibility !== "private" || agent.joined;
      const scopes = resourceGrantScopesForUser(opts.viewerUserId, "agent", agent.id);
      const machine = agent.machineId ? getMachine(agent.machineId) : null;
      const ownedInChannelServer = agent.ownerUserId === opts.viewerUserId && (machine?.serverId ?? "local") === (channel.serverId ?? "local");
      return agent.joined || ownedInChannelServer || (channel.type === "dm" && grantScopesAllowAgentDmParticipation(scopes));
    })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const humanById = new Map<string, UserRecord>();
    for (const { id, name, displayName, email, description, avatarUrl, emailVerified, preferredLanguage, createdAt } of listServerMembers(channel.serverId ?? serverId)) {
      humanById.set(id, { id, name, displayName, email, description, avatarUrl, emailVerified, preferredLanguage, createdAt });
    }
    for (const membership of membershipRows.filter((item) => item.subjectType === "human")) {
      const row = db.prepare("select * from users where id = ?").get(membership.subjectId);
      if (row) humanById.set(membership.subjectId, rowUser(row));
    }
    return {
      channel,
      memberships: membershipRows,
      agents,
      humans: Array.from(humanById.values()).map(({ id, name, displayName, email, description, avatarUrl, emailVerified, preferredLanguage, createdAt }) => {
        const membership = membershipBySubject.get(`human:${id}`);
        return {
        id,
        name,
        displayName,
        email,
        description,
        avatarUrl,
        emailVerified,
        preferredLanguage,
        createdAt,
        joined: Boolean(membership && !membership.leftAt),
        role: membership?.role,
        joinedAt: membership?.joinedAt ?? null,
        leftAt: membership?.leftAt ?? null
      };
      }).filter((human) => opts.includeAll || channel.visibility !== "private" || human.joined)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    };
  }

  function leaveChannel(agentId: string, channelTarget: string, serverId = "local") {
    const channel = resolveTarget(channelTarget, serverId);
    if (!channel) return { success: false, reason: "channel_not_found" };
    if (channel.type !== "channel") return { success: false, channel, reason: "regular_channel_required" };
    void agentId;
    return { success: false, channel, reason: "group_channel_retired" };
  }

  function joinChannel(agentId: string, channelTarget: string, serverId = "local") {
    const channel = resolveTarget(channelTarget, serverId);
    if (!channel || (channel.serverId ?? "local") !== serverId) return { success: false, reason: "channel_not_found" };
    if (channel.type !== "channel") return { success: false, channel, reason: "regular_channel_required" };
    void agentId;
    return { success: false, channel, reason: "group_channel_retired" };
  }

  function unfollowThread(agentId: string, threadTarget: string, serverId = "local") {
    const channel = resolveTarget(threadTarget, serverId);
    if (!channel) return { success: false, reason: "thread_not_found" };
    if (channel.type !== "thread") return { success: false, channel, reason: "thread_required" };
    db.prepare(
      `insert into agent_thread_follows (agent_id, thread_channel_id, followed, updated_at)
       values (?, ?, 0, ?)
       on conflict(agent_id, thread_channel_id) do update set followed = 0, updated_at = excluded.updated_at`
    ).run(agentId, channel.id, nowIso());
    db.prepare(
      `insert into thread_follows (thread_channel_id, subject_type, subject_id, followed_at, unfollowed_at)
       values (?, 'agent', ?, ?, ?)
       on conflict(thread_channel_id, subject_type, subject_id) do update set unfollowed_at = excluded.unfollowed_at`
    ).run(channel.id, agentId, nowIso(), nowIso());
    return { success: true, channel };
  }

  function followThread(agentId: string, threadChannelId: string): void {
    const followedAt = nowIso();
    db.prepare(
      `insert into agent_thread_follows (agent_id, thread_channel_id, followed, updated_at)
       values (?, ?, 1, ?)
       on conflict(agent_id, thread_channel_id) do update set followed = 1, updated_at = excluded.updated_at`
    ).run(agentId, threadChannelId, followedAt);
    db.prepare(
      `insert into thread_follows (thread_channel_id, subject_type, subject_id, followed_at, unfollowed_at)
       values (?, 'agent', ?, ?, null)
       on conflict(thread_channel_id, subject_type, subject_id) do update set unfollowed_at = null`
    ).run(threadChannelId, agentId, followedAt);
  }

  function listThreadFollows(threadChannelId: string): ThreadFollowRecord[] {
    return db.prepare("select * from thread_follows where thread_channel_id = ? order by followed_at").all(threadChannelId).map(rowThreadFollow);
  }

  function ensureMessageThread(messageId: string): { success: boolean; channel?: ChannelRecord; created?: boolean; reason?: string } {
    const row = db.prepare(
      `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
       from messages
       join channels on channels.id = messages.channel_id
       where messages.id = ?`
    ).get(messageId);
    if (!row) return { success: false, reason: "message_not_found" };
    const message = rowMessage(row);
    const channel = rowChannel(db.prepare("select * from channels where id = ?").get(message.channelId));
    if (channel.type === "thread") return { success: false, reason: "nested_thread_not_supported" };
    const existing = db.prepare("select * from channels where type = 'thread' and parent_message_id = ?").get(message.id);
    if (existing) return { success: true, channel: rowChannel(existing), created: false };
    const createdAt = nowIso();
    const thread: ChannelRecord = {
      id: id("thread"),
      serverId: channel.serverId ?? "local",
      type: "thread",
      name: `thread-${message.id.slice(4, 12)}`,
      displayName: "Thread",
      visibility: channel.visibility,
      // 普通消息 thread 复用 channel parent 字段，避免新增平行关系表。
      description: "Message thread",
      parentChannelId: channel.id,
      parentMessageId: message.id,
      createdAt
    };
    db.prepare(
      `insert into channels (id, server_id, type, name, display_name, visibility, description, parent_channel_id, parent_message_id, created_at)
       values (@id, @serverId, @type, @name, @displayName, @visibility, @description, @parentChannelId, @parentMessageId, @createdAt)`
    ).run(thread);
    return { success: true, channel: thread, created: true };
  }

  function getMessageThread(messageId: string): ChannelRecord | null {
    const row = db.prepare("select * from channels where type = 'thread' and parent_message_id = ?").get(messageId);
    return row ? rowChannel(row) : null;
  }

  function createTasks(channelTarget: string, titles: string[], createdBy: { type: SenderType; id: string; name: string }, details?: TaskCreateDetails): TaskRecord[] {
    const created: TaskRecord[] = [];
    const createdByAgent = createdBy.type === "agent" ? getAgent(createdBy.id) : null;
    const createdByMachine = createdByAgent?.machineId ? getMachine(createdByAgent.machineId) : null;
    const serverId = createdBy.type === "human"
      ? getActiveServerIdForUser(createdBy.id) ?? undefined
      : createdByMachine?.serverId;
    for (const title of titles) {
      const message = sendMessage({
        target: channelTarget,
        content: title,
        senderType: createdBy.type,
        senderId: createdBy.id,
        senderName: createdBy.name,
        serverId,
        asTask: true,
        // 批量 New Task 只共享创建入口语义；title 仍以每条输入为准，避免多标题被 details.title 覆盖。
        task: details ? { ...details, title } : undefined
      }).message;
      const task = db.prepare(
        `select tasks.*, agents.name as assignee_name, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type, thread.id as thread_channel_id
         from tasks
         left join agents on agents.id = tasks.assignee_agent_id
         join channels on channels.id = tasks.channel_id
         left join channels thread on thread.type = 'thread' and thread.parent_message_id = tasks.message_id
         where tasks.message_id = ?`
      ).get(message.id);
      if (task) created.push(rowTask(task));
    }
    return created;
  }

  function ensureThreadChannel(channel: ChannelRecord, message: MessageRecord, taskNumber: number): ChannelRecord {
    const existing = db.prepare("select * from channels where type = 'thread' and parent_message_id = ?").get(message.id);
    if (existing) return rowChannel(existing);
    const createdAt = nowIso();
    const thread: ChannelRecord = {
      id: id("thread"),
      serverId: channel.serverId ?? "local",
      type: "thread",
      name: `thread-${message.id.slice(4, 12)}`,
      displayName: `Thread #${taskNumber}`,
      visibility: channel.visibility,
      description: `Task #${taskNumber} thread`,
      parentChannelId: channel.id,
      parentMessageId: message.id,
      createdAt
    };
    db.prepare(
      `insert into channels (id, server_id, type, name, display_name, visibility, description, parent_channel_id, parent_message_id, created_at)
       values (@id, @serverId, @type, @name, @displayName, @visibility, @description, @parentChannelId, @parentMessageId, @createdAt)`
    ).run(thread);
    return thread;
  }

  function createTaskForMessage(channel: ChannelRecord, message: MessageRecord, title: string, createdByType: SenderType, createdById: string, createdByName: string, details?: TaskCreateDetails): TaskRecord {
    const existing = db.prepare(
      `select tasks.*, agents.name as assignee_name, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type, thread.id as thread_channel_id
       from tasks
       left join agents on agents.id = tasks.assignee_agent_id
       join channels on channels.id = tasks.channel_id
       left join channels thread on thread.type = 'thread' and thread.parent_message_id = tasks.message_id
       where tasks.message_id = ?`
    ).get(message.id);
    if (existing) return rowTask(existing);
    const taskNumber = ((db.prepare("select max(task_number) from tasks where channel_id = ?").pluck().get(channel.id) as number | null) ?? 0) + 1;
    const createdAt = nowIso();
    const task: TaskRecord = {
      id: id("task"),
      channelId: channel.id,
      conversationId: message.conversationId,
      messageId: message.id,
      taskNumber,
      title,
      status: "todo",
      createdByType,
      createdById,
      createdByName,
      createdAt,
      updatedAt: createdAt
    };
    db.prepare(
      `insert into tasks (id, channel_id, conversation_id, message_id, task_number, title, status, created_by_type, created_by_id, created_by_name, created_at, updated_at)
       values (@id, @channelId, @conversationId, @messageId, @taskNumber, @title, @status, @createdByType, @createdById, @createdByName, @createdAt, @updatedAt)`
    ).run(task);
    const thread = ensureThreadChannel(channel, message, taskNumber);
    return { ...task, channelName: channel.name, channelDisplayName: channel.displayName, channelType: channel.type, threadChannelId: thread.id };
  }

  function listTasks(channelTarget?: string, status: TaskStatus | "all" = "all", serverId = "local"): TaskRecord[] {
    const channel = channelTarget ? resolveTarget(channelTarget, serverId) : null;
    const base = `select tasks.*, agents.name as assignee_name, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type, thread.id as thread_channel_id
      from tasks
      left join agents on agents.id = tasks.assignee_agent_id
      join channels on channels.id = tasks.channel_id
      left join channels thread on thread.type = 'thread' and thread.parent_message_id = tasks.message_id`;
    const where: string[] = [];
    const args: unknown[] = [];
    if (channel) {
      where.push("tasks.channel_id = ?");
      args.push(channel.id);
    }
    if (status !== "all") {
      where.push("tasks.status = ?");
      args.push(status);
    }
    const rows = db.prepare(`${base}${where.length ? ` where ${where.join(" and ")}` : ""} order by tasks.task_number`).all(...args);
    return rows.map(rowTask);
  }

  function listVisibleTasks(userId: string, options: { channelId?: string; statuses?: TaskStatus[]; assigneeAgentId?: string; limit?: number; cursor?: string } = {}): TaskListPayload {
    const visibleChannelIds = workspaceScope(userId).channelIds;
    const requestedChannelId = options.channelId?.trim();
    const channelIds = requestedChannelId
      ? visibleChannelIds.includes(requestedChannelId) ? [requestedChannelId] : []
      : visibleChannelIds;
    const limit = Math.max(1, Math.min(typeof options.limit === "number" && Number.isFinite(options.limit) ? Math.floor(options.limit) : 50, 100));
    if (channelIds.length === 0) return { tasks: [], pageInfo: { limit, nextCursor: null, hasMore: false } };
    const base = `select tasks.*, agents.name as assignee_name, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type, thread.id as thread_channel_id
      from tasks
      left join agents on agents.id = tasks.assignee_agent_id
      join channels on channels.id = tasks.channel_id
      left join channels thread on thread.type = 'thread' and thread.parent_message_id = tasks.message_id`;
    const where: string[] = [`tasks.channel_id in (${channelIds.map(() => "?").join(",")})`];
    const args: unknown[] = [...channelIds];
    if (options.statuses?.length) {
      where.push(`tasks.status in (${options.statuses.map(() => "?").join(",")})`);
      args.push(...options.statuses);
    }
    if (options.assigneeAgentId) {
      where.push("tasks.assignee_agent_id = ?");
      args.push(options.assigneeAgentId);
    }
    if (options.cursor) {
      const separator = options.cursor.lastIndexOf(":");
      if (separator > 0) {
        const cursorUpdatedAt = options.cursor.slice(0, separator);
        const cursorId = options.cursor.slice(separator + 1);
        // Cursor follows the same descending updatedAt/id ordering, so the next page only sees older rows.
        where.push("(tasks.updated_at < ? or (tasks.updated_at = ? and tasks.id < ?))");
        args.push(cursorUpdatedAt, cursorUpdatedAt, cursorId);
      }
    }
    const rows = db.prepare(`${base} where ${where.join(" and ")} order by tasks.updated_at desc, tasks.id desc limit ?`).all(...args, limit + 1);
    const tasks = rows.slice(0, limit).map(rowTask);
    const last = tasks.at(-1);
    const nextCursor = rows.length > limit && last ? `${last.updatedAt}:${last.id}` : null;
    return { tasks, pageInfo: { limit, nextCursor, hasMore: Boolean(nextCursor) } };
  }

  function visibleTaskByIdOrMessageId(userId: string, taskIdOrMessageId: string): TaskRecord | null {
    const task = taskByIdOrMessageId(taskIdOrMessageId);
    return task && canUserAccessChannel(userId, task.channelId) ? task : null;
  }

  function taskByIdOrMessageId(taskIdOrMessageId: string): TaskRecord | null {
    const row = db.prepare(
      `select tasks.*, agents.name as assignee_name, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type, thread.id as thread_channel_id
       from tasks
       left join agents on agents.id = tasks.assignee_agent_id
       join channels on channels.id = tasks.channel_id
       left join channels thread on thread.type = 'thread' and thread.parent_message_id = tasks.message_id
       where tasks.id = ? or tasks.message_id = ?`
    ).get(taskIdOrMessageId, taskIdOrMessageId);
    return row ? rowTask(row) : null;
  }

  function convertMessageToTask(messageId: string, createdBy: { type: SenderType; id: string; name: string }, title?: string, details?: TaskCreateDetails): { success: boolean; task?: TaskRecord; created?: boolean; reason?: string } {
    const row = db.prepare(
      `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
       from messages
       join channels on channels.id = messages.channel_id
       where messages.id = ?`
    ).get(messageId);
    if (!row) return { success: false, reason: "message_not_found" };
    const existing = taskByIdOrMessageId(messageId);
    if (existing) return { success: true, task: existing, created: false };
    const message = rowMessage(row);
    const channel = db.prepare("select * from channels where id = ?").get(message.channelId);
    if (!channel) return { success: false, reason: "channel_not_found" };
    const taskTitle = (title ?? message.content).trim();
    if (!taskTitle) return { success: false, reason: "title_required" };
    // 转 task 只新增任务元数据和专属 thread；原消息正文保持不变，避免改写聊天历史。
    return { success: true, task: createTaskForMessage(rowChannel(channel), message, taskTitle, createdBy.type, createdBy.id, createdBy.name, details), created: true };
  }

  function claimTask(taskIdOrMessageId: string, agentId: string): { success: boolean; task?: TaskRecord; reason?: string } {
    const task = taskByIdOrMessageId(taskIdOrMessageId);
    if (!task) return { success: false, reason: "task_not_found" };
    const agent = getAgent(agentId);
    if (!agent) return { success: false, reason: "agent_not_found" };
    if (!canAgentAccessChannel(agent.id, task.channelId)) return { success: false, reason: "channel_not_accessible" };
    if (task.assigneeAgentId && task.assigneeAgentId !== agent.id) return { success: false, reason: "already_claimed" };
    const nextStatus = task.status === "todo" ? "in_progress" : task.status;
    db.prepare("update tasks set assignee_agent_id = ?, status = ?, updated_at = ? where id = ?").run(agent.id, nextStatus, nowIso(), task.id);
    if (task.threadChannelId) followThread(agent.id, task.threadChannelId);
    return { success: true, task: taskByIdOrMessageId(task.id) ?? undefined };
  }

  function claimMessageAsTask(messageId: string, agentId: string, title?: string): { success: boolean; task?: TaskRecord; created?: boolean; reason?: string } {
    const agent = getAgent(agentId);
    if (!agent) return { success: false, reason: "agent_not_found" };
    const row = db.prepare(
      `select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type
       from messages
       join channels on channels.id = messages.channel_id
       where messages.id = ?`
    ).get(messageId);
    if (!row) return { success: false, reason: "message_not_found" };
    const message = rowMessage(row);
    // taskify 只允许父消息，避免 thread 内协作回复被误升成参与 Agent 的子任务。
    if (message.channelType === "thread") return { success: false, reason: "parent_message_required" };
    if (!canAgentAccessChannel(agent.id, message.channelId)) return { success: false, reason: "channel_not_accessible" };
    const channel = db.prepare("select * from channels where id = ?").get(message.channelId) as any;
    if (!channel) return { success: false, reason: "channel_not_found" };
    const channelRecord = rowChannel(channel);
    const agents = listAgents(channelRecord.serverId ?? "local").filter((candidate) => canAgentAccessChannel(candidate.id, channelRecord.id));
    const mentions = mentionedAgents(message.content, agents);
    // 普通父消息转 task 只允许第一被 @ 的协调 Agent 执行，防止被委派 Agent 抢先生成同一条任务。
    if (mentions.length > 0 && mentions[0].id !== agent.id) return { success: false, reason: "not_primary_mentioned_agent" };
    // 代理认领普通父消息时，只给原消息补 task metadata；协作者仍在同一个 thread 里协作，不生成第二条任务。
    const converted = convertMessageToTask(message.id, { type: message.senderType, id: message.senderId, name: message.senderName }, title);
    if (!converted.success || !converted.task) return converted;
    const claimed = claimTask(converted.task.id, agent.id);
    if (!claimed.success || !claimed.task) return { success: false, reason: claimed.reason };
    return { success: true, task: claimed.task, created: Boolean(converted.created) };
  }

  function unclaimTaskById(taskIdOrMessageId: string): { success: boolean; task?: TaskRecord; reason?: string } {
    const task = taskByIdOrMessageId(taskIdOrMessageId);
    if (!task) return { success: false, reason: "task_not_found" };
    // Unclaim 语义与 agent CLI 保持一致：释放 assignee 后回到 todo 队列。
    db.prepare("update tasks set assignee_agent_id = null, status = 'todo', updated_at = ? where id = ?").run(nowIso(), task.id);
    return { success: true, task: taskByIdOrMessageId(task.id) ?? undefined };
  }

  function patchTask(taskIdOrMessageId: string, patch: { title?: string; status?: TaskStatus; assigneeAgentId?: string | null }): { success: boolean; task?: TaskRecord; reason?: string } {
    const task = taskByIdOrMessageId(taskIdOrMessageId);
    if (!task) return { success: false, reason: "task_not_found" };
    const updates: string[] = [];
    const args: unknown[] = [];
    if (Object.prototype.hasOwnProperty.call(patch, "title")) {
      const title = String(patch.title ?? "").trim();
      if (!title) return { success: false, reason: "title_required" };
      updates.push("title = ?");
      args.push(title);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "status")) {
      const status = patch.status;
      if (!status || !["todo", "in_progress", "in_review", "done", "closed"].includes(status)) return { success: false, reason: "invalid_status" };
      updates.push("status = ?");
      args.push(status);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "assigneeAgentId")) {
      const assigneeAgentId = patch.assigneeAgentId ?? null;
      if (assigneeAgentId) {
        const agent = getAgent(assigneeAgentId);
        if (!agent) return { success: false, reason: "agent_not_found" };
        if (!canAgentAccessChannel(agent.id, task.channelId)) return { success: false, reason: "channel_not_accessible" };
        if (task.threadChannelId) followThread(agent.id, task.threadChannelId);
      }
      // Patch 是精确字段修改；设置 assignee 不隐式改变 status，claim API 才负责推进状态。
      updates.push("assignee_agent_id = ?");
      args.push(assigneeAgentId);
    }
    if (updates.length === 0) return { success: true, task };
    updates.push("updated_at = ?");
    args.push(nowIso(), task.id);
    db.prepare(`update tasks set ${updates.join(", ")} where id = ?`).run(...args);
    return { success: true, task: taskByIdOrMessageId(task.id) ?? undefined };
  }

  function deleteTask(taskIdOrMessageId: string): { success: boolean; task?: TaskRecord; reason?: string } {
    const task = taskByIdOrMessageId(taskIdOrMessageId);
    if (!task) return { success: false, reason: "task_not_found" };
    const threadChannelId = task.threadChannelId;
    db.transaction(() => {
      // Task 删除只移除任务元数据和专属 thread；源消息继续保留为普通消息历史。
      if (threadChannelId) {
        const threadMessageIds = db.prepare("select id from messages where channel_id = ?").pluck().all(threadChannelId) as string[];
        const messagePlaceholders = threadMessageIds.map(() => "?").join(",");
        if (threadMessageIds.length > 0) {
          const reminderIds = db.prepare(`select id from reminders where message_id in (${messagePlaceholders})`).pluck().all(...threadMessageIds) as string[];
          if (reminderIds.length > 0) {
            const reminderPlaceholders = reminderIds.map(() => "?").join(",");
            db.prepare(`delete from reminder_events where reminder_id in (${reminderPlaceholders})`).run(...reminderIds);
            db.prepare(`delete from reminders where id in (${reminderPlaceholders})`).run(...reminderIds);
          }
          db.prepare(`delete from agent_inbox where message_id in (${messagePlaceholders})`).run(...threadMessageIds);
          db.prepare(`delete from saved_messages where message_id in (${messagePlaceholders})`).run(...threadMessageIds);
          db.prepare(`delete from inbox_done_marks where message_id in (${messagePlaceholders})`).run(...threadMessageIds);
          db.prepare(`delete from tasks where message_id in (${messagePlaceholders})`).run(...threadMessageIds);
        }
        db.prepare("delete from reminders where channel_id = ?").run(threadChannelId);
        db.prepare("delete from tasks where channel_id = ?").run(threadChannelId);
        db.prepare("delete from attachments where channel_id = ?").run(threadChannelId);
        db.prepare("delete from messages where channel_id = ?").run(threadChannelId);
        db.prepare("delete from channel_unread_marks where channel_id = ?").run(threadChannelId);
        db.prepare("delete from agent_channel_memberships where channel_id = ?").run(threadChannelId);
        db.prepare("delete from agent_thread_follows where thread_channel_id = ?").run(threadChannelId);
        db.prepare("delete from channel_members where channel_id = ?").run(threadChannelId);
        db.prepare("delete from thread_follows where thread_channel_id = ?").run(threadChannelId);
        db.prepare("delete from channels where id = ?").run(threadChannelId);
      }
      db.prepare("delete from tasks where id = ?").run(task.id);
    })();
    return { success: true, task };
  }

  function claimTasks(agentId: string, channelTarget: string, taskNumbers: number[] = [], messageIds: string[] = [], serverId = "local") {
    const agent = getAgent(agentId);
    const channel = resolveTarget(channelTarget, serverId);
    if (!agent || !channel) return [{ success: false, reason: "agent or channel not found" }];
    const results: Array<{ success: boolean; taskNumber?: number; messageId?: string; reason?: string }> = [];
    for (const number of taskNumbers) {
      const task = db.prepare("select * from tasks where channel_id = ? and task_number = ?").get(channel.id, number) as any;
      if (!task) {
        results.push({ success: false, taskNumber: number, reason: "not_found" });
        continue;
      }
      if (task.assignee_agent_id && task.assignee_agent_id !== agentId) {
        results.push({ success: false, taskNumber: number, messageId: task.message_id, reason: "already_claimed" });
        continue;
      }
      const nextStatus = task.status === "todo" ? "in_progress" : task.status;
      db.prepare("update tasks set assignee_agent_id = ?, status = ?, updated_at = ? where id = ?").run(agentId, nextStatus, nowIso(), task.id);
      const thread = db.prepare("select id from channels where type = 'thread' and parent_message_id = ?").get(task.message_id) as { id?: string } | undefined;
      if (thread?.id) followThread(agentId, thread.id);
      results.push({ success: true, taskNumber: number, messageId: task.message_id });
    }
    for (const prefix of messageIds) {
      const messageRow = db.prepare("select messages.*, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type from messages join channels on channels.id = messages.channel_id where messages.id = ? or messages.id like ?").get(prefix, `${prefix}%`) as any;
      if (!messageRow) {
        results.push({ success: false, messageId: prefix, reason: "message_not_found" });
        continue;
      }
      const message = rowMessage(messageRow);
      const task = createTaskForMessage(channel, message, message.content, "agent", agent.id, agent.name);
      db.prepare("update tasks set assignee_agent_id = ?, status = 'in_progress', updated_at = ? where id = ?").run(agentId, nowIso(), task.id);
      if (task.threadChannelId) followThread(agentId, task.threadChannelId);
      results.push({ success: true, taskNumber: task.taskNumber, messageId: message.id });
    }
    return results;
  }

  function unclaimTask(agentId: string, channelTarget: string, taskNumber: number, serverId = "local") {
    const channel = resolveTarget(channelTarget, serverId);
    if (!channel) return { success: false, reason: "channel_not_found" };
    const task = db.prepare("select * from tasks where channel_id = ? and task_number = ?").get(channel.id, taskNumber) as any;
    if (!task) return { success: false, reason: "not_found" };
    if (task.assignee_agent_id !== agentId) return { success: false, reason: "not_assignee" };
    db.prepare("update tasks set assignee_agent_id = null, status = 'todo', updated_at = ? where id = ?").run(nowIso(), task.id);
    return { success: true };
  }

  function updateTaskStatus(agentId: string, channelTarget: string, taskNumber: number, status: TaskStatus, serverId = "local") {
    const channel = resolveTarget(channelTarget, serverId);
    if (!channel) return { success: false, reason: "channel_not_found" };
    const task = db.prepare("select * from tasks where channel_id = ? and task_number = ?").get(channel.id, taskNumber) as any;
    if (!task) return { success: false, reason: "not_found" };
    if (task.assignee_agent_id && task.assignee_agent_id !== agentId) return { success: false, reason: "not_assignee" };
    const shouldAssign = !task.assignee_agent_id && ["in_progress", "in_review", "done"].includes(status);
    if (shouldAssign) {
      db.prepare("update tasks set assignee_agent_id = ?, status = ?, updated_at = ? where id = ?").run(agentId, status, nowIso(), task.id);
      const thread = db.prepare("select id from channels where type = 'thread' and parent_message_id = ?").get(task.message_id) as { id?: string } | undefined;
      if (thread?.id) followThread(agentId, thread.id);
    } else {
      db.prepare("update tasks set status = ?, updated_at = ? where id = ?").run(status, nowIso(), task.id);
    }
    const updated = db.prepare(
      `select tasks.*, agents.name as assignee_name, channels.name as channel_name, channels.display_name as channel_display_name, channels.type as channel_type, thread.id as thread_channel_id
       from tasks
       left join agents on agents.id = tasks.assignee_agent_id
       join channels on channels.id = tasks.channel_id
       left join channels thread on thread.type = 'thread' and thread.parent_message_id = tasks.message_id
       where tasks.id = ?`
    ).get(task.id);
    return { success: true, task: rowTask(updated) };
  }

  function createAttachment(input: Omit<AttachmentRecord, "id" | "createdAt">): AttachmentRecord {
    const attachment: AttachmentRecord = { ...input, id: id("att"), createdAt: nowIso() };
    db.prepare(
      `insert into attachments (id, channel_id, filename, mime_type, size_bytes, path, created_at)
       values (@id, @channelId, @filename, @mimeType, @sizeBytes, @path, @createdAt)`
    ).run(attachment);
    return attachment;
  }

  function getAttachment(attachmentId: string): AttachmentRecord | null {
    const row = db.prepare("select * from attachments where id = ?").get(attachmentId);
    return row ? rowAttachment(row) : null;
  }

  function listReminders(agentId: string, status?: string): ReminderRecord[] {
    const statuses = (status || "scheduled").split(",").map((item) => item.trim()).filter(Boolean);
    const placeholders = statuses.map(() => "?").join(",");
    return db.prepare(`select * from reminders where owner_agent_id = ? and status in (${placeholders}) order by fire_at`).all(agentId, ...statuses).map(rowReminder);
  }

  function recordReminderEvent(reminderId: string, type: string, detail?: string): void {
    db.prepare("insert into reminder_events (reminder_id, at, type, detail) values (?, ?, ?, ?)").run(reminderId, nowIso(), type, detail ?? null);
  }

  function createReminder(agentId: string, title: string, fireAt: string, messageId?: string, channelId?: string, repeat?: string): ReminderRecord {
    const createdAt = nowIso();
    const reminder: ReminderRecord = {
      id: id("rem"),
      ownerAgentId: agentId,
      title,
      status: "scheduled",
      fireAt,
      version: 1,
      repeat,
      fireCount: 0,
      messageId,
      channelId,
      createdAt,
      updatedAt: createdAt
    };
    db.prepare(
      `insert into reminders (id, owner_agent_id, title, status, fire_at, version, repeat, fire_count, message_id, channel_id, created_at, updated_at)
       values (@id, @ownerAgentId, @title, @status, @fireAt, @version, @repeat, @fireCount, @messageId, @channelId, @createdAt, @updatedAt)`
    ).run(reminder);
    recordReminderEvent(reminder.id, "created", `fireAt=${fireAt}${repeat ? ` repeat=${repeat}` : ""}`);
    return reminder;
  }

  function resolveReminder(agentId: string, reminderId: string, statuses?: string[]): any | null {
    const statusClause = statuses?.length ? ` and status in (${statuses.map(() => "?").join(",")})` : "";
    return db.prepare(`select * from reminders where owner_agent_id = ? and (id = ? or id like ?)${statusClause}`)
      .get(agentId, reminderId, `${reminderId}%`, ...(statuses ?? [])) as any | null;
  }

  function updateReminder(agentId: string, reminderId: string, input: { title?: string; fireAt?: string; delaySeconds?: number; repeat?: string | null }): ReminderRecord | null {
    const row = resolveReminder(agentId, reminderId);
    if (!row) return null;
    const fireAt = input.delaySeconds !== undefined ? new Date(Date.now() + Number(input.delaySeconds) * 1000).toISOString() : input.fireAt ?? row.fire_at;
    const repeat = input.repeat === null ? null : input.repeat ?? row.repeat;
    db.prepare(
      `update reminders
       set title = ?, status = 'scheduled', fire_at = ?, repeat = ?, version = version + 1, updated_at = ?
       where id = ?`
    ).run(input.title ?? row.title, fireAt, repeat, nowIso(), row.id);
    recordReminderEvent(row.id, "updated", JSON.stringify({ title: input.title, fireAt, repeat }));
    return rowReminder(db.prepare("select * from reminders where id = ?").get(row.id));
  }

  function snoozeReminder(agentId: string, reminderId: string, delaySeconds: number): ReminderRecord | null {
    const reminder = updateReminder(agentId, reminderId, { delaySeconds });
    if (reminder) recordReminderEvent(reminder.id, "snoozed", `delaySeconds=${delaySeconds}`);
    return reminder;
  }

  function cancelReminder(agentId: string, reminderId: string): ReminderRecord | null {
    const row = resolveReminder(agentId, reminderId, ["scheduled", "fired"]) as any;
    if (!row) return null;
    db.prepare("update reminders set status = 'canceled', version = version + 1, updated_at = ? where id = ?").run(nowIso(), row.id);
    recordReminderEvent(row.id, "canceled");
    return rowReminder(db.prepare("select * from reminders where id = ?").get(row.id));
  }

  function parseDurationSeconds(input: string): number | null {
    const match = /^(\d+)(s|m|h|d)?$/.exec(input.trim());
    if (!match) return null;
    const value = Number(match[1]);
    const unit = match[2] ?? "s";
    return unit === "d" ? value * 86400 : unit === "h" ? value * 3600 : unit === "m" ? value * 60 : value;
  }

  function nextRepeatFireAt(repeat: string | undefined, from = new Date()): string | null {
    if (!repeat) return null;
    const every = /^every:(\d+[smhd])$/.exec(repeat);
    if (every) {
      const seconds = parseDurationSeconds(every[1]);
      return seconds ? new Date(from.getTime() + seconds * 1000).toISOString() : null;
    }
    const daily = /^daily@(\d{2}):(\d{2})$/.exec(repeat);
    if (daily) {
      const next = new Date(from);
      next.setHours(Number(daily[1]), Number(daily[2]), 0, 0);
      if (next <= from) next.setDate(next.getDate() + 1);
      return next.toISOString();
    }
    const weekly = /^weekly:([a-z,]+)@(\d{2}):(\d{2})$/i.exec(repeat);
    if (weekly) {
      const days = weekly[1].split(",").map((day) => ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(day.slice(0, 3).toLowerCase())).filter((day) => day >= 0);
      for (let offset = 0; offset <= 7; offset += 1) {
        const next = new Date(from);
        next.setDate(next.getDate() + offset);
        next.setHours(Number(weekly[2]), Number(weekly[3]), 0, 0);
        if (days.includes(next.getDay()) && next > from) return next.toISOString();
      }
    }
    return null;
  }

  function fireReminder(agentId: string, reminderId: string, version: number, firedAtClient: string) {
    const row = resolveReminder(agentId, reminderId, ["scheduled"]) as any;
    if (!row) return { reminder: null, fired: false, rescheduled: false, reason: "reminder_not_found" };
    if (Number(row.version ?? 1) !== version) return { reminder: rowReminder(row), fired: false, rescheduled: false, reason: "stale_version" };
    const nextFireAt = nextRepeatFireAt(maybeString(row.repeat), new Date(firedAtClient));
    if (nextFireAt) {
      db.prepare(
        `update reminders
         set fire_at = ?, version = version + 1, fire_count = fire_count + 1, updated_at = ?
         where id = ?`
      ).run(nextFireAt, nowIso(), row.id);
      recordReminderEvent(row.id, "fired_rescheduled", `firedAtClient=${firedAtClient} next=${nextFireAt}`);
      return { reminder: rowReminder(db.prepare("select * from reminders where id = ?").get(row.id)), fired: true, rescheduled: true };
    }
    db.prepare("update reminders set status = 'fired', version = version + 1, fire_count = fire_count + 1, updated_at = ? where id = ?").run(nowIso(), row.id);
    recordReminderEvent(row.id, "fired", `firedAtClient=${firedAtClient}`);
    return { reminder: rowReminder(db.prepare("select * from reminders where id = ?").get(row.id)), fired: true, rescheduled: false };
  }

  function listReminderEvents(agentId: string, reminderId: string): ReminderEventRecord[] | null {
    const row = resolveReminder(agentId, reminderId);
    if (!row) return null;
    return db.prepare("select reminder_id as reminderId, at, type, detail from reminder_events where reminder_id = ? order by at").all(row.id) as ReminderEventRecord[];
  }

  function reminderJobsForAgent(agentId: string): ReminderJob[] {
    return listReminders(agentId, "scheduled").map((reminder) => ({
      reminderId: reminder.id,
      ownerAgentId: reminder.ownerAgentId,
      title: reminder.title,
      fireAt: reminder.fireAt,
      version: reminder.version,
      repeat: reminder.repeat,
      messageId: reminder.messageId,
      channelId: reminder.channelId
    }));
  }

  return {
    db,
    currentUser,
    getUser,
    findUser,
    snapshot,
    workspaceBootstrap,
    workspaceNavigation,
    registerUser,
    loginUser,
    createPlatformOperator,
    findPlatformOperator,
    verifyPlatformOperatorPassword,
    loginPlatformOperator,
    getPlatformOperatorBySessionToken,
    revokePlatformOperatorSession,
    upsertPlatformOperatorWorkspaceGrant,
    listPlatformOperatorWorkspaceGrants,
    hasPlatformOperatorScope,
    listPlatformOperatorWorkspaces,
    createTyrHeartbeat,
    updateTyrHeartbeat,
    getTyrHeartbeat,
    listTyrHeartbeats,
    enqueueDueTyrHeartbeatRuns,
    claimNextTyrHeartbeatRun,
    updateTyrHeartbeatRun,
    cancelQueuedTyrHeartbeatRuns,
    listTyrHeartbeatRuns,
    createWorkspaceSharedFile,
    getWorkspaceSharedFile,
    listWorkspaceSharedFiles,
    listAgentSharedFiles,
    replaceWorkspaceSharedFile,
    replaceWorkspaceSharedFileOriginal,
    renameWorkspaceSharedFile,
    setWorkspaceSharedFileAssignments,
    deleteWorkspaceSharedFile,
    refreshSession,
    createHelpdeskSignupIntent,
    getHelpdeskSignupIntentByToken,
    completeHelpdeskSignupIntent,
    createHelpdeskPasswordRecoveryIntent,
    getHelpdeskPasswordRecoveryIntentByToken,
    completeHelpdeskPasswordRecoveryIntent,
    claimHelpdeskResendEmailEvent,
    completeHelpdeskResendEmailEvent,
    failHelpdeskResendEmailEvent,
    ensureCommunicationAgentEmailAlias,
    getCommunicationAgentEmailAliasByAddress,
    listCommunicationAgentEmailAliases,
    getCommunicationAgentEmailSettings,
    updateCommunicationAgentEmailAlias,
    getOrCreateCommunicationAgentExternalConversation,
    getOrCreateCommunicationAgentHandoffConversation,
    createCommunicationAgentPendingAction,
    getCommunicationAgentPendingAction,
    getLatestCommunicationAgentPendingAction,
    hasUnresolvedCommunicationAgentPendingAction,
    attachCommunicationAgentPendingActionSuggestionMessage,
    resolveCommunicationAgentPendingAction,
    createCommunicationAgentManagementDraft,
    getCommunicationAgentManagementDraft,
    getLatestCommunicationAgentManagementDraft,
    getLatestResolvedCommunicationAgentManagementDraft,
    attachCommunicationAgentManagementDraftSourceEvent,
    getCommunicationAgentManagementDraftBySourceEvent,
    updateCommunicationAgentManagementDraft,
    claimCommunicationAgentManagementDraft,
    resolveCommunicationAgentManagementDraft,
    getUserByAccessToken,
    logoutSession,
    updateUserProfile,
    verifyUserPassword,
    changeUserPassword,
    setupUserPassword,
    listServersForUser,
    getActiveServerIdForUser,
    setActiveServerForUser,
    ensurePersonalServerForUser,
    createServer,
    updateServerName,
    createServerInvite,
    listServerInvites,
    listIncomingServerInvites,
    acceptServerInviteForUser,
    revokeServerInvite,
    createWorkspaceBridge,
    listWorkspaceBridges,
    listIncomingWorkspaceBridges,
    getWorkspaceBridgeForServer,
    acceptWorkspaceBridge,
    revokeWorkspaceBridge,
    workspaceBridgeTopology,
    createCrossWorkspaceMessage,
    createCrossWorkspaceTerminalMessage,
    createCrossWorkspaceInteractionMessage,
    getCrossWorkspaceMessage,
    hasReviewedDownstreamResult,
    listCrossWorkspaceRequestsForSourceMessage,
    armCrossWorkspaceContinuationsForSourceMessage,
    recoverReadyCrossWorkspaceContinuations,
    claimCrossWorkspaceContinuation,
    completeCrossWorkspaceContinuation,
    countCrossWorkspaceContinuationsForSourceMessage,
    getCrossWorkspaceMessageByClientRequest,
    updateCrossWorkspaceMessage,
    listCrossWorkspaceMessages,
    listCrossWorkspaceChildRequests,
    listCrossWorkspaceMessagesPage,
    listServerMembers,
    removeServerMember,
    serverUsage,
    getServerSidebarOrder,
    setServerSidebarOrder,
    getWorkspaceRoutingInstructions,
    setWorkspaceRoutingInstructions,
    createMachineKey,
    getMachineByKey,
    getMachineConnectCredential,
    createMachineOnboardingIntent,
    getMachineOnboardingIntentByCode,
    consumeMachineOnboardingIntent,
    revokeMachineOnboardingIntent,
    getMachine,
    listMachines,
    issueMachineConnectorToken,
    rotateMachineConnectorToken,
    hasPendingMachineWork,
    getPendingMachineConnectorTokenRotation,
    acknowledgeMachineConnectorTokenRotation,
    revokeMachineConnectorToken,
    updateMachineName,
    bindMachineInstallation,
    updateMachineReady,
    updateRuntimeModels,
    updateRuntimeAuthStatus,
    touchMachineLastSeen,
    markMachineOffline,
    listRuntimeReports,
    createAgent,
    createCommunicationAgent,
    ensureDefaultCommunicationAgent,
    getAgent,
    getAgentByToken,
    listAgents,
    updateAgentStatus,
    setAgentDesiredRuntimeState,
    updateAgentLaunch,
    updateAgentSession,
    clearAgentSession,
    resetAgentRuntimeSessions,
    updateAgentProfile,
    updateAgentConfiguration,
    updateAgentProfileApplication,
    updateAgentPermissionMode,
    updateAgentRuntimeResourceGrants,
    getAgentScopes,
    setAgentScopes,
    resetAgentScopes,
    hasAgentCapability,
    getAgentRuntimeEnvVars,
    deleteAgent,
    deleteMachine,
    createResourceGrant,
    revokeResourceGrant,
    listResourceGrants,
    resourceOwnerUserId,
    resourceGrantScopesForUser,
    canUserAccessResource,
    createDevicePairingToken,
    connectDeviceWithPairingToken,
    getDevice,
    getDeviceByToken,
    listDevices,
    listVisibleDevices,
    deleteDevice,
    createOrUpdateMobileAppBinding,
    getMobileAppBinding,
    getMobileAppBindingByDevice,
    setMobileAppPinnedAgent,
    revokeMobileAppBinding,
    touchMobileAppBinding,
    createTelegramBindingCode,
    getTelegramBindingCode,
    consumeTelegramBindingCode,
    getTelegramAccount,
    getTelegramAccountByTelegramUserId,
    getTelegramAccountByUserId,
    revokeTelegramAccountForUser,
    touchTelegramAccount,
    enqueueTelegramOutboundDeliveries,
    listTelegramOutboundDeliveries,
    claimNextTelegramOutboundDelivery,
    markTelegramOutboundDeliverySent,
    retryTelegramOutboundDelivery,
    failTelegramOutboundDelivery,
    cancelTelegramOutboundDelivery,
    resetSendingTelegramOutboundDeliveries,
    createTelegramApprovalAction,
    getTelegramApprovalAction,
    consumeTelegramApprovalAction,
    claimTelegramWebhookUpdate,
    checkTelegramRateLimit,
    updateDeviceConnectionStatus,
    createDeviceGrant,
    revokeDeviceGrant,
    listDeviceGrants,
    findActiveDeviceGrant,
    createDeviceCommand,
    getDeviceCommand,
    markDeviceCommandSent,
    markDeviceCommandRunning,
    completeDeviceCommand,
    listDeviceCommands,
    recordAuditEvent,
    listAuditEvents,
    recordActivity,
    listActivity,
    listAgentActivityMessages,
    createRuntimeApproval,
    getRuntimeApproval,
    listRuntimeApprovals,
    listExpiredPendingRuntimeApprovals,
    listRuntimeApprovalsForExecutionSummary,
    canUserResolveRuntimeApproval,
    resolveRuntimeApproval,
    getAgentRuntimeSession,
    listAgentRuntimeSessions,
    getCurrentAgentRuntimeSession,
    getOrCreateAgentRuntimeSession,
    prepareRuntimeExecutionSession,
    bindAgentRuntimeSession,
    markAgentRuntimeSessionFailed,
    replaceAgentRuntimeSession,
    touchAgentRuntimeSession,
    invalidateAgentRuntimeSessions,
    createRuntimeExecution,
    getRuntimeExecution,
    listRuntimeExecutions,
    listTopologyRuntimeExecutions,
    listTopologyRuntimeExecutionEvents,
    listRuntimeExecutionsForMessageIds,
    listChildRuntimeExecutionsForSourceIds,
    latestRuntimeExecutionForTask,
    latestRuntimeExecutionForMessage,
    attachRuntimeExecutionToTask,
    attachRuntimeExecutionRootMessage,
    bindRuntimeExecutionSession,
    updateRuntimeExecutionStatus,
    markRuntimeExecutionReturnDispatched,
    markRuntimeExecutionCommunicationReturnDispatched,
    appendRuntimeExecutionEvent,
    listRuntimeExecutionEvents,
    findFinalMessageForExecution,
    ensureExecutionGroup,
    getExecutionGroup,
    listExecutionGroups,
    listExecutionGroupsForMessageIds,
    updateExecutionGroupStatus,
    ensureAgentRun,
    getAgentRun,
    listAgentRuns,
    listAgentRunsForGroupIds,
    updateAgentRunStatus,
    upsertExecutionBlock,
    hasExecutionBlocks,
    listExecutionBlocks,
    createExecutionArtifact,
    listExecutionArtifacts,
    ensureSafetyAssessment,
    updateSafetyAssessment,
    findSafetyAssessmentBySubject,
    listSafetyAssessments,
    upsertGovernancePolicyConfig,
    getGovernancePolicyConfig,
    listGovernancePolicyConfigs,
    getGovernancePolicyConfigAudit,
    listGovernancePolicyConfigAudit,
    createGovernanceDecision,
    listGovernanceDecisions,
    createChannel,
    getChannelByName,
    getOrCreateAgentDm,
    getOrCreateAgentPairDm,
    getWorkspaceBridgeDm,
    getOrCreateWorkspaceBridgeDm,
    getConversation,
    listConversations,
    getActiveConversation,
    ensureActiveConversation,
    createConversation,
    renameConversation,
    archiveConversation,
    unarchiveConversation,
    deleteConversation,
    updateConversationResetStatus,
    readConversationHistory,
    updateChannelDescription,
    updateChannelLifecycle,
    archiveChannel,
    unarchiveChannel,
    deleteChannel,
    resolveTarget,
    canUserAccessChannel,
    canAgentAccessChannel,
    canAgentSendToChannel,
    listMessages,
    listRuntimeExecutionOutputMessages,
    listVisibleChannelIds,
    listVisibleAgents,
    listVisibleMessages,
    latestVisibleMessageSeq,
    getMessage,
    softDeleteMessage,
    listChannelsForAgent,
    readHistory,
    readHistoryForAgent,
    searchMessages,
    saveMessage,
    unsaveMessage,
    toggleMessageReaction,
    listSavedMessages,
    markChannelUnread,
    markMessageUnread,
    markChannelRead,
    listUnreadCounts,
    listUnreadMarks,
    listInboxItemsForUser,
    sendMessage,
    createDelegationMessage,
    selectWakeTargets,
    enqueueForAgents,
    enqueueForAgent,
    hasPendingAgentInbox,
    takeAgentInbox,
    ackAgentInbox,
    listChannelMembers,
    setAgentChannelMembership,
    setHumanChannelMembership,
    joinChannel,
    leaveChannel,
    unfollowThread,
    followThread,
    listThreadFollows,
    ensureMessageThread,
    getMessageThread,
    taskForMessage,
    createTasks,
    listTasks,
    listVisibleTasks,
    visibleTaskByIdOrMessageId,
    convertMessageToTask,
    claimMessageAsTask,
    claimTask,
    unclaimTaskById,
    patchTask,
    deleteTask,
    claimTasks,
    unclaimTask,
    updateTaskStatus,
    createAttachment,
    getAttachment,
    listReminders,
    createReminder,
    updateReminder,
    snoozeReminder,
    cancelReminder,
    fireReminder,
    listReminderEvents,
    reminderJobsForAgent
  };
}

function ensureAgentKindSchema(db: Database.Database): void {
  const columns = db.prepare("pragma table_info(agents)").all() as Array<{ name: string; notnull: 0 | 1 }>;
  const byName = new Map(columns.map((column) => [column.name, column]));
  const value = (column: string, fallback = "null") => byName.has(column) ? `agents.${column}` : fallback;
  const needsRebuild =
    !byName.has("server_id") ||
    !byName.has("kind") ||
    byName.get("machine_id")?.notnull === 1 ||
    byName.get("runtime")?.notnull === 1;

  if (!needsRebuild) {
    db.exec("create index if not exists idx_agents_server_kind on agents(server_id, kind, deleted_at)");
    return;
  }

  db.exec("pragma foreign_keys = off");
  try {
    db.transaction(() => {
      db.exec("drop table if exists agents_next");
      db.exec(`
        create table agents_next (
          id text primary key,
          server_id text not null default 'local' references servers(id),
          kind text not null default 'on_device',
          owner_user_id text not null references users(id),
          machine_id text references machines(id),
          name text not null,
          display_name text not null,
          description text,
          avatar_url text,
          runtime text,
          model text,
          reasoning_effort text,
          permission_mode text not null default 'workspace-write',
          runtime_resource_grants text not null default '[]',
          env_vars text,
          status text not null,
          desired_runtime_state text not null default 'stopped',
          last_error text,
          workspace_path text,
          session_id text,
          launch_id text,
          auth_token text not null unique,
          deleted_at text,
          created_at text not null,
          updated_at text not null
        );
      `);
      db.exec(`
        insert into agents_next
          (id, server_id, kind, owner_user_id, machine_id, name, display_name, description, avatar_url, runtime, model, reasoning_effort, permission_mode, runtime_resource_grants, env_vars, status, desired_runtime_state, last_error, workspace_path, session_id, launch_id, auth_token, deleted_at, created_at, updated_at)
        select
          agents.id,
          coalesce(${value("server_id")}, machines.server_id, 'local'),
          coalesce(${value("kind", "'on_device'")}, 'on_device'),
          agents.owner_user_id,
          agents.machine_id,
          agents.name,
          agents.display_name,
          ${value("description")},
          ${value("avatar_url")},
          ${value("runtime")},
          ${value("model")},
          ${value("reasoning_effort")},
          coalesce(${value("permission_mode", "'workspace-write'")}, 'workspace-write'),
          coalesce(${value("runtime_resource_grants", "'[]'")}, '[]'),
          ${value("env_vars", "'{}'")},
          agents.status,
          coalesce(${value("desired_runtime_state", "'stopped'")}, 'stopped'),
          ${value("last_error")},
          ${value("workspace_path")},
          ${value("session_id")},
          ${value("launch_id")},
          agents.auth_token,
          ${value("deleted_at")},
          agents.created_at,
          agents.updated_at
        from agents
        left join machines on machines.id = agents.machine_id;
      `);
      db.exec("drop table agents");
      db.exec("alter table agents_next rename to agents");
      db.exec("create index if not exists idx_agents_server_kind on agents(server_id, kind, deleted_at)");
    })();
  } finally {
    db.exec("pragma foreign_keys = on");
  }
}

/** Preserve delivered invitations and their notice FKs while allowing an unregistered recipient. */
function ensureBridgeEmailRecipientSchema(db: Database.Database): void {
  const columns = db.prepare("pragma table_info(workspace_bridge_email_invitations)").all() as Array<{ name: string; notnull: number }>;
  if (!columns.find((column) => column.name === "recipient_user_id")?.notnull) return;
  const schema = db.prepare("select sql from sqlite_master where type = 'table' and name = 'workspace_bridge_email_invitations'").get() as { sql: string };
  const nextSchema = schema.sql.replace("workspace_bridge_email_invitations", "workspace_bridge_email_invitations_next")
    .replace(/recipient_user_id text not null/i, "recipient_user_id text");
  db.exec("pragma foreign_keys = off");
  try {
    db.transaction(() => {
      db.exec(nextSchema);
      const names = columns.map((column) => `"${column.name}"`).join(", ");
      db.exec(`insert into workspace_bridge_email_invitations_next (${names}) select ${names} from workspace_bridge_email_invitations`);
      db.exec("drop table workspace_bridge_email_invitations");
      db.exec("alter table workspace_bridge_email_invitations_next rename to workspace_bridge_email_invitations");
    })();
  } finally { db.exec("pragma foreign_keys = on"); }
}

function migrate(db: Database.Database): void {
  const hadReplyPreferences = Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = 'tyr_reply_preferences'").get());
  const agentsTableExisted = Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = 'agents'").get());
  const agentsHadDesiredRuntimeState = agentsTableExisted && (
    db.prepare("pragma table_info(agents)").all() as Array<{ name: string }>
  ).some((column) => column.name === "desired_runtime_state");
  db.exec(`
    create table if not exists users (
      id text primary key,
      name text not null unique,
      display_name text not null,
      email text,
      password_hash text,
      description text,
      avatar_url text,
      email_verified integer not null default 0,
      password_setup_required integer not null default 0,
      preferred_language text,
      created_at text not null
    );

    create table if not exists auth_sessions (
      access_token text primary key,
      refresh_token text not null unique,
      user_id text not null references users(id) on delete cascade,
      created_at text not null,
      expires_at text not null,
      refresh_expires_at text not null,
      last_refreshed_at text not null,
      previous_refresh_token text,
      previous_refresh_expires_at text
    );

    create table if not exists platform_operators (
      id text primary key,
      login text not null unique,
      display_name text not null,
      password_hash text not null,
      enabled integer not null default 1,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists platform_operator_sessions (
      id text primary key,
      operator_id text not null references platform_operators(id) on delete cascade,
      token_hash text not null unique,
      expires_at text not null,
      last_seen_at text not null,
      revoked_at text,
      created_at text not null
    );

    create index if not exists idx_platform_operator_sessions_operator
      on platform_operator_sessions(operator_id, expires_at);

    create table if not exists servers (
      id text primary key,
      name text not null,
      slug text not null unique,
      owner_user_id text not null references users(id),
      onboarding_agent_id text,
      plan text not null default 'free',
      plan_downgraded_at text,
      created_at text not null
    );

    create table if not exists platform_operator_workspace_grants (
      operator_id text not null references platform_operators(id) on delete cascade,
      server_id text not null references servers(id) on delete cascade,
      scopes text not null,
      created_at text not null,
      updated_at text not null,
      primary key(operator_id, server_id)
    );

    create table if not exists server_invites (
      id text primary key,
      server_id text not null default 'local',
      invited_email text not null,
      invited_by_user_id text not null references users(id),
      status text not null,
      expires_at text not null,
      created_at text not null
    );

    create table if not exists workspace_bridges (
      id text primary key,
      workspace_a_id text not null references servers(id),
      workspace_b_id text not null references servers(id),
      status text not null,
      direction text not null,
      scope text not null,
      permissions_json text not null,
      invited_by_user_id text not null references users(id),
      approved_by_a_user_id text references users(id),
      approved_by_b_user_id text references users(id),
      created_at text not null,
      accepted_at text,
      revoked_at text,
      last_activity_at text
    );

    create table if not exists workspace_bridge_connection_intents (
      id text primary key,
      source_workspace_id text not null references servers(id),
      invited_by_user_id text not null references users(id),
      code_hash text not null unique,
      status text not null,
      target_workspace_id text references servers(id),
      claimed_by_user_id text references users(id),
      bridge_id text references workspace_bridges(id),
      created_at text not null,
      expires_at text not null,
      claimed_at text,
      confirmed_at text,
      cancelled_at text
    );

    create table if not exists tyr_reply_preferences (
      user_id text primary key references users(id),
      mode text not null check(mode in ('human', 'autonomous')),
      legacy_default integer not null default 0,
      updated_at text not null
    );
    create table if not exists telegram_message_origins (
      message_id text primary key references messages(id),
      user_id text not null references users(id),
      server_id text not null references servers(id),
      telegram_account_id text not null,
      chat_id text not null,
      telegram_message_id integer not null,
      reaction text,
      updated_at text not null
    );
    create table if not exists workspace_bridge_human_replies (
      request_id text primary key references cross_workspace_messages(id),
      owner_user_id text not null references users(id),
      server_id text not null references servers(id),
      classification text not null,
      status text not null check(status in ('waiting', 'answered', 'cancelled')),
      notice_message_id text references messages(id),
      reply_content text,
      reply_message_id text references messages(id),
      terminal_id text references cross_workspace_messages(id),
      origin_message_id text references messages(id),
      created_at text not null,
      answered_at text
    );
    create index if not exists idx_bridge_human_replies_owner
      on workspace_bridge_human_replies(owner_user_id, server_id, created_at);
    create unique index if not exists idx_bridge_human_replies_origin
      on workspace_bridge_human_replies(origin_message_id) where origin_message_id is not null;

    create table if not exists workspace_bridge_email_invitations (
      intent_id text primary key references workspace_bridge_connection_intents(id),
      recipient_user_id text references users(id),
      recipient_email text not null,
      sender_address text not null,
      origin_message_id text not null,
      origin_channel_id text not null,
      origin_conversation_id text not null,
      origin_source text not null,
      origin_external_ref text,
      email_subject text not null,
      email_text text,
      delivery_status text not null default 'pending',
      delivery_attempts integer not null default 0,
      next_attempt_at text not null,
      lease_until text,
      sent_at text,
      provider_message_id text,
      unique(origin_message_id, recipient_user_id)
    );

    create table if not exists workspace_bridge_invite_notices (
      intent_id text not null references workspace_bridge_email_invitations(intent_id),
      kind text not null,
      content text not null,
      message_id text,
      status text not null default 'pending',
      attempts integer not null default 0,
      next_attempt_at text not null,
      lease_until text,
      primary key(intent_id, kind)
    );

    create table if not exists cross_workspace_messages (
      id text primary key,
      bridge_id text not null references workspace_bridges(id),
      conversation_id text references conversations(id) on delete cascade,
      client_request_id text,
      retry_of_message_id text references cross_workspace_messages(id),
      response_kind text,
      interaction_event_id text,
      terminal_request_id text references cross_workspace_messages(id),
      reviewed_child_terminal_id text references cross_workspace_messages(id),
      resolved_by_terminal_id text references cross_workspace_messages(id),
      origin_conversation_key text,
      origin_channel_id text,
      origin_conversation_id text,
      origin_message_id text,
      origin_source text,
      origin_external_ref text,
      origin_external_delivered_at text,
      awaiting_agent_id text references agents(id),
      continuation_state text,
      continuation_reply_message_id text references messages(id),
      source_workspace_id text not null references servers(id),
      target_workspace_id text not null references servers(id),
      sender_user_id text references users(id),
      sender_user_name text,
      sender_user_display_name text,
      sender_user_avatar_url text,
      source_capability_user_id text references users(id),
      target_capability_user_id text references users(id),
      original_sender_user_id text references users(id),
      trace_id text,
      parent_bridge_request_id text references cross_workspace_messages(id),
      hop_count integer not null default 0,
      attachment_ids text not null default '[]',
      source_agent_names text not null default '[]',
      sender_comms_agent_id text not null references agents(id),
      receiver_comms_agent_id text not null references agents(id),
      initiated_by text not null,
      content text not null,
      outcome text not null,
      local_message_id text references messages(id),
      peer_message_id text references messages(id),
      reply_to_message_id text references cross_workspace_messages(id),
      created_at text not null,
      updated_at text not null
    );

    create index if not exists idx_cross_workspace_messages_bridge_created
      on cross_workspace_messages(bridge_id, created_at);
    create index if not exists idx_cross_workspace_messages_trace_request
      on cross_workspace_messages(trace_id, response_kind, created_at);

    create table if not exists bridge_followup_dependencies (
      answer_event_id text primary key references cross_workspace_messages(id),
      request_id text not null references cross_workspace_messages(id),
      question_event_id text not null references cross_workspace_messages(id),
      prior_execution_id text not null references runtime_executions(id),
      created_at text not null
    );
    create index if not exists idx_bridge_followup_dependencies_request on bridge_followup_dependencies(request_id);
    create table if not exists bridge_publication_recovery_cutover (
      id integer primary key check (id = 1), cutoff_at text not null
    );
    insert or ignore into bridge_publication_recovery_cutover (id, cutoff_at)
      values (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

    create table if not exists bridge_continuation_attempts (
      id text primary key,
      request_id text not null references cross_workspace_messages(id) on delete cascade,
      state text not null,
      lease_until text not null,
      public_reply_message_id text references messages(id),
      error_code text,
      started_at text not null,
      ended_at text
    );
    create index if not exists idx_bridge_continuation_attempts_request
      on bridge_continuation_attempts(request_id, started_at);
    create table if not exists bridge_continuation_steps (
      attempt_id text not null references bridge_continuation_attempts(id) on delete cascade,
      sequence integer not null,
      tool_name text not null,
      tool_call_id text not null,
      idempotency_key text not null,
      state text not null,
      receipt_json text,
      started_at text not null,
      completed_at text,
      primary key (attempt_id, sequence),
      unique (attempt_id, idempotency_key)
    );

    create table if not exists communication_route_intents (
      source_message_id text primary key references messages(id) on delete cascade,
      server_id text not null references servers(id),
      requesting_user_id text not null references users(id),
      conversation_id text,
      action_kind text not null,
      allowed_actions_json text not null,
      target_bridge_id text references workspace_bridges(id),
      evidence_kind text not null,
      evidence_message_id text references messages(id),
      request_hash text not null,
      routing_revision integer not null,
      created_at text not null,
      plan_json text
    );

    create table if not exists bridge_route_intents (
      parent_request_id text primary key references cross_workspace_messages(id) on delete cascade,
      root_message_id text references messages(id),
      server_id text not null references servers(id),
      requesting_user_id text references users(id),
      trace_id text,
      action_kind text not null,
      allowed_actions_json text not null,
      target_bridge_id text references workspace_bridges(id),
      evidence_kind text not null,
      evidence_message_id text references messages(id),
      request_hash text not null,
      routing_revision integer not null,
      created_at text not null,
      plan_json text
    );
    create table if not exists bridge_route_clarifications (
      event_id text primary key references cross_workspace_messages(id),
      root_event_id text not null references cross_workspace_messages(id),
      root_request_id text not null references cross_workspace_messages(id),
      source_message_id text references messages(id),
      question_event_id text not null references cross_workspace_messages(id),
      content_hash text not null
    );
    create table if not exists bridge_route_intent_revisions (
      request_id text not null references cross_workspace_messages(id),
      revision integer not null,
      answer_event_id text not null references cross_workspace_messages(id),
      intent_json text not null,
      created_at text not null,
      primary key (request_id, revision),
      unique (request_id, answer_event_id)
    );
    create table if not exists bridge_route_intent_cutover (
      id integer primary key check (id = 1),
      cutoff_at text not null
    );
    insert or ignore into bridge_route_intent_cutover (id, cutoff_at)
      values (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

    create table if not exists communication_return_events (
      id text primary key,
      source_execution_id text not null references runtime_executions(id) on delete cascade,
      source_message_id text not null references messages(id) on delete cascade,
      kind text not null,
      content text not null,
      proposed_bridge_id text,
      origin_request_id text,
      peer_message text,
      facts_json text,
      state text not null default 'pending',
      reply_message_id text references messages(id),
      created_at text not null,
      updated_at text not null
    );
    create index if not exists idx_communication_return_events_execution
      on communication_return_events(source_execution_id, created_at);

    create table if not exists communication_evidence_sources (
      receipt_id text primary key,
      source_key text not null unique,
      server_id text not null,
      source_message_id text not null,
      channel_id text not null,
      conversation_id text,
      source_kind text not null,
      facts_json text not null,
      source_content text,
      source_event_id text,
      source_execution_id text,
      source_bridge_message_id text,
      created_at text not null
    );
    create index if not exists idx_communication_evidence_context
      on communication_evidence_sources(server_id, source_message_id, channel_id, conversation_id);
    create table if not exists communication_evidence_publications (
      bridge_message_id text primary key,
      selections_json text not null,
      created_at text not null
    );
    create table if not exists communication_evidence_receipts (
      receipt_id text primary key,
      bridge_message_id text not null,
      source_receipt_id text not null,
      position integer not null,
      facts_json text not null,
      excerpt text,
      provenance_kind text not null,
      unique(bridge_message_id, position)
    );
    create index if not exists idx_communication_evidence_receipts_message
      on communication_evidence_receipts(bridge_message_id, position);

    create table if not exists helpdesk_signup_intents (
      id text primary key,
      email text not null,
      source text not null,
      subject text,
      message text,
      confirmation_token_hash text not null unique,
      status text not null,
      expires_at text not null,
      completed_at text,
      created_user_id text references users(id),
      created_at text not null
    );

    create table if not exists helpdesk_password_recovery_intents (
      id text primary key,
      email text not null,
      user_id text not null references users(id) on delete cascade,
      source text not null,
      subject text,
      message text,
      recovery_token_hash text not null unique,
      status text not null,
      expires_at text not null,
      completed_at text,
      created_at text not null
    );

    create table if not exists helpdesk_resend_email_events (
      email_id text primary key,
      svix_id text,
      status text not null,
      helpdesk_status text,
      reply_email_id text,
      error_code text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists communication_agent_email_aliases (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      assistant_agent_id text not null references agents(id) on delete cascade,
      address text not null unique,
      status text not null default 'active',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists communication_agent_pending_actions (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      assistant_agent_id text not null references agents(id) on delete cascade,
      channel_id text not null references channels(id) on delete cascade,
      source_message_id text references messages(id) on delete set null,
      suggestion_message_id text references messages(id) on delete set null,
      target_agent_id text not null references agents(id) on delete cascade,
      instruction text not null,
      status text not null,
      expires_at text not null,
      created_at text not null,
      resolved_at text
    );

    create table if not exists communication_agent_management_drafts (
      id text primary key,
      operation_id text not null unique,
      server_id text not null references servers(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      assistant_agent_id text not null references agents(id) on delete cascade,
      channel_id text not null references channels(id) on delete cascade,
      source text not null,
      source_conversation_key text not null,
      source_message_id text not null references messages(id) on delete cascade,
      source_event_key text not null,
      action text not null,
      stage text not null,
      params_json text not null default '{}',
      choices_json text not null default '[]',
      status text not null,
      reply_text text,
      error_code text,
      expires_at text not null,
      created_at text not null,
      confirmed_at text,
      resolved_at text,
      unique(server_id, user_id, assistant_agent_id, source, source_conversation_key, source_event_key)
    );

    create table if not exists communication_agent_management_draft_source_events (
      draft_id text not null references communication_agent_management_drafts(id) on delete cascade,
      server_id text not null references servers(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      assistant_agent_id text not null references agents(id) on delete cascade,
      source text not null,
      source_conversation_key text not null,
      source_event_key text not null,
      created_at text not null,
      primary key (server_id, user_id, assistant_agent_id, source, source_conversation_key, source_event_key)
    );

    create table if not exists server_members (
      server_id text not null default 'local',
      user_id text not null references users(id) on delete cascade,
      role text not null,
      joined_at text not null,
      primary key (server_id, user_id)
    );

    create table if not exists user_server_preferences (
      user_id text primary key references users(id) on delete cascade,
      active_server_id text references servers(id) on delete set null,
      updated_at text not null
    );

    create table if not exists server_settings (
      server_id text primary key references servers(id) on delete cascade,
      sidebar_order_json text,
      tyr_routing_instructions text not null default '',
      tyr_routing_revision integer not null default 0,
      tyr_routing_updated_by_user_id text,
      tyr_routing_updated_by_actor_type text,
      tyr_routing_updated_by_actor_id text,
      tyr_routing_updated_at text,
      updated_at text not null
    );

    create table if not exists machines (
      id text primary key,
      server_id text not null default 'local',
      owner_user_id text not null references users(id),
      name text not null,
      hostname text not null,
      os text not null,
      daemon_version text not null,
      runtime_marker text,
      runtime_sha text,
      runtime_marker_mtime text,
      status text not null,
      api_key text not null unique,
      connector_token text,
      connector_token_issued_at text,
      connector_token_revoked_at text,
      pending_connector_token text,
      pending_connector_token_issued_at text,
      pending_connector_token_expires_at text,
      pending_connector_token_rotation_id text,
      previous_connector_token text,
      previous_connector_token_expires_at text,
      connector_token_rotation_ack_at text,
      api_key_used_at text,
      installation_id text,
      host_fingerprint text,
      deleted_at text,
      created_at text not null,
      last_seen_at text not null
    );

    create table if not exists machine_onboarding_intents (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      machine_id text not null references machines(id) on delete cascade,
      requested_by_user_id text not null references users(id) on delete cascade,
      requested_by_agent_id text references agents(id) on delete set null,
      onboarding_code_hash text not null unique,
      status text not null,
      expires_at text not null,
      consumed_at text,
      revoked_at text,
      created_at text not null
    );

    create table if not exists machine_runtime_reports (
      machine_id text not null references machines(id) on delete cascade,
      runtime text not null,
      display_name text not null,
      binary text not null,
      command text,
      version text,
      status text not null,
      reason text,
      checked_at text,
      install_status text,
      auth_status text,
      cli_status text,
      mcp_status text,
      mcp_tool_surface text,
      read_only_enforcement text,
      hidden_mcp_tools text,
      diagnostics text,
      models text,
      default_model text,
      updated_at text not null,
      primary key (machine_id, runtime)
    );

    create table if not exists agents (
      id text primary key,
      server_id text not null default 'local' references servers(id),
      kind text not null default 'on_device',
      owner_user_id text not null references users(id),
      created_by_user_id text references users(id),
      creation_bridge_request_id text,
      creation_trace_id text,
      machine_id text references machines(id),
      name text not null,
      display_name text not null,
      description text,
      profile_revision integer not null default 1,
      profile_applied_revision integer not null default 0,
      profile_apply_error text,
      avatar_url text,
      runtime text,
      model text,
      reasoning_effort text,
      permission_mode text not null default 'workspace-write',
      runtime_resource_grants text not null default '[]',
      env_vars text,
      status text not null,
      desired_runtime_state text not null default 'stopped',
      last_error text,
      workspace_path text,
      session_id text,
      launch_id text,
      auth_token text not null unique,
      deleted_at text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists agent_scopes (
      agent_id text primary key references agents(id) on delete cascade,
      granted text not null,
      mode text not null,
      revision integer not null default 0,
      updated_at text not null
    );

    create table if not exists resource_grants (
      id text primary key,
      resource_type text not null,
      resource_id text not null,
      grantee_user_id text not null references users(id) on delete cascade,
      scopes text not null,
      created_by_user_id text not null references users(id),
      created_at text not null,
      revoked_at text,
      revoked_by_user_id text references users(id)
    );

    create table if not exists devices (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      owner_user_id text not null references users(id) on delete cascade,
      display_name text not null,
      device_kind text not null,
      platform text not null,
      app_version text not null,
      status text not null,
      capabilities text not null,
      capability_descriptors text not null default '[]',
      permission_states text not null,
      device_token text not null unique,
      created_at text not null,
      last_seen_at text not null,
      deleted_at text
    );

    create table if not exists device_pairing_tokens (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      created_by_user_id text not null references users(id) on delete cascade,
      display_name text,
      pinned_agent_id text references agents(id) on delete set null,
      pairing_token text not null unique,
      expires_at text not null,
      consumed_at text,
      created_at text not null
    );

    create table if not exists mobile_app_bindings (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      device_id text not null references devices(id) on delete cascade,
      pinned_agent_id text references agents(id) on delete set null,
      pinned_channel_id text references channels(id) on delete set null,
      status text not null,
      created_at text not null,
      updated_at text not null,
      revoked_at text,
      last_seen_at text
    );

    create unique index if not exists idx_mobile_app_bindings_device_active
      on mobile_app_bindings(device_id)
      where status = 'active' and revoked_at is null;

    create index if not exists idx_mobile_app_bindings_user
      on mobile_app_bindings(server_id, user_id);

    create table if not exists telegram_binding_codes (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      server_id text not null references servers(id) on delete cascade,
      binding_code_hash text not null unique,
      status text not null,
      expires_at text not null,
      consumed_at text,
      created_at text not null
    );

    create index if not exists idx_telegram_binding_codes_user
      on telegram_binding_codes(user_id, status, expires_at);

    create table if not exists telegram_accounts (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      server_id text not null references servers(id) on delete cascade,
      telegram_user_id text not null,
      telegram_chat_id text not null,
      username text,
      first_name text,
      last_name text,
      status text not null,
      created_at text not null,
      updated_at text not null,
      revoked_at text,
      last_seen_at text
    );

    create unique index if not exists idx_telegram_accounts_telegram_active
      on telegram_accounts(telegram_user_id)
      where status = 'active' and revoked_at is null;

    create unique index if not exists idx_telegram_accounts_user_active
      on telegram_accounts(user_id)
      where status = 'active' and revoked_at is null;

    create index if not exists idx_telegram_accounts_server_user
      on telegram_accounts(server_id, user_id);

    create table if not exists telegram_outbound_deliveries (
      id text primary key,
      telegram_account_id text not null references telegram_accounts(id) on delete cascade,
      telegram_chat_id text not null,
      message_id text not null references messages(id) on delete cascade,
      message_seq integer not null,
      chunk_index integer not null,
      text text not null,
      status text not null,
      attempts integer not null default 0,
      next_attempt_at text not null,
      telegram_message_id text,
      last_error text,
      sent_at text,
      created_at text not null,
      updated_at text not null,
      unique(telegram_account_id, message_id, chunk_index)
    );

    create index if not exists idx_telegram_outbound_deliveries_due
      on telegram_outbound_deliveries(status, next_attempt_at, telegram_chat_id, message_seq, chunk_index);

    create index if not exists idx_telegram_outbound_deliveries_message
      on telegram_outbound_deliveries(message_id, telegram_account_id, chunk_index);

    create table if not exists telegram_approval_actions (
      id text primary key,
      approval_id text not null,
      server_id text not null,
      user_id text not null,
      telegram_user_id text not null,
      decision text not null,
      status text not null,
      expires_at text not null,
      consumed_at text,
      created_at text not null,
      updated_at text not null
    );

    create index if not exists idx_telegram_approval_actions_approval
      on telegram_approval_actions(approval_id, status, expires_at);

    create index if not exists idx_telegram_approval_actions_telegram_user
      on telegram_approval_actions(telegram_user_id, status, expires_at);

    create table if not exists telegram_webhook_updates (
      update_id text primary key,
      created_at text not null,
      expires_at text not null
    );

    create index if not exists idx_telegram_webhook_updates_expires
      on telegram_webhook_updates(expires_at);

    create table if not exists telegram_rate_limit_events (
      id text primary key,
      scope_key text not null,
      created_at text not null
    );

    create index if not exists idx_telegram_rate_limit_events_scope
      on telegram_rate_limit_events(scope_key, created_at);

    create index if not exists idx_telegram_rate_limit_events_created
      on telegram_rate_limit_events(created_at);

    create table if not exists device_grants (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      agent_id text not null references agents(id) on delete cascade,
      device_id text not null references devices(id) on delete cascade,
      capabilities text not null,
      scope text not null,
      expires_at text,
      status text not null,
      created_by_user_id text not null references users(id),
      created_at text not null,
      revoked_at text
    );

    create table if not exists device_commands (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      agent_id text not null references agents(id) on delete cascade,
      device_id text not null references devices(id) on delete cascade,
      grant_id text references device_grants(id) on delete set null,
      capability text not null,
      params text not null,
      status text not null,
      requested_by_message_id text references messages(id) on delete set null,
      channel_id text references channels(id) on delete set null,
      task_id text references tasks(id) on delete set null,
      reason text,
      artifact_ids text,
      result_data text,
      error_code text,
      error_message text,
      expires_at text not null,
      created_at text not null,
      completed_at text
    );

    create table if not exists audit_events (
      id text primary key,
      kind text not null,
      actor_type text not null,
      actor_id text,
      resource_type text not null,
      resource_id text,
      server_id text,
      metadata text,
      created_at text not null
    );

    create index if not exists idx_audit_events_created_at
      on audit_events(created_at);

    create table if not exists channels (
      id text primary key,
      server_id text not null default 'local',
      type text not null,
      name text not null,
      display_name text not null,
      active_conversation_id text,
      dm_identity text,
      visibility text not null default 'public',
      description text,
      parent_channel_id text,
      parent_message_id text,
      archived_at text,
      archived_by_user_id text,
      created_at text not null
    );

    create table if not exists conversations (
      id text primary key,
      server_id text not null default 'local',
      channel_id text not null references channels(id) on delete cascade,
      title text not null,
      status text not null,
      started_by_type text not null,
	      started_by_id text not null,
	      started_at text not null,
	      closed_at text,
	      archived_at text,
	      archived_by_user_id text,
	      last_message_at text,
      summary text,
      reset_status text not null default 'not_applicable',
      reset_agent_id text,
      reset_reason text
    );

    create index if not exists idx_conversations_channel_status
      on conversations(channel_id, status, started_at);

    create table if not exists communication_agent_external_conversations (
      id text primary key,
      source text not null,
      server_id text not null references servers(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      assistant_agent_id text not null references agents(id) on delete cascade,
      channel_id text not null references channels(id) on delete cascade,
      source_conversation_key text not null,
      conversation_id text not null references conversations(id) on delete cascade,
      created_at text not null,
      updated_at text not null,
      unique(source, server_id, user_id, assistant_agent_id, source_conversation_key)
    );

    create index if not exists idx_communication_agent_external_conversations_conversation
      on communication_agent_external_conversations(conversation_id);

    create table if not exists communication_agent_handoff_conversations (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      source_conversation_id text not null references conversations(id) on delete cascade,
      assistant_agent_id text not null references agents(id) on delete cascade,
      target_agent_id text not null references agents(id) on delete cascade,
      channel_id text not null references channels(id) on delete cascade,
      conversation_id text not null references conversations(id) on delete cascade,
      created_at text not null,
      updated_at text not null,
      unique(server_id, source_conversation_id, assistant_agent_id, target_agent_id)
    );

    create index if not exists idx_communication_agent_handoff_conversations_conversation
      on communication_agent_handoff_conversations(conversation_id);

    create table if not exists data_migrations (
      id text primary key,
      applied_at text not null
    );

    create table if not exists message_submissions (
      user_id text not null,
      client_request_id text not null,
      payload_hash text not null,
      message_id text not null unique,
      channel_id text not null,
      conversation_id text,
      assistant_agent_id text,
      state text not null check (state in ('queued', 'running', 'dispatched', 'interrupted')),
      reply_message_id text,
      notice_message_id text,
      error_code text,
      created_at text not null,
      updated_at text not null,
      primary key (user_id, client_request_id)
    );
    create index if not exists idx_message_submissions_queue on message_submissions(state, created_at);

    create table if not exists messages (
      id text primary key,
      channel_id text not null references channels(id),
      conversation_id text references conversations(id) on delete set null,
      kind text not null default 'chat',
      sender_type text not null,
      sender_id text not null,
      sender_name text not null,
      content text not null,
      result_payload text,
      source_execution_id text,
      seq integer not null,
      attachment_ids text,
      quote_message_id text references messages(id) on delete set null,
      created_at text not null,
      deleted_at text,
      deleted_by_user_id text,
      deletion_reason text,
      unique(channel_id, seq)
    );

    create table if not exists message_device_refs (
      message_id text not null references messages(id) on delete cascade,
      device_id text not null references devices(id) on delete cascade,
      capability text not null,
      created_at text not null,
      primary key(message_id, device_id, capability)
    );

    create table if not exists tasks (
      id text primary key,
      channel_id text not null references channels(id),
      conversation_id text references conversations(id) on delete set null,
      message_id text not null references messages(id),
      task_number integer not null,
      title text not null,
      status text not null,
      assignee_agent_id text,
      created_by_type text not null,
      created_by_id text not null,
      created_by_name text,
      created_at text not null,
      updated_at text not null,
      unique(channel_id, task_number),
      unique(message_id)
    );

    create table if not exists attachments (
      id text primary key,
      channel_id text not null references channels(id),
      filename text not null,
      mime_type text not null,
      size_bytes integer not null,
      path text not null,
      created_at text not null
    );

    create table if not exists agent_inbox (
      agent_id text not null references agents(id) on delete cascade,
      message_id text not null references messages(id) on delete cascade,
      seq integer not null,
      created_at text not null,
      acked_at text,
      execution_id text,
      primary key(agent_id, message_id)
    );

    create table if not exists agent_channel_memberships (
      agent_id text not null references agents(id) on delete cascade,
      channel_id text not null references channels(id) on delete cascade,
      joined integer not null default 1,
      ordinary_delivery_enabled integer not null default 0,
      updated_at text not null,
      primary key(agent_id, channel_id)
    );

    create table if not exists agent_thread_follows (
      agent_id text not null references agents(id) on delete cascade,
      thread_channel_id text not null references channels(id) on delete cascade,
      followed integer not null default 1,
      updated_at text not null,
      primary key(agent_id, thread_channel_id)
    );

    create table if not exists channel_members (
      channel_id text not null references channels(id) on delete cascade,
      subject_type text not null,
      subject_id text not null,
      role text not null default 'member',
      joined_at text not null,
      left_at text,
      ordinary_delivery_enabled integer not null default 0,
      primary key(channel_id, subject_type, subject_id)
    );

    create table if not exists thread_follows (
      thread_channel_id text not null references channels(id) on delete cascade,
      subject_type text not null,
      subject_id text not null,
      followed_at text not null,
      unfollowed_at text,
      primary key(thread_channel_id, subject_type, subject_id)
    );

    create table if not exists agent_activity (
      agent_id text not null references agents(id) on delete cascade,
      at text not null,
      kind text not null,
      text text not null
    );

    create table if not exists agent_runtime_sessions (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      agent_id text not null references agents(id) on delete cascade,
      machine_id text not null references machines(id) on delete cascade,
      runtime text not null,
      context_kind text not null check(context_kind in ('conversation', 'thread', 'legacy_channel')),
      context_id text not null,
      context_key text not null,
      profile_revision integer not null default 1,
      generation integer not null check(generation > 0),
      runtime_session_id text,
      status text not null check(status in ('pending', 'ready', 'invalidated', 'failed')),
      last_launch_id text,
      first_execution_id text,
      last_execution_id text,
      last_error text,
      created_at text not null,
      updated_at text not null,
      last_used_at text not null,
      invalidated_at text,
      check(status <> 'ready' or runtime_session_id is not null),
      unique(agent_id, machine_id, runtime, context_key, generation)
    );

    create unique index if not exists idx_agent_runtime_sessions_current
      on agent_runtime_sessions(agent_id, machine_id, runtime, context_key)
      where status in ('pending', 'ready');

    create unique index if not exists idx_agent_runtime_sessions_vendor_id
      on agent_runtime_sessions(machine_id, runtime, runtime_session_id)
      where runtime_session_id is not null and status = 'ready';

    create index if not exists idx_agent_runtime_sessions_agent_last_used
      on agent_runtime_sessions(agent_id, last_used_at desc);

    create table if not exists runtime_approvals (
      id text primary key,
      server_id text,
      machine_id text not null references machines(id) on delete cascade,
      agent_id text not null references agents(id) on delete cascade,
      execution_id text,
      task_id text,
      message_id text,
      thread_channel_id text,
      runtime text not null,
      launch_id text,
      request_id text not null,
      method text not null,
      kind text not null,
      title text not null,
      detail text not null,
      payload text,
      status text not null,
      decision text,
      custom_response text,
      requested_at text not null,
      resolved_at text,
      resolved_by_user_id text
    );

    create table if not exists runtime_executions (
      id text primary key,
      server_id text,
      machine_id text not null references machines(id) on delete cascade,
      agent_id text not null references agents(id) on delete cascade,
      agent_name text,
      agent_display_name text,
      agent_owner_user_id text,
      machine_name text,
      machine_hostname text,
      machine_owner_user_id text,
      task_id text,
      message_id text not null,
      thread_channel_id text,
      runtime text not null,
      launch_id text,
      runtime_context_key text,
      runtime_session_record_id text,
      runtime_session_id text,
      runtime_session_generation integer,
      source_execution_id text,
      return_to_agent_id text,
      root_message_id text,
      hop_count integer,
      expect_reply integer,
      return_message_id text,
      return_execution_id text,
      return_dispatched_at text,
      communication_return_channel_id text,
      communication_return_conversation_id text,
      communication_return_source_message_id text,
      communication_return_user_id text,
      communication_return_source text,
      communication_return_external_ref text,
      communication_return_instructions text,
      communication_return_instructions_revision integer,
      communication_return_message_id text,
      communication_return_dispatched_at text,
      controller_actor_mode text,
      status text not null,
      created_at text not null,
      updated_at text not null,
      completed_at text
    );

    create table if not exists runtime_execution_events (
      id text primary key,
      execution_id text not null references runtime_executions(id) on delete cascade,
      agent_id text not null references agents(id) on delete cascade,
      task_id text,
      kind text not null,
      sequence integer not null,
      title text,
      detail text,
      payload text,
      at text not null
    );

    create table if not exists execution_groups (
      id text primary key,
      server_id text not null,
      task_id text,
      message_id text,
      thread_channel_id text,
      status text not null,
      title text not null,
      created_by_user_id text,
      created_at text not null,
      updated_at text not null,
      completed_at text
    );

    create table if not exists agent_runs (
      id text primary key,
      group_id text not null references execution_groups(id) on delete cascade,
      machine_id text not null references machines(id) on delete cascade,
      agent_id text not null references agents(id) on delete cascade,
      agent_name text,
      agent_display_name text,
      agent_owner_user_id text,
      machine_name text,
      machine_hostname text,
      machine_owner_user_id text,
      runtime text not null,
      launch_id text,
      status text not null,
      input_artifact_ids text not null,
      output_artifact_ids text not null,
      created_at text not null,
      updated_at text not null,
      completed_at text
    );

    create table if not exists execution_blocks (
      id text primary key,
      group_id text not null references execution_groups(id) on delete cascade,
      run_id text,
      agent_id text,
      group_sequence integer not null,
      run_sequence integer,
      kind text not null,
      title text not null,
      body_preview text,
      body_ref text,
      status text,
      approval_id text,
      governance_decision_id text,
      artifact_id text,
      raw_event_ids text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists execution_artifacts (
      id text primary key,
      group_id text not null references execution_groups(id) on delete cascade,
      run_id text,
      agent_id text,
      kind text not null,
      title text not null,
      preview text,
      ref_type text not null,
      ref_id text,
      created_at text not null
    );

    create index if not exists idx_agent_runs_group_id on agent_runs(group_id);
    create index if not exists idx_agent_runs_agent_id on agent_runs(agent_id);
    create index if not exists idx_execution_blocks_group_sequence on execution_blocks(group_id, group_sequence);
    create index if not exists idx_execution_blocks_run_sequence on execution_blocks(run_id, run_sequence);
    create index if not exists idx_execution_artifacts_group_id on execution_artifacts(group_id);

    create table if not exists safety_assessments (
      id text primary key,
      server_id text not null,
      machine_id text not null references machines(id) on delete cascade,
      agent_id text not null references agents(id) on delete cascade,
      runtime text not null,
      trigger text not null,
      subject_type text not null,
      subject_id text not null,
      status text not null,
      label text not null,
      risk_types text not null,
      analysis text not null,
      evidence text not null,
      execution_id text,
      approval_id text,
      task_id text,
      message_id text,
      thread_channel_id text,
      model text,
      error text,
      created_at text not null,
      updated_at text not null,
      completed_at text,
      unique(subject_type, subject_id, trigger)
    );

    create table if not exists governance_decisions (
      id text primary key,
      server_id text not null,
      machine_id text not null references machines(id) on delete cascade,
      agent_id text not null references agents(id) on delete cascade,
      runtime text not null,
      trigger text not null,
      subject_type text not null,
      subject_id text not null,
      mode text not null,
      decision text not null,
      confidence real not null,
      risk_types text not null,
      reason text not null,
      evidence text not null,
      policy_version text,
      policy_source text,
      policy_scope text,
      decision_source text,
      execution_id text,
      approval_id text,
      task_id text,
      message_id text,
      thread_channel_id text,
      model text,
      case_summary text,
      created_at text not null
    );

    create table if not exists governance_policy_configs (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      scope text not null,
      agent_id text references agents(id) on delete cascade,
      version text not null,
      rules text not null,
      created_by_user_id text references users(id),
      updated_by_user_id text references users(id),
      created_at text not null,
      updated_at text not null
    );

    create unique index if not exists idx_governance_policy_workspace_unique
      on governance_policy_configs(server_id)
      where scope = 'workspace' and agent_id is null;

    create unique index if not exists idx_governance_policy_agent_unique
      on governance_policy_configs(server_id, agent_id)
      where scope = 'agent' and agent_id is not null;

    create table if not exists governance_policy_config_audit (
      id text primary key,
      config_id text not null references governance_policy_configs(id) on delete cascade,
      server_id text not null references servers(id) on delete cascade,
      scope text not null,
      agent_id text references agents(id) on delete cascade,
      action text not null,
      version text not null,
      rules text not null,
      actor_user_id text references users(id),
      created_at text not null
    );

    create index if not exists idx_governance_policy_config_audit_server_created
      on governance_policy_config_audit(server_id, created_at);

    create table if not exists reminders (
      id text primary key,
      owner_agent_id text not null references agents(id) on delete cascade,
      title text not null,
      status text not null,
      fire_at text not null,
      version integer not null default 1,
      repeat text,
      fire_count integer not null default 0,
      message_id text,
      channel_id text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists reminder_events (
      reminder_id text not null references reminders(id) on delete cascade,
      at text not null,
      type text not null,
      detail text
    );

    create table if not exists tyr_heartbeats (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      tyr_agent_id text not null references agents(id) on delete cascade,
      title text not null,
      instruction text not null,
      interval_unit text not null,
      interval_value integer not null,
      enabled integer not null default 1,
      next_run_at text not null,
      created_by_user_id text references users(id) on delete set null,
      created_by_operator_id text references platform_operators(id) on delete set null,
      created_at text not null,
      updated_at text not null
    );

    create index if not exists idx_tyr_heartbeats_due
      on tyr_heartbeats(enabled, next_run_at);

    create table if not exists tyr_heartbeat_runs (
      id text primary key,
      heartbeat_id text not null references tyr_heartbeats(id) on delete cascade,
      server_id text not null references servers(id) on delete cascade,
      scheduled_for text not null,
      status text not null,
      source_message_id text references messages(id) on delete set null,
      execution_ids text not null default '[]',
      selected_agent_id text references agents(id) on delete set null,
      error_code text,
      error_message text,
      started_at text,
      completed_at text,
      created_at text not null,
      updated_at text not null,
      unique(heartbeat_id, scheduled_for)
    );

    create index if not exists idx_tyr_heartbeat_runs_queue
      on tyr_heartbeat_runs(heartbeat_id, status, scheduled_for);

    create index if not exists idx_tyr_heartbeat_runs_server
      on tyr_heartbeat_runs(server_id, scheduled_for desc);

    create table if not exists workspace_shared_files (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      name text not null,
      mime_type text not null,
      size_bytes integer not null,
      sha256 text not null,
      storage_path text not null,
      original_name text,
      original_mime_type text,
      original_size_bytes integer,
      original_sha256 text,
      original_storage_path text,
      version integer not null default 1,
      created_by_user_id text references users(id) on delete set null,
      created_by_operator_id text references platform_operators(id) on delete set null,
      created_at text not null,
      updated_at text not null,
      unique(server_id, name)
    );

    create table if not exists workspace_shared_file_assignments (
      file_id text not null references workspace_shared_files(id) on delete cascade,
      agent_id text not null references agents(id) on delete cascade,
      permission text not null,
      created_by_user_id text references users(id) on delete set null,
      created_by_operator_id text references platform_operators(id) on delete set null,
      created_at text not null,
      updated_at text not null,
      primary key(file_id, agent_id)
    );

    create index if not exists idx_workspace_shared_files_server
      on workspace_shared_files(server_id, name);

    create index if not exists idx_workspace_shared_file_assignments_agent
      on workspace_shared_file_assignments(agent_id, file_id);

    create table if not exists saved_messages (
      user_id text not null references users(id) on delete cascade,
      message_id text not null references messages(id) on delete cascade,
      created_at text not null,
      primary key(user_id, message_id)
    );

    create table if not exists message_reactions (
      message_id text not null references messages(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      emoji text not null,
      created_at text not null,
      primary key(message_id, user_id, emoji)
    );

    create table if not exists inbox_done_marks (
      user_id text not null references users(id) on delete cascade,
      message_id text not null references messages(id) on delete cascade,
      created_at text not null,
      primary key(user_id, message_id)
    );

    create table if not exists channel_unread_marks (
      user_id text not null references users(id) on delete cascade,
      channel_id text not null references channels(id) on delete cascade,
      first_message_id text,
      unread_count integer not null default 0,
      updated_at text not null,
      primary key(user_id, channel_id)
    );
  `);
  ensureUserOnlyResourceGrants(db);
  ensureCommunicationAgentManagementDraftEventScope(db);
  db.exec(`
    drop index if exists idx_resource_grants_grantee;
    create index if not exists idx_resource_grants_grantee
      on resource_grants(grantee_user_id, resource_type, resource_id, revoked_at);

    create index if not exists idx_resource_grants_resource
      on resource_grants(resource_type, resource_id, revoked_at);

    create index if not exists idx_helpdesk_signup_intents_email
      on helpdesk_signup_intents(lower(email), status, expires_at);

    create index if not exists idx_helpdesk_password_recovery_intents_user
      on helpdesk_password_recovery_intents(user_id, status, expires_at);

    create index if not exists idx_helpdesk_resend_email_events_status
      on helpdesk_resend_email_events(status, updated_at);

    create index if not exists idx_communication_agent_email_aliases_server
      on communication_agent_email_aliases(server_id, status);

    create index if not exists idx_communication_agent_email_aliases_user
      on communication_agent_email_aliases(user_id, status);

    create index if not exists idx_communication_agent_pending_actions_latest
      on communication_agent_pending_actions(server_id, user_id, assistant_agent_id, channel_id, status, created_at);

    create index if not exists idx_communication_agent_pending_actions_target
      on communication_agent_pending_actions(target_agent_id, status, expires_at);

    create index if not exists idx_comm_agent_management_latest
      on communication_agent_management_drafts(
        server_id, user_id, assistant_agent_id, source, source_conversation_key, status, created_at
      );

    create index if not exists idx_comm_agent_management_source_events_draft
      on communication_agent_management_draft_source_events(draft_id, created_at);

  `);
  ensureNullableRuntimeExecutionTaskId(db);
  ensureBridgeEmailRecipientSchema(db);
  ensureColumn(db, "helpdesk_signup_intents", "return_path", "text");
  db.exec(`create unique index if not exists idx_bridge_email_unregistered_recipient
    on workspace_bridge_email_invitations(origin_message_id, recipient_email) where recipient_user_id is null`);
  ensureColumn(db, "machines", "server_id", "text not null default 'local'");
  ensureColumn(db, "communication_return_events", "facts_json", "text");
  ensureAgentKindSchema(db);
  ensureColumn(db, "agents", "created_by_user_id", "text references users(id)");
  ensureColumn(db, "agents", "creation_bridge_request_id", "text");
  ensureColumn(db, "agents", "creation_trace_id", "text");
  ensureColumn(db, "users", "password_hash", "text");
  ensureColumn(db, "users", "description", "text");
  migrateCommunicationEmailAliases(db);
  ensureColumn(db, "workspace_bridge_email_invitations", "sender_name", "text");
  ensureColumn(db, "users", "avatar_url", "text");
  ensureColumn(db, "users", "email_verified", "integer not null default 0");
  ensureColumn(db, "users", "password_setup_required", "integer not null default 0");
  ensureColumn(db, "users", "preferred_language", "text");
  // One-time migration: existing people retain automatic replies; new people default to human.
  if (!hadReplyPreferences) db.prepare(`insert or ignore into tyr_reply_preferences
    (user_id, mode, legacy_default, updated_at) select id, 'autonomous', 1, ? from users`).run(nowIso());
  ensureColumn(db, "auth_sessions", "refresh_expires_at", "text");
  ensureColumn(db, "auth_sessions", "last_refreshed_at", "text");
  ensureColumn(db, "auth_sessions", "previous_refresh_token", "text");
  ensureColumn(db, "auth_sessions", "previous_refresh_expires_at", "text");
  db.exec(`
    update auth_sessions
    set refresh_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+30 days')
    where refresh_expires_at is null;

    update auth_sessions
    set last_refreshed_at = created_at
    where last_refreshed_at is null;
  `);
  ensureColumn(db, "server_invites", "server_id", "text not null default 'local'");
  ensureColumn(db, "server_settings", "tyr_routing_instructions", "text not null default ''");
  ensureColumn(db, "server_settings", "tyr_routing_revision", "integer not null default 0");
  ensureColumn(db, "server_settings", "tyr_routing_updated_by_user_id", "text");
  ensureColumn(db, "server_settings", "tyr_routing_updated_by_actor_type", "text");
  ensureColumn(db, "server_settings", "tyr_routing_updated_by_actor_id", "text");
  ensureColumn(db, "server_settings", "tyr_routing_updated_at", "text");
  ensureColumn(db, "agents", "avatar_url", "text");
  ensureColumn(db, "agents", "profile_revision", "integer not null default 1");
  ensureColumn(db, "agents", "profile_applied_revision", "integer not null default 0");
  ensureColumn(db, "agents", "profile_apply_error", "text");
  ensureColumn(db, "agents", "permission_mode", "text not null default 'workspace-write'");
  ensureColumn(db, "agents", "runtime_resource_grants", "text not null default '[]'");
  ensureColumn(db, "agents", "env_vars", "text");
  ensureColumn(db, "agents", "last_error", "text");
  ensureColumn(db, "agents", "desired_runtime_state", "text not null default 'stopped'");
  if (!agentsHadDesiredRuntimeState) {
    // 首次引入 desired state 时只继承迁移瞬间确实运行的 Agent；Offline/Error 不会被意外拉起。
    db.prepare(
      `update agents
       set desired_runtime_state = case
         when kind <> 'communication' and status in ('online', 'working') then 'running'
         when kind = 'communication' then 'running'
         else 'stopped'
       end`
    ).run();
  }
  ensureColumn(db, "agents", "deleted_at", "text");
  ensureColumn(db, "channels", "archived_at", "text");
  ensureColumn(db, "channels", "archived_by_user_id", "text");
  ensureColumn(db, "machines", "connector_token_issued_at", "text");
  ensureColumn(db, "machines", "connector_token_revoked_at", "text");
  ensureColumn(db, "machines", "pending_connector_token", "text");
  ensureColumn(db, "machines", "pending_connector_token_issued_at", "text");
  ensureColumn(db, "machines", "pending_connector_token_expires_at", "text");
  ensureColumn(db, "machines", "pending_connector_token_rotation_id", "text");
  ensureColumn(db, "machines", "previous_connector_token", "text");
  ensureColumn(db, "machines", "previous_connector_token_expires_at", "text");
  ensureColumn(db, "machines", "connector_token_rotation_ack_at", "text");
  ensureColumn(db, "machines", "api_key_used_at", "text");
  ensureColumn(db, "machines", "installation_id", "text");
  ensureColumn(db, "machines", "host_fingerprint", "text");
  ensureColumn(db, "machines", "runtime_marker", "text");
  ensureColumn(db, "machines", "runtime_sha", "text");
  ensureColumn(db, "machines", "runtime_marker_mtime", "text");
  ensureColumn(db, "machines", "deleted_at", "text");
  ensureColumn(db, "machine_runtime_reports", "default_model", "text");
  ensureColumn(db, "machine_runtime_reports", "command", "text");
  ensureColumn(db, "machine_runtime_reports", "reason", "text");
  ensureColumn(db, "machine_runtime_reports", "checked_at", "text");
  ensureColumn(db, "machine_runtime_reports", "install_status", "text");
  ensureColumn(db, "machine_runtime_reports", "auth_status", "text");
  ensureColumn(db, "machine_runtime_reports", "cli_status", "text");
  ensureColumn(db, "machine_runtime_reports", "mcp_status", "text");
  ensureColumn(db, "machine_runtime_reports", "mcp_tool_surface", "text");
  ensureColumn(db, "machine_runtime_reports", "read_only_enforcement", "text");
  ensureColumn(db, "machine_runtime_reports", "hidden_mcp_tools", "text");
  ensureColumn(db, "machine_runtime_reports", "diagnostics", "text");
  ensureColumn(db, "devices", "capability_descriptors", "text not null default '[]'");
  ensureColumn(db, "devices", "deleted_at", "text");
  ensureColumn(db, "device_pairing_tokens", "pinned_agent_id", "text references agents(id) on delete set null");
  ensureColumn(db, "channels", "server_id", "text not null default 'local'");
  ensureColumn(db, "channels", "visibility", "text not null default 'public'");
  ensureColumn(db, "channels", "active_conversation_id", "text");
  ensureColumn(db, "channels", "dm_identity", "text");
  ensureColumn(db, "conversations", "archived_at", "text");
  ensureColumn(db, "conversations", "archived_by_user_id", "text");
  ensureColumn(db, "cross_workspace_messages", "conversation_id", "text");
  ensureColumn(db, "cross_workspace_messages", "client_request_id", "text");
  ensureColumn(db, "cross_workspace_messages", "retry_of_message_id", "text");
  ensureColumn(db, "cross_workspace_messages", "response_kind", "text");
  ensureColumn(db, "cross_workspace_messages", "interaction_event_id", "text");
  ensureColumn(db, "cross_workspace_messages", "terminal_request_id", "text");
  ensureColumn(db, "cross_workspace_messages", "reviewed_child_terminal_id", "text");
  ensureColumn(db, "cross_workspace_messages", "resolved_by_terminal_id", "text");
  ensureColumn(db, "cross_workspace_messages", "origin_conversation_key", "text");
  ensureColumn(db, "cross_workspace_messages", "origin_channel_id", "text");
  ensureColumn(db, "cross_workspace_messages", "origin_conversation_id", "text");
  ensureColumn(db, "cross_workspace_messages", "origin_message_id", "text");
  ensureColumn(db, "cross_workspace_messages", "origin_source", "text");
  ensureColumn(db, "cross_workspace_messages", "origin_external_ref", "text");
  ensureColumn(db, "cross_workspace_messages", "origin_external_delivered_at", "text");
  ensureColumn(db, "cross_workspace_messages", "awaiting_agent_id", "text");
  ensureColumn(db, "cross_workspace_messages", "continuation_state", "text");
  ensureColumn(db, "cross_workspace_messages", "continuation_reply_message_id", "text");
  ensureColumn(db, "cross_workspace_messages", "sender_user_id", "text");
  ensureColumn(db, "cross_workspace_messages", "sender_user_name", "text");
  ensureColumn(db, "cross_workspace_messages", "sender_user_display_name", "text");
  ensureColumn(db, "cross_workspace_messages", "sender_user_avatar_url", "text");
  ensureColumn(db, "cross_workspace_messages", "source_capability_user_id", "text");
  ensureColumn(db, "cross_workspace_messages", "target_capability_user_id", "text");
  ensureColumn(db, "cross_workspace_messages", "original_sender_user_id", "text");
  ensureColumn(db, "cross_workspace_messages", "trace_id", "text");
  ensureColumn(db, "cross_workspace_messages", "parent_bridge_request_id", "text");
  ensureColumn(db, "cross_workspace_messages", "hop_count", "integer not null default 0");
  ensureColumn(db, "cross_workspace_messages", "attachment_ids", "text not null default '[]'");
  ensureColumn(db, "cross_workspace_messages", "source_agent_names", "text not null default '[]'");
  ensureColumn(db, "cross_workspace_messages", "updated_at", "text");
  db.exec("create index if not exists idx_cross_workspace_messages_origin_wait on cross_workspace_messages(origin_message_id, continuation_state)");
  ensureColumn(db, "messages", "kind", "text not null default 'chat'");
  ensureColumn(db, "messages", "conversation_id", "text");
  ensureColumn(db, "messages", "result_payload", "text");
  ensureColumn(db, "messages", "source_execution_id", "text");
  ensureColumn(db, "messages", "quote_message_id", "text references messages(id) on delete set null");
  ensureColumn(db, "messages", "deleted_at", "text");
  ensureColumn(db, "messages", "deleted_by_user_id", "text");
  ensureColumn(db, "messages", "deletion_reason", "text");
  ensureColumn(db, "tasks", "conversation_id", "text");
  ensureColumn(db, "agent_inbox", "execution_id", "text");
  ensureColumn(db, "runtime_approvals", "execution_id", "text");
  ensureColumn(db, "runtime_approvals", "task_id", "text");
  ensureColumn(db, "runtime_approvals", "message_id", "text");
  ensureColumn(db, "runtime_approvals", "thread_channel_id", "text");
  ensureColumn(db, "governance_decisions", "policy_version", "text");
  ensureColumn(db, "governance_decisions", "policy_source", "text");
  ensureColumn(db, "governance_decisions", "policy_scope", "text");
  ensureColumn(db, "governance_decisions", "decision_source", "text");
  ensureColumn(db, "runtime_executions", "source_execution_id", "text");
  ensureColumn(db, "runtime_executions", "return_to_agent_id", "text");
  ensureColumn(db, "runtime_executions", "root_message_id", "text");
  ensureColumn(db, "runtime_executions", "hop_count", "integer");
  ensureColumn(db, "runtime_executions", "expect_reply", "integer");
  ensureColumn(db, "runtime_executions", "return_message_id", "text");
  ensureColumn(db, "runtime_executions", "return_execution_id", "text");
  ensureColumn(db, "runtime_executions", "return_dispatched_at", "text");
  ensureColumn(db, "runtime_executions", "communication_return_channel_id", "text");
  ensureColumn(db, "runtime_executions", "communication_return_conversation_id", "text");
  ensureColumn(db, "runtime_executions", "communication_return_source_message_id", "text");
  ensureColumn(db, "runtime_executions", "communication_return_user_id", "text");
  ensureColumn(db, "runtime_executions", "communication_return_source", "text");
  ensureColumn(db, "runtime_executions", "communication_return_external_ref", "text");
  ensureColumn(db, "runtime_executions", "communication_return_instructions", "text");
  ensureColumn(db, "runtime_executions", "communication_return_instructions_revision", "integer");
  ensureColumn(db, "runtime_executions", "communication_return_message_id", "text");
  ensureColumn(db, "runtime_executions", "communication_return_dispatched_at", "text");
  ensureColumn(db, "communication_route_intents", "plan_json", "text");
  ensureColumn(db, "bridge_route_intents", "plan_json", "text");
  ensureColumn(db, "communication_return_events", "origin_request_id", "text");
  ensureColumn(db, "communication_return_events", "peer_message", "text");
  ensureColumn(db, "runtime_executions", "controller_actor_mode", "text");
  ensureColumn(db, "workspace_shared_files", "original_name", "text");
  ensureColumn(db, "workspace_shared_files", "original_mime_type", "text");
  ensureColumn(db, "workspace_shared_files", "original_size_bytes", "integer");
  ensureColumn(db, "workspace_shared_files", "original_sha256", "text");
  ensureColumn(db, "workspace_shared_files", "original_storage_path", "text");
  // Legacy rows use their current bytes as the immutable baseline. Later writes always move only the working pointer.
  db.prepare(
    `update workspace_shared_files
     set original_name = coalesce(original_name, name),
         original_mime_type = coalesce(original_mime_type, mime_type),
         original_size_bytes = coalesce(original_size_bytes, size_bytes),
         original_sha256 = coalesce(original_sha256, sha256),
         original_storage_path = coalesce(original_storage_path, storage_path)`
  ).run();
  // 已在途的 TYR handoff 通常把可见来源消息固化为 root_message_id；升级时据此恢复精确回传会话。
  db.exec(`
    update runtime_executions
    set communication_return_conversation_id = (
      select messages.conversation_id
      from messages
      where messages.id = runtime_executions.root_message_id
    )
    where communication_return_channel_id is not null
      and communication_return_conversation_id is null
      and root_message_id is not null
  `);
  ensureColumn(db, "runtime_executions", "runtime_context_key", "text");
  ensureColumn(db, "runtime_executions", "runtime_session_record_id", "text");
  ensureColumn(db, "runtime_executions", "runtime_session_id", "text");
  ensureColumn(db, "runtime_executions", "runtime_session_generation", "integer");
  // 旧 Session 视为 revision 1；当 Agent 已更新到更高版本时，下一次 dispatch 会惰性换代。
  ensureColumn(db, "agent_runtime_sessions", "profile_revision", "integer not null default 1");
  for (const table of ["runtime_executions", "agent_runs"]) {
    ensureColumn(db, table, "agent_name", "text");
    ensureColumn(db, table, "agent_display_name", "text");
    ensureColumn(db, table, "agent_owner_user_id", "text");
    ensureColumn(db, table, "machine_name", "text");
    ensureColumn(db, table, "machine_hostname", "text");
    ensureColumn(db, table, "machine_owner_user_id", "text");
  }
  db.exec(`
    update cross_workspace_messages
    set updated_at = created_at
    where updated_at is null;

    -- 历史重复行继续保留用于审计，只有最早的终态占用读模型槽位。
    update cross_workspace_messages as candidate
    set terminal_request_id = candidate.reply_to_message_id
    where candidate.reply_to_message_id is not null
      and candidate.terminal_request_id is null
      and candidate.response_kind in ('final', 'error')
      and candidate.id = (
        select first_terminal.id
        from cross_workspace_messages as first_terminal
        where first_terminal.reply_to_message_id = candidate.reply_to_message_id
          and first_terminal.response_kind in ('final', 'error')
        order by first_terminal.created_at asc, first_terminal.id asc
        limit 1
      );

    create unique index if not exists idx_cross_workspace_messages_terminal_request
      on cross_workspace_messages(terminal_request_id)
      where terminal_request_id is not null;

    create unique index if not exists idx_cross_workspace_messages_interaction_event
      on cross_workspace_messages(reply_to_message_id, interaction_event_id)
      where interaction_event_id is not null;

    create index if not exists idx_cross_workspace_messages_bridge_conversation_created
      on cross_workspace_messages(bridge_id, conversation_id, created_at);

    create unique index if not exists idx_cross_workspace_messages_client_request
      on cross_workspace_messages(bridge_id, conversation_id, source_workspace_id, client_request_id)
      where client_request_id is not null;

    create index if not exists idx_cross_workspace_messages_origin
      on cross_workspace_messages(bridge_id, source_workspace_id, origin_conversation_key, created_at);

    create index if not exists idx_cross_workspace_messages_parent_request
      on cross_workspace_messages(parent_bridge_request_id, created_at);

    create index if not exists idx_runtime_approvals_pending_requested
      on runtime_approvals(requested_at)
      where status = 'pending';

    create index if not exists idx_messages_source_execution_created
      on messages(source_execution_id, created_at);

    create index if not exists idx_runtime_executions_message_created
      on runtime_executions(message_id, created_at);

    create index if not exists idx_runtime_executions_context_created
      on runtime_executions(agent_id, runtime_context_key, created_at);

    create index if not exists idx_runtime_executions_session_record
      on runtime_executions(runtime_session_record_id, created_at);

    create index if not exists idx_runtime_executions_server_status_updated
      on runtime_executions(server_id, status, updated_at desc);

    create index if not exists idx_runtime_executions_server_created
      on runtime_executions(server_id, created_at desc);

    create index if not exists idx_runtime_execution_events_execution_sequence
      on runtime_execution_events(execution_id, sequence);

    create index if not exists idx_agent_activity_agent_at
      on agent_activity(agent_id, at desc);

    create index if not exists idx_auth_sessions_previous_refresh
      on auth_sessions(previous_refresh_token);

    create index if not exists idx_machines_connector_token_auth
      on machines(connector_token, connector_token_revoked_at);

    create index if not exists idx_machines_pending_connector_token_auth
      on machines(pending_connector_token, pending_connector_token_expires_at, connector_token_revoked_at);

    create index if not exists idx_machines_previous_connector_token_auth
      on machines(previous_connector_token, previous_connector_token_expires_at, connector_token_revoked_at);

    create index if not exists idx_runtime_approvals_execution_requested
      on runtime_approvals(execution_id, requested_at);

    create index if not exists idx_runtime_approvals_message_requested
      on runtime_approvals(message_id, requested_at);

    create index if not exists idx_runtime_approvals_thread_requested
      on runtime_approvals(thread_channel_id, requested_at);
  `);
  ensureColumn(db, "reminders", "version", "integer not null default 1");
  ensureColumn(db, "reminders", "repeat", "text");
  ensureColumn(db, "reminders", "fire_count", "integer not null default 0");
  ensureDmConversations(db);
  migrateLegacyConversationTitles(db);
  db.prepare("update server_members set role = 'guest' where role = 'member'").run();
  db.prepare(
    `insert or ignore into channel_members (channel_id, subject_type, subject_id, role, joined_at, left_at, ordinary_delivery_enabled)
     select memberships.channel_id, 'agent', memberships.agent_id, 'member', memberships.updated_at,
       case when memberships.joined = 1 then null else memberships.updated_at end,
       memberships.ordinary_delivery_enabled
     from agent_channel_memberships memberships
     join channels on channels.id = memberships.channel_id
     where channels.type = 'dm'`
  ).run();
  db.prepare(
    `insert or ignore into thread_follows (thread_channel_id, subject_type, subject_id, followed_at, unfollowed_at)
     select thread_channel_id, 'agent', agent_id, updated_at, case when followed = 1 then null else updated_at end
     from agent_thread_follows`
  ).run();
  const legacySystemSender = ["Slo", "ck"].join("");
  db.prepare("update messages set sender_name = ? where sender_type = 'system' and sender_id = 'system' and lower(sender_name) = lower(?)").run(SYSTEM_SENDER_NAME, legacySystemSender);
  db.prepare("update messages set sender_name = ? where sender_type = 'system' and sender_id = 'system' and lower(sender_name) = lower(?)").run(SYSTEM_SENDER_NAME, LEGACY_SYSTEM_SENDER_NAME);
  db.prepare("update messages set content = ? where sender_type = 'system' and sender_id = 'system' and content = ?").run(SYSTEM_WELCOME_MESSAGE, LEGACY_SYSTEM_WELCOME_MESSAGE);
  const communicationAgentBrandUpdatedAt = new Date().toISOString();
  // Communication Agent 是固定产品身份；存量 workspace 必须与新建 workspace 一样统一显示 TYR。
  db.prepare("update agents set display_name = ?, updated_at = ? where kind = 'communication' and display_name <> ?")
    .run(DEFAULT_COMMUNICATION_AGENT_DISPLAY_NAME, communicationAgentBrandUpdatedAt, DEFAULT_COMMUNICATION_AGENT_DISPLAY_NAME);
  // 历史消息只改写 TYR 自己的署名与正文，不触碰 Human 或 Runtime Agent 创作的内容。
  db.prepare(
    `update messages
     set sender_name = ?,
         content = replace(content, ?, ?),
         result_payload = case
           when result_payload is null then null
           else replace(result_payload, ?, ?)
         end
     where sender_type = 'agent'
       and sender_id in (select id from agents where kind = 'communication')`
  ).run(
    DEFAULT_COMMUNICATION_AGENT_DISPLAY_NAME,
    LEGACY_COMMUNICATION_AGENT_DISPLAY_NAME,
    DEFAULT_COMMUNICATION_AGENT_DISPLAY_NAME,
    LEGACY_COMMUNICATION_AGENT_DISPLAY_NAME,
    DEFAULT_COMMUNICATION_AGENT_DISPLAY_NAME
  );
  // DM 元数据是派生展示快照；内部 channel name 与固定 pair identity 保持不变。
  db.prepare(
    `update channels
     set display_name = case
           when display_name = 'DM @tyr-assistant' then 'TYR DM'
           else replace(display_name, ?, ?)
         end,
         description = replace(description, ?, ?)
     where type = 'dm'
       and (display_name = 'DM @tyr-assistant' or instr(display_name, ?) > 0 or instr(coalesce(description, ''), ?) > 0)`
  ).run(
    LEGACY_COMMUNICATION_AGENT_DISPLAY_NAME,
    DEFAULT_COMMUNICATION_AGENT_DISPLAY_NAME,
    LEGACY_COMMUNICATION_AGENT_DISPLAY_NAME,
    DEFAULT_COMMUNICATION_AGENT_DISPLAY_NAME,
    LEGACY_COMMUNICATION_AGENT_DISPLAY_NAME,
    LEGACY_COMMUNICATION_AGENT_DISPLAY_NAME
  );
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.prepare(`alter table ${table} add column ${column} ${definition}`).run();
  }
}

function ensureFixedDmIdentities(db: Database.Database): void {
  const migratedAt = new Date().toISOString();
  const dmRows = db.prepare(
    "select id, name, dm_identity from channels where type = 'dm' order by created_at"
  ).all() as Array<{ id: string; name: string; dm_identity?: string | null }>;
  const activeMembers = db.prepare(
    `select subject_type, subject_id
     from channel_members
     where channel_id = ? and left_at is null
     order by joined_at`
  );
  const agentOwner = db.prepare("select owner_user_id from agents where id = ?");
  // 迁移只在下方能唯一证明 pair 时执行，也需要修复非空但无法解析的旧值。
  const setIdentity = db.prepare("update channels set dm_identity = ? where id = ?");
  const leaveNonCanonicalMembers = db.prepare(
    `update channel_members
     set left_at = coalesce(left_at, ?), ordinary_delivery_enabled = 0
     where channel_id = ? and not (
       (subject_type = 'human' and subject_id = ?) or
       (subject_type = 'agent' and subject_id in (?, ?))
     )`
  );
  const leaveNonCanonicalAgentMemberships = db.prepare(
    `update agent_channel_memberships
     set joined = 0, ordinary_delivery_enabled = 0, updated_at = ?
     where channel_id = ? and agent_id not in (?, ?)`
  );
  const ensureMember = db.prepare(
    `insert into channel_members
      (channel_id, subject_type, subject_id, role, joined_at, left_at, ordinary_delivery_enabled)
     values (?, ?, ?, ?, ?, null, ?)
     on conflict(channel_id, subject_type, subject_id) do update set
       role = excluded.role,
       left_at = null,
       ordinary_delivery_enabled = excluded.ordinary_delivery_enabled`
  );
  const ensureAgentMembership = db.prepare(
    `insert into agent_channel_memberships
      (agent_id, channel_id, joined, ordinary_delivery_enabled, updated_at)
     values (?, ?, 1, 1, ?)
     on conflict(agent_id, channel_id) do update set
       joined = 1,
       ordinary_delivery_enabled = 1,
       updated_at = excluded.updated_at`
  );

  db.transaction(() => {
    for (const dm of dmRows) {
      if (parseDmIdentity(dm.dm_identity)) continue;
      const members = activeMembers.all(dm.id) as Array<{ subject_type: "agent" | "human"; subject_id: string }>;
      const agentIds = members.filter((member) => member.subject_type === "agent").map((member) => member.subject_id);
      const humanIds = members.filter((member) => member.subject_type === "human").map((member) => member.subject_id);
      let identity: DmIdentity | null = null;

      if (dm.name.startsWith("dm-agent-pair-") && agentIds.length === 2) {
        identity = { kind: "agent_pair", agentIds: [...agentIds].sort() as [string, string] };
      } else {
        // 新式 Human-Agent DM 的稳定名称可以在污染成员表时仍唯一找回原 pair。
        const namedPairs = humanIds.flatMap((humanUserId) => (
          agentIds
            .filter((agentId) => slugifyName(`dm-${humanUserId}-${agentId}`) === dm.name)
            .map((agentId) => ({ kind: "human_agent", humanUserId, agentId }) as DmIdentity)
        ));
        if (namedPairs.length === 1) {
          identity = namedPairs[0];
        } else if (humanIds.length === 1 && agentIds.length === 1) {
          identity = { kind: "human_agent", humanUserId: humanIds[0], agentId: agentIds[0] };
        } else if (humanIds.length === 0 && agentIds.length === 1) {
          const owner = agentOwner.get(agentIds[0]) as { owner_user_id: string } | undefined;
          if (owner?.owner_user_id) identity = { kind: "human_agent", humanUserId: owner.owner_user_id, agentId: agentIds[0] };
        }
      }
      // 无法唯一证明 pair 的异常 DM 保持无身份并封闭访问，避免猜测后扩大权限。
      if (!identity) continue;
      setIdentity.run(serializeDmIdentity(identity), dm.id);

      const humanUserId = identity.kind === "human_agent" ? identity.humanUserId : "";
      const canonicalAgentIds = identity.kind === "agent_pair" ? identity.agentIds : [identity.agentId];
      leaveNonCanonicalMembers.run(
        migratedAt,
        dm.id,
        humanUserId,
        canonicalAgentIds[0],
        canonicalAgentIds[1] ?? canonicalAgentIds[0]
      );
      leaveNonCanonicalAgentMemberships.run(
        migratedAt,
        dm.id,
        canonicalAgentIds[0],
        canonicalAgentIds[1] ?? canonicalAgentIds[0]
      );
      if (identity.kind === "human_agent") ensureMember.run(dm.id, "human", identity.humanUserId, "owner", migratedAt, 0);
      for (const agentId of canonicalAgentIds) {
        ensureMember.run(dm.id, "agent", agentId, "member", migratedAt, 1);
        ensureAgentMembership.run(agentId, dm.id, migratedAt);
      }
    }
  })();
}

function retireColdGroupActivity(db: Database.Database): void {
  const retiredAt = new Date().toISOString();
  db.transaction(() => {
    // 普通群聊记录仍原样保留；这里只关闭可能继续投递、执行或提示用户的活动状态。
    db.prepare(
      `with cold_channels as (
         select child.id
         from channels child
         left join channels parent on parent.id = child.parent_channel_id
         where child.type = 'channel' or (child.type = 'thread' and parent.type = 'channel')
       )
       update agent_inbox
       set acked_at = coalesce(acked_at, ?)
       where message_id in (
         select messages.id from messages join cold_channels on cold_channels.id = messages.channel_id
       )`
    ).run(retiredAt);

    db.prepare(
      `with cold_channels as (
         select child.id
         from channels child
         left join channels parent on parent.id = child.parent_channel_id
         where child.type = 'channel' or (child.type = 'thread' and parent.type = 'channel')
       ),
       cold_executions as (
         select executions.id
         from runtime_executions executions
         left join messages on messages.id = executions.message_id
         where messages.channel_id in (select id from cold_channels)
            or executions.thread_channel_id in (select id from cold_channels)
       )
       update runtime_approvals
       set status = 'rejected',
           decision = 'reject',
           custom_response = coalesce(custom_response, 'Historical group conversation retired'),
           resolved_at = coalesce(resolved_at, ?),
           resolved_by_user_id = coalesce(resolved_by_user_id, 'system:group-retired')
       where status = 'pending'
         and (
           message_id in (select messages.id from messages join cold_channels on cold_channels.id = messages.channel_id)
           or thread_channel_id in (select id from cold_channels)
           or execution_id in (select id from cold_executions)
         )`
    ).run(retiredAt);

    db.prepare(
      `with cold_channels as (
         select child.id
         from channels child
         left join channels parent on parent.id = child.parent_channel_id
         where child.type = 'channel' or (child.type = 'thread' and parent.type = 'channel')
       )
       update runtime_executions
       set status = 'cancelled',
           updated_at = ?,
           completed_at = coalesce(completed_at, ?)
       where status in ('queued', 'delivered', 'running', 'waiting_approval')
         and (
           message_id in (select messages.id from messages join cold_channels on cold_channels.id = messages.channel_id)
           or thread_channel_id in (select id from cold_channels)
         )`
    ).run(retiredAt, retiredAt);

    db.prepare(
      `with cold_channels as (
         select child.id
         from channels child
         left join channels parent on parent.id = child.parent_channel_id
         where child.type = 'channel' or (child.type = 'thread' and parent.type = 'channel')
       )
       update mobile_app_bindings
       set pinned_agent_id = null, pinned_channel_id = null, updated_at = ?
       where pinned_channel_id in (select id from cold_channels)`
    ).run(retiredAt);

    db.prepare(
      `with cold_channels as (
         select child.id
         from channels child
         left join channels parent on parent.id = child.parent_channel_id
         where child.type = 'channel' or (child.type = 'thread' and parent.type = 'channel')
       )
       delete from channel_unread_marks where channel_id in (select id from cold_channels)`
    ).run();

    db.prepare(
      `with cold_channels as (
         select child.id
         from channels child
         left join channels parent on parent.id = child.parent_channel_id
         where child.type = 'channel' or (child.type = 'thread' and parent.type = 'channel')
       )
       update reminders
       set status = 'canceled', version = version + 1, updated_at = ?
       where status in ('scheduled', 'fired')
         and (
           channel_id in (select id from cold_channels)
           or message_id in (select messages.id from messages join cold_channels on cold_channels.id = messages.channel_id)
         )`
    ).run(retiredAt);
  })();
}

function ensureCommunicationAgentManagementDraftEventScope(db: Database.Database): void {
  const expected = ["server_id", "user_id", "assistant_agent_id", "source", "source_conversation_key", "source_event_key"];
  const uniqueIndexes = (db.prepare("pragma index_list(communication_agent_management_drafts)").all() as Array<{
    name: string;
    unique: 0 | 1;
  }>).filter((index) => index.unique === 1);
  const hasExactScope = uniqueIndexes.some((index) => {
    const columns = (db.prepare(`pragma index_info(${JSON.stringify(index.name)})`).all() as Array<{ seqno: number; name: string }>)
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => column.name);
    return columns.length === expected.length && columns.every((column, position) => column === expected[position]);
  });
  if (hasExactScope) return;

  const foreignKeysEnabled = Number(db.pragma("foreign_keys", { simple: true }) ?? 0) === 1;
  if (foreignKeysEnabled) db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      // SQLite 不能原地替换 table-level UNIQUE；完整 rebuild 保留历史草稿并收窄初始事件幂等范围。
      db.exec(`
        drop table if exists communication_agent_management_drafts_next;
        create table communication_agent_management_drafts_next (
          id text primary key,
          operation_id text not null unique,
          server_id text not null references servers(id) on delete cascade,
          user_id text not null references users(id) on delete cascade,
          assistant_agent_id text not null references agents(id) on delete cascade,
          channel_id text not null references channels(id) on delete cascade,
          source text not null,
          source_conversation_key text not null,
          source_message_id text not null references messages(id) on delete cascade,
          source_event_key text not null,
          action text not null,
          stage text not null,
          params_json text not null default '{}',
          choices_json text not null default '[]',
          status text not null,
          reply_text text,
          error_code text,
          expires_at text not null,
          created_at text not null,
          confirmed_at text,
          resolved_at text,
          unique(server_id, user_id, assistant_agent_id, source, source_conversation_key, source_event_key)
        );
        insert into communication_agent_management_drafts_next
          (id, operation_id, server_id, user_id, assistant_agent_id, channel_id, source,
           source_conversation_key, source_message_id, source_event_key, action, stage,
           params_json, choices_json, status, reply_text, error_code, expires_at, created_at,
           confirmed_at, resolved_at)
        select
          id, operation_id, server_id, user_id, assistant_agent_id, channel_id, source,
          source_conversation_key, source_message_id, source_event_key, action, stage,
          params_json, choices_json, status, reply_text, error_code, expires_at, created_at,
          confirmed_at, resolved_at
        from communication_agent_management_drafts;
        drop table communication_agent_management_drafts;
        alter table communication_agent_management_drafts_next rename to communication_agent_management_drafts;
      `);
    })();
  } finally {
    // 初始化前若启用了 FK，成功或异常都恢复同一连接的保护状态。
    if (foreignKeysEnabled) db.pragma("foreign_keys = ON");
  }

  const violations = [
    ...(db.pragma("foreign_key_check(communication_agent_management_drafts)") as unknown[]),
    ...(db.pragma("foreign_key_check(communication_agent_management_draft_source_events)") as unknown[])
  ];
  if (violations.length > 0) throw new Error("communication_agent_management_draft_migration_foreign_key_violation");
}

function ensureDmConversations(db: Database.Database): void {
  const now = new Date().toISOString();
  const dms = db.prepare("select * from channels where type = 'dm'").all() as Array<{ id: string; server_id?: string | null; display_name?: string | null; active_conversation_id?: string | null }>;
  const insertConversation = db.prepare(
    `insert into conversations
     (id, server_id, channel_id, title, status, started_by_type, started_by_id, started_at, closed_at, last_message_at, summary, reset_status, reset_agent_id, reset_reason)
     values (?, ?, ?, ?, 'active', 'system', 'system', ?, null,
       (select max(created_at) from messages where channel_id = ?),
       null, 'not_applicable', null, null)`
  );
  const updateChannel = db.prepare("update channels set active_conversation_id = ? where id = ?");
  const updateMessages = db.prepare("update messages set conversation_id = ? where channel_id = ? and conversation_id is null");
  const updateTasks = db.prepare(
    `update tasks
     set conversation_id = (select conversation_id from messages where messages.id = tasks.message_id)
     where channel_id = ? and conversation_id is null`
  );

  db.transaction(() => {
    for (const dm of dms) {
      // Reopening a database must preserve the Web selection across parallel TYR conversations.
      const selected = dm.active_conversation_id
        ? db.prepare("select id from conversations where id = ? and channel_id = ? and status = 'active' and archived_at is null").get(dm.active_conversation_id, dm.id) as { id: string } | undefined
        : undefined;
      const existing = selected ?? db.prepare("select id from conversations where channel_id = ? and status = 'active' and archived_at is null order by started_at desc limit 1").get(dm.id) as { id: string } | undefined;
      const conversationId = existing?.id ?? `conv_${randomUUID().replaceAll("-", "")}`;
      if (!existing) insertConversation.run(conversationId, dm.server_id ?? "local", dm.id, dm.display_name || "DM conversation", now, dm.id);
      // Legacy DM rows become one active conversation so old chats stay visible until a fresh context starts.
      updateChannel.run(conversationId, dm.id);
      updateMessages.run(conversationId, dm.id);
      updateTasks.run(dm.id);
    }
  })();
}

function migrateLegacyConversationTitles(db: Database.Database): void {
  const migrationId = "conversation_history_titles_v1";
  if (db.prepare("select 1 from data_migrations where id = ?").get(migrationId)) return;
  db.transaction(() => {
    // 每个旧 DM 最早的 conversation 是上线会话切分前的历史容器，可能混有多个主题，只能使用中性名称。
    db.prepare(
      `update conversations
       set title = 'Conversation history'
       where conversations.id = (
         select oldest.id
         from conversations oldest
         where oldest.channel_id = conversations.channel_id
         order by oldest.started_at asc, oldest.id asc
         limit 1
       )
       and exists (
         select 1
         from messages
         where messages.conversation_id = conversations.id
           and messages.deleted_at is null
       )`
    ).run();
    db.prepare("insert into data_migrations (id, applied_at) values (?, ?)").run(migrationId, new Date().toISOString());
  })();
}

function ensureUserOnlyResourceGrants(db: Database.Database): void {
  const columns = db.prepare("pragma table_info(resource_grants)").all() as Array<{ name: string }>;
  const hasUserOnlyColumn = columns.some((item) => item.name === "grantee_user_id");
  const hasLegacyColumns = columns.some((item) => item.name === "grantee_type" || item.name === "grantee_id");
  if (hasUserOnlyColumn && !hasLegacyColumns) return;

  const foreignKeysEnabled = Number(db.pragma("foreign_keys", { simple: true }) ?? 0) === 1;
  if (foreignKeysEnabled) db.pragma("foreign_keys = OFF");
  db.exec(`
    create table resource_grants_user_only (
      id text primary key,
      resource_type text not null,
      resource_id text not null,
      grantee_user_id text not null references users(id) on delete cascade,
      scopes text not null,
      created_by_user_id text not null references users(id),
      created_at text not null,
      revoked_at text,
      revoked_by_user_id text references users(id)
    );
    insert into resource_grants_user_only
      (id, resource_type, resource_id, grantee_user_id, scopes, created_by_user_id, created_at, revoked_at, revoked_by_user_id)
      select id, resource_type, resource_id, grantee_id, scopes, created_by_user_id, created_at, revoked_at, revoked_by_user_id
      from resource_grants
      where grantee_type = 'user'
        and exists (select 1 from users where users.id = resource_grants.grantee_id)
        and exists (select 1 from users where users.id = resource_grants.created_by_user_id);
    drop table resource_grants;
    alter table resource_grants_user_only rename to resource_grants;
  `);
  if (foreignKeysEnabled) db.pragma("foreign_keys = ON");
}

function ensureNullableRuntimeExecutionTaskId(db: Database.Database): void {
  const columns = db.prepare("pragma table_info(runtime_executions)").all() as Array<{ name: string; notnull: number }>;
  const taskId = columns.find((item) => item.name === "task_id");
  if (!taskId || taskId.notnull === 0) return;
  const foreignKeysEnabled = Number(db.pragma("foreign_keys", { simple: true }) ?? 0) === 1;
  if (foreignKeysEnabled) db.pragma("foreign_keys = OFF");
  db.exec(`
    create table runtime_executions_new (
      id text primary key,
      server_id text,
      machine_id text not null references machines(id) on delete cascade,
      agent_id text not null references agents(id) on delete cascade,
      task_id text,
      message_id text not null,
      thread_channel_id text,
      runtime text not null,
      launch_id text,
      status text not null,
      created_at text not null,
      updated_at text not null,
      completed_at text
    );
    insert into runtime_executions_new
      (id, server_id, machine_id, agent_id, task_id, message_id, thread_channel_id, runtime, launch_id, status, created_at, updated_at, completed_at)
      select id, server_id, machine_id, agent_id, task_id, message_id, thread_channel_id, runtime, launch_id, status, created_at, updated_at, completed_at
      from runtime_executions;
    drop table runtime_executions;
    alter table runtime_executions_new rename to runtime_executions;
  `);
  if (foreignKeysEnabled) db.pragma("foreign_keys = ON");
}

function seed(db: Database.Database): void {
  const createdAt = nowIso();
  const userCount = db.prepare("select count(*) from users").pluck().get() as number;
  if (userCount === 0) {
    db.prepare("insert into users (id, name, display_name, email, password_hash, created_at) values (?, ?, ?, ?, ?, ?)").run(
      "user-90-young",
      "90-young",
      "90 young",
      "young@example.local",
      hashPassword("12345678"),
      createdAt
    );
  } else {
    db.prepare("update users set password_hash = coalesce(password_hash, ?)").run(hashPassword("12345678"));
  }
  const ownerRow = db.prepare("select id, name, display_name, created_at from users order by created_at limit 1").get() as { id: string; name: string; display_name: string; created_at: string } | undefined;
  if (ownerRow) {
    const slug = slugifyName(ownerRow.name.replace(/^user-/, "") || ownerRow.display_name || "young");
    db.prepare(
      `insert or ignore into servers (id, name, slug, owner_user_id, onboarding_agent_id, plan, plan_downgraded_at, created_at)
       values ('local', ?, ?, ?, null, 'free', null, ?)`
    ).run(slug, slug, ownerRow.id, ownerRow.created_at);
    db.prepare(
      `insert or ignore into server_members (server_id, user_id, role, joined_at)
       values ('local', ?, 'owner', ?)`
    ).run(ownerRow.id, ownerRow.created_at);
    db.prepare(
      `insert or ignore into user_server_preferences (user_id, active_server_id, updated_at)
       values (?, 'local', ?)`
    ).run(ownerRow.id, ownerRow.created_at);
  }
}

function ensureExistingTaskThreads(db: Database.Database): void {
  const rows = db.prepare(
    `select tasks.message_id, tasks.task_number, messages.channel_id, messages.id as parent_message_id
     from tasks
     join messages on messages.id = tasks.message_id
     left join channels thread on thread.type = 'thread' and thread.parent_message_id = tasks.message_id
     where thread.id is null`
  ).all() as Array<{ message_id: string; task_number: number; channel_id: string; parent_message_id: string }>;
  const insert = db.prepare(
    `insert into channels (id, server_id, type, name, display_name, visibility, description, parent_channel_id, parent_message_id, created_at)
     values (?, ?, 'thread', ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of rows) {
    const parent = db.prepare("select server_id, visibility from channels where id = ?").get(row.channel_id) as { server_id?: string; visibility?: string } | undefined;
    insert.run(
      id("thread"),
      parent?.server_id ?? "local",
      `thread-${row.parent_message_id.slice(4, 12)}`,
      `Thread #${row.task_number}`,
      parent?.visibility ?? "public",
      `Task #${row.task_number} thread`,
      row.channel_id,
      row.parent_message_id,
      nowIso()
    );
  }
}
