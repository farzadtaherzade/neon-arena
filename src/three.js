/**
 * Resilient Three.js loader.
 *
 * Every other module imports this, not a bare `three` specifier, so the game
 * needs no import map and no bundler. Mirrors the original behaviour: try
 * jsdelivr, fall back to unpkg, then surface the on-page error panel.
 */

const SOURCES = [
  'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
  'https://unpkg.com/three@0.170.0/build/three.module.js',
];

async function load() {
  let lastError = null;
  for (const url of SOURCES) {
    try {
      return await import(url);
    } catch (err) {
      lastError = err;
    }
  }
  const panel = document.getElementById('loadErr');
  if (panel) panel.style.display = 'block';
  throw lastError;
}

export default await load();