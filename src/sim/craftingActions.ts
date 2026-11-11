// Crafting action handlers (M09): backpack printing and station jobs.
// Split out of actions.ts (M08 tetherActions precedent) so dispatch stays a
// thin switch and every gameplay mutation still flows through applyAction.
//
// Backpack prints are instant and consume carried items. Station jobs take
// inputs from the station's own input slots (E deposits the selected item),
// consume them at job start, and expose the output once `time` has passed;
// E near the station collects it. Power is stubbed by CRAFTING_REQUIRE_POWER
// (M10 replaces the flag with the real network).

import {
  CRAFTING_REQUIRE_POWER,
  STATION_INPUT_SLOTS,
  STATION_RANGE_M,
} from '../core/constants.js';
import { events } from '../core/events.js';
import { distance, IDENTITY_QUAT } from '../core/math.js';
import { isKnownItem } from '../data/loadData.js';
import {
  isPlaceable,
  placeableDef,
} from '../data/loadPlaceables.js';
import {
  isRecipeUnlocked,
  recipeById,
  recipesForStation,
  type RecipeDef,
  type RecipeStation,
} from '../data/loadRecipes.js';
import type { Entity, EntityId, PrinterComponent } from './entities.js';
import { inventoryFor, isLargePackage } from './inventoryActions.js';
import { upAt } from './physics/frames.js';
import type { World } from './world.js';

const STATION_MACHINE_TYPES: ReadonlySet<string> = new Set([
  'small_printer',
  'medium_printer',
  'furnace',
  'refinery',
]);

export function isStationMachine(entity: Entity | undefined): boolean {
  return (
    entity?.kind === 'machine' &&
    entity.components.machine !== undefined &&
    STATION_MACHINE_TYPES.has(entity.components.machine.machineType)
  );
}

/** Station printer component, lazily created for hand-authored saves. */
export function printerFor(entity: Entity): PrinterComponent | null {
  if (!isStationMachine(entity)) return null;
  let printer = entity.components.printer;
  if (!printer) {
    printer = { recipeId: null, progressS: 0, inputs: [], outputReady: null };
    entity.components.printer = printer;
  }
  return printer;
}

function nearStation(player: Entity, station: Entity): boolean {
  return (
    player.planetId !== null &&
    player.planetId === station.planetId &&
    distance(player.position, station.position) <= STATION_RANGE_M
  );
}

/** Count item entities of one id inside the backpack slots. */
export function countInBackpack(
  world: World,
  slots: (EntityId | null)[],
  itemId: string,
): number {
  let count = 0;
  for (const id of slots) {
    if (id && world.entities.get(id)?.components.item?.itemId === itemId) count += 1;
  }
  return count;
}

/** Count item entities of one id loaded into a station's input slots. */
export function countInStation(world: World, printer: PrinterComponent, itemId: string): number {
  let count = 0;
  for (const id of printer.inputs) {
    if (world.entities.get(id)?.components.item?.itemId === itemId) count += 1;
  }
  return count;
}

/** Every required input is available (used by actions, UI and prompts). */
export function recipeInputsAvailable(
  recipe: RecipeDef,
  count: (itemId: string) => number,
): boolean {
  return recipe.inputs.every((input) => count(input.item) >= input.count);
}

/** Recipe output capacity: large packages need empty hands (others can drop). */
function canAcceptOutput(player: Entity, outputId: string): boolean {
  if (isPlaceable(outputId) && placeableDef(outputId).size === 'large') {
    return !player.components.player?.carryingLarge;
  }
  return true;
}

/**
 * Create the recipe output for a player: normal items and small packages go
 * into a free backpack slot, large packages are front-carried, and a full
 * pack drops the output loose at the player's feet (prompt wording).
 */
