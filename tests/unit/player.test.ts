import { describe, expect, it } from 'vitest';
import { WORLD } from '../../src/game/config';
import { type MoveInput, Player } from '../../src/game/player';
import { CollisionWorld } from '../../src/game/world/collision';

const IDLE: MoveInput = { forward: 0, right: 0, sprint: false };

/** Run `steps` fixed ticks with one input, then hand back the player. */
function run(p: Player, c: CollisionWorld, input: MoveInput, steps: number, dt = 1 / 60) {
  for (let i = 0; i < steps; i++) p.update(dt, input, c);
}

describe('Player movement', () => {
  it('falls to the floor and stays there', () => {
    const p = new Player();
    const c = new CollisionWorld();
    p.update(1 / 60, IDLE, c);
    expect(p.position.y).toBeCloseTo(WORLD.PLAYER_H, 6);
    expect(p.grounded).toBe(true);
    run(p, c, IDLE, 120);
    expect(p.position.y).toBeCloseTo(WORLD.PLAYER_H, 6);
  });

  it('accelerates toward walk speed and decelerates back to zero', () => {
    const p = new Player();
    const c = new CollisionWorld();
    run(p, c, { forward: 1, right: 0, sprint: false }, 60);
    expect(Math.hypot(p.velocity.x, p.velocity.z)).toBeGreaterThan(WORLD.WALK * 0.95);
    expect(p.moving).toBe(true);
    run(p, c, IDLE, 60);
    expect(Math.hypot(p.velocity.x, p.velocity.z)).toBeLessThan(0.5);
    expect(p.moving).toBe(false);
  });

  it('normalises diagonal input so strafing is not faster', () => {
    const c = new CollisionWorld();
    const straight = new Player();
    run(straight, c, { forward: 1, right: 0, sprint: false }, 60);
    const diagonal = new Player();
    run(diagonal, c, { forward: 1, right: 1, sprint: false }, 60);
    expect(Math.hypot(diagonal.velocity.x, diagonal.velocity.z)).toBeCloseTo(
      Math.hypot(straight.velocity.x, straight.velocity.z),
      6,
    );
  });

  it('sprints faster than it walks', () => {
    const c = new CollisionWorld();
    const walk = new Player();
    run(walk, c, { forward: 1, right: 0, sprint: false }, 60);
    const sprint = new Player();
    run(sprint, c, { forward: 1, right: 0, sprint: true }, 60);
    expect(sprint.velocity.z).toBeLessThan(walk.velocity.z);
    expect(Math.abs(sprint.velocity.z)).toBeGreaterThan(WORLD.SPRINT * 0.9);
  });

  it('coasts to a stop when the key is released', () => {
    const p = new Player();
    const c = new CollisionWorld();
    run(p, c, { forward: 1, right: 0, sprint: false }, 60);
    const z0 = p.position.z;
    run(p, c, IDLE, 120);
    expect(p.position.z).toBeLessThan(z0); // kept sliding briefly, then stopped
    expect(Math.hypot(p.velocity.x, p.velocity.z)).toBeLessThan(0.5);
  });

  it('jumps only from the ground and lands again', () => {
    const p = new Player();
    const c = new CollisionWorld();
    p.queueJump();
    p.update(1 / 60, IDLE, c);
    expect(p.grounded).toBe(false);
    expect(p.velocity.y).toBeCloseTo(WORLD.JUMP_V - WORLD.GRAVITY / 60, 6);
    expect(p.position.y).toBeGreaterThan(WORLD.PLAYER_H);

    // A second jump mid-air must not fire.
    p.queueJump();
    const vy = p.velocity.y;
    p.update(1 / 60, IDLE, c);
    expect(p.velocity.y).toBeLessThan(vy);

    let peak = 0;
    for (let i = 0; i < 120; i++) {
      p.update(1 / 60, IDLE, c);
      peak = Math.max(peak, p.position.y);
    }
    expect(peak).toBeGreaterThan(WORLD.PLAYER_H + 1);
    expect(p.position.y).toBeCloseTo(WORLD.PLAYER_H, 6);
    expect(p.grounded).toBe(true);
  });

  it('never tunnels through a wall at full sprint', () => {
    const p = new Player();
    const c = new CollisionWorld();
    c.addObstacle({ minX: -5, maxX: 5, minZ: -5, maxZ: -3 });
    p.position.z = 10;
    p.position.y = WORLD.PLAYER_H;
    run(p, c, { forward: 1, right: 0, sprint: true }, 240);
    expect(p.position.z).toBeGreaterThan(-5 + WORLD.PLAYER_R - 1e-6);
  });

  it('clamps pitch and turns with yaw', () => {
    const p = new Player();
    p.look(0, -1e6);
    expect(p.pitch).toBeCloseTo(WORLD.PITCH_LIMIT, 6);
    p.look(0, 1e6);
    expect(p.pitch).toBeCloseTo(-WORLD.PITCH_LIMIT, 6);
    const yaw0 = p.yaw;
    p.look(100, 0);
    expect(p.yaw).toBeCloseTo(yaw0 - 100 * 0.0023, 6);
  });

  it('accumulates bob only while moving', () => {
    const c = new CollisionWorld();
    const p = new Player();
    run(p, c, IDLE, 60);
    expect(p.bobPhase).toBe(0);
    run(p, c, { forward: 1, right: 0, sprint: false }, 60);
    expect(p.bobPhase).toBeGreaterThan(1);
  });

  it('steps up onto a low lip and stands on it', () => {
    const p = new Player();
    const c = new CollisionWorld();
    c.addObstacle({ minX: -2, maxX: 2, minZ: -2, maxZ: 2 }, 0.4);
    run(p, c, IDLE, 5);
    expect(p.position.y).toBeCloseTo(WORLD.PLAYER_H + 0.4, 6);
    expect(p.grounded).toBe(true);
  });

  it('walks up a ramp onto the platform it serves', () => {
    const p = new Player();
    const c = new CollisionWorld();
    // Toe at x=-2 rising east to 1.6 at x=2, where the deck starts.
    c.addRamp({ minX: -2, maxX: 2, minZ: -1.5, maxZ: 1.5, lowY: 0, highY: 1.6, upX: 1, upZ: 0 });
    c.addObstacle({ minX: 2, maxX: 20, minZ: -3, maxZ: 3 }, 1.6);

    p.position.x = -3;
    p.position.y = WORLD.PLAYER_H;
    p.yaw = -Math.PI / 2; // forward points at +x
    run(p, c, { forward: 1, right: 0, sprint: false }, 120);

    expect(p.position.x).toBeGreaterThan(2);
    expect(p.position.y).toBeCloseTo(WORLD.PLAYER_H + 1.6, 2);
    expect(p.grounded).toBe(true);
  });

  it('cannot climb a platform from the ground — only the ramp gets you up', () => {
    const p = new Player();
    const c = new CollisionWorld();
    c.addObstacle({ minX: -2, maxX: 2, minZ: -2, maxZ: 2 }, 1.6);

    p.position.x = 4;
    p.position.y = WORLD.PLAYER_H;
    p.yaw = Math.PI / 2; // forward points at -x, into the platform's face
    run(p, c, { forward: 1, right: 0, sprint: false }, 120);

    expect(p.position.y).toBeCloseTo(WORLD.PLAYER_H, 6);
    expect(p.position.x).toBeCloseTo(2 + WORLD.PLAYER_R, 3);
  });

  it('lands on a platform when dropped onto it', () => {
    const p = new Player();
    const c = new CollisionWorld();
    c.addObstacle({ minX: -2, maxX: 2, minZ: -2, maxZ: 2 }, 1);
    p.position.y = WORLD.PLAYER_H + 2;
    p.velocity.y = 0;
    p.grounded = false;
    run(p, c, IDLE, 60);
    expect(p.position.y).toBeCloseTo(WORLD.PLAYER_H + 1, 6);
    expect(p.grounded).toBe(true);
  });

  it('walks off a platform edge and falls back to the floor', () => {
    const p = new Player();
    const c = new CollisionWorld();
    c.addObstacle({ minX: -2, maxX: 2, minZ: -2, maxZ: 2 }, 1);
    p.position.y = WORLD.PLAYER_H + 1;
    p.grounded = true;
    p.yaw = Math.PI; // forward points toward +z, off the platform
    run(p, c, { forward: 1, right: 0, sprint: false }, 240);
    expect(p.position.y).toBeCloseTo(WORLD.PLAYER_H, 6);
    expect(p.position.z).toBeGreaterThan(2);
  });

  it('reset puts the player back on the spawn point', () => {
    const p = new Player();
    const c = new CollisionWorld();
    run(p, c, { forward: 1, right: 1, sprint: true }, 120);
    p.look(50, 20);
    p.reset();
    expect(p.position).toEqual({ x: 0, y: WORLD.PLAYER_H, z: 0 });
    expect(p.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(p.yaw).toBe(0);
    expect(p.pitch).toBe(0);
    expect(p.grounded).toBe(true);
  });

  it('orbits the camera for the attract screen', () => {
    const p = new Player();
    const a = p.menuPose(0);
    const b = p.menuPose(10);
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(19, 6);
    expect(a).not.toEqual(b);
  });
});

describe('Player stamina', () => {
  it('drains while sprinting and regenerates while idle', () => {
    const p = new Player();
    const c = new CollisionWorld();
    run(p, c, { forward: 1, right: 0, sprint: true }, 120);
    const drained = p.stamina;
    expect(drained).toBeLessThan(WORLD.STAMINA_MAX);
    run(p, c, IDLE, 120);
    expect(p.stamina).toBeGreaterThan(drained);
  });

  it('locks sprint out once the bar empties', () => {
    const p = new Player();
    const c = new CollisionWorld();
    p.stamina = 0;
    run(p, c, { forward: 1, right: 0, sprint: true }, 30);
    expect(p.stamina).toBeGreaterThan(0);
    expect(Math.hypot(p.velocity.x, p.velocity.z)).toBeLessThan(WORLD.SPRINT * 0.9);
  });
});
