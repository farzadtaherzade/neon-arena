import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { CAMERA, type RifleOptic, type SkinDef, STANDARD_SKIN, WEAPON } from '../game/config';
import { MAT } from './Materials';

/**
 * First-person weapon viewmodel, parented to the camera.
 *
 * A bullpup energy rifle: chunky receiver, railed top with an optic, a
 * vented handguard, an angled magazine, a muzzle brake and a live energy
 * line down the side. Holds the anchors the weapon needs: an `Object3D`
 * marking the muzzle (tracer origin) and an additive flash with a short-lived
 * light.
 *
 * The four colour slots and the optic are the skin: `applySkin` recolours the
 * materials and swaps the optic, so a skin is a palette plus a part. The
 * materials belong to this viewmodel (they cannot be the shared ones — a
 * shared material cannot be recoloured per skin) and live for the page, the
 * same as the viewmodel itself.
 */
export class GunView {
  readonly group = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  readonly flash = new THREE.Group();
  readonly flashLight = new THREE.PointLight(0xffa040, 0, 11, 2);

  private readonly metal = new THREE.MeshStandardMaterial({
    color: STANDARD_SKIN.metal,
    roughness: 0.45,
    metalness: 0.2,
  });
  private readonly dark = new THREE.MeshStandardMaterial({
    color: STANDARD_SKIN.dark,
    roughness: 0.6,
    metalness: 0.15,
  });
  private readonly glow = new THREE.MeshBasicMaterial({ color: STANDARD_SKIN.glow });
  private readonly hazard = new THREE.MeshBasicMaterial({ color: STANDARD_SKIN.hazard });
  private readonly optics: Record<RifleOptic, THREE.Group> = {
    iron: new THREE.Group(),
    reddot: new THREE.Group(),
    holo: new THREE.Group(),
    scope: new THREE.Group(),
  };

  constructor() {
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
      part(new THREE.BoxGeometry(0.115, 0.155, 0.44), this.metal, 0, 0, -0.02),
      part(new THREE.BoxGeometry(0.128, 0.055, 0.3), this.dark, 0, 0.075, -0.03),
      part(new THREE.BoxGeometry(0.075, 0.028, 0.36), this.dark, 0, 0.112, -0.08),
      part(new THREE.BoxGeometry(0.1, 0.03, 0.16), this.dark, 0, -0.085, 0.02),
    );

    // Four optics on the rail; only the equipped one is visible.
    this.buildOptics(part);
    for (const optic of Object.values(this.optics)) this.group.add(optic);

