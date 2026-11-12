// Research panel projection (M11). Per-frame read-only view of World state:
// the tree with costs/prerequisite states, Data balance, the station's single
// sample slot and analysis progress. Mutations still go through Actions
// dispatched by the UI command bridge or the E chain.

import { RESEARCH_UI_SYNC_INTERVAL_MS, RESEARCH_TIME_S, STATION_RANGE_M } from '../core/constants.js';
import { distance } from '../core/math.js';
import { isKnownItem, itemDef } from '../data/loadData.js';
import { placeableForMachineType } from '../data/loadPlaceables.js';
import { RESEARCH_ENTRIES, researchById } from '../data/loadResearch.js';
import type { EntityId } from '../sim/entities.js';
import { canUnlockResearch, isResearchStation, researchFor } from '../sim/researchActions.js';
import type { World } from '../sim/world.js';
import type { ResearchRow, ResearchUi, ResearchUiState } from '../ui/researchUi.js';

function sampleName(world: World, id: EntityId | null): string | null {
  if (!id) return null;
  const itemId = world.entities.get(id)?.components.item?.itemId;
  return itemId && isKnownItem(itemId) ? itemDef(itemId).name : 'Sample';
}

function rowsFor(world: World): ResearchRow[] {
  return RESEARCH_ENTRIES.map((entry) => {
    const unlocked = world.research.unlocked.includes(entry.id);
    const requires = entry.requires.map((id) => researchById(id)?.name ?? id);
    const requiresMet = entry.requires.every((id) => world.research.unlocked.includes(id));
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      cost: entry.cost,
      requires,
      state: unlocked ? 'unlocked' : requiresMet ? 'available' : 'locked',
      enabled: canUnlockResearch(world.research, entry.id),
    };
  });
}

/** Pure state projection for the open panel (null = station invalid). */
export function buildResearchState(
  world: World,
  playerId: EntityId,
  stationId: EntityId,
): ResearchUiState | null {
  const player = world.entities.get(playerId);
  const station = world.entities.get(stationId);
  if (!player || !station || !isResearchStation(station)) return null;
  if (station.planetId !== player.planetId) return null;
  if (distance(player.position, station.position) > STATION_RANGE_M) return null;
  const research = researchFor(station);
  if (!research) return null;
  const def = placeableForMachineType('research_station');
  const paused = station.components.power?.paused === true;
  const hint = research.dataReady > 0
    ? 'Analysis complete — press E or Collect.'
    : research.inputId
      ? paused
        ? 'Paused — no power. Progress resumes when the network can afford it.'
        : 'Analyzing… one sample at a time (1 power/s).'
      : 'Press E while holding a sample, or drag one into the slot. Tab closes.';
  return {
    title: def?.name ?? 'Research station',
    hint,
    data: world.research.data,
    station: {
      stationId,
      name: def?.name ?? 'Research station',
      slots: [sampleName(world, research.inputId)],
      acceptsItemIds: ['research_sample'],
      hasInput: research.inputId !== null,
      // Decisecond precision: the panel key changes ~10x/s while analyzing.
      progressS: Math.round(research.progressS * 10) / 10,
      timeS: RESEARCH_TIME_S,
      dataReady: research.dataReady,
      paused,
    },
    rows: rowsFor(world),
  };
}

/** Refresh the open panel; closes it when its station/player disappears.
 * Throttled like the printer panel (a 10 Hz projection, not per frame). */
const lastUiSync = new WeakMap<ResearchUi, number>();

export function updateResearchUi(
  world: World,
  playerId: EntityId | null,
  ui: ResearchUi,
  nowMs = performance.now(),
): void {
  if (!ui.isOpen()) {
    lastUiSync.delete(ui);
    return;
  }
  const stationId = ui.openStationId();
  if (!playerId || !stationId) {
    ui.close();
    lastUiSync.delete(ui);
    return;
  }
  const last = lastUiSync.get(ui) ?? -Infinity;
  if (nowMs - last < RESEARCH_UI_SYNC_INTERVAL_MS) return;
  lastUiSync.set(ui, nowMs);
  const state = buildResearchState(world, playerId, stationId);
  if (!state) {
    ui.close();
    lastUiSync.delete(ui);
    return;
  }
  ui.sync(state);
}
