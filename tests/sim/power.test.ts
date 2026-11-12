// M10 power system: day/night generation, storage charge/discharge, stable
// brownout priority (printers > furnace > refinery), whole-machine pausing,
// and network splitting when a cable is removed.

import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/constants.js';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import type { EntityId } from '../../src/sim/entities.js';
import { spawnHabitatEntity } from '../../src/sim/tetherActions.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { createCableEntity } from '../../src/sim/snapUtils.js';
import { updateCrafting } from '../../src/sim/systems/crafting.js';
import { updatePower } from '../../src/sim/systems/power.js';
import { powerNetworksFor } from '../../src/sim/powerGraph.js';
import { World } from '../../src/sim/world.js';

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat power world',
    seed: 4242,
    surfaceAmplitude: 0,
    caves: { ...SELA.caves, thresholdTop: 0, thresholdBottom: 0, startDepth: 10000 },
    caverns: { ...SELA.caverns, enabled: false },
  };
}

interface Ctx {
  world: World;
  planet: PlanetConfig;
  platformId: EntityId;
  surface: { x: number; y: number; z: number };
}

function context(): Ctx {
  const planet = flatPlanet();
  const world = new World(7, { planets: [planet] });
  const surface = { x: 0, y: planet.radius, z: 0 };
  const platformId = spawnPlaceableEntity(world, planet.id, 'platform', surface) as EntityId;
  return { world, planet, platformId, surface };
}

function addMachine(
  ctx: Ctx,
  placeableId: string,
  slot: number,
  job: string | null = null,
): EntityId {
  const id = spawnPlaceableEntity(
    ctx.world,
    ctx.planet.id,
    placeableId,
    { x: ctx.surface.x, y: ctx.surface.y + 0.7, z: ctx.surface.z },
    { attachTo: ctx.platformId, attachSlot: slot },
  ) as EntityId;
  if (job) {
    const printer = ctx.world.entities.get(id)?.components.printer;
    if (!printer) throw new Error(`no printer on ${placeableId}`);
    printer.recipeId = job;
  }
  return id;
}

function addHabitat(ctx: Ctx): EntityId {
  const habitat = spawnHabitatEntity(ctx.world, ctx.planet.id, {
    x: ctx.surface.x + 1,
    y: ctx.surface.y,
    z: ctx.surface.z,
  }) as EntityId;
  createCableEntity(
    ctx.world,
    ctx.planet.id,
    { entityId: habitat, snapIndex: 0 },
    { entityId: ctx.platformId, snapIndex: 0 },
  );
  return habitat;
}

function runPower(ctx: Ctx, seconds: number): void {
  const ticks = Math.round(seconds / SIM_DT);
  for (let i = 0; i < ticks; i += 1) updatePower(ctx.world, SIM_DT);
}

function runBoth(ctx: Ctx, seconds: number): void {
  const ticks = Math.round(seconds / SIM_DT);
  for (let i = 0; i < ticks; i += 1) {
    updatePower(ctx.world, SIM_DT);
    updateCrafting(ctx.world, SIM_DT);
  }
}

function powerOf(ctx: Ctx, id: EntityId) {
  const power = ctx.world.entities.get(id)?.components.power;
  if (!power) throw new Error('missing power component');
  return power;
}

function setDay(ctx: Ctx, up = true): void {
  ctx.world.sunDirection = up ? { x: 0, y: 1, z: 0 } : { x: 0, y: -1, z: 0 };
}

