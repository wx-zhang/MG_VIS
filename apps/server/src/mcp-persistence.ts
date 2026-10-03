import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Response } from "express";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  McpPersonalAccessTokenExpirationDays,
  McpPersonalAccessTokenRecord,
  McpPersonalAccessTokenScope,
  ConversationRecord
} from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";

export const MCP_SCOPES = [
  "tyr:read",
  "tyr:manage",
  "tyr:bridge:read",
  "tyr:bridge:send"
] as const;
const DEFAULT_MCP_SCOPES = ["tyr:read", "tyr:manage"] as const;
export const MCP_PERSONAL_ACCESS_TOKEN_PREFIX = "tyr_pat_";
export const MCP_PERSONAL_ACCESS_TOKEN_EXPIRATION_DAYS = [30, 90, 365] as const;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;
const LOGIN_TICKET_TTL_MS = 5 * 60 * 1000;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const EXPIRED_OAUTH_DATA_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PERSONAL_ACCESS_TOKEN_LAST_USED_WRITE_INTERVAL_MS = 15 * 60 * 1000;
const MAX_ACTIVE_PERSONAL_ACCESS_TOKENS = 10;

export interface McpOperationRecord {
  id: string;
  userId: string;
  serverId: string;
  clientId: string;
  grantId: string;
  kind: "query" | "request";
  sourceConversationKey: string;
  /** MCP Operation 创建时绑定的真实 TYR conversation；后续轮次不能随 Web 当前会话漂移。 */
  conversationId?: string;
  /** 服务端内部输入轮次；同一 operation 的 continuation 按接收顺序单调递增。 */
  currentTurnSequence: number;
  /** 当前输入在 TYR 外部通道中的稳定事件关联键。 */
  currentSourceEventKey?: string;
  prompt: string;
  inboundMessageId?: string;
  assistantReplyMessageId?: string;
  managementDraftId?: string;
  executionIds: string[];
  bridgeRequestIds: string[];
  /** 完整历史继续用于诊断，顶层状态和回复只读取当前轮资源。 */
  currentExecutionIds: string[];
  currentBridgeRequestIds: string[];
  responseText?: string;
  resultMetadata?: McpOperationResultMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface McpOperationErrorMetadata {
  code: string;
  requiredTool?: string;
  requiredScope?: string;
  /** 客户端必须先取得用户对 Action 模式的明确确认，服务端不会从 query 静默提权。 */
  actionModeRequired?: boolean;
  /** query 与 request 的安全语义不可变；切换工具时不得复用被拦截的 query operation。 */
  newOperationRequired?: boolean;
  blockedTool?: string;
}

export interface McpOperationResultMetadata {
  error?: McpOperationErrorMetadata;
  /** Assistant 自身终态与 execution/Bridge 聚合分开持久化，避免无副作用超时被误报 completed。 */
  assistantOutcomeStatus?: "completed" | "partial" | "failed" | "running";
}

export interface McpAuthorizationRequestRecord {
  id: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  state?: string;
  scopes: string[];
  resource: string;
  expiresAt: number;
}

export type McpContinuationAuthorizationErrorCode =
  | "mcp_authorization_context_missing"
  | "mcp_authorization_context_invalid"
  | "mcp_authorization_grant_invalid";

export interface McpContinuationAuthorityInput {
  operationId: string;
  sourceMessageId: string;
  userId: string;
  serverId: string;
  conversationId: string;
  clientId: string;
  grantId: string;
  grantedScopes: string[];
  accessMode: "read_only" | "manage";
  sourceConversationKey: string;
}

export interface McpContinuationAuthorityRecord extends McpContinuationAuthorityInput {
  channelId: string;
  resource: string;
  createdAt: string;
}

export interface McpContinuationSourceContext {
  source: "mcp";
  sourceConversationKey: string;
  externalRef: string;
  clientId: string;
  grantId: string;
  grantedScopes: string[];
  accessMode: "read_only" | "manage";
}

export interface McpContinuationAuthorityResolveInput {
  sourceMessageId: string;
  userId: string;
  serverId: string;
  channelId: string;
  conversationId: string;
  operationId?: string;
}

export type McpContinuationAuthorityResult =
  | { status: "restored"; sourceContext: McpContinuationSourceContext }
  | {
      status: "invalid";
      errorCode: McpContinuationAuthorizationErrorCode;
      hasContext: boolean;
      /** 已验证的原身份可用于呈现已完成结果；失效授权永远不恢复可执行 scopes。 */
      sourceContext?: McpContinuationSourceContext;
    };

const mcpPersistenceByStore = new WeakMap<TyrDb, McpPersistence>();

/** 常驻实例复用，避免每次工具/续接重新迁移 schema 或清理 OAuth 凭据。 */
export function getMcpPersistence(store: TyrDb): McpPersistence {
  return mcpPersistenceByStore.get(store) ?? new McpPersistence(store);
}

function rowContinuationAuthority(row: any): McpContinuationAuthorityRecord {
  return {
    operationId: row.operation_id,
    sourceMessageId: row.source_message_id,
    userId: row.user_id,
    serverId: row.server_id,
    conversationId: row.conversation_id,
    channelId: row.channel_id,
    clientId: row.client_id,
    grantId: row.grant_id,
    grantedScopes: scopesFromJson(row.scopes_json),
    accessMode: row.access_mode,
    sourceConversationKey: row.source_conversation_key,
    resource: row.resource,
    createdAt: row.created_at
  };
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function opaqueToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  // 保持既有 MCP 默认权限；Bridge scopes 永远需要客户端显式申请并重新授权。
  const requested = scopes?.length ? scopes : [...DEFAULT_MCP_SCOPES];
  const normalized = [...new Set(requested.filter(Boolean))];
  if (normalized.some((scope) => !MCP_SCOPES.includes(scope as (typeof MCP_SCOPES)[number]))) {
    throw new InvalidScopeError("Requested scope is not supported by TYR.");
  }
  if (!normalized.includes("tyr:read")) normalized.unshift("tyr:read");
  return normalized;
}

function scopesRequireWorkspaceMember(scopes: readonly string[]): boolean {
  return scopes.some((scope) => scope === "tyr:manage" || scope.startsWith("tyr:bridge:"));
}

function scopesFromJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function operationResultMetadataFromJson(value: unknown): McpOperationResultMetadata | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed = JSON.parse(value) as { error?: Record<string, unknown>; assistantOutcomeStatus?: unknown };
    const assistantOutcomeStatus = parsed.assistantOutcomeStatus;
    const normalizedStatus = assistantOutcomeStatus === "completed" || assistantOutcomeStatus === "partial" || assistantOutcomeStatus === "failed" || assistantOutcomeStatus === "running"
      ? assistantOutcomeStatus
      : undefined;
    const error = parsed.error && typeof parsed.error.code === "string"
      ? {
          code: parsed.error.code,
          ...(typeof parsed.error.requiredTool === "string" ? { requiredTool: parsed.error.requiredTool } : {}),
          ...(typeof parsed.error.requiredScope === "string" ? { requiredScope: parsed.error.requiredScope } : {}),
          ...(parsed.error.actionModeRequired === true ? { actionModeRequired: true } : {}),
          ...(parsed.error.newOperationRequired === true ? { newOperationRequired: true } : {}),
          ...(typeof parsed.error.blockedTool === "string" ? { blockedTool: parsed.error.blockedTool } : {})
        }
      : undefined;
    if (!error && !normalizedStatus) return undefined;
    return {
      ...(error ? { error } : {}),
      ...(normalizedStatus ? { assistantOutcomeStatus: normalizedStatus } : {})
    };
  } catch {
    // 历史或异常 metadata 不得阻断 operation/status 读取，未知内容按无结构化结果处理。
    return undefined;
  }
}

