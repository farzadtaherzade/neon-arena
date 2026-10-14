export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Frame-rate-independent exponential approach: how far to move toward a target
 * so that `rate` is the fraction closed per second.
 */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

export const dampFactor = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
