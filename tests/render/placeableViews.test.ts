// M09 views: one procedural group per placeable/light stick, habitat domes
// stay with HabitatViews, unknown machine types are skipped, and the
// placement ghost switches green/red without owning sim state.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { itemDef } from '../../src/data/loadData.js';
import type { Entity } from '../../src/sim/entities.js';
import { PlaceableViews, PlacementGhost } from '../../src/render/views/placeableView.js';
import { PlayerView } from '../../src/render/views/playerView.js';

function entity(kind: Entity['kind'], components: Entity['components'], id = `${kind}_1`): Entity {
  return {
    id,
    kind,
    planetId: 'sela',
    position: { x: 1, y: 2, z: 3 },
    rotation: { ...IDENTITY_QUAT },
    components,
  };
}

describe('placeable views', () => {
  it('builds one group per platform/machine/light stick and skips habitats', () => {
    const views = new PlaceableViews();
    const entities = [
      entity('platform', { placeable: { placeableId: 'platform' } }, 'p'),
      entity('machine', { machine: { machineType: 'small_printer' }, placeable: { placeableId: 'small_printer' } }, 'm'),
      // Habitat domes belong to HabitatViews (no double mesh).
      entity('machine', { machine: { machineType: 'habitat' }, placeable: { placeableId: 'habitat_kit' } }, 'h'),
      entity('lightstick', { item: { itemId: 'light_stick' } }, 'l'),
      // Unknown machine type: future data must never crash the frame.
      entity('machine', { machine: { machineType: 'unknown_future' } as never }, 'u'),
    ];
    const emitters = views.sync(entities);
    expect(views.group.children.length).toBe(3);
    expect(emitters).toHaveLength(1);
    expect(emitters[0]?.color).toBe(itemDef('light_stick').emitsLight?.color);
    // Removing entities removes their groups.
    views.sync([]);
    expect(views.group.children.length).toBe(0);
    views.dispose();
  });

  it('positions and orients placed groups from sim doubles', () => {
    const views = new PlaceableViews();
    const platform = entity('platform', { placeable: { placeableId: 'platform' } }, 'p');
    platform.position = { x: 10, y: 20, z: 30 };
    platform.rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
    views.sync([platform]);
    const group = views.group.children[0];
    expect(group?.position.x).toBeCloseTo(10 - views.group.position.x, 6);
    expect(group?.quaternion.x).toBeCloseTo(platform.rotation.x, 6);
    views.dispose();
  });
});

describe('placement ghost', () => {
  it('shows a green or red translucent volume and hides on null', () => {
    const ghost = new PlacementGhost();
    ghost.set('platform', { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, true);
    expect(ghost.group.visible).toBe(true);
    const body = ghost.group.children[1] as THREE.Mesh;
    const okColor = (body.material as THREE.MeshBasicMaterial).color.getHex();
    ghost.set('platform', { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, false);
    const badColor = (body.material as THREE.MeshBasicMaterial).color.getHex();
    expect(okColor).not.toBe(badColor);
    expect(okColor).toBe(0x49ff88);
    expect(badColor).toBe(0xff4d4d);
    ghost.set(null, null, null, false);
    expect(ghost.group.visible).toBe(false);
    ghost.dispose();
  });
});

describe('front carry view', () => {
  it('shows one package mesh and clears it without leaking', () => {
    const view = new PlayerView();
    const base = view.group.children.length;
    view.renderFrontCarry(itemDef('platform_package'));
    expect(view.group.children.length).toBe(base + 1);
    // Same id: no duplicate.
    view.renderFrontCarry(itemDef('platform_package'));
    expect(view.group.children.length).toBe(base + 1);
    view.renderFrontCarry(null);
    expect(view.group.children.length).toBe(base);
    view.dispose();
  });
});
