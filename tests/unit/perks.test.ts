import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { PERK_DEFS, PERKS } from '../../src/game/config';
import { Perks } from '../../src/game/perks';

/** The level-up reward bank: offers are distinct, capped, and pay out. */
describe('Perks', () => {
  const rng = new Rng(7);

  it('offers the tuned number of distinct perks', () => {
    const perks = new Perks();
    const offer = perks.makeOffer(rng);
    expect(offer).toHaveLength(PERKS.OFFER_COUNT);
    expect(new Set(offer).size).toBe(offer.length);
  });

  it('never offers a perk past its stack cap', () => {
    const perks = new Perks();
    // Max out overclock, then keep making offers: it must never reappear.
    perks.makeOffer(rng);
    while (perks.count('overclock') < PERKS.STACK_MAX) perks.take('overclock');
    for (let i = 0; i < 20; i++) {
      const offer = perks.makeOffer(rng);
      expect(offer).not.toContain('overclock');
    }
  });

  it('shrinks the offer as the pool drains, and clears the offer on take', () => {
    const perks = new Perks();
    // Every perk maxed: no offer at all.
    for (const def of PERK_DEFS) {
      perks.makeOffer(rng);
      while (perks.count(def.id) < PERKS.STACK_MAX) perks.take(def.id);
    }
    expect(perks.makeOffer(rng)).toHaveLength(0);
    expect(perks.isOffering).toBe(false);
  });

  it('takes only what the cap allows', () => {
    const perks = new Perks();
    perks.take('overclock');
    perks.take('overclock');
    perks.take('overclock');
    expect(perks.count('overclock')).toBe(PERKS.STACK_MAX);
  });

  it('multiplies exactly per stack, and resets clean', () => {
    const perks = new Perks();
    perks.take('overclock');
    expect(perks.moveMul).toBeCloseTo(1 + PERKS.MOVE_SPEED, 10);
    perks.take('overclock');
    expect(perks.moveMul).toBeCloseTo(1 + 2 * PERKS.MOVE_SPEED, 10);

    perks.take('lightmag');
    expect(perks.reloadMul).toBeCloseTo(1 - PERKS.RELOAD_CUT, 10);
    perks.take('plating');
    expect(perks.maxHpBonus).toBe(PERKS.MAX_HP_BONUS);
    perks.take('adrenaline');
    expect(perks.staminaRegenMul).toBeCloseTo(1 + PERKS.STAMINA_REGEN, 10);
    perks.take('heavy');
    expect(perks.damageMul).toBeCloseTo(1 + PERKS.DAMAGE, 10);
    perks.take('magnet');
    expect(perks.xpRadiusMul).toBeCloseTo(1 + PERKS.XP_RADIUS, 10);
    perks.take('coolant');
    expect(perks.bloomMul).toBeCloseTo(1 - PERKS.BLOOM_CUT, 10);
    perks.take('scavenger');
    expect(perks.ammoDropMul).toBeCloseTo(1 + PERKS.AMMO_DROP, 10);

    perks.reset();
    expect(perks.moveMul).toBe(1);
    expect(perks.maxHpBonus).toBe(0);
    expect(perks.countsSnapshot()).toEqual(Object.fromEntries(PERK_DEFS.map((d) => [d.id, 0])));
  });
});
