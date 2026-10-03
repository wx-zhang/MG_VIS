import { createHash, randomBytes, randomUUID } from "node:crypto";
import express from "express";
import { webAuthStorageKeys } from "@tyr-ai/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authorizationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { clientRegistrationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/register.js";
import { revocationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/revoke.js";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { McpOperationService, type McpActor, type McpOperationStatusPayload } from "../mcp-operation-service";
import {
  MCP_PERSONAL_ACCESS_TOKEN_PREFIX,
  MCP_SCOPES,
  McpPersistence,
  TyrMcpOAuthProvider,
  mcpClientRedirectOrigin
} from "../mcp-persistence";
import type { ServerRouteContext } from "../server-context";
import { registerMcpAccessTokenRoutes } from "./mcp-access-token-routes";
import {
  WorkspaceBridgeRequestService
} from "../workspace-bridge-request-service";

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  actorKey: string;
  lastUsedAt: number;
  inFlightRequests: number;
}

const MCP_SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
const MCP_MAX_ACTIVE_SESSIONS = 500;
const CONSENT_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const CONSENT_LOGIN_IP_LIMIT = 30;
const CONSENT_LOGIN_ACCOUNT_LIMIT = 12;
const MAX_CONSENT_LOGIN_COUNTERS = 10_000;

interface FixedWindowAttempt {
  count: number;
  resetAt: number;
}

function recordLoginAttempt(attempts: Map<string, FixedWindowAttempt>, key: string, limit: number, now: number): number | null {
  let current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    if (!current && attempts.size >= MAX_CONSENT_LOGIN_COUNTERS) {
      for (const [attemptKey, attempt] of attempts) if (attempt.resetAt <= now) attempts.delete(attemptKey);
      // 计数器达到硬上限且没有可回收项时拒绝新 key，避免攻击者用随机账号耗尽内存。
      if (attempts.size >= MAX_CONSENT_LOGIN_COUNTERS) return Math.ceil(CONSENT_LOGIN_WINDOW_MS / 1000);
    }
    current = { count: 0, resetAt: now + CONSENT_LOGIN_WINDOW_MS };
  }
  current.count += 1;
  attempts.set(key, current);
  return current.count > limit ? Math.max(1, Math.ceil((current.resetAt - now) / 1000)) : null;
}

function externalUrls(publicServerUrl: string) {
  const publicBaseUrl = publicServerUrl.replace(/\/$/, "");
  const resourceUrl = `${publicBaseUrl}/mcp`;
  const parsedBase = new URL(publicBaseUrl);
  const resourcePath = new URL(resourceUrl).pathname;
  const issuerPath = parsedBase.pathname.replace(/\/$/, "");
  return {
    publicBaseUrl,
    resourceUrl,
    protectedResourceMetadataUrl: `${parsedBase.origin}/.well-known/oauth-protected-resource${resourcePath}`,
    authorizationServerMetadataUrl: `${parsedBase.origin}/.well-known/oauth-authorization-server${issuerPath}`,
    authorizationEndpoint: `${publicBaseUrl}/oauth/authorize`,
    tokenEndpoint: `${publicBaseUrl}/oauth/token`,
    registrationEndpoint: `${publicBaseUrl}/oauth/register`,
    revocationEndpoint: `${publicBaseUrl}/oauth/revoke`
  };
}

function authActor(authInfo: any): McpActor {
  const extra = authInfo?.extra;
  if (!authInfo || !extra || typeof extra.userId !== "string" || typeof extra.serverId !== "string" || typeof extra.grantId !== "string") {
    throw new Error("mcp_auth_context_missing");
  }
  return {
    userId: extra.userId,
    serverId: extra.serverId,
    grantId: extra.grantId,
    clientId: authInfo.clientId,
    scopes: authInfo.scopes
  };
}

function requireScope(actor: McpActor, scope: (typeof MCP_SCOPES)[number]): void {
  if (!actor.scopes.includes(scope)) throw new Error(`missing_scope:${scope}`);
}

function toolResult<T extends object>(payload: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as unknown as Record<string, unknown>
  };
}

function toolError(error: unknown, resourceMetadataUrl: string) {
  const message = error instanceof Error ? error.message : "mcp_operation_failed";
  const missingScope = message.startsWith("missing_scope:") ? message.slice("missing_scope:".length) : null;
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
    ...(missingScope ? {
      _meta: {
        "mcp/www_authenticate": [`Bearer scope="${missingScope}", resource_metadata="${resourceMetadataUrl}"`]
      }
    } : {})
  };
}

