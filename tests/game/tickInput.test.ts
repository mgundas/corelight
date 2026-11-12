// M09 tick dispatch: placement confirms consume the click (no dig), UI-open
// gates world interaction, Tab drains even in fly mode, and the headlamp
// stays usable from the fly camera.

import { describe, expect, it } from 'vitest';
import { SELA } from '../../src/planets/configs/sela.js';
import type { PlanetConfig } from '../../src/planets/PlanetConfig.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { World } from '../../src/sim/world.js';
import type { EntityId } from '../../src/sim/entities.js';
import type { PlayerInput } from '../../src/player/input.js';
import { TerrainTool } from '../../src/player/terrainTool.js';
import { PlacementMode } from '../../src/game/placement.js';
import { CableMode } from '../../src/game/cableMode.js';
import { dispatchTickInput } from '../../src/game/tickInput.js';

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

function setup(): { world: World; playerId: EntityId; planet: PlanetConfig; aim: { x: number; y: number; z: number } } {
  const planet = flatPlanet();
  const world = new World(7, { planets: [planet] });
  world.dispatch({
    type: 'spawnPlayer',
    planetId: planet.id,
    position: { x: 0, y: planet.radius + 0.9, z: 2 },
  });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  if (!playerId) throw new Error('no player');
  return { world, playerId, planet, aim: { x: 0, y: planet.radius, z: 0 } };
}

function give(world: World, playerId: EntityId, itemId: string): void {
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
}

function input(opts: {
  interact?: boolean;
  printer?: boolean;
  headlamp?: boolean;
  cable?: boolean;
  interactHeld?: boolean;
}): PlayerInput {
  return {
    consumeHeadlampToggle: () => opts.headlamp === true,
    consumeSelect: () => null,
    consumeDrop: () => false,
    consumeTether: () => false,
    consumeInteract: () => opts.interact === true,
    consumePrinter: () => opts.printer === true,
    consumeCableToggle: () => opts.cable === true,
    isInteractHeld: () => opts.interactHeld === true,
    move: () => ({ x: 0, z: 0 }),
    consumeJump: () => false,
    sprint: () => false,
  } as unknown as PlayerInput;
}

function run(
  ctx: ReturnType<typeof setup>,
  opts: {
    input: PlayerInput;
    placement?: PlacementMode;
    cable?: CableMode;
    flying?: boolean;
    uiOpen?: boolean;
    toolActive?: boolean;
    toggles?: { count: number };
  },
): void {
  dispatchTickInput({
    world: ctx.world,
    playerId: ctx.playerId,
    input: opts.input,
    rig: { yaw: 0, pitch: 0 },
    tool: new TerrainTool(),
    toolAim: { hit: ctx.aim, normal: { x: 0, y: 1, z: 0 }, planet: ctx.planet },
    toolButtons: { dig: opts.toolActive === true, add: false, flatten: false },
    toolActive: opts.toolActive === true,
    nowMs: 1000,
    flying: opts.flying === true,
    uiOpen: opts.uiOpen === true,
    placement: opts.placement ?? new PlacementMode(),
    cable: opts.cable,
    openStation: () => undefined,
    togglePrinter: () => {
      if (opts.toggles) opts.toggles.count += 1;
    },
  });
  ctx.world.tick();
}

describe('tick input dispatch', () => {
  it('placing consumes the dig click instead of editing terrain', () => {
    const ctx = setup();
    give(ctx.world, ctx.playerId, 'platform_package');
    const placement = new PlacementMode();
    placement.enter('platform');
    run(ctx, { input: input({}), placement, toolActive: true });
    expect([...ctx.world.entities.values()].filter((e) => e.kind === 'platform')).toHaveLength(1);
    expect(ctx.world.terrainEdits.sampleCount).toBe(0);
  });

  it('digs normally when no package is being placed', () => {
    const ctx = setup();
    run(ctx, { input: input({}), toolActive: true });
    expect(ctx.world.terrainEdits.sampleCount).toBeGreaterThan(0);
  });

  it('uiOpen gates E world actions but not Tab', () => {
    const ctx = setup();
    give(ctx.world, ctx.playerId, 'light_stick');
    const toggles = { count: 0 };
    run(ctx, { input: input({ interact: true, printer: true }), uiOpen: true, toggles });
    expect([...ctx.world.entities.values()].filter((e) => e.kind === 'lightstick')).toHaveLength(0);
    expect(toggles.count).toBe(1);
  });

  it('headlamp toggles from the fly camera', () => {
    const ctx = setup();
    run(ctx, { input: input({ headlamp: true }), flying: true });
    expect(ctx.world.entities.get(ctx.playerId)?.components.player?.headlampOn).toBe(false);
  });

  it('C toggles the cable tool and consumes the dig click', () => {
    const ctx = setup();
    const cable = new CableMode();
    run(ctx, { input: input({ cable: true }), cable, toolActive: true });
    expect(cable.isActive()).toBe(true);
    expect(ctx.world.terrainEdits.sampleCount).toBe(0);
    run(ctx, { input: input({ cable: true }), cable });
    expect(cable.isActive()).toBe(false);
  });

  it('E exits the cable tool without editing terrain', () => {
    const ctx = setup();
    const cable = new CableMode();
    cable.activate();
    run(ctx, { input: input({ interact: true }), cable, toolActive: true });
    expect(cable.isActive()).toBe(false);
    expect(ctx.world.terrainEdits.sampleCount).toBe(0);
  });
});
