import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAT } from '../Materials';

/**
 * Procedural industrial structure assets.
 *
 * Each builder bakes its palette into vertex colours and merges every box into
 * two buffers: one lit shell (`MAT.structure`) and one unlit trim pass
 * (`MAT.structureGlow`). A 32-block maze therefore costs roughly 64 draw calls
 * for the cover instead of one call per panel, bolt and hazard stripe.
 *
 * Everything is authored in local space with the base on y = 0 and the footprint
 * centred on the origin. Collision is registered from the source dimensions by
 * `Arena`, never from the decorative overhang, so trim cannot silently widen a
 * corridor.
 */

const C = {
  body: 0x2b3552,
  light: 0x40527a,
  dark: 0x1a2233,
  panel: 0xa06d1a,
  panelDark: 0x5b3f16,
  hazard: 0xf2b21e,
  cyan: 0x2aa5c4,
  magenta: 0xff3ba8,
} as const;

interface ColoredPart {
  geo: THREE.BufferGeometry;
  color: number;
}

export interface StructureAsset {
  group: THREE.Group;
  /** The lit merged shell, used as the bullet blocker. */
  solid: THREE.Mesh;
}

export interface ReactorAsset extends StructureAsset {
  rings: THREE.Group[];
  core: THREE.Mesh;
  light: THREE.PointLight;
}

export interface RampAsset extends StructureAsset {
  /** Local +x is uphill; the caller mirrors the group for other directions. */
  length: number;
}

function part(parts: ColoredPart[], geo: THREE.BufferGeometry, color: number): void {
  parts.push({ geo, color });
}

function box(
  parts: ColoredPart[],
  color: number,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): void {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  part(parts, g, color);
}

/** Merge coloured parts, normalising index state so Extrude and primitives mix. */
function mergeColored(parts: ColoredPart[]): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const { geo, color } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    const pos = g.getAttribute('position');
    const count = pos?.count ?? 0;
    const c = new THREE.Color(color);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      colors[o] = c.r;
      colors[o + 1] = c.g;
      colors[o + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(g);
  }

  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) throw new Error('StructureKit: geometry merge failed');
  merged.computeBoundingSphere();
  return merged;
}

function litMesh(parts: ColoredPart[]): THREE.Mesh {
  const mesh = new THREE.Mesh(mergeColored(parts), MAT.structure());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function glowMesh(parts: ColoredPart[]): THREE.Mesh | null {
  if (parts.length === 0) return null;
  const mesh = new THREE.Mesh(mergeColored(parts), MAT.structureGlow());
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function assemble(body: ColoredPart[], glow: ColoredPart[]): StructureAsset {
  const group = new THREE.Group();
  const solid = litMesh(body);
  group.add(solid);
  const trim = glowMesh(glow);
  if (trim) group.add(trim);
  return { group, solid };
}

/**
 * A maze cover block: industrial crate, corner armour, a recessed panel band,
 * vents and a hazard-painted top rail. The silhouette stays within the collision
 * box except for a few centimetres of trim.
 */
export function makeCover(w: number, h: number, d: number): StructureAsset {
  const body: ColoredPart[] = [];
  const glow: ColoredPart[] = [];
  const hw = w / 2;
  const hd = d / 2;

  box(body, C.body, w, h, d, 0, h / 2, 0);
  box(body, C.dark, w - 0.55, 0.08, d - 0.55, 0, h + 0.02, 0);
  box(body, C.dark, w - 0.2, 0.16, d + 0.02, 0, 0.08, 0);

  // Painted band wrapping the block, plus a darker inset panel on each face.
  box(body, C.panel, w * 0.74, h * 0.3, d + 0.03, 0, h * 0.56, 0);
  box(body, C.panel, w + 0.03, h * 0.3, d * 0.74, 0, h * 0.56, 0);
  box(body, C.panelDark, w * 0.5, h * 0.17, d + 0.04, 0, h * 0.56, 0);
  box(body, C.panelDark, w + 0.04, h * 0.17, d * 0.5, 0, h * 0.56, 0);

  // Corner armour and top caps.
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      box(body, C.light, 0.15, h * 0.72, 0.15, sx * (hw - 0.07), h * 0.5, sz * (hd - 0.07));
      box(body, C.panelDark, 0.24, 0.1, 0.24, sx * (hw - 0.1), h + 0.04, sz * (hd - 0.1));
    }
  }

  // Vent slats on the two long faces.
  const slats = h > 3 ? 3 : 2;
  for (let i = 0; i < slats; i++) {
    const y = h * 0.34 + i * 0.16;
    box(body, C.dark, w * 0.44, 0.045, 0.025, 0, y, hd + 0.025);
    box(body, C.dark, w * 0.44, 0.045, 0.025, 0, y, -hd - 0.025);
  }

  // Hazard top frame and one cyan service light per block.
  box(glow, C.hazard, w, 0.05, 0.08, 0, h + 0.03, -hd);
  box(glow, C.hazard, w, 0.05, 0.08, 0, h + 0.03, hd);
  box(glow, C.hazard, 0.08, 0.05, d, -hw, h + 0.03, 0);
  box(glow, C.hazard, 0.08, 0.05, d, hw, h + 0.03, 0);
  box(glow, C.cyan, w * 0.22, 0.045, 0.03, 0, h * 0.8, hd + 0.045);
  box(glow, C.cyan, 0.04, 0.18, 0.03, hw - 0.32, h * 0.28, hd + 0.045);

  return assemble(body, glow);
}

