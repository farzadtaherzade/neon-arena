import { describe, expect, it } from 'vitest';
import { SKINS } from '../../src/game/config';
import { defaultProfile, findSkin, Profile, readProfile, writeProfile } from '../../src/ui/Profile';

/** Minimal localStorage stand-in so this suite needs no jsdom. */
function fakeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    raw: map,
  };
}

const CHEAPEST = SKINS[0];
const NEXT = SKINS[1];

describe('readProfile', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(readProfile(fakeStore())).toEqual(defaultProfile());
  });

  it('round-trips a profile', () => {
    const store = fakeStore();
    const data = { credits: 120, unlocked: [CHEAPEST.id], equipped: { rifle: CHEAPEST.id, knife: '' } };
    writeProfile(store, data);
    expect(readProfile(store)).toEqual(data);
  });

  it('survives corrupt storage', () => {
    expect(readProfile(fakeStore({ 'neon.profile': '{not json' }))).toEqual(defaultProfile());
    expect(readProfile(fakeStore({ 'neon.profile': '[1,2,3]' }))).toEqual(defaultProfile());
  });

  it('drops ids it does not know and a negative wallet', () => {
    const store = fakeStore({
      'neon.profile': JSON.stringify({
        credits: -50,
        unlocked: [CHEAPEST.id, 'not-a-skin'],
        equipped: { rifle: 'not-a-skin', knife: CHEAPEST.id },
      }),
    });
    const p = readProfile(store);
    expect(p.credits).toBe(0);
    expect(p.unlocked).toEqual([CHEAPEST.id]);
    expect(p.equipped.rifle).toBe('');
    expect(p.equipped.knife).toBe(CHEAPEST.id);
  });

  it('does not throw when the store itself throws', () => {
    const hostile = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readProfile(hostile)).toEqual(defaultProfile());
  });
});

describe('Profile', () => {
  it('banks credits and ignores empty ones', () => {
    const p = new Profile(fakeStore());
    p.addCredits(30);
    p.addCredits(0);
    p.addCredits(-10);
    expect(p.data.credits).toBe(30);
  });

  it('buys a skin it can afford and refuses the rest', () => {
    const p = new Profile(fakeStore());
    expect(p.buy('not-a-skin')).toBe(false);
    expect(p.buy(CHEAPEST.id)).toBe(false); // no credits yet

    p.addCredits(CHEAPEST.price);
    expect(p.buy(CHEAPEST.id)).toBe(true);
    expect(p.data.credits).toBe(0);
    expect(p.owns(CHEAPEST.id)).toBe(true);

    expect(p.buy(CHEAPEST.id)).toBe(false); // already owned
  });

  it('equips an owned skin on its own slot', () => {
    const p = new Profile(fakeStore());
    p.addCredits(10_000);
    for (const skin of SKINS) p.buy(skin.id);

    expect(p.equip('not-a-skin')).toBe(false);
    expect(p.equip(CHEAPEST.id)).toBe(true);
    expect(p.data.equipped.rifle).toBe(CHEAPEST.id);
    expect(p.data.equipped.knife).toBe('');

    const knife = SKINS.find((s) => s.weapon === 'knife');
    expect(knife).toBeDefined();
    p.equip(knife?.id ?? '');
    expect(p.data.equipped.knife).toBe(knife?.id);
  });

  it('will not equip a skin it does not own', () => {
    const p = new Profile(fakeStore());
    expect(p.equip(CHEAPEST.id)).toBe(false);
  });

  it('reports the equipped skin, and null for the standard issue', () => {
    const p = new Profile(fakeStore());
    expect(p.equippedSkin('rifle')).toBeNull();
    p.addCredits(10_000);
    p.buy(NEXT.id);
    p.equip(NEXT.id);
    // The knife sits in its own slot; the rifle is still the standard issue.
    expect(p.equippedSkin('knife')?.id).toBe(NEXT.id);
    expect(p.equippedSkin('rifle')).toBeNull();
  });

  it('persists through a reload', () => {
    const store = fakeStore();
    const p = new Profile(store);
    p.addCredits(500);
    p.buy(CHEAPEST.id);
    p.equip(CHEAPEST.id);

    const reloaded = new Profile(store);
    expect(reloaded.data.credits).toBe(500 - CHEAPEST.price);
    expect(reloaded.owns(CHEAPEST.id)).toBe(true);
    expect(reloaded.equippedSkin('rifle')?.id).toBe(CHEAPEST.id);
  });
});

describe('findSkin', () => {
  it('looks a skin up by id', () => {
    expect(findSkin(CHEAPEST.id)?.id).toBe(CHEAPEST.id);
    expect(findSkin('nope')).toBeNull();
  });
});
