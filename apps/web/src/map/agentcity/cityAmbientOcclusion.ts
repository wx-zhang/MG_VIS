// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

// Screen-space contact shading, not a city-wide light transport simulation.
// Position reconstruction uses the complete inverse projection: the map's
// translated camera has an off-axis/reflected projection, not a usual Z eye.
const vertexShader = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const reconstruction = `
uniform sampler2D tDepth;
uniform mat4 inverseProjection;
uniform vec2 bufferSize;
vec3 positionAt(vec2 uv,float depth){
  // Linear eye distance avoids the city-scale precision loss of hardware depth.
  // Nearest-filtered depth belongs to a texel centre, not the arbitrary query UV.
  // Using the query ray creates false elevation steps even on a perfectly flat plane.
  vec2 centre=(clamp(floor(uv*bufferSize),vec2(0.),bufferSize-1.)+.5)/bufferSize;
  vec4 p=inverseProjection*vec4(centre*2.-1.,.5,1.);
  return normalize(p.xyz/p.w)*depth;
}`;

export function createCityAmbientOcclusion() {
  const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const normals = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthTexture: depth,
    type: THREE.FloatType,
  });
  const occlusion = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const normalMaterial = new THREE.MeshNormalMaterial({
    side: THREE.DoubleSide,
  });
  normalMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "varying vec3 vContactPosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      "#include <project_vertex>\nvContactPosition=mvPosition.xyz;",
    );
    shader.fragmentShader =
      "varying vec3 vContactPosition;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );",
      "gl_FragColor = vec4(packNormalToRGB(normal),length(vContactPosition));",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "gl_FragColor.a = 1.0;",
      "",
    );
  };
  normalMaterial.customProgramCacheKey = () => "map-contact-linear-distance-v1";
  const inverseProjection = { value: new THREE.Matrix4() };
  const bufferSize = { value: new THREE.Vector2(1, 1) };
  const kernel = Array.from({ length: 24 }, (_, i) => {
    const z = (i + 0.5) / 24,
      phi = i * 2.399963229728653;
    const r = Math.sqrt(1 - z * z),
      scale = 0.3 + (0.7 * ((i * 13) % 24)) / 23;
    return new THREE.Vector3(
      Math.cos(phi) * r,
      Math.sin(phi) * r,
      z,
    ).multiplyScalar(scale);
  });
  const sampleMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    uniforms: {
      tDepth: { value: normals.texture },
      tNormal: { value: normals.texture },
      inverseProjection,
      bufferSize,
      projection: { value: new THREE.Matrix4() },
      kernel: { value: kernel },
      radius: { value: 9 },
    },
    vertexShader,
    fragmentShader: `varying vec2 vUv;${reconstruction}
      uniform sampler2D tNormal;
      uniform mat4 projection;
      uniform vec3 kernel[24];
      uniform float radius;
      void main(){
        float depth=texture2D(tDepth,vUv).a;
        if(depth<=0.){gl_FragColor=vec4(1.);return;}
        vec3 p=positionAt(vUv,depth), n=normalize(texture2D(tNormal,vUv).xyz*2.-1.);
        if(dot(n,-p)<0.)n=-n; // Reflected map projections can reverse front-facing.
        vec3 axis=abs(n.y)<.9 ? vec3(0.,1.,0.) : vec3(1.,0.,0.);
        vec3 tangent=normalize(cross(axis,n)), bitangent=cross(n,tangent);
        mat3 basis=mat3(tangent,bitangent,n);
        float blocked=0.;
        for(int i=0;i<24;i++){
          vec3 q=p+basis*kernel[i]*radius;
          vec4 clip=projection*vec4(q,1.);
          if(clip.w<=0.)continue;
          vec2 uv=clip.xy/clip.w*.5+.5;
          if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))continue;
          float d=texture2D(tDepth,uv).a;
          if(d<=0.)continue;
          vec3 hit=positionAt(uv,d), delta=hit-p;
          float range=1.-smoothstep(radius*.6,radius*1.2,length(delta));
          // Only a nearby surface in the outgoing hemisphere can occlude sky.
          // Camera distance works with the map's non-standard projection axis.
          blocked+=step(.18,dot(delta,n))*step(.22,length(q)-length(hit))*range;
        }
        gl_FragColor=vec4(vec3(1.-blocked/24.),1.);
      }`,
  });
  const compositeMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    uniforms: {
      tDepth: { value: normals.texture },
      tAO: { value: occlusion.texture },
      inverseProjection,
      bufferSize,
      texel: { value: new THREE.Vector2() },
      strength: { value: 0.65 },
    },
    vertexShader,
    fragmentShader: `varying vec2 vUv;${reconstruction}
      uniform sampler2D tAO;
      uniform vec2 texel;
      uniform float strength;
      void main(){
        float depth=texture2D(tDepth,vUv).a;
        if(depth<=0.){gl_FragColor=vec4(1.);return;}
        vec3 p=positionAt(vUv,depth);
        float sum=0.,weight=0.;
        for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){
          vec2 uv=clamp(vUv+vec2(float(x),float(y))*texel,vec2(0.),vec2(1.));
          float d=texture2D(tDepth,uv).a;
          if(d<=0.)continue;
          float separation=length(positionAt(uv,d)-p);
          float w=exp(-float(x*x+y*y)*.3)*exp(-separation*.22);
          sum+=texture2D(tAO,uv).r*w; weight+=w;
        }
        float ao=weight>0. ? sum/weight : 1.;
        gl_FragColor=vec4(vec3(1.-(1.-ao)*strength),1.);
      }`,
  });
  const quad = new FullScreenQuad(sampleMaterial);
  let width = 0,
    height = 0,
    disposed = false;
  const clearColor = new THREE.Color(),
    viewport = new THREE.Vector4(),
    scissor = new THREE.Vector4();
  return {
    normalTarget: normals,
    aoTarget: occlusion,
    normalMaterial,
    sampleMaterial,
    compositeMaterial,
    render(
      renderer: THREE.WebGLRenderer,
      scene: THREE.Scene,
      camera: THREE.Camera,
      pixelWidth: number,
      pixelHeight: number,
      strength: number,
    ) {
      if (disposed || strength <= 0) return { calls: 0, triangles: 0 };
      if (!renderer.extensions.has("EXT_color_buffer_float"))
        throw Error("Floating-point contact buffer unavailable");
      // Full pixel coverage, capped at 1280px. Bilateral filtering must not put
      // a black halo outside a tower or bleed a roof cavity across the river.
      const factor = Math.min(1, 1280 / Math.max(pixelWidth, pixelHeight));
      const w = Math.max(1, Math.round(pixelWidth * factor)),
        h = Math.max(1, Math.round(pixelHeight * factor));
      if (w !== width || h !== height) {
        width = w;
        height = h;
        normals.setSize(w, h);
        occlusion.setSize(w, h);
        compositeMaterial.uniforms.texel!.value.set(1 / w, 1 / h);
        bufferSize.value.set(w, h);
      }
      inverseProjection.value.copy(camera.projectionMatrixInverse);
      sampleMaterial.uniforms.projection!.value.copy(camera.projectionMatrix);
      compositeMaterial.uniforms.strength!.value = strength;
      const gl = renderer.getContext(),
        framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      const glViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
      const target = renderer.getRenderTarget(),
        override = scene.overrideMaterial;
      const background = scene.background,
        autoClear = renderer.autoClear;
      const alpha = renderer.getClearAlpha(),
        shadows = renderer.shadowMap.enabled;
      const scissorTest = renderer.getScissorTest();
      renderer.getClearColor(clearColor);
      renderer.getViewport(viewport);
      renderer.getScissor(scissor);
      const hidden: THREE.Object3D[] = [];
      scene.traverse((object) => {
        if (
          object.visible &&
          ((object as THREE.Line).isLine || (object as THREE.Points).isPoints)
        ) {
          hidden.push(object);
          object.visible = false;
        }
      });
      let calls = 0,
        triangles = 0;
      try {
        renderer.autoClear = false;
        renderer.shadowMap.enabled = false;
        renderer.setScissorTest(false);
        renderer.setRenderTarget(normals);
        renderer.setClearColor(0x8080ff, 0);
        renderer.clear();
        scene.background = null;
        scene.overrideMaterial = normalMaterial;
        renderer.render(scene, camera);
        calls += renderer.info.render.calls;
        triangles += renderer.info.render.triangles;
        scene.overrideMaterial = override;
        scene.background = background;
        renderer.setRenderTarget(occlusion);
        quad.material = sampleMaterial;
        quad.render(renderer);
        calls++;
        renderer.setRenderTarget(target);
        // MapLibre owns the destination FBO; it is not necessarily the canvas.
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.viewport(
          glViewport[0]!,
          glViewport[1]!,
          glViewport[2]!,
          glViewport[3]!,
        );
        quad.material = compositeMaterial;
        quad.render(renderer);
        calls++;
      } finally {
        scene.overrideMaterial = override;
        scene.background = background;
        hidden.forEach((object) => (object.visible = true));
        renderer.shadowMap.enabled = shadows;
        renderer.autoClear = autoClear;
        renderer.setClearColor(clearColor, alpha);
        renderer.setRenderTarget(target);
        renderer.setViewport(viewport);
        renderer.setScissor(scissor);
        renderer.setScissorTest(scissorTest);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.viewport(
          glViewport[0]!,
          glViewport[1]!,
          glViewport[2]!,
          glViewport[3]!,
        );
      }
      return { calls, triangles };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // We own the depth attachment explicitly, including before first render.
      // Detach it so WebGLRenderTarget's GPU deallocator cannot dispose it twice.
      normals.depthTexture = null;
      normals.dispose();
      depth.dispose();
      occlusion.dispose();
      normalMaterial.dispose();
      sampleMaterial.dispose();
      compositeMaterial.dispose();
      quad.dispose();
    },
  };
}
