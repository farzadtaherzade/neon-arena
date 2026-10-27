import { expect, type Page, test } from '@playwright/test';

/**
 * Mobile smoke test.
 *
 * Boots the production build on an emulated phone (touch, mobile viewport) and
 * drives the touch layer: the portrait lock, the on-screen buttons and the
 * auto-fire mode. Runs on the desktop Chrome with SwiftShader like the main
 * suite.
 */

/**
 * Phone-shaped context, hand-picked rather than spread from a device
 * descriptor: `devices['iPhone 13']` sets `defaultBrowserType: 'webkit'`,
 * and webkit cannot take the pinned system-Chrome `channel` — the launch dies
 * with `Unsupported webkit channel "chrome"`. `?touch` switches the touch
 * layer on regardless of what the pointer media queries report, so no
 * `pointer: coarse` emulation is needed.
 */
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  channel: 'chrome',
  launchOptions: {
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
  },
});

interface Stats {
  state: string;
  hp: number;
  ammo: number;
  kills: number;
  wave: number;
  hostiles: number;
}
interface EnemyPos {
  x: number;
  z: number;
  state: string;
  hp: number;
}
interface TouchInfo {
  enabled: boolean;
  visible: boolean;
  portrait: boolean;
  firing: boolean;
  aiming: boolean;
  shootMode: string;
}
interface VideoSettings {
  quality: number;
  shadows: boolean;
}

const stats = (page: Page) => page.evaluate(() => window.__NEON.stats() as Stats);
const touch = (page: Page) => page.evaluate(() => window.__NEON.touch() as TouchInfo);
const firing = (page: Page) => page.evaluate(() => (window.__NEON.touch() as TouchInfo).firing);
const aiming = (page: Page) => page.evaluate(() => (window.__NEON.touch() as TouchInfo).aiming);
const enemies = (page: Page) => page.evaluate(() => window.__NEON.enemyPos() as EnemyPos[]);
const rotateVisible = (page: Page) =>
  page.evaluate(() => document.getElementById('rotateScreen')?.classList.contains('visible') ?? false);
const land = (page: Page) => page.setViewportSize({ width: 844, height: 390 });
const port = (page: Page) => page.setViewportSize({ width: 390, height: 844 });

async function boot(page: Page): Promise<void> {
  await page.goto('/?test&touch', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__NEON !== undefined, undefined, { timeout: 20_000 });
  await page.waitForFunction(() => (window.__NEON.stats() as Stats).state === 'playing', undefined, {
    timeout: 20_000,
  });
}

test('locks portrait behind a rotate prompt and resumes on the way back', async ({ page }) => {
  test.setTimeout(120_000);

  // The device viewport is portrait: the overlay must be up before anything.
  await boot(page);
  expect(await rotateVisible(page)).toBe(true);
  expect((await touch(page)).portrait).toBe(true);
  // The layer itself is live (the run is playing underneath the overlay).
  expect((await touch(page)).visible).toBe(true);

  // Rotate to landscape: the overlay releases and nothing pauses.
  await land(page);
  await expect.poll(() => rotateVisible(page), { timeout: 10_000 }).toBe(false);
  expect((await touch(page)).portrait).toBe(false);
  expect((await stats(page)).state).toBe('playing');

  // Back to portrait mid-run: the run pauses behind the overlay...
  await port(page);
  await expect.poll(() => rotateVisible(page), { timeout: 10_000 }).toBe(true);
  expect((await stats(page)).state).toBe('paused');

  // ...and rotates back to a live run, not a stuck pause screen.
  await land(page);
  await expect.poll(() => rotateVisible(page), { timeout: 10_000 }).toBe(false);
  expect((await stats(page)).state).toBe('playing');
});

test('first touch launch defaults the video to LOW', async ({ page }) => {
  test.setTimeout(60_000);
  await land(page);
  await boot(page);

  // Fresh storage on a coarse-pointer device: quality LOW and no shadows,
  // stored through the normal settings bundle.
  const video = await page.evaluate(() => (window.__NEON.settings() as { video: VideoSettings }).video);
  expect(video.quality).toBe(0);
  expect(video.shadows).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('neon.settings'))).toContain('"tuned":true');
});

test('the on-screen buttons fire, aim and cut', async ({ page }) => {
  test.setTimeout(180_000);
  await land(page);
  await boot(page);

  // Give the run headroom: this suite stands still while mobs grind on the
  // player, and a death freezes the simulation for everything after it.
  await page.evaluate(() => window.__NEON.hurt(-20000));
  await page.evaluate(() => window.__NEON.teleportEnemies(24));

  // --- the trigger is the FIRE button ----------------------------------------
  expect((await touch(page)).visible).toBe(true);
  const before = (await stats(page)).ammo;
  expect(before).toBe(12);
  await page.locator('#btnFire').dispatchEvent('pointerdown');
  await page.waitForFunction(() => (window.__NEON.touch() as TouchInfo).firing, undefined, {
    timeout: 5000,
  });
  await page.waitForFunction(() => (window.__NEON.stats() as Stats).ammo < 12, undefined, {
    timeout: 30_000,
  });
  await page.locator('#btnFire').dispatchEvent('pointerup');
  await expect.poll(() => firing(page), { timeout: 5000 }).toBe(false);

  // --- ADS is a toggle: tap on, tap off ---------------------------------------
  await page.locator('#btnAim').dispatchEvent('pointerdown');
  await expect.poll(() => aiming(page), { timeout: 5000 }).toBe(true);
  await page.locator('#btnAim').dispatchEvent('pointerdown');
  await expect.poll(() => aiming(page), { timeout: 5000 }).toBe(false);

  // --- the KNIFE button swings the blade --------------------------------------
  await page.evaluate(() => {
    window.__NEON.aim(Math.PI, 0);
    window.__NEON.faceEnemies(1.5, 1.0);
  });
  const hpBefore = (await enemies(page)).reduce((a, e) => a + e.hp, 0);
  await page.locator('#btnKnife').dispatchEvent('pointerdown');
  await page.waitForFunction(
    (before) => (window.__NEON.enemyPos() as EnemyPos[]).reduce((a, e) => a + e.hp, 0) < before,
    hpBefore,
    { timeout: 15_000 },
  );

  // --- JUMP leaves the ground -------------------------------------------------
  const groundedY = await page.evaluate(() => (window.__NEON.camState() as { py: number }).py);
  await page.locator('#btnJump').dispatchEvent('pointerdown');
  await page.waitForFunction((y) => (window.__NEON.camState() as { py: number }).py > y, groundedY, {
    timeout: 5000,
  });
});

test('auto-fire shoots whatever the crosshair rests on', async ({ page }) => {
  test.setTimeout(180_000);
  await land(page);
  await boot(page);

  await page.evaluate(() => window.__NEON.hurt(-20000));
  await page.evaluate(() => window.__NEON.setTouch({ shootMode: 'auto' }));
  expect((await touch(page)).shootMode).toBe('auto');

  // No trigger anywhere: line the wave up down the open plaza and let the
  // centre-ray do the pulling. The kills counter is the only witness needed.
  await page.evaluate(() => {
    window.__NEON.aim(Math.PI, 0);
    window.__NEON.faceEnemies(8, 1.0);
  });
  await page.waitForFunction(() => (window.__NEON.stats() as Stats).kills > 0, undefined, {
    timeout: 60_000,
  });
  // The mode also spends rounds: the trigger went through the weapon, not
  // around it.
  expect((await stats(page)).ammo).toBeLessThan(12);
});
