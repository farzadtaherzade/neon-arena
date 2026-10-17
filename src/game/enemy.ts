import { dampFactor } from '../core/math';
import type { Rng } from '../core/rng';
import { ENEMY, ENEMY_LOOKS, ENEMY_TYPES, type EnemyKind, SAPPER } from './config';
import type { Vec3 } from './player';
import type { Vec2 } from './world/collision';

/** Everything an enemy needs from the world, handed in per step. */
export interface EnemyWorld {
  playerPos: Vec2;
  /** Live separation candidates from the population's spatial hash. */
  neighbours: readonly Enemy[];
  /** Live + queued hostiles; drives the sapper's hunt trigger. */
  hostileCount: number;
  collide(pos: Vec2, r: number): void;
  damagePlayer(amount: number): void;
  /** A sapper wants a bomb at `to`; `from` is where it came from, for the throw arc. */
  plantBomb(from: Vec2, to: Vec2, thrown: boolean): void;
}

export interface EnemyStats {
  maxHp: number;
  hp: number;
  speed: number;
  dmg: number;
  score: number;
  scale: number;
}

/**
 * One hostile robot: steering, health, and the death clock.
 *
 * Pure — `pos` is a plain `{x, y, z}`, meshes live in `render/EnemyView.ts` and
 * read that position every frame. The hit flash is a timer + colour here; the
 * view applies it.
 */
export class Enemy {
  readonly pos: Vec3 = { x: 0, y: 0, z: 0 };
  readonly stats: EnemyStats;

  state: 'alive' | 'dying' = 'alive';
  vx = 0;
  vz = 0;
  cool = 0;
  phase = 0;
  flashT = 0;
  flashHex = 0xffffff;
  deathT = 0;

  /** Sapper only: seconds until the next plant, wander heading, current mode. */
  plantT = 0;
  wanderA = 0;
  sapperMode: 'lurk' | 'hunt' = 'lurk';

  /** Distance of the nearest living neighbour at the last separation pass. */
  private reachPad: number = ENEMY.REACH_PAD;

  /** Which cosmetic skin this individual uses (index into its kind's looks). */
  readonly look: number;

  constructor(
    readonly kind: EnemyKind,
    x: number,
    z: number,
    rng: Rng,
  ) {
    const spec = ENEMY_TYPES[kind];
    const looks = ENEMY_LOOKS[kind];
    this.stats = {
      maxHp: spec.hp,
      hp: spec.hp,
      speed: spec.speed,
      dmg: spec.dmg,
      score: spec.score,
      scale: spec.scale,
    };
    this.pos.x = x;
    this.pos.z = z;
    this.cool = rng.range(0.5, 1);
    this.phase = rng.next() * 6;
    // Stagger the first plant so a wave of sappers doesn't fire in lockstep.
    this.plantT = rng.range(SAPPER.PLANT_T * 0.4, SAPPER.PLANT_T);
    this.wanderA = rng.next() * Math.PI * 2;
    this.look = Math.floor(rng.next() * looks.length);
  }

  get hp(): number {
    return this.stats.hp;
  }

  get scale(): number {
    return this.stats.scale;
  }

  /** Apply per-wave scaling. Called by the wave director at spawn time. */
  scaleUp(hpBonus: number, speedScale: number, dmgBonus: number): void {
    this.stats.maxHp += hpBonus;
    this.stats.hp += hpBonus;
    this.stats.speed *= speedScale;
    this.stats.dmg += dmgBonus;
    this.reachPad = ENEMY.REACH_PAD * this.scale;
  }

  flash(hex: number, duration: number): void {
    this.flashHex = hex;
    this.flashT = Math.max(this.flashT, duration);
  }

  /** Advance AI or the death clock. Returns true once the corpse is finished. */
  update(dt: number, world: EnemyWorld): boolean {
    if (this.state === 'dying') return this.updateDeath(dt);

    this.cool -= dt;
    if (this.kind === 'sapper') this.updateSapper(dt, world);
    else this.updateChaser(dt, world);

    this.flashT = Math.max(0, this.flashT - dt);
    this.phase += dt * (3 + this.stats.speed * 1.6);

    world.collide(this.pos, ENEMY.COLLIDE_RADIUS * this.scale);
    return false;
  }

  /** Bounce height and leg swing for this step. */
  get bounce(): number {
    return Math.abs(Math.sin(this.phase)) * ENEMY.BOUNCE;
  }

  get legSwing(): number {
    return Math.sin(this.phase) * ENEMY.LEG_SWING;
  }

  /** Yaw that faces the player. */
  facing(playerPos: Vec2): number {
    return Math.atan2(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
  }

  /** Chase and melee — grunt, runner and tank. */
  private updateChaser(dt: number, world: EnemyWorld): void {
    const dx = world.playerPos.x - this.pos.x;
    const dz = world.playerPos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > this.reachPad) this.chase(dt, dx, dz, dist, world);
    else this.attack(world);
  }

