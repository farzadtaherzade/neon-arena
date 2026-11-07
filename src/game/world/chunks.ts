import { Rng } from '../../core/rng';
import { CRAWL, HOME, STAMPS, WORLD } from '../config';
import { DECK, DECK_EDGE, PLATFORM_H, REACTOR_SIZE, TOWER_CORNER, TOWER_SIZE } from './layout';

/**
 * Procedural chunk tables for the infinite crawl.
 *
 * A chunk is a pure function of `(cx, cz, seed)`: the same three numbers always
 * rebuild the same tables, so streaming can discard a chunk behind the player
 * without saving anything — walking back regenerates it exactly. Chunk (0,0) is
 * the **home arena**: generated here like any other chunk, with the maze cover
 * mirrored from one quadrant, the decks sliding on their mid-edges and the
 * landmarks wandering; `render/Arena.ts` builds it once at boot as region 0.
 *
 * The generation language is the authored maze's: scattered cover blocks in the
 * StructureKit's size range with generous lanes. The outer 3 units of every
 * chunk are kept clear of cover, so the world can never seal a route in.
 *
 * Roughly one wilds chunk in `CRAWL.DISTRICT_ONE_IN` is a **deck district**: a
 * capture deck with its ramp, a compound ring of tall slabs with two gaps as
 * gates, and (in the capture layer) a pad and alarm mast. Deck numbers match
 * the home deck and ramp exactly, so every invariant that holds at spawn
 * holds out in the wilds.
 */

export interface DistrictTables {
  /** Deck centre in world coordinates; the deck is 7×7 at `PLATFORM_H`. */
  deck: { x: number; z: number };
  /** One ramp onto the deck, authored numbers: 4.4 wide, 6 long. */
  ramp: { x: number; z: number; upX: number; upZ: number };
  /** The compound ring: tall slabs with two gaps as gates. */
  compound: (readonly [number, number, number, number, number])[];
}

/** One gatehouse deck and the single ramp that reaches it. */
export interface HomeDeck {
  deck: { x: number; z: number };
  ramp: { x: number; z: number; upX: number; upZ: number };
}

/** The home arena's rolled placement: four decks, the reactor, the tower. */
export interface HomeTables {
  /** One deck per mid-edge, in N/S/E/W order — pad ids `a0..a3` follow it. */
  decks: HomeDeck[];
  reactor: { x: number; z: number };
  tower: { x: number; z: number };
}

/** What the renderer builds the home arena from: cover, stamps and placement. */
export interface HomeWorld {
  cover: ChunkTables['cover'];
  stamps: StampTables[];
  tables: HomeTables;
}

export interface ChunkTables {
  cx: number;
  cz: number;
  /** Cover blocks in world coordinates: [x, z, w, h, d]. */
  cover: (readonly [number, number, number, number, number])[];
  /** Present only on deck-district chunks. */
  district?: DistrictTables;
  /** Present only on the home chunk (0,0). */
  home?: HomeTables;
  /** Multi-part structure silhouettes rolled alongside plain cover. */
  stamps?: StampTables[];
}

/** The stamp vocabulary — a kind, its centre, an orientation roll and its AABBs. */
export type StampKind = 'pillar' | 'arch' | 'lwall' | 'bridge' | 'tower' | 'barriers' | 'ruin';

export interface StampTables {
  kind: StampKind;
  /** Stamp centre in world coordinates. */
  at: { x: number; z: number };
  /** Rolled orientation: arch/bridge/barrier pick the span axis, lwall/ruin a flip. */
  variant: number;
  /** Every collider the stamp registers, in world coordinates: [x, z, w, h, d]. */
  boxes: (readonly [number, number, number, number, number])[];
}

/** Kinds the home maze may roll — arch and bridge stay wilds discoveries. */
export const HOME_STAMP_POOL = ['pillar', 'barriers', 'ruin', 'lwall'] as const;

/**
 * The single source for a stamp's colliders: `at` plus an orientation roll in,
 * world-space AABBs out. The renderer derives its proportions from these same
 * boxes, so mesh and collision cannot drift apart, and every height respects
 * `STAMPS.MIN_TOP` while pass-under parts clear `STAMPS.HEADROOM`.
 */
