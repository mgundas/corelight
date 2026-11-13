// F3 free-fly toggle (split from Game to keep the file under 400 lines).
// Entering fly disables player input and closes UI; leaving it teleports the
// player to the camera so the debug camera never strands the session.

import type { PlayerInput } from '../player/input.js';
import type { FreeFlyCamera } from '../player/freeFlyCamera.js';
import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import type { CableMode } from './cableMode.js';
import type { PackHold } from './packHold.js';

export interface FlyToggleDeps {
  world: World;
  playerId: EntityId | null;
  flyCamera: FreeFlyCamera;
  input: PlayerInput;
  cable: CableMode;
  packHold: PackHold;
  closeAllUi(): void;
}

export function toggleFly(deps: FlyToggleDeps): void {
  const { flyCamera, input, world, playerId } = deps;
  const player = playerId ? world.entities.get(playerId) : undefined;
  const shuttleId = player?.components.player?.pilotingShuttleId ?? null;
  flyCamera.enabled = !flyCamera.enabled;
  deps.packHold.reset();
  deps.cable.cancel();
  if (flyCamera.enabled) {
    if (player) flyCamera.position = { ...player.position };
    input.setEnabled(false);
    deps.closeAllUi();
  } else {
    input.setEnabled(true);
    // A piloted player stays attached to the shuttle: teleporting to the
    // debug camera would only be undone (and could bury them on return).
    // The ship coasts while F3 is active because the pilot branch dispatches
    // no shuttleInput in fly mode.
    if (player && playerId && !shuttleId) {
      world.dispatch({
        type: 'playerTeleport',
        playerId,
        position: { ...flyCamera.position },
      });
    }
  }
}
