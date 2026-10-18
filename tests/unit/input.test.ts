import { describe, expect, it } from 'vitest';
import { WEAPON } from '../../src/game/config';
import { LOCK_WARMUP, LOOK_MAX, lookDeltaOk } from '../../src/ui/Input';

/**
 * The look filter is the only thing standing between a browser glitch and a
 * 180° view snap, so its ceiling is worth pinning down.
 */
describe('look delta filter', () => {
  it('accepts ordinary mouse movement', () => {
    expect(lookDeltaOk(0, 0)).toBe(true);
    expect(lookDeltaOk(12, -30)).toBe(true);
    expect(lookDeltaOk(-200, 180)).toBe(true);
  });

  it('accepts a delta exactly at the ceiling', () => {
    expect(lookDeltaOk(LOOK_MAX, -LOOK_MAX)).toBe(true);
  });

  it('rejects the single-event spikes that snap the view', () => {
    expect(lookDeltaOk(LOOK_MAX + 1, 0)).toBe(false);
    expect(lookDeltaOk(0, -(LOOK_MAX + 1))).toBe(false);
    // The cursor warp Chrome reports when pointer lock is acquired.
    expect(lookDeltaOk(2400, 0)).toBe(false);
  });

  it('keeps even the largest accepted delta under a 90° snap', () => {
    // At the default sensitivity. Anything the filter lets through has to read
    // as a flick, not as a teleport.
    expect(LOOK_MAX * WEAPON.SENS).toBeLessThan(Math.PI / 2);
  });

  it('swallows a couple of events after the lock, not a burst', () => {
    expect(LOCK_WARMUP).toBeGreaterThan(0);
    expect(LOCK_WARMUP).toBeLessThanOrEqual(4);
  });
});
