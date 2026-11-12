// Backpack HUD state bridge (React port). Game/frameHud builds the read-only
// projection; this class diffs it and writes the zustand store. The React
// component renders the store — no DOM is owned here.

import { TOAST_DURATION_MS } from '../core/constants.js';
import type { ItemDef } from '../data/loadData.js';
import type { PowerStatus } from '../game/powerStatus.js';
import type { NavHint } from '../game/oxygenStatus.js';
import {
  clearHudToast,
  resetHudView,
  setHudView,
  showHudToast,
  triggerDeathFade,
} from './stores/hudStore.js';

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
  /** Network stats for the aimed machine, else null. */
  power: PowerStatus | null;
  /** Terrain tool equipped (Q) and its add/deform sub-mode (X). */
  toolMode: 'cursor' | 'deform';
  brushMode: 'dig' | 'add';
}

export class Hud {
  private lastKey = '';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  /** Black out, then fade back (the respawn already happened sim-side). */
  showDeathFade(): void {
    triggerDeathFade();
  }

  /** Short unlock/notification toast; a new toast restarts the timer. */
  showToast(text: string): void {
    showHudToast(text);
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      clearHudToast();
    }, TOAST_DURATION_MS);
  }

  update(state: HudState): void {
    const power = state.power;
    // Cheap key skips store writes when nothing visible changed.
    const key = [
      state.selectedSlot,
      state.soil,
      state.prompt ?? '',
      state.oxygen,
      state.onNetwork,
      state.habitatHint ? `${state.habitatHint.label}${state.habitatHint.distM}${state.habitatHint.bearingDeg}` : '',
      state.deathHint ? `${state.deathHint.label}${state.deathHint.distM}${state.deathHint.bearingDeg}` : '',
      power
        ? `${power.generation.toFixed(1)}:${power.demand.toFixed(1)}:${power.stored.toFixed(1)}:${power.capacity}:${power.state}`
        : '',
      state.toolMode,
      state.brushMode,
      ...state.slots.map((d) => d?.id ?? ''),
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    setHudView({
      slots: state.slots.map((def) =>
        def ? { itemId: def.id, name: def.name, color: def.color } : null,
      ),
      selectedSlot: state.selectedSlot,
      soil: state.soil,
      prompt: state.prompt,
      oxygen: state.oxygen,
      onNetwork: state.onNetwork,
      habitatHint: state.habitatHint,
      deathHint: state.deathHint,
      power: state.power,
      toolMode: state.toolMode,
      brushMode: state.brushMode,
    });
  }

  dispose(): void {
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    resetHudView();
    this.lastKey = '';
  }
}
