# AGENTS.md

Notes for AI agents (and new humans) working in this repo.

**NEON ARENA** is a browser first-person arena shooter: Three.js + Vite +
TypeScript, no backend, no art assets — every texture, sound and model is
generated in code.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server, hot reload |
| `npm run build` | Type-checked production bundle into `dist/` |
| `npm run preview` | Serve the built bundle |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Biome check (exit code fails only on errors, not warnings) |
| `npm run format` | Biome write (autofix, includes import order) |
| `npm test` | Vitest unit suite (~2 s) |
| `npm run test:e2e` | Playwright against the production build (~2 min) |
| `npm run check` | typecheck + lint + unit tests |

Before claiming any change is done: `npm run typecheck`, `npm test`,
`npm run lint`, and — if it touches gameplay or rendering — `npm run test:e2e`.
The E2E builds and previews on port 4173 itself; don't start a server by hand.

## Layout

```
src/game/        simulation — pure logic, no Three.js, no DOM
  config.ts      THE tuning table (see below)
  player.ts      movement, gravity, collision, look
  enemy.ts       one enemy: AI, damage, death animation
  enemies.ts     SpatialHash broadphase for separation
  waves.ts       WaveDirector: composition + staggered spawning
  weapon.ts      magazine + reserve, fire cadence, spread bloom, recoil
  knife.ts       the blade: a cone query, cooldown, swing
  bomb.ts        a planted bomb: fuse, radius, detonation
  capture.ts     the rotating deck objective: hold timer, cooldowns
  alarm.ts       tower alarm rising-edge detection
  minimap.ts     world→radar projection (pure maths)
  fx.ts          particle + tracer pools
  world/         collision.ts (AABB + ramp height fields), layout.ts (arena constants)
src/render/      everything that owns meshes
  Arena.ts       renderer, scene, camera rig, lights, floor, walls, cover
  CapturePad.ts  the live deck's ring, progress disc and beacon beam
  ClockTower.ts  the clock tower landmark and its live canvas readout
  EnemyView.ts   an enemy's meshes + health bar
  BombView.ts    a bomb's meshes + blink
  Gun.ts         the first-person viewmodel
  Knife.ts       the first-person blade viewmodel
  Pick.ts        hitscan raycasting (screen centre → world)
  Fx.ts          pooled Points/Lines on screen
  Materials.ts   shared geometries and materials (lazy, add-only)
  Textures.ts    procedural floor texture
src/ui/          DOM-facing
  Hud.ts         HUD elements, screens, banners, threat warning
  Input.ts       keyboard/mouse/pointer-lock bookkeeping
  Minimap.ts     the canvas radar
  MapScreen.ts   the full-screen tactical map (M / Tab)
  Profile.ts     the credit wallet + the loadout, in localStorage
  Skins.ts       the shop: one swatch card per skin
  Settings.ts    crosshair / game / video / skins tabs + tuning panel
src/app/Game.ts  composition root, state machine, per-frame wiring
src/main.ts      bootstrap, fixed-step loop, test API
```

## Conventions that matter

- **`config.ts` is the single tuning table.** Every number lives there as
  `as const`, and it imports nothing. Change behaviour by editing it, not by
  scattering magic numbers. `tests/unit/config.test.ts` is effectively its
  schema — a new tuning group should get sanity assertions there.
- **Simulation never imports Three.js.** `src/game/**` works on plain
  `{x,y,z}` objects so it stays unit-testable. The bridge is
  `src/app/Game.ts`, which holds `Hostile { enemy, view }` pairs.
- **Collaborators talk through small structural interfaces,** declared by the
  consumer, not the producer: `EnemyWorld` (what an enemy needs from the game),
  `HudModel` (what the HUD reads each frame), `MapEnemy`. Extend the interface
  where the consumer lives and the producer will satisfy it.
- **Allocation discipline.** This runs at 60 fps in a browser. Pools are sized
  once (`fx.ts`, `render/Fx.ts`), result objects are reused (`Pick.cast()`
  returns the same `ShotHit` every call), the per-frame world object is built
  once and mutated, and `Game` keeps a module-level `EMPTY` array instead of
  allocating. Don't add per-frame `map`/`filter`/object literals on hot paths.