export function stampBoxes(kind: StampKind, at: { x: number; z: number }, variant: number): StampTables['boxes'] {
  const { x, z } = at;
  const t = STAMPS.HEADROOM;
  switch (kind) {
    case 'pillar':
      return [[x, z, 1.7, 4.6, 1.7]];
    case 'arch': {
      // Two legs `ARCH_GAP` apart; variant 1 rotates the gap 90°.
      const off = (STAMPS.ARCH_GAP + 1.1) / 2;
      return variant === 1
        ? [
            [x, z - off, 1.1, 4.2, 1.1],
            [x, z + off, 1.1, 4.2, 1.1],
          ]
        : [
            [x - off, z, 1.1, 4.2, 1.1],
            [x + off, z, 1.1, 4.2, 1.1],
          ];
    }
    case 'lwall':
      return variant === 1
        ? [
            [x - 1.65, z, 4.5, 2.6, 1.2],
            [x + 1.65, z - 1.65, 1.2, 2.6, 4.5],
          ]
        : [
            [x - 1.65, z, 4.5, 2.6, 1.2],
            [x + 1.65, z + 1.65, 1.2, 2.6, 4.5],
          ];
    case 'bridge': {
      // Four legs exactly `HEADROOM` tall — the slab they carry is mesh-only.
      return variant === 1
        ? [
            [x - 1.3, z - 2.6, 1.2, t, 1.2],
            [x - 1.3, z + 2.6, 1.2, t, 1.2],
            [x + 1.3, z - 2.6, 1.2, t, 1.2],
            [x + 1.3, z + 2.6, 1.2, t, 1.2],
          ]
        : [
            [x - 2.6, z - 1.3, 1.2, t, 1.2],
            [x - 2.6, z + 1.3, 1.2, t, 1.2],
            [x + 2.6, z - 1.3, 1.2, t, 1.2],
            [x + 2.6, z + 1.3, 1.2, t, 1.2],
          ];
    }
    case 'tower':
      return [[x, z, 3.4, 5.5, 3.4]];
    case 'barriers': {
      // 2 or 3 zigzag segments; variants 0/1 span x with 2/3, 2/3 span z.
      const n = variant >= 2 ? 3 : 2;
      const out: (readonly [number, number, number, number, number])[] = [];
      for (let i = 0; i < n; i++) {
        const along = (i - (n - 1) / 2) * 3.5;
        const lateral = i % 2 ? 0.9 : -0.9;
        out.push(
          variant % 2 === 1
            ? [x + lateral, z + along, 0.9, 2.4, 2.6]
            : [x + along, z + lateral, 2.6, 2.4, 0.9],
        );
      }
      return out;
    }
    case 'ruin':
      return variant === 1
        ? [
            [x + 1.5, z, 5, 2.6, 2.2],
            [x - 2.2, z - 1.2, 2.2, 3.4, 2.2],
          ]
        : [
            [x - 1.5, z, 5, 2.6, 2.2],
            [x + 2.2, z + 1.2, 2.2, 3.4, 2.2],
          ];
  }
}

const DECK_HALF = 3.5;
const RAMP_W = 4.4;
const RAMP_L = 6;

