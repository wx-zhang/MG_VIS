// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
// A full airport itinerary fits around zoom 11.8. Preserve real building
// footprints/heights there; farther away, native extrusions provide the LOD.
// Native geometry is fully opaque before detailed rendering takes ownership,
// including while that renderer is loading or recovering its WebGL context.
export const CITY_BUILDING_ZOOMS = {
  overview: 10.5,
  solid: 11,
  detailed: 11.5,
} as const;
