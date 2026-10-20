import { BOMB, CAMERA, FEEDBACK, SCREEN, type ScreenName, WEAPON } from '../game/config';
import { readRecord, updateRecord } from './Records';
import type { CrosshairSettings } from './Settings';

/** What the HUD reads each frame. Kept structural so `Game` doesn't leak itself. */
export interface HudModel {
  hp: number;
  score: number;
  wave: number;
  hostiles: number;
  state: string;
  vignetteT: number;
  ammo: number;
  reloading: boolean;
  reloadProgress: number;
  bloom: number;
  moving: boolean;
  /** Remaining sprint stamina, 0..100. */
  stamina: number;
  /** Distance to the nearest live bomb, and its remaining fuse. */
  bombDist: number;
  bombFuse: number;
  /** Deck capture hold progress 0..1, and whether the player is on the pad. */
  captureProgress: number;
  captureOn: boolean;
  /** Player level, and the XP banked toward the next one. */
  level: number;
  xp: number;
  xpNeed: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

/**
 * All DOM reads and writes live here.
 *
 * The HUD runs every frame, so each setter compares against the last rendered
 * value and skips the DOM write when nothing changed — otherwise we'd be
 * touching a dozen nodes 60 times a second for nothing.
 */
export class Hud {
  readonly root = $('hud');
  readonly crosshair = $('crosshair');

  private hitmark = $('hitmark');
  private scopeRing = $('scopeRing');
  private killFeed = $('killFeed');
  private vignette = $('vignette');
  private healthFill = $('healthFill');
  private healthText = $('healthText');
  private ammo = $('ammo');
  private ammoPips = $('ammoPips');
  private scoreVal = $('scoreVal');
  private waveVal = $('waveVal');
  private enemyVal = $('enemyVal');
  private reloadBar = $('reloadBar');
  private reloadFill = $('reloadFill');
  private staminaFill = $('staminaFill');
  private levelTag = $('xpLabel');
  private xpBar = $('xpBar');
  private xpFill = $('xpFill');
  private banner = $('banner');
  private bannerBig = $('bannerBig');
  private bannerSub = $('bannerSub');
  private finalStats = $('finalStats');
  private bombWarn = $('bombWarn');
  private bombWarnText = $('bombWarnText');
  private capture = $('capture');
  private captureFill = $('captureFill');
  private newBestBadge = $('newBestBadge');
  private bestRecord = $('bestRecord');

  private pips: HTMLElement[] = [];
  private static MAX_FEED = 3;

  private screens: Record<Exclude<ScreenName, 'none'>, HTMLElement> = {
    [SCREEN.MENU]: $('menuScreen'),
    [SCREEN.PAUSE]: $('pauseScreen'),
    [SCREEN.GAMEOVER]: $('gameOverScreen'),
  };

  private last: Record<string, unknown> = {};
  private bannerTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.refreshBestRecord();
    this.initPips();
  }

  private refreshBestRecord(): void {
    const rec = readRecord();
    this.bestRecord.textContent = rec.score > 0 ? `BEST  SCORE ${rec.score}  ·  WAVE ${rec.wave}` : '';
  }

  private initPips(): void {
    this.ammoPips.replaceChildren();
    this.pips = Array.from({ length: WEAPON.MAG }, () => {
      const pip = document.createElement('span');
      pip.className = 'pip';
      this.ammoPips.appendChild(pip);
      return pip;
    });
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle('on', on);
  }

  showScreen(name: ScreenName): void {
    for (const [key, el] of Object.entries(this.screens)) {
      el.classList.toggle('visible', key === name);
    }
  }

  /** In test mode the overlays are removed outright so they can't be clicked. */
  hideAllScreens(): void {
    for (const el of Object.values(this.screens)) el.style.display = 'none';
  }

