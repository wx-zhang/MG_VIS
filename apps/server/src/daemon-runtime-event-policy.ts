import type { MachineRecord, RuntimeExecutionEventPayload, RuntimeExecutionRecord } from "@tyr-ai/contracts";

const SERVER_FINAL_REPLY_TITLES = new Set(["Final reply received", "Final reply recovered"]);
const SERVER_RECOVERY_FLAGS = [
  "recoveredFromFinalMessage",
  "recoveredFromRuntimeAssistantOutput",
  "workspaceBridgeFinalReplyRecovery"
] as const;

/** Validate daemon identity without letting runtime data impersonate a server final-reply receipt. */
export function acceptsDaemonRuntimeEvent(
  machine: Pick<MachineRecord, "id" | "serverId">,
  execution: Pick<RuntimeExecutionRecord, "id" | "agentId" | "machineId" | "serverId">,
  event: RuntimeExecutionEventPayload
): boolean {
  if (event.executionId !== execution.id || event.agentId !== execution.agentId ||
      execution.machineId !== machine.id ||
      execution.serverId !== undefined && execution.serverId !== machine.serverId) return false;

  if (event.kind === "diagnostic" && SERVER_FINAL_REPLY_TITLES.has(event.title ?? "")) return false;

  // Tool input/output can contain arbitrary user data with these names. Only control events
  // can carry final-reply receipts; their recovery markers belong to server append paths.
  const receiptCarrier = event.kind === "diagnostic" || event.kind === "assistant_output" ||
    event.kind === "turn_completed";
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown> : null;
  return !receiptCarrier || !payload || !SERVER_RECOVERY_FLAGS.some((flag) => payload[flag] === true);
}
