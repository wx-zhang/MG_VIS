import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isCommunicationAgent, type AgentSharedFileSnapshot, type WorkspaceSharedFilePermission, type WorkspaceSharedFileRecord } from "@tyr-ai/contracts";
import type { TyrDb, WorkspaceSharedFileStoredRecord } from "@tyr-ai/db";

const MAX_SHARED_FILE_BYTES = 50 * 1024 * 1024;

export class WorkspaceSharedFileError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

export type WorkspaceSharedFileAssignmentInput = {
  agentId: string;
  permission: WorkspaceSharedFilePermission;
};

type Actor = { userId?: string; operatorId?: string };

function safeUnlink(filePath: string | undefined): void {
  if (!filePath || !existsSync(filePath)) return;
  try {
    unlinkSync(filePath);
  } catch {
    // 元数据已经成为真源后，旧版本清理失败只留下不可访问的孤儿文件，不回滚已完成的更新。
  }
}

function fileBuffer(value: Buffer): Buffer {
  if (value.byteLength > MAX_SHARED_FILE_BYTES) throw new WorkspaceSharedFileError("workspace_shared_file_too_large", 413);
  return value;
}

function validateJson(name: string, mimeType: string, contents: Buffer): void {
  if (!name.toLowerCase().endsWith(".json") && !mimeType.toLowerCase().includes("json")) return;
  try {
    JSON.parse(contents.toString("utf8"));
  } catch {
    throw new WorkspaceSharedFileError("workspace_shared_file_json_invalid", 400);
  }
}

function publicFile(file: WorkspaceSharedFileStoredRecord): WorkspaceSharedFileRecord {
  const { storagePath: _storagePath, originalStoragePath: _originalStoragePath, ...record } = file;
  return record;
}

export type WorkspaceSharedFileVariant = "original" | "working";

export class WorkspaceSharedFileService {
  constructor(
    readonly store: TyrDb,
    readonly rootDir: string,
    readonly syncAgent: (agentId: string) => void
  ) {
    mkdirSync(rootDir, { recursive: true });
  }

  list(serverId: string): WorkspaceSharedFileRecord[] {
    return this.store.listWorkspaceSharedFiles(serverId);
  }

  get(fileId: string, serverId: string): WorkspaceSharedFileStoredRecord | null {
    return this.store.getWorkspaceSharedFile(fileId, serverId);
  }

  content(
    fileId: string,
    serverId: string,
    variant: WorkspaceSharedFileVariant = "working"
  ): { file: WorkspaceSharedFileRecord; contents: Buffer; variant: WorkspaceSharedFileVariant; name: string; mimeType: string; sizeBytes: number; sha256: string } | null {
    const file = this.store.getWorkspaceSharedFile(fileId, serverId);
    if (!file) return null;
    const original = variant === "original";
    const storagePath = original ? file.originalStoragePath : file.storagePath;
    if (!existsSync(storagePath)) return null;
    return {
      file: publicFile(file),
      contents: readFileSync(storagePath),
      variant,
      name: original ? file.originalName : file.name,
      mimeType: original ? file.originalMimeType : file.mimeType,
      sizeBytes: original ? file.originalSizeBytes : file.sizeBytes,
      sha256: original ? file.originalSha256 : file.sha256
    };
  }

  snapshots(agentId: string): AgentSharedFileSnapshot[] {
    return this.store.listAgentSharedFiles(agentId).flatMap(({ file, permission }) => {
      if (!existsSync(file.storagePath)) return [];
      return [{
        fileId: file.id,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        version: file.version,
        permission,
        contentBase64: readFileSync(file.storagePath).toString("base64")
      }];
    });
  }

