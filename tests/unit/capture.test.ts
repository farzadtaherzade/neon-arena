import { describe, expect, it } from 'vitest';
import { CapturePoints, type Deck } from '../../src/game/capture';
import { CAPTURE } from '../../src/game/config';

const DECK_Y = 1.6;
const DECKS: Deck[] = [
  { id: 'a0', x: -25, z: -25, y: DECK_Y },
  { id: 'a1', x: 25, z: -25, y: DECK_Y },
  { id: 'a2', x: 25, z: 25, y: DECK_Y },
  { id: 'a3', x: -25, z: 25, y: DECK_Y },
];

const dt = 1 / 60;

/** Indexed deck access without a non-null assertion. */
const deckAt = (i: number): Deck => DECKS[i] as Deck;

/** Step `seconds` of simulated time on (or off) the pad. */
function run(c: CapturePoints, seconds: number, x: number, z: number, y = DECK_Y, gated = false): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) c.update(dt, x, z, y, gated);
}

describe('CapturePoints', () => {
  it('picks the nearest available deck as the live one', () => {
    const c = new CapturePoints(DECKS);
    c.update(dt, 0, 0, 0); // equidistant — the first index wins the tie
    expect(c.active).toBe(0);
    c.update(dt, deckAt(1).x, deckAt(1).z, DECK_Y);
    expect(c.active).toBe(1);
    c.update(dt, deckAt(3).x, deckAt(3).z, DECK_Y);
    expect(c.active).toBe(3);
  });

  it('only counts while the player stands on the live pad', () => {
    const c = new CapturePoints(DECKS);
    run(c, 1, 0, 0, 0); // arena centre, on the floor
    expect(c.onPad).toBe(false);
    expect(c.progress).toBe(0);

    const deck = deckAt(0);
    run(c, 1, deck.x, deck.z);
    expect(c.onPad).toBe(true);
    expect(c.progress).toBeCloseTo(1 / CAPTURE.HOLD_T, 2);
  });

  it('does not count standing on the floor under the deck', () => {
    const c = new CapturePoints(DECKS);
    const deck = deckAt(0);
    run(c, 1, deck.x, deck.z, 0);
    expect(c.onPad).toBe(false);
    expect(c.progress).toBe(0);
  });

  it('secures once after HOLD_T and starts the cooldown', () => {
    const c = new CapturePoints(DECKS);
    const deck = deckAt(0);
    let captured = 0;
    const steps = Math.round((CAPTURE.HOLD_T + 0.5) / dt);
    for (let i = 0; i < steps; i++) {
      c.update(dt, deck.x, deck.z, DECK_Y);
      if (c.justCaptured) captured++;
    }
    expect(captured).toBe(1);
    // The objective leaves the cooling deck behind for the next nearest.
    expect(c.cooldown[0]).toBeGreaterThan(CAPTURE.COOLDOWN - 1);
    expect(c.decks[c.active]?.id).not.toBe('a0');
  });

  it('drains the hold when you step off the pad', () => {
    const c = new CapturePoints(DECKS);
    const deck = deckAt(0);
    run(c, CAPTURE.HOLD_T / 2, deck.x, deck.z);
    const held = c.progress;
    expect(held).toBeGreaterThan(0.4);

    run(c, 0.1, 0, 0, 0);
    expect(c.progress).toBeLessThan(held);
  });

  it('skips a cooling deck for a farther available one', () => {
    const c = new CapturePoints(DECKS);
    const deck = deckAt(0);
    run(c, CAPTURE.HOLD_T + 0.2, deck.x, deck.z);
    expect(c.cooldown[0]).toBeGreaterThan(0);
    // Deck 0 is nearest but cooling: the objective moves to the next nearest.
    c.update(dt, deck.x, deck.z, DECK_Y);
    expect(c.active).not.toBe(0);
    expect(c.onPad).toBe(false);
    expect(c.progress).toBe(0);
  });

  it('resets progress when the live deck changes', () => {
    const c = new CapturePoints(DECKS);
    const deck = deckAt(0);
    run(c, CAPTURE.HOLD_T / 2, deck.x, deck.z);
    expect(c.progress).toBeGreaterThan(0);

    const other = deckAt(2);
    c.update(dt, other.x, other.z, 0); // near the other deck, off its pad
    expect(c.active).toBe(2);
    expect(c.progress).toBe(0);
  });

  it('streams decks in and out without losing the cooldown book', () => {
    const c = new CapturePoints(DECKS.map((d) => ({ ...d })));
    const district: Deck = { id: '3,1', x: 200, z: 200, y: DECK_Y };
    c.addDeck(district);
    expect(c.decks).toHaveLength(5);
    expect(c.cooldown).toHaveLength(5);

    run(c, CAPTURE.HOLD_T + 0.2, district.x, district.z);
    expect(c.cooldown[4]).toBeGreaterThan(CAPTURE.COOLDOWN - 1);
    // The objective moved to the nearest authored deck after the capture.
    expect(c.decks[c.active]?.id).toBe('a2');

    // Removing an earlier deck keeps `active` pointing at the same deck.
    c.removeDeck('a0');
    expect(c.decks).toHaveLength(4);
    expect(c.cooldown).toHaveLength(4);
    expect(c.decks[c.active]?.id).toBe('a2');

    // Removing a deck that is not live leaves the objective alone.
    c.removeDeck('3,1');
    expect(c.decks[c.active]?.id).toBe('a2');
  });

  it('holds the capture at full while a guardian gates the pad', () => {
    const c = new CapturePoints(DECKS.map((d) => ({ ...d })));
    const deck = deckAt(0);
    run(c, CAPTURE.HOLD_T + 0.5, deck.x, deck.z, DECK_Y, true);
    expect(c.justCaptured).toBe(false);
    expect(c.progress).toBe(1); // full, but the Colossus keeps it from banking

    // The guardian falls: the very next step banks the hold.
    c.update(dt, deck.x, deck.z, DECK_Y, false);
    expect(c.justCaptured).toBe(true);
    expect(c.cooldown[0]).toBeGreaterThan(CAPTURE.COOLDOWN - 1);
  });

  it('survives an empty deck list', () => {
    const c = new CapturePoints([]);
    c.update(dt, 0, 0, 0);
    expect(c.progress).toBe(0);
    expect(c.onPad).toBe(false);
  });
});
