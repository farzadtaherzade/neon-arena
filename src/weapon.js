import THREE from './three.js';
import { CAMERA, WEAPON } from './config.js';

/**
 * Hitscan rifle: ammo, reload, and the recoil/bloom/muzzle-flash state that
 * drives both the viewmodel pose and the crosshair.
 *
 * Owns its presentation state so `player` never needs to know about recoil and
 * `hud` never needs to know about the magazine.
 */
export class Weapon {
  constructor(game, view) {
    this.game = game;
    this.view = view;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this._end = new THREE.Vector3();
    this.ammo = WEAPON.MAG;
    this.reloading = false;
    this.reloadT = 0;
    this.lastShot = -9;
    this.recoil = 0;
    this.kick = 0;
    this.bloom = 0;
    this.flashT = 0;
  }

  reset() {
    this.ammo = WEAPON.MAG;
    this.reloading = false;
    this.reloadT = 0;
    this.lastShot = -9;
    this.recoil = 0;
    this.kick = 0;
    this.bloom = 0;
    this.flashT = 0;
    this.view.flash.visible = false;
    this.view.flashLight.intensity = 0;
  }

  startReload() {
    if (this.reloading || this.ammo === WEAPON.MAG || this.game.state !== 'playing') return;
    this.reloading = true;
    this.reloadT = 0;
    this.game.sfx.reloadStart();
  }

  get spread() {
    return WEAPON.BASE_SPREAD + this.bloom;
  }

  /** Reload progress 0..1, for the HUD bar. */
  get reloadProgress() {
    return Math.min(this.reloadT / WEAPON.RELOAD_T, 1);
  }

  update(dt, elapsed, input) {
    this.tickReload(dt);
    if (input.firing && !this.reloading && elapsed - this.lastShot >= WEAPON.FIRE_T) {
      if (this.ammo > 0) this.shoot(elapsed);
      else {
        this.game.sfx.empty();
        this.startReload();
        this.lastShot = elapsed;
      }
    }
    this.decay(dt);
    this.pose(input);
  }

  tickReload(dt) {
    if (!this.reloading) return;
    this.reloadT += dt;
    if (this.reloadT >= WEAPON.RELOAD_T) {
      this.reloading = false;
      this.ammo = WEAPON.MAG;
      this.game.sfx.reloadEnd();
    }
  }

  decay(dt) {
    this.recoil *= Math.exp(-WEAPON.RECOIL_DECAY * dt);
    this.kick *= Math.exp(-WEAPON.KICK_DECAY * dt);
    this.bloom *= Math.exp(-WEAPON.BLOOM_DECAY * dt);

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.view.flash.visible = false;
    }
    this.view.flashLight.intensity *= Math.exp(-WEAPON.FLASH_LIGHT_DECAY * dt);
  }

  /** Animate the viewmodel: bob, reload dip, recoil kick, strafe sway. */
  pose(input) {
    const player = this.game.player;
    const [restX, restY, restZ] = WEAPON.GUN_REST;

    const dip = this.reloading ? Math.sin(this.reloadProgress * Math.PI) : 0;
    this.view.group.position.set(
      restX + Math.sin(player.bobPhase) * CAMERA.BOB_X,
      restY + Math.sin(player.bobPhase * 2) * CAMERA.BOB_GUN_Y - dip * CAMERA.BOB_GUN_DIP,
      restZ + this.kick
    );
    this.view.group.rotation.x = this.kick * CAMERA.KICK_PITCH + dip * CAMERA.RELOAD_DIP;
    this.view.group.rotation.z = -((input.keys.KeyD ? 1 : 0) - (input.keys.KeyA ? 1 : 0)) * CAMERA.GUN_SWAY_Z;
  }

  /** One bullet: roll spread, resolve the nearest hit, then flash and recoil. */
  shoot(elapsed) {
    const game = this.game;
    this.ammo--;
    this.lastShot = elapsed;

    const spread = this.spread;
    this.ndc.set((Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread);
    this.ray.setFromCamera(this.ndc, game.camera);

    const hits = this.ray.intersectObjects(game.waves.targets, false);
    const wallHits = this.ray.intersectObjects(game.collision.solids, false);

    let enemyHit = null;
    let wallHit = null;
    if (hits.length && (!wallHits.length || hits[0].distance <= wallHits[0].distance)) {
      enemyHit = hits[0];
      wallHit = wallHits.find(h => h.distance < enemyHit.distance) || null;
    } else if (wallHits.length) {
      wallHit = wallHits[0];
    }

    this.view.muzzle.updateWorldMatrix(true, false);
    this.view.muzzle.getWorldPosition(game.scratch);

    const end = this.resolveHit(enemyHit, wallHit, game);
    game.fx.tracers.fire(game.scratch, end);

    this.recoil = Math.min(this.recoil + WEAPON.RECOIL_PER_SHOT, WEAPON.RECOIL_MAX);
    this.kick = Math.min(this.kick + WEAPON.KICK_PER_SHOT, WEAPON.KICK_MAX);
    this.bloom = Math.min(this.bloom + WEAPON.BLOOM_PER_SHOT, WEAPON.BLOOM_MAX);

    this.view.flash.visible = true;
    this.view.flash.rotation.z = Math.random() * Math.PI;
    this.view.flash.scale.setScalar(0.8 + Math.random() * 0.7);
    this.flashT = WEAPON.FLASH_T;
    this.view.flashLight.intensity = WEAPON.FLASH_LIGHT_PEAK;

    game.sfx.shoot();
    if (this.ammo <= 0) this.startReload();
  }

  /** Damage an enemy or spark off a wall; returns where the tracer should stop. */
  resolveHit(enemyHit, wallHit, game) {
    if (enemyHit) {
      const enemy = enemyHit.object.userData.enemy;
      const headshot = enemyHit.object.userData.part === 'head';
      const damage = WEAPON.DMG * (headshot ? WEAPON.HEAD_MULT : 1);

      game.fx.particles.burst(enemyHit.point, 0xff4455, 10, 3.5, 0.5);
      game.feedback.hitT = 1;
      game.sfx.hit();

      if (enemy.takeDamage(damage)) enemy.kill(headshot, game);
      else enemy.knockback(this.ray.ray.direction);

      return enemyHit.point;
    }

    if (wallHit) {
      game.fx.particles.burst(wallHit.point, 0xffc266, 8, 3, 0.4);
      return wallHit.point;
    }

    return this._end.copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, WEAPON.MAX_RANGE);
  }
}