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
  readonly position: Vec3 = { x: 0, y: WORLD.PLAYER_H, z: 0 };
  readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  grounded = true;
  jumpQueued = false;
  yaw = 0;
  pitch = 0;
  bobPhase = 0;
  /** Multiplier for mouse look; 1 = default WEAPON.SENS. */
  sens = 1;

  reset(): void {
    this.position.x = 0;
    this.position.y = WORLD.PLAYER_H;
    this.position.z = 0;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
    this.grounded = true;
    this.jumpQueued = false;
    this.yaw = 0;
    this.pitch = 0;
    this.bobPhase = 0;
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
    const speed = input.sprint ? WORLD.SPRINT : WORLD.WALK;

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

    this.velocity.y -= WORLD.GRAVITY * dt;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    if (this.position.y <= WORLD.PLAYER_H) {
      this.position.y = WORLD.PLAYER_H;
      this.velocity.y = 0;
      this.grounded = true;
    }

    collision.resolveCircle(this.position, WORLD.PLAYER_R);

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
