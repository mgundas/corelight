// Research panel controller (M11, React port). Keeps the World read-only:
// game/researchWiring builds a projection, this controller writes it to the
// zustand store, and ResearchPanel renders it. Unlock buttons dispatch
// Actions through the UI command bridge.
//
// The prompt named this file src/ui/researchUi.ts; per M10.5 the actual DOM
// is React (ResearchPanel.tsx), so this keeps the name as the presentation
// controller while the projection lives beside the printer's in game/.

import { isKnownItem, itemDef } from '../data/loadData.js';
import { placeableById } from '../data/loadPlaceables.js';
import { resetResearchStore, useResearchStore } from './stores/researchStore.js';

export type ResearchRowState = 'unlocked' | 'available' | 'locked';

export interface ResearchRow {
  id: string;
  name: string;
  description: string;
  cost: number;
  /** Names of prerequisite entries (empty when available). */
  requires: string[];
  state: ResearchRowState;
  /** Available and affordable right now. */
  enabled: boolean;
}

export interface ResearchStationPanel {
  stationId: string;
  name: string;
  /** Sample name in the single analysis slot (null = empty). */
  slots: (string | null)[];
  /** Item ids the slot accepts (drag validation). */
  acceptsItemIds: string[];
  hasInput: boolean;
  progressS: number;
  timeS: number;
  dataReady: number;
  paused: boolean;
}

export interface ResearchUiState {
  title: string;
  hint: string;
  /** Unspent Data (global progression, shown beside the tree). */
  data: number;
  station: ResearchStationPanel;
  rows: ResearchRow[];
}

export class ResearchUi {
  isOpen(): boolean {
    return useResearchStore.getState().open;
  }

  openStationId(): string | null {
    return useResearchStore.getState().stationId;
  }

  openStation(stationId: string): void {
    useResearchStore.setState({ open: true, stationId, view: null });
  }

  close(): void {
    useResearchStore.setState({ open: false, stationId: null, view: null });
  }

  /** Reconcile the panel with a fresh read-only state snapshot. */
  sync(state: ResearchUiState): void {
    if (!this.isOpen()) return;
    useResearchStore.setState({ view: state });
  }

  dispose(): void {
    resetResearchStore();
  }
}

/** Human name for a recipe output id (item or placeable). */
function nameForId(id: string): string {
  if (isKnownItem(id)) return itemDef(id).name;
  return placeableById(id)?.name ?? id;
}

/** "New blueprint: Solar panel" / "New blueprints: Solar panel, Battery". */
export function unlockToastText(recipeIds: readonly string[]): string {
  const names = recipeIds.map(nameForId);
  if (names.length === 0) return 'New blueprint unlocked';
  if (names.length === 1) return `New blueprint: ${names[0]}`;
  return `New blueprints: ${names.join(', ')}`;
}
