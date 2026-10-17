import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { CAMERA, WORLD } from '../game/config';
import type { CollisionWorld } from '../game/world/collision';
import { OBSTACLES, PLATFORMS, RAMPS, starfieldPositions } from '../game/world/layout';
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
    this.renderer.toneMappingExposure = 1.3;
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
    this.platforms();
    this.ramps();
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
    // Dark warehouse mood, but the floor and props stay lit enough that the
    // enemies keep their body colours instead of reading as black silhouettes.
    this.scene.add(new THREE.HemisphereLight(0x6f86b0, 0x2a3040, 1.15));
    this.scene.add(new THREE.AmbientLight(0x2e3448, 0.7));

    const sun = new THREE.DirectionalLight(0xffd9a0, 2.2);
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

    // Cool fill from the opposite side so enemies facing away from the key
    // light still show their body colours rather than going black.
    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.7);
    fill.position.set(-22, 26, -18);
    this.scene.add(fill);
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

      // Painted hazard band across the middle of the wall.
      const band = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, 1.06), MAT.hazard());
      band.position.set(x, WALL_H * 0.5, z);
      band.rotation.y = ry;
      this.scene.add(band);
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

      const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.08, d + 0.04), MAT.hazard());
      strip.position.set(x, h + 0.04, z);
      this.scene.add(strip);

      // Painted panel band around the middle of each crate.
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, h * 0.34, d + 0.03), MAT.panel());
      panel.position.set(x, h * 0.5, z);
      this.scene.add(panel);
    }
  }

  private platforms(): void {
    for (const [x, z, w, h, d] of PLATFORMS) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT.obstacle());
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this.block(m);

      // Glowing trim around the platform top edge
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.08, d + 0.04), MAT.trim());
      trim.position.set(x, h + 0.04, z);
      this.scene.add(trim);

      // Hazard band on the platform sides
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, 0.18, d + 0.03), MAT.hazard());
      band.position.set(x, h * 0.5, z);
      this.scene.add(band);
    }
  }

  private ramps(): void {
    for (const [x, z, w, h, d, ry] of RAMPS) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT.wall());
      m.position.set(x, h / 2, z);
      m.rotation.y = ry;
      // Slight pitch slope angle
      m.rotation.z = ry === 0 ? 0.12 : -0.12;
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this.solids.push(m);
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
