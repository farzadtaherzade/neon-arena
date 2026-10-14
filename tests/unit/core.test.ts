import { describe, expect, it } from 'vitest';
import { FixedLoop } from '../../src/core/loop';
import { clamp, damp, dampFactor } from '../../src/core/math';
import { Rng } from '../../src/core/rng';

describe('Rng', () => {
  it('replays the same sequence for the same seed', () => {
    const x = new Rng(42);
    const y = new Rng(42);
    const seqX = Array.from({ length: 64 }, () => x.next());
    const seqY = Array.from({ length: 64 }, () => y.next());
    expect(seqX).toEqual(seqY);
  });

  it('diverges for different seeds', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('stays in [0,1) and spreads across the range', () => {
    const r = new Rng(7);
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      buckets[Math.floor(v * 10)] = (buckets[Math.floor(v * 10)] ?? 0) + 1;
    }
    // 2000 expected per bucket; 1200 is a loose bound that still catches a stuck generator.
    for (const n of buckets) expect(n).toBeGreaterThan(1200);
  });

  it('keeps range() and int() inside their bounds', () => {
    const r = new Rng(99);
    for (let i = 0; i < 2000; i++) {
      const f = r.range(-3, 5);
      expect(f).toBeGreaterThanOrEqual(-3);
      expect(f).toBeLessThan(5);
      const n = r.int(2, 6);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(6);
    }
  });
});

describe('math', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('dampFactor is the fraction closed over dt', () => {
    expect(dampFactor(0, 1)).toBe(0);
    // 63% of the way after one time constant.
    expect(dampFactor(1, 1)).toBeCloseTo(1 - Math.exp(-1), 10);
    // Splitting the same dt in two must land in the same place (frame-rate independence).
    const one = 0 + (1 - 0) * dampFactor(5, 0.2);
    const two =
      0 + (1 - 0) * dampFactor(5, 0.1) + (1 - (0 + (1 - 0) * dampFactor(5, 0.1))) * dampFactor(5, 0.1);
    expect(one).toBeCloseTo(two, 10);
    expect(damp(0, 1, 5, 0.2)).toBeCloseTo(one, 10);
  });
});

describe('FixedLoop', () => {
  it('runs one step per 60Hz frame', () => {
    const loop = new FixedLoop();
    for (let i = 0; i < 60; i++) expect(loop.advance(1 / 60).steps).toBe(1);
    expect(loop.pending).toBeLessThan(1 / 60);
  });

  it('keeps total simulated time over jittery frames', () => {
    const loop = new FixedLoop();
    let steps = 0;
    // Alternating 8ms / 40ms frames still add up to ~one step per 16.67ms.
    for (let i = 0; i < 100; i++) steps += loop.advance(i % 2 ? 0.04 : 0.008).steps;
    // 2.4s of wall clock = 144 steps, minus at most the one step still in the accumulator.
    expect(steps).toBeGreaterThanOrEqual(143);
    expect(steps).toBeLessThanOrEqual(144);
  });

  it('caps catch-up so a stalled tab cannot spiral', () => {
    const loop = new FixedLoop(1 / 60, 5);
    expect(loop.advance(10).steps).toBe(5);
    // Dropping the backlog keeps the next frame sane instead of running 600 steps.
    expect(loop.pending).toBe(0);
    expect(loop.advance(1 / 60).steps).toBe(1);
  });

  it('reports interpolation alpha for the renderer', () => {
    const loop = new FixedLoop(1 / 60);
    const half = loop.advance(1 / 120);
    expect(half.steps).toBe(0);
    expect(half.alpha).toBeCloseTo(0.5, 10);
    // A whole step later the backlog is spent and the renderer is at alpha 0.
    expect(loop.advance(1 / 120)).toMatchObject({ steps: 1, alpha: 0 });
  });
});
