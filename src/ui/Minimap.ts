import type { Bomb } from '../game/bomb';
import { BOMB, ENEMY_TYPES, WORLD } from '../game/config';
import { MAP_RANGE, project } from '../game/minimap';

/** Structural view of the live data, so `Game` passes its own array straight in. */
export interface MapEnemy {
  readonly enemy: { readonly pos: { x: number; z: number }; readonly kind: keyof typeof ENEMY_TYPES };
}

const SIZE = 168;
const HALF_PX = SIZE / 2;
const SCALE = SIZE / (2 * MAP_RANGE);

/** The four arena corners, in draw order. */
const CORNERS: readonly (readonly [number, number])[] = [
  [-WORLD.HALF, -WORLD.HALF],
  [WORLD.HALF, -WORLD.HALF],
  [WORLD.HALF, WORLD.HALF],
  [-WORLD.HALF, WORLD.HALF],
];

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Top-right radar. Player-up, so wherever the player faces is always the top of
 * the dial; enemies are blipped in their own colours and live bombs blink red
 * with their blast radius drawn as a ring.
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

    const at = (wx: number, wz: number) => project(px, pz, yaw, wx, wz, SIZE);
    const visible = (q: { x: number; y: number }): boolean =>
      Math.hypot(q.x - HALF_PX, q.y - HALF_PX) < HALF_PX - 3;

    // Arena boundary.
    ctx.strokeStyle = 'rgba(70,224,255,0.40)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let first = true;
    for (const corner of CORNERS) {
      const q = at(corner[0], corner[1]);
      if (first) {
        ctx.moveTo(q.x, q.y);
        first = false;
      } else {
        ctx.lineTo(q.x, q.y);
      }
    }
    ctx.closePath();
    ctx.stroke();

    // Bombs: blast ring plus a blinking core.
    for (const bomb of bombs) {
      const q = at(bomb.pos.x, bomb.pos.z);
      if (!visible(q)) continue;
      ctx.strokeStyle = 'rgba(255,59,48,0.5)';
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

    // Enemies.
    for (const { enemy } of enemies) {
      const q = at(enemy.pos.x, enemy.pos.z);
      if (!visible(q)) continue;
      const spec = ENEMY_TYPES[enemy.kind];
      ctx.fillStyle = hex(spec.body);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 2.8 * spec.scale + (enemy.kind === 'sapper' ? 0.6 : 0), 0, Math.PI * 2);
      ctx.fill();
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

    ctx.strokeStyle = 'rgba(70,224,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(HALF_PX, HALF_PX, HALF_PX - 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}