/** Stable per-coord hash — mulberry-style mix, no multiplication overflow. */
function coordHash(cx: number, cz: number): number {
  let h = (Math.imul(cx + 0x9e37, 0x85ebca6b) ^ Math.imul(cz + 0x27d4, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  h ^= h >>> 13;
  return h;
}

/** Which chunk a world coordinate falls in. */
export function chunkOf(x: number, z: number): { cx: number; cz: number } {
  return { cx: Math.floor(x / CRAWL.CHUNK), cz: Math.floor(z / CRAWL.CHUNK) };
}

/** Stable collision-region id for a chunk; 0 is the authored arena. */
export function chunkRegion(cx: number, cz: number): number {
  return 1 + (cx + 4096) * 8192 + (cz + 4096);
}

/** Is this coordinate pair a deck-district chunk? Pure, seed-aware. */
export function isDistrict(cx: number, cz: number, seed: number): boolean {
  if (cx === 0 && cz === 0) return false;
  // The first draw of the chunk's own rng stream — the same roll buildChunk
  // would make, so the two always agree.
  return new Rng((coordHash(cx, cz) ^ seed) >>> 0).next() < 1 / CRAWL.DISTRICT_ONE_IN;
}

/**
 * Roll the home arena directly — what the renderer builds from, with the
 * placement non-optional. Same roll `buildChunk(0, 0, seed)` makes.
 */
export function buildHome(seed: number): HomeWorld {
  return buildHomeRng(new Rng((coordHash(0, 0) ^ seed) >>> 0));
}

/** Padded 2D box overlap — the shape every clearance check here speaks. */
function overlaps(
  x: number,
  z: number,
  w: number,
  d: number,
  px: number,
  pz: number,
  pw: number,
  pd: number,
  pad: number,
): boolean {
  return Math.abs(x - px) < (w + pw) / 2 + pad && Math.abs(z - pz) < (d + pd) / 2 + pad;
}

/**
 * Roll the home arena: four decks sliding on their mid-edges, the reactor and
 * clock tower wandering, and one quadrant of cover mirrored four ways.
 *
 * The draw order is load-bearing — decks, reactor, tower, then cover — because
 * it defines every seed's layout and the E2E's boot pin. The deck's radial
 * position is fixed, so the walkable lane between deck and world edge survives
 * every roll, and a cover candidate is dropped whole (all four mirrors) if any
 * mirror would touch a protected footprint, so the maze stays symmetric while
 * every anchor stays clear.
 */
function buildHomeRng(rng: Rng): { cover: ChunkTables['cover']; stamps: StampTables[]; tables: HomeTables } {
  // N, S, E, W: uphill points at the deck, so the ramp centre is the deck
  // centre pulled one ramp length toward the arena.
  const decks: HomeDeck[] = [];
  for (const [ux, uz] of [
    [0, -1],
    [0, 1],
    [1, 0],
    [-1, 0],
  ] as const) {
    const slide = rng.range(-HOME.DECK_SLIDE, HOME.DECK_SLIDE);
    const dx = ux !== 0 ? DECK_EDGE * ux : slide;
    const dz = uz !== 0 ? DECK_EDGE * uz : slide;
    const off = DECK_HALF + RAMP_L / 2;
    decks.push({ deck: { x: dx, z: dz }, ramp: { x: dx - ux * off, z: dz - uz * off, upX: ux, upZ: uz } });
  }

  // The reactor wanders near the centre but never onto the spawn plaza.
  let reactorX = 0;
  let reactorZ = 0;
  do {
    reactorX = rng.range(-HOME.REACTOR_RANGE, HOME.REACTOR_RANGE);
    reactorZ = rng.range(-HOME.REACTOR_RANGE, HOME.REACTOR_RANGE);
  } while (
    overlaps(
      reactorX,
      reactorZ,
      REACTOR_SIZE.w,
      REACTOR_SIZE.d,
      WORLD.SPAWN_X,
      WORLD.SPAWN_Z,
      10,
      10,
      HOME.PROTECTED_PAD,
    )
  );

  // The tower picks a corner and keeps the classic offset inside it.
  const corner = rng.int(0, 3);
  const towerX = (corner % 2 === 0 ? -1 : 1) * TOWER_CORNER;
  const towerZ = (corner < 2 ? -1 : 1) * TOWER_CORNER;

  const protectedBoxes: (readonly [number, number, number, number])[] = [
    ...decks.map((d) => [d.deck.x, d.deck.z, DECK.w, DECK.d] as const),
    ...decks.map(
      (d) =>
        [d.ramp.x, d.ramp.z, d.ramp.upX !== 0 ? RAMP_L : RAMP_W, d.ramp.upZ !== 0 ? RAMP_L : RAMP_W] as const,
    ),
    [reactorX, reactorZ, REACTOR_SIZE.w, REACTOR_SIZE.d] as const,
    [towerX, towerZ, TOWER_SIZE.w, TOWER_SIZE.d] as const,
    [WORLD.SPAWN_X, WORLD.SPAWN_Z, 10, 10] as const,
  ];

  // One quadrant, wilds-style sizing, mirrored four ways. Blocks stay off the
  // mirror axes by half their width plus 1.25, so twins across an axis always
  // keep the same 2.5 walking lane the wilds keep between neighbours. Each
  // quadrant also rolls 1–2 structure stamps from the home pool — same mirror,
  // same protected drop — and gives up that many plain blocks to keep density
  // near today's.
  const half = CRAWL.CHUNK / 2;
  const cover: ChunkTables['cover'] = [];
  const stamps: StampTables[] = [];
  const stampCount = rng.int(STAMPS.HOME_STAMPS_MIN, STAMPS.HOME_STAMPS_MAX);
  for (let s = 0; s < stampCount; s++) {
    const roll = rng.next();
    const kind: StampKind =
      roll < 0.3 ? 'pillar' : roll < 0.6 ? 'barriers' : roll < 0.8 ? 'ruin' : 'lwall';
    const variant = rng.int(0, stampVariants(kind) - 1);
    for (let attempt = 0; attempt < 24; attempt++) {
      const qx = -rng.range(5, half - CRAWL.DECK_CLEAR - 5);
      const qz = -rng.range(5, half - CRAWL.DECK_CLEAR - 5);
      const mirrored: { at: { x: number; z: number }; boxes: StampTables['boxes'] }[] = [];
      let clear = true;
      for (const [mx, mz] of [
        [qx, qz],
        [-qx, qz],
        [qx, -qz],
        [-qx, -qz],
      ] as const) {
        const boxes = stampBoxes(kind, { x: mx, z: mz }, variant);
        for (const [bx, bz, bw, , bd] of boxes) {
          if (
            Math.abs(bx) - bw / 2 < 1.25 - 0.001 ||
            Math.abs(bz) - bd / 2 < 1.25 - 0.001 ||
            Math.abs(bx) + bw / 2 > half - CRAWL.DECK_CLEAR + 0.001 ||
            Math.abs(bz) + bd / 2 > half - CRAWL.DECK_CLEAR + 0.001
          ) {
            clear = false;
            break;
          }
          for (const [px, pz, pw, pd] of protectedBoxes) {
            if (overlaps(bx, bz, bw, bd, px, pz, pw, pd, HOME.PROTECTED_PAD)) {
              clear = false;
              break;
            }
          }
          if (!clear) break;
          for (const [cx2, cz2, cw2, , cd2] of cover) {
            if (overlaps(bx, bz, bw, bd, cx2, cz2, cw2, cd2, 2.5)) {
              clear = false;
              break;
            }
          }
          if (!clear) break;
          for (const st of stamps) {
            for (const [bx2, bz2, bw2, , bd2] of st.boxes) {
              if (overlaps(bx, bz, bw, bd, bx2, bz2, bw2, bd2, 2.5)) {
                clear = false;
                break;
              }
            }
            if (!clear) break;
          }
          if (!clear) break;
        }
        if (!clear) break;
        mirrored.push({ at: { x: mx, z: mz }, boxes });
      }
      if (clear) {
        stamps.push(...mirrored.map((m) => ({ kind, at: m.at, variant, boxes: m.boxes })));
        break;
      }
    }
  }
  const count = Math.max(3, rng.int(HOME.COVER_MIN, HOME.COVER_MAX) - stampCount);
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const w = rng.range(2, 12);
      const d = rng.range(2, 10);
      const h = rng.range(2.2, 4);
      const x = -rng.range(w / 2 + 1.25, half - CRAWL.DECK_CLEAR - w / 2);
      const z = -rng.range(d / 2 + 1.25, half - CRAWL.DECK_CLEAR - d / 2);
      let clear = true;
      for (const [bx, bz, bw, , bd] of cover) {
        if (overlaps(x, z, w, d, bx, bz, bw, bd, 2.5)) {
          clear = false;
          break;
        }
      }
      if (clear) {
        for (const [mx, mz] of [
          [x, z],
          [-x, z],
          [x, -z],
          [-x, -z],
        ] as const) {
          for (const [px, pz, pw, pd] of protectedBoxes) {
            if (overlaps(mx, mz, w, d, px, pz, pw, pd, HOME.PROTECTED_PAD)) {
              clear = false;
              break;
            }
          }
          if (!clear) break;
          for (const st of stamps) {
            for (const [bx, bz, bw, , bd] of st.boxes) {
              if (overlaps(mx, mz, w, d, bx, bz, bw, bd, 2.5)) {
                clear = false;
                break;
              }
            }
            if (!clear) break;
          }
          if (!clear) break;
        }
      }
      if (clear) {
        cover.push([x, z, w, h, d], [-x, z, w, h, d], [x, -z, w, h, d], [-x, -z, w, h, d]);
        break;
      }
    }
  }

  return { cover, stamps, tables: { decks, reactor: { x: reactorX, z: reactorZ }, tower: { x: towerX, z: towerZ } } };
}

