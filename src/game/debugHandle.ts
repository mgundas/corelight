// Browser debug handle (M08+): exposes the live sim to the devtools console
// so a blank screen can be diagnosed with facts instead of theories.
// `__corelight.version` proves which code the tab runs; `tethers()` and
// `habitats()` list the entities the views should be drawing. Harmless in
// production (read-only handle, no mutations). Kept out of Game.ts to hold
// the 400-line rule.

import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';

/** Bump on every user-visible fix so stale tabs are instantly detectable. */
export const DEBUG_BUILD = 'm08-fix4-raycast';

export interface DebugHandle {
  version: string;
  player: () => EntityId | null;
  playerPos: () => { x: number; y: number; z: number } | null;
  oxygen: () => number | null;
  tethers: () => { id: EntityId; pos: { x: number; y: number; z: number }; live: boolean; links: EntityId[] }[];
  habitats: () => { id: EntityId; pos: { x: number; y: number; z: number } }[];
}

/** Install `window.__corelight` for the live session (browser only). */
export function installDebugHandle(world: World, playerId: () => EntityId | null): void {
  if (typeof window === 'undefined') return;
  const handle: DebugHandle = {
    version: DEBUG_BUILD,
    player: () => playerId(),
    playerPos: () => {
      const id = playerId();
      const pos = id ? world.entities.get(id)?.position : undefined;
      return pos ? { ...pos } : null;
    },
    oxygen: () => {
      const id = playerId();
      return id ? (world.entities.get(id)?.components.oxygen?.value ?? null) : null;
    },
    tethers: () =>
      [...world.entities.values()]
        .filter((e) => e.kind === 'tether')
        .map((e) => ({
          id: e.id,
          pos: { ...e.position },
          live: e.components.tether?.live ?? false,
          links: [...(e.components.tether?.links ?? [])],
        })),
    habitats: () =>
      [...world.entities.values()]
        .filter((e) => e.kind === 'machine')
        .map((e) => ({ id: e.id, pos: { ...e.position } })),
  };
  (window as unknown as { __corelight?: DebugHandle }).__corelight = handle;
}
