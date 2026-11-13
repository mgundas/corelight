// UI -> Action command installation (React port). Kept out of Game.ts so the
// file stays under the 400-line hard rule. Every command dispatches an
// Action; the UI never mutates the World directly.

import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import { setUiCommands } from '../ui/stores/commandsStore.js';
import { getUrlParams } from '../core/urlParams.js';
import { setDevItemsOpen } from '../ui/stores/devItemsStore.js';
import { resetDragStore } from '../ui/stores/dragStore.js';

export function installUiCommands(
  world: World,
  playerId: () => EntityId | null,
  closePrinter: () => void,
  closeResearch: () => void,
  onDevPanelChange: (open: boolean) => void = () => undefined,
): void {
  const withPlayer = (run: (id: EntityId) => void): void => {
    const id = playerId();
    if (id) run(id);
  };
  setUiCommands({
    setDevItemsOpen: (open) => {
      if (open && (!getUrlParams().dev || !playerId())) return;
      if (open) { closePrinter(); closeResearch(); resetDragStore(); }
      setDevItemsOpen(open);
      onDevPanelChange(open);
    },
    devGiveItem: (itemId, count) => {
      if (getUrlParams().dev) withPlayer((id) => world.dispatch({ type: 'debugGiveItem', playerId: id, itemId, count }));
    },
    selectSlot: (slot) => withPlayer((id) => world.dispatch({ type: 'selectSlot', playerId: id, slot })),
    moveItem: (from, to) =>
      withPlayer((id) => world.dispatch({ type: 'moveItem', playerId: id, from, to })),
    dropSlot: (slot) => withPlayer((id) => world.dispatch({ type: 'drop', playerId: id, slot })),
    depositSlotToStation: (stationId, slot) =>
      withPlayer((id) =>
        world.dispatch({ type: 'depositSlotToStation', playerId: id, stationId, slot }),
      ),
    printBackpack: (recipeId) =>
      withPlayer((id) => world.dispatch({ type: 'printBackpack', playerId: id, recipeId })),
    printStation: (stationId, recipeId) =>
      withPlayer((id) => world.dispatch({ type: 'printAtStation', playerId: id, stationId, recipeId })),
    collectStation: (stationId) =>
      withPlayer((id) => world.dispatch({ type: 'collectStation', playerId: id, stationId })),
    unloadStationInput: (stationId, itemId) =>
      withPlayer((id) => world.dispatch({ type: 'unloadStationInput', playerId: id, stationId, itemId })),
    closePrinter,
    unlockResearch: (id) =>
      withPlayer((player) => world.dispatch({ type: 'unlockResearch', playerId: player, id })),
    depositResearchSample: (stationId) =>
      withPlayer((id) => world.dispatch({ type: 'depositResearchSample', playerId: id, stationId })),
    collectResearch: (stationId) =>
      withPlayer((id) => world.dispatch({ type: 'collectResearch', playerId: id, stationId })),
    closeResearch,
  });
}
