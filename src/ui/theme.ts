/**
 * The current theme accent, as RGB parts.
 *
 * Starts at the DEFAULT theme's accent by construction — boot with the stored
 * theme equal to the default never runs the apply path — and `Game` feeds it
 again whenever it applies a theme. The canvas UIs (minimap, tactical map)
 * read it per draw instead of hardcoding a hue, so they follow the arena
 * theme like every CSS element does.
 */

import { DEFAULT_THEME, THEMES } from '../game/config';

function toRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(n)
    ? { r: 0x46, g: 0xe0, b: 0xff }
    : { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

let rgb = toRgb(THEMES[DEFAULT_THEME].cssAccent);

export function setAccent(hex: string): void {
  rgb = toRgb(hex);
}

/** The accent as an `rgba()` string at the given alpha. */
export function accent(a: number): string {
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
}
