import { isCommunicationAgent, type TyrHeartbeatRecord, type TyrHeartbeatRunRecord } from "@tyr-ai/contracts";

import { maybeReplyToCommunicationAgentDm } from "./communication-agent";
import type { ServerRouteContext } from "./server-context";

const DEFAULT_TICK_MS = 5_000;
const DISPATCH_STALE_MS = 5 * 60_000;
const FAILED_EXECUTION_STATUSES = new Set(["failed", "stalled", "cancelled"]);

export interface TyrHeartbeatScheduler {
  start(): void;
  stop(): void;
  tick(): Promise<void>;
}

function onlineWorkerAgents(ctx: ServerRouteContext, serverId: string) {
  return ctx.store.listAgents(serverId).filter((agent) => {
    if (isCommunicationAgent(agent) || agent.deletedAt || !agent.machineId || !agent.runtime) return false;
    const machine = ctx.store.getMachine(agent.machineId);
    return Boolean(
      machine &&
      !machine.deletedAt &&
      machine.status === "online" &&
      (agent.status === "online" || agent.status === "working")
    );
  });
}

function ownerIdForWorkspace(ctx: ServerRouteContext, serverId: string): string | null {
  return ctx.store.listServerMembers(serverId).find((member) => member.role === "owner")?.id ?? null;
}

function heartbeatTriggerContent(heartbeat: TyrHeartbeatRecord, run: TyrHeartbeatRunRecord): string {
  return [
    `[Scheduled Heartbeat] ${heartbeat.title}`,
    "",
    heartbeat.instruction,
    "",
    `Scheduled for: ${run.scheduledFor}`,
    "Choose exactly one most appropriate currently online child Agent, delegate this work now, and return the result to this TYR DM. The selected child Agent must execute the task itself and must not delegate it back to TYR or another Agent. Do not only describe what should be done."
  ].join("\n");
}

function heartbeatResult(
  status: "completed" | "failed",
  title: string,
  summary: string
) {
  return { version: 1 as const, status, title, summary, body: summary };
}

function appendFailureMessage(
  ctx: ServerRouteContext,
  heartbeat: TyrHeartbeatRecord,
  run: TyrHeartbeatRunRecord,
  ownerId: string,
  errorCode: string,
  errorMessage: string
): void {
  const dm = ctx.store.getOrCreateAgentDm(heartbeat.tyrAgentId, ownerId);
  if (!dm) return;
  const message = ctx.store.sendMessage({
    target: dm.id,
    content: `Heartbeat “${heartbeat.title}” failed: ${errorMessage}`,
    result: heartbeatResult("failed", "Heartbeat run failed", errorMessage),
    senderType: "agent",
    senderId: heartbeat.tyrAgentId,
    senderName: ctx.store.getAgent(heartbeat.tyrAgentId)?.displayName ?? "TYR",
    serverId: heartbeat.serverId
  }).message;
  ctx.emitRealtimeMessage(message);
  ctx.store.recordAuditEvent({
    kind: "tyr_heartbeat_run_failed",
    actorType: "agent",
    actorId: heartbeat.tyrAgentId,
    resourceType: "server",
    resourceId: heartbeat.serverId,
    serverId: heartbeat.serverId,
    metadata: { heartbeatId: heartbeat.id, runId: run.id, errorCode, sourceMessageId: run.sourceMessageId ?? null }
  });
}

