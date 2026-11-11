// Tether, habitat and lost-backpack views (M08): small posts with glowing
// tips, sagging cables between linked posts (green = live, red = dark),
// the starting habitat dome with a lit door, and the death-marker beacon.
// All groups position children absolutely from world doubles every sync,
// so they own their origin shifts (applyOriginShift skips them).

import * as THREE from 'three';
import type { Entity, EntityId } from '../../sim/entities.js';
import { toLocal } from '../floatingOrigin.js';

/** Post tip height (matches the sim LOS in sim/systems/tethers.ts). */
const TIP_HEIGHT = 0.9;
/** Cable sag at mid-span: droop + a span-proportional catenary-ish dip. */
const SAG_BASE = 0.25;
const SAG_SPAN = 0.12;
/** Line segments per cable (cheap: tether counts stay small). */
const CABLE_SEGMENTS = 8;

const LIVE_COLOR = 0x39ff88;
const DEAD_COLOR = 0xff4444;

function tipWorld(entity: Entity): THREE.Vector3 {
  const local = toLocal(entity.position);
  const tip = new THREE.Vector3(0, TIP_HEIGHT, 0).applyQuaternion(
    new THREE.Quaternion(
      entity.rotation.x,
      entity.rotation.y,
      entity.rotation.z,
      entity.rotation.w,
    ),
  );
  return new THREE.Vector3(local.x + tip.x, local.y + tip.y, local.z + tip.z);
}

interface CableState {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  live: boolean;
}

export class TetherViews {
  readonly group = new THREE.Group();
  private readonly posts = new Map<EntityId, THREE.Group>();
  private readonly tipMeshes = new Map<EntityId, THREE.Mesh>();
  private readonly cables = new Map<string, THREE.Line>();
  /** Last built tip positions per cable (local space) + live flag: static
   * cables skip the dispose/rebuild every frame. Origin shifts move every
   * tip, so they naturally rebuild once after a shift. */
  private readonly cableState = new Map<string, CableState>();
  private readonly postGeo = new THREE.CylinderGeometry(0.07, 0.1, TIP_HEIGHT, 6);
  private readonly postMat = new THREE.MeshStandardMaterial({
    color: 0x3a4148,
    roughness: 0.8,
    metalness: 0.3,
    flatShading: true,
  });
  private readonly tipGeo = new THREE.SphereGeometry(0.14, 10, 8);
  private readonly liveMat = new THREE.MeshStandardMaterial({
    color: 0x0d2b18,
    emissive: new THREE.Color(LIVE_COLOR),
    emissiveIntensity: 2.2,
  });
  private readonly deadMat = new THREE.MeshStandardMaterial({
    color: 0x2b0d0d,
    emissive: new THREE.Color(DEAD_COLOR),
    emissiveIntensity: 1.6,
  });
  private readonly liveLineMat = new THREE.LineBasicMaterial({ color: LIVE_COLOR });
  private readonly deadLineMat = new THREE.LineBasicMaterial({ color: DEAD_COLOR });

  constructor() {
    this.group.name = 'tethers';
    this.group.userData['originManaged'] = true;
  }

