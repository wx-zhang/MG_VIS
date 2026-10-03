import { claimWorkspaceBridgeTerminal, workspaceBridgeResponseKind } from "./workspace-bridge-lifecycle";
import { supersededBridgeExecutionIds } from "./bridge-followup-dependencies";
import type {
  CommunicationAgentProgressPhase,
  CommunicationEvidenceRecord,
  CommunicationEvidenceSelection,
  CrossWorkspaceMessageResponseKind,
  CrossWorkspaceMessageRecord,
  MessageRecord,
  MessageResult,
  RuntimeExecutionRecord,
  WorkspaceBridgeRecord
} from "@tyr-ai/contracts";
import {
  maybeReplyToCommunicationAgentDm,
  type CommunicationAgentContinuationDraft,
  type CommunicationAgentReplyOutcome
} from "./communication-agent";
import type { ServerRouteContext } from "./server-context";
import { getCommunicationEvidenceForBridgeMessage, publishCommunicationEvidenceForBridgeMessage, selectCommunicationEvidenceForContext } from "./communication-evidence";

function evidenceSelectionsForRecords(records: CommunicationEvidenceRecord[] | undefined): CommunicationEvidenceSelection[] {
  return (records ?? []).map((record) => ({
    receiptId: record.receiptId,
    ...(record.facts.length ? { keys: record.facts.map((fact) => fact.key) } : {}),
    ...(record.excerpt ? { excerpt: record.excerpt } : {})
  }));
}

function evidenceScopeForExecution(execution: RuntimeExecutionRecord) {
  if (!execution.serverId || !execution.communicationReturnSourceMessageId || !execution.communicationReturnChannelId) return null;
  return { serverId: execution.serverId, sourceMessageId: execution.communicationReturnSourceMessageId,
    channelId: execution.communicationReturnChannelId, conversationId: execution.communicationReturnConversationId ?? null };
}

function publishReplyEvidence(store: ServerRouteContext["store"], messageId: string, reply: MessageRecord,
  scope: { serverId: string; sourceMessageId: string; channelId: string; conversationId: string | null }): CommunicationEvidenceRecord[] {
  const selections = evidenceSelectionsForRecords(reply.result?.evidence);
  return selections.length ? publishCommunicationEvidenceForBridgeMessage(store, {
    messageId, scope, selections
  }) : [];
}

const WORKSPACE_BRIDGE_RETURN_KIND = "workspace_bridge";

export interface WorkspaceBridgeCommunicationReturnRef {
  kind: typeof WORKSPACE_BRIDGE_RETURN_KIND;
  bridgeId: string;
  conversationId: string;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  requestMessageId: string;
}

export function workspaceBridgeCommunicationReturnExternalRef(input: Omit<WorkspaceBridgeCommunicationReturnRef, "kind">): string {
  return JSON.stringify({ kind: WORKSPACE_BRIDGE_RETURN_KIND, ...input });
}

export function parseWorkspaceBridgeCommunicationReturnRef(value: string | undefined): WorkspaceBridgeCommunicationReturnRef | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    if (candidate.kind !== WORKSPACE_BRIDGE_RETURN_KIND) return null;
    const bridgeId = stringField(candidate.bridgeId);
    const conversationId = stringField(candidate.conversationId);
    const sourceWorkspaceId = stringField(candidate.sourceWorkspaceId);
    const targetWorkspaceId = stringField(candidate.targetWorkspaceId);
    const requestMessageId = stringField(candidate.requestMessageId);
    if (!bridgeId || !conversationId || !sourceWorkspaceId || !targetWorkspaceId || !requestMessageId) return null;
    return { kind: WORKSPACE_BRIDGE_RETURN_KIND, bridgeId, conversationId, sourceWorkspaceId, targetWorkspaceId, requestMessageId };
  } catch {
    return null;
  }
}

export function workspaceBridgeRefForExecution(execution: RuntimeExecutionRecord | null | undefined): WorkspaceBridgeCommunicationReturnRef | null {
  return parseWorkspaceBridgeCommunicationReturnRef(execution?.communicationReturnExternalRef);
}

export function createWorkspaceBridgeReturnMessageForFinalMessage(store: Pick<
  ServerRouteContext["store"],
  "db" |
  "createCrossWorkspaceTerminalMessage" |
  "createAttachment" |
  "ensureDefaultCommunicationAgent" |
  "getAttachment" |
  "getConversation" |
  "getMessage" |
  "getCrossWorkspaceMessage" |
  "getWorkspaceBridgeForServer" |
  "listRuntimeExecutions" |
  "getRuntimeExecution" |
  "listRuntimeExecutionEvents" |
  "recordAuditEvent" |
  "sendMessage" |
  "updateCrossWorkspaceMessage"
>, input: {
  completedExecution: RuntimeExecutionRecord;
  finalMessage: MessageRecord;
  communicationReturnMessage: MessageRecord;
}): CrossWorkspaceMessageRecord | null {
  const ref = workspaceBridgeRefForExecution(input.completedExecution);
  if (!ref) return null;
  const bridge = store.getWorkspaceBridgeForServer(ref.bridgeId, ref.sourceWorkspaceId)
    ?? store.getWorkspaceBridgeForServer(ref.bridgeId, ref.targetWorkspaceId);
  if (!bridge) return null;
  const request = store.getCrossWorkspaceMessage(ref.requestMessageId);
  if (
    !request ||
    request.bridgeId !== ref.bridgeId ||
    request.conversationId !== ref.conversationId ||
    request.sourceWorkspaceId !== ref.sourceWorkspaceId ||
    request.targetWorkspaceId !== ref.targetWorkspaceId ||
    request.initiatedBy !== "human" ||
    request.replyToMessageId
  ) return null;
  return createWorkspaceBridgeTerminalFromExecutions(store, request, bridge, input.completedExecution, {
    communicationReturnMessage: input.communicationReturnMessage,
    peerMessageId: input.finalMessage.id
  })?.bridgeMessage ?? null;
}

export function createWorkspaceBridgeReturnMessageForFailedExecution(store: Pick<
  ServerRouteContext["store"],
  "db" |
  "createCrossWorkspaceTerminalMessage" |
  "createAttachment" |
  "ensureDefaultCommunicationAgent" |
  "getAttachment" |
  "getConversation" |
  "getMessage" |
  "getCrossWorkspaceMessage" |
  "getWorkspaceBridgeForServer" |
  "listRuntimeExecutions" |
  "getRuntimeExecution" |
  "listRuntimeExecutionEvents" |
  "recordAuditEvent" |
  "sendMessage" |
  "updateCrossWorkspaceMessage"
>, input: {
  failedExecution: RuntimeExecutionRecord;
}): { bridgeMessage: CrossWorkspaceMessageRecord; originMessage: MessageRecord | null } | null {
  const ref = workspaceBridgeRefForExecution(input.failedExecution);
  if (!ref || !["failed", "stalled", "cancelled"].includes(input.failedExecution.status)) return null;
  const bridge = store.getWorkspaceBridgeForServer(ref.bridgeId, ref.sourceWorkspaceId)
    ?? store.getWorkspaceBridgeForServer(ref.bridgeId, ref.targetWorkspaceId);
  const request = store.getCrossWorkspaceMessage(ref.requestMessageId);
  if (
    !bridge ||
    !request ||
    request.bridgeId !== ref.bridgeId ||
    request.conversationId !== ref.conversationId ||
    request.sourceWorkspaceId !== ref.sourceWorkspaceId ||
    request.targetWorkspaceId !== ref.targetWorkspaceId
  ) return null;
  return createWorkspaceBridgeTerminalFromExecutions(store, request, bridge, input.failedExecution);
}

type WorkspaceBridgeExecutionTerminalStore = Pick<
  ServerRouteContext["store"],
  "db" |
  "createCrossWorkspaceTerminalMessage" |
  "createAttachment" |
  "ensureDefaultCommunicationAgent" |
  "getAttachment" |
  "getConversation" |
  "getMessage" |
  "getCrossWorkspaceMessage" |
  "listRuntimeExecutions" |
  "getRuntimeExecution" |
  "listRuntimeExecutionEvents" |
  "recordAuditEvent" |
  "sendMessage" |
  "updateCrossWorkspaceMessage"
>;

function copyWorkspaceBridgeAttachments(
  store: Pick<ServerRouteContext["store"], "createAttachment" | "getAttachment">,
  attachmentIds: string[],
  channelId: string
): string[] {
  return [...new Set(attachmentIds)].flatMap((attachmentId) => {
    const attachment = store.getAttachment(attachmentId);
    if (!attachment) return [];
    const copy = store.createAttachment({
      channelId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      path: attachment.path
    });
    return [copy.id];
  });
}

