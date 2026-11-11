// M09 interaction priority + placement mode: E resolves station > item >
// tether > light stick > packaged placeable, and placement only confirms on
// a fresh click over a valid spot. No DOM here: UI is a callback.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { moveBasis } from '../../src/sim/physics/frames.js';
import { World } from '../../src/sim/world.js';
import type { EntityId } from '../../src/sim/entities.js';
import type { PlayerInput } from '../../src/player/input.js';
import type { ToolAim } from '../../src/player/terrainTool.js';
import { PlacementMode, carriedPlaceable } from '../../src/game/placement.js';
import { tickInteraction } from '../../src/game/interactWiring.js';

interface Ctx {
  world: World;
  playerId: EntityId;
  planet: PlanetConfig;
  forward: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  aim: ToolAim;
}

/** Flat synthetic sphere: aim points and placement spots are deterministic. */
function flatPlanet(): PlanetConfig {
  return {
    ...SELA,
    id: 'flat',
    name: 'Flat test world',
    seed: 4242,
    surfaceAmplitude: 0,
    caves: { ...SELA.caves, thresholdTop: 0, thresholdBottom: 0, startDepth: 10000 },
    caverns: { ...SELA.caverns, enabled: false },
  };
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
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  const up = { x: 0, y: 1, z: 0 };
  const { forward } = moveBasis(up, 0, 0);
  return {
    world,
    playerId,
    planet,
    forward,
    up,
    aim: { hit: { x: 0, y: planet.radius, z: 0 }, normal: up, planet },
  };
}

function fakeInput(opts: { interact?: boolean; printer?: boolean }): PlayerInput {
  return {
    consumeInteract: () => opts.interact === true,
    consumePrinter: () => opts.printer === true,
  } as unknown as PlayerInput;
}

function give(world: World, playerId: EntityId, itemId: string): EntityId {
  const player = world.entities.get(playerId);
  const inv = player?.components.inventory;
  if (!player || !inv) throw new Error('no inventory');
  const slot = inv.slots.indexOf(null);
  if (slot === -1) throw new Error('pack full');
  const id = world.nextId('item');
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId, holder: playerId } },
  });
  inv.slots[slot] = id;
  inv.selectedSlot = slot;
  return id;
}

function addStation(ctx: Ctx, machineType: string): EntityId {
  const player = ctx.world.entities.get(ctx.playerId);
  if (!player) throw new Error('no player');
  const id = ctx.world.nextId('machine');
  ctx.world.entities.set(id, {
    id,
    kind: 'machine',
    planetId: ctx.planet.id,
    position: {
      x: player.position.x + ctx.forward.x * 2 - ctx.up.x * 0.4,
      y: player.position.y + ctx.forward.y * 2 - ctx.up.y * 0.4,
      z: player.position.z + ctx.forward.z * 2 - ctx.up.z * 0.4,
    },
    rotation: { ...IDENTITY_QUAT },
    components: {
      machine: { machineType } as never,
      printer: { recipeId: null, progressS: 0, inputs: [], outputReady: null },
    },
  });
  return id;
}

function interact(ctx: Ctx, placement = new PlacementMode()): {
  opens: EntityId[];
  toggles: number;
  placement: PlacementMode;
} {
  const opens: EntityId[] = [];
  let toggles = 0;
  tickInteraction({
    world: ctx.world,
    playerId: ctx.playerId,
    input: fakeInput({ interact: true }),
    canAct: true,
    aim: ctx.aim,
    placement,
    openStation: (id) => opens.push(id),
    togglePrinter: () => {
      toggles += 1;
    },
  });
  return { opens, toggles, placement };
}

