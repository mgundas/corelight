// Debug hotkeys (F1 overlay, F3 fly, F4 wireframe, B bounds). F5 is
// deliberately NOT handled: the browser must keep it for page refresh.

import type { DebugOverlay } from '../ui/debugOverlay.js';

export interface DebugKeyDeps {
  overlay: DebugOverlay;
  toggleFly(): void;
  toggleWireframe(): void;
  toggleBounds(): void;
}

/** Install the window keydown listener; returns a disposer. */
export function installDebugKeys(deps: DebugKeyDeps): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'F1') {
      e.preventDefault();
      deps.overlay.toggle();
    } else if (e.code === 'F3') {
      e.preventDefault();
      deps.toggleFly();
    } else if (e.code === 'F4') {
      e.preventDefault();
      deps.toggleWireframe();
    } else if (e.code === 'KeyB') {
      // B (not F5): F5 must reach the browser so the page can refresh.
      e.preventDefault();
      deps.toggleBounds();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
