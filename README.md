# NEON ARENA — 3D Arena Shooter

A browser-based first-person 3D arena shooter built with [Three.js](https://threejs.org/).
Survive escalating waves of hostile robots in a neon-lit arena.

Everything lives in **one file** — `index.html`. No build step, no npm install, no bundler.

---

## Features

- **FPS controls** — WASD movement, mouse look via Pointer Lock, sprint, jump, crouch-free strafing
- **Weapon system** — 12-round magazine, infinite reserve, reload, recoil kick, muzzle flash, spread bloom
- **Three enemy types**
  | Type | HP (wave 1) | Speed | Damage | Score | Behaviour |
  |---|---|---|---|---|---|
  | Grunt | 60 | 3.4 | 10 | 100 | Standard chaser |
  | Runner | 30 | 6.2 | 7 | 150 | Fast, fragile |
  | Tank | 200 | 2.2 | 22 | 300 | Slow, high HP, big damage |
- **Wave system** — enemy count, HP and speed scale per wave; clearing a wave restores 25 HP
- **Headshots** — deal 2.5× damage and a score bonus
- **Feedback** — hitmarkers, enemy health bars, damage vignette, screen shake, blood/spark particles, tracers
- **Procedural audio** — Web Audio API synth, no sound files needed
- **HUD** — score, wave, hostile count, integrity bar, ammo counter, reload progress
- **Pause / game over / restart** flow

---

## Requirements

- A modern browser with **WebGL** enabled: Chrome, Edge, Firefox, or Safari (2019+)
- **Internet connection** on first load — Three.js is loaded from a CDN (`jsdelivr`, with `unpkg` as fallback)
- Any static file server (the game **will not** run from a `file://` URL, because browsers block ES modules on `file://`)

---

## Setup & Running

There is nothing to install. Clone or download the repo, then serve the folder:

### Option A — Python (already installed on macOS/Linux)

```bash
cd shooter-3d
python3 -m http.server 8000
```

### Option B — Node.js (npx, no install needed)

```bash
cd shooter-3d
npx serve .
```

### Option C — VS Code

Install the **Live Server** extension, right-click `index.html` → **Open with Live Server**.

Then open <http://localhost:8000> in your browser.

> Click **CLICK TO DEPLOY** to start. The game will request mouse pointer lock — accept it, otherwise aiming won't work. Press `Esc` to pause and release the cursor.

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

## Testing / Automation Hook

Append `?test` to the URL (e.g. `http://localhost:8000/?test`) to boot straight into a run without
clicking and without requesting pointer lock. This exposes a debug API on `window.__NEON`:

```js
__NEON.stats()                  // { state, hp, ammo, score, kills, wave, hostiles }
__NEON.hurt(25)                 // deal 25 damage to the player
__NEON.teleportEnemies(6)       // move all enemies to radius 6 around the player
__NEON.faceEnemies(10, 1.0)     // line enemies up in front of the player and aim at them
__NEON.aim(yaw, pitch)          // set camera angles
__NEON.enemyPos()               // positions / state / hp of all enemies
__NEON.camState()               // player position and camera angles
```

---

## Deployment

The project is fully static, so any static host works. Because Three.js is loaded from a CDN at
runtime, deployed builds need no build config and no secrets.

### GitHub Pages (recommended)

```bash
git add .
git commit -m "Initial commit: Neon Arena 3D shooter"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

Then enable Pages: **Repo → Settings → Pages → Source: Deploy from a branch → `main` / `root` → Save**.
Your game will be live at `https://<your-user>.github.io/<your-repo>/` within a minute.

### Netlify

```bash
npx netlify-cli deploy --prod --dir .
```

Or connect the repo at <https://app.netlify.com> — set the publish directory to the repo root.

### Vercel

```bash
npx vercel --prod
```

### Cloudflare Pages

Connect the repo and set the build command to *(leave empty)* with output directory `/`.

### Any other host (Nginx, S3, Apache, cPanel)

Upload `index.html` to the web root. Nothing else is needed.

---

## Project Structure

```
shooter-3d/
├── index.html   # Entire game: HTML, CSS, and JS (Three.js loaded from CDN)
├── README.md    # This file
└── .gitignore
```

---

## Tuning the Game

All gameplay constants are at the top of the `<script>` block in `index.html`:

```js
const ARENA = 60;                       // arena size (units)
const GRAVITY = 26, WALK = 6.5, SPRINT = 10.5, JUMP_V = 8.5;
const MAG = 12, RELOAD_T = 1.25, FIRE_T = 0.12;
const DMG = 34, HEAD_MULT = 2.5;        // bullet damage, headshot multiplier
const SENS = 0.0023;                    // mouse sensitivity
```

Enemy stats live in the `TYPES` object, arena layout in `obsDefs`, and wave scaling in `waveComp()`.

---

## Troubleshooting

**"Failed to load the Three.js CDN module"** — no internet connection, or a CDN is blocked.
Reconnect and reload, or switch the CDN URLs at the top of the script block.

**Black screen** — WebGL is disabled or unsupported. Enable hardware acceleration in browser
settings, or update your graphics drivers.

**Mouse doesn't move the camera** — pointer lock wasn't granted. Click on the game canvas to
re-acquire it; don't run inside an embedded preview iframe if the host blocks pointer lock.

**Page is blank when opening `index.html` directly** — expected. Use one of the local server
options above.