// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Authored desktop objects in metre units. No task state, light source or
 * outside asset is introduced; their common origin is the finished worktop. */
const finish = (color: string, roughness: number, metalness = 0) => {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
  });
  material.userData.officeImmutableFinish = true;
  return material;
};
function part(
  root: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  at: [number, number, number] = [0, 0, 0],
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...at);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.officeStaticArchitecture =
    mesh.userData.officeBatchablePart = true;
  root.add(mesh);
  return mesh;
}
function rounded(
  root: THREE.Object3D,
  name: string,
  size: [number, number, number],
  at: [number, number, number],
  material: THREE.Material,
  radius = 0.004,
) {
  return part(
    root,
    name,
    new RoundedBoxGeometry(
      ...size,
      3,
      Math.min(radius, ...size.map((n) => n / 3)),
    ),
    material,
    at,
  );
}
function rod(
  root: THREE.Object3D,
  name: string,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
) {
  const piece = part(
    root,
    name,
    new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 16),
    material,
  );
  piece.position.copy(start).add(end).multiplyScalar(0.5);
  piece.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    end.clone().sub(start).normalize(),
  );
  return piece;
}
export const DESK_LAMP_JOINTS = [
  [0, 0.047, 0],
  [0.1, 0.31, -0.005],
  [-0.055, 0.5, -0.075],
] as const;

/** An articulated-looking task lamp in a fixed authored pose. Paired lower
 * links meet cylindrical pivots; the hollow shade has an interior and a lip.
 * It is switched off in the daylight scene, not an unmodelled emissive lamp. */
export function officeDeskLamp() {
  const root = new THREE.Group();
  root.name = "office-articulated-desk-lamp";
  root.userData.representation = "authored-fixed-pose-unlit-task-lamp";
  const paint = finish("#e8eef2", 0.32),
    metal = finish("#8e9ca6", 0.26, 0.75),
    rubber = finish("#5a6671", 0.85);
  part(
    root,
    "lamp-base-pad",
    new THREE.CylinderGeometry(0.118, 0.12, 0.008, 48),
    rubber,
    [0, 0.004, 0],
  );
  part(
    root,
    "lamp-weighted-foot",
    new THREE.LatheGeometry(
      [
        [0, 0.008],
        [0.1, 0.008],
        [0.12, 0.018],
        [0.115, 0.032],
        [0.09, 0.043],
        [0, 0.043],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      48,
    ),
    paint,
  );
  const joints = DESK_LAMP_JOINTS.map((p) => new THREE.Vector3(...p));
  for (const side of [-1, 1]) {
    const offset = new THREE.Vector3(0, 0, side * 0.022);
    rod(
      root,
      "lamp-lower-link",
      joints[0]!.clone().add(offset),
      joints[1]!.clone().add(offset),
      0.01,
      metal,
    );
    rod(
      root,
      "lamp-upper-link",
      joints[1]!.clone().add(offset),
      joints[2]!.clone().add(offset),
      0.009,
      paint,
    );
  }
  for (const [i, joint] of joints.entries()) {
    const pivot = part(
      root,
      "lamp-pivot",
      new THREE.CylinderGeometry(
        i === 1 ? 0.027 : 0.022,
        i === 1 ? 0.027 : 0.022,
        0.062,
        32,
      ),
      metal,
    );
    pivot.position.copy(joint);
    pivot.rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      const screw = part(
        root,
        "lamp-pivot-cap",
        new THREE.CylinderGeometry(0.011, 0.011, 0.005, 24),
        paint,
      );
      screw.position.copy(joint).add(new THREE.Vector3(0, 0, side * 0.034));
      screw.rotation.x = Math.PI / 2;
    }
  }
  const head = new THREE.Group();
  head.name = "lamp-shade-assembly";
  head.position.copy(joints[2]!);
  head.rotation.z = -0.3;
  root.add(head);
  part(
    head,
    "lamp-hollow-shade",
    new THREE.LatheGeometry(
      [
        [0.027, 0],
        [0.037, -0.012],
        [0.098, -0.1],
        [0.098, -0.112],
        [0.09, -0.112],
        [0.029, -0.013],
        [0.018, -0.006],
        [0.018, 0],
        [0.027, 0],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      48,
    ),
    paint,
  );
  const bulb = part(
    head,
    "lamp-unlit-diffuser",
    new THREE.SphereGeometry(0.024, 24, 12),
    finish("#f8f6ed", 0.48),
    [0, -0.056, 0],
  );
  bulb.scale.y = 1.25;
  // A connected power lead stays behind the links, not across the Agent's hands.
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.06, 0.031, -0.02),
    new THREE.Vector3(0.13, 0.18, -0.037),
    new THREE.Vector3(0.1, 0.31, -0.04),
    new THREE.Vector3(-0.055, 0.495, -0.11),
  ]);
  part(
    root,
    "lamp-power-lead",
    new THREE.TubeGeometry(path, 28, 0.003, 6, false),
    rubber,
  );
  return root;
}

