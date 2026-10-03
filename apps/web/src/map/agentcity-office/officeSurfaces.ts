// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from 'three';

/** Rounded perimeter independent of thickness: a thin worktop can have broad
 * plan-view corner radii without becoming a thick pill-shaped block. */
export function officeWorktopGeometry(width:number,depth:number,thickness:number,corner:number) {
  if(![width,depth,thickness,corner].every(v=>Number.isFinite(v)&&v>0))throw new RangeError('Invalid worktop dimensions');
  const bevel=Math.min(.008,thickness/5),w=width-2*bevel,d=depth-2*bevel;
  const r=Math.max(bevel,Math.min(corner-bevel,w/2,d/2)),x=-w/2,z=-d/2;
  const shape=new THREE.Shape();
  shape.moveTo(x+r,z);shape.lineTo(x+w-r,z);
  shape.quadraticCurveTo(x+w,z,x+w,z+r);shape.lineTo(x+w,z+d-r);
  shape.quadraticCurveTo(x+w,z+d,x+w-r,z+d);shape.lineTo(x+r,z+d);
  shape.quadraticCurveTo(x,z+d,x,z+d-r);shape.lineTo(x,z+r);
  shape.quadraticCurveTo(x,z,x+r,z);shape.closePath();
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:thickness-2*bevel,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:3,curveSegments:12});
  geometry.rotateX(-Math.PI/2);geometry.translate(0,-thickness/2+bevel,0);
  geometry.computeBoundingBox();
  return geometry;
}

/** Authored woven finish, not a photographed textile. The mipmapped weave is
 * deliberately sub-pixel in an overview and resolves only at inspection range. */
export function officeFabric(color:string, repeat:[number,number]=[16,16], roughness=.88) {
  const size=128,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const warp=Math.cos(((x%8)-3.5)/8*Math.PI),weft=Math.cos(((y%8)-3.5)/8*Math.PI);
    const over=(Math.floor(x/8)+Math.floor(y/8))%2===0;
    const value=Math.round(220+35*(over?warp:weft));
    const offset=(y*size+x)*4;
    data[offset]=data[offset+1]=data[offset+2]=value;data[offset+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  texture.name='authored-office-weave';
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.repeat.set(...repeat);texture.generateMipmaps=true;
  texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
  texture.anisotropy=8;texture.needsUpdate=true;
  const material=new THREE.MeshPhysicalMaterial({
    color,map:texture,bumpMap:texture,bumpScale:.003,roughness,
    metalness:0,sheen:.55,sheenColor:color,sheenRoughness:.82,
  });
  material.name='woven-office-textile';
  return material;
}

/** Flat woven rug with a genuinely rounded outline and bound, shallow edge.
 * A rounded box clamps corner radius to half the tiny rug thickness. */
export function officeRug(width:number,depth:number,radius=.22) {
  const x=-width/2,y=-depth/2,r=Math.min(radius,width/2,depth/2),shape=new THREE.Shape();
  shape.moveTo(x+r,y);shape.lineTo(x+width-r,y);
  shape.quadraticCurveTo(x+width,y,x+width,y+r);shape.lineTo(x+width,y+depth-r);
  shape.quadraticCurveTo(x+width,y+depth,x+width-r,y+depth);shape.lineTo(x+r,y+depth);
  shape.quadraticCurveTo(x,y+depth,x,y+depth-r);shape.lineTo(x,y+r);
  shape.quadraticCurveTo(x,y,x+r,y);shape.closePath();
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:.018,bevelEnabled:true,bevelThickness:.003,bevelSize:.004,bevelSegments:2,curveSegments:8});
  geometry.rotateX(-Math.PI/2);
  const position=geometry.getAttribute('position'),uvs=new Float32Array(position.count*2);
  for(let i=0;i<position.count;i++){
    uvs[i*2]=position.getX(i)/width+.5;uvs[i*2+1]=position.getZ(i)/depth+.5;
  }
  geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
  const rug=new THREE.Mesh(geometry,officeFabric('#adb6bf',[width*15,depth*15],.96));
  rug.name='office-woven-rug';rug.position.y=.004;rug.receiveShadow=true;
  rug.userData.officeRugSize=[width,depth];
  // A continuous bound perimeter, seated against the rolled edge. It follows
  // the actual rounded outline rather than drawing a square on the surface.
  const curve=new THREE.CatmullRomCurve3(shape.getPoints(24).slice(0,-1).map(p=>new THREE.Vector3(p.x,.017,-p.y)),true,'centripetal');
  const binding=new THREE.Mesh(new THREE.TubeGeometry(curve,256,.003,5,true),new THREE.MeshStandardMaterial({color:'#a5afb9',roughness:.95}));
  binding.name='rug-bound-perimeter';binding.receiveShadow=true;binding.castShadow=false;
  rug.add(binding);
  return rug;
}
