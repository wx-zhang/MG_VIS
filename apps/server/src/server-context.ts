import type express from "express";
import type multer from "multer";
import type WebSocket from "ws";
import type {
  AgentRecord,
  AgentCapability,
  ChannelRecord,
  CrossWorkspaceMessageRecord,
  AttachmentRecord,
  MachineRecord,
  MessageRecord,
  GovernanceDecisionRecord,
  ReminderJob,
  RuntimeApprovalRecord,
  RuntimeExecutionRecord,
  RuntimeId,
  RuntimeModel,
  SkillInfo,
  TaskRecord,
  UserRecord,
  WorkspaceFileNode
} from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import type { DeploymentNoticeStore } from "./deployment-status";
import type { RoutePlanningContext, RoutePlanProposal } from "./communication-route-intent";
import type { WorkspaceSharedFileService } from "./workspace-shared-files";
import type { WorkspaceBridgeEmailInvitations } from "./workspace-bridge-email-invitations";
import type { WorkspaceBridgeHumanReplies } from "./workspace-bridge-human-replies";
import type { MachineAgentBatchSummary, MachineBatchAction } from "./machine-operations";
import type { SafetyAuditConfig } from "./safety-audit";
import type { GovernanceRuntimeConfig } from "./governance-runtime";
import type { WorkspaceBridgeCapability } from "./workspace-bridge-access";
import type { TyrAssistantTelegramSyncInput } from "./telegram-assistant-sync";
import type {
  AssistantDecision,
  AssistantLlmConfig,
  AssistantLlmContext,
  AssistantToolLoopExecutor,
  AssistantToolLoopResult
} from "./assistant-llm";

type AnyRouteHelper = (...args: any[]) => any;

export type WorkspaceTreeRequest = {
  timer: NodeJS.Timeout;
  resolve: (payload: { dirPath?: string; files: WorkspaceFileNode[] }) => void;
};

export type WorkspaceReadRequest = {
  timer: NodeJS.Timeout;
  resolve: (payload: { content: string | null; binary: boolean; size: number; mimeType?: string; encoding?: string }) => void;
};

export type SkillRequest = {
  timer: NodeJS.Timeout;
  resolve: (payload: { global: SkillInfo[]; runtime?: SkillInfo[]; workspace: SkillInfo[] }) => void;
};

export type RuntimeModelRequest = {
  timer: NodeJS.Timeout;
  machineId: string;
  runtime: RuntimeId;
  resolve: (payload: { models?: RuntimeModel[]; default?: string; error?: string }) => void;
};

