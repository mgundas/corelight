// Research station system (M11): advances one sample through a 20 s analysis
// and exposes the resulting Data on the station. Power is consumed through
// the M10 network (RESEARCH_POWER); a brownout freezes the whole job exactly
// like a paused printer. Runs after updatePower in the tick order.

import { RESEARCH_TIME_S } from '../../core/constants.js';
import { ensureResearch, isResearchStation, researchSampleValue } from '../researchActions.js';
import type { World } from '../world.js';

export function updateResearch(world: World, dt: number): void {
  if (!(dt > 0)) return;
  for (const entity of world.entities.values()) {
    if (!isResearchStation(entity)) continue;
    const research = ensureResearch(entity);
    if (!research || research.inputId === null) continue;
    const sample = world.entities.get(research.inputId);
    if (!sample || sample.components.item?.itemId !== 'research_sample') {
      // Stale id (hand-made save or external deletion): drop the job cleanly.
      research.inputId = null;
      research.progressS = 0;
      continue;
    }
    // Missing power components mean no power system is installed (direct
    // unit-test path): keep the old unpowered behavior like crafting does.
    if (entity.components.power?.paused === true) continue;
    research.progressS += dt;
    if (research.progressS >= RESEARCH_TIME_S) {
      research.dataReady += researchSampleValue(sample);
      world.entities.delete(sample.id);
      research.inputId = null;
      research.progressS = 0;
    }
  }
}
