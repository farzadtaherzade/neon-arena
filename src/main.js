import THREE from './three.js';
import { MAX_DT } from './config.js';
import { Game } from './game.js';

/**
 * Bootstrap: build the game, run the frame loop, and expose the automation
 * hook. `?test` skips the title screen and pointer lock so the game can be
 * driven headlessly.
 */

const TEST = new URLSearchParams(location.search).has('test');

const game = new Game(TEST);
const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);

  // Clamp so a backgrounded tab doesn't teleport everything on return.
  const dt = Math.min(clock.getDelta(), MAX_DT);
  game.update(dt, clock.elapsedTime);
  game.render();
}

console.log('[neon-arena] init ok');
exposeTestApi(game);

frame();
if (TEST) game.start(true);

/**
 * Stable debugging surface used by the headless smoke test. Signatures here
 * are part of the contract — don't change them without updating the test.
 */
function exposeTestApi(game) {
  const round = (n, dp = 1) => +n.toFixed(dp);

  window.__NEON = {
    stats: () => ({
      state: game.state,
      hp: game.hp,
      ammo: game.weapon.ammo,
      score: game.score,
      kills: game.kills,
      wave: game.wave,
      hostiles: game.waves.hostileCount,
    }),

    hurt: d => game.damagePlayer(d),

    teleportEnemies: d => {
      for (const e of game.waves.enemies) {
        const a = Math.random() * Math.PI * 2;
        e.group.position.set(game.player.position.x + Math.cos(a) * d, 0, game.player.position.z + Math.sin(a) * d);
      }
    },

    /** Line enemies up in front of the player and aim the camera at them. */
    faceEnemies: (d, y = 1.0) => {
      const n = game.waves.enemies.length;
      game.waves.enemies.forEach((e, i) => {
        e.group.position.set(game.player.position.x + (i - (n - 1) / 2) * 1.6, 0, game.player.position.z - d);
      });
      game.player.pitch = Math.atan2(y - game.player.position.y, d);
    },

    aim: (yaw, pitch) => {
      game.player.yaw = yaw;
      game.player.pitch = pitch;
    },

    enemyPos: () => game.waves.enemies.map(e => ({
      x: round(e.group.position.x),
      z: round(e.group.position.z),
      state: e.state,
      hp: e.hp,
    })),

    camState: () => ({
      px: round(game.player.position.x),
      py: round(game.player.position.y),
      pz: round(game.player.position.z),
      yaw: round(game.player.yaw, 2),
      pitch: round(game.player.pitch, 2),
      yawObjY: round(game.yawObj.rotation.y, 2),
    }),

    /** Draw calls and live object counts — catches resource leaks. */
    renderInfo: () => ({
      calls: game.renderer.info.render.calls,
      geometries: game.renderer.info.memory.geometries,
      textures: game.renderer.info.memory.textures,
      programs: game.renderer.info.programs?.length ?? 0,
    }),

    crosshair: () => ({ ...game.settings.values }),

    setCrosshair: patch => {
      game.settings.set(patch);
      return { ...game.settings.values };
    },
  };
}