import { randomUUID } from "node:crypto";
import type { DaemonReadyCapability } from "@tyr-ai/contracts";

export const DAEMON_HEARTBEAT_INTERVAL_MS = 15_000;
export const DAEMON_HEARTBEAT_TIMEOUT_MS = 45_000;

export interface DaemonSocketLike {
  readonly readyState: number;
  send(payload: string): void;
  close(): void;
}

export interface DaemonConnection {
  id: string;
  machineId: string;
  ws: DaemonSocketLike;
  lastPongAt: number;
  awaitingPong: boolean;
  capabilities: Set<DaemonReadyCapability>;
}

export class DaemonConnectionRegistry {
  private readonly byMachine = new Map<string, DaemonConnection>();
  private readonly now: () => number;
  private readonly heartbeatTimeoutMs: number;

  constructor(options: { now?: () => number; heartbeatTimeoutMs?: number } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DAEMON_HEARTBEAT_TIMEOUT_MS;
  }

  register(machineId: string, ws: DaemonSocketLike): DaemonConnection {
    const previous = this.byMachine.get(machineId);
    const connection = {
      id: randomUUID(),
      machineId,
      ws,
      lastPongAt: this.now(),
      awaitingPong: false,
      capabilities: new Set<DaemonReadyCapability>()
    };
    // 同一台 Computer 只能有一个调度入口；新连接成为真源，旧连接后续 close 不能覆盖它。
    this.byMachine.set(machineId, connection);
    if (previous && previous.ws !== ws && previous.ws.readyState < 2) previous.ws.close();
    return connection;
  }

  isCurrent(connection: DaemonConnection): boolean {
    return this.byMachine.get(connection.machineId)?.id === connection.id;
  }

  remove(connection: DaemonConnection): boolean {
    if (!this.isCurrent(connection)) return false;
    this.byMachine.delete(connection.machineId);
    return true;
  }

  current(machineId: string): DaemonConnection | null {
    return this.byMachine.get(machineId) ?? null;
  }

  hasOpen(machineId: string): boolean {
    const connection = this.current(machineId);
    return Boolean(connection && connection.ws.readyState === 1);
  }

  send(machineId: string, msg: unknown): boolean {
    const connection = this.current(machineId);
    if (!connection || connection.ws.readyState !== 1) return false;
    connection.ws.send(JSON.stringify(msg));
    return true;
  }

  noteCapabilities(connection: DaemonConnection, capabilities: DaemonReadyCapability[]): boolean {
    if (!this.isCurrent(connection)) return false;
    // capability 属于当前 socket，不落 Machine 长期配置；重连必须重新 ready 声明。
    connection.capabilities = new Set(capabilities);
    return true;
  }

  supports(machineId: string, capability: DaemonReadyCapability): boolean {
    const connection = this.current(machineId);
    return Boolean(connection && connection.ws.readyState === 1 && connection.capabilities.has(capability));
  }

  notePong(connection: DaemonConnection): boolean {
    if (!this.isCurrent(connection)) return false;
    connection.lastPongAt = this.now();
    connection.awaitingPong = false;
    return true;
  }

  heartbeat(connection: DaemonConnection): "sent" | "timeout" | "stale" | "closed" {
    if (!this.isCurrent(connection)) return "stale";
    if (connection.ws.readyState !== 1) return "closed";
    const age = this.now() - connection.lastPongAt;
    // 只有 current 连接连续未回 pong 才触发关闭；避免旧 socket 把新连接误判离线。
    if (connection.awaitingPong && age > this.heartbeatTimeoutMs) {
      connection.ws.close();
      return "timeout";
    }
    connection.awaitingPong = true;
    connection.ws.send(JSON.stringify({ type: "ping" }));
    return "sent";
  }
}
