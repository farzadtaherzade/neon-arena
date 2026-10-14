import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { CAMERA, WEAPON } from '../game/config';
import { MAT } from './Materials';

/**
 * First-person weapon viewmodel, parented to the camera.
 *
 * Holds the anchors the weapon needs: an `Object3D` marking the muzzle (tracer
 * origin) and an additive flash pair with a short-lived light.
 */
export class GunView {
  readonly group = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  readonly flash = new THREE.Group();
  readonly flashLight = new THREE.PointLight(0xffa040, 0, 11, 2);

  constructor() {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.44), MAT.gunMetal());
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.34), MAT.gunDark());
    barrel.position.set(0, 0.02, -0.36);
    const brake = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), MAT.gunMetal());
    brake.position.set(0, 0.02, -0.52);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.2, 0.11), MAT.gunDark());
    grip.position.set(0, -0.15, 0.12);
    grip.rotation.x = 0.35;
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.12), MAT.gunDark());
    sight.position.set(0, 0.1, -0.05);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.02, 0.3), MAT.glow());
    strip.position.set(0, -0.03, -0.05);
    this.group.add(body, barrel, brake, grip, sight, strip);

    this.muzzle.position.set(0, 0.02, -0.58);
    this.group.add(this.muzzle);

    const a = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), MAT.muzzleFlash());
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), MAT.muzzleFlash());
    b.rotation.x = Math.PI / 2;
    this.flash.add(a, b);
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