function defaultEventKey(input: string | undefined, extra: any): string {
  const explicit = input?.trim();
  if (explicit) return explicit.slice(0, 200);
  return `${String(extra.authInfo?.extra?.grantId ?? "grant")}:${String(extra.sessionId ?? "session")}:${String(extra.requestId)}`;
}

function bridgeIdempotencyKey(input: string | undefined, extra: any): string {
  // 显式 caller key 也必须按 OAuth grant 隔离，两个 MCP 客户端不能互相命中幂等记录。
  const grantId = String(extra.authInfo?.extra?.grantId ?? "grant");
  return createHash("sha256").update(`${grantId}:${defaultEventKey(input, extra)}`).digest("hex");
}

function createTyrMcpServer(
  service: McpOperationService,
  bridgeService: WorkspaceBridgeRequestService,
  resourceMetadataUrl: string
): McpServer {
  const server = new McpServer({ name: "tyr-assistant", version: "0.1.0" });
  const sharedAssistantSchema = {
    message: z.string().min(1).max(20_000).describe("Natural-language request for TYR."),
    conversationId: z.string().min(1).optional().describe("Existing writable TYR conversation. Omit it to use the Web/MCP current conversation. An existing operationId always remains bound to its original conversation."),
    idempotencyKey: z.string().min(1).max(200).optional().describe("Choose and save this stable caller key before sending. After a lost response, query tyr_operation_receipt or retry with this same key and payload; never generate a new key for an uncertain submission.")
  };
  const querySchema = {
    ...sharedAssistantSchema,
    operationId: z.string().optional().describe("Existing tyr_assistant_query operation ID for a read-only follow-up. Never pass this ID to tyr_assistant_request; switching to Action mode must create a new operation.")
  };
  const actionSchema = {
    ...sharedAssistantSchema,
    operationId: z.string().optional().describe("Existing tyr_assistant_request operation ID only when continuing that same Action workflow; unfinished dependencies remain attached across text-only follow-ups. For independent new work or after a blocked read-only query, omit operationId to create a new Action operation.")
  };

  server.registerTool("tyr_assistant_start_conversation", {
    title: "Start TYR conversation",
    description: "Create a new current TYR conversation shared with the Web workspace. Earlier TYR conversations remain available, while Telegram chats, email threads, and Workspace Bridge conversations keep their own routing.",
    inputSchema: {
      title: z.string().max(72).optional().describe("Optional conversation title. Empty conversations default to New conversation and can be named from their first message."),
      idempotencyKey: z.string().min(1).max(200).optional().describe("Stable caller key used to prevent retries from creating duplicate conversations.")
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["tyr:read"] }] }
  }, async (input, extra) => {
    try {
      const actor = authActor(extra.authInfo);
      requireScope(actor, "tyr:read");
      return toolResult(service.startConversation(actor, {
        title: input.title,
        idempotencyKey: defaultEventKey(input.idempotencyKey, extra)
      }));
    } catch (error) {
      return toolError(error, resourceMetadataUrl);
    }
  });

  server.registerTool("tyr_assistant_query", {
    title: "Query TYR",
    description: "Returns a durable queued receipt without waiting for TYR. Poll tyr_operation_status for the result. Use only for reading existing Tyr Workspace, Device, Agent, or Heartbeat status, lists, details, capabilities, scopes, schedules, and recent Heartbeat runs. Never use this tool to ask an Agent or peer workspace to search, inspect, send, report back, or perform work; those are Actions even when the downstream work only reads files. For every management action, Agent instruction, handoff, runtime execution, Heartbeat change, or Workspace Bridge message, obtain the user's Action confirmation and call tyr_assistant_request as a new operation.",
    inputSchema: querySchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["tyr:read"] }] }
  }, async (input, extra) => {
    try {
      const actor = authActor(extra.authInfo);
      requireScope(actor, "tyr:read");
      return toolResult(service.accept(actor, {
        kind: "query",
        message: input.message,
        operationId: input.operationId,
        conversationId: input.conversationId,
        idempotencyKey: defaultEventKey(input.idempotencyKey, extra)
      }));
    } catch (error) {
      return toolError(error, resourceMetadataUrl);
    }
  });

  server.registerTool("tyr_assistant_request", {
    title: "Ask TYR to act",
    description: "Returns a durable queued receipt without waiting for TYR. Poll tyr_operation_status for the result. Use after the user asks for or confirms an Action: every Tyr management change, Heartbeat create/update/enable/pause request, Agent instruction, handoff, runtime task, and request to a peer workspace. This includes read-only downstream work such as asking an Agent to inspect files and report back. Heartbeats can be paused but not permanently deleted through MCP. When recovering from an operation_not_allowed query, omit the query operationId so this tool creates a new Action operation. With tyr:bridge:send, TYR can contact a connected workspace through its peer TYR; local and peer approvals still apply.",
    inputSchema: actionSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true
    },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["tyr:manage"] }] }
  }, async (input, extra) => {
    try {
      const actor = authActor(extra.authInfo);
      requireScope(actor, "tyr:manage");
      return toolResult(service.accept(actor, {
        kind: "request",
        message: input.message,
        operationId: input.operationId,
        conversationId: input.conversationId,
        idempotencyKey: defaultEventKey(input.idempotencyKey, extra)
      }));
    } catch (error) {
      return toolError(error, resourceMetadataUrl);
    }
  });

  server.registerTool("tyr_operation_receipt", {
    title: "Find TYR submission receipt",
    description: "Read the saved receipt after a lost assistant submission response without sending work again. For the first submission, provide its kind and original idempotencyKey; for a follow-up, also provide operationId. Receipt state is separate from business completion. An interrupted submission is never replayed automatically.",
    inputSchema: { kind: z.enum(["query", "request"]), idempotencyKey: z.string().min(1).max(200), operationId: z.string().min(1).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["tyr:read"] }] }
  }, async (input, extra) => {
    try {
      const actor = authActor(extra.authInfo);
      requireScope(actor, "tyr:read");
      return toolResult(service.lookupReceipt(actor, input));
    } catch (error) { return toolError(error, resourceMetadataUrl); }
  });

  server.registerTool("tyr_operation_status", {
    title: "Check Tyr operation",
    description: "Read one operation's TYR public reply, management state, runtime execution statuses, and pending approvals. Later independent messages in the same conversation are available through tyr_conversation_history. Downstream Agent output is never returned directly. Optionally long-polls for up to 30 seconds.",
    inputSchema: {
      operationId: z.string().min(1),
      waitSeconds: z.number().int().min(0).max(30).default(0)
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["tyr:read"] }] }
  }, async (input, extra) => {
    try {
      const actor = authActor(extra.authInfo);
      requireScope(actor, "tyr:read");
      return toolResult(await service.waitForStatus(actor, input.operationId, input.waitSeconds));
    } catch (error) {
      return toolError(error, resourceMetadataUrl);
    }
  });

  server.registerTool("tyr_conversation_history", {
    title: "Read Tyr conversation history",
    description: "Read stored, user-visible messages from an existing Web/MCP TYR conversation without sending a new assistant query or changing the current conversation. Use after for incremental polling; messages are returned in stable chronological order. Attribution and related IDs are included only where recorded.",
    inputSchema: {
      conversationId: z.string().min(1).describe("Exact ID of an existing TYR conversation visible to the authorized user."),
      after: z.string().min(1).max(4096).optional().describe("Opaque exclusive cursor from the previous page. Omit it to read from the beginning."),
      limit: z.number().int().min(1).max(100).default(50).describe("Maximum messages per page, default 50 and maximum 100.")
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["tyr:read"] }] }
  }, async (input, extra) => {
    try {
      const actor = authActor(extra.authInfo);
      requireScope(actor, "tyr:read");
      return toolResult(service.readConversationHistory(actor, input));
    } catch (error) {
      return toolError(error, resourceMetadataUrl);
    }
  });

  server.registerTool("tyr_approval_resolve", {
    title: "Resolve Tyr approval",
    description: "Approve or reject a management confirmation or runtime approval linked to one Tyr operation. Runtime custom responses are supported. Tyr governance and final approval guards still apply.",
    inputSchema: {
      operationId: z.string().min(1),
      approvalId: z.string().min(1),
      approvalType: z.enum(["management", "runtime"]),
      decision: z.enum(["approve", "reject", "custom"]),
      customResponse: z.string().max(20_000).optional()
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true
    },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["tyr:manage"] }] }
  }, async (input, extra) => {
    try {
      const actor = authActor(extra.authInfo);
      requireScope(actor, "tyr:manage");
      return toolResult(await service.resolveApproval(actor, input));
    } catch (error) {
      return toolError(error, resourceMetadataUrl);
    }
  });

  server.registerTool("tyr_workspace_bridge_list", {
    title: "List Workspace Bridges",
    description: "List the active Workspace Bridges available from this exact Tyr workspace. Returns the current workspace separately from peer workspace names, direction, and declared permissions; it does not expose revoked history, peer private chats, or directly addressable peer Agents.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["tyr:bridge:read"] }] }
  }, async (_input, extra) => {
    try {
      const actor = authActor(extra.authInfo);
      requireScope(actor, "tyr:bridge:read");
      const bridgeActor = {
        userId: actor.userId,
        serverId: actor.serverId,
        source: "mcp" as const,
        clientId: actor.clientId,
        grantId: actor.grantId
      };
      return toolResult({
        currentWorkspace: bridgeService.currentWorkspace(bridgeActor),
        bridges: bridgeService.list(bridgeActor)
      });
    } catch (error) {
      return toolError(error, resourceMetadataUrl);
    }
  });

  server.registerTool("tyr_workspace_bridge_send", {
    title: "Send Workspace Bridge request",
    description: "Send one idempotent request to the peer TYR through an active authorized Workspace Bridge. This never sends directly to a peer Agent. Reuse conversationId for follow-ups in the same isolated Bridge topic.",
    inputSchema: {
      bridgeId: z.string().min(1),
      message: z.string().min(1).max(20_000),
      conversationId: z.string().min(1).optional(),
      idempotencyKey: z.string().min(1).max(200).optional(),
      waitSeconds: z.number().int().min(0).max(30).default(0)
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["tyr:bridge:send"] }] }
  }, async (input, extra) => {
    try {
      const actor = authActor(extra.authInfo);
      requireScope(actor, "tyr:bridge:send");
      const sent = await bridgeService.send({
        userId: actor.userId,
        serverId: actor.serverId,
        source: "mcp",
        clientId: actor.clientId,
        grantId: actor.grantId
      }, {
        bridgeId: input.bridgeId,
        content: input.message,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        idempotencyKey: bridgeIdempotencyKey(input.idempotencyKey, extra),
        waitSeconds: input.waitSeconds
      });
      return toolResult(sent.status);
    } catch (error) {
      return toolError(error, resourceMetadataUrl);
    }
  });

  server.registerTool("tyr_workspace_bridge_status", {
    title: "Check Workspace Bridge request",
    description: "Read or briefly wait for the state of one Bridge request owned by this workspace. Peer approval blockers are reported without exposing or resolving the peer approval.",
    inputSchema: {
      bridgeRequestId: z.string().min(1),
      waitSeconds: z.number().int().min(0).max(30).default(0)
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["tyr:bridge:read"] }] }
  }, async (input, extra) => {
    try {
      const actor = authActor(extra.authInfo);
      requireScope(actor, "tyr:bridge:read");
      return toolResult(await bridgeService.waitForStatus({
        userId: actor.userId,
        serverId: actor.serverId,
        source: "mcp",
        clientId: actor.clientId,
        grantId: actor.grantId
      }, input.bridgeRequestId, input.waitSeconds));
    } catch (error) {
      return toolError(error, resourceMetadataUrl);
    }
  });

  server.registerTool("tyr_workspace_bridge_history", {
    title: "Read Workspace Bridge history",
    description: "Read a bounded page from one isolated Bridge conversation owned by this workspace.",
    inputSchema: {
      bridgeId: z.string().min(1),
      conversationId: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(30),
      before: z.string().min(1).optional()
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["tyr:bridge:read"] }] }
  }, async (input, extra) => {
    try {
      const actor = authActor(extra.authInfo);
      requireScope(actor, "tyr:bridge:read");
      return toolResult(bridgeService.history({
        userId: actor.userId,
        serverId: actor.serverId,
        source: "mcp",
        clientId: actor.clientId,
        grantId: actor.grantId
      }, {
        bridgeId: input.bridgeId,
        conversationId: input.conversationId,
        limit: input.limit,
        before: input.before
      }));
    } catch (error) {
      return toolError(error, resourceMetadataUrl);
    }
  });
  return server;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]!);
}

