import type { AgentRecord } from "@tyr-ai/contracts";

export function periodicAgentStateChanged(
  current: Pick<AgentRecord, "launchId" | "status" | "lastError">,
  incoming: { launchId?: string; status?: AgentRecord["status"]; detail?: string }
): boolean {
  // 周期快照只负责校准真实漂移；相同 launch、状态和错误信息不能制造新的 Web 更新。
  if (incoming.launchId && incoming.launchId !== current.launchId) return true;
  if (incoming.status && incoming.status !== current.status) return true;
  if (incoming.status === "error" && (incoming.detail ?? "") !== (current.lastError ?? "")) return true;
  return false;
}
