import type { Rng } from '../core/rng';
import { FX } from './config';

/** A burst emitted by gameplay code; the pool only needs the numbers. */
export interface BurstOpts {
  x: number;
  y: number;
  z: number;
  color: number;
  count: number;
  speed: number;
  life: number;
  gravity: number;
}

/**
 * Pooled additive particles as flat typed arrays — no three, no DOM.
 *
 * `render/Fx.ts` wraps one of these in a `THREE.Points` and uploads `pos`/`col`
 * after every step. Dead particles are parked at y = -999 rather than removed so
 * the buffers never resize.
 *
 * The old loop walked all `PARTICLE_MAX` slots every frame regardless of how few
 * were alive; `live` lets it skip the rest.
 */
export class ParticlePool {
  readonly pos = new Float32Array(FX.PARTICLE_MAX * 3);
  readonly col = new Float32Array(FX.PARTICLE_MAX * 3);
  private base = new Float32Array(FX.PARTICLE_MAX * 3);
  private vel = new Float32Array(FX.PARTICLE_MAX * 3);
  private life = new Float32Array(FX.PARTICLE_MAX);
  private span = new Float32Array(FX.PARTICLE_MAX);
  private grav = new Float32Array(FX.PARTICLE_MAX);

  private cursor = 0;
  private liveCount = 0;

  constructor() {
    for (let k = 0; k < FX.PARTICLE_MAX; k++) this.pos[k * 3 + 1] = -999;
  }

  get max(): number {
    return FX.PARTICLE_MAX;
  }

  /** Slots currently animating. */
  get live(): number {
    return this.liveCount;
  }

  /** Emit `count` particles omnidirectionally, fading over `life`. */
  burst(o: BurstOpts, rng: Rng): void {
    const r = ((o.color >> 16) & 0xff) / 255;
    const g = ((o.color >> 8) & 0xff) / 255;
    const b = (o.color & 0xff) / 255;

    for (let n = 0; n < o.count; n++) {
      this.cursor = (this.cursor + 1) % FX.PARTICLE_MAX;
      const k = this.cursor;
      const k3 = k * 3;
      this.pos[k3] = o.x;
      this.pos[k3 + 1] = o.y;
      this.pos[k3 + 2] = o.z;

      const theta = rng.next() * Math.PI * 2;
      const phi = Math.acos(2 * rng.next() - 1);
      const s = o.speed * (0.3 + rng.next() * 0.7);
      this.vel[k3] = Math.sin(phi) * Math.cos(theta) * s;
      this.vel[k3 + 1] = Math.cos(phi) * s;
      this.vel[k3 + 2] = Math.sin(phi) * Math.sin(theta) * s;

      this.life[k] = this.span[k] = o.life * (0.5 + rng.next() * 0.5);
      this.grav[k] = o.gravity;
      this.base[k3] = r;
      this.base[k3 + 1] = g;
      this.base[k3 + 2] = b;
      if (this.life[k] > 0) this.liveCount++;
    }
  }

  update(dt: number): void {
    if (this.liveCount === 0) return;
    let alive = 0;

    for (let k = 0; k < FX.PARTICLE_MAX; k++) {
      if (this.life[k] <= 0) continue;
      const k3 = k * 3;
      this.life[k] -= dt;
      if (this.life[k] <= 0) {
        this.pos[k3 + 1] = -999;
        this.col[k3] = this.col[k3 + 1] = this.col[k3 + 2] = 0;
        continue;
      }
      alive++;

      this.vel[k3 + 1] -= this.grav[k] * dt;
      this.pos[k3] += this.vel[k3] * dt;
      this.pos[k3 + 1] += this.vel[k3 + 1] * dt;
      this.pos[k3 + 2] += this.vel[k3 + 2] * dt;

      // Settle on the floor with a little bounce.
      if (this.pos[k3 + 1] < 0.03) {
        this.pos[k3 + 1] = 0.03;
        this.vel[k3 + 1] *= -0.4;
      }

      const f = this.life[k] / this.span[k];
      this.col[k3] = this.base[k3] * f;
      this.col[k3 + 1] = this.base[k3 + 1] * f;
      this.col[k3 + 2] = this.base[k3 + 2] * f;
    }

    this.liveCount = alive;
  }

  clear(): void {
    this.liveCount = 0;
    this.life.fill(0);
    for (let k = 0; k < FX.PARTICLE_MAX; k++) {
      this.pos[k * 3 + 1] = -999;
      this.col[k * 3] = this.col[k * 3 + 1] = this.col[k * 3 + 2] = 0;
    }
  }
}

export interface Tracer {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  life: number;
}

/**
 * Fixed ring of tracers, reused so a burst of shots never allocates.
 *
 * `render/Fx.ts` rewrites one `THREE.Line` per slot from these numbers.
 */
export class TracerPool {
  readonly items: Tracer[] = [];
  private cursor = 0;

  constructor(readonly max = FX.TRACER_MAX) {
    for (let i = 0; i < max; i++) {
      this.items.push({ ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, life: 0 });
    }
  }

  fire(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): void {
    this.cursor = (this.cursor + 1) % this.items.length;
    const t = this.items[this.cursor]!;
    t.ax = a.x;
    t.ay = a.y;
    t.az = a.z;
    t.bx = b.x;
    t.by = b.y;
    t.bz = b.z;
    t.life = 1;
  }

  update(dt: number): void {
    for (const t of this.items) {
      if (t.life > 0) t.life = Math.max(0, t.life - dt * FX.TRACER_DECAY);
    }
  }

  clear(): void {
    for (const t of this.items) t.life = 0;
  }
}
