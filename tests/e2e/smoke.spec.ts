import { expect, type Page, test } from '@playwright/test';

/**
 * Headless smoke test.
 *
 * Boots the production build, plays it through `window.__NEON` and asserts the
 * things a broken module boundary or a leaked GPU resource would show up as.
 * The waits are condition-based because software rendering runs the simulation
 * slower than wall clock.
 */

interface Stats {
  state: string;
  hp: number;
  ammo: number;
  score: number;
  kills: number;
  wave: number;
  hostiles: number;
}
interface EnemyPos {
  x: number;
  z: number;
  state: string;
  hp: number;
  kind: string;
  mode: string;
}
interface CamState {
  px: number;
  py: number;
  pz: number;
  yaw: number;
  pitch: number;
  yawObjY: number;
}
interface RenderInfo {
  calls: number;
  geometries: number;
  textures: number;
  programs: number;
}
interface CrosshairSettings {
  shape: string;
  lines: boolean;
  lineLen: number;
  color: string;
}
interface XpStats {
  level: number;
  xp: number;
  need: number;
}
interface SettingsBundle {
  crosshair: { shape: string; lines: boolean; lineLen: number; color: string };
  game: { sensitivity: number; invertY: boolean; fov: number; mute: boolean };
  video: { quality: number; shadows: boolean; fog: boolean };
}
interface MeteorStats {
  phase: string;
  tint: number;
  stones: number;
}

const stats = (page: Page) => page.evaluate(() => window.__NEON.stats() as Stats);
const enemies = (page: Page) => page.evaluate(() => window.__NEON.enemyPos() as EnemyPos[]);
const cam = (page: Page) => page.evaluate(() => window.__NEON.camState() as CamState);
const renderInfo = (page: Page) => page.evaluate(() => window.__NEON.renderInfo() as RenderInfo);
const setCrosshair = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate((p) => window.__NEON.setCrosshair(p) as CrosshairSettings, patch);
const crosshair = (page: Page) => page.evaluate(() => window.__NEON.crosshair() as CrosshairSettings);
const xpStats = (page: Page) => page.evaluate(() => window.__NEON.xpStats() as XpStats);
const meteor = (page: Page) => page.evaluate(() => window.__NEON.meteor() as MeteorStats);

/**
 * Point the camera at the nearest enemy's torso. The camera's forward vector is
 * (-sin yaw, *, -cos yaw), which this inverts into an aim angle.
 */
const aimAtNearestEnemy = () => {
  const N = window.__NEON;
  const list = N.enemyPos() as EnemyPos[];
  const c = N.camState() as CamState;
  let best: EnemyPos | null = null;
  let bestD = Infinity;
  for (const e of list) {
    const d = Math.hypot(e.x - c.px, e.z - c.pz);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) return false;
  N.aim(Math.atan2(-(best.x - c.px), -(best.z - c.pz)), Math.atan2(1 - c.py, bestD));
  return true;
};

/**
 * Spin the view all the way round. Static geometry uploads to the GPU on its
 * first draw, and an 84-unit maze has far more of it than one screenful — so
 * without a sweep "stable geometry count" just means "everything I happened to
 * look at so far", and the next kill that turns the camera reads as a leak.
 */
async function sweep(page: Page): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await page.evaluate((yaw) => window.__NEON.aim(yaw, -0.05), (i * Math.PI) / 4);
    await page.waitForTimeout(140);
  }
}

/**
 * Wait until the renderer's geometry count stops growing. Geometries reach the
 * GPU lazily on first use, so measuring a leak before that settles is noise.
 */
async function warmUp(page: Page, budgetMs = 45_000): Promise<void> {
  await sweep(page);
  let stable = 0;
  let previous = -1;
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const current = (await renderInfo(page)).geometries;
    stable = current === previous ? stable + 1 : 0;
    previous = current;
    if (stable >= 4) return;
    await page.waitForTimeout(500);
  }
}

/**
 * Hold the trigger until the kill counter reaches `target`. Enemies are parked
 * at long range first so they cannot close and kill the player mid-run.
 */
