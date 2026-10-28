import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EnemyKind } from '../../game/config';
import { MAT } from '../Materials';

/**
 * Procedural low-poly robot assets.
 *
 * Every visual is a small set of primitives baked into a handful of merged
 * geometries at first use, then shared for the whole session. A spawn therefore
 * allocates no geometry: `EnemyView` only creates five materials and a few
 * meshes that point at these cached buffers.
 *
 * The rig is deliberately simple — torso, helmet, two shoulder pivots and two
 * hip pivots. That is all the simulation animates (`bounce`, `legSwing`,
 * `facing`), so the model reads as articulated without asking for a skeleton or
 * a skinning pass.
 *
 * Local space: feet on y = 0, forward is +z, and the whole rig is scaled by
 * `Enemy.stats.scale` in `EnemyView`.
 */

export interface MobMaterials {
  body: THREE.MeshStandardMaterial;
  head: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  limb: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
}

export interface MobRig {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  /** How much the arms counter-swing against the legs. */
  armSwing: number;
  armBaseL: number;
  armBaseR: number;
}

type Parts = THREE.BufferGeometry[];

interface MobGeos {
  body: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  accent: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  armL: THREE.BufferGeometry;
  armR: THREE.BufferGeometry;
  armSwing: number;
  armBaseL: number;
  armBaseR: number;
}

interface BodyLayout {
  bodyY: number;
  headY: number;
  hipX: number;
  hipY: number;
  shoulderX: number;
  shoulderY: number;
}

const LAYOUT: Record<EnemyKind, BodyLayout> = {
  grunt: { bodyY: 1.0, headY: 1.56, hipX: 0.18, hipY: 0.64, shoulderX: 0.46, shoulderY: 1.28 },
  runner: { bodyY: 1.02, headY: 1.54, hipX: 0.15, hipY: 0.65, shoulderX: 0.34, shoulderY: 1.28 },
  tank: { bodyY: 1.04, headY: 1.57, hipX: 0.25, hipY: 0.66, shoulderX: 0.56, shoulderY: 1.3 },
  sapper: { bodyY: 1.0, headY: 1.53, hipX: 0.18, hipY: 0.63, shoulderX: 0.42, shoulderY: 1.27 },
  warden: { bodyY: 1.14, headY: 1.86, hipX: 0.36, hipY: 0.74, shoulderX: 0.72, shoulderY: 1.52 },
};

const cache = new Map<EnemyKind, MobGeos>();

function box(
  parts: Parts,
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
  parts.push(g);
}

function cyl(
  parts: Parts,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): void {
  const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  parts.push(g);
}

function octa(parts: Parts, sx: number, sy: number, sz: number, x: number, y: number, z: number): void {
  const g = new THREE.OctahedronGeometry(0.5, 0);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  parts.push(g);
}

function merged(parts: Parts): THREE.BufferGeometry {
  // PolyhedronGeometry is non-indexed while Box/Cylinder are indexed; normalise
  // before merging or the utility rejects the second geometry.
  const geos: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    if (g !== p) p.dispose();
    geos.push(g);
  }
  const geo = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!geo) throw new Error('MobModel: geometry merge failed');
  geo.computeBoundingSphere();
  return geo;
}

/** A generic arm that points down from the shoulder pivot. */
function arm(p: Parts, side: -1 | 1, slim = false): void {
  const w = slim ? 0.13 : 0.17;
  const d = slim ? 0.15 : 0.2;
  box(p, w, slim ? 0.34 : 0.3, d, 0, -0.17, 0.01);
  cyl(p, w * 0.55, w * 0.55, 0.13, 6, 0, -0.35, 0.01);
  box(p, w * 0.88, slim ? 0.32 : 0.27, d * 0.9, 0, -0.49, 0.07);
  box(p, w * 0.8, 0.11, d * 1.15, 0, -0.64, 0.12);
  if (slim) {
    // A lean forearm blade, angled outward so the runner silhouette is spiky.
    box(p, 0.05, 0.5, 0.12, side * 0.04, -0.7, 0.24, -0.55, 0, side * 0.16);
  }
}

