import type express from "express";
import type { ServerRouteContext } from "../server-context";
import { HumanReplyError } from "../workspace-bridge-human-replies";

export function registerHumanReplyRoutes(app: express.Express, ctx: ServerRouteContext) {
  const route = (handler: (req: express.Request, res: express.Response, userId: string) => void): express.RequestHandler => (req, res) => {
    const user = ctx.requireAuthUser(req, res);
    if (!user) return;
    if (!ctx.humanReplies) { res.status(503).json({ error: "personal_replies_unavailable" }); return; }
    try { handler(req, res, user.id); }
    catch (error) {
      const code = error instanceof HumanReplyError ? error.message : "personal_reply_failed";
      const status = !(error instanceof HumanReplyError) ? 500 : code === "workspace_owner_required" ? 403
        : code.endsWith("not_found") ? 404 : code.startsWith("invalid_") ? 400 : 409;
      res.status(status).json({ error: code });
    }
  };
  app.get("/api/personal-replies/preferences", route((_req, res, userId) => res.json(ctx.humanReplies!.preferences(userId))));
  app.patch("/api/personal-replies/preferences", route((req, res, userId) => res.json(ctx.humanReplies!.setMode(userId, req.body?.mode))));
  app.get("/api/servers/:serverId/personal-replies", route((req, res, userId) =>
    res.json({ requests: ctx.humanReplies!.list(userId, String(req.params.serverId)) })));
  app.post("/api/personal-replies/:requestId/reply", route((req, res, userId) =>
    res.json(ctx.humanReplies!.reply(String(req.params.requestId), userId, req.body?.content))));
}
