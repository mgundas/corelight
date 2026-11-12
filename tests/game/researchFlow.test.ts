// M11 E-chain + prompt parity for research stations: collect Data > load a
// sample > open the tree, and empty stations still support hold-E packing.

import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT } from '../../src/core/math.js';
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
