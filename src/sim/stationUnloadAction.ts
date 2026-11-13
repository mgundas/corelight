import { STATION_RANGE_M } from '../core/constants.js';
import { events } from '../core/events.js';
import { distance } from '../core/math.js';
import { printerFor } from './craftingActions.js';
import type { EntityId } from './entities.js';
import { inventoryFor } from './inventoryActions.js';
import type { World } from './world.js';

/** Return an unconsumed input by identity, so stale/double clicks cannot
 * accidentally withdraw a different item after the input array compacts. */
export function unloadStationInput(
  world: World, playerId: EntityId, stationId: EntityId, itemId: EntityId,
): void {
  const player = world.entities.get(playerId);
  const station = world.entities.get(stationId);
  const printer = station ? printerFor(station) : null;
  const item = world.entities.get(itemId);
  const input = item?.components.item;
  if (player?.components.player && station && printer && item && input &&
      player.planetId !== null && player.planetId === station.planetId &&
      distance(player.position, station.position) <= STATION_RANGE_M &&
      printer.inputs.includes(itemId) && input.holder === stationId) {
    const inventory = inventoryFor(world, playerId);
    const free = inventory?.slots.indexOf(null) ?? -1;
    if (inventory && free !== -1) {
      printer.inputs.splice(printer.inputs.indexOf(itemId), 1);
      inventory.slots[free] = itemId;
      inventory.selectedSlot = free;
      input.holder = playerId;
      item.position = { ...player.position };
      item.planetId = player.planetId;
    }
  }
  events.emit('actionApplied', { type: 'unloadStationInput' });
}
