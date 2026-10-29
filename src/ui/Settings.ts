/**
 * Settings: crosshair, game and video, in three tabs.
 *
 * The panel is reachable from every screen (SETTINGS buttons, or the C key),
 * and its preview is a second instance of the exact markup the HUD uses, so
 * `renderCrosshair` below is the only place that knows what a crosshair is.
 *
 * Everything is stored as one bundle under `neon.settings`. The old flat
 * crosshair blob under `neon.crosshair` is migrated on first read, so a player
 * who already tuned their crosshair keeps it.
 */

import { CAMERA, DEFAULT_THEME, THEMES, type ThemeId, VIDEO } from '../game/config';

const KEY = 'neon.settings';
const LEGACY_KEY = 'neon.crosshair';
const SVG_NS = 'http://www.w3.org/2000/svg';

export type CrosshairShape = 'none' | 'circle' | 'triangle' | 'square' | 'diamond';
export type TabName = 'crosshair' | 'game' | 'video' | 'skins';

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

export interface GameSettings {
  /** Multiplier applied to mouse look (1 = default). */
  sensitivity: number;
  /** Flip the vertical look axis. */
  invertY: boolean;
  /** Field of view in degrees. */
  fov: number;
  /** Stop all game audio. */
  mute: boolean;
  /** Alias for `sensitivity` (some code calls it this). */
  mouseSensitivity?: number;
  mouseSens?: number;
  lookSensitivity?: number;
}

export interface VideoSettings {
  /** 0 = low, 1 = medium, 2 = high. */
  quality: number;
  shadows: boolean;
  fog: boolean;
  /** Which arena theme paints the world. */
  theme: ThemeId;
  /** Post-processing bloom. Off by default: it costs fill-rate. */
  bloom: boolean;
  /** Scanline + vignette CRT overlay. Off on touch first launch. */
  crt: boolean;
}

/** How the trigger works on a touch screen. */
export type ShootMode = 'button' | 'auto';

export interface TouchSettings {
  /**
   * `button` = a dedicated hold-to-fire button; `auto` = the rifle fires
   * whenever the crosshair is over a hostile. Asked once at first launch and
   * changeable here forever after.
   */
  shootMode: ShootMode;
  /** Multiplier applied to touch look drags (1 = default). */
  touchSensitivity: number;
  /** First launch on this device has applied the touch video defaults. */
  tuned: boolean;
  /** The player has picked a shoot mode, so the first-launch prompt stops. */
  shootModeChosen: boolean;
}

export interface SettingsBundle {
  crosshair: CrosshairSettings;
  game: GameSettings;
  video: VideoSettings;
  touch: TouchSettings;
}

export const CROSSHAIR_DEFAULTS: CrosshairSettings = {
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
  color: '#ffb347',
  outlineColor: '#000000',
  bloom: true,
  dimStill: true,
};

export const GAME_DEFAULTS: GameSettings = {
  sensitivity: 1,
  invertY: false,
  fov: CAMERA.FOV,
  mute: false,
};

export const VIDEO_DEFAULTS: VideoSettings = {
  quality: 2,
  shadows: true,
  fog: true,
  theme: DEFAULT_THEME,
  bloom: false,
  crt: true,
};

