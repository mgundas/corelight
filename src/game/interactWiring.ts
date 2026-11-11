// E / Tab interaction wiring (M09). One deterministic priority chain so the
// single E key never becomes modal: cancel placement > aimed station
// (collect/deposit/open) > aimed item > aimed tether > light stick >
// packaged placeable (enter placement). Tab toggles the backpack printer.
// Queues drain every tick even when the player cannot act (no late fires).

import { STATION_INPUT_SLOTS } from '../core/constants.js';
import type { Vec3d } from '../core/math.js';
import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import { depositCandidate, printerFor } from '../sim/craftingActions.js';
import type { PlayerInput } from '../player/input.js';
import type { ToolAim } from '../player/terrainTool.js';
import type { PlacementMode } from './placement.js';
import { carriedPlaceable } from './placement.js';
import { findAimedItem, findAimedStation, findAimedTether } from './pickup.js';

export interface InteractDeps {
  world: World;
  playerId: EntityId | null;
  input: PlayerInput;
  /** False while flying or while a menu/UI owns input. */
  canAct: boolean;
  aim: ToolAim;
  placement: PlacementMode;
  /** Open the station recipe panel (the UI module owns presentation). */
  openStation(stationId: EntityId): void;
  /** Tab: toggle the backpack printer panel (caller decides fly mode). */
  togglePrinter(): void;
}

/** True when a light stick is in the selected slot or anywhere in the pack. */
export function hasLightstick(world: World, playerId: EntityId): boolean {
  const inventory = world.entities.get(playerId)?.components.inventory;
  if (!inventory) return false;
  const selected = inventory.slots[inventory.selectedSlot];
  if (selected && world.entities.get(selected)?.components.item?.itemId === 'light_stick') {
    return true;
  }
  return inventory.slots.some(
    (id) => id !== null && world.entities.get(id)?.components.item?.itemId === 'light_stick',
  );
}

export function tickInteraction(deps: InteractDeps): void {
  const tab = deps.input.consumePrinter();
  const interact = deps.input.consumeInteract();
  if (tab && deps.playerId) deps.togglePrinter();
  if (!interact || !deps.canAct || !deps.playerId) return;
  const { world, playerId, aim, placement } = deps;
  // E while placing cancels the ghost (right-click does too, in PlacementMode).
  if (placement.isActive()) {
    placement.cancel();
    return;
  }
  const stationId = findAimedStation(world, playerId);
  if (stationId) {
    const station = world.entities.get(stationId);
    const printer = station ? printerFor(station) : null;
    const inventory = world.entities.get(playerId)?.components.inventory;
    if (!station || !printer) {
      deps.openStation(stationId);
      return;
    }
    if (printer.outputReady !== null) {
      world.dispatch({ type: 'collectStation', playerId, stationId });
      return;
    }
    const candidate = inventory ? depositCandidate(world, inventory, station) : null;
    if (candidate && printer.inputs.length < STATION_INPUT_SLOTS) {
      world.dispatch({ type: 'depositToStation', playerId, stationId });
      return;
    }
    deps.openStation(stationId);
    return;
  }
  const itemId = findAimedItem(world, playerId);
  if (itemId) {
    world.dispatch({ type: 'pickUp', playerId, itemId });
    return;
  }
  const tetherId = findAimedTether(world, playerId);
  if (tetherId) {
    world.dispatch({ type: 'removeTether', playerId, tetherId });
    return;
  }
  const hit: Vec3d | null = aim.hit;
  if (hit && hasLightstick(world, playerId)) {
    world.dispatch({ type: 'placeLightstick', playerId });
    return;
  }
  const carried = hit ? carriedPlaceable(world, playerId) : null;
  if (carried) placement.enter(carried.placeable.id);
}
