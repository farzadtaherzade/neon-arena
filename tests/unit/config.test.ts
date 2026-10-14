import { describe, expect, it } from 'vitest';
import {
  CAMERA,
  ENEMY,
  ENEMY_TYPES,
  FEEDBACK,
  FIXED_STEP,
  FX,
  MAX_DT,
  SCREEN,
  START_HP,
  STATE,
  WAVES,
  WEAPON,
  WORLD,
} from '../../src/game/config';

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
