// M12 balance guard: the shortest new-game -> Drill Mk3 path needs roughly
// 6 ferrite ore, 3 cuprite ore, 3 silicate and optional biomass fuel before
// the player leaves the starting area. The deterministic node streamer must
// keep that reachable near spawn; if terrain tuning ever starves a resource
// this test fails instead of shipping a grind wall.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import { findSpawnPosition } from '../../src/sim/physics/spawn.js';
import { updateNodes } from '../../src/sim/systems/nodes.js';
import { World } from '../../src/sim/world.js';

interface ResourceTally {
  nodes: number;
  charges: number;
}

function nearbyResources(seed: number): Map<string, ResourceTally> {
  const world = new World(seed);
  world.planets = [SELA];
  world.dispatch({
    type: 'spawnPlayer',
    planetId: SELA.id,
    position: findSpawnPosition(SELA, seed),
  });
  world.tick();
  updateNodes(world, [SELA]);
  const tally = new Map<string, ResourceTally>();
  for (const entity of world.entities.values()) {
    const node = entity.components.node;
    if (entity.kind !== 'node' || !node) continue;
    const entry = tally.get(node.resourceId) ?? { nodes: 0, charges: 0 };
    entry.nodes += 1;
    entry.charges += node.charges;
    tally.set(node.resourceId, entry);
  }
  return tally;
}

describe('M12 balance (starting-area resources)', () => {
  it('has enough ore, silicate and biomass near spawn for the Mk3 path', () => {
    const tally = nearbyResources(1337);
    expect(tally.get('ferrite_ore')?.charges ?? 0).toBeGreaterThanOrEqual(6);
    expect(tally.get('cuprite_ore')?.charges ?? 0).toBeGreaterThanOrEqual(3);
    expect(tally.get('silicate')?.nodes ?? 0).toBeGreaterThanOrEqual(3);
    // Fuel is optional, but the biome must visibly offer it on Sela.
    expect(tally.get('biomass')?.nodes ?? 0).toBeGreaterThanOrEqual(4);
  });
});
