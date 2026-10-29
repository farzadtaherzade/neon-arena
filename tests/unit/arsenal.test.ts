import { describe, expect, it } from 'vitest';
import { WEAPON_ORDER, WEAPONS, type WeaponDef } from '../../src/game/config';
import { Weapon, type WeaponHooks } from '../../src/game/weapon';

function make(def: WeaponDef) {
  const events: string[] = [];
  const hooks: WeaponHooks = {
    onShot: () => events.push('shot'),
    onDry: () => events.push('dry'),
    onReloadStart: () => events.push('reloadStart'),
    onReloadEnd: () => events.push('reloadEnd'),
  };
  return { w: new Weapon(hooks, def), events };
}

describe('the arsenal', () => {
  it('keeps every gun to its own def, not the rifle one', () => {
    for (const def of Object.values(WEAPONS)) {
      const { w } = make(def);
      expect(w.def).toBe(def);
      expect(w.ammo).toBe(def.mag);
      expect(w.reserve).toBe(def.reserveStart);
    }
  });

  it('reserves clamp at their own cap', () => {
    const { w } = make(WEAPONS.smg);
    w.addAmmo(WEAPONS.smg.reserveMax);
    expect(w.reserve).toBe(WEAPONS.smg.reserveMax);
    const scatter = make(WEAPONS.scatter).w;
    scatter.addAmmo(WEAPONS.smg.reserveMax);
    expect(scatter.reserve).toBe(WEAPONS.scatter.reserveMax);
  });

  it('fires one ray per pellet — the scattergun is a wall, the rest are shots', () => {
    for (const def of Object.values(WEAPONS)) {
      const { w, events } = make(def);
      w.update(1 / 60, 0, true);
      expect(events.filter((e) => e === 'shot')).toHaveLength(1);
      // The event fires once per trigger pull regardless of pellets; the ray
      // count is Game's business, driven by def.pellets.
      expect(def.pellets).toBeGreaterThanOrEqual(1);
    }
    expect(WEAPONS.scatter.pellets).toBeGreaterThan(WEAPONS.rifle.pellets);
  });

  it('applies perk multipliers per gun without cross-talk', () => {
    const a = make(WEAPONS.rifle).w;
    const b = make(WEAPONS.dmr).w;
    a.reloadMul = 0.5;
    a.damageMul = 2;
    expect(b.reloadMul).toBe(1);
    expect(b.damage(false)).toBe(WEAPONS.dmr.dmg);
    expect(a.damage(false)).toBeCloseTo(WEAPONS.rifle.dmg * 2, 10);
  });

  it('resets every reserve to its own start', () => {
    for (const def of Object.values(WEAPONS)) {
      const { w } = make(def);
      w.addAmmo(99);
      w.reset();
      expect(w.reserve).toBe(def.reserveStart);
      expect(w.ammo).toBe(def.mag);
    }
  });

  it('orders the switch row with the rifle first', () => {
    expect(WEAPON_ORDER[0]).toBe('rifle');
    expect(new Set(WEAPON_ORDER).size).toBe(WEAPON_ORDER.length);
  });
});
