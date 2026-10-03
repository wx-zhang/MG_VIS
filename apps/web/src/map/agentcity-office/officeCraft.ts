// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {OFFICE_BENCH_WIDTH,OFFICE_BENCH_CHAIR_X,OFFICE_PRIVATE_DESK} from './officeLayout';
import { officeCollaborationPlanter } from './officeCollaborationPlanter';
import { createOfficeOutlook } from './officeOutlook';
import {officeFabric,officeRug,officeWorktopGeometry} from './officeSurfaces';
import { OFFICE_FLOOR } from './officeFloorFinish';
import { officeCushion, officeLoungeSeat } from './officeUpholstery';
import { officeClothEdgeUv, officeClothBoxUv } from './officeClothUv';
import { officeGlass } from './officeGlazing';
import { officeMonitor } from './officeMonitor';
import { officeDeskLamp, officeMug } from './officeDeskAccessories';
import { OFFICE_FRAME, officePerimeterBeam, officeStructuralColumn, officeEntranceFacade } from './officeArchitecture';
export { officeGlass } from './officeGlazing';

// Authored architectural furniture and surface details, not a flat reference image.
const mat = (color: string, roughness = 0.55, metalness = 0.04) => {
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  // This helper only authors fixed finishes. Task screens, clothing and glass
  // own mutable state elsewhere and are not eligible for appearance batching.
  material.userData.officeImmutableFinish = true;
  return material;
};
function part(
  parent: THREE.Object3D,
  size: number[],
  position: number[],
  material: THREE.Material,
  radius = 0.035,
) {
  const m = new THREE.Mesh(
    radius
      ? new RoundedBoxGeometry(
          size[0],
          size[1],
          size[2],
          2,
          Math.min(radius, Math.min(...size) / 3),
        )
      : new THREE.BoxGeometry(...(size as [number, number, number])),
    material,
  );
  m.position.set(...(position as [number, number, number]));
  m.userData.officeStaticArchitecture = true;
  m.castShadow = !material.transparent;
  m.receiveShadow = !material.transparent;
  parent.add(m);
  return m;
}
function cylinder(
  parent: THREE.Object3D,
  top: number,
  bottom: number,
  height: number,
  position: number[],
  material: THREE.Material,
  radialSegments = 20,
) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(top, bottom, height, radialSegments),
    material,
  );
  m.position.set(...(position as [number, number, number]));
  m.userData.officeStaticArchitecture = true;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
