import type {
  MessageRecord,
  RuntimeApprovalRecord,
  RuntimeExecutionEventRecord,
  RuntimeExecutionRecord,
  TaskRecord
} from "@tyr-ai/contracts";
import type {
  BuildGovernanceCaseOptions,
  GovernanceCase,
  GovernanceDecision,
  GovernanceProposedAction,
  GovernanceResolvedPolicy,
  GovernanceSourceTag,
  GovernanceTrajectoryEntry,
  GovernanceTrigger,
  GovernanceTrustLabel
} from "./types";
import {
  actionText,
  approvalPayloadForClassification,
  classifyRuntimeApproval,
  commandFromPayload,
  targetFromText,
  type RuntimeApprovalClassification
} from "./runtime-rules";
import { evaluateDeterministicPolicy, mergeEvidence, mergeRiskTypes } from "./deterministic-policy";
import { DEFAULT_MAX_EVENT_DETAIL_CHARS, redactAndLimit, sanitizeGovernanceSourceTags, sanitizeUnknown } from "./redaction";

const DEFAULT_MAX_EVENTS = 30;
const DEFAULT_MAX_CASE_CHARS = 24_000;
const DEFAULT_MAX_EVENT_PAYLOAD_CHARS = 2_000;
const DEFAULT_MAX_SOURCE_MESSAGE_CHARS = 1_000;
const MESSAGE_SOURCE_OPERATION_IDS = new Set(["message.read", "message.search", "message.check"]);
const TOOL_OPERATION_IDS: Record<string, string> = {
  check_messages: "message.check",
  mcp_chat_check_messages: "message.check",
  read_history: "message.read",
  mcp_chat_read_history: "message.read",
  search_messages: "message.search",
  mcp_chat_search_messages: "message.search",
  view_file: "attachment.view",
  mcp_chat_view_file: "attachment.view"
};

export function buildGovernanceCase(input: {
  trigger: GovernanceTrigger;
  execution: RuntimeExecutionRecord;
  approval: RuntimeApprovalRecord;
  events: RuntimeExecutionEventRecord[];
  message?: MessageRecord | null;
  task?: TaskRecord | null;
  policy?: GovernanceResolvedPolicy;
  options?: BuildGovernanceCaseOptions;
}): GovernanceCase {
  const options = {
    maxEvents: input.options?.maxEvents ?? DEFAULT_MAX_EVENTS,
    maxCaseChars: input.options?.maxCaseChars ?? DEFAULT_MAX_CASE_CHARS,
    maxEventDetailChars: input.options?.maxEventDetailChars ?? DEFAULT_MAX_EVENT_DETAIL_CHARS,
    maxEventPayloadChars: input.options?.maxEventPayloadChars ?? DEFAULT_MAX_EVENT_PAYLOAD_CHARS,
    maxSourceMessageChars: input.options?.maxSourceMessageChars ?? DEFAULT_MAX_SOURCE_MESSAGE_CHARS
  };
  const classification = classifyRuntimeApproval({ actionKind: input.approval.kind, payload: approvalPayloadForClassification(input.approval) });
  const proposedAction = proposedActionFromApproval(input.approval, classification);
  const sortedEvents = [...input.events].sort((a, b) => a.sequence - b.sequence || a.at.localeCompare(b.at)).slice(-options.maxEvents);
  const trajectory = sortedEvents.map((event) => trajectoryEntry(event, options));
  const sourceMessage = input.message ? {
    id: input.message.id,
    senderType: input.message.senderType,
    trust: "user_task_context_untrusted" as const,
    contentExcerpt: redactAndLimit(input.message.content, options.maxSourceMessageChars)
  } : undefined;
  const sourceTags = sanitizeGovernanceSourceTags([
    ...(input.message ? [{
      sourceType: "user_message" as const,
      sourceTrust: "task_context" as const,
      sourceId: input.message.id,
      channelId: input.message.channelId,
      messageId: input.message.id,
      threadChannelId: input.message.threadId ?? input.execution.threadChannelId,
      propagation: ["task_message"]
    }] : []),
    ...sourceTagsFromApprovalPayload(input.approval.payload),
    ...sourceTagsFromRuntimeEvents(sortedEvents)
  ]);
  const deterministicSignals = applyProvenanceSignals(
    evaluateDeterministicPolicy({ approval: input.approval, classification, policy: input.policy }),
    sourceTags
  );
  const task = input.task ? {
    id: input.task.id,
    title: redactAndLimit(input.task.title, options.maxSourceMessageChars),
    status: input.task.status
  } : undefined;
  const built: GovernanceCase = {
    caseId: input.approval.id,
    trigger: input.trigger,
    proposedAction,
    executionContext: {
      executionId: input.execution.id,
      approvalId: input.approval.id,
      agentId: input.execution.agentId,
      runtime: input.execution.runtime,
      taskId: input.approval.taskId ?? input.execution.taskId,
      messageId: input.approval.messageId ?? input.execution.messageId,
      threadChannelId: input.approval.threadChannelId ?? input.execution.threadChannelId,
      sourceMessage,
      task
    },
    sourceTags,
    trajectory,
    deterministicSignals
  };
  return fitCaseBudget(built, options.maxCaseChars);
}

