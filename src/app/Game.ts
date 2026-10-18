import * as THREE from 'three';

import { Music } from '../audio/Music';
import { Sfx } from '../audio/Sfx';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import { Bomb } from '../game/bomb';
import { TowerAlarm } from '../game/alarm';
import { CapturePoints } from '../game/capture';
import {
  ALARM,
  BOMB,
  CAMERA,
  CAPTURE,
  ENEMY,
  FEEDBACK,
  type GameState,
  SCREEN,
  START_HP,
  STATE,
  WAVES,
  WEAPON,
  WORLD,
} from '../game/config';
import { SpatialHash } from '../game/enemies';
import { Enemy, type EnemyWorld } from '../game/enemy';
import { Player } from '../game/player';
import { dmgBonus, WaveDirector } from '../game/waves';
import { Weapon } from '../game/weapon';
import { CollisionWorld } from '../game/world/collision';
import { XP, Xp } from '../game/xp';
import { Arena } from '../render/Arena';
import { BombView } from '../render/BombView';
import { EnemyView } from '../render/EnemyView';
import { Fx } from '../render/Fx';
import { GunView } from '../render/Gun';
import { Pick } from '../render/Pick';
import { XpView } from '../render/XpView';
import { Hud, type HudModel } from '../ui/Hud';
import { Input } from '../ui/Input';
import { Minimap, type MapTower } from '../ui/Minimap';
import { Settings } from '../ui/Settings';

interface Hostile {
  enemy: Enemy;
  view: EnemyView;
}

/**
 * Composition root and game state machine.
 *
 * The only place that knows about every layer: it owns the renderer, the pure
 * simulation objects, and the wiring between them. Pure code never reaches back
 * up here — it emits return values or takes callbacks.
 */
export class Game {
  state: GameState = STATE.MENU;
  hp = START_HP;
  score = 0;
  kills = 0;
  wave = 0;
  elapsed = 0;

  /** Decay timers for the hitmarker, damage vignette and screen shake. */
  private feedback = { hitT: 0, vignetteT: 0, shakeT: 0 };

  // Public so the headless E2E suite can drive and inspect the simulation
  // through `window.__NEON`; everything else in this class stays private.
  readonly player = new Player();
  readonly waves = new WaveDirector();
  readonly arena: Arena;
  /** The rotating high-ground objective; assigned once the arena exists. */
  readonly capture: CapturePoints;
  /** Watchtower alarms, one per deck; assigned once the arena exists. */
  readonly alarm: TowerAlarm;
  aliveCount = 0;
  /** Prevents a replayed cleared update from repeating wave banners. */
  private waveClearPending = false;

  private rng = new Rng(0xc0ffee);
  private collision = new CollisionWorld();
  private pick = new Pick();
  private fx: Fx;
  private sfx = new Sfx();
  private music = new Music();
  private hud = new Hud();
  private input: Input;
  private gun = new GunView();

  // Public because `main.ts` drives them from the headless E2E suite.
  readonly settings: Settings;
  readonly weapon: Weapon;
  readonly hostiles: Hostile[] = [];
  private hash = new SpatialHash();
  /** Reused each step: the broadphase rebuild must not allocate an array per tick. */
  private enemyScratch: Enemy[] = [];
  /** The world handed to enemies each step — built once, mutated in place. */
  private readonly world: EnemyWorld;

  /** Live sapper bombs and the meshes backing them. */
  private bombs: Bomb[] = [];
  private bombViews = new Map<Bomb, BombView>();
  private minimap: Minimap;

  /** XP orbs on the floor and the meshes backing them. */
  private xps: Xp[] = [];
  private xpViews = new Map<Xp, XpView>();
  /** HP still to be paid out by a secured deck, at `CAPTURE.HEAL / HEAL_T` per second. */
  private healLeft = 0;
  /** Reused per-step scratch: does each tower see hostiles right now? */
  private alarmContact: boolean[] = [];
  /** Reused minimap blips, mutated each frame instead of reallocated. */
  private readonly mapTowers: MapTower[] = [];
  /** Current camera FOV, lerped toward the ADS target so it never pops. */
  private fov = CAMERA.FOV;

