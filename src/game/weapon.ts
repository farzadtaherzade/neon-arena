import { WEAPON } from './config';

/** Side effects the weapon needs from outside its own state. */
export interface WeaponHooks {
  /** A bullet left the barrel — resolve the ray, play the shot, flash the muzzle. */
  onShot(): void;
  onDry(): void;
  onReloadStart(): void;
  onReloadEnd(): void;
}

/**
 * Hitscan rifle state: magazine, reload timer, and the recoil/bloom/flash
 * values that drive the viewmodel pose and the crosshair.
 *
 * Pure — it never touches the scene graph. `render/Pick.ts` turns `onShot()`
 * into a ray, and `render/Gun.ts` reads `recoil`/`kick`/`flashT` to pose the
 * viewmodel.
 */
export class Weapon {
  ammo: number = WEAPON.MAG;
  reloading = false;
  /** Right-mouse ADS. Set from outside so the view and shot cone stay in sync. */
  aiming = false;
  reloadT = 0;
  lastShot = -9;
  recoil = 0;
  kick = 0;
  bloom = 0;
  flashT = 0;

  constructor(private readonly hooks: WeaponHooks) {}

  reset(): void {
    this.ammo = WEAPON.MAG;
    this.reloading = false;
    this.reloadT = 0;
    this.lastShot = -9;
    this.recoil = 0;
    this.kick = 0;
    this.bloom = 0;
    this.flashT = 0;
  }

  /** Half-angle of the shot cone, radians. Tighter while aiming down sights. */
  get spread(): number {
    const base = this.aiming ? WEAPON.BASE_SPREAD * WEAPON.AIM_SPREAD : WEAPON.BASE_SPREAD;
    return base + this.bloom;
  }

  /** Reload progress 0..1, for the HUD bar. */
  get reloadProgress(): number {
    return Math.min(this.reloadT / WEAPON.RELOAD_T, 1);
  }

  /** Damage for a hit, before the type's own HP scaling. */
  damage(headshot: boolean): number {
    return WEAPON.DMG * (headshot ? WEAPON.HEAD_MULT : 1);
  }

  startReload(): void {
    if (this.reloading || this.ammo === WEAPON.MAG) return;
    this.reloading = true;
    this.reloadT = 0;
    this.hooks.onReloadStart();
  }

  update(dt: number, elapsed: number, firing: boolean): void {
    this.tickReload(dt);

    if (firing && !this.reloading && elapsed - this.lastShot >= WEAPON.FIRE_T) {
      if (this.ammo > 0) this.shoot(elapsed);
      else {
        this.hooks.onDry();
        this.startReload();
        this.lastShot = elapsed;
      }
    }
    this.decay(dt);
  }

  private tickReload(dt: number): void {
    if (!this.reloading) return;
    this.reloadT += dt;
    if (this.reloadT >= WEAPON.RELOAD_T) {
      this.reloading = false;
      this.ammo = WEAPON.MAG;
      this.hooks.onReloadEnd();
    }
  }

  private decay(dt: number): void {
    this.recoil *= Math.exp(-WEAPON.RECOIL_DECAY * dt);
    this.kick *= Math.exp(-WEAPON.KICK_DECAY * dt);
    this.bloom *= Math.exp(-WEAPON.BLOOM_DECAY * dt);
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
  }

  private shoot(elapsed: number): void {
    this.ammo--;
    this.lastShot = elapsed;
    this.recoil = Math.min(this.recoil + WEAPON.RECOIL_PER_SHOT, WEAPON.RECOIL_MAX);
    this.kick = Math.min(this.kick + WEAPON.KICK_PER_SHOT, WEAPON.KICK_MAX);
    this.bloom = Math.min(this.bloom + WEAPON.BLOOM_PER_SHOT, WEAPON.BLOOM_MAX);
    this.flashT = WEAPON.FLASH_T;
    this.hooks.onShot();
    if (this.ammo <= 0) this.startReload();
  }
}