export const TOUCH_DEFAULTS: TouchSettings = {
  shootMode: 'button',
  touchSensitivity: 1,
  tuned: false,
  shootModeChosen: false,
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

const CROSSHAIR_LIMITS = {
  lineLen: [2, 30],
  lineThick: [1, 8],
  gap: [0, 40],
  dotSize: [1, 12],
  shapeSize: [10, 80],
  outlineWidth: [1, 4],
} as const satisfies Record<string, readonly [number, number]>;

const GAME_LIMITS = {
  sensitivity: [0.1, 5],
  fov: [VIDEO.FOV_MIN, VIDEO.FOV_MAX],
} as const satisfies Record<string, readonly [number, number]>;

const SHAPES: readonly CrosshairShape[] = ['none', 'circle', 'triangle', 'square', 'diamond'];
const HEX = /^#[0-9a-f]{6}$/i;

/** Field names that historically describe the same mouse-look multiplier. */
const SENSITIVITY_ALIASES = ['sensitivity', 'mouseSensitivity', 'mouseSens', 'lookSensitivity'] as const;

function withSensitivityAliases(s: GameSettings): GameSettings {
  for (const a of SENSITIVITY_ALIASES) {
    if (a === 'sensitivity') continue;
    Object.defineProperty(s, a, {
      get() {
        return (this as GameSettings).sensitivity;
      },
      enumerable: false,
      configurable: true,
    });
  }
  return s;
}

// ------------------------------------------------------------------ sanitising

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function hex(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX.test(v) ? v : fallback;
}

export function sanitizeCrosshair(raw: unknown): CrosshairSettings {
  const o = rec(raw);
  const d = CROSSHAIR_DEFAULTS;
  const shape = SHAPES.includes(o.shape as CrosshairShape) ? (o.shape as CrosshairShape) : d.shape;
  return {
    lines: bool(o.lines, d.lines),
    lineLen: num(o.lineLen, CROSSHAIR_LIMITS.lineLen[0], CROSSHAIR_LIMITS.lineLen[1], d.lineLen),
    lineThick: num(o.lineThick, CROSSHAIR_LIMITS.lineThick[0], CROSSHAIR_LIMITS.lineThick[1], d.lineThick),
    gap: num(o.gap, CROSSHAIR_LIMITS.gap[0], CROSSHAIR_LIMITS.gap[1], d.gap),
    dot: bool(o.dot, d.dot),
    dotSize: num(o.dotSize, CROSSHAIR_LIMITS.dotSize[0], CROSSHAIR_LIMITS.dotSize[1], d.dotSize),
    shape,
    shapeSize: num(o.shapeSize, CROSSHAIR_LIMITS.shapeSize[0], CROSSHAIR_LIMITS.shapeSize[1], d.shapeSize),
    outline: bool(o.outline, d.outline),
    outlineWidth: num(
      o.outlineWidth,
      CROSSHAIR_LIMITS.outlineWidth[0],
      CROSSHAIR_LIMITS.outlineWidth[1],
      d.outlineWidth,
    ),
    color: hex(o.color, d.color),
    outlineColor: hex(o.outlineColor, d.outlineColor),
    bloom: bool(o.bloom, d.bloom),
    dimStill: bool(o.dimStill, d.dimStill),
  };
}

export function sanitizeGame(raw: unknown): GameSettings {
  const o = rec(raw);
  const d = GAME_DEFAULTS;
  const sens = num(
    o.sensitivity ?? o.mouseSensitivity ?? o.mouseSens ?? o.lookSensitivity,
    GAME_LIMITS.sensitivity[0],
    GAME_LIMITS.sensitivity[1],
    d.sensitivity,
  );
  return withSensitivityAliases({
    sensitivity: sens,
    invertY: bool(o.invertY, d.invertY),
    fov: num(o.fov, GAME_LIMITS.fov[0], GAME_LIMITS.fov[1], d.fov),
    mute: bool(o.mute, d.mute),
  });
}

export function sanitizeVideo(raw: unknown): VideoSettings {
  const o = rec(raw);
  const d = VIDEO_DEFAULTS;
  const theme = typeof o.theme === 'string' && o.theme in THEMES ? (o.theme as ThemeId) : d.theme;
  return {
    quality: num(o.quality, 0, VIDEO.QUALITY_PIXELS.length - 1, d.quality),
    shadows: bool(o.shadows, d.shadows),
    fog: bool(o.fog, d.fog),
    theme,
    bloom: bool(o.bloom, d.bloom),
    crt: bool(o.crt, d.crt),
  };
}

export function sanitizeTouch(raw: unknown): TouchSettings {
  const o = rec(raw);
  const d = TOUCH_DEFAULTS;
  return {
    shootMode: o.shootMode === 'auto' ? 'auto' : 'button',
    touchSensitivity: num(o.touchSensitivity, 0.2, 4, d.touchSensitivity),
    tuned: bool(o.tuned, d.tuned),
    shootModeChosen: bool(o.shootModeChosen, d.shootModeChosen),
  };
}

export function sanitizeAll(raw: unknown): SettingsBundle {
  const o = rec(raw);
  return {
    crosshair: sanitizeCrosshair(o.crosshair),
    game: sanitizeGame(o.game),
    video: sanitizeVideo(o.video),
    touch: sanitizeTouch(o.touch),
  };
}

function parse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readSettings(store: Pick<Storage, 'getItem'>): SettingsBundle {
  try {
    const current = parse(store.getItem(KEY));
    if (current && typeof current === 'object') return sanitizeAll(current);
    // Migrate the old flat crosshair blob so an existing crosshair is not lost.
    const legacy = rec(parse(store.getItem(LEGACY_KEY)));
    if (Object.keys(legacy).length > 0) {
      return sanitizeAll({
        crosshair: legacy,
        game: { sensitivity: legacy.sensitivity, mute: legacy.mute },
      });
    }
  } catch {
    // Storage is unavailable (private mode): fall through to the defaults.
  }
  return sanitizeAll({});
}

export function writeSettings(store: Pick<Storage, 'setItem'>, values: SettingsBundle): void {
  try {
    store.setItem(KEY, JSON.stringify(values));
  } catch {
    // Private mode / quota: the settings simply do not persist.
  }
}

// -------------------------------------------------------------------- drawing

function el(tag: string, cls?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

const SHAPE_SVG: Record<Exclude<CrosshairShape, 'none'>, string> = {
  circle: '<circle cx="50" cy="50" r="47"/>',
  triangle: '<polygon points="50,3 97,97 3,97"/>',
  square: '<rect x="3" y="3" width="94" height="94"/>',
  diamond: '<polygon points="50,3 97,50 50,97 3,50"/>',
};

/** Paint a crosshair into any element that carries the `.ch` markup. */
export function renderCrosshair(node: HTMLElement, s: CrosshairSettings): void {
  node.style.setProperty('--gap', `${s.gap}px`);
  node.style.setProperty('--len', `${s.lineLen}px`);
  node.style.setProperty('--thick', `${s.lineThick}px`);
  node.style.setProperty('--dot', `${s.dotSize}px`);
  node.style.setProperty('--shape', `${s.shapeSize}px`);
  node.style.setProperty('--color', s.color);
  node.style.setProperty('--outline-w', `${s.outlineWidth}px`);
  node.style.setProperty('--outline-color', s.outlineColor);
  node.className = `ch shape-${s.shape}${s.lines ? '' : ' no-lines'}${s.dot ? '' : ' no-dot'}${
    s.outline ? ' outline' : ''
  }`;
  node.replaceChildren();
  if (s.shape !== 'none') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.innerHTML = SHAPE_SVG[s.shape];
    node.appendChild(svg);
  }
  if (s.dot) node.appendChild(el('i', 'dot'));
  if (s.lines) {
    node.appendChild(el('i', 'line h l'));
    node.appendChild(el('i', 'line h r'));
    node.appendChild(el('i', 'line v t'));
    node.appendChild(el('i', 'line v b'));
  }
}

// ------------------------------------------------------------------- controls

type Value = string | number | boolean;

interface Row {
  key: string;
  label: string;
  type: 'number' | 'toggle' | 'select' | 'color';
  min?: readonly [number, number];
  step?: number;
  options?: readonly string[];
  /** Extra text shown next to the value, e.g. a unit. */
  suffix?: string;
}

const CROSSHAIR_ROWS: readonly Row[] = [
  { key: 'lines', label: 'CROSSHAIR LINES', type: 'toggle' },
  { key: 'lineLen', label: 'LINE LENGTH', type: 'number', min: [2, 30] },
  { key: 'lineThick', label: 'LINE THICKNESS', type: 'number', min: [1, 8] },
  { key: 'gap', label: 'CENTRE GAP', type: 'number', min: [0, 40] },
  { key: 'dot', label: 'CENTRE DOT', type: 'toggle' },
  { key: 'dotSize', label: 'DOT SIZE', type: 'number', min: [1, 12] },
  { key: 'shape', label: 'SHAPE', type: 'select', options: SHAPES },
  { key: 'shapeSize', label: 'SHAPE SIZE', type: 'number', min: [10, 80] },
  { key: 'outline', label: 'OUTLINE', type: 'toggle' },
  { key: 'outlineWidth', label: 'OUTLINE WIDTH', type: 'number', min: [1, 4] },
  { key: 'color', label: 'COLOUR', type: 'color' },
  { key: 'outlineColor', label: 'OUTLINE COLOUR', type: 'color' },
  { key: 'bloom', label: 'SPREAD BLOOM', type: 'toggle' },
  { key: 'dimStill', label: 'DIM WHEN STILL', type: 'toggle' },
];

const GAME_ROWS: readonly Row[] = [
  { key: 'sensitivity', label: 'MOUSE SENSITIVITY', type: 'number', min: [0.1, 5], step: 0.1 },
  { key: 'invertY', label: 'INVERT Y AXIS', type: 'toggle' },
  { key: 'fov', label: 'FIELD OF VIEW', type: 'number', min: [VIDEO.FOV_MIN, VIDEO.FOV_MAX] },
  { key: 'mute', label: 'MUTE AUDIO', type: 'toggle' },
];

const VIDEO_ROWS: readonly Row[] = [
  { key: 'theme', label: 'ARENA THEME', type: 'select', options: Object.keys(THEMES) },
  { key: 'quality', label: 'RENDER QUALITY', type: 'number', min: [0, VIDEO.QUALITY_PIXELS.length - 1] },
  { key: 'bloom', label: 'BLOOM', type: 'toggle' },
  { key: 'crt', label: 'CRT UI', type: 'toggle' },
  { key: 'shadows', label: 'SHADOWS', type: 'toggle' },
  { key: 'fog', label: 'FOG', type: 'toggle' },
];

const TOUCH_ROWS: readonly Row[] = [
  { key: 'shootMode', label: 'TOUCH SHOOT MODE', type: 'select', options: ['button', 'auto'] },
  { key: 'touchSensitivity', label: 'TOUCH SENSITIVITY', type: 'number', min: [0.2, 4], step: 0.1 },
];

const SHOOT_MODE_NAMES: Record<ShootMode, string> = { button: 'BUTTON', auto: 'AUTO-FIRE' };

const QUALITY_NAMES = ['LOW', 'MEDIUM', 'HIGH'];

interface Bound {
  input: HTMLInputElement | HTMLSelectElement;
  out: HTMLElement;
  row: Row;
  /** Reads the row's current value from its own group. */
  read(): Value;
}

export interface SettingsHooks {
  /** Called when the panel opens — the game drops pointer lock, which pauses. */
  onOpen(): void;
  onChange(values: SettingsBundle): void;
  /** Called when a tab is shown, so a tab with its own content can refresh. */
  onShowTab?(tab: TabName): void;
}

export class Settings {
  values: SettingsBundle;
  private panel = document.getElementById('settingsScreen')!;
  private presetList = document.getElementById('presetList')!;
  private targets: HTMLElement[];
  private inputs = new Map<string, Bound>();
  private presetButtons: HTMLElement[] = [];
  private thumbnails: HTMLElement[] = [];
  private active: TabName = 'crosshair';

  constructor(
    hudCrosshair: HTMLElement,
    private readonly hooks: SettingsHooks,
    private readonly store: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
  ) {
    this.values = readSettings(store);
    this.targets = [hudCrosshair, document.getElementById('previewCross')!];

    this.buildPresets();
    this.buildRows(
      document.getElementById('tuneList')!,
      CROSSHAIR_ROWS,
      (k, v) => this.setCrosshair({ [k]: v } as Partial<CrosshairSettings>),
      (k) => (this.values.crosshair as unknown as Record<string, Value>)[k] ?? '',
    );
    this.buildRows(
      document.getElementById('gameList')!,
      GAME_ROWS,
      (k, v) => this.setGame({ [k]: v } as Partial<GameSettings>),
      (k) => (this.values.game as unknown as Record<string, Value>)[k] ?? '',
    );
    this.buildRows(
      document.getElementById('gameList')!,
      TOUCH_ROWS,
      (k, v) => this.setTouch({ [k]: v } as Partial<TouchSettings>),
      (k) => (this.values.touch as unknown as Record<string, Value>)[k] ?? '',
    );
    this.buildRows(
      document.getElementById('videoList')!,
      VIDEO_ROWS,
      (k, v) => this.setVideo({ [k]: v } as Partial<VideoSettings>),
      (k) => (this.values.video as unknown as Record<string, Value>)[k] ?? '',
    );
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
        this.values.crosshair = sanitizeCrosshair({ ...CROSSHAIR_DEFAULTS, ...preset.values });
        this.commit();
      });
      this.presetList.appendChild(btn);
      return btn;
    });
  }

  /**
   * Build one row per control.
   *
   * `read`/`write` are supplied per group so the same row builder serves the
   * crosshair, the game options and the video options.
   */
  private buildRows(
    host: HTMLElement,
    rows: readonly Row[],
    write: (key: string, value: Value) => void,
    read: (key: string) => Value,
  ): void {
    for (const row of rows) {
      const line = el('div', 'trow');
      const label = el('label', 'tk');
      label.textContent = row.label;
      line.appendChild(label);

      let input: HTMLInputElement | HTMLSelectElement;
      if (row.type === 'toggle') {
        input = el('input', 'toggle') as HTMLInputElement;
        input.type = 'checkbox';
      } else if (row.type === 'select') {
        input = el('select') as HTMLSelectElement;
        for (const o of row.options ?? []) {
          const opt = el('option') as HTMLOptionElement;
          opt.value = o;
          opt.textContent = o.toUpperCase();
          input.appendChild(opt);
        }
      } else if (row.type === 'color') {
        input = el('input', 'swatchInput') as HTMLInputElement;
        input.type = 'color';
        for (const swatch of SWATCHES) {
          const sw = el('button', 'swatch');
          sw.setAttribute('type', 'button');
          sw.style.background = swatch;
          sw.addEventListener('click', () => write(row.key, swatch));
          line.appendChild(sw);
        }
      } else {
        input = el('input', 'range') as HTMLInputElement;
        input.type = 'range';
        input.min = String(row.min?.[0] ?? 0);
        input.max = String(row.min?.[1] ?? 1);
        input.step = String(row.step ?? 1);
      }

      const value = (): Value => {
        if (row.type === 'toggle') return (input as HTMLInputElement).checked;
        if (row.type === 'number') return Number(input.value);
        return input.value;
      };
      input.addEventListener('input', () => write(row.key, value()));

      const out = el('span', 'tv');
      line.append(input, out);
      host.appendChild(line);
      // Namespaced by host: the crosshair and video groups both own a `bloom`,
      // and a shared key would silently steal the other row's binding.
      this.inputs.set(`${host.id}.${row.key}`, { input, out, row, read: () => read(row.key) });
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
    for (const btn of document.querySelectorAll('#settingsTabs [data-tab]')) {
      btn.addEventListener('click', () => this.showTab(btn.getAttribute('data-tab') as TabName));
    }
    document.getElementById('settingsClose')!.addEventListener('click', () => this.close());
    document.getElementById('settingsReset')!.addEventListener('click', () => {
      this.values = sanitizeAll({});
      this.commit();
    });
  }

  // ------------------------------------------------------------------ values

  setCrosshair(patch: Partial<CrosshairSettings>): void {
    this.values.crosshair = sanitizeCrosshair({ ...this.values.crosshair, ...patch });
    this.commit();
  }

  setGame(patch: Partial<GameSettings>): void {
    this.values.game = sanitizeGame({ ...this.values.game, ...patch });
    this.commit();
  }

  setVideo(patch: Partial<VideoSettings>): void {
    this.values.video = sanitizeVideo({ ...this.values.video, ...patch });
    this.commit();
  }

  setTouch(patch: Partial<TouchSettings>): void {
    this.values.touch = sanitizeTouch({ ...this.values.touch, ...patch });
    this.commit();
  }

  private commit(): void {
    writeSettings(this.store, this.values);
    this.apply();
  }

  private apply(): void {
    for (const target of this.targets) renderCrosshair(target, this.values.crosshair);
    for (const { input, out, row, read } of this.inputs.values()) {
      const raw = read();
      if (row.type === 'toggle') (input as HTMLInputElement).checked = raw === true;
      else input.value = String(raw);
      out.textContent = this.label(row, raw);
    }
    // Preset thumbnails paint the preset's own values, and the highlight only
    // claims a preset while nothing has been hand-tuned on top of it.
    this.presetButtons.forEach((btn, i) => {
      const preset = PRESETS[i]!;
      renderCrosshair(this.thumbnails[i]!, sanitizeCrosshair({ ...CROSSHAIR_DEFAULTS, ...preset.values }));
      btn.classList.toggle('on', same(preset.values, this.values.crosshair));
    });
    this.hooks.onChange(this.values);
  }

  private label(row: Row, value: Value): string {
    if (row.type === 'toggle') return value ? 'ON' : 'OFF';
    if (row.type === 'select') {
      if (row.key === 'theme') return THEMES[value as ThemeId]?.name ?? '';
      return '';
    }
    if (row.key === 'quality') return QUALITY_NAMES[Number(value)] ?? '';
    if (row.key === 'shootMode') return SHOOT_MODE_NAMES[value as ShootMode] ?? '';
    return String(value);
  }

  // ------------------------------------------------------------------ screen

  showTab(name: TabName): void {
    this.active = name;
    for (const btn of document.querySelectorAll('#settingsTabs [data-tab]')) {
      btn.classList.toggle('on', btn.getAttribute('data-tab') === name);
    }
    for (const pane of document.querySelectorAll('#settingsScreen .tabpane')) {
      pane.toggleAttribute('hidden', pane.getAttribute('data-pane') !== name);
    }
    this.hooks.onShowTab?.(name);
  }

  open(): void {
    this.panel.classList.add('visible');
    this.showTab(this.active);
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

/** True when `values` is still exactly the preset on top of the defaults. */
function same(values: Partial<CrosshairSettings>, current: CrosshairSettings): boolean {
  return (Object.keys(CROSSHAIR_DEFAULTS) as (keyof CrosshairSettings)[]).every(
    (k) => (values[k] ?? CROSSHAIR_DEFAULTS[k]) === current[k],
  );
}

// Expose alias names on the default object too (non-enumerable, so equality stays clean).
withSensitivityAliases(GAME_DEFAULTS);