describe('interaction priority', () => {
  it('collects a ready station output before anything else', () => {
    const ctx = context();
    const stationId = addStation(ctx, 'small_printer');
    const printer = ctx.world.entities.get(stationId)?.components.printer;
    if (!printer) throw new Error('no printer');
    printer.outputReady = 'platform';
    interact(ctx);
    ctx.world.tick();
    expect(printer.outputReady).toBe(null);
    expect(ctx.world.entities.get(ctx.playerId)?.components.player?.carryingLarge).toBeTruthy();
  });

  it('deposits a matching held input, else opens the station UI', () => {
    const ctx = context();
    const stationId = addStation(ctx, 'small_printer');
    give(ctx.world, ctx.playerId, 'silicate');
    const first = interact(ctx);
    ctx.world.tick();
    expect(first.opens).toHaveLength(0);
    expect(ctx.world.entities.get(stationId)?.components.printer?.inputs).toHaveLength(1);
    // Resin is not a small-printer input: E opens the panel.
    give(ctx.world, ctx.playerId, 'resin');
    const second = interact(ctx);
    expect(second.opens).toEqual([stationId]);
  });

  it('picks up aimed items and pulls aimed tethers', () => {
    const ctx = context();
    const player = ctx.world.entities.get(ctx.playerId);
    if (!player) throw new Error('no player');
    const at = {
      x: player.position.x + ctx.forward.x * 2,
      y: player.position.y + ctx.forward.y * 2,
      z: player.position.z + ctx.forward.z * 2,
    };
    const itemId = ctx.world.nextId('item');
    ctx.world.entities.set(itemId, {
      id: itemId,
      kind: 'item',
      planetId: ctx.planet.id,
      position: at,
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: 'resin' } },
    });
    interact(ctx);
    ctx.world.tick();
    expect(ctx.world.entities.get(itemId)?.components.item?.holder).toBe(ctx.playerId);
    // Tether next.
    const tetherId = ctx.world.nextId('tether');
    ctx.world.entities.set(tetherId, {
      id: tetherId,
      kind: 'tether',
      planetId: ctx.planet.id,
      position: at,
      rotation: { ...IDENTITY_QUAT },
      components: { tether: { live: false, links: [] } },
    });
    interact(ctx);
    ctx.world.tick();
    expect(ctx.world.entities.has(tetherId)).toBe(false);
  });

  it('places a light stick on the ground when one is carried', () => {
    const ctx = context();
    give(ctx.world, ctx.playerId, 'light_stick');
    interact(ctx);
    ctx.world.tick();
    expect([...ctx.world.entities.values()].filter((e) => e.kind === 'lightstick')).toHaveLength(1);
  });

  it('enters placement with a packaged placeable, and E cancels it', () => {
    const ctx = context();
    give(ctx.world, ctx.playerId, 'platform_package');
    const placement = new PlacementMode();
    const first = interact(ctx, placement);
    expect(first.placement.isActive()).toBe(true);
    expect(carriedPlaceable(ctx.world, ctx.playerId)?.placeable.id).toBe('platform');
    interact(ctx, placement);
    expect(placement.isActive()).toBe(false);
  });

  it('drains Tab and toggles the printer even when the player cannot act', () => {
    const ctx = context();
    let toggles = 0;
    tickInteraction({
      world: ctx.world,
      playerId: ctx.playerId,
      input: fakeInput({ printer: true }),
      canAct: false,
      aim: { hit: null, normal: null, planet: null },
      placement: new PlacementMode(),
      openStation: () => undefined,
      togglePrinter: () => {
        toggles += 1;
      },
    });
    expect(toggles).toBe(1);
  });
});

describe('placement mode confirmation', () => {
  it('places on a fresh click over a valid spot and exits', () => {
    const ctx = context();
    give(ctx.world, ctx.playerId, 'platform_package');
    const placement = new PlacementMode();
    placement.enter('platform');
    const request = placement.tick(ctx.world, ctx.playerId, ctx.aim, true, false);
    expect(request?.placeableId).toBe('platform');
    expect(placement.isActive()).toBe(false);
    if (request) {
      ctx.world.dispatch({
        type: 'placePlaceable',
        playerId: ctx.playerId,
        placeableId: request.placeableId,
        position: request.position,
      });
      ctx.world.tick();
    }
    expect([...ctx.world.entities.values()].filter((e) => e.kind === 'platform')).toHaveLength(1);
  });

  it('ignores a held button from before placement was entered', () => {
    const ctx = context();
    give(ctx.world, ctx.playerId, 'platform_package');
    const placement = new PlacementMode();
    // A tick with the button already held (inactive) records lastDig = true.
    placement.tick(ctx.world, ctx.playerId, ctx.aim, true, false);
    placement.enter('platform');
    expect(placement.tick(ctx.world, ctx.playerId, ctx.aim, true, false)).toBe(null);
    expect(placement.isActive()).toBe(true);
    // Release and click again: this one places.
    placement.tick(ctx.world, ctx.playerId, ctx.aim, false, false);
    expect(placement.tick(ctx.world, ctx.playerId, ctx.aim, true, false)).not.toBe(null);
  });

  it('right-click cancels without placing', () => {
    const ctx = context();
    give(ctx.world, ctx.playerId, 'platform_package');
    const placement = new PlacementMode();
    placement.enter('platform');
    expect(placement.tick(ctx.world, ctx.playerId, ctx.aim, false, true)).toBe(null);
    expect(placement.isActive()).toBe(false);
    expect([...ctx.world.entities.values()].filter((e) => e.kind === 'platform')).toHaveLength(0);
  });

  it('auto-cancels when the package is no longer carried', () => {
    const ctx = context();
    const packageId = give(ctx.world, ctx.playerId, 'platform_package');
    const placement = new PlacementMode();
    placement.enter('platform');
    ctx.world.entities.delete(packageId);
    placement.tick(ctx.world, ctx.playerId, ctx.aim, false, false);
    expect(placement.isActive()).toBe(false);
  });
});
