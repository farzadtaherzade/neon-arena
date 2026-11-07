# Structure Stamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roll a 7-kind stamp vocabulary into all three world generators and make the tactical map draw shapes + live objective state.

**Architecture:** A pure `stampBoxes(kind, at, variant)` layout function in `chunks.ts` is the single source for every stamp's AABBs; generators place stamps through it (mirrored in home, dropped on protected footprints), `StructureKit.makeStamp` renders proportions *derived from those boxes*, Arena registers each box as an AABB, and MapScreen switches on `kind` for glyphs. No new collision tech: multi-part stamps are several plain AABBs; bridge slabs and arch lintels are meshes in `solids` only (bullets stop, feet pass under).

**Tech Stack:** TypeScript, Vitest, Three.js (merged-buffer StructureKit recipes), Canvas 2D map.

**Spec:** `docs/superpowers/specs/2026-11-07-structure-variety-and-map-design.md`

## Global Constraints

- Every stamp collider top ≥ `STAMPS.MIN_TOP` = 2.2 — nothing standable/shoot-over-able.
- Pass-under clearance `STAMPS.HEADROOM` = 3.2 (> eye 1.7 + apex 1.39 ≈ 3.09). Bridge leg height = 3.2; arch leg height = 4.2, lintel underside = 3.2.
- Arch gap `STAMPS.ARCH_GAP` = 3.4, centred on the stamp.
- Chunk tables stay pure functions of `(cx, cz, seed)`; home stamps obey the mirror-×4 + drop-all-4-on-protected-hit rule; outer `CRAWL.DECK_CLEAR` = 3 stays cover-free; pairwise box gap 2.5 (wilds and home).
- Home stamp pool: pillar/barrier/ruin/lwall only. Wilds pool: all 7. Districts: pillar swap only, ≤ 2 per compound.
- Recipes follow `assemble()` (shared `MAT.structure`/`structureGlow`, per-instance merged geometry disposed on unload). No new materials.
- Home density clamp: quadrant plain-cover count = `rng.int(HOME.COVER_MIN, HOME.COVER_MAX) − stampsPlacedThisQuadrant`, clamped ≥ 3.

## Review Focus

- A stamp box straddling a mirror axis in home → mirrored twins overlap: pinned by pairwise-overlap test including stamp boxes (Task 4).
- Bridge/arch pass-under clearance below 3.2 → camera clip on jump: pinned by `stampBoxes` headroom test (Task 2).
- Stamp box violating the outer 3-unit margin or a protected footprint → sealed route / spawn-blocked: pinned by margin + protected tests (Tasks 3–4).
- Boot pin drift: region-0 collider count changes with the roll — recompute once under seed 20261101 (Task 9).
- Map per-frame allocation: glyphs must draw from the passed-in arrays without per-frame object churn beyond the existing snapshot (Task 8, reviewed in whole-branch review).

---

### Task 1: `STAMPS` config group

**Files:**
- Modify: `src/game/config.ts` (after `HOME`)
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Produces: `export const STAMPS = { WILDS_ONE_IN: 3, HOME_STAMPS_MIN: 1, HOME_STAMPS_MAX: 2, HEADROOM: 3.2, ARCH_GAP: 3.4, MIN_TOP: 2.2 } as const;`

