import './styles.css';

import { Game } from './app/Game';
import { FixedLoop } from './core/loop';
import { FIXED_STEP, MAX_DT } from './game/config';

/**
 * Bootstrap: build the game, run the fixed-timestep loop, and expose the
 * automation hook. `?test` skips the title screen and pointer lock so the game
 * can be driven headlessly.
 */

const TEST = new URLSearchParams(location.search).has('test');

const game = new Game(TEST);
const loop = new FixedLoop(FIXED_STEP);
let last = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);

  // Clamp so a backgrounded tab doesn't try to catch up on ten seconds of sleep.
  const dt = Math.min((now - last) / 1000, MAX_DT);
  last = now;

  const { steps } = loop.advance(dt);
  for (let i = 0; i < steps; i++) game.step(FIXED_STEP);
  game.render(dt);
}

console.log('[neon-arena] init ok');
exposeTestApi(game);

requestAnimationFrame(frame);
if (TEST) game.start(true);

/**
 * Stable debugging surface used by the headless E2E suite. Signatures here are
 * part of the contract — don't change them without updating the test.
 */
function exposeTestApi(game: Game) {
  const round = (n: number, dp = 1): number => +n.toFixed(dp);

  window.__NEON = {
    stats: () => ({
      state: game.state,
      hp: game.hp,
      ammo: game.weapon.ammo,
      score: game.score,
      kills: game.kills,
      wave: game.wave,
      hostiles: game.waves.hostileCount(game.aliveCount),
    }),

    hurt: (d: number) => game.damagePlayer(d),

    teleportEnemies: (d: number) => {
      for (const h of game.hostiles) {
        const a = Math.random() * Math.PI * 2;
        h.enemy.pos.x = game.player.position.x + Math.cos(a) * d;
        h.enemy.pos.z = game.player.position.z + Math.sin(a) * d;
      }
    },

    /** Line enemies up in front of the player and aim the camera at them. */
    faceEnemies: (d: number, y = 1.0) => {
      const n = game.hostiles.length;
      game.hostiles.forEach((h, i) => {
        h.enemy.pos.x = game.player.position.x + (i - (n - 1) / 2) * 1.6;
        h.enemy.pos.z = game.player.position.z - d;
      });
      game.player.pitch = Math.atan2(y - game.player.position.y, d);
    },

    aim: (yaw: number, pitch: number) => {
      game.player.yaw = yaw;
      game.player.pitch = pitch;
    },

    enemyPos: () =>
      game.hostiles.map((h) => ({
        x: round(h.enemy.pos.x),
        z: round(h.enemy.pos.z),
        state: h.enemy.state,
        hp: h.enemy.hp,
        kind: h.enemy.kind,
        mode: h.enemy.sapperMode,
      })),

    camState: () => ({
      px: round(game.player.position.x),
      py: round(game.player.position.y),
      pz: round(game.player.position.z),
      yaw: round(game.player.yaw, 2),
      pitch: round(game.player.pitch, 2),
      yawObjY: round(game.arena.rig.yawObj.rotation.y, 2),
    }),

    /** Draw calls and live object counts — catches resource leaks. */
    renderInfo: () => ({
      calls: game.arena.renderer.info.render.calls,
      geometries: game.arena.renderer.info.memory.geometries,
      textures: game.arena.renderer.info.memory.textures,
      programs: game.arena.renderer.info.programs?.length ?? 0,
    }),

    /** Is the first-person viewmodel drawn? Catches the pause/resume bug. */
    gunVisible: () => game.gunVisible,

    /** Remaining fuses of every live sapper bomb. */
    bombs: () => game.bombFuses,

    /** Plant a bomb at a world position without waiting for a sapper to walk there. */
    spawnBomb: (x: number, z: number) => game.spawnBomb(x, z),

    /** Jump straight to a wave, to exercise the sapper without a long run. */
    forceWave: (n: number) => game.forceWave(n),

    crosshair: () => ({ ...game.settings.values }),

    setCrosshair: (patch: Record<string, unknown>) => {
      game.settings.set(patch as never);
      return { ...game.settings.values };
    },
  };
}

declare global {
  interface Window {
    // The test harness is deliberately untyped: Playwright drives it, not TypeScript.
    __NEON: Record<string, (...args: any[]) => unknown>;
  }
}
