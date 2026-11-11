// Point-light budget (M07): ARCHITECTURE.md allows at most 12 active
// glow lights, nearest first. One fixed pool of PointLights is reassigned
// every frame to the nearest emitters (glowing items and deposits).

import * as THREE from 'three';
import { ITEM_LIGHT_BUDGET } from '../core/constants.js';
import { distance, type Vec3d } from '../core/math.js';
import { toLocal } from './floatingOrigin.js';
import type { ItemEmitter } from './views/itemView.js';

export class ItemLights {
  readonly group = new THREE.Group();
  private readonly lights: THREE.PointLight[] = [];

  constructor() {
    this.group.name = 'itemLights';
    // Positions are set absolutely from world doubles every frame (same as
    // the other originManaged groups), so origin shifts must skip this one.
    this.group.userData['originManaged'] = true;
    for (let i = 0; i < ITEM_LIGHT_BUDGET; i += 1) {
      // Intensity 0 = parked (three.js still pays a draw-free uniform slot;
      // 12 fixed lights is the ARCH budget).
      const light = new THREE.PointLight(0xffffff, 0, 18, 1.6);
      light.visible = false;
      this.lights.push(light);
      this.group.add(light);
    }
  }

  /** Assign the pool to the nearest emitters (call every frame). */
  update(focusWorld: Vec3d, emitters: ItemEmitter[]): void {
    const ranked = emitters
      .map((emitter, index) => ({ emitter, index, d: distance(emitter.position, focusWorld) }))
      .sort((a, b) => a.d - b.d || a.index - b.index)
      .slice(0, this.lights.length);
    for (let i = 0; i < this.lights.length; i += 1) {
      const light = this.lights[i] as THREE.PointLight;
      const hit = ranked[i];
      if (!hit) {
        light.visible = false;
        light.intensity = 0;
        continue;
      }
      const local = toLocal(hit.emitter.position);
      light.position.set(local.x, local.y, local.z);
      light.color.set(hit.emitter.color);
      light.intensity = hit.emitter.intensity;
      light.visible = true;
    }
  }

  dispose(): void {
    for (const light of this.lights) {
      light.dispose();
      this.group.remove(light);
    }
    this.lights.length = 0;
  }
}
