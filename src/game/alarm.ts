import { ALARM } from './config';

/**
 * Rising-edge detection for the gatehouse alarms.
 *
 * Pure: the caller does the spatial query — it owns the enemy list — and reports
 * which towers currently see hostiles. This class turns that into a held state
 * plus a one-shot "just triggered" return, so the siren pings once per event
 * instead of every frame a mob stands nearby, and a hostile stepping behind
 * cover for half a second cannot strobe it.
 */
export class TowerAlarm {
  /** Per tower: is the alarm lit right now? Read by the beacons and the radar. */
  readonly hot: boolean[];
  /** Seconds of alarm left, per tower. */
  private readonly hold: number[];

  constructor(count: number) {
    this.hot = new Array<boolean>(count).fill(false);
    this.hold = new Array<number>(count).fill(0);
  }

  reset(): void {
    this.hot.fill(false);
    this.hold.fill(0);
  }

  /**
   * One step. `contact[i]` is whether tower `i` sees hostiles this frame.
   * Returns true on the step at least one tower entered the alarm state.
   */
  update(dt: number, contact: readonly boolean[]): boolean {
    let fired = false;
    for (let i = 0; i < this.hot.length; i++) {
      if (contact[i]) this.hold[i] = ALARM.HOLD;
      else this.hold[i] = Math.max(0, (this.hold[i] ?? 0) - dt);

      const hot = (this.hold[i] ?? 0) > 0;
      if (hot && !this.hot[i]) fired = true;
      this.hot[i] = hot;
    }
    return fired;
  }
}
