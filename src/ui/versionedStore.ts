/**
 * Versioned storage envelopes.
 *
 * Every persisted key holds `{ v, data }` — `v` is the schema version of the
 * payload inside `data`. Reads migrate old payloads forward and sanitize
 * through the owner's own validator; writes always stamp the latest version.
 *
 * The version lives OUTSIDE the payload on purpose: the settings and profile
 * sanitisers rebuild their bundles from whitelisted fields and strip anything
 * else, so a version field inside the bundle would not survive a round trip.
 *
 * Migration policy:
 * - A bare payload (no `v`) is treated as v1 — the pre-envelope formats.
 * - When `v` is newer than `latest`, the data is still sanitized best-effort
 *   but storage is never written back — a build must not downgrade what a
 *   newer one saved. (Migrations for v < latest chain at the same seam when a
 *   transform is actually needed; wrapping v1 required none.)
 */

export type VersionedReader = Pick<Storage, 'getItem'>;
export type VersionedWriter = Pick<Storage, 'setItem'>;

/** Read `key`, migrate and sanitize. Null when absent or corrupt. */
export function loadVersioned<T>(
  store: VersionedReader,
  key: string,
  latest: number,
  sanitize: (raw: unknown) => T,
): T | null {
  let parsed: unknown;
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  // A bare payload predates the envelope: it is v1 data, not a wrapper.
  const version = typeof o.v === 'number' && 'data' in o ? o.v : 1;
  const data = 'data' in o ? o.data : parsed;
  if (version > latest) return sanitize(data);
  return sanitize(data);
}

/** Stamp `data` with the latest schema version and write it. */
export function saveVersioned<T>(store: VersionedWriter, key: string, latest: number, data: T): void {
  try {
    store.setItem(key, JSON.stringify({ v: latest, data }));
  } catch {
    // Storage blocked or full — the value still counts for this session.
  }
}
