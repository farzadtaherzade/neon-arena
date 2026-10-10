import THREE from './three.js';
import { FX } from './config.js';

/**
 * Pooled additive particles in one draw call. Positions and colours are packed
 * into Float32Arrays and uploaded per frame; dead particles are parked at
 * y = -999 rather than removed so the buffers never resize.
 */
export class Particles {
  constructor(scene) {
    this.max = FX.PARTICLE_MAX;
    this.cursor = 0;

    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.base = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.span = new Float32Array(this.max);
    this.grav = new Float32Array(this.max);
    for (let k = 0; k < this.max; k++) this.pos[k * 3 + 1] = -999;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));

    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: FX.PARTICLE_SIZE, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    this._color = new THREE.Color();
  }

  /** Emit `count` particles from `p`, omnidirectionally, fading over `life`. */
  burst(p, colorHex, count, speed = 4, life = 0.6, gravity = 9) {
    this._color.setHex(colorHex);
    for (let n = 0; n < count; n++) {
      const k = this.cursor = (this.cursor + 1) % this.max;
      this.pos[k * 3] = p.x;
      this.pos[k * 3 + 1] = p.y;
      this.pos[k * 3 + 2] = p.z;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.3 + Math.random() * 0.7);
      this.vel[k * 3] = Math.sin(phi) * Math.cos(theta) * s;
      this.vel[k * 3 + 1] = Math.cos(phi) * s;
      this.vel[k * 3 + 2] = Math.sin(phi) * Math.sin(theta) * s;

      this.life[k] = this.span[k] = life * (0.5 + Math.random() * 0.5);
      this.grav[k] = gravity;
      this.base[k * 3] = this._color.r;
      this.base[k * 3 + 1] = this._color.g;
      this.base[k * 3 + 2] = this._color.b;
    }
  }

  update(dt) {
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) {
        this.pos[k * 3 + 1] = -999;
        this.col[k * 3] = this.col[k * 3 + 1] = this.col[k * 3 + 2] = 0;
        continue;
      }

      this.vel[k * 3 + 1] -= this.grav[k] * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;

      // Settle on the floor with a little bounce.
      if (this.pos[k * 3 + 1] < 0.03) {
        this.pos[k * 3 + 1] = 0.03;
        this.vel[k * 3 + 1] *= -0.4;
      }

      const f = this.life[k] / this.span[k];
      this.col[k * 3] = this.base[k * 3] * f;
      this.col[k * 3 + 1] = this.base[k * 3 + 1] * f;
      this.col[k * 3 + 2] = this.base[k * 3 + 2] * f;
    }

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    for (let k = 0; k < this.max; k++) {
      this.pos[k * 3 + 1] = -999;
      this.col[k * 3] = this.col[k * 3 + 1] = this.col[k * 3 + 2] = 0;
    }
  }
}

/** Fixed ring of tracer lines, rewritten in place each shot. */
export class Tracers {
  constructor(scene) {
    this.items = [];
    for (let i = 0; i < FX.TRACER_MAX; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0xffd27a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.items.push({ line, life: 0 });
    }
    this.cursor = 0;
  }

  fire(a, b) {
    const t = this.items[this.cursor = (this.cursor + 1) % this.items.length];
    const arr = t.line.geometry.attributes.position.array;
    arr[0] = a.x; arr[1] = a.y; arr[2] = a.z;
    arr[3] = b.x; arr[4] = b.y; arr[5] = b.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.visible = true;
    t.life = 1;
  }

  update(dt) {
    for (const t of this.items) {
      if (t.life <= 0) continue;
      t.life -= dt * FX.TRACER_DECAY;
      if (t.life <= 0) t.line.visible = false;
      else t.line.material.opacity = t.life * FX.TRACER_OPACITY;
    }
  }

  clear() {
    for (const t of this.items) {
      t.life = 0;
      t.line.visible = false;
    }
  }
}

/** The two systems the game holds together. */
export class Fx {
  constructor(scene) {
    this.particles = new Particles(scene);
    this.tracers = new Tracers(scene);
  }

  update(dt) {
    this.particles.update(dt);
    this.tracers.update(dt);
  }

  clear() {
    this.particles.clear();
    this.tracers.clear();
  }
}