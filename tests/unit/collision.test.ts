import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { HOME, WORLD } from '../../src/game/config';
import { buildHome, DISTRICT_RAMP } from '../../src/game/world/chunks';
import { type Aabb, CollisionWorld, type Ramp, rampHeight } from '../../src/game/world/collision';
import {
  DECK,
  DECK_EDGE,
  PLATFORM_H,
  REACTOR_SIZE,
  rampRotation,
  starfieldPositions,
  TOWER_SIZE,
} from '../../src/game/world/layout';

const BOX: Aabb = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };

/** Several seeds: the layout invariants must hold for every roll, not one. */
const SEEDS = [20261101, 1, 7, 42, 20261102];

/** Same conversion `render/Arena.ts` does when it builds each mesh. */
function deckBoxes(home: ReturnType<typeof buildHome>): Aabb[] {
  return home.tables.decks.map(({ deck }) => ({
    minX: deck.x - DECK.w / 2,
    maxX: deck.x + DECK.w / 2,
    minZ: deck.z - DECK.d / 2,
    maxZ: deck.z + DECK.d / 2,
  }));
}

function rampBoxes(home: ReturnType<typeof buildHome>): Ramp[] {
  return home.tables.decks.map(({ ramp }) => {
    const spanX = ramp.upX !== 0 ? DISTRICT_RAMP.length : DISTRICT_RAMP.width;
    const spanZ = ramp.upZ !== 0 ? DISTRICT_RAMP.length : DISTRICT_RAMP.width;
    return {
      minX: ramp.x - spanX / 2,
      maxX: ramp.x + spanX / 2,
      minZ: ramp.z - spanZ / 2,
      maxZ: ramp.z + spanZ / 2,
      lowY: 0,
      highY: PLATFORM_H,
      upX: ramp.upX,
      upZ: ramp.upZ,
    };
  });
}

describe('CollisionWorld.resolveCircle', () => {
  it('leaves a circle far outside every collider alone — the world has no edge', () => {
    const w = new CollisionWorld();
    const p = { x: 999, z: -999 };
    w.resolveCircle(p, WORLD.PLAYER_R);
    expect(p).toEqual({ x: 999, z: -999 });
  });

  it('retracts a region: removing a chunk takes its colliders out of every query', () => {
    const w = new CollisionWorld();
    w.addObstacle({ minX: 4, maxX: 6, minZ: -1, maxZ: 1 }, 3, 7);
    w.addRamp({ minX: 10, maxX: 12, minZ: -1, maxZ: 1, lowY: 0, highY: 2, upX: 1, upZ: 0 }, 7);
    const inside = { x: 5, z: 0 };
    w.resolveCircle(inside, 0.45);
    expect(inside.x).toBeLessThan(4); // pushed out while the region is loaded

    w.removeRegion(7);
    const freed = { x: 5, z: 0 };
    w.resolveCircle(freed, 0.45);
    expect(freed).toEqual({ x: 5, z: 0 }); // nothing left to push against
    expect(w.obstacles).toHaveLength(0);
    expect(w.ramps).toHaveLength(0);
    // The authored region survives a chunk unload.
    w.addObstacle({ minX: 4, maxX: 6, minZ: -1, maxZ: 1 }, 3, 0);
    w.removeRegion(7);
    expect(w.obstacles).toHaveLength(1);
  });

  it('leaves a circle that touches nothing alone', () => {
    const w = new CollisionWorld();
    const p = { x: 5, z: -7 };
    w.resolveCircle(p, 0.45);
    expect(p).toEqual({ x: 5, z: -7 });
  });

  it('pushes a circle out of an obstacle face', () => {
    const w = new CollisionWorld();
    w.addObstacle(BOX);
    const r = 0.45;
    const p = { x: 0, z: 2.2 }; // 0.2 inside the +Z face
    w.resolveCircle(p, r);
    expect(p.z).toBeCloseTo(2 + r, 10);
    expect(p.x).toBeCloseTo(0, 10);
  });

  it('resolves a corner on the diagonal', () => {
    const w = new CollisionWorld();
    w.addObstacle(BOX);
    const p = { x: 2.2, z: 2.2 };
    w.resolveCircle(p, 0.45);
    // Distance from the box corner to the point grows to exactly r.
    expect(Math.hypot(p.x - 2, p.z - 2)).toBeCloseTo(0.45, 10);
  });

  it('ejects a circle whose centre is inside the box', () => {
    const w = new CollisionWorld();
    w.addObstacle(BOX);
    const p = { x: 0, z: 0 };
    w.resolveCircle(p, 0.45);
    // All four faces are equidistant; the tie breaks to the left one, which is outside the box.
    expect(p.x).toBeCloseTo(-2 - 0.45, 10);
    expect(p.z).toBeCloseTo(0, 10);
  });

  it('uses the nearest face when embedded deep in a wide box', () => {
    const w = new CollisionWorld();
    w.addObstacle({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 });
    const p = { x: 0, z: 0 };
    w.resolveCircle(p, 0.45);
    expect(p.x).toBeCloseTo(-10 - 0.45, 10);
  });

  it('lets a low step be walked onto when a step context is supplied', () => {
    const w = new CollisionWorld();
    w.addObstacle(BOX, 0.4);
    const p = { x: 0, z: 2.2 };
    w.resolveCircle(p, 0.45, { feetY: 0, step: 0.4 });
    expect(p).toEqual({ x: 0, z: 2.2 });
  });

  it('still blocks a collider taller than the step allowance', () => {
    const w = new CollisionWorld();
    w.addObstacle(BOX, 3);
    const p = { x: 0, z: 2.2 };
    w.resolveCircle(p, 0.45, { feetY: 0, step: 0.4 });
    expect(p.z).toBeCloseTo(2 + 0.45, 10);
  });

  it('treats a finite-top collider as a full wall without a step context', () => {
    const w = new CollisionWorld();
    w.addObstacle(BOX, 1);
    const p = { x: 0, z: 2.2 };
    w.resolveCircle(p, 0.45);
    expect(p.z).toBeCloseTo(2 + 0.45, 10);
  });
});