function completeRunFromExecutions(ctx: ServerRouteContext, run: TyrHeartbeatRunRecord): void {
  if (run.executionIds.length === 0) {
    if (run.startedAt && Date.now() - Date.parse(run.startedAt) >= DISPATCH_STALE_MS) {
      ctx.store.updateTyrHeartbeatRun(run.id, {
        status: "failed",
        errorCode: "heartbeat_dispatch_interrupted",
        errorMessage: "The server stopped before TYR delegated this Heartbeat run."
      });
    }
    return;
  }
  const executions = run.executionIds.map((executionId) => ctx.store.getRuntimeExecution(executionId));
  if (executions.some((execution) => !execution)) {
    ctx.store.updateTyrHeartbeatRun(run.id, {
      status: "failed",
      errorCode: "heartbeat_execution_missing",
      errorMessage: "A delegated Runtime Execution could not be found."
    });
    return;
  }
  const failed = executions.find((execution) => execution && FAILED_EXECUTION_STATUSES.has(execution.status));
  if (failed) {
    ctx.store.updateTyrHeartbeatRun(run.id, {
      status: "failed",
      selectedAgentId: failed.agentId,
      errorCode: `heartbeat_execution_${failed.status}`,
      errorMessage: `Runtime Execution ${failed.id} ended with status ${failed.status}.`
    });
    return;
  }
  if (executions.every((execution) => execution?.status === "completed")) {
    const source = run.sourceMessageId ? ctx.store.getMessage(run.sourceMessageId) : null;
    if (!source) {
      ctx.store.updateTyrHeartbeatRun(run.id, {
        status: "failed",
        errorCode: "heartbeat_source_message_missing",
        errorMessage: "The original Heartbeat request could not be found."
      });
      return;
    }
    // A completed first worker may cause TYR to delegate another worker or await a Bridge.
    // The run is terminal only after TYR posts a final result for this exact trigger.
    const terminal = ctx.store.db.prepare(`
      select json_extract(result_payload, '$.status') as status
      from messages
      where channel_id = ? and conversation_id = ? and seq > ?
        and sender_type = 'agent' and sender_id = ?
        and json_valid(result_payload)
        and json_extract(result_payload, '$.communicationRequest.sourceMessageId') = ?
        and json_extract(result_payload, '$.status') in ('completed', 'failed')
      order by seq desc limit 1
    `).get(source.channelId, source.conversationId, source.seq,
      ctx.store.getTyrHeartbeat(run.heartbeatId, run.serverId)?.tyrAgentId, source.id) as { status: string } | undefined;
    if (!terminal) return;
    ctx.store.updateTyrHeartbeatRun(run.id, terminal.status === "completed"
      ? { status: "succeeded", selectedAgentId: executions[0]?.agentId ?? null }
      : {
          status: "failed",
          selectedAgentId: executions[0]?.agentId ?? null,
          errorCode: "heartbeat_tyr_failed",
          errorMessage: "TYR reported that the Heartbeat request failed."
        });
  }
}

