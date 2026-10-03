import type express from "express";
import type {
  AgentRecord,
  ChannelRecord,
  DeviceCapability,
  DeviceCapabilityDescriptor,
  DevicePermissionState,
  DevicePlatform,
  DeviceRecord,
  MessageExecutionSummaryRecord,
  MobileApprovalSummary,
  MessageRecord,
  MobileAppBindingRecord,
  MobileExecutionSummary,
  RuntimeApprovalDecision,
  RuntimeApprovalRecord,
  RuntimeExecutionRecord
} from "@tyr-ai/contracts";
import type { ServerRouteContext } from "../server-context";
import { buildMessageExecutionSummaries } from "../message-execution-summary";
import { resolveRuntimeApprovalDecision } from "../runtime-approval-resolve";
import { sanitizeHumanVisibleText, sanitizeHumanVisibleValue } from "../output-disclosure";

type MobileAppAuth = {
  device: DeviceRecord;
  binding: MobileAppBindingRecord;
};

const MOBILE_PLATFORMS = ["android", "ios"] as const satisfies readonly DevicePlatform[];
const DEFAULT_MOBILE_MESSAGE_LIMIT = 30;
const MAX_MOBILE_MESSAGE_LIMIT = 100;

type MobileMessagesPage = {
  messages: unknown[];
  pageInfo: {
    hasMoreBefore: boolean;
    oldestSeq: number | null;
    newestSeq: number | null;
  };
};

function parseBearer(req: express.Request): string {
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  if (queryToken) return queryToken;
  const auth = req.header("authorization") ?? req.header("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match?.[1] ?? "";
}

function publicDevice(device: DeviceRecord): DeviceRecord {
  return { ...device, deviceToken: undefined };
}

function capabilityIds(value: unknown): DeviceCapability[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item): DeviceCapability[] => {
    if (typeof item !== "string" || !item.trim() || seen.has(item)) return [];
    seen.add(item);
    return [item as DeviceCapability];
  });
}

function capabilityDescriptors(value: unknown): DeviceCapabilityDescriptor[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item): DeviceCapabilityDescriptor[] => {
    if (
      typeof item?.id !== "string" ||
      typeof item?.label !== "string" ||
      !["low", "medium", "high"].includes(item?.riskLevel)
    ) return [];
    return [{
      id: item.id,
      label: item.label,
      description: typeof item.description === "string" ? item.description : undefined,
      riskLevel: item.riskLevel,
      inputSchema: typeof item.inputSchema === "object" && item.inputSchema ? item.inputSchema : undefined,
      resultSchema: typeof item.resultSchema === "object" && item.resultSchema ? item.resultSchema : undefined
    }];
  });
}

function permissionStates(value: unknown): Partial<Record<DeviceCapability, DevicePermissionState>> {
  return typeof value === "object" && value && !Array.isArray(value)
    ? value as Partial<Record<DeviceCapability, DevicePermissionState>>
    : {};
}

function mobilePlatform(value: unknown): DevicePlatform | null {
  return typeof value === "string" && (MOBILE_PLATFORMS as readonly string[]).includes(value) ? value as DevicePlatform : null;
}

function mobileMetadata(req: express.Request):
  | { ok: true; platform: DevicePlatform; appVersion: string; capabilities: DeviceCapability[]; capabilityDescriptors?: DeviceCapabilityDescriptor[]; permissionStates: Partial<Record<DeviceCapability, DevicePermissionState>> }
  | { ok: false } {
  const platform = mobilePlatform(req.body?.platform);
  const appVersion = typeof req.body?.appVersion === "string" ? req.body.appVersion.trim() : "";
  const capabilities = capabilityIds(req.body?.capabilities);
  if (!platform || !appVersion || capabilities.length === 0) return { ok: false };
  return {
    ok: true,
    platform,
    appVersion,
    capabilities,
    capabilityDescriptors: capabilityDescriptors(req.body?.capabilityDescriptors),
    permissionStates: permissionStates(req.body?.permissionStates)
  };
}

