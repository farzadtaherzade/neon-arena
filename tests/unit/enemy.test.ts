import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import type { BombVariant } from '../../src/game/bomb';
import {
  BLINKER,
  BOSS,
  COLOSSUS,
  CREEPER,
  ENEMY,
  ENEMY_TYPES,
  RUNNER,
  SAPPER,
  TANK,
  WITCH,
} from '../../src/game/config';
import { SpatialHash } from '../../src/game/enemies';
import { Enemy, type EnemyWorld } from '../../src/game/enemy';
import { buildHome, DISTRICT_RAMP } from '../../src/game/world/chunks';
import { CollisionWorld, type Vec2 } from '../../src/game/world/collision';
import { DECK, PLATFORM_H } from '../../src/game/world/layout';

/** The rolled home arena the siege tests build against, at a fixed seed. */
const HOME = buildHome(20261101);

interface TestWorld extends EnemyWorld {
  hurt: number;
  bombs: { from: Vec2; to: Vec2; thrown: boolean; variant: BombVariant | undefined }[];
  knock: { x: number; z: number; force: number }[];
}

function makeWorld(playerPos = { x: 0, z: 0 }, neighbours: readonly Enemy[] = []): TestWorld {
  const w: TestWorld = {
    playerPos,
    playerY: 0,
    neighbours,
    foes: neighbours,
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
    plantBomb(from: Vec2, to: Vec2, thrown: boolean, variant?: BombVariant) {
      w.bombs.push({ from, to, thrown, variant });
    },
  };
  return w;
}