/** A generic leg that reaches the floor from a hip pivot on y = 0. */
function leg(p: Parts, thick = false): void {
  const w = thick ? 0.3 : 0.19;
  const d = thick ? 0.32 : 0.22;
  box(p, w, thick ? 0.34 : 0.3, d, 0, -0.17, 0);
  cyl(p, thick ? 0.15 : 0.1, thick ? 0.15 : 0.1, 0.13, 6, 0, -0.35, 0.01);
  box(p, w * 0.82, thick ? 0.3 : 0.27, d * 0.85, 0, -0.47, 0.01);
  box(p, thick ? 0.38 : 0.24, thick ? 0.14 : 0.12, thick ? 0.46 : 0.35, 0, -0.58, 0.08);
}

const blank = (): {
  body: Parts;
  head: Parts;
  accent: Parts;
  glow: Parts;
  leg: Parts;
  armL: Parts;
  armR: Parts;
} => ({ body: [], head: [], accent: [], glow: [], leg: [], armL: [], armR: [] });

function grunt(): MobGeos {
  const p = blank();

  box(p.body, 0.62, 0.46, 0.4, 0, 0, 0);
  box(p.body, 0.5, 0.22, 0.34, 0, -0.33, 0);
  box(p.body, 0.58, 0.12, 0.38, 0, 0.3, 0);
  box(p.body, 0.26, 0.2, 0.26, -0.38, 0.27, 0);
  box(p.body, 0.26, 0.2, 0.26, 0.38, 0.27, 0);
  box(p.body, 0.36, 0.32, 0.18, 0, -0.02, -0.27);
  box(p.body, 0.24, 0.1, 0.26, 0, -0.45, 0);

  box(p.head, 0.42, 0.32, 0.4, 0, 0, 0);
  box(p.head, 0.34, 0.1, 0.42, 0, 0.17, 0.02);
  box(p.head, 0.08, 0.16, 0.28, -0.23, -0.02, 0);
  box(p.head, 0.08, 0.16, 0.28, 0.23, -0.02, 0);
  box(p.head, 0.18, 0.08, 0.08, 0, -0.18, 0.2);

  // The front plate is the grunt's whole identity: it eats most of the damage
  // that lands on the side it faces, so the player has to get around it.
  box(p.accent, 0.5, 0.62, 0.08, -0.12, 0, 0.3);
  box(p.accent, 0.58, 0.07, 0.1, -0.12, 0.32, 0.3);
  box(p.accent, 0.58, 0.07, 0.1, -0.12, -0.3, 0.3);
  cyl(p.accent, 0.15, 0.15, 0.16, 6, -0.46, 0.27, 0, 0, 0, Math.PI / 2);
  cyl(p.accent, 0.15, 0.15, 0.16, 6, 0.46, 0.27, 0, 0, 0, Math.PI / 2);
  box(p.accent, 0.3, 0.36, 0.12, 0, 0.03, -0.34);
  box(p.accent, 0.12, 0.12, 0.12, -0.2, 0.2, -0.34);
  box(p.accent, 0.12, 0.12, 0.12, 0.2, 0.2, -0.34);
  // The rifle is part of the torso asset: cheap, and it gives the grunt a clear
  // "soldier" read at the ranges this game actually fights at.
  box(p.accent, 0.1, 0.14, 0.58, 0.16, -0.04, 0.32);
  cyl(p.accent, 0.035, 0.035, 0.3, 6, 0.16, 0.0, 0.68, Math.PI / 2);
  box(p.accent, 0.14, 0.08, 0.18, 0.16, 0.02, 0.08);

  box(p.glow, 0.11, 0.05, 0.04, -0.1, 0.55, 0.21);
  box(p.glow, 0.11, 0.05, 0.04, 0.1, 0.55, 0.21);
  box(p.glow, 0.2, 0.05, 0.03, 0, 0.06, 0.28);
  box(p.glow, 0.04, 0.04, 0.22, 0.16, 0.03, 0.46);
  // The lit edge of the front plate — the tell that this one is armoured.
  box(p.glow, 0.04, 0.56, 0.04, 0.14, 0, 0.33);

  leg(p.leg);
  arm(p.armL, -1);
  arm(p.armR, 1);

  return {
    body: merged(p.body),
    head: merged(p.head),
    accent: merged(p.accent),
    glow: merged(p.glow),
    leg: merged(p.leg),
    armL: merged(p.armL),
    armR: merged(p.armR),
    armSwing: 0.16,
    armBaseL: -0.4,
    armBaseR: -0.4,
  };
}

