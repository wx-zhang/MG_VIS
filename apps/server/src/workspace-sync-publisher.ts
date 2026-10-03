export type WorkspaceSyncPublisher = {
  schedule: () => void;
  publishNow: () => void;
  cancel: () => void;
};

type TimerHandle = NodeJS.Timeout | number;

type WorkspaceSyncPublisherOptions = {
  delayMs?: number;
  setTimeout?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout?: (timer: TimerHandle) => void;
};

export function createWorkspaceSyncPublisher(
  publish: () => void,
  options: WorkspaceSyncPublisherOptions = {}
): WorkspaceSyncPublisher {
  const delayMs = options.delayMs ?? 500;
  const setTimer = options.setTimeout ?? setTimeout;
  const clearTimer = options.clearTimeout ?? clearTimeout;
  let timer: TimerHandle | null = null;

  function publishNow(): void {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    publish();
  }

  return {
    schedule() {
      if (timer) return;
      // runtime token/event 流很密集，合并 workspace bootstrap sync；增量 WS 仍实时发送。
      timer = setTimer(() => {
        timer = null;
        publish();
      }, delayMs);
    },
    publishNow,
    cancel() {
      if (!timer) return;
      clearTimer(timer);
      timer = null;
    }
  };
}
