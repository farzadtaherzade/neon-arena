/**
 * The full-screen tactical map.
 *
 * North-up, whole arena: the maze, the four decks and their ramps, the reactor,
 * the clock tower, live bombs, the hostiles and the player. The run is paused
 * while it is open, so it can afford to be redrawn from scratch every frame.
 *
 * The projection is the minimap's, with the yaw pinned to zero — the arena is
 * drawn as it is, not turned towards the player.
 */

import type { Bomb } from '../game/bomb';
import { ENEMY_TYPES, WORLD } from '../game/config';
import { project } from '../game/minimap';
import { CLOCK_TOWER, OBSTACLES, PLATFORMS, RAMPS, REACTOR } from '../game/world/layout';

/** Structural view of the live data, so `Game` passes its own array straight in. */
export interface MapEnemy {
  readonly enemy: { readonly pos: { x: number; z: number }; readonly kind: keyof typeof ENEMY_TYPES };
}

const SIZE = 720;
/** The arena plus a little air around it. */
const RANGE = WORLD.HALF + 2;

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export class MapScreen {
  private canvas = document.getElementById('mapCanvas') as HTMLCanvasElement;
  private ctx = this.canvas.getContext('2d')!;
  private open = false;

  constructor() {
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    document.getElementById('mapScreen')!.classList.add('visible');
  }

  hide(): void {
    this.open = false;
    document.getElementById('mapScreen')!.classList.remove('visible');
  }

  /** World point to canvas pixels. */
  private p(x: number, z: number): { x: number; y: number } {
    return project(0, 0, 0, x, z, SIZE, RANGE);
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
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#070b13';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // The floor.
    const a = this.p(-WORLD.HALF, -WORLD.HALF);
    const b = this.p(WORLD.HALF, WORLD.HALF);
    ctx.fillStyle = '#0d1524';
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeStyle = 'rgba(70,224,255,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);

    // The maze.
    ctx.fillStyle = '#22304a';
    for (const [x, z, w, , d] of OBSTACLES) {
      const c = this.p(x - w / 2, z - d / 2);
      const e = this.p(x + w / 2, z + d / 2);
      ctx.fillRect(c.x, c.y, e.x - c.x, e.y - c.y);
    }

    // Ramps, then the decks they reach.
    ctx.strokeStyle = '#2aa5c4';
    ctx.lineWidth = 3;
    for (const [x, z, width, length, upX, upZ] of RAMPS) {
      const halfX = upX !== 0 ? length / 2 : width / 2;
      const halfZ = upZ !== 0 ? length / 2 : width / 2;
      const c = this.p(x - halfX, z - halfZ);
      const e = this.p(x + halfX, z + halfZ);
      ctx.strokeRect(c.x, c.y, e.x - c.x, e.y - c.y);
    }
    ctx.strokeStyle = '#46e0ff';
    ctx.lineWidth = 3;
    for (const [x, z, w, , d] of PLATFORMS) {
      const c = this.p(x - w / 2, z - d / 2);
      const e = this.p(x + w / 2, z + d / 2);
      ctx.strokeRect(c.x, c.y, e.x - c.x, e.y - c.y);
    }

    // The reactor.
    const r0 = this.p(REACTOR.x - REACTOR.w / 2, REACTOR.z - REACTOR.d / 2);
    const r1 = this.p(REACTOR.x + REACTOR.w / 2, REACTOR.z + REACTOR.d / 2);
    ctx.fillStyle = 'rgba(255,59,168,0.35)';
    ctx.fillRect(r0.x, r0.y, r1.x - r0.x, r1.y - r0.y);
    ctx.strokeStyle = '#ff3ba8';
    ctx.lineWidth = 2;
    ctx.strokeRect(r0.x, r0.y, r1.x - r0.x, r1.y - r0.y);

    // The clock tower.
    const t0 = this.p(CLOCK_TOWER.x - CLOCK_TOWER.w / 2, CLOCK_TOWER.z - CLOCK_TOWER.d / 2);
    const t1 = this.p(CLOCK_TOWER.x + CLOCK_TOWER.w / 2, CLOCK_TOWER.z + CLOCK_TOWER.d / 2);
    ctx.fillStyle = 'rgba(242,178,30,0.3)';
    ctx.fillRect(t0.x, t0.y, t1.x - t0.x, t1.y - t0.y);
    ctx.strokeStyle = '#f2b21e';
    ctx.lineWidth = 2;
    ctx.strokeRect(t0.x, t0.y, t1.x - t0.x, t1.y - t0.y);

    // Live bombs, with their blast radius.
    for (const bomb of bombs) {
      if (bomb.state !== 'live') continue;
      const c = this.p(bomb.pos.x, bomb.pos.z);
      const r = this.p(bomb.pos.x + bomb.radius, bomb.pos.z).x - c.x;
      ctx.strokeStyle = `rgba(255,59,78,${0.35 + 0.4 * Math.sin(elapsed * 12)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ff3b4e';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hostiles, in their own colours.
    for (const { enemy } of enemies) {
      if (enemy.kind === undefined) continue;
      const c = this.p(enemy.pos.x, enemy.pos.z);
      ctx.fillStyle = hex(ENEMY_TYPES[enemy.kind].body);
      ctx.beginPath();
      ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // The player: a triangle pointing where the camera looks.
    const me = this.p(px, pz);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    ctx.fillStyle = '#46e0ff';
    ctx.beginPath();
    ctx.moveTo(me.x + fx * 11, me.y + fz * 11);
    ctx.lineTo(me.x - fz * 7 - fx * 5, me.y + fx * 7 - fz * 5);
    ctx.lineTo(me.x + fz * 7 - fx * 5, me.y - fx * 7 - fz * 5);
    ctx.closePath();
    ctx.fill();

    // North marker.
    ctx.fillStyle = 'rgba(70,224,255,0.7)';
    ctx.font = 'bold 20px Consolas, monospace';
    ctx.fillText('N', SIZE / 2 - 7, 30);
  }
}