- **Shared vs owned meshes.** `Materials.ts` hands out process-wide shared
  geometries/materials that are never disposed. A class that creates its *own*
  material (per-enemy body colour, a bomb's blinking shell) must dispose it in
  its `dispose(scene)` and remove every mesh it added. The E2E asserts GPU
  geometry/texture counts return to baseline after kills — leaks fail the test.
- **`noUncheckedIndexedAccess` is on.** Indexed reads are `T | undefined`. Use
  `?.`, `?? 0`, or an explicit guard. Do **not** reach for `!` — Biome's
  `noNonNullAssertion` flags it (the few remaining ones are pre-existing).
- **Rendering is derived from state each frame,** not driven by transitions.
  Gun visibility, for example, is one expression in `render()` rather than
  `show()` calls spread over `start()`/`gameOver()`. Prefer that shape; it
  avoids the "pausing lost the gun" class of bug.

## The map: 84×84 maze, four gatehouse decks

The floor is 84×84 of dense maze — one quadrant of cover mirrored four ways, a
magenta reactor at the centre as the landmark every lane is navigated by, and
four gatehouse decks on the **mid-edges, never the corners**. Each deck is
reached by exactly one ramp and carries a capture pad plus an alarm mast. This
is the only terrain that is not a flat box, and it touches collision, player
movement, enemy AI and the renderer at once — so the whole contract is spelled
out here.

### The design intent

- `PLATFORM_H` is **2.4**. That number is load-bearing: it is above
  `WORLD.STEP_HEIGHT` (0.55) and above the jump apex
  (`JUMP_V² / 2·GRAVITY` ≈ 1.39). A deck is therefore *unreachable* by walking
  into it or jumping at it — the ramp is the only way up, for the player.
- Decks are `7 × 7` on the mid-edges at `±35`, so each outer face lands at 38.5
  and leaves a 2.5-unit lane between deck and wall. That lane is a deliberate
  maze route, so keep `wall clamp − outer face > 2·PLAYER_R`; close it and the
  corridor behind the deck stops being walkable.
- The maze is generated from `MAZE_QUADRANT` by mirroring each block four ways.
  Edit the quadrant, never the expanded `OBSTACLES` — symmetry is what keeps
  every lane fair. Keep clear: the four ramps, the four decks, the reactor
  footprint and the 10×10 spawn plaza at `WORLD.SPAWN_*`.


### Collision model

A ramp is a **height field, not an obstacle**:

```ts
interface Ramp extends Aabb { lowY; highY; upX; upZ }   // up vector is ±1 on one axis
```

- `CollisionWorld.addRamp()` registers it in `ramps[]`; it is deliberately
  **absent from `obstacles`**, because a flat `top` cannot describe a slope.
  Registering a ramp with `addObstacle` makes it an unclimbable wall; skipping
  registration entirely makes it decoration — that was the original bug.
- `rampHeight(ramp, x, z)` lerps `lowY → highY` along the up axis, clamped to
  the footprint.
- `groundHeight()` returns the interpolated height, so anything standing on the
  slope is supported by it.
- `resolveCircle()` blocks a ramp **only where the surface is above
  `feetY + step`**: the toe is walk-on, the high side is solid, and a centre
  already inside the footprint is standing on the slope so it is never pushed.
  That is what keeps a ramp solid from the side without an invisible wall.

### Body vertical model (shared by player and enemy)

Both resolve height the same way, and the two must stay in step:

1. Integrate gravity, then ask `groundHeight()` for support with
   `ceiling = max(feet + (grounded ? STEP : 0), feetBefore)`. `feetBefore`
   always covers the descent this step, so nothing tunnels through a deck.
2. Land if `vy <= 0 && y <= support` **or** "stick": when the body was grounded
   and the surface dropped by at most `STEP`, snap down to it. Without the
   stick, walking *down* a ramp is a string of tiny falls that keeps clearing
   `grounded` (and therefore `moving`, sprint and bob).
3. Otherwise it is airborne and falls.

Coordinate convention — easy to get wrong:

| Field | Height it holds |
|---|---|
| `Player.position.y` | **eye** height (`feet + PLAYER_H`) |
| `Enemy.pos.y` | **feet** |
| `EnemyWorld.playerY` | the player's **feet**, refreshed in `Game.step()` |
| `Ramp.lowY / highY`, `Collider.top` | **feet** / surface |

### Enemy navigation

Mobs have no pathfinder. `Enemy.route()` is the whole of it:

- If `playerY − pos.y < ENEMY.CLIMB_RISE`, walk straight at the player.
- Otherwise pick `nearestRamp()` **by ramp top**, not by mouth — the top tells
  you which platform the player is actually on, so an enemy on the far side of
  the arena does not besiege the wrong ramp.
- Then aim at that ramp's **mouth only** (its low edge pushed `RAMP_OFFSET`
  downhill). Mobs never take the slope: a deck is melee-safe by design, and the
  sappers are the answer to it. Remove the `mouth` assignment and they climb
  again, which silently deletes the capture mechanic's entire risk.
