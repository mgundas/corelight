// Low-poly astronaut with an art-only limb rig, visor and oxygen tanks.
// Rendered at the entity
// position interpolated between the last two sim ticks. The group is
// positioned absolutely from world doubles every frame, so it owns its
// origin shifts (like the chunk group) and applyOriginShift must skip it.

import * as THREE from 'three';
import { toLocal } from '../floatingOrigin.js';
import type { Quat, Vec3d } from '../../core/math.js';
import type { ItemDef } from '../../data/loadData.js';
import { makeItemMesh } from './itemGeometry.js';
import { makeAstronaut } from './astronaut.js';
import { AVATAR_STRIDE_M, AVATAR_TELEPORT_DISTANCE_SQ } from '../../core/constants.js';

interface Sample {
  pos: Vec3d;
  quat: Quat;
}

/** Teleports snap instead of streaking across the map. */
const SNAP_DISTANCE_SQ = AVATAR_TELEPORT_DISTANCE_SQ;

export class PlayerView {
  readonly group = new THREE.Group();
  private readonly suit = makeAstronaut();
  private lastRenderPos: Vec3d | null = null;
  private gaitPhase = 0;
  private readonly previousRotation = new THREE.Quaternion();
  private readonly currentRotation = new THREE.Quaternion();
  private prev: Sample | null = null;
  private curr: Sample | null = null;
  private visible = false;
  /** Render-only suppression (pilot inside a shuttle); samples keep flowing. */
  private hidden = false;
  /** Backpack slot meshes (8): reconciled by renderBackpack. */
  private readonly packSlots: (THREE.Mesh | null)[] = Array<THREE.Mesh | null>(8).fill(null);
  private readonly packItemIds: (string | null)[] = Array<string | null>(8).fill(null);
  /** Large packaged placeable carried in front (M09), reconciled by id. */
  private frontCarry: THREE.Mesh | null = null;
  private frontCarryId: string | null = null;

  constructor() {
    this.group.name = 'player';
    this.group.userData['originManaged'] = true;
    this.group.visible = false;

    this.group.add(this.suit.group);
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
    this.lastRenderPos = null;
  }

  /** Hide the whole astronaut (pilot inside a shuttle); samples keep flowing. */
  setSuitVisible(visible: boolean): void {
    // Boarding changes the meaning of the position (capsule centre -> ship
    // base). Blending those frames drags the camera through the ground.
    if (this.hidden === visible) {
      this.prev = this.curr;
      this.lastRenderPos = null;
    }
    this.hidden = !visible;
    this.suit.group.visible = visible;
    if (this.hidden) this.group.visible = false;
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
    this.group.visible = this.visible && !this.hidden;
    const world = this.interpolatedWorld(alpha);
    if (!world) return;
    const local = toLocal(world);
    this.group.position.set(local.x, local.y, local.z);
    const curr = this.curr!;
    const prev = this.prev!;
    const q = curr.quat;
    const p = prev.quat;
    const teleport = Math.hypot(curr.pos.x - prev.pos.x, curr.pos.y - prev.pos.y, curr.pos.z - prev.pos.z) ** 2 > SNAP_DISTANCE_SQ;
    this.group.quaternion.set(q.x, q.y, q.z, q.w);
    if (!teleport) {
      this.previousRotation.set(p.x, p.y, p.z, p.w);
      this.currentRotation.set(q.x, q.y, q.z, q.w);
      this.group.quaternion.slerpQuaternions(this.previousRotation, this.currentRotation, Math.max(0, Math.min(1, alpha)));
    }
    const step = this.lastRenderPos ? Math.hypot(world.x - this.lastRenderPos.x, world.y - this.lastRenderPos.y, world.z - this.lastRenderPos.z) : 0;
    const moving = step > 0 && step * step < SNAP_DISTANCE_SQ && !teleport;
    if (moving) this.gaitPhase += step / AVATAR_STRIDE_M * Math.PI * 2;
    this.suit.animate(this.gaitPhase, moving);
    this.lastRenderPos = world;
  }

  /**
   * Show carried items on the backpack (call every frame with the player's
   * 8 resolved slot definitions, null for empty). Meshes share the item
   * geometry cache, so reconcile by id and never dispose them here.
   */
  renderBackpack(carried: (ItemDef | null)[]): void {
    for (let i = 0; i < 8; i += 1) {
      const def = carried[i] ?? null;
      if ((this.packItemIds[i] ?? null) === (def?.id ?? null)) continue;
      const old = this.packSlots[i];
      if (old) {
        this.group.remove(old);
        this.packSlots[i] = null;
      }
      this.packItemIds[i] = def?.id ?? null;
      if (!def) continue;
      const mesh = makeItemMesh(def);
      const col = i % 4;
      const row = Math.floor(i / 4);
      mesh.position.set(-0.15 + col * 0.1, 0.2 - row * 0.24, -0.5);
      mesh.scale.multiplyScalar(0.45);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.packSlots[i] = mesh;
      this.group.add(mesh);
    }
  }

  /**
   * Show (or clear) the large package carried in front. Uses the shared item
   * mesh cache; position is in the astronaut's local frame, so it follows the
   * body and never fights the interpolation.
   */
  renderFrontCarry(def: ItemDef | null): void {
    if ((this.frontCarryId ?? null) === (def?.id ?? null)) return;
    if (this.frontCarry) {
      this.group.remove(this.frontCarry);
      this.frontCarry = null;
    }
    this.frontCarryId = def?.id ?? null;
    if (!def) return;
    const mesh = makeItemMesh(def);
    mesh.position.set(0, 0.2, 0.78);
    mesh.rotation.set(0.12, 0, 0);
    mesh.scale.setScalar(1.15);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.frontCarry = mesh;
    this.group.add(mesh);
  }

  dispose(): void {
    // The suit owns its geometry; backpack meshes use the shared item cache.
    this.group.clear();
    for (let i = 0; i < this.packSlots.length; i += 1) this.packSlots[i] = null;
    this.frontCarry = null;
    this.frontCarryId = null;
    this.suit.dispose();
  }
}
