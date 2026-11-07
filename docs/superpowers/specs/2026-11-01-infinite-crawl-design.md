# NEON ARENA — Infinite Crawl: streaming world, deck districts, and the Colossus

Date: 2026-11-01
Status: approved approach (directional crawl + deck districts + new boss kind); this document is the build contract.

## Intent and why

NEON ARENA is a fixed 84×84 arena. The player asked for two things: make the
world **infinite**, and add **dungeons and boss fights**. After laying out the
options they picked the ambitious combination:

- **Directional crawl** — terrain generates ahead along your push, difficulty
  climbs with distance from spawn, waves feel like room populations.
- **Deck districts** — the capture-deck loop recurs out in the wilds.
- **A new boss kind** — a unique guardian enemy, not a reskin.

The why: the game's moment-to-moment loop (shoot, capture, survive) is strong
but finite; an endless crawl gives it progression and a reason to keep playing
past wave 20.

## Goals

1. The player can walk in any direction forever. Terrain streams in and out in
   84×84 chunks around them. **The authored arena survives as chunk (0,0)** —
   spawn plaza, reactor, clock tower, its four decks, and every existing unit
   invariant that pins it.
2. The crawl direction matters: wave spawns bias toward where the player is
   pushing, and enemy toughness scales with distance from spawn.
3. Deck districts recur in the wilds: some generated chunks carry one deck +
   ramp + capture pad + alarm mast, so the capture loop continues anywhere.
   Capture becomes dynamic (pads stream with chunks; the live pad is the
   nearest available one, per-district cooldowns).
4. A new boss kind — **the Colossus** — guards wild deck districts. It wakes
   when a capture on its district starts and must die for the capture to bank.
   It uses the existing boss bar. Its toughness scales with distance.
5. All gates stay green: `typecheck`, `npm test`, `npm run lint` (no NEW
   diagnostics beyond the pre-existing baseline), `npm run test:e2e`.

## Non-goals (v1)

- No saving/progression across runs beyond what exists (credits profile).
- No minimap fog-of-war, no chunk persistence (chunks are pure functions of
  coordinates + run seed — revisiting rebuilds them identically).
- No interior "rooms and corridors" dungeon geometry — the maze language stays
  open cover blocks; "dungeon" = walled deck district compound + guardian.
- No vehicle/mount, no fast travel.
- The warden boss waves continue unchanged alongside the Colossus.

## Anti-goals (what would make this a failure)

- Visible pop-in: terrain must never materialise inside the fog range.
- The player ever reaching unloaded space (the frontier is walled).
- A wall of new perf cost while standing still: idle frame time within ~10% of
  today at boot; no per-frame allocations on the streaming path.
- Breaking the authored arena: existing unit invariants (deck lanes, spawn
  plaza, ramp faces) must keep passing for chunk (0,0).

## Constraints (from the codebase audit)

- `CollisionWorld` linear-scans; the arena-wall clamp lives in
  `resolveCircle` (collision.ts:118). Live references are handed out once:
  `EnemyWorld.ramps` (must be mutated in place, never replaced),
  `arena.solids` (re-pointed after theme rebuilds), capture pads, map towers.
- Boot registers colliders inside `Arena.rebuildWorld()` via `blockAt` — mesh
  and collider are born together; `registerCollision` guards theme rebuilds.
- Absolute clamps to remove: `plantBomb` (Game.ts:888), meteor targets
  (meteor.ts:174), `ENEMY.SPAWN_FALLBACK [0,22]`.
- `SpatialHash` keys are only correct within ±128 units.
- Stars (origin-centred radius 130), sun shadow camera (±54 ortho), and corner
  lights (±40) are pinned to the origin.
- MapScreen imports the static layout tables and frames ±HALF.
- The smoke spec pins 46 obstacles / 4 ramps at boot.
- No new lint diagnostics (pre-existing baseline: 84 errors / 62 warnings on
  this checkout).

## Approaches considered

