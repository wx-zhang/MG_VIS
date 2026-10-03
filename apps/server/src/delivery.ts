export function messageIdFromDeliveryId(agentId: string, deliveryId: string): string | null {
  const prefix = `${agentId}:`;
  return deliveryId.startsWith(prefix) ? deliveryId.slice(prefix.length) : null;
}

export function shouldReleaseInFlightForAgentSignal(
  signal:
    | { type: "agent:status"; status: "active" | "inactive" }
    | { type: "agent:activity"; activity: "online" | "working" | "error" | "offline" | "thinking" }
): boolean {
  // 单个 agent 退出或报错时，即使 daemon socket 仍在线，也不能继续保留旧的未 ack 投递锁。
  if (signal.type === "agent:status") return signal.status === "inactive";
  return signal.activity === "offline" || signal.activity === "error";
}

export function agentStatusFromActivity(activity: "online" | "working" | "error" | "offline" | "thinking"): "online" | "working" | "error" | "offline" | null {
  // Thinking is stream progress; working means the runtime has resumed real work and can clear stale errors.
  return activity === "thinking" ? null : activity;
}

export function deliveryAckTimeoutDetail(agentName: string, timeoutMs: number): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `The server did not process delivery confirmation from @${agentName} within ${seconds}s. The execution was stopped; review it before retrying.`;
}

export type InFlightDelivery = {
  agentId: string;
  messageId: string;
  executionId?: string;
  claimedAt: number;
};

export function claimNextDeliveryForAgent<T extends { id: string; runtimeExecutionId?: string }>(tracker: DeliveryInFlightTracker, agentId: string, messages: T[]): T | null {
  if (tracker.hasAgent(agentId)) return null;
  for (const message of messages) {
    if (tracker.claim(agentId, message.id, message.runtimeExecutionId)) return message;
  }
  return null;
}

export class DeliveryInFlightTracker {
  private readonly deliveries = new Map<string, InFlightDelivery>();
  private readonly acknowledgedExecutionKeys = new Set<string>();

  claim(agentId: string, messageId: string, executionId?: string, claimedAt = Date.now()): boolean {
    const key = this.key(agentId, messageId);
    if (this.deliveries.has(key)) return false;
    // in-flight 表示 server 已经把 inbox 消息发给 daemon，但尚未收到 daemon ack。
    this.deliveries.set(key, { agentId, messageId, executionId, claimedAt });
    return true;
  }

  ack(agentId: string, messageId: string): InFlightDelivery | null {
    const delivery = this.release(agentId, messageId);
    if (delivery?.executionId) this.markExecutionAcknowledged(agentId, delivery.executionId);
    return delivery;
  }

  isInFlight(agentId: string, messageId: string): boolean {
    return this.deliveries.has(this.key(agentId, messageId));
  }

  hasAgent(agentId: string): boolean {
    for (const delivery of this.deliveries.values()) {
      if (delivery.agentId === agentId) return true;
    }
    return false;
  }

  deliveryForExecution(agentId: string, executionId: string): InFlightDelivery | null {
    for (const delivery of this.deliveries.values()) {
      if (delivery.agentId === agentId && delivery.executionId === executionId) return delivery;
    }
    return null;
  }

  executionWasAcknowledged(agentId: string, executionId: string): boolean {
    return this.acknowledgedExecutionKeys.has(this.key(agentId, executionId));
  }

  markExecutionAcknowledged(agentId: string, executionId: string): void {
    this.acknowledgedExecutionKeys.add(this.key(agentId, executionId));
    // 这里只用于抑制同一 execution 的重复 inbox 查询；保留最近窗口即可，避免 daemon 长期运行时无界增长。
    while (this.acknowledgedExecutionKeys.size > 5_000) {
      const oldest = this.acknowledgedExecutionKeys.values().next().value;
      if (typeof oldest !== "string") break;
      this.acknowledgedExecutionKeys.delete(oldest);
    }
  }

  release(agentId: string, messageId: string): InFlightDelivery | null {
    const key = this.key(agentId, messageId);
    const delivery = this.deliveries.get(key) ?? null;
    this.deliveries.delete(key);
    return delivery;
  }

  releaseAgent(agentId: string): void {
    for (const [key, delivery] of this.deliveries) {
      if (delivery.agentId === agentId) this.deliveries.delete(key);
    }
  }

  private key(agentId: string, messageId: string): string {
    return `${agentId}\u0000${messageId}`;
  }
}
