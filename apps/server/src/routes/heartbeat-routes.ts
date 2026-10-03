import type express from "express";
import type { TyrHeartbeatIntervalUnit, TyrHeartbeatListPayload } from "@tyr-ai/contracts";

import type { ServerRouteContext } from "../server-context";

function intervalUnit(value: unknown): TyrHeartbeatIntervalUnit | undefined {
  return value === "minute" || value === "hour" ? value : undefined;
}

function heartbeatErrorStatus(error: unknown): number {
  const code = error instanceof Error ? error.message : String(error);
  if (code === "heartbeat_tyr_agent_required") return 404;
  return code.startsWith("heartbeat_") ? 400 : 500;
}

function listPayload(ctx: ServerRouteContext, serverId: string, limit: number): TyrHeartbeatListPayload {
  return {
    heartbeats: ctx.store.listTyrHeartbeats(serverId),
    runs: ctx.store.listTyrHeartbeatRuns({ serverId, limit })
  };
}

export function registerHeartbeatRoutes(app: express.Express, ctx: ServerRouteContext): void {
  const { store, requireAuthUser, isServerOwner, publishWorkspaceSync } = ctx;

  app.get("/api/servers/:serverId/heartbeats", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    if (!isServerOwner(user.id, req.params.serverId)) {
      res.status(403).json({ error: "server_owner_required" });
      return;
    }
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 100) || 100));
    res.json(listPayload(ctx, req.params.serverId, limit));
  });

  app.post("/api/servers/:serverId/heartbeats", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const serverId = req.params.serverId;
    if (!isServerOwner(user.id, serverId)) {
      res.status(403).json({ error: "server_owner_required" });
      return;
    }
    try {
      const tyr = store.ensureDefaultCommunicationAgent(serverId);
      const heartbeat = store.createTyrHeartbeat({
        serverId,
        tyrAgentId: tyr.id,
        title: String(req.body?.title ?? ""),
        instruction: String(req.body?.instruction ?? ""),
        intervalUnit: intervalUnit(req.body?.intervalUnit) ?? req.body?.intervalUnit,
        intervalValue: Number(req.body?.intervalValue),
        createdByUserId: user.id
      });
      store.recordAuditEvent({
        kind: "tyr_heartbeat_created",
        actorType: "user",
        actorId: user.id,
        resourceType: "server",
        resourceId: serverId,
        serverId,
        metadata: { heartbeatId: heartbeat.id }
      });
      publishWorkspaceSync();
      res.status(201).json({ heartbeat });
    } catch (error) {
      res.status(heartbeatErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch("/api/servers/:serverId/heartbeats/:heartbeatId", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    const serverId = req.params.serverId;
    if (!isServerOwner(user.id, serverId)) {
      res.status(403).json({ error: "server_owner_required" });
      return;
    }
    try {
      const heartbeat = store.updateTyrHeartbeat(req.params.heartbeatId, serverId, {
        ...(Object.prototype.hasOwnProperty.call(req.body, "title") ? { title: String(req.body.title ?? "") } : {}),
        ...(Object.prototype.hasOwnProperty.call(req.body, "instruction") ? { instruction: String(req.body.instruction ?? "") } : {}),
        ...(Object.prototype.hasOwnProperty.call(req.body, "intervalUnit") ? { intervalUnit: intervalUnit(req.body.intervalUnit) ?? req.body.intervalUnit } : {}),
        ...(Object.prototype.hasOwnProperty.call(req.body, "intervalValue") ? { intervalValue: Number(req.body.intervalValue) } : {}),
        ...(Object.prototype.hasOwnProperty.call(req.body, "enabled") ? { enabled: req.body.enabled === true } : {})
      });
      if (!heartbeat) {
        res.status(404).json({ error: "heartbeat_not_found" });
        return;
      }
      // Owner 显式暂停时撤销所有尚未开始的周期；已运行任务继续由 scheduler 收口。
      const cancelledRuns = Object.prototype.hasOwnProperty.call(req.body, "enabled") && req.body.enabled !== true
        ? store.cancelQueuedTyrHeartbeatRuns(heartbeat.id)
        : [];
      store.recordAuditEvent({
        kind: "tyr_heartbeat_updated",
        actorType: "user",
        actorId: user.id,
        resourceType: "server",
        resourceId: serverId,
        serverId,
        metadata: { heartbeatId: heartbeat.id, enabled: heartbeat.enabled, cancelledQueuedRuns: cancelledRuns.length }
      });
      publishWorkspaceSync();
      res.json({ heartbeat, cancelledRuns });
    } catch (error) {
      res.status(heartbeatErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
