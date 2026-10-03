// Migrated from user-supplied agentcity qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";

export const OFFICE_FLOOR = { width: 23.4, depth: 16.2, centerZ: 0.2, foyerStartZ: 6.6, stoneTileMeters: 1.5 } as const;

/** Floor UVs retain their actual metre scale and one coplanar reflection. The
 * foyer finish begins after the workrooms and stays inside the front facade. */
export function officeFloorZone(v: number) {
  const z = OFFICE_FLOOR.centerZ + OFFICE_FLOOR.depth * (0.5 - v);
  return z > OFFICE_FLOOR.foyerStartZ ? "stone" : "wood";
}

export function applyOfficeFloorFinish(material: THREE.MeshPhysicalMaterial, stone: readonly [THREE.Texture, THREE.Texture, THREE.Texture]) {
  const [diffuse, normal, rough] = stone;
  const boundaryV = (OFFICE_FLOOR.centerZ + OFFICE_FLOOR.depth / 2 - OFFICE_FLOOR.foyerStartZ) / OFFICE_FLOOR.depth;
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.userData.officeStoneTextures = stone;
  const disposeStone = () => {
    material.removeEventListener("dispose", disposeStone);
    stone.forEach(texture => texture.dispose());
  };
  material.addEventListener("dispose", disposeStone);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.officeStoneDiffuse = { value: diffuse };
    shader.uniforms.officeStoneNormal = { value: normal };
    shader.uniforms.officeStoneRoughness = { value: rough };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 officeFloorUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nofficeFloorUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec2 officeFloorUv;
        uniform sampler2D officeStoneDiffuse;
        uniform sampler2D officeStoneNormal;
        uniform sampler2D officeStoneRoughness;`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        float officeStoneMask = 1.0 - step(${boundaryV.toFixed(9)}, officeFloorUv.y);
        vec2 officeStoneUv = officeFloorUv * vec2(${OFFICE_FLOOR.width / OFFICE_FLOOR.stoneTileMeters}, ${OFFICE_FLOOR.depth / OFFICE_FLOOR.stoneTileMeters});
        float oakLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 whiteOak = vec3(0.19, 0.20, 0.205) + vec3(oakLuma * 0.9);
        float stoneLuma = dot(texture2D(officeStoneDiffuse, officeStoneUv).rgb, vec3(0.2126, 0.7152, 0.0722));
        // Preserve scanned veins and grout; the neutral limestone tint is authored.
        vec3 paleStone = vec3(0.32, 0.335, 0.35) + vec3(stoneLuma * 0.95);
        diffuseColor.rgb = mix(whiteOak, paleStone, officeStoneMask);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        float woodRoughness = roughness;
        #ifdef USE_ROUGHNESSMAP
          woodRoughness *= 0.8 + 0.4 * texture2D(roughnessMap, vRoughnessMapUv).g;
        #endif
        float stoneRoughness = 0.24 + 0.24 * texture2D(officeStoneRoughness, officeStoneUv).g;
        roughnessFactor = mix(woodRoughness, stoneRoughness, officeStoneMask);`)
      .replace("#include <normal_fragment_maps>", THREE.ShaderChunk.normal_fragment_maps.replace(
        "mapN.xy *= normalScale;",
        `mapN.xy *= normalScale;
        vec3 stoneN = texture2D(officeStoneNormal, officeStoneUv).xyz * 2.0 - 1.0;
        stoneN.xy *= 0.12;
        mapN = mix(mapN, stoneN, officeStoneMask);`,
      ));
  };
  material.customProgramCacheKey = () => previousKey + "|office-zoned-floor-v1";
  material.needsUpdate = true;
}
