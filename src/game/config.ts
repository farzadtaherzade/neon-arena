/**
 * Central tuning table for NEON ARENA.
 *
 * Leaf module — imports nothing, so anything can depend on it. Only values a
 * designer is expected to change live here. Dimensions that describe a single
 * mesh (a wall's thickness, a barrel's length) stay in the module that owns
 * that mesh.
 *
 * `as const` gives every consumer the literal type, and `tests/unit/config.test.ts`
 * asserts the whole table is present and sane. A spelled-out interface per group
 * would be 150 lines of boilerplate guarding typos the test already catches.
 */

export const WORLD = {
  ARENA: 60,
  HALF: 30,
  WALL_H: 5,
  PLAYER_H: 1.7,
  PLAYER_R: 0.45,
  WALL_INSET: 1,
  GRAVITY: 26,
  WALK: 6.5,
  SPRINT: 10.5,
  JUMP_V: 8.5,
  MOVE_DAMP: 10,
  PITCH_LIMIT: 1.45,

  /** Sprint can't be held forever: drain while running, regen otherwise. */
  STAMINA_MAX: 100,
  STAMINA_DRAIN: 22,
  STAMINA_REGEN: 15,
  /** Sprint is locked out until the bar climbs back above this. */
  STAMINA_UNLOCK: 25,
  /** Maximum step height for walking up slopes/ramps onto platforms. */
  STEP_HEIGHT: 0.4,
} as const;

export const WEAPON = {
  MAG: 12,
  RELOAD_T: 1.25,
  FIRE_T: 0.12,
  DMG: 34,
  HEAD_MULT: 2.5,
  HEADSHOT_BONUS: 25,
  SENS: 0.0023,
  MAX_RANGE: 120,
  GUN_REST: [0.27, -0.24, -0.5],

  BASE_SPREAD: 0.006,
  BLOOM_PER_SHOT: 0.0045,
  BLOOM_MAX: 0.03,
  BLOOM_DECAY: 5,
  /** Aim multiplier applied to the base spread while ADS is held. */
  AIM_SPREAD: 0.45,

  RECOIL_PER_SHOT: 0.011,
  RECOIL_MAX: 0.09,
  RECOIL_DECAY: 9,

  KICK_PER_SHOT: 0.05,
  KICK_MAX: 0.16,
  KICK_DECAY: 11,

  FLASH_T: 0.05,
  FLASH_LIGHT_PEAK: 30,
  FLASH_LIGHT_DECAY: 26,
} as const;

export const CAMERA = {
  FOV: 75,
  NEAR: 0.1,
  FAR: 300,

  BOB_SPEED_BASE: 4,
  BOB_SPEED_GAIN: 1.2,
  BOB_Y: 0.028,
  BOB_X: 0.006,
  BOB_GUN_Y: 0.008,
  BOB_GUN_DIP: 0.16,

  RELOAD_DIP: 0.7,
  GUN_SWAY_Z: 0.03,
  KICK_PITCH: 1.4,

  SHAKE_PITCH: 0.05,
  SHAKE_YAW: 0.04,
  SHAKE_DECAY: 5,

  CROSSHAIR_GAP_MIN: 7,
  CROSSHAIR_GAP_SPAN: 15,
  CROSSHAIR_BLOOM_FLOOR: 0.004,
  CROSSHAIR_STILL: 0.85,

  /** FOV multiplier while aiming down sights, lerped toward so it never pops. */
  AIM_FOV_SCALE: 0.82,
} as const;

export const FEEDBACK = {
  HITMARK_DECAY: 6,
  VIGNETTE_DECAY: 1.1,
  VIGNETTE_GAIN: 0.9,
  SHAKE_ON_HIT: 0.6,
  LOW_HP: 30,
  LOW_HP_VIGNETTE: 0.22,
  LOW_HP_PULSE: 0.08,
  LOW_HP_PULSE_HZ: 5,
  BANNER_MS: 2200,
} as const;

export const ENEMY_TYPES = {
  grunt: { hp: 60, speed: 3.4, scale: 1.0, dmg: 10, score: 100, body: 0xa83a3a },
  runner: { hp: 30, speed: 6.2, scale: 0.78, dmg: 7, score: 150, body: 0xd07a28 },
  tank: { hp: 200, speed: 2.2, scale: 1.35, dmg: 22, score: 300, body: 0x5e3a8a },
  /** The sapper: skulks, plants bombs, and only charges once the herd thins. */
  sapper: { hp: 90, speed: 4.2, scale: 0.95, dmg: 12, score: 250, body: 0x2fbf6f },
} as const;

