import * as THREE from 'three';
import type { Xp } from '../game/xp';
import { GEO } from './Materials';

/**
 * The small floating orb that marks one XP pickup.
 *
 * Cosmetic-only: it is never a pick target, shares a cached geometry, and owns
 * exactly one material which it disposes with the view.
 */
export class XpView {
  private group = new THREE.Group();
  private mat: THREE.MeshStandardMaterial;

  constructor(private readonly xp: Xp) {
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x7ce4ff,
      emissive: 0x2ec5ff,
      emissiveIntensity: 1.2,
      roughness: 0.4,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(GEO.xpOrb(), this.mat);
    mesh.castShadow = false;
    this.group.add(mesh);
    this.group.position.set(xp.pos.x, xp.pos.y, xp.pos.z);
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.group);
  }

  /** Float and pulse; called once per rendered frame. */
  sync(): void {
    // x/z must follow the simulation: the orb is magnetised toward the player.
    this.group.position.set(this.xp.pos.x, this.xp.pos.y + Math.sin(this.xp.age * 2.4) * 0.08, this.xp.pos.z);
    this.group.rotation.y = this.xp.age * 1.4;
    this.mat.emissiveIntensity = 0.9 + 0.6 * (0.5 + 0.5 * Math.sin(this.xp.age * 3.5));
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.mat.dispose();
  }
}