export function createOfficeFloor() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#aebbc3";
  c.fillRect(0, 0, 1024, 1024);
  for (let row = 0; row < 16; row++) {
    const y = row * 64;
    const grey = 177 + ((row * 13) % 17);
    c.fillStyle = `rgb(${grey + 9},${grey + 10},${grey + 10})`;
    c.fillRect(0, y + 1, 1024, 62);
    for (let j = 0; j < 18; j++) {
      const offset = (j * 31 + row * 3) % 58;
      c.strokeStyle = `rgba(112,126,134,${0.015 + (j % 4) * 0.009})`;
      c.lineWidth = 0.7;
      c.beginPath();
      c.moveTo(0, y + offset);
      c.bezierCurveTo(
        280,
        y + offset + 4,
        580,
        y + offset - 3,
        1024,
        y + offset + 1,
      );
      c.stroke();
    }
    c.fillStyle = "#aebbc3";
    for (let x = (row % 3) * 128; x < 1024; x += 384) c.fillRect(x, y, 1, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return new THREE.MeshPhysicalMaterial({
    map: texture,
    bumpMap: texture,
    bumpScale: 0.007,
    color: "#fff",
    roughness: 0.55,
    metalness: 0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.5,
  });
}
export function architecturalPlant(
  parent: THREE.Object3D,
  x: number,
  z: number,
  scale = 1,
) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  parent.add(group);
  // Floor specimens are dense, individually shaped leaves; smaller desktop
  // planters retain the scanned asset. Neither is a camera-facing image sprite.
  group.userData.officePlant = scale < 0.7 ? "procedural" : "authored";
  if (scale >= 1.15) group.userData.officePlantVariant = "tree";
  const profile = [
    new THREE.Vector2(0.18, 0),
    new THREE.Vector2(0.24, 0.035),
    new THREE.Vector2(0.29, 0.47),
    new THREE.Vector2(0.285, 0.52),
    new THREE.Vector2(0.25, 0.52),
    new THREE.Vector2(0.25, 0.46),
  ];
  const pot = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 24),
    mat("#e3e7e9", 0.45),
  );
  pot.castShadow = true;
  pot.receiveShadow = true;
  group.add(pot);
  cylinder(group, 0.25, 0.25, 0.015, [0, 0.475, 0], mat("#514a40", 1));
  const stemMat = mat("#697650", 0.9),
    leafMats = ["#496340", "#61794b", "#748550"].map((color) => {
      const leaf = mat(color, 0.65);
      leaf.side = THREE.DoubleSide;
      return leaf;
    });
  for (let i = 0; i < 30; i++) {
    const angle = i * 2.39996,
      tier = Math.floor(i / 6),
      length = 0.65 - tier * 0.045 + (i % 3) * 0.065,
      height = 0.78 + tier * 0.22;
    const start = new THREE.Vector3(0, 0.5, 0),
      end = new THREE.Vector3(
        Math.cos(angle) * (0.26 - tier * 0.025),
        height,
        Math.sin(angle) * (0.26 - tier * 0.025),
      );
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.019, start.distanceTo(end), 5),
      stemMat,
    );
    stem.position.copy(start.clone().add(end).multiplyScalar(0.5));
    stem.userData.officeFoliage = true;
    stem.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      end.clone().sub(start).normalize(),
    );
    group.add(stem);
    const positions: number[] = [],
      indices: number[] = [];
    for (let j = 0; j <= 10; j++) {
      const t = j / 10,
        w = Math.pow(Math.sin(Math.PI * t), 0.75) * (0.12 + (i % 3) * 0.025);
      for (const side of [-1, 0, 1])
        positions.push(
          t * length,
          Math.sin(t * Math.PI) * 0.18 -
            t * t * 0.16 -
            (side === 0 ? 0 : 0.028),
          side * w,
        );
    }
    for (let j = 0; j < 10; j++)
      for (let k = 0; k < 2; k++) {
        const a = j * 3 + k;
        indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const leaf = new THREE.Mesh(geometry, leafMats[i % leafMats.length]);
    leaf.userData.officeFoliage = true;
    leaf.position.copy(end);
    leaf.rotation.y = -angle;
    leaf.rotation.z = 0.14 + tier * 0.14;
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    group.add(leaf);
  }
  return group;
}

/** Upholstery with a concave wrap, lumbar support and a closed edge. A slab
 * with rounded corners cannot produce this silhouette or the curved highlight. */
