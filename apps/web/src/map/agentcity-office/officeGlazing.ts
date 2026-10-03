// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";

/** Clear, thin glazing for the roof-cutaway presentation. This is an alpha
 * reflection approximation, not solid-glass refraction or a daylight solver.
 * One outward box boundary is drawn, and glazing stays out of opaque shadows
 * and AO. Keeping the actual specular lobe avoids whitening the desks behind
 * several panes with the diffuse surface of a translucent painted wall. */
export function officeGlass() {
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    ior: 1.52,
    roughness: 0.055,
    metalness: 0,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  glass.name = "clear-office-glazing";
  const strength = { value: 1 };
  // Inspection can remove only the pane's optical contribution, preserving
  // geometry, frames, lighting, camera and task state for an honest comparison.
  glass.userData.officeGlazingStrength = strength;
  glass.userData.representation = "thin-specular-alpha-no-refraction";
  glass.onBeforeCompile = (shader) => {
    shader.uniforms.officeGlazingStrength = strength;
    shader.fragmentShader =
      "uniform float officeGlazingStrength;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `
      float paneFacing = clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
      float paneCoverage = max3(F_Schlick(material.specularColor, material.specularF90, paneFacing));
      // The Standard/Physical BRDF already includes Fresnel in totalSpecular.
      // Unweight it before normal alpha blending so Fresnel is not applied twice.
      outgoingLight = totalSpecular / max(paneCoverage, 0.0001);
      diffuseColor.a = clamp(paneCoverage * officeGlazingStrength, 0.0, 1.0);
      #include <opaque_fragment>
    `,
    );
  };
  glass.customProgramCacheKey = () => "office-thin-specular-alpha-v2";
  return glass;
}
