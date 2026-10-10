import THREE from './three.js';
import { WORLD } from './config.js';

/**
 * Static arena collision + the bullet raycast target list.
 *
 * `solids` holds every mesh a shot can stop on. `obstacles` holds the 2D
 * bounding boxes that actors are pushed out of.
 */
export class CollisionWorld {
  constructor() {
    this.half = WORLD.HALF;
    this.solids = [];
    this.obstacles = [];
  }

  addSolid(mesh) {
    this.solids.push(mesh);
  }

  /** Register a mesh as both a bullet blocker and a movement obstacle. */
  addBlocker(mesh) {
    this.solids.push(mesh);
    mesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(mesh);
    this.obstacles.push({
      minX: box.min.x, maxX: box.max.x,
      minZ: box.min.z, maxZ: box.max.z,
    });
  }

  /**
   * Push `p` out of the walls and any obstacle it overlaps, mutating it in
   * place. Circles that end up inside a box are ejected along the shallowest
   * axis rather than getting stuck.
   */
  resolveCircle(p, r) {
    const b = this.half - WORLD.WALL_INSET - r;
    p.x = Math.max(-b, Math.min(b, p.x));
    p.z = Math.max(-b, Math.min(b, p.z));

    for (const o of this.obstacles) {
      const cx = Math.max(o.minX, Math.min(o.maxX, p.x));
      const cz = Math.max(o.minZ, Math.min(o.maxZ, p.z));
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;

      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (r - d) / d;
        p.x += dx * push;
        p.z += dz * push;
      } else {
        const pl = p.x - o.minX, pr = o.maxX - p.x;
        const pt = p.z - o.minZ, pb = o.maxZ - p.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) p.x = o.minX - r;
        else if (m === pr) p.x = o.maxX + r;
        else if (m === pt) p.z = o.minZ - r;
        else p.z = o.maxZ + r;
      }
    }
  }
}