import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { CAMERA, WORLD } from '../game/config';
import type { CollisionWorld } from '../game/world/collision';
import { OBSTACLES, starfieldPositions } from '../game/world/layout';
import { MAT } from './Materials';
import { makeFloorTexture } from './Textures';

/**
 * Renderer, scene, lights and every static mesh.
 *
 * Owns the one place where `layout.ts` data becomes geometry. Boxes are handed
 * to the collision world as plain AABBs, and meshes a bullet can stop on go
 * into `solids` for `render/Pick.ts`.
 */
export class Arena {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly solids: THREE.Object3D[] = [];

  private yawObj = new THREE.Group();
  private pitchObj = new THREE.Group();

  constructor(
    private readonly collision: CollisionWorld,
    rng: Rng,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    document.body.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x07090f);
    this.scene.fog = new THREE.Fog(0x07090f, 22, 90);

    this.camera = new THREE.PerspectiveCamera(CAMERA.FOV, innerWidth / innerHeight, CAMERA.NEAR, CAMERA.FAR);
    this.yawObj.add(this.pitchObj);
    this.pitchObj.add(this.camera);
    this.scene.add(this.yawObj);

    this.lights();
    this.floor(rng);
    this.walls();
    this.cover();
    this.stars(rng);

    addEventListener('resize', () => this.resize());
  }

  get rig(): { yawObj: THREE.Group; pitchObj: THREE.Group } {
    return { yawObj: this.yawObj, pitchObj: this.pitchObj };
  }

  resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private lights(): void {
    // Dark warehouse: cold dim shell, one warm work lamp raking the floor.
    this.scene.add(new THREE.HemisphereLight(0x32405a, 0x14171f, 0.7));
    this.scene.add(new THREE.AmbientLight(0x22283a, 0.55));

    const sun = new THREE.DirectionalLight(0xffd9a0, 1.5);
    sun.position.set(25, 42, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -38;
    sun.shadow.camera.right = 38;
    sun.shadow.camera.top = 38;
    sun.shadow.camera.bottom = -38;
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 110;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
  }

  private floor(rng: Rng): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.ARENA, WORLD.ARENA),
      new THREE.MeshStandardMaterial({ map: makeFloorTexture(rng), roughness: 0.85, metalness: 0.2 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.solids.push(floor);
  }

  private walls(): void {
    const { ARENA, HALF, WALL_H } = WORLD;
    const mkWall = (w: number, x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, 1), MAT.wall());
      m.position.set(x, WALL_H / 2, z);
      m.rotation.y = ry;
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this.block(m);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 1.04), MAT.trim());
      trim.position.set(x, WALL_H + 0.06, z);
      trim.rotation.y = ry;
      this.scene.add(trim);
    };

    mkWall(ARENA + 2, 0, -HALF - 0.5, 0);
    mkWall(ARENA + 2, 0, HALF + 0.5, 0);
    mkWall(ARENA + 2, -HALF - 0.5, 0, Math.PI / 2);
    mkWall(ARENA + 2, HALF + 0.5, 0, Math.PI / 2);
  }

  private cover(): void {
    for (const [x, z, w, h, d] of OBSTACLES) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT.obstacle());
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this.block(m);

      const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.08, d + 0.04), MAT.glow());
      strip.position.set(x, h + 0.04, z);
      this.scene.add(strip);
    }
  }

  private stars(rng: Rng): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(starfieldPositions(rng), 3));
    this.scene.add(
      new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          color: 0xaaccff,
          size: 1.4,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.8,
          fog: false,
        }),
      ),
    );
  }

  /** Register a mesh as both a bullet blocker and a movement obstacle. */
  private block(mesh: THREE.Mesh): void {
    this.solids.push(mesh);
    mesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(mesh);
    this.collision.addObstacle({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z });
  }
}
