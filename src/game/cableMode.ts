// Cable tool state (M10). Presentation/input state, not World state: a click
// either arms a source snap, completes a connection, or cuts an existing
// cable. Game dispatches the Action and the sim re-validates range/freeness.
// C toggles the tool; right-click or E exits back to the terrain tool.

import { CABLE_MAX_LENGTH_M } from '../core/constants.js';
import { distance } from '../core/math.js';
import type { EntityId, SnapRef } from '../sim/entities.js';
import { cableOnSnap, sameSnap, snapFree, snapWorld } from '../sim/snapUtils.js';
import type { World } from '../sim/world.js';
import type { ToolAim } from '../player/terrainTool.js';
import { findAimedSnap } from './snapTarget.js';

export type CableRequest =
  | { type: 'connect'; from: SnapRef; to: SnapRef }
  | { type: 'disconnect'; cableId: EntityId };

export class CableMode {
  private active = false;
  private pending: SnapRef | null = null;
  private lastDig = false;
  private lastAdd = false;

  isActive(): boolean {
    return this.active;
  }

  pendingRef(): SnapRef | null {
    return this.pending;
  }

  activate(): void {
    this.active = true;
    this.pending = null;
  }

  cancel(): void {
    this.active = false;
    this.pending = null;
  }

  toggle(): void {
    if (this.active) this.cancel();
    else this.activate();
  }

  /**
   * Call once per sim tick. Returns a cable request on a fresh click:
   * a free snap arms the source, the next free snap within 10 m connects,
   * and a click on a cabled snap cuts that cable.
   */
  tick(
    world: World,
    playerId: EntityId,
    aim: ToolAim,
    dig: boolean,
    add: boolean,
  ): CableRequest | null {
    const digEdge = dig && !this.lastDig;
    const addEdge = add && !this.lastAdd;
    this.lastDig = dig;
    this.lastAdd = add;
    if (!this.active) return null;
    if (addEdge) {
      this.cancel();
      return null;
    }
    if (!digEdge) return null;
    const aimed = findAimedSnap(world, playerId, aim);
    if (!aimed) return null;
    if (this.pending) {
      if (sameSnap(this.pending, aimed)) {
        this.pending = null;
        return null;
      }
      const from = this.pending;
      this.pending = null;
      if (!snapFree(world, from) || !snapFree(world, aimed)) return null;
      const player = world.entities.get(playerId);
      const planet = player?.planetId ? world.planets.find((p) => p.id === player.planetId) : undefined;
      const fromEntity = world.entities.get(from.entityId);
      const toEntity = world.entities.get(aimed.entityId);
      if (!player?.planetId || !planet || !fromEntity || !toEntity) return null;
      if (fromEntity.planetId !== planet.id || toEntity.planetId !== planet.id) return null;
      const a = snapWorld(fromEntity, from.snapIndex);
      const b = snapWorld(toEntity, aimed.snapIndex);
      if (!a || !b || distance(a, b) > CABLE_MAX_LENGTH_M) return null;
      return { type: 'connect', from, to: aimed };
    }
    const cableId = cableOnSnap(world, aimed);
    if (cableId) return { type: 'disconnect', cableId };
    if (snapFree(world, aimed)) this.pending = aimed;
    return null;
  }
}