function proposedActionFromApproval(approval: RuntimeApprovalRecord, classification: RuntimeApprovalClassification): GovernanceProposedAction {
  const detail = redactAndLimit(approval.detail, DEFAULT_MAX_EVENT_DETAIL_CHARS);
  const command = commandFromPayload(approval.payload) ?? approval.detail;
  return {
    kind: approval.kind,
    name: approval.title || approval.method || approval.kind,
    target: targetFromText(actionText(approval)),
    detail,
    argsSummary: redactAndLimit(typeof command === "string" ? command : JSON.stringify(sanitizeUnknown(command)), DEFAULT_MAX_EVENT_PAYLOAD_CHARS),
    riskClass: classification
  };
}

function trajectoryEntry(event: RuntimeExecutionEventRecord, options: Required<BuildGovernanceCaseOptions>): GovernanceTrajectoryEntry {
  return {
    sequence: event.sequence,
    kind: event.kind,
    title: event.title ?? null,
    detailExcerpt: event.detail ? redactAndLimit(event.detail, options.maxEventDetailChars) : null,
    payloadExcerpt: event.payload === undefined ? null : redactAndLimit(JSON.stringify(sanitizeUnknown(event.payload)), options.maxEventPayloadChars),
    trust: trustForRuntimeEvent(event),
    at: event.at
  };
}

function trustForRuntimeEvent(event: RuntimeExecutionEventRecord): GovernanceTrustLabel {
  if (event.kind === "tool_call" || event.kind === "approval_request" || event.kind === "approval_resolved") return "agent_action";
  if (event.kind === "assistant_delta" || event.kind === "thinking") return "agent_output";
  if (event.kind === "tool_output") return "untrusted_runtime_input";
  return "runtime_system";
}

function applyProvenanceSignals(decision: GovernanceDecision, sourceTags: GovernanceSourceTag[]): GovernanceDecision {
  const hasUntrustedSource = sourceTags.some((tag) => tag.sourceTrust === "untrusted_external");
  if (!hasUntrustedSource || decision.decision === "allow") return decision;
  return {
    ...decision,
    riskTypes: mergeRiskTypes(decision.riskTypes, ["untrusted_input"]),
    evidence: mergeEvidence(decision.evidence, ["trajectory contains output from an untrusted source before the proposed action"])
  };
}

function sourceTagsFromApprovalPayload(payload: unknown): GovernanceSourceTag[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const sourceTags = (payload as Record<string, unknown>).sourceTags;
  if (!Array.isArray(sourceTags)) return [];
  // Daemon runtime approvals can carry wake/attachment provenance; sanitize before any model or record use.
  return sourceTags
    .filter((tag): tag is Record<string, unknown> => Boolean(tag && typeof tag === "object" && !Array.isArray(tag)))
    .map((tag) => ({
      sourceType: typeof tag.sourceType === "string" ? tag.sourceType as GovernanceSourceTag["sourceType"] : "runtime_event",
      sourceTrust: typeof tag.sourceTrust === "string" ? tag.sourceTrust as GovernanceSourceTag["sourceTrust"] : "runtime_observation",
      sourceId: typeof tag.sourceId === "string" ? tag.sourceId : undefined,
      channelId: typeof tag.channelId === "string" ? tag.channelId : undefined,
      messageId: typeof tag.messageId === "string" ? tag.messageId : undefined,
      attachmentId: typeof tag.attachmentId === "string" ? tag.attachmentId : undefined,
      threadChannelId: typeof tag.threadChannelId === "string" ? tag.threadChannelId : undefined,
      propagation: Array.isArray(tag.propagation) ? tag.propagation.map(String) : undefined
    }));
}