function runner(): MobGeos {
  const p = blank();

  box(p.body, 0.48, 0.4, 0.32, 0, 0, 0.03, 0.12);
  box(p.body, 0.34, 0.2, 0.28, 0, -0.3, 0);
  box(p.body, 0.42, 0.1, 0.3, 0, 0.24, 0);
  box(p.body, 0.28, 0.22, 0.16, 0, 0.01, -0.24);
  box(p.body, 0.2, 0.08, 0.26, 0, 0.34, -0.04);

  octa(p.head, 0.44, 0.34, 0.52, 0, 0, 0.02);
  box(p.head, 0.08, 0.18, 0.34, 0, 0.17, -0.04);
  box(p.head, 0.16, 0.06, 0.2, 0, -0.11, 0.18);

  box(p.accent, 0.12, 0.05, 0.34, -0.34, 0.16, 0.02, 0, 0, -0.35);
  box(p.accent, 0.12, 0.05, 0.34, 0.34, 0.16, 0.02, 0, 0, 0.35);
  box(p.accent, 0.26, 0.22, 0.2, 0, -0.02, -0.3);
  cyl(p.accent, 0.08, 0.08, 0.12, 6, -0.1, 0.06, -0.4, Math.PI / 2);
  cyl(p.accent, 0.08, 0.08, 0.12, 6, 0.1, 0.06, -0.4, Math.PI / 2);
  box(p.accent, 0.3, 0.06, 0.16, 0, 0.34, 0.06);

  box(p.glow, 0.22, 0.05, 0.04, 0, 0.54, 0.23);
  box(p.glow, 0.18, 0.04, 0.03, 0, 0.36, 0.16);
  box(p.glow, 0.16, 0.05, 0.03, 0, 0.04, -0.41);
  box(p.glow, 0.05, 0.05, 0.05, -0.1, 0.06, -0.41);
  box(p.glow, 0.05, 0.05, 0.05, 0.1, 0.06, -0.41);

  leg(p.leg);
  arm(p.armL, -1, true);
  arm(p.armR, 1, true);

  return {
    body: merged(p.body),
    head: merged(p.head),
    accent: merged(p.accent),
    glow: merged(p.glow),
    leg: merged(p.leg),
    armL: merged(p.armL),
    armR: merged(p.armR),
    armSwing: 0.62,
    armBaseL: 0.08,
    armBaseR: 0.08,
  };
}

