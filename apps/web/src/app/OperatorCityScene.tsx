import { Html, Line, OrbitControls, RoundedBox, useCursor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { PlatformOperatorCityOverviewPayload } from "@tyr-ai/contracts";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import * as THREE from "three";
import cityAtlasGroundUrl from "../assets/operator-city-atlas-ground-crisp.webp";
import cityOutskirtsUrl from "../assets/operator-city-atlas-outskirts.webp";
import { SpatialAtlasGround } from "./SpatialAtlasGround";
import { CRYSTAL_GLASS_FRAGMENT_SHADER, CRYSTAL_GLASS_VERTEX_SHADER, CRYSTAL_INNER_GLOW_FRAGMENT_SHADER, SignFace } from "./WorkspaceGlassVisual";
import { OPERATOR_CITY_STATE_TONE, operatorCityWorkspaceState } from "./operatorCityStatus";

type CityWorkspace = PlatformOperatorCityOverviewPayload["workspaces"][number];
type CityLayout = { workspace: CityWorkspace; position: THREE.Vector3 };
export type CityCameraPose = { position: [number, number, number]; target: [number, number, number]; zoom: number };
type CameraMove = {
  startedAt: number;
  durationMs: number;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromZoom: number;
  toZoom: number;
  completeId: string | null;
};

const CAMERA_OFFSET = new THREE.Vector3(0, 18, 24);
const EMPTY_CITY_TARGET = new THREE.Vector3();

function cityLayout(workspaces: CityWorkspace[]): CityLayout[] {
  const count = Math.max(1, workspaces.length);
  const scale = Math.max(1, count / 6);
  // 分区位置仅用于演示城市关系，不暗示 Workspace 的真实地理位置或权限层级。
  return workspaces.map((workspace, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    return {
      workspace,
      position: new THREE.Vector3(Math.cos(angle) * 12.2 * scale, 0, Math.sin(angle) * 7.2 * scale)
    };
  });
}

function cityFitZoom(width: number, height: number, count: number): number {
  const scale = Math.max(1, count / 6);
  return Math.max(10, Math.min(width / (31 * scale), height / (16 * scale), 39));
}

function cityGroundCoversViewport(camera: THREE.Camera, count: number): boolean {
  const scale = Math.max(1, count / 6);
  const halfWidth = 45 * scale - 1.2;
  const halfDepth = 22.5 * scale - 1.2;
  camera.updateMatrixWorld();
  const direction = camera.getWorldDirection(new THREE.Vector3());
  // 以四个屏幕角点与地图平面的交点判断覆盖范围，避免旋转或缩放后露出空白背景。
  return [-1, 1].every((x) => [-1, 1].every((y) => {
    const origin = new THREE.Vector3(x, y, -1).unproject(camera);
    const distance = (-0.35 - origin.y) / direction.y;
    const hit = origin.addScaledVector(direction, distance);
    return distance > 0 && Math.abs(hit.x) <= halfWidth && Math.abs(hit.z) <= halfDepth;
  }));
}

function CityCamera({ layout, focusWorkspaceId, returnFromWorkspaceId, initialPose, resetViewSignal, onPoseChange, onFocusComplete }: {
  layout: CityLayout[];
  focusWorkspaceId: string | null;
  returnFromWorkspaceId: string | null;
  initialPose: CityCameraPose | null;
  resetViewSignal: number;
  onPoseChange: (pose: CityCameraPose) => void;
  onFocusComplete: (workspaceId: string) => void;
}) {
  const { camera, size, invalidate } = useThree();
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const moveRef = useRef<CameraMove | null>(null);
  const initialReturnRef = useRef(returnFromWorkspaceId);
  const initialPoseRef = useRef(initialPose);
  const lastCityPoseRef = useRef(initialPose);
  const fitZoom = cityFitZoom(size.width, size.height, layout.length);
  const focusZoom = Math.max(fitZoom * 1.85, Math.min(size.width / 10, size.height / 8));
  const layoutById = useMemo(() => new Map(layout.map((item) => [item.workspace.serverId, item.position])), [layout]);
  const lastFocusRef = useRef<string | null>(null);
  const viewportZoomRef = useRef({ fitZoom, focusZoom });
  const lastCoveredPoseRef = useRef<CityCameraPose | null>(null);
  const suppressCoverageRef = useRef(false);
  const lastResetViewSignalRef = useRef(resetViewSignal);

  useLayoutEffect(() => {
    suppressCoverageRef.current = true;
    // 从详情返回时从刚才的分区拉回全城；首次登录直接显示完整城市。
    const initial = initialReturnRef.current ? layoutById.get(initialReturnRef.current) : null;
    const saved = initialPoseRef.current;
    const cityTarget = saved ? new THREE.Vector3(...saved.target) : EMPTY_CITY_TARGET.clone();
    const cityPosition = saved ? new THREE.Vector3(...saved.position) : CAMERA_OFFSET.clone();
    const target = initial ?? cityTarget;
    camera.position.copy(initial ? cityPosition.clone().sub(cityTarget).add(initial) : cityPosition);
    camera.zoom = initial ? focusZoom : saved ? Math.min(saved.zoom, fitZoom * 1.2) : fitZoom;
    camera.updateProjectionMatrix();
    camera.lookAt(target);
    controlsRef.current?.target.copy(target);
    controlsRef.current?.update();
    if (!initial && !cityGroundCoversViewport(camera, layout.length)) {
      camera.position.copy(CAMERA_OFFSET);
      camera.zoom = fitZoom;
      camera.updateProjectionMatrix();
      controlsRef.current?.target.copy(EMPTY_CITY_TARGET);
      controlsRef.current?.update();
    }
    lastCoveredPoseRef.current = initial ? null : {
      position: camera.position.toArray() as [number, number, number],
      target: controlsRef.current?.target.toArray() as [number, number, number] ?? [0, 0, 0],
      zoom: camera.zoom
    };
    if (initial) {
      moveRef.current = {
        startedAt: performance.now(), durationMs: 800,
        fromPosition: camera.position.clone(), toPosition: cityPosition,
        fromTarget: target.clone(), toTarget: cityTarget,
        fromZoom: camera.zoom, toZoom: saved ? Math.min(saved.zoom, fitZoom * 1.2) : fitZoom, completeId: null
      };
      invalidate();
    }
    suppressCoverageRef.current = false;
  }, []);

  useEffect(() => {
    if (lastFocusRef.current === focusWorkspaceId) return;
    lastFocusRef.current = focusWorkspaceId;
    const saved = lastCityPoseRef.current;
    const destination = focusWorkspaceId ? layoutById.get(focusWorkspaceId) : saved ? new THREE.Vector3(...saved.target) : EMPTY_CITY_TARGET;
    if (!destination) return;
    const controls = controlsRef.current;
    const currentTarget = controls?.target.clone() ?? EMPTY_CITY_TARGET.clone();
    if (focusWorkspaceId) {
      const pose: CityCameraPose = { position: camera.position.toArray() as [number, number, number], target: currentTarget.toArray() as [number, number, number], zoom: camera.zoom };
      lastCityPoseRef.current = pose;
      onPoseChange(pose);
    }
    moveRef.current = {
      startedAt: performance.now(), durationMs: focusWorkspaceId ? 780 : 650,
      fromPosition: camera.position.clone(), toPosition: focusWorkspaceId ? camera.position.clone().sub(currentTarget).add(destination) : saved ? new THREE.Vector3(...saved.position) : CAMERA_OFFSET.clone(),
      fromTarget: currentTarget, toTarget: destination.clone(),
      fromZoom: camera.zoom, toZoom: focusWorkspaceId ? focusZoom : saved ? Math.min(saved.zoom, fitZoom * 1.2) : fitZoom,
      completeId: focusWorkspaceId
    };
    invalidate();
  }, [camera, fitZoom, focusWorkspaceId, focusZoom, invalidate, layoutById, onPoseChange]);

  useEffect(() => {
    const previous = viewportZoomRef.current;
    viewportZoomRef.current = { fitZoom, focusZoom };
    if (previous.fitZoom === fitZoom && previous.focusZoom === focusZoom) return;
    // 浏览器窗口变化时重新适配城市或选中分区，保持镜头中的内容完整可见。
    if (moveRef.current) moveRef.current.toZoom = moveRef.current.completeId ? focusZoom : fitZoom;
    else {
      camera.zoom = focusWorkspaceId ? focusZoom : fitZoom;
      camera.updateProjectionMatrix();
      controlsRef.current?.update();
    }
    invalidate();
  }, [camera, fitZoom, focusWorkspaceId, focusZoom, invalidate]);

  useEffect(() => {
    if (lastResetViewSignalRef.current === resetViewSignal) return;
    lastResetViewSignalRef.current = resetViewSignal;
    const target = controlsRef.current?.target.clone() ?? EMPTY_CITY_TARGET.clone();
    const pose: CityCameraPose = { position: CAMERA_OFFSET.toArray() as [number, number, number], target: [0, 0, 0], zoom: fitZoom };
    // 重置角度也更新返回详情时使用的城市视角，避免下次又恢复到旧姿态。
    lastCityPoseRef.current = pose;
    lastCoveredPoseRef.current = pose;
    onPoseChange(pose);
    moveRef.current = {
      startedAt: performance.now(), durationMs: 550,
      fromPosition: camera.position.clone(), toPosition: CAMERA_OFFSET.clone(),
      fromTarget: target, toTarget: EMPTY_CITY_TARGET.clone(),
      fromZoom: camera.zoom, toZoom: fitZoom, completeId: null
    };
    invalidate();
  }, [camera, fitZoom, invalidate, onPoseChange, resetViewSignal]);

  useFrame(() => {
    const move = moveRef.current;
    if (!move) return;
    const progress = Math.min(1, (performance.now() - move.startedAt) / move.durationMs);
    const eased = 1 - Math.pow(1 - progress, 3);
    camera.position.lerpVectors(move.fromPosition, move.toPosition, eased);
    camera.zoom = THREE.MathUtils.lerp(move.fromZoom, move.toZoom, eased);
    camera.updateProjectionMatrix();
    controlsRef.current?.target.lerpVectors(move.fromTarget, move.toTarget, eased);
    controlsRef.current?.update();
    if (progress < 1) invalidate();
    else {
      moveRef.current = null;
      if (!move.completeId && !cityGroundCoversViewport(camera, layout.length)) {
        camera.position.copy(CAMERA_OFFSET);
        camera.zoom = fitZoom;
        camera.updateProjectionMatrix();
        controlsRef.current?.target.copy(EMPTY_CITY_TARGET);
        controlsRef.current?.update();
      }
      if (!move.completeId) lastCoveredPoseRef.current = {
        position: camera.position.toArray() as [number, number, number],
        target: controlsRef.current?.target.toArray() as [number, number, number] ?? [0, 0, 0],
        zoom: camera.zoom
      };
      if (move.completeId) onFocusComplete(move.completeId);
    }
  });

  return <OrbitControls ref={controlsRef} enablePan={false} minZoom={fitZoom} maxZoom={focusZoom * 1.2} minAzimuthAngle={-Math.PI * 25 / 180} maxAzimuthAngle={Math.PI * 25 / 180} maxPolarAngle={Math.PI * 67 / 180} minPolarAngle={Math.PI / 5} onChange={() => {
    if (!suppressCoverageRef.current && !moveRef.current && !focusWorkspaceId) {
      const controls = controlsRef.current;
      if (cityGroundCoversViewport(camera, layout.length)) {
        lastCoveredPoseRef.current = {
          position: camera.position.toArray() as [number, number, number],
          target: controls?.target.toArray() as [number, number, number] ?? [0, 0, 0],
          zoom: camera.zoom
        };
      } else if (controls) {
        // 只回退到上一个仍能覆盖地图的视角；允许用户在安全范围内继续旋转和缩放。
        const pose = lastCoveredPoseRef.current;
        suppressCoverageRef.current = true;
        if (pose) {
          camera.position.set(...pose.position);
          camera.zoom = pose.zoom;
          controls.target.set(...pose.target);
        }
        camera.updateProjectionMatrix();
        if (!pose || !cityGroundCoversViewport(camera, layout.length)) {
          camera.position.copy(CAMERA_OFFSET);
          camera.zoom = fitZoom;
          camera.updateProjectionMatrix();
          controls.target.copy(EMPTY_CITY_TARGET);
        }
        controls.update();
        suppressCoverageRef.current = false;
      }
    }
    invalidate();
  }} onEnd={() => {
    if (moveRef.current || focusWorkspaceId) return;
    const pose: CityCameraPose = { position: camera.position.toArray() as [number, number, number], target: controlsRef.current?.target.toArray() as [number, number, number] ?? [0, 0, 0], zoom: camera.zoom };
    lastCityPoseRef.current = pose;
    onPoseChange(pose);
  }} />;
}

function CityGlassCanopy({ tone, focused, hovered }: { tone: string; focused: boolean; hovered: boolean }) {
  const radius = 2.12;
  const baseY = 0.18;
  const wallHeight = 0.64;
  const domeHeight = 1.38;
  const shoulderY = baseY + wallHeight;
  const ringPoints = useMemo<[number, number, number][]>(() => Array.from({ length: 73 }, (_, index) => {
    const angle = index / 72 * Math.PI * 2;
    return [Math.cos(angle) * radius, baseY, Math.sin(angle) * radius];
  }), []);
  const outerUniforms = useMemo(() => ({
    uColor: { value: new THREE.Color(tone) },
    uBaseOpacity: { value: focused ? 0.046 : hovered ? 0.038 : 0.029 },
    uEdgeOpacity: { value: focused ? 0.43 : hovered ? 0.35 : 0.28 }
  }), [focused, hovered, tone]);
  const innerUniforms = useMemo(() => ({
    uColor: { value: new THREE.Color(tone).lerp(new THREE.Color("#f7ffff"), 0.48) },
    uBaseOpacity: { value: focused ? 0.05 : hovered ? 0.04 : 0.03 },
    uEdgeOpacity: { value: focused ? 0.2 : hovered ? 0.17 : 0.13 }
  }), [focused, hovered, tone]);

  return <group>
    <mesh position={[0, baseY + wallHeight / 2, 0]} renderOrder={4} raycast={() => undefined}>
      <cylinderGeometry args={[radius * 0.985, radius * 0.985, wallHeight * 0.985, 72, 1, true]} />
      <shaderMaterial uniforms={innerUniforms} vertexShader={CRYSTAL_GLASS_VERTEX_SHADER} fragmentShader={CRYSTAL_INNER_GLOW_FRAGMENT_SHADER} transparent blending={THREE.NormalBlending} side={THREE.BackSide} depthWrite={false} toneMapped={false} />
    </mesh>
    <mesh position={[0, shoulderY, 0]} scale={[radius * 0.985, domeHeight * 0.985, radius * 0.985]} renderOrder={4} raycast={() => undefined}>
      <sphereGeometry args={[1, 72, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
      <shaderMaterial uniforms={innerUniforms} vertexShader={CRYSTAL_GLASS_VERTEX_SHADER} fragmentShader={CRYSTAL_INNER_GLOW_FRAGMENT_SHADER} transparent blending={THREE.NormalBlending} side={THREE.BackSide} depthWrite={false} toneMapped={false} />
    </mesh>
    <mesh position={[0, baseY + wallHeight / 2, 0]} renderOrder={5} raycast={() => undefined}>
      <cylinderGeometry args={[radius, radius, wallHeight, 72, 1, true]} />
      <shaderMaterial uniforms={outerUniforms} vertexShader={CRYSTAL_GLASS_VERTEX_SHADER} fragmentShader={CRYSTAL_GLASS_FRAGMENT_SHADER} transparent blending={THREE.AdditiveBlending} side={THREE.FrontSide} depthWrite={false} toneMapped={false} />
    </mesh>
    <mesh position={[0, shoulderY, 0]} scale={[radius, domeHeight, radius]} renderOrder={5} raycast={() => undefined}>
      <sphereGeometry args={[1, 72, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
      <shaderMaterial uniforms={outerUniforms} vertexShader={CRYSTAL_GLASS_VERTEX_SHADER} fragmentShader={CRYSTAL_GLASS_FRAGMENT_SHADER} transparent blending={THREE.AdditiveBlending} side={THREE.FrontSide} depthWrite={false} toneMapped={false} />
    </mesh>
    <Line points={ringPoints} color={tone} lineWidth={focused ? 2.7 : hovered ? 2.15 : 1.65} transparent opacity={focused ? 0.92 : hovered ? 0.76 : 0.58} depthWrite={false} raycast={() => undefined} />
  </group>;
}

function CityRimLabel({ name, tone, focused, hovered }: { name: string; tone: string; focused: boolean; hovered: boolean }) {
  // 全名留在底座前沿，长名称只压缩字宽；底部导航和悬停提示负责远景可读性。
  const width = THREE.MathUtils.clamp(2.15 + name.length * 0.09, 2.45, 3.65);
  const highlighted = focused || hovered;
  return <group position={[0, -0.015, 2.45]}>
    <RoundedBox args={[width + 0.09, 0.65, 0.09]} radius={0.065} smoothness={4} position={[0, 0, -0.045]}>
      <meshBasicMaterial color={tone} transparent opacity={highlighted ? 0.56 : 0.27} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </RoundedBox>
    <RoundedBox args={[width, 0.57, 0.12]} radius={0.055} smoothness={4} castShadow>
      <meshPhysicalMaterial color="#e0e9e8" emissive={tone} emissiveIntensity={highlighted ? 0.1 : 0.02} roughness={0.39} metalness={0.13} clearcoat={0.72} clearcoatRoughness={0.18} />
    </RoundedBox>
    <RoundedBox args={[width - 0.09, 0.49, 0.027]} radius={0.04} smoothness={3} position={[0, 0, 0.072]}>
      <meshStandardMaterial color={highlighted ? "#ffffff" : "#f2f8f7"} roughness={0.5} metalness={0} />
    </RoundedBox>
    <SignFace text={name} width={width - 0.23} height={0.45} color="#26464e" position={[0, 0.004, 0.09]} />
  </group>;
}

function CityDistrict({ item, focused, disabled, onSelect, onHover }: {
  item: CityLayout;
  focused: boolean;
  disabled: boolean;
  onSelect: (workspaceId: string) => void;
  onHover: (workspaceId: string | null) => void;
}) {
  const { workspace, position } = item;
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && !disabled);
  const state = operatorCityWorkspaceState(workspace);
  const tone = OPERATOR_CITY_STATE_TONE[state];
  const active = workspace.activeExecutions > 0;
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ringRef.current || !active) return;
    const pulse = (Math.sin(clock.elapsedTime * 2.5) + 1) / 2;
    ringRef.current.scale.setScalar(1 + pulse * 0.07);
    const material = ringRef.current.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = 0.18 + pulse * 0.5;
  });
  const visibleAgents = Math.min(workspace.agentsTotal, 5);

  return <group position={position} scale={1.1} onPointerOver={(event) => { event.stopPropagation(); setHovered(true); onHover(workspace.serverId); }} onPointerOut={(event) => { event.stopPropagation(); setHovered(false); onHover(null); }} onClick={(event) => { event.stopPropagation(); if (!disabled) onSelect(workspace.serverId); }}>
    <mesh position={[0, -0.13, 0]} receiveShadow castShadow>
      <cylinderGeometry args={[2.35, 2.53, 0.35, 72]} />
      <meshStandardMaterial color="#e4ebed" roughness={0.76} metalness={0.08} />
    </mesh>
    <mesh position={[0, 0.09, 0]} receiveShadow>
      <cylinderGeometry args={[2.25, 2.33, 0.12, 72]} />
      <meshStandardMaterial color="#f9fcfc" roughness={0.68} />
    </mesh>
    <mesh ref={ringRef} position={[0, 0.18, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[2.12, focused || hovered ? 0.07 : 0.045, 8, 80]} />
      <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={active ? 0.18 : 0.04} roughness={0.36} />
    </mesh>
    <CityGlassCanopy tone={tone} focused={focused} hovered={hovered} />
    <mesh position={[0, 0.9, -0.58]} castShadow>
      <cylinderGeometry args={[0.3, 0.49, 1.64, 12]} />
      <meshStandardMaterial color="#9fbfc1" metalness={0.24} roughness={0.44} />
    </mesh>
    <mesh position={[0, 1.83, -0.58]}>
      <sphereGeometry args={[0.25, 16, 12]} />
      <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={active ? 0.72 : 0.16} />
    </mesh>
    {Array.from({ length: Math.min(workspace.devicesTotal, 3) }, (_, index) => <RoundedBox key={`device-${index}`} position={[-0.96 + index * 0.67, 0.37, 0.58]} args={[0.52, 0.47, 0.58]} radius={0.07} smoothness={3} castShadow>
      <meshStandardMaterial color={index < workspace.devicesOnline ? "#b4cbd0" : "#d8dddd"} roughness={0.62} />
    </RoundedBox>)}
    {Array.from({ length: visibleAgents }, (_, index) => {
      const x = -0.98 + index * 0.49;
      return <mesh key={`agent-${index}`} position={[x, 0.35, 1.28]} castShadow>
        <cylinderGeometry args={[0.12, 0.16, 0.32, 10]} />
        <meshStandardMaterial color={index < workspace.agentsOnline ? tone : "#afbdc2"} roughness={0.52} />
      </mesh>;
    })}
    <CityRimLabel name={workspace.serverName} tone={tone} focused={focused} hovered={hovered} />
    {(hovered || focused) && <Html center position={[0, 2.55, 0]} style={{ pointerEvents: "none" }}>
      <div className="operator-city-scene-status"><strong>{workspace.serverName}</strong><span>{state === "attention" ? `${workspace.waitingApprovals} awaiting approval` : state === "active" ? `${workspace.activeExecutions} active` : state === "offline" ? "Offline" : `${workspace.agentsOnline}/${workspace.agentsTotal} Agents online`}</span></div>
    </Html>}
  </group>;
}

function CityBridge({ from, to, fromId, toId, layout, oneWay, emphasized }: { from: THREE.Vector3; to: THREE.Vector3; fromId: string; toId: string; layout: CityLayout[]; oneWay: boolean; emphasized: boolean }) {
  const bridge = useMemo(() => {
    const dockDirection = (center: THREE.Vector3, other: THREE.Vector3) => {
      const radial = other.clone().sub(center).setY(0).normalize();
      // 朝前方的连接改从侧面入站，避免玻璃通道遮挡底座前沿的 Workspace 门牌。
      return radial.z > 0.35 && Math.abs(radial.x) < 0.9
        ? new THREE.Vector3(center.x >= 0 ? -0.85 : 0.85, 0, 0.53).normalize()
        : radial;
    };
    const startDirection = dockDirection(from, to);
    const endDirection = dockDirection(to, from);
    // 桥面伸入底座顶部，入口框与环形边缘相接；两端先沿径向驶离底座再转弯。
    const start = from.clone().addScaledVector(startDirection, 2.42).setY(0.2);
    const end = to.clone().addScaledVector(endDirection, 2.42).setY(0.2);
    const direction = end.clone().sub(start).normalize();
    const midpoint = start.clone().lerp(end, 0.5);
    const outward = new THREE.Vector3(-direction.z, 0, direction.x);
    if (midpoint.clone().add(outward).lengthSq() < midpoint.clone().sub(outward).lengthSq()) outward.negate();
    const obstacles = layout.filter((item) => item.workspace.serverId !== fromId && item.workspace.serverId !== toId).map((item) => item.position);
    const clearanceSq = 4 ** 2;
    const initialOffset = Math.min(1.35, start.distanceTo(end) * 0.13);
    const route = (side: THREE.Vector3, offset: number) => new THREE.CatmullRomCurve3([
      start, start.clone().addScaledVector(startDirection, 1.4), midpoint.clone().addScaledVector(side, offset),
      end.clone().addScaledVector(endDirection, 1.4), end
    ], false, "centripetal", 0.5);
    let curve = route(outward, initialOffset);
    // 在避开底座和门牌的候选路线中选择较短路径，避免长弧形通道跑出城市画面。
    const clearCurves: THREE.CatmullRomCurve3[] = [];
    for (const side of [outward, outward.clone().negate()]) {
      for (let offset = initialOffset; offset <= start.distanceTo(end) * 2 + 4; offset += 0.5) {
        const candidate = route(side, offset);
        if (candidate.getPoints(80).every((point) =>
          obstacles.every((obstacle) => (point.x - obstacle.x) ** 2 + (point.z - obstacle.z) ** 2 >= clearanceSq) &&
          // 每块门牌都在底座前沿；路径和入口均需避开门牌本体及通道宽度。
          layout.every((item) => {
            const labelHalfWidth = THREE.MathUtils.clamp(2.15 + item.workspace.serverName.length * 0.09, 2.45, 3.65) * 0.55 + 0.6;
            return Math.abs(point.x - item.position.x) >= labelHalfWidth || point.z - item.position.z <= 1.5 || point.z - item.position.z >= 4.7;
          })
        )) {
          clearCurves.push(candidate);
          break;
        }
      }
    }
    if (clearCurves.length) curve = clearCurves.sort((a, b) => a.getLength() - b.getLength())[0];
    const points = curve.getPoints(40);
    const left = points.map((point, index) => {
      const tangent = curve.getTangent(index / 40).normalize();
      return point.clone().add(new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(0.4));
    });
    const right = points.map((point, index) => point.clone().multiplyScalar(2).sub(left[index]));
    const strip = (lower: THREE.Vector3[], upper: THREE.Vector3[]) => {
      const positions: number[] = [];
      const indices: number[] = [];
      for (let index = 0; index < lower.length; index += 1) {
        positions.push(...lower[index].toArray(), ...upper[index].toArray());
        if (index < lower.length - 1) {
          const vertex = index * 2;
          indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return geometry;
    };
    const deck = strip(left, right);
    const leftWall = strip(left, left.map((point) => point.clone().setY(0.75)));
    const rightWall = strip(right, right.map((point) => point.clone().setY(0.75)));
    const leftRail = left.map((point) => point.clone().setY(0.75));
    const rightRail = right.map((point) => point.clone().setY(0.75));
    const portalRotation = (t: number) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), curve.getTangent(t).normalize());
    const arrowRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(0.7).normalize());
    const ribs = [8, 16, 24, 32].map((index) => [left[index], leftRail[index], rightRail[index], right[index]]);
    const dockRotation = (direction: THREE.Vector3) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    return { deck, leftWall, rightWall, leftRail, rightRail, left, right, ribs, start, end, startDirection, endDirection, startDockRotation: dockRotation(startDirection), endDockRotation: dockRotation(endDirection), startRotation: portalRotation(0), endRotation: portalRotation(1), marker: curve.getPoint(0.7).setY(0.25), arrowRotation };
  }, [from, to, fromId, toId, layout]);

  useEffect(() => () => {
    bridge.deck.dispose();
    bridge.leftWall.dispose();
    bridge.rightWall.dispose();
  }, [bridge]);

  return <group>
    {[0, 1].map((endIndex) => <RoundedBox key={`dock-${endIndex}`} args={[0.91, 0.075, 0.65]} radius={0.04} smoothness={3} position={(endIndex ? bridge.end : bridge.start).clone().addScaledVector(endIndex ? bridge.endDirection : bridge.startDirection, 0.035).setY(0.205)} quaternion={endIndex ? bridge.endDockRotation : bridge.startDockRotation} raycast={() => undefined}>
      <meshStandardMaterial color="#d9e9eb" metalness={0.25} roughness={0.38} />
    </RoundedBox>)}
    <mesh geometry={bridge.deck} renderOrder={1} raycast={() => undefined}>
      <meshPhysicalMaterial color="#bad8e1" roughness={0.28} metalness={0.12} clearcoat={0.8} transparent opacity={emphasized ? 0.94 : 0.84} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
    <mesh geometry={bridge.leftWall} renderOrder={2} raycast={() => undefined}>
      <meshPhysicalMaterial color="#8dbbc8" roughness={0.18} metalness={0.06} transparent opacity={emphasized ? 0.42 : 0.31} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
    <mesh geometry={bridge.rightWall} renderOrder={2} raycast={() => undefined}>
      <meshPhysicalMaterial color="#8dbbc8" roughness={0.18} metalness={0.06} transparent opacity={emphasized ? 0.42 : 0.31} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
    <Line points={bridge.left} color="#628f9d" lineWidth={emphasized ? 2.4 : 1.8} transparent opacity={emphasized ? 0.96 : 0.8} depthWrite={false} raycast={() => undefined} />
    <Line points={bridge.right} color="#628f9d" lineWidth={emphasized ? 2.4 : 1.8} transparent opacity={emphasized ? 0.96 : 0.8} depthWrite={false} raycast={() => undefined} />
    <Line points={bridge.leftRail} color="#8db8c5" lineWidth={emphasized ? 2.3 : 1.8} transparent opacity={emphasized ? 0.98 : 0.88} depthWrite={false} raycast={() => undefined} />
    <Line points={bridge.rightRail} color="#8db8c5" lineWidth={emphasized ? 2.3 : 1.8} transparent opacity={emphasized ? 0.98 : 0.88} depthWrite={false} raycast={() => undefined} />
    {bridge.ribs.map((rib, index) => <Line key={index} points={rib} color="#93bfcb" lineWidth={emphasized ? 1.7 : 1.3} transparent opacity={emphasized ? 0.72 : 0.51} depthWrite={false} raycast={() => undefined} />)}
    {[0, 1].map((endIndex) => <group key={endIndex} position={(endIndex ? bridge.end : bridge.start).clone().setY(0.47)} quaternion={endIndex ? bridge.endRotation : bridge.startRotation}>
      <mesh renderOrder={3} raycast={() => undefined}>
        <torusGeometry args={[0.42, 0.055, 8, 32]} />
        <meshStandardMaterial color="#9bc9d4" emissive="#9ccdda" emissiveIntensity={emphasized ? 0.28 : 0.12} metalness={0.42} roughness={0.28} transparent opacity={emphasized ? 0.98 : 0.9} depthWrite={false} />
      </mesh>
    </group>)}
    {oneWay && <mesh position={bridge.marker} quaternion={bridge.arrowRotation} renderOrder={3} raycast={() => undefined}>
      <coneGeometry args={[0.105, 0.27, 8]} />
      <meshBasicMaterial color="#568da1" transparent opacity={emphasized ? 0.94 : 0.75} depthWrite={false} />
    </mesh>}
  </group>;
}

export function OperatorCityScene({ overview, focusWorkspaceId, returnFromWorkspaceId, initialPose, resetViewSignal, onPoseChange, disabled, onSelect, onFocusComplete }: {
  overview: PlatformOperatorCityOverviewPayload;
  focusWorkspaceId: string | null;
  returnFromWorkspaceId: string | null;
  initialPose: CityCameraPose | null;
  resetViewSignal: number;
  onPoseChange: (pose: CityCameraPose) => void;
  disabled: boolean;
  onSelect: (workspaceId: string) => void;
  onFocusComplete: (workspaceId: string) => void;
}) {
  const layout = useMemo(() => cityLayout(overview.workspaces), [overview.workspaces]);
  const byId = useMemo(() => new Map(layout.map((item) => [item.workspace.serverId, item.position])), [layout]);
  const [hoveredWorkspaceId, setHoveredWorkspaceId] = useState<string | null>(null);
  const highlightedWorkspaceId = focusWorkspaceId ?? hoveredWorkspaceId;
  const active = overview.workspaces.some((workspace) => workspace.activeExecutions > 0);
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return <Canvas orthographic dpr={[1, 1.7]} frameloop={active && !reducedMotion ? "always" : "demand"} camera={{ position: CAMERA_OFFSET.toArray(), zoom: 28, near: 0.1, far: 100 }} gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }} shadows>
    <color attach="background" args={["#eaf2f4"]} />
    <ambientLight intensity={0.83} />
    <hemisphereLight args={["#ffffff", "#c6d9df", 0.68]} />
    <directionalLight position={[-8, 18, 10]} intensity={1.65} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
    {/* 贴图加载只暂停地面层，避免 R3F 将整个 Canvas 挂到外层加载边界。 */}
    <Suspense fallback={null}>
      <SpatialAtlasGround src={cityOutskirtsUrl} width={90 * Math.max(1, overview.workspaces.length / 6)} depth={45 * Math.max(1, overview.workspaces.length / 6)} y={-0.37} opacity={0.72} centerCutout={68 / 90} fadeFraction={0.04} renderOrder={-2} />
      <SpatialAtlasGround src={cityAtlasGroundUrl} width={68 * Math.max(1, overview.workspaces.length / 6)} depth={34 * Math.max(1, overview.workspaces.length / 6)} y={-0.35} opacity={0.72} fadeEdges fadeFraction={0.04} />
    </Suspense>
    {overview.bridges.map((bridge) => {
      // 城市连线只使用服务端返回的 active Bridge，不能从视觉邻近推断连接。
      const from = byId.get(bridge.workspaceAId);
      const to = byId.get(bridge.workspaceBId);
      return from && to ? <CityBridge key={bridge.id} from={from} to={to} fromId={bridge.workspaceAId} toId={bridge.workspaceBId} layout={layout} oneWay={bridge.direction === "one_way"} emphasized={highlightedWorkspaceId === bridge.workspaceAId || highlightedWorkspaceId === bridge.workspaceBId} /> : null;
    })}
    {layout.map((item) => <CityDistrict key={item.workspace.serverId} item={item} focused={focusWorkspaceId === item.workspace.serverId} disabled={disabled || Boolean(focusWorkspaceId)} onSelect={onSelect} onHover={setHoveredWorkspaceId} />)}
    <CityCamera layout={layout} focusWorkspaceId={focusWorkspaceId} returnFromWorkspaceId={returnFromWorkspaceId} initialPose={initialPose} resetViewSignal={resetViewSignal} onPoseChange={onPoseChange} onFocusComplete={onFocusComplete} />
  </Canvas>;
}
