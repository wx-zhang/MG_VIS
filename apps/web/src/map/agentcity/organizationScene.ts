import { createTownArchitecture } from "../townArchitecture";
// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CityBuildingLocation as MapLocation } from "./mapTypes";
import { MAP_SUN } from "./mapLighting";

type Organization = Pick<MapLocation, "id" | "category" | "variant">;
import { organizationProfile } from "./organizationProfile";
export { organizationProfile } from "./organizationProfile";

/** Designed organization premises, NOT a model of the institution's real building.
 * Metres, Y up, plaza top y=0.35. Shared batched surfaces; no baked light/shadow. */
export function createOrganizationScene(location: Organization) {
  const profile = organizationProfile(location);
  const { width: w, depth: d, height: h } = profile;
  const scene = new THREE.Scene();
  scene.name = `organization-building-${location.id}`;
  scene.userData.representation = "illustrative-organization-architecture";
  scene.userData.organizationId = location.id;
  const materials = {
    stone: new THREE.MeshStandardMaterial({
      color: "#e7edf0",
      roughness: 0.72,
      metalness: 0.04,
    }),
    trim: new THREE.MeshStandardMaterial({
      color: "#fafbf9",
      roughness: 0.44,
      metalness: 0.15,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: "#7aaac6",
      roughness: 0.28,
      metalness: 0.04,
    }),
    dark: new THREE.MeshStandardMaterial({ color: "#577282", roughness: 0.7 }),
    paving: new THREE.MeshStandardMaterial({
      color: "#e5e7de",
      roughness: 0.92,
    }),
    foliage: new THREE.MeshStandardMaterial({
      color: "#91ad92",
      roughness: 0.95,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: "#86b3cf",
      roughness: 0.5,
      emissive: "#000000",
    }),
  };
  type Material = keyof typeof materials;
  const batches = new Map<Material, THREE.BufferGeometry[]>();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const add = (
    key: Material,
    geometry: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ) => {
    const copy = geometry.clone();
    if (!copy.index)
      copy.setIndex(
        Array.from(
          { length: copy.getAttribute("position").count },
          (_, i) => i,
        ),
      );
    copy.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion(),
        new THREE.Vector3(sx, sy, sz),
      ),
    );
    const batch = batches.get(key) ?? [];
    batch.push(copy);
    batches.set(key, batch);
  };
  const box = (
    key: Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ) => add(key, unit, x, y, z, sx, sy, sz);
  const floor = 0.35;
  // Plaza, occupied ground floor and entrance canopy are continuous, supported parts.
  box("paving", 0, 0.175, 0, w + 12, 0.35, d + 18);
  box("stone", 0, 1.1, 0, w, 1.5, d);
  box("glass", 0, 4, 0, w - 1.4, 5.8, d - 1.4);
  for (const x of [-w / 2 + 1, w / 2 - 1])
    for (const z of [-d / 2 + 1, d / 2 - 1]) box("stone", x, 4, z, 1.3, 6, 1.3);
  box("trim", 0, 7.1, 0, w + 0.5, 0.8, d + 0.5);
  box("trim", 0, 4.9, d / 2 + 2.2, 11, 0.45, 5.2);
  for (const x of [-4.8, 4.8]) box("trim", x, 2.5, d / 2 + 4, 0.28, 4.3, 0.28);
  box("dark", 0, 2.5, d / 2 - 0.6, 5.8, 4, 0.22);
  box("accent", 0, 5.4, d / 2 - 0.3, 7, 0.65, 0.32);

  const facade = (
    x: number,
    z: number,
    bottom: number,
    height: number,
    bw: number,
    bd: number,
    balcony = false,
  ) => {
    box("glass", x, bottom + height / 2, z, bw, height, bd);
    // Window mullions are real geometry, regular metre spacing rather than zoom-scaled texture.
    for (
      let fx = -bw / 2;
      fx <= bw / 2 + 0.01;
      fx += bw / Math.ceil(bw / 3.7)
    ) {
      for (const fz of [-bd / 2, bd / 2])
        box("trim", x + fx, bottom + height / 2, z + fz, 0.18, height, 0.24);
    }
    for (
      let fz = -bd / 2;
      fz <= bd / 2 + 0.01;
      fz += bd / Math.ceil(bd / 3.7)
    ) {
      for (const fx of [-bw / 2, bw / 2])
        box("trim", x + fx, bottom + height / 2, z + fz, 0.24, height, 0.18);
    }
    for (let y = bottom + 3.4; y < bottom + height - 0.3; y += 3.4) {
      box("trim", x, y, z, bw + 0.45, 0.25, bd + 0.45);
      if (balcony) {
        box("stone", x, y + 0.4, z + bd / 2 + 0.65, bw, 0.55, 1.45);
        box("trim", x, y + 1.1, z + bd / 2 + 1.3, bw, 0.14, 0.16);
      }
    }
    box("trim", x, bottom + height + 0.25, z, bw + 0.7, 0.5, bd + 0.7);
    for (const fx of [-bw / 2, bw / 2])
      box("stone", x + fx, bottom + height / 2, z, 0.7, height, bd + 0.65);
  };
  if (profile.kind === "tower") {
    facade(-10, -4, 7.5, h - 10, 26, 29);
    facade(18, 2, 7.5, h * 0.62, 14, 32);
    // Terraced roof garden / service core, not a single solid extruded square.
    box("stone", -10, h - 1, -4, 18, 1.5, 21);
    box("dark", -10, h - 2, -5, 7, 4, 9);
    box("foliage", 18, h * 0.62 + 8.4, 2, 9, 0.6, 20);
  } else if (profile.kind === "public") {
    facade(0, -5, 7.5, h - 8, w - 4, d - 13);
    box("trim", 0, 12, d / 2 - 1, w + 1, 1.1, 10);
    for (let x = -w / 2 + 3; x < w / 2; x += 6)
      box("stone", x, 6.4, d / 2 + 1, 0.85, 11, 0.85);
  } else if (profile.kind === "pavilion") {
    box("stone", -11, 8, -3, 7, 2, 18);
    box("foliage", 4, 8.2, 0, 19, 0.6, 17);
    box("trim", 0, h - 0.3, 0, w + 2, 0.5, d + 2);
  } else {
    facade(-2, -2, 7.5, h - 11, w - 7, d - 6, profile.kind === "hotel");
    box("stone", -2, h - 2, -2, w - 10, 2, d - 9);
    box("foliage", w / 2 - 2, 8.1, -2, 2, 0.7, d - 8);
  }
  // Small planted forecourt provides scale; foliage remains a restrained background form.
  const crown = new THREE.IcosahedronGeometry(1, 2);
  for (const [i, x] of [-w / 2 - 3, w / 2 + 3].entries())
    for (const z of [-d / 2 + 3, d / 2 + 2]) {
      box("stone", x, 0.8, z, 3, 0.9, 3);
      box("dark", x, 2.7, z, 0.35, 4.3, 0.35);
      add("foliage", crown, x, 5.3 + i * 0.45, z, 2.8, 3.1 + i * 0.2, 2.4);
    }
  crown.dispose();
  unit.dispose();
  const townPremises =
    profile.kind === "office" || profile.kind === "pavilion"
      ? createTownArchitecture([
          {
            id: location.id,
            x: 0,
            z: 0,
            width: w,
            depth: d,
            height: h - 4.5,
            roofHeight: 4.5,
            style: profile.kind === "pavilion" ? "shop" : "house",
            palette:
              [...location.id].reduce(
                (sum, char) => sum + char.charCodeAt(0),
                0,
              ) % 5,
          },
        ])
      : undefined;
  if (townPremises) {
    for (const parts of batches.values())
      parts.forEach((part) => part.dispose());
    batches.clear();
    scene.add(townPremises.group);
  }
  for (const [key, parts] of batches) {
    const geometry = mergeGeometries(parts)!;
    parts.forEach((part) => part.dispose());
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[key]);
    mesh.name = key;
    mesh.castShadow = key !== "paving";
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  // A task ring is state, not a fabricated physical light source or always-running animation.
  const ringGeometry = new THREE.RingGeometry(
    Math.max(w, d) * 0.62,
    Math.max(w, d) * 0.62 + 0.7,
    80,
  );
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: "#3c9be0",
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.name = "task-footprint";
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = floor + 0.02;
  ring.visible = false;
  scene.add(ring);
  const sun = new THREE.DirectionalLight("#fff6e8", 2.15);
  sun.name = "sun";
  sun.position
    .fromArray(MAP_SUN)
    .normalize()
    .multiplyScalar(h * 2.65);
  sun.castShadow = true;
  const extent = Math.max(w, d) * 1.3;
  Object.assign(sun.shadow.camera, {
    left: -extent,
    right: extent,
    top: extent,
    bottom: -extent,
    near: 1,
    far: h * 6,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.normalBias = 0.08;
  sun.shadow.bias = -0.0001;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  const sky = new THREE.HemisphereLight("#dceeff", "#a9af9f", 0.9);
  sky.name = "sky";
  scene.add(sky);
  let previousState = "";
  return {
    scene,
    profile,
    setState(selected: boolean, active: boolean, risk = false) {
      const state = `${selected}:${active}:${risk}`;
      if (state === previousState) return;
      previousState = state;
      ring.visible = selected || active;
      ringMaterial.color.set(risk ? "#cf6269" : "#3c9be0");
      materials.accent.color.set(
        risk ? "#ce858b" : active ? "#379dca" : "#86b3cf",
      );
      scene.userData.selected = selected;
      scene.userData.active = active;
    },
    dispose() {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      townPremises?.dispose();
      Object.values(materials).forEach((material) => material.dispose());
      ringMaterial.dispose();
      sun.shadow.dispose();
      scene.clear();
    },
  };
}
