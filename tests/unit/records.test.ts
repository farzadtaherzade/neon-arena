import { describe, expect, it } from 'vitest';
import { readRecords, updateRecord } from '../../src/ui/Records';

function fakeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    raw: map,
    // Records writes through `localStorage` directly; this shim swaps the
    // global for the duration of a test.
  };
}

/** Point `localStorage` at a fake for one test. */
function withStore<T>(initial: Record<string, string>, fn: () => T): T {
  const store = fakeStore(initial);
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const shim = { getItem: store.getItem, setItem: store.setItem, clear: () => {}, removeItem: () => {} };
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true });
  try {
    return fn();
  } finally {
    if (real) Object.defineProperty(globalThis, 'localStorage', real);
  }
}

describe('Records (per difficulty)', () => {
  it('reads a fresh store as all empty lists', () => {
    withStore({}, () => {
      const all = readRecords();
      expect(all.normal).toEqual([]);
      expect(all.hard).toEqual([]);
    });
  });

  it('migrates the v1 bare blob into normal, not everywhere', () => {
    withStore({ 'neon.record': '{"score":4200,"wave":11}' }, () => {
      const all = readRecords();
      expect(all.normal).toEqual([{ score: 4200, wave: 11 }]);
      expect(all.easy).toEqual([]);
      expect(all.hard).toEqual([]);
      // A read never writes back: storage keeps the bare blob until the next
      // updateRecord, which stamps it v4.
      expect(JSON.parse(localStorage.getItem('neon.record')!)).toEqual({ score: 4200, wave: 11 });
      updateRecord({ score: 4200, wave: 11 }, 'normal');
      expect(JSON.parse(localStorage.getItem('neon.record')!).v).toBe(4);
    });
  });

  it('keeps a top-5 list per difficulty, difficulties isolated', () => {
    withStore({}, () => {
      updateRecord({ score: 900, wave: 4 }, 'easy');
      updateRecord({ score: 900, wave: 4 }, 'hard');
      for (const score of [300, 700, 500, 100, 600, 200]) {
        updateRecord({ score, wave: 1 }, 'normal');
      }
      const all = readRecords();
      expect(all.easy.map((r) => r.score)).toEqual([900]);
      expect(all.normal.map((r) => r.score)).toEqual([700, 600, 500, 300, 200]);
      expect(all.hard.map((r) => r.score)).toEqual([900]);
    });
  });

  it('reports NEW BEST and rank within its own difficulty', () => {
    withStore({}, () => {
      expect(updateRecord({ score: 500, wave: 3 }, 'normal')).toMatchObject({ isNewBest: true, rank: 1 });
      expect(updateRecord({ score: 100, wave: 1 }, 'normal').isNewBest).toBe(false);
      expect(updateRecord({ score: 100, wave: 1 }, 'hard').isNewBest).toBe(true);
      // Same score, later run: a tie with #1 — not a new best. (Its rank is
      // ambiguous: identical entries are indistinguishable in the list.)
      expect(updateRecord({ score: 500, wave: 3 }, 'normal').isNewBest).toBe(false);
    });
  });

  it('survives corrupt storage', () => {
    withStore({ 'neon.record': '{oops' }, () => {
      expect(readRecords().normal).toEqual([]);
    });
  });
});
