import { describe, expect, it } from 'vitest';
import { CapturePoints, type Deck } from '../../src/game/capture';
import { CAPTURE } from '../../src/game/config';

const DECK_Y = 1.6;
const DECKS: Deck[] = [
  { x: -25, z: -25, y: DECK_Y },
  { x: 25, z: -25, y: DECK_Y },
  { x: 25, z: 25, y: DECK_Y },
  { x: -25, z: 25, y: DECK_Y },
];

const dt = 1 / 60;

/** Step `seconds` of simulated time on (or off) the pad. */
function run(c: CapturePoints, seconds: number, wave: number, x: number, z: number, y = DECK_Y): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) c.update(dt, wave, x, z, y);
}

describe('CapturePoints', () => {
  it('rotates the live deck with the wave', () => {
    const c = new CapturePoints(DECKS);
    c.update(dt, 1, 0, 0, 0);
    expect(c.active).toBe(0);
    c.update(dt, 2, 0, 0, 0);
    expect(c.active).toBe(1);
    // Four decks, so wave 5 wraps back round to the first.
    c.update(dt, 5, 0, 0, 0);
    expect(c.active).toBe(0);
  });

  it('only counts while the player stands on the live pad', () => {
    const c = new CapturePoints(DECKS);
    run(c, 1, 1, 0, 0, 0); // arena centre, on the floor
    expect(c.onPad).toBe(false);
    expect(c.progress).toBe(0);

    const deck = DECKS[0]!;
    run(c, 1, 1, deck.x, deck.z);
    expect(c.onPad).toBe(true);
    expect(c.progress).toBeCloseTo(1 / CAPTURE.HOLD_T, 2);
  });

  it('does not count standing on the floor under the deck', () => {
    const c = new CapturePoints(DECKS);
    const deck = DECKS[0]!;
    run(c, 1, 1, deck.x, deck.z, 0);
    expect(c.onPad).toBe(false);
    expect(c.progress).toBe(0);
  });

  it('secures once after HOLD_T and starts the cooldown', () => {
    const c = new CapturePoints(DECKS);
    const deck = DECKS[0]!;
    let captured = 0;
    const steps = Math.round((CAPTURE.HOLD_T + 0.5) / dt);
    for (let i = 0; i < steps; i++) {
      c.update(dt, 1, deck.x, deck.z, DECK_Y);
      if (c.justCaptured) captured++;
    }
    expect(captured).toBe(1);
    expect(c.ready).toBe(false);
    expect(c.cooldown[0]).toBeGreaterThan(CAPTURE.COOLDOWN - 1);
  });

  it('drains the hold when you step off the pad', () => {
    const c = new CapturePoints(DECKS);
    const deck = DECKS[0]!;
    run(c, CAPTURE.HOLD_T / 2, 1, deck.x, deck.z);
    const held = c.progress;
    expect(held).toBeGreaterThan(0.4);

    run(c, 0.1, 1, 0, 0, 0);
    expect(c.progress).toBeLessThan(held);
  });

  it('cannot be re-secured while the deck is cooling down', () => {
    const c = new CapturePoints(DECKS);
    const deck = DECKS[0]!;
    run(c, CAPTURE.HOLD_T + 0.2, 1, deck.x, deck.z);
    expect(c.ready).toBe(false);

    run(c, 1, 1, deck.x, deck.z);
    expect(c.progress).toBe(0);
    expect(c.onPad).toBe(false);
  });

  it('resets progress when the live deck rotates', () => {
    const c = new CapturePoints(DECKS);
    const deck = DECKS[0]!;
    run(c, CAPTURE.HOLD_T / 2, 1, deck.x, deck.z);
    expect(c.progress).toBeGreaterThan(0);

    c.update(dt, 2, deck.x, deck.z, DECK_Y);
    expect(c.active).toBe(1);
    expect(c.progress).toBe(0);
  });

  it('survives an empty deck list', () => {
    const c = new CapturePoints([]);
    c.update(dt, 1, 0, 0, 0);
    expect(c.progress).toBe(0);
  });
});
