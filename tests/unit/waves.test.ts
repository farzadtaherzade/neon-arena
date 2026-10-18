import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { ENEMY, SAPPER, WAVES } from '../../src/game/config';
import { composition, dmgBonus, speedScale, WaveDirector } from '../../src/game/waves';

const count = (list: string[], kind: string) => list.filter((k) => k === kind).length;

describe('composition', () => {
  it('is grunts only on wave 1', () => {
    expect(composition(1)).toEqual(Array(WAVES.GRUNTS_BASE + 1).fill('grunt'));
  });

  it('adds runners and tanks as the waves climb', () => {
    expect(composition(2).filter((k) => k === 'runner').length).toBeGreaterThan(0);
    expect(composition(2).some((k) => k === 'tank')).toBe(false);
    expect(composition(3).some((k) => k === 'tank')).toBe(true);
  });

  it('never exceeds the tank cap and always grows', () => {
    for (let n = 2; n <= 40; n++) {
      const list = composition(n);
      expect(count(list, 'tank')).toBeLessThanOrEqual(WAVES.MAX_TANKS);
      expect(list.length).toBeGreaterThan(composition(n - 1).length);
      expect(list.length).toBeGreaterThan(0);
    }
  });

  it('lists only real enemy kinds', () => {
    const kinds = new Set(composition(9));
    for (const k of kinds) expect(['grunt', 'runner', 'tank', 'sapper']).toContain(k);
  });

  it('adds sappers from wave 5, one more every five waves after', () => {
    expect(count(composition(SAPPER.START_WAVE - 1), 'sapper')).toBe(0);
    expect(count(composition(SAPPER.START_WAVE), 'sapper')).toBe(1);
    expect(count(composition(9), 'sapper')).toBe(1);
    expect(count(composition(10), 'sapper')).toBe(2);
    expect(count(composition(15), 'sapper')).toBe(3);
  });
});

describe('wave scaling', () => {
  it('raises speed up to a cap', () => {
    expect(speedScale(1)).toBe(1);
    expect(speedScale(5)).toBeGreaterThan(speedScale(2));
    expect(speedScale(100)).toBeLessThanOrEqual(WAVES.SPEED_MAX_SCALE);
  });

  it('adds damage every other wave', () => {
    expect(dmgBonus(1)).toBe(0);
    expect(dmgBonus(2)).toBe(0);
    expect(dmgBonus(3)).toBe(WAVES.DMG_PER_2_WAVES);
    expect(dmgBonus(9)).toBe(4 * WAVES.DMG_PER_2_WAVES);
  });
});

describe('WaveDirector', () => {
  const player = { x: 0, z: 0 };

  function makeDir() {
    const d = new WaveDirector();
    d.rng = new Rng(21);
    return d;
  }

  it('stagger-spawns a whole wave', () => {
    const d = makeDir();
    d.start(1);
    expect(d.hostileCount(0)).toBe(composition(1).length);

    let spawned = 0;
    for (let i = 0; i < 600; i++) spawned += d.update(1 / 60, player, spawned).spawned.length;
    expect(spawned).toBe(composition(1).length);
  });

  it('holds enemies off until the first delay expires', () => {
    const d = makeDir();
    d.start(1);
    expect(d.update(WAVES.FIRST_DELAY * 0.5, player, 0).spawned).toHaveLength(0);
    let spawned = 0;
    for (let i = 0; i < 600; i++) spawned += d.update(1 / 60, player, spawned).spawned.length;
    expect(spawned).toBe(composition(1).length);
  });

  it('spawns the testing wave without a wall-clock delay', () => {
    const d = makeDir();
    d.testing = true;
    d.start(1);
    expect(d.update(0, player, 0).spawned).toHaveLength(composition(1).length);
  });

  it('waits for the last enemy to die before reporting a clear', () => {
    const d = makeDir();
    d.start(1);
    let spawned = 0;
    for (let i = 0; i < 600; i++) spawned += d.update(1 / 60, player, spawned).spawned.length;

    // Everyone is still standing: the wave is not over, however empty the queue is.
    expect(d.hostileCount(0)).toBe(0);
    let clearedWhileAlive = false;
    for (let i = 0; i < 60; i++) if (d.update(1 / 60, player, 4).cleared) clearedWhileAlive = true;
    expect(clearedWhileAlive).toBe(false);
  });

  it('reports a clear, then starts the next wave', () => {
    const d = makeDir();
    d.start(1);
    let cleared = false;
    let advanced = false;
    for (let i = 0; i < 2000; i++) {
      const u = d.update(1 / 60, player, 0);
      if (u.cleared) cleared = true;
      if (cleared && d.wave === 2) {
        advanced = true;
        break;
      }
    }
    expect(cleared).toBe(true);
    expect(advanced).toBe(true);
    expect(d.hostileCount(0)).toBe(composition(2).length);
  });

  it('counts live enemies plus the ones still queued', () => {
    const d = makeDir();
    d.start(1);
    const queued = d.hostileCount(0);
    const spawned = d.update(1, player, 0).spawned.length; // one big step flushes the early ones
    expect(spawned).toBeGreaterThan(0);
    expect(d.hostileCount(0)).toBe(queued - spawned);
    expect(d.hostileCount(3)).toBe(queued - spawned + 3);
  });

  it('spawns on a ring far enough from the player', () => {
    const d = makeDir();
    for (let i = 0; i < 50; i++) {
      const spot = d.pickSpawn(player);
      const dist = Math.hypot(spot.x - player.x, spot.z - player.z);
      expect(dist).toBeGreaterThanOrEqual(ENEMY.SPAWN_MIN_DIST - 1e-6);
      expect(dist).toBeLessThanOrEqual(ENEMY.SPAWN_RING + ENEMY.SPAWN_RING_JITTER + 1e-6);
    }
  });

  it('spawns the test ring when testing', () => {
    const d = makeDir();
    d.testing = true;
    // Player well outside the ring, so the min-distance rejection never falls back.
    const spot = d.pickSpawn({ x: 0, z: -30 });
    const radius = Math.hypot(spot.x, spot.z);
    expect(radius).toBeGreaterThanOrEqual(ENEMY.TEST_SPAWN_RING);
    expect(radius).toBeLessThanOrEqual(ENEMY.TEST_SPAWN_RING + ENEMY.TEST_SPAWN_JITTER);
  });

  it('reuses its output array rather than allocating per step', () => {
    const d = makeDir();
    d.start(1);
    const first = d.update(1 / 60, player, 0);
    expect(d.update(1 / 60, player, 0)).toBe(first);
  });

  it('resets back to a blank slate', () => {
    const d = makeDir();
    d.start(4);
    d.update(1, player, 0);
    d.reset();
    expect(d.wave).toBe(0);
    expect(d.hostileCount(0)).toBe(0);
  });
});