/**
 * A gatehouse deck. The walkable top stays exactly at `h`: the deck plate is
 * cosmetic and only a couple of centimetres tall, while the capture pad floats
 * above it on `DECK_SKIN`.
 */
export function makeDeck(w: number, h: number, d: number): StructureAsset {
  const body: ColoredPart[] = [];
  const glow: ColoredPart[] = [];
  const hw = w / 2;
  const hd = d / 2;

  box(body, C.body, w, h, d, 0, h / 2, 0);
  box(body, C.dark, w - 0.3, 0.24, d - 0.3, 0, 0.12, 0);
  box(body, C.dark, w - 0.6, 0.03, d - 0.6, 0, h + 0.015, 0);

  // Four corner columns and a heavy mid-band. These are what make a deck read
  // as a gatehouse rather than a raised box.
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      box(body, C.light, 0.34, h, 0.34, sx * (hw - 0.04), h / 2, sz * (hd - 0.04));
      box(body, C.dark, 0.5, 0.18, 0.5, sx * (hw - 0.12), h + 0.06, sz * (hd - 0.12));
    }
  }

  box(body, C.panelDark, w * 0.68, h * 0.34, d + 0.04, 0, h * 0.55, 0);
  box(body, C.panelDark, w + 0.04, h * 0.34, d * 0.68, 0, h * 0.55, 0);
  box(body, C.panel, w * 0.52, h * 0.12, d + 0.06, 0, h * 0.55, 0);
  box(body, C.panel, w + 0.06, h * 0.12, d * 0.52, 0, h * 0.55, 0);

  // Vertical buttresses on the faces.
  for (const sx of [-1, 1] as const) {
    box(body, C.light, 0.16, h * 0.78, 0.4, sx * (hw + 0.02), h * 0.43, 0);
    box(body, C.light, 0.4, h * 0.78, 0.16, 0, h * 0.43, sx * (hd + 0.02));
  }

  // Top neon frame and hazard band.
  box(glow, C.cyan, w + 0.04, 0.07, 0.12, 0, h + 0.045, -hd);
  box(glow, C.cyan, w + 0.04, 0.07, 0.12, 0, h + 0.045, hd);
  box(glow, C.cyan, 0.12, 0.07, d + 0.04, -hw, h + 0.045, 0);
  box(glow, C.cyan, 0.12, 0.07, d + 0.04, hw, h + 0.045, 0);
  box(glow, C.hazard, w + 0.06, 0.16, 0.1, 0, h * 0.52, hd + 0.055);
  box(glow, C.hazard, w + 0.06, 0.16, 0.1, 0, h * 0.52, -hd - 0.055);
  box(glow, C.hazard, 0.1, 0.16, d + 0.06, hw + 0.055, h * 0.52, 0);
  box(glow, C.hazard, 0.1, 0.16, d + 0.06, -hw - 0.055, h * 0.52, 0);

  // Corner lamps at the deck lip.
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      box(glow, C.cyan, 0.15, 0.06, 0.15, sx * (hw - 0.18), h + 0.08, sz * (hd - 0.18));
    }
  }

  return assemble(body, glow);
}

