// Backpack HUD state bridge (React port). Game/frameHud builds the read-only
// projection; this class diffs it and writes the zustand store. The React
// component renders the store — no DOM is owned here.

import { TOAST_DURATION_MS } from '../core/constants.js';
import type { ItemDef } from '../data/loadData.js';
import type { PowerStatus } from '../game/powerStatus.js';
import type { NavHint } from '../game/oxygenStatus.js';
import type { FlightStatus } from '../game/shuttleHud.js';
import type { DrillTier } from '../sim/drill.js';
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
  /** Mantle heat: render the orange vignette (M12). */
  heat: boolean;
  /** Cold layer: render the icy blue tint (M13). */
  cold: boolean;
  /** Where the habitat is (off-network only), else null. */
  habitatHint: NavHint | null;
  /** Where the lost pack waits, else null. */
  deathHint: NavHint | null;
  /** Network stats for the aimed machine, else null. */
  power: PowerStatus | null;
  /** Terrain tool equipped (Q) and its add/deform sub-mode (X). */
  toolMode: 'cursor' | 'deform';
  interactionMode: 'explore' | 'terrain' | 'cable' | 'place' | 'carry';
  brushMode: 'dig' | 'add';
  /** Current drill tier (M12): from the selected backpack slot. */
  drillTier: DrillTier;
  /** Shuttle flight readout while piloting (M14), else null. */
  flight: FlightStatus | null;
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
      state.heat,
      state.cold,
      state.habitatHint ? `${state.habitatHint.label}${state.habitatHint.distM}${state.habitatHint.bearingDeg}` : '',
      state.deathHint ? `${state.deathHint.label}${state.deathHint.distM}${state.deathHint.bearingDeg}` : '',
      power
        ? `${power.generation.toFixed(1)}:${power.demand.toFixed(1)}:${power.stored.toFixed(1)}:${power.capacity}:${power.state}`
        : '',
      state.toolMode,
      state.interactionMode,
      state.brushMode,
      state.drillTier,
      state.flight
        ? [
            Math.round(state.flight.speedMps),
            Math.round(state.flight.altitudeM),
            state.flight.fuel,
            state.flight.launchCharge.toFixed(2),
            state.flight.landed,
            ...state.flight.planets.map((p) => `${p.label}:${Math.round(p.distanceM)}:${Math.round(p.bearingDeg)}`),
            ...state.flight.habitats.map((h) => `${h.label}:${Math.round(h.distanceM)}:${Math.round(h.bearingDeg)}`),
          ].join(':')
        : '',
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
      heat: state.heat,
      cold: state.cold,
      habitatHint: state.habitatHint,
      deathHint: state.deathHint,
      power: state.power,
      toolMode: state.toolMode,
      interactionMode: state.interactionMode,
      brushMode: state.brushMode,
      drillTier: state.drillTier,
      flight: state.flight,
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
