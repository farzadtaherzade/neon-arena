import './styles.css';

import { Game } from './app/Game';
import { FixedLoop } from './core/loop';
import { FIXED_STEP, MAX_DT, WORLD } from './game/config';

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

    ammo: () => ({
      mag: game.weapon.ammo,
      reserve: game.weapon.reserve,
      dry: game.weapon.isDry,
    }),

    knife: () => ({ ready: game.knife.ready, swingT: game.knife.swingT }),

    swingKnife: () => game.swingKnife(),

    setAmmo: (mag: number, reserve: number) => {
      game.weapon.ammo = mag;
      game.weapon.reserve = reserve;
    },

    teleportEnemies: (d: number) => {
      for (const h of game.hostiles) {
        const a = Math.random() * Math.PI * 2;
        h.enemy.pos.x = game.player.position.x + Math.cos(a) * d;
        h.enemy.pos.z = game.player.position.z + Math.sin(a) * d;
      }
    },

    /**
     * Line enemies up in front of the player, along the current yaw, and aim at
     * them. On a maze map a ring teleport puts half the targets behind walls, so
     * the harness needs a clear lane rather than a circle.
     */
    faceEnemies: (d: number, y = 1.0) => {
      const p = game.player;
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      const rx = Math.cos(p.yaw);
      const rz = -Math.sin(p.yaw);
      const n = game.hostiles.length;
      game.hostiles.forEach((h, i) => {
        const side = (i - (n - 1) / 2) * 1.6;
        h.enemy.pos.x = p.position.x + fx * d + rx * side;
        h.enemy.pos.z = p.position.z + fz * d + rz * side;
        h.enemy.pos.y = 0;
      });
      p.pitch = Math.atan2(y - p.position.y, d);
    },

    aim: (yaw: number, pitch: number) => {
      game.player.yaw = yaw;
      game.player.pitch = pitch;
    },

    /** Put the player somewhere specific — decks, ramps, the arena centre. */
    teleportPlayer: (x: number, z: number, y = WORLD.PLAYER_H) => {
      const p = game.player;
      p.position.x = x;
      p.position.z = z;
      p.position.y = y;
      p.velocity.x = 0;
      p.velocity.y = 0;
      p.velocity.z = 0;
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

    /** Rejected mouse deltas / pointer-lock losses — diagnoses aim glitches. */
    inputStats: () => ({ ...game.inputStats }),

    /** Deck capture: live deck, hold progress and per-deck cooldowns. */
    capture: () => ({
      active: game.capture.active,
      progress: round(game.capture.progress, 3),
      ready: game.capture.ready,
      onPad: game.capture.onPad,
      cooldown: game.capture.cooldown.map((c) => round(c, 1)),
    }),

    /** Watchtower alarms, one boolean per deck. */
    alarm: () => game.alarm.hot.slice(),

    /** Remaining fuses of every live sapper bomb. */
    bombs: () => game.bombFuses,

    /** Plant a bomb at a world position without waiting for a sapper to walk there. */
    spawnBomb: (x: number, z: number) => game.spawnBomb(x, z),

    /** Jump straight to a wave, to exercise the sapper without a long run. */
    forceWave: (n: number) => game.forceWave(n),

    /** Player progression: level, XP banked, and what the next level needs. */
    xpStats: () => ({ level: game.meter.level, xp: game.meter.xp, need: game.meter.need }),

    /** Bank XP without waiting for a pickup. */
    grantXp: (n: number) => game.grantXp(n),

    /** The meteor shower: phase, sky tint and stones in flight. */
    meteor: () => game.meteorStats,

    /** Start a shower now instead of waiting for the dice. */
    forceMeteor: () => game.forceMeteor(),

    /** Drop a stone on an exact spot. */
    dropStone: (x: number, z: number) => game.dropStone(x, z),

    /** The whole settings bundle: crosshair, game and video. */
    settings: () => game.settings.values,

    crosshair: () => game.settings.values.crosshair,

    setCrosshair: (patch: Record<string, unknown>) => {
      game.settings.setCrosshair(patch as never);
      return game.settings.values.crosshair;
    },

    setGame: (patch: Record<string, unknown>) => {
      game.settings.setGame(patch as never);
      return game.settings.values.game;
    },

    setVideo: (patch: Record<string, unknown>) => {
      game.settings.setVideo(patch as never);
      return game.settings.values.video;
    },

    /** The credits wallet and the loadout. */
    profile: () => game.profile.data,

    /** The credit balance. */
    credits: () => game.profile.data.credits,

    /** Bank credits, for testing the shop. */
    grantCredits: (n: number) => game.profile.addCredits(n),

    /** Buy a skin with credits. */
    buySkin: (id: string) => game.buySkin(id),

    /** Equip an owned skin. */
    equipSkin: (id: string) => game.equipSkin(id),
  };
}

declare global {
  interface Window {
    // The test harness is deliberately untyped: Playwright drives it, not TypeScript.
    __NEON: Record<string, (...args: any[]) => unknown>;
  }
}
