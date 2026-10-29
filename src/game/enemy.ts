import { dampFactor } from '../core/math';
import type { Rng } from '../core/rng';
import { BOSS, ENEMY, ENEMY_LOOKS, ENEMY_TYPES, type EnemyKind, RUNNER, SAPPER, TANK, WORLD } from './config';
import type { Vec3 } from './player';
import type { Ramp, Vec2 } from './world/collision';

/** Everything an enemy needs from the world, handed in per step. */
export interface EnemyWorld {
  playerPos: Vec2;
  /** The player's feet height — what tells a mob the player is up on a deck. */
  playerY: number;
  /** Live separation candidates from the population's spatial hash. */
  neighbours: readonly Enemy[];
  /** Live + queued hostiles; drives the sapper's hunt trigger. */
  hostileCount: number;
  collide(pos: Vec2, r: number, feetY: number): void;
  /** Highest walkable surface at (x, z) at or below `ceiling`, floor included. */
  support(x: number, z: number, r: number, ceiling: number): number;
  /** Ramps in the arena, so a mob can follow the player onto high ground. */
  ramps: readonly Ramp[];
  damagePlayer(amount: number): void;
  /** Shove the player — the tank's ground slam. */
  knockPlayer(dirX: number, dirZ: number, force: number): void;
  /** A sapper wants a bomb at `to`; `from` is where it came from, for the throw arc.
   *  `heavy` is the WARDEN's rocket: a faster, smaller, lighter bomb. */
  plantBomb(from: Vec2, to: Vec2, thrown: boolean, heavy?: boolean): void;
}

/** Where a hit came from, so the mob can work out what its armour is doing. */
export interface HitInfo {
  /** Direction from the mob toward whoever hit it. */
  dirX: number;
  dirZ: number;
  headshot: boolean;
  /** A blade goes under the plate; a bullet does not. */
  melee: boolean;
}

export interface EnemyStats {
  maxHp: number;
  hp: number;
  speed: number;
  dmg: number;
  score: number;
  scale: number;
}

/** Centre of a ramp's low edge, pushed downhill so a climber lines up first. */
function rampMouthX(ramp: Ramp): number {
  if (ramp.upX !== 0) return (ramp.upX > 0 ? ramp.minX : ramp.maxX) - ramp.upX * ENEMY.RAMP_OFFSET;
  return (ramp.minX + ramp.maxX) / 2;
}

function rampMouthZ(ramp: Ramp): number {
  if (ramp.upZ !== 0) return (ramp.upZ > 0 ? ramp.minZ : ramp.maxZ) - ramp.upZ * ENEMY.RAMP_OFFSET;
  return (ramp.minZ + ramp.maxZ) / 2;
}

/** Centre of a ramp's high edge, pushed onto the platform it serves. */
function rampTopX(ramp: Ramp): number {
  if (ramp.upX !== 0) return (ramp.upX > 0 ? ramp.maxX : ramp.minX) + ramp.upX * ENEMY.RAMP_OFFSET;
  return (ramp.minX + ramp.maxX) / 2;
}

function rampTopZ(ramp: Ramp): number {
  if (ramp.upZ !== 0) return (ramp.upZ > 0 ? ramp.maxZ : ramp.minZ) + ramp.upZ * ENEMY.RAMP_OFFSET;
  return (ramp.minZ + ramp.maxZ) / 2;
}

/**
 * One hostile robot: steering, health, and the death clock.
 *
 * Pure — `pos` is a plain `{x,y,z}`, meshes live in `render/EnemyView.ts` and
 * read that position every frame. The hit flash is a timer + colour here; the
 * view applies it.
 */
export class Enemy {
  readonly pos: Vec3 = { x: 0, y: 0, z: 0 };
  readonly stats: EnemyStats;

  state: 'alive' | 'dying' = 'alive';
  vx = 0;
  vz = 0;
  vy = 0;
  grounded = true;
  cool = 0;
  phase = 0;
  flashT = 0;
  flashHex = 0xffffff;
  deathT = 0;

  /**
   * The heading the mob actually faces. It turns at a limited rate, so a
   * grunt can be flanked — and its front plate only covers what it can see.
   */
  facingYaw = 0;