/**
 * Build the tables for one chunk. Same inputs, same outputs — forever.
 */
export function buildChunk(cx: number, cz: number, seed: number): ChunkTables {
  const rng = new Rng((coordHash(cx, cz) ^ seed) >>> 0);
  const half = CRAWL.CHUNK / 2;
  const ox = cx * CRAWL.CHUNK;
  const oz = cz * CRAWL.CHUNK;
  const tables: ChunkTables = { cx, cz, cover: [] };

  // The home arena is generated like any other chunk — same rng stream, fixed
  // draw order — but never rolls a district: it carries its own four decks.
  if (cx === 0 && cz === 0) {
    const home = buildHomeRng(rng);
    return { cx, cz, cover: home.cover, stamps: home.stamps, home: home.tables };
  }

  if (isDistrict(cx, cz, seed)) {
    // The deck and its compound stay clear of the border lanes and of each
    // other; the ring keeps two gaps so the compound reads as enterable.
    const dx = ox + rng.range(-half + 19, half - 19);
    const dz = oz + rng.range(-half + 19, half - 19);
    const upX = rng.next() < 0.5 ? 1 : -1;
    const vertical = rng.next() < 0.5;
    const upZ = vertical ? (rng.next() < 0.5 ? 1 : -1) : 0;
    const ux = vertical ? 0 : upX;
    const rampX = dx - ux * (DECK_HALF + RAMP_L / 2);
    const rampZ = dz - upZ * (DECK_HALF + RAMP_L / 2);
    const compound: (readonly [number, number, number, number, number])[] = [];
    // The ring keeps its gates: every slot facing the ramp approach stays open
    // (the ramp must stay reachable), plus one more seeded gap.
    const outAngle = Math.atan2(-upZ, -ux);
    const skipA = rng.int(0, 5);
    for (let slot = 0; slot < 6; slot++) {
      const a = (slot / 6) * Math.PI * 2 + rng.range(-0.12, 0.12);
      let d = Math.abs(a - outAngle);
      while (d > Math.PI) d = Math.abs(d - Math.PI * 2);
      if (d < 0.96) continue; // the gate the ramp walks through
      if (slot === skipA) continue; // the second, seeded gate
      const r = rng.range(11, 13);
      const w = rng.range(4, 5.5);
      const h = rng.range(4, 4.6);
      const dd = rng.range(1.6, 2.2);
      // Axis-aligned slabs only — the collider world speaks AABB.
      const along = slot % 2 === 0;
      compound.push([dx + Math.cos(a) * r, dz + Math.sin(a) * r, along ? w : dd, h, along ? dd : w]);
    }
    // Up to two ring slabs become pillar stamps — variety, same slot.
    let swapped = 0;
    for (let i = compound.length - 1; i >= 0 && swapped < 2; i--) {
      const slab = compound[i];
      if (!slab || rng.next() >= 0.45) continue;
      const [sx, sz] = slab;
      compound.splice(i, 1);
      tables.stamps = tables.stamps ?? [];
      tables.stamps.push({
        kind: 'pillar',
        at: { x: sx, z: sz },
        variant: 0,
        boxes: stampBoxes('pillar', { x: sx, z: sz }, 0),
      });
      swapped++;
    }
    tables.district = {
      deck: { x: dx, z: dz },
      ramp: { x: rampX, z: rampZ, upX: ux, upZ },
      compound,
    };
    return tables;
  }

  // A wilds chunk: scatter cover in the authored kit's size range, keeping the
  // outer 3 units clear and a walking gap between neighbours. Roughly one slot
  // in STAMPS.WILDS_ONE_IN is a structure stamp instead of a plain block.
  const count = rng.int(10, 16);
  for (let i = 0; i < count; i++) {
    if (rng.next() < 1 / STAMPS.WILDS_ONE_IN) {
      if (rollWildStamp(rng, tables, ox, oz, half)) continue;
      // No room found — fall through and place a plain block instead.
    }
    for (let attempt = 0; attempt < 24; attempt++) {
      const w = rng.range(2, 12);
      const d = rng.range(2, 10);
      const h = rng.range(2.2, 4);
      const x = ox + rng.range(-half + CRAWL.DECK_CLEAR + w / 2, half - CRAWL.DECK_CLEAR - w / 2);
      const z = oz + rng.range(-half + CRAWL.DECK_CLEAR + d / 2, half - CRAWL.DECK_CLEAR - d / 2);
      let clear = true;
      for (const [bx, bz, bw, , bd] of tables.cover) {
        if (overlaps(x, z, w, d, bx, bz, bw, bd, 2.5)) {
          clear = false;
          break;
        }
      }
      if (clear) clear = stampFits([[x, z, w, h, d]], tables, ox, oz, half);
      if (clear) {
        tables.cover.push([x, z, w, h, d]);
        break;
      }
    }
  }
  return tables;
}

