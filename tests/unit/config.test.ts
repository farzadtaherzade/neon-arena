import { describe, expect, it } from 'vitest';
import {
  BOMB,
  CAMERA,
  ENEMY,
  ENEMY_LOOKS,
  ENEMY_TYPES,
  FEEDBACK,
  FIXED_STEP,
  FX,
  MAX_DT,
  SAPPER,
  SCREEN,
  START_HP,
  STATE,
  WAVES,
  WEAPON,
  WORLD,
} from '../../src/game/config';
import { PLATFORM_H } from '../../src/game/world/layout';

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
    // way up — for the player and for the mobs alike.
    expect(ENEMY.STEP).toBeLessThan(PLATFORM_H);
    expect(WORLD.STEP_HEIGHT).toBeLessThan(PLATFORM_H);
    expect((WORLD.JUMP_V * WORLD.JUMP_V) / (2 * WORLD.GRAVITY)).toBeLessThan(PLATFORM_H);
    // Melee cannot reach across a platform deck...
    expect(ENEMY.ATTACK_RISE).toBeLessThan(PLATFORM_H);
    // ...but a mob on the slope can still be hit, and knows to detour.
    expect(ENEMY.CLIMB_RISE).toBeLessThan(ENEMY.ATTACK_RISE);
    expect(ENEMY.RAMP_OFFSET).toBeGreaterThan(0);
    expect(ENEMY.RAMP_ALIGN).toBeGreaterThan(ENEMY.RAMP_OFFSET);
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

  it('caps a frame at a sane step', () => {
    expect(FIXED_STEP).toBeCloseTo(1 / 60, 10);
    expect(MAX_DT).toBeGreaterThan(FIXED_STEP);
  });

  it('names every state and screen exactly once', () => {
    expect(Object.values(STATE)).toEqual(['menu', 'playing', 'paused', 'gameover']);
    expect(Object.values(SCREEN)).toEqual(['none', 'start', 'pause', 'gameover']);
    expect(new Set(Object.values(STATE)).size).toBe(4);
  });
});