function sourceTagsFromRuntimeEvents(events: RuntimeExecutionEventRecord[]): GovernanceSourceTag[] {
  const tags: GovernanceSourceTag[] = [];
  let lastToolCall: RuntimeExecutionEventRecord | null = null;
  // Runtime tools can be interleaved; callId is the stable link between a tool output and its source call.
  const toolCallsByCallId = new Map<string, RuntimeExecutionEventRecord>();
  for (const event of events) {
    if (event.kind === "tool_call") {
      lastToolCall = event;
      const callId = callIdFromRuntimeEvent(event);
      if (callId) toolCallsByCallId.set(callId, event);
    }
    const relatedToolCall = event.kind === "tool_output"
      ? toolCallForOutput(event, toolCallsByCallId, lastToolCall)
      : lastToolCall;
    tags.push(sourceTagFromRuntimeEvent(event, relatedToolCall));
  }
  return tags;
}

function sourceTagFromRuntimeEvent(event: RuntimeExecutionEventRecord, lastToolCall?: RuntimeExecutionEventRecord | null): GovernanceSourceTag {
  if (event.kind === "tool_output") {
    const toolContext = runtimeToolContext(lastToolCall, event);
    const structuredSource = sourceTagFromStructuredToolOutput(event, toolContext);
    if (structuredSource) return structuredSource;
    return {
      sourceType: "tool_output",
      sourceTrust: "runtime_observation",
      sourceId: event.id,
      propagation: [event.title ?? event.kind]
    };
  }
  if (event.kind === "tool_call" || event.kind === "approval_request" || event.kind === "approval_resolved") {
    return {
      sourceType: "agent_action",
      sourceTrust: "agent_action",
      sourceId: event.id,
      propagation: [event.title ?? event.kind]
    };
  }
  return {
    sourceType: "runtime_event",
    sourceTrust: "runtime_observation",
    sourceId: event.id,
    propagation: [event.title ?? event.kind]
  };
}

type RuntimeToolContext = {
  name: string;
  input?: unknown;
  command?: string;
  operationId?: string;
  callId?: string;
};

function toolCallForOutput(
  outputEvent: RuntimeExecutionEventRecord,
  toolCallsByCallId: Map<string, RuntimeExecutionEventRecord>,
  lastToolCall: RuntimeExecutionEventRecord | null
): RuntimeExecutionEventRecord | null {
  const callId = callIdFromRuntimeEvent(outputEvent);
  return callId ? toolCallsByCallId.get(callId) ?? lastToolCall : lastToolCall;
}

function runtimeToolContext(toolCall: RuntimeExecutionEventRecord | null | undefined, outputEvent: RuntimeExecutionEventRecord): RuntimeToolContext {
  const callPayload = objectPayload(toolCall?.payload);
  const outputPayload = objectPayload(outputEvent.payload);
  const input = callPayload && "input" in callPayload ? callPayload.input : toolCall?.payload;
  const command = toolCall
    ? commandFromPayload(input) ?? commandFromRuntimeEvent(toolCall)
    : undefined;
  const name = toolCall?.title ?? outputEvent.title ?? outputEvent.kind;
  const outputName = outputEvent.title ?? outputEvent.kind;
  return {
    name,
    input,
    command,
    operationId: stringValue(callPayload?.operationId) ?? operationIdFromToolName(name) ?? operationIdFromToolName(outputName) ?? operationIdFromCommand(command),
    callId: stringValue(callPayload?.callId) ?? stringValue(outputPayload?.callId)
  };
}