describe('power generation and storage', () => {
  it('generates 1/s from a habitat and charges its internal 20', () => {
    const ctx = context();
    const habitat = addHabitat(ctx);
    setDay(ctx, false);
    runPower(ctx, 1);
    expect(powerOf(ctx, habitat).generation).toBeCloseTo(1, 6);
    expect(powerOf(ctx, habitat).capacity).toBe(20);
    expect(powerOf(ctx, habitat).stored).toBeCloseTo(1, 2);
  });

  it('solar peaks at 2/s at noon, follows the sun angle, and is 0 at night', () => {
    const ctx = context();
    const solar = addMachine(ctx, 'solar_panel', 1);
    ctx.world.sunDirection = { x: 0, y: 1, z: 0 };
    updatePower(ctx.world, SIM_DT);
    expect(powerOf(ctx, solar).generation).toBeCloseTo(2, 6);
    ctx.world.sunDirection = { x: 0.5, y: Math.sqrt(0.75), z: 0 };
    updatePower(ctx.world, SIM_DT);
    expect(powerOf(ctx, solar).generation).toBeCloseTo(2 * Math.sqrt(0.75), 6);
    ctx.world.sunDirection = { x: 0, y: -1, z: 0 };
    updatePower(ctx.world, SIM_DT);
    expect(powerOf(ctx, solar).generation).toBeCloseTo(0, 6);
  });

  it('charges a battery from surplus and clamps at 100', () => {
    const ctx = context();
    const solar = addMachine(ctx, 'solar_panel', 1);
    const battery = addMachine(ctx, 'battery', 2);
    powerOf(ctx, battery).stored = 99;
    ctx.world.sunDirection = { x: 0, y: 1, z: 0 };
    runPower(ctx, 1);
    expect(powerOf(ctx, battery).stored).toBeCloseTo(100, 6);
    runPower(ctx, 1);
    expect(powerOf(ctx, battery).stored).toBeCloseTo(100, 6);
    expect(powerOf(ctx, solar).generation).toBeCloseTo(2, 6);
  });

  it('drains the battery at night and pauses the printer when it is empty', () => {
    const ctx = context();
    const solar = addMachine(ctx, 'solar_panel', 1);
    const battery = addMachine(ctx, 'battery', 2);
    const printer = addMachine(ctx, 'small_printer', 3, 'platform');
    powerOf(ctx, battery).stored = 2;
    ctx.world.sunDirection = { x: 0, y: -1, z: 0 };
    runBoth(ctx, 1);
    expect(powerOf(ctx, battery).stored).toBeCloseTo(1, 2);
    expect(powerOf(ctx, printer).paused).toBe(false);
    expect(ctx.world.entities.get(printer)?.components.printer?.progressS).toBeGreaterThan(0);
    // Empty battery: the next tick cannot afford the 1/s job.
    powerOf(ctx, battery).stored = 0;
    updatePower(ctx.world, SIM_DT);
    expect(powerOf(ctx, printer).paused).toBe(true);
    const progress = ctx.world.entities.get(printer)?.components.printer?.progressS ?? 0;
    runBoth(ctx, 1);
    expect(ctx.world.entities.get(printer)?.components.printer?.progressS).toBeCloseTo(progress, 6);
    expect(powerOf(ctx, solar).generation).toBeCloseTo(0, 6);
  });

  it('tops the habitat first when charging and drains batteries first when discharging', () => {
    const ctx = context();
    const habitat = addHabitat(ctx);
    const battery = addMachine(ctx, 'battery', 2);
    setDay(ctx, false);
    runPower(ctx, 1);
    expect(powerOf(ctx, habitat).stored).toBeGreaterThan(0);
    expect(powerOf(ctx, battery).stored).toBeCloseTo(0, 6);
    // A 3/s load against the 1/s habitat drains the battery first.
    const refinery = addMachine(ctx, 'refinery', 3, 'fuel_cell_biomass');
    powerOf(ctx, battery).stored = 10;
    powerOf(ctx, habitat).stored = 10;
    runPower(ctx, 1);
    expect(powerOf(ctx, battery).stored).toBeCloseTo(8, 2);
    expect(powerOf(ctx, habitat).stored).toBeCloseTo(10, 2);
    expect(powerOf(ctx, refinery).paused).toBe(false);
  });
});

describe('research station power (M11)', () => {
  it('draws 1/s only while analyzing and pauses without power', () => {
    const ctx = context();
    const station = addMachine(ctx, 'research_station', 1);
    const research = ctx.world.entities.get(station)?.components.research;
    if (!research) throw new Error('no research component');
    setDay(ctx, false);
    updatePower(ctx.world, SIM_DT);
    expect(powerOf(ctx, station).demand).toBe(0);
    expect(powerOf(ctx, station).paused).toBe(false);
    research.inputId = 'sample_probe';
    updatePower(ctx.world, SIM_DT);
    expect(powerOf(ctx, station).demand).toBe(1);
    expect(powerOf(ctx, station).paused).toBe(true);
    addHabitat(ctx);
    updatePower(ctx.world, SIM_DT);
    expect(powerOf(ctx, station).paused).toBe(false);
    research.inputId = null;
    updatePower(ctx.world, SIM_DT);
    expect(powerOf(ctx, station).demand).toBe(0);
  });
});

