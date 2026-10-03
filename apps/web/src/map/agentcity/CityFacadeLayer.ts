import { createTownBuildingsScene } from "../townArchitecture";
// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import * as THREE from "three";
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type Map as MapLibreMap,
  type GeoJSONSource,
  type FilterSpecification,
} from "maplibre-gl";
import {
  createCityFacadeScene,
  FACADE_ORIGIN,
  FACADE_MERCATOR_SCALE,
  type FacadeFeature,
} from "./cityFacadeScene";
import {
  createCityLandscapeScene,
  type LandscapeTree,
} from "./cityLandscapeScene";
import type { CityBuildingLocation } from "./mapTypes";
import {
  ORGANIZATION_BUILDING_SCALE,
  organizationProfile,
} from "./organizationProfile";
import { createCityBlockScene } from "./cityBlockScene";
import { cityBuildingFallbackFilter } from "./cityBuildingHandoff";
import { CITY_BUILDING_ZOOMS } from "./cityBuildingVisibility";
import { createCityFacadeEnvironment } from "./cityFacadeFinish";
import { createMapPerspectiveCamera } from "./mapPerspectiveCamera";
import { createCityAmbientOcclusion } from "./cityAmbientOcclusion";
import { createCityWaterSceneAsync, type WaterFeature } from "./cityWaterScene";
import {
  createCityStreetScene,
  createCityStreetSceneAsync,
  type StreetFeature,
} from "./cityStreetScene";

