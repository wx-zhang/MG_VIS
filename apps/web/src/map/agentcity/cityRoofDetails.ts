// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";

type Roof = { contours: THREE.Vector2[][]; top: number; scale: number };
export type RoofPart = {
  x: number;
  z: number;
  width: number;
  depth: number;
  angle: number;
  bottom: number;
  height: number;
  finish: "concrete" | "metal" | "vent";
  role: "parapet" | "service-core" | "cap" | "plant" | "louver";
};
type Rectangle = Pick<RoofPart, "x" | "z" | "width" | "depth" | "angle">;

function insideRing(point: THREE.Vector2, ring: THREE.Vector2[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
function insideRoof(point: THREE.Vector2, contours: THREE.Vector2[][]) {
  return (
    !!contours[0]?.length &&
    insideRing(point, contours[0]) &&
    !contours.slice(1).some((ring) => insideRing(point, ring))
  );
}

/** A rectangle fits only if its centre is inside and no roof/hole boundary enters
 * its padded footprint. Corner-only checks miss narrow notches and enclosed holes. */
export function roofRectangleFits(
  rect: Rectangle,
  contours: THREE.Vector2[][],
  margin = 0,
) {
  const center = new THREE.Vector2(rect.x, rect.z);
  if (!(rect.width > 0 && rect.depth > 0) || !insideRoof(center, contours))
    return false;
  const c = Math.cos(rect.angle),
    s = Math.sin(rect.angle);
  const local = (p: THREE.Vector2) =>
    new THREE.Vector2(
      (p.x - rect.x) * c + (p.y - rect.z) * s,
      -(p.x - rect.x) * s + (p.y - rect.z) * c,
    );
  const half = [rect.width / 2 + margin, rect.depth / 2 + margin];
  for (const ring of contours)
    for (let i = 0; i < ring.length; i++) {
      const a = local(ring[i]!),
        b = local(ring[(i + 1) % ring.length]!);
      let enter = 0,
        leave = 1;
      for (let axis = 0; axis < 2; axis++) {
        const start = axis ? a.y : a.x,
          delta = (axis ? b.y : b.x) - start;
        if (Math.abs(delta) < 1e-10) {
          if (Math.abs(start) > half[axis]!) {
            enter = 2;
            break;
          }
        } else {
          const t1 = (-half[axis]! - start) / delta,
            t2 = (half[axis]! - start) / delta;
          enter = Math.max(enter, Math.min(t1, t2));
          leave = Math.min(leave, Math.max(t1, t2));
        }
      }
      if (enter <= leave) return false;
    }
  return true;
}
function clearance(point: THREE.Vector2, contours: THREE.Vector2[][]) {
  if (!insideRoof(point, contours)) return 0;
  let distance = Infinity;
  for (const ring of contours)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!,
        edge = b.clone().sub(a);
      const t = THREE.MathUtils.clamp(
        point.clone().sub(a).dot(edge) / (edge.lengthSq() || 1),
        0,
        1,
      );
      distance = Math.min(
        distance,
        point.distanceTo(a.clone().addScaledVector(edge, t)),
      );
    }
  return distance;
}

/** Small, deterministic roof fittings, NOT inferred/surveyed building equipment.
 * Dimensions are physical metres scaled exactly like the native roof. */
export function planRoofDetails({ contours, top, scale }: Roof): RoofPart[] {
  if (
    !contours[0] ||
    contours[0].length < 3 ||
    !Number.isFinite(top) ||
    !(scale > 0)
  )
    return [];
  const parts: RoofPart[] = [],
    ring = contours[0];
  let angle = 0,
    longest = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!,
      edge = b.clone().sub(a);
    if (edge.lengthSq() > longest) {
      longest = edge.lengthSq();
      angle = Math.atan2(edge.y, edge.x);
    }
  }
  for (const boundary of contours)
    for (let i = 0; i < boundary.length; i++) {
      const a = boundary[i]!,
        b = boundary[(i + 1) % boundary.length]!;
      const edge = b.clone().sub(a),
        length = edge.length();
      if (length < 1.8 * scale) continue;
      const mid = a.clone().add(b).multiplyScalar(0.5),
        normal = new THREE.Vector2(-edge.y, edge.x).normalize();
      for (const side of [1, -1]) {
        const center = mid.clone().addScaledVector(normal, side * 0.3 * scale);
        const part: RoofPart = {
          x: center.x,
          z: center.y,
          width: length - 0.8 * scale,
          depth: 0.24 * scale,
          angle: Math.atan2(edge.y, edge.x),
          bottom: top,
          height: 0.65 * scale,
          finish: "concrete",
          role: "parapet",
        };
        if (roofRectangleFits(part, contours, 0.03 * scale)) {
          parts.push(part);
          break;
        }
      }
    }
  // Grid plus triangle incentres covers both broad slabs and narrow concave roofs.
  const bounds = new THREE.Box2().setFromPoints(ring),
    flat = contours.flat();
  const candidates: THREE.Vector2[] = [];
  for (let x = 1; x < 10; x++)
    for (let z = 1; z < 10; z++)
      candidates.push(
        new THREE.Vector2(
          THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, x / 10),
          THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, z / 10),
        ),
      );
  for (const triangle of THREE.ShapeUtils.triangulateShape(
    ring,
    contours.slice(1),
  )) {
    const [a, b, c] = triangle.map((i) => flat[i]!) as [
      THREE.Vector2,
      THREE.Vector2,
      THREE.Vector2,
    ];
    const wa = b.distanceTo(c),
      wb = a.distanceTo(c),
      wc = a.distanceTo(b);
    if (wa + wb + wc > 0)
      candidates.push(
        a
          .clone()
          .multiplyScalar(wa)
          .addScaledVector(b, wb)
          .addScaledVector(c, wc)
          .divideScalar(wa + wb + wc),
      );
  }
  let center: THREE.Vector2 | undefined,
    radius = 0;
  for (const point of candidates) {
    const r = clearance(point, contours);
    if (r > radius) {
      center = point;
      radius = r;
    }
  }
  if (!center || radius < 4 * scale) return parts;
  const core: RoofPart = {
    x: center.x,
    z: center.y,
    width: Math.min(11 * scale, radius),
    depth: Math.min(7 * scale, radius * 0.72),
    angle,
    bottom: top,
    height: 2.5 * scale,
    finish: "concrete",
    role: "service-core",
  };
  const cap: RoofPart = {
    ...core,
    width: core.width + 0.3 * scale,
    depth: core.depth + 0.3 * scale,
    bottom: top + core.height,
    height: 0.18 * scale,
    finish: "metal",
    role: "cap",
  };
  if (!roofRectangleFits(cap, contours, 1.2 * scale)) return parts;
  parts.push(core, cap);
  const direction = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
  for (const side of [1, -1]) {
    const position = center
      .clone()
      .addScaledVector(direction, side * (core.width / 2 + 3.5 * scale));
    const plant: RoofPart = {
      x: position.x,
      z: position.y,
      width: 3 * scale,
      depth: 2 * scale,
      angle,
      bottom: top,
      height: 1.2 * scale,
      finish: "metal",
      role: "plant",
    };
    if (!roofRectangleFits(plant, contours, 1.2 * scale)) continue;
    parts.push(plant);
    // Six shallow, opaque slats provide a readable vent top without alpha sorting.
    for (let i = 0; i < 6; i++) {
      const p = position
        .clone()
        .addScaledVector(direction, (i - 2.5) * 0.4 * scale);
      parts.push({
        ...plant,
        x: p.x,
        z: p.y,
        width: 0.2 * scale,
        depth: 1.65 * scale,
        bottom: top + plant.height,
        height: 0.06 * scale,
        finish: "vent",
        role: "louver",
      });
    }
  }
  return parts;
}

