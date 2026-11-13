// M14 game wiring: the piloting input branch, shuttle E priority/prompt
// parity, and the flight HUD projection.

import { beforeEach, describe, expect, it } from 'vitest';
import { events } from '../../src/core/events.js';
import { IDENTITY_QUAT } from '../../src/core/math.js';
import { SELA } from '../../src/planets/configs/sela.js';
import { VORN } from '../../src/planets/configs/vorn.js';
import type { EntityId } from '../../src/sim/entities.js';
import { spawnPlaceableEntity } from '../../src/sim/placeActions.js';
import { World } from '../../src/sim/world.js';
import type { PlayerInput } from '../../src/player/input.js';
import { dispatchTickInput } from '../../src/game/tickInput.js';
import { interactPrompt } from '../../src/game/prompts.js';
import { flightStatusFor } from '../../src/game/shuttleHud.js';
import { findAimedShuttle } from '../../src/game/pickup.js';
import { PlacementMode } from '../../src/game/placement.js';
import { ToolMode } from '../../src/game/toolMode.js';
import type { ToolAim } from '../../src/player/terrainTool.js';

function spawnWorld(offsetX = 0): { world: World; playerId: EntityId; shuttleId: EntityId } {
  const world = new World(1337, { planets: [SELA, VORN] });
  world.dispatch({
    type: 'spawnPlayer',
    planetId: SELA.id,
    position: { x: 0, y: SELA.radius, z: 0 },
  });
  world.tick();
  const playerId = [...world.entities.values()].find((e) => e.kind === 'player')?.id ?? '';
  const shuttleId = spawnPlaceableEntity(world, SELA.id, 'shuttle', {
    x: offsetX,
    y: SELA.radius,
    z: 0,
  });
  if (!playerId || !shuttleId) throw new Error('fixture failed');
  return { world, playerId, shuttleId };
}

function giveItem(world: World, playerId: EntityId, itemId: string): void {
  const player = world.entities.get(playerId);
  const inventory = player?.components.inventory;
  if (!player || !inventory) throw new Error('no inventory');
  const id = world.nextId('item');
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: player.planetId,
    position: { ...player.position },
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId, holder: playerId } },
  });
  const slot = inventory.slots.indexOf(null);
  inventory.slots[slot] = id;
  inventory.selectedSlot = slot;
}

class StubInput {
  interact = false;
  space = false;
  sprintHeld = false;
  moveX = 0;
  moveZ = 0;
  readonly pilotLook = { setActive: () => undefined };
  constructor(private readonly oneShot: Partial<Record<'headlamp' | 'jump' | 'printer', boolean>> = {}) {}
  consumeHeadlampToggle(): boolean { return this.oneShot.headlamp === true; }
  consumeInteract(): boolean { const v = this.interact; this.interact = false; return v; }
  consumePrimaryClick(): boolean { return false; }
  consumeCableToggle(): boolean { return false; }
  consumeToolToggle(): boolean { return false; }
  consumeBrushToggle(): boolean { return false; }
  consumeJump(): boolean { return this.oneShot.jump === true; }
  consumePrinter(): boolean { return this.oneShot.printer === true; }
  consumeSelect(): null { return null; }
  consumeTether(): boolean { return false; }
  move(): { x: number; z: number } { return { x: this.moveX, z: this.moveZ }; }
  sprint(): boolean { return this.sprintHeld; }
  spaceHeld(): boolean { return this.space; }
  isInteractHeld(): boolean { return this.interact; }
}

function tickInput(world: World, playerId: EntityId, input: PlayerInput): void {
  dispatchTickInput({
    world,
    playerId,
    input,
    rig: { yaw: 0.5, pitch: -0.2 },
    tool: { update: () => null } as never,
    toolMode: new ToolMode(),
    toolAim: { hit: null, normal: null, planet: null },
    toolButtons: { primary: false, flatten: false },
    nowMs: 0,
    flying: false,
    uiOpen: false,
    placement: new PlacementMode(),
    openStation: () => undefined,
    togglePrinter: () => undefined,
  });
}

describe('piloting input branch', () => {
  beforeEach(() => events.clear());
  it('uses continuous pilot mouse history rather than clamped on-foot camera pitch', () => {
    const { world, playerId, shuttleId } = spawnWorld();
    world.dispatch({ type: 'enterShuttle', playerId, shuttleId });
    world.tick();
    const input = new StubInput();
    Object.assign(input.pilotLook, { steering: () => ({ yaw: 3, pitch: 8 }) });
    tickInput(world, playerId, input as unknown as PlayerInput);
    world.tick();
    expect(world.entities.get(shuttleId)?.components.shuttle?.input).toMatchObject({ lookYaw: 3, lookPitch: 8 });
  });

  it('turns WASD/Space/Shift/mouse into one shuttleInput per tick', () => {
    const { world, playerId, shuttleId } = spawnWorld();
    world.dispatch({ type: 'enterShuttle', playerId, shuttleId });
    world.tick();
    const input = new StubInput();
    input.moveX = 1;
    input.moveZ = 1;
    input.space = true;
    input.sprintHeld = true;
    tickInput(world, playerId, input as unknown as PlayerInput);
    world.tick();
    expect(world.entities.get(shuttleId)?.components.shuttle?.input).toEqual({
      thrust: 1,
      yawRate: 1,
      lift: true,
      boost: true,
      lookYaw: 0.5,
      lookPitch: -0.2,
    });
    // The pilot did not also queue a walking input.
    expect(world.entities.get(playerId)?.components.player?.input).toBe(null);
  });

  it('E disembarks when landed and drains on-foot queues', () => {
    const { world, playerId, shuttleId } = spawnWorld();
    world.dispatch({ type: 'enterShuttle', playerId, shuttleId });
    world.tick();
    const input = new StubInput();
    input.interact = true;
    tickInput(world, playerId, input as unknown as PlayerInput);
    world.tick();
    expect(world.entities.get(playerId)?.components.player?.pilotingShuttleId ?? null).toBe(null);
    expect(world.entities.get(shuttleId)?.components.shuttle?.pilotId ?? null).toBe(null);
  });

  it('leaves the normal on-foot path unchanged', () => {
    const { world, playerId } = spawnWorld();
    const input = new StubInput({ jump: true });
    input.moveZ = 1;
    tickInput(world, playerId, input as unknown as PlayerInput);
    world.tick();
    const playerComp = world.entities.get(playerId)?.components.player;
    expect(playerComp?.input?.moveZ).toBe(1);
    expect(playerComp?.input?.jump).toBe(true);
  });
});

