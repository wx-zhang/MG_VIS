import type { DaemonInbound, RuntimeId, RuntimeModel } from "@tyr-ai/contracts";

export interface RuntimeModelDetectionPendingRequest {
  timer: NodeJS.Timeout;
  machineId: string;
  runtime: RuntimeId;
  resolve: (payload: { models?: RuntimeModel[]; default?: string; error?: string }) => void;
}

export type RuntimeModelDetectionResult =
  | { status: "completed"; models: RuntimeModel[]; defaultModel?: string }
  | { status: "failed"; errorCode: "daemon_offline" | "runtime_models_timeout" | "runtime_models_unavailable" };

export function requestRuntimeModelDetection(input: {
  machineId: string;
  runtime: RuntimeId;
  pendingRequests: Map<string, RuntimeModelDetectionPendingRequest>;
  sendToDaemon: (machineId: string, message: DaemonInbound) => boolean;
  timeoutMs?: number;
}): Promise<RuntimeModelDetectionResult> {
  const requestId = `runtime-models-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout;
    const finish = (result: RuntimeModelDetectionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.pendingRequests.delete(requestId);
      resolve(result);
    };
    timer = setTimeout(() => {
      finish({ status: "failed", errorCode: "runtime_models_timeout" });
    // Codex may probe its version and login before fetching the catalog; those CLI
    // timeouts can exceed seven seconds even when detection eventually succeeds.
    }, input.timeoutMs ?? 20_000);
    input.pendingRequests.set(requestId, {
      timer,
      machineId: input.machineId,
      runtime: input.runtime,
      resolve: (payload) => {
        // daemon error 文本可能包含本地细节；对话和公开调用只返回稳定错误码。
        if (payload.error || !payload.models?.length) {
          finish({ status: "failed", errorCode: "runtime_models_unavailable" });
          return;
        }
        finish({
          status: "completed",
          models: payload.models,
          ...(payload.default ? { defaultModel: payload.default } : {})
        });
      }
    });

    let sent = false;
    try {
      sent = input.sendToDaemon(input.machineId, {
        type: "machine:runtime_models:detect",
        runtime: input.runtime,
        requestId
      });
    } catch {
      sent = false;
    }
    if (!sent) finish({ status: "failed", errorCode: "daemon_offline" });
  });
}
