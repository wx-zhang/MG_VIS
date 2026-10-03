import type { TyrDb } from "@tyr-ai/db";
import type { CommunicationAgentSourceContext } from "./communication-agent-source";
import { getMcpPersistence } from "./mcp-persistence";

/** Reconstruct authority from the immutable inbound message, never the active conversation or worker text. */
export function restoreMcpCommunicationAuthority(store: TyrDb, input: {
  sourceMessageId: string;
  userId: string;
  serverId: string;
  channelId: string;
  conversationId?: string;
  sourceContext: CommunicationAgentSourceContext;
}): CommunicationAgentSourceContext {
  const base = input.sourceContext;
  // An inbound peer hop executes with the destination Owner capability, independently of the original MCP grant.
  if (base.accessMode === "workspace_bridge") return base;
  const persistence = getMcpPersistence(store);
  const knownMcp = base.source === "mcp" || Boolean(base.mcpAuthorityMessageId) ||
    persistence.hasContinuationAuthority(input.sourceMessageId) || Boolean(base.externalRef?.startsWith("mcp_op_")) ||
    // A legacy operation can predate the ingress audit; this identifies its origin, never its permissions.
    Boolean(store.db.prepare(`select 1 from mcp_operations where server_id = ? and user_id = ?
      and inbound_message_id = ? limit 1`).get(input.serverId, input.userId, input.sourceMessageId)) ||
    // Older handoffs used the Web delivery label. Their authenticated ingress audit still identifies the origin.
    Boolean(store.db.prepare(`select 1 from audit_events where kind = 'mcp_tyr_assistant_request'
      and server_id = ? and json_valid(metadata) and json_extract(metadata, '$.inboundMessageId') = ? limit 1`)
      .get(input.serverId, input.sourceMessageId));
  if (!knownMcp) return base;
  const resolved = base.mcpAuthorityMessageId && base.mcpAuthorityMessageId !== input.sourceMessageId
    ? { status: "invalid" as const, errorCode: "mcp_authorization_context_invalid" as const, hasContext: false, sourceContext: undefined }
    : persistence.resolveContinuationAuthority({
    sourceMessageId: input.sourceMessageId,
    userId: input.userId,
    serverId: input.serverId,
    channelId: input.channelId,
    conversationId: input.conversationId ?? "",
    ...(base.externalRef?.startsWith("mcp_op_") ? { operationId: base.externalRef } : {})
  });
  if (resolved.status === "invalid") {
    // Record one stable diagnosis per callback, including model-free completed-result presentation.
    const existing = store.db.prepare(`select 1 from audit_events where kind = 'mcp_continuation_authorization_failed'
      and server_id = ? and actor_id = ? and json_valid(metadata)
      and json_extract(metadata, '$.sourceMessageId') = ?
      and json_extract(metadata, '$.sourceEventKey') = ? and json_extract(metadata, '$.errorCode') = ? limit 1`)
      .get(input.serverId, input.userId, input.sourceMessageId, base.sourceEventKey, resolved.errorCode);
    if (!existing) store.recordAuditEvent({
      kind: "mcp_continuation_authorization_failed", actorType: "user", actorId: input.userId,
      resourceType: input.sourceMessageId ? "message" : "server",
      resourceId: input.sourceMessageId || input.serverId, serverId: input.serverId,
      metadata: {
        sourceMessageId: input.sourceMessageId, sourceEventKey: base.sourceEventKey,
        operationId: resolved.sourceContext?.externalRef ?? null,
        grantId: resolved.sourceContext?.grantId ?? null, errorCode: resolved.errorCode
      }
    });
  }
  return {
    ...base,
    ...(resolved.sourceContext ?? { source: "mcp" as const, grantedScopes: [] }),
    // Each callback keeps its own idempotency key while sharing only the original request's authority.
    sourceEventKey: base.sourceEventKey,
    mcpAuthorityMessageId: input.sourceMessageId,
    mcpAuthorizationError: resolved.status === "invalid" ? resolved.errorCode : undefined
  };
}

export function mcpAuthorizationFailureMessage(code: string): string {
  if (code === "mcp_authorization_grant_invalid") {
    return "The original MCP authorization is no longer valid. Completed results are preserved; new tool actions require a valid authorization.";
  }
  return "TYR could not restore the original MCP authorization for this request. Completed results are preserved; start a new authorized request to continue.";
}
