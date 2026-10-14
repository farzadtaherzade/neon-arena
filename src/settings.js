import { STATE } from './config.js';

/**
 * Crosshair settings: presets, live tuning and persistence.
 *
 * The panel is reachable from every screen (SETTINGS buttons, or the C key),
 * and its preview is a second instance of the exact markup the HUD uses, so
 * `renderCrosshair` below is the only place that knows what a crosshair is.
 */

const KEY = 'neon.crosshair';
const SVG_NS = 'http://www.w3.org/2000/svg';

export const DEFAULTS = {
  lines: true,
  lineLen: 10,
  lineThick: 2,
  gap: 8,
  dot: true,
  dotSize: 3,
  shape: 'none',
  shapeSize: 26,
  outline: false,
  outlineWidth: 2,
  color: '#46e0ff',
  outlineColor: '#000000',
  bloom: true,
  dimStill: true,
};

const PRESETS = [
  { name: 'DEFAULT', values: {} },
  { name: 'DOT', values: { lines: false, dotSize: 4 } },
  { name: 'CIRCLE', values: { lines: false, shape: 'circle', shapeSize: 20, gap: 0 } },
  { name: 'TRIANGLE', values: { shape: 'triangle', shapeSize: 28, lineLen: 5, dot: false } },
  { name: 'SQUARE', values: { shape: 'square', shapeSize: 28, dot: false, outline: true } },
  { name: 'DIAMOND', values: { shape: 'diamond', shapeSize: 26, lineLen: 6 } },
  { name: 'CROSS', values: { lineLen: 18, lineThick: 3, gap: 14, dot: false, outline: true } },
];

const SWATCHES = ['#46e0ff', '#3dffa0', '#ff3b4e', '#ffc53d', '#ffffff', '#ff5ce0'];

const LIMITS = {
  lineLen: [2, 30], lineThick: [1, 8], gap: [0, 40],
  dotSize: [1, 12], shapeSize: [10, 80], outlineWidth: [1, 4],
};

const TOGGLES = ['lines', 'dot', 'outline', 'bloom', 'dimStill'];
const SHAPES = ['none', 'circle', 'triangle', 'square', 'diamond'];
const HEX = /^#[0-9a-f]{6}$/i;

// Every knob in the TUNE section. `type` picks the control, `key` the field.
const CONTROLS = [
  { key: 'lines', label: 'Lines', type: 'toggle' },
  { key: 'lineLen', label: 'Length', min: LIMITS.lineLen },
  { key: 'lineThick', label: 'Thickness', min: LIMITS.lineThick },
  { key: 'gap', label: 'Gap', min: LIMITS.gap },
  { key: 'dot', label: 'Centre Dot', type: 'toggle' },
  { key: 'dotSize', label: 'Dot Size', min: LIMITS.dotSize },
  { key: 'shape', label: 'Shape', type: 'select', options: SHAPES },
  { key: 'shapeSize', label: 'Shape Size', min: LIMITS.shapeSize },
  { key: 'outline', label: 'Outline', type: 'toggle' },
  { key: 'outlineWidth', label: 'Outline Width', min: LIMITS.outlineWidth },
  { key: 'color', label: 'Colour', type: 'color' },
  { key: 'outlineColor', label: 'Outline Colour', type: 'color' },
  { key: 'bloom', label: 'Bloom Spread', type: 'toggle' },
  { key: 'dimStill', label: 'Dim When Still', type: 'toggle' },
];

// Hollow outlines for the optional outer shape — SVG strokes stay crisp and
// hollow at any size, which clip-path fills can't do against a 3D background.
const SHAPE_SVG = {
  circle: '<circle cx="50" cy="50" r="47"/>',
  triangle: '<polygon points="50,3 97,97 3,97"/>',
  square: '<rect x="3" y="3" width="94" height="94"/>',
  diamond: '<polygon points="50,3 97,50 50,97 3,50"/>',
};

/** localStorage is user-writable and may be absent, so every field is re-checked. */
function sanitize(raw) {
  const s = { ...DEFAULTS };
  for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(raw?.[key]);
    if (Number.isFinite(v)) s[key] = Math.min(hi, Math.max(lo, v));
  }
  for (const key of TOGGLES) if (typeof raw?.[key] === 'boolean') s[key] = raw[key];
  if (SHAPES.includes(raw?.shape)) s.shape = raw.shape;
  for (const key of ['color', 'outlineColor']) if (HEX.test(raw?.[key])) s[key] = raw[key];
  return s;
}

/**
 * Paints one crosshair element from a settings object. Called on every change
 * (cheap) and never per frame — the HUD only animates --gap on top of this.
 */
export function renderCrosshair(node, s) {
  node.style.setProperty('--gap', s.gap + 'px');
  node.style.setProperty('--len', s.lineLen + 'px');
  node.style.setProperty('--thick', s.lineThick + 'px');
  node.style.setProperty('--dot', s.dotSize + 'px');
  node.style.setProperty('--shape', s.shapeSize + 'px');
  node.style.setProperty('--color', s.color);
  node.style.setProperty('--outline-w', s.outlineWidth + 'px');
  node.style.setProperty('--outline-color', s.outlineColor);

  node.className = 'ch shape-' + s.shape
    + (s.lines ? '' : ' no-lines')
    + (s.dot ? '' : ' no-dot')
    + (s.outline ? ' outline' : '');

  node.replaceChildren();
  if (s.shape !== 'none') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.innerHTML = SHAPE_SVG[s.shape];
    node.appendChild(svg);
  }
  if (s.dot) node.appendChild(el('i', 'dot'));
  if (s.lines) {
    for (const side of ['h l', 'h r', 'v t', 'v b']) node.appendChild(el('i', 'line ' + side));
  }
}