  create(input: {
    serverId: string;
    name: string;
    mimeType: string;
    contents: Buffer;
    assignments: WorkspaceSharedFileAssignmentInput[];
    actor: Actor;
  }): WorkspaceSharedFileRecord {
    this.validateAssignments(input.serverId, input.assignments);
    const contents = fileBuffer(input.contents);
    validateJson(input.name, input.mimeType, contents);
    const fileId = `workspace_file_${randomUUID().replaceAll("-", "")}`;
    const originalStoragePath = this.originalPath(input.serverId, fileId);
    const storagePath = this.versionPath(input.serverId, fileId, 1);
    // The immutable upload and Agent working copy are separate blobs from the first write boundary onward.
    this.writeAtomically(originalStoragePath, contents);
    this.writeAtomically(storagePath, contents);
    let created: WorkspaceSharedFileStoredRecord | null = null;
    try {
      created = this.store.createWorkspaceSharedFile({
        id: fileId,
        serverId: input.serverId,
        name: input.name,
        mimeType: input.mimeType || "application/octet-stream",
        sizeBytes: contents.byteLength,
        sha256: createHash("sha256").update(contents).digest("hex"),
        storagePath,
        originalName: input.name,
        originalMimeType: input.mimeType || "application/octet-stream",
        originalSizeBytes: contents.byteLength,
        originalSha256: createHash("sha256").update(contents).digest("hex"),
        originalStoragePath,
        createdByUserId: input.actor.userId,
        createdByOperatorId: input.actor.operatorId
      });
      const assigned = this.store.setWorkspaceSharedFileAssignments({
        fileId,
        serverId: input.serverId,
        assignments: input.assignments,
        createdByUserId: input.actor.userId,
        createdByOperatorId: input.actor.operatorId
      });
      if (!assigned) throw new Error("workspace_shared_file_not_found");
      this.syncAgents(input.assignments.map((assignment) => assignment.agentId));
      return assigned;
    } catch (error) {
      if (created) this.store.deleteWorkspaceSharedFile(fileId, input.serverId);
      safeUnlink(storagePath);
      safeUnlink(originalStoragePath);
      throw this.normalizeError(error);
    }
  }

  replace(input: {
    fileId: string;
    serverId: string;
    expectedVersion: number;
    name?: string;
    mimeType: string;
    contents: Buffer;
  }): WorkspaceSharedFileRecord {
    const current = this.store.getWorkspaceSharedFile(input.fileId, input.serverId);
    if (!current) throw new WorkspaceSharedFileError("workspace_shared_file_not_found", 404);
    if (current.version !== input.expectedVersion) throw new WorkspaceSharedFileError("workspace_shared_file_version_conflict", 409);
    const contents = fileBuffer(input.contents);
    const name = input.name ?? current.name;
    validateJson(name, input.mimeType, contents);
    const storagePath = this.versionPath(input.serverId, input.fileId, input.expectedVersion + 1);
    this.writeAtomically(storagePath, contents);
    try {
      const updated = this.store.replaceWorkspaceSharedFile({
        fileId: input.fileId,
        serverId: input.serverId,
        expectedVersion: input.expectedVersion,
        name,
        mimeType: input.mimeType || "application/octet-stream",
        sizeBytes: contents.byteLength,
        sha256: createHash("sha256").update(contents).digest("hex"),
        storagePath
      });
      if (!updated) throw new WorkspaceSharedFileError("workspace_shared_file_version_conflict", 409);
      // A legacy row can initially point both variants at the same blob; that baseline must remain immutable.
      if (current.storagePath !== current.originalStoragePath) safeUnlink(current.storagePath);
      this.syncAgents(updated.assignments.map((assignment) => assignment.agentId));
      return publicFile(updated);
    } catch (error) {
      safeUnlink(storagePath);
      throw this.normalizeError(error);
    }
  }