  showBanner(big: string, sub = ''): void {
    this.bannerBig.textContent = big;
    this.bannerSub.textContent = sub;
    this.banner.style.opacity = '1';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      this.banner.style.opacity = '0';
    }, FEEDBACK.BANNER_MS);
  }

  markKill(): void {
    this.hitmark.classList.add('kill');
  }

  pushKill(kind: string, headshot: boolean): void {
    const el = document.createElement('div');
    el.className = headshot ? 'kf-entry headshot' : 'kf-entry';
    el.textContent = headshot ? `✦ ${kind.toUpperCase()}` : kind.toUpperCase();
    this.killFeed.appendChild(el);
    while (this.killFeed.children.length > Hud.MAX_FEED) {
      this.killFeed.firstElementChild?.remove();
    }
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  xpPop(value: number): void {
    const el = document.createElement('div');
    el.className = 'xp-pop';
    el.textContent = `+${value}`;
    const x = 50 + (Math.random() - 0.5) * 12;
    el.style.left = `${x}vw`;
    el.style.top = '56vh';
    this.root.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  setADS(aiming: boolean): void {
    if (this.last.aiming !== aiming) {
      this.last.aiming = aiming;
      this.scopeRing.classList.toggle('on', aiming);
    }
  }

  reset(): void {
    this.hitmark.classList.remove('kill');
    this.vignette.style.opacity = '0';
    this.reloadBar.style.opacity = '0';
    this.bombWarn.classList.remove('on');
    this.capture.classList.remove('on');
    this.scopeRing.classList.remove('on');
    this.xpBar.classList.remove('levelup');
    this.last = {};
  }

  setHitmark(hitT: number): void {
    const opacity = Math.max(hitT, 0);
    if (hitT <= 0) this.hitmark.classList.remove('kill');
    if (this.last.hitmark !== opacity) {
      this.last.hitmark = opacity;
      this.hitmark.style.opacity = String(opacity);
    }
  }

  /** Red pulse plus damage vignette, with a floor that kicks in at low HP. */
  setVignette(model: HudModel, elapsed: number): void {
    let opacity = model.vignetteT * FEEDBACK.VIGNETTE_GAIN;
    if (model.state === 'playing' && model.hp < FEEDBACK.LOW_HP) {
      opacity = Math.max(
        opacity,
        FEEDBACK.LOW_HP_VIGNETTE + Math.sin(elapsed * FEEDBACK.LOW_HP_PULSE_HZ) * FEEDBACK.LOW_HP_PULSE,
      );
    }
    if (this.last.vignette === opacity) return;
    this.last.vignette = opacity;
    this.vignette.style.opacity = String(opacity);
  }

  /** Crosshair opens up as bloom accumulates, and steadies when standing still. */
  setCrosshair(bloom: number, moving: boolean, settings: CrosshairSettings): void {
    const gap = settings.bloom
      ? CAMERA.CROSSHAIR_GAP_MIN + (bloom / WEAPON.BLOOM_MAX) * CAMERA.CROSSHAIR_GAP_SPAN
      : settings.gap;
    if (this.last.gap !== gap) {
      this.last.gap = gap;
      this.crosshair.style.setProperty('--gap', `${gap}px`);
    }
    const still = !moving && bloom <= CAMERA.CROSSHAIR_BLOOM_FLOOR;
    const opacity = !still || !settings.dimStill ? 1 : CAMERA.CROSSHAIR_STILL;
    if (this.last.crossOpacity !== opacity) {
      this.last.crossOpacity = opacity;
      this.crosshair.style.opacity = String(opacity);
    }
  }

  update(model: HudModel, settings: CrosshairSettings): void {
    const { hp, score, wave, hostiles } = model;

    if (this.last.hp !== hp) {
      this.last.hp = hp;
      // The bar is a fraction of its track: healing past the max must not
      // push it out of the panel.
      this.healthFill.style.width = `${Math.min(100, hp)}%`;
      this.healthText.textContent = String(Math.min(100, Math.ceil(hp)));
      this.healthFill.style.background =
        hp > 50
          ? 'linear-gradient(90deg,#1fd67a,#7dffb8)'
          : hp > 25
            ? 'linear-gradient(90deg,#d6a71f,#ffd27a)'
            : 'linear-gradient(90deg,#d61f3a,#ff7a7a)';
    }

    if (this.last.ammo !== model.ammo) {
      this.last.ammo = model.ammo;
      this.ammo.innerHTML = `${model.ammo} <small>/ ∞</small>`;
      this.pips.forEach((p, i) => {
        p.classList.toggle('empty', i >= model.ammo);
      });
    }

    if (this.last.score !== score) {
      this.last.score = score;
      this.scoreVal.textContent = String(score);
    }

    if (this.last.wave !== wave) {
      this.last.wave = wave;
      this.waveVal.textContent = String(wave || '–');
    }

    if (this.last.hostiles !== hostiles) {
      this.last.hostiles = hostiles;
      this.enemyVal.textContent = String(hostiles);
    }

    // Hide/show on transition; the fill width is refreshed only while active.
    if (this.last.reloading !== model.reloading) {
      this.last.reloading = model.reloading;
      this.reloadBar.style.opacity = model.reloading ? '1' : '0';
    }
    if (model.reloading) {
      this.reloadFill.style.width = `${model.reloadProgress * 100}%`;
    }

    const stamina = Math.round(model.stamina);
    if (this.last.stamina !== stamina) {
      this.last.stamina = stamina;
      this.staminaFill.style.width = `${stamina}%`;
      this.staminaFill.classList.toggle('low', stamina < 25);
    }

    if (this.last.level !== model.level) {
      // Only a real level-up flashes: the first paint would otherwise fire it
      // at the start of every run.
      const first = this.last.level === undefined;
      this.last.level = model.level;
      this.levelTag.textContent = `LV ${model.level}`;
      if (!first) {
        this.xpBar.classList.remove('levelup');
        void this.xpBar.offsetWidth; // restart the flash animation
        this.xpBar.classList.add('levelup');
      }
    }

    const xpPct = Math.round((model.xp / Math.max(1, model.xpNeed)) * 100);
    if (this.last.xpPct !== xpPct) {
      this.last.xpPct = xpPct;
      this.xpFill.style.width = `${xpPct}%`;
    }

    this.setCrosshair(model.bloom, model.moving, settings);
    this.setThreat(model.bombDist, model.bombFuse);
    this.setCapture(model.captureOn, model.captureProgress);
  }

  /** Hold bar for the live deck; visible while standing on it or still draining. */
  setCapture(on: boolean, progress: number): void {
    const visible = on || progress > 0.01;
    if (this.last.captureOn !== visible) {
      this.last.captureOn = visible;
      this.capture.classList.toggle('on', visible);
    }
    if (!visible) return;
    const pct = Math.round(progress * 100);
    if (this.last.capturePct !== pct) {
      this.last.capturePct = pct;
      this.captureFill.style.width = `${pct}%`;
    }
  }

  /** Red screen pulse plus a countdown while a live bomb is close. */
  setThreat(dist: number, fuse: number): void {
    const on = dist <= BOMB.WARN_RADIUS;
    if (this.last.threatOn !== on) {
      this.last.threatOn = on;
      this.bombWarn.classList.toggle('on', on);
    }
    if (!on) return;
    const label = `⚠ BOMB ${fuse.toFixed(1)}s`;
    if (this.last.threatText !== label) {
      this.last.threatText = label;
      this.bombWarnText.textContent = label;
    }
  }

  setFinalStats(stats: { score: number; wave: number; kills: number }): void {
    this.finalStats.innerHTML = `SCORE <b>${stats.score}</b> &nbsp;·&nbsp; WAVE <b>${stats.wave}</b> &nbsp;·&nbsp; KILLS <b>${stats.kills}</b>`;
    const { isNew } = updateRecord({ score: stats.score, wave: stats.wave });
    this.newBestBadge.style.display = isNew ? 'block' : 'none';
    this.refreshBestRecord();
  }
}
