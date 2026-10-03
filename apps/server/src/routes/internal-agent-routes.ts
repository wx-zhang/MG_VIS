import type express from "express";
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { isLegacyMockDevice, runtimeDisplayName, type AgentRecord, type AttachmentRecord, type ChannelRecord, type DeviceCapability, type DeviceCommandRecord, type MessageRecord, type RuntimeExecutionRecord, type UserRecord } from "@tyr-ai/contracts";
import type { GovernanceSourceTag } from "@tyr-ai/governance";
import { emitAgentNavigationRealtimeEvent } from "../agent-management-service";
import { delegateAgentExecution } from "../agent-delegation";
import { recordCommunicationReturnEvent, type CommunicationReturnEventKind } from "../communication-return-ipc";
import { validateCommunicationEvidenceFacts } from "../communication-evidence";
import { effectiveAttachmentMimeType } from "../attachment-files";
import { dispatchDeviceCommand } from "../device-command-lifecycle";
import {
  blockedSubjectId,
  governanceBlockedResponse,
  prepareAttachmentUploadGovernance,
  prepareOutboundMessageGovernance
} from "../governance-outbound";
import { resolveEffectiveGovernanceRuntimeConfig } from "../governance-policy";
import { isTerminalRuntimeExecutionStatus } from "../message-deletion";
import { outboundApprovalRequiredResponse, queueOutboundApproval, shouldAutoApproveOutboundApproval, shouldQueueOutboundApproval } from "../outbound-approval-queue";
import type { ServerRouteContext } from "../server-context";
import { WorkspaceSharedFileError } from "../workspace-shared-files";
import { workspaceBridgeRefForExecution } from "../workspace-bridge-delivery";

const ATTACHMENT_GOVERNANCE_PREVIEW_BYTES = 16 * 1024;
const MAX_AGENT_SHARED_FILE_TOOL_BYTES = 1024 * 1024;
const MAX_AGENT_RETURN_HOPS = 5;
type InternalMessageScope = "conversation" | "dm_history" | "all_accessible";

function queryMessageScope(value: unknown): InternalMessageScope {
  return value === "dm_history" || value === "all_accessible" ? value : "conversation";
}

function queryConversationId(value: unknown): string | undefined {
  const clean = typeof value === "string" ? value.trim() : "";
  return clean || undefined;
}

function internalDelegationTransport(body: Record<string, unknown>): "internal_api" | "cli_server_fallback" {
  return body.transport === "cli_server_fallback" || body.transport === "cli-server-fallback"
    ? "cli_server_fallback"
    : "internal_api";
}

