/**
 * Crosshair settings: presets, live tuning and persistence.
 *
 * The panel is reachable from every screen (SETTINGS buttons, or the C key),
 * and its preview is a second instance of the exact markup the HUD uses, so
 * `renderCrosshair` below is the only place that knows what a crosshair is.
 */

const KEY = 'neon.crosshair';
const SVG_NS = 'http://www.w3.org/2000/svg';

export type CrosshairShape = 'none' | 'circle' | 'triangle' | 'square' | 'diamond';

export interface CrosshairSettings {
  lines: boolean;
  lineLen: number;
  lineThick: number;
  gap: number;
  dot: boolean;
  dotSize: number;
  shape: CrosshairShape;
  shapeSize: number;
  outline: boolean;
  outlineWidth: number;
  color: string;
  outlineColor: string;
  bloom: boolean;
  dimStill: boolean;
}

export const DEFAULTS: CrosshairSettings = {
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

const PRESETS: { name: string; values: Partial<CrosshairSettings> }[] = [
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
  lineLen: [2, 30],
  lineThick: [1, 8],
  gap: [0, 40],
  dotSize: [1, 12],
  shapeSize: [10, 80],
  outlineWidth: [1, 4],
} as const satisfies Record<string, readonly [number, number]>;

const TOGGLES = [
  'lines',
  'dot',
  'outline',
  'bloom',
  'dimStill',
] as const satisfies readonly (keyof CrosshairSettings)[];
const SHAPES: readonly CrosshairShape[] = ['none', 'circle', 'triangle', 'square', 'diamond'];
const HEX = /^#[0-9a-f]{6}$/i;

type NumericKey = keyof typeof LIMITS;

/** Every knob in the TUNE section. `type` picks the control, `key` the field. */
type Control =
  | { key: NumericKey; label: string; type: 'number'; min: readonly [number, number] }
  | { key: (typeof TOGGLES)[number]; label: string; type: 'toggle' }
  | { key: 'shape'; label: string; type: 'select'; options: readonly CrosshairShape[] }
  | { key: 'color' | 'outlineColor'; label: string; type: 'color' };

const CONTROLS: Control[] = [
  { key: 'lines', label: 'Lines', type: 'toggle' },
  { key: 'lineLen', label: 'Length', type: 'number', min: LIMITS.lineLen },
  { key: 'lineThick', label: 'Thickness', type: 'number', min: LIMITS.lineThick },
  { key: 'gap', label: 'Gap', type: 'number', min: LIMITS.gap },
  { key: 'dot', label: 'Centre Dot', type: 'toggle' },
  { key: 'dotSize', label: 'Dot Size', type: 'number', min: LIMITS.dotSize },
  { key: 'shape', label: 'Shape', type: 'select', options: SHAPES },
  { key: 'shapeSize', label: 'Shape Size', type: 'number', min: LIMITS.shapeSize },
  { key: 'outline', label: 'Outline', type: 'toggle' },
  { key: 'outlineWidth', label: 'Outline Width', type: 'number', min: LIMITS.outlineWidth },
  { key: 'color', label: 'Colour', type: 'color' },
  { key: 'outlineColor', label: 'Outline Colour', type: 'color' },
  { key: 'bloom', label: 'Bloom Spread', type: 'toggle' },
  { key: 'dimStill', label: 'Dim When Still', type: 'toggle' },
];

/**
 * Fold untrusted input onto DEFAULTS. localStorage is user-writable and may be
 * absent, corrupt, or from an older version, so every field is re-checked.
 */
export function sanitizeSettings(raw: unknown): CrosshairSettings {
  const src = (raw ?? {}) as Record<string, unknown>;
  const s: CrosshairSettings = { ...DEFAULTS };

  for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(src[key]);
    if (Number.isFinite(v)) (s as unknown as Record<string, number>)[key] = Math.min(hi, Math.max(lo, v));
  }
  for (const key of TOGGLES) if (typeof src[key] === 'boolean') s[key] = src[key] as boolean;
  if (SHAPES.includes(src.shape as CrosshairShape)) s.shape = src.shape as CrosshairShape;
  for (const key of ['color', 'outlineColor'] as const) {
    if (HEX.test(String(src[key]))) s[key] = String(src[key]);
  }
  return s;
}

