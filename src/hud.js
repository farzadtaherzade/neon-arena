import { CAMERA, FEEDBACK, SCREEN, WEAPON } from './config.js';

/**
 * All DOM reads and writes live here.
 *
 * The HUD runs every frame, so each setter compares against the last rendered
 * value and skips the DOM write when nothing changed — otherwise we'd be
 * touching a dozen nodes 60 times a second for nothing.
 */
export class Hud {
  constructor() {
    const $ = id => document.getElementById(id);

    this.root = $('hud');
    this.crosshair = $('crosshair');
    this.hitmark = $('hitmark');
    this.vignette = $('vignette');

    this.healthFill = $('healthFill');
    this.healthText = $('healthText');
    this.ammo = $('ammo');

    this.scoreVal = $('scoreVal');
    this.waveVal = $('waveVal');
    this.enemyVal = $('enemyVal');

    this.reloadBar = $('reloadBar');
    this.reloadFill = $('reloadFill');

    this.banner = $('banner');
    this.bannerBig = $('bannerBig');
    this.bannerSub = $('bannerSub');

    this.screens = {
      [SCREEN.START]: $('startScreen'),
      [SCREEN.PAUSE]: $('pauseScreen'),
      [SCREEN.GAMEOVER]: $('gameOverScreen'),
    };
    this.finalStats = $('finalStats');

    this._last = {};
    this._bannerTimer = null;
  }

  setVisible(on) {
    this.root.classList.toggle('on', on);
  }

  showScreen(name) {
    for (const [key, el] of Object.entries(this.screens)) {
      el.classList.toggle('visible', key === name);
    }
  }

  /** In test mode the overlays are removed outright so they can't be clicked. */
  hideAllScreens() {
    for (const el of Object.values(this.screens)) el.style.display = 'none';
  }

  showBanner(big, sub = '') {
    this.bannerBig.textContent = big;
    this.bannerSub.textContent = sub;
    this.banner.style.opacity = 1;
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { this.banner.style.opacity = 0; }, FEEDBACK.BANNER_MS);
  }

  markKill() {
    this.hitmark.classList.add('kill');
  }

  reset() {
    this.hitmark.classList.remove('kill');
    this.vignette.style.opacity = 0;
    this.reloadBar.style.opacity = 0;
    this._last = {};
  }

  setHitmark(hitT) {
    const opacity = Math.max(hitT, 0);
    if (this._last.hitmark !== opacity) {
      this._last.hitmark = opacity;
      this.hitmark.style.opacity = opacity;
    }
  }

  setVignette(opacity) {
    if (this._last.vignette === opacity) return;
    this._last.vignette = opacity;
    this.vignette.style.opacity = opacity;
  }

  /** Crosshair opens up as bloom accumulates, and steadies when standing still. */
  setCrosshair(bloom, moving) {
    const gap = CAMERA.CROSSHAIR_GAP_MIN + (bloom / WEAPON.BLOOM_MAX) * CAMERA.CROSSHAIR_GAP_SPAN;
    if (this._last.gap !== gap) {
      this._last.gap = gap;
      this.crosshair.style.setProperty('--gap', gap + 'px');
    }
    const opacity = moving || bloom > CAMERA.CROSSHAIR_BLOOM_FLOOR ? 1 : CAMERA.CROSSHAIR_STILL;
    if (this._last.crossOpacity !== opacity) {
      this._last.crossOpacity = opacity;
      this.crosshair.style.opacity = opacity;
    }
  }

  update(game, weapon) {
    const { hp, score, wave } = game;
    const hostiles = game.waves.hostileCount;

    if (this._last.hp !== hp) {
      this._last.hp = hp;
      this.healthFill.style.width = hp + '%';
      this.healthText.textContent = Math.ceil(hp);
      this.healthFill.style.background = hp > 50
        ? 'linear-gradient(90deg,#1fd67a,#7dffb8)'
        : hp > 25 ? 'linear-gradient(90deg,#d6a71f,#ffd27a)' : 'linear-gradient(90deg,#d61f3a,#ff7a7a)';
    }

    if (this._last.ammo !== weapon.ammo) {
      this._last.ammo = weapon.ammo;
      this.ammo.innerHTML = weapon.ammo + ' <small>/ ∞</small>';
    }

    if (this._last.score !== score) {
      this._last.score = score;
      this.scoreVal.textContent = score;
    }

    if (this._last.wave !== wave) {
      this._last.wave = wave;
      this.waveVal.textContent = wave || '–';
    }

    if (this._last.hostiles !== hostiles) {
      this._last.hostiles = hostiles;
      this.enemyVal.textContent = hostiles;
    }

    // Hide/show on transition; the fill width is refreshed only while active.
    if (this._last.reloading !== weapon.reloading) {
      this._last.reloading = weapon.reloading;
      this.reloadBar.style.opacity = weapon.reloading ? 1 : 0;
    }
    if (weapon.reloading) {
      this.reloadFill.style.width = weapon.reloadProgress * 100 + '%';
    }

    this.setCrosshair(weapon.bloom, game.player.moving);
  }

  /** Red pulse plus damage vignette, with a floor that kicks in at low HP. */
  computeVignette(game, elapsed) {
    const f = game.feedback;
    let opacity = f.vignetteT * FEEDBACK.VIGNETTE_GAIN;
    if (game.state === 'playing' && game.hp < FEEDBACK.LOW_HP) {
      opacity = Math.max(opacity, FEEDBACK.LOW_HP_VIGNETTE + Math.sin(elapsed * FEEDBACK.LOW_HP_PULSE_HZ) * FEEDBACK.LOW_HP_PULSE);
    }
    return opacity;
  }

  setFinalStats({ score, wave, kills }) {
    this.finalStats.innerHTML =
      `SCORE <b>${score}</b> &nbsp;·&nbsp; WAVE <b>${wave}</b> &nbsp;·&nbsp; KILLS <b>${kills}</b>`;
  }
}