// Station printing system (M09): advances active job timers and exposes the
// finished output on the printer component. Power is wired in M10; while
// CRAFTING_REQUIRE_POWER is false every station is considered powered.
//
// Runs after actions in the tick (worldSetup order) so a job started this
// tick already accumulates its first dt, and saves only ever see entities
// with consistent printer state.

import { CRAFTING_REQUIRE_POWER } from '../../core/constants.js';
import { recipeById } from '../../data/loadRecipes.js';
import type { World } from '../world.js';
import { printerFor } from '../craftingActions.js';

export function updateCrafting(world: World, dt: number): void {
  for (const entity of world.entities.values()) {
    if (entity.kind !== 'machine' || !entity.components.printer) continue;
    const printer = printerFor(entity);
    if (!printer || printer.recipeId === null) continue;
    const recipe = recipeById(printer.recipeId);
    if (!recipe) {
      // Catalog entry disappeared (hot JSON edit in dev): drop the job
      // instead of advancing forever.
      printer.recipeId = null;
      printer.progressS = 0;
      continue;
    }
    if (CRAFTING_REQUIRE_POWER && recipe.power > 0 && (entity.components.power?.stored ?? 0) <= 0) {
      continue;
    }
    printer.progressS += dt;
    if (printer.progressS >= recipe.time) {
      printer.recipeId = null;
      printer.progressS = 0;
      printer.outputReady = recipe.output;
    }
  }
}
