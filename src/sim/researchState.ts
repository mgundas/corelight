// Research progression state (M11). Lives on the World and is part of the
// save (v3). `data` is the spendable currency; `unlocked` stores research
// entry ids from src/data/research.json. Recipe gating is derived from those
// ids, so adding/reordering data never changes what a save means.

import { unlockedRecipeIds } from '../data/loadResearch.js';

export interface ResearchState {
  /** Unspent Data. */
  data: number;
  /** Unlocked research entry ids, in unlock order. */
  unlocked: string[];
}

/** Recipe ids unlocked by the research state (starter recipes excluded). */
export function unlockedRecipes(research: ResearchState): Set<string> {
  return unlockedRecipeIds(research.unlocked);
}

/** True when a research entry has already been bought. */
export function isResearchEntryUnlocked(research: ResearchState, entryId: string): boolean {
  return research.unlocked.includes(entryId);
}
