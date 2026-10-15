import { describe, expect, it } from 'vitest';
import { MAP_RANGE, project } from '../../src/game/minimap';

const SIZE = 168;
const CENTRE = SIZE / 2;

describe('minimap projection', () => {
  it('puts a point dead ahead above the centre', () => {
    const p = project(0, 0, 0, 0, -10, SIZE);
    expect(p.x).toBeCloseTo(CENTRE, 6);
    expect(p.y).toBeLessThan(CENTRE);
  });

  it("puts a point on the player's right hand side to the right", () => {
    const p = project(0, 0, 0, 10, 0, SIZE);
    expect(p.x).toBeGreaterThan(CENTRE);
    expect(p.y).toBeCloseTo(CENTRE, 6);
  });

  it('rotates with the player: anything ahead is up, whatever the yaw', () => {
    for (const yaw of [0, 0.7, -1.3, Math.PI / 2, Math.PI, 2.9]) {
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const p = project(5, -3, yaw, 5 + fx * 12, -3 + fz * 12, SIZE);
      expect(p.x, `yaw ${yaw}`).toBeCloseTo(CENTRE, 6);
      expect(p.y, `yaw ${yaw}`).toBeLessThan(CENTRE);
    }
  });

  it('scales the map range onto the edge of the dial', () => {
    expect(project(0, 0, 0, 0, -MAP_RANGE, SIZE).y).toBeCloseTo(0, 6);
  });
});
