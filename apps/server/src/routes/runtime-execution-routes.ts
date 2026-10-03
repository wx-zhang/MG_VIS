import type express from "express";
import {
  governanceDecisionExplanation,
  type AgentRecord,
  type AgentRuntimeSessionRecord,
  type AgentToolOperationObservability,
  type AuditEventRecord,
  type GovernanceDecisionRecord,
  type GovernancePolicyConfigAuditRecord,
  type MachineRecord,
  type RuntimeApprovalRecord,
  type RuntimeContextDebugMetrics,
  type RuntimeExecutionDebugExport,
  type RuntimeExecutionDebugExportRequest,
  type RuntimeExecutionGovernancePolicySnapshot,
  type RuntimeExecutionRecord
} from "@tyr-ai/contracts";
import { resolveEffectiveGovernanceRuntimeConfig } from "../governance-policy";
import type { ServerRouteContext } from "../server-context";
import { canUserAccessRuntimeExecutionSource } from "../conversation-source-access";
import { sanitizeHumanVisibleValue } from "../output-disclosure";
import { runtimeContextSessionRolloutStatus, runtimeContextSessionsEnabled } from "../runtime-context-session";

const MAX_DEBUG_EXPORT_EXECUTIONS = 20;

export function registerRuntimeExecutionRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const { store, requireAuthUser, latestRuntimeSha = () => undefined } = ctx;

  app.post("/api/runtime-executions/debug-export", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const body = req.body as Partial<RuntimeExecutionDebugExportRequest> | undefined;
    const executionIds = Array.isArray(body?.executionIds) ? [...new Set(body.executionIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0))] : [];
    if (executionIds.length === 0) {
      res.status(400).json({ error: "execution_ids_required" });
      return;
    }
    if (executionIds.length > MAX_DEBUG_EXPORT_EXECUTIONS) {
      res.status(400).json({ error: "execution_ids_limit_exceeded" });
      return;
    }

    const executions = executionIds.map((executionId) => store.getRuntimeExecution(executionId));
    if (executions.some((execution) => !execution)) {
      res.status(404).json({ error: "runtime_execution_not_found" });
      return;
    }
    const ownedExecutions = executions.filter((execution): execution is RuntimeExecutionRecord => Boolean(execution));
    for (const execution of ownedExecutions) {
      const agent = store.getAgent(execution.agentId);
      // Debug export contains raw persisted runtime data, so P1.1 keeps it scoped to the owning user's agents.
      if (!agent || agent.ownerUserId !== user.id) {
        res.status(404).json({ error: "runtime_execution_not_found" });
        return;
      }
      if (!canUserAccessRuntimeExecutionSource(store, user.id, execution)) {
        res.status(404).json({ error: "runtime_execution_not_found" });
        return;
      }
    }

    const events = ownedExecutions.flatMap((execution) => store.listRuntimeExecutionEvents(execution.id));
    const runtimeSessions = runtimeSessionsForDebugExport(store, ownedExecutions);
    const runtimeContextMetrics = runtimeContextMetricsFromEvents(events);
    const operationObservability = events.flatMap((event) => operationObservabilityFromPayload(event.payload));
    const executionGroupIds = new Set<string>();
    for (const execution of ownedExecutions) {
      for (const group of store.listExecutionGroups({
        taskId: execution.taskId,
        messageId: execution.messageId,
        threadChannelId: execution.threadChannelId,
        limit: 20
      })) {
        executionGroupIds.add(group.id);
      }
    }
    const executionBlocks = [...executionGroupIds].flatMap((groupId) => store.listExecutionBlocks(groupId));
    const approvals = ownedExecutions.flatMap((execution) => store.listRuntimeApprovals({ executionId: execution.id, limit: 1000 }));
    const safetyAssessments = ownedExecutions.flatMap((execution) => store.listSafetyAssessments({ executionId: execution.id, limit: 1000 }));
    const governanceDecisions = governanceDecisionsForDebugExport(store, ownedExecutions, approvals);
    const governancePolicySnapshots = governancePolicySnapshotsForDebugExport(ctx, ownedExecutions);
    const governancePolicyConfigAudit = governancePolicyConfigAuditForDebugExport(store, governancePolicySnapshots);
    const auditEvents = governanceAuditEventsForDebugExport(store, governancePolicySnapshots);
    const governanceExplanations = governanceDecisions.map(governanceDecisionExplanation);
    const machinesById = new Map(
      [...new Set(ownedExecutions.map((execution) => execution.machineId))]
        .map((machineId) => store.getMachine(machineId))
        .filter((machine): machine is MachineRecord => Boolean(machine))
        .map((machine) => [machine.id, machine])
    );
    const rolloutStatus = runtimeContextSessionRolloutStatus();
    const rolloutAgents = [...new Set(ownedExecutions.map((execution) => execution.agentId))]
      .map((agentId) => store.getAgent(agentId))
      .filter((agent): agent is AgentRecord => Boolean(agent))
      .map((agent) => ({
        id: agent.id,
        enabled: Boolean(agent.runtime && runtimeContextSessionsEnabled(agent.runtime, undefined, agent.id))
      }));
    const exported: RuntimeExecutionDebugExport = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      executions: ownedExecutions,
      events,
      operationObservability,
      executionBlocks,
      approvals,
      safetyAssessments,
      governanceDecisions,
      governancePolicySnapshots,
      governancePolicyConfigAudit,
      governanceExplanations,
      auditEvents,
      runtimeSessions,
      runtimeContextMetrics,
      environment: {
        latestRuntimeSha: latestRuntimeSha(),
        machines: [...machinesById.values()].map((machine) => ({
          id: machine.id,
          name: machine.name,
          runtimeSha: machine.runtimeSha,
          runtimeMarker: machine.runtimeMarker,
          runtimeMarkerMtime: machine.runtimeMarkerMtime,
          daemonVersion: machine.daemonVersion,
          status: machine.status,
          runtimeReports: store.listRuntimeReports(machine.id)
        })),
        runtimeContextSessionRollout: {
          ...rolloutStatus,
          agents: rolloutAgents
        }
      },
      stats: {
        source: "server-persisted",
        executionCount: ownedExecutions.length,
        eventCount: events.length,
        blockCount: executionBlocks.length,
        approvalCount: approvals.length,
        safetyAssessmentCount: safetyAssessments.length,
        governanceDecisionCount: governanceDecisions.length,
        governancePolicySnapshotCount: governancePolicySnapshots.length,
        governancePolicyConfigAuditCount: governancePolicyConfigAudit.length,
        governanceExplanationCount: governanceExplanations.length,
        auditEventCount: auditEvents.length,
        runtimeSessionCount: runtimeSessions.length,
        requestedExecutionIds: executionIds
      }
    };
    // Debug export 是人类可下载出口，权限校验通过后仍必须执行与消息、execution 相同的凭据脱敏。
    res.json(sanitizeHumanVisibleValue(exported));
  });
}

