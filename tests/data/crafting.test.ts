// M09 data catalogs: every PROJECT.md recipe is present, placeables are
// well-formed, and bad JSON is rejected with clear errors (data-driven
// content, ARCHITECTURE.md hard rule 8).

import { describe, expect, it } from 'vitest';
import { ITEMS, isKnownItem } from '../../src/data/loadData.js';
import {
  PLACEABLES,
  isPlaceable,
  loadPlaceables,
  parsePlaceableDef,
  placeableDef,
  placeableForMachineType,
  placeableForPackageItem,
} from '../../src/data/loadPlaceables.js';
import {
  RECIPES,
  isKnownRecipe,
  isRecipeUnlocked,
  loadRecipes,
  parseRecipeDef,
  recipeDef,
  recipesForStation,
} from '../../src/data/loadRecipes.js';

const VALID_RECIPE = {
  id: 'test_recipe',
  station: 'small_printer',
  output: 'platform',
  inputs: [{ item: 'silicate', count: 2 }],
  time: 2,
  power: 1,
  unlockedByDefault: true,
};

const VALID_PLACEABLE = {
  id: 'test_placeable',
  name: 'Test placeable',
  size: 'large',
  packageItem: 'platform_package',
  entityKind: 'platform',
  machineType: null,
  model: 'platform',
  footprintRadiusM: 2,
  heightM: 1,
  snapPoints: [{ x: 0, y: 0, z: 0 }],
  description: 'A test slab.',
};

