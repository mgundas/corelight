// Per-frame entity view fan-out. WHY a snapshot: Map.values() iterators are
// single-use — handing one iterator to five sequential syncs lets the first
// view eat it and starves the other four (their groups stay empty forever,
// with no error). That was the M08 invisible-tether/habitat bug: only the
// item view ever rendered. Snapshot once per frame so every view sees the
// identical set. Pure fan-out (no three.js here beyond the view types).

import type { Entity } from '../../sim/entities.js';
import type { ItemEmitter } from './itemView.js';

/** Structural view surface: the real view classes satisfy this exactly. */
export interface EntityViews {
  itemViews: { sync(entities: Iterable<Entity>): ItemEmitter[] };
  nodeViews: { sync(entities: Iterable<Entity>): ItemEmitter[] };
  placeableViews: { sync(entities: Iterable<Entity>): ItemEmitter[] };
  tetherViews: { sync(entities: Iterable<Entity>): void };
  habitatViews: { sync(entities: Iterable<Entity>): void };
  markerViews: { sync(entities: Iterable<Entity>): void };
}

export interface SyncedEmitters {
  itemEmitters: ItemEmitter[];
  nodeEmitters: ItemEmitter[];
  placeableEmitters: ItemEmitter[];
}

/** Sync all six entity views from one shared snapshot of the world. */
export function syncEntityViews(views: EntityViews, entities: Iterable<Entity>): SyncedEmitters {
  // Materialize once: the caller typically passes a single-use iterator
  // (e.g. map.values()), which cannot be re-iterated by six syncs.
  const snapshot = [...entities];
  const itemEmitters = views.itemViews.sync(snapshot);
  const nodeEmitters = views.nodeViews.sync(snapshot);
  const placeableEmitters = views.placeableViews.sync(snapshot);
  views.tetherViews.sync(snapshot);
  views.habitatViews.sync(snapshot);
  views.markerViews.sync(snapshot);
  return { itemEmitters, nodeEmitters, placeableEmitters };
}