  /** Reconcile posts and cables with the world (call every frame). */
  sync(entities: Iterable<Entity>): void {
    const seen = new Set<EntityId>();
    const tips = new Map<EntityId, THREE.Vector3>();
    const downs = new Map<EntityId, THREE.Vector3>();
    const liveById = new Map<EntityId, boolean>();
    for (const entity of entities) {
      if (entity.kind !== 'tether') continue;
      seen.add(entity.id);
      const live = entity.components.tether?.live ?? false;
      liveById.set(entity.id, live);
      const quat = new THREE.Quaternion(
        entity.rotation.x,
        entity.rotation.y,
        entity.rotation.z,
        entity.rotation.w,
      );
      let post = this.posts.get(entity.id);
      if (!post) {
        post = new THREE.Group();
        const pole = new THREE.Mesh(this.postGeo, this.postMat);
        pole.position.y = TIP_HEIGHT / 2;
        post.add(pole);
        const tip = new THREE.Mesh(this.tipGeo, live ? this.liveMat : this.deadMat);
        tip.position.y = TIP_HEIGHT;
        post.add(tip);
        this.tipMeshes.set(entity.id, tip);
        this.posts.set(entity.id, post);
        this.group.add(post);
      } else {
        const tip = this.tipMeshes.get(entity.id);
        if (tip) tip.material = live ? this.liveMat : this.deadMat;
      }
      const local = toLocal(entity.position);
      post.position.set(local.x, local.y, local.z);
      post.quaternion.copy(quat);
      tips.set(entity.id, tipWorld(entity));
      // Cable sag follows the posts' own down (local frame): planet-center
      // math would break across floating-origin shifts, the quaternions
      // cannot drift.
      downs.set(entity.id, new THREE.Vector3(0, -1, 0).applyQuaternion(quat));
    }
    for (const [id, post] of [...this.posts]) {
      if (seen.has(id)) continue;
      this.group.remove(post);
      this.posts.delete(id);
      this.tipMeshes.delete(id);
    }
    // Cables follow the sim-computed links (both directions stored; draw
    // each pair once by id order). Rebuilt every sync: positions are static
    // but origin shifts move them, and counts are tiny.
    const wanted = new Map<string, { a: EntityId; b: EntityId; live: boolean }>();
    for (const entity of entities) {
      if (entity.kind !== 'tether') continue;
      for (const other of entity.components.tether?.links ?? []) {
        if (!seen.has(other)) continue;
        const key = entity.id < other ? `${entity.id}|${other}` : `${other}|${entity.id}`;
        if (wanted.has(key)) continue;
        const aLive = liveById.get(entity.id) ?? false;
        const bLive = liveById.get(other) ?? false;
        wanted.set(key, { a: entity.id, b: other, live: aLive && bLive });
      }
    }
    for (const [key, line] of [...this.cables]) {
      if (wanted.has(key)) continue;
      this.group.remove(line);
      line.geometry.dispose();
      this.cables.delete(key);
      this.cableState.delete(key);
    }
    for (const [key, want] of wanted) {
      const aTip = tips.get(want.a);
      const bTip = tips.get(want.b);
      if (!aTip || !bTip) continue;
      // Static cables (same tips, same live flag) keep their geometry:
      // rebuilding every frame churns GPU buffers for zero visual change.
      const prev = this.cableState.get(key);
      if (
        prev &&
        prev.live === want.live &&
        Math.abs(prev.ax - aTip.x) < 1e-4 &&
        Math.abs(prev.ay - aTip.y) < 1e-4 &&
        Math.abs(prev.az - aTip.z) < 1e-4 &&
        Math.abs(prev.bx - bTip.x) < 1e-4 &&
        Math.abs(prev.by - bTip.y) < 1e-4 &&
        Math.abs(prev.bz - bTip.z) < 1e-4
      ) {
        continue;
      }
      const dist = aTip.distanceTo(bTip);
      const downA = downs.get(want.a) ?? new THREE.Vector3(0, -1, 0);
      const downB = downs.get(want.b) ?? new THREE.Vector3(0, -1, 0);
      const sagDir = downA.clone().add(downB);
      if (sagDir.lengthSq() < 1e-6) sagDir.set(0, -1, 0);
      else sagDir.normalize();
      const mid = aTip
        .clone()
        .add(bTip)
        .multiplyScalar(0.5)
        .addScaledVector(sagDir, SAG_BASE + dist * SAG_SPAN);
      const curve = new THREE.QuadraticBezierCurve3(aTip, mid, bTip);
      const points = curve.getPoints(CABLE_SEGMENTS);
      let line = this.cables.get(key);
      const mat = want.live ? this.liveLineMat : this.deadLineMat;
      if (!line) {
        line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), mat);
        this.cables.set(key, line);
        this.group.add(line);
      } else {
        line.geometry.dispose();
        line.geometry = new THREE.BufferGeometry().setFromPoints(points);
        line.material = mat;
      }
      this.cableState.set(key, {
        ax: aTip.x,
        ay: aTip.y,
        az: aTip.z,
        bx: bTip.x,
        by: bTip.y,
        bz: bTip.z,
        live: want.live,
      });
    }
  }

  dispose(): void {
    for (const post of this.posts.values()) this.group.remove(post);
    for (const line of this.cables.values()) {
      this.group.remove(line);
      line.geometry.dispose();
    }
    this.posts.clear();
    this.tipMeshes.clear();
    this.cables.clear();
    this.cableState.clear();
    this.postGeo.dispose();
    this.postMat.dispose();
    this.tipGeo.dispose();
    this.liveMat.dispose();
    this.deadMat.dispose();
    this.liveLineMat.dispose();
    this.deadLineMat.dispose();
  }
}