1. **Chunk-streamed open maze with a walled frontier (CHOSEN).** 84×84 chunks;
   a 3×3 (growing to 4×4 with hysteresis) square streams around the player;
   the loaded square's outward edges carry perimeter wall segments so the
   player can never see or reach unloaded space; fog untouched. Authored chunk
   (0,0) keeps the authored tables. Generated chunks are seeded scatter in the
   same maze language with forced-clear border lanes.
   - Trade-off: walls recede as you move (a visible "world edge" that follows
     you), but it reuses the arena's existing visual grammar (a walled field
     with sky beyond) and keeps loaded geometry, collider counts and the fog
     budget exactly where they are today.
2. **Fully open streaming with fog trimmed to the load radius.** No frontier
   walls; fog far reduced to ~120 and load radius sized to match. Rejected:
   claustrophobic fog changes the mood of every theme, and matching load
   radius to fog forces many more live chunks (49–81) with real perf cost on
   the software-rendered E2E machine.
3. **Hub + separate dungeon instances.** Arena stays finite; portals load
   generated levels. Rejected by the user (they chose directional crawl).
4. **Scaled warden as district boss.** Cheapest, rejected by the user (they
   chose a new boss kind).

## The decided design

### A. Chunk engine

- `CHUNK = 84` (=== `WORLD.ARENA`), new config `CRAWL` group:
  `{ CHUNK: 84, VIEW_RADIUS: 1, UNLOAD_RADIUS: 2, LOAD_AHEAD: 30, ... }`.
- `src/game/world/chunks.ts` (pure, unit-tested): given `(cx, cz, seed)` it
  returns the chunk's tables — cover obstacles `[x, z, w, h, d]` in world
  coordinates, and for district chunks the deck/ramp/pad placement.
  - Deterministic per seed: `Rng` seeded by a hash of `(cx, cz, seed)`.
  - **Border lanes clear**: the outer 3 units of every generated chunk are
    free of cover, so the world can never seal a route.
  - Density: 10–16 cover blocks, sizes drawn from the authored kit's range.
  - **Deck district**: a chunk is a district iff its seeded hash passes
    (~1 in 5 wilds chunks) and it is not (0,0). Districts carry ONE deck
    (7×7, PLATFORM_H) at a seeded spot with clearance, one ramp onto it
    (authored ramp numbers: 4.4 wide, 6 long), the capture pad + alarm mast,
    and 2–3 cover blocks. The ramp's high edge lands exactly on the deck face
    (the existing invariant, re-asserted per generated district in tests).