describe('CollisionWorld.groundHeight', () => {
  const PLATFORM: Aabb = { minX: -3, maxX: 3, minZ: -3, maxZ: 3 };

  it('returns the platform top underfoot when reachable', () => {
    const w = new CollisionWorld();
    w.addObstacle(PLATFORM, 1);
    expect(w.groundHeight({ x: 0, z: 0 }, 0.45, 1)).toBeCloseTo(1, 10);
  });

  it('ignores a top above the reach ceiling', () => {
    const w = new CollisionWorld();
    w.addObstacle(PLATFORM, 1);
    expect(w.groundHeight({ x: 0, z: 0 }, 0.45, 0.4)).toBe(0);
  });

  it('returns 0 outside every footprint', () => {
    const w = new CollisionWorld();
    w.addObstacle(PLATFORM, 1);
    expect(w.groundHeight({ x: 20, z: 20 }, 0.45, 5)).toBe(0);
  });

  it('picks the highest reachable surface', () => {
    const w = new CollisionWorld();
    w.addObstacle(PLATFORM, 0.4);
    w.addObstacle({ minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, 1);
    expect(w.groundHeight({ x: 0, z: 0 }, 0.45, 1.5)).toBeCloseTo(1, 10);
  });
});

describe('CollisionWorld ramps', () => {
  const RAMP: Ramp = { minX: -2, maxX: 2, minZ: -1, maxZ: 1, lowY: 0, highY: 2, upX: 1, upZ: 0 };

  it('interpolates the surface from the low edge to the high edge', () => {
    expect(rampHeight(RAMP, -2, 0)).toBeCloseTo(0, 10);
    expect(rampHeight(RAMP, 0, 0)).toBeCloseTo(1, 10);
    expect(rampHeight(RAMP, 2, 0)).toBeCloseTo(2, 10);
  });

  it('mirrors the slope when the uphill vector points the other way', () => {
    const mirrored: Ramp = { ...RAMP, upX: -1 };
    expect(rampHeight(mirrored, -2, 0)).toBeCloseTo(2, 10);
    expect(rampHeight(mirrored, 2, 0)).toBeCloseTo(0, 10);
  });

  it('supports a body standing on the slope', () => {
    const w = new CollisionWorld();
    w.addRamp(RAMP);
    expect(w.groundHeight({ x: 0, z: 0 }, 0.45, 2)).toBeCloseTo(1, 10);
    expect(w.groundHeight({ x: 0, z: 0 }, 0.45, 0.5)).toBe(0); // above the ceiling
  });

  it('is a step at the toe and a wall at the top', () => {
    const w = new CollisionWorld();
    w.addRamp(RAMP);
    const ctx = { feetY: 0, step: 0.55 };

    // Walking in at the toe: the surface there is at floor level.
    const toe = { x: -2.2, z: 0 };
    w.resolveCircle(toe, 0.45, ctx);
    expect(toe.x).toBeCloseTo(-2.2, 10);

    // Walking into the high side: the surface there is 2 high.
    const top = { x: 2.2, z: 0 };
    w.resolveCircle(top, 0.45, ctx);
    expect(top.x).toBeCloseTo(2.45, 10);

    // Standing on the slope is not a collision at all.
    const on = { x: 0, z: 0 };
    w.resolveCircle(on, 0.45, ctx);
    expect(on).toEqual({ x: 0, z: 0 });
  });
});

describe('layout', () => {
  // The home arena is rolled per run, so every invariant runs across several
  // seeds — each seed's layout must satisfy all of them.
  const boxes = (home: ReturnType<typeof buildHome>): Aabb[] => [
    ...home.cover.map(([x, z, w, , d]) => ({
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2,
    })),
    ...deckBoxes(home),
  ];

  it('keeps every obstacle inside the arena', () => {
    for (const seed of SEEDS) {
      const home = buildHome(seed);
      for (const o of [...boxes(home), ...rampBoxes(home)]) {
        expect(o.minX, `seed ${seed}`).toBeGreaterThanOrEqual(-WORLD.HALF);
        expect(o.maxX, `seed ${seed}`).toBeLessThanOrEqual(WORLD.HALF);
        expect(o.minZ, `seed ${seed}`).toBeGreaterThanOrEqual(-WORLD.HALF);
        expect(o.maxZ, `seed ${seed}`).toBeLessThanOrEqual(WORLD.HALF);
        expect(o.maxX).toBeGreaterThan(o.minX);
        expect(o.maxZ).toBeGreaterThan(o.minZ);
      }
    }
  });

  it('keeps one deck on each mid-edge, radially fixed so the outer lane survives', () => {
    for (const seed of SEEDS) {
      const home = buildHome(seed);
      expect(home.tables.decks, `seed ${seed}`).toHaveLength(4);
      for (const { deck } of home.tables.decks) {
        const radial = Math.max(Math.abs(deck.x), Math.abs(deck.z));
        expect(radial, `seed ${seed} deck ${deck.x},${deck.z}`).toBe(DECK_EDGE);
        const along = radial === Math.abs(deck.x) ? Math.abs(deck.z) : Math.abs(deck.x);
        expect(along, `seed ${seed} deck ${deck.x},${deck.z}`).toBeLessThanOrEqual(HOME.DECK_SLIDE);
      }
    }
  });

  it('lands every ramp exactly on the deck face it serves', () => {
    for (const seed of SEEDS) {
      const home = buildHome(seed);
      for (const { deck, ramp } of home.tables.decks) {
        const highX = ramp.upX > 0 ? ramp.x + 3 : ramp.upX < 0 ? ramp.x - 3 : ramp.x;
        const highZ = ramp.upZ > 0 ? ramp.z + 3 : ramp.upZ < 0 ? ramp.z - 3 : ramp.z;
        // The face the ramp climbs onto is the deck face on its own side.
        const faceX = deck.x - ramp.upX * (DECK.w / 2);
        const faceZ = deck.z - ramp.upZ * (DECK.d / 2);
        expect(highX, `seed ${seed} deck ${deck.x},${deck.z}`).toBeCloseTo(faceX, 9);
        expect(highZ, `seed ${seed} deck ${deck.x},${deck.z}`).toBeCloseTo(faceZ, 9);
      }
    }
  });

  it('leaves a walkable lane behind every deck', () => {
    // The decks sit inboard of the world edge on the mid-edges, so the corridor
    // behind them is a real maze route rather than a dead slot: it must fit a body.
    const clamp = WORLD.HALF - WORLD.WALL_INSET;
    for (const seed of SEEDS) {
      const home = buildHome(seed);
      for (const p of deckBoxes(home)) {
        const outer = Math.max(Math.abs(p.minX), Math.abs(p.maxX), Math.abs(p.minZ), Math.abs(p.maxZ));
        expect(clamp - outer, `seed ${seed} deck at ${p.minX},${p.minZ}`).toBeGreaterThan(WORLD.PLAYER_R * 2);
      }
    }
  });

  it('leaves the spawn point clear', () => {
    for (const seed of SEEDS) {
      const home = buildHome(seed);
      const w = new CollisionWorld();
      for (const o of boxes(home)) w.addObstacle(o);
      for (const r of rampBoxes(home)) w.addRamp(r);
      const p = { x: WORLD.SPAWN_X, z: WORLD.SPAWN_Z };
      w.resolveCircle(p, WORLD.PLAYER_R);
      expect(p, `seed ${seed}`).toEqual({ x: WORLD.SPAWN_X, z: WORLD.SPAWN_Z });
    }
  });

  it('keeps the spawn plaza free of cover', () => {
    for (const seed of SEEDS) {
      const home = buildHome(seed);
      const w = new CollisionWorld();
      for (const o of boxes(home)) w.addObstacle(o);
      for (const r of rampBoxes(home)) w.addRamp(r);
      // A 10×10 pocket around the spawn, so a run never starts inside a wall.
      for (let dx = -5; dx <= 5; dx += 1) {
        for (let dz = -5; dz <= 5; dz += 1) {
          expect(
            w.blockedAt(WORLD.SPAWN_X + dx, WORLD.SPAWN_Z + dz, 0.45),
            `seed ${seed} at ${dx},${dz}`,
          ).toBe(false);
        }
      }
    }
  });

  it('keeps cover clear of the decks, ramps and landmarks', () => {
    for (const seed of SEEDS) {
      const home = buildHome(seed);
      const kept: (readonly [number, number, number, number])[] = [
        ...home.tables.decks.map(({ deck }) => [deck.x, deck.z, DECK.w, DECK.d] as const),
        ...home.tables.decks.map(({ ramp }) => {
          const spanX = ramp.upX !== 0 ? DISTRICT_RAMP.length : DISTRICT_RAMP.width;
          const spanZ = ramp.upZ !== 0 ? DISTRICT_RAMP.length : DISTRICT_RAMP.width;
          return [ramp.x, ramp.z, spanX, spanZ] as const;
        }),
        [home.tables.reactor.x, home.tables.reactor.z, REACTOR_SIZE.w, REACTOR_SIZE.d] as const,
        [home.tables.tower.x, home.tables.tower.z, TOWER_SIZE.w, TOWER_SIZE.d] as const,
        [WORLD.SPAWN_X, WORLD.SPAWN_Z, 10, 10] as const,
      ];
      for (const [x, z, w, , d] of home.cover) {
        for (const [px, pz, pw, pd] of kept) {
          const apart = Math.abs(x - px) >= (w + pw) / 2 || Math.abs(z - pz) >= (d + pd) / 2;
          expect(apart, `seed ${seed} block ${x},${z} vs ${px},${pz}`).toBe(true);
        }
      }
    }
  });

  it('builds a seeded starfield on a shell around the arena', () => {
    const positions = starfieldPositions(new Rng(3), 64);
    expect(positions).toHaveLength(64 * 3);
    for (let i = 0; i < 64; i++) {
      const x = positions[i * 3] ?? 0;
      const y = positions[i * 3 + 1] ?? 0;
      const z = positions[i * 3 + 2] ?? 0;
      const r = Math.hypot(x, y, z);
      expect(r).toBeGreaterThan(100);
      expect(r).toBeLessThanOrEqual(131);
    }
    expect(Array.from(starfieldPositions(new Rng(3), 8))).toEqual(
      Array.from(starfieldPositions(new Rng(3), 8)),
    );
  });
});

describe('ramp mesh orientation', () => {
  // The wedge mesh climbs along its local +x axis, and `render/Arena.ts` turns
  // the group by `rampRotation` to aim it at the ramp's up vector. When the
  // two disagree the wedge points sideways and the ramp reads as broken.
  it('aims the uphill face along the up vector', () => {
    for (const seed of SEEDS) {
      for (const { ramp } of buildHome(seed).tables.decks) {
        const theta = rampRotation(ramp.upX, ramp.upZ);
        // A yaw of theta maps local +x to (cos theta, -sin theta).
        expect(Math.cos(theta)).toBeCloseTo(ramp.upX, 10);
        expect(-Math.sin(theta)).toBeCloseTo(ramp.upZ, 10);
      }
    }
  });

  it('keeps the ramp width perpendicular to the climb', () => {
    for (const seed of SEEDS) {
      for (const { ramp } of buildHome(seed).tables.decks) {
        const theta = rampRotation(ramp.upX, ramp.upZ);
        // Local +z maps to (sin theta, cos theta).
        expect(Math.sin(theta) * ramp.upX + Math.cos(theta) * ramp.upZ).toBeCloseTo(0, 10);
      }
    }
  });
});
