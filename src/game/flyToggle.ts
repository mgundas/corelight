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
  flyCamera.enabled = !flyCamera.enabled;
  deps.packHold.reset();
  deps.cable.cancel();
  const player = playerId ? world.entities.get(playerId) : undefined;
  if (flyCamera.enabled) {
    if (player) flyCamera.position = { ...player.position };
    input.setEnabled(false);
    deps.closeAllUi();
  } else {
    input.setEnabled(true);
    if (player && playerId) {
      world.dispatch({
        type: 'playerTeleport',
        playerId,
        position: { ...flyCamera.position },
      });
    }
  }
}
