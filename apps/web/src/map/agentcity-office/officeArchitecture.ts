// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { officeGlass } from './officeGlazing';

// The roof is intentionally removed for the six-room view. These are authored
// architectural members, not a structural engineering model or surveyed steelwork.
export const OFFICE_FRAME = {
  beamHeight: 0.24,
  beamDepth: 0.30,
  beamCenterY: 4.65,
  columnRadius: 0.20,
  columnTop: 4.53,
} as const;

// The reception/sofa strip is INSIDE the office. The previous front at z=6.6
// cut it off from the workrooms and crossed their desks in the overview.
export const OFFICE_ENTRANCE = { frontZ: 8.14, sideX: 11.6, returnStartZ: 6.925, height: 2.8, doorHalfWidth: 1.8 } as const;

/** Low foreground curtain wall for the roof-cutaway view. The taller rear and
 * side shell is unchanged; short glazed returns enclose the entire foyer. */
export function officeEntranceFacade() {
  const root = new THREE.Group(); root.name = 'office-entrance-facade';
  root.position.z = OFFICE_ENTRANCE.frontZ;
  const trim = finish('#71818e', .3, .55), glass = officeGlass();
  const box = (size:[number,number,number], at:[number,number,number], material:THREE.Material, name:string) => {
    const part = member(root, new RoundedBoxGeometry(...size, 2, Math.min(.004, ...size.map(n=>n/4))), material, at, name);
    if(material.transparent) part.castShadow = false;
    return part;
  };
  const {sideX,doorHalfWidth,height,returnStartZ,frontZ} = OFFICE_ENTRANCE;
  // Fixed bays meet the door jamb rather than overlapping the moving leaves.
  const bayWidth = (sideX-doorHalfWidth)/3;
  for(const side of [-1,1]) {
    for(let bay=0;bay<3;bay++) {
      const x = side*(doorHalfWidth+(bay+.5)*bayWidth);
      box([bayWidth-.07,2.65,.025],[x,1.35,0],glass,'office-front-fixed-glass');
      box([.055,height,.07],[side*(doorHalfWidth+(bay+1)*bayWidth),height/2,0],trim,'office-front-mullion');
    }
    box([sideX-doorHalfWidth,.055,.075],[side*(sideX+doorHalfWidth)/2,height,0],trim,'office-front-head');
    box([sideX-doorHalfWidth,.045,.07],[side*(sideX+doorHalfWidth)/2,.025,0],trim,'office-front-sill');
    box([1.73,2.65,.025],[side*.9,1.35,0],glass,'office-entry-door-glass');
    box([.055,height,.07],[side*doorHalfWidth,height/2,0],trim,'office-entry-jamb');
    box([1.8,.055,.075],[side*.9,height,0],trim,'office-entry-head');
    member(root,new THREE.CylinderGeometry(.022,.022,.44,24),trim,[side*.17,1.12,.12],'office-entry-pull');
    for(const y of [.94,1.3])box([.026,.026,.12],[side*.17,y,.07],trim,'office-entry-pull-mount');
    const length=frontZ-returnStartZ, z=-length/2;
    box([.035,2.65,length],[side*sideX,1.35,z],glass,'office-foyer-side-glass');
    for(const y of [.025,height])box([.09,.055,length],[side*sideX,y,z],trim,'office-foyer-return-rail');
  }
  box([.055,height,.07],[0,height/2,0],trim,'office-entry-meeting-stile');
  return root;
}

function finish(color: string, roughness: number, metalness: number) {
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  material.name = "office-satin-aluminium";
  material.userData.officeImmutableFinish = true;
  return material;
}

function member(parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material,
  position: [number, number, number], name: string) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.officeStaticArchitecture = true;
  // These names document construction only; no animation or task handler owns
  // their transforms. Explicit opt-in keeps other named interactive parts out.
  mesh.userData.officeBatchablePart = true;
  parent.add(mesh);
  return mesh;
}

/** Box-section beam, with a recessed underside and fitted end plates. Local X
 * is the span. All detailing stays in the section envelope, so corner joints
 * and camera fit do not depend on an unmeasured decorative border. */
export function officePerimeterBeam(length: number) {
  if (!Number.isFinite(length) || length < 0.5) throw new RangeError("Invalid beam span");
  const beam = new THREE.Group();
  beam.name = "office-perimeter-member";
  beam.userData.representation = "authored-aluminium-box-section";
  const metal = finish("#a8b6c2", 0.32, 0.78);
  const edge = finish("#c4ced7", 0.26, 0.72);
  const recess = finish("#596b7a", 0.48, 0.55);
  const h = OFFICE_FRAME.beamHeight, d = OFFICE_FRAME.beamDepth;
  // Separate upper/side extrusions expose their section at oblique close range.
  // The recessed soffit is solid; this is not a paper-thin open roof strip.
  member(beam, new RoundedBoxGeometry(length, 0.028, d, 2, 0.005), edge,
    [0, h / 2 - 0.014, 0], "office-beam-cap");
  for (const side of [-1, 1]) {
    member(beam, new RoundedBoxGeometry(length, h - 0.028, 0.026, 2, 0.004), metal,
      [0, -0.014, side * (d / 2 - 0.013)], "office-beam-face");
    member(beam, new THREE.BoxGeometry(length - 0.016, 0.012, 0.030), edge,
      [0, -h / 2 + 0.006, side * (d / 2 - 0.015)], "office-beam-lower-lip");
  }
  member(beam, new THREE.BoxGeometry(length - 0.016, 0.016, d - 0.052), recess,
    [0, -h / 2 + 0.024, 0], "office-beam-recessed-soffit");
  for (const side of [-1, 1]) {
    member(beam, new RoundedBoxGeometry(0.008, h - 0.012, d - 0.012, 2, 0.002), metal,
      [side * (length / 2 - 0.004), 0, 0], "office-beam-end-plate");
  }
  return beam;
}

/** Slim satin-metal cladding, seated on a floor plate and meeting the beam's
 * underside exactly. The narrow seam explains the split wrap without noise. */
export function officeStructuralColumn() {
  const column = new THREE.Group();
  column.name = "office-structural-column";
  column.userData.representation = "authored-metal-clad-column";
  const metal = finish("#b3c0ca", 0.34, 0.72);
  const plate = finish("#7e909e", 0.28, 0.8);
  const seam = finish("#607480", 0.58, 0.3);
  member(column, new THREE.CylinderGeometry(0.285, 0.29, 0.05, 48), plate,
    [0, 0.025, 0], "office-column-floor-plate");
  member(column, new THREE.CylinderGeometry(0.22, 0.22, 0.075, 48), plate,
    [0, 0.0875, 0], "office-column-foot-collar");
  const bottom = 0.10, top = OFFICE_FRAME.columnTop;
  member(column, new THREE.CylinderGeometry(OFFICE_FRAME.columnRadius, OFFICE_FRAME.columnRadius, top - bottom, 64), metal,
    [0, (bottom + top) / 2, 0], "office-column-shaft");
  member(column, new THREE.CylinderGeometry(0.221, 0.221, 0.06, 48), plate,
    [0, top - 0.03, 0], "office-column-head-collar");
  member(column, new THREE.BoxGeometry(0.007, top - bottom - 0.08, 0.004), seam,
    [0, (top + bottom) / 2, OFFICE_FRAME.columnRadius - 0.001], "office-column-cladding-seam");
  return column;
}
