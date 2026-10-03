// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { batchOfficeBackdrop } from "./officeBatching";
import { applyOfficeOutlookAperture } from "./officeOutlookAperture";

// Authored architectural context, not a surveyed view from a real CRM tower.
// The office is on an upper floor: streets, podiums and roofs belong below it.
export const OFFICE_OUTLOOK_GROUND = -190;
// Keep haze separate from camera clipping: even an inspection camera pulled
// back to its 180 m limit must not slice the distal buildings or street plane.
export const OFFICE_OUTLOOK_VIEW = {
  hazeNear: 140,
  hazeFar: 330,
  clipFar: 600,
} as const;
export function officeOutlookLayout() {
  const north = [
    // A real depth separation makes the window read as an upper-floor city
    // outlook, not facade panels attached to the office's own curtain wall.
    { x: -72, z: -127, w: 15, d: 16, floors: 24, kind: "stone" },
    { x: -50, z: -137, w: 12, d: 14, floors: 29, kind: "glass" },
    { x: -30, z: -124, w: 14, d: 13, floors: 22, kind: "stone" },
    { x: -9, z: -136, w: 15, d: 16, floors: 31, kind: "glass" },
    { x: 14, z: -124, w: 16, d: 13, floors: 25, kind: "glass" },
    { x: 38, z: -140, w: 18, d: 17, floors: 34, kind: "stone" },
    { x: 62, z: -126, w: 15, d: 14, floors: 23, kind: "glass" },
    { x: 85, z: -136, w: 16, d: 18, floors: 30, kind: "stone" },
    { x: -96, z: -202, w: 18, d: 20, floors: 52, kind: "glass" },
    { x: -66, z: -193, w: 20, d: 18, floors: 54, kind: "stone" },
    { x: -37, z: -208, w: 22, d: 21, floors: 60, kind: "glass" },
    { x: -7, z: -193, w: 20, d: 19, floors: 52, kind: "stone" },
    { x: 24, z: -208, w: 21, d: 21, floors: 59, kind: "glass" },
    { x: 56, z: -194, w: 22, d: 20, floors: 50, kind: "stone" },
    { x: 88, z: -210, w: 22, d: 24, floors: 56, kind: "glass" },
    { x: -109, z: -269, w: 25, d: 24, floors: 62, kind: "glass" },
    { x: -71, z: -264, w: 27, d: 25, floors: 59, kind: "stone" },
    { x: -30, z: -278, w: 30, d: 28, floors: 70, kind: "glass" },
    { x: 12, z: -263, w: 28, d: 27, floors: 62, kind: "stone" },
    { x: 55, z: -278, w: 30, d: 29, floors: 73, kind: "glass" },
    { x: 98, z: -266, w: 28, d: 25, floors: 61, kind: "stone" },
  ] as const;
  // The close city blocks sit BELOW the office's window sightline. Their roof
  // decks reveal depth before the taller distant skyline; equally tall first-
  // row facades made the upper-floor outlook read as a wall at the window.
  // Side blocks are real world geometry too, not a camera-following panorama.
  const sideBlocks = [...north.slice(0, 8), north[16], north[18], north[19]];
  const sides = [-1, 1].flatMap((side) =>
    sideBlocks.map((b, index) => ({
      ...b,
      x: -side * b.z,
      z: side * b.x,
      w: b.d,
      d: b.w,
      floors: b.floors + ((index % 3) - 1) * side * 2,
    })),
  );
  return [...north, ...sides];
}

/** Four 1.5 m bays by four 3.3 m storeys. Window blinds, spandrels and silver
 * mullions are registered to the same metre-scaled UVs as the 3D facade bands. */
