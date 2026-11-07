import type { Bomb } from '../game/bomb';
import { BOMB, ENEMY_TYPES } from '../game/config';
import { MAP_RANGE, project } from '../game/minimap';
import { accent } from './theme';

/** Structural view of the live data, so `Game` passes its own array straight in. */
export interface MapEnemy {
  readonly enemy: { readonly pos: { x: number; z: number }; readonly kind: keyof typeof ENEMY_TYPES };
}

/**
 * A gatehouse blip. `hot` is written by `Game` from the alarm state each frame,
 * so the array is allocated once and mutated rather than rebuilt.
 */
export interface MapTower {
  /** Stable id — authored towers `a0..a3`, districts their chunk key. */
  readonly id: string;
  readonly x: number;
  readonly z: number;
  hot: boolean;
}

const SIZE = 168;
const HALF_PX = SIZE / 2;
const SCALE = SIZE / (2 * MAP_RANGE);

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** Danger red as an rgb triplet — every theme ships the same cssDanger. */
const DANGER = '255,59,78';
/** Glass hairline, mirrored from the stylesheet's `--line`. */
const HAIRLINE = 'rgba(151,181,227,';

/**
 * Top-right radar. Player-up, so wherever the player faces is always the top of
 * the dial; enemies are blipped in their own colours and live bombs blink red
 * with their blast radius drawn as a ring. The live capture deck wears a
 * pulsing diamond — clamped to the rim when it is off the dial, so "where is
 * the objective" always has an answer.
 *
 * Reads its DOM node once and reuses one canvas context. It draws from the
 * caller's live arrays — no per-frame snapshot is built.
 */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private dpr: number;

  constructor() {
    const el = document.getElementById('minimap');
    if (!(el instanceof HTMLCanvasElement)) throw new Error('missing #minimap');
    const ctx = el.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    el.width = SIZE * this.dpr;
    el.height = SIZE * this.dpr;
  }

  draw(
    px: number,
    pz: number,
    yaw: number,
    enemies: readonly MapEnemy[],
    bombs: readonly Bomb[],
    elapsed: number,
    towers: readonly MapTower[] = [],
    objective?: { readonly x: number; readonly z: number },
  ): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    ctx.save();
    ctx.beginPath();
    ctx.arc(HALF_PX, HALF_PX, HALF_PX - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(6,10,18,0.72)';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Range rings: quiet depth marks at half and full sweep.
    ctx.strokeStyle = `${HAIRLINE}0.08)`;
    ctx.lineWidth = 1;
    for (const r of [(HALF_PX - 2) * 0.5, HALF_PX - 3]) {
      ctx.beginPath();
      ctx.arc(HALF_PX, HALF_PX, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Rim ticks every 45°; the forward one (always up) reads in the accent.
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const r0 = HALF_PX - 3;
      ctx.strokeStyle = i === 0 ? accent(0.9) : `${HAIRLINE}0.25)`;
      ctx.lineWidth = i === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(HALF_PX + ca * (r0 - 5), HALF_PX + sa * (r0 - 5));
      ctx.lineTo(HALF_PX + ca * r0, HALF_PX + sa * r0);
      ctx.stroke();
    }

    const at = (wx: number, wz: number) => project(px, pz, yaw, wx, wz, SIZE);
    const visible = (q: { x: number; y: number }): boolean =>
      Math.hypot(q.x - HALF_PX, q.y - HALF_PX) < HALF_PX - 3;

    // The live capture deck: a pulsing diamond, rim-clamped when off the dial.
    if (objective) {
      const q = at(objective.x, objective.z);
      const dx = q.x - HALF_PX;
      const dy = q.y - HALF_PX;
      const dist = Math.hypot(dx, dy);
      const edge = HALF_PX - 10;
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 5);
      const cx = dist > edge ? HALF_PX + (dx / dist) * edge : q.x;
      const cy = dist > edge ? HALF_PX + (dy / dist) * edge : q.y;
      const r = dist > edge ? 3.5 + 2 * pulse : 4.5 + 1.5 * pulse;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fillStyle = accent(dist > edge ? 0.35 + 0.3 * pulse : 0.25);
      ctx.fill();
      ctx.strokeStyle = accent(0.9);
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // Watchtowers: a steady blip, pulsing red while their alarm is up.
    for (const t of towers) {
      const q = at(t.x, t.z);
      if (!visible(q)) continue;
      if (t.hot) {
        const pulse = 6 + 5 * (0.5 + 0.5 * Math.sin(elapsed * 8));
        ctx.strokeStyle = `rgba(${DANGER},0.85)`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(q.x, q.y, pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = t.hot ? `rgba(${DANGER},0.9)` : accent(0.35);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 3.4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Bombs: blast ring plus a blinking core.
    for (const bomb of bombs) {
      const q = at(bomb.pos.x, bomb.pos.z);
      if (!visible(q)) continue;
      ctx.strokeStyle = `rgba(${DANGER},0.5)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(q.x, q.y, BOMB.RADIUS * SCALE, 0, Math.PI * 2);
      ctx.stroke();

      const blink = 0.45 + 0.55 * Math.abs(Math.sin(elapsed * (6 + bomb.k * 30)));
      ctx.fillStyle = `rgba(255,70,50,${blink})`;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Enemies: their own colours, with a dark ring so they read on any sky.
    for (const { enemy } of enemies) {
      const q = at(enemy.pos.x, enemy.pos.z);
      if (!visible(q)) continue;
      const spec = ENEMY_TYPES[enemy.kind];
      const r = 2.8 * spec.scale + (enemy.kind === 'sapper' ? 0.6 : 0);
      ctx.fillStyle = hex(spec.body);
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Player: a triangle at the centre, always pointing up.
    ctx.fillStyle = '#eaf6ff';
    ctx.beginPath();
    ctx.moveTo(HALF_PX, HALF_PX - 6);
    ctx.lineTo(HALF_PX - 4.4, HALF_PX + 4.4);
    ctx.lineTo(HALF_PX + 4.4, HALF_PX + 4.4);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    ctx.strokeStyle = accent(0.5);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(HALF_PX, HALF_PX, HALF_PX - 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}
