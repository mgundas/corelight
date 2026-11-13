// Station UI owner (M11): printer + research panel controllers and the
// unlock toast live together so Game stays under the 400-line rule. This is
// presentation wiring only; every mutation still goes through Actions.

import { events } from '../core/events.js';
import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import type { Hud } from '../ui/hud.js';
import { PrinterUi } from '../ui/printerUi.js';
import { ResearchUi, unlockToastText } from '../ui/researchUi.js';
import { updatePrinterUi } from './printerWiring.js';
import { updateResearchUi } from './researchWiring.js';
import { isDevItemsOpen, setDevItemsOpen } from '../ui/stores/devItemsStore.js';

export class StationUi {
  readonly printer = new PrinterUi();
  readonly research = new ResearchUi();
  private readonly unsubscribeUnlock: () => void;

  constructor(
    private readonly world: World,
    private readonly hud: Hud,
  ) {
    this.unsubscribeUnlock = events.on('researchUnlocked', ({ recipeIds }) => {
      this.hud.showToast(unlockToastText(recipeIds));
    });
  }

  /** True while any modal station panel owns input. */
  isOpen(): boolean {
    return this.printer.isOpen() || this.research.isOpen() || isDevItemsOpen();
  }

  openStation(stationId: EntityId): void {
    this.research.close();
    this.printer.openStation(stationId);
  }

  openResearch(stationId: EntityId): void {
    this.printer.close();
    this.research.openStation(stationId);
  }

  /** Tab: close research first, else toggle the backpack printer. */
  togglePrinter(allowOpen: boolean): void {
    if (this.research.isOpen()) {
      this.research.close();
      return;
    }
    if (this.printer.isOpen()) {
      this.printer.close();
      return;
    }
    if (allowOpen) this.printer.openBackpack();
  }

  closePrinter(): void {
    this.printer.close();
  }

  closeResearch(): void {
    this.research.close();
  }

  closeAll(): void {
    setDevItemsOpen(false);
    this.printer.close();
    this.research.close();
  }

  /** Throttled (10 Hz) read-only panel refresh. */
  update(playerId: EntityId | null, nowMs = performance.now()): void {
    updatePrinterUi(this.world, playerId, this.printer, nowMs);
    updateResearchUi(this.world, playerId, this.research, nowMs);
  }

  dispose(): void {
    this.unsubscribeUnlock();
    this.printer.dispose();
    this.research.dispose();
  }
}
