// Interaction prompt assembly (M09/M10): mirrors interactWiring's priority
// chain so the HUD always says what E will do next. M10 adds the cable tool
// and the hold-E pack gesture. Read-only.

import { RESEARCH_TIME_S, SHUTTLE_FUEL_MAX } from '../core/constants.js';
import { isKnownItem, itemDef } from '../data/loadData.js';
import { placeableById, placeableForMachineType, placeableForPackageItem } from '../data/loadPlaceables.js';
import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import { depositCandidate, inputSlotsFor } from '../sim/stationInputs.js';
import { printerFor } from '../sim/craftingActions.js';
import { isLanded, shuttleFuel } from '../sim/shuttle.js';
import {
  isResearchStation,
  researchFor,
  researchSampleCandidate,
} from '../sim/researchActions.js';
import { cableOnSnap, snapFree } from '../sim/snapUtils.js';
import type { ToolAim } from '../player/terrainTool.js';
import type { CableMode } from './cableMode.js';
import { carriesFuelCell, hasSelectedLightstick } from './interactWiring.js';
import { findAimedItem, findAimedShuttle, findAimedStation, findAimedTether } from './pickup.js';
import { carriedPlaceable, placementCheckFor, type PlacementMode } from './placement.js';
import { primaryPackTarget } from './packTarget.js';
import { findAimedSnap, findPlacementTarget } from './snapTarget.js';

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
  cable?: CableMode,
  cursorItemId: EntityId | null = null,
  cursorPackId: EntityId | null = null,
): string | null {
  if (!playerId) return null;
  // Piloting: E is only the disembark key while parked on the ground.
  const playerComp = world.entities.get(playerId)?.components.player;
  const pilotingId = playerComp?.pilotingShuttleId ?? null;
  if (pilotingId) {
    const shuttle = world.entities.get(pilotingId)?.components.shuttle;
    if (!shuttle) return null;
    return isLanded(shuttle) ? 'E: disembark' : 'Land to disembark';
  }
  if (cable?.isActive()) {
    const aimed = findAimedSnap(world, playerId, aim);
    if (aimed && cableOnSnap(world, aimed)) return 'Cable: click to cut this cable (E: exit)';
    if (aimed && !snapFree(world, aimed)) return 'Cable: snap point is occupied (E: exit)';
    if (cable.pendingRef()) return 'Cable: click a target snap within 10 m (E: exit)';
    return 'Cable: click a snap point (E: exit)';
  }
  if (placement.isActive()) {
    const carried = carriedPlaceable(world, playerId);
    if (!carried) return null;
    const check = placementCheckFor(world, playerId, aim);
    if (!check.position) {
      return check.reason && check.reason !== 'Aim at the ground'
        ? `${carried.placeable.name}: ${check.reason} (E: cancel)`
        : `Aim at the ground to place ${carried.placeable.name} (E: cancel)`;
    }
    if (!check.ok) return `${carried.placeable.name}: ${check.reason} (E: cancel)`;
    return `Click: place ${carried.placeable.name} (E: cancel)`;
  }
  const grabbedId = world.entities.get(playerId)?.components.player?.grabbed;
  if (grabbedId) {
    const itemId = world.entities.get(grabbedId)?.components.item?.itemId;
    const name = itemId ? nameForId(itemId) : 'item';
    const def = itemId ? placeableForPackageItem(itemId) : undefined;
    if (def && findPlacementTarget(world, playerId, def.id, aim)) {
      return `Click: place ${def.name}`;
    }
    return `Click: drop ${name}`;
  }
  if (cursorItemId) {
    const itemId = world.entities.get(cursorItemId)?.components.item?.itemId;
    if (itemId) return `Click: grab ${nameForId(itemId)}`;
  }
  if (cursorPackId && findAimedStation(world, playerId, aim) !== cursorPackId) {
    const placeableId = world.entities.get(cursorPackId)?.components.placeable?.placeableId;
    return `Click: move ${placeableId ? nameForId(placeableId) : 'structure'}`;
  }
  const packTarget = primaryPackTarget(world, playerId, aim);
  if (packTarget) {
    const placeableId = world.entities.get(packTarget)?.components.placeable?.placeableId;
    const def = placeableId ? placeableById(placeableId) : undefined;
    const isStation = findAimedStation(world, playerId, aim) === packTarget;
    return `Hold E: pack up ${def?.name ?? 'structure'}${isStation ? ' (tap E: open)' : ''}`;
  }
  const stationId = findAimedStation(world, playerId, aim);
  const shuttleId = findAimedShuttle(world, playerId, aim);
  if (shuttleId) {
    const shuttleComp = world.entities.get(shuttleId)?.components.shuttle;
    if (
      shuttleComp &&
      shuttleFuel(shuttleComp) < SHUTTLE_FUEL_MAX &&
      carriesFuelCell(world, playerId)
    ) {
      return `E: load Fuel cell (${shuttleFuel(shuttleComp)}/${SHUTTLE_FUEL_MAX})`;
    }
    return 'E: board Shuttle';
  }
  if (stationId) {
    const station = world.entities.get(stationId);
    if (isResearchStation(station)) {
      const research = station ? researchFor(station) : null;
      const inventory = world.entities.get(playerId)?.components.inventory;
      if (research && research.dataReady > 0) return `E: collect ${research.dataReady} Data`;
      if (research && research.inputId === null && inventory && researchSampleCandidate(world, inventory)) {
        return 'E: load Research sample';
      }
      return research?.inputId
        ? `E: open Research station (${Math.round((research.progressS / RESEARCH_TIME_S) * 100)}%)`
        : 'E: open Research station';
    }
    const printer = station ? printerFor(station) : null;
    const machineType = station?.components.machine?.machineType;
    const stationName = machineType ? (placeableForMachineType(machineType)?.name ?? 'Station') : 'Station';
    if (printer?.outputReady) return `E: collect ${nameForId(printer.outputReady)}`;
    const inventory = world.entities.get(playerId)?.components.inventory;
    const candidate = inventory && station ? depositCandidate(world, inventory, station) : null;
    if (candidate && printer && station && printer.inputs.length < inputSlotsFor(station)) {
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
