// Research sample pod views (M11): one glowing, pulsing pod per loose sample
// entity (kind 'sample' without a holder). Carried/station-held pods are
// hidden (the backpack slot shows the item). Positioned absolutely from world
// doubles like the other entity views, so the group owns its origin shifts.

import * as THREE from 'three';
import { isKnownItem, itemDef } from '../../data/loadData.js';
import type { Entity, EntityId } from '../../sim/entities.js';
import { toLocal } from '../floatingOrigin.js';
import { makeItemMesh } from './itemGeometry.js';
import type { ItemEmitter } from './itemView.js';

export class SampleViews {
  readonly group = new THREE.Group();
  private readonly pods = new Map<EntityId, THREE.Group>();
  /** Shared ring frame for this view instance (disposed with it). */
  private readonly ringGeometry = new THREE.TorusGeometry(0.5, 0.045, 6, 18);
  private readonly ringMaterial = new THREE.MeshStandardMaterial({
    color: '#7dff6a',
    emissive: new THREE.Color('#3fae35'),
    emissiveIntensity: 0.9,
    roughness: 0.45,
    metalness: 0.1,
    flatShading: true,
  });

  constructor() {
    this.group.name = 'samples';
    this.group.userData['originManaged'] = true;
  }

  /** Reconcile pods with the world; returns glow emitter points. */
  sync(entities: Iterable<Entity>, nowMs = performance.now()): ItemEmitter[] {
    const seen = new Set<EntityId>();
    const emitters: ItemEmitter[] = [];
    for (const entity of entities) {
      if (entity.kind !== 'sample' || entity.components.item?.holder !== undefined) continue;
      const itemId = entity.components.item?.itemId;
      if (!itemId || !isKnownItem(itemId)) continue;
      seen.add(entity.id);
      let pod = this.pods.get(entity.id);
      if (!pod) {
        pod = this.buildPod(itemId);
        this.pods.set(entity.id, pod);
        this.group.add(pod);
      }
      const local = toLocal(entity.position);
      pod.position.set(local.x, local.y, local.z);
      pod.quaternion.set(
        entity.rotation.x,
        entity.rotation.y,
        entity.rotation.z,
        entity.rotation.w,
      );
      // Pulse reads as "alive" in a dark cave; phase derives from the id so
      // neighbouring pods never breathe in lockstep.
      const phase = hashPhase(entity.id);
      pod.scale.setScalar(1 + 0.13 * Math.sin(nowMs * 0.004 + phase));
      const glow = itemDef(itemId).emitsLight;
      if (glow) {
        emitters.push({ position: entity.position, color: glow.color, intensity: glow.intensity });
      }
    }
    for (const [id, pod] of [...this.pods]) {
      if (seen.has(id)) continue;
      this.group.remove(pod);
      this.pods.delete(id);
    }
    return emitters;
  }

  private buildPod(itemId: string): THREE.Group {
    const pod = new THREE.Group();
    const core = makeItemMesh(itemDef(itemId));
    core.scale.multiplyScalar(1.55);
    pod.add(core);
    const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    ring.rotation.x = Math.PI / 2;
    pod.add(ring);
    return pod;
  }

  dispose(): void {
    for (const pod of this.pods.values()) this.group.remove(pod);
    this.pods.clear();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
  }
}

/** Stable 0..2pi pulse phase from an entity id (no Math.random in render). */
function hashPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return ((h % 6283) / 1000) * (h < 0 ? -1 : 1);
}