function activeMobileAuth(req: express.Request, res: express.Response, ctx: ServerRouteContext): MobileAppAuth | null {
  const token = parseBearer(req);
  const device = token ? ctx.store.getDeviceByToken(token) : null;
  if (!device) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  const binding = ctx.store.getMobileAppBindingByDevice(device.id);
  if (!binding) {
    res.status(403).json({ error: "mobile_app_binding_inactive" });
    return null;
  }
  return { device, binding };
}

function visibleAgents(ctx: ServerRouteContext, binding: MobileAppBindingRecord): unknown[] {
  return ctx.store.listAgents(binding.serverId)
    .filter((agent) => ctx.store.canUserAccessResource(binding.userId, "agent", agent.id, "message"))
    .map((agent) => ctx.formatAgentListItem(agent, { serverId: binding.serverId, creator: null }));
}

function publicAgent(ctx: ServerRouteContext, agentId?: string): unknown | null {
  if (!agentId) return null;
  const agent = ctx.store.getAgent(agentId);
  const serverId = agent ? agent.serverId ?? (agent.machineId ? ctx.store.getMachine(agent.machineId)?.serverId : undefined) ?? "local" : "local";
  return agent ? ctx.formatAgentListItem(agent, { serverId, creator: null }) : null;
}

function mobileMessageLimit(value: unknown): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : DEFAULT_MOBILE_MESSAGE_LIMIT;
  if (!Number.isFinite(parsed)) return DEFAULT_MOBILE_MESSAGE_LIMIT;
  return Math.max(1, Math.min(Math.floor(parsed), MAX_MOBILE_MESSAGE_LIMIT));
}

