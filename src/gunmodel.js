import THREE from './three.js';
import { WEAPON } from './config.js';
import { MAT } from './materials.js';

/**
 * First-person weapon viewmodel, parented to the camera.
 *
 * Returns the group plus the anchors the weapon needs: an Object3D marking the
 * muzzle (tracer origin) and an additive flash pair with a short-lived point light.
 */
export function buildGun() {
  const [rx, ry, rz] = WEAPON.GUN_REST;

  const group = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.44), MAT.gunMetal());
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.34), MAT.gunDark());
  barrel.position.set(0, 0.02, -0.36);
  const brake = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), MAT.gunMetal());
  brake.position.set(0, 0.02, -0.52);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.2, 0.11), MAT.gunDark());
  grip.position.set(0, -0.15, 0.12);
  grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.12), MAT.gunDark());
  sight.position.set(0, 0.1, -0.05);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.02, 0.3), MAT.glow());
  strip.position.set(0, -0.03, -0.05);
  group.add(body, barrel, brake, grip, sight, strip);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.58);
  group.add(muzzle);

  const flash = new THREE.Group();
  const a = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), MAT.muzzleFlash());
  const b = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), MAT.muzzleFlash());
  b.rotation.x = Math.PI / 2;
  flash.add(a, b);
  flash.position.copy(muzzle.position);
  flash.visible = false;
  group.add(flash);

  const flashLight = new THREE.PointLight(0xffa040, 0, 11, 2);
  flashLight.position.copy(muzzle.position);
  group.add(flashLight);

  group.position.set(rx, ry, rz);
  group.visible = false;

  return { group, muzzle, flash, flashLight };
}