export function readSettings(store: Pick<Storage, 'getItem'>): CrosshairSettings {
  try {
    return sanitizeSettings(JSON.parse(store.getItem(KEY) || 'null'));
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(store: Pick<Storage, 'setItem'>, values: CrosshairSettings): void {
  try {
    store.setItem(KEY, JSON.stringify(values));
  } catch {
    // Private mode / storage full — settings just won't persist.
  }
}

/** Builds a child element; the crosshair is plain `<i>` tags, styled in CSS. */
function el(tag: string, cls?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

/**
 * Paints one crosshair element from a settings object. Called on every change
 * (cheap) and never per frame — the HUD only animates --gap on top of this.
 */
export function renderCrosshair(node: HTMLElement, s: CrosshairSettings): void {
  node.style.setProperty('--gap', `${s.gap}px`);
  node.style.setProperty('--len', `${s.lineLen}px`);
  node.style.setProperty('--thick', `${s.lineThick}px`);
  node.style.setProperty('--dot', `${s.dotSize}px`);
  node.style.setProperty('--shape', `${s.shapeSize}px`);
  node.style.setProperty('--color', s.color);
  node.style.setProperty('--outline-w', `${s.outlineWidth}px`);
  node.style.setProperty('--outline-color', s.outlineColor);

  node.className =
    `ch shape-${s.shape}` +
    (s.lines ? '' : ' no-lines') +
    (s.dot ? '' : ' no-dot') +
    (s.outline ? ' outline' : '');

  node.replaceChildren();
  if (s.shape !== 'none') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.innerHTML = SHAPE_SVG[s.shape];
    node.appendChild(svg);
  }
  if (s.dot) node.appendChild(el('i', 'dot'));
  if (s.lines) {
    for (const side of ['h l', 'h r', 'v t', 'v b']) node.appendChild(el('i', `line ${side}`));
  }
}

/**
 * Hollow outlines for the optional outer shape — SVG strokes stay crisp and
 * hollow at any size, which clip-path fills can't do against a 3D background.
 */
const SHAPE_SVG: Record<Exclude<CrosshairShape, 'none'>, string> = {
  circle: '<circle cx="50" cy="50" r="47"/>',
  triangle: '<polygon points="50,3 97,97 3,97"/>',
  square: '<rect x="3" y="3" width="94" height="94"/>',
  diamond: '<polygon points="50,3 97,50 50,97 3,50"/>',
};

/** True when `values` is still exactly the preset on top of DEFAULTS. */
function same(values: Partial<CrosshairSettings>, current: CrosshairSettings): boolean {
  return (Object.keys(DEFAULTS) as (keyof CrosshairSettings)[]).every(
    (k) => (values[k] ?? DEFAULTS[k]) === current[k],
  );
}

interface Bound {
  input: HTMLInputElement | HTMLSelectElement;
  out: HTMLElement;
  control: Control;
}

export interface SettingsHooks {
  /** Called when the panel opens — the game drops pointer lock, which pauses. */
  onOpen(): void;
  onChange(values: CrosshairSettings): void;
}

export class Settings {
  values: CrosshairSettings;
  private panel = document.getElementById('settingsScreen')!;
  private presetList = document.getElementById('presetList')!;
  private tuneList = document.getElementById('tuneList')!;
  private targets: HTMLElement[];
  private inputs = new Map<string, Bound>();
  private presetButtons: HTMLElement[] = [];
  private thumbnails: HTMLElement[] = [];

  constructor(
    hudCrosshair: HTMLElement,
    private readonly hooks: SettingsHooks,
    private readonly store: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
  ) {
    this.values = readSettings(store);
    this.targets = [hudCrosshair, document.getElementById('previewCross')!];

    this.buildPresets();
    this.buildTune();
    this.bind();
    this.apply();
  }

  get isOpen(): boolean {
    return this.panel.classList.contains('visible');
  }

  // ------------------------------------------------------------------- panel

  private buildPresets(): void {
    this.presetButtons = PRESETS.map((preset) => {
      const btn = el('button', 'preset');
      btn.setAttribute('type', 'button');
      const name = el('span', 'pname');
      name.textContent = preset.name;
      const mini = el('span', 'ch');
      this.thumbnails.push(mini);
      btn.append(name, mini);
      btn.addEventListener('click', () => {
        this.values = sanitizeSettings({ ...DEFAULTS, ...preset.values });
        this.commit();
      });
      this.presetList.appendChild(btn);
      return btn;
    });
  }

  private buildTune(): void {
    for (const c of CONTROLS) {
      const row = el('div', 'trow');
      const label = el('label', 'tk');
      label.textContent = c.label;
      row.appendChild(label);

      let input: HTMLInputElement | HTMLSelectElement;
      if (c.type === 'toggle') {
        input = el('input', 'toggle') as HTMLInputElement;
        input.type = 'checkbox';
      } else if (c.type === 'select') {
        input = el('select') as HTMLSelectElement;
        for (const o of c.options) {
          const opt = el('option') as HTMLOptionElement;
          opt.value = o;
          opt.textContent = o.toUpperCase();
          input.appendChild(opt);
        }
      } else if (c.type === 'color') {
        input = el('input', 'swatchInput') as HTMLInputElement;
        input.type = 'color';
        for (const hex of SWATCHES) {
          const sw = el('button', 'swatch');
          sw.setAttribute('type', 'button');
          sw.style.background = hex;
          sw.addEventListener('click', () => this.set({ [c.key]: hex }));
          row.appendChild(sw);
        }
      } else {
        input = el('input', 'range') as HTMLInputElement;
        input.type = 'range';
        input.min = String(c.min[0]);
        input.max = String(c.min[1]);
      }

      const read = (): CrosshairSettings[keyof CrosshairSettings] => {
        if (c.type === 'toggle') return (input as HTMLInputElement).checked;
        if (c.type === 'color' || c.type === 'select') return input.value;
        return Number(input.value);
      };

      input.addEventListener('input', () => this.set({ [c.key]: read() }));

      const out = el('span', 'tv');
      row.append(input, out);
      this.tuneList.appendChild(row);
      this.inputs.set(c.key, { input, out, control: c });
    }
  }

  private bind(): void {
    for (const btn of document.querySelectorAll('[data-settings]')) {
      btn.addEventListener('click', (e) => {
        // Screens start the game on click — don't let the button bubble into it.
        e.stopPropagation();
        this.open();
      });
    }
    document.getElementById('settingsClose')!.addEventListener('click', () => this.close());
    document.getElementById('settingsReset')!.addEventListener('click', () => {
      this.values = { ...DEFAULTS };
      this.commit();
    });
  }

  // ------------------------------------------------------------------ values

  set(patch: Partial<CrosshairSettings>): void {
    this.values = sanitizeSettings({ ...this.values, ...patch });
    this.commit();
  }

  private commit(): void {
    writeSettings(this.store, this.values);
    this.apply();
  }

  private apply(): void {
    for (const target of this.targets) renderCrosshair(target, this.values);
    for (const { input, out, control } of this.inputs.values()) {
      const v = this.values[control.key];
      if (control.type === 'toggle') (input as HTMLInputElement).checked = v as boolean;
      else input.value = String(v);
      out.textContent =
        control.type === 'select' ? '' : control.type === 'toggle' ? (v ? 'ON' : 'OFF') : String(v);
    }
    // Preset thumbnails paint the preset's own values, and the highlight only
    // claims a preset while nothing has been hand-tuned on top of it.
    this.presetButtons.forEach((btn, i) => {
      renderCrosshair(this.thumbnails[i]!, sanitizeSettings({ ...DEFAULTS, ...PRESETS[i]!.values }));
      btn.classList.toggle('on', same(PRESETS[i]!.values, this.values));
    });
    this.hooks.onChange(this.values);
  }

  // ------------------------------------------------------------------ screen

  open(): void {
    this.panel.classList.add('visible');
    this.hooks.onOpen();
  }

  close(): void {
    this.panel.classList.remove('visible');
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }
}
