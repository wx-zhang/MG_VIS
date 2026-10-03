import { readFileSync } from "node:fs";
import type express from "express";
import type { WorkspaceSharedFilePermission } from "@tyr-ai/contracts";
import type { ServerRouteContext } from "../server-context";
import { WorkspaceSharedFileError, type WorkspaceSharedFileAssignmentInput } from "../workspace-shared-files";

function contentVariant(value: unknown): "original" | "working" {
  if (value === undefined || value === "working") return "working";
  if (value === "original") return "original";
  throw new WorkspaceSharedFileError("workspace_shared_file_variant_invalid", 400);
}

function parseAssignments(value: unknown): WorkspaceSharedFileAssignmentInput[] | undefined {
  if (value === undefined) return undefined;
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new WorkspaceSharedFileError("workspace_shared_file_assignments_invalid", 400);
    }
  }
  if (!Array.isArray(parsed)) throw new WorkspaceSharedFileError("workspace_shared_file_assignments_invalid", 400);
  return parsed.map((item) => {
    if (!item || typeof item !== "object") throw new WorkspaceSharedFileError("workspace_shared_file_assignments_invalid", 400);
    const input = item as Record<string, unknown>;
    const agentId = typeof input.agentId === "string" ? input.agentId.trim() : "";
    const permission: WorkspaceSharedFilePermission = input.permission === "read-only" ? "read-only" : input.permission === undefined || input.permission === "read-write" ? "read-write" : "read-write";
    if (!agentId || (input.permission !== undefined && input.permission !== "read-only" && input.permission !== "read-write")) {
      throw new WorkspaceSharedFileError("workspace_shared_file_assignments_invalid", 400);
    }
    return { agentId, permission };
  });
}

function sendError(res: express.Response, error: unknown): void {
  if (error instanceof WorkspaceSharedFileError) {
    res.status(error.status).json({ error: error.code });
    return;
  }
  res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
}

function owner(req: express.Request, res: express.Response, ctx: ServerRouteContext, serverId: string) {
  const user = ctx.requireAuthUser(req, res);
  if (!user) return null;
  if (!ctx.isServerOwner(user.id, serverId)) {
    res.status(403).json({ error: "workspace_owner_required" });
    return null;
  }
  return user;
}

function recordMutation(
  ctx: ServerRouteContext,
  userId: string,
  serverId: string,
  fileId: string,
  action: string,
  metadata?: Record<string, string | number | boolean | null>
): void {
  ctx.store.recordAuditEvent({
    kind: action,
    actorType: "user",
    actorId: userId,
    resourceType: "workspace_shared_file",
    resourceId: fileId,
    serverId,
    metadata
  });
  ctx.publishWorkspaceSync();
}