  replaceOriginal(input: {
    fileId: string;
    serverId: string;
    expectedVersion: number;
    originalName: string;
    mimeType: string;
    contents: Buffer;
  }): WorkspaceSharedFileRecord {
    const current = this.store.getWorkspaceSharedFile(input.fileId, input.serverId);
    if (!current) throw new WorkspaceSharedFileError("workspace_shared_file_not_found", 404);
    if (current.version !== input.expectedVersion) throw new WorkspaceSharedFileError("workspace_shared_file_version_conflict", 409);
    const contents = fileBuffer(input.contents);
    validateJson(input.originalName, input.mimeType, contents);
    const storagePath = this.originalPath(input.serverId, input.fileId);
    this.writeAtomically(storagePath, contents);
    let updated: WorkspaceSharedFileStoredRecord;
    try {
      const replaced = this.store.replaceWorkspaceSharedFileOriginal({
        fileId: input.fileId,
        serverId: input.serverId,
        expectedVersion: input.expectedVersion,
        originalName: input.originalName,
        mimeType: input.mimeType || "application/octet-stream",
        sizeBytes: contents.byteLength,
        sha256: createHash("sha256").update(contents).digest("hex"),
        storagePath
      });
      if (!replaced) throw new WorkspaceSharedFileError("workspace_shared_file_version_conflict", 409);
      updated = replaced;
    } catch (error) {
      safeUnlink(storagePath);
      throw this.normalizeError(error);
    }
    // Legacy rows may share one blob between the original and working copy.
    if (current.originalStoragePath !== current.storagePath) safeUnlink(current.originalStoragePath);
    this.syncAgents(updated.assignments.map((assignment) => assignment.agentId));
    return publicFile(updated);
  }