/** Starting habitat dome (M08): low-poly half-dome with a lit door. */
export class HabitatViews {
  readonly group = new THREE.Group();
  private readonly domes = new Map<EntityId, THREE.Group>();
  private readonly domeGeo = new THREE.SphereGeometry(3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  private readonly domeMat = new THREE.MeshStandardMaterial({
    color: 0xd8d3c3,
    roughness: 0.85,
    metalness: 0.05,
    flatShading: true,
  });
  private readonly doorGeo = new THREE.BoxGeometry(1.1, 1.6, 0.25);
  private readonly doorMat = new THREE.MeshStandardMaterial({
    color: 0x11141a,
    emissive: new THREE.Color(0xffc861),
    emissiveIntensity: 1.8,
  });

  constructor() {
    this.group.name = 'habitats';
    this.group.userData['originManaged'] = true;
  }

  sync(entities: Iterable<Entity>): void {
    const seen = new Set<EntityId>();
    for (const entity of entities) {
      if (entity.kind !== 'machine' || entity.components.machine?.machineType !== 'habitat') continue;
      seen.add(entity.id);
      let dome = this.domes.get(entity.id);
      if (!dome) {
        dome = new THREE.Group();
        dome.add(new THREE.Mesh(this.domeGeo, this.domeMat));
        const door = new THREE.Mesh(this.doorGeo, this.doorMat);
        door.position.set(0, 0.8, 2.85);
        dome.add(door);
        this.domes.set(entity.id, dome);
        this.group.add(dome);
      }
      const local = toLocal(entity.position);
      dome.position.set(local.x, local.y, local.z);
      dome.quaternion.set(
        entity.rotation.x,
        entity.rotation.y,
        entity.rotation.z,
        entity.rotation.w,
      );
    }
    for (const [id, dome] of [...this.domes]) {
      if (seen.has(id)) continue;
      this.group.remove(dome);
      this.domes.delete(id);
    }
  }

  dispose(): void {
    for (const dome of this.domes.values()) this.group.remove(dome);
    this.domes.clear();
    this.domeGeo.dispose();
    this.doorMat.dispose();
    this.domeMat.dispose();
    this.doorGeo.dispose();
  }
}

/** Lost-backpack death markers (M08): small orange beacons. */
export class MarkerViews {
  readonly group = new THREE.Group();
  private readonly beacons = new Map<EntityId, THREE.Mesh>();
  private readonly beaconGeo = new THREE.OctahedronGeometry(0.5);
  private readonly beaconMat = new THREE.MeshStandardMaterial({
    color: 0x1a0e02,
    emissive: new THREE.Color(0xff9a3c),
    emissiveIntensity: 2.5,
    flatShading: true,
  });

  constructor() {
    this.group.name = 'markers';
    this.group.userData['originManaged'] = true;
  }

  sync(entities: Iterable<Entity>): void {
    const seen = new Set<EntityId>();
    for (const entity of entities) {
      if (entity.kind !== 'marker') continue;
      seen.add(entity.id);
      let beacon = this.beacons.get(entity.id);
      if (!beacon) {
        beacon = new THREE.Mesh(this.beaconGeo, this.beaconMat);
        this.beacons.set(entity.id, beacon);
        this.group.add(beacon);
      }
      const local = toLocal(entity.position);
      beacon.position.set(local.x, local.y + 1.2, local.z);
      beacon.rotation.y += 0.01;
    }
    for (const [id, beacon] of [...this.beacons]) {
      if (seen.has(id)) continue;
      this.group.remove(beacon);
      this.beacons.delete(id);
    }
  }

  dispose(): void {
    for (const beacon of this.beacons.values()) this.group.remove(beacon);
    this.beacons.clear();
    this.beaconGeo.dispose();
    this.beaconMat.dispose();
  }
}
