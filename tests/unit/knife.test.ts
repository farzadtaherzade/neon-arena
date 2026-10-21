import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { ENEMY, ENEMY_TYPES, KNIFE } from '../../src/game/config';
import { Enemy } from '../../src/game/enemy';
import { Knife } from '../../src/game/knife';

function spawn(kind: keyof typeof ENEMY_TYPES, x: number, z: number, y = 0): Enemy {
  const e = new Enemy(kind, x, z, new Rng(5));
  e.pos.y = y;
  return e;
}

describe('Knife', () => {
  it('starts ready and goes on cooldown after a swing', () => {
    const k = new Knife();
    expect(k.ready).toBe(true);
    k.swing(0, 0, 0, 0, [], []);
    expect(k.ready).toBe(false);
    expect(k.swingT).toBe(KNIFE.SWING_T);
    k.update(KNIFE.COOLDOWN);
    expect(k.ready).toBe(true);
  });

  it('cuts a mob straight ahead', () => {
    const k = new Knife();
    // The player looks down -z at yaw 0, so a mob at z = -2 is in front.
    const grunt = spawn('grunt', 0, -2);
    const out: Enemy[] = [];
    expect(k.swing(0, 0, 0, 0, [grunt], out)).toBe(1);
    expect(out).toEqual([grunt]);
  });

  it('misses a mob behind the player', () => {
    const k = new Knife();
    const grunt = spawn('grunt', 0, 2);
    const out: Enemy[] = [];
    expect(k.swing(0, 0, 0, 0, [grunt], out)).toBe(0);
    expect(out).toHaveLength(0);
  });

  it('misses a mob outside the reach', () => {
    const k = new Knife();
    const far = spawn('grunt', 0, -(KNIFE.RANGE + 1));
    const out: Enemy[] = [];
    expect(k.swing(0, 0, 0, 0, [far], out)).toBe(0);
  });

  it('reaches a big mob further out than a small one', () => {
    const k = new Knife();
    const out: Enemy[] = [];
    const d = KNIFE.RANGE + ENEMY.COLLIDE_RADIUS * ENEMY_TYPES.tank.scale - 0.1;
    expect(k.swing(0, 0, 0, 0, [spawn('tank', 0, -d)], out)).toBe(1);
  });

  it('misses a mob that is out of the arc', () => {
    const k = new Knife();
    // The half arc is 1.9 rad, so a mob 2.2 rad off-axis is behind the shoulder.
    const side = spawn('grunt', Math.sin(2.2) * 2, -Math.cos(2.2) * 2);
    const out: Enemy[] = [];
    expect(k.swing(0, 0, 0, 0, [side], out)).toBe(0);
  });

  it('misses a mob under a deck', () => {
    const k = new Knife();
    const below = spawn('grunt', 0, -1, -(KNIFE.VREACH + 0.5));
    const out: Enemy[] = [];
    expect(k.swing(0, 0, 0, 0, [below], out)).toBe(0);
  });

  it('ignores a mob that is already dying', () => {
    const k = new Knife();
    const dead = spawn('grunt', 0, -2);
    dead.kill();
    const out: Enemy[] = [];
    expect(k.swing(0, 0, 0, 0, [dead], out)).toBe(0);
  });

  it('hits every mob in the arc, and reuses the output array', () => {
    const k = new Knife();
    const out: Enemy[] = [];
    const a = spawn('grunt', -0.5, -1.5);
    const b = spawn('grunt', 0.5, -1.5);
    expect(k.swing(0, 0, 0, 0, [a, b], out)).toBe(2);
    expect(out).toHaveLength(2);
    expect(k.swing(0, 0, 0, 0, [a, b], out)).toBe(0); // on cooldown
    expect(out).toHaveLength(0);
  });

  it('swings to the side the player is facing', () => {
    const k = new Knife();
    // At yaw -PI/2 the player looks down +x, so a mob at x = 2 is in front.
    const out: Enemy[] = [];
    expect(k.swing(0, 0, 0, -Math.PI / 2, [spawn('grunt', 2, 0)], out)).toBe(1);
  });
});
