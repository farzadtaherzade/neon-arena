import { TOUCH } from '../game/config';
import { emptyMove, stickMove, type TouchMove } from '../game/touch';

/**
 * The touch layer: floating move stick, look drag and the on-screen buttons.
 *
 * It holds no game logic — the same deal `Input` strikes. It records intent
 * (`firing`, `aiming`, the stick's walk vector) and forwards discrete events to
 * `hooks`; `Game` merges that intent with the keyboard/mouse input each step.
 *
 * The layer only exists while a run is live (`setVisible`), so screens and the
 * settings panel never fight it for a tap. Every pointerdown inside the layer
 * stops propagation, because a click bubbling to `document` is `Input`'s
 * re-lock/resume signal — a tap on FIRE must not also resume a paused run.
 */

export interface TouchHooks {
  /** A look drag moved by (dx, dy) px. Sensitivity is applied by the game. */
  onLook(dx: number, dy: number): void;
  onJump(): void;
  onReload(): void;
  onKnife(): void;
  onPause(): void;
  /** The orientation flipped to (or from) portrait. */
  onRotate(portrait: boolean): void;
  /** The player picked a shoot mode on the first-launch prompt. */
  onFireMode(mode: 'button' | 'auto'): void;
}

/** A coarse, hover-less primary pointer: a phone or a tablet, not a mouse. */
export function isTouchDevice(): boolean {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches;
}

/**
 * Largest drag delta a single pointermove may carry. Touch flicks run hotter
 * than mouse moves but are still bounded — this rejects the multi-hundred-pixel
 * jump a browser glitch reports, the touch cousin of `Input.LOOK_MAX`.
 */
export const TOUCH_LOOK_MAX = 600;

const FIRE_MODE_SCREEN = 'fireModeScreen';
const ROTATE_SCREEN = 'rotateScreen';

export class Touch {
  readonly enabled: boolean;
  /** Hold-to-fire (the FIRE button), independent of the keyboard trigger. */
  firing = false;
  /** ADS toggle: tap to aim, tap again to drop. */
  aiming = false;
  /** The stick's walk intent, mutated in place — no per-frame allocation. */
  readonly move: TouchMove = emptyMove();

  private readonly layer = document.getElementById('touchLayer')!;
  private readonly stickBase = document.getElementById('stickBase')!;
  private readonly stickNub = document.getElementById('stickNub')!;
  private readonly fireButton = document.getElementById('btnFire')!;
  private readonly aimButton = document.getElementById('btnAim')!;

  /** Which pointer id owns the stick, the look drag and the held trigger. */
  private stickId: number | null = null;
  private lookId: number | null = null;
  private fireId: number | null = null;
  /** Where the stick was born, in layer coordinates. */
  private stickOriginX = 0;
  private stickOriginY = 0;
  /** Last accepted look point. */
  private lookX = 0;
  private lookY = 0;
  /** Guard on `setVisible` — the DOM write happens once per change. */
  private visible = false;
  private portrait = false;
  /** Portrait media query — only watched when the layer is enabled. */
  private orientation: MediaQueryList | null = null;

