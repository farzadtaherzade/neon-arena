import type { Enemy } from './enemy';

/**
 * Uniform-grid broadphase for enemy separation.
 *
 * `Enemy.chase` used to loop every enemy for every enemy every frame (O(n²)).
 * A uniform grid with a cell wider than the maximum separation distance means
 * only the 9 neighbouring cells can contain anyone close enough to push against
 * — same result, linear cost. `tests/unit/enemies.test.ts` proves it against the
 * naive loop.
 *
 * shortcut: fixed cell grid over the 60×60 arena. Fine to a few thousand
 * enemies; swap for a tree if the arena ever grows.
 */

const CELL = 2;
/**
 * Keys wrap bitwise so the grid works in an infinite world: unique within
 * ±512 cells (±1024 units) of the origin, and beyond that two far-apart cells
 * can share a key — harmless, because the population clusters around the
 * player and neighbours are always truly adjacent in space.
 */
const KEY_SPAN = 1024;

const cellKey = (cx: number, cz: number): number =>
  ((cx + KEY_SPAN / 2) & (KEY_SPAN - 1)) * KEY_SPAN + ((cz + KEY_SPAN / 2) & (KEY_SPAN - 1));

/** Reused so the neighbour scan never allocates. */
const EMPTY: readonly Enemy[] = [];

export class SpatialHash {
  private cells = new Map<number, Enemy[]>();
  private out: Enemy[] = [];

  rebuild(enemies: readonly Enemy[]): void {
    for (const bucket of this.cells.values()) bucket.length = 0;
    for (const e of enemies) {
      if (e.state !== 'alive') continue;
      const key = cellKey(Math.floor(e.pos.x / CELL), Math.floor(e.pos.z / CELL));
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(e);
      else this.cells.set(key, [e]);
    }
  }

  /** Enemies in the 9 cells around `e`, including `e` itself. */
  neighbours(e: Enemy): readonly Enemy[] {
    const cx = Math.floor(e.pos.x / CELL);
    const cz = Math.floor(e.pos.z / CELL);
    const out = this.out;
    out.length = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this.cells.get(cellKey(cx + dx, cz + dz));
        if (bucket) for (const other of bucket) out.push(other);
      }
    }
    return out.length ? out : EMPTY;
  }
}
