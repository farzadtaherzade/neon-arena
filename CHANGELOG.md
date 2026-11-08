# Changelog

All notable changes to NEON ARENA. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the version numbers
match `package.json` (which is also what the build injects and the menu
displays).

## [2.3.0] — 2026-11-08

### Changed
- **Mobs take the ramp.** When the player holds a deck, melee mobs (grunt,
  runner, tank, blinker, creeper, the Colossus, a hunting sapper) route to its
  ramp mouth, then climb the slope and resume the chase at deck level — high
  ground is a fight on a chokepoint now, not a melee-safe camp. The warden
  still refuses to close: it besieges the mouth and lets its rocket volleys do
  the climbing, and sappers and witches keep lobbing from range.

### Added
- **The wave system is gone; a pressure director runs the crawl.** No wave
  number, no rounds: threat rises with time-under-pressure and never falls
  below a floor set by distance crawled, packs cost budget that regenerates
  faster as the world heats up, and they enter through district gate mouths
  when one is near — otherwise as one directional arc biased by your heading
  or where the last hit came from. Adaptive lulls (more likely when you are
  battered) end in a calm beat that heals, pays and resupplies; warden beats
  fire every 5 threat tiers. All per-kind unlock pacing, the HP/damage/speed
  curves, XP and credit payouts carry over with threat as the argument;
  records and career now show TIER (stored shape untouched).
- `tests/lightpanda-check.mjs` accepts a `CDP_URL` override, so the probe can
  drive a Lightpanda running inside WSL from Windows (whose localhost forward
  is not mirrored to the VM in NAT mode).

## [2.2.0] — 2026-11-07

### Added
- **Structure stamps + a truthful map.** Seven multi-part structure kinds
  (pillar, arch you can walk through, L-wall, bridge you can walk under,
  tower, barrier rows, ruin) roll into the home maze, wilds chunks and
  district rings alongside plain cover — multi-part AABBs, pass-under gaps
  clearing the jump-clipped eye at 3.2, nothing new standable or
  shoot-over-able. The tactical map draws each kind with its own glyph,
  capture pads show their cooldown draining as an arc, alarm masts pulse red
  when hot, and the Colossus reads as its own marker.
- **The home arena is rolled every run.** Chunk (0,0) joins the seeded
  generation: the four gatehouse decks slide along their mid-edges (one ramp
  each, always climbing from the arena side), the magenta reactor wanders the
  centre (never onto the spawn plaza), the clock tower picks a corner, and the
  maze cover is rolled one quadrant at a time and mirrored four ways — the
  same fairness rule the authored maze used. A new seed rolls on every
  restart; `?test` keeps its fixed seed, so the E2E pins stay deterministic
  (region 0 is now 34 obstacles / 4 ramps under it). Every layout invariant
  (ramp-on-deck-face, deck lanes, spawn plaza, bounds) is now asserted across
  several seeds instead of one fixed layout, and the tactical map draws the
  rolled home from the live tables.
- **Shop round**: skins for the SMG, SCATTERGUN and DMR (MIDNIGHT/SCRAP/VOID
  palettes); the equipped skin's glow tints tracers and muzzle flash; the
  SKINS tab split into RIFLES / BLADES / GUNS / ARMORY groups.
- **Perk depth**: every perk carries a tag (mobility/firepower/utility) shown
  on its card; offers lean toward the player's dominant tag; one REROLL token
  per run regenerates the offer.
- **Difficulty selector**: EASY/NORMAL/HARD on the menu, persisted; scales
  enemy HP/damage/speed and credit payouts; best records are per difficulty
  (storage migrates to v3).
- **Career stats + records**: the profile accumulates kills per kind, shots,
  hits, runs, best wave and time played (storage migrates to v4); the record
  store keeps a top-5 runs list per difficulty; the menu's RECORDS button
  opens a career screen; the game-over line shows the run's rank.
- **Lightpanda probe**: `tests/lightpanda-check.mjs` smoke-checks the game
  through the Lightpanda browser over raw CDP (DOM health; WebGL unbootable
  there by design of the report).

### Fixed
- `Records.ts` was left out of the storage-envelope round; it is now enveloped
  and migrated like the other persisted keys.

## [2.1.0] — 2026-10-30

### Changed
- **EMBER OPS is the new default face**: gunmetal structures under an amber
  sun, tactical panel chrome with corner brackets, tighter title tracking, and
  a themed minimap/tactical map. Synthwave, Industrial, Toxic and Blood Moon
  stay selectable in Settings → VIDEO.

### Fixed
- **P0**: the boot build stopped registering collision when the theme system
  rerouted it through the rebuild path — the player walked through every wall.
  The smoke suite now pins the boot registry exactly (46 obstacles, 4 ramps).
- The settings modal was translucent enough for the menu glow to bleed through;
  it now owns the screen.
- A settings key collision let the crosshair group's `bloom` row steal the
  video group's BLOOM toggle binding.
- Two smoke-suite flake roots: stray XP orbs banking mid-assertion, and a
  strafing boss dodging single aimed meteor strikes.

### Added
- **Perk offer redesign**: each card carries a theme-tinted icon, the exact
  numbers the pick buys (not flavour text), ammo-style stack pips, arrow-key +
  Enter selection with a highlighted card, punchier hover/press states, and a
  compact phone-landscape layout.
- **Versioning**: the build injects `package.json` version + git hash
  (`__APP_VERSION__`); the menu, settings footer and console banner display it;
  `__NEON.version()` exposes it to the suite.
- **Versioned storage envelopes**: `neon.settings`, `neon.profile` and
  `neon.record` persist as `{ v, data }`; old payloads read as v1, future
  versions are never downgraded, and both sanitisers keep stripping unknown
  fields (the version lives outside them).
- Release kit: changelog, `npm run release` (bump + tag + push), Playwright
  retries, and a version-consistency test.

## [2.0.0] — 2026-10-29

### Added
- Arena themes: palette hub in config with four presets (Synthwave,
  Industrial, Toxic, Blood Moon), live world rebuild on switch, UI accents
  driven by CSS tokens.
- Optional bloom pass (three's own composer, VIDEO toggle, off by default) and
  a CRT scanline/vignette layer (off on touch first launch).
- XP perks: every level crossed pays a repair and offers a pick of three
  run-only upgrades (8 perks, stack cap 2), pausing the run behind the offer.
- The WARDEN: a unique boss on every fifth wave — keeps its distance, lobs
  rocket volleys through the bomb pipeline, slams up close; top-screen health
  bar and boss payouts.
- The four-gun arsenal: rifle plus SMG, SCATTERGUN and DMR, unlocked in the
  shop's ARMORY section, switched with 1/2/3/4, the mouse wheel or the touch
  SWAP button; per-gun ammo economies and viewmodels.
- Touch layer, landscape lock, first-launch fire-mode ask (v2.0.0 line).
