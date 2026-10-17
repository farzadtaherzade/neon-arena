const KEY = 'neon.record';

export interface RunRecord {
  score: number;
  wave: number;
}

export function readRecord(): RunRecord {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { score: 0, wave: 0 };
    const r = JSON.parse(raw);
    return {
      score: typeof r?.score === 'number' ? r.score : 0,
      wave: typeof r?.wave === 'number' ? r.wave : 0,
    };
  } catch {
    return { score: 0, wave: 0 };
  }
}

export function updateRecord(run: RunRecord): { record: RunRecord; isNew: boolean } {
  const best = readRecord();
  const isNew = run.score > best.score;
  const next = {
    score: Math.max(best.score, run.score),
    wave: Math.max(best.wave, run.wave),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Local storage might be blocked or full
  }
  return { record: next, isNew };
}
