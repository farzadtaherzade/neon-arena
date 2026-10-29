import * as THREE from 'three';
import { ENEMY, ENEMY_LOOKS, ENEMY_TYPES } from '../game/config';
import type { Enemy } from '../game/enemy';
import { GEO, MAT } from './Materials';
import { buildMobRig, type MobRig } from './models/MobModel';

/** The colour the sapper's bomb rack turns just before it plants. */
const TELL_COLOR = new THREE.Color(0xff3b2a);

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
  /** The glow colour this mob normally wears, before a bomb tell tints it. */
  private baseGlow = new THREE.Color();
  /** Last bomb-tell value pushed into the glow colour, to avoid touching it. */
  private lastTell = 0;

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
    this.baseGlow.setHex(look.accent);
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
  sync(cameraQuat: THREE.Quaternion): void {
    const g = this.group;
    const { x, y, z } = this.enemy.pos;

    if (this.enemy.state === 'dying') {
      const k = this.enemy.deathK;
      g.rotation.x = (-k * Math.PI * 2 * ENEMY.DEATH_TILT) / 2;
      g.position.y = y - k * ENEMY.DEATH_SINK;
    } else {
      // The mob turns at a limited rate, so the view reads the heading the
      // simulation actually has — the front plate only covers what it can see.
      g.rotation.y = this.enemy.facingYaw;
      // `pos.y` is the enemy's feet: it rises with a ramp and drops off a ledge.
      g.position.y = y + this.enemy.bounce;

      const swing = this.enemy.legSwing;
      this.rig.legL.rotation.x = swing;
      this.rig.legR.rotation.x = -swing;

      // Arms counter-swing against the legs. The windup raises them before the
      // blow lands — that is the tell — and the attack flash adds a short
      // overhead strike on the hit itself.
      const attack =
        this.enemy.flashT > 0 && this.enemy.flashHex === ENEMY.ATTACK_FLASH_COLOR
          ? Math.sin((1 - this.enemy.flashT / ENEMY.ATTACK_FLASH) * Math.PI) * 0.8
          : 0;
      const raise = this.enemy.swingK * (this.enemy.kind === 'tank' ? 2.2 : 1.6) + attack;
      this.rig.armL.rotation.x = this.rig.armBaseL + swing * this.rig.armSwing - raise;
      this.rig.armR.rotation.x = this.rig.armBaseR - swing * this.rig.armSwing - raise;

      // The runner crouches before it leaps, and leans into the leap itself.
      const crouch = this.enemy.pounceK;
      g.rotation.x = crouch * 0.28 - (this.enemy.pounce > 0 ? 0.3 : 0);
      g.position.y -= crouch * 0.16 * this.enemy.scale;

      // The sapper's bomb rack lights up just before it plants; the warden's
      // racks light up before a volley.
      const tell = this.enemy.kind === 'warden' ? this.enemy.volleyK : this.enemy.bombTell;
      if (tell !== this.lastTell) {
        this.lastTell = tell;
        this.glowMat.color.copy(this.baseGlow).lerp(TELL_COLOR, tell);
      }

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
