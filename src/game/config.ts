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
  ARENA: 84,
  HALF: 42,
  WALL_H: 6,
  PLAYER_H: 1.7,
  PLAYER_R: 0.45,
  WALL_INSET: 1,
  GRAVITY: 26,
  WALK: 6.5,
  SPRINT: 10.5,
  JUMP_V: 8.5,
  MOVE_DAMP: 10,
  PITCH_LIMIT: 1.45,

  /** Where a run starts: the clear plaza south of the reactor. */
  SPAWN_X: 0,
  SPAWN_Z: 14,

  /** Sprint can't be held forever: drain while running, regen otherwise. */
  STAMINA_MAX: 100,
  STAMINA_DRAIN: 22,
  STAMINA_REGEN: 15,
  /** Sprint is locked out until the bar climbs back above this. */
  STAMINA_UNLOCK: 25,
  /**
   * Maximum height a walking body is lifted over — a kerb, a ramp's lip. Kept
   * well under `PLATFORM_H` (1.6) so a platform is only reachable by its ramp,
   * and under the jump apex so you cannot hop onto one either.
   */
  STEP_HEIGHT: 0.55,
} as const;

export const WEAPON = {
  MAG: 12,
  RELOAD_T: 1.25,
  FIRE_T: 0.12,
  /** How often the empty click may play, so it cannot machine-gun. */
  DRY_CLICK_T: 0.4,
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

/**
 * Touch controls (phones and tablets).
 *
 * The stick is invisible until the left thumb lands, then measures its offset
 * against `STICK_R`. Look drags convert pixels to radians at
 * `WEAPON.SENS × LOOK_GAIN × settings.touch.touchSensitivity` — the settings
 * value is the personal multiplier, `LOOK_GAIN` the touch-specific base.
 */
export const TOUCH = {
  /** Radius of the virtual stick, in px. A full push = `WALK` speed. */
  STICK_R: 60,
  /** Fraction of the stick inside which the walk vector is zero. */
  DEAD_ZONE: 0.18,
  /** Stick fraction at which the run auto-sprints (stamina still applies). */
  SPRINT_FRACTION: 0.95,
  /** Touch look gain: multiplies `WEAPON.SENS` before the player's setting. */
  LOOK_GAIN: 1.6,
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

/**
 * Video options exposed by the settings panel.
 *
 * `QUALITY_PIXELS` is the device-pixel-ratio cap per quality level, so "low"
 * renders at 1× and "high" at the retina cap.
 */
export const VIDEO = {
  QUALITY_PIXELS: [1, 1.5, 2],
  FOV_MIN: 60,
  FOV_MAX: 110,
} as const;

/**
 * The post-processing bloom pass, enabled from the video settings. Tuned so
 * only the neon trim and emissives cross the threshold — the lit shells stay
 * crisp and the glow is an accent, not a haze.
 */
export const BLOOM = {
  STRENGTH: 0.5,
  RADIUS: 0.4,
  /** Luminance a pixel must pass before it blooms. */
  THRESHOLD: 0.72,
} as const;

// ------------------------------------------------------------------ themes

/** The structural palette StructureKit bakes into vertex colours. */
export interface KitPalette {
  readonly body: number;
  readonly light: number;
  readonly dark: number;
  readonly panel: number;
  readonly panelDark: number;
  readonly hazard: number;
  readonly cyan: number;
  readonly magenta: number;
}

/**
 * An arena theme: every colour the world is painted with, in one place.
 *
 * A theme is render-only — layout, collision and gameplay are untouched — so
 * switching one rebuilds the static meshes and nothing else. Hemisphere
 * intensity must stay at or above 1.0: below that the enemies' standard
 * materials lose their body colour and read as black silhouettes.
 */
export interface ThemeDef extends KitPalette {
  readonly id: string;
  readonly name: string;

  /** Sky and fog. The fog colour tracks the sky, as `setSkyTint` always has. */
  readonly sky: number;
  readonly fogNear: number;
  readonly fogFar: number;

  readonly hemiSky: number;
  readonly hemiGround: number;
  readonly hemiIntensity: number;
  readonly ambient: number;
  readonly ambientIntensity: number;
  readonly cornerLight: number;
  readonly cornerIntensity: number;
  readonly sun: number;
  readonly sunIntensity: number;
  readonly fill: number;
  readonly fillIntensity: number;

  /**
   * Floor paint, as `#rrggbb` strings — the texture painter applies the alpha
   * per layer, so the theme only picks the hue.
   */
  readonly floorBase: string;
  readonly floorPlate: string;
  readonly floorLane: string;
  readonly floorZone: string;

  readonly star: number;
  /** The two CSS accents the HUD and menus derive their colour from. */
  readonly cssAccent: string;
  readonly cssDanger: string;
}

export const THEMES = {
  /** The default: a black-violet void under a magenta sun, cyan grid on the floor. */
  synthwave: {
    id: 'synthwave',
    name: 'SYNTHWAVE',
    sky: 0x070310,
    fogNear: 42,
    fogFar: 190,
    hemiSky: 0x9a6cff,
    hemiGround: 0x1c1030,
    hemiIntensity: 1.2,
    ambient: 0x2c1c52,
    ambientIntensity: 1.0,
    cornerLight: 0xff2bd6,
    cornerIntensity: 30,
    sun: 0xff3ba8,
    sunIntensity: 2.0,
    fill: 0x46e0ff,
    fillIntensity: 0.9,
    body: 0x251a42,
    light: 0x4a3880,
    dark: 0x130b24,
    panel: 0x7a2a9e,
    panelDark: 0x3c1a58,
    hazard: 0xff4fd8,
    cyan: 0x28e0ff,
    magenta: 0xff3ba8,
    floorBase: '#0b0714',
    floorPlate: '#46e0ff',
    floorLane: '#ff2bd6',
    floorZone: '#28e0ff',
    star: 0xff9ce8,
    cssAccent: '#46e0ff',
    cssDanger: '#ff3b4e',
  },
  /** The shipped look, preserved verbatim as a selectable preset. */
  industrial: {
    id: 'industrial',
    name: 'INDUSTRIAL',
    sky: 0x0c1222,
    fogNear: 52,
    fogFar: 210,
    hemiSky: 0x6f86b0,
    hemiGround: 0x2a3040,
    hemiIntensity: 1.35,
    ambient: 0x2e3448,
    ambientIntensity: 0.85,
    cornerLight: 0x2aa5c4,
    cornerIntensity: 26,
    sun: 0xffd9a0,
    sunIntensity: 2.2,
    fill: 0x8fb4ff,
    fillIntensity: 0.7,
    body: 0x38456a,
    light: 0x55699b,
    dark: 0x232d45,
    panel: 0xa06d1a,
    panelDark: 0x5b3f16,
    hazard: 0xf2b21e,
    cyan: 0x2aa5c4,
    magenta: 0xff3ba8,
    floorBase: '#14171d',
    floorPlate: '#46e0ff',
    floorLane: '#f2b21e',
    floorZone: '#e06520',
    star: 0xaaccff,
    cssAccent: '#46e0ff',
    cssDanger: '#ff3b4e',
  },
  /** Biohazard containment: sick greens, institutional dim, orange reactor. */
  toxic: {
    id: 'toxic',
    name: 'TOXIC',
    sky: 0x0a120c,
    fogNear: 42,
    fogFar: 190,
    hemiSky: 0x8ab07a,
    hemiGround: 0x1a2414,
    hemiIntensity: 1.2,
    ambient: 0x243218,
    ambientIntensity: 1.0,
    cornerLight: 0x9dff3a,
    cornerIntensity: 26,
    sun: 0xd8ffb0,
    sunIntensity: 2.0,
    fill: 0x4aff9e,
    fillIntensity: 0.7,
    body: 0x2a3a26,
    light: 0x4e6a3e,
    dark: 0x141c12,
    panel: 0x6a7a1e,
    panelDark: 0x38420f,
    hazard: 0xc8ff1e,
    cyan: 0x9dff3a,
    magenta: 0xff8a1e,
    floorBase: '#0d120c',
    floorPlate: '#9dff3a',
    floorLane: '#c8ff1e',
    floorZone: '#ff961e',
    star: 0xbfffb0,
    cssAccent: '#3dffa0',
    cssDanger: '#ff3b4e',
  },
  /** A permanent meteor-shower mood: crimson sky, red neon on near-black steel. */
  blood: {
    id: 'blood',
    name: 'BLOOD MOON',
    sky: 0x130505,
    fogNear: 42,
    fogFar: 190,
    hemiSky: 0xa05a5a,
    hemiGround: 0x241010,
    hemiIntensity: 1.15,
    ambient: 0x381414,
    ambientIntensity: 0.95,
    cornerLight: 0xff4a2a,
    cornerIntensity: 26,
    sun: 0xff6a4e,
    sunIntensity: 2.1,
    fill: 0xff8a7a,
    fillIntensity: 0.7,
    body: 0x3a2020,
    light: 0x6a3a34,
    dark: 0x1c0d0d,
    panel: 0x7a2a1e,
    panelDark: 0x421610,
    hazard: 0xff5a2a,
    cyan: 0xff6a4e,
    magenta: 0xff2a4e,
    floorBase: '#120a0a',
    floorPlate: '#ff5a46',
    floorLane: '#ff5a2e',
    floorZone: '#ffb440',
    star: 0xffb0a0,
    cssAccent: '#ff6a4e',
    cssDanger: '#ff3b4e',
  },
} as const satisfies Record<string, ThemeDef>;

export type ThemeId = keyof typeof THEMES;
export const DEFAULT_THEME: ThemeId = 'synthwave';

// ------------------------------------------------------------------ skins

export type SkinWeapon = 'rifle' | 'knife';
/** The rifle skin swaps the optic; the knife skin swaps the blade. */
export type RifleOptic = 'iron' | 'reddot' | 'holo' | 'scope';
export type KnifeBlade = 'straight' | 'cleaver' | 'saw' | 'hook';

export interface SkinPalette {
  readonly metal: number;
  readonly dark: number;
  readonly glow: number;
  readonly hazard: number;
}

export interface SkinDef {
  readonly id: string;
  readonly weapon: SkinWeapon;
  readonly name: string;
  readonly flavour: string;
  readonly price: number;
  readonly palette: SkinPalette;
  readonly part: RifleOptic | KnifeBlade;
}

/** What the weapons look like before anything is bought. */
export const STANDARD_SKIN = {
  metal: 0x5a6478,
  dark: 0x2e3442,
  glow: 0x46e0ff,
  hazard: 0xf2b21e,
} as const satisfies SkinPalette;

/**
 * The shop. Four themes, each a rifle skin and a knife skin at the same
 * price, so a theme bought whole is a matching loadout. Buying them
 * separately costs more — there is no bundle discount.
 */
export const SKINS = [
  {
    id: 'scrap-rifle',
    weapon: 'rifle',
    name: 'SCRAP RIFLE',
    flavour: 'Bolted together from what the depot had left. It shoots straight.',
    price: 300,
    palette: { metal: 0x6a6f78, dark: 0x353a42, glow: 0xffc53d, hazard: 0xff8a1e },
    part: 'iron',
  },
  {
    id: 'scrap-knife',
    weapon: 'knife',
    name: 'SCRAP BLADE',
    flavour: 'A sharpened piece of hull plate. Ugly, and it opens anything.',
    price: 300,
    palette: { metal: 0x6a6f78, dark: 0x353a42, glow: 0xffc53d, hazard: 0xff8a1e },
    part: 'straight',
  },
  {
    id: 'hazard-rifle',
    weapon: 'rifle',
    name: 'HAZARD MK2',
    flavour: 'Refurbished against a live reactor. The paint is a warning.',
    price: 900,
    palette: { metal: 0x8a6a1e, dark: 0x3a2a12, glow: 0xff3b4e, hazard: 0xf2b21e },
    part: 'reddot',
  },
  {
    id: 'hazard-knife',
    weapon: 'knife',
    name: 'HAZARD EDGE',
    flavour: 'A wide slab for cutting through the things that wear plating.',
    price: 900,
    palette: { metal: 0x8a6a1e, dark: 0x3a2a12, glow: 0xff3b4e, hazard: 0xf2b21e },
    part: 'cleaver',
  },
  {
    id: 'midnight-rifle',
    weapon: 'rifle',
    name: 'MIDNIGHT',
    flavour: 'Black on black. You only see it when the light hits the edges.',
    price: 2000,
    palette: { metal: 0x2a3350, dark: 0x151a28, glow: 0x46e0ff, hazard: 0x8f6bff },
    part: 'holo',
  },
  {
    id: 'midnight-knife',
    weapon: 'knife',
    name: 'MIDNIGHT FANG',
    flavour: 'A serrated spine that does not need a second swing.',
    price: 2000,
    palette: { metal: 0x2a3350, dark: 0x151a28, glow: 0x46e0ff, hazard: 0x8f6bff },
    part: 'saw',
  },
  {
    id: 'void-rifle',
    weapon: 'rifle',
    name: 'VOID',
    flavour: 'Scoped for a range that does not exist. It still hits.',
    price: 4500,
    palette: { metal: 0x1d1f26, dark: 0x0d0e12, glow: 0xff3ba8, hazard: 0xff3ba8 },
    part: 'scope',
  },
  {
    id: 'void-knife',
    weapon: 'knife',
    name: 'VOID HOOK',
    flavour: 'It curves back on itself. The pull is the killing part.',
    price: 4500,
    palette: { metal: 0x1d1f26, dark: 0x0d0e12, glow: 0xff3ba8, hazard: 0xff3ba8 },
    part: 'hook',
  },
] as const satisfies readonly SkinDef[];

/** What a kill is worth. A knife kill pays the same as a gun kill. */
export const CREDITS = {
  KILL: { grunt: 10, runner: 15, tank: 40, sapper: 25 },
  HEADSHOT: 5,
  WAVE: 50,
  CAPTURE: 40,
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

  /**
   * The grunt's front shield. Hits landing within `SHIELD_ARC` of the direction
   * it is facing are cut by `SHIELD_CUT`; headshots and hits from behind are
   * not. Flanking it is the answer.
   */
  SHIELD_ARC: 1.2,
  SHIELD_CUT: 0.6,
  /** Windup before a melee swing lands — long enough to step out of. */
  WINDUP: 0.35,

  /**
   * How fast a mob can turn, radians per second. It is deliberately slower
   * than a player's mouse: that is what makes flanking possible, and the
   * front plate only covers what the mob can see.
   */
  TURN_RATE: { grunt: 2.6, runner: 5.2, tank: 1.3, sapper: 3.2 },
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

  /**
   * Vertical navigation. Mobs follow the floor and fall off ledges, but they
   * never take a ramp — a deck is melee-safe, and artillery is the answer to it.
   * `STEP` lets them ride a slope if they are ever on one, `CLIMB_RISE` is how
   * far above them the player must be before they give up the chase and besiege
   * the ramp mouth, and `ATTACK_RISE` stops them clawing at someone on a deck.
   */
  STEP: 0.55,
  CLIMB_RISE: 0.5,
  ATTACK_RISE: 1.1,
  /** How far outside a ramp's mouth a besieging mob gathers. */
  RAMP_OFFSET: 0.9,

  SPAWN_ATTEMPTS: 24,
  SPAWN_RING: 30,
  SPAWN_RING_JITTER: 6,
  SPAWN_MIN_DIST: 20,
  /** Last resort if every ring attempt lands in geometry — the south plaza. */
  SPAWN_FALLBACK: [0, 22],
  TEST_SPAWN_RING: 9,
  TEST_SPAWN_JITTER: 4,
} as const;

/**
 * Tower alarms. Each gatehouse deck carries a beacon; when hostiles mass inside
 * `RADIUS` of one it flips red, a siren pings on the rising edge, and the
 * minimap pulses a ring there. `HOLD` keeps it lit briefly after they leave so
 * a mob stepping behind cover does not strobe the alarm.
 */
export const ALARM = {
  RADIUS: 20,
  HOLD: 3,
} as const;

/**
 * Ammunition economy.
 *
 * The magazine is finite and the reserve is finite: a kill is the only way to
 * get more, so the knife matters. `DROP` is what a mob leaves behind when it
 * dies, and `WAVES.AMMO_PER_WAVE` is the standing resupply that keeps a long
 * run from spiralling.
 */
export const AMMO = {
  /** Rounds in the reserve when a run starts. */
  RESERVE_START: 60,
  /** The reserve never grows past this. */
  RESERVE_MAX: 120,
  /** Rounds dropped by a mob of each kind when it dies. */
  DROP: { grunt: 4, runner: 6, tank: 12, sapper: 6 },
} as const;

/**
 * The knife: what you swing when the rifle is dry.
 *
 * Pure numbers — the reach and the arc are a cone test in `game/knife.ts`.
 */
export const KNIFE = {
  DAMAGE: 70,
  /** Reach from the player's feet, in world units. */
  RANGE: 2.4,
  /** Half-angle of the swing cone, radians. */
  ARC: 1.9,
  /** How far above or below the player's feet a mob can still be stabbed. */
  VREACH: 1.6,
  /** Seconds between swings. */
  COOLDOWN: 0.45,
  /** How long the blade is out, in seconds. */
  SWING_T: 0.28,
} as const;

/**
 * Runner behaviour: it pounces when it has room to build speed.
 *
 * The pounce is a short burst of speed at mid range; the recovery afterwards
 * is the price of overshooting, and it is the window where a runner is
 * vulnerable.
 */
export const RUNNER = {
  /** Seconds the pounce lasts. */
  POUNCE_T: 0.45,
  /** Speed multiplier while pouncing. */
  POUNCE_GAIN: 2.2,
  /** Pounce only starts from at least this far away. */
  POUNCE_MIN: 5,
  /** ...and at most this far away. */
  POUNCE_MAX: 14,
  /** Seconds of slow movement after a pounce. */
  RECOVER_T: 0.6,
  /** Speed multiplier while recovering. */
  RECOVER_GAIN: 0.45,
  /** The crouch before it leaps — the tell. */
  POUNCE_TELL: 0.3,
  /** Seconds between pounces. */
  POUNCE_COOLDOWN: 2.5,
} as const;

/**
 * Tank behaviour: it slams the ground instead of clawing.
 *
 * The slam hits in a radius, so standing next to a tank is worse than
 * standing in front of it — and its front armour means the rifle is the
 * answer, not the knife.
 */
export const TANK = {
  /** Radius of the slam shockwave. */
  SLAM_R: 2.6,
  /** Damage multiplier for a hit caught by the shockwave. */
  SLAM_MULT: 1.6,
  /** Fraction of damage its front armour absorbs. */
  ARMOUR_CUT: 0.4,
  /** How hard the slam shoves the player, in extra units per second. */
  KNOCK: 12,
  /** Seconds of windup before the slam lands — longer than a grunt's. */
  WINDUP: 0.5,
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
  /** Rounds handed over at the start of every wave, on top of the mob drops. */
  AMMO_PER_WAVE: 24,
} as const;

/**
 * Deck capture: the rotating high-ground objective.
 *
 * One corner platform per wave carries a live pad. Holding it for `HOLD_T`
 * seconds banks a heal-over-time, then that deck cools down. Mobs deliberately
 * never climb (see `ENEMY`), but sappers lob bombs onto the deck, so holding it
 * is a fight against artillery rather than a safe camp.
 */
export const CAPTURE = {
  /** Seconds of continuous presence needed to secure the deck. */
  HOLD_T: 4,
  /** Progress lost per second while off the pad. */
  DECAY: 2,
  /** Seconds before the same deck can be secured again. */
  COOLDOWN: 40,
  /** Total HP restored by one capture. */
  HEAL: 30,
  /** Seconds the heal takes to land, so it reads as a repair not a jump-cut. */
  HEAL_T: 3,
  /** How close to the pad centre counts, in world units. */
  RADIUS: 2.2,
  /** Vertical tolerance: standing on the floor below must never count. */
  RISE: 0.5,
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
  KEEP_DIST: 18,
  /** Farther than this and it throws a bomb at the player instead of dropping one. */
  THROW_DIST: 12,
  LURK_GAIN: 0.7,
  /** Wander heading wobble, radians per second of its animation phase. */
  WANDER_TURN: 1.2,
  HUNT_SPEED: 8.5,

  /**
   * Panic: wounded past `PANIC_HP` it stops playing artillery and runs — but
   * it drops bombs at its feet as it flees, so a wounded sapper is still the
   * most dangerous thing in the arena.
   */
  PANIC_HP: 0.35,
  /** Seconds between bombs while fleeing. */
  PANIC_PLANT_T: 2.5,
  /** How fast it runs while fleeing. */
  PANIC_SPEED: 5.2,
  /** Seconds of glow on the bomb rack before a plant — the tell. */
  TELL: 0.8,
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

/**
 * XP orbs. A kill drops one, worth its kind's `VALUE` — a tank pays what a tank
 * is worth. Inside `RADIUS` the orb slides toward the player and is banked at
 * `COLLECT`.
 */
export const XP = {
  /** Pull the orb toward the player when it is within this radius. */
  RADIUS: 2.4,
  /** Distance at which the orb is collected. */
  COLLECT: 0.8,
  /** Points per orb, by enemy kind. */
  VALUE: { grunt: 5, runner: 6, tank: 15, sapper: 8 },
  /** How fast the orb slides toward the player while magnetised. */
  PULL_SPEED: 7,
  /** Visual-only: how high the orb floats and how fast it bobs. */
  BOB_H: 0.55,
  BOB_HZ: 2.4,
} as const;

/**
 * Player levels. The meter needs `FIRST_NEED × GROWTH^(level−1)` XP to advance,
 * and each level pays `HEAL` integrity over time. Skills are not built yet —
 * they will read `level` off `XpMeter`.
 */
export const XP_LEVEL = {
  FIRST_NEED: 60,
  GROWTH: 1.3,
  HEAL: 15,
} as const;

/**
 * The meteor shower: a random set-piece that bleeds the sky red and drops rocks
 * around the player. `WARN_T` telegraphs it, `DURATION` bounds it, and the
 * dormant gap keeps it from becoming wallpaper. Anything inside `RADIUS` of an
 * impact takes damage — the player and the mobs alike.
 */
export const METEOR = {
  /** Grace period at the start of a run before the first shower can roll. */
  FIRST_DELAY: 40,
  /** Dormant gap between showers: `DORMANT_MIN + rng × DORMANT_SPAN` seconds. */
  DORMANT_MIN: 60,
  DORMANT_SPAN: 80,
  /** Sky bleed before the first stone — the "look up" warning. */
  WARN_T: 3,
  /** How long stones keep falling. */
  DURATION: 14,
  /** Seconds the sky takes to bleed red, and to heal once the stones stop. */
  SKY_IN: 1.2,
  SKY_OUT: 2.5,
  SKY_COLOR: 0x7a0c0c,
  /** Peak blend toward `SKY_COLOR`, and how far the hemisphere light dips. */
  SKY_MIX: 0.7,
  SKY_DIM: 0.35,
  /** Mean seconds between stones, ± `JITTER`. */
  STONE_EVERY: 0.45,
  STONE_JITTER: 0.25,
  /** Fall time of a stone: the lifetime of its ground marker. */
  FALL_T: 1.4,
  /** Height a stone starts at, world units up. */
  SPAWN_Y: 46,
  /** Impact ring around the player: near enough to matter, far enough to dodge. */
  TARGET_MIN: 2.5,
  TARGET_MAX: 8,
  /** Ring points tried per stone before giving up on a clear spot. */
  TARGET_ATTEMPTS: 8,
  /** Clearance a target needs, so a stone never lands inside a maze wall. */
  CLEAR_R: 1.1,
  /** Blast radius of one impact. */
  RADIUS: 2,
  PLAYER_DMG: 26,
  ENEMY_DMG: 60,
  /** An impact only booms audibly within this range of the player. */
  SOUND_R: 18,
  /** Camera shake applied by an impact. */
  SHAKE: 0.8,
  /** Radius of the falling rock mesh. */
  ROCK_R: 0.34,
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
  MENU: 'menu',
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
