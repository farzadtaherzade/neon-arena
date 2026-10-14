/**
 * Fixed-timestep accumulator.
 *
 * The simulation always advances in whole `step` slices, so behaviour no longer
 * depends on the frame rate; rendering happens once per animation frame with the
 * leftover alpha. A long stall is capped at `maxSteps` slices so a backgrounded
 * tab cannot spiral into a thousand catch-up updates.
 */
export class FixedLoop {
  private accumulator = 0;
  private alpha = 0;

  constructor(
    readonly step = 1 / 60,
    readonly maxSteps = 5,
  ) {}

  /**
   * Feed a frame duration in seconds. Returns how many fixed steps to run plus
   * the interpolation alpha for the renderer (0..1 into the next step).
   */
  advance(dt: number): { steps: number; alpha: number } {
    this.accumulator += dt;
    const steps = Math.min(Math.floor(this.accumulator / this.step), this.maxSteps);
    this.accumulator -= steps * this.step;
    if (steps === this.maxSteps) this.accumulator = 0;
    this.alpha = this.accumulator / this.step;
    return { steps, alpha: this.alpha };
  }

  /** Seconds of simulation time still unstepped. */
  get pending(): number {
    return this.accumulator;
  }
}
