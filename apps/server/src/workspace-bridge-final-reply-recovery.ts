import type { RuntimeExecutionRecord } from "@tyr-ai/contracts";
import { clearTimeout, setTimeout } from "node:timers";

type RecoveryTimer = NodeJS.Timeout;

interface RecoveryTimerApi {
  setTimeout(callback: () => void, delayMs: number): RecoveryTimer;
  clearTimeout(timer: RecoveryTimer): void;
}

/** Give the daemon's final-message HTTP callback time to follow its turn_completed event. */
export class WorkspaceBridgeFinalReplyRecovery {
  private readonly timers = new Map<string, RecoveryTimer>();

  constructor(private readonly options: {
    graceMs: number;
    getExecution: (executionId: string) => RuntimeExecutionRecord | null;
    hasFinalMessage: (executionId: string) => boolean;
    isBridgeExecution: (execution: RuntimeExecutionRecord) => boolean;
    recover: (execution: RuntimeExecutionRecord) => void;
    timerApi?: RecoveryTimerApi;
  }) {}

  schedule(executionId: string): void {
    if (this.timers.has(executionId)) return;
    const timerApi: RecoveryTimerApi = this.options.timerApi ?? { setTimeout, clearTimeout };
    const timer = timerApi.setTimeout(() => {
      this.timers.delete(executionId);
      const execution = this.options.getExecution(executionId);
      // A normal final callback wins even when TYR is still composing its public answer.
      if (!execution || execution.status !== "completed" || execution.communicationReturnMessageId ||
          !this.options.isBridgeExecution(execution) || this.options.hasFinalMessage(executionId)) return;
      this.options.recover(execution);
    }, this.options.graceMs);
    timer.unref();
    this.timers.set(executionId, timer);
  }

  cancel(executionId: string): void {
    const timer = this.timers.get(executionId);
    if (!timer) return;
    const timerApi: RecoveryTimerApi = this.options.timerApi ?? { setTimeout, clearTimeout };
    timerApi.clearTimeout(timer);
    this.timers.delete(executionId);
  }
}
