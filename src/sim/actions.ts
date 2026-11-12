import type { Vec3d } from '../core/math.js';
import { distance, IDENTITY_QUAT } from '../core/math.js';
import {
  BACKPACK_SLOTS,
  OXYGEN_MAX,
  SOIL_MAX,
  TOOL_MAX_RADIUS,
  TOOL_MIN_RADIUS,
  TOOL_RANGE_M,
  TOOL_RANGE_SLACK_M,
} from '../core/constants.js';
import { events } from '../core/events.js';
import { layerAt } from '../terrain/density.js';
import type { EditMode, FlattenPlane } from '../terrain/edits.js';
import type { EntityId, SnapRef } from './entities.js';
import {
  collectStation,
  depositToStation,
  printAtStation,
  printBackpack,
} from './craftingActions.js';
import { connectCable, disconnectCable } from './cableActions.js';
import { dropItem, pickUpItem } from './inventoryActions.js';
import { mineNodes } from './mining.js';
import { packUpPlaced } from './packActions.js';
import { placeLightstick, placePlaceable } from './placeActions.js';
import type { PlacementTarget } from './placeResolve.js';
import { baseFieldFor, placeTether, removeTether, spawnHabitatEntity } from './tetherActions.js';
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
  | { type: 'spawnHabitat'; planetId: string; position: Vec3d }
  | { type: 'placeTether'; playerId: EntityId }
  | { type: 'removeTether'; playerId: EntityId; tetherId: EntityId }
  | { type: 'connectCable'; playerId: EntityId; from: SnapRef; to: SnapRef }
  | { type: 'disconnectCable'; playerId: EntityId; cableId: EntityId }
  | { type: 'packUpPlaced'; playerId: EntityId; entityId: EntityId }
  | { type: 'printBackpack'; playerId: EntityId; recipeId: string }
  | { type: 'depositToStation'; playerId: EntityId; stationId: EntityId }
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
  | { type: 'placeLightstick'; playerId: EntityId };

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
      const entity = world.entities.get(action.playerId);
      const player = entity?.components.player;
      if (!entity || entity.kind !== 'player' || !player) return;
      const planet = world.planets.find((p) => p.id === action.planetId);
      if (!planet) return;
      // Terminal validation always emits: an action reaching a known player
      // and planet was processed, even when rejected (debug/UI counting
      // depends on it). Unknown players/planets stay silent (unprocessable).
      // The sim trusts no crafted action: the stroke must belong to the
      // player's planet and start within tool range of the player. NaN
      // centers/radii would corrupt soil accounting and saves, so they are
      // rejected; out-of-range radii clamp to the tool's brush limits.
      if (
        !Number.isFinite(action.radius) ||
        action.radius <= 0 ||
        !Number.isFinite(action.strength) ||
        typeof action.center?.x !== 'number' ||
        typeof action.center?.y !== 'number' ||
        typeof action.center?.z !== 'number' ||
        !Number.isFinite(action.center.x) ||
        !Number.isFinite(action.center.y) ||
        !Number.isFinite(action.center.z)
      ) {
        events.emit('actionApplied', { type: action.type });
        return;
      }
      const radius = Math.min(TOOL_MAX_RADIUS, Math.max(TOOL_MIN_RADIUS, action.radius));
      if (
        entity.planetId !== planet.id ||
        action.strength <= 0 ||
        !Number.isFinite(action.strength) ||
        distance(entity.position, action.center) > TOOL_RANGE_M + TOOL_RANGE_SLACK_M + radius
      ) {
        events.emit('actionApplied', { type: action.type });
        return;
      }
      // A non-finite flatten plane would smear NaN deltas into the edit
      // store (and then into saves): reject the stroke instead.
      if (action.flattenPlane) {
        const fp = action.flattenPlane;
        if (
          typeof fp.point?.x !== 'number' ||
          typeof fp.point?.y !== 'number' ||
          typeof fp.point?.z !== 'number' ||
          typeof fp.normal?.x !== 'number' ||
          typeof fp.normal?.y !== 'number' ||
          typeof fp.normal?.z !== 'number' ||
          !Number.isFinite(fp.point.x) ||
          !Number.isFinite(fp.point.y) ||
          !Number.isFinite(fp.point.z) ||
          !Number.isFinite(fp.normal.x) ||
          !Number.isFinite(fp.normal.y) ||
          !Number.isFinite(fp.normal.z)
        ) {
          events.emit('actionApplied', { type: action.type });
          return;
        }
      }
      // Add mode consumes soil; an empty counter fails the whole stroke bit.
      if (action.mode === 'add' && player.soil <= 0) {
        events.emit('actionApplied', { type: action.type });
        return;
      }
      const field = baseFieldFor(world, planet.id);
      const local = {
        x: action.center.x - planet.center.x,
        y: action.center.y - planet.center.y,
        z: action.center.z - planet.center.z,
      };
      const plane: FlattenPlane | undefined = action.flattenPlane
        ? {
            point: {
              x: action.flattenPlane.point.x - planet.center.x,
              y: action.flattenPlane.point.y - planet.center.y,
              z: action.flattenPlane.point.z - planet.center.z,
            },
            normal: { ...action.flattenPlane.normal },
          }
        : undefined;
      const outcome = world.terrainEdits.applySphere(
        planet,
        field.density,
        local,
        radius,
        action.strength,
        action.mode,
        {
          maxHardness: player.toolHardness,
          hardnessAt: (x, y, z) => layerAt(planet, x, y, z).hardness,
          flattenPlane: plane,
          // Digging earns soil; adding/flattening may only flip what the
          // counter covers (never spend what the player does not have).
          soilBudget: action.mode === 'dig' ? undefined : player.soil,
        },
      );
      player.soil = Math.min(SOIL_MAX, Math.max(0, player.soil + outcome.gained - outcome.spent));
      if (outcome.blocked) player.lastTooHard = world.time;
      // Mining: a dig stroke that actually moved terrain and overlaps a node
      // shakes one charge loose as a physical item beside it. Fully blocked
      // (too-hard) strokes mine nothing. Add/flatten never mine.
      if (action.mode === 'dig' && outcome.keys.length > 0) {
        mineNodes(world, planet.id, action.center, radius);
      }
      if (outcome.keys.length > 0) {
        events.emit('terrainEdited', { planetId: planet.id, keys: outcome.keys });
      }
      events.emit('actionApplied', { type: action.type });
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
  }
}
