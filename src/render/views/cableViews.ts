// Cable views (M10): sagging lines between the live snap points of two
// structures. Cables are graph edges; the renderer resolves each endpoint
// from the cable component on every sync, so moving/packing an endpoint
// cannot leave a stale line. Geometry is cached by endpoint positions +
// down vectors (origin shifts rebuild once, static frames skip).

import * as THREE from 'three';
import type { Entity, EntityId } from '../../sim/entities.js';
import { snapWorld } from '../../sim/snapUtils.js';
import { toLocal } from '../floatingOrigin.js';

const SAG_BASE = 0.18;
const SAG_SPAN = 0.1;
const SEGMENTS = 8;
const CABLE_COLOR = 0xffb066;

interface CableState {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  dx: number;
  dy: number;
  dz: number;
}

export class CableViews {
  readonly group = new THREE.Group();
  private readonly lines = new Map<EntityId, THREE.Line>();
  private readonly state = new Map<EntityId, CableState>();
  private readonly material = new THREE.LineBasicMaterial({ color: CABLE_COLOR });
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchDown = new THREE.Vector3();

  constructor() {
    this.group.name = 'cables';
    this.group.userData['originManaged'] = true;
  }

  /** Reconcile cables from one entity snapshot (call every frame). */
  sync(entities: Iterable<Entity>): void {
    const byId = new Map<EntityId, Entity>();
    for (const entity of entities) byId.set(entity.id, entity);
    const seen = new Set<EntityId>();
    for (const entity of byId.values()) {
      if (entity.kind !== 'cable') continue;
      const cable = entity.components.cable;
      if (!cable) continue;
      const a = byId.get(cable.a.entityId);
      const b = byId.get(cable.b.entityId);
      if (!a || !b) continue;
      const aWorld = snapWorld(a, cable.a.snapIndex);
      const bWorld = snapWorld(b, cable.b.snapIndex);
      if (!aWorld || !bWorld) continue;
      seen.add(entity.id);
      const aLocal = toLocal(aWorld);
      const bLocal = toLocal(bWorld);
      const down = this.scratchDown.set(0, 0, 0);
      this.scratchQuat.set(a.rotation.x, a.rotation.y, a.rotation.z, a.rotation.w);
      down.add(this.scratchA.set(0, -1, 0).applyQuaternion(this.scratchQuat));
      this.scratchQuat.set(b.rotation.x, b.rotation.y, b.rotation.z, b.rotation.w);
      down.add(this.scratchB.set(0, -1, 0).applyQuaternion(this.scratchQuat));
      if (down.lengthSq() < 1e-6) down.set(0, -1, 0);
      else down.normalize();
      const dx = aLocal.x;
      const dy = aLocal.y;
      const dz = aLocal.z;
      const ex = bLocal.x;
      const ey = bLocal.y;
      const ez = bLocal.z;
      const prev = this.state.get(entity.id);
      if (
        prev &&
        Math.abs(prev.ax - dx) < 1e-4 &&
        Math.abs(prev.ay - dy) < 1e-4 &&
        Math.abs(prev.az - dz) < 1e-4 &&
        Math.abs(prev.bx - ex) < 1e-4 &&
        Math.abs(prev.by - ey) < 1e-4 &&
        Math.abs(prev.bz - ez) < 1e-4 &&
        Math.abs(prev.dx - down.x) < 1e-4 &&
        Math.abs(prev.dy - down.y) < 1e-4 &&
        Math.abs(prev.dz - down.z) < 1e-4
      ) {
        continue;
      }
      const dist = Math.hypot(ex - dx, ey - dy, ez - dz);
      const mid = new THREE.Vector3(
        (dx + ex) / 2 + down.x * (SAG_BASE + dist * SAG_SPAN),
        (dy + ey) / 2 + down.y * (SAG_BASE + dist * SAG_SPAN),
        (dz + ez) / 2 + down.z * (SAG_BASE + dist * SAG_SPAN),
      );
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(dx, dy, dz),
        mid,
        new THREE.Vector3(ex, ey, ez),
      );
      const points = curve.getPoints(SEGMENTS);
      let line = this.lines.get(entity.id);
      if (!line) {
        line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), this.material);
        this.lines.set(entity.id, line);
        this.group.add(line);
      } else {
        line.geometry.dispose();
        line.geometry = new THREE.BufferGeometry().setFromPoints(points);
      }
      this.state.set(entity.id, { ax: dx, ay: dy, az: dz, bx: ex, by: ey, bz: ez, dx: down.x, dy: down.y, dz: down.z });
    }
    for (const [id, line] of [...this.lines]) {
      if (seen.has(id)) continue;
      this.group.remove(line);
      line.geometry.dispose();
      this.lines.delete(id);
      this.state.delete(id);
    }
  }

  dispose(): void {
    for (const line of this.lines.values()) {
      this.group.remove(line);
      line.geometry.dispose();
    }
    this.lines.clear();
    this.state.clear();
    this.material.dispose();
  }
}
