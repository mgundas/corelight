import type { Vec3d } from '../core/math.js';
import { IDENTITY_QUAT } from '../core/math.js';
import { BACKPACK_SLOTS, OXYGEN_MAX } from '../core/constants.js';
import { events } from '../core/events.js';
import type { EditMode } from '../terrain/edits.js';
import type { EntityId, SnapRef } from './entities.js';
import {
  collectStation,
  depositSlotToStation,
  depositToStation,
  printAtStation,
  printBackpack,
} from './craftingActions.js';
import { connectCable, disconnectCable } from './cableActions.js';
import { dropItem, moveItem, pickUpItem } from './inventoryActions.js';
import { grabItem, releaseGrabbed } from './grabActions.js';
import { packUpPlaced } from './packActions.js';
import { placeLightstick, placePlaceable } from './placeActions.js';
import type { PlacementTarget } from './placeResolve.js';
import {
  collectResearch,
  depositResearchSample,
  unlockResearch,
} from './researchActions.js';
import { applyTerrainEdit } from './terrainEditAction.js';
import { placeTether, removeTether, spawnHabitatEntity } from './tetherActions.js';
import type { World } from './world.js';

// All gameplay changes go through Actions (ARCHITECTURE.md hard rule 2).
// M00 skeleton: noop + a debug marker spawner used by tests/debug tools.

export type Action =
  | { type: 'noop' }
  | { type: 'debugSpawnMarker'; position: Vec3d }
  | { type: 'spawnPlayer'; planetId: string; position: Vec3d }
  | {
      type: 'playerInput';
      playerId: EntityId;
      move: { x: number; z: number };
      jump: boolean;
      sprint: boolean;
      lookYaw: number;
      lookPitch: number;
    }
  | { type: 'playerTeleport'; playerId: EntityId; position: Vec3d }
  | { type: 'toggleHeadlamp'; playerId: EntityId }
  | {
      type: 'terrainEdit';
      playerId: EntityId;
      planetId: string;
      mode: EditMode;
      /** Brush center in world-space doubles. */
      center: Vec3d;
      radius: number;
      strength: number;
      /** Flatten plane in world coords (captured at stroke start). */
      flattenPlane?: { point: Vec3d; normal: Vec3d };
    }
  | { type: 'pickUp'; playerId: EntityId; itemId: EntityId }
  | { type: 'drop'; playerId: EntityId; slot: number }
  | { type: 'selectSlot'; playerId: EntityId; slot: number }
  | { type: 'moveItem'; playerId: EntityId; from: number; to: number }
  | { type: 'grabItem'; playerId: EntityId; itemId: EntityId }
  | {
      type: 'releaseGrabbed';
      playerId: EntityId;
      /** Requested drop point (cursor aim), or null for "in front". */
      position: Vec3d | null;
      /** False = always drop loose (stowing the tool), never place. */
      allowPlace?: boolean;
      /** Platform rim snap or top slot for packaged placeables. */
      snap?: PlacementTarget['snap'];
      slot?: PlacementTarget['slot'];
    }
  | { type: 'spawnHabitat'; planetId: string; position: Vec3d }
  | { type: 'placeTether'; playerId: EntityId }
  | { type: 'removeTether'; playerId: EntityId; tetherId: EntityId }
  | { type: 'connectCable'; playerId: EntityId; from: SnapRef; to: SnapRef }
  | { type: 'disconnectCable'; playerId: EntityId; cableId: EntityId }
  | { type: 'packUpPlaced'; playerId: EntityId; entityId: EntityId }
  | { type: 'printBackpack'; playerId: EntityId; recipeId: string }
  | { type: 'depositToStation'; playerId: EntityId; stationId: EntityId }
  | { type: 'depositSlotToStation'; playerId: EntityId; stationId: EntityId; slot: number }
  | { type: 'printAtStation'; playerId: EntityId; stationId: EntityId; recipeId: string }
  | { type: 'collectStation'; playerId: EntityId; stationId: EntityId }
  | {
      type: 'placePlaceable';
      playerId: EntityId;
      placeableId: string;
      position: Vec3d;
      /** Platform rim snap or top slot chosen by the client (re-validated). */
      snap?: PlacementTarget['snap'];
      slot?: PlacementTarget['slot'];
    }
  | { type: 'placeLightstick'; playerId: EntityId }
  | { type: 'unlockResearch'; playerId: EntityId; id: string }
  | { type: 'depositResearchSample'; playerId: EntityId; stationId: EntityId; slot?: number }
  | { type: 'collectResearch'; playerId: EntityId; stationId: EntityId };

