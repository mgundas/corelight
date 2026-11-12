// M10 acceptance flow, headless: three snapped platforms + solar + battery
// run the small printer, the battery takes over at night, a cable cut splits
// the network and pauses the unpowered side, and the save round trip keeps
// the base, cable and charge.

import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/constants.js';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import type { Entity, EntityId } from '../../src/sim/entities.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { createCableEntity } from '../../src/sim/snapUtils.js';
import { spawnHabitatEntity } from '../../src/sim/tetherActions.js';
import { disconnectCable } from '../../src/sim/cableActions.js';
import { updatePower } from '../../src/sim/systems/power.js';
import { updateCrafting } from '../../src/sim/systems/crafting.js';
import { powerNetworksFor } from '../../src/sim/powerGraph.js';
import { World } from '../../src/sim/world.js';
import { deserializeWorld, serializeWorld } from '../../src/save/serialize.js';

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat acceptance world',
    seed: 4242,
    surfaceAmplitude: 0,
    caves: { ...SELA.caves, thresholdTop: 0, thresholdBottom: 0, startDepth: 10000 },
    caverns: { ...SELA.caverns, enabled: false },
  };
}

interface Base {
  world: World;
  planet: PlanetConfig;
  playerId: EntityId;
  platforms: EntityId[];
  printerId: EntityId;
  batteryId: EntityId;
  cableId: EntityId;
}

function machineAt(
  world: World,
  planet: PlanetConfig,
  placeableId: string,
  x: number,
  platformId: EntityId,
  slot: number,
  job: string | null = null,
): EntityId {
  const id = spawnPlaceableEntity(
    world,
    planet.id,
    placeableId,
    { x, y: planet.radius + 0.7, z: 0 },
    { attachTo: platformId, attachSlot: slot },
  ) as EntityId;
  if (job) {
    const printer = world.entities.get(id)?.components.printer;
    if (!printer) throw new Error(`no printer on ${placeableId}`);
    printer.recipeId = job;
  }
  return id;
}

function buildBase(): Base {
  const planet = flatPlanet();
  const world = new World(7, { planets: [planet] });
  world.dispatch({
    type: 'spawnPlayer',
    planetId: planet.id,
    position: { x: 0, y: planet.radius + 0.9, z: 0 },
  });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  const p0 = spawnPlaceableEntity(world, planet.id, 'platform', { x: 0, y: planet.radius, z: 0 }) as EntityId;
  const p1 = spawnPlaceableEntity(world, planet.id, 'platform', { x: 4, y: planet.radius, z: 0 }) as EntityId;
  const p2 = spawnPlaceableEntity(world, planet.id, 'platform', { x: 8, y: planet.radius, z: 0 }) as EntityId;
  const join = (child: EntityId, parent: EntityId, parentSnap: number, ownSnap: number): void => {
    const placeable = world.entities.get(child)?.components.placeable;
    if (!placeable) throw new Error('no placeable');
    placeable.snappedTo = parent;
    placeable.snappedToSnap = parentSnap;
    placeable.snappedOwnSnap = ownSnap;
  };
  join(p1, p0, 0, 2);
  join(p2, p1, 0, 2);
  const printerId = machineAt(world, planet, 'small_printer', 0, p0, 0, 'platform');
  machineAt(world, planet, 'solar_panel', 4, p1, 1);
  const batteryId = machineAt(world, planet, 'battery', 8, p2, 1);
  const habitatId = spawnHabitatEntity(world, planet.id, { x: 0, y: planet.radius, z: 4 }) as EntityId;
  const cableId = createCableEntity(
    world,
    planet.id,
    { entityId: habitatId, snapIndex: 0 },
    { entityId: p0, snapIndex: 0 },
  ) as EntityId;
  // The habitat starts with a full internal battery so daytime surplus goes
  // straight into the base battery (the acceptance "solar charges it" path).
  const habitatPower = world.entities.get(habitatId)?.components.power;
  if (habitatPower) habitatPower.stored = 20;
  return { world, planet, playerId, platforms: [p0, p1, p2], printerId, batteryId, cableId };
}

function run(world: World, seconds: number): void {
  const ticks = Math.round(seconds / SIM_DT);
  for (let i = 0; i < ticks; i += 1) {
    updatePower(world, SIM_DT);
    updateCrafting(world, SIM_DT);
  }
}

function powerOf(world: World, id: EntityId) {
  const power = world.entities.get(id)?.components.power;
  if (!power) throw new Error('no power component');
  return power;
}

describe('M10 acceptance flow', () => {
  it('runs the printer on solar, swaps to the battery at night, and pauses when empty', () => {
    const base = buildBase();
    const { world, planet } = base;
    world.sunDirection = { x: 0, y: 1, z: 0 };
    run(world, 2);
    // The platform network joined through snaps and the habitat cable.
    expect(powerNetworksFor(world)).toHaveLength(1);
    expect(powerOf(world, base.printerId).paused).toBe(false);
    expect(world.entities.get(base.printerId)?.components.printer?.outputReady).toBe('platform');
    expect(powerOf(world, base.batteryId).stored).toBeGreaterThan(1);
    // Saving keeps all three platforms, the cable and the charge.
    const revived = deserializeWorld(
      JSON.parse(JSON.stringify(serializeWorld(world))) as unknown,
      [planet],
    );
    expect([...revived.entities.values()].filter((e) => e.kind === 'platform')).toHaveLength(3);
    expect([...revived.entities.values()].filter((e) => e.kind === 'cable')).toHaveLength(1);
    expect(powerOf(revived, base.batteryId).stored).toBeCloseTo(
      powerOf(world, base.batteryId).stored,
      6,
    );
    expect(powerNetworksFor(revived)).toHaveLength(1);
    // Night on the reloaded world: cut the habitat cable, drain the battery.
    revived.sunDirection = { x: 0, y: -1, z: 0 };
    disconnectCable(revived, base.playerId, base.cableId);
    revived.tick();
    expect(powerNetworksFor(revived)).toHaveLength(2);
    const printer = revived.entities.get(base.printerId);
    if (!printer?.components.printer) throw new Error('no revived printer');
    printer.components.printer.recipeId = 'platform';
    printer.components.printer.progressS = 1.8;
    printer.components.printer.outputReady = null;
    powerOf(revived, base.batteryId).stored = 0.1;
    run(revived, 1);
    expect(powerOf(revived, base.batteryId).stored).toBeCloseTo(0, 6);
    expect(powerOf(revived, base.printerId).paused).toBe(true);
    const frozen = printer.components.printer.progressS;
    expect(frozen).toBeLessThan(2);
    run(revived, 1);
    expect(printer.components.printer.progressS).toBeCloseTo(frozen, 6);
    // The power graph split, not just the cable view: the habitat is alone.
    const networks = powerNetworksFor(revived);
    const printerNetwork = networks.find((n) => n.members.some((m) => m.id === base.printerId));
    const habitatNetwork = networks.find((n) => n.members.some((m) => m.components.machine?.machineType === 'habitat'));
    expect(printerNetwork?.members.some((m: Entity) => m.id === base.printerId)).toBe(true);
    expect(habitatNetwork?.members.some((m: Entity) => m.id === base.printerId)).toBe(false);
  });
});