function personalAccessTokenRecord(row: any): McpPersonalAccessTokenRecord {
  return {
    id: row.id,
    name: row.name,
    userId: row.user_id,
    serverId: row.server_id,
    tokenPrefix: row.token_prefix,
    scopes: scopesFromJson(row.scopes_json) as McpPersonalAccessTokenScope[],
    resource: row.resource,
    expiresAt: new Date(row.expires_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    revokedAt: row.revoked_at ?? null,
    createdAt: row.created_at
  };
}

/** 返回已允许 OAuth redirect 的 origin，供注册校验与 consent CSP 共用同一安全边界。 */
export function mcpClientRedirectOrigin(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.hash || url.username || url.password) return null;
    if (url.protocol === "https:") return url.origin;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function safeClientRedirect(uri: string): boolean {
  return mcpClientRedirectOrigin(uri) !== null;
}

function rowOperation(row: any): McpOperationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    serverId: row.server_id,
    clientId: row.client_id,
    grantId: row.grant_id,
    kind: row.kind,
    sourceConversationKey: row.source_conversation_key,
    conversationId: row.conversation_id ?? undefined,
    currentTurnSequence: Number(row.current_turn_sequence ?? 0),
    currentSourceEventKey: row.current_source_event_key ?? undefined,
    prompt: row.prompt,
    inboundMessageId: row.inbound_message_id ?? undefined,
    assistantReplyMessageId: row.assistant_reply_message_id ?? undefined,
    managementDraftId: row.management_draft_id ?? undefined,
    executionIds: scopesFromJson(row.execution_ids_json),
    bridgeRequestIds: scopesFromJson(row.bridge_request_ids_json),
    currentExecutionIds: scopesFromJson(row.current_execution_ids_json),
    currentBridgeRequestIds: scopesFromJson(row.current_bridge_request_ids_json),
    responseText: row.response_text ?? undefined,
    resultMetadata: operationResultMetadataFromJson(row.result_metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** MCP/OAuth 数据独立于聊天真源，但所有业务引用仍指向 Tyr 的 message/draft/execution。 */
export class McpPersistence {
  private lastExpiredOAuthDataPurgeAt = 0;

  constructor(readonly store: TyrDb) {
    this.ensureSchema();
    this.purgeExpiredOAuthData();
    mcpPersistenceByStore.set(store, this);
  }

  private ensureSchema(): void {
    this.store.db.exec(`
      create table if not exists mcp_oauth_clients (
        client_id text primary key,
        client_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists mcp_oauth_authorization_requests (
        id text primary key,
        client_id text not null,
        redirect_uri text not null,
        state text,
        scopes_json text not null,
        code_challenge text not null,
        resource text not null,
        status text not null,
        expires_at integer not null,
        created_at text not null
      );
      create table if not exists mcp_oauth_login_tickets (
        ticket_hash text primary key,
        request_id text not null,
        user_id text not null,
        expires_at integer not null,
        consumed_at text,
        created_at text not null
      );
      create table if not exists mcp_oauth_codes (
        code_hash text primary key,
        client_id text not null,
        user_id text not null,
        server_id text not null,
        scopes_json text not null,
        code_challenge text not null,
        redirect_uri text not null,
        resource text not null,
        expires_at integer not null,
        consumed_at text,
        created_at text not null
      );
      create table if not exists mcp_oauth_tokens (
        token_hash text primary key,
        token_kind text not null,
        family_id text not null,
        client_id text not null,
        user_id text not null,
        server_id text not null,
        scopes_json text not null,
        resource text not null,
        expires_at integer not null,
        revoked_at text,
        created_at text not null
      );
      create index if not exists idx_mcp_oauth_tokens_family on mcp_oauth_tokens(family_id);
      create table if not exists mcp_personal_access_tokens (
        id text primary key,
        token_hash text not null unique,
        token_prefix text not null,
        name text not null,
        user_id text not null,
        server_id text not null,
        scopes_json text not null,
        resource text not null,
        expires_at integer not null,
        last_used_at integer,
        revoked_at text,
        created_at text not null
      );
      create index if not exists idx_mcp_personal_access_tokens_owner
        on mcp_personal_access_tokens(user_id, server_id, created_at);
      create table if not exists mcp_operations (
        id text primary key,
        user_id text not null,
        server_id text not null,
        client_id text not null,
        grant_id text not null,
        kind text not null,
        initial_idempotency_key text not null,
        source_conversation_key text not null,
        conversation_id text,
        current_turn_sequence integer not null default 0,
        current_source_event_key text,
        prompt text not null,
        inbound_message_id text,
        assistant_reply_message_id text,
        management_draft_id text,
        execution_ids_json text not null default '[]',
        bridge_request_ids_json text not null default '[]',
        current_execution_ids_json text not null default '[]',
        current_bridge_request_ids_json text not null default '[]',
        response_text text,
        result_metadata_json text,
        created_at text not null,
        updated_at text not null
      );
      create unique index if not exists idx_mcp_operations_initial_event
        on mcp_operations(user_id, server_id, client_id, grant_id, kind, initial_idempotency_key);
      create table if not exists mcp_operation_submissions (
        operation_id text not null references mcp_operations(id),
        idempotency_key text not null,
        turn_sequence integer not null,
        message_id text not null references messages(id),
        payload_hash text not null,
        state text not null,
        error_code text,
        notice_message_id text references messages(id),
        created_at text not null,
        updated_at text not null,
        primary key (operation_id, idempotency_key),
        unique (operation_id, turn_sequence)
      );
      create index if not exists idx_mcp_submission_dispatch on mcp_operation_submissions(state, created_at);
      create table if not exists mcp_conversation_starts (
        user_id text not null,
        server_id text not null,
        client_id text not null,
        grant_id text not null,
        idempotency_key text not null,
        conversation_id text not null,
        created_at text not null,
        primary key (user_id, server_id, client_id, grant_id, idempotency_key)
      );
      create index if not exists idx_mcp_conversation_starts_conversation
        on mcp_conversation_starts(conversation_id);
      create table if not exists mcp_continuation_authorities (
        source_message_id text primary key,
        operation_id text not null,
        user_id text not null,
        server_id text not null,
        channel_id text not null,
        conversation_id text not null,
        client_id text not null,
        grant_id text not null,
        scopes_json text not null,
        access_mode text not null check(access_mode in ('read_only', 'manage')),
        source_conversation_key text not null,
        resource text not null,
        created_at text not null
      );
      create index if not exists idx_mcp_continuation_authorities_operation
        on mcp_continuation_authorities(operation_id);
      create table if not exists mcp_operation_events (
        operation_id text not null,
        idempotency_key text not null,
        turn_sequence integer not null,
        created_at text not null,
        primary key (operation_id, idempotency_key)
      );
    `);
    const operationColumns = this.store.db.prepare("pragma table_info(mcp_operations)").all() as Array<{ name: string }>;
    if (!operationColumns.some((column) => column.name === "result_metadata_json")) {
      // 结构化 operation 结果使用应用内 better-sqlite3 做增量迁移，不依赖生产机可能过旧的 sqlite3 CLI。
      this.store.db.exec("alter table mcp_operations add column result_metadata_json text");
    }
    if (!operationColumns.some((column) => column.name === "bridge_request_ids_json")) {
      this.store.db.exec("alter table mcp_operations add column bridge_request_ids_json text not null default '[]'");
    }
    if (!operationColumns.some((column) => column.name === "conversation_id")) {
      this.store.db.exec("alter table mcp_operations add column conversation_id text");
    }
    // 历史 Operation 优先从已经落库的入站消息恢复真实 conversation，避免升级后的 continuation 跟随 Web 当前指针漂移。
    this.store.db.exec(`
      update mcp_operations
      set conversation_id = (
        select messages.conversation_id
        from messages
        where messages.id = mcp_operations.inbound_message_id
      )
      where conversation_id is null and inbound_message_id is not null
    `);
    const addedCurrentTurnSequence = !operationColumns.some((column) => column.name === "current_turn_sequence");
    const addedCurrentSourceEventKey = !operationColumns.some((column) => column.name === "current_source_event_key");
    const addedCurrentExecutionIds = !operationColumns.some((column) => column.name === "current_execution_ids_json");
    const addedCurrentBridgeRequestIds = !operationColumns.some((column) => column.name === "current_bridge_request_ids_json");
    if (addedCurrentTurnSequence) {
      this.store.db.exec("alter table mcp_operations add column current_turn_sequence integer not null default 0");
    }
    if (addedCurrentSourceEventKey) {
      this.store.db.exec("alter table mcp_operations add column current_source_event_key text");
    }
    if (addedCurrentExecutionIds) {
      this.store.db.exec("alter table mcp_operations add column current_execution_ids_json text not null default '[]'");
      // 已有 operation 没有轮次边界，迁移时先把原聚合资源视为当前轮，避免状态读取行为突变。
      this.store.db.exec("update mcp_operations set current_execution_ids_json = execution_ids_json");
    }
    if (addedCurrentBridgeRequestIds) {
      this.store.db.exec("alter table mcp_operations add column current_bridge_request_ids_json text not null default '[]'");
      this.store.db.exec("update mcp_operations set current_bridge_request_ids_json = bridge_request_ids_json");
    }

    const eventColumns = this.store.db.prepare("pragma table_info(mcp_operation_events)").all() as Array<{ name: string }>;
    if (!eventColumns.some((column) => column.name === "turn_sequence")) {
      this.store.db.exec("alter table mcp_operation_events add column turn_sequence integer");
      const events = this.store.db.prepare(
        "select rowid, operation_id from mcp_operation_events order by operation_id, created_at, rowid"
      ).all() as Array<{ rowid: number; operation_id: string }>;
      const updateEvent = this.store.db.prepare("update mcp_operation_events set turn_sequence = ? where rowid = ?");
      const backfill = this.store.db.transaction(() => {
        let operationId = "";
        let sequence = 0;
        for (const event of events) {
          if (event.operation_id !== operationId) {
            operationId = event.operation_id;
            sequence = 0;
          }
          updateEvent.run(++sequence, event.rowid);
        }
      });
      backfill();
    }
    this.store.db.exec(
      "create unique index if not exists idx_mcp_operation_events_turn on mcp_operation_events(operation_id, turn_sequence)"
    );
    if (addedCurrentTurnSequence || addedCurrentSourceEventKey) {
      const latestEvents = this.store.db.prepare(
        "select operation_id, idempotency_key, turn_sequence from mcp_operation_events order by operation_id, turn_sequence"
      ).all() as Array<{ operation_id: string; idempotency_key: string; turn_sequence: number }>;
      const updateOperationTurn = this.store.db.prepare(
        "update mcp_operations set current_turn_sequence = ?, current_source_event_key = ? where id = ?"
      );
      for (const event of latestEvents) {
        updateOperationTurn.run(
          event.turn_sequence,
          `mcp:${event.operation_id}:${event.idempotency_key}`,
          event.operation_id
        );
      }
    }
  }

  /** 删除已经失效的短期 OAuth 凭据，保留 client、grant operation 和业务审计记录。 */
  purgeExpiredOAuthData(now = Date.now()): number {
    const purge = this.store.db.transaction(() => {
      const tickets = this.store.db.prepare("delete from mcp_oauth_login_tickets where expires_at <= ?").run(now).changes;
      const codes = this.store.db.prepare("delete from mcp_oauth_codes where expires_at <= ?").run(now).changes;
      const tokens = this.store.db.prepare("delete from mcp_oauth_tokens where expires_at <= ?").run(now).changes;
      const requests = this.store.db.prepare("delete from mcp_oauth_authorization_requests where expires_at <= ?").run(now).changes;
      return tickets + codes + tokens + requests;
    });
    const removed = purge.immediate();
    this.lastExpiredOAuthDataPurgeAt = now;
    return removed;
  }

  /** OAuth/MCP 请求触发轻量维护，避免常驻单实例依赖额外定时任务。 */
  maybePurgeExpiredOAuthData(now = Date.now()): number {
    if (now - this.lastExpiredOAuthDataPurgeAt < EXPIRED_OAUTH_DATA_PURGE_INTERVAL_MS) return 0;
    return this.purgeExpiredOAuthData(now);
  }

  listPersonalAccessTokens(userId: string, serverId: string): McpPersonalAccessTokenRecord[] {
    const rows = this.store.db.prepare(
      `select * from mcp_personal_access_tokens
       where user_id = ? and server_id = ? and revoked_at is null
       order by created_at desc, rowid desc`
    ).all(userId, serverId) as any[];
    // 撤销记录只留在数据库和审计中，不再作为可管理凭据返回给用户。
    return rows.map(personalAccessTokenRecord);
  }

  createPersonalAccessToken(input: {
    userId: string;
    serverId: string;
    name: string;
    scopes: McpPersonalAccessTokenScope[];
    expirationDays: McpPersonalAccessTokenExpirationDays;
    resource: string;
    replacingTokenId?: string;
  }): { token: string; record: McpPersonalAccessTokenRecord } {
    const name = input.name.trim();
    if (!name) throw new Error("mcp_access_token_name_required");
    if (name.length > 80) throw new Error("mcp_access_token_name_too_long");
    if (!MCP_PERSONAL_ACCESS_TOKEN_EXPIRATION_DAYS.includes(input.expirationDays)) {
      throw new Error("mcp_access_token_expiration_invalid");
    }
    const scopes = normalizeScopes(input.scopes) as McpPersonalAccessTokenScope[];
    const membership = this.store.listServersForUser(input.userId).find((server) => server.id === input.serverId);
    if (!membership) throw new Error("server_membership_required");
    if (membership.role === "guest" && scopesRequireWorkspaceMember(scopes)) {
      throw new Error("mcp_access_token_manage_forbidden");
    }

    const id = `mcp_pat_${randomUUID().replaceAll("-", "")}`;
    const token = opaqueToken("tyr_pat");
    const createdAt = new Date().toISOString();
    const expiresAt = Date.now() + input.expirationDays * 24 * 60 * 60 * 1000;
    const create = this.store.db.transaction(() => {
      const activeCount = (this.store.db.prepare(
        `select count(*) as count from mcp_personal_access_tokens
         where user_id = ? and server_id = ? and revoked_at is null and expires_at > ?
           and (? is null or id <> ?)`
      ).get(input.userId, input.serverId, Date.now(), input.replacingTokenId ?? null, input.replacingTokenId ?? null) as { count: number }).count;
      if (activeCount >= MAX_ACTIVE_PERSONAL_ACCESS_TOKENS) throw new Error("mcp_access_token_limit_reached");
      this.store.db.prepare(
        `insert into mcp_personal_access_tokens
         (id, token_hash, token_prefix, name, user_id, server_id, scopes_json, resource, expires_at, last_used_at, revoked_at, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, ?)`
      ).run(
        id,
        hashSecret(token),
        token.slice(0, 18),
        name,
        input.userId,
        input.serverId,
        JSON.stringify(scopes),
        input.resource,
        expiresAt,
        createdAt
      );
      if (input.replacingTokenId) {
        const revoked = this.store.db.prepare(
          `update mcp_personal_access_tokens set revoked_at = ?
           where id = ? and user_id = ? and server_id = ? and revoked_at is null`
        ).run(createdAt, input.replacingTokenId, input.userId, input.serverId);
        if (revoked.changes !== 1) throw new Error("mcp_access_token_not_found");
      }
      const record = personalAccessTokenRecord(this.store.db.prepare("select * from mcp_personal_access_tokens where id = ?").get(id));
      this.store.recordAuditEvent({
        kind: input.replacingTokenId ? "mcp_personal_access_token_rotated" : "mcp_personal_access_token_created",
        actorType: "user",
        actorId: input.userId,
        resourceType: "mcp_personal_access_token",
        resourceId: record.id,
        serverId: input.serverId,
        metadata: {
          ...(input.replacingTokenId ? { replacedTokenId: input.replacingTokenId } : {}),
          name: record.name,
          tokenPrefix: record.tokenPrefix,
          scopes: record.scopes,
          expiresAt: record.expiresAt
        }
      });
      return record;
    });
    // 新凭据、旧凭据撤销和审计必须原子完成，避免轮换失败后用户拿不到唯一有效的明文。
    return { token, record: create.immediate() };
  }

  revokePersonalAccessToken(input: { id: string; userId: string; serverId: string }): McpPersonalAccessTokenRecord | null {
    const revoke = this.store.db.transaction(() => {
      const row = this.store.db.prepare(
        "select * from mcp_personal_access_tokens where id = ? and user_id = ? and server_id = ?"
      ).get(input.id, input.userId, input.serverId) as any;
      if (!row) return null;
      if (!row.revoked_at) {
        this.store.db.prepare(
          "update mcp_personal_access_tokens set revoked_at = ? where id = ?"
        ).run(new Date().toISOString(), input.id);
        this.store.recordAuditEvent({
          kind: "mcp_personal_access_token_revoked",
          actorType: "user",
          actorId: input.userId,
          resourceType: "mcp_personal_access_token",
          resourceId: input.id,
          serverId: input.serverId,
          metadata: {
            name: row.name,
            tokenPrefix: row.token_prefix
          }
        });
      }
      return personalAccessTokenRecord(this.store.db.prepare("select * from mcp_personal_access_tokens where id = ?").get(input.id));
    });
    return revoke.immediate();
  }

  getPersonalAccessToken(id: string, userId: string, serverId: string): McpPersonalAccessTokenRecord | null {
    const row = this.store.db.prepare(
      "select * from mcp_personal_access_tokens where id = ? and user_id = ? and server_id = ?"
    ).get(id, userId, serverId);
    return row ? personalAccessTokenRecord(row) : null;
  }

  verifyPersonalAccessToken(token: string, resource: string): AuthInfo {
    const row = this.store.db.prepare(
      `select * from mcp_personal_access_tokens
       where token_hash = ? and revoked_at is null and expires_at > ?`
    ).get(hashSecret(token), Date.now()) as any;
    if (!row || row.resource !== resource) throw new InvalidTokenError("Personal access token is invalid, expired, revoked, or bound to another resource.");
    const membership = this.store.listServersForUser(row.user_id).find((server) => server.id === row.server_id);
    const scopes = scopesFromJson(row.scopes_json);
    if (!membership || (membership.role === "guest" && scopesRequireWorkspaceMember(scopes))) {
      // Workspace 移除或角色降级立即吊销凭据，不能等待 Token 自然过期。
      this.store.db.prepare(
        "update mcp_personal_access_tokens set revoked_at = ? where id = ? and revoked_at is null"
      ).run(new Date().toISOString(), row.id);
      throw new InvalidTokenError("The Tyr workspace grant is no longer valid for this personal access token.");
    }
    const now = Date.now();
    if (!row.last_used_at || now - row.last_used_at >= PERSONAL_ACCESS_TOKEN_LAST_USED_WRITE_INTERVAL_MS) {
      this.store.db.prepare("update mcp_personal_access_tokens set last_used_at = ? where id = ?").run(now, row.id);
    }
    return {
      token,
      clientId: `pat:${row.id}`,
      scopes,
      expiresAt: Math.floor(row.expires_at / 1000),
      resource: new URL(row.resource),
      extra: {
        userId: row.user_id,
        serverId: row.server_id,
        grantId: `pat:${row.id}`,
        authKind: "personal_access_token",
        personalAccessTokenId: row.id
      }
    };
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = this.store.db.prepare("select client_json from mcp_oauth_clients where client_id = ?").get(clientId) as any;
    if (!row) return undefined;
    try {
      return JSON.parse(row.client_json) as OAuthClientInformationFull;
    } catch {
      return undefined;
    }
  }

  registerClient(client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at"> & Partial<Pick<OAuthClientInformationFull, "client_id" | "client_id_issued_at">>): OAuthClientInformationFull {
    if (!client.client_id || client.redirect_uris.length < 1 || client.redirect_uris.length > 10 || client.redirect_uris.some((uri) => !safeClientRedirect(uri))) {
      throw new InvalidClientMetadataError("Clients must register 1-10 HTTPS or loopback redirect URIs without fragments.");
    }
    const grantTypes = client.grant_types ?? ["authorization_code", "refresh_token"];
    const responseTypes = client.response_types ?? ["code"];
    const tokenEndpointAuthMethod = client.token_endpoint_auth_method ?? "client_secret_post";
    if (grantTypes.some((value) => !["authorization_code", "refresh_token"].includes(value)) || responseTypes.some((value) => value !== "code")) {
      throw new InvalidClientMetadataError("Tyr MCP supports Authorization Code with PKCE and refresh tokens only.");
    }
    // SDK 的 token/revoke handler 只实现表单 client secret 或 public client，不接受 HTTP Basic。
    if (!["none", "client_secret_post"].includes(tokenEndpointAuthMethod)) {
      throw new InvalidClientMetadataError("Tyr MCP supports token_endpoint_auth_method none or client_secret_post only.");
    }
    const record: OAuthClientInformationFull = {
      ...client,
      client_id: client.client_id,
      client_id_issued_at: client.client_id_issued_at ?? Math.floor(Date.now() / 1000),
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: tokenEndpointAuthMethod
    };
    const now = new Date().toISOString();
    this.store.db.prepare(
      `insert into mcp_oauth_clients (client_id, client_json, created_at, updated_at)
       values (?, ?, ?, ?)
       on conflict(client_id) do update set client_json = excluded.client_json, updated_at = excluded.updated_at`
    ).run(record.client_id, JSON.stringify(record), now, now);
    return record;
  }

  createAuthorizationRequest(client: OAuthClientInformationFull, params: AuthorizationParams, resource: string): McpAuthorizationRequestRecord {
    const scopes = normalizeScopes(params.scopes);
    const id = `mcp_auth_${randomUUID().replaceAll("-", "")}`;
    const createdAt = new Date().toISOString();
    const expiresAt = Date.now() + AUTHORIZATION_REQUEST_TTL_MS;
    this.store.db.prepare(
      `insert into mcp_oauth_authorization_requests
       (id, client_id, redirect_uri, state, scopes_json, code_challenge, resource, status, expires_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(id, client.client_id, params.redirectUri, params.state ?? null, JSON.stringify(scopes), params.codeChallenge, resource, expiresAt, createdAt);
    return {
      id,
      clientId: client.client_id,
      clientName: client.client_name || "MCP client",
      redirectUri: params.redirectUri,
      state: params.state,
      scopes,
      resource,
      expiresAt
    };
  }

  getAuthorizationRequest(id: string): McpAuthorizationRequestRecord | null {
    const row = this.store.db.prepare(
      `select requests.*, clients.client_json
       from mcp_oauth_authorization_requests requests
       join mcp_oauth_clients clients on clients.client_id = requests.client_id
       where requests.id = ? and requests.status = 'pending' and requests.expires_at > ?`
    ).get(id, Date.now()) as any;
    if (!row) return null;
    const client = JSON.parse(row.client_json) as OAuthClientInformationFull;
    return {
      id: row.id,
      clientId: row.client_id,
      clientName: client.client_name || "MCP client",
      redirectUri: row.redirect_uri,
      state: row.state ?? undefined,
      scopes: scopesFromJson(row.scopes_json),
      resource: row.resource,
      expiresAt: row.expires_at
    };
  }

  createLoginTicket(requestId: string, email: string, password: string): { ticket: string; userId: string } | null {
    if (!this.getAuthorizationRequest(requestId)) return null;
    const login = this.store.loginUser({ email, password });
    if (!login) return null;
    // OAuth 只借用既有密码校验；删除临时 Web session，避免产生一个用户永远看不到的登录会话。
    this.store.logoutSession(login.refreshToken);
    return this.createLoginTicketForUser(requestId, login.user.id);
  }

  /** 已有 Tyr Web 会话只换取短期 consent ticket，不直接授予 workspace 或 scope。 */
  createLoginTicketForUser(requestId: string, userId: string): { ticket: string; userId: string } | null {
    const request = this.getAuthorizationRequest(requestId);
    if (!request) return null;
    const ticket = opaqueToken("mcp_login");
    const now = new Date().toISOString();
    this.store.db.prepare(
      `insert into mcp_oauth_login_tickets
       (ticket_hash, request_id, user_id, expires_at, consumed_at, created_at)
       values (?, ?, ?, ?, null, ?)`
    ).run(hashSecret(ticket), request.id, userId, Date.now() + LOGIN_TICKET_TTL_MS, now);
    return { ticket, userId };
  }

  /** consent ticket 同时绑定 authorization request、用户与有效期，不可跨请求复用。 */
  getLoginTicketUserId(requestId: string, ticket: string): string | null {
    const request = this.getAuthorizationRequest(requestId);
    if (!request) return null;
    const row = this.store.db.prepare(
      `select user_id from mcp_oauth_login_tickets
       where ticket_hash = ? and request_id = ? and consumed_at is null and expires_at > ?`
    ).get(hashSecret(ticket), request.id, Date.now()) as any;
    return row?.user_id ?? null;
  }

  /** 授权页仍向用户返回通用错误，服务端用稳定 reason 定位过期、重放或成员权限变化。 */
  diagnoseAuthorizationApprovalFailure(input: { requestId: string; ticket: string; serverId: string }): string {
    const now = Date.now();
    const requestRow = this.store.db.prepare(
      "select status, expires_at, scopes_json from mcp_oauth_authorization_requests where id = ?"
    ).get(input.requestId) as any;
    if (!requestRow) return "request_not_found";
    if (requestRow.status !== "pending") return `request_${requestRow.status}`;
    if (requestRow.expires_at <= now) return "request_expired";

    const ticketRow = this.store.db.prepare(
      "select request_id, user_id, expires_at, consumed_at from mcp_oauth_login_tickets where ticket_hash = ?"
    ).get(hashSecret(input.ticket)) as any;
    if (!ticketRow) return "ticket_not_found";
    if (ticketRow.request_id !== input.requestId) return "ticket_request_mismatch";
    if (ticketRow.consumed_at) return "ticket_consumed";
    if (ticketRow.expires_at <= now) return "ticket_expired";

    const membership = this.store.listServersForUser(ticketRow.user_id).find((server) => server.id === input.serverId);
    if (!membership) return "workspace_unavailable";
    if (scopesRequireWorkspaceMember(scopesFromJson(requestRow.scopes_json)) && membership.role === "guest") return "workspace_manage_forbidden";
    return "concurrent_update";
  }

  approveAuthorization(input: { requestId: string; ticket: string; serverId: string }): { redirectUri: string; code: string; state?: string } | null {
    const request = this.getAuthorizationRequest(input.requestId);
    if (!request) return null;
    const ticketUserId = this.getLoginTicketUserId(request.id, input.ticket);
    if (!ticketUserId) return null;
    const membership = this.store.listServersForUser(ticketUserId).find((server) => server.id === input.serverId);
    if (!membership) return null;
    if (scopesRequireWorkspaceMember(request.scopes) && membership.role === "guest") return null;

    const code = opaqueToken("mcp_code");
    const now = new Date().toISOString();
    const commit = this.store.db.transaction(() => {
      const consumed = this.store.db.prepare(
        "update mcp_oauth_login_tickets set consumed_at = ? where ticket_hash = ? and consumed_at is null"
      ).run(now, hashSecret(input.ticket));
      const approved = this.store.db.prepare(
        "update mcp_oauth_authorization_requests set status = 'approved' where id = ? and status = 'pending'"
      ).run(request.id);
      if (consumed.changes !== 1 || approved.changes !== 1) return false;
      this.store.db.prepare(
        `insert into mcp_oauth_codes
         (code_hash, client_id, user_id, server_id, scopes_json, code_challenge, redirect_uri, resource, expires_at, consumed_at, created_at)
         select ?, client_id, ?, ?, scopes_json, code_challenge, redirect_uri, resource, ?, null, ?
         from mcp_oauth_authorization_requests where id = ?`
      ).run(hashSecret(code), ticketUserId, input.serverId, Date.now() + AUTHORIZATION_CODE_TTL_MS, now, request.id);
      return true;
    });
    if (!commit.immediate()) return null;
    return { redirectUri: request.redirectUri, code, state: request.state };
  }

  denyAuthorization(requestId: string): { redirectUri: string; state?: string } | null {
    const request = this.getAuthorizationRequest(requestId);
    if (!request) return null;
    const result = this.store.db.prepare(
      "update mcp_oauth_authorization_requests set status = 'denied' where id = ? and status = 'pending'"
    ).run(request.id);
    return result.changes === 1 ? { redirectUri: request.redirectUri, state: request.state } : null;
  }

  authorizationCodeRow(clientId: string, code: string): any {
    return this.store.db.prepare(
      `select * from mcp_oauth_codes
       where code_hash = ? and client_id = ? and consumed_at is null and expires_at > ?`
    ).get(hashSecret(code), clientId, Date.now()) as any;
  }

  exchangeAuthorizationCode(clientId: string, code: string, redirectUri: string | undefined, resource: string): OAuthTokens {
    const row = this.authorizationCodeRow(clientId, code);
    if (!row || (redirectUri && redirectUri !== row.redirect_uri) || resource !== row.resource) {
      throw new InvalidGrantError("Authorization code is invalid, expired, or bound to another redirect/resource.");
    }
    const accessToken = opaqueToken("mcp_access");
    const refreshToken = opaqueToken("mcp_refresh");
    const familyId = `mcp_grant_${randomUUID().replaceAll("-", "")}`;
    const now = new Date().toISOString();
    const commit = this.store.db.transaction(() => {
      const consumed = this.store.db.prepare(
        "update mcp_oauth_codes set consumed_at = ? where code_hash = ? and consumed_at is null"
      ).run(now, hashSecret(code));
      if (consumed.changes !== 1) return false;
      this.insertToken(accessToken, "access", familyId, row, Date.now() + ACCESS_TOKEN_TTL_MS, now);
      this.insertToken(refreshToken, "refresh", familyId, row, Date.now() + REFRESH_TOKEN_TTL_MS, now);
      return true;
    });
    if (!commit.immediate()) throw new InvalidGrantError("Authorization code was already used.");
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      scope: scopesFromJson(row.scopes_json).join(" ")
    };
  }

  exchangeRefreshToken(clientId: string, token: string, requestedScopes: string[] | undefined, resource: string): OAuthTokens {
    const row = this.store.db.prepare(
      `select * from mcp_oauth_tokens
       where token_hash = ? and token_kind = 'refresh' and client_id = ? and revoked_at is null and expires_at > ?`
    ).get(hashSecret(token), clientId, Date.now()) as any;
    if (!row || row.resource !== resource) throw new InvalidGrantError("Refresh token is invalid, expired, revoked, or bound to another resource.");
    const grantedScopes = scopesFromJson(row.scopes_json);
    const membership = this.store.listServersForUser(row.user_id).find((server) => server.id === row.server_id);
    if (!membership || (membership.role === "guest" && scopesRequireWorkspaceMember(grantedScopes))) {
      this.store.db.prepare(
        "update mcp_oauth_tokens set revoked_at = ? where family_id = ? and revoked_at is null"
      ).run(new Date().toISOString(), row.family_id);
      throw new InvalidGrantError("The Tyr workspace grant is no longer valid for this user.");
    }
    const scopes = requestedScopes?.length ? normalizeScopes(requestedScopes) : grantedScopes;
    if (scopes.some((scope) => !grantedScopes.includes(scope))) throw new InvalidScopeError("Refresh scope exceeds the original grant.");
    const accessToken = opaqueToken("mcp_access");
    const refreshToken = opaqueToken("mcp_refresh");
    const now = new Date().toISOString();
    const rotated = this.store.db.transaction(() => {
      const revoked = this.store.db.prepare(
        "update mcp_oauth_tokens set revoked_at = ? where token_hash = ? and revoked_at is null"
      ).run(now, hashSecret(token));
      if (revoked.changes !== 1) return false;
      const nextRow = { ...row, scopes_json: JSON.stringify(scopes) };
      this.insertToken(accessToken, "access", row.family_id, nextRow, Date.now() + ACCESS_TOKEN_TTL_MS, now);
      this.insertToken(refreshToken, "refresh", row.family_id, nextRow, Date.now() + REFRESH_TOKEN_TTL_MS, now);
      return true;
    });
    if (!rotated.immediate()) throw new InvalidGrantError("Refresh token was already used.");
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      scope: scopes.join(" ")
    };
  }

  private insertToken(token: string, kind: "access" | "refresh", familyId: string, source: any, expiresAt: number, createdAt: string): void {
    this.store.db.prepare(
      `insert into mcp_oauth_tokens
       (token_hash, token_kind, family_id, client_id, user_id, server_id, scopes_json, resource, expires_at, revoked_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?)`
    ).run(hashSecret(token), kind, familyId, source.client_id, source.user_id, source.server_id, source.scopes_json, source.resource, expiresAt, createdAt);
  }

  verifyAccessToken(token: string): AuthInfo {
    const row = this.store.db.prepare(
      `select * from mcp_oauth_tokens
       where token_hash = ? and token_kind = 'access' and revoked_at is null and expires_at > ?`
    ).get(hashSecret(token), Date.now()) as any;
    if (!row) throw new InvalidTokenError("Access token is invalid, expired, or revoked.");
    const membership = this.store.listServersForUser(row.user_id).find((server) => server.id === row.server_id);
    const scopes = scopesFromJson(row.scopes_json);
    if (!membership || (membership.role === "guest" && scopesRequireWorkspaceMember(scopes))) {
      // Workspace removal or role downgrade invalidates the whole grant immediately instead of waiting for token expiry.
      this.store.db.prepare(
        "update mcp_oauth_tokens set revoked_at = ? where family_id = ? and revoked_at is null"
      ).run(new Date().toISOString(), row.family_id);
      throw new InvalidTokenError("The Tyr workspace grant is no longer valid for this user.");
    }
    return {
      token,
      clientId: row.client_id,
      scopes,
      expiresAt: Math.floor(row.expires_at / 1000),
      resource: new URL(row.resource),
      extra: {
        userId: row.user_id,
        serverId: row.server_id,
        grantId: row.family_id
      }
    };
  }

  revokeToken(clientId: string, token: string): void {
    const row = this.store.db.prepare(
      "select token_kind, family_id from mcp_oauth_tokens where token_hash = ? and client_id = ?"
    ).get(hashSecret(token), clientId) as any;
    if (!row) return;
    const now = new Date().toISOString();
    if (row.token_kind === "refresh") {
      this.store.db.prepare(
        "update mcp_oauth_tokens set revoked_at = ? where family_id = ? and client_id = ? and revoked_at is null"
      ).run(now, row.family_id, clientId);
      return;
    }
    this.store.db.prepare(
      "update mcp_oauth_tokens set revoked_at = ? where token_hash = ? and client_id = ? and revoked_at is null"
    ).run(now, hashSecret(token), clientId);
  }

  hasContinuationAuthority(sourceMessageId: string): boolean {
    return Boolean(this.store.db.prepare(
      "select 1 from mcp_continuation_authorities where source_message_id = ?"
    ).get(sourceMessageId));
  }

  private continuationBindingValid(authority: McpContinuationAuthorityRecord | McpContinuationAuthorityInput): boolean {
    // 精确 ID 查询，不使用支持短 ID 的业务 lookup；当前 operation 输入指针与当前 Web 会话均不参与续接身份判断。
    const row = this.store.db.prepare(
      `select messages.channel_id, messages.conversation_id, messages.sender_type, messages.sender_id,
              channels.server_id, channels.type, channels.dm_identity,
              conversations.server_id as conversation_server_id, conversations.channel_id as conversation_channel_id
       from messages
       join channels on channels.id = messages.channel_id
       join conversations on conversations.id = messages.conversation_id
       where messages.id = ?`
    ).get(authority.sourceMessageId) as any;
    if (!row || row.sender_type !== "human" || row.sender_id !== authority.userId || row.type !== "dm" ||
        row.server_id !== authority.serverId || row.conversation_server_id !== authority.serverId ||
        row.conversation_id !== authority.conversationId || row.conversation_channel_id !== row.channel_id ||
        ("channelId" in authority && row.channel_id !== authority.channelId)) return false;
    try {
      const identity = JSON.parse(row.dm_identity ?? "null") as { kind?: string; humanUserId?: string } | null;
      if (identity?.kind !== "human_agent" || identity.humanUserId !== authority.userId) return false;
    } catch {
      return false;
    }
    const operation = this.getOperation(authority.operationId);
    return Boolean(operation && operation.userId === authority.userId && operation.serverId === authority.serverId &&
      operation.clientId === authority.clientId && operation.grantId === authority.grantId &&
      operation.conversationId === authority.conversationId && operation.sourceConversationKey === authority.sourceConversationKey &&
      (operation.kind === "query" ? "read_only" : "manage") === authority.accessMode);
  }

  private continuationGrantRows(input: Pick<McpContinuationAuthorityInput, "userId" | "serverId" | "clientId" | "grantId">): Array<{ resource: string; scopes_json: string }> {
    const now = Date.now();
    if (input.grantId.startsWith("pat:")) {
      if (input.clientId !== input.grantId) return [];
      return this.store.db.prepare(
        `select resource, scopes_json from mcp_personal_access_tokens
         where id = ? and user_id = ? and server_id = ? and revoked_at is null and expires_at > ?`
      ).all(input.grantId.slice("pat:".length), input.userId, input.serverId, now) as Array<{ resource: string; scopes_json: string }>;
    }
    // refresh 轮换撤销旧 refresh，不撤销整个 family；最新仍有效 credential 代表当前 grant 的收紧后 scopes。
    return this.store.db.prepare(
      `select resource, scopes_json from mcp_oauth_tokens
       where family_id = ? and user_id = ? and server_id = ? and client_id = ?
         and token_kind in ('access', 'refresh') and revoked_at is null and expires_at > ?
       order by rowid desc`
    ).all(input.grantId, input.userId, input.serverId, input.clientId, now) as Array<{ resource: string; scopes_json: string }>;
  }

  /** 仅认证后的 MCP 入站路径调用；worker、模型和外部回执不得提供或更新此授权快照。 */
  recordContinuationAuthority(input: McpContinuationAuthorityInput): McpContinuationAuthorityRecord {
    const invalid = (code: McpContinuationAuthorizationErrorCode): never => {
      throw Object.assign(new Error(code), { code });
    };
    const scopes = [...new Set(input.grantedScopes)].sort();
    if (!scopes.includes("tyr:read") || scopes.some((scope) => !MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number]))) {
      return invalid("mcp_authorization_context_invalid");
    }
    const normalized = { ...input, grantedScopes: scopes };
    if (!this.continuationBindingValid(normalized)) return invalid("mcp_authorization_context_invalid");
    const existingRow = this.store.db.prepare(
      "select * from mcp_continuation_authorities where source_message_id = ?"
    ).get(input.sourceMessageId);
    if (existingRow) {
      const existing = rowContinuationAuthority(existingRow);
      if (Object.keys(normalized).some((key) => {
        const field = key as keyof McpContinuationAuthorityInput;
        return field === "grantedScopes"
          ? JSON.stringify(existing.grantedScopes) !== JSON.stringify(scopes)
          : existing[field] !== normalized[field];
      })) return invalid("mcp_authorization_context_invalid");
      return existing;
    }
    const membership = this.store.listServersForUser(input.userId).find((server) => server.id === input.serverId);
    // 认证后的 access token 可能仍属于轮换前的有效 access credential；记录其真实原始 scopes，续接再取最新 grant 的交集。
    const grant = this.continuationGrantRows(input).find((row) => scopes.every((scope) => scopesFromJson(row.scopes_json).includes(scope)));
    if (!grant || !membership || (membership.role === "guest" && scopesRequireWorkspaceMember(scopes))) {
      return invalid("mcp_authorization_grant_invalid");
    }
    const message = this.store.db.prepare("select channel_id from messages where id = ?").get(input.sourceMessageId) as { channel_id: string };
    const authority: McpContinuationAuthorityRecord = {
      ...normalized,
      channelId: message.channel_id,
      resource: grant.resource,
      createdAt: new Date().toISOString()
    };
    this.store.db.prepare(
      `insert into mcp_continuation_authorities
       (source_message_id, operation_id, user_id, server_id, channel_id, conversation_id, client_id, grant_id,
        scopes_json, access_mode, source_conversation_key, resource, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      authority.sourceMessageId, authority.operationId, authority.userId, authority.serverId, authority.channelId,
      authority.conversationId, authority.clientId, authority.grantId, JSON.stringify(scopes), authority.accessMode,
      authority.sourceConversationKey, authority.resource, authority.createdAt
    );
    return authority;
  }

  resolveContinuationAuthority(input: McpContinuationAuthorityResolveInput): McpContinuationAuthorityResult {
    const row = this.store.db.prepare(
      "select * from mcp_continuation_authorities where source_message_id = ?"
    ).get(input.sourceMessageId);
    if (!row) return { status: "invalid", errorCode: "mcp_authorization_context_missing", hasContext: false };
    const authority = rowContinuationAuthority(row);
    if (authority.userId !== input.userId || authority.serverId !== input.serverId || authority.channelId !== input.channelId ||
        authority.conversationId !== input.conversationId || (input.operationId && authority.operationId !== input.operationId) ||
        !this.continuationBindingValid(authority)) {
      return { status: "invalid", errorCode: "mcp_authorization_context_invalid", hasContext: true };
    }
    const sourceContext: McpContinuationSourceContext = {
      source: "mcp",
      sourceConversationKey: authority.sourceConversationKey,
      externalRef: authority.operationId,
      clientId: authority.clientId,
      grantId: authority.grantId,
      grantedScopes: [],
      accessMode: authority.accessMode
    };
    const membership = this.store.listServersForUser(authority.userId).find((server) => server.id === authority.serverId);
    const grant = this.continuationGrantRows(authority)[0];
    const currentScopes = grant ? scopesFromJson(grant.scopes_json) : [];
    const membershipInvalid = !membership || (membership.role === "guest" && scopesRequireWorkspaceMember(currentScopes));
    if (grant?.resource === authority.resource && membershipInvalid) {
      // 与 token 验证/refresh 保持同一策略：已观察到退出或角色失权的 grant 永久撤销，重新加入需要新授权。
      const revokedAt = new Date().toISOString();
      if (authority.grantId.startsWith("pat:")) {
        this.store.db.prepare(
          "update mcp_personal_access_tokens set revoked_at = ? where id = ? and user_id = ? and server_id = ? and revoked_at is null"
        ).run(revokedAt, authority.grantId.slice("pat:".length), authority.userId, authority.serverId);
      } else {
        this.store.db.prepare(
          "update mcp_oauth_tokens set revoked_at = ? where family_id = ? and client_id = ? and user_id = ? and server_id = ? and revoked_at is null"
        ).run(revokedAt, authority.grantId, authority.clientId, authority.userId, authority.serverId);
      }
    }
    if (!grant || grant.resource !== authority.resource || membershipInvalid) {
      return { status: "invalid", errorCode: "mcp_authorization_grant_invalid", hasContext: true, sourceContext };
    }
    // 原请求只读模式与原 scopes 均不可扩张，后续同 family 的重新授权也不能给旧请求追加能力。
    sourceContext.grantedScopes = authority.grantedScopes.filter((scope) => currentScopes.includes(scope));
    if (!sourceContext.grantedScopes.includes("tyr:read")) {
      return { status: "invalid", errorCode: "mcp_authorization_grant_invalid", hasContext: true, sourceContext: { ...sourceContext, grantedScopes: [] } };
    }
    return { status: "restored", sourceContext };
  }

  getOrCreateConversationStart(input: {
    userId: string;
    serverId: string;
    clientId: string;
    grantId: string;
    idempotencyKey: string;
  }, createConversation: () => ConversationRecord): { conversation: ConversationRecord; created: boolean } {
    const run = this.store.db.transaction(() => {
      const existing = this.store.db.prepare(
        `select conversation_id from mcp_conversation_starts
         where user_id = ? and server_id = ? and client_id = ? and grant_id = ? and idempotency_key = ?`
      ).get(input.userId, input.serverId, input.clientId, input.grantId, input.idempotencyKey) as { conversation_id: string } | undefined;
      const existingConversation = existing ? this.store.getConversation(existing.conversation_id) : null;
      if (existingConversation) return { conversation: existingConversation, created: false };
      if (existing) {
        // 会话已被用户永久删除时清除失效幂等指针；相同 key 的后续显式调用可重新建立有效会话。
        this.store.db.prepare(
          `delete from mcp_conversation_starts
           where user_id = ? and server_id = ? and client_id = ? and grant_id = ? and idempotency_key = ?`
        ).run(input.userId, input.serverId, input.clientId, input.grantId, input.idempotencyKey);
      }
      const conversation = createConversation();
      this.store.db.prepare(
        `insert into mcp_conversation_starts
          (user_id, server_id, client_id, grant_id, idempotency_key, conversation_id, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.userId,
        input.serverId,
        input.clientId,
        input.grantId,
        input.idempotencyKey,
        conversation.id,
        new Date().toISOString()
      );
      return { conversation, created: true };
    });
    return run.immediate();
  }

  createOperation(input: { userId: string; serverId: string; clientId: string; grantId: string; kind: "query" | "request"; prompt: string; idempotencyKey: string; conversationId?: string }): McpOperationRecord {
    const id = `mcp_op_${randomUUID().replaceAll("-", "")}`;
    const now = new Date().toISOString();
    const sourceConversationKey = `mcp:${input.grantId}:${id}`;
    this.store.db.prepare(
      `insert or ignore into mcp_operations
       (id, user_id, server_id, client_id, grant_id, kind, initial_idempotency_key, source_conversation_key, conversation_id, prompt, execution_ids_json, bridge_request_ids_json, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?)`
    ).run(id, input.userId, input.serverId, input.clientId, input.grantId, input.kind, input.idempotencyKey, sourceConversationKey, input.conversationId ?? null, input.prompt, now, now);
    const row = this.store.db.prepare(
      `select * from mcp_operations where user_id = ? and server_id = ? and client_id = ? and grant_id = ? and kind = ? and initial_idempotency_key = ?`
    ).get(input.userId, input.serverId, input.clientId, input.grantId, input.kind, input.idempotencyKey) as any;
    return rowOperation(row);
  }

  getOperation(id: string): McpOperationRecord | null {
    const row = this.store.db.prepare("select * from mcp_operations where id = ?").get(id) as any;
    return row ? rowOperation(row) : null;
  }

  bindOperationConversation(operationId: string, conversationId: string): McpOperationRecord | null {
    // 旧 Operation 只允许首次补齐 conversation；已经绑定后保持不可变。
    this.store.db.prepare(
      "update mcp_operations set conversation_id = ?, updated_at = ? where id = ? and conversation_id is null"
    ).run(conversationId, new Date().toISOString(), operationId);
    return this.getOperation(operationId);
  }

  claimOperationEvent(operationId: string, idempotencyKey: string, prompt: string, pending: {
    executionIds: string[]; bridgeRequestIds: string[];
  } = { executionIds: [], bridgeRequestIds: [] }): {
    claimed: boolean;
    turnSequence: number;
    sourceEventKey: string;
  } {
    const claim = this.store.db.transaction(() => {
      const existing = this.store.db.prepare(
        "select turn_sequence from mcp_operation_events where operation_id = ? and idempotency_key = ?"
      ).get(operationId, idempotencyKey) as { turn_sequence: number } | undefined;
      if (existing) {
        return {
          claimed: false,
          turnSequence: existing.turn_sequence,
          sourceEventKey: `mcp:${operationId}:${idempotencyKey}`
        };
      }
      const operation = this.store.db.prepare(
        "select current_turn_sequence from mcp_operations where id = ?"
      ).get(operationId) as { current_turn_sequence: number } | undefined;
      if (!operation) throw new Error("operation_not_found");
      const turnSequence = Number(operation.current_turn_sequence ?? 0) + 1;
      const sourceEventKey = `mcp:${operationId}:${idempotencyKey}`;
      const now = new Date().toISOString();
      this.store.db.prepare(
        "insert into mcp_operation_events (operation_id, idempotency_key, turn_sequence, created_at) values (?, ?, ?, ?)"
      ).run(operationId, idempotencyKey, turnSequence, now);
      // continuation 一经接收即成为当前轮；先清空上一轮公开结果，异步完成顺序不能反向夺回当前轮。
      this.store.db.prepare(
        `update mcp_operations
         set current_turn_sequence = ?, current_source_event_key = ?, prompt = ?,
             inbound_message_id = null, assistant_reply_message_id = null, management_draft_id = null,
             current_execution_ids_json = ?, current_bridge_request_ids_json = ?,
             response_text = null, result_metadata_json = '{"assistantOutcomeStatus":"running"}', updated_at = ?
         where id = ?`
      ).run(turnSequence, sourceEventKey, prompt, JSON.stringify(pending.executionIds), JSON.stringify(pending.bridgeRequestIds), now, operationId);
      return { claimed: true, turnSequence, sourceEventKey };
    });
    return claim.immediate();
  }

  updateOperation(
    id: string,
    input: {
      turnSequence?: number;
      prompt?: string;
      inboundMessageId?: string | null;
      assistantReplyMessageId?: string | null;
      managementDraftId?: string | null;
      executionIds?: string[];
      bridgeRequestIds?: string[];
      responseText?: string | null;
      resultMetadata?: McpOperationResultMetadata | null;
    }
  ): McpOperationRecord | null {
    const current = this.getOperation(id);
    if (!current) return null;
    const updatesCurrentTurn = input.turnSequence === undefined || input.turnSequence === current.currentTurnSequence;
    const currentValue = <T>(key: keyof typeof input, incoming: T | null | undefined, fallback: T | undefined): T | null => (
      updatesCurrentTurn && key in input ? incoming ?? null : fallback ?? null
    );
    const next = {
      prompt: updatesCurrentTurn ? input.prompt ?? current.prompt : current.prompt,
      inboundMessageId: currentValue("inboundMessageId", input.inboundMessageId, current.inboundMessageId),
      assistantReplyMessageId: currentValue("assistantReplyMessageId", input.assistantReplyMessageId, current.assistantReplyMessageId),
      managementDraftId: currentValue("managementDraftId", input.managementDraftId, current.managementDraftId),
      executionIds: JSON.stringify([...new Set([...(current.executionIds ?? []), ...(input.executionIds ?? [])])]),
      bridgeRequestIds: JSON.stringify([...new Set([...(current.bridgeRequestIds ?? []), ...(input.bridgeRequestIds ?? [])])]),
      currentExecutionIds: JSON.stringify(updatesCurrentTurn && input.executionIds !== undefined
        ? [...new Set(input.executionIds)]
        : current.currentExecutionIds),
      currentBridgeRequestIds: JSON.stringify(updatesCurrentTurn && input.bridgeRequestIds !== undefined
        ? [...new Set(input.bridgeRequestIds)]
        : current.currentBridgeRequestIds),
      responseText: currentValue("responseText", input.responseText, current.responseText),
      // 只有对应当前轮的完成写入才能改变顶层错误；旧轮迟到结果只补充历史资源。
      resultMetadata: updatesCurrentTurn && "resultMetadata" in input
        ? input.resultMetadata
          ? JSON.stringify(input.resultMetadata)
          : null
        : current.resultMetadata
          ? JSON.stringify(current.resultMetadata)
          : null,
      // 旧轮迟到写入只扩充历史，不应唤醒或推进当前轮的状态时间。
      updatedAt: updatesCurrentTurn ? new Date().toISOString() : current.updatedAt
    };
    this.store.db.prepare(
      `update mcp_operations set prompt = @prompt, inbound_message_id = @inboundMessageId,
       assistant_reply_message_id = @assistantReplyMessageId, management_draft_id = @managementDraftId,
       execution_ids_json = @executionIds, bridge_request_ids_json = @bridgeRequestIds,
       current_execution_ids_json = @currentExecutionIds, current_bridge_request_ids_json = @currentBridgeRequestIds,
       response_text = @responseText,
       result_metadata_json = @resultMetadata, updated_at = @updatedAt where id = @id`
    ).run({ id, ...next });
    return this.getOperation(id);
  }
}

export class TyrMcpOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(readonly persistence: McpPersistence, readonly publicBaseUrl: string, readonly resourceUrl: string) {
    this.clientsStore = {
      getClient: (clientId) => this.persistence.getClient(clientId),
      registerClient: (client) => this.persistence.registerClient(client)
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const resource = params.resource?.href ?? this.resourceUrl;
    if (resource !== this.resourceUrl) throw new InvalidTargetError("OAuth resource must match the Tyr MCP endpoint.");
    const request = this.persistence.createAuthorizationRequest(client, params, resource);
    res.redirect(302, `${this.publicBaseUrl}/oauth/consent?request=${encodeURIComponent(request.id)}`);
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const row = this.persistence.authorizationCodeRow(client.client_id, authorizationCode);
    if (!row) throw new InvalidGrantError("Authorization code is invalid or expired.");
    return row.code_challenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string, _codeVerifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
    return this.persistence.exchangeAuthorizationCode(client.client_id, authorizationCode, redirectUri, resource?.href ?? this.resourceUrl);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    return this.persistence.exchangeRefreshToken(client.client_id, refreshToken, scopes, resource?.href ?? this.resourceUrl);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    return this.persistence.verifyAccessToken(token);
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    this.persistence.revokeToken(client.client_id, request.token);
  }
}
