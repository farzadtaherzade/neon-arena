import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { ENEMY, ENEMY_TYPES, RUNNER, SAPPER, TANK } from '../../src/game/config';
import { SpatialHash } from '../../src/game/enemies';
import { Enemy, type EnemyWorld } from '../../src/game/enemy';
import { CollisionWorld, type Vec2 } from '../../src/game/world/collision';
import { PLATFORM_H, PLATFORMS, RAMPS } from '../../src/game/world/layout';

interface TestWorld extends EnemyWorld {
  hurt: number;
  bombs: { from: Vec2; to: Vec2; thrown: boolean }[];
  knock: { x: number; z: number; force: number }[];
}

function makeWorld(playerPos = { x: 0, z: 0 }, neighbours: readonly Enemy[] = []): TestWorld {
  const w: TestWorld = {
    playerPos,
    playerY: 0,
    neighbours,
    hostileCount: 99,
    ramps: [],
    hurt: 0,
    bombs: [],
    knock: [],
    collide: () => {},
    support: () => 0,
    damagePlayer(amount: number) {
      w.hurt += amount;
    },
    knockPlayer(x: number, z: number, force: number) {
      w.knock.push({ x, z, force });
    },
    plantBomb(from: Vec2, to: Vec2, thrown: boolean) {
      w.bombs.push({ from, to, thrown });
    },
  };
  return w;
}

