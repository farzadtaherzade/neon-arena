import { describe, expect, it } from 'vitest';
import { loadVersioned, saveVersioned } from '../../src/ui/versionedStore';

function fakeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    raw: map,
  };
}

const sanitize = (raw: unknown): { name: string } => {
  const o = (raw ?? {}) as Record<string, unknown>;
  return { name: typeof o.name === 'string' ? o.name : 'default' };
};

describe('versionedStore', () => {
  it('round-trips through the envelope', () => {
    const store = fakeStore();
    saveVersioned(store, 'k', 2, { name: 'saved' });
    expect(JSON.parse(store.raw.get('k')!)).toEqual({ v: 2, data: { name: 'saved' } });
    expect(loadVersioned(store, 'k', 2, sanitize)).toEqual({ name: 'saved' });
  });

  it('treats a bare payload as v1 data and sanitizes it', () => {
    const store = fakeStore({ k: '{"name":"legacy"}' });
    expect(loadVersioned(store, 'k', 2, sanitize)).toEqual({ name: 'legacy' });
  });

  it('returns null for absent, corrupt or non-object payloads', () => {
    const store = fakeStore({ a: '{not json', b: '42', c: '"str"' });
    expect(loadVersioned(store, 'a', 2, sanitize)).toBeNull();
    expect(loadVersioned(store, 'b', 2, sanitize)).toBeNull();
    expect(loadVersioned(store, 'c', 2, sanitize)).toBeNull();
    expect(loadVersioned(store, 'missing', 2, sanitize)).toBeNull();
  });

  it('reads a future version best-effort but never writes back', () => {
    const future = JSON.stringify({ v: 99, data: { name: 'from-the-future' } });
    const store = fakeStore({ k: future });
    // A newer build's payload is still readable through this build's sanitiser...
    expect(loadVersioned(store, 'k', 2, sanitize)).toEqual({ name: 'from-the-future' });
    // ...and this build must not downgrade what storage holds.
    expect(store.raw.get('k')).toBe(future);
  });

  it('sanitizes the inner data, not the envelope', () => {
    const store = fakeStore({ k: JSON.stringify({ v: 2, data: { junk: true } }) });
    expect(loadVersioned(store, 'k', 2, sanitize)).toEqual({ name: 'default' });
  });
});
