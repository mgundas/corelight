import type { Vec3d } from '../core/math.js';
import { IDENTITY_QUAT } from '../core/math.js';
import { SOIL_MAX } from '../core/constants.js';
import { events } from '../core/events.js';
import { createDensityField, layerAt, type DensityField } from '../terrain/density.js';
import type { EditMode, FlattenPlane } from '../terrain/edits.js';
import type { EntityId } from './entities.js';
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
    };

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
    case 'terrainEdit': {
      const entity = world.entities.get(action.playerId);
      const player = entity?.components.player;
      if (!entity || entity.kind !== 'player' || !player) return;
      if (action.radius <= 0 || action.strength <= 0) return;
      const planet = world.planets.find((p) => p.id === action.planetId);
      if (!planet) return;
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
        },
      );
      player.soil = Math.min(SOIL_MAX, Math.max(0, player.soil + outcome.gained - outcome.spent));
      if (outcome.blocked) player.lastTooHard = world.time;
      if (outcome.keys.length > 0) {
        events.emit('terrainEdited', { planetId: planet.id, keys: outcome.keys });
      }
      events.emit('actionApplied', { type: action.type });
      return;
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
