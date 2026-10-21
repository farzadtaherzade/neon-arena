import { describe, expect, it } from 'vitest';
import {
  CROSSHAIR_DEFAULTS,
  GAME_DEFAULTS,
  readSettings,
  sanitizeAll,
  sanitizeCrosshair,
  sanitizeGame,
  sanitizeVideo,
  VIDEO_DEFAULTS,
  writeSettings,
} from '../../src/ui/Settings';

/** Minimal localStorage stand-in so this suite needs no jsdom. */
function fakeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    raw: map,
  };
}

describe('sanitizeCrosshair', () => {
  it('falls back to the defaults for junk', () => {
    expect(sanitizeCrosshair(null)).toEqual(CROSSHAIR_DEFAULTS);
    expect(sanitizeCrosshair(undefined)).toEqual(CROSSHAIR_DEFAULTS);
    expect(sanitizeCrosshair('nonsense')).toEqual(CROSSHAIR_DEFAULTS);
    expect(sanitizeCrosshair(42)).toEqual(CROSSHAIR_DEFAULTS);
  });

  it('clamps numbers into range', () => {
    const s = sanitizeCrosshair({ lineLen: 999, gap: -50, dotSize: 0, shapeSize: 1000 });
    expect(s.lineLen).toBe(30);
    expect(s.gap).toBe(0);
    expect(s.dotSize).toBe(1);
    expect(s.shapeSize).toBe(80);
  });

  it('keeps a valid colour and rejects a bad one', () => {
    expect(sanitizeCrosshair({ color: '#ABCDEF' }).color).toBe('#ABCDEF');
    expect(sanitizeCrosshair({ color: 'red' }).color).toBe(CROSSHAIR_DEFAULTS.color);
    expect(sanitizeCrosshair({ outlineColor: '#12345' }).outlineColor).toBe(CROSSHAIR_DEFAULTS.outlineColor);
  });

  it('only accepts booleans for toggles and known shapes', () => {
    const s = sanitizeCrosshair({ lines: 'yes', dot: false, outline: 1, shape: 'star' });
    expect(s.lines).toBe(CROSSHAIR_DEFAULTS.lines); // string is not a boolean
    expect(s.dot).toBe(false);
    expect(s.outline).toBe(CROSSHAIR_DEFAULTS.outline);
    expect(s.shape).toBe('none');
    expect(sanitizeCrosshair({ shape: 'triangle' }).shape).toBe('triangle');
  });

  it('ignores unknown keys', () => {
    const s = sanitizeCrosshair({ nonsense: 1, gap: 4 }) as unknown as Record<string, unknown>;
    expect(s.nonsense).toBeUndefined();
    expect(s.gap).toBe(4);
  });
});

describe('sanitizeGame', () => {
  it('falls back to the defaults for junk', () => {
    expect(sanitizeGame(null)).toEqual(GAME_DEFAULTS);
    expect(sanitizeGame('nope')).toEqual(GAME_DEFAULTS);
  });

  it('clamps the sensitivity and the field of view', () => {
    expect(sanitizeGame({ sensitivity: 99 }).sensitivity).toBe(5);
    expect(sanitizeGame({ sensitivity: 0 }).sensitivity).toBe(0.1);
    expect(sanitizeGame({ fov: 5 }).fov).toBe(60);
    expect(sanitizeGame({ fov: 500 }).fov).toBe(110);
  });

  it('accepts every sensitivity alias', () => {
    for (const key of ['sensitivity', 'mouseSensitivity', 'mouseSens', 'lookSensitivity']) {
      expect(sanitizeGame({ [key]: 2 }).sensitivity).toBe(2);
    }
  });

  it('only accepts booleans for the toggles', () => {
    expect(sanitizeGame({ invertY: true }).invertY).toBe(true);
    expect(sanitizeGame({ invertY: 'yes' }).invertY).toBe(false);
    expect(sanitizeGame({ mute: 1 }).mute).toBe(false);
  });
});

describe('sanitizeVideo', () => {
  it('falls back to the defaults for junk', () => {
    expect(sanitizeVideo(null)).toEqual(VIDEO_DEFAULTS);
  });

  it('clamps the quality to the available levels', () => {
    expect(sanitizeVideo({ quality: -3 }).quality).toBe(0);
    expect(sanitizeVideo({ quality: 99 }).quality).toBe(2);
    expect(sanitizeVideo({ quality: 1 }).quality).toBe(1);
  });

  it('only accepts booleans for the toggles', () => {
    expect(sanitizeVideo({ shadows: false }).shadows).toBe(false);
    expect(sanitizeVideo({ shadows: 'no' }).shadows).toBe(true);
    expect(sanitizeVideo({ fog: 0 }).fog).toBe(true);
  });
});

describe('sanitizeAll', () => {
  it('fills every group from junk', () => {
    expect(sanitizeAll(null)).toEqual({
      crosshair: CROSSHAIR_DEFAULTS,
      game: GAME_DEFAULTS,
      video: VIDEO_DEFAULTS,
    });
  });

  it('keeps each group separate', () => {
    const all = sanitizeAll({
      crosshair: { shape: 'circle' },
      game: { sensitivity: 2 },
      video: { quality: 0 },
    });
    expect(all.crosshair.shape).toBe('circle');
    expect(all.game.sensitivity).toBe(2);
    expect(all.video.quality).toBe(0);
    // A crosshair change must not leak into the game group.
    expect(all.game.fov).toBe(GAME_DEFAULTS.fov);
  });
});

describe('persistence', () => {
  it('round-trips through storage', () => {
    const store = fakeStore();
    const values = sanitizeAll({
      crosshair: { shape: 'diamond', color: '#ff3b4e', gap: 12 },
      game: { sensitivity: 1.5, invertY: true },
      video: { quality: 1, fog: false },
    });
    writeSettings(store, values);
    expect(readSettings(store)).toEqual(values);
  });

  it('migrates the old flat crosshair blob', () => {
    const store = fakeStore({
      'neon.crosshair': JSON.stringify({ shape: 'triangle', color: '#3dffa0', sensitivity: 2, mute: true }),
    });
    const values = readSettings(store);
    expect(values.crosshair.shape).toBe('triangle');
    expect(values.crosshair.color).toBe('#3dffa0');
    expect(values.game.sensitivity).toBe(2);
    expect(values.game.mute).toBe(true);
  });

  it('survives corrupt storage', () => {
    expect(readSettings(fakeStore({ 'neon.settings': '{not json' }))).toEqual(sanitizeAll({}));
    expect(readSettings(fakeStore({ 'neon.settings': '[1,2,3]' }))).toEqual(sanitizeAll({}));
    expect(readSettings(fakeStore())).toEqual(sanitizeAll({}));
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
    expect(readSettings(hostile)).toEqual(sanitizeAll({}));
    expect(() => writeSettings(hostile, sanitizeAll({}))).not.toThrow();
  });
});
