// Printer panel controller (React port). Keeps the small API Game and
// printerWiring already use (isOpen/open/close/sync) but writes the zustand
// store instead of touching DOM. The React PrinterPanel renders it.
// Read-only over the World; handlers dispatch Actions in Game.

import { resetPrinterStore, usePrinterStore } from './stores/printerStore.js';

export interface PrinterRowInput {
  name: string;
  need: number;
  have: number;
}

export interface PrinterRow {
  recipeId: string;
  name: string;
  inputs: PrinterRowInput[];
  locked: boolean;
  enabled: boolean;
  timeS: number;
}

export interface StationPanel {
  stationId: string;
  name: string;
  /** Loaded input item names, padded with null to the station's input slots. */
  slots: (string | null)[];
  /** Item ids this station's recipes consume (drag-and-drop validation). */
  acceptsItemIds: string[];
  job: { name: string; progress: number; time: number } | null;
  outputName: string | null;
}

export interface PrinterUiState {
  mode: 'backpack' | 'station';
  title: string;
  hint: string;
  station: StationPanel | null;
  rows: PrinterRow[];
}

export class PrinterUi {
  isOpen(): boolean {
    return usePrinterStore.getState().open;
  }

  /** Station id while showing a station panel, null for the backpack. */
  openStationId(): string | null {
    const state = usePrinterStore.getState();
    return state.mode === 'station' ? state.stationId : null;
  }

  openBackpack(): void {
    usePrinterStore.setState({ open: true, mode: 'backpack', stationId: null, view: null });
  }

  openStation(stationId: string): void {
    usePrinterStore.setState({ open: true, mode: 'station', stationId, view: null });
  }

  close(): void {
    usePrinterStore.setState({ open: false, stationId: null, view: null });
  }

  /** Reconcile the panel with a fresh read-only state snapshot. */
  sync(state: PrinterUiState): void {
    if (!this.isOpen()) return;
    usePrinterStore.setState({ view: state });
  }

  dispose(): void {
    resetPrinterStore();
  }
}
