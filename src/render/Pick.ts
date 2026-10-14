import * as THREE from 'three';
import type { Rng } from '../core/rng';
import type { Enemy } from '../game/enemy';

export type HitPart = 'body' | 'head' | 'wall';

/** Reused shot result — one per frame at most, never more. */
export interface ShotHit {
  point: THREE.Vector3;
  enemy: Enemy | null;
  part: HitPart;
}

/**
 * Hitscan picking.
 *
 * One `intersectObjects` call per shot against a single list holding the world
 * solids and every enemy's body/head. `EnemyView` adds and removes its own two
 * meshes, so a corpse stops being shootable the moment it dies — same as before,
 * but with one traversal instead of two.
 */
export class Pick {
  readonly objects: THREE.Object3D[] = [];

  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private out: ShotHit = { point: new THREE.Vector3(), enemy: null, part: 'wall' };

  add(...meshes: THREE.Object3D[]): void {
    this.objects.push(...meshes);
  }

  remove(mesh: THREE.Object3D): void {
    const i = this.objects.indexOf(mesh);
    if (i >= 0) this.objects.splice(i, 1);
  }

  /** Aim down the camera axis, nudged inside a half-angle of `spread` radians. */
  aim(camera: THREE.Camera, spread: number, rng: Rng): void {
    this.ndc.set((rng.next() - 0.5) * 2 * spread, (rng.next() - 0.5) * 2 * spread);
    this.ray.setFromCamera(this.ndc, camera);
  }

  /** Direction of the current ray. */
  get direction(): THREE.Vector3 {
    return this.ray.ray.direction;
  }

  /** Nearest hit, or null. The returned object is reused — copy what you keep. */
  cast(): ShotHit | null {
    const hits = this.ray.intersectObjects(this.objects, false);
    const first = hits[0];
    if (!first) return null;

    const data = (first.object as THREE.Mesh).userData as { enemy?: Enemy; part?: HitPart } | undefined;
    this.out.point.copy(first.point);
    if (data?.enemy) {
      this.out.enemy = data.enemy;
      this.out.part = data.part ?? 'body';
    } else {
      this.out.enemy = null;
      this.out.part = 'wall';
    }
    return this.out;
  }
}
