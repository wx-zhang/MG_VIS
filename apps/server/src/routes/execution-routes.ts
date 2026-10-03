import type express from "express";
import type { AgentRunRecord, ExecutionBlockPageInfo, ExecutionBlockRecord, ExecutionContextPayload, ExecutionGroupRecord, GovernanceDecisionRecord, RuntimeApprovalRecord, RuntimeExecutionRecord, SafetyAssessmentRecord, UserRecord } from "@tyr-ai/contracts";
import { warnIfLargeSyncPayload } from "../sync-payload-diagnostics";
import type { ServerRouteContext } from "../server-context";
import { sanitizeHumanVisibleValue } from "../output-disclosure";
import { compactGovernanceDecisionForSync, compactRuntimeApprovalForSync, compactSafetyAssessmentForSync } from "../sync-payload-compact";
import {
  canUserAccessGovernanceDecisionSource,
  canUserAccessRuntimeExecutionSource,
  canUserAccessSafetyAssessmentSource
} from "../conversation-source-access";

const CONTEXT_RESOLVED_APPROVAL_LIMIT = 12;
const CONTEXT_SAFETY_ASSESSMENT_LIMIT = 12;
const CONTEXT_GOVERNANCE_DECISION_LIMIT = 12;

export function registerExecutionRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const { store, requireAuthUser } = ctx;

  app.get("/api/execution-context", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const query = executionContextQuery(req.query);
    if (!query) {
      res.status(400).json({ error: "execution_context_query_required" });
      return;
    }
    const startedAt = Date.now();
    const result = ownedExecutionContext(query, user, ctx, {
      blockLimit: blockLimitFromQuery(req.query.blockLimit, 30),
      blockTail: booleanFromQuery(req.query.blockTail, true)
    });
    if (!result) {
      res.status(404).json({ error: "execution_context_not_found" });
      return;
    }
    warnIfLargeSyncPayload("execution-context", result.context, {
      userId: user.id,
      extra: {
        ...result.diagnostics,
        durationMs: Date.now() - startedAt
      }
    });
    // Web Execution 与 Chat/MCP 共用公开安全边界；原始执行记录只保留在服务端内部。
    res.json(sanitizeHumanVisibleValue(result.context));
  });

  app.get("/api/execution-groups/:groupId", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const group = ownedExecutionGroup(req.params.groupId, user, ctx);
    if (!group) {
      res.status(404).json({ error: "execution_group_not_found" });
      return;
    }
    res.json(sanitizeHumanVisibleValue({ group }));
  });

  app.get("/api/execution-groups/:groupId/runs", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const group = ownedExecutionGroup(req.params.groupId, user, ctx);
    if (!group) {
      res.status(404).json({ error: "execution_group_not_found" });
      return;
    }
    res.json(sanitizeHumanVisibleValue({ runs: store.listAgentRuns({ groupId: group.id, limit: limitFromQuery(req.query.limit, 200) }) }));
  });

  app.get("/api/execution-groups/:groupId/blocks", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const group = ownedExecutionGroup(req.params.groupId, user, ctx);
    if (!group) {
      res.status(404).json({ error: "execution_group_not_found" });
      return;
    }
    const options = {
      limit: blockLimitFromQuery(req.query.limit, 30),
      beforeSequence: optionalNumber(req.query.beforeSequence),
      agentId: typeof req.query.agentId === "string" && req.query.agentId.trim() ? req.query.agentId.trim() : undefined,
      tail: booleanFromQuery(req.query.tail, false)
    };
    const blocks = store.listExecutionBlocks(group.id, options);
    // 历史分页同样不得把服务端原始 block 发送到浏览器。
    const payload = sanitizeHumanVisibleValue({ blocks, pageInfo: buildExecutionBlockPageInfo(blocks, group.id, options.agentId, ctx) });
    warnIfLargeSyncPayload("execution-block-page", payload, { userId: user.id });
    res.json(payload);
  });
}

type ExecutionContextQuery = {
  taskId?: string;
  messageId?: string;
  threadChannelId?: string;
};

function executionContextQuery(query: Record<string, unknown>): ExecutionContextQuery | null {
  const taskId = typeof query.taskId === "string" && query.taskId.trim() ? query.taskId.trim() : undefined;
  const messageId = typeof query.messageId === "string" && query.messageId.trim() ? query.messageId.trim() : undefined;
  const threadChannelId = typeof query.threadChannelId === "string" && query.threadChannelId.trim() ? query.threadChannelId.trim() : undefined;
  return taskId || messageId || threadChannelId ? { taskId, messageId, threadChannelId } : null;
}