/** A world backed by the rolled home arena, so ramps and decks collide. */
function arenaWorld(playerPos = { x: 0, z: 0 }): TestWorld {
  const c = new CollisionWorld();
  for (const { deck } of HOME.tables.decks) {
    c.addObstacle(
      {
        minX: deck.x - DECK.w / 2,
        maxX: deck.x + DECK.w / 2,
        minZ: deck.z - DECK.d / 2,
        maxZ: deck.z + DECK.d / 2,
      },
      DECK.h,
    );
  }
  for (const { ramp } of HOME.tables.decks) {
    const spanX = ramp.upX !== 0 ? DISTRICT_RAMP.length : DISTRICT_RAMP.width;
    const spanZ = ramp.upZ !== 0 ? DISTRICT_RAMP.length : DISTRICT_RAMP.width;
    c.addRamp({
      minX: ramp.x - spanX / 2,
      maxX: ramp.x + spanX / 2,
      minZ: ramp.z - spanZ / 2,
      maxZ: ramp.z + spanZ / 2,
      lowY: 0,
      highY: PLATFORM_H,
      upX: ramp.upX,
      upZ: ramp.upZ,
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

  it('climbs the deck ramp and draws blood on a player up there', () => {
    // Player on the north deck, grunt on the floor south of it. The deck and
    // its ramp come from the rolled home tables (decks[0] is always N).
    const north = HOME.tables.decks[0];
    if (!north) throw new Error('north deck missing');
    const { deck } = north;
    const world = arenaWorld({ x: deck.x, z: deck.z });
    world.playerY = PLATFORM_H;
    const e = spawn('grunt', deck.x, deck.z + 21);

    let peak = 0;
    for (let i = 0; i < 60 * 20; i++) {
      e.update(1 / 60, world);
      peak = Math.max(peak, e.pos.y);
    }

    // It takes the slope — lines up at the mouth, then rides it to the deck...
    expect(peak).toBeGreaterThanOrEqual(PLATFORM_H - 0.1);
    expect(e.pos.y).toBeGreaterThanOrEqual(PLATFORM_H - 0.1);
    // ...closes to melee once at deck level...
    const dist = Math.hypot(world.playerPos.x - e.pos.x, world.playerPos.z - e.pos.z);
    expect(dist).toBeLessThan(3);
    // ...and the swing lands.
    expect(world.hurt).toBeGreaterThan(0);
  });

  it('the warden besieges a deck without climbing — the rockets do the climbing', () => {
    const north = HOME.tables.decks[0];
    if (!north) throw new Error('north deck missing');
    const { deck, ramp } = north;
    const world = arenaWorld({ x: deck.x, z: deck.z });
    world.playerY = PLATFORM_H;
    const boss = spawn('warden', deck.x, deck.z + 21);

    let peak = 0;
    for (let i = 0; i < 60 * 8; i++) {
      boss.update(1 / 60, world);
      peak = Math.max(peak, boss.pos.y);
    }

    // It refuses to close: it parks at the bottom of the slope, never on it.
    expect(peak).toBeLessThan(0.2);
    expect(boss.pos.y).toBeLessThan(0.2);
    const mouthZ = ramp.z - ramp.upZ * ENEMY.RAMP_OFFSET; // the toe pushed downhill
    expect(Math.hypot(boss.pos.x - deck.x, boss.pos.z - mouthZ)).toBeLessThan(5);
    // ...while the volley clock keeps running on schedule.
    expect(world.bombs).toHaveLength(BOSS.VOLLEY_ROCKETS);
    for (const bomb of world.bombs) expect(bomb.variant).toBe('rocket');
  });

  it('falls back to the floor when it walks off a platform', () => {
    // Chase east off the deck's bare east face (the ramp is on the south side).
    const north = HOME.tables.decks[0];
    if (!north) throw new Error('north deck missing');
    const { deck } = north;
    const world = arenaWorld({ x: 60, z: deck.z });
    const e = spawn('grunt', deck.x, deck.z);
    e.pos.y = PLATFORM_H;
    e.grounded = true;
    world.playerY = 0;

    for (let i = 0; i < 60 * 4; i++) e.update(1 / 60, world);
    expect(e.pos.x).toBeGreaterThan(deck.x + 3.5);
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

describe('Creeper', () => {
  it('starts the fuse inside trigger range, and only there', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const close = spawn('creeper', 0, 2);
    close.update(1 / 60, world);
    expect(close.fuse).toBeLessThan(CREEPER.FUSE);

    const far = spawn('creeper', 0, 9);
    for (let i = 0; i < 60; i++) far.update(1 / 60, world);
    expect(far.fuse).toBe(CREEPER.FUSE);
    expect(world.bombs).toHaveLength(0);
  });

  it('recovers the fuse when the player backs off', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('creeper', 0, 9);
    e.fuse = 0.3;
    for (let i = 0; i < 60; i++) e.update(1 / 60, world);
    expect(e.fuse).toBeGreaterThan(0.3);
    expect(e.fuse).toBeLessThanOrEqual(CREEPER.FUSE);
    expect(world.bombs).toHaveLength(0);
  });

  it('never blows up while besieging a deck', () => {
    const world = makeWorld({ x: 0, z: 0 });
    world.playerY = PLATFORM_H; // within trigger distance but far above it
    const e = spawn('creeper', 0, 3);
    for (let i = 0; i < Math.ceil(CREEPER.FUSE * 60) + 30; i++) e.update(1 / 60, world);
    expect(world.bombs).toHaveLength(0);
    expect(e.state).toBe('alive');
  });

  it('detonates at its own feet and takes itself with it', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('creeper', 0, 2);
    for (let i = 0; i < Math.ceil(CREEPER.FUSE * 60) + 30 && world.bombs.length === 0; i++) {
      e.update(1 / 60, world);
    }
    expect(world.bombs).toHaveLength(1);
    expect(world.bombs[0]?.thrown).toBe(false);
    expect(world.bombs[0]?.variant).toBe('blast');
    expect(world.bombs[0]?.to.x).toBeCloseTo(e.pos.x, 6);
    expect(e.state).toBe('dying'); // no credits: it killed itself, not the player
    expect(world.hurt).toBe(0); // the blast is Game's to apply
  });

  it('plants nothing when killed mid-fuse', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('creeper', 0, 2);
    e.update(1 / 60, world);
    expect(e.fuse).toBeLessThan(CREEPER.FUSE);
    e.takeDamage(1000);
    e.kill();
    for (let i = 0; i < Math.ceil(CREEPER.FUSE * 60) + 60; i++) e.update(1 / 60, world);
    expect(world.bombs).toHaveLength(0);
  });

  it('lights its face just before detonation', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('creeper', 0, 2);
    e.fuse = CREEPER.TELL - 0.3;
    e.update(1 / 60, world);
    expect(e.fuseK).toBeGreaterThan(0);
    expect(e.fuseK).toBeLessThanOrEqual(1);
  });
});

describe('Witch', () => {
  it('throws a potion at the player on its throw clock', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('witch', 0, 20);
    e.plantT = 0.05;
    for (let i = 0; i < 60; i++) e.update(1 / 60, world);
    expect(world.bombs).toHaveLength(1);
    expect(world.bombs[0]?.thrown).toBe(true);
    expect(world.bombs[0]?.variant).toBe('potion');
    expect(world.bombs[0]?.to).toEqual({ x: 0, z: 0 });
  });

  it('lobs the potion onto the deck when the player is up on one', () => {
    const world = makeWorld({ x: 0, z: 0 });
    world.playerY = PLATFORM_H;
    const e = spawn('witch', 0, 5);
    e.plantT = 0.05;
    for (let i = 0; i < 60; i++) e.update(1 / 60, world);
    expect(world.bombs[0]?.thrown).toBe(true);
    expect(world.bombs[0]?.to).toEqual({ x: 0, z: 0 });
  });

  it('backs off when the player closes in', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('witch', 0, 10);
    for (let i = 0; i < 60; i++) e.update(1 / 60, world);
    expect(Math.hypot(e.pos.x, e.pos.z)).toBeGreaterThan(10);
    expect(world.hurt).toBe(0);
  });

  it('heals the most wounded ally in range', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('witch', 0, 10);
    const hurt = spawn('grunt', 0, 12);
    hurt.takeDamage(30);
    const healthy = spawn('grunt', 0, 14);
    world.foes = [e, hurt, healthy];
    e.healT = 0.01;
    e.update(1 / 60, world);
    expect(hurt.hp).toBe(ENEMY_TYPES.grunt.hp - 30 + WITCH.HEAL);
    expect(hurt.flashT).toBeGreaterThan(0); // the heal flash marks the target
    expect(healthy.hp).toBe(ENEMY_TYPES.grunt.hp);
  });

  it('never overheals and ignores a herd of full-health allies', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('witch', 0, 10);
    const scraped = spawn('grunt', 0, 12);
    scraped.takeDamage(5);
    const healthy = spawn('grunt', 0, 14);
    world.foes = [e, scraped, healthy];
    e.healT = 0.01;
    e.update(1 / 60, world);
    expect(scraped.hp).toBe(ENEMY_TYPES.grunt.hp); // clamped at max
    expect(healthy.flashT).toBe(0);
  });

  it('lights the vial just before a throw', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('witch', 0, 20);
    e.plantT = WITCH.TELL - 0.3;
    e.update(1 / 60, world);
    expect(e.potionK).toBeGreaterThan(0);
    expect(e.potionK).toBeLessThanOrEqual(1);
  });
});