- `ENEMY.ATTACK_RISE` gates melee by height, so a mob at the foot of a platform
  cannot claw at someone standing on it — and, symmetrically, nothing hits
  through a deck from above.

`Enemy.followGround()` runs *after* `world.collide()`, using `pos.y` as the
`feetY` for the step context. Enemies can ride a slope if they are ever on one
(their `ENEMY.STEP` is the same 0.55 the player gets) and fall off ledges, but
they cannot climb a platform side.

### Deck capture

The reward that makes high ground worth the walk. One platform per wave carries
a live pad; standing on it for `CAPTURE.HOLD_T` seconds banks a heal-over-time
(`CAPTURE.HEAL` HP over `HEAL_T`), then that deck cools down for
`CAPTURE.COOLDOWN`.

- `src/game/capture.ts` is pure and owns rotation, hold progress and cooldowns.
  The live deck is **derived** (`(wave − 1) % 4`) rather than set explicitly, so
  it cannot desync from the HUD's wave counter — including when the wave
  advances inside `WaveDirector` instead of `beginWave()`.
- Progress *drains* at `CAPTURE.DECAY` per second off the pad rather than
  resetting, so a bomb that forces you off costs progress but not the attempt.
- The pad checks `feetY >= deck.y − CAPTURE.RISE` as well as XZ radius, so
  standing on the floor beneath a deck never counts.
- `render/CapturePad.ts` draws ring + progress disc + a beam on the live deck
  only. That beam is the entire wayfinding cue for "where is the objective".
- `Game.updateCapture()` pays the heal out over `HEAL_T` seconds and caps at
  `START_HP`, so a capture can top you up but never overheal.

### Tower alarms

Every deck carries a mast and a beacon. `TowerAlarm` (in `game/alarm.ts`) is the
pure rising-edge detector: `Game` does the spatial query each step and reports
which towers see hostiles inside `ALARM.RADIUS`; the class holds the state for
`ALARM.HOLD` seconds and returns true only on the transition, so the siren pings
once instead of every frame. The beacon reads that state — red and fast-pulsing
while hot, amber on the live deck, dim cyan on the other three — and the minimap
pulses a ring there. Break the edge detection and the siren screams non-stop;
break the hold and it strobes whenever a mob steps behind cover.


### Renderer

`Arena.ramps()` builds each ramp as an extruded wedge whose hypotenuse runs
from the floor at the mouth to `PLATFORM_H` at the back edge, from the *same*
`RAMPS` tuple that feeds `addRamp()`. Mesh and collider cannot drift apart —
the old version was a box tilted 0.12 rad (~0.17 rise) against a 1.0 platform,
which never met either end. The wedge goes into `solids` for hitscan; the cyan
edge rails and hazard threshold at the mouth are the "this is the way up" cue.
Mirrored ramps are one geometry rotated `PI` about Y, not a second code path.

### Invariants asserted in tests

`tests/unit/collision.test.ts` (layout block) and `config.test.ts`:

- every ramp's high edge coincides exactly with the face of a platform, and the
  ramp's cross-slope span sits inside that platform's footprint;
- every platform's outer face is exactly `clamp − PLAYER_R`, i.e. no pocket;
- `ENEMY.STEP`, `WORLD.STEP_HEIGHT` and the jump apex are all `< PLATFORM_H`;
- `ENEMY.CLIMB_RISE < ENEMY.ATTACK_RISE < PLATFORM_H`.

`tests/unit/enemy.test.ts` proves the behaviour end to end: a grunt spawned on
the floor **besieges the NW ramp mouth** without ever leaving the ground, a
sapper lobs onto the deck instead of dropping at its feet, and an enemy that
walks off a deck falls back to the floor. `tests/unit/capture.test.ts` covers
rotation, the drain, the cooldown and the floor-beneath-the-deck case.

### If you move a deck or add cover

1. Keep `wall clamp − deck outer face > 2·PLAYER_R` so the lane behind it stays
   walkable (38.5 out of 41 today).
2. Put the ramp's high edge **on** a deck face and give the tuple the `up`
   vector that points at that face. Length 6 over `PLATFORM_H` 2.4 is a walkable
   ~22° slope; much shorter and the step-per-frame exceeds `STEP_HEIGHT`.
3. Add cover to `MAZE_QUADRANT` only, never to `OBSTACLES`, and re-check the
   ramps, decks, reactor and spawn plaza. `collision.test.ts` samples a 10×10
   grid around the spawn with `blockedAt()` and will catch an intrusion.
