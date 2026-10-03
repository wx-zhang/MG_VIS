import { useTexture } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

type Props = {
  src: string;
  width: number;
  depth: number;
  y: number;
  opacity?: number;
  fadeEdges?: boolean;
  fadeFraction?: number;
  centerCutout?: number;
  renderOrder?: number;
};

export function SpatialAtlasGround({ src, width, depth, y, opacity = 1, fadeEdges = false, fadeFraction = 0.1, centerCutout, renderOrder = -1 }: Props) {
  const texture = useTexture(src);
  const { gl, invalidate } = useThree();
  const fadeMask = useMemo(() => {
    if (!fadeEdges && centerCutout === undefined) return null;
    const size = 128;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const edge = Math.min(u, v, 1 - u, 1 - v);
      const inset = centerCutout === undefined ? 0 : (1 - centerCutout) / 2;
      const innerDistance = Math.min(u - inset, v - inset, 1 - inset - u, 1 - inset - v);
      const progress = THREE.MathUtils.clamp((centerCutout === undefined ? edge : innerDistance) / (centerCutout === undefined ? fadeFraction : centerCutout * fadeFraction), 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      // 外围地图只填补原图之外的区域；中央保留原图像素，边缘使用互补渐隐连接。
      const strength = centerCutout === undefined ? eased : 1 - eased;
      const offset = (y * size + x) * 4;
      // alphaMap 读取绿色通道；中心保持贴图，四周逐渐融入场景底色。
      pixels[offset] = 255;
      pixels[offset + 1] = Math.round(strength * 255);
      pixels[offset + 2] = 255;
      pixels[offset + 3] = 255;
    }
    const mask = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    mask.magFilter = THREE.LinearFilter;
    mask.minFilter = THREE.LinearFilter;
    mask.needsUpdate = true;
    return mask;
  }, [centerCutout, fadeEdges, fadeFraction]);

  useEffect(() => {
    // 两张地图都作为静态沙盘地面使用，保持贴图原始宽高比与 sRGB 色彩。
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(16, gl.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    invalidate();
  }, [gl, invalidate, texture]);

  useEffect(() => () => fadeMask?.dispose(), [fadeMask]);

  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} renderOrder={renderOrder} raycast={() => undefined}>
    <planeGeometry args={[width, depth]} />
    <meshBasicMaterial map={texture} alphaMap={fadeMask ?? undefined} transparent={opacity < 1 || fadeEdges || centerCutout !== undefined} opacity={opacity} depthWrite={opacity === 1 && !fadeEdges && centerCutout === undefined} fog={false} toneMapped={false} />
  </mesh>;
}
