import { PERK_DEFS, PERKS, type PerkId } from '../game/config';

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
 * Inline-SVG icon per perk — inner markup for a 24×24 stroke drawing, in the
 * exact pattern the crosshair shapes use (`Settings.ts` SHAPE_SVG). Stroke and
 * glow come from the CSS accent, so a theme swap recolors them for free.
 */
const PERK_ICONS: Record<PerkId, string> = {
  // Double chevron: faster feet.
  overclock: '<path d="M5 5l7 7-7 7"/><path d="M13 5l7 7-7 7"/>',
  // A magazine with follower lines.
  lightmag: '<path d="M7 3h10v13a5 5 0 0 1-5 5 5 5 0 0 1-5-5V3z"/><path d="M7 8h10"/><path d="M7 12h10"/>',
  // Shield.
  plating: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/>',
  // Lightning bolt.
  adrenaline: '<path d="M13 2L5 14h6l-2 8 8-12h-6l2-8z"/>',
  // A fat cartridge with impact ticks.
  heavy: '<path d="M9 4h6v9a3 3 0 0 1-6 0V4z"/><path d="M7 20h10"/><path d="M4 8h3M4 12h3M17 8h3M17 12h3"/>',
  // Horseshoe magnet with pole caps.
  magnet: '<path d="M7 3v8a5 5 0 0 0 10 0V3"/><path d="M6 3h5M13 3h5"/><path d="M6 7h5M13 7h5"/>',
  // Snowflake: three axes.
  coolant: '<path d="M12 3v18"/><path d="M4.2 7.5l15.6 9"/><path d="M19.8 7.5l-15.6 9"/>',
  // Ammo crate with lid and handle.
  scavenger: '<path d="M4 9h16v11H4V9z"/><path d="M4 9l2-4h12l2 4"/><path d="M10 13h4"/>',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** "MOVE +15%" at 0 stacks, "MOVE +15% → +30%" once a stack is owned. */
function perkValueLine(id: PerkId, stacks: number): string {
  const pct = (n: number): string => `+${Math.round(n * 100)}%`;
  const cut = (n: number): string => `−${Math.round(n * 100)}%`;
  const both = (fmt: (n: number) => string, per: number): string => {
    const a = fmt(per * stacks);
    const b = fmt(per * (stacks + 1));
    return stacks > 0 ? `${a} → ${b}` : b;
  };
  switch (id) {
    case 'overclock':
      return `MOVE ${both(pct, PERKS.MOVE_SPEED)}`;
    case 'lightmag':
      return `RELOAD ${both(cut, PERKS.RELOAD_CUT)}`;
    case 'plating':
      return `MAX HP ${both((n) => `+${n}`, PERKS.MAX_HP_BONUS)}`;
    case 'adrenaline':
      return `STAMINA REGEN ${both(pct, PERKS.STAMINA_REGEN)}`;
    case 'heavy':
      return `DAMAGE ${both(pct, PERKS.DAMAGE)}`;
    case 'magnet':
      return `XP PULL ${both(pct, PERKS.XP_RADIUS)}`;
    case 'coolant':
      return `BLOOM ${both(cut, PERKS.BLOOM_CUT)}`;
    case 'scavenger':
      return `AMMO DROPS ${both(pct, PERKS.AMMO_DROP)}`;
  }
}

/**
 * The level-up perk offer.
 *
 * Owns its own visibility, exactly like `MapScreen`: `Game` pauses the run
 * behind it and hands in the offer; a click, the 1/2/3 keys, or the arrow keys
 * + Enter picks a card. While visible it listens for those arrow keys itself
 * (Tab is taken by the map toggle), and stops listening the moment it hides.
 */
export class PerkScreen {
  private root = document.getElementById('perkScreen');
  private title = document.getElementById('perkTitle');
  private cards = document.getElementById('perkCards');

  /** The live offer's ids and the highlighted card — the arrow keys' target. */
  private offerIds: PerkId[] = [];
  private highlight = 0;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly hooks: PerkScreenHooks) {}

  show(level: number, offer: readonly PerkCard[]): void {
    if (!this.root || !this.title || !this.cards) return;
    this.title.textContent = `LEVEL ${level}`;
    this.offerIds = offer.map((p) => p.id);
    this.highlight = 0;
    this.cards.replaceChildren();
    offer.forEach((perk, i) => {
      const card = document.createElement('button');
      card.className = 'perk-card';
      card.type = 'button';

      const num = document.createElement('span');
      num.className = 'perk-num';
      num.textContent = String(i + 1);

      const icon = document.createElement('span');
      icon.className = 'perk-icon';
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.innerHTML = PERK_ICONS[perk.id];
      icon.appendChild(svg);

      const name = document.createElement('span');
      name.className = 'perk-name';
      name.textContent = perk.name;

      const value = document.createElement('span');
      value.className = 'perk-value';
      value.textContent = perkValueLine(perk.id, perk.stacks);

      const pips = document.createElement('span');
      pips.className = 'perk-pips';
      for (let s = 0; s < PERKS.STACK_MAX; s++) {
        const pip = document.createElement('i');
        pip.className = s < perk.stacks ? 'pip' : 'pip empty';
        pips.appendChild(pip);
      }

      card.append(num, icon, name, value, pips);
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hooks.onPick(perk.id);
      });
      this.cards!.appendChild(card);
    });
    this.paintHighlight();
    this.root.classList.add('visible');

    if (!this.keyHandler) {
      this.keyHandler = (e: KeyboardEvent) => this.onKey(e);
      addEventListener('keydown', this.keyHandler);
    }
  }

  hide(): void {
    this.root?.classList.remove('visible');
    if (this.keyHandler) {
      removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.offerIds = [];
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat) return;
    const count = this.offerIds.length;
    if (count === 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.highlight = (this.highlight + 1) % count;
      this.paintHighlight();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.highlight = (this.highlight + count - 1) % count;
      this.paintHighlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const id = this.offerIds[this.highlight];
      if (id) this.hooks.onPick(id);
    }
  }

  /** The keyboard's highlighted card — same visual language as hover. */
  private paintHighlight(): void {
    if (!this.cards) return;
    Array.from(this.cards.children).forEach((card, i) => {
      card.classList.toggle('hl', i === this.highlight);
    });
  }
}

/** The perk's display strings, for the HUD tags and the offer cards. */
export function perkDef(id: PerkId): (typeof PERK_DEFS)[number] | undefined {
  return PERK_DEFS.find((d) => d.id === id);
}
