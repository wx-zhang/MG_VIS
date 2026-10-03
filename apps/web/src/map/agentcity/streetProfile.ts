// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
/** Display widths, NOT surveyed lane/sidewalk widths or navigation metadata.
 * Each divided carriageway keeps its own OSM centreline. */
export const STREET_PROFILES: Record<
  string,
  { width: number; sidewalk: number; pedestrian?: boolean }
> = {
  motorway: { width: 10.5, sidewalk: 0 },
  trunk: { width: 10, sidewalk: 0 },
  primary: { width: 9, sidewalk: 1.2 },
  secondary: { width: 7.5, sidewalk: 1.1 },
  tertiary: { width: 6.5, sidewalk: 1 },
  residential: { width: 5.5, sidewalk: 0.75 },
  unclassified: { width: 5.5, sidewalk: 0.75 },
  living_street: { width: 4, sidewalk: 0.5 },
  service: { width: 3.6, sidewalk: 0 },
  pedestrian: { width: 4, sidewalk: 0, pedestrian: true },
  footway: { width: 1.8, sidewalk: 0, pedestrian: true },
  cycleway: { width: 2, sidewalk: 0, pedestrian: true },
  path: { width: 1.5, sidewalk: 0, pedestrian: true },
  track: { width: 3, sidewalk: 0, pedestrian: true },
  steps: { width: 1.5, sidewalk: 0, pedestrian: true },
};
export function streetProfile(kind = "") {
  const base = kind.replace(/_link$/, "");
  const profile = Object.hasOwn(STREET_PROFILES, base)
    ? STREET_PROFILES[base]
    : undefined;
  return kind.endsWith("_link") && profile
    ? { ...profile, width: Math.min(5.5, profile.width), sidewalk: 0 }
    : profile;
}
