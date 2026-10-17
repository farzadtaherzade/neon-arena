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

/** Four raised corner platforms as `[x, z, width, height, depth]`. */
export const PLATFORMS: readonly (readonly [number, number, number, number, number])[] = [
  [-22, -22, 7, 1.0, 7], // NW
  [22, -22, 7, 1.0, 7], // NE
  [22, 22, 7, 1.0, 7], // SE
  [-22, 22, 7, 1.0, 7], // SW
];

/** Ramps leading up to platforms as `[x, z, width, height, depth, rotY]`. */
export const RAMPS: readonly (readonly [number, number, number, number, number, number])[] = [
  [-17.2, -22, 2.8, 0.9, 3.5, 0], // NW ramp facing East
  [17.2, -22, 2.8, 0.9, 3.5, Math.PI], // NE ramp facing West
  [17.2, 22, 2.8, 0.9, 3.5, Math.PI], // SE ramp facing West
  [-17.2, 22, 2.8, 0.9, 3.5, 0], // SW ramp facing East
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
