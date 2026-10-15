import * as THREE from 'three';
import { BOMB } from '../game/config';

/**
 * Lazily-created, shared geometry and materials.
 *
 * Anything returned here must be treated as immutable and must never be
 * disposed — these objects live for the whole page session. Per-instance state
 * (an enemy's hit flash) has to be expressed as a transform on the mesh that
 * uses the shared resource, never by mutating it.
 *
 * The one exception is an enemy's body/head/leg materials, which stay per-enemy
 * because the hit flash writes `emissive` on them; `EnemyView` creates and
 * disposes those.
 *
 * Each entry is a lazily-initialised field rather than a hashed Map lookup, so
 * the hot path (every spawn) is a null check.
 */

let gBody: THREE.BoxGeometry | undefined;
let gHead: THREE.BoxGeometry | undefined;
let gEye: THREE.BoxGeometry | undefined;
let gLeg: THREE.BoxGeometry | undefined;
let gBarBg: THREE.BoxGeometry | undefined;
let gBarFg: THREE.BoxGeometry | undefined;
let gBomb: THREE.SphereGeometry | undefined;
let gBombRing: THREE.RingGeometry | undefined;

export const GEO = {
  body: () => (gBody ??= new THREE.BoxGeometry(0.66, 0.85, 0.4)),
  head: () => (gHead ??= new THREE.BoxGeometry(0.4, 0.36, 0.4)),
  eye: () => (gEye ??= new THREE.BoxGeometry(0.09, 0.09, 0.05)),
  leg: () => (gLeg ??= new THREE.BoxGeometry(0.2, 0.5, 0.24)),
  barBg: () => (gBarBg ??= new THREE.BoxGeometry(0.92, 0.1, 0.02)),
  barFg: () => (gBarFg ??= new THREE.BoxGeometry(0.86, 0.06, 0.02)),
  bombBody: () => (gBomb ??= new THREE.SphereGeometry(BOMB.BODY_R, 14, 10)),
  bombRing: () => (gBombRing ??= new THREE.RingGeometry(BOMB.RADIUS - 0.15, BOMB.RADIUS, 48)),
};

let mEye: THREE.MeshBasicMaterial | undefined;
let mBarBg: THREE.MeshBasicMaterial | undefined;
let mBarFg: THREE.MeshBasicMaterial | undefined;
let mWall: THREE.MeshStandardMaterial | undefined;
let mTrim: THREE.MeshBasicMaterial | undefined;
let mObstacle: THREE.MeshStandardMaterial | undefined;
let mGlow: THREE.MeshBasicMaterial | undefined;
let mGunMetal: THREE.MeshStandardMaterial | undefined;
let mGunDark: THREE.MeshStandardMaterial | undefined;
let mMuzzleFlash: THREE.MeshBasicMaterial | undefined;
let mBombRing: THREE.MeshBasicMaterial | undefined;

export const MAT = {
  eye: () => (mEye ??= new THREE.MeshBasicMaterial({ color: 0xffe08a })),
  barBg: () =>
    (mBarBg ??= new THREE.MeshBasicMaterial({ color: 0x0a0d13, transparent: true, opacity: 0.75 })),
  barFg: () => (mBarFg ??= new THREE.MeshBasicMaterial({ color: 0xff3344 })),

  wall: () => (mWall ??= new THREE.MeshStandardMaterial({ color: 0x2a3448, roughness: 0.8, metalness: 0.2 })),
  trim: () => (mTrim ??= new THREE.MeshBasicMaterial({ color: 0x2aa5c4 })),
  obstacle: () =>
    (mObstacle ??= new THREE.MeshStandardMaterial({ color: 0x2b3550, roughness: 0.7, metalness: 0.12 })),
  glow: () => (mGlow ??= new THREE.MeshBasicMaterial({ color: 0x46e0ff })),

  gunMetal: () =>
    (mGunMetal ??= new THREE.MeshStandardMaterial({ color: 0x1f2430, roughness: 0.5, metalness: 0.15 })),
  gunDark: () =>
    (mGunDark ??= new THREE.MeshStandardMaterial({ color: 0x161a22, roughness: 0.65, metalness: 0.1 })),
  muzzleFlash: () =>
    (mMuzzleFlash ??= new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    })),
  bombRing: () =>
    (mBombRing ??= new THREE.MeshBasicMaterial({
      color: 0xff3b30,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    })),
};
