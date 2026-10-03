// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { officeFabric } from "./officeSurfaces";
import { officeClothUvSeams } from './officeClothUv';

export interface CushionShape {
  width: number;
  depth: number;
  height: number;
  corner: number;
  crown?: number;
}

// A sewn cushion has a broad plan-view corner, a rolled perimeter and a soft
// crown. These are independent dimensions: rounding a thin box limits every
// corner to its thickness and leaves the visible seat looking like a slab.
const CORNER_STEPS = 8;
const EDGE_STEPS = 8;
const PERIMETER = 4 * (CORNER_STEPS + EDGE_STEPS);

function dimensions(shape: CushionShape) {
  const { width, depth, height, corner } = shape;
  const crown = shape.crown ?? height * 0.14;
  if (
    ![width, depth, height, corner].every((v) => Number.isFinite(v) && v > 0) ||
    !Number.isFinite(crown) ||
    crown < 0 ||
    crown >= height / 2
  )
    throw new RangeError("Invalid cushion dimensions");
  const radius = Math.min(corner, width / 2 - 0.001, depth / 2 - 0.001);
  if (radius <= 0) throw new RangeError("Cushion is too small");
  return {
    width,
    depth,
    height,
    crown,
    radius,
    roll: Math.min(height * 0.48, radius * 0.72),
  };
}

/** Counter-clockwise rounded rectangle in the XZ plane, including intermediate
 * points on the long sides so the crown is curved across a whole bench seat. */
function outline(width: number, depth: number, radius: number) {
  const points: THREE.Vector2[] = [];
  const centres = [
    [width / 2 - radius, depth / 2 - radius],
    [-width / 2 + radius, depth / 2 - radius],
    [-width / 2 + radius, -depth / 2 + radius],
    [width / 2 - radius, -depth / 2 + radius],
  ];
  for (let quarter = 0; quarter < 4; quarter++) {
    const [cx, cz] = centres[quarter]!;
    const start = (quarter * Math.PI) / 2;
    for (let i = 0; i < CORNER_STEPS; i++) {
      const angle = start + ((i / CORNER_STEPS) * Math.PI) / 2;
      points.push(
        new THREE.Vector2(
          cx! + radius * Math.cos(angle),
          cz! + radius * Math.sin(angle),
        ),
      );
    }
    const angle = start + Math.PI / 2;
    const edgeStart = new THREE.Vector2(
      cx! + radius * Math.cos(angle),
      cz! + radius * Math.sin(angle),
    );
    const [nx, nz] = centres[(quarter + 1) % 4]!;
    const edgeEnd = new THREE.Vector2(
      nx! + radius * Math.cos(angle),
      nz! + radius * Math.sin(angle),
    );
    for (let i = 0; i < EDGE_STEPS; i++)
      points.push(edgeStart.clone().lerp(edgeEnd, i / EDGE_STEPS));
  }
  return points;
}

function crownElevation(
  d: ReturnType<typeof dimensions>,
  x: number,
  z: number,
) {
  const along = Math.max(0, 1 - (x / (d.width / 2 - d.roll)) ** 2);
  const across = Math.max(0, 1 - (z / (d.depth / 2 - d.roll)) ** 2);
  return d.crown * (along * across) ** 2;
}

