export type DaemonMessageQueueItem<TConnection, TMessage> = {
  connection: TConnection;
  message: TMessage;
};

export type DaemonMessageQueue<TConnection, TMessage> = {
  enqueue: (item: DaemonMessageQueueItem<TConnection, TMessage>) => void;
  size: () => number;
};

type DaemonMessageQueueOptions<TConnection, TMessage> = {
  isCurrent: (item: DaemonMessageQueueItem<TConnection, TMessage>) => boolean;
  process: (item: DaemonMessageQueueItem<TConnection, TMessage>) => Promise<void> | void;
  onError?: (error: unknown, item: DaemonMessageQueueItem<TConnection, TMessage>) => void;
  yieldToEventLoop?: (callback: () => void) => void;
  now?: () => number;
  maxBatchSize?: number;
  maxBatchMs?: number;
};

const DEFAULT_MAX_BATCH_SIZE = 25;
const DEFAULT_MAX_BATCH_MS = 8;

export function createDaemonMessageQueue<TConnection, TMessage>(
  options: DaemonMessageQueueOptions<TConnection, TMessage>
): DaemonMessageQueue<TConnection, TMessage> {
  const queue: Array<DaemonMessageQueueItem<TConnection, TMessage>> = [];
  const yieldToEventLoop = options.yieldToEventLoop ?? defaultYieldToEventLoop;
  const now = options.now ?? (() => Date.now());
  const maxBatchSize = positiveLimit(options.maxBatchSize, DEFAULT_MAX_BATCH_SIZE);
  const maxBatchMs = positiveLimit(options.maxBatchMs, DEFAULT_MAX_BATCH_MS);
  let scheduled = false;

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    yieldToEventLoop(() => {
      void drain();
    });
  }

  async function drain(): Promise<void> {
    scheduled = false;
    const batchStartedAt = now();
    let processed = 0;
    while (queue.length > 0) {
      const item = queue.shift()!;
      if (options.isCurrent(item)) {
        try {
          await options.process(item);
        } catch (err) {
          options.onError?.(err, item);
        }
      }
      processed += 1;
      if (processed >= maxBatchSize || now() - batchStartedAt >= maxBatchMs) break;
    }
    if (queue.length > 0) schedule();
  }

  return {
    enqueue(item) {
      queue.push(item);
      schedule();
    },
    size() {
      return queue.length;
    }
  };
}

function defaultYieldToEventLoop(callback: () => void): void {
  if (typeof setImmediate === "function") {
    setImmediate(callback);
    return;
  }
  setTimeout(callback, 0);
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : fallback;
}
