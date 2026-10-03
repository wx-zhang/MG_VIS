import { OperatorBridgeOverlay } from "./OperatorBridgeOverlay";
import { CityTrajectoryPlayback } from "./CityTrajectoryPlayback";
import { useEffect, useRef, useState } from "react";
import { Compass, Layers, Minus, Plus, RotateCcw } from "lucide-react";
import type { PlatformOperatorCityOverviewPayload } from "@tyr-ai/contracts";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(mapWorkerUrl);
import {
  CITY_HOME,
  cityBuildingTargets,
  cityCoordinate,
  cityLocations,
  type CityCameraPose,
} from "../map/operatorCityMapModel";
import {
  CITY_MAP_BASE,
  operatorCityMapStyle,
} from "../map/operatorCityMapStyle";
import { operatorCityWorkspaceState } from "./operatorCityStatus";

export type { CityCameraPose } from "../map/operatorCityMapModel";
type Props = {
  overview: PlatformOperatorCityOverviewPayload;
  initialPose: CityCameraPose | null;
  onPoseChange: (pose: CityCameraPose) => void;
  onSelect: (serverId: string) => void;
  enteringId: string | null;
  search: string;
  connections: boolean;
  onConnectionsChange: (visible: boolean) => void;
};
export function OperatorCityMap(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const markers = useRef(
    new Map<string, { marker: maplibregl.Marker; button: HTMLButtonElement }>(),
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [focusedWorkspace, setFocusedWorkspace] = useState("");
  const [showTrajectory, setShowTrajectory] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [threeD, setThreeD] = useState(
    (props.initialPose?.pitch ?? CITY_HOME.pitch) > 0,
  );
  const beforeEntry = useRef<CityCameraPose | null>(null);
  const homeRef = useRef<(duration: number) => void>(() => {});
  const layersState = useRef({
    selected: "",
    active: [] as string[],
    attention: [] as string[],
    enabled: true,
  });
  const syncRef = useRef<() => void>(() => {});
  const reduceMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!host.current) return;
    let removed = false;
    let detailGeneration = 0;
    let geometrySignature = "";
    let map: maplibregl.Map;
    setStatus("loading");
    setError("");
    try {
      map = new maplibregl.Map({
        container: host.current,
        style: operatorCityMapStyle(),
        ...(latest.current.initialPose ?? CITY_HOME),
        minZoom: 13.7,
        maxZoom: 19,
        maxPitch: 65,
        maxBounds: [cityCoordinate(-1600, 1450), cityCoordinate(1500, -1450)],
        canvasContextAttributes: { antialias: true },
        attributionControl: false,
        pitchWithRotate: true,
        dragRotate: true,
        fadeDuration: 0,
      });
    } catch {
      setStatus("error");
      setError("The map could not start. Use the Workspace list or retry.");
      return;
    }
    mapRef.current = map;
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: "Marlow Green · Illustrative city layout",
      }),
      "bottom-left",
    );
    homeRef.current = (duration) => {
      const { width, height } = map.getContainer().getBoundingClientRect();
      const zoom =
        16.45 +
        Math.min(0, Math.log2(width / 940), Math.log2(height / 570)) -
        (width < 760 ? 0.2 : 0);
      map.easeTo({ ...CITY_HOME, zoom, duration });
    };
    if (!latest.current.initialPose) homeRef.current(0);
    const loadTimeout = window.setTimeout(() => {
      if (!removed) {
        setStatus("error");
        setError(
          "The map is taking too long to load. Use the Workspace list or retry.",
        );
      }
    }, 20000);
    const savePose = () => {
      if (latest.current.enteringId) return;
      const { lng, lat } = map.getCenter();
      latest.current.onPoseChange({
        center: [lng, lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
      setThreeD(map.getPitch() > 0);
    };
    map.on("moveend", savePose);
    const focusLines = (id: string) => setFocusedWorkspace(id);
    function sync() {
      if (removed || !map.getSource("workspace-buildings")) return;
      const { overview, search, enteringId } = latest.current;
      const locations = cityLocations(overview.workspaces);
      const ids = new Set(locations.map((location) => location.id));
      for (const [id, item] of markers.current)
        if (!ids.has(id)) {
          item.marker.remove();
          markers.current.delete(id);
        }
      for (const location of locations) {
        const workspace = overview.workspaces.find(
          (item) => item.serverId === location.id,
        )!;
        let item = markers.current.get(location.id);
        if (!item) {
          const button = document.createElement("button");
          button.type = "button";
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            latest.current.onSelect(location.id);
          });
          button.addEventListener("mouseenter", () => focusLines(location.id));
          button.addEventListener("mouseleave", () => focusLines(""));
          button.addEventListener("focus", () => focusLines(location.id));
          button.addEventListener("blur", () => focusLines(""));
          const dot = document.createElement("i");
          dot.setAttribute("aria-hidden", "true");
          const name = document.createElement("strong"),
            summary = document.createElement("small");
          button.append(dot, name, summary);
          const marker = new maplibregl.Marker({
            element: button,
            anchor: "top",
            offset: [0, 14],
          })
            .setLngLat([location.longitude, location.latitude])
            .addTo(map);
          item = { marker, button };
          markers.current.set(location.id, item);
        }
        const state = operatorCityWorkspaceState(workspace);
        item.marker.setLngLat([location.longitude, location.latitude]);
        item.button.className = `maplibregl-marker city-map-marker state-${state}${enteringId === location.id ? " is-entering" : ""}`;
        item.button.querySelector("strong")!.textContent = workspace.serverName;
        item.button.querySelector("small")!.textContent =
          workspace.waitingApprovals
            ? `${workspace.waitingApprovals} waiting for approval`
            : workspace.activeExecutions
              ? `${workspace.activeExecutions} active executions`
              : state === "offline"
                ? "Offline"
                : "Online";
        item.button.setAttribute(
          "aria-label",
          `Enter ${workspace.serverName}, ${state}`,
        );
        item.button.title = `${workspace.serverName} · ${workspace.devicesOnline}/${workspace.devicesTotal} Devices · ${workspace.agentsOnline}/${workspace.agentsTotal} Agents online`;
        item.button.style.display = workspace.serverName
          .toLowerCase()
          .includes(search.toLowerCase())
          ? ""
          : "none";
        item.button.disabled = Boolean(enteringId);
      }
      layersState.current = {
        selected: enteringId ?? "",
        active: overview.workspaces
          .filter((w) => w.activeExecutions > 0)
          .map((w) => w.serverId),
        attention: overview.workspaces
          .filter((w) => w.waitingApprovals > 0)
          .map((w) => w.serverId),
        enabled: true,
      };
      (map.getSource("workspace-buildings") as GeoJSONSource).setData(
        cityBuildingTargets(locations),
      );
      map.setFilter(
        "workspace-building-targets",
        search
          ? [
              "in",
              ["get", "id"],
              [
                "literal",
                locations
                  .filter((location) =>
                    overview.workspaces
                      .find((w) => w.serverId === location.id)
                      ?.serverName.toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((location) => location.id),
              ],
            ]
          : null,
      );
      const signature = JSON.stringify(locations);
      if (signature !== geometrySignature) {
        geometrySignature = signature;
        // Remove geometry immediately when access or stable site bindings change.
        for (const id of ["organization-architecture", "city-facade-detail"])
          if (map.getLayer(id)) map.removeLayer(id);
        void installDetails();
      }
      map.triggerRepaint();
    }
    syncRef.current = sync;
    map.on("load", () => {
      if (removed) return;
      window.clearTimeout(loadTimeout);
      map.addSource("workspace-buildings", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "workspace-building-targets",
        type: "fill-extrusion",
        source: "workspace-buildings",
        paint: {
          "fill-extrusion-color": "#248a99",
          // Queryable but fully transparent, so the target cannot occlude the custom model.
          "fill-extrusion-opacity": 0,
          "fill-extrusion-height": ["get", "height"],
        },
      });
      map.on("click", "workspace-building-targets", (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string" && !latest.current.enteringId)
          latest.current.onSelect(id);
      });
      map.on("mouseenter", "workspace-building-targets", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "workspace-building-targets", () => {
        map.getCanvas().style.cursor = "";
      });
      sync();
      savePose();
      setStatus("ready");
      setError("");
    });
    async function installDetails() {
      const generation = ++detailGeneration;
      const locations = cityLocations(latest.current.overview.workspaces);
      try {
        const [{ createCityFacadeLayer }, { createOrganizationBuildingLayer }] =
          await Promise.all([
            import("../map/agentcity/CityFacadeLayer"),
            import("../map/agentcity/OrganizationBuildingLayer"),
          ]);
        if (removed || generation !== detailGeneration) return;
        if (!map.getLayer("city-facade-detail"))
          map.addLayer(
            createCityFacadeLayer(
              CITY_MAP_BASE,
              host.current ?? undefined,
              true,
              locations,
            ),
          );
        if (!map.getLayer("organization-architecture"))
          map.addLayer(
            createOrganizationBuildingLayer(
              locations,
              () => layersState.current,
              host.current ?? undefined,
            ),
          );
      } catch {
        if (!removed)
          setError(
            "Building detail is unavailable. The map and Workspace list remain available.",
          );
      }
    }
    map.on("error", (event) => {
      if (removed) return;
      // Keep the authorized list usable when a worker, WebGL context or local asset fails.
      if (!map.loaded())
        setError(
          "Some map detail could not load. You can still enter a Workspace from the list.",
        );
      console.warn("City map resource unavailable", event.error);
    });
    const lost = () => {
      setError(
        "The map display was interrupted. Retry the map or use the Workspace list.",
      );
      setStatus("error");
    };
    map.on("webglcontextlost", lost);
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(host.current);
    return () => {
      removed = true;
      detailGeneration++;
      window.clearTimeout(loadTimeout);
      resize.disconnect();
      syncRef.current = () => {};
      homeRef.current = () => {};
      markers.current.forEach((item) => item.marker.remove());
      markers.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [retry]);

  useEffect(
    () => syncRef.current(),
    [props.overview, props.search, props.enteringId, props.connections],
  );
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!props.enteringId) {
      if (beforeEntry.current) {
        map.easeTo({
          ...beforeEntry.current,
          duration: reduceMotion() ? 0 : 300,
        });
        beforeEntry.current = null;
      }
      return;
    }
    const { lng, lat } = map.getCenter();
    beforeEntry.current = {
      center: [lng, lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    };
    props.onPoseChange(beforeEntry.current);
    const location = cityLocations(props.overview.workspaces).find(
      (item) => item.id === props.enteringId,
    );
    if (location)
      map.easeTo({
        center: [location.longitude, location.latitude],
        zoom: 17,
        pitch: threeD ? 55 : 0,
        duration: reduceMotion() ? 0 : 650,
      });
  }, [props.enteringId]);
  function toggleConnections() {
    props.onConnectionsChange(!props.connections);
  }
  return (
    <div className="operator-map-shell">
      <div
        ref={host}
        className="operator-map-canvas"
        aria-label="Marlow Green interactive city map"
      />
      {status === "ready" && mapRef.current && (
        <OperatorBridgeOverlay
          map={mapRef.current}
          overview={props.overview}
          visible={props.connections}
          focusedWorkspace={focusedWorkspace}
          onEnter={props.onSelect}
          entering={Boolean(props.enteringId)}
        />
      )}
      <div className="operator-map-tools" aria-label="Map controls">
        <button type="button" aria-label="Show TYR communication demo" aria-pressed={showTrajectory} onClick={() => setShowTrajectory(value => !value)}>Demo</button>
        <button
          type="button"
          onClick={() =>
            mapRef.current?.zoomIn({ duration: reduceMotion() ? 0 : 200 })
          }
          aria-label="Zoom in"
        >
          <Plus size={17} />
        </button>
        <button
          type="button"
          onClick={() =>
            mapRef.current?.zoomOut({ duration: reduceMotion() ? 0 : 200 })
          }
          aria-label="Zoom out"
        >
          <Minus size={17} />
        </button>
        <button
          type="button"
          onClick={() => {
            mapRef.current?.easeTo({
              pitch: threeD ? 0 : 48,
              duration: reduceMotion() ? 0 : 350,
            });
          }}
          aria-label="Toggle 3D map"
          aria-pressed={threeD}
        >
          {threeD ? "3D" : "2D"}
        </button>
        <button
          type="button"
          onClick={toggleConnections}
          aria-label="Show Workspace Bridges"
          aria-pressed={props.connections}
        >
          <Layers size={17} />
        </button>
        <button
          type="button"
          onClick={() =>
            mapRef.current?.easeTo({
              bearing: 0,
              duration: reduceMotion() ? 0 : 350,
            })
          }
          aria-label="Face north"
        >
          <Compass size={17} />
        </button>
        <button
          type="button"
          onClick={() => homeRef.current(reduceMotion() ? 0 : 500)}
          aria-label="Reset city view"
        >
          <RotateCcw size={17} />
        </button>
      </div>
      {status === "loading" && (
        <div className="city-map-message" role="status">
          Preparing the city…
        </div>
      )}
      {status === "ready" && mapRef.current && showTrajectory && <CityTrajectoryPlayback map={mapRef.current} onClose={() => setShowTrajectory(false)} />}
      {error && (
        <div className="city-map-message error" role="alert">
          {error}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry map
          </button>
        </div>
      )}
      <div className="city-map-caption">
        Illustrative city layout
        <span>Connections represent active Workspace Bridges</span>
      </div>
    </div>
  );
}


