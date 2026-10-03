// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";

// Architectural cutaway: retain the city through the three exterior glazed
// elevations, while the omitted building envelope stays a neutral presentation
// background. These are world-space openings, not a screen-aligned image mask.
export const OFFICE_OUTLOOK_APERTURE = {
  halfWidth: 11.6,
  backZ: -7.45,
  frontZ: 6.75,
  height: 4.7,
} as const;
export function officeOutlookRayVisible(
  camera: THREE.Vector3,
  point: THREE.Vector3,
) {
  const a = OFFICE_OUTLOOK_APERTURE,
    ray = point.clone().sub(camera);
  const through = (axis: "x" | "z", plane: number) => {
    if (Math.abs(ray[axis]) < 0.00001) return false;
    const t = (plane - camera[axis]) / ray[axis];
    if (t <= 0 || t >= 1) return false;
    const p = camera.clone().addScaledVector(ray, t);
    return (
      p.y >= 0 &&
      p.y <= a.height &&
      (axis === "z"
        ? Math.abs(p.x) <= a.halfWidth
        : p.z >= a.backZ && p.z <= a.frontZ)
    );
  };
  return (
    through("z", a.backZ) ||
    through("x", -a.halfWidth) ||
    through("x", a.halfWidth)
  );
}

/** Applied to BOTH PBR and normal/depth passes, including the reflected camera.
 * Otherwise invisible city walls still leave false ambient-occlusion silhouettes. */
export function applyOfficeOutlookAperture(material: THREE.Material) {
  if (material.userData.officeOutlookAperture) return;
  material.userData.officeOutlookAperture = true;
  const previous = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  const a = OFFICE_OUTLOOK_APERTURE;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 officeOutlookWorld;",
      )
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nofficeOutlookWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    // MeshNormalMaterial has no <common> fragment chunk in r180. Prepend the
    // declaration so the same aperture also compiles in the opaque G-buffer.
    shader.fragmentShader =
      `
        varying vec3 officeOutlookWorld;
        bool officeOutlookWindow(vec3 origin, vec3 ray, float plane, bool side) {
          float direction = side ? ray.x : ray.z;
          if (abs(direction) < 0.00001) return false;
          float t = (plane - (side ? origin.x : origin.z)) / direction;
          if (t <= 0.0 || t >= 1.0) return false;
          vec3 p = origin + ray * t;
          return p.y >= 0.0 && p.y <= ${a.height} && (side
            ? p.z >= ${a.backZ} && p.z <= ${a.frontZ}
            : abs(p.x) <= ${a.halfWidth});
        }\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>
        vec3 officeOutlookRay = officeOutlookWorld - cameraPosition;
        if (!officeOutlookWindow(cameraPosition, officeOutlookRay, ${a.backZ}, false)
          && !officeOutlookWindow(cameraPosition, officeOutlookRay, ${-a.halfWidth}, true)
          && !officeOutlookWindow(cameraPosition, officeOutlookRay, ${a.halfWidth}, true)) discard;`,
    );
  };
  material.customProgramCacheKey = () => key + "|office-outlook-aperture-v1";
}
