// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

type Point = THREE.Vector2;
export interface BridgeSection {
  point: Point;
  side: Point;
  distance: number;
  top: number;
  water: number | undefined;
}
export interface BridgePlan {
  id: string | number;
  width: number;
  length: number;
  sections: BridgeSection[];
  pierIndices: number[];
}

/** Illustrative bridge construction, not surveyed clearance or civil design.
 * Source owns the whole centreline. Only bank-to-bank mapped spans are built;
 * fragmented ends in water and land-only flyovers retain cartographic lines. */
export function planCityBridge(
  id: string | number,
  source: Point[],
  width: number,
  waterAt: (p: Point) => number | undefined,
  groundAt: (p: Point) => number,
): BridgePlan | undefined {
  if (
    !Number.isFinite(width) ||
    width < 1 ||
    source.length < 2 ||
    source.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    return;
  const sourceLength = source
    .slice(1)
    .reduce((sum, p, i) => sum + p.distanceTo(source[i]!), 0);
  if (sourceLength < 30 || sourceLength > 2400) return;
  const points: { point: Point; distance: number }[] = [
    { point: source[0]!.clone(), distance: 0 },
  ];
  for (let i = 1; i < source.length; i++) {
    const start = points.at(-1)!,
      end = source[i]!,
      length = start.point.distanceTo(end);
    if (length < 0.1) continue;
    const count = Math.ceil(length / 8);
    for (let j = 1; j <= count; j++)
      points.push({
        point: start.point.clone().lerp(end, j / count),
        distance: start.distance + (length * j) / count,
      });
  }
  const length = points.at(-1)!.distance;
  if (length < 30 || length > 2400) return;
  const water = points.map((p) => waterAt(p.point));
  if (water.some((v) => v !== undefined && !Number.isFinite(v))) return;
  if (
    water[0] !== undefined ||
    water.at(-1) !== undefined ||
    !water.some(Number.isFinite)
  )
    return;
  const sections: BridgeSection[] = [];
  const rise = THREE.MathUtils.clamp(length * 0.02, 1.2, 7),
    slab = 0.65;
  for (let i = 0; i < points.length; i++) {
    const { point, distance } = points[i]!,
      prev = points[Math.max(0, i - 1)]!.point,
      next = points[Math.min(points.length - 1, i + 1)]!.point;
    const direction = next.clone().sub(prev).normalize();
    if (direction.lengthSq() < 0.1) return;
    const before = point.clone().sub(prev).normalize(),
      after = next.clone().sub(point).normalize();
    if (i > 0 && i < points.length - 1 && before.dot(after) < 0.25) return;
    const normal = new THREE.Vector2(-direction.y, direction.x);
    // Bounded miter makes consecutive cross-sections meet at bends.
    const reference = i === 0 ? after : before;
    const correction = Math.max(
      0.75,
      Math.abs(normal.dot(new THREE.Vector2(-reference.y, reference.x))),
    );
    const side = normal.multiplyScalar(width / 2 / correction);
    const ground = groundAt(point),
      t = distance / length;
    if (!Number.isFinite(ground)) return;
    const arch = rise * Math.sin(Math.PI * t) ** 2;
    let top = ground + 0.13 + arch;
    for (const p of [point, point.clone().add(side), point.clone().sub(side)]) {
      const surface = waterAt(p);
      if (surface !== undefined && !Number.isFinite(surface)) return;
      if (surface !== undefined)
        top = Math.max(top, surface + slab + 0.22 + arch);
    }
    sections.push({ point, side, distance, top, water: water[i] });
  }
  // A pier is placed only where the mapped water surface exists. Its submerged
  // end is a display termination, never a claimed riverbed/foundation depth.
  const pierIndices: number[] = [];
  let previous = -Infinity;
  for (let i = 1; i < sections.length - 1; i++) {
    const s = sections[i]!;
    if (
      s.water !== undefined &&
      s.distance > 18 &&
      length - s.distance > 18 &&
      s.distance - previous >= 42 &&
      s.top - s.water > 1.4
    ) {
      pierIndices.push(i);
      previous = s.distance;
    }
  }
  return { id, width, length, sections, pierIndices };
}

/** Three static material batches. Deck/caps/piers own support and shadows;
 * delicate rails appear only in close views and never add an animation loop. */
function createBridgeBatch(
  plans: BridgePlan[],
  materials: THREE.MeshStandardMaterial[],
) {
  const group = new THREE.Group();
  group.name = "city-bridge-structures";
  group.userData.representation =
    "osm-centrelines-illustrative-bridge-construction";
  group.userData.spanCount = plans.length;
  group.userData.pierCount = plans.reduce(
    (sum, p) => sum + p.pierIndices.length,
    0,
  );
  const stone: number[] = [],
    asphalt: number[] = [],
    railParts: THREE.BufferGeometry[] = [],
    supportParts: THREE.BufferGeometry[] = [];
  const unit = new THREE.BoxGeometry(1, 1, 1),
    column = new THREE.CylinderGeometry(0.65, 0.85, 1, 10);
  const quad = (
    buffer: number[],
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
  ) => {
    for (const p of [a, b, c, a, c, d]) buffer.push(p.x, p.y, p.z);
  };
  const edge = (s: BridgeSection, side: number, y = 0, inset = 0) =>
    new THREE.Vector3(
      s.point.x + s.side.x * side * (1 - inset / s.side.length()),
      s.top + y,
      s.point.y + s.side.y * side * (1 - inset / s.side.length()),
    );
  const beam = (
    parts: THREE.BufferGeometry[],
    a: THREE.Vector3,
    b: THREE.Vector3,
    width: number,
    height: number,
  ) => {
    const axis = b.clone().sub(a),
      length = axis.length();
    if (length < 0.01) return;
    axis.normalize();
    const right = new THREE.Vector3().crossVectors(
      new THREE.Vector3(0, 1, 0),
      axis,
    );
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    else right.normalize();
    const up = new THREE.Vector3().crossVectors(axis, right).normalize();
    const matrix = new THREE.Matrix4()
      .makeBasis(right, up, axis)
      .scale(new THREE.Vector3(width, height, length));
    matrix.setPosition(a.clone().add(b).multiplyScalar(0.5));
    const copy = unit.clone();
    copy.applyMatrix4(matrix);
    parts.push(copy);
  };
  const slab = 0.65;
  for (const plan of plans) {
    const s = plan.sections;
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1]!,
        b = s[i]!;
      quad(stone, edge(a, -1), edge(a, 1), edge(b, 1), edge(b, -1));
      quad(
        stone,
        edge(a, 1, -slab),
        edge(a, -1, -slab),
        edge(b, -1, -slab),
        edge(b, 1, -slab),
      );
      for (const side of [-1, 1]) {
        if (side > 0)
          quad(
            stone,
            edge(a, side),
            edge(a, side, -slab),
            edge(b, side, -slab),
            edge(b, side),
          );
        else
          quad(
            stone,
            edge(a, side),
            edge(b, side),
            edge(b, side, -slab),
            edge(a, side, -slab),
          );
        // Continuous concrete curb and powder-blue rail, attached to the deck.
        beam(
          supportParts,
          edge(a, side, 0.14, 0.16),
          edge(b, side, 0.14, 0.16),
          0.22,
          0.28,
        );
        for (const y of [0.6, 1.1])
          beam(
            railParts,
            edge(a, side, y, 0.16),
            edge(b, side, y, 0.16),
            0.085,
            0.085,
          );
      }
      const inset = Math.min(0.62, plan.width * 0.15);
      quad(
        asphalt,
        edge(a, -1, 0.015, inset),
        edge(a, 1, 0.015, inset),
        edge(b, 1, 0.015, inset),
        edge(b, -1, 0.015, inset),
      );
    }
    let postDistance = -Infinity;
    for (const p of s)
      if (p.distance - postDistance >= 7.5) {
        for (const side of [-1, 1])
          beam(
            railParts,
            edge(p, side, 0.26, 0.16),
            edge(p, side, 1.12, 0.16),
            0.085,
            0.085,
          );
        postDistance = p.distance;
      }
    for (const i of [0, s.length - 1]) {
      const p = s[i]!;
      if (i)
        quad(
          stone,
          edge(p, -1),
          edge(p, 1),
          edge(p, 1, -slab),
          edge(p, -1, -slab),
        );
      else
        quad(
          stone,
          edge(p, 1),
          edge(p, -1),
          edge(p, -1, -slab),
          edge(p, 1, -slab),
        );
      if (i)
        for (const side of [-1, 1])
          beam(
            railParts,
            edge(p, side, 0.26, 0.16),
            edge(p, side, 1.12, 0.16),
            0.085,
            0.085,
          );
    }
    for (const index of plan.pierIndices) {
      const section = s[index]!,
        bottom = section.water! - 1.2,
        capTop = section.top - slab,
        capBottom = capTop - 0.65;
      const left = edge(section, -0.82, -slab - 0.325),
        right = edge(section, 0.82, -slab - 0.325);
      beam(supportParts, left, right, 1.8, 0.65);
      for (const side of plan.width >= 8 ? [-0.5, 0.5] : [0]) {
        const p = edge(section, side),
          height = capBottom - bottom;
        const radiusScale = Math.min(1, (plan.width * 0.22) / 0.85);
        const copy = column.clone();
        copy.scale(radiusScale, height, radiusScale);
        copy.translate(p.x, bottom + height / 2, p.z);
        supportParts.push(copy);
      }
    }
  }
  unit.dispose();
  column.dispose();
  const raw = (p: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    return g;
  };
  const stoneSurface = raw(stone),
    asphaltGeometry = raw(asphalt);
  // All parts have position/normal attributes. Remove helper UVs before merging.
  for (const g of [...supportParts, ...railParts]) {
    g.deleteAttribute("uv");
  }
  const nonIndexed = (g: THREE.BufferGeometry) => {
    if (!g.index) return g;
    const result = g.toNonIndexed();
    g.dispose();
    return result;
  };
  const supports = [stoneSurface, ...supportParts.map(nonIndexed)];
  const stoneGeometry = mergeGeometries(supports)!;
  supports.forEach((g) => g.dispose());
  const rails = railParts.map(nonIndexed),
    railGeometry = rails.length ? mergeGeometries(rails)! : raw([]);
  rails.forEach((g) => g.dispose());
  const geometry = [stoneGeometry, asphaltGeometry, railGeometry];
  const meshes = geometry.map((g, i) => {
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, materials[i]);
    m.name = [
      "bridge-decks-and-supports",
      "bridge-carriageway",
      "bridge-railings",
    ][i]!;
    m.castShadow = i === 0;
    m.receiveShadow = true;
    group.add(m);
    return m;
  });
  let detailed = false;
  meshes[2]!.visible = false;
  group.userData.triangles = geometry.reduce(
    (sum, g) => sum + g.getAttribute("position").count / 3,
    0,
  );
  return {
    group,
    updateDetail(zoom: number) {
      const next = detailed ? zoom > 14.7 : zoom >= 15.1;
      if (next === detailed) return false;
      detailed = next;
      meshes[2]!.visible = next;
      return true;
    },
    dispose() {
      geometry.forEach((g) => g.dispose());
      group.clear();
    },
  };
}

