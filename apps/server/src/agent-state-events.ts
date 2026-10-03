export type AgentStateSignal = {
  agentId: string;
  launchId?: string;
  activitySeq?: number;
};

export type AgentStateDecision =
  | { accepted: true }
  | { accepted: false; reason: "stale_launch" | "stale_sequence" | "missing_launch" | "missing_sequence" | "stopped_launch" };

type AgentStateCursor = {
  launchId?: string;
  lastSeq?: number;
  expected: boolean;
  stopped?: boolean;
};

export class AgentStateEventGuard {
  private readonly cursors = new Map<string, AgentStateCursor>();

  expectLaunch(agentId: string, launchId: string): void {
    // server 下发 start 后，这个 launch 是唯一允许建立的新 runtime 边界。
    this.cursors.set(agentId, { launchId, expected: true });
  }

  markStopped(agentId: string, launchId?: string): void {
    const cursor = this.cursors.get(agentId);
    this.cursors.set(agentId, {
      launchId: cursor?.launchId ?? launchId,
      lastSeq: cursor?.lastSeq,
      expected: false,
      stopped: true
    });
  }

  acceptSession(agentId: string, launchId: string | undefined): AgentStateDecision {
    if (!launchId) return { accepted: true };
    const cursor = this.cursors.get(agentId);
    if (cursor?.stopped && cursor.launchId === launchId) return { accepted: false, reason: "stopped_launch" };
    if (cursor?.expected && cursor.launchId && cursor.launchId !== launchId) {
      return { accepted: false, reason: "stale_launch" };
    }
    if (!cursor || cursor.launchId !== launchId) {
      this.cursors.set(agentId, { launchId, expected: false });
    } else {
      cursor.expected = false;
    }
    return { accepted: true };
  }

  acceptEvent(signal: AgentStateSignal, persistedLaunchId?: string, options: { terminal?: boolean } = {}): AgentStateDecision {
    return this.accept(signal, persistedLaunchId, false, Boolean(options.terminal));
  }

  acceptSnapshot(signal: AgentStateSignal): AgentStateDecision {
    // 当前 daemon 连接的周期快照是校准真源；仅 server 刚下发的新 launch 可以阻止旧快照回退。
    return this.accept(signal, undefined, true, false);
  }

  private accept(signal: AgentStateSignal, persistedLaunchId: string | undefined, authoritativeSnapshot: boolean, terminal: boolean): AgentStateDecision {
    let cursor = this.cursors.get(signal.agentId);
    if (cursor?.stopped && !terminal && (!signal.launchId || signal.launchId === cursor.launchId)) {
      return { accepted: false, reason: "stopped_launch" };
    }
    const expectedLaunchId = cursor?.launchId ?? persistedLaunchId;
    if (signal.launchId && expectedLaunchId && signal.launchId !== expectedLaunchId) {
      if (!authoritativeSnapshot || cursor?.expected) return { accepted: false, reason: "stale_launch" };
      cursor = undefined;
    }
    if (!signal.launchId && cursor?.lastSeq !== undefined) {
      return { accepted: false, reason: "missing_launch" };
    }
    if (signal.launchId && (!cursor || cursor.launchId !== signal.launchId)) {
      cursor = { launchId: signal.launchId, expected: false };
      this.cursors.set(signal.agentId, cursor);
    }
    if (signal.activitySeq === undefined) {
      if (cursor?.lastSeq !== undefined) return { accepted: false, reason: "missing_sequence" };
      return { accepted: true };
    }
    if (cursor?.lastSeq !== undefined && signal.activitySeq <= cursor.lastSeq) {
      return { accepted: false, reason: "stale_sequence" };
    }
    if (!cursor) {
      cursor = { launchId: signal.launchId, expected: false };
      this.cursors.set(signal.agentId, cursor);
    }
    cursor.lastSeq = signal.activitySeq;
    cursor.expected = false;
    return { accepted: true };
  }
}
