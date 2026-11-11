// Backpack wiring (M07). Split out of Game to keep both files under the
// 400-line hard rule: per-tick key consumption (E/Q/digits become Actions)
// and per-frame HUD/entity assembly. All sim mutation flows through
// dispatch; this module only reads world state for the frame.

import { isKnownItem, itemDef, type ItemDef } from '../data/loadData.js';
import { BACKPACK_SLOTS } from '../core/constants.js';
import type { PlayerInput } from '../player/input.js';
import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import { findAimedItem } from './pickup.js';

/** Consume edge-triggered backpack keys into Actions (call once per tick).
 * Queues drain unconditionally so presses with no eligible player never fire
 * late; dispatches only happen when the player can act. E is handled by
 * interactWiring (M09: station/item/tether/placement priority chain). */
export function tickBackpackInput(
  world: World,
  playerId: EntityId | null,
  input: PlayerInput,
  canAct: boolean,
): void {
  const select = input.consumeSelect();
  const drop = input.consumeDrop();
  const tether = input.consumeTether();
  if (!canAct || !playerId) return;
  if (select !== null && select >= 0 && select < BACKPACK_SLOTS) {
    world.dispatch({ type: 'selectSlot', playerId, slot: select });
  }
  if (drop) {
    const holder = world.entities.get(playerId);
    world.dispatch({
      type: 'drop',
      playerId,
      slot: holder?.components.inventory?.selectedSlot ?? 0,
    });
  }
  // T spends one backpack Tether item on a post under the player.
  if (tether) {
    world.dispatch({ type: 'placeTether', playerId });
  }
}

export interface BackpackFrame {
  /** Raw item ids per slot (null = empty); the Renderer resolves defs. */
  carriedItemIds: (string | null)[];
  /** Resolved definitions for the HUD (unknown future ids read as empty). */
  slotDefs: (ItemDef | null)[];
  selectedSlot: number;
  soil: number;
  /** Item id of the large package carried in front, if any. */
  frontCarryItemId: string | null;
  /** "E: pick up Resin" when an item is aimed, else null. */
  prompt: string | null;
}

/** Read-only per-frame assembly for the HUD and the entity views. */
export function backpackFrame(world: World, playerId: EntityId | null, flying: boolean): BackpackFrame {
  const holder = playerId ? world.entities.get(playerId) : undefined;
  const inv = holder?.components.inventory;
  const carriedItemIds = inv
    ? inv.slots.map((id) => (id ? (world.entities.get(id)?.components.item?.itemId ?? null) : null))
    : [];
  const slotDefs = carriedItemIds.map((id) => (id && isKnownItem(id) ? itemDef(id) : null));
  const largeId = holder?.components.player?.carryingLarge;
  const frontCarryItemId = largeId
    ? (world.entities.get(largeId)?.components.item?.itemId ?? null)
    : null;
  let prompt: string | null = null;
  if (!flying && playerId) {
    const aimed = findAimedItem(world, playerId);
    const aimedId = aimed ? world.entities.get(aimed)?.components.item?.itemId : null;
    if (aimedId && isKnownItem(aimedId)) prompt = `E: pick up ${itemDef(aimedId).name}`;
  }
  return {
    carriedItemIds,
    slotDefs,
    selectedSlot: inv?.selectedSlot ?? 0,
    soil: Math.floor(holder?.components.player?.soil ?? 0),
    frontCarryItemId,
    prompt,
  };
}
