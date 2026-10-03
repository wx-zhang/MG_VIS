// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { roofRectangleFits } from "./cityRoofDetails";

export type FacadeVertex = {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
};
export type FacadeQuad = [
  FacadeVertex,
  FacadeVertex,
  FacadeVertex,
  FacadeVertex,
];

/** Primary bays are architectural illustration, not surveyed windows. Recesses
 * stay INSIDE the original outline, leave its corners/base/roof untouched and
 * are closed by real sill/jamb faces. Narrow or unsafe strips keep flat walls. */
export function appendFacadeRelief(options: {
  a: THREE.Vector2;
  b: THREE.Vector2;
  contours: THREE.Vector2[][];
  base: number;
  height: number;
  ground: number;
  scale: number;
  bay: number;
  floor: number;
  family: number;
  quad: (vertices: FacadeQuad, solid: boolean) => void;
}) {
  const {
    a,
    b,
    contours,
    base,
    height,
    ground,
    scale,
    bay,
    floor,
    family,
    quad,
  } = options;
  const along = b.clone().sub(a),
    worldLength = along.length(),
    length = worldLength / scale;
  if (
    !(length >= 4 && height - base >= 6 && scale > 0 && floor > 0 && bay > 0) ||
    family === 3
  )
    return 0;
  along.normalize();
  const normal = new THREE.Vector2(-along.y, along.x),
    depth = 0.42 * scale,
    margin = 0.34 * scale;
  const middle = a.clone().add(b).multiplyScalar(0.5);
  // Test a complete interior strip including holes/notches, not just its centre.
  // The tiny inward gap avoids treating the source wall itself as an intersection.
  let inward: THREE.Vector2 | undefined;
  for (const sign of [1, -1]) {
    const n = normal.clone().multiplyScalar(sign),
      center = middle.clone().addScaledVector(n, depth / 2 + 0.005 * scale);
    if (
      roofRectangleFits(
        {
          x: center.x,
          z: center.y,
          width: worldLength - 2 * margin,
          depth: depth - 0.01 * scale,
          angle: Math.atan2(along.y, along.x),
        },
        contours,
      )
    ) {
      inward = n;
      break;
    }
  }
  if (!inward) return 0;
  const split = (start: number, end: number, period: number) => {
    const result = [start];
    for (
      let v = (Math.floor(start / period) + 1) * period;
      v < end - 1e-5;
      v += period
    )
      result.push(v);
    result.push(end);
    return result;
  };
  // Model the primary vertical construction. Floor-by-floor window/spandrel
  // detail remains in the metre-space material: duplicating every storey here
  // adds citywide geometry with little silhouette value at map distances.
  const xs = split(0, length, bay * 4),
    ys = [base, height];
  const point = (u: number, v: number, recess = 0): FacadeVertex => ({
    x: a.x + along.x * u * scale + inward!.x * recess * scale,
    y: (ground + v) * scale,
    z: a.y + along.y * u * scale + inward!.y * recess * scale,
    u,
    v,
  });
  const rect = (
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    solid: boolean,
    recess = 0,
  ) =>
    quad(
      [
        point(u0, v0, recess),
        point(u1, v0, recess),
        point(u0, v1, recess),
        point(u1, v1, recess),
      ],
      solid,
    );
  let panels = 0;
  for (let ix = 1; ix < xs.length; ix++)
    for (let iy = 1; iy < ys.length; iy++) {
      const u0 = xs[ix - 1]!,
        u1 = xs[ix]!,
        v0 = ys[iy - 1]!,
        v1 = ys[iy]!;
      if (u1 - u0 < 2 || v1 - v0 < 2) {
        rect(u0, v0, u1, v1, false);
        continue;
      }
      const l = u0 + 0.34,
        r = u1 - 0.34,
        bottom = v0 + 0.26,
        top = v1 - 0.26;
      // Four front frame strips tile the source plane without overlap.
      rect(u0, v0, u1, bottom, true);
      rect(u0, top, u1, v1, true);
      rect(u0, bottom, l, top, true);
      rect(r, bottom, u1, top, true);
      rect(l, bottom, r, top, false, 0.42);
      // Sill, head and both jambs connect the frame to the recessed finish.
      quad(
        [
          point(l, bottom),
          point(r, bottom),
          point(l, bottom, 0.42),
          point(r, bottom, 0.42),
        ],
        true,
      );
      quad(
        [
          point(l, top, 0.42),
          point(r, top, 0.42),
          point(l, top),
          point(r, top),
        ],
        true,
      );
      quad(
        [
          point(l, bottom, 0.42),
          point(l, bottom),
          point(l, top, 0.42),
          point(l, top),
        ],
        true,
      );
      quad(
        [
          point(r, bottom),
          point(r, bottom, 0.42),
          point(r, top),
          point(r, top, 0.42),
        ],
        true,
      );
      panels++;
    }
  return panels;
}
