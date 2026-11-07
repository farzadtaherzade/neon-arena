# Structure variety and a map that tells the truth

Date: 2026-11-07 · Status: draft, awaiting approval · Follows PR #8 (rolled home arena)

## Intent and why

The world is a box farm. Every solid structure — home maze, wilds chunks, district
rings — is the same `makeCover` silhouette: a slab with panels and trim, at
different sizes. The player asked for "many structures" and a "more interactive
map". Reading it with the codebase in hand: the world needs **a vocabulary of
shapes**, and the tactical map needs to **draw those shapes and the live objective
state** instead of one rectangle style. The conversation produced no finer
specification (three prompts went unanswered), so the scope below is my call,
marked as such.

## Goals

- A stamp vocabulary of ~7 structure kinds, baked in `StructureKit`'s merged-box
  style, palette-driven, theme-safe.
- All three generators (home, wilds, districts) roll kinds, not just slabs.
- At least one kind you can move *through* (arch) and one you can move *under*
  (bridge) — new traversal feelings with zero new collision tech.
- The M-screen draws each kind distinctly and shows live state: capture-pad
  cooldowns, guardian markers, alarm heat.

## Non-goals (this round)

- Structure behaviour — destructible cover, explosive barrels, jump pads, doors.
  Real surface (per-obstacle collider removal does not exist; the E2E leak test
  watches geometry churn). Next round, on top of the new shapes.
- Pan/zoom or tap-to-ping on the map (ping needs a world-side consumer system).
- New collision primitives: everything stays AABB footprints + the one ramp.

## Constraints (from the codebase, fixed)

- Collision speaks 2D AABB footprints with a `top`; a multi-part structure
  registers one AABB per part (arch = two legs; bridge = four legs + a solid
  slab that bullets stop on but feet pass under).
- `StructureKit` merges coloured boxes into one lit shell + one glow trim per
  structure, shared `MAT.structure`/`structureGlow`; per-structure geometry is
  created per instance and disposed on unload (the E2E leak test tolerates
  one-time uploads only). New recipes follow `assemble()` — no new materials.
- A theme swap rebuilds the world from tables; recipes must be palette-driven.
- Chunk tables are pure functions of `(cx, cz, seed)` — stamps roll in
  `buildChunk`, never persist.
- The rolled home (PR #8) keeps its protected footprints: spawn plaza, decks
  and ramps, reactor, tower. Stamps respect them via the same drop rule.
- Hot-path discipline: stamps bake once per chunk build; the map redraws per
  frame while open and may not allocate per frame beyond today's snapshot.

## Approaches considered

1. **Multi-part plain cover, no schema change.** An "arch" is just two cover
   tuples; nothing new anywhere. Cheapest, and it fails the ask — the
   silhouettes stay crates; the map cannot tell an arch from a slab. Dropped.
2. **Kind-tagged stamps (chosen).** `ChunkTables` gains optional
   `stamps: { kind, at, boxes, accent }[]`; generators roll stamps (some plain
   cover stays for texture). Collision registers `boxes`; rendering builds
   `makeStamp(kind)`; the map draws the glyph. One small schema, full variety.
3. **Behaviour round first.** Explosive/destructible cover on today's boxes.
   Puts the cart first: the user's words were "many structures"; behaviour
   without shape variety makes the same slabs explode. Deferred to round two.

## The stamps (my call on the roster — 7)

Three height questions came out of the builder check; my answers are calls,
correctable before build:

1. **No low cover this round.** Every stamp collider stays ≥ 2.2 tall, as every
   collider today is — nothing new is standable or shoot-over-able, and "decks
   are the only high ground" survives untouched. (Barriers and the ruin's
   rubble skirt are visual trim, not colliders.) Low, shoot-over cover is a
   behaviour-round idea.
2. **Pass-under clearance is 3.2, not 2.2.** The original 2.2 justified itself
   as "player + jump apex" but ignores the *eye*: eye 1.7 + apex 1.39 ≈ 3.09,
   and with no ceiling collision a jump under a 2.2 slab clips the camera
   through the mesh. Bridge slabs and arch lintels sit at 3.2 — jump-under
   stays clean; the bulkier silhouette is welcome variety.
3. **Home's stamp pool is pillar / barrier / ruin / lwall only.** Arch and
   bridge are wilds discoveries (districts keep the pillar swap) — the first
   thirty seconds keep PR #8's character, and traversal mechanics are learned
   out in the crawl.

| Kind | Silhouette | Colliders | Traversal |
|---|---|---|---|
| `pillar` | Tall thin column, banded | 1 AABB | blocks |
| `arch` | Two legs + lintel at 3.2, hazard chevrons over the gap | 2 legs | **walk through** |
| `lwall` | L-shaped corner wall | 2 AABBs | blocks a corner |
| `bridge` | Slab (underside 3.2) on four legs, walkable gap beneath | 4 legs (+slab solid for bullets) | **walk under** |
| `tower` | Tapering stacked sections, lit window slits | 1 AABB | blocks + sightline |
| `barriers` | 2–3 short zigzag segments, all ≥ 2.2 tall | 2–3 AABBs | cover row |
| `ruin` | Broken slab cluster, tilted trim, rubble skirt (trim only) | 2–3 AABBs | texture |

Roll weights: wilds ~1 in 3 cover slots becomes a stamp (pillar/arch/barrier
weighted highest); home quadrants roll 1–2 stamps from the home pool among the
plain blocks; districts may swap up to two ring slabs for pillars. Arch gap is
3.4 wide, centred.

## The map (my call on "more interactive")

- Per-kind glyphs: pillar = fat dot, arch = two ticks with a gap, lwall =
  L-shape, bridge = hollow rectangle with leg dots, tower = tall thin rectangle,
  barriers = short dashes, ruin = broken rect cluster. District compounds keep
  their slab rectangles.
- Live state, drawn from what `Game` already holds: capture pads as cooldown
  arcs (ring empties as the deck cools), district guardians as a purple dot
  until slain, alarm-hot towers pulse (data already flows through
  `mapTowers[].hot`), the live deck keeps its beam-coloured outline.
- No pan/zoom, no ping this round (non-goals above).

## What's left to the builder

- Exact stamp proportions, trim placement and accent colours (kit patterns
  exist in `makeCover`/`makeDeck` to copy).
- Roll weights fine-tuning so density stays near today's (home ≈ 24–36 blocks
  incl. stamp parts; wilds 10–16 slots).
- The boot E2E pin (region-0 obstacle count) recomputed once under seed
  `20261101` — it shifts because a stamp registers 2–4 colliders.
- MapScreen glyph coordinates under its `rect()`/`project` helpers.

## Tests

- `chunks.test.ts`: stamps respect border lanes, protected footprints, pairwise
  box overlap; determinism per seed; bridge headroom and arch gap invariants.
- `collision.test.ts` layout block: iterate seeds, stamp boxes join the box
  list (bounds, spawn plaza clear).
- `config.test.ts`: new `STAMPS` group sanity (weights sum sensible, headroom >
  jump apex).
- Smoke: boot pin recompute; the map-open assertion still passes; GPU leak band
  unchanged (stamps bake per build, disposed on unload like cover).

## Verification

`npm run typecheck` · `npm test` · `npm run lint` · `npm run test:e2e` (full —
gameplay + rendering). Manual: `npm run dev`, walk a few runs — arches to
thread, bridges to slide under, the map reading shapes and cooling pads.
