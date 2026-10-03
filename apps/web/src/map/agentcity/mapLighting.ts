// Adapted from the user-supplied agentcity reference, qee@64ae5aa. See SOURCES.zh-CN.md.
/** Shared art-directed daylight, not an astronomical sun simulation.
 * Three's map layers use X=east, Y=up, Z=south; MapLibre uses east/south/up.
 * Map anchoring keeps the source fixed when the viewer rotates the camera. */
export const MAP_SUN: [number, number, number] = [-2, 5, 3];
const [east, up, south] = MAP_SUN;
const length = Math.hypot(east, up, south);
const degrees = 180 / Math.PI;

// Inverse of MapLibre's installed sphericalToCartesian: the library adds 90°
// to its azimuth parameter before evaluating x/y. This is not compass bearing.
export const MAP_LIGHT_POSITION: [number, number, number] = [
  1, (Math.atan2(south, east) * degrees - 90 + 360) % 360,
  Math.acos(up / length) * degrees,
];
export const MAP_SUN_BEARING = (Math.atan2(east, -south) * degrees + 360) % 360;