type ExecutionContextDiagnostics = {
  candidateRuntimeExecutionsBeforeScope: number;
  runtimeExecutions: number;
  runtimeApprovalsBeforeLimit: number;
  runtimeApprovals: number;
  safetyAssessmentsBeforeLimit: number;
  safetyAssessments: number;
  governanceDecisionsBeforeLimit: number;
  governanceDecisions: number;
};

function ownedExecutionContext(query: ExecutionContextQuery, user: UserRecord, ctx: ServerRouteContext, options: { blockLimit: number; blockTail: boolean }): { context: ExecutionContextPayload; diagnostics: ExecutionContextDiagnostics } | null {
  const messageLinkedExecutions = query.messageId
    ? ctx.store.listRuntimeExecutionsForMessageIds([query.messageId], user.id, 1000)
      .filter((execution) => canUserAccessRuntimeExecutionSource(ctx.store, user.id, execution))
      // 子 delegation/blocker 继续由 sourceExecution 和 blocker 关系归类；这里只补齐没有上游执行的 TYR 根 handoff。
      .filter((execution) => execution.messageId === query.messageId || (
        execution.rootMessageId === query.messageId &&
        !execution.sourceExecutionId
      ))
    : [];
  const sourceVisibleExecutionMessageIds = new Set(messageLinkedExecutions.map((execution) => execution.messageId));
  const groups = uniqueById([
    ...(query.taskId ? ctx.store.listExecutionGroups({ taskId: query.taskId, limit: 50 }) : []),
    ...(query.messageId ? ctx.store.listExecutionGroups({ messageId: query.messageId, limit: 50 }) : []),
    ...(query.threadChannelId ? ctx.store.listExecutionGroups({ threadChannelId: query.threadChannelId, limit: 50 }) : []),
    ...ctx.store.listExecutionGroupsForMessageIds([...sourceVisibleExecutionMessageIds], 1000)
  ]).filter((group) => (
    groupVisibleBySourceAccess(group, user, ctx) ||
    // TYR 的公开 route 消息是 rootMessageId，执行 group 则绑定内部 handoff；根来源可见时允许加载该 group 的安全投影。
    Boolean(group.messageId && sourceVisibleExecutionMessageIds.has(group.messageId))
  ));
  const groupIds = new Set(groups.map((group) => group.id));
  const agentRuns = uniqueById(groups.flatMap((group) => ctx.store.listAgentRuns({ groupId: group.id, limit: 1000 })))
    .filter((run) => groupIds.has(run.groupId));
  const executionBlockPageInfoByGroup: Record<string, ExecutionBlockPageInfo> = {};
  const executionBlocks = groups.flatMap((group) => {
    const blocks = ctx.store.listExecutionBlocks(group.id, { limit: options.blockLimit, tail: options.blockTail });
    executionBlockPageInfoByGroup[group.id] = buildExecutionBlockPageInfo(blocks, group.id, undefined, ctx);
    return blocks;
  });
  const executionArtifacts = groups.flatMap((group) => ctx.store.listExecutionArtifacts(group.id));
  const runtimeExecutionResult = ownedRuntimeExecutionsForContext(query, user, ctx, groups, agentRuns, messageLinkedExecutions);
  const runtimeExecutions = runtimeExecutionResult.executions;
  const childRuntimeExecutions = uniqueById(runtimeExecutions.flatMap((execution) =>
    ctx.store.listRuntimeExecutions({ sourceExecutionId: execution.id, limit: 1000 })
  )).filter((execution) => canUserAccessRuntimeExecutionSource(ctx.store, user.id, execution));
  const directAndChildRuntimeExecutions = uniqueById([...runtimeExecutions, ...childRuntimeExecutions]);
  const blockerRuntimeExecutions = daemonQueueBlockerRuntimeExecutions(directAndChildRuntimeExecutions, user, ctx);
  const contextRuntimeExecutions = uniqueById([...directAndChildRuntimeExecutions, ...blockerRuntimeExecutions]);
  const contextChildRuntimeExecutions = uniqueById([...childRuntimeExecutions, ...blockerRuntimeExecutions]);
  const executionIds = new Set(contextRuntimeExecutions.map((execution) => execution.id));
  const approvalCandidates = uniqueById([
    ...contextRuntimeExecutions.flatMap((execution) => ctx.store.listRuntimeApprovals({ executionId: execution.id, limit: 1000 })),
    ...(query.messageId ? ctx.store.listRuntimeApprovals({ messageId: query.messageId, limit: 1000 }) : []),
    ...(query.threadChannelId ? ctx.store.listRuntimeApprovals({ threadChannelId: query.threadChannelId, limit: 1000 }) : [])
  ]).filter((approval) => (
    // 与审批弹窗和 resolve API 共用授权，避免上下文页重新注入不可操作的 Pending 卡片。
    ctx.store.canUserResolveRuntimeApproval(user.id, approval) &&
    (approval.executionId ? executionIds.has(approval.executionId) : ctx.store.getAgent(approval.agentId)?.ownerUserId === user.id)
  ));
  const approvals = compactRuntimeApprovalsForContext(approvalCandidates);
  const approvalIds = new Set(approvalCandidates.map((approval) => approval.id));
  const visibleApprovalIds = new Set(approvals.map((approval) => approval.id));
  const safetyAssessmentCandidates = uniqueById([
    ...contextRuntimeExecutions.flatMap((execution) => ctx.store.listSafetyAssessments({ executionId: execution.id, limit: 1000 })),
    ...approvalCandidates.flatMap((approval) => ctx.store.listSafetyAssessments({ approvalId: approval.id, limit: 1000 })),
    ...(query.taskId ? ctx.store.listSafetyAssessments({ taskId: query.taskId, limit: 1000 }) : [])
  ]).filter((assessment) => {
    if (!canUserAccessSafetyAssessmentSource(ctx.store, user.id, assessment)) return false;
    if (assessment.executionId) return executionIds.has(assessment.executionId);
    if (assessment.approvalId) return approvalIds.has(assessment.approvalId);
    return ctx.store.getAgent(assessment.agentId)?.ownerUserId === user.id;
  });
  const safetyAssessments = compactSafetyAssessmentsForContext(safetyAssessmentCandidates, visibleApprovalIds);
  const governanceDecisionCandidates = uniqueById([
    ...contextRuntimeExecutions.flatMap((execution) => ctx.store.listGovernanceDecisions({ executionId: execution.id, limit: 1000 })),
    ...approvalCandidates.flatMap((approval) => ctx.store.listGovernanceDecisions({ approvalId: approval.id, limit: 1000 })),
    ...(query.taskId ? ctx.store.listGovernanceDecisions({ taskId: query.taskId, limit: 1000 }) : [])
  ]).filter((decision) => {
    if (!canUserAccessGovernanceDecisionSource(ctx.store, user.id, decision)) return false;
    if (decision.executionId) return executionIds.has(decision.executionId);
    if (decision.approvalId) return approvalIds.has(decision.approvalId);
    return ctx.store.getAgent(decision.agentId)?.ownerUserId === user.id;
  });
  const governanceDecisions = compactGovernanceDecisionsForContext(governanceDecisionCandidates, visibleApprovalIds);
  if (groups.length === 0 && runtimeExecutions.length === 0 && approvals.length === 0) return null;
  return {
    context: {
      executionGroups: groups,
      agentRuns,
      executionBlocks,
      executionBlockPageInfo: executionBlockPageInfoByGroup,
      runtimeExecutions,
      childRuntimeExecutions: contextChildRuntimeExecutions,
      runtimeApprovals: approvals,
      safetyAssessments,
      governanceDecisions,
      executionArtifacts
    },
    diagnostics: {
      candidateRuntimeExecutionsBeforeScope: runtimeExecutionResult.candidateCount,
      runtimeExecutions: runtimeExecutions.length,
      runtimeApprovalsBeforeLimit: approvalCandidates.length,
      runtimeApprovals: approvals.length,
      safetyAssessmentsBeforeLimit: safetyAssessmentCandidates.length,
      safetyAssessments: safetyAssessments.length,
      governanceDecisionsBeforeLimit: governanceDecisionCandidates.length,
      governanceDecisions: governanceDecisions.length
    }
  };
}

