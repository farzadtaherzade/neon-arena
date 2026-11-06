import { DIFFICULTY_IDS, type DifficultyId } from '../game/config';
import { loadVersioned, saveVersioned } from './versionedStore';

const KEY = 'neon.record';
/**
 * v1 = the bare `{ score, wave }` blob. v2 = that blob inside the `{ v, data }`
 * envelope (never shipped in a release). v3 = one record per difficulty.
 * v4 = a top-5 runs list per difficulty.
 */
const SCHEMA_VERSION = 4;
const TOP_N = 5;

export interface RunRecord {
  score: number;
  wave: number;
}

export type AllRecords = Record<DifficultyId, RunRecord[]>;

const zero = (): RunRecord[] => [];

function sanitizeList(raw: unknown): RunRecord[] {
  if (!Array.isArray(raw)) return [];
  const list = raw
    .filter(
      (one): one is Record<string, unknown> =>
        one !== null && typeof one === 'object' && typeof (one as Record<string, unknown>).score === 'number',
    )
    .map((one) => ({
      score: Math.max(0, Math.round((one as Record<string, unknown>).score as number)),
      wave: typeof one.wave === 'number' && one.wave >= 0 ? Math.round(one.wave) : 0,
    }));
  // Highest score first, best five.
  return list.sort((a, b) => b.score - a.score).slice(0, TOP_N);
}

/** Per-field validation: junk, negatives and missing difficulties become empty. */
export function sanitizeRecords(raw: unknown): AllRecords {
  const out = { easy: zero(), normal: zero(), hard: zero() } as AllRecords;
  if (raw === null || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const d of DIFFICULTY_IDS) {
    out[d] = sanitizeList(r[d]);
  }
  return out;
}

/** v1/v2 held a single `{ score, wave }` pair — there was no knob yet, so it
 *  was set on normal, which is where it lands (as a one-entry list). v3 held
 *  one pair per difficulty — each grows into a list. */
function migrate(data: unknown, fromVersion: number): unknown {
  if (fromVersion >= 4 || data === null || typeof data !== 'object') return data;
  const o = data as Record<string, unknown>;
  const one = { score: o.score, wave: o.wave };
  const out: Record<string, unknown> = {};
  for (const d of DIFFICULTY_IDS) {
    if (fromVersion === 3) {
      out[d] = [o[d]].filter((x) => x !== undefined);
    } else {
      out[d] = d === 'normal' && typeof one.score === 'number' ? [one] : [];
    }
  }
  return out;
}

export function readRecords(): AllRecords {
  return loadVersioned(localStorage, KEY, SCHEMA_VERSION, sanitizeRecords, migrate) ?? sanitizeRecords(null);
}

/** The difficulty's best run — the menu's BEST line. */
export function readRecord(d: DifficultyId): RunRecord {
  return readRecords()[d][0] ?? { score: 0, wave: 0 };
}

/** Insert a finished run into its difficulty's top-5. Rank is 1-based; null
 *  when the run did not place. */
export function updateRecord(run: RunRecord, d: DifficultyId): { rank: number | null; isNewBest: boolean } {
  const all = readRecords();
  const list = all[d];
  const isNewBest = run.score > (list[0]?.score ?? 0);
  const merged = [...list, run].sort((a, b) => b.score - a.score).slice(0, TOP_N);
  const rank = merged.findIndex((r) => r === run || (r.score === run.score && r.wave === run.wave));
  saveVersioned(localStorage, KEY, SCHEMA_VERSION, { ...all, [d]: merged });
  return { rank: rank >= 0 ? rank + 1 : null, isNewBest };
}
