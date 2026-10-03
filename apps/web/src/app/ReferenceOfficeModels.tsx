import { useLayoutEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  architecturalPlant,
  deskDetails,
  executiveChair,
  officeReadingNook,
  officeShell,
  officeWorktop,
} from "../map/agentcity-office/officeCraft";
import {
  officeKeyboard,
  officeMouse,
} from "../map/agentcity-office/officeDeskAccessories";
import { officeGlass } from "../map/agentcity-office/officeGlazing";
import { officeRug } from "../map/agentcity-office/officeSurfaces";
import { officeLoungeSeat } from "../map/agentcity-office/officeUpholstery";
import { officeMonitor } from "../map/agentcity-office/officeMonitor";
import { OfficeWindowEnvironment } from "../map/agentcity-office/officeEnvironment";
import {
  createTownArchitecture,
  type TownBuilding,
} from "../map/townArchitecture";
import { applyOfficeFloorFinish } from "../map/agentcity-office/officeFloorFinish";

// Each mount owns its reference resources, including React StrictMode remounts.
function disposeModel(root: THREE.Object3D) {
  const resources = new Set<{ dispose(): void }>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      resources.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) resources.add(value);
    }
  });
  resources.forEach((resource) => resource.dispose());
}
function clearGlazingHitTargets(root: THREE.Object3D) {
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      !Array.isArray(object.material) &&
      object.material.name === "clear-office-glazing"
    ) {
      object.castShadow = false;
      object.raycast = () => undefined;
    }
  });
}
function box(
  root: THREE.Object3D,
  size: [number, number, number],
  at: [number, number, number],
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...at);
  mesh.castShadow = mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

