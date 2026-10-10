import { ENEMY, ENEMY_TYPES, START_HP, WAVES } from './config.js';
import { Enemy } from './enemy.js';

/**
 * Wave composition, spawn pacing, and the enemy population.
 *
 * Also owns `targets` — the body/head meshes the weapon raycasts against —
 * so a dead enemy's colliders disappear in the same place its death starts.
 */
export class WaveDirector {
  constructor(game) {
    this.game = game;
    this.enemies = [];
    this.targets = [];
    this.spawnQueue = [];
    this.intermission = 0;
  }

  reset() {
    this.clear();
    this.intermission = 0;
  }

  clear() {
    for (const e of this.enemies) {
      this.game.scene.remove(e.group);
      this.game.scene.remove(e.barGroup);
      e.dispose();
    }
    this.enemies = [];
    this.targets = [];
    this.spawnQueue = [];
  }

  /** Number still standing plus number queued — what the HUD reports as HOSTILES. */
  get hostileCount() {
    return this.enemies.filter(e => e.state !== 'dying').length + this.spawnQueue.length;
  }

  start(n) {
    this.game.wave = n;
    const speedScale = Math.min(1 + (n - 1) * WAVES.SPEED_GAIN, WAVES.SPEED_MAX_SCALE);
    this.spawnQueue = composition(n).map((type, i) => ({
      type,
      delay: WAVES.FIRST_DELAY + i * WAVES.STAGGER,
      speedScale,
    }));
    this.game.hud.showBanner('WAVE ' + n, n === 1 ? 'GET READY' : 'HOSTILES INCOMING');
    this.game.sfx.wave();
  }

  update(dt, game) {
    this.processSpawns(dt, game);
    for (const e of this.enemies) e.update(dt, game);
    this.enemies = this.enemies.filter(e => !e.remove);
    this.checkWaveState(dt, game);
  }

  processSpawns(dt, game) {
    for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
      const s = this.spawnQueue[i];
      s.delay -= dt;
      if (s.delay > 0) continue;

      const spot = this.pickSpawn(game);
      const enemy = new Enemy(s.type, spot.x, spot.z);
      const n = game.wave;

      enemy.maxHp = enemy.hp = ENEMY_TYPES[s.type].hp + (n - 1) * WAVES.HP_PER_WAVE[s.type];
      enemy.speed *= s.speedScale;
      enemy.dmg = ENEMY_TYPES[s.type].dmg + Math.floor((n - 1) / 2) * WAVES.DMG_PER_2_WAVES;

      enemy.addTo(game.scene);
      this.enemies.push(enemy);
      this.targets.push(enemy.body, enemy.head);
      this.spawnQueue.splice(i, 1);
    }
  }

  checkWaveState(dt, game) {
    const active = this.spawnQueue.length > 0 || this.enemies.some(e => e.state !== 'dying');
    if (active) {
      this.intermission = 0;
      return;
    }

    if (this.intermission <= 0) {
      this.intermission = WAVES.INTERMISSION;
      game.hp = Math.min(START_HP, game.hp + WAVES.WAVE_HEAL);
      game.hud.showBanner('WAVE ' + game.wave + ' CLEARED', '+25 INTEGRITY RESTORED');
      game.sfx.wave();
    }

    this.intermission -= dt;
    if (this.intermission <= 0) this.start(game.wave + 1);
  }

  /** Ring around the player, rejecting spots that are too close. */
  pickSpawn(game) {
    const p = game.player.position;
    const testing = game.test;
    const ring = testing ? ENEMY.TEST_SPAWN_RING : ENEMY.SPAWN_RING;
    const jitter = testing ? ENEMY.TEST_SPAWN_JITTER : ENEMY.SPAWN_RING_JITTER;

    for (let i = 0; i < ENEMY.SPAWN_ATTEMPTS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = ring + Math.random() * jitter;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.hypot(x - p.x, z - p.z) > ENEMY.SPAWN_MIN_DIST) return { x, z };
    }
    return { x: ENEMY.SPAWN_FALLBACK[0], z: ENEMY.SPAWN_FALLBACK[1] };
  }

  /** Drop a dead enemy's colliders out of the raycast list. */
  releaseTargets(enemy) {
    for (const mesh of enemy.targets) {
      const i = this.targets.indexOf(mesh);
      if (i >= 0) this.targets.splice(i, 1);
    }
  }
}

/** Enemy types for wave `n`, by count. */
function composition(n) {
  const list = [];
  for (let i = 0; i < WAVES.GRUNTS_BASE + n; i++) list.push('grunt');
  if (n >= WAVES.RUNNERS_FROM) {
    for (let i = 0; i < 1 + Math.floor(n * 0.8); i++) list.push('runner');
  }
  if (n >= WAVES.TANK_FROM) {
    const count = Math.min(1 + Math.floor((n - 2) / 2), WAVES.MAX_TANKS);
    for (let i = 0; i < count; i++) list.push('tank');
  }
  return list;
}