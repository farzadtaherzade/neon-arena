import { BOMB } from './config';
import type { Vec3 } from './player';

/**
 * A planted bomb: a position, a fuse, and a blast radius.
 *
 * Pure — it counts down and reports detonation; `Game` owns the damage and
 * `render/BombView.ts` owns the mesh. Shooting it is handled by `Pick`, which
 * finds the `Bomb` on the mesh's `userData`.
 */
export class Bomb {
  readonly pos: Vec3 = { x: 0, y: 0, z: 0 };
  fuse: number;
  state: 'live' | 'spent' = 'live';

  constructor(
    x: number,
    z: number,
    readonly fuseTime: number = BOMB.FUSE,
    readonly radius: number = BOMB.RADIUS,
  ) {
    this.pos.x = x;
    this.pos.z = z;
    this.fuse = fuseTime;
  }

  /** 0 at planting, 1 at detonation — drives the blink rate. */
  get k(): number {
    return 1 - this.fuse / this.fuseTime;
  }

  /** Advance the fuse. Returns true the frame it detonates (once). */
  update(dt: number): boolean {
    if (this.state !== 'live') return false;
    this.fuse -= dt;
    if (this.fuse > 0) return false;
    this.fuse = 0;
    this.state = 'spent';
    return true;
  }

  /** Mark it defused so a later `update` cannot also detonate it. */
  defuse(): void {
    this.state = 'spent';
  }
}
