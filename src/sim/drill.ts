// Drill tier rules (M12). A drill is a normal backpack item; the tier comes
// purely from the item in the currently selected slot, so switching slots
// changes the terrain tool's hardness immediately (no extra entity state to
// sync or save). Mk3 additionally digs 30% faster.

import {
  DRILL_MK1_HARDNESS,
  DRILL_MK2_HARDNESS,
  DRILL_MK3_HARDNESS,
  DRILL_MK3_SPEED_MULT,
} from '../core/constants.js';
import type { EntityId } from './entities.js';
import type { World } from './world.js';

export type DrillTier = 1 | 2 | 3;

const HARDNESS: Record<DrillTier, number> = {
  1: DRILL_MK1_HARDNESS,
  2: DRILL_MK2_HARDNESS,
  3: DRILL_MK3_HARDNESS,
};

/** Tier for a held item id (anything but the two drill items is Mk1). */
export function drillTierForItem(itemId: string | null | undefined): DrillTier {
  if (itemId === 'drill_mk3') return 3;
  if (itemId === 'drill_mk2') return 2;
  return 1;
}

/** Tier of the item in the player's selected backpack slot. */
export function equippedDrillTier(world: World, playerId: EntityId): DrillTier {
  const inventory = world.entities.get(playerId)?.components.inventory;
  if (!inventory) return 1;
  const selected = inventory.slots[inventory.selectedSlot];
  const itemId = selected ? world.entities.get(selected)?.components.item?.itemId : undefined;
  return drillTierForItem(itemId);
}

/** Highest layer hardness the equipped drill can edit (2/3/4). */
export function toolHardnessFor(world: World, playerId: EntityId): number {
  return HARDNESS[equippedDrillTier(world, playerId)];
}

/** Dig-strength multiplier (Mk3 1.3x, others 1x). */
export function digSpeedMult(world: World, playerId: EntityId): number {
  return equippedDrillTier(world, playerId) === 3 ? DRILL_MK3_SPEED_MULT : 1;
}
