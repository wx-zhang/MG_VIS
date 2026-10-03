import { useEffect, useId, useMemo, useState } from "react";
import type { Map as CityMap } from "maplibre-gl";
import type { PlatformOperatorCityOverviewPayload } from "@tyr-ai/contracts";
import { ArrowUpRight, Network, X } from "lucide-react";
import { cityBridgeFeatures, cityLocations } from "../map/operatorCityMapModel";
import {
  ORGANIZATION_BUILDING_SCALE,
  organizationProfile,
} from "../map/agentcity/organizationProfile";

export function OperatorBridgeOverlay({
  map,
  overview,
  visible,
  focusedWorkspace,
  onEnter,
  entering,
}: {
  map: CityMap;
  overview: PlatformOperatorCityOverviewPayload;
  visible: boolean;
  focusedWorkspace: string;
  onEnter: (id: string) => void;
  entering: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const markerId = useId().replaceAll(":", "");
  const locations = useMemo(() => cityLocations(overview.workspaces), [overview.workspaces]);
  const features = useMemo(
    () => cityBridgeFeatures(overview, locations).features,
    [overview, locations],
  );
  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          setRevision((value) => value + 1);
        });
    };
    map.on("move", update);
    map.on("resize", update);
    update();
    return () => {
      map.off("move", update);
      map.off("resize", update);
      cancelAnimationFrame(frame);
    };
  }, [map]);
  const routes = useMemo(
    () =>
      features.map((feature) => {
        // 关系线从建筑外围接出，随地图投影落在地面，避免悬空弧线穿过屋顶。
        const endpoints = [feature.properties.source, feature.properties.target];
        const [from, to] = feature.geometry.coordinates.map(([lng, lat], index) => {
          const [peerLng, peerLat] = feature.geometry.coordinates[1 - index];
          const location = locations.find((item) => item.id === endpoints[index])!;
          const { width, depth } = organizationProfile(location);
          const clearance = (Math.hypot(width, depth) / 2 + 12) * ORGANIZATION_BUILDING_SCALE;
          const distance = Math.hypot(
            (peerLng - lng) * 111320 * Math.cos(lat * Math.PI / 180),
            (peerLat - lat) * 111320,
          );
          const inset = Math.min(0.25, clearance / Math.max(1, distance));
          return map.project([
            lng + (peerLng - lng) * inset,
            lat + (peerLat - lat) * inset,
          ]);
        });
        return {
          ...feature.properties,
          path: `M${from.x},${from.y} L${to.x},${to.y}`,
        };
      }),
    [features, locations, map, revision],
  );
  const selected = routes.find((route) => route.id === selectedId);
  const name = (id: string) =>
    overview.workspaces.find((workspace) => workspace.serverId === id)
      ?.serverName ?? "Workspace";
  if (!visible) return null;
  return (
    <div className="city-bridge-overlay">
      <svg className="city-bridge-routes" role="group" aria-label="Workspace Bridge connections">
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path
              d="M1 1 L9 5 L1 9"
              fill="none"
              stroke="#557f87"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>
        {routes.map((route) => {
          const active =
            route.id === (hoveredId ?? selectedId) ||
            Boolean(
              focusedWorkspace &&
              [route.source, route.target].includes(focusedWorkspace),
            );
          const dim = (hoveredId || selectedId || focusedWorkspace) && !active;
          return (
            <g
              key={route.id}
              opacity={dim ? 0.12 : active ? 0.9 : 0.42}
              className={`city-bridge-route${active ? " is-active" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`Bridge: ${name(route.source)} ${route.direction === "bidirectional" ? "and" : "to"} ${name(route.target)}`}
              aria-pressed={selectedId === route.id}
              onClick={() => setSelectedId(selectedId === route.id ? null : route.id)}
              onMouseEnter={() => setHoveredId(route.id)}
              onMouseLeave={() => setHoveredId(null)}
              onFocus={() => setHoveredId(route.id)}
              onBlur={() => setHoveredId(null)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedId(selectedId === route.id ? null : route.id);
                } else if (event.key === "Escape") {
                  setSelectedId(null);
                }
              }}
            >
              <path
                className="city-bridge-line"
                d={route.path}
                stroke="#557f87"
                strokeWidth={active ? 1.6 : 1.2}
                strokeDasharray={active ? undefined : "3 6"}
                strokeLinecap="round"
                fill="none"
                markerEnd={active ? `url(#${markerId})` : undefined}
                markerStart={
                  active && route.direction === "bidirectional"
                    ? `url(#${markerId})`
                    : undefined
                }
              />
              <path className="city-bridge-hit" d={route.path} />
            </g>
          );
        })}
      </svg>
      {selected && (
        <section
          className="city-bridge-card"
          aria-label="Selected Workspace Bridge"
        >
          <div>
            <Network size={14} />
            <strong>Workspace Bridge</strong>
            <button
              type="button"
              aria-label="Close Bridge details"
              onClick={() => setSelectedId(null)}
            >
              <X size={14} />
            </button>
          </div>
          <p>
            {name(selected.source)}{" "}
            <b>{selected.direction === "bidirectional" ? "↔" : "→"}</b>{" "}
            {name(selected.target)}
          </p>
          <small>
            Active connection ·{" "}
            {selected.direction === "bidirectional" ? "Two-way" : "One-way"}
          </small>
          <nav>
            {[selected.source, selected.target].map((id) => (
              <button
                key={id}
                type="button"
                disabled={entering}
                onClick={() => onEnter(id)}
              >
                Enter {name(id)}
                <ArrowUpRight size={13} />
              </button>
            ))}
          </nav>
        </section>
      )}
    </div>
  );
}
