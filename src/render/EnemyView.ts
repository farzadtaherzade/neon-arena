import * as THREE from 'three';
import { ENEMY, ENEMY_LOOKS, ENEMY_TYPES, type EnemyKind } from '../game/config';
import type { Enemy } from '../game/enemy';
import { GEO, MAT } from './Materials';

/**
 * The meshes for one enemy: body, head, eyes, legs and a billboarded health bar.
 *
 * Owns its four body/head/accent/leg materials (the hit flash writes `emissive`
 * on them, so they cannot be shared) and disposes exactly those. Geometry, eyes
 * and bar materials are shared and never disposed.
 *
 * Cosmetic silhouettes: each kind mounts one accent prop (a unit box scaled into
 * shape), positioned on the head except the tank's shoulder/back plate.
 */
const ACCENTS: Record<
  EnemyKind,
  { scale: [number, number, number]; pos: [number, number, number]; onBody?: boolean }
> = {
  grunt: { scale: [0.42, 0.08, 0.05], pos: [0, 0.02, 0.21] },
  runner: { scale: [0.06, 0.2, 0.06], pos: [0, 0.26, 0] },
  tank: { scale: [0.72, 0.16, 0.08], pos: [0, -0.08, -0.22], onBody: true },
  sapper: { scale: [0.16, 0.16, 0.16], pos: [0, 0.26, 0] },
};

/**
 * One extra wearable prop per kind, on top of the silhouette accent above.
 * Everything stays a unit box scaled into place: tie, belt, strap, hat. Small
 * enough to read at medium range without becoming clutter.
 */
const EXTRAS: Record<
  EnemyKind,
  Array<{ scale: [number, number, number]; pos: [number, number, number]; onBody?: boolean }>
> = {
  grunt: [
    { scale: [0.08, 0.24, 0.03], pos: [0, 0.2, 0.22], onBody: true },
    { scale: [0.6, 0.08, 0.42], pos: [0, -0.28, 0], onBody: true },
  ],
  runner: [
    { scale: [0.4, 0.06, 0.04], pos: [0, 0.3, 0.22], onBody: true },
    { scale: [0.56, 0.06, 0.4], pos: [0, -0.3, 0], onBody: true },
  ],
  tank: [
    { scale: [0.5, 0.08, 0.06], pos: [0, 0.32, 0.02], onBody: true },
    { scale: [0.66, 0.1, 0.44], pos: [0, -0.3, 0], onBody: true },
  ],
  sapper: [
    { scale: [0.3, 0.08, 0.3], pos: [0, 0.24, 0] },
    { scale: [0.54, 0.08, 0.4], pos: [0, -0.3, 0], onBody: true },
  ],
};

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
    this.mats = [bodyMat, headMat, accentMat, legMat];

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

    // One kind-specific accent prop, added to head/body so the silhouette reads
    // from range. It is never a pick target and gets disposed with the rest.
    const accent = new THREE.Mesh(GEO.accent(), accentMat);
    const A = ACCENTS[enemy.kind] ?? { scale: [0, 0, 0], pos: [0, 0, 0] as [number, number, number] };
    accent.scale.set(...A.scale);
    accent.position.set(...A.pos);
    (A.onBody ? this.body : this.head).add(accent);

    // Wearable extras (tie, cap, belt, strap) share the accent material so they
    // pick up the variant colour. Also cosmetic-only: never pick targets.
    for (const E of EXTRAS[enemy.kind] ?? []) {
      const prop = new THREE.Mesh(GEO.accent(), accentMat);
      prop.scale.set(...E.scale);
      prop.position.set(...E.pos);
      (E.onBody ? this.body : this.head).add(prop);
    }

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
