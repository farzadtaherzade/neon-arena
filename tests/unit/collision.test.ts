import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { WORLD } from '../../src/game/config';
import { type Aabb, CollisionWorld, type Ramp, rampHeight } from '../../src/game/world/collision';
import {
  OBSTACLES,
  PLATFORM_H,
  PLATFORMS,
  RAMPS,
  rampRotation,
  starfieldPositions,
} from '../../src/game/world/layout';

const BOX: Aabb = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };

/** Same conversion `render/Arena.ts` does when it builds each mesh. */
const platformBoxes = (): Aabb[] =>
  PLATFORMS.map(([x, z, w, , d]) => ({
    minX: x - w / 2,
    maxX: x + w / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
  }));

const rampBoxes = (): Ramp[] =>
  RAMPS.map(([x, z, w, len, upX, upZ]) => {
    const spanX = upX !== 0 ? len : w;
    const spanZ = upZ !== 0 ? len : w;
    return {
      minX: x - spanX / 2,
      maxX: x + spanX / 2,
      minZ: z - spanZ / 2,
      maxZ: z + spanZ / 2,
      lowY: 0,
      highY: PLATFORM_H,
      upX,
      upZ,
    };
  });

describe('CollisionWorld.resolveCircle', () => {
  it('keeps a circle inside the arena walls', () => {
    const w = new CollisionWorld();
    const p = { x: 999, z: -999 };
    w.resolveCircle(p, WORLD.PLAYER_R);
    const b = WORLD.HALF - WORLD.WALL_INSET - WORLD.PLAYER_R;
    expect(p.x).toBe(b);
    expect(p.z).toBe(-b);
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
  const boxes: Aabb[] = [...OBSTACLES, ...PLATFORMS].map(([x, z, w, , d]) => ({
    minX: x - w / 2,
    maxX: x + w / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
  }));

  it('keeps every obstacle inside the arena', () => {
    for (const o of boxes) {
      expect(o.minX).toBeGreaterThanOrEqual(-WORLD.HALF);
      expect(o.maxX).toBeLessThanOrEqual(WORLD.HALF);
      expect(o.minZ).toBeGreaterThanOrEqual(-WORLD.HALF);
      expect(o.maxZ).toBeLessThanOrEqual(WORLD.HALF);
      expect(o.maxX).toBeGreaterThan(o.minX);
      expect(o.maxZ).toBeGreaterThan(o.minZ);
    }
  });

  it('keeps every ramp inside the arena', () => {
    for (const r of rampBoxes()) {
      expect(r.minX).toBeGreaterThanOrEqual(-WORLD.HALF);
      expect(r.maxX).toBeLessThanOrEqual(WORLD.HALF);
      expect(r.minZ).toBeGreaterThanOrEqual(-WORLD.HALF);
      expect(r.maxZ).toBeLessThanOrEqual(WORLD.HALF);
    }
  });

  it('lands every ramp exactly on the platform face it serves', () => {
    for (const ramp of rampBoxes()) {
      const highEdge =
        ramp.upX > 0 ? ramp.maxX : ramp.upX < 0 ? ramp.minX : ramp.upZ > 0 ? ramp.maxZ : ramp.minZ;
      const matches = platformBoxes().some((p) => {
        const withinX = ramp.minX >= p.minX - 1e-9 && ramp.maxX <= p.maxX + 1e-9;
        const withinZ = ramp.minZ >= p.minZ - 1e-9 && ramp.maxZ <= p.maxZ + 1e-9;
        if (ramp.upX !== 0) {
          return withinZ && (Math.abs(highEdge - p.minX) < 1e-9 || Math.abs(highEdge - p.maxX) < 1e-9);
        }
        return withinX && (Math.abs(highEdge - p.minZ) < 1e-9 || Math.abs(highEdge - p.maxZ) < 1e-9);
      });
      expect(matches, `ramp ${ramp.minX},${ramp.minZ}`).toBe(true);
    }
  });

  it('leaves a walkable lane behind every deck', () => {
    // The decks sit inboard of the wall on the mid-edges, so the corridor behind
    // them is a real maze route rather than a dead slot: it must fit a body.
    const clamp = WORLD.HALF - WORLD.WALL_INSET;
    for (const p of platformBoxes()) {
      const outer = Math.max(Math.abs(p.minX), Math.abs(p.maxX), Math.abs(p.minZ), Math.abs(p.maxZ));
      expect(clamp - outer, `deck at ${p.minX},${p.minZ}`).toBeGreaterThan(WORLD.PLAYER_R * 2);
    }
  });

  it('leaves the spawn point clear', () => {
    const w = new CollisionWorld();
    for (const o of boxes) w.addObstacle(o);
    for (const r of rampBoxes()) w.addRamp(r);
    const p = { x: WORLD.SPAWN_X, z: WORLD.SPAWN_Z };
    w.resolveCircle(p, WORLD.PLAYER_R);
    expect(p).toEqual({ x: WORLD.SPAWN_X, z: WORLD.SPAWN_Z });
  });

  it('keeps the spawn plaza free of cover', () => {
    const w = new CollisionWorld();
    for (const o of boxes) w.addObstacle(o);
    for (const r of rampBoxes()) w.addRamp(r);
    // A 10×10 pocket around the spawn, so a run never starts inside a wall.
    for (let dx = -5; dx <= 5; dx += 1) {
      for (let dz = -5; dz <= 5; dz += 1) {
        expect(w.blockedAt(WORLD.SPAWN_X + dx, WORLD.SPAWN_Z + dz, 0.45)).toBe(false);
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
    for (const [, , , , upX, upZ] of RAMPS) {
      const theta = rampRotation(upX, upZ);
      // A yaw of theta maps local +x to (cos theta, -sin theta).
      expect(Math.cos(theta)).toBeCloseTo(upX, 10);
      expect(-Math.sin(theta)).toBeCloseTo(upZ, 10);
    }
  });

  it('keeps the ramp width perpendicular to the climb', () => {
    for (const [, , , , upX, upZ] of RAMPS) {
      const theta = rampRotation(upX, upZ);
      // Local +z maps to (sin theta, cos theta).
      expect(Math.sin(theta) * upX + Math.cos(theta) * upZ).toBeCloseTo(0, 10);
    }
  });
});
