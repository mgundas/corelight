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
import { placeableDef } from '../../src/data/loadPlaceables.js';
import { PlacementMode, carriedPlaceable } from '../../src/game/placement.js';
import { tickInteraction } from '../../src/game/interactWiring.js';
import { PackHold } from '../../src/game/packHold.js';

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
    input: fakeInput({}),
    interact: true,
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

  it('places a light stick on the ground when one is selected', () => {
    const ctx = context();
    give(ctx.world, ctx.playerId, 'light_stick');
    interact(ctx);
    ctx.world.tick();
    expect([...ctx.world.entities.values()].filter((e) => e.kind === 'lightstick')).toHaveLength(1);
  });

  it('ignores a light stick that is not in the selected slot', () => {
    const ctx = context();
    const stickId = give(ctx.world, ctx.playerId, 'light_stick');
    const player = ctx.world.entities.get(ctx.playerId);
    const inv = player?.components.inventory;
    if (!inv) throw new Error('no inventory');
    // Move the stick out of the selected slot; E must not fall back to it.
    inv.slots[0] = null;
    inv.slots[3] = stickId;
    inv.selectedSlot = 2;
    interact(ctx);
    ctx.world.tick();
    expect([...ctx.world.entities.values()].filter((e) => e.kind === 'lightstick')).toHaveLength(0);
    expect(ctx.world.entities.has(stickId)).toBe(true);
    // Select it explicitly: now E places it.
    ctx.world.dispatch({ type: 'selectSlot', playerId: ctx.playerId, slot: 3 });
    ctx.world.tick();
    interact(ctx);
    ctx.world.tick();
    expect([...ctx.world.entities.values()].filter((e) => e.kind === 'lightstick')).toHaveLength(1);
  });

  it('prefers a front-carried placeable over a light stick', () => {
    const ctx = context();
    // The light stick is selected; a large package is picked up in front.
    give(ctx.world, ctx.playerId, 'light_stick');
    const player = ctx.world.entities.get(ctx.playerId);
    if (!player) throw new Error('no player');
    const packageItem = placeableDef('platform').packageItem;
    const looseId = ctx.world.nextId('item');
    ctx.world.entities.set(looseId, {
      id: looseId,
      kind: 'item',
      planetId: player.planetId,
      position: { ...player.position },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: packageItem } },
    });
    ctx.world.dispatch({ type: 'pickUp', playerId: ctx.playerId, itemId: looseId });
    ctx.world.tick();
    expect(ctx.world.entities.get(ctx.playerId)?.components.player?.carryingLarge).toBe(looseId);
    const placement = new PlacementMode();
    interact(ctx, placement);
    expect(placement.isActive()).toBe(true);
    expect([...ctx.world.entities.values()].filter((e) => e.kind === 'lightstick')).toHaveLength(0);
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
      interact: false,
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

describe('M10 hold-to-pack interaction', () => {
  function packableStation(ctx: Ctx): EntityId {
    const id = addStation(ctx, 'small_printer');
    const station = ctx.world.entities.get(id);
    if (!station) throw new Error('no station');
    station.components.placeable = { placeableId: 'small_printer' };
    return id;
  }

  function tickHold(
    ctx: Ctx,
    packHold: PackHold,
    interact: boolean,
    held: boolean,
    nowMs: number,
    opens: EntityId[],
  ): void {
    tickInteraction({
      world: ctx.world,
      playerId: ctx.playerId,
      input: fakeInput({}),
      interact,
      interactHeld: held,
      nowMs,
      packHold,
      canAct: true,
      aim: ctx.aim,
      placement: new PlacementMode(),
      openStation: (id) => opens.push(id),
      togglePrinter: () => undefined,
    });
  }

  it('packs an empty printer after 1 s and does not open its panel', () => {
    const ctx = context();
    const stationId = packableStation(ctx);
    const packHold = new PackHold();
    const opens: EntityId[] = [];
    tickHold(ctx, packHold, true, true, 0, opens);
    expect(opens).toHaveLength(0);
    expect(ctx.world.entities.has(stationId)).toBe(true);
    tickHold(ctx, packHold, false, true, 500, opens);
    expect(ctx.world.entities.has(stationId)).toBe(true);
    tickHold(ctx, packHold, false, true, 1000, opens);
    ctx.world.tick();
    expect(ctx.world.entities.has(stationId)).toBe(false);
    const inv = ctx.world.entities.get(ctx.playerId)?.components.inventory;
    const items = (inv?.slots ?? []).map((id) =>
      id ? ctx.world.entities.get(id)?.components.item?.itemId : null,
    );
    expect(items).toContain('small_printer_package');
  });

  it('a tap still opens the empty station panel', () => {
    const ctx = context();
    const stationId = packableStation(ctx);
    const packHold = new PackHold();
    const opens: EntityId[] = [];
    tickHold(ctx, packHold, true, false, 0, opens);
    expect(opens).toEqual([stationId]);
    expect(ctx.world.entities.has(stationId)).toBe(true);
  });
});

describe('placement mode confirmation', () => {
  it('places on a fresh click over a valid spot and exits', () => {
    const ctx = context();
    give(ctx.world, ctx.playerId, 'platform_package');
    const placement = new PlacementMode();
    placement.enter('platform');
    const request = placement.tick(ctx.world, ctx.playerId, ctx.aim, true);
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
    placement.tick(ctx.world, ctx.playerId, ctx.aim, true);
    placement.enter('platform');
    expect(placement.tick(ctx.world, ctx.playerId, ctx.aim, true)).toBe(null);
    expect(placement.isActive()).toBe(true);
    // Release and click again: this one places.
    placement.tick(ctx.world, ctx.playerId, ctx.aim, false);
    expect(placement.tick(ctx.world, ctx.playerId, ctx.aim, true)).not.toBe(null);
  });

  it('does not cancel on a non-primary tick (RMB is unbound)', () => {
    const ctx = context();
    give(ctx.world, ctx.playerId, 'platform_package');
    const placement = new PlacementMode();
    placement.enter('platform');
    expect(placement.tick(ctx.world, ctx.playerId, ctx.aim, false)).toBe(null);
    expect(placement.isActive()).toBe(true);
    expect([...ctx.world.entities.values()].filter((e) => e.kind === 'platform')).toHaveLength(0);
  });

  it('auto-cancels when the package is no longer carried', () => {
    const ctx = context();
    const packageId = give(ctx.world, ctx.playerId, 'platform_package');
    const placement = new PlacementMode();
    placement.enter('platform');
    ctx.world.entities.delete(packageId);
    placement.tick(ctx.world, ctx.playerId, ctx.aim, false);
    expect(placement.isActive()).toBe(false);
  });
});
