// Debug hotkeys (F1 overlay, F3 fly, F4 wireframe, B bounds, V dev teleport).
// F5 is deliberately NOT handled: the browser must keep it for page refresh.

import type { DebugOverlay } from '../ui/debugOverlay.js';

export interface DebugKeyDeps {
  overlay: DebugOverlay;
  toggleFly(): void;
  toggleWireframe(): void;
  toggleBounds(): void;
  /** ?dev=1 only: teleport the player to Vorn's surface (V). Returns true
   * when a teleport was actually dispatched (gates preventDefault). */
  devTeleportToVorn(): boolean;
}

/** Handle one keydown; exported so the gating is unit-testable without DOM. */
export function handleDebugKey(
  e: { code: string; preventDefault(): void },
  deps: DebugKeyDeps,
): void {
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
  } else if (e.code === 'KeyV') {
    // M13 debug: Vorn is a long flight away; this must also work while
    // flying (the window listener is independent of player input). The key
    // is only swallowed when the dev teleport actually fires, so normal play
    // keeps V for future bindings.
    if (deps.devTeleportToVorn()) e.preventDefault();
  }
}

/** Install the window keydown listener; returns a disposer. */
export function installDebugKeys(deps: DebugKeyDeps): () => void {
  const onKey = (e: KeyboardEvent): void => handleDebugKey(e, deps);
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
