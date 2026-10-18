import * as THREE from 'three';
import type { Bomb } from '../game/bomb';
import { GEO, MAT } from './Materials';

/**
 * The meshes for one bomb: a body that blinks faster as the fuse burns down and
 * a ground ring that telegraphs the blast radius.
 *
 * Owns the body material (the blink writes `emissiveIntensity`), shares the
 * geometry and the ring material, and disposes exactly what it owns.
 */
export class BombView {
  readonly mesh: THREE.Mesh;

  private ring: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;

  constructor(private readonly bomb: Bomb) {
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x1a1f2a,
      emissive: 0xff2a1a,
      emissiveIntensity: 0.5,
      roughness: 0.5,
      metalness: 0.3,
    });

    this.mesh = new THREE.Mesh(GEO.bombBody(), this.mat);
    this.mesh.position.set(bomb.pos.x, bomb.pos.y + 0.35, bomb.pos.z);
    this.mesh.castShadow = true;
    this.mesh.userData = { bomb };

    this.ring = new THREE.Mesh(GEO.bombRing(), MAT.bombRing());
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(bomb.pos.x, bomb.pos.y + 0.02, bomb.pos.z);
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.mesh, this.ring);
  }

  /** Blink faster and brighter as the fuse runs out. */
  sync(elapsed: number): void {
    const rate = 8 + this.bomb.k * 46;
    this.mat.emissiveIntensity = 0.5 + (0.5 + 0.5 * Math.sin(elapsed * rate)) * 2.2;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh, this.ring);
    this.mat.dispose();
  }
}