  /** Seconds left on a melee windup; 0 when it is not winding up. */
  windup = 0;
  /** How long this mob's windup lasts, for the swing animation. */
  private windupTotal = 0;

  /** Runner only: seconds left on the pounce, and on the recovery after it. */
  pounce = 0;
  recover = 0;
  pounceCd = 0;
  /** Runner only: seconds left on the crouch that telegraphs the pounce. */
  pounceTell = 0;

  /** Sapper only: seconds until the next bomb plant while fleeing. */
  panicT = 0;

  /** Sapper only: seconds left before the herd thins enough to make it charge. */
  sapperMode: 'lurk' | 'hunt' | 'flee' = 'lurk';

  /** Sapper only: seconds until the next plant, and its wander heading. */
  plantT = 0;
  wanderA = 0;

  /** Warden only: seconds to the next volley, the tell once it starts, and which way it circles. */
  volleyT = 0;
  volleyTell = 0;
  private strafe = 1;

  /** Distance of the nearest living neighbour at the last separation pass. */
  private reachPad: number = ENEMY.REACH_PAD;

  /** Current steering target; `pos`-shaped so routing never allocates. */
  private navX = 0;
  private navZ = 0;

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
    if (kind === 'warden') {
      this.volleyT = BOSS.FIRST_VOLLEY;
      this.strafe = rng.next() < 0.5 ? -1 : 1;
    }
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
    this.pounceCd = Math.max(0, this.pounceCd - dt);
    if (this.kind === 'sapper') this.updateSapper(dt, world);
    else if (this.kind === 'warden') this.updateWarden(dt, world);
    else this.updateChaser(dt, world);

    // It turns at a limited rate, so the player can get around its front plate.
    this.turnToward(world.playerPos, ENEMY.TURN_RATE[this.kind] * dt);

    this.flashT = Math.max(0, this.flashT - dt);
    this.phase += dt * (3 + this.stats.speed * 1.6);

