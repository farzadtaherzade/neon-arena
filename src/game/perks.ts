import type { Rng } from '../core/rng';
import { PERK_DEFS, PERKS, type PerkId } from './config';

/**
 * The perks a run has banked, and what they multiply.
 *
 * Pure — it holds counts and turns them into multipliers; `Game` applies them
 * where each effect lives (player speed, the weapon's timers, the XP magnet).
 * One offer is outstanding at a time: `Game` pauses the run behind it and
 * calls `take()` with the player's pick.
 */
export class Perks {
  private counts = new Map<PerkId, number>();
  /** The live offer; empty while the run is playing normally. */
  offer: PerkId[] = [];

  reset(): void {
    this.counts.clear();
    this.offer.length = 0;
  }

  /** How many stacks of a perk this run owns. */
  count(id: PerkId): number {
    return this.counts.get(id) ?? 0;
  }

  /** The whole bank as a plain object — the headless test API reads this. */
  countsSnapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const def of PERK_DEFS) out[def.id] = this.count(def.id);
    return out;
  }

  /** Is any offer on the table right now? */
  get isOffering(): boolean {
    return this.offer.length > 0;
  }

  /**
   * Build the next offer: `OFFER_COUNT` distinct perks the player may still
   * stack. A pool that shrank below the offer size (late game, everything
   * maxed) offers what is left; an empty pool offers nothing.
   */
  makeOffer(rng: Rng): readonly PerkId[] {
    const pool = PERK_DEFS.map((d) => d.id).filter((id) => this.count(id) < PERKS.STACK_MAX);
    const offer: PerkId[] = [];
    while (offer.length < PERKS.OFFER_COUNT && pool.length > 0) {
      const i = Math.floor(rng.next() * pool.length);
      const pick = pool.splice(i, 1)[0];
      if (pick) offer.push(pick);
    }
    this.offer = offer;
    return offer;
  }

  /** Bank the player's pick. The offer clears; the next level makes a new one. */
  take(id: PerkId): void {
    this.counts.set(id, Math.min(this.count(id) + 1, PERKS.STACK_MAX));
    this.offer.length = 0;
  }

  // ------------------------------------------------------------- multipliers

  get moveMul(): number {
    return 1 + this.count('overclock') * PERKS.MOVE_SPEED;
  }

  get reloadMul(): number {
    return 1 - this.count('lightmag') * PERKS.RELOAD_CUT;
  }

  get maxHpBonus(): number {
    return this.count('plating') * PERKS.MAX_HP_BONUS;
  }

  get staminaRegenMul(): number {
    return 1 + this.count('adrenaline') * PERKS.STAMINA_REGEN;
  }

  get damageMul(): number {
    return 1 + this.count('heavy') * PERKS.DAMAGE;
  }

  get xpRadiusMul(): number {
    return 1 + this.count('magnet') * PERKS.XP_RADIUS;
  }

  get bloomMul(): number {
    return 1 - this.count('coolant') * PERKS.BLOOM_CUT;
  }

  get ammoDropMul(): number {
    return 1 + this.count('scavenger') * PERKS.AMMO_DROP;
  }
}
