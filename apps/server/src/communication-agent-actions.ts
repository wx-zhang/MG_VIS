import {
  AGENT_CAPABILITIES,
  isCommunicationAgent,
  isTyrAssistantManagementActionExposed,
  runtimeDisplayName,
  type AgentEditableField,
  type AgentRecord,
  type CommunicationAgentManagementAction,
  type CommunicationAgentManagementChoice,
  type CommunicationAgentManagementDraftRecord,
  type CommunicationAgentManagementParams,
  type MachineRecord,
  type RuntimeId,
  type RuntimePermissionMode,
  type RuntimeReport
} from "@tyr-ai/contracts";
import { canManageAgentRuntime } from "./access-control";
import {
  createAgentManagementService,
  type AgentBatchManagementResult,
  type AgentManagementAgentCandidate,
  type AgentManagementResult
} from "./agent-management-service";
import {
  guardAgentManagementMessage,
  type GuardAgentContext
} from "./agent-management-language-guard";
import type { CommunicationAgentSourceContext } from "./communication-agent-source";
import { requestRuntimeModelDetection } from "./runtime-model-detection";
import type { ServerRouteContext } from "./server-context";

export type CommunicationAgentActionIntent =
  | {
      action: "create";
      name?: string;
      machineReference?: string;
      runtimeReference?: string;
      modelReference?: string;
      permissionMode?: RuntimePermissionMode;
    }
  | {
      action: "update";
      agentReference?: string;
      field?: AgentEditableField;
      value?: string;
      foreignRuntimeReference?: string;
  }
  | { action: "start" | "stop" | "restart" | "delete"; agentReference?: string }
  | { action: "reset"; agentReference?: string }
  | { action: "scopes_read"; agentReference?: string }
  | { action: "batch_start" | "batch_stop" | "batch_restart"; computerReference?: string }
  | { action: "computer_rename"; computerReference?: string; name?: string }
  | { action: "runtime_models_detect"; computerReference?: string; runtimeReference?: string }
  | { action: "unsupported_batch" };

export interface CommunicationAgentActionReply {
  handled: boolean;
  content: string;
  draftId?: string;
}

export interface HandleCommunicationAgentActionInput {
  content: string;
  serverId: string;
  userId: string;
  assistant: AgentRecord;
  channelId: string;
  sourceMessageId: string;
  sourceContext: CommunicationAgentSourceContext;
}

type ManagementService = ReturnType<typeof createAgentManagementService>;
type DraftScope = Pick<
  CommunicationAgentManagementDraftRecord,
  "serverId" | "userId" | "assistantAgentId" | "source" | "sourceConversationKey"
>;

const MUTATION_VERB = /\b(?:create|add|restart|reset|stop|delete|remove|start|launch|rename|change|update|give|set)\b/i;
const CHINESE_MUTATION_VERB = /(?:创建|添加|重启|重置|停止|删除|启动|重命名|改名|修改|更改|设置|给予|清空)/;
const BATCH_TARGET = /(?:\ball\b|\bevery\b|所有|全部|每个)/i;
const EXPLICIT_WILDCARD_BATCH_TARGET = /^(?:please\s+)?(?:restart|reset|stop|delete|remove|start|launch|update|rename)\s+\*$/i;
const SENSITIVE_SETTINGS = /(?:\benv(?:ironment)?\s+vars?\b|\bpermission\s+mode\b|\bfull\s+access\b|\breasoning\s+effort\b|\bruntime\s+resource\s+grants?\b|\bapi\s+key\b|\bwith\s+description\b|\b(?:description|permission|temperature)\s*[:=]|\bwith\s+[a-z][\w.-]*\s*=|\b[A-Z][A-Z0-9_]{2,}=\S+)/i;
const CHINESE_SENSITIVE_SETTINGS = /(?:环境变量|API\s*密钥|推理强度|资源授权|运行时授权)/i;
const CHINESE_PERMISSION_MODE: Record<string, RuntimePermissionMode> = {
  "只读": "read-only",
  "只读权限": "read-only",
  "工作区写入": "workspace-write",
  "工作区写权限": "workspace-write",
  "完整开发权限": "dev-full-access",
  "完全开发权限": "dev-full-access"
};

export function communicationAgentManagementActionAvailabilityError(
  action: string
): "operation_no_longer_available" | null {
  // Registry 是当前可执行面的真源；未知值和已撤下能力都必须默认拒绝。
  return isTyrAssistantManagementActionExposed(action)
    ? null
    : "operation_no_longer_available";
}