    world.collide(this.pos, ENEMY.COLLIDE_RADIUS * this.scale, this.pos.y);
    this.followGround(dt, world);
    return false;
  }

  /** Turn toward a point, at most `maxStep` radians this step. */
  private turnToward(target: Vec2, maxStep: number): void {
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    let d = want - this.facingYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.facingYaw += Math.sign(d) * Math.min(Math.abs(d), maxStep);
  }

  /** 0..1 — how far through its windup the mob is. The view raises the arms. */
  get swingK(): number {
    if (this.windup <= 0 || this.windupTotal <= 0) return 0;
    return 1 - this.windup / this.windupTotal;
  }

  /** 0..1 — how lit the sapper's bomb rack is. It glows just before a plant. */
  get bombTell(): number {
    const left = this.sapperMode === 'flee' ? this.panicT : this.plantT;
    if (left > SAPPER.TELL || left <= 0) return 0;
    return 1 - left / SAPPER.TELL;
  }

  /** 0..1 — how lit the warden's racks are just before a volley. */
  get volleyK(): number {
    if (this.volleyTell <= 0) return 0;
    return 1 - this.volleyTell / BOSS.VOLLEY_TELL;
  }

  /** 0..1 — how far through its crouch the runner is, before it leaps. */
  get pounceK(): number {
    if (this.pounceTell <= 0) return 0;
    return 1 - this.pounceTell / RUNNER.POUNCE_TELL;
  }

  /** Bounce height and leg swing for this step. */
  get bounce(): number {
    return Math.abs(Math.sin(this.phase)) * ENEMY.BOUNCE;
  }

  get legSwing(): number {
    return Math.sin(this.phase) * ENEMY.LEG_SWING;
  }

  /** Chase and melee — grunt, runner and tank. */
  private updateChaser(dt: number, world: EnemyWorld): void {
    const dx = world.playerPos.x - this.pos.x;
    const dz = world.playerPos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (this.kind === 'runner') this.updatePounce(dt, dist);
    // The tank's slam has reach, so it starts its swing from further out.
    const reach = this.kind === 'tank' ? TANK.SLAM_R : this.reachPad;
    // Melee only works across a small height gap: an enemy at the foot of a
    // platform must not claw at someone standing on top of it.
    if (dist > reach || Math.abs(world.playerY - this.pos.y) > ENEMY.ATTACK_RISE) {
      this.pursue(dt, world, this.stats.speed * this.speedGain());
    } else {
      this.attack(dt, world);
    }
  }

  /**
   * The runner's pounce: a crouch to telegraph it, a burst of speed toward the
   * player, then a slow recovery that leaves it wide open.
   */
  private updatePounce(dt: number, dist: number): void {
    if (this.pounce > 0) {
      this.pounce -= dt;
      if (this.pounce <= 0) this.recover = RUNNER.RECOVER_T;
      return;
    }
    if (this.recover > 0) {
      this.recover = Math.max(0, this.recover - dt);
      return;
    }
    if (this.pounceTell > 0) {
      this.pounceTell -= dt;
      if (this.pounceTell <= 0) {
        this.pounce = RUNNER.POUNCE_T;
        this.pounceCd = RUNNER.POUNCE_COOLDOWN + RUNNER.POUNCE_T + RUNNER.RECOVER_T;
      }
      return;
    }
    if (this.pounceCd > 0) return;
    if (dist < RUNNER.POUNCE_MIN || dist > RUNNER.POUNCE_MAX) return;
    this.pounceTell = RUNNER.POUNCE_TELL;
  }

  /** Speed multiplier: pounce burst, recovery, or plain running. */
  private speedGain(): number {
    if (this.pounce > 0) return RUNNER.POUNCE_GAIN;
    if (this.recover > 0) return RUNNER.RECOVER_GAIN;
    return 1;
  }

  /**
   * The sapper. While the herd is healthy it keeps its distance and plants a
   * bomb every `PLANT_T` seconds — throwing one at the player from range, or
   * dropping one in its tracks up close. Once fewer than `HUNT_AT` hostiles
   * remain it abandons the bombs and charges. Wounded past the panic threshold
   * it runs instead, dropping bombs at its feet as it flees.
   */
  private updateSapper(dt: number, world: EnemyWorld): void {
    const dx = world.playerPos.x - this.pos.x;
    const dz = world.playerPos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const inv = 1 / (dist || 1);

    const wasFleeing = this.sapperMode === 'flee';
    if (this.stats.hp <= this.stats.maxHp * SAPPER.PANIC_HP) {
      this.sapperMode = 'flee';
    } else {
      this.sapperMode = world.hostileCount < SAPPER.HUNT_AT ? 'hunt' : 'lurk';
    }
    if (this.sapperMode === 'flee' && !wasFleeing) this.panicT = SAPPER.PANIC_PLANT_T;

    if (this.sapperMode === 'flee') {
      this.panicT -= dt;
      if (this.panicT <= 0) {
        this.panicT = SAPPER.PANIC_PLANT_T;
        world.plantBomb(this.pos, this.pos, false);
      }
      this.steer(dt, -dx * inv, -dz * inv, SAPPER.PANIC_SPEED, world);
      return;
    }

    if (this.sapperMode === 'hunt') {
      if (dist > this.reachPad || Math.abs(world.playerY - this.pos.y) > ENEMY.ATTACK_RISE) {
        this.pursue(dt, world, SAPPER.HUNT_SPEED);
      } else {
        this.attack(dt, world);
      }
      return;
    }

    // A player on a deck is out of melee reach, so the sapper lobs instead of
    // dropping at its feet: that bomb is what makes high ground a fight.
    const elevated = world.playerY - this.pos.y > ENEMY.ATTACK_RISE;
    this.plantT -= dt;
    if (this.plantT <= 0) {
      this.plantT = SAPPER.PLANT_T;
      const thrown = elevated || dist > SAPPER.THROW_DIST;
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

    if (dist <= this.reachPad && Math.abs(world.playerY - this.pos.y) <= ENEMY.ATTACK_RISE) {
      this.attack(dt, world);
    }
  }

  /**
   * The WARDEN. It refuses to close: inside a distance band it circles the
   * player and lobs rocket volleys on a timer, and it slams like a tank only
   * when something gets under its feet. A player on a deck is shelled like
   * any other mob besieging the ramp mouth — the rockets reach where it cannot.
   */
  private updateWarden(dt: number, world: EnemyWorld): void {
    const dx = world.playerPos.x - this.pos.x;
    const dz = world.playerPos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const inv = 1 / (dist || 1);

    // Up close it slams — its reach scales with its bulk.
    const slamReach = TANK.SLAM_R * this.scale;
    if (dist <= slamReach && Math.abs(world.playerY - this.pos.y) <= ENEMY.ATTACK_RISE) {
      this.attack(dt, world);
      return;
    }

    // A player on a deck is out of slam reach: besiege the ramp like the rest,
    // and keep the volley clock running — the rockets reach the deck.
    if (world.playerY - this.pos.y > ENEMY.ATTACK_RISE) {
      this.pursue(dt, world, this.stats.speed);
      this.tickVolley(dt, world);
      return;
    }

    // During the tell it plants its feet: the racks glow, then rockets walk a
    // ring around where the player stands — spread far enough that stepping
    // sideways dodges most of it.
    if (this.volleyTell > 0) {
      this.steer(dt, 0, 0, 0, world);
      this.tickVolley(dt, world);
      return;
    }
    this.tickVolley(dt, world);

    // Keep the band: close the gap, back off, or circle the player.
    let mx: number;
    let mz: number;
    if (dist > BOSS.KEEP_MAX) {
      mx = dx * inv;
      mz = dz * inv;
    } else if (dist < BOSS.KEEP_MIN) {
      mx = -dx * inv;
      mz = -dz * inv;
    } else {
      mx = -dz * inv * this.strafe;
      mz = dx * inv * this.strafe;
    }
    this.steer(dt, mx, mz, this.stats.speed, world);
  }

  /**
   * One step of the volley clock. The tell counts down first, then the racks
   * fire and reload — from every path, so a warden shelling a besieged deck
   * keeps its cadence too.
   */
  private tickVolley(dt: number, world: EnemyWorld): void {
    if (this.volleyTell > 0) {
      this.volleyTell -= dt;
      if (this.volleyTell <= 0) {
        this.volleyT = BOSS.VOLLEY_T;
        this.strafe *= -1;
        for (let i = 0; i < BOSS.VOLLEY_ROCKETS; i++) {
          const a = (i / BOSS.VOLLEY_ROCKETS) * Math.PI * 2 + this.phase;
          world.plantBomb(
            this.pos,
            {
              x: world.playerPos.x + Math.cos(a) * BOSS.ROCKET_SPREAD,
              z: world.playerPos.z + Math.sin(a) * BOSS.ROCKET_SPREAD,
            },
            true,
            true,
          );
        }
      }
      return;
    }
    this.volleyT -= dt;
    if (this.volleyT <= 0) this.volleyTell = BOSS.VOLLEY_TELL;
  }

  /**
   * Steer at the player — or, when they are up on a platform we cannot reach in
   * a straight line, at the mouth of the ramp that leads there and then up it.
   * Without this a mob just grinds against the platform wall forever.
   */
  private pursue(dt: number, world: EnemyWorld, speed: number): void {
    this.route(world);
    const dx = this.navX - this.pos.x;
    const dz = this.navZ - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      this.vx *= ENEMY.ARRIVE_DAMP;
      this.vz *= ENEMY.ARRIVE_DAMP;
      return;
    }
    this.steer(dt, dx / d, dz / d, speed, world);
  }

  /**
   * Pick the next steering target. High ground is melee-safe by design: mobs
   * never take the ramp. When the player is up on a deck they gather at that
   * deck's ramp mouth — the point the player has to come back down past — and
   * the sappers are what flush them off it.
   */
  private route(world: EnemyWorld): void {
    const px = world.playerPos.x;
    const pz = world.playerPos.z;
    this.navX = px;
    this.navZ = pz;

    // Same level (or the player is below us): walk straight at them.
    if (world.playerY - this.pos.y < ENEMY.CLIMB_RISE) return;

    const ramp = this.nearestRamp(world.ramps, px, pz);
    if (!ramp) return;

    // Lay siege to the bottom of the slope, never climb it.
    this.navX = rampMouthX(ramp);
    this.navZ = rampMouthZ(ramp);
  }

  /** The ramp whose top is nearest the player — i.e. the one onto their deck. */
  private nearestRamp(ramps: readonly Ramp[], px: number, pz: number): Ramp | undefined {
    let best: Ramp | undefined;
    let bestD = Number.POSITIVE_INFINITY;
    for (const ramp of ramps) {
      const dx = rampTopX(ramp) - px;
      const dz = rampTopZ(ramp) - pz;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = ramp;
      }
    }
    return best;
  }

  /**
   * Follow the walkable surface: ride up a ramp, fall off a ledge. Mirrors the
   * player's resolution, including the "stick to a slope" case so walking down
   * a ramp is a slide rather than a string of little drops.
   */
  private followGround(dt: number, world: EnemyWorld): void {
    const feetBefore = this.pos.y;
    const wasGrounded = this.grounded;

    this.vy -= WORLD.GRAVITY * dt;
    this.pos.y += this.vy * dt;

    const r = ENEMY.COLLIDE_RADIUS * this.scale;
    const ceiling = Math.max(this.pos.y + (wasGrounded ? ENEMY.STEP : 0), feetBefore);
    const support = world.support(this.pos.x, this.pos.z, r, ceiling);
    const stick = wasGrounded && this.vy <= 0 && this.pos.y - support <= ENEMY.STEP;
    if (this.vy <= 0 && (this.pos.y <= support + 1e-4 || stick)) {
      this.pos.y = support;
      this.vy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
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

  /**
   * A melee attack with a windup. The mob raises its arms — the view reads
   * `swingK` — and the blow lands at the end of it, so stepping out of reach
   * during the tell dodges the hit.
   */
  private attack(dt: number, world: EnemyWorld): void {
    this.vx *= ENEMY.ARRIVE_DAMP;
    this.vz *= ENEMY.ARRIVE_DAMP;
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) this.swing(world);
      return;
    }
    if (this.cool <= 0) {
      this.windup = this.windupLength();
      this.windupTotal = this.windup;
      this.cool = this.windup + ENEMY.ATTACK_COOLDOWN;
    }
  }

  /** How long this mob's tell runs before the blow lands. */
  private windupLength(): number {
    return this.kind === 'tank' || this.kind === 'warden' ? TANK.WINDUP : ENEMY.WINDUP;
  }

  /** The blow lands. Grunts swipe; the tank and the warden slam the ground. */
  private swing(world: EnemyWorld): void {
    this.flash(ENEMY.ATTACK_FLASH_COLOR, ENEMY.ATTACK_FLASH);
    const dx = world.playerPos.x - this.pos.x;
    const dz = world.playerPos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (this.kind === 'tank' || this.kind === 'warden') {
      // The warden's slam reach scales with its bulk.
      const reach = this.kind === 'warden' ? TANK.SLAM_R * this.scale : TANK.SLAM_R;
      if (dist > reach) return;
      world.damagePlayer(this.stats.dmg * TANK.SLAM_MULT);
      const inv = 1 / (dist || 1);
      world.knockPlayer(dx * inv, dz * inv, TANK.KNOCK);
      return;
    }
    if (dist > this.reachPad) return;
    world.damagePlayer(this.stats.dmg);
  }

  /**
   * Apply damage. Returns true if this shot killed it. `hit` says where the
   * hit came from, so a front plate can soak it.
   */
  takeDamage(amount: number, hit?: HitInfo): boolean {
    if (this.state !== 'alive') return false;
    this.stats.hp -= this.plateCut(amount, hit);
    this.flash(ENEMY.HIT_FLASH_COLOR, ENEMY.HIT_FLASH);
    return this.stats.hp <= 0;
  }

  /**
   * What the mob's armour does to a hit. The grunt's shield and the tank's
   * plate only cover the arc they are facing, a headshot goes over the top and
   * a blade goes under it. Explosions pass no hit, so they always land.
   */
  private plateCut(amount: number, hit: HitInfo | undefined): number {
    if (!hit || hit.melee || hit.headshot) return amount;
    const cut = this.kind === 'tank' ? TANK.ARMOUR_CUT : this.kind === 'grunt' ? ENEMY.SHIELD_CUT : 0;
    if (cut <= 0) return amount;
    // The shooter is in the direction the hit came from; the plate covers only
    // what the mob is looking at.
    const toShooter = Math.atan2(hit.dirX, hit.dirZ);
    let d = toShooter - this.facingYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > ENEMY.SHIELD_ARC) return amount;
    return amount * (1 - cut);
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
