// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { facadeLocalPoint, FACADE_ORIGIN } from "./cityFacadeScene";

export type LandscapeTree = {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    height: number;
    radius: number;
    seed: number;
    representation: "illustrative-planting";
    parkId: string;
  };
};
export type LandscapeExclusion = {
  coordinate: [number, number];
  radius: number;
};

export type CityLandscapeDetail = "overview" | "context" | "near";

/** Keep the complete planting layout at task overview distance. Only surface
 * tessellation changes, with hysteresis to avoid swapping on tiny wheel moves. */
export function cityLandscapeDetail(
  zoom: number,
  current: CityLandscapeDetail,
): CityLandscapeDetail {
  if (zoom >= 15.1 || (current === "near" && zoom > 14.7)) return "near";
  if (zoom <= 13.2 || (current === "overview" && zoom < 13.5))
    return "overview";
  return "context";
}

/** A lobed, rounded broadleaf crown: authored geometry, not a measured species.
 * Horizontal bounds stay inside unit radius; planting clearance uses that envelope. */
export function cityCrownGeometry(detail: CityLandscapeDetail = "near") {
  const pieces: THREE.BufferGeometry[] = [];
  // Four overlapping branch envelopes, not an isolated sphere perched on a pole.
  // Context geometry preserves all four masses and their attachment/pivot.
  const lobes = [
    [0.05, 0.22, 0.02, 0.6, 0.78, 0.6],
    [-0.38, -0.36, 0.02, 0.55, 0.64, 0.59],
    [0.23, -0.05, -0.35, 0.53, 0.62, 0.52],
    [0.29, -0.21, 0.3, 0.52, 0.56, 0.5],
  ];
  for (const [x, y, z, w, h, d] of lobes) {
    const geometry = new THREE.SphereGeometry(
      1,
      detail === "near" ? 12 : detail === "overview" ? 4 : 6,
      detail === "near" ? 8 : detail === "overview" ? 3 : 4,
    );
    const p = geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i),
        py = p.getY(i),
        pz = p.getZ(i),
        angle = Math.atan2(pz, px);
      const lobe = 0.93 + 0.055 * Math.sin(angle * 5 + py * 3);
      p.setXYZ(i, x + px * w * lobe, y + py * h, z + pz * d * lobe);
    }
    geometry.computeVertexNormals();
    pieces.push(geometry);
  }
  const geometry = mergeGeometries(pieces)!;
  pieces.forEach((g) => g.dispose());
  geometry.computeBoundingSphere();
  return geometry;
}
function trunkGeometry(radialSegments = 6) {
  const pieces: THREE.BufferGeometry[] = [];
  const branch = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    base: number,
    top: number,
  ) => {
    const direction = b.clone().sub(a),
      g = new THREE.CylinderGeometry(
        top,
        base,
        direction.length(),
        radialSegments,
      );
    g.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize(),
      ),
    );
    g.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
    pieces.push(g);
  };
  branch(new THREE.Vector3(), new THREE.Vector3(0.015, 0.76, 0), 0.033, 0.012);
  branch(
    new THREE.Vector3(0.007, 0.3, 0),
    new THREE.Vector3(-0.15, 0.65, 0.09),
    0.018,
    0.008,
  );
  branch(
    new THREE.Vector3(0.01, 0.37, 0),
    new THREE.Vector3(0.12, 0.71, -0.1),
    0.015,
    0.007,
  );
  const geometry = mergeGeometries(pieces)!;
  pieces.forEach((p) => p.dispose());
  geometry.computeBoundingSphere();
  return geometry;
}

/** Instanced 800m spatial batches share the facade renderer, ground and sun.
 * Static foliage: no invented activity, independent canvas, or perpetual animation. */
