import type { ServerRouteContext } from "./server-context";
import { resolveRuntimeApprovalDecision } from "./runtime-approval-resolve";

export const RUNTIME_APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TICK_MS = 60_000;

export function createRuntimeApprovalExpiry(ctx: ServerRouteContext, options: {
  now?: () => number;
  tickMs?: number;
} = {}) {
  let timer: NodeJS.Timeout | null = null;
  let ticking = false;
  const tick = () => {
    if (ticking) return 0;
    ticking = true;
    let expired = 0;
    try {
      const cutoffAt = new Date((options.now?.() ?? Date.now()) - RUNTIME_APPROVAL_EXPIRY_MS).toISOString();
      for (const approval of ctx.store.listExpiredPendingRuntimeApprovals(cutoffAt)) {
        try {
          const execution = approval.executionId ? ctx.store.getRuntimeExecution(approval.executionId) : null;
          // Only a live runtime turn can block an Agent queue; leave other approval workflows to their own policies.
          if (execution?.status !== "waiting_approval") continue;
          const result = resolveRuntimeApprovalDecision(ctx, {
            approval,
            decision: "reject",
            resolvedByUserId: "system_approval_expired",
            customResponse: "Approval expired after 24 hours without an owner decision."
          });
          if ("blocked" in result) continue;
          const failed = ctx.store.getRuntimeExecution(execution.id);
          if (failed?.status === "failed") {
            void Promise.resolve(ctx.publishTerminalCommunicationFailure?.(failed)).catch((error) => {
              console.warn(`[server] expired approval return failed execution=${failed.id}`, error);
            });
          }
          expired += 1;
        } catch (error) {
          console.warn(`[server] expired approval cleanup failed approval=${approval.id}`, error);
        }
      }
      if (expired) ctx.publishWorkspaceSync();
      return expired;
    } finally {
      ticking = false;
    }
  };
  return {
    tick,
    start() {
      if (timer) return;
      const safeTick = () => {
        try { tick(); } catch (error) { console.warn("[server] approval expiry tick failed", error); }
      };
      safeTick();
      timer = setInterval(safeTick, options.tickMs ?? DEFAULT_TICK_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
