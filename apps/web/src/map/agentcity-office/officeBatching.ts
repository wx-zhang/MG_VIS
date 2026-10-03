// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function materialBatchKey(material: THREE.Material) {
  if (material.type !== "MeshStandardMaterial" || !material.userData.officeImmutableFinish ||
      material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ||
      material.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ||
      material.clippingPlanes?.length || Object.values(material).some(value => value instanceof THREE.Texture)) return material.uuid;
  // r180 serializes standard render/material parameters. Only explicitly
  // immutable, untextured authored finishes can share a batch across UUIDs.
  const { uuid, name, metadata, ...appearance } = material.toJSON();
  return JSON.stringify(appearance);
}

/** Only the authored, static city outlook is baked. Doors, staff and screens
 * keep their individual task-driven transforms and material ownership. */
function batchStaticMeshes(root: THREE.Object3D, accepts: (mesh: THREE.Mesh) => boolean, name: string) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const groups = new Map<string, THREE.Mesh[]>();
  const materialKeys = new Map<THREE.Material, string>();
  root.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    if (object.material.transparent || object instanceof THREE.InstancedMesh) return;
    if (!accepts(object)) return;
    if (!materialKeys.has(object.material)) materialKeys.set(object.material, materialBatchKey(object.material));
    const key = `${materialKeys.get(object.material)}|${object.castShadow}|${object.receiveShadow}|${object.layers.mask}|${object.renderOrder}`;
    const group = groups.get(key) ?? [];
    group.push(object);
    groups.set(key, group);
  });
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const pieces = meshes.map((mesh) => {
      const piece = mesh.geometry.index
        ? mesh.geometry.toNonIndexed()
        : mesh.geometry.clone();
      return piece.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    });
    const geometry = mergeGeometries(pieces);
    pieces.forEach((piece) => piece.dispose());
    if (!geometry) continue;
    const first = meshes[0]!;
    const batch = new THREE.Mesh(geometry, first.material);
    batch.name = name;
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.layers.mask = first.layers.mask;
    batch.renderOrder = first.renderOrder;
    batch.userData.sourceMeshCount = meshes.length;
    batch.userData.sourceMaterialCount = new Set(meshes.map(mesh => mesh.material)).size;
    batch.userData.sourcePartNames = [...new Set(meshes.map(mesh => mesh.name).filter(Boolean))];
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    root.add(batch);
    const replaced = new Set<THREE.BufferGeometry>();
    for (const mesh of meshes) {
      mesh.removeFromParent();
      replaced.add(mesh.geometry);
    }
    replaced.forEach((piece) => piece.dispose());
  }
}

export function batchOfficeBackdrop(root: THREE.Group) {
  batchStaticMeshes(root, () => true, "office-city-static-batch");
}

/** Bake only immediate rigid frame parts in their owner's LOCAL coordinates.
 * A door's pivot remains outside this group, so animation/negative handedness
 * still carry the entire leaf. Glass, hit targets and nested moving parts are
 * never absorbed into the frame or the scene-wide static furniture batch. */
export function batchOfficeRigidFrame(root: THREE.Group) {
  batchStaticMeshes(root, mesh => mesh.parent === root && !mesh.userData.type &&
    !(mesh instanceof THREE.SkinnedMesh) && !mesh.morphTargetInfluences,
  'office-rigid-frame-batch');
}

export function batchOfficeFurniture(scene: THREE.Scene) {
  batchStaticMeshes(scene, (mesh) => {
    if (!mesh.userData.officeStaticArchitecture || (mesh.name && !mesh.userData.officeBatchablePart)) return false;
    // Asset hydration still owns these removable procedural planters.
    for (let parent = mesh.parent; parent; parent = parent.parent)
      if (parent.userData.officePlant) return false;
    return true;
  }, "office-furniture-static-batch");
}

/** The loaded plant clones share source geometry/materials. Instance only these
 * explicitly static assets. Keep the planter anchors and alpha-cutout materials;
 * never dispose the app-level GLTF cache when an office closes. */
export function instanceOfficePlants(scene: THREE.Scene) {
  scene.updateMatrixWorld(true);
  const inverse = scene.matrixWorld.clone().invert();
  const groups = new Map<string, THREE.Mesh[]>();
  scene.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh) || !object.userData.sharedOfficeAsset) return;
    if (object instanceof THREE.InstancedMesh || object instanceof THREE.SkinnedMesh) return;
    if (Array.isArray(object.material) || object.material.transparent || object.morphTargetInfluences) return;
    const key = `${object.geometry.uuid}|${object.material.uuid}|${object.castShadow}|${object.receiveShadow}|${object.layers.mask}|${object.renderOrder}`;
    const group = groups.get(key) ?? [];
    group.push(object);
    groups.set(key, group);
  });
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const first = meshes[0]!;
    const batch = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
    batch.name = "office-plant-instances";
    batch.userData.sharedOfficeAsset = true;
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.layers.mask = first.layers.mask;
    batch.renderOrder = first.renderOrder;
    meshes.forEach((mesh, index) => {
      batch.setMatrixAt(index, new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
      mesh.removeFromParent();
    });
    batch.instanceMatrix.needsUpdate = true;
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    scene.add(batch);
  }
}
