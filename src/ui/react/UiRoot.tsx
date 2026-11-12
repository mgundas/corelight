// Single React root for every DOM UI surface. The three.js canvas stays
// outside React: Game owns the loop and pushes read-only projections into the
// zustand stores these components subscribe to.

import { DebugOverlayView } from './DebugOverlayView.js';
import { DragGhost } from './DragGhost.js';
import { HudView } from './HudView.js';
import { MenuViews } from './MenuViews.js';
import { PrinterPanel } from './PrinterPanel.js';
import { ResearchPanel } from './ResearchPanel.js';

export function UiRoot() {
  return (
    <>
      <HudView />
      <PrinterPanel />
      <ResearchPanel />
      <DebugOverlayView />
      <MenuViews />
      <DragGhost />
    </>
  );
}
