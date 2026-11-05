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
  it('reads a fresh store as all zeros', () => {
    withStore({}, () => {
      const all = readRecords();
      expect(all.normal).toEqual({ score: 0, wave: 0 });
      expect(all.hard).toEqual({ score: 0, wave: 0 });
    });
  });

  it('migrates the v1 bare blob into normal, not everywhere', () => {
    withStore({ 'neon.record': '{"score":4200,"wave":11}' }, () => {
      const all = readRecords();
      expect(all.normal).toEqual({ score: 4200, wave: 11 });
      expect(all.easy).toEqual({ score: 0, wave: 0 });
      expect(all.hard).toEqual({ score: 0, wave: 0 });
      // A read never writes back: storage keeps the bare blob until the next
      // updateRecord, which stamps it v3.
      expect(JSON.parse(localStorage.getItem('neon.record')!)).toEqual({ score: 4200, wave: 11 });
      updateRecord({ score: 4200, wave: 11 }, 'normal');
      expect(JSON.parse(localStorage.getItem('neon.record')!).v).toBe(3);
    });
  });

  it('keeps difficulties isolated', () => {
    withStore({}, () => {
      updateRecord({ score: 900, wave: 4 }, 'easy');
      updateRecord({ score: 900, wave: 4 }, 'hard');
      const all = readRecords();
      expect(all.easy.score).toBe(900);
      expect(all.hard.score).toBe(900);
      expect(all.normal.score).toBe(0);
    });
  });

  it('reports NEW BEST only within its own difficulty', () => {
    withStore({}, () => {
      expect(updateRecord({ score: 500, wave: 3 }, 'normal').isNew).toBe(true);
      expect(updateRecord({ score: 100, wave: 1 }, 'normal').isNew).toBe(false);
      expect(updateRecord({ score: 100, wave: 1 }, 'hard').isNew).toBe(true);
    });
  });

  it('survives corrupt storage', () => {
    withStore({ 'neon.record': '{oops' }, () => {
      expect(readRecords().normal).toEqual({ score: 0, wave: 0 });
    });
  });
});
