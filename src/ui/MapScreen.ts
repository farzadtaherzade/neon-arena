/**
 * The full-screen tactical map.
 *
 * North-up and **centred on the player**: the streamed chunks around them,
 * the home arena's rolled maze, deck districts with their ramps, the reactor,
 * the clock tower, live bombs, the hostiles and the player. The run is paused
 * while it is open, so it can afford to be redrawn from scratch every frame.
 *
 * The projection is the minimap's, with the yaw pinned to zero — the world is
 * drawn as it is, not turned towards the player.
 */

import type { Bomb } from '../game/bomb';
import { CRAWL, ENEMY_TYPES } from '../game/config';
import { project } from '../game/minimap';
import type { ChunkTables } from '../game/world/chunks';
import { REACTOR_SIZE, TOWER_SIZE } from '../game/world/layout';
import { accent } from './theme';

/** Structural view of the live data, so `Game` passes its own array straight in. */
export interface MapEnemy {
  readonly enemy: { readonly pos: { x: number; z: number }; readonly kind: keyof typeof ENEMY_TYPES };
}

const SIZE = 720;
/** The loaded window around the player, roughly. */
const RANGE = CRAWL.VIEW_RADIUS * CRAWL.CHUNK;

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

  /** World point to canvas pixels, around the player. */
  private px = 0;
  private pz = 0;
  private p(x: number, z: number): { x: number; y: number } {
    return project(this.px, this.pz, 0, x, z, SIZE, RANGE);
  }

  private rect(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
  ): { x: number; y: number; w: number; h: number } {
    const a = this.p(x0, z0);
    const b = this.p(x1, z1);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }

  draw(
    px: number,
    pz: number,
    yaw: number,
    enemies: readonly MapEnemy[],
    bombs: readonly Bomb[],
    elapsed: number,
    chunks: readonly ChunkTables[],
  ): void {
    this.px = px;
    this.pz = pz;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#070b13';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // One floor rect per loaded chunk — the streamed ground.
    const half = CRAWL.CHUNK / 2;
    ctx.fillStyle = '#0d1524';
    for (const t of chunks) {
      const f = this.rect(
        t.cx * CRAWL.CHUNK - half,
        t.cz * CRAWL.CHUNK - half,
        t.cx * CRAWL.CHUNK + half,
        t.cz * CRAWL.CHUNK + half,
      );
      ctx.fillRect(f.x, f.y, f.w, f.h);
    }
    ctx.strokeStyle = 'rgba(70,224,255,0.35)';
    ctx.lineWidth = 1.5;
    for (const t of chunks) {
      const f = this.rect(
        t.cx * CRAWL.CHUNK - half,
        t.cz * CRAWL.CHUNK - half,
        t.cx * CRAWL.CHUNK + half,
        t.cz * CRAWL.CHUNK + half,
      );
      ctx.strokeRect(f.x, f.y, f.w, f.h);
    }

    // Cover, generated and home alike — the home chunk's rolled maze is one
    // of the streamed tables.
    ctx.fillStyle = '#22304a';
    for (const t of chunks) {
      for (const [x, z, w, , d] of t.cover) {
        const r = this.rect(x - w / 2, z - d / 2, x + w / 2, z + d / 2);
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    }

    // Ramps, then the decks they reach — home and district.
    const home = chunks.find((t) => t.home)?.home;
    ctx.strokeStyle = accent(0.75);
    ctx.lineWidth = 3;
    for (const t of chunks) {
      const d = t.district;
      if (!d) continue;
      const r = this.rect(d.ramp.x - 2.2, d.ramp.z - 3, d.ramp.x + 2.2, d.ramp.z + 3);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    if (home) {
      for (const { ramp } of home.decks) {
        const halfX = ramp.upX !== 0 ? 3 : 2.2;
        const halfZ = ramp.upZ !== 0 ? 3 : 2.2;
        const r = this.rect(ramp.x - halfX, ramp.z - halfZ, ramp.x + halfX, ramp.z + halfZ);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
    }
    ctx.strokeStyle = accent(1);
    ctx.lineWidth = 3;
    for (const t of chunks) {
      const d = t.district;
      if (!d) continue;
      const r = this.rect(d.deck.x - 3.5, d.deck.z - 3.5, d.deck.x + 3.5, d.deck.z + 3.5);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    if (home) {
      for (const { deck } of home.decks) {
        const r = this.rect(deck.x - 3.5, deck.z - 3.5, deck.x + 3.5, deck.z + 3.5);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
    }

    // The reactor and the clock tower, wherever this run rolled them.
    if (home) {
      const r0 = this.rect(
        home.reactor.x - REACTOR_SIZE.w / 2,
        home.reactor.z - REACTOR_SIZE.d / 2,
        home.reactor.x + REACTOR_SIZE.w / 2,
        home.reactor.z + REACTOR_SIZE.d / 2,
      );
      ctx.fillStyle = 'rgba(255,59,168,0.35)';
      ctx.fillRect(r0.x, r0.y, r0.w, r0.h);
      ctx.strokeStyle = '#ff3ba8';
      ctx.lineWidth = 2;
      ctx.strokeRect(r0.x, r0.y, r0.w, r0.h);

      const t0 = this.rect(
        home.tower.x - TOWER_SIZE.w / 2,
        home.tower.z - TOWER_SIZE.d / 2,
        home.tower.x + TOWER_SIZE.w / 2,
        home.tower.z + TOWER_SIZE.d / 2,
      );
      ctx.fillStyle = 'rgba(242,178,30,0.3)';
      ctx.fillRect(t0.x, t0.y, t0.w, t0.h);
      ctx.strokeStyle = '#f2b21e';
      ctx.lineWidth = 2;
      ctx.strokeRect(t0.x, t0.y, t0.w, t0.h);
    }

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
    ctx.fillStyle = accent(1);
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
