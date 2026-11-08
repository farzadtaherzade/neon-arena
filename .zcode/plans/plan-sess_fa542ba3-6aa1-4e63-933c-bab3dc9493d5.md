# Replace the wave system with a pressure director

## Context

"Cut off the wave system and replace it" — grilled across two rounds, all answers given. Verdicts: waves' stop–start pacing, wave-number progression and ring-pop spawns are all wrong; the replacement is a **pressure director**; beats survive, the count dies. Threat rises from **time-under-pressure + a distance floor**, packs arrive **through district gates first, directional arcs second**, wardens beat **every 5 tiers**, and **adaptive lulls** (low-HP aware) let the run breathe.

The tuning-preservation trick: **`threat` advances at the pace the wave number used to** (~1 tier / 35s of live pressure), so `START_WAVE: 3` becomes "creepers from tier 3", `BOSS.EVERY: 5` stays the warden cadence, and the `HP_PER_WAVE`/`speedScale`/`dmgBonus` formulas carry over unchanged with `threat` as the argument.

## Design

**`src/game/director.ts`** (new pure module; `waves.ts` deleted):

```ts
export interface SpawnRequest { kind: EnemyKind; x: number; z: number; speedScale: number }
export interface DirectorUpdate { spawned: SpawnRequest[]; beat: null | 'warden' | 'calm' }  // reused object
export class PressureDirector {
  threat = 0; lull = 0; testing = false;
  rng: Rng; blocked: (x, z) => boolean;          // same injections as WaveDirector
  gates: () => { x: number; z: number }[];       // NEW: Game supplies nearby district gates
  lastHit: { x: number; z: number } | null;      // NEW: Game supplies recent damage direction (arc bias)
  lowHp: boolean;                                // NEW: Game supplies the adaptive-lull hint
  reset(): void
  hostileCount(alive: number): number            // alive + pending pack members
  update(dt, playerPos: Vec2, alive: number): DirectorUpdate
  forceThreat(n: number): void                   // E2E: set tier, queue a big pack, warden beat on BOSS.EVERY multiples
}
```

- **Threat**: `+dt / TIER_T` (35s) while pressure is live; `threat = max(threat, floor(crawlDist(player)) × DIST_TIER_GAIN)` — the distance floor; `+0.5` per capture (Game calls `director.nudge()` from the capture payout). Freezes during lulls.
- **Packs**: budget regenerates at `BUDGET_RATE`; on threshold it queues a 2–5-mob pack: composition from today's per-kind math with per-kind costs, kinds gated by `START_TIER` (same values as `START_WAVE`), caps kept (`MAX_WITCHES`, `MAX_TANKS`). Arrival: **gate entry** — pick the nearest supplied gate ≥ `SPAWN_MIN_DIST` away, spawn the pack clustered just inside it, staggered `STAGGER` apart, heading-biased exit; **no gate within 1.5 chunks** → directional arc cluster biased by crawl heading (70%) or `lastHit` direction (30%); `pickSpawn`'s ring rejection + `SPAWN_FALLBACK` copied verbatim as the last resort.
- **Warden beat**: crossing a multiple of `BOSS.EVERY` queues the warden pack (boss + thinned escort — the boss-thinning rule from `composition`). Banner stays `'WARDEN INBOUND'`.
- **Adaptive lulls**: after a pack fully dies, lull chance = `LULL_BASE + (lowHp ? LULL_LOW_HP : 0)`; during a lull spawns pause, budget regenerates ×2, `lull = LULL_T` counts down. On lull end: **calm beat** — Game heals `CALM_HEAL` (was WAVE_HEAL), pays `CREDITS.CALM` (was CREDITS.WAVE), calls `resupply()`.
- **Testing mode**: `update(0)` spawns pending packs instantly — the E2E contract, unchanged.
- Scaling at spawn: `scaleUp(threat × HP_PER_THREAT[kind] × distK, speedScale, dmgBonus(threat) × distK)` — the old formulas with `threat` as argument.

## Files

