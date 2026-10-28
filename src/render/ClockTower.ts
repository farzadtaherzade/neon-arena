import * as THREE from 'three';
import type { ThemeDef } from '../game/config';
import { makeClockTower } from './models/StructureKit';

/** Texture size of one clock face. */
const FACE = 256;

/** Radius of the face disc on the housing. */
const FACE_R = 2.7;

/** Where the face sits on the housing, in local tower space. */
const FACE_POS: readonly { x: number; z: number; ry: number }[] = [
  { x: 4.75, z: 0, ry: Math.PI / 2 },
  { x: 0, z: 4.75, ry: 0 },
];

interface Face {
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
}

/**
 * The clock tower landmark.
 *
 * The body is ordinary structure geometry; the face is a live canvas so the
 * wave readout is readable from across the arena. The canvas is only redrawn
 * when the readout actually changes, so it costs nothing per frame.
 */
export class ClockTower {
  readonly group = new THREE.Group();

  /** The lit shell, used as the bullet blocker. */
  readonly solid: THREE.Mesh;

  private faces: Face[] = [];

  private last = '';

  private readonly theme: ThemeDef;

  constructor(x: number, z: number, theme: ThemeDef) {
    this.theme = theme;
    const asset = makeClockTower(theme);
    this.group.add(asset.group);
    this.solid = asset.solid;
    this.group.position.set(x, 0, z);

    for (const p of FACE_POS) {
      const canvas = document.createElement('canvas');
      canvas.width = FACE;
      canvas.height = FACE;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const geo = new THREE.CircleGeometry(FACE_R, 48);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.x, 16.6, p.z);
      mesh.rotation.y = p.ry;
      this.group.add(mesh);
      this.faces.push({ ctx, tex });
    }

    this.setReadout('STANDBY', '--', 'DEPLOY');
  }

  /**
   * Write the readout on the face.
   *
   * `title` is the small label, `value` the big number, `sub` the line under
   * it. Nothing is redrawn until one of them changes.
   */
  setReadout(title: string, value: string, sub: string): void {
    const key = `${title}|${value}|${sub}`;
    if (key === this.last) return;
    this.last = key;

    for (const { ctx, tex } of this.faces) {
      const c = FACE / 2;
      ctx.clearRect(0, 0, FACE, FACE);

      ctx.fillStyle = '#05070c';
      ctx.beginPath();
      ctx.arc(c, c, c - 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = hex(this.theme.cyan);
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(c, c, c - 8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#7fd6ef';
      ctx.font = 'bold 30px monospace';
      ctx.fillText(title, c, 72);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 92px monospace';
      ctx.fillText(value, c, 152);

      ctx.fillStyle = hex(this.theme.hazard);
      ctx.font = 'bold 27px monospace';
      ctx.fillText(sub, c, 202);

      tex.needsUpdate = true;
    }
  }

  /** The tower's own meshes and textures. */
  dispose(): void {
    for (const child of this.group.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      child.geometry.dispose();
      const mat = child.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
  }
}

/** `0x28e0ff` → `#28e0ff`, for the canvas face. */
function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}
