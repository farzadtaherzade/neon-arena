import { Rng } from '../core/rng';
import {
  BLINKER,
  BOSS,
  CRAWL,
  CREEPER,
  DIRECTOR,
  ENEMY,
  SAPPER,
  WITCH,
  type EnemyKind,
} from './config';
import type { Vec2 } from './world/collision';

export interface SpawnRequest {
  kind: EnemyKind;
  x: number;
  z: number;
  /** Applied to the enemy's speed at spawn — this is the difficulty curve. */
  speedScale: number;
}

/** What one director step produced. Reused, not reallocated. */
export interface DirectorUpdate {
  spawned: SpawnRequest[];
  /** A calm beat just ended a lull: the caller heals, pays and resupplies. */
  beat: 'calm' | null;
}

interface Queued {
  kind: EnemyKind;
  delay: number;
  speedScale: number;
}

/** Per-kind pack membership: weight, budget cost, unlock tier, per-pack cap. */
const PACK_KINDS: readonly {
  kind: EnemyKind;
  weight: number;
  cost: number;
  from: number;
  every: number;
  cap: number;
}[] = [
  { kind: 'grunt', weight: 1, cost: 1, from: 0, every: 4, cap: 99 },
  { kind: 'runner', weight: 0.6, cost: 1.5, from: 2, every: 4, cap: 99 },
  { kind: 'tank', weight: 0.25, cost: 3, from: 3, every: 6, cap: 2 },
  { kind: 'creeper', weight: 0.3, cost: 1.5, from: CREEPER.START_TIER, every: CREEPER.EVERY_TIERS, cap: 3 },
  { kind: 'sapper', weight: 0.3, cost: 2, from: SAPPER.START_TIER, every: SAPPER.EVERY_TIERS, cap: 2 },
  { kind: 'witch', weight: 0.2, cost: 2.5, from: WITCH.START_TIER, every: WITCH.EVERY_TIERS, cap: WITCH.MAX_WITCHES },
  { kind: 'blinker', weight: 0.2, cost: 2, from: BLINKER.START_TIER, every: BLINKER.EVERY_TIERS, cap: 2 },
];

/** Speed multiplier for threat tier `n`, capped so late tiers stop outrunning the player. */
export const speedScale = (n: number): number =>
  Math.min(1 + (n - 1) * DIRECTOR.SPEED_GAIN, DIRECTOR.SPEED_MAX_SCALE);

/** Damage bonus for threat tier `n` — grows every other tier. */
export const dmgBonus = (n: number): number => Math.floor((n - 1) / 2) * DIRECTOR.DMG_PER_2_TIERS;

/**
 * How much nastier the world is `dist` chunk-units from the spawn plaza — the
 * directional crawl's difficulty curve. Capped so the far wilds stop scaling.
 */
export const distScale = (dist: number): number =>
  Math.min(1 + dist * DIRECTOR.DIST_GAIN, DIRECTOR.DIST_SCALE_MAX);

/** Chunk units from the spawn plaza to a world point. */
export const crawlDist = (x: number, z: number): number => Math.hypot(x, z) / CRAWL.CHUNK;

/**
 * The pressure director — the wave system's replacement.
 *
 * Pure — it emits `SpawnRequest`s and never builds an enemy, a mesh or a score.
 * There is no wave number and no round: `threat` rises with time-under-pressure
 * and never falls below a floor set by distance crawled; packs of mobs cost
 * budget that regenerates faster the higher the threat; packs enter the world
 * through district gates when one is near (supplied by `Game`) and otherwise
 * land as one directional arc cluster; and adaptive lulls — more likely when
 * `lowHp` says the player is battered — let the run breathe, ending in a calm
 * beat the caller pays out.
 */
