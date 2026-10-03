import type { MachineOnboardingLinkResponse } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import { machineOnboardingCommandSet } from "./connect-commands";

export const MACHINE_ONBOARDING_EXPIRES_IN_SECONDS = 15 * 60;

export function createMachineOnboardingLink(input: {
  store: TyrDb;
  publicServerUrl: string;
  serverId: string;
  requestedByUserId: string;
  requestedByAgentId?: string | null;
  name?: string;
  emitRealtimeMachineUpdated?: (machineId: string) => void;
}): MachineOnboardingLinkResponse {
  const requestedName = input.name?.trim();
  const machine = input.store.createMachineKey(requestedName || undefined, input.requestedByUserId, input.serverId);
  const created = input.store.createMachineOnboardingIntent({
    serverId: input.serverId,
    machineId: machine.id,
    requestedByUserId: input.requestedByUserId,
    requestedByAgentId: input.requestedByAgentId
  });
  const commands = machineOnboardingCommandSet({
    serverUrl: input.publicServerUrl,
    code: created.code,
    machineId: machine.id,
    machineName: machine.name
  });
  input.emitRealtimeMachineUpdated?.(machine.id);
  return {
    machine,
    intent: created.intent,
    expiresInSeconds: MACHINE_ONBOARDING_EXPIRES_IN_SECONDS,
    ...commands
  };
}