function sourceTagFromStructuredToolOutput(event: RuntimeExecutionEventRecord, context: RuntimeToolContext): GovernanceSourceTag | null {
  const operationId = context.operationId ?? operationIdFromToolName(event.title ?? "");
  // These tools return user/channel/attachment/web content into the model context, so later risky actions must know that influence.
  if (operationId && MESSAGE_SOURCE_OPERATION_IDS.has(operationId)) return messageSourceTagFromTool(event, context, operationId);
  if (operationId === "attachment.view") return attachmentSourceTagFromTool(event, context);
  const fileReadSource = untrustedFileReadSource(context);
  if (fileReadSource?.attachmentId) {
    return {
      sourceType: "attachment",
      sourceTrust: "untrusted_external",
      sourceId: fileReadSource.attachmentId,
      attachmentId: fileReadSource.attachmentId,
      propagation: [context.name, `read:attachment:${fileReadSource.attachmentId}`]
    };
  }
  if (fileReadSource?.sourceId) {
    return {
      sourceType: "tool_output",
      sourceTrust: "untrusted_external",
      sourceId: fileReadSource.sourceId,
      propagation: [context.name, `read:${fileReadSource.sourceId}`]
    };
  }
  const webSource = webReadSource(context);
  if (webSource) {
    return {
      sourceType: "tool_output",
      sourceTrust: "untrusted_external",
      sourceId: webSource,
      propagation: [context.name, `web:${webSource}`]
    };
  }
  return null;
}

function messageSourceTagFromTool(event: RuntimeExecutionEventRecord, context: RuntimeToolContext, operationId: string): GovernanceSourceTag {
  const input = objectPayload(context.input);
  const channel = stringValue(input?.channel) ?? stringValue(input?.target);
  return {
    sourceType: "channel_message",
    sourceTrust: "untrusted_external",
    sourceId: channel ? `${operationId}:${channel}` : event.id,
    channelId: stableChannelId(channel),
    propagation: [operationId, ...(channel ? [`channel:${channel}`] : [])]
  };
}

function attachmentSourceTagFromTool(event: RuntimeExecutionEventRecord, context: RuntimeToolContext): GovernanceSourceTag {
  const attachmentId = attachmentIdFromToolContext(context) ?? attachmentIdFromText(event.detail ?? "") ?? event.id;
  return {
    sourceType: "attachment",
    sourceTrust: "untrusted_external",
    sourceId: attachmentId,
    attachmentId,
    propagation: ["attachment.view"]
  };
}

function commandFromRuntimeEvent(event: RuntimeExecutionEventRecord): string {
  const payloadCommand = commandFromPayload(event.payload);
  if (payloadCommand) return payloadCommand;
  const payload = objectPayload(event.payload);
  const inputCommand = commandFromPayload(payload?.input);
  if (inputCommand) return inputCommand;
  if (event.detail) {
    try {
      const parsed = JSON.parse(event.detail) as unknown;
      const parsedCommand = commandFromPayload(parsed);
      if (parsedCommand) return parsedCommand;
    } catch {
      // Runtime event details are often plain text; fall back to the raw detail below.
    }
  }
  return event.detail ?? "";
}

function operationIdFromToolName(name: string | null | undefined): string | undefined {
  const normalized = String(name ?? "").toLowerCase();
  return TOOL_OPERATION_IDS[normalized];
}

function operationIdFromCommand(command: string | undefined): string | undefined {
  if (!command) return undefined;
  if (/\btyr\s+message\s+check\b/i.test(command)) return "message.check";
  if (/\btyr\s+message\s+read\b/i.test(command)) return "message.read";
  if (/\btyr\s+message\s+search\b/i.test(command)) return "message.search";
  if (/\btyr\s+attachment\s+view\b/i.test(command)) return "attachment.view";
  return undefined;
}

function callIdFromRuntimeEvent(event: RuntimeExecutionEventRecord): string | undefined {
  return stringValue(objectPayload(event.payload)?.callId);
}

