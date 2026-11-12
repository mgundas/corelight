// Client-side placement mode state (M09/M10). The mode is presentation/input
// state, not World state: nothing here mutates the sim. Confirming a click
// returns a placement request; Game dispatches the placePlaceable Action and
// the sim re-validates everything (ground, snap/slot target, package
// ownership). M10 platforms snap to free rim points and machines attach to
// platform top slots.

import { PLACE_RANGE_M } from '../core/constants.js';
import { distance, type Quat, type Vec3d } from '../core/math.js';
import {
  placeableForPackageItem,
  type PlaceableDef,
} from '../data/loadPlaceables.js';
import type { EntityId, SlotRef, SnapRef } from '../sim/entities.js';
import { resolvePlacement } from '../sim/placeResolve.js';
import type { ToolAim } from '../player/terrainTool.js';
import type { World } from '../sim/world.js';
import { findPlacementTarget } from './snapTarget.js';

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
  snap?: SnapRef;
  slot?: SlotRef;
}

export class PlacementMode {
  private activeId: string | null = null;
  /** Button edges are tracked while inactive too, so entering placement
   * with the mouse already held cannot instantly place. */
  private lastPrimary = false;

  activePlaceableId(): string | null {
    return this.activeId;
  }

  isActive(): boolean {
    return this.activeId !== null;
  }

  enter(placeableId: string): void {
    this.activeId = placeableId;
  }

  /**
   * Enter placement from a click on a placed structure: seed the button edge
   * as already held so the same click cannot instantly re-place it.
   */
  enterFromClick(placeableId: string): void {
    this.activeId = placeableId;
    this.lastPrimary = true;
  }

  cancel(): void {
    this.activeId = null;
  }

  /**
   * Call once per sim tick. Returns a placement request on a fresh left-click
   * over a valid spot; the caller dispatches it. Invalid clicks keep the mode
   * active (the ghost is red), E cancels.
   */
  tick(world: World, playerId: EntityId, aim: ToolAim, primary: boolean): PlacementRequest | null {
    const primaryEdge = primary && !this.lastPrimary;
    this.lastPrimary = primary;
    if (!this.activeId) return null;
    const player = world.entities.get(playerId);
    const carried = carriedPlaceable(world, playerId);
    if (!player || !player.planetId || !carried || carried.placeable.id !== this.activeId) {
      this.activeId = null;
      return null;
    }
    if (!primaryEdge) return null;
    const target = findPlacementTarget(world, playerId, this.activeId, aim);
    if (!aim.hit && !target) return null;
    const requested = aim.hit ?? { x: 0, y: 0, z: 0 };
    const resolved = resolvePlacement(world, player.planetId, this.activeId, requested, player.position, target);
    if (!resolved.ok || !resolved.placement) return null;
    const request: PlacementRequest = {
      placeableId: this.activeId,
      position: { ...resolved.placement.position },
    };
    if (resolved.snap) request.snap = { ...resolved.snap };
    if (resolved.slot) request.slot = { ...resolved.slot };
    this.activeId = null;
    return request;
  }
}

/** Read-only validity for the ghost + prompt (never mutates). */
export function placementCheckFor(
  world: World,
  playerId: EntityId,
  aim: ToolAim,
): { ok: boolean; reason: string | null; position: Vec3d | null; rotation: Quat | null } {
  const player = world.entities.get(playerId);
  const carried = carriedPlaceable(world, playerId);
  if (!player || !player.planetId || !carried || aim.planet?.id !== player.planetId) {
    return { ok: false, reason: 'Aim at the ground', position: null, rotation: null };
  }
  const target = findPlacementTarget(world, playerId, carried.placeable.id, aim);
  if (!aim.hit && !target) return { ok: false, reason: 'Aim at the ground', position: null, rotation: null };
  // Keep the old readability guard for ground placement (resolve checks the
  // resolved snap/slot transform, which can be raised above the aim point).
  if (!target && aim.hit && distance(player.position, aim.hit) > PLACE_RANGE_M) {
    return { ok: false, reason: 'Out of reach', position: { ...aim.hit }, rotation: null };
  }
  const requested = aim.hit ?? { x: 0, y: 0, z: 0 };
  const resolved = resolvePlacement(world, player.planetId, carried.placeable.id, requested, player.position, target);
  if (!resolved.ok || !resolved.placement) {
    // A failed snap/slot has no honest ghost position; hide it instead of
    // drawing the body on the terrain behind the platform.
    return {
      ok: false,
      reason: resolved.reason,
      position: target ? null : aim.hit,
      rotation: null,
    };
  }
  return {
    ok: true,
    reason: null,
    position: { ...resolved.placement.position },
    rotation: { ...resolved.placement.rotation },
  };
}
