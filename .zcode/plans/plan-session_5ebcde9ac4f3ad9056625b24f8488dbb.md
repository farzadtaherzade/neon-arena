# Three new mobs: Creeper, Witch, Blinker

## Intent
Add three Minecraft-flavoured enemy kinds that reuse the existing systems instead of inventing new ones:
- **Creeper** — green, armless, walks at you; inside trigger range its fuse starts (glow tell ramps like the sapper's). Back away beyond cancel range and the fuse drains back down; at zero it detonates through the existing bomb pipeline (bigger blast than a sapper bomb, shreds nearby mobs too) and kills itself — no credits/XP for being blown up. Kill it mid-fuse and nothing explodes.
- **Witch** — purple-robed, keeps its distance like a lurking sapper, lobs a **poison potion** (small bomb variant, purple shell) every few seconds: poison deals damage over time for a few seconds (refresh, not stack). Also **heals wounded allies** within a radius on a timer (no overheal, no resurrection).
- **Blinker** — tall dark stalker with purple eyes; walks slowly but every few seconds, when at mid-to-far range, **blinks (teleports) to land a few units from the player at the player's feet height** — with a short pre-blink glow tell. Low HP, hard melee hit. Deliberate design call: it can land on the deck you're camping, making it the counter to deck-turtling (sappers/warden remain the other deck pressure).

Decks stay safe from **creepers**: their fuse only counts down within trigger range AND within `ENEMY.ATTACK_RISE` of the player's height (same gate melee uses), so a creeper sieges the ramp mouth like a grunt and never blows the deck up.

## Approach (decisions made)
1. **Explosions/potions ride the existing `plantBomb → Bomb → detonate` pipeline.** The warden's `heavy?: boolean` flag is generalized to `variant?: 'rocket' | 'blast' | 'potion'` (optional; absent = today's sapper bomb). `Game.plantBomb` maps variant → `{fuse, radius, playerDmg}` from new config groups; `Bomb` gains a readonly `variant` field; `BombView` picks a purple shell for `potion` (it already owns its shell material).
2. **`detonate()` becomes variant-aware**: `potion` → applies poison to the player if in radius, no instant player damage, no enemy shred; `blast` → full `BOMB.ENEMY_DMG` shred + player falloff at creeper numbers; `rocket`/default → today's behaviour.
3. **Poison status lives in `Game`** (it must call `damagePlayer`): `poisonT` field, ticked per frame as `damagePlayer(WITCH.POISON_DPS * dt)`, refreshed (not stacked) by each potion; `HudModel.poison` (seconds left) drives a small HUD chip like the bomb warning. The three mob behaviours themselves are pure sim in `enemy.ts` — unit-testable like the sapper suite.
4. **All new numbers live in `config.ts`** per house rules: new `CREEPER`, `WITCH`, `BLINKER` groups; three new rows in every per-kind map.

## Changes, file by file

**`src/game/config.ts`**
- `ENEMY_KINDS` += `'creeper' | 'witch' | 'blinker'`.
- New rows in `ENEMY_TYPES` (creeper: hp 45, speed 3.8, scale 0.9, dmg 8, score 200, body green `0x4fae4f`; witch: hp 70, speed 3.6, dmg 10, score 250, body `0x9b59d0`; blinker: hp 80, speed 3.0, dmg 18, score 250, body `0x1c2030`), `ENEMY_LOOKS` (≥2 skins each — enforced), `ENEMY.TURN_RATE`, `WAVES.HP_PER_WAVE` (8/8/10), `CREDITS.KILL` (20/30/25), `AMMO.DROP` (6/6/8), `XP.VALUE` (8/10/10).
- New groups: `CREEPER = { START_WAVE: 3, EVERY_WAVES: 4, TRIGGER_DIST: 3.5, CANCEL_DIST: 6, FUSE: 1.5, TELL: 0.9, BLAST_FUSE: 0.4, BLAST_RADIUS: 5.5, BLAST_DMG: 40 }`; `WITCH = { START_WAVE: 6, EVERY_WAVES: 5, MAX_WITCHES: 2, KEEP_DIST: 14, THROW_T: 4.5, POTION_FUSE: 1.6, POTION_RADIUS: 2.6, POISON_T: 4, POISON_DPS: 6, HEAL_T: 6, HEAL_RADIUS: 10, HEAL: 25, TELL: 0.8 }`; `BLINKER = { START_WAVE: 7, EVERY_WAVES: 4, BLINK_T: 5, BLINK_MIN: 8, LAND_MIN: 3.5, LAND_MAX: 5.5, TELL: 0.5 }`.

**`src/game/bomb.ts`** — add `readonly variant` (default `'bomb'`) via constructor param.

