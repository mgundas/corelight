import type { Vec3d } from '../core/math.js';
import { IDENTITY_QUAT } from '../core/math.js';
import { events } from '../core/events.js';
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
  | { type: 'playerTeleport'; playerId: EntityId; position: Vec3d };

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
      events.emit('actionApplied', { type: action.type });
      return;
    }
  }
}
