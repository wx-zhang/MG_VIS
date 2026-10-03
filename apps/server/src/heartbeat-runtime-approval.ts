import path from "node:path";
import type {
  AgentRecord,
  RuntimeApprovalRecord,
  RuntimeExecutionRecord,
  TyrHeartbeatRunRecord,
  WorkspaceSharedFilePermission,
  WorkspaceSharedFileRecord
} from "@tyr-ai/contracts";

export interface HeartbeatSharedFileApprovalGrant {
  heartbeatId: string;
  runId: string;
  fileIds: string[];
  fileNames: string[];
}

interface SharedFileAssignment {
  file: WorkspaceSharedFileRecord;
  permission: WorkspaceSharedFilePermission;
}

/**
 * Heartbeat 只预授权 Codex apply_patch 对既有 RW 共享文件的 update。
 * 任何缺少文件清单、请求根目录权限、增删移动文件或超出当前 Agent 分配范围的审批都失败关闭。
 */
export function heartbeatSharedFileApprovalGrant(input: {
  approval: RuntimeApprovalRecord;
  execution: RuntimeExecutionRecord | null;
  agent: Pick<AgentRecord, "id" | "serverId" | "workspacePath"> | null;
  runningRuns: TyrHeartbeatRunRecord[];
  assignments: SharedFileAssignment[];
}): HeartbeatSharedFileApprovalGrant | null {
  const { approval, execution, agent } = input;
  if (
    approval.status !== "pending" ||
    approval.kind !== "file_change" ||
    approval.method !== "applyPatchApproval" ||
    !execution ||
    !agent ||
    execution.agentId !== approval.agentId ||
    execution.agentId !== agent.id
  ) return null;

  const run = input.runningRuns.find((candidate) => (
    candidate.status === "running" &&
    candidate.serverId === approval.serverId &&
    candidate.serverId === execution.serverId &&
    (!agent.serverId || candidate.serverId === agent.serverId) &&
    (
      candidate.executionIds.includes(execution.id) ||
      Boolean(candidate.sourceMessageId && candidate.sourceMessageId === execution.communicationReturnSourceMessageId)
    )
  ));
  if (!run) return null;

  const payload = record(approval.payload);
  const fileChanges = record(payload?.fileChanges);
  if (!payload || !fileChanges || Object.keys(fileChanges).length === 0 || payload.grantRoot) return null;

  const writableByName = new Map(
    input.assignments
      .filter((assignment) => assignment.permission === "read-write")
      .map((assignment) => [assignment.file.name, assignment.file] as const)
  );
  const granted = new Map<string, WorkspaceSharedFileRecord>();
  for (const [requestedPath, rawChange] of Object.entries(fileChanges)) {
    const change = record(rawChange);
    if (!change || change.type !== "update" || change.move_path) return null;
    const file = [...writableByName.values()].find((candidate) => sharedFilePathMatches(
      requestedPath,
      candidate.name,
      agent.workspacePath
    ));
    if (!file) return null;
    granted.set(file.id, file);
  }
  if (granted.size === 0) return null;
  return {
    heartbeatId: run.heartbeatId,
    runId: run.id,
    fileIds: [...granted.values()].map((file) => file.id),
    fileNames: [...granted.values()].map((file) => file.name)
  };
}

function sharedFilePathMatches(requestedPath: string, fileName: string, workspacePath?: string): boolean {
  if (!requestedPath || requestedPath.includes("\0") || requestedPath.includes("\\")) return false;
  const relative = `shared/${fileName}`;
  if (requestedPath === relative) return true;
  if (!workspacePath || !path.isAbsolute(workspacePath) || !path.isAbsolute(requestedPath)) return false;
  return path.resolve(requestedPath) === path.resolve(workspacePath, relative);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