/**
 * A perimeter wall segment, built along local X and centred on the origin. Deep
 * ribs and alternating painted panels break up what used to be one long slab.
 */
export function makeWall(length: number, h: number): StructureAsset {
  const body: ColoredPart[] = [];
  const glow: ColoredPart[] = [];

  box(body, C.body, length, h, 1, 0, h / 2, 0);
  box(body, C.dark, length, 0.22, 1.08, 0, 0.11, 0);
  box(body, C.dark, length, 0.18, 1.1, 0, h + 0.06, 0);

  // Recessed painted panels between the ribs.
  const step = 8;
  const first = -length / 2 + step / 2;
  for (let x = first; x < length / 2; x += step) {
    box(body, C.panelDark, step - 1.3, h * 0.34, 1.03, x, h * 0.58, 0);
    box(body, C.panel, step - 2.4, h * 0.12, 1.05, x, h * 0.58, 0);
    box(glow, C.cyan, 0.16, 0.07, 0.04, x + step * 0.25, h * 0.78, 0.53);
    box(glow, C.cyan, 0.16, 0.07, 0.04, x + step * 0.25, h * 0.78, -0.53);
  }

  // Structural ribs, deliberately protruding a little for a shadow line.
  for (let x = -length / 2 + 4; x <= length / 2 - 4; x += step) {
    box(body, C.light, 0.3, h * 0.88, 1.16, x, h * 0.46, 0);
  }

  // One continuous hazard rail and the bright top trim.
  box(glow, C.hazard, length, 0.16, 1.07, 0, h * 0.5, 0);
  box(glow, C.cyan, length, 0.08, 1.12, 0, h + 0.02, 0);

  return assemble(body, glow);
}

/**
 * The reactor: a stepped monolith with corner armour, panel windows, three
 * containment rings, a vented core and a floor halo. The rings and light are
 * returned so `Arena` can animate them without rebuilding anything.
 */
