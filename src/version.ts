declare const __APP_VERSION__: string;

/**
 * The game's version, injected at build time by vite (`package.json` version +
 * the short git hash). The fallback keeps the unit suite — which runs without
 * the define — honest instead of crashing.
 */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0+dev';

/** Split `2.1.0+abc1234` into its release version and build hash. */
export function versionParts(): { version: string; hash: string } {
  const i = APP_VERSION.indexOf('+');
  return i < 0
    ? { version: APP_VERSION, hash: 'dev' }
    : { version: APP_VERSION.slice(0, i), hash: APP_VERSION.slice(i + 1) };
}
