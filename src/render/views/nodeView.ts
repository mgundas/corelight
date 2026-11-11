// Resource node views (M07): each deterministic node (kind 'node') renders
// as a small cluster of its resource shards, oriented by the node's stored
// rotation (upright on the terrain normal). Shard layout derives from the
// node id, so re-syncs never reshuffle the cluster. Positioned absolutely
// from world doubles; the group owns its origin shifts.

import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { isKnownItem, itemDef } from '../../data/loadData.js';
import type { Entity, EntityId } from '../../sim/entities.js';
import { toLocal } from '../floatingOrigin.js';
import { makeItemMesh } from './itemGeometry.js';
import type { ItemEmitter } from './itemView.js';

export class NodeViews {
  readonly group = new THREE.Group();
  private readonly groups = new Map<EntityId, THREE.Group>();

  constructor() {
    this.group.name = 'nodes';
    this.group.userData['originManaged'] = true;
  }

  /** Reconcile node clusters with the world; returns glow emitter points. */
  sync(entities: Iterable<Entity>): ItemEmitter[] {
    const seen = new Set<EntityId>();
    const emitters: ItemEmitter[] = [];
    for (const entity of entities) {
      if (entity.kind !== 'node') continue;
      const resourceId = entity.components.node?.resourceId;
      if (!resourceId || !isKnownItem(resourceId)) continue;
      seen.add(entity.id);
      let cluster = this.groups.get(entity.id);
      if (!cluster) {
        cluster = this.buildCluster(entity.id, resourceId);
        this.groups.set(entity.id, cluster);
        this.group.add(cluster);
      }
      const local = toLocal(entity.position);
      cluster.position.set(local.x, local.y, local.z);
      cluster.quaternion.set(
        entity.rotation.x,
        entity.rotation.y,
        entity.rotation.z,
        entity.rotation.w,
      );
      const glow = itemDef(resourceId).emitsLight;
      // Data-driven (items.json): any resource with an emitsLight entry
      // glows from the deposit itself. Ores without one stay dark until
      // mined, which keeps the night readable.
      if (glow) {
        emitters.push({ position: entity.position, color: glow.color, intensity: glow.intensity });
      }
    }
    for (const [id, cluster] of [...this.groups]) {
      if (seen.has(id)) continue;
      this.group.remove(cluster);
      this.groups.delete(id);
    }
    return emitters;
  }

  private buildCluster(nodeId: string, resourceId: string): THREE.Group {
    const cluster = new THREE.Group();
    const rng = createRng(`corelight:node:${nodeId}`);
    const def = itemDef(resourceId);
    const shards = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < shards; i += 1) {
      const shard = makeItemMesh(def);
      shard.scale.multiplyScalar(0.7 + rng() * 0.5);
      const angle = (i / shards) * Math.PI * 2 + rng() * 0.6;
      const radius = 0.35 + rng() * 0.55;
      shard.position.set(Math.cos(angle) * radius, 0.15 + rng() * 0.35, Math.sin(angle) * radius);
      shard.rotation.set(rng() * 0.6 - 0.3, rng() * Math.PI * 2, rng() * 0.6 - 0.3);
      cluster.add(shard);
    }
    return cluster;
  }

  dispose(): void {
    for (const cluster of this.groups.values()) this.group.remove(cluster);
    this.groups.clear();
  }
}
