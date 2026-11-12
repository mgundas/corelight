// M10 prompt/action parity: an empty station advertises the hold-E gesture,
// a working station keeps its tap-E prompt, a matching input keeps load, and
// the cable tool owns the prompt while active.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import type { EntityId } from '../../src/sim/entities.js';
import { World } from '../../src/sim/world.js';
import { PlacementMode } from '../../src/game/placement.js';
import { CableMode } from '../../src/game/cableMode.js';
import { interactPrompt } from '../../src/game/prompts.js';
import type { ToolAim } from '../../src/player/terrainTool.js';

function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat prompt world',
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
}

function context(): Ctx {
  const planet = flatPlanet();
  const world = new World(7, { planets: [planet] });
  world.dispatch({
    type: 'spawnPlayer',
    planetId: planet.id,
    position: { x: 0, y: planet.radius + 0.9, z: 0 },
  });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  const player = world.entities.get(playerId);
  if (!playerId || !player) throw new Error('no player');
  const stationId = world.nextId('machine');
  world.entities.set(stationId, {
    id: stationId,
    kind: 'machine',
    planetId: planet.id,
    position: { x: player.position.x + 2, y: player.position.y - 0.4, z: player.position.z },
    rotation: { ...IDENTITY_QUAT },
    components: {
      machine: { machineType: 'small_printer' },
      placeable: { placeableId: 'small_printer' },
      printer: { recipeId: null, progressS: 0, inputs: [], outputReady: null },
      power: { stored: 0, capacity: 0, paused: false, networkId: null },
    },
  });
  return {
    world,
    playerId,
    stationId,
    aim: { hit: { x: 0, y: planet.radius, z: 0 }, normal: { x: 0, y: 1, z: 0 }, planet },
  };
}

describe('M10 prompt parity', () => {
  it('shows hold-E for an empty station and tap-E/load for a busy one', () => {
    const ctx = context();
    expect(interactPrompt(ctx.world, ctx.playerId, ctx.aim, new PlacementMode())).toBe(
      'Hold E: pack up Small printer (tap E: open)',
    );
    const printer = ctx.world.entities.get(ctx.stationId)?.components.printer;
    if (!printer) throw new Error('no printer');
    printer.recipeId = 'platform';
    expect(interactPrompt(ctx.world, ctx.playerId, ctx.aim, new PlacementMode())).toBe(
      'E: open Small printer',
    );
    printer.recipeId = null;
    // A matching held input keeps the familiar deposit prompt.
    const player = ctx.world.entities.get(ctx.playerId);
    const inv = player?.components.inventory;
    if (!inv) throw new Error('no inventory');
    const itemId = ctx.world.nextId('item');
    ctx.world.entities.set(itemId, {
      id: itemId,
      kind: 'item',
      planetId: player?.planetId ?? null,
      position: { ...ctx.aim.hit! },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'silicate', holder: ctx.playerId } },
    });
    inv.slots[0] = itemId;
    inv.selectedSlot = 0;
    expect(interactPrompt(ctx.world, ctx.playerId, ctx.aim, new PlacementMode())).toBe(
      'E: load Silicate',
    );
  });

  it('lets the cable tool own the prompt while active', () => {
    const ctx = context();
    const cable = new CableMode();
    cable.activate();
    expect(interactPrompt(ctx.world, ctx.playerId, ctx.aim, new PlacementMode(), cable)).toBe(
      'Cable: click a snap point (E: exit)',
    );
  });
});
