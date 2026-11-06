import { Rng } from '../../core/rng';
import { CRAWL } from '../config';
import { PLATFORM_H } from './layout';

/**
 * Procedural chunk tables for the infinite crawl.
 *
 * A chunk is a pure function of `(cx, cz, seed)`: the same three numbers always
 * rebuild the same tables, so streaming can discard a chunk behind the player
 * without saving anything — walking back regenerates it exactly. The authored
 * arena is chunk (0,0) and contributes nothing here; its tables live in
 * `layout.ts` and are registered once at boot as region 0.
 *
 * The generation language is the authored maze's: scattered cover blocks in the
 * StructureKit's size range with generous lanes. The outer 3 units of every
 * chunk are kept clear of cover, so the world can never seal a route in.
 *
 * Roughly one wilds chunk in `CRAWL.DISTRICT_ONE_IN` is a **deck district**: a
 * capture deck with its ramp, a compound ring of tall slabs with two gaps as
 * gates, and (in the capture layer) a pad and alarm mast. Deck numbers match
 * the authored deck and ramp exactly, so every invariant that holds at spawn
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

export interface ChunkTables {
  cx: number;
  cz: number;
  /** Cover blocks in world coordinates: [x, z, w, h, d]. */
  cover: (readonly [number, number, number, number, number])[];
  /** Present only on deck-district chunks. */
  district?: DistrictTables;
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
 * Build the tables for one chunk. Same inputs, same outputs — forever.
 */
export function buildChunk(cx: number, cz: number, seed: number): ChunkTables {
  const rng = new Rng((coordHash(cx, cz) ^ seed) >>> 0);
  const half = CRAWL.CHUNK / 2;
  const ox = cx * CRAWL.CHUNK;
  const oz = cz * CRAWL.CHUNK;
  const tables: ChunkTables = { cx, cz, cover: [] };

  if (cx === 0 && cz === 0) return tables; // the authored arena stands alone

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
    tables.district = {
      deck: { x: dx, z: dz },
      ramp: { x: rampX, z: rampZ, upX: ux, upZ },
      compound,
    };
    return tables;
  }

  // A wilds chunk: scatter cover in the authored kit's size range, keeping the
  // outer 3 units clear and a walking gap between neighbours.
  const count = rng.int(10, 16);
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const w = rng.range(2, 12);
      const d = rng.range(2, 10);
      const h = rng.range(2.2, 4);
      const x = ox + rng.range(-half + CRAWL.DECK_CLEAR + w / 2, half - CRAWL.DECK_CLEAR - w / 2);
      const z = oz + rng.range(-half + CRAWL.DECK_CLEAR + d / 2, half - CRAWL.DECK_CLEAR - d / 2);
      let clear = true;
      for (const [bx, bz, bw, , bd] of tables.cover) {
        if (Math.abs(x - bx) < (w + bw) / 2 + 2.5 && Math.abs(z - bz) < (d + bd) / 2 + 2.5) {
          clear = false;
          break;
        }
      }
      if (clear) {
        tables.cover.push([x, z, w, h, d]);
        break;
      }
    }
  }
  return tables;
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
