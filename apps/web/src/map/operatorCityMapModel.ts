import type {
  PlatformOperatorCityOverviewPayload,
  MarlowGreenMapSite,
} from "@tyr-ai/contracts";
import {
  ORGANIZATION_BUILDING_SCALE,
  organizationProfile,
} from "./agentcity/organizationProfile";
import type { CityBuildingLocation } from "./agentcity/mapTypes";

export type CityCameraPose = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
};
export const CITY_CENTER: [number, number] = [106.71, 10.79];
export const CITY_HOME: CityCameraPose = {
  center: CITY_CENTER,
  zoom: 15.65,
  bearing: -18,
  pitch: 48,
};
// The same local projection origin as the reference renderer. Positions are illustrative.
export function cityCoordinate(x: number, south: number): [number, number] {
  const latitude = (CITY_CENTER[1] * Math.PI) / 180;
  const scale = 1 / (40075016.68557849 * Math.cos(latitude));
  const originY =
    (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + latitude / 2))) /
    360;
  return [
    CITY_CENTER[0] + x * scale * 360,
    (Math.atan(Math.sinh(Math.PI * (1 - 2 * (originY + south * scale)))) *
      180) /
      Math.PI,
  ];
}
export const CITY_SITES: Record<
  MarlowGreenMapSite,
  {
    x: number;
    z: number;
    variant: CityBuildingLocation["variant"];
    district: string;
  }
> = {
  dorian: { x: -275, z: -175, variant: "office", district: "Garden quarter" },
  mira: { x: 5, z: -175, variant: "office", district: "Garden quarter" },
  tomas: { x: -275, z: 150, variant: "pavilion", district: "Market street" },
  marketplace: { x: 5, z: 150, variant: "public", district: "Market street" },
  sable: { x: 280, z: 150, variant: "hotel", district: "Riverside" },
  bank: { x: 280, z: -175, variant: "tower", district: "Riverside" },
};
export function cityLocations(
  workspaces: PlatformOperatorCityOverviewPayload["workspaces"],
): CityBuildingLocation[] {
  const occupied = new Set<string>();
  return workspaces.flatMap((workspace) => {
    const site = workspace.mapSite && CITY_SITES[workspace.mapSite];
    if (!site || occupied.has(workspace.mapSite!)) return [];
    occupied.add(workspace.mapSite!);
    const [longitude, latitude] = cityCoordinate(site.x, site.z);
    return [
      { id: workspace.serverId, longitude, latitude, variant: site.variant },
    ];
  });
}
export function cityBridgeFeatures(
  overview: PlatformOperatorCityOverviewPayload,
  locations: CityBuildingLocation[],
) {
  const anchors = new Map(locations.map((location) => [location.id, location]));
  return {
    type: "FeatureCollection" as const,
    features: overview.bridges.flatMap((bridge) => {
      const a = anchors.get(bridge.workspaceAId),
        b = anchors.get(bridge.workspaceBId);
      if (!a || !b) return [];
      return [
        {
          type: "Feature" as const,
          id: bridge.id,
          properties: {
            id: bridge.id,
            source: a.id,
            target: b.id,
            direction: bridge.direction,
          },
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [a.longitude, a.latitude],
              [b.longitude, b.latitude],
            ],
          },
        },
      ];
    }),
  };
}

/** Invisible extrusion targets use the same footprint/height as the detailed model. */
export function cityBuildingTargets(locations: CityBuildingLocation[]) {
  return {
    type: "FeatureCollection" as const,
    features: locations.map((location) => {
      const { width, depth, height } = organizationProfile(location);
      const lng =
        ((width / 2 + 6) * ORGANIZATION_BUILDING_SCALE) /
        (111320 * Math.cos((location.latitude * Math.PI) / 180));
      const lat = ((depth / 2 + 9) * ORGANIZATION_BUILDING_SCALE) / 111320;
      const x = location.longitude,
        y = location.latitude;
      return {
        type: "Feature" as const,
        properties: { id: location.id, height: height * ORGANIZATION_BUILDING_SCALE },
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [
              [x - lng, y - lat],
              [x + lng, y - lat],
              [x + lng, y + lat],
              [x - lng, y + lat],
              [x - lng, y - lat],
            ],
          ],
        },
      };
    }),
  };
}
