// Printer UI state assembly (M09). Per-frame read-only projection of World
// state into the plain-DOM panel: recipes, have/need counts, locked rows,
// loaded station inputs, job progress and the collect affordance. Mutations
// still go through Actions dispatched by Game.

import { PRINTER_UI_SYNC_INTERVAL_MS, STATION_INPUT_SLOTS, STATION_RANGE_M } from '../core/constants.js';
import { distance } from '../core/math.js';
import { isKnownItem, itemDef } from '../data/loadData.js';
import { placeableById, placeableForMachineType } from '../data/loadPlaceables.js';
import {
  isRecipeUnlocked,
  recipeById,
  recipesForStation,
  type RecipeDef,
  type RecipeStation,
} from '../data/loadRecipes.js';
import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import { countInBackpack, countInStation, printerFor } from '../sim/craftingActions.js';
import { PrinterUi } from '../ui/printerUi.js';
import type { PrinterRow, PrinterUiState } from '../ui/printerUi.js';

function nameForId(id: string): string {
  if (isKnownItem(id)) return itemDef(id).name;
  return placeableById(id)?.name ?? id;
}

function rowFor(recipe: RecipeDef, count: (itemId: string) => number, stationBusy: boolean): PrinterRow {
  const locked = !isRecipeUnlocked(recipe);
  const inputs = recipe.inputs.map((input) => ({
    name: isKnownItem(input.item) ? itemDef(input.item).name : input.item,
    need: input.count,
    have: count(input.item),
  }));
  const haveAll = inputs.every((input) => input.have >= input.need);
  return {
    recipeId: recipe.id,
    name: nameForId(recipe.output),
    inputs,
    locked,
    enabled: !locked && haveAll && !stationBusy,
    timeS: recipe.time,
  };
}

function backpackState(world: World, playerId: EntityId): PrinterUiState {
  const inventory = world.entities.get(playerId)?.components.inventory;
  const count = (itemId: string): number =>
    inventory ? countInBackpack(world, inventory.slots, itemId) : 0;
  return {
    mode: 'backpack',
    title: 'Backpack printer',
    hint: 'Instant. Print with the materials you carry. Tab closes.',
    station: null,
    rows: recipesForStation('backpack').map((recipe) => rowFor(recipe, count, false)),
  };
}

function stationState(world: World, playerId: EntityId, stationId: EntityId): PrinterUiState | null {
  const player = world.entities.get(playerId);
  const station = world.entities.get(stationId);
  const printer = station ? printerFor(station) : null;
  const machineType = station?.components.machine?.machineType;
  if (!player || !station || !printer || !machineType) return null;
  if (station.planetId !== player.planetId || distance(player.position, station.position) > STATION_RANGE_M) {
    return null;
  }
  const stationDef = placeableForMachineType(machineType);
  const busy = printer.recipeId !== null || printer.outputReady !== null;
  const count = (itemId: string): number => countInStation(world, printer, itemId);
  const jobRecipe = printer.recipeId ? recipeById(printer.recipeId) : undefined;
  const slots: (string | null)[] = printer.inputs.map((id) => {
    const itemId = world.entities.get(id)?.components.item?.itemId;
    return itemId && isKnownItem(itemId) ? itemDef(itemId).name : null;
  });
  while (slots.length < STATION_INPUT_SLOTS) slots.push(null);
  const stationRecipes = recipesForStation(machineType as RecipeStation);
  const acceptsItemIds = [...new Set(stationRecipes.flatMap((recipe) => recipe.inputs.map((input) => input.item)))];
  const paused = station.components.power?.paused === true;
  const hint = printer.outputReady
    ? 'Output ready — press E or Collect.'
    : jobRecipe
      ? paused
        ? 'Paused — no power. Progress resumes when the network can afford it.'
        : `Printing… (${jobRecipe.power} power/s while working)`
      : 'Press E while holding an input to load it. Tab closes.';
  return {
    mode: 'station',
    title: stationDef?.name ?? 'Station',
    hint,
    station: {
      stationId,
      name: stationDef?.name ?? 'Station',
      slots,
      acceptsItemIds,
      job: jobRecipe
        ? {
            name: nameForId(jobRecipe.output),
            // Decisecond precision: the panel key changes ~10x/s while
            // printing instead of every 60 Hz frame.
            progress: Math.round(printer.progressS * 10) / 10,
            time: jobRecipe.time,
          }
        : null,
      outputName: printer.outputReady ? nameForId(printer.outputReady) : null,
    },
    rows: stationRecipes.map((recipe) =>
      rowFor(recipe, count, busy),
    ),
  };
}

/** Pure state projection for the open panel (null = station invalid). */
export function buildPrinterState(
  world: World,
  playerId: EntityId,
  stationId: EntityId | null,
): PrinterUiState | null {
  return stationId ? stationState(world, playerId, stationId) : backpackState(world, playerId);
}

/** Refresh the open panel; closes it when its station/player disappears.
 * Throttled: the panel is a 10 Hz projection, not a per-frame allocation
 * source (the recipe rows are rebuilt each sync). */
const lastUiSync = new WeakMap<PrinterUi, number>();

export function updatePrinterUi(
  world: World,
  playerId: EntityId | null,
  ui: PrinterUi,
  nowMs = performance.now(),
): void {
  if (!ui.isOpen()) {
    lastUiSync.delete(ui);
    return;
  }
  if (!playerId) {
    ui.close();
    lastUiSync.delete(ui);
    return;
  }
  const last = lastUiSync.get(ui) ?? -Infinity;
  if (nowMs - last < PRINTER_UI_SYNC_INTERVAL_MS) return;
  lastUiSync.set(ui, nowMs);
  const state = buildPrinterState(world, playerId, ui.openStationId());
  if (!state) {
    ui.close();
    lastUiSync.delete(ui);
    return;
  }
  ui.sync(state);
}

/** Build the panel controller. Buttons dispatch Actions via the UI command
 * bridge installed by Game (ui/stores/commandsStore.ts). */
export function createPrinterUi(): PrinterUi {
  return new PrinterUi();
}
