import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  facadeLocalPoint,
  type FacadeFeature,
} from "./agentcity/cityFacadeScene";

export type TownBuilding = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  roofHeight: number;
  style: "house" | "shop" | "civic";
  palette: number;
  rotation?: number;
  ground?: number;
};
export const TOWN_WALLS = [
  "#e9e5d9",
  "#d8e3db",
  "#ddd9ce",
  "#e8dace",
  "#e2e7e8",
];
export const TOWN_ROOFS = [
  "#9e6c59",
  "#758d88",
  "#657989",
  "#b08c67",
  "#806b68",
];

/** Authored town scenery only: these buildings never represent hidden Workspaces. */
export function createTownArchitecture(buildings: TownBuilding[]) {
  const group = new THREE.Group();
  group.name = "marlow-town-architecture";
  const batches = new Map<string, THREE.BufferGeometry[]>();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const add = (
    color: string,
    geometry: THREE.BufferGeometry,
    matrix: THREE.Matrix4,
  ) => {
    const copy = (
      geometry.index ? geometry.toNonIndexed() : geometry.clone()
    ).applyMatrix4(matrix);
    copy.deleteAttribute("uv");
    const parts = batches.get(color) ?? [];
    parts.push(copy);
    batches.set(color, parts);
  };
  for (const b of buildings) {
    const base = new THREE.Matrix4().compose(
      new THREE.Vector3(b.x, b.ground ?? 0.08, b.z),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        b.rotation ?? 0,
      ),
      new THREE.Vector3(1, 1, 1),
    );
    const place = (
      color: string,
      geometry: THREE.BufferGeometry,
      x: number,
      y: number,
      z: number,
      sx = 1,
      sy = 1,
      sz = 1,
    ) =>
      add(
        color,
        geometry,
        base
          .clone()
          .multiply(
            new THREE.Matrix4().compose(
              new THREE.Vector3(x, y, z),
              new THREE.Quaternion(),
              new THREE.Vector3(sx, sy, sz),
            ),
          ),
      );
    const box = (
      color: string,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
    ) => place(color, unit, x, y, z, w, h, d);
    const wall = TOWN_WALLS[b.palette % TOWN_WALLS.length]!,
      roof = TOWN_ROOFS[b.palette % TOWN_ROOFS.length]!;
    const { width: w, depth: d, height: h, roofHeight: r } = b;
    const scale = w / 22;
    box(
      "#d5d4c9",
      0,
      0.15 * scale,
      0,
      w + 2 * scale,
      0.3 * scale,
      d + 2 * scale,
    );
    box(wall, 0, h / 2, 0, w, h, d);
    box(
      "#f3f0e5",
      0,
      h - 0.2 * scale,
      0,
      w + 0.6 * scale,
      0.45 * scale,
      d + 0.6 * scale,
    );
    // Two pitched roof planes and matching masonry gables, never flat shed roofs.
    const roofGeometry = new THREE.BufferGeometry();
    const rw = w / 2 + 0.8 * scale,
      rd = d / 2 + 0.8 * scale;
    roofGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          -rw,
          0,
          -rd,
          0,
          r,
          -rd,
          -rw,
          0,
          rd,
          0,
          r,
          -rd,
          0,
          r,
          rd,
          -rw,
          0,
          rd,
          0,
          r,
          -rd,
          rw,
          0,
          -rd,
          0,
          r,
          rd,
          rw,
          0,
          -rd,
          rw,
          0,
          rd,
          0,
          r,
          rd,
        ],
        3,
      ),
    );
    roofGeometry.computeVertexNormals();
    place(roof, roofGeometry, 0, h, 0);
    roofGeometry.dispose();
    const gable = new THREE.BufferGeometry();
    gable.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-w / 2, 0, 0, w / 2, 0, 0, 0, r, 0], 3),
    );
    gable.computeVertexNormals();
    place(wall, gable, 0, h, d / 2);
    place(wall, gable, 0, h, -d / 2);
    gable.dispose();
    box(roof, 0, h + r, 0, 0.38 * scale, 0.32 * scale, d + 1.9 * scale);
    const floors = Math.max(1, Math.round(h / (3.5 * scale))),
      bays = Math.max(2, Math.round(w / (5.6 * scale)));
    for (let floor = 0; floor < floors; floor++)
      for (let bay = 0; bay < bays; bay++) {
        const x = -w / 2 + ((bay + 0.5) * w) / bays,
          y = ((floor + 0.53) * h) / floors;
        for (const side of [-1, 1]) {
          if (floor === 0 && bay === Math.floor(bays / 2) && side === 1)
            continue;
          box(
            "#f5f1e8",
            x,
            y,
            side * (d / 2 + 0.09 * scale),
            2.5 * scale,
            2.4 * scale,
            0.22 * scale,
          );
          box(
            "#7f9a9c",
            x,
            y,
            side * (d / 2 + 0.23 * scale),
            1.9 * scale,
            1.9 * scale,
            0.08 * scale,
          );
          box(
            "#deded2",
            x,
            y,
            side * (d / 2 + 0.3 * scale),
            0.12 * scale,
            1.9 * scale,
            0.1 * scale,
          );
          box(
            "#d7d5c9",
            x,
            y - 1.25 * scale,
            side * (d / 2 + 0.3 * scale),
            2.7 * scale,
            0.16 * scale,
            0.6 * scale,
          );
        }
      }
    for (let floor = 0; floor < floors; floor++)
      for (const side of [-1, 1])
        for (const z of [-d * 0.26, d * 0.26]) {
          const y = ((floor + 0.53) * h) / floors;
          box(
            "#eeeade",
            side * (w / 2 + 0.1 * scale),
            y,
            z,
            0.2 * scale,
            2.3 * scale,
            2.4 * scale,
          );
          box(
            "#7f9a9c",
            side * (w / 2 + 0.23 * scale),
            y,
            z,
            0.09 * scale,
            1.85 * scale,
            1.85 * scale,
          );
        }
    box(
      "#526f6e",
      0,
      1.5 * scale,
      d / 2 + 0.15 * scale,
      2.3 * scale,
      3 * scale,
      0.25 * scale,
    );
    if (b.style === "shop") {
      for (const side of [-1, 1])
        box(
          "#799c9c",
          side * w * 0.28,
          1.6 * scale,
          d / 2 + 0.18 * scale,
          w * 0.31,
          2.65 * scale,
          0.24 * scale,
        );
      for (let i = 0; i < 8; i++)
        box(
          i % 2 ? "#f1e9d9" : roof,
          -w * 0.43 + ((i + 0.5) * w * 0.86) / 8,
          3.25 * scale,
          d / 2 + 1.25 * scale,
          (w * 0.86) / 8,
          0.22 * scale,
          2.8 * scale,
        );
      box(
        roof,
        0,
        3.0 * scale,
        d / 2 + 2.55 * scale,
        w * 0.86,
        0.6 * scale,
        0.12 * scale,
      );
    } else {
      box(
        roof,
        0,
        3.25 * scale,
        d / 2 + 1.15 * scale,
        5.2 * scale,
        0.35 * scale,
        3.1 * scale,
      );
      for (const side of [-1, 1])
        box(
          "#f2ede0",
          side * 2.15 * scale,
          1.6 * scale,
          d / 2 + 2.4 * scale,
          0.23 * scale,
          3.2 * scale,
          0.23 * scale,
        );
      box(
        "#bca48c",
        -w * 0.27,
        h + r * 0.56,
        -d * 0.18,
        1.3 * scale,
        r + 1.4 * scale,
        1.3 * scale,
      );
      box(
        "#e3ded1",
        -w * 0.27,
        h + r + 1.32 * scale,
        -d * 0.18,
        1.6 * scale,
        0.3 * scale,
        1.6 * scale,
      );
    }
  }
  unit.dispose();
  const materials: THREE.Material[] = [];
  for (const [color, parts] of batches) {
    const geometry = mergeGeometries(parts)!;
    parts.forEach((part) => part.dispose());
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.82,
      side: THREE.DoubleSide,
    });
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return {
    group,
    dispose() {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      materials.forEach((material) => material.dispose());
      group.clear();
    },
  };
}