export const ENEMY = {
  REACH_PAD: 0.55,
  SEPARATION: 1.1,
  SEPARATION_PAD: 0.25,
  SEPARATION_FORCE: 1.6,
  ARRIVE_DAMP: 0.8,
  MOVE_DAMP: 6,
  ATTACK_COOLDOWN: 1.0,
  ATTACK_FLASH: 0.18,
  HIT_FLASH: 0.08,
  HIT_FLASH_COLOR: 0xffffff,
  ATTACK_FLASH_COLOR: 0xff2222,
  COLLIDE_RADIUS: 0.5,
  BOUNCE: 0.05,
  LEG_SWING: 0.65,
  DEATH_TIME: 0.6,
  DEATH_TILT: 0.92,
  DEATH_SINK: 0.25,
  KNOCKBACK: 0.18,

  SPAWN_ATTEMPTS: 14,
  SPAWN_RING: 23,
  SPAWN_RING_JITTER: 5,
  SPAWN_MIN_DIST: 13,
  SPAWN_FALLBACK: [24, 0],
  TEST_SPAWN_RING: 9,
  TEST_SPAWN_JITTER: 4,
} as const;

export const WAVES = {
  GRUNTS_BASE: 3,
  RUNNERS_FROM: 2,
  TANK_FROM: 3,
  MAX_TANKS: 4,
  SPEED_GAIN: 0.04,
  SPEED_MAX_SCALE: 1.4,
  FIRST_DELAY: 0.5,
  STAGGER: 0.35,
  INTERMISSION: 3,
  WAVE_HEAL: 25,

  HP_PER_WAVE: { grunt: 10, runner: 5, tank: 25, sapper: 12 },
  DMG_PER_2_WAVES: 2,
} as const;

/**
 * Sapper behaviour. It never charges while the pack is healthy — instead it
 * keeps its distance and drops bombs on a timer. Only when the herd thins below
 * `HUNT_AT` does it switch to a fast, direct pursuit.
 */
export const SAPPER = {
  START_WAVE: 5,
  /** One more sapper joins the wave every this many waves past `START_WAVE`. */
  EVERY_WAVES: 5,
  /** Fewer hostiles than this left alive (or queued) flips it to hunt mode. */
  HUNT_AT: 5,
  /** Seconds between bomb plants while lurking. */
  PLANT_T: 6,
  /** Back away when closer than this; otherwise wander. */
  KEEP_DIST: 15,
  /** Farther than this and it throws a bomb at the player instead of dropping one. */
  THROW_DIST: 10,
  LURK_GAIN: 0.7,
  /** Wander heading wobble, radians per second of its animation phase. */
  WANDER_TURN: 1.2,
  HUNT_SPEED: 8.5,
} as const;

/** The sapper's bomb: a shootable object with a fuse and a blast radius. */
export const BOMB = {
  FUSE: 3,
  RADIUS: 4.5,
  PLAYER_DMG: 34,
  ENEMY_DMG: 140,
  /** Points for shooting a live bomb out of the air before it detonates. */
  DEFUSE_SCORE: 40,
  /** Within this range of the player a live bomb raises the HUD warning. */
  WARN_RADIUS: 14,
  BODY_R: 0.32,
  KNOCKBACK: 0.6,
  SHAKE: 1.6,
} as const;

export const FX = {
  PARTICLE_MAX: 2200,
  PARTICLE_SIZE: 0.14,
  TRACER_MAX: 28,
  TRACER_DECAY: 7,
  TRACER_OPACITY: 0.9,
} as const;

export const START_HP = 100;
export const MAX_DT = 0.05;
export const FIXED_STEP = 1 / 60;

export const STATE = {
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAMEOVER: 'gameover',
} as const;

export const SCREEN = {
  NONE: 'none',
  START: 'start',
  PAUSE: 'pause',
  GAMEOVER: 'gameover',
} as const;

export type GameState = (typeof STATE)[keyof typeof STATE];
export type ScreenName = (typeof SCREEN)[keyof typeof SCREEN];
const ENEMY_KINDS = ['grunt', 'runner', 'tank', 'sapper'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

/**
 * Cosmetic variants per enemy kind.Purely visual: a look tells `EnemyView`
 * which body colour and accent colour to draw. No stats change, so combat is
 * unaffected. Each entry is a distinct skin; the enemy picks one at spawn.
 */
export const ENEMY_LOOKS: Record<EnemyKind, { readonly body: number; readonly accent: number }[]> = {
  grunt: [
    { body: 0xa83a3a, accent: 0xffe08a },
    { body: 0xff5e57, accent: 0xffd166 },
    { body: 0x8f2a3f, accent: 0xffb4a2 },
  ],
  runner: [
    { body: 0xd07a28, accent: 0xfff2a8 },
    { body: 0xffb347, accent: 0xffe08a },
    { body: 0xc2410c, accent: 0xfde68a },
  ],
  tank: [
    { body: 0x5e3a8a, accent: 0x7ee7ff },
    { body: 0x4338ca, accent: 0xc4b5fd },
    { body: 0x3b1f63, accent: 0x8b5cf6 },
  ],
  sapper: [
    { body: 0x2fbf6f, accent: 0xffe08a },
    { body: 0x17805b, accent: 0xa7f3d0 },
    { body: 0x0f5132, accent: 0x6ee7b7 },
  ],
};