function createWorkspaceBridgeTerminalFromExecutions(
  store: WorkspaceBridgeExecutionTerminalStore,
  request: CrossWorkspaceMessageRecord,
  bridge: WorkspaceBridgeRecord,
  triggeringExecution: RuntimeExecutionRecord,
  current?: { communicationReturnMessage: MessageRecord; peerMessageId: string }
): { bridgeMessage: CrossWorkspaceMessageRecord; originMessage: MessageRecord | null } | null {
  return store.db.transaction(() => {
    const peerExecutions = (store.db.prepare(`select id from runtime_executions where server_id = ?
      and case when json_valid(communication_return_external_ref) then
        json_extract(communication_return_external_ref, '$.requestMessageId') = ? else 0 end
      order by created_at, id`).all(request.targetWorkspaceId, request.id) as Array<{ id: string }>)
      .flatMap(({ id }) => { const execution = store.getRuntimeExecution(id); return execution ? [execution] : []; });
    if (!peerExecutions.length) return null;
    const terminalStatuses = new Set<RuntimeExecutionRecord["status"]>(["completed", "failed", "stalled", "cancelled"]);
    // 多 Agent Bridge 请求必须等所有委派执行结束后，才能生成唯一的汇总终态。
    if (peerExecutions.some((execution) => !terminalStatuses.has(execution.status))) return null;

    const persistedCompletedOutputs = peerExecutions.map((execution) => {
      if (execution.status !== "completed") return null;
      if (execution.id === triggeringExecution.id && current) return current.communicationReturnMessage;
      return execution.communicationReturnMessageId ? store.getMessage(execution.communicationReturnMessageId) : null;
    });
    // 已完成但尚无持久化回传的 worker 仍处于恢复过程，不能提前发布错误终态。
    if (persistedCompletedOutputs.some((message, index) => peerExecutions[index]?.status === "completed" && !message)) return null;

    const continuationRootMessageIds = new Set(peerExecutions.flatMap((execution) => execution.rootMessageId ? [execution.rootMessageId] : []));
    const supersededExecutions = supersededBridgeExecutionIds(store, request.id, peerExecutions);
    const reportedExecutions = peerExecutions.flatMap((execution, index) => {
      const output = persistedCompletedOutputs[index];
      // A completed execution can be acknowledged by the visible root of its next TYR handoff.
      // That message is durable replay state, not a business result, so only the leaf execution is reported.
      if (supersededExecutions.has(execution.id) || (output && continuationRootMessageIds.has(output.id))) return [];
      return [{ execution, output }];
    });
    if (reportedExecutions.length === 0) return null;
    // A waiting leaf remains part of the original request. A successful sibling
    // cannot complete it; only a persisted successor relation is excluded above.
    if (reportedExecutions.some(({ output }) => output?.result?.status === "partial")) return null;

    const completedCount = reportedExecutions.filter(({ execution, output }) =>
      execution.status === "completed" && output?.result?.status !== "failed" && Boolean(output)).length;
    const sourceAgentNames = [`${bridge.peerWorkspace?.name ?? "Connected workspace"} TYR`];
    const responseKind = completedCount === reportedExecutions.length ? "final" : "error";
    const peerWorkspaceName = bridge.peerWorkspace?.name ?? "Connected workspace";
    const bridgeStatus = bridge.status === "active"
      ? "The request reached the peer workspace, and the Workspace Bridge remains active."
      : `Workspace Bridge status: ${bridge.status}.`;
    const content = reportedExecutions.length === 1
      ? reportedExecutions[0]!.output?.content ?? (() => {
        const execution = reportedExecutions[0]!.execution;
        return `${peerWorkspaceName} could not complete the request. ${bridgeStatus}`;
      })()
      : reportedExecutions.map(({ execution, output }) => {
        return output
          ? output.content
          : `${peerWorkspaceName} could not complete this step.`;
      }).join("\n\n") + `\n\n${bridgeStatus}`;
    const bridgeConversation = request.conversationId ? store.getConversation(request.conversationId) : null;
    const attachmentIds = bridgeConversation
      ? copyWorkspaceBridgeAttachments(
        store,
        reportedExecutions.flatMap(({ output }) => output?.attachmentIds ?? []),
        bridgeConversation.channelId
      )
      : [];
    const claimed = store.db.transaction(() => {
      const result = claimWorkspaceBridgeTerminal(store, {
      bridgeId: request.bridgeId,
      conversationId: request.conversationId!,
      responseKind,
      sourceWorkspaceId: request.targetWorkspaceId,
      targetWorkspaceId: request.sourceWorkspaceId,
      initiatedBy: "agent",
      content,
      outcome: responseKind === "final" ? "delivered" : "failed",
      localMessageId: current?.communicationReturnMessage.id ?? null,
      peerMessageId: current?.peerMessageId ?? null,
      attachmentIds,
      sourceAgentNames,
      replyToMessageId: request.id
      });
      const groups = new Map<string, { scope: NonNullable<ReturnType<typeof evidenceScopeForExecution>>; selections: Map<string, CommunicationEvidenceSelection> }>();
      if (result?.created) for (const { execution, output } of reportedExecutions) {
        const selections = evidenceSelectionsForRecords(output?.result?.evidence);
        const scope = evidenceScopeForExecution(execution);
        if (!selections.length || !scope) continue;
        const groupKey = JSON.stringify(scope);
        const group = groups.get(groupKey) ?? { scope, selections: new Map<string, CommunicationEvidenceSelection>() };
        groups.set(groupKey, group);
        for (const selection of selections) {
          const prior = group.selections.get(selection.receiptId);
          if (prior?.excerpt && selection.excerpt && prior.excerpt !== selection.excerpt) throw new Error("communication_evidence_excerpt_conflict");
          group.selections.set(selection.receiptId, {
            receiptId: selection.receiptId,
            keys: [...new Set([...(prior?.keys ?? []), ...(selection.keys ?? [])])],
            ...(prior?.excerpt || selection.excerpt ? { excerpt: prior?.excerpt ?? selection.excerpt } : {})
          });
        }
      }
      if (result && groups.size) publishCommunicationEvidenceForBridgeMessage(store as ServerRouteContext["store"], {
        messageId: result.message.id,
        contextSelections: [...groups.values()].map(({ scope, selections }) => ({ scope, selections: [...selections.values()] }))
      });
      return result;
    })();
    if (!claimed?.created) return null;
    const evidence = getCommunicationEvidenceForBridgeMessage(store, claimed.message.id);
    const originMessage = createWorkspaceBridgeOriginMessage(store, request, {
      content,
      status: responseKind === "final" ? "completed" : "failed",
      peerWorkspaceName,
      sourceAgentNames,
      attachmentIds: claimed.message.attachmentIds ?? attachmentIds,
      ...(evidence.length ? { evidence } : {})
    });
    const savedBridgeMessage = originMessage
      ? store.updateCrossWorkspaceMessage(claimed.message.id, { originMessageId: originMessage.id }) ?? claimed.message
      : claimed.message;
    const bridgeMessage = evidence.length ? { ...savedBridgeMessage, evidence } : savedBridgeMessage;
    recordWorkspaceBridgeLifecycleAudit(
      store,
      responseKind === "final" ? "workspace_bridge_request_completed" : "workspace_bridge_request_failed",
      request,
      {
        responseMessageId: bridgeMessage.id,
        responseKind,
        peerExecutionIds: peerExecutions.map((execution) => execution.id)
      }
    );
    return { bridgeMessage, originMessage };
  })();
}