export function officeKeyboard() {
  const root = new THREE.Group();
  root.name = "office-keyboard";
  const aluminium = finish("#a9bdcc", 0.38, 0.35),
    well = finish("#6e8392", 0.7),
    keys = finish("#e6edf2", 0.6);
  rounded(
    root,
    "keyboard-chassis",
    [0.65, 0.018, 0.16],
    [0, 0.009, 0],
    aluminium,
    0.007,
  );
  rounded(
    root,
    "keyboard-recess",
    [0.617, 0.006, 0.139],
    [0, 0.019, 0],
    well,
    0.005,
  );
  const pieces: THREE.BufferGeometry[] = [],
    layout: { x: number; z: number; width: number }[] = [];
  const addKey = (x: number, z: number, width = 0.033) => {
    // A bevel catches light while the spaces stay dark. Geometric keycaps are
    // merged once, rather than a draw call for every key in every office.
    const geometry = new RoundedBoxGeometry(width, 0.006, 0.022, 2, 0.002);
    geometry.translate(x, 0.025, z);
    pieces.push(geometry);
    layout.push({ x, z, width });
  };
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 16; col++)
      addKey((col - 7.5) * 0.037, (row - 2) * 0.027);
  for (const x of [
    -0.2775, -0.2405, -0.2035, -0.1665, 0.1665, 0.2035, 0.2405, 0.2775,
  ])
    addKey(x, 0.054);
  addKey(0, 0.054, 0.257);
  const caps = mergeGeometries(pieces)!;
  pieces.forEach((g) => g.dispose());
  part(root, "keyboard-sculpted-keycaps", caps, keys);
  root.userData.keyLayout = layout;
  root.userData.representation = "authored-blank-keycaps-no-language-claim";
  return root;
}

export function officeMouse() {
  const root = new THREE.Group();
  root.name = "office-mouse";
  const shell = finish("#e0eaf1", 0.38),
    base = finish("#8399a9", 0.58),
    dark = finish("#4e6576", 0.82);
  const foot = part(
    root,
    "mouse-base",
    new THREE.CylinderGeometry(1, 1, 0.005, 48),
    base,
    [0, 0.0025, 0],
  );
  foot.scale.set(0.037, 1, 0.0625);
  const top = part(
    root,
    "mouse-domed-shell",
    new THREE.SphereGeometry(1, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2),
    shell,
    [0, 0.005, 0],
  );
  top.scale.set(0.037, 0.028, 0.0625);
  const seam = new THREE.CatmullRomCurve3(
    [-0.052, -0.04, -0.02, 0].map(
      (z) =>
        new THREE.Vector3(
          0,
          0.005 + 0.028 * Math.sqrt(1 - (z / 0.0625) ** 2) + 0.0002,
          z,
        ),
    ),
  );
  part(
    root,
    "mouse-button-seam",
    new THREE.TubeGeometry(seam, 20, 0.00065, 5, false),
    dark,
  );
  const wheel = part(
    root,
    "mouse-scroll-wheel",
    new THREE.CylinderGeometry(0.008, 0.008, 0.009, 24),
    dark,
    [0, 0.031, -0.025],
  );
  wheel.rotation.z = Math.PI / 2;
  return root;
}

export function officeMug() {
  const root = new THREE.Group();
  root.name = "office-ceramic-mug";
  const glaze = finish("#dbe7ef", 0.25),
    drink = finish("#54483b", 0.3);
  part(
    root,
    "mug-hollow-vessel",
    new THREE.LatheGeometry(
      [
        [0, 0],
        [0.039, 0],
        [0.049, 0.006],
        [0.055, 0.102],
        [0.054, 0.108],
        [0.047, 0.108],
        [0.042, 0.014],
        [0, 0.014],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      48,
    ),
    glaze,
  );
  part(
    root,
    "mug-handle",
    new THREE.TorusGeometry(0.032, 0.008, 12, 40),
    glaze,
    [0.06, 0.06, 0],
  );
  const liquid = part(
    root,
    "mug-recessed-drink",
    new THREE.CircleGeometry(0.047, 48),
    drink,
    [0, 0.081, 0],
  );
  liquid.rotation.x = -Math.PI / 2;
  return root;
}