export class PressureDirector {
  /** The tier counter — the old wave number's successor. */
  threat = 0;
  /** Seconds of spawn-silence left; > 0 only inside a lull. */
  lull = 0;
  /** Test mode spawns closer in and drops all pacing, so `update(0)` empties the queue. */
  testing = false;
  /** Injected so a test can pin the seed; gameplay uses the shared game RNG. */
  rng: Rng = new Rng(1);
  /**
   * Does this spot overlap arena geometry? Supplied by `Game` from the collision
   * world — a dense maze needs it, or packs materialise inside walls.
   */
  blocked: (x: number, z: number) => boolean = () => false;
  /** District gate mouths near the player, supplied fresh by `Game` each step. */
  gates: () => { x: number; z: number }[] = () => [];
  /** Where the player was last hit from — a third of pack arcs come from there. */
  lastHit: Vec2 | null = null;
  /** The adaptive-lull hint: battered players get calms more often. */
  lowHp = false;

  private queue: Queued[] = [];
  private out: DirectorUpdate = { spawned: [], beat: null };
  private budget: number = DIRECTOR.START_BUDGET;
  /** The smoothed crawl heading, radians. Tracked from the player's own motion. */
  private heading = 0;
  private hasHeading = false;
  private lastPx = 0;
  private lastPz = 0;
  /** Highest tier a warden beat has already fired for. */
  private lastWardenTier = 0;
  /** Pressure was live last step — the falling edge is where lulls roll. */
  private wasPressure = false;
  /** The gate the current pack entered through, when one was found. */
  private pendingGate: { x: number; z: number } | null = null;

  reset(): void {
    this.threat = 0;
    this.lull = 0;
    this.budget = DIRECTOR.START_BUDGET;
    this.queue.length = 0;
    this.hasHeading = false;
    this.lastPx = 0;
    this.lastPz = 0;
    this.lastWardenTier = 0;
    this.wasPressure = false;
    this.pendingGate = null;
  }

  /** Enemies still to come plus the ones already standing. */
  hostileCount(alive: number): number {
    return alive + this.queue.length;
  }

  /** A secured deck heats the world a little — pushing the objective costs. */
  nudge(): void {
    this.threat += DIRECTOR.CAPTURE_NUDGE;
  }

  /** E2E hook: jump to tier `n`, queue a pack, and a warden on the beat multiples. */
  forceThreat(n: number): void {
    this.threat = Math.max(this.threat, n);
    this.budget = Math.max(this.budget, DIRECTOR.PACK_MAX * 2);
    this.lastWardenTier = n - (n % BOSS.EVERY);
    if (n > 0 && n % BOSS.EVERY === 0) this.queuePack({ x: 0, z: 0 }, true);
    this.queuePack({ x: 0, z: 0 }, false);
  }

