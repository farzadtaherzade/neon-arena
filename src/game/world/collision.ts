import { WORLD } from '../config';

/** Axis-aligned box on the XZ plane. */
export interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Anything with an XZ position — the player, an enemy, the camera. */
export interface Vec2 {
  x: number;
  z: number;
}

/**
 * A registered collider: the XZ footprint plus the world-Y of its top surface.
 * `top` is `Infinity` for a full-height wall (nothing can be stepped or stood
 * on), the real mesh height for platforms and cover.
 */
export interface Collider extends Aabb {
  top: number;
}

/**
 * The player's vertical stance, supplied only when a caller wants step-up.
 * Absent it, `resolveCircle` treats every collider as a full wall — the legacy
 * behaviour the enemies and the tests rely on.
 */
export interface StepContext {
  /** Feet world-Y (eye height minus `WORLD.PLAYER_H`). */
  feetY: number;
  /** How far above the feet a top may be and still be walked onto. */
  step: number;
}

/**
 * Static arena collision.
 *
 * Pure arithmetic on plain numbers — no three, no DOM — so `resolveCircle` is
 * unit-testable in Node. The renderer registers boxes here from its own meshes
 * via `addObstacle`.
 */
export class CollisionWorld {
  readonly obstacles: Collider[] = [];

  constructor(private readonly half: number = WORLD.HALF) {}

  addObstacle(box: Aabb, top: number = Number.POSITIVE_INFINITY): void {
    this.obstacles.push({
      minX: box.minX,
      maxX: box.maxX,
      minZ: box.minZ,
      maxZ: box.maxZ,
      top,
    });
  }

  /**
   * Push `p` out of the arena walls and any obstacle it overlaps, mutating it
   * in place. Circles that end up inside a box are ejected along the shallowest
   * axis rather than getting stuck.
   *
   * With a `StepContext`, a collider whose top sits at or below `feetY + step`
   * is stepped over instead of blocked (its `top` is low enough to walk onto).
   * Without one, every collider blocks — the enemy/default path.
   */
  resolveCircle(p: Vec2, r: number, ctx?: StepContext): void {
    const reach = ctx ? ctx.feetY + ctx.step : 0;
    const b = this.half - WORLD.WALL_INSET - r;
    p.x = Math.max(-b, Math.min(b, p.x));
    p.z = Math.max(-b, Math.min(b, p.z));

    for (const o of this.obstacles) {
      if (o.top <= reach) continue;
      const cx = Math.max(o.minX, Math.min(o.maxX, p.x));
      const cz = Math.max(o.minZ, Math.min(o.maxZ, p.z));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;

      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (r - d) / d;
        p.x += dx * push;
        p.z += dz * push;
      } else {
        // Degenerate: the centre is inside the box. Leave by the nearest face.
        const pl = p.x - o.minX;
        const pr = o.maxX - p.x;
        const pt = p.z - o.minZ;
        const pb = o.maxZ - p.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) p.x = o.minX - r;
        else if (m === pr) p.x = o.maxX + r;
        else if (m === pt) p.z = o.minZ - r;
        else p.z = o.maxZ + r;
      }
    }
  }

  /**
   * World-Y of the highest walkable surface under `p` (its XZ footprint,
   * inflated by `r`), among colliders whose top is at or below `ceiling`.
   * Returns 0 for the arena floor. Allocation-free, called once per player step.
   */
  groundHeight(p: Vec2, r: number, ceiling: number): number {
    let best = 0;
    for (const o of this.obstacles) {
      if (o.top > ceiling || o.top <= best) continue;
      const cx = Math.max(o.minX, Math.min(o.maxX, p.x));
      const cz = Math.max(o.minZ, Math.min(o.maxZ, p.z));
      const dx = p.x - cx;
      const dz = p.z - cz;
      if (dx * dx + dz * dz < r * r) best = o.top;
    }
    return best;
  }
}