describe('recipe catalog', () => {
  it('contains every recipe from PROJECT.md', () => {
    const ids = new Set(RECIPES.map((r) => r.id));
    for (const id of [
      'tether',
      'light_stick',
      'oxygen_canister',
      'platform',
      'solar_panel',
      'battery',
      'furnace',
      'research_station',
      'medium_printer',
      'drill_mk2',
      'smelt_iron',
      'smelt_copper',
      'polymer',
      'drill_mk3',
      'refinery',
      'shuttle',
      'habitat_kit',
      'fuel_cell_biomass',
      'fuel_cell_hydrite',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
    // Costs come from PROJECT.md.
    expect(recipeDef('tether').inputs).toEqual([{ item: 'resin', count: 1 }]);
    expect(recipeDef('oxygen_canister').inputs).toEqual([
      { item: 'resin', count: 1 },
      { item: 'silicate', count: 1 },
    ]);
    expect(recipeDef('platform').inputs).toEqual([{ item: 'silicate', count: 2 }]);
    expect(recipeDef('shuttle').inputs).toEqual([
      { item: 'iron', count: 4 },
      { item: 'copper', count: 2 },
      { item: 'polymer', count: 2 },
    ]);
    expect(recipeDef('fuel_cell_biomass').output).toBe('fuel_cell');
    expect(recipeDef('fuel_cell_hydrite').output).toBe('fuel_cell');
    // Starter set from PROJECT.md: backpack recipes + platform, plus M11's
    // research station (the bootstrap for the research tree).
    const unlocked = RECIPES.filter((recipe) => isRecipeUnlocked(recipe, new Set())).map((r) => r.id).sort();
    expect(unlocked).toEqual(['light_stick', 'oxygen_canister', 'platform', 'research_station', 'tether']);
    // M12 furnace: every smelt takes 10 s at 2 power/s (PROJECT.md).
    for (const id of ['smelt_iron', 'smelt_copper', 'polymer']) {
      expect(recipeDef(id).station, id).toBe('furnace');
      expect(recipeDef(id).time, id).toBe(10);
      expect(recipeDef(id).power, id).toBe(2);
    }
    // M12: ore maps to the matching metal; resin to polymer.
    expect(recipeDef('smelt_iron').output).toBe('iron');
    expect(recipeDef('smelt_copper').output).toBe('copper');
    expect(recipeDef('polymer').output).toBe('polymer');
    // Backpack printing is instant and manual.
    for (const recipe of recipesForStation('backpack')) {
      expect(recipe.time).toBe(0);
      expect(recipe.power).toBe(0);
    }
  });

  it('looks recipes up and groups them by station', () => {
    expect(recipeDef('platform').station).toBe('small_printer');
    expect(isKnownRecipe('nope')).toBe(false);
    expect(recipesForStation('furnace').map((r) => r.id)).toEqual([
      'smelt_iron',
      'smelt_copper',
      'polymer',
    ]);
    // M12 task 2: the medium printer offers the larger blueprints.
    expect(recipesForStation('medium_printer').map((r) => r.id)).toEqual([
      'drill_mk3',
      'refinery',
      'shuttle',
      'habitat_kit',
    ]);
  });

  it('rejects bad recipe data with clear errors', () => {
    expect(() => loadRecipes(null)).toThrow();
    expect(() => parseRecipeDef({ ...VALID_RECIPE, id: 'Bad Id' })).toThrow();
    expect(() => parseRecipeDef({ ...VALID_RECIPE, station: 'orbital' })).toThrow();
    expect(() => parseRecipeDef({ ...VALID_RECIPE, output: 'unobtanium' })).toThrow();
    expect(() => parseRecipeDef({ ...VALID_RECIPE, output: 'iron' })).not.toThrow();
    expect(() => parseRecipeDef({ ...VALID_RECIPE, inputs: [] })).toThrow();
    expect(() => parseRecipeDef({ ...VALID_RECIPE, inputs: [{ item: 'resin', count: 0 }] })).toThrow();
    expect(() =>
      parseRecipeDef({
        ...VALID_RECIPE,
        inputs: [
          { item: 'resin', count: 1 },
          { item: 'resin', count: 1 },
        ],
      }),
    ).toThrow();
    expect(() => parseRecipeDef({ ...VALID_RECIPE, time: -1 })).toThrow();
    expect(() => parseRecipeDef({ ...VALID_RECIPE, power: -1 })).toThrow();
    expect(() => parseRecipeDef({ ...VALID_RECIPE, unlockedByDefault: 'yes' })).toThrow();
    expect(() => parseRecipeDef({ ...VALID_RECIPE, station: 'backpack', time: 1 })).toThrow();
    expect(() => parseRecipeDef({ ...VALID_RECIPE, station: 'backpack', power: 1 })).toThrow();
    expect(() => loadRecipes([VALID_RECIPE, VALID_RECIPE])).toThrow();
  });
});

describe('placeable catalog', () => {
  it('defines every PROJECT.md placeable with a packaged item', () => {
    for (const id of [
      'platform',
      'small_printer',
      'solar_panel',
      'battery',
      'furnace',
      'research_station',
      'medium_printer',
      'refinery',
      'shuttle',
      'habitat_kit',
    ]) {
      expect(isPlaceable(id), id).toBe(true);
      const def = placeableDef(id);
      expect(isKnownItem(def.packageItem), def.packageItem).toBe(true);
      expect(def.footprintRadiusM).toBeGreaterThan(0);
      expect(def.heightM).toBeGreaterThan(0);
      expect(def.snapPoints.length).toBeGreaterThan(0);
    }
    // Carry rule inputs: platform is large (front carry), the printer small.
    expect(placeableDef('platform').size).toBe('large');
    expect(placeableDef('small_printer').size).toBe('small');
    // M10: platforms carry four rim cable snaps and four top machine slots.
    expect(placeableDef('platform').snapPoints).toHaveLength(4);
    expect(placeableDef('platform').slots).toHaveLength(4);
    // M12: the medium printer is the larger-footprint tier.
    expect(placeableDef('medium_printer').footprintRadiusM).toBeGreaterThan(
      placeableDef('small_printer').footprintRadiusM,
    );
    expect(placeableDef('medium_printer').size).toBe('large');
    // Machines have no top slots (they are not platforms).
    expect(placeableDef('small_printer').slots).toEqual([]);
    // Back-reference helpers used by carry/render code.
    expect(placeableForPackageItem('platform_package')?.id).toBe('platform');
    expect(placeableForMachineType('small_printer')?.id).toBe('small_printer');
    expect(placeableForPackageItem('resin')).toBeUndefined();
  });

  it('rejects bad placeable data with clear errors', () => {
    expect(() => loadPlaceables(null)).toThrow();
    expect(() => parsePlaceableDef({ ...VALID_PLACEABLE, id: 'Bad Id' })).toThrow();
    expect(() => parsePlaceableDef({ ...VALID_PLACEABLE, size: 'huge' })).toThrow();
    expect(() => parsePlaceableDef({ ...VALID_PLACEABLE, packageItem: 'nope' })).toThrow();
    expect(() => parsePlaceableDef({ ...VALID_PLACEABLE, entityKind: 'rock' })).toThrow();
    expect(() => parsePlaceableDef({ ...VALID_PLACEABLE, machineType: 'Bad Type' })).toThrow();
    expect(() => parsePlaceableDef({ ...VALID_PLACEABLE, model: 'castle' })).toThrow();
    expect(() => parsePlaceableDef({ ...VALID_PLACEABLE, footprintRadiusM: 0 })).toThrow();
    expect(() => parsePlaceableDef({ ...VALID_PLACEABLE, heightM: -1 })).toThrow();
    expect(() => parsePlaceableDef({ ...VALID_PLACEABLE, snapPoints: [{ x: 0, y: Number.NaN, z: 0 }] })).toThrow();
    expect(() => parsePlaceableDef({ ...VALID_PLACEABLE, slots: 'nope' })).toThrow();
    expect(() => parsePlaceableDef({ ...VALID_PLACEABLE, slots: [{ x: 0, y: Number.NaN, z: 0 }] })).toThrow();
    expect(() => parsePlaceableDef({ ...VALID_PLACEABLE, description: '' })).toThrow();
    expect(() => loadPlaceables([VALID_PLACEABLE, VALID_PLACEABLE])).toThrow();
    // Missing slots are valid (machines have none) and default to [].
    expect(parsePlaceableDef(VALID_PLACEABLE).slots).toEqual([]);
  });
});

describe('catalog cross-references', () => {
  it('every placeable package item is in the item catalog', () => {
    const itemIds = new Set(ITEMS.map((def) => def.id));
    for (const def of PLACEABLES) expect(itemIds.has(def.packageItem), def.id).toBe(true);
  });
});
