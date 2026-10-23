/**
 * The skin shop: a grid of swatch cards, one per skin.
 *
 * A card shows the skin's name, its flavour, its four colours, the part it
 * swaps and what it costs. There is no 3D preview — the colours and the part
 * name are the pitch, and the player sees the real thing in the next run.
 *
 * The shop only ever shows outside a live run: the settings panel pauses the
 * game when it opens, so nothing here can be bought mid-fight.
 */

import { type KnifeBlade, type RifleOptic, SKINS, type SkinDef } from '../game/config';
import type { ProfileData } from './Profile';

const PART_NAMES: Record<RifleOptic | KnifeBlade, string> = {
  iron: 'IRON SIGHTS',
  reddot: 'RED DOT',
  holo: 'HOLO SIGHT',
  scope: 'SCOPE',
  straight: 'STRAIGHT BLADE',
  cleaver: 'CLEAVER',
  saw: 'SAW BLADE',
  hook: 'HOOK BLADE',
};

export interface SkinsHooks {
  /** The current wallet and loadout. */
  getProfile(): ProfileData;
  /** Buy a skin; the shop re-reads the profile afterwards. */
  onBuy(id: string): void;
  /** Equip a skin the player already owns. */
  onEquip(id: string): void;
}

export class Skins {
  private list = document.getElementById('skinList')!;
  private balance = document.getElementById('creditBalance')!;
  private cards: { skin: SkinDef; root: HTMLElement; button: HTMLButtonElement }[] = [];

  constructor(private readonly hooks: SkinsHooks) {
    this.build();
  }

  private build(): void {
    for (const skin of SKINS) {
      const root = document.createElement('div');
      root.className = 'skincard';

      const head = document.createElement('div');
      head.className = 'skinhead';
      const name = document.createElement('span');
      name.className = 'skname';
      name.textContent = skin.name;
      const weapon = document.createElement('span');
      weapon.className = 'skweap';
      weapon.textContent = skin.weapon === 'rifle' ? 'RIFLE' : 'KNIFE';
      head.append(name, weapon);

      const flavour = document.createElement('div');
      flavour.className = 'skflav';
      flavour.textContent = skin.flavour;

      const chips = document.createElement('div');
      chips.className = 'skchips';
      for (const colour of [skin.palette.metal, skin.palette.dark, skin.palette.glow, skin.palette.hazard]) {
        const chip = document.createElement('i');
        chip.style.background = `#${colour.toString(16).padStart(6, '0')}`;
        chips.appendChild(chip);
      }

      const foot = document.createElement('div');
      foot.className = 'skinfoot';
      const part = document.createElement('span');
      part.className = 'skpart';
      part.textContent = PART_NAMES[skin.part];
      const price = document.createElement('span');
      price.className = 'skprice';
      price.textContent = String(skin.price);
      const button = document.createElement('button');
      button.className = 'btn';
      button.type = 'button';
      button.addEventListener('click', () => {
        if (this.hooks.getProfile().unlocked.includes(skin.id)) this.hooks.onEquip(skin.id);
        else this.hooks.onBuy(skin.id);
        this.refresh();
      });
      foot.append(part, price, button);

      root.append(head, flavour, chips, foot);
      this.list.appendChild(root);
      this.cards.push({ skin, root, button });
    }
  }

  /** Re-read the profile and repaint every card. */
  refresh(): void {
    const profile = this.hooks.getProfile();
    this.balance.textContent = String(profile.credits);
    for (const card of this.cards) {
      const owned = profile.unlocked.includes(card.skin.id);
      const equipped = profile.equipped[card.skin.weapon] === card.skin.id;
      const affordable = profile.credits >= card.skin.price;
      card.button.textContent = equipped ? 'EQUIPPED' : owned ? 'EQUIP' : 'BUY';
      card.button.disabled = equipped || (!owned && !affordable);
      card.button.classList.toggle('primary', owned && !equipped);
      card.root.classList.toggle('owned', owned);
      card.root.classList.toggle('equipped', equipped);
      card.root.classList.toggle('locked', !owned && !affordable);
    }
  }
}
