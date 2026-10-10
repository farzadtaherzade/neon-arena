import THREE from './three.js';

/**
 * Lazily-created, shared geometry and materials.
 *
 * Anything returned from here must be treated as immutable and must never be
 * disposed — these objects live for the whole page session. Per-instance state
 * (an enemy's health bar fill, a hit flash) has to be expressed as an Object3D
 * transform on the mesh that uses the shared resource, never by mutating it.
 *
 * The one exception is an enemy's body/head/leg materials, which stay per-enemy
 * because `Enemy.flash` writes `emissive` on them; those are created in
 * enemy.js and disposed with the enemy.
 */

const cache = new Map();

function shared(key, create) {
  let value = cache.get(key);
  if (!value) {
    value = create();
    cache.set(key, value);
  }
  return value;
}

export const GEO = {
  body:  () => shared('geo.body',  () => new THREE.BoxGeometry(0.66, 0.85, 0.4)),
  head:  () => shared('geo.head',  () => new THREE.BoxGeometry(0.4, 0.36, 0.4)),
  eye:   () => shared('geo.eye',   () => new THREE.BoxGeometry(0.09, 0.09, 0.05)),
  leg:   () => shared('geo.leg',   () => new THREE.BoxGeometry(0.2, 0.5, 0.24)),
  barBg: () => shared('geo.barBg', () => new THREE.BoxGeometry(0.92, 0.1, 0.02)),
  barFg: () => shared('geo.barFg', () => new THREE.BoxGeometry(0.86, 0.06, 0.02)),
};

export const MAT = {
  // Enemy visuals that are never flash-mutated, so they can be global.
  eye: () => shared('mat.eye', () => new THREE.MeshBasicMaterial({ color: 0xffe08a })),

  // Health bars: only the mesh transform changes as HP drains, never the material.
  barBg: () => shared('mat.barBg', () =>
    new THREE.MeshBasicMaterial({ color: 0x0a0d13, transparent: true, opacity: 0.75 })),
  barFg: () => shared('mat.barFg', () => new THREE.MeshBasicMaterial({ color: 0xff3344 })),

  // Static world.
  wall: () => shared('mat.wall', () =>
    new THREE.MeshStandardMaterial({ color: 0x2a3448, roughness: 0.8, metalness: 0.2 })),
  trim: () => shared('mat.trim', () => new THREE.MeshBasicMaterial({ color: 0x2aa5c4 })),
  obstacle: () => shared('mat.obstacle', () =>
    new THREE.MeshStandardMaterial({ color: 0x2b3550, roughness: 0.7, metalness: 0.12 })),
  glow: () => shared('mat.glow', () => new THREE.MeshBasicMaterial({ color: 0x46e0ff })),

  // Weapon viewmodel.
  gunMetal: () => shared('mat.gunMetal', () =>
    new THREE.MeshStandardMaterial({ color: 0x1f2430, roughness: 0.5, metalness: 0.15 })),
  gunDark: () => shared('mat.gunDark', () =>
    new THREE.MeshStandardMaterial({ color: 0x161a22, roughness: 0.65, metalness: 0.1 })),
  muzzleFlash: () => shared('mat.muzzleFlash', () =>
    new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    })),
};