// World construction wiring (M07). Split out of Game to keep both files
// under the 400-line hard rule: builds the terrain collider ring, registers
// the sim systems in tick order (physics, items, nodes, tethers, oxygen,
// sun) and spawns (or finds, on Continue) the player plus the starting
// habitat. All seeds derive from the world.

import {
  BACKPACK_SLOTS,
  CABLE_MAX_LENGTH_M,
  HABITAT_FLATTEN_RADIUS_M,
  HABITAT_SPAWN_OFFSET_M,
  SIM_DT,
} from '../core/constants.js';
import { cross, IDENTITY_QUAT, normalize, sub } from '../core/math.js';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { physicsWorldFor } from '../sim/physics/rapierWorld.js';
import { findSpawnPosition } from '../sim/physics/spawn.js';
import { makePhysicsSystem } from '../sim/physics/system.js';
import { makeItemsSystem } from '../sim/systems/items.js';
import { updateGrab } from '../sim/systems/grab.js';
import { updateCrafting } from '../sim/systems/crafting.js';
import { updateLightsticks } from '../sim/systems/lightsticks.js';
import { updateNodes } from '../sim/systems/nodes.js';
import { updateSamples } from '../sim/systems/samples.js';
import { updateOxygen } from '../sim/systems/oxygen.js';
import { updatePower } from '../sim/systems/power.js';
import { updateResearch } from '../sim/systems/research.js';
import { makeShuttleSystem } from '../sim/systems/shuttle.js';
import { updateTethers } from '../sim/systems/tethers.js';
import { updateSun } from '../sim/systems/sun.js';
import { TerrainColliders } from '../sim/physics/terrainColliders.js';
import { spawnPlaceableEntity } from '../sim/placeActions.js';
import { createCableEntity, nearestFreeSnapPair, slotWorld } from '../sim/snapUtils.js';
import { spawnHabitatEntity, seatTetherOnGround } from '../sim/tetherActions.js';
import type { ColliderPool } from '../terrain/colliderPool.js';
import { createDensityField } from '../terrain/density.js';
import type { Entity, EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';

export interface WorldSetup {
  colliders: TerrainColliders;
  playerId: EntityId | null;
  /** LOD0 chunk keys flattened for the habitat pad (Game re-notifies the streamer). */
  editedKeys: string[];
}

export interface WorldSetupOptions {
  /** Dev shortcut (?dev=1): fill the fresh backpack with tether items. */
  devTethers?: boolean;
  /** Dev shortcut (?build=1): power-base packages for the M10 acceptance. */
  devBuild?: boolean;
}

/** Lateral offset from a world position (perpendicular to planet up). */
function lateralOffset(planet: PlanetConfig, pos: { x: number; y: number; z: number }, dist: number): { x: number; y: number; z: number } {
  const up = normalize(sub(pos, planet.center));
  const ref = Math.abs(up.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const east = normalize(cross(up, ref));
  return { x: pos.x + east.x * dist, y: pos.y + east.y * dist, z: pos.z + east.z * dist };
}

/** Offset perpendicular to the habitat axis, keeping the spawn point clear. */
function perpendicularOffset(
  planet: PlanetConfig,
  pos: { x: number; y: number; z: number },
  dist: number,
): { x: number; y: number; z: number } {
  const up = normalize(sub(pos, planet.center));
  const ref = Math.abs(up.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const east = normalize(cross(up, ref));
  const north = normalize(cross(east, up));
  return { x: pos.x + north.x * dist, y: pos.y + north.y * dist, z: pos.z + north.z * dist };
}

/**
 * Flatten a pad for the starting base and return the pad plane + touched
 * LOD0 keys. Direct edit-store writes are initialization (the same as the
 * player spawn); all later changes go through dispatch.
 */
function flattenPad(
  world: World,
  planet: PlanetConfig,
  anchor: { x: number; y: number; z: number },
): { ground: { x: number; y: number; z: number }; keys: string[] } {
  const up = normalize(sub(anchor, planet.center));
  // The player spawn hovers above the surface; put the pad slightly below it
  // so the spawn drops softly onto the plane (M08 shape, kept).
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
  return { ground, keys: outcome.keys };
}

/**
 * Starting base (M09/M10): a platform with the pre-placed small printer on
 * its center slot. It sits perpendicular to the habitat axis so the spawn
 * point stays clear and the habitat cable fits under 10 m. Setup
 * initialization creates the entities directly (like the dev tether pack);
 * gameplay placement uses the validated placePlaceable Action instead.
 */
function spawnStarterBase(
  world: World,
  planet: PlanetConfig,
  anchor: { x: number; y: number; z: number },
): EntityId | null {
  // Away from the default forward (+X on the flat test/spawn basis) so the
  // starter base never blocks an E/throw ray straight ahead.
  const platformAnchor = perpendicularOffset(planet, anchor, -3.5);
  const platformPos = seatTetherOnGround(world, planet.id, platformAnchor);
  const platformId = spawnPlaceableEntity(world, planet.id, 'platform', platformPos);
  const platform = platformId ? world.entities.get(platformId) : undefined;
  if (!platform) return null;
  const slot = slotWorld(platform, 0);
  if (!slot) return platformId;
  spawnPlaceableEntity(world, planet.id, 'small_printer', slot, {
    rotation: platform.rotation,
    attachTo: platform.id,
    attachSlot: 0,
  });
  return platformId;
}

/** Link the starting habitat to the starter platform when they are close. */
function linkStarterPower(
  world: World,
  planet: PlanetConfig,
  habitatId: EntityId | null,
  platformId: EntityId | null,
): void {
  if (!habitatId || !platformId) return;
  const habitat = world.entities.get(habitatId);
  const platform = world.entities.get(platformId);
  if (!habitat || !platform) return;
  const pair = nearestFreeSnapPair(world, habitat, platform, CABLE_MAX_LENGTH_M);
  if (!pair) return;
  createCableEntity(world, planet.id, pair.a, pair.b);
}

/**
 * Flatten a pad for the habitat and spawn it next to an anchor point.
 * Returns the touched LOD0 keys so Game can re-notify the streamer after the
 * boot prebuilt (which predates the pad) is adopted.
 */
function spawnHabitatNear(world: World, planet: PlanetConfig, anchor: { x: number; y: number; z: number }): string[] {
  const pad = flattenPad(world, planet, anchor);
  const habitatPos = lateralOffset(planet, pad.ground, HABITAT_SPAWN_OFFSET_M);
  // Seat the dome on the pad with the same precise surface march tethers use
  // (0.25 m steps + bisection), not a 1 m-quantized approximation.
  const seated = seatTetherOnGround(world, planet.id, habitatPos);
  const habitatId = spawnHabitatEntity(world, planet.id, seated);
  const platformId = spawnStarterBase(world, planet, pad.ground);
  // The habitat's permanent 1/s generation powers the starter printer (1/s)
  // even before the player builds a solar panel. The cable is a real entity,
  // so it can be cut (C tool) and demonstrates the power graph from tick one.
  linkStarterPower(world, planet, habitatId, platformId);
  return pad.keys;
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

/**
 * Fill empty backpack slots with the packages needed for the M10 acceptance
 * base (?build=1). Solar/battery are research-gated since M11; this dev-only
 * grant deliberately bypasses the tree so base/power testing stays possible.
 */
function grantDevBuild(world: World, player: Entity): void {
  const inventory = player.components.inventory;
  if (!inventory) return;
  const items = ['platform_package', 'platform_package', 'solar_panel_package', 'battery_package'];
  let cursor = 0;
  for (let i = 0; i < inventory.slots.length && cursor < items.length; i += 1) {
    if (inventory.slots[i] !== null) continue;
    const itemId = items[cursor] as string;
    cursor += 1;
    const id = world.nextId('item');
    world.entities.set(id, {
      id,
      kind: 'item',
      planetId: player.planetId,
      position: { ...player.position },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId, holder: player.id } },
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
  // Deterministic research sample pods (rarer, deeper-weighted).
  world.addSystem((tickWorld) => updateSamples(tickWorld, planets));
  // Grab-carry follow (cursor mode): levitating item tracks the aim.
  world.addSystem((tickWorld) => updateGrab(tickWorld, planets));
  // Tether graph (recomputed only on topology/nearby-edit changes).
  world.addSystem((tickWorld) => updateTethers(tickWorld, planets));
  // Oxygen breathing, canisters and death/respawn (reads the tether graph).
  world.addSystem((tickWorld, dt) => updateOxygen(tickWorld, planets, dt));
  // Power networks (M10): generation/storage, brownout pausing. Must run
  // before crafting so a job started this tick gets its power verdict.
  world.addSystem((tickWorld, dt) => updatePower(tickWorld, dt));
  // Station print jobs (M09): advances timers, exposes finished outputs.
  world.addSystem((tickWorld, dt) => updateCrafting(tickWorld, dt));
  // Research station analysis (M11): one sample -> Data, power-gated above.
  world.addSystem((tickWorld, dt) => updateResearch(tickWorld, dt));
  // Shuttle flight (M14), after research per ARCHITECTURE.md's system order.
  // The collider ring is the same probe the player stands on, and it follows
  // the attached pilot, so terrain colliders load around a low shuttle.
  world.addSystem(makeShuttleSystem({ planets, probe: colliders }));
  // Placed light sticks follow terrain edits (dig out from under them).
  world.addSystem((tickWorld) => updateLightsticks(tickWorld));
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
    // M14: a world that already owns a shuttle has traveled (or was built by
    // this milestone), so the pre-M08/pre-M09 free starter-base heals must
    // never hand out a habitat/printer on Vorn. Genuine old saves have no
    // shuttle and still heal.
    const hasShuttle = [...world.entities.values()].some((e) => e.kind === 'shuttle');
    if (player && planetId !== undefined && !hasShuttle && !hasHabitat) {
      const planet = planets.find((p) => p.id === planetId) ?? home;
      editedKeys = spawnHabitatNear(world, planet, player.position);
      world.tick(SIM_DT);
    } else if (player && planetId !== undefined && !hasShuttle && !hasPrinter) {
      // M08 saves predate the M09 starting printer: flatten a pad and seat
      // the starter base beside the player (or their habitat area). This
      // mirrors the fresh-game pad so the printer is usable on Continue.
      const planet = planets.find((p) => p.id === planetId) ?? home;
      const pad = flattenPad(world, planet, player.position);
      editedKeys = pad.keys;
      const platformId = spawnStarterBase(world, planet, pad.ground);
      const habitat = machines.find((e) => e.components.machine?.machineType === 'habitat');
      linkStarterPower(world, planet, habitat?.id ?? null, platformId);
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
      if (opts.devBuild) grantDevBuild(world, player);
    }
  }
  return { colliders, playerId, editedKeys };
}