- [ ] **Step 1: failing test** in `config.test.ts` (new `it` after the home-rolls block): `HEADROOM` > `WORLD.PLAYER_H + (JUMP_V²/2·GRAVITY)` (use 3.09 as the comment's number, assert `>`), `MIN_TOP` ≥ 2.2, `ARCH_GAP` > `WORLD.PLAYER_R * 2`, `HOME_STAMPS_MIN <= HOME_STAMPS_MAX`, `WILDS_ONE_IN` ≥ 1.
- [ ] **Step 2:** run `npm test -- config` → FAIL (STAMPS undefined).
- [ ] **Step 3:** implement the group verbatim.
- [ ] **Step 4:** `npm test -- config` → PASS. Commit `feat: STAMPS tuning group`.

### Task 2: `stampBoxes` pure layout + invariants

**Files:**
- Modify: `src/game/world/chunks.ts`
- Test: `tests/unit/chunks.test.ts`

**Interfaces:**
- Produces: `export type StampKind = 'pillar' | 'arch' | 'lwall' | 'bridge' | 'tower' | 'barriers' | 'ruin';`
- Produces: `export interface StampTables { kind: StampKind; at: { x: number; z: number }; variant: number; boxes: (readonly [number, number, number, number, number])[] }` (`variant` = rolled orientation: arch/bridge/barrier along-axis 0|1; lwall/ruin flip 0|1).
- Produces: `export function stampBoxes(kind: StampKind, at: { x: number; z: number }, variant: number): StampTables['boxes']` — also exported for tests.
- `ChunkTables` gains `stamps?: StampTables[]`.

Pinned layouts (all boxes `[x, z, w, h, d]`, h ≥ MIN_TOP; `t = STAMPS.HEADROOM`):
- pillar: `[[x, z, 1.7, 4.6, 1.7]]`
- arch (variant 0 = along x): legs `[[x−2.25, z, 1.1, 4.2, 1.1], [x+2.25, z, 1.1, 4.2, 1.1]]`; variant 1 transposes w/d and offsets z.
- lwall (variant 0): `[[x−1.65, z, 4.5, 2.6, 1.2], [x+1.65, z+1.65, 1.2, 2.6, 4.5]]`; variant 1 negates the z-offsets.
- bridge (variant 0 = span along x): legs `[[x±2.6, z±1.3, 1.2, t, 1.2]]` (4 boxes); variant 1 transposes.
- tower: `[[x, z, 3.4, 5.5, 3.4]]`
- barriers (variant 0 = along x, n = 2 + (variant ≥ 2 ? 1 : 0) — variants 0..3: axis 0|1 × n 2|3): per segment i: centre offset along axis `(i − (n−1)/2) × 3.5`, lateral `(i % 2 ? 0.9 : −0.9)`, box `2.6 × 2.4 × 0.9` (transposed on axis 1).
- ruin (variant 0): `[[x−1.5, z, 5, 2.6, 2.2], [x+2.2, z+1.2, 2.2, 3.4, 2.2]]`; variant 1 swaps the two and mirrors x-offsets.

- [ ] **Step 1: failing tests** in `chunks.test.ts` (new `describe('stamps')`): every kind's boxes all have `h ≥ STAMPS.MIN_TOP`; arch variant 0 legs are exactly `ARCH_GAP + 1.1` apart on x, both h = 4.2 > HEADROOM; bridge legs (variant 0) have `h === STAMPS.HEADROOM`; determinism `stampBoxes(kind, at, v)` twice equal; home pool array `export const HOME_STAMP_POOL = ['pillar', 'barrier', 'ruin', 'lwall'] as const` excludes arch/bridge.
- [ ] **Step 2:** `npm test -- chunks` → FAIL.
- [ ] **Step 3:** implement `stampBoxes` + types + `HOME_STAMP_POOL` (weights live in the generator, not here).
- [ ] **Step 4:** `npm test -- chunks` → PASS. Commit `feat: pure stamp layout tables`.

### Task 3: wilds generator rolls stamps

**Files:**
- Modify: `src/game/world/chunks.ts` (wilds cover loop)

**Interfaces:**
- Consumes: `stampBoxes`, `StampTables`.
- Produces: wilds `buildChunk` may set `tables.stamps` (all 7 kinds; kind roll: pillar .25, arch .2, barrier .2, lwall .12, ruin .1, tower .07, bridge .06); ~1 in `STAMPS.WILDS_ONE_IN` cover slots becomes a stamp; stamp boxes join the pairwise 2.5-gap and `DECK_CLEAR` margin checks against `cover` AND prior stamps.

- [ ] **Step 1: failing tests** in `chunks.test.ts`: for all chunks in `[-3..3]²` — every stamp's boxes respect the border margin and pairwise gaps (extend the two existing loops' `blocks()` helper to include `t.stamps?.flatMap(s => s.boxes)`); `stamps` present in ≥ 1 chunk and absent from (0,0) unless home adds them (home test comes in Task 4); determinism already covered.
- [ ] **Step 2:** FAIL. **Step 3:** implement the roll (kind via one `rng.next()` against cumulative weights; position attempts 24 like cover; variant `rng.int(0, 1)` or `rng.int(0, 3)` for barriers).
- [ ] **Step 4:** PASS. Commit `feat: wilds chunks roll structure stamps`.

### Task 4: home generator stamps (mirrored, protected)

**Files:**
- Modify: `src/game/world/chunks.ts` (`buildHomeRng`)

**Interfaces:**
- Consumes: `stampBoxes`, `HOME_STAMP_POOL`, `STAMPS.HOME_STAMPS_MIN/MAX`.
- Produces: home `buildChunk(0,0)` sets `stamps` — `rng.int(MIN, MAX)` per quadrant from `HOME_STAMP_POOL` (pillar .3 / barrier .3 / ruin .2 / lwall .2), position in the quadrant under the same bounds as cover, mirrored ×4 into world coords; the existing drop-all-4-on-protected-hit rule applies to the stamp's boxes; plain-cover count per quadrant reduced by the quadrant's stamp count (clamp ≥ 3).