function tank(): MobGeos {
  const p = blank();

  box(p.body, 0.9, 0.54, 0.52, 0, 0, 0);
  box(p.body, 0.7, 0.24, 0.44, 0, -0.36, 0);
  box(p.body, 0.8, 0.14, 0.48, 0, 0.33, 0);
  box(p.body, 0.26, 0.24, 0.3, -0.5, 0.27, 0);
  box(p.body, 0.26, 0.24, 0.3, 0.5, 0.27, 0);
  box(p.body, 0.5, 0.42, 0.24, 0, 0.01, -0.31);
  box(p.body, 0.3, 0.12, 0.4, 0, -0.46, 0);

  box(p.head, 0.34, 0.28, 0.36, 0, 0, 0);
  box(p.head, 0.42, 0.08, 0.18, 0, 0.15, 0.11);
  box(p.head, 0.12, 0.12, 0.2, -0.24, -0.04, 0.08);
  box(p.head, 0.12, 0.12, 0.2, 0.24, -0.04, 0.08);
  box(p.head, 0.3, 0.1, 0.08, 0, -0.16, 0.18);

  box(p.accent, 0.54, 0.36, 0.1, 0, 0.02, 0.29);
  box(p.accent, 0.18, 0.08, 0.06, 0, 0.16, 0.35);
  cyl(p.accent, 0.24, 0.28, 0.24, 6, -0.59, 0.27, 0, 0, 0, Math.PI / 2);
  cyl(p.accent, 0.24, 0.28, 0.24, 6, 0.59, 0.27, 0, 0, 0, Math.PI / 2);
  box(p.accent, 0.06, 0.16, 0.36, -0.72, 0.38, 0);
  box(p.accent, 0.06, 0.16, 0.36, 0.72, 0.38, 0);
  box(p.accent, 0.62, 0.16, 0.12, 0, 0.2, -0.34);
  cyl(p.accent, 0.08, 0.1, 0.34, 6, -0.2, 0.18, -0.46);
  cyl(p.accent, 0.08, 0.1, 0.34, 6, 0.2, 0.18, -0.46);
  box(p.accent, 0.16, 0.08, 0.46, -0.26, -0.16, 0.18);

  box(p.glow, 0.1, 0.05, 0.04, -0.09, 0.52, 0.2);
  box(p.glow, 0.1, 0.05, 0.04, 0.09, 0.52, 0.2);
  cyl(p.glow, 0.11, 0.11, 0.05, 10, 0, 0.04, 0.35, Math.PI / 2);
  box(p.glow, 0.04, 0.18, 0.03, -0.3, 0.06, 0.31);
  box(p.glow, 0.04, 0.18, 0.03, 0.3, 0.06, 0.31);
  box(p.glow, 0.18, 0.04, 0.03, 0, 0.35, 0.33);

  leg(p.leg, true);
  arm(p.armL, -1);
  arm(p.armR, 1);
  // The right arm carries a siege cannon built from a fat receiver and barrel.
  box(p.armR, 0.26, 0.26, 0.5, 0, -0.5, 0.24);
  cyl(p.armR, 0.09, 0.11, 0.42, 8, 0, -0.5, 0.6, Math.PI / 2);
  cyl(p.armR, 0.13, 0.13, 0.08, 8, 0, -0.5, 0.82, Math.PI / 2);

  return {
    body: merged(p.body),
    head: merged(p.head),
    accent: merged(p.accent),
    glow: merged(p.glow),
    leg: merged(p.leg),
    armL: merged(p.armL),
    armR: merged(p.armR),
    armSwing: 0.12,
    armBaseL: -0.15,
    armBaseR: -0.22,
  };
}

function sapper(): MobGeos {
  const p = blank();

  box(p.body, 0.58, 0.44, 0.38, 0, 0, 0);
  box(p.body, 0.42, 0.22, 0.32, 0, -0.32, 0);
  box(p.body, 0.52, 0.12, 0.36, 0, 0.28, 0);
  box(p.body, 0.34, 0.36, 0.2, 0, 0, -0.28);
  box(p.body, 0.24, 0.1, 0.28, 0, -0.44, 0);

  box(p.head, 0.38, 0.32, 0.4, 0, 0, 0);
  box(p.head, 0.42, 0.1, 0.38, 0, 0.17, 0.02);
  box(p.head, 0.08, 0.2, 0.22, -0.22, -0.02, 0);
  box(p.head, 0.08, 0.2, 0.22, 0.22, -0.02, 0);
  box(p.head, 0.16, 0.08, 0.1, 0, -0.17, 0.2);

  box(p.accent, 0.42, 0.24, 0.08, 0, 0.03, 0.23);
  box(p.accent, 0.16, 0.4, 0.2, -0.2, 0.02, -0.34);
  box(p.accent, 0.16, 0.4, 0.2, 0.2, 0.02, -0.34);
  box(p.accent, 0.46, 0.1, 0.24, 0, 0.25, -0.34);
  cyl(p.accent, 0.07, 0.07, 0.22, 6, -0.42, 0.27, 0.02, 0, 0, Math.PI / 2);
  box(p.accent, 0.14, 0.14, 0.14, 0.34, -0.26, 0.1);
  box(p.accent, 0.32, 0.08, 0.26, 0, -0.36, 0.02);
  box(p.accent, 0.04, 0.3, 0.04, 0.12, 0.38, -0.06);

  box(p.glow, 0.16, 0.1, 0.04, 0, 0.55, 0.21);
  box(p.glow, 0.16, 0.1, 0.04, 0, 0.55, -0.21);
  box(p.glow, 0.2, 0.05, 0.03, 0, 0.03, 0.28);
  box(p.glow, 0.1, 0.24, 0.03, -0.2, 0.04, -0.45);
  box(p.glow, 0.1, 0.24, 0.03, 0.2, 0.04, -0.45);
  box(p.glow, 0.05, 0.05, 0.05, 0.12, 0.55, -0.06);

  leg(p.leg);
  arm(p.armL, -1);
  arm(p.armR, 1);
  // A wide tool claw on the left arm gives the sapper its engineer silhouette.
  box(p.armL, 0.18, 0.16, 0.3, -0.04, -0.68, 0.18);
  box(p.armL, 0.06, 0.22, 0.16, -0.12, -0.8, 0.32, 0, 0, 0.35);
  box(p.armL, 0.06, 0.22, 0.16, 0.04, -0.8, 0.32, 0, 0, -0.35);

  return {
    body: merged(p.body),
    head: merged(p.head),
    accent: merged(p.accent),
    glow: merged(p.glow),
    leg: merged(p.leg),
    armL: merged(p.armL),
    armR: merged(p.armR),
    armSwing: 0.22,
    armBaseL: -0.25,
    armBaseR: -0.25,
  };
}

