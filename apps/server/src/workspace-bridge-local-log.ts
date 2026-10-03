import type { WorkspaceBridgeLocalExecutionLog } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import { sanitizeHumanVisibleValue } from "./output-disclosure";

/** Deliberately separate from channel access and from Bridge execution capabilities. */
export function workspaceBridgeLocalExecutionLog(store: TyrDb, input: {
  userId: string; serverId: string; bridgeId: string; requestId: string; offset?: number; limit?: number;
}): WorkspaceBridgeLocalExecutionLog | null {
  const workspace = store.listServersForUser(input.userId).find((server) => server.id === input.serverId);
  const request = store.getCrossWorkspaceMessage(input.requestId);
  const bridge = store.getWorkspaceBridgeForServer(input.bridgeId, input.serverId);
  const channel = bridge ? store.getWorkspaceBridgeDm(bridge.id, input.serverId) : null;
  if (!workspace || workspace.role !== "owner" || workspace.ownerId !== input.userId || !bridge || !request ||
      request.bridgeId !== bridge.id || request.targetWorkspaceId !== input.serverId || request.responseKind ||
      request.replyToMessageId || request.targetCapabilityUserId !== input.userId || !channel ||
      !request.conversationId || store.getConversation(request.conversationId)?.channelId !== channel.id) return null;

  const params = { requestId: request.id, serverId: input.serverId, userId: input.userId,
    bridgeId: bridge.id, channelId: channel.id, conversationId: request.conversationId };
  // Follow server-owned request bindings, never Agent names, time proximity, or an entire trace.
  // A chained Workspace's executions cannot enter this recursive local delegation tree.
  const scope = `with recursive sources(id) as (
      select peer_message_id from cross_workspace_messages where id = @requestId
      union select peer_message_id from cross_workspace_messages where reply_to_message_id = @requestId
        and target_workspace_id = @serverId and response_kind in ('answer', 'instruction', 'continue')
    ), local_executions(id) as (
      select r.id from runtime_executions r join agents a on a.id = r.agent_id
      where r.server_id = @serverId and a.server_id = @serverId and a.owner_user_id = @userId
        and r.communication_return_user_id = @userId and r.communication_return_channel_id = @channelId
        and r.communication_return_conversation_id = @conversationId
        and r.communication_return_source_message_id in (select id from sources)
        and case when json_valid(r.communication_return_external_ref) then
          json_extract(r.communication_return_external_ref, '$.kind') = 'workspace_bridge'
          and json_extract(r.communication_return_external_ref, '$.requestMessageId') = @requestId
          and json_extract(r.communication_return_external_ref, '$.bridgeId') = @bridgeId
          and json_extract(r.communication_return_external_ref, '$.targetWorkspaceId') = @serverId
        else 0 end
      union select child.id from runtime_executions child join local_executions parent on child.source_execution_id = parent.id
        join agents a on a.id = child.agent_id
        where child.server_id = @serverId and a.server_id = @serverId and a.owner_user_id = @userId
    )`;
  const rows = store.db.prepare(`${scope} select r.id, r.agent_display_name, r.agent_name, r.status, r.created_at,
      r.completed_at, r.communication_return_instructions_revision from runtime_executions r
      join local_executions e on e.id = r.id order by r.created_at, r.id`).all(params) as Array<{
        id: string; agent_display_name: string; agent_name: string; status: WorkspaceBridgeLocalExecutionLog["executions"][number]["status"];
        created_at: string; completed_at: string | null; communication_return_instructions_revision: number | null;
      }>;
  const entries = `${scope}, entries as (
    select 'request:' || id as id, 'request' as kind, 'Incoming request' as title, created_at as at,
      null as execution_id, content, null as data from cross_workspace_messages where id = @requestId
    union all
    select 'handoff:' || r.id, 'handoff', 'Local delegation instruction', r.created_at, r.id, m.content, null
      from runtime_executions r join local_executions e on e.id = r.id join messages m on m.id = r.message_id
      join channels c on c.id = m.channel_id where c.server_id = @serverId
    union all
    select 'instructions:' || r.id, 'instructions', 'Saved Owner instructions', r.created_at, r.id,
      r.communication_return_instructions, null from runtime_executions r join local_executions e on e.id = r.id
      where r.communication_return_instructions is not null and trim(r.communication_return_instructions) <> ''
    union all
    select 'event:' || v.execution_id || ':' || printf('%012d', v.sequence), v.kind, coalesce(v.title, v.kind), v.at, v.execution_id, v.detail, v.payload
      from runtime_execution_events v join local_executions e on e.id = v.execution_id
    union all
    select 'ipc:' || v.id, 'worker_report', 'Worker report: ' || v.kind, v.created_at, v.source_execution_id,
      v.content, v.facts_json from communication_return_events v join local_executions e on e.id = v.source_execution_id
    union all
    select distinct 'final:' || m.id, 'worker_final', 'Saved final Worker reply', m.created_at, r.id, m.content, m.result_payload
      from runtime_executions r join local_executions e on e.id = r.id
      join messages handoff on handoff.id = r.message_id
      join messages m on m.sender_type = 'agent' and m.sender_id = r.agent_id and m.channel_id = handoff.channel_id
      where m.deleted_at is null and (m.source_execution_id = r.id or (m.source_execution_id is null and exists (
        select 1 from runtime_execution_events v where v.execution_id = r.id and v.kind = 'diagnostic'
          and v.title = 'Final reply received' and case when json_valid(v.payload)
            then json_extract(v.payload, '$.finalMessageId') = m.id else 0 end)))
    union all
    select 'approval:' || v.id, 'approval', 'Approval: ' || v.status, coalesce(v.resolved_at, v.requested_at), v.execution_id,
      v.detail, json_object('title', v.title, 'status', v.status, 'decision', v.decision,
        'resolvedByUserId', v.resolved_by_user_id) from runtime_approvals v join local_executions e on e.id = v.execution_id
      where v.server_id = @serverId
    union all
    select 'evidence:' || v.receipt_id, 'evidence', 'Registered evidence', v.created_at, v.source_execution_id,
      v.receipt_id, v.facts_json from communication_evidence_sources v join local_executions e on e.id = v.source_execution_id
      where v.server_id = @serverId
    union all
    select 'review:' || m.id, 'review', 'TYR reviewed result', m.created_at, null, m.content, m.result_payload
      from messages m where m.id in (select r.communication_return_message_id from runtime_executions r
        join local_executions e on e.id = r.id) and m.channel_id = @channelId and m.conversation_id = @conversationId
    union all
    select 'audit:' || v.id, 'evidence_selection', 'TYR evidence selection', v.created_at, null, null, v.metadata
      from audit_events v where v.kind = 'communication_evidence_selection' and v.server_id = @serverId
        and v.resource_type = 'message' and v.resource_id in (select id from sources)
    union all
    select 'reply:' || id, 'bridge_reply', 'Shared reply: ' || response_kind, created_at, null, content, null
      from cross_workspace_messages where reply_to_message_id = @requestId and source_workspace_id = @serverId
  )`;
  const limit = boundedInteger(input.limit, 100, 1, 200);
  const offset = boundedInteger(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const total = Number(store.db.prepare(`${entries} select count(*) from entries`).pluck().get(params));
  const page = store.db.prepare(`${entries} select * from entries order by at, id limit @limit offset @offset`)
    .all({ ...params, limit, offset }) as Array<{
      id: string; kind: string; title: string; at: string; execution_id: string | null; content: string | null; data: string | null;
    }>;
  return sanitizeHumanVisibleValue({
    requestId: request.id, diagnosticId: request.traceId ?? request.id,
    executions: rows.map((r) => ({ id: r.id, agentName: r.agent_display_name || r.agent_name, status: r.status,
      createdAt: r.created_at, ...(r.completed_at ? { completedAt: r.completed_at } : {}),
      ...(r.communication_return_instructions_revision != null ? { instructionsRevision: r.communication_return_instructions_revision } : {}) })),
    entries: page.map((r) => ({ id: r.id, kind: r.kind, title: r.title, at: r.at,
      ...(r.execution_id ? { executionId: r.execution_id } : {}), ...(r.content ? { content: r.content } : {}),
      ...(r.data ? { data: parseData(r.data) } : {}) })),
    pageInfo: { offset, limit, total, hasMore: offset + page.length < total }
  });
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.min(max, Math.max(min, Math.trunc(value)));
}
function parseData(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}