function runtimeSessionsForDebugExport(store: ServerRouteContext["store"], executions: RuntimeExecutionRecord[]): AgentRuntimeSessionRecord[] {
  const sessions = executions.flatMap((execution) => execution.runtimeContextKey
    ? store.listAgentRuntimeSessions({
        agentId: execution.agentId,
        machineId: execution.machineId,
        runtime: execution.runtime,
        contextKey: execution.runtimeContextKey
      })
    : execution.runtimeSessionRecordId
      ? [store.getAgentRuntimeSession(execution.runtimeSessionRecordId)].filter((session): session is AgentRuntimeSessionRecord => Boolean(session))
      : []);
  const unique = new Map(sessions.map((session) => [session.id, session]));
  return [...unique.values()].sort((a, b) => a.contextKey.localeCompare(b.contextKey) || a.generation - b.generation);
}

function runtimeContextDiagnosticCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const code = (payload as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function runtimeContextMetricsFromEvents(events: RuntimeExecutionDebugExport["events"]): RuntimeContextDebugMetrics {
  const metrics: RuntimeContextDebugMetrics = {
    runtime_context_session_started_total: 0,
    runtime_context_session_resumed_total: 0,
    runtime_context_switch_total: 0,
    runtime_context_resume_failed_total: 0,
    runtime_context_binding_rejected_total: 0,
    runtime_context_queue_wait_ms: { count: 0, total: 0, average: 0, max: 0 }
  };
  const queueStartedAt = new Map<string, number>();
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at) || a.sequence - b.sequence);
  for (const event of ordered) {
    const code = runtimeContextDiagnosticCode(event.payload);
    if (code === "runtime_context_session_started") metrics.runtime_context_session_started_total += 1;
    if (code === "runtime_context_session_resumed") metrics.runtime_context_session_resumed_total += 1;
    if (code === "runtime_context_switch") metrics.runtime_context_switch_total += 1;
    if (code === "runtime_context_session_resume_failed") metrics.runtime_context_resume_failed_total += 1;
    if (code === "runtime_context_session_bind_rejected") metrics.runtime_context_binding_rejected_total += 1;
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) continue;
    if (event.kind === "queued") queueStartedAt.set(event.executionId, at);
    if (["runtime_context_start", "runtime_context_switch", "runtime_context_session_started", "runtime_context_session_resumed"].includes(code ?? "")) {
      const queuedAt = queueStartedAt.get(event.executionId);
      if (queuedAt === undefined) continue;
      const waitMs = Math.max(0, at - queuedAt);
      metrics.runtime_context_queue_wait_ms.count += 1;
      metrics.runtime_context_queue_wait_ms.total += waitMs;
      metrics.runtime_context_queue_wait_ms.max = Math.max(metrics.runtime_context_queue_wait_ms.max, waitMs);
      queueStartedAt.delete(event.executionId);
    }
  }
  metrics.runtime_context_queue_wait_ms.average = metrics.runtime_context_queue_wait_ms.count > 0
    ? Math.round(metrics.runtime_context_queue_wait_ms.total / metrics.runtime_context_queue_wait_ms.count)
    : 0;
  return metrics;
}

