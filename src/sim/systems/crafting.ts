// Station printing system (M09/M10): advances active job timers and exposes
// the finished output on the printer component. M10 replaces the temporary
// always-powered flag with the power network's per-machine `paused` bit: a
// brownout freezes the whole job (no partial progress) and it resumes when
// the network can afford it.
//
// Runs after actions and after the power system (worldSetup order) so a job
// started this tick already has a power verdict and accumulates its first dt,
// and saves only ever see entities with consistent printer state.

import { FUEL_BOOST_MULT } from '../../core/constants.js';
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
      printer.boosted = false;
      continue;
    }
    // Missing power components (direct unit-test paths) mean no power system
    // is running: keep the old unpowered behavior instead of freezing jobs.
    if (entity.components.power?.paused === true) continue;
    // M12: a furnace job started with a biomass fuel unit advances at double
    // speed; the flag is cleared when the job completes so it never carries
    // over to the next print.
    printer.progressS += dt * (printer.boosted === true ? FUEL_BOOST_MULT : 1);
    if (printer.progressS >= recipe.time) {
      printer.recipeId = null;
      printer.progressS = 0;
      printer.boosted = false;
      printer.outputReady = recipe.output;
    }
  }
}
