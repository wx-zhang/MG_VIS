export type WorkspaceSpatialStretchPose = {
  lift: number;
  headPitch: number;
  headRoll: number;
  torsoPitch: number;
  torsoRoll: number;
  upperArmPitch: number;
  upperArmSpread: number;
  forearmPitch: number;
  forearmFold: number;
};

export function workspaceSpatialStretchPose(progress: number): WorkspaceSpatialStretchPose {
  const boundedProgress = Math.min(1, Math.max(0, progress));
  const reach = Math.sin(boundedProgress * Math.PI);
  const sway = Math.sin(boundedProgress * Math.PI * 2) * reach;

  // 双臂形成屈肘的上举 V 形，并用轻微侧弯打破机械对称；起止帧仍精确回到 neutral pose。
  return {
    lift: reach * 0.03,
    headPitch: reach * -0.1,
    headRoll: sway * -0.035,
    torsoPitch: reach * -0.055,
    torsoRoll: sway * 0.07,
    upperArmPitch: reach * -0.3,
    upperArmSpread: reach * 2.55,
    forearmPitch: reach * -0.48,
    forearmFold: reach * 0.52
  };
}
