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
  world/         collision.ts (AABB/cylinder), layout.ts (arena constants)
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
- **Ramps are height fields, not boxes.** `CollisionWorld.addRamp()` stores a
  sloped surface; it is deliberately absent from `obstacles` because a flat
  `top` cannot describe a slope. `groundHeight()` returns the interpolated
  height and `resolveCircle()` only blocks a ramp where that surface is higher
  than the caller's step allowance (so the toe is walk-on and the high side is
  a wall). Registering a ramp with `addObstacle` instead makes it an
  unclimbable wall; skipping `addRamp` makes it decoration — the old bug.
- **High ground has exactly one way up.** `PLATFORM_H` (1.6) is above
  `STEP_HEIGHT` *and* above the jump apex, so the ramp is the only route for
  the player and for mobs. Mobs get there via `Enemy.route()`, which aims at
  the mouth of the ramp whose top is nearest the player; break that and they
  revert to grinding against the platform wall. `ENEMY.ATTACK_RISE` is what
  stops them hitting through the deck.

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
