import THREE from './three.js';
import { ENEMY, ENEMY_TYPES } from './config.js';
import { GEO, MAT } from './materials.js';

/**
 * A single hostile robot: mesh, AI, health, and the death animation.
 *
 * Owns its body/head/leg materials (they carry the hit-flash emissive, so they
 * cannot be shared) and disposes exactly those on `dispose()`. Geometry,
 * eyes, and health-bar materials come from materials.js and are never disposed.
 */
export class Enemy {
  constructor(type, spawnX, spawnZ) {
    const spec = ENEMY_TYPES[type];
    this.type = type;
    this.scale = spec.scale;
    this.maxHp = spec.hp;
    this.hp = spec.hp;
    this.speed = spec.speed;
    this.dmg = spec.dmg;
    this.score = spec.score;

    this.state = 'alive';
    this.vx = 0;
    this.vz = 0;
    this.cool = 0.5 + Math.random() * 0.5;
    this.phase = Math.random() * 6;
    this.flashT = 0;
    this.flashHex = 0xffffff;
    this.deathT = 0;
    this.remove = false;

    const group = new THREE.Group();
    this.bodyMat = new THREE.MeshStandardMaterial({ color: spec.body, roughness: 0.6, metalness: 0.08 });
    this.headMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.body).multiplyScalar(1.25), roughness: 0.55, metalness: 0.08,
    });
    this.legMat = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.7, metalness: 0.1 });
    this.mats = [this.bodyMat, this.headMat, this.legMat];

    this.body = new THREE.Mesh(GEO.body(), this.bodyMat);
    this.body.position.y = 0.85;
    this.body.castShadow = true;

    this.head = new THREE.Mesh(GEO.head(), this.headMat);
    this.head.position.y = 1.52;
    this.head.castShadow = true;

    const eyeMat = MAT.eye();
    const eyeL = new THREE.Mesh(GEO.eye(), eyeMat);
    eyeL.position.set(-0.1, 1.55, 0.21);
    const eyeR = new THREE.Mesh(GEO.eye(), eyeMat);
    eyeR.position.set(0.1, 1.55, 0.21);

    this.legL = new THREE.Group();
    this.legL.position.set(-0.17, 0.55, 0);
    this.legR = new THREE.Group();
    this.legR.position.set(0.17, 0.55, 0);
    const lmL = new THREE.Mesh(GEO.leg(), this.legMat);
    lmL.position.y = -0.25;
    lmL.castShadow = true;
    const lmR = new THREE.Mesh(GEO.leg(), this.legMat);
    lmR.position.y = -0.25;
    lmR.castShadow = true;
    this.legL.add(lmL);
    this.legR.add(lmR);

    group.add(this.body, this.head, eyeL, eyeR, this.legL, this.legR);
    group.position.set(spawnX, 0, spawnZ);
    group.scale.setScalar(this.scale);
    this.group = group;

    this.body.userData = { enemy: this, part: 'body' };
    this.head.userData = { enemy: this, part: 'head' };

    const barGroup = new THREE.Group();
    const barBg = new THREE.Mesh(GEO.barBg(), MAT.barBg());
    this.barFg = new THREE.Mesh(GEO.barFg(), MAT.barFg());
    this.barFg.position.z = 0.015;
    barGroup.add(barBg, this.barFg);
    barGroup.visible = false;
    this.barGroup = barGroup;
    this._barQuat = new THREE.Quaternion();
  }

  addTo(scene) {
    scene.add(this.group);
    scene.add(this.barGroup);
  }

  /** Meshes the weapon raycasts against. */
  get targets() {
    return [this.body, this.head];
  }

  flash(hex, duration) {
    this.flashHex = hex;
    this.flashT = Math.max(this.flashT, duration);
  }

  /** Advance AI or death animation. `game` supplies the player, world, fx and audio. */
  update(dt, game) {
    if (this.state === 'dying') {
      this.updateDeath(dt, game);
      return;
    }

    const target = game.player.position;
    const g = this.group;
    const dx = target.x - g.position.x;
    const dz = target.z - g.position.z;
    const dist = Math.hypot(dx, dz);
    const range = ENEMY.REACH_PAD * this.scale + 0.55;
    this.cool -= dt;

    if (dist > range) {
      this.chase(dt, dx, dz, dist, game);
    } else {
      this.attack(dt, game);
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      const on = this.flashT > 0;
      for (const m of this.mats) m.emissive.setHex(on ? this.flashHex : 0x000000);
    }

    g.rotation.y = Math.atan2(dx, dz);
    g.position.y = Math.abs(Math.sin(this.phase)) * ENEMY.BOUNCE;
    this.legL.rotation.x = Math.sin(this.phase) * ENEMY.LEG_SWING;
    this.legR.rotation.x = -Math.sin(this.phase) * ENEMY.LEG_SWING;

    game.collision.resolveCircle(g.position, ENEMY.COLLIDE_RADIUS * this.scale);
    this.updateHealthBar(game);
  }

  chase(dt, dx, dz, dist, game) {
    const g = this.group;
    let mx = dx / (dist || 1);
    let mz = dz / (dist || 1);

    // Separation so a crowd fans out instead of stacking into one silhouette.
    let sx = 0, sz = 0;
    for (const other of game.waves.enemies) {
      if (other === this || other.state !== 'alive') continue;
      const ox = g.position.x - other.group.position.x;
      const oz = g.position.z - other.group.position.z;
      const od = Math.hypot(ox, oz);
      const minD = ENEMY.SEPARATION * (this.scale + other.scale) / 2 + ENEMY.SEPARATION_PAD;
      if (od > 0.001 && od < minD) {
        sx += ox / od * (minD - od);
        sz += oz / od * (minD - od);
      }
    }

    const k = 1 - Math.exp(-ENEMY.MOVE_DAMP * dt);
    const targetVx = (mx + sx * ENEMY.SEPARATION_FORCE) * this.speed;
    const targetVz = (mz + sz * ENEMY.SEPARATION_FORCE) * this.speed;
    this.vx += (targetVx - this.vx) * k;
    this.vz += (targetVz - this.vz) * k;
    g.position.x += this.vx * dt;
    g.position.z += this.vz * dt;
    this.phase += dt * (3 + this.speed * 1.6);
  }

  attack(dt, game) {
    this.vx *= ENEMY.ARRIVE_DAMP;
    this.vz *= ENEMY.ARRIVE_DAMP;
    if (this.cool <= 0) {
      this.cool = ENEMY.ATTACK_COOLDOWN;
      this.flash(ENEMY.ATTACK_FLASH_COLOR, ENEMY.ATTACK_FLASH);
      game.damagePlayer(this.dmg);
    }
  }

  updateHealthBar(game) {
    const g = this.group;
    this.barGroup.position.set(g.position.x, 1.98 * this.scale, g.position.z);
    this.barGroup.quaternion.copy(game.camera.getWorldQuaternion(this._barQuat));
    const frac = Math.max(this.hp / this.maxHp, 0);
    this.barGroup.visible = frac < 1;
    this.barFg.scale.x = Math.max(frac, 0.001);
    this.barFg.position.x = -(1 - frac) * 0.43;
  }

  /** Apply damage. Returns true if this shot killed it. */
  takeDamage(amount) {
    if (this.state !== 'alive') return false;
    this.hp -= amount;
    this.flash(ENEMY.HIT_FLASH_COLOR, ENEMY.HIT_FLASH);
    return this.hp <= 0;
  }

  /** Shove along the shot direction so hits read as impacts, not just a number. */
  knockback(direction) {
    this.group.position.addScaledVector(direction, ENEMY.KNOCKBACK);
  }

  /** Begin the death animation and award the kill. */
  kill(headshot, game) {
    if (this.state !== 'alive') return;
    this.state = 'dying';
    this.deathT = 0;
    game.scene.remove(this.barGroup);
    game.waves.releaseTargets(this);

    this.group.updateWorldMatrix(true, false);
    this.group.getWorldPosition(game.scratch);
    game.scratch.y += 0.9 * this.scale;
    game.fx.particles.burst(game.scratch, 0xff4455, 26, 5, 0.7);
    game.fx.particles.burst(game.scratch, 0xff8866, 10, 3, 0.5);

    game.score += this.score + (headshot ? 25 : 0);
    game.kills++;
    game.feedback.hitT = 1;
    game.hud.markKill();
    game.sfx.kill();
  }

  updateDeath(dt, game) {
    this.deathT += dt;
    const k = Math.min(this.deathT / ENEMY.DEATH_TIME, 1);
    this.group.rotation.x = -k * Math.PI / 2 * ENEMY.DEATH_TILT;
    this.group.position.y = -k * ENEMY.DEATH_SINK;
    if (k >= 1) {
      game.scene.remove(this.group);
      this.dispose();
      this.remove = true;
    }
  }

  dispose() {
    for (const m of this.mats) m.dispose();
  }
}