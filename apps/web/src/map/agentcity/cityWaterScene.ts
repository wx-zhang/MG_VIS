// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { streetProfile } from "./streetProfile";
import type { StreetFeature } from "./cityStreetScene";
import {
  planCityBridge,
  buildCityBridgeScene,
  type BridgePlan,
} from "./cityBridgeScene";
import {
  facadeLocalPoint,
  facadeCoordinate,
  FACADE_ORIGIN,
} from "./cityFacadeScene";

export type WaterFeature = {
  geometry: { type: string; coordinates: number[][][] | number[][][][] };
};
type Point = THREE.Vector2;

/** A static architectural water finish, not a fluid/depth/current simulation.
 * Metre-space detail stays registered while the map camera changes. Subpixel
 * slopes fade rather than shimmer; no time uniform or animation loop is used. */
export function createCityWaterMaterial() {
  const detail = { value: 1 };
  const material = new THREE.MeshStandardMaterial({
    color: "#8bbfd7",
    roughness: 0.3,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  material.name = "geographic-water-daylight";
  material.userData.detail = detail;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.waterDetail = detail;
    const varyings =
      "varying vec2 vWaterMetres; varying vec3 vWaterEast; varying vec3 vWaterSouth;\n";
    shader.vertexShader = varyings + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      vWaterMetres=position.xz;
      vWaterEast=normalize((modelViewMatrix*vec4(1.,0.,0.,0.)).xyz);
      vWaterSouth=normalize((modelViewMatrix*vec4(0.,0.,1.,0.)).xyz);`,
    );
    shader.fragmentShader =
      `uniform float waterDetail;\n${varyings}
      float waterHash(vec2 p) {
        return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);
      }
      // Static, smoothly joined wind patches. Filter in screen space: small
      // patches converge to their mean, rather than crawling as the map turns.
      float waterNoise(vec2 p) {
        vec2 i=floor(p), f=fract(p), u=f*f*(3.-2.*f);
        float n=mix(mix(waterHash(i),waterHash(i+vec2(1.,0.)),u.x),
          mix(waterHash(i+vec2(0.,1.)),waterHash(i+vec2(1.,1.)),u.x),u.y);
        float footprint=max(fwidth(p.x),fwidth(p.y));
        return mix(n,.5,smoothstep(.35,1.,footprint));
      }
      ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      // An illustrative optical finish, not water depth or real-time weather.
      // Large irregular patches remain legible in the city overview; fine
      // directional texture appears only when it occupies actual pixels.
      vec2 waterWind=vec2(dot(vWaterMetres,vec2(.93,.37)),dot(vWaterMetres,vec2(-.37,.93)));
      float waterPatch=waterNoise(waterWind*vec2(.0027,.0048));
      float waterStreak=waterNoise(waterWind*vec2(.016,.075));
      float waterFine=waterNoise(waterWind*vec2(.12,.65));
      diffuseColor.rgb*=1.+((waterPatch-.5)*.14+(waterStreak-.5)*.09+(waterFine-.5)*.045)*waterDetail;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
      // A small directional ripple field perturbs only optical normals. Neither
      // the shoreline nor elevations are displaced by this material.
      vec2 k1=vec2(.44,.17), k2=vec2(-.19,.53), k3=vec2(1.13,.61);
      vec3 phase=vec3(dot(vWaterMetres,k1),dot(vWaterMetres,k2),dot(vWaterMetres,k3));
      vec3 filtered=1.0-smoothstep(vec3(.7),vec3(2.7),fwidth(phase));
      vec2 slope=(k1*cos(phase.x)*filtered.x*.12
        +k2*cos(phase.y)*filtered.y*.07+k3*cos(phase.z)*filtered.z*.018)*waterDetail;
      // A second optical scale prevents a flat fill at overview distances.
      // Its low-amplitude slopes do not raise the river or move its banks.
      vec2 broadPhase=vec2(dot(vWaterMetres,vec2(.037,.014)),dot(vWaterMetres,vec2(-.021,.058)));
      vec2 broadFilter=1.-smoothstep(vec2(.7),vec2(2.7),fwidth(broadPhase));
      slope+=(vec2(.93,.37)*cos(broadPhase.x)*broadFilter.x*.045
        +vec2(-.34,.94)*cos(broadPhase.y)*broadFilter.y*.025)
        *(.7+waterPatch*.6)*waterDetail;
      normal=normalize(normal-vWaterEast*slope.x-vWaterSouth*slope.y);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
      roughnessFactor=mix(roughnessFactor,.24+waterPatch*.14,waterDetail);`,
    );
  };
  material.customProgramCacheKey = () => "city-water-static-metre-finish-v2";
  return material;
}

/** Preserve OSM boundaries and islands. Terrain is the same coarse DEM used by
 * the map; the 28cm offset avoids depth conflicts, not a measured water level. */
function* buildWater(
  features: WaterFeature[],
  elevation: (c: [number, number]) => number,
  roads: StreetFeature[],
) {
  const positions: number[] = [],
    normals: number[] = [];
  const elevations = new Map<string, number>();
  // The bundled z6 DEM is kilometres per texel. Cache a much finer 100m
  // sampling grid so dense shoreline vertices do not repeatedly query the
  // map's entire terrain tile manager. This is display interpolation, not a
  // measured water level or a replacement for the source geographic outline.
  const sample = (x: number, z: number) => {
    const key = `${x}:${z}`;
    if (!elevations.has(key)) {
      const value = elevation(facadeCoordinate(x * 100, z * 100));
      elevations.set(key, Number.isFinite(value) ? value : 0);
    }
    return elevations.get(key)!;
  };
  let featureCount = 0,
    work = 0;
  const height = (p: Point) => {
    const coordinate = facadeCoordinate(p.x, p.y);
    const gx = p.x / 100,
      gz = p.y / 100,
      x = Math.floor(gx),
      z = Math.floor(gz);
    const value = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(sample(x, z), sample(x + 1, z), gx - x),
      THREE.MathUtils.lerp(sample(x, z + 1), sample(x + 1, z + 1), gx - x),
      gz - z,
    );
    const scale =
      Math.cos((FACADE_ORIGIN[1] * Math.PI) / 180) /
      Math.cos((coordinate[1] * Math.PI) / 180);
    const y = ((Number.isFinite(value) ? value : 0) + 0.28) * scale;
    return y;
  };
  for (const feature of features) {
    yield;
    const polygons =
      feature.geometry?.type === "Polygon"
        ? [feature.geometry.coordinates as number[][][]]
        : feature.geometry?.type === "MultiPolygon"
          ? (feature.geometry.coordinates as number[][][][])
          : [];
    let accepted = false;
    for (const polygon of polygons) {
      if (
        !polygon.length ||
        polygon.some(
          (ring) =>
            ring.length < 4 ||
            ring.some(
              (c) =>
                c.length < 2 ||
                !Number.isFinite(c[0]) ||
                !Number.isFinite(c[1]) ||
                Math.abs(c[0]! - FACADE_ORIGIN[0]) > 0.3 ||
                Math.abs(c[1]! - FACADE_ORIGIN[1]) > 0.3,
            ),
        )
      )
        continue;
      const rings = polygon.map((ring) =>
        ring.slice(0, -1).map((c) => facadeLocalPoint(c as [number, number])),
      );
      const points = rings.flat(),
        triangles = THREE.ShapeUtils.triangulateShape(
          rings[0]!,
          rings.slice(1),
        );
      for (const tri of triangles) {
        const stack: [Point, Point, Point, number][] = [
          [points[tri[0]!]!, points[tri[1]!]!, points[tri[2]!]!, 0],
        ];
        while (stack.length) {
          const [a, b, c, depth] = stack.pop()!;
          const edges = [
            a.distanceToSquared(b),
            b.distanceToSquared(c),
            c.distanceToSquared(a),
          ];
          const edge = edges.indexOf(Math.max(...edges));
          if (edges[edge]! > 120 ** 2 && depth < 18) {
            const v = [a, b, c],
              p = v[edge]!,
              q = v[(edge + 1) % 3]!,
              r = v[(edge + 2) % 3]!;
            const mid = p.clone().add(q).multiplyScalar(0.5);
            stack.push([p, mid, r, depth + 1], [mid, q, r, depth + 1]);
          } else {
            // x/z is a south-positive map plane; enforce upward-facing winding.
            const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
            if (Math.abs(cross) < 1e-5) continue;
            for (const p of cross > 0 ? [a, c, b] : [a, b, c]) {
              positions.push(p.x, height(p), p.y);
              normals.push(0, 1, 0);
            }
            accepted = true;
          }
          if (++work % 64 === 0) yield;
        }
      }
    }
    if (accepted) featureCount++;
  }
  // Re-present only explicitly mapped bridge centrelines above the water finish.
  // Keep thin cartographic ribbons as a fallback for partial spans/flyovers.
  // Native lines otherwise live in the terrain colour and would be occluded.
  const bridgePositions: number[] = [];
  // A terrain-draped triangle interpolates between its actual vertices. A denser
  // line sampling the DEM again can sit below that triangle on a coarse slope.
  // Seat bridge display lines above the rendered surface, not a guessed offset.
  const waterCells = new Map<string, number[]>();
  for (let i = 0; i < positions.length; i += 9) {
    const minX = Math.floor(
      Math.min(positions[i]!, positions[i + 3]!, positions[i + 6]!) / 200,
    );
    const maxX = Math.floor(
      Math.max(positions[i]!, positions[i + 3]!, positions[i + 6]!) / 200,
    );
    const minZ = Math.floor(
      Math.min(positions[i + 2]!, positions[i + 5]!, positions[i + 8]!) / 200,
    );
    const maxZ = Math.floor(
      Math.max(positions[i + 2]!, positions[i + 5]!, positions[i + 8]!) / 200,
    );
    for (let x = minX; x <= maxX; x++)
      for (let z = minZ; z <= maxZ; z++) {
        const key = `${x}:${z}`,
          cell = waterCells.get(key) ?? [];
        cell.push(i);
        waterCells.set(key, cell);
      }
    if (i % 576 === 0) yield;
  }
  const waterHeightAt = (p: Point) => {
    let top: number | undefined;
    for (const i of waterCells.get(
      `${Math.floor(p.x / 200)}:${Math.floor(p.y / 200)}`,
    ) ?? []) {
      const ax = positions[i]!,
        az = positions[i + 2]!,
        bx = positions[i + 3]!,
        bz = positions[i + 5]!,
        cx = positions[i + 6]!,
        cz = positions[i + 8]!;
      const divisor = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(divisor) < 1e-8) continue;
      const u = ((bz - cz) * (p.x - cx) + (cx - bx) * (p.y - cz)) / divisor;
      const v = ((cz - az) * (p.x - cx) + (ax - cx) * (p.y - cz)) / divisor,
        w = 1 - u - v;
      if (u >= -1e-7 && v >= -1e-7 && w >= -1e-7)
        top = Math.max(
          top ?? -Infinity,
          u * positions[i + 1]! + v * positions[i + 4]! + w * positions[i + 7]!,
        );
    }
    return top;
  };
  const bridgeHeight = (p: Point) =>
    Math.max(height(p), waterHeightAt(p) ?? -Infinity) + 0.13;
  const bridgePlans: BridgePlan[] = [];
  let bridgeCount = 0;
  for (const feature of roads) {
    yield;
    const profile = streetProfile(feature.properties?.class);
    if (
      !profile ||
      feature.properties.bridge !== true ||
      feature.properties.tunnel
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
        line.some(
          (c) =>
            !Number.isFinite(c[0]) ||
            !Number.isFinite(c[1]) ||
            Math.abs(c[0]! - FACADE_ORIGIN[0]) > 0.3 ||
            Math.abs(c[1]! - FACADE_ORIGIN[1]) > 0.3,
        )
      )
        continue;
      const points = line.map((c) => facadeLocalPoint(c as [number, number]));
      const plan = planCityBridge(
        feature.id ?? `bridge-${bridgeCount}`,
        points,
        profile.width,
        waterHeightAt,
        height,
      );
      if (plan) bridgePlans.push(plan);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!,
          b = points[i]!,
          delta = b.clone().sub(a),
          length = delta.length();
        if (length < 0.1) continue;
        const halfWidth = profile.width / 2,
          side = new THREE.Vector2(-delta.y, delta.x)
            .normalize()
            .multiplyScalar(halfWidth);
        const divisions = Math.ceil(length / 25);
        for (let j = 0; j < divisions; j++) {
          const p = a.clone().lerp(b, j / divisions),
            q = a.clone().lerp(b, (j + 1) / divisions);
          const vertices = [
            p.clone().add(side),
            p.clone().sub(side),
            q.clone().add(side),
            q.clone().sub(side),
          ];
          for (const k of [0, 2, 1, 1, 2, 3]) {
            const v = vertices[k]!;
            bridgePositions.push(v.x, bridgeHeight(v), v.y);
          }
          if (++work % 64 === 0) yield;
        }
        accepted = true;
      }
    }
    if (accepted) bridgeCount++;
  }
  // Bridge cells yield cooperatively and release partial geometry on generator
  // cancellation. Allocate the water/ribbon GPU resources after their handoff;
  // no further yield can leave those resources stranded mid-construction.
  const structures = yield* buildCityBridgeScene(bridgePlans);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  const material = createCityWaterMaterial(),
    mesh = new THREE.Mesh(geometry, material);
  mesh.name = "city-geographic-water";
  mesh.receiveShadow = true;
  mesh.userData.representation = "osm-water-static-illustrative-finish";
  mesh.userData.featureCount = featureCount;
  mesh.userData.triangles = positions.length / 9;
  mesh.userData.terrainSamples = elevations.size;
  const bridgeGeometry = new THREE.BufferGeometry();
  bridgeGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(bridgePositions, 3),
  );
  bridgeGeometry.computeVertexNormals();
  bridgeGeometry.computeBoundingSphere();
  const bridgeMaterial = new THREE.MeshLambertMaterial({
    color: "#c8d1d5",
    side: THREE.DoubleSide,
  });
  const bridges = new THREE.Mesh(bridgeGeometry, bridgeMaterial);
  bridges.name = "city-mapped-bridge-lines";
  bridges.receiveShadow = true;
  bridges.userData.representation =
    "osm-bridge-centrelines-cartographic-ribbons";
  bridges.userData.featureCount = bridgeCount;
  return {
    mesh,
    bridges,
    structures,
    featureCount,
    dispose() {
      geometry.dispose();
      material.dispose();
      bridgeGeometry.dispose();
      bridgeMaterial.dispose();
      structures.dispose();
    },
  };
}

export function createCityWaterScene(
  features: WaterFeature[],
  elevation: (c: [number, number]) => number,
  roads: StreetFeature[] = [],
) {
  const builder = buildWater(features, elevation, roads);
  for (;;) {
    const next = builder.next();
    if (next.done) return next.value;
  }
}

export async function createCityWaterSceneAsync(
  features: WaterFeature[],
  elevation: (c: [number, number]) => number,
  signal: AbortSignal,
  roads: StreetFeature[] = [],
) {
  const builder = buildWater(features, elevation, roads);
  let checkpoint = performance.now();
  for (;;) {
    if (signal.aborted) {
      builder.return(undefined as never);
      throw new DOMException("Water construction cancelled", "AbortError");
    }
    const next = builder.next();
    if (next.done) return next.value;
    if (performance.now() - checkpoint >= 8) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      checkpoint = performance.now();
    }
  }
}
