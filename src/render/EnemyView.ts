import * as THREE from 'three';
import { ENEMY, ENEMY_LOOKS, ENEMY_TYPES } from '../game/config';
import type { Enemy } from '../game/enemy';
import { GEO, MAT } from './Materials';
import { buildMobRig, type MobRig } from './models/MobModel';

/**
 * The meshes for one enemy: a merged low-poly robot rig plus a billboarded
 * health bar.
 *
 * Geometry is process-wide and shared (`models/MobModel.ts` caches one merged
 * buffer set per kind), so spawning forty enemies adds no geometry. The five
 * materials are per-enemy — the hit flash writes `emissive` on four of them and
 * the glow colour follows the cosmetic skin — and are disposed here.
 *
 * `body` and `head` remain the only pick targets and keep the old silhouettes:
 * torso and helmet are exactly the two meshes a shot can hit.
 */
export class EnemyView {
  readonly body: THREE.Mesh;
  readonly head: THREE.Mesh;

  private group = new THREE.Group();
  private rig: MobRig;
  private barGroup = new THREE.Group();
  private barFg: THREE.Mesh;
  private mats: THREE.MeshStandardMaterial[];
  private glowMat: THREE.MeshBasicMaterial;

  constructor(readonly enemy: Enemy) {
    const looks = ENEMY_LOOKS[enemy.kind];
    let look = looks[enemy.look] ?? looks[enemy.look % looks.length];
    if (!look) look = { body: ENEMY_TYPES[enemy.kind].body, accent: 0xffe08a };

    const bodyMat = new THREE.MeshStandardMaterial({ color: look.body, roughness: 0.6, metalness: 0.08 });
    const headMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(look.body).multiplyScalar(1.25),
      roughness: 0.55,
      metalness: 0.08,
    });
    const accentMat = new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.5, metalness: 0.12 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.7, metalness: 0.1 });
    this.glowMat = new THREE.MeshBasicMaterial({ color: look.accent });
    this.mats = [bodyMat, headMat, accentMat, legMat];

    this.rig = buildMobRig(enemy.kind, {
      body: bodyMat,
      head: headMat,
      accent: accentMat,
      limb: legMat,
      glow: this.glowMat,
    });
    this.rig.group.scale.setScalar(enemy.scale);
    this.group.add(this.rig.group);

    this.body = this.rig.body;
    this.head = this.rig.head;
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
    const { x, y, z } = this.enemy.pos;

    if (this.enemy.state === 'dying') {
      const k = this.enemy.deathK;
      g.rotation.x = (-k * Math.PI * 2 * ENEMY.DEATH_TILT) / 2;
      g.position.y = y - k * ENEMY.DEATH_SINK;
    } else {
      g.rotation.x = 0;
      g.rotation.y = this.enemy.facing(playerPos);
      // `pos.y` is the enemy's feet: it rises with a ramp and drops off a ledge.
      g.position.y = y + this.enemy.bounce;

      const swing = this.enemy.legSwing;
      this.rig.legL.rotation.x = swing;
      this.rig.legR.rotation.x = -swing;

      // Arms counter-swing against the legs. The attack flash adds a short
      // overhead strike, so a melee hit has a tell rather than just a red glow.
      const attack =
        this.enemy.flashT > 0 && this.enemy.flashHex === ENEMY.ATTACK_FLASH_COLOR
          ? Math.sin((1 - this.enemy.flashT / ENEMY.ATTACK_FLASH) * Math.PI) * 0.8
          : 0;
      this.rig.armL.rotation.x = this.rig.armBaseL + swing * this.rig.armSwing - attack;
      this.rig.armR.rotation.x = this.rig.armBaseR - swing * this.rig.armSwing - attack;

      const on = this.enemy.flashT > 0;
      for (const m of this.mats) m.emissive.setHex(on ? this.enemy.flashHex : 0x000000);

      this.barGroup.position.set(x, y + 1.98 * this.enemy.scale, z);
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
    this.glowMat.dispose();
  }
}
