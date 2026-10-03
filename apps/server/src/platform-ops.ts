import net, { type Server } from "node:net";
import path from "node:path";
import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";

export const PLATFORM_OPS_ACTIONS = ["start", "restart", "reset", "clear_stale_execution", "rotate_connector_token", "recover_bridge_result", "deployment_status", "deployment_notice"] as const;
export type PlatformOpsAction = typeof PLATFORM_OPS_ACTIONS[number];

interface PlatformOpsRequestBase {
  version: 1;
  requestId: string;
  operatorId: string;
  reason: string;
  reference: string;
}

export type PlatformOpsRequest = PlatformOpsRequestBase & (
  | { action: "deployment_status" }
  | { action: "deployment_notice"; noticeId: string; phase: "scheduled" | "updating" | "completed" | "postponed"; expiresAt: string; expectedNoticeId: string | null }
  | { action: "start" | "restart" | "reset"; agentId: string }
  | { action: "clear_stale_execution"; agentId: string; executionId: string; approvalId?: string }
  | { action: "rotate_connector_token"; machineId: string; expectedOwnerUserId: string; expectedIssuedAt: string; expectedRuntimeSha: string }
  | { action: "recover_bridge_result"; agentId: string; executionId: string; expectedReturnMessageId: string; finalMessageId: string; finalContentSha256: string; apply: boolean }
);

export type PlatformOpsResponse = {
  ok: boolean;
  requestId?: string;
  error?: string;
  result?: Record<string, unknown>;
};

const MAX_REQUEST_BYTES = 16 * 1024;

function boundedString(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= min && normalized.length <= max ? normalized : null;
}

export function parsePlatformOpsRequest(value: unknown): PlatformOpsRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const requestId = boundedString(input.requestId, 1, 128);
  const agentId = boundedString(input.agentId, 7, 128);
  const operatorId = boundedString(input.operatorId, 1, 128);
  const reason = boundedString(input.reason, 8, 500);
  const reference = boundedString(input.reference, 1, 200);
  const action = PLATFORM_OPS_ACTIONS.includes(input.action as PlatformOpsAction)
    ? input.action as PlatformOpsAction
    : null;
  if (
    input.version !== 1 ||
    !requestId ||
    !operatorId ||
    !reason ||
    !reference ||
    !action
  ) return null;
  const base = {
    version: 1 as const,
    requestId,
    operatorId,
    reason,
    reference
  };
  if (action === "deployment_status" || action === "deployment_notice") {
    const allowed = new Set(["version", "requestId", "operatorId", "reason", "reference", "action",
      ...(action === "deployment_notice" ? ["noticeId", "phase", "expiresAt", "expectedNoticeId"] : [])]);
    if (Object.keys(input).some((key) => !allowed.has(key))) return null;
    if (action === "deployment_status") return { ...base, action };
    const noticeId = boundedString(input.noticeId, 1, 100);
    const expiresAt = boundedString(input.expiresAt, 20, 30);
    const expectedNoticeId = input.expectedNoticeId === null ? null : boundedString(input.expectedNoticeId, 1, 100);
    if (!noticeId || !/^[a-zA-Z0-9_-]+$/.test(noticeId) || !expiresAt || !Number.isFinite(Date.parse(expiresAt)) ||
      (input.expectedNoticeId !== null && !expectedNoticeId) ||
      !["scheduled", "updating", "completed", "postponed"].includes(String(input.phase))) return null;
    return { ...base, action, noticeId, expiresAt, expectedNoticeId,
      phase: input.phase as "scheduled" | "updating" | "completed" | "postponed" };
  }
  if (["noticeId", "phase", "expiresAt", "expectedNoticeId"].some((key) => input[key] !== undefined)) return null;
  if (action === "recover_bridge_result") {
    const executionId = boundedString(input.executionId, 6, 128);
    const expectedReturnMessageId = boundedString(input.expectedReturnMessageId, 5, 128);
    const finalMessageId = boundedString(input.finalMessageId, 5, 128);
    const finalContentSha256 = boundedString(input.finalContentSha256, 64, 64);
    if (!agentId?.startsWith("agent_") || !executionId?.startsWith("exec_") ||
      !expectedReturnMessageId?.startsWith("msg_") || !finalMessageId?.startsWith("msg_") ||
      !finalContentSha256 || !/^[a-f0-9]{64}$/.test(finalContentSha256) ||
      (input.apply !== undefined && typeof input.apply !== "boolean") || input.approvalId !== undefined || input.machineId !== undefined ||
      input.expectedOwnerUserId !== undefined || input.expectedIssuedAt !== undefined || input.expectedRuntimeSha !== undefined) return null;
    return { ...base, action, agentId, executionId, expectedReturnMessageId, finalMessageId, finalContentSha256, apply: input.apply === true };
  }
  if (input.expectedReturnMessageId !== undefined || input.finalMessageId !== undefined || input.finalContentSha256 !== undefined || input.apply !== undefined) return null;
  if (action === "rotate_connector_token") {
    const machineId = boundedString(input.machineId, 9, 128);
    const expectedOwnerUserId = boundedString(input.expectedOwnerUserId, 6, 128);
    const expectedIssuedAt = boundedString(input.expectedIssuedAt, 20, 30);
    const expectedRuntimeSha = boundedString(input.expectedRuntimeSha, 64, 64);
    // 运维轮换必须绑定预检时的设备、所有者和凭据版本，不能夹带 Agent 生命周期目标。
    if (!machineId?.startsWith("machine_") || !expectedOwnerUserId ||
      !expectedIssuedAt || !Number.isFinite(Date.parse(expectedIssuedAt)) ||
      !expectedRuntimeSha || !/^[a-f0-9]{64}$/.test(expectedRuntimeSha) ||
      input.agentId !== undefined || input.executionId !== undefined || input.approvalId !== undefined) return null;
    return { ...base, action, machineId, expectedOwnerUserId, expectedIssuedAt, expectedRuntimeSha };
  }
  if (!agentId?.startsWith("agent_") || input.machineId !== undefined || input.expectedOwnerUserId !== undefined ||
    input.expectedIssuedAt !== undefined || input.expectedRuntimeSha !== undefined) return null;
  if (action === "clear_stale_execution") {
    const executionId = boundedString(input.executionId, 6, 128);
    const approvalId = input.approvalId === undefined
      ? undefined
      : boundedString(input.approvalId, 9, 128);
    if (!executionId?.startsWith("exec_") || (input.approvalId !== undefined && !approvalId?.startsWith("approval_"))) {
      return null;
    }
    return { ...base, agentId, action, executionId, ...(approvalId ? { approvalId } : {}) };
  }
  // Agent 生命周期操作不能夹带 execution/approval 目标，避免运维请求语义含混。
  if (input.executionId !== undefined || input.approvalId !== undefined) return null;
  return { ...base, agentId, action };
}