  /** Exposed for the headless E2E suite: is the first-person viewmodel drawn? */
  get gunVisible(): boolean {
    return this.gun.group.visible;
  }

  /**
   * How much mouse input has been thrown away: `spikes` are deltas the glitch
   * filter rejected, `lockLosses` are times the browser dropped pointer lock.
   * A rising `lockLosses` means the "jump" was the cursor being released.
   */
  get inputStats(): { spikes: number; lockLosses: number; warmupDrops: number } {
    return this.input.stats;
  }

  private scratch = new THREE.Vector3();
  private tracerEnd = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  /** Scratch point for `CollisionWorld.groundHeight` queries that must not allocate. */
  private groundProbe = { x: 0, z: 0 };
  private model: HudModel = {
    hp: 0,
    score: 0,
    wave: 0,
    hostiles: 0,
    state: '',
    vignetteT: 0,
    ammo: 0,
    reloading: false,
    reloadProgress: 0,
    bloom: 0,
    moving: false,
    stamina: WORLD.STAMINA_MAX,
    bombDist: Number.POSITIVE_INFINITY,
    bombFuse: 0,
    captureProgress: 0,
    captureOn: false,
  };

  constructor(readonly test = false) {
    this.arena = new Arena(this.collision, this.rng);
    this.capture = new CapturePoints(this.arena.pads.map((pad) => pad.deck));
    this.alarm = new TowerAlarm(this.arena.pads.length);
    this.alarmContact = new Array<boolean>(this.arena.pads.length).fill(false);
    for (const pad of this.arena.pads) {
      this.mapTowers.push({ x: pad.deck.x, z: pad.deck.z, hot: false });
    }
    this.fx = new Fx(this.arena.scene);
    this.minimap = new Minimap();
    this.arena.camera.add(this.gun.group);
    this.pick.add(...this.arena.solids);

    this.settings = new Settings(this.hud.crosshair, {
      onOpen: () => {
        // Dropping pointer lock pauses the run through the normal lock flow, so
        // closing the panel lands the player back on the pause screen.
        if (this.state === STATE.PLAYING) this.input.release();
      },
      onChange: (values) => {
        this.player.sens = values.sensitivity;
        this.sfx.setMuted(values.mute);
        this.music.setMuted(values.mute);
      },
    });
    this.player.sens = this.settings.values.sensitivity;
    this.sfx.setMuted(this.settings.values.mute);
    this.music.setMuted(this.settings.values.mute);

    this.weapon = new Weapon({
      onShot: () => this.resolveShot(),
      onDry: () => this.sfx.empty(),
      onReloadStart: () => this.sfx.reloadStart(),
      onReloadEnd: () => this.sfx.reloadEnd(),
    });

    this.input = new Input(
      this.arena.renderer.domElement,
      {
        isPlaying: () => this.state === STATE.PLAYING,
        isPaused: () => this.state === STATE.PAUSED,
        isSettingsOpen: () => this.settings.isOpen,
        onJump: () => this.player.queueJump(),
        onReload: () => this.weapon.startReload(),
        onLook: (dx, dy) => this.player.look(dx, dy, this.settings.values.sensitivity),
        onLockRequest: () => this.input.lock(),
        onLockChange: (locked) => this.onLockChange(locked),
        onToggleSettings: () => this.settings.toggle(),
        onCloseSettings: () => this.settings.close(),
      },
      test,
    );

    this.waves.testing = test;
    this.waves.rng = this.rng;
    // A dense maze means the spawn ring lands in walls; let the director reject
    // those instead of materialising a tank inside a bunker.
    this.waves.blocked = (x, z) => this.collision.blockedAt(x, z, 1.2);

    this.world = {
      playerPos: this.player.position,
      playerY: 0,
      neighbours: EMPTY,
      hostileCount: 0,
      collide: (p, r, feetY) => this.collision.resolveCircle(p, r, { feetY, step: ENEMY.STEP }),
      // Reused probe: enemies ask for the ground every step and must not
      // allocate a `{x, z}` per query.
      support: (x, z, r, ceiling) => {
        const probe = this.groundProbe;
        probe.x = x;
        probe.z = z;
        return this.collision.groundHeight(probe, r, ceiling);
      },
      ramps: this.collision.ramps,
      damagePlayer: (amount) => this.damagePlayer(amount),
      plantBomb: (from, to, thrown) => this.plantBomb(from, to, thrown),
    };

    document.getElementById('startScreen')!.addEventListener('click', () => this.start(false));
    document.getElementById('gameOverScreen')!.addEventListener('click', () => this.start(false));
  }

