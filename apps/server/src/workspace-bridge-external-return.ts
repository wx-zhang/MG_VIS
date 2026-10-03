import type { CrossWorkspaceMessageRecord, MessageRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";

type ExternalReturnStore = Pick<TyrDb, "getCrossWorkspaceMessage" | "updateCrossWorkspaceMessage">;

export function markImmediateWorkspaceBridgeExternalReturn(
  store: Pick<TyrDb, "getCrossWorkspaceMessage" | "listCrossWorkspaceMessages" | "updateCrossWorkspaceMessage">,
  delivery: { assistantReply?: MessageRecord; assistantOutcome?: { status?: string; bridgeRequestIds?: string[] } }
): void {
  if (!delivery.assistantReply || (delivery.assistantOutcome?.status !== "completed" && delivery.assistantOutcome?.status !== "failed")) return;
  for (const requestId of delivery.assistantOutcome.bridgeRequestIds ?? []) {
    const request = store.getCrossWorkspaceMessage(requestId);
    if (!request?.conversationId || (request.originSource !== "telegram" && request.originSource !== "email")) continue;
    const terminalReply = store.listCrossWorkspaceMessages(request.bridgeId, { conversationId: request.conversationId })
      .find((message) => (
        message.replyToMessageId === request.id &&
        (message.responseKind === "final" || message.responseKind === "error") &&
        Boolean(message.originMessageId)
      ));
    if (terminalReply) {
      // Mark the inline reply before arming TYR's continuation so both send paths see the same state.
      store.updateCrossWorkspaceMessage(request.id, { originExternalDeliveredAt: new Date().toISOString() });
    }
  }
}

/** A reviewed Bridge reply shares the same external delivery marker as the immediate peer reply. */
export async function deliverReviewedWorkspaceBridgeExternalReturn(
  store: ExternalReturnStore,
  requestId: string,
  message: MessageRecord,
  inFlight: Set<string>,
  send: (request: CrossWorkspaceMessageRecord, message: MessageRecord) => Promise<boolean>
): Promise<"sent" | "skipped"> {
  const request = store.getCrossWorkspaceMessage(requestId);
  if (!request || (request.originSource !== "telegram" && request.originSource !== "email") ||
      !request.originExternalRef || request.originExternalDeliveredAt || inFlight.has(requestId)) return "skipped";

  inFlight.add(requestId);
  try {
    if (!await send(request, message)) return "skipped";
    store.updateCrossWorkspaceMessage(requestId, { originExternalDeliveredAt: new Date().toISOString() });
    return "sent";
  } finally {
    inFlight.delete(requestId);
  }
}
