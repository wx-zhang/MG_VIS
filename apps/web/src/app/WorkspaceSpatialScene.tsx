import { ReferenceOfficeLighting, ReferenceTownContext, ReferenceOfficeShell, ReferenceDeviceRoom, ReferenceWorkDesk } from "./ReferenceOfficeModels";
import {
  Billboard,
  Html,
  Line,
  OrbitControls,
  RoundedBox,
  useCursor
} from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import type { TopologyBridgeJourneyRecord } from "@tyr-ai/contracts";
import {
  Fragment,
  Suspense,
  createContext,
  useContext,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type RefObject
} from "react";
import * as THREE from "three";
import workspaceAtlasGroundUrl from "../assets/workspace-atlas-ground-paved.webp";
import { topologyLiveActivityLabelForWorkspace } from "../livingTopologyActivity";
import { SpatialAtlasGround } from "./SpatialAtlasGround";
import { CRYSTAL_GLASS_FRAGMENT_SHADER, CRYSTAL_GLASS_VERTEX_SHADER, CRYSTAL_INNER_GLOW_FRAGMENT_SHADER, SignFace } from "./WorkspaceGlassVisual";
import {
  LIVING_TOPOLOGY_PALETTE,
  resolveLivingTopologyNodeState
} from "../livingTopologyNodeState";
import {
  workspaceSpatialAgentHasBridgeActivity,
  workspaceSpatialAgentNameSegments,
  workspaceSpatialSceneHasMessageAttention,
  workspaceSpatialSceneNeedsAnimation
} from "../workspaceSpatial";
import { workspaceSpatialFramePolicy } from "../workspaceSpatialFramePolicy";
import {
  workspaceSpatialAgentTextModes,
  type WorkspaceSpatialAgentTextMode
} from "../workspaceSpatialLabels";
import {
  workspaceSpatialAmbientAssignments,
  workspaceSpatialAmbientCadence,
  workspaceSpatialCancelAmbientAssignments,
  workspaceSpatialAmbientEligibilityKey,
  workspaceSpatialAmbientIsActive,
  workspaceSpatialAmbientUsesRefreshPoint,
  workspaceSpatialAmbientUsesUtilityPoint,
  type WorkspaceSpatialAmbientAssignment,
  type WorkspaceSpatialAmbientCadence
} from "../workspaceSpatialAmbient";
import {
  workspaceSpatialAgentMotion,
  workspaceSpatialAgentNodeState,
  workspaceSpatialTerminalDurationMs,
  type WorkspaceSpatialAgentMotion,
  type WorkspaceSpatialMotionMarker
} from "../workspaceSpatialMotion";
import { workspaceSpatialAgentAttention } from "../workspaceSpatialAttention";
import {
  WORKSPACE_SPATIAL_CHAIN_COMPACT_PACKET_DURATION_SECONDS,
  WORKSPACE_SPATIAL_CHAIN_PACKET_DURATION_SECONDS,
  workspaceSpatialMessageJourneySignals,
  type WorkspaceSpatialMessageJourneySignal
} from "../workspaceSpatialChoreography";
import {
  workspaceSpatialBridgeMechanic,
  workspaceSpatialBridgeHandoffFrame,
  workspaceSpatialRoomMechanic,
  workspaceSpatialRoomOperationalRhythm,
  type WorkspaceSpatialBridgeMechanic,
  type WorkspaceSpatialRoomOperationalRhythm
} from "../workspaceSpatialMechanics";
import {
  WORKSPACE_SPATIAL_ARRIVAL_SETTLE_MS,
  WORKSPACE_SPATIAL_STAND_TRANSITION_MS,
  WORKSPACE_SPATIAL_TURN_ALIGNMENT_RADIANS,
  workspaceSpatialHeadingDelta,
  workspaceSpatialLocomotionSpeed,
  workspaceSpatialLocomotionTarget,
  workspaceSpatialRoomWaypoints,
  workspaceSpatialStationYaw,
  workspaceSpatialWaypointRoute,
  type WorkspaceSpatialLocomotionStation,
  type WorkspaceSpatialPoint,
  type WorkspaceSpatialRoomWaypoints
} from "../workspaceSpatialLocomotion";
import { workspaceSpatialStretchPose } from "../workspaceSpatialPose";
import { workspaceSpatialArrivalPose, workspaceSpatialWalkPose, workspaceSpatialWorkPose } from "../workspaceSpatialPerformance";
import {
  WORKSPACE_SPATIAL_BRIDGE_EFFECT_PHASE_SECONDS,
  WORKSPACE_SPATIAL_BRIDGE_RIVER_PHASE_SECONDS,
  WORKSPACE_SPATIAL_BRIDGE_RIVER_TRAVEL_SECONDS,
  WORKSPACE_SPATIAL_BRIDGE_WORKER_HANDOFF_SECONDS,
  WORKSPACE_SPATIAL_BRIDGE_WORKER_RIVER_SECONDS,
  workspaceSpatialBridgeTransitDurationSeconds,
  workspaceSpatialBridgeTransitPhaseAt,
  workspaceSpatialBridgeTransitRoute,
  workspaceSpatialBridgeTransitSegments,
  workspaceSpatialBridgeWorkerDelaySeconds,
  type WorkspaceSpatialBridgeTransitPhase,
  type WorkspaceSpatialBridgeTransitPoint,
  type WorkspaceSpatialBridgeTransitRoute
} from "../workspaceSpatialBridgeTransit";
import {
  workspaceSpatialBridgeJourneyConsoleLabel,
  workspaceSpatialBridgeJourneyHasActiveConsoleStatus,
  workspaceSpatialBridgeJourneyRouteSegment,
  workspaceSpatialBridgeJourneyRoutePoints,
  workspaceSpatialBridgeJourneyTone,
  type WorkspaceSpatialBridgeJourneyRouteSegment
} from "../workspaceSpatialBridgeJourney";
import {
  readWorkspaceSpatialVisits, saveWorkspaceSpatialVisits, reconcileWorkspaceSpatialVisits,
  workspaceSpatialAgentVisits, workspaceSpatialVisitFrame, workspaceSpatialVisitInitialState,
  workspaceSpatialVisitLabel, workspaceSpatialVisitCanReceive, workspaceSpatialVisitExchangePose,
  workspaceSpatialSelectBridgeCloneCandidates, workspaceSpatialVisitActorLabel,
  workspaceSpatialVisitBubbleMode, workspaceSpatialVisitSecondaryLabel,
  WORKSPACE_SPATIAL_VISIT_HANDOFF_MS, WORKSPACE_SPATIAL_LOCAL_VISIT_HANDOFF_MS,
  type WorkspaceSpatialVisitFact, type WorkspaceSpatialVisitState, type WorkspaceSpatialAgentVisit
} from "../workspaceSpatialVisitJourney";
import {
  readPlayedWorkspaceSpatialHumanJourneys,
  readWorkspaceSpatialHumanJourneyCheckpoint,
  savePlayedWorkspaceSpatialHumanJourneys,
  saveWorkspaceSpatialHumanJourneyCheckpoint,
  workspaceSpatialHumanJourneyFrame,
  workspaceSpatialHumanJourneyInitialState,
  workspaceSpatialHumanJourneyLabel,
  WORKSPACE_SPATIAL_HUMAN_HANDOFF_MS,
  type WorkspaceSpatialHumanJourney,
  type WorkspaceSpatialHumanJourneyState
} from "../workspaceSpatialHumanJourney";
import {
  workspaceSpatialRuntimeRelay,
  workspaceSpatialRuntimeRelayCanHandoff,
  workspaceSpatialRuntimeRelayFrame,
  type WorkspaceSpatialRuntimeRelay as WorkspaceSpatialRuntimeRelayState,
  type WorkspaceSpatialRuntimeRelayStation
} from "../workspaceSpatialRuntimeRelay";
import {
  WORKSPACE_SPATIAL_PAIR_HANDOFF_EXCHANGE_END_MS,
  WORKSPACE_SPATIAL_PAIR_HANDOFF_EXCHANGE_START_MS,
  workspaceSpatialPairHandoff,
  workspaceSpatialPairHandoffDock,
  workspaceSpatialPairHandoffPhase,
  workspaceSpatialPairHandoffRoleForAgent,
  type WorkspaceSpatialPairHandoff as WorkspaceSpatialPairHandoffState,
  type WorkspaceSpatialPairHandoffRole
} from "../workspaceSpatialPairHandoff";
import {
  WORKSPACE_SPATIAL_PARALLEL_DISPATCH_FANOUT_END_MS,
  WORKSPACE_SPATIAL_PARALLEL_DISPATCH_FANOUT_START_MS,
  WORKSPACE_SPATIAL_PARALLEL_DISPATCH_RECEIPT_END_MS,
  WORKSPACE_SPATIAL_PARALLEL_DISPATCH_TARGET_STAGGER_MS,
  workspaceSpatialParallelDispatch,
  workspaceSpatialParallelDispatchPhase,
  workspaceSpatialParallelDispatchTargetIndex,
  type WorkspaceSpatialParallelDispatch as WorkspaceSpatialParallelDispatchState
} from "../workspaceSpatialParallelDispatch";
import {
  WORKSPACE_SPATIAL_RESULT_CONVERGENCE_COLLECT_END_MS,
  WORKSPACE_SPATIAL_RESULT_CONVERGENCE_COLLECT_START_MS,
  WORKSPACE_SPATIAL_RESULT_CONVERGENCE_MERGE_END_MS,
  WORKSPACE_SPATIAL_RESULT_CONVERGENCE_RELAY_END_MS,
  WORKSPACE_SPATIAL_RESULT_CONVERGENCE_STAGGER_MS,
  workspaceSpatialResultContributionIndex,
  workspaceSpatialResultConvergence,
  workspaceSpatialResultConvergencePhase,
  workspaceSpatialResultRecipient,
  type WorkspaceSpatialResultConvergence as WorkspaceSpatialResultConvergenceState
} from "../workspaceSpatialResultConvergence";
import {
  WORKSPACE_SPATIAL_CROSS_ROOM_RECEIPT_REACH_MS,
  WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_ARRIVAL_MS,
  WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_START_MS,
  workspaceSpatialCrossRoomResultRelay,
  workspaceSpatialCrossRoomResultRelayPhase,
  type WorkspaceSpatialCrossRoomResultRelay as WorkspaceSpatialCrossRoomResultRelayState
} from "../workspaceSpatialCrossRoomResultRelay";
import type {
  WorkspaceSpatialAgent,
  WorkspaceSpatialBridge,
  WorkspaceSpatialDensity,
  WorkspaceSpatialFlowSignal,
  WorkspaceSpatialRoom,
  WorkspaceSpatialScene,
  WorkspaceSpatialWorkspace
} from "../workspaceSpatial";
import type { BridgeCommunicationFlowSignal, CommunicationFlowTone } from "../communicationFlow";
import {
  workspaceSpatialSelectionKey,
  type WorkspaceSpatialSelection
} from "../workspaceSpatialInteraction";

export type { WorkspaceSpatialSelection } from "../workspaceSpatialInteraction";

export type WorkspaceSpatialSceneHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  focus: () => void;
  focusTarget: (selection: WorkspaceSpatialSelection) => void;
  focusChain: (chainId: string) => void;
  focusBridgeMessage: (bridgeId: string) => void;
  resetAngle: () => void;
};

type SceneLayoutRoom = {
  room: WorkspaceSpatialRoom;
  theme: DeviceVisualTheme;
  x: number;
  z: number;
  width: number;
  depth: number;
};

type SceneLayoutWorkspace = {
  workspace: WorkspaceSpatialWorkspace;
  theme: WorkspaceVisualTheme;
  x: number;
  z: number;
  radius: number;
  width: number;
  depth: number;
  rooms: SceneLayoutRoom[];
};

type WorkspaceVisualTheme = {
  accent: string;
  base: string;
  surface: string;
};

type DeviceVisualTheme = {
  accent: string;
  floor: string;
  wall: string;
};

type SceneLayoutBridge = {
  bridge: WorkspaceSpatialBridge;
  x: number;
  z: number;
  length: number;
  rotationY: number;
  labelPosition: [number, number, number];
  sourceController?: [number, number, number];
  targetController?: [number, number, number];
  sourceGateway: [number, number, number];
  targetGateway: [number, number, number];
};

type SceneLayout = {
  workspaces: SceneLayoutWorkspace[];
  bridges: SceneLayoutBridge[];
  focusByKey: Map<string, THREE.Vector3>;
  chainFocusById: Map<string, { target: THREE.Vector3; zoom: number }>;
  fitZoom: number;
};

const HOME_CAMERA = new THREE.Vector3(25, 23, 29);
const HOME_TARGET = new THREE.Vector3(0, 0, 0);
const MIN_ORBIT_POLAR_ANGLE = Math.PI * 0.16;
const MAX_ORBIT_POLAR_ANGLE = Math.PI * 0.48;
const MIN_SCENE_ZOOM = 7;
const MAX_SCENE_ZOOM = 68;
const ROOM_WIDTH = 5.35;
const ROOM_DEPTH = 4.55;
const ROOM_GAP = 0.78;
const ORDINARY_AGENT_SCALE_BY_DENSITY: Record<WorkspaceSpatialDensity, { standing: number; seated: number }> = {
  standard: { standing: 1.21, seated: 1.15 },
  expanded: { standing: 1.16, seated: 1.1 },
  compact: { standing: 1.03, seated: 0.98 },
  cluster: { standing: 0.97, seated: 0.92 }
};
const ORDINARY_AGENT_STATUS_RING_MAX_SCALE = 1.02;
const MAX_COMPLETED_BRIDGE_JOURNEY_VISUAL_IDS = 1_000;
const WOOD_SIGN_TEXT = "#49372d";
const BRIDGE_SIGN_TEXT = "#f3e4c6";
const BRIDGE_JOURNEY_VISUAL_PRIORITY: Record<TopologyBridgeJourneyRecord["phase"], number> = {
  waiting_approval: 0,
  running: 1,
  returning: 2,
  received: 3,
  dispatching: 4,
  failed: 5,
  completed: 6,
  cancelled: 7
};
const FLOW_COLORS: Record<CommunicationFlowTone, string> = {
  request: "#00b7ff",
  response: "#24f0a4",
  error: "#ff355e"
};
const MESSAGE_RIVER_COLORS: Record<CommunicationFlowTone, string> = {
  request: "#46bde9",
  response: "#46bde9",
  error: "#ff7084"
};
const MESSAGE_RIVER_CENTER_COLORS: Record<CommunicationFlowTone, string> = {
  request: "#65cef2",
  response: "#65cef2",
  error: "#ffadb8"
};
const MESSAGE_RIVER_GLOW_COLORS: Record<CommunicationFlowTone, string> = {
  request: "#6ad7fb",
  response: "#6ad7fb",
  error: "#ff9cad"
};
const MESSAGE_RIVER_BED_COLORS: Record<CommunicationFlowTone, string> = {
  request: "#78aabd",
  response: "#78aabd",
  error: "#bd8c95"
};
const MESSAGE_RIVER_WORLD_SPEED = 1.2;
const MESSAGE_RECEIPT_COLORS: Record<CommunicationFlowTone, string> = {
  request: "#55dcff",
  response: "#22e6a8",
  error: "#ff3b5c"
};
const MESSAGE_RIBBON_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const MESSAGE_RIBBON_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform vec3 uCenterColor;
  uniform float uOpacity;
  uniform float uSoftness;
  varying vec2 vUv;
  void main() {
    float lateral = abs(vUv.y - 0.5) * 2.0;
    float edge = 1.0 - smoothstep(1.0 - uSoftness, 1.0, lateral);
    float center = 1.0 - smoothstep(0.0, 0.78, lateral);
    vec3 channelColor = mix(uColor, uCenterColor, center * 0.24);
    float body = edge * (0.9 + center * 0.1);
    gl_FragColor = vec4(channelColor, uOpacity * body);
  }
`;
const MESSAGE_CHARGE_VERTEX_SHADER = `
  attribute float aSize;
  uniform float uPixelRatio;
  varying float vStrength;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    float perspective = clamp(8.0 / max(4.0, -viewPosition.z), 0.72, 1.12);
    gl_PointSize = aSize * uPixelRatio * perspective;
    gl_Position = projectionMatrix * viewPosition;
    vStrength = perspective;
  }
`;
const MESSAGE_CHARGE_FRAGMENT_SHADER = `
  uniform vec3 uCoreColor;
  uniform vec3 uHaloColor;
  uniform float uOpacity;
  varying float vStrength;
  void main() {
    float radius = distance(gl_PointCoord, vec2(0.5));
    if (radius > 0.5) discard;
    float core = 1.0 - smoothstep(0.12, 0.25, radius);
    float halo = 1.0 - smoothstep(0.23, 0.5, radius);
    vec3 color = mix(uHaloColor, uCoreColor, core);
    float alpha = (core + halo * 0.28) * uOpacity * vStrength;
    gl_FragColor = vec4(color, alpha);
  }
`;

type VisitMotionProgress = { state: RefObject<WorkspaceSpatialVisitState>; start: number; end: number };
type VisitBridgeSignal = BridgeCommunicationFlowSignal & { visitMotion?: VisitMotionProgress };
type RoutePulseSignal = {
  id: string;
  executionId?: string;
  bridgeRequestMessageId?: string;
  tone: CommunicationFlowTone;
  reverse: boolean;
  continuous: boolean;
  updatedAt?: string;
  delaySeconds?: number;
  durationSeconds?: number;
  visualLift?: number;
  energyPhaseOffset?: number;
  sharedLaneCount?: number;
  holdingAtTarget?: boolean;
  emphasized?: boolean;
  followPhysicalRoute?: boolean;
  visitMotion?: VisitMotionProgress;
  chainId?: string;
  chainStepIndex?: number;
  chainStepCount?: number;
  gapBefore?: boolean;
};

type AgentFigureLocomotion = {
  enabled: boolean;
  allowToolStation: boolean;
  waypoints: WorkspaceSpatialRoomWaypoints;
};

type BridgeTransitVisualRoute = {
  placedBridge: SceneLayoutBridge;
  route: WorkspaceSpatialBridgeTransitRoute;
};

type AgentFigurePairHandoff = {
  flowId: string;
  role: WorkspaceSpatialPairHandoffRole;
  point: WorkspaceSpatialPoint;
  startedAtMs: number;
  returnAtMs: number;
};

type AgentFigureParallelReceipt = {
  targetIndex: number;
  startedAtMs: number;
};

type AgentFigureResultContribution = {
  sourceIndex: number;
  startedAtMs: number;
};

type AgentFigureResultRecipient = {
  reachAtMs: number;
  receivedAtMs: number;
  endsAtMs: number;
};

type ResultConvergenceDestination = WorkspaceSpatialPoint & {
  kind: "gateway" | "agent";
  y: number;
};

type AgentLocomotionState = {
  key: string;
  station: WorkspaceSpatialLocomotionStation;
  route: WorkspaceSpatialPoint[];
  routeIndex: number;
  standAtMs: number;
  departAtMs: number;
  arrivedAtMs: number;
};

type AgentLocomotionTarget = {
  station: WorkspaceSpatialLocomotionStation;
  point: WorkspaceSpatialPoint;
};

const WORKSPACE_THEMES: WorkspaceVisualTheme[] = [
  { accent: "#27aa9e", base: "#b8cfcc", surface: "#e0f0ed" },
  { accent: "#477ddd", base: "#bdcbe0", surface: "#e2ebf9" },
  { accent: "#7b63c5", base: "#cbc2dc", surface: "#ece7f7" },
  { accent: "#c37c4d", base: "#d7c4b7", surface: "#f4e9e0" },
  { accent: "#bd607f", base: "#d5c0c9", surface: "#f3e5eb" },
  { accent: "#318da4", base: "#b9cdd2", surface: "#e1eef1" }
];

// Device 采用跨 Workspace 共用的室内材质色板，保证相邻房间在远景下仍有明确色差。
const DEVICE_THEMES: DeviceVisualTheme[] = [
  { accent: "#388b73", floor: "#a9d6c6", wall: "#dce9e4" },
  { accent: "#4c79ac", floor: "#afc9e5", wall: "#dce6ef" },
  { accent: "#a16e31", floor: "#e2c28e", wall: "#ece3d5" },
  { accent: "#7859a4", floor: "#c9b5e1", wall: "#e5dfed" },
  { accent: "#a85f76", floor: "#ddb7c4", wall: "#ebe0e4" },
  { accent: "#397f93", floor: "#acd0d9", wall: "#dce8eb" }
];

function useReducedSceneMotion(): boolean {
  return useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

function roomFootprint(room: WorkspaceSpatialRoom): { width: number; depth: number } {
  if (room.density === "expanded") return { width: 6.25, depth: 5.1 };
  if (room.density === "compact" || room.density === "cluster") return { width: 7.15, depth: 5.9 };
  return { width: ROOM_WIDTH, depth: ROOM_DEPTH };
}

function stableStringHash(value: string): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function deviceVisualTheme(workspaceId: string, variantIndex: number): DeviceVisualTheme {
  // 同一 Workspace 内按顺序轮换色板，Workspace id 只决定起始色，避免相邻 Device 撞色。
  return DEVICE_THEMES[(stableStringHash(workspaceId) + variantIndex) % DEVICE_THEMES.length];
}

function workspaceRoomCenters(roomCount: number, roomSpacing: number): Array<{ x: number; z: number }> {
  if (roomCount === 0) return [];
  if (roomCount === 1) return [{ x: 0, z: -0.42 }];
  if (roomCount <= 8) {
    // 少量 Device 使用完整圆环；数量继续增长时才增加同心环，避免单环直径失控。
    const ringRadius = roomSpacing / (2 * Math.sin(Math.PI / roomCount));
    return Array.from({ length: roomCount }, (_, index) => {
      const angle = roomCount === 2
        ? index * Math.PI
        : Math.PI / 2 + Math.PI / roomCount + index * Math.PI * 2 / roomCount;
      return { x: Math.cos(angle) * ringRadius, z: Math.sin(angle) * ringRadius };
    });
  }

  const ringRoomCounts: number[] = [];
  if (roomCount <= 18) {
    const innerRoomCount = Math.min(6, Math.max(3, Math.round(roomCount * 0.38)));
    ringRoomCounts.push(innerRoomCount, roomCount - innerRoomCount);
  } else {
    let ringCount = 3;
    while (3 * ringCount * (ringCount + 1) < roomCount) ringCount += 1;
    const totalRingWeight = ringCount * (ringCount + 1) / 2;
    let remaining = roomCount;
    for (let ringIndex = 1; ringIndex <= ringCount; ringIndex += 1) {
      const ringCapacity = 6 * ringIndex;
      const ringRoomCount = ringIndex === ringCount
        ? remaining
        : Math.min(ringCapacity, Math.max(1, Math.round(roomCount * ringIndex / totalRingWeight)));
      ringRoomCounts.push(ringRoomCount);
      remaining -= ringRoomCount;
    }
  }

  const centers: Array<{ x: number; z: number }> = [];
  let previousRingRadius = 0;
  ringRoomCounts.forEach((ringRoomCount, ringArrayIndex) => {
    const ringIndex = ringArrayIndex + 1;
    const chordRadius = roomSpacing / (2 * Math.sin(Math.PI / ringRoomCount));
    // 每一圈同时满足同圈间距与前后圈净距，避免少量新增 Device 让外圈突然过度膨胀。
    const ringRadius = Math.max(chordRadius, previousRingRadius + (ringIndex === 1 ? 0 : roomSpacing * 0.88));
    for (let slotIndex = 0; slotIndex < ringRoomCount; slotIndex += 1) {
      // 相邻圆环错开半个槽位，让 Device 墙体形成清晰的放射缝隙，不堆成矩形网格。
      const angle = Math.PI / 2 + Math.PI / ringRoomCount
        + slotIndex * Math.PI * 2 / ringRoomCount
        + (ringIndex % 2 === 0 ? Math.PI / ringRoomCount : 0);
      centers.push({ x: Math.cos(angle) * ringRadius, z: Math.sin(angle) * ringRadius });
    }
    previousRingRadius = ringRadius;
  });
  return centers;
}

function layoutWorkspace(
  workspace: WorkspaceSpatialWorkspace,
  visualIndex: number,
  x: number,
  z: number,
  compact: boolean
): SceneLayoutWorkspace {
  const roomCount = workspace.rooms.length;
  const roomFootprints = workspace.rooms.map(roomFootprint);
  const roomSpacing = Math.max(
    ROOM_WIDTH,
    ROOM_DEPTH,
    ...roomFootprints.flatMap((footprint) => [footprint.width, footprint.depth])
  ) + ROOM_GAP + 0.18;
  const roomCenters = workspaceRoomCenters(roomCount, roomSpacing);
  const rooms = workspace.rooms.map((room, index) => {
    const footprint = roomFootprints[index];
    const center = roomCenters[index];
    return {
      room,
      theme: deviceVisualTheme(workspace.id, index),
      x: center.x,
      z: center.z,
      width: footprint.width,
      depth: footprint.depth
    };
  });
  const contentRadius = rooms.reduce((largest, room) => (
    Math.max(largest, Math.hypot(room.x, room.z) + Math.hypot(room.width / 2, room.depth / 2))
  ), 0);
  // 圆形 Workspace 以最外侧 Device 的完整对角线为边界，确保设备越多，底座与玻璃罩同步增大。
  const radius = Math.max(compact ? 4.8 : 6.15, contentRadius + 1.08);
  return {
    workspace,
    theme: WORKSPACE_THEMES[visualIndex % WORKSPACE_THEMES.length],
    x,
    z,
    radius,
    width: radius * 2,
    depth: radius * 2,
    rooms
  };
}

function workspaceControllerOrigin(placed: SceneLayoutWorkspace): THREE.Vector3 {
  const controllerSpan = Math.max(0, placed.workspace.controllers.length - 1) * 1.15;
  // TYR 固定在圆盘前侧的安静扇区，避免与随数量扩张的 Device 环重叠。
  return new THREE.Vector3(
    Math.min(2.35, placed.radius * 0.3) - controllerSpan / 2,
    0.35,
    placed.radius - 1.48
  );
}

function angleDistance(first: number, second: number): number {
  return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
}

function workspaceRimLabelAngle(placed: SceneLayoutWorkspace, bridges: SceneLayoutBridge[]): number {
  const viewAngle = Math.atan2(HOME_CAMERA.x - placed.x, HOME_CAMERA.z - placed.z);
  const reservedAngles: number[] = [];
  if (placed.workspace.controllers.length > 0) {
    const controller = workspaceControllerOrigin(placed);
    reservedAngles.push(Math.atan2(controller.x, controller.z));
  }
  for (const bridge of bridges) {
    const gateway = placed.workspace.current
      ? bridge.sourceGateway
      : bridge.bridge.peerWorkspaceId === placed.workspace.id
        ? bridge.targetGateway
        : null;
    if (gateway) reservedAngles.push(Math.atan2(gateway[0] - placed.x, gateway[2] - placed.z));
  }
  const candidateOffsets = [0, -0.26, 0.26, -0.52, 0.52];
  // 铭牌只在相机正面 ±30° 弧段选位，再以离 TYR 与 Bridge 入口的净距评分；保持切线贴合也不牺牲字面可读性。
  return candidateOffsets
    .map((offset) => {
      const angle = viewAngle + offset;
      const clearance = reservedAngles.reduce((smallest, reserved) => Math.min(smallest, angleDistance(angle, reserved)), Math.PI);
      return { angle, score: clearance - Math.abs(offset) * 0.06 };
    })
    .sort((first, second) => second.score - first.score)[0].angle;
}

function buildSceneLayout(scene: WorkspaceSpatialScene, spacious = false): SceneLayout {
  const currentDraft = layoutWorkspace(scene.current, 0, 0, 0, false);
  const peerDrafts = scene.peers.map((workspace, index) => (
    layoutWorkspace(workspace, index + 1, 0, 0, workspace.rooms.length <= 1)
  ));
  // Square office cutaways need clear space between their facades.
  const peerGap = spacious ? 9 : 2.7;
  const totalPeerDepth = peerDrafts.reduce((sum, peer) => sum + peer.radius * 2, 0)
    + Math.max(0, peerDrafts.length - 1) * peerGap;
  let peerCursorZ = -totalPeerDepth / 2;
  const peerMaxRadius = peerDrafts.reduce((largest, peer) => Math.max(largest, peer.radius), 0);
  const peerColumnX = currentDraft.radius + peerMaxRadius + (spacious ? 12 : 5.1);
  const positionedPeerDrafts = peerDrafts.map((peer) => {
    const next = { ...peer, x: peerColumnX, z: peerCursorZ + peer.radius };
    peerCursorZ += peer.radius * 2 + peerGap;
    return next;
  });
  const initialMinX = -currentDraft.radius;
  const initialMaxX = positionedPeerDrafts.length > 0
    ? Math.max(...positionedPeerDrafts.map((peer) => peer.x + peer.radius))
    : currentDraft.radius;
  const centerOffsetX = -(initialMinX + initialMaxX) / 2;
  const current = { ...currentDraft, x: currentDraft.x + centerOffsetX };
  const peers = positionedPeerDrafts.map((peer) => ({ ...peer, x: peer.x + centerOffsetX }));
  const focusByKey = new Map<string, THREE.Vector3>();
  const workspaces = [current, ...peers];

  for (const placedWorkspace of workspaces) {
    const { workspace, x, z } = placedWorkspace;
    focusByKey.set(`workspace:${workspace.id}`, new THREE.Vector3(x, 0, z));
    const controllerOrigin = workspaceControllerOrigin(placedWorkspace);
    for (const [index, controller] of workspace.controllers.entries()) {
      focusByKey.set(`agent:${workspace.id}:${controller.id}`, new THREE.Vector3(x + controllerOrigin.x + index * 1.15, 0, z + controllerOrigin.z));
    }
    for (const placedRoom of placedWorkspace.rooms) {
      const roomPosition = new THREE.Vector3(x + placedRoom.x, 0, z + placedRoom.z);
      focusByKey.set(`room:${workspace.id}:${placedRoom.room.id}`, roomPosition);
      // 聚合房间中的隐藏 Agent 仍可把可信 chain 聚焦到所属 Device Room，但不会额外创建人物。
      for (const agent of placedRoom.room.agents) {
        focusByKey.set(`agent:${workspace.id}:${agent.id}`, roomPosition);
      }
    }
  }

  const chainPointsById = new Map<string, THREE.Vector3[]>();
  for (const placedWorkspace of workspaces) {
    for (const chain of placedWorkspace.workspace.flowChains) {
      const points = chainPointsById.get(chain.id) ?? [];
      for (const flow of chain.flows) {
        for (const agentId of [flow.sourceAgentId, flow.targetAgentId]) {
          if (!agentId) continue;
          const point = focusByKey.get(`agent:${placedWorkspace.workspace.id}:${agentId}`);
          if (point) points.push(point);
        }
      }
      if (points.length > 0) chainPointsById.set(chain.id, points);
    }
  }
  const chainFocusById = new Map<string, { target: THREE.Vector3; zoom: number }>();
  for (const [chainId, points] of chainPointsById) {
    const bounds = new THREE.Box3().setFromPoints(points);
    const target = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z);
    // 单房间 chain 保留人物级细节；跨 Workspace chain 自动留出完整直连走廊，但不越过全景下限。
    const zoom = THREE.MathUtils.clamp(58 - span * 1.8, 30, 54);
    chainFocusById.set(chainId, { target, zoom });
  }

  const bridges = peers.flatMap((peer, bridgeIndex) => {
    const bridge = scene.bridges.find((item) => item.peerWorkspaceId === peer.workspace.id);
    if (!bridge) return [];
    const connection = new THREE.Vector3(peer.x - current.x, 0, peer.z - current.z);
    const centerDistance = Math.max(0.001, connection.length());
    const direction = connection.normalize();
    const sourceGatewayVector = new THREE.Vector3(current.x, 0.16, current.z)
      .addScaledVector(direction, current.radius - 0.1);
    const targetGatewayVector = new THREE.Vector3(peer.x, 0.16, peer.z)
      .addScaledVector(direction, -(peer.radius - 0.1));
    const bridgeCenter = sourceGatewayVector.clone().lerp(targetGatewayVector, 0.5);
    const sourceController = workspaceControllerOrigin(current);
    const targetController = workspaceControllerOrigin(peer);
    const bridgeLength = Math.max(1.4, centerDistance - current.radius - peer.radius + 0.2);
    const placedBridge: SceneLayoutBridge = {
      bridge,
      x: bridgeCenter.x,
      z: bridgeCenter.z,
      length: bridgeLength,
      // Bridge 的局部 X 轴对齐两个圆心，因此多 Workspace 时会从圆周入口自然扇出。
      rotationY: -Math.atan2(direction.z, direction.x),
      // 标签靠近各自 peer 端并交错抬升；共享 current 端只保留清晰的物理入口与流向。
      labelPosition: [
        Math.max(0.18, bridgeLength / 2 - 0.72),
        2.98 + bridgeIndex % 3 * 0.58,
        (bridgeIndex % 2 === 0 ? -1 : 1) * 0.52
      ],
      sourceController: current.workspace.controllers.length > 0
        ? [current.x + sourceController.x, 0.25, current.z + sourceController.z]
        : undefined,
      targetController: peer.workspace.controllers.length > 0
        ? [peer.x + targetController.x, 0.25, peer.z + targetController.z]
        : undefined,
      sourceGateway: [sourceGatewayVector.x, sourceGatewayVector.y, sourceGatewayVector.z],
      targetGateway: [targetGatewayVector.x, targetGatewayVector.y, targetGatewayVector.z]
    };
    focusByKey.set(`bridge:${bridge.id}`, new THREE.Vector3(placedBridge.x, 0, placedBridge.z));
    return [placedBridge];
  });

  const minX = Math.min(...workspaces.map((workspace) => workspace.x - workspace.radius));
  const maxX = Math.max(...workspaces.map((workspace) => workspace.x + workspace.radius));
  const minZ = Math.min(...workspaces.map((workspace) => workspace.z - workspace.radius));
  const maxZ = Math.max(...workspaces.map((workspace) => workspace.z + workspace.radius));
  const sceneSpan = Math.max(maxX - minX, (maxZ - minZ) * 1.5);
  const fitZoom = THREE.MathUtils.clamp(900 / Math.max(20, sceneSpan + 1), 8, 48);

  return { workspaces, bridges, focusByKey, chainFocusById, fitZoom };
}

type SceneMessageRouteNode = {
  kind: "controller" | "room";
  point: [number, number, number];
  hub: [number, number, number];
  roomId?: string;
  approach?: [number, number, number];
  dispatch?: [number, number, number];
};

type SceneMessageJourney = {
  id: string;
  points: [number, number, number][];
  signal: RoutePulseSignal;
  selection: WorkspaceSpatialSelection;
};

function sceneMessageRouteNode(placed: SceneLayoutWorkspace, agentId: string): SceneMessageRouteNode | null {
  const controllerIndex = placed.workspace.controllers.findIndex((agent) => agent.id === agentId);
  if (controllerIndex >= 0) {
    const origin = workspaceControllerOrigin(placed);
    return {
      kind: "controller",
      point: [placed.x + origin.x + controllerIndex * 1.15, 0.25, placed.z + origin.z + 0.24],
      hub: [placed.x + origin.x + 0.45, 0.16, placed.z + origin.z - 0.15]
    };
  }

  for (const room of placed.rooms) {
    const agentIndex = room.room.visibleAgents.findIndex((agent) => agent.id === agentId);
    const containsAgent = room.room.agents.some((agent) => agent.id === agentId);
    if (!containsAgent) continue;
    const gateway: [number, number, number] = [
      placed.x + room.x + room.width / 2 - 0.42,
      0.47,
      placed.z + room.z + room.depth / 2 - 0.52
    ];
    const roomFront = placed.z + room.z + room.depth / 2;
    const slot = agentIndex >= 0 ? agentSlots(room.room.visibleAgents.length, room.width)[agentIndex] : undefined;
    return {
      kind: "room",
      // 聚合房间里的隐藏 Agent 只到达真实房间 gateway，不伪造一个不可见的人物位置。
      point: slot
        ? [placed.x + room.x + slot.x, 0.47, placed.z + room.z + slot.z - 0.15]
        : gateway,
      hub: gateway,
      roomId: room.room.id,
      // approach 保持在房间地板表面，dispatch 落在墙外的 Workspace 地面；坡道不再埋入不透明地板。
      approach: [gateway[0], 0.47, roomFront - 0.08],
      dispatch: [gateway[0], 0.16, roomFront + 0.34]
    };
  }
  return null;
}

function appendSceneMessagePoint(
  points: [number, number, number][],
  point: [number, number, number] | undefined
) {
  if (!point) return;
  const previous = points.at(-1);
  if (previous && Math.hypot(previous[0] - point[0], previous[1] - point[1], previous[2] - point[2]) < 0.06) return;
  points.push(point);
}

function workspaceSceneMessagePath(
  placed: SceneLayoutWorkspace,
  journey: Pick<WorkspaceSpatialMessageJourneySignal, "pathSourceAgentId" | "pathTargetAgentId">
): [number, number, number][] {
  const source = journey.pathSourceAgentId ? sceneMessageRouteNode(placed, journey.pathSourceAgentId) : null;
  const target = sceneMessageRouteNode(placed, journey.pathTargetAgentId);
  if (!target) return [];
  const points: [number, number, number][] = [];

  if (!source) {
    // Human 根消息没有可见人物源点；从目标房间的可信 gateway 开始，不补画不存在的发送者。
    appendSceneMessagePoint(points, target.kind === "room" ? target.hub : target.point);
    appendSceneMessagePoint(points, target.point);
    return points;
  }

  const sameRoom = source.kind === "room" && target.kind === "room" && source.roomId === target.roomId;
  if (sameRoom) {
    // 同房间消息沿人物前方的地面 service lane 行进，不绕到公共 Gateway 形成夸张的 V 字。
    const laneZ = Math.min(
      source.hub[2] - 0.38,
      Math.max(source.point[2], target.point[2]) + 0.52
    );
    appendSceneMessagePoint(points, source.point);
    appendSceneMessagePoint(points, [source.point[0], source.point[1], laneZ]);
    appendSceneMessagePoint(points, [target.point[0], target.point[1], laneZ]);
    appendSceneMessagePoint(points, target.point);
    return points;
  }

  appendSceneMessagePoint(points, source.point);
  if (source.kind === "room") {
    appendSceneMessagePoint(points, source.hub);
    appendSceneMessagePoint(points, source.approach);
  }

  appendSceneMessagePoint(points, source.kind === "room" ? source.dispatch : source.hub);
  if (source.kind === "room" && target.kind === "room") {
    const controllerOrigin = workspaceControllerOrigin(placed);
    appendSceneMessagePoint(points, [
      placed.x + controllerOrigin.x + 0.45,
      0.16,
      placed.z + controllerOrigin.z - 0.15
    ]);
  }
  appendSceneMessagePoint(points, target.kind === "room" ? target.dispatch : target.hub);
  if (target.kind === "room") {
    appendSceneMessagePoint(points, target.approach);
    appendSceneMessagePoint(points, target.hub);
  }
  appendSceneMessagePoint(points, target.point);
  return points;
}

function workspaceSpatialHumanHome(placed: SceneLayoutWorkspace): [number, number, number] {
  return [
    placed.x - Math.min(2.6, placed.radius * 0.38),
    0.18,
    placed.z + placed.radius - 1.38
  ];
}

function workspaceSpatialHumanRoute(
  layout: SceneLayout,
  journey: WorkspaceSpatialHumanJourney
): WorkspaceSpatialBridgeTransitRoute | null {
  const placed = layout.workspaces.find((workspace) => workspace.workspace.id === journey.workspaceId);
  if (!placed) return null;
  const target = sceneMessageRouteNode(placed, journey.targetAgentId);
  if (!target) return null;
  const points: [number, number, number][] = [];
  const home = workspaceSpatialHumanHome(placed);
  const controllerOrigin = workspaceControllerOrigin(placed);
  const humanGate: [number, number, number] = [
    placed.x + controllerOrigin.x - 0.72,
    0.18,
    placed.z + controllerOrigin.z - 0.18
  ];
  appendSceneMessagePoint(points, home);
  appendSceneMessagePoint(points, [humanGate[0], home[1], home[2]]);
  appendSceneMessagePoint(points, humanGate);
  appendSceneMessagePoint(points, target.kind === "room" ? target.dispatch : target.hub);
  if (target.kind === "room") {
    appendSceneMessagePoint(points, target.approach);
    appendSceneMessagePoint(points, target.hub);
  }
  const interactionPoint: [number, number, number] = [target.point[0], Math.min(target.point[1], 0.25), target.point[2] + 0.9];
  appendSceneMessagePoint(points, interactionPoint);
  return points.length >= 2
    ? { points, sourceGatewayIndex: 0, targetGatewayIndex: points.length - 1 }
    : null;
}

function buildSceneMessageJourneys(
  layout: SceneLayout,
  selection: WorkspaceSpatialSelection | null
): SceneMessageJourney[] {
  const journeys: SceneMessageJourney[] = [];
  for (const placed of layout.workspaces) {
    for (const journey of workspaceSpatialMessageJourneySignals(placed.workspace)) {
      const points = workspaceSceneMessagePath(placed, journey);
      if (points.length < 2) continue;
      const bridgeLinked = Boolean(journey.bridgeRequestMessageId);
      const bridgeRequest = bridgeLinked
        ? layout.bridges.flatMap((bridge) => bridge.bridge.messages ?? [])
            .find((message) => message.id === journey.bridgeRequestMessageId)
        : undefined;
      const bridgeRequestDelay = bridgeLinked
        ? workspaceSpatialBridgeWorkerDelaySeconds(journey.tone, bridgeRequest?.createdAt, journey.createdAt)
        : 0;
      journeys.push({
        id: journey.id,
        points,
        signal: {
          id: journey.id,
          executionId: journey.executionId,
          bridgeRequestMessageId: journey.bridgeRequestMessageId,
          tone: journey.tone,
          reverse: journey.reverse,
          // 跨域 Bridge 已经熄灭后，本地 TYR -> worker 河道仍按真实 running 状态低亮保持，避免执行期出现空窗。
          continuous: journey.continuous,
          updatedAt: journey.updatedAt,
          delaySeconds: journey.delaySeconds + bridgeRequestDelay,
          // Bridge 抵达后的 Agent 接力仍为一次性，但需留出稳定可读的验收窗口。
          durationSeconds: bridgeLinked
            ? Math.max(journey.durationSeconds, WORKSPACE_SPATIAL_BRIDGE_WORKER_RIVER_SECONDS)
            : journey.durationSeconds,
          // 消息通道贴着各自地面与 Bridge 桥面，只抬高到足以避免 z-fighting。
          visualLift: journey.emphasized ? 0.025 : 0.02,
          // running 表示消息已经送达目标 runtime；河道进入低亮保持，等待 response 原路返回。
          holdingAtTarget: journey.tone === "request" && journey.status === "running",
          emphasized: journey.emphasized,
          chainId: journey.chainId,
          chainStepIndex: journey.chainStepIndex,
          chainStepCount: journey.chainStepCount,
          gapBefore: journey.gapBefore
        },
        selection: { kind: "flow", workspaceId: placed.workspace.id, executionId: journey.executionId }
      });
    }
  }

  // light river 继续表达 payload 路径；Bridge Journey 另用服务端阶段移动发起 TYR，并共享同一条物理路线。
  const priority: Record<CommunicationFlowTone, number> = { error: 0, response: 1, request: 2 };
  const isSelected = (journey: SceneMessageJourney) => (
    (selection?.kind === "flow"
      && journey.selection.kind === "flow"
      && selection.workspaceId === journey.selection.workspaceId
      && selection.executionId === journey.selection.executionId)
    || (selection?.kind === "bridge"
      && journey.selection.kind === "bridge"
      && selection.id === journey.selection.id)
  );
  // 同屏只保留三条最需要被看见的权威消息旅程，避免并发通信退化成光线网。
  const visibleJourneys = journeys
    .sort((left, right) => (
      Number(isSelected(right)) - Number(isSelected(left))
      // Bridge 抵达后的本地 Agent 接力必须优先可见，不能被普通并发任务的三条上限裁掉。
      || Number(Boolean(right.signal.bridgeRequestMessageId)) - Number(Boolean(left.signal.bridgeRequestMessageId))
      || Number(right.signal.continuous) - Number(left.signal.continuous)
      || (right.signal.updatedAt ?? "").localeCompare(left.signal.updatedAt ?? "")
      || priority[left.signal.tone] - priority[right.signal.tone]
      || Number(!left.signal.emphasized) - Number(!right.signal.emphasized)
      || (left.signal.delaySeconds ?? 0) - (right.signal.delaySeconds ?? 0)
      || left.id.localeCompare(right.id)
    ))
    .slice(0, 3);
  const lanesByEndpoints = new Map<string, SceneMessageJourney[]>();
  for (const journey of visibleJourneys) {
    const endpoints = [journey.points[0], journey.points.at(-1)!]
      .map((point) => point.map((value) => value.toFixed(2)).join(","))
      .sort()
      .join("|");
    const lane = lanesByEndpoints.get(endpoints) ?? [];
    lane.push(journey);
    lanesByEndpoints.set(endpoints, lane);
  }
  // 并发执行共享同一条物理通道，只错开能量球相位；不再画多条平行装饰线。
  for (const lane of lanesByEndpoints.values()) {
    if (lane.length < 2) continue;
    lane.forEach((journey, index) => {
      journey.signal.energyPhaseOffset = index / lane.length;
      journey.signal.sharedLaneCount = lane.length;
    });
  }
  return visibleJourneys;
}

function WorkspaceMessageJourneys({ layout, deferredBridgeExecutionIds, deferredBridgeRequestMessageIds, ownedVisitExecutionIds, selection, onSelect }: {
  layout: SceneLayout;
  deferredBridgeExecutionIds: Set<string>;
  deferredBridgeRequestMessageIds: Set<string>;
  selection: WorkspaceSpatialSelection | null;
  onSelect: (selection: WorkspaceSpatialSelection) => void;
  ownedVisitExecutionIds: ReadonlySet<string>;
}) {
  const baseJourneys = useMemo(() => buildSceneMessageJourneys(layout, selection).filter((journey) => (
    !journey.signal.executionId
    || !deferredBridgeExecutionIds.has(journey.signal.executionId) && !ownedVisitExecutionIds.has(journey.signal.executionId)
  ) && (
    !journey.signal.bridgeRequestMessageId
    || !deferredBridgeRequestMessageIds.has(journey.signal.bridgeRequestMessageId)
  )), [deferredBridgeExecutionIds, deferredBridgeRequestMessageIds, ownedVisitExecutionIds, layout, selection]);
  return (
    <group>
      {baseJourneys.map((journey) => (
        <PolylinePulse
          key={journey.id}
          points={journey.points}
          signal={journey.signal}
          offset={0}
          onSelect={() => onSelect(journey.selection)}

        />
      ))}
    </group>
  );
}

function stopAndSelect(event: ThreeEvent<MouseEvent>, select: () => void) {
  event.stopPropagation();
  select();
}

function SceneFrameLoopDriver({ active }: { active: boolean }) {
  const invalidate = useThree((state) => state.invalidate);
  const setFrameloop = useThree((state) => state.setFrameloop);
  useEffect(() => {
    // Canvas prop 建立首帧模式；driver 统一同步后续真实 work / ambient 动态切换。
    setFrameloop(active ? "always" : "demand");
    invalidate();
  }, [active, invalidate, setFrameloop]);
  return null;
}

const BRIDGE_TRANSIT_CONSUMED_STORAGE_PREFIX = "tyr.workspace-bridge-transit.consumed.v2";
const BRIDGE_TRANSIT_CONSUMED_LIMIT = 5_000;

function bridgeTransitConsumedStorageKey(workspaceId: string): string {
  return `${BRIDGE_TRANSIT_CONSUMED_STORAGE_PREFIX}:${workspaceId}`;
}

function bridgeTransitPlaybackKey(signal: BridgeCommunicationFlowSignal): string {
  // running 状态可多次刷新 updatedAt；同一请求阶段只能播放一次，response/error 才开启反向新阶段。
  return `${signal.id}:${signal.tone}`;
}

function readConsumedBridgeTransitIds(workspaceId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const value = JSON.parse(window.sessionStorage.getItem(bridgeTransitConsumedStorageKey(workspaceId)) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function rememberConsumedBridgeTransitIds(
  workspaceId: string,
  ids: Iterable<string>,
  target: Set<string>
): void {
  for (const id of ids) {
    target.delete(id);
    target.add(id);
  }
  while (target.size > BRIDGE_TRANSIT_CONSUMED_LIMIT) {
    const oldestId = target.values().next().value;
    if (typeof oldestId !== "string") break;
    target.delete(oldestId);
  }
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(bridgeTransitConsumedStorageKey(workspaceId), JSON.stringify([...target]));
  } catch {
    // sessionStorage 可能被隐私模式禁用；当前挂载仍由内存集合保证终态动画不重播。
  }
}

function useWorkspaceBridgeTransitSignals(
  scene: WorkspaceSpatialScene
): {
  signals: Map<string, BridgeCommunicationFlowSignal>;
  completePlayback: (playbackKey: string) => void;
} {
  const consumedRef = useRef(new Set<string>());
  const observedRequestLifecycleIdsRef = useRef(new Set<string>());
  const workspaceIdRef = useRef("");
  const [playbackRevision, setPlaybackRevision] = useState(0);
  if (workspaceIdRef.current !== scene.current.id) {
    workspaceIdRef.current = scene.current.id;
    consumedRef.current = readConsumedBridgeTransitIds(scene.current.id);
    observedRequestLifecycleIdsRef.current = new Set();
  }
  const visibleSignals = useMemo(() => {
    const result = new Map<string, BridgeCommunicationFlowSignal>();
    for (const bridge of scene.bridges) {
      for (const journey of bridge.journeys ?? []) {
        if (journey.continuous) {
          // returning 阶段可能暂时没有 Bridge signal；页面只要观察过同一真实 Journey，随后 final 仍可正常回传。
          observedRequestLifecycleIdsRef.current.add(`bridge-transit:${journey.requestMessageId}`);
        }
      }
      const signal = bridge.signals[0];
      if (!signal) continue;
      if (signal.tone === "request") observedRequestLifecycleIdsRef.current.add(signal.id);
      // 首次挂载只看到 final/error 时，说明页面没有观察到这次实时请求；刷新不能重播历史 Bridge 回程。
      if (signal.tone !== "request" && !observedRequestLifecycleIdsRef.current.has(signal.id)) continue;
      if (!consumedRef.current.has(bridgeTransitPlaybackKey(signal))) result.set(bridge.id, signal);
    }
    return result;
  }, [playbackRevision, scene]);
  const completePlayback = useCallback((playbackKey: string) => {
    if (consumedRef.current.has(playbackKey)) return;
    // pending 也只表达一次“载荷已送达”；等待 Agent 期间 Bridge 必须恢复静态，不能持续发光。
    rememberConsumedBridgeTransitIds(scene.current.id, [playbackKey], consumedRef.current);
    setPlaybackRevision((revision) => revision + 1);
  }, [scene.current.id]);

  return { signals: visibleSignals, completePlayback };
}

function sceneControllerPoint(
  placed: SceneLayoutWorkspace,
  agentId: string
): WorkspaceSpatialBridgeTransitPoint | null {
  const index = placed.workspace.controllers.findIndex((agent) => agent.id === agentId);
  if (index < 0) return null;
  const origin = workspaceControllerOrigin(placed);
  return [placed.x + origin.x + index * 1.15, origin.y + 0.02, placed.z + origin.z + 0.24];
}

function bridgeTransitVisualRoute(
  layout: SceneLayout,
  placedBridge: SceneLayoutBridge,
  signal: BridgeCommunicationFlowSignal
): BridgeTransitVisualRoute | null {
  const currentWorkspace = layout.workspaces.find((workspace) => workspace.workspace.current);
  const peerWorkspace = layout.workspaces.find((
    workspace
  ) => workspace.workspace.id === placedBridge.bridge.peerWorkspaceId);
  const message = placedBridge.bridge.messages?.find((candidate) => candidate.id === signal.messageId);
  if (!currentWorkspace || !peerWorkspace || !message) return null;

  const sourceWorkspace = signal.direction === "outbound" ? currentWorkspace : peerWorkspace;
  const targetWorkspace = signal.direction === "outbound" ? peerWorkspace : currentWorkspace;
  const sourceAgentId = message.sourceWorkspaceId === sourceWorkspace.workspace.id
    ? message.senderCommsAgentId
    : message.receiverCommsAgentId;
  const targetAgentId = message.targetWorkspaceId === targetWorkspace.workspace.id
    ? message.receiverCommsAgentId
    : message.senderCommsAgentId;
  const sourceConsole = sceneControllerPoint(sourceWorkspace, sourceAgentId);
  const targetConsole = sceneControllerPoint(targetWorkspace, targetAgentId);
  if (!sourceConsole || !targetConsole) return null;

  const sourceGateway = signal.direction === "outbound"
    ? placedBridge.sourceGateway
    : placedBridge.targetGateway;
  const targetGateway = signal.direction === "outbound"
    ? placedBridge.targetGateway
    : placedBridge.sourceGateway;
  return {
    placedBridge,
    route: workspaceSpatialBridgeTransitRoute({
      source: {
        center: [sourceWorkspace.x, 0.18, sourceWorkspace.z],
        radius: sourceWorkspace.radius,
        console: sourceConsole,
        gateway: sourceGateway
      },
      target: {
        center: [targetWorkspace.x, 0.18, targetWorkspace.z],
        radius: targetWorkspace.radius,
        console: targetConsole,
        gateway: targetGateway
      }
    })
  };
}

const WorkspaceBuildingPresentationContext = createContext(false);

const WorkspaceSpatialSceneCanvasComponent = forwardRef<WorkspaceSpatialSceneHandle, {
  scene: WorkspaceSpatialScene;
  selection: WorkspaceSpatialSelection | null;
  focusedRoomKey: string | null;
  ambientAssignmentsOverride?: WorkspaceSpatialAmbientAssignment[];
  presentation?: "campus" | "building" | "connections";
  onSelect: (selection: WorkspaceSpatialSelection | null) => void;
  onInteract?: () => void;
}>(function WorkspaceSpatialSceneCanvas({ scene, selection, focusedRoomKey, ambientAssignmentsOverride, presentation = "campus", onSelect, onInteract }, ref) {
  const layout = useMemo(() => buildSceneLayout(scene, presentation !== "campus"), [scene, presentation]);
  const defaultSceneZoom = layout.fitZoom * (presentation === "building" ? 0.64 : presentation === "connections" ? 0.94 : 1);
  const fitRatioRef = useRef(1);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const invalidateRef = useRef<() => void>(() => undefined);
  const setSceneEventsEnabledRef = useRef<(enabled: boolean) => void>(() => undefined);
  const documentVisible = useDocumentVisible();
  const reduceMotion = useReducedSceneMotion();
  const sceneNeedsAnimation = workspaceSpatialSceneNeedsAnimation(scene);
  const messageAttention = workspaceSpatialSceneHasMessageAttention(scene);
  const ambientEligibilityKey = workspaceSpatialAmbientEligibilityKey(scene);
  const latestSceneRef = useRef(scene);
  const ambientCadenceRef = useRef<WorkspaceSpatialAmbientCadence | null>(null);
  const previousAmbientAssignmentsRef = useRef<WorkspaceSpatialAmbientAssignment[]>([]);
  const [ambientAssignments, setAmbientAssignments] = useState<WorkspaceSpatialAmbientAssignment[]>([]);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const agentTextModes = workspaceSpatialAgentTextModes(layout.workspaces.flatMap((placedWorkspace, workspaceIndex) => (
    placedWorkspace.rooms.flatMap((placedRoom, roomIndex) => placedRoom.room.visibleAgents.map((agent, agentIndex) => {
      const motion = workspaceSpatialAgentMotion(agent);
      return {
        id: `${placedWorkspace.workspace.id}:${agent.id}`,
        roomKey: `room:${placedWorkspace.workspace.id}:${placedRoom.room.id}`,
        state: agent.state,
        motionMode: motion.mode,
        marker: motion.marker,
        layoutIndex: workspaceIndex * 10_000 + roomIndex * 100 + agentIndex,
        selected: selection?.kind === "agent" && selection.workspaceId === placedWorkspace.workspace.id && selection.id === agent.id,
        hovered: hoveredKey === `agent:${placedWorkspace.workspace.id}:${agent.id}`
      };
    }))
  )), focusedRoomKey);
  latestSceneRef.current = scene;
  const [completedJourneyVisualIds, setCompletedJourneyVisualIds] = useState<Set<string>>(() => new Set());
  const [handedOffJourneyVisualIds, setHandedOffJourneyVisualIds] = useState<Set<string>>(() => new Set());
  const journeyWorkspaceIdRef = useRef(scene.current.id);
  const activeAmbientAssignments = ambientAssignmentsOverride ?? ambientAssignments;
  const ambientOverrideActive = ambientAssignmentsOverride !== undefined;
  const ambientRunKey = activeAmbientAssignments.map((assignment) => assignment.id).join(":");
  const ambientEndsAtMs = ambientAssignments.reduce((latest, assignment) => Math.max(latest, assignment.endsAtMs), 0);
  const framePolicy = workspaceSpatialFramePolicy({
    documentVisible,
    reduceMotion,
    authoritativeMotion: sceneNeedsAnimation,
    ambientMotion: activeAmbientAssignments.length > 0
  });
  const bridgeTransit = useWorkspaceBridgeTransitSignals(scene);
  useEffect(() => {
    if (journeyWorkspaceIdRef.current === scene.current.id) return;
    journeyWorkspaceIdRef.current = scene.current.id;
    setCompletedJourneyVisualIds(new Set());
    setHandedOffJourneyVisualIds(new Set());
  }, [scene.current.id]);
  // 状态以请求为键；服务端稳定分配原身或分身，刷新只恢复行程，不能重新决定角色身份。
  const visitStore = useMemo(() => {
    let states = new Map<string, WorkspaceSpatialVisitState>();
    try { states = readWorkspaceSpatialVisits(window.sessionStorage, scene.current.id); } catch { /* 隐私模式仍可播放。 */ }
    return { states, observedSinceMs: Date.now(), bridges: new Map<string, TopologyBridgeJourneyRecord>(), agents: new Map<string, WorkspaceSpatialAgentVisit>() };
  }, [scene.current.id]);
  const [visitRevision, setVisitRevision] = useState(0);
  const [dispatchReadyRevision, setDispatchReadyRevision] = useState(0);
  const visitStageChanged = useCallback(() => setVisitRevision((revision) => revision + 1), []);
  const [playedHumanJourneyIds, setPlayedHumanJourneyIds] = useState<Set<string>>(() => {
    try { return readPlayedWorkspaceSpatialHumanJourneys(window.sessionStorage, scene.current.id); }
    catch { return new Set(); }
  });
  const humanVisualStates = useMemo(() => new Map<string, WorkspaceSpatialVisitState>(), [scene.current.id]);
  const persistVisits = useCallback(() => {
    try { saveWorkspaceSpatialVisits(window.sessionStorage, scene.current.id, visitStore.states); } catch { /* 存储不可用不影响业务。 */ }
  }, [scene.current.id, visitStore]);
  useEffect(() => {
    window.addEventListener("pagehide", persistVisits);
    return () => { window.removeEventListener("pagehide", persistVisits); persistVisits(); };
  }, [persistVisits]);
  useEffect(() => {
    try { setPlayedHumanJourneyIds(readPlayedWorkspaceSpatialHumanJourneys(window.sessionStorage, scene.current.id)); }
    catch { setPlayedHumanJourneyIds(new Set()); }
  }, [scene.current.id]);
  const bridgeJourneys = useMemo(() => {
    const facts = layout.bridges.flatMap((placed) => placed.bridge.journeys ?? []);
    return reconcileWorkspaceSpatialVisits(facts, visitStore.bridges, visitStore.states, Date.now(), visitStore.observedSinceMs)
      .flatMap((journey) => {
        const placedBridge = layout.bridges.find((placed) => placed.bridge.id === journey.bridgeId);
        return placedBridge ? [{ placedBridge, journey }] : [];
      });
  }, [layout, visitStore, completedJourneyVisualIds]);
  useEffect(() => {
    const nextReadyAt = bridgeJourneys.reduce((earliest, { journey }) => {
      const readyAt = Date.parse(journey.dispatchReadyAt);
      return readyAt > Date.now() ? Math.min(earliest, readyAt) : earliest;
    }, Number.POSITIVE_INFINITY);
    if (!Number.isFinite(nextReadyAt)) return;
    // 人物在 400ms 归组窗口结束后一次性出现，期间服务端可以把同批单路修正为并行分身且不会产生闪烁。
    const timer = window.setTimeout(() => setDispatchReadyRevision((revision) => revision + 1), Math.max(0, nextReadyAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [bridgeJourneys]);
  const bridgeJourneyCandidates = useMemo(() => (
    bridgeJourneys
      .filter(({ journey }) => Date.parse(journey.dispatchReadyAt) <= Date.now())
      .filter(({ journey }) => !completedJourneyVisualIds.has(journey.id) && visitStore.states.get(journey.id)?.stage !== "complete")
      .sort((left, right) => (
        Number(right.journey.continuous) - Number(left.journey.continuous)
        || BRIDGE_JOURNEY_VISUAL_PRIORITY[left.journey.phase] - BRIDGE_JOURNEY_VISUAL_PRIORITY[right.journey.phase]
        || left.journey.createdAt.localeCompare(right.journey.createdAt)
        || left.journey.id.localeCompare(right.journey.id)
      ))
      .filter(({ placedBridge, journey }) => {
        const signal = bridgeJourneySignal(layout, journey);
        return Boolean(signal && bridgeJourneySourceAgent(layout, journey) && bridgeTransitVisualRoute(layout, placedBridge, signal));
      })
  ), [bridgeJourneys, completedJourneyVisualIds, dispatchReadyRevision, layout, visitStore]);
  const visibleBridgeJourneys = useMemo(
    () => workspaceSpatialSelectBridgeCloneCandidates(bridgeJourneyCandidates, 4),
    [bridgeJourneyCandidates]
  );
  const hiddenDirectControllerKeys = new Set(visibleBridgeJourneys.flatMap(({ journey }) => (
    journey.actorMode === "direct"
      ? [`${journey.sourceWorkspaceId}:${journey.sourceAgentId}`]
      : []
  )));
  const completeBridgeJourneyHandoff = useCallback((journeyId: string) => {
    setHandedOffJourneyVisualIds((current) => {
      if (current.has(journeyId)) return current;
      const next = new Set(current);
      next.add(journeyId);
      while (next.size > MAX_COMPLETED_BRIDGE_JOURNEY_VISUAL_IDS) {
        const oldestId = next.values().next().value;
        if (typeof oldestId !== "string") break;
        next.delete(oldestId);
      }
      return next;
    });
  }, []);
  const completeBridgeJourneyVisual = useCallback((journeyId: string) => {
    setCompletedJourneyVisualIds((current) => {
      if (current.has(journeyId)) return current;
      const next = new Set(current);
      next.add(journeyId);
      while (next.size > MAX_COMPLETED_BRIDGE_JOURNEY_VISUAL_IDS) {
        const oldestId = next.values().next().value;
        if (typeof oldestId !== "string") break;
        next.delete(oldestId);
      }
      return next;
    });
  }, []);
  // 每个可见外派角色只延后自身尚未完成的交接表演，不延后业务结果和其他请求。
  const deferredJourneys = visibleBridgeJourneys.flatMap(({ journey }) => {
    const state = visitStore.states.get(journey.id);
    return ["outbound", "handoff"].includes(state?.stage ?? "")
      && !state?.requestExchanged
      && !handedOffJourneyVisualIds.has(journey.id)
        ? [journey] : [];
  });
  const deferredBridgeExecutionIds = new Set(deferredJourneys.flatMap((journey) => journey.executionId ? [journey.executionId] : []));
  const deferredBridgeRequestMessageIds = new Set(deferredJourneys.map((journey) => journey.requestMessageId));
  const deferredBridgeControllerKeys = new Set(deferredJourneys.map((journey) => `${journey.targetWorkspaceId}:${journey.targetAgentId}`));
  const controllerJourneyStatuses = new Map<string, TopologyBridgeJourneyRecord>();
  for (const { journey } of bridgeJourneys) {
    if (deferredBridgeRequestMessageIds.has(journey.requestMessageId)) continue;
    // 可见分身已经承担这条 Journey 的主状态；控制台再展开一张卡只会重复信息并遮挡人物。
    if (bridgeJourneyCandidates.some((candidate) => candidate.journey.id === journey.id)) continue;
    if (workspaceSpatialBridgeJourneyHasActiveConsoleStatus(journey.phase)) {
      controllerJourneyStatuses.set(`${journey.targetWorkspaceId}:${journey.targetAgentId}`, journey);
    }
  }
  const localVisits = reconcileWorkspaceSpatialVisits(
    layout.workspaces.flatMap((placed) => workspaceSpatialAgentVisits(placed.workspace)),
    visitStore.agents, visitStore.states, Date.now(), visitStore.observedSinceMs
  );
  for (const { journey } of bridgeJourneys) {
    const state = visitStore.states.get(journey.id);
    if (!state) continue;
    state.dependentVisitIds = [...new Set([
      ...(state.dependentVisitIds ?? []),
      ...localVisits.filter((visit) => visit.bridgeRequestMessageId === journey.requestMessageId).map((visit) => visit.id)
    ])];
  }
  const visibleLocalVisits = localVisits.flatMap((visit) => {
    if (visit.bridgeRequestMessageId && deferredBridgeRequestMessageIds.has(visit.bridgeRequestMessageId)) return [];
    const placed = layout.workspaces.find((item) => item.workspace.id === visit.workspaceId);
    const sourceAgent = placed?.workspace.controllers.find((agent) => agent.id === visit.sourceAgentId);
    const targetAgent = placed?.workspace.rooms.flatMap((room) => room.visibleAgents).find((agent) => agent.id === visit.targetAgentId);
    if (!placed || !sourceAgent || !targetAgent) return [];
    const points = workspaceSceneMessagePath(placed, { pathSourceAgentId: visit.sourceAgentId, pathTargetAgentId: visit.targetAgentId });
    if (points.length < 2) return [];
    return [{ visit, sourceAgent, targetAgent, route: { points, sourceGatewayIndex: 0, targetGatewayIndex: points.length - 1 } }];
  }).slice(0, Math.max(0, 4 - visibleBridgeJourneys.length));
  for (const { visit } of visibleLocalVisits) {
    // 原身正在 Agent 身边工作时隐藏控制台位置；分身行程保留原身驻守。
    if (visit.actorMode === "direct") hiddenDirectControllerKeys.add(`${visit.workspaceId}:${visit.sourceAgentId}`);
    const state = visitStore.states.get(visit.id);
    if (state && workspaceSpatialVisitBubbleMode(state.stage, true) === "primary") {
      // 对端 TYR 正在走动或交接时，它是该 Workspace 的主叙事，暂时收起目标 Agent 的文字卡。
      agentTextModes[`${visit.workspaceId}:${visit.targetAgentId}`] = "none";
    }
  }
  const visibleVisitActorCount = visibleBridgeJourneys.length + visibleLocalVisits.length;
  const hiddenVisitActorCount = Math.max(0, bridgeJourneyCandidates.length + localVisits.length - visibleVisitActorCount);
  const activeHumanJourney = scene.humanJourneys.find((journey) => (
    !playedHumanJourneyIds.has(journey.id)
    && Boolean(workspaceSpatialHumanRoute(layout, journey))
  ));
  const activeHumanRoute = activeHumanJourney ? workspaceSpatialHumanRoute(layout, activeHumanJourney) : null;
  const activeHumanCheckpoint = useMemo(() => {
    if (!activeHumanJourney) return undefined;
    try { return readWorkspaceSpatialHumanJourneyCheckpoint(window.sessionStorage, scene.current.id, activeHumanJourney.id); }
    catch { return undefined; }
  }, [activeHumanJourney?.id, scene.current.id]);
  const completeHumanJourneyVisual = useCallback((journeyId: string) => {
    setPlayedHumanJourneyIds((current) => {
      const next = new Set(current);
      next.add(journeyId);
      try { savePlayedWorkspaceSpatialHumanJourneys(window.sessionStorage, scene.current.id, next); } catch { /* 当前会话仍会去重。 */ }
      return next;
    });
  }, [scene.current.id]);

  const visitExchanges = new Map<string, VisitExchangeCue>();
  const addExchange = (id: string, targetId: string, route: WorkspaceSpatialBridgeTransitRoute, local: boolean) => {
    const state = visitStore.states.get(id);
    if (!state || state.progress < 0.998 || !["handoff", "receiving"].includes(state.stage)) return;
    const source = visitRoutePoints(route, local).at(-1)!;
    const target = route.points.at(-1)!;
    const yaw = Math.atan2(target[0] - source[0], target[2] - source[2]);
    const base = { visitId: id, states: visitStore.states, durationMs: local ? WORKSPACE_SPATIAL_LOCAL_VISIT_HANDOFF_MS : WORKSPACE_SPATIAL_VISIT_HANDOFF_MS };
    visitExchanges.set(`visit:${id}`, { ...base, yaw, speaker: state.stage === "handoff" });
    visitExchanges.set(targetId, { ...base, yaw: yaw + Math.PI, speaker: state.stage === "receiving" });
  };
  for (const { journey, placedBridge } of visibleBridgeJourneys) {
    const signal = bridgeJourneySignal(layout, journey);
    const route = signal && bridgeTransitVisualRoute(layout, placedBridge, signal);
    if (route) addExchange(journey.id, journey.targetAgentId, route.route, false);
  }
  for (const { visit, route } of visibleLocalVisits) addExchange(visit.id, visit.targetAgentId, route, true);
  if (activeHumanJourney && activeHumanRoute) {
    const state = humanVisualStates.get(activeHumanJourney.id);
    if (state?.stage === "handoff") {
      const visitor = activeHumanRoute.points.at(-1)!;
      const target = sceneMessageRouteNode(
        layout.workspaces.find((workspace) => workspace.workspace.id === activeHumanJourney.workspaceId)!,
        activeHumanJourney.targetAgentId
      )?.point ?? activeHumanRoute.points.at(-1)!;
      const yaw = Math.atan2(target[0] - visitor[0], target[2] - visitor[2]);
      const base = { visitId: activeHumanJourney.id, states: humanVisualStates, durationMs: WORKSPACE_SPATIAL_HUMAN_HANDOFF_MS };
      visitExchanges.set(`human:${activeHumanJourney.id}`, { ...base, yaw, speaker: true });
      visitExchanges.set(activeHumanJourney.targetAgentId, { ...base, yaw: yaw + Math.PI, speaker: false });
    }
  }

  useEffect(() => {
    if (ambientOverrideActive) {
      ambientCadenceRef.current = null;
      previousAmbientAssignmentsRef.current = [];
      if (ambientAssignments.length > 0) setAmbientAssignments([]);
      return;
    }
    if (!framePolicy.motionAllowed) {
      ambientCadenceRef.current = null;
      previousAmbientAssignmentsRef.current = [];
      if (ambientAssignments.length > 0) setAmbientAssignments([]);
      return;
    }

    if (ambientAssignments.length > 0 && ambientAssignments.every((assignment) => assignment.cancelledAtMs !== undefined)) {
      const remainingMs = ambientEndsAtMs - Date.now();
      if (remainingMs <= 0) {
        setAmbientAssignments([]);
        return;
      }
      const timer = window.setTimeout(() => setAmbientAssignments([]), remainingMs);
      return () => window.clearTimeout(timer);
    }

    if (!ambientEligibilityKey.startsWith("idle|")) {
      // 真实工作或资源变化立即停止 ambient 语义；离开状态屏的人物保留有限回座帧。
      ambientCadenceRef.current = null;
      previousAmbientAssignmentsRef.current = [];
      if (ambientAssignments.length > 0) {
        setAmbientAssignments(workspaceSpatialCancelAmbientAssignments(ambientAssignments, Date.now()));
      }
      return;
    }

    if (ambientAssignments.length > 0) {
      if (ambientAssignments[0]?.eligibilityKey !== ambientEligibilityKey) {
        // roster 或 Device 状态变化时不瞬移状态屏访客，先完成有限回座。
        ambientCadenceRef.current = null;
        previousAmbientAssignmentsRef.current = [];
        setAmbientAssignments(workspaceSpatialCancelAmbientAssignments(ambientAssignments, Date.now()));
        return;
      }
      const remainingMs = ambientEndsAtMs - Date.now();
      if (remainingMs <= 0) {
        previousAmbientAssignmentsRef.current = ambientAssignments;
        const currentCadence = ambientCadenceRef.current;
        ambientCadenceRef.current = workspaceSpatialAmbientCadence(
          ambientEligibilityKey,
          Date.now(),
          currentCadence?.eligibilityKey === ambientEligibilityKey ? currentCadence.cycle + 1 : 1
        );
        setAmbientAssignments([]);
        return;
      }
      const timer = window.setTimeout(() => {
        // 一个有限行为完整结束后才进入 4–6 分钟 cooldown，并保留上次动作供去重。
        previousAmbientAssignmentsRef.current = ambientAssignments;
        const currentCadence = ambientCadenceRef.current;
        ambientCadenceRef.current = workspaceSpatialAmbientCadence(
          ambientEligibilityKey,
          Date.now(),
          currentCadence?.eligibilityKey === ambientEligibilityKey ? currentCadence.cycle + 1 : 1
        );
        setAmbientAssignments([]);
      }, remainingMs);
      return () => window.clearTimeout(timer);
    }

    let cadence = ambientCadenceRef.current;
    if (!cadence || cadence.eligibilityKey !== ambientEligibilityKey) {
      // 新的稳定 idle 资格先进入一次 4–8 秒 Opening Shift；完整行为后仍走 4–6 分钟 cooldown。
      cadence = workspaceSpatialAmbientCadence(ambientEligibilityKey, Date.now(), 0);
      ambientCadenceRef.current = cadence;
      previousAmbientAssignmentsRef.current = [];
    }
    if (!cadence) return;

    const timer = window.setTimeout(() => {
      const latestScene = latestSceneRef.current;
      if (workspaceSpatialAmbientEligibilityKey(latestScene) !== ambientEligibilityKey) return;
      setAmbientAssignments(workspaceSpatialAmbientAssignments(
        latestScene,
        Date.now(),
        cadence.cycle,
        previousAmbientAssignmentsRef.current
      ));
    }, Math.max(0, cadence.scheduledAtMs - Date.now()));
    return () => window.clearTimeout(timer);
  }, [ambientAssignments.length, ambientEligibilityKey, ambientEndsAtMs, ambientOverrideActive, framePolicy.motionAllowed]);

  useEffect(() => {
    invalidateRef.current();
  }, [ambientRunKey]);

  function moveCamera(target: THREE.Vector3, zoom: number) {
    const camera = cameraRef.current;
    if (!camera) return;
    const controls = controlsRef.current;
    camera.position.copy(HOME_CAMERA).add(target);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    controls?.target.copy(target);
    controls?.update();
    invalidateRef.current();
  }

  function focusCamera(target: THREE.Vector3, zoom: number) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    camera.position.copy(target).add(offset);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    controls.target.copy(target);
    controls.update();
    invalidateRef.current();
  }

  useImperativeHandle(ref, () => ({
    zoomIn() {
      const camera = cameraRef.current;
      if (!camera) return;
      camera.zoom = Math.min(MAX_SCENE_ZOOM, camera.zoom + 4);
      camera.updateProjectionMatrix();
      invalidateRef.current();
    },
    zoomOut() {
      const camera = cameraRef.current;
      if (!camera) return;
      camera.zoom = Math.max(MIN_SCENE_ZOOM, camera.zoom - 4);
      camera.updateProjectionMatrix();
      invalidateRef.current();
    },
    fit() {
      moveCamera(HOME_TARGET, defaultSceneZoom * (presentation !== "campus" ? fitRatioRef.current : 1));
    },
    focus() {
      const target = layout.focusByKey.get(workspaceSpatialSelectionKey(selection) ?? "") ?? HOME_TARGET;
      focusCamera(target, 58);
    },
    focusTarget(nextSelection) {
      const target = layout.focusByKey.get(workspaceSpatialSelectionKey(nextSelection) ?? "") ?? HOME_TARGET;
      focusCamera(target, 58);
    },
    focusChain(chainId) {
      const chainFocus = layout.chainFocusById.get(chainId);
      if (!chainFocus) return;
      focusCamera(chainFocus.target, chainFocus.zoom);
    },
    focusBridgeMessage(bridgeId) {
      const bridge = layout.bridges.find((candidate) => candidate.bridge.id === bridgeId);
      if (!bridge) return;
      const points = [
        bridge.sourceController ?? bridge.sourceGateway,
        bridge.sourceGateway,
        bridge.targetGateway,
        bridge.targetController ?? bridge.targetGateway
      ].map((point) => new THREE.Vector3(...point));
      const bounds = new THREE.Box3().setFromPoints(points);
      const target = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.z);
      // Bridge rehearsal 展示的是完整消息旅程，不把镜头只锁在桥体装饰上。
      focusCamera(target, THREE.MathUtils.clamp(54 - span * 1.35, 30, 46));
    },
    resetAngle() {
      const controls = controlsRef.current;
      moveCamera(controls?.target ?? HOME_TARGET, cameraRef.current?.zoom ?? 32);
    }
  }), [defaultSceneZoom, layout, selection, presentation]);

  return (
    <Canvas
      shadows={presentation !== "campus" ? "percentage" : false}
      orthographic
      dpr={[1, 2]}
      // 权威工作使用 always；ambient 保持 demand 并由有限帧驱动器续帧，结束后立即静止。
      frameloop={framePolicy.initialFrameloop}
      camera={{ position: HOME_CAMERA.toArray(), zoom: defaultSceneZoom, near: 0.1, far: 180 }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ camera, invalidate, setEvents }) => {
        camera.lookAt(HOME_TARGET);
        cameraRef.current = camera as THREE.OrthographicCamera;
        invalidateRef.current = invalidate;
        setSceneEventsEnabledRef.current = (enabled) => setEvents({ enabled });
      }}
      onPointerMissed={() => {
        setHoveredKey(null);
        onSelect(null);
      }}
    >
      {presentation !== "campus" && <WorkspaceBuildingCameraFit zoom={defaultSceneZoom} fitRatioRef={fitRatioRef} />}
      <color attach="background" args={["#f5f8fa"]} />
      <fog attach="fog" args={["#f5f8fa", presentation !== "campus" ? 48 : 35, presentation !== "campus" ? 82 : 72]} />
      <WorkspaceBuildingPresentationContext.Provider value={presentation !== "campus"}>
      <VisitChoreographyContext.Provider value={{ exchanges: visitExchanges, revision: visitRevision, stageChanged: visitStageChanged }}>
      {presentation !== "campus" && <ReferenceOfficeLighting />}
      <ambientLight intensity={presentation !== "campus" ? .24 : .56} />
      <hemisphereLight args={["#ffffff", "#aab9bf", presentation !== "campus" ? .4 : .8]} />
      <directionalLight
        castShadow
        position={presentation !== "campus" ? [14, 18, -10] : [-12, 26, 14]}
        intensity={presentation !== "campus" ? 2.6 : 1.48}
        shadow-bias={-.00015}
        shadow-normalBias={.025}
        color="#fffdf8"
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
      />
      {/* 贴图加载只暂停地面层，先呈现工作区结构和实时执行状态。 */}
      <Suspense fallback={null}>
        {presentation !== "campus" ? <ReferenceTownContext sites={layout.workspaces} /> : <SpatialAtlasGround src={workspaceAtlasGroundUrl} width={100} depth={50} y={-0.48} opacity={0.66} fadeEdges />}
      </Suspense>
      <SceneFrameLoopDriver
        active={framePolicy.runtimeFrameloopActive}
      />

      {activeHumanJourney && activeHumanRoute ? (
        <HumanJourneyWalker
          key={activeHumanJourney.id}
          journey={activeHumanJourney}
          route={activeHumanRoute}
          initialState={activeHumanCheckpoint}
          visualStates={humanVisualStates}
          onStageChange={visitStageChanged}
          onCheckpoint={(state) => {
            try { saveWorkspaceSpatialHumanJourneyCheckpoint(window.sessionStorage, scene.current.id, activeHumanJourney.id, state); }
            catch { /* Human 行程仍可完成。 */ }
          }}
          onComplete={completeHumanJourneyVisual}
        />
      ) : (
        <HumanPresence
          id={scene.human.id}
          displayName={scene.human.displayName}
          workspaceId={scene.current.id}
          position={workspaceSpatialHumanHome(layout.workspaces.find((workspace) => workspace.workspace.current) ?? layout.workspaces[0]!)}
        />
      )}

      {layout.workspaces.map((placedWorkspace) => (
        <WorkspaceArchitecture
          key={placedWorkspace.workspace.id}
          placed={placedWorkspace}
          bridges={layout.bridges}
          hiddenControllerKeys={hiddenDirectControllerKeys}
          deferredBridgeExecutionIds={deferredBridgeExecutionIds}
          deferredBridgeRequestMessageIds={deferredBridgeRequestMessageIds}
          deferredBridgeControllerKeys={deferredBridgeControllerKeys}
          controllerJourneyStatuses={controllerJourneyStatuses}
          ambientAssignments={activeAmbientAssignments}
          messageAttention={messageAttention}
          selection={selection}
          focusedRoomKey={focusedRoomKey}
          agentTextModes={agentTextModes}
          hoveredKey={hoveredKey}
          onHover={setHoveredKey}
          onSelect={onSelect}
        />
      ))}
      {layout.bridges.map((placedBridge) => {
        const visibleJourneyIndex = visibleBridgeJourneys.findIndex((candidate) => candidate.placedBridge.bridge.id === placedBridge.bridge.id);
        const visibleJourney = visibleJourneyIndex >= 0 ? visibleBridgeJourneys[visibleJourneyIndex] : undefined;
        return (
        <WorkspaceBridgeVisual
          key={placedBridge.bridge.id}
          layout={layout}
          placed={placedBridge}
          signal={bridgeTransit.signals.get(placedBridge.bridge.id)}
          lifecycleSignal={placedBridge.bridge.signals[0]}
          journey={visibleJourney?.journey}
          visitStates={visitStore.states}
          onCheckpoint={persistVisits}
          selected={selection?.kind === "bridge" && selection.id === placedBridge.bridge.id}
          hovered={hoveredKey === `bridge:${placedBridge.bridge.id}`}
          onHover={setHoveredKey}
          onSelect={() => onSelect({ kind: "bridge", id: placedBridge.bridge.id })}
          onPlaybackComplete={bridgeTransit.completePlayback}
          onJourneyHandoffComplete={completeBridgeJourneyHandoff}
          onJourneyVisualComplete={completeBridgeJourneyVisual}
        />
      )})}
      {visibleLocalVisits.map(({ visit, sourceAgent, targetAgent, route }) => {
        const workspace = layout.workspaces.find((candidate) => candidate.workspace.id === visit.workspaceId)?.workspace;
        return (
        <BridgeJourneyWalker
          key={visit.id}
          journey={visit}
          route={route}
          sourceAgent={sourceAgent}
          targetLabel={targetAgent.displayName}
          localVisit
          actorMode={visit.actorMode}
          actorLabel={workspaceSpatialVisitActorLabel({
            sourceOwnerName: workspace?.ownerName ?? sourceAgent.displayName,
            targetWorkspaceName: workspace?.name ?? "Workspace",
            localVisit: true
          })}
          visitStates={visitStore.states}
          onCheckpoint={persistVisits}
          selected={selection?.kind === "agent" && selection.workspaceId === visit.workspaceId && selection.id === sourceAgent.id}
          onSelect={() => onSelect({ kind: "agent", workspaceId: visit.workspaceId, id: sourceAgent.id })}
          onHandoffComplete={completeBridgeJourneyHandoff}
          onVisualComplete={completeBridgeJourneyVisual}
        />
      )})}
      {hiddenVisitActorCount > 0 && (
        <ParallelCloneOverflowBadge
          count={hiddenVisitActorCount}
          placed={layout.workspaces.find((workspace) => workspace.workspace.current) ?? layout.workspaces[0]!}
        />
      )}
      <WorkspaceMessageJourneys
        layout={layout}
        deferredBridgeExecutionIds={deferredBridgeExecutionIds}
        deferredBridgeRequestMessageIds={deferredBridgeRequestMessageIds}
        selection={selection}
        onSelect={onSelect}
        ownedVisitExecutionIds={new Set([...visitStore.states.keys()].filter((id) => id.startsWith("agent-visit:")).map((id) => id.slice("agent-visit:".length)))}
      />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableRotate
        // Drei's damping loop keeps invalidating a demand Canvas even after
        // scene activity stops. Idle interaction remains responsive without
        // inertia; damping only returns during a real activity/flow window.
        enableDamping={framePolicy.controlsDamping}
        dampingFactor={0.08}
        // 保留上方观察边界，但开放完整水平环绕和足够的俯仰范围，避免视角被误认为锁死。
        minPolarAngle={MIN_ORBIT_POLAR_ANGLE}
        maxPolarAngle={MAX_ORBIT_POLAR_ANGLE}
        minZoom={MIN_SCENE_ZOOM}
        maxZoom={MAX_SCENE_ZOOM}
        screenSpacePanning
        zoomToCursor
        onStart={() => {
          // 相机手势期间不需要实体 Hover；暂停 picking 可避免 pointermove 对嵌套 Workspace / Room / Agent 子树重复 raycast。
          setHoveredKey(null);
          setSceneEventsEnabledRef.current(false);
          onInteract?.();
        }}
        onEnd={() => {
          setSceneEventsEnabledRef.current(true);
          invalidateRef.current();
        }}
      />
      </VisitChoreographyContext.Provider>
      </WorkspaceBuildingPresentationContext.Provider>
    </Canvas>
  );
});

// 非场景数据更新会让外层 Workspace 页面重新渲染；稳定 props 下保留同一 R3F 子树，避免无意义的 scene reconciliation。
export const WorkspaceSpatialSceneCanvas = memo(WorkspaceSpatialSceneCanvasComponent);

function bridgeJourneyDeferredAgent(
  agent: WorkspaceSpatialAgent,
  deferredExecutionIds: ReadonlySet<string>,
  forceDeferred = false
): WorkspaceSpatialAgent {
  const activityDeferred = Boolean(
    agent.activity && deferredExecutionIds.has(agent.activity.executionId)
  );
  if (!forceDeferred && !activityDeferred) return agent;
  // 同一 Agent 的其他真实 execution 仍可展示；只遮住尚未完成视觉交接的 Bridge execution。
  if (forceDeferred && agent.activity && !activityDeferred) return agent;
  return {
    ...agent,
    state: agent.state === "offline" || agent.state === "error" ? agent.state : "online",
    activity: undefined,
    communicationProgress: undefined
  };
}

function WorkspaceArchitecture({ placed, bridges, hiddenControllerKeys, deferredBridgeExecutionIds, deferredBridgeRequestMessageIds, deferredBridgeControllerKeys, controllerJourneyStatuses, ambientAssignments, messageAttention, selection, focusedRoomKey, agentTextModes, hoveredKey, onHover, onSelect }: {
  placed: SceneLayoutWorkspace;
  bridges: SceneLayoutBridge[];
  hiddenControllerKeys: Set<string>;
  deferredBridgeExecutionIds: Set<string>;
  deferredBridgeRequestMessageIds: Set<string>;
  deferredBridgeControllerKeys: Set<string>;
  controllerJourneyStatuses: Map<string, TopologyBridgeJourneyRecord>;
  ambientAssignments: WorkspaceSpatialAmbientAssignment[];
  messageAttention: boolean;
  selection: WorkspaceSpatialSelection | null;
  focusedRoomKey: string | null;
  agentTextModes: Record<string, WorkspaceSpatialAgentTextMode>;
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
  onSelect: (selection: WorkspaceSpatialSelection) => void;
}) {
  const buildingPresentation = useContext(WorkspaceBuildingPresentationContext);
  const { workspace } = placed;
  const { theme } = placed;
  const bridgeFlowIsDeferred = useCallback((flow: WorkspaceSpatialFlowSignal) => (
    deferredBridgeExecutionIds.has(flow.executionId)
    || Boolean(
      flow.bridgeRequestMessageId
      && deferredBridgeRequestMessageIds.has(flow.bridgeRequestMessageId)
    )
  ), [deferredBridgeExecutionIds, deferredBridgeRequestMessageIds]);
  const visibleFlows = useMemo(
    () => workspace.flows.filter((flow) => !bridgeFlowIsDeferred(flow)),
    [bridgeFlowIsDeferred, workspace.flows]
  );
  const deferredRoomAgentIds = useMemo(() => new Set(
    workspace.flows.flatMap((flow) => (
      bridgeFlowIsDeferred(flow)
        ? [flow.sourceAgentId, flow.targetAgentId].filter((agentId): agentId is string => Boolean(agentId))
        : []
    ))
  ), [bridgeFlowIsDeferred, workspace.flows]);
  const visibleFlowIds = useMemo(() => new Set(visibleFlows.map((flow) => flow.id)), [visibleFlows]);
  const visualWorkspace = useMemo<WorkspaceSpatialWorkspace>(() => ({
    ...workspace,
    flows: visibleFlows,
    flowChains: workspace.flowChains
      .map((chain) => ({ ...chain, flows: chain.flows.filter((flow) => visibleFlowIds.has(flow.id)) }))
      .filter((chain) => chain.flows.length > 0)
  }), [visibleFlowIds, visibleFlows, workspace]);
  const selected = selection?.kind === "workspace" && selection.workspaceId === workspace.id;
  const workspaceKey = `workspace:${workspace.id}`;
  const hovered = hoveredKey === workspaceKey;
  const workspaceNodeState = resolveLivingTopologyNodeState({
    kind: "server",
    resourceStatus: workspace.status,
    aggregateStates: [
      ...workspace.controllers,
      ...workspace.rooms.flatMap((room) => room.agents)
    ].map(workspaceSpatialAgentNodeState)
  });
  const accent = workspaceNodeState.phase === "idle"
    ? theme.accent
    : LIVING_TOPOLOGY_PALETTE[workspaceNodeState.tone].accent;
  const controllerOrigin = workspaceControllerOrigin(placed);
  // Workspace 铭牌固定在默认相机可见的外沿，并以圆盘半径为法线贴在底座侧面。
  const labelAngle = workspaceRimLabelAngle(placed, bridges);
  const labelRadius = placed.radius + 0.31;
  const labelPosition: [number, number, number] = [
    Math.sin(labelAngle) * labelRadius,
    0.18,
    Math.cos(labelAngle) * labelRadius
  ];
  const crossRoomResultRelay = workspace.current
    ? workspaceSpatialCrossRoomResultRelay(visualWorkspace, Date.now())
    : null;
  const crossRoomResultRoute = (() => {
    if (!crossRoomResultRelay) return null;
    const sourceRoomIndex = placed.rooms.findIndex((room) => room.room.id === crossRoomResultRelay.sourceRoomId);
    const targetRoomIndex = placed.rooms.findIndex((room) => room.room.id === crossRoomResultRelay.targetRoomId);
    const sourceRoom = sourceRoomIndex >= 0 ? placed.rooms[sourceRoomIndex] : undefined;
    const targetRoom = targetRoomIndex >= 0 ? placed.rooms[targetRoomIndex] : undefined;
    if (!sourceRoom || !targetRoom) return null;
    const requesterIndex = targetRoom.room.visibleAgents.findIndex((agent) => (
      agent.id === crossRoomResultRelay.requesterAgentId
    ));
    const requesterSlot = requesterIndex >= 0
      ? agentSlots(targetRoom.room.visibleAgents.length, targetRoom.width)[requesterIndex]
      : undefined;
    if (!requesterSlot) return null;
    const controllerStartX = controllerOrigin.x + 0.45;
    const controllerStartZ = controllerOrigin.z - 0.15;
    const sourceLaneX = controllerStartX - 0.18 - sourceRoomIndex * 0.23;
    const targetLaneX = controllerStartX - 0.18 - targetRoomIndex * 0.23;
    const sourceDispatchZ = sourceRoom.z + sourceRoom.depth / 2 - 0.3;
    const targetDispatchZ = targetRoom.z + targetRoom.depth / 2 - 0.3;
    // 路径逐段复用 source gateway → 两条 DispatchLink → target gateway；只抬高 folio，不新增第二套拓扑线。
    const points: [number, number, number][] = [
      [sourceRoom.x + sourceRoom.width / 2 - 0.42, 1.42, sourceRoom.z + sourceRoom.depth / 2 - 0.52],
      [sourceRoom.x, 1.32, sourceDispatchZ],
      [sourceLaneX, 1.32, sourceDispatchZ],
      [sourceLaneX, 1.32, controllerStartZ],
      [controllerStartX, 1.32, controllerStartZ],
      [targetLaneX, 1.32, controllerStartZ],
      [targetLaneX, 1.32, targetDispatchZ],
      [targetRoom.x, 1.32, targetDispatchZ],
      [targetRoom.x + targetRoom.width / 2 - 0.42, 1.42, targetRoom.z + targetRoom.depth / 2 - 0.52],
      [targetRoom.x + requesterSlot.x, 1.52, targetRoom.z + requesterSlot.z + 0.34]
    ];
    return { relay: crossRoomResultRelay, points };
  })();
  return (
    <group
      position={[placed.x, 0, placed.z]}
      onPointerOver={(event) => { event.stopPropagation(); onHover(workspaceKey); }}
      onPointerOut={(event) => { event.stopPropagation(); onHover(null); }}
      onClick={(event) => stopAndSelect(event, () => onSelect({ kind: "workspace", workspaceId: workspace.id }))}
    >
      {buildingPresentation ? <WorkspaceBuildingShell radius={placed.radius} /> : <>
      <mesh position={[0, -0.18, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[placed.radius + 0.2, placed.radius + 0.32, 0.38, 96]} />
        <meshStandardMaterial color={theme.base} roughness={0.76} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.035, 0]} receiveShadow>
        <cylinderGeometry args={[placed.radius, placed.radius + 0.08, 0.17, 96]} />
        <meshStandardMaterial color={theme.surface} roughness={0.67} metalness={0.045} />
      </mesh>
      <WorkspaceGlassCanopy
        radius={placed.radius}
        accent={accent}
        selected={selected}
        hovered={hovered}
      />
      <WorkspacePerimeter radius={placed.radius} accent={accent} selected={selected} hovered={hovered} />
      </>}
      <WorkspaceRimLabel
        workspace={workspace}
        theme={theme}
        selected={selected}
        hovered={hovered}
        workspaceKey={workspaceKey}
        position={buildingPresentation ? [0, .18, placed.radius + .4] : labelPosition}
        rotationY={buildingPresentation ? 0 : labelAngle}
        onHover={onHover}
        onSelect={() => onSelect({ kind: "workspace", workspaceId: workspace.id })}
      />
      {workspace.controllers.map((controller, index) => {
        const controllerKey = `${workspace.id}:${controller.id}`;
        const bridgeJourneyStatus = controllerJourneyStatuses.get(controllerKey);
        const visualController = bridgeJourneyDeferredAgent(
          controller,
          deferredBridgeExecutionIds,
          deferredBridgeControllerKeys.has(controllerKey)
        );
        const stationPosition: [number, number, number] = [controllerOrigin.x + index * 1.15, controllerOrigin.y, controllerOrigin.z];
        const attention = workspaceSpatialAgentAttention(visualController, visibleFlows);
        const counterpartyRoom = attention?.counterpartyAgentId
          ? placed.rooms.find((room) => room.room.agents.some((agent) => agent.id === attention.counterpartyAgentId))
          : undefined;
        const attentionTarget = workspace.current && counterpartyRoom
          ? {
              x: counterpartyRoom.x - stationPosition[0],
              // AgentFigure 在控制台内还有 0.24 的前向偏移；目标必须换算到人物自身的局部坐标。
              z: counterpartyRoom.z + counterpartyRoom.depth / 2 - 0.3 - (stationPosition[2] + 0.24)
            }
          : undefined;
        return (
          <TyrControlStation
            key={controller.id}
            agent={visualController}
            animated={workspace.current}
            peerWorkspace={!workspace.current}
            position={stationPosition}
            attentionTarget={attentionTarget}
            attentionTone={attentionTarget ? attention?.tone : undefined}
            bridgeJourneyStatus={bridgeJourneyStatus}
            statusSide={workspace.current ? "left" : "right"}
            agentVisible={!hiddenControllerKeys.has(controllerKey)}
            selected={selection?.kind === "agent" && selection.workspaceId === workspace.id && selection.id === controller.id}
            hovered={hoveredKey === `agent:${workspace.id}:${controller.id}`}
            onHover={onHover}
            onSelect={() => onSelect({ kind: "agent", workspaceId: workspace.id, id: controller.id })}
          />
        );
      })}
      {crossRoomResultRoute && (
        <CrossRoomResultRelay
          relay={crossRoomResultRoute.relay}
          points={crossRoomResultRoute.points}
          animated={workspace.current}
          onSelect={() => {
            const executionId = crossRoomResultRoute.relay.convergence.contributions[0]?.responseExecutionId;
            if (executionId) onSelect({ kind: "flow", workspaceId: workspace.id, executionId });
          }}
        />
      )}
      {placed.rooms.map((room) => (
        <DeviceRoomArchitecture
          key={room.room.id}
          placed={room}
          workspace={visualWorkspace}
          flows={visibleFlows}
          deferredBridgeExecutionIds={deferredBridgeExecutionIds}
          deferredBridgeAgentIds={deferredRoomAgentIds}
          crossRoomResultRelay={crossRoomResultRelay}
          ambientAssignments={ambientAssignments}
          messageAttention={messageAttention}
          selection={selection}
          focusedRoomKey={focusedRoomKey}
          agentTextModes={agentTextModes}
          hoveredKey={hoveredKey}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

/** Open-front architectural cutaway. Device rooms and all motion remain in their original coordinates. */
function WorkspaceBuildingCameraFit({ zoom, fitRatioRef }: { zoom: number; fitRatioRef: { current: number } }) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    // The square cutaway includes its rear facade; retain room for the scene controls.
    fitRatioRef.current = Math.min(1, size.width / 900, size.height / 640);
    const orthographic = camera as THREE.OrthographicCamera;
    orthographic.zoom = zoom * fitRatioRef.current;
    orthographic.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, zoom, fitRatioRef, invalidate]);
  return null;
}

function WorkspaceBuildingShell({ radius }: { radius: number }) {
  return <ReferenceOfficeShell radius={radius} />;
}

function WorkspaceGlassCanopy({ radius, accent, selected, hovered }: {
  radius: number;
  accent: string;
  selected: boolean;
  hovered: boolean;
}) {
  const shellRadius = radius + 0.34;
  const baseY = 0.16;
  const wallHeight = THREE.MathUtils.clamp(radius * 0.18, 1.25, 2);
  const domeHeight = THREE.MathUtils.clamp(radius * 0.68, 3.65, 7.2);
  const shoulderY = baseY + wallHeight;
  const ringPoints = useMemo<[number, number, number][]>(() => Array.from({ length: 81 }, (_, index) => {
    const angle = index / 80 * Math.PI * 2;
    return [Math.cos(angle) * shellRadius, baseY, Math.sin(angle) * shellRadius];
  }), [shellRadius]);
  const shellOpacity = selected ? 0.028 : hovered ? 0.022 : 0.014;
  const edgeOpacity = selected ? 0.2 : hovered ? 0.16 : 0.12;
  const rimOpacity = selected ? 0.92 : hovered ? 0.76 : 0.58;
  const glassUniforms = useMemo(() => ({
    uColor: { value: new THREE.Color(accent) },
    uBaseOpacity: { value: shellOpacity },
    uEdgeOpacity: { value: edgeOpacity }
  }), [accent, edgeOpacity, shellOpacity]);
  const innerGlowUniforms = useMemo(() => ({
    // 浅色无地面场景会吞掉 Additive 透明层；内壁使用偏白主题色保持低对比但可辨识的向内光晕。
    uColor: { value: new THREE.Color(accent).lerp(new THREE.Color("#f7ffff"), 0.48) },
    uBaseOpacity: { value: selected ? 0.026 : hovered ? 0.021 : 0.017 },
    uEdgeOpacity: { value: selected ? 0.082 : hovered ? 0.066 : 0.052 }
  }), [accent, hovered, selected]);
  const innerShellRadius = shellRadius * 0.985;
  const innerDomeHeight = domeHeight * 0.985;

  return (
    <group>
      <mesh
        position={[0, baseY + wallHeight / 2, 0]}
        renderOrder={4}
        raycast={() => undefined}
      >
        <cylinderGeometry args={[innerShellRadius, innerShellRadius, wallHeight * 0.985, 96, 1, true]} />
        <shaderMaterial
          uniforms={innerGlowUniforms}
          vertexShader={CRYSTAL_GLASS_VERTEX_SHADER}
          fragmentShader={CRYSTAL_INNER_GLOW_FRAGMENT_SHADER}
          transparent
          blending={THREE.NormalBlending}
          side={THREE.BackSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh
        position={[0, shoulderY, 0]}
        scale={[innerShellRadius, innerDomeHeight, innerShellRadius]}
        renderOrder={4}
        raycast={() => undefined}
      >
        <sphereGeometry args={[1, 96, 40, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <shaderMaterial
          uniforms={innerGlowUniforms}
          vertexShader={CRYSTAL_GLASS_VERTEX_SHADER}
          fragmentShader={CRYSTAL_INNER_GLOW_FRAGMENT_SHADER}
          transparent
          blending={THREE.NormalBlending}
          side={THREE.BackSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh
        position={[0, baseY + wallHeight / 2, 0]}
        renderOrder={5}
        raycast={() => undefined}
      >
        <cylinderGeometry args={[shellRadius, shellRadius, wallHeight, 96, 1, true]} />
        <shaderMaterial
          uniforms={glassUniforms}
          vertexShader={CRYSTAL_GLASS_VERTEX_SHADER}
          fragmentShader={CRYSTAL_GLASS_FRAGMENT_SHADER}
          transparent
          blending={THREE.AdditiveBlending}
          side={THREE.FrontSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh
        position={[0, shoulderY, 0]}
        scale={[shellRadius, domeHeight, shellRadius]}
        renderOrder={5}
        raycast={() => undefined}
      >
        <sphereGeometry args={[1, 96, 40, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <shaderMaterial
          uniforms={glassUniforms}
          vertexShader={CRYSTAL_GLASS_VERTEX_SHADER}
          fragmentShader={CRYSTAL_GLASS_FRAGMENT_SHADER}
          transparent
          blending={THREE.AdditiveBlending}
          side={THREE.FrontSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <Line
        points={ringPoints}
        color={accent}
        lineWidth={selected ? 2.7 : hovered ? 2.15 : 1.65}
        transparent
        opacity={rimOpacity}
        depthWrite={false}
        raycast={() => undefined}
      />
      <mesh position={[0, baseY - 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => undefined}>
        <ringGeometry args={[shellRadius - 0.16, shellRadius + 0.14, 96]} />
        <meshBasicMaterial
          color={accent}
          transparent
          opacity={selected ? 0.24 : hovered ? 0.18 : 0.105}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function WorkspacePerimeter({ radius, accent, selected, hovered }: { radius: number; accent: string; selected: boolean; hovered: boolean }) {
  const frontArc = useMemo<[number, number, number][]>(() => Array.from({ length: 41 }, (_, index) => {
    const angle = Math.PI * (0.2 + index / 40 * 0.6);
    return [Math.cos(angle) * (radius - 0.08), 0.018, Math.sin(angle) * (radius - 0.08)];
  }), [radius]);
  // Hover 只提供发现反馈；Selection 使用更强的边界亮度保持持久层级。
  return (
    <group position={[0, 0.14, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius - 0.08, 0.035, 10, 96]} />
        <meshStandardMaterial color="#92a4ad" transparent opacity={0.5} metalness={0.24} roughness={0.44} />
      </mesh>
      <Line
        points={frontArc}
        color={accent}
        lineWidth={selected ? 3.1 : hovered ? 2.45 : 1.8}
        transparent
        opacity={selected ? 0.86 : hovered ? 0.68 : 0.48}
        depthWrite={false}
      />
    </group>
  );
}

function WorkspaceRimLabel({ workspace, theme, selected, hovered, workspaceKey, position, rotationY, onHover, onSelect }: {
  workspace: WorkspaceSpatialWorkspace;
  theme: WorkspaceVisualTheme;
  selected: boolean;
  hovered: boolean;
  workspaceKey: string;
  position: [number, number, number];
  rotationY: number;
  onHover: (key: string | null) => void;
  onSelect: () => void;
}) {
  const labelWidth = THREE.MathUtils.clamp(2.7 + workspace.name.length * 0.095, 3.45, 5.1);
  const active = selected || hovered;
  return (
    <group
      position={position}
      rotation={[0, rotationY, 0]}
      onPointerOver={(event) => { event.stopPropagation(); onHover(workspaceKey); }}
      onPointerOut={(event) => { event.stopPropagation(); onHover(null); }}
      onClick={(event) => stopAndSelect(event, onSelect)}
    >
      {/* 固定切线角度与浅薄结构让铭牌成为底座的一部分，而不是始终追随镜头的悬浮路牌。 */}
      <RoundedBox args={[labelWidth + 0.2, 0.82, 0.105]} radius={0.17} smoothness={5} position={[0, 0, -0.035]}>
        <meshBasicMaterial
          color={theme.accent}
          transparent
          opacity={active ? 0.34 : 0.24}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </RoundedBox>
      <RoundedBox args={[labelWidth, 0.7, 0.17]} radius={0.14} smoothness={5} castShadow>
        <meshPhysicalMaterial
          color={theme.accent}
          emissive={theme.accent}
          emissiveIntensity={active ? 0.13 : 0.065}
          roughness={0.28}
          metalness={0.3}
          clearcoat={1}
          clearcoatRoughness={0.08}
        />
      </RoundedBox>
      <RoundedBox args={[labelWidth - 0.18, 0.5, 0.038]} radius={0.095} smoothness={4} position={[0, 0, 0.104]}>
        <meshStandardMaterial
          color={active ? "#ffffff" : "#edf8f7"}
          emissive="#ffffff"
          emissiveIntensity={active ? 0.05 : 0.018}
          roughness={0.42}
          metalness={0.015}
        />
      </RoundedBox>
      <SignFace
        text={workspace.name}
        width={labelWidth - 0.58}
        height={0.41}
        color="#173a42"
        position={[0, 0.008, 0.13]}
      />
      {([-1, 1] as const).map((side) => (
        <mesh key={side} position={[side * (labelWidth / 2 - 0.23), 0, 0.136]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.046, 0.046, 0.03, 16]} />
          <meshStandardMaterial color="#49636a" metalness={0.62} roughness={0.26} />
        </mesh>
      ))}
    </group>
  );
}

function TyrControlStation({ agent, animated, peerWorkspace, position, attentionTarget, attentionTone, bridgeJourneyStatus, statusSide, agentVisible = true, selected, hovered, onHover, onSelect }: {
  agent: WorkspaceSpatialAgent;
  animated: boolean;
  peerWorkspace: boolean;
  position: [number, number, number];
  attentionTarget?: WorkspaceSpatialPoint;
  attentionTone?: CommunicationFlowTone;
  bridgeJourneyStatus?: TopologyBridgeJourneyRecord;
  statusSide: "left" | "right";
  agentVisible?: boolean;
  selected: boolean;
  hovered: boolean;
  onHover: (key: string | null) => void;
  onSelect: () => void;
}) {
  const active = agentIsVisuallyActive(agent) || Boolean(agent.communicationProgress) || Boolean(bridgeJourneyStatus);
  const consoleStatus = bridgeJourneyStatus
    ? workspaceSpatialBridgeJourneyConsoleLabel(bridgeJourneyStatus)
    : agent.communicationProgress?.label;
  const consoleStatusColor = bridgeJourneyStatus?.phase === "returning"
    || bridgeJourneyStatus?.phase === "completed"
    ? "#fff0b5"
    : bridgeJourneyStatus?.phase === "failed"
      || bridgeJourneyStatus?.phase === "cancelled"
      ? "#ffd5cf"
      : agent.communicationProgress?.phase === "preparing_response"
        ? "#fff0b5"
        : "#dff8ff";
  const agentKey = `agent:${agent.workspaceId}:${agent.id}`;
  return (
    <group
      position={position}
      onPointerOver={(event) => { event.stopPropagation(); onHover(agentKey); }}
      onPointerOut={(event) => { event.stopPropagation(); onHover(null); }}
      onClick={(event) => stopAndSelect(event, onSelect)}
    >
      <mesh position={[0, -0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.62, 0.74, 48]} />
        <meshBasicMaterial color={active ? "#2fcab4" : "#5b94a3"} transparent opacity={active ? 0.8 : 0.38} toneMapped={false} />
      </mesh>
      <RoundedBox args={[1.45, 0.16, 0.7]} radius={0.08} smoothness={4} position={[0, 0.48, -0.22]} castShadow>
        <meshStandardMaterial color="#203844" metalness={0.58} roughness={0.28} />
      </RoundedBox>
      <mesh position={[0, 0.67, -0.18]} rotation={[-0.32, 0, 0]}>
        <boxGeometry args={[0.92, 0.36, 0.045]} />
        <meshStandardMaterial color="#17272e" metalness={0.48} roughness={0.22} />
      </mesh>
      <mesh position={[0, 0.67, -0.15]} rotation={[-0.32, 0, 0]}>
        <planeGeometry args={[0.78, 0.24]} />
        <meshBasicMaterial color={active ? "#6ce7d6" : "#75a7b2"} transparent opacity={0.84} toneMapped={false} />
      </mesh>
      {agent.communicationProgress && !bridgeJourneyStatus && (
        <TyrProgressAura progress={agent.communicationProgress} animated={animated} />
      )}
      {agentVisible && (
        <AgentFigure
          agent={agent}
          animated={animated}
          peerWorkspace={peerWorkspace}
          position={[0, 0.02, 0.24]}
          attentionTarget={attentionTarget}
          attentionTone={attentionTone}
          seated={false}
          selected={selected}
          hovered={hovered}
          orchestrator
          onHover={onHover}
          onSelect={onSelect}
        />
      )}
      {consoleStatus && (
        <SignFace
          text={consoleStatus}
          width={0.74}
          height={0.19}
          color={consoleStatusColor}
          position={[0, 0.68, -0.122]}
          rotation={[-0.32, 0, 0]}
        />
      )}
      {agentVisible && bridgeJourneyStatus && consoleStatus && (
        <Html
          position={[statusSide === "left" ? -0.72 : 0.72, 1.72, -0.22]}
          zIndexRange={[30, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div
            className={`spatial-tyr-console-status status-${statusSide} phase-${bridgeJourneyStatus.phase}`}
            role="status"
            aria-live="polite"
          >
            <span>TYR</span>
            <strong>{consoleStatus.replace(/^TYR · /, "")}</strong>
          </div>
        </Html>
      )}
    </group>
  );
}

function TyrProgressAura({ progress, animated }: {
  progress: NonNullable<WorkspaceSpatialAgent["communicationProgress"]>;
  animated: boolean;
}) {
  const orbitRef = useRef<THREE.Group>(null);
  const floorRef = useRef<THREE.Group>(null);
  const haloMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const reduceMotion = useReducedSceneMotion();
  const invalidate = useThree((state) => state.invalidate);
  const color = progress.phase === "preparing_response"
    ? "#f2b84b"
    : progress.phase === "running_action"
      ? "#38bdf8"
      : "#70d8ff";

  useFrame(({ clock }) => {
    if (!orbitRef.current || !floorRef.current || !haloMaterialRef.current) return;
    const moving = animated && !reduceMotion;
    const phase = clock.elapsedTime * (progress.phase === "running_action" ? 2.8 : 2.05);
    orbitRef.current.rotation.y = moving ? phase * 0.42 : 0.38;
    orbitRef.current.rotation.z = moving ? 0.32 + Math.sin(phase * 0.62) * 0.16 : 0.32;
    floorRef.current.scale.setScalar(moving ? 1 + Math.sin(phase) * 0.085 : 1);
    haloMaterialRef.current.opacity = moving ? 0.14 + (Math.sin(phase * 1.24) + 1) * 0.075 : 0.18;
    if (moving) invalidate();
  });

  return (
    <group raycast={() => undefined}>
      {/* TYR 光场只由 server progress 驱动：理解、路由、整理回复共享一个主体，不制造独立装饰事件。 */}
      <group ref={floorRef} position={[0, -0.105, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.78, 1.02, 64]} />
          <meshBasicMaterial color={color} transparent opacity={0.34} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.12, 64]} />
          <meshBasicMaterial ref={haloMaterialRef} color={color} transparent opacity={0.18} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      <group ref={orbitRef} position={[0, 1.34, 0]} rotation={[0.18, 0, 0.32]}>
        <mesh>
          <torusGeometry args={[0.72, 0.027, 12, 72]} />
          <meshBasicMaterial color={color} transparent opacity={0.78} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
        {Array.from({ length: 5 }, (_, index) => {
          const angle = index / 5 * Math.PI * 2;
          return (
            <mesh key={index} position={[Math.cos(angle) * 0.72, Math.sin(angle) * 0.72, 0]}>
              <sphereGeometry args={[index === 0 ? 0.075 : 0.045, 14, 12]} />
              <meshBasicMaterial color={index === 0 ? "#f4fbff" : color} transparent opacity={index === 0 ? 1 : 0.72} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

function RouteTerminal({ position, color, active }: { position: [number, number, number]; color: string; active: boolean }) {
  const ringRef = useRef<THREE.Mesh>(null);
  const reduceMotion = useReducedSceneMotion();
  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    const phase = (Math.sin(clock.elapsedTime * 4.2) + 1) / 2;
    const scale = active && !reduceMotion ? 0.92 + phase * 0.25 : 1;
    ringRef.current.scale.setScalar(scale);
    (ringRef.current.material as THREE.MeshBasicMaterial).opacity = active ? reduceMotion ? 0.76 : 0.64 + phase * 0.28 : 0.46;
  });
  return (
    <mesh ref={ringRef} position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.09, 0.15, 28]} />
      <meshBasicMaterial color={color} transparent opacity={active ? 0.82 : 0.46} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

function agentSlots(agentCount: number, roomWidth: number): Array<{ x: number; z: number; labelLift: number }> {
  if (agentCount <= 0) return [];
  const columns = agentCount <= 2 ? agentCount : agentCount <= 4 ? 2 : agentCount <= 8 ? 3 : 4;
  const rows = Math.ceil(agentCount / columns);
  const rowGap = rows <= 1 ? 0 : Math.min(1.5, 2.7 / (rows - 1));
  return Array.from({ length: agentCount }, (_, index) => {
    const row = Math.floor(index / columns);
    const rowStart = row * columns;
    const rowCount = Math.min(columns, agentCount - rowStart);
    const column = index - rowStart;
    const columnGap = rowCount <= 1 ? 0 : Math.min(1.7, (roomWidth - 1.45) / (rowCount - 1));
    return {
      x: -(rowCount - 1) * columnGap / 2 + column * columnGap + (row % 2 === 0 ? -0.1 : 0.1),
      // 行距与棋盘式错位同时拉开人物头部轮廓，避免正交俯视下前后排完全叠在一起。
      z: 0.12 + row * rowGap + ((column + row) % 2 === 0 ? -0.16 : 0.16),
      labelLift: (row % 3) * 0.3 + (column % 2) * 0.12
    };
  });
}

function DeviceRoomArchitecture({ placed, workspace, flows, deferredBridgeExecutionIds, deferredBridgeAgentIds, crossRoomResultRelay, ambientAssignments, messageAttention, selection, focusedRoomKey, agentTextModes, hoveredKey, onHover, onSelect }: {
  placed: SceneLayoutRoom;
  workspace: WorkspaceSpatialWorkspace;
  flows: WorkspaceSpatialFlowSignal[];
  deferredBridgeExecutionIds: Set<string>;
  deferredBridgeAgentIds: Set<string>;
  crossRoomResultRelay: WorkspaceSpatialCrossRoomResultRelayState | null;
  ambientAssignments: WorkspaceSpatialAmbientAssignment[];
  messageAttention: boolean;
  selection: WorkspaceSpatialSelection | null;
  focusedRoomKey: string | null;
  agentTextModes: Record<string, WorkspaceSpatialAgentTextMode>;
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
  onSelect: (selection: WorkspaceSpatialSelection) => void;
}) {
  const room = useMemo<WorkspaceSpatialRoom>(() => {
    if (deferredBridgeExecutionIds.size === 0 && deferredBridgeAgentIds.size === 0) return placed.room;
    const projectedAgents = new Map<string, WorkspaceSpatialAgent>();
    const projectAgent = (agent: WorkspaceSpatialAgent) => {
      const existing = projectedAgents.get(agent.id);
      if (existing) return existing;
      const projected = bridgeJourneyDeferredAgent(
        agent,
        deferredBridgeExecutionIds,
        deferredBridgeAgentIds.has(agent.id)
      );
      projectedAgents.set(agent.id, projected);
      return projected;
    };
    return {
      ...placed.room,
      agents: placed.room.agents.map(projectAgent),
      visibleAgents: placed.room.visibleAgents.map(projectAgent)
    };
  }, [deferredBridgeAgentIds, deferredBridgeExecutionIds, placed.room]);
  const deviceTheme = placed.theme;
  const selected = selection?.kind === "room" && selection.workspaceId === workspace.id && selection.id === room.id;
  const roomKey = `room:${workspace.id}:${room.id}`;
  const hovered = hoveredKey === roomKey;
  const deviceNodeState = resolveLivingTopologyNodeState({
    kind: "device",
    resourceStatus: room.status,
    aggregateStates: room.agents.map(workspaceSpatialAgentNodeState)
  });
  const statusColor = LIVING_TOPOLOGY_PALETTE[deviceNodeState.tone].accent;
  const slots = agentSlots(room.visibleAgents.length, placed.width);
  const agentMotions = room.visibleAgents.map(workspaceSpatialAgentMotion);
  const roomFocused = focusedRoomKey === roomKey;
  const runtimeRelay = workspaceSpatialRuntimeRelay(room);
  const relayAgentIndex = runtimeRelay
    ? room.visibleAgents.findIndex((agent) => agent.id === runtimeRelay.agentId)
    : -1;
  const relaySeat = relayAgentIndex >= 0 ? slots[relayAgentIndex] : undefined;
  const approvalAgent = room.agents.find((agent) => workspaceSpatialAgentMotion(agent).mode === "approval");
  const toolAgentIndex = agentMotions.findIndex((motion) => motion.mode === "tool");
  const toolAgent = workspace.current && toolAgentIndex >= 0 ? room.visibleAgents[toolAgentIndex] : undefined;
  const roomMechanic = workspaceSpatialRoomMechanic(room, flows);
  const roomOperational = workspaceSpatialRoomOperationalRhythm(roomMechanic, room.status);
  const roomAmbientAssignment = ambientAssignments.find((assignment) => (
    assignment.workspaceId === workspace.id && assignment.roomId === room.id
  ));
  // 真实 response 汇合是本轮更晚的 lineage 事实，必须压过仍留在窗口内的 request fan-out 与 Pair Handoff。
  const resultConvergence = workspace.current ? workspaceSpatialResultConvergence(room, flows, Date.now()) : null;
  const parallelDispatch = workspace.current && !resultConvergence
    ? workspaceSpatialParallelDispatch(room, flows, Date.now())
    : null;
  // 一组严格 direct siblings 优先呈现 fan-out；同一批 Flow 不再同时触发 Pair Handoff 的双人离座。
  const pairHandoff = workspace.current && !resultConvergence && !parallelDispatch
    ? workspaceSpatialPairHandoff(room, flows, Date.now())
    : null;
  const pairHandoffSourceDock = workspaceSpatialPairHandoffDock("source", placed.width, placed.depth);
  const pairHandoffTargetDock = workspaceSpatialPairHandoffDock("target", placed.width, placed.depth);
  const resultRecipientIndex = resultConvergence?.deliveryKind === "agent"
    ? room.visibleAgents.findIndex((agent) => agent.id === resultConvergence.targetAgentId)
    : -1;
  const resultRecipientSlot = resultRecipientIndex >= 0 ? slots[resultRecipientIndex] : undefined;
  const resultDestination: ResultConvergenceDestination | null = !resultConvergence
    ? null
    : resultConvergence.deliveryKind === "gateway"
      ? { kind: "gateway", x: placed.width / 2 - 0.42, y: 1.08, z: placed.depth / 2 - 0.52 }
      : resultRecipientSlot
        // requester 前侧手部高度是 direct receipt 的真实终点，不能沿用 room gateway 的落点。
        ? { kind: "agent", x: resultRecipientSlot.x, y: 1.18, z: resultRecipientSlot.z + 0.34 }
        : null;
  const approvalGatePosition: [number, number, number] = [-placed.width / 2 + 0.72, 0.08, placed.depth / 2 - 0.72];
  const toolStationPosition: [number, number, number] = [placed.width / 2 - 1.45, 0.14, -placed.depth / 2 + 1.02];
  return (
    <group
      position={[placed.x, 0.34, placed.z]}
      onPointerOver={(event) => { event.stopPropagation(); onHover(roomKey); }}
      onPointerOut={(event) => { event.stopPropagation(); onHover(null); }}
      onClick={(event) => stopAndSelect(event, () => onSelect({ kind: "room", workspaceId: workspace.id, id: room.id }))}
    >
      <RoomShell width={placed.width} depth={placed.depth} selected={selected} hovered={hovered} statusColor={statusColor} theme={deviceTheme} />
      <RoomSignalSpine
        operational={roomOperational}
        assignment={roomAmbientAssignment}
        animated={workspace.current}
        width={placed.width}
        depth={placed.depth}
      />
      <RoomAccessGate
        operational={roomOperational}
        animated={workspace.current}
        position={[placed.width / 2 - 0.04, 0.03, placed.depth / 2 - 0.55]}
      />
      <RoomEquipment
        kind={room.kind}
        width={placed.width}
        depth={placed.depth}
        operational={roomOperational}
        assignment={roomAmbientAssignment}
        animated={workspace.current}
      />
      <RefreshPoint
        assignment={roomAmbientAssignment}
        animated={workspace.current}
        position={[-placed.width / 2 + 0.42, 0.14, -0.1]}
      />
      <DeviceDoorPlaque
        room={room}
        theme={deviceTheme}
        selected={selected}
        hovered={hovered}
        position={[-placed.width / 2 + 1.3, 2.38, -placed.depth / 2 + 0.13]}
        onSelect={() => onSelect({ kind: "room", workspaceId: workspace.id, id: room.id })}
      />
      <PairHandoffBay
        handoff={pairHandoff}
        animated={workspace.current}
        sourceDock={pairHandoffSourceDock}
        targetDock={pairHandoffTargetDock}
        onSelect={() => {
          if (!pairHandoff) return;
          onSelect({ kind: "flow", workspaceId: workspace.id, executionId: pairHandoff.executionId });
        }}
      />
      <ParallelDispatchManifold
        dispatch={parallelDispatch}
        animated={workspace.current}
        center={{
          x: (pairHandoffSourceDock.x + pairHandoffTargetDock.x) / 2,
          z: (pairHandoffSourceDock.z + pairHandoffTargetDock.z) / 2
        }}
        endpoints={parallelDispatch?.targets.flatMap((target) => {
          const index = room.visibleAgents.findIndex((agent) => agent.id === target.targetAgentId);
          const slot = index >= 0 ? slots[index] : undefined;
          // task card 落在人物前侧手部范围，避免默认等距视角被身体与前墙遮住。
          return slot ? [{ agentId: target.targetAgentId, x: slot.x, z: slot.z + 0.34 }] : [];
        }) ?? []}
        onSelect={() => {
          const executionId = parallelDispatch?.targets[0]?.executionId;
          if (executionId) onSelect({ kind: "flow", workspaceId: workspace.id, executionId });
        }}
      />
      {resultConvergence && resultDestination && (
        <ResultConvergenceManifold
          convergence={resultConvergence}
          animated={workspace.current}
          center={{
            x: (pairHandoffSourceDock.x + pairHandoffTargetDock.x) / 2,
            z: (pairHandoffSourceDock.z + pairHandoffTargetDock.z) / 2
          }}
          destination={resultDestination}
          handoffContinues={Boolean(
            crossRoomResultRelay
            && crossRoomResultRelay.sourceRoomId === room.id
            && crossRoomResultRelay.convergence.id === resultConvergence.id
          )}
          endpoints={resultConvergence.contributions.flatMap((contribution) => {
            const index = room.visibleAgents.findIndex((agent) => agent.id === contribution.sourceAgentId);
            const slot = index >= 0 ? slots[index] : undefined;
            // response card 从人物前侧手部范围回收，路径在默认等距视角中保持可读。
            return slot ? [{ agentId: contribution.sourceAgentId, x: slot.x, z: slot.z + 0.34 }] : [];
          })}
          onSelect={() => {
            const executionId = resultConvergence.contributions[0]?.responseExecutionId;
            if (executionId) onSelect({ kind: "flow", workspaceId: workspace.id, executionId });
          }}
        />
      )}
      {runtimeRelay && (
        <RuntimeRelay
          relay={runtimeRelay}
          animated={workspace.current}
          width={placed.width}
          depth={placed.depth}
          seat={relaySeat}
          onSelect={() => onSelect({ kind: "agent", workspaceId: workspace.id, roomId: room.id, id: runtimeRelay.agentId })}
        />
      )}
      <ApprovalGate
        activeAgent={approvalAgent}
        animated={workspace.current}
        position={approvalGatePosition}
        onSelect={() => {
          if (!approvalAgent) return;
          onSelect({ kind: "agent", workspaceId: workspace.id, roomId: room.id, id: approvalAgent.id });
        }}
      />
      <ToolStation
        activeAgent={toolAgent}
        animated={workspace.current}
        position={toolStationPosition}
        onSelect={() => {
          if (!toolAgent) return;
          onSelect({ kind: "agent", workspaceId: workspace.id, roomId: room.id, id: toolAgent.id });
        }}
      />
      <RoomOpsBoard
        assignment={roomAmbientAssignment}
        operational={roomOperational}
        animated={workspace.current}
        roomStatus={room.status}
        width={Math.min(1.95, placed.width - 1.2)}
        position={[0, 0.14, -placed.depth / 2 + 0.34]}
      />
      {room.visibleAgents.map((agent, index) => {
        const slot = slots[index];
        const waypoints = workspaceSpatialRoomWaypoints({
          seat: { x: slot.x, z: slot.z },
          agentIndex: index,
          roomWidth: placed.width,
          roomDepth: placed.depth
        });
        const attention = workspaceSpatialAgentAttention(agent, flows);
        const bridgeActivityAnimated = workspaceSpatialAgentHasBridgeActivity(agent.id, flows);
        const pairHandoffRole = workspaceSpatialPairHandoffRoleForAgent(pairHandoff, agent.id);
        const parallelReceiptIndex = workspaceSpatialParallelDispatchTargetIndex(parallelDispatch, agent.id);
        const resultContributionIndex = workspaceSpatialResultContributionIndex(resultConvergence, agent.id);
        const resultRecipient = workspaceSpatialResultRecipient(resultConvergence, agent.id);
        const crossRoomResultRecipient = Boolean(
          crossRoomResultRelay
          && crossRoomResultRelay.targetRoomId === room.id
          && crossRoomResultRelay.requesterAgentId === agent.id
        );
        const agentPairHandoff: AgentFigurePairHandoff | undefined = pairHandoff && pairHandoffRole
          ? {
              flowId: pairHandoff.flowId,
              role: pairHandoffRole,
              point: pairHandoffRole === "source" ? pairHandoffSourceDock : pairHandoffTargetDock,
              startedAtMs: pairHandoff.startedAtMs,
              returnAtMs: pairHandoffRole === "source" ? pairHandoff.sourceReturnAtMs : pairHandoff.targetReturnAtMs
            }
          : undefined;
        return (
          <AgentFigure
            key={agent.id}
            agent={agent}
            // 对端只播放当前直接 Bridge 关联的真实工作姿态；locomotion 仍关闭，人物不会被误画成行走。
            animated={workspace.current || bridgeActivityAnimated}
            peerWorkspace={!workspace.current}
            position={[slot.x, 0.18, slot.z]}
            motion={agentMotions[index]}
            ambient={roomAmbientAssignment?.agentId === agent.id ? roomAmbientAssignment : undefined}
            // 消息传递期间，线路与状态是唯一主角；Agent 固定到工位，避免刚被取消的 ambient 回座或 Tool Station 位移抢走注意力。
            locomotion={{ enabled: workspace.current && !messageAttention, allowToolStation: index === toolAgentIndex, waypoints }}
            pairHandoff={agentPairHandoff}
            parallelReceipt={parallelDispatch && parallelReceiptIndex !== null
              ? {
                  targetIndex: parallelReceiptIndex,
                  startedAtMs: parallelDispatch.startedAtMs
                }
              : undefined}
            resultContribution={resultConvergence && resultContributionIndex !== null
              ? {
                  sourceIndex: resultContributionIndex,
                  startedAtMs: resultConvergence.startedAtMs
                }
              : undefined}
            resultRecipient={resultConvergence && resultRecipient
              ? {
                  reachAtMs: resultConvergence.startedAtMs + WORKSPACE_SPATIAL_RESULT_CONVERGENCE_MERGE_END_MS,
                  receivedAtMs: resultConvergence.startedAtMs + WORKSPACE_SPATIAL_RESULT_CONVERGENCE_RELAY_END_MS,
                  endsAtMs: resultConvergence.endsAtMs
                }
              : crossRoomResultRelay && crossRoomResultRecipient
                ? {
                    reachAtMs: crossRoomResultRelay.startedAtMs + WORKSPACE_SPATIAL_CROSS_ROOM_RECEIPT_REACH_MS,
                    receivedAtMs: crossRoomResultRelay.startedAtMs + WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_ARRIVAL_MS,
                    endsAtMs: crossRoomResultRelay.endsAtMs
                  }
                : undefined}
            attentionTarget={workspace.current && attention
              ? { x: waypoints.roomGateway.x - slot.x, z: waypoints.roomGateway.z - slot.z }
              : undefined}
            attentionTone={workspace.current && attention ? attention.tone : undefined}
            selected={selection?.kind === "agent" && selection.workspaceId === workspace.id && selection.id === agent.id}
            hovered={hoveredKey === `agent:${workspace.id}:${agent.id}`}
            textMode={agentTextModes[`${workspace.id}:${agent.id}`] ?? "none"}
            focusedRoom={roomFocused}
            labelLift={slot.labelLift}
            density={room.density}
            onHover={onHover}
            onSelect={() => onSelect({ kind: "agent", workspaceId: workspace.id, roomId: room.id, id: agent.id })}
          />
        );
      })}
      {room.hiddenAgentCount > 0 && (
        <Html position={[0, 0.78, placed.depth / 2 - 0.46]} center zIndexRange={[9, 0]}>
          <span className="spatial-agent-overflow">+{room.hiddenAgentCount} Agents</span>
        </Html>
      )}
    </group>
  );
}

type RuntimeRelayTransitionState = {
  initialized: boolean;
  previous: WorkspaceSpatialRuntimeRelayState | null;
  from: THREE.Vector3;
  to: THREE.Vector3;
  elapsedSeconds: number;
};

function RuntimeRelay({ relay, animated, width, depth, seat, onSelect }: {
  relay: WorkspaceSpatialRuntimeRelayState;
  animated: boolean;
  width: number;
  depth: number;
  seat?: { x: number; z: number };
  onSelect: () => void;
}) {
  const batonRef = useRef<THREE.Group>(null);
  const targetRingRef = useRef<THREE.Group>(null);
  const targetRingMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const trailRef = useRef<THREE.Mesh>(null);
  const trailMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const trailDirection = useMemo(() => new THREE.Vector3(), []);
  const transitionRef = useRef<RuntimeRelayTransitionState>({
    initialized: false,
    previous: null,
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    elapsedSeconds: 0
  });
  const reduceMotion = useReducedSceneMotion();
  const invalidate = useThree((state) => state.invalidate);
  const stations = useMemo<Record<WorkspaceSpatialRuntimeRelayStation, THREE.Vector3>>(() => {
    const receipt = new THREE.Vector3(0, 0.09, -depth / 2 + 1.16);
    return {
      // 入口 dock 向房间内收，避开门框和 Room Access Gate 的青色竖灯。
      intake: new THREE.Vector3(width / 2 - 0.82, 0.09, depth / 2 - 0.9),
      workcell: relay.visibleAgent && seat
        // 工位 dock 放在人物内侧，不与 Agent status ring 叠成一个含混的圆。
        ? new THREE.Vector3(seat.x + (seat.x <= 0 ? 0.34 : -0.34), 0.09, seat.z - 0.18)
        : receipt.clone(),
      tool: new THREE.Vector3(width / 2 - 1.45, 0.09, -depth / 2 + 1.58),
      approval: new THREE.Vector3(-width / 2 + 1.3, 0.09, depth / 2 - 0.8),
      receipt
    };
  }, [depth, relay.visibleAgent, seat, width]);
  const target = stations[relay.station];
  const baseRail = useMemo(() => [
    stations.intake.toArray() as [number, number, number],
    stations.workcell.toArray() as [number, number, number],
    stations.tool.toArray() as [number, number, number],
    stations.receipt.toArray() as [number, number, number]
  ], [stations]);
  const approvalRail = useMemo(() => [
    stations.workcell.toArray() as [number, number, number],
    stations.approval.toArray() as [number, number, number]
  ], [stations]);

  useLayoutEffect(() => {
    const transition = transitionRef.current;
    const sameActivity = transition.previous?.executionId === relay.executionId
      && transition.previous.activityId === relay.activityId;
    if (transition.initialized && sameActivity) {
      if (!transition.to.equals(target)) {
        // 聚合密度或房间布局变化只重定位当前真值 dock，不把一次 resize 误演成 Runtime 阶段切换。
        transition.from.copy(target);
        transition.to.copy(target);
        batonRef.current?.position.copy(target);
      }
      transition.previous = relay;
      return;
    }
    const canHandoff = workspaceSpatialRuntimeRelayCanHandoff(transition.previous, relay);
    if (!transition.initialized || !canHandoff || reduceMotion || !animated) {
      transition.from.copy(target);
      transition.to.copy(target);
      // 新 execution 直接落在当前真值 station；terminal 可以在该位置播放一次回执，但不会复播刷新。
      transition.elapsedSeconds = relay.terminal && animated && !reduceMotion ? 0 : Number.POSITIVE_INFINITY;
      transition.initialized = true;
      batonRef.current?.position.copy(target);
    } else {
      // 同一 execution 的新阶段从标记当前可见位置接力；不会回跳到一个推断出的历史 station。
      transition.from.copy(batonRef.current?.position ?? transition.to);
      transition.to.copy(target);
      transition.elapsedSeconds = 0;
    }
    transition.previous = relay;
  }, [animated, reduceMotion, relay, target]);

  useFrame(({ clock }, delta) => {
    const transition = transitionRef.current;
    transition.elapsedSeconds += Math.min(delta, 0.05);
    const motionEnabled = animated && !reduceMotion;
    const frame = workspaceSpatialRuntimeRelayFrame(
      transition.elapsedSeconds,
      relay.terminal,
      !motionEnabled
    );
    if (batonRef.current) {
      batonRef.current.position.lerpVectors(transition.from, transition.to, frame.easedProgress);
      const activePulse = relay.continuous && motionEnabled
        ? (Math.sin(clock.elapsedTime * (relay.stage === "tool" ? 5.2 : 2.7)) + 1) * 0.045
        : 0;
      batonRef.current.scale.setScalar(1 + activePulse + frame.terminalPulse * 0.24);
    }
    if (targetRingRef.current) {
      targetRingRef.current.position.copy(transition.to);
      targetRingRef.current.scale.setScalar(1 + frame.terminalPulse * 0.68);
    }
    if (targetRingMaterialRef.current) targetRingMaterialRef.current.opacity = 0.58 + frame.terminalPulse * 0.28;
    if (trailRef.current) {
      trailDirection.subVectors(transition.to, transition.from);
      const distance = trailDirection.length();
      trailRef.current.visible = distance > 0.01 && frame.trailStrength > 0.01;
      trailRef.current.position.copy(transition.from).lerp(transition.to, 0.5);
      trailRef.current.rotation.y = -Math.atan2(trailDirection.z, trailDirection.x);
      trailRef.current.scale.x = distance;
    }
    if (trailMaterialRef.current) trailMaterialRef.current.opacity = frame.trailStrength * 0.5;
    if (!frame.settled && motionEnabled) invalidate();
  });

  return (
    <group onClick={(event) => stopAndSelect(event, onSelect)}>
      <Line points={baseRail} color="#365e68" lineWidth={0.88} transparent opacity={0.29} />
      <Line points={approvalRail} color="#365e68" lineWidth={0.78} transparent opacity={0.22} />
      <mesh ref={trailRef} visible={false}>
        <boxGeometry args={[1, 0.018, 0.045]} />
        <meshBasicMaterial ref={trailMaterialRef} color={relay.color} transparent opacity={0} toneMapped={false} depthWrite={false} />
      </mesh>
      <group ref={targetRingRef} position={target.toArray()}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.14, 0.215, 24]} />
          <meshBasicMaterial ref={targetRingMaterialRef} color={relay.color} transparent opacity={0.58} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
      <group ref={batonRef} position={target.toArray()}>
        <mesh position={[0, 0.045, 0]}>
          <cylinderGeometry args={[0.018, 0.026, 0.11, 10]} />
          <meshStandardMaterial color="#516a73" metalness={0.36} roughness={0.38} />
        </mesh>
        <mesh position={[0, 0.115, 0]} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.165, 0.165, 0.085]} />
          <meshStandardMaterial color={relay.color} emissive={relay.color} emissiveIntensity={0.46} roughness={0.34} metalness={0.18} />
        </mesh>
        <mesh position={[0, -0.052, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.13, 20]} />
          <meshBasicMaterial color={relay.color} transparent opacity={0.22} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

function ToolStation({ activeAgent, animated, position, onSelect }: {
  activeAgent?: WorkspaceSpatialAgent;
  animated: boolean;
  position: [number, number, number];
  onSelect: () => void;
}) {
  const signalRef = useRef<THREE.Group>(null);
  const carriageRef = useRef<THREE.Group>(null);
  const padMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const reduceMotion = useReducedSceneMotion();
  const active = Boolean(activeAgent);
  useFrame(({ clock }) => {
    const phase = (Math.sin(clock.elapsedTime * 3.1) + 1) / 2;
    const motionEnabled = active && animated && !reduceMotion;
    if (signalRef.current) {
      signalRef.current.position.y = motionEnabled ? 1.55 + phase * 0.035 : 1.55;
      signalRef.current.scale.setScalar(motionEnabled ? 0.96 + phase * 0.12 : 1);
    }
    if (carriageRef.current) {
      carriageRef.current.position.x = motionEnabled ? -0.1 + phase * 0.2 : 0;
    }
    if (padMaterialRef.current) {
      padMaterialRef.current.opacity = active ? motionEnabled ? 0.42 + phase * 0.28 : 0.66 : 0.2;
    }
  });
  return (
    <group
      position={position}
      onClick={active ? (event) => stopAndSelect(event, onSelect) : undefined}
    >
      <mesh position={[0, -0.105, 0.56]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.45, 32]} />
        <meshBasicMaterial ref={padMaterialRef} color={active ? "#8b7ee8" : "#758991"} transparent opacity={active ? 0.58 : 0.2} toneMapped={false} depthWrite={false} />
      </mesh>
      <group ref={signalRef} position={[0, 1.55, -0.18]}>
        <mesh rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.13, 0.13, 0.045]} />
          <meshStandardMaterial color={active ? "#8b7ee8" : "#61737b"} emissive={active ? "#8b7ee8" : "#263640"} emissiveIntensity={active ? 0.38 : 0.05} roughness={0.42} />
        </mesh>
      </group>
      {active && (
        <group ref={carriageRef}>
          {[-0.09, 0, 0.09].map((offset, index) => (
            <mesh key={offset} position={[-0.1 + index * 0.03, 1.18 + offset, -0.137]}>
              <boxGeometry args={[0.42 - index * 0.07, 0.022, 0.012]} />
              <meshBasicMaterial color={index === 0 ? "#c3bcff" : "#8b7ee8"} toneMapped={false} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

function RoomOpsBoard({ assignment, operational, animated, roomStatus, width, position }: {
  assignment?: WorkspaceSpatialAmbientAssignment;
  operational: WorkspaceSpatialRoomOperationalRhythm;
  animated: boolean;
  roomStatus: WorkspaceSpatialRoom["status"];
  width: number;
  position: [number, number, number];
}) {
  const screenMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const rearScreenMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const scanRef = useRef<THREE.Mesh>(null);
  const rearScanRef = useRef<THREE.Mesh>(null);
  const signalRef = useRef<THREE.Group>(null);
  const activityTapeRef = useRef<THREE.Group>(null);
  const reduceMotion = useReducedSceneMotion();
  const roomSignal = roomStatus === "online" ? "#42c694" : roomStatus === "degraded" ? "#efb44e" : "#8b989f";
  const mechanicColor = operational.color;

  useFrame(({ clock }) => {
    const checking = workspaceSpatialAmbientUsesUtilityPoint(assignment, Date.now());
    const phase = (Math.sin(clock.elapsedTime * 3.4) + 1) / 2;
    const mechanicActive = operational.mode !== "idle";
    const mechanicMotionEnabled = operational.motionActive && animated && !reduceMotion;
    for (const material of [screenMaterialRef.current, rearScreenMaterialRef.current]) {
      if (material) {
        material.emissiveIntensity = roomStatus !== "online"
          ? operational.screenBase
          : mechanicActive
          ? mechanicMotionEnabled ? operational.screenBase + phase * operational.screenAmplitude : operational.screenBase
          : checking ? reduceMotion ? 0.18 : 0.16 + phase * 0.16 : 0.035;
      }
    }
    for (const scan of [scanRef.current, rearScanRef.current]) {
      if (!scan) continue;
      scan.visible = checking;
      scan.position.x = reduceMotion ? 0 : -width * 0.31 + phase * width * 0.62;
    }
    if (signalRef.current) {
      signalRef.current.visible = checking;
      signalRef.current.position.y = reduceMotion ? 1.57 : 1.57 + phase * 0.025;
    }
    if (activityTapeRef.current) {
      activityTapeRef.current.visible = mechanicActive;
      activityTapeRef.current.children.forEach((child, index) => {
        const bar = child as THREE.Mesh;
        const rhythm = mechanicMotionEnabled
          ? (Math.sin(clock.elapsedTime * operational.cadence - index * 1.35) + 1) / 2
          : operational.mode === "approval" ? 0.62 : 0.44 + index * 0.12;
        const heightScale = operational.mode === "error"
          ? 0.58 + rhythm * 0.22
          : operational.mode === "approval" ? 0.82 + rhythm * 0.1 : 0.42 + rhythm * 0.72;
        bar.scale.y = heightScale;
      });
    }
  });

  return (
    <group position={position}>
      <RoundedBox args={[width, 0.46, 0.64]} radius={0.07} smoothness={3} position={[0, 0.23, 0]} castShadow>
        <meshStandardMaterial color="#aab6b9" roughness={0.55} metalness={0.22} />
      </RoundedBox>
      <RoundedBox args={[width - 0.18, 0.07, 0.7]} radius={0.035} smoothness={3} position={[0, 0.49, -0.02]} castShadow>
        <meshStandardMaterial color="#64767e" roughness={0.42} metalness={0.46} />
      </RoundedBox>
      {[-0.68, 0.68].map((offset) => (
        <mesh key={offset} position={[offset * Math.min(1, width / 2), 0.76, 0.08]}>
          <boxGeometry args={[0.075, 0.56, 0.075]} />
          <meshStandardMaterial color="#61747c" roughness={0.38} metalness={0.52} />
        </mesh>
      ))}
      <RoundedBox args={[Math.min(1.72, width - 0.22), 0.7, 0.095]} radius={0.055} smoothness={4} position={[0, 0.96, 0.08]} castShadow>
        <meshStandardMaterial color="#30434c" roughness={0.36} metalness={0.38} />
      </RoundedBox>
      <RoundedBox args={[Math.min(1.54, width - 0.4), 0.52, 0.035]} radius={0.035} smoothness={3} position={[0, 0.96, 0.022]}>
        <meshStandardMaterial ref={screenMaterialRef} color="#c6dfe1" emissive={mechanicColor} emissiveIntensity={0.035} roughness={0.32} metalness={0.06} />
      </RoundedBox>
      <RoundedBox args={[Math.min(1.54, width - 0.4), 0.52, 0.035]} radius={0.035} smoothness={3} position={[0, 0.96, 0.138]}>
        <meshStandardMaterial ref={rearScreenMaterialRef} color="#c6dfe1" emissive={mechanicColor} emissiveIntensity={0.035} roughness={0.32} metalness={0.06} />
      </RoundedBox>
      <mesh ref={scanRef} visible={false} position={[0, 0.92, -0.002]}>
        <boxGeometry args={[0.025, 0.32, 0.018]} />
        <meshBasicMaterial color="#e5fffb" transparent opacity={0.72} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh ref={rearScanRef} visible={false} position={[0, 0.92, 0.16]}>
        <boxGeometry args={[0.025, 0.32, 0.018]} />
        <meshBasicMaterial color="#e5fffb" transparent opacity={0.72} toneMapped={false} depthWrite={false} />
      </mesh>
      <SignFace text="ROOM OPS" width={1.18} height={0.15} color="#263640" position={[0, 1.07, -0.004]} rotation={[0, Math.PI, 0]} />
      <SignFace text="ROOM OPS" width={1.18} height={0.15} color="#263640" position={[0, 1.07, 0.164]} />
      <group ref={activityTapeRef} visible={operational.mode !== "idle"} position={[-0.16, 0.82, 0.08]}>
        {[-0.14, 0, 0.14].map((offset) => (
          <mesh key={offset} position={[offset, 0, 0]}>
            <boxGeometry args={[0.065, 0.17, 0.19]} />
            <meshBasicMaterial color={mechanicColor} transparent opacity={0.88} toneMapped={false} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <mesh position={[Math.min(0.63, width / 2 - 0.2), 0.82, -0.005]}>
        <sphereGeometry args={[0.04, 12, 10]} />
        <meshStandardMaterial color={roomSignal} emissive={roomSignal} emissiveIntensity={roomStatus === "online" ? 0.22 : 0.08} roughness={0.38} />
      </mesh>
      <mesh position={[Math.min(0.63, width / 2 - 0.2), 0.82, 0.165]}>
        <sphereGeometry args={[0.04, 12, 10]} />
        <meshStandardMaterial color={roomSignal} emissive={roomSignal} emissiveIntensity={roomStatus === "online" ? 0.22 : 0.08} roughness={0.38} />
      </mesh>
      <group ref={signalRef} visible={false} position={[0, 1.38, 0.04]}>
        <mesh rotation={[Math.PI / 4, 0, Math.PI / 4]}>
          <boxGeometry args={[0.13, 0.13, 0.045]} />
          <meshStandardMaterial color="#2fcab4" emissive="#2fcab4" emissiveIntensity={0.42} roughness={0.34} />
        </mesh>
      </group>
    </group>
  );
}

function ApprovalGate({ activeAgent, animated, position, onSelect }: {
  activeAgent?: WorkspaceSpatialAgent;
  animated: boolean;
  position: [number, number, number];
  onSelect: () => void;
}) {
  const signalRef = useRef<THREE.Group>(null);
  const reduceMotion = useReducedSceneMotion();
  const active = Boolean(activeAgent);
  useFrame(({ clock }) => {
    if (!signalRef.current) return;
    const phase = clock.elapsedTime * 3.2;
    const motionEnabled = active && animated && !reduceMotion;
    signalRef.current.position.y = motionEnabled ? 0.62 + Math.sin(phase) * 0.035 : 0.62;
    signalRef.current.rotation.y = motionEnabled ? Math.sin(phase * 0.55) * 0.16 : 0;
    signalRef.current.scale.setScalar(motionEnabled ? 1 + Math.sin(phase) * 0.05 : 1);
  });

  const gateColor = active ? "#efb44e" : "#6f858d";
  return (
    <group
      position={position}
      onClick={active ? (event) => stopAndSelect(event, onSelect) : undefined}
    >
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.38, 0.43, 0.08, 28]} />
        <meshStandardMaterial color={active ? "#8a6933" : "#5f7076"} metalness={0.5} roughness={0.38} />
      </mesh>
      {([-1, 1] as const).map((side) => (
        <RoundedBox key={side} args={[0.11, 0.72, 0.12]} radius={0.025} smoothness={3} position={[side * 0.25, 0.39, 0]} castShadow>
          <meshStandardMaterial color={gateColor} emissive={gateColor} emissiveIntensity={active ? 0.3 : 0.02} metalness={0.42} roughness={0.36} />
        </RoundedBox>
      ))}
      <RoundedBox args={[0.61, 0.11, 0.12]} radius={0.025} smoothness={3} position={[0, 0.76, 0]} castShadow>
        <meshStandardMaterial color={gateColor} emissive={gateColor} emissiveIntensity={active ? 0.3 : 0.02} metalness={0.42} roughness={0.36} />
      </RoundedBox>
      <group ref={signalRef} visible={active}>
        <mesh rotation={[Math.PI / 4, 0, Math.PI / 4]}>
          <octahedronGeometry args={[0.18, 0]} />
          <meshStandardMaterial color="#efb44e" emissive="#efb44e" emissiveIntensity={0.5} metalness={0.16} roughness={0.36} />
        </mesh>
        <mesh position={[0, 0.03, 0.145]}><boxGeometry args={[0.035, 0.13, 0.025]} /><meshBasicMaterial color="#513912" toneMapped={false} /></mesh>
        <mesh position={[0, -0.075, 0.145]}><sphereGeometry args={[0.025, 10, 8]} /><meshBasicMaterial color="#513912" toneMapped={false} /></mesh>
      </group>
    </group>
  );
}

function ResultConvergenceManifold({ convergence, animated, center, destination, handoffContinues, endpoints, onSelect }: {
  convergence: WorkspaceSpatialResultConvergenceState | null;
  animated: boolean;
  center: WorkspaceSpatialPoint;
  destination: ResultConvergenceDestination;
  handoffContinues: boolean;
  endpoints: Array<{ agentId: string; x: number; z: number }>;
  onSelect: () => void;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const cardRefs = useRef<Array<THREE.Group | null>>([]);
  const folioRef = useRef<THREE.Group>(null);
  const sealRef = useRef<THREE.Mesh>(null);
  const gatewayMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const reduceMotion = useReducedSceneMotion();
  const invalidate = useThree((state) => state.invalidate);

  useFrame(() => {
    const nowMs = Date.now();
    const phase = convergence ? workspaceSpatialResultConvergencePhase(convergence, nowMs) : null;
    const active = Boolean(convergence && phase && endpoints.length >= 2);
    if (rootRef.current) rootRef.current.visible = active;
    if (!convergence || !active) return;
    const elapsedMs = nowMs - convergence.startedAtMs;
    const mergeProgress = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(
      (elapsedMs - WORKSPACE_SPATIAL_RESULT_CONVERGENCE_COLLECT_END_MS)
      / (WORKSPACE_SPATIAL_RESULT_CONVERGENCE_MERGE_END_MS - WORKSPACE_SPATIAL_RESULT_CONVERGENCE_COLLECT_END_MS),
      0,
      1
    ), 0, 1);
    endpoints.forEach((endpoint, index) => {
      const card = cardRefs.current[index];
      if (!card) return;
      const staggerMs = index * WORKSPACE_SPATIAL_RESULT_CONVERGENCE_STAGGER_MS;
      const rawProgress = (elapsedMs - WORKSPACE_SPATIAL_RESULT_CONVERGENCE_COLLECT_START_MS - staggerMs)
        / (WORKSPACE_SPATIAL_RESULT_CONVERGENCE_COLLECT_END_MS - WORKSPACE_SPATIAL_RESULT_CONVERGENCE_COLLECT_START_MS);
      const progress = reduceMotion ? 1 : THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(rawProgress, 0, 1), 0, 1);
      const stackOffset = (index - (endpoints.length - 1) / 2) * 0.055;
      card.visible = !reduceMotion && phase !== "relaying" && phase !== "settling";
      card.position.x = THREE.MathUtils.lerp(endpoint.x, center.x + stackOffset, progress);
      card.position.z = THREE.MathUtils.lerp(endpoint.z, center.z + index * 0.018, progress);
      card.position.y = THREE.MathUtils.lerp(1.02, 1.06 + index * 0.028, progress)
        + Math.sin(progress * Math.PI) * 0.42;
      card.rotation.x = THREE.MathUtils.lerp(-0.26, -0.14, progress);
      card.rotation.y = Math.atan2(center.x - endpoint.x, center.z - endpoint.z) + Math.PI / 2;
      card.rotation.z = Math.sin(progress * Math.PI) * (index % 2 === 0 ? -0.12 : 0.12);
      card.scale.setScalar(phase === "merging" ? THREE.MathUtils.lerp(1, 0.16, mergeProgress) : 1);
    });

    if (folioRef.current) {
      const relayProgress = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(
        (elapsedMs - WORKSPACE_SPATIAL_RESULT_CONVERGENCE_MERGE_END_MS)
        / (WORKSPACE_SPATIAL_RESULT_CONVERGENCE_RELAY_END_MS - WORKSPACE_SPATIAL_RESULT_CONVERGENCE_MERGE_END_MS),
        0,
        1
      ), 0, 1);
      // 跨房间接力在 gateway 到达后由 Workspace 层接管；源房间 folio 随即隐藏，避免同一结果册出现两个实体。
      folioRef.current.visible = reduceMotion
        ? !handoffContinues
        : phase === "merging" || phase === "relaying" || (phase === "settling" && !handoffContinues);
      // reduced motion 下 gateway 结果保持在 Bay；房内 direct receipt 则静态显示在 requester 手侧，仍保留目的地真值。
      const physicalRelayProgress = reduceMotion ? destination.kind === "agent" ? 1 : 0 : relayProgress;
      folioRef.current.position.x = THREE.MathUtils.lerp(center.x, destination.x, physicalRelayProgress);
      folioRef.current.position.z = THREE.MathUtils.lerp(center.z, destination.z, physicalRelayProgress);
      folioRef.current.position.y = THREE.MathUtils.lerp(1.08, destination.y, physicalRelayProgress)
        + (reduceMotion ? 0 : Math.sin(physicalRelayProgress * Math.PI) * 0.34);
      folioRef.current.rotation.y = Math.atan2(destination.x - center.x, destination.z - center.z) + Math.PI / 2;
      folioRef.current.rotation.z = reduceMotion ? 0 : Math.sin(physicalRelayProgress * Math.PI) * 0.08;
      folioRef.current.scale.setScalar(reduceMotion ? 1 : phase === "merging" ? 0.42 + mergeProgress * 0.58 : 1);
    }
    if (sealRef.current) {
      sealRef.current.rotation.y = reduceMotion ? 0 : mergeProgress * Math.PI * 2;
    }
    if (gatewayMaterialRef.current) {
      const relayActive = destination.kind === "gateway" && phase === "relaying";
      gatewayMaterialRef.current.emissiveIntensity = relayActive ? 0.5 : phase === "settling" ? 0.22 : 0.05;
      gatewayMaterialRef.current.opacity = relayActive || phase === "settling" ? 0.88 : 0.3;
    }
    // collect、merge 与 gateway relay 共用同一有限响应窗口；真实 response 仍存在也不会循环回收。
    if (animated && !reduceMotion && elapsedMs < WORKSPACE_SPATIAL_RESULT_CONVERGENCE_RELAY_END_MS) invalidate();
  });

  return (
    <group
      ref={rootRef}
      visible={false}
      onClick={convergence ? (event) => stopAndSelect(event, onSelect) : undefined}
    >
      <RoundedBox args={[0.8, 0.11, 0.52]} radius={0.06} smoothness={3} position={[center.x, 0.85, center.z]} castShadow>
        <meshStandardMaterial color="#4b5960" metalness={0.38} roughness={0.42} />
      </RoundedBox>
      {endpoints.map((endpoint, index) => {
        const sourceOffset = (index - (endpoints.length - 1) / 2) * 0.06;
        return (
          <group key={endpoint.agentId}>
            <mesh position={[center.x + sourceOffset * 2.4, 0.912, center.z - 0.09]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.11, 0.23]} />
              <meshBasicMaterial color="#f0b64f" transparent opacity={0.72} toneMapped={false} depthWrite={false} />
            </mesh>
            <group ref={(group) => { cardRefs.current[index] = group; }} position={[endpoint.x, 1.02, endpoint.z]}>
              <RoundedBox args={[0.42, 0.045, 0.28]} radius={0.028} smoothness={3} castShadow>
                <meshStandardMaterial color="#fff8e9" emissive="#f0b64f" emissiveIntensity={0.13} roughness={0.62} />
              </RoundedBox>
              <mesh position={[-0.135, 0.027, 0]}>
                <boxGeometry args={[0.045, 0.009, 0.21]} />
                <meshBasicMaterial color="#f0b64f" toneMapped={false} />
              </mesh>
              {[0.052, -0.018, -0.088].map((z, lineIndex) => (
                <mesh key={z} position={[0.045, 0.0275, z]}>
                  <boxGeometry args={[0.16 - lineIndex * 0.022, 0.006, 0.016]} />
                  <meshBasicMaterial color="#70838a" transparent opacity={0.64} toneMapped={false} />
                </mesh>
              ))}
            </group>
          </group>
        );
      })}
      <group ref={folioRef} visible={false} position={[center.x, 1.08, center.z]}>
        <RoundedBox args={[0.5, 0.09, 0.34]} radius={0.035} smoothness={3} castShadow>
          <meshStandardMaterial color="#c88932" emissive="#f0b64f" emissiveIntensity={0.22} metalness={0.08} roughness={0.58} />
        </RoundedBox>
        <RoundedBox args={[0.42, 0.045, 0.29]} radius={0.025} smoothness={3} position={[0.025, 0.065, 0]} castShadow>
          <meshStandardMaterial color="#fff8e9" roughness={0.68} />
        </RoundedBox>
        <mesh ref={sealRef} position={[-0.12, 0.098, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.045, 0.078, 20]} />
          <meshBasicMaterial color="#f0b64f" toneMapped={false} />
        </mesh>
      </group>
      {destination.kind === "gateway" && (
        <mesh position={[destination.x, 0.205, destination.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.13, 0.21, 28]} />
          <meshStandardMaterial
            ref={gatewayMaterialRef}
            color="#f0b64f"
            emissive="#f0b64f"
            emissiveIntensity={0.05}
            transparent
            opacity={0.3}
            metalness={0.16}
            roughness={0.42}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

function CrossRoomResultRelay({ relay, points, animated, onSelect }: {
  relay: WorkspaceSpatialCrossRoomResultRelayState;
  points: [number, number, number][];
  animated: boolean;
  onSelect: () => void;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const folioRef = useRef<THREE.Group>(null);
  const sealRef = useRef<THREE.Mesh>(null);
  const reduceMotion = useReducedSceneMotion();
  const invalidate = useThree((state) => state.invalidate);
  const route = useMemo(() => {
    const vectors = points.map((point) => new THREE.Vector3(...point));
    const cumulativeLengths = [0];
    for (let index = 1; index < vectors.length; index += 1) {
      cumulativeLengths.push(cumulativeLengths[index - 1] + vectors[index - 1].distanceTo(vectors[index]));
    }
    return { vectors, cumulativeLengths, totalLength: cumulativeLengths.at(-1) ?? 0 };
  }, [points]);
  const position = useMemo(() => new THREE.Vector3(), []);
  const lookAhead = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const nowMs = Date.now();
    const phase = workspaceSpatialCrossRoomResultRelayPhase(relay, nowMs);
    const visible = Boolean(phase && (reduceMotion || phase === "relaying" || phase === "settling"));
    if (rootRef.current) rootRef.current.visible = visible;
    if (!visible || !folioRef.current) return;
    const elapsedMs = nowMs - relay.startedAtMs;
    const rawProgress = (elapsedMs - WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_START_MS)
      / (WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_ARRIVAL_MS - WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_START_MS);
    const progress = reduceMotion ? 1 : THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(rawProgress, 0, 1), 0, 1);
    pointOnPolyline(position, route.vectors, route.cumulativeLengths, route.totalLength, progress);
    const facingForward = progress < 0.982;
    pointOnPolyline(
      lookAhead,
      route.vectors,
      route.cumulativeLengths,
      route.totalLength,
      facingForward ? progress + 0.018 : Math.max(0, progress - 0.018)
    );
    folioRef.current.position.copy(position);
    folioRef.current.position.y += reduceMotion ? 0 : Math.sin(progress * Math.PI) * 0.22;
    folioRef.current.rotation.y = Math.atan2(
      facingForward ? lookAhead.x - position.x : position.x - lookAhead.x,
      facingForward ? lookAhead.z - position.z : position.z - lookAhead.z
    ) + Math.PI / 2;
    folioRef.current.rotation.z = reduceMotion ? 0 : Math.sin(progress * Math.PI) * 0.07;
    const settleProgress = THREE.MathUtils.clamp(
      (elapsedMs - WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_ARRIVAL_MS)
      / Math.max(1, relay.endsAtMs - relay.startedAtMs - WORKSPACE_SPATIAL_CROSS_ROOM_RELAY_ARRIVAL_MS),
      0,
      1
    );
    folioRef.current.scale.setScalar(reduceMotion ? 1 : 1 + Math.sin(settleProgress * Math.PI) * 0.055);
    if (sealRef.current) sealRef.current.rotation.y = reduceMotion ? 0 : progress * Math.PI * 2;
    // relay 与 requester 收件手势共用 13.2 秒有限窗口；settling 结束后不再主动请求新帧。
    if (animated && !reduceMotion && nowMs < relay.endsAtMs) invalidate();
  });

  return (
    <group ref={rootRef} visible={false} onClick={(event) => stopAndSelect(event, onSelect)}>
      <group ref={folioRef}>
        <RoundedBox args={[0.5, 0.09, 0.34]} radius={0.035} smoothness={3} castShadow>
          <meshStandardMaterial color="#c88932" emissive="#f0b64f" emissiveIntensity={0.25} metalness={0.08} roughness={0.58} />
        </RoundedBox>
        <RoundedBox args={[0.42, 0.045, 0.29]} radius={0.025} smoothness={3} position={[0.025, 0.065, 0]} castShadow>
          <meshStandardMaterial color="#fff8e9" roughness={0.68} />
        </RoundedBox>
        <mesh ref={sealRef} position={[-0.12, 0.098, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.045, 0.078, 20]} />
          <meshBasicMaterial color="#f0b64f" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function ParallelDispatchManifold({ dispatch, animated, center, endpoints, onSelect }: {
  dispatch: WorkspaceSpatialParallelDispatchState | null;
  animated: boolean;
  center: WorkspaceSpatialPoint;
  endpoints: Array<{ agentId: string; x: number; z: number }>;
  onSelect: () => void;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const cardRefs = useRef<Array<THREE.Group | null>>([]);
  const dockRefs = useRef<Array<THREE.MeshStandardMaterial | null>>([]);
  const slotRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const reduceMotion = useReducedSceneMotion();
  const invalidate = useThree((state) => state.invalidate);

  useFrame(() => {
    const nowMs = Date.now();
    const phase = dispatch ? workspaceSpatialParallelDispatchPhase(dispatch, nowMs) : null;
    const active = Boolean(dispatch && phase && endpoints.length >= 2);
    if (rootRef.current) rootRef.current.visible = active;
    if (!dispatch || !active) return;
    const elapsedMs = nowMs - dispatch.startedAtMs;
    endpoints.forEach((endpoint, index) => {
      const card = cardRefs.current[index];
      if (!card) return;
      const staggerMs = index * WORKSPACE_SPATIAL_PARALLEL_DISPATCH_TARGET_STAGGER_MS;
      const rawProgress = (elapsedMs - WORKSPACE_SPATIAL_PARALLEL_DISPATCH_FANOUT_START_MS - staggerMs)
        / (WORKSPACE_SPATIAL_PARALLEL_DISPATCH_FANOUT_END_MS - WORKSPACE_SPATIAL_PARALLEL_DISPATCH_FANOUT_START_MS);
      const progress = reduceMotion ? 1 : THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(rawProgress, 0, 1), 0, 1);
      const stackOffset = (index - (endpoints.length - 1) / 2) * 0.075;
      card.position.x = THREE.MathUtils.lerp(center.x + stackOffset, endpoint.x, progress);
      card.position.z = THREE.MathUtils.lerp(center.z + index * 0.018, endpoint.z, progress);
      card.position.y = THREE.MathUtils.lerp(1.04 + index * 0.035, 1.02, progress)
        + (reduceMotion ? 0 : Math.sin(progress * Math.PI) * 0.42);
      card.rotation.x = THREE.MathUtils.lerp(-0.14, -0.26, progress);
      card.rotation.y = Math.atan2(endpoint.x - center.x, endpoint.z - center.z) + Math.PI / 2;
      card.rotation.z = reduceMotion ? 0 : Math.sin(progress * Math.PI) * (index % 2 === 0 ? 0.13 : -0.13);
      const received = progress >= 0.96;
      const dock = dockRefs.current[index];
      if (dock) {
        dock.emissiveIntensity = received ? phase === "receiving" ? 0.52 : 0.24 : 0.05;
        dock.opacity = received ? 0.88 : 0.34;
      }
      const slot = slotRefs.current[index];
      if (slot) slot.opacity = phase === "intake" ? 0.34 + index * 0.08 : 0.72;
    });
    // fan-out、接收点亮与人物接收手势共用同一有限窗口；完成后不因 pending Flow 循环。
    if (animated && !reduceMotion && elapsedMs < WORKSPACE_SPATIAL_PARALLEL_DISPATCH_RECEIPT_END_MS) invalidate();
  });

  return (
    <group
      ref={rootRef}
      visible={false}
      onClick={dispatch ? (event) => stopAndSelect(event, onSelect) : undefined}
    >
      <RoundedBox args={[0.78, 0.1, 0.5]} radius={0.055} smoothness={3} position={[center.x, 0.84, center.z]} castShadow>
        <meshStandardMaterial color="#40565f" metalness={0.42} roughness={0.38} />
      </RoundedBox>
      {endpoints.map((endpoint, index) => {
        const stackOffset = (index - (endpoints.length - 1) / 2) * 0.16;
        return (
          <group key={endpoint.agentId}>
            <mesh position={[center.x + stackOffset, 0.898, center.z - 0.09]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.1, 0.22]} />
              <meshBasicMaterial
                ref={(material) => { slotRefs.current[index] = material; }}
                color="#4bc4f3"
                transparent
                opacity={0.34}
                toneMapped={false}
                depthWrite={false}
              />
            </mesh>
            <mesh position={[endpoint.x, 0.205, endpoint.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.12, 0.19, 28]} />
              <meshStandardMaterial
                ref={(material) => { dockRefs.current[index] = material; }}
                color="#4bc4f3"
                emissive="#4bc4f3"
                emissiveIntensity={0.05}
                transparent
                opacity={0.34}
                metalness={0.16}
                roughness={0.42}
                depthWrite={false}
              />
            </mesh>
            <group
              ref={(group) => { cardRefs.current[index] = group; }}
              position={[center.x + stackOffset, 1.04 + index * 0.035, center.z]}
            >
              <RoundedBox args={[0.42, 0.045, 0.28]} radius={0.028} smoothness={3} castShadow>
                <meshStandardMaterial color="#fff8e9" emissive="#4bc4f3" emissiveIntensity={0.14} roughness={0.62} />
              </RoundedBox>
              <mesh position={[-0.135, 0.027, 0]}>
                <boxGeometry args={[0.045, 0.009, 0.21]} />
                <meshBasicMaterial color="#4bc4f3" toneMapped={false} />
              </mesh>
              {[0.052, -0.018, -0.088].map((z, lineIndex) => (
                <mesh key={z} position={[0.045, 0.0275, z]}>
                  <boxGeometry args={[0.16 - lineIndex * 0.022, 0.006, 0.016]} />
                  <meshBasicMaterial color="#70838a" transparent opacity={0.64} toneMapped={false} />
                </mesh>
              ))}
            </group>
          </group>
        );
      })}
    </group>
  );
}

function PairHandoffBay({ handoff, animated, sourceDock, targetDock, onSelect }: {
  handoff: WorkspaceSpatialPairHandoffState | null;
  animated: boolean;
  sourceDock: WorkspaceSpatialPoint;
  targetDock: WorkspaceSpatialPoint;
  onSelect: () => void;
}) {
  const batonRef = useRef<THREE.Group>(null);
  const batonMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const haloMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const sourceDockMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const targetDockMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const reduceMotion = useReducedSceneMotion();
  const invalidate = useThree((state) => state.invalidate);
  const centerX = (sourceDock.x + targetDock.x) / 2;
  const centerZ = (sourceDock.z + targetDock.z) / 2;

  useFrame((_, delta) => {
    const phase = handoff ? workspaceSpatialPairHandoffPhase(handoff, Date.now()) : null;
    const active = Boolean(handoff && phase);
    if (batonRef.current) {
      batonRef.current.visible = active;
      if (active && handoff) {
        const elapsedMs = Date.now() - handoff.startedAtMs;
        const exchangeProgress = reduceMotion
          ? 0.5
          : THREE.MathUtils.clamp(
              (elapsedMs - WORKSPACE_SPATIAL_PAIR_HANDOFF_EXCHANGE_START_MS)
              / (WORKSPACE_SPATIAL_PAIR_HANDOFF_EXCHANGE_END_MS - WORKSPACE_SPATIAL_PAIR_HANDOFF_EXCHANGE_START_MS),
              0,
              1
            );
        batonRef.current.position.x = THREE.MathUtils.lerp(sourceDock.x, targetDock.x, exchangeProgress);
        batonRef.current.position.z = THREE.MathUtils.lerp(sourceDock.z, targetDock.z, exchangeProgress);
        // baton 保持在人物手部高度，交换弧线在默认等距远景中仍可读，不落成地面粒子。
        batonRef.current.position.y = reduceMotion ? 1.02 : 1.02 + Math.sin(exchangeProgress * Math.PI) * 0.2;
        batonRef.current.rotation.y += reduceMotion ? 0 : delta * 2.4;
        if (animated && !reduceMotion && phase === "exchange") invalidate();
      }
    }
    if (batonMaterialRef.current) batonMaterialRef.current.opacity = active ? 0.96 : 0;
    if (haloRef.current) haloRef.current.scale.setScalar(reduceMotion ? 1 : 0.9 + Math.sin(Date.now() / 180) * 0.12);
    if (haloMaterialRef.current) haloMaterialRef.current.opacity = active ? reduceMotion ? 0.32 : 0.22 : 0;
    if (sourceDockMaterialRef.current) {
      const sourceActive = active && phase !== "returning";
      sourceDockMaterialRef.current.emissiveIntensity = sourceActive ? 0.28 : 0.015;
      sourceDockMaterialRef.current.opacity = sourceActive ? 0.82 : 0.36;
    }
    if (targetDockMaterialRef.current) {
      const targetActive = active && phase !== "approach";
      targetDockMaterialRef.current.emissiveIntensity = targetActive ? 0.34 : 0.015;
      targetDockMaterialRef.current.opacity = targetActive ? 0.88 : 0.36;
    }
  });

  return (
    <group onClick={handoff ? (event) => stopAndSelect(event, onSelect) : undefined}>
      <RoundedBox
        args={[0.52, 0.12, 0.42]}
        radius={0.06}
        smoothness={3}
        position={[centerX, 0.58, centerZ]}
        castShadow
      >
        <meshStandardMaterial color="#a77b52" metalness={0.08} roughness={0.66} />
      </RoundedBox>
      <mesh position={[centerX, 0.31, centerZ]}>
        <boxGeometry args={[0.16, 0.5, 0.22]} />
        <meshStandardMaterial color="#586d75" metalness={0.46} roughness={0.38} />
      </mesh>
      <mesh position={[centerX, 0.055, centerZ]}>
        <boxGeometry args={[Math.abs(targetDock.x - sourceDock.x), 0.035, 0.1]} />
        <meshStandardMaterial color="#586d75" transparent opacity={0.46} metalness={0.38} roughness={0.42} />
      </mesh>
      {([[
        sourceDock,
        sourceDockMaterialRef
      ], [
        targetDock,
        targetDockMaterialRef
      ]] as const).map(([dock, materialRef], index) => (
        <mesh key={index} position={[dock.x, 0.2, dock.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.13, 0.21, 28]} />
          <meshStandardMaterial
            ref={materialRef}
            color="#4bc4f3"
            emissive="#4bc4f3"
            emissiveIntensity={0.015}
            transparent
            opacity={0.36}
            metalness={0.2}
            roughness={0.4}
            depthWrite={false}
          />
        </mesh>
      ))}
      <group ref={batonRef} visible={false}>
        <mesh rotation={[0, 0, Math.PI / 4]} castShadow>
          <octahedronGeometry args={[0.17, 0]} />
          <meshStandardMaterial
            ref={batonMaterialRef}
            color="#4bc4f3"
            emissive="#4bc4f3"
            emissiveIntensity={0.72}
            transparent
            opacity={0}
            metalness={0.18}
            roughness={0.28}
          />
        </mesh>
        <Billboard follow>
          <mesh ref={haloRef}>
            <ringGeometry args={[0.2, 0.31, 24]} />
            <meshBasicMaterial
              ref={haloMaterialRef}
              color="#4bc4f3"
              transparent
              opacity={0}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        </Billboard>
      </group>
    </group>
  );
}

function RoomSignalSpine({ operational, assignment, animated, width, depth }: {
  operational: WorkspaceSpatialRoomOperationalRhythm;
  assignment?: WorkspaceSpatialAmbientAssignment;
  animated: boolean;
  width: number;
  depth: number;
}) {
  const segmentRefs = useRef<Array<THREE.Mesh | null>>([]);
  const reduceMotion = useReducedSceneMotion();
  const segmentCount = 5;
  const segmentWidth = Math.max(0.42, (width - 1.05) / segmentCount - 0.08);

  useFrame(({ clock }) => {
    const checking = workspaceSpatialAmbientUsesUtilityPoint(assignment, Date.now());
    const motionEnabled = animated && !reduceMotion && (operational.motionActive || checking);
    const cadence = checking ? 1.7 : Math.max(0.8, operational.cadence * 0.52);
    const color = checking ? "#2fcab4" : operational.color;
    segmentRefs.current.forEach((segment, index) => {
      if (!segment) return;
      const material = segment.material as THREE.MeshBasicMaterial;
      const phase = motionEnabled
        ? (Math.sin(clock.elapsedTime * cadence - index * 0.92) + 1) / 2
        : 0;
      material.color.set(color);
      material.opacity = operational.lightBase
        + (motionEnabled ? operational.lightAmplitude * (0.3 + phase * 0.7) : 0);
    });
  });

  return (
    <group position={[0, 2.58, -depth / 2 + 0.135]}>
      {Array.from({ length: segmentCount }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => { segmentRefs.current[index] = mesh; }}
          position={[(index - (segmentCount - 1) / 2) * (segmentWidth + 0.08), 0, 0]}
        >
          <boxGeometry args={[segmentWidth, 0.055, 0.035]} />
          <meshBasicMaterial
            color={operational.color}
            transparent
            opacity={operational.lightBase}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function RoomAccessGate({ operational, animated, position }: {
  operational: WorkspaceSpatialRoomOperationalRhythm;
  animated: boolean;
  position: [number, number, number];
}) {
  const leftPanelRef = useRef<THREE.Group>(null);
  const rightPanelRef = useRef<THREE.Group>(null);
  const beaconRef = useRef<THREE.Mesh>(null);
  const beaconMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const reduceMotion = useReducedSceneMotion();
  const targetGap = operational.access === "ready" ? 0.24 : operational.access === "holding" ? 0.15 : 0.09;

  useFrame(({ clock }, delta) => {
    // 门禁只表达 Device 与 room mechanic 的当前边界，不参与路径判定或权限执行。
    if (leftPanelRef.current) {
      leftPanelRef.current.position.z = THREE.MathUtils.damp(leftPanelRef.current.position.z, -targetGap, 11, delta);
    }
    if (rightPanelRef.current) {
      rightPanelRef.current.position.z = THREE.MathUtils.damp(rightPanelRef.current.position.z, targetGap, 11, delta);
    }
    const motionEnabled = operational.motionActive && animated && !reduceMotion;
    const phase = motionEnabled ? (Math.sin(clock.elapsedTime * Math.max(1.2, operational.cadence * 0.6)) + 1) / 2 : 0;
    if (beaconRef.current) beaconRef.current.scale.setScalar(motionEnabled ? 0.94 + phase * 0.14 : 1);
    if (beaconMaterialRef.current) {
      beaconMaterialRef.current.opacity = operational.access === "ready"
        ? motionEnabled ? 0.58 + phase * 0.34 : 0.58
        : operational.access === "holding" ? motionEnabled ? 0.72 + phase * 0.24 : 0.78 : 0.82;
    }
  });

  return (
    <group position={position}>
      {([-1, 1] as const).map((side) => (
        <group
          key={side}
          ref={side === -1 ? leftPanelRef : rightPanelRef}
          position={[0, 0, side * targetGap]}
        >
          <RoundedBox args={[0.065, 0.7, 0.28]} radius={0.025} smoothness={3} position={[0, 0.42, 0]}>
            <meshStandardMaterial
              color={operational.color}
              emissive={operational.color}
              emissiveIntensity={operational.access === "ready" ? 0.08 : 0.22}
              transparent
              opacity={operational.access === "ready" ? 0.34 : 0.62}
              roughness={0.34}
              metalness={0.28}
              depthWrite={false}
            />
          </RoundedBox>
        </group>
      ))}
      {([-1, 1] as const).map((side) => (
        <mesh key={side} position={[0, 0.45, side * 0.39]}>
          <boxGeometry args={[0.09, 0.9, 0.09]} />
          <meshStandardMaterial color="#536b73" metalness={0.46} roughness={0.34} />
        </mesh>
      ))}
      <mesh position={[0, 0.9, 0]}>
        <boxGeometry args={[0.09, 0.08, 0.82]} />
        <meshStandardMaterial color="#536b73" metalness={0.46} roughness={0.34} />
      </mesh>
      <mesh ref={beaconRef} position={[0, 1.05, 0]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.13, 0.13, 0.055]} />
        <meshBasicMaterial
          ref={beaconMaterialRef}
          color={operational.color}
          transparent
          opacity={operational.access === "blocked" ? 0.82 : 0.58}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function DeviceDoorPlaque({ room, theme, selected, hovered, position, onSelect }: {
  room: WorkspaceSpatialRoom;
  theme: DeviceVisualTheme;
  selected: boolean;
  hovered: boolean;
  position: [number, number, number];
  onSelect: () => void;
}) {
  const buildingPresentation = useContext(WorkspaceBuildingPresentationContext);
  if (buildingPresentation) return <group position={position} onClick={(event) => stopAndSelect(event, onSelect)}>
    <RoundedBox args={[2.16,.43,.055]} radius={.025} smoothness={3}>
      <meshStandardMaterial color={selected || hovered ? "#d1e9ed" : "#eaf0f3"} metalness={.22} roughness={.4} />
    </RoundedBox>
    <mesh position={[-.98,0,.032]}><boxGeometry args={[.03,.3,.008]} /><meshBasicMaterial color={theme.accent} /></mesh>
    <SignFace text={room.name} width={1.84} height={.28} color="#345466" position={[.025,0,.04]} />
  </group>;
  return (
    <group position={position} onClick={(event) => stopAndSelect(event, onSelect)}>
      <RoundedBox args={[2.36, 0.82, 0.085]} radius={0.06} smoothness={4} castShadow>
        <meshStandardMaterial color={selected ? theme.accent : hovered ? "#76543c" : "#684a35"} metalness={0.04} roughness={0.72} />
      </RoundedBox>
      <RoundedBox args={[2.14, 0.62, 0.04]} radius={0.04} smoothness={3} position={[0, 0, 0.06]} castShadow>
        <meshStandardMaterial color={selected ? "#efd09d" : hovered ? "#e9c997" : "#e3c18f"} metalness={0.015} roughness={0.7} />
      </RoundedBox>
      {[-0.16, 0.17].map((offset) => (
        <mesh key={offset} position={[offset > 0 ? 0.08 : -0.06, offset, 0.086]}>
          <boxGeometry args={[1.8, 0.01, 0.008]} />
          <meshStandardMaterial color="#8a603f" transparent opacity={0.25} roughness={0.84} />
        </mesh>
      ))}
      {([-1, 1] as const).flatMap((xSide) => ([-1, 1] as const).map((ySide) => (
        <mesh key={`${xSide}:${ySide}`} position={[xSide * 0.94, ySide * 0.25, 0.092]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.026, 0.026, 0.018, 14]} />
          <meshStandardMaterial color="#9f8053" metalness={0.74} roughness={0.23} />
        </mesh>
      )))}
      <SignFace
        text={room.name}
        width={1.96}
        height={0.55}
        color={WOOD_SIGN_TEXT}
        position={[0, 0, 0.104]}
      />
    </group>
  );
}

function RoomShell({ width, depth, selected, hovered, statusColor, theme }: { width: number; depth: number; selected: boolean; hovered: boolean; statusColor: string; theme: DeviceVisualTheme }) {
  const buildingPresentation = useContext(WorkspaceBuildingPresentationContext);
  if (buildingPresentation) return <ReferenceDeviceRoom width={width} depth={depth} accent={theme.accent} highlighted={selected || hovered} />;
  const frame = theme.accent;
  const highlighted = selected || hovered;
  const glassOpacity = selected ? 0.56 : hovered ? 0.48 : 0.38;
  return (
    <group>
      <RoundedBox args={[width, 0.18, depth]} radius={0.12} smoothness={3} position={[0, 0.02, 0]} receiveShadow>
        <meshStandardMaterial color={theme.floor} roughness={0.7} metalness={0.018} />
      </RoundedBox>
      {highlighted && <group position={[0, 0.125, 0]}>
        <mesh position={[0, 0, -depth / 2 + 0.055]}><boxGeometry args={[width - 0.12, 0.035, 0.07]} /><meshBasicMaterial color={theme.accent} transparent opacity={selected ? 1 : 0.55} toneMapped={false} /></mesh>
        <mesh position={[0, 0, depth / 2 - 0.055]}><boxGeometry args={[width - 0.12, 0.035, 0.07]} /><meshBasicMaterial color={theme.accent} transparent opacity={selected ? 1 : 0.55} toneMapped={false} /></mesh>
        <mesh position={[-width / 2 + 0.055, 0, 0]}><boxGeometry args={[0.07, 0.035, depth - 0.12]} /><meshBasicMaterial color={theme.accent} transparent opacity={selected ? 1 : 0.55} toneMapped={false} /></mesh>
        <mesh position={[width / 2 - 0.055, 0, 0]}><boxGeometry args={[0.07, 0.035, depth - 0.12]} /><meshBasicMaterial color={theme.accent} transparent opacity={selected ? 1 : 0.55} toneMapped={false} /></mesh>
      </group>}
      <mesh castShadow receiveShadow position={[0, 0.32, -depth / 2 + 0.06]}>
        <boxGeometry args={[width, 0.42, 0.14]} />
        <meshStandardMaterial color={theme.wall} roughness={0.56} metalness={0.05} />
      </mesh>
      <mesh castShadow receiveShadow position={[-width / 2 + 0.06, 0.32, 0]}>
        <boxGeometry args={[0.14, 0.42, depth]} />
        <meshStandardMaterial color={theme.wall} roughness={0.56} metalness={0.05} />
      </mesh>
      <mesh castShadow receiveShadow position={[width / 2 - 0.05, 0.32, -depth * 0.17]}>
        <boxGeometry args={[0.1, 0.42, depth * 0.66]} />
        <meshStandardMaterial color={theme.wall} roughness={0.56} metalness={0.05} />
      </mesh>
      {/* 实体墙基保留房间边界，上半段统一换成通透玻璃，保证相邻 Device 仍可互相看见。 */}
      <mesh position={[0, 1.62, -depth / 2 + 0.075]} renderOrder={4}>
        <boxGeometry args={[width, 2.16, 0.055]} />
        <meshPhysicalMaterial color={theme.floor} emissive={frame} emissiveIntensity={highlighted ? 0.075 : 0.04} transparent opacity={glassOpacity} transmission={0.36} thickness={0.2} roughness={0.14} metalness={0.035} clearcoat={1} clearcoatRoughness={0.06} ior={1.46} depthWrite={false} />
      </mesh>
      <mesh position={[-width / 2 + 0.075, 1.62, 0]} renderOrder={4}>
        <boxGeometry args={[0.055, 2.16, depth]} />
        <meshPhysicalMaterial color={theme.floor} emissive={frame} emissiveIntensity={highlighted ? 0.075 : 0.04} transparent opacity={glassOpacity} transmission={0.36} thickness={0.2} roughness={0.14} metalness={0.035} clearcoat={1} clearcoatRoughness={0.06} ior={1.46} depthWrite={false} />
      </mesh>
      <mesh position={[width / 2 - 0.05, 1.62, -depth * 0.17]} renderOrder={4}>
        <boxGeometry args={[0.055, 2.16, depth * 0.66]} />
        <meshPhysicalMaterial color={theme.floor} emissive={frame} emissiveIntensity={highlighted ? 0.075 : 0.04} transparent opacity={glassOpacity} transmission={0.4} thickness={0.2} roughness={0.12} metalness={0.035} clearcoat={1} clearcoatRoughness={0.055} ior={1.46} depthWrite={false} />
      </mesh>
      {[0, 1, 2].map((index) => (
        <mesh key={index} position={[-width / 2 + (index + 1) * width / 4, 1.45, -depth / 2 + 0.125]}>
          <boxGeometry args={[0.035, 2.32, 0.035]} />
          <meshStandardMaterial color={frame} metalness={0.42} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 2.69, -depth / 2 + 0.1]}>
        <boxGeometry args={[width, 0.055, 0.065]} />
        <meshStandardMaterial color={frame} metalness={0.42} roughness={0.3} />
      </mesh>
      <mesh position={[-width / 2 + 0.1, 2.69, 0]}>
        <boxGeometry args={[0.065, 0.055, depth]} />
        <meshStandardMaterial color={frame} metalness={0.42} roughness={0.3} />
      </mesh>
      <mesh position={[width / 2 - 0.015, 1.35, -depth / 2 + 0.1]}>
        <boxGeometry args={[0.06, 2.7, 0.06]} />
        <meshStandardMaterial color={frame} metalness={0.4} roughness={0.32} />
      </mesh>
      <mesh position={[width / 2 - 0.015, 1.35, depth * 0.16]}>
        <boxGeometry args={[0.06, 2.7, 0.06]} />
        <meshStandardMaterial color={frame} metalness={0.4} roughness={0.32} />
      </mesh>
      <mesh position={[width / 2 - 0.02, 0.12, depth * 0.42]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.13, 0.2, 24]} />
        <meshBasicMaterial color={statusColor} transparent opacity={0.92} />
      </mesh>
      <RoundedBox args={[Math.min(2.1, width - 1.3), 0.035, 0.62]} radius={0.08} smoothness={3} position={[0, 0.11, depth / 2 - 0.7]}>
        <meshStandardMaterial color={theme.accent} transparent opacity={selected ? 0.32 : hovered ? 0.25 : 0.18} roughness={0.72} />
      </RoundedBox>
    </group>
  );
}

function RoomEquipment({ kind, width, depth, operational, assignment, animated }: {
  kind: WorkspaceSpatialRoom["kind"];
  width: number;
  depth: number;
  operational: WorkspaceSpatialRoomOperationalRhythm;
  assignment?: WorkspaceSpatialAmbientAssignment;
  animated: boolean;
}) {
  if (kind === "mobile") {
    return (
      <group>
        <WorkBench position={[0, 0.14, -depth / 2 + 0.7]} width={Math.min(3.8, width - 0.8)} />
        {[-1.05, -0.35, 0.35, 1.05].map((x, index) => (
          <mesh key={index} position={[x, 0.95, -depth / 2 + 0.64]} rotation={[-0.18, 0, 0]} castShadow>
            <boxGeometry args={[0.38, 0.055, 0.62]} />
            <meshStandardMaterial color={index % 2 ? "#323e47" : "#8898a3"} metalness={0.55} roughness={0.28} />
          </mesh>
        ))}
      </group>
    );
  }
  return (
    <group>
      <WorkDesk
        position={[-width / 2 + 1.45, 0.14, -depth / 2 + 1.02]}
        operational={operational}
        assignment={assignment}
        animated={animated}
        phaseOffset={0}
      />
      <WorkDesk
        position={[width / 2 - 1.45, 0.14, -depth / 2 + 1.02]}
        operational={operational}
        assignment={assignment}
        animated={animated}
        phaseOffset={0.85}
      />
    </group>
  );
}

function RefreshPoint({ assignment, animated, position }: {
  assignment?: WorkspaceSpatialAmbientAssignment;
  animated: boolean;
  position: [number, number, number];
}) {
  const indicatorMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const reservoirMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const reduceMotion = useReducedSceneMotion();

  useFrame(({ clock }) => {
    const active = workspaceSpatialAmbientUsesRefreshPoint(assignment, Date.now());
    const pulse = active && animated && !reduceMotion
      ? (Math.sin(clock.elapsedTime * 3.2) + 1) / 2
      : 0;
    if (indicatorMaterialRef.current) {
      indicatorMaterialRef.current.emissiveIntensity = active ? 0.34 + pulse * 0.48 : 0.055;
    }
    if (reservoirMaterialRef.current) {
      reservoirMaterialRef.current.emissiveIntensity = active ? 0.1 + pulse * 0.12 : 0.025;
    }
  });

  return (
    <group position={position}>
      <RoundedBox args={[0.48, 0.16, 0.62]} radius={0.055} smoothness={3} position={[0, 0.08, 0]} castShadow>
        <meshStandardMaterial color="#596f78" roughness={0.45} metalness={0.38} />
      </RoundedBox>
      <RoundedBox args={[0.4, 0.72, 0.48]} radius={0.07} smoothness={3} position={[0, 0.48, 0]} castShadow>
        <meshStandardMaterial color="#657a82" roughness={0.42} metalness={0.32} />
      </RoundedBox>
      <mesh position={[0.04, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.17, 0.19, 0.55, 18]} />
        <meshStandardMaterial
          ref={reservoirMaterialRef}
          color="#9bcbd2"
          emissive="#6baea8"
          emissiveIntensity={0.025}
          transparent
          opacity={0.72}
          roughness={0.18}
          metalness={0.04}
        />
      </mesh>
      <mesh position={[0.22, 0.61, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[0.035, 0.035, 0.16, 12]} />
        <meshStandardMaterial color="#33464f" roughness={0.32} metalness={0.5} />
      </mesh>
      <mesh position={[0.31, 0.61, 0]}>
        <sphereGeometry args={[0.045, 12, 10]} />
        <meshStandardMaterial color="#25363e" roughness={0.35} metalness={0.42} />
      </mesh>
      <mesh position={[0.245, 0.39, 0]}>
        <boxGeometry args={[0.03, 0.08, 0.15]} />
        <meshStandardMaterial
          ref={indicatorMaterialRef}
          color="#6baea8"
          emissive="#6baea8"
          emissiveIntensity={0.055}
          roughness={0.35}
        />
      </mesh>
      {[0, 1, 2].map((index) => (
        <mesh key={index} position={[0.04, 0.38 + index * 0.055, 0.31]}>
          <cylinderGeometry args={[0.054, 0.046, 0.06, 14]} />
          <meshStandardMaterial color="#f4efe3" roughness={0.72} />
        </mesh>
      ))}
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.28, 0.34, 28]} />
        <meshBasicMaterial color="#6baea8" transparent opacity={0.18} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

function WorkDesk({ position, rotation = 0, operational, assignment, animated, phaseOffset }: {
  position: [number, number, number];
  rotation?: number;
  operational: WorkspaceSpatialRoomOperationalRhythm;
  assignment?: WorkspaceSpatialAmbientAssignment;
  animated: boolean;
  phaseOffset: number;
}) {
  const buildingPresentation = useContext(WorkspaceBuildingPresentationContext);
  const screenMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const scanRef = useRef<THREE.Mesh>(null);
  const reduceMotion = useReducedSceneMotion();

  useFrame(({ clock }) => {
    const checking = workspaceSpatialAmbientUsesUtilityPoint(assignment, Date.now());
    const motionEnabled = animated && !reduceMotion && (operational.motionActive || checking);
    const cadence = checking ? 2.2 : operational.cadence;
    const phase = motionEnabled ? (Math.sin(clock.elapsedTime * Math.max(1, cadence) + phaseOffset) + 1) / 2 : 0;
    if (screenMaterialRef.current) {
      screenMaterialRef.current.emissive.set(checking ? "#2fcab4" : operational.color);
      screenMaterialRef.current.emissiveIntensity = operational.screenBase
        + (motionEnabled ? operational.screenAmplitude * phase : 0);
    }
    if (scanRef.current) {
      const scanActive = checking || operational.screen === "scan";
      scanRef.current.visible = scanActive;
      scanRef.current.position.x = reduceMotion || !motionEnabled ? 0 : -0.31 + phase * 0.62;
    }
  });

  if (buildingPresentation) return <ReferenceWorkDesk position={position} rotation={rotation} screenMaterialRef={screenMaterialRef} />;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow position={[0, 0.68, 0]}><boxGeometry args={[2.15, 0.12, 0.78]} /><meshStandardMaterial color="#d7d0c5" roughness={0.48} /></mesh>
      {[-0.88, 0.88].map((x) => <mesh key={x} position={[x, 0.35, 0]}><boxGeometry args={[0.08, 0.68, 0.62]} /><meshStandardMaterial color="#9da9ad" metalness={0.55} roughness={0.32} /></mesh>)}
      <mesh castShadow position={[0, 1.17, -0.18]}><boxGeometry args={[0.88, 0.55, 0.07]} /><meshStandardMaterial color="#263640" metalness={0.48} roughness={0.24} /></mesh>
      <mesh position={[0, 1.18, -0.139]}>
        <planeGeometry args={[0.74, 0.4]} />
        <meshStandardMaterial
          ref={screenMaterialRef}
          color="#bfdadd"
          emissive={operational.color}
          emissiveIntensity={operational.screenBase}
          roughness={0.28}
          metalness={0.04}
        />
      </mesh>
      <mesh ref={scanRef} visible={operational.screen === "scan"} position={[0, 1.18, -0.132]}>
        <boxGeometry args={[0.025, 0.31, 0.008]} />
        <meshBasicMaterial color="#eefeff" transparent opacity={0.72} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.88, -0.18]}><boxGeometry args={[0.08, 0.28, 0.08]} /><meshStandardMaterial color="#78878e" metalness={0.55} /></mesh>
      <mesh castShadow position={[0.72, 0.79, 0.1]}><boxGeometry args={[0.4, 0.035, 0.22]} /><meshStandardMaterial color="#e9eceb" roughness={0.45} /></mesh>
    </group>
  );
}

function WorkBench({ position, width }: { position: [number, number, number]; width: number }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.55, 0]}><boxGeometry args={[width, 0.14, 0.92]} /><meshStandardMaterial color="#d5d9d7" roughness={0.5} /></mesh>
      <mesh position={[-width / 2 + 0.18, 0.28, 0]}><boxGeometry args={[0.12, 0.55, 0.72]} /><meshStandardMaterial color="#9ba8ad" metalness={0.45} /></mesh>
      <mesh position={[width / 2 - 0.18, 0.28, 0]}><boxGeometry args={[0.12, 0.55, 0.72]} /><meshStandardMaterial color="#9ba8ad" metalness={0.45} /></mesh>
    </group>
  );
}

function ServerRack({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 1.02, 0]}><boxGeometry args={[0.76, 1.92, 0.62]} /><meshStandardMaterial color="#26343d" metalness={0.58} roughness={0.28} /></mesh>
      {[0.42, 0.72, 1.02, 1.32, 1.62].map((y, index) => (
        <group key={y} position={[0, y, 0.321]}>
          <mesh><boxGeometry args={[0.58, 0.17, 0.025]} /><meshStandardMaterial color="#101a20" metalness={0.5} /></mesh>
          <mesh position={[0.21, 0, 0.02]}><sphereGeometry args={[0.025, 10, 10]} /><meshBasicMaterial color={index % 2 ? "#4dc8f2" : "#4de0a5"} toneMapped={false} /></mesh>
        </group>
      ))}
    </group>
  );
}

function agentHash(agent: WorkspaceSpatialAgent): number {
  let hash = 0;
  for (const character of agent.id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function agentColor(agent: WorkspaceSpatialAgent): string {
  return ["#285f99", "#286f73", "#5a448f", "#1f7462", "#824455"][agentHash(agent) % 5];
}

const OFFLINE_AGENT_OPACITY = 0.6;

function idleAgentColor(color: string, amount: number): string {
  // Idle 仍是可用资源，因此保持实体不透明；只向冷灰工作台色收敛，避免产生透明物体的幽灵穿透。
  return `#${new THREE.Color(color).lerp(new THREE.Color("#91a0a6"), amount).getHexString()}`;
}

function statusColorForAgent(agent: WorkspaceSpatialAgent): string {
  const visual = workspaceSpatialAgentNodeState(agent);
  return LIVING_TOPOLOGY_PALETTE[visual.tone].accent;
}

function statusLabelForAgent(agent: WorkspaceSpatialAgent, peerWorkspace = false): string {
  if (agent.state === "offline" || agent.state === "error") return agent.state.charAt(0).toUpperCase() + agent.state.slice(1);
  if (agent.communicationProgress) return agent.communicationProgress.label;
  if (agent.activity) return topologyLiveActivityLabelForWorkspace(agent.activity.kind, peerWorkspace);
  if (agent.state === "communicating") return "Communicating";
  return agent.state.charAt(0).toUpperCase() + agent.state.slice(1);
}

function agentIsVisuallyActive(agent: WorkspaceSpatialAgent): boolean {
  return workspaceSpatialAgentMotion(agent).continuous;
}

function AgentDisplayName({ displayName }: { displayName: string }) {
  const segments = workspaceSpatialAgentNameSegments(displayName);
  return <>{segments.map((segment, index) => (
    <Fragment key={`${index}:${segment}`}>
      {segment}
      {index < segments.length - 1 && <wbr />}
    </Fragment>
  ))}</>;
}

function HumanoidArm({ side, shoulderY, seated, communicating, sleeve, skin, faded, castShadow, upperArmRef, forearmRef }: {
  side: -1 | 1;
  shoulderY: number;
  seated: boolean;
  communicating: boolean;
  sleeve: string;
  skin: string;
  faded: boolean;
  castShadow: boolean;
  upperArmRef: RefObject<THREE.Group | null>;
  forearmRef: RefObject<THREE.Group | null>;
}) {
  const shoulderSpread = communicating ? -0.48 : -0.08;
  const materialVisibility = { transparent: faded, opacity: faded ? OFFLINE_AGENT_OPACITY : 1, depthWrite: true };
  return (
    <group ref={upperArmRef} position={[side * 0.255, shoulderY, 0]} rotation={[seated ? 0.5 : 0.03, 0, side * shoulderSpread]}>
      <mesh castShadow={castShadow} position={[0, -0.16, 0]}>
        <capsuleGeometry args={[0.064, 0.24, 6, 12]} />
        <meshStandardMaterial color={sleeve} roughness={0.68} {...materialVisibility} />
      </mesh>
      <group ref={forearmRef} position={[0, -0.34, 0]} rotation={[seated ? -1.08 : communicating ? -0.16 : 0, 0, 0]}>
        <mesh castShadow={castShadow}><sphereGeometry args={[0.068, 14, 12]} /><meshStandardMaterial color={sleeve} roughness={0.68} {...materialVisibility} /></mesh>
        <mesh castShadow={castShadow} position={[0, -0.14, 0]}>
          <capsuleGeometry args={[0.054, 0.2, 6, 12]} />
          <meshStandardMaterial color={skin} roughness={0.65} {...materialVisibility} />
        </mesh>
        <mesh castShadow={castShadow} position={[0, -0.3, 0]}><sphereGeometry args={[0.063, 14, 12]} /><meshStandardMaterial color={skin} roughness={0.65} {...materialVisibility} /></mesh>
      </group>
    </group>
  );
}

function HumanoidLeg({ side, hipY, seated, pants, faded, castShadow, thighRef, shinRef }: {
  side: -1 | 1;
  hipY: number;
  seated: boolean;
  pants: string;
  faded: boolean;
  castShadow: boolean;
  thighRef: RefObject<THREE.Group | null>;
  shinRef: RefObject<THREE.Group | null>;
}) {
  const materialVisibility = { transparent: faded, opacity: faded ? OFFLINE_AGENT_OPACITY : 1, depthWrite: true };
  return (
    <group ref={thighRef} position={[side * 0.11, hipY, 0]} rotation={[seated ? -1.03 : 0, 0, 0]}>
      <mesh castShadow={castShadow} position={[0, -0.19, 0]}><capsuleGeometry args={[0.082, 0.28, 6, 12]} /><meshStandardMaterial color={pants} roughness={0.78} {...materialVisibility} /></mesh>
      <group ref={shinRef} position={[0, -0.4, 0]} rotation={[seated ? 1.03 : 0, 0, 0]}>
        <mesh castShadow={castShadow}><sphereGeometry args={[0.084, 14, 12]} /><meshStandardMaterial color={pants} roughness={0.78} {...materialVisibility} /></mesh>
        <mesh castShadow={castShadow} position={[0, -0.15, 0]}><capsuleGeometry args={[0.068, 0.22, 6, 12]} /><meshStandardMaterial color={pants} roughness={0.8} {...materialVisibility} /></mesh>
        <mesh castShadow={castShadow} position={[0, -0.34, 0.065]}><boxGeometry args={[0.16, 0.09, 0.27]} /><meshStandardMaterial color="#263038" roughness={0.73} {...materialVisibility} /></mesh>
      </group>
    </group>
  );
}

function AgentActivityMarker({ agent, marker, markerRef, position, labelLift, density, peerWorkspace, selected, hovered, showText, focusedRoom, onHover, onSelect }: {
  agent: WorkspaceSpatialAgent;
  marker: WorkspaceSpatialMotionMarker;
  markerRef: RefObject<THREE.Group | null>;
  position: [number, number, number];
  labelLift: number;
  density: WorkspaceSpatialDensity;
  peerWorkspace: boolean;
  selected: boolean;
  hovered: boolean;
  showText: boolean;
  focusedRoom: boolean;
  onHover: (key: string | null) => void;
  onSelect: () => void;
}) {
  if (marker === "none") return null;
  const agentKey = `agent:${agent.workspaceId}:${agent.id}`;
  const activitySummary = marker === "thinking" ? agent.activitySummary : undefined;
  const statusLabel = statusLabelForAgent(agent, peerWorkspace);
  const accessibleLabel = `${agent.displayName} · ${statusLabel}${activitySummary ? ` · ${activitySummary}` : ""}`;
  return (
    <group ref={markerRef} position={position}>
      {/* 3D glyph 使用 Billboard 抵消人物转向，避免状态图形变成贴在头后的不可读侧面。 */}
      <Billboard follow>
        {marker === "waiting" && (
          <group>
            {[-1, 0, 1].map((offset, index) => (
              <mesh key={offset} position={[offset * 0.07, (index % 2) * 0.025, 0]}>
                <sphereGeometry args={[0.034, 12, 10]} />
                <meshBasicMaterial color="#6c9fd2" toneMapped={false} />
              </mesh>
            ))}
          </group>
        )}
        {marker === "thinking" && (
          <group>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.13, 0.026, 10, 28]} />
              <meshBasicMaterial color="#3bace5" toneMapped={false} />
            </mesh>
            {[-1, 0, 1].map((offset) => (
              <mesh key={offset} position={[offset * 0.062, 0, 0.03]}>
                <sphereGeometry args={[0.023, 10, 8]} />
                <meshBasicMaterial color="#d9f1fb" toneMapped={false} />
              </mesh>
            ))}
          </group>
        )}
        {marker === "tool" && (
          <group>
            <RoundedBox args={[0.29, 0.2, 0.055]} radius={0.035} smoothness={3}>
              <meshStandardMaterial color="#303d66" emissive="#8b7ee8" emissiveIntensity={0.44} metalness={0.28} roughness={0.38} />
            </RoundedBox>
            {[0.05, 0, -0.05].map((offset, index) => (
              <mesh key={offset} position={[-0.025, offset, 0.039]}>
                <boxGeometry args={[0.17 - index * 0.025, 0.018, 0.01]} />
                <meshBasicMaterial color={index === 0 ? "#d8d3ff" : "#9a8ff0"} toneMapped={false} />
              </mesh>
            ))}
          </group>
        )}
        {marker === "approval" && (
          <group>
            <mesh rotation={[0, 0, Math.PI / 4]}>
              <boxGeometry args={[0.22, 0.22, 0.065]} />
              <meshStandardMaterial color="#efb44e" emissive="#efb44e" emissiveIntensity={0.62} roughness={0.38} />
            </mesh>
            <mesh position={[0, 0.025, 0.05]}><boxGeometry args={[0.027, 0.095, 0.012]} /><meshBasicMaterial color="#513912" toneMapped={false} /></mesh>
            <mesh position={[0, -0.055, 0.05]}><sphereGeometry args={[0.018, 10, 8]} /><meshBasicMaterial color="#513912" toneMapped={false} /></mesh>
          </group>
        )}
        {marker === "success" && (
          <group>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.12, 0.03, 10, 28]} />
              <meshBasicMaterial color="#42c694" toneMapped={false} />
            </mesh>
            <mesh position={[0.048, 0.002, 0.035]} rotation={[0, 0, -0.72]}><boxGeometry args={[0.038, 0.16, 0.035]} /><meshBasicMaterial color="#dff9ef" toneMapped={false} /></mesh>
            <mesh position={[-0.03, -0.038, 0.035]} rotation={[0, 0, 0.72]}><boxGeometry args={[0.034, 0.085, 0.035]} /><meshBasicMaterial color="#dff9ef" toneMapped={false} /></mesh>
          </group>
        )}
        {marker === "error" && (
          <group>
            {[-1, 1].map((side) => (
              <mesh key={side} rotation={[0, 0, side * Math.PI / 4]}>
                <boxGeometry args={[0.055, 0.28, 0.055]} />
                <meshStandardMaterial color="#e16868" emissive="#e16868" emissiveIntensity={0.44} roughness={0.4} />
              </mesh>
            ))}
          </group>
        )}
      </Billboard>
      {showText && <Html
        position={[0, 0.39 + labelLift * 0.7, 0]}
        center
        zIndexRange={selected || hovered || marker === "approval" || marker === "error" ? [28, 0] : [18, 0]}
      >
        <button
          type="button"
          title={accessibleLabel}
          aria-label={accessibleLabel}
          className={`spatial-agent-status-badge density-${density} marker-${marker}${activitySummary ? " has-summary" : ""}${focusedRoom ? " focused-room" : ""}${hovered ? " hovered" : ""}${selected ? " selected" : ""}`}
          onPointerEnter={() => onHover(agentKey)}
          onPointerLeave={() => onHover(null)}
          onClick={(event) => { event.stopPropagation(); onSelect(); }}
        >
          <i aria-hidden="true" />
          <span>
            <strong>
              <span className="spatial-agent-status-name"><AgentDisplayName displayName={agent.displayName} /></span>
              <span className="spatial-agent-status-separator" aria-hidden="true">·</span>
              <span className="spatial-agent-status-action">{statusLabel}</span>
            </strong>
            {activitySummary && <small>{activitySummary}</small>}
          </span>
        </button>
      </Html>}
    </group>
  );
}

function resetHumanoidArmPose(
  upperArm: THREE.Group | null,
  forearm: THREE.Group | null,
  side: -1 | 1,
  upperArmX: number,
  shoulderSpread: number,
  forearmX: number
) {
  upperArm?.rotation.set(upperArmX, 0, side * shoulderSpread);
  forearm?.rotation.set(forearmX, 0, 0);
}

function AgentFigure({ agent, animated, peerWorkspace, position, seated: seatedOverride, motion: motionOverride, ambient, locomotion, pairHandoff, parallelReceipt, resultContribution, resultRecipient, attentionTarget, attentionTone, forcedWalking = false, externalFacing = false, selected, hovered, orchestrator = false, clone = false, human = false, exchangeKey, textMode = "name", focusedRoom = false, labelLift = 0, density = "standard", onHover, onSelect }: {
  agent: WorkspaceSpatialAgent;
  animated: boolean;
  peerWorkspace: boolean;
  position: [number, number, number];
  seated?: boolean;
  motion?: WorkspaceSpatialAgentMotion;
  ambient?: WorkspaceSpatialAmbientAssignment;
  locomotion?: AgentFigureLocomotion;
  pairHandoff?: AgentFigurePairHandoff;
  parallelReceipt?: AgentFigureParallelReceipt;
  resultContribution?: AgentFigureResultContribution;
  resultRecipient?: AgentFigureResultRecipient;
  attentionTarget?: WorkspaceSpatialPoint;
  attentionTone?: CommunicationFlowTone;
  forcedWalking?: boolean | RefObject<boolean>;
  externalFacing?: boolean;
  selected: boolean;
  hovered: boolean;
  orchestrator?: boolean;
  clone?: boolean;
  human?: boolean;
  exchangeKey?: string;
  textMode?: WorkspaceSpatialAgentTextMode;
  focusedRoom?: boolean;
  labelLift?: number;
  density?: WorkspaceSpatialDensity;
  onHover: (key: string | null) => void;
  onSelect: () => void;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const figureRef = useRef<THREE.Group>(null);
  const statusRingRef = useRef<THREE.Group>(null);
  const headRigRef = useRef<THREE.Group>(null);
  const neckRef = useRef<THREE.Mesh>(null);
  const torsoRigRef = useRef<THREE.Mesh>(null);
  const shoulderRef = useRef<THREE.Mesh>(null);
  const hipRef = useRef<THREE.Mesh>(null);
  const collarRef = useRef<THREE.Mesh>(null);
  const chairRef = useRef<THREE.Group>(null);
  const markerRef = useRef<THREE.Group>(null);
  const refreshCupRef = useRef<THREE.Group>(null);
  const leftUpperArmRef = useRef<THREE.Group>(null);
  const leftForearmRef = useRef<THREE.Group>(null);
  const rightUpperArmRef = useRef<THREE.Group>(null);
  const rightForearmRef = useRef<THREE.Group>(null);
  const leftThighRef = useRef<THREE.Group>(null);
  const leftShinRef = useRef<THREE.Group>(null);
  const rightThighRef = useRef<THREE.Group>(null);
  const rightShinRef = useRef<THREE.Group>(null);
  const motionKeyRef = useRef("");
  const terminalElapsedRef = useRef(0);
  const poseBlendRef = useRef(
    (seatedOverride ?? motionOverride?.seated ?? workspaceSpatialAgentMotion(agent).seated) ? 1 : 0
  );
  const locomotionStateRef = useRef<AgentLocomotionState>({
    key: "",
    station: "seat",
    route: [],
    routeIndex: 0,
    standAtMs: 0,
    departAtMs: 0,
    arrivedAtMs: 0
  });
  const invalidate = useThree((state) => state.invalidate);
  const reduceMotion = useReducedSceneMotion();
  const motion = motionOverride ?? workspaceSpatialAgentMotion(agent);
  const visitExchange = useContext(VisitChoreographyContext).exchanges.get(exchangeKey ?? agent.id);
  const animationEnabled = (animated || Boolean(visitExchange)) && !reduceMotion;
  const seated = seatedOverride ?? motion.seated;
  const ordinaryAgentScale = ORDINARY_AGENT_SCALE_BY_DENSITY[density];
  const statusRingDensityScale = orchestrator
    ? 1
    : Math.min(1, ORDINARY_AGENT_STATUS_RING_MAX_SCALE / ordinaryAgentScale.standing);
  const attentionEligible = Boolean(
    attentionTarget
    && attentionTone
    && animationEnabled
    && !ambient
    && motion.mode !== "approval"
    && motion.mode !== "tool"
  );
  const variant = agentHash(agent);
  const offline = agent.state === "offline";
  const active = motion.continuous;
  const idleMuted = !human && !orchestrator
    && agent.state === "online"
    && !agent.activity
    && !agent.communicationProgress
    && motion.mode === "idle"
    && !selected
    && !hovered
    && !focusedRoom;
  const baseColor = human ? "#d7654e" : orchestrator ? "#0d3a54" : agentColor(agent);
  const basePants = human ? "#32465f" : ["#1d3543", "#333945", "#244651"][variant % 3];
  const baseSkin = human ? "#c88968" : ["#b6785f", "#c28b69", "#875341", "#cf956e"][variant % 4];
  const baseHair = human ? "#322923" : ["#20272c", "#3c2c25", "#1b252b", "#574037"][variant % 4];
  const color = offline ? "#727d84" : idleMuted ? idleAgentColor(baseColor, 0.42) : baseColor;
  const pants = offline ? "#778188" : idleMuted ? idleAgentColor(basePants, 0.38) : basePants;
  const skin = offline ? "#9ba2a6" : idleMuted ? idleAgentColor(baseSkin, 0.3) : baseSkin;
  const hair = offline ? "#687177" : idleMuted ? idleAgentColor(baseHair, 0.36) : baseHair;
  const signal = human ? "#e06e57" : attentionEligible && attentionTone ? FLOW_COLORS[attentionTone] : statusColorForAgent(agent);
  const agentKey = `agent:${agent.workspaceId}:${agent.id}`;
  // 无 activity 的 Flow 仍可能把人物置为 communicating；头顶牌必须展示真实 state，不能退化成只有短名称的圆点。
  const compactStatusLabel = human ? null : agent.activity
    ? topologyLiveActivityLabelForWorkspace(agent.activity.kind, peerWorkspace)
    : agent.state === "communicating" || agent.state === "working" || agent.state === "error"
      ? statusLabelForAgent(agent, peerWorkspace)
      : null;
  const bodyOpacity = offline ? OFFLINE_AGENT_OPACITY : 1;
  // 只有 offline 进入透明队列；在线人物必须保持不透明并写入深度，避免看起来像半透明幽灵。
  const materialVisibility = { transparent: offline, opacity: bodyOpacity, depthWrite: true };
  const headY = seated ? 1.24 : 1.72;
  const neckY = seated ? 1.05 : 1.5;
  const torsoY = seated ? 0.81 : 1.18;
  const shoulderY = seated ? 0.98 : 1.36;
  const hipY = seated ? 0.58 : 0.86;
  const markerY = seated ? 1.82 : 2.26;
  const locomotionEnabled = Boolean(
    locomotion?.enabled
    && !offline
    && animationEnabled
  );
  const seatPoint = locomotion?.waypoints.seat ?? { x: position[0], z: position[2] };

  useFrame(({ clock }, delta) => {
    const phase = clock.elapsedTime * 1.8 + (variant % 13) * 0.31;
    const nowMs = Date.now();
    const ambientActive = motion.mode === "idle"
      && agent.state === "online"
      && workspaceSpatialAmbientIsActive(ambient, nowMs);
    const pairHandoffActive = Boolean(
      pairHandoff
      && nowMs >= pairHandoff.startedAtMs
      && nowMs < pairHandoff.returnAtMs
    );
    let walking = Boolean((typeof forcedWalking === "boolean" ? forcedWalking : forcedWalking.current) && animationEnabled && !offline);
    let preparingToWalk = false;
    let settlingAfterArrival = false;
    let arrivalProgress = 1;
    const root = rootRef.current;
    const locomotionState = locomotionStateRef.current;
    if (root) {
      root.position.y = 0;
      const authoritativeTarget = locomotion
        ? workspaceSpatialLocomotionTarget(motion, locomotion.waypoints, nowMs, locomotion.allowToolStation)
        : { station: "seat" as const, point: seatPoint };
      const requestedTarget: AgentLocomotionTarget = authoritativeTarget.station === "seat"
        && pairHandoffActive
        && pairHandoff
        ? {
            station: pairHandoff.role === "source" ? "handoff_source" : "handoff_target",
            point: pairHandoff.point
          }
        : authoritativeTarget.station === "seat"
        && ambientActive
        && locomotion
        ? workspaceSpatialAmbientUsesRefreshPoint(ambient, nowMs)
          ? { station: "refresh_point", point: locomotion.waypoints.refreshPoint }
          : workspaceSpatialAmbientUsesUtilityPoint(ambient, nowMs)
            ? { station: "utility_point", point: locomotion.waypoints.utilityPoint }
            : authoritativeTarget
        : authoritativeTarget;
      const destinationPoint = locomotionEnabled ? requestedTarget.point : seatPoint;
      const destinationOffset = {
        x: destinationPoint.x - seatPoint.x,
        z: destinationPoint.z - seatPoint.z
      };
      const locomotionKey = [
        locomotionEnabled ? requestedTarget.station : "seat",
        locomotionEnabled ? pairHandoffActive ? pairHandoff?.flowId : motion.activityId ?? motion.mode : "static",
        destinationPoint.x.toFixed(3),
        destinationPoint.z.toFixed(3)
      ].join(":");
      if (locomotionState.key !== locomotionKey) {
        locomotionState.key = locomotionKey;
        locomotionState.station = requestedTarget.station;
        locomotionState.arrivedAtMs = 0;
        if (locomotionEnabled && locomotion) {
          const routeAisleZ = (requestedTarget.station === "utility_point"
            || (ambientActive && ambient?.kind === "status_check"))
            ? locomotion.waypoints.utilityPoint.z + 0.26 - seatPoint.z
            : requestedTarget.station === "refresh_point"
              // Refresh Point 与 seat 同处房间中段，使用左侧有限短通道，避免为一次取杯绕完整个前侧 aisle。
              ? locomotion.waypoints.refreshPoint.z + 0.46 - seatPoint.z
              : locomotion.waypoints.aisleZ - seatPoint.z;
          const route = workspaceSpatialWaypointRoute(
            { x: root.position.x, z: root.position.z },
            destinationOffset,
            routeAisleZ
          );
          const travelDistance = Math.hypot(destinationOffset.x - root.position.x, destinationOffset.z - root.position.z);
          locomotionState.route = travelDistance > 0.012 ? route : [];
          locomotionState.routeIndex = Math.min(1, Math.max(0, locomotionState.route.length - 1));
          const terminalDelayMs = workspaceSpatialTerminalDurationMs(motion.terminal);
          // terminal 先在当前 station 播放完；仍处于坐姿时再留出有限起身窗口，然后才开始位移。
          locomotionState.standAtMs = locomotionState.route.length > 0
            ? nowMs + (requestedTarget.station === "seat" ? terminalDelayMs : 0)
            : 0;
          locomotionState.departAtMs = locomotionState.standAtMs > 0
            ? locomotionState.standAtMs + (poseBlendRef.current > 0.08 ? WORKSPACE_SPATIAL_STAND_TRANSITION_MS : 0)
            : 0;
        } else {
          // reduced-motion 与 peer Workspace 固定回 seat，不遗留半途位置。
          locomotionState.route = [];
          locomotionState.routeIndex = 0;
          locomotionState.standAtMs = 0;
          locomotionState.departAtMs = 0;
          locomotionState.arrivedAtMs = 0;
          root.position.x = destinationOffset.x;
          root.position.z = destinationOffset.z;
        }
      }

      const routeTarget = locomotionState.route[locomotionState.routeIndex];
      preparingToWalk = Boolean(routeTarget && nowMs >= locomotionState.standAtMs && nowMs < locomotionState.departAtMs);
      if (locomotionEnabled && routeTarget && nowMs >= locomotionState.departAtMs) {
        const offsetX = routeTarget.x - root.position.x;
        const offsetZ = routeTarget.z - root.position.z;
        const distance = Math.hypot(offsetX, offsetZ);
        const finalLeg = locomotionState.routeIndex === locomotionState.route.length - 1;
        const targetYaw = distance > 0.012 ? Math.atan2(offsetX, offsetZ) : root.rotation.y;
        if (distance > 0.012) {
          root.rotation.y = THREE.MathUtils.damp(root.rotation.y, targetYaw, 13, delta);
        }
        const remainingHeading = Math.abs(workspaceSpatialHeadingDelta(root.rotation.y, targetYaw));
        const alignedForTravel = remainingHeading <= WORKSPACE_SPATIAL_TURN_ALIGNMENT_RADIANS;
        if (!alignedForTravel && distance > 0.06) {
          // 先朝向下一段路线再位移，转角处形成短暂停顿，避免人物横向滑步切过 waypoint。
          preparingToWalk = true;
          if (animationEnabled) invalidate();
        } else {
          const step = workspaceSpatialLocomotionSpeed(distance, finalLeg) * Math.min(delta, 0.05);
          if (distance <= Math.max(step, 0.012)) {
            root.position.x = routeTarget.x;
            root.position.z = routeTarget.z;
            locomotionState.routeIndex += 1;
            walking = locomotionState.routeIndex < locomotionState.route.length;
            if (!walking && finalLeg) locomotionState.arrivedAtMs = nowMs;
          } else {
            root.position.x += offsetX / distance * step;
            root.position.z += offsetZ / distance * step;
            walking = true;
          }
        }
      } else if (locomotionEnabled && routeTarget && preparingToWalk) {
        const offsetX = routeTarget.x - root.position.x;
        const offsetZ = routeTarget.z - root.position.z;
        if (Math.hypot(offsetX, offsetZ) > 0.012) {
          root.rotation.y = THREE.MathUtils.damp(root.rotation.y, Math.atan2(offsetX, offsetZ), 10, delta);
        }
      } else {
        const attentionAllowed = attentionEligible && !ambientActive && !pairHandoffActive;
        const defaultYaw = locomotionEnabled && locomotionState.station !== "seat"
          ? workspaceSpatialStationYaw(locomotionState.station)
          : poseBlendRef.current > 0.5 ? workspaceSpatialStationYaw("seat") : 0.15;
        const targetYaw = externalFacing ? 0 : visitExchange ? visitExchange.yaw : attentionAllowed && attentionTarget
          ? Math.atan2(attentionTarget.x - root.position.x, attentionTarget.z - root.position.z)
          : defaultYaw;
        root.rotation.y = THREE.MathUtils.damp(
          root.rotation.y,
          targetYaw,
          attentionAllowed ? 7 : 10,
          delta
        );
        const remainingYaw = Math.abs(Math.atan2(
          Math.sin(targetYaw - root.rotation.y),
          Math.cos(targetYaw - root.rotation.y)
        ));
        // Flow 清空后 demand Canvas 仍补齐有限回正帧；角度收束后不再自行 invalidate。
        if (animationEnabled && remainingYaw > 0.004) invalidate();
      }
      if (locomotionState.arrivedAtMs > 0) {
        arrivalProgress = Math.min(1, Math.max(0,
          (nowMs - locomotionState.arrivedAtMs) / WORKSPACE_SPATIAL_ARRIVAL_SETTLE_MS
        ));
        settlingAfterArrival = arrivalProgress < 1;
        if (settlingAfterArrival && animationEnabled) invalidate();
      }
      // terminal / finite Flow 使用 demand 帧循环时，人物仍须自行续完回座路径；到站后立即停止请求新帧。
      if ((walking || preparingToWalk) && animationEnabled) invalidate();
    }
    const motionKey = motion.activityId ?? `resource:${motion.mode}`;
    if (motionKeyRef.current !== motionKey) {
      motionKeyRef.current = motionKey;
      terminalElapsedRef.current = 0;
    } else if (motion.terminal) {
      terminalElapsedRef.current += delta;
    }

    // 起身与落座使用连续 blend；准备阶段先完成姿态切换，再进入 waypoint 位移。
    const pairHandoffStation = locomotionState.station === "handoff_source" || locomotionState.station === "handoff_target";
    const poseSeatedTarget = seated && !walking && !preparingToWalk && !settlingAfterArrival
      && !pairHandoffStation;
    poseBlendRef.current = THREE.MathUtils.damp(poseBlendRef.current, poseSeatedTarget ? 1 : 0, 11, delta);
    const poseBlend = poseBlendRef.current;
    // demand Canvas 只在起身/落座尚未收束时补帧，完成后恢复空闲零持续渲染。
    if (animationEnabled && Math.abs(poseBlend - (poseSeatedTarget ? 1 : 0)) > 0.004) invalidate();
    const poseHeadY = THREE.MathUtils.lerp(1.72, 1.24, poseBlend);
    const poseNeckY = THREE.MathUtils.lerp(1.5, 1.05, poseBlend);
    const poseTorsoY = THREE.MathUtils.lerp(1.18, 0.81, poseBlend);
    const poseShoulderY = THREE.MathUtils.lerp(1.36, 0.98, poseBlend);
    const poseHipY = THREE.MathUtils.lerp(0.86, 0.58, poseBlend);
    const poseMarkerY = THREE.MathUtils.lerp(2.26, 1.82, poseBlend);
    const communicating = motion.mode === "communicating";
    const upperArmX = THREE.MathUtils.lerp(0.03, 0.5, poseBlend);
    const shoulderSpread = communicating ? -0.48 : -0.08;
    const forearmX = THREE.MathUtils.lerp(communicating ? -0.16 : 0, -1.08, poseBlend);

    if (figureRef.current) {
      figureRef.current.position.set(0, 0, 0);
      figureRef.current.rotation.set(0, 0, 0);
    }
    if (refreshCupRef.current) refreshCupRef.current.visible = false;
    if (rootRef.current && !orchestrator) {
      // 人物、椅子、Marker 与可点击几何共享密度比例；父组位置仍由 waypoint 决定，放大不会改变移动终点。
      rootRef.current.scale.setScalar(THREE.MathUtils.lerp(ordinaryAgentScale.standing, ordinaryAgentScale.seated, poseBlend));
    }
    if (chairRef.current) chairRef.current.visible = poseBlend > 0.08;
    if (headRigRef.current) headRigRef.current.position.y = poseHeadY;
    if (neckRef.current) neckRef.current.position.y = poseNeckY;
    if (torsoRigRef.current) torsoRigRef.current.position.y = poseTorsoY;
    if (shoulderRef.current) shoulderRef.current.position.y = poseShoulderY - 0.02;
    if (hipRef.current) hipRef.current.position.y = poseHipY;
    if (collarRef.current) collarRef.current.position.y = poseTorsoY + 0.21;
    if (leftUpperArmRef.current) leftUpperArmRef.current.position.y = poseShoulderY;
    if (rightUpperArmRef.current) rightUpperArmRef.current.position.y = poseShoulderY;
    if (leftThighRef.current) leftThighRef.current.position.y = poseHipY;
    if (rightThighRef.current) rightThighRef.current.position.y = poseHipY;
    headRigRef.current?.rotation.set(0, 0, 0);
    torsoRigRef.current?.rotation.set(0, 0, 0);
    resetHumanoidArmPose(leftUpperArmRef.current, leftForearmRef.current, -1, upperArmX, shoulderSpread, forearmX);
    resetHumanoidArmPose(rightUpperArmRef.current, rightForearmRef.current, 1, upperArmX, shoulderSpread, forearmX);
    // 坐姿膝盖与脚尖沿人物正向弯曲；椅背留在反方向，避免上半身朝椅背、双脚朝房间的扭转感。
    if (leftThighRef.current) leftThighRef.current.rotation.set(-1.03 * poseBlend, 0, 0);
    if (leftShinRef.current) leftShinRef.current.rotation.set(1.03 * poseBlend, 0, 0);
    if (rightThighRef.current) rightThighRef.current.rotation.set(-1.03 * poseBlend, 0, 0);
    if (rightShinRef.current) rightShinRef.current.rotation.set(1.03 * poseBlend, 0, 0);
    if (markerRef.current) {
      markerRef.current.position.set(0, poseMarkerY, 0);
      markerRef.current.rotation.set(0, 0, 0);
      markerRef.current.scale.setScalar(1);
    }
    if (statusRingRef.current) {
      // 人物可放大，但状态环限制到密集工位仍有净距；TYR 保持原始控制台环比例。
      const scale = statusRingDensityScale * (active && animationEnabled ? 1 + Math.sin(phase * 1.35) * 0.09 : 1);
      statusRingRef.current.scale.setScalar(scale);
    }

    // 普通 peer Workspace 保持静态；直接 Bridge 关联的 worker 会由调用方显式开启权威工作动作。
    if (offline || !animationEnabled) return;

    if (markerRef.current && motion.marker !== "none" && active) {
      markerRef.current.position.y = poseMarkerY + Math.sin(phase * 1.45) * 0.035;
      markerRef.current.rotation.y = motion.mode === "approval" ? Math.sin(phase * 0.72) * 0.18 : Math.sin(phase * 0.45) * 0.06;
    }

    if (walking) {
      // 角色步态只在有限 waypoint 路径上运行，到站后立即让位给 station 工作或 approval 姿态。
      const walkPose = workspaceSpatialWalkPose(clock.elapsedTime * 8.4 + (variant % 5) * 0.2);
      if (figureRef.current) figureRef.current.position.y = walkPose.lift;
      if (headRigRef.current) headRigRef.current.rotation.z = walkPose.headRoll;
      if (leftUpperArmRef.current) leftUpperArmRef.current.rotation.x = walkPose.leftArmPitch;
      if (rightUpperArmRef.current) rightUpperArmRef.current.rotation.x = walkPose.rightArmPitch;
      if (leftForearmRef.current) leftForearmRef.current.rotation.x = walkPose.leftForearmPitch;
      if (rightForearmRef.current) rightForearmRef.current.rotation.x = walkPose.rightForearmPitch;
      if (leftThighRef.current) leftThighRef.current.rotation.x = walkPose.leftThighPitch;
      if (rightThighRef.current) rightThighRef.current.rotation.x = walkPose.rightThighPitch;
      if (leftShinRef.current) leftShinRef.current.rotation.x = walkPose.leftShinPitch;
      if (rightShinRef.current) rightShinRef.current.rotation.x = walkPose.rightShinPitch;
      return;
    }

    if (visitExchange) {
      const exchange = visitExchange.states.get(visitExchange.visitId);
      if (exchange && ["handoff", "receiving"].includes(exchange.stage)) {
        const pose = workspaceSpatialVisitExchangePose((exchange.stageElapsedMs ?? 0) / visitExchange.durationMs, visitExchange.speaker);
        if (headRigRef.current) headRigRef.current.rotation.x = pose.headPitch;
        if (rightUpperArmRef.current) rightUpperArmRef.current.rotation.set(pose.armPitch, 0, 0.12);
        if (rightForearmRef.current) rightForearmRef.current.rotation.x = pose.forearmPitch;
        invalidate();
        return;
      }
    }

    if (settlingAfterArrival) {
      const arrivalPose = workspaceSpatialArrivalPose(arrivalProgress);
      if (figureRef.current) figureRef.current.position.y = arrivalPose.lift;
      if (torsoRigRef.current) torsoRigRef.current.rotation.set(arrivalPose.torsoPitch, 0, arrivalPose.torsoRoll);
      if (leftThighRef.current) leftThighRef.current.rotation.x = arrivalPose.leftThighPitch;
      if (rightThighRef.current) rightThighRef.current.rotation.x = arrivalPose.rightThighPitch;
      if (leftShinRef.current) leftShinRef.current.rotation.x = arrivalPose.leftShinPitch;
      if (rightShinRef.current) rightShinRef.current.rotation.x = arrivalPose.rightShinPitch;
      return;
    }

    if (ambientActive && ambient) {
      const progress = Math.min(1, Math.max(0, (nowMs - ambient.startedAtMs) / (ambient.endsAtMs - ambient.startedAtMs)));
      if (ambient.kind === "stretch") {
        const stretch = workspaceSpatialStretchPose(progress);
        if (figureRef.current) figureRef.current.position.y = stretch.lift;
        if (headRigRef.current) headRigRef.current.rotation.set(stretch.headPitch, 0, stretch.headRoll);
        if (torsoRigRef.current) torsoRigRef.current.rotation.set(stretch.torsoPitch, 0, stretch.torsoRoll);
        if (leftUpperArmRef.current) leftUpperArmRef.current.rotation.set(stretch.upperArmPitch, 0, -(stretch.upperArmSpread - 0.08));
        if (rightUpperArmRef.current) rightUpperArmRef.current.rotation.set(stretch.upperArmPitch, 0, stretch.upperArmSpread - 0.08);
        if (leftForearmRef.current) leftForearmRef.current.rotation.set(stretch.forearmPitch, 0, -stretch.forearmFold);
        if (rightForearmRef.current) rightForearmRef.current.rotation.set(stretch.forearmPitch, 0, stretch.forearmFold);
        return;
      }
      if (ambient.kind === "status_check" && nowMs < ambient.returnAtMs) {
        if (headRigRef.current) {
          headRigRef.current.rotation.x = 0.045;
          headRigRef.current.rotation.y = Math.sin(phase * 0.42) * 0.13;
        }
        if (torsoRigRef.current) torsoRigRef.current.rotation.y = Math.sin(phase * 0.32) * 0.035;
        if (rightUpperArmRef.current) rightUpperArmRef.current.rotation.z = -0.38;
        if (rightForearmRef.current) rightForearmRef.current.rotation.x = -0.32 + Math.sin(phase * 0.65) * 0.07;
        return;
      }
      if (ambient.kind === "refresh_break" && nowMs < ambient.returnAtMs) {
        const sip = (Math.sin(phase * 0.54) + 1) / 2;
        if (headRigRef.current) {
          headRigRef.current.rotation.x = 0.035 + sip * 0.045;
          headRigRef.current.rotation.y = Math.sin(phase * 0.24) * 0.045;
        }
        if (torsoRigRef.current) torsoRigRef.current.rotation.y = -0.045;
        if (rightUpperArmRef.current) rightUpperArmRef.current.rotation.set(-0.34 - sip * 0.18, 0, -0.68);
        if (rightForearmRef.current) rightForearmRef.current.rotation.set(-1.18 - sip * 0.24, 0, 0.08);
        if (leftUpperArmRef.current) leftUpperArmRef.current.rotation.z = -0.16;
        if (refreshCupRef.current && locomotionState.station === "refresh_point") {
          // 纸杯只在人物抵达 Refresh Point 后出现，返程与中断时立即收起，避免悬浮道具穿越房间。
          refreshCupRef.current.visible = true;
          refreshCupRef.current.position.set(0.3, 1.34 + sip * 0.26, 0.21 - sip * 0.04);
          refreshCupRef.current.rotation.set(0.08 + sip * 0.2, 0, -0.08);
        }
        return;
      }
    }

    const workPose = workspaceSpatialWorkPose(motion.mode, phase, upperArmX, forearmX);
    if (workPose) {
      if (figureRef.current) figureRef.current.position.y = workPose.lift;
      headRigRef.current?.rotation.set(workPose.headPitch, workPose.headYaw, workPose.headRoll);
      torsoRigRef.current?.rotation.set(workPose.torsoPitch, workPose.torsoYaw, workPose.torsoRoll);
      leftUpperArmRef.current?.rotation.set(workPose.leftUpperArmPitch, 0, workPose.leftUpperArmRoll);
      leftForearmRef.current?.rotation.set(workPose.leftForearmPitch, 0, 0);
      rightUpperArmRef.current?.rotation.set(workPose.rightUpperArmPitch, 0, workPose.rightUpperArmRoll);
      rightForearmRef.current?.rotation.set(workPose.rightForearmPitch, 0, 0);
    }

    if (parallelReceipt && !motion.terminal) {
      const receiptStartAtMs = parallelReceipt.startedAtMs
        + WORKSPACE_SPATIAL_PARALLEL_DISPATCH_FANOUT_END_MS
        + parallelReceipt.targetIndex * WORKSPACE_SPATIAL_PARALLEL_DISPATCH_TARGET_STAGGER_MS;
      const receiptDurationMs = Math.max(1,
        WORKSPACE_SPATIAL_PARALLEL_DISPATCH_RECEIPT_END_MS
        - WORKSPACE_SPATIAL_PARALLEL_DISPATCH_FANOUT_END_MS
      );
      const receiptProgress = (nowMs - receiptStartAtMs) / receiptDurationMs;
      if (receiptProgress >= 0 && receiptProgress < 1) {
        const receiptEnvelope = Math.sin(receiptProgress * Math.PI);
        // 工位接收只做一次短促前探与点头；不离座、不制造新的 activity/status，也不覆盖 terminal 姿态。
        if (headRigRef.current) headRigRef.current.rotation.x += 0.16 * receiptEnvelope;
        if (torsoRigRef.current) torsoRigRef.current.rotation.x += 0.055 * receiptEnvelope;
        if (rightUpperArmRef.current) {
          rightUpperArmRef.current.rotation.x = THREE.MathUtils.lerp(rightUpperArmRef.current.rotation.x, -0.24, receiptEnvelope);
          rightUpperArmRef.current.rotation.z = THREE.MathUtils.lerp(rightUpperArmRef.current.rotation.z, -0.34, receiptEnvelope);
        }
        if (rightForearmRef.current) {
          rightForearmRef.current.rotation.x = THREE.MathUtils.lerp(rightForearmRef.current.rotation.x, -0.58, receiptEnvelope);
        }
        if (animationEnabled) invalidate();
      }
    }

    if (resultContribution && !motion.terminal) {
      const contributionStartAtMs = resultContribution.startedAtMs
        + WORKSPACE_SPATIAL_RESULT_CONVERGENCE_COLLECT_START_MS
        + resultContribution.sourceIndex * WORKSPACE_SPATIAL_RESULT_CONVERGENCE_STAGGER_MS;
      const contributionProgress = (nowMs - contributionStartAtMs) / 1_500;
      if (contributionProgress >= 0 && contributionProgress < 1) {
        const contributionEnvelope = Math.sin(contributionProgress * Math.PI);
        // response contributor 只做一次向前递交；成功 terminal 自己播放时本手势完全让位。
        if (headRigRef.current) headRigRef.current.rotation.x += 0.09 * contributionEnvelope;
        if (torsoRigRef.current) torsoRigRef.current.rotation.x += 0.04 * contributionEnvelope;
        if (rightUpperArmRef.current) {
          rightUpperArmRef.current.rotation.x = THREE.MathUtils.lerp(rightUpperArmRef.current.rotation.x, -0.34, contributionEnvelope);
          rightUpperArmRef.current.rotation.z = THREE.MathUtils.lerp(rightUpperArmRef.current.rotation.z, -0.22, contributionEnvelope);
        }
        if (rightForearmRef.current) {
          rightForearmRef.current.rotation.x = THREE.MathUtils.lerp(rightForearmRef.current.rotation.x, -0.38, contributionEnvelope);
        }
        if (animationEnabled) invalidate();
      }
    }

    if (resultRecipient && !motion.terminal) {
      const receiptProgress = (nowMs - resultRecipient.reachAtMs)
        / Math.max(1, resultRecipient.receivedAtMs - resultRecipient.reachAtMs);
      if (nowMs >= resultRecipient.reachAtMs && nowMs < resultRecipient.endsAtMs) {
        const reach = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(receiptProgress, 0, 1), 0, 1);
        const releaseStartAtMs = Math.max(resultRecipient.receivedAtMs, resultRecipient.endsAtMs - 900);
        const release = nowMs < releaseStartAtMs
          ? 1
          : 1 - THREE.MathUtils.smoothstep(
              THREE.MathUtils.clamp((nowMs - releaseStartAtMs) / Math.max(1, resultRecipient.endsAtMs - releaseStartAtMs), 0, 1),
              0,
              1
            );
        const receiptEnvelope = reach * release;
        // requester 用双手接住唯一结果册并短暂停留；房内直达与跨房间接力只复用时间参数，不新增状态。
        if (headRigRef.current) headRigRef.current.rotation.x += 0.13 * receiptEnvelope;
        if (torsoRigRef.current) torsoRigRef.current.rotation.x += 0.055 * receiptEnvelope;
        if (leftUpperArmRef.current) {
          leftUpperArmRef.current.rotation.x = THREE.MathUtils.lerp(leftUpperArmRef.current.rotation.x, -0.28, receiptEnvelope);
          leftUpperArmRef.current.rotation.z = THREE.MathUtils.lerp(leftUpperArmRef.current.rotation.z, 0.32, receiptEnvelope);
        }
        if (rightUpperArmRef.current) {
          rightUpperArmRef.current.rotation.x = THREE.MathUtils.lerp(rightUpperArmRef.current.rotation.x, -0.28, receiptEnvelope);
          rightUpperArmRef.current.rotation.z = THREE.MathUtils.lerp(rightUpperArmRef.current.rotation.z, -0.32, receiptEnvelope);
        }
        if (leftForearmRef.current) {
          leftForearmRef.current.rotation.x = THREE.MathUtils.lerp(leftForearmRef.current.rotation.x, -0.58, receiptEnvelope);
        }
        if (rightForearmRef.current) {
          rightForearmRef.current.rotation.x = THREE.MathUtils.lerp(rightForearmRef.current.rotation.x, -0.58, receiptEnvelope);
        }
        if (animationEnabled) invalidate();
      }
    }

    const terminalDuration = workspaceSpatialTerminalDurationMs(motion.terminal) / 1_000;
    if (!motion.terminal || terminalDuration <= 0 || terminalElapsedRef.current >= terminalDuration) return;
    const progress = Math.min(1, terminalElapsedRef.current / terminalDuration);
    const envelope = 1 - progress;
    // terminal activity 不再让全场景进入 always；人物只为这段有限回执续帧。
    if (progress < 1) invalidate();
    if (motion.terminal === "success") {
      if (figureRef.current) figureRef.current.position.y = Math.sin(progress * Math.PI) * 0.15;
      if (leftUpperArmRef.current) leftUpperArmRef.current.rotation.z = -1.08 * envelope;
      if (rightUpperArmRef.current) rightUpperArmRef.current.rotation.z = 1.08 * envelope;
      if (markerRef.current) markerRef.current.scale.setScalar(1 + Math.sin(progress * Math.PI) * 0.22);
    } else if (motion.terminal === "error") {
      if (figureRef.current) {
        figureRef.current.position.x = Math.sin(progress * Math.PI * 8) * envelope * 0.055;
        figureRef.current.rotation.z = Math.sin(progress * Math.PI * 8) * envelope * 0.035;
      }
      if (headRigRef.current) headRigRef.current.rotation.x = 0.11 * envelope;
    }
  });

  return (
    <group
      position={position}
      onPointerOver={(event) => { event.stopPropagation(); onHover(agentKey); }}
      onPointerOut={(event) => { event.stopPropagation(); onHover(null); }}
    >
      <group
        ref={rootRef}
        scale={orchestrator
          ? [1.16, 1.16, 1.16]
          : seated
            ? [ordinaryAgentScale.seated, ordinaryAgentScale.seated, ordinaryAgentScale.seated]
            : [ordinaryAgentScale.standing, ordinaryAgentScale.standing, ordinaryAgentScale.standing]}
        rotation={[0, seated ? 0 : 0.15, 0]}
        onClick={(event) => stopAndSelect(event, onSelect)}
      >
      <mesh position={[0, 0.012, 0.02]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.2, 0.7, 1]}>
        <circleGeometry args={[0.34, 32]} />
        <meshBasicMaterial color="#24323a" transparent opacity={offline ? 0.08 : idleMuted ? 0.09 : 0.16} depthWrite={false} />
      </mesh>
      {attentionEligible && attentionTone && (
        <group position={[0, 0.048, 0.43]}>
          {/* 方向短标只标注真实 Flow，随人物朝向旋转；不承担独立动画，也不虚构交互对象。 */}
          <mesh position={[0, 0, 0.07]}>
            <boxGeometry args={[0.035, 0.014, 0.18]} />
            <meshBasicMaterial color={FLOW_COLORS[attentionTone]} transparent opacity={0.86} toneMapped={false} depthWrite={false} />
          </mesh>
          <mesh position={[0, 0, 0.19]} rotation={[0, Math.PI / 4, 0]}>
            <boxGeometry args={[0.1, 0.016, 0.1]} />
            <meshBasicMaterial color={FLOW_COLORS[attentionTone]} transparent opacity={0.9} toneMapped={false} depthWrite={false} />
          </mesh>
        </group>
      )}
      <group ref={statusRingRef} position={[0, 0.035, 0]} scale={statusRingDensityScale}>
        {clone && (
          <>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.56, 0.59, 40]} />
              <meshBasicMaterial color="#956ce6" transparent opacity={0.82} toneMapped={false} depthWrite={false} />
            </mesh>
            {[0, 1, 2].map((index) => {
              const angle = index / 3 * Math.PI * 2;
              return <mesh key={`clone-${index}`} position={[Math.cos(angle) * 0.575, 0.006, Math.sin(angle) * 0.575]}>
                <sphereGeometry args={[0.035, 10, 10]} />
                <meshBasicMaterial color="#d4c2ff" toneMapped={false} />
              </mesh>;
            })}
          </>
        )}
        {offline ? Array.from({ length: 10 }, (_, index) => {
          const angle = index / 10 * Math.PI * 2;
          const radius = selected ? 0.42 : hovered ? 0.385 : 0.35;
          return (
            <mesh key={index} position={[Math.cos(angle) * radius, 0, Math.sin(angle) * radius]}>
              <sphereGeometry args={[selected ? 0.035 : hovered ? 0.031 : 0.026, 8, 8]} />
              <meshBasicMaterial color={signal} transparent opacity={0.46} toneMapped={false} depthWrite={false} />
            </mesh>
          );
        }) : idleMuted ? (
          <>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.326, 0.35, 40]} />
              <meshBasicMaterial color="#91a5ae" transparent opacity={0.34} toneMapped={false} depthWrite={false} />
            </mesh>
            <mesh position={[0, 0.008, 0.365]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.043, 18]} />
              <meshBasicMaterial color={LIVING_TOPOLOGY_PALETTE.green.accent} transparent opacity={0.74} toneMapped={false} depthWrite={false} />
            </mesh>
          </>
        ) : (
          <>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[
                selected ? 0.34 : hovered ? 0.315 : active ? 0.285 : 0.3,
                selected ? 0.5 : hovered ? 0.465 : active ? 0.455 : 0.405,
                40
              ]} />
              <meshBasicMaterial color={signal} transparent opacity={active ? 0.9 : 0.68} toneMapped={false} depthWrite={false} />
            </mesh>
            {active && (
              <>
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[selected ? 0.53 : 0.485, selected ? 0.565 : 0.515, 40]} />
                  <meshBasicMaterial color={signal} transparent opacity={0.56} toneMapped={false} depthWrite={false} />
                </mesh>
                {/* 前向三角既标出人物朝向，也让 active ring 不只依赖颜色表达状态。 */}
                <mesh position={[0, 0.008, selected ? 0.59 : 0.54]} rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[selected ? 0.09 : 0.075, 3]} />
                  <meshBasicMaterial color={signal} transparent opacity={0.92} toneMapped={false} depthWrite={false} />
                </mesh>
              </>
            )}
          </>
        )}
      </group>
      <group ref={figureRef}>
        {seated && (
          <group ref={chairRef} position={[0, 0, -0.16]}>
            <RoundedBox args={[0.52, 0.1, 0.48]} radius={0.06} smoothness={3} position={[0, 0.44, 0]} castShadow={!offline}>
              <meshStandardMaterial color={offline ? "#7f888e" : "#536a76"} roughness={0.6} {...materialVisibility} />
            </RoundedBox>
            <RoundedBox args={[0.5, 0.58, 0.09]} radius={0.05} smoothness={3} position={[0, 0.72, -0.21]} castShadow={!offline}>
              <meshStandardMaterial color={offline ? "#7f888e" : "#536a76"} roughness={0.62} {...materialVisibility} />
            </RoundedBox>
            <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.045, 0.055, 0.38, 12]} /><meshStandardMaterial color="#65727a" metalness={0.45} {...materialVisibility} /></mesh>
          </group>
        )}
        <group ref={headRigRef} position={[0, headY, 0]}>
          <mesh castShadow={!offline && !idleMuted} scale={[0.88, 1.05, 0.92]}>
            <sphereGeometry args={[0.175, 28, 22]} />
            <meshStandardMaterial color={skin} roughness={0.62} {...materialVisibility} />
          </mesh>
          <mesh castShadow={!offline && !idleMuted} position={[0, 0.12, -0.03]} scale={[1.03, 0.5, 1.04]}>
            <sphereGeometry args={[0.18, 24, 18, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={hair} roughness={0.77} {...materialVisibility} />
          </mesh>
          {/* 中性 visor 只标注脸部正向；状态继续由头顶 badge 与地面 ring 表达。 */}
          <RoundedBox args={[0.19, 0.055, 0.032]} radius={0.018} smoothness={3} position={[0, -0.012, 0.164]}>
            <meshStandardMaterial color={offline ? "#657078" : idleMuted ? "#59676d" : "#23343d"} roughness={0.48} metalness={0.16} {...materialVisibility} />
          </RoundedBox>
          <mesh position={[0, -0.012, 0.183]}>
            <boxGeometry args={[0.066, 0.014, 0.009]} />
            <meshBasicMaterial color={offline ? "#879198" : idleMuted ? "#8eb8ba" : "#9cdfe2"} toneMapped={false} {...materialVisibility} />
          </mesh>
        </group>
        <mesh ref={neckRef} castShadow={!offline && !idleMuted} position={[0, neckY, 0]}>
          <cylinderGeometry args={[0.095, 0.1, 0.13, 18]} />
          <meshStandardMaterial color={skin} roughness={0.64} {...materialVisibility} />
        </mesh>
        <mesh ref={torsoRigRef} castShadow={!offline && !idleMuted} position={[0, torsoY, 0]} scale={[1, 1, 0.72]}>
          <cylinderGeometry args={[0.24, 0.18, orchestrator ? 0.68 : 0.62, 20]} />
          <meshStandardMaterial color={color} roughness={0.66} metalness={orchestrator ? 0.12 : 0.03} {...materialVisibility} />
        </mesh>
        <mesh ref={shoulderRef} castShadow={!offline && !idleMuted} position={[0, shoulderY - 0.02, 0]} rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.105, 0.31, 6, 14]} />
          <meshStandardMaterial color={color} roughness={0.66} {...materialVisibility} />
        </mesh>
        <mesh ref={hipRef} castShadow={!offline && !idleMuted} position={[0, hipY, 0]} scale={[1.15, 0.58, 0.82]}>
          <sphereGeometry args={[0.2, 18, 14]} />
          <meshStandardMaterial color={pants} roughness={0.75} {...materialVisibility} />
        </mesh>
        <mesh ref={collarRef} position={[0, torsoY + 0.21, 0.176]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.12, 0.018, 8, 22, Math.PI]} />
          <meshStandardMaterial color={orchestrator ? "#80e2d5" : "#d8e1e3"} roughness={0.48} {...materialVisibility} />
        </mesh>
        {orchestrator && (
          <group>
            <RoundedBox args={[0.37, 0.5, 0.06]} radius={0.025} smoothness={2} position={[0, torsoY - 0.02, 0.18]}>
              <meshStandardMaterial color="#225d72" metalness={0.18} roughness={0.5} {...materialVisibility} />
            </RoundedBox>
            <mesh position={[0, torsoY - 0.01, 0.216]}><boxGeometry args={[0.035, 0.4, 0.018]} /><meshBasicMaterial color="#69dfd2" toneMapped={false} {...materialVisibility} /></mesh>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * 0.23, shoulderY + 0.015, 0]}><boxGeometry args={[0.12, 0.035, 0.2]} /><meshStandardMaterial color="#65d8cd" emissive="#65d8cd" emissiveIntensity={0.25} {...materialVisibility} /></mesh>
            ))}
          </group>
        )}
        {([-1, 1] as const).map((side) => (
          <HumanoidArm
            key={`arm-${side}`}
            side={side}
            shoulderY={shoulderY}
            seated={seated}
            communicating={motion.mode === "communicating"}
            sleeve={color}
            skin={skin}
            faded={offline}
            castShadow={!offline && !idleMuted}
            upperArmRef={side === -1 ? leftUpperArmRef : rightUpperArmRef}
            forearmRef={side === -1 ? leftForearmRef : rightForearmRef}
          />
        ))}
        <group ref={refreshCupRef} visible={false} position={[0.3, 1.34, 0.21]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.06, 0.047, 0.16, 14]} />
            <meshStandardMaterial color="#f4efe3" roughness={0.72} />
          </mesh>
          <mesh position={[0, 0.081, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.06, 0.008, 6, 18]} />
            <meshStandardMaterial color="#6baea8" roughness={0.58} />
          </mesh>
        </group>
        {([-1, 1] as const).map((side) => (
          <HumanoidLeg
            key={`leg-${side}`}
            side={side}
            hipY={hipY}
            seated={seated}
            pants={pants}
            faded={offline}
            castShadow={!offline && !idleMuted}
            thighRef={side === -1 ? leftThighRef : rightThighRef}
            shinRef={side === -1 ? leftShinRef : rightShinRef}
          />
        ))}
        {!orchestrator && textMode === "name" && (
          <Html position={[0, (seated ? 1.82 : 2.28) + labelLift, 0]} center zIndexRange={selected || hovered ? [26, 0] : [10, 0]}>
            <button type="button" title={`${agent.displayName} · ${human ? "You" : statusLabelForAgent(agent, peerWorkspace)}`} aria-label={`${agent.displayName} · ${human ? "You" : statusLabelForAgent(agent, peerWorkspace)}`} className={`spatial-agent-label density-${density} state-${agent.state}${human ? " human" : ""}${agent.activity ? ` activity-${agent.activity.kind}` : ""}${idleMuted ? " idle-muted" : ""}${focusedRoom ? " focused-room" : ""}${hovered ? " hovered" : ""}${selected ? " selected" : ""}`} onPointerEnter={() => onHover(agentKey)} onPointerLeave={() => onHover(null)} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
              <span><AgentDisplayName displayName={agent.displayName} /></span>
              {human ? <small>You</small> : compactStatusLabel && <small>{compactStatusLabel}</small>}
            </button>
          </Html>
        )}
      </group>
        {!orchestrator && !human && (
          <AgentActivityMarker
            agent={agent}
            marker={motion.marker}
            markerRef={markerRef}
            position={[0, markerY, 0]}
            labelLift={labelLift}
            density={density}
            peerWorkspace={peerWorkspace}
            selected={selected}
            hovered={hovered}
            showText={textMode === "status"}
            focusedRoom={focusedRoom}
            onHover={onHover}
            onSelect={onSelect}
          />
        )}
      </group>
    </group>
  );
}

function useWorkspaceBridgeTransitPhase(
  signal: BridgeCommunicationFlowSignal | undefined,
  onPlaybackComplete: (playbackKey: string) => void,
  responseStartsImmediately = false
): WorkspaceSpatialBridgeTransitPhase {
  const signalKey = signal ? bridgeTransitPlaybackKey(signal) : "";
  const playbackTimingKey = `${signalKey}:${responseStartsImmediately ? "immediate" : "handoff"}`;
  const [phase, setPhase] = useState<WorkspaceSpatialBridgeTransitPhase>("complete");
  const completeRef = useRef(onPlaybackComplete);
  completeRef.current = onPlaybackComplete;

  useEffect(() => {
    if (!signal || !signalKey) {
      setPhase("complete");
      return;
    }
    const tone = signal.tone;
    const leadingDelay = tone === "request" || responseStartsImmediately
      ? 0
      : WORKSPACE_SPATIAL_BRIDGE_WORKER_HANDOFF_SECONDS;
    const sourceEndsAt = leadingDelay + WORKSPACE_SPATIAL_BRIDGE_RIVER_PHASE_SECONDS;
    const bridgeEndsAt = sourceEndsAt + WORKSPACE_SPATIAL_BRIDGE_EFFECT_PHASE_SECONDS;
    const totalDuration = leadingDelay + workspaceSpatialBridgeTransitDurationSeconds("request");
    const timers: number[] = [];
    const phaseAt = (elapsedSeconds: number): WorkspaceSpatialBridgeTransitPhase => (
      elapsedSeconds < leadingDelay
        ? "waiting"
        : workspaceSpatialBridgeTransitPhaseAt(elapsedSeconds - leadingDelay, "request")
    );
    setPhase(phaseAt(0));

    for (const boundary of [leadingDelay, sourceEndsAt, bridgeEndsAt]) {
      if (boundary <= 0) continue;
      timers.push(window.setTimeout(() => {
        setPhase(phaseAt(boundary));
      }, boundary * 1_000));
    }
    timers.push(window.setTimeout(() => {
      setPhase("complete");
      completeRef.current(signalKey);
    }, totalDuration * 1_000));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [playbackTimingKey]);

  return phase;
}

function bridgeJourneySignal(
  layout: SceneLayout,
  journey: TopologyBridgeJourneyRecord
): BridgeCommunicationFlowSignal | undefined {
  const currentWorkspace = layout.workspaces.find((workspace) => workspace.workspace.current);
  if (!currentWorkspace) return undefined;
  return {
    id: `bridge-journey:${journey.id}:${journey.phase}`,
    messageId: journey.requestMessageId,
    direction: journey.sourceWorkspaceId === currentWorkspace.workspace.id ? "outbound" : "inbound",
    tone: workspaceSpatialBridgeJourneyTone(journey.phase),
    continuous: journey.continuous,
    createdAt: journey.phaseAt
  };
}

function bridgeJourneySourceAgent(
  layout: SceneLayout,
  journey: TopologyBridgeJourneyRecord
): WorkspaceSpatialAgent | undefined {
  return layout.workspaces
    .find((workspace) => workspace.workspace.id === journey.sourceWorkspaceId)
    ?.workspace.controllers.find((agent) => agent.id === journey.sourceAgentId);
}

type VisitExchangeCue = {
  visitId: string; states: ReadonlyMap<string, WorkspaceSpatialVisitState>;
  speaker: boolean; yaw: number; durationMs: number;
};
const VisitChoreographyContext = createContext({
  exchanges: new Map<string, VisitExchangeCue>(), revision: 0, stageChanged: () => {}
});

function visitRoutePoints(route: WorkspaceSpatialBridgeTransitRoute, localVisit: boolean) {
  const points = workspaceSpatialBridgeJourneyRoutePoints(route.points);
  if (localVisit && points.length > 1) {
    const target = route.points.at(-1)!;
    points[points.length - 1] = [target[0], target[1], target[2] + 0.9];
  }
  return points;
}

function humanActor(id: string, displayName: string, workspaceId: string, communicating = false): WorkspaceSpatialAgent {
  return {
    id,
    name: displayName,
    displayName,
    runtime: "Human",
    state: communicating ? "communicating" : "online",
    local: true,
    workspaceId,
    controller: false
  };
}

const HUMAN_IDLE_MOTION: WorkspaceSpatialAgentMotion = {
  mode: "idle",
  seated: false,
  marker: "none",
  continuous: false,
  terminal: null
};

function HumanPresence({ id, displayName, workspaceId, position }: {
  id: string;
  displayName: string;
  workspaceId: string;
  position: [number, number, number];
}) {
  const agent = useMemo(() => humanActor(id, displayName, workspaceId), [displayName, id, workspaceId]);
  return (
    <AgentFigure
      agent={agent}
      animated={false}
      peerWorkspace={false}
      position={position}
      seated={false}
      motion={HUMAN_IDLE_MOTION}
      selected={false}
      hovered={false}
      human
      onHover={() => undefined}
      onSelect={() => undefined}
    />
  );
}

function humanStateAsVisitState(
  journey: WorkspaceSpatialHumanJourney,
  state: WorkspaceSpatialHumanJourneyState
): WorkspaceSpatialVisitState {
  return {
    progress: state.progress,
    stage: state.stage,
    stageAt: Date.parse(journey.createdAt),
    stageElapsedMs: state.stageElapsedMs,
    factUpdatedAt: journey.createdAt,
    visualStarted: true,
    requestExchanged: state.stage !== "outbound" && state.stage !== "handoff"
  };
}

function HumanJourneyWalker({ journey, route, initialState, visualStates, onStageChange, onCheckpoint, onComplete }: {
  journey: WorkspaceSpatialHumanJourney;
  route: WorkspaceSpatialBridgeTransitRoute;
  initialState?: WorkspaceSpatialHumanJourneyState;
  visualStates: Map<string, WorkspaceSpatialVisitState>;
  onStageChange: () => void;
  onCheckpoint: (state: WorkspaceSpatialHumanJourneyState) => void;
  onComplete: (journeyId: string) => void;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  const reduceMotion = useReducedSceneMotion();
  const stateRef = useRef(initialState ?? workspaceSpatialHumanJourneyInitialState());
  const [visualState, setVisualState] = useState(stateRef.current);
  const walkingRef = useRef(false);
  const completedRef = useRef(false);
  const checkpointAtRef = useRef(0);
  const checkpointRef = useRef(onCheckpoint);
  checkpointRef.current = onCheckpoint;
  const agent = useMemo(() => humanActor(journey.humanId, journey.humanDisplayName, journey.workspaceId, true), [journey]);
  const motion = useMemo<WorkspaceSpatialAgentMotion>(() => ({
    mode: "communicating", seated: false, marker: "none", continuous: true, terminal: null,
    activityId: journey.id, activityStartedAt: journey.createdAt
  }), [journey.createdAt, journey.id]);
  const geometry = useMemo(() => {
    const vectors = route.points.map((point) => new THREE.Vector3(...point));
    const cumulativeLengths = [0];
    for (let index = 1; index < vectors.length; index += 1) {
      cumulativeLengths.push(cumulativeLengths[index - 1] + vectors[index - 1].distanceTo(vectors[index]));
    }
    return { vectors, cumulativeLengths, totalLength: cumulativeLengths.at(-1) ?? 0 };
  }, [route]);
  const position = useMemo(() => new THREE.Vector3(), []);
  const lookAhead = useMemo(() => new THREE.Vector3(), []);

  useLayoutEffect(() => {
    visualStates.set(journey.id, humanStateAsVisitState(journey, stateRef.current));
    if (rootRef.current) pointOnPolyline(rootRef.current.position, geometry.vectors, geometry.cumulativeLengths, geometry.totalLength, stateRef.current.progress);
    invalidate();
    return () => { visualStates.delete(journey.id); };
  }, [geometry, invalidate, journey, visualStates]);

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const previous = stateRef.current;
    const next = workspaceSpatialHumanJourneyFrame(previous, {
      deltaSeconds: delta,
      routeLength: geometry.totalLength,
      reduceMotion
    });
    stateRef.current = next;
    visualStates.set(journey.id, humanStateAsVisitState(journey, next));
    if (next.stage !== previous.stage) {
      setVisualState(next);
      onStageChange();
    }
    const returning = next.stage === "returning" || next.stage === "arrived";
    pointOnPolyline(position, geometry.vectors, geometry.cumulativeLengths, geometry.totalLength, next.progress);
    pointOnPolyline(lookAhead, geometry.vectors, geometry.cumulativeLengths, geometry.totalLength,
      returning ? Math.max(0, next.progress - 0.012) : Math.min(1, next.progress + 0.012));
    root.position.copy(position);
    if (lookAhead.distanceToSquared(position) > 0.000001) root.rotation.y = Math.atan2(lookAhead.x - position.x, lookAhead.z - position.z);
    walkingRef.current = Math.abs(next.progress - previous.progress) > 0.000001;
    if (next.stage !== previous.stage || Date.now() - checkpointAtRef.current >= 500 && (walkingRef.current || next.stage === "handoff")) {
      checkpointAtRef.current = Date.now();
      checkpointRef.current(next);
    }
    if (next.stage === "complete" && !completedRef.current) {
      completedRef.current = true;
      onComplete(journey.id);
      return;
    }
    if (walkingRef.current || ["handoff", "returning", "arrived"].includes(next.stage)) invalidate();
  });

  return (
    <group ref={rootRef}>
      <AgentFigure
        agent={agent}
        animated
        peerWorkspace={false}
        position={[0, 0, 0]}
        seated={false}
        motion={motion}
        forcedWalking={walkingRef}
        externalFacing
        selected={false}
        hovered={false}
        human
        exchangeKey={`human:${journey.id}`}
        onHover={() => undefined}
        onSelect={() => undefined}
      />
      <Html position={[0, 2.74, 0]} center zIndexRange={[35, 0]} style={{ pointerEvents: "none" }}>
        <div className={`spatial-human-journey-status stage-${visualState.stage}`} role="status" aria-live="polite">
          <span aria-hidden="true">●</span>
          <strong>{workspaceSpatialHumanJourneyLabel(visualState, journey.targetDisplayName)}</strong>
        </div>
      </Html>
    </group>
  );
}

function BridgeJourneyWalker({
  journey, route, sourceAgent, targetLabel, localVisit = false, visitStates, onCheckpoint,
  actorMode = "clone", actorLabel, selected, onSelect, onHandoffComplete, onRouteSegmentChange, onVisualComplete
}: {
  journey: WorkspaceSpatialVisitFact;
  route: WorkspaceSpatialBridgeTransitRoute;
  sourceAgent: WorkspaceSpatialAgent;
  targetLabel: string;
  localVisit?: boolean;
  actorMode?: "direct" | "clone";
  actorLabel: string;
  visitStates: Map<string, WorkspaceSpatialVisitState>;
  onCheckpoint: () => void;
  selected: boolean;
  onSelect: () => void;
  onHandoffComplete: (journeyId: string) => void;
  onRouteSegmentChange?: (journeyId: string, segment: WorkspaceSpatialBridgeJourneyRouteSegment | null, returning: boolean, motion: VisitMotionProgress) => void;
  onVisualComplete: (journeyId: string) => void;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  const reduceMotion = useReducedSceneMotion();
  const stateRef = useRef(visitStates.get(journey.id) ?? workspaceSpatialVisitInitialState(journey, Date.now()));
  const [visualState, setVisualState] = useState(stateRef.current);
  const choreography = useContext(VisitChoreographyContext);
  const walkingRef = useRef(false);
  const handoffNotifiedRef = useRef(false);
  const completionNotifiedRef = useRef(false);
  const checkpointAtRef = useRef(0);
  const [routeVisual, setRouteVisual] = useState<WorkspaceSpatialBridgeJourneyRouteSegment | null>(null);
  const routeVisualKeyRef = useRef("");
  const handoffRef = useRef(onHandoffComplete);
  const routeSegmentRef = useRef(onRouteSegmentChange);
  const completeRef = useRef(onVisualComplete);
  handoffRef.current = onHandoffComplete;
  routeSegmentRef.current = onRouteSegmentChange;
  completeRef.current = onVisualComplete;
  const routeGeometry = useMemo(() => {
    const routePoints = visitRoutePoints(route, localVisit);
    const vectors = routePoints.map((point) => new THREE.Vector3(...point));
    const cumulativeLengths = [0];
    for (let index = 1; index < vectors.length; index += 1) {
      cumulativeLengths.push(cumulativeLengths[index - 1] + vectors[index - 1].distanceTo(vectors[index]));
    }
    const totalLength = cumulativeLengths.at(-1) ?? 0;
    return {
      vectors, cumulativeLengths, totalLength,
      sourceGatewayProgress: totalLength > 0 ? (cumulativeLengths[route.sourceGatewayIndex] ?? 0) / totalLength : 0,
      targetGatewayProgress: totalLength > 0 ? (cumulativeLengths[route.targetGatewayIndex] ?? totalLength) / totalLength : 1,
      segments: workspaceSpatialBridgeTransitSegments({ ...route, points: routePoints })
    };
  }, [localVisit, route]);
  const position = useMemo(() => new THREE.Vector3(), []);
  const lookAhead = useMemo(() => new THREE.Vector3(), []);
  const projectedAgent = useMemo<WorkspaceSpatialAgent>(() => ({ ...sourceAgent, state: "communicating" }), [sourceAgent]);
  const motion = useMemo<WorkspaceSpatialAgentMotion>(() => ({
    mode: "communicating", seated: false, marker: "none", continuous: true, terminal: null,
    activityId: journey.id, activityStartedAt: journey.createdAt
  }), [journey.createdAt, journey.id]);

  useLayoutEffect(() => {
    // 首帧就应用检查点，刷新后不会先闪到世界原点或重走一遍。
    if (rootRef.current) pointOnPolyline(rootRef.current.position, routeGeometry.vectors, routeGeometry.cumulativeLengths, routeGeometry.totalLength, stateRef.current.progress);
    invalidate();
  }, [invalidate, routeGeometry]);
  useEffect(() => { invalidate(); }, [invalidate, journey.phase, journey.updatedAt, choreography.revision]);
  useEffect(() => () => { routeSegmentRef.current?.(journey.id, null, false, { state: stateRef, start: 0, end: 1 }); }, [journey.id]);

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const previous = stateRef.current;
    const next = workspaceSpatialVisitFrame(previous, journey, {
      nowMs: Date.now(), deltaSeconds: delta, routeLength: routeGeometry.totalLength, reduceMotion,
      exchangeDurationMs: localVisit ? WORKSPACE_SPATIAL_LOCAL_VISIT_HANDOFF_MS : WORKSPACE_SPATIAL_VISIT_HANDOFF_MS,
      canReceive: workspaceSpatialVisitCanReceive(previous, visitStates),
      holdAtHome: Boolean(choreography.exchanges.get(`visit:${journey.id}`)),
      outboundLimit: !localVisit && journey.phase === "dispatching" ? routeGeometry.sourceGatewayProgress : 1
    });
    stateRef.current = next;
    visitStates.set(journey.id, next);
    if (next.stage !== previous.stage || next.outcome !== previous.outcome) {
      setVisualState(next);
      choreography.stageChanged();
    }
    // 到达不是交接完成；必须让双方完整交流后才允许下一级角色出发。
    if ((next.requestExchanged || next.outcome && next.stage !== "handoff" && next.stage !== "outbound") && !handoffNotifiedRef.current) {
      handoffNotifiedRef.current = true;
      handoffRef.current(journey.id);
    }
    const returning = next.stage === "returning" || next.stage === "arrived";
    const arrivalFade = next.stage === "arrived" && (next.stageElapsedMs ?? 0) < 350;
    const segment = arrivalFade ? "source_river" : (next.stage === "outbound" || next.stage === "handoff" || next.stage === "returning")
      ? workspaceSpatialBridgeJourneyRouteSegment({
          progress: next.progress, sourceGatewayProgress: routeGeometry.sourceGatewayProgress,
          targetGatewayProgress: routeGeometry.targetGatewayProgress, courierStage: next.stage
        }) : null;
    const routeKey = `${segment}:${returning}`;
    if (routeVisualKeyRef.current !== routeKey) {
      routeVisualKeyRef.current = routeKey;
      setRouteVisual(segment);
      routeSegmentRef.current?.(journey.id, segment, returning, { state: stateRef, start: routeGeometry.sourceGatewayProgress, end: routeGeometry.targetGatewayProgress });
    }
    pointOnPolyline(position, routeGeometry.vectors, routeGeometry.cumulativeLengths, routeGeometry.totalLength, next.progress);
    pointOnPolyline(lookAhead, routeGeometry.vectors, routeGeometry.cumulativeLengths, routeGeometry.totalLength,
      returning ? Math.max(0, next.progress - 0.012) : Math.min(1, next.progress + 0.012));
    // 等待时面向交流对象，不面向路线终点的空位。
    if (next.progress >= 0.998 && !returning) lookAhead.set(...route.points.at(-1)!);
    root.position.copy(position);
    if (lookAhead.distanceToSquared(position) > 0.000001) root.rotation.y = Math.atan2(lookAhead.x - position.x, lookAhead.z - position.z);
    const moving = Math.abs(next.progress - previous.progress) > 0.000001;
    walkingRef.current = moving;
    const incomingExchange = choreography.exchanges.get(`visit:${journey.id}`);
    if (incomingExchange && !moving) root.rotation.y = incomingExchange.yaw;
    // 仅行走帧和状态变化写检查点，空闲场景无需常驻定时器。
    if (next.stage !== previous.stage || Date.now() - checkpointAtRef.current >= 500 && (moving || ["handoff", "receiving"].includes(next.stage))) {
      checkpointAtRef.current = Date.now();
      onCheckpoint();
    }
    if (next.stage === "complete" && !completionNotifiedRef.current) {
      completionNotifiedRef.current = true;
      completeRef.current(journey.id);
      return;
    }
    // 业务等待由真实更新唤醒；短暂停留和归位自行续帧，不受后端终态窗口裁掉。
    if (moving || ["handoff", "receiving", "returning", "arrived"].includes(next.stage)) invalidate();
  });

  const riverPoints = localVisit && routeVisual ? routeGeometry.vectors.map((point): [number, number, number] => [point.x, point.y, point.z]) : routeVisual === "source_river" ? routeGeometry.segments.sourceRiver
    : routeVisual === "target_river" ? routeGeometry.segments.targetRiver : undefined;
  const handoffPoint = routeGeometry.segments.targetRiver.at(-1);
  const bubbleMode = workspaceSpatialVisitBubbleMode(visualState.stage, localVisit);
  const fullStatusLabel = workspaceSpatialVisitLabel(visualState, targetLabel, journey.phase);
  // 本地 TYR 与目标 Agent 相邻；次级行程条向侧下方错开，给 Agent 的思考/执行气泡保留主位置。
  const bubblePosition: [number, number, number] = localVisit
    ? bubbleMode === "secondary" ? [-0.72, 2.02, 0] : [-0.72, 3.72, 0]
    : [0, bubbleMode === "secondary" ? 2.42 : 2.68, 0];
  return (
    <Fragment>
      {riverPoints && riverPoints.length >= 2 && (
        <PolylinePulse points={riverPoints} signal={{
          id: `${journey.id}:${routeVisual}:${visualState.outcome ?? "request"}`, tone: ["returning", "arrived"].includes(visualState.stage) ? visualState.outcome === "completed" ? "response" : "error" : "request", reverse: ["returning", "arrived"].includes(visualState.stage), continuous: true,
          visitMotion: { state: stateRef, start: localVisit || routeVisual === "source_river" ? 0 : routeGeometry.targetGatewayProgress,
            end: localVisit || routeVisual === "target_river" ? 1 : routeGeometry.sourceGatewayProgress },
          updatedAt: journey.updatedAt, visualLift: selected ? 0.035 : 0.025,
          holdingAtTarget: visualState.stage === "handoff", emphasized: true, followPhysicalRoute: true
        }} offset={0} onSelect={onSelect} />
      )}
      {!localVisit && visualState.stage === "handoff" && handoffPoint && <BridgeTargetHandoffBeacon position={handoffPoint} onSelect={onSelect} />}
      <group ref={rootRef}>
        <AgentFigure agent={projectedAgent} animated peerWorkspace={!sourceAgent.local} position={[0, 0, 0]}
          seated={false} motion={motion} forcedWalking={walkingRef} externalFacing selected={selected} hovered={false} orchestrator clone={actorMode === "clone"}
          exchangeKey={`visit:${journey.id}`}
          onHover={() => undefined} onSelect={onSelect} />
        {bubbleMode !== "hidden" && <Html
          position={bubblePosition}
          center
          zIndexRange={bubbleMode === "primary" ? [34, 0] : [16, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div className={`spatial-bridge-journey-status mode-${bubbleMode} stage-${visualState.stage}`} role="status" aria-live="polite"
            data-visit-id={journey.id} data-visit-stage={visualState.stage}>
            <span className="spatial-bridge-journey-dots" aria-hidden="true"><i /><i /><i /></span>
            {bubbleMode === "secondary" ? (
              <strong>{actorLabel} · {workspaceSpatialVisitSecondaryLabel(visualState, targetLabel, journey.phase, localVisit)}</strong>
            ) : (
              <span className="spatial-bridge-journey-copy">
                <small>{actorLabel}</small>
                <strong>{fullStatusLabel}</strong>
              </span>
            )}
          </div>
        </Html>}
      </group>
    </Fragment>
  );
}

function WorkspaceBridgeVisual({
  layout,
  placed,
  signal,
  lifecycleSignal,
  journey,
  visitStates,
  onCheckpoint,
  selected,
  hovered,
  onHover,
  onSelect,
  onPlaybackComplete,
  onJourneyHandoffComplete,
  onJourneyVisualComplete
}: {
  layout: SceneLayout;
  placed: SceneLayoutBridge;
  signal?: BridgeCommunicationFlowSignal;
  lifecycleSignal?: BridgeCommunicationFlowSignal;
  journey?: TopologyBridgeJourneyRecord;
  visitStates: Map<string, WorkspaceSpatialVisitState>;
  onCheckpoint: () => void;
  selected: boolean;
  hovered: boolean;
  onHover: (key: string | null) => void;
  onSelect: () => void;
  onPlaybackComplete: (playbackKey: string) => void;
  onJourneyHandoffComplete: (journeyId: string) => void;
  onJourneyVisualComplete: (journeyId: string) => void;
}) {
  const journeyOwnsPlayback = Boolean(journey || (placed.bridge.journeys ?? []).length > 0);
  const fallbackSignal = journeyOwnsPlayback ? undefined : signal;
  const [journeyRouteState, setJourneyRouteState] = useState<{
    journeyId: string;
    segment: WorkspaceSpatialBridgeJourneyRouteSegment | null;
    returning: boolean;
    motion: VisitMotionProgress;
  } | null>(null);
  const updateJourneyRouteState = useCallback((
    journeyId: string,
    segment: WorkspaceSpatialBridgeJourneyRouteSegment | null,
    returning: boolean,
    motion: VisitMotionProgress
  ) => {
    setJourneyRouteState((current) => (
      current?.journeyId === journeyId
      && current.segment === segment
      && current.returning === returning
        ? current
        : { journeyId, segment, returning, motion }
    ));
  }, []);
  useEffect(() => {
    if (!journeyOwnsPlayback || !signal) return;
    // 请求和结果均由同一人物行程表达，归位后不得再次补播旧消息河道。
    onPlaybackComplete(bridgeTransitPlaybackKey(signal));
  }, [journeyOwnsPlayback, onPlaybackComplete, signal]);
  const phase = useWorkspaceBridgeTransitPhase(fallbackSignal, onPlaybackComplete);
  const visualRoute = fallbackSignal ? bridgeTransitVisualRoute(layout, placed, fallbackSignal) : null;
  const segments = visualRoute ? workspaceSpatialBridgeTransitSegments(visualRoute.route) : null;
  const journeySignal = journey ? bridgeJourneySignal(layout, journey) : undefined;
  const journeyRoute = journeySignal ? bridgeTransitVisualRoute(layout, placed, journeySignal) : null;
  const journeyAgent = journey ? bridgeJourneySourceAgent(layout, journey) : undefined;
  const journeySourceWorkspace = journey
    ? layout.workspaces.find((workspace) => workspace.workspace.id === journey.sourceWorkspaceId)?.workspace
    : undefined;
  const journeyTargetWorkspace = journey
    ? layout.workspaces.find((workspace) => workspace.workspace.id === journey.targetWorkspaceId)?.workspace
    : undefined;
  const lifecycleRoute = lifecycleSignal ? bridgeTransitVisualRoute(layout, placed, lifecycleSignal) : null;
  const workerFlowVisible = Boolean(lifecycleSignal && layout.workspaces.some((workspace) => (
    workspace.workspace.flows.some((flow) => (
      flow.bridgeRequestMessageId === lifecycleSignal.messageId && flow.continuous
    ))
  )));
  const waitingAtTarget = Boolean(
    !journeyOwnsPlayback
    && !fallbackSignal
    && lifecycleSignal?.tone === "request"
    && lifecycleSignal.continuous
    && !workerFlowVisible
  );
  const handoffPoint = lifecycleRoute?.route.points.at(-1);
  const activeJourneyRouteState = journeyRouteState?.journeyId === journey?.id
    ? journeyRouteState
    : null;
  const activeJourneyBridgeSignal = journeySignal && activeJourneyRouteState?.segment === "bridge"
    ? {
        ...journeySignal,
        visitMotion: activeJourneyRouteState.motion,
        tone: activeJourneyRouteState.returning ? journey?.phase === "failed" || journey?.phase === "cancelled" ? "error" as const : "response" as const : "request" as const,
        continuous: true,
        direction: activeJourneyRouteState.returning ? journeySignal.direction === "outbound" ? "inbound" as const : "outbound" as const : journeySignal.direction
      }
    : undefined;
  const activeBridgeSignal = activeJourneyBridgeSignal
    ? activeJourneyBridgeSignal
    : phase === "bridge" ? fallbackSignal : undefined;
  const riverPoints = phase === "source_river"
    ? segments?.sourceRiver
    : phase === "target_river"
      ? segments?.targetRiver
      : undefined;

  return (
    <Fragment>
      <GlassBridge
        placed={placed}
        signal={activeBridgeSignal}
        selected={selected}
        hovered={hovered}
        onHover={onHover}
        onSelect={onSelect}
      />
      {fallbackSignal && riverPoints && riverPoints.length >= 2 && (
        <PolylinePulse
          key={`${bridgeTransitPlaybackKey(fallbackSignal)}:${phase}`}
          points={riverPoints}
          signal={{
            id: `${fallbackSignal.id}:${phase}`,
            tone: fallbackSignal.tone,
            // 三段互斥：Bridge 阶段不渲染河道，只允许立柱与顶梁接力透光。
            reverse: false,
            continuous: false,
            updatedAt: fallbackSignal.createdAt,
            durationSeconds: WORKSPACE_SPATIAL_BRIDGE_RIVER_TRAVEL_SECONDS,
            visualLift: selected ? 0.035 : 0.025,
            holdingAtTarget: false,
            emphasized: true,
            followPhysicalRoute: true
          }}
          offset={0}
          onSelect={onSelect}
        />
      )}
      {waitingAtTarget && handoffPoint && (
        <BridgeTargetHandoffBeacon position={handoffPoint} onSelect={onSelect} />
      )}
      {journey && journeyRoute && journeyAgent && (
        <BridgeJourneyWalker
          key={journey.id}
          journey={journey}
          visitStates={visitStates}
          onCheckpoint={onCheckpoint}
          targetLabel={journey.targetDisplayName}
          route={journeyRoute.route}
          sourceAgent={journeyAgent}
          actorMode={journey.actorMode}
          actorLabel={workspaceSpatialVisitActorLabel({
            sourceOwnerName: journeySourceWorkspace?.ownerName ?? journeyAgent.displayName,
            targetWorkspaceName: journeyTargetWorkspace?.name ?? placed.bridge.peerWorkspaceName,
            localVisit: false,
            actorMode: journey.actorMode
          })}
          selected={selected}
          onSelect={onSelect}
          onHandoffComplete={onJourneyHandoffComplete}
          onRouteSegmentChange={updateJourneyRouteState}
          onVisualComplete={onJourneyVisualComplete}
        />
      )}
    </Fragment>
  );
}

function ParallelCloneOverflowBadge({ count, placed }: { count: number; placed: SceneLayoutWorkspace }) {
  const origin = workspaceControllerOrigin(placed);
  return (
    <Html
      position={[placed.x + origin.x + 0.72, 3.1, placed.z + origin.z]}
      center
      zIndexRange={[34, 0]}
      style={{ pointerEvents: "none" }}
    >
      <div className="spatial-clone-overflow" role="status" aria-label={`${count} additional active TYR actors`}>
        +{count} active
      </div>
    </Html>
  );
}

function BridgeTargetHandoffBeacon({ position, onSelect }: {
  position: WorkspaceSpatialBridgeTransitPoint;
  onSelect: () => void;
}) {
  const ringRef = useRef<THREE.Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  const reduceMotion = useReducedSceneMotion();

  useEffect(() => {
    invalidate();
  }, [invalidate]);

  useFrame(({ clock }) => {
    if (!ringRef.current || reduceMotion) return;
    const pulse = (Math.sin(clock.elapsedTime * 3.4) + 1) / 2;
    ringRef.current.scale.setScalar(0.88 + pulse * 0.2);
    ringRef.current.rotation.y = clock.elapsedTime * 0.42;
    // 跨域载荷已经抵达但 worker 尚未出现时，由目标 TYR 接力点持续续帧，Bridge 本体保持熄灭。
    invalidate();
  });

  return (
    <group
      position={[position[0], position[1] + 0.035, position[2]]}
      onClick={(event) => stopAndSelect(event, onSelect)}
    >
      <group ref={ringRef}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.34, 0.43, 40]} />
          <meshBasicMaterial color="#42d8ee" transparent opacity={0.68} toneMapped={false} depthWrite={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.5, 0.535, 40]} />
          <meshBasicMaterial color="#a7f5ff" transparent opacity={0.38} toneMapped={false} depthWrite={false} />
        </mesh>
        <mesh position={[0, 0.1, 0]} rotation={[0, Math.PI / 4, 0]}>
          <octahedronGeometry args={[0.105, 0]} />
          <meshBasicMaterial color="#e8fdff" transparent opacity={0.9} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
      <pointLight color="#42d8ee" intensity={0.34} distance={2.1} decay={2} />
    </group>
  );
}

function BridgeTransitColumns({ length, signal }: {
  length: number;
  signal?: VisitBridgeSignal;
}) {
  const materialRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const signalKeyRef = useRef("");
  const elapsedRef = useRef(0);
  const invalidate = useThree((state) => state.invalidate);
  const reduceMotion = useReducedSceneMotion();
  const columnCount = Math.max(7, Math.min(13, Math.round(length / 0.72)));
  const color = signal ? MESSAGE_RIVER_GLOW_COLORS[signal.tone] : "#8edce7";
  const signalKey = signal ? bridgeTransitPlaybackKey(signal) : "";

  useFrame((_, delta) => {
    if (signalKeyRef.current !== signalKey) {
      signalKeyRef.current = signalKey;
      elapsedRef.current = 0;
    } else {
      elapsedRef.current += Math.min(delta, 0.05);
    }
    const durationSeconds = WORKSPACE_SPATIAL_BRIDGE_EFFECT_PHASE_SECONDS / 1.28;
    const rawProgress = elapsedRef.current / durationSeconds;
    const physicalState = signal?.visitMotion?.state.current;
    const physicalProgress = signal?.visitMotion ? THREE.MathUtils.clamp(
      (physicalState!.progress - signal.visitMotion.start) / Math.max(0.0001, signal.visitMotion.end - signal.visitMotion.start), 0, 1
    ) : undefined;
    const finiteEnvelope = physicalState ? 1 : !signal || rawProgress <= 1
      ? 1
      : THREE.MathUtils.clamp((1.28 - rawProgress) / 0.28, 0, 1);
    // 光柱直接跟随人物在桥上的位置；长桥、刷新和后台恢复都不会提前熄灭。
    const forwardHead = physicalProgress !== undefined
      ? physicalState?.stage === "returning" ? 1 - physicalProgress : physicalProgress
      : THREE.MathUtils.clamp(rawProgress, 0, 1);
    const directedHead = signal?.direction === "inbound" ? 1 - forwardHead : forwardHead;

    for (let index = 0; index < columnCount; index += 1) {
      const cellProgress = index / Math.max(1, columnCount - 1);
      const directDistance = Math.abs(cellProgress - directedHead);
      const wave = signal
        ? reduceMotion
          ? 0.28
          : Math.max(0, 1 - directDistance * 3.2)
        : 0;
      const opacity = wave * finiteEnvelope * 0.92;
      for (let part = 0; part < 3; part += 1) {
        const material = materialRefs.current[index * 3 + part];
        if (material) opacity < 0.002 ? material.opacity = 0 : material.opacity = opacity;
      }
    }

    if (signal && !reduceMotion && rawProgress < 1.28) invalidate();
  });

  return (
    <group>
      {Array.from({ length: columnCount }, (_, index) => {
        const x = (index / Math.max(1, columnCount - 1) - 0.5) * Math.max(0.2, length - 0.36);
        return (
          <group key={index} position={[x, 0, 0]}>
            {([-1, 1] as const).map((side, sideIndex) => (
              <mesh key={side} position={[0, 1.02, side * 0.79]}>
                <boxGeometry args={[0.085, 1.9, 0.075]} />
                <meshBasicMaterial
                  ref={(material) => { materialRefs.current[index * 3 + sideIndex] = material; }}
                  color={color}
                  transparent
                  opacity={0}
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
            ))}
            <mesh position={[0, 1.96, 0]}>
              <boxGeometry args={[0.09, 0.08, 1.62]} />
              <meshBasicMaterial
                ref={(material) => { materialRefs.current[index * 3 + 2] = material; }}
                color={color}
                transparent
                opacity={0}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function BridgeGatewayPortal({ positionX, color, active, highlighted }: {
  positionX: number;
  color: string;
  active: boolean;
  highlighted: boolean;
}) {
  const opacity = active ? 0.88 : highlighted ? 0.68 : 0.3;
  return (
    <group position={[positionX, 1.03, 0]} rotation={[0, Math.PI / 2, 0]} scale={[0.96, 1.18, 1]}>
      <mesh raycast={() => undefined}>
        <torusGeometry args={[0.82, 0.055, 12, 64]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={active ? 0.78 : highlighted ? 0.34 : 0.1}
          transparent
          opacity={opacity}
          metalness={0.36}
          roughness={0.24}
        />
      </mesh>
      <mesh raycast={() => undefined}>
        <torusGeometry args={[0.82, 0.15, 10, 64]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={active ? 0.2 : highlighted ? 0.1 : 0.025}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function GlassBridge({ placed, signal, selected, hovered, onHover, onSelect }: {
  placed: SceneLayoutBridge;
  signal?: VisitBridgeSignal;
  selected: boolean;
  hovered: boolean;
  onHover: (key: string | null) => void;
  onSelect: () => void;
}) {
  const officePresentation = useContext(WorkspaceBuildingPresentationContext);
  const connectionArc = useMemo(() => new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-placed.length / 2, 2.8, 0),
    new THREE.Vector3(0, 5.4, 0),
    new THREE.Vector3(placed.length / 2, 2.8, 0)
  ).getPoints(32), [placed.length]);
  const { bridge } = placed;
  const mechanic = workspaceSpatialBridgeMechanic({
    ...bridge,
    flowing: Boolean(signal),
    signals: signal ? [signal] : []
  });
  const bridgeSignal = signal;
  const bridgeNodeState = resolveLivingTopologyNodeState({
    kind: "bridge",
    resourceStatus: bridge.record.status,
    flow: bridgeSignal ? {
      id: bridgeSignal.id,
      role: "relay",
      tone: bridgeSignal.tone,
      continuous: bridgeSignal.continuous,
      activeCount: bridge.signals.length,
      createdAt: bridgeSignal.createdAt
    } : undefined
  });
  const highlighted = selected || hovered;
  const frame = mechanic.active
    ? LIVING_TOPOLOGY_PALETTE[bridgeNodeState.tone].accent
    : selected ? "#0b9f91" : hovered ? "#19bfae" : "#4a9aad";
  const framePositions = [0];
  useCursor(hovered, "pointer", "auto");
  return (
    <group
      position={[placed.x, 0.06, placed.z]}
      rotation={[0, placed.rotationY, 0]}
      onPointerOver={(event) => { event.stopPropagation(); onHover(`bridge:${bridge.id}`); }}
      onPointerOut={(event) => { event.stopPropagation(); onHover(null); }}
      onClick={(event) => stopAndSelect(event, onSelect)}
    >
      <RoundedBox args={[placed.length + 0.24, 0.08, 1.98]} radius={0.13} smoothness={3} position={[0, -0.08, 0]}>
        <meshBasicMaterial
          color={selected ? "#0b9f91" : "#19bfae"}
          transparent
          opacity={selected ? 0.38 : hovered ? 0.28 : mechanic.active ? 0.22 : 0.055}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          depthWrite={false}
        />
      </RoundedBox>
      <RoundedBox args={[placed.length, 0.18, 1.72]} radius={0.1} smoothness={3} position={[0, 0, 0]} receiveShadow>
        <meshStandardMaterial
          color={selected ? "#b4eee8" : hovered ? "#c4f1ed" : "#d2e8e9"}
          emissive={highlighted || mechanic.active ? frame : "#15363d"}
          emissiveIntensity={selected ? 0.28 : hovered ? 0.2 : mechanic.active ? 0.15 : 0.035}
          roughness={0.38}
          metalness={0.12}
        />
      </RoundedBox>
      <mesh position={[0, 1.04, -0.83]}>
        <boxGeometry args={[placed.length, 1.94, 0.055]} />
        <meshPhysicalMaterial color="#a9ebef" transparent opacity={0.3} transmission={0.68} thickness={0.12} roughness={0.08} metalness={0.04} clearcoat={1} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.04, 0.83]}>
        <boxGeometry args={[placed.length, 1.94, 0.055]} />
        <meshPhysicalMaterial color="#a9ebef" transparent opacity={0.24} transmission={0.72} thickness={0.12} roughness={0.08} metalness={0.04} clearcoat={1} depthWrite={false} />
      </mesh>
      <mesh position={[0, 2.02, 0]}>
        <boxGeometry args={[placed.length, 0.055, 1.72]} />
        <meshPhysicalMaterial color="#d6f8fa" transparent opacity={0.24} transmission={0.76} thickness={0.08} roughness={0.06} clearcoat={1} depthWrite={false} />
      </mesh>
      {/* 走廊透光是次级方向反馈；有 Bridge Journey 时，行走 TYR 才是主视觉。 */}
      <BridgeTransitColumns length={placed.length} signal={bridgeSignal} />
      {/* 两端椭圆光环就是圆形 Workspace 与 Bridge 的物理接驳口，取代重复的方形端框。 */}
      {([-1, 1] as const).map((side) => (
        <BridgeGatewayPortal
          key={side}
          positionX={side * placed.length / 2}
          color={frame}
          active={mechanic.active}
          highlighted={highlighted}
        />
      ))}
      {framePositions.map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 1.03, -0.84]}><boxGeometry args={[0.065, 2.04, 0.09]} /><meshStandardMaterial color={frame} emissive={frame} emissiveIntensity={mechanic.active ? 0.32 : 0.03} metalness={0.5} roughness={0.23} /></mesh>
          <mesh position={[0, 1.03, 0.84]}><boxGeometry args={[0.065, 2.04, 0.09]} /><meshStandardMaterial color={frame} emissive={frame} emissiveIntensity={mechanic.active ? 0.32 : 0.03} metalness={0.5} roughness={0.23} /></mesh>
          <mesh position={[0, 2.05, 0]}><boxGeometry args={[0.07, 0.07, 1.75]} /><meshStandardMaterial color={frame} emissive={frame} emissiveIntensity={mechanic.active ? 0.32 : 0.03} metalness={0.5} roughness={0.23} /></mesh>
        </group>
      ))}
      {officePresentation ? <>
        <Line points={connectionArc} color="#fff" lineWidth={6} depthTest={false} transparent opacity={.9} />
        <Line points={connectionArc} color={frame} lineWidth={highlighted ? 3.5 : 2.5} depthTest={false} />
      </> : <>
      {[-0.58, 0.58].map((x) => (
        <mesh key={x} position={[x, 2.17, 0]}><boxGeometry args={[0.055, 0.28, 0.055]} /><meshStandardMaterial color="#7f8582" metalness={0.58} roughness={0.28} /></mesh>
      ))}
      <RoundedBox args={[2.72, 0.78, 0.09]} radius={0.065} smoothness={4} position={[0, 2.48, 0]} castShadow>
        <meshStandardMaterial color={selected ? "#8a6745" : hovered ? "#76563e" : "#5d4332"} metalness={0.08} roughness={0.64} />
      </RoundedBox>
      <RoundedBox args={[2.5, 0.6, 0.055]} radius={0.045} smoothness={3} position={[0, 2.48, 0.065]} castShadow>
        <meshStandardMaterial color={selected ? "#76563c" : hovered ? "#73513a" : "#674934"} metalness={0.015} roughness={0.78} />
      </RoundedBox>
      <SignFace
        text="Workspace Bridge"
        width={2.28}
        height={0.54}
        color={BRIDGE_SIGN_TEXT}
        position={[0, 2.48, 0.108]}
      />
      <SignFace
        text="Workspace Bridge"
        width={2.28}
        height={0.54}
        color={BRIDGE_SIGN_TEXT}
        position={[0, 2.48, -0.108]}
        rotation={[0, Math.PI, 0]}
      />
      </>}

      {!officePresentation && <Html position={placed.labelPosition} center zIndexRange={[16, 0]} style={{ pointerEvents: "none" }}>
        <div className={`spatial-bridge-hover-label${bridgeSignal ? " live" : ""}${hovered ? " hovered" : ""}${selected ? " selected" : ""}`}>
          <span>Workspace Bridge</span>
          <strong>{bridge.peerWorkspaceName}</strong>
          <small>{bridgeSignal ? `${bridgeSignal.direction} live` : bridge.direction === "bidirectional" ? "Two-way link" : "One-way link"}</small>
        </div>
      </Html>}
    </group>
  );
}

function BridgeHandoffSpine({ mechanic, length, startDelaySeconds }: { mechanic: WorkspaceSpatialBridgeMechanic; length: number; startDelaySeconds: number }) {
  const cellRefs = useRef<Array<THREE.Mesh | null>>([]);
  const leftBeaconRef = useRef<THREE.Mesh>(null);
  const rightBeaconRef = useRef<THREE.Mesh>(null);
  const leftBeaconMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const rightBeaconMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const signalIdRef = useRef<string | undefined>(undefined);
  const elapsedRef = useRef(2);
  const invalidate = useThree((state) => state.invalidate);
  const reduceMotion = useReducedSceneMotion();
  const cellCount = 7;
  const cellWidth = Math.max(0.18, (length - 0.92) / cellCount - 0.08);
  const color = mechanic.active ? FLOW_COLORS[mechanic.tone] : "#7caebe";

  useFrame((_, delta) => {
    if (signalIdRef.current !== mechanic.signalId) {
      signalIdRef.current = mechanic.signalId;
      elapsedRef.current = 0;
    } else {
      elapsedRef.current += delta;
    }
    const stageStarted = elapsedRef.current >= startDelaySeconds;
    const stagedMechanic = stageStarted ? mechanic : { ...mechanic, active: false };
    const frame = workspaceSpatialBridgeHandoffFrame(stagedMechanic, Math.max(0, elapsedRef.current - startDelaySeconds), reduceMotion);
    if (mechanic.active && (!stageStarted || !frame.settled) && !reduceMotion) invalidate();
    // handoff cell 只随同一个真实 signal 前进一次；完成后留下接收端静态确认，不按 pending 状态循环。
    cellRefs.current.forEach((cell, index) => {
      if (!cell) return;
      const material = cell.material as THREE.MeshBasicMaterial;
      const cellProgress = index / Math.max(1, cellCount - 1);
      const wave = frame.settled ? 0 : Math.max(0, 1 - Math.abs(cellProgress - frame.directedProgress) * 4.4);
      material.color.set(color);
      material.opacity = stageStarted && mechanic.active ? 0.1 + wave * frame.envelope * 0.78 : 0.045;
      cell.scale.z = stageStarted && mechanic.active && wave > 0 ? 1 + wave * 0.42 : 1;
    });

    const sourceBeacon = mechanic.direction === "outbound" ? leftBeaconMaterialRef.current : rightBeaconMaterialRef.current;
    const targetBeacon = mechanic.direction === "outbound" ? rightBeaconMaterialRef.current : leftBeaconMaterialRef.current;
    for (const material of [leftBeaconMaterialRef.current, rightBeaconMaterialRef.current]) {
      if (material) {
        material.color.set(color);
        material.opacity = stageStarted && mechanic.active ? 0.16 : 0.08;
      }
    }
    if (sourceBeacon) sourceBeacon.opacity = 0.16 + frame.sourceStrength * 0.74;
    if (targetBeacon) targetBeacon.opacity = 0.16 + frame.targetStrength * 0.74;
    const sourceMesh = mechanic.direction === "outbound" ? leftBeaconRef.current : rightBeaconRef.current;
    const targetMesh = mechanic.direction === "outbound" ? rightBeaconRef.current : leftBeaconRef.current;
    if (sourceMesh) sourceMesh.scale.setScalar(0.94 + frame.sourceStrength * 0.14);
    if (targetMesh) targetMesh.scale.setScalar(0.94 + frame.targetStrength * 0.18);
  });

  return (
    <group>
      {Array.from({ length: cellCount }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => { cellRefs.current[index] = mesh; }}
          position={[(index - (cellCount - 1) / 2) * (cellWidth + 0.08), 0.13, 0]}
        >
          <boxGeometry args={[cellWidth, 0.025, 0.28]} />
          <meshBasicMaterial color={color} transparent opacity={mechanic.active ? 0.1 : 0.045} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
      {([-1, 1] as const).map((side) => (
        <group key={side} position={[side * (length / 2 - 0.12), 0, 0.84]}>
          <mesh position={[0, 2.13, 0]}>
            <boxGeometry args={[0.055, 0.28, 0.055]} />
            <meshStandardMaterial color="#657b84" metalness={0.5} roughness={0.3} />
          </mesh>
          <mesh ref={side === -1 ? leftBeaconRef : rightBeaconRef} position={[0, 2.32, 0]} rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[0.2, 0.2, 0.05]} />
            <meshBasicMaterial
              ref={side === -1 ? leftBeaconMaterialRef : rightBeaconMaterialRef}
              color={color}
              transparent
              opacity={mechanic.active ? 0.16 : 0.08}
              toneMapped={false}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function BridgeTransferRelay({ mechanic, startDelaySeconds }: { mechanic: WorkspaceSpatialBridgeMechanic; startDelaySeconds: number }) {
  const relayRef = useRef<THREE.Group>(null);
  const leftLatchRef = useRef<THREE.Mesh>(null);
  const rightLatchRef = useRef<THREE.Mesh>(null);
  const hubRef = useRef<THREE.Mesh>(null);
  const signalIdRef = useRef<string | undefined>(undefined);
  const elapsedRef = useRef(1.2);
  const invalidate = useThree((state) => state.invalidate);
  const reduceMotion = useReducedSceneMotion();
  const color = FLOW_COLORS[mechanic.tone];

  useFrame((_, delta) => {
    if (signalIdRef.current !== mechanic.signalId) {
      signalIdRef.current = mechanic.signalId;
      elapsedRef.current = 0;
    } else {
      elapsedRef.current += delta;
    }
    if (!relayRef.current || !leftLatchRef.current || !rightLatchRef.current || !hubRef.current) return;
    relayRef.current.visible = mechanic.active;
    relayRef.current.rotation.y = mechanic.direction === "inbound" ? Math.PI : 0;
    const stageStarted = elapsedRef.current >= startDelaySeconds;
    const progress = THREE.MathUtils.clamp((elapsedRef.current - startDelaySeconds) / 1.15, 0, 1);
    if (mechanic.active && (!stageStarted || progress < 1) && !reduceMotion) invalidate();
    // 每个真实 Bridge signal 只触发一次开合；active path 留下低亮静态机构，不制造循环传输。
    const envelope = reduceMotion || !stageStarted ? 0 : Math.sin(progress * Math.PI);
    leftLatchRef.current.rotation.z = -0.68 + envelope * 0.34;
    rightLatchRef.current.rotation.z = 0.68 - envelope * 0.34;
    hubRef.current.scale.setScalar(reduceMotion ? 1 : 0.9 + envelope * 0.32);
    const baseOpacity = mechanic.continuous ? 0.28 : 0.2;
    for (const latch of [leftLatchRef.current, rightLatchRef.current]) {
      (latch.material as THREE.MeshBasicMaterial).opacity = reduceMotion ? 0.66 : baseOpacity + envelope * 0.66;
    }
    (hubRef.current.material as THREE.MeshBasicMaterial).opacity = reduceMotion ? 0.7 : baseOpacity + 0.08 + envelope * 0.7;
  });

  return (
    <group ref={relayRef} visible={mechanic.active} position={[0, 0.22, 0]}>
      <mesh ref={leftLatchRef} position={[-0.13, 0, 0]} rotation={[Math.PI / 2, 0, -0.68]}>
        <boxGeometry args={[0.28, 0.075, 0.055]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh ref={rightLatchRef} position={[0.13, 0, 0]} rotation={[Math.PI / 2, 0, 0.68]}>
        <boxGeometry args={[0.28, 0.075, 0.055]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh ref={hubRef} rotation={[Math.PI / 2, 0, 0]}>
        <octahedronGeometry args={[0.085, 0]} />
        <meshBasicMaterial color={color} transparent opacity={0.28} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

function BridgeLane({ length, z, direction, baseColor, signal }: {
  length: number;
  z: number;
  direction: "outbound" | "inbound";
  baseColor: string;
  signal?: BridgeCommunicationFlowSignal;
}) {
  const start: [number, number, number] = [-length / 2 + 0.2, 0.2, z];
  const end: [number, number, number] = [length / 2 - 0.2, 0.2, z];
  const color = signal ? FLOW_COLORS[signal.tone] : baseColor;
  const active = Boolean(signal);
  return (
    <group>
      {/* 通道常亮只承担方向背景；当前 staged packet 才是每一帧唯一的视觉主角。 */}
      <Line points={[start, end]} color={color} lineWidth={active ? 7.2 : 4.6} transparent opacity={active ? 0.13 : 0.075} depthWrite={false} />
      <Line points={[start, end]} color={color} lineWidth={active ? 2.6 : 1.9} transparent opacity={active ? 0.7 : 0.52} depthWrite={false} />
      {active && <Line points={[start, end]} color="#efffff" lineWidth={0.76} transparent opacity={0.42} depthWrite={false} />}
      <BridgeDirectionMarkers length={length} z={z} direction={direction} color={color} active={active} />
      <RouteTerminal position={direction === "inbound" ? start : end} color={color} active={false} />
    </group>
  );
}

function BridgeDirectionMarkers({ length, z, direction, color, active }: {
  length: number;
  z: number;
  direction: "outbound" | "inbound";
  color: string;
  active: boolean;
}) {
  const markerCount = length < 2.2 ? 1 : length < 4.4 ? 2 : 3;
  const usableLength = Math.max(0.7, length - 1.1);
  const directionSign = direction === "outbound" ? 1 : -1;
  return (
    <group>
      {Array.from({ length: markerCount }, (_, index) => {
        const x = markerCount === 1 ? 0 : -usableLength / 2 + index * usableLength / (markerCount - 1);
        return (
          <group key={index} position={[x, 0.252, z]} rotation={[0, directionSign < 0 ? Math.PI : 0, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[active ? 0.235 : 0.165, 3]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={active ? 0.78 : 0.76}
                blending={active ? THREE.AdditiveBlending : THREE.NormalBlending}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
            {active && (
              <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.105, 3]} />
                <meshBasicMaterial color="#f4ffff" transparent opacity={0.7} depthWrite={false} toneMapped={false} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

function pointOnPolyline(target: THREE.Vector3, vectors: THREE.Vector3[], cumulativeLengths: number[], totalLength: number, progress: number) {
  if (vectors.length === 0) return target.set(0, 0, 0);
  if (vectors.length === 1 || totalLength <= 0) return target.copy(vectors[0]);
  const distance = THREE.MathUtils.clamp(progress, 0, 1) * totalLength;
  let segmentIndex = 0;
  while (segmentIndex < cumulativeLengths.length - 1 && distance > cumulativeLengths[segmentIndex + 1]) segmentIndex += 1;
  const segmentStart = cumulativeLengths[segmentIndex];
  const segmentEnd = cumulativeLengths[segmentIndex + 1] ?? totalLength;
  const segmentProgress = segmentEnd > segmentStart ? (distance - segmentStart) / (segmentEnd - segmentStart) : 0;
  return target.copy(vectors[segmentIndex]).lerp(vectors[Math.min(segmentIndex + 1, vectors.length - 1)], segmentProgress);
}

function orthogonalMessageRoute(points: [number, number, number][]): [number, number, number][] {
  if (points.length <= 1) return points;
  const orthogonal: [number, number, number][] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = orthogonal.at(-1) ?? points[index - 1];
    const next = points[index];
    const deltaX = next[0] - previous[0];
    const deltaZ = next[2] - previous[2];
    if (Math.abs(deltaX) > 0.04 && Math.abs(deltaZ) > 0.04) {
      // 消息河道只能沿场景 X/Z 轴铺设；先走较长轴，再以一个直角弯进入下一段，禁止斜线抄近路。
      const elbow: [number, number, number] = Math.abs(deltaX) >= Math.abs(deltaZ)
        ? [next[0], previous[1], previous[2]]
        : [previous[0], previous[1], next[2]];
      appendSceneMessagePoint(orthogonal, elbow);
    }
    appendSceneMessagePoint(orthogonal, next);
  }
  return orthogonal;
}

function smoothMessageRoute(points: [number, number, number][]): [number, number, number][] {
  if (points.length <= 2) return points;
  const vectors = points.map((point) => new THREE.Vector3(...point));
  const rounded: THREE.Vector3[] = [vectors[0].clone()];
  for (let index = 1; index < vectors.length - 1; index += 1) {
    const previous = vectors[index - 1];
    const corner = vectors[index];
    const next = vectors[index + 1];
    const incoming = corner.clone().sub(previous);
    const outgoing = next.clone().sub(corner);
    const incomingLength = incoming.length();
    const outgoingLength = outgoing.length();
    const incomingHorizontalLength = Math.hypot(incoming.x, incoming.z);
    const outgoingHorizontalLength = Math.hypot(outgoing.x, outgoing.z);
    const planarDot = incomingHorizontalLength > 0 && outgoingHorizontalLength > 0
      ? (incoming.x * outgoing.x + incoming.z * outgoing.z) / (incomingHorizontalLength * outgoingHorizontalLength)
      : 1;
    const isPlanarRightAngle = Math.abs(planarDot) < 0.08
      && Math.abs(incoming.y) < 0.04
      && Math.abs(outgoing.y) < 0.04;
    if (incomingLength < 0.08 || outgoingLength < 0.08 || !isPlanarRightAngle) {
      rounded.push(corner.clone());
      continue;
    }
    // 只给真正的地面直角加短圆角；直线和坡道保持物理走向，避免路径被处理成任意曲线。
    const trim = Math.min(0.62, incomingLength * 0.28, outgoingLength * 0.28);
    const entry = corner.clone().addScaledVector(incoming.normalize(), -trim);
    const exit = corner.clone().addScaledVector(outgoing.normalize(), trim);
    rounded.push(entry);
    const fillet = new THREE.QuadraticBezierCurve3(entry, corner, exit);
    for (let sample = 1; sample <= 6; sample += 1) rounded.push(fillet.getPoint(sample / 6));
  }
  rounded.push(vectors.at(-1)?.clone() ?? vectors[0].clone());
  return rounded.map((point) => [point.x, point.y, point.z]);
}

function messageRibbonGeometry(points: [number, number, number][], width: number) {
  const geometry = new THREE.BufferGeometry();
  if (points.length < 2) return geometry;
  const positions = new Float32Array(points.length * 2 * 3);
  const uvs = new Float32Array(points.length * 2 * 2);
  const indices: number[] = [];
  const cumulativeLengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulativeLengths.push(cumulativeLengths[index - 1] + Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
      points[index][2] - points[index - 1][2]
    ));
  }
  const totalLength = cumulativeLengths.at(-1) ?? 1;
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const tangentX = next[0] - previous[0];
    const tangentZ = next[2] - previous[2];
    const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentZ));
    const sideX = -tangentZ / tangentLength;
    const sideZ = tangentX / tangentLength;
    const point = points[index];
    const u = totalLength > 0 ? cumulativeLengths[index] / totalLength : 0;
    // 河道从源端到目标端保持同一物理宽度；端点不再收尖或退化成细线。
    const halfWidth = width / 2;
    const positionOffset = index * 6;
    positions[positionOffset] = point[0] + sideX * halfWidth;
    positions[positionOffset + 1] = point[1];
    positions[positionOffset + 2] = point[2] + sideZ * halfWidth;
    positions[positionOffset + 3] = point[0] - sideX * halfWidth;
    positions[positionOffset + 4] = point[1];
    positions[positionOffset + 5] = point[2] - sideZ * halfWidth;
    const uvOffset = index * 4;
    uvs[uvOffset] = u;
    uvs[uvOffset + 1] = 0;
    uvs[uvOffset + 2] = u;
    uvs[uvOffset + 3] = 1;
    if (index >= points.length - 1) continue;
    const left = index * 2;
    const right = left + 1;
    const nextLeft = left + 2;
    const nextRight = left + 3;
    indices.push(left, right, nextLeft, right, nextRight, nextLeft);
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function messageEnergyBallGeometry(largeCount: number, smallCount: number, emphasized: boolean, compact: boolean) {
  const count = largeCount + smallCount;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const sizes = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    // 双密度能量列与 Topology 保持同一视觉语法；尺寸只表达主次，不再制造横向颗粒噪声。
    const large = index < largeCount;
    const baseSize = large ? (compact ? 7.8 : 8.8) : (compact ? 4.5 : 5.2);
    sizes[index] = baseSize + (emphasized ? 0.8 : 0);
  }
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  return geometry;
}

function PolylinePulse({ points, signal, offset, compact = false, onSelect, onPlaybackComplete }: {
  points: [number, number, number][];
  signal: RoutePulseSignal;
  offset: number;
  compact?: boolean;
  onSelect?: () => void;
  onPlaybackComplete?: () => void;
}) {
  const routeBedMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const routeGlowMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const routeCoreMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const chargePointsRef = useRef<THREE.Points>(null);
  const chargeMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const sourceReceiptRef = useRef<THREE.Mesh>(null);
  const targetReceiptRef = useRef<THREE.Mesh>(null);
  const sourceReceiptMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const targetReceiptMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const signalIdRef = useRef(signal.id);
  const signalToneRef = useRef(signal.tone);
  const playbackCompleteRef = useRef(onPlaybackComplete);
  const completedPlaybackKeyRef = useRef("");
  const phaseContinuationRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  const reduceMotion = useReducedSceneMotion();
  playbackCompleteRef.current = onPlaybackComplete;
  const riverColor = MESSAGE_RIVER_COLORS[signal.tone];
  const riverCenterColor = MESSAGE_RIVER_CENTER_COLORS[signal.tone];
  const glowColor = MESSAGE_RIVER_GLOW_COLORS[signal.tone];
  const bedColor = MESSAGE_RIVER_BED_COLORS[signal.tone];
  const receiptColor = MESSAGE_RECEIPT_COLORS[signal.tone];
  const orthogonalPoints = useMemo(
    () => signal.followPhysicalRoute ? points : orthogonalMessageRoute(points),
    [points, signal.followPhysicalRoute]
  );
  const smoothedPoints = useMemo(() => smoothMessageRoute(orthogonalPoints), [orthogonalPoints]);
  const surfacePoints = useMemo<[number, number, number][]>(() => smoothedPoints.map((point) => (
    [point[0], point[1] + (signal.visualLift ?? 0.035), point[2]]
  )), [signal.visualLift, smoothedPoints]);
  const routeStartPoint = surfacePoints[0] ?? [0, 0, 0];
  const routeEndPoint = surfacePoints.at(-1) ?? routeStartPoint;
  const route = useMemo(() => {
    const vectors = surfacePoints.map((point) => new THREE.Vector3(...point));
    const cumulativeLengths = [0];
    for (let index = 1; index < vectors.length; index += 1) {
      cumulativeLengths.push(cumulativeLengths[index - 1] + vectors[index - 1].distanceTo(vectors[index]));
    }
    return { vectors, cumulativeLengths, totalLength: cumulativeLengths.at(-1) ?? 0 };
  }, [surfacePoints]);
  // Topology 的质感来自完整河体而非两侧描边；3D 版恢复中等宽度，由外部柔光和能量点建立层次。
  const ribbonWidth = signal.emphasized ? compact ? 0.36 : 0.48 : compact ? 0.31 : 0.41;
  const routeBedGeometry = useMemo(
    () => messageRibbonGeometry(surfacePoints, ribbonWidth * 1.04),
    [ribbonWidth, surfacePoints]
  );
  const routeGlowGeometry = useMemo(
    () => messageRibbonGeometry(surfacePoints, ribbonWidth * 1.65),
    [ribbonWidth, surfacePoints]
  );
  const routeCoreGeometry = useMemo(
    () => messageRibbonGeometry(surfacePoints, ribbonWidth),
    [ribbonWidth, surfacePoints]
  );
  const largeEnergyBallCount = THREE.MathUtils.clamp(Math.round(route.totalLength / 1.35), 4, 7);
  const smallEnergyBallCount = THREE.MathUtils.clamp(Math.round(route.totalLength / 0.78), 7, 12);
  const energyBallCount = largeEnergyBallCount + smallEnergyBallCount;
  const energyBallGeometry = useMemo(
    () => messageEnergyBallGeometry(largeEnergyBallCount, smallEnergyBallCount, Boolean(signal.emphasized), compact),
    [compact, largeEnergyBallCount, signal.emphasized, smallEnergyBallCount]
  );
  const pixelRatio = useThree((state) => Math.min(2, state.gl.getPixelRatio()));
  const routeBedUniforms = useMemo(() => ({
    uColor: { value: new THREE.Color(bedColor) },
    uCenterColor: { value: new THREE.Color(bedColor) },
    uOpacity: { value: 0 },
    uSoftness: { value: 0.82 }
  }), [bedColor]);
  const routeGlowUniforms = useMemo(() => ({
    uColor: { value: new THREE.Color(glowColor) },
    uCenterColor: { value: new THREE.Color(glowColor) },
    uOpacity: { value: 0 },
    uSoftness: { value: 0.84 }
  }), [glowColor]);
  const routeCoreUniforms = useMemo(() => ({
    uColor: { value: new THREE.Color(riverColor) },
    uCenterColor: { value: new THREE.Color(riverCenterColor) },
    uOpacity: { value: 0 },
    uSoftness: { value: 0.42 }
  }), [riverCenterColor, riverColor]);
  const chargeUniforms = useMemo(() => ({
    uCoreColor: { value: new THREE.Color("#ffffff") },
    uHaloColor: { value: new THREE.Color(glowColor) },
    uOpacity: { value: 0 },
    uPixelRatio: { value: pixelRatio }
  }), [glowColor, pixelRatio]);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    if (signal.continuous || !onPlaybackComplete) return;
    const duration = signal.durationSeconds ?? (signal.chainId
      ? compact
        ? WORKSPACE_SPATIAL_CHAIN_COMPACT_PACKET_DURATION_SECONDS
        : WORKSPACE_SPATIAL_CHAIN_PACKET_DURATION_SECONDS
      : 1.7);
    // 与 useFrame 的 receiptSettlesAt=1.12 使用同一边界；回调只在河体和抵达光环真正淡出后发出。
    const completesAfterMs = Math.max(
      0,
      (offset + (signal.delaySeconds ?? 0) + duration * 1.12) * 1_000
    );
    const playbackKey = `${signal.id}:${signal.tone}`;
    const timer = window.setTimeout(() => {
      if (completedPlaybackKeyRef.current === playbackKey) return;
      completedPlaybackKeyRef.current = playbackKey;
      invalidate();
      playbackCompleteRef.current?.();
    }, completesAfterMs + 32);
    return () => window.clearTimeout(timer);
  }, [compact, invalidate, offset, signal.chainId, signal.continuous, signal.delaySeconds, signal.durationSeconds, signal.id, signal.tone]);

  useFrame(({ clock }) => {
    if (
      !routeBedMaterialRef.current
      || !routeGlowMaterialRef.current
      || !routeCoreMaterialRef.current
      || !chargePointsRef.current
      || !chargeMaterialRef.current
      || !sourceReceiptRef.current
      || !targetReceiptRef.current
      || !sourceReceiptMaterialRef.current
      || !targetReceiptMaterialRef.current
    ) return;
    if (signalIdRef.current !== signal.id) {
      // 同一路径收到新的权威消息时，从源端重新蓄亮；旧消息绝不续播或循环。
      signalIdRef.current = signal.id;
      signalToneRef.current = signal.tone;
      phaseContinuationRef.current = false;
      startedAtRef.current = clock.elapsedTime;
    } else if (signalToneRef.current !== signal.tone) {
      // request -> response 只切换行进方向，物理通道保持点亮，避免中间卸载造成视觉断帧。
      signalToneRef.current = signal.tone;
      phaseContinuationRef.current = true;
      startedAtRef.current = clock.elapsedTime;
    }
    if (startedAtRef.current === null) startedAtRef.current = clock.elapsedTime;
    const elapsed = Math.max(0, clock.elapsedTime - startedAtRef.current);
    // Chain baton 使用短促的单次交接；跨 Workspace journey 可覆盖更长全链路，continuous 仍不代表循环播放。
    const duration = signal.durationSeconds ?? (signal.chainId
      ? compact
        ? WORKSPACE_SPATIAL_CHAIN_COMPACT_PACKET_DURATION_SECONDS
        : WORKSPACE_SPATIAL_CHAIN_PACKET_DURATION_SECONDS
      : signal.continuous ? 2.1 : 1.7);
    const rawProgress = (elapsed - offset - (signal.delaySeconds ?? 0)) / duration;
    const lineFadeStartsAt = 0.86;
    const receiptSettlesAt = 1.12;
    const playbackKey = `${signal.id}:${signal.tone}`;
    if (
      !signal.continuous
      && rawProgress >= receiptSettlesAt
      && completedPlaybackKeyRef.current !== playbackKey
    ) {
      completedPlaybackKeyRef.current = playbackKey;
      playbackCompleteRef.current?.();
    }
    if (!reduceMotion && (signal.continuous || rawProgress <= receiptSettlesAt)) invalidate();
    const lineArrivalFade = signal.continuous
      ? 1
      : rawProgress <= lineFadeStartsAt
        ? 1
        : THREE.MathUtils.clamp((receiptSettlesAt - rawProgress) / (receiptSettlesAt - lineFadeStartsAt), 0, 1);
    const continuesFromPreviousPhase = phaseContinuationRef.current;
    let lineStrength = rawProgress < -0.06
      ? 0
      : rawProgress < 0.1
        ? continuesFromPreviousPhase ? 1 : THREE.MathUtils.smoothstep(rawProgress, -0.06, 0.1)
        : reduceMotion
          ? 0.74
          : rawProgress <= 1
            ? 1
            : signal.continuous
              ? 1
              : lineArrivalFade;
    const physicalState = signal.visitMotion?.state.current;
    const physicalProgress = signal.visitMotion ? THREE.MathUtils.clamp(
      (physicalState!.progress - signal.visitMotion.start) / Math.max(0.0001, signal.visitMotion.end - signal.visitMotion.start), 0, 1
    ) : undefined;
    if (physicalState) lineStrength = physicalState.stage === "arrived" ? Math.max(0, 1 - (physicalState.stageElapsedMs ?? 0) / 350) : 1;
    const waitingAtTarget = Boolean(signal.holdingAtTarget && rawProgress > 0.86);
    const sharedLaneMultiplier = 1 / Math.sqrt(signal.sharedLaneCount ?? 1);
    routeBedMaterialRef.current.uniforms.uOpacity.value = lineStrength
      * (waitingAtTarget ? 0.045 : signal.emphasized ? 0.07 : 0.055)
      * sharedLaneMultiplier;
    routeGlowMaterialRef.current.uniforms.uOpacity.value = lineStrength
      * (waitingAtTarget ? 0.16 : signal.emphasized ? 0.24 : 0.2)
      * sharedLaneMultiplier;
    routeCoreMaterialRef.current.uniforms.uOpacity.value = lineStrength
      * (waitingAtTarget ? 0.62 : signal.emphasized ? 0.82 : 0.76);
    // 所有消息阶段都让大小能量球均匀覆盖整条通道；方向来自整体平移，不再依赖头部箭头或局部尾迹。
    const chargeStrength = reduceMotion
      ? lineStrength * 0.58
      : lineStrength * (continuesFromPreviousPhase ? 1 : THREE.MathUtils.smoothstep(rawProgress, 0.01, 0.14));
    const visibleChargeStrength = reduceMotion ? 0 : chargeStrength * (waitingAtTarget ? 0.7 : 0.96);
    chargeMaterialRef.current.uniforms.uOpacity.value = visibleChargeStrength;
    chargePointsRef.current.visible = visibleChargeStrength > 0.001;
    const activeElapsed = Math.max(0, elapsed - offset - (signal.delaySeconds ?? 0));
    // Spatial 路径长度差异远大于 Topology 边；按世界单位恒速，避免所有长河都在 1.35 秒内跑完一圈。
    const travel = physicalProgress !== undefined ? signal.reverse ? 1 - physicalProgress : physicalProgress : reduceMotion || route.totalLength <= 0
      ? 0.18
      : activeElapsed * MESSAGE_RIVER_WORLD_SPEED / route.totalLength;
    const positionAttribute = energyBallGeometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index < energyBallCount; index += 1) {
      const large = index < largeEnergyBallCount;
      const laneIndex = large ? index : index - largeEnergyBallCount;
      const laneCount = large ? largeEnergyBallCount : smallEnergyBallCount;
      const lanePhase = large ? 0 : 0.42 / laneCount;
      const forwardProgress = reduceMotion
        ? (laneIndex + 0.5) / laneCount
        : (laneIndex / laneCount + lanePhase + travel + (signal.energyPhaseOffset ?? 0)) % 1;
      // 几何始终保持 canonical 顺序；响应仅让同一批能量球沿原河道反向运动。
      const progress = signal.reverse ? (1 - forwardProgress + 1) % 1 : forwardProgress;
      pointOnPolyline(scratch, route.vectors, route.cumulativeLengths, route.totalLength, progress);
      scratch.y += 0.012;
      positionAttribute.setXYZ(index, scratch.x, scratch.y, scratch.z);
    }
    if (continuesFromPreviousPhase && rawProgress >= 0.14) phaseContinuationRef.current = false;
    positionAttribute.needsUpdate = true;
    const sourceStrength = reduceMotion || rawProgress < -0.16 || rawProgress > 0.18
      ? 0
      : rawProgress < 0
        ? 1 - Math.abs(rawProgress) / 0.16
        : 1 - rawProgress / 0.18;
    const receiptProgress = THREE.MathUtils.clamp((rawProgress - 0.82) / (receiptSettlesAt - 0.82), 0, 1);
    const targetStrength = reduceMotion
      ? (signal.tone === "response" || signal.tone === "error" ? 0.62 : 0)
      : rawProgress < 0.82 || rawProgress > receiptSettlesAt
        ? 0
        : Math.sin(receiptProgress * Math.PI);

    // 源端只做一次蓄亮，目标端只做一次双环确认，让发送、移动、抵达三个阶段可被直接辨认。
    sourceReceiptRef.current.scale.setScalar(0.72 + sourceStrength * 1.08);
    targetReceiptRef.current.scale.setScalar(0.76 + targetStrength * 1.38);
    sourceReceiptMaterialRef.current.opacity = physicalState ? 0 : sourceStrength * 0.82;
    const liveReceiptStrength = signal.continuous && rawProgress > 0.9
      ? 0.14 + (Math.sin(elapsed * 4.6) + 1) * 0.06
      : 0;
    targetReceiptMaterialRef.current.opacity = physicalState ? 0 : Math.max(targetStrength * 0.94, liveReceiptStrength);
  });

  return (
    <group onClick={onSelect ? (event) => stopAndSelect(event, onSelect) : undefined}>
      {/* 河体保持完整填充，弱接触层与宽柔光负责空间融合，双能量列负责 Topology 式流动质感。 */}
      <mesh geometry={routeBedGeometry} renderOrder={37} frustumCulled={false}>
        <shaderMaterial
          ref={routeBedMaterialRef}
          uniforms={routeBedUniforms}
          vertexShader={MESSAGE_RIBBON_VERTEX_SHADER}
          fragmentShader={MESSAGE_RIBBON_FRAGMENT_SHADER}
          side={THREE.DoubleSide}
          transparent
          depthTest
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={routeGlowGeometry} renderOrder={38} frustumCulled={false}>
        <shaderMaterial
          ref={routeGlowMaterialRef}
          uniforms={routeGlowUniforms}
          vertexShader={MESSAGE_RIBBON_VERTEX_SHADER}
          fragmentShader={MESSAGE_RIBBON_FRAGMENT_SHADER}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          transparent
          depthTest
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={routeCoreGeometry} renderOrder={39} frustumCulled={false}>
        <shaderMaterial
          ref={routeCoreMaterialRef}
          uniforms={routeCoreUniforms}
          vertexShader={MESSAGE_RIBBON_VERTEX_SHADER}
          fragmentShader={MESSAGE_RIBBON_FRAGMENT_SHADER}
          side={THREE.DoubleSide}
          transparent
          depthTest
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-3}
          toneMapped={false}
        />
      </mesh>
      <points ref={chargePointsRef} geometry={energyBallGeometry} renderOrder={40} frustumCulled={false}>
        <shaderMaterial
          ref={chargeMaterialRef}
          uniforms={chargeUniforms}
          vertexShader={MESSAGE_CHARGE_VERTEX_SHADER}
          fragmentShader={MESSAGE_CHARGE_FRAGMENT_SHADER}
          transparent
          blending={THREE.AdditiveBlending}
          depthTest
          depthWrite={false}
          toneMapped={false}
        />
      </points>
      <mesh
        ref={sourceReceiptRef}
        position={signal.reverse ? routeEndPoint : routeStartPoint}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={41}
      >
        <ringGeometry args={signal.emphasized ? [0.115, 0.175, 32] : [0.09, 0.14, 28]} />
        <meshBasicMaterial
          ref={sourceReceiptMaterialRef}
          color={riverColor}
          transparent
          opacity={0}
          depthTest
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-3}
          toneMapped={false}
        />
      </mesh>
      <mesh
        ref={targetReceiptRef}
        position={signal.reverse ? routeStartPoint : routeEndPoint}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={41}
      >
        <ringGeometry args={signal.emphasized ? [0.14, 0.22, 32] : [0.105, 0.165, 28]} />
        <meshBasicMaterial
          ref={targetReceiptMaterialRef}
          color={receiptColor}
          transparent
          opacity={0}
          depthTest
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-3}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
