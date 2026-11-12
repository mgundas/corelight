// M11 research catalog: the tree from PROJECT.md exists, every gated recipe
// belongs to exactly one entry, costs are sane, and bad data is rejected
// loudly (data-driven content, ARCHITECTURE.md hard rule 8).

import { describe, expect, it } from 'vitest';
import { RECIPES, recipeDef } from '../../src/data/loadRecipes.js';
import {
  RESEARCH_ENTRIES,
  isKnownResearch,
  loadResearch,
  parseResearchEntry,
  researchById,
  unlockedRecipeIds,
} from '../../src/data/loadResearch.js';

const VALID_ENTRY = {
  id: 'test_entry',
  name: 'Test entry',
  description: 'A test unlock.',
  recipeIds: ['solar_panel'],
  cost: 20,
  requires: [],
};

describe('research catalog', () => {
  it('contains the PROJECT.md unlock tree', () => {
    const ids = RESEARCH_ENTRIES.map((entry) => entry.id);
    for (const id of [
      'power_basics',
      'smelting',
      'adv_printing',
      'drill_mk2',
      'drill_mk3',
      'fuel_refining',
      'spaceflight',
      'outpost',
    ]) {
      expect(ids, id).toContain(id);
    }
    const byId = new Map(RESEARCH_ENTRIES.map((entry) => [entry.id, entry]));
    expect(byId.get('power_basics')?.recipeIds).toEqual(['solar_panel', 'battery']);
    expect(byId.get('drill_mk3')?.requires).toEqual(['drill_mk2']);
    expect(byId.get('spaceflight')?.requires).toEqual(['fuel_refining', 'adv_printing']);
    expect(byId.get('outpost')?.requires).toEqual(['adv_printing']);
    // The research station itself is the bootstrap: unlocked by default.
    expect(recipeDef('research_station').unlockedByDefault).toBe(true);
  });

  it('covers every gated recipe exactly once and no starter recipe', () => {
    const owner = new Map<string, string>();
    for (const entry of RESEARCH_ENTRIES) {
      for (const recipeId of entry.recipeIds) {
        expect(owner.has(recipeId), recipeId).toBe(false);
        owner.set(recipeId, entry.id);
        expect(recipeDef(recipeId).unlockedByDefault, recipeId).toBe(false);
      }
    }
    const gated = RECIPES.filter((recipe) => !recipe.unlockedByDefault).map((recipe) => recipe.id);
    for (const id of gated) expect(owner.has(id), id).toBe(true);
    expect(owner.size).toBe(gated.length);
  });

  it('costs roughly 15 samples across the full tree', () => {
    const total = RESEARCH_ENTRIES.reduce((sum, entry) => sum + entry.cost, 0);
    // Crust/mantle samples are worth 10/20 (core 40), so 150-250 total puts
    // the full tree around 15 mixed samples.
    expect(total).toBeGreaterThanOrEqual(150);
    expect(total).toBeLessThanOrEqual(250);
    for (const entry of RESEARCH_ENTRIES) expect(entry.cost).toBeGreaterThan(0);
  });

  it('resolves entry and recipe lookups', () => {
    expect(isKnownResearch('power_basics')).toBe(true);
    expect(isKnownResearch('nope')).toBe(false);
    expect(researchById('smelting')?.name).toBe('Smelting');
    expect(researchById('nope')).toBeUndefined();
    const unlocked = unlockedRecipeIds(['power_basics', 'unknown_entry']);
    expect([...unlocked].sort()).toEqual(['battery', 'solar_panel']);
    expect(unlockedRecipeIds([]).size).toBe(0);
  });

  it('rejects bad research data with clear errors', () => {
    expect(() => loadResearch(null)).toThrow();
    expect(() => parseResearchEntry({ ...VALID_ENTRY, id: 'Bad Id' })).toThrow();
    expect(() => parseResearchEntry({ ...VALID_ENTRY, name: '' })).toThrow();
    expect(() => parseResearchEntry({ ...VALID_ENTRY, description: '' })).toThrow();
    expect(() => parseResearchEntry({ ...VALID_ENTRY, cost: 0 })).toThrow();
    expect(() => parseResearchEntry({ ...VALID_ENTRY, cost: 1.5 })).toThrow();
    expect(() => parseResearchEntry({ ...VALID_ENTRY, recipeIds: [] })).toThrow();
    expect(() => parseResearchEntry({ ...VALID_ENTRY, recipeIds: ['nope'] })).toThrow();
    // Starter recipes must not be sold by the tree.
    expect(() => parseResearchEntry({ ...VALID_ENTRY, recipeIds: ['platform'] })).toThrow();
    expect(() => parseResearchEntry({ ...VALID_ENTRY, recipeIds: ['solar_panel', 'solar_panel'] })).toThrow();
    expect(() => parseResearchEntry({ ...VALID_ENTRY, requires: ['test_entry'] })).toThrow();
    expect(() => loadResearch([VALID_ENTRY, VALID_ENTRY])).toThrow();
  });

  it('rejects dangling requirements, duplicate recipe owners and cycles', () => {
    expect(() => loadResearch([{ ...VALID_ENTRY, requires: ['missing'] }])).toThrow();
    const second = {
      ...VALID_ENTRY,
      id: 'second',
      name: 'Second',
      recipeIds: ['battery'],
    };
    expect(() => loadResearch([VALID_ENTRY, { ...second, recipeIds: ['solar_panel'] }])).toThrow();
    const cycleA = { ...VALID_ENTRY, requires: ['cycle_b'] };
    const cycleB = { ...VALID_ENTRY, id: 'cycle_b', name: 'Cycle B', recipeIds: ['battery'], requires: ['test_entry'] };
    expect(() => loadResearch([cycleA, cycleB])).toThrow(/cycle/i);
  });
});
