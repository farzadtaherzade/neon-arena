import { XP, XP_LEVEL } from './config';

export { XP };

/**
 * An XP orb dropped by a dying enemy.
 *
 * Pure: it holds a plain position and pulls itself toward the player when the
 * player is inside the magnet radius. The view (`render/XpView.ts`) reads the
 * position each frame; `Game` decides when to collect.
 */
export class Xp {
  readonly pos = { x: 0, y: 0.5, z: 0 };
  /** Seconds this orb has existed; drives its bob and spin. */
  age = 0;

  constructor(
    x: number,
    z: number,
    readonly value: number,
    y = 0.5,
  ) {
    this.pos.x = x;
    this.pos.y = y;
    this.pos.z = z;
  }

  /**
   * Advance one step. Returns true once the orb has been collected, which the
   * caller turns into XP and a small burst. `magnetRadius` lets the MAGNET
   * perk widen the pull; it defaults to the tuned radius.
   */
  update(dt: number, player: { x: number; z: number }, magnetRadius: number = XP.RADIUS): boolean {
    this.age += dt;
    const dx = player.x - this.pos.x;
    const dz = player.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= XP.COLLECT) return true;
    if (d > magnetRadius) return false;

    const speed = XP.PULL_SPEED * (1 - d / magnetRadius);
    this.pos.x += (dx / d) * speed * dt;
    this.pos.z += (dz / d) * speed * dt;
    return false;
  }
}

/** XP needed to leave `level`: 60, 78, 101, 131 … */
export function xpNeeded(level: number): number {
  return Math.round(XP_LEVEL.FIRST_NEED * XP_LEVEL.GROWTH ** (level - 1));
}

/**
 * The player's progression meter.
 *
 * Pure: `Game` feeds it the value of every collected orb and pays the level-up
 * heal. Skills are a future feature — they will read `level` from here.
 */
export class XpMeter {
  level = 1;
  xp = 0;

  /** XP needed for the next level. */
  get need(): number {
    return xpNeeded(this.level);
  }

  /** Bank `amount` XP. Returns true when at least one level was crossed. */
  add(amount: number): boolean {
    this.xp += amount;
    let up = false;
    while (this.need > 0 && this.xp >= this.need) {
      this.xp -= this.need;
      this.level++;
      up = true;
    }
    return up;
  }

  reset(): void {
    this.level = 1;
    this.xp = 0;
  }
}
