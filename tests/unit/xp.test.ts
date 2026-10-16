import { describe, expect, it } from 'vitest';
import { XP, Xp } from '../../src/game/xp';

describe('Xp', () => {
  it('does nothing while the player is outside the magnet radius', () => {
    const xp = new Xp(10, 10, XP.VALUE);
    const moved = xp.update(0.1, { x: 0, z: 0 });
    expect(moved).toBe(false);
    expect(xp.pos.x).toBeCloseTo(10);
    expect(xp.pos.z).toBeCloseTo(10);
  });

  it('pulls the orb toward the player inside the magnet radius', () => {
    const xp = new Xp(2, 0, XP.VALUE);
    xp.update(0.1, { x: 0, z: 0 });
    expect(xp.pos.x).toBeLessThan(2);
    expect(xp.pos.x).toBeGreaterThan(0);
  });

  it('collects when the player is at close range', () => {
    const xp = new Xp(0.2, 0, XP.VALUE);
    expect(xp.update(0.1, { x: 0, z: 0 })).toBe(true);
  });
});