function giveOutput(world: World, player: Entity, outputId: string): void {
  const playerComp = player.components.player;
  const inventory = player.components.inventory;
  const packageItem = isPlaceable(outputId) ? placeableDef(outputId).packageItem : outputId;
  const large = isLargePackage(packageItem);
  const id = world.nextId('item');
  const up = world.planets.find((p) => p.id === player.planetId);
  const upVec = up ? upAt(up, player.position) : { x: 0, y: 1, z: 0 };
  const basePos = {
    x: player.position.x + upVec.x * 0.8,
    y: player.position.y + upVec.y * 0.8,
    z: player.position.z + upVec.z * 0.8,
  };
  if (large && playerComp && !playerComp.carryingLarge) {
    playerComp.carryingLarge = id;
    world.entities.set(id, {
      id,
      kind: 'item',
      planetId: player.planetId,
      position: { ...player.position },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: packageItem, holder: player.id } },
    });
    return;
  }
  // Large packages never occupy backpack slots: with hands full they drop
  // loose at the player's feet instead.
  const free = large || !inventory ? -1 : inventory.slots.indexOf(null);
  if (inventory && free !== -1) {
    inventory.slots[free] = id;
    world.entities.set(id, {
      id,
      kind: 'item',
      planetId: player.planetId,
      position: { ...player.position },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: packageItem, holder: player.id } },
    });
    return;
  }
  world.entities.set(id, {
    id,
    kind: 'item',
    planetId: player.planetId,
    position: basePos,
    rotation: { ...IDENTITY_QUAT },
    components: { item: { itemId: packageItem } },
  });
}

/** Consume the recipe's inputs from the backpack slots. */
function consumeBackpackInputs(
  world: World,
  slots: (EntityId | null)[],
  recipe: RecipeDef,
): void {
  for (const input of recipe.inputs) {
    let left = input.count;
    for (let i = 0; i < slots.length && left > 0; i += 1) {
      const id = slots[i];
      if (!id || world.entities.get(id)?.components.item?.itemId !== input.item) continue;
      world.entities.delete(id);
      slots[i] = null;
      left -= 1;
    }
  }
}

/** Consume the recipe's inputs from a station's input slots. */
function consumeStationInputs(
  world: World,
  printer: PrinterComponent,
  recipe: RecipeDef,
): void {
  const needed = new Map(recipe.inputs.map((input) => [input.item, input.count]));
  const remaining: EntityId[] = [];
  for (const id of printer.inputs) {
    const itemId = world.entities.get(id)?.components.item?.itemId;
    const left = itemId ? (needed.get(itemId) ?? 0) : 0;
    if (itemId && left > 0) {
      needed.set(itemId, left - 1);
      world.entities.delete(id);
    } else {
      remaining.push(id);
    }
  }
  printer.inputs = remaining;
}

/** The recipe's station matches this station machine. */
function stationMatches(station: Entity, recipe: RecipeDef): boolean {
  return station.components.machine?.machineType === recipe.station;
}

export function printBackpack(world: World, playerId: EntityId, recipeId: string): void {
  const player = world.entities.get(playerId);
  const inventory = player ? inventoryFor(world, playerId) : null;
  const playerComp = player?.components.player;
  const recipe = recipeById(recipeId);
  if (!player || player.kind !== 'player' || !inventory || !playerComp || !recipe) {
    events.emit('actionApplied', { type: 'printBackpack' });
    return;
  }
  if (
    recipe.station !== 'backpack' ||
    !isRecipeUnlocked(recipe) ||
    !recipeInputsAvailable(recipe, (itemId) => countInBackpack(world, inventory.slots, itemId)) ||
    !canAcceptOutput(player, recipe.output)
  ) {
    events.emit('actionApplied', { type: 'printBackpack' });
    return;
  }
  consumeBackpackInputs(world, inventory.slots, recipe);
  giveOutput(world, player, recipe.output);
  events.emit('actionApplied', { type: 'printBackpack' });
}