export function createCityLandscapeScene(
  trees: LandscapeTree[],
  elevation: (coordinate: [number, number]) => number,
  exclusions: LandscapeExclusion[] = [],
) {
  const group = new THREE.Group();
  group.name = "city-park-canopies";
  group.userData.representation = "illustrative-planting";
  const crown = cityCrownGeometry("context"),
    overviewCrown = cityCrownGeometry("overview"),
    nearCrown = cityCrownGeometry("near"),
    trunk = trunkGeometry(),
    overviewTrunk = trunkGeometry(3);
  const leafMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const woodMaterial = new THREE.MeshLambertMaterial({ color: "#9c9b86" });
  const byCell = new Map<string, LandscapeTree[]>();
  const omit = exclusions.map((e) => ({
    ...e,
    point: facadeLocalPoint(e.coordinate),
  }));
  for (const tree of trees) {
    const { height, radius, seed, representation } = tree.properties;
    if (
      representation !== "illustrative-planting" ||
      !Number.isFinite(height) ||
      height < 3 ||
      height > 25 ||
      !Number.isFinite(radius) ||
      radius < 1 ||
      radius > 8 ||
      !Number.isFinite(seed)
    )
      continue;
    const coord = tree.geometry.coordinates;
    if (
      !coord.every(Number.isFinite) ||
      Math.abs(coord[0] - FACADE_ORIGIN[0]) > 0.4 ||
      Math.abs(coord[1] - FACADE_ORIGIN[1]) > 0.4
    )
      continue;
    const p = facadeLocalPoint(coord);
    if (omit.some((e) => e.point.distanceTo(p) < e.radius + radius)) continue;
    const key = `${Math.floor(p.x / 800)}:${Math.floor(p.y / 800)}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key)!.push(tree);
  }
  let count = 0;
  const dummy = new THREE.Object3D(),
    color = new THREE.Color();
  const batches: THREE.InstancedMesh[] = [];
  const canopies: THREE.InstancedMesh[] = [];
  const stems: THREE.InstancedMesh[] = [];
  for (const [key, items] of byCell) {
    const branches = new THREE.InstancedMesh(trunk, woodMaterial, items.length);
    const leaves = new THREE.InstancedMesh(crown, leafMaterial, items.length);
    branches.name = `park-trunks-${key}`;
    leaves.name = `park-crowns-${key}`;
    canopies.push(leaves);
    stems.push(branches);
    items.forEach((tree, i) => {
      const c = tree.geometry.coordinates,
        p = facadeLocalPoint(c);
      const ratio =
        Math.cos((FACADE_ORIGIN[1] * Math.PI) / 180) /
        Math.cos((c[1] * Math.PI) / 180);
      const h = tree.properties.height * ratio,
        r = tree.properties.radius * ratio;
      const sampled = elevation(c),
        ground = (Number.isFinite(sampled) ? sampled : 0) * ratio;
      dummy.rotation.set(0, (tree.properties.seed % 6283) / 1000, 0);
      dummy.position.set(p.x, ground, p.y);
      dummy.scale.set(h, h, h);
      dummy.updateMatrix();
      branches.setMatrixAt(i, dummy.matrix);
      dummy.position.y = ground + h * 0.67;
      dummy.scale.set(r, h * 0.33, r);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
      color.setHSL(
        0.25 + (tree.properties.seed % 23) / 1000,
        0.14,
        0.46 + (tree.properties.seed % 11) / 100,
      );
      leaves.setColorAt(i, color);
    });
    for (const mesh of [branches, leaves]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      group.add(mesh);
      batches.push(mesh);
    }
    count += items.length;
  }
  group.userData.treeCount = count;
  group.userData.batchCount = byCell.size;
  let detail: CityLandscapeDetail = "context";
  group.userData.detail = detail;
  return {
    group,
    count,
    batches: byCell.size,
    updateDetail(zoom: number) {
      const next = cityLandscapeDetail(zoom, detail);
      if (next === detail) return false;
      detail = next;
      group.userData.detail = detail;
      for (const mesh of canopies) {
        mesh.geometry =
          detail === "near"
            ? nearCrown
            : detail === "overview"
              ? overviewCrown
              : crown;
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
      }
      for (const mesh of stems) {
        mesh.geometry = detail === "overview" ? overviewTrunk : trunk;
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
      }
      return true;
    },
    dispose() {
      batches.forEach((mesh) => mesh.dispose());
      crown.dispose();
      overviewCrown.dispose();
      nearCrown.dispose();
      trunk.dispose();
      overviewTrunk.dispose();
      leafMaterial.dispose();
      woodMaterial.dispose();
      group.clear();
    },
  };
}
