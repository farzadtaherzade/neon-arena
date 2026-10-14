import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { FX } from '../game/config';
import type { BurstOpts } from '../game/fx';
import { ParticlePool, TracerPool } from '../game/fx';

/**
 * GPU views over the pure pools in `game/fx.ts`.
 *
 * One `THREE.Points` for every particle (one draw call) and a fixed ring of
 * `THREE.Line`s for tracers. All the physics lives in the pools; this file only
 * uploads buffers and toggles visibility.
 */
export class Fx {
  readonly pool = new ParticlePool();
  readonly tracers = new TracerPool();

  private points: THREE.Points;
  private lines: { line: THREE.Line; mat: THREE.LineBasicMaterial }[] = [];

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.pool.pos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geo.setAttribute('color', new THREE.BufferAttribute(this.pool.col, 3).setUsage(THREE.DynamicDrawUsage));

    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: FX.PARTICLE_SIZE,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);

    for (let i = 0; i < FX.TRACER_MAX; i++) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage),
      );
      const mat = new THREE.LineBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(lineGeo, mat);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.lines.push({ line, mat });
    }
  }

  burst(o: BurstOpts, rng: Rng): void {
    this.pool.burst(o, rng);
  }

  fire(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): void {
    this.tracers.fire(a, b);
  }

  update(dt: number): void {
    this.pool.update(dt);
    this.tracers.update(dt);

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    for (let i = 0; i < this.lines.length; i++) {
      const t = this.tracers.items[i]!;
      const { line, mat } = this.lines[i]!;
      if (t.life <= 0) {
        line.visible = false;
        continue;
      }
      line.visible = true;
      mat.opacity = t.life * FX.TRACER_OPACITY;
      const attr = line.geometry.attributes.position;
      const arr = attr.array as Float32Array;
      arr[0] = t.ax;
      arr[1] = t.ay;
      arr[2] = t.az;
      arr[3] = t.bx;
      arr[4] = t.by;
      arr[5] = t.bz;
      attr.needsUpdate = true;
    }
  }

  clear(): void {
    this.pool.clear();
    this.tracers.clear();
    for (const { line } of this.lines) line.visible = false;
  }
}