  updateMetadata(input: {
    fileId: string;
    serverId: string;
    name?: string;
    assignments?: WorkspaceSharedFileAssignmentInput[];
    actor: Actor;
  }): WorkspaceSharedFileRecord {
    const current = this.store.getWorkspaceSharedFile(input.fileId, input.serverId);
    if (!current) throw new WorkspaceSharedFileError("workspace_shared_file_not_found", 404);
    if (input.name !== undefined) {
      const normalized = input.name.trim();
      if (!normalized || normalized === "." || normalized === ".." || path.basename(normalized) !== normalized || /[\\/\0]/.test(normalized)) {
        throw new WorkspaceSharedFileError("workspace_shared_file_name_invalid", 400);
      }
      if (this.store.listWorkspaceSharedFiles(input.serverId).some((file) => file.id !== input.fileId && file.name === normalized)) {
        throw new WorkspaceSharedFileError("workspace_shared_file_name_exists", 409);
      }
    }
    if (input.assignments !== undefined) this.validateAssignments(input.serverId, input.assignments);
    const previousAgentIds = current.assignments.map((assignment) => assignment.agentId);
    try {
      if (input.name !== undefined) this.store.renameWorkspaceSharedFile(input.fileId, input.serverId, input.name);
      if (input.assignments !== undefined) {
        this.store.setWorkspaceSharedFileAssignments({
          fileId: input.fileId,
          serverId: input.serverId,
          assignments: input.assignments,
          createdByUserId: input.actor.userId,
          createdByOperatorId: input.actor.operatorId
        });
      }
      const updated = this.store.getWorkspaceSharedFile(input.fileId, input.serverId);
      if (!updated) throw new WorkspaceSharedFileError("workspace_shared_file_not_found", 404);
      this.syncAgents([...previousAgentIds, ...updated.assignments.map((assignment) => assignment.agentId)]);
      return publicFile(updated);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  delete(fileId: string, serverId: string): WorkspaceSharedFileRecord {
    const removed = this.store.deleteWorkspaceSharedFile(fileId, serverId);
    if (!removed) throw new WorkspaceSharedFileError("workspace_shared_file_not_found", 404);
    safeUnlink(removed.storagePath);
    if (removed.originalStoragePath !== removed.storagePath) safeUnlink(removed.originalStoragePath);
    this.syncAgents(removed.assignments.map((assignment) => assignment.agentId));
    return publicFile(removed);
  }

  reset(input: { fileId: string; serverId: string; expectedVersion: number }): WorkspaceSharedFileRecord {
    const current = this.store.getWorkspaceSharedFile(input.fileId, input.serverId);
    if (!current) throw new WorkspaceSharedFileError("workspace_shared_file_not_found", 404);
    if (current.version !== input.expectedVersion) throw new WorkspaceSharedFileError("workspace_shared_file_version_conflict", 409);
    if (!existsSync(current.originalStoragePath)) throw new WorkspaceSharedFileError("workspace_shared_file_original_not_found", 404);
    const contents = readFileSync(current.originalStoragePath);
    const reset = this.replace({
      fileId: current.id,
      serverId: current.serverId,
      expectedVersion: input.expectedVersion,
      // Reset affects bytes only; the current display name and Agent assignments remain stable.
      name: current.name,
      mimeType: current.originalMimeType,
      contents
    });
    return reset;
  }

  acceptAgentUpdate(input: {
    agentId: string;
    fileId: string;
    baseVersion: number;
    name: string;
    mimeType: string;
    contents: Buffer;
    sha256: string;
  }): WorkspaceSharedFileRecord {
    const assignment = this.store.listAgentSharedFiles(input.agentId).find(({ file }) => file.id === input.fileId);
    if (!assignment) throw new WorkspaceSharedFileError("workspace_shared_file_assignment_not_found", 404);
    if (assignment.permission !== "read-write") throw new WorkspaceSharedFileError("workspace_shared_file_read_only", 403);
    const actualSha = createHash("sha256").update(input.contents).digest("hex");
    if (actualSha !== input.sha256.toLowerCase()) throw new WorkspaceSharedFileError("workspace_shared_file_sha256_mismatch", 400);
    return this.replace({
      fileId: input.fileId,
      serverId: assignment.file.serverId,
      expectedVersion: input.baseVersion,
      // Agent 只能修改已分配文件的内容；重命名仍由 Owner 或 Operator 明确执行。
      name: assignment.file.name,
      mimeType: input.mimeType,
      contents: input.contents
    });
  }

  private versionPath(serverId: string, fileId: string, version: number): string {
    const workspaceKey = createHash("sha256").update(serverId).digest("hex").slice(0, 24);
    const dir = path.join(this.rootDir, workspaceKey);
    mkdirSync(dir, { recursive: true });
    return path.join(dir, `${fileId}.v${version}.${randomUUID().replaceAll("-", "")}`);
  }

  private originalPath(serverId: string, fileId: string): string {
    const workspaceKey = createHash("sha256").update(serverId).digest("hex").slice(0, 24);
    const dir = path.join(this.rootDir, workspaceKey);
    mkdirSync(dir, { recursive: true });
    return path.join(dir, `${fileId}.original.${randomUUID().replaceAll("-", "")}`);
  }

  private writeAtomically(targetPath: string, contents: Buffer): void {
    const pendingPath = `${targetPath}.pending`;
    writeFileSync(pendingPath, contents, { mode: 0o600, flag: "wx" });
    renameSync(pendingPath, targetPath);
  }

  private syncAgents(agentIds: string[]): void {
    for (const agentId of new Set(agentIds)) this.syncAgent(agentId);
  }

  private validateAssignments(serverId: string, assignments: WorkspaceSharedFileAssignmentInput[]): void {
    const agentIds = assignments.map((assignment) => assignment.agentId.trim());
    if (new Set(agentIds).size !== agentIds.length) throw new WorkspaceSharedFileError("workspace_shared_file_assignment_duplicate", 400);
    for (const assignment of assignments) {
      const agent = this.store.getAgent(assignment.agentId);
      if (
        !agent
        || agent.deletedAt
        || isCommunicationAgent(agent)
        || (agent.serverId ?? "local") !== serverId
        || (assignment.permission !== "read-only" && assignment.permission !== "read-write")
      ) {
        throw new WorkspaceSharedFileError("workspace_shared_file_agent_invalid", 400);
      }
    }
  }

  private normalizeError(error: unknown): WorkspaceSharedFileError {
    if (error instanceof WorkspaceSharedFileError) return error;
    const code = error instanceof Error ? error.message : String(error);
    if (code === "workspace_shared_file_name_exists") return new WorkspaceSharedFileError(code, 409);
    if (code.endsWith("_invalid") || code.endsWith("_duplicate")) return new WorkspaceSharedFileError(code, 400);
    return new WorkspaceSharedFileError(code, 400);
  }
}
