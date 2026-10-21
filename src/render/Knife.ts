import * as THREE from 'three';
import { CAMERA, KNIFE, type KnifeBlade, type SkinDef, STANDARD_SKIN } from '../game/config';

/**
 * The knife viewmodel, parented to the camera.
 *
 * It lives in the left hand — the rifle keeps the right — so both are on screen
 * at once and the blade can be brought out at any time. The swing is a single
 * arc: the blade comes up on the right and cuts down across the view.
 *
 * The grip is the same on every skin; the blade is the part a skin swaps.
 * The materials belong to this viewmodel (a shared material cannot be
 * recoloured per skin) and live for the page, like the viewmodel itself.
 */
export class KnifeView {
  readonly group = new THREE.Group();

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
  private readonly blades: Record<KnifeBlade, THREE.Group> = {
    straight: new THREE.Group(),
    cleaver: new THREE.Group(),
    saw: new THREE.Group(),
    hook: new THREE.Group(),
  };

  constructor() {
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

    // Grip, pommel and guard — the same on every skin.
    this.group.add(
      part(new THREE.BoxGeometry(0.042, 0.055, 0.17), this.dark, 0, 0, 0.13),
      part(new THREE.BoxGeometry(0.05, 0.065, 0.025), this.hazard, 0, 0, 0.035),
      part(new THREE.BoxGeometry(0.048, 0.062, 0.025), this.dark, 0, 0, 0.235),
    );

    this.buildBlades(part);
    for (const blade of Object.values(this.blades)) this.group.add(blade);

    this.group.position.set(-0.3, -0.3, -0.45);
    this.group.rotation.set(-0.5, 0, 0.35);

    this.applySkin(null);
  }

  /** The four blades, each a group in front of the guard. */
  private buildBlades(
    part: (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => THREE.Mesh,
  ): void {
    const add = (blade: KnifeBlade, ...meshes: THREE.Mesh[]) => {
      for (const m of meshes) this.blades[blade].add(m);
    };

    // Straight: a flat slab with a lit edge and a tapered tip.
    add(
      'straight',
      part(new THREE.BoxGeometry(0.028, 0.075, 0.46), this.metal, 0, 0, -0.2),
      part(new THREE.BoxGeometry(0.01, 0.014, 0.44), this.glow, 0.02, 0.032, -0.2),
      part(new THREE.BoxGeometry(0.024, 0.05, 0.07), this.metal, 0, 0, -0.46),
    );
    // Cleaver: a wide, heavy slab.
    add(
      'cleaver',
      part(new THREE.BoxGeometry(0.014, 0.15, 0.34), this.metal, 0, 0.01, -0.16),
      part(new THREE.BoxGeometry(0.008, 0.1, 0.3), this.glow, 0.012, 0.02, -0.16),
      part(new THREE.BoxGeometry(0.02, 0.13, 0.05), this.metal, 0, 0.01, -0.34),
    );
    // Saw: a thin blade with a serrated spine.
    add(
      'saw',
      part(new THREE.BoxGeometry(0.022, 0.06, 0.42), this.metal, 0, 0, -0.2),
      part(new THREE.BoxGeometry(0.008, 0.012, 0.4), this.glow, 0.016, 0.026, -0.2),
    );
    for (let i = 0; i < 8; i++) {
      add('saw', part(new THREE.BoxGeometry(0.02, 0.024, 0.026), this.metal, 0, 0.042, -0.06 - i * 0.045));
    }
    // Hook: a narrow blade that curves back on itself.
    add(
      'hook',
      part(new THREE.BoxGeometry(0.024, 0.07, 0.3), this.metal, 0, 0, -0.16),
      part(new THREE.BoxGeometry(0.008, 0.012, 0.28), this.glow, 0.016, 0.03, -0.16),
      part(new THREE.BoxGeometry(0.024, 0.07, 0.1), this.metal, 0, 0.06, -0.33),
      part(new THREE.BoxGeometry(0.024, 0.1, 0.07), this.metal, 0, 0.015, -0.37),
    );
  }

  /** Wear a skin: recolour the four slots and show the skin's blade. */
  applySkin(skin: SkinDef | null): void {
    const palette = skin?.palette ?? STANDARD_SKIN;
    this.metal.color.setHex(palette.metal);
    this.dark.color.setHex(palette.dark);
    this.glow.color.setHex(palette.glow);
    this.hazard.color.setHex(palette.hazard);
    const part = (skin?.part ?? 'straight') as KnifeBlade;
    for (const [key, blade] of Object.entries(this.blades)) blade.visible = key === part;
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