/** E while holding an input loads one item into the station's input slots. */
export function depositToStation(world: World, playerId: EntityId, stationId: EntityId): void {
  const player = world.entities.get(playerId);
  const station = world.entities.get(stationId);
  const inventory = player ? inventoryFor(world, playerId) : null;
  const printer = station ? printerFor(station) : null;
  if (!player || !station || !inventory || !printer) {
    events.emit('actionApplied', { type: 'depositToStation' });
    return;
  }
  const heldId = depositCandidate(world, inventory, station);
  if (!heldId || !nearStation(player, station) || printer.inputs.length >= STATION_INPUT_SLOTS) {
    events.emit('actionApplied', { type: 'depositToStation' });
    return;
  }
  const held = world.entities.get(heldId)?.components.item;
  if (!held) {
    events.emit('actionApplied', { type: 'depositToStation' });
    return;
  }
  const slot = inventory.slots.indexOf(heldId);
  if (slot !== -1) inventory.slots[slot] = null;
  held.holder = stationId;
  printer.inputs.push(heldId);
  events.emit('actionApplied', { type: 'depositToStation' });
}

/** Start a station job; inputs are consumed now, output appears after time. */
export function printAtStation(
  world: World,
  playerId: EntityId,
  stationId: EntityId,
  recipeId: string,
): void {
  const player = world.entities.get(playerId);
  const station = world.entities.get(stationId);
  const printer = station ? printerFor(station) : null;
  const recipe = recipeById(recipeId);
  if (!player || !station || !printer || !recipe || !nearStation(player, station)) {
    events.emit('actionApplied', { type: 'printAtStation' });
    return;
  }
  const powered = !CRAFTING_REQUIRE_POWER || (station.components.power?.stored ?? 0) > 0;
  if (
    !stationMatches(station, recipe) ||
    !isRecipeUnlocked(recipe) ||
    printer.recipeId !== null ||
    printer.outputReady !== null ||
    !powered ||
    !recipeInputsAvailable(recipe, (itemId) => countInStation(world, printer, itemId))
  ) {
    events.emit('actionApplied', { type: 'printAtStation' });
    return;
  }
  consumeStationInputs(world, printer, recipe);
  printer.recipeId = recipe.id;
  printer.progressS = 0;
  events.emit('actionApplied', { type: 'printAtStation' });
}

/** E on a station whose output is ready collects it into the backpack. */
export function collectStation(world: World, playerId: EntityId, stationId: EntityId): void {
  const player = world.entities.get(playerId);
  const station = world.entities.get(stationId);
  const printer = station ? printerFor(station) : null;
  if (
    !player ||
    !station ||
    !printer ||
    printer.outputReady === null ||
    !nearStation(player, station)
  ) {
    events.emit('actionApplied', { type: 'collectStation' });
    return;
  }
  const outputId = printer.outputReady;
  if (!isKnownItem(outputId) && !isPlaceable(outputId)) {
    printer.outputReady = null;
    events.emit('actionApplied', { type: 'collectStation' });
    return;
  }
  giveOutput(world, player, outputId);
  printer.outputReady = null;
  events.emit('actionApplied', { type: 'collectStation' });
}

/** True when this station's recipe catalog lists the item as an input. */
export function stationAcceptsItem(station: Entity, itemId: string): boolean {
  const machineType = station.components.machine?.machineType;
  if (!machineType || !isKnownItem(itemId)) return false;
  return recipesForStation(machineType as RecipeStation).some((recipe) =>
    recipe.inputs.some((input) => input.item === itemId),
  );
}

/**
 * The backpack item E would deposit next: the selected slot when it is a
 * station input, else the first matching carried input (so a fresh pickup
 * works without slot juggling). Null when nothing matches.
 */
export function depositCandidate(
  world: World,
  inventory: { slots: (EntityId | null)[]; selectedSlot: number },
  station: Entity,
): EntityId | null {
  const selected = inventory.slots[inventory.selectedSlot];
  const selectedId = selected ? world.entities.get(selected)?.components.item?.itemId : undefined;
  if (selected && selectedId && stationAcceptsItem(station, selectedId)) return selected;
  for (const id of inventory.slots) {
    if (!id) continue;
    const itemId = world.entities.get(id)?.components.item?.itemId;
    if (itemId && stationAcceptsItem(station, itemId)) return id;
  }
  return null;
}
