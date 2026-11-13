// M11 E-chain + prompt parity for research stations: collect Data > load a
// sample > open the tree, and empty stations still support hold-E packing.

import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT, normalize, sub } from '../../src/core/math.js';
import { STATION_RANGE_M } from '../../src/core/constants.js';
import { findAimedStation } from '../../src/game/pickup.js';
import { primaryPackTarget } from '../../src/game/packTarget.js';
import { powerStatusFor } from '../../src/game/powerStatus.js';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { moveBasis } from '../../src/sim/physics/frames.js';
import type { EntityId } from '../../src/sim/entities.js';
import type { PlayerInput } from '../../src/player/input.js';
import type { ToolAim } from '../../src/player/terrainTool.js';
import { World } from '../../src/sim/world.js';
import { tickInteraction } from '../../src/game/interactWiring.js';
import { interactPrompt } from '../../src/game/prompts.js';
import { PlacementMode } from '../../src/game/placement.js';

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat research world',
    seed: 4242,
    surfaceAmplitude: 0,
    caves: { ...SELA.caves, thresholdTop: 0, thresholdBottom: 0, startDepth: 10000 },
    caverns: { ...SELA.caverns, enabled: false },
  };
}

interface Ctx {
  world: World;
  playerId: EntityId;
  stationId: EntityId;
  aim: ToolAim;
  focus: { x: number; y: number; z: number };
}

function context(): Ctx {
  const planet = flatPlanet();
  const world = new World(1337, { planets: [planet] });
  world.dispatch({
    type: 'spawnPlayer',
    planetId: planet.id,
    position: { x: 0, y: planet.radius + 0.9, z: 2 },
  });
  world.tick();
  const player = [...world.entities.values()].find((e) => e.kind === 'player');
  if (!player) throw new Error('no player');
  const up = { x: 0, y: 1, z: 0 };
  const { forward } = moveBasis(up, 0, 0);
  const focus = {
    x: player.position.x + forward.x * 2 - up.x * 0.4,
    y: player.position.y + forward.y * 2 - up.y * 0.4,
    z: player.position.z + forward.z * 2 - up.z * 0.4,
  };
  const stationId = world.nextId('machine');
  world.entities.set(stationId, {
    id: stationId,
    kind: 'machine',
    planetId: planet.id,
    position: { x: focus.x, y: focus.y, z: focus.z },
    rotation: { ...IDENTITY_QUAT },
    components: {
      machine: { machineType: 'research_station' },
      placeable: { placeableId: 'research_station' },
      research: { inputId: null, progressS: 0, dataReady: 0 },
      power: { stored: 0, capacity: 0, paused: false, networkId: null },
    },
  });
  return {
    world,
    playerId: player.id,
    stationId,
    aim: { hit: focus, normal: up, planet },
    focus,
  };
}

function fakeInput(): PlayerInput {
  return { consumeInteract: () => false, consumePrinter: () => false } as unknown as PlayerInput;
}

function giveSample(ctx: Ctx): EntityId {
  const player = ctx.world.entities.get(ctx.playerId);
  const inv = player?.components.inventory;
  if (!player || !inv) throw new Error('no inventory');
  const id = ctx.world.nextId('sample');
  ctx.world.entities.set(id, {
    id,
    kind: 'sample',
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: {
      sample: { value: 10, chunkKey: 'k' },
      item: { itemId: 'research_sample', holder: ctx.playerId },
    },
  });
  const slot = inv.slots.indexOf(null);
  if (slot === -1) throw new Error('pack full');
  inv.slots[slot] = id;
  inv.selectedSlot = slot;
  return id;
}

function pressE(ctx: Ctx): { opens: EntityId[]; researchOpens: EntityId[] } {
  const opens: EntityId[] = [];
  const researchOpens: EntityId[] = [];
  tickInteraction({
    world: ctx.world,
    playerId: ctx.playerId,
    input: fakeInput(),
    interact: true,
    canAct: true,
    aim: ctx.aim,
    placement: new PlacementMode(),
    openStation: (id) => opens.push(id),
    openResearch: (id) => researchOpens.push(id),
    togglePrinter: () => undefined,
  });
  return { opens, researchOpens };
}

