// Translucent placement ghost (M09): footprint disc + body box, tinted green
// when the sim-side placement check passes and red otherwise. Pure render:
// the position/rotation come from resolvePlacement, never from this object.

import * as THREE from 'three';
import type { Quat } from '../../core/math.js';
import { placeableById } from '../../data/loadPlaceables.js';
import { toLocal } from '../floatingOrigin.js';

export class PlacementGhost {
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly disc: THREE.Mesh;
  private readonly okMat = new THREE.MeshBasicMaterial({ color: 0x49ff88, transparent: true, opacity: 0.16, depthWrite: false });
  private readonly badMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.16, depthWrite: false });
  private readonly okDiscMat = new THREE.MeshBasicMaterial({ color: 0x49ff88, transparent: true, opacity: 0.45, depthWrite: false });
  private readonly badDiscMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.45, depthWrite: false });
  private readonly bodyGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly discGeo = new THREE.CylinderGeometry(1, 1, 0.06, 24);
  /** Scratch orientation objects (set() runs every frame while placing). */
  private readonly upVec = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.group.name = 'placementGhost';
    this.group.userData['originManaged'] = true;
    this.group.visible = false;
    this.body = new THREE.Mesh(this.bodyGeo, this.okMat);
    this.disc = new THREE.Mesh(this.discGeo, this.okDiscMat);
    this.group.add(this.disc, this.body);
  }

  set(
    placeableId: string | null,
    position: { x: number; y: number; z: number } | null,
    up: { x: number; y: number; z: number } | null,
    valid: boolean,
    rotation: Quat | null = null,
  ): void {
    const def = placeableId ? placeableById(placeableId) : undefined;
    if (!def || !position || !up) {
      this.group.visible = false;
      return;
    }
    const local = toLocal(position);
    this.group.position.set(local.x, local.y, local.z);
    if (rotation) {
      this.group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    } else {
      this.upVec.set(up.x, up.y, up.z).normalize();
      this.group.quaternion.setFromUnitVectors(this.yAxis, this.upVec);
    }
    this.body.scale.set(def.footprintRadiusM * 1.3, def.heightM, def.footprintRadiusM * 1.3);
    this.body.position.set(0, def.heightM / 2, 0);
    this.disc.scale.set(def.footprintRadiusM, 1, def.footprintRadiusM);
    this.disc.position.set(0, 0.03, 0);
    this.body.material = valid ? this.okMat : this.badMat;
    this.disc.material = valid ? this.okDiscMat : this.badDiscMat;
    this.group.visible = true;
  }

  dispose(): void {
    this.bodyGeo.dispose();
    this.discGeo.dispose();
    this.okMat.dispose();
    this.badMat.dispose();
    this.okDiscMat.dispose();
    this.badDiscMat.dispose();
  }
}
