import { STATE } from './config.js';

/**
 * Raw keyboard/mouse state plus pointer-lock bookkeeping.
 *
 * Holds no game logic — it records intent (which keys are down, is the trigger
 * held, is the pointer locked) and forwards discrete events to `hooks`. It reads
 * `game.state` rather than mirroring it, so there is only one source of truth.
 */
export class Input {
  constructor(game, hooks) {
    this.game = game;
    this.canvas = game.renderer.domElement;
    this.hooks = hooks;
    this.keys = {};
    this.firing = false;
    this.locked = false;

    addEventListener('keydown', e => {
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

    addEventListener('keyup', e => { this.keys[e.code] = false; });

    addEventListener('mousemove', e => {
      if (this.locked) hooks.onLook(e.movementX, e.movementY);
    });

    addEventListener('mousedown', e => {
      if (e.button === 0) this.firing = true;
    });

    addEventListener('mouseup', e => {
      if (e.button === 0) this.firing = false;
    });

    addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      hooks.onLockChange(this.locked);
    });

    // Any bare click re-acquires the cursor, unless an overlay is handling it.
    document.addEventListener('click', () => {
      if (this.locked) return;
      if (game.state === STATE.PLAYING) hooks.onLockRequest();
      else if (game.state === STATE.PAUSED) hooks.onResume();
    });
  }

  lock() {
    const p = this.canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }

  release() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}