describe('shuttle E prompt parity', () => {
  beforeEach(() => events.clear());

  function aimAtShuttle(world: World, playerId: EntityId): ToolAim {
    const player = world.entities.get(playerId)!;
    return {
      hit: null,
      normal: null,
      planet: SELA,
      ray: {
        origin: { x: player.position.x, y: player.position.y + 1.5, z: player.position.z },
        dir: { x: 1, y: 0, z: 0 },
      },
    };
  }

  it('offers fuel loading while a cell is carried, then boarding', () => {
    const { world, playerId, shuttleId } = spawnWorld(2);
    const aim = aimAtShuttle(world, playerId);
    expect(interactPrompt(world, playerId, aim, new PlacementMode())).toBe('E: board Shuttle');
    giveItem(world, playerId, 'fuel_cell');
    expect(interactPrompt(world, playerId, aim, new PlacementMode())).toBe(
      'E: load Fuel cell (0/2)',
    );
    world.entities.get(shuttleId)!.components.shuttle!.fuel = 1;
    expect(interactPrompt(world, playerId, aim, new PlacementMode())).toBe(
      'E: load Fuel cell (1/2)',
    );
    world.entities.get(shuttleId)!.components.shuttle!.fuel = 2;
    expect(interactPrompt(world, playerId, aim, new PlacementMode())).toBe('E: board Shuttle');
  });

  it('does not board a different ship when the cursor ray misses', () => {
    const { world, playerId, shuttleId } = spawnWorld(4);
    const player = world.entities.get(playerId)!;
    const awayAim: ToolAim = {
      hit: null,
      normal: null,
      planet: SELA,
      ray: {
        origin: { x: player.position.x, y: player.position.y + 1.5, z: player.position.z },
        dir: { x: -1, y: 0, z: 0 },
      },
    };
    // The ray misses, even though the ship is inside the on-foot cone.
    expect(findAimedShuttle(world, playerId, awayAim)).toBe(null);
    // Headless callers without a ray keep the forgiving cone fallback.
    expect(findAimedShuttle(world, playerId)).toBe(shuttleId);
  });

  it('shows disembark only while landed', () => {    const { world, playerId, shuttleId } = spawnWorld();
    world.dispatch({ type: 'enterShuttle', playerId, shuttleId });
    world.tick();
    const aim: ToolAim = { hit: null, normal: null, planet: null };
    expect(interactPrompt(world, playerId, aim, new PlacementMode())).toBe('E: disembark');
    world.entities.get(shuttleId)!.components.shuttle!.airborne = true;
    expect(interactPrompt(world, playerId, aim, new PlacementMode())).toBe('Land to disembark');
  });
});

describe('flight HUD projection', () => {
  beforeEach(() => events.clear());

  it('reports speed, altitude, planets and habitat markers', () => {
    const { world, playerId, shuttleId } = spawnWorld();
    world.dispatch({ type: 'enterShuttle', playerId, shuttleId });
    world.tick();
    const shuttle = world.entities.get(shuttleId)!;
    shuttle.planetId = null;
    shuttle.position = { x: 9000, y: 1000, z: 3000 };
    shuttle.components.shuttle!.airborne = true;
    shuttle.components.shuttle!.velocity = { x: 300, y: 0, z: 400 };
    const status = flightStatusFor(world, [SELA, VORN], playerId);
    expect(status).not.toBeNull();
    expect(status?.speedMps).toBeCloseTo(500, 5);
    expect(status?.fuel).toBe(0);
    expect(status?.planets).toHaveLength(2);
    expect(status?.planets.map((p) => p.label).sort()).toEqual(['Sela', 'Vorn']);
    expect(status?.habitats).toHaveLength(0);
    expect(status?.altitudeM).toBeGreaterThan(0);
    // Same fixture with a habitat: the marker carries a distance.
    const hubId = world.nextId('machine');
    world.entities.set(hubId, {
      id: hubId,
      kind: 'machine',
      planetId: SELA.id,
      position: { x: 0, y: SELA.radius, z: 0 },
      rotation: { ...IDENTITY_QUAT },
      components: { machine: { machineType: 'habitat' } },
    });
    const withHub = flightStatusFor(world, [SELA, VORN], playerId);
    expect(withHub?.habitats).toHaveLength(1);
    expect(withHub?.habitats[0]?.label).toBe('Base · Sela');
    expect(withHub?.habitats[0]?.distanceM).toBeGreaterThan(1000);
    expect(withHub?.habitats[0]?.samePlanet).toBe(false);
  });
});
