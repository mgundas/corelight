// Ground item views (M07): one low-poly mesh per loose item entity (kind
// 'item' without a holder). Carried items skip this view entirely; the
// backpack on PlayerView shows them. Meshes are positioned absolutely from
// world doubles every sync, so the group owns its origin shifts.

import * as THREE from 'three';
import { isKnownItem, itemDef } from '../../data/loadData.js';
import type { Entity, EntityId } from '../../sim/entities.js';
import { toLocal } from '../floatingOrigin.js';
import { makeItemMesh } from './itemGeometry.js';

export interface ItemEmitter {
  position: { x: number; y: number; z: number };
  color: string;
  intensity: number;
}

export class ItemViews {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<EntityId, THREE.Mesh>();

  constructor() {
    this.group.name = 'items';
    this.group.userData['originManaged'] = true;
  }

  /** Reconcile meshes with the world (call every frame; items fall). */
  sync(entities: Iterable<Entity>): ItemEmitter[] {
    const seen = new Set<EntityId>();
    const emitters: ItemEmitter[] = [];
    for (const entity of entities) {
      if (entity.kind !== 'item' || entity.components.item?.holder !== undefined) continue;
      const itemId = entity.components.item?.itemId;
      if (!itemId || !isKnownItem(itemId)) continue;
      seen.add(entity.id);
      let mesh = this.meshes.get(entity.id);
      if (!mesh) {
        mesh = makeItemMesh(itemDef(itemId));
        this.meshes.set(entity.id, mesh);
        this.group.add(mesh);
      }
      const local = toLocal(entity.position);
      mesh.position.set(local.x, local.y, local.z);
      // Resting spin: items lie still; face a stable yaw from the id so
      // re-syncs never visibly rotate them.
      mesh.rotation.set(0, (hashYaw(entity.id) * Math.PI) / 180, 0);
      const glow = itemDef(itemId).emitsLight;
      if (glow) {
        emitters.push({ position: entity.position, color: glow.color, intensity: glow.intensity });
      }
    }
    for (const [id, mesh] of [...this.meshes]) {
      if (seen.has(id)) continue;
      this.group.remove(mesh);
      this.meshes.delete(id);
    }
    return emitters;
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) this.group.remove(mesh);
    this.meshes.clear();
  }
}

/** Stable 0..360 yaw from an entity id (no Math.random in render). */
function hashYaw(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}
