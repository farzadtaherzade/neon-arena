import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { CAMERA, STANDARD_SKIN, WEAPON } from '../game/config';
import { MAT } from './Materials';

/**
 * Viewmodels for the arsenal beyond the rifle: the SMG, the scattergun and the
 * DMR. Same deal as `Gun.ts`: each builds its own materials (a shared material
 * cannot be recoloured per skin later), holds a muzzle anchor and an additive
 * flash, and is parented to the camera. They read the same pose inputs as the
 * rifle viewmodel, so `Game` drives all of them identically and shows one.
 */

/** The four colour slots every viewmodel wears — the standard issue palette. */
interface Slots {
  readonly metal: THREE.MeshStandardMaterial;
  readonly dark: THREE.MeshStandardMaterial;
  readonly glow: THREE.MeshBasicMaterial;
  readonly hazard: THREE.MeshBasicMaterial;
}

function makeSlots(): Slots {
  return {
    metal: new THREE.MeshStandardMaterial({ color: STANDARD_SKIN.metal, roughness: 0.45, metalness: 0.2 }),
    dark: new THREE.MeshStandardMaterial({ color: STANDARD_SKIN.dark, roughness: 0.6, metalness: 0.15 }),
    glow: new THREE.MeshBasicMaterial({ color: STANDARD_SKIN.glow }),
    hazard: new THREE.MeshBasicMaterial({ color: STANDARD_SKIN.hazard }),
  };
}

abstract class ViewModel {
  readonly group = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  readonly flash = new THREE.Group();
  readonly flashLight = new THREE.PointLight(0xffa040, 0, 11, 2);

  protected readonly slots = makeSlots();

  constructor(
    /** Where the model sits at rest, and where the muzzle pokes out. */
    protected readonly rest: readonly [number, number, number],
    protected readonly muzzleZ: number,
  ) {
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
    this.build(part);

    this.muzzle.position.set(0, 0.016, this.muzzleZ);
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

    const [rx, ry, rz] = this.rest;
    this.group.position.set(rx, ry, rz);
    this.group.visible = false;
  }

  protected abstract build(
    part: (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      rx?: number,
    ) => THREE.Mesh,
  ): void;

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
    const [restX, restY, restZ] = this.rest;
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

/** The SMG: a stubby boxy thing with a big straight mag and a suppressor. */
export class SmgView extends ViewModel {
  constructor() {
    super([0.26, -0.235, -0.44], -0.52);
  }

  protected build(part: ViewModelBuild): void {
    const { metal, dark, glow } = this.slots;
    // Receiver, top rail and the chunky charging handle.
    this.group.add(
      part(new THREE.BoxGeometry(0.1, 0.14, 0.34), metal, 0, 0, -0.02),
      part(new THREE.BoxGeometry(0.112, 0.04, 0.24), dark, 0, 0.088, -0.04),
      part(new THREE.BoxGeometry(0.03, 0.03, 0.05), dark, 0.066, 0.06, 0.02),
    );
    // Suppressor and its heat rings.
    this.group.add(
      part(new THREE.BoxGeometry(0.062, 0.062, 0.2), dark, 0, 0.012, -0.28),
      part(new THREE.BoxGeometry(0.07, 0.07, 0.02), metal, 0, 0.012, -0.36),
      part(new THREE.BoxGeometry(0.07, 0.07, 0.02), metal, 0, 0.012, -0.42),
    );
    // The long straight magazine is the SMG's silhouette.
    this.group.add(
      part(new THREE.BoxGeometry(0.06, 0.26, 0.085), dark, 0, -0.19, 0.02, 0.12),
      part(new THREE.BoxGeometry(0.064, 0.02, 0.09), glow, 0, -0.24, 0.02, 0.12),
    );
    // Grip, stock skeleton and trigger.
    this.group.add(
      part(new THREE.BoxGeometry(0.075, 0.16, 0.09), dark, 0, -0.12, 0.14, 0.3),
      part(new THREE.BoxGeometry(0.02, 0.09, 0.16), metal, 0, -0.02, 0.24),
      part(new THREE.BoxGeometry(0.02, 0.05, 0.1), metal, 0.045, 0.06, 0.24),
      part(new THREE.BoxGeometry(0.026, 0.05, 0.016), metal, 0, -0.065, 0.07),
    );
    // The lit cocking slot along the side.
    this.group.add(part(new THREE.BoxGeometry(0.005, 0.016, 0.2), glow, 0.052, 0.02, -0.02));
  }
}

/** The scattergun: a wide-bore pump gun with a heat shield and shell carrier. */
export class ScatterView extends ViewModel {
  constructor() {
    super([0.29, -0.25, -0.5], -0.68);
  }