/** Repair only publication of a persisted TYR review; never rerun a worker or model. */
export function reconcileReviewedWorkspaceBridgeResult(store: ServerRouteContext["store"], executionId: string) {
  const execution = store.getRuntimeExecution(executionId);
  const ref = workspaceBridgeRefForExecution(execution);
  const request = ref ? store.getCrossWorkspaceMessage(ref.requestMessageId) : null;
  const reviewed = execution?.communicationReturnMessageId ? store.getMessage(execution.communicationReturnMessageId) : null;
  const final = execution ? store.findFinalMessageForExecution(execution.id) : null;
  if (!execution || execution.status !== "completed" || !ref || !request || !reviewed || !final ||
      reviewed.deletedAt || final.deletedAt || final.senderId !== execution.agentId ||
      reviewed.senderType !== "agent" || reviewed.senderId !== request.receiverCommsAgentId ||
      reviewed.channelId !== execution.communicationReturnChannelId || reviewed.conversationId !== request.conversationId ||
      !["completed", "failed"].includes(reviewed.result?.status ?? "") ||
      request.bridgeId !== ref.bridgeId || request.conversationId !== ref.conversationId ||
      request.targetWorkspaceId !== execution.serverId || request.sourceWorkspaceId !== ref.sourceWorkspaceId ||
      request.targetWorkspaceId !== ref.targetWorkspaceId || request.resolvedByTerminalId ||
      execution.communicationReturnUserId !== request.targetCapabilityUserId) return null;
  const bridge = store.getWorkspaceBridgeForServer(request.bridgeId, request.sourceWorkspaceId);
  if (!bridge) return null;
  return createWorkspaceBridgeTerminalFromExecutions(store, request, bridge, execution, {
    communicationReturnMessage: reviewed, peerMessageId: final.id
  });
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type WorkspaceBridgeOriginMessageStore = Pick<
  ServerRouteContext["store"],
  "createAttachment" | "ensureDefaultCommunicationAgent" | "getAttachment" | "sendMessage"
>;

function workspaceBridgeOriginMessageResult(request: CrossWorkspaceMessageRecord, input: {
  content: string;
  status: "completed" | "failed" | "partial";
  peerWorkspaceName: string;
  sourceAgentNames?: string[];
  sourceHumanName?: string;
  eventKind?: CrossWorkspaceMessageResponseKind;
  evidence?: CommunicationEvidenceRecord[];
}): MessageResult {
  return {
    version: 1,
    status: input.status,
    title: input.status === "failed" ? "Workspace Bridge request failed" : input.status === "partial"
      ? `Workspace Bridge ${input.eventKind === "question" ? "question" : input.eventKind === "action_request" ? "action requested" : "progress"}`
      : "Workspace Bridge response",
    summary: input.content,
    body: input.content,
    sourceAgentName: input.sourceHumanName ? undefined : `${input.peerWorkspaceName} TYR`,
    sourceHumanName: input.sourceHumanName,
    ...(input.evidence?.length ? { evidence: input.evidence } : {}),
    workspaceBridge: {
      bridgeRequestId: request.id,
      bridgeId: request.bridgeId,
      conversationId: request.conversationId!,
      sentContent: request.content,
      state: input.status === "failed" ? "failed" : input.status === "partial" ? "running" : "completed"
    },
    ...(input.status === "partial" && request.originMessageId ? { communicationRequest: { sourceMessageId: request.originMessageId } } : {})
  };
}

export function createWorkspaceBridgeOriginMessage(
  store: WorkspaceBridgeOriginMessageStore,
  request: CrossWorkspaceMessageRecord,
  input: {
    content: string;
    status: "completed" | "failed" | "partial";
    peerWorkspaceName: string;
    sourceAgentNames?: string[];
    sourceHumanName?: string;
    attachmentIds?: string[];
    eventKind?: CrossWorkspaceMessageResponseKind;
    evidence?: CommunicationEvidenceRecord[];
  }
): MessageRecord | null {
  if (!request.originChannelId) return null;
  const sourceAssistant = store.ensureDefaultCommunicationAgent(request.sourceWorkspaceId);
  const result = workspaceBridgeOriginMessageResult(request, input);
  if (input.status === "completed" && request.awaitingAgentId && request.originMessageId &&
      (request.continuationState === "pending" || request.continuationState === "running")) {
    // The peer Bridge step is complete, but source TYR still owns the original request.
    result.status = "partial";
    result.communicationRequest = { sourceMessageId: request.originMessageId };
  }
  // 原始 TYR DM 与隐藏 Bridge DM 是两个权限域；复制元数据后客户才能预览和下载。
  const attachmentIds = copyWorkspaceBridgeAttachments(store, input.attachmentIds ?? [], request.originChannelId);
  return store.sendMessage({
    target: request.originChannelId,
    ...(request.originConversationId ? {
      conversationId: request.originConversationId,
      allowClosedConversation: true
    } : {}),
    // Bridge 终态始终回到原始 TYR DM，不依赖调用方继续轮询或重复提问。
    content: input.content,
    result,
    attachmentIds,
    senderType: "agent",
    senderId: sourceAssistant.id,
    senderName: sourceAssistant.displayName,
    serverId: request.sourceWorkspaceId
  }).message;
}

/** Only a persisted TYR-authored review may become a nonterminal Bridge event. */
export function publishWorkspaceBridgeWorkerEvent(ctx: ServerRouteContext, input: {
  execution: RuntimeExecutionRecord;
  eventId: string;
  kind: "progress" | "question" | "action_request";
  reviewedReply: MessageRecord;
  evidenceSelections?: CommunicationEvidenceSelection[];
}): CrossWorkspaceMessageRecord | null {
  const ref = workspaceBridgeRefForExecution(input.execution);
  const request = ref ? ctx.store.getCrossWorkspaceMessage(ref.requestMessageId) : null;
  if (!ref || !request || request.bridgeId !== ref.bridgeId || request.conversationId !== ref.conversationId ||
      request.targetWorkspaceId !== input.execution.serverId) return null;
  const bridge = ctx.store.getWorkspaceBridgeForServer(request.bridgeId, request.sourceWorkspaceId);
  if (!bridge) return null;
  const assistant = ctx.store.ensureDefaultCommunicationAgent(request.targetWorkspaceId);
  const persistedReview = ctx.store.getMessage(input.reviewedReply.id);
  if (!persistedReview || input.reviewedReply.senderId !== assistant.id ||
      persistedReview.senderId !== assistant.id ||
      persistedReview.content !== input.reviewedReply.content ||
      persistedReview.channelId !== input.execution.communicationReturnChannelId ||
      persistedReview.conversationId !== input.execution.communicationReturnConversationId ||
      !input.reviewedReply.content.trim()) return null;
  const content = input.reviewedReply.content;
  let origin: MessageRecord | null = null;
  const result = ctx.store.db.transaction(() => {
    const recorded = ctx.store.createCrossWorkspaceInteractionMessage({
      requestId: request.id, eventId: input.eventId, kind: input.kind, content,
      localMessageId: input.reviewedReply.id
    });
    if (!recorded) return null;
    const scope = evidenceScopeForExecution(input.execution);
    if (recorded.created && input.evidenceSelections?.length && scope) {
      publishCommunicationEvidenceForBridgeMessage(ctx.store, {
        messageId: recorded.message.id, scope, selections: input.evidenceSelections
      });
    }
    const evidence = getCommunicationEvidenceForBridgeMessage(ctx.store, recorded.message.id);
    if (recorded.message.originMessageId) return recorded;
    if (request.originChannelId) {
      origin = createWorkspaceBridgeOriginMessage(ctx.store, request, {
        content, status: "partial", eventKind: input.kind,
        peerWorkspaceName: bridge.peerWorkspace?.name ?? "Connected workspace",
        ...(evidence.length ? { evidence } : {})
      });
      if (origin) ctx.store.updateCrossWorkspaceMessage(recorded.message.id, { originMessageId: origin.id });
    }
    if (input.kind !== "progress" && origin && request.awaitingAgentId) {
      // Progress is observable; questions/action requests wake source TYR exactly once through the event row.
      ctx.store.db.prepare("update cross_workspace_messages set continuation_state = 'pending' where id = ? and continuation_state is null")
        .run(recorded.message.id);
    }
    return { message: { ...ctx.store.getCrossWorkspaceMessage(recorded.message.id)!, ...(evidence.length ? { evidence } : {}) }, created: recorded.created };
  })();
  if (!result) return null;
  if (origin) {
    try { ctx.emitRealtimeMessage(origin); } catch { /* Durable message and wake do not depend on realtime fanout. */ }
  }
  if (result?.created) {
    try { ctx.emitRealtimeWorkspaceBridgeMessage(result.message); } catch { /* The event remains in durable history. */ }
    recordWorkspaceBridgeLifecycleAudit(ctx.store, "workspace_bridge_interaction_received", request, {
      eventMessageId: result.message.id, eventId: input.eventId, responseKind: input.kind
    });
  }
  if (result.message.continuationState === "pending") ctx.scheduleWorkspaceBridgeInteractionContinuation?.(result.message.id);
  try { ctx.publishWorkspaceSync(); } catch { /* The persisted event is still recoverable after restart. */ }
  return result.message;
}

/** 子请求先由中间 TYR 复核；只有它完成原目标后的回复才能成为父请求终态。 */
export function completeWorkspaceBridgeParentFromContinuation(
  ctx: ServerRouteContext,
  childRequest: CrossWorkspaceMessageRecord,
  childTerminal: CrossWorkspaceMessageRecord,
  reviewedReply: MessageRecord
): void {
  const parent = childRequest.parentBridgeRequestId
    ? ctx.store.getCrossWorkspaceMessage(childRequest.parentBridgeRequestId)
    : null;
  if (!parent?.conversationId || parent.targetWorkspaceId !== childRequest.sourceWorkspaceId ||
      childTerminal.replyToMessageId !== childRequest.id ||
      (childTerminal.responseKind !== "final" && childTerminal.responseKind !== "error") ||
      reviewedReply.channelId !== childRequest.originChannelId ||
      reviewedReply.conversationId !== childRequest.originConversationId ||
      reviewedReply.senderId !== ctx.store.ensureDefaultCommunicationAgent(parent.targetWorkspaceId).id ||
      reviewedReply.result?.status === "partial") return;
  const bridge = ctx.store.getWorkspaceBridgeForServer(parent.bridgeId, parent.sourceWorkspaceId)
    ?? ctx.store.getWorkspaceBridgeForServer(parent.bridgeId, parent.targetWorkspaceId);
  if (!bridge) return;
  const failed = reviewedReply.result?.status === "failed";
  const responseKind = failed ? "error" : "final";
  // 父请求由中间 Workspace 的 TYR 负责，子 Workspace 的署名不能越级成为父回复者。
  const sourceAgentNames = [`${bridge.peerWorkspace?.name ?? "Connected workspace"} TYR`];
  const claimed = ctx.store.db.transaction(() => {
    const result = claimWorkspaceBridgeTerminal(ctx.store, {
    bridgeId: parent.bridgeId,
    conversationId: parent.conversationId!,
    responseKind,
    sourceWorkspaceId: parent.targetWorkspaceId,
    targetWorkspaceId: parent.sourceWorkspaceId,
    initiatedBy: "agent",
    content: reviewedReply.content,
    outcome: failed ? "failed" : "delivered",
    localMessageId: reviewedReply.id,
    peerMessageId: parent.peerMessageId,
    attachmentIds: reviewedReply.attachmentIds ?? [],
    sourceAgentNames,
    reviewedChildTerminalId: childTerminal.id,
    replyToMessageId: parent.id
    });
    const selections = evidenceSelectionsForRecords(reviewedReply.result?.evidence);
    if (result?.created && selections.length && childRequest.originMessageId && childRequest.originChannelId) {
      publishCommunicationEvidenceForBridgeMessage(ctx.store, {
        messageId: result.message.id, selections,
        scope: { serverId: childRequest.sourceWorkspaceId, sourceMessageId: childRequest.originMessageId,
          channelId: childRequest.originChannelId, conversationId: childRequest.originConversationId ?? null }
      });
    }
    return result;
  })();
  if (!claimed?.created) return;
  const evidence = getCommunicationEvidenceForBridgeMessage(ctx.store, claimed.message.id);
  const originMessage = createWorkspaceBridgeOriginMessage(ctx.store, parent, {
    content: reviewedReply.content,
    status: failed ? "failed" : "completed",
    peerWorkspaceName: bridge.peerWorkspace?.name ?? "Connected workspace",
    sourceAgentNames,
    attachmentIds: claimed.message.attachmentIds ?? [],
    ...(evidence.length ? { evidence } : {})
  });
  const savedTerminal = originMessage
    ? ctx.store.updateCrossWorkspaceMessage(claimed.message.id, { originMessageId: originMessage.id }) ?? claimed.message
    : claimed.message;
  const terminal = evidence.length ? { ...savedTerminal, evidence } : savedTerminal;
  const updatedParent = ctx.store.updateCrossWorkspaceMessage(parent.id, {
    outcome: failed ? "failed" : "delivered"
  }) ?? parent;
  if (originMessage) {
    ctx.emitRealtimeMessage(originMessage);
    ctx.scheduleWorkspaceBridgeExternalReturn?.(updatedParent, originMessage);
  }
  ctx.emitRealtimeWorkspaceBridgeMessage(terminal);
  emitWorkspaceBridgeOriginProgress(ctx, updatedParent, failed ? "failed" : "completed", failed ? "Workspace request failed." : "Workspace response received.");
  recordWorkspaceBridgeLifecycleAudit(ctx.store, failed ? "workspace_bridge_request_failed" : "workspace_bridge_request_completed", updatedParent, {
    responseMessageId: terminal.id,
    responseKind,
    reviewedByMessageId: reviewedReply.id,
    relayedFromChildRequestId: childRequest.id
  });
  ctx.publishWorkspaceSync();
}

/** Publish the source TYR's reviewed answer in the original DM; this is the final step after the peer terminal. */
export function publishReviewedWorkspaceBridgeContinuation(ctx: ServerRouteContext, input: {
  request: CrossWorkspaceMessageRecord;
  terminal: CrossWorkspaceMessageRecord;
  draft: CommunicationAgentContinuationDraft;
}): MessageRecord | null {
  const { request, terminal, draft } = input;
  if (!request.originChannelId || terminal.replyToMessageId !== request.id ||
      (terminal.responseKind !== "final" && terminal.responseKind !== "error")) return null;
  const nextExecutionRoot = [...new Set(draft.executionIds ?? [])]
    .map((id) => ctx.store.getRuntimeExecution(id)?.rootMessageId)
    .filter((id): id is string => Boolean(id))
    .map((id) => ctx.store.getMessage(id))
    .find((message) => message?.channelId === request.originChannelId);
  if (nextExecutionRoot) return nextExecutionRoot;
  const assistant = ctx.store.ensureDefaultCommunicationAgent(request.sourceWorkspaceId);
  const hasNextStep = Boolean(draft.executionIds?.length || draft.bridgeRequestIds?.length || draft.pendingActionId);
  const status = draft.outcomeStatus === "failed" || terminal.responseKind === "error"
    ? "failed" : draft.outcomeStatus === "partial" || draft.outcomeStatus === "running" || hasNextStep
      ? "partial" : "completed";
  // Bridge 终态经 TYR 复核后仍须写出可追踪的原请求结果；纯聊天文本不会清理客户端待办状态。
  const result: MessageResult = {
    ...(draft.result ?? {
    version: 1,
    status,
    title: status === "completed" ? "TYR request completed" : status === "failed"
      ? "TYR request failed" : "TYR request needs attention",
    summary: draft.content,
    body: draft.content
    }),
    status
  };
  if (draft.evidenceSelections?.length && request.originMessageId) {
    result.evidence = selectCommunicationEvidenceForContext(ctx.store, {
      serverId: request.sourceWorkspaceId, sourceMessageId: request.originMessageId,
      channelId: request.originChannelId, conversationId: request.originConversationId ?? null
    }, draft.evidenceSelections);
  }
  if (request.originMessageId && !result.communicationRequest) {
    result.communicationRequest = { sourceMessageId: request.originMessageId };
  }
  const reply = ctx.store.sendMessage({
    target: request.originChannelId,
    ...(request.originConversationId ? { conversationId: request.originConversationId, allowClosedConversation: true } : {}),
    content: draft.content,
    result,
    senderType: "agent", senderId: assistant.id, senderName: assistant.displayName,
    serverId: request.sourceWorkspaceId
  }).message;
  if (draft.pendingActionId) ctx.store.attachCommunicationAgentPendingActionSuggestionMessage(draft.pendingActionId, reply.id);
  ctx.emitRealtimeMessage(reply);
  if (request.parentBridgeRequestId && !draft.pendingActionId && result.status !== "partial" &&
      (draft.executionIds?.length ?? 0) === 0 && (draft.bridgeRequestIds?.length ?? 0) === 0) {
    completeWorkspaceBridgeParentFromContinuation(ctx, request, terminal, reply);
  }
  return reply;
}

/** Publish TYR's handling of a peer question in the same original DM without closing its request. */
export function publishReviewedWorkspaceBridgeInteraction(ctx: ServerRouteContext, input: {
  request: CrossWorkspaceMessageRecord;
  event: CrossWorkspaceMessageRecord;
  draft: CommunicationAgentContinuationDraft | null;
}): MessageRecord | null {
  const { request, event, draft } = input;
  if (!request.originChannelId || !request.originMessageId || event.replyToMessageId !== request.id ||
      (event.responseKind !== "question" && event.responseKind !== "action_request")) return null;
  const assistant = ctx.store.ensureDefaultCommunicationAgent(request.sourceWorkspaceId);
  const content = draft?.content ?? "The connected workspace needs more information. Please clarify how TYR should continue this request.";
  const evidence = draft?.evidenceSelections?.length ? selectCommunicationEvidenceForContext(ctx.store, {
    serverId: request.sourceWorkspaceId, sourceMessageId: request.originMessageId,
    channelId: request.originChannelId, conversationId: request.originConversationId ?? null
  }, draft.evidenceSelections) : [];
  const published = ctx.store.db.transaction(() => {
    const savedEvent = ctx.store.getCrossWorkspaceMessage(event.id);
    const prior = savedEvent?.continuationReplyMessageId
      ? ctx.store.getMessage(savedEvent.continuationReplyMessageId) : null;
    if (prior) return { reply: prior, created: false };
    if (ctx.store.db.prepare("select 1 from cross_workspace_messages where terminal_request_id = ?").get(request.id)) return null;
    const reply = ctx.store.sendMessage({
    target: request.originChannelId!,
    ...(request.originConversationId ? { conversationId: request.originConversationId, allowClosedConversation: true } : {}),
    content,
    // The peer execution is still running; only its final/error can complete this request.
    result: {
      version: 1, status: "partial", title: "TYR is continuing the workspace request",
      summary: content, communicationRequest: { sourceMessageId: request.originMessageId! },
      ...(evidence.length ? { evidence } : {})
    },
    senderType: "agent", senderId: assistant.id, senderName: assistant.displayName,
    serverId: request.sourceWorkspaceId
  }).message;
    ctx.store.db.prepare("update cross_workspace_messages set continuation_reply_message_id = ? where id = ?")
      .run(reply.id, event.id);
    return { reply, created: true };
  })();
  if (!published) return null;
  const { reply } = published;
  if (published.created) ctx.emitRealtimeMessage(reply);
  // A middle TYR's reviewed clarification must travel back another hop. Keeping it
  // only in the hidden middle DM strands the original requester indefinitely.
  const answered = ctx.store.db.prepare(`select 1 from cross_workspace_messages
    where reply_to_message_id = ? and response_kind in ('answer', 'instruction', 'continue')
      and outcome != 'failed' and rowid > (select rowid from cross_workspace_messages where id = ?) limit 1`)
    .get(request.id, event.id);
  if (request.parentBridgeRequestId && draft && draft.outcomeStatus !== "running" && !answered &&
      !draft.executionIds?.length && !draft.pendingActionId && !draft.bridgeRequestIds?.some((id) => id !== request.id)) {
    const parent = ctx.store.getCrossWorkspaceMessage(request.parentBridgeRequestId);
    if (parent?.conversationId && parent.targetWorkspaceId === request.sourceWorkspaceId &&
        reply.channelId === request.originChannelId && reply.conversationId === request.originConversationId) {
      const forwarded = ctx.store.db.transaction(() => {
        const saved = ctx.store.createCrossWorkspaceInteractionMessage({
          requestId: parent.id, eventId: `child_question_${event.id}`, kind: "question",
          content: reply.content, localMessageId: reply.id
        });
        if (saved?.created) publishReplyEvidence(ctx.store, saved.message.id, reply, {
          serverId: request.sourceWorkspaceId, sourceMessageId: request.originMessageId!,
          channelId: request.originChannelId!, conversationId: request.originConversationId ?? null
        });
        return saved;
      })();
      if (forwarded?.created) {
        const origin = createWorkspaceBridgeOriginMessage(ctx.store, parent, {
          content: reply.content, status: "partial", eventKind: "question", peerWorkspaceName: "Connected workspace",
          evidence: getCommunicationEvidenceForBridgeMessage(ctx.store, forwarded.message.id)
        });
        if (origin) {
          ctx.store.updateCrossWorkspaceMessage(forwarded.message.id, { originMessageId: origin.id });
          ctx.emitRealtimeMessage(origin);
          if (parent.awaitingAgentId) {
            ctx.store.db.prepare("update cross_workspace_messages set continuation_state = 'pending' where id = ?")
              .run(forwarded.message.id);
            ctx.scheduleWorkspaceBridgeInteractionContinuation?.(forwarded.message.id);
          }
        }
        ctx.emitRealtimeWorkspaceBridgeMessage(ctx.store.getCrossWorkspaceMessage(forwarded.message.id)!);
        recordWorkspaceBridgeLifecycleAudit(ctx.store, "workspace_bridge_interaction_received", parent, {
          eventMessageId: forwarded.message.id, responseKind: "question", reviewedChildEventId: event.id
        });
        ctx.publishWorkspaceSync();
      }
    }
  }
  return reply;
}

export function emitWorkspaceBridgeOriginProgress(
  ctx: Pick<ServerRouteContext, "store" | "broadcastRealtime">,
  request: CrossWorkspaceMessageRecord,
  phase: Extract<CommunicationAgentProgressPhase, "completed" | "failed">,
  label: string
): void {
  if (!request.originChannelId || !request.originMessageId) return;
  const sourceAssistant = ctx.store.ensureDefaultCommunicationAgent(request.sourceWorkspaceId);
  const updatedAt = new Date().toISOString();
  try {
    ctx.broadcastRealtime("communication_agent:progress", {
      progress: {
        operationId: request.originMessageId,
        sourceMessageId: request.originMessageId,
        channelId: request.originChannelId,
        ...(request.originConversationId ? { conversationId: request.originConversationId } : {}),
        assistantAgentId: sourceAssistant.id,
        // Bridge 终态沿用发起入口，确保客户端清理的是同一个带来源标签的 operation。
        source: request.originSource ?? "web",
        phase,
        label,
        startedAt: request.createdAt,
        updatedAt
      }
    }, { channelId: request.originChannelId });
  } catch {
    // 终态消息已经持久化；进度清理事件失败不能改变 Bridge 结果。
  }
}

const workspaceBridgeConversationQueues = new Map<string, Promise<void>>();
const queuedWorkspaceBridgeMessageIds = new Set<string>();

export function recoverPendingCrossWorkspaceBridgeFollowups(ctx: ServerRouteContext): void {
  // Only an event with no target message can be replayed without repeating a peer-side effect.
  const ids = ctx.store.db.prepare(`select id from cross_workspace_messages
    where response_kind in ('answer', 'instruction', 'continue') and outcome = 'pending'
      and peer_message_id is null order by created_at, id`).all() as Array<{ id: string }>;
  for (const { id } of ids) enqueueCrossWorkspaceBridgeFollowupDelivery(ctx, id);
}

/** A source instruction stays attached to the original request and wakes the peer TYR in its existing Bridge conversation. */
export function enqueueCrossWorkspaceBridgeFollowupDelivery(ctx: ServerRouteContext, eventMessageId: string): void {
  if (queuedWorkspaceBridgeMessageIds.has(eventMessageId)) return;
  queuedWorkspaceBridgeMessageIds.add(eventMessageId);
  const event = ctx.store.getCrossWorkspaceMessage(eventMessageId);
  const request = event?.replyToMessageId ? ctx.store.getCrossWorkspaceMessage(event.replyToMessageId) : null;
  if (!event || !request?.conversationId) {
    queuedWorkspaceBridgeMessageIds.delete(eventMessageId);
    return;
  }
  const queueKey = `${request.bridgeId}:${request.conversationId}`;
  const previous = workspaceBridgeConversationQueues.get(queueKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined)
    .then(() => deliverCrossWorkspaceBridgeFollowup(ctx, eventMessageId))
    .catch((error) => {
      console.warn(`[server] Bridge follow-up delivery interrupted event=${eventMessageId}: ${error instanceof Error ? error.message : String(error)}`);
      try {
        const current = ctx.store.getCrossWorkspaceMessage(eventMessageId);
        const terminalExists = ctx.store.listCrossWorkspaceMessages(request.bridgeId, { conversationId: request.conversationId ?? undefined })
          .some((message) => message.terminalRequestId === request.id);
        if (!current?.originMessageId && !terminalExists) {
          const origin = createWorkspaceBridgeOriginMessage(ctx.store, request, {
            content: "The follow-up was interrupted before the connected workspace confirmed a result. The original request still needs attention.",
            status: "partial", eventKind: "action_request", peerWorkspaceName: "Connected workspace"
          });
          if (origin) {
            ctx.store.updateCrossWorkspaceMessage(eventMessageId, { originMessageId: origin.id });
            ctx.emitRealtimeMessage(origin);
          }
        }
        recordWorkspaceBridgeLifecycleAudit(ctx.store, "workspace_bridge_followup_interrupted", request, {
          eventMessageId, peerMessageId: current?.peerMessageId ?? null
        });
      } catch { /* Keep the original request pending when even the diagnostic path fails. */ }
    })
    .finally(() => {
      queuedWorkspaceBridgeMessageIds.delete(eventMessageId);
      if (workspaceBridgeConversationQueues.get(queueKey) === next) workspaceBridgeConversationQueues.delete(queueKey);
    });
  workspaceBridgeConversationQueues.set(queueKey, next);
}

async function deliverCrossWorkspaceBridgeFollowup(ctx: ServerRouteContext, eventMessageId: string): Promise<void> {
  const event = ctx.store.getCrossWorkspaceMessage(eventMessageId);
  const request = event?.replyToMessageId ? ctx.store.getCrossWorkspaceMessage(event.replyToMessageId) : null;
  if (!event || !request?.conversationId || event.peerMessageId ||
      !["answer", "instruction", "continue"].includes(event.responseKind ?? "")) return;
  const bridge = ctx.store.getWorkspaceBridgeForServer(request.bridgeId, request.sourceWorkspaceId);
  const terminal = ctx.store.listCrossWorkspaceMessages(request.bridgeId, { conversationId: request.conversationId })
    .some((message) => message.terminalRequestId === request.id);
  const reportBlocked = (reason: string, content: string): void => {
    const failed = ctx.store.updateCrossWorkspaceMessage(event.id, { outcome: "failed" });
    if (failed) ctx.emitRealtimeWorkspaceBridgeMessage(failed);
    if (!terminal) {
      const origin = createWorkspaceBridgeOriginMessage(ctx.store, request, {
        content, status: "partial", eventKind: "action_request",
        peerWorkspaceName: bridge?.peerWorkspace?.name ?? "Connected workspace"
      });
      if (origin) {
        ctx.store.updateCrossWorkspaceMessage(event.id, { originMessageId: origin.id });
        ctx.emitRealtimeMessage(origin);
      }
    }
    recordWorkspaceBridgeLifecycleAudit(ctx.store, "workspace_bridge_followup_blocked", request, {
      eventMessageId: event.id, responseKind: event.responseKind, reason
    });
  };
  if (!bridge || bridge.status !== "active" || !bridge.permissions.includes("chat") || terminal) {
    reportBlocked(terminal ? "request_completed" : "bridge_unavailable",
      "The follow-up could not be delivered through the connected workspace. The original request still needs attention.");
    return;
  }
  const peerDm = ctx.store.getWorkspaceBridgeDm(request.bridgeId, request.targetWorkspaceId);
  const conversation = ctx.store.getConversation(request.conversationId);
  if (!peerDm || conversation?.channelId !== peerDm.id) {
    reportBlocked("peer_conversation_unavailable",
      "The connected workspace conversation is unavailable. The original request still needs attention.");
    return;
  }
  const receiver = ctx.store.ensureDefaultCommunicationAgent(request.targetWorkspaceId);
  const owner = request.targetCapabilityUserId ? ctx.store.getUser(request.targetCapabilityUserId) : null;
  if (!owner) {
    reportBlocked("peer_capability_unavailable",
      "The connected workspace owner capability is unavailable. The original request still needs attention.");
    return;
  }
  const peerMessage = ctx.store.db.transaction(() => {
    const fresh = ctx.store.getCrossWorkspaceMessage(event.id);
    if (fresh?.peerMessageId) return null;
    const message = ctx.store.sendMessage({
      target: peerDm.id, conversationId: conversation.id, allowClosedConversation: true,
      content: `Workspace Bridge ${event.responseKind} for request ${request.id}:\n\n${event.content}`,
      senderType: "system", senderId: request.senderUserId ?? owner.id,
      senderName: request.senderUserDisplayName ?? request.senderUserName ?? "Bridge user",
      serverId: request.targetWorkspaceId
    }).message;
    ctx.store.updateCrossWorkspaceMessage(event.id, { peerMessageId: message.id, outcome: "delivered" });
    return message;
  })();
  if (!peerMessage) return;
  ctx.emitRealtimeMessage(peerMessage);
  const deliveredEvent = ctx.store.getCrossWorkspaceMessage(event.id);
  if (deliveredEvent) ctx.emitRealtimeWorkspaceBridgeMessage(deliveredEvent);
  recordWorkspaceBridgeLifecycleAudit(ctx.store, "workspace_bridge_followup_delivered", request, {
    eventMessageId: event.id, responseKind: event.responseKind, peerMessageId: peerMessage.id
  });
  if (ctx.humanReplies?.deliverFollowup(request, event)) return;
  let peerExecutionIds: string[] = [];
  let peerOutcome: CommunicationAgentReplyOutcome | undefined;
  const assistantReply = await maybeReplyToCommunicationAgentDm(ctx, {
    message: peerMessage, agent: receiver,
    sourceContext: {
      source: "web", sourceConversationKey: `workspace_bridge:${request.bridgeId}:${request.targetWorkspaceId}:${request.conversationId}`,
      sourceEventKey: event.id, accessMode: "workspace_bridge", workspaceBridgeId: request.bridgeId,
      capabilityUserId: owner.id, requestingUserId: request.senderUserId ?? request.originalSenderUserId ?? undefined,
      requestingUserName: request.senderUserName ?? undefined,
      requestingUserDisplayName: request.senderUserDisplayName ?? undefined,
      requestingUserAvatarUrl: request.senderUserAvatarUrl,
      bridgeTraceId: request.traceId ?? undefined, parentBridgeRequestId: request.id, bridgeHopCount: request.hopCount
    },
    returnTarget: { source: "web", externalRef: workspaceBridgeCommunicationReturnExternalRef({
      bridgeId: request.bridgeId, conversationId: request.conversationId,
      sourceWorkspaceId: request.sourceWorkspaceId, targetWorkspaceId: request.targetWorkspaceId,
      requestMessageId: request.id
    }) },
    allowHandoff: true,
    onExecutionIds: (ids) => { peerExecutionIds = ids; },
    onOutcome: (outcome) => { peerOutcome = outcome; }
  });
  const durablePeerExecution = ctx.store.listRuntimeExecutions({ serverId: request.targetWorkspaceId, limit: 1000 })
    .some((execution) => workspaceBridgeRefForExecution(execution)?.requestMessageId === request.id &&
      !["completed", "failed", "stalled", "cancelled"].includes(execution.status));
  if (peerExecutionIds.length > 0) return;
  if (!assistantReply) {
    if (!durablePeerExecution) {
      const origin = createWorkspaceBridgeOriginMessage(ctx.store, request, {
        content: "The follow-up reached the connected workspace, but no reply was produced. The original request still needs attention.",
        status: "partial", eventKind: "action_request",
        peerWorkspaceName: bridge.peerWorkspace?.name ?? "Connected workspace"
      });
      if (origin) {
        ctx.store.updateCrossWorkspaceMessage(event.id, { originMessageId: origin.id });
        ctx.emitRealtimeMessage(origin);
      }
      recordWorkspaceBridgeLifecycleAudit(ctx.store, "workspace_bridge_followup_no_reply", request, { eventMessageId: event.id });
    }
    return;
  }
  const responseKind = workspaceBridgeResponseKind(ctx.store, {
    requestId: request.id, replyStatus: assistantReply.result?.status, outcomeStatus: peerOutcome?.status,
    hasExecution: durablePeerExecution, hasReply: true, error: Boolean(peerOutcome?.error)
  });
  if (responseKind === "question" || responseKind === "ack") {
    // A direct acknowledgement cannot finish the original request while its worker is still responsible for the result.
    const responseContent = responseKind === "ack" && peerOutcome?.status === "completed"
      ? "The original request remains open while an existing step is pending. No new action was confirmed."
      : assistantReply.content;
    const kind = responseKind === "question" ? "question" : "progress";
    const interaction = ctx.store.db.transaction(() => {
      const saved = ctx.store.createCrossWorkspaceInteractionMessage({
        requestId: request.id, eventId: `peer_${event.id}`, kind, content: responseContent,
        localMessageId: assistantReply.id
      });
      if (saved?.created) publishReplyEvidence(ctx.store, saved.message.id, assistantReply, {
        serverId: request.targetWorkspaceId, sourceMessageId: peerMessage.id,
        channelId: peerDm.id, conversationId: conversation.id
      });
      return saved;
    })();
    if (!interaction?.created) return;
    const origin = createWorkspaceBridgeOriginMessage(ctx.store, request, {
      content: responseContent, status: "partial", eventKind: kind,
      peerWorkspaceName: bridge.peerWorkspace?.name ?? "Connected workspace",
      evidence: getCommunicationEvidenceForBridgeMessage(ctx.store, interaction.message.id)
    });
    if (!origin) return;
    const updated = ctx.store.updateCrossWorkspaceMessage(interaction.message.id, { originMessageId: origin.id });
    if (kind === "question") ctx.store.db.prepare("update cross_workspace_messages set continuation_state = 'pending' where id = ?")
      .run(interaction.message.id);
    ctx.emitRealtimeMessage(origin);
    ctx.emitRealtimeWorkspaceBridgeMessage(updated ?? interaction.message);
    recordWorkspaceBridgeLifecycleAudit(ctx.store, "workspace_bridge_interaction_received", request, {
      eventMessageId: interaction.message.id, responseKind: kind, sourceFollowupEventId: event.id
    });
    if (kind === "question") ctx.scheduleWorkspaceBridgeInteractionContinuation?.(interaction.message.id);
    ctx.publishWorkspaceSync();
    return;
  }
  const claimed = ctx.store.db.transaction(() => {
    const saved = claimWorkspaceBridgeTerminal(ctx.store, {
    bridgeId: request.bridgeId, conversationId: request.conversationId!,
    responseKind,
    sourceWorkspaceId: request.targetWorkspaceId, targetWorkspaceId: request.sourceWorkspaceId,
    initiatedBy: "agent", content: assistantReply.content,
    outcome: responseKind === "error" ? "failed" : "delivered",
      localMessageId: assistantReply.id, peerMessageId: peerMessage.id, replyToMessageId: request.id
    });
    if (saved?.created) publishReplyEvidence(ctx.store, saved.message.id, assistantReply, {
      serverId: request.targetWorkspaceId, sourceMessageId: peerMessage.id,
      channelId: peerDm.id, conversationId: conversation.id
    });
    return saved;
  })();
  if (!claimed?.created) return;
  const origin = createWorkspaceBridgeOriginMessage(ctx.store, request, {
    content: assistantReply.content,
    status: claimed.message.responseKind === "error" ? "failed" : "completed",
    peerWorkspaceName: bridge.peerWorkspace?.name ?? "Connected workspace",
    evidence: getCommunicationEvidenceForBridgeMessage(ctx.store, claimed.message.id)
  });
  const reply = origin
    ? ctx.store.updateCrossWorkspaceMessage(claimed.message.id, { originMessageId: origin.id }) ?? claimed.message
    : claimed.message;
  if (origin) {
    ctx.emitRealtimeMessage(origin);
    ctx.scheduleWorkspaceBridgeExternalReturn?.(request, origin);
  }
  ctx.emitRealtimeWorkspaceBridgeMessage(reply);
  recordWorkspaceBridgeLifecycleAudit(ctx.store,
    reply.responseKind === "error" ? "workspace_bridge_request_failed" : "workspace_bridge_request_completed",
    request, { responseMessageId: reply.id, responseKind: reply.responseKind, sourceFollowupEventId: event.id });
  ctx.publishWorkspaceSync();
}

export function enqueueCrossWorkspaceBridgeMessageDelivery(ctx: ServerRouteContext, input: {
  bridge: WorkspaceBridgeRecord;
  requestMessage: CrossWorkspaceMessageRecord;
  initiatedByUserId: string;
}): void {
  if (queuedWorkspaceBridgeMessageIds.has(input.requestMessage.id)) return;
  queuedWorkspaceBridgeMessageIds.add(input.requestMessage.id);
  const queueKey = `${input.bridge.id}:${input.requestMessage.conversationId ?? "missing"}`;
  const previous = workspaceBridgeConversationQueues.get(queueKey) ?? Promise.resolve();
  // 同一 Bridge conversation 串行执行，保证连续发送的请求不会因模型响应速度不同而乱序。
  const next = previous
    .catch(() => undefined)
    .then(() => deliverQueuedCrossWorkspaceBridgeMessage(ctx, input))
    .catch(() => undefined)
    .finally(() => {
      queuedWorkspaceBridgeMessageIds.delete(input.requestMessage.id);
      if (workspaceBridgeConversationQueues.get(queueKey) === next) {
        workspaceBridgeConversationQueues.delete(queueKey);
      }
    });
  workspaceBridgeConversationQueues.set(queueKey, next);
}

async function deliverQueuedCrossWorkspaceBridgeMessage(ctx: ServerRouteContext, input: {
  bridge: WorkspaceBridgeRecord;
  requestMessage: CrossWorkspaceMessageRecord;
  initiatedByUserId: string;
}): Promise<void> {
  const request = ctx.store.getCrossWorkspaceMessage(input.requestMessage.id);
  if (!request || !request.conversationId || request.outcome !== "pending") return;
  let peerMessageId = request.peerMessageId;
  try {
    const currentBridge = ctx.store.getWorkspaceBridgeForServer(input.bridge.id, request.sourceWorkspaceId);
    if (!currentBridge || currentBridge.status !== "active") throw new Error("workspace_bridge_not_active");
    const targetWorkspaceId = request.targetWorkspaceId;
    const receiver = ctx.store.ensureDefaultCommunicationAgent(targetWorkspaceId);
    const peerOwnerId = request.targetCapabilityUserId ?? currentBridge.peerWorkspace?.ownerUserId ?? receiver.ownerUserId;
    const peerOwner = ctx.store.getUser(peerOwnerId);
    if (!peerOwner) throw new Error("peer_workspace_owner_not_found");
    const sourceWorkspace = ctx.store.listServersForUser(input.initiatedByUserId)
      .find((server) => server.id === request.sourceWorkspaceId);
    if (!sourceWorkspace) throw new Error("source_workspace_access_required");
    const peerDm = ctx.store.getOrCreateWorkspaceBridgeDm(currentBridge.id, targetWorkspaceId);
    if (!peerDm) throw new Error("peer_assistant_dm_unavailable");
    const conversation = ctx.store.getConversation(request.conversationId);
    if (!conversation || conversation.channelId !== peerDm.id) throw new Error("workspace_bridge_conversation_not_found");

    const senderDisplayName = request.senderUserDisplayName ?? request.senderUserName ?? "Bridge user";
    const peerMessage = ctx.store.sendMessage({
      target: peerDm.id,
      content: [
        "Workspace Bridge request",
        `From: ${senderDisplayName} — ${sourceWorkspace.name}`,
        "",
        request.content
      ].join("\n"),
      // Bridge 请求是服务端转发事件，不得伪装成远端 Workspace owner 的普通 Human DM。
      senderType: "system",
      senderId: request.senderUserId ?? input.initiatedByUserId,
      senderName: senderDisplayName,
      serverId: targetWorkspaceId,
      conversationId: conversation.id,
      // 请求一旦被接受，即使用户随后切换或归档会话，也必须在原会话完成，不能污染新的上下文。
      allowClosedConversation: true,
      attachmentIds: request.attachmentIds ?? []
    }).message;
    peerMessageId = peerMessage.id;
    const acceptedRequest = ctx.store.updateCrossWorkspaceMessage(request.id, { peerMessageId });
    if (acceptedRequest) ctx.emitRealtimeWorkspaceBridgeMessage(acceptedRequest);
    if (conversation.title === "New conversation") {
      ctx.store.renameConversation(conversation.id, workspaceBridgeConversationTitle(request.content));
    }
    ctx.emitRealtimeMessage(peerMessage);

    if (ctx.humanReplies && await ctx.humanReplies.holdIfNeeded(acceptedRequest ?? { ...request, peerMessageId: peerMessage.id })) return;

    let peerExecutionIds: string[] = [];
    let peerOutcome: CommunicationAgentReplyOutcome | undefined;
    const assistantReply = await maybeReplyToCommunicationAgentDm(ctx, {
      message: peerMessage,
      agent: receiver,
      sourceContext: {
        source: "web",
        sourceConversationKey: `workspace_bridge:${currentBridge.id}:${targetWorkspaceId}:${conversation.id}`,
        sourceEventKey: peerMessage.id,
        accessMode: "workspace_bridge",
        workspaceBridgeId: currentBridge.id,
        capabilityUserId: peerOwner.id,
        requestingUserId: request.senderUserId ?? request.originalSenderUserId ?? undefined,
        requestingUserName: request.senderUserName ?? undefined,
        requestingUserDisplayName: request.senderUserDisplayName ?? undefined,
        requestingUserAvatarUrl: request.senderUserAvatarUrl,
        bridgeTraceId: request.traceId ?? undefined,
        parentBridgeRequestId: request.id,
        bridgeHopCount: request.hopCount
      },
      allowHandoff: true,
      returnTarget: {
        source: "web",
        externalRef: workspaceBridgeCommunicationReturnExternalRef({
          bridgeId: currentBridge.id,
          conversationId: conversation.id,
          sourceWorkspaceId: request.sourceWorkspaceId,
          targetWorkspaceId,
          requestMessageId: request.id
        })
      },
      onExecutionIds: (ids) => { peerExecutionIds = ids; },
      onOutcome: (outcome) => { peerOutcome = outcome; }
    });
    const durableExecutionIds = ctx.store.listRuntimeExecutions({
      serverId: targetWorkspaceId,
      limit: 1000
    }).filter((execution) => workspaceBridgeRefForExecution(execution)?.requestMessageId === request.id)
      .map((execution) => execution.id);
    // Tool Loop 可能在派发后抛错；即使回调被跳过，已持久化的 execution 仍是权威事实。
    peerExecutionIds = [...new Set([...peerExecutionIds, ...durableExecutionIds])];
    const peerFailed = !assistantReply || assistantReply.result?.status === "failed" || peerOutcome?.status === "failed" || Boolean(peerOutcome?.error);
    const responseKind = workspaceBridgeResponseKind(ctx.store, {
      requestId: request.id, replyStatus: assistantReply?.result?.status, outcomeStatus: peerOutcome?.status,
      hasExecution: peerExecutionIds.length > 0, hasReply: Boolean(assistantReply), error: Boolean(peerOutcome?.error)
    });
    const responseContent = responseKind === "ack" && peerOutcome?.status === "completed"
      ? "The original request remains open while an existing step is pending. No new action was confirmed."
      : assistantReply?.content ??
      `${receiver.displayName} could not respond to the Workspace Bridge request.`;
    const peerWorkspaceName = currentBridge.peerWorkspace?.name ?? "Connected workspace";
    // The request lifecycle is settled before the response record is created. This preserves the
    // authoritative visual order: outbound request first, then inbound response, even when both
    // records are persisted within the same millisecond-scale delivery turn.
    const deliveredRequest = ctx.store.updateCrossWorkspaceMessage(request.id, { outcome: "delivered" });
    if (deliveredRequest) ctx.emitRealtimeWorkspaceBridgeMessage(deliveredRequest);
    const { terminal, interaction } = ctx.store.db.transaction(() => {
      const terminal = responseKind === "ack" || responseKind === "question" ? null : claimWorkspaceBridgeTerminal(ctx.store, {
      bridgeId: currentBridge.id,
      conversationId: conversation.id,
      responseKind,
      sourceWorkspaceId: targetWorkspaceId,
      targetWorkspaceId: request.sourceWorkspaceId,
      initiatedBy: "agent",
      content: responseContent,
      outcome: peerFailed ? "failed" : "delivered",
      localMessageId: assistantReply?.id ?? null,
      peerMessageId: peerMessage.id,
      attachmentIds: assistantReply?.attachmentIds ?? [],
      replyToMessageId: request.id
    });
      const interaction = responseKind === "question" ? ctx.store.createCrossWorkspaceInteractionMessage({
      requestId: request.id, eventId: `peer_question_${peerMessage.id}`, kind: "question",
      content: responseContent, localMessageId: assistantReply?.id ?? null
      }) : null;
      const created = terminal?.created ? terminal.message : interaction?.created ? interaction.message : null;
      if (created && assistantReply) publishReplyEvidence(ctx.store, created.id, assistantReply, {
        serverId: targetWorkspaceId, sourceMessageId: peerMessage.id,
        channelId: peerDm.id, conversationId: conversation.id
      });
      return { terminal, interaction };
    })();
    if (responseKind === "question" && !interaction) return;
    if ((responseKind === "final" || responseKind === "error") && !terminal) return;
    const originMessage = (terminal?.created || interaction?.created)
      ? createWorkspaceBridgeOriginMessage(ctx.store, request, {
        content: responseContent,
        status: responseKind === "question" ? "partial" : peerFailed ? "failed" : "completed",
        peerWorkspaceName,
        eventKind: responseKind === "question" ? "question" : undefined,
        attachmentIds: terminal?.message.attachmentIds ?? [],
        evidence: getCommunicationEvidenceForBridgeMessage(ctx.store, terminal?.message.id ?? interaction?.message.id ?? "")
      })
      : null;
    const reply = responseKind === "ack"
      ? ctx.store.createCrossWorkspaceMessage({
        bridgeId: currentBridge.id,
        conversationId: conversation.id,
        // 已路由的 worker 请求这里只写 ack；其后续 communication return 才写最终终态。
        responseKind,
        sourceWorkspaceId: targetWorkspaceId,
        targetWorkspaceId: request.sourceWorkspaceId,
        initiatedBy: "agent",
        content: responseContent,
        outcome: "delivered",
        localMessageId: assistantReply?.id ?? null,
        peerMessageId: peerMessage.id,
        replyToMessageId: request.id
      })
      : responseKind === "question"
        ? originMessage
          ? ctx.store.updateCrossWorkspaceMessage(interaction!.message.id, { originMessageId: originMessage.id }) ?? interaction!.message
          : interaction!.message
        : originMessage
          ? ctx.store.updateCrossWorkspaceMessage(terminal!.message.id, { originMessageId: originMessage.id }) ?? terminal!.message
          : terminal!.message;
    if (originMessage) ctx.emitRealtimeMessage(originMessage);
    if (originMessage && terminal) ctx.scheduleWorkspaceBridgeExternalReturn?.(deliveredRequest ?? request, originMessage);
    if (originMessage && interaction && request.awaitingAgentId) {
      ctx.store.db.prepare("update cross_workspace_messages set continuation_state = 'pending' where id = ?")
        .run(interaction.message.id);
      ctx.scheduleWorkspaceBridgeInteractionContinuation?.(interaction.message.id);
    }
    ctx.emitRealtimeWorkspaceBridgeMessage(reply);
    if (terminal?.created) {
      emitWorkspaceBridgeOriginProgress(
        ctx,
        deliveredRequest ?? request,
        peerFailed ? "failed" : "completed",
        peerFailed ? "Workspace request failed." : "Workspace response received."
      );
    }
    if (responseKind === "ack" || interaction?.created || terminal?.created) {
      recordWorkspaceBridgeLifecycleAudit(
        ctx.store,
        responseKind === "ack" || responseKind === "question"
          ? "workspace_bridge_request_running"
          : peerFailed
            ? "workspace_bridge_request_failed"
            : "workspace_bridge_request_completed",
        deliveredRequest ?? request,
        {
          responseMessageId: reply.id,
          responseKind: reply.responseKind,
          peerExecutionIds
        }
      );
    }
    ctx.publishWorkspaceSync();
  } catch {
    const current = ctx.store.getCrossWorkspaceMessage(request.id);
    if (!current) return;
    if (!peerMessageId) {
      const failedRequest = ctx.store.updateCrossWorkspaceMessage(request.id, { outcome: "failed" });
      if (failedRequest) ctx.emitRealtimeWorkspaceBridgeMessage(failedRequest);
      const content = "The Workspace Bridge request could not be delivered. Try again.";
      const terminal = claimWorkspaceBridgeTerminal(ctx.store, {
        bridgeId: request.bridgeId,
        conversationId: request.conversationId!,
        responseKind: "error",
        sourceWorkspaceId: request.targetWorkspaceId,
        targetWorkspaceId: request.sourceWorkspaceId,
        initiatedBy: "agent",
        content,
        outcome: "failed",
        replyToMessageId: request.id
      });
      if (!terminal) return;
      const originMessage = terminal.created
        ? createWorkspaceBridgeOriginMessage(ctx.store, failedRequest ?? current, {
          content,
          status: "failed",
          peerWorkspaceName: input.bridge.peerWorkspace?.name ?? "Connected workspace"
        })
        : null;
      const failedReply = originMessage
        ? ctx.store.updateCrossWorkspaceMessage(terminal.message.id, { originMessageId: originMessage.id }) ?? terminal.message
        : terminal.message;
      if (originMessage) ctx.emitRealtimeMessage(originMessage);
      if (originMessage) ctx.scheduleWorkspaceBridgeExternalReturn?.(failedRequest ?? current, originMessage);
      ctx.emitRealtimeWorkspaceBridgeMessage(failedReply);
      if (terminal.created) {
        recordWorkspaceBridgeLifecycleAudit(ctx.store, "workspace_bridge_request_failed", failedRequest ?? current, {
          phase: "delivery",
          responseMessageId: failedReply.id
        });
      }
    } else {
      // 对端已收到请求时保留 Delivered；把响应故障作为独立 Agent 消息展示，避免误导用户重复发送。
      const deliveredRequest = current.outcome === "delivered"
        ? current
        : ctx.store.updateCrossWorkspaceMessage(request.id, { outcome: "delivered", peerMessageId });
      if (deliveredRequest) ctx.emitRealtimeWorkspaceBridgeMessage(deliveredRequest);
      const content = "TYR could not respond. Try again.";
      const terminal = claimWorkspaceBridgeTerminal(ctx.store, {
        bridgeId: request.bridgeId,
        conversationId: request.conversationId!,
        responseKind: "error",
        sourceWorkspaceId: request.targetWorkspaceId,
        targetWorkspaceId: request.sourceWorkspaceId,
        initiatedBy: "agent",
        content,
        outcome: "failed",
        peerMessageId,
        replyToMessageId: request.id
      });
      if (!terminal) return;
      const originMessage = terminal.created
        ? createWorkspaceBridgeOriginMessage(ctx.store, deliveredRequest ?? current, {
          content,
          status: "failed",
          peerWorkspaceName: input.bridge.peerWorkspace?.name ?? "Connected workspace"
        })
        : null;
      const failedReply = originMessage
        ? ctx.store.updateCrossWorkspaceMessage(terminal.message.id, { originMessageId: originMessage.id }) ?? terminal.message
        : terminal.message;
      if (originMessage) ctx.emitRealtimeMessage(originMessage);
      if (originMessage) ctx.scheduleWorkspaceBridgeExternalReturn?.(deliveredRequest ?? current, originMessage);
      ctx.emitRealtimeWorkspaceBridgeMessage(failedReply);
      if (terminal.created) {
        recordWorkspaceBridgeLifecycleAudit(ctx.store, "workspace_bridge_request_failed", deliveredRequest ?? current, {
          phase: "peer_response",
          responseMessageId: failedReply.id
        });
      }
    }
    ctx.publishWorkspaceSync();
  }
}

function workspaceBridgeConversationTitle(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 72) || "New conversation";
}

