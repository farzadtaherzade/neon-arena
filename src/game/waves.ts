import { Rng } from '../core/rng';
import { ENEMY, type EnemyKind, SAPPER, WAVES } from './config';
import type { Vec2 } from './world/collision';

export interface SpawnRequest {
  kind: EnemyKind;
  x: number;
  z: number;
  /** Applied to the enemy's speed at spawn — this is the difficulty curve. */
  speedScale: number;
}

/** What one director step produced. Reused, not reallocated. */
export interface WaveUpdate {
  spawned: SpawnRequest[];
  cleared: boolean;
}

interface Queued {
  kind: EnemyKind;
  delay: number;
  speedScale: number;
}

/** Enemy types for wave `n`, by count. */
export function composition(n: number): EnemyKind[] {
  const list: EnemyKind[] = [];
  for (let i = 0; i < WAVES.GRUNTS_BASE + n; i++) list.push('grunt');
  if (n >= WAVES.RUNNERS_FROM) {
    for (let i = 0; i < 1 + Math.floor(n * 0.8); i++) list.push('runner');
  }
  if (n >= WAVES.TANK_FROM) {
    const count = Math.min(1 + Math.floor((n - 2) / 2), WAVES.MAX_TANKS);
    for (let i = 0; i < count; i++) list.push('tank');
  }
  // Sappers arrive late and one extra joins every `EVERY_WAVES` waves after.
  if (n >= SAPPER.START_WAVE) {
    const count = 1 + Math.floor((n - SAPPER.START_WAVE) / SAPPER.EVERY_WAVES);
    for (let i = 0; i < count; i++) list.push('sapper');
  }
  return list;
}

/** Speed multiplier for wave `n`, capped so late waves stop outrunning the player. */
export const speedScale = (n: number): number =>
  Math.min(1 + (n - 1) * WAVES.SPEED_GAIN, WAVES.SPEED_MAX_SCALE);

/** Damage bonus for wave `n` — grows every other wave. */
export const dmgBonus = (n: number): number => Math.floor((n - 1) / 2) * WAVES.DMG_PER_2_WAVES;

/**
 * Wave composition, spawn pacing and the intermission between waves.
 *
 * Pure — it emits `SpawnRequest`s and never builds an enemy, a mesh or a score.
 * The caller turns a request into an `Enemy` plus its view, and reads `wave` for
 * the HP bonus.
 */
export class WaveDirector {
  wave = 0;
  intermission = 0;
  /** Test mode spawns closer in so the headless suite can actually fight. */
  testing = false;
  /** Injected so a test can pin the seed; gameplay uses the shared game RNG. */
  rng: Rng = new Rng(1);

  private queue: Queued[] = [];
  private out: WaveUpdate = { spawned: [], cleared: false };

  reset(): void {
    this.wave = 0;
    this.intermission = 0;
    this.queue.length = 0;
  }

  /** Enemies still to come plus the ones already standing. */
  hostileCount(alive: number): number {
    return alive + this.queue.length;
  }

  start(n: number): void {
    this.wave = n;
    const scale = speedScale(n);
    this.queue.length = 0;
    composition(n).forEach((kind, i) => {
      this.queue.push({ kind, delay: WAVES.FIRST_DELAY + i * WAVES.STAGGER, speedScale: scale });
    });
  }

  /** One step: release whoever is due to spawn, then decide if the wave is over. */
  update(dt: number, playerPos: Vec2, alive: number): WaveUpdate {
    const out = this.out;
    out.spawned.length = 0;
    out.cleared = false;

    for (let i = this.queue.length - 1; i >= 0; i--) {
      const s = this.queue[i]!;
      s.delay -= dt;
      if (s.delay > 0) continue;
      this.queue.splice(i, 1);
      const spot = this.pickSpawn(playerPos);
      out.spawned.push({ kind: s.kind, x: spot.x, z: spot.z, speedScale: s.speedScale });
    }

    // The wave only ends once the queue is empty *and* nothing is left standing.
    if (this.queue.length > 0 || alive > 0) {
      this.intermission = 0;
      return out;
    }

    if (this.intermission <= 0) {
      this.intermission = WAVES.INTERMISSION;
      out.cleared = true;
    }
    this.intermission -= dt;
    if (this.intermission <= 0) this.start(this.wave + 1);
    return out;
  }

  /** Ring around the player, rejecting spots that are too close. */
  pickSpawn(playerPos: Vec2): { x: number; z: number } {
    const ring = this.testing ? ENEMY.TEST_SPAWN_RING : ENEMY.SPAWN_RING;
    const jitter = this.testing ? ENEMY.TEST_SPAWN_JITTER : ENEMY.SPAWN_RING_JITTER;

    for (let i = 0; i < ENEMY.SPAWN_ATTEMPTS; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = ring + this.rng.next() * jitter;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.hypot(x - playerPos.x, z - playerPos.z) > ENEMY.SPAWN_MIN_DIST) return { x, z };
    }
    return { x: ENEMY.SPAWN_FALLBACK[0], z: ENEMY.SPAWN_FALLBACK[1] };
  }
}