export function createChairBackGeometry(thickness=.055, clothUv=false) {
  if(!Number.isFinite(thickness)||thickness<=0||thickness>.1)throw new RangeError('Invalid chair back thickness');
  const positions: number[] = [],
    indices: number[] = [], uvs:number[]=[];
  const columns = 18,
    rows = 20,
    surface = (columns + 1) * (rows + 1);
  for (const back of [false, true])
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      for (let i = 0; i <= columns; i++) {
        const u = (i / columns) * 2 - 1;
        const width = 0.3 + 0.048 * Math.sin(Math.PI * v);
        positions.push(
          width * u,
          0.78 + v * 0.64 - 0.035 * Math.pow(Math.abs(u), 6),
          -0.36 +
            0.12 * u * u +
            0.075 * Math.sin(Math.PI * v) -
            0.085 * v -
            (back ? thickness : 0),
        );
        // Metre-scale cloth coordinates match the seat rather than stretching
        // one normalized texture over panels with different dimensions.
        uvs.push((u+1)*.348,v*.64);
      }
    }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      const a = j * (columns + 1) + i,
        b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
      indices.push(
        a + surface,
        b + surface,
        a + 1 + surface,
        a + 1 + surface,
        b + surface,
        b + 1 + surface,
      );
    }
  const edge: number[] = [];
  for (let i = 0; i < columns; i++) edge.push(i);
  for (let j = 0; j < rows; j++) edge.push(j * (columns + 1) + columns);
  for (let i = columns; i > 0; i--) edge.push(rows * (columns + 1) + i);
  for (let j = rows; j > 0; j--) edge.push(j * (columns + 1));
  for (let i = 0; i < edge.length; i++) {
    const a = edge[i]!,
      b = edge[(i + 1) % edge.length]!;
    indices.push(a, a + surface, b, b, a + surface, b + surface);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.computeVertexNormals();
  return clothUv?officeClothEdgeUv(geometry,edge,surface):geometry;
}
export function executiveChair(
  parent: THREE.Object3D,
  x: number,
  z: number,
  facing: number,
) {
  const chair = new THREE.Group();
  chair.name = "executive-chair";
  chair.position.set(x, 0, z);
  chair.rotation.y = facing;
  parent.add(chair);
  const blue = officeFabric("#9bbbd2"),
    chrome = mat("#9aaab6", 0.24, 0.75),
    black = mat("#34404b", 0.72);
  blue.userData.officeUpholstery = true;
  cylinder(chair, 0.06, 0.09, 0.345, [0, 0.2675, 0], chrome);
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5,
      leg = part(
        chair,
        [0.42, 0.045, 0.06],
        [Math.cos(a) * 0.2, 0.12, Math.sin(a) * 0.2],
        chrome,
        0.018,
      );
    leg.rotation.y = -a;
    for (const offset of [-0.047, 0.047]) {
      const wheel = cylinder(
        chair,
        0.068,
        0.068,
        0.035,
        [Math.cos(a) * 0.4 + offset, 0.07, Math.sin(a) * 0.4],
        black,
      );
      wheel.rotation.z = Math.PI / 2;
    }
  }
  const seam=mat('#92b1c8',.94);
  officeCushion(chair, { width: .72, height: .13, depth: .66, corner: .12, crown: .012 },
    [0, .495, .01], blue, 'contoured-chair-seat',seam);
  const back = new THREE.Mesh(createChairBackGeometry(.055,true), blue);
  back.name = "curved-upholstered-back";
  back.position.y = -.185;
  back.castShadow = back.receiveShadow = true;
  chair.add(back);
  for (const side of [-1, 1]) {
    part(
      chair,
      [0.035, 0.28, 0.035],
      [side * 0.39, 0.605, -0.05],
      chrome,
      0.005,
    );
    const armrest=part(chair, [0.085, 0.055, 0.4], [side * 0.39, 0.755, 0.03], blue, 0.02);
    armrest.name='chair-upholstered-armrest';armrest.userData.officeBatchablePart=true;officeClothBoxUv(armrest.geometry);
  }
  // An exposed back shell and lumbar seam read as an office chair at close range.
  const shell = new THREE.Mesh(createChairBackGeometry(.018), mat("#d3e0e9", 0.4));
  shell.name='chair-fitted-back-shell';
  // The shell starts at the upholstery's rear surface, not behind a gap and
  // not as a second thick cushion. The contact remains exact along the wrap.
  shell.position.z = -.055;
  shell.position.y = -.185;
  shell.castShadow = shell.receiveShadow = true;
  chair.add(shell);
  part(chair, [0.09, 0.36, 0.065], [0, 0.515, -0.35], chrome, 0.018);
}

