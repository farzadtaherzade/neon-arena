import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, versionParts } from '../../src/version';

/**
 * The version is written in three places that must agree: package.json (the
 * source of truth vite injects), the changelog (what a release announces) and
 * the build (APP_VERSION). This suite pins them together.
 */
describe('game version', () => {
  it('matches the latest changelog entry', () => {
    const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };
    const changelog = readFileSync('./CHANGELOG.md', 'utf8');
    const latest = changelog.match(/^## \[(.+?)\]/m)?.[1];
    expect(latest, 'CHANGELOG.md needs an entry for the current version').toBe(pkg.version);
  });

  it('is a semver + hash pair, and the parts split cleanly', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]+|\d+\.\d+\.\d+\+dev$/);
    const { version, hash } = versionParts();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(hash.length).toBeGreaterThan(0);
  });
});
