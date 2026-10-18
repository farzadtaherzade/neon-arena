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
 * A walkable slope: an XZ footprint whose surface height ramps linearly from
 * `lowY` at the downhill edge to `highY` at the uphill edge. `upX`/`upZ` is the
 * unit vector pointing uphill — exactly one of them is ±1, which keeps the
 * footprint axis-aligned and the height a single lerp.
 *
 * Ramps are deliberately *not* in `obstacles`: a box with a flat `top` cannot
 * describe a slope. They block sideways only where the surface is too high to
 * step onto, and otherwise support whoever walks up them.
 */
export interface Ramp extends Aabb {
  lowY: number;
  highY: number;
  upX: number;
  upZ: number;
}

/** Surface height of `ramp` at (x, z), clamped to its footprint. */
export function rampHeight(ramp: Ramp, x: number, z: number): number {
  const lo = ramp.upX !== 0 ? ramp.minX : ramp.minZ;
  const hi = ramp.upX !== 0 ? ramp.maxX : ramp.maxZ;
  const span = hi - lo;
  if (span <= 0) return ramp.highY;
  const along = ramp.upX !== 0 ? x : z;
  // `t` runs 0 at the low edge to 1 at the high edge only when the uphill
  // vector is positive; mirror it for the -x / -z ramps.
  let t = (along - lo) / span;
  if (ramp.upX < 0 || ramp.upZ < 0) t = 1 - t;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return ramp.lowY + (ramp.highY - ramp.lowY) * t;
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
 * via `addObstacle`, and slopes via `addRamp`.
 */
export class CollisionWorld {
  readonly obstacles: Collider[] = [];
  readonly ramps: Ramp[] = [];

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

  addRamp(ramp: Ramp): void {
    this.ramps.push({
      minX: ramp.minX,
      maxX: ramp.maxX,
      minZ: ramp.minZ,
      maxZ: ramp.maxZ,
      lowY: ramp.lowY,
      highY: ramp.highY,
      upX: ramp.upX,
      upZ: ramp.upZ,
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

    // Ramps only block where their surface is a wall rather than a step: the
    // toe is walk-on, the high side is solid. A centre already *inside* the
    // footprint is standing on the slope, so it is never pushed.
    for (const ramp of this.ramps) {
      const cx = Math.max(ramp.minX, Math.min(ramp.maxX, p.x));
      const cz = Math.max(ramp.minZ, Math.min(ramp.maxZ, p.z));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r || d2 < 1e-8) continue;
      if (rampHeight(ramp, cx, cz) <= reach) continue;
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      p.x += dx * push;
      p.z += dz * push;
    }
  }

  /**
   * Would a body of radius `r` overlap any collider at (x, z)? Used by spawn
   * selection, so a wave never materialises inside a maze wall or on a ramp.
   */
  blockedAt(x: number, z: number, r: number): boolean {
    for (const o of this.obstacles) {
      const cx = Math.max(o.minX, Math.min(o.maxX, x));
      const cz = Math.max(o.minZ, Math.min(o.maxZ, z));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    for (const ramp of this.ramps) {
      const cx = Math.max(ramp.minX, Math.min(ramp.maxX, x));
      const cz = Math.max(ramp.minZ, Math.min(ramp.maxZ, z));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
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
    for (const ramp of this.ramps) {
      const cx = Math.max(ramp.minX, Math.min(ramp.maxX, p.x));
      const cz = Math.max(ramp.minZ, Math.min(ramp.maxZ, p.z));
      const dx = p.x - cx;
      const dz = p.z - cz;
      if (dx * dx + dz * dz >= r * r) continue;
      const h = rampHeight(ramp, p.x, p.z);
      if (h > ceiling || h <= best) continue;
      best = h;
    }
    return best;
  }
}
