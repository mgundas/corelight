// Placeable views (M09): low-poly white/grey bodies with orange accents for
// platforms, stations, machines and the shuttle, plus light sticks and the
// placement ghost. Model selection is data-driven (placeables.json `model`);
// unknown ids are skipped so a future catalog entry never crashes the frame.
// Groups position children absolutely from world doubles (origin-managed).

import * as THREE from 'three';
import type { Vec3d } from '../../core/math.js';
import { isKnownItem, itemDef } from '../../data/loadData.js';
import {
  placeableById,
  placeableForMachineType,
  type PlaceableDef,
  type PlaceableModel,
} from '../../data/loadPlaceables.js';
import type { Entity, EntityId } from '../../sim/entities.js';
import { defForEntity } from '../../sim/snapUtils.js';
import { toLocal } from '../floatingOrigin.js';
import type { ItemEmitter } from './itemView.js';

const BODY = 0xd8dde2;
const DARK = 0x4a525b;
const ACCENT = 0xff8a3c;
const PANEL = 0x3b4f6b;
const SAMPLE = 0x6dff8a;
const STATUS_GREEN = 0x39ff88;
const STATUS_YELLOW = 0xffd24a;
const STATUS_RED = 0xff4444;
const PANEL_NORMAL = new THREE.Vector3(0, 0, 1);
const REST_PANEL = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.48);