  /** One step: accrue threat and budget, release due spawns, roll lulls and beats. */
  update(dt: number, playerPos: Vec2, alive: number): DirectorUpdate {
    const out = this.out;
    out.spawned.length = 0;
    out.beat = null;

    // Track the crawl heading from the player's own motion: a low-pass over the
    // direction they have actually been travelling, so pack arcs lean into the
    // push without snapping when they weave between mobs.
    const mdx = playerPos.x - this.lastPx;
    const mdz = playerPos.z - this.lastPz;
    const moved = Math.hypot(mdx, mdz);
    this.lastPx = playerPos.x;
    this.lastPz = playerPos.z;
    if (moved > 0.02) {
      // Same angle convention as the spawn arcs: a = atan2(z, x).
      const want = Math.atan2(mdz, mdx);
      let d = want - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * Math.min(1, dt * 2);
      this.hasHeading = true;
    }

    // Threat only climbs under live pressure, and never below the crawl floor.
    const pressure = this.queue.length > 0 || alive > 0;
    if (pressure && this.lull <= 0) this.threat += dt / DIRECTOR.TIER_T;
    const floor = Math.floor(crawlDist(playerPos.x, playerPos.z)) * DIRECTOR.DIST_TIER_GAIN;
    if (floor > this.threat) this.threat = floor;
    this.checkWardenBeat(playerPos);

    // Budget regenerates always, double during a lull.
    const rate = DIRECTOR.BUDGET_RATE + Math.floor(this.threat) * DIRECTOR.RATE_GAIN;
    this.budget += dt * rate * (this.lull > 0 ? 2 : 1);

    if (this.lull > 0) {
      this.lull -= dt;
      if (this.lull <= 0) {
        this.lull = 0;
        out.beat = 'calm';
      }
    } else if (this.budget >= DIRECTOR.PACK_MIN) {
      // Only fire a pack when the field is not already crowded.
      if (alive + this.queue.length < DIRECTOR.PACK_MAX * 2 + Math.floor(this.threat)) {
        this.firePack(playerPos);
      }
    }

    for (let i = this.queue.length - 1; i >= 0; i--) {
      const s = this.queue[i];
      if (!s) continue;
      s.delay -= dt;
      if (s.delay > 0) continue;
      this.queue.splice(i, 1);
      const spot = this.pickSpawn(playerPos, this.pendingGate);
      out.spawned.push({ kind: s.kind, x: spot.x, z: spot.z, speedScale: s.speedScale });
      if (this.queue.length === 0) this.pendingGate = null;
    }

    // The falling edge of pressure — the last mob died and nothing is pending —
    // is where a lull may roll. Battered players get them more often.
    if (this.wasPressure && !pressure && this.lull <= 0) {
      const chance = DIRECTOR.LULL_BASE + (this.lowHp ? DIRECTOR.LULL_LOW_HP : 0);
      if (this.rng.next() < chance) this.lull = DIRECTOR.LULL_T;
    }
    this.wasPressure = pressure;

    return out;
  }

  /**
   * Queue one pack: roll its members by weight (tier-gated, capped), then find
   * its origin — a district gate when one is near, else a directional arc.
   */
  private firePack(playerPos: Vec2): void {
    const scale = speedScale(this.threat);
    const tier = Math.floor(this.threat);
    const size = Math.min(DIRECTOR.PACK_MAX, DIRECTOR.PACK_MIN + Math.floor(tier / 4));
    this.pendingGate = this.packOrigin(playerPos);
    const counts = new Map<EnemyKind, number>();
    for (let i = 0; i < size; i++) {
      const kind = this.rollKind(tier, counts);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      const cost = PACK_KINDS.find((k) => k.kind === kind)?.cost ?? 1;
      this.budget = Math.max(0, this.budget - cost);
      this.queue.push({ kind, delay: this.testing ? 0 : 0.4 + i * DIRECTOR.STAGGER, speedScale: scale });
    }
  }

  /** Weighted kind roll among kinds whose tier gate is open and cap not hit. */
  private rollKind(tier: number, counts: Map<EnemyKind, number>): EnemyKind {
    let total = 0;
    const eligible = PACK_KINDS.filter((k) => {
      if (tier < k.from) return false;
      if ((counts.get(k.kind) ?? 0) >= k.cap) return false;
      total += k.weight * Math.min(1 + (tier - k.from) / (k.every * 4), 2);
      return true;
    });
    let roll = this.rng.next() * (total || 1);
    for (const k of eligible) {
      const w = k.weight * Math.min(1 + (tier - k.from) / (k.every * 4), 2);
      if (roll < w) return k.kind;
      roll -= w;
    }
    return 'grunt';
  }

  /** The warden beat: entering a `BOSS.EVERY` multiple queues the boss pack. */
  private checkWardenBeat(playerPos: Vec2): void {
    const tier = Math.floor(this.threat);
    if (tier > 0 && tier % BOSS.EVERY === 0 && tier > this.lastWardenTier) {
      this.lastWardenTier = tier;
      this.queuePack(playerPos, true);
    }
  }

