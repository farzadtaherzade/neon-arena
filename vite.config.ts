import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

/** Short git hash of the working tree; 'dev' when git is unavailable. */
const gitHash = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();

export default defineConfig({
  base: './',
  // One version string for the whole game: package.json + the commit built from.
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version}+${gitHash}`),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // single-boot game: one chunk is intended, just stay above its ~538 kB size
    chunkSizeWarningLimit: 600,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
