import { messageSubmissionDispatcher } from "./message-submissions";
import express from "express";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import WebSocket, { WebSocketServer } from "ws";
import multer from "multer";
import {
  AGENT_CAPABILITIES,
  DEFAULT_RUNTIME_PERMISSION_MODE,
  isCommunicationAgent,
  runtimeAccessConfigurationError,
  type AgentCapability,
  type AgentRecord,
  type AgentRuntimeConfig,
  type AgentWakeMessage,
  type AgentWakeRuntimeContext,
  type ChannelRecord,
  type CrossWorkspaceMessageRecord,
  type DaemonAgentStateSnapshot,
  type DaemonInbound,
  type DaemonOutbound,
  type DeviceCapability,
  type DeviceCapabilityDescriptor,
  type MachineRecord,
  type MessageDeviceRef,
  type MessageRecord,
  type ReminderJob,
  type RuntimeApprovalRecord,
  type RuntimeExecutionRecord,
  type GovernanceDecisionRecord,
  type SafetyAssessmentRecord,
  type RuntimeId,
  type RuntimeReport,
  type RuntimeModel,
  type UserRecord,
  type SkillInfo,
  type TaskRecord,
  type TaskStatus,
  type WorkspaceFileNode
} from "@tyr-ai/contracts";
import { openTyrDb } from "@tyr-ai/db";
import { agentBelongsToServer, canCreateAgentOnMachine, canManageAgentRuntime } from "./access-control";
import { formatActivityLogResponse } from "./activity-log";
import { isRepeatedWorkerQuestion } from "./assistant-question-review";
import { assistantLlmConfigFromEnv, requestAssistantResultPresentation } from "./assistant-llm";
import { AgentStateEventGuard, type AgentStateDecision, type AgentStateSignal } from "./agent-state-events";
import { AgentStartRequestGuard } from "./agent-start-request-guard";
import { createAgentManagementService, emitAgentNavigationRealtimeEvent } from "./agent-management-service";
import {
  reconcileSupersededRuntimeLifecycle,
  settleAgentRuntimeLifecycle,
  type AgentRuntimeLifecycleSettlement
} from "./agent-runtime-lifecycle";
import { periodicAgentStateChanged } from "./agent-state-snapshot";
import { listenPlatformOpsSocket, type PlatformOpsRequest, type PlatformOpsResponse } from "./platform-ops";
import { commitBridgeResultRecovery, inspectBridgeResultRecovery } from "./bridge-result-recovery";
import { clearStalePlatformExecution } from "./platform-stale-execution-ops";
import { rotatePlatformConnectorToken } from "./platform-connector-rotation-ops";
import { attachmentPreviewType, buildAttachmentPreview, listChannelFileItems, validateUploadedFile } from "./attachment-files";
import { warnIfLargeSyncPayload } from "./sync-payload-diagnostics";
import { machineConnectCommandSet } from "./connect-commands";
import { createDaemonMessageQueue } from "./daemon-message-queue";
import { DAEMON_HEARTBEAT_INTERVAL_MS, DaemonConnectionRegistry, type DaemonConnection } from "./daemon-connections";
import { handleAgentDelegateFromDaemon } from "./daemon-agent-delegation";
import { resolveDaemonUpgradeCredential } from "./daemon-auth";
import { DaemonSecurityMetrics, type ConnectorRotationMetricState } from "./daemon-security-metrics";
import { handleDaemonPongRecovery } from "./daemon-pong-recovery";
import { DeliveryInFlightTracker, agentStatusFromActivity, claimNextDeliveryForAgent, deliveryAckTimeoutDetail, messageIdFromDeliveryId, shouldReleaseInFlightForAgentSignal } from "./delivery";
import { acceptsDaemonRuntimeEvent } from "./daemon-runtime-event-policy";
import { acknowledgeRuntimeDelivery, acknowledgeRuntimeDeliveryForExecution, settleNonDispatchableRuntimeInboxDelivery, stallUnacknowledgedRuntimeDelivery, type RuntimeDeliverySettlement } from "./runtime-delivery-settlement";
import { completeDeviceCommandWithResult, markDeviceCommandRunning } from "./device-command-lifecycle";
import { materializeDeviceCommandResultArtifacts } from "./device-result-artifacts";
import { runMachineAgentBatchAction } from "./machine-operations";
import { isTerminalRuntimeExecutionStatus, shouldIgnoreRuntimeEventForExecution } from "./message-deletion";
import { threadChannelIdForWakeMessage } from "./message-wake-routing";
import { threadRuntimeContextForMessage } from "./thread-runtime-context";
import { formatAgentListItem, formatMachineListItem, formatMachineListResponse, lastMessageAt } from "./public-api-formatters";
import { sanitizeHumanVisibleText, sanitizeHumanVisibleValue } from "./output-disclosure";
import { RealtimeEventBuffer, canReceiveRealtimeEventForClient, realtimeResumeCursor, type RealtimeBufferedEvent, type RealtimeEventOptions } from "./realtime-events";
import { createWorkspaceSyncPublisher } from "./workspace-sync-publisher";
import { notifyPendingRuntimeApprovalExternal, runtimeApprovalWithExternalNotificationState } from "./communication-approval-notification";
import { sendCommunicationReturnExternal } from "./communication-return-external";
import { WorkspaceBridgeEmailInvitations } from "./workspace-bridge-email-invitations";
import { deliverReviewedWorkspaceBridgeExternalReturn } from "./workspace-bridge-external-return";
import {
  continueCommunicationAgentAfterBridge,
  continueCommunicationAgentRequest,
  type CommunicationAgentContinuationDraft
} from "./communication-agent";
import { completedFrozenBridgeStep, getCommunicationRouteIntent } from "./communication-route-intent";
import { bridgeRouteIntentPredatesCutover, getBridgeRouteIntent } from "./bridge-route-intent";
import {
  claimBridgeContinuationWithJournal,
  finishBridgeContinuationAttempt,
  interruptRunningBridgeContinuationAttempts
} from "./bridge-continuation-journal";
import { sendAuthorizedCommunicationNextAction } from "./communication-authorized-next-action";
import { verifiedCommunicationOriginAction } from "./communication-origin-route";
import {
  claimBridgeInteractionContinuation,
  enqueueBridgeInteractionContinuation,
  finishBridgeInteractionContinuation,
  pendingBridgeInteractionEventsForRequest,
  recoverBridgeInteractionContinuations
} from "./bridge-interaction-continuation";
import {
  claimCommunicationReturnEvent,
  completeCommunicationReturnEvent,
  getCommunicationReturnEvent,
  interruptCommunicationReturnEvent,
  interruptRunningCommunicationReturnEvents,
  listPendingCommunicationReturnEventIds
} from "./communication-return-ipc";
import { acknowledgeRepeatedBridgeWorkerQuestion, acknowledgePublishedBridgeWorkerQuestion, pendingActionableWorkerEventIds, reviewInboundBridgeWorkerEvent } from "./communication-bridge-worker-review";
import { recordCommunicationNextStepReceipt } from "./communication-next-step-receipt";
import { communicationWorkerOutcome } from "./communication-worker-outcome";
import { selectCommunicationEvidenceForContext } from "./communication-evidence";
import { communicationAgentReturnTerminalProgress } from "./communication-agent-return-progress";
import { enqueueTyrAssistantTelegramMessages, splitTelegramText, type TyrAssistantTelegramSyncInput } from "./telegram-assistant-sync";
import { telegramConfigFromEnv, telegramConfigured } from "./telegram-connector";
import { createTelegramOutboundWorker } from "./telegram-outbound-worker";
import { runtimeApprovalActivityText } from "./runtime-approval-activity";
import { runtimeApprovalGovernanceApplication } from "./runtime-approval-governance-flow";
import { hasRecordedApprovalResolvedEvent, runtimeApprovalExecutionEvent } from "./runtime-approval-policy";
import { hasPendingQueuedOutboundApproval } from "./outbound-approval-queue";
import { runtimeFinalMessageRecoveryDisposition } from "./runtime-final-message-recovery";
import { governanceConfigFromEnv, normalizeServerRuntimeApprovalWithGovernance } from "./governance-runtime";
import { resolveEffectiveGovernanceRuntimeConfig } from "./governance-policy";
import { assistantOutputPreviewBlock, projectGovernanceDecision, projectRuntimeApproval, projectRuntimeExecutionEvent } from "./execution-projector";
import { RuntimeAssistantOutputCoalescer, type RuntimeAssistantOutput, type RuntimeAssistantOutputStatus } from "./runtime-assistant-output-coalescer";
import { prepareRuntimeContextWake } from "./runtime-context-dispatch";
import { applyDaemonContextSessionEvent, replacementForDaemonContextSnapshot } from "./runtime-context-events";
import { runtimeContextSessionsEnabled } from "./runtime-context-session";
import { runtimeAuthHealthFromError, type RuntimeAuthHealthUpdate } from "./runtime-auth-health";
import { createLatestRuntimeShaResolver } from "./runtime-release";
import { runSafetyAudit, safetyAuditConfigFromEnv, shouldTriggerSafetyAudit } from "./safety-audit";
import { agentLongTermMemoryMode, bootstrapSeedMode, loadServerEnvFiles, resolveServerEnvPath, serverEnvMode } from "./server-env";
import { reconcileStaleRuntimeExecutions } from "./stale-runtime-executions";
import { createRuntimeApprovalExpiry } from "./runtime-approval-expiry";
import { createAdoptedTaskRuntimeExecution, createCommunicationReturnFailureMessage, createCommunicationReturnMessageForFinalMessage, createQueuedAgentReturnRuntimeExecution, createQueuedDelegationRuntimeExecution, createQueuedMessageHandoffRuntimeExecution, createQueuedMessageRuntimeExecutionForAgent, createQueuedMessageRuntimeExecutionsForMessage, createQueuedTaskRuntimeExecution, createQueuedThreadHandoffRuntimeExecution, communicationReturnFailureContent, communicationReturnFinalContent, recoverWorkspaceBridgeFinalReplyFromRuntimeOutput, runtimeApprovalWithExecutionFallback } from "./taskRun";
import { buildCompletedCommunicationResult } from "./communication-result";
import { readyRecoveryPlan, shouldDrainPendingAfterDaemonReady, shouldStopBeforeTaskStart, taskWakePlan } from "./taskWake";
import { listChannelThreadSummariesFromSnapshot } from "./thread-summaries";
import { createServerListeningHandler } from "./server-listen";
import type { ServerRouteContext } from "./server-context";
import { createTyrHeartbeatScheduler } from "./tyr-heartbeat-scheduler";
import { WorkspaceBridgeFinalReplyRecovery } from "./workspace-bridge-final-reply-recovery";
import { WorkspaceBridgeRequestService } from "./workspace-bridge-request-service";
import { bridgeReviewedPublicationCandidates, recordStaleBridgeProgress } from "./bridge-publication-reconciliation";
import { heartbeatSharedFileApprovalGrant } from "./heartbeat-runtime-approval";
import { WorkspaceSharedFileError, WorkspaceSharedFileService } from "./workspace-shared-files";
import { registerHttpRoutes } from "./routes/index";
import { WorkspaceBridgeHumanReplies } from "./workspace-bridge-human-replies";
import {
  emitWorkspaceBridgeOriginProgress,
  createWorkspaceBridgeReturnMessageForFailedExecution,
  completeWorkspaceBridgeParentFromContinuation,
  publishReviewedWorkspaceBridgeContinuation,
  publishReviewedWorkspaceBridgeInteraction,
  publishWorkspaceBridgeWorkerEvent,
  recoverPendingCrossWorkspaceBridgeFollowups,
  reconcileReviewedWorkspaceBridgeResult,
  workspaceBridgeRefForExecution
} from "./workspace-bridge-delivery";
import { resolveWorkspaceBridgeCapability } from "./workspace-bridge-access";
import { topologyLiveActivityStateKey } from "./topology-live-activity";
import { registerApiRequestTiming, startEventLoopLagMonitor } from "./api-observability";
import { DeploymentActivityMonitor, DeploymentNoticeStore, deploymentWorkCounts, deploymentBrowserCounts, type DeploymentBrowserPresence } from "./deployment-status";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, "../../..");
loadServerEnvFiles(process.env, { rootDir, mode: serverEnvMode(process.env) });
const dataDir = resolveServerEnvPath(process.env.TYR_DATA_DIR, rootDir, "tyr-data");
const longTermMemoryMode = agentLongTermMemoryMode(process.env);
const seedMode = bootstrapSeedMode(process.env);
const uploadDir = path.join(dataDir, "uploads");
const workspaceSharedFileDir = path.join(dataDir, "workspace-shared-files");
mkdirSync(uploadDir, { recursive: true });
mkdirSync(workspaceSharedFileDir, { recursive: true });

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const publicServerUrl = process.env.TYR_SERVER_URL ?? `http://127.0.0.1:${port}`;
const store = openTyrDb(path.join(dataDir, "tyr.sqlite"), { seed: seedMode });
const safetyAuditConfig = safetyAuditConfigFromEnv(process.env);
const governanceConfig = governanceConfigFromEnv(process.env);
const assistantLlmConfig = assistantLlmConfigFromEnv(process.env);
const latestRuntimeSha = createLatestRuntimeShaResolver({ rootDir, env: process.env });
const telegramConnectorConfig = telegramConfigFromEnv(process.env);
const telegramOutboundWorker = createTelegramOutboundWorker({ store, config: telegramConnectorConfig });
if (telegramConfigured(telegramConnectorConfig)) telegramOutboundWorker.start();

const app = express();
// 生产 Nginx 通过本机 loopback 转发；只信任该 hop，OAuth rate limit 才能看到真实客户端 IP 且不接受公网伪造 X-Forwarded-For。
app.set("trust proxy", "loopback");
registerApiRequestTiming(app);
startEventLoopLagMonitor();
const upload = multer({ dest: uploadDir, limits: { fileSize: 50 * 1024 * 1024 } });
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const realtimeWss = new WebSocketServer({ noServer: true });
const deviceWss = new WebSocketServer({ noServer: true });
const daemonSockets = new Map<string, WebSocket>();
const deviceSockets = new Map<string, WebSocket>();
const daemonConnections = new DaemonConnectionRegistry();
const daemonSecurityMetrics = new DaemonSecurityMetrics();
const deliveryInFlight = new DeliveryInFlightTracker();
const agentStateEvents = new AgentStateEventGuard();
const deliveryAckTimeoutMs = 10_000;
const agentStartRequests = new AgentStartRequestGuard(30_000);
// A legacy daemon can keep reporting an unversioned running process without ever sending
// agent:profile_applied. Recover it once per socket/revision, then leave the Profile pending
// instead of restarting the Runtime on every periodic state snapshot.
const agentProfileRecoveryAttempts = new WeakMap<DaemonConnection, Set<string>>();
const workspaceTreeRequests = new Map<string, { timer: NodeJS.Timeout; resolve: (payload: { dirPath?: string; files: WorkspaceFileNode[] }) => void }>();
const workspaceReadRequests = new Map<string, { timer: NodeJS.Timeout; resolve: (payload: { content: string | null; binary: boolean; size: number; mimeType?: string; encoding?: string }) => void }>();
const skillRequests = new Map<string, { timer: NodeJS.Timeout; resolve: (payload: { global: SkillInfo[]; runtime?: SkillInfo[]; workspace: SkillInfo[] }) => void }>();
const runtimeModelRequests = new Map<string, { timer: NodeJS.Timeout; machineId: string; runtime: RuntimeId; resolve: (payload: { models?: RuntimeModel[]; default?: string; error?: string }) => void }>();
const syncClients = new Map<express.Response, string | undefined>();
const realtimeBuffer = new RealtimeEventBuffer(500);
const topologyLiveWorkRealtimeStateByExecutionId = new Map<string, string>();
const runtimeTurnTimeoutMs = Math.max(1, Number(process.env.TYR_DAEMON_RUNTIME_TURN_TIMEOUT_MS ?? "600000") || 600000);
const communicationReturnFailureTimeoutMs = 30_000;
const communicationReturnFailureTimers = new Map<string, NodeJS.Timeout>();

type RealtimeClient = {
  id: string;
  ws: WebSocket;
  userId?: string;
  serverId?: string;
  joinedChannels: Set<string>;
  pingTimer?: NodeJS.Timeout;
  deploymentPresence?: DeploymentBrowserPresence;
};

const realtimeClients = new Map<WebSocket, RealtimeClient>();
const deploymentActivity = new DeploymentActivityMonitor();
const deploymentNotice = new DeploymentNoticeStore(path.join(dataDir, "deployment-notice.json"));
app.use(deploymentActivity.observeHttp);

app.use("/api/helpdesk/resend-webhook", express.raw({ type: "application/json", limit: "1mb" }));
app.use(express.json({ limit: "5mb" }));

function cleanupUploadedFile(file?: Express.Multer.File): void {
  if (!file) return;
  try {
    unlinkSync(file.path);
  } catch {
    // Best effort cleanup for rejected uploads.
  }
}

function uploadFilename(originalName: string | undefined): string {
  const raw = path.basename(originalName || "attachment").replace(/\0/g, "").trim() || "attachment";
  const decoded = Buffer.from(raw, "latin1").toString("utf8");
  if (decoded !== raw && !decoded.includes("�") && /[\u0080-\u00ff]/.test(raw) && /[^\x00-\x7f]/.test(decoded)) {
    return path.basename(decoded).replace(/\0/g, "").trim() || raw;
  }
  return raw;
}

function agentCanAccessAttachment(agentId: string, attachmentId: string) {
  const attachment = store.getAttachment(attachmentId);
  if (!attachment || !store.canAgentAccessChannel(agentId, attachment.channelId)) return null;
  return attachment;
}

function optionalAuthUser(req: express.Request): UserRecord | null {
  const token = parseBearer(req) || (typeof req.query.token === "string" ? req.query.token : "");
  return token ? store.getUserByAccessToken(token) : null;
}

function requireAuthUser(req: express.Request, res: express.Response): UserRecord | null {
  const user = optionalAuthUser(req);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return user;
}

function primaryServerIdForUser(userId: string): string | null {
  return store.getActiveServerIdForUser(userId);
}

function isServerMember(userId: string, serverId?: string): boolean {
  const servers = store.listServersForUser(userId);
  return serverId ? servers.some((serverRecord) => serverRecord.id === serverId) : servers.length > 0;
}

function isServerOwner(userId: string, serverId?: string): boolean {
  const servers = store.listServersForUser(userId);
  return serverId
    ? servers.some((serverRecord) => serverRecord.id === serverId && serverRecord.role === "owner")
    : servers.some((serverRecord) => serverRecord.role === "owner");
}

function hasWorkspaceServerAccess(userId: string, serverId?: string): boolean {
  if (!serverId) return false;
  return store.listServersForUser(userId).some((serverRecord) => (
    serverRecord.id === serverId &&
    (serverRecord.role === "owner" || serverRecord.role === "member")
  ));
}

function resolveWorkspaceBridgeCapabilityForUser(userId: string, targetWorkspaceId: string) {
  return resolveWorkspaceBridgeCapability(store, userId, targetWorkspaceId);
}

function canSeeMachine(userId: string, machine: MachineRecord | null | undefined): machine is MachineRecord {
  return Boolean(machine && !machine.deletedAt && (
    hasWorkspaceServerAccess(userId, machine.serverId) ||
    store.canUserAccessResource(userId, "machine", machine.id, "view") ||
    resolveWorkspaceBridgeCapabilityForUser(userId, machine.serverId ?? "local")
  ));
}

function canSeeAgent(userId: string, agent: AgentRecord | null | undefined, machine: MachineRecord | null | undefined): agent is AgentRecord {
  if (isCommunicationAgent(agent)) {
    return Boolean(agent && !agent.deletedAt && (
      hasWorkspaceServerAccess(userId, agent.serverId ?? "local") ||
      store.canUserAccessResource(userId, "agent", agent.id, "view") ||
      resolveWorkspaceBridgeCapabilityForUser(userId, agent.serverId ?? "local")
    ));
  }
  return Boolean(agent && machine && !agent.deletedAt && !machine.deletedAt && (
    hasWorkspaceServerAccess(userId, machine.serverId) ||
    store.canUserAccessResource(userId, "agent", agent.id, "view") ||
    resolveWorkspaceBridgeCapabilityForUser(userId, machine.serverId ?? "local")
  ));
}

function requireOwnedMachine(req: express.Request, res: express.Response, machineId: string): { user: UserRecord; machine: MachineRecord; capabilityUser: UserRecord; bridgeCapability: ReturnType<typeof resolveWorkspaceBridgeCapabilityForUser> } | null {
  const user = authUser(req);
  const machine = store.getMachine(machineId);
  if (!canSeeMachine(user.id, machine)) {
    res.status(404).json({ error: "machine_not_found" });
    return null;
  }
  const bridgeCapability = resolveWorkspaceBridgeCapabilityForUser(user.id, machine.serverId ?? "local");
  if (!bridgeCapability && !canCreateAgentOnMachine(user.id, machine)) {
    store.recordAuditEvent({
      kind: "denied_management_action_on_shared_machine",
      actorType: "user",
      actorId: user.id,
      resourceType: "machine",
      resourceId: machine.id,
      serverId: machine.serverId ?? "local",
      metadata: { path: req.path, method: req.method }
    });
    res.status(403).json({ error: "machine_owner_required" });
    return null;
  }
  const capabilityUser = bridgeCapability ? store.getUser(bridgeCapability.capabilityUserId) : user;
  if (!capabilityUser) {
    res.status(403).json({ error: "bridge_capability_owner_not_found" });
    return null;
  }
  return { user, machine, capabilityUser, bridgeCapability };
}

function requireAgentRuntimeOwner(req: express.Request, res: express.Response): { user: UserRecord; agent: AgentRecord; machine: MachineRecord; capabilityUser: UserRecord; bridgeCapability: ReturnType<typeof resolveWorkspaceBridgeCapabilityForUser> } | null {
  const user = authUser(req);
  const agent = store.getAgent(String(req.params.agentId));
  const machine = agent?.machineId ? store.getMachine(agent.machineId) : null;
  if (!agent || !machine || !canSeeAgent(user.id, agent, machine)) {
    res.status(404).json({ error: "agent_not_found" });
    return null;
  }
  const bridgeCapability = resolveWorkspaceBridgeCapabilityForUser(user.id, machine.serverId ?? "local");
  if (!bridgeCapability && !canManageAgentRuntime(user.id, agent, machine)) {
    store.recordAuditEvent({
      kind: "denied_management_action_on_shared_agent",
      actorType: "user",
      actorId: user.id,
      resourceType: "agent",
      resourceId: agent.id,
      serverId: machine.serverId ?? "local",
      metadata: { path: req.path, method: req.method }
    });
    res.status(403).json({ error: "agent_owner_required" });
    return null;
  }
  const capabilityUser = bridgeCapability ? store.getUser(bridgeCapability.capabilityUserId) : user;
  if (!capabilityUser) {
    res.status(403).json({ error: "bridge_capability_owner_not_found" });
    return null;
  }
  return { user, agent, machine, capabilityUser, bridgeCapability };
}

function writeWorkspaceBootstrapSync(res: express.Response, userId?: string): void {
  const bootstrap = store.workspaceBootstrap(userId);
  const bootstrapJson = JSON.stringify(bootstrap);
  warnIfLargeSyncPayload("workspace-bootstrap", bootstrap, { userId });
  res.write(`event: workspace:bootstrap\ndata: ${bootstrapJson}\n\n`);
}

function publishWorkspaceSync(): void {
  for (const [client, userId] of syncClients) writeWorkspaceBootstrapSync(client, userId);
  publishRealtimeHeartbeat();
}

const runtimeWorkspaceSyncPublisher = createWorkspaceSyncPublisher(publishWorkspaceSync);
const assistantOutputCoalescer = new RuntimeAssistantOutputCoalescer({
  previewIntervalMs: 250,
  durableIntervalMs: 5000,
  durableLineInterval: 40,
  onPreview: emitRealtimeAssistantOutputPreview,
  onDurableOutput: persistRealtimeAssistantOutput
});
const daemonMessageQueue = createDaemonMessageQueue<{ machine: MachineRecord; connection: DaemonConnection }, DaemonOutbound>({
  isCurrent: (item) => daemonConnections.isCurrent(item.connection.connection),
  process: (item) => handleDaemonMessage(item.connection.machine, item.message, item.connection.connection),
  onError: (err) => {
    console.error("[server] failed to handle daemon message", err);
  }
});

function socketIoFrame(event: string, payload?: unknown): string {
  return `42${JSON.stringify(payload === undefined ? [event] : [event, payload])}`;
}

function sendRealtime(client: RealtimeClient, event: string, payload?: unknown): void {
  if (client.ws.readyState !== 1) return;
  client.ws.send(socketIoFrame(event, payload));
}

function publishRealtimeHeartbeat(): void {
  for (const client of realtimeClients.values()) {
    if (!client.userId) continue;
    sendRealtime(client, "heartbeat", { seq: realtimeBuffer.currentSeq, ts: Date.now() });
  }
}

