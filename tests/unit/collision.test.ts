import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { WORLD } from '../../src/game/config';
import { type Aabb, CollisionWorld } from '../../src/game/world/collision';
import { OBSTACLES, starfieldPositions } from '../../src/game/world/layout';

const BOX: Aabb = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };

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
});

describe('layout', () => {
  // Same conversion `render/Arena.ts` does when it builds each cover mesh.
  const boxes: Aabb[] = OBSTACLES.map(([x, z, w, , d]) => ({
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

  it('leaves the spawn point clear', () => {
    const w = new CollisionWorld();
    for (const o of boxes) w.addObstacle(o);
    const p = { x: 0, z: 0 };
    w.resolveCircle(p, WORLD.PLAYER_R);
    expect(p).toEqual({ x: 0, z: 0 });
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
