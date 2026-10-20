import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { CAMERA, WEAPON } from '../game/config';
import { MAT } from './Materials';

/**
 * First-person weapon viewmodel, parented to the camera.
 *
 * A bullpup energy rifle: chunky receiver, railed top with a compact optic,
 * a vented handguard, an angled magazine, a muzzle brake and a live cyan
 * energy line down the side. Holds the anchors the weapon needs: an
 * `Object3D` marking the muzzle (tracer origin) and an additive flash with a
 * short-lived light.
 */
export class GunView {
  readonly group = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  readonly flash = new THREE.Group();
  readonly flashLight = new THREE.PointLight(0xffa040, 0, 11, 2);

  constructor() {
    const metal = MAT.gunMetal();
    const dark = MAT.gunDark();

    const part = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      rx = 0,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      return m;
    };

    // Receiver and its furniture.
    this.group.add(
      part(new THREE.BoxGeometry(0.115, 0.155, 0.44), metal, 0, 0, -0.02),
      part(new THREE.BoxGeometry(0.128, 0.055, 0.3), dark, 0, 0.075, -0.03),
      part(new THREE.BoxGeometry(0.075, 0.028, 0.36), dark, 0, 0.112, -0.08),
      part(new THREE.BoxGeometry(0.1, 0.03, 0.16), dark, 0, -0.085, 0.02),
    );

    // Optic: a short tube on the rail with a hot magenta lens.
    this.group.add(
      part(new THREE.BoxGeometry(0.052, 0.05, 0.13), metal, 0, 0.15, -0.09),
      part(new THREE.BoxGeometry(0.036, 0.036, 0.012), MAT.magenta(), 0, 0.15, -0.155),
      part(new THREE.BoxGeometry(0.024, 0.03, 0.03), dark, 0, 0.125, -0.03),
    );

    // Handguard with three lit vents, then the barrel and its brake.
    this.group.add(
      part(new THREE.BoxGeometry(0.088, 0.08, 0.26), metal, 0, 0.012, -0.3),
      part(new THREE.BoxGeometry(0.046, 0.046, 0.36), dark, 0, 0.016, -0.38),
      part(new THREE.BoxGeometry(0.078, 0.078, 0.12), metal, 0, 0.016, -0.57),
      part(new THREE.BoxGeometry(0.03, 0.09, 0.03), dark, 0, 0.016, -0.57),
    );
    for (let i = 0; i < 3; i++) {
      this.group.add(part(new THREE.BoxGeometry(0.094, 0.012, 0.05), MAT.glow(), 0, 0.03, -0.24 - i * 0.07));
    }
    // Brake vents and the muzzle ring.
    for (let i = 0; i < 3; i++) {
      this.group.add(part(new THREE.BoxGeometry(0.084, 0.014, 0.02), dark, 0, 0.016, -0.545 - i * 0.03));
    }
    this.group.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.012), MAT.glow(), 0, 0.016, -0.632));

    // Grip, magazine, stock and the trigger group.
    this.group.add(
      part(new THREE.BoxGeometry(0.09, 0.2, 0.115), dark, 0, -0.145, 0.16, 0.35),
      part(new THREE.BoxGeometry(0.078, 0.23, 0.1), dark, 0, -0.17, 0.05, 0.2),
      part(new THREE.BoxGeometry(0.086, 0.11, 0.2), metal, 0, -0.03, 0.25),
      part(new THREE.BoxGeometry(0.07, 0.05, 0.14), dark, 0, 0.05, 0.25),
      part(new THREE.BoxGeometry(0.03, 0.06, 0.02), metal, 0, -0.075, 0.09),
      part(new THREE.BoxGeometry(0.05, 0.025, 0.1), metal, 0.075, 0.045, 0.1),
    );
    // Energy line along the receiver and an amber magazine band.
    this.group.add(
      part(new THREE.BoxGeometry(0.006, 0.02, 0.26), MAT.glow(), 0.06, 0.005, -0.04),
      part(new THREE.BoxGeometry(0.082, 0.022, 0.105), MAT.hazard(), 0, -0.1, 0.03),
    );

    this.muzzle.position.set(0, 0.016, -0.64);
    this.group.add(this.muzzle);

    const a = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), MAT.muzzleFlash());
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), MAT.muzzleFlash());
    b.rotation.x = Math.PI / 2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 10, 1, true), MAT.muzzleFlash());
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = -0.14;
    this.flash.add(a, b, cone);
    this.flash.position.copy(this.muzzle.position);
    this.flash.visible = false;
    this.group.add(this.flash);

    this.flashLight.position.copy(this.muzzle.position);
    this.group.add(this.flashLight);

    const [rx, ry, rz] = WEAPON.GUN_REST;
    this.group.position.set(rx, ry, rz);
    this.group.visible = false;
  }

  show(on: boolean): void {
    this.group.visible = on;
  }

  reset(): void {
    this.flash.visible = false;
    this.flashLight.intensity = 0;
  }

  fire(rng: Rng): void {
    this.flash.visible = true;
    this.flash.rotation.z = rng.next() * Math.PI;
    this.flash.scale.setScalar(0.8 + rng.next() * 0.7);
    this.flashLight.intensity = WEAPON.FLASH_LIGHT_PEAK;
  }

  /** Advance bob, reload dip, recoil kick and strafe sway. */
  pose(bobPhase: number, kick: number, reloadDip: number, strafe: number): void {
    const [restX, restY, restZ] = WEAPON.GUN_REST;
    this.group.position.set(
      restX + Math.sin(bobPhase) * CAMERA.BOB_X,
      restY + Math.sin(bobPhase * 2) * CAMERA.BOB_GUN_Y - reloadDip * CAMERA.BOB_GUN_DIP,
      restZ + kick,
    );
    this.group.rotation.x = kick * CAMERA.KICK_PITCH + reloadDip * CAMERA.RELOAD_DIP;
    this.group.rotation.z = -strafe * CAMERA.GUN_SWAY_Z;
  }

  /** The flash quad lasts `flashT`; the light bleeds out exponentially under it. */
  decay(dt: number, flashT: number): void {
    this.flashLight.intensity *= Math.exp(-WEAPON.FLASH_LIGHT_DECAY * dt);
    this.flash.visible = flashT > 0;
  }
}