describe('Blinker', () => {
  /** Walk one blinker through a full blink with the tell already running. */
  function blinkFrom(x: number, z: number, playerY = 0): { e: Enemy; world: ReturnType<typeof makeWorld> } {
    const world = makeWorld({ x: 0, z: 0 });
    world.playerY = playerY;
    const e = spawn('blinker', x, z);
    e.blinkTell = 0.01;
    e.update(1 / 60, world);
    return { e, world };
  }

  it('blinks onto a ring around the player and resets its clock', () => {
    const { e } = blinkFrom(0, 20);
    const d = Math.hypot(e.pos.x, e.pos.z);
    expect(d).toBeGreaterThanOrEqual(BLINKER.LAND_MIN - 0.5);
    expect(d).toBeLessThanOrEqual(BLINKER.LAND_MAX + 0.5);
    expect(e.blinkT).toBe(BLINKER.BLINK_T);
    expect(e.blinkTell).toBeLessThanOrEqual(0);
  });

  it("lands at the player's feet height — a deck is no shelter", () => {
    const { e } = blinkFrom(0, 20, PLATFORM_H);
    // It starts falling the next tick; the same-tick height is what proves the rule.
    expect(e.pos.y).toBeGreaterThan(1.5);
  });

  it('never bothers blinking from close range', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('blinker', 0, 5);
    for (let i = 0; i < 180; i++) e.update(1 / 60, world);
    expect(e.blinkTell).toBeLessThanOrEqual(0);
    expect(Math.hypot(e.pos.x, e.pos.z)).toBeLessThan(BLINKER.BLINK_MIN);
  });

  it('glows just before it teleports', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('blinker', 0, 20);
    e.blinkT = 0; // cooldown already expired
    e.update(1 / 60, world); // arms the tell
    expect(e.blinkTell).toBe(BLINKER.TELL);
    e.update(1 / 60, world);
    expect(e.blinkK).toBeGreaterThan(0);
    expect(e.blinkK).toBeLessThan(1);
  });
});

