import { describe, expect, it } from 'vitest';
import { BOSS, CRAWL, DIRECTOR, ENEMY } from '../../src/game/config';
import {
  crawlDist,
  dmgBonus,
  distScale,
  PressureDirector,
  speedScale,
  type SpawnRequest,
} from '../../src/game/director';
import { Rng } from '../../src/core/rng';
import type { Vec2 } from '../../src/game/world/collision';

/** A director with the seed pinned and no geometry in the way. */
function make(): PressureDirector {
  const d = new PressureDirector();
  d.rng = new Rng(12345);
  return d;
}

const ORIGIN: Vec2 = { x: 0, z: 0 };

/** Step `seconds`, collecting spawns; `at` and `alive` may vary per step. */
function run(
  d: PressureDirector,
  seconds: number,
  opts: { at?: Vec2; alive?: number; walk?: number } = {},
): SpawnRequest[] {
  const all: SpawnRequest[] = [];
  const steps = Math.ceil(seconds / 0.1);
  for (let i = 0; i < steps; i++) {
    const at: Vec2 = opts.walk
      ? { x: ORIGIN.x, z: ORIGIN.z - i * opts.walk }
      : (opts.at ?? ORIGIN);
    all.push(...d.update(0.1, at, opts.alive ?? 0).spawned);
  }
  return all;
}

describe('pressure director — threat', () => {
  it('accumulates only under live pressure', () => {
    const d = make();
    d.testing = true;
    run(d, 1); // idle: queue drains instantly, nothing stands
    const idle = d.threat;
    d.forceThreat(2);
    const before = d.threat;
    run(d, 2, { alive: 3 }); // mobs standing: pressure is live
    expect(d.threat).toBeGreaterThan(before);
    expect(idle).toBeLessThan(1);
  });

  it('never falls below the crawl-distance floor', () => {
    const d = make();
    d.testing = true;
    run(d, 0.5, { at: { x: 2 * CRAWL.CHUNK, z: 0 } });
    expect(d.threat).toBeGreaterThanOrEqual(2 * DIRECTOR.DIST_TIER_GAIN - 0.01);
  });

  it('nudges on capture', () => {
    const d = make();
    const before = d.threat;
    d.nudge();
    expect(d.threat).toBeCloseTo(before + DIRECTOR.CAPTURE_NUDGE, 10);
  });
});

describe('pressure director — packs', () => {
  it('spawns at least one pack once pressure accrues', () => {
    const d = make();
    d.testing = true;
    const spawned = run(d, 4);
    expect(spawned.length).toBeGreaterThanOrEqual(DIRECTOR.PACK_MIN);
    expect(d.hostileCount(0)).toBe(0); // test pacing drains the queue
  });

  it('pays budget: a rich director fields more mobs than a poor one', () => {
    const rich = make();
    rich.testing = true;
    rich.forceThreat(4); // forceThreat pre-fills budget
    const a = run(rich, 2);
    const poor = make();
    poor.testing = true;
    const b = run(poor, 2);
    expect(a.length).toBeGreaterThan(b.length);
  });

  it('gates kinds by tier: no witches at tier 1, grunts always present', () => {
    const d = make();
    d.testing = true;
    d.forceThreat(1);
    const early = run(d, 3);
    expect(early.some((s) => s.kind === 'witch')).toBe(false);
    expect(early.some((s) => s.kind === 'grunt')).toBe(true);
  });

  it('caps the rare kinds inside one pack', () => {
    const d = make();
    d.testing = true;
    d.forceThreat(9); // every gate open, weights at their peak
    const spawned = run(d, 6);
    // One pack fires before the budget drains; whatever fired respects caps.
    const packs = spawned.length;
    expect(packs).toBeGreaterThan(0);
    const firstPack = spawned.slice(0, DIRECTOR.PACK_MAX);
    const tanks = firstPack.filter((s) => s.kind === 'tank').length;
    const witches = firstPack.filter((s) => s.kind === 'witch').length;
    expect(tanks).toBeLessThanOrEqual(2);
    expect(witches).toBeLessThanOrEqual(1);
  });
});

describe('pressure director — warden beat', () => {
  it('queues one warden per BOSS.EVERY tier crossing, and never twice', () => {
    const d = make();
    d.testing = true;
    d.forceThreat(BOSS.EVERY); // a multiple: the warden pack queues immediately
    const spawned = run(d, 2);
    expect(spawned.filter((s) => s.kind === 'warden')).toHaveLength(1);
    const again = run(d, 2);
    expect(again.filter((s) => s.kind === 'warden')).toHaveLength(0);
  });

  it('skips the warden on non-multiple tiers', () => {
    const d = make();
    d.testing = true;
    d.forceThreat(BOSS.EVERY + 1);
    const spawned = run(d, 2);
    expect(spawned.filter((s) => s.kind === 'warden')).toHaveLength(0);
  });
});

