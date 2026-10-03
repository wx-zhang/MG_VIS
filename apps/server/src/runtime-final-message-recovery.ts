import type { RuntimeExecutionEventRecord, RuntimeExecutionRecord } from "@tyr-ai/contracts";
import { isTerminalRuntimeExecutionStatus } from "./message-deletion";
import { runtimeAccessBlockedPayload } from "./runtime-approval-policy";

export type RuntimeFinalMessageRecoveryDisposition = "complete" | "blocked" | "ignore";

export function runtimeFinalMessageRecoveryDisposition(
  execution: Pick<RuntimeExecutionRecord, "agentId" | "status">,
  finalMessageSenderId: string,
  events: Array<Pick<RuntimeExecutionEventRecord, "payload">>
): RuntimeFinalMessageRecoveryDisposition {
  if (execution.agentId !== finalMessageSenderId) return "ignore";
  if (events.some((event) => runtimeAccessBlockedPayload(event.payload))) return "blocked";
  if (isTerminalRuntimeExecutionStatus(execution.status)) return "ignore";
  return "complete";
}
