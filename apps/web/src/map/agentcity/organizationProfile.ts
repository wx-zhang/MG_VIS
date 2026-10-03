// Town-scale adaptations of the agentcity profiles, shared by geometry and map hit targets.
import type { CityBuildingLocation } from "./mapTypes";
// 概览中的主要 Workspace 建筑统一放大，模型、点击区域与景观避让共用比例。
export const ORGANIZATION_BUILDING_SCALE = 1.8;
type Organization = Pick<CityBuildingLocation, "variant">;
export function organizationProfile(location: Organization) {
  if (location.variant === "tower")
    return { kind: "tower", width: 48, depth: 40, height: 30 } as const;
  if (location.variant === "pavilion")
    return { kind: "pavilion", width: 34, depth: 26, height: 10 } as const;
  if (location.variant === "public")
    return { kind: "public", width: 44, depth: 34, height: 21 } as const;
  if (location.variant === "hotel")
    return { kind: "hotel", width: 36, depth: 28, height: 23 } as const;
  return { kind: "office", width: 34, depth: 28, height: 18 } as const;
}
