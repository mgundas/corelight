// Inventory action handlers (M07, split out in M09). Pick up, drop and slot
// selection moved here when actions.ts approached the 400-line rule; the
// crafting/placement handlers reuse `inventoryFor` instead of duplicating the
// old-save backpack heal.

import { BACKPACK_SLOTS, PICKUP_RANGE_M } from '../core/constants.js';
import { events } from '../core/events.js';
import { distance, IDENTITY_QUAT } from '../core/math.js';
import { isKnownItem } from '../data/loadData.js';
import { placeableForPackageItem } from '../data/loadPlaceables.js';
import type { EntityId } from './entities.js';
import { moveBasis, upAt } from './physics/frames.js';
import type { World } from './world.js';

/** Backpack, lazily created (old M06 saves predate inventory). */
export function inventoryFor(
  world: World,
  playerId: EntityId,
): { slots: (EntityId | null)[]; selectedSlot: number } | null {
  const entity = world.entities.get(playerId);
  const player = entity?.components.player;
  if (!entity || entity.kind !== 'player' || !player) return null;
  let inventory = entity.components.inventory;
  if (!inventory) {
    inventory = { slots: Array<EntityId | null>(BACKPACK_SLOTS).fill(null), selectedSlot: 0 };
    entity.components.inventory = inventory;
  }
  return inventory;
}

/** True when an item is a large packaged placeable (front carry). */
export function isLargePackage(itemId: string): boolean {
  const placeable = placeableForPackageItem(itemId);
  return placeable?.size === 'large';
}

export function pickUpItem(world: World, playerId: EntityId, itemId: EntityId): void {
  const playerEntity = world.entities.get(playerId);
  const inventory = inventoryFor(world, playerId);
  if (!playerEntity || !inventory) return;
  const item = world.entities.get(itemId);
  const itemComp = item?.components.item;
  if (!item || item.kind !== 'item' || !itemComp || !isKnownItem(itemComp.itemId)) {
    events.emit('actionApplied', { type: 'pickUp' });
    return;
  }
  if (itemComp.holder === playerId && playerEntity.components.player?.carryingLarge !== itemId) {
    events.emit('actionApplied', { type: 'pickUp' });
    return;
  }
  if (item.planetId !== playerEntity.planetId || distance(item.position, playerEntity.position) > PICKUP_RANGE_M) {
    events.emit('actionApplied', { type: 'pickUp' });
    return;
  }
  const playerComp = playerEntity.components.player;
  const large = isLargePackage(itemComp.itemId);
  if (large && !playerComp) {
    events.emit('actionApplied', { type: 'pickUp' });
    return;
  }
  // A large package goes in front of the player, not in a slot. One at a
  // time: printing a second one while carrying is rejected by crafting.
  if (large && playerComp?.carryingLarge) {
    events.emit('actionApplied', { type: 'pickUp' });
    return;
  }
  // Take over foreign-held items (drop-then-grab races resolve deterministically).
  const prevHolder = itemComp.holder ? world.entities.get(itemComp.holder) : undefined;
  const prevInventory = prevHolder?.components.inventory;
  if (prevInventory) {
    const at = prevInventory.slots.indexOf(itemId);
    if (at !== -1) prevInventory.slots[at] = null;
  }
  if (prevHolder?.components.player?.carryingLarge === itemId) {
    prevHolder.components.player.carryingLarge = null;
  }
  if (large) {
    if (playerComp) playerComp.carryingLarge = itemId;
    itemComp.holder = playerId;
    events.emit('actionApplied', { type: 'pickUp' });
    return;
  }
  // One item per slot (v1): a full backpack refuses the pickup.
  const free = inventory.slots.indexOf(null);
  if (free === -1) {
    events.emit('actionApplied', { type: 'pickUp' });
    return;
  }
  inventory.slots[free] = itemId;
  // New pickups become the held slot so E (deposit/place) acts on them.
  inventory.selectedSlot = free;
  itemComp.holder = playerId;
  events.emit('actionApplied', { type: 'pickUp' });
}

export function dropItem(world: World, playerId: EntityId, slot: number): void {
  const playerEntity = world.entities.get(playerId);
  const inventory = inventoryFor(world, playerId);
  if (!playerEntity || !inventory) return;
  if (!Number.isInteger(slot) || slot < 0 || slot >= BACKPACK_SLOTS) {
    events.emit('actionApplied', { type: 'drop' });
    return;
  }
  const carriedId = inventory.slots[slot] as EntityId | null;
  const player = playerEntity.components.player;
  // Empty selected slot + a front-carried large package: Q drops the package.
  const largeId = carriedId ? null : (player?.carryingLarge ?? null);
  const dropId = carriedId ?? largeId;
  if (!dropId) {
    events.emit('actionApplied', { type: 'drop' });
    return;
  }
  const planet = world.planets.find((p) => p.id === playerEntity.planetId);
  const item = world.entities.get(dropId);
  const itemComp = item?.components.item;
  if (!planet || !player || !item || item.kind !== 'item' || !itemComp) {
    if (carriedId) inventory.slots[slot] = null;
    if (largeId && player) player.carryingLarge = null;
    events.emit('actionApplied', { type: 'drop' });
    return;
  }
  // Drop in front of the player at chest height, yaw-leveled: pitching the
  // look straight down must not plant the item underground (full look
  // direction would put it ~1 m below the surface).
  const up = upAt(planet, playerEntity.position);
  const { forward } = moveBasis(up, player.yaw, 0);
  item.position = {
    x: playerEntity.position.x + forward.x * 1.5 + up.x * 0.5,
    y: playerEntity.position.y + forward.y * 1.5 + up.y * 0.5,
    z: playerEntity.position.z + forward.z * 1.5 + up.z * 0.5,
  };
  item.planetId = planet.id;
  item.rotation = { ...IDENTITY_QUAT };
  delete itemComp.holder;
  if (carriedId) inventory.slots[slot] = null;
  if (largeId) player.carryingLarge = null;
  events.emit('actionApplied', { type: 'drop' });
}
