import type express from "express";
import { MAX_WORKSPACE_ROUTING_INSTRUCTIONS_LENGTH } from "@tyr-ai/contracts";
import { governanceRuntimeHealth } from "../governance-runtime";
import { safetyAuditHealth } from "../safety-audit";
import type { ServerRouteContext } from "../server-context";
import { sanitizeHumanVisibleValue } from "../output-disclosure";

export function registerCoreRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const {
    store,
    publicServerUrl,
    safetyAuditConfig,
    governanceConfig,
    daemonSockets,
    syncClients,
    requireAuthUser,
    authUser,
    isServerMember,
    writeWorkspaceBootstrapSync,
    publishWorkspaceSync,
    formatPublicMessage
  } = ctx;

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      serverUrl: publicServerUrl,
      safetyAudit: safetyAuditHealth(safetyAuditConfig),
      governance: governanceRuntimeHealth(governanceConfig),
      daemon: {
        connectedMachines: daemonSockets.size,
        devRestartHint: "pnpm dev starts server and web only; restart the local runtime daemon with pnpm dev:daemon:real."
      }
    });
  });

  app.get("/api/deployment-notice", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json({ notice: ctx.deploymentNotice?.read() ?? null });
    } catch {
      res.status(503).json({ error: "deployment_notice_unavailable" });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    res.json(user);
  });

  app.patch("/api/auth/me", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const updated = store.updateUserProfile(user.id, {
      displayName: typeof req.body?.displayName === "string" ? req.body.displayName : undefined,
      description: req.body?.description === null || typeof req.body?.description === "string" ? req.body.description : undefined,
      preferredLanguage: req.body?.preferredLanguage === null || typeof req.body?.preferredLanguage === "string" ? req.body.preferredLanguage : undefined
    });
    publishWorkspaceSync();
    res.json(updated);
  });

  app.post("/api/auth/password", (req, res) => {
    try {
      const user = requireAuthUser(req, res);
      if (!user) return;
      const ok = store.changeUserPassword(user.id, String(req.body?.currentPassword ?? ""), String(req.body?.newPassword ?? ""));
      if (!ok) {
        res.status(400).json({ error: "invalid_current_password" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "password_change_failed" });
    }
  });

  app.post("/api/auth/password/setup", (req, res) => {
    try {
      const user = requireAuthUser(req, res);
      if (!user) return;
      const updated = store.setupUserPassword(user.id, String(req.body?.newPassword ?? ""));
      publishWorkspaceSync();
      res.json({ ok: true, user: updated });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "password_setup_failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    store.logoutSession(String(req.body?.refreshToken ?? ""));
    res.json({ ok: true });
  });

  app.post("/api/auth/refresh", (req, res) => {
    const result = store.refreshSession(String(req.body?.refreshToken ?? ""));
    if (!result) {
      res.status(401).json({ error: "invalid_refresh_token" });
      return;
    }
    res.json(result);
  });

  app.post("/api/auth/register", (req, res) => {
    try {
      const result = store.registerUser({
        email: String(req.body?.email ?? ""),
        password: String(req.body?.password ?? ""),
        name: String(req.body?.name ?? ""),
        serverName: typeof req.body?.serverName === "string" ? req.body.serverName : undefined
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "register_failed" });
    }
  });

  app.post("/api/auth/login", (req, res) => {
    const result = store.loginUser({
      email: String(req.body?.email ?? ""),
      password: String(req.body?.password ?? "")
    });
    if (!result) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    res.json(result);
  });

  app.get("/api/auth/invites", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    res.json(store.listIncomingServerInvites(user.email ?? ""));
  });

  app.post("/api/auth/invites/:inviteId/accept", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const invite = store.acceptServerInviteForUser(req.params.inviteId, user.id);
    if (!invite) {
      res.status(404).json({ error: "invite_not_found" });
      return;
    }
    publishWorkspaceSync();
    res.json({ ok: true, invite, bootstrap: store.workspaceBootstrap(user.id) });
  });

  app.post("/api/login", (_req, res) => {
    res.status(410).json({ error: "use_/api/auth/login" });
  });

  app.get("/api/servers", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    res.json(store.listServersForUser(user.id));
  });

  app.post("/api/servers", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    // Workspace 是产品展示名；server 仅保留为兼容 API 与数据模型术语。
    const name = String(req.body?.name ?? "").trim() || `${user.displayName || user.name}'s Workspace`;
    const serverRecord = store.createServer({ name, ownerUserId: user.id });
    res.json(serverRecord);
  });

  app.use("/api", (req, res, next) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const serverMatch = /^\/servers\/([^/]+)/.exec(req.path);
    const requestedServerId = serverMatch?.[1] === "unread-summary" ? undefined : serverMatch?.[1];
    if (!isServerMember(user.id, requestedServerId)) {
      res.status(403).json({ error: "server_membership_required" });
      return;
    }
    next();
  });

  app.post("/api/servers/:serverId/activate", (req, res) => {
    const user = authUser(req);
    const serverRecord = store.setActiveServerForUser(user.id, req.params.serverId);
    if (!serverRecord) {
      res.status(403).json({ error: "server_membership_required" });
      return;
    }
    res.json({ server: serverRecord, bootstrap: store.workspaceBootstrap(user.id) });
  });

  app.patch("/api/servers/:serverId", (req, res) => {
    const user = authUser(req);
    const serverRecord = store.listServersForUser(user.id).find((server) => server.id === req.params.serverId);
    if (!serverRecord || serverRecord.role !== "owner") {
      res.status(403).json({ error: "server_owner_required" });
      return;
    }
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "server_name_required" });
      return;
    }
    if (name.length > 80) {
      res.status(400).json({ error: "server_name_too_long" });
      return;
    }
    const updated = store.updateServerName(serverRecord.id, name);
    if (!updated) {
      res.status(404).json({ error: "server_not_found" });
      return;
    }
    publishWorkspaceSync();
    res.json({ server: updated, bootstrap: store.workspaceBootstrap(user.id) });
  });

  app.get("/api/servers/:serverId/routing-instructions", (req, res) => {
    const user = authUser(req);
    const serverRecord = store.listServersForUser(user.id).find((server) => server.id === req.params.serverId);
    // 路由规则属于 Workspace 私有配置；成员可读取当前生效版本，但不能用任意 serverId 跨 Workspace 探测。
    if (!serverRecord) {
      res.status(404).json({ error: "server_not_found" });
      return;
    }
    res.json(store.getWorkspaceRoutingInstructions(req.params.serverId));
  });

  app.patch("/api/servers/:serverId/routing-instructions", (req, res) => {
    const user = authUser(req);
    const serverRecord = store.listServersForUser(user.id).find((server) => server.id === req.params.serverId);
    if (!serverRecord || serverRecord.role !== "owner") {
      res.status(403).json({ error: "server_owner_required" });
      return;
    }
    if (typeof req.body?.instructions !== "string") {
      res.status(400).json({ error: "routing_instructions_required" });
      return;
    }
    if (req.body.instructions.length > MAX_WORKSPACE_ROUTING_INSTRUCTIONS_LENGTH) {
      res.status(400).json({ error: "routing_instructions_too_long" });
      return;
    }
    // TYR 是服务端 Agent，配置保存后对 Web、Email、Telegram 等所有入口立即生效，无需 daemon ACK。
    const updated = store.setWorkspaceRoutingInstructions(serverRecord.id, req.body.instructions, user.id);
    if (!updated) {
      res.status(404).json({ error: "server_not_found" });
      return;
    }
    publishWorkspaceSync();
    res.json(updated);
  });

  app.get("/api/sync", (req, res) => {
    if (req.query.stream === "1") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      });
      const userId = authUser(req).id;
      syncClients.set(res, userId);
      writeWorkspaceBootstrapSync(res, userId);
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(heartbeat);
        syncClients.delete(res);
      });
      return;
    }
    const sinceSeq = req.query.since_seq ? Number(req.query.since_seq) : 0;
    const channelId = req.query.channel_id as string | undefined;
    const user = authUser(req);
    if (channelId && !store.canUserAccessChannel(user.id, channelId)) {
      res.status(404).json({ error: "channel_not_found" });
      return;
    }
    const messages = store.listVisibleMessages(user.id, { channelId, sinceSeq, limit: 500 });
    const agentsPage = store.workspaceNavigation(user.id, { section: "agents", limit: 100 });
    const machinesPage = store.workspaceNavigation(user.id, { section: "machines", limit: 100 });
    res.json(sanitizeHumanVisibleValue({
      ok: true,
      sinceSeq,
      latestSeq: store.latestVisibleMessageSeq(user.id, channelId),
      messages: messages.map(formatPublicMessage),
      tasks: [],
      agents: agentsPage.items,
      machines: machinesPage.items
    }));
  });

  app.get("/api/messages/sync", (req, res) => {
    const user = authUser(req);
    const sinceSeq = req.query.since_seq ? Number(req.query.since_seq) : 0;
    const channelId = req.query.channel_id as string | undefined;
    const limit = Math.max(1, Math.min(req.query.limit ? Number(req.query.limit) : 200, 500));
    if (channelId && !store.canUserAccessChannel(user.id, channelId)) {
      res.status(404).json({ error: "channel_not_found" });
      return;
    }
    res.json(store.listVisibleMessages(user.id, { channelId, sinceSeq, limit }).map(formatPublicMessage));
  });

  app.get("/api/messages/channel/:channelId", (req, res) => {
    const user = authUser(req);
    if (!store.canUserAccessChannel(user.id, req.params.channelId)) {
      res.status(404).json({ error: "channel_not_found" });
      return;
    }
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    res.json({ messages: store.listMessages(req.params.channelId, limit).map(formatPublicMessage), historyLimited: false });
  });
}
