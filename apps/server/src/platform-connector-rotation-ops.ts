import type { DaemonInbound } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import type { PlatformOpsRequest, PlatformOpsResponse } from "./platform-ops";

type RotationRequest = Extract<PlatformOpsRequest, { action: "rotate_connector_token" }>;

export function rotatePlatformConnectorToken(deps: {
  store: Pick<TyrDb, "getMachine" | "hasPendingMachineWork" | "rotateMachineConnectorToken" | "recordAuditEvent">;
  daemonSupports(machineId: string, capability: "machine:connector-token-ack"): boolean;
  sendToDaemon(machineId: string, message: DaemonInbound): boolean;
  recordPending(machineId: string): void;
  emitRealtimeMachineUpdated(machineId: string): void;
}, request: RotationRequest): PlatformOpsResponse {
  const machine = deps.store.getMachine(request.machineId);
  const audit = (status: "pending" | "failed", errorCode: string | null, rotationId?: string) => {
    // 平台运维保持真实操作身份；审计与响应均不包含当前、pending 或 previous token。
    deps.store.recordAuditEvent({
      kind: "platform_operator_connector_rotation",
      actorType: "platform_operator", actorId: request.operatorId,
      resourceType: "machine", resourceId: request.machineId, serverId: machine?.serverId ?? null,
      metadata: { operationId: request.requestId, source: "ops", reason: request.reason,
        reference: request.reference, status, errorCode, rotationId: rotationId ?? null }
    });
  };
  const fail = (error: string): PlatformOpsResponse => {
    audit("failed", error);
    return { ok: false, requestId: request.requestId, error };
  };
  if (!machine || machine.deletedAt) return fail("machine_not_found");
  if (machine.ownerUserId !== request.expectedOwnerUserId || machine.connectorTokenIssuedAt !== request.expectedIssuedAt ||
    machine.runtimeSha !== request.expectedRuntimeSha) return fail("machine_preflight_mismatch");
  if (machine.status !== "online" || machine.connectorTokenRevokedAt || !machine.connectorToken) return fail("machine_not_ready");
  if (!deps.daemonSupports(machine.id, "machine:connector-token-ack")) return fail("daemon_update_required_for_safe_rotation");
  if (deps.store.hasPendingMachineWork(machine.id)) return fail("machine_busy");
  const rotated = deps.store.rotateMachineConnectorToken(machine.id);
  if (!rotated) return fail("machine_not_found");
  // 复用既有两阶段协议；发送失败也保留 current，绝不强制提升或关闭连接。
  if (!deps.sendToDaemon(machine.id, { type: "machine:connector_token", machineId: machine.id,
    connectorToken: rotated.connectorToken, rotationId: rotated.rotationId, ackRequired: true })) {
    return fail("daemon_unavailable_for_safe_rotation");
  }
  deps.recordPending(machine.id);
  deps.emitRealtimeMachineUpdated(machine.id);
  audit("pending", null, rotated.rotationId);
  return { ok: true, requestId: request.requestId, result: { machineId: machine.id, state: "pending",
    rotationId: rotated.rotationId, expiresAt: rotated.expiresAt, reused: rotated.reused } };
}
