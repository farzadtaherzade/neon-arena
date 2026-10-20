import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { CAMERA, METEOR, WORLD } from '../game/config';
import type { CollisionWorld } from '../game/world/collision';
import { OBSTACLES, PLATFORM_H, PLATFORMS, RAMPS, REACTOR, starfieldPositions } from '../game/world/layout';
import { CapturePad } from './CapturePad';
import { mobWarmup } from './models/MobModel';
import { makeCover, makeDeck, makeRamp, makeReactor, makeWall } from './models/StructureKit';
import { makeFloorTexture } from './Textures';

/**
 * Renderer, scene, lights and every static mesh.
 *
 * Owns the one place where `layout.ts` data becomes geometry. The structure kit
 * bakes each prop into a lit shell and a neon trim pass, then Arena registers
 * authored AABBs from the source tables — never from the decorative overhang.
 * Meshes a bullet can stop on go into `solids` for `render/Pick.ts`.
 */
export class Arena {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly solids: THREE.Object3D[] = [];
  /** One capture pad per corner platform, in `PLATFORMS` order. */
  readonly pads: CapturePad[] = [];

  private yawObj = new THREE.Group();
  private pitchObj = new THREE.Group();

  /** The sky. Mutated in place by `setSkyTint`, so the renderer sees the change. */
  private readonly bg = new THREE.Color(0x07090f);
  private readonly skyBase = new THREE.Color(0x07090f);
  private readonly skyStorm = new THREE.Color(METEOR.SKY_COLOR);
  private readonly fog = new THREE.Fog(0x07090f, 34, 150);
  private hemi!: THREE.HemisphereLight;
  private readonly hemiBase = 1.15;
  /** Last applied sky tint, so the sky is only re-coloured when it changes. */
  private tint = -1;
  private reactorRings: THREE.Group[] = [];
  private reactorCore: THREE.Mesh | null = null;
  private reactorLight: THREE.PointLight | null = null;
  private mobWarmupGroup: THREE.Group | null = null;

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

    this.scene.background = this.bg;
    // Pushed out with the bigger floor: at 84 units a 22-unit near plane fogged
    // the far wall into nothing and killed the reactor's silhouette.
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(CAMERA.FOV, innerWidth / innerHeight, CAMERA.NEAR, CAMERA.FAR);
    this.yawObj.add(this.pitchObj);
    this.pitchObj.add(this.camera);
    this.scene.add(this.yawObj);

