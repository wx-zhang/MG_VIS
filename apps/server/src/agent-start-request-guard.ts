export class AgentStartRequestGuard {
  private readonly pendingUntil = new Map<string, number>();

  constructor(
    private readonly timeoutMs: number,
    private readonly now: () => number = Date.now
  ) {}

  isPending(agentId: string): boolean {
    const expiresAt = this.pendingUntil.get(agentId);
    if (expiresAt === undefined) return false;
    if (expiresAt > this.now()) return true;
    // daemon 未回状态时只在有限窗口内合并 start，避免一次丢失的状态事件永久阻止后续恢复。
    this.pendingUntil.delete(agentId);
    return false;
  }

  markPending(agentId: string): void {
    this.pendingUntil.set(agentId, this.now() + this.timeoutMs);
  }

  release(agentId: string): void {
    this.pendingUntil.delete(agentId);
  }
}
