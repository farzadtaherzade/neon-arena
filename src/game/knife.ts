import { ENEMY, KNIFE } from './config';
import type { Enemy } from './enemy';

/**
 * The knife.
 *
 * Pure: a cone in front of the player. No second raycast path — the swing
 * tests every live mob against the arc directly — and it never touches a bomb.
 */
export class Knife {
  /** Seconds left before the next swing is allowed. */
  cooldown = 0;
  /** Seconds the blade has been out — the view reads this to animate it. */
  swingT = 0;

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swingT = Math.max(0, this.swingT - dt);
  }

  get ready(): boolean {
    return this.cooldown <= 0;
  }

  /**
   * Swing at everything in the cone. Fills `out` with the mobs hit and returns
   * how many there were — the caller damages them.
   */
  swing(px: number, py: number, pz: number, yaw: number, enemies: readonly Enemy[], out: Enemy[]): number {
    out.length = 0;
    if (!this.ready) return 0;
    this.cooldown = KNIFE.COOLDOWN;
    this.swingT = KNIFE.SWING_T;
    // The player looks down -z, so forward is (-sin, -cos) of the yaw.
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    for (const enemy of enemies) {
      if (enemy.state !== 'alive') continue;
      const dx = enemy.pos.x - px;
      const dz = enemy.pos.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > KNIFE.RANGE + ENEMY.COLLIDE_RADIUS * enemy.scale) continue;
      // A mob under a deck is out of reach, even if it is right below.
      if (Math.abs(enemy.pos.y - py) > KNIFE.VREACH) continue;
      if (d > 1e-4) {
        const dot = (dx / d) * fx + (dz / d) * fz;
        if (dot < Math.cos(KNIFE.ARC)) continue;
      }
      out.push(enemy);
    }
    return out.length;
  }
}
