// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type { CityBuildingLocation as MapLocation } from "./mapTypes";
import { createOrganizationScene } from "./organizationScene";
import { ORGANIZATION_BUILDING_SCALE } from "./organizationProfile";
import { createMapPerspectiveCamera } from "./mapPerspectiveCamera";
import { createCityFacadeEnvironment } from "./cityFacadeFinish";

/** Authored metre geometry with a shared overview scale at illustrative coordinates. */
export function createOrganizationBuildingLayer(
  locations: MapLocation[],
  state: () => { selected: string; active: string[]; attention: string[]; enabled: boolean },
  evidence?: HTMLElement,
): CustomLayerInterface {
  const models = new Map<string, ReturnType<typeof createOrganizationScene>>();
  let map: MapLibreMap | undefined,
    renderer: THREE.WebGLRenderer | undefined,
    canvas: HTMLCanvasElement | undefined,
    frames = 0;
  let environment: THREE.WebGLRenderTarget | undefined;
  let environmentAttempted = false;
  const mapCamera = createMapPerspectiveCamera(),
    camera = mapCamera.camera,
    projection = new THREE.Matrix4(),
    transform = new THREE.Matrix4();
  const rotation = new THREE.Matrix4().makeRotationX(Math.PI / 2),
    scale = new THREE.Vector3();
  const restore = () => {
    environment?.dispose();
    environment = undefined;
    environmentAttempted = false;
    models.forEach(({ scene }) => {
      scene.userData.shadowsDirty = true;
      scene.environment = null;
    });
    map?.triggerRepaint();
  };
  return {
    id: "organization-architecture",
    type: "custom",
    renderingMode: "3d",
    onAdd(instance, gl) {
      map = instance;
      canvas = map.getCanvas();
      renderer = new THREE.WebGLRenderer({ canvas, context: gl });
      renderer.autoClear = false;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      canvas.addEventListener("webglcontextrestored", restore);
    },
    render(_gl, args) {
      if (!map || !renderer) return;
      const current = state(),
        visible = current.enabled && map.getZoom() >= 13.5;
      if (evidence)
        evidence.dataset.organizationArchitectureVisible = String(visible);
      if (!visible) return;
      projection.fromArray(args.defaultProjectionData.mainMatrix);
      renderer.resetState();
      if (!environmentAttempted) {
        environmentAttempted = true;
        try {
          environment = createCityFacadeEnvironment(renderer);
        } catch (error) {
          console.warn(
            "Organization daylight reflection unavailable; direct light retained",
            error,
          );
        }
        renderer.resetState();
      }
      let calls = 0,
        triangles = 0,
        count = 0;
      const { width, height } = map.getContainer().getBoundingClientRect();
      for (const location of locations) {
        const point = map.project([location.longitude, location.latitude]);
        if (
          point.x < -300 ||
          point.x > width + 300 ||
          point.y < -300 ||
          point.y > height + 300
        )
          continue;
        let model = models.get(location.id);
        if (!model) {
          model = createOrganizationScene(location);
          models.set(location.id, model);
          model.scene.userData.shadowsDirty = true;
          model.scene.environmentIntensity = 0.32;
          model.scene.userData.requestRender = () => {
            model!.scene.userData.shadowsDirty = true;
            map?.triggerRepaint();
          };
        }
        const altitude =
          map.queryTerrainElevation([location.longitude, location.latitude]) ??
          0;
        const anchor = MercatorCoordinate.fromLngLat(
            [location.longitude, location.latitude],
            altitude,
          ),
          s =
            anchor.meterInMercatorCoordinateUnits() * ORGANIZATION_BUILDING_SCALE;
        transform
          .makeTranslation(anchor.x, anchor.y, anchor.z)
          .scale(scale.set(s, -s, s))
          .multiply(rotation);
        // Factor the actual geographic eye out of the complete map projection.
        // An identity view projects positions correctly but reflects glass as if
        // the viewer were at the building's own origin, even while the map moves.
        if (!mapCamera.update(transform.premultiply(projection))) continue;
        model.scene.environment = environment?.texture ?? null;
        model.setState(
          location.id === current.selected,
          current.active.includes(location.id),
          current.attention.includes(location.id),
        );
        renderer.shadowMap.needsUpdate = model.scene.userData.shadowsDirty;
        renderer.render(model.scene, camera);
        model.scene.userData.shadowsDirty = false;
        calls += renderer.info.render.calls;
        triangles += renderer.info.render.triangles;
        count++;
      }
      renderer.resetState();
      if (evidence) {
        evidence.dataset.organizationArchitectureFrames = String(++frames);
        evidence.dataset.organizationArchitectureCalls = String(calls);
        evidence.dataset.organizationArchitectureTriangles = String(triangles);
        evidence.dataset.organizationArchitectureCount = String(count);
        evidence.dataset.organizationEnvironmentReady = String(!!environment);
      }
    },
    onRemove() {
      canvas?.removeEventListener("webglcontextrestored", restore);
      models.forEach((model) => model.dispose());
      models.clear();
      environment?.dispose();
      environment = undefined;
      renderer?.dispose();
      renderer = undefined;
      map = undefined;
      canvas = undefined;
    },
  };
}
