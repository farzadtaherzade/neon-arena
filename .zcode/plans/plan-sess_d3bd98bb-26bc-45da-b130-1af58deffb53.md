# UI + Map restyle: "Glass terminal"

## Context

The current UI is a dated neon-tactical look (Consolas mono everywhere, uppercase + huge letter-spacing, sharp corners, heavy glows) sitting on top of a genuinely good token system. The user wants a better, more modern style for **the UI and the maps**. The map canvases (the 168px radar and the 720px tactical map) are functional but flat — bare rects and hardcoded colors.

**Chosen direction** (asked, no answer received — proceeding with the recommended defaults; easy to veto):
- **Glass terminal** — frosted translucent panels, soft 10–14px radius, layered depth, thin accent energy lines, display font for headers + mono for data.
- **Scope: 2D only** — HUD, all screens, both map canvases. The 3D world / `THEMES` palettes are untouched.
- **Typography: bundled fonts** via `@fontsource` (offline after build, no external requests): **Chakra Petch** (display) + **JetBrains Mono** (data/numerals).

## Hard constraints (from AGENTS.md / existing code — must all hold)

- `:root` `--accent: #ffb347` / `--danger: #ff3b4e` defaults stay — they track `DEFAULT_THEME` (ember). Theme swap still only writes these two vars (`Game.applyUiTheme`, `src/app/Game.ts:713`).
- z-index stack unchanged: hud 5, touch 6, `.screen` 10, map 15, settings 20, fireMode 30, rotate 40, CRT 50.
- `#hud` stays `pointer-events: none`; touch layer keeps its stop-propagation contract; per-screen `cursor` overrides stay.
- `.screen` visibility trick stays (transition `opacity` **and** `visibility` — idle screens must drop out of the paint tree). Backdrop blur stays modest (≤ ~14px, one layer per screen) for the software rasterizer and phones.
- All existing element **ids** and TS-toggled **classes** keep their names (tests + TS hook them); we only add classes/attrs. The crosshair `.ch` custom-property contract with `Settings.renderCrosshair` is untouched.
- Canvas redraws stay allocation-disciplined: only primitives + the existing `accent()` string pattern.
- No changes to `config.ts`, no gameplay/sim changes.

## Changes

### 1. Foundations — fonts + design tokens
- `npm i @fontsource/chakra-petch @fontsource/jetbrains-mono`; import the weights (400/600/700 + 500/700) in `src/main.ts` next to the existing CSS import.
- Rewrite the `:root` block in `src/styles.css:3-13`: keep `--accent`/`--danger` + their `color-mix` derivatives, and add the new token set:
  - surfaces: `--bg`, `--glass`, `--glass-strong`, `--line` (hairline), `--line-accent`
  - text ramp: `--ink`, `--ink-2`, `--ink-3`
  - status tokens: `--ok`, `--warn`, `--gold`, `--poison`, `--info` (defines `--gold`, today referenced-but-undefined at `styles.css:1018`)
  - shape/type: `--r-sm: 6px`, `--r-md: 10px`, `--r-lg: 14px`, `--blur`, `--font-display`, `--font-mono`
