import { Rng } from '../core/rng';
import { BLINKER, BOSS, CRAWL, CREEPER, ENEMY, type EnemyKind, SAPPER, WAVES, WITCH } from './config';
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

/** True when wave `n` is a boss wave — the WARDEN walks in with a thin escort. */
export const isBossWave = (n: number): boolean => n > 0 && n % BOSS.EVERY === 0;

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
  // Creepers arrive early and grow steadily — the walking fuse is a fixture.
  if (n >= CREEPER.START_WAVE) {
    const count = 1 + Math.floor((n - CREEPER.START_WAVE) / CREEPER.EVERY_WAVES);
    for (let i = 0; i < count; i++) list.push('creeper');
  }
  // Witches arrive later, one extra every `EVERY_WAVES` waves, but capped —
  // two healers already warp a fight.
  if (n >= WITCH.START_WAVE) {
    const count = Math.min(1 + Math.floor((n - WITCH.START_WAVE) / WITCH.EVERY_WAVES), WITCH.MAX_WITCHES);
    for (let i = 0; i < count; i++) list.push('witch');
  }
  if (n >= BLINKER.START_WAVE) {
    const count = 1 + Math.floor((n - BLINKER.START_WAVE) / BLINKER.EVERY_WAVES);
    for (let i = 0; i < count; i++) list.push('blinker');
  }
  // On a boss wave the WARDEN is the wave: it leads, and the usual mob is
  // thinned to every other entry so the escort stays an escort.
  if (isBossWave(n)) {
    return ['warden', ...list.filter((_, i) => i % 2 === 1)];
  }
  return list;
}

/** Speed multiplier for wave `n`, capped so late waves stop outrunning the player. */
export const speedScale = (n: number): number =>
  Math.min(1 + (n - 1) * WAVES.SPEED_GAIN, WAVES.SPEED_MAX_SCALE);

/** Damage bonus for wave `n` — grows every other wave. */
export const dmgBonus = (n: number): number => Math.floor((n - 1) / 2) * WAVES.DMG_PER_2_WAVES;

/**
 * How much nastier the world is `dist` chunk-units from the spawn plaza — the
 * directional crawl's difficulty curve. Capped so the far wilds stop scaling.
 */
export const distScale = (dist: number): number => Math.min(1 + dist * WAVES.DIST_GAIN, WAVES.DIST_SCALE_MAX);

/** Chunk units from the spawn plaza to a world point. */
export const crawlDist = (x: number, z: number): number => Math.hypot(x, z) / CRAWL.CHUNK;

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
  /**
   * Does this spot overlap arena geometry? Supplied by `Game` from the collision
   * world — a dense maze needs it, or waves materialise inside walls.
   */
  blocked: (x: number, z: number) => boolean = () => false;

  private queue: Queued[] = [];
  private out: WaveUpdate = { spawned: [], cleared: false };
  /** The smoothed crawl heading, radians. Tracked from the player's own motion. */
  private heading = 0;
  private hasHeading = false;
  private lastPx = 0;
  private lastPz = 0;

  reset(): void {
    this.wave = 0;
    this.intermission = 0;
    this.queue.length = 0;
    this.hasHeading = false;
    this.lastPx = 0;
    this.lastPz = 0;
  }

  /** Enemies still to come plus the ones already standing. */
  hostileCount(alive: number): number {
    return alive + this.queue.length;
  }

  start(n: number): void {
    this.wave = n;
    const scale = speedScale(n);
    // Headless runs at a few frames per second under SwiftShader, so wall-clock
    // waits cannot be trusted to let a timed opening play out. Test mode drops
    // the pacing entirely; normal play keeps the designed first beat and stagger.
    const first = this.testing ? 0 : WAVES.FIRST_DELAY;
    const stagger = this.testing ? 0 : WAVES.STAGGER;
    this.queue.length = 0;
    composition(n).forEach((kind, i) => {
      this.queue.push({ kind, delay: first + i * stagger, speedScale: scale });
    });
  }

  /** One step: release whoever is due to spawn, then decide if the wave is over. */
  update(dt: number, playerPos: Vec2, alive: number): WaveUpdate {
    const out = this.out;
    out.spawned.length = 0;
    out.cleared = false;

    // Track the crawl heading from the player's own motion: a low-pass over the
    // direction they have actually been travelling, so the spawn ring leans
    // into the push without snapping when they weave between mobs.
    const mdx = playerPos.x - this.lastPx;
    const mdz = playerPos.z - this.lastPz;
    const moved = Math.hypot(mdx, mdz);
    this.lastPx = playerPos.x;
    this.lastPz = playerPos.z;
    if (moved > 0.02) {
      // Same angle convention as the spawn ring: a = atan2(z, x).
      const want = Math.atan2(mdz, mdx);
      let d = want - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * Math.min(1, dt * 2);
      this.hasHeading = true;
    }

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

  /**
   * Ring around the player, rejecting spots that are too close or inside cover.
   * Most angles lean into the crawl heading — the push direction is where the
   * fight lives — the rest stay uniform so behind you is never safe.
   */
  pickSpawn(playerPos: Vec2): { x: number; z: number } {
    const ring = this.testing ? ENEMY.TEST_SPAWN_RING : ENEMY.SPAWN_RING;
    const jitter = this.testing ? ENEMY.TEST_SPAWN_JITTER : ENEMY.SPAWN_RING_JITTER;

    for (let i = 0; i < ENEMY.SPAWN_ATTEMPTS; i++) {
      const a =
        this.hasHeading && this.rng.next() < WAVES.SPAWN_BIAS
          ? this.heading + this.rng.range(-WAVES.SPAWN_BIAS_ARC, WAVES.SPAWN_BIAS_ARC)
          : this.rng.next() * Math.PI * 2;
      const r = ring + this.rng.next() * jitter;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.hypot(x - playerPos.x, z - playerPos.z) <= ENEMY.SPAWN_MIN_DIST) continue;
      if (this.blocked(x, z)) continue;
      return { x, z };
    }
    // Player-relative: the world has no edge, so the fallback follows the push.
    return { x: playerPos.x + ENEMY.SPAWN_FALLBACK[0], z: playerPos.z + ENEMY.SPAWN_FALLBACK[1] };
  }
}
