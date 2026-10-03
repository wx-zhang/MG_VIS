export type RealtimeEventOptions = {
  channelId?: string;
  serverId?: string;
  userId?: string;
  buffer?: boolean;
};

export type RealtimeBufferedEvent = {
  seq: number;
  event: string;
  payload: unknown;
  options: RealtimeEventOptions;
};

export type RealtimeResumeMessage = Pick<RealtimeBufferedEvent, "seq" | "event" | "payload">;

export type RealtimeResumeResponse = {
  messages: RealtimeResumeMessage[];
  currentSeq: number;
  hasMore: boolean;
};

export type RealtimeVisibilityClient = {
  userId?: string;
  serverId?: string;
};

export type RealtimeVisibilityContext = {
  isServerMember: (userId: string, serverId: string) => boolean;
  canUserAccessChannel: (userId: string, channelId: string) => boolean;
  channelServerId?: (channelId: string) => string | null | undefined;
};

export function addServerSeq(payload: unknown, seq: number): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  return { ...payload, serverSeq: seq };
}

export function publicRealtimeResumeMessage(item: RealtimeBufferedEvent): RealtimeResumeMessage {
  return {
    seq: item.seq,
    event: item.event,
    payload: item.payload
  };
}

export function realtimeResumeCursor(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const value = (payload as { lastSeq?: unknown; afterSeq?: unknown }).lastSeq ?? (payload as { afterSeq?: unknown }).afterSeq ?? 0;
  const seq = Number(value);
  if (!Number.isFinite(seq) || seq <= 0) return 0;
  return Math.floor(seq);
}

export function canReceiveRealtimeEventForClient(
  client: RealtimeVisibilityClient,
  item: RealtimeBufferedEvent,
  context: RealtimeVisibilityContext
): boolean {
  if (!client.userId) return false;
  if (item.options.userId && client.userId !== item.options.userId) return false;
  if (item.options.serverId) {
    if (client.serverId && item.options.serverId !== client.serverId) return false;
    if (!context.isServerMember(client.userId, item.options.serverId)) return false;
  }
  if (item.options.channelId) {
    const channelServerId = context.channelServerId?.(item.options.channelId);
    if (client.serverId && channelServerId && channelServerId !== client.serverId) return false;
    if (!context.canUserAccessChannel(client.userId, item.options.channelId)) return false;
  }
  return true;
}

export class RealtimeEventBuffer {
  readonly limit: number;
  private seq = 0;
  private events: RealtimeBufferedEvent[] = [];
  private lastEvictedSeq = 0;

  constructor(limit = 500) {
    this.limit = Math.max(1, limit);
  }

  get currentSeq(): number {
    return this.seq;
  }

  push(event: string, payload: unknown, options: RealtimeEventOptions = {}): RealtimeBufferedEvent {
    this.seq += 1;
    const item: RealtimeBufferedEvent = { seq: this.seq, event, payload: addServerSeq(payload, this.seq), options };
    // Live preview frames are useful only for currently connected clients; keeping them would retain large transient text.
    if (options.buffer !== false) {
      this.events.push(item);
      if (this.events.length > this.limit) {
        const evicted = this.events.slice(0, this.events.length - this.limit);
        this.lastEvictedSeq = Math.max(this.lastEvictedSeq, evicted.at(-1)?.seq ?? this.lastEvictedSeq);
        this.events = this.events.slice(-this.limit);
      }
    }
    return item;
  }

  since(afterSeq: number, canReceive: (item: RealtimeBufferedEvent) => boolean): RealtimeResumeResponse {
    // 只有“被挤出缓冲区”的持久事件才要求 full refresh；live-only preview 的 seq 空洞不算漏事件。
    const hasMore = afterSeq < this.lastEvictedSeq;
    return {
      messages: this.events.filter((item) => item.seq > afterSeq && canReceive(item)).map(publicRealtimeResumeMessage),
      currentSeq: this.seq,
      hasMore
    };
  }
}
