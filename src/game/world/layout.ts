import type { Rng } from '../../core/rng';

/**
 * Arena layout as data, not meshes.
 *
 * `render/Arena.ts` turns these tables into geometry and registers the
 * resulting boxes with the collision world; the tables themselves are plain
 * numbers so they can be asserted on in a unit test.
 */

/** Cover blocks as `[x, z, width, height, depth]`. */
export const OBSTACLES: readonly (readonly [number, number, number, number, number])[] = [
  [-10, -8, 4, 3, 4],
  [12, -14, 5, 2.5, 3],
  [8, 10, 3, 4, 3],
  [-14, 12, 4, 2, 4],
  [0, -20, 6, 3.5, 2],
  [-20, -2, 3, 3, 6],
  [18, 18, 4, 3, 4],
  [-4, 20, 5, 2.5, 3],
];

/**
 * Height of a raised corner platform — and therefore of the ramp that reaches
 * it. Kept above `WORLD.JUMP_V`'s apex and well above `WORLD.STEP_HEIGHT`, so
 * the ramp is the only way up for the player *and* for the mobs.
 */
export const PLATFORM_H = 1.6;

/**
 * Four raised corner platforms as `[x, z, width, height, depth]`.
 *
 * The outer faces land one player radius inside the walkable limit
 * (`HALF - WALL_INSET - 2 * PLAYER_R` = 28.1), which is what closes the old
 * dead pocket between platform and wall: there is no longer a gap wide enough
 * to wedge a body into, so the corner *is* the platform.
 */
export const PLATFORMS: readonly (readonly [number, number, number, number, number])[] = [
  [-25, -25, 6.2, PLATFORM_H, 6.2], // NW
  [25, -25, 6.2, PLATFORM_H, 6.2], // NE
  [25, 25, 6.2, PLATFORM_H, 6.2], // SE
  [-25, 25, 6.2, PLATFORM_H, 6.2], // SW
];

/**
 * Ramps from the floor up to a platform, as
 * `[x, z, width, length, upX, upZ]`.
 *
 * `upX`/`upZ` is the unit vector pointing *uphill* (exactly one is ±1), so the
 * high edge is the edge the vector points at. Each ramp is placed so that edge
 * lands exactly on its platform's inner face: the walkable surface meets the
 * platform top with no lip and no gap. `width` is the cross-slope span.
 */
export const RAMPS: readonly (readonly [number, number, number, number, number, number])[] = [
  [-19.8, -25, 3.6, 4.2, -1, 0], // NW: climbs west onto the platform's east face
  [19.8, -25, 3.6, 4.2, 1, 0], // NE: climbs east onto the west face
  [19.8, 25, 3.6, 4.2, 1, 0], // SE
  [-19.8, 25, 3.6, 4.2, -1, 0], // SW
];

export const STAR_COUNT = 420;
export const STAR_RADIUS = 130;

/**
 * Star positions as a flat xyz array, uniformly scattered over a band on the
 * inside of a sphere. Seeded, so the sky is identical on every load.
 */
export function starfieldPositions(rng: Rng, count = STAR_COUNT): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = rng.next() * Math.PI * 2;
    const e = rng.range(0.08, 0.98);
    const i3 = i * 3;
    out[i3] = Math.cos(a) * Math.cos(e) * STAR_RADIUS;
    out[i3 + 1] = Math.sin(e) * STAR_RADIUS;
    out[i3 + 2] = Math.sin(a) * Math.cos(e) * STAR_RADIUS;
  }
  return out;
}
