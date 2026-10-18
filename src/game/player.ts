import { clamp, dampFactor } from '../core/math';
import { CAMERA, WEAPON, WORLD } from './config';
import type { CollisionWorld } from './world/collision';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** What the player can ask for on a given tick. */
export interface MoveInput {
  forward: number;
  right: number;
  sprint: boolean;
}

/**
 * Player movement, look angles and the bob phase.
 *
 * Pure: it owns a plain `{x, y, z}` and reads nothing but the numbers it is
 * handed. `render/PlayerRig.ts` is what pushes that onto the camera hierarchy.
 */
export class Player {
  readonly position: Vec3 = { x: WORLD.SPAWN_X, y: WORLD.PLAYER_H, z: WORLD.SPAWN_Z };
  readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  grounded = true;
  jumpQueued = false;
  yaw = 0;
  pitch = 0;
  bobPhase = 0;
  /** Multiplier for mouse look; 1 = default WEAPON.SENS. */
  sens = 1;

  /** Sprint fuel; when it hits zero sprint is locked off until it refills. */
  stamina: number = WORLD.STAMINA_MAX;
  private sprintLocked = false;

  reset(): void {
    this.position.x = WORLD.SPAWN_X;
    this.position.y = WORLD.PLAYER_H;
    this.position.z = WORLD.SPAWN_Z;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
    this.grounded = true;
    this.jumpQueued = false;
    this.yaw = 0;
    this.pitch = 0;
    this.bobPhase = 0;
    this.stamina = WORLD.STAMINA_MAX;
    this.sprintLocked = false;
  }

  /** Apply mouse delta. Input only routes here while the pointer is locked. */
  look(dx: number, dy: number, sens = this.sens): void {
    const lx = clamp(dx, -2048, 2048);
    const ly = clamp(dy, -2048, 2048);
    const s = WEAPON.SENS * sens;
    this.yaw -= lx * s;
    this.pitch -= ly * s;
    this.pitch = Math.max(-WORLD.PITCH_LIMIT, Math.min(WORLD.PITCH_LIMIT, this.pitch));
  }

  queueJump(): void {
    this.jumpQueued = true;
  }

  update(dt: number, input: MoveInput, collision: CollisionWorld): void {
    // Sprint only while there's stamina left, and lock it out once it empties.
    const movingNow = this.moving;
    if (input.sprint && movingNow && !this.sprintLocked) {
      this.stamina = Math.max(0, this.stamina - WORLD.STAMINA_DRAIN * dt);
    } else {
      this.stamina = Math.min(WORLD.STAMINA_MAX, this.stamina + WORLD.STAMINA_REGEN * dt);
    }
    if (this.stamina <= 0) this.sprintLocked = true;
    else if (this.stamina >= WORLD.STAMINA_UNLOCK) this.sprintLocked = false;
    const sprinting = input.sprint && movingNow && !this.sprintLocked;
    const speed = sprinting ? WORLD.SPRINT : WORLD.WALK;

    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);

    let mx = fx * input.forward + rx * input.right;
    let mz = fz * input.forward + rz * input.right;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }

    const k = dampFactor(WORLD.MOVE_DAMP, dt);
    this.velocity.x += (mx * speed - this.velocity.x) * k;
    this.velocity.z += (mz * speed - this.velocity.z) * k;

    if (this.jumpQueued && this.grounded) {
      this.velocity.y = WORLD.JUMP_V;
      this.grounded = false;
    }
    this.jumpQueued = false;

    // Feet height before this step's vertical move, so a falling player is
    // caught by a platform top they cross during the frame rather than phasing
    // through it.
    const feetBefore = this.position.y - WORLD.PLAYER_H;
    const wasGrounded = this.grounded;

    this.velocity.y -= WORLD.GRAVITY * dt;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    // Vertical support: stand on the highest surface underfoot reachable from
    // here — the arena floor (0) or a platform stepped/jumped/fallen onto. The
    // ceiling allows a `STEP_HEIGHT` walk-up while grounded, and always covers
    // the feet's travel this step so descent can't tunnel through.
    const feet = this.position.y - WORLD.PLAYER_H;
    const ceiling = Math.max(feet + (wasGrounded ? WORLD.STEP_HEIGHT : 0), feetBefore);
    const support = collision.groundHeight(this.position, WORLD.PLAYER_R, ceiling);
    const supportEye = support + WORLD.PLAYER_H;
    // Walking *down* a slope drops the surface a few centimetres per frame, which
    // would read as a series of little falls (and keep clearing `grounded`).
    // Stick to it while the drop is within a step; anything deeper is a real
    // ledge and gravity keeps it.
    const stick = wasGrounded && this.velocity.y <= 0 && this.position.y - supportEye <= WORLD.STEP_HEIGHT;
    if (this.velocity.y <= 0 && (this.position.y <= supportEye + 1e-4 || stick)) {
      this.position.y = supportEye;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // Horizontal collide, step-aware now that the feet are resolved: a low
    // enough top is walked onto rather than blocked.
    collision.resolveCircle(this.position, WORLD.PLAYER_R, {
      feetY: feet,
      step: this.grounded ? WORLD.STEP_HEIGHT : 0,
    });

    if (this.moving) {
      const sp = Math.hypot(this.velocity.x, this.velocity.z);
      this.bobPhase += dt * (CAMERA.BOB_SPEED_BASE + sp * CAMERA.BOB_SPEED_GAIN);
    }
  }

  /** True while actually moving on the ground — drives bob and crosshair. */
  get moving(): boolean {
    return Math.hypot(this.velocity.x, this.velocity.z) > 0.5 && this.grounded;
  }

  /** Slow orbit used for the attract-mode background. */
  menuPose(elapsed: number): { x: number; y: number; z: number; yaw: number; pitch: number } {
    const a = elapsed * 0.08;
    return { x: Math.sin(a) * 19, y: 7.5, z: Math.cos(a) * 19, yaw: a, pitch: -0.18 };
  }
}
