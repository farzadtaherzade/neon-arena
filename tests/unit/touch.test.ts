import { describe, expect, it } from 'vitest';
import { emptyMove, lookDeltaOk, stickLive, stickMove } from '../../src/game/touch';

/**
 * The stick maths: a pixel offset becomes the same walk intent the WASD keys
 * produce. These are the rules the thumb feels — dead zone, rim clamp, the
 * auto-sprint threshold and the screen-up-is-forward convention.
 */
describe('touch stick', () => {
  it('is silent inside the dead zone', () => {
    const m = stickMove(6, -6, emptyMove()); // ~10 px on a 60 px stick
    expect(m.forward).toBe(0);
    expect(m.right).toBe(0);
    expect(m.sprint).toBe(false);
  });

  it('at the exact dead-zone edge the walk is still zero', () => {
    const m = stickMove(0, -60 * 0.18, emptyMove());
    expect(m.forward).toBe(0);
  });

  it('pushes straight up for full forward, and sprint flags at the rim', () => {
    const m = stickMove(0, -60, emptyMove());
    expect(m.forward).toBeCloseTo(1, 5);
    expect(m.right).toBeCloseTo(0, 5);
    expect(m.sprint).toBe(true);
  });

  it('walks below the sprint threshold without sprinting', () => {
    const m = stickMove(0, -60 * 0.9, emptyMove());
    expect(m.forward).toBeGreaterThan(0.5);
    expect(m.forward).toBeLessThan(1);
    expect(m.sprint).toBe(false);
  });

  it('screen right is strafe right, screen down is backward', () => {
    const right = stickMove(60, 0, emptyMove());
    expect(right.right).toBeCloseTo(1, 5);
    expect(right.forward).toBeCloseTo(0, 5);

    const back = stickMove(0, 60, emptyMove());
    expect(back.forward).toBeCloseTo(-1, 5);
  });

  it('clamps an offset past the rim, keeping its direction', () => {
    // Twice the radius straight up: still full forward, never more.
    const m = stickMove(0, -120, emptyMove());
    expect(m.forward).toBeCloseTo(1, 5);
    expect(m.sprint).toBe(true);
  });

  it('diagonals split the magnitude across both axes', () => {
    const m = stickMove(42.43, -42.43, emptyMove()); // 45° at the rim
    expect(m.forward).toBeCloseTo(m.right, 5);
    expect(Math.hypot(m.forward, m.right)).toBeCloseTo(1, 2);
    expect(m.sprint).toBe(true);
  });

  it('rescales the walk out of the dead zone so it starts at zero', () => {
    // Just past the dead zone: live, but barely moving.
    const m = stickMove(0, -60 * 0.25, emptyMove());
    expect(m.forward).toBeGreaterThan(0);
    expect(m.forward).toBeLessThan(0.2);
  });

  it('sprints exactly at the threshold, not before it', () => {
    const no = stickMove(0, -60 * 0.94, emptyMove());
    const yes = stickMove(0, -60 * 0.96, emptyMove());
    expect(no.sprint).toBe(false);
    expect(yes.sprint).toBe(true);
  });

  it('honours a custom radius and dead zone', () => {
    const m = stickMove(0, -50, emptyMove(), 100, 0.1);
    // Half push on a bigger stick, dead zone scaled out.
    expect(m.forward).toBeGreaterThan(0.3);
    expect(m.sprint).toBe(false);
  });

  it('stickLive agrees with the dead zone', () => {
    expect(stickLive(0, -6)).toBe(false);
    expect(stickLive(0, -60)).toBe(true);
  });

  it('look deltas pass when small and fail when a glitch', () => {
    expect(lookDeltaOk(120, -80, 600)).toBe(true);
    expect(lookDeltaOk(601, 0, 600)).toBe(false);
    expect(lookDeltaOk(0, -900, 600)).toBe(false);
  });
});
