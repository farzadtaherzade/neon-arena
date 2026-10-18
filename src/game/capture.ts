import { CAPTURE } from './config';

/** A capture pad on top of one corner platform. */
export interface Deck {
  x: number;
  z: number;
  /** The surface the player stands on — used to reject the floor below. */
  y: number;
}

/**
 * The rotating high-ground objective.
 *
 * Pure: it owns the rotation, the hold timer and the per-deck cooldown, and
 * reports when a capture lands. `Game` turns that into HP and a banner; the
 * renderer draws the pad this class points at.
 *
 * The live deck is derived from the wave number rather than set explicitly, so
 * it cannot fall out of sync with the HUD's wave counter — including when the
 * wave advances inside `WaveDirector` rather than through `beginWave()`.
 */
export class CapturePoints {
  /** Deck index that is live this wave. */
  active = 0;
  /** Hold progress on the live deck, 0..1. */
  progress = 0;
  /** Is the player standing on the live pad right now? Drives the HUD bar. */
  onPad = false;
  /** True on the step a capture completed. */
  justCaptured = false;
  /** Seconds of cooldown left, per deck. */
  readonly cooldown: number[];

  constructor(readonly decks: readonly Deck[]) {
    this.cooldown = decks.map(() => 0);
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
   * One step. `wave` rotates the live deck; `feetY` is the player's feet, so
   * standing on the floor beneath a deck never counts.
   */
  update(dt: number, wave: number, px: number, pz: number, feetY: number): void {
    this.justCaptured = false;

    const count = this.decks.length;
    if (count === 0) return;
    const active = (((wave - 1) % count) + count) % count;
    if (active !== this.active) {
      this.active = active;
      this.progress = 0;
    }

    for (let i = 0; i < this.cooldown.length; i++) {
      const left = this.cooldown[i] ?? 0;
      if (left > 0) this.cooldown[i] = Math.max(0, left - dt);
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
      this.progress = 0;
      this.onPad = false;
      this.cooldown[this.active] = CAPTURE.COOLDOWN;
      this.justCaptured = true;
    }
  }
}
