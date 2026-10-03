import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { FontLoader, type FontData } from "three/addons/loaders/FontLoader.js";
import signFontData from "../assets/fonts/helvetiker_bold.typeface.json";

const SIGN_FONT = new FontLoader().parse(signFontData as unknown as FontData);

// 城市与 Workspace 详情共用实体文字，远景缩放时仍保持前沿铭牌清晰。
export function SignFace({ text, width, height, color, position, rotation }: {
  text: string;
  width: number;
  height: number;
  color: string;
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  const geometry = useMemo(() => {
    const value = new TextGeometry(text.trim(), {
      font: SIGN_FONT,
      size: 1,
      depth: 0.01,
      curveSegments: 8,
      bevelEnabled: false
    });
    value.computeBoundingBox();
    const bounds = value.boundingBox;
    if (bounds) {
      const sourceWidth = Math.max(bounds.max.x - bounds.min.x, 0.001);
      const sourceHeight = Math.max(bounds.max.y - bounds.min.y, 0.001);
      const scaleY = height * 0.7 / sourceHeight;
      const scaleX = Math.min(scaleY, width * 0.94 / sourceWidth);
      // 保持字高稳定，长名称仅收窄横向比例，避免画面中出现省略号。
      value.translate(-(bounds.min.x + bounds.max.x) / 2, -(bounds.min.y + bounds.max.y) / 2, 0);
      value.scale(scaleX, scaleY, 1);
    }
    value.computeVertexNormals();
    return value;
  }, [height, text, width]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} position={position} rotation={rotation} renderOrder={20}>
    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.055} roughness={0.86} metalness={0} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} />
  </mesh>;
}

export const CRYSTAL_GLASS_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vViewDirection;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

export const CRYSTAL_GLASS_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uBaseOpacity;
  uniform float uEdgeOpacity;
  varying vec3 vNormal;
  varying vec3 vViewDirection;

  void main() {
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), vViewDirection)), 2.35);
    gl_FragColor = vec4(uColor, uBaseOpacity + fresnel * uEdgeOpacity);
  }
`;

export const CRYSTAL_INNER_GLOW_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uBaseOpacity;
  uniform float uEdgeOpacity;
  varying vec3 vNormal;
  varying vec3 vViewDirection;

  void main() {
    float viewFacing = abs(dot(normalize(vNormal), vViewDirection));
    float inwardGlow = pow(1.0 - viewFacing, 0.82);
    gl_FragColor = vec4(uColor, uBaseOpacity + inwardGlow * uEdgeOpacity);
  }
`;