export function officeOutlookFacade(
  stone: boolean,
  channel: "color" | "roughness" = "color",
) {
  const width = 256,
    height = 512,
    data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const bay = Math.floor(x / 64),
        floor = Math.floor(y / 128);
      const u = x % 64,
        v = y % 128,
        variant = (bay * 7 + floor * 13) % 9;
      const pier = u < (stone ? 10 : 2),
        slab = v < (stone ? 22 : 5),
        spandrel = !stone && v > 104,
        frame = stone && (u < 12 || u > 61 || v < 25 || v > 123),
        blind = variant < 3 && v > 98 - variant * 16;
      let rgb: readonly number[], roughness: number;
      if (pier || slab) {
        rgb = stone ? [233, 234, 230] : [180, 198, 209];
        roughness = stone ? 210 : 136;
      } else if (frame) {
        rgb = [104, 127, 144];
        roughness = 133;
      } else if (spandrel) {
        rgb = [100, 131, 153];
        roughness = 143;
      } else if (blind) {
        // Different blind heights belong to individual rooms; not pixel noise.
        const fold = v % 5 === 0 ? -9 : 0;
        rgb = [183 + fold, 198 + fold, 208 + fold];
        roughness = 97;
      } else {
        // Authored daytime glazing variation, not a photograph, measured
        // reflection, or a claim about occupancy in a particular building.
        const sky = 21 * (v / 128) + 9 * Math.cos((u / 64) * Math.PI);
        rgb = [
          78 + variant * 3 + sky,
          119 + variant * 2 + sky,
          150 + variant * 1.5 + sky,
        ];
        roughness = 54 + variant * 3;
      }
      const at = (y * width + x) * 4;
      data[at] = channel === "color" ? rgb[0]! : roughness;
      data[at + 1] = channel === "color" ? rgb[1]! : roughness;
      data[at + 2] = channel === "color" ? rgb[2]! : roughness;
      data[at + 3] = 255;
    }
  const texture = new THREE.DataTexture(data, width, height);
  texture.colorSpace =
    channel === "color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  texture.name =
    (stone ? "office-outlook-stone-bays" : "office-outlook-curtain-bays") +
    (channel === "roughness" ? "-roughness" : "");
  return texture;
}

