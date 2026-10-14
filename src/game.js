import THREE from './three.js';

import { CAMERA, FEEDBACK, SCREEN, STATE, START_HP } from './config.js';
import { CollisionWorld } from './collision.js';
import { buildArena } from './arena.js';
import { buildGun } from './gunmodel.js';
import { Fx } from './fx.js';
import { Sfx } from './audio.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Settings } from './settings.js';
import { Player } from './player.js';
import { WaveDirector } from './waves.js';
import { Weapon } from './weapon.js';

/**
 * Owns the renderer, the simulation state, and the subsystem wiring.
 *
 * Subsystems receive this instance as their context rather than importing each
 * other, so `update()` below is the single place where cross-system behaviour
 * and ordering are decided.
 */
export class Game {
  constructor(test = false) {
    this.test = test;
    this.state = STATE.MENU;
    this.hp = START_HP;
    this.score = 0;
    this.kills = 0;
    this.wave = 0;

    // Decay timers for the hitmarker, damage vignette and screen shake.
    this.feedback = { hitT: 0, vignetteT: 0, shakeT: 0 };

    // Reusable scratch vector — never hold on to it past a single call.
    this.scratch = new THREE.Vector3();

    this.createRenderer();
    this.createScene();

    this.collision = new CollisionWorld();
    buildArena(this.scene, this.collision);

    this.camera = new THREE.PerspectiveCamera(CAMERA.FOV, innerWidth / innerHeight, CAMERA.NEAR, CAMERA.FAR);
    this.yawObj = new THREE.Group();
    this.pitchObj = new THREE.Group();
    this.yawObj.add(this.pitchObj);
    this.pitchObj.add(this.camera);
    this.scene.add(this.yawObj);

    this.fx = new Fx(this.scene);
    this.sfx = new Sfx();
    this.hud = new Hud();
    this.settings = new Settings(this);

    this.player = new Player(this.yawObj, this.pitchObj);
    this.gun = buildGun();
    this.camera.add(this.gun.group);

    this.waves = new WaveDirector(this);
    this.weapon = new Weapon(this, this.gun);
    this.input = new Input(this, {
      onJump: () => this.player.queueJump(),
      onReload: () => this.weapon.startReload(),
      onLook: (dx, dy) => this.player.look(dx, dy),
      onLockRequest: () => this.input.lock(),
      onLockChange: locked => this.onLockChange(locked),
      onResume: () => this.input.lock(),
      onToggleSettings: () => this.settings.toggle(),
      onCloseSettings: () => this.settings.close(),
    });

    this.hud.screens.start.addEventListener('click', () => this.start(false));
    this.hud.screens.gameover.addEventListener('click', () => this.start(false));

    addEventListener('resize', () => this.resize());
  }

  createRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    document.body.appendChild(renderer.domElement);
    this.renderer = renderer;
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070c);
    this.scene.fog = new THREE.Fog(0x05070c, 30, 110);

    this.scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x2a3242, 1.5));
    this.scene.add(new THREE.AmbientLight(0x404a60, 0.6));

    const sun = new THREE.DirectionalLight(0xffe0b3, 2.4);
    sun.position.set(25, 42, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -38;
    sun.shadow.camera.right = 38;
    sun.shadow.camera.top = 38;
    sun.shadow.camera.bottom = -38;
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 110;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  // ---------------------------------------------------------------- lifecycle

  start(skipLock = false) {
    this.sfx.init();
    this.reset();
    this.waves.start(1);
    this.gun.group.visible = true;
    this.hud.setVisible(true);
    this.state = STATE.PLAYING;

    if (this.test) this.hud.hideAllScreens();
    else this.hud.showScreen(SCREEN.NONE);

    if (!skipLock) this.input.lock();
  }

  reset() {
    this.waves.reset();
    this.fx.clear();
    this.weapon.reset();
    this.player.reset();

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

  gameOver() {
    this.state = STATE.GAMEOVER;
    this.input.firing = false;
    this.gun.group.visible = false;
    this.hud.setVisible(false);
    this.input.release();
    this.hud.setFinalStats({ score: this.score, wave: this.wave, kills: this.kills });
    if (!this.test) this.hud.showScreen(SCREEN.GAMEOVER);
    this.sfx.kill();
  }

  damagePlayer(amount) {
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

  onLockChange(locked) {
    if (!locked && this.state === STATE.PLAYING) {
      this.state = STATE.PAUSED;
      this.input.firing = false;
      if (!this.test) this.hud.showScreen(SCREEN.PAUSE);
    } else if (locked && this.state === STATE.PAUSED) {
      this.state = STATE.PLAYING;
      if (!this.test) this.hud.showScreen(SCREEN.NONE);
    }
  }

  // ------------------------------------------------------------------- update

  update(dt, elapsed) {
    if (this.state === STATE.PLAYING) {
      this.player.update(dt, this.input, this.collision);
      this.player.advanceBob(dt);
      this.weapon.update(dt, elapsed, this.input);
      this.waves.update(dt, this);

      // Only the playing state drives the rig — the menu orbits it, and a
      // paused game must freeze the view exactly where it was.
      this.player.applyRig(this.weapon.recoil, this.feedback.shakeT);
    } else if (this.state === STATE.MENU) {
      this.player.menuIdle(elapsed);
      this.gun.group.visible = false;
    }

    this.decayFeedback(dt);
    this.fx.update(dt);

    this.hud.setHitmark(this.feedback.hitT);
    this.hud.setVignette(this.hud.computeVignette(this, elapsed));
    if (this.state === STATE.PLAYING) this.hud.update(this, this.weapon);
  }

  decayFeedback(dt) {
    const f = this.feedback;
    if (f.hitT > 0) f.hitT -= dt * FEEDBACK.HITMARK_DECAY;
    if (f.vignetteT > 0) f.vignetteT = Math.max(0, f.vignetteT - dt * FEEDBACK.VIGNETTE_DECAY);
    f.shakeT *= Math.exp(-CAMERA.SHAKE_DECAY * dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}