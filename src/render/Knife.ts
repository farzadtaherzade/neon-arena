import * as THREE from 'three';
import { CAMERA, KNIFE } from '../game/config';
import { MAT } from './Materials';

/**
 * The knife viewmodel, parented to the camera.
 *
 * It lives in the left hand — the rifle keeps the right — so both are on screen
 * at once and the blade can be brought out at any time. The swing is a single
 * arc: the blade comes up on the right and cuts down across the view.
 */
export class KnifeView {
  readonly group = new THREE.Group();

  constructor() {
    const metal = MAT.gunMetal();
    const dark = MAT.gunDark();

    const part = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      return m;
    };

    // Grip, pommel and guard.
    this.group.add(
      part(new THREE.BoxGeometry(0.042, 0.055, 0.17), dark, 0, 0, 0.13),
      part(new THREE.BoxGeometry(0.05, 0.065, 0.025), MAT.hazard(), 0, 0, 0.035),
      part(new THREE.BoxGeometry(0.048, 0.062, 0.025), dark, 0, 0, 0.235),
    );

    // Blade: a flat slab with a lit edge and a tapered tip.
    this.group.add(
      part(new THREE.BoxGeometry(0.028, 0.075, 0.46), metal, 0, 0, -0.2),
      part(new THREE.BoxGeometry(0.01, 0.014, 0.44), MAT.glow(), 0.02, 0.032, -0.2),
      part(new THREE.BoxGeometry(0.024, 0.05, 0.07), metal, 0, 0, -0.46),
    );

    this.group.position.set(-0.3, -0.3, -0.45);
    this.group.rotation.set(-0.5, 0, 0.35);
  }

  show(on: boolean): void {
    this.group.visible = on;
  }

  /**
   * Idle bob, plus the swing arc while the blade is out (`swingT` counts down
   * from `KNIFE.SWING_T`).
   */
  pose(swingT: number, bobPhase: number, strafe: number): void {
    const k = swingT > 0 ? 1 - swingT / KNIFE.SWING_T : 0;
    const bobX = Math.sin(bobPhase) * CAMERA.BOB_X * 0.6;
    const bobY = Math.sin(bobPhase * 2) * CAMERA.BOB_GUN_Y * 0.6;
    this.group.position.set(
      -0.3 + bobX - k * 0.22 + strafe * CAMERA.GUN_SWAY_Z * 0.5,
      -0.3 + bobY - k * 0.06,
      -0.45 + k * 0.08,
    );
    this.group.rotation.set(-0.5 + k * 0.5, 0, 0.35 - k * 1.6);
  }
}
