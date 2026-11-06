import { CAPTURE } from './config';

/** A capture pad on top of a deck — authored or streamed in with a district. */
export interface Deck {
  /** Stable id: authored decks are `a0..a3`, districts are their chunk key. */
  id: string;
  x: number;
  z: number;
  /** The surface the player stands on — used to reject the floor below. */
  y: number;
}

/**
 * The high-ground objective.
 *
 * Pure: it owns pad registration, the hold timer and the per-deck cooldown,
 * and reports when a capture lands. `Game` turns that into HP and a banner;
 * the renderer draws the pad this class points at.
 *
 * The live pad is the **nearest one off cooldown** — in an infinite world the
 * objective follows the push, and the authored four degrade gracefully into
 * the same rule. Deck districts register and unregister themselves as their
 * chunks stream in and out (`addDeck` / `removeDeck`).
 */
export class CapturePoints {
  /** Deck index that is live right now. */
  active = 0;
  /** Hold progress on the live deck, 0..1. */
  progress = 0;
  /** Is the player standing on the live pad right now? Drives the HUD bar. */
  onPad = false;
  /** True on the step a capture completed. */
  justCaptured = false;
  /** Seconds of cooldown left, parallel to `decks`. */
  readonly cooldown: number[] = [];

  constructor(readonly decks: Deck[]) {
    for (const _ of decks) this.cooldown.push(0);
  }

  /** Stream a district deck in. */
  addDeck(deck: Deck): void {
    this.decks.push(deck);
    this.cooldown.push(0);
  }

  /** Stream a district deck out; the active index follows the removal. */
  removeDeck(id: string): void {
    const i = this.decks.findIndex((d) => d.id === id);
    if (i < 0) return;
    this.decks.splice(i, 1);
    this.cooldown.splice(i, 1);
    if (i === this.active) {
      this.active = 0;
      this.progress = 0;
    } else if (i < this.active) {
      this.active--;
    }
  }

  /** Is the live deck off cooldown and therefore capturable? */
  get ready(): boolean {
    return (this.cooldown[this.active] ?? 0) <= 0;
  }

  reset(): void {
    this.active = 0;
    this.progress = 0;
    this.onPad = false;
    this.justCaptured = false;
    this.cooldown.fill(0);
  }

  /**
   * One step. `feetY` is the player's feet, so standing on the floor beneath a
   * deck never counts. `gated` pauses the hold at full while a guardian keeps
   * its pad — the capture cannot bank until the Colossus falls.
   */
  update(dt: number, px: number, pz: number, feetY: number, gated = false): void {
    this.justCaptured = false;

    for (let i = 0; i < this.cooldown.length; i++) {
      const left = this.cooldown[i] ?? 0;
      if (left > 0) this.cooldown[i] = Math.max(0, left - dt);
    }

    // The live pad: nearest deck whose cooldown has expired. None available —
    // no objective; the hold decays as ever.
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.decks.length; i++) {
      if ((this.cooldown[i] ?? 0) > 0) continue;
      const deck = this.decks[i];
      if (!deck) continue;
      const d = Math.hypot(px - deck.x, pz - deck.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) {
      this.onPad = false;
      this.progress = Math.max(0, this.progress - dt * CAPTURE.DECAY);
      return;
    }
    if (best !== this.active) {
      this.active = best;
      this.progress = 0;
    }

    const deck = this.decks[this.active];
    if (!deck) return;

    this.onPad =
      this.ready && feetY >= deck.y - CAPTURE.RISE && Math.hypot(px - deck.x, pz - deck.z) <= CAPTURE.RADIUS;

    if (!this.onPad) {
      this.progress = Math.max(0, this.progress - dt * CAPTURE.DECAY);
      return;
    }

    this.progress += dt / CAPTURE.HOLD_T;
    if (this.progress >= 1) {
      if (gated) {
        this.progress = 1; // the guardian holds the pad: full but not banked
        return;
      }
      this.progress = 0;
      this.onPad = false;
      this.cooldown[this.active] = CAPTURE.COOLDOWN;
      this.justCaptured = true;
    }
  }
}