function daemonQueueBlockerRuntimeExecutions(executions: RuntimeExecutionRecord[], user: UserRecord, ctx: ServerRouteContext): RuntimeExecutionRecord[] {
  const blockers: RuntimeExecutionRecord[] = [];
  const executionById = new Map(executions.map((execution) => [execution.id, execution]));
  const seen = new Set(executionById.keys());
  for (const execution of executions) {
    for (const event of ctx.store.listRuntimeExecutionEvents(execution.id)) {
      const blockerExecutionId = blockerExecutionIdFromPayload(event.payload);
      if (!blockerExecutionId || seen.has(blockerExecutionId)) continue;
      const blocker = ctx.store.getRuntimeExecution(blockerExecutionId);
      if (!blocker) continue;
      if (blocker.agentId !== execution.agentId || blocker.serverId !== execution.serverId) continue;
      if (!canUserAccessRuntimeExecutionSource(ctx.store, user.id, blocker)) continue;
      seen.add(blocker.id);
      blockers.push(blocker);
    }
  }
  return blockers;
}

function blockerExecutionIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as { blockerExecutionId?: unknown }).blockerExecutionId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function ownedRuntimeExecutionsForContext(
  query: ExecutionContextQuery,
  user: UserRecord,
  ctx: ServerRouteContext,
  groups: ExecutionGroupRecord[],
  agentRuns: AgentRunRecord[],
  messageLinkedExecutions: RuntimeExecutionRecord[]
): { executions: RuntimeExecutionRecord[]; candidateCount: number } {
  const runExecutionIds = agentRuns
    .map((run) => executionIdFromRunId(run.id))
    .filter((id): id is string => Boolean(id));
  const candidates = uniqueById([
    ...runExecutionIds.map((executionId) => ctx.store.getRuntimeExecution(executionId)).filter((execution): execution is RuntimeExecutionRecord => Boolean(execution)),
    ...messageLinkedExecutions,
    ...(query.taskId ? ctx.store.listRuntimeExecutions({ taskId: query.taskId, limit: 1000 }) : []),
    ...(query.messageId ? ctx.store.listRuntimeExecutions({ messageId: query.messageId, limit: 1000 }) : []),
    ...(query.threadChannelId ? ctx.store.listRuntimeExecutions({ threadChannelId: query.threadChannelId, limit: 1000 }) : [])
  ]);
  const groupMessageIds = new Set(groups.map((group) => group.messageId).filter((value): value is string => Boolean(value)));
  const groupTaskIds = new Set(groups.map((group) => group.taskId).filter((value): value is string => Boolean(value)));
  const groupThreadChannelIds = new Set(groups.map((group) => group.threadChannelId).filter((value): value is string => Boolean(value)));
  return {
    executions: candidates.filter((execution) => (
      ctx.store.getAgent(execution.agentId)?.ownerUserId === user.id &&
      canUserAccessRuntimeExecutionSource(ctx.store, user.id, execution) &&
      (
        runExecutionIds.includes(execution.id) ||
        (query.messageId && execution.messageId === query.messageId) ||
        (query.messageId && execution.rootMessageId === query.messageId) ||
        (query.threadChannelId && execution.threadChannelId === query.threadChannelId) ||
        (query.taskId && execution.taskId === query.taskId) ||
        groupMessageIds.has(execution.messageId) ||
        Boolean(execution.taskId && groupTaskIds.has(execution.taskId)) ||
        Boolean(execution.threadChannelId && groupThreadChannelIds.has(execution.threadChannelId))
      )
    )),
    candidateCount: candidates.length
  };
}

