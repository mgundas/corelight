// F5 debug view: one Box3Helper per visible chunk mesh, colored by LOD
// level. World boxes are stored in doubles and re-projected through the
// floating origin, so bounds stay correct across origin shifts.

import * as THREE from 'three';
import { toLocal } from './floatingOrigin.js';
import type { ChunkBox } from './chunkMeshes.js';

const LEVEL_COLORS = [0xff4444, 0xffaa00, 0xffff44, 0x44dd44, 0x44aaff, 0xcc66ff];

export function levelColor(level: number): number {
  return LEVEL_COLORS[level] ?? 0xffffff;
}

export class ChunkBounds {
  readonly group = new THREE.Group();
  private signature = '';
  private visible = false;

  constructor() {
    this.group.name = 'chunk-bounds';
    this.group.visible = false;
    this.group.userData['originManaged'] = true;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.group.visible = visible;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Rebuild helpers when the visible set changed. */
  update(boxes: ChunkBox[]): void {
    const signature = boxes
      .map((box) => box.key)
      .sort()
      .join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.rebuild(boxes);
  }

  /** Shift helpers after an origin shift (their geometry is baked local). */
  resync(delta: { x: number; y: number; z: number }): void {
    for (const child of this.group.children) {
      child.position.x -= delta.x;
      child.position.y -= delta.y;
      child.position.z -= delta.z;
    }
  }

  /** Release every helper's geometry and material (call from Renderer.dispose). */
  dispose(): void {
    for (let i = this.group.children.length - 1; i >= 0; i -= 1) {
      const child = this.group.children[i] as THREE.Object3D;
      this.group.remove(child);
      const helper = child as THREE.Box3Helper;
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    }
    this.signature = '';
  }

  private rebuild(boxes: ChunkBox[]): void {
    for (let i = this.group.children.length - 1; i >= 0; i -= 1) {
      const child = this.group.children[i] as THREE.Object3D;
      this.group.remove(child);
      const helper = child as THREE.Box3Helper;
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    }
    for (const box of boxes) {
      const min = toLocal(box.min);
      const bounds = new THREE.Box3(
        new THREE.Vector3(min.x, min.y, min.z),
        new THREE.Vector3(min.x + box.size, min.y + box.size, min.z + box.size),
      );
      this.group.add(new THREE.Box3Helper(bounds, levelColor(box.level)));
    }
  }
}
