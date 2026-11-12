// HUD presentation store (React port). The Game pushes a read-only
// projection of World state here at a throttled rate; components render from
// it. Nothing in the sim reads this store.

import { create } from 'zustand';
import type { PowerStatus } from '../../game/powerStatus.js';
import type { NavHint } from '../../game/oxygenStatus.js';

export interface HudSlotView {
  /** Canonical item id (drag rules need it; display uses name/color). */
  itemId: string;
  name: string;
  color: string;
}

export interface HudViewState {
  slots: (HudSlotView | null)[];
  selectedSlot: number;
  soil: number;
  prompt: string | null;
  oxygen: number;
  onNetwork: boolean;
  habitatHint: NavHint | null;
  deathHint: NavHint | null;
  power: PowerStatus | null;
  toolMode: 'cursor' | 'deform';
  brushMode: 'dig' | 'add';
  /** Incremented on death; the fade element remounts per token. */
  deathFadeToken: number;
  /** Short "New blueprint: …" message (M11), null when hidden. */
  toast: string | null;
  /** Incremented per toast so the CSS animation replays. */
  toastToken: number;
}

const INITIAL: HudViewState = {
  slots: [],
  selectedSlot: 0,
  soil: 0,
  prompt: null,
  oxygen: 100,
  onNetwork: true,
  habitatHint: null,
  deathHint: null,
  power: null,
  toolMode: 'cursor',
  brushMode: 'dig',
  deathFadeToken: 0,
  toast: null,
  toastToken: 0,
};

export const useHudStore = create<HudViewState>(() => ({ ...INITIAL }));

export function setHudView(
  state: Omit<HudViewState, 'deathFadeToken' | 'toast' | 'toastToken'>,
): void {
  useHudStore.setState(state);
}

export function triggerDeathFade(): void {
  useHudStore.setState((s) => ({ deathFadeToken: s.deathFadeToken + 1 }));
}

export function showHudToast(text: string): void {
  useHudStore.setState((s) => ({ toast: text, toastToken: s.toastToken + 1 }));
}

export function clearHudToast(): void {
  useHudStore.setState({ toast: null });
}

export function resetHudView(): void {
  useHudStore.setState({ ...INITIAL });
}
