import * as THREE from 'three';
import { ENEMY, ENEMY_TYPES } from '../game/config';
import type { Enemy } from '../game/enemy';
import { GEO, MAT } from './Materials';

/**
 * The meshes for one enemy: body, head, eyes, legs and a billboarded health bar.
 *
 * Owns its three body/head/leg materials (the hit flash writes `emissive` on
 * them, so they cannot be shared) and disposes exactly those. Geometry, eyes and
 * bar materials are shared and never disposed.
 */
export class EnemyView {
  readonly body: THREE.Mesh;
  readonly head: THREE.Mesh;

  private group = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private barGroup = new THREE.Group();
  private barFg: THREE.Mesh;
  private mats: THREE.MeshStandardMaterial[];

  constructor(readonly enemy: Enemy) {
    const spec = ENEMY_TYPES[enemy.kind];

    const bodyMat = new THREE.MeshStandardMaterial({ color: spec.body, roughness: 0.6, metalness: 0.08 });
    const headMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.body).multiplyScalar(1.25),
      roughness: 0.55,
      metalness: 0.08,
    });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.7, metalness: 0.1 });
    this.mats = [bodyMat, headMat, legMat];

    this.body = new THREE.Mesh(GEO.body(), bodyMat);
    this.body.position.y = 0.85;
    this.body.castShadow = true;

    this.head = new THREE.Mesh(GEO.head(), headMat);
    this.head.position.y = 1.52;
    this.head.castShadow = true;

    const eyeL = new THREE.Mesh(GEO.eye(), MAT.eye());
    eyeL.position.set(-0.1, 1.55, 0.21);
    const eyeR = new THREE.Mesh(GEO.eye(), MAT.eye());
    eyeR.position.set(0.1, 1.55, 0.21);

    this.legL.position.set(-0.17, 0.55, 0);
    this.legR.position.set(0.17, 0.55, 0);
    for (const leg of [this.legL, this.legR]) {
      const m = new THREE.Mesh(GEO.leg(), legMat);
      m.position.y = -0.25;
      m.castShadow = true;
      leg.add(m);
    }

    this.group.add(this.body, this.head, eyeL, eyeR, this.legL, this.legR);
    this.group.scale.setScalar(enemy.scale);

    this.body.userData = { enemy, part: 'body' };
    this.head.userData = { enemy, part: 'head' };

    this.barGroup.add(new THREE.Mesh(GEO.barBg(), MAT.barBg()));
    this.barFg = new THREE.Mesh(GEO.barFg(), MAT.barFg());
    this.barFg.position.z = 0.015;
    this.barGroup.add(this.barFg);
    this.barGroup.visible = false;
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.group);
    scene.add(this.barGroup);
  }

  /** Pull the pure enemy's state onto the meshes. Called once per rendered frame. */
  sync(playerPos: { x: number; z: number }, cameraQuat: THREE.Quaternion): void {
    const g = this.group;
    const { x, z } = this.enemy.pos;

    if (this.enemy.state === 'dying') {
      const k = this.enemy.deathK;
      g.rotation.x = (-k * Math.PI * 2 * ENEMY.DEATH_TILT) / 2;
      g.position.y = -k * ENEMY.DEATH_SINK;
    } else {
      g.rotation.x = 0;
      g.rotation.y = this.enemy.facing(playerPos);
      g.position.y = this.enemy.bounce;
      this.legL.rotation.x = this.enemy.legSwing;
      this.legR.rotation.x = -this.enemy.legSwing;

      const on = this.enemy.flashT > 0;
      for (const m of this.mats) m.emissive.setHex(on ? this.enemy.flashHex : 0x000000);

      this.barGroup.position.set(x, 1.98 * this.enemy.scale, z);
      this.barGroup.quaternion.copy(cameraQuat);
      const frac = Math.max(this.enemy.hp / this.enemy.stats.maxHp, 0);
      this.barGroup.visible = frac < 1;
      this.barFg.scale.x = Math.max(frac, 0.001);
      this.barFg.position.x = -(1 - frac) * 0.43;
    }

    g.position.x = x;
    g.position.z = z;
  }

  /** Drop the colliders out of the raycast list once the enemy starts dying. */
  removeTargets(pick: { remove(mesh: THREE.Object3D): void }): void {
    this.barGroup.visible = false;
    pick.remove(this.body);
    pick.remove(this.head);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    scene.remove(this.barGroup);
    for (const m of this.mats) m.dispose();
  }
}
