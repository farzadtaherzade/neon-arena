import { beforeEach, describe, expect, it } from 'vitest';
import { AMMO, WEAPON } from '../../src/game/config';
import { Weapon, type WeaponHooks } from '../../src/game/weapon';

function makeWeapon() {
  const events: string[] = [];
  const hooks: WeaponHooks = {
    onShot: () => events.push('shot'),
    onDry: () => events.push('dry'),
    onReloadStart: () => events.push('reloadStart'),
    onReloadEnd: () => events.push('reloadEnd'),
  };
  return { w: new Weapon(hooks), events };
}

describe('Weapon', () => {
  let w: Weapon;
  let events: string[];

  beforeEach(() => {
    ({ w, events } = makeWeapon());
  });

  it('respects the fire rate', () => {
    const t = 0;
    w.update(1 / 60, t, true);
    expect(w.ammo).toBe(WEAPON.MAG - 1);

    // Half the interval later the gun is still cooling down.
    w.update(1 / 60, t + WEAPON.FIRE_T / 2, true);
    expect(w.ammo).toBe(WEAPON.MAG - 1);

    w.update(1 / 60, t + WEAPON.FIRE_T, true);
    expect(w.ammo).toBe(WEAPON.MAG - 2);
    expect(events.filter((e) => e === 'shot')).toHaveLength(2);
  });

  it('empties the magazine, then auto-reloads, then dry-fires', () => {
    let t = 0;
    // Hold the trigger until the magazine runs dry and the reload kicks in.
    for (let i = 0; i < 400 && !w.reloading; i++) {
      t += 1 / 60;
      w.update(1 / 60, t, true);
    }
    expect(w.ammo).toBe(0);
    expect(w.reloading).toBe(true);
    expect(events).toContain('reloadStart');

    // Let the reload finish.
    for (let i = 0; i < 200 && w.reloading; i++) {
      t += 1 / 60;
      w.update(1 / 60, t, false);
    }
    expect(w.ammo).toBe(WEAPON.MAG);
    expect(w.reloading).toBe(false);
    expect(events).toContain('reloadEnd');

    // Defensive branch: an empty magazine with no reload running dry-fires and reloads.
    w.ammo = 0;
    w.reloading = false;
    w.update(1 / 60, t + WEAPON.FIRE_T, true);
    expect(events).toContain('dry');
    expect(w.reloading).toBe(true);
  });

  it('ignores the trigger while reloading', () => {
    w.ammo = 3;
    w.startReload();
    const before = w.ammo;
    for (let i = 0; i < 10; i++) w.update(1 / 60, i / 60, true);
    expect(w.ammo).toBe(before);
  });

  it('refuses a manual reload when the magazine is full', () => {
    w.startReload();
    expect(w.reloading).toBe(false);
    expect(events).not.toContain('reloadStart');
  });

  it('reports reload progress 0..1', () => {
    w.ammo = 1;
    w.startReload();
    expect(w.reloadProgress).toBeCloseTo(0, 6);
    for (let i = 0; i < Math.floor((WEAPON.RELOAD_T * 60) / 2); i++) w.update(1 / 60, 0, false);
    expect(w.reloadProgress).toBeGreaterThan(0.4);
    expect(w.reloadProgress).toBeLessThan(0.6);
    for (let i = 0; i < 120; i++) w.update(1 / 60, 0, false);
    expect(w.reloadProgress).toBeLessThanOrEqual(1);
  });

  it('grows bloom per shot, clamps it, and lets it decay', () => {
    expect(w.spread).toBeCloseTo(WEAPON.BASE_SPREAD, 10);
    let t = 0;
    for (let i = 0; i < 40; i++) {
      t += 1 / 60 + 0.01;
      w.update(1 / 60, t, true);
    }
    expect(w.bloom).toBeLessThanOrEqual(WEAPON.BLOOM_MAX + 1e-9);
    expect(w.recoil).toBeLessThanOrEqual(WEAPON.RECOIL_MAX + 1e-9);
    expect(w.kick).toBeLessThanOrEqual(WEAPON.KICK_MAX + 1e-9);
    expect(w.spread).toBeCloseTo(WEAPON.BASE_SPREAD + w.bloom, 10);

    const peak = w.bloom;
    for (let i = 0; i < 120; i++) {
      t += 1 / 60;
      w.update(1 / 60, t, false);
    }
    expect(w.bloom).toBeLessThan(peak);
    expect(w.bloom).toBeLessThan(peak * 0.01); // two seconds of decay is effectively nothing
  });

  it('expires the muzzle flash', () => {
    // The shot sets FLASH_T and the same step's decay already eats one frame.
    w.update(1 / 60, 0, true);
    expect(w.flashT).toBeCloseTo(WEAPON.FLASH_T - 1 / 60, 10);
    for (let i = 0; i < 10; i++) w.update(1 / 60, i / 60, false);
    expect(w.flashT).toBe(0);
  });

  it('pays out headshot damage', () => {
    expect(w.damage(false)).toBe(WEAPON.DMG);
    expect(w.damage(true)).toBeCloseTo(WEAPON.DMG * WEAPON.HEAD_MULT, 10);
  });

  it('resets to a clean state', () => {
    w.update(1 / 60, 0, true);
    w.startReload();
    w.reset();
    expect(w.ammo).toBe(WEAPON.MAG);
    expect(w.reserve).toBe(AMMO.RESERVE_START);
    expect(w.reloading).toBe(false);
    expect(w.bloom).toBe(0);
    expect(w.flashT).toBe(0);
  });

  it('reloads out of the reserve', () => {
    w.ammo = 2;
    w.reserve = 30;
    w.startReload();
    expect(w.reloading).toBe(true);
    for (let i = 0; i < 120 && w.reloading; i++) w.update(1 / 60, 0, false);
    expect(w.ammo).toBe(WEAPON.MAG);
    expect(w.reserve).toBe(30 - (WEAPON.MAG - 2));
  });

  it('cannot reload with an empty reserve', () => {
    w.ammo = 2;
    w.reserve = 0;
    w.startReload();
    expect(w.reloading).toBe(false);
  });

  it('goes dry when the magazine and the reserve are both empty', () => {
    w.ammo = 0;
    w.reserve = 0;
    expect(w.isDry).toBe(true);
    w.update(1 / 60, 0, true);
    expect(events).toContain('dry');
    expect(w.ammo).toBe(0);
  });

  it('is not dry while there is still a round in the magazine', () => {
    w.ammo = 1;
    w.reserve = 0;
    expect(w.isDry).toBe(false);
  });

  it('clicks at most once every DRY_CLICK_T', () => {
    w.ammo = 0;
    w.reserve = 0;
    w.reloading = false;
    let t = 0;
    for (let i = 0; i < 10; i++) {
      t += 1 / 60;
      w.update(1 / 60, t, true);
    }
    expect(events.filter((e) => e === 'dry')).toHaveLength(1);
    w.update(1 / 60, t + WEAPON.DRY_CLICK_T, true);
    expect(events.filter((e) => e === 'dry')).toHaveLength(2);
  });

  it('picks up ammo and clamps it at the reserve maximum', () => {
    w.reserve = 0;
    w.addAmmo(4);
    expect(w.reserve).toBe(4);
    w.addAmmo(1000);
    expect(w.reserve).toBe(AMMO.RESERVE_MAX);
  });
});