- Remove the unused `:root --gap` (the crosshair's local `--gap` in `.ch` is separate and stays).

### 2. Screens & components restyle (`src/styles.css`, section by section, same order)
- **`.screen`**: deep radial backdrop with a faint accent tint at the edges; **`.panel`** and new card surfaces become glass: translucent fill, `--r-lg` radius, 1px hairline border, a 2px top accent edge line, single backdrop blur.
- **`.btn`**: glass chip in `--font-display`, radius 10, hairline border; hover = accent border + soft glow + slight lift; `.btn.primary` = accent-tinted glass with stronger edge. Keycaps (`.cap`) become rounded mono chips.
- **HUD** (`styles.css` + tiny `Hud.ts` edits): panels → floating glass chips; bars (health/xp/stamina/reload/capture/boss) → thinner rounded tracks with inset glass; kill feed, hitmark, banner, bomb/poison warnings restyled to match.
  - `src/ui/Hud.ts:280-285`: replace the inline hardcoded 3-band gradient with a `data-band="hi|mid|low"` attribute write inside the same diff-cache branch; the three gradients move to CSS using `--ok`/`--warn`/`--danger`.
- **Settings modal** (`#settingsScreen`): remove the stray `panel` class in `index.html:122` (kills the full-viewport bracket decorations), restyle as a glass sheet; tabs → segmented glass control; ranges/toggles/swatches/selects restyled.
- **Perk cards** (`src/ui/Perks.ts:19-23`): delete `TAG_COLORS` inline colors → write `data-tag="mobility|firepower|utility"` on the card; tag colors move to CSS tokens. SVG icons already recolor via `var(--accent)` — unchanged.
- **Skin cards**: style the already-toggled `.owned` state (dimmed + "OWNED" chip) — no TS change.
- **Career, boss bar, capture, rotate/fireMode screens**: restyle only.
- **Touch layer** (`styles.css:1107-1233`): glass circles/buttons, same geometry and z/pointer contracts; minimal or no backdrop blur here.
- **CRT layer**: keep the toggle and z 50; soften scanline/vignette opacity slightly so glass reads through.
- Update both media-query blocks to the new scale.

### 3. Minimap redraw (`src/ui/Minimap.ts`, `src/app/Game.ts`, `styles.css`)
- Keep the player-up projection, circular clip, and per-frame discipline.
- `Game.ts:1895`: pass the live capture deck (`cap.decks[cap.active]`, already computed at `Game.ts:1824`) as a new optional arg to `minimap.draw()`.
- New drawing: faint range rings + rim heading ticks; **live objective pip that clamps to the rim** when out of range (real wayfinding win — today it just vanishes); theme-accent outer ring via existing `accent()` (`src/ui/theme.ts`); hostiles keep their kind colors, towers/bombs keep pulsing semantics but read danger tokens via consts; glass backing + vignette done in CSS on `#minimapWrap`.

### 4. Tactical map redraw (`src/ui/MapScreen.ts`, `index.html`, `styles.css`)
- DOM chrome around the canvas (static, in `index.html:174-180`): header row (title + player sector coords element), a legend strip (deck / district / landmark / hostiles / bomb), keep the existing hint line.
- Canvas restyle, same data sources (`ChunkTables`, `REACTOR_SIZE`/`TOWER_SIZE`):
  - subtle coordinate grid; chunk floors slightly lighter with faint borders;
  - cover as filled rects with a lighter top edge; decks as accent-tinted **fills** with bright outlines; ramps as accent chevrons;
  - reactor → magenta ring + core glyph, clock tower → gold diamond (replacing plain rects);
  - player gets a facing cone + soft pulse ring; hostiles keep kind colors; bombs keep the pulsing ring;
  - restyled compass `N` + a scale bar; palette derived from `accent()` + token consts instead of scattered hex values.

### 5. `index.html` edits (minimal)
- `#settingsScreen`: drop `panel` class.
- Map screen chrome wrappers (header/legend) with new classes.
- All ids untouched.

## Files touched
`package.json`, `src/main.ts`, `src/styles.css` (bulk), `index.html`, `src/ui/Hud.ts`, `src/ui/Perks.ts`, `src/ui/Minimap.ts`, `src/ui/MapScreen.ts`, `src/app/Game.ts` (one-line minimap arg). `Skins.ts`, `Touch.ts`, `theme.ts`, config/sim: no changes.

## Verification
1. `npm run typecheck`, `npm test`, `npm run lint`.
2. `npm run test:e2e` — UI/rendering is touched, so the full Playwright gate runs (it boots the production build and asserts HUD/screens/GPU hygiene; ~2 min).
3. Manual pass on `npm run dev` with `?test`: menu → deploy → HUD (`__NEON.hurt(80)` for low-HP band), `M` map, `C` settings (each tab + a theme swap to confirm `--accent` propagation), skins/perks screens (`__NEON.grantCredits`, `__NEON.perkOffer`), and `?test&touch` for the touch layer. Check both maps follow an accent-heavy theme (synthwave) and the default ember.