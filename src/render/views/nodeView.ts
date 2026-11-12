// Resource node views (M07): each deterministic node (kind 'node') renders
// as a small cluster of its resource shards, oriented by the node's stored
// rotation (upright on the terrain normal). Shard layout derives from the
// node id, so re-syncs never reshuffle the cluster. Positioned absolutely
// from world doubles; the group owns its origin shifts.
//
// M12: biomass deposits render as small low-poly plant tufts (stems + leaf
// blades) instead of ore shards, so Sela's surface reads as vegetation.

import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { isKnownItem, itemDef } from '../../data/loadData.js';
import type { Entity, EntityId } from '../../sim/entities.js';
import { toLocal } from '../floatingOrigin.js';
import { geometryFor, makeItemMesh, materialFor } from './itemGeometry.js';
import type { ItemEmitter } from './itemView.js';

/** Darker leaf green so the tuft reads against the item's bright biomass. */
const LEAF_COLOR = '#3f7d33';

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
    if (resourceId === 'biomass') {
      this.buildPlantTuft(cluster, rng);
      return cluster;
    }
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

  /**
   * Biomass plant (M12): 4-6 slim bright stems with darker leaf blades.
   * Everything reuses the cached capsule geometry/material; only the mesh
   * transforms vary per node id, so a re-sync rebuilds the identical tuft.
   */
  private buildPlantTuft(cluster: THREE.Group, rng: () => number): void {
    const stems = 4 + Math.floor(rng() * 3);
    const leafGeo = geometryFor('capsule');
    const leafMat = materialFor(LEAF_COLOR);
    for (let i = 0; i < stems; i += 1) {
      const stem = makeItemMesh(itemDef('biomass'));
      const height = 1.1 + rng() * 1.1;
      const angle = (i / stems) * Math.PI * 2 + rng() * 0.8;
      const radius = 0.18 + rng() * 0.35;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      stem.scale.set(0.42 + rng() * 0.16, height, 0.42 + rng() * 0.16);
      stem.position.set(x, height * 0.28, z);
      stem.rotation.set(rng() * 0.24 - 0.12, rng() * Math.PI * 2, rng() * 0.24 - 0.12);
      cluster.add(stem);
      const leaves = 1 + Math.floor(rng() * 2);
      for (let l = 0; l < leaves; l += 1) {
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.scale.set(0.75 + rng() * 0.35, 0.28 + rng() * 0.16, 1.15 + rng() * 0.5);
        leaf.position.set(
          x + (rng() - 0.5) * 0.35,
          0.25 + rng() * (height * 0.45),
          z + (rng() - 0.5) * 0.35,
        );
        leaf.rotation.set(rng() * 1.2 - 0.6, rng() * Math.PI * 2, rng() * 1.2 - 0.6);
        cluster.add(leaf);
      }
    }
  }

  dispose(): void {
    for (const cluster of this.groups.values()) this.group.remove(cluster);
    this.groups.clear();
  }
}