/** The WARDEN: a siege frame — broad hull, sensor mast, twin rocket pods. */
function warden(): MobGeos {
  const p = blank();

  // Hull: a wide, layered slab with shoulder towers and a heavy skirt.
  box(p.body, 1.1, 0.6, 0.62, 0, 0, 0);
  box(p.body, 0.9, 0.26, 0.52, 0, -0.42, 0);
  box(p.body, 1.0, 0.16, 0.58, 0, 0.38, 0);
  box(p.body, 0.34, 0.3, 0.34, -0.62, 0.3, 0);
  box(p.body, 0.34, 0.3, 0.34, 0.62, 0.3, 0);
  box(p.body, 0.62, 0.5, 0.3, 0, 0.02, -0.36);
  box(p.body, 0.44, 0.14, 0.52, 0, -0.54, 0);

  // Sensor mast: a slab head with a wide receiver dish.
  box(p.head, 0.4, 0.3, 0.42, 0, 0, 0);
  box(p.head, 0.56, 0.1, 0.24, 0, 0.16, 0.1);
  box(p.head, 0.14, 0.14, 0.24, -0.28, -0.05, 0.08);
  box(p.head, 0.14, 0.14, 0.24, 0.28, -0.05, 0.08);

  // The blast plating across the chest, and the heavy frame behind.
  box(p.accent, 0.66, 0.42, 0.12, 0, 0.02, 0.36);
  box(p.accent, 0.2, 0.1, 0.08, 0, 0.2, 0.41);
  box(p.accent, 0.08, 0.2, 0.4, -0.86, 0.4, 0);
  box(p.accent, 0.08, 0.2, 0.4, 0.86, 0.4, 0);
  box(p.accent, 0.78, 0.2, 0.14, 0, 0.24, -0.4);
  cyl(p.accent, 0.1, 0.12, 0.4, 6, -0.26, 0.2, -0.5);
  cyl(p.accent, 0.1, 0.12, 0.4, 6, 0.26, 0.2, -0.5);
  box(p.accent, 0.2, 0.1, 0.56, -0.4, -0.2, 0.22);
  box(p.accent, 0.2, 0.1, 0.56, 0.4, -0.2, 0.22);

  // Glows: the visor band, the core slit and the pod muzzles.
  box(p.glow, 0.16, 0.06, 0.04, -0.11, 0.66, 0.22);
  box(p.glow, 0.16, 0.06, 0.04, 0.11, 0.66, 0.22);
  cyl(p.glow, 0.14, 0.14, 0.06, 10, 0, 0.05, 0.42, Math.PI / 2);
  box(p.glow, 0.05, 0.26, 0.04, -0.4, 0.05, 0.38);
  box(p.glow, 0.05, 0.26, 0.04, 0.4, 0.05, 0.38);
  box(p.glow, 0.24, 0.05, 0.04, 0, 0.4, -0.48);

  // Limbs: siege-thick legs, and each arm ends in a rocket pod.
  leg(p.leg, true);
  arm(p.armL, -1);
  arm(p.armR, 1);
  box(p.armL, 0.34, 0.34, 0.6, 0, -0.55, 0.26);
  box(p.armR, 0.34, 0.34, 0.6, 0, -0.55, 0.26);
  cyl(p.armL, 0.11, 0.12, 0.2, 8, -0.09, -0.55, 0.6, Math.PI / 2);
  cyl(p.armL, 0.11, 0.12, 0.2, 8, 0.09, -0.55, 0.6, Math.PI / 2);
  cyl(p.armR, 0.11, 0.12, 0.2, 8, -0.09, -0.55, 0.6, Math.PI / 2);
  cyl(p.armR, 0.11, 0.12, 0.2, 8, 0.09, -0.55, 0.6, Math.PI / 2);

  return {
    body: merged(p.body),
    head: merged(p.head),
    accent: merged(p.accent),
    glow: merged(p.glow),
    leg: merged(p.leg),
    armL: merged(p.armL),
    armR: merged(p.armR),
    armSwing: 0.1,
    armBaseL: -0.1,
    armBaseR: -0.1,
  };
}

