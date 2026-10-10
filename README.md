# NEON ARENA — 3D Arena Shooter

A browser-based first-person 3D arena shooter built with [Three.js](https://threejs.org/).
Survive escalating waves of hostile robots in a neon-lit arena.

**No build step, no npm install, no bundler.** Plain ES modules served over HTTP.

---

## Features

- **FPS controls** — WASD movement, mouse look via Pointer Lock, sprint, jump
- **Weapon system** — 12-round magazine, infinite reserve, reload, recoil kick, muzzle flash, spread bloom
- **Three enemy types**
  | Type | HP (wave 1) | Speed | Damage | Score | Behaviour |
  |---|---|---|---|---|---|
  | Grunt | 60 | 3.4 | 10 | 100 | Standard chaser |
  | Runner | 30 | 6.2 | 7 | 150 | Fast, fragile |
  | Tank | 200 | 2.2 | 22 | 300 | Slow, high HP, big damage |
- **Wave system** — enemy count, HP and speed scale per wave; clearing a wave restores 25 HP
- **Headshots** — deal 2.5× damage and a score bonus
- **Feedback** — hitmarkers, enemy health bars, damage vignette, screen shake, particles, tracers
- **Procedural audio** — Web Audio API synth, no sound files needed
- **HUD** — score, wave, hostile count, integrity bar, ammo counter, reload progress
- **Pause / game over / restart** flow

---

## Requirements

- A modern browser with **WebGL**: Chrome, Edge, Firefox, or Safari (2019+)
- **Internet on first load** — Three.js comes from a CDN (`jsdelivr`, falling back to `unpkg`)
- Any static file server. The game will **not** run from a `file://` URL, because
  browsers block ES modules there.

---

## Setup & Running

Nothing to install. Clone or download, then serve the folder:

```bash
cd shooter-3d
python3 -m http.server 8000     # or: npx serve .
```

Open <http://localhost:8000>.

> Click **CLICK TO DEPLOY** to start. The game requests mouse pointer lock —
> accept it, or aiming won't work. `Esc` pauses and releases the cursor.

**Note:** the title screen appears immediately, but the engine finishes loading
when Three.js arrives from the CDN (a few seconds). Clicks before then are ignored.

---

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move |
| `Mouse` | Look / aim |
| `Left Mouse` | Shoot |
| `R` | Reload |
| `Shift` | Sprint |
| `Space` | Jump |
| `Esc` | Pause / release cursor |

---

## Project Structure

```
shooter-3d/
├── index.html            markup only — no inline CSS or JS
├── styles.css            all styling
├── README.md
├── src/
│   ├── main.js           bootstrap, frame loop, window.__NEON
│   ├── game.js           Game class — owns state, wires subsystems, update order
│   ├── config.js         every gameplay tunable; imports nothing
│   ├── three.js          CDN loader with fallback
│   ├── materials.js      shared geometry/material cache
│   ├── textures.js       procedural floor texture
│   ├── collision.js      walls, cover, circle-vs-box resolution
│   ├── arena.js          floor, walls, cover, starfield
│   ├── gunmodel.js       first-person weapon viewmodel
│   ├── player.js         movement, gravity, camera rig
│   ├── enemy.js          Enemy class: mesh, AI, health, death
│   ├── waves.js          wave composition, spawn pacing
│   ├── weapon.js         hitscan, ammo, reload, recoil/bloom
│   ├── fx.js             particle pool + tracer pool
│   ├── audio.js          Web Audio synth
│   ├── hud.js            all DOM reads/writes
│   └── input.js          keyboard, mouse, pointer lock
└── tools/
    └── smoke_test.py     headless browser regression test
```

### Architecture

- **`config.js` is a leaf** — it imports nothing, so any module may depend on it.
  Import direction is acyclic: `config` → `three`/`materials` → `collision` →
  world/entity modules → `game` → `main`.
- **`Game` is the shared context.** Subsystems receive the `Game` instance rather
  than importing each other, so `Game.update()` is the single place where
  cross-system behaviour and ordering are decided.
- **State lives with its owner.** Player position is on `Player`, ammo and recoil
  on `Weapon`, the enemy population on `WaveDirector`; only true game state
  (`hp`, `score`, `wave`, `state`, feedback timers) lives on `Game`.
- **Shared GPU resources are cached in `materials.js`** and must never be mutated
  or disposed — per-instance state (health-bar fill, hit flash) is expressed as an
  Object3D transform instead. The one exception is an enemy's body/head/leg
  materials, which stay per-enemy because the hit-flash writes `emissive` on them.

---

## Tuning the Game

Everything a designer is likely to change is in `src/config.js`, grouped by
concern — `WORLD`, `WEAPON`, `CAMERA`, `FEEDBACK`, `ENEMY_TYPES`, `ENEMY`,
`WAVES`, `FX`. Mesh-local dimensions (a wall's thickness, a barrel's length) stay
in the module that owns that mesh.

```js
export const WEAPON = {
  MAG: 12, RELOAD_T: 1.25, FIRE_T: 0.12,
  DMG: 34, HEAD_MULT: 2.5, HEADSHOT_BONUS: 25, SENS: 0.0023,
  ...
};
```

---

## Testing

Append `?test` to the URL (e.g. `http://localhost:8000/?test`) to boot straight
into a run without clicking and without requesting pointer lock.

### Automated smoke test

`tools/smoke_test.py` drives the game in headless Chromium and asserts boot,
movement, shooting, reloading, damage, game over, and that GPU resources do not
leak. It needs Playwright and a local server:

```bash
python3 -m http.server 8000 &
python3 tools/smoke_test.py
```

If Playwright is installed via pipx (as it is on some machines), run it with that
interpreter:

```bash
~/.local/share/pipx/venvs/playwright/bin/python tools/smoke_test.py
```

The test uses the system Chrome at `/usr/bin/google-chrome` when present, so it
works without a separate `playwright install`.

### Manual / automation hooks

`window.__NEON` is exposed for debugging and automation:

```js
__NEON.stats()            // { state, hp, ammo, score, kills, wave, hostiles }
__NEON.hurt(d)            // damage the player (negative heals)
__NEON.teleportEnemies(d) // move all enemies to radius d around the player
__NEON.faceEnemies(d, y)  // line enemies up in front of the player and aim at them
__NEON.aim(yaw, pitch)
__NEON.enemyPos()         // positions / state / hp of all enemies
__NEON.camState()         // player position and camera angles
__NEON.renderInfo()       // draw calls, geometry/texture counts — leak checks
```

---

## Deployment

The project is fully static. Any static host works, and because Three.js is loaded
from a CDN at runtime there is no build config and no secrets. **Upload the whole
folder** — the game is now multi-file.

### GitHub Pages

```bash
git add .
git commit -m "..."
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

Then **Settings → Pages → Deploy from a branch → `main` / `root`**. Live at
`https://<user>.github.io/<repo>/`.

### Netlify / Vercel / Cloudflare Pages

```bash
npx netlify-cli deploy --prod --dir .
npx vercel --prod
```

For Cloudflare Pages, connect the repo with an empty build command and `/` as the
output directory.

---

## Troubleshooting

**"Failed to load the Three.js CDN module"** — no internet, or a CDN is blocked.
Reconnect and reload, or edit the URL list at the top of `src/three.js`.

**Black screen** — WebGL is disabled. Enable hardware acceleration, or update
graphics drivers.

**Mouse doesn't move the camera** — pointer lock wasn't granted. Click the canvas
to re-acquire it. Embedded previews and cross-origin iframes often block it.

**Blank page from `file://`** — expected. Use a local server (see Setup).

**Smoke test times out on boot** — the CDN fetch is slow. The test waits 90s for
`window.__NEON`; give it a second run, or pre-warm by loading the page once.