    this.lights();
    this.floor(rng);
    this.walls();
    this.cover();
    this.reactor();
    this.platforms();
    this.ramps();
    this.capturePads();
    this.stars(rng);
    this.mobWarmupGroup = mobWarmup();
    this.scene.add(this.mobWarmupGroup);

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
    // The warm-up exists only to upload the shared mob buffers before the E2E
    // suite starts sampling geometry counts. Drop it after the first frame.
    if (this.mobWarmupGroup) {
      this.scene.remove(this.mobWarmupGroup);
      this.mobWarmupGroup = null;
    }
  }

  /**
   * Bleed the sky toward the storm colour. `k` is 0 (normal) to 1 (full
   * shower); the fog follows the sky so the whole scene turns with it, and the
   * hemisphere light dips a little so the arena reads as under-lit.
   */
  setSkyTint(k: number): void {
    if (Math.abs(k - this.tint) < 0.005) return;
    this.tint = k;
    this.bg.copy(this.skyBase).lerp(this.skyStorm, k * METEOR.SKY_MIX);
    this.fog.color.copy(this.bg);
    this.hemi.intensity = this.hemiBase * (1 - k * METEOR.SKY_DIM);
  }

  /** Slow reactor life: rings counter-rotate and the containment light breathes. */
  update(elapsed: number): void {
    for (let i = 0; i < this.reactorRings.length; i++) {
      const ring = this.reactorRings[i];
      if (!ring) continue;
      ring.rotation.y = elapsed * (0.16 + i * 0.055) * (i % 2 === 0 ? 1 : -1);
    }
    if (this.reactorCore) {
      this.reactorCore.rotation.y = elapsed * 0.7;
      this.reactorCore.scale.y = 1 + Math.sin(elapsed * 1.6) * 0.03;
    }
    if (this.reactorLight) {
      this.reactorLight.intensity = 43 + Math.sin(elapsed * 1.7) * 7 + Math.sin(elapsed * 4.1) * 2;
    }
  }

  private lights(): void {
    // Dark warehouse mood, but the floor and props stay lit enough that the
    // enemies keep their body colours instead of reading as black silhouettes.
    this.hemi = new THREE.HemisphereLight(0x6f86b0, 0x2a3040, this.hemiBase);
    this.scene.add(this.hemi);
    this.scene.add(new THREE.AmbientLight(0x2e3448, 0.7));

    const sun = new THREE.DirectionalLight(0xffd9a0, 2.2);
    sun.position.set(36, 58, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -54;
    sun.shadow.camera.right = 54;
    sun.shadow.camera.top = 54;
    sun.shadow.camera.bottom = -54;
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 150;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);

    // Cool fill from the opposite side so enemies facing away from the key
    // light still show their body colours rather than going black.
    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.7);
    fill.position.set(-32, 38, -28);
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
    const length = ARENA + 2;
    const mkWall = (x: number, z: number, ry: number) => {
      const asset = makeWall(length, WALL_H);
      asset.group.position.set(x, 0, z);
      asset.group.rotation.y = ry;
      this.scene.add(asset.group);
      // The wall is long on local X; rotating by ±90° swaps the footprint.
      const halfX = ry === 0 ? length / 2 : 0.5;
      const halfZ = ry === 0 ? 0.5 : length / 2;
      this.blockAt(asset.solid, x, z, halfX, halfZ, WALL_H);
    };

    mkWall(0, -HALF - 0.5, 0);
    mkWall(0, HALF + 0.5, 0);
    mkWall(-HALF - 0.5, 0, Math.PI / 2);
    mkWall(HALF + 0.5, 0, Math.PI / 2);
  }

  private cover(): void {
    for (const [x, z, w, h, d] of OBSTACLES) {
      const asset = makeCover(w, h, d);
      asset.group.position.set(x, 0, z);
      this.scene.add(asset.group);
      this.blockAt(asset.solid, x, z, w / 2, d / 2, h);
    }
  }

  /**
   * The central reactor: the landmark every lane is navigated by, and the
   * reason the middle of the map is not a shooting gallery. Solid, not walkable.
   */
  private reactor(): void {
    const { x, z, w, h, d } = REACTOR;
    const asset = makeReactor(w, h, d);
    asset.group.position.set(x, 0, z);
    this.scene.add(asset.group);
    this.blockAt(asset.solid, x, z, w / 2, d / 2, h);
    this.reactorRings = asset.rings;
    this.reactorCore = asset.core;
    this.reactorLight = asset.light;
  }

  private platforms(): void {
    for (const [x, z, w, h, d] of PLATFORMS) {
      const asset = makeDeck(w, h, d);
      asset.group.position.set(x, 0, z);
      this.scene.add(asset.group);
      this.blockAt(asset.solid, x, z, w / 2, d / 2, h);
    }
  }

  /**
   * One tower top per deck: capture pad, mast and beacon. The mast is a real
   * collider, so the pad is something you circle rather than stand on dead
   * centre. Only the wave's live pad is drawn — the beacons carry the rest.
   */
  private capturePads(): void {
    for (const [x, z] of PLATFORMS) {
      const pad = new CapturePad({ x, z, y: PLATFORM_H });
      pad.addTo(this.scene);
      this.blockObject(pad.mast);
      this.pads.push(pad);
    }
  }

  /**
   * Ramps as solid wedges. The hypotenuse runs from the floor at the mouth to
   * `PLATFORM_H` at the back edge, which is exactly the surface the collision
   * world walks you up — mesh and collider are built from the same numbers, so
   * they cannot drift apart.
   */
  private ramps(): void {
    for (const [x, z, width, length, upX, upZ] of RAMPS) {
      const asset = makeRamp(width, length, PLATFORM_H);
      asset.group.position.set(x, 0, z);
      // Build in local +x and mirror the whole ramp for the -x / -z cases, so
      // there is one geometry path instead of two mirrored ones.
      if (upX < 0 || upZ < 0) asset.group.rotation.y = Math.PI;
      this.scene.add(asset.group);
      this.solids.push(asset.solid);

      const spanX = upX !== 0 ? length : width;
      const spanZ = upZ !== 0 ? length : width;
      this.collision.addRamp({
        minX: x - spanX / 2,
        maxX: x + spanX / 2,
        minZ: z - spanZ / 2,
        maxZ: z + spanZ / 2,
        lowY: 0,
        highY: PLATFORM_H,
        upX,
        upZ,
      });
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

  /**
   * Register a world-space AABB from the authored layout. Passing the dimensions
   * explicitly keeps a decorative lip or trim from widening a corridor.
   */
  private blockAt(
    mesh: THREE.Object3D,
    x: number,
    z: number,
    halfX: number,
    halfZ: number,
    top: number,
  ): void {
    this.solids.push(mesh);
    this.collision.addObstacle({ minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ }, top);
  }

  /**
   * For a one-off prop whose mesh already carries its world transform (the
   * capture mast). Not used for the kit, whose trim deliberately overhangs.
   */
  private blockObject(mesh: THREE.Mesh): void {
    this.solids.push(mesh);
    mesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(mesh);
    this.collision.addObstacle(
      { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z },
      box.max.y,
    );
  }
}