function governancePolicySnapshotsForDebugExport(
  ctx: ServerRouteContext,
  executions: RuntimeExecutionRecord[]
): RuntimeExecutionGovernancePolicySnapshot[] {
  const seen = new Set<string>();
  const snapshots: RuntimeExecutionGovernancePolicySnapshot[] = [];
  for (const execution of executions) {
    const serverId = execution.serverId;
    if (!serverId) continue;
    const key = `${serverId}:${execution.agentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const effective = resolveEffectiveGovernanceRuntimeConfig({
      store: ctx.store,
      baseConfig: ctx.governanceConfig,
      serverId,
      agentId: execution.agentId
    });
    snapshots.push({
      serverId,
      agentId: execution.agentId,
      enabled: effective.config.enabled,
      mode: effective.config.mode,
      model: effective.config.model,
      policyVersion: effective.policyAudit.version,
      policySource: effective.policyAudit.source,
      policyScope: effective.policyAudit.scope,
      decisionSource: "deterministic",
      matchedOverrides: effective.policyAudit.matchedOverrides,
      resolvedPolicy: effective.policyAudit.resolvedPolicy,
      configs: effective.configs
    });
  }
  return snapshots;
}

function governancePolicyConfigAuditForDebugExport(
  store: ServerRouteContext["store"],
  snapshots: RuntimeExecutionGovernancePolicySnapshot[]
): GovernancePolicyConfigAuditRecord[] {
  const configIds = new Set(governancePolicyConfigIds(snapshots));
  if (configIds.size === 0) return [];
  const audits = snapshots.flatMap((snapshot) => store.listGovernancePolicyConfigAudit({ serverId: snapshot.serverId, limit: 1000 }));
  return uniqueGovernancePolicyConfigAudit(audits.filter((audit) => configIds.has(audit.configId)));
}

function governanceAuditEventsForDebugExport(
  store: ServerRouteContext["store"],
  snapshots: RuntimeExecutionGovernancePolicySnapshot[]
): AuditEventRecord[] {
  const configIds = governancePolicyConfigIds(snapshots);
  if (configIds.length === 0) return [];
  const serverIds = [...new Set(snapshots.map((snapshot) => snapshot.serverId))];
  const events = serverIds.flatMap((serverId) => store.listAuditEvents({
    serverId,
    resourceType: "governance_policy_config",
    resourceIds: configIds,
    limit: 1000,
    order: "desc"
  }));
  return uniqueAuditEvents(events).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

function governancePolicyConfigIds(snapshots: RuntimeExecutionGovernancePolicySnapshot[]): string[] {
  return [...new Set(snapshots.flatMap((snapshot) => [
    snapshot.configs.workspace?.id,
    snapshot.configs.agent?.id
  ]).filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function uniqueGovernancePolicyConfigAudit(audits: GovernancePolicyConfigAuditRecord[]): GovernancePolicyConfigAuditRecord[] {
  const seen = new Set<string>();
  const unique: GovernancePolicyConfigAuditRecord[] = [];
  for (const audit of audits) {
    if (seen.has(audit.id)) continue;
    seen.add(audit.id);
    unique.push(audit);
  }
  return unique.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

function uniqueAuditEvents(events: AuditEventRecord[]): AuditEventRecord[] {
  const seen = new Set<string>();
  const unique: AuditEventRecord[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    unique.push(event);
  }
  return unique;
}

function uniqueGovernanceDecisions(decisions: GovernanceDecisionRecord[]): GovernanceDecisionRecord[] {
  const seen = new Set<string>();
  const unique: GovernanceDecisionRecord[] = [];
  for (const decision of decisions) {
    if (seen.has(decision.id)) continue;
    seen.add(decision.id);
    unique.push(decision);
  }
  return unique.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function governanceDecisionsForDebugExport(
  store: ServerRouteContext["store"],
  executions: RuntimeExecutionRecord[],
  approvals: RuntimeApprovalRecord[]
): GovernanceDecisionRecord[] {
  const context = {
    executionIds: new Set(executions.map((execution) => execution.id)),
    approvalIds: new Set(approvals.map((approval) => approval.id)),
    taskIds: compactStringSet([
      ...executions.map((execution) => execution.taskId),
      ...approvals.map((approval) => approval.taskId)
    ]),
    messageIds: compactStringSet([
      ...executions.map((execution) => execution.messageId),
      ...approvals.map((approval) => approval.messageId)
    ]),
    threadChannelIds: compactStringSet([
      ...executions.map((execution) => execution.threadChannelId),
      ...approvals.map((approval) => approval.threadChannelId)
    ]),
    serverIds: compactStringSet([
      ...executions.map((execution) => execution.serverId),
      ...approvals.map((approval) => approval.serverId)
    ])
  };
  const candidates = [
    ...executions.flatMap((execution) => store.listGovernanceDecisions({ executionId: execution.id, limit: 1000 })),
    ...approvals.flatMap((approval) => store.listGovernanceDecisions({ approvalId: approval.id, limit: 1000 })),
    ...[...context.taskIds].flatMap((taskId) => store.listGovernanceDecisions({ taskId, limit: 1000 })),
    // Outbound/upload governance may be recorded against the task/message/thread only, so server-wide
    // lookup is scoped back down to this debug export context before any decision is returned.
    ...[...context.serverIds].flatMap((serverId) => store.listGovernanceDecisions({ serverId, limit: 1000 }))
  ];
  return uniqueGovernanceDecisions(candidates.filter((decision) => governanceDecisionBelongsToDebugContext(decision, context)));
}

function governanceDecisionBelongsToDebugContext(
  decision: GovernanceDecisionRecord,
  context: {
    executionIds: Set<string>;
    approvalIds: Set<string>;
    taskIds: Set<string>;
    messageIds: Set<string>;
    threadChannelIds: Set<string>;
  }
): boolean {
  if (decision.executionId && context.executionIds.has(decision.executionId)) return true;
  if (decision.approvalId && context.approvalIds.has(decision.approvalId)) return true;
  if (decision.taskId && context.taskIds.has(decision.taskId)) return true;
  if (decision.messageId && context.messageIds.has(decision.messageId)) return true;
  if (decision.threadChannelId && context.threadChannelIds.has(decision.threadChannelId)) return true;
  return false;
}

function compactStringSet(values: Array<string | undefined>): Set<string> {
  return new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0));
}

function operationObservabilityFromPayload(payload: unknown): AgentToolOperationObservability[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const value = (payload as { operationObservability?: unknown }).operationObservability;
  return isAgentToolOperationObservability(value) ? [value] : [];
}

function isAgentToolOperationObservability(value: unknown): value is AgentToolOperationObservability {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.operationId === "string"
    && typeof item.runtimeId === "string"
    && typeof item.selectedTransport === "string"
    && typeof item.actualTransport === "string"
    && typeof item.preferredTransport === "string"
    && Array.isArray(item.fallbackTransports)
    && Array.isArray(item.degradedTransports);
}
