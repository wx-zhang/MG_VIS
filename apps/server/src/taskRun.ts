import { randomUUID } from "node:crypto";
import { isCommunicationAgent, type AgentRecord, type CrossWorkspaceMessageRecord, type MessageRecord, type MessageResult, type RuntimeApprovalRecord, type RuntimeExecutionEventRecord, type RuntimeExecutionRecord, type TaskRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import { buildCompletedCommunicationResult, communicationResultPlainText } from "./communication-result";
import { effectiveAttachmentMimeType } from "./attachment-files";
import { createWorkspaceBridgeReturnMessageForFinalMessage, parseWorkspaceBridgeCommunicationReturnRef, workspaceBridgeRefForExecution } from "./workspace-bridge-delivery";
import { runtimeContextRefForMessage } from "./runtime-context-session";

type TaskRuntimeStore = Pick<TyrDb, "createRuntimeExecution" | "appendRuntimeExecutionEvent" | "getConversation" | "getMessage" | "getWorkspaceRoutingInstructions" | "resolveTarget">;
type TaskMessageRuntimeStore = TaskRuntimeStore & Pick<TyrDb, "resolveTarget" | "selectWakeTargets" | "enqueueForAgent">;
type ApprovalFallbackStore = Pick<TyrDb, "latestRuntimeExecutionForTask" | "latestRuntimeExecutionForMessage" | "taskForMessage">;
type RuntimeExecutionOrchestration = Pick<RuntimeExecutionRecord, "sourceExecutionId" | "returnToAgentId" | "rootMessageId" | "hopCount" | "expectReply">;
type RuntimeExecutionCommunicationReturn = Pick<RuntimeExecutionRecord, "communicationReturnChannelId" | "communicationReturnConversationId" | "communicationReturnSourceMessageId" | "communicationReturnUserId" | "communicationReturnSource" | "communicationReturnExternalRef" | "communicationReturnInstructions" | "communicationReturnInstructionsRevision">;
type CommunicationReturnInput = {
  channelId: string;
  conversationId?: string;
  sourceMessageId?: string;
  userId: string;
  source: NonNullable<RuntimeExecutionRecord["communicationReturnSource"]>;
  externalRef?: string;
  instructions?: string;
  instructionsRevision?: number;
};
type AgentReturnRuntimeStore = TaskRuntimeStore & Pick<TyrDb, "getAgent" | "getMachine" | "getMessage" | "getRuntimeExecution" | "sendMessage" | "canAgentAccessChannel" | "enqueueForAgent" | "listRuntimeExecutions" | "markRuntimeExecutionReturnDispatched">;
type CommunicationReturnRuntimeStore = Pick<TyrDb, "db" | "ensureDefaultCommunicationAgent" | "getAgent" | "getAttachment" | "getConversation" | "getMessage" | "getRuntimeExecution" | "listRuntimeExecutions" | "listRuntimeExecutionEvents" | "listRuntimeExecutionOutputMessages" | "sendMessage" | "createAttachment" | "markRuntimeExecutionCommunicationReturnDispatched" | "createCrossWorkspaceTerminalMessage" | "getCrossWorkspaceMessage" | "getWorkspaceBridgeForServer" | "recordAuditEvent" | "updateCrossWorkspaceMessage">;
type WorkspaceBridgeRuntimeOutputRecoveryStore = CommunicationReturnRuntimeStore & Pick<TyrDb, "appendRuntimeExecutionEvent" | "findFinalMessageForExecution">;

function runtimeExecutionOrchestration(input?: RuntimeExecutionOrchestration): RuntimeExecutionOrchestration {
  return {
    sourceExecutionId: input?.sourceExecutionId,
    returnToAgentId: input?.returnToAgentId,
    rootMessageId: input?.rootMessageId,
    hopCount: input?.hopCount,
    expectReply: input?.expectReply
  };
}

function runtimeExecutionCommunicationReturn(input?: CommunicationReturnInput): RuntimeExecutionCommunicationReturn {
  return {
    communicationReturnChannelId: input?.channelId,
    communicationReturnConversationId: input?.conversationId,
    communicationReturnSourceMessageId: input?.sourceMessageId,
    communicationReturnUserId: input?.userId,
    communicationReturnSource: input?.source,
    communicationReturnExternalRef: input?.externalRef,
    communicationReturnInstructions: input?.instructions,
    communicationReturnInstructionsRevision: input?.instructionsRevision
  };
}

function controllerActorModeForCommunicationHandoff(
  store: Pick<TyrDb, "listRuntimeExecutions">,
  serverId: string,
  externalRef: string | undefined
): RuntimeExecutionRecord["controllerActorMode"] {
  const ref = parseWorkspaceBridgeCommunicationReturnRef(externalRef);
  if (!ref || ref.targetWorkspaceId !== serverId) return undefined;
  const directActorBusy = store.listRuntimeExecutions({ serverId, limit: 1_000 }).some((execution) => {
    const existingRef = workspaceBridgeRefForExecution(execution);
    if (!existingRef || existingRef.targetWorkspaceId !== serverId) return false;
    // 旧 execution 没有持久化字段时视为原身，避免滚动发布期间出现两个本体。
    if ((execution.controllerActorMode ?? "direct") !== "direct") return false;
    // 成功任务必须等结果真正回到 TYR；失败或取消后人物已经开始归位，可以释放本体。
    return execution.status === "completed"
      ? !execution.communicationReturnMessageId
      : !["failed", "stalled", "cancelled"].includes(execution.status);
  });
  return directActorBusy ? "clone" : "direct";
}

function pendingCommunicationReturnFromExecution(execution: RuntimeExecutionRecord | null | undefined): CommunicationReturnInput | undefined {
  if (
    !execution?.communicationReturnChannelId ||
    !execution.communicationReturnUserId ||
    !execution.communicationReturnSource ||
    execution.communicationReturnMessageId
  ) return undefined;
  return {
    channelId: execution.communicationReturnChannelId,
    ...(execution.communicationReturnConversationId ? { conversationId: execution.communicationReturnConversationId } : {}),
    ...(execution.communicationReturnSourceMessageId ? { sourceMessageId: execution.communicationReturnSourceMessageId } : {}),
    userId: execution.communicationReturnUserId,
    source: execution.communicationReturnSource,
    ...(execution.communicationReturnExternalRef ? { externalRef: execution.communicationReturnExternalRef } : {}),
    ...(execution.communicationReturnInstructions !== undefined ? { instructions: execution.communicationReturnInstructions } : {}),
    ...(execution.communicationReturnInstructionsRevision !== undefined ? {
      instructionsRevision: execution.communicationReturnInstructionsRevision
    } : {})
  };
}

function compactReturnText(text: string, max = 3000): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function hasRuntimeTarget(agent: AgentRecord): agent is AgentRecord & { machineId: string; runtime: NonNullable<AgentRecord["runtime"]> } {
  return !isCommunicationAgent(agent) && Boolean(agent.machineId && agent.runtime);
}

function runtimeExecutionContext(store: TaskRuntimeStore, message: MessageRecord | null | undefined): Pick<RuntimeExecutionRecord, "runtimeContextKey"> {
  if (!message) return {};
  const context = runtimeContextRefForMessage(store, message);
  // P1.0 只固化可验证上下文；不合法或已退休的 channel 保持空值，由后续调度阶段显式拒绝 P1。
  return context ? { runtimeContextKey: context.key } : {};
}

function agentReturnMessageContent(input: {
  returnAgent: AgentRecord;
  completedAgent: AgentRecord;
  handoffMessage: MessageRecord | null;
  finalMessage: MessageRecord;
}): string {
  const handoffLabel = input.handoffMessage?.kind === "delegation" ? "Original delegation" : "Original handoff";
  const handoff = input.handoffMessage ? `\n${handoffLabel}: ${compactReturnText(input.handoffMessage.content, 1000)}` : "";
  return [
    `@${input.returnAgent.name} @${input.completedAgent.name} completed the delegated work and returned this result.`,
    handoff,
    `\nResult: ${compactReturnText(input.finalMessage.content)}`,
    "\nContinue from this returned result in the same context. Do not re-run the same handoff unless new work is needed."
  ].join("");
}

function communicationReturnAttachments(
  store: CommunicationReturnRuntimeStore,
  targetChannelId: string,
  executionId: string,
  finalMessage: MessageRecord
): { attachmentIds: string[]; sourceContent: string; sentBeforeFinalReply: boolean } {
  const sourceAttachmentIds = new Set<string>();
  const seenMessageIds = new Set<string>();
  let sourceContent = "";
  let sentBeforeFinalReply = false;
  for (const message of [...store.listRuntimeExecutionOutputMessages(executionId), finalMessage]) {
    if (seenMessageIds.has(message.id)) continue;
    seenMessageIds.add(message.id);
    // 只回传该 worker 在最终回复频道内产生的结果，避免把同一轮发往其他上下文的附件带入 Assistant DM。
    if (message.senderId !== finalMessage.senderId || message.channelId !== finalMessage.channelId) continue;
    const messageAttachmentIds = message.attachmentIds ?? [];
    if (messageAttachmentIds.length === 0) continue;
    if (!sourceContent && message.content.trim()) sourceContent = message.content;
    if (message.id !== finalMessage.id) sentBeforeFinalReply = true;
    for (const attachmentId of messageAttachmentIds) sourceAttachmentIds.add(attachmentId);
  }
  const attachmentIds = [...sourceAttachmentIds].flatMap((attachmentId) => {
    const attachment = store.getAttachment(attachmentId);
    if (!attachment) return [];
    if (attachment.channelId === targetChannelId) return [attachment.id];
    // Results cross from the worker DM into the TYR DM; duplicate metadata so access remains channel-scoped.
    return [store.createAttachment({
      channelId: targetChannelId,
      filename: attachment.filename,
      mimeType: effectiveAttachmentMimeType(attachment),
      sizeBytes: attachment.sizeBytes,
      path: attachment.path
    }).id];
  });
  return { attachmentIds, sourceContent, sentBeforeFinalReply };
}

export function communicationReturnFinalContent(store: CommunicationReturnRuntimeStore, executionId: string, finalMessage: MessageRecord): string {
  const outputEvents = [...store.listRuntimeExecutionEvents(executionId)]
    .reverse()
    .filter((event) => event.kind === "assistant_output" && event.detail?.trim());
  const finalBlock = outputEvents.find((event) => {
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return false;
    const payload = event.payload as Record<string, unknown>;
    return typeof payload.assistantBlockId === "string" && payload.status === "completed";
  });
  const finalBlockOutput = finalBlock?.detail?.trim();
  const finalBlockPayload = finalBlock?.payload && typeof finalBlock.payload === "object" && !Array.isArray(finalBlock.payload)
    ? finalBlock.payload as Record<string, unknown>
    : null;
  const explicitOutputContents = new Set(
    store.listRuntimeExecutionOutputMessages(executionId)
      .map((message) => message.content.trim())
      .filter(Boolean)
  );
  const finalMessageContent = finalMessage.content.trim();
  // completed block 只有在确实是最终正文尾部，或对应 Agent 明确发送的独立 execution output 时才可信。
  // 这既保留附件先发、结论后发的语义，也拒绝 final-message 回调竞态产生的残缺 checkpoint。
  if (
    finalBlockOutput &&
    finalBlockPayload?.truncated !== true &&
    (finalMessageContent.endsWith(finalBlockOutput) || explicitOutputContents.has(finalBlockOutput))
  ) return finalBlockOutput;
  const finalOutput = outputEvents[0]?.detail?.trim();
  // daemon 的可见回复会合并过程文本；只在最后输出确实是合并文本尾部时，用它作为 Assistant 的最终回复。
  return finalOutput && finalMessageContent.endsWith(finalOutput) ? finalOutput : finalMessage.content;
}

function returnWakeTargetChannelId(
  store: Pick<TyrDb, "getMessage" | "canAgentAccessChannel">,
  completedExecution: RuntimeExecutionRecord,
  returnAgent: AgentRecord,
  finalMessage: MessageRecord
): string | null {
  const rootMessage = completedExecution.rootMessageId ? store.getMessage(completedExecution.rootMessageId) : null;
  if (rootMessage && store.canAgentAccessChannel(returnAgent.id, rootMessage.channelId)) return rootMessage.channelId;
  return store.canAgentAccessChannel(returnAgent.id, finalMessage.channelId) ? finalMessage.channelId : null;
}

export function createQueuedTaskRuntimeExecution(
  store: TaskRuntimeStore,
  input: {
    serverId: string;
    machineId: string;
    agent: AgentRecord;
    task: TaskRecord;
    launchId?: string;
    detail?: string;
  }
): { execution: RuntimeExecutionRecord; queuedEvent: RuntimeExecutionEventRecord } {
  const runtime = input.agent.runtime;
  if (!runtime) throw new Error("agent_runtime_required");
  const message = store.getMessage(input.task.messageId);
  // Claim 和 Run 都是一次可追踪的执行请求；先落 execution，再把同一个 id 传给 daemon。
  const execution = store.createRuntimeExecution({
    id: `exec_${randomUUID().replaceAll("-", "")}`,
    serverId: input.serverId,
    machineId: input.machineId,
    agentId: input.agent.id,
    taskId: input.task.id,
    messageId: input.task.messageId,
    threadChannelId: input.task.threadChannelId,
    runtime,
    launchId: input.launchId,
    ...runtimeExecutionContext(store, message),
    status: "queued"
  });
  const queuedEvent = store.appendRuntimeExecutionEvent({
    executionId: execution.id,
    agentId: input.agent.id,
    taskId: input.task.id,
    kind: "queued",
    title: "Queued",
    detail: input.detail ?? `Queued task #${input.task.taskNumber} for @${input.agent.name}.`
  });
  return { execution, queuedEvent };
}

export function createQueuedTaskRuntimeExecutionsForTaskMessage(
  store: TaskMessageRuntimeStore,
  input: {
    message: MessageRecord;
    task: TaskRecord;
    detail?: string;
  }
): RuntimeExecutionRecord[] {
  const channel = store.resolveTarget(input.task.channelId);
  if (!channel) return [];
  const executions: RuntimeExecutionRecord[] = [];
  for (const agent of store.selectWakeTargets(input.message)) {
    if (!hasRuntimeTarget(agent)) continue;
    // 普通 asTask 消息也是真实执行请求；这里把旧 inbox 行升级为带 execution_id 的可追踪投递。
    const { execution } = createQueuedTaskRuntimeExecution(store, {
      serverId: channel.serverId ?? "local",
      machineId: agent.machineId,
      agent,
      task: input.task,
      launchId: agent.launchId ?? undefined,
      detail: input.detail
    });
    store.enqueueForAgent(agent.id, input.message.id, execution.id);
    executions.push(execution);
  }
  return executions;
}

export function createQueuedMessageRuntimeExecutionsForMessage(
  store: TaskMessageRuntimeStore,
  input: {
    message: MessageRecord;
    threadChannelId?: string;
    detail?: string;
  }
): RuntimeExecutionRecord[] {
  const executions: RuntimeExecutionRecord[] = [];
  for (const agent of store.selectWakeTargets(input.message)) {
    const execution = createQueuedMessageRuntimeExecutionForAgent(store, {
      message: input.message,
      agent,
      threadChannelId: input.threadChannelId,
      detail: input.detail
    });
    if (execution) executions.push(execution);
  }
  return executions;
}

export function createQueuedMessageRuntimeExecutionForAgent(
  store: TaskMessageRuntimeStore,
  input: {
    message: MessageRecord;
    agent: AgentRecord;
    threadChannelId?: string;
    detail?: string;
  }
): RuntimeExecutionRecord | null {
  const channel = store.resolveTarget(input.message.channelId);
  if (!channel || !hasRuntimeTarget(input.agent)) return null;
  // 系统 Reminder 等定向 turn 不经过普通 wake target 选择，但仍必须先绑定 execution/context 再投递。
  const execution = store.createRuntimeExecution({
    id: `exec_${randomUUID().replaceAll("-", "")}`,
    serverId: channel.serverId ?? "local",
    machineId: input.agent.machineId,
    agentId: input.agent.id,
    messageId: input.message.id,
    threadChannelId: input.threadChannelId,
    runtime: input.agent.runtime,
    launchId: input.agent.launchId ?? undefined,
    ...runtimeExecutionContext(store, input.message),
    status: "queued"
  });
  store.appendRuntimeExecutionEvent({
    executionId: execution.id,
    agentId: input.agent.id,
    kind: "queued",
    title: "Queued",
    detail: input.detail ?? `Queued message turn for @${input.agent.name}.`
  });
  store.enqueueForAgent(input.agent.id, input.message.id, execution.id);
  return execution;
}

export function createAdoptedTaskRuntimeExecution(
  store: TaskRuntimeStore & Pick<TyrDb, "latestRuntimeExecutionForTask">,
  input: {
    serverId: string;
    machineId: string;
    agent: AgentRecord;
    task: TaskRecord;
    launchId?: string;
    detail?: string;
  }
): { execution: RuntimeExecutionRecord; adoptedEvent: RuntimeExecutionEventRecord } | null {
  const runtime = input.agent.runtime;
  if (!runtime) return null;
  if (store.latestRuntimeExecutionForTask(input.task.id)) return null;
  const message = store.getMessage(input.task.messageId);
  // Agent 在普通 @ 消息 turn 内执行 claim-message 时，runtime 已经在工作；这里补一条 execution 作为当前 turn 的承载记录。
  const execution = store.createRuntimeExecution({
    id: `exec_${randomUUID().replaceAll("-", "")}`,
    serverId: input.serverId,
    machineId: input.machineId,
    agentId: input.agent.id,
    taskId: input.task.id,
    messageId: input.task.messageId,
    threadChannelId: input.task.threadChannelId,
    runtime,
    launchId: input.launchId,
    ...runtimeExecutionContext(store, message),
    status: "running"
  });
  const adoptedEvent = store.appendRuntimeExecutionEvent({
    executionId: execution.id,
    agentId: input.agent.id,
    taskId: input.task.id,
    kind: "turn_started",
    title: "Task claimed",
    detail: input.detail ?? `@${input.agent.name} claimed task #${input.task.taskNumber} during the active turn.`
  });
  return { execution, adoptedEvent };
}

export function createQueuedThreadHandoffRuntimeExecution(
  store: TaskRuntimeStore & Pick<TyrDb, "enqueueForAgent">,
  input: {
    serverId: string;
    machineId: string;
    agent: AgentRecord;
    task: TaskRecord;
    message: MessageRecord;
    launchId?: string;
    detail?: string;
    orchestration?: RuntimeExecutionOrchestration;
  }
): { execution: RuntimeExecutionRecord; queuedEvent: RuntimeExecutionEventRecord } {
  const runtime = input.agent.runtime;
  if (!runtime) throw new Error("agent_runtime_required");
  // Thread handoff 是同一个父 task 的参与执行；execution 指向 handoff 消息，但不创建新的 TaskRecord。
  const execution = store.createRuntimeExecution({
    id: `exec_${randomUUID().replaceAll("-", "")}`,
    serverId: input.serverId,
    machineId: input.machineId,
    agentId: input.agent.id,
    taskId: input.task.id,
    messageId: input.message.id,
    threadChannelId: input.task.threadChannelId ?? input.message.channelId,
    runtime,
    launchId: input.launchId,
    ...runtimeExecutionContext(store, input.message),
    ...runtimeExecutionOrchestration(input.orchestration),
    status: "queued"
  });
  const queuedEvent = store.appendRuntimeExecutionEvent({
    executionId: execution.id,
    agentId: input.agent.id,
    taskId: input.task.id,
    kind: "queued",
    title: "Queued",
    detail: input.detail ?? `Queued thread handoff for @${input.agent.name}.`
  });
  store.enqueueForAgent(input.agent.id, input.message.id, execution.id);
  return { execution, queuedEvent };
}

export function createQueuedMessageHandoffRuntimeExecution(
  store: TaskRuntimeStore & Pick<TyrDb, "enqueueForAgent" | "listRuntimeExecutions">,
  input: {
    serverId: string;
    machineId: string;
    agent: AgentRecord;
    message: MessageRecord;
    launchId?: string;
    detail?: string;
    orchestration?: RuntimeExecutionOrchestration;
    communicationReturn?: {
      channelId: string;
      conversationId?: string;
      sourceMessageId?: string;
      userId: string;
      source: NonNullable<RuntimeExecutionRecord["communicationReturnSource"]>;
      externalRef?: string;
      instructions?: string;
      instructionsRevision?: number;
    };
  }
): { execution: RuntimeExecutionRecord; queuedEvent: RuntimeExecutionEventRecord } {
  const runtime = input.agent.runtime;
  if (!runtime) throw new Error("agent_runtime_required");
  const routingInstructions = input.communicationReturn
    ? store.getWorkspaceRoutingInstructions(input.serverId)
    : null;
  const controllerActorMode = controllerActorModeForCommunicationHandoff(
    store,
    input.serverId,
    input.communicationReturn?.externalRef
  );
  // Visible chat handoffs are conversation turns, not tasks; keep them attached to the Agent-authored message.
  const execution = store.createRuntimeExecution({
    id: `exec_${randomUUID().replaceAll("-", "")}`,
    serverId: input.serverId,
    machineId: input.machineId,
    agentId: input.agent.id,
    messageId: input.message.id,
    threadChannelId: input.message.channelType === "thread" ? input.message.channelId : undefined,
    runtime,
    launchId: input.launchId,
    ...runtimeExecutionContext(store, input.message),
    ...runtimeExecutionOrchestration(input.orchestration),
    // Communication Agent 是 server-hosted 身份；这里记录原始请求入口，完成后由 server 转发结果，而不是唤醒 TYR runtime。
    ...runtimeExecutionCommunicationReturn(input.communicationReturn ? {
      ...input.communicationReturn,
      // 最终表达使用派单时的配置，避免长任务在设置更新后产生不可解释的风格漂移。
      instructions: input.communicationReturn.instructions ?? routingInstructions?.instructions ?? "",
      instructionsRevision: input.communicationReturn.instructionsRevision ?? routingInstructions?.revision ?? 0
    } : undefined),
    controllerActorMode,
    status: "queued"
  });
  const queuedEvent = store.appendRuntimeExecutionEvent({
    executionId: execution.id,
    agentId: input.agent.id,
    kind: "queued",
    title: "Queued",
    detail: input.detail ?? `Queued visible message handoff for @${input.agent.name}.`
  });
  store.enqueueForAgent(input.agent.id, input.message.id, execution.id);
  return { execution, queuedEvent };
}

export function createQueuedDelegationRuntimeExecution(
  store: TaskRuntimeStore & Pick<TyrDb, "enqueueForAgent">,
  input: {
    serverId: string;
    machineId: string;
    delegator: AgentRecord;
    targetAgent: AgentRecord;
    message: MessageRecord;
    launchId?: string;
    detail?: string;
    orchestration?: RuntimeExecutionOrchestration;
  }
): { execution: RuntimeExecutionRecord; queuedEvent: RuntimeExecutionEventRecord } {
  const runtime = input.targetAgent.runtime;
  if (!runtime) throw new Error("agent_runtime_required");
  // Delegation is a server-side execution handoff; the hidden message is only the daemon wake payload.
  const execution = store.createRuntimeExecution({
    id: `exec_${randomUUID().replaceAll("-", "")}`,
    serverId: input.serverId,
    machineId: input.machineId,
    agentId: input.targetAgent.id,
    messageId: input.message.id,
    runtime,
    launchId: input.launchId,
    ...runtimeExecutionContext(store, input.message),
    ...runtimeExecutionOrchestration(input.orchestration),
    status: "queued"
  });
  const queuedEvent = store.appendRuntimeExecutionEvent({
    executionId: execution.id,
    agentId: input.targetAgent.id,
    kind: "queued",
    title: "Delegated",
    detail: input.detail ?? `@${input.delegator.name} delegated work to @${input.targetAgent.name}.`
  });
  store.enqueueForAgent(input.targetAgent.id, input.message.id, execution.id);
  return { execution, queuedEvent };
}

export function createQueuedAgentReturnRuntimeExecution(
  store: AgentReturnRuntimeStore,
  input: {
    completedExecution: RuntimeExecutionRecord;
    finalMessage: MessageRecord;
    detail?: string;
  }
): { message: MessageRecord; execution: RuntimeExecutionRecord; queuedEvent: RuntimeExecutionEventRecord } | null {
  const completedExecution = store.getRuntimeExecution(input.completedExecution.id) ?? input.completedExecution;
  // 只有成功完成的 worker 才能向上游 Agent 回传结果；失败后的迟到消息不能恢复成成功 handoff。
  if (completedExecution.status !== "completed" || !completedExecution.returnToAgentId || !completedExecution.expectReply || completedExecution.returnExecutionId) return null;
  const returnAgent = store.getAgent(completedExecution.returnToAgentId);
  const completedAgent = store.getAgent(completedExecution.agentId);
  if (!returnAgent || !completedAgent || !hasRuntimeTarget(returnAgent) || !store.getMachine(returnAgent.machineId)) return null;
  const returnWakeTarget = returnWakeTargetChannelId(store, completedExecution, returnAgent, input.finalMessage);
  if (!returnWakeTarget) return null;
  const sourceExecution = completedExecution.sourceExecutionId ? store.getRuntimeExecution(completedExecution.sourceExecutionId) : null;
  const upstreamReturnToAgentId = sourceExecution?.returnToAgentId;
  const handoffMessage = store.getMessage(completedExecution.messageId);
  const returnMessage = store.sendMessage({
    target: returnWakeTarget,
    content: agentReturnMessageContent({ returnAgent, completedAgent, handoffMessage, finalMessage: input.finalMessage }),
    kind: "delegation",
    senderType: "system",
    senderId: "system",
    senderName: "TYR",
    serverId: completedExecution.serverId
  }).message;
  const { execution, queuedEvent } = createQueuedMessageHandoffRuntimeExecution(store, {
    serverId: completedExecution.serverId ?? "local",
    machineId: returnAgent.machineId,
    agent: returnAgent,
    message: returnMessage,
    launchId: returnAgent.launchId ?? undefined,
    detail: input.detail ?? `Returning @${completedAgent.name} result to @${returnAgent.name}.`,
    orchestration: {
      sourceExecutionId: completedExecution.id,
      returnToAgentId: upstreamReturnToAgentId,
      rootMessageId: completedExecution.rootMessageId ?? completedExecution.messageId,
      hopCount: completedExecution.hopCount,
      expectReply: Boolean(upstreamReturnToAgentId)
    },
    communicationReturn: pendingCommunicationReturnFromExecution(sourceExecution)
  });
  store.markRuntimeExecutionReturnDispatched(completedExecution.id, {
    returnMessageId: returnMessage.id,
    returnExecutionId: execution.id
  });
  return { message: returnMessage, execution, queuedEvent };
}

export function createCommunicationReturnMessageForFinalMessage(
  store: CommunicationReturnRuntimeStore,
  input: {
    completedExecution: RuntimeExecutionRecord;
    finalMessage: MessageRecord;
  },
  options: { defer?: boolean; presentedContent?: string; presentedStatus?: "completed" | "failed"; presentedEvidence?: MessageResult["evidence"] } = {}
): { message: MessageRecord; execution: RuntimeExecutionRecord; attachmentMessage?: MessageRecord; bridgeMessage?: CrossWorkspaceMessageRecord } | null {
  if (options.defer) return null;
  const completedExecution = store.getRuntimeExecution(input.completedExecution.id) ?? input.completedExecution;
  if (
    // Communication return 是客户可见成功结果，必须以数据库中的 completed 终态为准。
    completedExecution.status !== "completed" ||
    !completedExecution.communicationReturnChannelId ||
    !completedExecution.communicationReturnUserId ||
    !completedExecution.communicationReturnSource ||
    completedExecution.communicationReturnMessageId ||
    completedExecution.agentId !== input.finalMessage.senderId
  ) return null;
  const completedAgent = store.getAgent(completedExecution.agentId);
  if (!completedAgent) return null;
  const workspaceBridgeRef = workspaceBridgeRefForExecution(completedExecution);
  const returnConversationId = workspaceBridgeRef?.conversationId ?? completedExecution.communicationReturnConversationId;
  const assistant = store.ensureDefaultCommunicationAgent(completedExecution.serverId ?? completedAgent.serverId ?? "local");
  const result = buildCompletedCommunicationResult(
    completedAgent,
    options.presentedContent ?? communicationReturnFinalContent(store, completedExecution.id, input.finalMessage)
  );
  if (options.presentedEvidence?.length) result.evidence = options.presentedEvidence;
  if (workspaceBridgeRef && options.presentedStatus === "failed") {
    result.status = "failed";
    result.title = "TYR could not verify the Agent result";
    result.summary = options.presentedContent ?? result.summary;
  }
  if (completedExecution.communicationReturnSourceMessageId) {
    // 最终消息携带同一请求关联，客户端可在终态事件丢失时仍精确清理临时进度。
    result.communicationRequest = { sourceMessageId: completedExecution.communicationReturnSourceMessageId };
  }
  const attachments = communicationReturnAttachments(store, completedExecution.communicationReturnChannelId, completedExecution.id, input.finalMessage);
  // Bridge 终态只持久化一个 communicationReturnMessageId，因此附件必须留在这条可追踪的最终回传上。
  const separateAttachmentMessage = !workspaceBridgeRef && attachments.sentBeforeFinalReply && (input.finalMessage.attachmentIds?.length ?? 0) === 0;
  const attachmentResult = separateAttachmentMessage && attachments.attachmentIds.length > 0
    ? buildCompletedCommunicationResult(
      completedAgent,
      attachments.sourceContent || `${completedAgent.displayName || completedAgent.name} sent an attachment.`
    )
    : null;
  // Agent 已先发附件、再发无附件结论时，Assistant DM 保留同样的两条消息语义。
  const attachmentMessage = attachmentResult
    ? store.sendMessage({
      target: completedExecution.communicationReturnChannelId,
      ...(returnConversationId ? {
        conversationId: returnConversationId,
        allowClosedConversation: true
      } : {}),
      // 附件结果也保留 worker 来源，避免在 Assistant DM 中被误认为 TYR 自己发送。
      content: attachmentResult.body || attachmentResult.summary,
      result: attachmentResult,
      attachmentIds: attachments.attachmentIds,
      senderType: "agent",
      senderId: assistant.id,
      senderName: assistant.displayName,
      serverId: completedExecution.serverId ?? assistant.serverId ?? "local"
    }).message
    : undefined;
  const returnMessage = store.sendMessage({
    target: completedExecution.communicationReturnChannelId,
    ...(returnConversationId ? {
      conversationId: returnConversationId,
      allowClosedConversation: true
    } : {}),
    // Bridge 自有来源标签；只传客户结论，避免把 TYR 页脚重复聚合到跨 Workspace 回复。
    content: separateAttachmentMessage || workspaceBridgeRef ? (result.body || result.summary) : communicationResultPlainText(result),
    result,
    attachmentIds: separateAttachmentMessage ? [] : attachments.attachmentIds,
    senderType: "agent",
    senderId: assistant.id,
    senderName: assistant.displayName,
    serverId: completedExecution.serverId ?? assistant.serverId ?? "local"
  }).message;
  const updated = store.markRuntimeExecutionCommunicationReturnDispatched(completedExecution.id, {
    communicationReturnMessageId: returnMessage.id
  });
  const bridgeMessage = createWorkspaceBridgeReturnMessageForFinalMessage(store, {
    completedExecution: updated ?? completedExecution,
    finalMessage: input.finalMessage,
    communicationReturnMessage: returnMessage
  }) ?? undefined;
  return { message: returnMessage, execution: updated ?? completedExecution, attachmentMessage, bridgeMessage };
}

export function communicationReturnFailureContent(
  store: Pick<CommunicationReturnRuntimeStore, "getAgent" | "listRuntimeExecutionEvents">,
  completedExecution: RuntimeExecutionRecord
): { title: string; body: string; sourceAgentName: string; sourceAgentId: string } | null {
  const completedAgent = store.getAgent(completedExecution.agentId);
  if (!completedAgent) return null;
  const sourceAgentName = completedAgent.displayName || completedAgent.name;
  const lifecycleCancellation = completedExecution.status === "cancelled"
    ? [...store.listRuntimeExecutionEvents(completedExecution.id)].reverse().find((event) => {
        if (event.kind !== "diagnostic" || event.title !== "Execution cancelled" || typeof event.detail !== "string") return false;
        const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
          ? event.payload as Record<string, unknown>
          : null;
        return payload?.source === "agent_lifecycle";
      })
    : null;
  const failure = completedExecution.status === "cancelled"
    ? {
        title: "Agent request cancelled",
        body: lifecycleCancellation?.detail?.trim() || `${sourceAgentName}'s request was cancelled before it completed. Please retry if the work is still needed.`
      }
    : completedExecution.status === "stalled"
    ? {
        title: "Execution status unconfirmed",
        body: `${sourceAgentName}'s execution status could not be confirmed. Please review the execution before retrying.`
      }
    : completedExecution.status === "failed"
      ? {
          title: "Agent execution failed",
          body: `${sourceAgentName} could not complete the request. Please review the execution details before retrying.`
        }
      : {
          title: "Agent reply unavailable",
          body: `${sourceAgentName} completed the work, but TYR could not publish its reply. Please retry the request.`
        };
  return { ...failure, sourceAgentName, sourceAgentId: completedAgent.id };
}

export function createCommunicationReturnFailureMessage(
  store: CommunicationReturnRuntimeStore,
  input: {
    completedExecution: RuntimeExecutionRecord;
  },
  options: { presentedContent?: string } = {}
): { message: MessageRecord; execution: RuntimeExecutionRecord } | null {
  const completedExecution = store.getRuntimeExecution(input.completedExecution.id) ?? input.completedExecution;
  if (
    !["completed", "failed", "stalled", "cancelled"].includes(completedExecution.status) ||
    !completedExecution.communicationReturnChannelId ||
    !completedExecution.communicationReturnUserId ||
    !completedExecution.communicationReturnSource ||
    completedExecution.communicationReturnMessageId
  ) return null;
  const failure = communicationReturnFailureContent(store, completedExecution);
  if (!failure) return null;
  const workspaceBridgeRef = workspaceBridgeRefForExecution(completedExecution);
  const returnConversationId = workspaceBridgeRef?.conversationId ?? completedExecution.communicationReturnConversationId;
  const completedAgent = store.getAgent(completedExecution.agentId)!;
  const assistant = store.ensureDefaultCommunicationAgent(completedExecution.serverId ?? completedAgent.serverId ?? "local");
  const publicBody = options.presentedContent?.trim() || failure.body;
  const returnMessage = store.sendMessage({
    target: completedExecution.communicationReturnChannelId,
    ...(returnConversationId ? {
      conversationId: returnConversationId,
      allowClosedConversation: true
    } : {}),
    content: publicBody,
    result: {
      version: 1,
      status: "failed",
      title: failure.title,
      summary: publicBody,
      body: publicBody,
      sourceAgentId: failure.sourceAgentId,
      sourceAgentName: failure.sourceAgentName,
      ...(completedExecution.communicationReturnSourceMessageId ? {
        communicationRequest: { sourceMessageId: completedExecution.communicationReturnSourceMessageId }
      } : {})
    },
    senderType: "agent",
    senderId: assistant.id,
    senderName: assistant.displayName,
    serverId: completedExecution.serverId ?? assistant.serverId ?? "local"
  }).message;
  const updated = store.markRuntimeExecutionCommunicationReturnDispatched(completedExecution.id, {
    communicationReturnMessageId: returnMessage.id
  });
  return { message: returnMessage, execution: updated ?? completedExecution };
}

export function recoverWorkspaceBridgeFinalReplyFromRuntimeOutput(
  store: WorkspaceBridgeRuntimeOutputRecoveryStore,
  input: { completedExecution: RuntimeExecutionRecord },
  options: { deferCommunicationReturn: true }
): { finalMessage: MessageRecord; markerEvent: RuntimeExecutionEventRecord } | null;
export function recoverWorkspaceBridgeFinalReplyFromRuntimeOutput(
  store: WorkspaceBridgeRuntimeOutputRecoveryStore,
  input: { completedExecution: RuntimeExecutionRecord },
  options?: { deferCommunicationReturn?: false }
): { finalMessage: MessageRecord; markerEvent: RuntimeExecutionEventRecord; communicationReturn: NonNullable<ReturnType<typeof createCommunicationReturnMessageForFinalMessage>> } | null;
export function recoverWorkspaceBridgeFinalReplyFromRuntimeOutput(
  store: WorkspaceBridgeRuntimeOutputRecoveryStore,
  input: {
    completedExecution: RuntimeExecutionRecord;
  },
  options: { deferCommunicationReturn?: boolean } = {}
): { finalMessage: MessageRecord; markerEvent: RuntimeExecutionEventRecord; communicationReturn?: NonNullable<ReturnType<typeof createCommunicationReturnMessageForFinalMessage>> } | null {
  const completedExecution = store.getRuntimeExecution(input.completedExecution.id) ?? input.completedExecution;
  if (
    completedExecution.status !== "completed" ||
    !completedExecution.communicationReturnChannelId ||
    !completedExecution.communicationReturnUserId ||
    !completedExecution.communicationReturnSource ||
    completedExecution.communicationReturnMessageId ||
    !workspaceBridgeRefForExecution(completedExecution) ||
    store.findFinalMessageForExecution(completedExecution.id)
  ) return null;
  const completedAgent = store.getAgent(completedExecution.agentId);
  const handoffMessage = store.getMessage(completedExecution.messageId);
  if (!completedAgent || !handoffMessage) return null;
  const outputEvent = [...store.listRuntimeExecutionEvents(completedExecution.id)]
    .reverse()
    .find((event) => event.kind === "assistant_output" && typeof event.detail === "string" && event.detail.trim().length > 0);
  const finalContent = typeof outputEvent?.detail === "string" ? outputEvent.detail.trim() : "";
  if (!finalContent) return null;
  const finalMessage = store.sendMessage({
    target: handoffMessage.channelId,
    // 恢复回包仍属于原始 handoff；不能落入随后切换的 Agent pair 当前会话。
    ...(handoffMessage.conversationId ? {
      conversationId: handoffMessage.conversationId,
      allowClosedConversation: true
    } : {}),
    content: finalContent,
    senderType: "agent",
    senderId: completedAgent.id,
    senderName: completedAgent.name,
    serverId: completedExecution.serverId ?? completedAgent.serverId ?? "local"
  }).message;
  const markerEvent = store.appendRuntimeExecutionEvent({
    executionId: completedExecution.id,
    agentId: completedExecution.agentId,
    taskId: completedExecution.taskId,
    kind: "diagnostic",
    title: "Final reply recovered",
    detail: "Published bridge reply from completed runtime output after the final message callback did not arrive within the recovery window.",
    payload: {
      finalMessageId: finalMessage.id,
      recoveredFromRuntimeAssistantOutput: true,
      workspaceBridgeFinalReplyRecovery: true
    }
  });
  // 正常服务端链路先让 TYR 整理表达；纯 store 调用仍保留同步直返，便于迁移和离线恢复。
  if (options.deferCommunicationReturn) return { finalMessage, markerEvent };
  const communicationReturn = createCommunicationReturnMessageForFinalMessage(store, {
    completedExecution,
    finalMessage
  });
  if (!communicationReturn) return null;
  return { finalMessage, markerEvent, communicationReturn };
}

export function runtimeApprovalWithExecutionFallback(store: ApprovalFallbackStore, approval: RuntimeApprovalRecord): RuntimeApprovalRecord {
  if (approval.executionId) return approval;
  const messageExecution = approval.messageId ? store.latestRuntimeExecutionForMessage(approval.agentId, approval.messageId) : null;
  if (messageExecution) {
    return {
      ...approval,
      executionId: messageExecution.id,
      taskId: approval.taskId ?? messageExecution.taskId,
      threadChannelId: approval.threadChannelId ?? messageExecution.threadChannelId
    };
  }
  const task = approval.taskId ? null : approval.messageId ? store.taskForMessage(approval.messageId) : null;
  const taskId = approval.taskId ?? task?.id;
  if (!taskId) return approval;
  const fallback = store.latestRuntimeExecutionForTask(taskId);
  // 旧 runtime 或竞态路径可能只带 taskId；优先挂到该任务最新 execution，保证审批也进入同一执行 transcript。
  return {
    ...approval,
    taskId,
    messageId: approval.messageId ?? task?.messageId,
    threadChannelId: approval.threadChannelId ?? task?.threadChannelId,
    executionId: fallback?.id
  };
}
