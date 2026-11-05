/**
 * Lightpanda smoke check — a raw-CDP probe, separate from the Playwright suite.
 *
 * Lightpanda (lightpanda-io/browser) speaks CDP but not Playwright's own
 * protocol, so the main suite cannot `connectOptions` into it; this script
 * uses `chromium.connectOverCDP()` directly instead.
 *
 * Usage:
 *   lightpanda serve --host 127.0.0.1 --port 9222
 *   npm run dev              # or npm run preview for the production build
 *   node tests/lightpanda-check.mjs [url]
 *
 * It asserts the page loads without console errors and the menu screen is
 * visible, then reports whether the WebGL game booted (`window.__NEON`
 * present). Lightpanda's WebGL support is early — a game that renders in
 * Chrome may still fail to boot here, and the report says which it was.
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const errors = [];
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

// Lightpanda's WebGL support is early: the game can't boot there, and that is
// a known condition — reported, not failed.
const known = (e) => e.includes('Error creating WebGL context');

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const title = await page.title();
const menuVisible = await page.evaluate(
  () => document.getElementById('menuScreen')?.classList.contains('visible') ?? false,
);
const gameBooted = await page.evaluate(() => Boolean((window).__NEON));
const canvasPresent = await page.evaluate(() => Boolean(document.querySelector('canvas')));

console.log(`lightpanda check — ${url}`);
console.log(`  title:        ${title}`);
console.log(`  menu visible: ${menuVisible}`);
console.log(`  canvas:       ${canvasPresent}`);
console.log(`  game booted:  ${gameBooted}`);
console.log(`  console errors: ${errors.length} (${errors.filter((e) => !known(e)).length} DOM)`);
for (const e of errors.slice(0, 5)) console.log(`    - ${e.slice(0, 160)}`);

await page.close();
const domErrors = errors.filter((e) => !known(e));
const ok = menuVisible && domErrors.length === 0;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
