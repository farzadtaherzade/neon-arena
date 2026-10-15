/**
 * Minimap projection — pure maths, no canvas.
 *
 * `ui/Minimap.ts` draws from this. The map is player-up: the player sits at the
 * centre and wherever they face is always toward the top of the canvas, so the
 * heading never has to be read off a rotating arrow.
 */

/** World units mapped from the centre to the edge of the minimap. */
export const MAP_RANGE = 34;

/**
 * Project world `(wx, wz)` into canvas pixels of a `size`×`size` minimap whose
 * player is at `(px, pz)` and facing `yaw`. Returns pixels with `(0, 0)` at the
 * top-left, matching canvas coordinates.
 */
export function project(
  px: number,
  pz: number,
  yaw: number,
  wx: number,
  wz: number,
  size: number,
  range: number = MAP_RANGE,
): { x: number; y: number } {
  const dx = wx - px;
  const dz = wz - pz;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Rotate the offset by `yaw` so the player's forward maps to up (negative y).
  const rx = dx * c - dz * s;
  const rz = dx * s + dz * c;
  const scale = size / (2 * range);
  return { x: size / 2 + rx * scale, y: size / 2 + rz * scale };
}
