import type { TyrDb } from "@tyr-ai/db";
import type { WorkspaceBridgeRequestStatusPayload } from "@tyr-ai/contracts";

/** Only new requests participate automatically. Older business needs explicit inspection. */
export function bridgeReviewedPublicationCandidates(store: TyrDb): string[] {
  return (store.db.prepare(`select e.id from runtime_executions e
    join messages m on m.id = e.communication_return_message_id
    join cross_workspace_messages r on r.id = case when json_valid(e.communication_return_external_ref)
      then json_extract(e.communication_return_external_ref, '$.requestMessageId') end
    where e.status = 'completed' and json_valid(m.result_payload)
      and json_extract(m.result_payload, '$.status') in ('completed', 'failed')
      and r.created_at >= (select cutoff_at from bridge_publication_recovery_cutover where id = 1)
      and r.resolved_by_terminal_id is null
      and not exists (select 1 from cross_workspace_messages t where t.terminal_request_id = r.id)
    order by e.created_at limit 500`).all() as Array<{ id: string }>).map((row) => row.id);
}

/** A durable diagnostic, deduplicated until genuine progress changes. Never resumes work. */
export function recordStaleBridgeProgress(store: TyrDb, status: WorkspaceBridgeRequestStatusPayload): void {
  if (status.state !== "needs_attention" || !status.progress ||
      ["question", "action_request"].includes(status.interactions?.at(-1)?.kind ?? "")) return;
  const request = store.getCrossWorkspaceMessage(status.bridgeRequestId);
  if (!request) return;
  store.db.transaction(() => {
    const prior = store.db.prepare(`select 1 from audit_events where kind = 'workspace_bridge_progress_stale'
      and resource_id = ? and json_extract(metadata, '$.requestId') = ?
      and json_extract(metadata, '$.lastEventAt') = ?`).get(request.bridgeId, request.id, status.progress!.lastEventAt);
    if (prior) return;
    store.recordAuditEvent({ kind: "workspace_bridge_progress_stale", actorType: "system", actorId: "bridge-watchdog",
      resourceType: "workspace_bridge", resourceId: request.bridgeId, serverId: request.sourceWorkspaceId,
      metadata: { requestId: request.id, traceId: request.traceId ?? null, lastEventAt: status.progress!.lastEventAt,
        summary: status.progress!.summary, outcome: "unconfirmed", automaticallyReplayed: false } });
  })();
}