function page(title: string, body: string, script?: { nonce: string; source: string }): string {
  const scriptTag = script ? `<script nonce="${escapeHtml(script.nonce)}">${script.source}</script>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
    :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#e8edf2;background:#11161c}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(520px,100%);box-sizing:border-box;background:#182028;border:1px solid #2b3742;border-radius:18px;padding:30px;box-shadow:0 18px 70px #0008}h1{font-size:24px;margin:0 0 10px}p{color:#aebbc7;line-height:1.55}.field{margin:16px 0}label{display:block;font-size:13px;color:#c9d3dc;margin-bottom:7px}input,select{width:100%;box-sizing:border-box;border:1px solid #3b4854;border-radius:10px;padding:11px 12px;background:#10161b;color:#fff;font:inherit}button{border:0;border-radius:10px;padding:11px 16px;font:inherit;font-weight:650;cursor:pointer}.primary{background:#e8f0f7;color:#111820}.secondary{background:#2b3540;color:#e7edf2}.actions{display:flex;gap:10px;margin-top:22px}.scope{background:#11181e;border-radius:10px;padding:12px;margin:8px 0;color:#c6d0d9}.error{color:#ffaaa2}.muted{font-size:12px;color:#84929e}[hidden]{display:none!important}</style></head><body><main class="card">${body}</main>${scriptTag}</body></html>`;
}