export function createTownBuildingsScene(features: FacadeFeature[]) {
  const buildings: TownBuilding[] = [];
  const representedIds = new Set<string | number>();
  for (const feature of features) {
    const p = feature.properties;
    if (!p.townStyle || feature.geometry.type !== "Polygon") continue;
    const points = (feature.geometry.coordinates as number[][][])[0]
      .slice(0, -1)
      .map((point) => facadeLocalPoint(point as [number, number]));
    const xs = points.map((point) => point.x),
      zs = points.map((point) => point.y);
    const width = Math.max(...xs) - Math.min(...xs),
      depth = Math.max(...zs) - Math.min(...zs);
    if (!Number.isFinite(width + depth) || width <= 0 || depth <= 0) continue;
    buildings.push({
      id: String(feature.id),
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      z: (Math.min(...zs) + Math.max(...zs)) / 2,
      width,
      depth,
      height: p.render_height - (p.roofHeight ?? 4),
      roofHeight: p.roofHeight ?? 4,
      style: p.townStyle,
      palette: p.townPalette ?? 0,
      rotation: p.townRotation ?? 0,
    });
    representedIds.add(feature.id);
  }
  const town = createTownArchitecture(buildings);
  const shadowMaterial = new THREE.ShadowMaterial({
    opacity: 0.19,
    depthWrite: false,
  });
  const receiver = new THREE.Mesh(
    new THREE.PlaneGeometry(2200, 2200),
    shadowMaterial,
  );
  receiver.rotation.x = -Math.PI / 2;
  receiver.position.y = 0.025;
  receiver.receiveShadow = true;
  town.group.add(receiver);
  return {
    group: town.group,
    representedIds,
    dispose() {
      town.dispose();
      shadowMaterial.dispose();
    },
  };
}