/** A world backed by the real arena layout, so ramps and platforms collide. */
function arenaWorld(playerPos = { x: 0, z: 0 }): TestWorld {
  const c = new CollisionWorld();
  for (const [x, z, w, h, d] of PLATFORMS) {
    c.addObstacle({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 }, h);
  }
  for (const [x, z, w, len, upX, upZ] of RAMPS) {
    const spanX = upX !== 0 ? len : w;
    const spanZ = upZ !== 0 ? len : w;
    c.addRamp({
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

  const world = makeWorld(playerPos);
  world.ramps = c.ramps;
  world.collide = (p, r, feetY) => c.resolveCircle(p, r, { feetY, step: ENEMY.STEP });
  world.support = (x, z, r, ceiling) => c.groundHeight({ x, z }, r, ceiling);
  return world;
}

function spawn(kind: keyof typeof ENEMY_TYPES, x: number, z: number): Enemy {
  return new Enemy(kind, x, z, new Rng(5));
}

describe('Enemy', () => {
  it('starts from its type sheet', () => {
    const e = spawn('tank', 3, -4);
    expect(e.pos).toEqual({ x: 3, y: 0, z: -4 });
    expect(e.stats.maxHp).toBe(ENEMY_TYPES.tank.hp);
    expect(e.hp).toBe(ENEMY_TYPES.tank.hp);
    expect(e.scale).toBe(ENEMY_TYPES.tank.scale);
    expect(e.state).toBe('alive');
  });

  it('takes damage, flashes, and dies once', () => {
    const e = spawn('grunt', 8, 0);
    expect(e.takeDamage(10)).toBe(false);
    expect(e.hp).toBe(ENEMY_TYPES.grunt.hp - 10);
    expect(e.flashT).toBeGreaterThan(0);

    expect(e.takeDamage(1000)).toBe(true);
    expect(e.state).toBe('alive'); // takeDamage reports the kill; kill() runs the animation
    expect(e.kill()).toBe(true);
    expect(e.state).toBe('dying');
    expect(e.kill()).toBe(false);
    expect(e.takeDamage(1000)).toBe(false); // already dying: no double score
  });

  it('runs the death clock and then reports finished', () => {
    const e = spawn('grunt', 8, 0);
    e.kill();
    let finished = false;
    for (let i = 0; i < 200 && !finished; i++) finished = e.update(1 / 60, makeWorld());
    expect(finished).toBe(true);
    expect(e.deathK).toBe(1);
  });

  it('chases the player when out of reach', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('grunt', 10, 0);
    for (let i = 0; i < 60; i++) e.update(1 / 60, world);
    expect(e.pos.x).toBeLessThan(10);
    expect(world.hurt).toBe(0);
  });

  it('attacks on a cooldown once inside reach', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('grunt', 0.1, 0);
    e.cool = 0;
    for (let i = 0; i < 60; i++) e.update(1 / 60, world);
    expect(world.hurt).toBe(ENEMY_TYPES.grunt.dmg);
    expect(e.cool).toBeGreaterThan(0);
    expect(e.cool).toBeLessThanOrEqual(ENEMY.ATTACK_COOLDOWN);
  });

  it('does not claw at a player standing on a platform it has not climbed', () => {
    const world = makeWorld({ x: 0, z: 0 });
    world.playerY = PLATFORM_H;
    const e = spawn('grunt', 0.2, 0);
    e.cool = 0;
    for (let i = 0; i < 120; i++) e.update(1 / 60, world);
    expect(world.hurt).toBe(0);
  });

  it('besieges the ramp mouth instead of climbing to a player on the deck', () => {
    // Player on the north deck, grunt on the floor south of it.
    const world = arenaWorld({ x: 0, z: -35 });
    world.playerY = PLATFORM_H;
    const e = spawn('grunt', 0, -14);

    let peak = 0;
    for (let i = 0; i < 60 * 14; i++) {
      e.update(1 / 60, world);
      peak = Math.max(peak, e.pos.y);
    }

    // High ground is melee-safe: it never leaves the floor...
    expect(peak).toBeLessThan(0.2);
    expect(e.pos.y).toBeLessThan(0.2);
    expect(world.hurt).toBe(0);
    // ...and it parks at the bottom of the slope, not against the deck wall.
    const mouthZ = -24.6; // the toe pushed ENEMY.RAMP_OFFSET downhill
    expect(Math.hypot(e.pos.x, e.pos.z - mouthZ)).toBeLessThan(4);
  });

  it('falls back to the floor when it walks off a platform', () => {
    // Chase east, off the deck's bare east face (the ramp is on the south side).
    const world = arenaWorld({ x: 60, z: -35 });
    const e = spawn('grunt', 0, -35);
    e.pos.y = PLATFORM_H;
    e.grounded = true;
    world.playerY = 0;

    for (let i = 0; i < 60 * 4; i++) e.update(1 / 60, world);
    expect(e.pos.x).toBeGreaterThan(3.5);
    expect(e.pos.y).toBeLessThan(0.01);
  });

  it('pushes away from a neighbour standing on top of it', () => {
    const world = makeWorld({ x: 40, z: 40 }); // nothing to chase: separation dominates
    const a = spawn('grunt', 0, 0);
    const b = spawn('grunt', 0.4, 0);
    world.neighbours = [a, b];
    for (let i = 0; i < 30; i++) {
      a.update(1 / 60, world);
      b.update(1 / 60, world);
    }
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThan(0.4);
    expect(a.pos.x).toBeLessThan(b.pos.x);
  });

  it('applies per-wave scaling', () => {
    const e = spawn('grunt', 0, 0);
    e.scaleUp(25, 1.2, 4);
    expect(e.stats.maxHp).toBe(ENEMY_TYPES.grunt.hp + 25);
    expect(e.hp).toBe(ENEMY_TYPES.grunt.hp + 25);
    expect(e.stats.speed).toBeCloseTo(ENEMY_TYPES.grunt.speed * 1.2, 10);
    expect(e.stats.dmg).toBe(ENEMY_TYPES.grunt.dmg + 4);
  });

  it('knocks back along the shot direction', () => {
    const e = spawn('grunt', 0, 0);
    e.knockback(1, 0);
    expect(e.pos.x).toBeCloseTo(ENEMY.KNOCKBACK, 10);
  });

  it('turns toward the player at a limited rate and animates from its phase', () => {
    const e = spawn('grunt', 0, 5);
    // It starts facing south and has to turn — it cannot snap to the player.
    expect(e.facingYaw).toBe(0);
    e.update(1 / 60, makeWorld({ x: 0, z: 0 }));
    expect(e.facingYaw).toBeGreaterThan(0);
    expect(e.facingYaw).toBeLessThanOrEqual(ENEMY.TURN_RATE.grunt / 60 + 1e-9);
    const bounce0 = e.bounce;
    for (let i = 0; i < 30; i++) e.update(1 / 60, makeWorld({ x: 0, z: 50 }));
    expect(e.bounce).not.toBe(bounce0);
    expect(Math.abs(e.legSwing)).toBeLessThanOrEqual(ENEMY.LEG_SWING + 1e-9);
  });
});

describe('Armour and tells', () => {
  it('cuts a hit that lands on the grunt front plate', () => {
    const e = spawn('grunt', 0, 0);
    e.facingYaw = 0; // looking down +z
    const before = e.hp;
    // The shooter is in front, so the plate is between the bullet and the grunt.
    e.takeDamage(100, { dirX: 0, dirZ: 1, headshot: false, melee: false });
    expect(before - e.hp).toBeCloseTo(100 * (1 - ENEMY.SHIELD_CUT), 6);
  });

  it('takes a hit from behind in full', () => {
    const e = spawn('grunt', 0, 0);
    e.facingYaw = 0;
    const before = e.hp;
    e.takeDamage(100, { dirX: 0, dirZ: -1, headshot: false, melee: false });
    expect(before - e.hp).toBe(100);
  });

  it('never cuts a headshot, a blade or an explosion', () => {
    const head = spawn('grunt', 0, 0);
    head.facingYaw = 0;
    const hp0 = head.hp;
    head.takeDamage(100, { dirX: 0, dirZ: 1, headshot: true, melee: false });
    expect(hp0 - head.hp).toBe(100);

    const stabbed = spawn('grunt', 0, 0);
    stabbed.facingYaw = 0;
    const hp1 = stabbed.hp;
    stabbed.takeDamage(100, { dirX: 0, dirZ: 1, headshot: false, melee: true });
    expect(hp1 - stabbed.hp).toBe(100);

    const bombed = spawn('grunt', 0, 0);
    bombed.facingYaw = 0;
    const hp2 = bombed.hp;
    bombed.takeDamage(100);
    expect(hp2 - bombed.hp).toBe(100);
  });

  it('gives the tank a thinner plate than the grunt shield', () => {
    const tank = spawn('tank', 0, 0);
    tank.facingYaw = 0;
    const before = tank.hp;
    tank.takeDamage(100, { dirX: 0, dirZ: 1, headshot: false, melee: false });
    expect(before - tank.hp).toBeCloseTo(100 * (1 - TANK.ARMOUR_CUT), 6);
  });

  it('leaves the runner and the sapper unarmoured', () => {
    for (const kind of ['runner', 'sapper'] as const) {
      const e = spawn(kind, 0, 0);
      e.facingYaw = 0;
      const before = e.hp;
      e.takeDamage(100, { dirX: 0, dirZ: 1, headshot: false, melee: false });
      expect(before - e.hp).toBe(100);
    }
  });

  it('only shields what the mob is looking at', () => {
    const e = spawn('grunt', 0, 0);
    e.facingYaw = 0;
    const before = e.hp;
    // A hit from the side, outside the shield arc.
    e.takeDamage(100, { dirX: Math.sin(1.4), dirZ: Math.cos(1.4), headshot: false, melee: false });
    expect(before - e.hp).toBe(100);
  });

  it('winds up before the blow lands', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('grunt', 0, 0.4);
    // The first swing comes after the spawn cooldown.
    for (let i = 0; i < 120 && e.windup <= 0; i++) e.update(1 / 60, world);
    expect(e.windup).toBeGreaterThan(0);
    expect(world.hurt).toBe(0); // the tell is running: nothing has hit yet
    for (let i = 0; i < Math.ceil(ENEMY.WINDUP * 60) + 2; i++) e.update(1 / 60, world);
    expect(world.hurt).toBeCloseTo(ENEMY_TYPES.grunt.dmg, 5);
  });

  it('misses when the player steps out of reach during the tell', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('grunt', 0, 0.4);
    for (let i = 0; i < 120 && e.windup <= 0; i++) e.update(1 / 60, world);
    expect(e.windup).toBeGreaterThan(0);
    world.playerPos = { x: 0, z: 6 };
    for (let i = 0; i < Math.ceil(ENEMY.WINDUP * 60) + 2; i++) e.update(1 / 60, world);
    expect(world.hurt).toBe(0);
  });

  it('slams the ground: more damage and a knockback', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('tank', 0, 2);
    for (let i = 0; i < 120 && e.windup <= 0; i++) e.update(1 / 60, world);
    expect(e.windup).toBeGreaterThan(0);
    for (let i = 0; i < Math.ceil(TANK.WINDUP * 60) + 2; i++) e.update(1 / 60, world);
    expect(world.hurt).toBeCloseTo(ENEMY_TYPES.tank.dmg * TANK.SLAM_MULT, 5);
    expect(world.knock).toHaveLength(1);
    expect(world.knock[0]?.force).toBe(TANK.KNOCK);
    expect(world.knock[0]?.z).toBeCloseTo(-1, 5); // shoved away from the tank
  });

  it('crouches, pounces and then slows down', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('runner', 0, 8);
    e.update(1 / 60, world);
    expect(e.pounceTell).toBeGreaterThan(0); // the crouch is the tell
    expect(e.pounce).toBe(0);

    for (let i = 0; i < Math.ceil(RUNNER.POUNCE_TELL * 60) + 2; i++) e.update(1 / 60, world);
    expect(e.pounce).toBeGreaterThan(0);

    for (let i = 0; i < Math.ceil(RUNNER.POUNCE_T * 60) + 2; i++) e.update(1 / 60, world);
    expect(e.recover).toBeGreaterThan(0);
  });

  it('does not pounce from too far away', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('runner', 0, 25);
    for (let i = 0; i < 30; i++) e.update(1 / 60, world);
    expect(e.pounceTell).toBe(0);
    expect(e.pounce).toBe(0);
  });
});

