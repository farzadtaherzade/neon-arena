# Mobs climb the deck ramp

## Context

When the player stands on a gatehouse deck, mobs pile up at the bottom of the ramp and never come up. That is currently deliberate: `Enemy.route()` lays siege to the ramp mouth ("High ground is melee-safe by design", `src/game/enemy.ts:709-724`), a design documented in AGENTS.md and pinned by `tests/unit/enemy.test.ts:156`. The owner wants decks contested: **melee mobs take the ramp** (grunt, runner, tank, blinker, creeper, colossus, and a sapper in hunt mode); the **warden keeps its distance** and shells the deck with rockets; sappers/witches keep lobbing from range.

The physics already supports climbing — nothing below `route()` changes:
- `followGround()` (`enemy.ts:747-765`) rides a slope via `world.support()` / `rampHeight`, with the same step+stick model as the player.
- `resolveCircle` treats a ramp's low side as walk-on; the slope rises ≤ `ENEMY.STEP` per frame at mob speeds.
- The melee gate (`|playerY − pos.y| > ATTACK_RISE`) opens on its own once a mob is at deck level.
- `route()`'s `CLIMB_RISE` check then flips the mob back to a direct chase — no new state needed.

## Changes — `src/game/enemy.ts`

**1. `route()` (709-724): two-stage ramp target.**
Keep the direct-chase branch and `nearestRamp()` (by ramp top) as-is. Replace the mouth-only assignment (721-723) with:
- If the mob is already at the toe — within `ENEMY.RAMP_OFFSET + ENEMY.COLLIDE_RADIUS * this.scale` of the mouth point — or its XZ sits inside the ramp AABB expanded by that radius, target `rampTopX/rampTopZ` (helpers already exist at `enemy.ts:66-86`, pushed onto the deck).
- Otherwise target the mouth as today (line-up approach around the deck walls).
Allocation-free, stateless, reuses existing helpers. Mob walks to the toe, up the slope, and flips to direct chase at deck level.

**2. Warden stays a siege boss.** Thread an optional `climbs = true` parameter through `pursue()` (690) → `route()` (default keeps every other call site unchanged). The warden's elevated branch (`enemy.ts:623-627`) passes `false` with a comment: it besieges the mouth and lets `tickVolley` rockets do the deck work — its "refuses to close" identity is preserved.

**3. Rewrite the stale comments** (this repo treats them as load-bearing docs):
- `pursue()` comment (685-688) — it already claims "and then up it"; now true.
- `route()` doc (703-708).
- `config.ts` `ENEMY` group comment (~875-885): `CLIMB_RISE` is now "when they route to the ramp" instead of "give up the chase".
- `config.ts` `CAPTURE` comment (~1107-1110): holding a pad is a fight against climbers *and* artillery.
- `world/layout.ts` `PLATFORM_H` comment (~15-19): ramp is the only way up for player **and** mobs.

No tuning values change — `CLIMB_RISE`, `ATTACK_RISE`, `RAMP_OFFSET`, `STEP` all keep their roles.

## Tests

- **Rewrite** `tests/unit/enemy.test.ts:156-179` "besieges the ramp mouth…" → "climbs the deck ramp and draws blood": same setup (north deck from `HOME.tables.decks[0]`, `arenaWorld` real collision, player on deck at `PLATFORM_H`, grunt 21 units south); run ≤ 20 s; assert peak `pos.y ≥ PLATFORM_H − 0.1`, it ends at melee distance of the player, and `world.hurt > 0`.
- **Add** a warden pin (same file, `arenaWorld`): player on the north deck, warden south — it stays on the floor (`pos.y < 0.2`) while its volley still fires. (`warden.test.ts`'s stub has `ramps: []` so it can't pin this.)
- Survive unchanged (verified): the melee height-gate test (stub world), creeper besiege test (stub), sapper/witch lob tests, blinker feet-height, warden volley test, and the `config.test.ts` vertical-nav ordering — update only its "mobs never climb" comment (config.test.ts:141-151).

## Docs / version

- **AGENTS.md**: update the "Enemy navigation" bullets and the "Invariants asserted in tests" line — mobs route mouth → top; warden still besieges and shells; sappers still lob.
- **CHANGELOG.md + package.json**: `version.test.ts` requires the latest changelog header to equal `package.json`'s version (currently 2.2.0), so bump to **2.3.0** and add a `## [2.3.0]` → `### Changed` entry. No tag/push — `npm run release` only if asked.

## Verification

1. `npm run typecheck && npm test && npm run lint`
2. `npm run test:e2e` — gameplay change, so the repo gate applies (suite is ~2 min; no E2E assertion depends on non-climbing mobs, confirmed by search).
3. Manual sanity via `npm run dev` + `?test`: `__NEON.teleportPlayer(...)` onto a deck, `forceWave(n)`, watch grunts queue up the ramp and reach melee; warden wave keeps shelling from the floor.