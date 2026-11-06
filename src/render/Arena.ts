import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Rng } from '../core/rng';
import { BLOOM, CAMERA, CRAWL, DEFAULT_THEME, METEOR, THEMES, type ThemeDef, VIDEO } from '../game/config';
import { type ChunkTables, chunkRegion } from '../game/world/chunks';
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
import { coverAccents, makeCover, makeDeck, makeRamp, makeReactor } from './models/StructureKit';
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

  /** One loaded streaming chunk: its tables, meshes, solids and region id. */
  private chunks = new Map<
    string,
    {
      tables: ChunkTables;
      region: number;
      group: THREE.Group;
      solids: THREE.Object3D[];
      pad?: CapturePad;
    }
  >();
  /** Shared per-theme floor assets every chunk's floor plane points at. */
  private chunkFloorGeo: THREE.PlaneGeometry | null = null;
  private chunkFloorMat: THREE.MeshStandardMaterial | null = null;
  /** The starfield object — re-centred on the player by `followPlayer`. */
  private starsObj: THREE.Points | null = null;

  /** The active theme; the builders read their colours from it. */
  private theme: ThemeDef = THEMES[DEFAULT_THEME];

  /**
   * False while a build is in flight when the colliders already exist: the
   * meshes are rebuilt from the same layout tables, so registering their AABBs
   * again would stack colliders. The FIRST build (boot) must register — see
   * `collisionRegistered`.
   */
  private registerCollision = true;
  /** Whether this process has registered collision at least once. */
  private collisionRegistered = false;

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
   * Collider counts for the headless suite's boot-registration assertion:
   * region 0 only — the authored arena, which every boot must register
   * regardless of how much of the infinite world has streamed in.
   */
  collisionCount(): { obstacles: number; ramps: number } {
    return this.collision.countRegion(0);
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
    // The shadow ortho follows the player via `followPlayer`, which moves the
    // light's target — the target must be in the scene for that to take.
    this.scene.add(this.sun.target);

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
    this.chunkFloorGeo = null;
    this.chunkFloorMat = null;
    this.starsObj = null;
    // Chunk meshes are gone with the worldGroup; the tables survive so the
    // rebuild can recreate them without re-registering collision.
    for (const chunk of this.chunks.values()) {
      chunk.group = new THREE.Group();
      chunk.solids = [];
    }
  }

  /** Rebuild the static meshes for the active theme; collision stays as it was. */
  private rebuildWorld(): void {
    this.disposeWorld();
    this.solids.length = 0;
    this.reactorRings = [];
    this.reactorCore = null;
    this.reactorLight = null;
    // The boot build registers every collider exactly once; theme rebuilds
    // reuse those colliders (a theme is render-only) and must not stack them.
    this.registerCollision = !this.collisionRegistered;
    this.ensureFloorAssets();
    this.cover();
    this.reactor();
    this.platforms();
    this.ramps();
    this.clockTower();
    this.stars();
    // Streaming chunks rebuild from their stored tables — same meshes, same
    // colliders, new palette.
    for (const chunk of this.chunks.values()) {
      this.buildChunkInto(chunk.tables, chunk.region, chunk.group, chunk.solids, false);
      this.worldGroup.add(chunk.group);
    }
    this.registerCollision = true;
    // A build either just registered (boot) or reused existing colliders
    // (theme swap); either way the registry is populated from here on.
    this.collisionRegistered = true;
    // The capture masts are not theme-styled, but their solids were cleared
    // with everything else — re-list them without re-registering collision.
    for (const pad of this.pads) this.solids.push(pad.mast);
  }

  /** One shared floor geometry + texture for every chunk's plane. */
  private ensureFloorAssets(): void {
    if (this.chunkFloorGeo && this.chunkFloorMat) return;
    this.chunkFloorGeo = new THREE.PlaneGeometry(CRAWL.CHUNK, CRAWL.CHUNK);
    this.chunkFloorMat = new THREE.MeshStandardMaterial({
      map: makeFloorTexture(this.rng, this.theme),
      roughness: 0.85,
      metalness: 0.2,
    });
    this.ownedMats.push(this.chunkFloorMat);
  }

  /**
   * Build one streaming chunk's meshes into `group`. `register` is true on the
   * chunk's first load (colliders join its region) and false on a theme
   * rebuild (the colliders never moved). Every solid lands both in the global
   * pick list and in `solids`, so the caller can retract exactly this chunk's.
   */
  private buildChunkInto(
    tables: ChunkTables,
    region: number,
    group: THREE.Group,
    solids: THREE.Object3D[],
    register: boolean,
  ): void {
    const wasRegistering = this.registerCollision;
    this.registerCollision = register;
    const half = CRAWL.CHUNK / 2;
    const cx = tables.cx * CRAWL.CHUNK;
    const cz = tables.cz * CRAWL.CHUNK;

    const geo = this.chunkFloorGeo;
    const mat = this.chunkFloorMat;
    if (!geo || !mat) return; // ensureFloorAssets runs before every build path
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx + half, 0, cz + half);
    floor.receiveShadow = true;
    group.add(floor);
    this.solids.push(floor);
    solids.push(floor);

    const accents = coverAccents(this.theme);
    for (const [i, [x, z, w, h, d]] of tables.cover.entries()) {
      const asset = makeCover(w, h, d, this.theme, accents[(i + 1) % accents.length] ?? this.theme.cyan);
      asset.group.position.set(x, 0, z);
      group.add(asset.group);
      this.blockAt(asset.solid, x, z, w / 2, d / 2, h, region);
      solids.push(asset.solid);
    }

    const district = tables.district;
    if (district) {
      const deck = makeDeck(7, PLATFORM_H, 7, this.theme);
      deck.group.position.set(district.deck.x, 0, district.deck.z);
      group.add(deck.group);
      this.blockAt(deck.solid, district.deck.x, district.deck.z, 3.5, 3.5, PLATFORM_H, region);
      solids.push(deck.solid);

      const ramp = makeRamp(4.4, 6, PLATFORM_H, this.theme);
      ramp.group.position.set(district.ramp.x, 0, district.ramp.z);
      ramp.group.rotation.y = rampRotation(district.ramp.upX, district.ramp.upZ);
      group.add(ramp.group);
      this.solids.push(ramp.solid);
      solids.push(ramp.solid);
      if (register) {
        const spanX = district.ramp.upX !== 0 ? 3 : 2.2;
        const spanZ = district.ramp.upZ !== 0 ? 3 : 2.2;
        this.collision.addRamp(
          {
            minX: district.ramp.x - spanX,
            maxX: district.ramp.x + spanX,
            minZ: district.ramp.z - spanZ,
            maxZ: district.ramp.z + spanZ,
            lowY: 0,
            highY: PLATFORM_H,
            upX: district.ramp.upX,
            upZ: district.ramp.upZ,
          },
          region,
        );
      }

      for (const [x, z, w, h, d] of district.compound) {
        const asset = makeCover(w, h, d, this.theme, this.theme.cyan);
        asset.group.position.set(x, 0, z);
        group.add(asset.group);
        this.blockAt(asset.solid, x, z, w / 2, d / 2, h, region);
        solids.push(asset.solid);
      }
    }
    this.registerCollision = wasRegistering;
  }

  /**
   * Stream a chunk in: build its meshes and register its colliders under its
   * region. A district chunk also gets its capture pad (first load only — the
   * pad view lives in the scene, outside the theme rebuild). Returns the
   * solids the caller should add to the pick list, plus the district pad.
   */
  loadChunk(tables: ChunkTables): { solids: THREE.Object3D[]; pad?: CapturePad } {
    const key = `${tables.cx},${tables.cz}`;
    if (this.chunks.has(key)) return { solids: [] };
    this.ensureFloorAssets();
    const group = new THREE.Group();
    const solids: THREE.Object3D[] = [];
    const region = chunkRegion(tables.cx, tables.cz);
    this.buildChunkInto(tables, region, group, solids, true);
    this.worldGroup.add(group);

    let pad: CapturePad | undefined;
    if (tables.district) {
      const d = tables.district;
      pad = new CapturePad({ id: key, x: d.deck.x, z: d.deck.z, y: PLATFORM_H });
      pad.addTo(this.scene);
      this.blockAt(pad.mast, d.deck.x, d.deck.z, 0.25, 0.25, PLATFORM_H + 5.2, region);
      solids.push(pad.mast);
    }
    this.chunks.set(key, { tables, region, group, solids, pad });
    return { solids, pad };
  }

  /**
   * Stream a chunk out: dispose its meshes, retract its solids and drop its
   * colliders. Returns the solids the caller must drop from the pick list,
   * plus the district pad if there was one.
   */
  unloadChunk(cx: number, cz: number): { solids: THREE.Object3D[]; pad?: CapturePad } {
    const key = `${cx},${cz}`;
    const chunk = this.chunks.get(key);
    if (!chunk) return { solids: [] };
    this.worldGroup.remove(chunk.group);
    chunk.group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      // The floor shares its geometry with every chunk — only the per-chunk
      // cover assets own theirs.
      if (mesh.geometry !== this.chunkFloorGeo) mesh.geometry?.dispose();
    });
    for (const solid of chunk.solids) {
      const i = this.solids.indexOf(solid);
      if (i >= 0) this.solids.splice(i, 1);
    }
    chunk.pad?.dispose(this.scene);
    this.collision.removeRegion(chunk.region);
    this.chunks.delete(key);
    return { solids: chunk.solids, pad: chunk.pad };
  }

  /** How many chunks are currently streamed in. */
  get loadedChunkCount(): number {
    return this.chunks.size;
  }

  /**
   * Keep the sky, the sun and the corner lamps on the player: the starfield is
   * a shell around the camera, the shadow ortho tracks the arena that is
   * actually lit, and the lamps sit on the current chunk's corners exactly
   * where the authored ones sat at ±40.
   */
  followPlayer(px: number, pz: number): void {
    this.starsObj?.position.set(px, 0, pz);
    this.sun.position.set(px + 36, 58, pz + 22);
    this.sun.target.position.set(px, 0, pz);
    this.sun.target.updateMatrixWorld();
    const cx = Math.floor(px / CRAWL.CHUNK) * CRAWL.CHUNK;
    const cz = Math.floor(pz / CRAWL.CHUNK) * CRAWL.CHUNK;
    const corners: readonly (readonly [number, number])[] = [
      [cx - 40, cz - 40],
      [cx - 40, cz + 40],
      [cx + 40, cz - 40],
      [cx + 40, cz + 40],
    ];
    for (let i = 0; i < this.cornerLamps.length; i++) {
      const corner = corners[i];
      if (corner) this.cornerLamps[i]?.position.set(corner[0], 7, corner[1]);
    }
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
    for (const [i, [x, z]] of PLATFORMS.entries()) {
      const pad = new CapturePad({ id: `a${i}`, x, z, y: PLATFORM_H });
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
    this.starsObj = new THREE.Points(geo, mat);
    this.worldGroup.add(this.starsObj);
  }

  /**
   * Register a world-space AABB from the authored layout. Passing the dimensions
   * explicitly keeps a decorative lip or trim from widening a corridor. A theme
   * rebuild skips the registration — the collider already exists. Streamed
   * chunks pass their region so their colliders unload with them.
   */
  private blockAt(
    mesh: THREE.Object3D,
    x: number,
    z: number,
    halfX: number,
    halfZ: number,
    top: number,
    region = 0,
  ): void {
    this.solids.push(mesh);
    if (!this.registerCollision) return;
    this.collision.addObstacle(
      { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ },
      top,
      region,
    );
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