// Route modules receive process-local state through this context; ownership of daemon/realtime singletons stays in index.ts for this phase.
export interface ServerRouteContext {
  store: TyrDb;
  deploymentNotice?: DeploymentNoticeStore;
  publicServerUrl: string;
  safetyAuditConfig: SafetyAuditConfig;
  governanceConfig: GovernanceRuntimeConfig;
  assistantLlmConfig?: AssistantLlmConfig;
  workspaceBridgeEmailInvitations?: WorkspaceBridgeEmailInvitations;
  humanReplies?: WorkspaceBridgeHumanReplies;
  /** Server-only route interpretation. Never receives worker or peer-authored output. */
  assistantRoutePlanner?: (context: RoutePlanningContext) => Promise<RoutePlanProposal>;
  assistantLlmDecide?: (context: AssistantLlmContext) => Promise<AssistantDecision>;
  assistantToolLoop?: (context: AssistantLlmContext, executeTool: AssistantToolLoopExecutor) => Promise<AssistantToolLoopResult>;
  latestRuntimeSha?: () => string | undefined;
  upload: multer.Multer;
  workspaceSharedFiles: WorkspaceSharedFileService;
  daemonSockets: Map<string, WebSocket>;
  syncClients: Map<express.Response, string | undefined>;
  workspaceTreeRequests: Map<string, WorkspaceTreeRequest>;
  workspaceReadRequests: Map<string, WorkspaceReadRequest>;
  skillRequests: Map<string, SkillRequest>;
  runtimeModelRequests: Map<string, RuntimeModelRequest>;
  cleanupUploadedFile: (file?: Express.Multer.File) => void;
  validateUploadedFile: (file: Express.Multer.File | undefined) => { ok: true } | { ok: false; status: number; error: string };
  uploadFilename: (originalName: string | undefined) => string;
  agentCanAccessAttachment: AnyRouteHelper;
  requireAuthUser: (req: express.Request, res: express.Response) => UserRecord | null;
  authUser: (req: express.Request) => UserRecord;
  authAgent: (req: express.Request, res: express.Response) => AgentRecord | null;
  requireAgentCapability: (agent: AgentRecord, capability: AgentCapability, res: express.Response) => boolean;
  primaryServerIdForUser: (userId: string) => string | null;
  isServerMember: (userId: string, serverId?: string) => boolean;
  isServerOwner: (userId: string, serverId?: string) => boolean;
  canSeeMachine: (userId: string, machine: MachineRecord | null | undefined) => machine is MachineRecord;
  resolveWorkspaceBridgeCapability: (userId: string, targetWorkspaceId: string) => WorkspaceBridgeCapability | null;
  requireOwnedMachine: AnyRouteHelper;
  requireAgentRuntimeOwner: AnyRouteHelper;
  writeWorkspaceBootstrapSync: (res: express.Response, userId?: string) => void;
  publishWorkspaceSync: () => void;
  broadcastRealtime: AnyRouteHelper;
  emitRealtimeMessage: (message: MessageRecord) => void;
  emitRealtimeWorkspaceBridgeMessage: (message: CrossWorkspaceMessageRecord) => void;
  scheduleWorkspaceBridgeExternalReturn?: (request: CrossWorkspaceMessageRecord, message: MessageRecord) => void;
  scheduleAssistantBridgeContinuation?: (requestId: string) => void;
  scheduleWorkspaceBridgeInteractionContinuation?: (eventMessageId: string) => void;
  scheduleCommunicationReturnEvent?: (eventId: string) => void;
  mirrorTyrAssistantMessagesToTelegram?: (input: TyrAssistantTelegramSyncInput) => void;
  emitRealtimeTaskCreated: (channelId: string, tasks: TaskRecord[]) => void;
  emitRealtimeTaskUpdated: (task: TaskRecord) => void;
  emitRealtimeTaskDeleted: (task: TaskRecord) => void;
  emitRealtimeRuntimeExecution: AnyRouteHelper;
  emitRealtimeRuntimeApproval: (approval: RuntimeApprovalRecord) => void;
  publishTerminalCommunicationFailure?: (execution: RuntimeExecutionRecord) => unknown;
  notifyPendingRuntimeApprovalExternal?: (approval: RuntimeApprovalRecord) => void;
  emitRealtimeGovernanceDecision: (decision: GovernanceDecisionRecord) => void;
  emitRealtimeThreadUpdate: (channelId: string) => void;
  emitRealtimeAgentActivity: AnyRouteHelper;
  emitRealtimeAgentStatus: (agentId: string) => void;
  emitRealtimeMachineUpdated: (machineId: string) => void;
  emitRealtimeMachineDeleted: (machine: MachineRecord) => void;
  formatPublicMessage: AnyRouteHelper;
  formatPublicTask: AnyRouteHelper;
  parseTaskDetails: AnyRouteHelper;
  parseAgentCapabilityList: AnyRouteHelper;
  isTaskStatus: AnyRouteHelper;
  formatSearchMessage: AnyRouteHelper;
  formatChannel: AnyRouteHelper;
  formatSkill: AnyRouteHelper;
  formatActivityLog: AnyRouteHelper;
  gravatarHash: AnyRouteHelper;
  listInboxItems: AnyRouteHelper;
  preferredAgentForTask: AnyRouteHelper;
  deliverPendingToOnlineAgents: () => void;
  dispatchQueuedAgentInbox: (agentId: string, detail: string, executionId?: string) => void;
  createAndEnqueueTaskRun: AnyRouteHelper;
  createAdoptedTaskRun: AnyRouteHelper;
  bindDaemonActiveExecution: AnyRouteHelper;
  bindRuntimeApprovalToTaskExecution: (approval: RuntimeApprovalRecord) => RuntimeApprovalRecord;
  createAndEnqueueTaskRunsForMessage: AnyRouteHelper;
  createAndEnqueueThreadHandoffRun: AnyRouteHelper;
  createAndEnqueueMessageHandoffRun: AnyRouteHelper;
  createAndEnqueueDelegationRun: AnyRouteHelper;
  dispatchReturnToAgentForFinalMessage: AnyRouteHelper;
  completeRuntimeExecutionFromFinalMessage?: (execution: RuntimeExecutionRecord, finalMessage: MessageRecord) => RuntimeExecutionRecord | null;
  createQueuedMessageRuntimeExecutionsForMessage: AnyRouteHelper;
  sendReminderUpsert: AnyRouteHelper;
  sendReminderCancel: AnyRouteHelper;
  sendReminderSnapshot: (agent: AgentRecord) => void;
  startAgent: (agent: AgentRecord, resumePrompt?: string) => boolean;
  contextSessionsEnabledForAgent: (agent: AgentRecord, machine?: MachineRecord | null) => boolean;
  sendToDaemon: AnyRouteHelper;
  daemonSupports: AnyRouteHelper;
  recordConnectorRotationState: AnyRouteHelper;
  sendToDevice: (deviceId: string, msg: unknown) => boolean;
  serverIdForAgent: AnyRouteHelper;
  taskForWakeMessage: AnyRouteHelper;
  mentionedAgentsForContent: (content: string, serverId?: string) => AgentRecord[];
  agentBelongsToServer: AnyRouteHelper;
  canCreateAgentOnMachine: AnyRouteHelper;
  listChannelFileItems: (messages: MessageRecord[], getAttachment: (attachmentId: string) => AttachmentRecord | null) => unknown[];
  listChannelThreadSummariesFromSnapshot: AnyRouteHelper;
  lastMessageAt: AnyRouteHelper;
  formatAgentListItem: AnyRouteHelper;
  formatMachineListResponse: AnyRouteHelper;
  machineConnectCommandSet: AnyRouteHelper;
  runMachineAgentBatchAction: (
    agents: AgentRecord[],
    action: MachineBatchAction,
    callbacks: {
      start(agent: AgentRecord): boolean;
      stop(agent: AgentRecord): boolean;
      markOffline(agent: AgentRecord): void;
    }
  ) => MachineAgentBatchSummary;
  buildAttachmentPreview: AnyRouteHelper;
  attachmentPreviewType: AnyRouteHelper;
  formatInternalMessage: AnyRouteHelper;
  formatInternalTask: AnyRouteHelper;
  formatReminder: (reminder: any) => ReminderJob & Record<string, any>;
}
