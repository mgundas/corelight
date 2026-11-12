// Game-side debug wiring (M13 split from Game.ts): owns the wireframe
// toggle state and assembles the debug hotkey dependencies (F1/F3/F4/B/V).
// Kept out of Game so the dev-only SOI teleport adds no Game lines.

import type { PlanetConfig } from '../planets/PlanetConfig.js';
import type { Renderer } from '../render/Renderer.js';
import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import type { DebugOverlay } from '../ui/debugOverlay.js';
import { installDebugKeys } from './debugKeys.js';
import { teleportToVorn } from './devTeleport.js';

export interface GameDebugDeps {
  world: World;
  planets: PlanetConfig[];
  playerId(): EntityId | null;
  overlay: DebugOverlay;
  renderer: Renderer;
  toggleFly(): void;
  /** False while paused or a station panel is open: V must not yank the
   * player away from an open UI / behind the menu (M13 review). */
  enabled(): boolean;
}

/** Install the game debug hotkeys; returns a disposer. */
export function installGameDebugKeys(deps: GameDebugDeps): () => void {
  let wireframe = false;
  return installDebugKeys({
    overlay: deps.overlay,
    toggleFly: deps.toggleFly,
    toggleWireframe: () => {
      wireframe = !wireframe;
      deps.renderer.setWireframe(wireframe);
    },
    toggleBounds: () => deps.renderer.setBoundsVisible(!deps.renderer.bounds.isVisible()),
    devTeleportToVorn: () =>
      deps.enabled() && teleportToVorn(deps.world, deps.planets, deps.playerId()),
  });
}
