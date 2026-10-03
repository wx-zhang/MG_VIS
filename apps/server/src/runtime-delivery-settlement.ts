import type { RuntimeExecutionRecord } from "@tyr-ai/contracts";
import type { TyrDb } from "@tyr-ai/db";
import { DeliveryInFlightTracker, type InFlightDelivery } from "./delivery";
import { isTerminalRuntimeExecutionStatus } from "./message-deletion";

type RuntimeDeliverySettlementStore = Pick<
  TyrDb,
  "ackAgentInbox" | "getRuntimeExecution" | "takeAgentInbox" | "updateRuntimeExecutionStatus"
>;

export type RuntimeDeliverySettlement = {
  delivery: InFlightDelivery | null;
  execution: RuntimeExecutionRecord | null;
  transitionedToStalled?: boolean;
};

export function acknowledgeRuntimeDelivery(
  store: RuntimeDeliverySettlementStore,
  tracker: DeliveryInFlightTracker,
  input: { agentId: string; messageId: string }
): RuntimeDeliverySettlement {
  store.ackAgentInbox(input.agentId, [input.messageId]);
  const delivery = tracker.ack(input.agentId, input.messageId);
  return {
    delivery,
    // daemon ACK 需要把接管事实关联回 execution；此前只结清 inbox，Topology 无法区分 socket send 与真实接收。
    execution: delivery?.executionId ? store.getRuntimeExecution(delivery.executionId) : null
  };
}

export function acknowledgeRuntimeDeliveryForExecution(
  store: RuntimeDeliverySettlementStore,
  tracker: DeliveryInFlightTracker,
  input: { agentId: string; executionId: string }
): RuntimeDeliverySettlement | null {
  if (tracker.executionWasAcknowledged(input.agentId, input.executionId)) return null;
  const trackedDelivery = tracker.deliveryForExecution(input.agentId, input.executionId);
  const pendingMessages = trackedDelivery
    ? []
    : store.takeAgentInbox(input.agentId).filter((message) => message.runtimeExecutionId === input.executionId);
  const delivery = trackedDelivery ?? (pendingMessages[0] ? {
    agentId: input.agentId,
    messageId: pendingMessages[0].id,
    executionId: input.executionId,
    claimedAt: Date.now()
  } : null);
  tracker.markExecutionAcknowledged(input.agentId, input.executionId);
  if (!delivery) return null;
  store.ackAgentInbox(input.agentId, trackedDelivery ? [delivery.messageId] : pendingMessages.map((message) => message.id));
  if (trackedDelivery) tracker.ack(input.agentId, delivery.messageId);
  return {
    delivery,
    execution: store.getRuntimeExecution(input.executionId)
  };
}

export function settleNonDispatchableRuntimeInboxDelivery(
  store: RuntimeDeliverySettlementStore,
  tracker: DeliveryInFlightTracker,
  input: { agentId: string; messageId: string; executionId: string }
): RuntimeDeliverySettlement | null {
  const execution = store.getRuntimeExecution(input.executionId);
  if (execution && (execution.status === "queued" || execution.status === "delivered")) return null;
  const settled = acknowledgeRuntimeDelivery(store, tracker, input);
  return { ...settled, execution };
}

export function stallUnacknowledgedRuntimeDelivery(
  store: RuntimeDeliverySettlementStore,
  tracker: DeliveryInFlightTracker,
  input: { agentId: string; messageId: string; executionId: string }
): RuntimeDeliverySettlement | null {
  if (!tracker.isInFlight(input.agentId, input.messageId)) return null;
  const settled = acknowledgeRuntimeDelivery(store, tracker, input);
  const current = store.getRuntimeExecution(input.executionId);
  if (!current || isTerminalRuntimeExecutionStatus(current.status)) {
    return { ...settled, execution: current };
  }
  return {
    ...settled,
    execution: store.updateRuntimeExecutionStatus(input.executionId, "stalled"),
    transitionedToStalled: true
  };
}