/** Cooperative builder: cancellation before handoff releases every batch made
 * so far. A single spatial cell is the largest non-yielding construction unit. */
export function* buildCityBridgeScene(plans: BridgePlan[]) {
  const group = new THREE.Group();
  group.name = "city-bridge-structures";
  const cells = new Map<string, BridgePlan[]>();
  for (const plan of plans) {
    const point = plan.sections[Math.floor(plan.sections.length / 2)]!.point;
    const key = `${Math.floor(point.x / 1800)}:${Math.floor(point.y / 1800)}`;
    const list = cells.get(key) ?? [];
    list.push(plan);
    cells.set(key, list);
  }
  const materials = [
    new THREE.MeshStandardMaterial({
      color: "#d9e5e9",
      roughness: 0.76,
      side: THREE.DoubleSide,
    }),
    new THREE.MeshStandardMaterial({
      color: "#849ba8",
      roughness: 0.9,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    new THREE.MeshStandardMaterial({
      color: "#85adc3",
      roughness: 0.38,
      metalness: 0.3,
    }),
  ];
  const batches: ReturnType<typeof createBridgeBatch>[] = [];
  const dispose = () => {
    batches.forEach((b) => b.dispose());
    materials.forEach((m) => m.dispose());
    group.clear();
  };
  let handedOff = false;
  try {
    for (const cell of cells.values()) {
      yield;
      const batch = createBridgeBatch(cell, materials);
      batch.group.name = "city-bridge-cell";
      group.add(batch.group);
      batches.push(batch);
    }
    Object.assign(group.userData, {
      representation: "osm-centrelines-illustrative-bridge-construction",
      spanCount: plans.length,
      spanIds: plans.map((p) => p.id),
      pierCount: plans.reduce((sum, p) => sum + p.pierIndices.length, 0),
      triangles: batches.reduce(
        (sum, b) => sum + b.group.userData.triangles,
        0,
      ),
      cells: cells.size,
    });
    group.visible = false;
    handedOff = true;
    return {
      group,
      updateDetail(zoom: number) {
        const visible = zoom >= 14.6,
          changed = group.visible !== visible;
        group.visible = visible;
        for (const batch of batches) batch.updateDetail(zoom);
        return changed;
      },
      dispose,
    };
  } finally {
    if (!handedOff) dispose();
  }
}

export function createCityBridgeScene(plans: BridgePlan[]) {
  const builder = buildCityBridgeScene(plans);
  for (;;) {
    const next = builder.next();
    if (next.done) return next.value;
  }
}
