// Client-side placement mode state (M09). The mode is presentation/input
// state, not World state: nothing here mutates the sim. Confirming a click
// returns a placement request; Game dispatches the placePlaceable Action and
// the sim re-validates everything (range, slope, space, package ownership).

import { PLACE_RANGE_M } from '../core/constants.js';
import { distance, type Vec3d } from '../core/math.js';
import {
  placeableForPackageItem,
  type PlaceableDef,
} from '../data/loadPlaceables.js';
import type { EntityId } from '../sim/entities.js';
import { checkPlacement } from '../sim/placeActions.js';
import type { ToolAim } from '../player/terrainTool.js';
import type { World } from '../sim/world.js';

export interface CarriedPlaceable {
  placeable: PlaceableDef;
  itemId: EntityId;
  /** True when carried in front (large), false when in a backpack slot. */
  front: boolean;
}

/** The packaged placeable the player could place right now, if any. */
export function carriedPlaceable(world: World, playerId: EntityId): CarriedPlaceable | null {
  const player = world.entities.get(playerId);
  const inventory = player?.components.inventory;
  if (!player || !inventory) return null;
  const frontId = player.components.player?.carryingLarge;
  if (frontId) {
    const item = world.entities.get(frontId)?.components.item;
    const placeable = item ? placeableForPackageItem(item.itemId) : undefined;
    if (placeable) return { placeable, itemId: frontId, front: true };
  }
  const selected = inventory.slots[inventory.selectedSlot];
  if (selected) {
    const item = world.entities.get(selected)?.components.item;
    const placeable = item ? placeableForPackageItem(item.itemId) : undefined;
    if (placeable) return { placeable, itemId: selected, front: false };
  }
  return null;
}

export interface PlacementRequest {
  placeableId: string;
  position: Vec3d;
}

export class PlacementMode {
  private activeId: string | null = null;
  /** Button edges are tracked while inactive too, so entering placement
   * with the mouse already held cannot instantly place. */
  private lastDig = false;
  private lastAdd = false;

  activePlaceableId(): string | null {
    return this.activeId;
  }

  isActive(): boolean {
    return this.activeId !== null;
  }

  enter(placeableId: string): void {
    this.activeId = placeableId;
  }

  cancel(): void {
    this.activeId = null;
  }

  /**
   * Call once per sim tick. Returns a placement request on a fresh left-click
   * over a valid spot; the caller dispatches it. Invalid clicks keep the mode
   * active (the ghost is red), right-click or E cancels.
   */
  tick(
    world: World,
    playerId: EntityId,
    aim: ToolAim,
    dig: boolean,
    add: boolean,
  ): PlacementRequest | null {
    const digEdge = dig && !this.lastDig;
    const addEdge = add && !this.lastAdd;
    this.lastDig = dig;
    this.lastAdd = add;
    if (!this.activeId) return null;
    const player = world.entities.get(playerId);
    const carried = carriedPlaceable(world, playerId);
    if (!player || !player.planetId || !carried || carried.placeable.id !== this.activeId) {
      this.activeId = null;
      return null;
    }
    if (addEdge) {
      this.activeId = null;
      return null;
    }
    if (!digEdge || !aim.hit || !aim.planet) return null;
    if (aim.planet.id !== player.planetId) return null;
    if (distance(player.position, aim.hit) > PLACE_RANGE_M) return null;
    const check = checkPlacement(world, player.planetId, this.activeId, aim.hit);
    if (!check.ok) return null;
    const request = { placeableId: this.activeId, position: { ...aim.hit } };
    this.activeId = null;
    return request;
  }
}

/** Read-only validity for the ghost + prompt (never mutates). */
export function placementCheckFor(
  world: World,
  playerId: EntityId,
  aim: ToolAim,
): { ok: boolean; reason: string | null; position: Vec3d | null } {
  const player = world.entities.get(playerId);
  const carried = carriedPlaceable(world, playerId);
  if (!player || !player.planetId || !carried || !aim.hit || aim.planet?.id !== player.planetId) {
    return { ok: false, reason: 'Aim at the ground', position: null };
  }
  if (distance(player.position, aim.hit) > PLACE_RANGE_M) {
    return { ok: false, reason: 'Out of reach', position: { ...aim.hit } };
  }
  const check = checkPlacement(world, player.planetId, carried.placeable.id, aim.hit);
  return { ok: check.ok, reason: check.reason, position: { ...aim.hit } };
}
