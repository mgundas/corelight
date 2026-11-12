import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { itemDef } from '../../src/data/loadData.js';
import { ItemViews } from '../../src/render/views/itemView.js';
import { NodeViews } from '../../src/render/views/nodeView.js';
import { ItemLights } from '../../src/render/itemLights.js';
import { PlayerView } from '../../src/render/views/playerView.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import type { Entity } from '../../src/sim/entities.js';

function itemEntity(id: string, itemId: string, holder?: string): Entity {
  return {
    id,
    kind: 'item',
    planetId: 'sela',
    position: { x: 1, y: 2, z: 3 },
    rotation: { ...IDENTITY_QUAT },
    components: { item: holder ? { itemId, holder } : { itemId } },
  };
}

describe('item views', () => {
  it('syncs one mesh per loose item and skips carried or unknown ones', () => {
    const views = new ItemViews();
    const entities = [
      itemEntity('a', 'resin'),
      itemEntity('b', 'lumen_crystal'),
      itemEntity('c', 'resin', 'player_1'),
      { ...itemEntity('d', 'resin'), components: { item: { itemId: 'future_thing' } } },
    ];
    const emitters = views.sync(entities);
    expect(views.group.children.length).toBe(2);
    // Only the lumen crystal glows.
    expect(emitters.length).toBe(1);
    expect(emitters[0]?.color).toBe(itemDef('lumen_crystal').emitsLight?.color);
    // Removing the entity removes its mesh.
    views.sync([entities[0] as Entity]);
    expect(views.group.children.length).toBe(1);
    views.dispose();
    expect(views.group.children.length).toBe(0);
  });
});

describe('node views', () => {
  it('builds one deterministic cluster per node', () => {    const views = new NodeViews();
    const node = (id: string): Entity => ({
      id,
      kind: 'node',
      planetId: 'sela',
      position: { x: 4, y: 5, z: 6 },
      rotation: { ...IDENTITY_QUAT },
      components: { node: { resourceId: 'ferrite_ore', charges: 3, maxCharges: 3, chunkKey: 'sela:0:1:2:3' } },
    });
    const a = node('node_x');
    const emitters = views.sync([a]);
    expect(views.group.children.length).toBe(1);
    const cluster = views.group.children[0];
    const shardCount = cluster?.children.length ?? 0;
    expect(shardCount).toBeGreaterThanOrEqual(3);
    expect(emitters.length).toBe(0);
    // Re-syncing the same node keeps the same cluster (no reshuffle).
    views.sync([a]);
    expect(views.group.children[0]?.children.length).toBe(shardCount);
    views.dispose();
  });

  it('glows any deposit whose item emits light (data-driven)', () => {
    const views = new NodeViews();
    const node = (id: string, resourceId: string): Entity => ({
      id,
      kind: 'node',
      planetId: 'sela',
      position: { x: 4, y: 5, z: 6 },
      rotation: { ...IDENTITY_QUAT },
      components: { node: { resourceId, charges: 3, maxCharges: 3, chunkKey: 'sela:0:1:2:3' } },
    });
    // Voidstone emits light per items.json, so the deposit glows too.
    expect(views.sync([node('n1', 'voidstone')]).length).toBe(1);
    // Common ores stay dark until mined.
    expect(views.sync([node('n2', 'ferrite_ore')]).length).toBe(0);
    views.dispose();
  });

  it('renders biomass deposits as low-poly plant tufts (M12)', () => {
    const views = new NodeViews();
    const node = (id: string, resourceId: string): Entity => ({
      id,
      kind: 'node',
      planetId: 'sela',
      position: { x: 4, y: 5, z: 6 },
      rotation: { ...IDENTITY_QUAT },
      components: { node: { resourceId, charges: 3, maxCharges: 3, chunkKey: 'sela:0:1:2:3' } },
    });
    views.sync([node('plant', 'biomass')]);
    const tuft = views.group.children[0];
    expect(tuft?.children.length).toBeGreaterThanOrEqual(8);
    // Slim tall stems + dark leaf blades, not the short round ore shards.
    expect(tuft?.children.some((child) => child.scale.y >= 1.1 && child.scale.x < 0.7)).toBe(true);
    const colors = new Set(
      (tuft?.children ?? [])
        .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
        .map((mesh) => (mesh.material as THREE.MeshStandardMaterial).color.getHexString()),
    );
    expect(colors.size).toBeGreaterThanOrEqual(2);
    // The same node id rebuilds the identical tuft (deterministic layout).
    const leaves = tuft?.children.length ?? 0;
    views.sync([]);
    views.sync([node('plant', 'biomass')]);
    expect(views.group.children[0]?.children.length).toBe(leaves);
    // Ferrite still meshes as a shard cluster.
    views.sync([node('ore', 'ferrite_ore')]);
    const ore = views.group.children[0];
    expect(ore?.children.every((child) => child.scale.y < 1.3)).toBe(true);
    views.dispose();
  });
});

describe('backpack view', () => {
  it('shows one mini mesh per filled slot and clears emptied ones', () => {
    const view = new PlayerView();
    const base = view.group.children.length;
    view.renderBackpack([itemDef('resin'), null, itemDef('lumen_crystal'), null, null, null, null, null]);
    expect(view.group.children.length).toBe(base + 2);
    view.renderBackpack([null, null, null, null, null, null, null, null]);
    expect(view.group.children.length).toBe(base);
    // Reconciliation is id-based: same loadout adds nothing.
    view.renderBackpack([itemDef('resin'), null, null, null, null, null, null, null]);
    const once = view.group.children.length;
    view.renderBackpack([itemDef('resin'), null, null, null, null, null, null, null]);
    expect(view.group.children.length).toBe(once);
    view.dispose();
  });
});

describe('item light budget', () => {
  it('parks the pool on the nearest emitters only', () => {
    const lights = new ItemLights();
    expect(lights.group.children.length).toBe(12);
    const emitters = Array.from({ length: 20 }, (_, i) => ({
      position: { x: i * 10, y: 0, z: 0 },
      color: '#ffffff',
      intensity: 10,
    }));
    lights.update({ x: 0, y: 0, z: 0 }, emitters);
    const visible = lights.group.children.filter((o) => o.visible).length;
    expect(visible).toBe(12);
    lights.update({ x: 0, y: 0, z: 0 }, []);
    expect(lights.group.children.filter((o) => o.visible).length).toBe(0);
    lights.dispose();
  });
});
