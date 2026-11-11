// Placeable views (M09): low-poly white/grey bodies with orange accents for
// platforms, stations, machines and the shuttle, plus light sticks and the
// placement ghost. Model selection is data-driven (placeables.json `model`);
// unknown ids are skipped so a future catalog entry never crashes the frame.
// Groups position children absolutely from world doubles (origin-managed).

import * as THREE from 'three';
import { isKnownItem, itemDef } from '../../data/loadData.js';
import {
  placeableById,
  placeableForMachineType,
  type PlaceableModel,
} from '../../data/loadPlaceables.js';
import type { Entity, EntityId } from '../../sim/entities.js';
import { toLocal } from '../floatingOrigin.js';
import type { ItemEmitter } from './itemView.js';

const BODY = 0xd8dde2;
const DARK = 0x4a525b;
const ACCENT = 0xff8a3c;
const PANEL = 0x3b4f6b;
const SAMPLE = 0x6dff8a;

export class PlaceableViews {
  readonly group = new THREE.Group();
  private readonly objects = new Map<EntityId, THREE.Group>();
  private readonly bodyMat = new THREE.MeshStandardMaterial({ color: BODY, roughness: 0.8, metalness: 0.05, flatShading: true });
  private readonly darkMat = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.7, metalness: 0.3, flatShading: true });
  private readonly accentMat = new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.5, metalness: 0.2, emissive: new THREE.Color(ACCENT), emissiveIntensity: 0.25, flatShading: true });
  private readonly panelMat = new THREE.MeshStandardMaterial({ color: PANEL, roughness: 0.35, metalness: 0.35, flatShading: true });
  private readonly glowMat = new THREE.MeshStandardMaterial({ color: 0x2a1206, emissive: new THREE.Color(ACCENT), emissiveIntensity: 2, flatShading: true });
  private readonly sampleMat = new THREE.MeshStandardMaterial({ color: 0x0c2a14, emissive: new THREE.Color(SAMPLE), emissiveIntensity: 1.6, flatShading: true });
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
  private readonly sphere = new THREE.SphereGeometry(1, 10, 8);
  private readonly cone = new THREE.ConeGeometry(1, 1, 8);
  private readonly capsule = new THREE.CapsuleGeometry(0.6, 1.1, 4, 10);

  constructor() {
    this.group.name = 'placeables';
    this.group.userData['originManaged'] = true;
  }

  /** Reconcile placeables/machines/shuttles/light sticks; returns emitters. */
  sync(entities: Iterable<Entity>): ItemEmitter[] {
    const seen = new Set<EntityId>();
    const emitters: ItemEmitter[] = [];
    for (const entity of entities) {
      const model = this.modelFor(entity);
      if (!model) continue;
      seen.add(entity.id);
      let object = this.objects.get(entity.id);
      if (!object) {
        object = this.build(model);
        this.objects.set(entity.id, object);
        this.group.add(object);
      }
      const local = toLocal(entity.position);
      object.position.set(local.x, local.y, local.z);
      object.quaternion.set(entity.rotation.x, entity.rotation.y, entity.rotation.z, entity.rotation.w);
      if (entity.kind === 'lightstick') {
        const itemId = entity.components.item?.itemId;
        if (itemId && isKnownItem(itemId)) {
          const glow = itemDef(itemId).emitsLight;
          if (glow) {
            const q = new THREE.Quaternion(entity.rotation.x, entity.rotation.y, entity.rotation.z, entity.rotation.w);
            const tip = new THREE.Vector3(0, 0.3, 0).applyQuaternion(q);
            emitters.push({
              position: { x: entity.position.x + tip.x, y: entity.position.y + tip.y, z: entity.position.z + tip.z },
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

  private build(model: PlaceableModel): THREE.Group {
    const g = new THREE.Group();
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
      part(this.box, this.panelMat, [1.6, 1.05, 0.08], [0, 1.75, 0], [-0.48, 0, 0]);
      part(this.box, this.accentMat, [1.7, 0.08, 0.1], [0, 2.25, 0.05], [-0.48, 0, 0]);
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
      part(this.capsule, this.bodyMat, [0.85, 0.9, 0.85], [0, 1.35, 0]);
      part(this.cone, this.bodyMat, [0.62, 0.7, 0.62], [0, 2.55, 0]);
      part(this.sphere, this.panelMat, [0.34, 0.24, 0.2], [0, 1.65, 0.55]);
      for (let i = 0; i < 3; i += 1) {
        const a = (i / 3) * Math.PI * 2;
        part(this.box, this.accentMat, [0.14, 0.9, 0.5], [Math.cos(a) * 0.75, 0.45, Math.sin(a) * 0.75], [0, -a, 0]);
      }
      part(this.cyl, this.darkMat, [0.32, 0.35, 0.32], [0, 0.15, 0]);
    } else if (model === 'lightstick') {
      part(this.cyl, this.bodyMat, [0.07, 0.5, 0.07], [0, 0.25, 0]);
      part(this.sphere, this.accentMat, [0.11, 0.11, 0.11], [0, 0.52, 0]);
    }
    return g;
  }

  dispose(): void {
    for (const object of this.objects.values()) this.group.remove(object);
    this.objects.clear();
    this.bodyMat.dispose();
    this.darkMat.dispose();
    this.accentMat.dispose();
    this.panelMat.dispose();
    this.glowMat.dispose();
    this.sampleMat.dispose();
    this.box.dispose();
    this.cyl.dispose();
    this.sphere.dispose();
    this.cone.dispose();
    this.capsule.dispose();
  }
}

/** Translucent placement ghost: footprint disc + body box, green or red. */
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
  ): void {
    const def = placeableId ? placeableById(placeableId) : undefined;
    if (!def || !position || !up) {
      this.group.visible = false;
      return;
    }
    const local = toLocal(position);
    this.group.position.set(local.x, local.y, local.z);
    const upVec = new THREE.Vector3(up.x, up.y, up.z).normalize();
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), upVec);
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
