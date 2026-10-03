// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import { STREET_PROFILES, streetProfile } from "./streetProfile";

/** Zoom-scaled map pavement uses the same illustrative widths as the near-view
 * 3D ribbons. Approximate pixels/metre at HCMC latitude, not a traffic map. */
export function streetMapLayers(): LayerSpecification[] {
  const kinds = [
    ...Object.keys(STREET_PROFILES),
    ...["motorway", "trunk", "primary", "secondary", "tertiary"].map(
      (k) => `${k}_link`,
    ),
  ];
  const width = (
    shoulder: boolean,
    pixelsPerMetre: number,
  ): ExpressionSpecification =>
    [
      "match",
      ["get", "class"],
      ...kinds.flatMap((k) => {
        const profile = streetProfile(k)!;
        return [
          k,
          (profile.width + (shoulder ? profile.sidewalk * 2 + 0.5 : 0)) *
            pixelsPerMetre,
        ];
      }),
      0,
    ] as unknown as ExpressionSpecification;
  const size = (shoulder: boolean): ExpressionSpecification => [
    "interpolate",
    ["exponential", 2],
    ["zoom"],
    10,
    width(shoulder, 0.01334),
    20,
    width(shoulder, 13.66),
  ];
  const filters = [
    "in",
    ["get", "class"],
    ["literal", kinds],
  ] as ExpressionSpecification;
  const minor = [
    "in",
    ["get", "class"],
    [
      "literal",
      [
        "service",
        "pedestrian",
        "footway",
        "cycleway",
        "path",
        "track",
        "steps",
      ],
    ],
  ] as ExpressionSpecification;
  const layers: LayerSpecification[] = [
    {
      id: "road-casing",
      type: "line",
      source: "roads",
      minzoom: 10,
      filter: ["all", filters, ["!", minor]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#edf0ed",
        "line-width": size(true),
        "line-opacity": 0.96,
      },
    },
    {
      id: "roads",
      type: "line",
      source: "roads",
      minzoom: 9,
      filter: ["all", filters, ["!", minor]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": [
          "match",
          ["get", "class"],
          ["pedestrian", "footway", "cycleway"],
          "#d9dedb",
          "#c8d1d5",
        ],
        "line-width": size(false),
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.55, 13, 1],
      },
    },
    {
      id: "roads-minor",
      type: "line",
      source: "roads",
      minzoom: 14.1,
      filter: ["all", filters, minor],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": [
          "match",
          ["get", "class"],
          "service",
          "#c8d1d5",
          "#d9dedb",
        ],
        "line-width": size(false),
        "line-opacity": 0.9,
      },
    },
  ];
  // Keep bridge location readable in the native geographic layer; near-view
  // illustrative paving intentionally does not fabricate bridge engineering.
  layers.push(
    {
      id: "road-bridge-edge",
      type: "line",
      source: "roads",
      minzoom: 13,
      filter: ["all", filters, ["==", ["get", "bridge"], true]],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": "#f7f8f5", "line-width": size(true) },
    },
    {
      id: "road-bridge",
      type: "line",
      source: "roads",
      minzoom: 13,
      filter: ["all", filters, ["==", ["get", "bridge"], true]],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": "#c1cdd3", "line-width": size(false) },
    },
  );
  return layers;
}
