import * as THREE from 'three';
import type { Rng } from '../core/rng';

/** Procedural grid floor texture. Drawn once at boot, then GPU-resident. */
export function makeFloorTexture(rng: Rng): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');

  g.fillStyle = '#14171d';
  g.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(255,255,255,${rng.next() * 0.05})`;
    g.fillRect(rng.next() * 512, rng.next() * 512, 2, 2);
  }

  g.strokeStyle = 'rgba(70,224,255,0.16)';
  g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    const p = i * 64;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, 512);
    g.stroke();
    g.beginPath();
    g.moveTo(0, p);
    g.lineTo(512, p);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(15, 15);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
