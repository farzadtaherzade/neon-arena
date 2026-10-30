# Changelog

All notable changes to NEON ARENA. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the version numbers
match `package.json` (which is also what the build injects and the menu
displays).

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
