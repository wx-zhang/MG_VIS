import { createHash } from "node:crypto";
import type { MessageRecord, RuntimeExecutionRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import { workspaceBridgeRefForExecution } from "./workspace-bridge-delivery";

interface CommunicationNextStepReceipt {
  code: "communication_next_step_receipt";
  reviewedReplyId: string;
  sourceMessageId: string;
  executionIds: string[];
  bridgeRequestIds: string[];
}

type ReceiptStore = Pick<TyrDb, "getMessage" | "ensureDefaultCommunicationAgent" |
  "getRuntimeExecution" | "getCrossWorkspaceMessage" | "listRuntimeExecutionEvents">;

function receiptEventId(executionId: string, receipt: CommunicationNextStepReceipt): string {
  // Runtime event ingress generates its own random exec_event ID and cannot
  // submit this server-only identity, even if a worker imitates the payload.
  return `tyr_step_receipt_${createHash("sha256").update(JSON.stringify([executionId, {
    code: receipt.code, reviewedReplyId: receipt.reviewedReplyId, sourceMessageId: receipt.sourceMessageId,
    executionIds: receipt.executionIds, bridgeRequestIds: receipt.bridgeRequestIds
  }])).digest("hex")}`;
}

function reviewedReply(store: ReceiptStore, execution: RuntimeExecutionRecord, messageId: string): MessageRecord | null {
  const message = store.getMessage(messageId);
  const assistant = store.ensureDefaultCommunicationAgent(execution.serverId ?? "local");
  return message && message.senderType === "agent" && message.senderId === assistant.id &&
    message.channelId === execution.communicationReturnChannelId &&
    (message.conversationId ?? null) === (execution.communicationReturnConversationId ?? null)
    ? message : null;
}

function verifiedSteps(store: ReceiptStore, execution: RuntimeExecutionRecord, receipt: CommunicationNextStepReceipt): boolean {
  if (!execution.communicationReturnSourceMessageId || receipt.sourceMessageId !== execution.communicationReturnSourceMessageId ||
      receipt.executionIds.length + receipt.bridgeRequestIds.length === 0) return false;
  const serverId = execution.serverId ?? "local";
  const parent = workspaceBridgeRefForExecution(execution);
  return receipt.executionIds.every((id) => {
    const next = store.getRuntimeExecution(id);
    const nextParent = next ? workspaceBridgeRefForExecution(next) : null;
    return Boolean(next && next.id !== execution.id && (next.serverId ?? "local") === serverId &&
      next.communicationReturnSourceMessageId === execution.communicationReturnSourceMessageId &&
      next.communicationReturnChannelId === execution.communicationReturnChannelId &&
      (next.communicationReturnConversationId ?? null) === (execution.communicationReturnConversationId ?? null) &&
      (nextParent?.requestMessageId ?? null) === (parent?.requestMessageId ?? null));
  }) && receipt.bridgeRequestIds.every((id) => {
    const request = store.getCrossWorkspaceMessage(id);
    return Boolean(request && !request.replyToMessageId && request.sourceWorkspaceId === serverId &&
      request.senderCommsAgentId === store.ensureDefaultCommunicationAgent(serverId).id &&
      request.originMessageId === execution.communicationReturnSourceMessageId &&
      request.originChannelId === execution.communicationReturnChannelId &&
      (request.originConversationId ?? null) === (execution.communicationReturnConversationId ?? null) &&
      (request.parentBridgeRequestId ?? null) === (parent?.requestMessageId ?? null));
  });
}

/** Only dispatch callers write this marker, using actual server-returned side-effect IDs. */
export function recordCommunicationNextStepReceipt(store: TyrDb, execution: RuntimeExecutionRecord, input: {
  reviewedReplyId: string;
  executionIds?: string[];
  bridgeRequestIds?: string[];
}): boolean {
  const receipt: CommunicationNextStepReceipt = {
    code: "communication_next_step_receipt", reviewedReplyId: input.reviewedReplyId,
    sourceMessageId: execution.communicationReturnSourceMessageId ?? "",
    executionIds: [...new Set(input.executionIds ?? [])], bridgeRequestIds: [...new Set(input.bridgeRequestIds ?? [])]
  };
  if (!reviewedReply(store, execution, input.reviewedReplyId) || !verifiedSteps(store, execution, receipt)) return false;
  const id = receiptEventId(execution.id, receipt);
  if (store.listRuntimeExecutionEvents(execution.id).some((event) => event.id === id)) return true;
  store.appendRuntimeExecutionEvent({ id, executionId: execution.id, agentId: execution.agentId, taskId: execution.taskId,
    kind: "diagnostic", title: "TYR next step dispatched", detail: "TYR recorded the confirmed next-step receipts for this worker execution.",
    payload: receipt });
  return true;
}

/** Read only server-authored receipts whose persisted dispatch targets still verify. */
export function verifiedCommunicationNextStepReceipts(store: ReceiptStore, execution: RuntimeExecutionRecord): CommunicationNextStepReceipt[] {
  const receipts: CommunicationNextStepReceipt[] = [];
  for (const event of store.listRuntimeExecutionEvents(execution.id).reverse()) {
    const payload = event.payload as Partial<CommunicationNextStepReceipt> | undefined;
    if (!payload || payload.code !== "communication_next_step_receipt" || typeof payload.reviewedReplyId !== "string" ||
        typeof payload.sourceMessageId !== "string" || !Array.isArray(payload.executionIds) ||
        !Array.isArray(payload.bridgeRequestIds) ||
        [...payload.executionIds, ...payload.bridgeRequestIds].some((id) => typeof id !== "string")) continue;
    const receipt = payload as CommunicationNextStepReceipt;
    if (event.id !== receiptEventId(execution.id, receipt) || event.kind !== "diagnostic" ||
        event.agentId !== execution.agentId) continue;
    const reply = reviewedReply(store, execution, receipt.reviewedReplyId);
    if (reply && !reply.deletedAt && verifiedSteps(store, execution, receipt)) receipts.push(receipt);
  }
  return receipts;
}

/** A late IPC from this execution can acknowledge its existing action, never infer a new one. */
export function existingCommunicationNextStepReply(store: ReceiptStore, execution: RuntimeExecutionRecord): MessageRecord | null {
  if (!execution.communicationReturnMessageId ||
      !reviewedReply(store, execution, execution.communicationReturnMessageId)) return null;
  const receipt = verifiedCommunicationNextStepReceipts(store, execution)[0];
  return receipt ? reviewedReply(store, execution, receipt.reviewedReplyId) : null;
}
