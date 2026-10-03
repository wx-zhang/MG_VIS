import { randomUUID } from "node:crypto";
import type {
  MessageRecord,
  RuntimeApprovalRecord,
  RuntimeExecutionEventKind,
  RuntimeExecutionEventRecord,
  RuntimeExecutionRecord,
  SafetyAssessmentRecord,
  SafetyAuditTrigger,
  TaskRecord
} from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import { buildSafetyAuditCase, judgeSafetyAuditCase, redactSafetyAuditCase, type JudgeOptions } from "@tyr-ai/safety";
import { modelEndpointConfigFromEnv } from "./model-config";

export type SafetyAuditMode = "model" | "dry-run";

export interface SafetyAuditConfig {
  enabled: boolean;
  mode: SafetyAuditMode;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export type SafetyAuditHealth = {
  enabled: boolean;
  mode: SafetyAuditMode;
  model: string;
  hasApiKey: boolean;
};

export type SafetyAuditBackfillFilter = {
  executionId?: string;
  messageId?: string;
  threadChannelId?: string;
  serverId?: string;
};

export type SafetyAuditBackfillResult = {
  executions: number;
  approvals: number;
  assessments: SafetyAssessmentRecord[];
};

type SafetyAuditStore = Pick<
  TyrDb,
  | "ensureSafetyAssessment"
  | "updateSafetyAssessment"
  | "getRuntimeExecution"
  | "listRuntimeExecutions"
  | "listRuntimeApprovals"
  | "listRuntimeExecutionEvents"
  | "findSafetyAssessmentBySubject"
  | "getMessage"
  | "resolveTarget"
  | "listTasks"
  | "taskForMessage"
>;

export function safetyAuditConfigFromEnv(env: NodeJS.ProcessEnv): SafetyAuditConfig {
  const mode = env.TYR_SAFETY_AUDIT_MODE === "dry-run" ? "dry-run" : "model";
  const modelEndpoint = modelEndpointConfigFromEnv(env, { prefix: "TYR_SAFETY_AUDIT", defaultModel: "qwen3.7-plus" });
  const explicitEnabled = env.TYR_SAFETY_AUDIT_ENABLED;
  // R-judge 是旁路审计能力，只接受明确开关，避免配置了 key 就意外触发外部模型调用。
  const enabled = explicitEnabled === "1";
  return {
    enabled,
    mode,
    model: modelEndpoint.model,
    apiKey: modelEndpoint.apiKey,
    baseUrl: modelEndpoint.baseUrl
  };
}

export function safetyAuditHealth(config: SafetyAuditConfig): SafetyAuditHealth {
  return {
    enabled: config.enabled,
    mode: config.mode,
    model: config.model,
    hasApiKey: Boolean(config.apiKey)
  };
}

export function shouldTriggerSafetyAudit(kind: RuntimeExecutionEventKind | SafetyAuditTrigger): boolean {
  return kind === "approval_request" || kind === "turn_completed";
}

export function safetyAssessmentInputForTrigger(input: {
  trigger: SafetyAuditTrigger;
  execution: RuntimeExecutionRecord;
  approval?: RuntimeApprovalRecord;
  event?: RuntimeExecutionEventRecord;
}): Omit<SafetyAssessmentRecord, "createdAt" | "updatedAt"> {
  const subjectType = input.trigger === "approval_request" ? "runtime_approval" : "runtime_execution";
  const subjectId = input.trigger === "approval_request" ? input.approval?.id ?? input.event?.id ?? input.execution.id : input.execution.id;
  return {
    id: `safety_${randomUUID().replaceAll("-", "")}`,
    serverId: input.execution.serverId ?? input.approval?.serverId ?? "local",
    machineId: input.execution.machineId,
    agentId: input.execution.agentId,
    runtime: input.execution.runtime,
    trigger: input.trigger,
    subjectType,
    subjectId,
    status: "queued",
    label: "unknown",
    riskTypes: [],
    analysis: "",
    evidence: [],
    executionId: input.execution.id,
    approvalId: input.approval?.id,
    taskId: input.approval?.taskId ?? input.event?.taskId ?? input.execution.taskId,
    messageId: input.approval?.messageId ?? input.execution.messageId,
    threadChannelId: input.approval?.threadChannelId ?? input.execution.threadChannelId
  };
}

export async function runSafetyAudit(input: {
  store: SafetyAuditStore;
  config: SafetyAuditConfig;
  trigger: SafetyAuditTrigger;
  execution: RuntimeExecutionRecord;
  approval?: RuntimeApprovalRecord;
  event?: RuntimeExecutionEventRecord;
  onUpdate?: (assessment: SafetyAssessmentRecord) => void;
}): Promise<SafetyAssessmentRecord | null> {
  // P1 安全审计是被动旁路能力；未显式启用时不能创建记录或外发上下文。
  if (!input.config.enabled) return null;
  const sourceMessage = input.store.getMessage(input.execution.messageId);
  const sourceChannel = sourceMessage ? input.store.resolveTarget(sourceMessage.channelId, input.execution.serverId) : null;
  const rootChannel = sourceChannel?.type === "thread" && sourceChannel.parentChannelId
    ? input.store.resolveTarget(sourceChannel.parentChannelId, input.execution.serverId)
    : sourceChannel;
  // 冻结模块仍需遵守根会话隔离；历史群聊或无固定身份 DM 不能触发外部 judge。
  if (rootChannel?.type !== "dm" || !rootChannel.dmIdentity) return null;
  const assessmentInput = safetyAssessmentInputForTrigger(input);
  // 同一个 approval 或 completed turn 只审计一次，避免 daemon 重连或重复事件造成报告刷屏。
  const existing = input.store.findSafetyAssessmentBySubject(assessmentInput.subjectType, assessmentInput.subjectId, assessmentInput.trigger);
  if (existing) return existing;
  const queued = input.store.ensureSafetyAssessment(assessmentInput);
  input.onUpdate?.(queued);
  const running = input.store.updateSafetyAssessment(queued.id, {
    status: "running",
    model: input.config.mode === "dry-run" ? "dry-run" : input.config.model,
    error: undefined
  }) ?? queued;
  input.onUpdate?.(running);
  try {
    // 只把必要执行上下文送入 judge，并先做脱敏；P1 结果只作为风险提示，不参与 runtime 决策。
    const auditCase = redactSafetyAuditCase(buildSafetyAuditCase({
      trigger: input.trigger,
      execution: input.execution,
      events: input.store.listRuntimeExecutionEvents(input.execution.id),
      approval: input.approval,
      task: taskForAudit(input.store, input.execution),
      message: messageForAudit(input.store, input.execution)
    }));
    const prediction = await judgeSafetyAuditCase(auditCase, judgeOptions(input.config));
    const completed = input.store.updateSafetyAssessment(queued.id, {
      status: "completed",
      label: prediction.label,
      riskTypes: prediction.riskTypes,
      analysis: prediction.analysis,
      evidence: prediction.evidence,
      model: input.config.mode === "dry-run" ? "dry-run" : input.config.model,
      error: undefined,
      completedAt: new Date().toISOString()
    });
    if (completed) input.onUpdate?.(completed);
    return completed;
  } catch (err) {
    const failed = input.store.updateSafetyAssessment(queued.id, {
      status: "failed",
      label: "unknown",
      analysis: "",
      evidence: [],
      riskTypes: [],
      model: input.config.mode === "dry-run" ? "dry-run" : input.config.model,
      error: err instanceof Error ? err.message : String(err),
      completedAt: new Date().toISOString()
    });
    if (failed) input.onUpdate?.(failed);
    return failed;
  }
}

export async function backfillSafetyAudits(input: {
  store: SafetyAuditStore;
  config: SafetyAuditConfig;
  filter: SafetyAuditBackfillFilter;
  onUpdate?: (assessment: SafetyAssessmentRecord) => void;
}): Promise<SafetyAuditBackfillResult> {
  const filter = normalizedBackfillFilter(input.filter);
  const executions = input.store.listRuntimeExecutions(filter);
  const executionById = new Map(executions.map((execution) => [execution.id, execution]));
  const approvals = input.store.listRuntimeApprovals(filter);
  const assessments: SafetyAssessmentRecord[] = [];
  for (const approval of approvals) {
    const execution = approval.executionId
      ? executionById.get(approval.executionId) ?? input.store.getRuntimeExecution(approval.executionId)
      : null;
    if (!execution) continue;
    const assessment = await runSafetyAudit({
      store: input.store,
      config: input.config,
      trigger: "approval_request",
      execution,
      approval,
      onUpdate: input.onUpdate
    });
    if (assessment) assessments.push(assessment);
  }
  const completedExecutions = executions.filter((execution) => execution.status === "completed");
  for (const execution of completedExecutions) {
    const assessment = await runSafetyAudit({
      store: input.store,
      config: input.config,
      trigger: "turn_completed",
      execution,
      onUpdate: input.onUpdate
    });
    if (assessment) assessments.push(assessment);
  }
  return {
    executions: completedExecutions.length,
    approvals: approvals.length,
    assessments
  };
}

function normalizedBackfillFilter(filter: SafetyAuditBackfillFilter): SafetyAuditBackfillFilter {
  return {
    executionId: filter.executionId?.trim() || undefined,
    messageId: filter.messageId?.trim() || undefined,
    threadChannelId: filter.threadChannelId?.trim() || undefined,
    serverId: filter.serverId?.trim() || undefined
  };
}

function judgeOptions(config: SafetyAuditConfig): JudgeOptions {
  return {
    mode: config.mode,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl
  };
}

function taskForAudit(store: SafetyAuditStore, execution: RuntimeExecutionRecord): TaskRecord | null {
  if (execution.taskId) {
    return store.listTasks(undefined, "all", execution.serverId ?? "local").find((task) => task.id === execution.taskId) ?? null;
  }
  return store.taskForMessage(execution.messageId);
}

function messageForAudit(store: SafetyAuditStore, execution: RuntimeExecutionRecord): MessageRecord | null {
  return store.getMessage(execution.messageId);
}
