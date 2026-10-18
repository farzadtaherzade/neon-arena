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
  weapon.ts      ammo, fire cadence, spread bloom, recoil
  bomb.ts        a planted bomb: fuse, radius, detonation
  minimap.ts     world→radar projection (pure maths)
  fx.ts          particle + tracer pools
  world/         collision.ts (AABB + ramp height fields), layout.ts (arena constants)
src/render/      everything that owns meshes
  Arena.ts       renderer, scene, camera rig, lights, floor, walls, cover
  EnemyView.ts   an enemy's meshes + health bar
  BombView.ts    a bomb's meshes + blink
  Gun.ts         the first-person viewmodel
  Pick.ts        hitscan raycasting (screen centre → world)
  Fx.ts          pooled Points/Lines on screen
  Materials.ts   shared geometries and materials (lazy, add-only)
  Textures.ts    procedural floor texture
src/ui/          DOM-facing
  Hud.ts         HUD elements, screens, banners, threat warning
  Input.ts       keyboard/mouse/pointer-lock bookkeeping
  Minimap.ts     the canvas radar
  Settings.ts    crosshair presets + tuning panel
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

## Vertical navigation: platforms, ramps and high ground

Four raised platforms sit in the arena corners, one per quadrant, each reached
by a single ramp on its arena-facing side. This is the only piece of terrain
that is not a flat box, and it touches collision, player movement, enemy AI and
the renderer at once — so the whole contract is spelled out here.

### The design intent

- `PLATFORM_H` is **1.6**. That number is load-bearing: it is above
  `WORLD.STEP_HEIGHT` (0.55) and above the jump apex
  (`JUMP_V² / 2·GRAVITY` ≈ 1.39). A platform is therefore *unreachable* by
  walking into it or by jumping at it — the ramp is the only way up, for the
  player and for the mobs. Lower it and the ramp becomes pointless again.
- Corner platforms are `6.2 × 6.2` centred at `±25`, so each outer face lands
  at `28.1` — exactly one player radius inside the walkable clamp
  (`HALF − WALL_INSET − PLAYER_R` = 28.55). That closes the old dead pocket
  between platform and wall: there is no longer a gap wide enough to wedge a
  body into. Push a platform's outer face past that and the player gets caught
  between the wall clamp and the collider push (the clamp runs first, so the
  push wins and leaves them outside the inset).

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
  the arena does not climb the wrong ramp.
- Off the ramp: aim at the mouth (its low edge pushed `RAMP_OFFSET` downhill)
  until within `RAMP_ALIGN`, which lines the body up with the slope.
- On the ramp: aim at the top (its high edge pushed onto the deck) until the
  body is level with the player.
- `ENEMY.ATTACK_RISE` gates melee by height, so a mob at the foot of a platform
  cannot claw at someone standing on it — and, symmetrically, nothing hits
  through a deck from above.

`Enemy.followGround()` runs *after* `world.collide()`, using `pos.y` as the
`feetY` for the step context. Enemies can therefore follow the slope (their
`ENEMY.STEP` is the same 0.55 the player gets) but cannot climb a platform side.

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
the floor climbs the NW ramp and reaches a player standing on that platform,
and an enemy that walks off a deck falls back to the floor.

### If you move or add a platform

1. Keep the outer face at `HALF − WALL_INSET − 2·PLAYER_R` (28.1 today).
2. Put the ramp's high edge **on** a platform face and give the tuple the `up`
   vector that points at that face; length ≈ 4 gives a walkable ~21° slope.
3. Leave the ramp mouth clear of cover blocks and the spawn ring
   (`ENEMY.SPAWN_RING ± JITTER` reaches radius 28 — a ramp at radius ~32 is
   safe, one at the arena centre is not).
4. Run `npm test` — the layout invariants above will catch a hand-placed slip.

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
  `gunVisible()`, `bombs()`, `spawnBomb(x, z)`, `forceWave(n)`,
  `crosshair()`, `setCrosshair(patch)`.

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
- The dark-warehouse look comes from background, fog and the floor/wall palette.
  Do not get moody by starving the ambient/hemisphere lights — below roughly
  `1.0` hemisphere the enemy `MeshStandardMaterial`s lose their body colour and
  read as black silhouettes.
- The E2E takes ~2 minutes and has a 15-minute ceiling. Budget new waits
  deliberately rather than raising the timeout.
- Ramps, platforms and enemy climbing are one system with several invariants
  that a test asserts. Read [Vertical navigation](#vertical-navigation-platforms-ramps-and-high-ground)
  before touching `layout.ts`, `PLATFORM_H`, `STEP_HEIGHT` or `Enemy.route()`.

## Trackpads

- Re-lock taps no longer fire the gun: `pointerlockchange` resets
  `Input.firing = false` whenever pointer lock is gained, so a carried-over
  trigger pull from a tap can't enter play.
- Re-lock requests come from any bare document click (except while the settings
  overlay is open), so the pause screen's "click to resume" works. `mousedown`
  starts firing and `mouseup` clears it.
- Runtime behaviour of the game/state machine unchanged: movement and firing
  remain independent, which is what makes simultaneous WASD + aim possible at all.
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
