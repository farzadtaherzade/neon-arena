import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { FX } from '../../src/game/config';
import { ParticlePool, TracerPool } from '../../src/game/fx';

const BURST = { x: 0, y: 1, z: 0, color: 0x46e0ff, count: 32, speed: 4, life: 1, gravity: 9 };

describe('ParticlePool', () => {
  it('emits particles at the burst origin and counts them live', () => {
    const p = new ParticlePool();
    expect(p.live).toBe(0);
    p.burst(BURST, new Rng(1));
    expect(p.live).toBe(BURST.count);
    // The cursor advances before writing, so a fresh pool's first particle is slot 1.
    for (let k = 1; k <= BURST.count; k++) {
      expect(p.pos[k * 3]).toBeCloseTo(0, 10);
      expect(p.pos[k * 3 + 1]).toBeCloseTo(1, 10);
    }
  });

  it('converts the hex colour to the base rgb triple', () => {
    const p = new ParticlePool();
    p.burst({ ...BURST, count: 1 }, new Rng(1));
    p.update(1 / 600);
    // The cursor advances before writing, so the first particle of a fresh pool is slot 1.
    expect(p.col[3 + 2]).toBeCloseTo(1, 2); // 0xff / 255
    expect(p.col[3 + 1]).toBeCloseTo(0.878, 2); // 0xe0 / 255
    expect(p.col[3 + 0]).toBeCloseTo(0.275, 2); // 0x46 / 255
  });

  it('pulls particles down and settles them on the floor', () => {
    const p = new ParticlePool();
    p.burst({ ...BURST, count: 8, life: 8, gravity: 20 }, new Rng(2));
    for (let i = 0; i < 120; i++) p.update(1 / 60);
    for (let k = 1; k <= 8; k++) {
      expect(p.pos[k * 3 + 1]).toBeCloseTo(0.03, 5);
    }
  });

  it('expires particles, parks them and reclaims the live count', () => {
    const p = new ParticlePool();
    p.burst({ ...BURST, count: 10, life: 0.2 }, new Rng(3));
    expect(p.live).toBe(10);
    for (let i = 0; i < 40; i++) p.update(1 / 60); // 0.66s > every particle's span
    expect(p.live).toBe(0);
    for (let k = 0; k < 10; k++) {
      expect(p.pos[k * 3 + 1]).toBe(-999);
      expect(p.col[k * 3]).toBe(0);
    }
  });

  it('fades colour towards zero as life runs out', () => {
    const p = new ParticlePool();
    p.burst({ ...BURST, count: 1, life: 1 }, new Rng(4));
    p.update(1 / 60);
    const early = p.col[5]; // slot 1, blue channel
    for (let i = 0; i < 40; i++) p.update(1 / 60);
    expect(p.col[5]).toBeLessThan(early);
  });

  it('wraps the cursor instead of growing past the pool', () => {
    const p = new ParticlePool();
    for (let i = 0; i < 100; i++) p.burst(BURST, new Rng(i)); // 3200 requested, pool holds 2200
    expect(p.pos).toHaveLength(FX.PARTICLE_MAX * 3);
    p.update(1 / 60);
    // `live` is only a skip hint between bursts; a step re-derives the true count.
    expect(p.live).toBeLessThanOrEqual(FX.PARTICLE_MAX);
    expect(p.live).toBeGreaterThan(0);
  });

  it('clears everything', () => {
    const p = new ParticlePool();
    p.burst(BURST, new Rng(5));
    p.clear();
    expect(p.live).toBe(0);
  });
});

describe('TracerPool', () => {
  it('is a fixed ring that never allocates past its size', () => {
    const t = new TracerPool();
    expect(t.items).toHaveLength(FX.TRACER_MAX);
    for (let i = 0; i < FX.TRACER_MAX + 10; i++) t.fire({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    expect(t.items).toHaveLength(FX.TRACER_MAX);
    expect(t.items.filter((i) => i.life > 0)).toHaveLength(FX.TRACER_MAX);
  });

  it('stores the two endpoints and fades out', () => {
    const t = new TracerPool();
    t.fire({ x: 1, y: 2, z: 3 }, { x: -4, y: 5, z: -6 });
    const live = t.items.find((i) => i.life > 0);
    expect(live?.ax).toBe(1);
    expect(live?.by).toBe(5);
    expect(live?.bz).toBe(-6);
    for (let i = 0; i < 200; i++) t.update(1 / 60);
    expect(t.items.every((i) => i.life === 0)).toBe(true);
  });

  it('clears', () => {
    const t = new TracerPool();
    t.fire({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    t.clear();
    expect(t.items.every((i) => i.life === 0)).toBe(true);
  });
});