/** Builds a child element; the crosshair is plain `<i>` tags, styled in CSS. */
function el(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

export class Settings {
  constructor(game) {
    this.game = game;
    this.values = sanitize(readStore());
    this.panel = document.getElementById('settingsScreen');
    this.presetList = document.getElementById('presetList');
    this.tuneList = document.getElementById('tuneList');
    this.targets = [game.hud.crosshair, document.getElementById('previewCross')];
    this.inputs = new Map();

    this.buildPresets();
    this.buildTune();
    this.bind();
    this.apply();
  }

  get isOpen() {
    return this.panel.classList.contains('visible');
  }

  // ------------------------------------------------------------------- panel

  buildPresets() {
    this.thumbnails = [];
    this.presetButtons = PRESETS.map(preset => {
      const btn = el('button', 'preset');
      btn.type = 'button';
      const name = el('span', 'pname');
      name.textContent = preset.name;
      const mini = el('span', 'ch');
      this.thumbnails.push(mini);
      btn.append(name, mini);
      btn.addEventListener('click', () => {
        this.values = sanitize({ ...DEFAULTS, ...preset.values });
        this.write();
        this.apply();
      });
      this.presetList.appendChild(btn);
      return btn;
    });
  }

  buildTune() {
    for (const c of CONTROLS) {
      const row = el('div', 'trow');
      const label = el('label', 'tk');
      label.textContent = c.label;
      row.appendChild(label);

      let input;
      if (c.type === 'toggle') {
        input = el('input', 'toggle');
        input.type = 'checkbox';
      } else if (c.type === 'select') {
        input = el('select');
        for (const o of c.options) {
          const opt = el('option');
          opt.value = o;
          opt.textContent = o.toUpperCase();
          input.appendChild(opt);
        }
      } else if (c.type === 'color') {
        input = el('input', 'swatchInput');
        input.type = 'color';
        for (const hex of SWATCHES) {
          const sw = el('button', 'swatch');
          sw.type = 'button';
          sw.style.background = hex;
          sw.addEventListener('click', () => this.set({ [c.key]: hex }));
          row.appendChild(sw);
        }
      } else {
        input = el('input', 'range');
        input.type = 'range';
        input.min = c.min[0];
        input.max = c.min[1];
      }

      const read = () => (c.type === 'toggle' ? input.checked
        : c.type === 'color' ? input.value
        : c.type === 'select' ? input.value
        : Number(input.value));

      input.addEventListener('input', () => this.set({ [c.key]: read() }));

      const out = el('span', 'tv');
      row.append(input, out);
      this.tuneList.appendChild(row);
      this.inputs.set(c.key, { input, out, control: c });
    }
  }

  bind() {
    for (const btn of document.querySelectorAll('[data-settings]')) {
      btn.addEventListener('click', e => {
        // Screens start the game on click — don't let the button bubble into it.
        e.stopPropagation();
        this.open();
      });
    }
    document.getElementById('settingsClose').addEventListener('click', () => this.close());
    document.getElementById('settingsReset').addEventListener('click', () => {
      this.values = { ...DEFAULTS };
      this.write();
      this.apply();
    });
  }

  // ------------------------------------------------------------------ values

  set(patch) {
    this.values = sanitize({ ...this.values, ...patch });
    this.write();
    this.apply();
  }

  write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch { /* private mode / storage full — settings just won't persist */ }
  }

  apply() {
    for (const target of this.targets) renderCrosshair(target, this.values);
    for (const { input, out, control } of this.inputs.values()) {
      const v = this.values[control.key];
      if (control.type === 'toggle') input.checked = v;
      else input.value = v;
      if (out) out.textContent = control.type === 'select' ? ''
        : control.type === 'toggle' ? (v ? 'ON' : 'OFF') : v;
    }
    // Preset thumbnails paint the live values, and the highlight only claims a
    // preset while nothing has been hand-tuned on top of it.
    this.presetButtons.forEach((btn, i) => {
      renderCrosshair(this.thumbnails[i], sanitize({ ...DEFAULTS, ...PRESETS[i].values }));
      btn.classList.toggle('on', same(PRESETS[i].values, this.values, DEFAULTS));
    });
  }

  // ------------------------------------------------------------------ screen

  open() {
    this.panel.classList.add('visible');
    // Dropping pointer lock pauses the run through the normal lock flow, so
    // closing the panel lands the player back on the pause screen.
    if (this.game.state === STATE.PLAYING) this.game.input.release();
  }

  close() {
    this.panel.classList.remove('visible');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }
}

/** True when `values` is still exactly the preset on top of DEFAULTS. */
function same(values, current, defaults) {
  return Object.keys(defaults).every(k => (values[k] ?? defaults[k]) === current[k]);
}

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}