// Per-tick input dispatch (M09/M10 split): headlamp, backpack keys, cable
// tool, E/Tab interaction, player movement, then either placement
// confirmation, the cable tool, or the terrain tool. Extracted from
// Game.frame to keep Game under the 400-line rule and make the priority order
// explicit in one place.

import type { EntityId } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import type { PlayerInput } from '../player/input.js';
import type { TerrainTool, ToolAim } from '../player/terrainTool.js';
import type { CableMode } from './cableMode.js';
import type { PlacementMode } from './placement.js';
import type { PackHold } from './packHold.js';
import { tickBackpackInput } from './backpackWiring.js';
import { tickInteraction } from './interactWiring.js';

export interface TickInputDeps {
  world: World;
  playerId: EntityId | null;
  input: PlayerInput;
  rig: { yaw: number; pitch: number };
  tool: TerrainTool;
  toolAim: ToolAim;
  toolButtons: { dig: boolean; add: boolean; flatten: boolean };
  toolActive: boolean;
  nowMs: number;
  flying: boolean;
  uiOpen: boolean;
  placement: PlacementMode;
  cable?: CableMode;
  packHold?: PackHold;
  openStation(stationId: EntityId): void;
  togglePrinter(): void;
}

/** Dispatch one sim tick's worth of input as Actions (call before tick). */
export function dispatchTickInput(deps: TickInputDeps): void {
  if (deps.input.consumeHeadlampToggle() && deps.playerId) {
    deps.world.dispatch({ type: 'toggleHeadlamp', playerId: deps.playerId });
  }
  const canAct = !deps.flying && deps.playerId !== null && !deps.uiOpen;
  // All edge queues drain every tick so nothing fires late.
  tickBackpackInput(deps.world, deps.playerId, deps.input, canAct);
  const interact = deps.input.consumeInteract();
  if (deps.input.consumeCableToggle?.() === true && deps.cable) {
    if (deps.cable.isActive()) deps.cable.cancel();
    else if (canAct) {
      deps.cable.activate();
      // Cable clicks own the mouse and E; a pending placement would fight it.
      deps.placement.cancel();
    }
  }
  if (deps.cable?.isActive()) {
    deps.packHold?.reset();
    if (interact) {
      deps.cable.cancel();
    } else if (canAct && deps.playerId) {
      const request = deps.cable.tick(
        deps.world,
        deps.playerId,
        deps.toolAim,
        deps.toolButtons.dig,
        deps.toolButtons.add,
      );
      if (request?.type === 'connect') {
        deps.world.dispatch({
          type: 'connectCable',
          playerId: deps.playerId,
          from: request.from,
          to: request.to,
        });
      } else if (request?.type === 'disconnect') {
        deps.world.dispatch({
          type: 'disconnectCable',
          playerId: deps.playerId,
          cableId: request.cableId,
        });
      }
    }
    // Tab must still toggle while the cable tool is active; world E actions
    // are suppressed (the E edge already cancelled the tool above).
    tickInteraction({
      world: deps.world,
      playerId: deps.playerId,
      input: deps.input,
      interact: false,
      interactHeld: false,
      nowMs: deps.nowMs,
      canAct,
      aim: deps.toolAim,
      placement: deps.placement,
      openStation: deps.openStation,
      togglePrinter: deps.togglePrinter,
    });
    if (!canAct || !deps.playerId) return;
    deps.world.dispatch({
      type: 'playerInput',
      playerId: deps.playerId,
      move: deps.input.move(),
      jump: deps.input.consumeJump(),
      sprint: deps.input.sprint(),
      lookYaw: deps.rig.yaw,
      lookPitch: deps.rig.pitch,
    });
    return;
  }
  tickInteraction({
    world: deps.world,
    playerId: deps.playerId,
    input: deps.input,
    interact,
    interactHeld: deps.input.isInteractHeld?.() === true,
    nowMs: deps.nowMs,
    packHold: deps.packHold,
    canAct,
    aim: deps.toolAim,
    placement: deps.placement,
    openStation: deps.openStation,
    togglePrinter: deps.togglePrinter,
  });
  if (!canAct || !deps.playerId) return;
  const playerId = deps.playerId;
  deps.world.dispatch({
    type: 'playerInput',
    playerId,
    move: deps.input.move(),
    jump: deps.input.consumeJump(),
    sprint: deps.input.sprint(),
    lookYaw: deps.rig.yaw,
    lookPitch: deps.rig.pitch,
  });
  // Placement consumes the click; the terrain tool must not also fire on
  // the same tick (a placed platform would otherwise dig its own ground).
  const request = deps.placement.tick(
    deps.world,
    playerId,
    deps.toolAim,
    deps.toolButtons.dig,
    deps.toolButtons.add,
  );
  if (request) {
    deps.world.dispatch({
      type: 'placePlaceable',
      playerId,
      placeableId: request.placeableId,
      position: request.position,
      snap: request.snap,
      slot: request.slot,
    });
    return;
  }
  if (deps.placement.isActive()) return;
  if (deps.toolActive) {
    const edit = deps.tool.update(deps.nowMs, playerId, deps.toolButtons, deps.toolAim);
    if (edit) deps.world.dispatch(edit);
  }
}
