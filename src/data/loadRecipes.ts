// Recipe catalog (M09): every craftable from PROJECT.md, validated at load.
// Changing costs/times/outputs is a JSON-only edit (ARCHITECTURE.md hard
// rule 8). M11 adds research progression: every caller goes through
// isRecipeUnlocked(recipe, unlockedRecipeSet) so starter recipes stay
// available and everything else is gated by the research tree.

import rawRecipes from './recipes.json' with { type: 'json' };
import { isKnownItem } from './loadData.js';
import { isPlaceable } from './loadPlaceables.js';

export type RecipeStation = 'backpack' | 'small_printer' | 'medium_printer' | 'furnace' | 'refinery';

const STATIONS: ReadonlySet<string> = new Set([
  'backpack',
  'small_printer',
  'medium_printer',
  'furnace',
  'refinery',
]);

export interface RecipeInput {
  item: string;
  count: number;
}

export interface RecipeDef {
  id: string;
  station: RecipeStation;
  /** Item id or placeable id. */
  output: string;
  inputs: RecipeInput[];
  /** Seconds a station job takes (0 = instant). */
  time: number;
  /** Power per second while printing (0 = none). M10 consumes this. */
  power: number;
  unlockedByDefault: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseInput(data: unknown, id: string, index: number): RecipeInput {
  if (!isRecord(data)) throw new Error(`bad recipe ${id}: inputs[${index}] must be an object`);
  const { item, count } = data;
  if (typeof item !== 'string' || !isKnownItem(item)) {
    throw new Error(`bad recipe ${id}: inputs[${index}].item must be a known item id`);
  }
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    throw new Error(`bad recipe ${id}: inputs[${index}].count must be an integer >= 1`);
  }
  return { item, count };
}

/** Validate one raw entry; throws a clear error naming the bad field. */
export function parseRecipeDef(data: unknown): RecipeDef {
  if (!isRecord(data)) throw new Error('bad recipe: entry is not an object');
  const { id, station, output, inputs, time, power, unlockedByDefault } = data;
  if (typeof id !== 'string' || !/^[a-z0-9_]+$/.test(id)) {
    throw new Error(`bad recipe: id must be lowercase snake_case, got ${String(id)}`);
  }
  if (typeof station !== 'string' || !STATIONS.has(station)) {
    throw new Error(`bad recipe ${id}: station must be one of ${[...STATIONS].join('|')}`);
  }
  if (typeof output !== 'string' || (!isKnownItem(output) && !isPlaceable(output))) {
    throw new Error(`bad recipe ${id}: output must be a known item or placeable id`);
  }
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error(`bad recipe ${id}: inputs must be a non-empty array`);
  }
  const parsedInputs = inputs.map((input, i) => parseInput(input, id, i));
  const seenInputs = new Set<string>();
  for (const input of parsedInputs) {
    if (seenInputs.has(input.item)) {
      throw new Error(`bad recipe ${id}: duplicate input ${input.item} (merge the counts)`);
    }
    seenInputs.add(input.item);
  }
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
    throw new Error(`bad recipe ${id}: time must be a finite number >= 0`);
  }
  if (typeof power !== 'number' || !Number.isFinite(power) || power < 0) {
    throw new Error(`bad recipe ${id}: power must be a finite number >= 0`);
  }
  if (typeof unlockedByDefault !== 'boolean') {
    throw new Error(`bad recipe ${id}: unlockedByDefault must be a boolean`);
  }
  // Backpack printing is instant and manual (PROJECT.md): keep bad data from
  // silently introducing a timed or powered hand-craft.
  if (station === 'backpack' && (time !== 0 || power !== 0)) {
    throw new Error(`bad recipe ${id}: backpack recipes must have time 0 and power 0`);
  }
  return {
    id,
    station: station as RecipeStation,
    output,
    inputs: parsedInputs,
    time,
    power,
    unlockedByDefault,
  };
}

/** Validate a raw JSON array into a definition list (duplicate ids throw). */
export function loadRecipes(data: unknown): RecipeDef[] {
  if (!Array.isArray(data)) throw new Error('bad recipes.json: top level must be an array');
  const defs = data.map(parseRecipeDef);
  const seen = new Set<string>();
  for (const def of defs) {
    if (seen.has(def.id)) throw new Error(`bad recipes.json: duplicate id ${def.id}`);
    seen.add(def.id);
  }
  return defs;
}

/** Validated catalog, loaded once at startup (throws loudly on bad data). */
export const RECIPES: RecipeDef[] = loadRecipes(rawRecipes as unknown[]);

const byId = new Map<string, RecipeDef>(RECIPES.map((def) => [def.id, def]));
const byStation = new Map<RecipeStation, RecipeDef[]>();
for (const def of RECIPES) {
  const list = byStation.get(def.station) ?? [];
  list.push(def);
  byStation.set(def.station, list);
}

/** Look a definition up by id (throws on unknown ids). */
export function recipeDef(id: string): RecipeDef {
  const def = byId.get(id);
  if (!def) throw new Error(`unknown recipe id: ${id}`);
  return def;
}

/** Non-throwing lookup for UI/render data that may outlive a JSON edit. */
export function recipeById(id: string): RecipeDef | undefined {
  return byId.get(id);
}

/** True for ids the catalog defines. */
export function isKnownRecipe(id: string): boolean {
  return byId.has(id);
}

/** Recipes offered by one station, in catalog order. */
export function recipesForStation(station: RecipeStation): RecipeDef[] {
  return byStation.get(station) ?? [];
}

/** Stable empty set for callers that only need the starter recipes. */
const STARTER_ONLY: ReadonlySet<string> = new Set<string>();

/**
 * M11 locking: starter recipes are always available; everything else needs
 * its research entry. `unlockedRecipes` is the recipe-id set built from
 * `world.research.unlocked` (data/loadResearch.ts), so every caller stays a
 * pure lookup and the World never leaks into the data layer.
 */
export function isRecipeUnlocked(
  recipe: RecipeDef,
  unlockedRecipes: ReadonlySet<string> = STARTER_ONLY,
): boolean {
  return recipe.unlockedByDefault || unlockedRecipes.has(recipe.id);
}
