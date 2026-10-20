import * as THREE from 'three';
import { BOMB, METEOR } from '../game/config';

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
let gAccent: THREE.BoxGeometry | undefined;
let gBomb: THREE.SphereGeometry | undefined;
let gBombRing: THREE.RingGeometry | undefined;
let gXpOrb: THREE.IcosahedronGeometry | undefined;
let gRock: THREE.DodecahedronGeometry | undefined;
let gMeteorRing: THREE.RingGeometry | undefined;

export const GEO = {
  body: () => (gBody ??= new THREE.BoxGeometry(0.66, 0.85, 0.4)),
  head: () => (gHead ??= new THREE.BoxGeometry(0.4, 0.36, 0.4)),
  eye: () => (gEye ??= new THREE.BoxGeometry(0.09, 0.09, 0.05)),
  /** A unit box the cosmetic accents scale into shape, so only one geometry exists. */
  accent: () => (gAccent ??= new THREE.BoxGeometry(1, 1, 1)),
  leg: () => (gLeg ??= new THREE.BoxGeometry(0.2, 0.5, 0.24)),
  barBg: () => (gBarBg ??= new THREE.BoxGeometry(0.92, 0.1, 0.02)),
  barFg: () => (gBarFg ??= new THREE.BoxGeometry(0.86, 0.06, 0.02)),
  bombBody: () => (gBomb ??= new THREE.SphereGeometry(BOMB.BODY_R, 14, 10)),
  bombRing: () => (gBombRing ??= new THREE.RingGeometry(BOMB.RADIUS - 0.15, BOMB.RADIUS, 48)),
  /** The XP pickup orb. Shared: a dead enemy must never add a geometry to the scene. */
  xpOrb: () => (gXpOrb ??= new THREE.IcosahedronGeometry(0.16, 0)),
  /** A meteor: a chipped rock, shared by every stone in the sky. */
  rock: () => (gRock ??= new THREE.DodecahedronGeometry(METEOR.ROCK_R, 0)),
  /** The ground marker under a falling stone. */
  meteorRing: () => (gMeteorRing ??= new THREE.RingGeometry(METEOR.RADIUS - 0.2, METEOR.RADIUS, 40)),
};

let mEye: THREE.MeshBasicMaterial | undefined;
let mBarBg: THREE.MeshBasicMaterial | undefined;
let mBarFg: THREE.MeshBasicMaterial | undefined;
let mWall: THREE.MeshStandardMaterial | undefined;
let mTrim: THREE.MeshBasicMaterial | undefined;
let mHazard: THREE.MeshBasicMaterial | undefined;
let mPanel: THREE.MeshStandardMaterial | undefined;
let mObstacle: THREE.MeshStandardMaterial | undefined;
let mGlow: THREE.MeshBasicMaterial | undefined;
let mMagenta: THREE.MeshBasicMaterial | undefined;
let mCore: THREE.MeshBasicMaterial | undefined;
let mStructure: THREE.MeshStandardMaterial | undefined;
let mStructureGlow: THREE.MeshBasicMaterial | undefined;
let mHalo: THREE.MeshBasicMaterial | undefined;
let mGunMetal: THREE.MeshStandardMaterial | undefined;
let mGunDark: THREE.MeshStandardMaterial | undefined;
let mMuzzleFlash: THREE.MeshBasicMaterial | undefined;
let mBombRing: THREE.MeshBasicMaterial | undefined;
let mRock: THREE.MeshStandardMaterial | undefined;

export const MAT = {
  eye: () => (mEye ??= new THREE.MeshBasicMaterial({ color: 0xffe08a })),
  barBg: () =>
    (mBarBg ??= new THREE.MeshBasicMaterial({ color: 0x0a0d13, transparent: true, opacity: 0.75 })),
  barFg: () => (mBarFg ??= new THREE.MeshBasicMaterial({ color: 0xff3344 })),

  wall: () =>
    (mWall ??= new THREE.MeshStandardMaterial({ color: 0x232a3a, roughness: 0.85, metalness: 0.18 })),
  trim: () => (mTrim ??= new THREE.MeshBasicMaterial({ color: 0x2aa5c4 })),
  /** Hazard yellow used on floor paint, crate caps and wall bands. */
  hazard: () => (mHazard ??= new THREE.MeshBasicMaterial({ color: 0xf2b21e })),
  /** Painted metal panel on crates: warm industrial colour, not glowing. */
  panel: () =>
    (mPanel ??= new THREE.MeshStandardMaterial({ color: 0xa8741b, roughness: 0.7, metalness: 0.15 })),
  obstacle: () =>
    (mObstacle ??= new THREE.MeshStandardMaterial({ color: 0x242c44, roughness: 0.75, metalness: 0.12 })),
  glow: () => (mGlow ??= new THREE.MeshBasicMaterial({ color: 0x46e0ff })),
  /** Reactor accent: hot magenta, the third colour in the map's palette. */
  magenta: () => (mMagenta ??= new THREE.MeshBasicMaterial({ color: 0xff3ba8 })),
  /** Additive column rising out of the reactor core. */
  core: () =>
    (mCore ??= new THREE.MeshBasicMaterial({
      color: 0xff3ba8,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })),

  /**
   * The structural asset kit bakes its palette into vertex colours, so every
   * cover block, deck and wall is one draw call instead of a dozen. The base
   * colour stays white; the buffers carry the actual industrial palette.
   */
  structure: () =>
    (mStructure ??= new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.76,
      metalness: 0.18,
    })),
  /** Unlit hazard paint and neon trim, merged into one glow mesh per asset. */
  structureGlow: () =>
    (mStructureGlow ??= new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
    })),
  /** Soft magenta wash on the floor around the reactor. */
  halo: () =>
    (mHalo ??= new THREE.MeshBasicMaterial({
      color: 0xff3ba8,
      transparent: true,
      opacity: 0.11,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })),

  // The viewmodel sits against a dark arena: near-black metal read as a
  // silhouette, so the body is lifted well above the background.
  gunMetal: () =>
    (mGunMetal ??= new THREE.MeshStandardMaterial({ color: 0x5a6478, roughness: 0.45, metalness: 0.2 })),
  gunDark: () =>
    (mGunDark ??= new THREE.MeshStandardMaterial({ color: 0x2e3442, roughness: 0.6, metalness: 0.15 })),
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
  /** The falling rock: dark stone, lit by the scene. */
  rock: () => (mRock ??= new THREE.MeshStandardMaterial({ color: 0x3a2f2c, roughness: 0.9, metalness: 0.1 })),
};
