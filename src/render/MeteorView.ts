import * as THREE from 'three';
import type { Meteor } from '../game/meteor';
import { GEO, MAT } from './Materials';

/**
 * One falling stone: the rock itself and the marker on the ground under it.
 *
 * The rock uses the shared geometry and material; the marker owns its own
 * material because its opacity pulses with the fall, and disposes it with the
 * view.
 */
export class MeteorView {
  private rock: THREE.Mesh;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;

  constructor(private readonly meteor: Meteor) {
    this.rock = new THREE.Mesh(GEO.rock(), MAT.rock());
    this.rock.castShadow = true;

    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xff5a2a,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.ring = new THREE.Mesh(GEO.meteorRing(), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(meteor.impact.x, meteor.impact.y + 0.03, meteor.impact.z);
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.rock, this.ring);
  }

  /** Move the rock and tighten the marker; called once per rendered frame. */
  sync(dt: number): void {
    const m = this.meteor;
    this.rock.position.set(m.pos.x, m.pos.y, m.pos.z);
    this.rock.rotation.x += dt * 1.7;
    this.rock.rotation.z += dt * 1.2;

    // The marker shrinks and brightens as the rock closes in: the closer it
    // gets, the less time the player has to step out of the ring.
    const k = m.k;
    this.ring.scale.setScalar(1.6 - 0.6 * k);
    this.ringMat.opacity = 0.15 + 0.45 * k;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.rock, this.ring);
    this.ringMat.dispose();
  }
}