describe('brownout priority', () => {
  it('keeps printers, then furnace, then refinery as generation shrinks', () => {
    const ctx = context();
    const habitat = addHabitat(ctx);
    const printer = addMachine(ctx, 'small_printer', 1, 'platform'); // 1/s
    const furnace = addMachine(ctx, 'furnace', 2, 'smelt_iron'); // 2/s
    const refinery = addMachine(ctx, 'refinery', 3, 'fuel_cell_biomass'); // 3/s
    setDay(ctx, false);
    // Habitat alone: 1/s keeps only the printer running.
    updatePower(ctx.world, SIM_DT);
    expect(powerOf(ctx, printer).paused).toBe(false);
    expect(powerOf(ctx, furnace).paused).toBe(true);
    expect(powerOf(ctx, refinery).paused).toBe(true);
    expect(powerOf(ctx, printer).demand).toBe(6);
    // Add solar at noon: 3/s total keeps printer + furnace, refinery still out.
    const solar = addMachine(ctx, 'solar_panel', 4);
    ctx.world.sunDirection = { x: 0, y: 1, z: 0 };
    updatePower(ctx.world, SIM_DT);
    expect(powerOf(ctx, solar).generation).toBeCloseTo(3, 6);
    expect(powerOf(ctx, printer).paused).toBe(false);
    expect(powerOf(ctx, furnace).paused).toBe(false);
    expect(powerOf(ctx, refinery).paused).toBe(true);
    // Losing the habitat cable leaves 2/s: the printer's priority claims 1/s
    // and the remaining 1/s cannot run the 2/s furnace. A whole-machine
    // policy never partially runs a machine.
    const cable = [...ctx.world.entities.values()].find((e) => e.kind === 'cable');
    if (!cable) throw new Error('missing habitat cable');
    ctx.world.entities.delete(cable.id);
    ctx.world.sunDirection = { x: 0, y: 1, z: 0 };
    updatePower(ctx.world, SIM_DT);
    expect(powerOf(ctx, printer).paused).toBe(false);
    expect(powerOf(ctx, furnace).paused).toBe(true);
    expect(powerOf(ctx, refinery).paused).toBe(true);
    // The habitat is now its own island network.
    expect(powerOf(ctx, habitat).networkId).not.toBe(null);
  });

  it('does not chatter a paused machine on a recharging buffer', () => {
    const ctx = context();
    addMachine(ctx, 'solar_panel', 1);
    const battery = addMachine(ctx, 'battery', 2);
    addMachine(ctx, 'small_printer', 3, 'platform');
    const furnace = addMachine(ctx, 'furnace', 4, 'smelt_iron');
    ctx.world.sunDirection = { x: 0, y: 1, z: 0 };
    runPower(ctx, 1);
    expect(powerOf(ctx, furnace).paused).toBe(true);
    // The battery is recharging (1/s surplus), but the 2/s furnace needs a
    // buffer after the printer's share before it may restart.
    expect(powerOf(ctx, battery).stored).toBeGreaterThan(0.5);
    let transitions = 0;
    let last = powerOf(ctx, furnace).paused;
    for (let i = 0; i < 90; i += 1) {
      updatePower(ctx.world, SIM_DT);
      updateCrafting(ctx.world, SIM_DT);
      const paused = powerOf(ctx, furnace).paused;
      if (paused !== last) transitions += 1;
      last = paused;
    }
    // A per-tick energy check would chatter (~30 transitions/s). The buffer
    // gives a slow duty cycle, not 30 Hz flicker.
    expect(transitions).toBeLessThanOrEqual(8);
    // It did run at least one tick; the point is that it did not toggle
    // on/off every tick while the buffer recharged. (M12: the smelt is 10 s,
    // so 3 s of chattering is no longer guaranteed to finish the job.)
    expect(ctx.world.entities.get(furnace)?.components.printer?.progressS).toBeGreaterThan(0);
  });

  it('breaks priority ties by stable entity id', () => {
    const ctx = context();
    const a = addMachine(ctx, 'small_printer', 1, 'platform');
    const b = addMachine(ctx, 'small_printer', 2, 'platform');
    // No generation: the lower id cannot help; add a 1/s habitat to run one.
    addHabitat(ctx);
    setDay(ctx, false);
    updatePower(ctx.world, SIM_DT);
    const first = a < b ? a : b;
    const second = first === a ? b : a;
    expect(powerOf(ctx, first).paused).toBe(false);
    expect(powerOf(ctx, second).paused).toBe(true);
  });
});

describe('network membership', () => {
  it('joins by cable and splits when the cable is removed', () => {
    const ctx = context();
    const printer = addMachine(ctx, 'small_printer', 1, 'platform');
    const secondPlatform = spawnPlaceableEntity(
      ctx.world,
      ctx.planet.id,
      'platform',
      { x: 4, y: ctx.surface.y, z: 0 },
    ) as EntityId;
    const solar = spawnPlaceableEntity(
      ctx.world,
      ctx.planet.id,
      'solar_panel',
      { x: 4, y: ctx.surface.y + 0.7, z: 0 },
      { attachTo: secondPlatform, attachSlot: 1 },
    ) as EntityId;
    expect(powerNetworksFor(ctx.world)).toHaveLength(2);
    const cableId = createCableEntity(
      ctx.world,
      ctx.planet.id,
      { entityId: ctx.platformId, snapIndex: 0 },
      { entityId: secondPlatform, snapIndex: 0 },
    ) as EntityId;
    expect(powerNetworksFor(ctx.world)).toHaveLength(1);
    ctx.world.sunDirection = { x: 0, y: 1, z: 0 };
    updatePower(ctx.world, SIM_DT);
    expect(powerOf(ctx, printer).generation).toBeCloseTo(2, 3);
    ctx.world.entities.delete(cableId);
    expect(powerNetworksFor(ctx.world)).toHaveLength(2);
    updatePower(ctx.world, SIM_DT);
    expect(powerOf(ctx, printer).generation).toBeCloseTo(0, 6);
    expect(powerOf(ctx, printer).paused).toBe(true);
    expect(powerOf(ctx, solar).generation).toBeCloseTo(2, 3);
  });
});
