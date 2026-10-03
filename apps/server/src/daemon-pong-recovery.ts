import type { MachineRecord } from "@tyr-ai/contracts";

export type DaemonPongRecoveryResult = "ignored" | "touched" | "reconnect";

export function handleDaemonPongRecovery(input: {
  notePong: () => boolean;
  touchMachineLastSeen: () => MachineRecord | null;
  closeConnection: () => void;
  onReconnectRequired?: () => void;
}): DaemonPongRecoveryResult {
  if (!input.notePong()) return "ignored";
  const machine = input.touchMachineLastSeen();
  if (machine && machine.status !== "offline") return "touched";

  // 心跳来自当前 socket，但 DB 真源离线或缺失，说明连接已不能可信调度；关闭 socket 让 daemon 重连并重新 ready。
  input.onReconnectRequired?.();
  input.closeConnection();
  return "reconnect";
}
