// E / Tab interaction wiring (M09). One deterministic priority chain so the
// single E key never becomes modal: cancel placement > aimed station
// (collect/deposit/open) > aimed item > aimed tether > packaged placeable
// (enter placement) > selected light stick. Tab toggles the backpack printer.
// Queues drain every tick even when the player cannot act (no late fires).

import type { Vec3d } from '../core/math.js';
import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import { depositCandidate, inputSlotsFor } from '../sim/stationInputs.js';
import { printerFor } from '../sim/craftingActions.js';
import { SHUTTLE_FUEL_MAX } from '../core/constants.js';
import { shuttleFuel } from '../sim/shuttle.js';
import {
  isResearchStation,
  researchFor,
  researchSampleCandidate,
} from '../sim/researchActions.js';
import type { PlayerInput } from '../player/input.js';
import type { ToolAim } from '../player/terrainTool.js';
import type { PlacementMode } from './placement.js';
import { carriedPlaceable } from './placement.js';
import { findAimedItem, findAimedShuttle, findAimedStation, findAimedTether } from './pickup.js';
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
  /** Open the research tree panel (optional in focused tests). */
  openResearch?: (stationId: EntityId) => void;
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

/** True when the backpack carries a fuel cell (selected slot is preferred). */
export function carriesFuelCell(world: World, playerId: EntityId): boolean {
  const inventory = world.entities.get(playerId)?.components.inventory;
  if (!inventory) return false;
  const isFuel = (id: EntityId | null): boolean =>
    id !== null && world.entities.get(id)?.components.item?.itemId === 'fuel_cell';
  const selected = inventory.slots[inventory.selectedSlot] ?? null;
  return isFuel(selected) || inventory.slots.some((id) => isFuel(id ?? null));
}

export function tickInteraction(deps: InteractDeps): void {
  const tab = deps.input.consumePrinter();
  if (tab && deps.playerId) deps.togglePrinter();
  if (!deps.canAct || !deps.playerId) {
    deps.packHold?.reset();
    return;
  }
  const { world, playerId, aim, placement } = deps;
  // Pilot: E disembarks. Nothing else on foot is reachable inside the ship.
  if (world.entities.get(playerId)?.components.player?.pilotingShuttleId) {
    if (deps.interact) world.dispatch({ type: 'exitShuttle', playerId });
    return;
  }
  // E while placing cancels the ghost and never starts a pack gesture.
  if (placement.isActive()) {
    if (deps.interact) placement.cancel();
    return;
  }
  let forceInteract = deps.interact;
  if (deps.packHold) {
    const packTarget = primaryPackTarget(world, playerId, aim);
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
  // M14: board the shuttle, or load a carried fuel cell into one of its two
  // side slots first. Fuel wins while the ship still has room.
  const shuttleId = findAimedShuttle(world, playerId, aim);
  if (shuttleId) {
    const shuttleComp = world.entities.get(shuttleId)?.components.shuttle;
    if (
      shuttleComp &&
      shuttleFuel(shuttleComp) < SHUTTLE_FUEL_MAX &&
      carriesFuelCell(world, playerId)
    ) {
      world.dispatch({ type: 'loadShuttleFuel', playerId, shuttleId });
    } else {
      world.dispatch({ type: 'enterShuttle', playerId, shuttleId });
    }
    return;
  }
  const stationId = findAimedStation(world, playerId, aim);
  if (stationId) {
    const station = world.entities.get(stationId);
    const inventory = world.entities.get(playerId)?.components.inventory;
    // Research station (M11): collect Data > load a sample > open the tree.
    if (isResearchStation(station)) {
      const research = station ? researchFor(station) : null;
      if (research && research.dataReady > 0) {
        world.dispatch({ type: 'collectResearch', playerId, stationId });
        return;
      }
      if (research && research.inputId === null && inventory && researchSampleCandidate(world, inventory)) {
        world.dispatch({ type: 'depositResearchSample', playerId, stationId });
        return;
      }
      deps.openResearch?.(stationId);
      return;
    }
    const printer = station ? printerFor(station) : null;
    if (!station || !printer) {
      deps.openStation(stationId);
      return;
    }
    if (printer.outputReady !== null) {
      world.dispatch({ type: 'collectStation', playerId, stationId });
      return;
    }
    const candidate = inventory ? depositCandidate(world, inventory, station) : null;
    if (candidate && printer.inputs.length < inputSlotsFor(station)) {
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