export function makeReactor(w: number, h: number, d: number): ReactorAsset {
  const body: ColoredPart[] = [];
  const glow: ColoredPart[] = [];
  const hw = w / 2;
  const hd = d / 2;

  box(body, C.dark, w, 0.35, d, 0, 0.175, 0);
  box(body, C.body, w - 0.8, h - 0.35, d - 0.8, 0, 0.35 + (h - 0.35) / 2, 0);
  box(body, C.dark, w - 0.45, 0.24, d - 0.45, 0, h + 0.12, 0);

  // Corner towers, chamfered with a small cap so the silhouette has a top.
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      box(body, C.light, 1.1, h, 1.1, sx * (hw - 0.75), h / 2, sz * (hd - 0.75));
      box(body, C.panelDark, 1.24, 0.18, 1.24, sx * (hw - 0.75), h + 0.02, sz * (hd - 0.75));
    }
  }

  // Recessed windows and vertical service conduits on every face.
  for (const s of [-1, 1] as const) {
    box(body, C.dark, 4.8, 3.4, 0.08, 0, h * 0.56, s * (hd - 0.36));
    box(body, C.dark, 0.08, 3.4, 4.8, s * (hw - 0.36), h * 0.56, 0);
    box(body, C.panelDark, 3.6, 0.14, 0.06, 0, h * 0.56, s * (hd - 0.31));
    box(body, C.panelDark, 0.06, 0.14, 3.6, s * (hw - 0.31), h * 0.56, 0);
    for (let i = 0; i < 3; i++) {
      const y = h * 0.24 + i * 1.05;
      box(glow, C.magenta, 3.4, 0.07, 0.04, 0, y, s * (hd - 0.3));
      box(glow, C.magenta, 0.04, 0.07, 3.4, s * (hw - 0.3), y, 0);
    }
    for (const s2 of [-1, 1] as const) {
      box(glow, C.magenta, 0.09, h - 0.4, 0.09, s * (hw - 0.18), h * 0.53, s2 * (hd - 0.18));
    }
  }

  // Containment ring assembly: three rings, each with four clamp shoes. The
  // radius deliberately clears the body so the rings read all the way round.
  const rings: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Group();
    ring.position.y = 1.1 + i * 1.7;
    const torus = new THREE.Mesh(new THREE.TorusGeometry(hw * 1.06, 0.085, 6, 48), MAT.magenta());
    torus.rotation.x = Math.PI / 2;
    ring.add(torus);
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.34), MAT.magenta());
      shoe.position.set(Math.cos(a) * hw * 1.06, 0, Math.sin(a) * hw * 1.06);
      ring.add(shoe);
    }
    rings.push(ring);
  }

  // Core stack and the additive containment column.
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 4.4, 12), MAT.magenta());
  core.position.y = h + 2.2;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 4.7, 16, 1, true), MAT.core());
  column.position.y = h + 2.3;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.2, 16), MAT.magenta());
  cap.position.y = h + 0.1;

  const light = new THREE.PointLight(0xff3ba8, 46, 38, 2);
  light.position.set(0, h + 1.8, 0);

  const halo = new THREE.Mesh(new THREE.RingGeometry(hw + 1.1, hw + 2.2, 64), MAT.halo());
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.025;

  const asset = assemble(body, glow);
  for (const ring of rings) asset.group.add(ring);
  asset.group.add(column, cap, core, light, halo);
  return { ...asset, rings, core, light };
}

/**
 * A solid ramp wedge with side ribs, chevrons and glowing edge rails. Local +x
 * climbs from 0 to `height`; the caller rotates the group by PI for the mirrored
 * directions and registers the same numbers with the collision world's ramp.
 */
export function makeRamp(width: number, length: number, height: number): RampAsset {
  const half = length / 2;
  const angle = Math.atan2(height, length);

  const shape = new THREE.Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(half, 0);
  shape.lineTo(half, height);
  shape.closePath();
  const wedgeGeo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  wedgeGeo.translate(0, 0, -width / 2);
  const solid = new THREE.Mesh(wedgeGeo, MAT.obstacle());
  solid.castShadow = true;
  solid.receiveShadow = true;

  const body: ColoredPart[] = [];
  const glow: ColoredPart[] = [];
  for (const s of [-1, 1] as const) {
    for (let i = 0; i < 5; i++) {
      const x = -half + ((i + 0.5) * length) / 5;
      const ribH = Math.max(0.25, ((x + half) / length) * height);
      box(body, C.dark, 0.14, ribH, 0.05, x, ribH / 2, s * (width / 2 + 0.03));
    }
    const slope = Math.hypot(length, height);
    box(glow, C.cyan, slope, 0.06, 0.06, 0, height / 2 + 0.035, s * (width / 2));
  }

  // Painted chevrons across the walkable face, following the slope.
  for (let i = 0; i < 4; i++) {
    const x = -half + ((i + 0.5) * length) / 4;
    const y = ((x + half) / length) * height + 0.025;
    box(glow, C.hazard, 0.2, 0.02, width * 0.74, x, y, 0, 0, 0, angle);
  }

  const group = new THREE.Group();
  group.add(solid);
  const trim = glowMesh(glow);
  if (trim) group.add(trim);
  const ribs = litMesh(body);
  ribs.castShadow = false;
  group.add(ribs);
  return { group, solid, length };
}