- **Delete** `src/game/waves.ts`, `tests/unit/waves.test.ts`. **Create** `src/game/director.ts`, `tests/unit/director.test.ts`.
- **`src/game/config.ts`**: `WAVES` → `DIRECTOR` (`TIER_T: 35, BUDGET_RATE, STAGGER: 0.35, LULL_CHANCE/LULL_BASE, LULL_LOW_HP, LULL_T, DIST_TIER_GAIN, SPEED_GAIN/MAX, HP_PER_THREAT (same values), DMG_PER_2_TIERS, SPAWN_BIAS/ARC, DIST_GAIN/MAX`); `START_WAVE`→`START_TIER`, `EVERY_WAVES`→`EVERY_TIERS` (values unchanged); `CREDITS.WAVE`→`CREDITS.CALM`; `BOSS.EVERY` untouched.
- **`src/app/Game.ts`**: `waves`→`director`; `beginWave`/`waveClearPending` die (banners ride `beat`); `updateWaves`→`updateDirector` (spawn construction identical; warden beat → banner+sfx; calm beat → heal+credits+`resupply()`); feeds `director.gates` (computed from loaded district chunks: deck centre + the compound's two skipped-slot angles at ~12.5 radius — gate math re-uses `buildChunk`'s slot geometry), `lastHit` (set in `damagePlayer` from the hit direction), `lowHp` (`hp < START_HP * 0.35`); `forceWave`→`forceThreat`; `summonGuardian` uses `director.threat`; `setClock(threat, director.lull, aliveCount)`; `m.wave`→`m.threat`.
- **`src/main.ts`**: `stats()` returns `threat`; `forceThreat` hook.
- **`src/ui/Hud.ts` + `index.html`**: `WAVE` stat → `THREAT`; menu tip "SURVIVE THE WAVES" → "SURVIVE THE CRAWL"; boss bar untouched.
- **`src/ui/Records.ts`/`Career.ts`/`Profile.ts`**: display `TIER n` where `WAVE n` printed; stored `RunRecord.wave` carries the tier — **no storage migration**.
- **`src/render/Arena.ts`/`ClockTower.ts`**: `setClock(threat, lull, hostiles)` → `'THREAT', n, 'HOSTILES x'` under pressure; `'CALM', ceil(lull)s, 'TIER ' + (threat+1)` during lulls.
- Stale comments: `enemy.ts:205`, `weapon.ts:23`, `CapturePad.ts:11`.

## Tests

- **`director.test.ts`** (new, pure): threat accumulates only under pressure + distance floor via `crawlDist`; budget → staggered pack spawn; per-kind unlock tiers + caps; warden beat at `BOSS.EVERY` with thinned escort; gate-entry preference when `gates()` supplies one ≥ min-dist (arc fallback when not); lull pauses spawns and the low-HP hint raises lull chance; calm beat flags exactly once; bias ≥55% heading; testing-mode instant spawn; `hostileCount`; reset.
- **`config.test.ts`**: WAVES block → DIRECTOR invariants (HEADROOM-style sanity: TIER_T > 0, LULL_T > 0, START_TIER ordering preserved).
- **`enemy.test.ts`**: `scaleUp` math re-homed to threat arguments.
- **`smoke.spec.ts`**: `forceWave(n)` → `forceThreat(n)` at the creeper/witch/sapper steps; warden step `forceThreat(5)` + boss-bar waits; `boot.wave` → threat ≥ 1 + hostiles > 0.

## Verification

1. `npm run typecheck` + `npm test` + `npm run lint`.
2. `npm run test:e2e` full suite.
3. Manual `npm run dev`: 5+ minutes — swells and lulls, no wave banners; packs enter through district gates when near one; warden ~tier 5; lull heals/resupplies when battered; death shows TIER; clock reads THREAT/CALM; Lightpanda DOM check still passes.
4. CHANGELOG under 2.2.0 + amendment note in the infinite-crawl spec doc. New branch `feat/pressure-director` off `feat/structure-stamps`; PR stacked on #9.