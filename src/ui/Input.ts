/**
 * Raw keyboard/mouse state plus pointer-lock bookkeeping.
 *
 * Holds no game logic — it records intent (which keys are down, is the trigger
 * held, is the pointer locked) and forwards discrete events to `hooks`. It asks
 * `hooks` what state the game is in rather than holding a reference to it, so
 * there is still exactly one source of truth.
 */
export interface InputHooks {
  isPlaying(): boolean;
  isPaused(): boolean;
  isSettingsOpen(): boolean;
  onJump(): void;
  onReload(): void;
  onLook(dx: number, dy: number): void;
  onLockRequest(): void;
  onLockChange(locked: boolean): void;
  onToggleSettings(): void;
  onCloseSettings(): void;
}

export interface MoveInput {
  forward: number;
  right: number;
  sprint: boolean;
}

const held = (keys: Record<string, boolean>, code: string): boolean => keys[code] === true;

/**
 * Largest mouse delta a single event may carry.
 *
 * A deliberate flick produces tens of pixels per event even on a 1000 Hz mouse;
 * the outliers that snap the view are cursor warps and browser glitches in the
 * hundreds-to-thousands. 600 sits between the two with headroom for a violent
 * flick at a low polling rate, and it keeps the worst accepted step under 90°
 * at the default sensitivity (600 × 0.0023 rad ≈ 79°) — the old 1500 allowed
 * ~198° in a single event, which is a teleport, not a turn.
 */
export const LOOK_MAX = 600;

/**
 * Mousemoves to swallow right after the lock is granted.
 *
 * Acquiring pointer lock warps the cursor to the element's centre, and the
 * browser reports that warp as one large movement delta. That is the classic
 * "view snaps the moment I click to resume".
 */
export const LOCK_WARMUP = 2;

/** Would this delta be trusted as real mouse movement? */
export function lookDeltaOk(dx: number, dy: number): boolean {
  return Math.abs(dx) <= LOOK_MAX && Math.abs(dy) <= LOOK_MAX;
}

export class Input {
  readonly keys: Record<string, boolean> = {};
  firing = false;
  /** Right-mouse aim: ADS. Shared through `MoveInput` so gameplay stays pure. */
  aiming = false;
  locked = false;
  /** Debounces tiny pointer-lock drops so fast movement does not hard-pause. */
  private lockLossTimer: number | null = null;
  /** Events still to swallow after the lock was granted — see `LOCK_WARMUP`. */
  private lockWarmup = 0;

  /**
   * Rejected input, for `__NEON.inputStats()`. If a "glitch" is accompanied by
   * a rising `spikes` count, the filter is doing its job; a rising `lockLosses`
   * means the browser is dropping the pointer instead.
   */
  readonly stats = { spikes: 0, lockLosses: 0, warmupDrops: 0 };

  constructor(
    private readonly canvas: HTMLElement,
    hooks: InputHooks,
    /**
     * Headless (`?test`) runs never take pointer lock — Playwright drives them —
     * so the harness is trusted for the trigger. Look deltas stay off: those
     * runs aim through the test API, not the mouse.
     */
    private readonly headless = false,
  ) {
    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) hooks.onJump();
      }
      if (e.code === 'KeyR') hooks.onReload();
      if (e.code === 'KeyC') hooks.onToggleSettings();
      // Esc never reaches keydown while pointer-locked (the browser eats it to
      // exit the lock), so it only closes the settings panel.
      if (e.code === 'Escape') hooks.onCloseSettings();
    });

    addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    addEventListener('mousemove', (e) => {
      // Trust the DOM, not our own debounced flag: `locked` deliberately lags a
      // lock loss by 120 ms so a brief drop does not hard-pause, and during that
      // window the pointer is free — its deltas are measured from the real
      // cursor rather than from the last locked position, and arrive as a jump.
      if (!this.lookCaptured()) return;
      if (this.lockWarmup > 0) {
        this.lockWarmup--;
        this.stats.warmupDrops++;
        return;
      }
      // A single browser glitch can report a few-thousand-pixel delta and snap
      // the view by a full 90° or more. Those outliers are never a deliberate
      // flick, so ignore them instead of feeding them into the look math.
      if (!lookDeltaOk(e.movementX, e.movementY)) {
        this.stats.spikes++;
        return;
      }
      hooks.onLook(e.movementX, e.movementY);
    });

    addEventListener('mousedown', (e) => {
      // Only while the mouse actually belongs to the game: the click that
      // re-acquires the pointer (the pause screen) must not also pull the
      // trigger on the same press.
      if (!this.inputCaptured()) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.aiming = true;
    });

    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aiming = false;
    });

    addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('blur', () => {
      for (const key in this.keys) this.keys[key] = false;
      this.firing = false;
      this.aiming = false;
    });

    document.addEventListener('pointerlockchange', () => {
      const nowLocked = document.pointerLockElement === this.canvas;
      if (nowLocked) {
        if (this.lockLossTimer !== null) {
          clearTimeout(this.lockLossTimer);
          this.lockLossTimer = null;
        }
        this.locked = true;
        // The cursor warp that comes with the lock is reported as movement.
        this.lockWarmup = LOCK_WARMUP;
        this.firing = false;
        hooks.onLockChange(true);
      } else {
        this.stats.lockLosses++;
        this.lockWarmup = 0;
        if (this.lockLossTimer === null) {
          this.lockLossTimer = window.setTimeout(() => {
            this.lockLossTimer = null;
            this.locked = false;
            hooks.onLockChange(false);
          }, 120);
        }
      }
    });

    // Any bare click re-acquires the cursor, unless an overlay is handling it.
    // The settings panel is a full-screen overlay sitting on top of a paused
    // game, so without this guard its first click re-locks the pointer: the game
    // resumes under the panel and the cursor disappears, making it unusable.
    document.addEventListener('click', () => {
      if (this.locked) return;
      if (hooks.isSettingsOpen()) return;
      if (hooks.isPlaying()) hooks.onLockRequest();
      else if (hooks.isPaused()) hooks.onLockRequest();
    });
  }

  /**
   * Pointer deltas are only trusted when the pointer is genuinely captured.
   * Headless runs never are — they aim through the test API — so mouse deltas
   * stay off there, which is also what keeps the E2E deterministic.
   */
  private lookCaptured(): boolean {
    return !this.headless && document.pointerLockElement === this.canvas;
  }

  /** The trigger only responds when the mouse actually belongs to the game. */
  private inputCaptured(): boolean {
    return this.headless || document.pointerLockElement === this.canvas;
  }

  /** Directional intent for this step. */
  move(): MoveInput {
    const k = this.keys;
    return {
      forward: (held(k, 'KeyW') ? 1 : 0) - (held(k, 'KeyS') ? 1 : 0),
      right: (held(k, 'KeyD') ? 1 : 0) - (held(k, 'KeyA') ? 1 : 0),
      sprint: held(k, 'ShiftLeft') || held(k, 'ShiftRight'),
    };
  }

  /** Strafe amount, for the gun's sway. */
  get strafe(): number {
    const k = this.keys;
    return (held(k, 'KeyD') ? 1 : 0) - (held(k, 'KeyA') ? 1 : 0);
  }

  lock(): void {
    const p = this.canvas.requestPointerLock() as Promise<void> | undefined;
    if (p?.catch) p.catch(() => {});
  }

  release(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
