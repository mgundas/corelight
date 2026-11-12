// Pause/resume input gating (split from Game.ts). Edges queued while paused
// must never fire on resume, so pausing disables input (which clears every
// queue) and closes transient UI; resuming re-enables unless the debug fly
// camera owns the input.

import type { FreeFlyCamera } from '../player/freeFlyCamera.js';
import type { PlayerInput } from '../player/input.js';
import type { CableMode } from './cableMode.js';
import type { PackHold } from './packHold.js';
import type { PrinterUi } from '../ui/printerUi.js';
import { resetDragStore } from '../ui/stores/dragStore.js';

export interface PauseDeps {
  input: PlayerInput;
  packHold: PackHold;
  cable: CableMode;
  printerUi: PrinterUi;
  flyCamera: FreeFlyCamera;
}

export function applyPaused(deps: PauseDeps, paused: boolean): void {
  if (paused) {
    deps.input.setEnabled(false);
    deps.packHold.reset();
    deps.cable.cancel();
    deps.printerUi.close();
    resetDragStore();
  } else {
    deps.input.setEnabled(!deps.flyCamera.enabled);
  }
}