    // Handguard with three lit vents, then the barrel and its brake.
    this.group.add(
      part(new THREE.BoxGeometry(0.088, 0.08, 0.26), this.metal, 0, 0.012, -0.3),
      part(new THREE.BoxGeometry(0.046, 0.046, 0.36), this.dark, 0, 0.016, -0.38),
      part(new THREE.BoxGeometry(0.078, 0.078, 0.12), this.metal, 0, 0.016, -0.57),
      part(new THREE.BoxGeometry(0.03, 0.09, 0.03), this.dark, 0, 0.016, -0.57),
    );
    for (let i = 0; i < 3; i++) {
      this.group.add(part(new THREE.BoxGeometry(0.094, 0.012, 0.05), this.glow, 0, 0.03, -0.24 - i * 0.07));
    }
    // Brake vents and the muzzle ring.
    for (let i = 0; i < 3; i++) {
      this.group.add(part(new THREE.BoxGeometry(0.084, 0.014, 0.02), this.dark, 0, 0.016, -0.545 - i * 0.03));
    }
    this.group.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.012), this.glow, 0, 0.016, -0.632));

    // Grip, magazine, stock and the trigger group.
    this.group.add(
      part(new THREE.BoxGeometry(0.09, 0.2, 0.115), this.dark, 0, -0.145, 0.16, 0.35),
      part(new THREE.BoxGeometry(0.078, 0.23, 0.1), this.dark, 0, -0.17, 0.05, 0.2),
      part(new THREE.BoxGeometry(0.086, 0.11, 0.2), this.metal, 0, -0.03, 0.25),
      part(new THREE.BoxGeometry(0.07, 0.05, 0.14), this.dark, 0, 0.05, 0.25),
      part(new THREE.BoxGeometry(0.03, 0.06, 0.02), this.metal, 0, -0.075, 0.09),
      part(new THREE.BoxGeometry(0.05, 0.025, 0.1), this.metal, 0.075, 0.045, 0.1),
    );
    // Energy line along the receiver and an amber magazine band.
    this.group.add(
      part(new THREE.BoxGeometry(0.006, 0.02, 0.26), this.glow, 0.06, 0.005, -0.04),
      part(new THREE.BoxGeometry(0.082, 0.022, 0.105), this.hazard, 0, -0.1, 0.03),
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

    this.applySkin(null);
  }

  /** The four optics, each a group on the rail. */
  private buildOptics(
    part: (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      rx?: number,
    ) => THREE.Mesh,
  ): void {
    // The rail sits at y 0.15, so every optic is built around that height.
    const add = (optic: RifleOptic, ...meshes: THREE.Mesh[]) => {
      for (const m of meshes) this.optics[optic].add(m);
    };

    // Iron: a front post and a rear notch, no tube at all.
    add(
      'iron',
      part(new THREE.BoxGeometry(0.012, 0.05, 0.012), this.dark, 0, 0.15, -0.17),
      part(new THREE.BoxGeometry(0.05, 0.02, 0.012), this.dark, 0, 0.135, -0.03),
      part(new THREE.BoxGeometry(0.01, 0.01, 0.01), this.glow, 0, 0.162, -0.17),
    );
    // Red dot: a short tube with a round lens.
    add(
      'reddot',
      part(new THREE.BoxGeometry(0.052, 0.05, 0.13), this.metal, 0, 0.15, -0.1),
      part(new THREE.BoxGeometry(0.036, 0.036, 0.012), this.glow, 0, 0.15, -0.165),
      part(new THREE.BoxGeometry(0.024, 0.03, 0.03), this.dark, 0, 0.125, -0.03),
    );
    // Holo: a wide rectangular frame.
    add(
      'holo',
      part(new THREE.BoxGeometry(0.075, 0.055, 0.09), this.metal, 0, 0.15, -0.1),
      part(new THREE.BoxGeometry(0.055, 0.04, 0.01), this.glow, 0, 0.15, -0.148),
      part(new THREE.BoxGeometry(0.03, 0.035, 0.03), this.dark, 0, 0.12, -0.04),
    );
    // Scope: a long tube with a hood.
    add(
      'scope',
      part(new THREE.BoxGeometry(0.05, 0.05, 0.22), this.metal, 0, 0.15, -0.09),
      part(new THREE.BoxGeometry(0.04, 0.04, 0.012), this.glow, 0, 0.15, -0.2),
      part(new THREE.BoxGeometry(0.058, 0.058, 0.02), this.dark, 0, 0.15, -0.205),
      part(new THREE.BoxGeometry(0.03, 0.05, 0.04), this.dark, 0, 0.115, -0.02),
    );
  }

  /**
   * Wear a skin: recolour the four slots and show the skin's optic.
   * A null skin is the standard issue.
   */
  applySkin(skin: SkinDef | null): void {
    const palette = skin?.palette ?? STANDARD_SKIN;
    this.metal.color.setHex(palette.metal);
    this.dark.color.setHex(palette.dark);
    this.glow.color.setHex(palette.glow);
    this.hazard.color.setHex(palette.hazard);
    const part = (skin?.part ?? 'reddot') as RifleOptic;
    for (const [key, optic] of Object.entries(this.optics)) optic.visible = key === part;
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
