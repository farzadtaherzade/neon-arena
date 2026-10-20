import { describe, expect, it } from 'vitest';
import { XP, Xp, XpMeter, xpNeeded } from '../../src/game/xp';

describe('Xp', () => {
  it('does nothing while the player is outside the magnet radius', () => {
    const xp = new Xp(10, 10, XP.VALUE.grunt);
    const moved = xp.update(0.1, { x: 0, z: 0 });
    expect(moved).toBe(false);
    expect(xp.pos.x).toBeCloseTo(10);
    expect(xp.pos.z).toBeCloseTo(10);
  });

  it('pulls the orb toward the player inside the magnet radius', () => {
    const xp = new Xp(2, 0, XP.VALUE.grunt);
    xp.update(0.1, { x: 0, z: 0 });
    expect(xp.pos.x).toBeLessThan(2);
    expect(xp.pos.x).toBeGreaterThan(0);
  });

  it('collects when the player is at close range', () => {
    const xp = new Xp(0.2, 0, XP.VALUE.grunt);
    expect(xp.update(0.1, { x: 0, z: 0 })).toBe(true);
  });
});

describe('xpNeeded', () => {
  it('grows by the configured factor', () => {
    expect(xpNeeded(1)).toBe(60);
    expect(xpNeeded(2)).toBe(78);
    expect(xpNeeded(3)).toBe(101);
  });

  it('always asks for more than the level below it', () => {
    for (let level = 1; level < 20; level++) {
      expect(xpNeeded(level + 1)).toBeGreaterThan(xpNeeded(level));
    }
  });
});

describe('XpMeter', () => {
  it('starts at level 1 with no xp', () => {
    const meter = new XpMeter();
    expect(meter.level).toBe(1);
    expect(meter.xp).toBe(0);
    expect(meter.need).toBe(xpNeeded(1));
  });

  it('levels up exactly on the threshold', () => {
    const meter = new XpMeter();
    expect(meter.add(59)).toBe(false);
    expect(meter.level).toBe(1);
    expect(meter.add(1)).toBe(true);
    expect(meter.level).toBe(2);
    expect(meter.xp).toBe(0);
    expect(meter.need).toBe(xpNeeded(2));
  });

  it('chains several levels from one big pickup', () => {
    const meter = new XpMeter();
    // 60 (level 2) + 78 (level 3) = 138 to reach level 3.
    expect(meter.add(138)).toBe(true);
    expect(meter.level).toBe(3);
    expect(meter.xp).toBe(0);
  });

  it('keeps the remainder after a level-up', () => {
    const meter = new XpMeter();
    meter.add(70);
    expect(meter.level).toBe(2);
    expect(meter.xp).toBe(10);
  });

  it('resets to the starting level', () => {
    const meter = new XpMeter();
    meter.add(200);
    meter.reset();
    expect(meter.level).toBe(1);
    expect(meter.xp).toBe(0);
  });
});
