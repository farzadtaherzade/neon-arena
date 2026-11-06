import { DIFFICULTIES, type DifficultyId, ENEMY_KINDS, type EnemyKind } from '../game/config';
import type { CareerStats } from './Profile';
import type { AllRecords } from './Records';

const KIND_NAMES: Record<EnemyKind, string> = {
  grunt: 'GRUNTS',
  runner: 'RUNNERS',
  tank: 'TANKS',
  sapper: 'SAPPERS',
  warden: 'WARDENS',
  creeper: 'CREEPERS',
  witch: 'WITCHES',
  blinker: 'BLINKERS',
  colossus: 'COLOSSUS',
};

/**
 * The career/records screen: the top-5 runs for the picked difficulty plus the
 * wallet-adjacent career counters. Opened from the menu; it reads what it is
 * handed and renders — no state of its own.
 */
export class Career {
  private root = document.getElementById('careerScreen');
  private table = document.getElementById('careerRuns');
  private lines = document.getElementById('careerStats');

  constructor() {
    document.getElementById('careerClose')?.addEventListener('click', () => this.hide());
  }

  show(stats: CareerStats, records: AllRecords, difficulty: DifficultyId): void {
    if (!this.root || !this.table || !this.lines) return;

    const runs = records[difficulty];
    this.table.replaceChildren(
      ...(runs.length > 0
        ? runs.map((run, i) => {
            const row = document.createElement('div');
            row.className = 'crow';
            const rank = document.createElement('span');
            rank.className = 'crank';
            rank.textContent = `#${i + 1}`;
            const score = document.createElement('span');
            score.className = 'cscore';
            score.textContent = String(run.score);
            const wave = document.createElement('span');
            wave.className = 'cwave';
            wave.textContent = `WAVE ${run.wave}`;
            row.append(rank, score, wave);
            return row;
          })
        : [emptyRow('NO RUNS YET — GO GET SOME')]),
    );

    const totalKills = ENEMY_KINDS.reduce((sum: number, kind) => sum + (stats.kills[kind] ?? 0), 0);
    const accuracy = stats.shots > 0 ? Math.round((stats.hits / stats.shots) * 100) : 0;
    const minutes = Math.round(stats.secondsPlayed / 60);
    const lines: [string, string][] = [
      ['DIFFICULTY', DIFFICULTIES[difficulty].name],
      ['RUNS DEPLOYED', String(stats.runs)],
      ['TOTAL KILLS', String(totalKills)],
      ...ENEMY_KINDS.map((kind): [string, string] => [KIND_NAMES[kind], String(stats.kills[kind] ?? 0)]),
      ['ACCURACY', `${accuracy}%`],
      ['BEST WAVE', stats.bestWave > 0 ? String(stats.bestWave) : '—'],
      ['TIME IN ARENA', `${minutes} MIN`],
    ];
    this.lines.replaceChildren(
      ...lines.map(([k, v]) => {
        const row = document.createElement('div');
        row.className = 'crow';
        const key = document.createElement('span');
        key.className = 'ckey';
        key.textContent = k;
        const val = document.createElement('span');
        val.className = 'cval';
        val.textContent = v;
        row.append(key, val);
        return row;
      }),
    );

    this.root.classList.add('visible');
  }

  hide(): void {
    this.root?.classList.remove('visible');
  }
}

function emptyRow(text: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'crow empty';
  row.textContent = text;
  return row;
}