/** Wilds stamp kinds and their weights, in draw order. */
/** Wilds stamp kinds and their weights, in draw order. */
export const WILDS_STAMP_KINDS: readonly (readonly [StampKind, number])[] = [
  ['pillar', 0.25],
  ['arch', 0.2],
  ['barriers', 0.2],
  ['lwall', 0.12],
  ['ruin', 0.1],
  ['tower', 0.07],
  ['bridge', 0.06],
];

/** The kinds a wilds chunk may roll, for tests and the map. */
export const WILDS_STAMP_KIND_NAMES = WILDS_STAMP_KINDS.map(([k]) => k);

/** How many orientation variants a kind rolls through. */
function stampVariants(kind: StampKind): number {
  return kind === 'barriers' ? 4 : kind === 'pillar' || kind === 'tower' ? 1 : 2;
}

/**
 * Place one wilds stamp: roll a kind, then hunt for a centre whose boxes clear
 * the border lanes and every placed box (cover and stamps alike) by the 2.5
 * walking gap. Returns false when no room was found in 24 attempts.
 */
function rollWildStamp(rng: Rng, tables: ChunkTables, ox: number, oz: number, half: number): boolean {
  let roll = rng.next();
  let kind: StampKind = WILDS_STAMP_KINDS[WILDS_STAMP_KINDS.length - 1]?.[0] ?? 'pillar';
  for (const [k, weight] of WILDS_STAMP_KINDS) {
    if (roll < weight) {
      kind = k;
      break;
    }
    roll -= weight;
  }
  const variant = rng.int(0, stampVariants(kind) - 1);
  for (let attempt = 0; attempt < 24; attempt++) {
    const ax = ox + rng.range(-half + 8, half - 8);
    const az = oz + rng.range(-half + 8, half - 8);
    const world = stampBoxes(kind, { x: ax, z: az }, variant);
    if (stampFits(world, tables, ox, oz, half)) {
      tables.stamps = tables.stamps ?? [];
      tables.stamps.push({ kind, at: { x: ax, z: az }, variant, boxes: world });
      return true;
    }
  }
  return false;
}

