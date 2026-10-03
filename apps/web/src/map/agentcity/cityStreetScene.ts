// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { FACADE_ORIGIN, facadeLocalPoint } from "./cityFacadeScene";
import { streetProfile } from "./streetProfile";

export type StreetFeature = {
  id?: string | number;
  properties: { class?: string; bridge?: boolean; tunnel?: boolean };
  geometry: { type: string; coordinates: number[][] | number[][][] };
};

type Point = {
  coordinate: [number, number];
  p: THREE.Vector2;
  distance: number;
  elevation: number;
  scale: number;
};
type Way = {
  points: Point[];
  profile: NonNullable<ReturnType<typeof streetProfile>>;
  closed: boolean;
};
type Data = { positions: number[]; colors: number[]; indices: number[] };
const data = (): Data => ({ positions: [], colors: [], indices: [] });
const coordinateKey = (c: [number, number]) =>
  `${c[0].toFixed(6)}:${c[1].toFixed(6)}`;
const asphalt = new THREE.Color("#c8d1d5"),
  walking = new THREE.Color("#d9dedb");

/** Sampled, graded ribbons follow the existing geographic centreline. The
 * 22cm clearance is a map rendering offset; 12cm raised curbs are illustrative.
 * Bridges/tunnels stay in the native map: no unsupported deck is invented. */
