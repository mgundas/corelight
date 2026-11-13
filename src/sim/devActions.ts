import { DEV_ITEM_MAX_COUNT } from '../core/constants.js';
import { events } from '../core/events.js';
import { isKnownItem } from '../data/loadData.js';
import type { EntityId } from './entities.js';
import { giveItemToPlayer, inventoryFor } from './inventoryActions.js';
import type { World } from './world.js';

/** The game command bridge gates dev tools; the sim still validates every
 * grant and reuses normal output handling, including full-pack overflow. */
export function debugGiveItem(world: World, playerId: EntityId, itemId: string, count: number): void {
  const player = world.entities.get(playerId);
  if (player?.kind === 'player' && player.components.player &&
      player.planetId !== null && isKnownItem(itemId) &&
      Number.isInteger(count) && count >= 1 && count <= DEV_ITEM_MAX_COUNT &&
      inventoryFor(world, playerId)) {
    for (let i = 0; i < count; i++) giveItemToPlayer(world, player, itemId);
  }
  events.emit('actionApplied', { type: 'debugGiveItem' });
}