  // ---------------------------------------------------------------- lifecycle

  start(skipLock = false): void {
    this.sfx.init();
    this.music.init();
    this.music.setMuted(this.settings.values.mute);
    this.music.start();
    this.reset();
    this.beginWave(1);
    this.hud.setVisible(true);
    this.state = STATE.PLAYING;

    if (this.test) this.hud.hideAllScreens();
    else this.hud.showScreen(SCREEN.NONE);

    if (!skipLock) this.input.lock();
  }

  private reset(): void {
    this.waves.reset();
    this.fx.clear();
    this.weapon.reset();
    this.player.reset();
    this.clearHostiles();
    this.clearBombs();
    this.clearXps();
    this.capture.reset();
    this.alarm.reset();
    this.healLeft = 0;

    this.hp = START_HP;
    this.score = 0;
    this.kills = 0;
    this.wave = 0;
    this.feedback.hitT = 0;
    this.feedback.vignetteT = 0;
    this.feedback.shakeT = 0;

    this.input.firing = false;
    this.hud.reset();
  }

  private gameOver(): void {
    this.state = STATE.GAMEOVER;
    this.input.firing = false;
    this.hud.setVisible(false);
    this.input.release();
    this.hud.setFinalStats({ score: this.score, wave: this.wave, kills: this.kills });
    if (!this.test) this.hud.showScreen(SCREEN.GAMEOVER);
    this.sfx.kill();
    this.music.stop();
  }

  damagePlayer(amount: number): void {
    if (this.state !== STATE.PLAYING) return;
    this.hp -= amount;
    this.feedback.vignetteT = 1;
    this.feedback.shakeT = FEEDBACK.SHAKE_ON_HIT;
    this.sfx.hurt();
    if (this.hp <= 0) {
      this.hp = 0;
      this.gameOver();
    }
  }

  private onLockChange(locked: boolean): void {
    if (!locked && this.state === STATE.PLAYING) {
      this.state = STATE.PAUSED;
      this.input.firing = false;
      if (!this.test) this.hud.showScreen(SCREEN.PAUSE);
    } else if (locked && this.state === STATE.PAUSED) {
      this.state = STATE.PLAYING;
      if (!this.test) this.hud.showScreen(SCREEN.NONE);
    }
  }

  private beginWave(n: number): void {
    this.wave = n;
    this.waveClearPending = false;
    this.waves.start(n);
    this.hud.showBanner(`WAVE ${n}`, n === 1 ? 'GET READY' : 'HOSTILES INCOMING');
    this.sfx.wave();
  }

  // ----------------------------------------------------------------- shooting