describe('pressure director — lulls and calms', () => {
  /** Drive kill→falling-edge cycles; return how many lulls and calms fired. */
  function cycles(d: PressureDirector, rounds: number): { lulls: number; calms: number } {
    let lulls = 0;
    let calms = 0;
    for (let i = 0; i < rounds; i++) {
      d.forceThreat(1 + (i % 3));
      run(d, 1); // a pack is up
      for (let k = 0; k < 600; k++) {
        const r = d.update(0.1, ORIGIN, 0); // everything dead: the edge falls
        if (d.lull > 0) lulls++;
        if (r.beat === 'calm') calms++;
      }
    }
    return { lulls: lulls > 0 ? 1 : 0, calms };
  }

  it('rolls lulls on the falling edge, each ending in exactly one calm beat', () => {
    const d = make();
    d.testing = true;
    // Per round: at most one lull, and every lull ends in exactly one calm.
    for (let round = 0; round < 12; round++) {
      d.forceThreat(1 + (round % 3));
      run(d, 1);
      let lull = false;
      let calms = 0;
      for (let k = 0; k < 600; k++) {
        const r = d.update(0.1, ORIGIN, 0);
        if (d.lull > 0) lull = true;
        if (r.beat === 'calm') calms++;
      }
      expect(calms).toBeLessThanOrEqual(1);
      if (lull) expect(calms).toBe(1);
    }
  });

  it('always lulls once the low-HP hint pushes the chance high', () => {
    const d = make();
    d.testing = true;
    d.lowHp = true; // LULL_BASE + LULL_LOW_HP = 0.8 per roll
    const { lulls } = cycles(d, 20);
    // 20 rolls at 80%: a total miss is 0.2^20 — not happening with a seed.
    expect(lulls).toBe(1);
  });

  it('pauses spawns during a lull', () => {
    const d = make();
    d.testing = true;
    d.forceThreat(3);
    run(d, 2);
    d.lull = DIRECTOR.LULL_T; // force a lull
    const spawned = run(d, 1);
    expect(spawned).toHaveLength(0);
  });
});

describe('pressure director — arrival', () => {
  it('prefers a supplied gate over the ring when one is near', () => {
    const d = make();
    d.testing = true;
    d.gates = () => [{ x: 24, z: 0 }]; // 24 units east: past the min-dist bubble, near enough
    d.forceThreat(1);
    const spawned = run(d, 2, { at: ORIGIN });
    expect(spawned.length).toBeGreaterThan(0);
    for (const s of spawned) {
      expect(Math.hypot(s.x - 24, s.z)).toBeLessThan(3.5);
    }
  });

  it('falls back to arcs that lean into the crawl heading', () => {
    const d = make();
    d.testing = false;
    d.forceThreat(1);
    d.gates = () => [];
    // Walk north (−z) long enough for the heading to settle and packs to fire;
    // record the player's z at each spawn moment.
    const moments: { s: SpawnRequest; pz: number }[] = [];
    for (let i = 0; i < 900; i++) {
      const pz = -i * 0.05;
      for (const s of d.update(0.1, { x: 0, z: pz }, 5).spawned) {
        moments.push({ s, pz });
      }
    }
    const regular = moments.filter((m) => m.s.kind !== 'warden');
    expect(regular.length).toBeGreaterThan(10);
    // SPAWN_BIAS of spawns land within SPAWN_BIAS_ARC of the heading, so the
    // majority sit ahead of the walker (further north than they were).
    const ahead = regular.filter((m) => m.s.z < m.pz).length;
    expect(ahead / regular.length).toBeGreaterThan(0.5);
    expect(ahead / regular.length).toBeLessThan(0.98);
    // And none inside the old minimum-distance bubble.
    for (const m of regular) {
      expect(Math.hypot(m.s.x, m.s.z - m.pz)).toBeGreaterThan(ENEMY.SPAWN_MIN_DIST - 0.01);
    }
  });
});

describe('pressure director — curves and bookkeeping', () => {
  it('keeps the old difficulty curves with threat as the argument', () => {
    expect(speedScale(1)).toBeCloseTo(1, 10);
    expect(speedScale(2)).toBeCloseTo(1 + DIRECTOR.SPEED_GAIN, 10);
    expect(speedScale(100)).toBeCloseTo(DIRECTOR.SPEED_MAX_SCALE, 10);
    expect(dmgBonus(1)).toBe(0);
    expect(dmgBonus(3)).toBe(DIRECTOR.DMG_PER_2_TIERS);
    expect(distScale(0)).toBeCloseTo(1, 10);
    expect(distScale(1000)).toBeCloseTo(DIRECTOR.DIST_SCALE_MAX, 10);
    expect(crawlDist(84, 0)).toBeCloseTo(1, 10);
  });

  it('counts pending queue members as hostiles', () => {
    const d = make();
    d.testing = false; // normal pacing: the pack sits in the queue
    d.forceThreat(4);
    const pending = d.hostileCount(0);
    expect(pending).toBeGreaterThan(0);
  });

  it('resets to a cold start', () => {
    const d = make();
    d.testing = true;
    d.forceThreat(6);
    run(d, 1);
    d.reset();
    expect(d.threat).toBe(0);
    expect(d.lull).toBe(0);
    expect(d.hostileCount(0)).toBe(0);
  });
});
