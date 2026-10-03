// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from 'three';

/** One local light probe for the glazed office, in the same metre coordinates
 * as its shell. This is authored window/bounce radiance, not a surveyed HDRI,
 * ray-traced GI or a second visible room. The real sun still owns cast shadows. */
export const OFFICE_PROBE_POSITION = [0, 1.6, 0] as const;

export class OfficeWindowEnvironment extends THREE.Scene {
  private disposed = false;

  constructor() {
    super();
    this.name = 'office-window-environment';
    this.userData.representation = 'authored-single-window-light-probe';
    const surface = (rgb:[number,number,number]) => new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(...rgb), side: THREE.DoubleSide, toneMapped: false,
    });
    const plane = (name:string, width:number, height:number, at:[number,number,number], rotation:[number,number,number], material:THREE.MeshBasicMaterial) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width,height),material);
      mesh.name=name;mesh.position.set(...at);mesh.rotation.set(...rotation);this.add(mesh);return mesh;
    };
    // A closed probe shell supplies restrained bounce in directions without a
    // window. Unlike the presentation cutaway, it has a ceiling: removing the
    // visible roof must not turn every chrome/upward face into an outdoor sky.
    const wall=surface([.20,.225,.25]),floor=surface([.15,.16,.17]),ceiling=surface([.32,.34,.36]);
    plane('probe-floor',23.4,16.2,[0,-.015,.2],[-Math.PI/2,0,0],floor);
    plane('probe-ceiling',23.4,16.2,[0,4.7,.2],[Math.PI/2,0,0],ceiling);
    plane('probe-rear-wall',23.4,4.7,[0,2.35,-7.46],[0,0,0],wall);
    plane('probe-front-wall',23.4,4.7,[0,2.35,8.29],[0,Math.PI,0],wall);
    for(const side of [-1,1])plane('probe-side-wall',16.2,4.7,[side*11.69,2.35,.2],[0,-side*Math.PI/2,0],wall);

    // Linear HDR gradient: cooler sky above, quieter city near the sill.
    // One shared texture and four radiance gains; no per-frame allocations.
    const data=new Uint8Array(4*32);
    for(let y=0;y<32;y++){
      const t=y/31, luminance=.45+.55*t;
      data.set([luminance*.88,luminance*.95,luminance].map(value=>Math.round(value*255)).concat(255),y*4);
    }
    const gradient=new THREE.DataTexture(data,1,32,THREE.RGBAFormat);
    gradient.name='authored-office-window-radiance';gradient.magFilter=gradient.minFilter=THREE.LinearFilter;gradient.needsUpdate=true;
    const window=(gain:number)=>{
      const material=surface([gain,gain,gain]);material.map=gradient;return material;
    };
    const rear=window(3.2),east=window(5.4),west=window(2.8),front=window(1.8);
    // Openings align with the actual facade: opaque lower sills, mullions and
    // transoms survive in the specular environment instead of generic softboxes.
    for(let bay=0;bay<10;bay++)for(const [y,height] of [[1.97,1.85],[3.745,1.58]])
      plane('probe-rear-window',2.22,height!,[-10.35+bay*2.3,y!,-7.44],[0,0,0],rear);
    for(const side of [-1,1])for(const bay of [-5,-.2,4.6])for(const dz of [-1.175,1.175])
      for(const [y,height] of [[1.96,1.85],[3.745,1.49]])
        plane('probe-side-window',2.275,height!,[side*11.59,y!,bay+dz],[0,-side*Math.PI/2,0],side>0?east:west);
    for(let bay=0;bay<8;bay++)plane('probe-front-window',2.8,2.62,[-10.15+bay*2.9,1.39,8.13],[0,Math.PI,0],front);
  }

  dispose() {
    if(this.disposed)return;this.disposed=true;
    const resources=new Set<{dispose:()=>void}>();
    this.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      resources.add(object.geometry);
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        resources.add(material);
        if(material instanceof THREE.MeshBasicMaterial&&material.map)resources.add(material.map);
      }
    });
    resources.forEach(resource=>resource.dispose());
  }
}