describe('Sapper', () => {
  it('keeps its distance and never charges', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('sapper', 0, 6);
    for (let i = 0; i < 60; i++) e.update(1 / 60, world);
    expect(e.sapperMode).toBe('lurk');
    expect(Math.hypot(e.pos.x, e.pos.z)).toBeGreaterThan(6);
    expect(world.hurt).toBe(0);
    expect(world.bombs).toHaveLength(0);
  });

  it('throws a bomb at the player when far away', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('sapper', 0, 20);
    e.plantT = 0.05;
    for (let i = 0; i < 60; i++) e.update(1 / 60, world);
    expect(world.bombs).toHaveLength(1);
    expect(world.bombs[0]!.thrown).toBe(true);
    expect(world.bombs[0]!.to).toEqual({ x: 0, z: 0 });
  });

  it('drops the bomb at its feet when the player is close', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('sapper', 0, 5);
    e.plantT = 0.05;
    for (let i = 0; i < 60; i++) e.update(1 / 60, world);
    expect(world.bombs[0]!.thrown).toBe(false);
    expect(world.bombs[0]!.to.x).toBeCloseTo(e.pos.x, 10);
    expect(world.bombs[0]!.to.z).toBeCloseTo(e.pos.z, 10);
  });

  it('lobs a bomb onto the deck when the player is up on one', () => {
    const world = makeWorld({ x: 0, z: 0 });
    world.playerY = PLATFORM_H; // out of melee reach, so distance is irrelevant
    const e = spawn('sapper', 0, 5);
    e.plantT = 0.05;
    for (let i = 0; i < 60; i++) e.update(1 / 60, world);
    expect(world.bombs[0]!.thrown).toBe(true);
    expect(world.bombs[0]!.to).toEqual({ x: 0, z: 0 });
  });

  it('hunts the player once the herd drops below the threshold', () => {
    const world = makeWorld({ x: 0, z: 0 });
    world.hostileCount = SAPPER.HUNT_AT - 1;
    const e = spawn('sapper', 0, 20);
    for (let i = 0; i < 60; i++) e.update(1 / 60, world);
    expect(e.sapperMode).toBe('hunt');
    expect(Math.hypot(e.pos.x, e.pos.z)).toBeLessThan(20);
    expect(world.hurt).toBe(0);
  });

  it('panics when wounded: it flees and drops bombs at its feet', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('sapper', 0, 10);
    e.takeDamage(ENEMY_TYPES.sapper.hp * (1 - SAPPER.PANIC_HP) + 1);
    const z0 = e.pos.z;
    for (let i = 0; i < 30; i++) e.update(1 / 60, world);
    expect(e.sapperMode).toBe('flee');
    expect(e.pos.z).toBeGreaterThan(z0); // running away
    expect(world.bombs).toHaveLength(0); // the first bomb comes after the fuse

    for (let i = 0; i < Math.ceil(SAPPER.PANIC_PLANT_T * 60) + 5; i++) e.update(1 / 60, world);
    expect(world.bombs.length).toBeGreaterThan(0);
    expect(world.bombs[0]?.thrown).toBe(false);
  });

  it('lights the bomb rack just before it plants', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('sapper', 0, 20);
    e.plantT = SAPPER.TELL - 0.3;
    e.update(1 / 60, world);
    expect(e.bombTell).toBeGreaterThan(0);
    expect(e.bombTell).toBeLessThanOrEqual(1);
  });
});

