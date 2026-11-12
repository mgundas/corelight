// Research panel presentation store (M11), mirroring printerStore. The
// controller in ui/researchUi.ts writes the projection; ResearchPanel renders
// it. Presentation only: nothing in the sim reads this store.

import { create } from 'zustand';
import type { ResearchUiState } from '../researchUi.js';

export interface ResearchStoreState {
  open: boolean;
  stationId: string | null;
  view: ResearchUiState | null;
}

export const useResearchStore = create<ResearchStoreState>(() => ({
  open: false,
  stationId: null,
  view: null,
}));

export function resetResearchStore(): void {
  useResearchStore.setState({ open: false, stationId: null, view: null });
}