export function registerMcpRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const urls = externalUrls(ctx.publicServerUrl);
  const persistence = new McpPersistence(ctx.store);
  const provider = new TyrMcpOAuthProvider(persistence, urls.publicBaseUrl, urls.resourceUrl);
  const service = new McpOperationService(ctx, persistence);
  service.recoverSubmissions();
  const bridgeService = new WorkspaceBridgeRequestService(ctx);
  const sessions = new Map<string, McpSession>();
  const consentAttempts = new Map<string, FixedWindowAttempt>();
  let pendingSessionInitializations = 0;

  registerMcpAccessTokenRoutes(app, ctx, persistence, urls.resourceUrl);

  const protectedMetadata = (_req: express.Request, res: express.Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json({
      resource: urls.resourceUrl,
      resource_name: "TYR MCP",
      authorization_servers: [urls.publicBaseUrl],
      scopes_supported: [...MCP_SCOPES],
      bearer_methods_supported: ["header"]
    });
  };
  app.get(new URL(urls.protectedResourceMetadataUrl).pathname, protectedMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedMetadata);

  const authorizationMetadata = (_req: express.Request, res: express.Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json({
      issuer: urls.publicBaseUrl,
      authorization_endpoint: urls.authorizationEndpoint,
      token_endpoint: urls.tokenEndpoint,
      registration_endpoint: urls.registrationEndpoint,
      revocation_endpoint: urls.revocationEndpoint,
      scopes_supported: [...MCP_SCOPES],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      revocation_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      code_challenge_methods_supported: ["S256"]
    });
  };
  app.get(new URL(urls.authorizationServerMetadataUrl).pathname, authorizationMetadata);
  app.get("/.well-known/oauth-authorization-server", authorizationMetadata);

  const runOAuthMaintenance: express.RequestHandler = (_req, _res, next) => {
    persistence.maybePurgeExpiredOAuthData();
    next();
  };
  app.use("/oauth", runOAuthMaintenance);
  app.use("/mcp", runOAuthMaintenance);

  app.use("/oauth/register", clientRegistrationHandler({ clientsStore: provider.clientsStore }));
  app.use("/oauth/authorize", authorizationHandler({ provider }));
  app.use("/oauth/token", tokenHandler({ provider }));
  app.use("/oauth/revoke", revocationHandler({ provider }));

  const setConsentContentSecurityPolicy = (res: express.Response, callbackOrigin?: string): void => {
    const nonce = String(res.locals.consentNonce);
    const formActionSources = callbackOrigin ? `'self' ${callbackOrigin}` : "'self'";
    res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action ${formActionSources}; base-uri 'none'; frame-ancestors 'none'`);
  };

  app.use("/oauth/consent", (_req, res, next) => {
    const nonce = randomBytes(18).toString("base64url");
    res.locals.consentNonce = nonce;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    // 初始 consent 页只需同源提交；确认页会再精确加入当前 OAuth client callback origin。
    setConsentContentSecurityPolicy(res);
    next();
  });

  app.get("/oauth/consent", (req, res) => {
    const requestId = typeof req.query.request === "string" ? req.query.request : "";
    const request = persistence.getAuthorizationRequest(requestId);
    if (!request) {
      res.status(400).send(page("Authorization unavailable", "<h1>Authorization unavailable</h1><p>This authorization request is invalid or expired. Return to your MCP client and connect again.</p>"));
      return;
    }
    const sessionBootstrap = `(() => {
      const loginForm = document.getElementById("password-login-form");
      const status = document.getElementById("session-status");
      const requestInput = loginForm.querySelector('input[name="requestId"]');
      const revealPasswordLogin = () => { loginForm.hidden = false; status.hidden = true; };
      let accessToken = null;
      try { accessToken = window.localStorage.getItem(${JSON.stringify(webAuthStorageKeys(urls.publicBaseUrl).accessToken)}); } catch { accessToken = null; }
      if (!accessToken) return;
      loginForm.hidden = true;
      status.hidden = false;
      // Web token 只通过同源 Authorization header 换取短期 ticket，不进入 URL 或 consent 表单。
      fetch(loginForm.dataset.sessionEndpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestInput.value })
      }).then(async (response) => {
        if (!response.ok) throw new Error("session_unavailable");
        const result = await response.json();
        if (!result || typeof result.ticket !== "string") throw new Error("ticket_unavailable");
        const selectionForm = document.createElement("form");
        selectionForm.method = "post";
        selectionForm.action = loginForm.dataset.selectionEndpoint;
        for (const [name, value] of [["requestId", requestInput.value], ["ticket", result.ticket]]) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          selectionForm.appendChild(input);
        }
        document.body.appendChild(selectionForm);
        selectionForm.submit();
      }).catch(revealPasswordLogin);
    })();`;
    res.send(page("Connect TYR", `<h1>Connect TYR</h1><p><strong>${escapeHtml(request.clientName)}</strong> wants to connect to one of your Tyr workspaces.</p><p id="session-status" class="muted" hidden>Checking your existing Tyr session…</p><form id="password-login-form" method="post" action="${escapeHtml(urls.publicBaseUrl)}/oauth/consent/login" data-session-endpoint="${escapeHtml(urls.publicBaseUrl)}/oauth/consent/session" data-selection-endpoint="${escapeHtml(urls.publicBaseUrl)}/oauth/consent/select"><input type="hidden" name="requestId" value="${escapeHtml(request.id)}"><div class="field"><label>Email</label><input type="email" name="email" autocomplete="username" required></div><div class="field"><label>Password</label><input type="password" name="password" autocomplete="current-password" required></div><div class="actions"><button class="primary" type="submit">Continue</button></div><p class="muted">Your password is verified by Tyr and is never shared with the MCP client.</p></form>`, {
      nonce: String(res.locals.consentNonce),
      source: sessionBootstrap
    }));
  });

  const formParser = express.urlencoded({ extended: false });
  const jsonParser = express.json({ limit: "16kb" });
  const renderWorkspaceConsent = (res: express.Response, requestId: string, ticket: string, userId: string): void => {
    const request = persistence.getAuthorizationRequest(requestId);
    if (!request) {
      res.status(400).send(page("Authorization unavailable", "<h1>Authorization unavailable</h1><p>The request is invalid or expired.</p>"));
      return;
    }
    const callbackOrigin = mcpClientRedirectOrigin(request.redirectUri);
    if (!callbackOrigin) {
      console.warn("[mcp-oauth] consent render rejected", { requestId: request.id, reason: "invalid_redirect_uri" });
      res.status(400).send(page("Authorization unavailable", "<h1>Authorization unavailable</h1><p>The client callback is invalid. Return to your MCP client and connect again.</p>"));
      return;
    }
    // form-action 会检查表单提交后的 302 链，因此需要精确放行 Claude loopback 或 ChatGPT HTTPS callback origin。
    setConsentContentSecurityPolicy(res, callbackOrigin);
    const memberOnly = request.scopes.some((scope) => scope === "tyr:manage" || scope.startsWith("tyr:bridge:"));
    const workspaces = ctx.store.listServersForUser(userId).filter((workspace) => !memberOnly || workspace.role !== "guest");
    if (!workspaces.length) {
      res.status(403).send(page("No eligible workspace", "<h1>No eligible workspace</h1><p>Your account has no workspace that can grant the requested Tyr permissions.</p>"));
      return;
    }
    const options = workspaces.map((workspace) => `<option value="${escapeHtml(workspace.id)}">${escapeHtml(workspace.name)} (${escapeHtml(workspace.role)})</option>`).join("");
    const scopeDescriptions = request.scopes.map((scope) => {
      const description = scope === "tyr:manage"
        ? "Ask TYR to manage Devices/Agents and resolve linked approvals."
        : scope === "tyr:bridge:read"
          ? "Read connected Workspace Bridge metadata, request status, and isolated Bridge history."
          : scope === "tyr:bridge:send"
            ? "Send requests to a connected workspace through its peer TYR."
            : "Read Tyr Device/Agent state and operation results.";
      return `<div class="scope"><strong>${escapeHtml(scope)}</strong><br>${description}</div>`;
    }).join("");
    res.send(page("Approve Tyr access", `<h1>Approve Tyr access</h1><p>Choose the single workspace this connection may access.</p><form method="post" action="${escapeHtml(urls.publicBaseUrl)}/oauth/consent/approve"><input type="hidden" name="requestId" value="${escapeHtml(request.id)}"><input type="hidden" name="ticket" value="${escapeHtml(ticket)}"><div class="field"><label>Workspace</label><select name="serverId">${options}</select></div>${scopeDescriptions}<div class="actions"><button class="primary" type="submit">Allow</button><button class="secondary" type="submit" formaction="${escapeHtml(urls.publicBaseUrl)}/oauth/consent/deny">Deny</button></div></form>`));
  };

  app.post("/oauth/consent/session", jsonParser, (req, res) => {
    const authorization = req.header("authorization") ?? "";
    const accessToken = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1];
    const user = accessToken ? ctx.store.getUserByAccessToken(accessToken) : null;
    if (!user) {
      res.status(401).json({ error: "invalid_session" });
      return;
    }
    const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : "";
    const login = persistence.createLoginTicketForUser(requestId, user.id);
    if (!login) {
      res.status(400).json({ error: "invalid_authorization_request" });
      return;
    }
    res.json({ ticket: login.ticket });
  });

  app.post("/oauth/consent/select", formParser, (req, res) => {
    const requestId = String(req.body.requestId ?? "");
    const ticket = String(req.body.ticket ?? "");
    const userId = persistence.getLoginTicketUserId(requestId, ticket);
    if (!userId) {
      res.status(400).send(page("Authorization unavailable", "<h1>Authorization unavailable</h1><p>The request is invalid, expired, or belongs to another sign-in.</p>"));
      return;
    }
    renderWorkspaceConsent(res, requestId, ticket, userId);
  });

  const consentLoginRateLimit: express.RequestHandler = (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    // 账号只以规范化后的摘要进入内存计数器，避免保存登录邮箱明文。
    const accountHash = createHash("sha256").update(String(req.body?.email ?? "").trim().toLowerCase()).digest("hex");
    const ipRetryAfter = recordLoginAttempt(consentAttempts, `ip:${ip}`, CONSENT_LOGIN_IP_LIMIT, now);
    const accountRetryAfter = recordLoginAttempt(consentAttempts, `account:${accountHash}`, CONSENT_LOGIN_ACCOUNT_LIMIT, now);
    const retryAfter = Math.max(ipRetryAfter ?? 0, accountRetryAfter ?? 0);
    if (retryAfter > 0) {
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).send(page("Too many attempts", "<h1>Too many attempts</h1><p>Please wait before trying to sign in again.</p>"));
      return;
    }
    next();
  };
  app.post("/oauth/consent/login", formParser, consentLoginRateLimit, (req, res) => {
    const requestId = typeof req.body.requestId === "string" ? req.body.requestId : "";
    const login = persistence.createLoginTicket(requestId, String(req.body.email ?? ""), String(req.body.password ?? ""));
    const request = persistence.getAuthorizationRequest(requestId);
    if (!login || !request) {
      res.status(401).send(page("Sign in failed", `<h1>Sign in failed</h1><p class="error">The email or password is incorrect, or this authorization request expired.</p><p><a href="${escapeHtml(urls.publicBaseUrl)}/oauth/consent?request=${encodeURIComponent(requestId)}" style="color:#badaf5">Try again</a></p>`));
      return;
    }
    renderWorkspaceConsent(res, request.id, login.ticket, login.userId);
  });

  app.post("/oauth/consent/approve", formParser, (req, res) => {
    const approvalInput = {
      requestId: String(req.body.requestId ?? ""),
      ticket: String(req.body.ticket ?? ""),
      serverId: String(req.body.serverId ?? "")
    };
    const approved = persistence.approveAuthorization(approvalInput);
    if (!approved) {
      console.warn("[mcp-oauth] consent approval rejected", {
        requestId: approvalInput.requestId,
        reason: persistence.diagnoseAuthorizationApprovalFailure(approvalInput)
      });
      res.status(400).send(page("Authorization failed", "<h1>Authorization failed</h1><p>The request expired, was already used, or the workspace is not available to this account.</p><p>Close this page and start a new authorization from your MCP client.</p>"));
      return;
    }
    const target = new URL(approved.redirectUri);
    target.searchParams.set("code", approved.code);
    if (approved.state) target.searchParams.set("state", approved.state);
    res.redirect(302, target.href);
  });

  app.post("/oauth/consent/deny", formParser, (req, res) => {
    const denied = persistence.denyAuthorization(String(req.body.requestId ?? ""));
    if (!denied) {
      res.status(400).send(page("Authorization unavailable", "<h1>Authorization unavailable</h1><p>The request is invalid or expired.</p>"));
      return;
    }
    const target = new URL(denied.redirectUri);
    target.searchParams.set("error", "access_denied");
    target.searchParams.set("error_description", "The user denied TYR access.");
    if (denied.state) target.searchParams.set("state", denied.state);
    res.redirect(302, target.href);
  });

  const bearer = requireBearerAuth({
    verifier: {
      verifyAccessToken: async (token: string) => token.startsWith(MCP_PERSONAL_ACCESS_TOKEN_PREFIX)
        ? persistence.verifyPersonalAccessToken(token, urls.resourceUrl)
        : provider.verifyAccessToken(token)
    },
    requiredScopes: ["tyr:read"],
    resourceMetadataUrl: urls.protectedResourceMetadataUrl
  });
  app.use("/mcp", (req, res, next) => {
    const origin = req.header("Origin");
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.vary("Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Session-Id, MCP-Protocol-Version, Last-Event-ID");
    res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use("/mcp", bearer, async (req, res) => {
    const now = Date.now();
    for (const [staleSessionId, staleSession] of sessions) {
      if (staleSession.inFlightRequests > 0 || now - staleSession.lastUsedAt <= MCP_SESSION_IDLE_TTL_MS) continue;
      sessions.delete(staleSessionId);
      void staleSession.transport.close().catch(() => undefined);
    }
    const sessionId = req.header("mcp-session-id");
    const actor = authActor(req.auth);
    const actorKey = `${actor.grantId}:${actor.clientId}:${actor.userId}:${actor.serverId}`;
    let session = sessionId ? sessions.get(sessionId) : undefined;
    if (session && session.actorKey !== actorKey) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32001, message: "MCP session belongs to another OAuth grant." }, id: null });
      return;
    }
    if (!session && req.method === "POST" && isInitializeRequest(req.body)) {
      if (sessions.size + pendingSessionInitializations >= MCP_MAX_ACTIVE_SESSIONS) {
        let oldest: [string, McpSession] | undefined;
        for (const entry of sessions) {
          if (entry[1].inFlightRequests > 0) continue;
          if (!oldest || entry[1].lastUsedAt < oldest[1].lastUsedAt) oldest = entry;
        }
        // 达到上限时仅回收最久未使用且无在途请求的 session，避免中断 Tyr 状态长轮询。
        if (oldest) {
          sessions.delete(oldest[0]);
          void oldest[1].transport.close().catch(() => undefined);
        }
      }
      if (sessions.size + pendingSessionInitializations >= MCP_MAX_ACTIVE_SESSIONS) {
        res.setHeader("Retry-After", "1");
        res.status(503).json({ jsonrpc: "2.0", error: { code: -32002, message: "Tyr MCP session capacity is temporarily full." }, id: null });
        return;
      }
      pendingSessionInitializations += 1;
      let initializationReserved = true;
      const releaseInitializationReservation = () => {
        if (!initializationReserved) return;
        initializationReserved = false;
        pendingSessionInitializations -= 1;
      };
      const mcpServer = createTyrMcpServer(service, bridgeService, urls.protectedResourceMetadataUrl);
      let createdSession: McpSession;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (createdSessionId) => {
          sessions.set(createdSessionId, createdSession);
          releaseInitializationReservation();
        },
        onsessionclosed: (closedSessionId) => { sessions.delete(closedSessionId); }
      });
      createdSession = { transport, server: mcpServer, actorKey, lastUsedAt: now, inFlightRequests: 0 };
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      try {
        await mcpServer.connect(transport);
      } catch {
        releaseInitializationReservation();
        if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Tyr MCP session initialization failed." }, id: null });
        return;
      }
      session = createdSession;
      res.on("close", releaseInitializationReservation);
    }
    if (!session) {
      res.status(sessionId ? 404 : 400).json({ jsonrpc: "2.0", error: { code: -32000, message: sessionId ? "MCP session not found." : "Initialize the MCP session first." }, id: null });
      return;
    }
    session.lastUsedAt = now;
    session.inFlightRequests += 1;
    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Tyr MCP request failed." }, id: null });
    } finally {
      session.inFlightRequests -= 1;
    }
  });
}
