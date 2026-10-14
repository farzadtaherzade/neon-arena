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
 * Static arena collision.
 *
 * Pure arithmetic on plain numbers — no three, no DOM — so `resolveCircle` is
 * unit-testable in Node. The renderer registers boxes here from its own meshes
 * via `addObstacle`.
 */
export class CollisionWorld {
  readonly obstacles: Aabb[] = [];

  constructor(private readonly half: number = WORLD.HALF) {}

  addObstacle(box: Aabb): void {
    this.obstacles.push(box);
  }

  /**
   * Push `p` out of the arena walls and any obstacle it overlaps, mutating it
   * in place. Circles that end up inside a box are ejected along the shallowest
   * axis rather than getting stuck.
   */
  resolveCircle(p: Vec2, r: number): void {
    const b = this.half - WORLD.WALL_INSET - r;
    p.x = Math.max(-b, Math.min(b, p.x));
    p.z = Math.max(-b, Math.min(b, p.z));

    for (const o of this.obstacles) {
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
}
