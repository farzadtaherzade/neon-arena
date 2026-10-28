import * as THREE from 'three';

import { Music } from '../audio/Music';
import { Sfx } from '../audio/Sfx';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import { TowerAlarm } from '../game/alarm';
import { Bomb } from '../game/bomb';
import { CapturePoints } from '../game/capture';
import {
  ALARM,
  AMMO,
  BOMB,
  CAMERA,
  CAPTURE,
  CREDITS,
  DEFAULT_THEME,
  ENEMY,
  FEEDBACK,
  type GameState,
  KNIFE,
  METEOR,
  PERK_DEFS,
  PERKS,
  type PerkId,
  SCREEN,
  START_HP,
  STATE,
  THEMES,
  TOUCH,
  WAVES,
  WEAPON,
  WORLD,
  XP_LEVEL,
} from '../game/config';
import { SpatialHash } from '../game/enemies';
import { Enemy, type EnemyWorld } from '../game/enemy';
import { Knife } from '../game/knife';
import { type Meteor, MeteorShower } from '../game/meteor';
import { Perks } from '../game/perks';
import { Player } from '../game/player';
import { dmgBonus, WaveDirector } from '../game/waves';
import { Weapon } from '../game/weapon';
import { CollisionWorld } from '../game/world/collision';
import { XP, Xp, XpMeter } from '../game/xp';
import { Arena } from '../render/Arena';
import { BombView } from '../render/BombView';
import { EnemyView } from '../render/EnemyView';
import { Fx } from '../render/Fx';
import { GunView } from '../render/Gun';
import { KnifeView } from '../render/Knife';
import { MeteorView } from '../render/MeteorView';
import { Pick } from '../render/Pick';
import { XpView } from '../render/XpView';
import { Hud, type HudModel } from '../ui/Hud';
import { Input } from '../ui/Input';
import { MapScreen } from '../ui/MapScreen';
import { type MapTower, Minimap } from '../ui/Minimap';
import { PerkScreen } from '../ui/Perks';
import { Profile } from '../ui/Profile';
import { Settings } from '../ui/Settings';
import { Skins } from '../ui/Skins';
import { isTouchDevice, Touch } from '../ui/Touch';

