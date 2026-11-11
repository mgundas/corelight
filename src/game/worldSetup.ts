// World construction wiring (M07). Split out of Game to keep both files
// under the 400-line hard rule: builds the terrain collider ring, registers
// the sim systems in tick order (physics, items, nodes, tethers, oxygen,
// sun) and spawns (or finds, on Continue) the player plus the starting
// habitat. All seeds derive from the world.

import {
  BACKPACK_SLOTS,
  HABITAT_FLATTEN_RADIUS_M,
  HABITAT_SPAWN_OFFSET_M,
  SIM_DT,
} from '../core/constants.js';
import { cross, IDENTITY_QUAT, normalize, sub } from '../core/math.js';
import { placeableDef } from '../data/loadPlaceables.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { physicsWorldFor } from '../sim/physics/rapierWorld.js';
import { findSpawnPosition } from '../sim/physics/spawn.js';
import { makePhysicsSystem } from '../sim/physics/system.js';
import { makeItemsSystem } from '../sim/systems/items.js';
import { updateCrafting } from '../sim/systems/crafting.js';
import { updateNodes } from '../sim/systems/nodes.js';
import { updateOxygen } from '../sim/systems/oxygen.js';
import { updateTethers } from '../sim/systems/tethers.js';
import { updateSun } from '../sim/systems/sun.js';
import { TerrainColliders } from '../sim/physics/terrainColliders.js';
import type { ColliderPool } from '../terrain/colliderPool.js';
import { createDensityField } from '../terrain/density.js';
import type { Entity, EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import { upAt } from '../sim/physics/frames.js';

export interface WorldSetup {
  colliders: TerrainColliders;
  playerId: EntityId | null;
  /** LOD0 chunk keys flattened for the habitat pad (Game re-notifies the streamer). */
  editedKeys: string[];
}

export interface WorldSetupOptions {
  /** Dev shortcut (?dev=1): fill the fresh backpack with tether items. */
  devTethers?: boolean;
}

/** Lateral offset from a world position (perpendicular to planet up). */
function lateralOffset(planet: PlanetConfig, pos: { x: number; y: number; z: number }, dist: number): { x: number; y: number; z: number } {
  const up = normalize(sub(pos, planet.center));
  const ref = Math.abs(up.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const east = normalize(cross(up, ref));
  return { x: pos.x + east.x * dist, y: pos.y + east.y * dist, z: pos.z + east.z * dist };
}

/**
 * Seat a world-space anchor on the live (edited) surface by marching radially
 * inward from above and bisecting the air->solid crossing. Returns the input
 * when no crossing is found (e.g. a cave mouth).
 */
function seatOnSurface(
  field: ReturnType<typeof createDensityField>,
  planet: PlanetConfig,
  anchor: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const dir = normalize(sub(anchor, planet.center));
  let r = planet.radius + 80;
  let prevD = field.density(dir.x * (r + 20), dir.y * (r + 20), dir.z * (r + 20));
  for (let rr = r + 19; rr > planet.radius - 60; rr -= 1) {
    const d = field.density(dir.x * rr, dir.y * rr, dir.z * rr);
    if (prevD < 0 && d >= 0) {
      return {
        x: planet.center.x + dir.x * rr,
        y: planet.center.y + dir.y * rr,
        z: planet.center.z + dir.z * rr,
      };
    }
    prevD = d;
  }
  return { ...anchor };
}

/**
 * Starting base (M09): a platform with the pre-placed small printer, on the
 * opposite side of the pad from the habitat. Setup-only wiring: the entities
 * are created through the spawnPlaceable Action.
 */
function spawnStarterBase(world: World, planet: PlanetConfig, anchor: { x: number; y: number; z: number }): void {
  const field = createDensityField(planet, world.seed, (x, y, z) =>
    world.terrainEdits.deltaAt(planet, planet.id, x, y, z),
  );
  const platformAnchor = lateralOffset(planet, anchor, -3.5);
  const platformPos = seatOnSurface(field, planet, platformAnchor);
  world.dispatch({
    type: 'spawnPlaceable',
    planetId: planet.id,
    placeableId: 'platform',
    position: platformPos,
  });
  const up = upAt(planet, platformPos);
  const top = placeableDef('platform').heightM;
  world.dispatch({
    type: 'spawnPlaceable',
    planetId: planet.id,
    placeableId: 'small_printer',
    position: {
      x: platformPos.x + up.x * top,
      y: platformPos.y + up.y * top,
      z: platformPos.z + up.z * top,
    },
  });
}

/**
 * Flatten a pad for the habitat and spawn it next to an anchor point.
 * Direct edit-store writes (not an Action): this is world initialization,
 * the same as the player spawn above — all later changes go through
 * dispatch. Returns the touched LOD0 keys so Game can re-notify the
 * streamer after the boot prebuilt (which predates the pad) is adopted.
 */
function spawnHabitatNear(world: World, planet: PlanetConfig, anchor: { x: number; y: number; z: number }): string[] {
  const up = normalize(sub(anchor, planet.center));
  // The player spawn hovers SPAWN_HOVER_M above the surface; the pad sits on it.
  const ground = {
    x: anchor.x - up.x * 2,
    y: anchor.y - up.y * 2,
    z: anchor.z - up.z * 2,
  };
  const local = {
    x: ground.x - planet.center.x,
    y: ground.y - planet.center.y,
    z: ground.z - planet.center.z,
  };
  const base = createDensityField(planet, world.seed);
  const outcome = world.terrainEdits.applySphere(
    planet,
    base.density,
    local,
    HABITAT_FLATTEN_RADIUS_M,
    // Strength 4 snaps the inner ~7 m fully to the plane (strength*falloff
    // >= 1): a real flat base pad for the starter platform/printer and M10
    // construction. Strength 1 left the noisy surface sloping >20° almost
    // everywhere, so M09 placement could not be tested at the base.
    4,
    'flatten',
    {
      flattenPlane: {
        point: { ...local },
        normal: { ...up },
      },
    },
  );
  const habitatPos = lateralOffset(planet, ground, HABITAT_SPAWN_OFFSET_M);
  // Seat the dome on the pad: drop the offset point onto the flattened
  // surface by reusing the spawn raymarch from above.
  const field = createDensityField(planet, world.seed, (x, y, z) =>
    world.terrainEdits.deltaAt(planet, planet.id, x, y, z),
  );
  const seated = seatOnSurface(field, planet, habitatPos);
  world.dispatch({ type: 'spawnHabitat', planetId: planet.id, position: seated });
  spawnStarterBase(world, planet, ground);
  return outcome.keys;
}

function playerById(world: World, playerId: EntityId | null): Entity | undefined {
  return playerId ? world.entities.get(playerId) : undefined;
}

/** Fill empty backpack slots with Tether items (?dev=1 oxygen testing). */
function grantDevTethers(world: World, player: Entity): void {
  const inventory = player.components.inventory;
  if (!inventory) return;
  for (let i = 0; i < inventory.slots.length && i < BACKPACK_SLOTS; i += 1) {
    if (inventory.slots[i] !== null) continue;
    const id = world.nextId('item');
    world.entities.set(id, {
      id,
      kind: 'item',
      planetId: player.planetId,
      position: { ...player.position },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'tether', holder: player.id } },
    });
    inventory.slots[i] = id;
  }
}

