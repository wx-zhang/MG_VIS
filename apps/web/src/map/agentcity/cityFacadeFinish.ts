// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";

/** OSM class chooses an illustrative finish, not a surveyed elevation. Geometry,
 * footprints, holes and heights are owned by the geographic source. */
export function facadeFinish(
  building: string | undefined,
  height: number,
  id: string,
) {
  const family = /^(apartments|dormitory|hotel|hospital)$/.test(building ?? "")
    ? 0
    : /^(office|commercial)$/.test(building ?? "")
      ? 1
      : /^(construction|industrial|warehouse)$/.test(building ?? "")
        ? 3
        : 2;
  const targetFloor = family === 0 ? 3.1 : 3.65;
  const floor = height / Math.max(1, Math.round(height / targetFloor));
  let hash = 2166136261;
  for (const letter of id)
    hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  const tint = ((hash >>> 0) % 1000) / 999;
  return { family, floor, bay: family === 0 ? 3.6 : 2.8, tint };
}

export function createFacadeMaterial() {
  const structuralBays = { value: 1 };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.7,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  material.name = "illustrative-source-class-facades";
  material.userData.structuralBays = structuralBays;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.structuralBays = structuralBays;
    shader.vertexShader =
      `attribute vec4 facadeSpec; attribute float facadeSolid;
      varying vec2 vFacadeUv; varying vec4 vFacadeSpec; varying float vFacadeSolid;\n` +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvFacadeUv=uv; vFacadeSpec=facadeSpec; vFacadeSolid=facadeSolid;",
    );
    shader.fragmentShader =
      "uniform float structuralBays; varying vec2 vFacadeUv; varying vec4 vFacadeSpec; varying float vFacadeSolid;\n" +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      vec2 cell=vFacadeUv/vFacadeSpec.xy;
      vec2 aa=max(fwidth(cell),vec2(.00001));
      vec2 q=fract(cell);
      float residential=1.0-step(.5,vFacadeSpec.z);
      float curtain=step(.5,vFacadeSpec.z)*(1.0-step(1.5,vFacadeSpec.z));
      float plain=step(2.5,vFacadeSpec.z);
      vec2 inset=mix(vec2(.075,.13),vec2(.17,.22),residential);
      inset=mix(inset,vec2(.016,.055),curtain);
      vec2 aperture=smoothstep(inset-aa,inset+aa,q)
        *(1.0-smoothstep(1.0-inset-aa,1.0-inset+aa,q));
      float resolution=1.0-smoothstep(.2,.7,max(aa.x,aa.y));
      float averageGlass=(1.0-2.0*inset.x)*(1.0-2.0*inset.y);
      float facadeGlass=mix(averageGlass,aperture.x*aperture.y,resolution)*(1.0-plain)*(1.0-vFacadeSolid);
      vec3 stone=mix(vec3(.72,.78,.82),vec3(.82,.85,.86),residential);
      stone+=vec3((vFacadeSpec.w-.5)*.055);
      vec3 glass=mix(vec3(.27,.42,.52),vec3(.34,.51,.62),vFacadeSpec.w);
      // Recess edge and inter-storey finish are subpixel-safe surface detail.
      // No fake depth/parallax or new footprint is introduced by this shader.
      float reveal=(1.0-smoothstep(inset.y+.025-aa.y,inset.y+.09+aa.y,q.y))
        *aperture.x*aperture.y*residential*resolution;
      float band=(1.0-smoothstep(.025,.025+aa.y,min(q.y,1.0-q.y)))*resolution;
      stone*=1.0-.14*band;
      glass*=1.0-.22*reveal;
      diffuseColor.rgb*=mix(stone,glass,facadeGlass);
      // The reference's towers read at district distance through a hierarchy
      // of primary bays, not an identical dense grid of tiny windows. These
      // metre-sized panes share primary vertical divisions with the actual
      // recessed geometry. Horizontal storey bands remain surface detail.
      vec2 primaryPeriod=vFacadeSpec.xy*vec2(4.,3.);
      vec2 primary=vFacadeUv/primaryPeriod;
      vec2 primaryAA=max(fwidth(primary),vec2(.00001));
      vec2 primaryEdge=min(fract(primary),1.-fract(primary));
      vec2 halfWidth=vec2(.34,.26)/primaryPeriod;
      vec2 primaryLines=1.-smoothstep(halfWidth-primaryAA,halfWidth+primaryAA,primaryEdge);
      float primaryResolution=1.-smoothstep(.22,.75,max(primaryAA.x,primaryAA.y));
      vec2 primaryCoverage=mix(2.*halfWidth,primaryLines,primaryResolution);
      float primaryFrame=(1.-(1.-primaryCoverage.x)*(1.-primaryCoverage.y))
        *(1.-plain)*structuralBays;
      diffuseColor.rgb=mix(diffuseColor.rgb,stone*1.06,primaryFrame);
      facadeGlass*=1.-primaryFrame;
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      "#include <roughnessmap_fragment>\nroughnessFactor=mix(.82,.24,facadeGlass);",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <metalnessmap_fragment>",
      "#include <metalnessmap_fragment>\nmetalnessFactor=.04*facadeGlass;",
    );
  };
  material.customProgramCacheKey = () => "agent-city-source-facade-finish-v4";
  return material;
}

/** Small, fixed geographic daylight field: no painted city or animated sky.
 * PMREM only supplies broad glass reflections; direct sun still owns shadows. */
export function createCityFacadeEnvironment(renderer: THREE.WebGLRenderer) {
  const width = 128,
    height = 64,
    data = new Float32Array(width * height * 4);
  const sky = new THREE.Color(0.48, 0.66, 0.84),
    horizon = new THREE.Color(0.86, 0.9, 0.92);
  const ground = new THREE.Color(0.28, 0.34, 0.38),
    color = new THREE.Color();
  for (let y = 0; y < height; y++) {
    const elevation = -Math.cos(((y + 0.5) / height) * Math.PI);
    color
      .copy(horizon)
      .lerp(elevation >= 0 ? sky : ground, Math.pow(Math.abs(elevation), 0.55));
    for (let x = 0; x < width; x++)
      data.set([color.r, color.g, color.b, 1], (y * width + x) * 4);
  }
  const source = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.LinearSRGBColorSpace;
  source.needsUpdate = true;
  const generator = new THREE.PMREMGenerator(renderer);
  try {
    return generator.fromEquirectangular(source);
  } finally {
    source.dispose();
    generator.dispose();
  }
}
