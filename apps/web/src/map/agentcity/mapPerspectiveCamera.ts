// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";

/** MapLibre supplies the complete local-world → clip matrix. Keeping that in
 * projectionMatrix with an identity view preserves silhouettes, but gives PBR
 * materials an eye at the local origin. Recover the perspective eye, then
 * factor out a translation-only view without changing any projected vertex. */
export function createMapPerspectiveCamera() {
  const camera = new THREE.Camera();
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;
  const inverse = new THREE.Matrix4(),
    eye = new THREE.Vector4();
  return {
    camera,
    update(worldToClip: THREE.Matrix4) {
      inverse.copy(worldToClip).invert();
      eye.set(0, 0, 1, 0).applyMatrix4(inverse);
      if (!Number.isFinite(eye.w) || Math.abs(eye.w) < 1e-12) return false;
      eye.multiplyScalar(1 / eye.w);
      if (![eye.x, eye.y, eye.z].every(Number.isFinite)) return false;
      camera.position.set(eye.x, eye.y, eye.z);
      camera.matrixWorld.makeTranslation(eye.x, eye.y, eye.z);
      camera.matrix.copy(camera.matrixWorld);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      camera.projectionMatrix.copy(worldToClip).multiply(camera.matrixWorld);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      return true;
    },
  };
}
