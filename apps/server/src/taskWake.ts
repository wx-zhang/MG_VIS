import type { AgentRecord, MachineRecord } from "@tyr-ai/contracts";

export type TaskWakePlan = "deliver" | "start" | "queued";
export type ReadyRecoveryPlan = "mark_online" | "start_desired" | "stop_unwanted" | "keep_error" | "mark_offline";

export function taskWakePlan(agent: AgentRecord, machine: MachineRecord | null | undefined, options: { daemonConnected?: boolean } = {}): TaskWakePlan {
  if (!machine || machine.status !== "online") return "queued";
  if (options.daemonConnected === false) return "queued";
  // Stop 是持久化意图；即使 inbox 有新消息，也必须等用户显式 Start 后再拉起 runtime。
  if (agent.desiredRuntimeState !== "running") return "queued";
  if (agent.status === "online") return "deliver";
  if (agent.status === "offline") return "start";
  // error 表示最近一次 runtime 已失败；新消息只入队，等待用户显式 Start/Retry，避免失败 runtime 被自动反复拉起。
  if (agent.status === "error") return "queued";
  return "queued";
}

export function shouldDrainPendingAfterDaemonReady(agent: AgentRecord, runningAgents: ReadonlySet<string>, hasPendingInbox: boolean): boolean {
  return runningAgents.has(agent.id) && hasPendingInbox;
}

export function readyRecoveryPlan(agent: AgentRecord, runningAgents: ReadonlySet<string>, _hasPendingInbox: boolean): ReadyRecoveryPlan {
  if (agent.desiredRuntimeState !== "running") {
    return runningAgents.has(agent.id) ? "stop_unwanted" : "mark_offline";
  }
  if (runningAgents.has(agent.id)) return "mark_online";
  if (agent.status === "error") return "keep_error";
  // desired=running 的恢复不依赖新消息；中心服务或 daemon 重启后要主动还原先前在线的 Agent。
  return "start_desired";
}

export function shouldStopBeforeTaskStart(agent: AgentRecord): boolean {
  // error 表示 server 已记录旧 runtime 不可信；重新 start 前先 stop，确保 daemon 不复用坏进程。
  return agent.status === "error";
}