4. Spawns are rejected when `CollisionWorld.blockedAt()` says the ring point is
   inside geometry (`WaveDirector.blocked`). If a new structure sits on the
   spawn ring (`ENEMY.SPAWN_RING ± JITTER` = 30–36), that check is what stops a
   tank materialising inside it.
5. Run `npm test` — the layout invariants above will catch a hand-placed slip.

## Testing

**Unit (Vitest)** — target `src/game/**` and other pure modules. No DOM, no
WebGL. If you add behaviour to an enemy or a system, that's where it gets
covered.

**E2E (Playwright)** — one long test, `tests/e2e/smoke.spec.ts`, that boots the
real production build, plays it, and asserts it cleans up after itself. It runs
with the system Chrome channel and SwiftShader (Playwright's own Chromium
download is blocked on the dev machine — see `playwright.config.ts`).

The game has a headless entry point for automation:

- `?test` (any value) boots straight into a playing state, skipping pointer lock
  and hiding the menu screens.
- `window.__NEON` exposes the hooks the suite drives:
  `stats()`, `hurt(d)`, `teleportEnemies(d)`, `faceEnemies(d, y)`,
  `aim(yaw, pitch)`, `enemyPos()`, `camState()`, `renderInfo()`,
  `gunVisible()`, `inputStats()`, `capture()`, `alarm()`, `bombs()`,
  `spawnBomb(x, z)`, `forceWave(n)`, `crosshair()`, `setCrosshair(patch)`,
  `teleportPlayer(x, z, y?)`, `settings()`, `setGame(patch)`,
  `setVideo(patch)`, `xpStats()`, `grantXp(n)`, `meteor()`, `forceMeteor()`,
  `dropStone(x, z)`, `ammo()`, `setAmmo(mag, reserve)`, `knife()`,
  `swingKnife()`, `profile()`, `credits()`, `grantCredits(n)`, `buySkin(id)`,
  `equipSkin(id)`.

`__NEON` is deliberately untyped (`Record<string, (...args: any[]) => unknown>`),
so the spec re-declares the shapes it uses.

## Gotchas

- `Game.damagePlayer()` guards on `state === 'playing'` and has **no upper
  clamp**, so a negative amount heals. The E2E relies on this for headroom.
- `Hud.update()` is only called while playing, so HUD fields freeze during
  pause. Anything that must keep animating while paused belongs in `render()`.
- Enemy tuning interacts with the broadphase: separation distance must stay
  under the `SpatialHash` cell width (2 units) or separation silently misses
  neighbours. `config.test.ts` asserts this.
- Adding to `ENEMY_TYPES` means touching `WAVES.HP_PER_WAVE`, `composition()`,
  and the `Object.entries(ENEMY_TYPES)` assertions in `config.test.ts`.
- Orbs are XP, not score: `Game.updateXps()` feeds `XpMeter`, and a level up pays
  `XP_LEVEL.HEAL` through the same `healLeft` pool the capture uses.
- The meteor shower is pure in `game/meteor.ts`; `Game` supplies the ground
  height and the blocked test, and `Arena.setSkyTint(tint)` drives the sky.
- **Settings are one bundle.** `localStorage` key `neon.settings` holds
  `{ crosshair, game, video }`; the old flat `neon.crosshair` blob is migrated
  once on first read. `Settings.setCrosshair/setGame/setVideo` each patch one
  group and then re-apply the whole bundle, so a new group only needs a
  sanitisers, a row list and a line in `Game`'s `onChange` hook.
- **The map is a screen, not a HUD widget.** `M` and `Tab` both toggle it;
  opening it pauses the game and releases the pointer, and closing it re-locks.
  `Input` calls `preventDefault()` on `Tab` so the browser does not steal the
  focus, and the settings panel swallows the key while it is open.
- The ramp mesh turns by `rampRotation(upX, upZ)` from `game/world/layout.ts`.
  The wedge is built climbing along its local +x, so the rotation has to come
  from the up vector — a `PI` flip only works for the westward ramp and left
  the north and south ramps pointing sideways.
- The dark-warehouse look comes from background, fog and the floor/wall palette.
  Do not get moody by starving the ambient/hemisphere lights — below roughly
  `1.0` hemisphere the enemy `MeshStandardMaterial`s lose their body colour and
  read as black silhouettes.
- **A plate only covers the arc the mob faces.** `Enemy.takeDamage(amount, hit)`
  cuts the damage by `ENEMY.SHIELD_CUT` / `TANK.ARMOUR_CUT` when the incoming
  direction is within `ENEMY.SHIELD_ARC` of `enemy.facingYaw`. Headshots, blade
  hits and explosions (no hit info) are never cut, and mobs turn at a limited
  rate (`ENEMY.TURN_RATE`), so flanking is the counter-play. `EnemyView` reads
  `facingYaw` — the sim's real heading — not a heading recomputed from the
  player, or the plate would cover the wrong side.