function groupVisibleBySourceAccess(group: ExecutionGroupRecord, user: UserRecord, ctx: ServerRouteContext): boolean {
  if (group.messageId) {
    const message = ctx.store.getMessage(group.messageId);
    if (message && ctx.store.canUserAccessChannel(user.id, message.channelId)) return true;
    // 内部 Agent pair DM 不对 Human 开放；其 group 只有在同一用户拥有执行 Agent 且根来源可见时才能返回 Web 安全投影。
    return ctx.store.listRuntimeExecutions({ messageId: group.messageId, limit: 1000 })
      .some((execution) => (
        ctx.store.getAgent(execution.agentId)?.ownerUserId === user.id &&
        canUserAccessRuntimeExecutionSource(ctx.store, user.id, execution)
      ));
  }
  if (group.threadChannelId) {
    return ctx.store.canUserAccessChannel(user.id, group.threadChannelId);
  }
  if (group.taskId) {
    return Boolean(ctx.store.visibleTaskByIdOrMessageId(user.id, group.taskId));
  }
  return false;
}

function ownedExecutionGroup(groupId: string, user: UserRecord, ctx: ServerRouteContext): ExecutionGroupRecord | null {
  const group = ctx.store.getExecutionGroup(groupId);
  if (!group) return null;
  return groupVisibleBySourceAccess(group, user, ctx) ? group : null;
}