export function collaborationBench(parent: THREE.Object3D, layout:'planted'|'conference'|'split'|'planning'='planted') {
  const group = new THREE.Group();
  group.name = "collaboration-bench";
  group.userData.institutionBench=layout;
  parent.add(group);
  const pale = mat("#eef3f6", 0.4),
    blue = mat("#a0bdcf", 0.6),
    metal = mat("#8c9ca8", 0.3, 0.65);
  const rug = officeRug(5.4,3.05,.62);
  rug.position.z=.12;
  rug.receiveShadow = true;
  group.add(rug);
  if(layout==='split'){
    for(const side of [-1,1])officeWorktop(group,(OFFICE_BENCH_WIDTH-.12)/2,2.6,[side*(OFFICE_BENCH_WIDTH+.12)/4,.745,0],.18).name='collaboration-split-worktop';
  }else{
    const worktop = officeWorktop(group,OFFICE_BENCH_WIDTH,2.6,[0,.745,0],layout==='conference'?.70:.32);
    worktop.name = "collaboration-worktop";
  }
  // Each split desk has four legs. Conference legs sit inside its larger
  // rounded corners; all supports leave the two fixed foot wells clear.
  const legX=layout==='split'?[-1.45,-.18,.18,1.45]:layout==='conference'?[-1.3,1.3]:[-1.45,1.45];
  const legZ=layout==='conference'?[-.95,.95]:[-1.1,1.1];
  for (const x of legX)
    for (const z of legZ)
      part(group, [0.075, 0.69, 0.075], [x, 0.345, z], metal, 0.015).name='collaboration-support';
  if(layout==='planted'||layout==='split'){
  part(group, [0.08, 0.35, 2.25], [0, 0.5, 0], blue, 0.01);
  group.add(officeCollaborationPlanter());
  }else if(layout==='planning'){
    // A flat shared planning surface, without the tall workstation divider.
    part(group,[.75,.016,1.98],[0,.808,0],pale,.01).name='travel-planning-surface';
    for(const z of [-.65,0,.65]){
      part(group,[.55,.008,.035],[0,.823,z],blue,.003);
      cylinder(group,.055,.055,.012,[z*.23,.833,z],metal,16);
    }
  }else{
    for(const z of [-.7,.55])part(group,[.39,.022,.30],[0,.811,z],blue,.008).name='conference-document';
  }
  // Two unoccupied seats complete the four-place bench; no invented Agents.
  for (const side of [-1, 1]) {
    executiveChair(group, side * OFFICE_BENCH_CHAIR_X, 0.65, (-side * Math.PI) / 2);
    if(layout==='planted'||layout==='split'){
      const {root:monitor} = officeMonitor(group,{x:side*.855,z:.64,heading:side*Math.PI/2});
      monitor.name = "unoccupied-monitor";
    }
    part(group, [0.18, 0.018, 0.48], [side * 1.265, 0.812, 0.64], pale, 0.005);
  }
  return group;
}
export function officeWorktop(parent:THREE.Object3D,width:number,depth:number,position:[number,number,number],corner=.12){
  const mesh=new THREE.Mesh(officeWorktopGeometry(width,depth,.11,corner),mat('#eef3f6',.4));
  mesh.position.set(...position);mesh.castShadow=mesh.receiveShadow=true;
  mesh.userData.officeStaticArchitecture=true;parent.add(mesh);return mesh;
}
export function deskDetails(parent: THREE.Object3D, z: number, row: number) {
  const white = mat("#eff2f4", 0.38),
    blue = mat("#9cb9cf", 0.54),
    metal = mat("#71808d", 0.24, 0.7);
  // Pedestal pair supports the broad worktop while leaving the seated knee bay
  // open. Recessed fronts and slim pulls read as joinery rather than blue cubes.
  for (const side of [-1, 1]) {
  const x=side*OFFICE_PRIVATE_DESK.pedestalX,width=OFFICE_PRIVATE_DESK.pedestalWidth;
  part(parent, [width, 0.63, 0.83], [x, 0.365, z], blue, 0.025).name='private-desk-pedestal';
  part(parent, [width-.05,.07,.73],[x,.055,z],metal,.008);
  for (let i = 0; i < 3; i++) {
    part(
      parent,
      [width-.05, 0.1733, 0.022],
      [x, 0.1717 + i * 0.1933, z - row * 0.425],
      blue,
      0.009,
    );
    part(
      parent,
      [0.13, 0.015, 0.025],
      [x, 0.2217 + i * 0.1933, z - row * 0.445],
      metal,
      0.003,
    );
  }
  }
  const lamp=officeDeskLamp();lamp.position.set(OFFICE_PRIVATE_DESK.lampX,.805,z-.24);parent.add(lamp);
  const mug=officeMug();mug.position.set(-.55,.805,z-.18);parent.add(mug);
  for (let n = 0; n < 4; n++) {
    const book = part(
      parent,
      [0.07, 0.22, 0.18],
      [0.53 + n * 0.08, .93, z + 0.13],
      n % 2 ? blue : white,
      0.004,
    );
    book.rotation.z = n === 3 ? 0.08 : 0;
  }
}
export function roomBackdrop(parent: THREE.Object3D, rearZ: number) {
  const wall=new THREE.Group();wall.name='office-private-backdrop';parent.add(wall);
  const panel=mat('#e3ebf0',.72), edge=mat('#aebdc7',.42,.25);
  // Solid lower panels belong to the room, with clear clerestory glazing above.
  // A small cavity separates them from the existing rear glass, no coplanar skin.
  part(wall,[6.24,1.96,.105],[0,1.02,rearZ+.09],panel,.016).name='office-private-panel';
  part(wall,[6.27,.035,.13],[0,2.017,rearZ+.09],edge,.008);
  part(wall,[6.24,.09,.12],[0,.075,rearZ+.1],edge,.005);
  for(const x of [-1.55,1.55])part(wall,[.012,1.89,.008],[x,1.03,rearZ+.147],edge,0);
  return wall;
}
export function roomStorage(parent: THREE.Object3D, row: number, width=3.3) {
  const cabinet = mat("#b4c8d7", 0.46),
    front = mat("#c6d8e6", 0.43),
    top = mat("#f5f7f8", 0.32),
    metal = mat("#708694", 0.28, 0.7);
  const z = row * 1.75;
  part(parent, [width, 0.64, 0.54], [0, 0.34, z], cabinet, 0.025);
  part(parent, [width+.06, 0.055, 0.6], [0, 0.69, z], top, 0.014);
  for (let i = 0; i < 4; i++) {
    const column=(width-.04)/4, x = (i-1.5)*column;
    part(parent, [column-.025, 0.55, 0.028], [x, 0.36, z - row * 0.28], front, 0.01);
    part(
      parent,
      [0.17, 0.012, 0.035],
      [x, 0.55, z - row * 0.305],
      metal,
      0.003,
    );
  }
  for (let i = 0; i < 5; i++)
    part(
      parent,
      [0.075, 0.26, 0.19],
      [-1.05 + i * 0.085, 0.85, z],
      i % 2 ? front : cabinet,
      0.003,
    );
  const plant = architecturalPlant(parent, width/2-.47, z, 0.38);
  plant.position.y = 0.72;
}
export function officeReadingNook(parent: THREE.Object3D) {
  const nook=new THREE.Group();nook.name='office-reading-nook';parent.add(nook);
  const chair=officeLoungeSeat(1.16);chair.position.set(10.35,0,.05);chair.rotation.y=-Math.PI/3;nook.add(chair);
  const metal=mat('#647d8d',.32,.65);
  const table=new THREE.Group();table.position.set(10.3,0,1.45);nook.add(table);
  cylinder(table,.37,.37,.045,[0,.605,0],mat('#e6edf2',.33),64);
  cylinder(table,.017,.02,.52,[0,.325,0],metal);
  for(let i=0;i<3;i++){
    const a=i*Math.PI*2/3;
    const leg=part(table,[.32,.025,.03],[Math.cos(a)*.145,.055,Math.sin(a)*.145],metal,.005);
    leg.rotation.y=-a;
    cylinder(table,.023,.023,.05,[Math.cos(a)*.29,.025,Math.sin(a)*.29],metal);
  }
  const magazine=part(table,[.25,.014,.19],[0,.637,.02],mat('#bdd1df',.85),.003);
  magazine.rotation.y=.25;
  return nook;
}
function sofa(parent: THREE.Object3D, x: number, z: number) {
  const group = officeLoungeSeat(2.5);
  group.position.set(x, 0, z);
  parent.add(group);
}
export function officeShell(scene: THREE.Scene, options:{standardFurnishing?:boolean;outlook?:boolean;entrance?:boolean}={}) {
  const trim = mat("#71818e", 0.3, 0.55),
    white = mat("#e3e9ed", 0.56),
    glass = officeGlass();
  part(scene, [23.5, 0.26, 16.3], [0, -0.15, 0.2], white, 0.035);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(OFFICE_FLOOR.width, OFFICE_FLOOR.depth),
    createOfficeFloor(),
  );
  floor.name = "office-floor";
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.01, OFFICE_FLOOR.centerZ);
  floor.receiveShadow = true;
  scene.add(floor);
  // A low insulated sill grounds the curtain wall; the six work pods remain
  // transparent. It also stops the distant street from visually merging with
  // the office floor, as happened with floor-to-floor transparent panes.
  part(scene,[23.1,1.0,.18],[0,.5,-7.45],white,.012);
  for (let x = -11.5; x <= 11.6; x += 2.3) {
    part(scene, [0.075, 4.6, 0.095], [x, 2.3, -7.45], trim, 0.008);
    if (x < 11.4)
      part(scene, [2.22, 4.45, 0.028], [x + 1.15, 2.3, -7.45], glass, 0);
  }
  for (const y of [0.12, 2.9, 4.57])
    part(scene, [23.1, 0.075, 0.09], [0, y, -7.45], trim, 0.008);
  const rearBeam=officePerimeterBeam(23.4);
  rearBeam.position.set(0,OFFICE_FRAME.beamCenterY,-7.45);scene.add(rearBeam);
  rearBeam.name='office-rear-perimeter-beam';
  for (const x of [-11.6, 11.6]) {
    // The enclosing curtain wall reaches the structural beam, not just the
    // height of the internal pods. A cutaway roof retains the architectural
    // shell without hiding the six rooms from the presentation camera.
    part(scene,[.28,.95,14.1],[x,.475,-.4],white,.018);
    const beam=officePerimeterBeam(14.2);
    beam.position.set(x,OFFICE_FRAME.beamCenterY,-.35);beam.rotation.y=Math.PI/2;scene.add(beam);
    beam.name='office-side-perimeter-beam';
    for (const z of [-7.2, -2.4, 2.4]) {
      const column=officeStructuralColumn();column.position.set(x,0,z);scene.add(column);
    }
    for (const z of [-5, -0.2, 4.6]) {
      part(scene, [0.035, 4.5, 4.65], [x, 2.3, z], glass, 0);
      for (const y of [1,2.95,4.5]) part(scene, [0.09, 0.06, 4.8], [x, y, z], trim, 0.004);
      for(const dz of [-2.35,0,2.35])part(scene,[.075,4.5,.075],[x,2.3,z+dz],trim,.004);
    }
  }
  if(options.entrance!==false)scene.add(officeEntranceFacade());
  // Rear acoustic timber/aluminium panel, one quiet architectural focal point.
  part(scene, [5.1, 2.9, 0.12], [0, 1.45, -6.48], mat("#93a9b8", 0.68), 0.02);
  for (let i = 0; i < 48; i++)
    part(
      scene,
      [0.034, 2.88, 0.06],
      [-2.45 + i * 0.104, 1.45, -6.4],
      mat("#b6c5ce", 0.62),
      0,
    );
  if(options.standardFurnishing!==false){
  sofa(scene, -7.3, 7.2);
  sofa(scene, 7.3, 7.2);
  for (const x of [-9.4, -5.1, 5.1, 9.4])
    architecturalPlant(scene, x, 7.1, 0.9);
  for (const x of [-10.65, 10.65])
    for (const z of [-6.6, -0.3, 5.8]) architecturalPlant(scene, x, x>0&&z===-.3?-1.4:z, 1.4);
  officeReadingNook(scene);
  }
  // Side joinery is owned by the two rear pods. The former facade-gap boxes
  // intersected their glass walls and could not be reached from either room.
  if(options.outlook!==false)scene.add(createOfficeOutlook());
}
