// Interaction prompt assembly (M09): mirrors interactWiring's priority chain
// so the HUD always says what E will do next. Read-only.

import { STATION_INPUT_SLOTS } from '../core/constants.js';
import { isKnownItem, itemDef } from '../data/loadData.js';
import { placeableById, placeableForMachineType } from '../data/loadPlaceables.js';
import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import { depositCandidate, printerFor } from '../sim/craftingActions.js';
import type { ToolAim } from '../player/terrainTool.js';
import { hasSelectedLightstick } from './interactWiring.js';
import { findAimedItem, findAimedStation, findAimedTether } from './pickup.js';
import { carriedPlaceable, placementCheckFor, type PlacementMode } from './placement.js';

function nameForId(id: string): string {
  if (isKnownItem(id)) return itemDef(id).name;
  return placeableById(id)?.name ?? id;
}

/** "E: ..." line for the HUD, or null when nothing is actionable. */
export function interactPrompt(
  world: World,
  playerId: EntityId | null,
  aim: ToolAim,
  placement: PlacementMode,
): string | null {
  if (!playerId) return null;
  if (placement.isActive()) {
    const carried = carriedPlaceable(world, playerId);
    if (!carried) return null;
    const check = placementCheckFor(world, playerId, aim);
    if (!check.position) return `Aim at the ground to place ${carried.placeable.name} (E: cancel)`;
    if (!check.ok) return `${carried.placeable.name}: ${check.reason} (E: cancel)`;
    return `Click: place ${carried.placeable.name} (E: cancel)`;
  }
  const stationId = findAimedStation(world, playerId);
  if (stationId) {
    const station = world.entities.get(stationId);
    const printer = station ? printerFor(station) : null;
    const machineType = station?.components.machine?.machineType;
    const stationName = machineType ? (placeableForMachineType(machineType)?.name ?? 'Station') : 'Station';
    if (printer?.outputReady) return `E: collect ${nameForId(printer.outputReady)}`;
    const inventory = world.entities.get(playerId)?.components.inventory;
    const candidate = inventory && station ? depositCandidate(world, inventory, station) : null;
    if (candidate && printer && printer.inputs.length < STATION_INPUT_SLOTS) {
      const itemId = world.entities.get(candidate)?.components.item?.itemId;
      return `E: load ${itemId ? nameForId(itemId) : 'input'}`;
    }
    return `E: open ${stationName}`;
  }
  const itemId = findAimedItem(world, playerId);
  if (itemId) {
    const carriedId = world.entities.get(itemId)?.components.item?.itemId;
    return `E: pick up ${carriedId ? nameForId(carriedId) : 'item'}`;
  }
  if (findAimedTether(world, playerId)) return 'E: pick up tether post';
  const carried = carriedPlaceable(world, playerId);
  if (aim.hit && carried) return `E: place ${carried.placeable.name}`;
  if (aim.hit && hasSelectedLightstick(world, playerId)) return 'E: place light stick';
  return null;
}