/** Register systems + spawn the player; returns the ring and player id. */
export function setupWorldSystems(
  world: World,
  planets: PlanetConfig[],
  colliderPool: ColliderPool,
  seed: number,
  existingWorld: World | undefined,
  opts: WorldSetupOptions = {},
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
  // Items freeze where their ground chunk is not loaded: without this a
  // dropped item (or a death-drop) falls toward the core once the player
  // walks away and its colliders unload.
  world.addSystem(
    makeItemsSystem({
      planets,
      worldFor: physicsWorldFor,
      groundReady: (pos) => colliders.groundState(pos, planets) === 'ready',
    }),
  );
  // Deterministic resource nodes stream in around each player.
  world.addSystem((tickWorld) => updateNodes(tickWorld, planets));
  // Tether graph (recomputed only on topology/nearby-edit changes).
  world.addSystem((tickWorld) => updateTethers(tickWorld, planets));
  // Oxygen breathing, canisters and death/respawn (reads the tether graph).
  world.addSystem((tickWorld, dt) => updateOxygen(tickWorld, planets, dt));
  // Station print jobs (M09): advances timers, exposes finished outputs.
  world.addSystem((tickWorld, dt) => updateCrafting(tickWorld, dt));
  // Environment clock (order-free: only re-derives sunDirection from time).
  world.addSystem(updateSun);
  let playerId: EntityId | null = null;
  let editedKeys: string[] = [];
  const home = planets[0] as PlanetConfig;
  if (existingWorld) {
    for (const entity of world.entities.values()) {
      if (entity.kind === 'player') {
        playerId = entity.id;
        break;
      }
    }
    // Old saves predate habitats (M06/M07): heal by seating one by the player.
    const player = playerById(world, playerId);
    const planetId = player?.planetId ?? undefined;
    const machines = [...world.entities.values()].filter(
      (e) => e.kind === 'machine' && e.planetId === planetId,
    );
    const hasHabitat = machines.some((e) => e.components.machine?.machineType === 'habitat');
    const hasPrinter = machines.some((e) => e.components.machine?.machineType === 'small_printer');
    if (player && planetId !== undefined && !hasHabitat) {
      const planet = planets.find((p) => p.id === planetId) ?? home;
      editedKeys = spawnHabitatNear(world, planet, player.position);
      world.tick(SIM_DT);
    } else if (player && planetId !== undefined && !hasPrinter) {
      // M08 saves predate the M09 starting printer: seat one by the player
      // (the starting pad / habitat area in practice).
      const planet = planets.find((p) => p.id === planetId) ?? home;
      spawnStarterBase(world, planet, player.position);
      world.tick(SIM_DT);
    }
  } else {
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
    const player = playerById(world, playerId);
    if (player) {
      editedKeys = spawnHabitatNear(world, home, player.position);
      world.tick(SIM_DT);
      if (opts.devTethers) grantDevTethers(world, player);
    }
  }
  return { colliders, playerId, editedKeys };
}
