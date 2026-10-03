// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { officeWorktopGeometry } from "./officeSurfaces";

/** One continuous planted divider, rather than pots perched on a solid block.
 * Every botanical root starts at visible soil; the housing bridges both halves
 * of the split desk. Dimensions use the existing office's metre coordinates. */
export const COLLABORATION_PLANTER = {
  width: 0.64,
  depth: 2.3,
  top: 0.224,
  soil: 0.2,
  base: 0.8,
  wall: 0.022,
} as const;
export function officeCollaborationPlanter() {
  const root = new THREE.Group();
  root.name = "office-collaboration-planter";
  root.position.y = COLLABORATION_PLANTER.base;
  const finish = (color: string, roughness: number, metalness = 0) => {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
    });
    material.userData.officeImmutableFinish = true;
    return material;
  };
  const blue = finish("#abc5d8", 0.48),
    rubber = finish("#506573", 0.86),
    soil = finish("#4c503d", 0.98);
  const mesh = (
    parent: THREE.Object3D,
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    y = 0,
  ) => {
    const part = new THREE.Mesh(geometry, material);
    part.name = name;
    part.position.y = y;
    part.castShadow = part.receiveShadow = true;
    part.userData.officeStaticArchitecture = true;
    parent.add(part);
    return part;
  };
  for (const z of [-0.8, 0.8]) {
    const foot = mesh(
      root,
      "divider-supported-foot",
      new THREE.BoxGeometry(0.58, 0.012, 0.15),
      rubber,
      0.006,
    );
    foot.position.z = z;
  }
  mesh(
    root,
    "divider-closed-bottom",
    officeWorktopGeometry(0.64, 2.3, 0.04, 0.07),
    blue,
    0.032,
  );
  function contour<T extends THREE.Path>(
    path: T,
    width: number,
    depth: number,
    radius: number,
  ): T {
    const x = -width / 2,
      z = -depth / 2,
      w = width,
      d = depth,
      r = radius;
    path.moveTo(x + r, z);
    path.lineTo(x + w - r, z);
    path.quadraticCurveTo(x + w, z, x + w, z + r);
    path.lineTo(x + w, z + d - r);
    path.quadraticCurveTo(x + w, z + d, x + w - r, z + d);
    path.lineTo(x + r, z + d);
    path.quadraticCurveTo(x, z + d, x, z + d - r);
    path.lineTo(x, z + r);
    path.quadraticCurveTo(x, z, x + r, z);
    path.closePath();
    return path;
  }
  const { width, depth, wall } = COLLABORATION_PLANTER;
  const shape = contour(new THREE.Shape(), width - 0.008, depth - 0.008, 0.062);
  shape.holes.push(
    contour(new THREE.Path(), width - wall * 2, depth - wall * 2, 0.048),
  );
  const walls = new THREE.ExtrudeGeometry(shape, {
    depth: 0.164,
    bevelEnabled: true,
    bevelSize: 0.004,
    bevelThickness: 0.004,
    bevelSegments: 3,
    curveSegments: 12,
  });
  walls.rotateX(-Math.PI / 2);
  mesh(root, "divider-hollow-walls", walls, blue, 0.056);
  mesh(
    root,
    "divider-recessed-soil",
    officeWorktopGeometry(width - wall * 2, depth - wall * 2, 0.012, 0.048),
    soil,
    0.194,
  );
  for (const [index, z] of [-0.85, -0.425, 0, 0.425, 0.85].entries()) {
    const anchor = new THREE.Group();
    anchor.name = "collaboration-botanical-anchor";
    anchor.position.set(index % 2 ? 0.055 : -0.055, 0, z);
    anchor.userData.officePlant = "authored";
    anchor.userData.officePlantVariant = "fern";
    anchor.userData.officePlantClearance = {
      radius: 0.4,
      height: 0.8,
      soilHeight: COLLABORATION_PLANTER.soil,
    };
    root.add(anchor);
    // Removable fallback materials are local to each anchor. Hydration must
    // never dispose the surrounding joinery's live material instances.
    const leaves = finish(index % 2 ? "#647e48" : "#506e3f", 0.85),
      stems = finish("#54693b", 0.9);
    for (let leaf = 0; leaf < 9; leaf++) {
      const angle = leaf * 2.39996 + index,
        end = new THREE.Vector3(
          Math.cos(angle) * 0.18,
          0.39 + (leaf % 3) * 0.05,
          Math.sin(angle) * 0.18,
        );
      const start = new THREE.Vector3(0, COLLABORATION_PLANTER.soil, 0),
        direction = end.clone().sub(start);
      const stem = mesh(
        anchor,
        "divider-fallback-stem",
        new THREE.CylinderGeometry(0.004, 0.006, direction.length(), 8),
        stems,
      );
      stem.position.copy(start).add(end).multiplyScalar(0.5);
      stem.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize(),
      );
      stem.userData.officeFoliage = true;
      const blade = mesh(
        anchor,
        "divider-fallback-leaf",
        new THREE.SphereGeometry(1, 8, 6),
        leaves,
      );
      blade.position.copy(end);
      blade.scale.set(0.065, 0.035, 0.16);
      blade.rotation.set(-0.3, angle, 0);
      blade.userData.officeFoliage = true;
    }
  }
  return root;
}