/** Display strings by perk id, for the offer cards and the HUD tags. */
const PERK_BY_ID = new Map(PERK_DEFS.map((d) => [d.id, d]));

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
  /** Player progression: level and the XP banked toward the next one. */
  readonly meter = new XpMeter();
  /** The perks this run has taken; level-ups pause behind an offer from here. */
  readonly perks = new Perks();
  /** What full integrity is this run — PLATING raises it above `START_HP`. */
  maxHp = START_HP;
  /** The random sky event: a meteor shower that drops rocks around the player. */
  readonly shower = new MeteorShower();
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
  /** The touch layer; absent on pointer devices (`enabled` false is a no-op). */
  private touch: Touch;
  /** Touch controls active — a coarse-pointer device, or `?touch` for the harness. */
  private readonly touchEnabled: boolean;
  /** Set while a portrait rotation paused the run, so the landscape return resumes it. */
  private rotatePaused = false;
  private gun = new GunView();
  private knifeView = new KnifeView();
  /** The level-up perk offer screen; visible only while an offer stands. */
  private perkScreen = new PerkScreen({ onPick: (id) => this.pickPerkId(id) });
  /** The knife: a cone in front of the player, on its own cooldown. */
  readonly knife = new Knife();
  /** Reused: the mobs a knife swing caught this frame. */
  private knifeHits: Enemy[] = [];
  /** Reused: the live mobs the knife tests against. */
  private knifeEnemies: Enemy[] = [];

  // Public because `main.ts` drives them from the headless E2E suite.
  readonly settings: Settings;
  readonly weapon: Weapon;
  readonly hostiles: Hostile[] = [];
  /** The credits wallet and the loadout. The credits survive a death. */
  readonly profile = new Profile();
  private skins: Skins;
  private hash = new SpatialHash();
  /** Reused each step: the broadphase rebuild must not allocate an array per tick. */
  private enemyScratch: Enemy[] = [];
  /** The world handed to enemies each step — built once, mutated in place. */
  private readonly world: EnemyWorld;

  /** Live sapper bombs and the meshes backing them. */
  private bombs: Bomb[] = [];
  private bombViews = new Map<Bomb, BombView>();
  private minimap: Minimap;
  /** The full-screen tactical map, and whether it is open right now. */
  private map: MapScreen;
  private mapOpen = false;
  /**
   * Set while the map holds a pointer lock it released itself. The unlock is
   * reported asynchronously, and it can land *after* the map closed — which
   * would re-pause a run the map had just resumed.
   */
  private mapLockRelease = false;

  /** XP orbs on the floor and the meshes backing them. */
  private xps: Xp[] = [];
  private xpViews = new Map<Xp, XpView>();
  /** Falling stones and the meshes backing them. */
  private meteorViews = new Map<Meteor, MeteorView>();
  /** Built once: the shower asks the world these questions every step. */
  private readonly groundFn = (x: number, z: number): number => this.groundAt(x, z);
  private readonly blockedFn = (x: number, z: number): boolean =>
    this.collision.blockedAt(x, z, METEOR.CLEAR_R);
  /** HP still to be paid out by a secured deck, at `CAPTURE.HEAL / HEAL_T` per second. */
  private healLeft = 0;
  /** Reused per-step scratch: does each tower see hostiles right now? */
  private alarmContact: boolean[] = [];
  /** Reused minimap blips, mutated each frame instead of reallocated. */
  private readonly mapTowers: MapTower[] = [];
  /** Current camera FOV, lerped toward the ADS target so it never pops. */
  private fov: number = CAMERA.FOV;
  /** Base FOV from the settings panel; the ADS target is a fraction of it. */
  private baseFov: number = CAMERA.FOV;
  /** The theme the arena is currently built with, so a change re-syncs the pick list. */
  private appliedTheme: string = DEFAULT_THEME;

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

  /** Touch layer state for the `__NEON.touch()` hook. */
  get touchInfo(): {
    enabled: boolean;
    visible: boolean;
    portrait: boolean;
    firing: boolean;
    aiming: boolean;
    shootMode: string;
  } {
    return {
      enabled: this.touchEnabled,
      ...this.touch.stats,
      shootMode: this.settings.values.touch.shootMode,
    };
  }

  private scratch = new THREE.Vector3();
  private tracerEnd = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  /** Scratch point for `CollisionWorld.groundHeight` queries that must not allocate. */
  private groundProbe = { x: 0, z: 0 };
  private model: HudModel = {
    hp: 0,
    maxHp: START_HP,
    score: 0,
    wave: 0,
    hostiles: 0,
    state: '',
    vignetteT: 0,
    ammo: 0,
    reserve: 0,
    dry: false,
    reloading: false,
    reloadProgress: 0,
    bloom: 0,
    moving: false,
    stamina: WORLD.STAMINA_MAX,
    bombDist: Number.POSITIVE_INFINITY,
    bombFuse: 0,
    captureProgress: 0,
    captureOn: false,
    level: 1,
    xp: 0,
    xpNeed: 1,
    credits: 0,
  };

  constructor(
    readonly test = false,
    touchOverride = false,
  ) {
    this.touchEnabled = touchOverride || (!test && isTouchDevice());
    this.arena = new Arena(this.collision, this.rng);
    this.capture = new CapturePoints(this.arena.pads.map((pad) => pad.deck));
    this.alarm = new TowerAlarm(this.arena.pads.length);
    this.alarmContact = new Array<boolean>(this.arena.pads.length).fill(false);
    for (const pad of this.arena.pads) {
      this.mapTowers.push({ x: pad.deck.x, z: pad.deck.z, hot: false });
    }
    this.fx = new Fx(this.arena.scene);
    this.minimap = new Minimap();
    this.map = new MapScreen();
    this.arena.camera.add(this.gun.group);
    this.arena.camera.add(this.knifeView.group);
    this.pick.add(...this.arena.solids);

    this.skins = new Skins({
      getProfile: () => this.profile.data,
      onBuy: (id) => this.buySkin(id),
      onEquip: (id) => this.equipSkin(id),
    });
    this.applySkins();

    this.settings = new Settings(this.hud.crosshair, {
      onOpen: () => {
        // Desktop drops pointer lock, which pauses the run through the normal
        // lock flow, so closing the panel lands the player on the pause screen.
        // Touch has no lock to drop, so it pauses directly.
        if (this.state === STATE.PLAYING) {
          if (this.touchEnabled) this.pauseGame();
          else this.input.release();
        }
      },
      onChange: (values) => {
        document.documentElement.classList.toggle('no-crt', !values.video.crt);
        this.player.sens = values.game.sensitivity;
        this.sfx.setMuted(values.game.mute);
        this.music.setMuted(values.game.mute);
        this.baseFov = values.game.fov;
        // A theme swap rebuilds the static world, so the pick list has to be
        // re-pointed at the fresh meshes before the next shot resolves.
        const oldSolids = values.video.theme !== this.appliedTheme ? [...this.arena.solids] : null;
        this.arena.setVideo(values.video);
        if (oldSolids) {
          for (const s of oldSolids) this.pick.remove(s);
          this.pick.add(...this.arena.solids);
          this.appliedTheme = values.video.theme;
          this.applyUiTheme(values.video.theme);
        }
      },
      onShowTab: (tab) => {
        if (tab === 'skins') this.skins.refresh();
      },
    });
    this.player.sens = this.settings.values.game.sensitivity;
    this.sfx.setMuted(this.settings.values.game.mute);
    this.music.setMuted(this.settings.values.game.mute);
    this.baseFov = this.settings.values.game.fov;
    this.fov = this.baseFov;
    this.arena.setVideo(this.settings.values.video);

    // First launch on a touch device: phones meet this renderer with a
    // fraction of a desktop's fill-rate, so quality LOW (1× pixels, no
    // shadows, no scanline overlay) is the honest default. It is a stored
    // setting, not a cap.
    if (this.touchEnabled && !this.settings.values.touch.tuned) {
      this.settings.setVideo({ quality: 0, shadows: false, crt: false });
      this.settings.setTouch({ tuned: true });
    }

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
        onKnife: () => this.swingKnife(),
        onLook: (dx, dy) => {
          const g = this.settings.values.game;
          this.player.look(dx, g.invertY ? -dy : dy, g.sensitivity);
        },
        // The bare-click resume path: desktop re-takes the lock, touch has no
        // lock so it resumes directly. A no-op while already playing.
        onLockRequest: () => {
          if (this.touchEnabled) this.resumeGame();
          else this.input.lock();
        },
        onLockChange: (locked) => this.onLockChange(locked),
        onToggleSettings: () => this.settings.toggle(),
        onCloseSettings: () => this.settings.close(),
        onToggleMap: () => this.toggleMap(),
        onPerkSlot: (index) => this.pickPerk(index),
      },
      test,
    );

    this.touch = new Touch(
      {
        onLook: (dx, dy) => {
          const g = this.settings.values;
          // Touch drags get their own gain on top of WEAPON.SENS, and their own
          // sensitivity setting — a thumb is not a mouse.
          this.player.look(dx, g.game.invertY ? -dy : dy, TOUCH.LOOK_GAIN * g.touch.touchSensitivity);
        },
        onJump: () => this.player.queueJump(),
        onReload: () => this.weapon.startReload(),
        onKnife: () => this.swingKnife(),
        onPause: () => this.pauseGame(),
        onRotate: (portrait) => this.onRotate(portrait),
        onFireMode: (mode) => this.settings.setTouch({ shootMode: mode, shootModeChosen: true }),
      },
      this.touchEnabled,
    );
    if (this.touchEnabled) {
      // The overlay must be up before the first frame paints a sideways arena.
      this.touch.reportOrientation();
      if (!this.test && !this.settings.values.touch.shootModeChosen) this.touch.showFirePrompt(true);
    }

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
      knockPlayer: (dirX, dirZ, force) => this.knockPlayer(dirX, dirZ, force),
      plantBomb: (from, to, thrown) => this.plantBomb(from, to, thrown),
    };

    document.getElementById('menuDeploy')!.addEventListener('click', () => this.start(false));
    document.getElementById('menuControls')!.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('menuKeys')!.toggleAttribute('hidden');
    });
    document.getElementById('pauseResume')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.touchEnabled) this.resumeGame();
      else this.input.lock();
    });
    document.getElementById('pauseMenu')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toMenu();
    });
    document.getElementById('overRetry')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.start(false);
    });
    document.getElementById('overMenu')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toMenu();
    });
    document.getElementById('gameOverScreen')!.addEventListener('click', () => this.start(false));
  }

  /** Back to the main menu, from the pause or the game-over screen. */
  toMenu(): void {
    this.state = STATE.MENU;
    this.input.firing = false;
    this.touch.clear();
    this.input.release();
    this.hud.setVisible(false);
    this.hud.showScreen(SCREEN.MENU);
    this.music.stop();
  }

  /** Paint the HUD and menus in the arena theme's two accents. */
  private applyUiTheme(themeId: string): void {
    const t = THEMES[themeId as keyof typeof THEMES] ?? THEMES[DEFAULT_THEME];
    const root = document.documentElement.style;
    root.setProperty('--accent', t.cssAccent);
    root.setProperty('--danger', t.cssDanger);
  }

  /**
   * Pause without pointer lock — the touch path. The pause screen appears as
   * usual; on touch there is no lock to drop, so resume goes through
   * `resumeGame` instead of a re-lock.
   */
  private pauseGame(): void {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.input.firing = false;
    this.touch.clear();
    if (!this.test && !this.mapOpen) this.hud.showScreen(SCREEN.PAUSE);
  }

  /** The touch half of pause: leave the pause screen. */
  private resumeGame(): void {
    if (this.state !== STATE.PAUSED) return;
    this.state = STATE.PLAYING;
    if (!this.test && !this.mapOpen) this.hud.showScreen(SCREEN.NONE);
  }

  /**
   * The phone rotated. Portrait shows the TURN YOUR PHONE overlay and pauses a
   * live run; rotating back resumes it — but only if the rotation is what
   * paused it, so a player who paused deliberately stays paused.
   */
  private onRotate(portrait: boolean): void {
    this.touch.setRotate(portrait);
    if (portrait && this.state === STATE.PLAYING) {
      this.rotatePaused = true;
      this.pauseGame();
    } else if (!portrait && this.rotatePaused && this.state === STATE.PAUSED) {
      this.rotatePaused = false;
      this.resumeGame();
    }
  }

  /**
   * Open or close the tactical map.
   *
   * The run is paused while the map is open, so the map itself owns the state
   * change rather than waiting for the pointer-lock flow.
   */
  toggleMap(): void {
    if (this.mapOpen) {
      this.mapOpen = false;
      this.map.hide();
      this.state = STATE.PLAYING;
      if (!this.test) this.input.lock();
      return;
    }
    // Only a live run can open the map: from the menu or the game-over screen
    // the PAUSED → PLAYING round trip below would fabricate or resurrect a run.
    if (this.state !== STATE.PLAYING) return;
    this.mapOpen = true;
    this.state = STATE.PAUSED;
    this.input.firing = false;
    this.map.show();
    // Only a lock we actually hold produces an unlock report to swallow.
    this.mapLockRelease = this.input.hasPointerLock;
    this.input.release();
  }

  // ---------------------------------------------------------------- lifecycle

  start(skipLock = false): void {
    this.sfx.init();
    this.music.init();
    this.music.setMuted(this.settings.values.game.mute);
    this.music.start();
    this.reset();
    this.beginWave(1);
    this.hud.setVisible(true);
    this.state = STATE.PLAYING;

    if (this.test) this.hud.hideAllScreens();
    else this.hud.showScreen(SCREEN.NONE);

    // Touch has no pointer lock to take — the layer is the input surface.
    if (!skipLock && !this.touchEnabled) this.input.lock();
  }

  private reset(): void {
    this.waves.reset();
    this.fx.clear();
    this.weapon.reset();
    this.player.reset();
    this.clearHostiles();
    this.clearBombs();
    this.clearXps();
    this.clearMeteors();
    this.capture.reset();
    this.alarm.reset();
    this.healLeft = 0;
    this.meter.reset();
    this.perks.reset();
    this.applyPerks();
    this.perkScreen.hide();
    this.hud.setPerkTags([]);
    this.shower.reset();

    this.hp = START_HP;
    this.score = 0;
    this.kills = 0;
    this.wave = 0;
    this.feedback.hitT = 0;
    this.feedback.vignetteT = 0;
    this.feedback.shakeT = 0;

    this.input.firing = false;
    this.touch.clear();
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

  /** Shove the player — the tank's ground slam. */
  private knockPlayer(dirX: number, dirZ: number, force: number): void {
    this.player.velocity.x += dirX * force;
    this.player.velocity.z += dirZ * force;
  }

  private onLockChange(locked: boolean): void {
    if (!locked && this.mapLockRelease) {
      // The map took the pointer lock away on purpose; that is not a pause.
      this.mapLockRelease = false;
      return;
    }
    if (locked) this.mapLockRelease = false;
    if (!locked && this.state === STATE.PLAYING) {
      this.state = STATE.PAUSED;
      this.input.firing = false;
      if (!this.test && !this.mapOpen) this.hud.showScreen(SCREEN.PAUSE);
    } else if (locked && this.state === STATE.PAUSED) {
      this.state = STATE.PLAYING;
      if (!this.test) this.hud.showScreen(SCREEN.NONE);
    }
  }

  private beginWave(n: number): void {
    this.wave = n;
    this.waveClearPending = false;
    this.waves.start(n);
    // A resupply at the start of every wave, on top of what the mobs drop.
    this.weapon.addAmmo(WAVES.AMMO_PER_WAVE);
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
      const dir = this.pick.direction;
      // The plate only covers what the mob is facing, so it needs to know where
      // the shot came from.
      const from = { dirX: -dir.x, dirZ: -dir.z, headshot, melee: false };
      if (enemy.takeDamage(this.weapon.damage(headshot), from)) this.killEnemy(enemy, headshot);
      else enemy.knockback(dir.x, dir.z);
      return;
    }

    const p = hit.point;
    this.fx.burst(
      { x: p.x, y: p.y, z: p.z, color: 0xffc266, count: 8, speed: 3, life: 0.4, gravity: 9 },
      this.rng,
    );
  }

  private missEnd(): THREE.Vector3 {
    // The camera lives inside the yaw/pitch rig, so its local position is a
    // permanent (0,0,0) — the ray leaves from its world position, not that.
    this.arena.camera.getWorldPosition(this.tracerEnd);
    return this.tracerEnd.addScaledVector(this.pick.direction, WEAPON.MAX_RANGE);
  }

  /**
   * The knife. A cone in front of the player: everything in the arc takes the
   * hit. It never touches a bomb — that stays a rifle job.
   */
  swingKnife(): void {
    if (this.state !== STATE.PLAYING) return;
    const p = this.player.position;
    const mobs = this.knifeEnemies;
    mobs.length = 0;
    for (const h of this.hostiles) mobs.push(h.enemy);
    const count = this.knife.swing(p.x, p.y - WORLD.PLAYER_H, p.z, this.player.yaw, mobs, this.knifeHits);
    if (count === 0) return;
    this.sfx.slash();
    for (const enemy of this.knifeHits) {
      const dx = p.x - enemy.pos.x;
      const dz = p.z - enemy.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const hit = { dirX: dx / d, dirZ: dz / d, headshot: false, melee: true };
      this.fx.burst(
        {
          x: enemy.pos.x,
          y: enemy.pos.y + 0.9 * enemy.scale,
          z: enemy.pos.z,
          color: 0xff8866,
          count: 12,
          speed: 3.5,
          life: 0.4,
          gravity: 9,
        },
        this.rng,
      );
      if (enemy.takeDamage(KNIFE.DAMAGE, hit)) this.killEnemy(enemy, false);
    }
  }

  // --------------------------------------------------------------------- shop

  /**
   * Does the auto-fire mode want the trigger pulled right now?
   *
   * A centre-ray pick at zero spread against the same target list the shots
   * use: the trigger fires exactly when the crosshair rests on a hostile.
   * Bombs are deliberately excluded — defusing stays a deliberate shot — and
   * the real shot re-aims with the weapon's true spread afterwards.
   */
  private autoFireWants(): boolean {
    if (!this.touchEnabled) return false;
    if (this.settings.values.touch.shootMode !== 'auto') return false;
    this.pick.aim(this.arena.camera, 0, this.rng);
    return this.pick.cast()?.enemy != null;
  }

  /** Buy a skin with credits. False when it is unknown, owned or too dear. */
  buySkin(id: string): boolean {
    const bought = this.profile.buy(id);
    if (bought) this.skins.refresh();
    return bought;
  }

  /** Equip an owned skin and put it on the viewmodel. */
  equipSkin(id: string): boolean {
    const equipped = this.profile.equip(id);
    if (equipped) {
      this.applySkins();
      this.skins.refresh();
    }
    return equipped;
  }

  /** Wear the equipped skins. */
  private applySkins(): void {
    this.gun.applySkin(this.profile.equippedSkin('rifle'));
    this.knifeView.applySkin(this.profile.equippedSkin('knife'));
  }

  private killEnemy(enemy: Enemy, headshot: boolean): void {
    const hostile = this.hostiles.find((h) => h.enemy === enemy);
    if (!hostile || !enemy.kill()) return;

    hostile.view.removeTargets(this.pick);
    const origin = { x: enemy.pos.x, y: enemy.pos.y + 0.9 * enemy.scale, z: enemy.pos.z };
    this.fx.burst({ ...origin, color: 0xff4455, count: 26, speed: 5, life: 0.7, gravity: 9 }, this.rng);
    this.fx.burst({ ...origin, color: 0xff8866, count: 10, speed: 3, life: 0.5, gravity: 9 }, this.rng);

    this.spawnXp(enemy.pos.x, enemy.pos.y, enemy.pos.z, XP.VALUE[enemy.kind]);
    // The mob's rounds go into the reserve, so a wave of them is a resupply.
    // SCAVENGER fattens the drop.
    this.weapon.addAmmo(Math.round(AMMO.DROP[enemy.kind] * this.perks.ammoDropMul));
    // A knife kill pays the same as a gun kill.
    this.profile.addCredits(CREDITS.KILL[enemy.kind] + (headshot ? CREDITS.HEADSHOT : 0));

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
  private spawnXp(x: number, y: number, z: number, value: number): void {
    const xp = new Xp(x, z, value, y + 0.5);
    const view = new XpView(xp);
    view.addTo(this.arena.scene);
    this.xps.push(xp);
    this.xpViews.set(xp, view);
  }

  /** Magnet orbs toward the player, collecting them at `XP.COLLECT`. */
  private updateXps(dt: number): void {
    const magnet = XP.RADIUS * this.perks.xpRadiusMul;
    for (let i = this.xps.length - 1; i >= 0; i--) {
      const xp = this.xps[i];
      if (!xp) continue;
      if (!xp.update(dt, this.player.position, magnet)) continue;

      const view = this.xpViews.get(xp);
      if (view) {
        view.dispose(this.arena.scene);
        this.xpViews.delete(xp);
      }
      this.xps.splice(i, 1);
      // Orbs are XP, not score: the score comes from kills.
      if (this.meter.add(xp.value)) this.levelUp();
      this.feedback.hitT = 1;
      this.sfx.xpCollect();
      this.hud.xpPop(xp.value);
    }
  }

  /**
   * A level up pays a repair — paid out over time like a secured deck, but
   * smaller, so capturing a deck stays the premium heal — and offers a perk,
   * which pauses the run behind the offer screen.
   */
  private levelUp(): void {
    this.healLeft += XP_LEVEL.HEAL;
    this.hud.showBanner(`LEVEL ${this.meter.level}`, `+${XP_LEVEL.HEAL} INTEGRITY`);
    this.sfx.wave();
    this.offerPerks();
  }

  /**
   * Pause the run behind a perk offer. One offer stands at a time: a level
   * crossed while an offer is open (a fat orb bank) simply waits for the next.
   */
  private offerPerks(): void {
    if (this.perks.isOffering) return;
    const offer = this.perks.makeOffer(this.rng);
    if (offer.length === 0) return;
    this.state = STATE.PAUSED;
    this.input.firing = false;
    this.touch.clear();
    this.perkScreen.show(
      this.meter.level,
      offer.map((id) => {
        const def = PERK_BY_ID.get(id);
        return {
          id,
          name: def?.name ?? id.toUpperCase(),
          flavour: def?.flavour ?? '',
          stacks: this.perks.count(id),
        };
      }),
    );
    // Clicking a card needs the cursor back, exactly like the map does.
    this.input.release();
  }

  /** Take the offered perk at `index` and go back to playing. */
  pickPerk(index: number): void {
    const id: PerkId | undefined = this.perks.offer[index];
    if (id) this.pickPerkId(id);
  }

  /** Take a specific offered perk — the card click and the 1/2/3 keys end here. */
  pickPerkId(id: PerkId): void {
    if (this.state !== STATE.PAUSED || !this.perks.isOffering) return;
    if (!this.perks.offer.includes(id)) return;
    this.perks.take(id);
    this.applyPerks();
    // PLATING repairs the bonus it just added, against the new max.
    if (id === 'plating') this.hp = Math.min(this.maxHp, this.hp + PERKS.MAX_HP_BONUS);
    this.perkScreen.hide();
    this.hud.setPerkTags(this.perkTagList());
    this.state = STATE.PLAYING;
    if (!this.test) this.input.lock();
  }

  /** Push the perk multipliers out to the systems that read them. */
  private applyPerks(): void {
    const p = this.perks;
    this.player.speedMul = p.moveMul;
    this.player.staminaRegenMul = p.staminaRegenMul;
    this.weapon.reloadMul = p.reloadMul;
    this.weapon.damageMul = p.damageMul;
    this.weapon.bloomMul = p.bloomMul;
    this.maxHp = START_HP + p.maxHpBonus;
  }

  /** "OVERCLOCK ×2" chips for the stats panel. */
  private perkTagList(): string[] {
    const tags: string[] = [];
    for (const def of PERK_DEFS) {
      const stacks = this.perks.count(def.id);
      if (stacks > 0) tags.push(stacks > 1 ? `${def.name} ×${stacks}` : def.name);
    }
    return tags;
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
      // Added, not replaced: a level-up repair mid-payout has to survive the
      // capture. The START_HP cap below keeps the pool from overhealing.
      this.healLeft += CAPTURE.HEAL;
      this.profile.addCredits(CREDITS.CAPTURE);
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

  // ------------------------------------------------------------------ meteors

  /** The walkable surface under (x, z) — where a stone would land. */
  private groundAt(x: number, z: number): number {
    const probe = this.groundProbe;
    probe.x = x;
    probe.z = z;
    return this.collision.groundHeight(probe, METEOR.CLEAR_R, Number.POSITIVE_INFINITY);
  }

  /** One step of the sky event: run the schedule, drop stones, resolve impacts. */
  private updateMeteorShower(dt: number): void {
    const out = this.shower.update(dt, this.player.position, this.rng, this.groundFn, this.blockedFn);

    if (out.started) {
      this.hud.showBanner('METEOR SHOWER', 'DODGE THE DEBRIS');
      this.sfx.alarm();
    }

    for (const meteor of out.impacts) {
      this.meteorImpact(meteor);
      const view = this.meteorViews.get(meteor);
      if (view) {
        view.dispose(this.arena.scene);
        this.meteorViews.delete(meteor);
      }
    }
  }

  /** A stone landed: it shakes the arena and hurts whatever is in the blast. */
  private meteorImpact(meteor: Meteor): void {
    const { x, y, z } = meteor.impact;
    this.fx.burst(
      { x, y: y + 0.5, z, color: 0xffa23a, count: 24, speed: 7, life: 0.6, gravity: 6 },
      this.rng,
    );
    this.fx.burst(
      { x, y: y + 0.2, z, color: 0xff3a22, count: 12, speed: 5, life: 0.8, gravity: 4 },
      this.rng,
    );
    this.feedback.shakeT = Math.max(this.feedback.shakeT, METEOR.SHAKE);

    const p = this.player.position;
    const pd = Math.hypot(p.x - x, p.y - WORLD.PLAYER_H - y, p.z - z);
    if (pd < METEOR.SOUND_R) this.sfx.explode();
    if (pd < METEOR.RADIUS) this.damagePlayer(METEOR.PLAYER_DMG * (1 - pd / METEOR.RADIUS));

    for (const h of this.hostiles) {
      const enemy = h.enemy;
      if (enemy.state !== 'alive') continue;
      const d = Math.hypot(enemy.pos.x - x, enemy.pos.y - y, enemy.pos.z - z);
      if (d >= METEOR.RADIUS) continue;
      if (enemy.takeDamage(METEOR.ENEMY_DMG)) this.killEnemy(enemy, false);
      else {
        const inv = 1 / (d || 1);
        enemy.knockback((enemy.pos.x - x) * inv, (enemy.pos.z - z) * inv);
      }
    }
  }

  private clearMeteors(): void {
    for (const view of this.meteorViews.values()) view.dispose(this.arena.scene);
    this.meteorViews.clear();
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

  /** Headless hook: start a meteor shower now instead of waiting for the dice. */
  forceMeteor(): void {
    this.shower.force();
  }

  /** Headless hook: plant a stone on an exact spot. */
  dropStone(x: number, z: number): void {
    this.shower.drop(x, z, this.groundAt(x, z), this.rng);
  }

  /** Headless hook: bank XP without waiting for a pickup. */
  grantXp(amount: number): void {
    if (this.meter.add(amount)) this.levelUp();
  }

  /** Headless hook: sweep every orb off the floor, so XP banking is deterministic. */
  clearOrbs(): void {
    this.clearXps();
  }

  get meteorStats(): { phase: string; tint: number; stones: number } {
    return {
      phase: this.shower.phase,
      tint: Math.round(this.shower.tint * 100) / 100,
      stones: this.shower.stones.length,
    };
  }

  // ------------------------------------------------------------------- update

  /** One fixed simulation step. */
  step(dt: number): void {
    this.elapsed += dt;

    if (this.state === STATE.PLAYING) {
      // Keyboard/mouse intent plus the stick's, merged — the player never has
      // both at once, but the merge is what keeps `Player` input-agnostic.
      const moveIn = this.input.move();
      if (this.touchEnabled) {
        const t = this.touch.move;
        moveIn.forward = clamp(moveIn.forward + t.forward, -1, 1);
        moveIn.right = clamp(moveIn.right + t.right, -1, 1);
        moveIn.sprint = moveIn.sprint || t.sprint;
      }
      this.player.update(dt, moveIn, this.collision);
      // Enemies compare their own height against the player's feet, not the eye.
      this.world.playerY = this.player.position.y - WORLD.PLAYER_H;
      // Sync the rig to the current view before firing, so a shot's ray matches
      // the crosshair this frame rather than the camera left by the last render.
      this.applyCameraPose();
      this.arena.camera.updateWorldMatrix(true, false);
      this.weapon.aiming = this.input.aiming || this.touch.aiming;
      // The trigger: mouse, fire key, FIRE button — or the auto-fire mode,
      // which pulls it whenever the crosshair is over a hostile.
      let firing = this.input.trigger || this.touch.firing;
      if (!firing && this.autoFireWants()) firing = true;
      this.weapon.update(dt, this.elapsed, firing);
      this.knife.update(dt);
      this.updateWaves(dt);
      this.updateBombs(dt);
      this.updateXps(dt);
      this.updateCapture(dt);
      this.updateAlarm(dt);
      this.updateMeteorShower(dt);
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
      this.profile.addCredits(CREDITS.WAVE);
      this.hud.showBanner(`WAVE ${this.wave} CLEARED`, `+${WAVES.WAVE_HEAL} INTEGRITY RESTORED`);
      this.sfx.wave();
      this.waveClearPending = true;
    }

    // WaveDirector advances after the intermission; mirror that here instead of
    // relying on Game.wave, which otherwise stays stale and makes every later
    // wave look (and announce) like "wave 1 complete" forever.
    if (this.waves.wave > waveBefore) {
      this.wave = this.waves.wave;
      this.weapon.addAmmo(WAVES.AMMO_PER_WAVE);
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
    this.knifeView.show(this.state === STATE.PLAYING || this.state === STATE.PAUSED);
    // Same rule for the touch layer: it is the input surface of a live run.
    this.touch.setVisible(this.state === STATE.PLAYING);

    if (this.state === STATE.PLAYING) {
      this.applyCameraPose();
      pitchObj.rotation.x +=
        weapon.recoil +
        (this.feedback.shakeT > 0 ? (this.rng.next() - 0.5) * this.feedback.shakeT * CAMERA.SHAKE_PITCH : 0);
      pitchObj.rotation.y =
        this.feedback.shakeT > 0 ? (this.rng.next() - 0.5) * this.feedback.shakeT * CAMERA.SHAKE_YAW : 0;
      pitchObj.position.y = Math.sin(player.bobPhase * 2) * CAMERA.BOB_Y;

      const dip = weapon.reloading ? Math.sin(weapon.reloadProgress * Math.PI) : 0;
      const strafe = this.touchEnabled
        ? clamp(this.input.strafe + this.touch.move.right, -1, 1)
        : this.input.strafe;
      this.gun.pose(player.bobPhase, weapon.kick, dip, strafe);
      this.gun.decay(dt, weapon.flashT);
      this.knifeView.pose(this.knife.swingT, player.bobPhase, strafe);
    }

    this.arena.camera.getWorldQuaternion(this.camQuat);
    this.arena.update(this.elapsed);
    this.arena.setClock(this.wave, this.waves.intermission, this.aliveCount);
    for (const h of this.hostiles) h.view.sync(this.camQuat);

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

    // Falling stones: a view is created lazily for each new stone and dropped
    // on impact, so the shower never has to know about the scene.
    for (const meteor of this.shower.stones) {
      let view = this.meteorViews.get(meteor);
      if (!view) {
        view = new MeteorView(meteor);
        view.addTo(this.arena.scene);
        this.meteorViews.set(meteor, view);
      }
      view.sync(dt);
    }
    this.arena.setSkyTint(this.shower.tint);

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
    const fovTarget = this.weapon.aiming ? this.baseFov * CAMERA.AIM_FOV_SCALE : this.baseFov;
    if (Math.abs(this.fov - fovTarget) > 0.05) {
      this.fov += (fovTarget - this.fov) * Math.min(1, dt * 9);
      this.arena.camera.fov = this.fov;
      this.arena.camera.updateProjectionMatrix();
    }

    this.arena.render();

    const m = this.model;
    m.hp = this.hp;
    m.maxHp = this.maxHp;
    m.score = this.score;
    m.wave = this.wave;
    m.hostiles = this.waves.hostileCount(this.aliveCount);
    m.state = this.state;
    m.vignetteT = this.feedback.vignetteT;
    m.ammo = weapon.ammo;
    m.reserve = weapon.reserve;
    m.dry = weapon.isDry;
    m.reloading = weapon.reloading;
    m.reloadProgress = weapon.reloadProgress;
    m.bloom = weapon.bloom;
    m.moving = player.moving;
    m.stamina = player.stamina;
    m.bombDist = nearestD;
    m.bombFuse = nearestFuse;
    m.captureProgress = cap.progress;
    m.captureOn = cap.onPad;
    m.level = this.meter.level;
    m.xp = this.meter.xp;
    m.xpNeed = this.meter.need;
    m.credits = this.profile.data.credits;

    if (this.state === STATE.PLAYING || this.state === STATE.PAUSED) {
      this.minimap.draw(px, pz, player.yaw, this.hostiles, this.bombs, this.elapsed, this.mapTowers);
    }
    if (this.mapOpen) {
      this.map.draw(px, pz, player.yaw, this.hostiles, this.bombs, this.elapsed);
    }

    this.hud.setHitmark(this.feedback.hitT);
    this.hud.setVignette(m, this.elapsed);
    this.hud.setADS(this.weapon.aiming);
    if (this.state === STATE.PLAYING) this.hud.update(m, this.settings.values.crosshair);
  }
}

const EMPTY: readonly Enemy[] = [];
