import { newId } from '../core/ids.js';
import type { Vec3d } from '../core/math.js';
import { IDENTITY_QUAT } from '../core/math.js';
import { events } from '../core/events.js';
import type { World } from './world.js';

// All gameplay changes go through Actions (ARCHITECTURE.md hard rule 2).
// M00 skeleton: noop + a debug marker spawner used by tests/debug tools.

export type Action =
  | { type: 'noop' }
  | { type: 'debugSpawnMarker'; position: Vec3d };

export function applyAction(world: World, action: Action): void {
  switch (action.type) {
    case 'noop':
      return;
    case 'debugSpawnMarker': {
      const id = newId('marker');
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
  }
}