- `CollisionWorld` gains regions: `addObstacle(aabb, top, region)` /
  `addRamp(ramp, region)` / `removeRegion(region)`; region 0 = authored chunk,
  never removed. Queries stay linear scans (live counts stay in the dozens to
  low hundreds — the existing discipline comment gets a "when to upgrade".
- `Arena` gains `buildChunk(chunk: ChunkTables)` / `disposeChunk(id)`:
  per-chunk `THREE.Group` added to `worldGroup`, owned geometries disposed on
  unload (same contract as `disposeWorld`), colliders registered into the
  chunk's region, solids appended and retracted. Theme rebuild iterates all
  loaded chunks instead of the one static build.
- `Game.ensureChunks(px, pz)` runs each step (pure math), builds at most one
  chunk per frame, unloads beyond `UNLOAD_RADIUS`.
- **Frontier walls**: when a chunk is the outermost loaded in a direction, its
  outward edge gets the existing `makeWall` segment (region-scoped, removed
  when a farther ring loads). The authored chunk loses its own four walls.
- Sky follows the player: star Points re-centred on the camera each frame;
  sun + its shadow ortho re-centred on the player; the four corner lamps
  repositioned to the current chunk's corners.

### B. Streaming capture (deck districts)

- `capture.ts` (pure) reworked: pads are dynamic entries
  `{ id, x, z, y, cooldownLeft }` registered by the streaming layer; the live
  pad is the nearest registered pad whose cooldown has expired; hold/decay/
  bank maths unchanged; per-pad cooldown state dies with the pad's chunk.
- `CapturePad` views (ring/disc/beam/mast) are created per district chunk and
  disposed with it (they already own their materials).
- `TowerAlarm` becomes id-keyed (Map) so towers can stream; rising-edge siren
  semantics unchanged.
- Minimap towers + MapScreen read the dynamic pad list; MapScreen becomes
  player-centred over the loaded square (it stops importing the static
  layout tables).
- Authored chunk keeps its four decks → capture works at spawn exactly as
  today; the live-pad-nearest rule degrades gracefully to the authored set.

### C. Crawl systems

- **Spawn bias**: `WaveDirector` keeps a smoothed crawl heading (player
  velocity, low-pass). `pickSpawn` biases the ring-angle distribution toward
  the heading (e.g. ±60° cone mixed with uniform) so the push direction feels
  populated. SPAWN_FALLBACK becomes player-relative.
- **Distance difficulty**: `distScale(dist)` in waves.ts —
  `1 + dist * WAVES.DIST_GAIN` (dist in chunk units from spawn, euclidean),
  multiplied into the per-spawn HP bonus and dmg bonus at `scaleUp` time.
  All new numbers live in `config.ts` (`WAVES.DIST_GAIN`, district/boss
  scaling), asserted in `config.test.ts`.
- Clamps removed: bomb targets, meteor targets, spatial hash key wrapped
  (`((cx+512)&1023)*1024 + ((cz+512)&1023)` with a comment on the range).

### D. The Colossus (new boss kind)

- New `EnemyKind 'colossus'` wired through the full per-kind checklist
  (kinds, ENEMY_TYPES, ENEMY_LOOKS ×2, TURN_RATE, HP_PER_WAVE, CREDITS.KILL,
  AMMO.DROP, XP.VALUE — config.test parity enforces it). Never in normal
  `composition()`; it is summoned by the capture layer.
- Kit = composition of existing behaviours at boss scale, tuned in a
  `COLOSSUS` config group:
  - **Charge**: runner-pounce mechanics with boss numbers — 0.6 s glowing
    tell, then a rush (≈2.5× speed, 0.8 s) that knocks the player back hard
    and hits like a slam; long recovery is the punish window.
  - **Slam**: the tank's ground slam with `COLOSSUS.SLAM_R` reach — the
    anti-capture tool that forces you off the pad.
  - **Front armour**: `plateCut` extends to colossus at `TANK.ARMOUR_CUT`;
    flanking is the counter-play (the model's front plate is the read).
- **Trigger**: when a capture hold starts on a WILD district pad (not the
  authored four), `Game` spawns the district's guardian at a seeded point in
  the district; banner "THE COLOSSUS AWAKENS". The capture cannot bank while
  its guardian lives (hold pauses at full, disc resumes after the kill).
  Its stats scale with the district's distance (`distScale`).
- Boss bar: `HudModel.boss` widens to "first live boss of (warden | colossus)".
- Model: new `MobModel` builder — massive low-slung siege frame, ember-glow
  seams (the tell surfaces), added to `mobWarmup`.

### E. Tests

- Unit (new `tests/unit/chunks.test.ts`): determinism (same seed+coords →
  same tables), border lanes clear of cover, districts spaced/spawned per
  hash, district ramp-high-edge lands on its deck face, deck clearance, no
  cover inside the authored chunk's protected footprints when regenerating
  (0,0) is excluded.
- Unit: capture dynamic-pad behaviour (nearest rule, cooldown, guardian-gate),
  alarm id-keyed rising edge, waves spawn-bias distribution + distScale
  monotonicity, colossus charge/slam/armour, spatial hash correctness beyond
  ±128 (two enemies 200 units apart separate correctly).
- Existing tests: authored-chunk invariants keep passing (scoped to the
  authored tables); the wall-clamp test is replaced by frontier-wall
  behaviour; smoke's boot collider pin changes from `46` to the new boot
  reality (authored 42 + no perimeter walls; documented in the spec), and a
  new smoke step: walk the player into a neighbouring chunk and assert
  colliders grew and the frontier moved.

## Builder check — rulings (2026-11-01, settled by the design owner)

1. **Frontier math corrected: no frontier walls at all.** With a 3×3 window the
   frontier sits 84–168 out — deep inside fog far (190), so chunks would pop
   visibly. Revised: the loaded square is **5×5 chunks (VIEW_RADIUS 2)**,
   re-centring when the player crosses a chunk boundary. New chunks appear at
   ≥168 units — ~88% fogged, an invisible pop; unloads happen a full ring
   farther (≥252). Fog is untouched. The build scheduler amortises one chunk
   build per frame, **except** when the player is within 30 units of the
   loaded boundary, in which case it builds synchronously (a rare hitch beats
   falling off the world). The hard safety net is a 3-line clamp in `Game`:
   the player position is clamped to the loaded square inset by 2 units after
   collision — invisible in practice (the boundary is 88% fogged), and it
   makes "player reaches unloaded space" structurally impossible without wall
   meshes. The authored chunk loses its four perimeter walls; nothing replaces
   them locally.
2. **The Colossus never climbs.** Its charge respects the melee height gate
   like every mob. Its **slam is a ground shockwave that ignores the height
   gate** — the anti-capture tool, the same family as "explosions pass no hit
   info" and the warden's rockets reaching a deck. A pad holder eats
   shockwaves on the tell by stepping off/on; the deck-safety invariant for
   normal mobs is untouched.
3. **Nearest-available replaces wave rotation everywhere.** One selection
   mode: the live pad is the nearest registered pad whose cooldown has
   expired; if every pad is cooling there is no live pad (no beam, no hold).
   The authored chunk degrades gracefully to this rule; existing capture
   rotation tests are updated to the nearest rule.
4. **Boot loads the full 5×5; the run seed is fixed under `?test`** (constant)
   and random per run otherwise — boot collider counts are deterministic in
   the E2E. The smoke collider pin becomes "authored region 0 contributes
   exactly 42 obstacles / 4 ramps" (unit-pinned) plus an E2E
   `toBeGreaterThan` sanity check; a new smoke step walks the player into a
   neighbouring chunk and asserts colliders grew.
5. **Guardian lifecycle**: the Colossus counts in `aliveCount` like any
   straggler. The capture gate is **stateless and spatial**: the hold pauses
   at full while any live Colossus is within 40 units of the pad — no id
   bookkeeping, survives chunk unload (the mob chases you regardless), and
   two districts can gate independently. Abandoning the district mid-fight
   just decays the hold; returning re-gates on the same living boss.
6. **A district reads as a dungeon**: the deck sits inside a loose compound
   ring of 4–6 tall slabs with two gaps as gates — same obstacle language, no
   new collision types, but it looks like a place, not a deck in a clearing.

## Left to the builder

- Exact generated-chunk scatter recipe (rng-driven, within the stated density
  and lane constraints).
- Exact config numbers for `CRAWL`, `WAVES.DIST_GAIN`, `COLOSSUS.*` — first
  pass, then playtest.
- How aggressively the spawn cone biases (start at 70% biased / 30% uniform).
- Interior naming of pure helpers; file split within the stated modules.

## Build order (each stage ends with the full gate run)

1. Chunk engine (pure generation + collision regions + Arena streaming +
   frontier walls + sky/sun/lights follow) — the world becomes infinite.
2. Streaming capture + alarms + maps — deck districts live.
3. Crawl systems (spawn bias, distance difficulty, clamp removal, hash wrap).
4. The Colossus + guardian trigger + tests.

## Update — 2026-11-07: the home arena joins the roll

This doc's Goal 1 ("the authored arena survives as chunk (0,0)") is amended by
`2.2.0`: chunk (0,0) is now **generated** from the run seed like any other
chunk. What survives is every invariant, not the fixed tables:

- The four decks keep their mid-edges and radial position (so the outer lane
  survives), but slide along the edge per seed; each keeps exactly one ramp
  climbing from the arena side.
- The reactor wanders near the centre, never onto the spawn plaza; the clock
  tower picks one of the four corners.
- Maze cover is rolled one quadrant at a time and mirrored four ways — the
  same fairness rule the authored quadrant followed — and any block whose
  mirrors would touch a protected footprint (decks, ramps, landmarks, spawn
  plaza) is dropped whole, so anchors stay clear and the maze stays symmetric.
- The unit invariants this doc pinned are re-asserted per seed across several
  seeds (`collision.test.ts`); the boot smoke pin is derived from the fixed
  `?test` seed (34 obstacles / 4 ramps in region 0).
- Home meshes/colliders stay on the region-0 boot path (`Arena.rebuildHome`
  re-registers on a new seed); the streamed (0,0) table contributes only its
  floor plane, and `MapScreen` reads the rolled tables live.
