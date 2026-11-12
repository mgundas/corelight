// E / Tab interaction wiring (M09). One deterministic priority chain so the
// single E key never becomes modal: cancel placement > aimed station
// (collect/deposit/open) > aimed item > aimed tether > packaged placeable
// (enter placement) > selected light stick. Tab toggles the backpack printer.
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
import type { PackHold } from './packHold.js';
import { primaryPackTarget } from './packTarget.js';

export interface InteractDeps {
  world: World;
  playerId: EntityId | null;
  input: PlayerInput;
  /** Fresh E edge for this tick (consumed once by the caller). */
  interact: boolean;
  /** True while E is physically down (hold-to-pack). */
  interactHeld?: boolean;
  /** Wall-clock ms for the 1 s pack gesture. */
  nowMs?: number;
  /** Owns hold-E timing; absent in focused unit tests (normal tap-E only). */
  packHold?: PackHold;
  /** False while flying or while a menu/UI owns input. */
  canAct: boolean;
  aim: ToolAim;
  placement: PlacementMode;
  /** Open the station recipe panel (the UI module owns presentation). */
  openStation(stationId: EntityId): void;
  /** Tab: toggle the backpack printer panel (caller decides fly mode). */
  togglePrinter(): void;
}

/** True when the selected slot holds a light stick ("holding" in the HUD). */
export function hasSelectedLightstick(world: World, playerId: EntityId): boolean {
  const inventory = world.entities.get(playerId)?.components.inventory;
  if (!inventory) return false;
  const selected = inventory.slots[inventory.selectedSlot];
  return selected !== null && selected !== undefined && world.entities.get(selected)?.components.item?.itemId === 'light_stick';
}

export function tickInteraction(deps: InteractDeps): void {
  const tab = deps.input.consumePrinter();
  if (tab && deps.playerId) deps.togglePrinter();
  if (!deps.canAct || !deps.playerId) {
    deps.packHold?.reset();
    return;
  }
  const { world, playerId, aim, placement } = deps;
  // E while placing cancels the ghost and never starts a pack gesture.
  if (placement.isActive()) {
    if (deps.interact) placement.cancel();
    return;
  }
  let forceInteract = deps.interact;
  if (deps.packHold) {
    const packTarget = primaryPackTarget(world, playerId);
    if (packTarget && deps.interact) {
      deps.packHold.press(packTarget, deps.nowMs ?? 0);
    }
    const result = deps.packHold.update(
      deps.interactHeld === true,
      deps.nowMs ?? 0,
      packTarget,
    );
    if (result === 'hold') return;
    if (result === 'pack') {
      if (packTarget) {
        world.dispatch({ type: 'packUpPlaced', playerId, entityId: packTarget });
      }
      return;
    }
    if (result === 'release') forceInteract = true;
  }
  if (!forceInteract) return;
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
  // Carried placeables enter placement mode before the light stick branch:
  // a light stick in the pack must not swallow E while a platform is carried.
  const carried = hit ? carriedPlaceable(world, playerId) : null;
  if (carried) {
    placement.enter(carried.placeable.id);
    return;
  }
  if (hit && hasSelectedLightstick(world, playerId)) {
    world.dispatch({ type: 'placeLightstick', playerId });
  }
}