describe('SpatialHash', () => {
  /** Same seed → two identical populations, one stepped naively and one via the hash. */
  function pair(count: number): [Enemy[], Enemy[]] {
    const build = () => {
      const rng = new Rng(11);
      return Array.from({ length: count }, () => spawn('grunt', rng.range(-29, 29), rng.range(-29, 29)));
    };
    return [build(), build()];
  }

  it('separates exactly like the all-pairs loop it replaced', () => {
    const [naive, hashed] = pair(150);
    const hash = new SpatialHash();
    const world = makeWorld({ x: 0, z: 0 });

    for (let step = 0; step < 60; step++) {
      hash.rebuild(hashed);
      for (const e of naive) {
        world.neighbours = naive;
        e.update(1 / 60, world);
      }
      for (const e of hashed) {
        world.neighbours = hash.neighbours(e);
        e.update(1 / 60, world);
      }
    }

    for (let i = 0; i < naive.length; i++) {
      expect(hashed[i]?.pos.x).toBeCloseTo(naive[i]?.pos.x ?? 0, 6);
      expect(hashed[i]?.pos.z).toBeCloseTo(naive[i]?.pos.z ?? 0, 6);
    }
  });

  it('skips dead enemies and reports nothing for an empty cell', () => {
    const hash = new SpatialHash();
    const alive = spawn('grunt', 0, 0);
    const dead = spawn('grunt', 0.2, 0);
    dead.kill();
    hash.rebuild([alive, dead]);
    expect(hash.neighbours(alive)).not.toContain(dead);

    expect(hash.neighbours(spawn('grunt', 20, 20))).toEqual([]);
  });
});