  protected build(part: ViewModelBuild): void {
    const { metal, dark, glow, hazard } = this.slots;
    // Fat receiver and the twin tubes: barrel over magazine tube.
    this.group.add(
      part(new THREE.BoxGeometry(0.13, 0.16, 0.4), metal, 0, 0, 0.0),
      part(new THREE.CylinderGeometry(0.038, 0.038, 0.44, 10), dark, 0, 0.028, -0.4, Math.PI / 2),
      part(new THREE.CylinderGeometry(0.032, 0.032, 0.4, 10), dark, 0, -0.045, -0.36, Math.PI / 2),
    );
    // The pump handle sits under the barrels, mid-stroke.
    this.group.add(
      part(new THREE.BoxGeometry(0.1, 0.05, 0.14), hazard, 0, -0.05, -0.32),
      part(new THREE.BoxGeometry(0.104, 0.016, 0.03), dark, 0, -0.05, -0.26),
    );
    // Heat shield slats over the barrel.
    for (let i = 0; i < 3; i++) {
      this.group.add(part(new THREE.BoxGeometry(0.086, 0.01, 0.03), metal, 0, 0.068, -0.3 - i * 0.1));
    }
    // Wide muzzle: the bore is the promise.
    this.group.add(
      part(new THREE.CylinderGeometry(0.048, 0.048, 0.02, 10), glow, 0, 0.028, -0.62, Math.PI / 2),
    );
    // Grip, stock, and a shell card on the receiver side.
    this.group.add(
      part(new THREE.BoxGeometry(0.085, 0.18, 0.11), dark, 0, -0.14, 0.2, 0.4),
      part(new THREE.BoxGeometry(0.09, 0.1, 0.22), metal, 0, -0.04, 0.3),
      part(new THREE.BoxGeometry(0.014, 0.06, 0.16), hazard, 0.068, -0.02, 0.02),
      part(new THREE.BoxGeometry(0.03, 0.05, 0.02), metal, 0, -0.07, 0.08),
    );
  }
}

/** The DMR: a long precision barrel, a scope rail and a cheek riser. */
export class DmrView extends ViewModel {
  constructor() {
    super([0.27, -0.24, -0.48], -0.74);
  }

  protected build(part: ViewModelBuild): void {
    const { metal, dark, glow, hazard } = this.slots;
    // Long receiver and barrel with a stepped profile.
    this.group.add(
      part(new THREE.BoxGeometry(0.105, 0.15, 0.42), metal, 0, 0, 0.02),
      part(new THREE.CylinderGeometry(0.026, 0.03, 0.5, 10), dark, 0, 0.018, -0.48, Math.PI / 2),
      part(new THREE.BoxGeometry(0.06, 0.05, 0.14), metal, 0, 0.018, -0.26),
    );
    // Muzzle brake with side ports.
    this.group.add(
      part(new THREE.BoxGeometry(0.062, 0.062, 0.08), metal, 0, 0.018, -0.72),
      part(new THREE.BoxGeometry(0.07, 0.02, 0.02), dark, 0, 0.018, -0.75),
    );
    // The scope: tube, front and rear lens, mount posts.
    this.group.add(
      part(new THREE.CylinderGeometry(0.032, 0.032, 0.24, 10), dark, 0, 0.135, -0.08, Math.PI / 2),
      part(new THREE.CylinderGeometry(0.038, 0.038, 0.02, 10), glow, 0, 0.135, -0.2, Math.PI / 2),
      part(new THREE.BoxGeometry(0.02, 0.05, 0.03), metal, 0, 0.09, -0.02),
      part(new THREE.BoxGeometry(0.02, 0.05, 0.03), metal, 0, 0.09, -0.14),
    );
    // Magazine, grip, thumbhole stock and the amber bolt handle.
    this.group.add(
      part(new THREE.BoxGeometry(0.06, 0.16, 0.09), dark, 0, -0.14, 0.02),
      part(new THREE.BoxGeometry(0.08, 0.17, 0.1), dark, 0, -0.13, 0.17, 0.32),
      part(new THREE.BoxGeometry(0.085, 0.11, 0.26), metal, 0, -0.02, 0.32),
      part(new THREE.BoxGeometry(0.05, 0.014, 0.05), hazard, 0.06, 0.04, 0.06),
      part(new THREE.BoxGeometry(0.026, 0.05, 0.02), metal, 0, -0.06, 0.1),
    );
  }
}

type ViewModelBuild = (
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx?: number,
) => THREE.Mesh;