function clientCanReceiveRealtime(client: RealtimeClient, item: RealtimeBufferedEvent): boolean {
  return canReceiveRealtimeEventForClient(client, item, {
    isServerMember,
    canUserAccessChannel: (userId, channelId) => store.canUserAccessChannel(userId, channelId),
    channelServerId: (channelId) => store.resolveTarget(channelId)?.serverId
  });
}

function broadcastRealtime(event: string, payload: unknown, options: RealtimeEventOptions = {}): void {
  // Realtime 是统一的人类可见出口；先生成安全公开投影，再进入可重放 buffer 和每个客户端。
  const item = realtimeBuffer.push(event, sanitizeHumanVisibleValue(payload), options);
  for (const client of realtimeClients.values()) {
    if (!clientCanReceiveRealtime(client, item)) continue;
    sendRealtime(client, item.event, item.payload);
  }
}

function emitRealtimeMessage(message: MessageRecord): void {
  broadcastRealtime("message:new", formatPublicMessage(message), { channelId: message.channelId });
  emitRealtimeThreadUpdate(message.channelId);
  runtimeWorkspaceSyncPublisher.schedule();
}

function emitCommunicationReturnTerminalProgress(
  execution: RuntimeExecutionRecord,
  phase: "completed" | "needs_input" | "failed",
  label: string
): void {
  // Bridge 有独立的跨 Workspace 进度协议；这里只收口当前 TYR DM 的本地/外部 handoff。
  if (workspaceBridgeRefForExecution(execution)) return;
  const workspaceId = execution.serverId ?? store.resolveTarget(execution.communicationReturnChannelId ?? "")?.serverId;
  if (!workspaceId) return;
  const assistant = store.ensureDefaultCommunicationAgent(workspaceId);
  const progress = communicationAgentReturnTerminalProgress(execution, assistant, phase, label);
  if (!progress) return;
  broadcastRealtime("communication_agent:progress", { progress }, { channelId: progress.channelId });
}

function emitRealtimeWorkspaceBridgeMessage(message: CrossWorkspaceMessageRecord): void {
  // Bridge 两端只接收所属 Workspace 的事件；同一条跨 Workspace 消息不向其他 server 广播。
  for (const serverId of new Set([message.sourceWorkspaceId, message.targetWorkspaceId])) {
    broadcastRealtime("workspace_bridge:message", { message }, { serverId });
  }
}

function emitRealtimeTopologyLiveWorkChanged(execution: RuntimeExecutionRecord): void {
  const workspaceId = execution.serverId ?? store.getAgent(execution.agentId)?.serverId;
  if (!workspaceId) return;
  const pendingApprovalId = store.listRuntimeApprovals({ executionId: execution.id, limit: 1_000 })
    .find((approval) => approval.status === "pending")?.id;
  // 只在可视活动或通信阶段变化时通知画布；assistant delta 不应触发整张投影反复读取。
  const stateKey = topologyLiveActivityStateKey({
    execution,
    events: store.listRuntimeExecutionEvents(execution.id),
    pendingApprovalId,
    nowMs: Date.now()
  });
  if (topologyLiveWorkRealtimeStateByExecutionId.get(execution.id) === stateKey) return;
  topologyLiveWorkRealtimeStateByExecutionId.set(execution.id, stateKey);
  if (topologyLiveWorkRealtimeStateByExecutionId.size > 5_000) {
    const oldestExecutionId = topologyLiveWorkRealtimeStateByExecutionId.keys().next().value;
    if (oldestExecutionId) topologyLiveWorkRealtimeStateByExecutionId.delete(oldestExecutionId);
  }

  const visibleWorkspaceIds = new Set([workspaceId]);
  const bridgeRef = workspaceBridgeRefForExecution(execution);
  if (bridgeRef && bridgeRef.targetWorkspaceId === workspaceId) {
    const bridge = store.getWorkspaceBridgeForServer(bridgeRef.bridgeId, bridgeRef.sourceWorkspaceId);
    // 只向这条直接 active Bridge 的来源 Workspace 发送失效通知；payload 不携带消息或 runtime 输出。
    if (bridge?.status === "active") visibleWorkspaceIds.add(bridgeRef.sourceWorkspaceId);
  }
  for (const serverId of visibleWorkspaceIds) {
    broadcastRealtime("topology_live_work:changed", {
      executionId: execution.id,
      workspaceId,
      status: execution.status,
      updatedAt: execution.updatedAt
    }, { serverId });
  }
}

function emitRealtimeTaskCreated(channelId: string, tasks: TaskRecord[]): void {
  broadcastRealtime("task:created", { channelId, tasks: tasks.map(formatPublicTask) }, { channelId });
}

function emitRealtimeTaskUpdated(task: TaskRecord): void {
  const payload = formatPublicTask(task);
  broadcastRealtime("task:updated", { channelId: task.channelId, task: payload }, { channelId: task.channelId });
  const message = store.listMessages(task.channelId).find((item) => item.id === task.messageId);
  if (message) broadcastRealtime("message:updated", formatPublicMessage(message), { channelId: task.channelId });
}

function emitRealtimeTaskDeleted(task: TaskRecord): void {
  broadcastRealtime(
    "task:deleted",
    {
      channelId: task.channelId,
      taskId: task.id,
      messageId: task.messageId,
      threadChannelId: task.threadChannelId ?? null,
      taskNumber: task.taskNumber
    },
    { channelId: task.channelId }
  );
  const message = store.listMessages(task.channelId).find((item) => item.id === task.messageId);
  if (message) broadcastRealtime("message:updated", formatPublicMessage(message), { channelId: task.channelId });
}

function emitRealtimeRuntimeExecution(execution: ReturnType<typeof store.getRuntimeExecution> | null, event?: ReturnType<typeof store.appendRuntimeExecutionEvent>): void {
  if (execution && event) {
    emitRealtimeExecutionBlock(execution, projectRuntimeExecutionEvent(store, execution, event));
  }
  if (execution) {
    broadcastRealtime("runtime_execution:updated", { execution }, { serverId: execution.serverId });
    emitRealtimeTopologyLiveWorkChanged(execution);
  }
  if (event) {
    broadcastRealtime("runtime_execution:event", sanitizeHumanVisibleValue({ event }), { serverId: execution?.serverId });
  }
}

function persistRealtimeAssistantOutput(execution: RuntimeExecutionRecord, output: RuntimeAssistantOutput): void {
  const current = store.getRuntimeExecution(execution.id) ?? execution;
  const event = store.appendRuntimeExecutionEvent({
    executionId: current.id,
    agentId: current.agentId,
    taskId: current.taskId,
    kind: "assistant_output",
    title: "Assistant output",
    detail: output.text,
    payload: {
      assistantBlockId: output.assistantBlockId,
      status: output.status,
      ...(output.truncated ? { truncated: true } : {})
    },
    at: output.at
  });
  const updated = store.getRuntimeExecution(current.id) ?? current;
  emitRealtimeRuntimeExecution(updated, event);
  runtimeWorkspaceSyncPublisher.schedule();
}

function emitRealtimeAssistantOutputPreview(execution: RuntimeExecutionRecord, output: RuntimeAssistantOutput): void {
  const block = assistantOutputPreviewBlock(execution, {
    assistantBlockId: output.assistantBlockId,
    bodyPreview: output.text,
    at: output.at,
    status: output.status
  });
  broadcastRealtime("execution_block:preview", sanitizeHumanVisibleValue({ block }), { serverId: execution.serverId, buffer: false });
}

function emitRealtimeRuntimeApproval(approval: RuntimeApprovalRecord): void {
  const execution = approval.executionId ? store.getRuntimeExecution(approval.executionId) : null;
  const block = execution ? projectRuntimeApproval(store, execution, approval) : null;
  const serverId = approval.serverId ?? "local";
  const resolverUserIds = runtimeApprovalResolverUserIds(approval);
  // Approval 含命令详情且可触发副作用；实时卡片、execution block 与 resolve API 必须使用同一动作级授权。
  for (const userId of resolverUserIds) {
    if (execution && block) emitRealtimeExecutionBlock(execution, block, { userId });
    broadcastRealtime("runtime_approval:updated", sanitizeHumanVisibleValue({ approval }), { serverId, userId });
  }
  // Living Topology 只收到无正文的失效通知；审批详情仍只发给有动作权限的用户。
  if (execution) emitRealtimeTopologyLiveWorkChanged(execution);
}

function runtimeApprovalResolverUserIds(approval: RuntimeApprovalRecord): string[] {
  const serverId = approval.serverId ?? "local";
  return store.listServerMembers(serverId)
    .filter((member) => store.canUserResolveRuntimeApproval(member.id, approval))
    .map((member) => member.id);
}

function notifyPendingRuntimeApprovalExternalAsync(approval: RuntimeApprovalRecord): void {
  // 外部渠道只能提醒用户回 Web 审批，不能在 Telegram/Email 内直接放行或拒绝。
  void notifyPendingRuntimeApprovalExternal({ store, publicServerUrl, approval })
    .catch((err) => console.warn(`[server] approval external notification failed approval=${approval.id}: ${err instanceof Error ? err.message : String(err)}`));
}

function emitRealtimeSafetyAssessment(assessment: SafetyAssessmentRecord): void {
  const approval = assessment.approvalId ? store.getRuntimeApproval(assessment.approvalId) : null;
  if (approval) {
    // 与内部审批绑定的审计证据同样可能包含命令详情，只发给该审批的合法处理人。
    for (const userId of runtimeApprovalResolverUserIds(approval)) {
      broadcastRealtime("safety_assessment:updated", sanitizeHumanVisibleValue({ assessment }), { serverId: assessment.serverId, userId });
    }
    return;
  }
  broadcastRealtime("safety_assessment:updated", sanitizeHumanVisibleValue({ assessment }), { serverId: assessment.serverId });
}

function emitRealtimeGovernanceDecision(decision: GovernanceDecisionRecord): void {
  const approval = decision.approvalId ? store.getRuntimeApproval(decision.approvalId) : null;
  if (approval) {
    const execution = decision.executionId ? store.getRuntimeExecution(decision.executionId) : null;
    const block = execution ? projectGovernanceDecision(store, execution, decision) : null;
    // Governance 决策与审批共享动作级可见性，不能绕过内部 DM 隔离重新暴露命令证据。
    for (const userId of runtimeApprovalResolverUserIds(approval)) {
      if (execution && block) emitRealtimeExecutionBlock(execution, block, { userId });
      broadcastRealtime("governance_decision:created", sanitizeHumanVisibleValue({ decision }), { serverId: decision.serverId, userId });
    }
    return;
  }
  if (decision.executionId) {
    const execution = store.getRuntimeExecution(decision.executionId);
    if (execution) emitRealtimeExecutionBlock(execution, projectGovernanceDecision(store, execution, decision));
  }
  broadcastRealtime("governance_decision:created", sanitizeHumanVisibleValue({ decision }), { serverId: decision.serverId });
}

function emitRealtimeExecutionBlock(
  execution: ReturnType<typeof store.getRuntimeExecution>,
  block: ReturnType<typeof projectRuntimeExecutionEvent> | ReturnType<typeof projectRuntimeApproval> | ReturnType<typeof projectGovernanceDecision>,
  options: Pick<RealtimeEventOptions, "userId"> = {}
): void {
  if (!execution || !block) return;
  const group = store.getExecutionGroup(block.groupId);
  const run = block.runId ? store.getAgentRun(block.runId) : null;
  const serverId = group?.serverId ?? execution.serverId;
  if (group) broadcastRealtime("execution_group:updated", { group }, { serverId, ...options });
  if (run) broadcastRealtime("agent_run:updated", { run }, { serverId, ...options });
  broadcastRealtime("execution_block:upserted", sanitizeHumanVisibleValue({ block }), { serverId, ...options });
}

function reconcileStaleRuntimeTurnsBeforeDispatch(): void {
  const result = reconcileStaleRuntimeExecutions(store, {
    timeoutMs: runtimeTurnTimeoutMs,
    onFailed: (execution, event) => emitRealtimeRuntimeExecution(execution, event)
  });
  if (result.failed.length) runtimeWorkspaceSyncPublisher.schedule();
}

function publishAgentRuntimeLifecycleSettlement(settlement: AgentRuntimeLifecycleSettlement): void {
  for (const approval of settlement.resolvedApprovals) emitRealtimeRuntimeApproval(approval);
  for (const event of settlement.events) {
    emitRealtimeRuntimeExecution(store.getRuntimeExecution(event.executionId), event);
  }
  for (const execution of settlement.cancelledExecutions) {
    try {
      publishTerminalCommunicationFailure(execution);
    } catch {
      // 启动恢复以 cancelled execution 为真源；单条客户回传失败不能中断其余 Agent 的生命周期收敛。
    }
  }
}