async function killEnemies(page: Page, target: number, budgetMs: number): Promise<number> {
  await page.mouse.down();
  const deadline = Date.now() + budgetMs;
  try {
    while (Date.now() < deadline) {
      const kills = (await stats(page)).kills;
      if (kills >= target) return kills;
      await page.evaluate(() => {
        // Face south from the spawn plaza: a clear lane, whatever the maze does
        // between the player and the ring.
        window.__NEON.aim(Math.PI, 0);
        window.__NEON.faceEnemies(10, 1.0);
        // This phase measures GPU resources over minutes of shooting; keep the
        // player alive rather than turning it into a survival test.
        const s = window.__NEON.stats() as Stats;
        if (s.hp < 60) window.__NEON.hurt(-40);
      });
      await page.evaluate(aimAtNearestEnemy);
      await page
        .waitForFunction((k) => (window.__NEON.stats() as Stats).kills > k, kills, { timeout: 2500 })
        .catch(() => {});
    }
    return (await stats(page)).kills;
  } finally {
    await page.mouse.up();
  }
}

test('boots, plays and cleans up after itself', async ({ page }) => {
  // Software rendering and 20-odd kills take a while; the default 60s is not enough.
  test.setTimeout(900_000);

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto('/?test', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__NEON !== undefined, undefined, { timeout: 20_000 });

  expect(pageErrors, pageErrors.slice(0, 3).join('; ')).toEqual([]);
  expect(consoleErrors, consoleErrors.slice(0, 3).join('; ')).toEqual([]);

  // --- boot -----------------------------------------------------------------
  await page.waitForTimeout(2500); // let the first wave spawn
  const boot = await stats(page);
  expect(boot.state).toBe('playing');
  expect(boot.wave).toBe(1);
  expect(boot.hp).toBe(100);
  expect(boot.ammo).toBe(12);
  expect(boot.hostiles).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__NEON.gunVisible())).toBe(true);

  const alive = await enemies(page);
  expect(alive.length).toBeGreaterThan(0);
  expect(alive.every((e) => e.state === 'alive')).toBe(true);

  // --- look -----------------------------------------------------------------
  await page.evaluate(() => window.__NEON.aim(0.5, -0.2));
  await page.waitForTimeout(120);
  const looked = await cam(page);
  expect(looked.yaw).toBeCloseTo(0.5, 2);
  expect(looked.pitch).toBeCloseTo(-0.2, 2);
  expect(looked.yawObjY).toBeCloseTo(0.5, 2);

  // --- shoot ----------------------------------------------------------------
  // Let the wave finish spawning first: HP totals are only comparable between
  // two snapshots if the population did not change in between.
  await page.waitForFunction(
    () => {
      const s = window.__NEON.stats() as Stats;
      const alive = (window.__NEON.enemyPos() as EnemyPos[]).length;
      return alive > 0 && s.hostiles === alive;
    },
    undefined,
    { timeout: 90_000 },
  );
  await page.evaluate(() => {
    // A maze map means a ring teleport can hide every target behind cover; line
    // them up down the open plaza instead.
    window.__NEON.aim(Math.PI, 0);
    window.__NEON.faceEnemies(8, 1.0);
  });
  await page.evaluate(aimAtNearestEnemy);
  const before = (await enemies(page)).map((e) => e.hp);
  await page.mouse.down();
  await page.waitForFunction(
    () => {
      const list = window.__NEON.enemyPos() as EnemyPos[];
      const s = window.__NEON.stats() as Stats;
      return list.some((e) => e.hp < 60) || s.ammo < 8;
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.mouse.up();

  const after = (await enemies(page)).map((e) => e.hp);
  expect(after.reduce((a, b) => a + b, 0)).toBeLessThan(before.reduce((a, b) => a + b, 0));
  expect((await stats(page)).ammo).toBeLessThan(12);

  // --- reload ---------------------------------------------------------------
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => (window.__NEON.stats() as Stats).ammo === 12, undefined, {
    timeout: 30_000,
  });

  // --- keyboard fire --------------------------------------------------------
  // Touchpad players hold WASD with one hand and cannot also press the pad
  // down, so the gun needs a keyboard trigger. The magazine is full here, so
  // any shot shows up as a lower ammo count.
  await page.keyboard.down('f');
  await page.waitForFunction(() => (window.__NEON.stats() as Stats).ammo < 12, undefined, {
    timeout: 30_000,
  });
  await page.keyboard.up('f');

  // The suite stands still for minutes at a time while mobs grind on the
  // player, and a death freezes the simulation — which then fails the checks
  // that follow for reasons that have nothing to do with them. So the run is
  // given a health pool big enough to sit out the whole suite.
  await page.evaluate(() => window.__NEON.hurt(-20000));

  // --- GPU resources converge instead of growing forever ---------------------
  const warm = await killEnemies(page, 4, 120_000);
  await warmUp(page);
  const first = await renderInfo(page);

  const mid = await killEnemies(page, warm + 8, 180_000);
  await warmUp(page);
  const second = await renderInfo(page);

  const end = await killEnemies(page, mid + 8, 180_000);
  await warmUp(page);
  const third = await renderInfo(page);

  // Before the rewrite every enemy leaked two health-bar geometries.
  expect(
    third.geometries - second.geometries,
    `geometries ${first.geometries} -> ${second.geometries} -> ${third.geometries} over ${end - mid} kills`,
  ).toBe(0);
  expect(third.textures - second.textures, `textures ${second.textures} -> ${third.textures}`).toBe(0);

  // --- damage and death -----------------------------------------------------
  // Park the mobs first: this check is about the damage path, not about
  // surviving the kill phase, and a stray melee in the sample window would
  // skew the delta.
  await page.evaluate(() => window.__NEON.teleportEnemies(26));
  await page.waitForTimeout(200);
  const hpBeforeHit = (await stats(page)).hp;
  await page.evaluate(() => window.__NEON.hurt(30));
  await page.waitForTimeout(150);
  expect((await stats(page)).hp).toBeCloseTo(hpBeforeHit - 30, 3);

  // Clicks inside the open settings panel must not re-lock the pointer: that
  // resumes the game underneath the panel and swallows the cursor, which is
  // what made the panel look unclickable.
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(200);
  await page.locator('#presetList .preset').nth(2).click(); // CIRCLE
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  expect(
    await page.evaluate(() => document.getElementById('settingsScreen')?.classList.contains('visible')),
  ).toBe(true);
  // Opening the panel mid-game releases pointer lock, which pauses — and it must
  // stay paused: re-locking here is what made the panel look unclickable.
  expect((await stats(page)).state).toBe('paused');
  // The viewmodel must survive the pause, not just the resume.
  expect(await page.evaluate(() => window.__NEON.gunVisible())).toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect((await crosshair(page)).shape).toBe('circle'); // the preset click landed

  // Resume the way a player does — a bare click re-acquires the pointer lock.
  await page.mouse.click(640, 360);
  await page.waitForTimeout(300);
  expect((await stats(page)).state).toBe('playing');
  expect(await page.evaluate(() => window.__NEON.gunVisible())).toBe(true);

  // --- minimap ---------------------------------------------------------------
  // A canvas that is wired up but never painted is the failure this catches.
  const minimapLit = await page.evaluate(() => {
    const c = document.getElementById('minimap') as HTMLCanvasElement | null;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return -1;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if ((d[i] ?? 0) > 8) lit++;
    return lit;
  });
  expect(minimapLit).toBeGreaterThan(500);

  // --- the tactical map (M and Tab both open it) ----------------------------
  // A canvas that is wired up but never painted is the failure this catches.
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.getElementById('mapScreen')?.classList.contains('visible'))).toBe(
    true,
  );
  expect((await stats(page)).state).toBe('paused');
  const mapLit = await page.evaluate(() => {
    const c = document.getElementById('mapCanvas') as HTMLCanvasElement | null;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return -1;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if ((d[i] ?? 0) > 8) lit++;
    return lit;
  });
  expect(mapLit).toBeGreaterThan(500);

  // Tab is the second binding for the same screen.
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.getElementById('mapScreen')?.classList.contains('visible'))).toBe(
    false,
  );
  expect((await stats(page)).state).toBe('playing');

  // Headroom: the bomb checks below stand still on purpose.
  await page.evaluate(() => window.__NEON.hurt(-50));

  // --- the bomb warns, and can be shot out of the air -------------------------
  const spot = await cam(page);
  await page.evaluate((p) => window.__NEON.spawnBomb(p.x + 2, p.z), { x: spot.px, z: spot.pz });
  await page.waitForFunction(() => (window.__NEON.bombs() as number[]).length === 1, undefined, {
    timeout: 5000,
  });
  // A warning while the fuse burns: a silent bomb would be a cheap death.
  await page.waitForFunction(
    () => document.getElementById('bombWarn')?.classList.contains('on') === true,
    undefined,
    { timeout: 5000 },
  );
  expect(await page.evaluate(() => document.getElementById('bombWarn')?.classList.contains('on'))).toBe(true);

  await page.evaluate(() => window.__NEON.teleportEnemies(24)); // clear the firing line
  const scoreBeforeShot = (await stats(page)).score;
  await page.evaluate(
    (p) => {
      const c = window.__NEON.camState() as CamState;
      const d = Math.hypot(p.x - c.px, p.z - c.pz);
      window.__NEON.aim(Math.atan2(-(p.x - c.px), -(p.z - c.pz)), Math.atan2(0.35 - c.py, d));
    },
    { x: spot.px + 2, z: spot.pz },
  );
  await page.mouse.down();
  await page.waitForFunction(() => (window.__NEON.bombs() as number[]).length === 0, undefined, {
    timeout: 20_000,
  });
  await page.mouse.up();
  expect((await stats(page)).score).toBeGreaterThan(scoreBeforeShot);

  // --- left alone, the fuse runs out and the blast reaches the player ---------
  const hpBeforeFuse = (await stats(page)).hp;
  const spot2 = await cam(page);
  await page.evaluate((p) => window.__NEON.spawnBomb(p.x + 2, p.z), { x: spot2.px, z: spot2.pz });
  await page.waitForFunction(
    (hp) => (window.__NEON.bombs() as number[]).length === 0 && (window.__NEON.stats() as Stats).hp < hp,
    hpBeforeFuse,
    { timeout: 20_000 },
  );
  expect((await stats(page)).hp).toBeLessThan(hpBeforeFuse);
  expect(await page.evaluate(() => document.getElementById('bombWarn')?.classList.contains('on'))).toBe(
    false,
  );

  // --- xp: orbs are xp, and a level up pays a repair --------------------------
  const xpStart = await xpStats(page);
  expect(xpStart.level).toBe(1);
  expect(xpStart.need).toBe(60);
  // The orbs drop where the mobs die and the player never walks over them in
  // this run, so bank the xp directly and check the bar and the level.
  await page.evaluate(() => window.__NEON.grantXp(30));
  await page.waitForTimeout(250);
  const xpHalf = await xpStats(page);
  expect(xpHalf.xp).toBe(30);
  const fillWidth = await page.evaluate(
    () => (document.getElementById('xpFill') as HTMLElement).getBoundingClientRect().width,
  );
  expect(fillWidth).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.getElementById('xpLabel')?.textContent)).toBe('LV 1');

  // A level up pays out over time like a capture, so the player needs room for
  // the repair to show.
  await page.evaluate(() => {
    const s = window.__NEON.stats() as Stats;
    // `hurt` takes a damage amount, so this is the delta that lands on 60.
    window.__NEON.hurt(s.hp - 60);
  });
  await page.waitForTimeout(150);
  expect((await stats(page)).hp).toBeCloseTo(60, 3);
  await page.evaluate(() => window.__NEON.grantXp(30)); // crosses the threshold
  await page.waitForFunction(() => (window.__NEON.stats() as Stats).hp > 60, undefined, { timeout: 20_000 });
  expect((await xpStats(page)).level).toBe(2);
  expect(await page.evaluate(() => document.getElementById('xpLabel')?.textContent)).toBe('LV 2');

  // --- the meteor shower: a red sky and stones to dodge ------------------------
  // Headroom first: the level up above paid out a repair and capped the run
  // back to full, so the pool is refilled before the long wait below.
  await page.evaluate(() => window.__NEON.hurt(-20000));
  await page.evaluate(() => window.__NEON.teleportEnemies(30));
  expect((await stats(page)).state).toBe('playing');
  await page.evaluate(() => window.__NEON.forceMeteor());
  await page.waitForFunction(() => (window.__NEON.meteor() as MeteorStats).tint > 0, undefined, {
    timeout: 30_000,
  });
  const storm = await meteor(page);
  expect(['warning', 'active']).toContain(storm.phase);
  expect(storm.tint).toBeGreaterThan(0);

  // A stone on the player's head hurts.
  const hpBeforeStone = (await stats(page)).hp;
  const here = await cam(page);
  await page.evaluate((pos) => window.__NEON.dropStone(pos.px, pos.pz), here);
  await page.waitForFunction((hp) => (window.__NEON.stats() as Stats).hp < hp, hpBeforeStone, {
    timeout: 30_000,
  });
  expect((await stats(page)).hp).toBeLessThan(hpBeforeStone);

  // The sky goes back to normal when the shower ends.
  await page.waitForFunction(() => (window.__NEON.meteor() as MeteorStats).tint === 0, undefined, {
    timeout: 180_000,
  });
  // A dead player stops the simulation, so a shower that never faded means the
  // run ended during the wait rather than a sky bug.
  expect((await stats(page)).state).toBe('playing');
  const calm = await meteor(page);
  expect(calm.phase).toBe('dormant');
  expect(calm.tint).toBe(0);

  // --- the sapper joins from wave 5 ------------------------------------------
  await page.evaluate(() => window.__NEON.forceWave(5));
  await page.waitForFunction(
    () => (window.__NEON.enemyPos() as EnemyPos[]).some((e) => e.kind === 'sapper'),
    undefined,
    { timeout: 90_000 },
  );
  await page.evaluate(() => window.__NEON.teleportEnemies(24));

  const info = await renderInfo(page);
  expect(info.calls).toBeGreaterThan(0);
  const shot = await page.screenshot();
  expect(new Set(shot).size).toBeGreaterThan(3); // not a uniformly black frame

  await page.evaluate(() => {
    const s = window.__NEON.stats() as Stats;
    window.__NEON.hurt(s.hp + 10); // the run is on a health pool; go past it
  });
  await page.waitForTimeout(300);
  expect((await stats(page)).state).toBe('gameover');
  expect(await page.evaluate(() => window.__NEON.gunVisible())).toBe(false);

  // --- crosshair settings (last: opening the panel pauses the game) ---------
  const tuned = await setCrosshair(page, { shape: 'circle', color: '#ff0000', lines: false });
  expect(tuned.shape).toBe('circle');
  expect(tuned.lines).toBe(false);

  const painted = await page.evaluate(() =>
    ['crosshair', 'previewCross'].map((id) =>
      getComputedStyle(document.getElementById(id) as HTMLElement)
        .getPropertyValue('--color')
        .trim(),
    ),
  );
  expect(painted).toEqual(['#ff0000', '#ff0000']);

  expect(await page.evaluate(() => localStorage.getItem('neon.settings'))).toContain('"circle"');

  const clamped = await setCrosshair(page, { lineLen: 9999, shape: 'nope', color: 'red' });
  expect(clamped.lineLen).toBe(30);
  expect(clamped.shape).toBe('none');
  expect(clamped.color).toBe('#46e0ff');

  await page.keyboard.press('KeyC');
  await page.waitForTimeout(200);
  const openVisible = await page.evaluate(() =>
    document.getElementById('settingsScreen')?.classList.contains('visible'),
  );
  expect(openVisible).toBe(true);
  const preview = await crosshair(page);
  expect(preview.color).toBe('#46e0ff');

  // --- the panel has three tabs, and the other two are their own -----------
  const tabs = await page.evaluate(() => ({
    on: document.querySelector('#settingsTabs .tab.on')?.getAttribute('data-tab'),
    gameHidden: document.querySelector('.tabpane[data-pane="game"]')?.hasAttribute('hidden'),
    videoHidden: document.querySelector('.tabpane[data-pane="video"]')?.hasAttribute('hidden'),
  }));
  expect(tabs.on).toBe('crosshair');
  expect(tabs.gameHidden).toBe(true);
  expect(tabs.videoHidden).toBe(true);

  await page.click('#settingsTabs [data-tab="game"]');
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(() => document.querySelector('#settingsTabs .tab.on')?.getAttribute('data-tab')),
  ).toBe('game');
  expect(
    await page.evaluate(() => document.querySelector('.tabpane[data-pane="game"]')?.hasAttribute('hidden')),
  ).toBe(false);

  // A value changed in the game tab reaches the game and is written down.
  await page.evaluate(() => window.__NEON.setGame({ sensitivity: 2.5 }));
  const game = await page.evaluate(() => window.__NEON.settings() as SettingsBundle);
  expect(game.game.sensitivity).toBe(2.5);
  expect(await page.evaluate(() => localStorage.getItem('neon.settings'))).toContain('"sensitivity":2.5');

  await page.click('#settingsTabs [data-tab="video"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__NEON.setVideo({ shadows: false }));
  const video = await page.evaluate(() => window.__NEON.settings() as SettingsBundle);
  expect(video.video.shadows).toBe(false);
  expect(video.video.quality).toBe(2);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const closedVisible = await page.evaluate(() =>
    document.getElementById('settingsScreen')?.classList.contains('visible'),
  );
  expect(closedVisible).toBe(false);
});

test('opens on the main menu', async ({ page }) => {
  // Without ?test the game waits on the menu instead of dropping straight in.
  await page.goto('/');
  await page.waitForTimeout(2000);

  expect(
    await page.evaluate(() => document.getElementById('menuScreen')?.classList.contains('visible')),
  ).toBe(true);
  expect((await stats(page)).state).toBe('menu');

  // The controls list is hidden until it is asked for.
  expect(await page.evaluate(() => document.getElementById('menuKeys')?.hasAttribute('hidden'))).toBe(true);
  await page.click('#menuControls');
  expect(await page.evaluate(() => document.getElementById('menuKeys')?.hasAttribute('hidden'))).toBe(false);

  // Settings are reachable from the menu, without a pointer lock in sight.
  await page.click('#menuScreen [data-settings]');
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(() => document.getElementById('settingsScreen')?.classList.contains('visible')),
  ).toBe(true);
});
