// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import type { FilterSpecification } from "maplibre-gl";
import type { FacadeFeature } from "./cityFacadeScene";

/** Native vector-tile contours are quantized. A coplanar raw-GeoJSON facade can
 * sit behind them even with polygon offset, hiding windows as the camera moves.
 * Once BOTH detailed building groups are ready, retain native extrusions only
 * for features not actually represented. Unknown/failed geometry stays native.
 * This is a visibility handoff, never a mutation of source data or camera. */
export function cityBuildingFallbackFilter(
  features: FacadeFeature[],
  covered: ReadonlySet<string | number>,
  original: FilterSpecification | undefined,
): FilterSpecification {
  const remaining = features
    .filter((f) => !f.properties.hasParts && !covered.has(f.id))
    .map((f) => f.properties.osmId ?? f.id);
  // MapLibre's vector-tile wrapper parses string feature IDs as integers.
  // Our authoritative osmId property survives that conversion (way/… included).
  const fallback: FilterSpecification = remaining.length
    ? ["in", ["coalesce", ["get", "osmId"], ["id"]], ["literal", remaining]]
    : ["==", ["literal", 1], 0];
  return original
    ? (["all", original, fallback] as FilterSpecification)
    : fallback;
}