export class PlaceableViews {
  readonly group = new THREE.Group();
  private readonly objects = new Map<EntityId, THREE.Group>();
  private readonly panelHeads = new Map<EntityId, THREE.Group>();
  private readonly statusLights = new Map<EntityId, THREE.Mesh>();
  private readonly fuelCans = new Map<EntityId, THREE.Mesh[]>();
  private readonly engineGlows = new Map<EntityId, THREE.Mesh>();
  private readonly bodyMat = new THREE.MeshStandardMaterial({ color: BODY, roughness: 0.8, metalness: 0.05, flatShading: true });
  private readonly darkMat = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.7, metalness: 0.3, flatShading: true });
  private readonly accentMat = new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.5, metalness: 0.2, emissive: new THREE.Color(ACCENT), emissiveIntensity: 0.25, flatShading: true });
  private readonly panelMat = new THREE.MeshStandardMaterial({ color: PANEL, roughness: 0.35, metalness: 0.35, flatShading: true });
  private readonly glowMat = new THREE.MeshStandardMaterial({ color: 0x2a1206, emissive: new THREE.Color(ACCENT), emissiveIntensity: 2, flatShading: true });
  private readonly sampleMat = new THREE.MeshStandardMaterial({ color: 0x0c2a14, emissive: new THREE.Color(SAMPLE), emissiveIntensity: 1.6, flatShading: true });
  private readonly statusGreen = new THREE.MeshStandardMaterial({ color: 0x0d2b18, emissive: new THREE.Color(STATUS_GREEN), emissiveIntensity: 1.9, flatShading: true });
  private readonly statusYellow = new THREE.MeshStandardMaterial({ color: 0x2b220d, emissive: new THREE.Color(STATUS_YELLOW), emissiveIntensity: 1.5, flatShading: true });
  private readonly statusRed = new THREE.MeshStandardMaterial({ color: 0x2b0d0d, emissive: new THREE.Color(STATUS_RED), emissiveIntensity: 1.9, flatShading: true });
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
  private readonly sphere = new THREE.SphereGeometry(1, 10, 8);
  private readonly cone = new THREE.ConeGeometry(1, 1, 8);
  private readonly capsule = new THREE.CapsuleGeometry(0.6, 1.1, 4, 10);
  /** Scratch objects: light-stick/panel/status sync runs every frame. */
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpQuatInverse = new THREE.Quaternion();
  private readonly tmpTip = new THREE.Vector3();
  private readonly tmpSun = new THREE.Vector3();
  private readonly tmpLocalSun = new THREE.Vector3();
  /** Interpolated display position for the piloted shuttle (render-only). */
  private shuttleAnchor: { id: EntityId; position: Vec3d } | null = null;

  constructor() {
    this.group.name = 'placeables';
    this.group.userData['originManaged'] = true;
  }

  /**
   * The piloted shuttle renders from the interpolated pilot position so its
   * 30 Hz sim steps do not visibly stutter against the chase camera.
   */
  setShuttleAnchor(anchor: { id: EntityId; position: Vec3d } | null): void {
    this.shuttleAnchor = anchor ? { id: anchor.id, position: { ...anchor.position } } : null;
  }

  /** Reconcile placeables/machines/shuttles/light sticks; returns emitters. */
  sync(entities: Iterable<Entity>, sunDirWorld?: { x: number; y: number; z: number }): ItemEmitter[] {
    const seen = new Set<EntityId>();
    const emitters: ItemEmitter[] = [];
    const sun = this.tmpSun.set(sunDirWorld?.x ?? 0, sunDirWorld?.y ?? 1, sunDirWorld?.z ?? 0);
    if (sun.lengthSq() < 1e-9) sun.set(0, 1, 0);
    sun.normalize();
    for (const entity of entities) {
      const model = this.modelFor(entity);
      if (!model) continue;
      seen.add(entity.id);
      let object = this.objects.get(entity.id);
      if (!object) {
        const def = defForEntity(entity);
        const built = this.build(model, def, entity.kind === 'machine');
        object = built.group;
        if (built.head) this.panelHeads.set(entity.id, built.head);
        if (built.status) this.statusLights.set(entity.id, built.status);
        if (built.fuelCans) this.fuelCans.set(entity.id, built.fuelCans);
        if (built.engineGlow) this.engineGlows.set(entity.id, built.engineGlow);
        this.objects.set(entity.id, object);
        this.group.add(object);
      }
      const local = toLocal(
        this.shuttleAnchor && this.shuttleAnchor.id === entity.id
          ? this.shuttleAnchor.position
          : entity.position,
      );
      object.position.set(local.x, local.y, local.z);
      object.quaternion.set(entity.rotation.x, entity.rotation.y, entity.rotation.z, entity.rotation.w);
      if (model === 'panel' || this.statusLights.has(entity.id)) {
        this.tmpQuat.set(entity.rotation.x, entity.rotation.y, entity.rotation.z, entity.rotation.w);
        this.tmpQuatInverse.copy(this.tmpQuat).invert();
        this.tmpLocalSun.copy(sun).applyQuaternion(this.tmpQuatInverse);
      }
      if (model === 'panel') {
        const head = this.panelHeads.get(entity.id);
        if (head) {
          if (this.tmpLocalSun.y > 0.02) {
            head.quaternion.setFromUnitVectors(PANEL_NORMAL, this.tmpLocalSun.normalize());
          } else {
            head.quaternion.copy(REST_PANEL);
          }
        }
      }
      const status = this.statusLights.get(entity.id);
      if (status) {
        const power = entity.components.power;
        if (power?.paused) status.material = this.statusRed;
        else if (entity.components.printer?.recipeId) status.material = this.statusGreen;
        else if (entity.components.machine?.machineType === 'solar_panel') {
          status.material = this.tmpLocalSun.y > 0.02 ? this.statusGreen : this.statusYellow;
        } else {
          status.material = this.statusYellow;
        }
      }
      const cans = this.fuelCans.get(entity.id);
      if (cans) {
        const fuel = entity.components.shuttle?.fuel ?? 0;
        cans.forEach((can, index) => {
          can.material = index < fuel ? this.accentMat : this.darkMat;
        });
      }
      const engineGlow = this.engineGlows.get(entity.id);
      if (engineGlow) engineGlow.visible = entity.components.shuttle?.airborne === true;
      if (entity.kind === 'lightstick') {
        const itemId = entity.components.item?.itemId;
        if (itemId && isKnownItem(itemId)) {
          const glow = itemDef(itemId).emitsLight;
          if (glow) {
            this.tmpQuat.set(entity.rotation.x, entity.rotation.y, entity.rotation.z, entity.rotation.w);
            this.tmpTip.set(0, 0.3, 0).applyQuaternion(this.tmpQuat);
            emitters.push({
              position: {
                x: entity.position.x + this.tmpTip.x,
                y: entity.position.y + this.tmpTip.y,
                z: entity.position.z + this.tmpTip.z,
              },
              color: glow.color,
              intensity: glow.intensity,
            });
          }
        }
      }
    }
    for (const [id, object] of [...this.objects]) {
      if (seen.has(id)) continue;
      this.group.remove(object);
      this.objects.delete(id);
      this.panelHeads.delete(id);
      this.statusLights.delete(id);
      this.fuelCans.delete(id);
      this.engineGlows.delete(id);
    }
    return emitters;
  }

  private modelFor(entity: Entity): PlaceableModel | null {
    if (entity.kind === 'lightstick') return 'lightstick';
    if (entity.kind === 'platform') return 'platform';
    if (entity.kind === 'shuttle') {
      const id = entity.components.placeable?.placeableId;
      return (id ? placeableById(id)?.model : undefined) ?? 'shuttle';
    }
    if (entity.kind !== 'machine') return null;
    const machineType = entity.components.machine?.machineType;
    if (!machineType || machineType === 'habitat') return null; // HabitatViews owns domes.
    return placeableForMachineType(machineType)?.model ?? null;
  }

  private build(
    model: PlaceableModel,
    def: PlaceableDef | undefined,
    withStatus: boolean,
  ): {
    group: THREE.Group;
    head: THREE.Group | null;
    status: THREE.Mesh | null;
    fuelCans: THREE.Mesh[] | null;
    engineGlow: THREE.Mesh | null;
  } {
    const g = new THREE.Group();
    const heightM = def?.heightM ?? 1;
    let head: THREE.Group | null = null;
    let fuelCans: THREE.Mesh[] | null = null;
    let engineGlow: THREE.Mesh | null = null;
    const part = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      scale: [number, number, number],
      pos: [number, number, number],
      rot: [number, number, number] = [0, 0, 0],
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.set(scale[0], scale[1], scale[2]);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.rotation.set(rot[0], rot[1], rot[2]);
      g.add(mesh);
      return mesh;
    };
    if (model === 'platform') {
      part(this.cyl, this.bodyMat, [2.2, 0.55, 2.2], [0, 0.35, 0]);
      for (let i = 0; i < 4; i += 1) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        part(this.box, this.accentMat, [0.28, 0.5, 0.28], [Math.cos(a) * 1.8, 0.15, Math.sin(a) * 1.8]);
      }
      // Slot pads come from the same JSON the placement rules use; they make
      // "aim at the top to attach a machine" discoverable.
      for (const slot of def?.slots ?? []) {
        part(this.cyl, this.darkMat, [0.24, 0.025, 0.24], [slot.x, slot.y + 0.015, slot.z]);
      }
    } else if (model === 'printer_small') {
      part(this.box, this.bodyMat, [1.15, 0.9, 1.0], [0, 0.45, 0]);
      part(this.box, this.darkMat, [0.7, 0.28, 0.5], [0, 0.55, 0.45]);
      part(this.box, this.accentMat, [0.8, 0.12, 0.35], [0, 0.94, 0]);
      part(this.box, this.darkMat, [0.35, 0.3, 0.3], [0, 0.35, -0.55]);
    } else if (model === 'printer_medium') {
      part(this.box, this.bodyMat, [1.2, 1.7, 1.1], [0, 0.85, 0]);
      part(this.box, this.darkMat, [0.5, 0.9, 0.6], [0, 0.75, 0.6]);
      part(this.box, this.accentMat, [1.3, 0.14, 0.25], [0, 1.65, 0.5]);
      part(this.box, this.accentMat, [0.35, 0.2, 1.2], [0, 1.45, 0]);
    } else if (model === 'panel') {
      part(this.cyl, this.darkMat, [0.1, 1.6, 0.1], [0, 0.8, 0]);
      head = new THREE.Group();
      head.name = 'panelHead';
      head.position.set(0, 1.75, 0);
      head.quaternion.copy(REST_PANEL);
      const panel = new THREE.Mesh(this.box, this.panelMat);
      panel.scale.set(1.6, 1.05, 0.08);
      head.add(panel);
      const frame = new THREE.Mesh(this.box, this.accentMat);
      frame.scale.set(1.7, 0.08, 0.1);
      frame.position.set(0, 0.5, 0.05);
      head.add(frame);
      g.add(head);
      part(this.box, this.darkMat, [0.35, 0.16, 0.35], [0, 0.08, 0]);
    } else if (model === 'battery') {
      part(this.cyl, this.bodyMat, [0.48, 1.15, 0.48], [0, 0.6, 0]);
      part(this.cyl, this.accentMat, [0.5, 0.14, 0.5], [0, 0.9, 0]);
      part(this.cyl, this.accentMat, [0.5, 0.14, 0.5], [0, 0.32, 0]);
      part(this.cyl, this.darkMat, [0.2, 0.15, 0.2], [0, 1.22, 0]);
    } else if (model === 'furnace') {
      part(this.box, this.bodyMat, [1.25, 1.3, 1.15], [0, 0.68, 0]);
      part(this.box, this.darkMat, [0.7, 0.55, 0.2], [0, 0.55, 0.6]);
      part(this.box, this.glowMat, [0.5, 0.35, 0.1], [0, 0.52, 0.64]);
      part(this.cyl, this.darkMat, [0.18, 0.75, 0.18], [0.45, 1.65, 0]);
      part(this.box, this.accentMat, [0.6, 0.12, 0.8], [0, 1.36, 0]);
    } else if (model === 'station') {
      part(this.box, this.bodyMat, [1.3, 0.16, 0.9], [0, 0.9, 0]);
      for (const sx of [-0.5, 0.5]) {
        for (const sz of [-0.32, 0.32]) {
          part(this.box, this.darkMat, [0.1, 0.9, 0.1], [sx, 0.45, sz]);
        }
      }
      part(this.sphere, this.sampleMat, [0.32, 0.26, 0.32], [0, 1.1, 0]);
      part(this.box, this.accentMat, [1.36, 0.08, 0.96], [0, 0.82, 0]);
    } else if (model === 'refinery') {
      part(this.cyl, this.bodyMat, [0.45, 1.6, 0.45], [-0.55, 0.8, 0]);
      part(this.cyl, this.bodyMat, [0.45, 1.6, 0.45], [0.55, 0.8, 0]);
      part(this.cyl, this.accentMat, [0.16, 0.9, 0.16], [0, 1.35, 0]);
      part(this.box, this.darkMat, [0.9, 0.4, 0.9], [0, 0.25, 0.7]);
      part(this.box, this.accentMat, [1.4, 0.1, 0.16], [0, 1.72, 0]);
    } else if (model === 'shuttle') {
      // Capsule cockpit + nose cone.
      part(this.capsule, this.bodyMat, [0.78, 0.95, 0.78], [0, 1.35, 0]);
      part(this.cone, this.bodyMat, [0.58, 0.7, 0.58], [0, 2.5, 0]);
      part(this.sphere, this.panelMat, [0.34, 0.24, 0.2], [0, 1.7, 0.52]);
      // Two side thrusters.
      for (const side of [-1, 1]) {
        part(this.cyl, this.darkMat, [0.26, 0.9, 0.26], [side * 1.02, 1.0, 0]);
      }
      // Landing legs (three) with small feet.
      for (let i = 0; i < 3; i += 1) {
        const a = (i / 3) * Math.PI * 2;
        part(this.box, this.darkMat, [0.1, 0.56, 0.1], [Math.cos(a) * 0.72, 0.3, Math.sin(a) * 0.72]);
        part(this.cyl, this.darkMat, [0.2, 0.06, 0.2], [Math.cos(a) * 0.72, 0.03, Math.sin(a) * 0.72]);
      }
      // Two side fuel slots: the canisters fill orange as cells are loaded.
      fuelCans = [];
      for (const side of [-1, 1]) {
        fuelCans.push(
          part(this.cyl, side === -1 ? this.accentMat : this.darkMat, [0.17, 0.42, 0.17], [side * 0.66, 1.45, 0.48]),
        );
      }
      // Engine bell + a glow that only shows while airborne.
      part(this.cyl, this.darkMat, [0.3, 0.28, 0.3], [0, 0.14, 0]);
      engineGlow = part(this.cone, this.glowMat, [0.24, 0.42, 0.24], [0, 0.08, 0], [Math.PI, 0, 0]);
      engineGlow.visible = false;
    } else if (model === 'lightstick') {
      part(this.cyl, this.bodyMat, [0.07, 0.5, 0.07], [0, 0.25, 0]);
      part(this.sphere, this.accentMat, [0.11, 0.11, 0.11], [0, 0.52, 0]);
    }
    let status: THREE.Mesh | null = null;
    if (withStatus) {
      status = new THREE.Mesh(this.sphere, this.statusYellow);
      status.name = 'statusLight';
      status.scale.setScalar(0.09);
      status.position.set(0.45, Math.max(0.4, heightM * 0.88), 0.45);
      g.add(status);
    }
    return { group: g, head, status, fuelCans, engineGlow };
  }

  dispose(): void {
    for (const object of this.objects.values()) this.group.remove(object);
    this.objects.clear();
    this.panelHeads.clear();
    this.statusLights.clear();
    this.fuelCans.clear();
    this.engineGlows.clear();
    this.bodyMat.dispose();
    this.darkMat.dispose();
    this.accentMat.dispose();
    this.panelMat.dispose();
    this.glowMat.dispose();
    this.sampleMat.dispose();
    this.statusGreen.dispose();
    this.statusYellow.dispose();
    this.statusRed.dispose();
    this.box.dispose();
    this.cyl.dispose();
    this.sphere.dispose();
    this.cone.dispose();
    this.capsule.dispose();
  }
}
