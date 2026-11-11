// Backpack HUD (M07): slot bar with the 8 carried items, soil counter and
// the interaction prompt. Plain DOM (ARCHITECTURE.md: no framework). The
// Game rebuilds the state every frame; update() reconciles cheaply.

import type { ItemDef } from '../data/loadData.js';

export interface HudState {
  /** Resolved definitions per slot (null = empty). */
  slots: (ItemDef | null)[];
  selectedSlot: number;
  soil: number;
  /** e.g. "E: pick up Resin" when an item is aimed, else null. */
  prompt: string | null;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly slotsEl: HTMLDivElement;
  private readonly slotEls: HTMLDivElement[] = [];
  private readonly soilEl: HTMLDivElement;
  private readonly promptEl: HTMLDivElement;
  private lastKey = '';

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
    this.soilEl = document.createElement('div');
    this.soilEl.id = 'hud-soil';
    this.promptEl = document.createElement('div');
    this.promptEl.id = 'hud-prompt';
    this.root.append(this.slotsEl, this.soilEl, this.promptEl);
    document.body.appendChild(this.root);
  }

  update(state: HudState): void {
    // Cheap key skips DOM writes when nothing visible changed.
    const key = [
      state.selectedSlot,
      state.soil,
      state.prompt ?? '',
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
  }

  dispose(): void {
    this.root.remove();
  }
}
