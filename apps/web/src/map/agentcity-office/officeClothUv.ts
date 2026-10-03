// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";

type Point = readonly [number, number];
/** Split only UV seams. Copied normals/positions keep the original continuous
 * silhouette, lighting and contacts; no triangles or surfaces are added. */
export function officeClothUvSeams(
  geometry: THREE.BufferGeometry,
  face: (indices: readonly number[]) => readonly Point[] | undefined,
) {
  const p = geometry.getAttribute("position"),
    n = geometry.getAttribute("normal"),
    uv = geometry.getAttribute("uv");
  const positions = Array.from(p.array),
    normals = Array.from(n.array),
    coords = Array.from(uv.array);
  const indices = Array.from(geometry.index!.array),
    vertices = new Map<string, number>();
  for (let start = 0; start < indices.length; start += 3) {
    const source = indices.slice(start, start + 3),
      mapping = face(source);
    if (!mapping) continue;
    source.forEach((id, corner) => {
      const [u, v] = mapping[corner]!;
      if (Math.abs(uv.getX(id) - u) < 1e-8 && Math.abs(uv.getY(id) - v) < 1e-8)
        return;
      const key = `${id}:${u.toFixed(9)}:${v.toFixed(9)}`;
      let mapped = vertices.get(key);
      if (mapped === undefined) {
        mapped = positions.length / 3;
        vertices.set(key, mapped);
        positions.push(p.getX(id), p.getY(id), p.getZ(id));
        normals.push(n.getX(id), n.getY(id), n.getZ(id));
        coords.push(u, v);
      }
      indices[start + corner] = mapped;
    });
  }
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(coords, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** Closed perimeter strips retain physical edge length and nonzero thickness,
 * instead of reusing coincident front/back UVs on the connecting faces. */
export function officeClothEdgeUv(
  geometry: THREE.BufferGeometry,
  edge: readonly number[],
  backOffset: number,
) {
  const p = geometry.getAttribute("position"),
    distance = [0],
    lookup = new Map(edge.map((id, i) => [id, i]));
  const point = (id: number) => new THREE.Vector3().fromBufferAttribute(p, id);
  for (let i = 0; i < edge.length; i++)
    distance.push(
      distance[i]! +
        point(edge[i]!).distanceTo(point(edge[(i + 1) % edge.length]!)),
    );
  return officeClothUvSeams(geometry, (ids) => {
    if (
      ids.every((id) => id < backOffset) ||
      ids.every((id) => id >= backOffset)
    )
      return;
    const corners = ids.map((id) => lookup.get(id % backOffset)!);
    const wrapped = corners.includes(0) && corners.includes(edge.length - 1);
    return ids.map((id, i) => [
      distance[wrapped && corners[i] === 0 ? edge.length : corners[i]!]!,
      id >= backOffset ? point(id).distanceTo(point(id - backOffset)) : 0,
    ]);
  });
}

/** RoundedBox keeps the box's six face groups. Project each patch in metres,
 * including its rounded edge, rather than stretching one tile over an armrest. */
export function officeClothBoxUv(geometry: THREE.BufferGeometry) {
  const p = geometry.getAttribute("position"),
    uv = geometry.getAttribute("uv");
  for (const group of geometry.groups) {
    const side = group.materialIndex ?? 0;
    for (let i = group.start; i < group.start + group.count; i++) {
      if (side < 2) uv.setXY(i, p.getZ(i), p.getY(i));
      else if (side < 4) uv.setXY(i, p.getX(i), p.getZ(i));
      else uv.setXY(i, p.getX(i), p.getY(i));
    }
  }
  return geometry;
}
