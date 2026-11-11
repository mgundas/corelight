import type { Vec3d } from '../core/math.js';
import { distance, IDENTITY_QUAT } from '../core/math.js';
import { BACKPACK_SLOTS, PICKUP_RANGE_M, SOIL_MAX, TOOL_RANGE_M, TOOL_RANGE_SLACK_M } from '../core/constants.js';
import { events } from '../core/events.js';
import { isKnownItem } from '../data/loadData.js';
import { createDensityField, layerAt, type DensityField } from '../terrain/density.js';
import type { EditMode, FlattenPlane } from '../terrain/edits.js';
import type { EntityId } from './entities.js';
import { moveBasis } from './physics/frames.js';
import { upAt } from './physics/frames.js';
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
  | { type: 'selectSlot'; playerId: EntityId; slot: number };

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
          },
          inventory: {
            slots: Array<EntityId | null>(BACKPACK_SLOTS).fill(null),
            selectedSlot: 0,
          },
        },
      });
      events.emit('actionApplied', { type: action.type });
      return;
    }
    case 'playerInput': {
      const entity = world.entities.get(action.playerId);
      const player = entity?.components.player;
      if (!entity || entity.kind !== 'player' || !player) return;
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
      // player's planet and start within tool range of the player.
      if (
        entity.planetId !== planet.id ||
        action.radius <= 0 ||
        action.strength <= 0 ||
        distance(entity.position, action.center) > TOOL_RANGE_M + TOOL_RANGE_SLACK_M + action.radius
      ) {
        events.emit('actionApplied', { type: action.type });
        return;
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
        action.radius,
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
        mineNodes(world, planet.id, action.center, action.radius);
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
  }
}

/** Ensure the player has a backpack (old M06 saves predate inventory). */
function inventoryFor(world: World, playerId: EntityId): { slots: (EntityId | null)[]; selectedSlot: number } | null {
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

function pickUpItem(world: World, playerId: EntityId, itemId: EntityId): void {
  const playerEntity = world.entities.get(playerId);
  const inventory = inventoryFor(world, playerId);
  if (!playerEntity || !inventory) return;
  const item = world.entities.get(itemId);
  const itemComp = item?.components.item;
  if (!item || item.kind !== 'item' || !itemComp || !isKnownItem(itemComp.itemId)) {
    events.emit('actionApplied', { type: 'pickUp' });
    return;
  }
  if (itemComp.holder === playerId) {
    events.emit('actionApplied', { type: 'pickUp' });
    return;
  }
  // One item per slot (v1): a full backpack refuses the pickup.
  if (item.planetId !== playerEntity.planetId || distance(item.position, playerEntity.position) > PICKUP_RANGE_M) {
    events.emit('actionApplied', { type: 'pickUp' });
    return;
  }
  const free = inventory.slots.indexOf(null);
  if (free === -1) {
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
  inventory.slots[free] = itemId;
  itemComp.holder = playerId;
  events.emit('actionApplied', { type: 'pickUp' });
}

function dropItem(world: World, playerId: EntityId, slot: number): void {
  const playerEntity = world.entities.get(playerId);
  const inventory = inventoryFor(world, playerId);
  if (!playerEntity || !inventory) return;
  if (!Number.isInteger(slot) || slot < 0 || slot >= BACKPACK_SLOTS) {
    events.emit('actionApplied', { type: 'drop' });
    return;
  }
  const carriedId = inventory.slots[slot] as EntityId | null;
  if (!carriedId) {
    events.emit('actionApplied', { type: 'drop' });
    return;
  }
  const planet = world.planets.find((p) => p.id === playerEntity.planetId);
  const player = playerEntity.components.player;
  const item = world.entities.get(carriedId);
  const itemComp = item?.components.item;
  if (!planet || !player || !item || item.kind !== 'item' || !itemComp) {
    inventory.slots[slot] = null;
    events.emit('actionApplied', { type: 'drop' });
    return;
  }
  // Drop in front of the player (full look direction, at chest height).
  const up = upAt(planet, playerEntity.position);
  const { forward } = moveBasis(up, player.yaw, player.pitch);
  item.position = {
    x: playerEntity.position.x + forward.x * 1.5 + up.x * 0.5,
    y: playerEntity.position.y + forward.y * 1.5 + up.y * 0.5,
    z: playerEntity.position.z + forward.z * 1.5 + up.z * 0.5,
  };
  item.planetId = planet.id;
  item.rotation = { ...IDENTITY_QUAT };
  delete itemComp.holder;
  inventory.slots[slot] = null;
  events.emit('actionApplied', { type: 'drop' });
}

/**
 * Dig strokes overlapping a node shake one charge loose per stroke bit as a
 * physical item beside the node. Exhausted nodes are removed and recorded in
 * depletedNodes so the deterministic placer never brings them back.
 */
function mineNodes(world: World, planetId: string, center: Vec3d, radius: number): void {
  const planet = world.planets.find((p) => p.id === planetId);
  if (!planet) return;
  for (const [id, entity] of [...world.entities]) {
    if (entity.kind !== 'node' || entity.planetId !== planetId) continue;
    const node = entity.components.node;
    if (!node || node.charges <= 0 || !isKnownItem(node.resourceId)) continue;
    if (distance(entity.position, center) > radius + 1.5) continue;
    node.charges -= 1;
    // Partial progress persists across far despawns (reapplied on respawn).
    world.nodeCharges.set(id, node.charges);
    const up = upAt(planet, entity.position);
    const itemId = world.nextId('item');
    world.entities.set(itemId, {
      id: itemId,
      kind: 'item',
      planetId,
      position: {
        x: entity.position.x + up.x * 1.0,
        y: entity.position.y + up.y * 1.0,
        z: entity.position.z + up.z * 1.0,
      },
      rotation: { ...IDENTITY_QUAT },
      components: { item: { itemId: node.resourceId } },
    });
    if (node.charges <= 0) {
      world.entities.delete(id);
      world.nodeCharges.delete(id);
      world.depletedNodes.add(id);
    }
  }
}

/**
 * Base (unedited) density fields per world, cached so every stroke bit does
 * not rebuild seeded noise. Crossings are measured against base + stored
 * deltas inside TerrainEdits; the live (edited) fields used by physics are
 * built separately in the physics system.
 */
const baseFieldCache = new WeakMap<World, Map<string, DensityField>>();

function baseFieldFor(world: World, planetId: string): DensityField {
  let perWorld = baseFieldCache.get(world);
  if (!perWorld) {
    perWorld = new Map();
    baseFieldCache.set(world, perWorld);
  }
  let field = perWorld.get(planetId);
  if (!field) {
    const planet = world.planets.find((p) => p.id === planetId);
    if (!planet) throw new Error(`terrainEdit: unknown planet ${planetId}`);
    field = createDensityField(planet, world.seed);
    perWorld.set(planetId, field);
  }
  return field;
}