function reconcileSupersededAgentRuntimeWork(options: {
  agentId?: string;
  activeExecutionId?: string;
  launchBoundary?: boolean;
} = {}): void {
  try {
    let settlement: AgentRuntimeLifecycleSettlement;
    if (options.launchBoundary && options.agentId) {
      const executionIds = store.listRuntimeExecutions({ agentId: options.agentId, limit: 1000 })
        .filter((execution) => ["delivered", "running", "waiting_approval"].includes(execution.status))
        .filter((execution) => execution.id !== options.activeExecutionId)
        .map((execution) => execution.id);
      settlement = settleAgentRuntimeLifecycle(store, {
        agentId: options.agentId,
        reason: "runtime_launch_replaced",
        executionIds
      });
      publishAgentRuntimeLifecycleSettlement(settlement);
    } else {
      settlement = reconcileSupersededRuntimeLifecycle(store, {
        agentId: options.agentId,
        activeExecutionIds: options.activeExecutionId ? new Set([options.activeExecutionId]) : undefined,
        onSettled: publishAgentRuntimeLifecycleSettlement
      }).settlement;
    }
    if (settlement.cancelledExecutions.length || settlement.resolvedApprovals.length) {
      runtimeWorkspaceSyncPublisher.schedule();
    }
  } catch (error) {
    // 启动兜底失败时保留原记录并告警；不能让已监听的 server 或已下发的新 runtime 因修复器异常退出。
    console.warn(`[server] runtime lifecycle reconciliation failed agent=${options.agentId ?? "all"}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runtimeExecutionStatusForEvent(kind: string) {
  if (kind === "queued") return "queued" as const;
  if (kind === "delivered") return "delivered" as const;
  if (kind === "approval_request") return "waiting_approval" as const;
  if (kind === "turn_completed") return "completed" as const;
  if (kind === "diagnostic") return null;
  if (kind === "error") return "failed" as const;
  if (kind === "turn_started" || kind === "thinking" || kind === "assistant_delta" || kind === "assistant_output" || kind === "tool_call" || kind === "tool_output" || kind === "approval_resolved") return "running" as const;
  return null;
}

function assistantFlushStatusForRuntimeEvent(kind: string): RuntimeAssistantOutputStatus {
  if (kind === "error") return "failed";
  if (kind === "turn_completed") return "completed";
  return "running";
}

function isBoilerplateRuntimeThinking(detail: unknown): boolean {
  return typeof detail === "string" && detail.trim() === "Thinking...";
}

function emitRealtimeThreadUpdate(channelId: string): void {
  const channel = store.resolveTarget(channelId);
  if (!channel || channel.type !== "thread" || !channel.parentMessageId) return;
  const replies = store.listMessages(channel.id);
  const participants = Array.from(new Set(replies.filter((message) => message.senderType === "agent").map((message) => message.senderId)));
  broadcastRealtime(
    "thread:updated",
    {
      parentMessageId: channel.parentMessageId,
      threadChannelId: channel.id,
      replyCount: replies.length,
      lastReplyAt: replies.at(-1)?.createdAt ?? null,
      participants
    },
    { channelId: channel.id }
  );
}

function emitRealtimeAgentActivity(
  agentId: string,
  activity: string,
  detail = "",
  entries?: unknown[],
  state?: { launchId?: string; activitySeq?: number }
): void {
  const agent = store.getAgent(agentId);
  const serverId = agent ? serverIdForAgent(agent) : undefined;
  const timestamp = Date.now();
  broadcastRealtime(
    "agent:activity",
    {
      agentId,
      activity,
      detail,
      lastError: agent?.lastError ?? "",
      timestamp,
      // activity 是时间线事件；Agent status 与其持久化版本必须独立，审批等非状态事件不能伪造更“新”的 Working。
      status: agent?.status,
      statusUpdatedAt: agent?.updatedAt,
      updatedAt: agent?.updatedAt,
      launchId: state?.launchId ?? agent?.launchId,
      activitySeq: state?.activitySeq,
      entries: entries?.length ? entries : [{ kind: "status", activity, detail }]
    },
    { serverId }
  );
}

function logRejectedAgentState(signal: AgentStateSignal, decision: AgentStateDecision, source: string): void {
  if (decision.accepted) return;
  console.log(
    `[server] ignored ${source} agent=${signal.agentId} launch=${signal.launchId ?? "missing"} seq=${signal.activitySeq ?? "missing"} reason=${decision.reason}`
  );
}

function emitRealtimeAgentStatus(agentId: string): void {
  const agent = store.getAgent(agentId);
  if (!agent) return;
  emitRealtimeAgentActivity(agent.id, agent.status, "");
}

function daemonAgentForMachine(machine: MachineRecord, agentId: string): AgentRecord | null {
  const agent = store.getAgent(agentId);
  if (!agent || agent.machineId !== machine.id) {
    console.log(`[server] ignored daemon agent state agent=${agentId} machine=${machine.id} reason=agent_machine_mismatch`);
    return null;
  }
  return agent;
}

function applyDaemonAgentActivity(
  machine: MachineRecord,
  signal: DaemonAgentStateSnapshot | Extract<DaemonOutbound, { type: "agent:activity" }>,
  options: { snapshot: boolean }
): boolean {
  const agent = daemonAgentForMachine(machine, signal.agentId);
  if (!agent) return false;
  const decision = options.snapshot
    ? agentStateEvents.acceptSnapshot(signal)
    : agentStateEvents.acceptEvent(signal, agent.launchId, { terminal: signal.activity === "offline" });
  if (!decision.accepted) {
    logRejectedAgentState(signal, decision, options.snapshot ? "agent:state_snapshot" : "agent:activity");
    return false;
  }
  // 当前 launch 的首个可信状态说明 daemon 已接管 start，后续消息不再需要合并到启动窗口。
  agentStartRequests.release(agent.id);
  const detail = signal.detail ?? "";
  const status = agentStatusFromActivity(signal.activity);
  const current = store.getAgent(agent.id) ?? agent;
  if (options.snapshot && !periodicAgentStateChanged(current, { launchId: signal.launchId, status: status ?? undefined, detail })) {
    return false;
  }
  if (signal.launchId && signal.launchId !== current.launchId) {
    store.updateAgentLaunch(agent.id, signal.launchId);
    // 新 launch 已被状态守卫接受后，旧 launch 的在途工作不可能再合法恢复；立即关闭其审批与 execution。
    reconcileSupersededAgentRuntimeWork({
      agentId: agent.id,
      activeExecutionId: "activeExecutionId" in signal ? signal.activeExecutionId : undefined,
      launchBoundary: true
    });
  }
  if (status) {
    // 周期快照只在状态漂移时写库和广播；相同状态由 daemon heartbeat 负责存活校准。
    if (!options.snapshot || current.status !== status || (status === "error" && current.lastError !== detail)) {
      store.updateAgentStatus(agent.id, status, detail);
    }
  } else if (!options.snapshot && detail) {
    store.recordActivity(agent.id, signal.activity, detail);
  }
  emitRealtimeAgentActivity(agent.id, signal.activity, detail, "entries" in signal ? signal.entries : undefined, signal);
  return true;
}

function applyDaemonAgentStatus(machine: MachineRecord, signal: Extract<DaemonOutbound, { type: "agent:status" }>): boolean {
  const agent = daemonAgentForMachine(machine, signal.agentId);
  if (!agent) return false;
  const decision = agentStateEvents.acceptEvent(signal, agent.launchId, { terminal: signal.status === "inactive" });
  if (!decision.accepted) {
    logRejectedAgentState(signal, decision, "agent:status");
    return false;
  }
  agentStartRequests.release(agent.id);
  store.updateAgentStatus(signal.agentId, signal.status === "active" ? "online" : "offline");
  emitRealtimeAgentActivity(
    signal.agentId,
    signal.status === "active" ? "online" : "offline",
    signal.status === "active" ? "Runtime active." : "Runtime inactive.",
    undefined,
    signal
  );
  return true;
}

function emitRealtimeMachineUpdated(machineId: string): void {
  const machine = store.getMachine(machineId);
  if (!machine) return;
  const payload = {
    machineId: machine.id,
    status: machine.status,
    machine: formatMachineListItem(machine, store.listRuntimeReports(machine.id), latestRuntimeSha())
  };
  broadcastRealtime("machine:updated", payload, { serverId: machine.serverId });
  broadcastRealtime("machine:status", { machineId: machine.id, status: machine.status }, { serverId: machine.serverId });
  broadcastRealtime("machine:capabilities", { machineId: machine.id, runtimes: payload.machine.runtimes }, { serverId: machine.serverId });
}

function applyRuntimeAuthHealthUpdate(update: RuntimeAuthHealthUpdate | null): boolean {
  if (!update) return false;
  // runtime 执行错误只能补充健康诊断，不改变 install/CLI/MCP 探测结果和 daemon operation 面。
  const report = store.updateRuntimeAuthStatus(update.machineId, update.runtime, update.authStatus, update.reason);
  if (!report) return false;
  emitRealtimeMachineUpdated(update.machineId);
  return true;
}

function emitRealtimeMachineDeleted(machine: MachineRecord): void {
  broadcastRealtime("machine:updated", { machineId: machine.id, deleted: true }, { serverId: machine.serverId });
}

app.use((req, res, next) => {
  res.on("finish", () => {
    if (req.method !== "GET" && res.statusCode < 400) publishWorkspaceSync();
  });
  next();
});

function ok<T>(value: T): T {
  return value;
}

function newTraceparent(): string {
  return `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
}

function reminderJob(reminder: { reminderId?: string; id?: string; ownerAgentId: string; title: string; fireAt: string; version: number; repeat?: string; msgRef?: string; messageId?: string; channelId?: string }): ReminderJob {
  return {
    reminderId: reminder.reminderId ?? reminder.id!,
    ownerAgentId: reminder.ownerAgentId,
    title: reminder.title,
    fireAt: reminder.fireAt,
    version: reminder.version,
    repeat: reminder.repeat,
    messageId: reminder.messageId ?? reminder.msgRef,
    channelId: reminder.channelId
  };
}

function parseBearer(req: express.Request): string | null {
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  if (queryToken) return queryToken;
  const auth = req.header("authorization") ?? req.header("Authorization");
  if (!auth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match?.[1] ?? null;
}

function authUser(req: express.Request): UserRecord {
  const user = optionalAuthUser(req);
  if (!user) throw new Error("unauthorized");
  return user;
}

function authAgent(req: express.Request, res: express.Response): AgentRecord | null {
  const agentId = req.params.agentId;
  const token = parseBearer(req);
  const agent = token ? store.getAgentByToken(token) : null;
  if (!agent || agent.id !== agentId) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return agent;
}

function parseAgentCapabilityList(value: unknown): AgentCapability[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<AgentCapability>();
  for (const item of value) {
    if (typeof item !== "string" || !AGENT_CAPABILITIES.includes(item as AgentCapability)) return null;
    seen.add(item as AgentCapability);
  }
  return AGENT_CAPABILITIES.filter((capability) => seen.has(capability));
}

function requireAgentCapability(agent: AgentRecord, capability: AgentCapability, res: express.Response): boolean {
  if (store.hasAgentCapability(agent.id, capability)) return true;
  res.status(403).json({ error: "agent_capability_required", capability });
  return false;
}

function serverIdForAgent(agent: AgentRecord): string | undefined {
  return agent.serverId ?? (agent.machineId ? store.getMachine(agent.machineId)?.serverId : undefined);
}

function sendToDaemon(machineId: string, msg: DaemonInbound): boolean {
  const sent = daemonConnections.send(machineId, msg);
  if (sent && msg.type === "agent:stop") {
    // Stop 已进入当前 daemon 连接后，旧 launch 的迟到 working/online 不能再覆盖 server 的 Offline 决定。
    agentStartRequests.release(msg.agentId);
    agentStateEvents.markStopped(msg.agentId, store.getAgent(msg.agentId)?.launchId);
  }
  return sent;
}

function recordConnectorRotationState(state: ConnectorRotationMetricState, machineId: string): void {
  const total = daemonSecurityMetrics.recordRotation(state);
  console.log(`[metrics] connector_rotation_total state=${state} value=${total} machine=${machineId}`);
}

function sendToDevice(deviceId: string, msg: unknown): boolean {
  const ws = deviceSockets.get(deviceId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

function deviceCapabilityIds(value: unknown): DeviceCapability[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((capability): capability is DeviceCapability => {
    if (typeof capability !== "string" || !capability.trim() || seen.has(capability)) return false;
    seen.add(capability);
    return true;
  });
}

function deviceCapabilityDescriptors(value: unknown): DeviceCapabilityDescriptor[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((descriptor): descriptor is DeviceCapabilityDescriptor => (
    typeof descriptor?.id === "string" &&
    typeof descriptor?.label === "string" &&
    ["low", "medium", "high"].includes(descriptor?.riskLevel)
  ));
}

function hasDaemonSocket(machineId: string): boolean {
  return daemonConnections.hasOpen(machineId);
}

function markMachinesOfflineOnBoot(): void {
  for (const machine of store.listMachines()) {
    if (machine.status === "offline") continue;
    // WebSocket 连接只存在于当前 server 进程内；重启后旧 online 状态必须失效，等待 daemon 重新 ready。
    store.markMachineOffline(machine.id);
  }
}

function runtimeConfig(agent: AgentRecord, machine: MachineRecord): AgentRuntimeConfig {
  if (!agent.runtime) throw new Error("agent_runtime_required");
  const workspaceId = serverIdForAgent(agent);
  if (!workspaceId) throw new Error("agent_workspace_required");
  const workspace = store.listServersForUser(agent.ownerUserId).find((item) => item.id === workspaceId);
  if (!workspace) throw new Error("agent_workspace_not_found");
  return {
    agentId: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    description: agent.description,
    profileRevision: agent.profileRevision ?? 1,
    runtime: agent.runtime,
    model: agent.model,
    reasoningEffort: agent.reasoningEffort,
    permissionMode: agent.permissionMode ?? DEFAULT_RUNTIME_PERMISSION_MODE,
    runtimeResourceGrants: agent.runtimeResourceGrants,
    serverUrl: publicServerUrl,
    authToken: agent.authToken,
    machineId: machine.id,
    machineName: machine.name,
    machineHostname: machine.hostname,
    machineOs: machine.os,
    daemonVersion: machine.daemonVersion,
    serverId: workspaceId,
    // Workspace 身份只能由服务端成员关系提供，避免 runtime 从旧会话或 Bridge 来源误判归属。
    workspaceId,
    workspaceName: workspace.name,
    workspacePath: agent.workspacePath,
    launchId: agent.launchId,
    envVars: store.getAgentRuntimeEnvVars(agent.id),
    contextSessionEnabled: runtimeContextSessionsEnabled(agent.runtime, undefined, agent.id) && daemonConnections.supports(machine.id, "agent:context-session"),
    longTermMemory: longTermMemoryMode,
    sharedFiles: workspaceSharedFiles.snapshots(agent.id)
  };
}

function syncAgentSharedFiles(agentId: string): void {
  const agent = store.getAgent(agentId);
  if (!agent?.machineId || !daemonConnections.supports(agent.machineId, "workspace:shared-files")) return;
  sendToDaemon(agent.machineId, {
    type: "agent:shared_files:sync",
    agentId,
    files: workspaceSharedFiles.snapshots(agentId)
  });
}

function agentProfileApplicationPending(agent: AgentRecord): boolean {
  return (agent.profileAppliedRevision ?? 0) < (agent.profileRevision ?? 1);
}

function reserveAgentProfileRecoveryAttempt(connection: DaemonConnection, agent: AgentRecord): boolean {
  let attempts = agentProfileRecoveryAttempts.get(connection);
  if (!attempts) {
    attempts = new Set<string>();
    agentProfileRecoveryAttempts.set(connection, attempts);
  }
  const key = `${agent.id}:${agent.profileRevision ?? 1}`;
  if (attempts.has(key)) return false;
  attempts.add(key);
  return true;
}

function restartUnconfirmedAgentProfileSnapshot(agent: AgentRecord, connection: DaemonConnection, reconnect = false): boolean {
  if (
    !agentProfileApplicationPending(agent) ||
    agent.desiredRuntimeState !== "running" ||
    !agent.machineId
  ) return false;
  const machine = store.getMachine(agent.machineId);
  if (!machine || machine.status !== "online" || !hasDaemonSocket(machine.id)) return false;
  if (!daemonConnections.isCurrent(connection) || !reserveAgentProfileRecoveryAttempt(connection, agent)) return true;
  // 重连快照缺少版本时不能把旧进程当作已应用；Stop + Start 同时兼容不会主动丢弃旧进程的 daemon。
  if (reconnect) agentStartRequests.release(agent.id);
  if (agentStartRequests.isPending(agent.id)) return true;
  store.invalidateAgentRuntimeSessions({
    agentId: agent.id,
    detail: "Runtime did not confirm the current Agent Profile Prompt; the next Runtime context must start fresh."
  });
  sendToDaemon(machine.id, { type: "agent:stop", agentId: agent.id });
  return startAgent(agent);
}

function restartPendingAgentProfile(agentId: string, connection: DaemonConnection): boolean {
  const agent = store.getAgent(agentId);
  if (!agent || !agentProfileApplicationPending(agent) || agent.status !== "online" || agent.desiredRuntimeState !== "running" || !agent.machineId) return false;
  const machine = store.getMachine(agent.machineId);
  if (!machine || machine.status !== "online" || !hasDaemonSocket(machine.id)) return false;
  if (!daemonConnections.isCurrent(connection) || !reserveAgentProfileRecoveryAttempt(connection, agent)) return true;
  // Working 状态下保存的 Profile 要等当前 turn 回到 Online 后换代，避免中断用户任务。
  sendToDaemon(machine.id, { type: "agent:stop", agentId: agent.id });
  const started = startAgent(agent);
  if (!started) {
    store.updateAgentProfileApplication(agent.id, {
      profileRevision: agent.profileRevision ?? 1,
      error: "agent_profile_restart_not_delivered"
    });
    emitAgentNavigationRealtimeEvent(broadcastRealtime, "agent:updated", {
      agentId: agent.id,
      machineId: agent.machineId,
      serverId: agent.serverId ?? machine.serverId ?? "local"
    });
  }
  return started;
}

function contextSessionsEnabledForAgent(agent: AgentRecord, machine = agent.machineId ? store.getMachine(agent.machineId) : null): boolean {
  return Boolean(
    agent.runtime && machine &&
    runtimeContextSessionsEnabled(agent.runtime, undefined, agent.id) &&
    daemonConnections.supports(machine.id, "agent:context-session")
  );
}

function taskForWakeMessage(message: MessageRecord): TaskRecord | undefined {
  const directTask = store.listTasks(message.channelId).find((item) => item.messageId === message.id);
  if (directTask) return directTask;
  if (message.channelType !== "thread") return undefined;
  const thread = store.resolveTarget(message.channelId);
  if (!thread?.parentChannelId || !thread.parentMessageId) return undefined;
  return store.listTasks(thread.parentChannelId).find((item) => item.messageId === thread.parentMessageId);
}

type InternalMessageDeviceRef = MessageDeviceRef & {
  deviceName?: string;
  methodLabel?: string;
  methodDescription?: string;
  riskLevel?: DeviceCapabilityDescriptor["riskLevel"];
};

function formatMessageDeviceRefs(message: Pick<MessageRecord, "deviceRefs">): InternalMessageDeviceRef[] {
  return (message.deviceRefs ?? []).map((ref) => {
    const device = store.getDevice(ref.deviceId);
    const descriptor = device?.capabilityDescriptors.find((item) => item.id === ref.capability);
    // Internal agent payloads keep stable ids while adding display labels so the runtime can choose the right generic device action.
    return {
      ...ref,
      deviceName: device?.displayName,
      methodLabel: descriptor?.label ?? ref.capability,
      methodDescription: descriptor?.description,
      riskLevel: descriptor?.riskLevel
    };
  });
}

function mentionedAgentsForContent(content: string, serverId?: string): AgentRecord[] {
  const lowerContent = content.toLowerCase();
  return store.listAgents(serverId).filter((item) =>
    lowerContent.includes(`@${item.name.toLowerCase()}`) ||
    lowerContent.includes(`@${item.displayName.toLowerCase()}`));
}

function dmPeerAgentForRuntime(message: MessageRecord, recipientAgentId?: string): AgentRecord | null {
  if (message.channelType !== "dm" || !recipientAgentId) return null;
  const members = store.listChannelMembers(message.channelId, undefined, { includeAll: true })?.agents.filter((agent) => agent.joined) ?? [];
  if (!members.some((agent) => agent.id === recipientAgentId)) return null;
  return members.find((agent) => agent.id !== recipientAgentId) ?? null;
}

function buildWakeMessage(message: MessageRecord, recipientAgentId: string, traceparent?: string, executionId?: string, runtimeContext?: AgentWakeRuntimeContext): AgentWakeMessage {
  const threadChannelId = threadChannelIdForWakeMessage(message);
  const threadContext = threadRuntimeContextForMessage(store, message);
  const wakeConversationId = message.conversationId ?? threadContext?.conversation_id;
  const dmPeerAgent = dmPeerAgentForRuntime(message, recipientAgentId);
  const execution = executionId ? store.getRuntimeExecution(executionId) : null;
  // 自动回传只来自服务端已持久化的 execution 编排；普通 DM/Thread 不获得这条 handoff 指令。
  const handoff = execution?.returnToAgentId && execution.expectReply
    ? {
        ...(execution.sourceExecutionId ? { source_execution_id: execution.sourceExecutionId } : {}),
        return_to_agent_id: execution.returnToAgentId,
        expect_reply: true as const
      }
    : undefined;
  return {
    message_id: message.id,
    channel_id: message.channelId,
    // Thread 消息本身不写入 DM conversation_id；唤醒时从父消息恢复逻辑会话边界。
    conversation_id: wakeConversationId,
    conversation_title: wakeConversationId ? store.getConversation(wakeConversationId)?.title : undefined,
    thread_channel_id: threadChannelId,
    thread_context: threadContext,
    channel_name: dmPeerAgent?.name ?? message.channelName ?? "all",
    channel_type: message.channelType ?? "channel",
    dm_peer_agent_id: dmPeerAgent?.id,
    dm_peer_agent_name: dmPeerAgent?.name,
    dm_peer_agent_display_name: dmPeerAgent?.displayName,
    sender_id: message.senderId,
    sender_type: message.senderType,
    sender_name: message.senderName,
    content: message.content,
    seq: message.seq,
    timestamp: message.createdAt,
    execution_id: executionId,
    handoff,
    runtime_context: runtimeContext,
    // Quote 是用户显式分享给本轮 runtime 的消息快照，不改变被引用频道的访问权限。
    quote: message.quote,
    attachments: (message.attachmentIds ?? []).map((attachmentId) => store.getAttachment(attachmentId)).filter(Boolean).map((attachment) => ({
      id: attachment!.id,
      filename: attachment!.filename,
      mimeType: attachment!.mimeType,
      sizeBytes: attachment!.sizeBytes
    })),
    deviceRefs: formatMessageDeviceRefs(message),
    device_refs: formatMessageDeviceRefs(message),
    traceparent
  };
}

function wakeTaskPayload(task: TaskRecord): AgentWakeMessage["task"] {
  return {
    id: task.id,
    taskNumber: task.taskNumber,
    title: task.title,
    status: task.status,
    assigneeAgentId: task.assigneeAgentId,
    threadChannelId: task.threadChannelId,
    channelName: task.channelName,
    channelDisplayName: task.channelDisplayName,
    channelType: task.channelType
  };
}

function preferredAgentForTask(task: TaskRecord, channel: ChannelRecord, agents: AgentRecord[]): AgentRecord | null {
  if (task.assigneeAgentId) {
    return agents.find((agent) => agent.id === task.assigneeAgentId) ?? null;
  }
  if (channel.type === "dm") {
    if (channel.dmPeerAgentId) return agents.find((agent) => agent.id === channel.dmPeerAgentId) ?? null;
    const channelName = channel.name.toLowerCase();
    const dmAgent = agents.find((agent) => agent.name.toLowerCase() === channelName || agent.displayName.toLowerCase() === channelName);
    if (dmAgent) return dmAgent;
  }
  const lowerTitle = task.title.toLowerCase();
  const mentioned = agents.find((agent) => lowerTitle.includes(`@${agent.name.toLowerCase()}`) || lowerTitle.includes(`@${agent.displayName.toLowerCase()}`));
  return mentioned ?? agents.find((agent) => agent.status === "online") ?? agents[0] ?? null;
}

function formatPublicMessage(message: MessageRecord) {
  const thread = store.getMessageThread(message.id);
  const deleted = Boolean(message.deletedAt);
  const publicContent = deleted ? "" : sanitizeHumanVisibleText(message.content);
  return sanitizeHumanVisibleValue({
    id: message.id,
    seq: message.seq,
    channelId: message.channelId,
    conversationId: message.conversationId ?? null,
    conversationTitle: message.conversationId ? store.getConversation(message.conversationId)?.title ?? null : null,
    channelName: message.channelName ?? "all",
    channelDisplayName: publicChannelDisplayName(message.channelType, message.channelName, message.channelDisplayName),
    channelType: message.channelType ?? "channel",
    senderType: message.senderType === "human" ? "user" : message.senderType,
    senderId: message.senderId,
    agentSendKey: null,
    messageType: "chat",
    content: publicContent,
    result: deleted ? null : sanitizeHumanVisibleValue(message.result ?? null),
    actionMetadata: null,
    searchText: publicContent.toLowerCase(),
    searchVector: null,
    threadId: thread?.id ?? message.threadId ?? null,
    taskStatus: null,
    taskNumber: null,
    taskAssigneeType: null,
    taskAssigneeId: null,
    taskClaimedAt: null,
    taskCompletedAt: null,
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
    senderName: message.senderName,
    senderDescription: null,
    senderMembershipStatus: message.senderType === "human" ? "active" : null,
    attachments: deleted ? [] : (message.attachmentIds ?? []).map((attachmentId) => store.getAttachment(attachmentId)).filter(Boolean).map((attachment) => ({
      id: attachment!.id,
      filename: attachment!.filename,
      mimeType: attachment!.mimeType,
      sizeBytes: attachment!.sizeBytes
    })),
    deviceRefs: deleted ? [] : formatMessageDeviceRefs(message),
    quote: deleted ? null : sanitizeHumanVisibleValue(message.quote ?? null),
    reactions: deleted ? [] : message.reactions ?? [],
    deletedAt: message.deletedAt,
    deletedByUserId: message.deletedByUserId,
    deletionReason: message.deletionReason
  });
}

function formatPublicTask(task: TaskRecord) {
  const publicTitle = sanitizeHumanVisibleText(task.title);
  return sanitizeHumanVisibleValue({
    id: task.messageId,
    seq: store.listMessages(task.channelId).find((message) => message.id === task.messageId)?.seq ?? task.taskNumber,
    channelId: task.channelId,
    conversationId: task.conversationId ?? null,
    senderType: task.createdByType === "human" ? "user" : task.createdByType,
    senderId: task.createdById,
    agentSendKey: null,
    messageType: "chat",
    content: publicTitle,
    actionMetadata: null,
    searchText: publicTitle.toLowerCase(),
    searchVector: null,
    threadId: task.threadChannelId ?? null,
    taskStatus: task.status,
    taskNumber: task.taskNumber,
    taskAssigneeType: task.assigneeAgentId ? "agent" : null,
    taskAssigneeId: task.assigneeAgentId ?? null,
    taskClaimedAt: null,
    taskCompletedAt: null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    createdByType: task.createdByType === "human" ? "user" : task.createdByType,
    createdById: task.createdById,
    createdByName: task.createdByName,
    claimedByType: task.assigneeAgentId ? "agent" : null,
    claimedById: task.assigneeAgentId ?? null,
    claimedByName: task.assigneeName ?? null,
    claimedAt: null,
    completedAt: null,
    status: task.status,
    title: publicTitle,
    description: null,
    messageId: task.messageId,
    channelName: task.channelName ?? "all",
    channelDisplayName: publicChannelDisplayName(task.channelType, task.channelName, task.channelDisplayName),
    channelType: task.channelType ?? "channel"
  });
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && ["todo", "in_progress", "in_review", "done", "closed"].includes(value);
}

function parseTaskDetails(value: unknown): { ok: true; details: { title?: string } } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, details: {} };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "invalid_task" };
  const source = value as Record<string, unknown>;
  const details: { title?: string } = {};
  if (Object.prototype.hasOwnProperty.call(source, "title")) {
    const title = String(source.title ?? "").trim();
    if (title) details.title = title;
  }
  return { ok: true, details };
}

function publicSenderType(type: MessageRecord["senderType"]) {
  return type === "human" ? "user" : type;
}

function publicChannelDisplayName(type: ChannelRecord["type"] | undefined, name: string | undefined | null, displayName: string | undefined | null): string {
  if (displayName) return displayName;
  if (type === "dm" && name?.startsWith("dm-user-")) return "DM";
  return name ?? "all";
}

function formatSearchMessage(message: MessageRecord) {
  const channel = store.resolveTarget(message.channelId);
  const parentChannel = channel?.type === "thread"
    ? channel.parentChannelId ? store.resolveTarget(channel.parentChannelId) : null
    : channel;
  const parentMessage = channel?.parentMessageId
    ? store.getMessage(channel.parentMessageId)
    : null;
  const publicContent = message.deletedAt ? "" : sanitizeHumanVisibleText(message.content);
  return {
    id: message.id,
    seq: message.seq,
    channelId: message.channelId,
    conversationId: message.conversationId ?? null,
    threadId: channel?.type === "thread" ? channel.id : null,
    parentMessageId: parentMessage?.id ?? null,
    parentMessageContent: parentMessage ? sanitizeHumanVisibleText(parentMessage.content) : null,
    parentChannelId: parentChannel?.id ?? message.channelId,
    parentChannelName: parentChannel?.name ?? message.channelName ?? "all",
    parentChannelDisplayName: publicChannelDisplayName(parentChannel?.type ?? message.channelType, parentChannel?.name ?? message.channelName, parentChannel?.displayName ?? message.channelDisplayName),
    parentChannelType: parentChannel?.type ?? message.channelType ?? "channel",
    parentChannelArchivedAt: null,
    senderId: message.senderId,
    senderType: publicSenderType(message.senderType),
    senderName: message.senderName,
    channelName: channel?.name ?? message.channelName ?? "all",
    channelDisplayName: publicChannelDisplayName(channel?.type ?? message.channelType, channel?.name ?? message.channelName, channel?.displayName ?? message.channelDisplayName),
    channelType: channel?.type ?? message.channelType ?? "channel",
    channelArchivedAt: null,
    content: publicContent,
    createdAt: message.createdAt,
    snippet: publicContent,
    deletedAt: message.deletedAt,
    deletedByUserId: message.deletedByUserId,
    deletionReason: message.deletionReason
  };
}

function formatChannel(channel: ChannelRecord) {
  return {
    id: channel.id,
    serverId: channel.serverId ?? "local",
    name: channel.name,
    displayName: channel.displayName,
    description: channel.description ?? null,
    type: channel.type,
    visibility: channel.visibility,
    parentMessageId: channel.parentMessageId ?? null,
    createdAt: channel.createdAt,
    archivedAt: channel.archivedAt ?? null,
    archivedByUserId: channel.archivedByUserId ?? null,
    deletedAt: null
  };
}

function formatSkill(skill: SkillInfo) {
  const sourcePath = skill.path.includes("/skills/")
    ? skill.path.slice(0, skill.path.lastIndexOf("/skills/") + "/skills".length)
    : skill.path;
  return {
    ...skill,
    displayName: skill.displayName ?? skill.name,
    description: skill.description ?? skill.path,
    userInvocable: skill.userInvocable ?? false,
    sourcePath: skill.sourcePath ?? sourcePath
  };
}

function formatActivityLog(agentId: string, options: { limit?: number; offset?: number } = {}) {
  return sanitizeHumanVisibleValue(formatActivityLogResponse(store, agentId, options));
}

function gravatarHash(email?: string | null): string | null {
  if (!email) return null;
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function listInboxItems(limit = 30, offset = 0, userId?: string, cursor?: string) {
  const viewerId = userId ?? store.currentUser().id;
  return sanitizeHumanVisibleValue(store.listInboxItemsForUser(viewerId, { limit, offset, cursor }));
}

function deliverPendingToOnlineAgents(): void {
  reconcileStaleRuntimeTurnsBeforeDispatch();
  for (const agent of store.listAgents()) {
    if (isCommunicationAgent(agent) || !agent.machineId || !agent.runtime) continue;
    const machine = store.getMachine(agent.machineId);
    if (!machine || machine.status !== "online") continue;
    if (agent.status !== "online") continue;
    const runtimeAccessError = runtimeAccessErrorForAgent(agent, machine);
    if (runtimeAccessError) {
      sendToDaemon(machine.id, { type: "agent:stop", agentId: agent.id });
      store.updateAgentStatus(agent.id, "error", runtimeAccessErrorDetail(runtimeAccessError));
      emitRealtimeAgentStatus(agent.id);
      continue;
    }
    const messages = store.takeAgentInbox(agent.id);
    const message = claimNextDeliveryForAgent(deliveryInFlight, agent.id, messages);
    if (!message) continue;
    const traceparent = newTraceparent();
    const executionId = message.runtimeExecutionId;
    if (executionId && settleNonDispatchableRuntimeInboxDelivery(store, deliveryInFlight, {
      agentId: agent.id,
      messageId: message.id,
      executionId
    })) {
      // running/terminal execution 已由 server 真源接管；遗留 inbox 行只能结清，不能把同一个 execution 再次投递。
      continue;
    }
    const useContextSession = runtimeContextSessionsEnabled(agent.runtime, undefined, agent.id) && daemonConnections.supports(machine.id, "agent:context-session");
    const runtimeContext = useContextSession && executionId
      ? prepareRuntimeContextWake(store, {
          message,
          agent: { ...agent, machineId: agent.machineId, runtime: agent.runtime },
          executionId,
          serverId: machine.serverId ?? agent.serverId ?? "local",
          launchId: agent.launchId
        })
      : undefined;
    if (useContextSession && executionId && !runtimeContext) {
      // P1 开启后不能把损坏的上下文静默降级到全局 Session，否则会重新引入跨会话串线。
      const currentExecution = store.getRuntimeExecution(executionId);
      const failed = currentExecution && !isTerminalRuntimeExecutionStatus(currentExecution.status)
        ? store.updateRuntimeExecutionStatus(executionId, "failed")
        : null;
      if (failed) {
        const event = store.appendRuntimeExecutionEvent({
          executionId,
          agentId: agent.id,
          taskId: failed.taskId,
          kind: "error",
          title: "Runtime context invalid",
          detail: "runtime_context_invalid"
        });
        emitRealtimeRuntimeExecution(failed, event);
        publishTerminalCommunicationFailure(failed);
      }
      store.ackAgentInbox(agent.id, [message.id]);
      deliveryInFlight.ack(agent.id, message.id);
      continue;
    }
    const sent = sendToDaemon(machine.id, {
      type: "agent:deliver",
      agentId: agent.id,
      seq: message.seq,
      message: buildWakeMessage(message, agent.id, traceparent, executionId, runtimeContext ?? undefined),
      deliveryId: `${agent.id}:${message.id}`
    });
    if (sent && executionId) {
      // execution 在创建时可能仍引用上一次 launch；成功投递时必须固化实际接管它的当前 launch。
      const delivered = store.updateRuntimeExecutionStatus(executionId, "delivered", { launchId: agent.launchId });
      if (!delivered || delivered.status !== "delivered") {
        acknowledgeRuntimeDelivery(store, deliveryInFlight, { agentId: agent.id, messageId: message.id });
        continue;
      }
      const event = store.appendRuntimeExecutionEvent({
        executionId,
        agentId: agent.id,
        taskId: delivered?.taskId,
        kind: "delivered",
        title: "Delivered",
        detail: `Delivered task run to @${agent.name}.`
      });
      emitRealtimeRuntimeExecution(delivered, event);
      scheduleDeliveryAckTimeout(agent, message.id, executionId);
    }
    // WebSocket 发送失败时不能占用 in-flight，否则 inbox 后续不会重投。
    if (!sent) deliveryInFlight.release(agent.id, message.id);
  }
}

function scheduleDeliveryAckTimeout(agent: AgentRecord, messageId: string, executionId: string): void {
  setTimeout(() => {
    const settled = stallUnacknowledgedRuntimeDelivery(store, deliveryInFlight, {
      agentId: agent.id,
      messageId,
      executionId
    });
    if (!settled?.transitionedToStalled || !settled.execution) return;
    // ACK 超时必须同时结清 inbox 并精确停止该 execution；显式 Retry 会创建新的 execution，旧请求绝不自动重放。
    const detail = deliveryAckTimeoutDetail(agent.name, deliveryAckTimeoutMs);
    const stalled = settled.execution;
    const cancellationSent = Boolean(agent.machineId && sendToDaemon(agent.machineId, {
      type: "agent:runtime_execution:cancel",
      agentId: agent.id,
      executionId,
      ...(stalled.runtimeContextKey && stalled.runtimeSessionRecordId ? {
        contextKey: stalled.runtimeContextKey,
        sessionRecordId: stalled.runtimeSessionRecordId
      } : {})
    }));
    const event = store.appendRuntimeExecutionEvent({
      executionId,
      agentId: agent.id,
      taskId: stalled?.taskId,
      kind: "error",
      title: "Delivery confirmation timed out",
      detail,
      payload: {
        code: "delivery_ack_timeout",
        timeoutMs: deliveryAckTimeoutMs,
        cancellationSent
      }
    });
    emitRealtimeRuntimeExecution(stalled, event);
    publishTerminalCommunicationFailure(stalled);
    publishWorkspaceSync();
  }, deliveryAckTimeoutMs);
}

function logRuntimeDeliveryAcknowledgement(settled: RuntimeDeliverySettlement | null, source: string): void {
  if (!settled?.delivery) return;
  const latencyMs = Math.max(0, Date.now() - settled.delivery.claimedAt);
  console.log(`[server] delivery acknowledged agent=${settled.delivery.agentId} execution=${settled.delivery.executionId ?? "none"} source=${source} latencyMs=${latencyMs}`);
  const execution = settled.execution;
  if (!execution || isTerminalRuntimeExecutionStatus(execution.status)) return;
  if (store.listRuntimeExecutionEvents(execution.id).some((event) => event.kind === "delivery_acknowledged")) return;
  const agent = store.getAgent(execution.agentId);
  const event = store.appendRuntimeExecutionEvent({
    executionId: execution.id,
    agentId: execution.agentId,
    taskId: execution.taskId,
    kind: "delivery_acknowledged",
    title: "Delivery acknowledged",
    detail: `${agent?.displayName ?? "Target Agent"} accepted the request.`,
    payload: { source, latencyMs }
  });
  // status 仍保留 delivered 以兼容现有 API；独立事件才表示 daemon host 已真实接管 wake。
  emitRealtimeRuntimeExecution(store.getRuntimeExecution(execution.id) ?? execution, event);
}

function dispatchQueuedAgentInbox(agentId: string, detail: string, executionId?: string): void {
  const latestAgent = store.getAgent(agentId);
  if (!latestAgent || isCommunicationAgent(latestAgent) || !latestAgent.machineId || !latestAgent.runtime) return;
  const machine = store.getMachine(latestAgent.machineId);
  const daemonConnected = machine ? hasDaemonSocket(machine.id) : false;
  const plan = taskWakePlan(latestAgent, machine, { daemonConnected });
  if (machine?.status === "online" && !daemonConnected) {
    // 数据库里的 online 可能来自 server 重启前的旧状态；没有当前 WebSocket 时不能继续假装可投递。
    store.markMachineOffline(machine.id);
    deliveryInFlight.releaseAgent(latestAgent.id);
    emitRealtimeMachineUpdated(machine.id);
    emitRealtimeAgentStatus(latestAgent.id);
    if (executionId) {
      const event = store.appendRuntimeExecutionEvent({
        executionId,
        agentId: latestAgent.id,
        kind: "queued",
        title: "Waiting for daemon",
        detail: `Queued task for @${latestAgent.name}, but ${machine.name} has no active daemon connection. Restart tyr-daemon to continue.`
      });
      emitRealtimeRuntimeExecution(store.getRuntimeExecution(executionId), event);
    }
    publishWorkspaceSync();
    return;
  }
  if (plan === "start") {
    // 多条消息可以在 daemon 返回首个状态前连续入队；它们共享一次 runtime start，随后按 inbox seq 投递。
    if (agentStartRequests.isPending(latestAgent.id)) return;
    const started = startAgent(latestAgent);
    if (started) emitRealtimeAgentActivity(latestAgent.id, "working", detail);
    return;
  }
  if (plan === "deliver") {
    deliverPendingToOnlineAgents();
  }
}

function enqueueTaskForAgent(agent: AgentRecord, messageId: string, detail: string, executionId?: string): void {
  if (isCommunicationAgent(agent) || !agent.machineId || !agent.runtime) return;
  store.enqueueForAgent(agent.id, messageId, executionId);
  // execution 创建与 inbox 入队只发生一次；统一调度只负责启动或投递，不改写队列真源。
  dispatchQueuedAgentInbox(agent.id, detail, executionId);
}

function createAndEnqueueTaskRun(agent: AgentRecord, task: TaskRecord, channel: ChannelRecord, detail: string) {
  if (isCommunicationAgent(agent) || !agent.machineId || !agent.runtime) return null;
  const { execution, queuedEvent } = createQueuedTaskRuntimeExecution(store, {
    serverId: channel.serverId ?? serverIdForAgent(agent) ?? "local",
    machineId: agent.machineId,
    agent,
    task,
    launchId: agent.launchId ?? undefined
  });
  emitRealtimeRuntimeExecution(execution, queuedEvent);
  enqueueTaskForAgent(agent, task.messageId, detail, execution.id);
  return execution;
}

function createAdoptedTaskRun(agent: AgentRecord, task: TaskRecord, channel: ChannelRecord, detail: string) {
  if (isCommunicationAgent(agent) || !agent.machineId || !agent.runtime) return null;
  const adopted = createAdoptedTaskRuntimeExecution(store, {
    serverId: channel.serverId ?? serverIdForAgent(agent) ?? "local",
    machineId: agent.machineId,
    agent,
    task,
    launchId: agent.launchId ?? undefined,
    detail
  });
  if (adopted) emitRealtimeRuntimeExecution(adopted.execution, adopted.adoptedEvent);
  return adopted?.execution ?? null;
}

function bindDaemonActiveExecution(agent: AgentRecord, task: TaskRecord, executionId: string): boolean {
  if (isCommunicationAgent(agent) || !agent.machineId) return false;
  // claim-message 是在已有 runtime turn 内发生的；补建 execution 后要同步给 daemon，后续输出和 turn_completed 才能继续落到同一条执行流。
  return sendToDaemon(agent.machineId, {
    type: "agent:runtime_execution:bind",
    agentId: agent.id,
    messageId: task.messageId,
    executionId,
    task: wakeTaskPayload(task)
  });
}

function bindRuntimeApprovalToTaskExecution(approval: RuntimeApprovalRecord): RuntimeApprovalRecord {
  const linked = runtimeApprovalWithExecutionFallback(store, approval);
  if (linked !== approval) store.createRuntimeApproval(linked);
  return linked;
}

function createAndEnqueueTaskRunsForMessage(message: MessageRecord, task: TaskRecord, detail: string): void {
  const channel = store.resolveTarget(task.channelId);
  if (!channel) return;
  for (const agent of store.selectWakeTargets(message)) {
    // asTask 消息先由普通消息路由选中目标 Agent，再升级为 task execution 调度，保持 server 作为执行真源。
    createAndEnqueueTaskRun(agent, task, channel, detail);
  }
}

function createAndEnqueueThreadHandoffRun(agent: AgentRecord, task: TaskRecord, message: MessageRecord, detail: string, options: { orchestration?: Pick<RuntimeExecutionRecord, "sourceExecutionId" | "returnToAgentId" | "rootMessageId" | "hopCount" | "expectReply"> } = {}) {
  if (isCommunicationAgent(agent) || !agent.machineId || !agent.runtime) return null;
  const machine = store.getMachine(agent.machineId);
  const channel = store.resolveTarget(task.channelId);
  if (!machine || !channel) return null;
  const { execution, queuedEvent } = createQueuedThreadHandoffRuntimeExecution(store, {
    serverId: channel.serverId ?? serverIdForAgent(agent) ?? "local",
    machineId: agent.machineId,
    agent,
    task,
    message,
    launchId: agent.launchId ?? undefined,
    detail,
    orchestration: options.orchestration
  });
  emitRealtimeRuntimeExecution(execution, queuedEvent);
  enqueueTaskForAgent(agent, message.id, detail, execution.id);
  return execution;
}

function createAndEnqueueMessageHandoffRun(agent: AgentRecord, message: MessageRecord, detail: string, options: {
  orchestration?: Pick<RuntimeExecutionRecord, "sourceExecutionId" | "returnToAgentId" | "rootMessageId" | "hopCount" | "expectReply">;
  communicationReturn?: {
    channelId: string;
    conversationId?: string;
    sourceMessageId?: string;
    userId: string;
    source: NonNullable<RuntimeExecutionRecord["communicationReturnSource"]>;
    externalRef?: string;
  };
  onExecutionCreated?: (execution: RuntimeExecutionRecord) => void;
} = {}) {
  if (isCommunicationAgent(agent) || !agent.machineId || !agent.runtime) return null;
  const machine = store.getMachine(agent.machineId);
  const channel = store.resolveTarget(message.channelId);
  if (!machine || !channel) return null;
  const { execution, queuedEvent } = createQueuedMessageHandoffRuntimeExecution(store, {
    serverId: channel.serverId ?? serverIdForAgent(agent) ?? "local",
    machineId: agent.machineId,
    agent,
    message,
    launchId: agent.launchId ?? undefined,
    detail,
    orchestration: options.orchestration,
    communicationReturn: options.communicationReturn
  });
  // TYR handoff 必须先把可见路由回执绑定为 root message，再唤醒 worker；
  // 否则快速 worker 可能先写回结果，造成“结果在前、已路由在后”的倒序。
  options.onExecutionCreated?.(execution);
  const rootedExecution = store.getRuntimeExecution(execution.id) ?? execution;
  emitRealtimeRuntimeExecution(rootedExecution, queuedEvent);
  enqueueTaskForAgent(agent, message.id, detail, execution.id);
  return rootedExecution;
}

function createAndEnqueueDelegationRun(delegator: AgentRecord, targetAgent: AgentRecord, message: MessageRecord, detail: string, options: { orchestration?: Pick<RuntimeExecutionRecord, "sourceExecutionId" | "returnToAgentId" | "rootMessageId" | "hopCount" | "expectReply"> } = {}) {
  if (isCommunicationAgent(targetAgent) || !targetAgent.machineId || !targetAgent.runtime) return null;
  const machine = store.getMachine(targetAgent.machineId);
  const channel = store.resolveTarget(message.channelId);
  if (!machine || !channel) return null;
  const { execution, queuedEvent } = createQueuedDelegationRuntimeExecution(store, {
    serverId: channel.serverId ?? serverIdForAgent(targetAgent) ?? "local",
    machineId: targetAgent.machineId,
    delegator,
    targetAgent,
    message,
    launchId: targetAgent.launchId ?? undefined,
    detail,
    orchestration: options.orchestration
  });
  emitRealtimeRuntimeExecution(execution, queuedEvent);
  enqueueTaskForAgent(targetAgent, message.id, detail, execution.id);
  return execution;
}

type CompletedCommunicationReturn = NonNullable<ReturnType<typeof createCommunicationReturnMessageForFinalMessage>>;
const communicationReturnPresentationInFlight = new Set<string>();

function publishCompletedCommunicationReturn(communicationReturned: CompletedCommunicationReturn): void {
  clearCommunicationReturnFailureTimer(communicationReturned.execution.id);
  // 临时进度必须先于最终消息收口，客户端不会短暂同时渲染结果和“仍在处理”。
  emitCommunicationReturnTerminalProgress(communicationReturned.execution, "completed", "Response ready.");
  if (communicationReturned.attachmentMessage) emitRealtimeMessage(communicationReturned.attachmentMessage);
  emitRealtimeMessage(communicationReturned.message);
  sendCommunicationReturnExternalAsync(
    communicationReturned.execution,
    communicationReturned.message,
    communicationReturned.attachmentMessage ? [communicationReturned.attachmentMessage] : []
  );
  if (!communicationReturned.bridgeMessage) return;
  const bridgeRequest = communicationReturned.bridgeMessage.replyToMessageId
    ? store.getCrossWorkspaceMessage(communicationReturned.bridgeMessage.replyToMessageId)
    : null;
  const bridgeOriginMessage = communicationReturned.bridgeMessage.originMessageId
    ? store.getMessage(communicationReturned.bridgeMessage.originMessageId)
    : null;
  if (bridgeOriginMessage) emitRealtimeMessage(bridgeOriginMessage);
  if (bridgeRequest && bridgeOriginMessage) scheduleWorkspaceBridgeExternalReturn(bridgeRequest, bridgeOriginMessage);
  emitRealtimeWorkspaceBridgeMessage(communicationReturned.bridgeMessage);
  if (bridgeRequest) {
    emitWorkspaceBridgeOriginProgress(
      { store, broadcastRealtime },
      bridgeRequest,
      "completed",
      "Workspace response received."
    );
  }
  publishWorkspaceSync();
}

function existingContinuationBridgeOriginMessage(
  draft: CommunicationAgentContinuationDraft,
  execution: RuntimeExecutionRecord
): MessageRecord | null {
  if (draft.bridgeRequestIds?.length !== 1) return null;
  const request = store.getCrossWorkspaceMessage(draft.bridgeRequestIds[0]!);
  if (!request?.conversationId) return null;
  const reply = store.listCrossWorkspaceMessages(request.bridgeId, { conversationId: request.conversationId })
    .find((candidate) => (
      candidate.replyToMessageId === request.id &&
      (candidate.responseKind === "final" || candidate.responseKind === "error") &&
      Boolean(candidate.originMessageId)
    ));
  const message = reply?.originMessageId ? store.getMessage(reply.originMessageId) : null;
  return message?.channelId === execution.communicationReturnChannelId ? message : null;
}

function publishCommunicationContinuation(
  execution: RuntimeExecutionRecord,
  finalMessage: MessageRecord,
  draft: CommunicationAgentContinuationDraft
): boolean {
  const evidence = draft.evidenceSelections?.length ? selectCommunicationEvidenceForContext(store, {
    serverId: execution.serverId ?? "local", sourceMessageId: execution.communicationReturnSourceMessageId!,
    channelId: execution.communicationReturnChannelId!,
    conversationId: execution.communicationReturnConversationId ?? null
  }, draft.evidenceSelections) : undefined;
  if (evidence?.length) {
    draft.result = { ...draft.result, version: 1, status: draft.result?.status ??
      (draft.outcomeStatus === "failed" ? "failed" : draft.outcomeStatus === "completed" ? "completed" : "partial"),
      title: draft.result?.title ?? "TYR reviewed response", summary: draft.content, evidence };
  }
  const nextExecutionRoot = [...new Set(draft.executionIds ?? [])]
    .map((id) => store.getRuntimeExecution(id)?.rootMessageId)
    .filter((id): id is string => Boolean(id))
    .map((id) => store.getMessage(id))
    .find((message) => message?.channelId === execution.communicationReturnChannelId);
  const directBridgeReply = existingContinuationBridgeOriginMessage(draft, execution);
  const intermediate = nextExecutionRoot ?? directBridgeReply;
  if (intermediate) {
    const updated = store.db.transaction(() => {
      recordCommunicationNextStepReceipt(store, execution, {
        reviewedReplyId: intermediate.id, executionIds: draft.executionIds, bridgeRequestIds: draft.bridgeRequestIds
      });
      return store.markRuntimeExecutionCommunicationReturnDispatched(execution.id, {
        communicationReturnMessageId: intermediate.id
      });
    })();
    if (updated) emitRealtimeRuntimeExecution(updated);
    return true;
  }

  if ((draft.executionIds?.length ?? 0) > 0 || (draft.bridgeRequestIds?.length ?? 0) > 0) {
    const assistant = store.ensureDefaultCommunicationAgent(execution.serverId ?? "local");
    const reply = store.sendMessage({
      target: execution.communicationReturnChannelId!,
      ...(execution.communicationReturnConversationId ? {
        conversationId: execution.communicationReturnConversationId,
        allowClosedConversation: true
      } : {}),
      content: draft.content,
      result: draft.result,
      senderType: "agent",
      senderId: assistant.id,
      senderName: assistant.displayName,
      serverId: execution.serverId ?? assistant.serverId ?? "local"
    }).message;
    if (draft.pendingActionId) {
      store.attachCommunicationAgentPendingActionSuggestionMessage(draft.pendingActionId, reply.id);
    }
    const updated = store.db.transaction(() => {
      recordCommunicationNextStepReceipt(store, execution, {
        reviewedReplyId: reply.id, executionIds: draft.executionIds, bridgeRequestIds: draft.bridgeRequestIds
      });
      return store.markRuntimeExecutionCommunicationReturnDispatched(execution.id, {
        communicationReturnMessageId: reply.id
      });
    })();
    emitRealtimeMessage(reply);
    if (updated) emitRealtimeRuntimeExecution(updated);
    return true;
  }

  if (workspaceBridgeRefForExecution(execution) && (draft.outcomeStatus === "failed" || draft.result?.status === "failed")) {
    const returned = createCommunicationReturnMessageForFinalMessage(store, { completedExecution: execution, finalMessage }, {
      presentedContent: draft.content, presentedStatus: "failed", presentedEvidence: evidence
    });
    if (returned) publishCompletedCommunicationReturn(returned);
    return Boolean(returned);
  }
  if (draft.outcomeStatus === "partial" || draft.outcomeStatus === "failed" || draft.result?.status === "partial") {
    if (draft.outcomeStatus !== "failed" && draft.result?.status !== "failed" &&
        !draft.pendingActionId && !draft.evidenceSelections?.length) {
      const acknowledged = acknowledgePublishedBridgeWorkerQuestion(store, execution, draft.content);
      if (acknowledged) {
        emitRealtimeRuntimeExecution(acknowledged);
        return true;
      }
    }
    const assistant = store.ensureDefaultCommunicationAgent(execution.serverId ?? "local");
    const result = draft.result ?? {
      version: 1 as const,
      status: draft.outcomeStatus === "failed" ? "failed" as const : "partial" as const,
      title: "TYR request needs attention",
      summary: draft.content
    };
    // Worker execution 的完成只表示子步骤结束；待澄清/受阻的原请求必须保持非 completed。
    result.communicationRequest = { sourceMessageId: execution.communicationReturnSourceMessageId! };
    const reply = store.sendMessage({
      target: execution.communicationReturnChannelId!,
      ...(execution.communicationReturnConversationId ? {
        conversationId: execution.communicationReturnConversationId,
        allowClosedConversation: true
      } : {}),
      content: draft.content,
      result,
      senderType: "agent",
      senderId: assistant.id,
      senderName: assistant.displayName,
      serverId: execution.serverId ?? assistant.serverId ?? "local"
    }).message;
    const updated = store.markRuntimeExecutionCommunicationReturnDispatched(execution.id, {
      communicationReturnMessageId: reply.id
    });
    emitRealtimeMessage(reply);
    if (workspaceBridgeRefForExecution(execution) && result.status === "partial") {
      const interaction = publishWorkspaceBridgeWorkerEvent(routeContext, {
        execution, eventId: `worker-final:${execution.id}`, kind: "question", reviewedReply: reply,
        evidenceSelections: draft.evidenceSelections
      });
      if (!interaction) throw new Error("bridge_reviewed_pending_result_not_recorded");
    }
    if (updated) emitRealtimeRuntimeExecution(updated);
    if (updated) emitCommunicationReturnTerminalProgress(updated, result.status === "failed" ? "failed" : "needs_input", result.status === "failed" ? "Request blocked." : "Needs your input.");
    if (updated) sendCommunicationReturnExternalAsync(updated, reply, []);
    return true;
  }

  const communicationReturned = createCommunicationReturnMessageForFinalMessage(store, {
    completedExecution: execution,
    finalMessage
  }, { presentedContent: draft.content, presentedEvidence: evidence });
  if (!communicationReturned) return false;
  if (draft.pendingActionId) {
    store.attachCommunicationAgentPendingActionSuggestionMessage(draft.pendingActionId, communicationReturned.message.id);
  }
  publishCompletedCommunicationReturn(communicationReturned);
  return true;
}

async function publishAssistantBridgeContinuation(requestId: string): Promise<void> {
  const claimed = claimBridgeContinuationWithJournal(store, requestId);
  if (!claimed) return;
  const { request, terminal, attempt } = claimed;
  let replyMessageId: string | null = null;
  let uncertain = false;
  try {
    const draft = await continueCommunicationAgentAfterBridge(routeContext, { request, terminal, attemptId: attempt.id });
    if (!request.originChannelId) throw new Error("bridge_continuation_origin_channel_missing");
    const assistant = store.ensureDefaultCommunicationAgent(request.sourceWorkspaceId);
    if (!draft && request.parentBridgeRequestId) {
      // 中间 TYR 不能复核子结果时，向父请求报告稳定失败，不能透传未经复核的子文本。
      const reply = store.sendMessage({
        target: request.originChannelId,
        ...(request.originConversationId ? { conversationId: request.originConversationId, allowClosedConversation: true } : {}),
        content: "The connected workspace replied, but TYR could not verify how that result completes the original request.",
        result: {
          version: 1,
          status: "failed",
          title: "Workspace Bridge continuation failed",
          summary: "TYR could not verify the chained result."
        },
        senderType: "agent",
        senderId: assistant.id,
        senderName: assistant.displayName,
        serverId: request.sourceWorkspaceId
      }).message;
      replyMessageId = reply.id;
      emitRealtimeMessage(reply);
      completeWorkspaceBridgeParentFromContinuation(routeContext, request, terminal, reply);
      return;
    }
    if (!draft) {
      const reply = store.sendMessage({
        target: request.originChannelId,
        ...(request.originConversationId ? { conversationId: request.originConversationId, allowClosedConversation: true } : {}),
        content: "TYR received the connected workspace response but could not safely finish the original request. Please review the next step.",
        result: {
          version: 1, status: "partial", title: "TYR request needs attention",
          summary: "The connected workspace replied; TYR needs to review the next step."
        },
        senderType: "agent", senderId: assistant.id, senderName: assistant.displayName,
        serverId: request.sourceWorkspaceId
      }).message;
      replyMessageId = reply.id;
      emitRealtimeMessage(reply);
      return;
    }
    const reviewedReply = publishReviewedWorkspaceBridgeContinuation(routeContext, { request, terminal, draft });
    replyMessageId = reviewedReply?.id ?? null;
    if (reviewedReply && (draft.executionIds?.length ?? 0) === 0 && (draft.bridgeRequestIds?.length ?? 0) === 0) {
      // 快结果可能已经随 Telegram/Email 当前请求送出；复核消息共用该请求的回传标记。
      void deliverReviewedWorkspaceBridgeExternalReturn(
        store, request.id, reviewedReply, workspaceBridgeExternalReturnsInFlight,
        async (current, message) => {
          const result = await sendCommunicationReturnExternal({
            execution: {
              id: `bridge-continuation:${current.id}`,
              communicationReturnSource: current.originSource === "telegram" ? "telegram" : "email",
              communicationReturnExternalRef: current.originExternalRef ?? undefined
            },
            message,
            publicServerUrl
          });
          return result.status === "sent";
        }
      ).catch((error) => console.warn(`[server] Bridge continuation external send failed request=${request.id}: ${error instanceof Error ? error.message : String(error)}`));
    }
    // A next Bridge hop can finish before this continuation publishes; arm it only now.
    for (const nextRequestId of store.armCrossWorkspaceContinuationsForSourceMessage(request.originMessageId!)) {
      if (nextRequestId !== request.id) scheduleAssistantBridgeContinuation(nextRequestId);
    }
  } catch (error) {
    uncertain = true;
    console.warn(`[server] assistant Bridge continuation failed request=${requestId}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // A model/tool failure after dispatch has unknown side effects. Keep it interrupted for operator review.
    finishBridgeContinuationAttempt(store, attempt.id, {
      state: uncertain || !replyMessageId ? "interrupted" : "completed",
      publicReplyMessageId: replyMessageId,
      ...(uncertain ? { errorCode: "continuation_failed" } : {})
    });
  }
}

function scheduleAssistantBridgeContinuation(requestId: string): void {
  // The initial TYR reply arms both terminal and early peer interaction continuations.
  for (const eventId of pendingBridgeInteractionEventsForRequest(store, requestId)) {
    scheduleWorkspaceBridgeInteractionContinuation(eventId);
  }
  void publishAssistantBridgeContinuation(requestId);
}

async function publishWorkspaceBridgeInteractionContinuation(eventMessageId: string): Promise<void> {
  const claimed = claimBridgeInteractionContinuation(store, eventMessageId);
  if (!claimed) return;
  const { request, event } = claimed;
  let replyMessageId: string | null = null;
  let interrupted = false;
  try {
    const draft = await continueCommunicationAgentAfterBridge(routeContext, { request, terminal: event });
    const peerTerminal = store.listCrossWorkspaceMessages(request.bridgeId, { conversationId: request.conversationId ?? undefined })
      .some((message) => message.terminalRequestId === request.id);
    if (peerTerminal) {
      // A final/error that won during model processing supersedes this intermediate question.
      finishBridgeInteractionContinuation(store, eventMessageId, null);
      return;
    }
    const reply = publishReviewedWorkspaceBridgeInteraction(routeContext, { request, event, draft });
    replyMessageId = reply?.id ?? null;
    for (const nextRequestId of store.armCrossWorkspaceContinuationsForSourceMessage(request.originMessageId!)) {
      if (nextRequestId !== request.id) scheduleAssistantBridgeContinuation(nextRequestId);
    }
  } catch (error) {
    interrupted = true;
    console.warn(`[server] Bridge interaction continuation interrupted event=${eventMessageId}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    finishBridgeInteractionContinuation(store, eventMessageId, replyMessageId, interrupted || !replyMessageId);
  }
}

function scheduleWorkspaceBridgeInteractionContinuation(eventMessageId: string): void {
  enqueueBridgeInteractionContinuation(store, eventMessageId, publishWorkspaceBridgeInteractionContinuation);
}

function routeIntentForCommunicationExecution(execution: RuntimeExecutionRecord) {
  const ref = workspaceBridgeRefForExecution(execution);
  return ref ? getBridgeRouteIntent(store, ref.requestMessageId)
    : execution.communicationReturnSourceMessageId
      ? getCommunicationRouteIntent(store, execution.communicationReturnSourceMessageId)
      : null;
}

function missingFrozenRouteForCommunicationExecution(execution: RuntimeExecutionRecord): boolean {
  if (routeIntentForCommunicationExecution(execution)) return false;
  const ref = workspaceBridgeRefForExecution(execution);
  const source = ref ? store.getCrossWorkspaceMessage(ref.requestMessageId)
    : execution.communicationReturnSourceMessageId ? store.getMessage(execution.communicationReturnSourceMessageId) : null;
  return Boolean(source && !bridgeRouteIntentPredatesCutover(store, source.createdAt));
}

async function publishCommunicationReturnEvent(eventId: string): Promise<void> {
  const pending = getCommunicationReturnEvent(store, eventId);
  if (pending?.state === "pending" && communicationReturnPresentationInFlight.has(pending.sourceExecutionId)) {
    setTimeout(() => scheduleCommunicationReturnEvent(eventId), 100);
    return;
  }
  const event = claimCommunicationReturnEvent(store, eventId);
  if (!event) return;
  communicationReturnPresentationInFlight.add(event.sourceExecutionId);
  let replyMessageId: string | null = null;
  let uncertain = false;
  try {
    const execution = store.getRuntimeExecution(event.sourceExecutionId);
    const worker = execution ? store.getAgent(execution.agentId) : null;
    const source = store.getMessage(event.sourceMessageId);
    const priorReturn = execution?.communicationReturnMessageId
      ? store.getMessage(execution.communicationReturnMessageId)
      : null;
    const canResumePartialAction = event.kind === "action_request" && priorReturn?.result?.status === "partial";
    if (!execution || !worker || !source || execution.communicationReturnSourceMessageId !== source.id ||
        (execution.communicationReturnMessageId && !canResumePartialAction) || !execution.communicationReturnChannelId) return;
    const savedRoute = routeIntentForCommunicationExecution(execution);
    const targetMismatch = event.kind === "action_request" && event.proposedBridgeId &&
      event.proposedBridgeId !== savedRoute?.targetBridgeId;
    const safeContent = buildCompletedCommunicationResult(worker, event.content).body || "The Agent returned an update.";
    if (workspaceBridgeRefForExecution(execution)) {
      // IPC is a private worker-to-TYR signal. TYR executes authorized actions and
      // publishes only reviewed updates; execution final output is not a business receipt.
      store.appendRuntimeExecutionEvent({
        executionId: execution.id, agentId: execution.agentId, taskId: execution.taskId,
        kind: "diagnostic", title: "TYR received Agent update",
        detail: `${event.kind}: ${safeContent.slice(0, 500)}`
      });
      if (event.kind === "question" || event.kind === "action_request") {
        const reviewed = await reviewInboundBridgeWorkerEvent(routeContext, {
          execution, event, safeContent, sourceAgentName: worker.displayName || worker.name
        });
        replyMessageId = reviewed?.id ?? null;
      }
      return;
    }
    const directAction = event.kind === "action_request" && event.proposedBridgeId && !targetMismatch
      ? await sendAuthorizedCommunicationNextAction(routeContext, {
          execution, eventId: event.id, proposedBridgeId: event.proposedBridgeId
        })
      : null;
    let draft: CommunicationAgentContinuationDraft | null = directAction
      ? {
          content: directAction.content,
          ...(directAction.requestId ? { bridgeRequestIds: [directAction.requestId], outcomeStatus: "running" } : { outcomeStatus: "partial" }),
          result: {
            version: 1,
            status: "partial",
            title: directAction.requestId ? "TYR is waiting for the connected workspace" : "TYR needs your input",
            summary: directAction.content
          }
        }
      : targetMismatch ? null : await continueCommunicationAgentRequest(routeContext, {
          execution,
          workerResult: safeContent,
          sourceAgentName: worker.displayName || worker.name,
          ipcEvent: { id: event.id, kind: event.kind }
        });
    if (event.kind === "progress" && !draft?.executionIds?.length && !draft?.bridgeRequestIds?.length && !draft?.pendingActionId) {
      // Progress is observable without turning an unfinished worker step into a final user reply.
      store.appendRuntimeExecutionEvent({
        executionId: execution.id, agentId: execution.agentId, taskId: execution.taskId,
        kind: "diagnostic", title: "TYR received Agent progress", detail: safeContent.slice(0, 500)
      });
      return;
    }
    if (targetMismatch || !draft) {
      const summary = targetMismatch
        ? "The Agent proposed a different connected workspace. Please confirm the destination; I have not sent a Workspace Bridge request."
        : "TYR received the Agent update but could not safely continue it. The original request needs your input.";
      draft = { content: summary, outcomeStatus: "partial", result: { version: 1, status: "partial", title: "TYR needs your input", summary } };
    }
    const originAction = event.kind === "action_request" && execution.communicationReturnUserId
      ? verifiedCommunicationOriginAction(store, {
          eventId: event.id,
          serverId: execution.serverId ?? "local",
          requestingUserId: execution.communicationReturnUserId,
          sourceMessageId: source.id
        })
      : null;
    if (originAction && !draft.bridgeRequestIds?.length && !draft.executionIds?.length) {
      // The worker's durable result is retained; a missing send is a question about this exact notice,
      // not permission to repeat the completed worker instruction on the next Human turn.
      const content = `Agent result: ${safeContent}\n\nI can notify ${originAction.peerWorkspaceName} through the verified original request. Send this exact message?\n${originAction.peerMessage}\n\nReply yes or no.`;
      draft = {
        content,
        outcomeStatus: "partial",
        result: { version: 1, status: "partial", title: "TYR needs action confirmation", summary: content }
      };
    }
    const hasNextStep = Boolean(draft.executionIds?.length || draft.bridgeRequestIds?.length);
    if ((event.kind === "question" || event.kind === "action_request") && !hasNextStep && !draft.pendingActionId) {
      draft = {
        ...draft,
        outcomeStatus: "partial",
        result: { version: 1, status: "partial", title: "TYR needs your input", summary: draft.content }
      };
    }
    const assistant = store.ensureDefaultCommunicationAgent(execution.serverId ?? "local");
    const result = draft.result ?? {
      version: 1 as const,
      status: hasNextStep ? "partial" as const : draft.outcomeStatus === "completed" ? "completed" as const : "partial" as const,
      title: hasNextStep ? "TYR is continuing the request" : "TYR received the Agent update",
      summary: draft.content
    };
    if (!hasNextStep && savedRoute?.actionKind !== "none" && savedRoute &&
        !completedFrozenBridgeStep(store, savedRoute) && result.status === "completed") {
      result.status = "partial";
      result.title = "TYR request needs attention";
      result.summary = "The authorized Workspace Bridge step has no request ID and remains pending.";
    }
    result.communicationRequest = { sourceMessageId: source.id };
    const reply = store.sendMessage({
      target: execution.communicationReturnChannelId,
      ...(execution.communicationReturnConversationId ? {
        conversationId: execution.communicationReturnConversationId, allowClosedConversation: true
      } : {}),
      content: draft.content,
      result,
      senderType: "agent", senderId: assistant.id, senderName: assistant.displayName,
      serverId: execution.serverId ?? assistant.serverId ?? "local"
    }).message;
    replyMessageId = reply.id;
    emitRealtimeMessage(reply);
    if (event.kind === "result" || event.kind === "action_request" || hasNextStep) {
      const updated = store.markRuntimeExecutionCommunicationReturnDispatched(execution.id, { communicationReturnMessageId: reply.id });
      if (updated) emitRealtimeRuntimeExecution(updated);
      if (updated && !hasNextStep) emitCommunicationReturnTerminalProgress(updated, result.status === "failed" ? "failed" : result.status === "completed" ? "completed" : "needs_input", result.status === "completed" ? "Response ready." : "Needs your input.");
    }
    for (const requestId of store.armCrossWorkspaceContinuationsForSourceMessage(source.id)) scheduleAssistantBridgeContinuation(requestId);
    if (event.kind === "result" || event.kind === "action_request") sendCommunicationReturnExternalAsync(execution, reply, []);
  } catch (error) {
    uncertain = true;
    console.warn(`[server] TYR IPC return interrupted event=${eventId}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (uncertain) interruptCommunicationReturnEvent(store, event.id);
    else completeCommunicationReturnEvent(store, event.id, replyMessageId);
    communicationReturnPresentationInFlight.delete(event.sourceExecutionId);
    const execution = store.getRuntimeExecution(event.sourceExecutionId);
    const finalMessage = execution ? store.findFinalMessageForExecution(execution.id) : null;
    if (execution?.status === "completed" && !execution.communicationReturnMessageId && finalMessage) {
      void presentAndPublishCommunicationReturn(execution.id, finalMessage);
    }
  }
}

function scheduleCommunicationReturnEvent(eventId: string): void {
  void publishCommunicationReturnEvent(eventId);
}

async function presentAndPublishCommunicationReturn(executionId: string, finalMessage: MessageRecord): Promise<void> {
  if (communicationReturnPresentationInFlight.has(executionId)) return;
  const pendingActions = pendingActionableWorkerEventIds(routeContext, executionId);
  if (pendingActions.length) {
    for (const eventId of pendingActions) scheduleCommunicationReturnEvent(eventId);
    return;
  }
  communicationReturnPresentationInFlight.add(executionId);
  // final message 已经存在时不再允许 30 秒缺失回传计时器抢先发布失败消息。
  clearCommunicationReturnFailureTimer(executionId);
  let fallbackContent = finalMessage.content;
  try {
    const execution = store.getRuntimeExecution(executionId);
    if (!execution || execution.communicationReturnMessageId || execution.status !== "completed") return;
    const completedAgent = store.getAgent(execution.agentId);
    if (!completedAgent) return;
    const rawContent = communicationReturnFinalContent(store, execution.id, finalMessage);
    // 凭据和其他不可公开内容必须在发送给整理模型前先完成服务端脱敏。
    const safeRawResult = buildCompletedCommunicationResult(completedAgent, rawContent);
    const safeRawContent = safeRawResult.body?.trim() || safeRawResult.summary.trim();
    const workerOutcome = communicationWorkerOutcome(safeRawContent);
    fallbackContent = safeRawContent;
    const workspaceId = execution.serverId ?? completedAgent.serverId ?? "local";
    const currentInstructions = store.getWorkspaceRoutingInstructions(workspaceId);
    const workspaceRoutingInstructions = {
      instructions: execution.communicationReturnInstructions ?? currentInstructions.instructions,
      revision: execution.communicationReturnInstructionsRevision ?? currentInstructions.revision
    };
    const sourceMessage = execution.communicationReturnSourceMessageId
      ? store.getMessage(execution.communicationReturnSourceMessageId)
      : null;
    const handoffMessage = store.getMessage(execution.messageId);
    const attachmentNames = [...new Set(
      [...store.listRuntimeExecutionOutputMessages(execution.id), finalMessage]
        .flatMap((message) => message.attachmentIds ?? [])
        .flatMap((attachmentId) => {
          const attachment = store.getAttachment(attachmentId);
          return attachment ? [attachment.filename] : [];
        })
    )];
    if (workerOutcome.needsInformation && assistantLlmConfig.enabled && attachmentNames.length === 0) {
      const acknowledged = await acknowledgeRepeatedBridgeWorkerQuestion(store, execution, prior => {
        const sanitized = buildCompletedCommunicationResult(completedAgent, prior.workerContent);
        return isRepeatedWorkerQuestion({ previousWorkerQuestion: sanitized.body?.trim() || sanitized.summary.trim(),
          publishedQuestion: prior.reviewedContent, finalWorkerReport: safeRawContent }, assistantLlmConfig);
      });
      if (acknowledged) {
        emitRealtimeRuntimeExecution(acknowledged);
        return;
      }
    }
    const continuation = await continueCommunicationAgentRequest(routeContext, {
      execution,
      workerResult: safeRawContent,
      sourceAgentName: completedAgent.displayName || completedAgent.name
    });
    // IPC may arrive while the model is reviewing final output. If no action was
    // dispatched by that review, the durable action event takes priority.
    if (!continuation?.executionIds?.length && !continuation?.bridgeRequestIds?.length &&
        pendingActionableWorkerEventIds(routeContext, executionId).length) return;
    if (continuation && publishCommunicationContinuation(execution, finalMessage, continuation)) {
      for (const requestId of store.armCrossWorkspaceContinuationsForSourceMessage(execution.communicationReturnSourceMessageId!)) {
        scheduleAssistantBridgeContinuation(requestId);
      }
      return;
    }
    if (workerOutcome.status !== "completed") {
      const summary = workerOutcome.status === "failed"
        ? "The Agent could not complete its step. TYR could not verify completion of the original request."
        : "The Agent's step is still pending. TYR could not verify a further action or completion. The original request remains open.";
      publishCommunicationContinuation(execution, finalMessage, {
        content: summary, outcomeStatus: workerOutcome.status,
        result: { version: 1, status: workerOutcome.status, title: "TYR request needs attention", summary }
      });
      return;
    }
    const routeIntent = routeIntentForCommunicationExecution(execution);
    if ((routeIntent && routeIntent.actionKind !== "none" && !completedFrozenBridgeStep(store, routeIntent)) ||
        missingFrozenRouteForCommunicationExecution(execution)) {
      const summary = routeIntent?.targetBridgeId
        ? "The Agent returned, but TYR could not verify that the authorized Workspace Bridge step was sent. The original request is still open."
        : "The Agent returned, but TYR needs the connected workspace or restaurant before continuing the original request.";
      publishCommunicationContinuation(execution, finalMessage, {
        content: summary,
        outcomeStatus: "partial",
        result: { version: 1, status: "partial", title: "TYR request needs attention", summary }
      });
      return;
    }
    let presentedContent = workspaceBridgeRefForExecution(execution)
      ? "TYR could not verify the Agent result for this request. Please review it in the destination workspace."
      : safeRawContent;
    let presentationVerified = false;
    if (assistantLlmConfig.enabled) {
      try {
        presentedContent = await requestAssistantResultPresentation({
          ...(workspaceBridgeRefForExecution(execution) ? { audience: "bridge_peer" as const } : {}),
          userRequest: sourceMessage?.content.trim() || handoffMessage?.content.trim() || "",
          workerResult: safeRawContent,
          sourceAgentName: workspaceBridgeRefForExecution(execution)
            ? "Local Agent" : completedAgent.displayName || completedAgent.name,
          status: "completed",
          workspaceRoutingInstructions,
          ...(attachmentNames.length > 0 ? { attachmentNames } : {})
        }, assistantLlmConfig);
        presentationVerified = true;
      } catch (error) {
        // 表达整理失败不能吞掉 worker 结果；记录稳定诊断后回退到已脱敏原文。
        store.appendRuntimeExecutionEvent({
          executionId: execution.id,
          agentId: execution.agentId,
          taskId: execution.taskId,
          kind: "diagnostic",
          title: "TYR response presentation fallback",
          detail: "TYR could not prepare the final wording, so the sanitized worker result was returned.",
          payload: { code: error instanceof Error ? error.message.slice(0, 120) : "assistant_presentation_failed" }
        });
        presentedContent = workspaceBridgeRefForExecution(execution)
          ? "TYR could not verify the Agent result for this request. Please review it in the destination workspace."
          : safeRawContent;
      }
    }
    const communicationReturned = createCommunicationReturnMessageForFinalMessage(store, {
      completedExecution: execution,
      finalMessage
    }, { presentedContent, ...(workspaceBridgeRefForExecution(execution) && !presentationVerified
      ? { presentedStatus: "failed" as const } : {}) });
    if (communicationReturned) publishCompletedCommunicationReturn(communicationReturned);
  } catch (error) {
    console.error(`[server] failed to publish TYR communication return execution=${executionId}`, error);
    // 续接异常且原请求仍有授权动作时，不可把 worker 完成当成整条请求完成。
    const execution = store.getRuntimeExecution(executionId);
    if (execution && !execution.communicationReturnMessageId && execution.status === "completed") {
      const workerOutcome = communicationWorkerOutcome(fallbackContent);
      if (workerOutcome.status !== "completed") {
        const summary = workerOutcome.status === "failed"
          ? "The Agent's step failed. TYR could not verify completion of the original request."
          : "The Agent's step is still pending. TYR could not verify a further action or completion. The original request remains open.";
        publishCommunicationContinuation(execution, finalMessage, {
          content: summary, outcomeStatus: workerOutcome.status,
          result: { version: 1, status: workerOutcome.status, title: "TYR request needs attention", summary }
        });
        return;
      }
      const routeIntent = routeIntentForCommunicationExecution(execution);
      if ((routeIntent && routeIntent.actionKind !== "none" && !completedFrozenBridgeStep(store, routeIntent)) ||
          missingFrozenRouteForCommunicationExecution(execution)) {
        publishCommunicationContinuation(execution, finalMessage, {
          content: "TYR could not verify the next Workspace Bridge step. The original request still needs attention; no new request was confirmed sent.",
          outcomeStatus: "partial",
          result: {
            version: 1, status: "partial", title: "TYR request needs attention",
            summary: "The next Workspace Bridge step could not be verified."
          }
        });
        return;
      }
      const fallback = createCommunicationReturnMessageForFinalMessage(store, {
        completedExecution: execution,
        finalMessage
      }, { presentedContent: workspaceBridgeRefForExecution(execution)
        ? "TYR could not verify the Agent result for this request. Please review it in the destination workspace."
        : fallbackContent,
        ...(workspaceBridgeRefForExecution(execution) ? { presentedStatus: "failed" as const } : {}) });
      if (fallback) publishCompletedCommunicationReturn(fallback);
    }
  } finally {
    communicationReturnPresentationInFlight.delete(executionId);
    for (const eventId of pendingActionableWorkerEventIds(routeContext, executionId)) scheduleCommunicationReturnEvent(eventId);
  }
}

async function presentAndPublishCommunicationFailure(executionId: string, progressLabel: string): Promise<void> {
  if (communicationReturnPresentationInFlight.has(executionId)) return;
  communicationReturnPresentationInFlight.add(executionId);
  clearCommunicationReturnFailureTimer(executionId);
  let presentedContent: string | undefined;
  try {
    const execution = store.getRuntimeExecution(executionId);
    if (!execution || execution.communicationReturnMessageId || workspaceBridgeRefForExecution(execution)) return;
    const failure = communicationReturnFailureContent(store, execution);
    const completedAgent = store.getAgent(execution.agentId);
    if (!failure || !completedAgent) return;
    const safeFailure = buildCompletedCommunicationResult(completedAgent, failure.body).body || failure.body;
    presentedContent = safeFailure;
    if (assistantLlmConfig.enabled) {
      const workspaceId = execution.serverId ?? completedAgent.serverId ?? "local";
      const currentInstructions = store.getWorkspaceRoutingInstructions(workspaceId);
      const sourceMessage = execution.communicationReturnSourceMessageId
        ? store.getMessage(execution.communicationReturnSourceMessageId)
        : null;
      const handoffMessage = store.getMessage(execution.messageId);
      try {
        presentedContent = await requestAssistantResultPresentation({
          userRequest: sourceMessage?.content.trim() || handoffMessage?.content.trim() || "",
          workerResult: safeFailure,
          sourceAgentName: failure.sourceAgentName,
          status: "failed",
          workspaceRoutingInstructions: {
            instructions: execution.communicationReturnInstructions ?? currentInstructions.instructions,
            revision: execution.communicationReturnInstructionsRevision ?? currentInstructions.revision
          }
        }, assistantLlmConfig);
      } catch (error) {
        store.appendRuntimeExecutionEvent({
          executionId: execution.id,
          agentId: execution.agentId,
          taskId: execution.taskId,
          kind: "diagnostic",
          title: "TYR response presentation fallback",
          detail: "TYR could not prepare the failure wording, so the sanitized execution result was returned.",
          payload: { code: error instanceof Error ? error.message.slice(0, 120) : "assistant_presentation_failed" }
        });
      }
    }
    const failedReturn = createCommunicationReturnFailureMessage(store, {
      completedExecution: execution
    }, { presentedContent });
    if (!failedReturn) return;
    emitCommunicationReturnTerminalProgress(failedReturn.execution, "failed", progressLabel);
    emitRealtimeMessage(failedReturn.message);
    sendCommunicationReturnExternalAsync(failedReturn.execution, failedReturn.message);
    runtimeWorkspaceSyncPublisher.schedule();
  } catch (error) {
    console.error(`[server] failed to publish TYR communication failure execution=${executionId}`, error);
    const execution = store.getRuntimeExecution(executionId);
    if (execution && !execution.communicationReturnMessageId && !workspaceBridgeRefForExecution(execution)) {
      const fallback = createCommunicationReturnFailureMessage(store, {
        completedExecution: execution
      }, { presentedContent });
      if (fallback) {
        emitCommunicationReturnTerminalProgress(fallback.execution, "failed", progressLabel);
        emitRealtimeMessage(fallback.message);
        sendCommunicationReturnExternalAsync(fallback.execution, fallback.message);
      }
    }
  } finally {
    communicationReturnPresentationInFlight.delete(executionId);
  }
}

function dispatchReturnToAgentForFinalMessage(executionId: string, finalMessage: MessageRecord, options: { deferCommunicationReturn?: boolean } = {}) {
  const execution = store.getRuntimeExecution(executionId);
  if (!execution || execution.agentId !== finalMessage.senderId) return null;
  // turn_completed may precede this HTTP callback. Persist the callback receipt before the
  // asynchronous TYR presentation so recovery and server restart cannot invent a second final.
  if (!store.findFinalMessageForExecution(executionId)) {
    store.appendRuntimeExecutionEvent({
      executionId,
      agentId: execution.agentId,
      taskId: execution.taskId,
      kind: "diagnostic",
      title: "Final reply received",
      detail: "The daemon published the final message after the runtime turn completed.",
      payload: { finalMessageId: finalMessage.id }
    });
  }
  workspaceBridgeFinalReplyRecovery.cancel(executionId);
  const returned = createQueuedAgentReturnRuntimeExecution(store, {
    completedExecution: execution,
    finalMessage,
    detail: "Queued returned agent result."
  });
  if (returned) {
    if (returned.message.kind === "chat") emitRealtimeMessage(returned.message);
    emitRealtimeRuntimeExecution(returned.execution, returned.queuedEvent);
    deliverPendingToOnlineAgents();
  }
  if (!options.deferCommunicationReturn) void presentAndPublishCommunicationReturn(execution.id, finalMessage);
  return returned;
}

function clearCommunicationReturnFailureTimer(executionId: string): void {
  const timer = communicationReturnFailureTimers.get(executionId);
  if (!timer) return;
  clearTimeout(timer);
  communicationReturnFailureTimers.delete(executionId);
}

function scheduleCommunicationReturnFailure(execution: RuntimeExecutionRecord): void {
  if (
    execution.status !== "completed" ||
    !execution.communicationReturnChannelId ||
    !execution.communicationReturnUserId ||
    !execution.communicationReturnSource ||
    execution.communicationReturnMessageId ||
    workspaceBridgeRefForExecution(execution)
  ) return;
  clearCommunicationReturnFailureTimer(execution.id);
  const timer = setTimeout(() => {
    communicationReturnFailureTimers.delete(execution.id);
    const current = store.getRuntimeExecution(execution.id);
    if (!current) return;
    void presentAndPublishCommunicationFailure(current.id, "Response unavailable.");
  }, communicationReturnFailureTimeoutMs);
  timer.unref();
  communicationReturnFailureTimers.set(execution.id, timer);
}

function recoverWorkspaceBridgeFinalReplyForCompletedExecution(execution: RuntimeExecutionRecord) {
  const recovered = recoverWorkspaceBridgeFinalReplyFromRuntimeOutput(
    store,
    { completedExecution: execution },
    { deferCommunicationReturn: true }
  );
  if (!recovered) return null;
  emitRealtimeMessage(recovered.finalMessage);
  emitRealtimeRuntimeExecution(store.getRuntimeExecution(execution.id) ?? execution, recovered.markerEvent);
  void presentAndPublishCommunicationReturn(execution.id, recovered.finalMessage);
  return recovered;
}

const workspaceBridgeFinalReplyRecovery = new WorkspaceBridgeFinalReplyRecovery({
  graceMs: 2_000,
  getExecution: (executionId) => store.getRuntimeExecution(executionId),
  hasFinalMessage: (executionId) => Boolean(store.findFinalMessageForExecution(executionId) ||
    communicationReturnPresentationInFlight.has(executionId)),
  isBridgeExecution: (execution) => Boolean(workspaceBridgeRefForExecution(execution)),
  recover: recoverWorkspaceBridgeFinalReplyForCompletedExecution
});

function recoverCompletedWorkspaceBridgeRepliesOnBoot(): void {
  const rows = store.db.prepare(`select id from runtime_executions
    where status = 'completed' and communication_return_channel_id is not null
      and communication_return_message_id is null`).all() as Array<{ id: string }>;
  for (const { id } of rows) {
    const execution = store.getRuntimeExecution(id);
    if (!execution || !workspaceBridgeRefForExecution(execution)) continue;
    const finalMessage = store.findFinalMessageForExecution(id);
    if (finalMessage) void presentAndPublishCommunicationReturn(id, finalMessage);
    else workspaceBridgeFinalReplyRecovery.schedule(id);
  }
}

function reconcileWorkspaceBridgePublications(): void {
  for (const id of bridgeReviewedPublicationCandidates(store)) {
    try {
      const returned = reconcileReviewedWorkspaceBridgeResult(store, id);
      if (!returned) continue;
      if (returned.originMessage) emitRealtimeMessage(returned.originMessage);
      emitRealtimeWorkspaceBridgeMessage(returned.bridgeMessage);
      const request = store.getCrossWorkspaceMessage(returned.bridgeMessage.replyToMessageId!);
      if (request && returned.originMessage) scheduleWorkspaceBridgeExternalReturn(request, returned.originMessage);
      if (request?.awaitingAgentId && request.continuationState === "pending") scheduleAssistantBridgeContinuation(request.id);
      publishWorkspaceSync();
    } catch (error) {
      console.error(`[server] bridge reviewed publication reconciliation failed execution=${id}`, error);
    }
  }
  const requests = store.db.prepare(`select r.id, r.source_workspace_id as serverId, r.source_capability_user_id as userId
    from cross_workspace_messages r where r.response_kind is null and r.resolved_by_terminal_id is null
      and r.created_at >= (select cutoff_at from bridge_publication_recovery_cutover where id = 1)
      and not exists (select 1 from cross_workspace_messages t where t.terminal_request_id = r.id)
    order by r.created_at limit 500`).all() as Array<{ id: string; serverId: string; userId: string }>;
  const service = new WorkspaceBridgeRequestService(routeContext);
  for (const request of requests) {
    try { recordStaleBridgeProgress(store, service.status({ userId: request.userId, serverId: request.serverId, source: "web" }, request.id)); }
    catch { /* Revoked visibility cannot grant new work or disclose diagnostic contents. */ }
  }
}

function publishWorkspaceBridgeFailureForExecution(execution: RuntimeExecutionRecord) {
  const failedReturn = createWorkspaceBridgeReturnMessageForFailedExecution(store, {
    failedExecution: execution
  });
  if (!failedReturn) return null;
  const bridgeRequest = failedReturn.bridgeMessage.replyToMessageId
    ? store.getCrossWorkspaceMessage(failedReturn.bridgeMessage.replyToMessageId)
    : null;
  if (failedReturn.originMessage) emitRealtimeMessage(failedReturn.originMessage);
  if (bridgeRequest && failedReturn.originMessage) scheduleWorkspaceBridgeExternalReturn(bridgeRequest, failedReturn.originMessage);
  emitRealtimeWorkspaceBridgeMessage(failedReturn.bridgeMessage);
  if (bridgeRequest) {
    emitWorkspaceBridgeOriginProgress(
      { store, broadcastRealtime },
      bridgeRequest,
      "failed",
      "Workspace request failed."
    );
  }
  publishWorkspaceSync();
  return failedReturn;
}

function publishTerminalCommunicationFailure(execution: RuntimeExecutionRecord) {
  if (execution.status !== "failed" && execution.status !== "stalled" && execution.status !== "cancelled") return null;
  if (workspaceBridgeRefForExecution(execution)) return publishWorkspaceBridgeFailureForExecution(execution);
  void presentAndPublishCommunicationFailure(execution.id, "Request failed.");
  return null;
}

function sendCommunicationReturnExternalAsync(execution: RuntimeExecutionRecord, message: MessageRecord, precedingMessages: MessageRecord[] = []): void {
  // Final handoff results are already persisted in the TYR DM; this async bridge only mirrors them back to the originating external channel.
  if (execution.communicationReturnSource === "web") {
    if (execution.communicationReturnUserId && execution.communicationReturnChannelId) {
      mirrorTyrAssistantMessagesToTelegram({
        userId: execution.communicationReturnUserId,
        serverId: execution.serverId ?? store.resolveTarget(execution.communicationReturnChannelId)?.serverId ?? "local",
        channelId: execution.communicationReturnChannelId,
        messages: [...precedingMessages, message]
      });
    }
    return;
  }
  void sendCommunicationReturnExternal({ execution, message, publicServerUrl })
    .catch((err) => console.warn(`[server] communication return external send failed execution=${execution.id}: ${err instanceof Error ? err.message : String(err)}`));
}

function mirrorTyrAssistantMessagesToTelegram(input: TyrAssistantTelegramSyncInput): void {
  if (!telegramConfigured(telegramConnectorConfig)) return;
  const result = enqueueTyrAssistantTelegramMessages(store, input);
  if (result.status === "enqueued") telegramOutboundWorker.wake();
}

const workspaceBridgeExternalReturnTimers = new Map<string, NodeJS.Timeout>();
const workspaceBridgeExternalReturnsInFlight = new Set<string>();
const WORKSPACE_BRIDGE_DIRECT_RETURN_GRACE_MS = 12_000;

function scheduleWorkspaceBridgeExternalReturn(request: CrossWorkspaceMessageRecord, message: MessageRecord, retryAttempt = 0, delayOverrideMs?: number): void {
  scheduleAssistantBridgeContinuation(request.id);
  if (
    (request.originSource !== "telegram" && request.originSource !== "email") ||
    !request.originExternalRef ||
    request.originExternalDeliveredAt ||
    workspaceBridgeExternalReturnTimers.has(request.id)
  ) return;
  // 直接 Bridge 回复会由当前 Telegram/Email 请求携带；宽限期后仍未标记才走主动推送，避免快结果重复发送。
  const directDeadline = Date.parse(request.createdAt) + WORKSPACE_BRIDGE_DIRECT_RETURN_GRACE_MS;
  const delayMs = delayOverrideMs ?? (retryAttempt > 0
    ? Math.min(5 * 60_000, 15_000 * (2 ** Math.min(retryAttempt - 1, 4)))
    : Math.max(0, directDeadline - Date.now()));
  const timer = setTimeout(() => {
    workspaceBridgeExternalReturnTimers.delete(request.id);
    void deliverWorkspaceBridgeExternalReturn(request.id, message.id, retryAttempt);
  }, delayMs);
  timer.unref?.();
  workspaceBridgeExternalReturnTimers.set(request.id, timer);
}

async function deliverWorkspaceBridgeExternalReturn(requestId: string, messageId: string, retryAttempt: number): Promise<void> {
  if (workspaceBridgeExternalReturnsInFlight.has(requestId)) {
    const request = store.getCrossWorkspaceMessage(requestId);
    const message = store.getMessage(messageId);
    if (request && message && !request.originExternalDeliveredAt) {
      scheduleWorkspaceBridgeExternalReturn(request, message, retryAttempt, 1_000);
    }
    return;
  }
  workspaceBridgeExternalReturnsInFlight.add(requestId);
  try {
    const request = store.getCrossWorkspaceMessage(requestId);
    const message = store.getMessage(messageId);
    if (!request || !message || request.originExternalDeliveredAt || !request.originExternalRef) return;
    try {
      if (request.originSource === "telegram") {
        const ref = JSON.parse(request.originExternalRef) as Record<string, unknown>;
        const chatId = typeof ref.chatId === "string" ? ref.chatId : "";
        const telegramUserId = typeof ref.telegramUserId === "string" ? ref.telegramUserId : "";
        const account = telegramUserId ? store.getTelegramAccountByTelegramUserId(telegramUserId) : null;
        if (!account || account.telegramChatId !== chatId || account.serverId !== request.sourceWorkspaceId) return;
        const deliveries = store.enqueueTelegramOutboundDeliveries({
          telegramAccountId: account.id,
          telegramChatId: chatId,
          messageId: message.id,
          messageSeq: message.seq,
          chunks: splitTelegramText(sanitizeHumanVisibleText(message.content))
        });
        if (deliveries.length === 0) return;
        telegramOutboundWorker.wake();
      } else if (request.originSource === "email") {
        const emailReturn = await sendCommunicationReturnExternal({
          execution: {
            id: `workspace_bridge:${request.id}`,
            communicationReturnSource: "email",
            communicationReturnExternalRef: request.originExternalRef
          },
          message,
          publicServerUrl
        });
        if (emailReturn.status !== "sent") throw new Error(emailReturn.reason);
      } else {
        return;
      }
      store.updateCrossWorkspaceMessage(request.id, { originExternalDeliveredAt: new Date().toISOString() });
    } catch (error) {
      console.warn(`[server] workspace bridge external return failed request=${request.id}: ${error instanceof Error ? error.message : String(error)}`);
      if (retryAttempt < 5) scheduleWorkspaceBridgeExternalReturn(request, message, retryAttempt + 1);
    }
  } finally {
    workspaceBridgeExternalReturnsInFlight.delete(requestId);
  }
}

function isRecoveredWorkspaceBridgeFinalPublishFailure(agentId: string, detail: string | undefined): boolean {
  if (!detail?.startsWith("Final reply publish failed")) return false;
  const agent = store.getAgent(agentId);
  const latest = store
    .listRuntimeExecutions({ serverId: agent?.serverId, limit: 100 })
    .find((execution) => execution.agentId === agentId);
  return Boolean(
    latest &&
    latest.status === "completed" &&
    latest.communicationReturnMessageId &&
    workspaceBridgeRefForExecution(latest)
  );
}

function completeRuntimeExecutionFromFinalMessage(execution: RuntimeExecutionRecord, finalMessage: MessageRecord): RuntimeExecutionRecord | null {
  const current = store.getRuntimeExecution(execution.id) ?? execution;
  const recoveryDisposition = runtimeFinalMessageRecoveryDisposition(
    current,
    finalMessage.senderId,
    store.listRuntimeExecutionEvents(current.id)
  );
  if (recoveryDisposition === "blocked") {
    assistantOutputCoalescer.clear(current.id);
    if (current.status === "failed") return current;
    const failed = store.updateRuntimeExecutionStatus(current.id, "failed") ?? store.getRuntimeExecution(current.id) ?? current;
    emitRealtimeRuntimeExecution(failed);
    return failed;
  }
  if (recoveryDisposition === "ignore") return current;
  const recoveredAt = new Date().toISOString();
  // final message HTTP 回调可能先于尚在队列中的 WebSocket delta；这里只保存 running checkpoint，
  // 不能把未消费完的缓冲误标成 completed，完整 final message 才是 recovery 路径的权威终态。
  assistantOutputCoalescer.flush(current, {
    at: recoveredAt,
    status: "running",
    clear: true
  });
  const outputEvent = store.appendRuntimeExecutionEvent({
    executionId: current.id,
    agentId: current.agentId,
    taskId: current.taskId,
    kind: "assistant_output",
    title: "Assistant output",
    detail: finalMessage.content,
    payload: {
      status: "completed",
      recoveredFromFinalMessage: true,
      finalMessageId: finalMessage.id
    },
    at: recoveredAt
  });
  emitRealtimeRuntimeExecution(store.getRuntimeExecution(current.id) ?? current, outputEvent);
  const completedEvent = store.appendRuntimeExecutionEvent({
    executionId: current.id,
    agentId: current.agentId,
    taskId: current.taskId,
    kind: "turn_completed",
    title: "Turn completed",
    detail: "Runtime turn completed via final message recovery.",
    payload: {
      recoveredFromFinalMessage: true,
      finalMessageId: finalMessage.id
    }
  });
  const completed = store.updateRuntimeExecutionStatus(current.id, "completed") ?? store.getRuntimeExecution(current.id) ?? current;
  emitRealtimeRuntimeExecution(completed, completedEvent);
  assistantOutputCoalescer.clear(current.id);
  if (shouldTriggerSafetyAudit("turn_completed") && !workspaceBridgeRefForExecution(completed)) {
    void runSafetyAudit({
      store,
      config: safetyAuditConfig,
      trigger: "turn_completed",
      execution: completed,
      event: completedEvent,
      onUpdate: emitRealtimeSafetyAssessment
    });
  }
  runtimeWorkspaceSyncPublisher.schedule();
  return completed;
}

function sendReminderUpsert(agent: AgentRecord, reminder: ReturnType<typeof formatReminder>): void {
  if (isCommunicationAgent(agent) || !agent.machineId) return;
  const machine = store.getMachine(agent.machineId);
  if (!machine || machine.status !== "online") return;
  sendToDaemon(machine.id, { type: "reminder.upsert", reminder: reminderJob({ ...reminder, ownerAgentId: agent.id }), traceparent: newTraceparent() });
}

function sendReminderCancel(agent: AgentRecord, reminderId: string, version: number): void {
  if (isCommunicationAgent(agent) || !agent.machineId) return;
  const machine = store.getMachine(agent.machineId);
  if (!machine || machine.status !== "online") return;
  sendToDaemon(machine.id, { type: "reminder.cancel", reminderId, version, traceparent: newTraceparent() });
}

function sendReminderSnapshot(agent: AgentRecord): void {
  if (isCommunicationAgent(agent) || !agent.machineId) return;
  const machine = store.getMachine(agent.machineId);
  if (!machine || machine.status !== "online") return;
  sendToDaemon(machine.id, { type: "reminder.snapshot", agentId: agent.id, reminders: store.reminderJobsForAgent(agent.id), traceparent: newTraceparent() });
}

function startAgent(agent: AgentRecord, resumePrompt?: string): boolean {
  reconcileStaleRuntimeTurnsBeforeDispatch();
  if (agent.deletedAt || isCommunicationAgent(agent) || !agent.machineId || !agent.runtime) return false;
  const machine = store.getMachine(agent.machineId);
  if (!machine || machine.deletedAt || machine.status !== "online") return false;
  if (runtimeAccessErrorForAgent(agent, machine)) return false;
  // Start 是进程级副作用；已有启动请求尚未收到 daemon 状态时，将重复请求视为同一次成功调度。
  if (agentStartRequests.isPending(agent.id)) return true;
  if (shouldStopBeforeTaskStart(agent)) {
    sendToDaemon(machine.id, { type: "agent:stop", agentId: agent.id });
  }
  const launchId = `launch-${Date.now().toString(36)}`;
  const config = runtimeConfig(agent, machine);
  config.launchId = launchId;
  config.workspacePath = agent.workspacePath;
  const sent = sendToDaemon(machine.id, {
    type: "agent:start",
    agentId: agent.id,
    config,
    resumePrompt,
    launchId
  });
  if (sent) {
    agentStartRequests.markPending(agent.id);
    agentStateEvents.expectLaunch(agent.id, launchId);
    store.updateAgentLaunch(agent.id, launchId);
    reconcileSupersededAgentRuntimeWork({ agentId: agent.id, launchBoundary: true });
  }
  return sent;
}

function runtimeAccessErrorForAgent(agent: AgentRecord, machine: MachineRecord) {
  const runtimeReport = agent.runtime
    ? store.listRuntimeReports(machine.id).find((report) => report.runtime === agent.runtime && report.status === "available")
    : null;
  return runtimeAccessConfigurationError(agent.runtime, agent.permissionMode, agent.runtimeResourceGrants, runtimeReport);
}

function runtimeAccessErrorDetail(errorCode: NonNullable<ReturnType<typeof runtimeAccessErrorForAgent>>): string {
  if (errorCode === "runtime_read_only_enforcement_unavailable") {
    return "Read Only Runtime Access requires an updated daemon. Update the daemon, restart it, then restart this Agent.";
  }
  if (errorCode === "runtime_read_only_unsupported") return "This runtime does not support hard Read Only Runtime Access.";
  return "The saved Runtime Access configuration contains an incompatible directory write grant.";
}

const workspaceSharedFiles = new WorkspaceSharedFileService(store, workspaceSharedFileDir, syncAgentSharedFiles);
const workspaceBridgeEmailInvitations = new WorkspaceBridgeEmailInvitations({ store, publicServerUrl, emitRealtimeMessage });

const routeContext = {
  humanReplies: undefined as WorkspaceBridgeHumanReplies | undefined,
  store,
  deploymentNotice,
  workspaceBridgeEmailInvitations,
  publicServerUrl,
  safetyAuditConfig,
  governanceConfig,
  assistantLlmConfig,
  latestRuntimeSha,
  upload,
  workspaceSharedFiles,
  daemonSockets,
  syncClients,
  workspaceTreeRequests,
  workspaceReadRequests,
  skillRequests,
  runtimeModelRequests,
  cleanupUploadedFile,
  validateUploadedFile,
  uploadFilename,
  agentCanAccessAttachment,
  requireAuthUser,
  authUser,
  authAgent,
  requireAgentCapability,
  primaryServerIdForUser,
  isServerMember,
  isServerOwner,
  canSeeMachine,
  resolveWorkspaceBridgeCapability: resolveWorkspaceBridgeCapabilityForUser,
  requireOwnedMachine,
  requireAgentRuntimeOwner,
  writeWorkspaceBootstrapSync,
  publishWorkspaceSync,
  broadcastRealtime,
  emitRealtimeMessage,
  emitRealtimeWorkspaceBridgeMessage,
  scheduleWorkspaceBridgeExternalReturn,
  scheduleAssistantBridgeContinuation,
  scheduleWorkspaceBridgeInteractionContinuation,
  scheduleCommunicationReturnEvent,
  mirrorTyrAssistantMessagesToTelegram,
  emitRealtimeTaskCreated,
  emitRealtimeTaskUpdated,
  emitRealtimeTaskDeleted,
  emitRealtimeRuntimeExecution,
  emitRealtimeRuntimeApproval,
  publishTerminalCommunicationFailure,
  notifyPendingRuntimeApprovalExternal: notifyPendingRuntimeApprovalExternalAsync,
  emitRealtimeGovernanceDecision,
  emitRealtimeThreadUpdate,
  emitRealtimeAgentActivity,
  emitRealtimeAgentStatus,
  emitRealtimeMachineUpdated,
  emitRealtimeMachineDeleted,
  formatPublicMessage,
  formatPublicTask,
  parseTaskDetails,
  parseAgentCapabilityList,
  isTaskStatus,
  formatSearchMessage,
  formatChannel,
  formatSkill,
  formatActivityLog,
  gravatarHash,
  listInboxItems,
  preferredAgentForTask,
  deliverPendingToOnlineAgents,
  dispatchQueuedAgentInbox,
  createAndEnqueueTaskRun,
  createAdoptedTaskRun,
  bindDaemonActiveExecution,
  bindRuntimeApprovalToTaskExecution,
  createAndEnqueueTaskRunsForMessage,
  createAndEnqueueThreadHandoffRun,
  createAndEnqueueMessageHandoffRun,
  createAndEnqueueDelegationRun,
  dispatchReturnToAgentForFinalMessage,
  completeRuntimeExecutionFromFinalMessage,
  createQueuedMessageRuntimeExecutionsForMessage,
  sendReminderUpsert,
  sendReminderCancel,
  sendReminderSnapshot,
  startAgent,
  contextSessionsEnabledForAgent,
  sendToDaemon,
  daemonSupports: (machineId, capability) => daemonConnections.supports(machineId, capability),
  recordConnectorRotationState,
  sendToDevice,
  serverIdForAgent,
  taskForWakeMessage,
  mentionedAgentsForContent,
  agentBelongsToServer,
  canCreateAgentOnMachine,
  listChannelFileItems,
  listChannelThreadSummariesFromSnapshot,
  lastMessageAt,
  formatAgentListItem,
  formatMachineListResponse: (machines: Array<{ machine: MachineRecord; runtimes: RuntimeReport[] }>) => formatMachineListResponse(machines, latestRuntimeSha()),
  machineConnectCommandSet,
  runMachineAgentBatchAction,
  buildAttachmentPreview,
  attachmentPreviewType,
  formatInternalMessage,
  formatInternalTask,
  formatReminder
} satisfies ServerRouteContext;

routeContext.humanReplies = new WorkspaceBridgeHumanReplies(routeContext);
registerHttpRoutes(app, routeContext);
const tyrHeartbeatScheduler = createTyrHeartbeatScheduler(routeContext);
const runtimeApprovalExpiry = createRuntimeApprovalExpiry(routeContext);

const platformAgentManagement = createAgentManagementService({
  store,
  startAgent,
  sendToDaemon,
  emitRealtimeAgentStatus,
  emitRealtimeRuntimeExecution,
  emitRealtimeRuntimeApproval,
  publishTerminalCommunicationFailure,
  broadcastRealtime,
  publishWorkspaceSync
});

function recordRejectedPlatformOperation(request: Extract<PlatformOpsRequest, { agentId: string }>, input: {
  error: string;
  serverId?: string | null;
  machineId?: string | null;
  activeExecutionIds?: string[];
  pendingApprovalIds?: string[];
}): PlatformOpsResponse {
  store.recordAuditEvent({
    kind: `platform_operator_agent_${request.action}`,
    actorType: "platform_operator",
    actorId: request.operatorId,
    resourceType: "agent",
    resourceId: request.agentId,
    serverId: input.serverId ?? null,
    metadata: {
      operationId: request.requestId,
      action: request.action,
      status: "failed",
      source: "ops",
      reason: request.reason,
      reference: request.reference,
      machineId: input.machineId ?? null,
      errorCode: input.error,
      activeExecutionIds: input.activeExecutionIds ?? [],
      pendingApprovalIds: input.pendingApprovalIds ?? []
    }
  });
  return { ok: false, requestId: request.requestId, error: input.error };
}

function handlePlatformOperation(request: PlatformOpsRequest): PlatformOpsResponse {
  if (request.action === "deployment_status") {
    return { ok: true, result: { ...inspectDeploymentActivity(), notice: deploymentNotice.read() } };
  }
  if (request.action === "deployment_notice") {
    const notice = deploymentNotice.set({ id: request.noticeId, phase: request.phase, expiresAt: request.expiresAt }, request.expectedNoticeId);
    store.recordAuditEvent({ kind: "platform_deployment_notice", actorType: "platform_operator", actorId: request.operatorId,
      resourceType: "deployment", resourceId: notice.id, metadata: { operationId: request.requestId,
        phase: notice.phase, expiresAt: notice.expiresAt, reason: request.reason, reference: request.reference } });
    return { ok: true, result: { notice } };
  }
  if (request.action === "recover_bridge_result") {
    try {
      const checked = inspectBridgeResultRecovery(store, request);
      if (communicationReturnPresentationInFlight.has(request.executionId)) return { ok: false, error: "bridge_result_recovery_busy" };
      if (!request.apply) return { ok: true, result: { status: "eligible", requestId: checked.request.id,
        executionId: checked.execution.id, finalMessageId: checked.final.id, finalContentSha256: request.finalContentSha256 } };
      if (!assistantLlmConfig.enabled) return { ok: false, error: "bridge_result_review_unavailable" };
      communicationReturnPresentationInFlight.add(request.executionId);
      store.recordAuditEvent({ kind: "workspace_bridge_result_recovery_requested", actorType: "system", actorId: `platform:${request.operatorId}`,
        resourceType: "workspace_bridge", resourceId: checked.request.bridgeId, serverId: checked.execution.serverId,
        metadata: { operationId: request.requestId, executionId: request.executionId, requestId: checked.request.id, reason: request.reason, reference: request.reference } });
      // Pure presentation has no tools: recovery cannot re-run local work or initiate a new action.
      void (async () => {
        try {
          const safe = buildCompletedCommunicationResult(checked.worker, checked.final.content);
          const presentedContent = await requestAssistantResultPresentation({ audience: "bridge_peer",
            userRequest: checked.source.content, workerResult: safe.body?.trim() || safe.summary,
            sourceAgentName: "Local Agent", status: "completed",
            workspaceRoutingInstructions: { instructions: checked.execution.communicationReturnInstructions ?? "",
              revision: checked.execution.communicationReturnInstructionsRevision ?? 0 }
          }, assistantLlmConfig);
          const returned = commitBridgeResultRecovery(store, request, { presentedContent, operatorId: request.operatorId,
            operationId: request.requestId, reason: request.reason, reference: request.reference });
          publishCompletedCommunicationReturn(returned);
        } catch (error) {
          store.recordAuditEvent({ kind: "workspace_bridge_result_recovery_failed", actorType: "system", actorId: `platform:${request.operatorId}`,
            resourceType: "workspace_bridge", resourceId: checked.request.bridgeId, serverId: checked.execution.serverId,
            metadata: { operationId: request.requestId, executionId: request.executionId, code: error instanceof Error ? error.message.slice(0, 160) : "recovery_failed" } });
        } finally { communicationReturnPresentationInFlight.delete(request.executionId); }
      })();
      return { ok: true, result: { status: "reviewing_result", executionId: request.executionId, requestId: checked.request.id } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "bridge_result_recovery_not_proven_safe" };
    }
  }
  if (request.action === "rotate_connector_token") {
    return rotatePlatformConnectorToken({ store, sendToDaemon, emitRealtimeMachineUpdated,
      daemonSupports: (machineId, capability) => daemonConnections.supports(machineId, capability),
      recordPending: (machineId) => recordConnectorRotationState("pending", machineId)
    }, request);
  }
  if (request.action === "clear_stale_execution") {
    return clearStalePlatformExecution({
      store,
      sendToDaemon,
      emitRealtimeRuntimeApproval,
      emitRealtimeRuntimeExecution
    }, request);
  }
  const agent = store.getAgent(request.agentId);
  const machine = agent?.machineId ? store.getMachine(agent.machineId) : null;
  const serverId = agent?.serverId ?? machine?.serverId ?? null;
  if (!agent || agent.deletedAt || !machine || machine.deletedAt || !serverId || isCommunicationAgent(agent)) {
    return recordRejectedPlatformOperation(request, { error: "agent_not_found" });
  }

  if (request.action === "restart" || request.action === "reset") {
    const activeExecutions = store.listRuntimeExecutions({ agentId: agent.id, limit: 1000 })
      .filter((execution) => !isTerminalRuntimeExecutionStatus(execution.status));
    const pendingApprovals = store.listRuntimeApprovals({ agentId: agent.id, limit: 1000 })
      .filter((approval) => approval.status === "pending");
    if (activeExecutions.length > 0 || pendingApprovals.length > 0) {
      return recordRejectedPlatformOperation(request, {
        error: "agent_busy",
        serverId,
        machineId: machine.id,
        activeExecutionIds: activeExecutions.map((execution) => execution.id),
        pendingApprovalIds: pendingApprovals.map((approval) => approval.id)
      });
    }
  }

  const operation = {
    operationId: request.requestId,
    actorUserId: `platform:${request.operatorId}`,
    serverId,
    agentId: agent.id,
    source: {
      kind: "platform_operator" as const,
      source: "ops" as const,
      operatorId: request.operatorId,
      reason: request.reason,
      reference: request.reference
    }
  };
  const result = request.action === "start"
    ? platformAgentManagement.startAgent(operation)
    : request.action === "restart"
      ? platformAgentManagement.restartAgent(operation)
      : platformAgentManagement.resetAgent(operation);
  const ok = result.status === "completed" || result.status === "noop";
  return {
    ok,
    requestId: request.requestId,
    ...(ok ? {} : { error: result.errorCode ?? result.status }),
    result: {
      action: result.action,
      status: result.status,
      errorCode: result.errorCode ?? null,
      agentId: agent.id,
      machineId: machine.id,
      desiredRuntimeState: store.getAgent(agent.id)?.desiredRuntimeState ?? null,
      stopSent: result.stopSent ?? null,
      sessionCleared: result.sessionCleared ?? false,
      startSent: result.startSent ?? null
    }
  };
}

const platformOpsSocketPath = process.env.TYR_PLATFORM_OPS_SOCKET?.trim();
function inspectDeploymentActivity() {
  return deploymentActivity.inspect(() => ({
    ...deploymentWorkCounts(store),
    ...deploymentBrowserCounts(realtimeClients.values()),
    syncConnections: syncClients.size,
    resultPresentations: communicationReturnPresentationInFlight.size,
    externalReturns: workspaceBridgeExternalReturnsInFlight.size,
    returnTimers: communicationReturnFailureTimers.size + workspaceBridgeExternalReturnTimers.size,
    runtimeQueries: workspaceTreeRequests.size + workspaceReadRequests.size + skillRequests.size + runtimeModelRequests.size
  }));
}
// Observations are process-local, never inferred from a stale database snapshot after restart.
setInterval(inspectDeploymentActivity, 5_000).unref();
if (platformOpsSocketPath) {
  await listenPlatformOpsSocket({ socketPath: platformOpsSocketPath, handle: handlePlatformOperation });
}

function rejectUpgrade(
  socket: import("node:stream").Duplex,
  status: number,
  message: string,
  headers: Record<string, string> = {}
): void {
  socket.write([
    `HTTP/1.1 ${status} ${message}`,
    "Connection: close",
    "Content-Length: 0",
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    "",
    ""
  ].join("\r\n"));
  socket.destroy();
}

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", publicServerUrl);
  if (url.pathname === "/socket.io/" || url.pathname === "/socket.io") {
    realtimeWss.handleUpgrade(req, socket, head, (ws) => {
      realtimeWss.emit("connection", ws, req);
    });
    return;
  }
  if (url.pathname === "/device/connect") {
    const pairingToken = url.searchParams.get("pairingToken") || "";
    const deviceToken = url.searchParams.get("token") || "";
    const device = deviceToken ? store.getDeviceByToken(deviceToken) : null;
    if (!pairingToken && !device) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    deviceWss.handleUpgrade(req, socket, head, (ws) => {
      deviceWss.emit("connection", ws, req, { pairingToken, device });
    });
    return;
  }
  if (url.pathname !== "/daemon/connect") {
    rejectUpgrade(socket, 404, "Not Found");
    return;
  }
  const credential = resolveDaemonUpgradeCredential({
    headers: req.headers,
    requestUrl: req.url ?? "/",
    baseUrl: publicServerUrl
  });
  if (!credential.ok) {
    // 认证日志只记录通道与结果，不记录 URL、query 或 bearer 值。
    const totals = daemonSecurityMetrics.recordAuth(credential.transport, "rejected");
    console.log(`[metrics] daemon_auth_transport_total transport=${credential.transport} value=${totals.transportTotal} daemon_auth_result_total result=rejected value=${totals.resultTotal}`);
    console.warn(`[server] daemon authorization rejected transport=${credential.transport} reason=${credential.reason}`);
    rejectUpgrade(socket, 401, "Unauthorized", { "X-TYR-Daemon-Auth": "bearer-v1" });
    return;
  }
  const machine = store.getMachineByKey(credential.credential);
  if (!machine) {
    const totals = daemonSecurityMetrics.recordAuth(credential.transport, "rejected");
    console.log(`[metrics] daemon_auth_transport_total transport=${credential.transport} value=${totals.transportTotal} daemon_auth_result_total result=rejected value=${totals.resultTotal}`);
    console.warn(`[server] daemon authorization rejected transport=${credential.transport} reason=unknown_credential`);
    rejectUpgrade(socket, 401, "Unauthorized", { "X-TYR-Daemon-Auth": "bearer-v1" });
    return;
  }
  const totals = daemonSecurityMetrics.recordAuth(credential.transport, "accepted");
  console.log(`[metrics] daemon_auth_transport_total transport=${credential.transport} value=${totals.transportTotal} daemon_auth_result_total result=accepted value=${totals.resultTotal} machine=${machine.id}`);
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, machine);
  });
});

deviceWss.on("connection", (ws: WebSocket, _req: IncomingMessage, auth: { pairingToken?: string; device?: ReturnType<typeof store.getDeviceByToken> }) => {
  let currentDevice = auth.device ?? null;
  if (currentDevice) deviceSockets.set(currentDevice.id, ws);

  ws.on("message", (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      ws.close();
      return;
    }
    if (msg.type === "device:ready") {
      if (!currentDevice) {
        const paired = store.connectDeviceWithPairingToken({
          pairingToken: auth.pairingToken ?? "",
          displayName: String(msg.displayName || "Mobile Device"),
          deviceKind: msg.deviceKind === "iot" ? "iot" : "mobile",
          platform: ["android", "ios", "web", "embedded"].includes(msg.platform) ? msg.platform : "web",
          appVersion: String(msg.appVersion || "0.1.0"),
          capabilities: deviceCapabilityIds(msg.capabilities),
          capabilityDescriptors: deviceCapabilityDescriptors(msg.capabilityDescriptors),
          permissionStates: typeof msg.permissionStates === "object" && msg.permissionStates ? msg.permissionStates : {}
        });
        if (!paired) {
          ws.send(JSON.stringify({ type: "device:error", error: "pairing_invalid" }));
          ws.close();
          return;
        }
        currentDevice = paired.device;
        deviceSockets.set(currentDevice.id, ws);
        ws.send(JSON.stringify({ type: "device:ready_ack", deviceId: currentDevice.id, deviceToken: paired.deviceToken, displayName: currentDevice.displayName }));
      } else {
        deviceSockets.set(currentDevice.id, ws);
        currentDevice = store.updateDeviceConnectionStatus(currentDevice.id, "online") ?? currentDevice;
        ws.send(JSON.stringify({ type: "device:ready_ack", deviceId: currentDevice.id, displayName: currentDevice.displayName }));
      }
      publishWorkspaceSync();
      return;
    }
    if (msg.type === "device:command_ack") {
      const commandId = typeof msg.commandId === "string" ? msg.commandId : "";
      if (!currentDevice || !markDeviceCommandRunning(routeContext, commandId, currentDevice.id)) {
        ws.send(JSON.stringify({ type: "device:error", error: "command_not_found" }));
        return;
      }
      ws.send(JSON.stringify({ type: "device:command_ack_ack", commandId }));
      return;
    }
    if (msg.type === "device:command_result") {
      const command = typeof msg.commandId === "string" ? store.getDeviceCommand(msg.commandId) : null;
      if (!command || !currentDevice || command.deviceId !== currentDevice.id) {
        ws.send(JSON.stringify({ type: "device:error", error: "command_not_found" }));
        return;
      }
      const rawData = typeof msg.data === "object" && msg.data ? msg.data as Record<string, unknown> : undefined;
      const materialized = materializeDeviceCommandResultArtifacts({
        store,
        command,
        uploadDir,
        rawData,
        artifactIds: Array.isArray(msg.artifactIds) ? msg.artifactIds.map(String) : []
      });
      completeDeviceCommandWithResult(routeContext, command, {
        status: msg.status === "denied" || msg.status === "failed" || msg.status === "expired" ? msg.status : "succeeded",
        artifactIds: materialized.artifactIds.length ? materialized.artifactIds : undefined,
        data: materialized.data,
        errorCode: typeof msg.errorCode === "string" ? msg.errorCode : undefined,
        errorMessage: typeof msg.errorMessage === "string" ? msg.errorMessage : undefined
      });
      ws.send(JSON.stringify({ type: "device:command_result_ack", commandId: command.id }));
      return;
    }
    if (msg.type === "pong") return;
  });

  ws.on("close", () => {
    if (currentDevice && deviceSockets.get(currentDevice.id) === ws) {
      deviceSockets.delete(currentDevice.id);
      store.updateDeviceConnectionStatus(currentDevice.id, "offline");
      publishWorkspaceSync();
    }
  });
});

realtimeWss.on("connection", (ws: WebSocket) => {
  deploymentActivity.touch();
  const client: RealtimeClient = {
    id: randomUUID(),
    ws,
    joinedChannels: new Set()
  };
  realtimeClients.set(ws, client);
  ws.send(`0${JSON.stringify({ sid: client.id, upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1000000 })}`);
  client.pingTimer = setInterval(() => {
    if (ws.readyState === 1) ws.send("2");
  }, 25_000);

  ws.on("message", (raw) => {
    const text = String(raw);
    if (text === "3") return;
    if (text === "2") {
      ws.send("3");
      return;
    }
    if (text === "41") {
      ws.close();
      return;
    }
    if (text.startsWith("40")) {
      const payloadText = text.slice(2).trim();
      let payload: { token?: string; serverId?: string } = {};
      if (payloadText) {
        try {
          payload = JSON.parse(payloadText) as typeof payload;
        } catch {
          ws.close();
          return;
        }
      }
      const user = payload.token ? store.getUserByAccessToken(payload.token) : null;
      if (!user) {
        ws.close();
        return;
      }
      client.userId = user.id;
      client.serverId = payload.serverId;
      ws.send(`40${JSON.stringify({ sid: client.id })}`);
      sendRealtime(client, "heartbeat", { seq: realtimeBuffer.currentSeq, ts: Date.now() });
      sendRealtime(client, "rooms:joined", { serverId: client.serverId ?? null, channelIds: [] });
      return;
    }
    if (!text.startsWith("42")) return;
    let packet: unknown;
    try {
      packet = JSON.parse(text.slice(2));
    } catch {
      return;
    }
    if (!Array.isArray(packet) || typeof packet[0] !== "string") return;
    const [event, payload] = packet as [string, unknown];
    if (event === "deployment:presence") {
      if (!client.userId || !payload || typeof payload !== "object" || typeof (payload as { visible?: unknown }).visible !== "boolean") return;
      const visible = (payload as { visible: boolean }).visible;
      if (visible || client.deploymentPresence?.visible !== visible) deploymentActivity.touch();
      client.deploymentPresence = { visible, updatedAt: Date.now() };
      return;
    }
    if (event === "sync:resume") {
      const afterSeq = realtimeResumeCursor(payload);
      const response = realtimeBuffer.since(afterSeq, (item) => clientCanReceiveRealtime(client, item));
      sendRealtime(client, "sync:resume:response", response);
      return;
    }
    if (event === "join:channel" && typeof payload === "string") {
      // Socket room names reuse the storage term "channel", but only an accessible DM/thread may be joined.
      if (!client.userId || !store.canUserAccessChannel(client.userId, payload)) return;
      client.joinedChannels.add(payload);
      sendRealtime(client, "rooms:joined", { channelIds: Array.from(client.joinedChannels), joinedChannelId: payload });
      sendRealtime(client, "channel:joined", { channelId: payload });
    }
    if (event === "leave:channel" && typeof payload === "string") {
      if (!client.userId || !store.canUserAccessChannel(client.userId, payload)) return;
      client.joinedChannels.delete(payload);
      sendRealtime(client, "channel:left", { channelId: payload });
    }
  });

  ws.on("close", () => {
    deploymentActivity.touch();
    if (client.pingTimer) clearInterval(client.pingTimer);
    realtimeClients.delete(ws);
  });
});

wss.on("connection", (ws: WebSocket, _req: IncomingMessage, machine: MachineRecord) => {
  const connection = daemonConnections.register(machine.id, ws);
  daemonSockets.set(machine.id, ws);
  console.log(`[server] daemon connected machine=${machine.name} ${machine.id} connection=${connection.id}`);
  let heartbeatTimer: NodeJS.Timeout | null = null;
  const markConnectionOffline = (reason: "close" | "timeout" | "closed") => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (!daemonConnections.remove(connection)) {
      console.log(`[server] stale daemon disconnected machine=${machine.name} ${machine.id} connection=${connection.id}`);
      return;
    }
    if (daemonSockets.get(machine.id) === ws) daemonSockets.delete(machine.id);
    store.markMachineOffline(machine.id);
    for (const agent of store.listAgents()) {
      if (agent.machineId === machine.id) {
        deliveryInFlight.releaseAgent(agent.id);
        agentStartRequests.release(agent.id);
      }
    }
    emitRealtimeMachineUpdated(machine.id);
    publishWorkspaceSync();
    console.log(`[server] daemon disconnected machine=${machine.name} ${machine.id} connection=${connection.id} reason=${reason}`);
  };
  heartbeatTimer = setInterval(() => {
    const result = daemonConnections.heartbeat(connection);
    if (result === "stale") {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (result === "closed" || result === "timeout") markConnectionOffline(result);
  }, DAEMON_HEARTBEAT_INTERVAL_MS);
  ws.on("message", (raw) => {
    if (!daemonConnections.isCurrent(connection)) return;
    let msg: DaemonOutbound;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    daemonMessageQueue.enqueue({
      connection: { machine, connection },
      message: msg
    });
  });
  ws.on("close", () => {
    markConnectionOffline("close");
  });
});

async function handleDaemonMessage(machine: MachineRecord, msg: DaemonOutbound, connection: DaemonConnection): Promise<void> {
  let changed = false;
  switch (msg.type) {
    case "machine:connector_token_ack": {
      if (msg.machineId !== machine.id) {
        console.warn(`[server] daemon connector token ACK rejected machine=${machine.id} reason=machine_mismatch`);
        break;
      }
      const acknowledged = store.acknowledgeMachineConnectorTokenRotation(machine.id, msg.rotationId);
      if (!acknowledged) {
        console.warn(`[server] daemon connector token ACK rejected machine=${machine.id} reason=unknown_or_expired`);
        break;
      }
      // persistedAt 仅作 daemon 观测信息；切换时间与宽限期一律使用 server 时间。
      console.log(`[server] daemon connector token ACK machine=${machine.id} rotation=${acknowledged.rotationId} state=${acknowledged.state}`);
      recordConnectorRotationState("acked", machine.id);
      if (acknowledged.state === "promoted") recordConnectorRotationState("promoted", machine.id);
      emitRealtimeMachineUpdated(machine.id);
      changed = acknowledged.state === "promoted";
      break;
    }
    case "ready": {
      const identity = store.bindMachineInstallation(machine.id, {
        installationId: msg.installationId,
        hostFingerprint: msg.hostFingerprint
      });
      if (!identity) return;
      if (!identity.success) {
        // installationId 绑定到 daemon data-dir；不匹配时说明当前 token 被另一个安装实例复用，不能把原 Computer 标为 online。
        console.warn(
          `[server] daemon ready rejected machine=${machine.name} ${machine.id}; installation mismatch current=${identity.currentInstallationId} received=${identity.receivedInstallationId}`
        );
        connection.ws.close();
        return;
      }
      // capability 只属于通过 installation 校验的当前连接，拒绝的 daemon 不能短暂打开 P1 调度路径。
      daemonConnections.noteCapabilities(connection, msg.capabilities);
      const updated = store.updateMachineReady(machine.id, {
        hostname: msg.hostname,
        os: msg.os,
        daemonVersion: msg.daemonVersion,
        runtimes: msg.runtimes,
        runtimeVersions: msg.runtimeVersions,
        runtimeReports: msg.runtimeReports,
        runtimeMarker: msg.runtimeMarker,
        runtimeSha: msg.runtimeSha,
        runtimeMarkerMtime: msg.runtimeMarkerMtime
      });
      emitRealtimeMachineUpdated(updated.id);
      console.log(`[server] daemon ready machine=${updated.name} runtimes=${msg.runtimes.join(",") || "none"}`);
      const pendingRotation = msg.capabilities.includes("machine:connector-token-ack")
        ? store.getPendingMachineConnectorTokenRotation(machine.id)
        : null;
      const connector = pendingRotation ?? store.issueMachineConnectorToken(machine.id);
      if (connector) {
        sendToDaemon(machine.id, {
          type: "machine:connector_token",
          machineId: machine.id,
          connectorToken: connector.connectorToken,
          ...(pendingRotation ? { rotationId: pendingRotation.rotationId, ackRequired: true } : {})
        });
      }
      const running = new Set(msg.runningAgents);
      const machineAgents = store.listAgents().filter((item) => item.machineId === machine.id);
      const runtimeAccessBlockedAgentIds = new Set<string>();
      for (const agent of machineAgents) {
        const runtimeAccessError = runtimeAccessErrorForAgent(agent, updated);
        if (!runtimeAccessError) continue;
        runtimeAccessBlockedAgentIds.add(agent.id);
        sendToDaemon(machine.id, { type: "agent:stop", agentId: agent.id });
        store.updateAgentStatus(agent.id, "error", runtimeAccessErrorDetail(runtimeAccessError));
        emitRealtimeAgentStatus(agent.id);
      }
      const reconciledAgentIds = new Set<string>();
      for (const state of msg.agentStates ?? []) {
        if (runtimeAccessBlockedAgentIds.has(state.agentId)) continue;
        const desiredAgent = store.getAgent(state.agentId);
        if (desiredAgent?.desiredRuntimeState !== "running") {
          // daemon 报告了不再期望运行的旧进程时，立即收敛，避免一次失败的 Stop 在重连后复活。
          sendToDaemon(machine.id, { type: "agent:stop", agentId: state.agentId });
          store.updateAgentStatus(state.agentId, "offline", "Stopped to honor the saved Agent state.");
          reconciledAgentIds.add(state.agentId);
          continue;
        }
        if (desiredAgent) {
          if (state.profileRevision !== undefined) {
            store.updateAgentProfileApplication(state.agentId, { profileRevision: state.profileRevision });
          }
          const latestDesiredAgent = store.getAgent(state.agentId) ?? desiredAgent;
          if (restartUnconfirmedAgentProfileSnapshot(latestDesiredAgent, connection, true)) {
            reconciledAgentIds.add(state.agentId);
            continue;
          }
        }
        if (applyDaemonAgentActivity(updated, state, { snapshot: true })) reconciledAgentIds.add(state.agentId);
        const stateAgent = store.getAgent(state.agentId);
        const replacement = stateAgent?.runtime && runtimeContextSessionsEnabled(stateAgent.runtime, undefined, stateAgent.id) && daemonConnections.supports(machine.id, "agent:context-session")
          ? replacementForDaemonContextSnapshot(store, machine.id, state)
          : null;
        if (replacement) sendToDaemon(machine.id, replacement);
      }
      let shouldDrainPending = false;
      for (const agent of machineAgents) {
        if (runtimeAccessBlockedAgentIds.has(agent.id)) continue;
        const hasPendingInbox = store.hasPendingAgentInbox(agent.id);
        if (reconciledAgentIds.has(agent.id)) {
          if (shouldDrainPendingAfterDaemonReady(agent, running, hasPendingInbox)) shouldDrainPending = true;
          continue;
        }
        // 更旧的 daemon 可能只上报 runningAgents，完全没有 agentStates；服务端仍要为未确认 Profile 换新上下文。
        if (running.has(agent.id) && restartUnconfirmedAgentProfileSnapshot(store.getAgent(agent.id) ?? agent, connection, true)) {
          continue;
        }
        const plan = readyRecoveryPlan(agent, running, hasPendingInbox);
        if (plan === "mark_online") {
          agentStartRequests.release(agent.id);
          store.updateAgentStatus(agent.id, "online");
          if (shouldDrainPendingAfterDaemonReady(agent, running, hasPendingInbox)) shouldDrainPending = true;
          continue;
        }
        if (plan === "start_desired") {
          const restored = startAgent(agent);
          if (restored) {
            store.recordActivity(agent.id, "resume", "Restoring the Agent after daemon reconnect.");
            continue;
          }
        }
        if (plan === "stop_unwanted") {
          sendToDaemon(machine.id, { type: "agent:stop", agentId: agent.id });
          store.updateAgentStatus(agent.id, "offline", "Stopped to honor the saved Agent state.");
          continue;
        }
        if (plan === "keep_error") continue;
        store.updateAgentStatus(agent.id, "offline");
      }
      for (const agent of machineAgents) {
        sendReminderSnapshot(agent);
        syncAgentSharedFiles(agent.id);
      }
      if (shouldDrainPending) setTimeout(() => deliverPendingToOnlineAgents(), 0);
      changed = true;
      break;
    }
    case "agent:status":
      if (!applyDaemonAgentStatus(machine, msg)) break;
      if (shouldReleaseInFlightForAgentSignal(msg)) deliveryInFlight.releaseAgent(msg.agentId);
      changed = true;
      if (msg.status === "active") {
        const agent = store.getAgent(msg.agentId);
        if (agent) sendReminderSnapshot(agent);
        setTimeout(() => deliverPendingToOnlineAgents(), 0);
      }
      break;
    case "agent:activity":
      {
        const wasWorking = store.getAgent(msg.agentId)?.status === "working";
        const recoveredBridgePublishFailure = msg.activity === "error" && isRecoveredWorkspaceBridgeFinalPublishFailure(msg.agentId, msg.detail);
        const activity = recoveredBridgePublishFailure ? "online" : msg.activity;
        const detail = recoveredBridgePublishFailure ? "Bridge final reply recovered after daemon publish failure." : msg.detail;
        const accepted = applyDaemonAgentActivity(machine, { ...msg, activity, detail }, { snapshot: false });
        if (!accepted) break;
        if (msg.activity === "error" && !recoveredBridgePublishFailure) {
          applyRuntimeAuthHealthUpdate(runtimeAuthHealthFromError(store.getAgent(msg.agentId), msg.detail));
        }
        if (shouldReleaseInFlightForAgentSignal(msg)) deliveryInFlight.releaseAgent(msg.agentId);
        changed = true;
        if (activity === "online") {
          setTimeout(() => {
            // 只有 Working -> Online 才代表安全 turn 边界；启动阶段的 Online 不能抢在 Profile ACK 前触发第二次启动。
            if (!wasWorking || !restartPendingAgentProfile(msg.agentId, connection)) deliverPendingToOnlineAgents();
          }, 0);
        }
      }
      break;
    case "agent:profile_applied": {
      const agent = daemonAgentForMachine(machine, msg.agentId);
      if (!agent || (msg.launchId && agent.launchId && msg.launchId !== agent.launchId)) break;
      const previousAppliedRevision = agent.profileAppliedRevision ?? 0;
      const previousApplyError = agent.profileApplyError;
      const updatedAgent = store.updateAgentProfileApplication(agent.id, { profileRevision: msg.profileRevision });
      if (updatedAgent && (msg.profileRevision > previousAppliedRevision || previousApplyError)) {
        store.recordActivity(agent.id, "profile", `Agent Profile Prompt revision ${msg.profileRevision} applied by Runtime.`);
      }
      console.log(`[server] agent profile applied agent=${agent.id} revision=${msg.profileRevision} launch=${msg.launchId ?? "missing"}`);
      emitAgentNavigationRealtimeEvent(broadcastRealtime, "agent:updated", {
        agentId: agent.id,
        machineId: agent.machineId,
        serverId: agent.serverId ?? machine.serverId ?? "local"
      });
      changed = true;
      break;
    }
    case "agent:profile_apply_failed": {
      const agent = daemonAgentForMachine(machine, msg.agentId);
      if (!agent || (msg.launchId && agent.launchId && msg.launchId !== agent.launchId)) break;
      const previousApplyError = agent.profileApplyError;
      const updatedAgent = store.updateAgentProfileApplication(agent.id, { profileRevision: msg.profileRevision, error: msg.error });
      if (updatedAgent?.profileApplyError === msg.error && previousApplyError !== msg.error) {
        store.recordActivity(agent.id, "profile", `Agent Profile Prompt revision ${msg.profileRevision} failed: ${msg.error.slice(0, 1000)}`);
      }
      console.log(`[server] agent profile apply failed agent=${agent.id} revision=${msg.profileRevision} launch=${msg.launchId ?? "missing"} error=${JSON.stringify(msg.error.slice(0, 1000))}`);
      emitAgentNavigationRealtimeEvent(broadcastRealtime, "agent:updated", {
        agentId: agent.id,
        machineId: agent.machineId,
        serverId: agent.serverId ?? machine.serverId ?? "local"
      });
      changed = true;
      break;
    }
    case "agent:state_snapshot":
      for (const state of msg.agents) {
        if (state.activeExecutionId) {
          logRuntimeDeliveryAcknowledgement(
            acknowledgeRuntimeDeliveryForExecution(store, deliveryInFlight, { agentId: state.agentId, executionId: state.activeExecutionId }),
            "state_snapshot"
          );
        }
        const desiredAgent = store.getAgent(state.agentId);
        if (desiredAgent?.desiredRuntimeState === "running") {
          if (state.profileRevision !== undefined) {
            store.updateAgentProfileApplication(state.agentId, { profileRevision: state.profileRevision });
          }
          const latestDesiredAgent = store.getAgent(state.agentId) ?? desiredAgent;
          if (restartUnconfirmedAgentProfileSnapshot(latestDesiredAgent, connection)) {
            changed = true;
            continue;
          }
        }
        if (applyDaemonAgentActivity(machine, state, { snapshot: true })) changed = true;
      }
      break;
    case "agent:session":
      {
        const agent = daemonAgentForMachine(machine, msg.agentId);
        if (!agent) break;
        const decision = agentStateEvents.acceptSession(msg.agentId, msg.launchId);
        if (!decision.accepted) {
          logRejectedAgentState(msg, decision, "agent:session");
          break;
        }
        agentStartRequests.release(msg.agentId);
        store.updateAgentSession(msg.agentId, msg.sessionId, msg.launchId ?? agent.launchId, msg.workspacePath);
      }
      changed = true;
      break;
    case "agent:context_session": {
      logRuntimeDeliveryAcknowledgement(
        acknowledgeRuntimeDeliveryForExecution(store, deliveryInFlight, { agentId: msg.agentId, executionId: msg.executionId }),
        "context_session"
      );
      const result = applyDaemonContextSessionEvent(store, machine.id, msg);
      if (!result.accepted) {
        console.warn(`[server] rejected Runtime context Session event machine=${machine.id} agent=${msg.agentId} execution=${msg.executionId}`);
        if (result.event) emitRealtimeRuntimeExecution(result.execution ?? null, result.event);
        break;
      }
      emitRealtimeRuntimeExecution(result.execution ?? null, result.event);
      if (result.execution?.status === "failed" || result.execution?.status === "stalled") {
        publishTerminalCommunicationFailure(result.execution);
      }
      if (result.replacement) sendToDaemon(machine.id, result.replacement);
      changed = true;
      break;
    }
    case "agent:deliver:ack":
      if (msg.deliveryId) {
        const messageId = messageIdFromDeliveryId(msg.agentId, msg.deliveryId);
        if (messageId) {
          logRuntimeDeliveryAcknowledgement(
            acknowledgeRuntimeDelivery(store, deliveryInFlight, { agentId: msg.agentId, messageId }),
            "daemon_ack"
          );
        }
      }
      break;
    case "agent:delegate": {
      const result = handleAgentDelegateFromDaemon(routeContext, machine, msg);
      changed = result.ok;
      break;
    }
    case "agent:shared_file:update": {
      const agent = daemonAgentForMachine(machine, msg.agentId);
      if (!agent) break;
      try {
        const contents = Buffer.from(msg.contentBase64, "base64");
        if (contents.byteLength !== msg.sizeBytes || contents.byteLength > 50 * 1024 * 1024) {
          throw new WorkspaceSharedFileError("workspace_shared_file_size_mismatch", 400);
        }
        const updated = workspaceSharedFiles.acceptAgentUpdate({
          agentId: agent.id,
          fileId: msg.fileId,
          baseVersion: msg.baseVersion,
          name: msg.name,
          mimeType: msg.mimeType,
          contents,
          sha256: msg.sha256
        });
        store.recordAuditEvent({
          kind: "workspace_shared_file_agent_write",
          actorType: "agent",
          actorId: agent.id,
          resourceType: "workspace_shared_file",
          resourceId: updated.id,
          serverId: updated.serverId,
          metadata: { version: updated.version, executionId: msg.executionId ?? null }
        });
        changed = true;
      } catch (error) {
        const code = error instanceof WorkspaceSharedFileError ? error.code : error instanceof Error ? error.message : String(error);
        store.recordAuditEvent({
          kind: "workspace_shared_file_agent_write_rejected",
          actorType: "agent",
          actorId: agent.id,
          resourceType: "workspace_shared_file",
          resourceId: msg.fileId,
          serverId: machine.serverId,
          metadata: { code, baseVersion: msg.baseVersion, executionId: msg.executionId ?? null }
        });
        // 冲突或权限变化后立即回推服务端真源，覆盖 daemon 的旧快照基线。
        syncAgentSharedFiles(agent.id);
      }
      break;
    }
    case "agent:runtime_event": {
      const execution = store.getRuntimeExecution(msg.event.executionId);
      if (!execution || !acceptsDaemonRuntimeEvent(machine, execution, msg.event)) break;
      logRuntimeDeliveryAcknowledgement(
        acknowledgeRuntimeDeliveryForExecution(store, deliveryInFlight, {
          agentId: msg.event.agentId,
          executionId: msg.event.executionId
        }),
        `runtime_event:${msg.event.kind}`
      );
      if (shouldIgnoreRuntimeEventForExecution(execution)) {
        assistantOutputCoalescer.clear(execution.id);
        runtimeWorkspaceSyncPublisher.schedule();
        break;
      }
      if (msg.event.kind === "error" && applyRuntimeAuthHealthUpdate(runtimeAuthHealthFromError(store.getAgent(msg.event.agentId), msg.event.detail))) {
        changed = true;
      }
      const eventAt = msg.event.at ?? new Date().toISOString();
      if (msg.event.kind === "assistant_delta") {
        assistantOutputCoalescer.acceptDelta(execution, {
          id: `live:${execution.id}:${eventAt}`,
          executionId: execution.id,
          agentId: msg.event.agentId,
          taskId: msg.event.taskId ?? execution.taskId,
          kind: "assistant_delta",
          sequence: 0,
          title: msg.event.title ?? null,
          detail: msg.event.detail ?? null,
          payload: msg.event.payload,
          at: eventAt
        });
        break;
      }
      assistantOutputCoalescer.flush(execution, {
        at: eventAt,
        status: assistantFlushStatusForRuntimeEvent(msg.event.kind),
        clear: true,
        force: msg.event.kind === "turn_completed" || msg.event.kind === "error"
      });
      if (msg.event.kind === "thinking" && isBoilerplateRuntimeThinking(msg.event.detail)) break;
      if (msg.event.kind === "approval_resolved" && hasRecordedApprovalResolvedEvent(store.listRuntimeExecutionEvents(execution.id), msg.event.payload)) {
        const updated = execution.status === "waiting_approval"
          ? store.updateRuntimeExecutionStatus(execution.id, "running")
          : store.getRuntimeExecution(execution.id);
        emitRealtimeRuntimeExecution(updated);
        runtimeWorkspaceSyncPublisher.schedule();
        break;
      }
      const event = store.appendRuntimeExecutionEvent({
        executionId: execution.id,
        agentId: msg.event.agentId,
        taskId: msg.event.taskId ?? execution.taskId,
        kind: msg.event.kind,
        title: msg.event.title ?? null,
        detail: msg.event.detail ?? null,
        payload: msg.event.payload,
        at: eventAt
      });
      const pendingOutboundAfterTurn = msg.event.kind === "turn_completed" && hasPendingQueuedOutboundApproval(
        store.listRuntimeApprovals({ executionId: execution.id, limit: 1000 })
      );
      // Runtime 可以结束生成，但已持久化的 outbound action 必须继续等待人工决定，不能被 turn_completed 提前结案。
      const nextStatus = pendingOutboundAfterTurn ? "waiting_approval" : runtimeExecutionStatusForEvent(msg.event.kind);
      const updated = nextStatus ? store.updateRuntimeExecutionStatus(execution.id, nextStatus) : store.getRuntimeExecution(execution.id);
      emitRealtimeRuntimeExecution(updated, event);
      if (msg.event.kind === "turn_completed" || msg.event.kind === "error") assistantOutputCoalescer.clear(execution.id);
      if (updated && msg.event.kind === "turn_completed") {
        if (workspaceBridgeRefForExecution(updated)) workspaceBridgeFinalReplyRecovery.schedule(updated.id);
        scheduleCommunicationReturnFailure(store.getRuntimeExecution(updated.id) ?? updated);
      }
      if (updated && msg.event.kind === "error") {
        publishTerminalCommunicationFailure(updated);
      }
      if (updated && msg.event.kind === "turn_completed" && shouldTriggerSafetyAudit(msg.event.kind) && !workspaceBridgeRefForExecution(updated)) {
        void runSafetyAudit({
          store,
          config: safetyAuditConfig,
          trigger: "turn_completed",
          execution: updated,
          event,
          onUpdate: emitRealtimeSafetyAssessment
        });
      }
      runtimeWorkspaceSyncPublisher.schedule();
      break;
    }
    case "agent:runtime_approval:requested": {
      const approvalWithFallback = runtimeApprovalWithExecutionFallback(store, msg.approval);
      const existingExecution = approvalWithFallback.executionId ? store.getRuntimeExecution(approvalWithFallback.executionId) : null;
      if (existingExecution && shouldIgnoreRuntimeEventForExecution(existingExecution)) {
        runtimeWorkspaceSyncPublisher.schedule();
        break;
      }
      const bridgeRef = workspaceBridgeRefForExecution(existingExecution);
      const approvalForNormalization = {
        ...approvalWithFallback,
        serverId: machine.serverId,
        machineId: machine.id
      };
      const approvalAgent = store.getAgent(approvalWithFallback.agentId);
      // A Bridge grants routing only. Peer work follows the same local governance and owner approval path as any other execution.
      const normalized = await normalizeServerRuntimeApprovalWithGovernance({
        approval: approvalForNormalization,
        store,
        permissionMode: approvalAgent?.permissionMode,
        config: resolveEffectiveGovernanceRuntimeConfig({
          store,
          baseConfig: governanceConfig,
          serverId: machine.serverId,
          agentId: approvalWithFallback.agentId
        }).config
      });
      const heartbeatGrant = heartbeatSharedFileApprovalGrant({
        approval: normalized.approval,
        execution: existingExecution,
        agent: approvalAgent,
        runningRuns: store.listTyrHeartbeatRuns({ status: "running", limit: 1_000 }),
        assignments: approvalAgent ? store.listAgentSharedFiles(approvalAgent.id) : []
      });
      const effectiveNormalization = heartbeatGrant && !normalized.runtimeAccessBlocked && !normalized.autoRejected
        ? {
            ...normalized,
            approval: {
              ...normalized.approval,
              status: "approved" as const,
              decision: "approve" as const,
              resolvedAt: normalized.approval.resolvedAt ?? new Date().toISOString(),
              payload: {
                ...(normalized.approval.payload && typeof normalized.approval.payload === "object" && !Array.isArray(normalized.approval.payload)
                  ? normalized.approval.payload as Record<string, unknown>
                  : { value: normalized.approval.payload }),
                heartbeatPreauthorization: {
                  heartbeatId: heartbeatGrant.heartbeatId,
                  runId: heartbeatGrant.runId,
                  fileIds: heartbeatGrant.fileIds,
                  fileNames: heartbeatGrant.fileNames,
                  scope: "assigned_read_write_shared_file_updates"
                }
              }
            },
            autoResolved: true,
            autoRejected: false
          }
        : normalized;
      const application = runtimeApprovalGovernanceApplication(effectiveNormalization, existingExecution);
      if (application.approval.executionId) {
        const approvalExecution = store.getRuntimeExecution(application.approval.executionId);
        if (approvalExecution) {
          assistantOutputCoalescer.flush(approvalExecution, {
            at: application.approval.requestedAt,
            status: "running",
            clear: true
          });
        }
      }
      const existingApproval = store.getRuntimeApproval(application.approval.id);
      const approval = store.createRuntimeApproval(runtimeApprovalWithExternalNotificationState(application.approval, existingApproval));
      if (heartbeatGrant && application.approval.status === "approved") {
        // 预授权审计只记录文件与 run 标识，不保存 diff 或命令正文，避免把共享数据复制进审计日志。
        store.recordAuditEvent({
          kind: "tyr_heartbeat_shared_file_approval_auto_approved",
          actorType: "system",
          resourceType: "server",
          resourceId: machine.serverId,
          serverId: machine.serverId,
          metadata: {
            heartbeatId: heartbeatGrant.heartbeatId,
            runId: heartbeatGrant.runId,
            approvalId: approval.id,
            executionId: existingExecution?.id ?? null,
            agentId: approval.agentId,
            fileIds: heartbeatGrant.fileIds,
            fileNames: heartbeatGrant.fileNames
          }
        });
      }
      if (application.daemonResolve) sendToDaemon(machine.id, application.daemonResolve);
      emitRealtimeRuntimeApproval(approval);
      notifyPendingRuntimeApprovalExternalAsync(approval);
      if (effectiveNormalization.governanceDecision) emitRealtimeGovernanceDecision(effectiveNormalization.governanceDecision);
      const activityText = runtimeApprovalActivityText(approval);
      store.recordActivity(approval.agentId, "approval", activityText);
      emitRealtimeAgentActivity(approval.agentId, "working", activityText, [{ kind: "approval", status: approval.status, detail: approval.detail }]);
      if (approval.executionId) {
        const approvalEvent = runtimeApprovalExecutionEvent(approval, effectiveNormalization.classification);
        const event = store.appendRuntimeExecutionEvent({
          executionId: approval.executionId,
          agentId: approval.agentId,
          taskId: approval.taskId,
          kind: approvalEvent.kind,
          title: approvalEvent.title,
          detail: approvalEvent.detail,
          payload: approvalEvent.payload
        });
        const updated = store.updateRuntimeExecutionStatus(approval.executionId, approvalEvent.executionStatus);
        emitRealtimeRuntimeExecution(updated, event);
        if (updated && !bridgeRef) {
          void runSafetyAudit({
            store,
            config: safetyAuditConfig,
            trigger: "approval_request",
            execution: updated,
            approval,
            event,
            onUpdate: emitRealtimeSafetyAssessment
          });
        }
      }
      runtimeWorkspaceSyncPublisher.schedule();
      break;
    }
    case "agent:runtime_approval:resolved": {
      const currentApproval = store.getRuntimeApproval(msg.approvalId);
      const resolvedApproval = currentApproval?.status === "pending"
        ? store.resolveRuntimeApproval(msg.approvalId, msg.decision, currentApproval.resolvedByUserId ?? "daemon", msg.customResponse)
        : currentApproval;
      if (resolvedApproval && resolvedApproval !== currentApproval) emitRealtimeRuntimeApproval(resolvedApproval);
      if (resolvedApproval?.executionId) {
        const execution = store.getRuntimeExecution(resolvedApproval.executionId);
        if (execution && shouldIgnoreRuntimeEventForExecution(execution)) {
          runtimeWorkspaceSyncPublisher.schedule();
          break;
        }
        if (execution?.status === "waiting_approval") {
          const nextStatus = msg.decision === "reject" ? "failed" : "running";
          emitRealtimeRuntimeExecution(store.updateRuntimeExecutionStatus(execution.id, nextStatus));
        }
      }
      runtimeWorkspaceSyncPublisher.schedule();
      break;
    }
    case "agent:workspace:file_tree": {
      const pending = msg.requestId ? workspaceTreeRequests.get(msg.requestId) : undefined;
      if (pending) {
        workspaceTreeRequests.delete(msg.requestId!);
        pending.resolve({ dirPath: msg.dirPath, files: msg.files });
      }
      break;
    }
    case "agent:workspace:file_content": {
      const pending = msg.requestId ? workspaceReadRequests.get(msg.requestId) : undefined;
      if (pending) {
        workspaceReadRequests.delete(msg.requestId!);
        pending.resolve({
          content: msg.content,
          binary: msg.binary,
          size: msg.size,
          mimeType: msg.mimeType,
          encoding: msg.encoding
        });
      }
      break;
    }
    case "agent:skills:list_result": {
      const pending = msg.requestId ? skillRequests.get(msg.requestId) : undefined;
      if (pending) {
        skillRequests.delete(msg.requestId!);
        pending.resolve({ global: msg.global, runtime: msg.runtime, workspace: msg.workspace });
      }
      break;
    }
    case "machine:runtime_models:result": {
      const pending = msg.requestId ? runtimeModelRequests.get(msg.requestId) : undefined;
      if (pending) {
        runtimeModelRequests.delete(msg.requestId);
        if (msg.models?.length) store.updateRuntimeModels(pending.machineId, pending.runtime, msg.models, msg.default);
        pending.resolve({ models: msg.models, default: msg.default, error: msg.error });
        changed = Boolean(msg.models?.length);
      }
      break;
    }
    case "reminder.fire_attempt": {
      const result = store.fireReminder(msg.agentId, msg.reminderId, msg.version, msg.firedAtClient);
      const agent = store.getAgent(msg.agentId);
      if (agent && result.reminder) {
        if (result.rescheduled) sendReminderUpsert(agent, formatReminder(result.reminder));
        // 系统提醒进入 owner 与 Agent 的固定 DM，不创建 requester-less 的伪私聊。
        const dm = store.getOrCreateAgentDm(agent.id, agent.ownerUserId);
        if (dm) {
          const sent = store.sendMessage({
            target: dm.id,
            content: `Reminder fired: ${result.reminder.title}`,
            senderType: "system",
            senderId: "system",
            senderName: "TYR",
            serverId: dm.serverId
          }).message;
          // Reminder 也是 conversation 内的真实 turn，必须先创建 execution，避免 P1 host 把无 context wake 写入当前任意 Session。
          const execution = createQueuedMessageRuntimeExecutionForAgent(store, {
            message: sent,
            agent,
            detail: `Queued reminder delivery for @${agent.name}.`
          });
          if (execution) {
            emitRealtimeRuntimeExecution(execution);
            // Reminder 也是定向 Agent turn；daemon 在线但 runtime 离线时应自动恢复，而不是永久停在 queued。
            dispatchQueuedAgentInbox(agent.id, `Queued reminder delivery for @${agent.name}.`, execution.id);
          }
          emitRealtimeMessage(sent);
        }
      }
      changed = Boolean(result.fired);
      break;
    }
    case "pong":
      handleDaemonPongRecovery({
        notePong: () => daemonConnections.notePong(connection),
        touchMachineLastSeen: () => store.touchMachineLastSeen(machine.id),
        closeConnection: () => connection.ws.close(),
        onReconnectRequired: () => console.warn(`[server] daemon pong found offline machine=${machine.name} ${machine.id}; reconnecting to resync ready state`)
      });
      break;
  }
  if (changed) publishWorkspaceSync();
}

function formatInternalMessage(message: MessageRecord, recipientAgentId?: string) {
  const dmPeerAgent = dmPeerAgentForRuntime(message, recipientAgentId);
  return {
    message_id: message.id,
    channel_id: message.channelId,
    conversation_id: message.conversationId,
    conversationId: message.conversationId,
    conversation_title: message.conversationId ? store.getConversation(message.conversationId)?.title : undefined,
    conversationTitle: message.conversationId ? store.getConversation(message.conversationId)?.title : undefined,
    channel_name: dmPeerAgent?.name ?? message.channelName,
    channel_type: message.channelType,
    dm_peer_agent_id: dmPeerAgent?.id,
    dm_peer_agent_name: dmPeerAgent?.name,
    dm_peer_agent_display_name: dmPeerAgent?.displayName,
    sender_id: message.senderId,
    sender_type: message.senderType,
    sender_name: message.senderName,
    content: message.content,
    seq: message.seq,
    timestamp: message.createdAt,
    attachments: (message.attachmentIds ?? []).map((attachmentId) => store.getAttachment(attachmentId)).filter(Boolean),
    deviceRefs: formatMessageDeviceRefs(message),
    device_refs: formatMessageDeviceRefs(message),
    messageId: message.id,
    createdAt: message.createdAt
  };
}

function formatInternalTask(task: any) {
  return {
    id: task.id,
    taskNumber: task.taskNumber,
    title: task.title,
    status: task.status,
    messageId: task.messageId,
    channelName: task.channelName,
    channelDisplayName: task.channelDisplayName,
    channelType: task.channelType,
    threadChannelId: task.threadChannelId,
    assigneeAgentId: task.assigneeAgentId,
    claimedByName: task.assigneeName,
    createdByName: task.createdByName,
    isLegacy: false
  };
}

function formatReminder(reminder: any) {
  return {
    reminderId: reminder.id,
    ownerAgentId: reminder.ownerAgentId,
    title: reminder.title,
    status: reminder.status,
    fireAt: reminder.fireAt,
    version: reminder.version ?? 1,
    repeat: reminder.repeat ?? null,
    fireCount: reminder.fireCount ?? 0,
    msgRef: reminder.messageId,
    channelId: reminder.channelId
  };
}

const webDistDir = path.join(rootDir, "apps/web/dist");
if (existsSync(webDistDir)) {
  app.use(express.static(webDistDir));
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/internal") || req.path.startsWith("/daemon") || req.path.startsWith("/mcp") || req.path.startsWith("/oauth") || req.path.startsWith("/.well-known")) {
      next();
      return;
    }
    res.sendFile(path.join(webDistDir, "index.html"));
  });
}

server.listen(port, host, createServerListeningHandler({
  markMachinesOfflineOnBoot,
  reconcileRuntimeLifecycleOnBoot: () => reconcileSupersededAgentRuntimeWork(),
  startBackgroundWorkers: () => {
    messageSubmissionDispatcher(routeContext).recover();
    routeContext.humanReplies?.recover();
    const drainInvitations = () => void workspaceBridgeEmailInvitations.drain().catch(() => {
      console.error("[server] workspace_bridge_invitation_delivery_failed");
    });
    drainInvitations();
    setInterval(drainInvitations, 5_000).unref();
    interruptRunningBridgeContinuationAttempts(store);
    interruptRunningCommunicationReturnEvents(store);
    for (const eventId of listPendingCommunicationReturnEventIds(store)) scheduleCommunicationReturnEvent(eventId);
    for (const eventId of recoverBridgeInteractionContinuations(store)) scheduleWorkspaceBridgeInteractionContinuation(eventId);
    recoverPendingCrossWorkspaceBridgeFollowups(routeContext);
    for (const requestId of store.recoverReadyCrossWorkspaceContinuations()) {
      scheduleAssistantBridgeContinuation(requestId);
    }
    recoverCompletedWorkspaceBridgeRepliesOnBoot();
    reconcileWorkspaceBridgePublications();
    setInterval(reconcileWorkspaceBridgePublications, 30_000).unref();
    runtimeApprovalExpiry.start();
    tyrHeartbeatScheduler.start();
  },
  logStarted: () => {
    console.log(`[server] tyr-ai server listening on ${host} ${publicServerUrl}`);
    console.log(`[server] data=${path.join(dataDir, "tyr.sqlite")}`);
    console.log("[server] workspace sync mode=bootstrap-v2 messagePaging=enabled executionBlocks=on-demand");
    console.log("[server] dev hint: pnpm dev starts server+web only; restart local runtime daemon with pnpm dev:daemon:real.");
    console.log(`[server] safety audit ${safetyAuditConfig.enabled ? `enabled mode=${safetyAuditConfig.mode} model=${safetyAuditConfig.model}` : "disabled"}`);
    console.log(`[server] governance ${governanceConfig.enabled ? `enabled mode=${governanceConfig.mode} model=${governanceConfig.model}` : "disabled"}`);
    console.log(`[server] assistant LLM ${assistantLlmConfig.enabled ? `enabled model=${assistantLlmConfig.model}` : "disabled"}`);
    console.log(`[server] platform ops ${platformOpsSocketPath ? `enabled socket=${platformOpsSocketPath}` : "disabled"}`);
  }
}));
