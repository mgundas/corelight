// Station input-slot rules (M12, split from craftingActions to keep both
// files under the 400-line hard rule). The furnace has one recipe-input slot
// plus one biomass fuel slot; every other station accepts up to the largest
// recipe's item count. Read-only helpers used by actions, prompts and UI.

import { FURNACE_INPUT_SLOTS, STATION_INPUT_SLOTS } from '../core/constants.js';
import { isKnownItem } from '../data/loadData.js';
import { recipesForStation, type RecipeStation } from '../data/loadRecipes.js';
import type { Entity, EntityId } from './entities.js';
import type { World } from './world.js';

/** Input slot capacity: furnace 2 (ore + fuel), other stations 8. */
export function inputSlotsFor(station: Entity): number {
  return station.components.machine?.machineType === 'furnace'
    ? FURNACE_INPUT_SLOTS
    : STATION_INPUT_SLOTS;
}

/** Biomass is not a recipe input but a furnace accepts it as fuel. */
function isFurnaceFuel(station: Entity, itemId: string): boolean {
  return station.components.machine?.machineType === 'furnace' && itemId === 'biomass';
}

/**
 * Slot semantics for the furnace: one recipe-input slot plus one biomass
 * fuel slot. Without this a second biomass would occupy both slots and
 * (with no unload action) block the furnace forever. Other stations just
 * cap the total at inputSlotsFor().
 */
export function hasInputRoom(
  world: World,
  station: Entity,
  inputs: EntityId[],
  itemId: string,
): boolean {
  if (inputs.length >= inputSlotsFor(station)) return false;
  if (station.components.machine?.machineType !== 'furnace') return true;
  const fuel = itemId === 'biomass';
  return !inputs.some((id) => {
    const held = world.entities.get(id)?.components.item?.itemId;
    return fuel ? held === 'biomass' : held !== 'biomass';
  });
}

/** True when this station's recipe catalog lists the item as an input. */
export function stationAcceptsItem(station: Entity, itemId: string): boolean {
  const machineType = station.components.machine?.machineType;
  if (!machineType || !isKnownItem(itemId)) return false;
  if (isFurnaceFuel(station, itemId)) return true;
  return recipesForStation(machineType as RecipeStation).some((recipe) =>
    recipe.inputs.some((input) => input.item === itemId),
  );
}

/** Every item id the station will accept (recipe inputs + furnace fuel). */
export function stationAcceptedItems(station: Entity): string[] {
  const machineType = station.components.machine?.machineType;
  if (!machineType) return [];
  const ids = recipesForStation(machineType as RecipeStation).flatMap((recipe) =>
    recipe.inputs.map((input) => input.item),
  );
  if (machineType === 'furnace') ids.push('biomass');
  return [...new Set(ids)];
}

/**
 * The backpack item E would deposit next: the selected slot when it is a
 * station input with room, else the first matching carried input (so a fresh
 * pickup works without slot juggling). Null when nothing matches/fits.
 */
export function depositCandidate(
  world: World,
  inventory: { slots: (EntityId | null)[]; selectedSlot: number },
  station: Entity,
): EntityId | null {
  const inputs = station.components.printer?.inputs ?? [];
  const fits = (itemId: string): boolean =>
    stationAcceptsItem(station, itemId) && hasInputRoom(world, station, inputs, itemId);
  const selected = inventory.slots[inventory.selectedSlot];
  const selectedId = selected ? world.entities.get(selected)?.components.item?.itemId : undefined;
  if (selected && selectedId && fits(selectedId)) return selected;
  for (const id of inventory.slots) {
    if (!id) continue;
    const itemId = world.entities.get(id)?.components.item?.itemId;
    if (itemId && fits(itemId)) return id;
  }
  return null;
}