function recordWorkspaceBridgeLifecycleAudit(
  store: Pick<ServerRouteContext["store"], "recordAuditEvent">,
  kind: string,
  request: CrossWorkspaceMessageRecord,
  metadata: Record<string, unknown>
): void {
  try {
    store.recordAuditEvent({
      kind,
      actorType: "system",
      actorId: null,
      resourceType: "workspace_bridge",
      resourceId: request.bridgeId,
      serverId: request.sourceWorkspaceId,
      // 审计只记录路由、状态和关联 ID，不复制跨 Workspace 的消息正文。
      metadata: {
        requestMessageId: request.id,
        conversationId: request.conversationId,
        sourceWorkspaceId: request.sourceWorkspaceId,
        targetWorkspaceId: request.targetWorkspaceId,
        requestingUserId: request.senderUserId ?? request.originalSenderUserId ?? null,
        sourceCapabilityUserId: request.sourceCapabilityUserId ?? null,
        targetCapabilityUserId: request.targetCapabilityUserId ?? null,
        traceId: request.traceId ?? null,
        parentBridgeRequestId: request.parentBridgeRequestId ?? null,
        hopCount: request.hopCount ?? 0,
        ...metadata
      }
    });
  } catch {
    // 审计存储异常不能把已经完成的跨 Workspace 投递回滚成业务失败。
  }
}
