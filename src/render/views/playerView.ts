// Placeholder low-poly astronaut (M03): capsule body, round helmet with a
// visor, small backpack — all three.js primitives. Rendered at the entity
// position interpolated between the last two sim ticks. The group is
// positioned absolutely from world doubles every frame, so it owns its
// origin shifts (like the chunk group) and applyOriginShift must skip it.

import * as THREE from 'three';
import { toLocal } from '../floatingOrigin.js';
import type { Quat, Vec3d } from '../../core/math.js';

interface Sample {
  pos: Vec3d;
  quat: Quat;
}

/** Teleports snap instead of streaking across the map. */
const SNAP_DISTANCE_SQ = 25;

export class PlayerView {
  readonly group = new THREE.Group();
  private readonly bodyMat = new THREE.MeshStandardMaterial({
    color: 0xcc6633,
    roughness: 0.8,
    metalness: 0.1,
    flatShading: true,
  });
  private prev: Sample | null = null;
  private curr: Sample | null = null;
  private visible = false;

  constructor() {
    this.group.name = 'player';
    this.group.userData['originManaged'] = true;
    this.group.visible = false;

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 12), this.bodyMat);
    body.matrixAutoUpdate = false;
    body.updateMatrix();
    this.group.add(body);

    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0xe8ecef,
      roughness: 0.4,
      metalness: 0.2,
      flatShading: true,
    });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), helmetMat);
    helmet.position.set(0, 0.62, 0.02);
    helmet.matrixAutoUpdate = false;
    helmet.updateMatrix();
    this.group.add(helmet);

    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x0a1626,
      roughness: 0.15,
      metalness: 0.6,
      flatShading: true,
    });
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), visorMat);
    visor.scale.set(1, 0.7, 0.6);
    visor.position.set(0, 0.62, 0.16);
    visor.matrixAutoUpdate = false;
    visor.updateMatrix();
    this.group.add(visor);

    const packMat = new THREE.MeshStandardMaterial({
      color: 0x8a8f96,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    });
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.26), packMat);
    pack.position.set(0, 0.08, -0.34);
    pack.matrixAutoUpdate = false;
    pack.updateMatrix();
    this.group.add(pack);
  }

  /** Record the latest tick state (call after every sim tick). */
  pushSample(pos: Vec3d, quat: Quat): void {
    const sample: Sample = { pos: { ...pos }, quat: { ...quat } };
    if (!this.curr) {
      this.prev = sample;
      this.curr = sample;
    } else {
      this.prev = this.curr;
      this.curr = sample;
    }
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
    this.group.visible = false;
    this.prev = null;
    this.curr = null;
  }

  /** Place the group from the two samples and the tick alpha. */
  render(alpha: number): void {
    this.group.visible = this.visible;
    if (!this.visible || !this.prev || !this.curr) return;
    const a = this.prev;
    const b = this.curr;
    const dx = b.pos.x - a.pos.x;
    const dy = b.pos.y - a.pos.y;
    const dz = b.pos.z - a.pos.z;
    let t = Math.min(1, Math.max(0, alpha));
    if (dx * dx + dy * dy + dz * dz > SNAP_DISTANCE_SQ) t = 1;
    const world: Vec3d = { x: a.pos.x + dx * t, y: a.pos.y + dy * t, z: a.pos.z + dz * t };
    const local = toLocal(world);
    this.group.position.set(local.x, local.y, local.z);
    // Nearest-sample orientation (quaternion slerp across one tick adds
    // nothing visible at 30 Hz; position is what the eye tracks).
    this.group.quaternion.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
  }

  dispose(): void {
    for (const child of [...this.group.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      this.group.remove(child);
    }
    this.bodyMat.dispose();
  }
}