  /**
   * Queue the pack: the warden leads and the escort is thinned to every other
   * member, exactly like the old boss waves led their composition.
   */
  private queuePack(playerPos: Vec2, warden: boolean): void {
    const scale = speedScale(this.threat);
    const tier = Math.floor(this.threat);
    const size = Math.min(DIRECTOR.PACK_MAX, DIRECTOR.PACK_MIN + Math.floor(tier / 4));
    this.pendingGate = this.packOrigin(playerPos);
    const counts = new Map<EnemyKind, number>()
    const members: EnemyKind[] = [];
    const count = warden ? Math.ceil(size / 2) : size;
    for (let i = 0; i < count; i++) {
      const kind = this.rollKind(tier, counts);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      members.push(kind);
      if (!this.testing) this.budget = Math.max(0, this.budget - 1);
    }
    const list = warden ? ['warden' as EnemyKind, ...members] : members;
    list.forEach((kind, i) => {
      this.queue.push({ kind, delay: this.testing ? 0 : 0.4 + i * DIRECTOR.STAGGER, speedScale: scale });
    });
  }

  /**
   * A pack's origin: the nearest district gate mouth that is far enough from
   * the player and not inside cover — the world's own doors — else null and
   * the members fall back to a directional arc around the player.
   */
  private packOrigin(playerPos: Vec2): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const g of this.gates()) {
      const d = Math.hypot(g.x - playerPos.x, g.z - playerPos.z);
      if (d < ENEMY.SPAWN_MIN_DIST || d >= CRAWL.CHUNK * 1.5 || d >= bestD) continue;
      if (this.blocked(g.x, g.z)) continue;
      best = g;
      bestD = d;
    }
    return best;
  }

  /**
   * One member's spot. Gates are handled here too: when `packOrigin` found one,
   * the whole pack clusters just inside the mouth with tiny jitter; otherwise
   * a ring around the player, rejecting spots too close or inside cover. Most
   * arcs lean into the crawl heading, some into the last damage direction —
   * the fight comes from where the push or the hurt lives — the rest stay
   * uniform so behind you is never fully safe.
   */
  pickSpawn(playerPos: Vec2, gate: { x: number; z: number } | null = null): { x: number; z: number } {
    if (gate) {
      const a = this.rng.next() * Math.PI * 2;
      const r = this.rng.next() * 1.4;
      const x = gate.x + Math.cos(a) * r;
      const z = gate.z + Math.sin(a) * r;
      if (!this.blocked(x, z)) return { x, z };
      if (!this.blocked(gate.x, gate.z)) return { x: gate.x, z: gate.z };
    }
    const ring = this.testing ? ENEMY.TEST_SPAWN_RING : ENEMY.SPAWN_RING;
    const jitter = this.testing ? ENEMY.TEST_SPAWN_JITTER : ENEMY.SPAWN_RING_JITTER;

    for (let i = 0; i < ENEMY.SPAWN_ATTEMPTS; i++) {
      const roll = this.rng.next();
      const hitAngle =
        this.lastHit !== null ? Math.atan2(this.lastHit.z - playerPos.z, this.lastHit.x - playerPos.x) : 0;
      const a =
        this.lastHit !== null && roll < DIRECTOR.HIT_BIAS
          ? hitAngle + this.rng.range(-DIRECTOR.SPAWN_BIAS_ARC, DIRECTOR.SPAWN_BIAS_ARC)
          : this.hasHeading && roll < DIRECTOR.SPAWN_BIAS
            ? this.heading + this.rng.range(-DIRECTOR.SPAWN_BIAS_ARC, DIRECTOR.SPAWN_BIAS_ARC)
            : this.rng.next() * Math.PI * 2;
      const r = ring + this.rng.next() * jitter;
      // Player-relative: in an infinite world a ring around the origin would
      // drop packs hundreds of units behind the push.
      const x = playerPos.x + Math.cos(a) * r;
      const z = playerPos.z + Math.sin(a) * r;
      if (Math.hypot(x - playerPos.x, z - playerPos.z) <= ENEMY.SPAWN_MIN_DIST) continue;
      if (this.blocked(x, z)) continue;
      return { x, z };
    }
    // Player-relative: the world has no edge, so the fallback follows the push.
    return { x: playerPos.x + ENEMY.SPAWN_FALLBACK[0], z: playerPos.z + ENEMY.SPAWN_FALLBACK[1] };
  }
}
