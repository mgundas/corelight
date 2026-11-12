// Printer panel presentation store. The controller in ui/printerUi.ts writes
// the projection; the React panel renders it. Presentation only.

import { create } from 'zustand';
import type { PrinterUiState } from '../printerUi.js';

export interface PrinterStoreState {
  open: boolean;
  mode: 'backpack' | 'station';
  stationId: string | null;
  view: PrinterUiState | null;
}

export const usePrinterStore = create<PrinterStoreState>(() => ({
  open: false,
  mode: 'backpack',
  stationId: null,
  view: null,
}));

export function resetPrinterStore(): void {
  usePrinterStore.setState({ open: false, mode: 'backpack', stationId: null, view: null });
}
