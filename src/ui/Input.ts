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

export class Input {
  readonly keys: Record<string, boolean> = {};
  firing = false;
  locked = false;
  /** Debounces tiny pointer-lock drops so fast movement does not hard-pause. */
  private lockLossTimer: number | null = null;

  constructor(
    private readonly canvas: HTMLElement,
    hooks: InputHooks,
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
      if (this.locked) hooks.onLook(e.movementX, e.movementY);
    });

    addEventListener('mousedown', (e) => {
      if (e.button === 0) this.firing = true;
    });

    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });

    addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('blur', () => {
      for (const key in this.keys) this.keys[key] = false;
      this.firing = false;
    });

    document.addEventListener('pointerlockchange', () => {
      const nowLocked = document.pointerLockElement === this.canvas;
      if (nowLocked) {
        if (this.lockLossTimer !== null) {
          clearTimeout(this.lockLossTimer);
          this.lockLossTimer = null;
        }
        this.locked = true;
        this.firing = false;
        hooks.onLockChange(true);
      } else {
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