export function createOfficeOutlook() {
  const root = new THREE.Group();
  root.name = "office-city-backdrop";
  root.userData.source = "authored-architectural-context";
  const finish = (color: string, roughness = 0.72, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const pale = finish("#d3dde3"),
    cap = finish("#bacad3"),
    street = finish("#8f9fa8"),
    paving = finish("#bdcbd0"),
    grass = finish("#819b87"),
    leaves = finish("#718d79"),
    bark = finish("#8e8c7b");
  const glass = new THREE.MeshStandardMaterial({
    map: officeOutlookFacade(false),
    roughnessMap: officeOutlookFacade(false, "roughness"),
    color: "#f2f8fc",
    roughness: 1,
    metalness: 0,
  });
  const stone = new THREE.MeshStandardMaterial({
    map: officeOutlookFacade(true),
    roughnessMap: officeOutlookFacade(true, "roughness"),
    color: "#f6f7f5",
    roughness: 1,
    metalness: 0,
  });
  for (const material of [
    pale,
    cap,
    street,
    paving,
    grass,
    leaves,
    bark,
    glass,
    stone,
  ])
    applyOfficeOutlookAperture(material);
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    root.add(mesh);
    // The outlook is outside the finite interior shadow volume. It responds to
    // the actual daylight rig but never invents extra lights or moving pixels.
    return mesh;
  };
  const ground = OFFICE_OUTLOOK_GROUND;
  // Edge-joined ground skins avoid the coplanar overlap of three rotated city
  // patches. The two short wings carry the distant east/west skyline, without
  // filling the unused corners outside the camera's maximum clip envelope.
  box(340, 0.2, 440, 0, ground - 0.11, -100, paving);
  for (const side of [-1, 1]) {
    box(132, 0.2, 240, side * 236, ground - 0.11, 0, paving);
    for (const x of [220, 298])
      box(7, 0.025, 220, side * x, ground + 0.02, 0, street);
  }
  for (const z of [-105, -170, -237, -313]) {
    box(340, 0.025, 8, 0, ground + 0.02, z, street);
    for (let x = -158; x < 165; x += 12)
      box(3.5, 0.03, 0.13, x, ground + 0.05, z, cap);
  }
  for (const x of [-128, 126])
    box(7, 0.03, 210, x, ground + 0.03, -215, street);
  for (const x of [-161, -107, 107, 161]) {
    box(7, 0.025, 210, x, ground + 0.02, 0, street);
    for (let z = -96; z <= 96; z += 12)
      box(0.13, 0.03, 3.5, x, ground + 0.05, z, cap);
  }
  // Low courtyard planting gives a familiar scale between tower podiums.
  for (const z of [-112, -183, -251])
    for (let x = -116; x < 120; x += 9) {
      if (
        officeOutlookLayout().some(
          (b) =>
            Math.abs(x - b.x) < b.w / 2 + 2.85 &&
            Math.abs(z - b.z) < b.d / 2 + 2.5,
        )
      )
        continue;
      box(3.5, 0.18, 2.8, x, ground + 0.12, z, grass);
      box(0.28, 2.8, 0.28, x, ground + 1.4, z, bark);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), leaves);
      crown.position.set(x, ground + 3.9, z);
      crown.scale.set(1.65, 1.85, 1.5);
      root.add(crown);
    }
  for (const x of [-116, 116])
    for (let z = -85; z < 100; z += 12) {
      if (
        officeOutlookLayout().some(
          (b) =>
            Math.abs(x - b.x) < b.w / 2 + 2.85 &&
            Math.abs(z - b.z) < b.d / 2 + 2.5,
        )
      )
        continue;
      box(3.5, 0.18, 2.8, x, ground + 0.12, z, grass);
      box(0.28, 2.8, 0.28, x, ground + 1.4, z, bark);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), leaves);
      crown.position.set(x, ground + 3.9, z);
      crown.scale.set(1.65, 1.85, 1.5);
      root.add(crown);
    }
  for (const [index, b] of officeOutlookLayout().entries()) {
    const h = b.floors * 3.3,
      wall = b.kind === "glass" ? glass : stone;
    const shell = (
      w: number,
      d: number,
      height: number,
      base: number,
      x: number,
      z: number,
    ) => {
      const mesh = box(w, height, d, x, base + height / 2, z, wall);
      const uv = mesh.geometry.getAttribute("uv"),
        n = mesh.geometry.getAttribute("normal");
      for (let i = 0; i < uv.count; i++)
        if (Math.abs(n.getY(i)) < 0.5)
          uv.setXY(
            i,
            (uv.getX(i) * (Math.abs(n.getX(i)) > 0.5 ? d : w)) / 6,
            (uv.getY(i) * height + base - ground) / 13.2,
          );
      // The registered facade texture resolves individual storeys. Model the
      // projecting two-storey belt courses rather than duplicating every
      // texture seam with a box; this keeps all three exterior views batched
      // within the original geometry budget.
      for (let floor = 6.6; floor < height; floor += 6.6)
        box(
          w + 0.15,
          0.14,
          d + 0.15,
          x,
          base + floor,
          z,
          b.kind === "stone" ? pale : cap,
        );
      // Continuous piers carry the facade rhythm, not unrelated decorative fins.
      const bays = Math.round(w / (b.kind === "stone" ? 3 : 4.5));
      for (let i = 0; i <= bays; i++)
        box(
          0.18,
          height,
          0.22,
          x - w / 2 + (i * w) / bays,
          base + height / 2,
          z + d / 2 + 0.07,
          pale,
        );
      box(w + 0.28, 0.25, d + 0.28, x, base + height + 0.05, z, pale);
      return base + height;
    };
    // Podium + two connected volumes makes roof silhouettes and setbacks read
    // under the downward camera, instead of a fence of equally close boxes.
    shell(b.w + 2.2, b.d + 1.8, 6.6, ground, b.x, b.z);
    const setback = index % 3 === 0 ? 3.3 * 3 : 0;
    const top = shell(b.w, b.d, h - 6.6 - setback, ground + 6.6, b.x, b.z);
    if (setback)
      shell(
        b.w * 0.72,
        b.d * 0.76,
        setback,
        top,
        b.x - b.w * 0.06,
        b.z - b.d * 0.05,
      );
    const roofY = ground + h + 0.175;
    const roofW = setback ? b.w * 0.72 : b.w,
      roofD = setback ? b.d * 0.76 : b.d,
      roofX = setback ? b.x - b.w * 0.06 : b.x,
      roofZ = setback ? b.z - b.d * 0.05 : b.z;
    // Roof deck, perimeter upstands and equipment all sit on the same slab.
    // They remain real batched geometry so an oblique window view has parallax.
    box(roofW - 0.38, 0.035, roofD - 0.38, roofX, roofY + 0.0175, roofZ, cap);
    for (const sign of [-1, 1]) {
      box(
        roofW,
        0.72,
        0.18,
        roofX,
        roofY + 0.36,
        roofZ + (sign * (roofD - 0.18)) / 2,
        pale,
      );
      box(
        0.18,
        0.72,
        roofD - 0.36,
        roofX + (sign * (roofW - 0.18)) / 2,
        roofY + 0.36,
        roofZ,
        pale,
      );
    }
    const equipmentY = roofY + 0.035;
    box(roofW * 0.3, 1.3, roofD * 0.26, roofX, equipmentY + 0.65, roofZ, pale);
    for (let louver = 0; louver < 6; louver++)
      box(
        roofW * 0.3 - 0.3,
        0.055,
        0.055,
        roofX,
        equipmentY + 0.18 + louver * 0.16,
        roofZ + roofD * 0.13 + 0.0175,
        cap,
      );
    for (const dx of [-1, 1])
      box(
        1.15,
        0.65,
        1.7,
        roofX + dx * roofW * 0.27,
        equipmentY + 0.325,
        roofZ - roofD * 0.16,
        pale,
      );
  }
  batchOfficeBackdrop(root);
  return root;
}
