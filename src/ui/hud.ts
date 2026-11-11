// Backpack HUD (M07): slot bar with the 8 carried items, soil counter and
// the interaction prompt. Plain DOM (ARCHITECTURE.md: no framework). The
// Game rebuilds the state every frame; update() reconciles cheaply.

import type { ItemDef } from '../data/loadData.js';
import { arrowForBearing, type NavHint } from '../game/oxygenStatus.js';

export interface HudState {
  /** Resolved definitions per slot (null = empty). */
  slots: (ItemDef | null)[];
  selectedSlot: number;
  soil: number;
  /** e.g. "E: pick up Resin" when an item is aimed, else null. */
  prompt: string | null;
  /** 0..100 suit oxygen. */
  oxygen: number;
  /** Inside a live tether/habitat network. */
  onNetwork: boolean;
  /** Where the habitat is (off-network only), else null. */
  habitatHint: NavHint | null;
  /** Where the lost pack waits, else null. */
  deathHint: NavHint | null;
}

function hintText(hint: NavHint | null): string {
  if (!hint) return '';
  return `${hint.label} ${Math.round(hint.distM)}m ${arrowForBearing(hint.bearingDeg)}`;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly slotsEl: HTMLDivElement;
  private readonly slotEls: HTMLDivElement[] = [];
  private readonly soilEl: HTMLDivElement;
  private readonly promptEl: HTMLDivElement;
  private readonly oxygenEl: HTMLDivElement;
  private readonly oxygenFill: HTMLDivElement;
  private readonly tetherEl: HTMLDivElement;
  private readonly navEl: HTMLDivElement;
  private readonly deathFade: HTMLDivElement;
  private lastKey = '';
  private fadeTimer = 0;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.slotsEl = document.createElement('div');
    this.slotsEl.id = 'hud-slots';
    for (let i = 0; i < 8; i += 1) {
      const slot = document.createElement('div');
      slot.className = 'hud-slot';
      slot.textContent = String(i + 1);
      this.slotEls.push(slot);
      this.slotsEl.appendChild(slot);
    }
    this.oxygenEl = document.createElement('div');
    this.oxygenEl.id = 'hud-oxygen';
    this.oxygenFill = document.createElement('div');
    this.oxygenFill.id = 'hud-oxygen-fill';
    this.oxygenEl.appendChild(this.oxygenFill);
    this.tetherEl = document.createElement('div');
    this.tetherEl.id = 'hud-tether';
    this.soilEl = document.createElement('div');
    this.soilEl.id = 'hud-soil';
    this.promptEl = document.createElement('div');
    this.promptEl.id = 'hud-prompt';
    this.navEl = document.createElement('div');
    this.navEl.id = 'hud-nav';
    this.root.append(this.oxygenEl, this.tetherEl, this.slotsEl, this.soilEl, this.promptEl, this.navEl);
    document.body.appendChild(this.root);
    // Fullscreen fade for oxygen death (M08): shown on playerDied, then
    // eases back out while the player wakes at the habitat.
    this.deathFade = document.createElement('div');
    this.deathFade.id = 'death-fade';
    document.body.appendChild(this.deathFade);
  }

  /** Black out, then fade back (the respawn already happened sim-side). */
  showDeathFade(): void {
    window.clearTimeout(this.fadeTimer);
    this.deathFade.style.transition = 'none';
    this.deathFade.style.opacity = '1';
    // Reflow so the transition below animates from black.
    void this.deathFade.offsetWidth;
    this.deathFade.style.transition = 'opacity 1.6s ease-out';
    this.deathFade.style.opacity = '0';
    this.fadeTimer = window.setTimeout(() => {
      this.deathFade.style.opacity = '0';
    }, 1700);
  }

  update(state: HudState): void {
    // Cheap key skips DOM writes when nothing visible changed.
    const key = [
      state.selectedSlot,
      state.soil,
      state.prompt ?? '',
      state.oxygen,
      state.onNetwork,
      hintText(state.habitatHint),
      hintText(state.deathHint),
      ...state.slots.map((d) => d?.id ?? ''),
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (let i = 0; i < this.slotEls.length; i += 1) {
      const el = this.slotEls[i] as HTMLDivElement;
      const def = state.slots[i] ?? null;
      el.classList.toggle('selected', i === state.selectedSlot);
      el.classList.toggle('filled', def !== null);
      el.textContent = def ? `${i + 1} ${def.name}` : String(i + 1);
      el.title = def ? def.name : 'Empty slot';
      el.style.setProperty('--slot-color', def ? def.color : 'transparent');
    }
    this.soilEl.textContent = `Soil ${state.soil}`;
    this.promptEl.textContent = state.prompt ?? '';
    this.promptEl.style.display = state.prompt ? 'block' : 'none';
    // Oxygen bar: red and pulsing below 25.
    this.oxygenFill.style.width = `${Math.max(0, Math.min(100, state.oxygen))}%`;
    this.oxygenEl.classList.toggle('low', state.oxygen < 25);
    this.oxygenEl.title = `Oxygen ${Math.ceil(state.oxygen)}`;
    // Tether range indicator: green on a live network, red off it.
    this.tetherEl.textContent = state.onNetwork ? 'O₂ ●' : 'O₂ ○';
    this.tetherEl.classList.toggle('live', state.onNetwork);
    // Habitat + lost-pack directions (only the hints that exist show).
    const parts = [hintText(state.habitatHint), hintText(state.deathHint)].filter((p) => p !== '');
    this.navEl.textContent = parts.join('   ');
    this.navEl.style.display = parts.length > 0 ? 'block' : 'none';
  }

  dispose(): void {
    this.root.remove();
    this.deathFade.remove();
    window.clearTimeout(this.fadeTimer);
  }
}
