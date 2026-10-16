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
  ) {
    this.pos.x = x;
    this.pos.z = z;
  }

  /**
   * Advance one step. Returns true once the orb has been collected, which the
   * caller turns into score and a small burst.
   */
  update(dt: number, player: { x: number; z: number }): boolean {
    this.age += dt;
    const dx = player.x - this.pos.x;
    const dz = player.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= XP.COLLECT) return true;
    if (d > XP.RADIUS) return false;

    const speed = XP.PULL_SPEED * (1 - d / XP.RADIUS);
    this.pos.x += (dx / d) * speed * dt;
    this.pos.z += (dz / d) * speed * dt;
    return false;
  }
}

/** Tuning for the XP orb magnet and payout. */
export const XP = {
  /** Pull the orb toward the player when it is within this radius. */
  RADIUS: 2.4,
  /** Distance at which the orb is collected. */
  COLLECT: 0.8,
  /** Points per orb. */
  VALUE: 5,
  /** How fast the orb slides toward the player while magnetised. */
  PULL_SPEED: 7,
  /** Visual-only: how high the orb floats and how fast it bobs. */
  BOB_H: 0.55,
  BOB_HZ: 2.4,
} as const;
