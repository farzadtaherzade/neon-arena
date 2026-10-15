import { describe, expect, it } from 'vitest';
import { Bomb } from '../../src/game/bomb';
import { BOMB } from '../../src/game/config';

describe('Bomb', () => {
  it('places itself and starts with a full fuse', () => {
    const b = new Bomb(3, -4);
    expect(b.pos).toEqual({ x: 3, y: 0, z: -4 });
    expect(b.fuse).toBe(BOMB.FUSE);
    expect(b.radius).toBe(BOMB.RADIUS);
    expect(b.k).toBe(0);
  });

  it('detonates once, after roughly its fuse', () => {
    const b = new Bomb(0, 0);
    const step = 1 / 60;
    const expected = BOMB.FUSE / step;

    let born = -1;
    for (let i = 0; i < 1000 && born < 0; i++) if (b.update(step)) born = i;

    expect(born).toBeGreaterThanOrEqual(Math.floor(expected) - 1);
    expect(born).toBeLessThanOrEqual(Math.ceil(expected) + 1);
    expect(b.k).toBe(1);
    expect(b.update(step)).toBe(false); // spent: never a second time
  });

  it('cannot detonate once it has been defused', () => {
    const b = new Bomb(0, 0);
    b.defuse();
    expect(b.update(10)).toBe(false);
  });
});
