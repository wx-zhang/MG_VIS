import { createHash, randomUUID } from "node:crypto";
import type { CrossWorkspaceMessageRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";

export interface BridgeContinuationAttempt {
  id: string;
  requestId: string;
  state: "running" | "completed" | "interrupted";
  leaseUntil: string;
  publicReplyMessageId: string | null;
  errorCode: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface BridgeContinuationStep {
  reused?: boolean;
  attemptId: string;
  sequence: number;
  toolName: string;
  toolCallId: string;
  idempotencyKey: string;
  state: "running" | "completed" | "uncertain";
  receipt: { bridgeRequestIds: string[]; executionIds: string[]; status: string } | null;
  startedAt: string;
  completedAt: string | null;
}

function rowAttempt(row: Record<string, unknown>): BridgeContinuationAttempt {
  return {
    id: String(row.id), requestId: String(row.request_id),
    state: row.state as BridgeContinuationAttempt["state"],
    leaseUntil: String(row.lease_until), publicReplyMessageId: row.public_reply_message_id ? String(row.public_reply_message_id) : null,
    errorCode: row.error_code ? String(row.error_code) : null,
    startedAt: String(row.started_at), endedAt: row.ended_at ? String(row.ended_at) : null
  };
}

function rowStep(row: Record<string, unknown>): BridgeContinuationStep {
  return {
    attemptId: String(row.attempt_id), sequence: Number(row.sequence),
    toolName: String(row.tool_name), toolCallId: String(row.tool_call_id), idempotencyKey: String(row.idempotency_key),
    state: row.state as BridgeContinuationStep["state"],
    receipt: row.receipt_json ? JSON.parse(String(row.receipt_json)) as BridgeContinuationStep["receipt"] : null,
    startedAt: String(row.started_at), completedAt: row.completed_at ? String(row.completed_at) : null
  };
}

export function claimBridgeContinuationWithJournal(store: TyrDb, requestId: string): {
  request: CrossWorkspaceMessageRecord;
  terminal: CrossWorkspaceMessageRecord;
  attempt: BridgeContinuationAttempt;
} | null {
  return store.db.transaction(() => {
    const claimed = store.claimCrossWorkspaceContinuation(requestId);
    if (!claimed) return null;
    const id = `bca_${randomUUID().replaceAll("-", "")}`;
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + 5 * 60_000).toISOString();
    store.db.prepare(`insert into bridge_continuation_attempts
      (id, request_id, state, lease_until, started_at) values (?, ?, 'running', ?, ?)`)
      .run(id, requestId, leaseUntil, now.toISOString());
    return { ...claimed, attempt: getBridgeContinuationAttempt(store, id)! };
  })();
}

export function getBridgeContinuationAttempt(store: TyrDb, id: string): BridgeContinuationAttempt | null {
  const row = store.db.prepare("select * from bridge_continuation_attempts where id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowAttempt(row) : null;
}

export function listBridgeContinuationAttempts(store: TyrDb, requestId: string): BridgeContinuationAttempt[] {
  return (store.db.prepare("select * from bridge_continuation_attempts where request_id = ? order by started_at, id")
    .all(requestId) as Record<string, unknown>[]).map(rowAttempt);
}

export function listBridgeContinuationSteps(store: TyrDb, attemptId: string): BridgeContinuationStep[] {
  return (store.db.prepare("select * from bridge_continuation_steps where attempt_id = ? order by sequence")
    .all(attemptId) as Record<string, unknown>[]).map(rowStep);
}

export function beginBridgeContinuationWriteStep(store: TyrDb, input: {
  attemptId: string;
  toolName: string;
  toolCallId: string;
  externalIdempotencyKey?: string;
}): BridgeContinuationStep {
  return store.db.transaction(() => {
    const attempt = getBridgeContinuationAttempt(store, input.attemptId);
    if (!attempt || attempt.state !== "running") throw new Error("bridge_continuation_attempt_not_running");
    const idempotencyKey = input.externalIdempotencyKey ?? createHash("sha256")
      .update(`${attempt.requestId}:${input.toolName}:${input.toolCallId}`)
      .digest("hex");
    const prior = store.db.prepare("select * from bridge_continuation_steps where attempt_id = ? and idempotency_key = ?")
      .get(input.attemptId, idempotencyKey) as Record<string, unknown> | undefined;
    if (prior) return { ...rowStep(prior), reused: true };
    const sequence = Number(store.db.prepare("select coalesce(max(sequence), 0) + 1 from bridge_continuation_steps where attempt_id = ?")
      .pluck().get(input.attemptId));
    store.db.prepare(`insert into bridge_continuation_steps
      (attempt_id, sequence, tool_name, tool_call_id, idempotency_key, state, started_at)
      values (?, ?, ?, ?, ?, 'running', ?)`).run(
        input.attemptId, sequence, input.toolName, input.toolCallId, idempotencyKey, new Date().toISOString()
      );
    return listBridgeContinuationSteps(store, input.attemptId).at(-1)!;
  })();
}

export function finishBridgeContinuationWriteStep(store: TyrDb, step: BridgeContinuationStep, input: {
  state: "completed" | "uncertain";
  receipt?: BridgeContinuationStep["receipt"];
}): void {
  store.db.prepare(`update bridge_continuation_steps
    set state = ?, receipt_json = ?, completed_at = ?
    where attempt_id = ? and sequence = ? and state = 'running'`).run(
      input.state, input.receipt ? JSON.stringify(input.receipt) : null, new Date().toISOString(), step.attemptId, step.sequence
    );
}

export function finishBridgeContinuationAttempt(store: TyrDb, attemptId: string, input: {
  state: "completed" | "interrupted";
  publicReplyMessageId: string | null;
  errorCode?: string;
}): void {
  store.db.transaction(() => {
    const attempt = getBridgeContinuationAttempt(store, attemptId);
    if (!attempt || attempt.state !== "running") return;
    const now = new Date().toISOString();
    store.db.prepare(`update bridge_continuation_attempts
      set state = ?, public_reply_message_id = ?, error_code = ?, ended_at = ? where id = ? and state = 'running'`)
      .run(input.state, input.publicReplyMessageId, input.errorCode ?? null, now, attemptId);
    if (input.state === "completed") {
      store.completeCrossWorkspaceContinuation(attempt.requestId, input.publicReplyMessageId);
    } else {
      store.db.prepare("update cross_workspace_messages set continuation_state = 'interrupted', updated_at = ? where id = ? and continuation_state = 'running'")
        .run(now, attempt.requestId);
    }
  })();
}

export function interruptRunningBridgeContinuationAttempts(store: TyrDb): void {
  const now = new Date().toISOString();
  store.db.prepare("update bridge_continuation_attempts set state = 'interrupted', error_code = 'server_restarted', ended_at = ? where state = 'running'")
    .run(now);
  store.db.prepare("update bridge_continuation_steps set state = 'uncertain', completed_at = ? where state = 'running'")
    .run(now);
}

export function retryInterruptedBridgeContinuationWithoutWrites(store: TyrDb, requestId: string): boolean {
  return store.db.transaction(() => {
    const request = store.getCrossWorkspaceMessage(requestId);
    if (!request || request.continuationState !== "interrupted") return false;
    const writes = store.db.prepare(`select 1 from bridge_continuation_steps step
      join bridge_continuation_attempts attempt on attempt.id = step.attempt_id
      where attempt.request_id = ? limit 1`).get(requestId);
    if (writes) return false;
    return store.db.prepare("update cross_workspace_messages set continuation_state = 'pending', updated_at = ? where id = ? and continuation_state = 'interrupted'")
      .run(new Date().toISOString(), requestId).changes === 1;
  })();
}