async function prepareSocketPath(socketPath: string): Promise<void> {
  const parent = path.dirname(socketPath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!existsSync(socketPath)) return;
  const existing = lstatSync(socketPath);
  if (!existing.isSocket()) throw new Error("platform_ops_path_not_socket");
  const active = await new Promise<boolean>((resolve, reject) => {
    const probe = net.createConnection(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT") {
        resolve(false);
        return;
      }
      reject(error);
    });
  });
  if (active) throw new Error("platform_ops_socket_in_use");
  if (existsSync(socketPath) && lstatSync(socketPath).isSocket()) unlinkSync(socketPath);
}

export async function listenPlatformOpsSocket(input: {
  socketPath: string;
  handle(request: PlatformOpsRequest): PlatformOpsResponse | Promise<PlatformOpsResponse>;
}): Promise<Server> {
  await prepareSocketPath(input.socketPath);
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let received = "";
    let finished = false;
    socket.setEncoding("utf8");
    socket.setTimeout(10_000, () => socket.destroy());

    const respond = (response: PlatformOpsResponse) => {
      if (finished) return;
      finished = true;
      socket.end(`${JSON.stringify(response)}\n`);
    };

    socket.on("data", (chunk: string) => {
      if (finished) return;
      received += chunk;
      if (Buffer.byteLength(received, "utf8") > MAX_REQUEST_BYTES) {
        respond({ ok: false, error: "request_too_large" });
        return;
      }
      const newline = received.indexOf("\n");
      if (newline < 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(received.slice(0, newline));
      } catch {
        respond({ ok: false, error: "invalid_json" });
        return;
      }
      const request = parsePlatformOpsRequest(parsed);
      if (!request) {
        respond({ ok: false, error: "invalid_request" });
        return;
      }
      Promise.resolve(input.handle(request))
        .then((response) => respond({ ...response, requestId: request.requestId }))
        .catch(() => respond({ ok: false, requestId: request.requestId, error: "operation_failed" }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(input.socketPath);
  });
  // Socket 权限是运维授权边界的一部分；监听成功但 chmod 失败时直接关闭，不能降级为宽权限。
  try {
    chmodSync(input.socketPath, 0o600);
  } catch (error) {
    server.close();
    throw error;
  }
  return server;
}

export function closePlatformOpsSocket(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      if (existsSync(socketPath) && lstatSync(socketPath).isSocket()) unlinkSync(socketPath);
      resolve();
    });
  });
}
