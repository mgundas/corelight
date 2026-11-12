// Browser debug handle (M08+): exposes the live sim to the devtools console
// so a blank screen can be diagnosed with facts instead of theories.
// `__corelight.version` proves which code the tab runs; `tethers()` and
// `habitats()` list the entities the views should be drawing. Harmless in
// production (read-only handle, no mutations). Kept out of Game.ts to hold
// the 400-line rule.

import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';

/** Bump on every user-visible fix so stale tabs are instantly detectable. */
export const DEBUG_BUILD = 'm10-power';

export interface ViewItemStat {
  type: string;
  pos: { x: number; y: number; z: number };
  visible: boolean;
}

export interface ViewGroupStat {
  count: number;
  items: ViewItemStat[];
}

/** Structural subset of THREE.Group (no three.js import needed). */
export interface ViewGroupLike {
  readonly children: readonly {
    readonly type: string;
    readonly visible: boolean;
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
  }[];
}

export interface SceneStat {
  tethers: ViewGroupStat;
  cables: ViewGroupStat;
  habitats: ViewGroupStat;
  markers: ViewGroupStat;
  placeables: ViewGroupStat;
}

function statGroup(group: ViewGroupLike): ViewGroupStat {
  return {
    count: group.children.length,
    items: group.children.map((o) => ({
      type: o.type,
      pos: { x: o.position.x, y: o.position.y, z: o.position.z },
      visible: o.visible,
    })),
  };
}

export interface DebugHandle {
  version: string;
  /** Sequential id per Game construction (detects double sessions in one tab). */
  gameId: number;
  flying: () => boolean;
  player: () => EntityId | null;
  playerPos: () => { x: number; y: number; z: number } | null;
  oxygen: () => number | null;
  counts: () => Record<string, number>;
  tethers: () => { id: EntityId; pos: { x: number; y: number; z: number }; live: boolean; links: EntityId[] }[];
  habitats: () => { id: EntityId; pos: { x: number; y: number; z: number } }[];
  /** Live scene-graph state: do the synced views actually hold meshes? */
  scene: () => SceneStat;
}

declare global {
  interface Window {
    __corelight?: DebugHandle;
    __corelight_all?: DebugHandle[];
  }
}

let nextGameId = 1;

/** Install `window.__corelight` for the live session (browser only). */
export function installDebugHandle(  world: World,
  playerId: () => EntityId | null,
  extra: {
    flying: () => boolean;
    views?: () => {
      tethers: ViewGroupLike;
      cables: ViewGroupLike;
      habitats: ViewGroupLike;
      markers: ViewGroupLike;
      placeables: ViewGroupLike;
    };
  },
): void {
  if (typeof window === 'undefined') return;
  const handle: DebugHandle = {
    version: DEBUG_BUILD,
    gameId: nextGameId++,
    flying: extra.flying,
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
    counts: () => {
      const out: Record<string, number> = {};
      for (const entity of world.entities.values()) {
        out[entity.kind] = (out[entity.kind] ?? 0) + 1;
      }
      return out;
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
        .filter((e) => e.kind === 'machine' && e.components.machine?.machineType === 'habitat')
        .map((e) => ({ id: e.id, pos: { ...e.position } })),
    scene: () => {
      const v = extra.views?.();
      const empty: ViewGroupStat = { count: -1, items: [] };
      return {
        tethers: v ? statGroup(v.tethers) : empty,
        cables: v ? statGroup(v.cables) : empty,
        habitats: v ? statGroup(v.habitats) : empty,
        markers: v ? statGroup(v.markers) : empty,
        placeables: v ? statGroup(v.placeables) : empty,
      };
    },
  };
  window.__corelight = handle;
  // Only the live session is kept: past sessions' Worlds would otherwise
  // stay alive forever after Quit to menu -> New game.
  window.__corelight_all = [handle];
}

/** Drop the debug handle (call from Game.stop so dead sessions release). */
export function uninstallDebugHandle(): void {
  if (typeof window === 'undefined') return;
  if (window.__corelight) window.__corelight = undefined;
  window.__corelight_all = [];
}