export function registerSharedFileRoutes(app: express.Express, ctx: ServerRouteContext): void {
  app.get("/api/servers/:serverId/shared-files", (req, res) => {
    const serverId = String(req.params.serverId);
    if (!owner(req, res, ctx, serverId)) return;
    res.json({ files: ctx.workspaceSharedFiles.list(serverId) });
  });

  app.post("/api/servers/:serverId/shared-files", ctx.upload.single("file"), (req, res) => {
    const serverId = String(req.params.serverId);
    const user = owner(req, res, ctx, serverId);
    if (!user) {
      ctx.cleanupUploadedFile(req.file);
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "workspace_shared_file_required" });
      return;
    }
    try {
      const name = ctx.uploadFilename(typeof req.body?.name === "string" ? req.body.name : req.file.originalname);
      const created = ctx.workspaceSharedFiles.create({
        serverId,
        name,
        mimeType: req.file.mimetype || "application/octet-stream",
        contents: readFileSync(req.file.path),
        assignments: parseAssignments(req.body?.assignments) ?? [],
        actor: { userId: user.id }
      });
      recordMutation(ctx, user.id, serverId, created.id, "workspace_shared_file_created", { version: created.version });
      res.status(201).json(created);
    } catch (error) {
      sendError(res, error);
    } finally {
      ctx.cleanupUploadedFile(req.file);
    }
  });

  app.patch("/api/servers/:serverId/shared-files/:fileId", (req, res) => {
    const serverId = String(req.params.serverId);
    const user = owner(req, res, ctx, serverId);
    if (!user) return;
    try {
      const updated = ctx.workspaceSharedFiles.updateMetadata({
        fileId: String(req.params.fileId),
        serverId,
        name: typeof req.body?.name === "string" ? req.body.name : undefined,
        assignments: parseAssignments(req.body?.assignments),
        actor: { userId: user.id }
      });
      recordMutation(ctx, user.id, serverId, updated.id, "workspace_shared_file_updated", { version: updated.version });
      res.json(updated);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.put("/api/servers/:serverId/shared-files/:fileId/content", ctx.upload.single("file"), (req, res) => {
    const serverId = String(req.params.serverId);
    const user = owner(req, res, ctx, serverId);
    if (!user) {
      ctx.cleanupUploadedFile(req.file);
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "workspace_shared_file_required" });
      return;
    }
    try {
      const expectedVersion = Number(req.body?.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new WorkspaceSharedFileError("workspace_shared_file_version_invalid", 400);
      const updated = ctx.workspaceSharedFiles.replace({
        fileId: String(req.params.fileId),
        serverId,
        expectedVersion,
        mimeType: req.file.mimetype || "application/octet-stream",
        contents: readFileSync(req.file.path)
      });
      recordMutation(ctx, user.id, serverId, updated.id, "workspace_shared_file_replaced", { version: updated.version });
      res.json(updated);
    } catch (error) {
      sendError(res, error);
    } finally {
      ctx.cleanupUploadedFile(req.file);
    }
  });

  app.put("/api/servers/:serverId/shared-files/:fileId/original-content", ctx.upload.single("file"), (req, res) => {
    const serverId = String(req.params.serverId);
    const user = owner(req, res, ctx, serverId);
    if (!user) {
      ctx.cleanupUploadedFile(req.file);
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "workspace_shared_file_required" });
      return;
    }
    try {
      const expectedVersion = Number(req.body?.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new WorkspaceSharedFileError("workspace_shared_file_version_invalid", 400);
      const updated = ctx.workspaceSharedFiles.replaceOriginal({
        fileId: String(req.params.fileId),
        serverId,
        expectedVersion,
        originalName: ctx.uploadFilename(req.file.originalname),
        mimeType: req.file.mimetype || "application/octet-stream",
        contents: readFileSync(req.file.path)
      });
      recordMutation(ctx, user.id, serverId, updated.id, "workspace_shared_file_original_replaced", { version: updated.version });
      res.json(updated);
    } catch (error) {
      sendError(res, error);
    } finally {
      ctx.cleanupUploadedFile(req.file);
    }
  });

  app.get("/api/servers/:serverId/shared-files/:fileId/content", (req, res) => {
    const serverId = String(req.params.serverId);
    if (!owner(req, res, ctx, serverId)) return;
    let result;
    try {
      result = ctx.workspaceSharedFiles.content(String(req.params.fileId), serverId, contentVariant(req.query.variant));
    } catch (error) {
      sendError(res, error);
      return;
    }
    if (!result) {
      res.status(404).json({ error: "workspace_shared_file_not_found" });
      return;
    }
    const disposition = req.query.disposition === "inline" ? "inline" : "attachment";
    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Length", String(result.contents.byteLength));
    res.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(result.name)}`);
    res.send(result.contents);
  });

  app.post("/api/servers/:serverId/shared-files/:fileId/reset", (req, res) => {
    const serverId = String(req.params.serverId);
    const user = owner(req, res, ctx, serverId);
    if (!user) return;
    try {
      const expectedVersion = Number(req.body?.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new WorkspaceSharedFileError("workspace_shared_file_version_invalid", 400);
      const reset = ctx.workspaceSharedFiles.reset({
        fileId: String(req.params.fileId),
        serverId,
        expectedVersion
      });
      recordMutation(ctx, user.id, serverId, reset.id, "workspace_shared_file_reset", {
        previousVersion: expectedVersion,
        version: reset.version
      });
      res.json(reset);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete("/api/servers/:serverId/shared-files/:fileId", (req, res) => {
    const serverId = String(req.params.serverId);
    const user = owner(req, res, ctx, serverId);
    if (!user) return;
    try {
      const removed = ctx.workspaceSharedFiles.delete(String(req.params.fileId), serverId);
      recordMutation(ctx, user.id, serverId, removed.id, "workspace_shared_file_deleted", { version: removed.version });
      res.json({ ok: true, file: removed });
    } catch (error) {
      sendError(res, error);
    }
  });
}
