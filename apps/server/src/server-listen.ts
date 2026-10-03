export function createServerListeningHandler(input: {
  markMachinesOfflineOnBoot: () => void;
  reconcileRuntimeLifecycleOnBoot: () => void;
  startBackgroundWorkers?: () => void;
  logStarted: () => void;
}): () => void {
  return () => {
    // 只有端口实际监听成功后才清理旧 online 状态；失败的重复启动不能改写 DB 真源。
    input.markMachinesOfflineOnBoot();
    input.reconcileRuntimeLifecycleOnBoot();
    input.startBackgroundWorkers?.();
    input.logStarted();
  };
}