function cleanExplicitValue(value: string | undefined): string | undefined {
  const cleaned = value
    ?.trim()
    .replace(/\s+(?:please|pls)$/i, "")
    .replace(/[.!?。！？]+$/g, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
  return cleaned || undefined;
}

function isSensitiveAgentManagementRequest(content: string): boolean {
  return SENSITIVE_SETTINGS.test(content) || CHINESE_SENSITIVE_SETTINGS.test(content);
}

function cleanChineseAgentReference(value: string | undefined): string | undefined {
  return cleanExplicitValue(value)?.replace(/\s+agent$/i, "").trim() || undefined;
}

function parseSupportedComputerBatchIntent(
  normalized: string
): Extract<CommunicationAgentActionIntent, { action: "batch_start" | "batch_stop" | "batch_restart" }> | null {
  const pingStart = normalized.match(/^(?:can you\s+)?ping\s+(?:all|every)\s+agents?\s+to\s+wake\s+up(?:\s+(?:on|in)\s+(.+))?$/i);
  if (pingStart) {
    const computerReference = cleanExplicitValue(pingStart[1]);
    return { action: "batch_start", ...(computerReference ? { computerReference } : {}) };
  }
  const englishStart = normalized.match(/^(?:please\s+|can you\s+)?(?:wake(?:\s+up)?|start|launch|resume)\s+(?:(?:all|every)\s+agents?|agents)(?:\s+(?:on|in)\s+(.+))?$/i);
  if (englishStart) {
    const computerReference = cleanExplicitValue(englishStart[1]);
    return { action: "batch_start", ...(computerReference ? { computerReference } : {}) };
  }
  const englishStopOrRestart = normalized.match(/^(?:please\s+|can you\s+)?(stop|restart)\s+(?:all|every)\s+agents?(?:\s+(?:on|in)\s+(.+))?$/i);
  if (englishStopOrRestart) {
    const computerReference = cleanExplicitValue(englishStopOrRestart[2]);
    return {
      action: englishStopOrRestart[1]!.toLowerCase() === "stop" ? "batch_stop" : "batch_restart",
      ...(computerReference ? { computerReference } : {})
    };
  }
  const chinese = normalized.match(/^(?:请)?(唤醒|启动|恢复|停止|重启)\s*(?:(.+?)\s*上的)?\s*(?:所有|全部|每个)\s*(?:Agent|代理)$/i);
  if (!chinese) return null;
  const verb = chinese[1]!;
  const computerReference = cleanExplicitValue(chinese[2]);
  return {
    action: verb === "停止" ? "batch_stop" : verb === "重启" ? "batch_restart" : "batch_start",
    ...(computerReference ? { computerReference } : {})
  };
}

function parseComputerRenameIntent(normalized: string): Extract<CommunicationAgentActionIntent, { action: "computer_rename" }> | null {
  const english = normalized.match(/^(?:please\s+)?rename\s+(?:the\s+)?(?:computer|machine|device)\s+(.+?)\s+to\s+(.+?)$/i);
  // “设备名称”必须在通用 Agent 名称修改规则之前识别，避免把 Computer hostname 当成 Agent 名称。
  const chinese = normalized.match(/^(?:请)?(?:将|把)\s*(?:电脑|计算机|机器|设备)\s*(.+?)\s*(?:重命名|改名)\s*为\s*(.+)$/i)
    ?? normalized.match(/^(?:请)?(?:将|把)\s*(?:电脑|计算机|机器|设备)\s*(.+?)\s*(?:的\s*)?(?:名称|名字)\s*[，,]?\s*(?:修改|更改|改|重命名|改名)\s*为\s*(.+)$/i)
    ?? normalized.match(/^(?:请)?(?:将|把)\s*(.+?)\s*(?:的\s*)?(?:电脑|计算机|机器|设备)\s*(?:名称|名字)\s*[，,]?\s*(?:修改|更改|改|重命名|改名)\s*为\s*(.+)$/i);
  const match = english ?? chinese;
  if (!match) return null;
  const computerReference = cleanExplicitValue(match[1]);
  const name = cleanExplicitValue(match[2]);
  return computerReference && name ? { action: "computer_rename", computerReference, name } : null;
}

function parseRuntimeModelDetectionIntent(normalized: string): Extract<CommunicationAgentActionIntent, { action: "runtime_models_detect" }> | null {
  const english = normalized.match(/^(?:please\s+)?(?:detect|refresh|show|list)\s+(?:available\s+)?(.+?)\s+models?\s+(?:on|in)\s+(.+?)$/i)
    ?? normalized.match(/^(?:please\s+)?(?:detect|refresh|show|list)\s+models?\s+for\s+(.+?)\s+(?:on|in)\s+(.+?)$/i);
  const chinese = normalized.match(/^(?:请)?(?:检测|刷新|查询|列出|显示)\s*(.+?)\s*上\s*(.+?)\s*(?:的)?(?:可用)?模型$/i);
  if (!english && !chinese) return null;
  const runtimeReference = cleanExplicitValue(english?.[1] ?? chinese?.[2]);
  const computerReference = cleanExplicitValue(english?.[2] ?? chinese?.[1]);
  return runtimeReference && computerReference
    ? { action: "runtime_models_detect", runtimeReference, computerReference }
    : null;
}

function parseAgentScopesReadIntent(normalized: string): Extract<CommunicationAgentActionIntent, { action: "scopes_read" }> | null {
  const english = normalized.match(/^(?:please\s+)?(?:show|list)\s+(?:the\s+)?(?:agent\s+)?(.+?)(?:'s|’s)?\s+(?:capability\s+)?scopes$/i)
    ?? normalized.match(/^what\s+(?:capability\s+)?scopes\s+does\s+(?:the\s+agent\s+)?(.+?)\s+have\??$/i);
  const chinese = normalized.match(/^(?:请)?(?:查看|查询|列出|显示)\s*(.+?)\s*(?:的)?(?:能力范围|权限范围|能力权限)$/i);
  const match = english ?? chinese;
  if (!match) return null;
  const agentReference = cleanChineseAgentReference(match[1]);
  return agentReference ? { action: "scopes_read", agentReference } : null;
}

function parseAgentResetIntent(normalized: string): Extract<CommunicationAgentActionIntent, { action: "reset" }> | null {
  const chinese = normalized.match(/^(?:请)?(?:重置|清除)\s*(?:Agent|代理)?\s*(.+?)(?:\s*的)?(?:会话|Session)?$/i);
  if (!chinese) return null;
  const agentReference = cleanChineseAgentReference(chinese[1]);
  return agentReference ? { action: "reset", agentReference } : null;
}

function parseChineseAgentUpdateIntent(normalized: string): CommunicationAgentActionIntent | null {
  const rename = normalized.match(/^(?:请)?(?:将|把)\s*(.+?)\s*(?:的\s*)?(?:名称|名字)\s*[，,]?\s*(?:修改|更改|改|重命名)\s*为\s*(.+)$/i)
    ?? normalized.match(/^(?:请)?(?:将|把)?\s*(.+?)\s*(?:重命名|改名)\s*为\s*(.+)$/i);
  if (rename) {
    const agentReference = cleanChineseAgentReference(rename[1]);
    const value = cleanExplicitValue(rename[2]);
    if (agentReference && value) return { action: "update", agentReference, field: "name", value };
  }

  const permission = normalized.match(/^(?:请)?(?:将|把)\s*(.+?)\s*(?:的\s*)?权限\s*[，,]?\s*(?:修改|更改|改|设置)\s*为\s*(只读(?:权限)?|工作区(?:写入|写权限)|(?:完整|完全)开发权限)$/i);
  if (permission) {
    const agentReference = cleanChineseAgentReference(permission[1]);
    const value = CHINESE_PERMISSION_MODE[permission[2]!];
    if (agentReference && value) return { action: "update", agentReference, field: "permissionMode", value };
  }

  const model = normalized.match(/^(?:请)?(?:将|把)\s*(.+?)\s*(?:的\s*)?模型\s*[，,]?\s*(?:修改|更改|改|设置)\s*为\s*(.+)$/i);
  if (model) {
    const agentReference = cleanChineseAgentReference(model[1]);
    const value = cleanExplicitValue(model[2]);
    if (agentReference && value) return { action: "update", agentReference, field: "model", value };
  }
  const collectModel = normalized.match(/^(?:请)?(?:修改|更改|设置)\s*(.+?)\s*(?:的\s*)?模型$/i);
  if (collectModel) {
    const agentReference = cleanChineseAgentReference(collectModel[1]);
    if (agentReference) return { action: "update", agentReference, field: "model" };
  }

  const clearDescription = normalized.match(/^(?:请)?清空\s*(.+?)\s*(?:的\s*)?(?:描述|简介)$/i);
  if (clearDescription) {
    const agentReference = cleanChineseAgentReference(clearDescription[1]);
    if (agentReference) return { action: "update", agentReference, field: "description", value: "" };
  }
  const description = normalized.match(/^(?:请)?(?:将|把)\s*(.+?)\s*(?:的\s*)?(?:描述|简介)\s*[，,]?\s*(?:修改|更改|改|设置)\s*为\s*(.+)$/i);
  if (description) {
    const agentReference = cleanChineseAgentReference(description[1]);
    const value = cleanExplicitValue(description[2]);
    if (agentReference && value) return { action: "update", agentReference, field: "description", value };
  }
  const collectDescription = normalized.match(/^(?:请)?(?:修改|更改|设置)\s*(.+?)\s*(?:的\s*)?(?:描述|简介)$/i);
  if (collectDescription) {
    const agentReference = cleanChineseAgentReference(collectDescription[1]);
    if (agentReference) return { action: "update", agentReference, field: "description" };
  }
  return null;
}

export function parseCommunicationAgentActionIntent(content: string): CommunicationAgentActionIntent | null {
  const normalized = content.trim().replace(/\s+/g, " ");
  if (!normalized || /^(?:\/?confirm|\/?cancel|default|\d+)$/.test(normalized.toLowerCase())) return null;
  const supportedBatch = parseSupportedComputerBatchIntent(normalized);
  if (supportedBatch) return supportedBatch;
  if ((MUTATION_VERB.test(normalized) || CHINESE_MUTATION_VERB.test(normalized)) && (
    BATCH_TARGET.test(normalized) || EXPLICIT_WILDCARD_BATCH_TARGET.test(normalized)
  )) {
    return { action: "unsupported_batch" };
  }
  const computerRename = parseComputerRenameIntent(normalized);
  if (computerRename) return computerRename;
  const runtimeModelDetection = parseRuntimeModelDetectionIntent(normalized);
  if (runtimeModelDetection) return runtimeModelDetection;
  const scopesRead = parseAgentScopesReadIntent(normalized);
  if (scopesRead) return scopesRead;
  const reset = parseAgentResetIntent(normalized);
  if (reset) return reset;
  if (CHINESE_SENSITIVE_SETTINGS.test(normalized)) return null;
  const chineseUpdate = parseChineseAgentUpdateIntent(normalized);
  if (chineseUpdate) return chineseUpdate;

  const pronounRename = normalized.match(/^(?:actually\s+)?change\s+its\s+name\s+to\s+(.+?)$/i);
  if (pronounRename) {
    const value = cleanExplicitValue(pronounRename[1]);
    if (value) return { action: "update", field: "name", value };
  }
  if (/^(?:i\s+want\s+)?(?:the\s+)?full\s+(?:dev|development)\s+access\s+(?:to\s+)?be\s+given\s+to\s+it$/i.test(normalized)) {
    return { action: "update", field: "permissionMode", value: "dev-full-access" };
  }

  const renameMatch = normalized.match(/^(?:please\s+)?rename\s+(?:the\s+agent\s+)?(.+?)\s+to\s+(.+?)$/i);
  if (renameMatch) {
    const agentReference = cleanExplicitValue(renameMatch[1]);
    const value = cleanExplicitValue(renameMatch[2]);
    if (agentReference && value) return { action: "update", agentReference, field: "name", value };
  }
  const clearDescriptionMatch = normalized.match(/^(?:please\s+)?clear\s+(?:the\s+agent\s+)?(.+?)(?:'s|’s)\s+description$/i);
  if (clearDescriptionMatch) {
    const agentReference = cleanExplicitValue(clearDescriptionMatch[1]);
    if (agentReference) return { action: "update", agentReference, field: "description", value: "" };
  }
  const permissionMatch = normalized.match(/^(?:please\s+)?give\s+(?:the\s+agent\s+)?(.+?)\s+(full\s+(?:dev|development)\s+access|workspace[- ]write\s+access|read[- ]only\s+access)$/i);
  if (permissionMatch) {
    const agentReference = cleanExplicitValue(permissionMatch[1]);
    const label = permissionMatch[2]!.toLowerCase();
    const value: RuntimePermissionMode = label.startsWith("full")
      ? "dev-full-access"
      : label.startsWith("workspace")
        ? "workspace-write"
        : "read-only";
    if (agentReference) return { action: "update", agentReference, field: "permissionMode", value };
  }
  const fieldMatch = normalized.match(/^(?:please\s+)?(?:change|set|update)\s+(?:the\s+agent\s+)?(.+?)(?:'s|’s)\s+(model|description)(?:\s+to\s+(.+?))?$/i);
  if (fieldMatch) {
    const agentReference = cleanExplicitValue(fieldMatch[1]);
    const value = cleanExplicitValue(fieldMatch[3]);
    if (agentReference) {
      return {
        action: "update",
        agentReference,
        field: fieldMatch[2]!.toLowerCase() as "model" | "description",
        ...(value === undefined ? {} : { value })
      };
    }
  }
  if (isSensitiveAgentManagementRequest(normalized)) return null;

  const createMatch = normalized.match(/^(?:please\s+)?(?:create|add)\s+(?:an?\s+)?agent\b/i);
  if (createMatch) {
    const createPermission = normalized.match(/\s+(?:with\s+)?(read[- ]only|limited)(?:\s+(?:access|permissions?))?$/i);
    const createText = createPermission ? normalized.slice(0, createPermission.index).trim() : normalized;
    const permissionMode: RuntimePermissionMode | undefined = createPermission ? "read-only" : undefined;
    const name = cleanExplicitValue(createText.match(
      /\bnamed\s+(.+?)(?=\s+on\s+|\s+using\s+|\s+with\s+(?:the\s+)?model\b|\s+(?:and\s+)?(?:the\s+)?default\s+model\b|$)/i
    )?.[1]);
    const machineReference = cleanExplicitValue(createText.match(
      /\bon\s+(.+?)(?=\s+using\s+|\s+with\s+(?:the\s+)?model\b|\s+(?:and\s+)?(?:the\s+)?default\s+model\b|$)/i
    )?.[1]);
    const runtimeReference = cleanExplicitValue(createText.match(
      /\busing\s+(.+?)(?=\s+with\s+(?:the\s+)?model\b|\s+(?:and\s+)?(?:the\s+)?default\s+model\b|$)/i
    )?.[1]);
    const explicitModel = cleanExplicitValue(createText.match(/\bwith\s+(?:the\s+)?model\s+(.+?)$/i)?.[1]);
    const modelReference = /\b(?:the\s+)?default\s+model\b/i.test(createText) ? "default" : explicitModel;
    return {
      action: "create",
      ...(name ? { name } : {}),
      ...(machineReference ? { machineReference } : {}),
      ...(runtimeReference ? { runtimeReference } : {}),
      ...(modelReference ? { modelReference } : {}),
      ...(permissionMode ? { permissionMode } : {})
    };
  }

  // restart 必须先于 start 判断，且目标只接受 verb 后完整、明确的剩余文本。
  const targetMatch = normalized.match(/^(?:please\s+)?(restart|reset|stop|delete|remove|start|launch)(?:\s+(?:the\s+)?agent)?(?:\s+(.+?))?$/i);
  if (!targetMatch) return null;
  const rawVerb = targetMatch[1]!;
  const verb = rawVerb.toLowerCase();
  const action = verb === "remove" ? "delete" : verb === "launch" ? "start" : verb;
  const agentReference = cleanExplicitValue(targetMatch[2]);
  // 无目标且大小写混合的单词更可能是 Agent 显示名（例如 StarT），不能当作 lifecycle verb。
  if (!agentReference && rawVerb !== rawVerb.toLowerCase() && rawVerb !== rawVerb.toUpperCase()) return null;
  return {
    action: action as "start" | "stop" | "restart" | "reset" | "delete",
    ...(agentReference ? { agentReference } : {})
  };
}

function scope(input: HandleCommunicationAgentActionInput): DraftScope {
  return {
    serverId: input.serverId,
    userId: input.userId,
    assistantAgentId: input.assistant.id,
    source: input.sourceContext.source,
    sourceConversationKey: input.sourceContext.sourceConversationKey
  };
}

function managementService(ctx: ServerRouteContext): ManagementService {
  return createAgentManagementService({
    store: ctx.store,
    startAgent: ctx.startAgent,
    sendToDaemon: ctx.sendToDaemon,
    emitRealtimeAgentStatus: ctx.emitRealtimeAgentStatus,
    emitRealtimeRuntimeExecution: ctx.emitRealtimeRuntimeExecution,
    emitRealtimeRuntimeApproval: ctx.emitRealtimeRuntimeApproval,
    publishTerminalCommunicationFailure: ctx.publishTerminalCommunicationFailure,
    broadcastRealtime: ctx.broadcastRealtime,
    publishWorkspaceSync: ctx.publishWorkspaceSync
  });
}

function titleStatus(status: AgentRecord["status"]): string {
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

function lifecycleAudit(
  ctx: ServerRouteContext,
  draft: CommunicationAgentManagementDraftRecord,
  status: string,
  batchResult?: AgentBatchManagementResult
): void {
  // Draft 与最终 service audit 复用同一个 operationId，后续监控可按操作聚合完整生命周期。
  const computerAction = draft.action === "computer_rename" || draft.action === "runtime_models_detect";
  const eventKind = draft.action === "computer_rename"
    ? "communication_agent_computer_rename"
    : draft.action === "runtime_models_detect"
      ? "communication_agent_computer_runtime_models_detect"
      : `communication_agent_agent_${draft.action}`;
  ctx.store.recordAuditEvent({
    kind: eventKind,
    actorType: "agent",
    actorId: draft.assistantAgentId,
    resourceType: computerAction ? "machine" : "agent",
    resourceId: computerAction ? draft.params.machineId ?? null : draft.params.targetAgentId ?? null,
    serverId: draft.serverId,
    metadata: {
      operationId: draft.operationId,
      action: draft.action,
      requestedByUserId: draft.userId,
      status,
      source: draft.source,
      sourceMessageId: draft.sourceMessageId,
      sourceConversationKey: draft.sourceConversationKey,
      assistantAgentId: draft.assistantAgentId,
      machineId: draft.params.machineId ?? null,
      machineName: draft.params.machineName ?? null,
      requestedName: draft.action === "computer_rename" ? draft.params.name ?? null : null,
      runtime: draft.params.runtime ?? null,
      model: draft.params.model ?? null,
      confirmationRequired: draft.stage === "awaiting_confirmation",
      confirmedAt: draft.confirmedAt ?? null,
      errorCode: status === "denied" || status === "failed" ? draft.errorCode ?? null : null,
      ...(batchResult ? {
        targetAgentIds: draft.params.targetAgentIds ?? [],
        completedCount: batchResult.completed,
        noopCount: batchResult.noop,
        partialCount: batchResult.partial,
        deniedCount: batchResult.denied,
        failedCount: batchResult.failed,
        skippedCount: batchResult.skipped
      } : {})
    }
  });
}

function beginDraft(
  ctx: ServerRouteContext,
  input: HandleCommunicationAgentActionInput,
  action: CommunicationAgentManagementAction,
  stage: CommunicationAgentManagementDraftRecord["stage"],
  params: CommunicationAgentManagementParams,
  choices: CommunicationAgentManagementChoice[],
  replyText: string
): { created: boolean; draft: CommunicationAgentManagementDraftRecord } {
  const result = ctx.store.createCommunicationAgentManagementDraft({
    ...scope(input),
    channelId: input.channelId,
    sourceMessageId: input.sourceMessageId,
    sourceEventKey: input.sourceContext.sourceEventKey,
    action,
    stage,
    params,
    choices,
    replyText
  });
  if (result.created) lifecycleAudit(ctx, result.record, "requested");
  return { created: result.created, draft: result.record };
}

function updateDraft(
  ctx: ServerRouteContext,
  draft: CommunicationAgentManagementDraftRecord,
  input: {
    stage?: CommunicationAgentManagementDraftRecord["stage"];
    params?: CommunicationAgentManagementParams;
    choices?: CommunicationAgentManagementChoice[];
    replyText: string;
  }
): CommunicationAgentActionReply {
  const updated = ctx.store.updateCommunicationAgentManagementDraft(draft.id, input);
  return { handled: true, content: updated?.replyText ?? input.replyText, draftId: draft.id };
}

function replayReply(draft: CommunicationAgentManagementDraftRecord): CommunicationAgentActionReply {
  if (draft.status === "expired") {
    return { handled: true, content: `The pending ${draft.action} request expired. Start again.`, draftId: draft.id };
  }
  return {
    handled: true,
    content: draft.replyText ?? "This agent management request was already handled.",
    draftId: draft.id
  };
}

function choiceForInput(content: string, choices: CommunicationAgentManagementChoice[]): CommunicationAgentManagementChoice | null {
  const normalized = content.trim().toLowerCase();
  if (/^\d+$/.test(normalized)) {
    const index = Number(normalized) - 1;
    return choices[index] ?? null;
  }
  return choices.find((choice) => choice.label.toLowerCase() === normalized || choice.value.toLowerCase() === normalized) ?? null;
}

function computerChoices(machines: MachineRecord[]): CommunicationAgentManagementChoice[] {
  return machines.map((machine) => ({ id: machine.id, label: machine.name, value: machine.id }));
}

function ownedMachines(ctx: ServerRouteContext, input: Pick<HandleCommunicationAgentActionInput, "serverId" | "userId">): MachineRecord[] {
  const role = ctx.store.listServersForUser(input.userId).find((server) => server.id === input.serverId)?.role;
  if (role !== "owner" && role !== "member") return [];
  // Computer rename/model detection 与 Web 路由保持一致，只允许真实 Computer owner 操作共享机器。
  return ctx.store.listMachines(input.serverId)
    .filter((machine) => !machine.deletedAt && machine.ownerUserId === input.userId);
}

function ownedAgentCandidates(
  service: ManagementService,
  input: Pick<HandleCommunicationAgentActionInput, "serverId" | "userId">
): AgentManagementAgentCandidate[] {
  return service.listAgentCandidates({ actorUserId: input.userId, serverId: input.serverId })
    .filter(({ agent, machine }) => Boolean(machine && canManageAgentRuntime(input.userId, agent, machine)));
}

function runtimeChoices(reports: RuntimeReport[]): CommunicationAgentManagementChoice[] {
  return reports.map((report) => ({
    id: report.runtime,
    label: report.displayName || runtimeDisplayName(report.runtime),
    value: report.runtime
  }));
}

function modelChoices(reports: RuntimeReport["models"], defaultModel?: string): CommunicationAgentManagementChoice[] {
  return [
    { id: "default", label: "Default (recommended)", value: "default" },
    ...(reports ?? []).map((model) => ({ id: model.id, label: model.label || model.id, value: model.id }))
  ].filter((choice, index, values) => values.findIndex((candidate) => candidate.value === choice.value) === index || choice.value === "default");
}

const UPDATE_FIELD_CHOICES: CommunicationAgentManagementChoice[] = [
  { id: "name", label: "Name", value: "name" },
  { id: "description", label: "Description", value: "description" },
  { id: "permissionMode", label: "Permission", value: "permissionMode" },
  { id: "model", label: "Model", value: "model" }
];

const PERMISSION_CHOICES: CommunicationAgentManagementChoice[] = [
  { id: "read-only", label: "Read-only access", value: "read-only" },
  { id: "workspace-write", label: "Balanced workspace access", value: "workspace-write" },
  { id: "dev-full-access", label: "Full development access", value: "dev-full-access" }
];

function chooseUpdateFieldText(candidate: AgentManagementAgentCandidate, invalid = false): string {
  return [
    ...(invalid ? ["I could not match that setting."] : []),
    `Choose what to update for ${candidate.agent.displayName}:`,
    ...UPDATE_FIELD_CHOICES.map((choice, index) => `${index + 1}. ${choice.label}`),
    "Reply with a number or exact setting name."
  ].join("\n");
}

function choosePermissionText(candidate: AgentManagementAgentCandidate, invalid = false): string {
  return [
    ...(invalid ? ["I could not match that permission."] : []),
    `Choose a permission for ${candidate.agent.displayName}:`,
    ...PERMISSION_CHOICES.map((choice, index) => `${index + 1}. ${choice.label}`),
    "Reply with a number or exact permission name."
  ].join("\n");
}

function updateRuntimeReport(ctx: ServerRouteContext, candidate: AgentManagementAgentCandidate): RuntimeReport | undefined {
  return candidate.machine && candidate.agent.runtime
    ? ctx.store.listRuntimeReports(candidate.machine.id)
      .find((item) => item.runtime === candidate.agent.runtime && item.status === "available")
    : undefined;
}

function chooseUpdateModelText(
  candidate: AgentManagementAgentCandidate,
  report: RuntimeReport | undefined,
  foreignRuntimeReference?: string,
  invalid = false
): string {
  const runtimeLabel = report?.displayName || (candidate.agent.runtime ? runtimeDisplayName(candidate.agent.runtime) : "current runtime");
  const choices = modelChoices(report?.models, report?.defaultModel);
  return [
    ...(foreignRuntimeReference
      ? [`${foreignRuntimeReference} models cannot be used by a ${runtimeLabel} Agent.`]
      : invalid
        ? ["I could not match that model."]
        : []),
    `Choose a ${runtimeLabel} model:`,
    ...choices.map((choice, index) => `${index + 1}. ${choice.label}${choice.value === "default" && report?.defaultModel ? ` — ${report.defaultModel}` : ""}`),
    "Reply with a number, exact model name, or default."
  ].join("\n");
}

function agentChoices(candidates: AgentManagementAgentCandidate[]): CommunicationAgentManagementChoice[] {
  return candidates.map(({ agent, machine }) => ({
    id: agent.id,
    label: `${agent.displayName} — ${machine?.name ?? "No device"}`,
    value: agent.id
  }));
}

function chooseComputerText(machines: MachineRecord[], invalid = false): string {
  return [
    ...(invalid ? ["I could not match that device."] : []),
    "Choose a device:",
    ...machines.map((machine, index) => `${index + 1}. ${machine.name} — ${titleStatus(machine.status as AgentRecord["status"])}`),
    "Reply with a number or exact device name."
  ].join("\n");
}

function chooseRuntimeText(machine: MachineRecord, reports: RuntimeReport[], invalid = false): string {
  return [
    ...(invalid ? ["I could not match that runtime."] : []),
    `Choose a runtime for ${machine.name}:`,
    ...reports.map((report, index) => `${index + 1}. ${report.displayName || runtimeDisplayName(report.runtime)}`),
    "Reply with a number or exact runtime name."
  ].join("\n");
}

function chooseModelText(reports: RuntimeReport["models"], defaultModel?: string, invalid = false): string {
  const choices = modelChoices(reports, defaultModel);
  return [
    ...(invalid ? ["I could not match that model."] : []),
    "Choose a model:",
    ...choices.map((choice, index) => `${index + 1}. ${choice.label}${choice.value === "default" && defaultModel ? ` — ${defaultModel}` : ""}`),
    "Reply with a number, exact model name, or default."
  ].join("\n");
}

function chooseAgentText(candidates: AgentManagementAgentCandidate[], invalid = false): string {
  return [
    ...(invalid ? ["I could not match that agent exactly."] : []),
    "Choose an agent:",
    ...candidates.map(({ agent, machine }, index) => `${index + 1}. ${agent.displayName} — ${machine?.name ?? "No device"} — ${titleStatus(agent.status)}`),
    "Reply with a number or exact agent and device label."
  ].join("\n");
}

function confirmationText(action: "stop" | "restart" | "reset" | "delete", candidate: AgentManagementAgentCandidate): string {
  return [
    `Confirm ${action}:`,
    `Agent: ${candidate.agent.displayName}`,
    `Device: ${candidate.machine?.name ?? "No device"}`,
    `Status: ${titleStatus(candidate.agent.status)}`,
    ...(action === "reset" ? ["This clears the saved runtime session and starts a fresh session."] : []),
    "Reply confirm to continue or cancel to stop."
  ].join("\n");
}

function computerRenameConfirmationText(machine: MachineRecord, name: string): string {
  return [
    "Confirm rename:",
    `Device: ${machine.name}`,
    `New name: ${name}`,
    "Reply confirm to continue or cancel to stop."
  ].join("\n");
}

const AGENT_CAPABILITY_LABELS: Record<(typeof AGENT_CAPABILITIES)[number], string> = {
  "inbox:receive": "Receive inbox messages",
  "server:read": "Read workspace information",
  "thread:unfollow": "Unfollow threads",
  "message:read": "Read messages",
  "message:send": "Send messages",
  "attachment:upload": "Upload attachments",
  "attachment:view": "View attachments",
  "task:read": "Read tasks",
  "task:write": "Create and update tasks",
  "action:prepare": "Prepare governed actions"
};

function formatAgentScopes(candidate: AgentManagementAgentCandidate, scopes: ReturnType<ServerRouteContext["store"]["getAgentScopes"]>): string {
  if (!scopes) return `${candidate.agent.displayName}'s capability scopes are unavailable.`;
  const visibleCapabilities = scopes.granted.filter((capability) => capability !== "task:read" && capability !== "task:write");
  return [
    `Capability scopes for ${candidate.agent.displayName}`,
    `Mode: ${scopes.mode}`,
    `Revision: ${scopes.revision}`,
    ...(visibleCapabilities.length
      ? visibleCapabilities.map((capability) => `- ${AGENT_CAPABILITY_LABELS[capability]} (${capability})`)
      : ["- No capabilities granted"])
  ].join("\n");
}

function batchConfirmationText(
  action: "batch_stop" | "batch_restart",
  machine: MachineRecord,
  agents: AgentRecord[]
): string {
  const label = action === "batch_stop" ? "stop" : "restart";
  return [
    `Confirm ${label}:`,
    `Device: ${machine.name}`,
    `Agents: ${agents.length} — ${agents.map((agent) => agent.displayName).join(", ")}`,
    "Reply confirm to continue or cancel to stop."
  ].join("\n");
}

const BATCH_ERROR_LABELS: Record<string, string> = {
  server_member_required: "workspace membership required",
  machine_not_found: "device not found",
  machine_offline: "device offline",
  no_executable_agents: "no executable agents",
  runtime_unavailable: "runtime unavailable",
  model_unavailable: "saved model unavailable",
  daemon_unavailable: "daemon unavailable",
  agent_owner_required: "permission denied",
  batch_target_unavailable: "target changed after confirmation"
};

function formatBatchResult(result: AgentBatchManagementResult): string {
  const machineName = result.machine?.name ?? "the selected device";
  const actionLabel = result.action === "start" ? "Start" : result.action === "stop" ? "Stop" : "Restart";
  if (result.results.length === 0 && result.errorCode) {
    const detail = BATCH_ERROR_LABELS[result.errorCode] ?? result.errorCode;
    return `${actionLabel} requests were not sent for ${machineName}: ${detail}.`;
  }
  const lines = result.results.map((item) => {
    if (item.status === "completed") {
      const detail = result.action === "start"
        ? "start requested"
        : result.action === "stop"
          ? "stop request sent"
          : "restart requests sent";
      return `- ${item.agentName}: ${detail}`;
    }
    if (item.status === "noop") {
      const detail = result.action === "start" ? "already running" : "already offline";
      return `- ${item.agentName}: ${detail}`;
    }
    if (item.status === "skipped") {
      return `- ${item.agentName}: skipped — ${BATCH_ERROR_LABELS[item.errorCode ?? ""] ?? "target unavailable"}`;
    }
    const detail = BATCH_ERROR_LABELS[item.errorCode ?? ""] ?? item.errorCode ?? "request failed";
    return `- ${item.agentName}: ${item.status} — ${detail}`;
  });
  return [
    `${actionLabel} requests processed for agents on ${machineName}.`,
    "",
    ...lines,
    "",
    `${result.completed} completed, ${result.noop} unchanged, ${result.partial} partial, ${result.denied} denied, ${result.failed} failed, ${result.skipped} skipped.`,
    ...(result.action === "start" ? ["Final Online status will update after the daemon reports back."] : [])
  ].join("\n");
}

function permissionLabel(value: string | undefined): string {
  if (value === "dev-full-access") return "Full development access";
  if (value === "read-only") return "Read-only access";
  return "Balanced workspace access";
}

function updateRequiresConfirmation(candidate: AgentManagementAgentCandidate, field: AgentEditableField, value: string | undefined): boolean {
  if (field === "permissionMode" && value === "dev-full-access") return true;
  return (field === "permissionMode" || field === "model")
    && (candidate.agent.status === "online" || candidate.agent.status === "working");
}

function updateConfirmationText(candidate: AgentManagementAgentCandidate, field: AgentEditableField, value: string | undefined): string {
  const change = field === "permissionMode"
    ? permissionLabel(value)
    : field === "model"
      ? `Model: ${value === "default" ? "Default" : value}`
      : `${field}: ${value ?? ""}`;
  const restartRequired = (field === "permissionMode" || field === "model")
    && (candidate.agent.status === "online" || candidate.agent.status === "working");
  return [
    "Confirm update:",
    `Agent: ${candidate.agent.displayName}`,
    change,
    restartRequired
      ? "The Agent will restart so the new runtime configuration becomes active."
      : "The new runtime configuration will be used the next time the Agent starts.",
    "Reply confirm to continue or cancel to stop."
  ].join("\n");
}

function updateValueDraftInput(
  ctx: ServerRouteContext,
  candidate: AgentManagementAgentCandidate,
  field: AgentEditableField,
  invalid = false,
  foreignRuntimeReference?: string
): { choices: CommunicationAgentManagementChoice[]; replyText: string } {
  if (field === "model") {
    const report = updateRuntimeReport(ctx, candidate);
    return {
      choices: modelChoices(report?.models, report?.defaultModel),
      replyText: chooseUpdateModelText(candidate, report, foreignRuntimeReference, invalid)
    };
  }
  if (field === "permissionMode") {
    return {
      choices: PERMISSION_CHOICES,
      replyText: choosePermissionText(candidate, invalid)
    };
  }
  const label = field === "name" ? "name" : field === "description" ? "description" : "permission mode";
  return {
    choices: [],
    replyText: [
      ...(invalid ? [`I could not use that ${label}.`] : []),
      `What should ${candidate.agent.displayName}'s ${label} be?`,
      ...(field === "description" ? ["Reply with description text or clear."] : [])
    ].join("\n")
  };
}

function exactMachine(machines: MachineRecord[], reference: string | undefined): MachineRecord | undefined {
  if (!reference) return undefined;
  const normalized = reference.toLowerCase();
  return machines.find((machine) =>
    machine.id.toLowerCase() === normalized || machine.name.toLowerCase() === normalized || machine.hostname.toLowerCase() === normalized
  );
}

function exactMachines(machines: MachineRecord[], reference: string | undefined): MachineRecord[] {
  if (!reference) return machines;
  const normalized = reference.toLowerCase();
  return machines.filter((machine) =>
    machine.id.toLowerCase() === normalized || machine.name.toLowerCase() === normalized || machine.hostname.toLowerCase() === normalized
  );
}

function exactRuntime(reports: RuntimeReport[], reference: string | undefined): RuntimeReport | undefined {
  if (!reference) return undefined;
  const normalized = reference.toLowerCase();
  return reports.find((report) =>
    report.runtime.toLowerCase() === normalized || (report.displayName || runtimeDisplayName(report.runtime)).toLowerCase() === normalized
  );
}

function exactModel(models: RuntimeReport["models"], reference: string | undefined): string | undefined {
  if (!reference) return undefined;
  if (reference.toLowerCase() === "default") return "default";
  const normalized = reference.toLowerCase();
  return models?.find((model) => model.id.toLowerCase() === normalized || model.label.toLowerCase() === normalized)?.id;
}

function exactAgents(candidates: AgentManagementAgentCandidate[], reference: string | undefined): AgentManagementAgentCandidate[] {
  if (!reference) return candidates;
  const normalized = reference.toLowerCase();
  return candidates.filter(({ agent }) =>
    agent.id.toLowerCase() === normalized || agent.name.toLowerCase() === normalized || agent.displayName.toLowerCase() === normalized
  );
}

function guardAgentContexts(ctx: ServerRouteContext, candidates: AgentManagementAgentCandidate[]): GuardAgentContext[] {
  return candidates.map(({ agent, machine }) => {
    const runtimes = machine
      ? ctx.store.listRuntimeReports(machine.id).filter((report) => report.status === "available")
      : [];
    const currentRuntime = runtimes.find((report) => report.runtime === agent.runtime);
    return {
      id: agent.id,
      name: agent.name,
      displayName: agent.displayName,
      runtime: agent.runtime,
      runtimeLabel: currentRuntime?.displayName || (agent.runtime ? runtimeDisplayName(agent.runtime) : "Unknown"),
      models: currentRuntime?.models ?? [],
      availableRuntimes: runtimes.map((report) => ({
        id: report.runtime,
        label: report.displayName || runtimeDisplayName(report.runtime)
      }))
    };
  });
}

function runtimeUpdateUnsupportedText(
  candidate: AgentManagementAgentCandidate,
  requestedRuntimeReference?: string
): string {
  const currentRuntime = candidate.agent.runtime ? runtimeDisplayName(candidate.agent.runtime) : "its current runtime";
  const requestedRuntime = requestedRuntimeReference ?? "the requested runtime";
  return [
    `${candidate.agent.displayName}'s runtime cannot be changed after creation. It currently uses ${currentRuntime}.`,
    `Create a new ${requestedRuntime} Agent instead.`
  ].join("\n");
}

function formatResult(result: AgentManagementResult, draft?: CommunicationAgentManagementDraftRecord): string {
  const name = result.agent?.displayName ?? "The agent";
  const machine = result.machine?.name ?? "the selected device";
  if (result.status === "denied" || result.status === "failed") {
    const errors: Record<string, string> = {
      server_member_required: "I can manage agents for workspace owners and members only.",
      agent_owner_required: "You do not have permission to manage that agent.",
      machine_owner_required: "You do not have permission to create agents on that device.",
      system_agent_protected: "Communication Agents are protected and cannot be managed here.",
      machine_offline: "That device is offline. No request was sent.",
      daemon_unavailable: "The device daemon is unavailable. No request was delivered.",
      runtime_unavailable: "That runtime is not available on the selected device.",
      model_unavailable: "That model is not available for the selected runtime.",
      model_not_available: "That model is not available for the selected runtime.",
      duplicate_agent_name: "An active agent already uses that exact name.",
      agent_name_conflict: "An active agent already uses that exact name.",
      invalid_agent_name: "The Agent name cannot be empty.",
      invalid_permission_mode: "That permission mode is not supported.",
      session_clear_failed: "The Agent stopped, but its saved runtime session could not be cleared.",
      agent_not_found: "I could not find that agent.",
      machine_not_found: "I could not find that device."
    };
    return errors[result.errorCode ?? ""] ?? "The agent request failed. Try again later.";
  }
  if (result.action === "create") {
    const runtime = result.agent?.runtime ? runtimeDisplayName(result.agent.runtime) : "default";
    const model = result.agent?.model ?? "default";
    return [
      result.status === "partial"
        ? result.startSent
          ? `${name} was created on ${machine}. The start request was sent, but workspace sync did not complete.`
          : `${name} was created on ${machine}, but the start request was not delivered.`
        : `${name} was created on ${machine}. The start request was sent.`,
      `Runtime: ${runtime}`,
      `Model: ${model}`
    ].join("\n");
  }
  if (result.action === "update") {
    const field = draft?.params.updateField;
    const value = draft?.params.updateValue;
    if (result.status === "noop") return `${name} already has that configuration.`;
    if (result.status === "partial") {
      return result.errorCode === "agent_restart_not_delivered"
        ? `${name}'s configuration was saved, but the Agent needs a manual restart.`
        : `${name}'s configuration was saved, but workspace refresh may be delayed.`;
    }
    if (field === "name") return `${name} was renamed. Existing chat history and tasks were kept.`;
    if (field === "description") return `${name}'s description was updated.`;
    if (field === "model") {
      const model = value === "default" ? "the runtime default model" : `model ${value}`;
      return result.restartRequired
        ? `${name} now uses ${model}. The Agent was restarted so the new model is active.`
        : `${name} now uses ${model}. The new model will be used the next time the Agent starts.`;
    }
    if (field === "permissionMode") {
      return result.restartRequired
        ? `${name} now has ${permissionLabel(value)}. The Agent was restarted so the new permission is active.`
        : `${name} now has ${permissionLabel(value)}. The new permission will be used the next time the Agent starts.`;
    }
    return `${name}'s configuration was updated.`;
  }
  if (result.action === "start") {
    return result.status === "noop" ? `${name} is already running.` : `${name} start request was sent.`;
  }
  if (result.action === "stop") {
    if (result.status === "noop") return `${name} is already offline.`;
    return result.status === "partial"
      ? `${name} is Offline in server state, but the stop request was not delivered.`
      : `${name} stop request was sent.`;
  }
  if (result.action === "restart") {
    return result.status === "partial"
      ? `${name} restart was only partially delivered.`
      : `${name} restart requests were sent.`;
  }
  if (result.action === "reset") {
    return result.status === "partial"
      ? `${name}'s saved runtime session was cleared, but the fresh start request was not delivered.`
      : `${name}'s saved runtime session was cleared and a fresh start request was sent.`;
  }
  return result.status === "partial"
    ? `${name} was deleted, but the stop request was not delivered.`
    : `${name} was deleted.`;
}

function resolveWithResult(
  ctx: ServerRouteContext,
  draft: CommunicationAgentManagementDraftRecord,
  result: AgentManagementResult
): CommunicationAgentActionReply {
  const content = formatResult(result, draft);
  const terminal = result.status === "failed" || result.status === "denied" ? "failed" : "completed";
  ctx.store.resolveCommunicationAgentManagementDraft(draft.id, terminal, {
    replyText: content,
    errorCode: result.errorCode ?? null
  });
  return { handled: true, content, draftId: draft.id };
}

function resolveDirectDraft(
  ctx: ServerRouteContext,
  draft: CommunicationAgentManagementDraftRecord,
  status: "completed" | "noop" | "denied" | "failed",
  content: string,
  errorCode?: string
): CommunicationAgentActionReply {
  const terminal = status === "denied" || status === "failed" ? "failed" : "completed";
  const resolved = ctx.store.resolveCommunicationAgentManagementDraft(draft.id, terminal, {
    replyText: content,
    errorCode: errorCode ?? null
  });
  if (resolved) lifecycleAudit(ctx, resolved, status);
  return { handled: true, content, draftId: draft.id };
}

function executeComputerRename(
  ctx: ServerRouteContext,
  input: HandleCommunicationAgentActionInput,
  draft: CommunicationAgentManagementDraftRecord
): CommunicationAgentActionReply {
  const machineId = draft.params.machineId;
  const name = draft.params.name?.trim();
  if (!machineId) return failDraft(ctx, draft, "The selected device is no longer available.", "machine_not_found");
  if (!name) return failDraft(ctx, draft, "The new device name is required.", "machine_name_required");
  if (name.length > 80) return failDraft(ctx, draft, "The device name must be 80 characters or fewer.", "machine_name_too_long");
  const machine = ctx.store.getMachine(machineId);
  if (!machine || machine.deletedAt || (machine.serverId ?? "local") !== input.serverId) {
    return failDraft(ctx, draft, "The selected device is no longer available.", "machine_not_found");
  }
  if (machine.ownerUserId !== input.userId) {
    return failDraft(ctx, draft, "You do not have permission to rename that device.", "machine_owner_required");
  }
  if (machine.name === name) {
    return resolveDirectDraft(ctx, draft, "noop", `${machine.name} already has that name.`);
  }
  const updated = ctx.store.updateMachineName(machine.id, name);
  if (!updated) return failDraft(ctx, draft, "The device could not be renamed.", "machine_rename_failed");
  ctx.emitRealtimeMachineUpdated(updated.id);
  return resolveDirectDraft(ctx, draft, "completed", `${machine.name} was renamed to ${updated.name}.`);
}

function executeAgentScopesRead(
  ctx: ServerRouteContext,
  input: HandleCommunicationAgentActionInput,
  draft: CommunicationAgentManagementDraftRecord
): CommunicationAgentActionReply {
  const agentId = draft.params.targetAgentId;
  const agent = agentId ? ctx.store.getAgent(agentId) : null;
  const machine = agent?.machineId ? ctx.store.getMachine(agent.machineId) : null;
  const agentServerId = agent?.serverId ?? machine?.serverId ?? "local";
  if (!agent || !machine || agent.deletedAt || machine.deletedAt || agentServerId !== input.serverId) {
    return failDraft(ctx, draft, "The selected agent is no longer available.", "agent_not_found");
  }
  if (!canManageAgentRuntime(input.userId, agent, machine)) {
    return failDraft(ctx, draft, "You do not have permission to read that Agent's capability scopes.", "agent_owner_required");
  }
  const scopes = ctx.store.getAgentScopes(agent.id);
  if (!scopes) return failDraft(ctx, draft, "The Agent capability scopes are unavailable.", "agent_scopes_unavailable");
  return resolveDirectDraft(ctx, draft, "completed", formatAgentScopes({ agent, machine }, scopes));
}

async function executeRuntimeModelDetection(
  ctx: ServerRouteContext,
  input: HandleCommunicationAgentActionInput,
  draft: CommunicationAgentManagementDraftRecord
): Promise<CommunicationAgentActionReply> {
  const machineId = draft.params.machineId;
  const runtime = draft.params.runtime;
  if (!machineId) return failDraft(ctx, draft, "The selected device is no longer available.", "machine_not_found");
  if (!runtime) return failDraft(ctx, draft, "The selected runtime is no longer available.", "runtime_unavailable");
  const machine = ctx.store.getMachine(machineId);
  if (!machine || machine.deletedAt || (machine.serverId ?? "local") !== input.serverId) {
    return failDraft(ctx, draft, "The selected device is no longer available.", "machine_not_found");
  }
  if (machine.ownerUserId !== input.userId) {
    return failDraft(ctx, draft, "You do not have permission to inspect runtimes on that device.", "machine_owner_required");
  }
  if (machine.status !== "online") {
    return failDraft(ctx, draft, "That device is offline. Model detection was not requested.", "machine_offline");
  }
  const report = ctx.store.listRuntimeReports(machine.id)
    .find((item) => item.runtime === runtime && item.status === "available");
  if (!report) return failDraft(ctx, draft, "That runtime is not available on the selected device.", "runtime_unavailable");

  const result = await requestRuntimeModelDetection({
    machineId: machine.id,
    runtime,
    pendingRequests: ctx.runtimeModelRequests,
    sendToDaemon: ctx.sendToDaemon
  });
  if (result.status === "failed") {
    const content = result.errorCode === "daemon_offline"
      ? "The device daemon is unavailable. Model detection was not delivered."
      : result.errorCode === "runtime_models_timeout"
        ? "Runtime model detection timed out. Try again later."
        : "The runtime did not return an available model list.";
    return resolveDirectDraft(ctx, draft, "failed", content, result.errorCode);
  }
  const runtimeLabel = report.displayName || runtimeDisplayName(runtime);
  const models = result.models.map((model) => `- ${model.label || model.id}${model.label && model.label !== model.id ? ` (${model.id})` : ""}`);
  return resolveDirectDraft(ctx, draft, "completed", [
    `${runtimeLabel} models detected on ${machine.name}:`,
    ...models,
    `Default: ${result.defaultModel ?? "runtime default"}`
  ].join("\n"));
}

function executeCreate(
  ctx: ServerRouteContext,
  service: ManagementService,
  input: HandleCommunicationAgentActionInput,
  draft: CommunicationAgentManagementDraftRecord,
  params: CommunicationAgentManagementParams
): CommunicationAgentActionReply {
  if (!params.name || !params.machineId || !params.runtime) {
    return { handled: true, content: "The create request is missing required details.", draftId: draft.id };
  }
  const result = service.createAgent({
    operationId: draft.operationId,
    actorUserId: input.userId,
    serverId: input.serverId,
    source: {
      kind: "tyr_assistant",
      source: input.sourceContext.source,
      sourceMessageId: draft.sourceMessageId,
      assistantAgentId: input.assistant.id,
      confirmation: { required: false }
    },
    machineId: params.machineId,
    name: params.name,
    runtime: params.runtime,
    ...(params.model ? { model: params.model } : {}),
    ...(params.permissionMode ? { permissionMode: params.permissionMode } : {})
  });
  return resolveWithResult(ctx, draft, result);
}

function executeUpdate(
  ctx: ServerRouteContext,
  service: ManagementService,
  input: HandleCommunicationAgentActionInput,
  draft: CommunicationAgentManagementDraftRecord,
  confirmedAt?: string
): CommunicationAgentActionReply {
  const { targetAgentId, updateField, updateValue } = draft.params;
  if (!targetAgentId || !updateField || updateValue === undefined) {
    return failDraft(ctx, draft, "The update request is missing required details.", "agent_update_empty");
  }
  const shared = {
    operationId: draft.operationId,
    actorUserId: input.userId,
    serverId: input.serverId,
    agentId: targetAgentId,
    source: {
      kind: "tyr_assistant" as const,
      source: input.sourceContext.source,
      sourceMessageId: draft.sourceMessageId,
      assistantAgentId: input.assistant.id,
      confirmation: {
        required: draft.stage === "awaiting_confirmation",
        ...(confirmedAt ? { confirmedAt } : {})
      }
    }
  };
  const result = service.updateAgent({
    ...shared,
    ...(updateField === "name" ? { name: updateValue } : {}),
    ...(updateField === "description" ? { description: updateValue } : {}),
    ...(updateField === "model" ? { model: updateValue } : {}),
    ...(updateField === "permissionMode" ? { permissionMode: updateValue as RuntimePermissionMode } : {})
  });
  return resolveWithResult(ctx, draft, result);
}

function executeTarget(
  ctx: ServerRouteContext,
  service: ManagementService,
  input: HandleCommunicationAgentActionInput,
  draft: CommunicationAgentManagementDraftRecord,
  confirmedAt?: string
): CommunicationAgentActionReply {
  const agentId = draft.params.targetAgentId;
  if (!agentId) return { handled: true, content: "The target agent is no longer available.", draftId: draft.id };
  const request = {
    operationId: draft.operationId,
    actorUserId: input.userId,
    serverId: input.serverId,
    agentId,
    source: {
      kind: "tyr_assistant" as const,
      source: input.sourceContext.source,
      sourceMessageId: draft.sourceMessageId,
      assistantAgentId: input.assistant.id,
      confirmation: {
        required: draft.action !== "start",
        ...(confirmedAt ? { confirmedAt } : {})
      }
    }
  };
  if (draft.action === "update") return executeUpdate(ctx, service, input, draft, confirmedAt);
  const result = draft.action === "start"
    ? service.startAgent(request)
    : draft.action === "stop"
      ? service.stopAgent(request)
      : draft.action === "restart"
        ? service.restartAgent(request)
        : draft.action === "reset"
          ? service.resetAgent(request)
          : draft.action === "delete"
            ? service.deleteAgent(request)
            : null;
  if (!result) return failDraft(ctx, draft, "The Agent request is no longer valid.", "invalid_draft_stage");
  return resolveWithResult(ctx, draft, result);
}

function executeBatch(
  ctx: ServerRouteContext,
  service: ManagementService,
  input: HandleCommunicationAgentActionInput,
  draft: CommunicationAgentManagementDraftRecord,
  confirmedAt?: string
): CommunicationAgentActionReply {
  const machineId = draft.params.machineId;
  if (!machineId) return failDraft(ctx, draft, "The selected device is no longer available.", "machine_not_found");
  if (draft.action !== "batch_start" && draft.action !== "batch_stop" && draft.action !== "batch_restart") {
    return failDraft(ctx, draft, "The device batch request is no longer valid.", "invalid_draft_stage");
  }
  const result = service.batchByMachine({
    operationId: draft.operationId,
    actorUserId: input.userId,
    serverId: input.serverId,
    source: {
      kind: "tyr_assistant",
      source: input.sourceContext.source,
      sourceMessageId: draft.sourceMessageId,
      assistantAgentId: input.assistant.id,
      confirmation: {
        required: draft.action !== "batch_start",
        ...(confirmedAt ? { confirmedAt } : {})
      }
    },
    machineId,
    targetAgentIds: draft.params.targetAgentIds,
    action: draft.action === "batch_start" ? "start" : draft.action === "batch_stop" ? "stop" : "restart"
  });
  const content = formatBatchResult(result);
  const terminal = result.status === "failed" || result.status === "denied" ? "failed" : "completed";
  const resolved = ctx.store.resolveCommunicationAgentManagementDraft(draft.id, terminal, {
    replyText: content,
    errorCode: result.errorCode ?? null
  });
  if (resolved) lifecycleAudit(ctx, resolved, result.status, result);
  return { handled: true, content, draftId: draft.id };
}

function failDraft(ctx: ServerRouteContext, draft: CommunicationAgentManagementDraftRecord, content: string, errorCode: string): CommunicationAgentActionReply {
  const resolved = ctx.store.resolveCommunicationAgentManagementDraft(draft.id, "failed", { replyText: content, errorCode });
  if (resolved) lifecycleAudit(ctx, resolved, "failed");
  return { handled: true, content, draftId: draft.id };
}

function rejectNewMutation(
  ctx: ServerRouteContext,
  input: HandleCommunicationAgentActionInput,
  action: CommunicationAgentManagementAction,
  content: string,
  status: "denied" | "failed",
  errorCode: string
): CommunicationAgentActionReply {
  const created = beginDraft(ctx, input, action, action === "create" ? "collecting_name" : "collecting_agent", {}, [], content);
  if (!created.created) return replayReply(created.draft);
  const resolved = ctx.store.resolveCommunicationAgentManagementDraft(created.draft.id, "failed", { replyText: content, errorCode });
  if (resolved) lifecycleAudit(ctx, resolved, status);
  return { handled: true, content, draftId: created.draft.id };
}

function progressCreate(
  ctx: ServerRouteContext,
  service: ManagementService,
  input: HandleCommunicationAgentActionInput,
  draft: CommunicationAgentManagementDraftRecord,
  startingParams = draft.params
): CommunicationAgentActionReply {
  let params = { ...startingParams };
  if (!params.name) {
    return updateDraft(ctx, draft, {
      stage: "collecting_name",
      params,
      choices: [],
      replyText: "What should the agent be named?"
    });
  }

  let options = service.listCreationOptions({ actorUserId: input.userId, serverId: input.serverId });
  if (!params.machineId) {
    if (options.machines.length === 0) return failDraft(ctx, draft, "No online device is available for agent creation.", "machine_unavailable");
    if (params.machineReference) {
      const explicitMachine = exactMachine(options.machines, params.machineReference);
      if (!explicitMachine) {
        return updateDraft(ctx, draft, {
          stage: "collecting_machine",
          params,
          choices: computerChoices(options.machines),
          replyText: chooseComputerText(options.machines, true)
        });
      }
      params.machineId = explicitMachine.id;
    } else if (options.machines.length > 1) {
      return updateDraft(ctx, draft, {
        stage: "collecting_machine",
        params,
        choices: computerChoices(options.machines),
        replyText: chooseComputerText(options.machines)
      });
    } else {
      params.machineId = options.machines[0]!.id;
    }
  }

  const machine = options.machines.find((candidate) => candidate.id === params.machineId);
  if (!machine) return failDraft(ctx, draft, "The selected device is no longer available.", "machine_offline");
  options = service.listCreationOptions({ actorUserId: input.userId, serverId: input.serverId, machineId: machine.id });
  if (!params.runtime) {
    if (options.runtimes.length === 0) return failDraft(ctx, draft, "No runtime is available on the selected device.", "runtime_unavailable");
    if (params.runtimeReference) {
      const explicitRuntime = exactRuntime(options.runtimes, params.runtimeReference);
      if (!explicitRuntime) {
        return updateDraft(ctx, draft, {
          stage: "collecting_runtime",
          params,
          choices: runtimeChoices(options.runtimes),
          replyText: chooseRuntimeText(machine, options.runtimes, true)
        });
      }
      params.runtime = explicitRuntime.runtime;
    } else if (options.runtimes.length > 1) {
      return updateDraft(ctx, draft, {
        stage: "collecting_runtime",
        params,
        choices: runtimeChoices(options.runtimes),
        replyText: chooseRuntimeText(machine, options.runtimes)
      });
    } else {
      params.runtime = options.runtimes[0]!.runtime;
    }
  }

  const runtime = options.runtimes.find((candidate) => candidate.runtime === params.runtime);
  if (!runtime) return failDraft(ctx, draft, "The selected runtime is no longer available.", "runtime_unavailable");
  options = service.listCreationOptions({
    actorUserId: input.userId,
    serverId: input.serverId,
    machineId: machine.id,
    runtime: params.runtime
  });
  if (!params.model && params.modelReference) {
    const explicitModel = exactModel(options.models, params.modelReference);
    if (!explicitModel) {
      return updateDraft(ctx, draft, {
        stage: "collecting_model",
        params,
        choices: modelChoices(options.models, options.defaultModel),
        replyText: chooseModelText(options.models, options.defaultModel, true)
      });
    }
    params.model = explicitModel;
  } else if (!params.model && options.models.length > 1) {
    return updateDraft(ctx, draft, {
      stage: "collecting_model",
      params,
      choices: modelChoices(options.models, options.defaultModel),
      replyText: chooseModelText(options.models, options.defaultModel)
    });
  }
  if (!params.model && options.models.length === 1) params.model = options.defaultModel ?? options.models[0]!.id;
  ctx.store.updateCommunicationAgentManagementDraft(draft.id, { params, choices: [] });
  return executeCreate(ctx, service, input, { ...draft, params }, params);
}

function progressBatchDraft(
  ctx: ServerRouteContext,
  service: ManagementService,
  input: HandleCommunicationAgentActionInput,
  draft: CommunicationAgentManagementDraftRecord,
  startingParams = draft.params
): CommunicationAgentActionReply {
  const params = { ...startingParams };
  const machines = service.listManageableMachines({ actorUserId: input.userId, serverId: input.serverId });
  let machine = params.machineId ? machines.find((candidate) => candidate.id === params.machineId) : undefined;
  if (params.machineId && !machine) {
    return failDraft(ctx, draft, "The selected device is no longer available.", "machine_not_found");
  }
  if (!machine && params.machineReference) {
    machine = exactMachine(machines, params.machineReference);
    if (!machine) {
      return updateDraft(ctx, draft, {
        stage: "collecting_machine",
        params,
        choices: computerChoices(machines),
        replyText: chooseComputerText(machines, true)
      });
    }
  }
  if (!machine && machines.length === 1) machine = machines[0]!;
  if (!machine && machines.length === 0) {
    return failDraft(
      ctx,
      draft,
      "No manageable devices are available. Try list devices or connect a device.",
      "machine_not_found"
    );
  }
  if (!machine) {
    return updateDraft(ctx, draft, {
      stage: "collecting_machine",
      params,
      choices: computerChoices(machines),
      replyText: chooseComputerText(machines)
    });
  }

  // 确认文案与执行共享稳定 ID 快照；确认后新增 Agent 不得自动加入旧批次。
  const targetAgents = ctx.store.listAgents(input.serverId)
    .filter((agent) => (
      agent.machineId === machine.id &&
      !agent.deletedAt &&
      !isCommunicationAgent(agent) &&
      Boolean(agent.runtime)
    ));
  const completeParams: CommunicationAgentManagementParams = {
    ...params,
    machineId: machine.id,
    machineName: machine.name,
    targetAgentIds: targetAgents.map((agent) => agent.id)
  };
  const nextDraft = ctx.store.updateCommunicationAgentManagementDraft(draft.id, {
    params: completeParams,
    choices: []
  }) ?? { ...draft, params: completeParams, choices: [] };

  if (draft.action === "batch_start" || machine.status !== "online" || targetAgents.length === 0) {
    return executeBatch(ctx, service, input, nextDraft);
  }
  if (draft.action !== "batch_stop" && draft.action !== "batch_restart") {
    return failDraft(ctx, nextDraft, "The device batch request is no longer valid.", "invalid_draft_stage");
  }
  const content = batchConfirmationText(draft.action, machine, targetAgents);
  return updateDraft(ctx, nextDraft, {
    stage: "awaiting_confirmation",
    params: completeParams,
    choices: [],
    replyText: content
  });
}

function progressComputerRename(
  ctx: ServerRouteContext,
  input: HandleCommunicationAgentActionInput,
  draft: CommunicationAgentManagementDraftRecord,
  startingParams = draft.params
): CommunicationAgentActionReply {
  const params = { ...startingParams };
  const machines = ownedMachines(ctx, input);
  let machine = params.machineId ? machines.find((candidate) => candidate.id === params.machineId) : undefined;
  if (params.machineId && !machine) {
    return failDraft(ctx, draft, "The selected device is no longer available.", "machine_not_found");
  }
  if (!machine && params.machineReference) {
    const matches = exactMachines(machines, params.machineReference);
    if (matches.length === 1) machine = matches[0]!;
    else {
      const visibleMatches = exactMachines(ctx.store.listMachines(input.serverId), params.machineReference);
      if (matches.length === 0 && visibleMatches.length > 0) {
        return resolveDirectDraft(ctx, draft, "denied", "You do not have permission to rename that device.", "machine_owner_required");
      }
      return updateDraft(ctx, draft, {
        stage: "collecting_machine",
        params,
        choices: computerChoices(matches.length > 1 ? matches : machines),
        replyText: chooseComputerText(matches.length > 1 ? matches : machines, matches.length === 0)
      });
    }
  }
  if (!machine && machines.length === 1) {
    machine = machines[0]!;
    params.targetSelectedFromChoice = true;
  }
  if (!machine && machines.length === 0) {
    return failDraft(ctx, draft, "No owned devices are available.", "machine_not_found");
  }
  if (!machine) {
    return updateDraft(ctx, draft, {
      stage: "collecting_machine",
      params,
      choices: computerChoices(machines),
      replyText: chooseComputerText(machines)
    });
  }

  params.machineId = machine.id;
  params.machineName = machine.name;
  if (!params.name?.trim()) {
    return updateDraft(ctx, draft, {
      stage: "collecting_computer_name",
      params,
      choices: [],
      replyText: `What should ${machine.name} be renamed to?`
    });
  }
  const nextDraft = ctx.store.updateCommunicationAgentManagementDraft(draft.id, { params, choices: [] })
    ?? { ...draft, params, choices: [] };
  if (params.targetSelectedFromChoice) {
    return updateDraft(ctx, nextDraft, {
      stage: "awaiting_confirmation",
      params,
      choices: [],
      replyText: computerRenameConfirmationText(machine, params.name)
    });
  }
  return executeComputerRename(ctx, input, nextDraft);
}

async function progressRuntimeModelDetection(
  ctx: ServerRouteContext,
  input: HandleCommunicationAgentActionInput,
  draft: CommunicationAgentManagementDraftRecord,
  startingParams = draft.params
): Promise<CommunicationAgentActionReply> {
  const params = { ...startingParams };
  const machines = ownedMachines(ctx, input);
  let machine = params.machineId ? machines.find((candidate) => candidate.id === params.machineId) : undefined;
  if (params.machineId && !machine) {
    return failDraft(ctx, draft, "The selected device is no longer available.", "machine_not_found");
  }
  if (!machine && params.machineReference) {
    const matches = exactMachines(machines, params.machineReference);
    if (matches.length === 1) machine = matches[0]!;
    else {
      const visibleMatches = exactMachines(ctx.store.listMachines(input.serverId), params.machineReference);
      if (matches.length === 0 && visibleMatches.length > 0) {
        return resolveDirectDraft(ctx, draft, "denied", "You do not have permission to inspect runtimes on that device.", "machine_owner_required");
      }
      return updateDraft(ctx, draft, {
        stage: "collecting_machine",
        params,
        choices: computerChoices(matches.length > 1 ? matches : machines),
        replyText: chooseComputerText(matches.length > 1 ? matches : machines, matches.length === 0)
      });
    }
  }
  if (!machine && machines.length === 1) machine = machines[0]!;
  if (!machine && machines.length === 0) {
    return failDraft(ctx, draft, "No owned devices are available.", "machine_not_found");
  }
  if (!machine) {
    return updateDraft(ctx, draft, {
      stage: "collecting_machine",
      params,
      choices: computerChoices(machines),
      replyText: chooseComputerText(machines)
    });
  }

  params.machineId = machine.id;
  params.machineName = machine.name;
  const reports = ctx.store.listRuntimeReports(machine.id).filter((report) => report.status === "available");
  let runtime = params.runtime ? reports.find((report) => report.runtime === params.runtime) : undefined;
  if (!runtime && params.runtimeReference) {
    runtime = exactRuntime(reports, params.runtimeReference);
    if (!runtime) {
      return updateDraft(ctx, draft, {
        stage: "collecting_runtime",
        params,
        choices: runtimeChoices(reports),
        replyText: chooseRuntimeText(machine, reports, true)
      });
    }
  }
  if (!runtime && reports.length === 1) runtime = reports[0]!;
  if (!runtime && reports.length === 0) {
    return failDraft(ctx, draft, "No runtime is available on the selected device.", "runtime_unavailable");
  }
  if (!runtime) {
    return updateDraft(ctx, draft, {
      stage: "collecting_runtime",
      params,
      choices: runtimeChoices(reports),
      replyText: chooseRuntimeText(machine, reports)
    });
  }
  params.runtime = runtime.runtime;
  const nextDraft = ctx.store.updateCommunicationAgentManagementDraft(draft.id, { params, choices: [] })
    ?? { ...draft, params, choices: [] };
  return executeRuntimeModelDetection(ctx, input, nextDraft);
}

function lacksAgentMutationRole(ctx: ServerRouteContext, input: HandleCommunicationAgentActionInput): boolean {
  const role = ctx.store.listServersForUser(input.userId).find((server) => server.id === input.serverId)?.role;
  // Guest 与非成员都不能通过 TYR 探测或变更管理目标。
  return role !== "owner" && role !== "member";
}

function startTargetDraft(
  ctx: ServerRouteContext,
  service: ManagementService,
  input: HandleCommunicationAgentActionInput,
  action: "start" | "stop" | "restart" | "reset" | "delete" | "scopes_read",
  candidates: AgentManagementAgentCandidate[]
): CommunicationAgentActionReply {
  if (candidates.length !== 1) {
    const content = chooseAgentText(candidates);
    const created = beginDraft(ctx, input, action, "collecting_agent", {}, agentChoices(candidates), content);
    return created.created ? { handled: true, content, draftId: created.draft.id } : replayReply(created.draft);
  }
  const candidate = candidates[0]!;
  const destructive = action === "stop" || action === "restart" || action === "reset" || action === "delete";
  const content = destructive
    ? confirmationText(action, candidate)
    : action === "start"
      ? "Starting the selected agent."
      : "Reading the selected Agent's capability scopes.";
  const created = beginDraft(
    ctx,
    input,
    action,
    destructive ? "awaiting_confirmation" : "collecting_agent",
    { targetAgentId: candidate.agent.id },
    [],
    content
  );
  if (!created.created) return replayReply(created.draft);
  return destructive
    ? { handled: true, content, draftId: created.draft.id }
    : action === "scopes_read"
      ? executeAgentScopesRead(ctx, input, created.draft)
      : executeTarget(ctx, service, input, created.draft);
}

function continueUpdateDraft(
  ctx: ServerRouteContext,
  service: ManagementService,
  input: HandleCommunicationAgentActionInput,
  draft: CommunicationAgentManagementDraftRecord,
  candidate: AgentManagementAgentCandidate,
  params: CommunicationAgentManagementParams
): CommunicationAgentActionReply {
  let field = params.updateField;
  if (!field) {
    return updateDraft(ctx, draft, {
      stage: "collecting_update_field",
      params,
      choices: UPDATE_FIELD_CHOICES,
      replyText: chooseUpdateFieldText(candidate)
    });
  }
  if (params.updateValue === undefined) {
    const valueDraft = updateValueDraftInput(ctx, candidate, field, false, params.foreignRuntimeReference);
    return updateDraft(ctx, draft, {
      stage: "collecting_update_value",
      params,
      choices: valueDraft.choices,
      replyText: valueDraft.replyText
    });
  }

  if (field === "model") {
    const report = updateRuntimeReport(ctx, candidate);
    const model = exactModel(report?.models, params.updateValue);
    if (!model) {
      const { updateValue: _invalidValue, ...pendingParams } = params;
      const valueDraft = updateValueDraftInput(ctx, candidate, field, true, params.foreignRuntimeReference);
      return updateDraft(ctx, draft, {
        stage: "collecting_update_value",
        params: pendingParams,
        choices: valueDraft.choices,
        replyText: valueDraft.replyText
      });
    }
    params = { ...params, updateValue: model };
  }

  if (field === "permissionMode" && !PERMISSION_CHOICES.some((choice) => choice.value === params.updateValue)) {
    const { updateValue: _invalidValue, ...pendingParams } = params;
    const valueDraft = updateValueDraftInput(ctx, candidate, field, true);
    return updateDraft(ctx, draft, {
      stage: "collecting_update_value",
      params: pendingParams,
      choices: valueDraft.choices,
      replyText: valueDraft.replyText
    });
  }

  const confirmationRequired = updateRequiresConfirmation(candidate, field, params.updateValue);
  if (confirmationRequired) {
    return updateDraft(ctx, draft, {
      stage: "awaiting_confirmation",
      params,
      choices: [],
      replyText: updateConfirmationText(candidate, field, params.updateValue)
    });
  }
  ctx.store.updateCommunicationAgentManagementDraft(draft.id, { params, choices: [] });
  return executeUpdate(ctx, service, input, { ...draft, params });
}

function startUpdateDraft(
  ctx: ServerRouteContext,
  service: ManagementService,
  input: HandleCommunicationAgentActionInput,
  intent: Extract<CommunicationAgentActionIntent, { action: "update" }>,
  candidates: AgentManagementAgentCandidate[]
): CommunicationAgentActionReply {
  const params: CommunicationAgentManagementParams = {
    ...(intent.field ? { updateField: intent.field } : {}),
    ...(intent.value === undefined ? {} : { updateValue: intent.value }),
    ...(intent.foreignRuntimeReference ? { foreignRuntimeReference: intent.foreignRuntimeReference } : {})
  };
  if (candidates.length !== 1) {
    const content = chooseAgentText(candidates);
    const created = beginDraft(ctx, input, "update", "collecting_agent", params, agentChoices(candidates), content);
    return created.created ? { handled: true, content, draftId: created.draft.id } : replayReply(created.draft);
  }
  const candidate = candidates[0]!;
  const completeParams = { ...params, targetAgentId: candidate.agent.id };
  const content = "Updating the selected Agent.";
  const created = beginDraft(
    ctx,
    input,
    "update",
    "collecting_agent",
    completeParams,
    [],
    content
  );
  if (!created.created) return replayReply(created.draft);
  return continueUpdateDraft(ctx, service, input, created.draft, candidate, completeParams);
}

async function activeDraftReply(
  ctx: ServerRouteContext,
  service: ManagementService,
  input: HandleCommunicationAgentActionInput,
  draft: CommunicationAgentManagementDraftRecord
): Promise<CommunicationAgentActionReply> {
  const normalized = input.content.trim().toLowerCase();
  const attached = ctx.store.attachCommunicationAgentManagementDraftSourceEvent(draft.id, {
    ...scope(input),
    sourceEventKey: input.sourceContext.sourceEventKey
  });
  if (!attached) {
    // 并发请求若已把同一来源事件绑定到其他 draft，当前草稿不能继续消费该消息。
    const existing = ctx.store.getCommunicationAgentManagementDraftBySourceEvent({
      ...scope(input),
      sourceEventKey: input.sourceContext.sourceEventKey
    });
    return existing
      ? replayReply(existing)
      : { handled: true, content: "This message event could not be applied to the pending agent request.", draftId: draft.id };
  }
  if (/^\/?cancel$/.test(normalized)) {
    const content = draft.action === "create"
      ? "Cancelled agent creation."
      : `Cancelled the pending ${draft.action} request.`;
    const resolved = ctx.store.resolveCommunicationAgentManagementDraft(draft.id, "cancelled", { replyText: content });
    if (resolved) lifecycleAudit(ctx, resolved, "cancelled");
    return { handled: true, content: resolved?.replyText ?? draft.replyText ?? content, draftId: draft.id };
  }
  // Cancel 始终可关闭旧草稿；除此之外，历史草稿必须按当前 Registry 重新授权后才能继续。
  if (communicationAgentManagementActionAvailabilityError(draft.action)) {
    return failDraft(
      ctx,
      draft,
      "This operation is no longer available. Start a new request.",
      "operation_no_longer_available"
    );
  }
  if (/^\/?confirm$/.test(normalized)) {
    if (draft.stage !== "awaiting_confirmation") {
      return { handled: true, content: draft.replyText ?? "This request still needs a selection.", draftId: draft.id };
    }
    const claimed = ctx.store.claimCommunicationAgentManagementDraft(draft.id);
    if (!claimed) return replayReply(ctx.store.getCommunicationAgentManagementDraft(draft.id) ?? draft);
    lifecycleAudit(ctx, claimed, "confirmed");
    if (claimed.action === "batch_start" || claimed.action === "batch_stop" || claimed.action === "batch_restart") {
      return executeBatch(ctx, service, input, claimed, claimed.confirmedAt ?? undefined);
    }
    if (claimed.action === "computer_rename") return executeComputerRename(ctx, input, claimed);
    return executeTarget(ctx, service, input, claimed, claimed.confirmedAt ?? undefined);
  }
  if (draft.stage === "awaiting_confirmation") {
    return { handled: true, content: draft.replyText ?? `Reply confirm to continue or cancel to stop.`, draftId: draft.id };
  }

  if (draft.stage === "collecting_name") {
    const name = cleanExplicitValue(input.content);
    if (!name) return { handled: true, content: draft.replyText ?? "What should the agent be named?", draftId: draft.id };
    return progressCreate(ctx, service, input, draft, { ...draft.params, name });
  }

  if (draft.stage === "collecting_computer_name" && draft.action === "computer_rename") {
    const name = cleanExplicitValue(input.content);
    if (!name) return { handled: true, content: draft.replyText ?? "What should the device be renamed to?", draftId: draft.id };
    return progressComputerRename(ctx, input, draft, { ...draft.params, name });
  }

  if (draft.stage === "collecting_update_field" && draft.action === "update") {
    const candidates = service.listAgentCandidates({ actorUserId: input.userId, serverId: input.serverId });
    const candidate = candidates.find((item) => item.agent.id === draft.params.targetAgentId);
    if (!candidate) return failDraft(ctx, draft, "The selected agent is no longer available.", "agent_not_found");
    const selectedField = choiceForInput(input.content, UPDATE_FIELD_CHOICES);
    if (!selectedField) {
      return updateDraft(ctx, draft, {
        choices: UPDATE_FIELD_CHOICES,
        replyText: chooseUpdateFieldText(candidate, true)
      });
    }
    return continueUpdateDraft(ctx, service, input, draft, candidate, {
      ...draft.params,
      updateField: selectedField.value as AgentEditableField
    });
  }

  if (draft.stage === "collecting_update_value" && draft.action === "update") {
    const field = draft.params.updateField;
    const candidates = service.listAgentCandidates({ actorUserId: input.userId, serverId: input.serverId });
    const candidate = candidates.find((item) => item.agent.id === draft.params.targetAgentId);
    if (!field || !candidate) return failDraft(ctx, draft, "The selected agent is no longer available.", "agent_not_found");
    let value: string | undefined;
    if (field === "model" || field === "permissionMode") {
      value = choiceForInput(input.content, draft.choices)?.value;
    } else if (field === "description" && /^clear$/i.test(input.content.trim())) {
      value = "";
    } else {
      value = cleanExplicitValue(input.content);
    }
    if (value === undefined) {
      const valueDraft = updateValueDraftInput(ctx, candidate, field, true, draft.params.foreignRuntimeReference);
      return updateDraft(ctx, draft, {
        choices: valueDraft.choices,
        replyText: valueDraft.replyText
      });
    }
    return continueUpdateDraft(ctx, service, input, draft, candidate, { ...draft.params, updateValue: value });
  }

  const selected = choiceForInput(input.content, draft.choices);
  if (!selected) {
    if (draft.stage === "collecting_machine") {
      if (draft.action === "batch_start" || draft.action === "batch_stop" || draft.action === "batch_restart") {
        const machines = service.listManageableMachines({ actorUserId: input.userId, serverId: input.serverId });
        return updateDraft(ctx, draft, {
          choices: computerChoices(machines),
          replyText: chooseComputerText(machines, true)
        });
      }
      if (draft.action === "computer_rename" || draft.action === "runtime_models_detect") {
        const machines = ownedMachines(ctx, input);
        return updateDraft(ctx, draft, {
          choices: computerChoices(machines),
          replyText: chooseComputerText(machines, true)
        });
      }
      const options = service.listCreationOptions({ actorUserId: input.userId, serverId: input.serverId });
      return updateDraft(ctx, draft, {
        choices: computerChoices(options.machines),
        replyText: chooseComputerText(options.machines, true)
      });
    }
    if (draft.stage === "collecting_runtime" && draft.params.machineId) {
      if (draft.action === "runtime_models_detect") {
        const machine = ownedMachines(ctx, input).find((candidate) => candidate.id === draft.params.machineId);
        const reports = machine
          ? ctx.store.listRuntimeReports(machine.id).filter((report) => report.status === "available")
          : [];
        if (machine) return updateDraft(ctx, draft, { choices: runtimeChoices(reports), replyText: chooseRuntimeText(machine, reports, true) });
      }
      const options = service.listCreationOptions({ actorUserId: input.userId, serverId: input.serverId, machineId: draft.params.machineId });
      const machine = options.machines.find((candidate) => candidate.id === draft.params.machineId);
      if (machine) return updateDraft(ctx, draft, { choices: runtimeChoices(options.runtimes), replyText: chooseRuntimeText(machine, options.runtimes, true) });
    }
    if (draft.stage === "collecting_model" && draft.params.machineId && draft.params.runtime) {
      const options = service.listCreationOptions({ actorUserId: input.userId, serverId: input.serverId, machineId: draft.params.machineId, runtime: draft.params.runtime });
      return updateDraft(ctx, draft, { choices: modelChoices(options.models, options.defaultModel), replyText: chooseModelText(options.models, options.defaultModel, true) });
    }
    const candidates = draft.action === "reset" || draft.action === "scopes_read"
      ? ownedAgentCandidates(service, input)
      : service.listAgentCandidates({ actorUserId: input.userId, serverId: input.serverId });
    return updateDraft(ctx, draft, { choices: agentChoices(candidates), replyText: chooseAgentText(candidates, true) });
  }

  if (draft.stage === "collecting_machine") {
    if (draft.action === "batch_start" || draft.action === "batch_stop" || draft.action === "batch_restart") {
      const machines = service.listManageableMachines({ actorUserId: input.userId, serverId: input.serverId });
      const machine = machines.find((candidate) => candidate.id === selected.id);
      if (!machine) return progressBatchDraft(ctx, service, input, draft);
      return progressBatchDraft(ctx, service, input, draft, {
        ...draft.params,
        machineId: machine.id,
        machineName: machine.name
      });
    }
    if (draft.action === "computer_rename" || draft.action === "runtime_models_detect") {
      const machine = ownedMachines(ctx, input).find((candidate) => candidate.id === selected.id);
      if (!machine) {
        return draft.action === "computer_rename"
          ? progressComputerRename(ctx, input, draft)
          : progressRuntimeModelDetection(ctx, input, draft);
      }
      const params = {
        ...draft.params,
        machineId: machine.id,
        machineName: machine.name,
        targetSelectedFromChoice: true
      };
      return draft.action === "computer_rename"
        ? progressComputerRename(ctx, input, draft, params)
        : progressRuntimeModelDetection(ctx, input, draft, params);
    }
    const options = service.listCreationOptions({ actorUserId: input.userId, serverId: input.serverId });
    if (!options.machines.some((machine) => machine.id === selected.id)) return progressCreate(ctx, service, input, draft);
    return progressCreate(ctx, service, input, draft, { ...draft.params, machineId: selected.id });
  }
  if (draft.stage === "collecting_runtime") {
    if (draft.action === "runtime_models_detect") {
      return progressRuntimeModelDetection(ctx, input, draft, { ...draft.params, runtime: selected.value as RuntimeId });
    }
    return progressCreate(ctx, service, input, draft, { ...draft.params, runtime: selected.value as RuntimeId });
  }
  if (draft.stage === "collecting_model") {
    return progressCreate(ctx, service, input, draft, { ...draft.params, model: selected.value });
  }

  const candidates = draft.action === "reset" || draft.action === "scopes_read"
    ? ownedAgentCandidates(service, input)
    : service.listAgentCandidates({ actorUserId: input.userId, serverId: input.serverId });
  const candidate = candidates.find((item) => item.agent.id === selected.id);
  if (!candidate) return failDraft(ctx, draft, "The selected agent is no longer available.", "agent_not_found");
  const params = { ...draft.params, targetAgentId: candidate.agent.id };
  if (draft.action === "start") {
    ctx.store.updateCommunicationAgentManagementDraft(draft.id, { params, choices: [] });
    return executeTarget(ctx, service, input, { ...draft, params });
  }
  if (draft.action === "scopes_read") {
    ctx.store.updateCommunicationAgentManagementDraft(draft.id, { params, choices: [] });
    return executeAgentScopesRead(ctx, input, { ...draft, params });
  }
  if (draft.action === "create") {
    return failDraft(ctx, draft, "The agent creation draft is no longer valid.", "invalid_draft_stage");
  }
  if (draft.action === "update") return continueUpdateDraft(ctx, service, input, draft, candidate, params);
  if (draft.action === "batch_start" || draft.action === "batch_stop" || draft.action === "batch_restart") {
    return failDraft(ctx, draft, "The device batch request is no longer valid.", "invalid_draft_stage");
  }
  if (draft.action !== "stop" && draft.action !== "restart" && draft.action !== "reset" && draft.action !== "delete") {
    return failDraft(ctx, draft, "The Agent request is no longer valid.", "invalid_draft_stage");
  }
  const content = confirmationText(draft.action, candidate);
  return updateDraft(ctx, draft, { stage: "awaiting_confirmation", params, choices: [], replyText: content });
}

export async function beginCommunicationAgentAction(
  ctx: ServerRouteContext,
  input: HandleCommunicationAgentActionInput,
  intent: Exclude<CommunicationAgentActionIntent, { action: "unsupported_batch" }>
): Promise<CommunicationAgentActionReply> {
  // 新请求在创建草稿和执行权限检查前先验证能力仍对 Assistant 开放，避免遗留调用绕过 Registry。
  if (communicationAgentManagementActionAvailabilityError(intent.action)) {
    return {
      handled: true,
      content: "This operation is no longer available. Start a new request."
    };
  }
  if (lacksAgentMutationRole(ctx, input)) {
    return rejectNewMutation(
      ctx,
      input,
      intent.action,
      "I can manage agents for workspace owners and members only.",
      "denied",
      "server_member_required"
    );
  }

  const service = managementService(ctx);
  if (intent.action === "computer_rename") {
    const params: CommunicationAgentManagementParams = {
      ...(intent.computerReference ? { machineReference: intent.computerReference } : {}),
      ...(intent.name ? { name: intent.name } : {})
    };
    const created = beginDraft(ctx, input, intent.action, "collecting_machine", params, [], "Preparing device rename.");
    if (!created.created) return replayReply(created.draft);
    return progressComputerRename(ctx, input, created.draft, params);
  }

  if (intent.action === "runtime_models_detect") {
    const params: CommunicationAgentManagementParams = {
      ...(intent.computerReference ? { machineReference: intent.computerReference } : {}),
      ...(intent.runtimeReference ? { runtimeReference: intent.runtimeReference } : {})
    };
    const created = beginDraft(ctx, input, intent.action, "collecting_machine", params, [], "Preparing runtime model detection.");
    if (!created.created) return replayReply(created.draft);
    return progressRuntimeModelDetection(ctx, input, created.draft, params);
  }

  if (intent.action === "create") {
    const params: CommunicationAgentManagementParams = {
      ...(intent.name ? { name: intent.name } : {}),
      ...(intent.machineReference ? { machineReference: intent.machineReference } : {}),
      ...(intent.runtimeReference ? { runtimeReference: intent.runtimeReference } : {}),
      ...(intent.modelReference ? { modelReference: intent.modelReference } : {}),
      ...(intent.permissionMode ? { permissionMode: intent.permissionMode } : {})
    };
    const created = beginDraft(ctx, input, "create", "collecting_name", params, [], "Preparing agent creation.");
    if (!created.created) return replayReply(created.draft);
    return progressCreate(ctx, service, input, created.draft, params);
  }

  if (intent.action === "batch_start" || intent.action === "batch_stop" || intent.action === "batch_restart") {
    const params: CommunicationAgentManagementParams = {
      ...(intent.computerReference ? { machineReference: intent.computerReference } : {})
    };
    const created = beginDraft(
      ctx,
      input,
      intent.action,
      "collecting_machine",
      params,
      [],
      "Preparing device agent control."
    );
    if (!created.created) return replayReply(created.draft);
    return progressBatchDraft(ctx, service, input, created.draft, params);
  }

  const targetIntent = intent as Extract<CommunicationAgentActionIntent, { action: "update" | "start" | "stop" | "restart" | "reset" | "delete" | "scopes_read" }>;
  const reference = targetIntent.agentReference;
  if (reference && service.isProtectedAgentReference({
    actorUserId: input.userId,
    serverId: input.serverId,
    reference
  })) {
    return rejectNewMutation(
      ctx,
      input,
      targetIntent.action,
      "Communication Agents are protected and cannot be managed here.",
      "denied",
      "system_agent_protected"
    );
  }
  const visibleCandidates = service.listAgentCandidates({ actorUserId: input.userId, serverId: input.serverId });
  const ownershipRequired = targetIntent.action === "reset" || targetIntent.action === "scopes_read";
  const allCandidates = ownershipRequired ? ownedAgentCandidates(service, input) : visibleCandidates;
  const candidates = exactAgents(allCandidates, reference);
  if (candidates.length === 0 && reference) {
    if (ownershipRequired && exactAgents(visibleCandidates, reference).length > 0) {
      return rejectNewMutation(
        ctx,
        input,
        targetIntent.action,
        "You do not have permission to manage that Agent's runtime.",
        "denied",
        "agent_owner_required"
      );
    }
    return rejectNewMutation(
      ctx,
      input,
      targetIntent.action,
      "I could not find an exact agent match. Try list agents.",
      "failed",
      "agent_not_found"
    );
  }
  if (candidates.length === 0) {
    return { handled: true, content: ownershipRequired ? "No owned executable agents are available." : "No executable agents are available." };
  }
  return targetIntent.action === "update"
    ? startUpdateDraft(ctx, service, input, targetIntent, candidates)
    : startTargetDraft(ctx, service, input, targetIntent.action, candidates);
}

export async function handleCommunicationAgentAction(
  ctx: ServerRouteContext,
  input: HandleCommunicationAgentActionInput
): Promise<CommunicationAgentActionReply> {
  const draftScope = scope(input);
  const replay = ctx.store.getCommunicationAgentManagementDraftBySourceEvent({
    ...draftScope,
    sourceEventKey: input.sourceContext.sourceEventKey
  });
  if (replay) return replayReply(replay);

  const active = ctx.store.getLatestCommunicationAgentManagementDraft(draftScope);
  if (active?.status === "expired") {
    const attached = ctx.store.attachCommunicationAgentManagementDraftSourceEvent(active.id, {
      ...draftScope,
      sourceEventKey: input.sourceContext.sourceEventKey
    });
    if (!attached) {
      const existing = ctx.store.getCommunicationAgentManagementDraftBySourceEvent({
        ...draftScope,
        sourceEventKey: input.sourceContext.sourceEventKey
      });
      if (existing) return replayReply(existing);
    }
    lifecycleAudit(ctx, active, "expired");
    return replayReply(active);
  }

  const pendingCommand = /^\/?(?:confirm|cancel)$/i.test(input.content.trim());
  if (!active && /^\/?confirm$/i.test(input.content.trim())) {
    const legacyRoutePending = ctx.store.hasUnresolvedCommunicationAgentPendingAction({
      serverId: input.serverId,
      userId: input.userId,
      assistantAgentId: input.assistant.id,
      channelId: input.channelId
    });
    if (!legacyRoutePending) {
      const resolved = ctx.store.getLatestResolvedCommunicationAgentManagementDraft(draftScope);
      if (resolved?.stage === "awaiting_confirmation") {
        const attached = ctx.store.attachCommunicationAgentManagementDraftSourceEvent(resolved.id, {
          ...draftScope,
          sourceEventKey: input.sourceContext.sourceEventKey
        });
        if (attached) return replayReply(attached);
        const existing = ctx.store.getCommunicationAgentManagementDraftBySourceEvent({
          ...draftScope,
          sourceEventKey: input.sourceContext.sourceEventKey
        });
        if (existing) return replayReply(existing);
      }
    }
  }
  const parsedIntent = parseCommunicationAgentActionIntent(input.content);
  const guardService = managementService(ctx);
  const guardCandidates = guardService.listAgentCandidates({ actorUserId: input.userId, serverId: input.serverId });
  const guarded = guardAgentManagementMessage({
    content: input.content,
    agents: guardAgentContexts(ctx, guardCandidates)
  });
  let newIntent = parsedIntent;
  if (guarded.kind === "update" && (!parsedIntent || guarded.foreignRuntimeReference)) {
    newIntent = {
      action: "update",
      ...(guarded.agentReference ? { agentReference: guarded.agentReference } : {}),
      ...(guarded.field ? { field: guarded.field } : {}),
      ...(guarded.value !== undefined ? { value: guarded.value } : {}),
      ...(guarded.foreignRuntimeReference ? { foreignRuntimeReference: guarded.foreignRuntimeReference } : {})
    };
  }
  const unsupportedRuntime = guarded.kind === "unsupported_runtime_update" ? guarded : undefined;
  const sensitive = isSensitiveAgentManagementRequest(input.content);
  // 明确的新管理 verb 会取代旧草稿；普通数字/名称仍严格消费当前 stage。
  if (active && (pendingCommand || (!newIntent && !unsupportedRuntime && !sensitive))) {
    return activeDraftReply(ctx, managementService(ctx), input, active);
  }

  if (sensitive && !newIntent) {
    return { handled: true, content: "I cannot change sensitive agent settings in a conversation. Use the Agent settings page." };
  }
  if (newIntent?.action === "unsupported_batch") {
    return { handled: true, content: "I can manage only one agent at a time. Name one exact agent." };
  }
  if (unsupportedRuntime) {
    const candidate = exactAgents(guardCandidates, unsupportedRuntime.agentReference)[0];
    if (!candidate) return { handled: false, content: "" };
    const content = runtimeUpdateUnsupportedText(candidate, unsupportedRuntime.requestedRuntimeReference);
    return rejectNewMutation(ctx, input, "update", content, "failed", "runtime_update_unsupported");
  }
  if (!newIntent) return { handled: false, content: "" };
  return beginCommunicationAgentAction(ctx, input, newIntent);
}