function clampAxis(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

export function applyAction(world: World, action: Action): void {
  switch (action.type) {
    case 'noop':
      return;
    case 'debugSpawnMarker': {
      const id = world.nextId('marker');
      world.entities.set(id, {
        id,
        kind: 'marker',
        planetId: null,
        position: { ...action.position },
        rotation: { ...IDENTITY_QUAT },
        components: {},
      });
      events.emit('actionApplied', { type: action.type });
      return;
    }
    case 'spawnPlayer': {
      const id = world.nextId('player');
      world.entities.set(id, {
        id,
        kind: 'player',
        planetId: action.planetId,
        position: { ...action.position },
        rotation: { ...IDENTITY_QUAT },
        components: {
          player: {
            velocity: { x: 0, y: 0, z: 0 },
            grounded: false,
            yaw: 0,
            pitch: 0,
            input: null,
            embeddedTime: 0,
            escaping: false,
            soil: 0,
            toolHardness: 2,
            lastTooHard: -Infinity,
            headlampOn: true,
            deathMarkerId: null,
            carryingLarge: null,
            grabbed: null,
          },
          inventory: {
            slots: Array<EntityId | null>(BACKPACK_SLOTS).fill(null),
            selectedSlot: 0,
          },
          oxygen: { value: OXYGEN_MAX },
        },
      });
      events.emit('actionApplied', { type: action.type });
      return;
    }
    case 'playerInput': {
      const entity = world.entities.get(action.playerId);
      const player = entity?.components.player;
      if (!entity || entity.kind !== 'player' || !player) return;
      // Crafted actions must not smuggle NaN/Infinity into the sim (a NaN
      // position serializes as null and corrupts the save): reject anything
      // non-finite before it touches state.
      if (
        typeof action.move?.x !== 'number' ||
        typeof action.move?.z !== 'number' ||
        !Number.isFinite(action.move.x) ||
        !Number.isFinite(action.move.z) ||
        typeof action.jump !== 'boolean' ||
        typeof action.sprint !== 'boolean' ||
        typeof action.lookYaw !== 'number' ||
        typeof action.lookPitch !== 'number' ||
        !Number.isFinite(action.lookYaw) ||
        !Number.isFinite(action.lookPitch)
      ) {
        events.emit('actionApplied', { type: action.type });
        return;
      }
      player.yaw = action.lookYaw;
      player.pitch = Math.min(Math.PI / 2, Math.max(-Math.PI / 2, action.lookPitch));
      player.input = {
        moveX: clampAxis(action.move.x),
        moveZ: clampAxis(action.move.z),
        jump: action.jump,
        sprint: action.sprint,
      };
      events.emit('actionApplied', { type: action.type });
      return;
    }
    case 'playerTeleport': {
      const entity = world.entities.get(action.playerId);
      const player = entity?.components.player;
      if (!entity || entity.kind !== 'player' || !player) return;
      entity.position = { ...action.position };
      player.velocity = { x: 0, y: 0, z: 0 };
      player.grounded = false;
      player.input = null;
      player.embeddedTime = 0;
      player.escaping = false;
      events.emit('actionApplied', { type: action.type });
      return;
    }
    case 'toggleHeadlamp': {
      const entity = world.entities.get(action.playerId);
      const player = entity?.components.player;
      if (!entity || entity.kind !== 'player' || !player) {
        events.emit('actionApplied', { type: action.type });
        return;
      }
      player.headlampOn = !player.headlampOn;
      events.emit('actionApplied', { type: action.type });
      return;
    }
    case 'terrainEdit': {
      applyTerrainEdit(world, action);
      return;
    }
    case 'pickUp': {
      pickUpItem(world, action.playerId, action.itemId);
      return;
    }
    case 'drop': {
      dropItem(world, action.playerId, action.slot);
      return;
    }
    case 'selectSlot': {
      const entity = world.entities.get(action.playerId);
      const inventory = entity?.components.inventory;
      if (!entity || entity.kind !== 'player' || !inventory) {
        events.emit('actionApplied', { type: action.type });
        return;
      }
      if (Number.isInteger(action.slot) && action.slot >= 0 && action.slot < BACKPACK_SLOTS) {
        inventory.selectedSlot = action.slot;
      }
      events.emit('actionApplied', { type: action.type });
      return;
    }
    case 'moveItem': {
      moveItem(world, action.playerId, action.from, action.to);
      return;
    }
    case 'grabItem': {
      grabItem(world, action.playerId, action.itemId);
      return;
    }
    case 'releaseGrabbed': {
      const target: PlacementTarget | null =
        action.snap || action.slot ? { snap: action.snap, slot: action.slot } : null;
      releaseGrabbed(world, action.playerId, action.position, target, action.allowPlace !== false);
      return;
    }
    case 'spawnHabitat': {
      spawnHabitatEntity(world, action.planetId, action.position);
      return;
    }
    case 'placeTether': {
      placeTether(world, action.playerId);
      return;
    }
    case 'removeTether': {
      removeTether(world, action.playerId, action.tetherId);
      return;
    }
    case 'connectCable': {
      connectCable(world, action.playerId, action.from, action.to);
      return;
    }
    case 'disconnectCable': {
      disconnectCable(world, action.playerId, action.cableId);
      return;
    }
    case 'packUpPlaced': {
      packUpPlaced(world, action.playerId, action.entityId);
      return;
    }
    case 'printBackpack': {
      printBackpack(world, action.playerId, action.recipeId);
      return;
    }
    case 'depositToStation': {
      depositToStation(world, action.playerId, action.stationId);
      return;
    }
    case 'depositSlotToStation': {
      depositSlotToStation(world, action.playerId, action.stationId, action.slot);
      return;
    }
    case 'printAtStation': {
      printAtStation(world, action.playerId, action.stationId, action.recipeId);
      return;
    }
    case 'collectStation': {
      collectStation(world, action.playerId, action.stationId);
      return;
    }
    case 'placePlaceable': {
      const target: PlacementTarget | null =
        action.snap || action.slot ? { snap: action.snap, slot: action.slot } : null;
      placePlaceable(world, action.playerId, action.placeableId, action.position, target);
      return;
    }
    case 'placeLightstick': {
      placeLightstick(world, action.playerId);
      return;
    }
    case 'unlockResearch': {
      unlockResearch(world, action.playerId, action.id);
      return;
    }
    case 'depositResearchSample': {
      depositResearchSample(world, action.playerId, action.stationId, action.slot);
      return;
    }
    case 'collectResearch': {
      collectResearch(world, action.playerId, action.stationId);
      return;
    }
  }
}
