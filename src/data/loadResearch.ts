// Research tree catalog (M11): unlock entries bought with Data at the
// research station. JSON is the only place the tree lives (ARCHITECTURE.md
// hard rule 8); validation rejects dangling recipes/requirements, duplicate
// recipe assignments and cycles at load.
//
// Identity: an entry id is the stable save key (`world.research.unlocked`).
// Recipe ids are the existing recipe catalog ids, so unlocking never needs a
// new item/placeable definition.

import rawResearch from './research.json' with { type: 'json' };
import { RECIPES, isKnownRecipe } from './loadRecipes.js';

export interface ResearchEntry {
  id: string;
  name: string;
  description: string;
  /** Recipe ids this entry unlocks (each recipe belongs to exactly one entry). */
  recipeIds: string[];
  /** Data cost, a positive integer. */
  cost: number;
  /** Entry ids that must be unlocked first. */
  requires: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isIdList(v: unknown, field: string, id: string): string[] {
  if (!Array.isArray(v)) throw new Error(`bad research ${id}: ${field} must be an array`);
  for (const entry of v) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error(`bad research ${id}: ${field} entries must be non-empty strings`);
    }
  }
  return [...v];
}

/** Validate one raw entry; throws a clear error naming the bad field. */
export function parseResearchEntry(data: unknown): ResearchEntry {
  if (!isRecord(data)) throw new Error('bad research: entry is not an object');
  const { id, name, description, recipeIds, cost, requires } = data;
  if (typeof id !== 'string' || !/^[a-z0-9_]+$/.test(id)) {
    throw new Error(`bad research: id must be lowercase snake_case, got ${String(id)}`);
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`bad research ${id}: name missing`);
  }
  if (typeof description !== 'string' || description.length === 0) {
    throw new Error(`bad research ${id}: description missing`);
  }
  if (typeof cost !== 'number' || !Number.isInteger(cost) || cost <= 0) {
    throw new Error(`bad research ${id}: cost must be a positive integer`);
  }
  const parsedRecipeIds = isIdList(recipeIds, 'recipeIds', id);
  if (parsedRecipeIds.length === 0) {
    throw new Error(`bad research ${id}: recipeIds must not be empty`);
  }
  const seenRecipes = new Set<string>();
  for (const recipeId of parsedRecipeIds) {
    if (!isKnownRecipe(recipeId)) {
      throw new Error(`bad research ${id}: unknown recipe ${recipeId}`);
    }
    if (seenRecipes.has(recipeId)) throw new Error(`bad research ${id}: duplicate recipe ${recipeId}`);
    seenRecipes.add(recipeId);
    const recipe = RECIPES.find((r) => r.id === recipeId);
    if (recipe?.unlockedByDefault) {
      throw new Error(`bad research ${id}: recipe ${recipeId} is already unlocked by default`);
    }
  }
  const parsedRequires = isIdList(requires, 'requires', id);
  if (parsedRequires.includes(id)) throw new Error(`bad research ${id}: cannot require itself`);
  if (new Set(parsedRequires).size !== parsedRequires.length) {
    throw new Error(`bad research ${id}: duplicate requirement`);
  }
  return {
    id,
    name,
    description,
    recipeIds: parsedRecipeIds,
    cost,
    requires: parsedRequires,
  };
}

/** Cycle walk for the requires graph (throws on a cycle). */
function assertAcyclic(entries: Map<string, ResearchEntry>): void {
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`bad research: dependency cycle ${[...path, id].join(' -> ')}`);
    }
    const entry = entries.get(id);
    if (!entry) return;
    visiting.add(id);
    for (const req of entry.requires) visit(req, [...path, id]);
    visiting.delete(id);
    done.add(id);
  };
  for (const id of entries.keys()) visit(id, []);
}

/** Validate a raw JSON array into a definition list (duplicate ids throw). */
export function loadResearch(data: unknown): ResearchEntry[] {
  if (!Array.isArray(data)) throw new Error('bad research.json: top level must be an array');
  const entries = data.map(parseResearchEntry);
  const byId = new Map<string, ResearchEntry>();
  for (const entry of entries) {
    if (byId.has(entry.id)) throw new Error(`bad research.json: duplicate id ${entry.id}`);
    byId.set(entry.id, entry);
  }
  const recipeOwner = new Map<string, string>();
  for (const entry of entries) {
    for (const recipeId of entry.recipeIds) {
      const owner = recipeOwner.get(recipeId);
      if (owner) {
        throw new Error(`bad research.json: recipe ${recipeId} is in both ${owner} and ${entry.id}`);
      }
      recipeOwner.set(recipeId, entry.id);
    }
    for (const req of entry.requires) {
      if (!byId.has(req)) throw new Error(`bad research ${entry.id}: unknown requirement ${req}`);
    }
  }
  assertAcyclic(byId);
  return entries;
}

/** Validated catalog, loaded once at startup (throws loudly on bad data). */
export const RESEARCH_ENTRIES: ResearchEntry[] = loadResearch(rawResearch as unknown[]);

const byId = new Map<string, ResearchEntry>(RESEARCH_ENTRIES.map((entry) => [entry.id, entry]));

/** Non-throwing lookup for UI/render data that may outlive a JSON edit. */
export function researchById(id: string): ResearchEntry | undefined {
  return byId.get(id);
}

/** True for ids the catalog defines. */
export function isKnownResearch(id: string): boolean {
  return byId.has(id);
}

/**
 * Recipes unlocked by a list of entry ids. Unknown/stale ids are ignored so a
 * data edit (or a hand-edited save) can never make the catalog throw.
 */
export function unlockedRecipeIds(unlockedEntryIds: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const id of unlockedEntryIds) {
    const entry = byId.get(id);
    if (!entry) continue;
    for (const recipeId of entry.recipeIds) out.add(recipeId);
  }
  return out;
}