export function officeCushionGeometry(shape: CushionShape) {
  const d = dimensions(shape);
  const positions: number[] = [],
    indices: number[] = [],
    uvs: number[] = [];
  const add = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    // Metre-scale planar grain: an arm and a wide cushion have the same weave
    // density. Normalizing every panel to 0..1 stretches one shared fabric.
    uvs.push(x + d.width / 2, z + d.depth / 2);
  };
  add(0, -d.height / 2, 0);
  // Flat underside physically rests on the frame. The upper cap is crowned.
  const rollSteps = 16,
    capSteps = 8;
  for (let step = 0; step <= rollSteps + capSteps - 1; step++) {
    let scale = 1,
      inset: number,
      y: number,
      crownWeight = 1;
    if (step <= rollSteps) {
      const angle = -Math.PI / 2 + (step / rollSteps) * Math.PI;
      inset = d.roll * (1 - Math.cos(angle));
      y = -d.crown / 2 + ((d.height - d.crown) / 2) * Math.sin(angle);
      crownWeight = Math.max(0, Math.sin(angle)) ** 4;
    } else {
      scale = 1 - (step - rollSteps) / capSteps;
      inset = d.roll;
      y = d.height / 2 - d.crown;
    }
    for (const point of outline(
      d.width - 2 * inset,
      d.depth - 2 * inset,
      d.radius - inset,
    )) {
      const x = point.x * scale,
        z = point.y * scale;
      // A smooth function of cloth coordinates, not ring index: ring-based
      // height leaves four artificial diagonal ridges on a long bench seat.
      add(x, y + crownWeight * crownElevation(d, x, z), z);
    }
  }
  const rings = rollSteps + capSteps;
  const top = positions.length / 3;
  add(0, d.height / 2, 0);
  for (let i = 0; i < PERIMETER; i++) {
    const next = (i + 1) % PERIMETER;
    // XZ outline winds toward -Y; reverse it on the top and on the skirt.
    indices.push(0, 1 + i, 1 + next);
    for (let ring = 0; ring < rings - 1; ring++) {
      const a = 1 + ring * PERIMETER + i,
        b = 1 + ring * PERIMETER + next;
      indices.push(a, a + PERIMETER, b, b, a + PERIMETER, b + PERIMETER);
    }
    const last = 1 + (rings - 1) * PERIMETER;
    indices.push(last + i, top, last + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Sewn side band gets its own perimeter/roll coordinates; the broad upper
 * and lower panels keep their metric planar grain. Positions and smooth
 * normals stay identical to the original supported cushion shell. */
export function officeCushionClothGeometry(shape:CushionShape) {
  const geometry=officeCushionGeometry(shape),p=geometry.getAttribute('position');
  const rollSteps=16,perimeter:number[][]=[],roll:number[][]=[];
  const point=(ring:number,index:number)=>new THREE.Vector3().fromBufferAttribute(p,1+ring*PERIMETER+index);
  for(let ring=0;ring<=rollSteps;ring++){
    perimeter[ring]=[0];roll[ring]=[];
    for(let i=0;i<PERIMETER;i++){
      perimeter[ring]!.push(perimeter[ring]![i]!+point(ring,i).distanceTo(point(ring,(i+1)%PERIMETER)));
      roll[ring]![i]=ring===0?0:roll[ring-1]![i]!+point(ring,i).distanceTo(point(ring-1,i));
    }
  }
  return officeClothUvSeams(geometry,ids=>{
    const rings=ids.map(id=>Math.floor((id-1)/PERIMETER));
    if(ids.includes(0)||Math.max(...rings)>rollSteps||Math.min(...rings)>=rollSteps)return;
    const corners=ids.map(id=>(id-1)%PERIMETER),wrapped=corners.includes(0)&&corners.includes(PERIMETER-1);
    return ids.map((_id,i)=>[perimeter[rings[i]!]![wrapped&&corners[i]===0?PERIMETER:corners[i]!]!,roll[rings[i]!]![corners[i]!]!]);
  });
}

/** Welting follows the same rolled surface, not a floating rectangular line. */
function cushionWeltGeometry(shape: CushionShape) {
  const d = dimensions(shape),
    angle = Math.PI * 0.3;
  const inset = d.roll * (1 - Math.cos(angle));
  const y = -d.crown / 2 + ((d.height - d.crown) / 2) * Math.sin(angle);
  const points = outline(
    d.width - 2 * inset,
    d.depth - 2 * inset,
    d.radius - inset,
  ).map(
    (p) =>
      new THREE.Vector3(
        p.x,
        y + Math.sin(angle) ** 4 * crownElevation(d, p.x, p.y),
        p.y,
      ),
  );
  const curve = new THREE.CatmullRomCurve3(points, true, "centripetal");
  return new THREE.TubeGeometry(curve, PERIMETER, 0.0028, 4, true);
}

export function officeCushion(
  parent: THREE.Object3D,
  shape: CushionShape,
  position: [number, number, number],
  material: THREE.Material,
  name: string,
  weltMaterial?: THREE.Material,
) {
  const mesh = new THREE.Mesh(officeCushionClothGeometry(shape), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.officeStaticArchitecture = true;
  parent.add(mesh);
  if (weltMaterial) {
    const welt = new THREE.Mesh(cushionWeltGeometry(shape), weltMaterial);
    welt.name = "upholstery-welt";
    // Millimetre-scale thread should not create dotted self-shadow acne in a
    // room-scale shadow map. Its actual raised geometry still receives light.
    welt.castShadow = false;
    welt.receiveShadow = true;
    mesh.add(welt);
  }
  return mesh;
}

/** One shared furniture family: continuous bench cushions, supported angled
 * backs and slim feet. Only the width differs between the sofas and guest chair. */
export function officeLoungeSeat(width: number) {
  if (!Number.isFinite(width) || width < 1.05)
    throw new RangeError("Invalid lounge seat width");
  const group = new THREE.Group();
  group.name = width > 2 ? "office-lounge-sofa" : "office-lounge-chair";
  const blue = officeFabric("#a8c4da", [10, 10], 0.86);
  blue.userData.officeUpholstery = true;
  const welt = new THREE.MeshStandardMaterial({
    color: "#9ab7cd",
    roughness: 0.92,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: "#657986",
    roughness: 0.38,
    metalness: 0.5,
  });
  officeCushion(
    group,
    {
      width: width - 0.025,
      depth: 0.94,
      height: 0.22,
      corner: 0.16,
      crown: 0.005,
    },
    [0, 0.37, 0],
    blue,
    "lounge-upholstered-frame",
  );
  const frameBack = officeCushion(
    group,
    {
      width: width - 0.03,
      depth: 0.68,
      height: 0.23,
      corner: 0.14,
      crown: 0.008,
    },
    [0, 0.795, -0.37],
    blue,
    "lounge-back-support",
  );
  frameBack.rotation.x = Math.PI / 2 - 0.1;
  officeCushion(
    group,
    {
      width: width - 0.38,
      depth: 0.77,
      height: 0.2,
      corner: 0.15,
      crown: 0.028,
    },
    [0, 0.55, 0.105],
    blue,
    "lounge-seat-cushion",
    welt,
  );
  const back = officeCushion(
    group,
    {
      width: width - 0.38,
      depth: 0.55,
      height: 0.2,
      corner: 0.13,
      crown: 0.025,
    },
    [0, 0.845, -0.235],
    blue,
    "lounge-back-cushion",
    welt,
  );
  back.rotation.x = Math.PI / 2 - 0.14;
  for (const side of [-1, 1]) {
    officeCushion(
      group,
      { width: 0.23, depth: 0.94, height: 0.49, corner: 0.105, crown: 0.03 },
      [side * (width / 2 - 0.115), 0.62, 0],
      blue,
      "lounge-arm",
    );
    for (const z of [-0.32, 0.32]) {
      const foot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.019, 0.27, 12),
        metal,
      );
      foot.name = "lounge-foot";
      foot.position.set(side * (width / 2 - 0.2), 0.135, z);
      foot.castShadow = foot.receiveShadow = true;
      group.add(foot);
    }
  }
  return group;
}
