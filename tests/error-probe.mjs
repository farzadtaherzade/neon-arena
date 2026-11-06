/** One-shot: open the dev server, print every console error + page error. */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, m.text().slice(0, 300));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.stack ?? String(e).slice(0, 600)));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
console.log('--- settle done ---');
await browser.close();
