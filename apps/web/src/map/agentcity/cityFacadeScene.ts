// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { MAP_SUN } from "./mapLighting";
import {
  createRoofDetails,
  planRoofDetails,
  type RoofPart,
} from "./cityRoofDetails";
import { createFacadeMaterial, facadeFinish } from "./cityFacadeFinish";
import { appendFacadeRelief, type FacadeQuad } from "./cityFacadeRelief";

export type FacadeFeature = {
  type: "Feature";
  id: string | number;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    osmId?: string | number;
    render_height: number;
    render_min_height: number;
    hasParts?: boolean;
    building?: string;
    townStyle?: "house" | "shop" | "civic";
    townPalette?: number;
    townRotation?: number;
    roofHeight?: number;
  };
};
export const FACADE_ORIGIN: [number, number] = [106.71, 10.79];

/** Accept a complete local feature or leave all of it to the native map.
 * In particular, do not swallow distant parts of a mixed multipolygon. */
export function localBuildingPolygons(feature: FacadeFeature) {
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates as number[][][]]
      : (feature.geometry.coordinates as number[][][][]);
  if (
    !polygons.length ||
    polygons.some(
      (polygon) =>
        !polygon.length ||
        polygon.some(
          (ring) =>
            ring.length < 4 ||
            ring.some(
              (p) =>
                p.length < 2 ||
                !p.every(Number.isFinite) ||
                Math.abs(p[0]! - FACADE_ORIGIN[0]) > 0.3 ||
                Math.abs(p[1]! - FACADE_ORIGIN[1]) > 0.3,
            ),
        ),
    )
  )
    return;
  return polygons;
}
const circumference = 40075016.68557849;
const mercator = ([lng, lat]: number[]) => [
  (lng! + 180) / 360,
  (180 -
    (180 / Math.PI) *
      Math.log(Math.tan(Math.PI / 4 + (lat! * Math.PI) / 360))) /
    360,
];
const origin = mercator(FACADE_ORIGIN);
export const FACADE_MERCATOR_SCALE =
  1 / (circumference * Math.cos((FACADE_ORIGIN[1] * Math.PI) / 180));

export function facadeLocalPoint(coordinate: [number, number]) {
  const point = mercator(coordinate);
  return new THREE.Vector2(
    (point[0]! - origin[0]!) / FACADE_MERCATOR_SCALE,
    (point[1]! - origin[1]!) / FACADE_MERCATOR_SCALE,
  );
}
export function facadeCoordinate(x: number, z: number): [number, number] {
  const mx = origin[0]! + x * FACADE_MERCATOR_SCALE;
  const my = origin[1]! + z * FACADE_MERCATOR_SCALE;
  return [
    mx * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI,
  ];
}

/** Shadow-only receiver sampled from the same coarse map terrain. It does not
 * replace roads or water with a painted plane or invent missing low-rise casters. */