export function ReferenceOfficeLighting() {
  const { gl, scene, invalidate } = useThree();
  useLayoutEffect(() => {
    const source = new OfficeWindowEnvironment();
    const generator = new THREE.PMREMGenerator(gl);
    const target = generator.fromScene(source, 0.03, 0.1, 100, {
      position: new THREE.Vector3(0, 1.6, 0),
    });
    const previous = scene.environment,
      intensity = scene.environmentIntensity;
    scene.environment = target.texture;
    scene.environmentIntensity = 0.85;
    source.dispose();
    generator.dispose();
    invalidate();
    return () => {
      scene.environment = previous;
      scene.environmentIntensity = intensity;
      target.dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
}

/** Low-rise town context, without inventing neighboring Workspace identities. */
export function ReferenceTownContext({
  sites,
}: {
  sites: { x: number; z: number; radius: number }[];
}) {
  const host = useRef<THREE.Group>(null);
  const { invalidate } = useThree();
  // Polls can replace scene objects without changing the physical layout.
  const footprint = JSON.stringify(
    sites.map(({ x, z, radius }) => ({ x, z, radius })),
  );
  useLayoutEffect(() => {
    const places = JSON.parse(footprint) as {
      x: number;
      z: number;
      radius: number;
    }[];
    if (!places.length) return;
    const root = new THREE.Group();
    const bounds = {
      left: Math.min(...places.map((p) => p.x - p.radius - 0.5)),
      right: Math.max(...places.map((p) => p.x + p.radius + 0.5)),
      back: Math.min(...places.map((p) => p.z - p.radius - 0.5)),
      front: Math.max(...places.map((p) => p.z + p.radius + 0.5)),
    };
    const cx = (bounds.left + bounds.right) / 2,
      cz = (bounds.back + bounds.front) / 2;
    const width = bounds.right - bounds.left,
      depth = bounds.front - bounds.back;
    const material = (color: string) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    const lawn = material("#d8e2d0"),
      paving = material("#e9e7de"),
      road = material("#c7d0cf"),
      stone = material("#d6dcd8");
    box(root, [width + 240, 0.12, depth + 240], [cx, -2.28, cz], lawn);

    // Streets frame the floor; the near corner stays open to the camera.
    for (const z of [bounds.back - 7.5, bounds.front + 7.5])
      box(root, [width + 65, 0.04, 4.5], [cx, -2.16, z], road);
    for (const x of [bounds.left - 7.5, bounds.right + 7.5])
      box(root, [4.5, 0.04, depth + 65], [x, -2.15, cz], road);
    for (const place of places) {
      const w = place.radius * 2 + 1;
      // Individual entrance aprons leave open lawn between connected Workspaces.
      box(root, [w + 3, 0.08, w + 3], [place.x, -2.18, place.z], paving);
      box(root, [w, 1.92, w], [place.x, -1.18, place.z], stone);
      box(root, [w + 0.24, 0.16, w + 0.24], [place.x, -0.26, place.z], paving);
      for (let i = -2; i <= 2; i++) {
        box(
          root,
          [1.45, 0.95, 0.05],
          [place.x + (i * w) / 6, -1.25, place.z + w / 2 + 0.025],
          material("#8b9c9c"),
        );
      }
    }
    // Six scattered neighbors replace the continuous double rows of housing.
    // Their placement follows the outer streets and leaves the near corner open.
    // Keep a few neighboring facades in the single-room frame as well.
    const singleRoomInset = places.length === 1 ? 7 : 0;
    const neighbors = [
      { x: cx - width * 0.36, z: bounds.back - 21 + singleRoomInset, rotation: 0, palette: 1 },
      { x: cx + width * 0.28, z: bounds.back - 29 + singleRoomInset, rotation: 0, palette: 2 },
      {
        x: bounds.right + 20 - singleRoomInset,
        z: bounds.back - 19 + singleRoomInset,
        rotation: -Math.PI / 2,
        palette: 3,
      },
      {
        x: bounds.left - 22 + singleRoomInset,
        z: cz - depth * 0.28,
        rotation: Math.PI / 2,
        palette: 4,
      },
      {
        x: bounds.left - 29 + singleRoomInset,
        z: bounds.front - 3,
        rotation: Math.PI / 2,
        palette: 2,
      },
      {
        x: bounds.right + 25 - singleRoomInset,
        z: cz + depth * 0.15,
        rotation: -Math.PI / 2,
        palette: 1,
      },
    ];
    const buildings: TownBuilding[] = neighbors.map((neighbor, i) => ({
      ...neighbor,
      id: `scenery-${i}`,
      width: 4.4 + (i % 3) * 0.35,
      depth: 4.2,
      height: 2.1 + (i % 2) * 0.4,
      roofHeight: 0.85,
      style: i === 0 ? "shop" : "house",
      ground: -2.12,
    }));
    const town = createTownArchitecture(buildings);
    root.add(town.group);
    const trunk = material("#8d8270"),
      foliage = material("#a4b595");
    const treeGroups = [
      [bounds.left - 16, bounds.back - 15],
      [cx + width * 0.13, bounds.back - 19],
      [bounds.left - 18, bounds.front - 10],
      [bounds.right + 19, cz + depth * 0.15 + 8],
    ];
    for (const [x, z] of treeGroups) {
      for (const [dx, dz, radius] of [
        [0, 0, 1.1],
        [2.4, 1.9, 0.85],
        [-1.2, 3.4, 0.95],
      ]) {
        box(root, [0.16, 1.2, 0.16], [x + dx, -1.55, z + dz], trunk);
        const crown = new THREE.Mesh(
          new THREE.IcosahedronGeometry(radius, 1),
          foliage,
        );
        crown.position.set(x + dx, -0.55, z + dz);
        crown.castShadow = true;
        root.add(crown);
      }
    }
    // Scenery must never intercept Agent, Device or Bridge hit targets.
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.raycast = () => undefined;
    });
    const mounted = host.current!;
    mounted.add(root);
    invalidate();
    return () => {
      mounted.remove(root);
      disposeModel(root);
    };
  }, [footprint, invalidate]);
  return <group ref={host} />;
}

export function ReferenceOfficeShell({ radius }: { radius: number }) {
  const host = useRef<THREE.Group>(null);
  const { invalidate } = useThree();
  useLayoutEffect(() => {
    const root = new THREE.Scene();
    const width = radius * 2 + 1;
    officeShell(root, {
      standardFurnishing: false,
      outlook: false,
      entrance: false,
    });
    root.scale.set(width / 23.5, 0.84, width / 16.3);
    clearGlazingHitTargets(root);
    const furnishing = new THREE.Group();
    const sofa = officeLoungeSeat(2.5);
    sofa.position.set(-width / 2 + 0.9, 0, 0.8);
    sofa.rotation.y = Math.PI / 2;
    furnishing.add(sofa);
    for (const side of [-1, 1]) {
      architecturalPlant(
        furnishing,
        side * (width / 2 - 0.85),
        -width / 2 + 1,
        1.15,
      );
      architecturalPlant(
        furnishing,
        side * (width / 2 - 0.85),
        width / 2 - 1.1,
        0.95,
      );
    }
    const nook = new THREE.Group();
    officeReadingNook(nook);
    // Keep the reference furniture at human scale, against the right facade.
    nook.position.set(width / 2 - 11.45, 0, 0);
    furnishing.add(nook);
    host.current!.add(root, furnishing);
    let disposed = false;
    const loaded: THREE.Texture[] = [];
    const base = `${import.meta.env.BASE_URL}maps/marlow-green/office/`;
    const files = ["oak-wood-planks/oak_wood_planks", "marble-01/marble_01"];
    const loader = new THREE.TextureLoader();
    Promise.all(
      files.flatMap((prefix) =>
        ["diff", "nor_gl", "rough"].map(async (channel, index) => {
          const texture = await loader.loadAsync(
            `${base}${prefix}_${channel}_1k.jpg`,
          );
          if (disposed) {
            texture.dispose();
            return texture;
          }
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(width / 1.2, width / 1.2);
          texture.anisotropy = 8;
          if (index === 0) texture.colorSpace = THREE.SRGBColorSpace;
          loaded.push(texture);
          return texture;
        }),
      ),
    )
      .then((textures) => {
        if (disposed) return;
        const floor = root.getObjectByName("office-floor") as THREE.Mesh<
          THREE.PlaneGeometry,
          THREE.MeshPhysicalMaterial
        >;
        const material = floor.material;
        material.map?.dispose();
        material.bumpMap?.dispose();
        [material.map, material.normalMap, material.roughnessMap] = textures;
        material.bumpMap = null;
        material.normalScale.set(0.2, 0.2);
        material.roughness = 0.62;
        material.clearcoat = 0.22;
        material.clearcoatRoughness = 0.3;
        applyOfficeFloorFinish(material, [
          textures[3],
          textures[4],
          textures[5],
        ]);
        material.needsUpdate = true;
        invalidate();
      })
      .catch(() => {
        /* Procedural reference oak remains visible offline. */
      });
    invalidate();
    const mounted = host.current!;
    return () => {
      disposed = true;
      mounted.remove(root, furnishing);
      disposeModel(root);
      disposeModel(furnishing);
      loaded.forEach((texture) => texture.dispose());
    };
  }, [radius, invalidate]);
  return <group ref={host} />;
}

export function ReferenceDeviceRoom({
  width,
  depth,
  accent,
  highlighted,
}: {
  width: number;
  depth: number;
  accent: string;
  highlighted: boolean;
}) {
  const host = useRef<THREE.Group>(null);
  const { invalidate } = useThree();
  useLayoutEffect(() => {
    const root = new THREE.Group();
    const trim = new THREE.MeshStandardMaterial({
      color: "#7d8f9d",
      metalness: 0.7,
      roughness: 0.3,
    });
    const panel = new THREE.MeshStandardMaterial({
      color: "#c7d5df",
      roughness: 0.65,
    });
    const glass = officeGlass();
    const rug = officeRug(width - 0.16, depth - 0.16);
    rug.position.y = 0.075;
    root.add(rug);
    box(root, [width, 0.55, 0.11], [0, 0.37, -depth / 2], panel);
    const rearGlass = box(
      root,
      [width, 2.05, 0.028],
      [0, 1.68, -depth / 2],
      glass,
    );
    rearGlass.castShadow = false;
    const sideGlass = box(
      root,
      [0.028, 2.55, depth],
      [-width / 2, 1.4, 0],
      glass,
    );
    sideGlass.castShadow = false;
    for (const x of [-width / 2, 0, width / 2])
      box(root, [0.035, 2.7, 0.045], [x, 1.4, -depth / 2], trim);
    for (const z of [-depth / 2, depth / 2])
      box(root, [0.045, 2.7, 0.045], [-width / 2, 1.4, z], trim);
    box(root, [width, 0.055, 0.07], [0, 2.76, -depth / 2], trim);
    box(root, [0.07, 0.055, depth], [-width / 2, 2.76, 0], trim);
    // Quiet blue acoustic slats, clear sightlines into each Device room.
    for (let i = 0; i < 24; i++)
      box(
        root,
        [0.028, 0.51, 0.04],
        [
          -width / 2 + 0.12 + (i * (width - 0.24)) / 23,
          0.37,
          -depth / 2 + 0.075,
        ],
        trim,
      );
    architecturalPlant(root, width / 2 - 0.38, -depth / 2 + 0.35, 0.42);
    clearGlazingHitTargets(root);
    host.current!.add(root);
    invalidate();
    const mounted = host.current!;
    return () => {
      mounted.remove(root);
      disposeModel(root);
    };
  }, [width, depth, invalidate]);
  return (
    <group>
      <group ref={host} />
      {highlighted && (
        <mesh position={[0, 0.09, depth / 2]}>
          <boxGeometry args={[width, 0.025, 0.035]} />
          <meshBasicMaterial color={accent} />
        </mesh>
      )}
    </group>
  );
}

export function ReferenceWorkDesk({
  position,
  rotation,
  screenMaterialRef,
}: {
  position: [number, number, number];
  rotation: number;
  screenMaterialRef: { current: THREE.MeshStandardMaterial | null };
}) {
  const host = useRef<THREE.Group>(null);
  const { invalidate } = useThree();
  useLayoutEffect(() => {
    const root = new THREE.Group();
    officeWorktop(root, 2.4, 0.91, [0, 0.75, 0]);
    deskDetails(root, 0, -1);
    const screen = new THREE.MeshStandardMaterial({
      color: "#4d6777",
      emissive: "#2e7d83",
      emissiveIntensity: 0.15,
      roughness: 0.38,
    });
    screenMaterialRef.current = screen;
    officeMonitor(root, { z: -0.18, screen });
    const keyboard = officeKeyboard();
    keyboard.position.set(-0.08, 0.812, 0.25);
    root.add(keyboard);
    const mouse = officeMouse();
    mouse.position.set(0.45, 0.812, 0.27);
    root.add(mouse);
    executiveChair(root, 0, 0.9, Math.PI);
    clearGlazingHitTargets(root);
    host.current!.add(root);
    invalidate();
    const mounted = host.current!;
    return () => {
      mounted.remove(root);
      screenMaterialRef.current = null;
      disposeModel(root);
    };
  }, [invalidate, screenMaterialRef]);
  return <group ref={host} position={position} rotation={[0, rotation, 0]} />;
}