  /** One bullet: pick, damage, sparks, tracer. Runs on the fixed step. */
  private resolveShot(): void {
    this.pick.aim(this.arena.camera, this.weapon.spread, this.rng);
    const hit = this.pick.cast();
    this.gun.fire(this.rng);
    this.sfx.shoot();

    this.gun.muzzle.updateWorldMatrix(true, false);
    this.gun.muzzle.getWorldPosition(this.scratch);
    this.fx.tracers.fire(this.scratch, hit ? hit.point : this.missEnd());

    if (!hit) return;

    if (hit.bomb) {
      this.defuse(hit.bomb);
      return;
    }

    if (hit.enemy) {
      const headshot = hit.part === 'head';
      const p = hit.point;
      this.fx.burst(
        { x: p.x, y: p.y, z: p.z, color: 0xff4455, count: 10, speed: 3.5, life: 0.5, gravity: 9 },
        this.rng,
      );
      this.feedback.hitT = 1;
      this.sfx.hit();

      const enemy = hit.enemy;
      if (enemy.takeDamage(this.weapon.damage(headshot))) this.killEnemy(enemy, headshot);
      else {
        const dir = this.pick.direction;
        enemy.knockback(dir.x, dir.z);
      }
      return;
    }

    const p = hit.point;
    this.fx.burst(
      { x: p.x, y: p.y, z: p.z, color: 0xffc266, count: 8, speed: 3, life: 0.4, gravity: 9 },
      this.rng,
    );
  }

  private missEnd(): THREE.Vector3 {
    return this.tracerEnd
      .copy(this.arena.camera.position)
      .addScaledVector(this.pick.direction, WEAPON.MAX_RANGE);
  }

  private killEnemy(enemy: Enemy, headshot: boolean): void {
    const hostile = this.hostiles.find((h) => h.enemy === enemy);
    if (!hostile || !enemy.kill()) return;

    hostile.view.removeTargets(this.pick);
    const origin = { x: enemy.pos.x, y: enemy.pos.y + 0.9 * enemy.scale, z: enemy.pos.z };
    this.fx.burst({ ...origin, color: 0xff4455, count: 26, speed: 5, life: 0.7, gravity: 9 }, this.rng);
    this.fx.burst({ ...origin, color: 0xff8866, count: 10, speed: 3, life: 0.5, gravity: 9 }, this.rng);

    this.spawnXp(enemy.pos.x, enemy.pos.y, enemy.pos.z);

    this.score += enemy.stats.score + (headshot ? WEAPON.HEADSHOT_BONUS : 0);
    this.kills++;
    this.feedback.hitT = 1;
    this.hud.markKill();
    this.hud.pushKill(enemy.kind, headshot);
    this.sfx.kill();
    this.aliveCount--;
  }

  private clearHostiles(): void {
    for (const h of this.hostiles) {
      h.view.dispose(this.arena.scene);
      this.pick.remove(h.view.body);
      this.pick.remove(h.view.head);
    }
    this.hostiles.length = 0;
    this.aliveCount = 0;
    this.waveClearPending = false;
  }

  // --------------------------------------------------------------------- bombs

  /** A sapper wants a bomb at `to`; `from` is where it left its hand, for the throw arc. */
  plantBomb(from: { x: number; z: number }, to: { x: number; z: number }, thrown: boolean): void {
    const limit = WORLD.HALF - WORLD.WALL_INSET;
    const bomb = new Bomb(clamp(to.x, -limit, limit), clamp(to.z, -limit, limit));
    // Rest it on whatever is actually under the blast spot, so a bomb thrown at
    // someone on a platform does not blink inside the platform's geometry.
    this.groundProbe.x = bomb.pos.x;
    this.groundProbe.z = bomb.pos.z;
    bomb.pos.y = this.collision.groundHeight(this.groundProbe, 0.2, Number.POSITIVE_INFINITY);
    const view = new BombView(bomb);
    view.addTo(this.arena.scene);
    this.pick.add(view.mesh);
    this.bombs.push(bomb);
    this.bombViews.set(bomb, view);

    if (thrown) this.fx.fire({ x: from.x, y: 1.1, z: from.z }, { x: bomb.pos.x, y: 0.4, z: bomb.pos.z });

    // Warn the player only when it lands close enough to matter.
    const dist = Math.hypot(this.player.position.x - bomb.pos.x, this.player.position.z - bomb.pos.z);
    if (thrown || dist <= BOMB.WARN_RADIUS) this.sfx.alarm();
  }