function untrustedReadSource(command: string): string | null {
  if (!isReadonlyFileReadCommand(command)) return null;
  const paths = localPathMentions(command);
  return paths.find(isUntrustedLocalInputPath) ?? (/\buntrusted\b/i.test(command) ? "untrusted-file" : null);
}

function untrustedFileReadSource(context: RuntimeToolContext): { sourceId?: string; attachmentId?: string } | null {
  const input = objectPayload(context.input);
  const inputPath = stringValue(input?.file_path) ?? stringValue(input?.filePath) ?? stringValue(input?.path);
  const commandSource = context.command ? untrustedReadSource(context.command) : null;
  const sourcePath = inputPath ?? commandSource;
  if (!sourcePath) return null;
  const attachmentId = attachmentIdFromText(sourcePath);
  if (attachmentId) return { attachmentId };
  if (isUntrustedLocalInputPath(sourcePath)) return { sourceId: sourcePath };
  return null;
}

function webReadSource(context: RuntimeToolContext): string | null {
  const input = objectPayload(context.input);
  const directUrl = stringValue(input?.url) ?? stringValue(input?.href);
  if (directUrl) return directUrl;
  if (/\bweb[_-]?(?:search|fetch|read)\b/i.test(context.name)) {
    return stringValue(input?.query) ?? context.name;
  }
  if (!context.command || !/\b(?:curl|wget)\b/i.test(context.command)) return null;
  return firstUrlMention(context.command);
}

function isReadonlyFileReadCommand(command: string): boolean {
  return /\b(cat|head|tail|less|more|sed|awk|grep|rg)\b/i.test(command);
}

function localPathMentions(value: string): string[] {
  return Array.from(value.matchAll(/(?:\/private\/tmp|\/tmp|\/private\/var\/folders|\/var\/folders|~\/Downloads|~\/\.tyr-ai\/attachments|\/Users\/[^/\s'"`]+\/Downloads|\/Users\/[^/\s'"`]+\/\.tyr-ai\/attachments)[^\s'"`，。；;|&)]*/g), (match) => match[0]);
}

function isUntrustedLocalInputPath(value: string): boolean {
  return /(?:^|\/)(?:tmp|Downloads|Caches|TemporaryItems)\b/i.test(value) ||
    /\/(?:private\/)?var\/folders\//i.test(value) ||
    /(?:^|\/)\.tyr-ai\/attachments\//i.test(value) ||
    /untrusted|instruction|prompt/i.test(value);
}

function attachmentIdFromToolContext(context: RuntimeToolContext): string | undefined {
  const input = objectPayload(context.input);
  return stringValue(input?.attachment_id) ??
    stringValue(input?.attachmentId) ??
    (context.command ? attachmentIdFromText(context.command) : undefined);
}

function attachmentIdFromText(value: string): string | undefined {
  return value.match(/\batt_[A-Za-z0-9_]+\b/)?.[0];
}

function firstUrlMention(value: string): string | null {
  return value.match(/https?:\/\/[^\s'"`，。；;|&)]*/i)?.[0] ?? null;
}

function objectPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stableChannelId(value: string | undefined): string | undefined {
  if (!value || value.startsWith("#") || value.startsWith("@")) return undefined;
  return value;
}

function fitCaseBudget(input: GovernanceCase, maxCaseChars: number): GovernanceCase {
  let current = input;
  while (JSON.stringify(current).length > maxCaseChars && current.trajectory.length > 1) {
    current = { ...current, trajectory: current.trajectory.slice(1) };
  }
  if (JSON.stringify(current).length <= maxCaseChars) return current;
  return {
    ...current,
    executionContext: {
      ...current.executionContext,
      sourceMessage: current.executionContext.sourceMessage
        ? { ...current.executionContext.sourceMessage, contentExcerpt: redactAndLimit(current.executionContext.sourceMessage.contentExcerpt, 300) }
        : undefined
    },
    proposedAction: {
      ...current.proposedAction,
      detail: redactAndLimit(current.proposedAction.detail, 300),
      argsSummary: current.proposedAction.argsSummary ? redactAndLimit(current.proposedAction.argsSummary, 500) : undefined
    }
  };
}
