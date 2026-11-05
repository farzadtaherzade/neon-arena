import { DIFFICULTY_IDS, type DifficultyId } from '../game/config';
import { loadVersioned, saveVersioned } from './versionedStore';

const KEY = 'neon.record';
/**
 * v1 = the bare `{ score, wave }` blob. v2 = that blob inside the `{ v, data }`
 * envelope (never shipped in a release). v3 = one record per difficulty.
 */
const SCHEMA_VERSION = 3;

export interface RunRecord {
  score: number;
  wave: number;
}

export type AllRecords = Record<DifficultyId, RunRecord>;

const zero = (): RunRecord => ({ score: 0, wave: 0 });

/** Per-field validation: junk, negatives and missing difficulties become zeros. */
export function sanitizeRecords(raw: unknown): AllRecords {
  const out = { easy: zero(), normal: zero(), hard: zero() } as AllRecords;
  if (raw === null || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const d of DIFFICULTY_IDS) {
    const one = r[d];
    if (one === null || typeof one !== 'object') continue;
    const rec = one as Record<string, unknown>;
    out[d] = {
      score: typeof rec.score === 'number' && rec.score >= 0 ? rec.score : 0,
      wave: typeof rec.wave === 'number' && rec.wave >= 0 ? rec.wave : 0,
    };
  }
  return out;
}

/** v1/v2 held a single `{ score, wave }` pair — there was no knob yet, so it
 *  was set on normal, which is where it lands. */
function migrate(data: unknown, fromVersion: number): unknown {
  if (fromVersion >= 3 || data === null || typeof data !== 'object') return data;
  const o = data as Record<string, unknown>;
  const legacy = {
    score: typeof o.score === 'number' && o.score >= 0 ? o.score : 0,
    wave: typeof o.wave === 'number' && o.wave >= 0 ? o.wave : 0,
  };
  return { easy: zero(), normal: legacy, hard: zero() };
}

export function readRecords(): AllRecords {
  return loadVersioned(localStorage, KEY, SCHEMA_VERSION, sanitizeRecords, migrate) ?? sanitizeRecords(null);
}

export function readRecord(d: DifficultyId): RunRecord {
  return readRecords()[d];
}

export function updateRecord(run: RunRecord, d: DifficultyId): { record: RunRecord; isNew: boolean } {
  const all = readRecords();
  const best = all[d];
  const isNew = run.score > best.score;
  const next = {
    score: Math.max(best.score, run.score),
    wave: Math.max(best.wave, run.wave),
  };
  saveVersioned(localStorage, KEY, SCHEMA_VERSION, { ...all, [d]: next });
  return { record: next, isNew };
}