/** Three material batches for the entire city; no per-roof render loop. */
export function createRoofDetails(parts: RoofPart[]) {
  const group = new THREE.Group();
  group.name = "illustrative-roof-fittings";
  group.userData.representation = "illustrative-roof-fittings-not-surveyed";
  group.userData.partCount = parts.length;
  const unit = new THREE.BoxGeometry(1, 1, 1),
    vertices = unit.getAttribute("position"),
    normals = unit.getAttribute("normal"),
    unitIndices = unit.index!;
  for (const [finish, color] of Object.entries({
    concrete: "#d8e2eb",
    metal: "#aebdca",
    vent: "#687f92",
  })) {
    const selected = parts.filter((part) => part.finish === finish);
    if (!selected.length) continue;
    const positions: number[] = [],
      normal: number[] = [],
      indices: number[] = [];
    for (const p of selected) {
      const c = Math.cos(p.angle),
        s = Math.sin(p.angle),
        offset = positions.length / 3;
      for (let i = 0; i < vertices.count; i++) {
        const x = vertices.getX(i) * p.width,
          z = vertices.getZ(i) * p.depth;
        positions.push(
          p.x + x * c - z * s,
          p.bottom + (vertices.getY(i) + 0.5) * p.height,
          p.z + x * s + z * c,
        );
        const nx = normals.getX(i),
          nz = normals.getZ(i);
        normal.push(nx * c - nz * s, normals.getY(i), nx * s + nz * c);
      }
      for (let i = 0; i < unitIndices.count; i++)
        indices.push(offset + unitIndices.getX(i));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normal, 3),
    );
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ color }),
    );
    mesh.name = `roof-fittings-${finish}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  unit.dispose();
  return {
    group,
    dispose() {
      for (const child of group.children) {
        const mesh = child as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.MeshLambertMaterial
        >;
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      group.clear();
    },
  };
}
