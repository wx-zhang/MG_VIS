import type { WorkspaceSpatialMotionMode } from "./workspaceSpatialMotion";

export type WorkspaceSpatialWorkPose = {
  lift: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  torsoPitch: number;
  torsoYaw: number;
  torsoRoll: number;
  leftUpperArmPitch: number;
  leftUpperArmRoll: number;
  leftForearmPitch: number;
  rightUpperArmPitch: number;
  rightUpperArmRoll: number;
  rightForearmPitch: number;
};

export type WorkspaceSpatialWalkPose = {
  lift: number;
  headRoll: number;
  leftArmPitch: number;
  rightArmPitch: number;
  leftForearmPitch: number;
  rightForearmPitch: number;
  leftThighPitch: number;
  rightThighPitch: number;
  leftShinPitch: number;
  rightShinPitch: number;
};

export type WorkspaceSpatialArrivalPose = {
  lift: number;
  torsoPitch: number;
  torsoRoll: number;
  leftThighPitch: number;
  rightThighPitch: number;
  leftShinPitch: number;
  rightShinPitch: number;
};

export function workspaceSpatialWalkPose(phase: number): WorkspaceSpatialWalkPose {
  // 小步幅与低弹跳优先保证“在走”，避免正交远景把交叉腿读成滑倒。
  const stride = Math.sin(phase);
  return {
    lift: Math.abs(stride) * 0.014,
    headRoll: stride * 0.012,
    leftArmPitch: stride * 0.3,
    rightArmPitch: -stride * 0.3,
    leftForearmPitch: -0.16 - Math.max(0, stride) * 0.12,
    rightForearmPitch: -0.16 - Math.max(0, -stride) * 0.12,
    leftThighPitch: -stride * 0.34,
    rightThighPitch: stride * 0.34,
    leftShinPitch: Math.max(0, stride) * 0.24,
    rightShinPitch: Math.max(0, -stride) * 0.24
  };
}

export function workspaceSpatialArrivalPose(progress: number): WorkspaceSpatialArrivalPose {
  const boundedProgress = Math.min(1, Math.max(0, progress));
  const compression = Math.sin(boundedProgress * Math.PI);
  const transfer = Math.sin(boundedProgress * Math.PI * 2);
  // 到站只做一次轻微屈膝与重心换边，作为“走完”和 station 动作之间的有限断句。
  return {
    lift: -compression * 0.018,
    torsoPitch: compression * 0.05,
    torsoRoll: transfer * 0.018,
    leftThighPitch: compression * 0.1 + transfer * 0.018,
    rightThighPitch: compression * 0.1 - transfer * 0.018,
    leftShinPitch: -compression * 0.085,
    rightShinPitch: -compression * 0.085
  };
}

export function workspaceSpatialWorkPose(
  mode: WorkspaceSpatialMotionMode,
  phase: number,
  upperArmX: number,
  forearmX: number
): WorkspaceSpatialWorkPose | null {
  const wave = Math.sin(phase);
  const quickWave = Math.sin(phase * 2.35);
  const base = {
    lift: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    torsoPitch: 0,
    torsoYaw: 0,
    torsoRoll: 0,
    leftUpperArmPitch: upperArmX,
    leftUpperArmRoll: -0.08,
    leftForearmPitch: forearmX,
    rightUpperArmPitch: upperArmX,
    rightUpperArmRoll: 0.08,
    rightForearmPitch: forearmX
  } satisfies WorkspaceSpatialWorkPose;

  if (mode === "queued") {
    return { ...base, lift: Math.max(0, Math.sin(phase * 0.72)) * 0.012, headYaw: wave * 0.05 };
  }
  if (mode === "thinking") {
    // 一只手停在下颌、另一只手留在桌面；远景轮廓不能只靠几像素的点头表达。
    return {
      ...base,
      lift: wave * 0.008,
      headPitch: 0.15 + Math.sin(phase * 0.7) * 0.035,
      headYaw: Math.sin(phase * 0.34) * 0.09,
      headRoll: Math.sin(phase * 0.46) * 0.09,
      torsoPitch: 0.055,
      torsoYaw: Math.sin(phase * 0.42) * 0.045,
      leftUpperArmPitch: upperArmX + quickWave * 0.1,
      leftUpperArmRoll: -0.16,
      leftForearmPitch: forearmX + quickWave * 0.13,
      rightUpperArmPitch: 0.18,
      rightUpperArmRoll: 0.72,
      rightForearmPitch: -1.2
    };
  }
  if (mode === "tool") {
    return {
      ...base,
      lift: Math.sin(phase * 1.4) * 0.006,
      headPitch: 0.13 + Math.sin(phase * 0.62) * 0.025,
      headYaw: Math.sin(phase * 0.5) * 0.08,
      torsoPitch: 0.035,
      leftUpperArmPitch: upperArmX + quickWave * 0.18,
      leftUpperArmRoll: -0.2,
      leftForearmPitch: forearmX + quickWave * 0.27,
      rightUpperArmPitch: upperArmX - quickWave * 0.18,
      rightUpperArmRoll: 0.2,
      rightForearmPitch: forearmX - quickWave * 0.27
    };
  }
  if (mode === "approval") {
    return {
      ...base,
      headPitch: -0.055,
      torsoPitch: 0.025,
      torsoRoll: -0.035,
      leftUpperArmPitch: 0.16,
      leftUpperArmRoll: -0.42,
      leftForearmPitch: -0.88,
      rightUpperArmPitch: 0.06,
      rightUpperArmRoll: 0.98 + wave * 0.045,
      rightForearmPitch: -0.62
    };
  }
  if (mode === "communicating") {
    return {
      ...base,
      headRoll: Math.sin(phase * 0.62) * 0.055,
      torsoYaw: Math.sin(phase * 0.4) * 0.025,
      rightUpperArmPitch: 0.08,
      rightUpperArmRoll: 0.58 + Math.sin(phase * 0.86) * 0.1,
      rightForearmPitch: -0.22 + Math.sin(phase * 0.86) * 0.14
    };
  }
  return null;
}
