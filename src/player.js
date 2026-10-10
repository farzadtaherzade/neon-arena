import THREE from './three.js';
import { CAMERA, WEAPON, WORLD } from './config.js';

/**
 * Player movement and the camera rig.
 *
 * Owns its own position vector rather than mutating the rig's Object3D directly
 * — the original code aliased `pos` to `yawObj.position`, which hid the coupling.
 */
export class Player {
  constructor(yawObj, pitchObj) {
    this.yawObj = yawObj;
    this.pitchObj = pitchObj;
    this.position = new THREE.Vector3(0, WORLD.PLAYER_H, 0);
    this.velocity = new THREE.Vector3();
    this.grounded = true;
    this.jumpQueued = false;
    this.yaw = 0;
    this.pitch = 0;
    this.bobPhase = 0;
  }

  reset() {
    this.position.set(0, WORLD.PLAYER_H, 0);
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.jumpQueued = false;
    this.yaw = 0;
    this.pitch = 0;
    this.bobPhase = 0;
  }

  /** Apply mouse delta. Input only routes here while the pointer is locked. */
  look(dx, dy) {
    this.yaw -= dx * WEAPON.SENS;
    this.pitch -= dy * WEAPON.SENS;
    this.pitch = Math.max(-WORLD.PITCH_LIMIT, Math.min(WORLD.PITCH_LIMIT, this.pitch));
  }

  queueJump() {
    this.jumpQueued = true;
  }

  update(dt, input, collision) {
    const sprint = input.keys.ShiftLeft || input.keys.ShiftRight;
    const speed = sprint ? WORLD.SPRINT : WORLD.WALK;

    const f = (input.keys.KeyW ? 1 : 0) - (input.keys.KeyS ? 1 : 0);
    const r = (input.keys.KeyD ? 1 : 0) - (input.keys.KeyA ? 1 : 0);

    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);

    let mx = fx * f + rx * r;
    let mz = fz * f + rz * r;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }

    const k = 1 - Math.exp(-WORLD.MOVE_DAMP * dt);
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
  }

  /** True while actually moving on the ground — drives bob and crosshair. */
  get moving() {
    return Math.hypot(this.velocity.x, this.velocity.z) > 0.5 && this.grounded;
  }

  /**
   * Push orientation onto the rig. `recoil` comes from the weapon, `shakeT`
   * from the game's feedback timers, so neither needs to live here.
   */
  applyRig(recoil, shakeT) {
    this.yawObj.position.copy(this.position);
    this.yawObj.rotation.y = this.yaw;
    this.pitchObj.rotation.x = this.pitch + recoil + (shakeT > 0 ? (Math.random() - 0.5) * shakeT * CAMERA.SHAKE_PITCH : 0);
    this.pitchObj.rotation.y = shakeT > 0 ? (Math.random() - 0.5) * shakeT * CAMERA.SHAKE_YAW : 0;
    this.pitchObj.position.y = Math.sin(this.bobPhase * 2) * CAMERA.BOB_Y;
  }

  advanceBob(dt) {
    if (this.moving) {
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      this.bobPhase += dt * (CAMERA.BOB_SPEED_BASE + speed * CAMERA.BOB_SPEED_GAIN);
    }
  }

  /** Slow orbit used for the attract-mode background. */
  menuIdle(elapsed) {
    const a = elapsed * 0.08;
    this.position.set(Math.sin(a) * 19, 7.5, Math.cos(a) * 19);
    this.yawObj.rotation.y = a;
    this.pitchObj.rotation.x = -0.18;
  }
}