**`src/game/enemy.ts`**
- `EnemyWorld.plantBomb(from, to, thrown, variant?)` — signature change; sapper calls unchanged, warden `tickVolley` passes `'rocket'`.
- New fields: creeper `fuse`/`fuseTotal`, blinker `blinkT`; new getters `fuseK`, `blinkK` (same 0..1 ramp pattern as `bombTell`).
- `updateCreeper`: pursue like a chaser; fuse counts down when `dist ≤ TRIGGER_DIST` and `|playerY − pos.y| ≤ ATTACK_RISE`, drains back up outside `CANCEL_DIST`; at 0 → `world.plantBomb(pos, pos, false, 'blast')` then `this.kill()` (self-kill bypasses `killEnemy`, so no payout).
- `updateWitch`: sapper-lurk movement (keep `KEEP_DIST`, wander); `plantT` countdown → `world.plantBomb(pos, playerPos, true, 'potion')`; separate `healT` countdown → heal lowest-HP wounded **alive** neighbour within `HEAL_RADIUS` by `HEAL`, clamped to its `maxHp` (neighbours already available via `EnemyWorld.neighbours` + a green `flash()`).
- Blinker joins `updateChaser` exactly like the runner's pounce hook: `if (this.kind === 'blinker') this.updateBlink(dt, dist, world)` — on cooldown expiry and `dist ≥ BLINK_MIN`, land at a random angle `LAND_MIN..LAND_MAX` from the player, `pos.y = world.playerY`, then `world.collide(...)` resolves geometry on the same tick. No allocation (plain numbers).
- Dispatch in `update()`: `creeper` / `witch` branches before the chaser fallback.

**`src/game/waves.ts`** — `composition()` gains three count formulas mirroring the sapper's (`1 + floor((n − START_WAVE)/EVERY_WAVES)`, witch capped at `MAX_WITCHES`); boss-wave thinning applies automatically.

**`src/app/Game.ts`**
- `plantBomb`: variant ternary chain → `Bomb` stats (rocket from `BOSS`, blast from `CREEPER`, potion from `WITCH`, default `BOMB`).
- `detonate(bomb)`: branch on `bomb.variant` for potion (poison, no shred) / blast (full shred).
- Poison fields + per-frame tick; feed `HudModel.poison`.

**`src/render/models/MobModel.ts`** — three new builders following the `grunt()` pattern (merged box geometry, per-kind swing constants): creeper (tall body, four stub leg pivots, no arms, glow face), witch (robe body, wide accent hat brim, glow eyes, vial arm), blinker (tall narrow body, long limbs, glow eyes). Plus `LAYOUT` entries, `geometries()` branches, and **both kinds added to `mobWarmup()`** — required or the E2E geometry-leak test reads their first upload as a leak.

**`src/render/EnemyView.ts`** — extend the tell ternary (`warden ? volleyK : creeper ? fuseK : blinker ? blinkK : bombTell`); everything else (health bar, death anim, dispose) is kind-generic already.

**`src/render/BombView.ts`** — purple shell material colour when `bomb.variant === 'potion'`.

**`src/ui/Hud.ts`** — `HudModel.poison` + a `#poisonWarn` chip cloned from the bomb-warning styling.

Minimap/MapScreen need **nothing** — they read `ENEMY_TYPES[kind].body`.

## Tests
- `tests/unit/waves.test.ts:31` whitelist += the three kinds; cadence pins mirroring the sapper's (`START_WAVE − 1` → 0, first, `+EVERY`, witch cap).
- `tests/unit/enemy.test.ts` — fake world's `plantBomb` records `variant`; new suites: creeper (approaches, fuse ramps `fuseK`, backing off recovers fuse, completion → one `'blast'` bomb at its feet + `state === 'dying'`, killing mid-fuse → no bomb), witch (keeps distance, throws `'potion'` at `playerPos` including elevated, heals a wounded neighbour without overhealing, ignores full-HP neighbours), blinker (blinks closer only past `BLINK_MIN`, lands at `playerY` within `LAND` bounds, cooldown respected, `blinkK` ramps first).
- `tests/unit/config.test.ts` — map-key parity is enforced automatically; add small sanity assertions (`CANCEL_DIST > TRIGGER_DIST`, `BLAST_DMG > BOMB.PLAYER_DMG`, `POTION_RADIUS < BOMB.RADIUS`, poison numbers > 0, new `TURN_RATE`s > 0).
- `tests/e2e/smoke.spec.ts` — two compact pins in the sapper-pin style: `forceWave(3)` → a creeper appears and dies to the generic kill helper; `forceWave(6)` → a witch appears, gets killed, nothing leaks. Poison's frame wiring is covered by the witch spawn + existing HUD plumbing; not worth a fragile real-time assertion.

## Gates
`npm run typecheck`, `npm test`, `npm run lint`, then full `npm run test:e2e` (gameplay + rendering change). No layout/collision changes, so the geometry pins (46 obstacles / 4 ramps) are untouched.

## Risks & explicitly skipped
- **Numbers are first-pass tuning** — witch heal rate and creeper blast need a playtest pass; all knobs are in `config.ts`.
- Skipped: creeper hiss SFX (procedural audio is its own task — glow tell + bomb warning carry it), poison stacking (refresh-only), teleport particle FX, and any appearance gating beyond `START_WAVE`.
- Blinker landing on decks is the one intentional bend of "decks are melee-safe" — flagged here so it's a decision, not a surprise.