  constructor(
    private readonly hooks: TouchHooks,
    enabled: boolean,
  ) {
    this.enabled = enabled;
    // The Controls list and the pause hints read this to swap keycaps for thumbs.
    document.body.classList.toggle('is-touch', enabled);
    if (!enabled) return;

    this.orientation = matchMedia('(orientation: portrait)');
    this.layer.style.setProperty('--touch-stick-r', `${TOUCH.STICK_R}px`);

    // Any click born inside the layer must die here: the document-level click
    // is the desktop re-lock/resume path, and a touch control press must not
    // double as one.
    this.layer.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById(ROTATE_SCREEN)!.addEventListener('click', (e) => e.stopPropagation());

    this.bindButton('btnJump', () => hooks.onJump());
    this.bindButton('btnReload', () => hooks.onReload());
    this.bindButton('btnKnife', () => hooks.onKnife());
    this.bindButton('btnPause', () => hooks.onPause());
    this.aimButton.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.aiming = !this.aiming;
      this.aimButton.classList.toggle('on', this.aiming);
    });
    // The trigger is a hold: it lives until its own pointer is released,
    // wherever that happens — the thumb can slide off the button.
    this.fireButton.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.firing = true;
      this.fireId = e.pointerId;
      this.fireButton.classList.add('on');
    });

    this.layer.addEventListener('pointerdown', (e) => this.onDown(e));
    addEventListener('pointermove', (e) => this.onMove(e));
    addEventListener('pointerup', (e) => this.onUp(e));
    addEventListener('pointercancel', (e) => this.onUp(e));

    for (const id of ['fmButton', 'fmAuto'] as const) {
      const mode = id === 'fmButton' ? 'button' : 'auto';
      document.getElementById(id)!.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showFirePrompt(false);
        hooks.onFireMode(mode);
      });
    }

    const mq = this.orientation;
    if (mq) {
      mq.addEventListener('change', () => {
        this.portrait = mq.matches;
        hooks.onRotate(this.portrait);
      });
      this.portrait = mq.matches;
    }
  }

  /** Current portrait/landscape state, reported once at boot. */
  get isPortrait(): boolean {
    return this.portrait;
  }

  /** Boot-time orientation report — the overlay must show before any resize. */
  reportOrientation(): void {
    if (this.enabled) this.hooks.onRotate(this.portrait);
  }

  /**
   * Show or hide the whole control layer. Runs once per state change.
   *
   * The render loop calls this every frame with the raw state, so the
   * `enabled` guard is what keeps the layer — and with it every on-screen
   * button — off a mouse-and-keyboard machine: without it, the first playing
   * frame un-hides the layer on desktops too, and its pointer handlers then
   * swallow the mouse.
   */
  setVisible(on: boolean): void {
    if (!this.enabled) return;
    if (this.visible === on) return;
    this.visible = on;
    this.layer.hidden = !on;
    // The layer only exists while playing, so a hide is always a goodbye:
    // mid-drag pauses (map, settings, rotate) must not leave a held trigger.
    if (!on) this.clear();
  }

  /** Show or hide the TURN YOUR PHONE overlay. */
  setRotate(portrait: boolean): void {
    document.getElementById(ROTATE_SCREEN)!.classList.toggle('visible', portrait);
  }

  showFirePrompt(on: boolean): void {
    document.getElementById(FIRE_MODE_SCREEN)!.classList.toggle('visible', on);
  }

  /** Release everything transient: held trigger, active stick, ADS toggle. */
  clear(): void {
    this.firing = false;
    this.fireId = null;
    this.fireButton.classList.remove('on');
    this.aiming = false;
    this.aimButton.classList.remove('on');
    this.stickId = null;
    this.lookId = null;
    this.stickBase.hidden = true;
    this.move.forward = 0;
    this.move.right = 0;
    this.move.sprint = false;
  }

  /** Firing, aim, stick and drag state — the `__NEON.touch()` surface. */
  get stats(): { visible: boolean; portrait: boolean; firing: boolean; aiming: boolean } {
    return { visible: this.visible, portrait: this.portrait, firing: this.firing, aiming: this.aiming };
  }

  private bindButton(id: string, onDown: () => void): void {
    document.getElementById(id)!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onDown();
    });
  }

  /**
   * A finger came down. Left ~45% of the screen spawns the stick where the
   * thumb landed; everything else (that is not a button) drags the view.
   * A second finger never steals the stick: whoever owns it keeps it.
   */
  private onDown(e: PointerEvent): void {
    e.preventDefault();
    if (this.stickId === null && e.clientX < innerWidth * 0.45) {
      this.stickId = e.pointerId;
      this.stickOriginX = e.clientX;
      this.stickOriginY = e.clientY;
      this.stickBase.hidden = false;
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickNub.style.transform = 'translate(-50%, -50%)';
      this.move.forward = 0;
      this.move.right = 0;
      this.move.sprint = false;
      return;
    }
    if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    }
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      const dx = e.clientX - this.stickOriginX;
      const dy = e.clientY - this.stickOriginY;
      stickMove(dx, dy, this.move);
      // Draw the nub clamped to the rim, even when the walk vector clamps.
      const len = Math.hypot(dx, dy);
      const scale = len > TOUCH.STICK_R ? TOUCH.STICK_R / len : 1;
      this.stickNub.style.transform = `translate(calc(-50% + ${dx * scale}px), calc(-50% + ${dy * scale}px))`;
      return;
    }
    if (e.pointerId === this.lookId) {
      const dx = e.clientX - this.lookX;
      const dy = e.clientY - this.lookY;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      if (Math.abs(dx) > TOUCH_LOOK_MAX || Math.abs(dy) > TOUCH_LOOK_MAX) return;
      this.hooks.onLook(dx, dy);
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId === this.fireId) {
      this.firing = false;
      this.fireId = null;
      this.fireButton.classList.remove('on');
    }
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stickBase.hidden = true;
      this.move.forward = 0;
      this.move.right = 0;
      this.move.sprint = false;
    }
    if (e.pointerId === this.lookId) this.lookId = null;
  }
}
