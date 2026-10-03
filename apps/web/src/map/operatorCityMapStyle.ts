import type { StyleSpecification } from "maplibre-gl";
import { MAP_LIGHT_POSITION } from "./agentcity/mapLighting";
import { streetMapLayers } from "./agentcity/streetStyle";
export const CITY_MAP_BASE = `${import.meta.env.BASE_URL}maps/marlow-green/`;
export function operatorCityMapStyle(): StyleSpecification {
  const data = (name: string) => `${CITY_MAP_BASE}data/${name}.geojson`;
  return {
    version: 8,
    name: "Marlow Green · AgentCity daylight",
    light: {
      anchor: "map",
      position: [...MAP_LIGHT_POSITION],
      color: "#ffffff",
      intensity: 0.42,
    },
    sources: Object.fromEntries(
      ["buildings", "roads", "water", "parks"].map((name) => [
        name,
        { type: "geojson", data: data(name) },
      ]),
    ),
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#e7ece3" },
      },
      {
        id: "parks",
        type: "fill",
        source: "parks",
        paint: {
          "fill-color": [
            "match",
            ["get", "category"],
            "plaza",
            "#e5e7de",
            "garden",
            "#dce7d3",
            "#c6d8b4",
          ],
          "fill-opacity": 0.92,
        },
      },
      {
        id: "water",
        type: "fill",
        source: "water",
        paint: { "fill-color": "#b9d9e5", "fill-opacity": 1 },
      },
      {
        id: "water-shore",
        type: "line",
        source: "water",
        paint: {
          "line-color": "#e8f1eb",
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.4, 16, 1.5],
          "line-opacity": 0.8,
        },
      },
      ...streetMapLayers(),
      {
        id: "building-3d",
        type: "fill-extrusion",
        source: "buildings",
        filter: ["!=", ["get", "hasParts"], true],
        paint: {
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            ["get", "render_height"],
            3,
            "#f2f4f2",
            30,
            "#e1eaf0",
            90,
            "#b6cee0",
            200,
            "#91b3cf",
          ],
          "fill-extrusion-height": ["get", "render_height"],
          "fill-extrusion-base": ["get", "render_min_height"],
          "fill-extrusion-opacity": 1,
          "fill-extrusion-vertical-gradient": true,
        },
      },
    ],
  };
}
