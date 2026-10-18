import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { WORLD } from '../game/config';

/**
 * Procedural painted warehouse floor. Drawn once at boot, then GPU-resident.
 *
 * One 512px tile covers ~15 world units, so the hazard lanes painted along the
 * tile edges line up into a continuous yellow safety grid and the orange zone
 * marker repeats once per square. The repeat is derived from the arena size so
 * the grid keeps its scale when the map changes.
 */
export function makeFloorTexture(rng: Rng): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');

  // Dark concrete base plus fine speckle.
  g.fillStyle = '#14171d';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(255,255,255,${rng.next() * 0.05})`;
    g.fillRect(rng.next() * 512, rng.next() * 512, 2, 2);
  }

  // Faint floor plates for orientation under the paint.
  g.strokeStyle = 'rgba(70,224,255,0.07)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = i * 128;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, 512);
    g.stroke();
    g.beginPath();
    g.moveTo(0, p);
    g.lineTo(512, p);
    g.stroke();
  }

  // Hazard-yellow safety lanes down the left and top edge; the texture repeat
  // turns these into a painted grid across the whole arena.
  paintLane(g, rng, 0, 0, 36, 512, 'x');
  paintLane(g, rng, 0, 0, 512, 36, 'y');

  // Orange painted loading-zone marker at the centre of each square.
  g.strokeStyle = 'rgba(224,101,32,0.6)';
  g.lineWidth = 9;
  g.strokeRect(171, 171, 170, 170);
  g.strokeStyle = 'rgba(224,101,32,0.3)';
  g.lineWidth = 3;
  g.strokeRect(190, 190, 132, 132);
  g.save();
  g.beginPath();
  g.rect(190, 190, 132, 132);
  g.clip();
  g.strokeStyle = 'rgba(224,101,32,0.22)';
  g.lineWidth = 10;
  for (let i = 130; i < 340; i += 34) {
    g.beginPath();
    g.moveTo(i, 170);
    g.lineTo(i - 150, 320);
    g.stroke();
  }
  g.restore();

  // Scuffed, worn paint: dark blotches over the markings.
  for (let i = 0; i < 260; i++) {
    const a = rng.next() * 0.16;
    g.fillStyle = `rgba(18,21,26,${a})`;
    const s = 6 + rng.next() * 26;
    g.fillRect(rng.next() * 512, rng.next() * 512, s, s * 0.5);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // ~15 world units per tile, whatever the arena size.
  const tiles = Math.max(1, Math.round(WORLD.ARENA / 15));
  tex.repeat.set(tiles, tiles);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A yellow lane with black hazard diagonals, drawn along one canvas edge. */
function paintLane(
  g: CanvasRenderingContext2D,
  rng: Rng,
  x: number,
  y: number,
  w: number,
  h: number,
  axis: 'x' | 'y',
): void {
  g.fillStyle = 'rgba(242,178,30,0.6)';
  g.fillRect(x, y, w, h);

  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.strokeStyle = 'rgba(22,22,26,0.55)';
  g.lineWidth = 13;
  for (let i = -512; i < 512; i += 46) {
    g.beginPath();
    if (axis === 'x') {
      g.moveTo(i, 0);
      g.lineTo(i + 512, 512);
    } else {
      g.moveTo(0, i);
      g.lineTo(512, i + 512);
    }
    g.stroke();
  }
  g.restore();

  // Chipped paint along the lane edge.
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(20,23,29,${rng.next() * 0.3})`;
    const s = 4 + rng.next() * 12;
    if (axis === 'x') g.fillRect(x, rng.next() * 512, s, s);
    else g.fillRect(rng.next() * 512, y, s, s);
  }
}
