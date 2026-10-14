import { describe, expect, it } from 'vitest';
import { DEFAULTS, readSettings, sanitizeSettings, writeSettings } from '../../src/ui/Settings';

/** Minimal localStorage stand-in so this suite needs no jsdom. */
function fakeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    raw: map,
  };
}

describe('sanitizeSettings', () => {
  it('falls back to the defaults for junk', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULTS);
    expect(sanitizeSettings(undefined)).toEqual(DEFAULTS);
    expect(sanitizeSettings('nonsense')).toEqual(DEFAULTS);
    expect(sanitizeSettings(42)).toEqual(DEFAULTS);
  });

  it('clamps numbers into range', () => {
    const s = sanitizeSettings({ lineLen: 999, gap: -50, dotSize: 0, shapeSize: 1000 });
    expect(s.lineLen).toBe(30);
    expect(s.gap).toBe(0);
    expect(s.dotSize).toBe(1);
    expect(s.shapeSize).toBe(80);
  });

  it('keeps a valid colour and rejects a bad one', () => {
    expect(sanitizeSettings({ color: '#ABCDEF' }).color).toBe('#ABCDEF');
    expect(sanitizeSettings({ color: 'red' }).color).toBe(DEFAULTS.color);
    expect(sanitizeSettings({ outlineColor: '#12345' }).outlineColor).toBe(DEFAULTS.outlineColor);
  });

  it('only accepts booleans for toggles and known shapes', () => {
    const s = sanitizeSettings({ lines: 'yes', dot: false, outline: 1, shape: 'star' });
    expect(s.lines).toBe(DEFAULTS.lines); // string is not a boolean → keep the default
    expect(s.dot).toBe(false);
    expect(s.outline).toBe(DEFAULTS.outline);
    expect(s.shape).toBe('none');
    expect(sanitizeSettings({ shape: 'triangle' }).shape).toBe('triangle');
  });

  it('ignores unknown keys', () => {
    const s = sanitizeSettings({ nonsense: 1, gap: 4 }) as unknown as Record<string, unknown>;
    expect(s.nonsense).toBeUndefined();
    expect(s.gap).toBe(4);
  });
});

describe('persistence', () => {
  it('round-trips through storage', () => {
    const store = fakeStore();
    const values = { ...DEFAULTS, shape: 'diamond' as const, color: '#ff3b4e', gap: 12 };
    writeSettings(store, values);
    expect(readSettings(store)).toEqual(values);
  });

  it('survives corrupt storage', () => {
    expect(readSettings(fakeStore({ 'neon.crosshair': '{not json' }))).toEqual(DEFAULTS);
    expect(readSettings(fakeStore({ 'neon.crosshair': '[1,2,3]' }))).toEqual(DEFAULTS);
    expect(readSettings(fakeStore())).toEqual(DEFAULTS);
  });

  it('survives storage that throws (private mode)', () => {
    const hostile = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readSettings(hostile)).toEqual(DEFAULTS);
    expect(() => writeSettings(hostile, DEFAULTS)).not.toThrow();
  });
});