  /**
   * The sapper. While the herd is healthy it keeps its distance and plants a
   * bomb every `PLANT_T` seconds — throwing one at the player from range, or
   * dropping one in its tracks up close. Once fewer than `HUNT_AT` hostiles
   * remain it abandons the bombs and charges.
   */
  private updateSapper(dt: number, world: EnemyWorld): void {
    const dx = world.playerPos.x - this.pos.x;
    const dz = world.playerPos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const hunting = world.hostileCount < SAPPER.HUNT_AT;
    this.sapperMode = hunting ? 'hunt' : 'lurk';

    if (hunting) {
      if (dist > this.reachPad) this.chase(dt, dx, dz, dist, world, SAPPER.HUNT_SPEED);
      else this.attack(world);
      return;
    }

    const inv = 1 / (dist || 1);
    this.plantT -= dt;
    if (this.plantT <= 0) {
      this.plantT = SAPPER.PLANT_T;
      const thrown = dist > SAPPER.THROW_DIST;
      world.plantBomb(this.pos, thrown ? world.playerPos : this.pos, thrown);
    }

    // Back away when the player is too close, otherwise wander.
    let mx: number;
    let mz: number;
    if (dist < SAPPER.KEEP_DIST) {
      mx = -dx * inv;
      mz = -dz * inv;
    } else {
      mx = Math.sin(this.wanderA);
      mz = Math.cos(this.wanderA);
    }
    this.steer(dt, mx, mz, this.stats.speed * SAPPER.LURK_GAIN, world);
    this.wanderA += Math.sin(this.phase * 0.7) * SAPPER.WANDER_TURN * dt;

    if (dist <= this.reachPad) this.attack(world);
  }

  private chase(
    dt: number,
    dx: number,
    dz: number,
    dist: number,
    world: EnemyWorld,
    speed = this.stats.speed,
  ): void {
    const inv = 1 / (dist || 1);
    this.steer(dt, dx * inv, dz * inv, speed, world);
  }

  /** Steer toward a unit direction at `speed`, with neighbour separation. */
  private steer(dt: number, mx: number, mz: number, speed: number, world: EnemyWorld): void {
    // Separation so a crowd fans out instead of stacking into one silhouette.
    let sx = 0;
    let sz = 0;
    for (const other of world.neighbours) {
      if (other === this || other.state !== 'alive') continue;
      const ox = this.pos.x - other.pos.x;
      const oz = this.pos.z - other.pos.z;
      const od = Math.hypot(ox, oz);
      const minD = (ENEMY.SEPARATION * (this.scale + other.scale)) / 2 + ENEMY.SEPARATION_PAD;
      if (od > 0.001 && od < minD) {
        sx += (ox / od) * (minD - od);
        sz += (oz / od) * (minD - od);
      }
    }

    const k = dampFactor(ENEMY.MOVE_DAMP, dt);
    const targetVx = (mx + sx * ENEMY.SEPARATION_FORCE) * speed;
    const targetVz = (mz + sz * ENEMY.SEPARATION_FORCE) * speed;
    this.vx += (targetVx - this.vx) * k;
    this.vz += (targetVz - this.vz) * k;
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
  }

  private attack(world: EnemyWorld): void {
    this.vx *= ENEMY.ARRIVE_DAMP;
    this.vz *= ENEMY.ARRIVE_DAMP;
    if (this.cool <= 0) {
      this.cool = ENEMY.ATTACK_COOLDOWN;
      this.flash(ENEMY.ATTACK_FLASH_COLOR, ENEMY.ATTACK_FLASH);
      world.damagePlayer(this.stats.dmg);
    }
  }

  /** Apply damage. Returns true if this shot killed it. */
  takeDamage(amount: number): boolean {
    if (this.state !== 'alive') return false;
    this.stats.hp -= amount;
    this.flash(ENEMY.HIT_FLASH_COLOR, ENEMY.HIT_FLASH);
    return this.stats.hp <= 0;
  }

  /** Shove along the shot direction so hits read as impacts, not just a number. */
  knockback(dirX: number, dirZ: number): void {
    this.pos.x += dirX * ENEMY.KNOCKBACK;
    this.pos.z += dirZ * ENEMY.KNOCKBACK;
  }

  /** Start the death animation. Returns false if already dying. */
  kill(): boolean {
    if (this.state !== 'alive') return false;
    this.state = 'dying';
    this.deathT = 0;
    return true;
  }

  private updateDeath(dt: number): boolean {
    this.deathT += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    return this.deathT >= ENEMY.DEATH_TIME;
  }

  /** Death animation progress 0..1 — tilt and sink read from this. */
  get deathK(): number {
    return Math.min(this.deathT / ENEMY.DEATH_TIME, 1);
  }
}
