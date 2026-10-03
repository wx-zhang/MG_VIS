import type express from "express";
import type {
  McpPersonalAccessTokenExpirationDays,
  McpPersonalAccessTokenScope
} from "@tyr-ai/contracts";
import {
  MCP_PERSONAL_ACCESS_TOKEN_EXPIRATION_DAYS,
  McpPersistence
} from "../mcp-persistence";
import type { ServerRouteContext } from "../server-context";

const DEFAULT_EXPIRATION_DAYS: McpPersonalAccessTokenExpirationDays = 90;

function requestedScopes(value: unknown): McpPersonalAccessTokenScope[] {
  if (value === undefined) return ["tyr:read"];
  const supported: McpPersonalAccessTokenScope[] = [
    "tyr:read",
    "tyr:manage",
    "tyr:bridge:read",
    "tyr:bridge:send"
  ];
  if (!Array.isArray(value) || value.some((scope) => !supported.includes(scope as McpPersonalAccessTokenScope))) {
    throw new Error("mcp_access_token_scopes_invalid");
  }
  return [...new Set(["tyr:read", ...value])] as McpPersonalAccessTokenScope[];
}

function expirationDays(value: unknown): McpPersonalAccessTokenExpirationDays {
  const parsed = value === undefined ? DEFAULT_EXPIRATION_DAYS : Number(value);
  if (!MCP_PERSONAL_ACCESS_TOKEN_EXPIRATION_DAYS.includes(parsed as McpPersonalAccessTokenExpirationDays)) {
    throw new Error("mcp_access_token_expiration_invalid");
  }
  return parsed as McpPersonalAccessTokenExpirationDays;
}

function sendError(res: express.Response, error: unknown): void {
  const code = error instanceof Error ? error.message : "mcp_access_token_failed";
  if (code === "server_membership_required" || code === "mcp_access_token_manage_forbidden" || code === "invalid_current_password") {
    res.status(403).json({ error: code });
    return;
  }
  if (code === "mcp_access_token_not_found") {
    res.status(404).json({ error: code });
    return;
  }
  if (code === "mcp_access_token_limit_reached" || code === "mcp_access_token_inactive") {
    res.status(409).json({ error: code });
    return;
  }
  if (code.startsWith("mcp_access_token_")) {
    res.status(400).json({ error: code });
    return;
  }
  console.error("[mcp-access-token] request failed", error);
  res.status(500).json({ error: "mcp_access_token_failed" });
}

function requirePassword(ctx: ServerRouteContext, userId: string, password: unknown): void {
  if (typeof password !== "string" || !ctx.store.verifyUserPassword(userId, password)) {
    throw new Error("invalid_current_password");
  }
}

export function registerMcpAccessTokenRoutes(
  app: express.Express,
  ctx: ServerRouteContext,
  persistence: McpPersistence,
  resourceUrl: string
): void {
  app.get("/api/servers/:serverId/mcp-access-tokens", (req, res) => {
    const user = ctx.requireAuthUser(req, res);
    if (!user) return;
    if (!ctx.isServerMember(user.id, req.params.serverId)) {
      res.status(403).json({ error: "server_membership_required" });
      return;
    }
    // Endpoint 由服务端返回，确保 Web 教程在本地、测试与生产反代路径下使用同一真源。
    res.json({
      resource: resourceUrl,
      tokens: persistence.listPersonalAccessTokens(user.id, req.params.serverId)
    });
  });

  app.post("/api/servers/:serverId/mcp-access-tokens", (req, res) => {
    try {
      const user = ctx.requireAuthUser(req, res);
      if (!user) return;
      requirePassword(ctx, user.id, req.body?.currentPassword);
      const created = persistence.createPersonalAccessToken({
        userId: user.id,
        serverId: req.params.serverId,
        name: String(req.body?.name ?? ""),
        scopes: requestedScopes(req.body?.scopes),
        expirationDays: expirationDays(req.body?.expirationDays),
        resource: resourceUrl
      });
      // 明文凭据只能出现在这一次 no-store 响应中，后续列表只返回 prefix 和生命周期元数据。
      res.setHeader("Cache-Control", "no-store");
      res.status(201).json(created);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/servers/:serverId/mcp-access-tokens/:tokenId/rotate", (req, res) => {
    try {
      const user = ctx.requireAuthUser(req, res);
      if (!user) return;
      requirePassword(ctx, user.id, req.body?.currentPassword);
      const existing = persistence.getPersonalAccessToken(req.params.tokenId, user.id, req.params.serverId);
      if (!existing) throw new Error("mcp_access_token_not_found");
      if (existing.revokedAt || new Date(existing.expiresAt).getTime() <= Date.now()) {
        throw new Error("mcp_access_token_inactive");
      }
      const rotated = persistence.createPersonalAccessToken({
        userId: user.id,
        serverId: req.params.serverId,
        name: existing.name,
        scopes: existing.scopes,
        expirationDays: expirationDays(req.body?.expirationDays),
        resource: resourceUrl,
        replacingTokenId: existing.id
      });
      res.setHeader("Cache-Control", "no-store");
      res.status(201).json(rotated);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete("/api/servers/:serverId/mcp-access-tokens/:tokenId", (req, res) => {
    try {
      const user = ctx.requireAuthUser(req, res);
      if (!user) return;
      const revoked = persistence.revokePersonalAccessToken({
        id: req.params.tokenId,
        userId: user.id,
        serverId: req.params.serverId
      });
      if (!revoked) throw new Error("mcp_access_token_not_found");
      res.json({ token: revoked });
    } catch (error) {
      sendError(res, error);
    }
  });
}
