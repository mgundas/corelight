// World construction wiring (M07). Split out of Game to keep both files
// under the 400-line hard rule: builds the terrain collider ring, registers
// the sim systems in tick order (physics, items, nodes, sun) and spawns (or
// finds, on Continue) the player. All seeds derive from the world.

import { SIM_DT } from '../core/constants.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { physicsWorldFor } from '../sim/physics/rapierWorld.js';
import { findSpawnPosition } from '../sim/physics/spawn.js';
import { makePhysicsSystem } from '../sim/physics/system.js';
import { makeItemsSystem } from '../sim/systems/items.js';
import { updateNodes } from '../sim/systems/nodes.js';
import { updateSun } from '../sim/systems/sun.js';
import { TerrainColliders } from '../sim/physics/terrainColliders.js';
import type { ColliderPool } from '../terrain/colliderPool.js';
import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';

export interface WorldSetup {
  colliders: TerrainColliders;
  playerId: EntityId | null;
}

/** Register systems + spawn the player; returns the ring and player id. */
export function setupWorldSystems(
  world: World,
  planets: PlanetConfig[],
  colliderPool: ColliderPool,
  seed: number,
  existingWorld: World | undefined,
): WorldSetup {
  const worldSeed = world.seed;
  const colliders = new TerrainColliders(
    {
      request: (planet, requestSeed, coord, editVersion) =>
        colliderPool.request({
          planetConfig: planet,
          worldSeed: requestSeed,
          coord,
          edits: world.terrainEdits.deltasForJob(planet, 0, coord) ?? undefined,
          editVersion,
        }),
    },
    physicsWorldFor,
  );
  world.addSystem(
    makePhysicsSystem({ planets, worldSeed, colliders, edits: world.terrainEdits }),
  );
  // Loose items are Rapier dynamic bodies (ARCH order: right after physics).
  world.addSystem(makeItemsSystem({ planets, worldFor: physicsWorldFor }));
  // Deterministic resource nodes stream in around each player.
  world.addSystem((tickWorld) => updateNodes(tickWorld, planets));
  // Environment clock (order-free: only re-derives sunDirection from time).
  world.addSystem(updateSun);
  let playerId: EntityId | null = null;
  if (existingWorld) {
    for (const entity of world.entities.values()) {
      if (entity.kind === 'player') {
        playerId = entity.id;
        break;
      }
    }
  } else {
    const home = planets[0] as PlanetConfig;
    world.dispatch({
      type: 'spawnPlayer',
      planetId: home.id,
      position: findSpawnPosition(home, seed),
    });
    world.tick(SIM_DT);
    for (const entity of world.entities.values()) {
      if (entity.kind === 'player') {
        playerId = entity.id;
        break;
      }
    }
  }
  return { colliders, playerId };
}