function shadowGround(
  bounds: THREE.Box3,
  elevation: (coordinate: [number, number]) => number,
) {
  const grid = 96,
    padding = 750;
  const minX = bounds.min.x - padding,
    minZ = bounds.min.z - padding;
  const width = bounds.max.x - bounds.min.x + padding * 2;
  const depth = bounds.max.z - bounds.min.z + padding * 2;
  const geometry = new THREE.PlaneGeometry(width, depth, grid, grid);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(minX + width / 2, 0, minZ + depth / 2);
  const vertices = geometry.getAttribute("position");
  for (let i = 0; i < vertices.count; i++) {
    const coordinate = facadeCoordinate(vertices.getX(i), vertices.getZ(i));
    const ratio =
      Math.cos((FACADE_ORIGIN[1] * Math.PI) / 180) /
      Math.cos((coordinate[1] * Math.PI) / 180);
    vertices.setY(i, elevation(coordinate) * ratio + 0.18);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.ShadowMaterial({
    color: "#496077",
    opacity: 0.26,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "terrain-shadow-receiver";
  mesh.receiveShadow = true;
  mesh.userData.representation = "coarse-terrain-highrise-shadows";
  return mesh;
}

/** Native OSM wall/roof profiles; window treatment and rooftop fittings are illustrative. */
export function createCityFacadeScene(
  features: FacadeFeature[],
  elevation: (coordinate: [number, number]) => number,
) {
  const scene = new THREE.Scene();
  scene.name = "city-facade-detail";
  const positions: number[] = [],
    uvs: number[] = [],
    solidFaces: number[] = [],
    specifications: number[] = [],
    indices: number[] = [];
  let walls = 0,
    recessedPanels = 0;
  const representedIds = new Set<string | number>();
  const roofPositions: number[] = [],
    roofIndices: number[] = [];
  const roofParts: RoofPart[] = [];
  for (const feature of features) {
    const {
      render_height: height,
      render_min_height: base,
      hasParts,
    } = feature.properties;
    if (
      hasParts ||
      !Number.isFinite(height) ||
      !Number.isFinite(base) ||
      height <= base
    )
      continue;
    const finish = facadeFinish(
      feature.properties.building,
      height - base,
      String(feature.id),
    );
    // The combined country snapshot also contains Ha Long Bay legacy towers.
    // They stay in the native map, not in the HCMC shadow receiver / mesh.
    const polygons = localBuildingPolygons(feature);
    if (!polygons) continue;
    const wallStart = walls;
    for (const polygon of polygons) {
      const outer = polygon[0]!;
      // MapLibre places one polygon at the mean of its non-duplicated outer vertices.
      const points = outer.slice(0, -1),
        center = points.reduce(
          (a, p) => [
            a[0]! + p[0]! / points.length,
            a[1]! + p[1]! / points.length,
          ],
          [0, 0],
        ) as [number, number];
      const ground = elevation(center);
      const meterRatio =
        Math.cos((FACADE_ORIGIN[1] * Math.PI) / 180) /
        Math.cos((center[1] * Math.PI) / 180);
      const contours = polygon.map((ring) =>
        ring.slice(0, -1).map((p) => facadeLocalPoint(p as [number, number])),
      );
      if (contours[0]!.length >= 3) {
        const offset = roofPositions.length / 3;
        const flat = contours.flat();
        for (const point of flat)
          roofPositions.push(point.x, (height + ground) * meterRatio, point.y);
        for (const triangle of THREE.ShapeUtils.triangulateShape(
          contours[0]!,
          contours.slice(1),
        ))
          roofIndices.push(
            offset + triangle[2]!,
            offset + triangle[1]!,
            offset + triangle[0]!,
          );
        roofParts.push(
          ...planRoofDetails({
            contours,
            top: (height + ground) * meterRatio,
            scale: meterRatio,
          }),
        );
      }
      for (const ring of polygon) {
        for (let i = 1; i < ring.length; i++) {
          const a = mercator(ring[i - 1]!),
            b = mercator(ring[i]!);
          const ax = (a[0]! - origin[0]!) / FACADE_MERCATOR_SCALE,
            az = (a[1]! - origin[1]!) / FACADE_MERCATOR_SCALE;
          const bx = (b[0]! - origin[0]!) / FACADE_MERCATOR_SCALE,
            bz = (b[1]! - origin[1]!) / FACADE_MERCATOR_SCALE;
          const length = Math.hypot(bx - ax, bz - az) / meterRatio;
          if (length < 0.1) continue;
          const bottom = (base + ground) * meterRatio,
            top = (height + ground) * meterRatio;
          // Fit complete bays to each source wall; never clip a bay at a corner.
          const bay = length / Math.max(1, Math.round(length / finish.bay));
          const quad = (vertices: FacadeQuad, solid: boolean) => {
            const offset = positions.length / 3;
            for (const p of vertices) {
              positions.push(p.x, p.y, p.z);
              uvs.push(p.u, p.v);
              solidFaces.push(solid ? 1 : 0);
              specifications.push(
                bay,
                finish.floor,
                finish.family,
                finish.tint,
              );
            }
            indices.push(
              offset,
              offset + 2,
              offset + 1,
              offset + 1,
              offset + 2,
              offset + 3,
            );
          };
          const panels = appendFacadeRelief({
            a: new THREE.Vector2(ax, az),
            b: new THREE.Vector2(bx, bz),
            contours,
            base,
            height,
            ground,
            scale: meterRatio,
            bay,
            floor: finish.floor,
            family: finish.family,
            quad,
          });
          recessedPanels += panels;
          if (!panels)
            quad(
              [
                { x: ax, y: bottom, z: az, u: 0, v: base },
                { x: bx, y: bottom, z: bz, u: length, v: base },
                { x: ax, y: top, z: az, u: 0, v: height },
                { x: bx, y: top, z: bz, u: length, v: height },
              ],
              false,
            );
          walls++;
        }
      }
    }
    if (walls > wallStart) representedIds.add(feature.id);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute(
    "facadeSolid",
    new THREE.Float32BufferAttribute(solidFaces, 1),
  );
  geometry.setAttribute(
    "facadeSpec",
    new THREE.Float32BufferAttribute(specifications, 4),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = createFacadeMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "osm-highrise-walls";
  mesh.userData.representation =
    "source-footprints-illustrative-class-finishes";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const roofGeometry = new THREE.BufferGeometry();
  roofGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(roofPositions, 3),
  );
  roofGeometry.setIndex(roofIndices);
  roofGeometry.computeVertexNormals();
  roofGeometry.computeBoundingSphere();
  const roofMaterial = new THREE.MeshLambertMaterial({
    color: "#e5eaf0",
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const roof = new THREE.Mesh(roofGeometry, roofMaterial);
  roof.name = "osm-highrise-roofs";
  roof.castShadow = true;
  roof.receiveShadow = true;
  scene.add(roof);
  const fittings = createRoofDetails(roofParts);
  scene.add(fittings.group);
  geometry.computeBoundingBox();
  const receiver = walls
    ? shadowGround(geometry.boundingBox!, elevation)
    : undefined;
  if (receiver) scene.add(receiver);
  // One geographic sun owns facade illumination and native shadow projection.
  const sun = new THREE.DirectionalLight(0xfff9ed, 1.45);
  sun.name = "sun";
  sun.position.fromArray(MAP_SUN).multiplyScalar(1000);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.000015;
  sun.shadow.normalBias = 0.35;
  Object.assign(sun.shadow.camera, {
    left: -2000,
    right: 2000,
    top: 2000,
    bottom: -2000,
    near: 1,
    far: 20000,
  });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);
  const sky = new THREE.HemisphereLight(0xe7f2fc, 0xd0d4ca, 0.8);
  sky.name = "sky";
  scene.add(sky);
  scene.userData.wallCount = walls;
  scene.userData.recessedPanels = recessedPanels;
  scene.userData.buildingCount = representedIds.size;
  scene.userData.roofPartCount = roofParts.length;
  let shadowFocus: THREE.Vector2 | undefined,
    shadowExtent = 0;
  return {
    scene,
    geometry,
    material,
    walls,
    representedIds,
    fitShadow(coordinate: [number, number], extent: number) {
      const next = facadeLocalPoint(coordinate);
      if (
        shadowFocus &&
        next.distanceTo(shadowFocus) < shadowExtent * 0.06 &&
        Math.abs(extent - shadowExtent) < shadowExtent * 0.04
      )
        return false;
      // Moving the fitted shadow volume preserves the authored sun direction.
      const direction = sun.position
        .clone()
        .sub(sun.target.position)
        .normalize();
      shadowFocus = next;
      shadowExtent = extent;
      sun.target.position.set(next.x, 0, next.y);
      sun.position.copy(sun.target.position).addScaledVector(direction, 6500);
      Object.assign(sun.shadow.camera, {
        left: -extent,
        right: extent,
        top: extent,
        bottom: -extent,
      });
      // PCFSoft compares neighbouring shadow texels, not a single exact point.
      // The old constant 0.3m depth offset produced a striped self-shadow on
      // broad flat roofs as the fitted map covered more metres per texel.
      // Express the comparison offset in fitted shadow texels, then normalize
      // it by the shadow camera's depth range. This changes only the shadow
      // test: geographic geometry, illumination and ground contact are retained.
      const metresPerTexel = (extent * 2) / sun.shadow.mapSize.x;
      sun.shadow.bias =
        -(1.25 * metresPerTexel) /
        (sun.shadow.camera.far - sun.shadow.camera.near);
      sun.shadow.camera.updateProjectionMatrix();
      return true;
    },
    updateShadowVisibility() {
      if (receiver)
        receiver.material.opacity =
          0.26 * THREE.MathUtils.clamp(sun.intensity / 1.45, 0, 1);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      roofGeometry.dispose();
      roofMaterial.dispose();
      fittings.dispose();
      receiver?.geometry.dispose();
      receiver?.material.dispose();
      sun.shadow.dispose();
      scene.clear();
    },
  };
}
