// 7169de4c0b91bfb9163cab60086e0becc85d960f
import { expect, test } from '@playwright/test';

/**
 * Headless smoke test.
 *
 * Boots the production build, plays it through `window.__NEON` and asserts the
 * things a broken module boundary or a leaked GPU resource would show up as.
 * The waits are condition-based because software rendering runs the simulation
 * slower than wall clock.
 */

const stats = page => page.evaluate(() => window.__NEON.stats());
const enemies = page => page.evaluate(() => window.__NEON.enemyPos());
const cam = page => page.evaluate(() => window.__NEON.camState());
const renderInfo = page => page.evaluate(() => window.__NEON.renderInfo());
const setCrosshair = (page, patch) => page.evaluate(p => window.__NEON.setCrosshair(p), patch);
const crosshair = page => page.evaluate(() => window.__NEON.crosshair());

/**
 * Point the camera at the nearest enemy's torso. The camera's forward vector is
 * (-sin yaw, *, -cos yaw), which this inverts into an aim angle.
 */
const aimAtNearestEnemy = () => {
  const N = window.__NEON;
  const list = N.enemyPos();
  const c = N.camState();
  let best = null;
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
async function sweep(page) {
  for (let i = 0; i < 8; i++) {
    await page.evaluate(yaw => window.__NEON.aim(yaw, -0.05), i * Math.PI / 4);
    await page.waitForTimeout(140);
  }
}

/**
 * Wait until the renderer's geometry count stops growing. Geometries reach the
 * GPU lazily on first use, so measuring a leak before that settles is noise.
 */
async function warmUp(page, budgetMs = 45000) {
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
async function killEnemies(page, target, budgetMs) {
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
        const s = window.__NEON.stats();
        if (s.hp < 60) window.__NEON.hurt(-40);
      });
      await page.evaluate(aimAtNearestEnemy);
      await page.waitForFunction(k => window.__NEON.stats().kills > k, kills, {
        timeout: 2500
      }).catch(() => {});
    }
    return (await stats(page)).kills;
  } finally {
    await page.mouse.up();
  }
}
test('boots, plays and cleans up after itself', async ({
  page
}) => {
  // Software rendering and 20-odd kills take a while; the default 60s is not enough.
  test.setTimeout(900000);
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto('/?test', {
    waitUntil: 'load'
  });
  await page.waitForFunction(() => window.__NEON !== undefined, undefined, {
    timeout: 20000
  });
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
  expect(alive.every(e => e.state === 'alive')).toBe(true);

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
  await page.waitForFunction(() => {
    const s = window.__NEON.stats();
    const alive = window.__NEON.enemyPos().length;
    return alive > 0 && s.hostiles === alive;
  }, undefined, {
    timeout: 90000
  });
  await page.evaluate(() => {
    // A maze map means a ring teleport can hide every target behind cover; line
    // them up down the open plaza instead.
    window.__NEON.aim(Math.PI, 0);
    window.__NEON.faceEnemies(8, 1.0);
  });
  await page.evaluate(aimAtNearestEnemy);
  const before = (await enemies(page)).map(e => e.hp);
  await page.mouse.down();
  await page.waitForFunction(() => {
    const list = window.__NEON.enemyPos();
    const s = window.__NEON.stats();
    return list.some(e => e.hp < 60) || s.ammo < 8;
  }, undefined, {
    timeout: 30000
  });
  await page.mouse.up();
  const after = (await enemies(page)).map(e => e.hp);
  expect(after.reduce((a, b) => a + b, 0)).toBeLessThan(before.reduce((a, b) => a + b, 0));
  expect((await stats(page)).ammo).toBeLessThan(12);

  // --- reload ---------------------------------------------------------------
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__NEON.stats().ammo === 12, undefined, {
    timeout: 30000
  });

  // --- GPU resources converge instead of growing forever ---------------------
  const warm = await killEnemies(page, 4, 120000);
  await warmUp(page);
  const first = await renderInfo(page);
  const mid = await killEnemies(page, warm + 8, 180000);
  await warmUp(page);
  const second = await renderInfo(page);
  const end = await killEnemies(page, mid + 8, 180000);
  await warmUp(page);
  const third = await renderInfo(page);

  // Before the rewrite every enemy leaked two health-bar geometries.
  expect(third.geometries - second.geometries, `geometries ${first.geometries} -> ${second.geometries} -> ${third.geometries} over ${end - mid} kills`).toBe(0);
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
  expect(await page.evaluate(() => {
    var _document$getElementB;
    return (_document$getElementB = document.getElementById('settingsScreen')) === null || _document$getElementB === void 0 ? void 0 : _document$getElementB.classList.contains('visible');
  })).toBe(true);
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
    const c = document.getElementById('minimap');
    const ctx = c === null || c === void 0 ? void 0 : c.getContext('2d');
    if (!c || !ctx) return -1;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) {
      var _d$i;
      if (((_d$i = d[i]) !== null && _d$i !== void 0 ? _d$i : 0) > 8) lit++;
    }
    return lit;
  });
  expect(minimapLit).toBeGreaterThan(500);

  // Headroom: the bomb checks below stand still on purpose.
  await page.evaluate(() => window.__NEON.hurt(-50));

  // --- the bomb warns, and can be shot out of the air -------------------------
  const spot = await cam(page);
  await page.evaluate(p => window.__NEON.spawnBomb(p.x + 2, p.z), {
    x: spot.px,
    z: spot.pz
  });
  await page.waitForFunction(() => window.__NEON.bombs().length === 1, undefined, {
    timeout: 5000
  });
  // A warning while the fuse burns: a silent bomb would be a cheap death.
  await page.waitForFunction(() => {
    var _document$getElementB2;
    return ((_document$getElementB2 = document.getElementById('bombWarn')) === null || _document$getElementB2 === void 0 ? void 0 : _document$getElementB2.classList.contains('on')) === true;
  }, undefined, {
    timeout: 5000
  });
  expect(await page.evaluate(() => {
    var _document$getElementB3;
    return (_document$getElementB3 = document.getElementById('bombWarn')) === null || _document$getElementB3 === void 0 ? void 0 : _document$getElementB3.classList.contains('on');
  })).toBe(true);
  await page.evaluate(() => window.__NEON.teleportEnemies(24)); // clear the firing line
  const scoreBeforeShot = (await stats(page)).score;
  await page.evaluate(p => {
    const c = window.__NEON.camState();
    const d = Math.hypot(p.x - c.px, p.z - c.pz);
    window.__NEON.aim(Math.atan2(-(p.x - c.px), -(p.z - c.pz)), Math.atan2(0.35 - c.py, d));
  }, {
    x: spot.px + 2,
    z: spot.pz
  });
  await page.mouse.down();
  await page.waitForFunction(() => window.__NEON.bombs().length === 0, undefined, {
    timeout: 20000
  });
  await page.mouse.up();
  expect((await stats(page)).score).toBeGreaterThan(scoreBeforeShot);

  // --- left alone, the fuse runs out and the blast reaches the player ---------
  const hpBeforeFuse = (await stats(page)).hp;
  const spot2 = await cam(page);
  await page.evaluate(p => window.__NEON.spawnBomb(p.x + 2, p.z), {
    x: spot2.px,
    z: spot2.pz
  });
  await page.waitForFunction(hp => window.__NEON.bombs().length === 0 && window.__NEON.stats().hp < hp, hpBeforeFuse, {
    timeout: 20000
  });
  expect((await stats(page)).hp).toBeLessThan(hpBeforeFuse);
  expect(await page.evaluate(() => {
    var _document$getElementB4;
    return (_document$getElementB4 = document.getElementById('bombWarn')) === null || _document$getElementB4 === void 0 ? void 0 : _document$getElementB4.classList.contains('on');
  })).toBe(false);

  // --- the sapper joins from wave 5 ------------------------------------------
  await page.evaluate(() => window.__NEON.forceWave(5));
  await page.waitForFunction(() => window.__NEON.enemyPos().some(e => e.kind === 'sapper'), undefined, {
    timeout: 90000
  });
  await page.evaluate(() => window.__NEON.teleportEnemies(24));
  const info = await renderInfo(page);
  expect(info.calls).toBeGreaterThan(0);
  const shot = await page.screenshot();
  expect(new Set(shot).size).toBeGreaterThan(3); // not a uniformly black frame

  await page.evaluate(() => window.__NEON.hurt(999));
  await page.waitForTimeout(300);
  expect((await stats(page)).state).toBe('gameover');
  expect(await page.evaluate(() => window.__NEON.gunVisible())).toBe(false);

  // --- crosshair settings (last: opening the panel pauses the game) ---------
  const tuned = await setCrosshair(page, {
    shape: 'circle',
    color: '#ff0000',
    lines: false
  });
  expect(tuned.shape).toBe('circle');
  expect(tuned.lines).toBe(false);
  const painted = await page.evaluate(() => ['crosshair', 'previewCross'].map(id => getComputedStyle(document.getElementById(id)).getPropertyValue('--color').trim()));
  expect(painted).toEqual(['#ff0000', '#ff0000']);
  expect(await page.evaluate(() => localStorage.getItem('neon.crosshair'))).toContain('"circle"');
  const clamped = await setCrosshair(page, {
    lineLen: 9999,
    shape: 'nope',
    color: 'red'
  });
  expect(clamped.lineLen).toBe(30);
  expect(clamped.shape).toBe('none');
  expect(clamped.color).toBe('#46e0ff');
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(200);
  const openVisible = await page.evaluate(() => {
    var _document$getElementB5;
    return (_document$getElementB5 = document.getElementById('settingsScreen')) === null || _document$getElementB5 === void 0 ? void 0 : _document$getElementB5.classList.contains('visible');
  });
  expect(openVisible).toBe(true);
  const preview = await crosshair(page);
  expect(preview.color).toBe('#46e0ff');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const closedVisible = await page.evaluate(() => {
    var _document$getElementB6;
    return (_document$getElementB6 = document.getElementById('settingsScreen')) === null || _document$getElementB6 === void 0 ? void 0 : _document$getElementB6.classList.contains('visible');
  });
  expect(closedVisible).toBe(false);
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJleHBlY3QiLCJ0ZXN0Iiwic3RhdHMiLCJwYWdlIiwiZXZhbHVhdGUiLCJ3aW5kb3ciLCJfX05FT04iLCJlbmVtaWVzIiwiZW5lbXlQb3MiLCJjYW0iLCJjYW1TdGF0ZSIsInJlbmRlckluZm8iLCJzZXRDcm9zc2hhaXIiLCJwYXRjaCIsInAiLCJjcm9zc2hhaXIiLCJhaW1BdE5lYXJlc3RFbmVteSIsIk4iLCJsaXN0IiwiYyIsImJlc3QiLCJiZXN0RCIsIkluZmluaXR5IiwiZSIsImQiLCJNYXRoIiwiaHlwb3QiLCJ4IiwicHgiLCJ6IiwicHoiLCJhaW0iLCJhdGFuMiIsInB5Iiwic3dlZXAiLCJpIiwieWF3IiwiUEkiLCJ3YWl0Rm9yVGltZW91dCIsIndhcm1VcCIsImJ1ZGdldE1zIiwic3RhYmxlIiwicHJldmlvdXMiLCJkZWFkbGluZSIsIkRhdGUiLCJub3ciLCJjdXJyZW50IiwiZ2VvbWV0cmllcyIsImtpbGxFbmVtaWVzIiwidGFyZ2V0IiwibW91c2UiLCJkb3duIiwia2lsbHMiLCJmYWNlRW5lbWllcyIsInMiLCJocCIsImh1cnQiLCJ3YWl0Rm9yRnVuY3Rpb24iLCJrIiwidGltZW91dCIsImNhdGNoIiwidXAiLCJzZXRUaW1lb3V0IiwiY29uc29sZUVycm9ycyIsInBhZ2VFcnJvcnMiLCJvbiIsIm0iLCJ0eXBlIiwicHVzaCIsInRleHQiLCJTdHJpbmciLCJnb3RvIiwid2FpdFVudGlsIiwidW5kZWZpbmVkIiwic2xpY2UiLCJqb2luIiwidG9FcXVhbCIsImJvb3QiLCJzdGF0ZSIsInRvQmUiLCJ3YXZlIiwiYW1tbyIsImhvc3RpbGVzIiwidG9CZUdyZWF0ZXJUaGFuIiwiZ3VuVmlzaWJsZSIsImFsaXZlIiwibGVuZ3RoIiwiZXZlcnkiLCJsb29rZWQiLCJ0b0JlQ2xvc2VUbyIsInBpdGNoIiwieWF3T2JqWSIsImJlZm9yZSIsIm1hcCIsInNvbWUiLCJhZnRlciIsInJlZHVjZSIsImEiLCJiIiwidG9CZUxlc3NUaGFuIiwia2V5Ym9hcmQiLCJwcmVzcyIsIndhcm0iLCJmaXJzdCIsIm1pZCIsInNlY29uZCIsImVuZCIsInRoaXJkIiwidGV4dHVyZXMiLCJ0ZWxlcG9ydEVuZW1pZXMiLCJocEJlZm9yZUhpdCIsImxvY2F0b3IiLCJudGgiLCJjbGljayIsImRvY3VtZW50IiwicG9pbnRlckxvY2tFbGVtZW50IiwidG9CZU51bGwiLCJfZG9jdW1lbnQkZ2V0RWxlbWVudEIiLCJnZXRFbGVtZW50QnlJZCIsImNsYXNzTGlzdCIsImNvbnRhaW5zIiwic2hhcGUiLCJtaW5pbWFwTGl0IiwiY3R4IiwiZ2V0Q29udGV4dCIsImdldEltYWdlRGF0YSIsIndpZHRoIiwiaGVpZ2h0IiwiZGF0YSIsImxpdCIsIl9kJGkiLCJzcG90Iiwic3Bhd25Cb21iIiwiYm9tYnMiLCJfZG9jdW1lbnQkZ2V0RWxlbWVudEIyIiwiX2RvY3VtZW50JGdldEVsZW1lbnRCMyIsInNjb3JlQmVmb3JlU2hvdCIsInNjb3JlIiwiaHBCZWZvcmVGdXNlIiwic3BvdDIiLCJfZG9jdW1lbnQkZ2V0RWxlbWVudEI0IiwiZm9yY2VXYXZlIiwia2luZCIsImluZm8iLCJjYWxscyIsInNob3QiLCJzY3JlZW5zaG90IiwiU2V0Iiwic2l6ZSIsInR1bmVkIiwiY29sb3IiLCJsaW5lcyIsInBhaW50ZWQiLCJpZCIsImdldENvbXB1dGVkU3R5bGUiLCJnZXRQcm9wZXJ0eVZhbHVlIiwidHJpbSIsImxvY2FsU3RvcmFnZSIsImdldEl0ZW0iLCJ0b0NvbnRhaW4iLCJjbGFtcGVkIiwibGluZUxlbiIsIm9wZW5WaXNpYmxlIiwiX2RvY3VtZW50JGdldEVsZW1lbnRCNSIsInByZXZpZXciLCJjbG9zZWRWaXNpYmxlIiwiX2RvY3VtZW50JGdldEVsZW1lbnRCNiJdLCJzb3VyY2VzIjpbInNtb2tlLnNwZWMudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZXhwZWN0LCB0eXBlIFBhZ2UsIHRlc3QgfSBmcm9tICdAcGxheXdyaWdodC90ZXN0JztcblxuLyoqXG4gKiBIZWFkbGVzcyBzbW9rZSB0ZXN0LlxuICpcbiAqIEJvb3RzIHRoZSBwcm9kdWN0aW9uIGJ1aWxkLCBwbGF5cyBpdCB0aHJvdWdoIGB3aW5kb3cuX19ORU9OYCBhbmQgYXNzZXJ0cyB0aGVcbiAqIHRoaW5ncyBhIGJyb2tlbiBtb2R1bGUgYm91bmRhcnkgb3IgYSBsZWFrZWQgR1BVIHJlc291cmNlIHdvdWxkIHNob3cgdXAgYXMuXG4gKiBUaGUgd2FpdHMgYXJlIGNvbmRpdGlvbi1iYXNlZCBiZWNhdXNlIHNvZnR3YXJlIHJlbmRlcmluZyBydW5zIHRoZSBzaW11bGF0aW9uXG4gKiBzbG93ZXIgdGhhbiB3YWxsIGNsb2NrLlxuICovXG5cbmludGVyZmFjZSBTdGF0cyB7XG4gIHN0YXRlOiBzdHJpbmc7XG4gIGhwOiBudW1iZXI7XG4gIGFtbW86IG51bWJlcjtcbiAgc2NvcmU6IG51bWJlcjtcbiAga2lsbHM6IG51bWJlcjtcbiAgd2F2ZTogbnVtYmVyO1xuICBob3N0aWxlczogbnVtYmVyO1xufVxuaW50ZXJmYWNlIEVuZW15UG9zIHtcbiAgeDogbnVtYmVyO1xuICB6OiBudW1iZXI7XG4gIHN0YXRlOiBzdHJpbmc7XG4gIGhwOiBudW1iZXI7XG4gIGtpbmQ6IHN0cmluZztcbiAgbW9kZTogc3RyaW5nO1xufVxuaW50ZXJmYWNlIENhbVN0YXRlIHtcbiAgcHg6IG51bWJlcjtcbiAgcHk6IG51bWJlcjtcbiAgcHo6IG51bWJlcjtcbiAgeWF3OiBudW1iZXI7XG4gIHBpdGNoOiBudW1iZXI7XG4gIHlhd09ialk6IG51bWJlcjtcbn1cbmludGVyZmFjZSBSZW5kZXJJbmZvIHtcbiAgY2FsbHM6IG51bWJlcjtcbiAgZ2VvbWV0cmllczogbnVtYmVyO1xuICB0ZXh0dXJlczogbnVtYmVyO1xuICBwcm9ncmFtczogbnVtYmVyO1xufVxuaW50ZXJmYWNlIENyb3NzaGFpclNldHRpbmdzIHtcbiAgc2hhcGU6IHN0cmluZztcbiAgbGluZXM6IGJvb2xlYW47XG4gIGxpbmVMZW46IG51bWJlcjtcbiAgY29sb3I6IHN0cmluZztcbn1cblxuY29uc3Qgc3RhdHMgPSAocGFnZTogUGFnZSkgPT4gcGFnZS5ldmFsdWF0ZSgoKSA9PiB3aW5kb3cuX19ORU9OLnN0YXRzKCkgYXMgU3RhdHMpO1xuY29uc3QgZW5lbWllcyA9IChwYWdlOiBQYWdlKSA9PiBwYWdlLmV2YWx1YXRlKCgpID0+IHdpbmRvdy5fX05FT04uZW5lbXlQb3MoKSBhcyBFbmVteVBvc1tdKTtcbmNvbnN0IGNhbSA9IChwYWdlOiBQYWdlKSA9PiBwYWdlLmV2YWx1YXRlKCgpID0+IHdpbmRvdy5fX05FT04uY2FtU3RhdGUoKSBhcyBDYW1TdGF0ZSk7XG5jb25zdCByZW5kZXJJbmZvID0gKHBhZ2U6IFBhZ2UpID0+IHBhZ2UuZXZhbHVhdGUoKCkgPT4gd2luZG93Ll9fTkVPTi5yZW5kZXJJbmZvKCkgYXMgUmVuZGVySW5mbyk7XG5jb25zdCBzZXRDcm9zc2hhaXIgPSAocGFnZTogUGFnZSwgcGF0Y2g6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICBwYWdlLmV2YWx1YXRlKChwKSA9PiB3aW5kb3cuX19ORU9OLnNldENyb3NzaGFpcihwKSBhcyBDcm9zc2hhaXJTZXR0aW5ncywgcGF0Y2gpO1xuY29uc3QgY3Jvc3NoYWlyID0gKHBhZ2U6IFBhZ2UpID0+IHBhZ2UuZXZhbHVhdGUoKCkgPT4gd2luZG93Ll9fTkVPTi5jcm9zc2hhaXIoKSBhcyBDcm9zc2hhaXJTZXR0aW5ncyk7XG5cbi8qKlxuICogUG9pbnQgdGhlIGNhbWVyYSBhdCB0aGUgbmVhcmVzdCBlbmVteSdzIHRvcnNvLiBUaGUgY2FtZXJhJ3MgZm9yd2FyZCB2ZWN0b3IgaXNcbiAqICgtc2luIHlhdywgKiwgLWNvcyB5YXcpLCB3aGljaCB0aGlzIGludmVydHMgaW50byBhbiBhaW0gYW5nbGUuXG4gKi9cbmNvbnN0IGFpbUF0TmVhcmVzdEVuZW15ID0gKCkgPT4ge1xuICBjb25zdCBOID0gd2luZG93Ll9fTkVPTjtcbiAgY29uc3QgbGlzdCA9IE4uZW5lbXlQb3MoKSBhcyBFbmVteVBvc1tdO1xuICBjb25zdCBjID0gTi5jYW1TdGF0ZSgpIGFzIENhbVN0YXRlO1xuICBsZXQgYmVzdDogRW5lbXlQb3MgfCBudWxsID0gbnVsbDtcbiAgbGV0IGJlc3REID0gSW5maW5pdHk7XG4gIGZvciAoY29uc3QgZSBvZiBsaXN0KSB7XG4gICAgY29uc3QgZCA9IE1hdGguaHlwb3QoZS54IC0gYy5weCwgZS56IC0gYy5weik7XG4gICAgaWYgKGQgPCBiZXN0RCkge1xuICAgICAgYmVzdEQgPSBkO1xuICAgICAgYmVzdCA9IGU7XG4gICAgfVxuICB9XG4gIGlmICghYmVzdCkgcmV0dXJuIGZhbHNlO1xuICBOLmFpbShNYXRoLmF0YW4yKC0oYmVzdC54IC0gYy5weCksIC0oYmVzdC56IC0gYy5weikpLCBNYXRoLmF0YW4yKDEgLSBjLnB5LCBiZXN0RCkpO1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8qKlxuICogU3BpbiB0aGUgdmlldyBhbGwgdGhlIHdheSByb3VuZC4gU3RhdGljIGdlb21ldHJ5IHVwbG9hZHMgdG8gdGhlIEdQVSBvbiBpdHNcbiAqIGZpcnN0IGRyYXcsIGFuZCBhbiA4NC11bml0IG1hemUgaGFzIGZhciBtb3JlIG9mIGl0IHRoYW4gb25lIHNjcmVlbmZ1bCDigJQgc29cbiAqIHdpdGhvdXQgYSBzd2VlcCBcInN0YWJsZSBnZW9tZXRyeSBjb3VudFwiIGp1c3QgbWVhbnMgXCJldmVyeXRoaW5nIEkgaGFwcGVuZWQgdG9cbiAqIGxvb2sgYXQgc28gZmFyXCIsIGFuZCB0aGUgbmV4dCBraWxsIHRoYXQgdHVybnMgdGhlIGNhbWVyYSByZWFkcyBhcyBhIGxlYWsuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHN3ZWVwKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHZvaWQ+IHtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCA4OyBpKyspIHtcbiAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKCh5YXcpID0+IHdpbmRvdy5fX05FT04uYWltKHlhdywgLTAuMDUpLCAoaSAqIE1hdGguUEkpIC8gNCk7XG4gICAgYXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgxNDApO1xuICB9XG59XG5cbi8qKlxuICogV2FpdCB1bnRpbCB0aGUgcmVuZGVyZXIncyBnZW9tZXRyeSBjb3VudCBzdG9wcyBncm93aW5nLiBHZW9tZXRyaWVzIHJlYWNoIHRoZVxuICogR1BVIGxhemlseSBvbiBmaXJzdCB1c2UsIHNvIG1lYXN1cmluZyBhIGxlYWsgYmVmb3JlIHRoYXQgc2V0dGxlcyBpcyBub2lzZS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gd2FybVVwKHBhZ2U6IFBhZ2UsIGJ1ZGdldE1zID0gNDVfMDAwKTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IHN3ZWVwKHBhZ2UpO1xuICBsZXQgc3RhYmxlID0gMDtcbiAgbGV0IHByZXZpb3VzID0gLTE7XG4gIGNvbnN0IGRlYWRsaW5lID0gRGF0ZS5ub3coKSArIGJ1ZGdldE1zO1xuICB3aGlsZSAoRGF0ZS5ub3coKSA8IGRlYWRsaW5lKSB7XG4gICAgY29uc3QgY3VycmVudCA9IChhd2FpdCByZW5kZXJJbmZvKHBhZ2UpKS5nZW9tZXRyaWVzO1xuICAgIHN0YWJsZSA9IGN1cnJlbnQgPT09IHByZXZpb3VzID8gc3RhYmxlICsgMSA6IDA7XG4gICAgcHJldmlvdXMgPSBjdXJyZW50O1xuICAgIGlmIChzdGFibGUgPj0gNCkgcmV0dXJuO1xuICAgIGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoNTAwKTtcbiAgfVxufVxuXG4vKipcbiAqIEhvbGQgdGhlIHRyaWdnZXIgdW50aWwgdGhlIGtpbGwgY291bnRlciByZWFjaGVzIGB0YXJnZXRgLiBFbmVtaWVzIGFyZSBwYXJrZWRcbiAqIGF0IGxvbmcgcmFuZ2UgZmlyc3Qgc28gdGhleSBjYW5ub3QgY2xvc2UgYW5kIGtpbGwgdGhlIHBsYXllciBtaWQtcnVuLlxuICovXG5hc3luYyBmdW5jdGlvbiBraWxsRW5lbWllcyhwYWdlOiBQYWdlLCB0YXJnZXQ6IG51bWJlciwgYnVkZ2V0TXM6IG51bWJlcik6IFByb21pc2U8bnVtYmVyPiB7XG4gIGF3YWl0IHBhZ2UubW91c2UuZG93bigpO1xuICBjb25zdCBkZWFkbGluZSA9IERhdGUubm93KCkgKyBidWRnZXRNcztcbiAgdHJ5IHtcbiAgICB3aGlsZSAoRGF0ZS5ub3coKSA8IGRlYWRsaW5lKSB7XG4gICAgICBjb25zdCBraWxscyA9IChhd2FpdCBzdGF0cyhwYWdlKSkua2lsbHM7XG4gICAgICBpZiAoa2lsbHMgPj0gdGFyZ2V0KSByZXR1cm4ga2lsbHM7XG4gICAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IHtcbiAgICAgICAgLy8gRmFjZSBzb3V0aCBmcm9tIHRoZSBzcGF3biBwbGF6YTogYSBjbGVhciBsYW5lLCB3aGF0ZXZlciB0aGUgbWF6ZSBkb2VzXG4gICAgICAgIC8vIGJldHdlZW4gdGhlIHBsYXllciBhbmQgdGhlIHJpbmcuXG4gICAgICAgIHdpbmRvdy5fX05FT04uYWltKE1hdGguUEksIDApO1xuICAgICAgICB3aW5kb3cuX19ORU9OLmZhY2VFbmVtaWVzKDEwLCAxLjApO1xuICAgICAgICAvLyBUaGlzIHBoYXNlIG1lYXN1cmVzIEdQVSByZXNvdXJjZXMgb3ZlciBtaW51dGVzIG9mIHNob290aW5nOyBrZWVwIHRoZVxuICAgICAgICAvLyBwbGF5ZXIgYWxpdmUgcmF0aGVyIHRoYW4gdHVybmluZyBpdCBpbnRvIGEgc3Vydml2YWwgdGVzdC5cbiAgICAgICAgY29uc3QgcyA9IHdpbmRvdy5fX05FT04uc3RhdHMoKSBhcyBTdGF0cztcbiAgICAgICAgaWYgKHMuaHAgPCA2MCkgd2luZG93Ll9fTkVPTi5odXJ0KC00MCk7XG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHBhZ2UuZXZhbHVhdGUoYWltQXROZWFyZXN0RW5lbXkpO1xuICAgICAgYXdhaXQgcGFnZVxuICAgICAgICAud2FpdEZvckZ1bmN0aW9uKChrKSA9PiAod2luZG93Ll9fTkVPTi5zdGF0cygpIGFzIFN0YXRzKS5raWxscyA+IGssIGtpbGxzLCB7IHRpbWVvdXQ6IDI1MDAgfSlcbiAgICAgICAgLmNhdGNoKCgpID0+IHt9KTtcbiAgICB9XG4gICAgcmV0dXJuIChhd2FpdCBzdGF0cyhwYWdlKSkua2lsbHM7XG4gIH0gZmluYWxseSB7XG4gICAgYXdhaXQgcGFnZS5tb3VzZS51cCgpO1xuICB9XG59XG5cbnRlc3QoJ2Jvb3RzLCBwbGF5cyBhbmQgY2xlYW5zIHVwIGFmdGVyIGl0c2VsZicsIGFzeW5jICh7IHBhZ2UgfSkgPT4ge1xuICAvLyBTb2Z0d2FyZSByZW5kZXJpbmcgYW5kIDIwLW9kZCBraWxscyB0YWtlIGEgd2hpbGU7IHRoZSBkZWZhdWx0IDYwcyBpcyBub3QgZW5vdWdoLlxuICB0ZXN0LnNldFRpbWVvdXQoOTAwXzAwMCk7XG5cbiAgY29uc3QgY29uc29sZUVycm9yczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgcGFnZUVycm9yczogc3RyaW5nW10gPSBbXTtcbiAgcGFnZS5vbignY29uc29sZScsIChtKSA9PiB7XG4gICAgaWYgKG0udHlwZSgpID09PSAnZXJyb3InKSBjb25zb2xlRXJyb3JzLnB1c2gobS50ZXh0KCkpO1xuICB9KTtcbiAgcGFnZS5vbigncGFnZWVycm9yJywgKGUpID0+IHBhZ2VFcnJvcnMucHVzaChTdHJpbmcoZSkpKTtcblxuICBhd2FpdCBwYWdlLmdvdG8oJy8/dGVzdCcsIHsgd2FpdFVudGlsOiAnbG9hZCcgfSk7XG4gIGF3YWl0IHBhZ2Uud2FpdEZvckZ1bmN0aW9uKCgpID0+IHdpbmRvdy5fX05FT04gIT09IHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB7IHRpbWVvdXQ6IDIwXzAwMCB9KTtcblxuICBleHBlY3QocGFnZUVycm9ycywgcGFnZUVycm9ycy5zbGljZSgwLCAzKS5qb2luKCc7ICcpKS50b0VxdWFsKFtdKTtcbiAgZXhwZWN0KGNvbnNvbGVFcnJvcnMsIGNvbnNvbGVFcnJvcnMuc2xpY2UoMCwgMykuam9pbignOyAnKSkudG9FcXVhbChbXSk7XG5cbiAgLy8gLS0tIGJvb3QgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgYXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgyNTAwKTsgLy8gbGV0IHRoZSBmaXJzdCB3YXZlIHNwYXduXG4gIGNvbnN0IGJvb3QgPSBhd2FpdCBzdGF0cyhwYWdlKTtcbiAgZXhwZWN0KGJvb3Quc3RhdGUpLnRvQmUoJ3BsYXlpbmcnKTtcbiAgZXhwZWN0KGJvb3Qud2F2ZSkudG9CZSgxKTtcbiAgZXhwZWN0KGJvb3QuaHApLnRvQmUoMTAwKTtcbiAgZXhwZWN0KGJvb3QuYW1tbykudG9CZSgxMik7XG4gIGV4cGVjdChib290Lmhvc3RpbGVzKS50b0JlR3JlYXRlclRoYW4oMCk7XG4gIGV4cGVjdChhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IHdpbmRvdy5fX05FT04uZ3VuVmlzaWJsZSgpKSkudG9CZSh0cnVlKTtcblxuICBjb25zdCBhbGl2ZSA9IGF3YWl0IGVuZW1pZXMocGFnZSk7XG4gIGV4cGVjdChhbGl2ZS5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKTtcbiAgZXhwZWN0KGFsaXZlLmV2ZXJ5KChlKSA9PiBlLnN0YXRlID09PSAnYWxpdmUnKSkudG9CZSh0cnVlKTtcblxuICAvLyAtLS0gbG9vayAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IHdpbmRvdy5fX05FT04uYWltKDAuNSwgLTAuMikpO1xuICBhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDEyMCk7XG4gIGNvbnN0IGxvb2tlZCA9IGF3YWl0IGNhbShwYWdlKTtcbiAgZXhwZWN0KGxvb2tlZC55YXcpLnRvQmVDbG9zZVRvKDAuNSwgMik7XG4gIGV4cGVjdChsb29rZWQucGl0Y2gpLnRvQmVDbG9zZVRvKC0wLjIsIDIpO1xuICBleHBlY3QobG9va2VkLnlhd09ialkpLnRvQmVDbG9zZVRvKDAuNSwgMik7XG5cbiAgLy8gLS0tIHNob290IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgLy8gTGV0IHRoZSB3YXZlIGZpbmlzaCBzcGF3bmluZyBmaXJzdDogSFAgdG90YWxzIGFyZSBvbmx5IGNvbXBhcmFibGUgYmV0d2VlblxuICAvLyB0d28gc25hcHNob3RzIGlmIHRoZSBwb3B1bGF0aW9uIGRpZCBub3QgY2hhbmdlIGluIGJldHdlZW4uXG4gIGF3YWl0IHBhZ2Uud2FpdEZvckZ1bmN0aW9uKFxuICAgICgpID0+IHtcbiAgICAgIGNvbnN0IHMgPSB3aW5kb3cuX19ORU9OLnN0YXRzKCkgYXMgU3RhdHM7XG4gICAgICBjb25zdCBhbGl2ZSA9ICh3aW5kb3cuX19ORU9OLmVuZW15UG9zKCkgYXMgRW5lbXlQb3NbXSkubGVuZ3RoO1xuICAgICAgcmV0dXJuIGFsaXZlID4gMCAmJiBzLmhvc3RpbGVzID09PSBhbGl2ZTtcbiAgICB9LFxuICAgIHVuZGVmaW5lZCxcbiAgICB7IHRpbWVvdXQ6IDkwXzAwMCB9LFxuICApO1xuICBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IHtcbiAgICAvLyBBIG1hemUgbWFwIG1lYW5zIGEgcmluZyB0ZWxlcG9ydCBjYW4gaGlkZSBldmVyeSB0YXJnZXQgYmVoaW5kIGNvdmVyOyBsaW5lXG4gICAgLy8gdGhlbSB1cCBkb3duIHRoZSBvcGVuIHBsYXphIGluc3RlYWQuXG4gICAgd2luZG93Ll9fTkVPTi5haW0oTWF0aC5QSSwgMCk7XG4gICAgd2luZG93Ll9fTkVPTi5mYWNlRW5lbWllcyg4LCAxLjApO1xuICB9KTtcbiAgYXdhaXQgcGFnZS5ldmFsdWF0ZShhaW1BdE5lYXJlc3RFbmVteSk7XG4gIGNvbnN0IGJlZm9yZSA9IChhd2FpdCBlbmVtaWVzKHBhZ2UpKS5tYXAoKGUpID0+IGUuaHApO1xuICBhd2FpdCBwYWdlLm1vdXNlLmRvd24oKTtcbiAgYXdhaXQgcGFnZS53YWl0Rm9yRnVuY3Rpb24oXG4gICAgKCkgPT4ge1xuICAgICAgY29uc3QgbGlzdCA9IHdpbmRvdy5fX05FT04uZW5lbXlQb3MoKSBhcyBFbmVteVBvc1tdO1xuICAgICAgY29uc3QgcyA9IHdpbmRvdy5fX05FT04uc3RhdHMoKSBhcyBTdGF0cztcbiAgICAgIHJldHVybiBsaXN0LnNvbWUoKGUpID0+IGUuaHAgPCA2MCkgfHwgcy5hbW1vIDwgODtcbiAgICB9LFxuICAgIHVuZGVmaW5lZCxcbiAgICB7IHRpbWVvdXQ6IDMwXzAwMCB9LFxuICApO1xuICBhd2FpdCBwYWdlLm1vdXNlLnVwKCk7XG5cbiAgY29uc3QgYWZ0ZXIgPSAoYXdhaXQgZW5lbWllcyhwYWdlKSkubWFwKChlKSA9PiBlLmhwKTtcbiAgZXhwZWN0KGFmdGVyLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApKS50b0JlTGVzc1RoYW4oYmVmb3JlLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApKTtcbiAgZXhwZWN0KChhd2FpdCBzdGF0cyhwYWdlKSkuYW1tbykudG9CZUxlc3NUaGFuKDEyKTtcblxuICAvLyAtLS0gcmVsb2FkIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICBhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdLZXlSJyk7XG4gIGF3YWl0IHBhZ2Uud2FpdEZvckZ1bmN0aW9uKCgpID0+ICh3aW5kb3cuX19ORU9OLnN0YXRzKCkgYXMgU3RhdHMpLmFtbW8gPT09IDEyLCB1bmRlZmluZWQsIHtcbiAgICB0aW1lb3V0OiAzMF8wMDAsXG4gIH0pO1xuXG4gIC8vIC0tLSBHUFUgcmVzb3VyY2VzIGNvbnZlcmdlIGluc3RlYWQgb2YgZ3Jvd2luZyBmb3JldmVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICBjb25zdCB3YXJtID0gYXdhaXQga2lsbEVuZW1pZXMocGFnZSwgNCwgMTIwXzAwMCk7XG4gIGF3YWl0IHdhcm1VcChwYWdlKTtcbiAgY29uc3QgZmlyc3QgPSBhd2FpdCByZW5kZXJJbmZvKHBhZ2UpO1xuXG4gIGNvbnN0IG1pZCA9IGF3YWl0IGtpbGxFbmVtaWVzKHBhZ2UsIHdhcm0gKyA4LCAxODBfMDAwKTtcbiAgYXdhaXQgd2FybVVwKHBhZ2UpO1xuICBjb25zdCBzZWNvbmQgPSBhd2FpdCByZW5kZXJJbmZvKHBhZ2UpO1xuXG4gIGNvbnN0IGVuZCA9IGF3YWl0IGtpbGxFbmVtaWVzKHBhZ2UsIG1pZCArIDgsIDE4MF8wMDApO1xuICBhd2FpdCB3YXJtVXAocGFnZSk7XG4gIGNvbnN0IHRoaXJkID0gYXdhaXQgcmVuZGVySW5mbyhwYWdlKTtcblxuICAvLyBCZWZvcmUgdGhlIHJld3JpdGUgZXZlcnkgZW5lbXkgbGVha2VkIHR3byBoZWFsdGgtYmFyIGdlb21ldHJpZXMuXG4gIGV4cGVjdChcbiAgICB0aGlyZC5nZW9tZXRyaWVzIC0gc2Vjb25kLmdlb21ldHJpZXMsXG4gICAgYGdlb21ldHJpZXMgJHtmaXJzdC5nZW9tZXRyaWVzfSAtPiAke3NlY29uZC5nZW9tZXRyaWVzfSAtPiAke3RoaXJkLmdlb21ldHJpZXN9IG92ZXIgJHtlbmQgLSBtaWR9IGtpbGxzYCxcbiAgKS50b0JlKDApO1xuICBleHBlY3QodGhpcmQudGV4dHVyZXMgLSBzZWNvbmQudGV4dHVyZXMsIGB0ZXh0dXJlcyAke3NlY29uZC50ZXh0dXJlc30gLT4gJHt0aGlyZC50ZXh0dXJlc31gKS50b0JlKDApO1xuXG4gIC8vIC0tLSBkYW1hZ2UgYW5kIGRlYXRoIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gIC8vIFBhcmsgdGhlIG1vYnMgZmlyc3Q6IHRoaXMgY2hlY2sgaXMgYWJvdXQgdGhlIGRhbWFnZSBwYXRoLCBub3QgYWJvdXRcbiAgLy8gc3Vydml2aW5nIHRoZSBraWxsIHBoYXNlLCBhbmQgYSBzdHJheSBtZWxlZSBpbiB0aGUgc2FtcGxlIHdpbmRvdyB3b3VsZFxuICAvLyBza2V3IHRoZSBkZWx0YS5cbiAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB3aW5kb3cuX19ORU9OLnRlbGVwb3J0RW5lbWllcygyNikpO1xuICBhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDIwMCk7XG4gIGNvbnN0IGhwQmVmb3JlSGl0ID0gKGF3YWl0IHN0YXRzKHBhZ2UpKS5ocDtcbiAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB3aW5kb3cuX19ORU9OLmh1cnQoMzApKTtcbiAgYXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgxNTApO1xuICBleHBlY3QoKGF3YWl0IHN0YXRzKHBhZ2UpKS5ocCkudG9CZUNsb3NlVG8oaHBCZWZvcmVIaXQgLSAzMCwgMyk7XG5cbiAgLy8gQ2xpY2tzIGluc2lkZSB0aGUgb3BlbiBzZXR0aW5ncyBwYW5lbCBtdXN0IG5vdCByZS1sb2NrIHRoZSBwb2ludGVyOiB0aGF0XG4gIC8vIHJlc3VtZXMgdGhlIGdhbWUgdW5kZXJuZWF0aCB0aGUgcGFuZWwgYW5kIHN3YWxsb3dzIHRoZSBjdXJzb3IsIHdoaWNoIGlzXG4gIC8vIHdoYXQgbWFkZSB0aGUgcGFuZWwgbG9vayB1bmNsaWNrYWJsZS5cbiAgYXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnS2V5QycpO1xuICBhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDIwMCk7XG4gIGF3YWl0IHBhZ2UubG9jYXRvcignI3ByZXNldExpc3QgLnByZXNldCcpLm50aCgyKS5jbGljaygpOyAvLyBDSVJDTEVcbiAgYXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgyNTApO1xuICBleHBlY3QoYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiBkb2N1bWVudC5wb2ludGVyTG9ja0VsZW1lbnQpKS50b0JlTnVsbCgpO1xuICBleHBlY3QoXG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2V0dGluZ3NTY3JlZW4nKT8uY2xhc3NMaXN0LmNvbnRhaW5zKCd2aXNpYmxlJykpLFxuICApLnRvQmUodHJ1ZSk7XG4gIC8vIE9wZW5pbmcgdGhlIHBhbmVsIG1pZC1nYW1lIHJlbGVhc2VzIHBvaW50ZXIgbG9jaywgd2hpY2ggcGF1c2VzIOKAlCBhbmQgaXQgbXVzdFxuICAvLyBzdGF5IHBhdXNlZDogcmUtbG9ja2luZyBoZXJlIGlzIHdoYXQgbWFkZSB0aGUgcGFuZWwgbG9vayB1bmNsaWNrYWJsZS5cbiAgZXhwZWN0KChhd2FpdCBzdGF0cyhwYWdlKSkuc3RhdGUpLnRvQmUoJ3BhdXNlZCcpO1xuICAvLyBUaGUgdmlld21vZGVsIG11c3Qgc3Vydml2ZSB0aGUgcGF1c2UsIG5vdCBqdXN0IHRoZSByZXN1bWUuXG4gIGV4cGVjdChhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IHdpbmRvdy5fX05FT04uZ3VuVmlzaWJsZSgpKSkudG9CZSh0cnVlKTtcbiAgYXdhaXQgcGFnZS5rZXlib2FyZC5wcmVzcygnRXNjYXBlJyk7XG4gIGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMjAwKTtcbiAgZXhwZWN0KChhd2FpdCBjcm9zc2hhaXIocGFnZSkpLnNoYXBlKS50b0JlKCdjaXJjbGUnKTsgLy8gdGhlIHByZXNldCBjbGljayBsYW5kZWRcblxuICAvLyBSZXN1bWUgdGhlIHdheSBhIHBsYXllciBkb2VzIOKAlCBhIGJhcmUgY2xpY2sgcmUtYWNxdWlyZXMgdGhlIHBvaW50ZXIgbG9jay5cbiAgYXdhaXQgcGFnZS5tb3VzZS5jbGljayg2NDAsIDM2MCk7XG4gIGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMzAwKTtcbiAgZXhwZWN0KChhd2FpdCBzdGF0cyhwYWdlKSkuc3RhdGUpLnRvQmUoJ3BsYXlpbmcnKTtcbiAgZXhwZWN0KGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4gd2luZG93Ll9fTkVPTi5ndW5WaXNpYmxlKCkpKS50b0JlKHRydWUpO1xuXG4gIC8vIC0tLSBtaW5pbWFwIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAvLyBBIGNhbnZhcyB0aGF0IGlzIHdpcmVkIHVwIGJ1dCBuZXZlciBwYWludGVkIGlzIHRoZSBmYWlsdXJlIHRoaXMgY2F0Y2hlcy5cbiAgY29uc3QgbWluaW1hcExpdCA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4ge1xuICAgIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbWluaW1hcCcpIGFzIEhUTUxDYW52YXNFbGVtZW50IHwgbnVsbDtcbiAgICBjb25zdCBjdHggPSBjPy5nZXRDb250ZXh0KCcyZCcpO1xuICAgIGlmICghYyB8fCAhY3R4KSByZXR1cm4gLTE7XG4gICAgY29uc3QgZCA9IGN0eC5nZXRJbWFnZURhdGEoMCwgMCwgYy53aWR0aCwgYy5oZWlnaHQpLmRhdGE7XG4gICAgbGV0IGxpdCA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDM7IGkgPCBkLmxlbmd0aDsgaSArPSA0KSBpZiAoKGRbaV0gPz8gMCkgPiA4KSBsaXQrKztcbiAgICByZXR1cm4gbGl0O1xuICB9KTtcbiAgZXhwZWN0KG1pbmltYXBMaXQpLnRvQmVHcmVhdGVyVGhhbig1MDApO1xuXG4gIC8vIEhlYWRyb29tOiB0aGUgYm9tYiBjaGVja3MgYmVsb3cgc3RhbmQgc3RpbGwgb24gcHVycG9zZS5cbiAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB3aW5kb3cuX19ORU9OLmh1cnQoLTUwKSk7XG5cbiAgLy8gLS0tIHRoZSBib21iIHdhcm5zLCBhbmQgY2FuIGJlIHNob3Qgb3V0IG9mIHRoZSBhaXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICBjb25zdCBzcG90ID0gYXdhaXQgY2FtKHBhZ2UpO1xuICBhd2FpdCBwYWdlLmV2YWx1YXRlKChwKSA9PiB3aW5kb3cuX19ORU9OLnNwYXduQm9tYihwLnggKyAyLCBwLnopLCB7IHg6IHNwb3QucHgsIHo6IHNwb3QucHogfSk7XG4gIGF3YWl0IHBhZ2Uud2FpdEZvckZ1bmN0aW9uKCgpID0+ICh3aW5kb3cuX19ORU9OLmJvbWJzKCkgYXMgbnVtYmVyW10pLmxlbmd0aCA9PT0gMSwgdW5kZWZpbmVkLCB7XG4gICAgdGltZW91dDogNTAwMCxcbiAgfSk7XG4gIC8vIEEgd2FybmluZyB3aGlsZSB0aGUgZnVzZSBidXJuczogYSBzaWxlbnQgYm9tYiB3b3VsZCBiZSBhIGNoZWFwIGRlYXRoLlxuICBhd2FpdCBwYWdlLndhaXRGb3JGdW5jdGlvbihcbiAgICAoKSA9PiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYm9tYldhcm4nKT8uY2xhc3NMaXN0LmNvbnRhaW5zKCdvbicpID09PSB0cnVlLFxuICAgIHVuZGVmaW5lZCxcbiAgICB7IHRpbWVvdXQ6IDUwMDAgfSxcbiAgKTtcbiAgZXhwZWN0KGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2JvbWJXYXJuJyk/LmNsYXNzTGlzdC5jb250YWlucygnb24nKSkpLnRvQmUodHJ1ZSk7XG5cbiAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB3aW5kb3cuX19ORU9OLnRlbGVwb3J0RW5lbWllcygyNCkpOyAvLyBjbGVhciB0aGUgZmlyaW5nIGxpbmVcbiAgY29uc3Qgc2NvcmVCZWZvcmVTaG90ID0gKGF3YWl0IHN0YXRzKHBhZ2UpKS5zY29yZTtcbiAgYXdhaXQgcGFnZS5ldmFsdWF0ZShcbiAgICAocCkgPT4ge1xuICAgICAgY29uc3QgYyA9IHdpbmRvdy5fX05FT04uY2FtU3RhdGUoKSBhcyBDYW1TdGF0ZTtcbiAgICAgIGNvbnN0IGQgPSBNYXRoLmh5cG90KHAueCAtIGMucHgsIHAueiAtIGMucHopO1xuICAgICAgd2luZG93Ll9fTkVPTi5haW0oTWF0aC5hdGFuMigtKHAueCAtIGMucHgpLCAtKHAueiAtIGMucHopKSwgTWF0aC5hdGFuMigwLjM1IC0gYy5weSwgZCkpO1xuICAgIH0sXG4gICAgeyB4OiBzcG90LnB4ICsgMiwgejogc3BvdC5weiB9LFxuICApO1xuICBhd2FpdCBwYWdlLm1vdXNlLmRvd24oKTtcbiAgYXdhaXQgcGFnZS53YWl0Rm9yRnVuY3Rpb24oKCkgPT4gKHdpbmRvdy5fX05FT04uYm9tYnMoKSBhcyBudW1iZXJbXSkubGVuZ3RoID09PSAwLCB1bmRlZmluZWQsIHtcbiAgICB0aW1lb3V0OiAyMF8wMDAsXG4gIH0pO1xuICBhd2FpdCBwYWdlLm1vdXNlLnVwKCk7XG4gIGV4cGVjdCgoYXdhaXQgc3RhdHMocGFnZSkpLnNjb3JlKS50b0JlR3JlYXRlclRoYW4oc2NvcmVCZWZvcmVTaG90KTtcblxuICAvLyAtLS0gbGVmdCBhbG9uZSwgdGhlIGZ1c2UgcnVucyBvdXQgYW5kIHRoZSBibGFzdCByZWFjaGVzIHRoZSBwbGF5ZXIgLS0tLS0tLS0tXG4gIGNvbnN0IGhwQmVmb3JlRnVzZSA9IChhd2FpdCBzdGF0cyhwYWdlKSkuaHA7XG4gIGNvbnN0IHNwb3QyID0gYXdhaXQgY2FtKHBhZ2UpO1xuICBhd2FpdCBwYWdlLmV2YWx1YXRlKChwKSA9PiB3aW5kb3cuX19ORU9OLnNwYXduQm9tYihwLnggKyAyLCBwLnopLCB7IHg6IHNwb3QyLnB4LCB6OiBzcG90Mi5weiB9KTtcbiAgYXdhaXQgcGFnZS53YWl0Rm9yRnVuY3Rpb24oXG4gICAgKGhwKSA9PiAod2luZG93Ll9fTkVPTi5ib21icygpIGFzIG51bWJlcltdKS5sZW5ndGggPT09IDAgJiYgKHdpbmRvdy5fX05FT04uc3RhdHMoKSBhcyBTdGF0cykuaHAgPCBocCxcbiAgICBocEJlZm9yZUZ1c2UsXG4gICAgeyB0aW1lb3V0OiAyMF8wMDAgfSxcbiAgKTtcbiAgZXhwZWN0KChhd2FpdCBzdGF0cyhwYWdlKSkuaHApLnRvQmVMZXNzVGhhbihocEJlZm9yZUZ1c2UpO1xuICBleHBlY3QoYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYm9tYldhcm4nKT8uY2xhc3NMaXN0LmNvbnRhaW5zKCdvbicpKSkudG9CZShcbiAgICBmYWxzZSxcbiAgKTtcblxuICAvLyAtLS0gdGhlIHNhcHBlciBqb2lucyBmcm9tIHdhdmUgNSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB3aW5kb3cuX19ORU9OLmZvcmNlV2F2ZSg1KSk7XG4gIGF3YWl0IHBhZ2Uud2FpdEZvckZ1bmN0aW9uKFxuICAgICgpID0+ICh3aW5kb3cuX19ORU9OLmVuZW15UG9zKCkgYXMgRW5lbXlQb3NbXSkuc29tZSgoZSkgPT4gZS5raW5kID09PSAnc2FwcGVyJyksXG4gICAgdW5kZWZpbmVkLFxuICAgIHsgdGltZW91dDogOTBfMDAwIH0sXG4gICk7XG4gIGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4gd2luZG93Ll9fTkVPTi50ZWxlcG9ydEVuZW1pZXMoMjQpKTtcblxuICBjb25zdCBpbmZvID0gYXdhaXQgcmVuZGVySW5mbyhwYWdlKTtcbiAgZXhwZWN0KGluZm8uY2FsbHMpLnRvQmVHcmVhdGVyVGhhbigwKTtcbiAgY29uc3Qgc2hvdCA9IGF3YWl0IHBhZ2Uuc2NyZWVuc2hvdCgpO1xuICBleHBlY3QobmV3IFNldChzaG90KS5zaXplKS50b0JlR3JlYXRlclRoYW4oMyk7IC8vIG5vdCBhIHVuaWZvcm1seSBibGFjayBmcmFtZVxuXG4gIGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4gd2luZG93Ll9fTkVPTi5odXJ0KDk5OSkpO1xuICBhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDMwMCk7XG4gIGV4cGVjdCgoYXdhaXQgc3RhdHMocGFnZSkpLnN0YXRlKS50b0JlKCdnYW1lb3ZlcicpO1xuICBleHBlY3QoYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB3aW5kb3cuX19ORU9OLmd1blZpc2libGUoKSkpLnRvQmUoZmFsc2UpO1xuXG4gIC8vIC0tLSBjcm9zc2hhaXIgc2V0dGluZ3MgKGxhc3Q6IG9wZW5pbmcgdGhlIHBhbmVsIHBhdXNlcyB0aGUgZ2FtZSkgLS0tLS0tLS0tXG4gIGNvbnN0IHR1bmVkID0gYXdhaXQgc2V0Q3Jvc3NoYWlyKHBhZ2UsIHsgc2hhcGU6ICdjaXJjbGUnLCBjb2xvcjogJyNmZjAwMDAnLCBsaW5lczogZmFsc2UgfSk7XG4gIGV4cGVjdCh0dW5lZC5zaGFwZSkudG9CZSgnY2lyY2xlJyk7XG4gIGV4cGVjdCh0dW5lZC5saW5lcykudG9CZShmYWxzZSk7XG5cbiAgY29uc3QgcGFpbnRlZCA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT5cbiAgICBbJ2Nyb3NzaGFpcicsICdwcmV2aWV3Q3Jvc3MnXS5tYXAoKGlkKSA9PlxuICAgICAgZ2V0Q29tcHV0ZWRTdHlsZShkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkgYXMgSFRNTEVsZW1lbnQpXG4gICAgICAgIC5nZXRQcm9wZXJ0eVZhbHVlKCctLWNvbG9yJylcbiAgICAgICAgLnRyaW0oKSxcbiAgICApLFxuICApO1xuICBleHBlY3QocGFpbnRlZCkudG9FcXVhbChbJyNmZjAwMDAnLCAnI2ZmMDAwMCddKTtcblxuICBleHBlY3QoYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiBsb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnbmVvbi5jcm9zc2hhaXInKSkpLnRvQ29udGFpbignXCJjaXJjbGVcIicpO1xuXG4gIGNvbnN0IGNsYW1wZWQgPSBhd2FpdCBzZXRDcm9zc2hhaXIocGFnZSwgeyBsaW5lTGVuOiA5OTk5LCBzaGFwZTogJ25vcGUnLCBjb2xvcjogJ3JlZCcgfSk7XG4gIGV4cGVjdChjbGFtcGVkLmxpbmVMZW4pLnRvQmUoMzApO1xuICBleHBlY3QoY2xhbXBlZC5zaGFwZSkudG9CZSgnbm9uZScpO1xuICBleHBlY3QoY2xhbXBlZC5jb2xvcikudG9CZSgnIzQ2ZTBmZicpO1xuXG4gIGF3YWl0IHBhZ2Uua2V5Ym9hcmQucHJlc3MoJ0tleUMnKTtcbiAgYXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgyMDApO1xuICBjb25zdCBvcGVuVmlzaWJsZSA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT5cbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2V0dGluZ3NTY3JlZW4nKT8uY2xhc3NMaXN0LmNvbnRhaW5zKCd2aXNpYmxlJyksXG4gICk7XG4gIGV4cGVjdChvcGVuVmlzaWJsZSkudG9CZSh0cnVlKTtcbiAgY29uc3QgcHJldmlldyA9IGF3YWl0IGNyb3NzaGFpcihwYWdlKTtcbiAgZXhwZWN0KHByZXZpZXcuY29sb3IpLnRvQmUoJyM0NmUwZmYnKTtcblxuICBhd2FpdCBwYWdlLmtleWJvYXJkLnByZXNzKCdFc2NhcGUnKTtcbiAgYXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dCgyMDApO1xuICBjb25zdCBjbG9zZWRWaXNpYmxlID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PlxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZXR0aW5nc1NjcmVlbicpPy5jbGFzc0xpc3QuY29udGFpbnMoJ3Zpc2libGUnKSxcbiAgKTtcbiAgZXhwZWN0KGNsb3NlZFZpc2libGUpLnRvQmUoZmFsc2UpO1xufSk7XG4iXSwibWFwcGluZ3MiOiJBQUFBLFNBQVNBLE1BQU0sRUFBYUMsSUFBSSxRQUFRLGtCQUFrQjs7QUFFMUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUF3Q0EsTUFBTUMsS0FBSyxHQUFJQyxJQUFVLElBQUtBLElBQUksQ0FBQ0MsUUFBUSxDQUFDLE1BQU1DLE1BQU0sQ0FBQ0MsTUFBTSxDQUFDSixLQUFLLENBQUMsQ0FBVSxDQUFDO0FBQ2pGLE1BQU1LLE9BQU8sR0FBSUosSUFBVSxJQUFLQSxJQUFJLENBQUNDLFFBQVEsQ0FBQyxNQUFNQyxNQUFNLENBQUNDLE1BQU0sQ0FBQ0UsUUFBUSxDQUFDLENBQWUsQ0FBQztBQUMzRixNQUFNQyxHQUFHLEdBQUlOLElBQVUsSUFBS0EsSUFBSSxDQUFDQyxRQUFRLENBQUMsTUFBTUMsTUFBTSxDQUFDQyxNQUFNLENBQUNJLFFBQVEsQ0FBQyxDQUFhLENBQUM7QUFDckYsTUFBTUMsVUFBVSxHQUFJUixJQUFVLElBQUtBLElBQUksQ0FBQ0MsUUFBUSxDQUFDLE1BQU1DLE1BQU0sQ0FBQ0MsTUFBTSxDQUFDSyxVQUFVLENBQUMsQ0FBZSxDQUFDO0FBQ2hHLE1BQU1DLFlBQVksR0FBR0EsQ0FBQ1QsSUFBVSxFQUFFVSxLQUE4QixLQUM5RFYsSUFBSSxDQUFDQyxRQUFRLENBQUVVLENBQUMsSUFBS1QsTUFBTSxDQUFDQyxNQUFNLENBQUNNLFlBQVksQ0FB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