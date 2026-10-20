import type { Rng } from '../core/rng';
import { METEOR, WORLD } from './config';
import type { Vec2 } from './world/collision';

/**
 * The meteor shower: a random set-piece that bleeds the sky red and drops rocks
 * around the player.
 *
 * Pure — no three, no DOM. The shower owns the schedule and the falling stones;
 * `Game` applies the blasts and `render/MeteorView.ts` draws the rocks and
 * their ground markers.
 */

/** Height of the walkable surface at (x, z), supplied by the caller. */
export type GroundFn = (x: number, z: number) => number;

/** Is (x, z) inside geometry? A stone never lands there. */
export type BlockedFn = (x: number, z: number) => boolean;

export type ShowerPhase = 'dormant' | 'warning' | 'active';

/** One falling rock. */
export class Meteor {
  /** Current position — the view reads this every frame. */
  readonly pos: { x: number; y: number; z: number } = { x: 0, y: METEOR.SPAWN_Y, z: 0 };
  /** Where it will land, and where the ground marker sits. */
  readonly impact: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

  state: 'falling' | 'spent' = 'falling';
  private t = 0;

  constructor(
    x: number,
    z: number,
    impactY: number,
    readonly fallTime: number,
  ) {
    this.pos.x = x;
    this.pos.z = z;
    this.impact.x = x;
    this.impact.y = impactY;
    this.impact.z = z;
  }

  /** Fall progress, 0 at spawn and 1 at impact. */
  get k(): number {
    if (this.fallTime <= 0) return 1;
    return Math.min(1, this.t / this.fallTime);
  }

  /**
   * Advance one step. Returns true exactly once, on the frame the rock lands.
   */
  update(dt: number): boolean {
    if (this.state === 'spent') return false;
    this.t += dt;
    const k = this.k;
    this.pos.y = METEOR.SPAWN_Y + (this.impact.y - METEOR.SPAWN_Y) * k;
    if (k < 1) return false;
    this.state = 'spent';
    this.pos.y = this.impact.y;
    return true;
  }
}

/** What one shower step reported. The arrays are reused between steps. */
export interface ShowerUpdate {
  /** The shower just started warning. */
  started: boolean;
  /** The shower just ended. */
  ended: boolean;
  /** Stones that landed this step. */
  impacts: Meteor[];
}

export class MeteorShower {
  phase: ShowerPhase = 'dormant';
  /** 0 → normal sky, 1 → full storm. Read by `Arena.setSkyTint`. */
  tint = 0;
  /** Stones currently falling. */
  readonly stones: Meteor[] = [];

  private timer: number = METEOR.FIRST_DELAY;
  private phaseT = 0;
  private stoneT = 0;
  private readonly out: ShowerUpdate = { started: false, ended: false, impacts: [] };

  get active(): boolean {
    return this.phase === 'active';
  }

  /** Jump straight to the warning phase — used by the headless suite. */
  force(): void {
    if (this.phase === 'dormant') {
      this.phase = 'warning';
      this.phaseT = 0;
    }
  }

  /** Drop a stone on an exact spot. Used by the headless suite. */
  drop(x: number, z: number, groundY: number, rng: Rng): Meteor {
    const m = new Meteor(x, z, groundY, METEOR.FALL_T * rng.range(0.85, 1.15));
    this.stones.push(m);
    return m;
  }

  /**
   * One step of the schedule: run the phase machine, drop stones, and report
   * the ones that landed.
   */
  update(dt: number, player: Vec2, rng: Rng, ground: GroundFn, blocked: BlockedFn): ShowerUpdate {
    const out = this.out;
    out.started = false;
    out.ended = false;
    out.impacts.length = 0;

    if (this.phase === 'dormant') {
      this.tint = Math.max(0, this.tint - dt / METEOR.SKY_OUT);
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = 'warning';
        this.phaseT = 0;
        out.started = true;
      }
    } else if (this.phase === 'warning') {
      this.phaseT += dt;
      this.tint = Math.min(1, this.phaseT / METEOR.SKY_IN);
      if (this.phaseT >= METEOR.WARN_T) {
        this.phase = 'active';
        this.phaseT = 0;
        this.stoneT = 0.6;
      }
    } else {
      this.phaseT += dt;
      this.tint = 1;
      this.stoneT -= dt;
      if (this.stoneT <= 0) {
        this.spawn(player, rng, ground, blocked);
        this.stoneT = Math.max(
          0.12,
          METEOR.STONE_EVERY + rng.range(-METEOR.STONE_JITTER, METEOR.STONE_JITTER),
        );
      }
      if (this.phaseT >= METEOR.DURATION) {
        this.phase = 'dormant';
        this.phaseT = 0;
        this.timer = METEOR.DORMANT_MIN + rng.range(0, METEOR.DORMANT_SPAN);
        out.ended = true;
      }
    }

    for (let i = this.stones.length - 1; i >= 0; i--) {
      const m = this.stones[i];
      if (!m?.update(dt)) continue;
      out.impacts.push(m);
      this.stones.splice(i, 1);
    }

    return out;
  }

  reset(): void {
    this.phase = 'dormant';
    this.tint = 0;
    this.timer = METEOR.FIRST_DELAY;
    this.phaseT = 0;
    this.stoneT = 0;
    this.stones.length = 0;
    this.out.impacts.length = 0;
  }

  /** Aim at a ring around the player, skipping spots that are inside geometry. */
  private spawn(player: Vec2, rng: Rng, ground: GroundFn, blocked: BlockedFn): void {
    const limit = WORLD.HALF - WORLD.WALL_INSET - METEOR.CLEAR_R;
    for (let i = 0; i < METEOR.TARGET_ATTEMPTS; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(METEOR.TARGET_MIN, METEOR.TARGET_MAX);
      const x = player.x + Math.cos(a) * d;
      const z = player.z + Math.sin(a) * d;
      if (Math.abs(x) > limit || Math.abs(z) > limit) continue;
      if (blocked(x, z)) continue;
      this.stones.push(new Meteor(x, z, ground(x, z), METEOR.FALL_T * rng.range(0.85, 1.15)));
      return;
    }
  }
}
