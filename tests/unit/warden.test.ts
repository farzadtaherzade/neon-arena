import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { BOSS, TANK } from '../../src/game/config';
import { Enemy, type EnemyWorld } from '../../src/game/enemy';

/** A world mock that records what the mob asks of it. */
function makeWorld(px = 0, pz = 0, playerY = 0) {
  const events = {
    bombs: [] as { x: number; z: number; thrown: boolean; heavy: boolean }[],
    damage: [] as number[],
    knocks: 0,
  };
  const world: EnemyWorld = {
    playerPos: { x: px, z: pz },
    playerY,
    neighbours: [],
    hostileCount: 1,
    collide: () => {},
    support: (_x, _z, _r, ceiling) => Math.min(0, ceiling),
    ramps: [],
    damagePlayer: (amount) => events.damage.push(amount),
    knockPlayer: () => {
      events.knocks++;
    },
    plantBomb: (_from, to, thrown, heavy) =>
      events.bombs.push({ x: to.x, z: to.z, thrown, heavy: heavy ?? false }),
  };
  return { world, events };
}

/** Step the mob for `seconds` of fixed ticks. */
function run(enemy: Enemy, world: EnemyWorld, seconds: number): void {
  const dt = 1 / 60;
  for (let i = 0; i < seconds / dt; i++) enemy.update(dt, world);
}

describe('the warden', () => {
  it('keeps the player inside its distance band', () => {
    const { world } = makeWorld(0, 0);
    const boss = new Enemy('warden', 20, 0, new Rng(3));
    run(boss, world, 8);
    const dist = Math.hypot(boss.pos.x, boss.pos.z);
    expect(dist).toBeLessThan(BOSS.KEEP_MAX + 2.5);
    expect(dist).toBeGreaterThan(BOSS.KEEP_MIN - 2.5);
  });

  it('lobs a rocket volley after the tell, then reloads', () => {
    const { world, events } = makeWorld(0, 0);
    const boss = new Enemy('warden', 14, 0, new Rng(5));
    // Nothing before the first volley is due, not even during the approach.
    run(boss, world, BOSS.FIRST_VOLLEY);
    expect(events.bombs).toHaveLength(0);
    // The tell runs, then the rockets walk a ring around the player.
    run(boss, world, BOSS.VOLLEY_TELL + 0.2);
    expect(events.bombs).toHaveLength(BOSS.VOLLEY_ROCKETS);
    for (const bomb of events.bombs) {
      expect(bomb.thrown).toBe(true);
      expect(bomb.heavy).toBe(true);
      expect(Math.hypot(bomb.x, bomb.z)).toBeGreaterThan(BOSS.ROCKET_SPREAD - 0.5);
    }
    // Reload, tell again, second volley.
    run(boss, world, BOSS.VOLLEY_T + BOSS.VOLLEY_TELL + 0.2);
    expect(events.bombs).toHaveLength(BOSS.VOLLEY_ROCKETS * 2);
  });

  it('slams like a tank when something gets under its feet', () => {
    const { world, events } = makeWorld(1.5, 0);
    const boss = new Enemy('warden', 0, 0, new Rng(9));
    run(boss, world, 4);
    expect(events.damage.length).toBeGreaterThan(0);
    // The slam hits harder than its swipe would, and shoves.
    expect(events.damage[0]).toBeCloseTo(boss.stats.dmg * TANK.SLAM_MULT, 5);
    expect(events.knocks).toBeGreaterThan(0);
  });

  it('shells a deck the same as it shells the floor', () => {
    const { world, events } = makeWorld(0, 0, 2.4);
    const boss = new Enemy('warden', 14, 0, new Rng(11));
    run(boss, world, BOSS.FIRST_VOLLEY + BOSS.VOLLEY_TELL + 0.3);
    expect(events.bombs.length).toBe(BOSS.VOLLEY_ROCKETS);
  });

  it('takes rifle damage with no plate to hide behind', () => {
    const boss = new Enemy('warden', 10, 0, new Rng(13));
    const from = { dirX: 0, dirZ: 1, headshot: false, melee: false };
    boss.takeDamage(10, from);
    expect(boss.hp).toBe(boss.stats.maxHp - 10);
  });
});
