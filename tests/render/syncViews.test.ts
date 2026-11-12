// Fan-out regression test (M08 invisible-tether bug): the frame loop hands
// ONE shared iterator (map.values()) to every entity view. Map iterators are
// single-use — passing one straight through starved every view after the
// first. syncEntityViews snapshots first, so one iterator feeds all views.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import type { Entity, EntityId } from '../../src/sim/entities.js';
import { ItemViews } from '../../src/render/views/itemView.js';
import { NodeViews } from '../../src/render/views/nodeView.js';
import { SampleViews } from '../../src/render/views/sampleView.js';
import { HabitatViews, MarkerViews, TetherViews } from '../../src/render/views/tetherView.js';
import { PlaceableViews } from '../../src/render/views/placeableView.js';
import { CableViews } from '../../src/render/views/cableViews.js';
import { syncEntityViews } from '../../src/render/views/syncViews.js';

function makeWorld(): Map<EntityId, Entity> {
  const spawn = findSpawnPosition(SELA, 1337);
  const at = (dx: number, dy: number, dz: number) => ({
    x: spawn.x + dx,
    y: spawn.y + dy,
    z: spawn.z + dz,
  });
  const entities = new Map<EntityId, Entity>();
  const add = (entity: Entity): void => {
    entities.set(entity.id, entity);
  };
  add({
    id: 'player_1',
    kind: 'player',
    planetId: SELA.id,
    position: { ...spawn },
    rotation: { ...IDENTITY_QUAT },
    components: {},
  });
  add({
    id: 'item_1',
    kind: 'item',
    planetId: SELA.id,
    position: at(2, 1, 0),
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId: 'lumen_crystal' } },
  });
  add({
    id: 'node_1',
    kind: 'node',
    planetId: SELA.id,
    position: at(-2, 1, 0),
    rotation: { ...IDENTITY_QUAT },
    components: { node: { resourceId: 'resin', charges: 3, maxCharges: 3, chunkKey: 'k' } },
  });
  add({
    id: 'sample_1',
    kind: 'sample',
    planetId: SELA.id,
    position: at(-4, 0, 2),
    rotation: { ...IDENTITY_QUAT },
    components: {
      sample: { value: 10, chunkKey: 'k' },
      item: { itemId: 'research_sample' },
    },
  });
  add({
    id: 'tether_1',
    kind: 'tether',
    planetId: SELA.id,
    position: at(0, 0, 2),
    rotation: { ...IDENTITY_QUAT },
    components: { tether: { live: true, links: [] } },
  });
  add({
    id: 'machine_1',
    kind: 'machine',
    planetId: SELA.id,
    position: at(0, 0, -8),
    rotation: { ...IDENTITY_QUAT },
    components: { machine: { machineType: 'habitat' } },
  });
  add({
    id: 'marker_1',
    kind: 'marker',
    planetId: SELA.id,
    position: at(0, 1, 4),
    rotation: { ...IDENTITY_QUAT },
    components: {},
  });
  add({
    id: 'platform_1',
    kind: 'platform',
    planetId: SELA.id,
    position: at(4, 0, 4),
    rotation: { ...IDENTITY_QUAT },
    components: { placeable: { placeableId: 'platform' } },
  });
  add({
    id: 'lightstick_1',
    kind: 'lightstick',
    planetId: SELA.id,
    position: at(5, 0, -2),
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId: 'light_stick' } },
  });
  add({
    id: 'cable_1',
    kind: 'cable',
    planetId: SELA.id,
    position: at(2, 0, -4),
    rotation: { ...IDENTITY_QUAT },
    components: {
      cable: {
        a: { entityId: 'platform_1', snapIndex: 0 },
        b: { entityId: 'machine_1', snapIndex: 0 },
      },
    },
  });
  return entities;
}

describe('syncEntityViews', () => {
  it('feeds all five views from one shared iterator', () => {
    const entities = makeWorld();
    const views = {
      itemViews: new ItemViews(),
      nodeViews: new NodeViews(),
      sampleViews: new SampleViews(),
      placeableViews: new PlaceableViews(),
      tetherViews: new TetherViews(),
      habitatViews: new HabitatViews(),
      markerViews: new MarkerViews(),
      cableViews: new CableViews(),
    };
    // Exactly the production shape: a single map.values() iterator shared
    // by every view. Pre-fix this left 4 of 5 groups empty.
    const { itemEmitters, nodeEmitters, sampleEmitters, placeableEmitters } = syncEntityViews(
      views,
      entities.values(),
    );
    expect(views.itemViews.group.children.length).toBe(1);
    expect(views.nodeViews.group.children.length).toBe(1);
    expect(views.sampleViews.group.children.length).toBe(1);
    expect(views.placeableViews.group.children.length).toBe(2);
    expect(views.tetherViews.group.children.length).toBe(1);
    expect(views.habitatViews.group.children.length).toBe(1);
    expect(views.markerViews.group.children.length).toBe(1);
    expect(views.cableViews.group.children.length).toBe(1);
    // The glowing crystal still reports its light through the same path,
    // and the placed light stick joins the same emitter list.
    expect(itemEmitters.length).toBe(1);
    expect(nodeEmitters.length).toBe(0);
    expect(sampleEmitters.length).toBe(1);
    expect(placeableEmitters.length).toBe(1);
    views.itemViews.dispose();
    views.nodeViews.dispose();
    views.sampleViews.dispose();
    views.placeableViews.dispose();
    views.tetherViews.dispose();
    views.habitatViews.dispose();
    views.markerViews.dispose();
    views.cableViews.dispose();
  });
});