describe('Colossus', () => {
  it('charges from mid range after a glowing tell, then recovers wide open', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('colossus', 0, 15);
    e.update(1 / 60, world); // dist 15 sits inside the charge band
    expect(e.pounceTell).toBe(COLOSSUS.CHARGE_TELL);
    for (let i = 0; i < Math.ceil(COLOSSUS.CHARGE_TELL * 60); i++) e.update(1 / 60, world);
    expect(e.pounce).toBeGreaterThan(0); // the rush is on

    const z0 = e.pos.z;
    for (let i = 0; i < Math.ceil(COLOSSUS.CHARGE_T * 60); i++) e.update(1 / 60, world);
    // Faster than its walk — the burst is the point.
    expect(Math.abs(z0 - e.pos.z)).toBeGreaterThan(3);

    for (let i = 0; i < Math.ceil(COLOSSUS.RECOVER_T * 60); i++) e.update(1 / 60, world);
    expect(e.recover).toBe(0);
    expect(e.pounceCd).toBeGreaterThan(0); // and it will not charge again yet
  });

  it('never bothers charging from close range', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('colossus', 0, 4);
    for (let i = 0; i < 240; i++) e.update(1 / 60, world);
    expect(e.pounceTell).toBeLessThanOrEqual(0);
    expect(e.pounce).toBeLessThanOrEqual(0);
  });

  it('slams with a quake that hits harder and shoves', () => {
    const world = makeWorld({ x: 0, z: 0 });
    const e = spawn('colossus', 0, 3); // inside SLAM_R, on the level
    // The spawn cooldown (up to 1s) runs before the windup starts.
    const steps = Math.ceil((1 + COLOSSUS.WINDUP) * 60) + 2;
    for (let i = 0; i < steps; i++) e.update(1 / 60, world);
    expect(world.hurt).toBeCloseTo(ENEMY_TYPES.colossus.dmg * COLOSSUS.SLAM_MULT, 5);
    expect(world.knock).toHaveLength(1);
    expect(world.knock[0]?.force).toBe(COLOSSUS.KNOCK);
  });

  it('wears front armour like the tank — flanking is the answer', () => {
    const e = spawn('colossus', 0, 0);
    // Shooter dead ahead (+z): the plate covers it.
    expect(e.takeDamage(100, { dirX: 0, dirZ: 1, headshot: false, melee: false })).toBe(false);
    expect(e.hp).toBeCloseTo(ENEMY_TYPES.colossus.hp - 100 * (1 - TANK.ARMOUR_CUT), 6);
    // Behind: full damage.
    expect(e.takeDamage(100, { dirX: 0, dirZ: -1, headshot: false, melee: false })).toBe(false);
    expect(e.hp).toBeCloseTo(ENEMY_TYPES.colossus.hp - 100 * (1 - TANK.ARMOUR_CUT) - 100, 6);
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
