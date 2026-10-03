// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// Authored 32–34 inch class desktop display, in the office's metre units.
// A shared assembly keeps occupied/unoccupied desks at the same human scale.
export const OFFICE_MONITOR = {
  width: 0.82,
  height: 0.49,
  depth: 0.058,
  screenWidth: 0.744,
  screenHeight: 0.418,
  centerY: 1.16,
  tilt: -0.085,
  baseY: 0.823,
} as const;

export function officeMonitor(
  parent: THREE.Object3D,
  options: { x?: number; z: number; heading?: number; screen?: THREE.Material },
) {
  const root = new THREE.Group();
  root.name = "office-workstation-monitor";
  root.position.set(options.x ?? 0, 0, options.z);
  root.rotation.y = options.heading ?? 0;
  root.userData.officeStaticArchitecture = true;
  parent.add(root);
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: "#415769",
    roughness: 0.37,
    metalness: 0.18,
  });
  const standMaterial = new THREE.MeshStandardMaterial({
    color: "#adbcc7",
    roughness: 0.31,
    metalness: 0.68,
  });
  for (const material of [shellMaterial, standMaterial])
    material.userData.officeImmutableFinish = true;
  const part = (
    owner: THREE.Object3D,
    name: string,
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
    radius: number,
  ) => {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(...size, 3, radius),
      material,
    );
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.officeStaticArchitecture = true;
    owner.add(mesh);
    return mesh;
  };
  part(
    root,
    "monitor-foot",
    [0.31, 0.035, 0.235],
    [0, OFFICE_MONITOR.baseY, 0.025],
    standMaterial,
    0.01,
  );
  part(
    root,
    "monitor-upright",
    [0.06, 0.22, 0.052],
    [0, 0.947, -0.058],
    standMaterial,
    0.012,
  );
  const head = new THREE.Group();
  head.name = "monitor-tilt-hinge";
  head.position.y = OFFICE_MONITOR.centerY;
  head.rotation.x = OFFICE_MONITOR.tilt;
  root.add(head);
  part(
    root,
    "monitor-rear-mount",
    [0.19, 0.18, 0.057],
    [0, 1.045, -0.052],
    standMaterial,
    0.014,
  );
  part(
    head,
    "monitor-housing",
    [OFFICE_MONITOR.width, OFFICE_MONITOR.height, OFFICE_MONITOR.depth],
    [0, 0, 0],
    shellMaterial,
    0.017,
  );
  // The hinge/mount belongs behind the screen, not through the image plane.
  // It remains static for this demonstration; this does not imply adjustable hardware.
  const screenMaterial =
    options.screen ??
    new THREE.MeshStandardMaterial({
      color: "#142533",
      roughness: 0.26,
      metalness: 0.12,
    });
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(
      OFFICE_MONITOR.screenWidth,
      OFFICE_MONITOR.screenHeight,
    ),
    screenMaterial,
  );
  screen.name = "office-monitor-screen";
  screen.position.set(0, 0.009, OFFICE_MONITOR.depth / 2 + 0.001);
  head.add(screen);
  part(
    head,
    "monitor-lower-bezel",
    [0.35, 0.006, 0.002],
    [0, -0.229, OFFICE_MONITOR.depth / 2 + 0.0015],
    standMaterial,
    0.0006,
  );
  return { root, screen };
}
