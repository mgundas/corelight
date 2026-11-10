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
  private readonly helmetMat = new THREE.MeshStandardMaterial({
    color: 0xe8ecef,
    roughness: 0.4,
    metalness: 0.2,
    flatShading: true,
  });
  private readonly visorMat = new THREE.MeshStandardMaterial({
    color: 0x0a1626,
    roughness: 0.15,
    metalness: 0.6,
    flatShading: true,
  });
  private readonly packMat = new THREE.MeshStandardMaterial({
    color: 0x8a8f96,
    roughness: 0.9,
    metalness: 0.05,
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

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), this.helmetMat);
    helmet.position.set(0, 0.62, 0.02);
    helmet.matrixAutoUpdate = false;
    helmet.updateMatrix();
    this.group.add(helmet);

    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), this.visorMat);
    visor.scale.set(1, 0.7, 0.6);
    visor.position.set(0, 0.62, 0.16);
    visor.matrixAutoUpdate = false;
    visor.updateMatrix();
    this.group.add(visor);

    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.26), this.packMat);
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

  /** Interpolated world position between the last two tick samples. */
  interpolatedWorld(alpha: number): Vec3d | null {
    if (!this.visible || !this.prev || !this.curr) return null;
    const a = this.prev.pos;
    const b = this.curr.pos;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    let t = Math.min(1, Math.max(0, alpha));
    if (dx * dx + dy * dy + dz * dz > SNAP_DISTANCE_SQ) t = 1;
    return { x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t };
  }

  /** Place the group from the two samples and the tick alpha. */
  render(alpha: number): void {
    this.group.visible = this.visible;
    const world = this.interpolatedWorld(alpha);
    if (!world) return;
    const local = toLocal(world);
    this.group.position.set(local.x, local.y, local.z);
    // Nearest-sample orientation (quaternion slerp across one tick adds
    // nothing visible at 30 Hz; position is what the eye tracks).
    const curr = this.curr as { quat: Quat };
    this.group.quaternion.set(curr.quat.x, curr.quat.y, curr.quat.z, curr.quat.w);
  }

  dispose(): void {
    for (const child of [...this.group.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      this.group.remove(child);
    }
    this.bodyMat.dispose();
    this.helmetMat.dispose();
    this.visorMat.dispose();
    this.packMat.dispose();
  }
}
