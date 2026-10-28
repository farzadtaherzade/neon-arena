import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Rng } from '../core/rng';
import { BLOOM, CAMERA, DEFAULT_THEME, METEOR, THEMES, type ThemeDef, VIDEO, WORLD } from '../game/config';
import type { CollisionWorld } from '../game/world/collision';
import {
  OBSTACLES,
  PLATFORM_H,
  PLATFORMS,
  RAMPS,
  REACTOR,
  rampRotation,
  starfieldPositions,
} from '../game/world/layout';
import { CapturePad } from './CapturePad';
import { ClockTower } from './ClockTower';
import { GEO, MAT } from './Materials';
import { mobWarmup } from './models/MobModel';
import { coverAccents, makeCover, makeDeck, makeRamp, makeReactor, makeWall } from './models/StructureKit';
import { makeFloorTexture } from './Textures';

/** Where the corner accent lights sit, and where the clock tower stands. */
const CORNER_LIGHTS: readonly (readonly [number, number])[] = [
  [-40, -40],
  [-40, 40],
  [40, -40],
  [40, 40],
];

/** The clock tower stands in the north-west corner, clear of the maze. */
const CLOCK_TOWER: readonly [number, number] = [-36, -36];

/**
 * Renderer, scene, lights and every static mesh.
 *
 * Owns the one place where `layout.ts` data becomes geometry. The structure kit
 * bakes the active theme's palette into a lit shell and a neon trim pass, then
 * Arena registers authored AABBs from the source tables — never from the
 * decorative overhang. Meshes a bullet can stop on go into `solids` for
 * `render/Pick.ts`.
 *
 * A theme swap rebuilds the static world: the old group's geometries are
 * disposed, the meshes are rebuilt from the same layout tables with the new
 * palette, and collision is *not* re-registered — the theme never moves a wall.
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

  /** Every static mesh lives here, so a theme swap can drop and rebuild it. */
  private readonly worldGroup = new THREE.Group();

  /** The active theme; the builders read their colours from it. */
  private theme: ThemeDef = THEMES[DEFAULT_THEME];

  /**
   * False while a theme rebuild is in flight: the meshes are rebuilt from the
   * same layout tables, so registering their AABBs again would stack colliders.
   */
  private registerCollision = true;

  /** The sky. Mutated in place by `setSkyTint`, so the renderer sees the change. */
  private readonly bg = new THREE.Color(0x0c1222);
  private readonly skyBase = new THREE.Color(0x0c1222);
  private readonly skyStorm = new THREE.Color(METEOR.SKY_COLOR);
  private readonly fog = new THREE.Fog(0x0c1222, 52, 210);
  private hemi!: THREE.HemisphereLight;
  /** Base hemisphere intensity; the storm dips it by a fraction. */
  private hemiBase = 1.35;
  private ambient!: THREE.AmbientLight;
  private cornerLamps: THREE.PointLight[] = [];
  private sun!: THREE.DirectionalLight;
  private fill!: THREE.DirectionalLight;
  /** Last applied sky tint, so the sky is only re-coloured when it changes. */
  private tint = -1;
  private reactorRings: THREE.Group[] = [];
  private reactorCore: THREE.Mesh | null = null;
  private reactorLight: THREE.PointLight | null = null;
  private mobWarmupGroup: THREE.Group | null = null;
  /** Materials created per world build (floor, stars) — disposed on rebuild. */
  private ownedMats: THREE.Material[] = [];
  private readonly rng: Rng;

  /** The clock tower landmark, with its live face. */
  clock: ClockTower | null = null;

  /** Video options from the settings panel, and the values they currently hold. */
  private video = { quality: 2, shadows: true, fog: true, theme: DEFAULT_THEME as string, bloom: false };

  /**
   * The post pipeline, built lazily the first time bloom is switched on so a
   * player who never enables it never pays for a render target. With the
   * composer active, `OutputPass` owns tone mapping and the sRGB conversion.
   */
  private composer: EffectComposer | null = null;

  constructor(
    private readonly collision: CollisionWorld,
    rng: Rng,
  ) {
    this.rng = rng;
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
    this.scene.add(this.worldGroup);

    this.camera = new THREE.PerspectiveCamera(CAMERA.FOV, innerWidth / innerHeight, CAMERA.NEAR, CAMERA.FAR);
    this.yawObj.add(this.pitchObj);
    this.pitchObj.add(this.camera);
    this.scene.add(this.yawObj);

    this.lights();
    // Builds the static world and colours the lights for the default theme.
    this.applyTheme(DEFAULT_THEME);
    this.capturePads();
    this.mobWarmupGroup = mobWarmup();
    // A meteor's rock, its marker ring and a bomb's shell and blast ring upload
    // to the GPU the first time one is used, which can land in the middle of a
    // measurement and read as a leak. Warm them with the mobs so the counts
    // settle before anyone samples them — and so the first stone of a shower
    // and the first bomb of a panicking sapper never hitch.
    for (const geo of [GEO.rock(), GEO.meteorRing(), GEO.bombBody(), GEO.bombRing()]) {
      const mesh = new THREE.Mesh(geo, MAT.eye());
      mesh.position.set(0, -1000, 0);
      mesh.rotation.x = -Math.PI / 2;
      mesh.frustumCulled = false;
      this.mobWarmupGroup.add(mesh);
    }
    this.scene.add(this.mobWarmupGroup);

    addEventListener('resize', () => this.resize());
  }

  get rig(): { yawObj: THREE.Group; pitchObj: THREE.Group } {
    return { yawObj: this.yawObj, pitchObj: this.pitchObj };
  }

  /**
   * Apply the video options.
   *
   * Only the values that actually changed are touched: switching the shadow map
   * on or off forces every material to recompile, which is far too expensive
   * to do on every settings change, and a theme swap rebuilds the world.
   */
  setVideo(video: { quality: number; shadows: boolean; fog: boolean; theme: string; bloom: boolean }): void {
    if (video.shadows !== this.video.shadows) {
      this.video.shadows = video.shadows;
      this.renderer.shadowMap.enabled = video.shadows;
      // The renderer compiles materials per shadow setting, so they need a nudge.
      this.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        const mat = mesh.material;
        if (!mat) return;
        if (Array.isArray(mat))
          mat.forEach((m) => {
            m.needsUpdate = true;
          });
        else mat.needsUpdate = true;
      });
    }
    if (video.fog !== this.video.fog) {
      this.video.fog = video.fog;
      this.scene.fog = video.fog ? this.fog : null;
    }
    if (video.quality !== this.video.quality) {
      this.video.quality = video.quality;
      const cap = VIDEO.QUALITY_PIXELS[video.quality] ?? 2;
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, cap));
    }
    if (video.theme !== this.video.theme) {
      this.video.theme = video.theme;
      this.applyTheme(video.theme);
    }
    if (video.bloom !== this.video.bloom) {
      this.video.bloom = video.bloom;
      if (video.bloom) this.ensureComposer();
    }
  }

  /** Build the post pipeline once; the bloom pass reads `BLOOM` from config. */
  private ensureComposer(): void {
    if (this.composer) return;
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    composer.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(innerWidth, innerHeight),
        BLOOM.STRENGTH,
        BLOOM.RADIUS,
        BLOOM.THRESHOLD,
      ),
    );
    composer.addPass(new OutputPass());
    composer.setSize(innerWidth, innerHeight);
    this.composer = composer;
  }

  resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer?.setSize(innerWidth, innerHeight);
  }

  render(): void {
    if (this.video.bloom && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    // The warm-up exists only to upload the shared mob buffers before the E2E
    // suite starts sampling geometry counts. Drop it after the first frame.
    if (this.mobWarmupGroup) {
      this.scene.remove(this.mobWarmupGroup);
      this.mobWarmupGroup = null;
    }
  }

  /**
   * Swap the arena theme: recolour the lights, sky and shared materials, then
   * rebuild the static meshes from the same layout tables with the new
   * palette. Render-only — collision, layout and gameplay are untouched.
   */
  applyTheme(id: string): void {
    const theme = THEMES[id as keyof typeof THEMES] ?? THEMES[DEFAULT_THEME];
    this.theme = theme;

    this.hemi.color.set(theme.hemiSky);
    this.hemi.groundColor.set(theme.hemiGround);
    this.hemiBase = theme.hemiIntensity;
    this.hemi.intensity = theme.hemiIntensity;
    this.ambient.color.set(theme.ambient);
    this.ambient.intensity = theme.ambientIntensity;
    for (const lamp of this.cornerLamps) {
      lamp.color.set(theme.cornerLight);
      lamp.intensity = theme.cornerIntensity;
    }
    this.sun.color.set(theme.sun);
    this.sun.intensity = theme.sunIntensity;
    this.fill.color.set(theme.fill);
    this.fill.intensity = theme.fillIntensity;

    this.skyBase.set(theme.sky);
    this.fog.color.copy(this.skyBase);
    this.fog.near = theme.fogNear;
    this.fog.far = theme.fogFar;
    // The sky is repainted from `skyBase` by the next `setSkyTint`; force it.
    this.tint = -1;
    this.setSkyTint(0);

    MAT.applyTheme(theme);
    this.rebuildWorld();
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
    // Dark mood, but the floor and props stay lit enough that the enemies keep
    // their body colours instead of reading as black silhouettes. The theme
    // recolours all of this the moment `applyTheme` runs.
    this.hemi = new THREE.HemisphereLight(
      this.theme.hemiSky,
      this.theme.hemiGround,
      this.theme.hemiIntensity,
    );
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(this.theme.ambient, this.theme.ambientIntensity);
    this.scene.add(this.ambient);
    // Corner uplights: the maze corners sat in pure shadow, which is what made
    // the arena read as flat. Four cheap point lights give them depth.
    for (const [x, z] of CORNER_LIGHTS) {
      const lamp = new THREE.PointLight(this.theme.cornerLight, this.theme.cornerIntensity, 52, 2);
      lamp.position.set(x, 7, z);
      this.scene.add(lamp);
      this.cornerLamps.push(lamp);
    }

    this.sun = new THREE.DirectionalLight(this.theme.sun, this.theme.sunIntensity);
    this.sun.position.set(36, 58, 22);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -54;
    this.sun.shadow.camera.right = 54;
    this.sun.shadow.camera.top = 54;
    this.sun.shadow.camera.bottom = -54;
    this.sun.shadow.camera.near = 5;
    this.sun.shadow.camera.far = 150;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);

    // Cool fill from the opposite side so enemies facing away from the key
    // light still show their body colours rather than going black.
    this.fill = new THREE.DirectionalLight(this.theme.fill, this.theme.fillIntensity);
    this.fill.position.set(-32, 38, -28);
    this.scene.add(this.fill);
  }

  /** Drop the current static world and everything it uploaded to the GPU. */
  private disposeWorld(): void {
    this.clock?.dispose();
    this.clock = null;
    for (const child of [...this.worldGroup.children]) {
      this.worldGroup.remove(child);
      child.traverse((node) => {
        const mesh = node as THREE.Mesh;
        mesh.geometry?.dispose();
      });
    }
    for (const mat of this.ownedMats) {
      const std = mat as THREE.MeshStandardMaterial;
      std.map?.dispose();
      mat.dispose();
    }
    this.ownedMats.length = 0;
  }

  /** Rebuild the static meshes for the active theme; collision stays as it was. */
  private rebuildWorld(): void {
    this.disposeWorld();
    this.solids.length = 0;
    this.reactorRings = [];
    this.reactorCore = null;
    this.reactorLight = null;
    this.registerCollision = false;
    this.floor();
    this.walls();
    this.cover();
    this.reactor();
    this.platforms();
    this.ramps();
    this.clockTower();
    this.stars();
    this.registerCollision = true;
    // The capture masts are not theme-styled, but their solids were cleared
    // with everything else — re-list them without re-registering collision.
    for (const pad of this.pads) this.solids.push(pad.mast);
  }

  private floor(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.ARENA, WORLD.ARENA),
      new THREE.MeshStandardMaterial({
        map: makeFloorTexture(this.rng, this.theme),
        roughness: 0.85,
        metalness: 0.2,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.ownedMats.push(floor.material as THREE.Material);
    this.worldGroup.add(floor);
    this.solids.push(floor);
  }

  private walls(): void {
    const { ARENA, HALF, WALL_H } = WORLD;
    const length = ARENA + 2;
    const mkWall = (x: number, z: number, ry: number) => {
      const asset = makeWall(length, WALL_H, this.theme);
      asset.group.position.set(x, 0, z);
      asset.group.rotation.y = ry;
      this.worldGroup.add(asset.group);
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
    const accents = coverAccents(this.theme);
    for (const [i, [x, z, w, h, d]] of OBSTACLES.entries()) {
      const asset = makeCover(w, h, d, this.theme, accents[i % accents.length] ?? this.theme.cyan);
      asset.group.position.set(x, 0, z);
      this.worldGroup.add(asset.group);
      this.blockAt(asset.solid, x, z, w / 2, d / 2, h);
    }
  }

  /**
   * The central reactor: the landmark every lane is navigated by, and the
   * reason the middle of the map is not a shooting gallery. Solid, not walkable.
   */
  private reactor(): void {
    const { x, z, w, h, d } = REACTOR;
    const asset = makeReactor(w, h, d, this.theme);
    asset.group.position.set(x, 0, z);
    this.worldGroup.add(asset.group);
    this.blockAt(asset.solid, x, z, w / 2, d / 2, h);
    this.reactorRings = asset.rings;
    this.reactorCore = asset.core;
    this.reactorLight = asset.light;
  }

  private platforms(): void {
    for (const [x, z, w, h, d] of PLATFORMS) {
      const asset = makeDeck(w, h, d, this.theme);
      asset.group.position.set(x, 0, z);
      this.worldGroup.add(asset.group);
      this.blockAt(asset.solid, x, z, w / 2, d / 2, h);
    }
  }

  /**
   * One tower top per deck: capture pad, mast and beacon. The mast is a real
   * collider, so the pad is something you circle rather than stand on dead
   * centre. Only the wave's live pad is drawn — the beacons carry the rest.
   */
  /** The clock tower: a landmark you can read the wave from across the map. */
  private clockTower(): void {
    const tower = new ClockTower(CLOCK_TOWER[0], CLOCK_TOWER[1], this.theme);
    this.worldGroup.add(tower.group);
    this.clock = tower;
    this.blockAt(tower.solid, CLOCK_TOWER[0], CLOCK_TOWER[1], 5, 5, 24);
  }

  /**
   * Write the clock face: the wave, the countdown to the next one and what is
   * still alive. Nothing is redrawn until the readout changes.
   */
  setClock(wave: number, intermission: number, hostiles: number): void {
    if (!this.clock) return;
    if (intermission > 0) {
      this.clock.setReadout('NEXT', `${Math.ceil(intermission)}s`, `WAVE ${wave + 1}`);
    } else {
      this.clock.setReadout('WAVE', String(wave), `HOSTILES ${hostiles}`);
    }
  }

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
      const asset = makeRamp(width, length, PLATFORM_H, this.theme);
      asset.group.position.set(x, 0, z);
      // The wedge is built climbing along local +x, so the mesh is turned to
      // point at the up vector. A PI flip only works for the -x ramp: it left
      // the north and south ramps rotated 90° off their own collider.
      asset.group.rotation.y = rampRotation(upX, upZ);
      this.worldGroup.add(asset.group);
      this.solids.push(asset.solid);

      const spanX = upX !== 0 ? length : width;
      const spanZ = upZ !== 0 ? length : width;
      if (this.registerCollision) {
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
  }

  private stars(): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(starfieldPositions(this.rng), 3));
    const mat = new THREE.PointsMaterial({
      color: this.theme.star,
      size: 1.4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.8,
      fog: false,
    });
    this.ownedMats.push(mat);
    this.worldGroup.add(new THREE.Points(geo, mat));
  }

  /**
   * Register a world-space AABB from the authored layout. Passing the dimensions
   * explicitly keeps a decorative lip or trim from widening a corridor. A theme
   * rebuild skips the registration — the collider already exists.
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
    if (!this.registerCollision) return;
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