- **The rifle runs dry.** `Weapon` has a magazine *and* a reserve; a reload
  draws from the reserve, and `isDry` is only true when both are empty. Kills
  add `AMMO.DROP[kind]`, every wave adds `WAVES.AMMO_PER_WAVE`, and the reserve
  clamps at `AMMO.RESERVE_MAX`. The HUD hint swaps to "Q — KNIFE" when dry.
- The knife is a **cone query**, not a second raycast: `game/knife.ts` tests the
  arc, the reach and a vertical gate against every mob in front of the player.
  It cannot defuse a bomb.
- **A skin owns its materials.** `Gun.ts` and `Knife.ts` build their own
  `MeshStandardMaterial`/`MeshBasicMaterial` set instead of taking the shared
  `MAT.gunMetal()` etc., because a shared material cannot be recoloured per
  skin. That is a deliberate exception to "shared materials are never
  disposed": a viewmodel that owns a material must dispose it. The skin's
  palette lives in `config.ts` under `SKINS`, and a skin also swaps a part —
  the rifle's optic or the knife's blade.
- **The credits wallet is a career, the score is a run.** `Profile` (in
  `ui/Profile.ts`) lives in local storage next to the best record, so credits
  survive death; the run score does not. Every payout (`Game.killEnemy`, the
  capture, the wave clear) writes through `Profile.addCredits`, which flushes
  to storage each time, so a crash loses nothing.
- The E2E takes ~2 minutes and has a 15-minute ceiling. Budget new waits
  deliberately rather than raising the timeout.
- Ramps, platforms, enemy siege behaviour and deck capture are one system with
  several invariants that a test asserts. Read
  [Vertical navigation](#vertical-navigation-platforms-ramps-and-high-ground)
  before touching `layout.ts`, `PLATFORM_H`, `STEP_HEIGHT`, `CAPTURE` or
  `Enemy.route()`.

## Trackpads

- Re-lock taps no longer fire the gun: `pointerlockchange` resets
  `Input.firing = false` whenever pointer lock is gained, so a carried-over
  trigger pull from a tap can't enter play. `mousedown` is additionally gated on
  the pointer actually being captured, so the click that re-acquires the cursor
  cannot pull the trigger on the same press.
- **Mouse look trusts the DOM, not `Input.locked`.** The flag deliberately lags a
  lock loss by 120 ms so a brief drop doesn't hard-pause; during that window the
  pointer is free, and its deltas are measured from the real cursor — the classic
  "view teleports when the lock drops". `lookCaptured()` checks
  `document.pointerLockElement` directly instead. Two more guards sit behind it:
  `LOCK_WARMUP` swallows the cursor-warp events that arrive when the lock is
  granted, and `lookDeltaOk()` rejects single-event deltas above `LOOK_MAX`
  (600 px ≈ 79° at default sensitivity). `__NEON.inputStats()` reports
  `{ spikes, lockLosses, warmupDrops }` — rising `lockLosses` means the browser
  is dropping the pointer, not that a delta slipped through.
- Re-lock requests come from any bare document click (except while the settings
  overlay is open), so the pause screen's "click to resume" works. `mousedown`
  starts firing and `mouseup` clears it.
- Runtime behaviour of the game/state machine unchanged: movement and firing
  remain independent, which is what makes simultaneous WASD + aim possible at all.
- **The trigger has a keyboard half.** `Input.trigger` is the mouse button **or**
  `F` / `V` held, read from the held-key map rather than a second flag, so a key
  held across a pause keeps the gun firing and `blur` clears it with every other
  key. `Game` feeds the weapon from `input.trigger`, not `input.firing`. There is
  deliberately no Ctrl binding: the browser owns Ctrl+W/R/S and a page cannot
  block them, so holding Ctrl to shoot and pressing W to walk would close the tab.
- OS limitation (unchanged): many trackpads have "disable touchpad while typing"
  or palm-rejection settings enabled, which literally suspend the pad while keys
  are held. Those must be turned off in Windows/macOS settings; no browser code
  can override them. The pause screen points this out.

## Freeze / pause recovery notes

- `Input` now holds a short delay on `pointerlockchange` failure before pausing,
  so a brief lock drop during fast movement or trackpad gestures no longer
  immediately freezes and then resumes the run.
- `Game` keeps a `waveClearPending` guard so a repeated/stale `WaveDirector`
  "cleared" update cannot spam the wave-complete banner or repeated start
  announcements.