async function dispatchRun(ctx: ServerRouteContext, heartbeat: TyrHeartbeatRecord, run: TyrHeartbeatRunRecord): Promise<void> {
  const ownerId = ownerIdForWorkspace(ctx, heartbeat.serverId);
  if (!ownerId) {
    ctx.store.updateTyrHeartbeatRun(run.id, {
      status: "failed",
      errorCode: "heartbeat_owner_missing",
      errorMessage: "The Workspace owner could not be resolved."
    });
    return;
  }
  const tyr = ctx.store.getAgent(heartbeat.tyrAgentId);
  if (!tyr || !isCommunicationAgent(tyr)) {
    ctx.store.updateTyrHeartbeatRun(run.id, {
      status: "failed",
      errorCode: "heartbeat_tyr_missing",
      errorMessage: "The Workspace TYR Agent could not be resolved."
    });
    return;
  }
  const dm = ctx.store.getOrCreateAgentDm(tyr.id, ownerId);
  if (!dm) {
    ctx.store.updateTyrHeartbeatRun(run.id, {
      status: "failed",
      errorCode: "heartbeat_dm_unavailable",
      errorMessage: "The Workspace TYR DM is unavailable."
    });
    return;
  }

  const trigger = ctx.store.sendMessage({
    target: dm.id,
    content: heartbeatTriggerContent(heartbeat, run),
    senderType: "system",
    senderId: heartbeat.id,
    senderName: "Heartbeat",
    serverId: heartbeat.serverId
  }).message;
  ctx.emitRealtimeMessage(trigger);
  ctx.store.updateTyrHeartbeatRun(run.id, { sourceMessageId: trigger.id });
  // The common dispatch boundary interprets this verified Owner schedule and freezes
  // its route before starting a worker; the scheduler does not interpret natural language.

  if (onlineWorkerAgents(ctx, heartbeat.serverId).length === 0) {
    const errorMessage = "No child Agent is currently online on an available Device.";
    ctx.store.updateTyrHeartbeatRun(run.id, {
      status: "failed",
      errorCode: "heartbeat_agent_offline",
      errorMessage
    });
    appendFailureMessage(ctx, heartbeat, { ...run, sourceMessageId: trigger.id }, ownerId, "heartbeat_agent_offline", errorMessage);
    return;
  }

  let executionIds: string[] = [];
  let outcomeStatus: "completed" | "partial" | "failed" | "running" | undefined;
  try {
    await maybeReplyToCommunicationAgentDm(ctx, {
      message: trigger,
      agent: tyr,
      sourceContext: {
        source: "web",
        sourceConversationKey: dm.id,
        sourceEventKey: run.id,
        capabilityUserId: ownerId,
        requestingUserId: ownerId,
        systemTrigger: {
          kind: "heartbeat",
          heartbeatId: heartbeat.id,
          runId: run.id,
          scheduledFor: run.scheduledFor
        }
      },
      allowHandoff: true,
      allowSystemTrigger: true,
      onExecutionIds: (ids) => { executionIds = ids; },
      onOutcome: (outcome) => { outcomeStatus = outcome.status; }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.store.updateTyrHeartbeatRun(run.id, {
      status: "failed",
      errorCode: "heartbeat_dispatch_failed",
      errorMessage
    });
    appendFailureMessage(ctx, heartbeat, { ...run, sourceMessageId: trigger.id }, ownerId, "heartbeat_dispatch_failed", errorMessage);
    return;
  }

  if (executionIds.length === 0) {
    const errorMessage = outcomeStatus === "failed"
      ? "TYR could not delegate this Heartbeat run."
      : "TYR completed without delegating real work to a child Agent.";
    ctx.store.updateTyrHeartbeatRun(run.id, {
      status: "failed",
      sourceMessageId: trigger.id,
      errorCode: "heartbeat_no_delegation",
      errorMessage
    });
    return;
  }
  const selectedAgentId = ctx.store.getRuntimeExecution(executionIds[0])?.agentId ?? null;
  ctx.store.updateTyrHeartbeatRun(run.id, {
    executionIds,
    selectedAgentId,
    sourceMessageId: trigger.id
  });
  ctx.store.recordAuditEvent({
    kind: "tyr_heartbeat_run_delegated",
    actorType: "agent",
    actorId: tyr.id,
    resourceType: "server",
    resourceId: heartbeat.serverId,
    serverId: heartbeat.serverId,
    metadata: { heartbeatId: heartbeat.id, runId: run.id, executionIds, selectedAgentId, sourceMessageId: trigger.id }
  });
}

export function createTyrHeartbeatScheduler(
  ctx: ServerRouteContext,
  options: { tickMs?: number } = {}
): TyrHeartbeatScheduler {
  let timer: NodeJS.Timeout | null = null;
  let ticking = false;

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      ctx.store.enqueueDueTyrHeartbeatRuns();
      for (const run of ctx.store.listTyrHeartbeatRuns({ status: "running", limit: 1_000 })) {
        completeRunFromExecutions(ctx, run);
      }
      const claims = ctx.store.listTyrHeartbeats().filter((heartbeat) => heartbeat.enabled).flatMap((heartbeat) => {
        const run = ctx.store.claimNextTyrHeartbeatRun(heartbeat.id);
        return run ? [{ heartbeat, run }] : [];
      });
      // 各 Workspace 的 Heartbeat 相互独立；并行派发避免一个 TYR 的模型响应阻塞其他 Workspace。
      await Promise.all(claims.map(({ heartbeat, run }) => dispatchRun(ctx, heartbeat, run)));
    } finally {
      ticking = false;
    }
  };

  return {
    start() {
      if (timer) return;
      void tick().catch((error) => console.error("[heartbeat] initial tick failed", error));
      timer = setInterval(() => {
        void tick().catch((error) => console.error("[heartbeat] tick failed", error));
      }, options.tickMs ?? DEFAULT_TICK_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick
  };
}
