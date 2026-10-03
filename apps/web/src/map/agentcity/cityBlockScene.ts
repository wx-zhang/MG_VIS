// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import {
  facadeLocalPoint,
  FACADE_ORIGIN,
  localBuildingPolygons,
  type FacadeFeature,
} from "./cityFacadeScene";
import { roofRectangleFits } from "./cityRoofDetails";

type BlockFeature = FacadeFeature & {
  properties: FacadeFeature["properties"] & { building?: string };
};
type GeometryData = {
  positions: number[];
  colors: number[];
  indices: number[];
  uv: number[];
  spec: number[];
};
type Rim = {
  x: number;
  z: number;
  width: number;
  depth: number;
  angle: number;
  top: number;
  scale: number;
};
type Batch = { walls: GeometryData; roof: GeometryData; rims: Rim[] };
const data = (): GeometryData => ({
  positions: [],
  colors: [],
  indices: [],
  uv: [],
  spec: [],
});
const palette = ["#e6edf0", "#e4e9e5", "#efede6", "#dce6eb", "#ecece9"].map(
  (c) => new THREE.Color(c),
);
const roofPalette = ["#d5e0e5", "#dbe3e4", "#e0e4df", "#c9d8e1", "#e1e6e8"].map(
  (c) => new THREE.Color(c),
);
function hash(value: string) {
  let n = 2166136261;
  for (const c of value) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
function geometry(d: GeometryData, withSpec = false) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(d.positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(d.colors, 3));
  if (withSpec) {
    g.setAttribute("uv", new THREE.Float32BufferAttribute(d.uv, 2));
    g.setAttribute("blockSpec", new THREE.Float32BufferAttribute(d.spec, 3));
  }
  g.setIndex(d.indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Architectural colour/window treatment is authored, not measured OSM facade
 * data. The geometry itself keeps the original contours, holes and elevations. */
export function createCityBlockScene(
  features: BlockFeature[],
  elevation: (c: [number, number]) => number,
) {
  const group = new THREE.Group();
  group.name = "city-neighbourhood-buildings";
  group.userData.representation = "osm-footprints-illustrative-lowrise-finish";
  const cells = new Map<string, Batch>();
  let count = 0,
    wallCount = 0,
    rimCount = 0;
  const representedIds = new Set<string | number>();
  for (const feature of features) {
    const {
      render_height: height,
      render_min_height: base,
      hasParts,
      building,
    } = feature.properties;
    if (
      hasParts ||
      !Number.isFinite(height) ||
      !Number.isFinite(base) ||
      height < 2 ||
      height >= 60 ||
      height <= base
    )
      continue;
    const polygons = localBuildingPolygons(feature);
    if (!polygons) continue;
    let accepted = false;
    for (const polygon of polygons) {
      const points = polygon[0]?.slice(0, -1);
      if (
        !points ||
        points.length < 3 ||
        polygon.some((ring) => ring.some((c) => !c.every(Number.isFinite)))
      )
        continue;
      const center = points.reduce(
        (a, p) => [a[0] + p[0]! / points.length, a[1] + p[1]! / points.length],
        [0, 0],
      ) as [number, number];
      if (
        Math.abs(center[0] - FACADE_ORIGIN[0]) > 0.3 ||
        Math.abs(center[1] - FACADE_ORIGIN[1]) > 0.3
      )
        continue;
      const p = facadeLocalPoint(center),
        key = `${Math.floor(p.x / 1600)}:${Math.floor(p.y / 1600)}`;
      if (!cells.has(key))
        cells.set(key, { walls: data(), roof: data(), rims: [] });
      const batch = cells.get(key)!;
      const scale =
        Math.cos((FACADE_ORIGIN[1] * Math.PI) / 180) /
        Math.cos((center[1] * Math.PI) / 180);
      const sample = elevation(center),
        ground = Number.isFinite(sample) ? sample : 0;
      const bottom = (ground + base) * scale,
        top = (ground + height) * scale;
      const contours = polygon.map((r) =>
        r.slice(0, -1).map((c) => facadeLocalPoint(c as [number, number])),
      );
      const seed = hash(String(feature.id ?? center.join(","))),
        color = palette[seed % palette.length]!,
        roofColor = roofPalette[seed % roofPalette.length]!;
      const floorHeight =
        (height - base) / Math.max(1, Math.round((height - base) / 3.2));
      // Open roofs, utility shelters and special structures must not acquire
      // invented office windows. Other window layouts remain explicitly illustrative.
      const plain =
        /^(?:roof|shed|garage|garages|industrial|warehouse|hangar|stadium|grandstand|temple|church|mosque|chapel|steps|veranda|construction)$/.test(
          building ?? "",
        ) || height - base < 3.1;
      for (const ring of contours) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!,
            b = ring[(i + 1) % ring.length]!,
            edge = b.clone().sub(a),
            length = edge.length() / scale;
          if (length < 0.1) continue;
          const d = batch.walls,
            o = d.positions.length / 3;
          d.positions.push(
            a.x,
            bottom,
            a.y,
            b.x,
            bottom,
            b.y,
            a.x,
            top,
            a.y,
            b.x,
            top,
            b.y,
          );
          d.uv.push(0, 0, length, 0, 0, height - base, length, height - base);
          for (let j = 0; j < 4; j++) {
            d.colors.push(color.r, color.g, color.b);
            d.spec.push(
              length / Math.max(1, Math.floor(length / 3.4)),
              floorHeight,
              plain ? 0 : 1,
            );
          }
          d.indices.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
          wallCount++;
          // Narrow parapets sit INSIDE the contour; inset/corner checks also
          // protect notches and courtyards. Their 32cm extension is illustrative.
          if (plain || length < 4) continue;
          const mid = a.clone().add(b).multiplyScalar(0.5),
            normal = new THREE.Vector2(-edge.y, edge.x).normalize();
          for (const side of [1, -1]) {
            const c = mid.clone().addScaledVector(normal, side * 0.25 * scale);
            const rim = {
              x: c.x,
              z: c.y,
              width: edge.length() - 0.65 * scale,
              depth: 0.18 * scale,
              angle: Math.atan2(edge.y, edge.x),
              top,
              scale,
            };
            if (roofRectangleFits(rim, contours, 0.025 * scale)) {
              batch.rims.push(rim);
              rimCount++;
              break;
            }
          }
        }
      }
      const d = batch.roof,
        o = d.positions.length / 3;
      for (const v of contours.flat()) {
        d.positions.push(v.x, top, v.y);
        d.colors.push(roofColor.r, roofColor.g, roofColor.b);
      }
      for (const tri of THREE.ShapeUtils.triangulateShape(
        contours[0]!,
        contours.slice(1),
      ))
        d.indices.push(o + tri[2]!, o + tri[1]!, o + tri[0]!);
      accepted = true;
    }
    if (accepted) {
      count++;
      representedIds.add(feature.id);
    }
  }
  const wallMaterial = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  wallMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "attribute vec3 blockSpec;\nvarying vec2 vBlockUv;\nvarying vec3 vBlockSpec;\n" +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvBlockUv=uv;vBlockSpec=blockSpec;",
    );
    shader.fragmentShader =
      "varying vec2 vBlockUv;\nvarying vec3 vBlockSpec;\n" +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      vec2 cell=vBlockUv/vBlockSpec.xy;
      vec2 aa=max(fwidth(cell),vec2(.0001));
      vec2 f=fract(cell);
      vec2 opening=smoothstep(vec2(.18,.26)-aa,vec2(.18,.26)+aa,f)*(1.0-smoothstep(vec2(.82,.84)-aa,vec2(.82,.84)+aa,f));
      float resolution=1.0-smoothstep(.20,.70,max(aa.x,aa.y));
      float detail=resolution*vBlockSpec.z;
      // Preserve the area-weighted window/wall finish when a bay becomes
      // subpixel. Fading the windows to zero incorrectly turns distant glazed
      // buildings into white masonry and makes the city change colour on zoom.
      float pane=mix(.64*.58,opening.x*opening.y,resolution)*vBlockSpec.z;
      // Restrained sky-blue panes with an inset jamb and a sill below each opening.
      float reveal=1.0-smoothstep(.19,.25,f.x);
      vec3 glass=mix(vec3(.365,.515,.62),mix(vec3(.30,.44,.55),vec3(.43,.59,.69),smoothstep(.27,.82,f.y)),resolution);
      glass*=1.0-reveal*.17*resolution;
      float transom=(1.0-smoothstep(.012,.012+aa.x,abs(f.x-.5)))*pane*resolution;
      diffuseColor.rgb=mix(diffuseColor.rgb,glass,pane);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.73,.81,.84),transom*.6);
      float floorLine=(1.0-smoothstep(.018,.018+aa.y,min(f.y,1.0-f.y)))*detail;
      diffuseColor.rgb*=1.0-floorLine*.09;
    `,
    );
  };
  wallMaterial.customProgramCacheKey = () =>
    "city-neighbourhood-metre-windows-v2";
  const roofMaterial = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const rimMaterial = new THREE.MeshLambertMaterial({ color: "#e4eaec" }),
    rimGeometry = new THREE.BoxGeometry(1, 1, 1);
  const uniqueGeometry: THREE.BufferGeometry[] = [],
    rims: THREE.InstancedMesh[] = [];
  const dummy = new THREE.Object3D();
  for (const [key, batch] of cells) {
    for (const kind of ["walls", "roof"] as const) {
      const g = geometry(batch[kind], kind === "walls");
      uniqueGeometry.push(g);
      const mesh = new THREE.Mesh(
        g,
        kind === "walls" ? wallMaterial : roofMaterial,
      );
      mesh.name = `city-block-${kind}-${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (batch.rims.length) {
      const mesh = new THREE.InstancedMesh(
        rimGeometry,
        rimMaterial,
        batch.rims.length,
      );
      mesh.name = `city-block-parapets-${key}`;
      for (let i = 0; i < batch.rims.length; i++) {
        const r = batch.rims[i]!;
        dummy.position.set(r.x, r.top + 0.16 * r.scale, r.z);
        dummy.rotation.set(0, -r.angle, 0);
        dummy.scale.set(r.width, 0.32 * r.scale, r.depth);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      rims.push(mesh);
    }
  }
  group.userData.featureCount = count;
  group.userData.wallCount = wallCount;
  group.userData.rimCount = rimCount;
  group.userData.cellCount = cells.size;
  group.userData.detail = "context";
  let near = false;
  for (const rim of rims) rim.visible = false;
  return {
    group,
    count,
    wallCount,
    rimCount,
    representedIds,
    updateDetail(zoom: number) {
      const next = near ? zoom > 14.7 : zoom >= 15.1;
      if (next === near) return false;
      near = next;
      for (const rim of rims) rim.visible = near;
      group.userData.detail = near ? "near" : "context";
      return true;
    },
    dispose() {
      for (const g of uniqueGeometry) g.dispose();
      for (const mesh of rims) mesh.dispose();
      rimGeometry.dispose();
      wallMaterial.dispose();
      roofMaterial.dispose();
      rimMaterial.dispose();
      group.clear();
    },
  };
}