function geometries(kind: EnemyKind): MobGeos {
  let geo = cache.get(kind);
  if (!geo) {
    geo =
      kind === 'grunt'
        ? grunt()
        : kind === 'runner'
          ? runner()
          : kind === 'tank'
            ? tank()
            : kind === 'warden'
              ? warden()
              : sapper();
    cache.set(kind, geo);
  }
  return geo;
}

/**
 * One-frame, invisible pre-upload of every kind's geometry.
 *
 * The E2E suite measures `renderer.info.memory.geometries` between kill batches.
 * Without this, the first tank of wave 3 would upload seven buffers mid-sample
 * and read as a leak. The meshes are translucent and `frustumCulled = false`,
 * so they cost a handful of invisible draws on the first frame only; `Arena`
 * removes the group immediately after rendering.
 */
export function mobWarmup(): THREE.Group {
  const group = new THREE.Group();
  let i = 0;
  for (const kind of ['grunt', 'runner', 'tank', 'sapper', 'warden'] as const) {
    const geo = geometries(kind);
    for (const part of [geo.body, geo.head, geo.accent, geo.glow, geo.leg, geo.armL, geo.armR]) {
      const mesh = new THREE.Mesh(part, MAT.eye());
      mesh.position.set(i * 0.01, -1000, 0);
      mesh.frustumCulled = false;
      group.add(mesh);
      i++;
    }
  }
  return group;
}

/**
 * Build one articulated instance from the shared geometry cache.
 *
 * `body` and `head` are the only shootable parts; every other mesh is cosmetic
 * and deliberately stays out of the raycast list.
 */
export function buildMobRig(kind: EnemyKind, mats: MobMaterials): MobRig {
  const geo = geometries(kind);
  const L = LAYOUT[kind];
  const group = new THREE.Group();

  const body = new THREE.Mesh(geo.body, mats.body);
  body.position.y = L.bodyY;
  body.castShadow = true;

  const head = new THREE.Mesh(geo.head, mats.head);
  head.position.y = L.headY;
  head.castShadow = true;

  const accent = new THREE.Mesh(geo.accent, mats.accent);
  accent.castShadow = false;
  body.add(accent);

  const glow = new THREE.Mesh(geo.glow, mats.glow);
  glow.castShadow = false;
  body.add(glow);

  const armL = new THREE.Group();
  armL.position.set(-L.shoulderX, L.shoulderY, 0);
  armL.rotation.x = geo.armBaseL;
  const armLMesh = new THREE.Mesh(geo.armL, mats.body);
  armLMesh.castShadow = true;
  armL.add(armLMesh);

  const armR = new THREE.Group();
  armR.position.set(L.shoulderX, L.shoulderY, 0);
  armR.rotation.x = geo.armBaseR;
  const armRMesh = new THREE.Mesh(geo.armR, mats.body);
  armRMesh.castShadow = true;
  armR.add(armRMesh);

  const legL = new THREE.Group();
  legL.position.set(-L.hipX, L.hipY, 0);
  const legLMesh = new THREE.Mesh(geo.leg, mats.limb);
  legLMesh.castShadow = true;
  legL.add(legLMesh);

  const legR = new THREE.Group();
  legR.position.set(L.hipX, L.hipY, 0);
  const legRMesh = new THREE.Mesh(geo.leg, mats.limb);
  legRMesh.castShadow = true;
  legR.add(legRMesh);

  group.add(body, head, armL, armR, legL, legR);

  return {
    group,
    body,
    head,
    legL,
    legR,
    armL,
    armR,
    armSwing: geo.armSwing,
    armBaseL: geo.armBaseL,
    armBaseR: geo.armBaseR,
  };
}
