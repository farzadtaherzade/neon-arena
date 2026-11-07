import type { Rng } from '../../core/rng';

/**
 * Arena geometry constants — the sizes and heights that never change.
 *
 * *Where* everything sits is generated per run: `world/chunks.ts` rolls the
 * home arena (chunk (0,0)) from the run seed — decks sliding along their
 * mid-edges, landmarks wandering, maze cover mirrored from one quadrant — and
 * `render/Arena.ts` turns those tables into geometry and colliders. Only the
 * dimensions live here, so every invariant that talks about size has one
 * source; the per-seed invariants are asserted on generated tables in the
 * unit suite.
 */

/**
 * Height of a gatehouse deck — and therefore of the ramp that reaches it.
 * Above `WORLD.STEP_HEIGHT` and above the jump apex, so the ramp is the only
 * way up for the player. Mobs never climb; they besiege the ramp mouth.
 */
export const PLATFORM_H = 2.4;

/** A gatehouse deck: `w × h × d`, its centre on a mid-edge at `DECK_EDGE`. */
export const DECK = { w: 7, h: PLATFORM_H, d: 7 } as const;

/** A deck's centre sits this far out along its mid-edge; the ramp reaches in. */
export const DECK_EDGE = 35;

/** The magenta reactor: a solid landmark box, never walkable. */
export const REACTOR_SIZE = { w: 9, h: 5.5, d: 9 } as const;

/**
 * The clock tower: a tall landmark whose face shows the wave and the
 * countdown, so it has to be visible from the far side of the arena. It picks
 * one of the four corners per run, standing `TOWER_CORNER` out along both axes.
 */
export const TOWER_SIZE = { w: 10, d: 10, h: 24 } as const;
export const TOWER_CORNER = 36;

/**
 * The Y rotation that points a ramp's uphill face (its local +x axis) along
 * the given up vector. The wedge mesh is built climbing along +x, so mesh and
 * collider only agree when this is right.
 */
export function rampRotation(upX: number, upZ: number): number {
  return Math.atan2(-upZ, upX);
}

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
