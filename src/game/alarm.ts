import { ALARM } from './config';

/**
 * Rising-edge detection for the watchtower alarms.
 *
 * Pure: the caller does the spatial query — it owns the enemy list — and
 * reports which towers currently see hostiles, keyed by tower id. This class
 * turns that into a held state plus a one-shot "just triggered" return, so the
 * siren pings once per event instead of every frame a mob stands nearby, and a
 * hostile stepping behind cover for half a second cannot strobe it.
 *
 * Id-keyed rather than indexed: deck districts stream their towers in and out
 * with their chunks, and a Map forgets them cleanly.
 */
export class TowerAlarm {
  /** Per tower: is the alarm lit right now? Read by the beacons and the radar. */
  readonly hot = new Map<string, boolean>();
  /** Seconds of alarm left, per tower. */
  private readonly hold = new Map<string, number>();

  reset(): void {
    this.hot.clear();
    this.hold.clear();
  }

  /**
   * One step. `contact` maps tower id to whether it sees hostiles this frame.
   * Returns true on the step at least one tower entered the alarm state.
   */
  update(dt: number, contact: ReadonlyMap<string, boolean>): boolean {
    let fired = false;
    for (const [id, seen] of contact) {
      const left = this.hold.get(id) ?? 0;
      const next = seen ? ALARM.HOLD : Math.max(0, left - dt);
      this.hold.set(id, next);
      const hot = next > 0;
      if (hot && !this.hot.get(id)) fired = true;
      this.hot.set(id, hot);
    }
    return fired;
  }

  /** Is this tower's alarm lit right now? */
  isHot(id: string): boolean {
    return this.hot.get(id) ?? false;
  }
}
