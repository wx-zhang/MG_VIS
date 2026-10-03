import { BUILT_IN_DEVICE_CAPABILITY_DESCRIPTORS, type DeviceCapability, type DeviceCapabilityDescriptor, type DeviceCommandRecord, type DeviceCommandStatus, type DeviceRecord } from "@tyr-ai/contracts";

type DeviceCapabilitySource = Pick<DeviceRecord, "capabilities" | "capabilityDescriptors"> | undefined;

const builtInDeviceCapabilityDescriptors = new Map(BUILT_IN_DEVICE_CAPABILITY_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]));

export function deviceCapabilityDescriptors(device: DeviceCapabilitySource): DeviceCapabilityDescriptor[] {
  if (!device) return [];
  const declared = new Set(device.capabilities);
  const descriptorById = new Map((device.capabilityDescriptors ?? []).filter((descriptor) => declared.has(descriptor.id)).map((descriptor) => [descriptor.id, descriptor]));
  return device.capabilities.map((capability) => {
    // 旧设备可能没有上报 descriptor；内置能力仍需要在 UI 中显示稳定的人类可读名称。
    return descriptorById.get(capability) ?? builtInDeviceCapabilityDescriptors.get(capability) ?? {
      id: capability,
      label: capability,
      riskLevel: "medium"
    };
  });
}

export function deviceCapabilityLabel(device: DeviceCapabilitySource, capability: DeviceCapability): string {
  return deviceCapabilityDescriptors(device).find((descriptor) => descriptor.id === capability)?.label ?? capability;
}

export function deviceCommandStatusLabel(status: DeviceCommandStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "sent":
      return "Sent";
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "denied":
      return "Denied";
    case "expired":
      return "Expired";
    default:
      return "Failed";
  }
}

export function deviceCommandTerminalFailed(command: Pick<DeviceCommandRecord, "status">): boolean {
  return command.status === "failed" || command.status === "denied" || command.status === "expired";
}

export function deviceCommandErrorText(command: Pick<DeviceCommandRecord, "errorCode" | "errorMessage" | "status">): string {
  if (!deviceCommandTerminalFailed(command)) return "";
  return command.errorMessage || command.errorCode || deviceCommandStatusLabel(command.status);
}
