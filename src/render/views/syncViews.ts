// Per-frame entity view fan-out. WHY a snapshot: Map.values() iterators are
// single-use — handing one iterator to several sequential syncs lets the
// first view eat it and starves the rest (their groups stay empty forever,
// with no error). That was the M08 invisible-tether/habitat bug. Snapshot
// once per frame so every view sees the identical set.

import type { Entity } from '../../sim/entities.js';
import type { ItemEmitter } from './itemView.js';

/** Structural view surface: the real view classes satisfy this exactly. */
export interface EntityViews {
  itemViews: { sync(entities: Iterable<Entity>): ItemEmitter[] };
  nodeViews: { sync(entities: Iterable<Entity>): ItemEmitter[] };
  placeableViews: {
    sync(entities: Iterable<Entity>, sunDirWorld?: { x: number; y: number; z: number }): ItemEmitter[];
  };
  tetherViews: { sync(entities: Iterable<Entity>): void };
  habitatViews: { sync(entities: Iterable<Entity>): void };
  markerViews: { sync(entities: Iterable<Entity>): void };
  cableViews: { sync(entities: Iterable<Entity>): void };
}

export interface SyncedEmitters {
  itemEmitters: ItemEmitter[];
  nodeEmitters: ItemEmitter[];
  placeableEmitters: ItemEmitter[];
}

/** Sync all entity views from one shared snapshot of the world. */
export function syncEntityViews(
  views: EntityViews,
  entities: Iterable<Entity>,
  sunDirWorld?: { x: number; y: number; z: number },
): SyncedEmitters {
  // Materialize once: the caller typically passes a single-use iterator
  // (e.g. map.values()), which cannot be re-iterated by every sync.
  const snapshot = [...entities];
  const itemEmitters = views.itemViews.sync(snapshot);
  const nodeEmitters = views.nodeViews.sync(snapshot);
  const placeableEmitters = views.placeableViews.sync(snapshot, sunDirWorld);
  views.tetherViews.sync(snapshot);
  views.habitatViews.sync(snapshot);
  views.markerViews.sync(snapshot);
  views.cableViews.sync(snapshot);
  return { itemEmitters, nodeEmitters, placeableEmitters };
}