/** Batched architectural detail shares the native map's depth and camera. */
export function createCityFacadeLayer(
  baseUrl: string,
  evidence?: HTMLElement,
  replaceNativeBuildings = false,
  organizationLocations: CityBuildingLocation[] = [],
): CustomLayerInterface {
  let map: MapLibreMap | undefined, renderer: THREE.WebGLRenderer | undefined;
  let environment: THREE.WebGLRenderTarget | undefined;
  let environmentAttempted = false;
  let contact: ReturnType<typeof createCityAmbientOcclusion> | undefined;
  let contactFailed = false;
  let model: ReturnType<typeof createCityFacadeScene> | undefined,
    source: FacadeFeature[] | undefined;
  let landscape: ReturnType<typeof createCityLandscapeScene> | undefined,
    planting: LandscapeTree[] | undefined;
  let loading = false,
    removed = false,
    frames = 0;
  let blocks: ReturnType<typeof createCityBlockScene> | undefined;
  let town: ReturnType<typeof createTownBuildingsScene> | undefined;
  let blockSource: FacadeFeature[] | undefined;
  let nativeFilter: FilterSpecification | undefined,
    fallbackFilter: FilterSpecification | undefined,
    detailedOwnsBuildings = false;
  const handoff = (detailed: boolean) => {
    // Legacy min views pick individual native extrusions. Their query layer
    // remains intact; the conversational city uses its dedicated icon targets.
    if (!replaceNativeBuildings) return;
    if (!map?.getLayer("building-3d") || detailedOwnsBuildings === detailed)
      return;
    map.setFilter(
      "building-3d",
      detailed ? fallbackFilter! : (nativeFilter ?? null),
    );
    detailedOwnsBuildings = detailed;
    if (evidence)
      evidence.dataset.buildingRenderer = detailed ? "detailed" : "native";
  };
  let streets: ReturnType<typeof createCityStreetScene> | undefined,
    streetSource: StreetFeature[] | undefined,
    streetsLoading = false;
  let water: Awaited<ReturnType<typeof createCityWaterSceneAsync>> | undefined,
    waterLoading = false;
  let roadsData: Promise<StreetFeature[]> | undefined;
  const getRoads = () =>
    (roadsData ??= (map!.getSource("roads") as GeoJSONSource)
      .getData()
      .then((data) => {
        if (data.type !== "FeatureCollection" || !Array.isArray(data.features))
          throw Error("Roads must be a feature collection");
        return data.features as StreetFeature[];
      }));
  const controller = new AbortController(),
    mapCamera = createMapPerspectiveCamera(),
    camera = mapCamera.camera,
    projection = new THREE.Matrix4();
  const origin = MercatorCoordinate.fromLngLat(FACADE_ORIGIN);
  const restore = () => {
    if (model) model.scene.userData.shadowsDirty = true;
    map?.triggerRepaint();
  };
  const restoreContext = () => {
    // Render targets lose their generated pixels with the shared GL context.
    // Rebuild this optional reflection field without refetching geometry.
    environment?.dispose();
    environment = undefined;
    environmentAttempted = false;
    contact?.dispose();
    contact = undefined;
    contactFailed = false;
    if (model) model.scene.environment = null;
    restore();
  };
  const transform = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, 0)
    .scale(
      new THREE.Vector3(
        FACADE_MERCATOR_SCALE,
        -FACADE_MERCATOR_SCALE,
        FACADE_MERCATOR_SCALE,
      ),
    )
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  async function load() {
    if (loading || source || removed) return;
    loading = true;
    try {
      // Use precisely the same authoritative snapshot as native extrusions.
      // The older separate facade export omitted legacy high-rises and could
      // drift from the buildings that users were seeing underneath it.
      const data = await (
        map!.getSource("buildings") as GeoJSONSource
      ).getData();
      if (removed) return;
      if (data.type !== "FeatureCollection" || !Array.isArray(data.features))
        throw Error("Buildings must be a feature collection");
      blockSource = data.features as FacadeFeature[];
      source = blockSource.filter(
        (f) => !f.properties.hasParts && f.properties.render_height >= 60,
      );
      if (evidence) evidence.dataset.facadeSource = "ready";
      map?.triggerRepaint();
      // Optional landscape failure must never remove the geographic buildings.
      try {
        const response = await fetch(`${baseUrl}data/city-landscape.geojson`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw Error(`Landscape detail HTTP ${response.status}`);
        const data = await response.json();
        if (removed) return;
        if (!Array.isArray(data.features))
          throw Error("Landscape feature collection is invalid");
        planting = data.features;
        if (evidence) evidence.dataset.landscapeSource = "ready";
        map?.triggerRepaint();
      } catch (error) {
        if (!removed) {
          if (evidence) evidence.dataset.landscapeSource = "unavailable";
          console.warn(
            "Illustrative landscape unavailable; geographic map remains visible",
            error,
          );
        }
      }
    } catch (error) {
      if (!removed) {
        if (evidence) evidence.dataset.facadeSource = "unavailable";
        console.warn(
          "Facade detail unavailable; native buildings remain visible",
          error,
        );
      }
    }
  }
  return {
    id: "city-facade-detail",
    type: "custom",
    renderingMode: "3d",
    onAdd(instance, gl) {
      map = instance;
      renderer = new THREE.WebGLRenderer({
        canvas: instance.getCanvas(),
        context: gl,
      });
      renderer.autoClear = false;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      nativeFilter = map.getFilter("building-3d") || undefined;
      if (evidence) evidence.dataset.buildingRenderer = "native";
      map.getCanvas().addEventListener("webglcontextrestored", restoreContext);
    },
    render(_gl, args) {
      if (!map || !renderer) return;
      const center = map.getCenter(),
        visible =
          // A full airport route reaches ~11.8: keep geographic buildings,
          // water and landscape without forcing a closer, cropped camera.
          // Farther views use native extrusions; small details have own LOD.
          map.getZoom() >= CITY_BUILDING_ZOOMS.detailed &&
          Math.abs(center.lng - FACADE_ORIGIN[0]) < 0.3 &&
          Math.abs(center.lat - FACADE_ORIGIN[1]) < 0.3;
      if (evidence) evidence.dataset.facadeVisible = String(visible);
      if (!visible) {
        handoff(false);
        return;
      }
      if (
        !streetsLoading &&
        map.getZoom() >= 14.6 &&
        map.isSourceLoaded("roads")
      ) {
        streetsLoading = true;
        void getRoads()
          .then((data) => {
            if (removed) return;
            streetSource = data;
            map?.triggerRepaint();
          })
          .catch((error) => {
            if (!removed) {
              if (evidence) evidence.dataset.streetSource = "unavailable";
              console.warn(
                "Street surface detail unavailable; native road map retained",
                error,
              );
            }
          });
      }
      if (!source) {
        if (map.isSourceLoaded("buildings")) void load();
        return;
      }
      if (!model) {
        if (map.getSource("terrain") && !map.isSourceLoaded("terrain")) return;
        model = createCityFacadeScene(
          source,
          (coordinate) => map!.queryTerrainElevation(coordinate) ?? 0,
        );
        model.scene.userData.shadowsDirty = true;
        model.scene.userData.requestRender = restore;
        model.scene.userData.contactOcclusion = 0.65;
        if (evidence) {
          evidence.dataset.facadeWalls = String(model.walls);
          evidence.dataset.facadeBuildings = String(model.representedIds.size);
          evidence.dataset.roofParts = String(
            model.scene.userData.roofPartCount,
          );
        }
      }
      if (!environmentAttempted) {
        environmentAttempted = true;
        renderer.resetState();
        try {
          environment = createCityFacadeEnvironment(renderer);
          model.scene.environment = environment.texture;
          model.scene.environmentIntensity = 0.35;
          if (evidence) evidence.dataset.facadeEnvironment = "ready";
        } catch (error) {
          if (evidence) evidence.dataset.facadeEnvironment = "unavailable";
          console.warn(
            "Facade reflections unavailable; geographic buildings retain daylight shading",
            error,
          );
        } finally {
          renderer.resetState();
        }
      }
      if (
        !waterLoading &&
        map.isSourceLoaded("water") &&
        map.isSourceLoaded("roads")
      ) {
        waterLoading = true;
        const started = performance.now();
        const targetModel = model;
        if (evidence) evidence.dataset.waterSurface = "building";
        void Promise.all([
          (map.getSource("water") as GeoJSONSource).getData(),
          getRoads(),
        ])
          .then(([data, roads]) => {
            if (
              data.type !== "FeatureCollection" ||
              !Array.isArray(data.features)
            )
              throw Error("Water must be a feature collection");
            return createCityWaterSceneAsync(
              data.features as WaterFeature[],
              (c) => map?.queryTerrainElevation(c) ?? 0,
              controller.signal,
              roads,
            );
          })
          .then((built) => {
            if (removed || model !== targetModel) {
              built.dispose();
              return;
            }
            water = built;
            targetModel.scene.add(
              built.mesh,
              built.bridges,
              built.structures.group,
            );
            targetModel.scene.userData.shadowsDirty = true;
            if (evidence) {
              evidence.dataset.waterSurface = "ready";
              evidence.dataset.waterFeatures = String(built.featureCount);
              evidence.dataset.bridgeStructures = String(
                built.structures.group.userData.spanCount,
              );
              evidence.dataset.waterTriangles = String(
                built.mesh.userData.triangles,
              );
              evidence.dataset.waterBuildMs = String(
                Math.round(performance.now() - started),
              );
            }
            map?.triggerRepaint();
          })
          .catch((error) => {
            if (removed) return;
            if (evidence) evidence.dataset.waterSurface = "unavailable";
            console.warn(
              "Water finish unavailable; native water map retained",
              error,
            );
          });
      }
      if (planting && !landscape) {
        landscape = createCityLandscapeScene(
          planting,
          (c) => map!.queryTerrainElevation(c) ?? 0,
          organizationLocations.map((location) => ({
            coordinate: [location.longitude, location.latitude],
            radius:
              (Math.hypot(
                  organizationProfile(location).width,
                  organizationProfile(location).depth,
                ) /
                2 +
                12) *
              ORGANIZATION_BUILDING_SCALE,
          })),
        );
        model.scene.add(landscape.group);
        model.scene.userData.shadowsDirty = true;
        if (evidence) {
          evidence.dataset.landscapeTrees = String(landscape.count);
          evidence.dataset.landscapeBatches = String(landscape.batches);
        }
      }
      if (blockSource && !blocks) {
        try {
          town = createTownBuildingsScene(blockSource);
          model.scene.add(town.group);
          blocks = createCityBlockScene(
            blockSource.filter((feature) => !feature.properties.townStyle),
            (c) => map!.queryTerrainElevation(c) ?? 0,
          );
          model.scene.add(blocks.group);
          const represented = new Set([
            ...model.representedIds,
            ...blocks.representedIds,
            ...town.representedIds,
          ]);
          fallbackFilter = cityBuildingFallbackFilter(
            blockSource,
            represented,
            nativeFilter,
          );
          model.scene.userData.shadowsDirty = true;
          if (evidence) {
            evidence.dataset.blockSource = "ready";
            evidence.dataset.blockFeatures = String(blocks.count);
            evidence.dataset.blockParapets = String(blocks.rimCount);
            evidence.dataset.detailedBuildingFeatures = String(
              represented.size,
            );
            evidence.dataset.nativeBuildingRemainder = String(
              blockSource.filter(
                (f) => !f.properties.hasParts && !represented.has(f.id),
              ).length,
            );
          }
        } catch (error) {
          if (evidence) evidence.dataset.blockSource = "unavailable";
          console.warn(
            "Neighbourhood construction unavailable; native geographic buildings retained",
            error,
          );
        } finally {
          blockSource = undefined;
        }
      }
      if (blocks?.updateDetail(map.getZoom()))
        model.scene.userData.shadowsDirty = true;
      if (streetSource && !streets) {
        const started = performance.now();
        const features = streetSource,
          targetModel = model;
        streetSource = undefined;
        if (evidence) evidence.dataset.streetSource = "building";
        void createCityStreetSceneAsync(
          features,
          (c) => map?.queryTerrainElevation(c) ?? 0,
          controller.signal,
        )
          .then((built) => {
            if (removed || model !== targetModel) {
              built.dispose();
              return;
            }
            streets = built;
            targetModel.scene.add(streets.group);
            if (evidence) {
              evidence.dataset.streetSource = "ready";
              evidence.dataset.streetFeatures = String(streets.featureCount);
            }
            map?.triggerRepaint();
          })
          .catch((error) => {
            if (removed) return;
            if (evidence) evidence.dataset.streetSource = "unavailable";
            console.warn(
              "Street surface construction unavailable; native road map retained",
              error,
            );
          })
          .finally(() => {
            if (!removed && evidence)
              evidence.dataset.streetBuildMs = String(
                Math.round(performance.now() - started),
              );
          });
      }
      streets?.updateDetail(map.getZoom());
      if (water?.structures.updateDetail(map.getZoom()))
        model.scene.userData.shadowsDirty = true;
      if (evidence && streets)
        evidence.dataset.streetDetail = streets.group.userData.detail;
      if (landscape?.updateDetail(map.getZoom()))
        model.scene.userData.shadowsDirty = true;
      if (evidence && landscape)
        evidence.dataset.landscapeDetail = landscape.group.userData.detail;
      projection.fromArray(args.defaultProjectionData.mainMatrix);
      projection.multiply(transform);
      if (!mapCamera.update(projection)) return;
      if (blocks && fallbackFilter) handoff(true);
      const metersPerPixel =
        (40075016.68557849 * Math.cos((center.lat * Math.PI) / 180)) /
        (512 * 2 ** map.getZoom());
      const extent = THREE.MathUtils.clamp(
        Math.max(
          map.getContainer().clientWidth,
          map.getContainer().clientHeight,
        ) * metersPerPixel,
        450,
        4200,
      );
      const fitted = model.fitShadow([center.lng, center.lat], extent);
      renderer.shadowMap.needsUpdate =
        fitted || model.scene.userData.shadowsDirty;
      model.updateShadowVisibility();
      renderer.resetState();
      renderer.render(model.scene, camera);
      const mainCalls = renderer.info.render.calls,
        mainTriangles = renderer.info.render.triangles;
      // Screen-space contact detail uses the same physical models, geographic
      // ground, projection and canvas. It does not own a second animation loop.
      const sky = model.scene.getObjectByName("sky") as THREE.HemisphereLight;
      const strength =
        Number(model.scene.userData.contactOcclusion) *
        THREE.MathUtils.smoothstep(map.getZoom(), 13.7, 15) *
        THREE.MathUtils.clamp(sky.intensity / 0.8, 0, 1);
      let contactStats = { calls: 0, triangles: 0 };
      if (strength > 0 && !contactFailed) {
        try {
          contact ??= createCityAmbientOcclusion();
          contactStats = contact.render(
            renderer,
            model.scene,
            camera,
            map.getCanvas().width,
            map.getCanvas().height,
            strength,
          );
        } catch (error) {
          // Optional optical detail must not break geographic drawing, camera
          // controls or the service conversation on an interrupted GPU context.
          contactFailed = true;
          contact?.dispose();
          contact = undefined;
          console.warn(
            "City contact shading unavailable; native map retained",
            error,
          );
        }
      }
      model.scene.userData.shadowsDirty = false;
      renderer.resetState();
      if (evidence) {
        evidence.dataset.facadeFrames = String(++frames);
        evidence.dataset.facadeCalls = String(mainCalls);
        evidence.dataset.facadeTriangles = String(mainTriangles);
        evidence.dataset.contactOcclusionCalls = String(contactStats.calls);
        evidence.dataset.contactOcclusionState = contactFailed
          ? "unavailable"
          : contactStats.calls
            ? "ready"
            : "inactive";
        evidence.dataset.contactOcclusionTriangles = String(
          contactStats.triangles,
        );
        evidence.dataset.facadeTotalCalls = String(
          mainCalls + contactStats.calls,
        );
        evidence.dataset.facadeShadowReady = String(
          !!(model.scene.getObjectByName("sun") as THREE.DirectionalLight)
            .shadow.map,
        );
      }
    },
    onRemove() {
      // During context loss MapLibre has already dismantled source managers.
      // Mutating its filters here aborts style destruction, leaving stale GPU
      // terrain textures attached to the replacement renderer. A regular
      // removeLayer still returns footprints to the native building layer.
      if (
        !renderer?.getContext().isContextLost() &&
        map?.getSource("buildings")
      )
        handoff(false);
      removed = true;
      controller.abort();
      map
        ?.getCanvas()
        .removeEventListener("webglcontextrestored", restoreContext);
      model?.dispose();
      contact?.dispose();
      environment?.dispose();
      landscape?.dispose();
      blocks?.dispose();
      town?.dispose();
      streets?.dispose();
      water?.dispose();
      renderer?.dispose();
      model = undefined;
      contact = undefined;
      environment = undefined;
      landscape = undefined;
      blocks = undefined;
      town = undefined;
      streets = undefined;
      water = undefined;
      roadsData = undefined;
      renderer = undefined;
      map = undefined;
    },
  };
}
