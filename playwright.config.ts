import { defineConfig } from '@playwright/test';

/**
 * E2E runs against the production build, not the dev server, so the bundle and
 * asset paths are what users get. SwiftShader keeps it working on machines with
 * no GPU; the game is happy with the slower frame rate.
 *
 * shortcut: pinned to the system Chrome (channel: 'chrome') because Playwright's
 * own Chromium download is blocked on this machine. Drop the channel line once
 * `npx playwright install chromium` can reach the CDN.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 720 },
    channel: 'chrome',
    launchOptions: {
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
