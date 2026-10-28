import { PERK_DEFS, type PerkId } from '../game/config';

/** One card on the perk screen: the perk, what it does, what the player owns. */
export interface PerkCard {
  id: PerkId;
  name: string;
  flavour: string;
  /** Stacks already owned, before this pick. */
  stacks: number;
}

export interface PerkScreenHooks {
  onPick(id: PerkId): void;
}

/**
 * The level-up perk offer.
 *
 * Owns its own visibility, exactly like `MapScreen`: `Game` pauses the run
 * behind it and hands in the offer; a click (or the 1/2/3 keys, routed through
 * `Input`) picks a card. It holds no game logic — the pick goes straight back
 * to `Game`.
 */
export class PerkScreen {
  private root = document.getElementById('perkScreen');
  private title = document.getElementById('perkTitle');
  private cards = document.getElementById('perkCards');

  constructor(private readonly hooks: PerkScreenHooks) {}

  show(level: number, offer: readonly PerkCard[]): void {
    if (!this.root || !this.title || !this.cards) return;
    this.title.textContent = `LEVEL ${level}`;
    this.cards.replaceChildren();
    offer.forEach((perk, i) => {
      const card = document.createElement('button');
      card.className = 'perk-card';
      card.type = 'button';

      const num = document.createElement('span');
      num.className = 'perk-num';
      num.textContent = String(i + 1);

      const name = document.createElement('span');
      name.className = 'perk-name';
      name.textContent = perk.name;

      const flavour = document.createElement('span');
      flavour.className = 'perk-flavour';
      flavour.textContent = perk.flavour;

      const stacks = document.createElement('span');
      stacks.className = 'perk-stacks';
      stacks.textContent = perk.stacks > 0 ? `OWNED ×${perk.stacks} → ×${perk.stacks + 1}` : 'NEW';

      card.append(num, name, flavour, stacks);
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hooks.onPick(perk.id);
      });
      this.cards!.appendChild(card);
    });
    this.root.classList.add('visible');
  }

  hide(): void {
    this.root?.classList.remove('visible');
  }
}

/** The perk's display strings, for the HUD tags and the offer cards. */
export function perkDef(id: PerkId): (typeof PERK_DEFS)[number] | undefined {
  return PERK_DEFS.find((d) => d.id === id);
}
