import path from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type express from "express";
import { isCommunicationAgent, type ChannelRecord, type MessageDeviceRef, type MessageRecord } from "@tyr-ai/contracts";
import { getMessageSubmission, messageSubmissionDispatcher, messageSubmissionHash, recordMessageSubmission, type MessageSubmission } from "../message-submissions";
import { effectiveAttachmentMimeType, isArchiveAttachment, sanitizeAttachmentText } from "../attachment-files";
import { sanitizeHumanVisibleText } from "../output-disclosure";
import type { ServerRouteContext } from "../server-context";

export function registerTaskMessageRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const {
    store,
    upload,
    cleanupUploadedFile,
    validateUploadedFile,
    uploadFilename,
    authUser,
    primaryServerIdForUser,
    emitRealtimeMessage,
    emitRealtimeRuntimeExecution,
    formatPublicMessage,
    dispatchQueuedAgentInbox,
    createQueuedMessageRuntimeExecutionsForMessage,
    buildAttachmentPreview,
    attachmentPreviewType,
    formatReminder
  } = ctx;

  function primaryServerId(userId: string): string | undefined {
    // Route tests can register this slice with a partial context; production still resolves the active workspace server.
    return typeof primaryServerIdForUser === "function" ? primaryServerIdForUser(userId) ?? undefined : undefined;
  }

  function visibleChannel(userId: string, channelId: string): ChannelRecord | null {
    const channel = store.resolveTarget(channelId, primaryServerId(userId));
    return channel && store.canUserAccessChannel(userId, channel.id) ? channel : null;
  }

  function visibleMessage(userId: string, messageId: string): MessageRecord | null {
    const message = store.getMessage(messageId);
    return message && store.canUserAccessChannel(userId, message.channelId) ? message : null;
  }

  function canReadAttachmentChannel(userId: string, channelId: string): boolean {
    if (store.canUserAccessChannel(userId, channelId)) return true;
    // Bridge copies live in hidden endpoint DMs. Either endpoint's non-guest members may read the copied artifact,
    // while the original private attachment remains governed by its original channel.
    return store.listServersForUser(userId).some((membership) => (
      membership.role !== "guest" && store.listWorkspaceBridges(membership.id).some((bridge) => (
        store.getWorkspaceBridgeDm(bridge.id, bridge.workspaceAId)?.id === channelId ||
        store.getWorkspaceBridgeDm(bridge.id, bridge.workspaceBId)?.id === channelId
      ))
    ));
  }

  function rejectRetiredTaskWorkflow(res: express.Response): void {
    res.status(410).json({ error: "task_workflow_retired" });
  }

  app.get("/api/reminders", (req, res) => {
    const ownerAgentId = String(req.query.ownerAgentId || "");
    if (!ownerAgentId) {
      res.json({ reminders: [] });
      return;
    }
    res.json({ reminders: store.listReminders(ownerAgentId, req.query.status as string | undefined).map(formatReminder) });
  });

  function sendSubmissionReceipt(res: express.Response, submission: MessageSubmission, message: MessageRecord): void {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Message-Id", message.id);
    res.setHeader("X-Message-Submission-Id", submission.client_request_id);
    res.json({ ...formatPublicMessage(message), submission: {
      clientRequestId: submission.client_request_id, state: submission.state
    } });
  }

  app.get("/api/message-submissions/:clientRequestId", (req, res) => {
    const user = authUser(req);
    const submission = getMessageSubmission(store, user.id, String(req.params.clientRequestId));
    const message = submission ? visibleMessage(user.id, submission.message_id) : null;
    if (!submission || !message) {
      res.status(404).json({ error: "message_submission_not_found" });
      return;
    }
    sendSubmissionReceipt(res, submission, message);
  });

  app.post("/api/messages", (req, res) => {
    const user = authUser(req);
    const body = req.body ?? {};
    if (body.clientRequestId !== undefined && (typeof body.clientRequestId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(body.clientRequestId))) {
      res.status(400).json({ error: "message_submission_id_invalid" });
      return;
    }
    const clientRequestId: string = body.clientRequestId ?? `submit_${randomUUID()}`;
    if (body.asTask === true || Object.prototype.hasOwnProperty.call(body, "task")) {
      rejectRetiredTaskWorkflow(res);
      return;
    }
    const channel = body.channelId ? visibleChannel(user.id, String(body.channelId)) : null;
    if (body.channelId && !channel) {
      res.status(404).json({ error: "channel_not_found" });
      return;
    }
    const target = body.target || channel?.id;
    if (!target) {
      res.status(400).json({ error: "conversation_required" });
      return;
    }
    const { content, attachmentIds } = body;
    const serverId = primaryServerId(user.id);
    const deviceRefs: MessageDeviceRef[] = Array.isArray(body.deviceRefs)
      ? body.deviceRefs.flatMap((item: any) => {
        const deviceId = typeof item?.deviceId === "string" ? item.deviceId : "";
        const capability = typeof item?.capability === "string" ? item.capability : "";
        const device = store.getDevice(deviceId);
        // A selected device method is a one-message action request; persistent access rules are only for later background calls.
        return device && device.serverId === serverId && device.capabilities.includes(capability as MessageDeviceRef["capability"]) ? [{ deviceId, capability: capability as MessageDeviceRef["capability"] }] : [];
      })
      : [];
    const contentText = content === undefined || content === null ? "" : String(content);
    const hasAttachmentIds = Array.isArray(attachmentIds) && attachmentIds.length > 0;
    if (!contentText.trim() && deviceRefs.length === 0 && !hasAttachmentIds) {
      res.status(400).json({ error: "content_required" });
      return;
    }
    const quoteMessageId = typeof body.quoteMessageId === "string" && body.quoteMessageId.trim() ? body.quoteMessageId.trim() : undefined;
    let acceptedMessageId: string | null = null;
    try {
      const resolved = store.resolveTarget(target, serverId);
      if (!resolved || !store.canUserAccessChannel(user.id, resolved.id)) {
        res.status(404).json({ error: "channel_not_found" });
        return;
      }
      const conversationId = typeof body.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : undefined;
      const payloadHash = messageSubmissionHash({ channelId: resolved.id, conversationId: conversationId ?? null,
        content: contentText, attachmentIds: attachmentIds ?? [], deviceRefs: body.deviceRefs ?? [], quoteMessageId: quoteMessageId ?? null });
      const existing = getMessageSubmission(store, user.id, clientRequestId);
      if (existing) {
        if (existing.payload_hash !== payloadHash) {
          res.status(409).json({ error: "message_submission_conflict" });
          return;
        }
        const message = visibleMessage(user.id, existing.message_id);
        if (!message) {
          res.status(410).json({ error: "message_submission_unavailable" });
          return;
        }
        acceptedMessageId = message.id;
        sendSubmissionReceipt(res, existing, message);
        return;
      }
      if (quoteMessageId && !visibleMessage(user.id, quoteMessageId)) {
        res.status(404).json({ error: "quote_not_found" });
        return;
      }
      const parentDm = resolved.type === "thread" && resolved.parentChannelId
        ? store.resolveTarget(resolved.parentChannelId, serverId)
        : null;
      const parentDmPeerAgent = parentDm?.type === "dm" && parentDm.dmPeerAgentId
        ? store.getAgent(parentDm.dmPeerAgentId)
        : null;
      if (isCommunicationAgent(parentDmPeerAgent)) {
        // 历史 TYR thread 只保留查看；新的用户输入必须回到主 DM 才能进入 server-hosted Assistant 流程。
        res.status(400).json({ error: "assistant_dm_thread_read_only" });
        return;
      }
      if (resolved.type === "thread" && resolved.parentMessageId) {
        const parentMessage = store.getMessage(resolved.parentMessageId);
        const parentConversation = parentMessage?.conversationId ? store.getConversation(parentMessage.conversationId) : null;
        if (parentConversation?.status === "closed" || parentConversation?.archivedAt) {
          res.status(400).json({ error: "conversation_history_read_only" });
          return;
        }
      }
      const dmAssistant = resolved.type === "dm" && resolved.dmPeerAgentId ? store.getAgent(resolved.dmPeerAgentId) : null;
      const assistant = isCommunicationAgent(dmAssistant) ? dmAssistant : null;
      // The message, receipt, and durable dispatch intent commit together before the HTTP response.
      const accepted = store.db.transaction(() => {
        const result = store.sendMessage({
          target: resolved.id, conversationId, content: contentText, senderType: "human", senderId: user.id,
          senderName: user.displayName, asTask: false, attachmentIds, deviceRefs, quoteMessageId, serverId
        });
        const wakeTargets = assistant ? [] : store.selectWakeTargets(result.message);
        const detail = `Queued @${wakeTargets.map((agent) => agent.name).join(", @")} from message delivery.`;
        const executions = wakeTargets.length === 0 ? [] : createQueuedMessageRuntimeExecutionsForMessage(store, {
          message: result.message,
          threadChannelId: result.message.channelType === "thread" ? result.message.channelId : undefined,
          detail
        });
        const submission = recordMessageSubmission(store, { userId: user.id, clientRequestId,
          payloadHash, message: result.message, assistantAgentId: assistant?.id ?? null });
        return { message: result.message, submission, executions, detail };
      })();
      acceptedMessageId = accepted.message.id;
      if (assistant) messageSubmissionDispatcher(ctx).schedule();
      sendSubmissionReceipt(res, accepted.submission, accepted.message);
      console.info("[message-submission]", JSON.stringify({ event: "accepted", clientRequestId,
        messageId: accepted.message.id, state: accepted.submission.state }));
      // Realtime/mirror delivery cannot turn an accepted write into a failed send response.
      try {
        emitRealtimeMessage(accepted.message);
        if (assistant) ctx.mirrorTyrAssistantMessagesToTelegram?.({
          userId: user.id, serverId: assistant.serverId ?? resolved.serverId ?? serverId ?? "local",
          channelId: accepted.message.channelId, messages: [accepted.message]
        });
      } catch { console.error("[message-submission] realtime_or_mirror_unavailable"); }
      for (const execution of accepted.executions) {
        try { emitRealtimeRuntimeExecution(execution); } catch { /* persisted execution remains authoritative */ }
        dispatchQueuedAgentInbox(execution.agentId, accepted.detail, execution.id);
      }
    } catch (err) {
      if (res.headersSent) {
        console.error("[message-submission] post_acceptance_delivery_failed");
        return;
      }
      if (acceptedMessageId) {
        res.status(503).json({ error: "message_submission_receipt_unavailable", clientRequestId });
        return;
      }
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.all(/^\/api\/tasks(?:\/.*)?$/, (_req, res) => {
    rejectRetiredTaskWorkflow(res);
  });

  app.post("/api/uploads", upload.single("file"), (req, res) => {
    const validation = validateUploadedFile(req.file);
    if (!validation.ok) {
      cleanupUploadedFile(req.file);
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const file = req.file!;
    const user = authUser(req);
    const channelTarget = typeof req.body.channel === "string" ? req.body.channel.trim() : "";
    if (!channelTarget) {
      cleanupUploadedFile(req.file);
      res.status(400).json({ error: "conversation_required" });
      return;
    }
    const channel = store.resolveTarget(channelTarget, primaryServerId(user.id));
    if (!channel || !store.canUserAccessChannel(user.id, channel.id)) {
      cleanupUploadedFile(req.file);
      res.status(400).json({ error: "channel_not_found" });
      return;
    }
    const filename = uploadFilename(file.originalname);
    const attachment = store.createAttachment({
      channelId: channel.id,
      filename,
      mimeType: effectiveAttachmentMimeType({
        filename,
        mimeType: file.mimetype || "application/octet-stream"
      }),
      sizeBytes: file.size,
      path: file.path
    });
    res.json(attachment);
  });

  function attachmentUrls(attachmentId: string) {
    const encodedId = encodeURIComponent(attachmentId);
    return {
      inlineUrl: `/api/attachments/${encodedId}?disposition=inline`,
      downloadUrl: `/api/attachments/${encodedId}`
    };
  }

  app.get("/api/attachments/:attachmentId/preview", (req, res) => {
    const user = authUser(req);
    const attachment = store.getAttachment(req.params.attachmentId);
    if (!attachment || !canReadAttachmentChannel(user.id, attachment.channelId)) {
      res.status(404).json({ error: "attachment_not_found" });
      return;
    }
    const previewType = attachmentPreviewType(attachment);
    if (previewType === "image" || previewType === "download") {
      res.json(buildAttachmentPreview(attachment, Buffer.alloc(0), attachmentUrls(attachment.id)));
      return;
    }
    if (!existsSync(attachment.path)) {
      res.status(404).json({ error: "attachment_file_missing" });
      return;
    }
    // 文本类预览只读本地上传文件，返回前会在 helper 中按固定上限截断。
    res.json(buildAttachmentPreview(attachment, readFileSync(attachment.path), attachmentUrls(attachment.id)));
  });

  app.get("/api/attachments/:attachmentId", (req, res) => {
    const user = authUser(req);
    const attachment = store.getAttachment(req.params.attachmentId);
    if (!attachment || !canReadAttachmentChannel(user.id, attachment.channelId)) {
      res.status(404).json({ error: "attachment_not_found" });
      return;
    }
    if (!existsSync(attachment.path)) {
      res.status(404).json({ error: "attachment_file_missing" });
      return;
    }
    const previewType = attachmentPreviewType(attachment);
    const content = readFileSync(attachment.path);
    if (previewType === "text" || previewType === "markdown" || previewType === "json" || previewType === "csv") {
      const sourceText = content.toString("utf8");
      const publicText = sanitizeAttachmentText(attachment, sourceText);
      res.type(effectiveAttachmentMimeType(attachment));
      res.setHeader(
        "Content-Disposition",
        `${req.query.disposition === "inline" ? "inline" : "attachment"}; filename="${encodeURIComponent(attachment.filename)}"`
      );
      res.send(Buffer.from(publicText, "utf8"));
      return;
    }
    // 二进制不能安全改写；若可见字节已经命中凭据规则，则拒绝下载，避免返回损坏或部分脱敏文件。
    const binaryText = content.toString("utf8");
    if (sanitizeHumanVisibleText(binaryText) !== binaryText) {
      res.status(403).json({ error: "attachment_sensitive_content" });
      return;
    }
    if (req.query.disposition === "inline" && !isArchiveAttachment(attachment)) {
      res.type(effectiveAttachmentMimeType(attachment));
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.filename)}"`);
      res.sendFile(path.resolve(attachment.path));
      return;
    }
    // 归档只作为原始附件交付；即使调用方请求 inline，也始终走下载响应且不在服务端解压。
    res.download(attachment.path, attachment.filename);
  });
}
