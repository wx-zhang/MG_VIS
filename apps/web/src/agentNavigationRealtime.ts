export interface AgentNavigationRefreshCoordinator {
  invalidate(): void;
  reset(): void;
  dispose(): void;
}

interface AgentNavigationRefreshCoordinatorOptions {
  debounceMs?: number;
  retryDelaysMs?: readonly number[];
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
  onError?: (error: unknown) => void;
}

const DEFAULT_RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;

export function createAgentNavigationRefreshCoordinator(
  refresh: () => Promise<void>,
  options: AgentNavigationRefreshCoordinatorOptions = {}
): AgentNavigationRefreshCoordinator {
  const debounceMs = options.debounceMs ?? 50;
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const scheduleTask = options.schedule ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
  const cancelTask = options.cancel ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  const onError = options.onError ?? (() => undefined);
  let timer: unknown = null;
  let dirty = false;
  let running = false;
  let retryAttempt = 0;
  let retryExhausted = false;
  let generation = 0;
  let disposed = false;

  const scheduleRefresh = (delayMs: number) => {
    if (disposed || running || timer !== null) return;
    timer = scheduleTask(() => {
      timer = null;
      void runRefresh();
    }, delayMs);
  };

  const runRefresh = async () => {
    if (disposed || running || !dirty) return;
    const activeGeneration = generation;
    dirty = false;
    running = true;
    let succeeded = false;
    let retryDelay: number | null = null;
    try {
      await refresh();
      if (disposed || activeGeneration !== generation) return;
      succeeded = true;
      retryAttempt = 0;
      retryExhausted = false;
    } catch (error) {
      if (disposed || activeGeneration !== generation) return;
      dirty = true;
      onError(error);
      if (retryAttempt < retryDelaysMs.length) {
        retryDelay = retryDelaysMs[retryAttempt];
        retryAttempt += 1;
      } else {
        // 有界重试结束后等待新的事件或连接恢复，避免离线期间无限请求。
        retryExhausted = true;
      }
    } finally {
      if (activeGeneration !== generation) return;
      running = false;
      if (disposed || !dirty) return;
      if (retryDelay !== null) scheduleRefresh(retryDelay);
      else if (succeeded) scheduleRefresh(debounceMs);
    }
  };

  return {
    invalidate() {
      if (disposed) return;
      dirty = true;
      if (retryExhausted) {
        retryExhausted = false;
        retryAttempt = 0;
      }
      scheduleRefresh(debounceMs);
    },
    reset() {
      generation += 1;
      dirty = false;
      running = false;
      retryAttempt = 0;
      retryExhausted = false;
      if (timer !== null) cancelTask(timer);
      timer = null;
    },
    dispose() {
      disposed = true;
      generation += 1;
      dirty = false;
      running = false;
      if (timer !== null) cancelTask(timer);
      timer = null;
    }
  };
}
