import { describe, expect, it } from 'vitest';
import { CRAWL } from '../../src/game/config';
import { buildChunk, chunkOf, chunkRegion, isDistrict, loadedBounds } from '../../src/game/world/chunks';
import { PLATFORM_H } from '../../src/game/world/layout';

const SEED = 20261101;

/** Every cover block of a chunk, including the district compound. */
function blocks(cx: number, cz: number, seed: number): (readonly [number, number, number, number, number])[] {
  const t = buildChunk(cx, cz, seed);
  return [...t.cover, ...(t.district?.compound ?? [])];
}

describe('chunk generation', () => {
  it('is deterministic: same coords and seed, same tables', () => {
    for (const [cx, cz] of [
      [1, 0],
      [-3, 2],
      [7, -7],
    ]) {
      const a = buildChunk(cx, cz, SEED);
      const b = buildChunk(cx, cz, SEED);
      expect(a).toEqual(b);
    }
    // A different seed generates different ground.
    const other = buildChunk(1, 0, SEED + 1);
    expect(buildChunk(1, 0, SEED)).not.toEqual(other);
  });

  it('contributes nothing at the origin — the authored arena stands alone', () => {
    const t = buildChunk(0, 0, SEED);
    expect(t.cover).toHaveLength(0);
    expect(t.district).toBeUndefined();
  });

  it('keeps the outer lanes of every chunk clear of cover', () => {
    const half = CRAWL.CHUNK / 2;
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) {
        for (const [x, z, w, , d] of blocks(cx, cz, SEED)) {
          // The footprint must stay CRAWL.DECK_CLEAR inside the chunk edge.
          expect(x - w / 2, `${cx},${cz} west edge`).toBeGreaterThanOrEqual(
            cx * CRAWL.CHUNK - half + CRAWL.DECK_CLEAR - 0.001,
          );
          expect(x + w / 2).toBeLessThanOrEqual(cx * CRAWL.CHUNK + half - CRAWL.DECK_CLEAR + 0.001);
          expect(z - d / 2).toBeGreaterThanOrEqual(cz * CRAWL.CHUNK - half + CRAWL.DECK_CLEAR - 0.001);
          expect(z + d / 2).toBeLessThanOrEqual(cz * CRAWL.CHUNK + half - CRAWL.DECK_CLEAR + 0.001);
        }
      }
    }
  });

  it('never overlaps two cover blocks in the same chunk', () => {
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) {
        const list = blocks(cx, cz, SEED);
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i];
            const b = list[j];
            if (!a || !b) continue;
            const [ax, az, aw, , ad] = a;
            const [bx, bz, bw, , bd] = b;
            const apart = Math.abs(ax - bx) >= (aw + bw) / 2 || Math.abs(az - bz) >= (ad + bd) / 2;
            expect(apart, `${cx},${cz} blocks ${i}/${j}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('deck districts', () => {
  it('appear at the seeded rate away from the origin', () => {
    let count = 0;
    let total = 0;
    for (let cx = -8; cx <= 8; cx++) {
      for (let cz = -8; cz <= 8; cz++) {
        if (cx === 0 && cz === 0) continue;
        total++;
        if (isDistrict(cx, cz, SEED)) count++;
      }
    }
    // ~1 in DISTRICT_ONE_IN, with slack for small-sample noise.
    const rate = count / total;
    expect(rate).toBeGreaterThan(0.08);
    expect(rate).toBeLessThan(0.32);
  });

  it('lands every district ramp exactly on its deck face', () => {
    for (let cx = -8; cx <= 8; cx++) {
      for (let cz = -8; cz <= 8; cz++) {
        const t = buildChunk(cx, cz, SEED);
        if (!t.district) continue;
        const { deck, ramp } = t.district;
        // The ramp's high edge must coincide with the deck face it serves.
        const faceX = deck.x - ramp.upX * 3.5;
        const faceZ = deck.z - ramp.upZ * 3.5;
        const highX = ramp.upX > 0 ? ramp.x + 3 : ramp.upX < 0 ? ramp.x - 3 : ramp.x;
        const highZ = ramp.upZ > 0 ? ramp.z + 3 : ramp.upZ < 0 ? ramp.z - 3 : ramp.z;
        expect(highX).toBeCloseTo(faceX, 6);
        expect(highZ).toBeCloseTo(faceZ, 6);
        expect(Math.abs(ramp.upX) + Math.abs(ramp.upZ)).toBe(1);
        // The high edge sits at deck height by construction.
        expect(Math.hypot(deck.x - ramp.x, deck.z - ramp.z)).toBeCloseTo(6.5, 6);
      }
    }
    // The authored contract this mirrors, as a sanity anchor.
    expect(PLATFORM_H).toBe(2.4);
  });

  it('keeps the compound clear of the deck and of the border lanes', () => {
    for (let cx = -8; cx <= 8; cx++) {
      for (let cz = -8; cz <= 8; cz++) {
        const t = buildChunk(cx, cz, SEED);
        if (!t.district) continue;
        const { deck, ramp, compound } = t.district;
        for (const [x, z, w, h, d] of compound) {
          expect(h).toBeGreaterThan(PLATFORM_H); // the ring is tall, a wall not a step
          // Not on the deck, not on the ramp approach.
          const onDeck = Math.abs(x - deck.x) < 3.5 + w / 2 && Math.abs(z - deck.z) < 3.5 + d / 2;
          expect(onDeck).toBe(false);
          const onRamp = Math.abs(x - ramp.x) < 2.2 + w / 2 + 1 && Math.abs(z - ramp.z) < 3 + d / 2 + 1;
          expect(onRamp).toBe(false);
        }
      }
    }
  });
});

describe('chunk addressing', () => {
  it('maps world coordinates to chunks', () => {
    expect(chunkOf(0, 14)).toEqual({ cx: 0, cz: 0 });
    expect(chunkOf(84, -1)).toEqual({ cx: 1, cz: -1 });
    expect(chunkOf(-84, -84)).toEqual({ cx: -1, cz: -1 });
  });

  it('gives every chunk a distinct, positive region id', () => {
    const seen = new Set<number>();
    for (let cx = -20; cx <= 20; cx++) {
      for (let cz = -20; cz <= 20; cz++) {
        const r = chunkRegion(cx, cz);
        expect(r).toBeGreaterThan(0);
        expect(seen.has(r)).toBe(false);
        seen.add(r);
      }
    }
  });

  it('clamps the player to the loaded square with an inset', () => {
    const b = loadedBounds(0, 0);
    expect(b.minX).toBe(-CRAWL.VIEW_RADIUS * CRAWL.CHUNK + CRAWL.CLAMP_INSET);
    expect(b.maxX).toBe(CRAWL.VIEW_RADIUS * CRAWL.CHUNK - CRAWL.CLAMP_INSET);
    // A chunk away, the window moves with it.
    const far = loadedBounds(3, -2);
    expect(far.minX).toBe(3 * CRAWL.CHUNK - CRAWL.VIEW_RADIUS * CRAWL.CHUNK + CRAWL.CLAMP_INSET);
    expect(far.maxZ).toBe(-2 * CRAWL.CHUNK + CRAWL.VIEW_RADIUS * CRAWL.CHUNK - CRAWL.CLAMP_INSET);
  });
});
