import type { Rng } from '../../core/rng';

/**
 * Arena layout as data, not meshes.
 *
 * `render/Arena.ts` turns these tables into geometry and registers the
 * resulting boxes with the collision world; the tables themselves are plain
 * numbers so they can be asserted on in a unit test.
 *
 * The 84×84 floor is a dense maze: cover is mirrored four ways from one
 * quadrant so every lane has a counterpart on the far side of the arena.
 */

/**
 * Height of a gatehouse deck — and therefore of the ramp that reaches it.
 * Above `WORLD.STEP_HEIGHT` and above the jump apex, so the ramp is the only
 * way up for the player. Mobs never climb; they besiege the ramp mouth.
 */
export const PLATFORM_H = 2.4;

/**
 * Four gatehouse decks on the mid-edges, as `[x, z, width, height, depth]`.
 * Deliberately *not* in the corners: the corners are maze, the decks are
 * perimeter strongpoints visible from the centre.
 */
export const PLATFORMS: readonly (readonly [number, number, number, number, number])[] = [
  [0, -35, 7, PLATFORM_H, 7], // N
  [0, 35, 7, PLATFORM_H, 7], // S
  [35, 0, 7, PLATFORM_H, 7], // E
  [-35, 0, 7, PLATFORM_H, 7], // W
];

/**
 * Ramps from the floor up to a deck, as `[x, z, width, length, upX, upZ]`.
 *
 * `upX`/`upZ` is the unit vector pointing *uphill*, so the high edge is the
 * edge it points at. Each ramp is placed so that edge lands exactly on its
 * deck's inner face: the surface meets the deck top with no lip and no gap.
 */
export const RAMPS: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, -28.5, 4.4, 6, 0, -1], // N: climbs north onto the deck's south face
  [0, 28.5, 4.4, 6, 0, 1], // S
  [28.5, 0, 4.4, 6, 1, 0], // E: climbs east onto the west face
  [-28.5, 0, 4.4, 6, -1, 0], // W
];

/** The magenta reactor at the centre of the arena. Solid, not walkable. */
export const REACTOR = { x: 0, z: 0, w: 9, h: 5.5, d: 9 } as const;

/**
 * One quadrant of the maze, as `[x, z, width, height, depth]` with x and z
 * negative. `OBSTACLES` mirrors each entry four ways, which is what guarantees
 * the map is fair: every lane has a twin across the centre.
 *
 * Kept clear by hand: the four ramps, the four decks, the reactor footprint and
 * the 10×10 spawn plaza at `WORLD.SPAWN_*`.
 */
const MAZE_QUADRANT: readonly (readonly [number, number, number, number, number])[] = [
  [-26, -18, 12, 3.2, 2], // long spine wall, east-west
  [-15, -22, 2, 3.2, 10], // long spine wall, north-south
  [-8, -13, 5, 2.6, 5], // mid crate cluster
  [-30, -8, 3, 4, 8], // tall slab screening the west deck
  [-20, -34, 6, 2.4, 4], // bunker beside the north deck
  [-38, -22, 4, 3, 4], // corner rubble
  [-10, -30, 3, 2.4, 3], // choke crate on the north approach
  [-24, -6, 2, 2.4, 4], // low fin near the reactor
];

/** The quadrant plus its three mirrors: 32 blocks of maze. */
export const OBSTACLES: readonly (readonly [number, number, number, number, number])[] =
  MAZE_QUADRANT.flatMap(
    ([x, z, w, h, d]) =>
      [
        [x, z, w, h, d],
        [-x, z, w, h, d],
        [x, -z, w, h, d],
        [-x, -z, w, h, d],
      ] as const,
  );

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
