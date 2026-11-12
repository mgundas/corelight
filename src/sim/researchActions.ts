// Research action handlers (M11): buy a tree entry with Data. The tree is
// data-driven (src/data/research.json); this module only validates cost and
// prerequisites, deducts Data, records the entry id and emits the toast event.
// Recipe gating is derived from the entry ids, never stored per recipe.

import { SAMPLE_VALUE_CRUST, STATION_RANGE_M } from '../core/constants.js';
import { events } from '../core/events.js';
import { distance } from '../core/math.js';
import { researchById } from '../data/loadResearch.js';
import type { Entity, EntityId, ResearchComponent } from '../sim/entities.js';
import { inventoryFor } from './inventoryActions.js';
import {
  isResearchEntryUnlocked,
  unlockedRecipes,
  type ResearchState,
} from './researchState.js';
import type { World } from './world.js';

/** Recipe ids unlocked by this world's research (starter recipes excluded). */
export function unlockedRecipesFor(world: World): Set<string> {
  return unlockedRecipes(world.research);
}

/** Cost + prerequisite check without mutating (shared by action and UI). */
export function canUnlockResearch(research: ResearchState, entryId: string): boolean {
  const entry = researchById(entryId);
  if (!entry || isResearchEntryUnlocked(research, entryId)) return false;
  if (research.data < entry.cost) return false;
  for (const req of entry.requires) {
    if (!research.unlocked.includes(req)) return false;
  }
  return true;
}

/** Buy one research entry; rejects unknown, already bought, too costly or
 * prerequisite-blocked ids as ordinary no-ops. */
export function unlockResearch(world: World, playerId: EntityId, entryId: string): void {
  const player = world.entities.get(playerId);
  const entry = researchById(entryId);
  if (!player || player.kind !== 'player' || !entry || !canUnlockResearch(world.research, entryId)) {
    events.emit('actionApplied', { type: 'unlockResearch' });
    return;
  }
  world.research.data -= entry.cost;
  world.research.unlocked.push(entry.id);
  events.emit('researchUnlocked', { id: entry.id, recipeIds: [...entry.recipeIds] });
  events.emit('actionApplied', { type: 'unlockResearch' });
}

/** True for the M11 research station machine. */
export function isResearchStation(entity: Entity | undefined): boolean {
  return (
    entity?.kind === 'machine' &&
    entity.components.machine?.machineType === 'research_station'
  );
}

/** Research component, read-only (null when absent/not a research station). */
export function researchFor(entity: Entity): ResearchComponent | null {
  return isResearchStation(entity) ? (entity.components.research ?? null) : null;
}

/** Sim-side heal for old/hand-made saves (actions/systems only). */
export function ensureResearch(entity: Entity): ResearchComponent | null {
  if (!isResearchStation(entity)) return null;
  let research = entity.components.research;
  if (!research) {
    research = { inputId: null, progressS: 0, dataReady: 0 };
    entity.components.research = research;
  }
  return research;
}

/** Data value of a sample entity (pods store `sample`, node drops `item`). */
export function researchSampleValue(entity: Entity): number {
  const stored = entity.components.sample?.value ?? entity.components.item?.sampleValue;
  return typeof stored === 'number' && Number.isFinite(stored) ? stored : SAMPLE_VALUE_CRUST;
}

function isResearchSample(entity: Entity | undefined): boolean {
  return entity?.components.item?.itemId === 'research_sample';
}

/**
 * Backpack sample E/drag would load: selected slot when it is a sample, else
 * the first sample in the pack (same rule as station inputs).
 */
export function researchSampleCandidate(
  world: World,
  inventory: { slots: (EntityId | null)[]; selectedSlot: number },
): EntityId | null {
  const selected = inventory.slots[inventory.selectedSlot];
  if (selected && isResearchSample(world.entities.get(selected))) return selected;
  for (const id of inventory.slots) {
    if (id && isResearchSample(world.entities.get(id))) return id;
  }
  return null;
}

function nearStation(player: Entity, station: Entity): boolean {
  return (
    player.planetId !== null &&
    player.planetId === station.planetId &&
    distance(player.position, station.position) <= STATION_RANGE_M
  );
}

/** Load one research sample into the station's single analysis slot. */
export function depositResearchSample(
  world: World,
  playerId: EntityId,
  stationId: EntityId,
  slot?: number,
): void {
  const player = world.entities.get(playerId);
  const station = world.entities.get(stationId);
  const inventory = player ? inventoryFor(world, playerId) : null;
  const research = station ? ensureResearch(station) : null;
  if (!player || !station || !inventory || !research || !nearStation(player, station)) {
    events.emit('actionApplied', { type: 'depositResearchSample' });
    return;
  }
  if (research.inputId !== null) {
    events.emit('actionApplied', { type: 'depositResearchSample' });
    return;
  }
  let sampleId: EntityId | null = null;
  if (slot !== undefined) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= inventory.slots.length) {
      events.emit('actionApplied', { type: 'depositResearchSample' });
      return;
    }
    const candidate = inventory.slots[slot];
    if (candidate && isResearchSample(world.entities.get(candidate))) sampleId = candidate;
  } else {
    sampleId = researchSampleCandidate(world, inventory);
  }
  const sample = sampleId ? world.entities.get(sampleId) : undefined;
  if (!sampleId || !sample || !sample.components.item) {
    events.emit('actionApplied', { type: 'depositResearchSample' });
    return;
  }
  const at = inventory.slots.indexOf(sampleId);
  if (at !== -1) inventory.slots[at] = null;
  sample.components.item.holder = stationId;
  // A pod loaded straight from a save/hand-made inventory must also never
  // respawn in the world once it is consumed here.
  if (sample.kind === 'sample') world.depletedSamples.add(sampleId);
  research.inputId = sampleId;
  research.progressS = 0;
  events.emit('actionApplied', { type: 'depositResearchSample' });
}

/** Collect finished Data from the station into the global research pool. */
export function collectResearch(world: World, playerId: EntityId, stationId: EntityId): void {
  const player = world.entities.get(playerId);
  const station = world.entities.get(stationId);
  const research = station ? ensureResearch(station) : null;
  if (
    !player ||
    !station ||
    !research ||
    !Number.isFinite(research.dataReady) ||
    research.dataReady <= 0 ||
    !Number.isFinite(world.research.data) ||
    !nearStation(player, station)
  ) {
    events.emit('actionApplied', { type: 'collectResearch' });
    return;
  }
  const total = world.research.data + research.dataReady;
  if (!Number.isFinite(total)) {
    events.emit('actionApplied', { type: 'collectResearch' });
    return;
  }
  world.research.data = total;
  research.dataReady = 0;
  events.emit('actionApplied', { type: 'collectResearch' });
}