/** Do these stamp boxes clear the border lanes and every placed box? */
function stampFits(
  world: StampTables['boxes'],
  tables: ChunkTables,
  ox: number,
  oz: number,
  half: number,
): boolean {
  for (const [x, z, w, , d] of world) {
    if (
      x - w / 2 < ox - half + CRAWL.DECK_CLEAR ||
      x + w / 2 > ox + half - CRAWL.DECK_CLEAR ||
      z - d / 2 < oz - half + CRAWL.DECK_CLEAR ||
      z + d / 2 > oz + half - CRAWL.DECK_CLEAR
    ) {
      return false;
    }
    for (const [bx, bz, bw, , bd] of tables.cover) {
      if (overlaps(x, z, w, d, bx, bz, bw, bd, 2.5)) return false;
    }
    for (const s of tables.stamps ?? []) {
      for (const [bx, bz, bw, , bd] of s.boxes) {
        if (overlaps(x, z, w, d, bx, bz, bw, bd, 2.5)) return false;
      }
    }
  }
  return true;
}

/** The authored ramp's numbers, for tests that re-assert the district contract. */
export const DISTRICT_RAMP = { width: RAMP_W, length: RAMP_L, highY: PLATFORM_H } as const;

/** Half the loaded square's world extent at the player's chunk — for the clamp. */
export function loadedHalf(): number {
  return CRAWL.VIEW_RADIUS * CRAWL.CHUNK;
}

/** The player-clamp bounds of the loaded square around a chunk coordinate. */
export function loadedBounds(
  cx: number,
  cz: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const b = loadedHalf() - CRAWL.CLAMP_INSET;
  return {
    minX: cx * CRAWL.CHUNK - b,
    maxX: cx * CRAWL.CHUNK + b,
    minZ: cz * CRAWL.CHUNK - b,
    maxZ: cz * CRAWL.CHUNK + b,
  };
}
