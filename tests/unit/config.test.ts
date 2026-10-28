import { describe, expect, it } from 'vitest';
import {
  ALARM,
  AMMO,
  BLOOM,
  BOMB,
  CAMERA,
  CAPTURE,
  CREDITS,
  DEFAULT_THEME,
  ENEMY,
  ENEMY_LOOKS,
  ENEMY_TYPES,
  FEEDBACK,
  FIXED_STEP,
  FX,
  KNIFE,
  MAX_DT,
  METEOR,
  RUNNER,
  SAPPER,
  SCREEN,
  SKINS,
  START_HP,
  STATE,
  TANK,
  THEMES,
  type ThemeDef,
  TOUCH,
  VIDEO,
  WAVES,
  WEAPON,
  WORLD,
  XP,
  XP_LEVEL,
} from '../../src/game/config';
import { PLATFORM_H, PLATFORMS } from '../../src/game/world/layout';

/**
 * The tuning table has no schema beyond these literals, so this suite is the
 * schema: every group present, every range ordered, nothing left at zero.
 */
describe('config', () => {
  it('keeps the arena consistent', () => {
    expect(WORLD.HALF * 2).toBe(WORLD.ARENA);
    expect(WORLD.PLAYER_H).toBeGreaterThan(0);
    expect(WORLD.PLAYER_R).toBeGreaterThan(0);
    expect(WORLD.PLAYER_R * 2).toBeLessThan(WORLD.ARENA);
    expect(WORLD.SPRINT).toBeGreaterThan(WORLD.WALK);
    expect(WORLD.PITCH_LIMIT).toBeLessThan(Math.PI / 2);
    expect(WORLD.STEP_HEIGHT).toBeGreaterThan(0);
    expect(WORLD.STEP_HEIGHT).toBeLessThan(WORLD.PLAYER_H);
  });

  it('keeps the weapon self-consistent', () => {
    expect(WEAPON.BLOOM_MAX).toBeGreaterThanOrEqual(WEAPON.BLOOM_PER_SHOT);
    expect(WEAPON.RECOIL_MAX).toBeGreaterThanOrEqual(WEAPON.RECOIL_PER_SHOT);
    expect(WEAPON.KICK_MAX).toBeGreaterThanOrEqual(WEAPON.KICK_PER_SHOT);
    expect(WEAPON.FIRE_T).toBeGreaterThan(0);
    expect(WEAPON.RELOAD_T).toBeGreaterThan(WEAPON.FIRE_T);
    expect(WEAPON.HEAD_MULT).toBeGreaterThan(1);
    expect(WEAPON.MAG).toBeGreaterThan(0);
    expect(WEAPON.GUN_REST).toHaveLength(3);
  });

  it('keeps the camera usable', () => {
    expect(CAMERA.FOV).toBeGreaterThan(50);
    expect(CAMERA.FOV).toBeLessThan(120);
    expect(CAMERA.NEAR).toBeGreaterThan(0);
    expect(CAMERA.NEAR).toBeLessThan(CAMERA.FAR);
    expect(CAMERA.CROSSHAIR_GAP_SPAN).toBeGreaterThan(0);
  });

  it('keeps every enemy type sane', () => {
    for (const [name, t] of Object.entries(ENEMY_TYPES)) {
      expect(t.hp, name).toBeGreaterThan(0);
      expect(t.speed, name).toBeGreaterThan(0);
      expect(t.scale, name).toBeGreaterThan(0);
      expect(t.dmg, name).toBeGreaterThan(0);
      expect(t.score, name).toBeGreaterThan(0);
      expect(t.body, name).toBeGreaterThan(0);
    }
    // The runners are meant to be fast and frail, the tanks the opposite.
    expect(ENEMY_TYPES.runner.speed).toBeGreaterThan(ENEMY_TYPES.grunt.speed);
    expect(ENEMY_TYPES.tank.hp).toBeGreaterThan(ENEMY_TYPES.grunt.hp);
  });

  it('keeps separation inside one hash cell neighbourhood', () => {
    // `SpatialHash` cells are 2 wide, so a separation distance well under 2
    // keeps the broadphase correct.
    const maxSeparation = ENEMY.SEPARATION * ENEMY_TYPES.tank.scale + ENEMY.SEPARATION_PAD;
    expect(maxSeparation).toBeLessThan(2);
    expect(ENEMY.DEATH_TIME).toBeGreaterThan(0);
    expect(ENEMY.SPAWN_ATTEMPTS).toBeGreaterThan(0);
    expect(ENEMY.SPAWN_MIN_DIST).toBeLessThan(ENEMY.SPAWN_RING);
  });

  it('keeps vertical navigation coherent with the arena', () => {
    // A platform is a wall to a walker and to a jumper, so its ramp is the only
    // way up — for the player. Mobs never climb; they besiege the mouth.
    expect(ENEMY.STEP).toBeLessThan(PLATFORM_H);
    expect(WORLD.STEP_HEIGHT).toBeLessThan(PLATFORM_H);
    expect((WORLD.JUMP_V * WORLD.JUMP_V) / (2 * WORLD.GRAVITY)).toBeLessThan(PLATFORM_H);
    // Melee cannot reach across a deck, and giving up the chase happens first.
    expect(ENEMY.ATTACK_RISE).toBeLessThan(PLATFORM_H);
    expect(ENEMY.CLIMB_RISE).toBeLessThan(ENEMY.ATTACK_RISE);
    expect(ENEMY.RAMP_OFFSET).toBeGreaterThan(0);
  });

  it('keeps the map and its spawn ring consistent', () => {
    expect(WORLD.SPAWN_X).toBeGreaterThan(-WORLD.HALF);
    expect(WORLD.SPAWN_X).toBeLessThan(WORLD.HALF);
    expect(WORLD.SPAWN_Z).toBeGreaterThan(-WORLD.HALF);
    expect(WORLD.SPAWN_Z).toBeLessThan(WORLD.HALF);
    // Every ring spawn has to land inside the walls.
    expect(ENEMY.SPAWN_RING + ENEMY.SPAWN_RING_JITTER).toBeLessThan(WORLD.HALF);
    expect(ENEMY.SPAWN_MIN_DIST).toBeLessThan(ENEMY.SPAWN_RING);
  });

  it('keeps the tower alarm readable', () => {
    expect(ALARM.RADIUS).toBeGreaterThan(0);
    expect(ALARM.RADIUS).toBeLessThan(WORLD.HALF);
    expect(ALARM.HOLD).toBeGreaterThan(0);
  });

  it('keeps the deck capture loop coherent', () => {
    expect(CAPTURE.HOLD_T).toBeGreaterThan(0);
    expect(CAPTURE.DECAY).toBeGreaterThan(0);
    expect(CAPTURE.COOLDOWN).toBeGreaterThan(CAPTURE.HOLD_T);
    expect(CAPTURE.HEAL).toBeGreaterThan(0);
    expect(CAPTURE.HEAL).toBeLessThanOrEqual(START_HP);
    expect(CAPTURE.HEAL_T).toBeGreaterThan(0);
    expect(CAPTURE.RISE).toBeLessThan(PLATFORM_H);
    // The pad has to fit on the deck with room to walk onto it.
    const deckWidth = PLATFORMS[0]?.[2] ?? 0;
    expect(CAPTURE.RADIUS * 2).toBeLessThan(deckWidth);
  });

  it('keeps the wave curve bounded', () => {
    expect(WAVES.MAX_TANKS).toBeGreaterThan(0);
    expect(WAVES.SPEED_GAIN).toBeGreaterThan(0);
    expect(WAVES.SPEED_MAX_SCALE).toBeGreaterThan(1);
    expect(WAVES.INTERMISSION).toBeGreaterThan(0);
    expect(WAVES.STAGGER).toBeGreaterThan(0);
    for (const hp of Object.values(WAVES.HP_PER_WAVE)) expect(hp).toBeGreaterThanOrEqual(0);
  });

  it('keeps fx pools and feedback sane', () => {
    expect(FX.PARTICLE_MAX).toBeGreaterThan(100);
    expect(FX.TRACER_MAX).toBeGreaterThan(0);
    expect(FX.TRACER_DECAY).toBeGreaterThan(0);
    expect(FEEDBACK.HITMARK_DECAY).toBeGreaterThan(0);
    expect(FEEDBACK.VIGNETTE_DECAY).toBeGreaterThan(0);
    expect(FEEDBACK.BANNER_MS).toBeGreaterThan(0);
    expect(FEEDBACK.LOW_HP).toBeLessThan(START_HP);
    expect(START_HP).toBeGreaterThan(0);
  });

  it('keeps the sapper and bomb tuning sane', () => {
    expect(SAPPER.START_WAVE).toBeGreaterThan(1);
    expect(SAPPER.PLANT_T).toBeGreaterThan(0);
    expect(SAPPER.HUNT_AT).toBeGreaterThan(0);
    expect(SAPPER.KEEP_DIST).toBeGreaterThan(SAPPER.THROW_DIST);
    expect(SAPPER.HUNT_SPEED).toBeGreaterThan(ENEMY_TYPES.sapper.speed);

    expect(BOMB.FUSE).toBeGreaterThan(0);
    expect(BOMB.RADIUS).toBeGreaterThan(0);
    expect(BOMB.PLAYER_DMG).toBeGreaterThan(0);
    expect(BOMB.ENEMY_DMG).toBeGreaterThan(BOMB.PLAYER_DMG);
    expect(BOMB.DEFUSE_SCORE).toBeGreaterThan(0);
  });

  it('gives every enemy kind at least two cosmetic looks', () => {
    for (const kind of Object.keys(ENEMY_LOOKS) as (keyof typeof ENEMY_LOOKS)[]) {
      const looks = ENEMY_LOOKS[kind];
      expect(looks.length).toBeGreaterThan(1);
      for (const look of looks) {
        expect(look.body).toBeGreaterThan(0);
        expect(look.accent).toBeGreaterThan(0);
        expect(look.body).not.toBe(look.accent);
      }
    }
  });

  it('keeps the meteor shower coherent', () => {
    expect(METEOR.FIRST_DELAY).toBeGreaterThanOrEqual(0);
    expect(METEOR.DORMANT_MIN).toBeGreaterThan(0);
    expect(METEOR.DORMANT_SPAN).toBeGreaterThanOrEqual(0);
    expect(METEOR.WARN_T).toBeGreaterThan(0);
    expect(METEOR.DURATION).toBeGreaterThan(0);
    expect(METEOR.SKY_IN).toBeGreaterThan(0);
    expect(METEOR.SKY_OUT).toBeGreaterThan(0);
    expect(METEOR.SKY_MIX).toBeGreaterThan(0);
    expect(METEOR.SKY_MIX).toBeLessThanOrEqual(1);
    expect(METEOR.SKY_DIM).toBeGreaterThanOrEqual(0);
    expect(METEOR.SKY_DIM).toBeLessThanOrEqual(1);
    expect(METEOR.STONE_EVERY).toBeGreaterThan(0);
    expect(METEOR.FALL_T).toBeGreaterThan(0);
    expect(METEOR.SPAWN_Y).toBeGreaterThan(0);
    expect(METEOR.ROCK_R).toBeGreaterThan(0);
    // Stones must land near the player but never on top of them.
    expect(METEOR.RADIUS).toBeLessThan(METEOR.TARGET_MIN);
    expect(METEOR.TARGET_MIN).toBeLessThan(METEOR.TARGET_MAX);
    expect(METEOR.TARGET_ATTEMPTS).toBeGreaterThan(0);
    expect(METEOR.PLAYER_DMG).toBeGreaterThan(0);
    expect(METEOR.ENEMY_DMG).toBeGreaterThan(0);
    expect(METEOR.SOUND_R).toBeGreaterThan(METEOR.RADIUS);
  });

  it('keeps the xp curve and the level-up reward sane', () => {
    expect(XP_LEVEL.FIRST_NEED).toBeGreaterThan(0);
    expect(XP_LEVEL.GROWTH).toBeGreaterThan(1);
    expect(XP_LEVEL.HEAL).toBeGreaterThan(0);
    // A level-up must never beat a capture, which is the premium heal.
    expect(XP_LEVEL.HEAL).toBeLessThanOrEqual(CAPTURE.HEAL);
    expect(XP.RADIUS).toBeGreaterThan(0);
    expect(XP.COLLECT).toBeGreaterThan(0);
    expect(XP.PULL_SPEED).toBeGreaterThan(0);
    // Every enemy kind drops an orb worth something.
    expect(Object.keys(XP.VALUE).sort()).toEqual(Object.keys(ENEMY_TYPES).sort());
    for (const [kind, value] of Object.entries(XP.VALUE)) {
      expect(value, kind).toBeGreaterThan(0);
    }
    expect(XP.VALUE.tank).toBeGreaterThan(XP.VALUE.grunt);
  });

  it('caps a frame at a sane step', () => {
    expect(FIXED_STEP).toBeCloseTo(1 / 60, 10);
    expect(MAX_DT).toBeGreaterThan(FIXED_STEP);
  });

  it('keeps the touch stick coherent', () => {
    expect(TOUCH.STICK_R).toBeGreaterThan(0);
    // The dead zone must sit inside the sprint threshold, which must sit
    // inside the stick itself, or sprint would either never fire or always fire.
    expect(TOUCH.DEAD_ZONE).toBeGreaterThan(0);
    expect(TOUCH.DEAD_ZONE).toBeLessThan(TOUCH.SPRINT_FRACTION);
    expect(TOUCH.SPRINT_FRACTION).toBeLessThanOrEqual(1);
    // Look gain scales WEAPON.SENS; zero would freeze the view.
    expect(TOUCH.LOOK_GAIN).toBeGreaterThan(0);
  });

  it('keeps the video options inside sane bounds', () => {
    // The pixel ratio caps must ascend: index 0 is the cheapest setting.
    const caps = [...VIDEO.QUALITY_PIXELS];
    expect(caps.length).toBeGreaterThan(1);
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i]).toBeGreaterThan(caps[i - 1] ?? 0);
    }
    expect(caps[0]).toBeGreaterThan(0);
    // The field of view range has to contain the default camera fov.
    expect(VIDEO.FOV_MIN).toBeLessThan(CAMERA.FOV);
    expect(VIDEO.FOV_MAX).toBeGreaterThan(CAMERA.FOV);
    // Bloom glows the neon, it must not wash the arena out.
    expect(BLOOM.STRENGTH).toBeGreaterThan(0);
    expect(BLOOM.STRENGTH).toBeLessThan(2);
    expect(BLOOM.RADIUS).toBeGreaterThan(0);
    expect(BLOOM.RADIUS).toBeLessThanOrEqual(1);
    expect(BLOOM.THRESHOLD).toBeGreaterThan(0.5);
    expect(BLOOM.THRESHOLD).toBeLessThan(1);
  });

  it('paints every theme completely and legibly', () => {
    // Four presets, unique ids, and the shipped look preserved as one of them.
    expect(Object.keys(THEMES)).toEqual(['synthwave', 'industrial', 'toxic', 'blood']);
    expect(new Set(Object.values(THEMES).map((t) => t.id)).size).toBe(4);
    expect(THEMES[DEFAULT_THEME]).toBeDefined();

    const numberKeys = [
      'sky',
      'hemiSky',
      'hemiGround',
      'ambient',
      'cornerLight',
      'sun',
      'fill',
      'star',
    ] as const;
    const stringKeys = [
      'floorBase',
      'floorPlate',
      'floorLane',
      'floorZone',
      'cssAccent',
      'cssDanger',
    ] as const;
    for (const [id, theme] of Object.entries(THEMES) as [string, ThemeDef][]) {
      expect(theme.name.length, id).toBeGreaterThan(0);
      // Below ~1.0 hemisphere the enemies' body colours drop out and they read
      // as black silhouettes — every theme has to stay above the line.
      expect(theme.hemiIntensity, id).toBeGreaterThanOrEqual(1.0);
      expect(theme.fogNear, id).toBeGreaterThan(0);
      expect(theme.fogFar, id).toBeGreaterThan(theme.fogNear);
      expect(theme.ambientIntensity, id).toBeGreaterThan(0);
      expect(theme.cornerIntensity, id).toBeGreaterThan(0);
      expect(theme.sunIntensity, id).toBeGreaterThan(0);
      expect(theme.fillIntensity, id).toBeGreaterThan(0);
      for (const key of numberKeys) expect(theme[key], `${id}.${key}`).toBeGreaterThan(0);
      for (const key of stringKeys) expect(theme[key], `${id}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
      // The structure palette is real colours, and the two neon accents differ.
      expect(theme.cyan, id).not.toBe(theme.magenta);
      expect(theme.hazard, id).not.toBe(theme.dark);
    }
    // The industrial preset is the shipped look, verbatim.
    expect(THEMES.industrial).toMatchObject({
      sky: 0x0c1222,
      body: 0x38456a,
      hazard: 0xf2b21e,
      hemiIntensity: 1.35,
    });
  });

  it('names every state and screen exactly once', () => {
    expect(Object.values(STATE)).toEqual(['menu', 'playing', 'paused', 'gameover']);
    expect(Object.values(SCREEN)).toEqual(['none', 'menu', 'pause', 'gameover']);
    expect(new Set(Object.values(STATE)).size).toBe(4);
  });

  it('keeps the ammo economy coherent', () => {
    expect(AMMO.RESERVE_START).toBeGreaterThan(0);
    expect(AMMO.RESERVE_MAX).toBeGreaterThanOrEqual(AMMO.RESERVE_START);
    // Every mob drops something, and a tank is worth more than a grunt.
    expect(Object.keys(AMMO.DROP).sort()).toEqual(Object.keys(ENEMY_TYPES).sort());
    for (const value of Object.values(AMMO.DROP)) expect(value).toBeGreaterThan(0);
    expect(AMMO.DROP.tank).toBeGreaterThan(AMMO.DROP.grunt);
    // A wave hands out enough rounds to matter but not enough to replace aim.
    expect(WAVES.AMMO_PER_WAVE).toBeGreaterThan(0);
    expect(WAVES.AMMO_PER_WAVE).toBeLessThan(WEAPON.MAG * 3);
  });

  it('keeps the knife coherent', () => {
    expect(KNIFE.DAMAGE).toBeGreaterThan(0);
    expect(KNIFE.RANGE).toBeGreaterThan(0);
    expect(KNIFE.ARC).toBeGreaterThan(0);
    expect(KNIFE.ARC).toBeLessThanOrEqual(Math.PI);
    expect(KNIFE.COOLDOWN).toBeGreaterThan(0);
    expect(KNIFE.SWING_T).toBeGreaterThan(0);
    expect(KNIFE.SWING_T).toBeLessThanOrEqual(KNIFE.COOLDOWN);
    // The knife one-shots a grunt and a runner, and needs three for a tank.
    expect(KNIFE.DAMAGE).toBeGreaterThanOrEqual(ENEMY_TYPES.runner.hp);
    expect(KNIFE.DAMAGE).toBeLessThan(ENEMY_TYPES.tank.hp);
    expect(Math.ceil(ENEMY_TYPES.tank.hp / KNIFE.DAMAGE)).toBe(3);
  });

  it('keeps the mob verbs coherent', () => {
    // The shield only covers the front, and it must matter.
    expect(ENEMY.SHIELD_ARC).toBeGreaterThan(0);
    expect(ENEMY.SHIELD_ARC).toBeLessThanOrEqual(Math.PI);
    expect(ENEMY.SHIELD_CUT).toBeGreaterThan(0);
    expect(ENEMY.SHIELD_CUT).toBeLessThan(1);
    expect(ENEMY.WINDUP).toBeGreaterThan(0);
    // A mob turns slower than a player can strafe, or the shield is useless.
    for (const rate of Object.values(ENEMY.TURN_RATE)) expect(rate).toBeGreaterThan(0);
    expect(ENEMY.TURN_RATE.tank).toBeLessThan(ENEMY.TURN_RATE.runner);

    // The runner's pounce: a tell, a burst, and a slow patch afterwards.
    expect(RUNNER.POUNCE_TELL).toBeGreaterThan(0);
    expect(RUNNER.POUNCE_T).toBeGreaterThan(0);
    expect(RUNNER.POUNCE_GAIN).toBeGreaterThan(1);
    expect(RUNNER.RECOVER_GAIN).toBeLessThan(1);
    expect(RUNNER.POUNCE_MIN).toBeLessThan(RUNNER.POUNCE_MAX);

    // The tank's slam reaches further than a swipe and hits harder.
    expect(TANK.SLAM_R).toBeGreaterThan(ENEMY.REACH_PAD);
    expect(TANK.SLAM_MULT).toBeGreaterThan(1);
    expect(TANK.ARMOUR_CUT).toBeGreaterThan(0);
    expect(TANK.ARMOUR_CUT).toBeLessThan(ENEMY.SHIELD_CUT);
    expect(TANK.WINDUP).toBeGreaterThan(ENEMY.WINDUP);
  });

  it('keeps the shop coherent', () => {
    // Four rifle skins and four knife skins, every id unique.
    expect(SKINS).toHaveLength(8);
    expect(SKINS.filter((s) => s.weapon === 'rifle')).toHaveLength(4);
    expect(SKINS.filter((s) => s.weapon === 'knife')).toHaveLength(4);
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(SKINS.length);
    // Every skin is named, priced and has a part the viewmodel can build.
    for (const skin of SKINS) {
      expect(skin.name.length).toBeGreaterThan(0);
      expect(skin.flavour.length).toBeGreaterThan(0);
      expect(skin.price).toBeGreaterThan(0);
      if (skin.weapon === 'rifle') expect(['iron', 'reddot', 'holo', 'scope']).toContain(skin.part);
      else expect(['straight', 'cleaver', 'saw', 'hook']).toContain(skin.part);
    }
    // The four tiers, cheapest first.
    const prices = [...new Set(SKINS.map((s) => s.price))].sort((a, b) => a - b);
    expect(prices).toEqual([300, 900, 2000, 4500]);
    // Every palette colour is a real colour, and the two weapons of a theme match.
    for (const skin of SKINS) {
      for (const colour of Object.values(skin.palette)) {
        expect(Number.isInteger(colour)).toBe(true);
        expect(colour).toBeGreaterThanOrEqual(0);
        expect(colour).toBeLessThanOrEqual(0xffffff);
      }
    }
    for (const rifle of SKINS.filter((s) => s.weapon === 'rifle')) {
      const knife = SKINS.find((s) => s.weapon === 'knife' && s.id === rifle.id.replace('rifle', 'knife'));
      expect(knife).toBeDefined();
      expect(knife?.price).toBe(rifle.price);
      expect(knife?.palette).toEqual(rifle.palette);
    }
  });

  it('keeps the credit economy coherent', () => {
    // Every mob is worth something, and a tank is worth the most.
    expect(Object.keys(CREDITS.KILL).sort()).toEqual(Object.keys(ENEMY_TYPES).sort());
    for (const value of Object.values(CREDITS.KILL)) expect(value).toBeGreaterThan(0);
    expect(CREDITS.KILL.tank).toBeGreaterThan(CREDITS.KILL.grunt);
    expect(CREDITS.HEADSHOT).toBeGreaterThan(0);
    expect(CREDITS.WAVE).toBeGreaterThan(0);
    expect(CREDITS.CAPTURE).toBeGreaterThan(0);
    // A wave's worth of kills plus the wave bonus must reach the cheapest skin
    // in a reasonable number of waves, or the shop is dead on arrival.
    const waveWorth = CREDITS.KILL.grunt * 3 + CREDITS.WAVE;
    expect(waveWorth * 10).toBeGreaterThan(300);
  });
});