export function registerInternalAgentRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const {
    store,
    governanceConfig,
    upload,
    cleanupUploadedFile,
    validateUploadedFile,
    uploadFilename,
    agentCanAccessAttachment,
    authAgent,
    requireAgentCapability,
    broadcastRealtime,
    emitRealtimeMessage,
    emitRealtimeGovernanceDecision,
    deliverPendingToOnlineAgents,
    createAndEnqueueMessageHandoffRun,
    dispatchReturnToAgentForFinalMessage,
    completeRuntimeExecutionFromFinalMessage,
    sendReminderUpsert,
    sendReminderCancel,
    serverIdForAgent,
    mentionedAgentsForContent,
    formatInternalMessage,
    formatReminder,
    workspaceSharedFiles,
    publishWorkspaceSync
  } = ctx;

  function agentServerId(agent: AgentRecord): string {
    return String(serverIdForAgent(agent));
  }

  function deviceCommandStatusSummary(command: DeviceCommandRecord, attachmentIds: string[]): string {
    const errorText = command.errorMessage || command.errorCode;
    const attachmentText = attachmentIds.length ? ` Attachment IDs: ${attachmentIds.join(", ")}.` : "";
    const errorSuffix = errorText ? ` ${errorText}` : "";
    return `Device command ${command.id} ${command.status} for ${command.capability}.${attachmentText}${errorSuffix}`;
  }

  function agentDeviceCommandStatusPayload(agent: AgentRecord, command: DeviceCommandRecord) {
    const artifactIds = command.artifactIds ?? [];
    const attachments = artifactIds
      .map((attachmentId) => store.getAttachment(attachmentId))
      .filter((attachment): attachment is AttachmentRecord => Boolean(attachment && store.canAgentAccessChannel(agent.id, attachment.channelId)))
      .map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes
      }));
    const attachmentIds = attachments.map((attachment) => attachment.id);
    return {
      command,
      artifactIds,
      attachmentIds,
      attachments,
      summary: deviceCommandStatusSummary(command, attachmentIds)
    };
  }

  function isDeviceCapabilityId(value: unknown): value is DeviceCapability {
    return typeof value === "string" && value.trim().length > 0;
  }

  function resolveAgentChannel(agent: AgentRecord, target: unknown): ChannelRecord | null {
    const value = typeof target === "string" ? target.trim() : "";
    if (!value) return null;
    const dmTarget = parseAgentDmTarget(value);
    if (dmTarget) {
      const pair = store.getOrCreateAgentPairDm(agent.id, dmTarget.peer, agentServerId(agent));
      if (pair && store.canAgentAccessChannel(agent.id, pair.id)) {
        if (!dmTarget.threadShort) return pair;
        return resolveThreadInParent(agent, pair, dmTarget.threadShort);
      }
      const legacyHumanDm = resolveLegacyHumanAgentDm(agent, dmTarget.peer);
      if (!legacyHumanDm) return null;
      if (!dmTarget.threadShort) return legacyHumanDm;
      return resolveThreadInParent(agent, legacyHumanDm, dmTarget.threadShort);
    }
    const direct = store.resolveTarget(value, agentServerId(agent));
    if (direct && store.canAgentAccessChannel(agent.id, direct.id)) return direct;
    const normalized = value.replace(/^#/, "");
    return store.listChannelsForAgent(agent.id).find((channel) => (
      channel.id === value ||
      channel.name === normalized ||
      channel.displayName === value ||
      channel.displayName === normalized
    )) ?? null;
  }

  function resolveLegacyHumanAgentDm(agent: AgentRecord, channelName: string): ChannelRecord | null {
    if (!channelName.startsWith("dm-user-")) return null;
    // 兼容旧版 agent 输出的 dm:@dm-user-...-agent-... target；只查现有可访问 DM，不能创建新 DM。
    return store.listChannelsForAgent(agent.id).find((channel) => (
      channel.type === "dm" &&
      channel.name === channelName &&
      store.canAgentAccessChannel(agent.id, channel.id)
    )) ?? null;
  }

  function parseAgentDmTarget(target: string): { peer: string; threadShort?: string } | null {
    const trimmed = target.trim();
    if (!trimmed.toLowerCase().startsWith("dm:@")) return null;
    const [peer, threadShort] = trimmed.slice(4).split(":");
    const cleanPeer = peer.trim().replace(/^@/, "");
    return cleanPeer ? { peer: cleanPeer, threadShort } : null;
  }

  function resolveThreadInParent(agent: AgentRecord, parent: ChannelRecord, threadShort: string): ChannelRecord | null {
    const normalizedThreadShort = threadShort.replace(/^msg_/, "");
    return store.listChannelsForAgent(agent.id).find((channel) => (
      channel.type === "thread" &&
      channel.parentChannelId === parent.id &&
      (
        channel.name === `thread-${threadShort}` ||
        channel.name === `thread-${normalizedThreadShort}` ||
        channel.id.startsWith(threadShort) ||
        channel.parentMessageId === threadShort ||
        Boolean(channel.parentMessageId?.startsWith(threadShort))
      )
    )) ?? null;
  }

  function pairDmPeerForChannel(agent: AgentRecord, channel: ChannelRecord): AgentRecord | null {
    if (channel.type !== "dm") return null;
    const members = store.listChannelMembers(channel.id, channel.serverId ?? agentServerId(agent))?.agents.filter((member) => member.joined) ?? [];
    if (!members.some((member) => member.id === agent.id)) return null;
    return members.find((member) => member.id !== agent.id) ?? null;
  }

  function trustedExecutionForAgent(agent: AgentRecord, executionId: unknown): RuntimeExecutionRecord | null {
    if (typeof executionId !== "string" || !executionId.trim()) return null;
    const execution = store.getRuntimeExecution(executionId.trim());
    return execution?.agentId === agent.id ? execution : null;
  }

  function trustedCommunicationReturnExecutionForAgent(agent: AgentRecord, executionId: unknown): RuntimeExecutionRecord | null {
    if (typeof executionId === "string" && executionId.trim()) return trustedExecutionForAgent(agent, executionId);
    // Some CLI runtimes omit the daemon's current-turn file from their MCP subprocess environment.
    // The authenticated Agent can recover only its single live TYR handoff; ambiguity fails closed.
    const candidates = store.db.prepare(`select id from runtime_executions
      where agent_id = ? and status = 'running'
        and communication_return_source_message_id is not null
        and communication_return_channel_id is not null
        and communication_return_message_id is null
      order by created_at desc limit 2`).all(agent.id) as Array<{ id: string }>;
    return candidates.length === 1 ? trustedExecutionForAgent(agent, candidates[0]!.id) : null;
  }

  function handoffOrchestration(agent: AgentRecord, sourceExecution: RuntimeExecutionRecord | null, handoffMessage: MessageRecord) {
    const hopCount = (sourceExecution?.hopCount ?? 0) + 1;
    const canReturn = hopCount <= MAX_AGENT_RETURN_HOPS;
    return {
      orchestration: {
        sourceExecutionId: sourceExecution?.id,
        returnToAgentId: canReturn ? agent.id : undefined,
        rootMessageId: sourceExecution?.rootMessageId ?? sourceExecution?.messageId ?? handoffMessage.id,
        hopCount,
        expectReply: canReturn
      }
    };
  }

  function resolveAgentSendTarget(agent: AgentRecord, target: unknown): { channel: ChannelRecord; dmPeerAgent: AgentRecord | null } | null {
    const channel = resolveAgentChannel(agent, target);
    if (!channel) return null;
    return { channel, dmPeerAgent: pairDmPeerForChannel(agent, channel) };
  }

  function governanceSourceForMessage(message: MessageRecord, propagation: string): GovernanceSourceTag {
    return {
      sourceType: message.senderType === "agent" ? "agent_action" : "channel_message",
      sourceTrust: message.senderType === "agent" ? "agent_action" : "untrusted_external",
      sourceId: message.id,
      channelId: message.channelId,
      messageId: message.id,
      threadChannelId: message.threadId,
      propagation: [propagation]
    };
  }

  function governanceSourceForAttachment(attachment: AttachmentRecord): GovernanceSourceTag {
    return {
      sourceType: "attachment",
      sourceTrust: "untrusted_external",
      sourceId: attachment.id,
      attachmentId: attachment.id,
      channelId: attachment.channelId,
      propagation: ["attachment_reference"]
    };
  }

  function governanceSourcesForUploadSourcePath(sourcePath: string | undefined, channelId: string): GovernanceSourceTag[] {
    if (!sourcePath) return [];
    const attachmentId = attachmentIdFromLocalAttachmentCache(sourcePath);
    if (attachmentId) {
      return [{
        sourceType: "attachment",
        sourceTrust: "untrusted_external",
        sourceId: attachmentId,
        attachmentId,
        channelId,
        propagation: ["upload_source_path", "derived_from_attachment_cache"]
      }];
    }
    // 普通本地 sourcePath 是 agent 生成文件的来源提示；明显外部/敏感路径仍按不可信输入处理。
    if (isUntrustedUploadSourcePath(sourcePath)) {
      return [{
        sourceType: "tool_output",
        sourceTrust: "untrusted_external",
        sourceId: sourcePath,
        channelId,
        propagation: ["upload_source_path", "untrusted_local_source"]
      }];
    }
    return [{
      sourceType: "tool_output",
      sourceTrust: "generated_artifact",
      sourceId: sourcePath,
      channelId,
      propagation: ["upload_source_path", "generated_artifact"]
    }];
  }

  function attachmentIdFromLocalAttachmentCache(sourcePath: string): string | undefined {
    if (!/(?:^|\/)\.tyr-ai\/attachments\//i.test(sourcePath)) return undefined;
    return sourcePath.match(/\batt_[A-Za-z0-9_]+\b/)?.[0];
  }

  function isUntrustedUploadSourcePath(sourcePath: string): boolean {
    return /(?:^|\/)(?:tmp|Downloads|Caches|TemporaryItems)\b/i.test(sourcePath) ||
      /\/(?:private\/)?var\/folders\//i.test(sourcePath) ||
      /(?:^|\/)\.ssh(?:\/|$)/i.test(sourcePath) ||
      /(?:^|\/)(?:id_rsa|id_ed25519|\.env|\.npmrc|\.pypirc|credentials?|secrets?)$/i.test(sourcePath);
  }

  function visibleIdentitiesForAgent(agent: AgentRecord) {
    const visibleAgents = new Map<string, AgentRecord>();
    const visibleHumans = new Map<string, UserRecord>();
    const self = store.getAgent(agent.id);
    if (self) visibleAgents.set(self.id, self);
    const owner = store.getUser(agent.ownerUserId);
    if (owner) visibleHumans.set(owner.id, owner);
    for (const channel of store.listChannelsForAgent(agent.id)) {
      const members = store.listChannelMembers(channel.id, channel.serverId ?? agentServerId(agent));
      if (!members) continue;
      for (const member of members.agents) {
        if (channel.visibility !== "private" || member.joined) visibleAgents.set(member.id, member);
      }
      for (const member of members.humans) {
        if (channel.visibility !== "private" || member.joined) visibleHumans.set(member.id, member);
      }
    }
    return {
      agents: [...visibleAgents.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      humans: [...visibleHumans.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    };
  }

  app.get("/internal/agent/:agentId/server", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "server:read", res)) return;
    const workspaceId = agentServerId(agent);
    const workspace = store.listServersForUser(agent.ownerUserId).find((item) => item.id === workspaceId);
    if (!workspace) {
      res.status(404).json({ error: "agent_workspace_not_found" });
      return;
    }
    const identities = visibleIdentitiesForAgent(agent);
    res.json({
      // Workspace 身份与 roster 一起来自 server 真源，Agent 不再需要从历史消息猜测。
      workspace: { id: workspace.id, name: workspace.name },
      agents: identities.agents.map((item) => ({ id: item.id, name: item.name, displayName: item.displayName, status: item.status, description: item.description })),
      humans: identities.humans.map((item) => ({ id: item.id, name: item.name, displayName: item.displayName })),
      runtimeContext: {
        runtime: agent.runtime ? runtimeDisplayName(agent.runtime) : "Server-hosted",
        model: agent.model,
        reasoningEffort: agent.reasoningEffort
      }
    });
  });

  app.get("/internal/agent/:agentId/devices", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "server:read", res)) return;
    const serverId = agentServerId(agent);
    const grants = store.listDeviceGrants({ serverId, agentId: agent.id, activeOnly: true });
    const devices = store.listDevices(serverId)
      .filter((device) => !isLegacyMockDevice(device))
      .map((device) => ({ ...device, deviceToken: undefined }));
    res.json({ devices, grants, accessRules: grants });
  });

  app.post("/internal/agent/:agentId/device-actions", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "message:read", res)) return;
    const body = req.body ?? {};
    const capability = body.capability;
    if (!isDeviceCapabilityId(capability)) {
      res.status(400).json({ error: "invalid_device_capability" });
      return;
    }
    const deviceId = typeof body.deviceId === "string" ? body.deviceId : typeof body.device_id === "string" ? body.device_id : "";
    const device = deviceId ? store.getDevice(deviceId) : null;
    const serverId = agentServerId(agent);
    if (!device || device.serverId !== serverId) {
      res.status(404).json({ error: "device_not_found" });
      return;
    }
    if (!device.capabilities.includes(capability)) {
      res.status(400).json({ error: "device_capability_unavailable" });
      return;
    }
    const messageId = typeof body.messageId === "string" ? body.messageId : typeof body.message_id === "string" ? body.message_id : undefined;
    const message = messageId ? store.getMessage(messageId) : null;
    const messageBoundAccess = Boolean(
      message &&
      store.canAgentAccessChannel(agent.id, message.channelId) &&
      message.deviceRefs?.some((ref) => ref.deviceId === device.id && ref.capability === capability)
    );
    const grant = messageBoundAccess ? null : store.findActiveDeviceGrant(agent.id, device.id, capability, serverId);
    if (!messageBoundAccess && !grant) {
      res.status(403).json({ error: "device_access_required" });
      return;
    }
    const command = store.createDeviceCommand({
      serverId,
      agentId: agent.id,
      deviceId: device.id,
      grantId: grant?.id,
      capability,
      params: typeof body.params === "object" && body.params ? body.params : {},
      requestedByMessageId: message?.id,
      channelId: message?.channelId,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString()
    });
    res.json(dispatchDeviceCommand(ctx, command));
  });

  app.get("/internal/agent/:agentId/device-actions/:commandId", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "message:read", res)) return;
    const command = store.getDeviceCommand(String(req.params.commandId));
    if (!command || command.agentId !== agent.id || command.serverId !== agentServerId(agent)) {
      res.status(404).json({ error: "device_command_not_found" });
      return;
    }
    res.json(agentDeviceCommandStatusPayload(agent, command));
  });

  app.post("/internal/agent/:agentId/delegate", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "message:send", res)) return;
    try {
      const body = req.body ?? {};
      const result = delegateAgentExecution(ctx, {
        sourceAgent: agent,
        targetAgent: body.targetAgent ?? body.target_agent,
        instruction: String(body.instruction || ""),
        attachmentIds: Array.isArray(body.attachmentIds) ? body.attachmentIds.map(String) : [],
        sourceExecutionId: body.sourceExecutionId ?? body.source_execution_id,
        sourceMessageId: body.sourceMessageId ?? body.source_message_id,
        returnMode: (body.returnMode ?? body.return_mode) === "origin" ? "origin" : "delegator",
        expectReply: body.expectReply ?? body.expect_reply,
        transport: internalDelegationTransport(body),
        skipGovernance: Boolean(workspaceBridgeRefForExecution(trustedExecutionForAgent(agent, body.sourceExecutionId ?? body.source_execution_id)))
      });
      if (!result.ok) {
        res.status(result.status).json(result.body ?? { error: result.error, detail: result.detail });
        return;
      }
      res.json({ delegation: result.delegation, execution: result.execution });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/internal/agent/:agentId/send", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "message:send", res)) return;
    const body = req.body ?? {};
    try {
      const target = body.target || body.channelId;
      const sendTarget = resolveAgentSendTarget(agent, target);
      const resolved = sendTarget?.channel ?? null;
      if (!resolved || !store.canAgentSendToChannel(agent.id, resolved.id)) {
        res.status(403).json({
          error: "target_not_accessible",
          agentId: agent.id,
          target: typeof target === "string" ? target : String(target),
          channelId: resolved?.id ?? null
        });
        return;
      }
      const quoteMessageId = typeof body.quoteMessageId === "string" && body.quoteMessageId.trim() ? body.quoteMessageId.trim() : undefined;
      let quoteMessage: MessageRecord | null = null;
      if (quoteMessageId) {
        quoteMessage = store.getMessage(quoteMessageId);
        if (!quoteMessage || !store.canAgentAccessChannel(agent.id, quoteMessage.channelId)) {
          res.status(404).json({ error: "quote_not_found" });
          return;
        }
      }
      const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.map(String) : [];
      const attachmentSources: AttachmentRecord[] = [];
      for (const attachmentId of attachmentIds) {
        const attachment = store.getAttachment(attachmentId);
        if (!attachment || !store.canAgentAccessChannel(agent.id, attachment.channelId)) {
          res.status(404).json({ error: "attachment_not_found" });
          return;
        }
        attachmentSources.push(attachment);
      }
      const content = String(body.content || "");
      const serverId = resolved.serverId ?? agentServerId(agent);
      const sourceExecution = trustedExecutionForAgent(agent, body.sourceExecutionId);
      const finalExecution = trustedExecutionForAgent(agent, body.runtimeExecutionId);
      const finalReplySourceChannelId = finalExecution
        ? store.getMessage(finalExecution.messageId)?.channelId
        : undefined;
      const exactFinalReplyRequest = Boolean(
        finalExecution &&
        body.idempotencyKey === `final:${finalExecution.id}`
      );
      if (exactFinalReplyRequest && finalExecution) {
        const existingFinal = store.findFinalMessageForExecution(finalExecution.id);
        if (existingFinal) {
          res.json({
            messageId: existingFinal.id,
            message: existingFinal,
            recentUnread: [],
            executions: [],
            returnExecution: null,
            reused: true
          });
          return;
        }
      }
      // daemon 可能先上报 turn_completed、再发布 final；completed 仍可完成一次严格绑定的原 DM final reply。
      const directExecutionFinalReply = Boolean(
        finalExecution &&
        (finalExecution.status === "running" || finalExecution.status === "completed") &&
        exactFinalReplyRequest &&
        resolved.type === "dm" &&
        finalReplySourceChannelId === resolved.id &&
        !quoteMessageId &&
        attachmentIds.length === 0 &&
        body.executeMentions === false
      );
      // 普通 sourceExecution 仍只能使用活跃执行；completed 仅对上面的精确 final 请求提供来源证明。
      const contextExecution = [sourceExecution, finalExecution]
        .find((execution): execution is RuntimeExecutionRecord => Boolean(
          execution &&
          (!isTerminalRuntimeExecutionStatus(execution.status) || (directExecutionFinalReply && execution.id === finalExecution?.id))
        ));
      const sourceChannelId = contextExecution
        ? store.getMessage(contextExecution.messageId)?.channelId
        : undefined;
      const explicitMentionOnly = body.executeMentions === false || body.execute_mentions === false;
      const dmPeerAgent = sendTarget?.dmPeerAgent ?? null;
      const mentionedAgents = dmPeerAgent
        ? [dmPeerAgent]
        : mentionedAgentsForContent(content, serverId)
          .filter((item) => item.id !== agent.id && store.canAgentAccessChannel(item.id, resolved.id));
      const threadTask = resolved.type === "thread" && resolved.parentChannelId && resolved.parentMessageId
        ? store.listTasks(resolved.parentChannelId).find((item) => item.messageId === resolved.parentMessageId)
        : undefined;
      const canExecuteMentionInTarget = resolved.type === "dm" ? Boolean(dmPeerAgent) : resolved.type !== "thread" || Boolean(threadTask);
      // Agent 发出的 @agent 默认代表执行请求；显式 false 表示只保留可见 mention，不触发 handoff。
      const executeMentions = !explicitMentionOnly && mentionedAgents.length > 0 && canExecuteMentionInTarget;
      const skipGovernance = Boolean(workspaceBridgeRefForExecution(sourceExecution ?? finalExecution));
      const governance = skipGovernance ? null : prepareOutboundMessageGovernance({
        store,
        config: resolveEffectiveGovernanceRuntimeConfig({
          store,
          baseConfig: governanceConfig,
          serverId,
          agentId: agent.id
        }).config,
        agent,
        channel: resolved,
        serverId,
        auditOnlyFinalReply: directExecutionFinalReply,
        message: {
          target: String(target),
          targetChannelId: resolved.id,
          sourceChannelId,
          content,
          attachmentIds,
          executeMentions,
          sourceContexts: [
            ...(quoteMessage ? [governanceSourceForMessage(quoteMessage, "quote_message")] : []),
            ...attachmentSources.map(governanceSourceForAttachment)
          ]
        }
      });
      // 精确 final 已在治理准备阶段降为 audit-only allow；额外发送和跨上下文发送仍执行审批。
      if (governance?.blocked && !shouldAutoApproveOutboundApproval({ agent, governance })) {
        if (shouldQueueOutboundApproval(governance)) {
          const contextExecution = sourceExecution ?? finalExecution;
          const { approval, decision } = queueOutboundApproval(ctx, {
            agent,
            governance,
            action: {
              kind: "message_send",
              serverId,
              target: String(target),
              targetChannelId: resolved.id,
              content,
              attachmentIds,
              quoteMessageId,
              executeMentions,
              sourceExecutionId: sourceExecution?.id,
              finalExecutionId: finalExecution?.id
            },
            context: {
              executionId: contextExecution?.id,
              taskId: contextExecution?.taskId,
              messageId: contextExecution?.messageId,
              threadChannelId: contextExecution?.threadChannelId ?? (resolved.type === "thread" ? resolved.id : undefined)
            }
          });
          res.status(409).json(outboundApprovalRequiredResponse(approval, governance, decision));
          return;
        }
        const decision = governance.record?.(blockedSubjectId("message_send"));
        if (decision) emitRealtimeGovernanceDecision?.(decision);
        res.status(403).json(governanceBlockedResponse(decision ?? governance.decision, governance.caseSummary));
        return;
      }
      const result = store.sendMessage({
        target: resolved.id,
        content,
        senderType: "agent",
        senderId: agent.id,
        senderName: agent.name,
        attachmentIds,
        sourceExecutionId: sourceExecution?.id,
        quoteMessageId,
        serverId
      });
      if (governance?.record) {
        const decision = governance.record(result.message.id, {
          executionId: finalExecution?.id,
          messageId: result.message.id,
          threadChannelId: resolved.type === "thread" ? resolved.id : undefined
        });
        emitRealtimeGovernanceDecision?.(decision);
      }
      emitRealtimeMessage(result.message);
      const handoffExecutions: unknown[] = [];
      if (executeMentions) {
        for (const mentionedAgent of mentionedAgents) {
          // 默认执行语义对齐人类 @agent；上面的 opt-out 分支用于表达“只提及不执行”。
          const options = handoffOrchestration(agent, sourceExecution, result.message);
          const detail = result.message.channelType === "thread"
            ? `Starting @${mentionedAgent.name} from thread handoff.`
            : `Starting @${mentionedAgent.name} from agent DM handoff.`;
          const execution = createAndEnqueueMessageHandoffRun(mentionedAgent, result.message, detail, options);
          if (execution) handoffExecutions.push(execution);
        }
      }
      // 带 runtimeExecutionId 的最终回复是 daemon 已完成 turn 的可信信号；先收敛 execution，再处理上游 return wake。
      if (finalExecution && !isTerminalRuntimeExecutionStatus(finalExecution.status)) {
        completeRuntimeExecutionFromFinalMessage?.(finalExecution, result.message);
      }
      const returned = finalExecution
        ? dispatchReturnToAgentForFinalMessage(finalExecution.id, result.message, { deferCommunicationReturn: handoffExecutions.length > 0 })
        : null;
      deliverPendingToOnlineAgents();
      res.json({
        messageId: result.message.id,
        message: result.message,
        recentUnread: result.recentUnread,
        executions: handoffExecutions,
        returnExecution: returned?.execution
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/internal/agent/:agentId/executions/:executionId/final-message", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "message:send", res)) return;
    const execution = trustedExecutionForAgent(agent, req.params.executionId);
    if (!execution) {
      res.status(404).json({ error: "runtime_execution_not_found" });
      return;
    }
    const messageId = typeof req.body?.messageId === "string" ? req.body.messageId.trim() : "";
    const finalMessage = messageId ? store.getMessage(messageId) : null;
    if (!finalMessage || finalMessage.senderType !== "agent" || finalMessage.senderId !== agent.id || !store.canAgentAccessChannel(agent.id, finalMessage.channelId)) {
      res.status(404).json({ error: "message_not_found" });
      return;
    }
    // 显式 chat 工具发送消息时 daemon 会回调 existing final message，同样需要作为完成信号处理。
    if (!isTerminalRuntimeExecutionStatus(execution.status)) {
      completeRuntimeExecutionFromFinalMessage?.(execution, finalMessage);
    }
    const returned = dispatchReturnToAgentForFinalMessage(execution.id, finalMessage);
    deliverPendingToOnlineAgents();
    res.json({ returnExecution: returned?.execution ?? null });
  });

  app.post("/internal/agent/:agentId/tyr-return", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "message:send", res)) return;
    const execution = trustedCommunicationReturnExecutionForAgent(agent, req.body?.sourceExecutionId);
    const kind = req.body?.kind as CommunicationReturnEventKind;
    const id = typeof req.body?.eventId === "string" ? req.body.eventId.trim() : "";
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    const originRequestId = typeof req.body?.originRequestId === "string" ? req.body.originRequestId.trim() : "";
    const peerMessage = typeof req.body?.peerMessage === "string" ? req.body.peerMessage.trim() : "";
    const requestedBridgeId = typeof req.body?.requestedBridgeId === "string" ? req.body.requestedBridgeId.trim() : "";
    const facts = validateCommunicationEvidenceFacts(req.body?.facts);
    if (!execution || !execution.communicationReturnSourceMessageId || !execution.communicationReturnChannelId ||
        !execution.communicationReturnUserId || !execution.communicationReturnSource) {
      res.status(404).json({ error: "communication_return_execution_not_found" });
      return;
    }
    const source = store.getMessage(execution.communicationReturnSourceMessageId);
    if ((originRequestId || peerMessage) && (kind !== "action_request" || !originRequestId || !peerMessage || requestedBridgeId)) {
      res.status(400).json({ error: "invalid_communication_return_event",
        message: "For ordinary progress, question or result, omit originRequestId and peerMessage; the execution already identifies the request. A separate origin notification requires kind=action_request and both fields, without requestedBridgeId." });
      return;
    }
    if (!source || source.channelId !== execution.communicationReturnChannelId ||
        !["progress", "question", "action_request", "result"].includes(kind) ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(id) || !content || content.length > 12_000 || !facts ||
        (Boolean(originRequestId) !== Boolean(peerMessage)) ||
        (originRequestId && (kind !== "action_request" || requestedBridgeId ||
          !/^xmsg_[0-9a-f]{32}$/.test(originRequestId) || peerMessage.length > 12_000))) {
      res.status(400).json({ error: "invalid_communication_return_event" });
      return;
    }
    const event = recordCommunicationReturnEvent(store, {
      id,
      sourceExecutionId: execution.id,
      sourceMessageId: source.id,
      kind,
      content,
      // This is a proposal from the worker, never a route authorization.
      proposedBridgeId: requestedBridgeId || null,
      originRequestId: originRequestId || null,
      peerMessage: peerMessage || null,
      facts
    });
    if (!event) {
      res.status(409).json({ error: "communication_return_event_id_conflict" });
      return;
    }
    if (event.state === "pending") ctx.scheduleCommunicationReturnEvent?.(event.id);
    res.json({ eventId: event.id, state: event.state, reused: event.state !== "pending" });
  });

  app.get("/internal/agent/:agentId/receive", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "inbox:receive", res)) return;
    res.json({ messages: store.takeAgentInbox(agent.id).map((message: MessageRecord) => formatInternalMessage(message, agent.id)) });
  });

  app.post("/internal/agent/:agentId/receive-ack", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "inbox:receive", res)) return;
    store.ackAgentInbox(agent.id, req.body?.messageIds ?? req.body?.message_ids ?? [], (req.body?.seqs ?? []).map(Number).filter(Number.isFinite));
    res.json({ ok: true });
  });

  app.get("/internal/agent/:agentId/history", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "message:read", res)) return;
    const channel = resolveAgentChannel(agent, req.query.target ?? req.query.channel);
    if (!channel) {
      res.status(404).json({ error: "target_not_found" });
      return;
    }
    const scope = queryMessageScope(req.query.scope);
    const conversationId = queryConversationId(req.query.conversationId ?? req.query.conversation_id);
    const data = store.readHistoryForAgent(
      agent.id,
      channel.id,
      req.query.limit ? Number(req.query.limit) : 50,
      req.query.around as string | undefined,
      req.query.before ? Number(req.query.before) : undefined,
      req.query.after ? Number(req.query.after) : undefined,
      channel.serverId ?? agentServerId(agent),
      { scope, conversationId }
    );
    if (!data) {
      res.status(404).json({ error: "target_not_found" });
      return;
    }
    res.json({ ...data, messages: data.messages.map((message: MessageRecord) => formatInternalMessage(message, agent.id)) });
  });

  app.get("/internal/agent/:agentId/search", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "message:read", res)) return;
    const scope = queryMessageScope(req.query.scope);
    const conversationId = queryConversationId(req.query.conversationId ?? req.query.conversation_id);
    const target = (req.query.target ?? req.query.channel) as string | undefined;
    const channel = target && scope !== "all_accessible" ? resolveAgentChannel(agent, target) : null;
    if (target && scope !== "all_accessible" && !channel) {
      res.status(404).json({ error: "target_not_found" });
      return;
    }
    const results = store.searchMessages(String(req.query.q || ""), {
      channel: channel?.id,
      conversationId,
      scope,
      limit: req.query.limit ? Number(req.query.limit) : 10,
      serverId: channel?.serverId,
      senderId: req.query.senderId as string | undefined,
      before: req.query.before as string | undefined,
      after: req.query.after as string | undefined,
      sort: req.query.sort === "relevance" ? "relevance" : "recent",
      agentId: agent.id
    });
    res.json({
      results: results.map((message) => {
        const formatted = formatInternalMessage(message, agent.id);
        return {
          id: message.id,
          seq: message.seq,
          createdAt: message.createdAt,
          channelName: message.channelName,
          channelType: message.channelType,
          senderName: message.senderName,
          senderType: message.senderType,
          content: message.content,
          snippet: message.snippet,
          deviceRefs: formatted.deviceRefs ?? [],
          device_refs: formatted.device_refs ?? []
        };
      })
    });
  });

  const retiredTaskRoutes: Array<["get" | "post", string]> = [
    ["get", "/internal/agent/:agentId/tasks"],
    ["post", "/internal/agent/:agentId/tasks"],
    ["post", "/internal/agent/:agentId/tasks/claim"],
    ["post", "/internal/agent/:agentId/tasks/claim-message"],
    ["post", "/internal/agent/:agentId/tasks/unclaim"],
    ["post", "/internal/agent/:agentId/tasks/update-status"]
  ];
  for (const [method, path] of retiredTaskRoutes) {
    app[method](path, (req, res) => {
      const agent = authAgent(req, res);
      if (!agent) return;
      res.status(410).json({ error: "task_workflow_retired" });
    });
  }

  app.post("/internal/agent/:agentId/resolve-target", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    // 该解析仅服务附件上传的目标校验，不再为已下线的普通群聊保留独立读取权限。
    if (!requireAgentCapability(agent, "attachment:upload", res)) return;
    const channel = resolveAgentChannel(agent, req.body?.target);
    if (!channel || !store.canAgentAccessChannel(agent.id, channel.id)) {
      res.status(404).json({ error: "target_not_found" });
      return;
    }
    res.json({ channelId: channel.id, channel });
  });

  app.post("/internal/agent/:agentId/threads/unfollow", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "thread:unfollow", res)) return;
    const channel = resolveAgentChannel(agent, req.body?.target || req.body?.thread || "");
    if (!channel) {
      res.status(404).json({ error: "thread_not_found" });
      return;
    }
    const result = store.unfollowThread(agent.id, channel.id, channel.serverId ?? agentServerId(agent));
    if (!result.success) res.status(result.reason === "thread_not_found" ? 404 : 400);
    res.json(result);
  });

  app.post("/internal/agent/:agentId/upload", upload.single("file"), (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "attachment:upload", res)) {
      cleanupUploadedFile(req.file);
      return;
    }
    const validation = validateUploadedFile(req.file);
    if (!validation.ok) {
      cleanupUploadedFile(req.file);
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const file = req.file!;
    if (!req.body.channelId) {
      cleanupUploadedFile(req.file);
      res.status(400).json({ error: "file_and_target_required" });
      return;
    }
    if (!store.canAgentSendToChannel(agent.id, req.body.channelId)) {
      cleanupUploadedFile(req.file);
      res.status(403).json({ error: "target_not_accessible" });
      return;
    }
    const channel = store.resolveTarget(String(req.body.channelId), agentServerId(agent));
    if (!channel) {
      cleanupUploadedFile(req.file);
      res.status(404).json({ error: "target_not_found" });
      return;
    }
    const filename = uploadFilename(file.originalname);
    const mimeType = effectiveAttachmentMimeType({ filename, mimeType: file.mimetype || "application/octet-stream" });
    const sourcePath = typeof req.body.sourcePath === "string" && req.body.sourcePath.trim() ? req.body.sourcePath.trim() : undefined;
    const sourceExecutionId = req.body.sourceExecutionId ?? req.body.source_execution_id;
    const sourceExecution = trustedExecutionForAgent(agent, sourceExecutionId);
    if (sourceExecutionId && !sourceExecution) {
      cleanupUploadedFile(req.file);
      res.status(404).json({ error: "source_execution_not_found" });
      return;
    }
    const contentPreview = readAttachmentGovernancePreview(file);
    const governance = prepareAttachmentUploadGovernance({
      store,
      config: resolveEffectiveGovernanceRuntimeConfig({
        store,
        baseConfig: governanceConfig,
        serverId: channel.serverId ?? agentServerId(agent),
        agentId: agent.id
      }).config,
      agent,
      channel,
      serverId: channel.serverId ?? agentServerId(agent),
      upload: {
        filename,
        mimeType,
        sizeBytes: file.size,
        sourcePath,
        sourceContexts: governanceSourcesForUploadSourcePath(sourcePath, channel.id),
        contentPreview
      }
    });
    if (governance?.blocked && !shouldAutoApproveOutboundApproval({ agent, governance })) {
      if (shouldQueueOutboundApproval(governance)) {
        const { approval, decision } = queueOutboundApproval(ctx, {
          agent,
          governance,
          action: {
            kind: "attachment_upload",
            serverId: channel.serverId ?? agentServerId(agent),
            channelId: channel.id,
            filename,
            mimeType,
            sizeBytes: file.size,
            path: file.path,
            sourcePath,
            sourceExecutionId: sourceExecution?.id
          },
          context: {
            // 非 thread 上传的审批也必须锚定原始 Human 可见 execution，供后续审批 ACL 校验。
            executionId: sourceExecution?.id,
            messageId: sourceExecution?.messageId,
            threadChannelId: channel.type === "thread" ? channel.id : undefined
          }
        });
        res.status(409).json(outboundApprovalRequiredResponse(approval, governance, decision));
        return;
      }
      const decision = governance.record?.(blockedSubjectId("attachment_upload"));
      if (decision) emitRealtimeGovernanceDecision?.(decision);
      cleanupUploadedFile(req.file);
      res.status(403).json(governanceBlockedResponse(decision ?? governance.decision, governance.caseSummary));
      return;
    }
    const attachment = store.createAttachment({
      channelId: req.body.channelId,
      filename,
      mimeType,
      sizeBytes: file.size,
      path: file.path
    });
    if (governance?.record) {
      const decision = governance.record(attachment.id, {
        threadChannelId: channel.type === "thread" ? channel.id : undefined
      });
      emitRealtimeGovernanceDecision?.(decision);
    }
    res.json({ id: attachment.id, filename: attachment.filename, sizeBytes: attachment.sizeBytes });
  });

  app.get("/internal/agent/:agentId/attachments/:attachmentId", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    if (!requireAgentCapability(agent, "attachment:view", res)) return;
    const attachment = agentCanAccessAttachment(agent.id, req.params.attachmentId);
    if (!attachment) {
      res.status(404).json({ error: "attachment_not_found" });
      return;
    }
    if (attachment.mimeType.startsWith("image/")) res.type(attachment.mimeType);
    res.download(attachment.path, attachment.filename);
  });

  app.get("/internal/agent/:agentId/shared-files", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    // 只暴露当前 Agent 的分配元数据；正文仍必须通过单文件读取接口获取。
    const files = store.listAgentSharedFiles(agent.id).map(({ file, permission }) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      version: file.version,
      permission,
      localPath: `shared/${file.name}`
    }));
    res.json({ files });
  });

  app.get("/internal/agent/:agentId/shared-files/:fileRef", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    const assignment = assignedWorkspaceSharedFile(agent, req.params.fileRef);
    if (!assignment) {
      res.status(404).json({ error: "workspace_shared_file_assignment_not_found" });
      return;
    }
    const result = workspaceSharedFiles.content(assignment.file.id, agentServerId(agent));
    if (!result) {
      res.status(404).json({ error: "workspace_shared_file_not_found" });
      return;
    }
    if (result.contents.byteLength > MAX_AGENT_SHARED_FILE_TOOL_BYTES) {
      res.status(413).json({ error: "workspace_shared_file_tool_content_too_large" });
      return;
    }
    const content = result.contents.toString("utf8");
    if (!Buffer.from(content, "utf8").equals(result.contents)) {
      res.status(415).json({ error: "workspace_shared_file_tool_text_required" });
      return;
    }
    res.json({
      file: {
        id: result.file.id,
        name: result.file.name,
        mimeType: result.file.mimeType,
        sizeBytes: result.file.sizeBytes,
        sha256: result.file.sha256,
        version: result.file.version,
        permission: assignment.permission
      },
      content
    });
  });

  app.put("/internal/agent/:agentId/shared-files/:fileRef/content", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    const assignment = assignedWorkspaceSharedFile(agent, req.params.fileRef);
    if (!assignment) {
      res.status(404).json({ error: "workspace_shared_file_assignment_not_found" });
      return;
    }
    if (assignment.permission !== "read-write") {
      res.status(403).json({ error: "workspace_shared_file_read_only" });
      return;
    }
    const sourceExecution = trustedExecutionForAgent(agent, req.body?.sourceExecutionId);
    if (!sourceExecution || isTerminalRuntimeExecutionStatus(sourceExecution.status)) {
      res.status(400).json({ error: "trusted_execution_required" });
      return;
    }
    const expectedVersion = Number(req.body?.expectedVersion);
    const content = typeof req.body?.content === "string" ? req.body.content : null;
    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0 || content === null) {
      res.status(400).json({ error: "workspace_shared_file_update_invalid" });
      return;
    }
    const contents = Buffer.from(content, "utf8");
    if (contents.byteLength > MAX_AGENT_SHARED_FILE_TOOL_BYTES) {
      res.status(413).json({ error: "workspace_shared_file_tool_content_too_large" });
      return;
    }
    try {
      const updated = workspaceSharedFiles.acceptAgentUpdate({
        agentId: agent.id,
        fileId: assignment.file.id,
        baseVersion: expectedVersion,
        name: assignment.file.name,
        mimeType: assignment.file.mimeType,
        contents,
        sha256: createHash("sha256").update(contents).digest("hex")
      });
      // 审计仅保留版本和执行关联，不复制共享文件正文或 diff。
      store.recordAuditEvent({
        kind: "agent_workspace_shared_file_updated",
        actorType: "agent",
        actorId: agent.id,
        resourceType: "workspace_shared_file",
        resourceId: updated.id,
        serverId: agentServerId(agent),
        metadata: {
          fileId: updated.id,
          fileName: updated.name,
          previousVersion: expectedVersion,
          version: updated.version,
          executionId: sourceExecution.id
        }
      });
      publishWorkspaceSync();
      res.json({ file: updated });
    } catch (error) {
      if (error instanceof WorkspaceSharedFileError) {
        res.status(error.status).json({ error: error.code });
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/internal/agent/:agentId/profile", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    const target = String(req.query.target || `@${agent.name}`).replace(/^@/, "");
    const normalizedTarget = target.toLowerCase();
    const identities = visibleIdentitiesForAgent(agent);
    const otherAgent = identities.agents.find((item) => (
      item.id === target ||
      item.name.toLowerCase() === normalizedTarget ||
      item.displayName.toLowerCase() === normalizedTarget
    ));
    const human = identities.humans.find((item) => (
      item.id === target ||
      item.name.toLowerCase() === normalizedTarget ||
      item.displayName.toLowerCase() === normalizedTarget
    ));
    if (otherAgent) {
      const machine = otherAgent.machineId ? store.getMachine(otherAgent.machineId) : null;
      res.json({ profile: { ...otherAgent, kind: "agent", agentKind: otherAgent.kind, computerName: machine?.name, computerHostname: machine?.hostname, daemonVersion: machine?.daemonVersion } });
      return;
    }
    if (human) {
      res.json({ profile: { kind: "human", ...human, membershipStatus: "active" } });
      return;
    }
    res.status(404).json({ error: "profile_not_found" });
  });

  app.put("/internal/agent/:agentId/profile", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    let updated = store.updateAgentProfile(agent.id, {
      displayName: req.body?.displayName ?? req.body?.display_name,
      description: req.body?.description,
      avatarUrl: req.body?.avatarUrl ?? req.body?.avatar_url
    });
    const permissionMode = req.body?.permissionMode ?? req.body?.permission_mode;
    if (permissionMode === "dev-full-access" || permissionMode === "workspace-write" || permissionMode === "read-only") {
      updated = store.updateAgentPermissionMode(agent.id, permissionMode);
    }
    if (updated) {
      emitAgentNavigationRealtimeEvent(broadcastRealtime, "agent:updated", {
        agentId: updated.id,
        machineId: updated.machineId,
        serverId: agentServerId(updated)
      });
    }
    res.json({ profile: updated ?? agent });
  });

  app.get("/internal/agent/:agentId/reminders", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    res.json({ reminders: store.listReminders(agent.id, req.query.status as string | undefined).map(formatReminder) });
  });

  app.post("/internal/agent/:agentId/reminders", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    const fireAt = req.body?.fireAt ?? (req.body?.delaySeconds ? new Date(Date.now() + Number(req.body.delaySeconds) * 1000).toISOString() : undefined);
    if (!req.body?.title || !fireAt) {
      res.status(400).json({ error: "title_and_fire_time_required" });
      return;
    }
    const reminder = store.createReminder(agent.id, req.body.title, fireAt, req.body.msgId, req.body.channelId, req.body.repeat);
    const formatted = formatReminder(reminder);
    sendReminderUpsert(agent, formatted);
    res.json({ reminder: formatted });
  });

  app.patch("/internal/agent/:agentId/reminders/:reminderId", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    const reminder = store.updateReminder(agent.id, req.params.reminderId, {
      title: req.body?.title,
      fireAt: req.body?.fireAt,
      delaySeconds: req.body?.delaySeconds,
      repeat: req.body?.repeat
    });
    if (!reminder) {
      res.status(404).json({ error: "reminder_not_found" });
      return;
    }
    const formatted = formatReminder(reminder);
    sendReminderUpsert(agent, formatted);
    res.json({ reminder: formatted });
  });

  app.post("/internal/agent/:agentId/reminders/:reminderId/snooze", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    const delaySeconds = Number(req.body?.delaySeconds);
    if (!Number.isFinite(delaySeconds) || delaySeconds <= 0) {
      res.status(400).json({ error: "delay_seconds_required" });
      return;
    }
    const reminder = store.snoozeReminder(agent.id, req.params.reminderId, delaySeconds);
    if (!reminder) {
      res.status(404).json({ error: "reminder_not_found" });
      return;
    }
    const formatted = formatReminder(reminder);
    sendReminderUpsert(agent, formatted);
    res.json({ reminder: formatted });
  });

  app.get("/internal/agent/:agentId/reminders/:reminderId/log", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    const events = store.listReminderEvents(agent.id, req.params.reminderId);
    if (!events) {
      res.status(404).json({ error: "reminder_not_found" });
      return;
    }
    res.json({ events });
  });

  app.delete("/internal/agent/:agentId/reminders/:reminderId", (req, res) => {
    const agent = authAgent(req, res);
    if (!agent) return;
    const reminder = store.cancelReminder(agent.id, req.params.reminderId);
    if (!reminder) {
      res.status(404).json({ error: "reminder_not_found" });
      return;
    }
    const formatted = formatReminder(reminder);
    sendReminderCancel(agent, formatted.reminderId, formatted.version);
    res.json({ reminder: formatted });
  });

  function readAttachmentGovernancePreview(file: Express.Multer.File): string | undefined {
    if (!isTextUpload(file.mimetype || "application/octet-stream", file.originalname || file.filename || "")) return undefined;
    const byteLength = Math.min(file.size, ATTACHMENT_GOVERNANCE_PREVIEW_BYTES);
    if (byteLength <= 0) return "";
    const buffer = Buffer.alloc(byteLength);
    let fd: number | null = null;
    try {
      fd = openSync(file.path, "r");
      const bytesRead = readSync(fd, buffer, 0, byteLength, 0);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } catch {
      return undefined;
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // Best effort cleanup for preview file descriptors.
        }
      }
    }
  }

  function assignedWorkspaceSharedFile(agent: AgentRecord, fileRef: string) {
    const normalized = String(fileRef ?? "").trim();
    if (!normalized) return null;
    // 文件名必须精确匹配，避免模糊解析把 Agent 引向未分配资源。
    return store.listAgentSharedFiles(agent.id).find(({ file }) => file.id === normalized || file.name === normalized) ?? null;
  }

  function isTextUpload(mimeType: string, filename: string): boolean {
    if (mimeType.startsWith("text/")) return true;
    if (/json|xml|yaml|toml|csv|javascript|typescript|x-sh|shellscript|dotenv/i.test(mimeType)) return true;
    return /\.(txt|md|json|jsonl|yaml|yml|toml|env|ini|csv|log|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|sh|bash|zsh|sql)$/i.test(filename);
  }
}
