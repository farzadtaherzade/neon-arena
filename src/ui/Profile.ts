/**
 * The player profile: the credits wallet, what has been unlocked and what is
 * equipped.
 *
 * It lives next to the best record in local storage, so the credits survive a
 * death — the run score is a leaderboard number, the wallet is a career one.
 * Everything here is wrapped in try/catch because local storage can be blocked
 * (private windows, a full disk) and a shop must never break the game.
 */

import { SKINS, type SkinDef, type SkinWeapon } from '../game/config';

const KEY = 'neon.profile';

export interface ProfileData {
  /** The wallet. */
  credits: number;
  /** The ids of the skins the player owns. */
  unlocked: string[];
  /** One equipped skin per weapon; an empty id is the standard issue. */
  equipped: Record<SkinWeapon, string>;
}

export function defaultProfile(): ProfileData {
  return { credits: 0, unlocked: [], equipped: { rifle: '', knife: '' } };
}

/** The skin with this id, or null. */
export function findSkin(id: string): SkinDef | null {
  return SKINS.find((s) => s.id === id) ?? null;
}

export function readProfile(store: Pick<Storage, 'getItem'>): ProfileData {
  const base = defaultProfile();
  try {
    const raw = store.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw);
    const known = new Set<string>(SKINS.map((s) => s.id));
    const unlocked = Array.isArray(p?.unlocked)
      ? p.unlocked.filter((id: unknown): id is string => typeof id === 'string' && known.has(id))
      : [];
    const equipped: Record<SkinWeapon, string> = { rifle: '', knife: '' };
    for (const weapon of ['rifle', 'knife'] as const) {
      const id = p?.equipped?.[weapon];
      if (typeof id === 'string' && (id === '' || known.has(id))) equipped[weapon] = id;
    }
    return {
      credits: typeof p?.credits === 'number' && p.credits >= 0 ? p.credits : 0,
      unlocked,
      equipped,
    };
  } catch {
    return base;
  }
}

export function writeProfile(store: Pick<Storage, 'setItem'>, data: ProfileData): void {
  try {
    store.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage blocked or full — the credits still count for this session.
  }
}

/** The persisted wallet and loadout. */
export class Profile {
  data: ProfileData;

  constructor(private readonly store: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {
    this.data = readProfile(store);
  }

  save(): void {
    writeProfile(this.store, this.data);
  }

  /** Bank credits. The wallet is flushed on every payout, so a crash loses nothing. */
  addCredits(amount: number): void {
    if (amount <= 0) return;
    this.data.credits += amount;
    this.save();
  }

  owns(id: string): boolean {
    return this.data.unlocked.includes(id);
  }

  /** Buy a skin. Returns false when it is unknown, already owned or too dear. */
  buy(id: string): boolean {
    const skin = findSkin(id);
    if (!skin || this.owns(id)) return false;
    if (this.data.credits < skin.price) return false;
    this.data.credits -= skin.price;
    this.data.unlocked.push(id);
    this.save();
    return true;
  }

  /** Equip an owned skin on its own weapon slot. */
  equip(id: string): boolean {
    const skin = findSkin(id);
    if (!skin) return false;
    if (id !== '' && !this.owns(id)) return false;
    this.data.equipped[skin.weapon] = id;
    this.save();
    return true;
  }

  /** The equipped skin of a weapon, or null for the standard issue. */
  equippedSkin(weapon: SkinWeapon): SkinDef | null {
    return findSkin(this.data.equipped[weapon]);
  }
}