function mobileSeqCursor(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

function emptyMessagesPage(): MobileMessagesPage {
  return {
    messages: [],
    pageInfo: { hasMoreBefore: false, oldestSeq: null, newestSeq: null }
  };
}

function mobileMessagesPage(ctx: ServerRouteContext, userId: string, channelId?: string, options: { limit?: number; beforeSeq?: number; afterSeq?: number } = {}): MobileMessagesPage {
  if (!channelId || !ctx.store.canUserAccessChannel(userId, channelId)) return emptyMessagesPage();
  const limit = mobileMessageLimit(options.limit);
  const history = ctx.store.readHistory(channelId, limit, undefined, options.beforeSeq, options.afterSeq);
  if (!history) return emptyMessagesPage();
  const messages = history.messages.map((message) => ctx.formatPublicMessage(message));
  const oldestSeq = history.messages.at(0)?.seq ?? null;
  const newestSeq = history.messages.at(-1)?.seq ?? null;
  const hasMoreBefore = oldestSeq === null ? false : Boolean(ctx.store.readHistory(channelId, 1, undefined, oldestSeq)?.messages.length);
  return {
    messages,
    pageInfo: { hasMoreBefore, oldestSeq, newestSeq }
  };
}

function publicChannel(ctx: ServerRouteContext, userId: string, channelId?: string): unknown | null {
  if (!channelId || !ctx.store.canUserAccessChannel(userId, channelId)) return null;
  const channel = ctx.store.resolveTarget(channelId);
  return channel ? ctx.formatChannel(channel) : null;
}

function emptyMobileExecutionSummary(): MobileExecutionSummary {
  return {
    status: "idle",
    label: "No active execution",
    detail: "",
    executionIds: [],
    approvalIds: []
  };
}

function mobileAgentLabel(agent: AgentRecord | null): string {
  return agent?.displayName || agent?.name || "Assistant";
}

function approvalSummary(ctx: ServerRouteContext, approval: RuntimeApprovalRecord): MobileApprovalSummary {
  const agent = ctx.store.getAgent(approval.agentId);
  const payload = approval.payload && typeof approval.payload === "object" && !Array.isArray(approval.payload)
    ? approval.payload as Record<string, unknown>
    : {};
  return {
    id: approval.id,
    executionId: approval.executionId,
    agentId: approval.agentId,
    agentName: agent?.name || agent?.displayName || approval.agentId,
    title: approval.title,
    detail: sanitizeHumanVisibleText(approval.detail),
    kind: approval.kind,
    method: approval.method,
    status: approval.status,
    requestedAt: approval.requestedAt,
    classification: typeof payload.approvalClassification === "string" ? payload.approvalClassification : undefined,
    nonBlocking: typeof payload.approvalNonBlocking === "boolean" ? payload.approvalNonBlocking : undefined
  };
}

function directExecutionsForMessage(executions: RuntimeExecutionRecord[], agentId: string, messageId: string): RuntimeExecutionRecord[] {
  return executions.filter((execution) => execution.agentId === agentId && (execution.messageId === messageId || execution.rootMessageId === messageId));
}

function latestRelevantMobileMessageSummary(ctx: ServerRouteContext, binding: MobileAppBindingRecord) {
  if (!binding.pinnedChannelId || !binding.pinnedAgentId) return null;
  if (!ctx.store.canUserAccessChannel(binding.userId, binding.pinnedChannelId)) return null;
  const history = ctx.store.readHistory(binding.pinnedChannelId, 30);
  if (!history || history.messages.length === 0) return null;
  const executionData = buildMessageExecutionSummaries(ctx.store, binding.userId, history.messages);
  const newestMessages = [...history.messages].reverse();
  const summaries = newestMessages
    .map((message) => executionData.messageExecutionSummaries[message.id])
    .filter((summary): summary is MessageExecutionSummaryRecord => Boolean(summary));
  const summary = summaries.find((item) => item.status === "pending_approval" || item.status === "running" || item.status === "failed") ?? summaries[0] ?? null;
  return summary ? { summary, executionData } : null;
}

function mobileExecutionSummary(ctx: ServerRouteContext, binding: MobileAppBindingRecord): MobileExecutionSummary {
  const agent = binding.pinnedAgentId ? ctx.store.getAgent(binding.pinnedAgentId) : null;
  if (!binding.pinnedAgentId || !binding.pinnedChannelId) return emptyMobileExecutionSummary();
  if (!agent || !agentAllowedForBinding(ctx, binding, agent)) {
    return {
      status: "assistant_unavailable",
      label: "Assistant unavailable",
      detail: "Choose an available Assistant in Web to continue.",
      executionIds: [],
      approvalIds: []
    };
  }
  const latest = latestRelevantMobileMessageSummary(ctx, binding);
  const agentName = mobileAgentLabel(agent);
  if (!latest) {
    if (agent.status === "offline" || agent.status === "error") {
      return {
        status: "assistant_unavailable",
        label: "Assistant unavailable",
        detail: agent.lastError || "Messages are queued until the device Agent runtime is available.",
        executionIds: [],
        approvalIds: []
      };
    }
    return emptyMobileExecutionSummary();
  }

  const { summary, executionData } = latest;
  const executionById = new Map(executionData.runtimeExecutions.map((execution) => [execution.id, execution]));
  const directExecutions = directExecutionsForMessage(executionData.runtimeExecutions, agent.id, summary.messageId);
  const summaryExecutions = summary.executionIds.map((id) => executionById.get(id)).filter((execution): execution is RuntimeExecutionRecord => Boolean(execution));
  const visibleExecutions = directExecutions.length > 0 ? directExecutions : summaryExecutions.filter((execution) => execution.agentId === agent.id);
  const visibleExecutionIds = visibleExecutions.map((execution) => execution.id);
  const currentExecutionIds = new Set(visibleExecutionIds);
  const pendingApprovals = executionData.runtimeApprovals
    .filter((approval) => approval.agentId === agent.id && approval.status === "pending" && summary.approvalIds.includes(approval.id))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const currentApproval = pendingApprovals.find((approval) => approval.executionId && currentExecutionIds.has(approval.executionId));
  const hasQueuedCurrent = visibleExecutions.some((execution) => execution.status === "queued" || execution.status === "delivered");
  const sameAgentPendingApprovals = ctx.store.listRuntimeApprovals({ serverId: binding.serverId, limit: 1000 })
    .filter((approval) => (
      approval.agentId === agent.id &&
      approval.status === "pending" &&
      ctx.store.canUserResolveRuntimeApproval(binding.userId, approval)
    ))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const blockerApproval = currentApproval || !hasQueuedCurrent
    ? null
    : pendingApprovals.find((approval) => !approval.executionId || !currentExecutionIds.has(approval.executionId))
      ?? sameAgentPendingApprovals.find((approval) => !approval.executionId || !currentExecutionIds.has(approval.executionId))
      ?? null;
  const approval = currentApproval ?? blockerApproval ?? pendingApprovals[0];
  const approvalIds = approval ? [approval.id] : summary.approvalIds;

  if (blockerApproval && hasQueuedCurrent) {
    return {
      status: "blocked_by_approval",
      label: "Blocked by earlier approval",
      detail: `${agentName} is waiting on an earlier approval before this message can run.`,
      messageId: summary.messageId,
      executionIds: visibleExecutionIds,
      approvalIds,
      approval: approvalSummary(ctx, blockerApproval),
      updatedAt: summary.updatedAt
    };
  }
  if (approval) {
    return {
      status: "waiting_approval",
      label: "Approval required",
      detail: `${agentName} needs approval to continue.`,
      messageId: summary.messageId,
      executionIds: visibleExecutionIds,
      approvalIds,
      approval: approvalSummary(ctx, approval),
      updatedAt: summary.updatedAt
    };
  }
  if (visibleExecutions.some((execution) => execution.status === "queued" || execution.status === "delivered")) {
    return {
      status: "queued",
      label: "Queued for Assistant",
      detail: `${agentName} will respond when the runtime is available.`,
      messageId: summary.messageId,
      executionIds: visibleExecutionIds,
      approvalIds: [],
      updatedAt: summary.updatedAt
    };
  }
  if (summary.status === "running") {
    return {
      status: "running",
      label: "Assistant is working",
      detail: `${agentName} is working on this message.`,
      messageId: summary.messageId,
      executionIds: visibleExecutionIds,
      approvalIds: [],
      updatedAt: summary.updatedAt
    };
  }
  if (summary.status === "failed") {
    return {
      status: "failed",
      label: "Execution failed",
      detail: summary.label,
      messageId: summary.messageId,
      executionIds: visibleExecutionIds,
      approvalIds: summary.approvalIds,
      updatedAt: summary.updatedAt
    };
  }
  return {
    status: "completed",
    label: "Execution completed",
    detail: summary.label,
    messageId: summary.messageId,
    executionIds: visibleExecutionIds,
    approvalIds: summary.approvalIds,
    updatedAt: summary.updatedAt
  };
}

function mobileCanResolveApproval(ctx: ServerRouteContext, binding: MobileAppBindingRecord, approval: RuntimeApprovalRecord | null): approval is RuntimeApprovalRecord {
  if (!approval || approval.agentId !== binding.pinnedAgentId) return false;
  const serverMatches = approval.serverId ? approval.serverId === binding.serverId : binding.serverId === "local";
  if (!serverMatches) return false;
  return agentAllowedForBinding(ctx, binding, ctx.store.getAgent(approval.agentId)) &&
    ctx.store.canUserResolveRuntimeApproval(binding.userId, approval);
}

function recordMobileAudit(ctx: ServerRouteContext, input: {
  kind: string;
  binding: MobileAppBindingRecord;
  actorId?: string;
  metadata?: Record<string, string | number | boolean | null | string[]>;
}): void {
  ctx.store.recordAuditEvent({
    kind: input.kind,
    actorType: "system",
    actorId: input.actorId ?? null,
    resourceType: "mobile_app_binding",
    resourceId: input.binding.id,
    serverId: input.binding.serverId,
    metadata: input.metadata
  });
}

function sessionPayload(ctx: ServerRouteContext, auth: MobileAppAuth) {
  const messagesPage = mobileMessagesPage(ctx, auth.binding.userId, auth.binding.pinnedChannelId);
  return {
    binding: auth.binding,
    device: publicDevice(auth.device),
    pinnedAgent: publicAgent(ctx, auth.binding.pinnedAgentId),
    channel: publicChannel(ctx, auth.binding.userId, auth.binding.pinnedChannelId),
    recentMessages: messagesPage.messages,
    messagesPage,
    mobileExecutionSummary: mobileExecutionSummary(ctx, auth.binding)
  };
}

function agentAllowedForBinding(ctx: ServerRouteContext, binding: MobileAppBindingRecord, agent: AgentRecord | null): agent is AgentRecord {
  if (!agent) return false;
  const agentServerId = agent.serverId ?? (agent.machineId ? ctx.store.getMachine(agent.machineId)?.serverId : undefined) ?? "local";
  return agentServerId === binding.serverId && ctx.store.canUserAccessResource(binding.userId, "agent", agent.id, "message");
}

function emitWakeForMobileMessage(ctx: ServerRouteContext, message: MessageRecord): void {
  ctx.emitRealtimeMessage(message);
  const wakeTargets = ctx.store.selectWakeTargets(message);
  if (wakeTargets.length > 0 && message.channelType !== "thread") {
    const detail = `Queued @${wakeTargets.map((agent) => agent.name).join(", @")} from mobile device chat.`;
    const thread = ctx.store.ensureMessageThread(message.id);
    const sourceMessage = ctx.store.listMessages(message.channelId).find((item) => item.id === message.id);
    // Mobile chat follows the same parent-message/thread projection as Web chat so runtime replies land in the expected thread.
    if (sourceMessage) ctx.broadcastRealtime("message:updated", ctx.formatPublicMessage(sourceMessage), { channelId: message.channelId });
    if (thread.channel) ctx.emitRealtimeThreadUpdate(thread.channel.id);
    const executions = thread.channel
      ? ctx.createQueuedMessageRuntimeExecutionsForMessage(ctx.store, {
        message,
        threadChannelId: thread.channel.id,
        detail
      })
      : [];
    for (const execution of executions) {
      ctx.emitRealtimeRuntimeExecution(execution);
      // Mobile 与 Web 共享同一调度语义：离线 Agent 自动启动，error Agent 保持 queued 等待人工 Retry。
      ctx.dispatchQueuedAgentInbox(execution.agentId, detail, execution.id);
    }
  }
}

export function registerMobileAppRoutes(app: express.Express, ctx: ServerRouteContext): void {
  app.post("/api/mobile-app/bindings", (req, res) => {
    const pairingToken = typeof req.body?.pairingToken === "string" ? req.body.pairingToken.trim() : "";
    const metadata = mobileMetadata(req);
    if (!pairingToken || !metadata.ok) {
      res.status(400).json({ error: "invalid_mobile_app_metadata" });
      return;
    }
    const paired = ctx.store.connectDeviceWithPairingToken({
      pairingToken,
      displayName: typeof req.body?.displayName === "string" && req.body.displayName.trim() ? req.body.displayName.trim() : "TYR Mobile Device",
      deviceKind: "mobile",
      platform: metadata.platform,
      appVersion: metadata.appVersion,
      capabilities: metadata.capabilities,
      capabilityDescriptors: metadata.capabilityDescriptors,
      permissionStates: metadata.permissionStates
    });
    if (!paired) {
      res.status(400).json({ error: "mobile_pairing_invalid" });
      return;
    }
    let binding = ctx.store.createOrUpdateMobileAppBinding({
      serverId: paired.device.serverId,
      userId: paired.device.ownerUserId,
      deviceId: paired.device.id
    });
    if (!binding) {
      res.status(400).json({ error: "mobile_app_binding_failed" });
      return;
    }
    recordMobileAudit(ctx, {
      kind: "mobile_app_bound",
      binding,
      actorId: binding.userId,
      metadata: {
        deviceId: paired.device.id,
        platform: paired.device.platform,
        appVersion: paired.device.appVersion
      }
    });
    const pinnedAgent = paired.pairing.pinnedAgentId ? ctx.store.getAgent(paired.pairing.pinnedAgentId) : null;
    if (pinnedAgent && agentAllowedForBinding(ctx, binding, pinnedAgent)) {
      const channel = ctx.store.getOrCreateAgentDm(pinnedAgent.id, binding.userId);
      const pinnedBinding = channel ? ctx.store.setMobileAppPinnedAgent(binding.id, pinnedAgent.id, channel.id) : null;
      if (pinnedBinding && channel) {
        binding = pinnedBinding;
        recordMobileAudit(ctx, {
          kind: "mobile_app_pinned_agent_changed",
          binding,
          actorId: binding.userId,
          metadata: { agentId: pinnedAgent.id, channelId: channel.id }
        });
      }
    }
    res.json({
      binding,
      device: publicDevice(paired.device),
      deviceToken: paired.deviceToken,
      agents: visibleAgents(ctx, binding),
      pinnedAgent: publicAgent(ctx, binding.pinnedAgentId),
      channel: publicChannel(ctx, binding.userId, binding.pinnedChannelId),
      recentMessages: mobileMessagesPage(ctx, binding.userId, binding.pinnedChannelId).messages,
      messagesPage: mobileMessagesPage(ctx, binding.userId, binding.pinnedChannelId),
      mobileExecutionSummary: mobileExecutionSummary(ctx, binding)
    });
  });

  app.get("/api/mobile-app/session", (req, res) => {
    const auth = activeMobileAuth(req, res, ctx);
    if (!auth) return;
    const touched = ctx.store.touchMobileAppBinding(auth.binding.id);
    if (!touched) {
      res.status(403).json({ error: "mobile_app_binding_inactive" });
      return;
    }
    res.json(sessionPayload(ctx, { ...auth, binding: touched }));
  });

  app.post("/api/mobile-app/pinned-agent", (req, res) => {
    const auth = activeMobileAuth(req, res, ctx);
    if (!auth) return;
    const agentId = typeof req.body?.agentId === "string" ? req.body.agentId : "";
    const agent = ctx.store.getAgent(agentId);
    if (!agentAllowedForBinding(ctx, auth.binding, agent)) {
      res.status(403).json({ error: "mobile_agent_not_allowed" });
      return;
    }
    const channel = ctx.store.getOrCreateAgentDm(agent.id, auth.binding.userId);
    const binding = channel ? ctx.store.setMobileAppPinnedAgent(auth.binding.id, agent.id, channel.id) : null;
    if (!channel || !binding) {
      res.status(403).json({ error: "mobile_agent_not_allowed" });
      return;
    }
    recordMobileAudit(ctx, {
      kind: "mobile_app_pinned_agent_changed",
      binding,
      actorId: binding.userId,
      metadata: { agentId: agent.id, channelId: channel.id }
    });
    res.json({
      binding,
      channel: ctx.formatChannel(channel),
      agent: ctx.formatAgentListItem(agent, { serverId: binding.serverId, creator: null }),
      recentMessages: mobileMessagesPage(ctx, binding.userId, channel.id).messages,
      messagesPage: mobileMessagesPage(ctx, binding.userId, channel.id),
      mobileExecutionSummary: mobileExecutionSummary(ctx, binding)
    });
  });

  app.get("/api/mobile-app/messages", (req, res) => {
    const auth = activeMobileAuth(req, res, ctx);
    if (!auth) return;
    const channel = auth.binding.pinnedChannelId ? ctx.store.resolveTarget(auth.binding.pinnedChannelId) : null;
    if (!channel || !ctx.store.canUserAccessChannel(auth.binding.userId, channel.id)) {
      res.status(409).json({ error: "pinned_agent_required" });
      return;
    }
    const messagesPage = mobileMessagesPage(ctx, auth.binding.userId, channel.id, {
      limit: mobileMessageLimit(req.query.limit),
      beforeSeq: mobileSeqCursor(req.query.beforeSeq),
      afterSeq: mobileSeqCursor(req.query.afterSeq)
    });
    res.json({
      ...messagesPage,
      mobileExecutionSummary: mobileExecutionSummary(ctx, auth.binding)
    });
  });

  app.post("/api/mobile-app/messages", (req, res) => {
    const auth = activeMobileAuth(req, res, ctx);
    if (!auth) return;
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!content) {
      res.status(400).json({ error: "content_required" });
      return;
    }
    const channel = auth.binding.pinnedChannelId ? ctx.store.resolveTarget(auth.binding.pinnedChannelId) : null;
    const agent = auth.binding.pinnedAgentId ? ctx.store.getAgent(auth.binding.pinnedAgentId) : null;
    if (!channel || !agent || !ctx.store.canUserAccessChannel(auth.binding.userId, channel.id) || !ctx.store.canAgentAccessChannel(agent.id, channel.id)) {
      res.status(409).json({ error: "pinned_agent_required" });
      return;
    }
    const result = ctx.store.sendMessage({
      target: channel.id,
      content,
      senderType: "human",
      senderId: auth.binding.userId,
      senderName: ctx.store.getUser(auth.binding.userId)?.displayName ?? "Mobile user",
      serverId: auth.binding.serverId
    });
    emitWakeForMobileMessage(ctx, result.message);
    recordMobileAudit(ctx, {
      kind: "mobile_app_message_sent",
      binding: auth.binding,
      actorId: auth.binding.userId,
      metadata: { channelId: channel.id, messageId: result.message.id }
    });
    const messagesPage = mobileMessagesPage(ctx, auth.binding.userId, channel.id);
    res.json({
      binding: auth.binding,
      message: ctx.formatPublicMessage(result.message),
      recentMessages: messagesPage.messages,
      messagesPage,
      mobileExecutionSummary: mobileExecutionSummary(ctx, auth.binding)
    });
  });

  app.post("/api/mobile-app/runtime-approvals/:approvalId/resolve", (req, res) => {
    const auth = activeMobileAuth(req, res, ctx);
    if (!auth) return;
    const approval = ctx.store.getRuntimeApproval(String(req.params.approvalId));
    if (!mobileCanResolveApproval(ctx, auth.binding, approval)) {
      res.status(404).json({ error: "approval_not_found" });
      return;
    }
    const decision = req.body?.decision as RuntimeApprovalDecision | undefined;
    if (decision !== "approve" && decision !== "reject") {
      res.status(400).json({ error: "decision_required" });
      return;
    }
    const result = resolveRuntimeApprovalDecision(ctx, {
      approval,
      decision,
      resolvedByUserId: auth.binding.userId
    });
    if ("blocked" in result) {
      res.status(result.status).json(result.body);
      return;
    }
    res.json(sanitizeHumanVisibleValue({
      ...result,
      mobileExecutionSummary: mobileExecutionSummary(ctx, auth.binding)
    }));
  });

  app.post("/api/mobile-app/unbind", (req, res) => {
    const auth = activeMobileAuth(req, res, ctx);
    if (!auth) return;
    const binding = ctx.store.revokeMobileAppBinding(auth.binding.id);
    if (!binding) {
      res.status(403).json({ error: "mobile_app_binding_inactive" });
      return;
    }
    recordMobileAudit(ctx, {
      kind: "mobile_app_unbound",
      binding,
      actorId: binding.userId,
      metadata: { deviceId: binding.deviceId }
    });
    res.json({ binding, device: publicDevice(auth.device) });
  });
}
