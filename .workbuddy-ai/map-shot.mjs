import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:4173/?test', { waitUntil: 'load' });
await page.waitForFunction(() => window.__NEON !== undefined, undefined, { timeout: 20000 });
await page.evaluate(() => {
  document.getElementById('hud').style.display='none';
  for (const el of document.querySelectorAll('.screen')) el.classList.remove('visible');
  window.__NEON.teleportPlayer(0, 0, 78);
  window.__NEON.aim(0, -1.45);
  window.__keep = setInterval(() => window.__NEON.teleportPlayer(0, 0, 78), 10);
});
await page.waitForTimeout(1500);
await page.screenshot({ path: '.workbuddy-ai/map-before.png' });
await page.evaluate(() => clearInterval(window.__keep));
await browser.close();