function* buildCityStreetScene(
  features: StreetFeature[],
  elevation: (c: [number, number]) => number,
) {
  const group = new THREE.Group();
  group.name = "city-street-surfaces";
  group.userData.representation = "osm-centrelines-illustrative-pavement";
  const geometries: THREE.BufferGeometry[] = [],
    materials: THREE.Material[] = [];
  const dispose = () => {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    group.clear();
  };
  let complete = false;
  try {
    const ways: Way[] = [],
      nodes = new Map<string, { count: number; radius: number }>();
    const samples = new Map<string, number>();
    const point = (coordinate: [number, number], distance: number): Point => {
      const key = coordinateKey(coordinate);
      if (!samples.has(key)) {
        const value = elevation(coordinate);
        samples.set(key, Number.isFinite(value) ? value : 0);
      }
      return {
        coordinate,
        p: facadeLocalPoint(coordinate),
        distance,
        elevation: samples.get(key)!,
        scale:
          Math.cos((FACADE_ORIGIN[1] * Math.PI) / 180) /
          Math.cos((coordinate[1] * Math.PI) / 180),
      };
    };
    let featureCount = 0;
    for (const feature of features) {
      yield;
      const profile = streetProfile(feature.properties.class);
      if (
        !profile ||
        feature.properties.bridge ||
        feature.properties.tunnel ||
        feature.properties.class === "steps"
      )
        continue;
      const lines =
        feature.geometry.type === "LineString"
          ? [feature.geometry.coordinates as number[][]]
          : feature.geometry.type === "MultiLineString"
            ? (feature.geometry.coordinates as number[][][])
            : [];
      let accepted = false;
      for (const line of lines) {
        if (
          line.length < 2 ||
          line.some(
            (c) =>
              c.length < 2 ||
              !Number.isFinite(c[0]) ||
              !Number.isFinite(c[1]) ||
              Math.abs(c[0]! - FACADE_ORIGIN[0]) > 0.3 ||
              Math.abs(c[1]! - FACADE_ORIGIN[1]) > 0.3,
          )
        )
          continue;
        const original = line
          .filter(
            (c, i) =>
              !i || c[0] !== line[i - 1]![0] || c[1] !== line[i - 1]![1],
          )
          .map((c) => c.slice(0, 2) as [number, number]);
        const points: Point[] = [point(original[0]!, 0)];
        for (let i = 1; i < original.length; i++) {
          const start = points.at(-1)!,
            end = original[i]!,
            local = facadeLocalPoint(end),
            length = local.distanceTo(start.p);
          if (length < 0.1) continue;
          // At most 25m between terrain samples; no flat strip cutting through slopes.
          const divisions = Math.ceil(length / 25);
          for (let j = 1; j <= divisions; j++) {
            const t = j / divisions;
            points.push(
              point(
                [
                  THREE.MathUtils.lerp(start.coordinate[0], end[0], t),
                  THREE.MathUtils.lerp(start.coordinate[1], end[1], t),
                ],
                start.distance + length * t,
              ),
            );
            if (j % 64 === 0) yield;
          }
          if (i % 64 === 0) yield;
        }
        if (points.length < 2 || points.at(-1)!.distance < 1) continue;
        const closed = points[0]!.p.distanceTo(points.at(-1)!.p) < 0.1;
        // Topology is from source vertices, never a guessed nearest road. Shared
        // junctions cut sidewalk ends back so no curb crosses the carriageway.
        for (let i = 0; i < original.length; i++) {
          if (closed && i === original.length - 1) continue;
          const key = coordinateKey(original[i]!),
            node = nodes.get(key) ?? { count: 0, radius: 0 };
          node.count += closed || (i > 0 && i < original.length - 1) ? 2 : 1;
          node.radius = Math.max(
            node.radius,
            profile.width / 2 + profile.sidewalk + 1,
          );
          nodes.set(key, node);
        }
        ways.push({ points, profile, closed });
        accepted = true;
      }
      if (accepted) featureCount++;
    }
    const cells = new Map<string, { surface: Data; curb: Data }>();
    let segments = 0,
      curbs = 0;
    const append = (d: Data, vertices: number[][], color?: THREE.Color) => {
      const start = d.positions.length / 3;
      for (const vertex of vertices) {
        d.positions.push(...vertex);
        if (color) d.colors.push(color.r, color.g, color.b);
      }
      d.indices.push(
        start,
        start + 1,
        start + 2,
        start + 1,
        start + 3,
        start + 2,
      );
    };
    const miter = (points: Point[], i: number, closed: boolean) => {
      const current = points[i]!,
        prev = points[i - 1] ?? (closed ? points.at(-2)! : current),
        next = points[i + 1] ?? (closed ? points[1]! : current);
      const incoming = current.p.clone().sub(prev.p),
        outgoing = next.p.clone().sub(current.p);
      if (incoming.lengthSq() < 0.001) incoming.copy(outgoing);
      if (outgoing.lengthSq() < 0.001) outgoing.copy(incoming);
      incoming.normalize();
      outgoing.normalize();
      const normal = new THREE.Vector2(-outgoing.y, outgoing.x),
        tangent = incoming.add(outgoing);
      if (tangent.lengthSq() < 0.05) return normal;
      tangent.normalize();
      const n = new THREE.Vector2(-tangent.y, tangent.x),
        denominator = n.dot(normal);
      return n.multiplyScalar(Math.min(1.6, 1 / Math.max(0.1, denominator)));
    };
    for (const way of ways) {
      yield;
      const { points, profile, closed } = way;
      const junctions = points
        .filter((p) => (nodes.get(coordinateKey(p.coordinate))?.count ?? 0) > 2)
        .map((p) => ({
          distance: p.distance,
          radius: nodes.get(coordinateKey(p.coordinate))!.radius,
        }));
      const offsets = points.map((_, i) => miter(points, i, closed));
      for (let i = 1; i < points.length; i++) {
        if (i % 64 === 0) yield;
        const a = points[i - 1]!,
          b = points[i]!,
          key = `${Math.floor((a.p.x + b.p.x) / 6400)}:${Math.floor((a.p.y + b.p.y) / 6400)}`;
        if (!cells.has(key)) cells.set(key, { surface: data(), curb: data() });
        const batch = cells.get(key)!;
        const vertex = (
          p: Point,
          n: THREE.Vector2,
          offset: number,
          lift: number,
        ) => [
          p.p.x + n.x * offset * p.scale,
          (p.elevation + 0.22 + lift) * p.scale,
          p.p.y + n.y * offset * p.scale,
        ];
        const width = profile.width / 2,
          na = offsets[i - 1]!,
          nb = offsets[i]!;
        append(
          batch.surface,
          [
            vertex(a, na, -width, 0),
            vertex(a, na, width, 0),
            vertex(b, nb, -width, 0),
            vertex(b, nb, width, 0),
          ],
          profile.pedestrian ? walking : asphalt,
        );
        segments++;
        if (!profile.sidewalk) continue;
        // Split precisely at junction exclusion boundaries, rather than removing
        // an entire long segment or leaving a transverse curb across the crossing.
        let intervals: [number, number][] = [[a.distance, b.distance]];
        for (const junction of junctions)
          intervals = intervals.flatMap(([lo, hi]) => {
            const jlo = junction.distance - junction.radius,
              jhi = junction.distance + junction.radius;
            if (jhi <= lo || jlo >= hi) return [[lo, hi]] as [number, number][];
            const result: [number, number][] = [];
            if (jlo > lo) result.push([lo, jlo]);
            if (jhi < hi) result.push([jhi, hi]);
            return result;
          });
        for (const [lo, hi] of intervals) {
          if (hi - lo < 0.2) continue;
          const lerp = (distance: number) => {
            const t = (distance - a.distance) / (b.distance - a.distance);
            return {
              p: {
                ...a,
                p: a.p.clone().lerp(b.p, t),
                elevation: THREE.MathUtils.lerp(a.elevation, b.elevation, t),
                scale: THREE.MathUtils.lerp(a.scale, b.scale, t),
              },
              n: na.clone().lerp(nb, t),
            };
          };
          const aa = lerp(lo),
            bb = lerp(hi);
          for (const sign of [-1, 1]) {
            const inside = sign * width,
              outside = sign * (width + profile.sidewalk);
            append(batch.curb, [
              vertex(aa.p, aa.n, inside, 0.12),
              vertex(aa.p, aa.n, outside, 0.12),
              vertex(bb.p, bb.n, inside, 0.12),
              vertex(bb.p, bb.n, outside, 0.12),
            ]);
            append(batch.curb, [
              vertex(aa.p, aa.n, inside, 0),
              vertex(aa.p, aa.n, inside, 0.12),
              vertex(bb.p, bb.n, inside, 0),
              vertex(bb.p, bb.n, inside, 0.12),
            ]);
            curbs++;
          }
        }
      }
    }
    const surfaceMaterial = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
      }),
      curbMaterial = new THREE.MeshLambertMaterial({
        color: "#e2e5e2",
        side: THREE.DoubleSide,
      });
    materials.push(surfaceMaterial, curbMaterial);
    for (const [key, batch] of cells)
      for (const kind of ["surface", "curb"] as const) {
        const d = batch[kind];
        if (!d.indices.length) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(d.positions, 3),
        );
        if (kind === "surface")
          geometry.setAttribute(
            "color",
            new THREE.Float32BufferAttribute(d.colors, 3),
          );
        geometry.setIndex(d.indices);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(
          geometry,
          kind === "surface" ? surfaceMaterial : curbMaterial,
        );
        mesh.name = `street-${kind}-${key}`;
        mesh.receiveShadow = true;
        group.add(mesh);
        geometries.push(geometry);
        yield;
      }
    Object.assign(group.userData, {
      featureCount,
      segments,
      curbs,
      cellCount: cells.size,
      detail: "context",
    });
    group.visible = false;
    let near = false;
    complete = true;
    return {
      group,
      featureCount,
      segments,
      curbs,
      updateDetail(zoom: number) {
        const next = near ? zoom > 14.7 : zoom >= 15.1;
        if (next === near) return false;
        near = next;
        group.visible = near;
        group.userData.detail = near ? "near" : "context";
        return true;
      },
      dispose,
    };
  } finally {
    if (!complete) dispose();
  }
}

/** Deterministic synchronous builder for offline verification. */
export function createCityStreetScene(
  features: StreetFeature[],
  elevation: (c: [number, number]) => number,
) {
  const build = buildCityStreetScene(features, elevation);
  let step = build.next();
  while (!step.done) step = build.next();
  return step.value;
}

/** Share exactly the same topology, but yield time for map motion, dialogue and
 * workroom mounting. Aborting also releases partially constructed geometry. */
export async function createCityStreetSceneAsync(
  features: StreetFeature[],
  elevation: (c: [number, number]) => number,
  signal: AbortSignal,
  scheduling = {
    budgetMs: 8,
    pause: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  },
) {
  const build = buildCityStreetScene(features, elevation);
  let slice = performance.now();
  try {
    while (true) {
      signal.throwIfAborted();
      const step = build.next();
      if (step.done) return step.value;
      if (performance.now() - slice >= scheduling.budgetMs) {
        await scheduling.pause();
        slice = performance.now();
      }
    }
  } finally {
    build.return(undefined as never);
  }
}