- [ ] **Step 1: failing tests** in `chunks.test.ts` (extend the home block): every home stamp kind ∈ HOME_STAMP_POOL; stamp boxes pass the protected-footprint test (extend `kept` usage); pairwise overlap including stamp boxes; home stamps are 4× the per-quadrant count mirrored (`|at.x|`, `|at.z|` all in quadrant bounds); determinism.
- [ ] **Step 2:** FAIL. **Step 3:** implement (mirroring: for each mirror offset apply to `at` AND every box's x/z).
- [ ] **Step 4:** PASS. Commit `feat: home maze rolls stamps per quadrant`.

### Task 5: district pillar swap

**Files:**
- Modify: `src/game/world/chunks.ts` (district branch)

**Interfaces:**
- Produces: districts may set `stamps` — up to 2 compound slots (`rng.next() < 0.45` per slot, stop at 2) replaced by a pillar stamp at the slab's own `[x, z]`; swapped slots removed from `compound`.

- [ ] **Step 1: failing test** in `chunks.test.ts` (extend the district block): for all districts in `[-8..8]²`, `stamps` kinds are all `pillar`, count ≤ 2, and every stamp position was a compound slot (pillar x,z equals a removed slab's x,z — assert via `stamp.boxes[0]` footprint containing the old slab centre… pin instead: pillar box centre == one of the compound centres removed — simplest assertion: district `stamps.length ≤ 2` and all kinds pillar, and total `compound.length + stamps.length ≤ 6`).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. Commit `feat: district compounds swap slabs for pillars`.

### Task 6: `makeStamp` recipes in StructureKit

**Files:**
- Modify: `src/render/models/StructureKit.ts`

**Interfaces:**
- Consumes: `StampKind`, `StampTables`, `STAMPS.HEADROOM`.
- Produces: `export function makeStamp(stamp: { kind: StampKind; boxes: StampTables['boxes'] }, p: KitPalette, accent: number): StructureAsset` — dispatch to 7 internal builders; every part via `box()`/`part()` into `assemble(body, glow)`; proportions derived from `stamp.boxes` (leg positions/extents from the boxes; bridge slab spans the legs' bounding rect at y = HEADROOM, thickness 0.7, mesh-only; arch lintel spans leg→leg at underside HEADROOM, height 1.0; tower adds tapering upper sections + window slits above its collider; ruin adds tilted trim + rubble skirt boxes as trim only; barriers/pillar/lwall decorate their colliders like `makeCover` does).

- [ ] **Step 1:** implement (render-only; no unit test — kit has none). **Step 2:** `npm run typecheck` → PASS. Commit `feat: seven stamp recipes in StructureKit`.

### Task 7: Arena renders + registers stamps

**Files:**
- Modify: `src/render/Arena.ts`

**Interfaces:**
- Consumes: `makeStamp`, `StampTables`.
- Produces: private `stampInto(group, stamps, region, solids)` — per stamp: `makeStamp` → position at `at`, `group.add`, push `asset.solid` to `solids`, `blockAt` per box; called from `buildChunkInto` (chunk stamps, chunk region) and from a new pass in `rebuildWorld`'s authored path via `cover()`-adjacent `stamps()` for `this.home.stamps` (region 0). Disposal rides the existing chunk-group traverse + worldGroup dispose.

- [ ] **Step 1:** implement both call sites. **Step 2:** `npm run typecheck` → PASS. **Step 3:** `npm run build` serves — manual smoke later (Task 9's E2E covers it). Commit `feat: arena renders and registers structure stamps`.

### Task 8: map glyphs + live state

**Files:**
- Modify: `src/ui/MapScreen.ts`, `src/app/Game.ts` (map draw call only)

**Interfaces:**
- Produces: `MapScreen.draw(..., chunks, live)` where `export interface MapLive { pads: { x: number; z: number; cd: number; cdMax: number }[]; towers: readonly { x: number; z: number; hot: boolean }[] }` — Game passes `{ pads: this.capture.decks.map((d, i) => ({ x: d.x, z: d.z, cd: this.capture.cooldown[i] ?? 0, cdMax: CAPTURE.COOLDOWN })), towers: this.mapTowers }` inside the existing `mapOpen` branch.
- Glyphs per `stamp.kind` (fat dot / two ticks + gap / L / hollow rect + leg dots / thin tall rect / dashes / broken rects); plain cover unchanged; colossus hostiles drawn as a larger magenta dot; capture pads drawn as a ring whose arc sweeps `(1 − cd/cdMax)`; towers as small squares, pulsing red when `hot`.

- [ ] **Step 1:** implement (draw-only; `CAPTURE` joins MapScreen's config import). **Step 2:** `npm run typecheck` → PASS. Commit `feat: tactical map draws stamp glyphs and live objectives`.

### Task 9: boot pin recompute + gates + release notes

**Files:**
- Modify: `tests/e2e/smoke.spec.ts` (pin comment + number), `CHANGELOG.md`, `package.json` stays 2.2.0, `docs/superpowers/specs/2026-11-01-infinite-crawl-design.md` unchanged.

- [ ] **Step 1:** `npx vite-node` one-off: `buildChunk(0,0,20261101)` → print `cover.length + stamps flatMap boxes + 10`; update the smoke pin + comment.
- [ ] **Step 2:** `npm run typecheck` && `npm test` && `npm run lint` → all green.
- [ ] **Step 3:** `npm run test:e2e` → 6/6.
- [ ] **Step 4:** CHANGELOG line under `## [2.2.0]` Added: structure stamps + map glyphs. Commit `feat: structure stamps ship; boot pin recomputed`.

## Self-review notes

- Spec coverage: roster ✓ (T6), generators ✓ (T3–5), map glyphs + live state ✓ (T8), heights/clearance calls ✓ (T1–2), pin recompute ✓ (T9), behaviour round explicitly out.
- Type consistency: `StampTables` fields used identically in T2/T3/T6/T7/T8.
- Proportion: plan ≈ spec length; bodies delegated except pinned layouts.
