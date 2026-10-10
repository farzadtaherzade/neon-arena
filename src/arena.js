import THREE from './three.js';
import { WORLD } from './config.js';
import { MAT } from './materials.js';
import { makeFloorTexture } from './textures.js';

/** Cover blocks, as [x, z, width, height, depth]. */
const OBSTACLES = [
  [-10, -8, 4, 3, 4], [12, -14, 5, 2.5, 3], [8, 10, 3, 4, 3],
  [-14, 12, 4, 2, 4], [0, -20, 6, 3.5, 2], [-20, -2, 3, 3, 6],
  [18, 18, 4, 3, 4], [-4, 20, 5, 2.5, 3],
];

const STAR_COUNT = 420;
const STAR_RADIUS = 130;

export function buildArena(scene, collision) {
  buildFloor(scene, collision);
  buildWalls(scene, collision);
  buildCover(scene, collision);
  buildStarfield(scene);
}

function buildFloor(scene, collision) {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.ARENA, WORLD.ARENA),
    new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.85, metalness: 0.2 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  collision.addSolid(floor);
}

function buildWalls(scene, collision) {
  const { ARENA, HALF, WALL_H } = WORLD;

  const mkWall = (w, x, z, ry) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, 1), MAT.wall());
    m.position.set(x, WALL_H / 2, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    collision.addBlocker(m);

    const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 1.04), MAT.trim());
    trim.position.set(x, WALL_H + 0.06, z);
    trim.rotation.y = ry;
    scene.add(trim);
  };

  mkWall(ARENA + 2, 0, -HALF - 0.5, 0);
  mkWall(ARENA + 2, 0, HALF + 0.5, 0);
  mkWall(ARENA + 2, -HALF - 0.5, 0, Math.PI / 2);
  mkWall(ARENA + 2, HALF + 0.5, 0, Math.PI / 2);
}

function buildCover(scene, collision) {
  for (const [x, z, w, h, d] of OBSTACLES) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT.obstacle());
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    collision.addBlocker(m);

    const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.08, d + 0.04), MAT.glow());
    strip.position.set(x, h + 0.04, z);
    scene.add(strip);
  }
}

function buildStarfield(scene) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const e = Math.random() * 0.9 + 0.08;
    positions[i * 3] = Math.cos(a) * Math.cos(e) * STAR_RADIUS;
    positions[i * 3 + 1] = Math.sin(e) * STAR_RADIUS;
    positions[i * 3 + 2] = Math.sin(a) * Math.cos(e) * STAR_RADIUS;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xaaccff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false,
  })));
}