describe('research station interaction', () => {
  for (const spacing of [0.2, 2, 4]) {
    it(`opens the cursor-targeted body at ${spacing} m regardless of facing or orbit`, () => {
      const ctx = context();
      const player = ctx.world.entities.get(ctx.playerId);
      const station = ctx.world.entities.get(ctx.stationId);
      if (!player?.components.player || !station) throw new Error('missing entities');
      player.components.player.yaw = Math.PI;
      player.components.player.pitch = 1.4;
      station.position = { x: player.position.x + spacing, y: player.position.y - 0.4, z: player.position.z };
      for (const offset of [{ x: 0, y: 2, z: -8 }, { x: 8, y: 3, z: 0 }, { x: -4, y: 6, z: 4 }, { x: 0, y: 8, z: 0 }]) {
        // Upper side of the model, far from the old base-only pick point.
        const target = { x: station.position.x + 1.1, y: station.position.y + 1.5, z: station.position.z };
        const origin = { x: target.x + offset.x, y: target.y + offset.y, z: target.z + offset.z };
        ctx.aim = { hit: null, normal: null, planet: null, ray: { origin, dir: normalize(sub(target, origin)) } };
        expect(findAimedStation(ctx.world, ctx.playerId, ctx.aim)).toBe(ctx.stationId);
        expect(primaryPackTarget(ctx.world, ctx.playerId, ctx.aim)).toBe(ctx.stationId);
        expect(powerStatusFor(ctx.world, ctx.playerId, ctx.aim)?.entityId).toBe(ctx.stationId);
        // A click-to-move hover must not hide how to open the station.
        expect(interactPrompt(ctx.world, ctx.playerId, ctx.aim, new PlacementMode(), undefined, null, ctx.stationId)).toContain('tap E: open');
        expect(pressE(ctx).researchOpens).toEqual([ctx.stationId]);
      }
    });
  }

  it('does not open a station when the cursor misses or it is out of reach', () => {
    const ctx = context();
    const station = ctx.world.entities.get(ctx.stationId);
    const player = ctx.world.entities.get(ctx.playerId);
    if (!station || !player) throw new Error('missing entities');
    ctx.aim.ray = { origin: { x: station.position.x, y: station.position.y + 5, z: station.position.z }, dir: { x: 0, y: 1, z: 0 } };
    expect(findAimedStation(ctx.world, ctx.playerId, ctx.aim)).toBeNull();
    expect(pressE(ctx).researchOpens).toEqual([]);
    station.position.x = player.position.x + STATION_RANGE_M + 1;
    const target = { ...station.position, y: station.position.y + 0.8 };
    const origin = { ...target, z: target.z - 8 };
    ctx.aim.ray = { origin, dir: normalize(sub(target, origin)) };
    expect(findAimedStation(ctx.world, ctx.playerId, ctx.aim)).toBeNull();
    expect(pressE(ctx).researchOpens).toEqual([]);
  });

  it('preserves loading and collection priority with cursor targeting', () => {
    const ctx = context();
    const origin = { x: ctx.focus.x, y: ctx.focus.y + 4, z: ctx.focus.z - 8 };
    const target = { ...ctx.focus, y: ctx.focus.y + 1 };
    ctx.aim.ray = { origin, dir: normalize(sub(target, origin)) };
    giveSample(ctx);
    expect(interactPrompt(ctx.world, ctx.playerId, ctx.aim, new PlacementMode())).toBe('E: load Research sample');
    expect(pressE(ctx).researchOpens).toEqual([]);
    ctx.world.tick();
    const research = ctx.world.entities.get(ctx.stationId)?.components.research;
    if (!research) throw new Error('missing research');
    expect(research.inputId).not.toBeNull();
    research.inputId = null;
    research.dataReady = 10;
    expect(interactPrompt(ctx.world, ctx.playerId, ctx.aim, new PlacementMode())).toBe('E: collect 10 Data');
    pressE(ctx);
    ctx.world.tick();
    expect(ctx.world.research.data).toBe(10);
  });

  it('also opens printers, furnaces and refineries under the cursor', () => {
    for (const machineType of ['small_printer', 'medium_printer', 'furnace', 'refinery'] as const) {
      const ctx = context();
      const station = ctx.world.entities.get(ctx.stationId);
      if (!station?.components.machine || !station.components.placeable) throw new Error('missing station');
      station.components.machine.machineType = machineType;
      station.components.placeable.placeableId = machineType;
      delete station.components.research;
      station.components.printer = { recipeId: null, progressS: 0, inputs: [], outputReady: null };
      const target = { ...station.position, y: station.position.y + 0.8 };
      const origin = { ...target, x: target.x + 8, y: target.y + 3 };
      ctx.aim.ray = { origin, dir: normalize(sub(target, origin)) };
      expect(pressE(ctx).opens).toEqual([ctx.stationId]);
    }
  });

  it('opens the tree when empty, loads a sample, collects ready Data', () => {
    const ctx = context();
    const empty = pressE(ctx);
    expect(empty.opens).toEqual([]);
    expect(empty.researchOpens).toEqual([ctx.stationId]);
    // Carrying a sample: E loads it instead of opening the panel.
    giveSample(ctx);
    const loaded = pressE(ctx);
    ctx.world.tick();
    expect(loaded.researchOpens).toEqual([]);
    const research = ctx.world.entities.get(ctx.stationId)?.components.research;
    expect(research?.inputId).toBeTruthy();
    // Ready Data: E collects before anything else.
    if (!research) throw new Error('no research');
    research.inputId = null;
    research.progressS = 0;
    research.dataReady = 10;
    const collected = pressE(ctx);
    ctx.world.tick();
    expect(collected.researchOpens).toEqual([]);
    expect(ctx.world.research.data).toBe(10);
    expect(research.dataReady).toBe(0);
  });

  it('prompts mirror the action priority', () => {
    const ctx = context();
    // Empty and packable: the hold-E hint stays first (tap E opens).
    expect(interactPrompt(ctx.world, ctx.playerId, ctx.aim, new PlacementMode())).toBe(
      'Hold E: pack up Research station (tap E: open)',
    );
    giveSample(ctx);
    expect(interactPrompt(ctx.world, ctx.playerId, ctx.aim, new PlacementMode())).toBe(
      'E: load Research sample',
    );
    const research = ctx.world.entities.get(ctx.stationId)?.components.research;
    if (!research) throw new Error('no research');
    research.inputId = 'sample_probe';
    research.progressS = 10;
    expect(interactPrompt(ctx.world, ctx.playerId, ctx.aim, new PlacementMode())).toBe(
      'E: open Research station (50%)',
    );
    research.inputId = null;
    research.progressS = 0;
    research.dataReady = 20;
    expect(interactPrompt(ctx.world, ctx.playerId, ctx.aim, new PlacementMode())).toBe(
      'E: collect 20 Data',
    );
  });

  it('a loaded research station is not a hold-E pack target', () => {
    const ctx = context();
    const research = ctx.world.entities.get(ctx.stationId)?.components.research;
    if (!research) throw new Error('no research');
    research.inputId = 'sample_probe';
    expect(interactPrompt(ctx.world, ctx.playerId, ctx.aim, new PlacementMode())).toBe(
      'E: open Research station (0%)',
    );
  });
});
