export type WorkspaceSpatialFramePolicyInput = {
  documentVisible: boolean;
  reduceMotion: boolean;
  authoritativeMotion: boolean;
  ambientMotion: boolean;
};

export type WorkspaceSpatialFramePolicy = {
  motionAllowed: boolean;
  initialFrameloop: "always" | "demand";
  runtimeFrameloopActive: boolean;
  controlsDamping: boolean;
};

export function workspaceSpatialFramePolicy(input: WorkspaceSpatialFramePolicyInput): WorkspaceSpatialFramePolicy {
  const motionAllowed = input.documentVisible && !input.reduceMotion;
  // 首帧模式只由权威工作决定；ambient 在 Canvas 挂载后由有限 assignment 启停，避免 idle 常驻跑帧。
  const initialFrameloop = motionAllowed && input.authoritativeMotion ? "always" : "demand";
  return {
    motionAllowed,
    initialFrameloop,
    runtimeFrameloopActive: motionAllowed && (input.authoritativeMotion || input.ambientMotion),
    // Drei damping 会持续 invalidate；只允许权威 activity / Flow 窗口承担这项成本。
    controlsDamping: motionAllowed && input.authoritativeMotion
  };
}
