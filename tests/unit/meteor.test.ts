import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { METEOR } from '../../src/game/config';
import { Meteor, MeteorShower } from '../../src/game/meteor';

const PLAYER = { x: 0, z: 0 };
const GROUND = () => 0;
const OPEN = () => false;
const BLOCKED = () => true;

function step(
  shower: MeteorShower,
  dt: number,
  player = PLAYER,
  rng = new Rng(5),
  ground = GROUND,
  blocked = OPEN,
): { started: boolean; ended: boolean; impacts: Meteor[] } {
  return shower.update(dt, player, rng, ground, blocked);
}

/** Run the shower for `seconds` and report how often it started/ended. */
function run(shower: MeteorShower, seconds: number, blocked = OPEN): { started: number; ended: number } {
  const dt = 1 / 60;
  const n = Math.round(seconds / dt);
  const rng = new Rng(5);
  let started = 0;
  let ended = 0;
  for (let i = 0; i < n; i++) {
    const out = step(shower, dt, PLAYER, rng, GROUND, blocked);
    if (out.started) started++;
    if (out.ended) ended++;
  }
  return { started, ended };
}

describe('Meteor', () => {
  it('falls from the spawn height to the impact point', () => {
    const m = new Meteor(1, 2, 0, 1.4);
    expect(m.pos.y).toBe(METEOR.SPAWN_Y);
    m.update(0.7);
    expect(m.pos.y).toBeGreaterThan(0);
    expect(m.pos.y).toBeLessThan(METEOR.SPAWN_Y);
  });

  it('reports the impact exactly once', () => {
    const m = new Meteor(0, 0, 0, 1);
    let fired = 0;
    for (let i = 0; i < 200; i++) {
      if (m.update(0.01)) fired++;
    }
    expect(fired).toBe(1);
    expect(m.state).toBe('spent');
    expect(m.pos.y).toBe(0);
  });

  it('has a monotonic fall progress', () => {
    const m = new Meteor(0, 0, 0, 1.4);
    expect(m.k).toBe(0);
    let prev = m.k;
    for (let i = 0; i < 200; i++) {
      m.update(0.01);
      expect(m.k).toBeGreaterThanOrEqual(prev);
      prev = m.k;
    }
    expect(m.k).toBe(1);
  });
});

describe('MeteorShower', () => {
  it('stays dormant for the first delay', () => {
    const shower = new MeteorShower();
    const out = run(shower, METEOR.FIRST_DELAY - 1);
    expect(out.started).toBe(0);
    expect(shower.phase).toBe('dormant');
  });

  it('warns before it starts and reports the start once', () => {
    const shower = new MeteorShower();
    const out = run(shower, METEOR.FIRST_DELAY + 0.1);
    expect(out.started).toBe(1);
    expect(shower.phase).toBe('warning');
  });

  it('goes warning → active → dormant and reports the end once', () => {
    const shower = new MeteorShower();
    run(shower, METEOR.FIRST_DELAY + METEOR.WARN_T + 0.5);
    expect(shower.phase).toBe('active');
    const out = run(shower, METEOR.DURATION + 1);
    expect(out.ended).toBe(1);
    expect(shower.phase).toBe('dormant');
  });

  it('drops no stones while it is only warning', () => {
    const shower = new MeteorShower();
    run(shower, METEOR.FIRST_DELAY + METEOR.WARN_T + 0.3);
    expect(shower.phase).toBe('active');
    expect(shower.stones.length).toBe(0);
  });

  it('drops stones once it is active', () => {
    const shower = new MeteorShower();
    run(shower, METEOR.FIRST_DELAY + METEOR.WARN_T + 2);
    expect(shower.stones.length).toBeGreaterThan(0);
  });

  it('never lands a stone inside geometry', () => {
    const shower = new MeteorShower();
    run(shower, METEOR.FIRST_DELAY + METEOR.WARN_T + 3, BLOCKED);
    expect(shower.stones.length).toBe(0);
  });

  it('never lands a stone outside the arena', () => {
    const shower = new MeteorShower();
    const far = { x: 10_000, z: 10_000 };
    const dt = 1 / 60;
    const rng = new Rng(5);
    const n = Math.round((METEOR.FIRST_DELAY + METEOR.WARN_T + 3) * 60);
    for (let i = 0; i < n; i++) {
      step(shower, dt, far, rng);
    }
    expect(shower.stones.length).toBe(0);
  });

  it('ramps the sky tint in, holds it, then lets it decay', () => {
    const shower = new MeteorShower();
    expect(shower.tint).toBe(0);
    run(shower, METEOR.FIRST_DELAY + METEOR.SKY_IN + 0.1);
    expect(shower.tint).toBe(1);
    run(shower, 1);
    expect(shower.tint).toBe(1);
    // The shower ends, and the sky fades back over SKY_OUT seconds.
    run(shower, METEOR.DURATION + METEOR.SKY_OUT + 1);
    expect(shower.tint).toBe(0);
  });

  it('reports a landing once and drops the stone', () => {
    const shower = new MeteorShower();
    const m = shower.drop(3, -4, 1.5, new Rng(1));
    expect(shower.stones.length).toBe(1);
    let impacts = 0;
    for (let i = 0; i < 300; i++) {
      impacts += step(shower, 0.02).impacts.length;
    }
    expect(impacts).toBe(1);
    expect(shower.stones.length).toBe(0);
    expect(m.impact.y).toBe(1.5);
  });

  it('places a dropped stone exactly where it was asked for', () => {
    const shower = new MeteorShower();
    const m = shower.drop(3, -4, 1.5, new Rng(1));
    expect(m.pos.x).toBe(3);
    expect(m.pos.z).toBe(-4);
    expect(m.impact.x).toBe(3);
    expect(m.impact.z).toBe(-4);
    expect(m.impact.y).toBe(1.5);
  });

  it('reuses one result object between steps', () => {
    const shower = new MeteorShower();
    const first = step(shower, 0.1);
    const second = step(shower, 0.1);
    expect(second).toBe(first);
  });

  it('clears everything on reset', () => {
    const shower = new MeteorShower();
    run(shower, METEOR.FIRST_DELAY + METEOR.WARN_T + 2);
    shower.reset();
    expect(shower.phase).toBe('dormant');
    expect(shower.tint).toBe(0);
    expect(shower.stones.length).toBe(0);
  });

  it('can be forced into the warning phase', () => {
    const shower = new MeteorShower();
    shower.force();
    expect(shower.phase).toBe('warning');
  });
});
