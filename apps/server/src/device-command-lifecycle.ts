import type { DeviceCapabilityDescriptor, DeviceCommandRecord, DeviceCommandResult, DeviceRecord } from "@tyr-ai/contracts";
import type { ServerRouteContext } from "./server-context";

function locationCommandMessage(deviceName: string, data?: Record<string, unknown>): string {
  const latitude = Number(data?.latitude);
  const longitude = Number(data?.longitude);
  const accuracyMeters = Number(data?.accuracyMeters);
  const capturedAt = typeof data?.capturedAt === "string" ? data.capturedAt : new Date().toISOString();
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return `Location result from ${deviceName}: unavailable.`;
  }
  const accuracyText = Number.isFinite(accuracyMeters) ? ` +/-${Math.round(accuracyMeters)}m` : "";
  return `Location result from ${deviceName}: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}${accuracyText} - ${capturedAt}`;
}

function capabilityLabel(device: DeviceRecord | null, capability: string): string {
  const descriptor = device?.capabilityDescriptors.find((item: DeviceCapabilityDescriptor) => item.id === capability);
  return descriptor?.label ?? capability;
}

function terminalMessage(device: DeviceRecord | null, command: DeviceCommandRecord): string {
  const deviceName = device?.displayName ?? "device";
  const method = capabilityLabel(device, command.capability);
  if (command.status === "succeeded") {
    if (command.capability === "location.get_coarse_once") return locationCommandMessage(deviceName, command.data);
    return `Screenshot result from ${deviceName}${command.artifactIds?.length ? ` (${command.artifactIds.length} artifact)` : ""}.`;
  }
  const reason = command.errorMessage || command.errorCode || command.status;
  const verb = command.status === "denied" ? "denied" : command.status === "expired" ? "expired" : "failed";
  return `Device command ${verb} on ${deviceName}: ${method} - ${reason}.`;
}

function writeTerminalSystemMessage(ctx: ServerRouteContext, command: DeviceCommandRecord): void {
  if (!command.channelId) return;
  const device = ctx.store.getDevice(command.deviceId);
  // Device command results are written back to the originating conversation so the user can audit the effect without opening Devices.
  const sent = ctx.store.sendMessage({
    target: command.channelId,
    content: terminalMessage(device, command),
    senderType: "system",
    senderId: "system",
    senderName: "TYR",
    attachmentIds: command.artifactIds,
    serverId: command.serverId
  }).message;
  ctx.emitRealtimeMessage(sent);
}

export function dispatchDeviceCommand(ctx: ServerRouteContext, command: DeviceCommandRecord): { command: DeviceCommandRecord; delivered: boolean } {
  const delivered = ctx.sendToDevice(command.deviceId, {
    type: "device:command",
    commandId: command.id,
    capability: command.capability,
    params: command.params,
    reason: command.reason,
    expiresAt: command.expiresAt
  });
  if (delivered) {
    const sent = ctx.store.markDeviceCommandSent(command.id) ?? command;
    ctx.publishWorkspaceSync?.();
    return { command: sent, delivered: true };
  }
  // Disconnected devices fail fast in this phase; durable wakeup/retry belongs to a later background queue.
  const failed = completeDeviceCommandWithResult(ctx, command, {
    status: "failed",
    errorCode: "device_offline",
    errorMessage: "Device is offline."
  }) ?? command;
  return { command: failed, delivered: false };
}

export function markDeviceCommandRunning(ctx: ServerRouteContext, commandId: string, deviceId: string): DeviceCommandRecord | null {
  const command = ctx.store.getDeviceCommand(commandId);
  if (!command || command.deviceId !== deviceId) return null;
  const running = ctx.store.markDeviceCommandRunning(command.id);
  ctx.publishWorkspaceSync?.();
  return running;
}

export function completeDeviceCommandWithResult(ctx: ServerRouteContext, command: DeviceCommandRecord, result: DeviceCommandResult): DeviceCommandRecord | null {
  const expiresAtMs = Date.parse(command.expiresAt);
  const finalResult = Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs
    ? {
      ...result,
      status: "expired" as const,
      errorCode: result.errorCode ?? "device_command_expired",
      errorMessage: result.errorMessage ?? "Device command expired before the result arrived."
    }
    : result;
  const completed = ctx.store.completeDeviceCommand(command.id, finalResult);
  if (!completed) return null;
  writeTerminalSystemMessage(ctx, completed);
  ctx.publishWorkspaceSync?.();
  return completed;
}
