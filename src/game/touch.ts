import { TOUCH } from './config';

/**
 * Touch stick maths — pure, no DOM.
 *
 * The virtual stick is a floating circle: wherever the left thumb lands is the
 * centre, and the offset from there is the walk intent. This module turns that
 * pixel offset into the same `forward/right/sprint` shape the keyboard hands
 * the player, so `Player.update` cannot tell the two apart.
 *
 * `src/ui/Touch.ts` owns the fingers; everything here owns the numbers.
 */

/** The walk intent one stick produces. Same shape as `MoveInput`. */
export interface TouchMove {
  /** +1 = full forward, 0 = still. Analogue in between. */
  forward: number;
  /** +1 = full strafe right. */
  right: number;
  /** True once the stick is pushed past `SPRINT_FRACTION` — auto-sprint. */
  sprint: boolean;
}

export function emptyMove(): TouchMove {
  return { forward: 0, right: 0, sprint: false };
}

/**
 * Fold a raw stick offset (px, screen space) into a walk vector.
 *
 * The magnitude is clamped to the stick radius, the dead zone is scaled out so
 * the walk starts at zero the moment the thumb crosses it, and screen up
 * (negative y) is forward. Writes into `out` — the stick calls this on every
 * pointermove and must not allocate.
 */
export function stickMove(
  offsetX: number,
  offsetY: number,
  out: TouchMove,
  radius: number = TOUCH.STICK_R,
  dead: number = TOUCH.DEAD_ZONE,
  sprintAt: number = TOUCH.SPRINT_FRACTION,
): TouchMove {
  const len = Math.hypot(offsetX, offsetY);
  const frac = len <= 0 ? 0 : Math.min(len / radius, 1);
  if (frac <= dead) {
    out.forward = 0;
    out.right = 0;
    out.sprint = false;
    return out;
  }
  // Rescale so the walk builds from 0 at the dead-zone edge to 1 at the rim.
  const norm = (frac - dead) / (1 - dead);
  const inv = norm / len;
  out.forward = -offsetY * inv;
  out.right = offsetX * inv;
  out.sprint = frac >= sprintAt;
  return out;
}

/** Would this pixel offset register at all, or is it inside the dead zone? */
export function stickLive(
  offsetX: number,
  offsetY: number,
  radius: number = TOUCH.STICK_R,
  dead: number = TOUCH.DEAD_ZONE,
): boolean {
  return Math.hypot(offsetX, offsetY) / radius > dead;
}

/** Clamp a drag delta the way `Input.lookDeltaOk` guards mouse flicks, with touch headroom. */
export function lookDeltaOk(dx: number, dy: number, max: number): boolean {
  return Math.abs(dx) <= max && Math.abs(dy) <= max;
}
