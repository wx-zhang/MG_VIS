import type express from "express";
import type { ServerRouteContext } from "../server-context";

function emailError(res: express.Response, error: unknown) {
  const code = error instanceof Error ? error.message : "internal_error";
  const status = {
    communication_agent_not_found: 404, server_membership_required: 403, server_owner_required: 403,
    invalid_email_alias: 400, reserved_email_alias: 400, email_alias_taken: 409, email_alias_changed: 409
  }[code];
  if (!status) throw error;
  res.status(status).json({ error: code });
}

export function registerCommunicationEmailRoutes(app: express.Express, ctx: ServerRouteContext) {
  app.get("/api/agents/:agentId/email", (req, res) => {
    const user = ctx.requireAuthUser(req, res);
    if (!user) return;
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json(ctx.store.getCommunicationAgentEmailSettings({ agentId: req.params.agentId, userId: user.id,
        ...(typeof req.query.localPart === "string" ? { localPart: req.query.localPart } : {}) }));
    } catch (error) { emailError(res, error); }
  });

  app.patch("/api/agents/:agentId/email", (req, res) => {
    const user = ctx.requireAuthUser(req, res);
    if (!user) return;
    if (typeof req.body?.localPart !== "string" || typeof req.body?.expectedAddress !== "string") {
      res.status(400).json({ error: "invalid_email_alias" });
      return;
    }
    try {
      const settings = ctx.store.updateCommunicationAgentEmailAlias({ agentId: req.params.agentId, userId: user.id,
        localPart: req.body.localPart, expectedAddress: req.body.expectedAddress });
      ctx.publishWorkspaceSync();
      res.json(settings);
    } catch (error) { emailError(res, error); }
  });
}