  private updateBombs(dt: number): void {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i];
      if (!bomb || !bomb.update(dt)) continue;
      this.removeBomb(bomb);
      this.detonate(bomb);
    }
  }

  private removeBomb(bomb: Bomb): void {
    const view = this.bombViews.get(bomb);
    if (view) {
      view.dispose(this.arena.scene);
      this.pick.remove(view.mesh);
      this.bombViews.delete(bomb);
    }
    const i = this.bombs.indexOf(bomb);
    if (i >= 0) this.bombs.splice(i, 1);
  }

  /** Blast: hurts the player by falloff and shreds anything nearby — including other enemies. */
  private detonate(bomb: Bomb): void {
    const { x, z } = bomb.pos;
    const r = bomb.radius;

    this.fx.burst({ x, y: 0.7, z, color: 0xffa23a, count: 40, speed: 9, life: 0.6, gravity: 6 }, this.rng);
    this.fx.burst({ x, y: 0.4, z, color: 0xff3a22, count: 24, speed: 6, life: 0.8, gravity: 4 }, this.rng);
    this.sfx.explode();
    this.feedback.shakeT = Math.max(this.feedback.shakeT, BOMB.SHAKE);

    const pd = Math.hypot(
      this.player.position.x - x,
      this.player.position.z - z,
      this.player.position.y - WORLD.PLAYER_H - bomb.pos.y,
    );
    if (pd < r) this.damagePlayer(BOMB.PLAYER_DMG * (1 - pd / r));

    for (const h of this.hostiles) {
      const enemy = h.enemy;
      if (enemy.state !== 'alive') continue;
      const d = Math.hypot(enemy.pos.x - x, enemy.pos.z - z, enemy.pos.y - bomb.pos.y);
      if (d >= r) continue;
      if (enemy.takeDamage(BOMB.ENEMY_DMG)) this.killEnemy(enemy, false);
      else {
        const inv = 1 / (d || 1);
        enemy.knockback((enemy.pos.x - x) * inv, (enemy.pos.z - z) * inv);
      }
    }
  }

  /** Shooting a live bomb pops it harmlessly for bonus points. */
  private defuse(bomb: Bomb): void {
    const { x, z } = bomb.pos;
    this.removeBomb(bomb);
    this.fx.burst({ x, y: 0.4, z, color: 0x66e0ff, count: 16, speed: 4, life: 0.45, gravity: 6 }, this.rng);
    this.score += BOMB.DEFUSE_SCORE;
    this.feedback.hitT = 1;
    this.sfx.hit();
  }

  private clearBombs(): void {
    for (const bomb of this.bombs) {
      const view = this.bombViews.get(bomb);
      if (!view) continue;
      view.dispose(this.arena.scene);
      this.pick.remove(view.mesh);
    }
    this.bombs.length = 0;
    this.bombViews.clear();
  }

  // ------------------------------------------------------------------------ XP

  /** An enemy dies; it drops one orb where it fell, for the player to gather. */
  private spawnXp(x: number, y: number, z: number): void {
    const xp = new Xp(x, z, XP.VALUE, y + 0.5);
    const view = new XpView(xp);
    view.addTo(this.arena.scene);
    this.xps.push(xp);
    this.xpViews.set(xp, view);
  }

  /** Magnet orbs toward the player, collecting them at `XP.COLLECT`. */
  private updateXps(dt: number): void {
    for (let i = this.xps.length - 1; i >= 0; i--) {
      const xp = this.xps[i];
      if (!xp) continue;
      if (!xp.update(dt, this.player.position)) continue;

      const view = this.xpViews.get(xp);
      if (view) {
        view.dispose(this.arena.scene);
        this.xpViews.delete(xp);
      }
      this.xps.splice(i, 1);
      this.score += xp.value;
      this.feedback.hitT = 1;
      this.sfx.xpCollect();
      this.hud.xpPop(xp.value);
    }
  }

  private clearXps(): void {
    for (const xp of this.xps) {
      const view = this.xpViews.get(xp);
      if (!view) continue;
      view.dispose(this.arena.scene);
      this.xpViews.delete(xp);
    }
    this.xps.length = 0;
  }

  // ------------------------------------------------------------------- capture

  /**
   * Hold the live deck for a heal. The deck is melee-safe — mobs besiege the
   * ramp mouth instead of climbing — so the pressure comes from sapper bombs
   * landing on it, which is what makes standing still a decision.
   */
  private updateCapture(dt: number): void {
    const cap = this.capture;
    const p = this.player.position;
    cap.update(dt, this.wave, p.x, p.z, this.world.playerY);

    if (cap.justCaptured) {
      this.healLeft = CAPTURE.HEAL;
      this.hud.showBanner('DECK SECURED', `REPAIRING ${CAPTURE.HEAL} INTEGRITY`);
      this.sfx.xpCollect();
    }

    if (this.healLeft <= 0) return;
    const step = Math.min(this.healLeft, (CAPTURE.HEAL / CAPTURE.HEAL_T) * dt);
    this.healLeft -= step;
    this.hp = Math.min(START_HP, this.hp + step);
  }

  // -------------------------------------------------------------------- alarm

  /**
   * Watchtower alarms: any hostile inside a tower's radius lights it. The siren
   * fires on the rising edge only, so a crowd milling at a gatehouse does not
   * scream continuously.
   */
  private updateAlarm(dt: number): void {
    const pads = this.arena.pads;
    const contact = this.alarmContact;
    for (let i = 0; i < pads.length; i++) {
      const deck = pads[i]?.deck;
      contact[i] = deck ? this.hostileNear(deck.x, deck.z, ALARM.RADIUS) : false;
    }
    if (this.alarm.update(dt, contact)) this.sfx.alarm();
  }

  /** Is any live hostile within `r` of (x, z)? Allocation-free. */
  private hostileNear(x: number, z: number, r: number): boolean {
    const r2 = r * r;
    for (const h of this.hostiles) {
      if (h.enemy.state !== 'alive') continue;
      const dx = h.enemy.pos.x - x;
      const dz = h.enemy.pos.z - z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  // E2E hooks: plant a bomb and jump waves without a full playthrough.

  spawnBomb(x: number, z: number): void {
    this.plantBomb({ x, z }, { x, z }, false);
  }

  get bombFuses(): number[] {
    return this.bombs.map((b) => b.fuse);
  }

  forceWave(n: number): void {
    this.beginWave(n);
  }

  // ------------------------------------------------------------------- update

  /** One fixed simulation step. */
  step(dt: number): void {
    this.elapsed += dt;

    if (this.state === STATE.PLAYING) {
      this.player.update(dt, this.input.move(), this.collision);
      // Enemies compare their own height against the player's feet, not the eye.
      this.world.playerY = this.player.position.y - WORLD.PLAYER_H;
      // Sync the rig to the current view before firing, so a shot's ray matches
      // the crosshair this frame rather than the camera left by the last render.
      this.applyCameraPose();
      this.arena.camera.updateWorldMatrix(true, false);
      this.weapon.aiming = this.input.aiming;
      this.weapon.update(dt, this.elapsed, this.input.firing);
      this.updateWaves(dt);
      this.updateBombs(dt);
      this.updateXps(dt);
      this.updateCapture(dt);
      this.updateAlarm(dt);
    } else if (this.state === STATE.MENU) {
      const pose = this.player.menuPose(this.elapsed);
      this.player.position.x = pose.x;
      this.player.position.y = pose.y;
      this.player.position.z = pose.z;
      this.player.yaw = pose.yaw;
      this.player.pitch = pose.pitch;
    }

    this.decayFeedback(dt);
  }

  private updateWaves(dt: number): void {
    const waveBefore = this.waves.wave;
    const result = this.waves.update(dt, this.player.position, this.aliveCount);
    for (const req of result.spawned) {
      const enemy = new Enemy(req.kind, req.x, req.z, this.rng);
      enemy.scaleUp(
        (this.waves.wave - 1) * WAVES.HP_PER_WAVE[req.kind],
        req.speedScale,
        dmgBonus(this.waves.wave),
      );
      const view = new EnemyView(enemy);
      view.addTo(this.arena.scene);
      this.pick.add(view.body, view.head);
      this.hostiles.push({ enemy, view });
      this.aliveCount++;
    }

    const scratch = this.enemyScratch;
    scratch.length = 0;
    for (const h of this.hostiles) scratch.push(h.enemy);
    this.hash.rebuild(scratch);

    const world = this.world;
    world.hostileCount = this.waves.hostileCount(this.aliveCount);

    for (let i = this.hostiles.length - 1; i >= 0; i--) {
      const h = this.hostiles[i]!;
      world.neighbours = this.hash.neighbours(h.enemy);
      if (h.enemy.update(dt, world)) {
        h.view.dispose(this.arena.scene);
        this.pick.remove(h.view.body);
        this.pick.remove(h.view.head);
        this.hostiles.splice(i, 1);
      }
    }
    let alive = 0;
    for (const h of this.hostiles) if (h.enemy.state === 'alive') alive++;
    this.aliveCount = alive;

    if (result.cleared && !this.waveClearPending) {
      this.hp = Math.min(START_HP, this.hp + WAVES.WAVE_HEAL);
      this.hud.showBanner(`WAVE ${this.wave} CLEARED`, `+${WAVES.WAVE_HEAL} INTEGRITY RESTORED`);
      this.sfx.wave();
      this.waveClearPending = true;
    }

    // WaveDirector advances after the intermission; mirror that here instead of
    // relying on Game.wave, which otherwise stays stale and makes every later
    // wave look (and announce) like "wave 1 complete" forever.
    if (this.waves.wave > waveBefore) {
      this.wave = this.waves.wave;
      this.hud.showBanner(`WAVE ${this.wave}`, this.wave === 1 ? 'GET READY' : 'HOSTILES INCOMING');
      this.sfx.wave();
      this.waveClearPending = false;
    }
  }

  private decayFeedback(dt: number): void {
    const f = this.feedback;
    if (f.hitT > 0) f.hitT -= dt * FEEDBACK.HITMARK_DECAY;
    if (f.vignetteT > 0) f.vignetteT = Math.max(0, f.vignetteT - dt * FEEDBACK.VIGNETTE_DECAY);
    f.shakeT *= Math.exp(-CAMERA.SHAKE_DECAY * dt);
  }

  /** Put the camera rig where the player is looking (base pose, no recoil/bob). */
  private applyCameraPose(): void {
    const player = this.player;
    const { yawObj, pitchObj } = this.arena.rig;
    yawObj.position.set(player.position.x, player.position.y, player.position.z);
    yawObj.rotation.y = player.yaw;
    pitchObj.rotation.x = player.pitch;
    pitchObj.rotation.y = 0;
  }

  /** Draw the current simulation state. Runs once per animation frame. */
  render(dt: number): void {
    const player = this.player;
    const weapon = this.weapon;
    const { pitchObj } = this.arena.rig;

    // The viewmodel belongs to a live run: visible while playing and behind the
    // pause overlay, hidden on the title and game-over screens. Driving this
    // from state (not from a transition) is what keeps it alive across resume.
    this.gun.show(this.state === STATE.PLAYING || this.state === STATE.PAUSED);

    if (this.state === STATE.PLAYING) {
      this.applyCameraPose();
      pitchObj.rotation.x +=
        weapon.recoil +
        (this.feedback.shakeT > 0 ? (this.rng.next() - 0.5) * this.feedback.shakeT * CAMERA.SHAKE_PITCH : 0);
      pitchObj.rotation.y =
        this.feedback.shakeT > 0 ? (this.rng.next() - 0.5) * this.feedback.shakeT * CAMERA.SHAKE_YAW : 0;
      pitchObj.position.y = Math.sin(player.bobPhase * 2) * CAMERA.BOB_Y;

      const dip = weapon.reloading ? Math.sin(weapon.reloadProgress * Math.PI) : 0;
      this.gun.pose(player.bobPhase, weapon.kick, dip, this.input.strafe);
      this.gun.decay(dt, weapon.flashT);
    }

    this.arena.camera.getWorldQuaternion(this.camQuat);
    for (const h of this.hostiles) h.view.sync(player.position, this.camQuat);

    // Bombs blink, and the closest live one drives the HUD warning.
    let nearestD = Number.POSITIVE_INFINITY;
    let nearestFuse = 0;
    const px = player.position.x;
    const pz = player.position.z;
    for (const bomb of this.bombs) {
      this.bombViews.get(bomb)?.sync(this.elapsed);
      const d = Math.hypot(bomb.pos.x - px, bomb.pos.z - pz);
      if (d < nearestD) {
        nearestD = d;
        nearestFuse = bomb.fuse;
      }
    }

    for (const xp of this.xps) this.xpViews.get(xp)?.sync();

    // Only the live deck draws a pad; the beacons carry the rest.
    const cap = this.capture;
    const pads = this.arena.pads;
    const hot = this.alarm.hot;
    for (let i = 0; i < pads.length; i++) {
      const active = i === cap.active;
      const alarm = hot[i] ?? false;
      pads[i]?.sync(active, cap.ready, active ? cap.progress : 0, this.elapsed, alarm);
      const blip = this.mapTowers[i];
      if (blip) blip.hot = alarm;
    }

    this.fx.update(dt);

    // ADS zoom: ease the camera FOV to its target instead of popping.
    const fovTarget = this.weapon.aiming ? CAMERA.FOV * CAMERA.AIM_FOV_SCALE : CAMERA.FOV;
    if (Math.abs(this.fov - fovTarget) > 0.05) {
      this.fov += (fovTarget - this.fov) * Math.min(1, dt * 9);
      this.arena.camera.fov = this.fov;
      this.arena.camera.updateProjectionMatrix();
    }

    this.arena.render();

    const m = this.model;
    m.hp = this.hp;
    m.score = this.score;
    m.wave = this.wave;
    m.hostiles = this.waves.hostileCount(this.aliveCount);
    m.state = this.state;
    m.vignetteT = this.feedback.vignetteT;
    m.ammo = weapon.ammo;
    m.reloading = weapon.reloading;
    m.reloadProgress = weapon.reloadProgress;
    m.bloom = weapon.bloom;
    m.moving = player.moving;
    m.stamina = player.stamina;
    m.bombDist = nearestD;
    m.bombFuse = nearestFuse;
    m.captureProgress = cap.progress;
    m.captureOn = cap.onPad;

    if (this.state === STATE.PLAYING || this.state === STATE.PAUSED) {
      this.minimap.draw(px, pz, player.yaw, this.hostiles, this.bombs, this.elapsed, this.mapTowers);
    }

    this.hud.setHitmark(this.feedback.hitT);
    this.hud.setVignette(m, this.elapsed);
    this.hud.setADS(this.weapon.aiming);
    if (this.state === STATE.PLAYING) this.hud.update(m, this.settings.values);
  }
}

const EMPTY: readonly Enemy[] = [];