function executionIdFromRunId(runId: string): string | null {
  return runId.startsWith("run:") ? runId.slice("run:".length) : null;
}

function compactRuntimeApprovalsForContext(approvals: RuntimeApprovalRecord[]): RuntimeApprovalRecord[] {
  const sorted = [...approvals].sort(compareRuntimeApprovalsDescending);
  const pending = sorted.filter((approval) => approval.status === "pending");
  const pendingIds = new Set(pending.map((approval) => approval.id));
  const resolved = sorted
    .filter((approval) => !pendingIds.has(approval.id))
    .slice(0, CONTEXT_RESOLVED_APPROVAL_LIMIT);
  return [...pending, ...resolved]
    .sort(compareRuntimeApprovalsDescending)
    .map(compactRuntimeApprovalForSync);
}

function compactSafetyAssessmentsForContext(assessments: SafetyAssessmentRecord[], visibleApprovalIds: Set<string>): SafetyAssessmentRecord[] {
  return prioritizeApprovalLinkedRecords(
    assessments,
    visibleApprovalIds,
    CONTEXT_SAFETY_ASSESSMENT_LIMIT,
    (assessment) => assessment.approvalId,
    (assessment) => assessment.createdAt,
    compactSafetyAssessmentForSync
  );
}

function compactGovernanceDecisionsForContext(decisions: GovernanceDecisionRecord[], visibleApprovalIds: Set<string>): GovernanceDecisionRecord[] {
  return prioritizeApprovalLinkedRecords(
    decisions,
    visibleApprovalIds,
    CONTEXT_GOVERNANCE_DECISION_LIMIT,
    (decision) => decision.approvalId,
    (decision) => decision.createdAt,
    compactGovernanceDecisionForSync
  );
}

function prioritizeApprovalLinkedRecords<T extends { id: string }>(
  records: T[],
  visibleApprovalIds: Set<string>,
  limit: number,
  approvalId: (record: T) => string | undefined,
  createdAt: (record: T) => string,
  compact: (record: T) => T
): T[] {
  const sorted = [...records].sort((a, b) => createdAt(b).localeCompare(createdAt(a)) || b.id.localeCompare(a.id));
  const priority = sorted.filter((record) => {
    const id = approvalId(record);
    return Boolean(id && visibleApprovalIds.has(id));
  });
  const priorityIds = new Set(priority.map((record) => record.id));
  return [
    ...priority,
    ...sorted.filter((record) => !priorityIds.has(record.id)).slice(0, Math.max(0, limit - priority.length))
  ].slice(0, Math.max(limit, priority.length)).map(compact);
}

function compareRuntimeApprovalsDescending(a: RuntimeApprovalRecord, b: RuntimeApprovalRecord): number {
  return b.requestedAt.localeCompare(a.requestedAt) || b.id.localeCompare(a.id);
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

function limitFromQuery(value: unknown, fallback: number): number {
  const parsed = optionalNumber(value);
  return Math.max(1, Math.min(parsed ?? fallback, 1000));
}

function blockLimitFromQuery(value: unknown, fallback: number): number {
  const parsed = optionalNumber(value);
  return Math.max(1, Math.min(parsed ?? fallback, 100));
}

function booleanFromQuery(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  return value === "1" || value === "true";
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function buildExecutionBlockPageInfo(blocks: ExecutionBlockRecord[], groupId: string, agentId: string | undefined, ctx: ServerRouteContext): ExecutionBlockPageInfo {
  const oldestSequence = blocks[0]?.groupSequence ?? null;
  const newestSequence = blocks.at(-1)?.groupSequence ?? null;
  return {
    hasMoreBefore: oldestSequence !== null ? countExecutionBlocksBefore(ctx, groupId, oldestSequence, agentId) > 0 : false,
    oldestSequence,
    newestSequence
  };
}

function countExecutionBlocksBefore(ctx: ServerRouteContext, groupId: string, sequence: number, agentId?: string): number {
  if (agentId) {
    return Number(ctx.store.db.prepare("select count(*) from execution_blocks where group_id = ? and agent_id = ? and group_sequence < ?").pluck().get(groupId, agentId, sequence) ?? 0);
  }
  return Number(ctx.store.db.prepare("select count(*) from execution_blocks where group_id = ? and group_sequence < ?").pluck().get(groupId, sequence) ?? 0);
}
